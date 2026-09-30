/**
 * utils/playkit-view.js —— 服务端 advanced 会话视图 → 一个可渲染的玩法 kit(纯函数,可单测)
 *
 * 为什么需要这一层:服务端按**机制分段**给(playKit.blindTaste / playKit.steps …),
 * 一个节点可以同时挂好几段;而 UI 一次只弹一个 sheet。所以这里按固定优先级挑一段,
 * 并把服务端字段名翻译成组件的 props。
 *
 * ⚠️ 优先级不是随便排的:先弹「要玩家动手」的(答题/命名/表演),再弹展示型(听歌/收签)。
 * timeWindow 排最后 —— 它其实是道门禁,服务端不在时段内压根不会让开局,
 * 能走到这里说明已经开放了,只作兜底展示。
 *
 * ★ 服务端从不下发盲品答案与签文池,所以这里也无从泄露 —— 本文件只做字段搬运与文案拼装。
 */

const { stepsA11yLabel } = require('./playkit-steps.js');
const { toCard } = require('../../../utils/object-card.js');

const KIT_PRIORITY = [
  /* 节点玩法模板那批排在最前:它们是这个节点的**主玩法**,没做完就不该先弹别的。
     branch 又排在这批的最前 —— 它是一整段剧情,中途插一屏别的会把叙事打断。 */
  'qa', 'branch', 'predict', 'random', 'estimate', 'pricePair',
  /* R3 排序 / 连线 / 分类:节点的主玩法,没做完不该先弹别的。 */
  'sort', 'match', 'classify',
  'hiddenObject', 'scan',
  /* 《预制人生》那批(2026-09-17 契约 §2)。profile 排最前:它是这一场的开档,
     后面的故事变量要靠它;其余三个里 photoCheck/note 要玩家当场动手,typeIn 是限时挑战。
     ⚠️ 契约 §2.3 已作废「新 2d6 check 段」:master 上的 R14 旅程检定走 JOURNEY_SEGMENTS 那条路,
     不在这里登记;等 Worker A 给出 R14 的下发路径再接玩家端。 */
  'profile', 'photoCheck', 'note', 'typeIn',
  /* 决定类与挑战类九个(含 2026-09-22 现场感契约的罗盘指向与喊一嗓子)。⚠️ 名字不在这张表里 = 服务端下发了这一段,客户端也当它不存在:
     present 里没有它 → 拿不到 kit → 页面按「这个节点没有玩法」处理,不渲染、不报错。
     playkit-view-contract 里有一条按段名全表跑的断言,漏一个就红。 */
  'coinFlip', 'diceRoll', 'reaction', 'ballShake', 'quietHold', 'compass', 'shout', 'countdown', 'stopwatch',
  // slowTask 排在展示型之前、动手型之后:它需要玩家做一个决定(开始/领取),
  // 但不像答题那样必须当场完成
  'blindTaste', 'diyName', 'silentOrder', 'steps', 'slowTask', 'musicCorner', 'dailySign', 'timeWindow',
  /* bingo 是主题级的进度呈现(走到别处点亮、连线换奖),不是当场玩完的玩法 ——
     垫底:本节点还有任何没做完的段时都不该拿棋盘挡在主玩法前面。 */
  'bingo',
];

/** 服务端段名 → 组件 type(cy-playkit 分发器认的那套) */
const TYPE_OF = {
  qa: 'qa',
  scan: 'scan',
  branch: 'branch',
  estimate: 'estimate',
  pricePair: 'pricepair',
  sort: 'sort',
  match: 'match',
  classify: 'classify',
  hiddenObject: 'hidden',
  predict: 'predict',
  random: 'random',
  blindTaste: 'blindtaste',
  diyName: 'diyname',
  silentOrder: 'silentorder',
  /* 计步挑战 → walk 那一屏(琥珀点阵 LCD)。★ 原型编辑页的试玩表就是这么指的:
     PK_TAB.steps = '[data-kit="walk"]'(模板编辑页 v2 第 1324 行)。
     早先指向 'steps'(旧 Figma v5.1 那屏),于是照原型港好的 walk 屏谁也到不了。 */
  steps: 'walk',
  musicCorner: 'musiccorner',
  dailySign: 'dailysign',
  timeWindow: 'timewindow',
  slowTask: 'slowtask',
  coinFlip: 'coinflip',
  diceRoll: 'diceroll',
  reaction: 'reaction',
  ballShake: 'ballshake',
  quietHold: 'quiethold',
  // 罗盘指向(现场感契约 §3):不在 TYPE_OF 里 = 分发器拿到 undefined,整块不渲染。
  compass: 'compass',
  // 喊一嗓子(现场感契约 §4):quietHold 的反面,不在表里 = 分发器拿到 undefined,整块不渲染。
  shout: 'shout',
  countdown: 'countdown',
  stopwatch: 'stopwatch',
  /* 《预制人生》四个新段。⚠️ 少一条 = type undefined,分发器整块不渲染。 */
  profile: 'profile',
  photoCheck: 'photocheck',
  note: 'note',
  typeIn: 'typein',
  /* 九宫格:段不在商家节点配置里(主题级),由服务端在会话视图里现算进度下发。
     组件位序与后端 BingoCard 对齐(行优先 0..8),这里只搬不问。 */
  bingo: 'bingo',
  sort: 'sort',
  match: 'match',
  classify: 'classify',
};

function pad4(n) { return String(Number(n) || 0).padStart(4, '0'); }
function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** "HH:mm" → 当天第几分钟;格式不对返回 -1 */
function minuteOfDay(clockText) {
  if (!clockText || clockText.length !== 5 || clockText[2] !== ':') return -1;
  const hour = Number(clockText.slice(0, 2));
  const minute = Number(clockText.slice(3));
  if (!(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59)) return -1;
  return hour * 60 + minute;
}

/**
 * 距离下一个开放时刻还有多少秒。跨夜窗口(23:00–01:00)要按"是否已过今天的开点"分支,
 * 否则 23:30 会算出一个负数或者一整天。
 * @param {Date} now 注入而不是内部 new Date():这样能单测
 */
function secondsUntilOpen(openFrom, now) {
  const from = minuteOfDay(openFrom);
  if (from < 0 || !now) return 0;
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  let diff = from - nowMinute;
  if (diff <= 0) diff += 24 * 60;          // 今天的开点已过,等明天这个点
  return diff * 60 - now.getSeconds();
}

function buildBlindTaste(seg) {
  return {
    title: seg.title || '',
    steps: stepsA11yLabel('blindtaste', seg.steps),
    hint: seg.hint || '',
    options: seg.options || [],
    xpLabel: seg.xp > 0 ? '答对 +' + seg.xp + ' XP' : '',
    // 回显最后一次选择;答对后锁住(服务端也会拒第二次提交,这里只是别让用户白点)
    selectedKey: seg.solved ? (seg.lastKey || '') : '',
    locked: !!seg.solved,
  };
}

/* 计步挑战 → walk 屏要的三件事。剩下的(还差多少、减排多少、进度)由 kit 自己算,
   算法与原型同值(每格 500 步、一步 0.00008kg),不在这儿再算一遍。
   ★ goalLocked:目标步数是**商家配的**(服务端 submitSteps 也拿 cfg.goal 判达标),
   玩家改不得 —— 让他在屏上 ± 一下,改的只是本地数字,判定还按商家那个数,纯骗人。 */
function buildSteps(seg) {
  return {
    steps: seg.todaySteps > 0 ? seg.todaySteps : 0,
    goal: seg.goal > 0 ? seg.goal : 0,
    goalLocked: true,
  };
}

/** 接力签:票面全是服务端给的 —— 地址来自这一站,那句/照片来自上一个来这里的人(没人来过是开场签)。
 *  这里不写任何兜底文案;签名为空时组件自己标「这一站的发起人」,那是标签不是数据。 */
function buildDailySign(seg, now) {
  const date = now || new Date();
  return {
    dateLabel: pad2(date.getMonth() + 1) + ' / ' + pad2(date.getDate()),
    address: seg.address || '',
    lines: seg.lines || [],
    signer: seg.signer || '',
    leftAt: seg.leftAt || '',
    photoUrl: seg.photoUrl || '',          // 上一个人拍的,印在票上;没给就不印
    serialLabel: 'NO. ' + pad4(seg.serial),
    textMax: Number(seg.textMax) || 40,
    myText: seg.myText || '',
    myPhotoUrl: seg.myPhotoUrl || '',
    claimed: !!seg.claimedDate,
    revealed: !!seg.claimedDate,
  };
}

function segmentComplete(name, seg) {
  // 走到终点那一步就算这段剧情完了 —— 终点没有选项,再弹一次也没得选
  if (name === 'branch') return !!(seg.currentStep && seg.currentStep.terminal);
  // 押过就算完:答案由商家事后给,玩家这边没有第二个动作
  if (name === 'predict') return !!String(seg.myOptionKey || '').trim();
  // 抽满次数才算完。还能抽就该继续弹,不然剩下的次数玩家永远用不掉
  if (name === 'random') return ((seg.drawn || []).length >= (seg.drawCount || 0));
  // 问答:答完就算(答错次数用完也算完),与猜数字同一条口径
  if (name === 'qa') return !!seg.finished;
  // 扫码:扫了就是完了,这一屏没有第二个动作
  if (name === 'scan') return !!seg.scanned;
  // 猜数字看的是「答过了」不是「答对了」:猜不中就卡住,玩家会退出而不是重猜
  if (name === 'estimate') return !!seg.submitted;
  if (name === 'pricePair') return !!seg.finished;
  /* 排序:排对或次数用尽(finished)才算完 —— 还能重排就得接着弹。
     连线 / 分类没有次数上限:只有连对 / 分对(passed)才是终点,错了可以一直改。 */
  if (name === 'sort') return !!seg.finished;
  if (name === 'match' || name === 'classify') return !!seg.passed;
  // 找东西反过来:有确定答案,必须全找齐才算过
  if (name === 'hiddenObject') return ((seg.foundIds || []).length >= (seg.total || 0));
  if (name === 'blindTaste') return !!seg.solved;
  if (name === 'diyName') return !!String(seg.name || '').trim();
  if (name === 'steps') return !!seg.reached;
  if (name === 'slowTask') return !!seg.claimed;
  if (name === 'dailySign') return !!seg.claimedDate;
  /* 九宫格全亮就算这段完了 —— 它垫底且只呈现进度,没有"再做一次"的动作;
     没满九格就继续该弹,让玩家看得见自己连到哪儿了。 */
  if (name === 'bingo') return (seg.filledPositions || []).length >= 9;
  /* 决定类:抛过/掷过就算完 —— 这两屏的产出是「给个结果照做」,没有对错。
     挑战类:服务端判过(submitted)就算完,passed 只决定拿不拿分。 */
  if (name === 'coinFlip') return !!seg.flipped;
  if (name === 'diceRoll') return !!seg.rolled;
  /* 《预制人生》四个新段:
     · 建档与留言:done 由服务端落,重复提交会被拒;
     · 拍照审核:过了或兜底放行(flagged)都算完,还在重拍就不算;
       降级(模型没给结论)也走 flagged(契约 §2.2),所以这一屏不会被卡成死路;
     · 打字:打对算完,限次用尽也算(tries=0 表示不限,永远不会用尽)。 */
  if (name === 'profile') return !!seg.done;
  if (name === 'photoCheck') return !!seg.passed || !!seg.flagged;
  if (name === 'note') return !!seg.done;
  if (name === 'typeIn') {
    const tries = Number(seg.tries) || 0;
    return !!seg.passed || (tries > 0 && (Number(seg.attempts) || 0) >= tries);
  }
  if (name === 'reaction' || name === 'ballShake' || name === 'quietHold'
      || name === 'shout' || name === 'countdown' || name === 'stopwatch') return !!seg.submitted;
  // 罗盘:对准过一次就算走完 —— 没有对错、没有次数上限(契约 §3.4)
  if (name === 'compass') return !!seg.done;
  return false;
}

/** 接力签的刮层在「留一句」之前就刮开了;留完/重进都直接显示,不再盖回去。 */
function dailySignRevealState(previous, next) {
  if (!next || next.type !== 'dailysign') return next;
  return Object.assign({}, next, { revealed: !!next.claimed });
}

/* 故事变量:{名字} 或 {名字|兜底词}。**没值且没兜底时原样留着花括号** ——
   渲染成空串的话作者永远看不到自己漏了哪个键,整句话静默缺一块。
   ⚠️ 契约 §3.1 只认这一条正则,不要在这儿长成模板引擎。 */
const STORY_VAR_PATTERN = '\\{([a-zA-Z][a-zA-Z0-9_]{0,15})(?:\\|([^}]{0,20}))?\\}';

/**
 * 正文里的 {名字} 替换。值来自服务端会话视图下发的 vars map(Worker A 拼好),
 * 这一层只做替换,不查 profile / 不猜已完成 kit。
 */
function applyStoryVars(text, vars) {
  const src = String(text == null ? '' : text);
  if (!src || src.indexOf('{') < 0) return src;
  const map = vars || {};
  return src.replace(new RegExp(STORY_VAR_PATTERN, 'g'), (whole, name, fallback) => {
    const value = map[name];
    if (value == null || value === '') return fallback == null || fallback === '' ? whole : fallback;
    return String(value);
  });
}

/** 建档:questions 的 options[].effects 服务端剥掉不下发(数值加成露出来就成了攻略表),
 *  这里只搬题面与已填答案;avatar 只带回 enabled/required,组件自己画头像位。 */
function buildProfile(seg) {
  return {
    title: seg.title || '',
    lead: seg.lead || '',
    avatar: seg.avatar || {},
    questions: seg.questions || [],
    answers: seg.answers || {},
    avatarUrl: seg.avatarUrl || '',
    done: !!seg.done,
  };
}

/** 拍照审核:判定全在服务端(契约 §2.2 改版)—— 这里只搬状态;
 *  原先下发的 rule.mode / threshold 本地算分那套已整段作废。
 *  lastReason 是服务端给的「为什么没过」,要摆给玩家看;degraded 是模型没给结论。
 *
 *  receipt = 本次回包带的 objectCard(契约 §10.2「判过 → 当场看到卡」)。它**不是**玩法配置,
 *  是这一趟铸出来的那张卡的回执:铸成功才有,老模板 / 判不过 / 铸卡炸了都不带 —— 那时 card=null,
 *  这一屏与今天逐字相同。映射在 utils/object-card.js,与藏品册那一页共用。 */
function buildPhotoCheck(seg, receipt, placeName) {
  const card = toCard(receipt);
  return {
    title: seg.title || '',
    shotNote: seg.shotNote || '',
    maxTries: seg.maxTries || 0,
    fallback: seg.fallback || 'retake',
    tries: seg.tries || 0,
    passed: !!seg.passed,
    flagged: !!seg.flagged,
    degraded: !!seg.degraded,
    lastReason: seg.lastReason || '',
    lastUrl: seg.lastUrl || '',
    /* 取景轮廓(S1):这两个键**恒产出** —— 分发器绑了 kit.frameUrl，playkit-view-contract
       那条「绑了必须有人产出」的门禁不容忍条件产出；没配时给空串，组件据此走原来的 chooseMedia。
       ⚠️ 「商家没配 = 玩家行为逐字相同」钉在组件的取景分支入口上，不是钉在键的存在与否上。 */
    frameUrl: seg.frameUrl || '',
    frameOpacity: pcFrameOpacity(seg),
    /* 拍物成卡(立体藏品卡契约 §2.1 / §2.4):mode 空 = 普通拍照审核,这一屏与今天逐字相同。
       服务端只在配了卡片时投影这三个键,所以回落值必须与后端默认一致(foil / 空),
       否则「投影漏了一个键」和「商家就是没填」在组件手里长得一模一样。 */
    mode: seg.mode || '',
    cardTitle: seg.cardTitle || '',
    cardStyle: seg.cardStyle || 'foil',
    card,
    /* 拍物成卡那一屏的「地点」:会话视图里只有 nodeId,名字在页面手里 ——
       页面在调 pickPlayKit 前把「主题名 · 节点名」塞进 view.placeName。 */
    place: placeName || '',
    // 编辑页预览才为 true(advanced-game-preview):玩家侧恒 false,按快门就真拍真判
    preview: false,
    /* 提交失败信号:上传没成、题目变了等失败只在页面里发生,那一屏收不到回包会一直转圈。
       页面每失败一次就把 kit.photoFailSeq 往上加(页面计数单调递增),组件只认「比见过的大」。
       这里恒给 0:会话视图重建时归零不算失败。 */
    photoFailSeq: 0,
  };
}

/**
 * 取景轮廓不透明度：缺省 40、越界夹回 0–100。
 * 与后端 AdvancedGameConfigValidator / 运行期投影同一口径（三处都夹，配置里那个数才真会生效）。
 */
function pcFrameOpacity(seg) {
  const raw = Number(seg && seg.frameOpacity);
  if (!Number.isFinite(raw)) return 40;
  return Math.max(0, Math.min(100, raw));
}

/** 检定:R14 那套 journey check 本轮不在 playKit 里(契约 §2.3 已作废新 check 段),
 *  它走 encounter 的 allowedActions,由 pickJourneyCheck 认领(见下)。 */

/**
 * 旅程检定入口:R14 的 check 不在 playKit 里,而是 encounter 视图在
 * 「已到店 && 未锁定 && 该节点旅程块 check.enabled」时把字符串 'check' 追加进
 * allowedActions(PlayEncounterServiceImpl#allowedActions)。
 * 这里只认这一条入口 —— 拿不到 checkId 就不算有检定。
 * ⚠️ 阶段 3:力竭时服务端会把 'check' 从 allowedActions 摘掉,入口自然消失。
 * 但「消失了不给理由」和「灰着不给理由」一样糟,所以这里要把 exhausted 单独交出去,
 * 让页面能写一句「力竭了,先找地方休整」——否则玩家只会觉得这一站坏了。
 * ⚠️ 题面只搬公开面(skill/tier/mods/优劣势);successText/failText/effects/failCostTag
 * 一律不下发,文案要等 /settle 的回执,别在这层找。
 */
function pickJourneyCheck(encounter) {
  const enc = encounter || {};
  const actions = Array.isArray(enc.allowedActions) ? enc.allowedActions : [];
  const check = enc.check;
  if (!check || !String(check.checkId || '').trim()) return null;
  // 力竭:有检定、但这一轮做不了。交出一个只带 exhausted 的壳,页面据此写原因。
  if (actions.indexOf('check') < 0) {
    return check.exhausted ? { checkId: String(check.checkId), exhausted: true, blocked: true } : null;
  }
  return {
    checkId: String(check.checkId),
    exhausted: false,
    blocked: false,
    skill: check.skill || '',
    tier: check.tier || '',
    // 条件修正逐条给玩家看见:held = 这条在本局状态下达不达成(值才有意义)
    mods: (check.mods || []).map((mod) => ({
      label: (mod && mod.label) || '',
      value: Number(mod && mod.value) || 0,
      held: !!(mod && mod.held),
    })),
    advantage: !!check.advantage,
    disadvantage: !!check.disadvantage,
  };
}

/**
 * 检定回执 → 一屏判定 UI 的字段(PlayCheckReceipt)。
 * ★ 结算前(settled=false)服务端**不给** text / failCostLabel,别去猜:
 *   先出骰子与成败,再点结算换文案。
 */
function checkReceiptView(receipt) {
  const r = receipt || {};
  const num = (v) => (v == null ? null : Number(v) || 0);
  return {
    rolled: true,
    tier: r.tier || '',
    dc: Number(r.dc) || 0,
    dice: Array.isArray(r.dice) ? r.dice : [],
    kept: num(r.kept),
    total: num(r.total),
    success: !!r.success,
    nat: r.nat || '',
    rerolled: !!r.rerolled,
    settled: !!r.settled,
    text: r.text || '',
    failCostLabel: r.failCostLabel || '',
    hp: num(r.hp),
    luck: num(r.luck),
    exhausted: !!r.exhausted,
    mods: (r.mods || []).map((mod) => ({
      label: (mod && mod.label) || '',
      value: Number(mod && mod.value) || 0,
      applied: !!(mod && mod.applied),
    })),
  };
}

/** 留言:previous 是给后来的人看的前几条,mine 是自己的那条(留过才给)。 */
function buildNote(seg) {
  return {
    title: seg.title || '',
    prompt: seg.prompt || '',
    maxLength: Number(seg.maxLength) || 40,
    presets: seg.presets || [],
    previous: seg.previous || [],
    mine: seg.mine || '',
    done: !!seg.done,
  };
}

/** 限时打字:目标文本不藏 —— 这玩法考的是手速不是猜谜;判定在服务端。 */
function buildTypeIn(seg) {
  return {
    title: seg.title || '',
    target: seg.target || '',
    seconds: Number(seg.seconds) || 0,
    caseSensitive: !!seg.caseSensitive,
    tries: Number(seg.tries) || 0,
    attempts: Number(seg.attempts) || 0,
    passed: !!seg.passed,
  };
}

/**
 * 呈现方式(契约 §1.5):服务端在会话视图**根层**下发的 present(inline / fullscreen)。
 * ⚠️ 默认表的唯一实现在服务端(AdvancedGameConfigValidator#resolvePresent,运行期视图与公开投影
 * 同源),客户端不重推;字段缺失(旧后端 / mock / 试玩)时按 fullscreen —— 存量行为逐字不变。
 */
function presentOf(view) {
  return view && view.present === 'inline' ? 'inline' : 'fullscreen';
}

/**
 * @param {Object} view  /api/play/advanced/{start,action,state} 的返回体
 * @param {Date}   [now] 注入当前时间,供倒计时与日期文案使用(可单测)
 * @returns {Object|null} 给 cy-playkit 的 kit;没有任何新玩法段时返回 null
 */
/**
 * 这一局还剩多少秒。★ 服务端一直在下发 `deadlineAt`(会话的绝对截止时刻,
 * 由 advanced.timer 的 durationSeconds 算出来),客户端此前从没读过它 ——
 * 于是问答/分支/猜数字/猜图/找东西那五屏的限时条恒为 0,一条都不出现:
 * 商家开了「限时挑战」,服务端到点判负,而玩家全程看不见钟。
 * ⚠️ 权威在服务端:这里算出来的只是画给人看的,不参与判定(改手机时间也没用)。
 */
function limitSecondsOf(view, now) {
  const deadline = view && view.deadlineAt;
  if (!deadline) return 0;
  const left = Math.ceil((Number(deadline) - (now || new Date()).getTime()) / 1000);
  return left > 0 ? left : 0;
}

function pickPlayKit(view, now) {
  const playKit = view && view.playKit;
  if (!playKit) return null;

  const present = KIT_PRIORITY.filter((name) => !!playKit[name]);
  if (!present.length) return null;
  const name = present.find((item) => !segmentComplete(item, playKit[item])) || present[0];
  const seg = playKit[name];

  // sessionId / version 必须跟着走:提交动作要用它们做幂等键与 CAS
  const base = {
    type: TYPE_OF[name],
    sessionId: view.sessionId,
    version: view.version,
    // 呈现方式逐字搬服务端(见 presentOf);故事流那层靠它决定铺不铺
    present: presentOf(view),
  };
  /* 限时条:这五屏都把 limitSeconds 透传给 cy-play-stage 画条、跑表、到点判负。
     只给绑了它的那几屏 —— 别的屏拿到也没用,反而会让「谁在用限时」看不清。 */
  const limitSeconds = limitSecondsOf(view, now);
    if (name === 'qa') {
      const MODE = { TYPE: 'type', PICK: 'pick', SHOT: 'shot' };
      return Object.assign(base, {
        mode: MODE[seg.mode] || 'type',
        theme: 'dark',
        title: seg.title || '',
        lead: seg.lead || '',
        imageUrl: seg.imageUrl || '',
        audioUrl: seg.audioUrl || '',
        // 选项文案要给,**哪个是对的不给** —— 判定回来之后才知道
        options: (seg.options || []).map((o) => ({ id: o.id, t: o.label || '' })),
        // 多选标记:老单选配置服务端不给这个字段,缺省按单选渲染(单选行为一字不变)
        multi: !!seg.multi,
        shotLead: seg.lead || seg.title || '',
        // 提示词底下那行小字。商家没写就不出 —— 空着比硬凑一句好
        shotNote: seg.shotNote || '',
        /* 答错亮不亮答案:服务端只在「商家开了这个开关 + 次数用完」时才下发 answerId,
           所以「给了 = 可以亮」。别再单独发一个 reveal 布尔 —— 两个来源迟早会打架。 */
        reveal: !!seg.answerId,
        limitSeconds: limitSeconds,
        maxTries: seg.maxTries || 0,
        // attempts 是多选回执条的开关:>0 才说明这一屏刚判过,不是刚打开
        attempts: seg.attempts || 0,
        finished: !!seg.finished,
        passed: !!seg.passed,
        answerId: seg.answerId || '',
        feedback: seg.lastFeedback || '',
      });
    }
    if (name === 'scan') {
      const KIND = { TEXT: '文字', VOICE: '语音', IMAGE: '图片', OVERLAY: '显形' };
      return Object.assign(base, {
        kind: KIND[seg.kind] || '文字',
        // 回复内容扫完才有 —— 扫之前服务端压根不给
        reply: seg.reply || '',
        audioUrl: seg.audioUrl || '',
        imageUrl: seg.imageUrl || '',
        overlayUrl: seg.overlayUrl || '',
        overlayScale: seg.overlayScale || 60,
        // 显形档的真 AR:缺省就是不开(存量配置照旧走屏幕叠加),不是 undefined
        arMode: seg.arMode || 'NONE',
        markerUrl: seg.markerUrl || '',
        modelUrl: seg.modelUrl || '',
        scanned: !!seg.scanned,
      });
    }
    if (name === 'pricePair') {
      return Object.assign(base, {
        title: seg.title || '',
        // 哪一张是对的服务端不给 —— 判定回来之后才知道
        items: seg.items || [],
        maxTries: seg.maxTries || 0,
        limitSeconds: limitSeconds,
        attempts: seg.attempts || 0,
        finished: !!seg.finished,
        passed: !!seg.passed,
        answerId: seg.answerId || '',
      });
    }
    if (name === 'branch') {
      const step = seg.currentStep || {};
      return Object.assign(base, {
        title: step.title || '',
        body: step.body || '',
        // 选项带着**服务端给的 id** 走:走向只有服务端知道,客户端不自己判去哪一步
        options: (step.options || []).map((o) => ({ id: o.id, t: o.label || '' })),
        limitSeconds: limitSeconds,
        ended: !!step.terminal,
      });
    }
    if (name === 'predict') {
      return Object.assign(base, {
        question: seg.question || '',
        hint: seg.hint || '',
        options: (seg.options || []).map((o) => ({ key: o.key, label: o.label || '' })),
        // 定成数字再过桥:kit 的等待文案由它推,undefined 会让那行字重新变空
        closeAtHour: Number.isInteger(seg.closeAtHour) ? seg.closeAtHour : -1,
        // 什么时候由商家公布答案(相对天数 + 整点)。原型「揭晓时间」就是这两个数
        revealDays: Number.isInteger(seg.revealDays) ? seg.revealDays : -1,
        revealHour: Number.isInteger(seg.revealHour) ? seg.revealHour : -1,
        myOptionKey: seg.myOptionKey || '',
        // 0 待揭晓 / 1 已揭晓 / 2 已作废;没押过就没有这个字段
        settleStatus: seg.settleStatus,
        settledOption: seg.settledOption || '',
        won: !!seg.won,
      });
    }
    if (name === 'random') {
      const drawn = seg.drawn || [];
      return Object.assign(base, {
        // 这副卡叫什么。盒子里**有什么**不下发 —— 牌堆是盖着的,只知道还剩几张
        deckName: seg.deckName || '',
        drawn: drawn,
        drawCount: seg.drawCount || 0,
        remaining: Math.max(0, (seg.drawCount || 0) - drawn.length),
      });
    }
    if (name === 'blindTaste') return Object.assign(base, buildBlindTaste(seg));
    if (name === 'steps') return Object.assign(base, buildSteps(seg));
    if (name === 'dailySign') return Object.assign(base, buildDailySign(seg, now));
    if (name === 'diyName') {
      return Object.assign(base, {
        title: seg.title || '',
        value: seg.name || '',
        suggestions: seg.suggestions || [],
        maxLength: seg.maxLength || 16,
        ctaLabel: '提交作品',
      });
    }
    if (name === 'silentOrder') {
      return Object.assign(base, {
        title: seg.title || '',
        rule: seg.rule || '',
        limitSeconds: seg.limitSeconds || 0,
      });
    }
    if (name === 'musicCorner') {
      return Object.assign(base, {
        title: seg.title || '',
        trackName: seg.trackName || '店主的歌单',
        audioUrl: seg.audioUrl || '',
        duration: seg.durationSeconds || 0,
        // 稿里这句写了「爪印自动落章 +10 XP」,但音乐角明确不判定通关(2026-08-26 拍板),
        // 所以文案不承诺奖励 —— 承诺了拿不到才是最伤的
        hint: '坐下来,听完这一首',
      });
    }
    if (name === 'slowTask') {
      return Object.assign(base, {
        title: seg.title || '',
        startHint: seg.startHint || '现在开个头,剩下的交给时间。',
        startLabel: seg.startLabel || '就这么定了',
        // 等待期文案不含秒级倒计时:这是低压循环,精确到秒会把"慢慢来"变成"快到了"
        waitHint: seg.waitHint || '明天这个时候,这里会多出一点东西。',
        unlockLabel: seg.unlockLabel || '看看留下了什么',
        unlockText: seg.unlockText || '',
        started: !!seg.started,
        claimed: !!seg.claimed,
        daysLeft: seg.daysLeft > 0 ? seg.daysLeft : 0,
      });
    }
  /* ===== 《预制人生》四个新段(契约 §2;§2.3 的 check 已作废)===== */
  if (name === 'profile') return Object.assign(base, buildProfile(seg));
  if (name === 'photoCheck') return Object.assign(base, buildPhotoCheck(seg, view.objectCard, view.placeName));
  if (name === 'note') return Object.assign(base, buildNote(seg));
  if (name === 'typeIn') return Object.assign(base, buildTypeIn(seg));

  /* ===== 节点玩法模板:决定类与挑战类 =====
     ⚠️ 这九段之前只有优先级表和 action 表,没有这里的分支,于是服务端下发了、
     客户端一路落到函数末尾 return null —— 十九个玩法有十个到不了玩家,而且
     不报错、不打日志。判据现在由 playkit-view-contract 按段名全表跑。 */
  if (name === 'estimate') {
    return Object.assign(base, {
      title: seg.question || '',
      unit: seg.unit || '',
      min: Number(seg.min) || 0,
      max: Number(seg.max) || 0,
      maxTries: seg.maxAttempts || 0,
      limitSeconds: limitSeconds,
    });
  }
  /* ===== R3 排序 / 连线 / 分类 =====
     题面(打乱过顺序的 items / 已经洗过的 right)全给,**答案一个都不给**:
     answerOrder / pairs / answer 由服务端留在 config_snapshot 里,下发等于把题做废。
     回执只有整体对错(lastCorrect / passed / finished),逐项对错服务端没开字段,
     所以组件按「整体」呈现 —— 有逐项字段再显示逐项(见不确定清单)。 */
  if (name === 'sort') {
    return Object.assign(base, {
      prompt: seg.prompt || '',
      items: seg.items || [],
      maxAttempts: seg.maxAttempts || 0,
      attempts: seg.attempts || 0,
      finished: !!seg.finished,
      passed: !!seg.passed,
      lastCorrect: !!seg.lastCorrect,
    });
  }
  if (name === 'match') {
    return Object.assign(base, {
      prompt: seg.prompt || '',
      left: seg.left || [],
      right: seg.right || [],
      attempts: seg.attempts || 0,
      passed: !!seg.passed,
      lastCorrect: !!seg.lastCorrect,
    });
  }
  if (name === 'classify') {
    return Object.assign(base, {
      prompt: seg.prompt || '',
      bins: seg.bins || [],
      items: seg.items || [],
      attempts: seg.attempts || 0,
      passed: !!seg.passed,
      lastCorrect: !!seg.lastCorrect,
    });
  }
  if (name === 'hiddenObject') {
    return Object.assign(base, {
      title: seg.title || '',
      imageUrl: seg.imageUrl || '',
      // 只有「要找什么」,没有「在哪儿」—— 坐标是这个玩法唯一的防线,服务端也不下发
      targets: seg.targets || [],
      total: seg.total || 0,
      limitSeconds: limitSeconds,
      // 能错几次。0 = 不限;用完之后服务端直接拒收,这里只负责把点数画出来
      maxTries: seg.maxTries || 0,
    });
  }
  if (name === 'coinFlip') {
    const heads = seg.heads || {};
    const tails = seg.tails || {};
    return Object.assign(base, {
      kicker: seg.kicker || '',
      face: seg.side || '',
      headsLabel: heads.label || '正面',
      headsAction: heads.action || '',
      tailsLabel: tails.label || '反面',
      tailsAction: tails.action || '',
    });
  }
  if (name === 'diceRoll') {
    return Object.assign(base, {
      mode: seg.mode || 'd6', dc: seg.dc, modifier: seg.modifier, rollMode: seg.rollMode, preview: false,
      result: seg.mode === 'd20' && seg.rolled ? {
        values: seg.pips || [], kept: seg.kept, total: seg.total, success: seg.success, text: seg.action || '',
      } : null,
      kicker: seg.kicker || '',
      faces: seg.faces || [],
      values: seg.pips || [],
      diceCount: seg.diceCount === 2 ? 2 : 1,
    });
  }
  if (name === 'reaction') {
    return Object.assign(base, {
      kicker: seg.kicker || '',
      rounds: seg.rounds || 0,
      goalMs: seg.goalMs || 0,
    });
  }
  if (name === 'ballShake') {
    return Object.assign(base, {
      kicker: seg.kicker || '',
      goal: seg.goal || 0,
      timed: !!seg.timed,
      seconds: seg.seconds || 0,
    });
  }
  if (name === 'quietHold') {
    return Object.assign(base, {
      kicker: seg.kicker || '',
      sub: seg.sub || '',
      seconds: seg.seconds || 0,
    });
  }
  /* 罗盘指向:bearing/tolerance/holdSeconds 全是题面(服务端开局就下发),
     对准与保持由组件现场判,提交只报「对准时的方位角」给服务端复核容差。 */
  if (name === 'compass') {
    return Object.assign(base, {
      kicker: seg.kicker || '',
      bearing: seg.bearing || 0,
      tolerance: seg.tolerance || 15,
      holdSeconds: seg.holdSeconds || 3,
      hint: seg.hint || '',
      done: !!seg.done,
    });
  }
  /* 喊一嗓子:下发要喊满的秒数与标题。阈值不下发,由组件开局现场校准(与 quietHold 同一把尺)。 */
  if (name === 'shout') {
    return Object.assign(base, {
      kicker: seg.kicker || '',
      seconds: seg.seconds || 0,
    });
  }
  if (name === 'countdown') {
    return Object.assign(base, {
      kicker: seg.kicker || '',
      seconds: seg.seconds || 0,
      doneText: seg.doneText || '',
    });
  }
  if (name === 'stopwatch') {
    return Object.assign(base, {
      kicker: seg.kicker || '',
      targetSeconds: seg.targetSeconds || 0,
      toleranceMs: seg.toleranceMs || 0,
      tries: seg.tries || 0,
    });
  }
  /* 推理类三玩法:答案字段(answerOrder/pairs/answer)服务端不投影,这里也没有。
     排序的 items 与连线的 right 到这一步已被服务端打乱 —— 原样搬运,不重排。 */
  if (name === 'sort') {
    return Object.assign(base, {
      prompt: seg.prompt || '',
      items: seg.items || [],
    });
  }
  if (name === 'match') {
    return Object.assign(base, {
      prompt: seg.prompt || '',
      left: seg.left || [],
      right: seg.right || [],
    });
  }
  if (name === 'classify') {
    return Object.assign(base, {
      prompt: seg.prompt || '',
      bins: seg.bins || [],
      items: seg.items || [],
    });
  }

  if (name === 'bingo') {
    return Object.assign(base, {
      title: seg.title || '',
      labels: seg.labels || [],
      cellSpecs: seg.cellSpecs || [],
      filledPositions: seg.filledPositions || [],
      lineReward: seg.lineReward || '',
      fullReward: seg.fullReward || '',
    });
  }

  if (name === 'timeWindow') {
    return Object.assign(base, {
        eyebrow: seg.eyebrow || '时段限定',
        title: seg.title || '还没到开放时间',
        openFrom: seg.openFrom || '',
        openTo: seg.openTo || '',
        remainSeconds: secondsUntilOpen(seg.openFrom, now || new Date()),
        subscribeTmplId: seg.subscribeTmplId || '',
        // 订阅状态以服务端回读为准 —— 以前只活在本次内存里,退出重进就"没订过"
        subscribed: !!seg.subscribed,
    });
  }
  return null;
}

/** 玩法动作 → 服务端 action 名。不在册的一律不发,避免拼出服务端不认识的动作名。 */
const ACTION_OF = {
  'blindtaste:answer': 'SUBMIT_BLIND_TASTE',
  'diyname:submit': 'SUBMIT_DIY_NAME',
  /* 计步:同步与落章都走 SUBMIT_STEPS —— 服务端那一条就干全套(换 code、解密微信运动、
     达标发分且只发一次)。'steps:refresh' 是旧 steps 屏的事件名,屏已换成 walk。 */
  'walk:sync': 'SUBMIT_STEPS',
  'walk:claim': 'SUBMIT_STEPS',
  'dailysign:accept': 'CLAIM_DAILY_SIGN',
  /* 时段限定的开播提醒:玩家在前端点过订阅按钮,服务端才知道该不该给他推。
     以前这一条不在册,票面上的「已开启」只活在内存里。 */
  'timewindow:subscribe': 'SUBSCRIBE_TIME_WINDOW',
  'slowtask:slowstart': 'START_SLOW_TASK',
  'slowtask:slowclaim': 'CLAIM_SLOW_TASK',

  /* ===== 节点玩法模板那批(原型真源:模板编辑页 v2)=====
     ⚠️ 少一条不会报错,只是玩家做完那一下**什么也没发生**:
     组件抛了事件、页面查不到动作名就 return,没有请求、没有提示、没有日志。 */
  'coinflip:flip': 'FLIP_COIN',
  'diceroll:roll': 'ROLL_DICE',
  'estimate:submit': 'SUBMIT_ESTIMATE',
  'pricepair:submit': 'SUBMIT_PRICE_PAIR',
  /* R3 三个新玩法:动作名与后端 AdvancedGameRuntimeServiceImpl 的 switch 逐字对应 */
  'sort:submit': 'SUBMIT_SORT',
  'match:submit': 'SUBMIT_MATCH',
  'classify:submit': 'SUBMIT_CLASSIFY',
  'hidden:submit': 'SUBMIT_HIDDEN_OBJECT',
  'predict:submit': 'SUBMIT_PREDICT',
  /* 七个挑战类都要先开表(原来六个 + 喊一嗓子):服务端拿 START_CHALLENGE 那一刻的**服务器时间**复核成绩,
     不先发这一条,提交会被判成「还没开始」。设备时钟玩家改得动,所以不能只信客户端报的毫秒。 */
  'reaction:start': 'START_CHALLENGE',
  'ballshake:start': 'START_CHALLENGE',
  'quiethold:start': 'START_CHALLENGE',
  'shout:start': 'START_CHALLENGE',
  'countdown:start': 'START_CHALLENGE',
  'stopwatch:start': 'START_CHALLENGE',
  'reaction:submit': 'SUBMIT_REACTION',
  'ballshake:submit': 'SUBMIT_BALL_SHAKE',
  'quiethold:submit': 'SUBMIT_QUIET_HOLD',
  /* 罗盘指向不开表:它没有「用时」要按服务器时间复核 —— 服务端只复核报来的
     方位在不在容差内(防误发),所以做完那一下直接 SUBMIT_COMPASS 一步到位。 */
  'compass:submit': 'SUBMIT_COMPASS',
  'shout:submit': 'SUBMIT_SHOUT',
  'countdown:finish': 'SUBMIT_COUNTDOWN',
  'stopwatch:submit': 'SUBMIT_STOPWATCH',
  /* 抽卡:翻开那一下只是**请求**,抽到什么由服务端按权重定,客户端不挑内容;
     分支:选项 id 来自会话视图里的 currentStep(不是配置投影),走向也由服务端判。 */
  'random:draw': 'DRAW',
  'branch:choose': 'CHOOSE',
  /* 问答三种模式共一个动作,靠 payload 区分:打字给 input、选项给 optionId、拍照给 imageUrl。
     扫码那条带的是**码**:进店只认扫码,GPS 可以伪造,所以服务端要真比对一次。 */
  'qa:submit': 'SUBMIT_QA',
  'scan:scanned': 'SUBMIT_SCAN',
  /* 《预制人生》四个新段。⚠️ photoCheck 不在这张表里(与 qa:shoot 同理):
     拍照是先传图拿地址、再只带地址提交的两步,页面里单独处理(_submitKitPhoto)。
     放进来会被当成一步直发,而组件手里只有一个出了这台手机不存在的临时路径。
     判定全在服务端,客户端不再上报任何分数(契约 §2.2)。 */
  'profile:submit': 'SUBMIT_PROFILE',
  'note:submit': 'SUBMIT_NOTE',
  /* 限时打字必须先开表:服务端拿 START_CHALLENGE 那一刻的服务器时间复核用时。
     不先发这一条,SUBMIT_TYPE_IN 会被判「还没开始」。 */
  'typein:start': 'START_CHALLENGE',
  'typein:submit': 'SUBMIT_TYPE_IN',
  /* ⚠️ 拍照问答(qa:shoot)**不在这张表里**:它得先把照片传上去拿到地址,
     再连地址一起提交 —— 那是两步,页面里单独处理(_submitQaPhoto)。
     放进来的话会被当成一步直接发出去,而组件手里只有一个出了这台手机就不存在的临时路径。 */
};

/** 百分比 → 比例,并夹回 [0,1]:越界的点本来就该被服务端拒,不在这儿伪装成合法值。 */
function ratioOf(percent) {
  const n = Number(percent);
  if (!isFinite(n)) return 0;
  return Math.min(1, Math.max(0, Number((n / 100).toFixed(4))));
}

/** 挑战类玩法 → START_CHALLENGE 的 game 值。服务端只认这七个驼峰名。 */
const CHALLENGE_GAME = {
  reaction: 'reaction',
  ballshake: 'ballShake',
  quiethold: 'quietHold',
  shout: 'shout',
  countdown: 'countdown',
  stopwatch: 'stopwatch',
  typein: 'typeIn',
};

function serverAction(type, action) {
  return ACTION_OF[type + ':' + action] || '';
}

/**
 * 组件抛上来的 detail → 服务端认的字段名。
 *
 * 这一层必须有:组件按玩家看到的东西命名(guess / heldSeconds / times),
 * 服务端按判定要用的东西命名(value / heldMs / roundsMs)。直接把 detail 当 payload 发,
 * 服务端读不到字段就按 0 判 —— **不报错**,只是永远不通过。
 */
function serverPayload(type, action, detail) {
  const d = detail || {};
  if (action === 'start') {
    const game = CHALLENGE_GAME[type];
    return game ? { game: game } : {};
  }
  switch (type + ':' + action) {
    case 'estimate:submit': return { value: d.guess };
    case 'pricepair:submit': return { pickId: d.pickId };
    /* R3 三个新玩法:组件报的就是服务端要的形状(order 序列 / [左,右] 对列表 / itemId→binId)。
       字段名一个都不能改:服务端读不到 order/pairs/placement 直接抛「请提交…」,
       而且那是提交失败,不是静默。 */
    case 'sort:submit': return { order: d.order || [] };
    case 'match:submit': return { pairs: d.pairs || [] };
    case 'classify:submit': return { placement: d.placement || {} };
    /* ★ 单位在这儿换:组件按**百分比**报(0–100,它的定位样式就是百分比),
       服务端按**比例**收(0–1,热区配置也是比例)。不换的话每一次点击都会被
       「点击位置必须是 0 到 1 之间的比例值」打回来,这个玩法整个玩不了。 */
    case 'hidden:submit': return { x: ratioOf(d.x), y: ratioOf(d.y) };
    case 'predict:submit': return { optionKey: d.key };
    case 'branch:choose': return { optionId: d.optionId };
    case 'qa:submit':
      // 打字题报 input,单选报 optionId,多选报 optionIds(数组)—— 组件按模式只给其中一个。
      // 服务端多选只认 optionIds,发 optionId 过去会被当单选读,且不报错。
      if (d.optionIds) return { optionIds: d.optionIds };
      return d.optionId ? { optionId: d.optionId } : { input: d.input };
    case 'scan:scanned': return { code: d.code };
    /* 《预制人生》四个新段:字段名逐条对契约 §2。
       typeIn 的 elapsedMs 是客户端按设备时钟量出来的,服务端会用开表时间复核。 */
    case 'profile:submit': return { answers: d.answers || {}, avatarUrl: d.avatarUrl || '' };
    case 'note:submit': return { text: d.text || '' };
    case 'typein:submit': return { text: d.text || '', elapsedMs: Math.round(d.elapsedMs || 0) };
    /* 接力签:留下的那句和可选照片。现网 CLAIM_DAILY_SIGN 还不消费这两字段,多带无害;
       后端接上之后不必再改小程序。 */ 
    case 'dailysign:accept': return { text: d.text || '', photoUrl: d.photoUrl || '' };
    // 抽卡不带参数:抽哪一件由服务端按权重定,客户端说了不算
    case 'random:draw': return {};
    case 'reaction:submit': return { roundsMs: d.times || [] };
    case 'ballshake:submit': return { hits: d.hits };
    // 组件按玩家读的单位报(秒),服务端按判定的单位收(毫秒)
    case 'quiethold:submit': return { heldMs: Math.round((d.heldSeconds || 0) * 1000) };
    // 罗盘:组件报「对准那一刻读到的方位角」,服务端拿它和配置目标绕 360 取最小差复核
    case 'compass:submit': return { bearing: Math.round(d.bearing || 0) };
    // 喊一嗓子:组件交的就是毫秒(内部按帧累计),这里只兜一层非数
    case 'shout:submit': return { heldMs: Math.round(d.heldMs || 0) };
    case 'stopwatch:submit': return { stoppedMs: d.elapsedMs };
    // 抛硬币 / 掷骰子 / 倒计时到点:结果由服务端算,客户端不带参数
    case 'coinflip:flip':
    case 'diceroll:roll':
    case 'countdown:finish': return {};
    default: return d;
  }
}

module.exports = { pickPlayKit, pickJourneyCheck, checkReceiptView, serverAction, serverPayload, secondsUntilOpen, KIT_PRIORITY, presentOf, dailySignRevealState, applyStoryVars };
