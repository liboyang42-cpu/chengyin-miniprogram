const SCHEMA_VERSION = 1;

// 旧五段:与 validationMethod 正交的通用机制,任何玩法都能叠加。
const CORE_SECTIONS = ['timer', 'random', 'branch', 'leaderboard', 'multiplayer'];
// Figma 组件库 v5.1 新玩法(node 45:248)。与旧五段平级 —— 一个节点可以同时挂
// 时段限定 + 盲品,所以不是"一个 playkit 段带 type"的互斥形状。
// ⚠️ 这份名单必须与服务端 AdvancedGameConfigValidator 的段名一一对应,
//    少一个,那个玩法在本页读不出来也存不回去。
const KIT_SECTIONS = ['timeWindow', 'blindTaste', 'silentOrder', 'diyName',
  'musicCorner', 'steps', 'dailySign', 'slowTask'];
// 自由探索四玩法。前三个各自对应一个 validationMethod(估数 8 / 比价 9 / 找东西 10),
// 即"这一段决定这个节点怎么算通关";竞猜没有 validationMethod —— 它的答案在玩家提交时
// 还不存在,只能下注即通关、次日商家结算,所以它是纯附加段。
/* ★ qa / scan 2026-09-10 并入:此前它们走节点的 validationMethod 老链路,
   跟其余玩法不在同一套配置里,新做的那几屏在生产根本到不了。用户拍板放到同一个通道。 */
const PLAY_SECTIONS = ['estimate', 'pricePair', 'hiddenObject', 'predict', 'qa', 'scan'];
/* 决定类与挑战类(原型「模板编辑页 v2」+ 现场感契约的罗盘指向)。它们与上面几组平级,
   但有一点不同:**秘密不在配置里** —— 硬币朝哪面、骰子几点、每轮等多久,
   都是运行时由服务端现生成的,所以整段可下发。
   ⚠️ 段名与服务端 AdvancedGameConfigValidator 一一对应,少一个那个玩法
   在本页读不出来也存不回去,而且**不报错**。 */
const DECIDE_SECTIONS = ['coinFlip', 'diceRoll', 'reaction', 'ballShake',
  'quietHold', 'compass', 'shout', 'countdown', 'stopwatch'];
/* 《预制人生》四段新 kit + 1 段既有段(施工契约 2026-09-17 §2:建档 / 拍照审核 /
   留言 / 限时打字 + R14 检定)。
   段名同样必须与服务端 AdvancedGameConfigValidator 一一对应,少一个那个玩法
   在本页读不出来也存不回去,而且**不报错**。
   ⚠️ check 不是本轮新造的段 —— master 上已有一套 R14 旅程检定(同名字段真源 =
   AdvancedGameConfigValidator#validateCheck),本轮只是把它接进本页编辑器。
   所以这里只认它的既有形状,**不许改它的字段名**。 */
const STORY_SECTIONS = ['album', 'profile', 'photoCheck', 'check', 'note', 'typeIn'];
/* 推理类三玩法(2026-09-16)。三种都**有唯一正确答案**,所以每段都有一个答案字段:
   排序 answerOrder / 连线 pairs / 分类 answer —— 服务端投影一律剥掉,不下发给玩家。
   ⚠️ 段名与服务端 AdvancedGameConfigValidator 一一对应。 */
const INFERENCE_SECTIONS = ['sort', 'match', 'classify'];
const SECTIONS = CORE_SECTIONS.concat(KIT_SECTIONS).concat(PLAY_SECTIONS)
  .concat(DECIDE_SECTIONS).concat(STORY_SECTIONS).concat(INFERENCE_SECTIONS);

/** 找东西的判定半径:系统定,商家不填。服务端只收 0.03–0.15,取中间值。 */
const HOTSPOT_RADIUS = 0.08;

const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PROFILE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,15}$/;
const PHOTO_CHECK_FALLBACKS = ['retake', 'pass'];
/* 拍物成卡(立体藏品卡契约 §2.1):与拍照审核共用 photoCheck 段,靠 mode 分玩法。
   空 mode = 老的拍照审核,行为逐字不变;'CARD' = 判过之后把那张照片铸成藏品卡。
   ⚠️ 这三份名单是后端 AdvancedGameConfigValidator 的镜像(PHOTO_CHECK_MODES /
   PHOTO_CARD_STYLES),必须同一个 PR 改 —— 两边错开的表现是「本地放行、服务端整份判死」。
   钉在 object-card-config-contract。 */
const PHOTO_CHECK_MODES = ['CARD'];
const PHOTO_CARD_STYLES = ['foil', 'plain'];
/** 段里属于「卡片」的那三个字段:目录的 mode 判别 + 卡名 + 样式。投影链按这张表核对。 */
const PHOTO_CARD_FIELDS = ['mode', 'cardTitle', 'cardStyle'];
/* —— 具名状态键 / 效果,真源是 master 的 AdvancedGameConfigValidator(§2.1 契约更正):
   变量名必须带前缀(clue. / relation. / counter.),点号后小写字母开头;
   创作者效果里唯一放行的保留变量是 sys.luck,只许 INC 1–3。**别放宽这两条正则**。 */
const EFFECT_VAR_PATTERN = /^(clue|relation|counter)\.[a-z][a-z0-9_]{0,47}$/;
const EFFECT_TAG_PATTERN = /^tag\.[a-z][a-z0-9_]{0,47}$/;
const EFFECT_OPS = ['SET', 'INC', 'ADD_TAG'];
const MAX_EFFECTS = 16;
const MIN_EFFECT_VALUE = -99;
const MAX_EFFECT_VALUE = 99;
const SYS_LUCK_VAR = 'sys.luck';
// R14 检定只有三档难度(禁止任意 DC 数字 —— 那是产品能调的档,不是商家填的数)
const CHECK_TIERS = ['easy', 'medium', 'hard'];
const CHECK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/* ===== 呈现方式(施工契约 §1.5,2026-09-18 拍板改判)=====
   present 住配置**根层**,取值 inline / fullscreen;不配 = 按下表默认。
   玩法长在哪里由作者选,不由 kit 类型定死。
   ⚠️ 这里这张表是**编辑器侧的镜像**,只用于默认选中与置灰;运行期默认表的唯一实现在服务端
   (AdvancedGameConfigValidator#resolvePresent,会话视图与公开投影同源),客户端不重推。 */
const PRESENT_VALUES = ['inline', 'fullscreen'];
/** 可内嵌、默认内嵌:选项类与问答类(用户点名的那批)。
    ⚠️ blindTaste 2026-09-24 撤出:它的组件外壳是 cy-sheet(半屏弹层,稿在 Figma v5.1 node 46:259,
    蒙眼猫是「闭眼」规则的唯一图示)。半屏靠 position:fixed 贴视口,而内嵌要把它放进
    `.chfull__para` —— 那个段落恒带 transform + filter(值永远是数字、不是 none),
    非 none 就是 fixed 后代的**包含块**,弹层会被圈进 190rpx 的段落里跟着缩放和模糊
    (同 2026-09-22 photoCheck 取景层踩的坑)。**声明了一件它做不到的事,所以撤声明,不改组件。**
    生产 0 个模板在用它,撤这个默认不影响存量。 */
const PRESENT_INLINE_DEFAULT = ['qa', 'branch', 'predict', 'pricePair', 'random'];
/** 只能全屏:判定依赖整屏几何或设备能力,配 inline 直接拒(服务端 validator 也拒,不许静默改回)。 */
const PRESENT_FULLSCREEN_ONLY = ['reaction', 'ballShake', 'countdown', 'stopwatch', 'quietHold',
  'coinFlip', 'hiddenObject', 'scan', 'steps', 'compass', 'shout', 'blindTaste'];
/** 置灰时写给作者的原因,照抄契约 §1.5 那一句。 */
const PRESENT_LOCK_REASON = '判定依赖整屏几何或设备能力（整屏就是判定区 / 墙就是手机四条边 / 整屏被油盖住）';

/** 段的默认呈现方式。默认表外的段(含 silentOrder 等修饰段)→ fullscreen,与存量行为一致。
    ⚠️ diceRoll 默认 fullscreen 但它**不是**「只能全屏」—— 两种写法都保留。 */
function defaultPresent(section) {
  return PRESENT_INLINE_DEFAULT.indexOf(section) >= 0 ? 'inline' : 'fullscreen';
}

/** 这个段是不是「只能全屏」那批(编辑器置灰 + 本地校验 + 服务端 validator 三处同一条判据)。 */
function presentInlineLocked(section) {
  return PRESENT_FULLSCREEN_ONLY.indexOf(section) >= 0;
}

/** 配置里显式配的呈现方式;没配 / 不认识 → ''(交给默认表)。 */
function explicitPresent(model) {
  const value = text(model && model.present);
  return PRESENT_VALUES.indexOf(value) >= 0 ? value : '';
}

/** 编辑器点「内嵌 / 整屏」:返回该写回的 advanced(新对象);「只能全屏」段配 inline 返回 null。
    行为测钉这一条:置灰的开关即使被点到,也不能改出服务端必拒的配置。 */
function applyPresent(advanced, section, value) {
  if (PRESENT_VALUES.indexOf(value) < 0) return null;
  if (value === 'inline' && presentInlineLocked(section)) return null;
  return Object.assign({}, advanced, { present: value });
}

/* mistakeTier(阶段 2):判错扣血吃主题难度表的哪一档,住配置**根层**,与 present 同级。
   不配 = 运行期按 easy 走,而主题 tiers.easy.damage 默认 1 —— 与并入难度表前的固定 -1 等价。
   ⚠️ 这三处(常量 / normalize / validate)必须与服务端 AdvancedGameConfigValidator#validateMistakeTier
   同时改:前端宽后端严 = 作者存不上还没理由;前端严后端宽 = 新字段永远配不出来。 */
const MISTAKE_TIERS = ['easy', 'medium', 'hard'];

/** mistakeTier 的形状校验(文案对齐服务端)。坏值直接拒,不在本页悄悄落回 easy。 */
function mistakeTierError(model) {
  if (!model || model.mistakeTier == null) return '';
  const configured = text(model.mistakeTier);
  if (MISTAKE_TIERS.indexOf(configured) < 0) return '判错扣血档位只能是简单、普通或困难';
  return '';
}

/* variants(阶段 4 自适应难度):按本局状态放宽**容错面**。住配置根层,与 present 同级。
   ⚠️ 两张表与服务端 AdvancedGameConfigValidator 的 RELAX_FIELDS 是两处独立记录,
   由 publish-relax-contract 对拍;改一边不改另一边,那条测试会红。 */
// 音乐角的 durationSeconds 只是进度条上的曲目时长,不是容错面 —— 不在此列(与服务端 RELAX_FIELDS 同步)
const RELAX_SECONDS = ['timer.durationSeconds', 'typeIn.seconds', 'ballShake.seconds'];
const RELAX_ATTEMPTS = ['sort.maxAttempts', 'pricePair.maxTries', 'typeIn.tries',
  'qa.maxTries', 'hiddenObject.maxTries', 'stopwatch.tries'];
// 判定误差:只能 +N 放大。photoCheck.maxTries 不在任何一张表里 —— 它是「放不放过」的触发点,不是容错面
const RELAX_TOLERANCE = ['estimate.tolerance', 'compass.tolerance', 'stopwatch.toleranceMs', 'reaction.goalMs'];
// 越小越容易(坚持几秒 / 等几秒 / 稳住几秒 / 撞几次):只能 -N(2026-09-24)
const RELAX_LOWER = ['quietHold.seconds', 'shout.seconds', 'countdown.seconds', 'compass.holdSeconds', 'ballShake.goal'];
// 次数类各 kit 的上界都是 10(0 = 不限);选项超了上界发布期会判红,所以这里先挡
const MAX_ATTEMPTS = 10;
const MAX_VARIANTS = 16;
/* 与服务端 MAX_STATE_REFS / MAX_CHECK_TEXT 对齐,由 publish-mods-contract 对拍。 */
const MAX_MODS = 16;
const MAX_MOD_LABEL = 200;

/**
 * 条件修正预设(阶段 5)。创作者点一下就有一条能用的,不必自己拼条件 DSL。
 * ⚠️ 只放**零风险**的两条:它们引用的 sys.luck 与节点无关,模板被多个节点复用也成立。
 * 「熟门熟路」要引用 sys.passed.{nodeId},而模板编辑期拿不到 nodeId(同一模板可挂多站),
 * 按 9-22 裁决延后;「带伤」用 sys.hp 低,阈值未拍板,同样不放。
 */
const MOD_PRESETS = [
  { key: 'luckHigh', label: '幸运高获得多1分', value: 1, when: { var: 'sys.luck', op: 'GTE', value: 3 } },
  { key: 'luckLow', label: '幸运低少一分', value: -1, when: { var: 'sys.luck', op: 'LTE', value: 0 } },
];

/** 「幸运」开关打开后的三档:两条预设单开或同开。-1 = 开关关着。 */
const LUCK_OPTIONS = [
  { label: '幸运高获得多1分', keys: ['luckHigh'] },
  { label: '幸运低少一分', keys: ['luckLow'] },
  { label: '幸运高多1分，幸运低少1分', keys: ['luckHigh', 'luckLow'] },
];

function luckIndex(mods) {
  const list = Array.isArray(mods) ? mods : [];
  const on = MOD_PRESETS.filter((p) => list.some((m) => m && m.label === p.label)).map((p) => p.key).join();
  return LUCK_OPTIONS.findIndex((o) => o.keys.join() === on);
}

/** 换档 = 先摘掉两条幸运预设,再按档位补回;作者别的修正不动。index < 0 = 全摘。 */
function applyLuck(mods, index) {
  const rest = (Array.isArray(mods) ? mods : []).filter((m) => !MOD_PRESETS.some((p) => m && m.label === p.label));
  const opt = LUCK_OPTIONS[index];
  if (!opt) return rest;
  return rest.concat(MOD_PRESETS.filter((p) => opt.keys.indexOf(p.key) >= 0)
    .map((p) => ({ label: p.label, value: p.value, when: Object.assign({}, p.when) })));
}

/**
 * 「生命值越低越困难」开关(9-22 用户拍板:生命值不做成一条条预设,做成一个开关)。
 *
 * <p>打开后展开成一把**阶梯**:两条都成立时自然叠加成 -2。mods 的语义就是「所有成立的
 * 逐条相加」,所以分档不必写范围条件(条件 DSL 也表达不了 3<hp<=6 这种区间)。
 *
 * <p>⚠️ 这是唯一一个会随状态恶化而加重的修正 —— 血越低越难过、过不了又掉血。
 * 阈值刻意从 6(过半)才起步、每档只 -1,两档封顶 -2:让它是「越到后面越吃力」的压力曲线,
 * 不是把濒死玩家直接按死。改阈值前先想清楚这条死亡螺旋。
 */
const HP_LADDER = [
  { key: 'hurtLight', label: '带伤', value: -1, when: { var: 'sys.hp', op: 'LTE', value: 6 } },
  { key: 'hurtHeavy', label: '重伤', value: -1, when: { var: 'sys.hp', op: 'LTE', value: 3 } },
];

/** 本配置里 mods 是不是「生命值阶梯全在」的状态 —— 开关的回显判据。 */
function hpLadderOn(mods) {
  const list = Array.isArray(mods) ? mods : [];
  return HP_LADDER.every((step) => list.some((m) => m && m.when
    && m.when.var === step.when.var && m.when.op === step.when.op
    && Number(m.when.value) === step.when.value));
}

/** 这一条是不是阶梯里的一档。 */
function isHpLadderMod(m) {
  return !!(m && m.when && m.when.var === 'sys.hp'
    && HP_LADDER.some((step) => m.when.op === step.when.op && Number(m.when.value) === step.when.value));
}

/** 开 = 补齐阶梯(已有的不重复加);关 = 只摘掉阶梯那两条,作者自己配的一条不动。 */
function toggleHpLadder(mods, on) {
  const list = (Array.isArray(mods) ? mods : []).filter((m) => !isHpLadderMod(m));
  if (!on) return list;
  return list.concat(HP_LADDER.map((step) => ({ label: step.label, value: step.value, when: Object.assign({}, step.when) })));
}

/**
 * 「状态不好时松一点」的可选项(阶段 4 的 variants 交给创作者用)。
 *
 * <p>⚠️ **必须按当前配置动态生成**,不能写死一张表:relax 指向未启用的玩法段、或底值
 * 已经是「不限」的次数字段,发布期都会判红(validateRelax)。让作者从一个必然被拒的
 * 选项里挑,等于把错误推迟到发布那一刻才说。
 *
 * <p>条件统一用 sys.hp <= 3 —— 放宽是对玩家隐藏的,不该让作者去调阈值;
 * 要精细控制的走后台改 JSON。
 */
const RELAX_WHEN = { var: 'sys.hp', op: 'LTE', value: 3 };

/** 编辑器自己配的那条放宽(条件就是 RELAX_WHEN);后台手配的别的条件不归编辑器管,切换时原样留着。 */
function isEditorVariant(v) {
  const w = v && v.when;
  return !!(w && w.var === RELAX_WHEN.var && w.op === RELAX_WHEN.op && Number(w.value) === RELAX_WHEN.value);
}

function relaxChoices(model) {
  const when = RELAX_WHEN;
  const out = [];
  const seconds = [
    { path: 'timer.durationSeconds', text: '多给 30 秒', delta: 30 },
    { path: 'typeIn.seconds', text: '打字多给 15 秒', delta: 15 },
  ];
  for (const item of seconds) {
    const seg = model && model[item.path.slice(0, item.path.indexOf('.'))];
    if (seg && seg.enabled) {
      out.push({ key: item.path, pick: '血量低时' + item.text,
        when: when, relax: { [item.path]: '+' + item.delta } });
    }
  }
  for (const path of RELAX_ATTEMPTS) {
    const seg = model && model[path.slice(0, path.indexOf('.'))];
    const base = seg && Number(seg[path.slice(path.indexOf('.') + 1)]);
    // 底值已经是不限(0 或没填)就别给这个选项 —— 放宽不了更松,发布期会拒。
    if (!seg || !seg.enabled || !(base > 0)) continue;
    if (base + 2 <= MAX_ATTEMPTS) {
      out.push({ key: path + ':more', pick: '血量低时多 2 次机会',
        when: when, relax: { [path]: '+2' } });
    }
    out.push({ key: path + ':free', pick: '血量低时次数不限',
      when: when, relax: { [path]: '=0' } });
  }
  // 弹球只有开了限时 seconds 才生效(后端同样拒「配了等于没配」)
  const shake = model && model.ballShake;
  if (shake && shake.enabled && shake.timed && Number(shake.seconds) > 0 && Number(shake.seconds) + 5 <= 300) {
    out.push({ key: 'ballShake.seconds', pick: '血量低时弹球多给 5 秒',
      when: when, relax: { 'ballShake.seconds': '+5' } });
  }
  // 越小越容易:减三分之一左右,减完仍在 kit 下界之上才给(下界与服务端各 validateXxx 一致)
  const lower = [
    { path: 'quietHold.seconds', text: '少坚持', unit: '秒', min: 5 },
    { path: 'shout.seconds', text: '少喊', unit: '秒', min: 5 },
    { path: 'countdown.seconds', text: '少等', unit: '秒', min: 5 },
    { path: 'compass.holdSeconds', text: '对准后少稳', unit: '秒', min: 1 },
    { path: 'ballShake.goal', text: '少撞', unit: '次', min: 1 },
  ];
  for (const item of lower) {
    const seg = model && model[item.path.slice(0, item.path.indexOf('.'))];
    const base = seg && Number(seg[item.path.slice(item.path.indexOf('.') + 1)]);
    if (!seg || !seg.enabled || !(base > 0)) continue;
    const delta = Math.max(1, Math.round(base / 3));
    if (base - delta < item.min) continue;
    out.push({ key: item.path, pick: '血量低时' + item.text + ' ' + delta + ' ' + item.unit,
      when: when, relax: { [item.path]: '-' + delta } });
  }
  // 误差放宽:数值随题目量级走,多数取「放宽一倍」;超出 kit 自己的上界就不给这个选项
  const tolerance = [
    { path: 'reaction.goalMs', text: '反应达标线放宽 150 毫秒', delta: () => 150, max: 3000 },
    { path: 'compass.tolerance', text: '方向误差多放 15°', delta: () => 15, max: 90 },
    { path: 'stopwatch.toleranceMs', text: '停表误差放宽一倍', delta: (b) => b, max: 5000 },
    { path: 'estimate.tolerance', text: '猜数字误差放宽一倍', delta: (b) => Math.round(b), max: Infinity },
  ];
  for (const item of tolerance) {
    const seg = model && model[item.path.slice(0, item.path.indexOf('.'))];
    const base = seg && Number(seg[item.path.slice(item.path.indexOf('.') + 1)]);
    if (!seg || !seg.enabled || !(base > 0)) continue;
    const delta = item.delta(base);
    if (!(delta >= 1) || base + delta > item.max) continue;
    out.push({ key: item.path, pick: '血量低时' + item.text,
      when: when, relax: { [item.path]: '+' + delta } });
  }
  return out;
}

/** relax 的形状与方向校验(文案对齐服务端 validateRelax)。 */
function relaxError(relax, model) {
  if (!relax || typeof relax !== 'object' || Array.isArray(relax)) return 'variants 的 relax 格式不正确';
  const paths = Object.keys(relax);
  if (!paths.length) return 'variants 的 relax 不能为空';
  for (const path of paths) {
    const seconds = RELAX_SECONDS.indexOf(path) >= 0;
    const attempts = RELAX_ATTEMPTS.indexOf(path) >= 0;
    const tolerance = RELAX_TOLERANCE.indexOf(path) >= 0;
    const lower = RELAX_LOWER.indexOf(path) >= 0;
    if (!seconds && !attempts && !tolerance && !lower) {
      return 'relax 只能调容错面(时限 / 可试次数 / 判定误差)：' + path
        + ' 不在白名单里。题面(题目、选项、答案、奖励分)一个字都不许动';
    }
    /* 这两条拦的都是「配了等于没配」——后端 validateRelax 同款判据。不在本页拦,
       作者存得下、发布被后端拒、而且看不到理由。 */
    const section = path.slice(0, path.indexOf('.'))
    const seg = model && model[section]
    if (!seg || !seg.enabled) {
      return 'relax 的字段所在玩法没有启用：' + path
    }
    /* 次数类字段缺省即 0 即不限,所以不能只认显式写着的 0 ——
       「不写」那一半 +N 会把不限变成只剩 N 次,方向是收紧。与后端 asInt(0)==0 同判据。 */
    const base = Number(seg[path.slice(path.indexOf('.') + 1)]) || 0
    if (attempts && base === 0) {
      return path + ' 已经是不限，放宽不了更松'
    }
    if (path === 'ballShake.seconds' && !seg.timed) {
      return '弹球没开限时，放宽时长不会生效：' + path
    }
    const raw = text(relax[path]);
    /* 越小越容易的一类只认 -N;+N / =N 在这一类里是收紧或证明不了方向(同服务端 LOWER) */
    if (lower) {
      const d = /^-(\d{1,5})$/.exec(raw);
      if (!d) return 'relax 只能放宽：' + path + ' 越小越容易，只能写 -N';
      if (Number(d[1]) === 0) return 'relax 的 ' + path + ' 写 -0 没有意义';
      continue;
    }
    if (raw.charAt(0) === '-') {
      return 'relax 只能放宽：' + path + ' 写 ' + raw + ' 是收紧';
    }
    const m = /^([+=])(\d{1,5})$/.exec(raw);
    if (!m) {
      return 'relax 的 ' + path + ' 只能写 +N(放宽)' + (attempts ? ' 或 =0(改成不限)' : '');
    }
    if (m[1] === '+' && Number(m[2]) === 0) return 'relax 的 ' + path + ' 写 +0 没有意义';
    /* 次数类 0 = 不限:=0 是放宽,=K(K≠0) 是收紧但数字更大 —— 大小比较会把两种都判反。 */
    if (m[1] === '=' && !(attempts && Number(m[2]) === 0)) {
      return 'relax 只能放宽：' + path + ' 写 =' + Number(m[2]) + ' 证明不了比原值宽';
    }
  }
  return '';
}

/** variants 的形状校验。每条都必须带 when —— 无条件放宽等于直接改配置。 */
function variantsError(model) {
  const variants = model && model.variants;
  if (variants == null) return '';
  if (!Array.isArray(variants)) return 'variants 必须是数组';
  if (variants.length > MAX_VARIANTS) return 'variants 最多配置 ' + MAX_VARIANTS + ' 条';
  for (const item of variants) {
    if (!item || typeof item !== 'object') return 'variants 条目格式不正确';
    if (item.when == null) return 'variants 的每条都必须带 when —— 无条件放宽等于直接改配置';
    const bad = relaxError(item.relax, model);
    if (bad) return bad;
  }
  return '';
}

/** present 的形状与可行性校验(文案对齐服务端 validatePresent,让作者在本页就看懂)。 */
function presentError(model) {
  const configured = text(model && model.present);
  if (!configured) return '';
  if (PRESENT_VALUES.indexOf(configured) < 0) return '呈现方式只能是内嵌故事流或整屏';
  if (configured === 'inline') {
    for (const section of PRESENT_FULLSCREEN_ONLY) {
      if (model[section] && model[section].enabled) {
        return section + ' 只能整屏：' + PRESENT_LOCK_REASON + '；内嵌进故事流后判定不成立，请改成整屏';
      }
    }
  }
  return '';
}

function defaultConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    timer: { enabled: false, durationSeconds: 300, timeoutResult: 'FAILED' },
    random: {
      enabled: false,
      // 这副卡叫什么(原型 draw 的必填字段)。玩家那一屏顶上就印这一行
      deckName: '',
      drawCount: 1,
      items: [{ id: 'item_1', label: '线索卡', weight: 1, content: '' }]
    },
    branch: {
      enabled: false,
      startStepId: 'start',
      steps: [{ id: 'start', title: '起点', body: '', terminal: true,
        outcomeCode: 'COMPLETED', outcomeLabel: '完成节点', options: [] }]
    },
    leaderboard: { enabled: false, metric: 'ELAPSED_TIME', scope: 'ACTIVITY', limit: 50 },
    multiplayer: {
      enabled: false,
      mode: 'SEQUENTIAL',
      minPlayers: 2,
      maxPlayers: 4,
      assignment: 'AUTO',
      requiredTurns: 1,
      unitScore: 0,
      roles: [{ id: 'player', label: '队员', min: 1, max: 4 }],
      turnOrder: ['player']
    },
    // ===== v5.1 新玩法 =====
    // 时段限定:判定用服务端时钟,跨夜(openFrom > openTo)合法 —— 午夜电台就是这种。
    timeWindow: { enabled: false, eyebrow: '', title: '', openFrom: '20:00', openTo: '23:00', subscribeTmplId: '' },
    // 盲品:answerKey 存在配置里但服务端两处投影都剥掉,不会下发给玩家。
    blindTaste: {
      enabled: false, title: '', steps: '', hint: '', xp: 0, answerKey: 'A',
      options: [{ key: 'A', label: '' }, { key: 'B', label: '' }]
    },
    silentOrder: { enabled: false, title: '', rule: '', limitSeconds: 0 },
    diyName: { enabled: false, title: '', maxLength: 16, suggestions: [] },
    // 音乐角**不判定通关**(2026-08-26 拍板),所以没有"听完"这类可伪造的字段。
    musicCorner: { enabled: false, title: '', trackName: '', audioUrl: '', durationSeconds: 0 },
    // 计步只认服务端解密的微信运动步数,配置里不放任何客户端可自证的字段。
    steps: { enabled: false, eyebrow: '', goal: 6000, xp: 0 },
    // 签文池不投影给客户端:一次领一条、由服务端当天选。
    dailySign: { enabled: false, signer: '', sealText: '', poems: [] },
    /* 跨日慢任务:与 timer 相反的两件事 —— timer 是「限时,快点」,这一段是「慢慢来,
       明天再回来」。等待天数由服务端按**日期差**判,不是过了 24 小时,所以不放任何
       客户端能自证的字段。三个按钮文案留空时玩家侧用组件自带的说法(见 playkit-view
       的 slowTask 分支),这里不预填 —— 预填会把话写死进配置,以后改文案改不动。
       ★ unlockText(隔天才该看到的那段发现)不随货架投影下发,领取之后才回给玩家。 */
    slowTask: {
      enabled: false, title: '', startLabel: '', waitHint: '', unlockLabel: '',
      unlockText: '', waitDays: 1, xp: 0
    },

    // ===== 自由探索四玩法 =====
    // 估数:answer 与 tolerance 都不投影给客户端(AdvancedGamePublicProjection#copyEstimate),
    // 下发了就等于把答案印在题面上。
    estimate: {
      enabled: false, title: '', unit: '', reveal: '',
      min: 0, max: 1000, answer: 500, tolerance: 50, xp: 0
    },
    /* 猜图:几张图里挑出正确的那一张。★ 2026-09-10 改模型 —— 这一段原来是「比价」
       (每件带价格、两两比谁贵),用户拍板「猜图不是比价格」。
       服务端只投影 id/name/imageUrl,**correct 一个字都不下发**:哪一张是对的
       到了客户端,这题就只剩点击。 */
    pricePair: {
      enabled: false, title: '', xp: 0, maxTries: 0,
      items: [
        { id: 'pic_1', name: '', imageUrl: '', correct: true },
        { id: 'pic_2', name: '', imageUrl: '', correct: false },
        { id: 'pic_3', name: '', imageUrl: '', correct: false }
      ]
    },
    /* 问答三种模式共一段,靠 mode 分:TYPE 打字 / PICK 选项 / SHOT 拍照。
       三段的话同一处改动要改三遍,而它们的题面、附件、次数、奖励是同一套。
       ★ answerText 与 options[].correct 是秘密,服务端不投影。 */
    qa: {
      enabled: false, mode: 'TYPE', title: '', lead: '', imageUrl: '', audioUrl: '',
      // shotNote:拍照打卡的补充说明,提示词底下那行小字(原型 qaShot 的第二个字段)
      answerText: '', reveal: false, shotNote: '', maxTries: 0, xp: 0,
      // multi 只对 PICK 有效:开了之后可以有多个正确答案(2026-09-16)
      multi: false,
      options: [
        { id: 'opt_1', label: '', fb: '', correct: true },
        { id: 'opt_2', label: '', fb: '', correct: false }
      ]
    },
    /* 扫码:最轻的一种,扫完立刻回一条。
       ★ 二维码内容不在这儿配 —— 它绑在路线层(节点的核销码),两处各存一份迟早对不上。 */
    // arMode:显形档的真 AR(NONE 不开 / PLANE 平面放置 / MARKER 图像识别),markerUrl 是图像识别的识别图
    scan: { enabled: false, kind: 'TEXT', reply: '', audioUrl: '', imageUrl: '', overlayUrl: '', overlayScale: 60, arMode: 'NONE', markerUrl: '', modelUrl: '', xp: 0 },
    // 找东西:x/y/r 是 0–1 的比例值(不是像素),换图不换坐标。三者都不投影。
    hiddenObject: {
      // maxTries:能错几次,0 = 不限(原型 limit() 的第二个开关)
      enabled: false, title: '', hint: '', imageUrl: '', xp: 0, maxTries: 0,
      hotspots: [
        { id: 'spot_1', label: '', x: 0.25, y: 0.3, r: HOTSPOT_RADIUS },
        { id: 'spot_2', label: '', x: 0.7, y: 0.45, r: HOTSPOT_RADIUS },
        { id: 'spot_3', label: '', x: 0.45, y: 0.75, r: HOTSPOT_RADIUS }
      ]
    },
    // 竞猜:closeAtHour 存**当天的小时**不是绝对时间戳 —— 模板会被复制、被跨天复用,
    // 存死时间等于复制出来的副本第二天全部过期。
    predict: {
      /* revealDays / revealHour:第几天几点由商家公布答案(原型「揭晓时间」)。
         ⚠️ 存的是**相对天数**不是绝对时间戳 —— 模板会被复制、跨天复用,
         存死时间等于副本第二天全部过期(closeAtHour 同理)。
         0 = 当天,1 = 第二天,以此类推。 */
      enabled: false, question: '', hint: '', closeAtHour: 20, revealDays: 1, revealHour: 20, xp: 0,
      options: [{ key: 'A', label: '' }, { key: 'B', label: '' }]
    },

    // ===== 决定类与挑战类 =====
    /* 抛硬币:「正面 / 反面」本身没有意义,写上「这杯店家请 / 这杯你请」才是一个玩法。
       所以 action 是必填、label 只是叫法。★ 本次朝上哪面由服务端出:
       客户端的随机数玩家改得动,而这玩法的结果直接对应谁请这一杯。 */
    coinFlip: {
      enabled: false, kicker: '', xp: 0,
      heads: { label: '正面', action: '' },
      tails: { label: '反面', action: '' }
    },
    /* 掷骰子:六个面各写一件事,写具体 ——「跟店员说一句今天的天气」比「和店员互动」
       好使,后者玩家不知道该干嘛。两颗那一档**只报点数和**,不对应任务。 */
    diceRoll: { enabled: false, kicker: '', diceCount: 1, xp: 0, faces: ['', '', '', '', '', ''],
      dc: 10, modifier: 0, rollMode: 'normal', successText: '', failText: '' },
    /* 变色就点:等待时长由服务端每轮现随机(1.4–4.2 秒),不入配置也不下发 ——
       下发了就等于告诉客户端什么时候变色,这一屏测的不再是反应,是定时器。
       goalMs 下限与服务端 MIN_HUMAN_REACTION_MS 同为 120。 */
    reaction: { enabled: false, kicker: '', rounds: 3, goalMs: 320, xp: 0 },
    /* 弹球:限时是这个玩法自己的开关,不走通用 timer 段 —— 通用那段管的是整关,
       这里管的是这一局撞球。 */
    ballShake: { enabled: false, kicker: '', goal: 30, timed: false, seconds: 12, xp: 0 },
    // 安静挑战:阈值不入配置,由客户端开局前现场校准 —— 书店的线拿到咖啡馆就是一开局就输
    quietHold: { enabled: false, kicker: '', sub: '', seconds: 15, xp: 0 },
    /* 罗盘指向(现场感契约 §3):bearing 初始留空 —— 它没有「没填也能过」的默认方向,
       编辑页的「对准当前方向取值」按钮(或手填 0 至 359)才是它的来源。
       容差与保持时长有合法默认,商家看得见、改得动,不算凭空代填。 */
    compass: { enabled: false, kicker: '', bearing: '', tolerance: 15, holdSeconds: 3, hint: '', xp: 0 },
    /* 喊一嗓子(现场感契约 §4):阈值不入配置,由客户端开局现场校准 —— 与 quietHold 同一把尺。
       seconds 是「要连续喊满几秒」,掉线清零。 */
    shout: { enabled: false, kicker: '', seconds: 5, xp: 10 },
    // 倒计时:不附加判定,整段都是给人看的。doneText 是到点那句话,必填
    countdown: { enabled: false, kicker: '', seconds: 90, doneText: '', xp: 0 },
    /* 精准停表:容差**要**下发 —— 它是规则的一部分(「差 0.3 秒以内算准」),
       玩家得先知道才谈得上瞄准。这与估数相反:那边容差能反推出答案区间。 */
    stopwatch: { enabled: false, kicker: '', targetSeconds: 10, toleranceMs: 300, tries: 3, xp: 0 },

    // ===== 《预制人生》五段(契约 §2) =====
    /* 建档:一次问 1–8 个问题,答案写进角色档案,后面的故事可以用 {变量名} 引用。
       options[].effects 是**暗的**状态写入 —— 服务端不下发,露出来就成了攻略表。 */
    profile: {
      enabled: false, title: '', lead: '',
      avatar: { enabled: true, required: false },
      questions: [{ key: 'name', label: '', kind: 'text', maxLength: 12, required: false }],
      xp: 0
    },
    /* 拍照审核(契约 §2.2,2026-09-17 改版:接真视觉模型):
       requirement 是作者用一句人话写的「要拍到什么」,直接进模型 prompt;
       minConfidence 是模型置信度分数线,低于它判不过。判定全在服务端,
       原先的 rule.mode(亮区/边缘/清晰度/any)与 threshold 那套不再存在。
       末尾三个字段属于「拍物成卡」(立体藏品卡契约 §2.1):mode 空 = 老的拍照审核,
       cardTitle 空 = 用 title 当卡名,cardStyle 默认带高光。 */
    photoCheck: {
      enabled: false, title: '', shotNote: '',
      requirement: '', minConfidence: 60,
      maxTries: 3, fallback: 'retake', xp: 0,
      // 取景轮廓(S1):选填。空的一律在 normalize 里整键删掉，不带着空串存库
      frameUrl: '', frameOpacity: 40,
      mode: '', cardTitle: '', cardStyle: 'foil'
    },
    /* R14 旅程检定(master 既有段,字段真源 = AdvancedGameConfigValidator#validateCheck)。
       编辑器暴露七项:skill / tier / successText / failText / successEffects / failEffects
       / **mods**(阶段 5 新增:条件修正,玩家侧 playkit-journey-check 早已逐条显示生效与否)。
       ⚠️ advantageIf / disadvantageIf / critEffects / fumbleEffects / failCostTag 仍不暴露:
       读进来原样留着、存回去原样带上 —— 丢掉它们 = 把作者配好的优劣势与大成功效果静默删掉。
       checkId 是这一处的稳定标识,不暴露;normalize 只在缺省时补一个(老配置一律已有)。 */
    check: {
      enabled: false, checkId: '', tier: 'medium', skill: '',
      successText: '', failText: '', successEffects: [], failEffects: [], mods: []
    },
    /* 留言:一句留给下一个来这里的人的话。presets 是给玩家抄的近路(0–6 条)。 */
    album: { enabled: false, images: [] },
    note: { enabled: false, title: '', prompt: '', maxLength: 40, presets: [], showPrevious: 3, xp: 0 },
    /* 限时打字:照着一行字打,服务端判内容相等 + 用时 <= seconds。tries 0 = 不限。 */
    typeIn: { enabled: false, title: '', target: '', seconds: 10, caseSensitive: false, tries: 0, xp: 0 },

    // ===== 推理类三玩法 =====
    /* 排序:商家**按正确顺序**录入 items,answerOrder 由 normalize 按同一顺序生成 ——
       玩家拿到的 items 由服务端打乱,answerOrder 是唯一判定依据,一个字都不投影。
       img 只是为了不丢服务端已有的字段(采用来的模板可能带图),面板不编辑它。 */
    sort: {
      enabled: false, prompt: '',
      items: [
        { id: 'item_1', label: '' },
        { id: 'item_2', label: '' },
        { id: 'item_3', label: '' }
      ],
      answerOrder: ['item_1', 'item_2', 'item_3']
    },
    /* 连线:面板按「左 | 右」成对录入,left[i] 与 right[i] 是一对。
       pairs 由 normalize 按下标对齐生成 —— 玩家端 right 会被服务端打乱。 */
    match: {
      enabled: false, prompt: '',
      left: [{ id: 'left_1', label: '' }, { id: 'left_2', label: '' }],
      right: [{ id: 'right_1', label: '' }, { id: 'right_2', label: '' }],
      pairs: [['left_1', 'right_1'], ['left_2', 'right_2']]
    },
    /* 分类:answer 是编辑期的事实源(itemId → binId),不是派生字段 ——
       每条归哪一类只有商家说了算,derive 不出来。未选类别的条目在 answer 里没有键,
       校验会拦下(每条都要有一个类别)。 */
    classify: {
      enabled: false, prompt: '',
      bins: [{ id: 'bin_1', label: '' }, { id: 'bin_2', label: '' }],
      items: [{ id: 'item_1', label: '' }, { id: 'item_2', label: '' }],
      answer: { item_1: 'bin_1', item_2: 'bin_2' }
    }
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function text(value) { return String(value == null ? '' : value).trim(); }

/**
 * 效果条目清洗(契约 §2.1):保留 {var, op, value} 三键,空行(变量与值都空)丢掉。
 * ADD_TAG 的 value 是 tag 字符串,SET/INC 的 value 是整数 —— 一律按字符串存,
 * 数值在 validate 里当整数判,让「输入框里还是半截」不至于当场变成 NaN。
 */
/**
 * 条件修正的清洗(阶段 5)。契约真源 = AdvancedGameConfigValidator#validateMods:
 * {@code [{label?, value, when}]},value 必带整数,when 必填且走同一套条件 DSL。
 *
 * <p>空行(没填条件变量、value 又是 0)丢掉 —— 与 normalizeEffects 同一口径,
 * 让作者点开一行没填完不至于存出一条服务端必拒的配置。
 * ⚠️ when 的形状**不在这里改写**,只原样带上:认不认由校验说,悄悄改写等于替作者改语义。
 */
function normalizeMods(mods) {
  return (Array.isArray(mods) ? mods : []).map((item) => {
    const when = item && item.when && typeof item.when === 'object' ? item.when : {};
    const row = { when: when, value: Number(item && item.value) || 0 };
    const label = text(item && item.label);
    if (label) row.label = label;
    return row;
  }).filter((row) => text(row.when.var) || text(row.when.tag) || row.value !== 0);
}

/** 条件修正的校验(文案对齐服务端 validateMods)。 */
function modsError(mods) {
  if (mods == null) return '';
  if (!Array.isArray(mods)) return 'check 的 mods 必须是数组';
  if (mods.length > MAX_MODS) return 'check 的 mods 最多配置 ' + MAX_MODS + ' 条';
  for (const row of mods) {
    if (!row || typeof row !== 'object') return 'check 的 mods 条目格式不正确';
    if (!row.when || typeof row.when !== 'object' || !Object.keys(row.when).length) {
      return 'check 的 mods 必须带 when 条件';
    }
    if (!Number.isInteger(Number(row.value))) return 'check 的 mods 必须带整数 value';
    if (text(row.label).length > MAX_MOD_LABEL) {
      return 'check 的 mods 的 label 不能超过 ' + MAX_MOD_LABEL + ' 字';
    }
  }
  return '';
}

function normalizeEffects(effects) {
  return (Array.isArray(effects) ? effects : []).map((item) => {
    /* op 原样保留:认不认由校验说。把一个将来才有的 op 悄悄改写成 INC,
       等于替作者改了效果语义 —— 那比报一条错更糟(旧玩法段也有过这种教训)。 */
    const op = text(item && item.op) || 'INC';
    return {
      var: text(item && item.var),
      op: op,
      value: op === 'ADD_TAG' ? text(item && item.value) : Number(item && item.value),
    };
  }).filter((item) => item.var || (typeof item.value === 'number' ? item.value !== 0 : !!item.value));
}

/** 本模块的本地说人话版:文案与服务端 validateEffects 一一对齐。
    effects 可以整块不配(服务端 validateEffects 对 null 直接 return),所以缺省不算错。 */
function effectError(effects, label) {
  if (effects == null) return '';
  if (!Array.isArray(effects)) return label + '必须是数组';
  if (effects.length > MAX_EFFECTS) return label + '最多配置 ' + MAX_EFFECTS + ' 条';
  for (const item of effects) {
    const op = text(item && item.op);
    if (op === 'ADD_TAG') {
      if (!EFFECT_TAG_PATTERN.test(text(item && item.value))) {
        return label + '的 tag 值必须以 tag. 开头，点号后小写字母开头';
      }
      continue;
    }
    if (op !== 'SET' && op !== 'INC') return label + '的操作只能是 SET、INC 或 ADD_TAG';
    const varName = text(item && item.var);
    if (varName === SYS_LUCK_VAR) {
      const luck = Number(item && item.value);
      if (op !== 'INC' || !Number.isInteger(luck) || luck < 1 || luck > 3) {
        return label + '里的 sys.luck 只能 INC 1 至 3';
      }
      continue;
    }
    if (!EFFECT_VAR_PATTERN.test(varName)) {
      return label + '的变量名必须写成 counter. / clue. / relation. 开头的具名键，如 counter.energy';
    }
    const value = Number(item && item.value);
    if (!Number.isInteger(value) || value < MIN_EFFECT_VALUE || value > MAX_EFFECT_VALUE) {
      return label + '的值须为 ' + MIN_EFFECT_VALUE + ' 至 ' + MAX_EFFECT_VALUE + ' 的整数';
    }
  }
  return '';
}

/** 本模块不认识的顶层段(将来服务端新加的机制)。读进来原样留着,存回去原样带上。 */
function extraKeys(model) {
  if (!model || typeof model !== 'object') return [];
  return Object.keys(model).filter(key => key !== 'schemaVersion' && SECTIONS.indexOf(key) < 0);
}

function parse(raw) {
  const fallback = defaultConfig();
  if (!raw) return { value: fallback, error: '' };
  try {
    const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('shape');
    const value = defaultConfig();
    SECTIONS.forEach((key) => {
      if (source[key] && typeof source[key] === 'object') value[key] = Object.assign(value[key], clone(source[key]));
    });
    // ★ 未知段透传。以前这里只 copy 五段,其余的读进来就没了,存回去等于把玩法删掉 ——
    //   v5.1 的七款商家游戏就是这么被静默清空的。名单外的段一律原样保留。
    extraKeys(source).forEach((key) => { value[key] = clone(source[key]); });
    // ★ 采用别人的模板时服务端投影剥掉了 blindTaste.answerKey(见 AdvancedGamePublicProjection)。
    //   这里不许拿默认值 'A' 顶上 —— 那等于把别人的题静默改成「答案永远是 A」。
    //   留空,发布时由服务端从源模板补回(TemplatePublishServiceImpl#backfillAdoptedSecrets)。
    if (source.blindTaste && typeof source.blindTaste === 'object'
        && source.blindTaste.answerKey == null) value.blindTaste.answerKey = '';
    /* 《预制人生》两处列表型字段补空数组:WXML 要用 .length 控制「还能再加吗」,
       而 WXML 表达式禁止对括号做成员访问(全仓门禁),所以列表必须始终是数组。
       effects 可以整块不配(服务端 validateEffects 对 null 直接放行)。 */
    if (value.profile && Array.isArray(value.profile.questions)) {
      value.profile.questions.forEach((question) => {
        if (!question || !Array.isArray(question.options)) return;
        question.options.forEach((option) => {
          if (option && !Array.isArray(option.effects)) option.effects = [];
        });
      });
    }
    if (value.check) {
      if (!Array.isArray(value.check.successEffects)) value.check.successEffects = [];
      if (!Array.isArray(value.check.failEffects)) value.check.failEffects = [];
    }
    if (Array.isArray(value.branch.steps)) {
      value.branch.steps = value.branch.steps.map((step) => {
        const normalized = Object.assign({}, step);
        if (normalized.terminal) {
          normalized.outcomeCode = normalized.outcomeCode || 'COMPLETED';
          normalized.outcomeLabel = normalized.outcomeLabel || normalized.title || '完成节点';
        }
        return normalized;
      });
    }
    value.schemaVersion = Number(source.schemaVersion) || SCHEMA_VERSION;
    return { value, error: value.schemaVersion === SCHEMA_VERSION ? '' : '配置版本不受支持，请重新保存' };
  } catch (e) {
    return { value: fallback, error: '高级玩法配置无法读取，请检查后重新保存' };
  }
}

function enabledSections(model) {
  return SECTIONS.filter(key => model && model[key] && model[key].enabled);
}

/**
 * 存盘前的清洗:只动**已启用**的段。
 * 服务端对"字段存在但是空串"是判错而不是当没填(见 optionalMediaUrl / suggestions),
 * 所以空值必须删键而不是留空串,否则商家一存就吃一个看不懂的报错。
 * 未启用的段原样保留 —— 服务端跳过它们,而用户下次打开还想看见自己填了一半的内容。
 */
function normalize(model) {
  const out = clone(model || {});
  out.schemaVersion = SCHEMA_VERSION;

  /* present(契约 §1.5):一个玩法段都没启用时它没有意义 —— 留着会让 serialize 的
     「空配置」判定(extraKeys)放行一份谁也没配的呈现方式。启用着就原样保留。 */
  if (out.present != null) {
    if (text(out.present) && enabledSections(out).length) out.present = text(out.present);
    else delete out.present;
  }

  /* mistakeTier:与 present 同款 —— 空串/空值不留键(留着会让 extraKeys 把一份谁也没配的
     档位当成「配过了」),配了就原样保留,坏值交给 validateNormalized 报错。 */
  if (out.mistakeTier != null) {
    if (text(out.mistakeTier)) out.mistakeTier = text(out.mistakeTier);
    else delete out.mistakeTier;
  }

  const dropIfBlank = (section, fields) => {
    fields.forEach((field) => {
      const value = text(section[field]);
      if (value) section[field] = value; else delete section[field];
    });
  };

  const tw = out.timeWindow;
  if (tw && tw.enabled) {
    tw.openFrom = text(tw.openFrom);
    tw.openTo = text(tw.openTo);
    dropIfBlank(tw, ['eyebrow', 'title', 'subscribeTmplId']);
  }

  const bt = out.blindTaste;
  if (bt && bt.enabled) {
    bt.title = text(bt.title);
    bt.answerKey = text(bt.answerKey);
    bt.xp = Number(bt.xp) || 0;
    dropIfBlank(bt, ['steps', 'hint']);
    bt.options = (Array.isArray(bt.options) ? bt.options : [])
      .map(option => ({ key: text(option && option.key), label: text(option && option.label) }))
      .filter(option => option.key || option.label);
  }

  const so = out.silentOrder;
  if (so && so.enabled) {
    so.title = text(so.title);
    so.limitSeconds = Number(so.limitSeconds) || 0;
    dropIfBlank(so, ['rule']);
  }

  const dn = out.diyName;
  if (dn && dn.enabled) {
    dn.title = text(dn.title);
    dn.maxLength = Number(dn.maxLength) || 0;
    const suggestions = (Array.isArray(dn.suggestions) ? dn.suggestions : [])
      .map(text).filter(item => !!item);
    if (suggestions.length) dn.suggestions = suggestions; else delete dn.suggestions;
  }

  const mc = out.musicCorner;
  if (mc && mc.enabled) {
    mc.title = text(mc.title);
    mc.durationSeconds = Number(mc.durationSeconds) || 0;
    dropIfBlank(mc, ['trackName', 'audioUrl']);
  }

  const st = out.steps;
  if (st && st.enabled) {
    st.goal = Number(st.goal) || 0;
    st.xp = Number(st.xp) || 0;
    dropIfBlank(st, ['eyebrow']);
  }

  const ds = out.dailySign;
  if (ds && ds.enabled) {
    ds.poems = (Array.isArray(ds.poems) ? ds.poems : [])
      .map(poem => (Array.isArray(poem) ? poem : [poem]).map(text).filter(line => !!line))
      .filter(poem => poem.length > 0);
    dropIfBlank(ds, ['signer', 'sealText']);
  }

  /* 跨日慢任务:标题与解锁内容是必填(空的一律判错,见 validateNormalized),
     三个按钮文案是选填 —— 空串要删键,让玩家侧那句自带说法顶上。
     数字用 Number(x) || 0:商家把输入框删空时拿到的是 ''。 */
  const slow = out.slowTask;
  if (slow && slow.enabled) {
    slow.title = text(slow.title);
    slow.unlockText = text(slow.unlockText);
    slow.waitDays = Number(slow.waitDays) || 0;
    slow.xp = Number(slow.xp) || 0;
    dropIfBlank(slow, ['startLabel', 'waitHint', 'unlockLabel']);
  }

  // ===== 自由探索四玩法 =====
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  /**
   * 数字字段:是数就留下,不是数就**删键**,不要拿 0 或 -1 顶上。
   * 采用公共库模板时服务端会剥掉答案/价格/坐标,补个默认值会让「被剥掉」和
   * 「商家填了个非法值」变成同一种状态 —— 前者该放行、后者该报错,混在一起两边都判错。
   */
  const keepNum = (obj, field) => {
    const parsed = Number(obj[field]);
    if (Number.isFinite(parsed)) obj[field] = parsed; else delete obj[field];
  };

  const es = out.estimate;
  if (es && es.enabled) {
    es.title = text(es.title);
    es.min = num(es.min, 0);
    es.max = num(es.max, 0);
    keepNum(es, 'answer');
    keepNum(es, 'tolerance');
    es.xp = num(es.xp, 0);
    dropIfBlank(es, ['unit', 'reveal']);
  }

  /* ===== 决定类与挑战类 =====
     数字一律过 num():商家在输入框里删空时拿到的是 ''(不是 0),
     直接存回去服务端 validator 会判「须为 1 至 N」,而那条报错读起来像商家填错了。 */
  const cf = out.coinFlip;
  if (cf && cf.enabled) {
    cf.kicker = text(cf.kicker);
    cf.xp = num(cf.xp, 0);
    ['heads', 'tails'].forEach((side) => {
      const f = cf[side] || (cf[side] = {});
      f.label = text(f.label);
      f.action = text(f.action);
    });
  }

  const dr = out.diceRoll;
  if (dr && dr.enabled) {
    dr.kicker = text(dr.kicker);
    dr.xp = num(dr.xp, 0);
    // 只能一颗或两颗:两颗只报点数和,拿和去索引六个面会越界,那是另一个玩法
    dr.diceCount = dr.diceCount === 2 ? 2 : 1;
    const faces = Array.isArray(dr.faces) ? dr.faces : [];
    dr.faces = Array.from({ length: 6 }, (_, i) => text(faces[i]));
    if (dr.mode === 'd20') {
      // 空值保留给校验，不把删空输入误当成作者选择了 0。
      dr.dc = text(dr.dc) === '' ? '' : Number(dr.dc);
      dr.modifier = text(dr.modifier) === '' ? '' : Number(dr.modifier);
      dr.successText = text(dr.successText);
      dr.failText = text(dr.failText);
    }
  }

  const rc = out.reaction;
  if (rc && rc.enabled) {
    rc.kicker = text(rc.kicker);
    rc.rounds = num(rc.rounds, 0);
    rc.goalMs = num(rc.goalMs, 0);
    rc.xp = num(rc.xp, 0);
  }

  const bs = out.ballShake;
  if (bs && bs.enabled) {
    bs.kicker = text(bs.kicker);
    bs.goal = num(bs.goal, 0);
    bs.timed = !!bs.timed;
    bs.xp = num(bs.xp, 0);
    // 不限时那一档不留秒数:留着的话下次打开开关会冒出一个商家没设过的值
    if (bs.timed) bs.seconds = num(bs.seconds, 0); else delete bs.seconds;
  }

  const qh = out.quietHold;
  if (qh && qh.enabled) {
    qh.kicker = text(qh.kicker);
    qh.seconds = num(qh.seconds, 0);
    qh.xp = num(qh.xp, 0);
    dropIfBlank(qh, ['sub']);
  }

  /* 罗盘指向:bearing 半截没填时**删键**而不是顶个 0 —— 0 是正北,是一个合法的
     目标方向,拿它替商家「忘了填」兜底,发布出去就是一个没人确认过的方位。 */
  const cmp = out.compass;
  if (cmp && cmp.enabled) {
    cmp.kicker = text(cmp.kicker);
    cmp.xp = num(cmp.xp, 0);
    cmp.tolerance = num(cmp.tolerance, 15);
    cmp.holdSeconds = num(cmp.holdSeconds, 3);
    const bearing = Number(cmp.bearing);
    if (cmp.bearing !== '' && cmp.bearing != null && Number.isFinite(bearing)) {
      cmp.bearing = bearing;
    } else {
      delete cmp.bearing;
    }
    dropIfBlank(cmp, ['kicker', 'hint']);
  }

  const sh = out.shout;
  if (sh && sh.enabled) {
    sh.kicker = text(sh.kicker);
    sh.seconds = num(sh.seconds, 0);
    sh.xp = num(sh.xp, 0);
    dropIfBlank(sh, ['kicker']);
  }

  const cd = out.countdown;
  if (cd && cd.enabled) {
    cd.kicker = text(cd.kicker);
    cd.doneText = text(cd.doneText);
    cd.seconds = num(cd.seconds, 0);
    cd.xp = num(cd.xp, 0);
  }

  const sw = out.stopwatch;
  if (sw && sw.enabled) {
    sw.kicker = text(sw.kicker);
    sw.targetSeconds = num(sw.targetSeconds, 0);
    sw.toleranceMs = num(sw.toleranceMs, 0);
    sw.tries = num(sw.tries, 0);
    sw.xp = num(sw.xp, 0);
  }

  // ===== 《预制人生》五段 =====
  const profile = out.profile;
  if (profile && profile.enabled) {
    profile.title = text(profile.title);
    profile.lead = text(profile.lead);
    profile.xp = num(profile.xp, 0);
    const avatar = profile.avatar || (profile.avatar = {});
    avatar.enabled = !!avatar.enabled;
    avatar.required = !!avatar.required;
    profile.questions = (Array.isArray(profile.questions) ? profile.questions : []).map((question) => {
      const row = {
        key: text(question && question.key),
        label: text(question && question.label),
        kind: question && question.kind === 'pick' ? 'pick' : 'text',
        required: !!(question && question.required),
      };
      if (row.kind === 'text') {
        row.maxLength = num(question && question.maxLength, 0);
        return row;
      }
      row.options = (Array.isArray(question && question.options) ? question.options : []).map((option) => {
        const item = { key: text(option && option.key), label: text(option && option.label) };
        const effects = normalizeEffects(option && option.effects);
        if (effects.length) item.effects = effects;
        return item;
      });
      return row;
    });
  }

  const photoCheck = out.photoCheck;
  if (photoCheck && photoCheck.enabled) {
    photoCheck.title = text(photoCheck.title);
    photoCheck.xp = num(photoCheck.xp, 0);
    photoCheck.maxTries = num(photoCheck.maxTries, 0);
    photoCheck.requirement = text(photoCheck.requirement);
    photoCheck.minConfidence = num(photoCheck.minConfidence, 60);
    /* 枚举原样保留(缺省才补默认):fallback 就是规则本身,
       把一个不认识的 fallback 悄悄换成「让他重拍」等于替作者改了这局怎么收场。 */
    photoCheck.fallback = text(photoCheck.fallback) || 'retake';
    /* rule 是 2026-09-17 改版前「客户端本地算分」的残键,新契约里不存在 ——
       读旧配置时把它清掉,别让它跟着存回去。 */
    delete photoCheck.rule;
    dropIfBlank(photoCheck, ['shotNote']);
    /* 取景轮廓(S1):空串要整键删掉 —— 服务端 optionalMediaUrl 把 "" 判成非法地址,
       留着就等于「商家清空轮廓」之后这份配置再也存不下去。没轮廓时不透明度也没有意义,一起删。 */
    dropIfBlank(photoCheck, ['frameUrl']);
    if (photoCheck.frameUrl) {
      const rawOpacity = Number(photoCheck.frameOpacity);
      photoCheck.frameOpacity = Number.isFinite(rawOpacity)
        ? Math.min(100, Math.max(0, Math.round(rawOpacity))) : 40;
    } else {
      delete photoCheck.frameOpacity;
    }
    /* 卡片三字段(立体藏品卡契约 §2.1):mode 与 cardTitle 空即「没填」,按本模块口径删键
       (空串发给服务端只会被当成脏值);cardStyle 是样式默认值,空就补 foil。
       ⚠️ 认不出的 mode 原样留着,由 validate 判红 —— 悄悄抹成空串等于替商家把玩法换回拍照审核。 */
    photoCheck.mode = text(photoCheck.mode);
    photoCheck.cardTitle = text(photoCheck.cardTitle);
    photoCheck.cardStyle = text(photoCheck.cardStyle) || 'foil';
    dropIfBlank(photoCheck, ['shotNote', 'mode', 'cardTitle']);
  }

  /* R14 检定:只动暴露给编辑器的七项 + 缺省 checkId。
     ⚠️ 其余字段(advantageIf / disadvantageIf / critEffects / fumbleEffects /
     failCostTag)一个都不许碰 —— out 是 model 的深拷贝,不 assign 就是原样保留。 */
  const check = out.check;
  if (check && check.enabled) {
    check.skill = text(check.skill);
    check.tier = text(check.tier) || 'medium';
    check.successText = text(check.successText);
    check.failText = text(check.failText);
    check.successEffects = normalizeEffects(check.successEffects);
    check.failEffects = normalizeEffects(check.failEffects);
    check.mods = normalizeMods(check.mods);
    if (!text(check.checkId)) check.checkId = 'check_' + Date.now().toString(36);
  }

  if (out.album && out.album.enabled) {
    out.album.images = (Array.isArray(out.album.images) ? out.album.images : []).map(image => ({
      url: text(image && image.url), line: text(image && image.line),
    }));
  }
  const note = out.note;
  if (note && note.enabled) {
    note.title = text(note.title);
    note.prompt = text(note.prompt);
    note.maxLength = num(note.maxLength, 0);
    note.showPrevious = num(note.showPrevious, 0);
    note.xp = num(note.xp, 0);
    note.presets = (Array.isArray(note.presets) ? note.presets : []).map(text).filter((item) => !!item);
  }

  const typeIn = out.typeIn;
  if (typeIn && typeIn.enabled) {
    typeIn.title = text(typeIn.title);
    typeIn.target = text(typeIn.target);
    typeIn.seconds = num(typeIn.seconds, 0);
    typeIn.caseSensitive = !!typeIn.caseSensitive;
    typeIn.tries = num(typeIn.tries, 0);
    typeIn.xp = num(typeIn.xp, 0);
  }

  const qa = out.qa;
  if (qa && qa.enabled) {
    qa.mode = ['TYPE', 'PICK', 'SHOT'].indexOf(qa.mode) >= 0 ? qa.mode : 'TYPE';
    qa.title = text(qa.title);
    qa.lead = text(qa.lead);
    qa.answerText = text(qa.answerText);
    qa.reveal = !!qa.reveal;
    // 配图 / 音频没传就整键不送:空串会被服务端判成「格式不对」而不是「没填」(同猜图,2026-09-24 C-01)
    dropIfBlank(qa, ['shotNote', 'imageUrl', 'audioUrl']);
    qa.multi = !!qa.multi;
    qa.maxTries = num(qa.maxTries, 0);
    qa.xp = num(qa.xp, 0);
    qa.options = (Array.isArray(qa.options) ? qa.options : []).map((item) => ({
      id: text(item && item.id),
      label: text(item && item.label),
      fb: text(item && item.fb),
      correct: !!(item && item.correct),
    }));
  }
  const scan = out.scan;
  if (scan && scan.enabled) {
    // OVERLAY 认不出就会被整段压回 TEXT —— 商家配的显形图会跟着「没填」一起消失
    scan.kind = ['TEXT', 'VOICE', 'IMAGE', 'OVERLAY'].indexOf(scan.kind) >= 0 ? scan.kind : 'TEXT';
    scan.reply = text(scan.reply);
    scan.xp = num(scan.xp, 0);
    // 清空按默认 60(Number('') 是 0,不先判空会被当成 0 占比)
    scan.overlayScale = scan.overlayScale === '' || scan.overlayScale == null ? 60 : num(scan.overlayScale, 60);
    /* AR 只挂在显形档上:换到别的回复形态,这个作者动作本身就让 AR 失效 —— 回 NONE,
       不留一个会被服务端「只有显形档能开 AR」拒掉的配置(与切到只能全屏的段时清掉 inline 同理)。
       显形档里认不出的值原样留着,交给校验说清楚,不在这里静默改。 */
    if (scan.kind !== 'OVERLAY' || !scan.arMode) scan.arMode = 'NONE';
    scan.markerUrl = text(scan.markerUrl);
    // 3D 模型只在开了 AR 时有三维空间可放;关了 AR 就跟着作废,不留一个会被服务端拒的配置
    scan.modelUrl = scan.arMode === 'NONE' ? '' : text(scan.modelUrl);
    // 没配的媒体地址整键不送:空串会被服务端判成「格式不对」而不是「没填」(C-01);显形图 / 识别图 / 3D 模型同理
    dropIfBlank(scan, ['audioUrl', 'imageUrl', 'overlayUrl', 'markerUrl', 'modelUrl']);
  }

  const pp = out.pricePair;
  if (pp && pp.enabled) {
    pp.title = text(pp.title);
    pp.xp = num(pp.xp, 0);
    pp.maxTries = num(pp.maxTries, 0);
    pp.items = (Array.isArray(pp.items) ? pp.items : []).map((item) => {
      const row = {
        id: text(item && item.id),
        name: text(item && item.name),
        correct: !!(item && item.correct),
      };
      const imageUrl = text(item && item.imageUrl);
      if (imageUrl) row.imageUrl = imageUrl;   // 空串会被服务端判成"格式不对"而不是"没填"
      return row;
    });
  }

  const ho = out.hiddenObject;
  if (ho && ho.enabled) {
    ho.title = text(ho.title);
    ho.imageUrl = text(ho.imageUrl);
    ho.xp = num(ho.xp, 0);
    ho.maxTries = num(ho.maxTries, 0);
    dropIfBlank(ho, ['hint']);
    /* ★ 半径不给商家填(原型:「不填坐标、不填判定半径 —— 你点哪儿就是哪儿,半径系统定」)。
       坐标由商家在图上点出来,半径一律用系统值 —— 让商家填半径的后果是:
       填小了玩家点不中(手指比圈还大),填大了整张图都是答案,而这两种他都试不出来。
       服务端只收 0.03–0.15,这个值取中。 */
    ho.hotspots = (Array.isArray(ho.hotspots) ? ho.hotspots : []).map((spot) => {
      const row = { id: text(spot && spot.id), label: text(spot && spot.label), r: HOTSPOT_RADIUS };
      ['x', 'y'].forEach((field) => {
        const parsed = Number(spot && spot[field]);
        if (Number.isFinite(parsed)) row[field] = parsed;
      });
      return row;
    });
  }

  const pd = out.predict;
  if (pd && pd.enabled) {
    pd.question = text(pd.question);
    pd.closeAtHour = num(pd.closeAtHour, -1);
    pd.revealDays = num(pd.revealDays, 1);
    pd.revealHour = num(pd.revealHour, 20);
    pd.xp = num(pd.xp, 0);
    dropIfBlank(pd, ['hint']);
    pd.options = (Array.isArray(pd.options) ? pd.options : [])
      .map(option => ({ key: text(option && option.key), label: text(option && option.label) }))
      .filter(option => option.key || option.label);
  }

  // 抽卡:卡池名商家没填就别下发一个空串,玩家那屏的 wx:if 会自己收掉那一行
  const rd = out.random;
  if (rd && rd.enabled) dropIfBlank(rd, ['deckName']);
  // ===== 推理类三玩法 =====
  /** 「{id,label} 的列表」在三段里形状一样,只有 sort 多一个可选 img。 */
  const idLabelList = (list) => (Array.isArray(list) ? list : []).map((item) => {
    const row = { id: text(item && item.id), label: text(item && item.label) };
    const img = text(item && item.img);
    if (img) row.img = img;   // 空串会被服务端判成"格式不对"而不是"没填"
    return row;
  });

  const sort = out.sort;
  if (sort && sort.enabled) {
    sort.prompt = text(sort.prompt);
    sort.items = idLabelList(sort.items);
    /* 条目顺序就是正确答案。玩家拿到的 items 由服务端打乱,answerOrder 是唯一判定依据;
       所以这里从录入顺序重算,而不是信任模型里可能过期的旧值。 */
    sort.answerOrder = sort.items.map((item) => item.id);
  }

  const match = out.match;
  if (match && match.enabled) {
    match.prompt = text(match.prompt);
    match.left = idLabelList(match.left);
    match.right = idLabelList(match.right);
    // 面板按「左 | 右」成对录入 ⇒ pairs 就是按下标对齐;玩家端 right 会被服务端打乱
    match.pairs = match.left.map((left, i) => [left.id, (match.right[i] || {}).id || '']);
  }

  const classify = out.classify;
  if (classify && classify.enabled) {
    classify.prompt = text(classify.prompt);
    classify.bins = idLabelList(classify.bins);
    classify.items = idLabelList(classify.items);
    // answer 不是派生字段(itemId → binId 只有商家知道),这里只清洗形状与文本
    const rawAnswer = (classify.answer && typeof classify.answer === 'object'
      && !Array.isArray(classify.answer)) ? classify.answer : {};
    const answer = {};
    Object.keys(rawAnswer).forEach((itemId) => {
      const binId = text(rawAnswer[itemId]);
      if (itemId && binId) answer[itemId] = binId;
    });
    classify.answer = answer;
  }

  return out;
}

/** 已清洗模型的校验。文案与服务端 AdvancedGameConfigValidator 对齐,让错误在本页就说清楚。 */
function validateNormalized(model, opts) {
  if (!model || Number(model.schemaVersion) !== SCHEMA_VERSION) return '高级玩法配置版本不受支持';
  // 呈现方式先于各段校验:它说的是「这个玩法长在哪」,是所有段共用的一条总开关
  const presentInvalid = presentError(model);
  if (presentInvalid) return presentInvalid;
  const mistakeTierInvalid = mistakeTierError(model);
  if (mistakeTierInvalid) return mistakeTierInvalid;
  const variantsInvalid = variantsError(model);
  if (variantsInvalid) return variantsInvalid;
  if (model.check && model.check.enabled) {
    const modsInvalid = modsError(model.check.mods);
    if (modsInvalid) return modsInvalid;
  }
  if (model.timer.enabled) {
    const seconds = Number(model.timer.durationSeconds);
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 86400) return '计时时长须为 10 秒至 24 小时';
  }
  if (model.random.enabled) {
    const items = Array.isArray(model.random.items) ? model.random.items : [];
    if (!items.length) return '盲盒至少配置 1 个物品';
    const ids = new Set();
    for (const item of items) {
      if (!item.id || !item.label || Number(item.weight) < 1) return '盲盒物品的 ID、名称和权重不能为空';
      if (ids.has(item.id)) return '盲盒物品 ID 不能重复';
      ids.add(item.id);
    }
    const draws = Number(model.random.drawCount);
    if (!Number.isInteger(draws) || draws < 1 || draws > items.length) return '盲盒抽取数量须在物品数量范围内';
    if (text(model.random.deckName).length > 20) return '卡池名称不能超过 20 字';
  }
  if (model.branch.enabled) {
    const steps = Array.isArray(model.branch.steps) ? model.branch.steps : [];
    const ids = new Set(steps.map(step => step.id));
    if (!steps.length || !ids.has(model.branch.startStepId)) return '分支剧情必须配置有效起点';
    const outcomeCodes = new Set();
    for (const step of steps) {
      if (!step.id || (!step.terminal && !(step.options || []).length)) return '分支剧情的非终点必须配置选项';
      if (step.terminal) {
        if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(String(step.outcomeCode || ''))) {
          return '分支终点 outcomeCode 只能使用大写字母、数字和下划线';
        }
        if (outcomeCodes.has(step.outcomeCode)) return '分支终点 outcomeCode 不能重复';
        outcomeCodes.add(step.outcomeCode);
      }
      for (const option of (step.options || [])) {
        if (!option.id || !option.label || !ids.has(option.nextStepId)) return '分支选项必须指向有效步骤';
      }
    }
  }
  if (model.leaderboard.enabled) {
    const limit = Number(model.leaderboard.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return '排行榜人数须为 1 至 100';
  }
  if (model.multiplayer.enabled) {
    const min = Number(model.multiplayer.minPlayers);
    const max = Number(model.multiplayer.maxPlayers);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max > 20 || min > max) return '多人玩法人数须为 2 至 20 人';
    const roles = Array.isArray(model.multiplayer.roles) ? model.multiplayer.roles : [];
    if (!roles.length) return '多人玩法至少配置 1 个角色';
    const roleIds = new Set();
    let totalRoleMin = 0;
    let totalRoleMax = 0;
    for (const role of roles) {
      const roleMin = Number(role.min);
      const roleMax = Number(role.max);
      if (!role.id || !role.label || roleIds.has(role.id)) return '多人角色 ID 和名称不能为空，且 ID 不能重复';
      if (!Number.isInteger(roleMin) || !Number.isInteger(roleMax)
        || roleMin < 0 || roleMax < 1 || roleMin > roleMax || roleMax > max) return '多人角色人数范围不正确';
      roleIds.add(role.id);
      totalRoleMin += roleMin;
      totalRoleMax += roleMax;
    }
    if (totalRoleMin > min || totalRoleMax < max) return '角色人数范围无法覆盖玩法人数';
    const turnOrder = Array.isArray(model.multiplayer.turnOrder) ? model.multiplayer.turnOrder : [];
    if (!turnOrder.length) return '多人玩法必须配置轮次顺序';
    if (turnOrder.some(id => !roleIds.has(id))) return '轮次顺序引用了不存在的角色';
    const requiredTurns = Number(model.multiplayer.requiredTurns);
    const unitScore = Number(model.multiplayer.unitScore);
    if (!Number.isInteger(requiredTurns) || requiredTurns < 1 || requiredTurns > 1000) return '多人玩法完成轮数须为 1 至 1000';
    if (!Number.isInteger(unitScore) || unitScore < 0 || unitScore > 100000) return '多人玩法单轮得分须为 0 至 100000';
    if (model.multiplayer.assignment === 'AUTO') {
      for (let playerCount = min; playerCount <= max; playerCount += 1) {
        const assigned = {};
        for (let i = 0; i < playerCount; i += 1) assigned[turnOrder[i % turnOrder.length]] = (assigned[turnOrder[i % turnOrder.length]] || 0) + 1;
        if (roles.some(role => (assigned[role.id] || 0) < Number(role.min)
          || (assigned[role.id] || 0) > Number(role.max))) return '自动分配顺序无法覆盖全部允许人数';
      }
    }
  }

  // ===== v5.1 新玩法 =====
  const timeWindow = model.timeWindow || {};
  if (timeWindow.enabled) {
    if (!CLOCK_PATTERN.test(text(timeWindow.openFrom)) || !CLOCK_PATTERN.test(text(timeWindow.openTo))) {
      return '开放时段须为 HH:mm 的 24 小时制';
    }
    // 起止相同既能读成"全天开放"也能读成"永不开放",歧义比不合法更危险
    if (text(timeWindow.openFrom) === text(timeWindow.openTo)) return '开放时段的起止不能相同';
    if (text(timeWindow.eyebrow).length > 32) return '时段限定眉标不能超过 32 字';
    if (text(timeWindow.title).length > 32) return '时段限定标题不能超过 32 字';
    if (text(timeWindow.subscribeTmplId).length > 64) return '订阅消息模板 id 不能超过 64 字';
  }

  const blindTaste = model.blindTaste || {};
  if (blindTaste.enabled) {
    const title = text(blindTaste.title);
    if (!title) return '盲品标题不能为空';
    if (title.length > 64) return '盲品标题不能超过 64 字';
    if (text(blindTaste.steps).length > 120) return '盲品步骤说明不能超过 120 字';
    if (text(blindTaste.hint).length > 60) return '盲品旁白不能超过 60 字';
    const options = Array.isArray(blindTaste.options) ? blindTaste.options : [];
    if (options.length < 2 || options.length > 6) return '盲品选项须为 2 至 6 项';
    const keys = new Set();
    for (const option of options) {
      const key = text(option && option.key);
      const label = text(option && option.label);
      if (!KEY_PATTERN.test(key)) return '盲品选项 key 只能使用 1 至 64 位字母、数字、下划线或短横线';
      if (keys.has(key)) return '盲品选项 key 不能重复';
      keys.add(key);
      if (!label) return '盲品选项文案不能为空';
      if (label.length > 32) return '盲品选项文案不能超过 32 字';
    }
    // 答案不在选项里 = 这题永远答不对,而且不报错。
    // 例外:采用公共库模板时 answerKey 被服务端剥掉、本地为空,发布时服务端会从源模板补回。
    const answerKey = text(blindTaste.answerKey);
    if (!(opts && opts.adoptedFromLibrary && !answerKey)
        && !keys.has(answerKey)) return '盲品正确答案必须是其中一个选项';
    const xp = Number(blindTaste.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 1000) return '盲品奖励分须为 0 至 1000';
  }

  const silentOrder = model.silentOrder || {};
  if (silentOrder.enabled) {
    const title = text(silentOrder.title);
    if (!title) return '沉默点单标题不能为空';
    if (title.length > 64) return '沉默点单标题不能超过 64 字';
    if (text(silentOrder.rule).length > 200) return '沉默点单规则说明不能超过 200 字';
    const limit = Number(silentOrder.limitSeconds);
    if (!Number.isInteger(limit) || (limit !== 0 && (limit < 60 || limit > 3600))) {
      return '沉默点单时限须为 60 秒至 1 小时，或 0 表示不限时';
    }
  }

  const diyName = model.diyName || {};
  if (diyName.enabled) {
    const title = text(diyName.title);
    if (!title) return '作品命名标题不能为空';
    if (title.length > 64) return '作品命名标题不能超过 64 字';
    const maxLength = Number(diyName.maxLength);
    if (!Number.isInteger(maxLength) || maxLength < 2 || maxLength > 40) return '作品名长度上限须为 2 至 40 字';
    const suggestions = Array.isArray(diyName.suggestions) ? diyName.suggestions : [];
    if (suggestions.length > 6) return '作品名备选最多 6 个';
    for (const item of suggestions) {
      const value = text(item);
      if (!value || value.length > maxLength) return '作品名备选不能为空且不能超过名称长度上限';
    }
  }

  const musicCorner = model.musicCorner || {};
  if (musicCorner.enabled) {
    const title = text(musicCorner.title);
    if (!title) return '音乐角标题不能为空';
    if (title.length > 64) return '音乐角标题不能超过 64 字';
    if (text(musicCorner.trackName).length > 40) return '曲目名不能超过 40 字';
    const audioUrl = text(musicCorner.audioUrl);
    if (audioUrl) {
      if (audioUrl.length > 512) return '曲目地址不能超过 512 字';
      const localPath = audioUrl.charAt(0) === '/' && audioUrl.slice(0, 2) !== '//' && audioUrl.indexOf('\\') < 0;
      if (!localPath && audioUrl.slice(0, 8) !== 'https://') return '曲目地址必须是 https 链接或站内路径';
    }
    const duration = Number(musicCorner.durationSeconds);
    if (!Number.isInteger(duration) || (duration !== 0 && (duration < 10 || duration > 3600))) {
      return '曲目时长须为 10 秒至 1 小时';
    }
  }

  const steps = model.steps || {};
  if (steps.enabled) {
    const goal = Number(steps.goal);
    if (!Number.isInteger(goal) || goal < 100 || goal > 100000) return '计步目标须为 100 至 100000 步';
    if (text(steps.eyebrow).length > 32) return '计步眉标不能超过 32 字';
    const xp = Number(steps.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 1000) return '计步奖励分须为 0 至 1000';
  }

  const dailySign = model.dailySign || {};
  if (dailySign.enabled) {
    const poems = Array.isArray(dailySign.poems) ? dailySign.poems : [];
    // 空签文池的例外同 blindTaste.answerKey:采用场景由服务端从源模板补回
    if (!(opts && opts.adoptedFromLibrary && !poems.length)
        && (!poems.length || poems.length > 60)) return '城市签签文须为 1 至 60 条';
    for (const poem of poems) {
      const lines = Array.isArray(poem) ? poem : [];
      if (!lines.length || lines.length > 4) return '每条签文须为 1 至 4 行';
      for (const line of lines) {
        const value = text(line);
        if (!value || value.length > 24) return '签文每行不能为空且不能超过 24 字';
      }
    }
    if (text(dailySign.signer).length > 16) return '签文落款不能超过 16 字';
    if (text(dailySign.sealText).length > 8) return '印文不能超过 8 字';
  }

  /* 跨日慢任务。边界与文案逐条对齐服务端 validateSlowTask。
     ⚠️ waitDays 上限 7 不是随手定的:超过一周的等待不是「低压」是遗忘,
     而回不来的任务会一直挂在未完成列表里,比没有这个任务更伤。 */
  const slowTask = model.slowTask || {};
  if (slowTask.enabled) {
    const slowTitle = text(slowTask.title);
    if (!slowTitle) return '跨日任务标题不能为空';
    if (slowTitle.length > 64) return '跨日任务标题不能超过 64 字';
    if (text(slowTask.startLabel).length > 24) return '开始按钮文案不能超过 24 字';
    if (text(slowTask.waitHint).length > 60) return '等待期提示不能超过 60 字';
    if (text(slowTask.unlockLabel).length > 24) return '解锁按钮文案不能超过 24 字';
    // 等隔天是为了看这一句 —— 没有它,玩家白等一天,这一屏断在那儿
    const unlockText = text(slowTask.unlockText);
    if (!unlockText) return '跨日任务解锁内容不能为空';
    if (unlockText.length > 200) return '解锁后揭示的内容不能超过 200 字';
    const waitDays = Number(slowTask.waitDays);
    if (!Number.isInteger(waitDays) || waitDays < 1 || waitDays > 7) {
      return '跨日任务的等待天数须为 1 至 7 天';
    }
    const slowXp = Number(slowTask.xp);
    if (!Number.isInteger(slowXp) || slowXp < 0 || slowXp > 1000) return '跨日任务奖励分须为 0 至 1000';
  }

  // ===== 自由探索四玩法。文案逐条对齐 AdvancedGameConfigValidator,
  //       让商家在本页就看懂错在哪,而不是提交后吃一句服务端报错。 =====
  const adopted = !!(opts && opts.adoptedFromLibrary);

  /* ===== 决定类与挑战类 =====
     边界值与服务端 AdvancedGameConfigValidator 一一对齐。
     ⚠️ 本地这几条不是「双保险」,是**给商家看的话**:服务端那句「变色就点轮数须为
     1 至 10」是发布失败时才蹦出来的,而商家这时候已经离开这个字段很久了。 */
  const coin = model.coinFlip || {};
  if (coin.enabled) {
    if (text(coin.kicker).length > 32) return '抛硬币标题不能超过 32 字';
    const sides = [['heads', '正面'], ['tails', '反面']];
    for (const [k, cn] of sides) {
      const f = coin[k] || {};
      if (text(f.label).length > 16) return cn + '名称不能超过 16 字';
      const act = text(f.action);
      // 「正面 / 反面」本身没有意义,写上要做什么才是一个玩法 —— 所以 action 必填
      if (!act) return cn + '要做什么不能为空';
      if (act.length > 60) return cn + '要做什么不能超过 60 字';
    }
  }

  const dice = model.diceRoll || {};
  if (dice.enabled) {
    if (text(dice.kicker).length > 32) return '掷骰子标题不能超过 32 字';
    if (dice.mode && dice.mode !== 'd6' && dice.mode !== 'd20') return '掷骰子规则不正确';
    if (dice.mode === 'd20') {
      if (!Number.isInteger(dice.dc) || dice.dc < 1 || dice.dc > 40) return 'D20 难度 DC 须为 1 至 40 的整数';
      if (!Number.isInteger(dice.modifier) || dice.modifier < -20 || dice.modifier > 20) return 'D20 加值须为 -20 至 20 的整数';
      if (['normal', 'advantage', 'disadvantage'].indexOf(dice.rollMode) < 0) return '请选择 D20 掷骰方式';
      if ((!adopted && !dice.successText) || dice.successText.length > 200) return 'D20 成功结果须为 1 至 200 字';
      if ((!adopted && !dice.failText) || dice.failText.length > 200) return 'D20 失败结果须为 1 至 200 字';
    } else {
    /* 这里**不查颗数、也不查面数**:validate 会先跑 normalize,那一步已经把颗数
       夹回 1/2、把面数补齐到 6。在这儿再写一条是走不到的死分支,而死分支比没有更坏 ——
       读的人会以为它在守着什么。真正的防线是服务端 validator,它拿到的是原始 JSON。 */
    const faces = Array.isArray(dice.faces) ? dice.faces : [];
    for (let i = 0; i < 6; i++) {
      const v = text(faces[i]);
      if (!v) return '掷骰子第 ' + (i + 1) + ' 面不能为空';
      if (v.length > 60) return '掷骰子第 ' + (i + 1) + ' 面不能超过 60 字';
    }
    }
  }

  const react = model.reaction || {};
  if (react.enabled) {
    if (text(react.kicker).length > 32) return '变色就点标题不能超过 32 字';
    const rounds = Number(react.rounds);
    if (!(rounds >= 1 && rounds <= 10)) return '变色就点轮数须为 1 至 10';
    const goalMs = Number(react.goalMs);
    // 120ms 是人类反应下限,低于它等于设了一个没人能达标的目标
    if (!(goalMs >= 120 && goalMs <= 2000)) return '达标毫秒须为 120 至 2000';
  }

  const ball = model.ballShake || {};
  if (ball.enabled) {
    if (text(ball.kicker).length > 32) return '弹球标题不能超过 32 字';
    const goal = Number(ball.goal);
    if (!(goal >= 1 && goal <= 200)) return '弹球撞击次数须为 1 至 200';
    if (ball.timed) {
      const sec = Number(ball.seconds);
      if (!(sec >= 3 && sec <= 300)) return '弹球限时须为 3 至 300 秒';
    }
  }

  const quiet = model.quietHold || {};
  if (quiet.enabled) {
    if (text(quiet.kicker).length > 32) return '安静挑战标题不能超过 32 字';
    const sec = Number(quiet.seconds);
    if (!(sec >= 5 && sec <= 300)) return '安静挑战时长须为 5 至 300 秒';
  }

  /* 罗盘指向。文案与服务端 AdvancedGameConfigValidator#validateCompass 逐字一致。
     ★ 这一段只发 xp:编辑页说明里写明「不能当到店凭证」(契约 §3.3),商家看不到文档。 */
  const cmp = model.compass || {};
  if (cmp.enabled) {
    if (text(cmp.kicker).length > 32) return '罗盘指向标题不能超过 32 字';
    const bearing = Number(cmp.bearing);
    if (!(cmp.bearing !== '' && cmp.bearing != null && Number.isInteger(bearing)
      && bearing >= 0 && bearing <= 359)) return '罗盘目标方位须为 0 至 359 度';
    const tol = Number(cmp.tolerance);
    if (!Number.isInteger(tol) || tol < 5 || tol > 90) return '罗盘容差须为 5 至 90 度';
    const hold = Number(cmp.holdSeconds);
    if (!Number.isInteger(hold) || hold < 1 || hold > 10) return '罗盘保持时长须为 1 至 10 秒';
    if (text(cmp.hint).length > 60) return '罗盘提示语不能超过 60 字';
    const cmpXp = Number(cmp.xp);
    if (!Number.isInteger(cmpXp) || cmpXp < 0 || cmpXp > 1000) return '罗盘指向奖励分须为 0 至 1000';
  }

  /* 喊一嗓子。文案与服务端 AdvancedGameConfigValidator#validateShout 逐字一致。 */
  const shout = model.shout || {};
  if (shout.enabled) {
    if (text(shout.kicker).length > 32) return '喊一嗓子标题不能超过 32 字';
    const sec = Number(shout.seconds);
    if (!(sec >= 5 && sec <= 300)) return '喊一嗓子时长须为 5 至 300 秒';
    const shoutXp = Number(shout.xp);
    if (!Number.isInteger(shoutXp) || shoutXp < 0 || shoutXp > 1000) return '喊一嗓子奖励分须为 0 至 1000';
  }

  const cdn = model.countdown || {};
  if (cdn.enabled) {
    if (text(cdn.kicker).length > 32) return '倒计时标题不能超过 32 字';
    const sec = Number(cdn.seconds);
    if (!(sec >= 5 && sec <= 3600)) return '倒计时时长须为 5 至 3600 秒';
    const done = text(cdn.doneText);
    if (!done) return '到点时说什么不能为空';
    if (done.length > 60) return '到点时说什么不能超过 60 字';
  }

  const stop = model.stopwatch || {};
  if (stop.enabled) {
    if (text(stop.kicker).length > 32) return '精准停表标题不能超过 32 字';
    const target = Number(stop.targetSeconds);
    if (!(target >= 3 && target <= 120)) return '精准停表目标须为 3 至 120 秒';
    const tol = Number(stop.toleranceMs);
    if (!(tol >= 50 && tol <= 5000)) return '精准停表容差须为 50 至 5000 毫秒';
    const tries = Number(stop.tries);
    if (!(tries >= 0 && tries <= 10)) return '精准停表次数须为 0 至 10,0 表示不限';
  }

  const estimate = model.estimate || {};
  if (estimate.enabled) {
    const title = text(estimate.title);
    if (!title) return '估数题干不能为空';
    if (title.length > 64) return '估数题干不能超过 64 字';
    if (text(estimate.unit).length > 8) return '估数单位不能超过 8 字';
    if (text(estimate.reveal).length > 200) return '估数揭示文案不能超过 200 字';
    const min = Number(estimate.min);
    const max = Number(estimate.max);
    const answer = Number(estimate.answer);
    const tolerance = Number(estimate.tolerance);
    // 采用公共库模板时 answer / tolerance 被服务端投影剥掉,本地读回来是 0,
    // 发布时由 backfillAdoptedSecrets 从源模板补回,这里不能拦下来
    const secretsStripped = adopted && !answer && !tolerance;
    if (![min, max].every(Number.isFinite)) return '估数的量程、答案与容差都必须是数字';
    if (min >= max) return '估数量程的下限必须小于上限';
    if (max - min > 1000000) return '估数量程跨度不能超过 1000000';
    if (!secretsStripped) {
      if (![answer, tolerance].every(Number.isFinite)) return '估数的量程、答案与容差都必须是数字';
      if (answer < min || answer > max) return '估数答案必须落在量程之内';
      if (tolerance <= 0) return '估数容差必须大于 0';
      if (tolerance > (max - min) / 2) return '估数容差不能超过量程的一半';
    }
    const xp = Number(estimate.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 1000) return '估数奖励分须为 0 至 1000';
  }

  const pricePair = model.pricePair || {};
  if (pricePair.enabled) {
    const title = text(pricePair.title);
    if (!title) return '猜图题目不能为空';
    if (title.length > 64) return '猜图题目不能超过 64 字';
    const items = Array.isArray(pricePair.items) ? pricePair.items : [];
    if (items.length < 3 || items.length > 8) return '猜图的图片须为 3 至 8 张';
    const ids = new Set();
    let correct = 0;
    for (const item of items) {
      const id = text(item && item.id);
      if (!KEY_PATTERN.test(id)) return '猜图图片 id 只能使用 1 至 64 位字母、数字、下划线或短横线';
      if (ids.has(id)) return '猜图图片 id 不能重复';
      ids.add(id);
      const name = text(item && item.name);
      if (!name) return '猜图图片说明不能为空';
      if (name.length > 32) return '猜图图片说明不能超过 32 字';
      const imageUrl = text(item && item.imageUrl);
      if (imageUrl) {
        if (imageUrl.length > 512) return '猜图图片地址不能超过 512 字';
        const localPath = imageUrl.charAt(0) === '/' && imageUrl.slice(0, 2) !== '//' && imageUrl.indexOf('\\') < 0;
        if (!localPath && imageUrl.slice(0, 8) !== 'https://') return '猜图图片地址必须是 https 链接或站内路径';
      }
      if (item && item.correct) correct += 1;
    }
    /* 正好一张。零张无解;多张等于「随便点都对」—— 两种都让玩家在屏前白站着。
       ⚠️ 采用场景(adopted)下 correct 会被服务端剥掉,所以那时不校验张数。 */
    if (!adopted && correct !== 1) return '猜图必须指定且只指定一张正确答案';
    const xp = Number(pricePair.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 200) return '猜图答对的奖励分须为 0 至 200';
    const maxTries = Number(pricePair.maxTries);
    if (!Number.isInteger(maxTries) || maxTries < 0 || maxTries > 10) return '猜图可以猜几次须为 0 至 10,0 表示不限';
  }

  const qa = model.qa || {};
  if (qa.enabled) {
    if (['TYPE', 'PICK', 'SHOT'].indexOf(qa.mode) < 0) return '问答模式只能是打字、选项或拍照';
    const title = text(qa.title);
    if (!title) return '问答题干不能为空';
    if (title.length > 120) return '问答题干不能超过 120 字';
    if (text(qa.lead).length > 60) return '问答前置说明不能超过 60 字';
    /* 拍照那一档的大屏正中就是这句提示词(见 playkit-qa 的 shotLead)——
       不填的话玩家看到的是一屏只有题干的空画面,不知道要拍什么。
       施工文档 §1.3 的 REQ 里 qaShot 也是要 title + 提示词两样。 */
    if (qa.mode === 'SHOT' && !text(qa.lead)) return '拍照打卡要写一句提示词,告诉玩家拍什么';
    if (text(qa.shotNote).length > 56) return '拍照补充说明不能超过 56 字';
    if (qa.mode === 'TYPE') {
      // 采用场景下答案被服务端剥掉了,本地不能因此判红
      const answer = text(qa.answerText);
      if (!adopted && !answer) return '打字问答必须填正确答案';
      if (answer.length > 200) return '问答答案不能超过 200 字';
    }
    if (qa.mode === 'PICK') {
      const options = Array.isArray(qa.options) ? qa.options : [];
      if (options.length < 2 || options.length > 4) return '选项问答须为 2 至 4 个选项';
      const ids = new Set();
      let correct = 0;
      for (const option of options) {
        const id = text(option && option.id);
        if (!KEY_PATTERN.test(id)) return '问答选项 id 只能使用 1 至 64 位字母、数字、下划线或短横线';
        if (ids.has(id)) return '问答选项 id 不能重复';
        ids.add(id);
        const label = text(option && option.label);
        if (!label) return '问答选项文案不能为空';
        if (label.length > 32) return '问答选项文案不能超过 32 字';
        if (text(option && option.fb).length > 120) return '问答选项反馈不能超过 120 字';
        if (option && option.correct) correct += 1;
      }
      /* 单选:正好一个(零个无解、多个等于随便点都对)。
         多选(2026-09-16 multi):至少一个 —— 零个同样无解,多个是这个开关的本来意思。 */
      if (!adopted) {
        if (qa.multi) {
          if (correct < 1) return '选项问答开了多选,至少要指定一个正确答案';
        } else if (correct !== 1) return '选项问答必须指定且只指定一个正确答案';
      }
    }
    const maxTries = Number(qa.maxTries);
    if (!Number.isInteger(maxTries) || maxTries < 0 || maxTries > 10) return '问答可以答几次须为 0 至 10,0 表示不限';
    const xp = Number(qa.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 200) return '问答的奖励分须为 0 至 200';
  }

  const scan = model.scan || {};
  if (scan.enabled) {
    // 文案与服务端 AdvancedGameConfigValidator.validateScan 逐字一致 —— 两处不一致时商家会看到两套说法
    if (['TEXT', 'VOICE', 'IMAGE', 'OVERLAY'].indexOf(scan.kind) < 0) return '扫码回复只能是文字、语音、图片或显形';
    const reply = text(scan.reply);
    if (reply.length > 200) return '扫码回复不能超过 200 字';
    if (scan.kind === 'TEXT' && !reply) return '扫码回文字就得写一句话';
    if (scan.kind === 'VOICE' && !text(scan.audioUrl)) return '扫码回语音就得配一段语音';
    if (scan.kind === 'IMAGE' && !text(scan.imageUrl)) return '扫码回图片就得配一张图';
    if (scan.kind === 'OVERLAY' && !text(scan.overlayUrl)) return '扫码要显形就得配一张叠加图';
    const arMode = scan.arMode || 'NONE';
    if (['NONE', 'PLANE', 'MARKER'].indexOf(arMode) < 0) return '显形的 AR 方式只能是不开、平面放置或图像识别';
    if (arMode !== 'NONE' && scan.kind !== 'OVERLAY') return '只有显形档能开 AR';
    if (arMode === 'MARKER' && !text(scan.markerUrl)) return '图像识别要配一张识别图';
    const modelUrl = text(scan.modelUrl);
    if (modelUrl) {
      if (arMode === 'NONE') return '开了 AR 才能放 3D 模型';
      // OSS 签名地址带查询串:认 .glb 看路径
      if (!/\.glb$/i.test(modelUrl.split(/[?#]/)[0])) return '3D 模型只支持 .glb';
    }
    const scale = Number(scan.overlayScale);
    if (Number.isFinite(scale) && (scale < 20 || scale > 100)) return '扫码显形图占比须为 20 至 100';
    const xp = Number(scan.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 200) return '扫码的奖励分须为 0 至 200';
  }

  const hiddenObject = model.hiddenObject || {};
  if (hiddenObject.enabled) {
    const title = text(hiddenObject.title);
    if (!title) return '找东西标题不能为空';
    if (title.length > 64) return '找东西标题不能超过 64 字';
    if (text(hiddenObject.hint).length > 60) return '找东西提示不能超过 60 字';
    const hoTries = Number(hiddenObject.maxTries);
    if (!Number.isInteger(hoTries) || hoTries < 0 || hoTries > 10) {
      return '找东西可以错几次须为 0 至 10,0 表示不限';
    }
    const imageUrl = text(hiddenObject.imageUrl);
    if (!imageUrl) return '找东西必须有一张图';
    if (imageUrl.length > 512) return '找东西图片地址不能超过 512 字';
    const localPath = imageUrl.charAt(0) === '/' && imageUrl.slice(0, 2) !== '//' && imageUrl.indexOf('\\') < 0;
    if (!localPath && imageUrl.slice(0, 8) !== 'https://') return '找东西图片地址必须是 https 链接或站内路径';
    const spots = Array.isArray(hiddenObject.hotspots) ? hiddenObject.hotspots : [];
    if (spots.length < 3 || spots.length > 5) return '找东西要标 3 至 5 个目标';
    const ids = new Set();
    const placed = [];
    for (const spot of spots) {
      const id = text(spot && spot.id);
      if (!KEY_PATTERN.test(id)) return '找东西目标 id 只能使用 1 至 64 位字母、数字、下划线或短横线';
      if (ids.has(id)) return '找东西目标 id 不能重复';
      ids.add(id);
      const label = text(spot && spot.label);
      if (!label) return '找东西目标名不能为空';
      if (label.length > 24) return '找东西目标名不能超过 24 字';
      const x = Number(spot && spot.x);
      const y = Number(spot && spot.y);
      const r = Number(spot && spot.r);
      /* 坐标是采用场景被服务端剥掉的秘密字段,剥掉了就放行。
         ⚠️ 只看 x/y:2026-09-11 起半径不再由商家填、normalize 一律补上系统值,
         再把 r 算进「被剥掉」的条件里,这条放行永远不成立 —— 采用来的模板会被判红。 */
      if (adopted && !Number.isFinite(x) && !Number.isFinite(y)) continue;
      if (![x, y, r].every(Number.isFinite)) return '找东西目标的坐标与半径必须是数字';
      if (x < 0 || x > 1 || y < 0 || y > 1) return '找东西目标的坐标须为 0 到 1 之间的比例值';
      if (r < 0.03 || r > 0.15) return '找东西目标的半径须为 0.03 到 0.15 之间';
      // 两个目标挨太近,玩家点一下会同时落在两个圈里,谁也说不清点中了哪个
      for (const other of placed) {
        const dx = x - other[0];
        const dy = y - other[1];
        if (Math.sqrt(dx * dx + dy * dy) < r + other[2]) return '找东西的两个目标挨得太近,请把它们分开一些';
      }
      placed.push([x, y, r]);
    }
    const xp = Number(hiddenObject.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 1000) return '找东西奖励分须为 0 至 1000';
  }

  const predict = model.predict || {};
  if (predict.enabled) {
    const question = text(predict.question);
    if (!question) return '竞猜问题不能为空';
    if (question.length > 120) return '竞猜问题不能超过 120 字';
    if (text(predict.hint).length > 60) return '竞猜说明不能超过 60 字';
    const options = Array.isArray(predict.options) ? predict.options : [];
    if (options.length < 2 || options.length > 4) return '竞猜选项须为 2 至 4 个';
    const keys = new Set();
    for (const option of options) {
      const key = text(option && option.key);
      if (!KEY_PATTERN.test(key)) return '竞猜选项 key 只能使用 1 至 64 位字母、数字、下划线或短横线';
      if (keys.has(key)) return '竞猜选项 key 不能重复';
      keys.add(key);
      const label = text(option && option.label);
      if (!label) return '竞猜选项文案不能为空';
      if (label.length > 32) return '竞猜选项文案不能超过 32 字';
    }
    const closeAtHour = Number(predict.closeAtHour);
    if (!Number.isInteger(closeAtHour) || closeAtHour < 0 || closeAtHour > 23) {
      return '竞猜截止时间须为 0 到 23 点之间的整点';
    }
    const revealDays = Number(predict.revealDays);
    if (!Number.isInteger(revealDays) || revealDays < 0 || revealDays > 30) {
      return '竞猜揭晓天数须为 0 至 30 天(0 表示当天)';
    }
    const revealHour = Number(predict.revealHour);
    if (!Number.isInteger(revealHour) || revealHour < 0 || revealHour > 23) {
      return '竞猜揭晓时间须为 0 到 23 点之间的整点';
    }
    // 截止之后才揭晓:同一天里先公布答案再收注,那就不是猜了
    if (revealDays === 0 && revealHour < Number(predict.closeAtHour)) {
      return '当天揭晓的话,揭晓时间要晚于收注截止时间';
    }
    const xp = Number(predict.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > 1000) return '竞猜奖励分须为 0 至 1000';
  }

  /* ===== 《预制人生》五段(契约 §2)。只查契约里写死的取值范围 ——
     契约没给的说法(标题长度、奖励分上限)留空,别在这里发明一条商家改不动的规则。 ===== */
  const profile = model.profile || {};
  if (profile.enabled) {
    const questions = Array.isArray(profile.questions) ? profile.questions : [];
    if (questions.length < 1 || questions.length > 8) return '建档的问题须为 1 至 8 个';
    const keys = new Set();
    for (const question of questions) {
      const key = text(question && question.key);
      if (!PROFILE_KEY_PATTERN.test(key)) return '建档问题的变量名要字母开头，最多 16 位字母、数字或下划线';
      if (keys.has(key)) return '建档问题的变量名不能重复';
      keys.add(key);
      if (!text(question && question.label)) return '建档问题的问题文案不能为空';
      if (question && question.kind !== 'pick') continue;
      const options = Array.isArray(question.options) ? question.options : [];
      if (options.length < 2 || options.length > 6) return '选项题须为 2 至 6 个选项';
      const optionKeys = new Set();
      for (const option of options) {
        const optionKey = text(option && option.key);
        if (!optionKey) return '建档选项的存值不能为空';
        if (optionKeys.has(optionKey)) return '同一题里选项的存值不能重复';
        optionKeys.add(optionKey);
        if (!text(option && option.label)) return '建档选项文案不能为空';
        // 加成复用现成的 effects 形状(契约 §2.1):校验照 validateEffects,别自创一套
        const bonusError = effectError(option && option.effects, '建档选项的加成');
        if (bonusError) return bonusError;
      }
    }
  }

  const photoCheck = model.photoCheck || {};
  if (photoCheck.enabled) {
    const requirement = text(photoCheck.requirement);
    if (requirement.length < 1 || requirement.length > 60) {
      return '拍照审核要写清楚拍到什么才算过，1 至 60 字';
    }
    const minConfidence = Number(photoCheck.minConfidence);
    if (!Number.isInteger(minConfidence) || minConfidence < 0 || minConfidence > 100) {
      return '拍照审核的置信度分数线须为 0 至 100';
    }
    const maxTries = Number(photoCheck.maxTries);
    if (!Number.isInteger(maxTries) || maxTries < 1 || maxTries > 10) return '拍照审核可以拍几次须为 1 至 10';
    if (PHOTO_CHECK_FALLBACKS.indexOf(photoCheck.fallback) < 0) return '拍照审核的兜底只能是让他重拍或放过他';
    /* 卡片三字段(立体藏品卡契约 §2.1)。口径与后端 validatePhotoCheck 逐字对齐:
       mode 只认空(老拍照审核)与 CARD;cardStyle 只认空(默认带高光)、foil、plain。
       本地放行而服务端判死 = 商家点「发布」才看到一句陌生的报错,那一屏就白配了。 */
    const cardMode = text(photoCheck.mode);
    if (cardMode && PHOTO_CHECK_MODES.indexOf(cardMode) < 0) {
      return '拍照审核只认两种:普通审核,或拍物成卡';
    }
    if (text(photoCheck.cardTitle).length > 64) return '藏品卡名称不能超过 64 字';
    const cardStyle = text(photoCheck.cardStyle);
    if (cardStyle && PHOTO_CARD_STYLES.indexOf(cardStyle) < 0) {
      return '藏品卡样式只能是有高光或不带高光';
    }
  }

  /* R14 检定:只校验暴露给编辑器的六项,加上服务端也认的那条 checkId 形状。
     没暴露的字段(mods / critEffects 等)由服务端 validateCheck 把关 —— 本地重复实现
     一整套条件校验只会在读进来的既有配置上误报。 */
  const journeyCheck = model.check || {};
  if (journeyCheck.enabled) {
    if (!CHECK_ID_PATTERN.test(text(journeyCheck.checkId))) {
      return '检定的稳定标识只能使用 1 至 64 位字母、数字、下划线或短横线';
    }
    if (CHECK_TIERS.indexOf(journeyCheck.tier) < 0) return '检定难度只能是 easy、medium 或 hard';
    if (text(journeyCheck.skill).length > 200) return '检定技能名不能超过 200 字';
    if (text(journeyCheck.successText).length > 200) return '检定成功文案不能超过 200 字';
    if (text(journeyCheck.failText).length > 200) return '检定失败文案不能超过 200 字';
    const checkEffectError = effectError(journeyCheck.successEffects, '检定通过效果')
      || effectError(journeyCheck.failEffects, '检定失败效果');
    if (checkEffectError) return checkEffectError;
  }

  const album = model.album || {};
  if (album.enabled) {
    if (!Array.isArray(album.images) || album.images.length < 1 || album.images.length > 6) return '相册须配 1 至 6 张照片';
    for (const image of album.images) {
      if (!image || !/^(https:\/\/|\/(?!\/))/.test(text(image.url))) return '请先上传相册照片';
      if (text(image.url).length > 1024) return '相册照片地址不能超过 1024 字';
      if (text(image.line).length > 40) return '照片配文不能超过 40 字';
    }
  }
  const note = model.note || {};
  if (note.enabled) {
    // 与服务端 validateNote 同口径:两项都必填,前端不拦就是「存得下、发不出」(2026-09-24 C-03)
    if (!text(note.title)) return '留言标题不能为空';
    if (text(note.title).length > 64) return '留言标题不能超过 64 字';
    if (!text(note.prompt)) return '留言提示不能为空';
    if (text(note.prompt).length > 120) return '留言提示不能超过 120 字';
    const presets = Array.isArray(note.presets) ? note.presets : [];
    if (presets.length > 6) return '预设短句最多 6 条';
    for (const preset of presets) {
      if (!text(preset)) return '预设短句不能为空';
    }
    const showPrevious = Number(note.showPrevious);
    if (!Number.isInteger(showPrevious) || showPrevious < 0 || showPrevious > 5) {
      return '给后来的人看几条须为 0 至 5';
    }
  }

  const typeIn = model.typeIn || {};
  if (typeIn.enabled) {
    const target = text(typeIn.target);
    if (target.length < 1 || target.length > 40) return '要打的字须为 1 至 40 字';
    const seconds = Number(typeIn.seconds);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 120) return '限时打字须为 3 至 120 秒';
    const tries = Number(typeIn.tries);
    if (!Number.isInteger(tries) || tries < 0) return '可以打几次不能是负数，0 表示不限';
  }

  /* ===== 推理类三玩法 =====
     边界与文案对齐服务端 AdvancedGameConfigValidator(契约 2026-09-16):
     id 正则 [A-Za-z0-9_-]{1,32} 组内唯一;label ≤40;prompt ≤200。
     ⚠️ sort.answerOrder 与 match.pairs 在 normalize 里按录入顺序派生,覆盖性是构造保证,
        这里**不写**它们的覆盖检查 —— 那会是一条永远走不到的死分支。 */
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
  const labelList = (list, cn) => {
    const rows = Array.isArray(list) ? list : [];
    const ids = new Set();
    for (const row of rows) {
      const id = text(row && row.id);
      if (!ID_PATTERN.test(id)) return cn + '的 id 只能使用 1 至 32 位字母、数字、下划线或短横线';
      if (ids.has(id)) return cn + '的 id 不能重复';
      ids.add(id);
      const label = text(row && row.label);
      if (!label) return cn + '的文案不能为空';
      if (label.length > 40) return cn + '的文案不能超过 40 字';
    }
    return '';
  };
  const promptError = (prompt, cn) => {
    const value = text(prompt);
    if (!value) return cn + '的题干不能为空';
    if (value.length > 200) return cn + '的题干不能超过 200 字';
    return '';
  };

  const sort = model.sort || {};
  if (sort.enabled) {
    const promptIssue = promptError(sort.prompt, '排序');
    if (promptIssue) return promptIssue;
    const items = Array.isArray(sort.items) ? sort.items : [];
    if (items.length < 2 || items.length > 8) return '排序的条目须为 2 至 8 条';
    const itemIssue = labelList(items, '排序条目');
    if (itemIssue) return itemIssue;
  }

  const match = model.match || {};
  if (match.enabled) {
    const promptIssue = promptError(match.prompt, '连线');
    if (promptIssue) return promptIssue;
    const left = Array.isArray(match.left) ? match.left : [];
    const right = Array.isArray(match.right) ? match.right : [];
    if (left.length < 2 || left.length > 6) return '连线的左右两列须各为 2 至 6 项';
    if (left.length !== right.length) return '连线的左右两列数量必须一致,一一对应才能配对';
    const leftIssue = labelList(left, '连线左列');
    if (leftIssue) return leftIssue;
    const rightIssue = labelList(right, '连线右列');
    if (rightIssue) return rightIssue;
  }

  const classify = model.classify || {};
  if (classify.enabled) {
    const promptIssue = promptError(classify.prompt, '分类');
    if (promptIssue) return promptIssue;
    const bins = Array.isArray(classify.bins) ? classify.bins : [];
    if (bins.length < 2 || bins.length > 4) return '分类的类别须为 2 至 4 个';
    const binIssue = labelList(bins, '分类类别');
    if (binIssue) return binIssue;
    const items = Array.isArray(classify.items) ? classify.items : [];
    if (items.length < 2 || items.length > 10) return '分类的条目须为 2 至 10 条';
    const itemIssue = labelList(items, '分类条目');
    if (itemIssue) return itemIssue;
    const binIds = new Set(bins.map((bin) => text(bin && bin.id)));
    const answer = (classify.answer && typeof classify.answer === 'object'
      && !Array.isArray(classify.answer)) ? classify.answer : {};
    for (const item of items) {
      const binId = text(answer[text(item && item.id)]);
      // 没选类别 / 指向一个不存在的类别 —— 两种都让这条永远判不对,必须在本页拦下
      if (!binIds.has(binId)) return '分类的每一条都要选一个类别';
    }
  }

  return '';
}

/** opts.adoptedFromLibrary:采用公共库模板的场景,允许被服务端剥掉的秘密字段暂空(发布时服务端补回) */
function validate(model, opts) {
  if (!model || typeof model !== 'object') return '高级玩法配置版本不受支持';
  return validateNormalized(normalize(model), opts);
}

function serialize(model, opts) {
  const normalized = normalize(model);
  const error = validateNormalized(normalized, opts);
  if (error) throw new Error(error);
  // 一个段都没启用才算"没配高级玩法"。★ 未知段也要数进来 ——
  // 否则本模块不认识的将来机制会被当成空配置,存成空串就地删掉。
  if (!enabledSections(normalized).length && !extraKeys(normalized).length) return '';
  return JSON.stringify(normalized);
}

function mergeTopicCompletion(raw, mode, requiredCount) {
  let root = {};
  try { root = raw ? JSON.parse(raw) : {}; } catch (e) { root = {}; }
  if (!root || typeof root !== 'object' || Array.isArray(root)) root = {};
  root.nodeCompletion = mode === 'AT_LEAST'
    ? { mode: 'AT_LEAST', requiredCount: Number(requiredCount) }
    : { mode: 'ALL' };
  return JSON.stringify(root);
}

const BINGO_CELLS = 9;

/**
 * 宾果九格的**名称与奖励**。
 *
 * ★ 九格的点亮条件是服务端内置的、跨节点的(完成 N 个点 / 连续两天来 / 周末来一次……),
 *   商家一个字都不用填。所以这份配置里**没有 nodeId** —— 绑节点会让这份模板只能在
 *   那一个主题里用,换个主题就得重排;不绑,同一份配置谁都能直接拿去用。
 *   商家能改的只有「这一格叫什么」和「填上给什么」。
 *
 * ★ 发得出去的只有券和文字反馈。勋章不收 —— 勋章随节点列表提前下发给前端播动画,
 *   而节点列表是玩家开玩前就取的,那时一个格子都还没填上,「按结果发勋章」在现有
 *   链路里根本不存在(同服务端 RewardRulesValidator 的口径)。
 *
 * 内置文案在这里留一份镜像,只用来做编辑器的占位提示;真正的判定文案以服务端为准。
 */
const BINGO_DEFAULT_LABELS = [
  '完成第 1 个点', '完成 3 个点', '完成 5 个点',
  '一天内完成 3 个点', '两天各来一次', '连续两天来',
  '周末来一次', '完成 8 个点', '中午前完成一次'
];

/** 编辑器按 S 形依次填:第一行左→右,第二行右→左,第三行左→右 */
const BINGO_S_ORDER = [0, 1, 2, 5, 4, 3, 6, 7, 8];

function emptyBingoCells() {
  return Array.from({ length: BINGO_CELLS }, () => ({ label: '', couponId: 0, feedbackText: '' }));
}

function mergeTopicBingo(raw, bingo) {
  let root = {};
  try { root = raw ? JSON.parse(raw) : {}; } catch (e) { root = {}; }
  if (!root || typeof root !== 'object' || Array.isArray(root)) root = {};
  if (!bingo || !bingo.enabled) {
    delete root.bingo;   // 关掉就删键,留个 enabled:false 会让人以为还配着
    return JSON.stringify(root);
  }
  const cells = Array.isArray(bingo.cells) ? bingo.cells : [];
  root.bingo = {
    enabled: true,
    cells: Array.from({ length: BINGO_CELLS }, (_, i) => {
      const cell = cells[i] || {};
      const row = { label: text(cell.label) };
      const couponId = Number(cell.couponId) || 0;
      if (couponId > 0) row.couponId = couponId;
      const feedbackText = text(cell.feedbackText);
      if (feedbackText) row.feedbackText = feedbackText;
      return row;
    })
  };
  return JSON.stringify(root);
}

function parseTopicBingo(raw) {
  const empty = () => ({ enabled: false, cells: emptyBingoCells(), error: '' });
  if (!raw) return empty();
  try {
    const bingo = (JSON.parse(raw) || {}).bingo;
    if (!bingo || typeof bingo !== 'object' || !bingo.enabled) return empty();
    const out = empty();
    out.enabled = true;
    const cells = Array.isArray(bingo.cells) ? bingo.cells : [];
    for (let i = 0; i < BINGO_CELLS; i += 1) {
      const cell = cells[i] || {};
      out.cells[i] = {
        label: text(cell.label),
        couponId: Number(cell.couponId) || 0,
        feedbackText: text(cell.feedbackText)
      };
    }
    return out;
  } catch (e) {
    const out = empty();
    out.error = '九宫格配置无法读取，请重新配置';
    return out;
  }
}

/** 文案与服务端 TopicCompletionRulePolicy#validateBingo 对齐 */
function validateTopicBingo(bingo) {
  if (!bingo || !bingo.enabled) return '';
  const cells = Array.isArray(bingo.cells) ? bingo.cells : [];
  if (cells.length !== BINGO_CELLS) return `宾果九宫格要正好配 ${BINGO_CELLS} 格`;
  let anyReward = false;
  for (const cell of cells) {
    if (text(cell && cell.label).length > 24) return '宾果格子名称不能超过 24 字';
    if (text(cell && cell.feedbackText).length > 120) return '宾果格子奖励文案不能超过 120 字';
    if (Number(cell && cell.couponId) > 0 || text(cell && cell.feedbackText)) anyReward = true;
  }
  // 九格一个奖都没配 = 打开了开关却什么也没改,不如不开
  if (!anyReward) return '至少给一格配上奖励，否则开着九宫格和不开没区别';
  return '';
}

function parseTopicCompletion(raw) {
  if (!raw) return { mode: 'ALL', requiredCount: 1, error: '' };
  try {
    const root = JSON.parse(raw);
    const rule = root && root.nodeCompletion;
    if (!rule || rule.mode !== 'AT_LEAST') return { mode: 'ALL', requiredCount: 1, error: '' };
    return { mode: 'AT_LEAST', requiredCount: Number(rule.requiredCount) || 1, error: '' };
  } catch (e) {
    return { mode: 'ALL', requiredCount: 1, error: '通关规则无法读取，请重新配置' };
  }
}

module.exports = { SCHEMA_VERSION, CORE_SECTIONS, KIT_SECTIONS, PLAY_SECTIONS, INFERENCE_SECTIONS, SECTIONS,
  defaultConfig, parse, validate, serialize, enabledSections, normalize,
  mergeTopicCompletion, parseTopicCompletion,
  BINGO_CELLS, BINGO_DEFAULT_LABELS, BINGO_S_ORDER,
  PHOTO_CHECK_MODES, PHOTO_CARD_STYLES, PHOTO_CARD_FIELDS,
  mergeTopicBingo, parseTopicBingo, validateTopicBingo,
  PRESENT_VALUES, PRESENT_INLINE_DEFAULT, PRESENT_FULLSCREEN_ONLY, PRESENT_LOCK_REASON,
  defaultPresent, presentInlineLocked, explicitPresent, applyPresent, presentError,
  MISTAKE_TIERS, mistakeTierError,
  MAX_MODS, MAX_MOD_LABEL, MOD_PRESETS, LUCK_OPTIONS, luckIndex, applyLuck, normalizeMods, modsError,
  HP_LADDER, hpLadderOn, toggleHpLadder,
  RELAX_SECONDS, RELAX_ATTEMPTS, RELAX_TOLERANCE, RELAX_LOWER, MAX_VARIANTS, relaxError, variantsError, relaxChoices, isEditorVariant };
