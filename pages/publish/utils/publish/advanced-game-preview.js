/**
 * utils/publish/advanced-game-preview.js —— 商家配置 → 一个可渲染的玩法 kit(纯函数,可单测)
 *
 * 对应原型「模板编辑页 v2」里的 applyUserCfg:编辑页左边填的东西,右边试玩要**按它跑**。
 *
 * 为什么必须有这一层:预览如果永远演内置那份 demo,商家改一个字看不出任何变化 ——
 * 那不叫预览,叫广告片。原型里这一条是硬规则,反复被拿来验收。
 *
 * 与 utils/playkit-view.js 的分工:
 *   · playkit-view  = 服务端会话视图 → kit(玩家侧,真实开局)
 *   · 本文件        = 商家本地配置   → kit(商家侧,还没发布)
 * 两边喂给的是**同一批组件**,所以商家看到的就是玩家会看到的。
 *
 * ★ 一个例外要写明:秘密字段在这里是有的(商家自己填的答案),但它只走本地预览,
 *   不经过任何下发通道。玩家侧那条链路由 AdvancedGamePublicProjection 白名单把关。
 */

/* 优先级:一个节点理论上能同时开好几段,但预览一次只演一屏。
   先演「要玩家动手」的,再演展示型 —— 与 playkit-view 的排法同源。 */
const PREVIEW_PRIORITY = [
  'qa', 'branch', 'estimate', 'pricePair',
  /* R3 排序 / 连线 / 分类:与猜图同档的「要玩家动手」—— 预览先演它们 */
  'sort', 'match', 'classify',
  'hiddenObject', 'predict',
  /* 拍照审核 / 拍物成卡:要玩家当场拍,同属「要玩家动手」 */
  'photoCheck',
  'reaction', 'ballShake', 'quietHold', 'compass', 'shout', 'stopwatch', 'countdown', 'steps',
  'coinFlip', 'diceRoll', 'random', 'bingo', 'scan',
  /* 《预制人生》四段(2026-09-24 C-04 补):之前没有构造器,配齐了点「试玩」也只会说「还要再填一点」 */
  'profile', 'photoCheck', 'typeIn', 'note', 'album',
];

const txt = (v) => String(v == null ? '' : v).trim();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
/** 挪一位当「打乱」:两三行就把「题面顺序与答案无关」演出来。不用随机 —— 预览每次都得一样,
 *  否则商家核对不了自己填的文案。 */
const rotateOne = (list) => (list.length > 1 ? list.slice(1).concat(list.slice(0, 1)) : list);

/** 商家没填就别拿 demo 顶上去 —— 自己的标题配着内置示例,看着就是「预览没理我」。
 *  空位反而说清楚了:这儿还没填。 */
const orBlank = (v) => txt(v);

/* 每段一个转换器。键名 = 配置段名,返回 cy-playkit 认的 kit 对象。 */
const BUILDERS = {
  album: c => c.images && c.images.length ? ({ type: 'album', images: c.images.map(image => ({url: image.url, line: image.line || ''})) }) : null,
  coinFlip: (c) => ({
    type: 'coinflip',
    kicker: orBlank(c.kicker) || '抛一次,认结果',
    headsLabel: orBlank(c.heads && c.heads.label) || '正面',
    headsAction: orBlank(c.heads && c.heads.action),
    tailsLabel: orBlank(c.tails && c.tails.label) || '反面',
    tailsAction: orBlank(c.tails && c.tails.action),
    // 预览里给一个固定结果:随机的话商家每次点开看到的不一样,没法核对文案
    face: 'HEADS',
  }),
  diceRoll: (c) => c.mode === 'd20' ? ({
    type: 'diceroll', mode: 'd20', kicker: orBlank(c.kicker) || 'D20 检定',
    dc: num(c.dc, 10), modifier: num(c.modifier, 0), rollMode: c.rollMode || 'normal',
    successText: orBlank(c.successText), failText: orBlank(c.failText), result: null,
    preview: true,
  }) : ({
    type: 'diceroll',
    kicker: orBlank(c.kicker) || '掷到几就做第几件事',
    faces: Array.isArray(c.faces) ? c.faces.map(orBlank) : [],
    // 一颗演第 5 面,两颗演 5+4 —— 固定值,理由同上
    values: num(c.diceCount, 1) === 2 ? [5, 4] : [5],
  }),
  reaction: (c) => ({
    type: 'reaction',
    kicker: orBlank(c.kicker) || '变绿就点',
    rounds: num(c.rounds, 3),
    goalMs: num(c.goalMs, 320),
  }),
  ballShake: (c) => ({
    type: 'ballshake',
    kicker: orBlank(c.kicker) || '撞够 30 次',
    goal: num(c.goal, 30),
    timed: !!c.timed,
    seconds: num(c.seconds, 12),
  }),
  quietHold: (c) => ({
    type: 'quiethold',
    kicker: orBlank(c.kicker) || '别出声',
    sub: orBlank(c.sub),
    seconds: num(c.seconds, 15),
  }),
  /* 罗盘:商家填的目标方位就是题面(玩家得先知道往哪转),预览照演。
     done 恒 false:预览不是玩家,不该演出「已完成」那张脸。 */
  compass: (c) => ({
    type: 'compass',
    kicker: orBlank(c.kicker) || '把手机转向目标方向',
    bearing: num(c.bearing, 0),
    tolerance: num(c.tolerance, 15),
    holdSeconds: num(c.holdSeconds, 3),
    hint: orBlank(c.hint),
    done: false,
  }),
  /* 喊一嗓子:quietHold 的反面。预览演的是待机那一屏(数字=要喊满的秒数),
     阈值现场校准是玩家开局的事,预览不代演校准。 */
  shout: (c) => ({
    type: 'shout',
    kicker: orBlank(c.kicker) || '喊出来',
    seconds: num(c.seconds, 5),
  }),
  countdown: (c) => ({
    type: 'countdown',
    kicker: orBlank(c.kicker) || '倒计时',
    seconds: num(c.seconds, 90),
    doneText: orBlank(c.doneText),
  }),
  stopwatch: (c) => ({
    type: 'stopwatch',
    kicker: orBlank(c.kicker) || '把手机拿到面前,随时可以开始',
    targetSeconds: num(c.targetSeconds, 10),
    toleranceMs: num(c.toleranceMs, 300),
    tries: num(c.tries, 0),
  }),
  estimate: (c) => ({
    type: 'estimate',
    title: orBlank(c.title),
    unit: orBlank(c.unit),
    /* 滚筒的量程走 min/max —— 那两个字段本来就是为这件事存在的。
       拿 answer 推量程会把答案暗示出去,那正是投影要防的事。 */
    min: num(c.min, 0),
    max: num(c.max, 1000),
    limitSeconds: 0,
    maxTries: 0,
  }),
  pricePair: (c) => ({
    type: 'pricepair',
    title: orBlank(c.title),
    items: (Array.isArray(c.items) ? c.items : []).map((it, i) => ({
      id: it.id || ('i' + i), name: orBlank(it.name), imageUrl: orBlank(it.imageUrl),
    })),
    // 预览里也不带 correct:商家看的是玩家看到的那一屏
    maxTries: num(c.maxTries, 0),
  }),
  /* R3 排序:题面给、answerOrder 一个不给 —— 与玩家侧同一条规矩(投影也不下发它)。
     预览里也把顺序挪一位:玩家的题面顺序与答案无关,照配置原样演会让人以为
     「我填的顺序就是题面顺序」,而那正是服务端要洗掉的东西。 */
  sort: (c) => ({
    type: 'sort',
    prompt: orBlank(c.prompt),
    items: rotateOne((Array.isArray(c.items) ? c.items : []).map((it, i) => ({
      id: it.id || ('i' + i), label: orBlank(it.label), img: orBlank(it.img),
    }))),
    maxAttempts: num(c.maxAttempts, 0),
    attempts: 0, finished: false, passed: false, lastCorrect: false,
  }),
  /* R3 连线:左右两组给(右侧同样挪一位),pairs 一个不给。 */
  match: (c) => ({
    type: 'match',
    prompt: orBlank(c.prompt),
    left: (Array.isArray(c.left) ? c.left : []).map((it, i) => ({
      id: it.id || ('l' + i), label: orBlank(it.label),
    })),
    right: rotateOne((Array.isArray(c.right) ? c.right : []).map((it, i) => ({
      id: it.id || ('r' + i), label: orBlank(it.label),
    }))),
    attempts: 0, passed: false, lastCorrect: false,
  }),
  /* R3 分类:分类箱与卡片给,answer(每张进哪个箱)一个不给。 */
  classify: (c) => ({
    type: 'classify',
    prompt: orBlank(c.prompt),
    bins: (Array.isArray(c.bins) ? c.bins : []).map((it, i) => ({
      id: it.id || ('b' + i), label: orBlank(it.label),
    })),
    items: (Array.isArray(c.items) ? c.items : []).map((it, i) => ({
      id: it.id || ('i' + i), label: orBlank(it.label),
    })),
    attempts: 0, passed: false, lastCorrect: false,
  }),
  hiddenObject: (c) => ({
    type: 'hidden',
    title: orBlank(c.title),
    imageUrl: orBlank(c.imageUrl),
    // ★ 只带 label,不带坐标 —— 与玩家侧同一条规矩:坐标是这个玩法唯一的防线
    targets: (Array.isArray(c.hotspots) ? c.hotspots : []).map((h, i) => ({
      id: h.id || ('t' + i), label: orBlank(h.label),
    })),
    total: (Array.isArray(c.hotspots) ? c.hotspots : []).length,
    maxTries: num(c.maxTries, 0),
  }),
  predict: (c) => ({
    type: 'predict',
    question: orBlank(c.question),
    hint: orBlank(c.hint),
    options: (Array.isArray(c.options) ? c.options : []).map((o, i) => ({
      key: o.key || ('k' + i), label: orBlank(o.label),
      // 卡上那行小字。商家没写就不出 —— 转盘上多一行空位比少一行更显眼
      meta: orBlank(o.meta),
    })),
    /* 预览必须拿商家真配的那个小时 —— 写死一个值会让预览说出玩家看不到的话。
       归一口径与 playkit-view.js 的 predict 分支逐字一致:非整点一律 -1(kit 那边就不写这行字),
       别用 num() —— Number(null) 是 0,会把空值说成「今天 00:00 截止」。 */
    closeAtHour: Number.isInteger(c.closeAtHour) ? c.closeAtHour : -1,
    revealDays: Number.isInteger(c.revealDays) ? c.revealDays : -1,
    revealHour: Number.isInteger(c.revealHour) ? c.revealHour : -1,
  }),
  /* 九宫格:九个格子和两档奖励**配在主题上**,不在这个节点里(编辑页那张信息卡已经写明)。
     所以这一屏没有「商家填的内容」可演,它演的是**这个玩法长什么样**:
     一副示例棋盘 + 连成一条线的那三格。
     ⚠️ 早先 bingo 在 PREVIEW_PRIORITY 里、BUILDERS 里却没有它 —— 于是喂不到 cellSpecs,
     格子全走组件默认的黑白,连线那三格的粉色永远出不来(实测:预览里整屏黑白)。 */
  bingo: () => ({
    type: 'bingo',
    title: '这周的九宫格',
    cellSpecs: [
      { t: '老张咖啡', how: '扫码到店' }, { t: '猜豆子数量', how: '估数题' },
      { t: '巷口书店', how: '扫码到店' }, { t: '哪杯最贵', how: '比价连击' },
      { t: '找三只猫', how: '找东西' }, { t: '今日销冠', how: '竞猜转盘' },
      { t: '深夜面馆', how: '扫码到店' }, { t: '开一张卡', how: '抽卡' },
      { t: '街角花店', how: '扫码到店' },
    ],
    // 第一行连成线 —— 粉色那三格就是靠它出来的
    filledPositions: [0, 1, 2, 4],
    /* ⚠️ 只写奖品本身,别带「连成一条线 ·」「九格全亮 ·」——
       那两个前缀是 kit 自己拼的(见 playkit-bingo 的 ribbon),
       这儿再写一遍会出「连成一条线 · 连成一条线 · 第二杯半价」。 */
    lineReward: '第二杯半价',
    fullReward: '送一份甜点',
  }),

  random: (c) => ({
    type: 'random',
    deckName: orBlank(c.deckName),
    cards: (Array.isArray(c.items) ? c.items : []).map((it, i) => ({
      id: it.id || ('c' + i), title: orBlank(it.label), body: orBlank(it.content),
    })),
  }),
  /* 计步。预览里给一个「还差一点」的中间态:
     设目标那一屏看不出这玩法长什么样,走完那一屏又看不出还在走。 */
  steps: (c) => ({
    type: 'walk',
    goal: num(c.goal, 6000),
    steps: Math.round(num(c.goal, 6000) * 0.71),
    syncing: false,
  }),
  /* 问答三种模式共一段。预览演的是玩家看到的那一屏,所以答案与选项反馈都不带 ——
     商家要核对的是「屏上长这样」,不是「答案对不对」,那在配置里他自己写的。 */
  qa: (c) => ({
    type: 'qa',
    mode: ({ TYPE: 'type', PICK: 'pick', SHOT: 'shot' })[c.mode] || 'type',
    theme: 'dark',
    title: orBlank(c.title),
    lead: orBlank(c.lead),
    imageUrl: orBlank(c.imageUrl),
    audioUrl: orBlank(c.audioUrl),
    options: (Array.isArray(c.options) ? c.options : []).map((o) => ({ t: orBlank(o.label) })),
    // 多选标记照配置带过去:预览要演的就是「勾多个再提交」那一屏
    multi: !!c.multi,
    shotLead: orBlank(c.lead) || orBlank(c.title),
    shotNote: orBlank(c.shotNote),
    limitSeconds: 0,
    maxTries: num(c.maxTries, 0),
  }),
  /* 扫码:预览直接演「扫完之后」那一屏 —— 商家要核的就是那句回复长什么样。
     真链路里回复要扫完才下发,预览没有下发通道,不冲突。 */
  scan: (c) => ({
    type: 'scan',
    kind: ({ TEXT: '文字', VOICE: '语音', IMAGE: '图片' })[c.kind] || '文字',
    reply: orBlank(c.reply),
    audioUrl: orBlank(c.audioUrl),
    imageUrl: orBlank(c.imageUrl),
  }),
  /* 这四个的字段与玩家页 playkit-view 的 buildProfile / buildPhotoCheck / buildTypeIn / buildNote
     一一对应(分包之间不能同步 require,只能各写一份;字段由 publish-preview-kit-contract 对拍)。
     状态类字段一律给「还没玩」的初值 —— 试玩演的是开局那一屏。 */
  profile: (c) => ({
    type: 'profile', title: txt(c.title), lead: txt(c.lead), avatar: c.avatar || {},
    questions: Array.isArray(c.questions) ? c.questions : [], answers: {}, avatarUrl: '', done: false,
  }),
  photoCheck: (c) => ({
    type: 'photocheck', title: txt(c.title), shotNote: txt(c.shotNote),
    maxTries: num(c.maxTries, 0), fallback: txt(c.fallback) || 'retake',
    tries: 0, passed: false, flagged: false, degraded: false, lastReason: '', lastUrl: '',
    frameUrl: txt(c.frameUrl), frameOpacity: Math.max(0, Math.min(100, num(c.frameOpacity, 40))),
    mode: txt(c.mode), cardTitle: txt(c.cardTitle), cardStyle: txt(c.cardStyle) || 'foil',
    card: null, place: '', photoFailSeq: 0,
    // 试玩没有真实会话，快门只提示，不拍照或提交判定。
    preview: true, limitSeconds: 0,
  }),
  typeIn: (c) => ({
    type: 'typein', title: txt(c.title), target: txt(c.target), seconds: num(c.seconds, 0),
    caseSensitive: !!c.caseSensitive, tries: num(c.tries, 0), attempts: 0, passed: false,
  }),
  note: (c) => ({
    type: 'note', title: txt(c.title), prompt: txt(c.prompt), maxLength: num(c.maxLength, 40) || 40,
    presets: Array.isArray(c.presets) ? c.presets : [], previous: [], mine: '', done: false,
  }),
  branch: (c) => {
    const step = (Array.isArray(c.steps) ? c.steps : [])[0] || {};
    return {
      type: 'branch',
      title: orBlank(c.title) || orBlank(step.title),
      body: orBlank(step.body),
      options: (Array.isArray(step.options) ? step.options : []).map((o) => ({
        t: orBlank(o.label), fb: orBlank(o.feedback), end: orBlank(o.outcomeLabel),
      })),
      limitSeconds: 0,
    };
  },
};

/**
 * 从整份配置里挑出该演的那一段,转成 kit。都没开就返回 null ——
 * 调用方据此回落到基础验证那套预览,而不是画一屏空的。
 */
function buildPreviewKit(config, opts) {
  if (!config || typeof config !== 'object') return null;
  const o = opts || {};
  for (const key of PREVIEW_PRIORITY) {
    const seg = config[key];
    if (!seg || !seg.enabled || !BUILDERS[key]) continue;
    const kit = BUILDERS[key](seg);
    if (!kit) continue;
    if (key === 'album') kit.title = txt(o.title) || '相册';
    /* 通用的限时 / 次数是**另一段**(timer),不是各玩法自己的 ——
       原型里这两个开关只给真的会执行的玩法,所以由调用方按玩法决定要不要带。 */
    if (o.limitSeconds > 0 && kit.limitSeconds === 0) kit.limitSeconds = o.limitSeconds;
    if (o.maxTries > 0 && kit.maxTries === 0) kit.maxTries = o.maxTries;
    return kit;
  }
  return null;
}

/** 这份配置有没有开任何一个高级玩法。预览要据此决定演哪一套。 */
function hasPreviewKit(config) {
  return !!buildPreviewKit(config);
}

// 仅供作者本地试玩；固定骰点方便核对当前文案，不写入任何玩家会话。
function previewD20Result(kit) {
  const values = kit.rollMode === 'normal' ? [12] : [12, 7];
  const kept = kit.rollMode === 'disadvantage' ? Math.min(...values) : Math.max(...values);
  const total = kept + kit.modifier;
  const success = total >= kit.dc;
  return { values, kept, total, success, text: success ? kit.successText : kit.failText };
}

/* 有的玩法**没有节点级配置**(目前只有九宫格:九格与两档奖励配在主题上,见编辑页那张信息卡),
   于是 buildPreviewKit 永远返回 null —— 商家点「预览」只会吃到一句
   「这个玩法要先配一点内容才能试玩」,看不到这玩法长什么样。
   这一条给它们一副**范例屏**:演的是玩法形态,不是商家的配置,所以不会有「预览没理我」的问题。 */
function buildSampleKit(gameKey) {
  const make = BUILDERS[gameKey];
  return make ? make({}) : null;
}

module.exports = {
  previewD20Result,
  buildSampleKit, buildPreviewKit, hasPreviewKit, PREVIEW_PRIORITY, _builders: BUILDERS };
