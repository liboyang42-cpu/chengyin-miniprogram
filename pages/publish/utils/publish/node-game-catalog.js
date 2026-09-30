/* 节点玩法目录 —— 真源是交互原型「模板编辑页 v2」里的 GROUPS(scratchpad/editor.html 第 982 行起)。
 *
 * 一个节点选择一个主玩法，可再添加可叠加玩法。选择器统一展示，
 * 主玩法互斥；可叠加玩法独立开关，不改变主玩法与完成方式。
 *
 * ⚠️ `section` 必须是 advanced-game-config.js 的段名,`validationMethod` 决定节点
 *    怎么算通关(老链路仍在用)。两者任一写错,玩法会静默配不上或通关判错。
 */

const advancedGameConfig = require('./advanced-game-config.js');

const GROUPS = [
  {
    title: '问答类',
    items: [
      { key: 'qaText', icon: 'edit', label: '文字问答', sub: '出一道题,玩家打字作答', section: 'qa', mode: 'TYPE', validationMethod: 1 },
      { key: 'qaPick', icon: 'check', label: '选项问答', sub: '2-4 个选项里选一个 · 闭眼盲品也是这套', section: 'qa', mode: 'PICK', validationMethod: 3 },
      { key: 'qaShot', icon: 'camera', label: '拍照打卡', sub: '给一句提示词,玩家拍一张交上来', section: 'qa', mode: 'SHOT', validationMethod: 2 },
      { key: 'branch', icon: 'switch-chapter', label: '分支剧情', sub: '界面和问答一样,只是选项决定下一段', section: 'branch', validationMethod: 0 },
    ],
  },
  {
    /* 推理类(2026-09-16):三种都是「有唯一正确答案」的题面,答案一律不下发 ——
       排序的 answerOrder / 连线的 pairs / 分类的 answer 都只存在服务端。 */
    title: '推理类',
    items: [
      { key: 'sort', icon: 'list', label: '排序', sub: '把几条按正确顺序排好', section: 'sort', validationMethod: 0 },
      { key: 'match', icon: 'route', label: '连线', sub: '两列里一一配对', section: 'match', validationMethod: 0 },
      { key: 'classify', icon: 'filter', label: '分类', sub: '每条归到对的那一类', section: 'classify', validationMethod: 0 },
    ],
  },
  {
    title: '互动类',
    items: [
      { key: 'estimate', icon: 'finance', label: '猜数字', sub: '猜一个数,按接近程度分档给分', section: 'estimate', validationMethod: 8 },
      { key: 'pricePair', icon: 'image', label: '猜图', sub: '几张图里挑出正确的那张', section: 'pricePair', validationMethod: 9 },
      { key: 'hidden', icon: 'search', label: '找东西', sub: '在你上传的图上点中藏起来的目标', section: 'hiddenObject', validationMethod: 10 },
      { key: 'predict', icon: 'flag', label: '竞猜', sub: '今天押一个,到期商家给答案', section: 'predict', validationMethod: 0 },
      { key: 'random', icon: 'gift', label: '抽卡', sub: '一副卡池抽一张,翻开就是这一关的任务', section: 'random', validationMethod: 0 },
      /* 《预制人生》两段(契约 §2.1 / §2.4)。问答式交互,但结果都写进会话状态:
         建档写角色档案(后面的故事能引用),留言写给下一个来的人。 */
      { key: 'profile', icon: 'edit', label: '角色建档', sub: '出生登记:问几个问题,写进角色档案', section: 'profile', validationMethod: 0 },
      { key: 'album', icon: 'image', label: '相册', sub: '上传照片，翻阅一段回忆', section: 'album', validationMethod: 0 },
      { key: 'note', icon: 'edit', label: '留言', sub: '写一句话,留给下一个来这里的人', section: 'note', validationMethod: 0 },
      /* 拍物成卡(立体藏品卡契约 §2.1):与「拍照审核」共用 photoCheck 段,靠 mode 区分。
         ★ 它必须排在「挑战类」那条 photoCheck **前面** —— detectGame 取第一个 section.enabled
         的条目,而 photoCheck 那条不带 mode(它要能匹配没有 mode 的老配置)。顺序一反,
         藏品卡会被抢先认成普通拍照审核,而且不报错。钉在 object-card-detect-contract。 */
      { key: 'objectCard', icon: 'camera', label: '拍物成卡', sub: '拍下一件东西,生成一张能转着看的藏品卡', section: 'photoCheck', mode: 'CARD', validationMethod: 0 },
      /* 九宫格是主题级的:格子和奖励在主题上配,节点这里零输入(见 b84ef6381)。
         原型把它也摆在这张单子里,所以保留入口,但配置面板只说明它在哪儿配。 */
      { key: 'bingo', icon: 'filter', label: '九宫格', sub: '走到一处点亮一格,连成线就换奖', section: '', badge: '主题级', validationMethod: 0 },
    ],
  },
  {
    title: '挑战类',
    items: [
      { key: 'steps', icon: 'walk', label: '计步挑战', sub: '以微信运动同步的步数为准', section: 'steps', validationMethod: 0 },
      { key: 'react', icon: 'star', label: '变色就点', sub: '屏幕一变色就点,比谁快', section: 'reaction', validationMethod: 0 },
      { key: 'shake', icon: 'play', label: '弹球', sub: '倾斜手机,让球撞够手机边缘的次数', section: 'ballShake', validationMethod: 0 },
      { key: 'quiet', icon: 'heart', label: '安静挑战', sub: '一直安静到时间到,响一下从头再来', section: 'quietHold', validationMethod: 0 },
      { key: 'compass', icon: 'route', label: '罗盘指向', sub: '把手机转向目标方位,对准保持几秒', section: 'compass', validationMethod: 0 },
      { key: 'shout', icon: 'bell', label: '喊一嗓子', sub: '让这儿的声音够大,连续喊满几秒', section: 'shout', validationMethod: 0 },
      { key: 'countdown', icon: 'clock', label: '倒计时', sub: '一钟油,时间走它就退', section: 'countdown', validationMethod: 0 },
      { key: 'stopwatch', icon: 'clock', label: '精准停表', sub: '盲停在目标秒数上,差多少算多少', section: 'stopwatch', validationMethod: 0 },
      /* 《预制人生》三段(契约 §2.2 / §2.5)+ R14 检定(契约 §2.3 更正:不新造段,
         接的是 master 上既有的 check)。判定一律在服务端。 */
      { key: 'photoCheck', icon: 'camera', label: '拍照审核', sub: '拍一张，写清要拍到什么，提交后等待判定', section: 'photoCheck', validationMethod: 0 },
      { key: 'check', icon: 'star', label: '技能检定', sub: '三档难度 + 成功失败各配结果', section: 'check', validationMethod: 0 },
      { key: 'd20', icon: 'star', label: 'D20 检定', sub: '二十面骰 + 加值，对照 DC 判定结果', section: 'diceRoll', mode: 'd20', validationMethod: 0 },
      { key: 'typeIn', icon: 'clock', label: '限时打字', sub: '照着一行字打,超时或打错不算', section: 'typeIn', validationMethod: 0 },
    ],
  },
  {
    title: '决定类',
    items: [
      { key: 'coin', icon: 'coupon', label: '抛硬币', sub: '正反面各配一句,抛完照做', section: 'coinFlip', validationMethod: 0 },
      { key: 'dice', icon: 'more', label: '掷骰子', sub: '掷到几就做第几件事', section: 'diceRoll', mode: 'd6', validationMethod: 0 },
    ],
  },
  {
    title: '营销类',
    items: [
      { key: 'scan', icon: 'qr-scan', label: '扫码参与', sub: '扫完立刻回一条 —— 文字 / 语音 / 图片', section: 'scan', validationMethod: 4 },
    ],
  },
];

const MODIFIERS = [
  { key: 'timer', label: '限时挑战', icon: 'clock', sub: '按活动统一时间计时，超时后不能完成', group: '挑战类', modifier: true, badge: '可叠加' },
  { key: 'leaderboard', label: '排行榜', icon: 'list', sub: '按时间、得分或完成轮数排名', group: '互动类', modifier: true, badge: '可叠加' },
  { key: 'multiplayer', label: '多人协作', icon: 'list', sub: '按角色和轮次共同完成任务', group: '互动类', modifier: true, badge: '可叠加' },
  { key: 'timeWindow', label: '时段限定', icon: 'clock', sub: '只在开放时段内允许开局', group: '挑战类', modifier: true, badge: '可叠加' },
  { key: 'blindTaste', label: '闭眼盲品', icon: 'check', sub: '尝一口再从选项里猜', group: '问答类', modifier: true, badge: '可叠加' },
  { key: 'silentOrder', label: '沉默点单', icon: 'edit', sub: '全程不说话，商家扫码核销', group: '互动类', modifier: true, badge: '可叠加' },
  { key: 'diyName', label: '作品命名', icon: 'edit', sub: '给作品取名，提交后审核', group: '互动类', modifier: true, badge: '可叠加' },
  { key: 'musicCorner', label: '治愈音乐角', icon: 'play', sub: '播放背景音乐，不影响通关', group: '互动类', modifier: true, badge: '可叠加' },
  { key: 'dailySign', label: '今日城市签', icon: 'edit', sub: '接过上一位来访者留下的城市签', group: '互动类', modifier: true, badge: '可叠加' },
  { key: 'slowTask', label: '跨日慢任务', icon: 'clock', sub: '隔天回来，继续这一段发现', group: '挑战类', modifier: true, badge: '可叠加' },
];
const PICKER_GROUPS = GROUPS.map(group => ({
  title: group.title,
  items: group.items.concat(MODIFIERS.filter(item => item.group === group.title)),
}));

const ALL = GROUPS.reduce((acc, group) => acc.concat(group.items), []);

/* 会真的执行「限时」的玩法。施工文档 §1.4:限时/限次只给真的会执行的玩法 ——
   给一个不会执行的开关,比不给更坏:商家以为设了,玩家那边什么也没发生。
   计步(要几天)、竞猜(答案第二天才有)、抽卡/硬币/骰子(一下就完)、
   扫码(扫完即结束)、九宫格(主题级)都没有可限的东西。 */
const TIMED_GAMES = ['qaText', 'qaPick', 'qaShot', 'branch', 'estimate', 'pricePair', 'hidden',
  'react', 'shake', 'quiet', 'compass', 'countdown', 'stopwatch',
  'react', 'shake', 'quiet', 'shout', 'countdown', 'stopwatch',
  'sort', 'match', 'classify'];

/** 这个玩法支不支持限时。没选玩法时返回 true(旧模板那条老链路照旧)。 */
function supportsTimer(key) {
  if (!key) return true;
  return TIMED_GAMES.indexOf(key) >= 0;
}

/* ★ 不走 playKit 通道的段:配置得出来,但服务端不把它投影进 playKit。
   check(R14 技能检定)是唯一一个 —— 它走 Encounter:PlayEncounterServiceImpl.allowedActions()
   在节点旅程块 check.enabled 为真时单独把 'check' 追加进 enc.actions,题面在 enc.check,
   判定走 /api/play/check/roll|reroll|settle。所以它不在 PLAYABLE_SECTIONS 里,
   pickPlayKit 也永远还不出它的 kit —— 那是对的,不是漏接线。
   ⚠️ 这张表是「豁免名单」,只许放确实走别的通道的段。往里加一个不走别的通道的段,
   就等于把「玩法静默消失」那条门禁对它关掉了。 */
const ENCOUNTER_SECTIONS = ['check']

/** 所有被玩法目录占用的段名(去重)。选一个玩法 = 关掉其余这些段。 */
const GAME_SECTIONS = ALL.map((item) => item.section).filter(Boolean)
  .filter((name, index, list) => list.indexOf(name) === index);

/** 同一段里靠 mode 分玩法的那些段(qa 三条 / photoCheck 两条)。
 *  applyToConfig 按这张表决定「换玩法时要不要动 mode」。 */
const MODE_SECTIONS = ALL.filter((item) => item.mode).map((item) => item.section)
  .filter((name, index, list) => list.indexOf(name) === index);

/** 必须能被 pickPlayKit 还出 kit 的段 = 目录里除掉走别的通道的那些。 */
// 相册插入为 dream 展示块，不创建待通关节点；预览仍复用 cy-playkit。
const PLAYKIT_SECTIONS = GAME_SECTIONS.filter((name) => name !== 'album' && ENCOUNTER_SECTIONS.indexOf(name) < 0);

function findGame(key) {
  if (!key) return null;
  for (let i = 0; i < ALL.length; i += 1) {
    if (ALL[i].key === key) return ALL[i];
  }
  return null;
}

/**
 * 从已有的 advanced 配置反推当前选中的玩法。
 * 编辑一份旧模板时要靠它把槽位填回去 —— 认不出来就会显示成「没选玩法」,
 * 而下面的配置还在,人会以为东西丢了。
 */
function detectGame(advanced) {
  if (!advanced || typeof advanced !== 'object') return '';
  for (let i = 0; i < ALL.length; i += 1) {
    const item = ALL[i];
    if (!item.section) continue;
    const section = advanced[item.section];
    if (!section || !section.enabled) continue;
    if (item.mode && (section.mode || (item.section === 'diceRoll' ? 'd6' : '')) !== item.mode) continue;
    return item.key;
  }
  return '';
}


/* 先看再选用的样例内容。
 * 商家还没配任何东西就点「预览」时,拿默认配置直接造屏会是一片空白 —— 玩法本身
 * 没问题,是没东西可显示,但看的人只会以为这个玩法是坏的。这里给每个玩法一句样例,
 * 只在试玩那一瞬间用,不写回配置。 */
const DEMO = {
  qaText: { title: '这座桥建于哪一年?', answerText: '1937' },
  qaPick: { title: '石碑上的图案象征什么?', options: [
    { id: 'opt_1', label: '丰收', fb: '对了,是麦穗。', correct: true },
    { id: 'opt_2', label: '远航', fb: '再看看穗子。', correct: false },
  ] },
  /* 拍照这一屏:题干在上,大字是 lead(见 advanced-game-preview 的 shotLead)。
     两个给的是不同的话 —— 一句说要干什么,一句说怎么拍。 */
  qaShot: { title: '在这棵树下拍一张', lead: '和这棵古树合个影,把整棵树都框进去' },
  branch: { steps: [{
    id: 'start', title: '门口', body: '木门虚掩着,里面飘出咖啡味。推门的话铃会响,绕到后巷还有一扇小门。',
    terminal: false, outcomeCode: 'COMPLETED', outcomeLabel: '完成节点',
    options: [
      { key: 'A', label: '推门进去', feedback: '铃响了一声,老板抬头看你。', next: 'in' },
      { key: 'B', label: '绕到后巷', feedback: '后巷堆着刚烘好的豆子。', next: 'alley' },
    ],
  }] },
  estimate: { title: '这罐豆子有多少颗?', unit: '颗', answer: 480, min: 0, max: 1000, tolerance: 50, reveal: '一共 480 颗,老板数了两遍。' },
  pricePair: { title: '哪一张是这家店的老招牌?', items: [
    { id: 'pic_1', name: '木牌', imageUrl: '', correct: true },
    { id: 'pic_2', name: '霓虹灯', imageUrl: '', correct: false },
    { id: 'pic_3', name: '手写纸板', imageUrl: '', correct: false },
  ] },
  hidden: { title: '找到那只猫', hint: '它在窗台附近' },
  predict: { question: '明天中午哪种豆子卖得更多?', options: [{ key: 'A', label: '耶加雪菲' }, { key: 'B', label: '曼特宁' }] },
  random: { deckName: '今日线索卡', items: [
    { id: 'item_1', label: '线索卡', weight: 1, content: '去吧台问一句今天的手冲是什么。' },
    { id: 'item_2', label: '任务卡', weight: 1, content: '找到店里最旧的那样东西,拍下来。' },
    { id: 'item_3', label: '彩蛋卡', weight: 1, content: '跟店员说「今天的天气」,看他回你什么。' },
  ] },
  steps: { eyebrow: '低碳行动 · 今日步数', goal: 6000 },
  react: { kicker: '屏幕一变色就点' },
  shake: { kicker: '倾斜手机,让球撞够边缘' },
  quiet: { kicker: '安静挑战', sub: '一直安静到时间到' },
  compass: { kicker: '把手机转向钟楼', bearing: 135, hint: '它比你想的更靠右' },
  shout: { kicker: '一起喊,让这儿听见' },
  countdown: { kicker: '一钟油', doneText: '时间到。' },
  stopwatch: { kicker: '盲停在 10 秒' },
  coin: { kicker: '抛完照做', heads: { label: '正面', action: '这杯店家请' }, tails: { label: '反面', action: '你请下一杯' } },
  dice: { kicker: '掷到几就做第几件事', faces: ['和店员说句今天的天气', '换个位置坐', '点一杯没喝过的', '拍一张门口', '把杯子摆正', '写一句留言'] },
  d20: { kicker: '观察暗门', successText: '你发现了门后的线索', failText: '暂时没有发现，沿街继续寻找' },
  scan: { reply: '欢迎来到这家店,今天的手冲是耶加雪菲。' },
};

/**
 * 返回「假如选了它」的那份配置(新对象),用于先看再选的试玩。
 * 不改传进来的配置 —— 看完不该在真配置上留下痕迹。
 */
/**
 * 玩法不支持限时就把限时关掉(就地改,返回同一个对象)。换玩法和打开旧模板都走这里 ——
 * 开关会被 wx:if="{{timerAvailable}}" 藏起来,留着 enabled 就是作者看不见、关不掉,
 * 服务端却照样挂截止时间、到点判超时(validateTimer 不查玩法)。
 * 连带:编辑器配的放宽若因此失效(指向刚被关掉的段),前后端 validateRelax 都会拒存,
 * 而放宽区可能根本不显示 —— 作者删不掉。后台手配的(条件不同)不归编辑器管,原样留着。
 */
function dropStaleTimer(next, key) {
  if (next.timer && !supportsTimer(key)) next.timer.enabled = false;
  if (Array.isArray(next.variants)) next.variants = next.variants.filter((v) => !advancedGameConfig.isEditorVariant(v) || !advancedGameConfig.relaxError(v.relax, next));
  return next;
}

function applyToConfig(advanced, key, options) {
  const game = findGame(key);
  if (!game || !advanced || typeof advanced !== 'object') return null;
  const next = JSON.parse(JSON.stringify(advanced));
  GAME_SECTIONS.forEach((name) => {
    if (!next[name] || typeof next[name] !== 'object') return;
    next[name].enabled = Boolean(game.section && name === game.section);
  });
  /* mode 判别(qa 三条 / photoCheck 两条)必须整段重来:选中带 mode 的玩法就写进去,
     选中同段里**不带** mode 的那条(拍照审核)就把上一手留下的 mode 删掉。
     留着 'CARD' 的话,detectGame 会把人刚改的选择又认回成藏品卡 —— 改完保存,玩法没换。
     qa 那批三条都带 mode,行为与今天一致(永远重写)。 */
  if (MODE_SECTIONS.indexOf(game.section) >= 0 && next[game.section]) {
    if (game.mode) next[game.section].mode = game.mode;
    else delete next[game.section].mode;
  }
  /* 呈现方式(契约 §1.5)跟着玩法走:切到「只能全屏」的段时,之前选的 inline 不再成立 ——
     清掉它、由默认表接管。留着的话下一次保存会被服务端 validator 直接拒,而作者早已离开
     这个开关。⚠️ 这不是被禁的「静默改回 fullscreen」:那条说的是验证器收到 inline 不声不响
     改档;这里是「换玩法」这个作者动作本身带来的必然失效。 */
  if (next.present === 'inline' && advancedGameConfig.presentInlineLocked(game.section)) {
    delete next.present;
  }
  /* 一个玩法段都没启用(如选了主题级九宫格)时 present 没有意义,与 normalize 同口径清掉。 */
  if (!GAME_SECTIONS.some((name) => next[name] && next[name].enabled)) delete next.present;
  dropStaleTimer(next, key);
  /* 只有试玩用的那份才铺样例:空配置造出来是一片空白屏,看的人分不清「没配」和「坏了」。
     ⚠️ 真的选中一个玩法时不能铺 —— 那会把样例当成商家自己填的存进去。
     判据是「这个字段还是默认值吗」,商家动过的一个字都不覆盖。 */
  if (!options || !options.demo) return next;
  const demo = DEMO[key];
  const target = next[game.section];
  const pristine = advancedGameConfig.defaultConfig()[game.section] || {};
  if (demo && target) {
    Object.keys(demo).forEach((field) => {
      if (JSON.stringify(target[field]) !== JSON.stringify(pristine[field])) return;
      target[field] = JSON.parse(JSON.stringify(demo[field]));
    });
  }
  return next;
}

module.exports = { GROUPS, MODIFIERS, PICKER_GROUPS, ALL, GAME_SECTIONS, ENCOUNTER_SECTIONS, PLAYKIT_SECTIONS, TIMED_GAMES, supportsTimer, findGame, detectGame, applyToConfig, dropStaleTimer };
