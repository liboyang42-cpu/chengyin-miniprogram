const modal = require('../../../utils/modal.js');
const loading = require('../../../utils/loading.js');
const toast = require('../../../utils/toast.js');
let app = getApp();
/* 结果面板终态停留时长;跳转挂在面板 close 上,时长只此一处 */
const RESULT_SHEET_MS = 2000;
const { TOPIC_EDITOR_SWITCH_COLOR } = require('../../../utils/play-visual-tokens.js');
const roleGuard = require('../../../utils/roleGuard.js');
const optionMedia = require('../utils/publish/option-media.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const { safeUserMessage } = require('../../../utils/transport/safe-user-message.js');
const { formatDurationMinutes } = require('../../../utils/template-display.js');
const { isRecordList } = require('../../../utils/response-shape.js');
const advancedGameConfig = require('../utils/publish/advanced-game-config.js');
const advancedGamePreview = require('../utils/publish/advanced-game-preview.js');
const nodeGameCatalog = require('../utils/publish/node-game-catalog.js');
const nodeOutcomeContract = require('../utils/publish/node-outcome-contract.js');
const merchantAccessPolicy = require('../../../utils/merchant-access-policy.js');

/* 发布全量校验的报错顺序 —— validateForm 与「查看预览」置灰点击必须读同一份。
   2026-09-19 审查 F-PU-1:这里曾各自维护一份,发布那份漏了 interactionType,
   于是「据点玩法形态必选」的红字写出来了、按钮却放行,商家以为配好了。 */
const PUBLISH_ERROR_ORDER = ['title', 'description', 'players', 'duration', 'categoryIds',
  'interactionType', 'finish', 'advanced', 'voice', 'reward'];

function safeDecode(value) {
  try { return decodeURIComponent(String(value || '')); } catch (error) { return String(value || ''); }
}

function positiveId(value) {
  const id = typeof value === 'number' ? value : Number(String(value || '').trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isTemplateDetailPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.sysCategoryList != null && !isRecordList(value.sysCategoryList)) return false;
  const scalarFields = [
    'id', 'title', 'description', 'imgUrl', 'players', 'usageLocation',
    'requiredMaterials', 'duration', 'difficulty', 'ruleInstructions',
    'validationMethod', 'feedbackMethod', 'feedbackMethodStr', 'questionName',
    'questionAnswer', 'feedbackText', 'couponId', 'couponName', 'medalImg',
    'medalName', 'medalStyle', 'questionA', 'questionB', 'questionC',
    'questionD', 'correctAnswer', 'activityCategoryids', 'hint1', 'hint2',
    'answerReveal', 'photoRequireDesc', 'photoReview', 'audioUrl',
    'audioDuration', 'questionImg', 'questionAudio', 'questionOptionMediaJson',
    'storyText', 'storyJson', 'preferenceJson', 'advancedConfigJson', 'status'
  ];
  return scalarFields.every((key) => value[key] == null
    || ['string', 'number', 'boolean'].includes(typeof value[key]));
}

// 模块定义(常量,顺序即展示顺序)
// 提示(hint)已并入「完成方式」,不再是独立模块
const MODULE_DEFS = [
  { key: 'finish', name: '完成方式', desc: '玩家用什么方式通过这一关', iconName: 'check', tag: '核心', tagClass: 'cg-tag--core' },
  { key: 'reward', name: '完成奖励', desc: '优惠券 / 文字反馈 / 勋章', iconName: 'gift', tag: '推荐', tagClass: 'cg-tag--rec' },
  { key: 'story', name: '剧情故事', desc: '到达时的时间流叙事 · 逐节展开', iconName: 'edit', tag: '', tagClass: '' },
  { key: 'voice', name: '语音讲解', desc: '上传一段音频导览', iconName: 'play', tag: '', tagClass: '' },
];

// 完成方式 tile(value 对应 validationMethod 映射)
const METHOD_TILES = [
  { value: 6, iconName: 'filter-lines', label: '偏好题组', sub: '多步选择，生成确定性结果' },
  { value: 1, iconName: 'edit', label: '文字作答', sub: '写下现场看到或确认到的内容' },
  { value: 3, iconName: 'check', label: '选项问答', sub: '从选项中选出正确答案' },
  { value: 2, iconName: 'camera', label: '拍照打卡', sub: '上传现场照片' },
  { value: 4, iconName: 'qr-scan', label: '扫码打卡', sub: '扫描现场二维码' },
  { value: 5, iconName: 'gps', label: 'GPS 到达', sub: '走进坐标范围即通过' },
  { value: 0, iconName: 'check', label: '无需验证', sub: '点击即完成' },
  // 自由探索三玩法。它们的题面与答案都在「玩法配置」里配,tile 只负责选中完成方式;
  // 光选 tile 不开对应段的话,节点会退化成到达即通关(completesOnArrive 收了 8/9/10),
  // 玩法静默不存在 —— 所以 _collectValidationErrors 里有一条配套的必填校验。
  { value: 8, iconName: 'edit', label: '猜数字', sub: '猜一个数，按接近程度分档给分' },
  { value: 9, iconName: 'filter-lines', label: '猜图', sub: '几张图里挑出正确的那一张' },
  { value: 10, iconName: 'gps', label: '找东西', sub: '在图上点中藏起来的目标' },
];

// 完成方式 ↔ 玩法配置段:选了这个 tile,就必须把这一段打开填完
const PLAY_METHOD_SECTIONS = { 8: 'estimate', 9: 'pricePair', 10: 'hiddenObject' };
const PLAY_METHOD_LABELS = { 8: '猜数字', 9: '猜图', 10: '找东西' };

/** 行 id 生成:同毫秒连点两次不能撞 —— 撞了服务端会判「id 不能重复」 */
function rowId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

const ADVANCED_ROW_TEMPLATES = {
  // 猜图 2026-09-10 改模型:图片说明 + 是不是正确答案,不再有价格
  'pricePair.items': () => ({ id: rowId('pic'), name: '', imageUrl: '', correct: false }),
  'hiddenObject.hotspots': () => ({ id: rowId('spot'), label: '', x: 0.5, y: 0.5, r: 0.08 }),
  'predict.options': () => ({ key: rowId('opt'), label: '' }),
  'qa.options': () => ({ id: rowId('opt'), label: '', fb: '', correct: false })
};

// 竞猜截止小时:0–23 的整点
const PREDICT_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/* 第几天揭晓:0 当天 / 1 明天 / …… 存相对天数不存日期,模板复制出去照样成立 */
const PREDICT_DAYS = Array.from({ length: 31 }, (_, day) => day);
const PREDICT_DAY_LABEL = (day) => (day === 0 ? '当天' : day === 1 ? '明天' : day === 2 ? '后天' : '第 ' + day + ' 天');

// 面板内即时报错的段(推理类三玩法)。见 data.gameConfigError
const PANEL_LIVE_ERROR_SECTIONS = ['sort', 'match', 'classify'];

// 适用场所预设
const VENUE_OPTIONS = ['景区', '公园绿地', '商圈街区', '古镇老街', '博物馆', '校园', '室内场馆'];

// 支持提示的完成方式(文字/选项/GPS)
const HINT_METHODS = [1, 3, 5];

/* 单选一律是 cy-dropdown(2026-09-22 用户定):bind:change 的 detail.value 是下标,存的是那一项的 key */
function pickedItem(list, e) {
  return list[Number(e.detail.value)];
}

/** 时长统一带单位:表单存的是分钟数(dictValue),字典文案有时已带「分钟」。
 *  formatDurationMinutes 只认「分钟」这一档,小时口径原样保留,不叠成「1小时分钟」(CU-M-69)。 */
function durationWithUnit(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/小时|hour/i.test(raw)) return raw;
  return formatDurationMinutes(raw);
}

// 据点玩法语义(cms_member_template.interaction_type),正交于 validationMethod。
// 普通模板发布 DTO 没有这个字段,所以只在据点入口出现。
const INTERACTION_TYPES = [
  { key: 'city_story_card', label: '城市故事卡' },
  { key: 'hidden_menu', label: '隐藏菜单' },
  { key: 'photo_spot', label: '拍照点' },
  { key: 'qr_checkin', label: '到店扫码' }
];

/* 试玩出不来时说实话:检定是旅程里的一次掷骰,不是一屏玩法(C-04);其余才是真没填完。 */
function noPreviewTip(section) {
  if (section === 'album') return '请先为相册添加照片';
  return section === 'check' ? '技能检定在旅程里掷骰，编辑页演不了' : '这个玩法还要再填一点才能试玩';
}

Page({
  MODULE_DEFS: MODULE_DEFS,

  data: {
    operationScope: '',
    isMyScope: false, // R9-04:回填走个人草稿接口(/api/template/myinfo)
    merchantAccess: merchantAccessPolicy.inactiveAccess(),
    // 据点玩法语义(interaction_type,正交于 validationMethod)。只有 from=citynode 时显示。
    interactionTypes: INTERACTION_TYPES,
    // 「这个玩法怎么出现」的两档;被锁成只能整屏时整个下拉置灰,原因写在下面
    presentOptions: [{ key: 'inline', label: '内嵌故事流' }, { key: 'fullscreen', label: '整屏' }],
    diceCountOptions: [{ key: 1, label: '一颗' }, { key: 2, label: '两颗' }],
    // 勋章双样式(用户 8-07 拍板):二维发光 / 3D 珐琅;珐琅建议透明角方图
    medalStyleOptions: [{ key: 'glow', label: '二维发光' }, { key: 'enamel', label: '3D 珐琅' }],
    interactionType: '',
    themeSwitchColor: TOPIC_EDITOR_SWITCH_COLOR,
    info: {},
    useNum: 0,

    userData: {},
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    reducedMotion: false,

    durationOptions: [],
    difficultyOptions: [],
    durationIndex: 0,
    difficultyIndex: 0,
    dictLoading: { duration: true, difficulty: true, players: true },
    dictErrors: { duration: '', difficulty: '', players: '' },

    playersOptions: [],
    playersIndex: 0,

    // 选中项 label 文本(wxml 直接读)
    playersText: '',
    durationText: '',
    difficultyLabel: '',

    correctAnswerIndex: 0,
    correctAnswerOptions: [],

    // 玩法类别 - 多选
    selectedCategoryIds: [],
    selectedCategoryNames: [],
    categorySheetVisible: false,
    categorySheetIds: '',
    selectedCategoryNamesStr: '',
    categoryList: [],

    // 完成方式 tile
    methodTiles: METHOD_TILES,
    methodSupportsHint: false,
    hintEnabled: false,
    preferencePreview: [],
    preferenceConfigError: '',
    advanced: advancedGameConfig.defaultConfig(),
    /* 玩法模块:一个节点只选一个玩法(真源=原型「模板编辑页 v2」)。
       gameKey 是选中的那个,gameCurrent 是它在目录里的那一条,用来画已选卡。 */
    gameGroups: nodeGameCatalog.PICKER_GROUPS,
    gameKey: '',
    gameCurrent: null,
    gameSection: '',
    /* 呈现方式(契约 §1.5):presentChoice = 当前生效档(显式配的,或默认表推的),
       presentInlineLocked = 这个段是不是「只能全屏」那批 —— 那批的内嵌开关置灰并写明原因。 */
    presentChoice: 'fullscreen',
    presentInlineLocked: false,
    presentLockReason: '',
    // 这个玩法会不会真的执行限时(施工文档 §1.4)
    timerAvailable: true,
    gameSheetOpen: false,
    // 找东西:当前要在图上标位置的那个目标(-1 = 没在标)
    hotspotArming: -1,
    // 选择玩法半屏:分类快捷条当前在哪一组、要滚到哪个锚点
    sheetGroup: 0,
    sheetAnchor: '',
    // 签文池的换行草稿(编辑期事实源),与 advanced.dailySign.poems 一一对应
    dailySignDrafts: [],
    advancedConfigError: '',
    /* 选中玩法面板内的即时报错。只给推理类三段算 —— 其余玩法的错已经有各自的必填提示,
       全量在这里再报一遍会变成同一句话出现两处。 */
    gameConfigError: '',
    outcomePreview: [],
    outcomeContractErrors: [],
    timerTimeoutOptions: ['FAILED', 'EXPIRED'],
    leaderboardMetricOptions: ['ELAPSED_TIME', 'SCORE', 'COMPLETED_UNITS'],
    leaderboardScopeOptions: ['ACTIVITY', 'TOPIC'],
    multiplayerModeOptions: ['SEQUENTIAL', 'ROLE_BASED'],
    multiplayerAssignmentOptions: ['AUTO', 'LEADER'],
    predictHourOptions: PREDICT_HOURS,
    predictDayOptions: PREDICT_DAYS,
    predictDayLabel: PREDICT_DAY_LABEL(1),
    // 问答三种模式与扫码三种回复:key 是存进配置的稳定值,label 只给人看
    // 与「完成方式」同一套 tile 读法:三选一都是图标 + 名字 + 一句说明 + 右侧单选点
    qaModes: [
      { key: 'TYPE', iconName: 'edit', label: '打字答', sub: '玩家自己把答案打出来' },
      { key: 'PICK', iconName: 'check', label: '选项答', sub: '从你写的几个选项里挑一个' },
      { key: 'SHOT', iconName: 'camera', label: '拍一张', sub: '交一张照片,不判对错' },
    ],
    scanKinds: [
      { key: 'TEXT', iconName: 'edit', label: '文字', sub: '扫完弹一段话' },
      { key: 'VOICE', iconName: 'play', label: '语音', sub: '扫完放一段录音' },
      { key: 'IMAGE', iconName: 'image', label: '图片', sub: '扫完出一张图' },
      { key: 'OVERLAY', iconName: 'camera', label: '显形', sub: '扫完东西出现在镜头里' },
    ],
    // 显形档的真 AR:东西钉在现实里,手机怎么转它都在原地(手机跑不动时自动回落成镜头上叠一张图)
    scanArModes: [
      { key: 'NONE', label: '不开', sub: '镜头上叠一张图' },
      { key: 'PLANE', label: '放在地上', sub: '识别地面或桌面，点一下放在那儿' },
      { key: 'MARKER', label: '认一张图', sub: '认出你拍的实物照片，贴着它长出来' },
    ],
    // 《预制人生》新段的可选值:key 是存进配置的稳定值(契约 §2),label 只给人看
    profileKinds: [
      { key: 'text', label: '打字答' },
      { key: 'pick', label: '选项答' },
    ],
    // 状态写入的三个 op(真源 = AdvancedGameConfigValidator 的 EFFECT_OPS)
    effectOps: [
      { key: 'INC', label: '加' },
      { key: 'SET', label: '设为' },
      { key: 'ADD_TAG', label: '挂标记' },
    ],
    // 条件修正预设(真源 = advanced-game-config.js 的 MOD_PRESETS,两处由对拍测试钉住)
    hpLadderOn: false,        // 派生:advanced.check.mods 里阶梯全在
    luckOptions: advancedGameConfig.LUCK_OPTIONS,
    luckIndex: -1,            // 派生:-1 = 幸运开关关着
    relaxOptions: [],         // 派生:按当前启用的玩法段生成的放宽
    relaxIndex: -1,           // 派生:-1 = 放宽开关关着
    // R14 检定三档(真源 = validateCheck 的 CHECK_TIERS,是唯一的难度表达)
    checkTiers: [
      { key: 'easy', label: '简单' },
      { key: 'medium', label: '中等' },
      { key: 'hard', label: '困难' },
    ],
    d20RollModes: [
      { key: 'normal', label: '普通 · 掷一颗' },
      { key: 'advantage', label: '优势 · 两颗取高' },
      { key: 'disadvantage', label: '劣势 · 两颗取低' },
    ],
    photoCheckFallbacks: [
      { key: 'retake', label: '让他重拍' },
      { key: 'pass', label: '放过他' },
    ],

    // 完成奖励三 toggle
    rwCoupon: false,
    rwText: false,
    rwMedal: false,
    rwAny: false,

    // 剧情多节点
    storyBeats: [{ id: 1, text: '', tag: '', imgs: [] }],

    // 优惠券
    selectedCouponName: '',
    selectedCouponId: 0,

    // 通用底部选择器
    pickerSheet: { open: false, key: '', title: '', options: [] },

    // 校验滚动(scroll-view 内)
    scrollIntoView: '',

    errors: {},
    editorLoading: false,
    loadError: '',
    submitting: false,
    submittingAction: '',
    lastSubmitAction: '',
    submitError: '',
    dirty: false,
    formData: {
      originalTemplateId: 0,
      categoryId: 1,
      title: "",
      description: "",
      imgUrl: "",

      players: "",
      usageLocation: "",
      requiredMaterials: "",

      duration: "",
      difficulty: "",
      isSync: 1,
      ruleInstructions: "",
      validationMethod: 0,
      feedbackMethod: 0,
      questionName: "",
      questionAnswer: "",
      feedbackText: "",
      couponId: 0,
      medalImg: "",
      medalName: "",
      medalStyle: "glow",
      questionA: "",
      questionB: "",
      questionC: "",
      questionD: "",
      correctAnswer: "A",
      activityCategoryids: "",

      // 题干附件(看图答题 / 听音答题)。与「语音讲解」模块的 audioUrl 不是一回事:
      // 那是整节点的导览音,这是这道题的题面。
      questionImg: "",
      questionAudio: "",
      // 选项媒体,序列化自 optionItems 的 img/audio(见 utils/publish/option-media.js)
      questionOptionMediaJson: "",
      preferenceJson: "",
      advancedConfigJson: "",

      // 提示(并入完成方式)
      hint1: "",
      hint2: "",
      answerReveal: "",

      // 拍照
      photoRequireDesc: "",
      photoReview: 0,

      // 语音
      audioUrl: "",
      audioDuration: "",
      audioFileName: "",
      audioFormat: "",

      // 剧情:storyText 供玩家节点直接读取,storyJson 保存富剧情分节
      storyText: "",
      storyJson: "",

      status: 1, // 0=草稿 1=发布
    },

    optionItems: [],
    optionQuestion: "",

    // 模块状态
    moduleList: [],
    availableModules: [],
    showAddSheet: false,
    canOpenPreview: false,
    previewVisible: false,
    /* 玩法规则的展示形态:一行一步。真值仍在 formData.ruleInstructions(换行分隔),
       这里只是把它拆开给界面用,存盘前再拼回去 —— 不新建后端字段。 */
    ruleSteps: [''],
    // 预览要演的那一屏玩法。null = 这个节点没开玩法配置,回落到基础验证那套
    pvKit: null,
    canPublishGame: false,
    /* CU-M-69:「保存前摘要」自己的一份读数。原来它直插 pvMethodLabel —— 那是预览状态机字段,
       初值恰好是「无需验证」,只有走到点位任务那一步才会被覆盖 ⇒ 一打开预览就先否认核验,
       而同一屏第 3 步又要求作答;时长也只印了个裸数字。摘要一律按当前表单真值算,
       与预览走到哪一步无关。 */
    summaryMethodLabel: '',
    summaryDurationText: '',
    audioPreviewPlaying: false,

    // 预览态状态机
    pvSteps: [],
    pvStep: 0,
    pvStepKey: '',
    pvStepLabel: '',
    pvBeats: [],
    pvMethodIconName: 'check',
    pvMethodLabel: '无需验证',
    pvChallengeTitle: '',
    pvSubmitLabel: '完成',
    pvAnswer: '',
    pvSelected: null,
    pvWrong: false,
    pvHasHint: false,
    pvHintShown: false,
    pvHintText: '',
    creationSuccess: { show: false, eyebrow: '', title: '', detail: '', metaPrimary: '', metaSecondary: '', primaryText: '', secondaryText: '', showSecondary: false, primaryAction: '', secondaryAction: '', closeAction: '' },
    /* 本页两支成功态并存:「节点玩法已保存」留 creation-success(有 dismiss 分叉),
       「模板草稿已保存 / 已发布」走结果面板(纯导航,收敛成直接跳)。 */
    resultSheet: { show: false, kind: 'success', title: '', sub: '', meta: '', pill: '',
      why: '', duration: 2000 },
  },

  goBack() {
    if (this.data.previewVisible) {
      this.destroyPreviewAudio();
      this.setData({ previewVisible: false, canPublishGame: false });
      return;
    }
    if (this.data.submitting) return;
    if (!this.data.dirty) {
      this.exitPage();
      return;
    }
    modal.show({
      title: '放弃未保存的玩法？',
      content: '本次修改尚未保存为草稿。',
      confirmText: '放弃',
      cancelText: '继续编辑',
      success: (res) => {
        if (res.confirm) this.exitPage();
      }
    });
  },

  exitPage() {
    this.destroyPreviewAudio();
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/template/index' })
    });
  },

  onUnload: function () { this._albumEditRevision = (this._albumEditRevision || 0) + 1; this.destroyPreviewAudio(); },

  onShow: function () {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },

  // ===== 玩法配置（模板级，配置快照由服务端在开局时冻结） =====
  chooseAlbumImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    const current = this.data.advanced.album.images;
    const revision = this._albumEditRevision;
    const replacing = Number.isInteger(index) && index >= 0 && index < current.length;
    if (!replacing && current.length >= 6) return;
    const target = replacing ? current[index] : null;
    app.chooseImage((res) => {
      const url = res && res[0];
      if (!url || this.data.gameKey !== 'album' || revision !== this._albumEditRevision) return;
      // 上传期间可能改了配文或删了照片:合进最新的列表,不拿开始时的快照覆盖
      const images = this.data.advanced.album.images.slice();
      if (replacing) {
        if (!images[index] || images[index].url !== target.url) { toast('照片顺序变了，请重新替换'); return; }
        images[index] = Object.assign({}, images[index], { url });
      } else {
        if (images.length >= 6) { toast('最多 6 张照片'); return; }
        images.push({ url, line: '' });
      }
      this._setFormState({ 'advanced.album.images': images, advancedConfigError: '' });
    }, 1);
  },
  onAlbumLine(e) {
    const index = Number(e.currentTarget.dataset.index);
    const images = this.data.advanced.album.images.map((image, i) => i === index
      ? Object.assign({}, image, { line: e.detail.value }) : image);
    this._setFormState({ 'advanced.album.images': images, advancedConfigError: '' });
  },
  removeAlbumImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({ 'advanced.album.images': this.data.advanced.album.images.filter((_, i) => i !== index), advancedConfigError: '' });
  },

  onAdvancedToggle: function (e) {
    const key = e.currentTarget.dataset.key;
    this._setFormState({ [`advanced.${key}.enabled`]: !!e.detail.value, advancedConfigError: '' });
  },
  onAdvancedField: function (e) {
    const section = e.currentTarget.dataset.section;
    const field = e.currentTarget.dataset.field;
    const numeric = e.currentTarget.dataset.numeric === '1';
    const value = numeric ? Number(e.detail.value) : e.detail.value;
    this._setFormState({ [`advanced.${section}.${field}`]: value, advancedConfigError: '' });
  },
  /* 段里的子开关(目前只有弹球的「限时」)。
     不复用 onAdvancedToggle:那个的 data-key 拼的是 `advanced.<key>.enabled`,
     而这里要改的是 `advanced.ballShake.timed` —— 硬塞进去会写出
     `advanced.ballShake.timed.enabled` 这种没人读的字段,而且不报错。 */
  onAdvancedSubToggle: function (e) {
    const path = e.currentTarget.dataset.key;
    this._setFormState({ [`advanced.${path}`]: !!e.detail.value, advancedConfigError: '' });
  },
  /* 罗盘取值:商家站在目标方向上点一下,量 1.5 秒取中位数填进 bearing。
     取中位数不取最后一帧 —— 单帧读数会被手机壳里的磁铁、金属桌面瞬间带偏几十度。
     模拟器不报罗盘:等不到一帧就明说,别让商家以为「转半天没反应是我站得不对」。 */
  onCompassCapture: function () {
    if (this._compassCapturing) return;
    this._compassCapturing = true;
    const samples = [];
    const cb = (res) => {
      const d = res && Number(res.direction);
      if (Number.isFinite(d)) samples.push(d);
    };
    let fired = false;
    const done = () => {
      if (fired) return;
      fired = true;
      this._compassCapturing = false;
      try { if (wx.offCompassChange) wx.offCompassChange(cb); } catch (err) { /* 没注册成功过 */ }
      try { wx.stopCompass(); } catch (err) { /* 已经停了 */ }
      if (!samples.length) { toast('这台设备没报出方向，请在真机上试'); return; }
      const sorted = samples.slice().sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      this._setFormState({ 'advanced.compass.bearing': Math.round(((mid % 360) + 360) % 360), advancedConfigError: '' });
      toast('已记下当前方向');
    };
    wx.onCompassChange(cb);
    setTimeout(done, 1500);
  },
  // 一颗还是两颗。两颗只报点数和,不对应任务 —— 拿和去索引六个面会越界
  onDiceCount: function (e) {
    const count = (pickedItem(this.data.diceCountOptions, e) || { key: 1 }).key;
    this._setFormState({ 'advanced.diceRoll.diceCount': count, advancedConfigError: '' });
  },
  onD20RollMode: function (e) {
    const mode = pickedItem(this.data.d20RollModes, e);
    if (mode) this._setFormState({ 'advanced.diceRoll.rollMode': mode.key, advancedConfigError: '' });
  },
  // 六个面各一个输入框。走下标路径,不能复用 onAdvancedField 的 `段.字段` 形状
  onDiceFace: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!(index >= 0 && index < 6)) return;
    this._setFormState({ [`advanced.diceRoll.faces[${index}]`]: e.detail.value, advancedConfigError: '' });
  },
  onAdvancedPicker: function (e) {
    const section = e.currentTarget.dataset.section;
    const field = e.currentTarget.dataset.field;
    const options = this.data[e.currentTarget.dataset.options] || [];
    const value = options[Number(e.detail.value)];
    const patch = { [`advanced.${section}.${field}`]: value };
    // 第几天揭晓要同时更新那颗下拉自己显示的字:数字存 0/1/2,人看的是「当天/明天/后天」
    if (section === 'predict' && field === 'revealDays') patch.predictDayLabel = PREDICT_DAY_LABEL(value);
    this._setFormState(patch);
  },
  // 三个新玩法各有一组可增删的行(比价商品 / 找东西目标 / 竞猜选项)。
  // 用一组通用增删改代替三套复制粘贴;行的默认形状按「段.字段」查表。
  // id / key 一律自动生成,不让商家手填 —— 手填必然出现重复和空值,而那两种错都要到
  // 提交时才被服务端拦下,商家看到的是一句读不懂的报错。
  addAdvancedRow: function (e) {
    const path = e.currentTarget.dataset.path;
    const make = ADVANCED_ROW_TEMPLATES[path];
    if (!make) return;
    const list = this._advancedList(path).concat(make());
    this._setFormState({ [`advanced.${path}`]: list, advancedConfigError: '' });
  },
  updateAdvancedRow: function (e) {
    const path = e.currentTarget.dataset.path;
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    // scale=100:商家按元输入,存回去是分(服务端只认分)
    const scale = Number(e.currentTarget.dataset.scale) || 0;
    const numeric = e.currentTarget.dataset.numeric === '1' || scale > 0;
    let value = e.detail.value;
    if (numeric) {
      const parsed = Number(value);
      // 输入框允许暂时为空/半截小数,存 NaN 会被 normalize 删键,不会顶个 0 上去
      value = scale > 0 ? Math.round(parsed * scale) : parsed;
    }
    const list = this._advancedList(path)
      .map((row, i) => (i === index ? Object.assign({}, row, { [field]: value }) : row));
    this._setFormState({ [`advanced.${path}`]: list, advancedConfigError: '' });
  },
  removeAdvancedRow: function (e) {
    const path = e.currentTarget.dataset.path;
    const index = Number(e.currentTarget.dataset.index);
    const list = this._advancedList(path).filter((_, i) => i !== index);
    this._setFormState({ [`advanced.${path}`]: list, advancedConfigError: '' });
  },
  _advancedList: function (path) {
    const parts = path.split('.');
    const section = this.data.advanced[parts[0]] || {};
    return Array.isArray(section[parts[1]]) ? section[parts[1]] : [];
  },
  addRandomItem: function () {
    const items = (this.data.advanced.random.items || []).concat({
      id: `item_${Date.now()}`, label: '', weight: 1, content: ''
    });
    this._setFormState({ 'advanced.random.items': items });
  },
  updateRandomItem: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const numeric = e.currentTarget.dataset.numeric === '1';
    const items = this.data.advanced.random.items.map((item, i) => i === index
      ? Object.assign({}, item, { [field]: numeric ? Number(e.detail.value) : e.detail.value }) : item);
    this._setFormState({ 'advanced.random.items': items });
  },
  removeRandomItem: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({ 'advanced.random.items': this.data.advanced.random.items.filter((_, i) => i !== index) });
  },
  addBranchStep: function () {
    const id = `step_${Date.now()}`;
    const steps = (this.data.advanced.branch.steps || []).concat({
      id, title: '', body: '', terminal: true,
      outcomeCode: 'COMPLETED', outcomeLabel: '完成节点', options: []
    });
    this._setFormState({ 'advanced.branch.steps': steps });
  },
  updateBranchStep: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const steps = this.data.advanced.branch.steps.map((step, i) => i === index
      ? Object.assign({}, step, { [field]: e.detail.value }) : step);
    this._setFormState({ 'advanced.branch.steps': steps });
  },
  toggleBranchTerminal: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const terminal = !!e.detail.value;
    const steps = this.data.advanced.branch.steps.map((step, i) => i === index
      ? Object.assign({}, step, {
        terminal,
        outcomeCode: terminal ? (step.outcomeCode || 'COMPLETED') : step.outcomeCode,
        outcomeLabel: terminal ? (step.outcomeLabel || step.title || '完成节点') : step.outcomeLabel,
        options: terminal ? [] : step.options
      }) : step);
    this._setFormState({ 'advanced.branch.steps': steps });
  },
  removeBranchStep: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({ 'advanced.branch.steps': this.data.advanced.branch.steps.filter((_, i) => i !== index) });
  },
  addBranchOption: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const steps = this.data.advanced.branch.steps.map((step, i) => i === index
      ? Object.assign({}, step, { terminal: false, options: (step.options || []).concat({
        id: `option_${Date.now()}`, label: '', nextStepId: '', score: 0
      }) }) : step);
    this._setFormState({ 'advanced.branch.steps': steps });
  },
  updateBranchOption: function (e) {
    const stepIndex = Number(e.currentTarget.dataset.stepindex);
    const optionIndex = Number(e.currentTarget.dataset.optionindex);
    const field = e.currentTarget.dataset.field;
    const numeric = e.currentTarget.dataset.numeric === '1';
    const steps = this.data.advanced.branch.steps.map((step, si) => si !== stepIndex ? step : Object.assign({}, step, {
      options: step.options.map((option, oi) => oi === optionIndex
        ? Object.assign({}, option, { [field]: numeric ? Number(e.detail.value) : e.detail.value }) : option)
    }));
    this._setFormState({ 'advanced.branch.steps': steps });
  },
  removeBranchOption: function (e) {
    const stepIndex = Number(e.currentTarget.dataset.stepindex);
    const optionIndex = Number(e.currentTarget.dataset.optionindex);
    const steps = this.data.advanced.branch.steps.map((step, si) => si !== stepIndex ? step : Object.assign({}, step, {
      options: step.options.filter((_, oi) => oi !== optionIndex)
    }));
    this._setFormState({ 'advanced.branch.steps': steps });
  },
  addMultiplayerRole: function () {
    const roles = (this.data.advanced.multiplayer.roles || []).concat({ id: `role_${Date.now()}`, label: '', min: 0, max: 1 });
    this._setFormState({ 'advanced.multiplayer.roles': roles });
  },
  updateMultiplayerRole: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const numeric = e.currentTarget.dataset.numeric === '1';
    const roles = this.data.advanced.multiplayer.roles.map((role, i) => i === index
      ? Object.assign({}, role, { [field]: numeric ? Number(e.detail.value) : e.detail.value }) : role);
    this._setFormState({ 'advanced.multiplayer.roles': roles });
  },
  removeMultiplayerRole: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({ 'advanced.multiplayer.roles': this.data.advanced.multiplayer.roles.filter((_, i) => i !== index) });
  },
  onTurnOrderChange: function (e) {
    const order = String(e.detail.value || '').split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
    this._setFormState({ 'advanced.multiplayer.turnOrder': order });
  },

  // ===== v5.1 新玩法的重复项编辑器 =====
  // 标量字段(标题/时段/目标步数…)走上面的通用 onAdvancedField / onAdvancedPicker,
  // 只有数组形状需要各自的增删改 —— 它们的元素形状彼此不同,套不进一个通用函数。

  /** 签文池是二维数组(条 → 行),textarea 用换行编辑更顺手,所以维持一份字符串草稿。
      草稿是编辑期的事实源,poems 每次输入都从草稿整体重算 —— 两份不会漂移。 */
  _dailySignDraftsOf: function (model) {
    const poems = (model && model.dailySign && model.dailySign.poems) || [];
    return (Array.isArray(poems) ? poems : []).map(poem => (Array.isArray(poem) ? poem : [poem]).join('\n'));
  },
  _poemsOfDrafts: function (drafts) {
    return drafts.map(draft => String(draft || '').split('\n').map(line => line.trim()).filter(Boolean));
  },
  addDailyPoem: function () {
    const drafts = (this.data.dailySignDrafts || []).concat('');
    this._setFormState({ dailySignDrafts: drafts, 'advanced.dailySign.poems': this._poemsOfDrafts(drafts), advancedConfigError: '' });
  },
  updateDailyPoem: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const drafts = (this.data.dailySignDrafts || []).map((draft, i) => i === index ? e.detail.value : draft);
    this._setFormState({ dailySignDrafts: drafts, 'advanced.dailySign.poems': this._poemsOfDrafts(drafts), advancedConfigError: '' });
  },
  removeDailyPoem: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const drafts = (this.data.dailySignDrafts || []).filter((_, i) => i !== index);
    this._setFormState({ dailySignDrafts: drafts, 'advanced.dailySign.poems': this._poemsOfDrafts(drafts), advancedConfigError: '' });
  },

  addBlindOption: function () {
    const options = this.data.advanced.blindTaste.options || [];
    if (options.length >= 6) return toast('盲品选项最多 6 项');
    // key 用 A/B/C… 顺位补第一个没被占用的字母,避免和已有选项撞 key
    const used = options.map(option => String(option.key || ''));
    const key = 'ABCDEFGHIJ'.split('').find(letter => used.indexOf(letter) < 0) || `opt_${options.length + 1}`;
    this._setFormState({ 'advanced.blindTaste.options': options.concat({ key, label: '' }), advancedConfigError: '' });
  },
  updateBlindOption: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const options = this.data.advanced.blindTaste.options.map((option, i) => i === index
      ? Object.assign({}, option, { [field]: e.detail.value }) : option);
    const patch = { 'advanced.blindTaste.options': options, advancedConfigError: '' };
    // 改的就是当前答案那一项的 key ⇒ answerKey 跟着走,否则答案会指向一个不存在的选项
    if (field === 'key' && this.data.advanced.blindTaste.answerKey === this.data.advanced.blindTaste.options[index].key) {
      patch['advanced.blindTaste.answerKey'] = e.detail.value;
    }
    this._setFormState(patch);
  },
  removeBlindOption: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const removed = this.data.advanced.blindTaste.options[index];
    const options = this.data.advanced.blindTaste.options.filter((_, i) => i !== index);
    const patch = { 'advanced.blindTaste.options': options, advancedConfigError: '' };
    // 删掉的正好是答案 ⇒ 落到剩下的第一项,而不是留一个悬空 answerKey
    if (removed && this.data.advanced.blindTaste.answerKey === removed.key) {
      patch['advanced.blindTaste.answerKey'] = options.length ? options[0].key : '';
    }
    this._setFormState(patch);
  },
  setBlindAnswer: function (e) {
    this._setFormState({ 'advanced.blindTaste.answerKey': e.currentTarget.dataset.key, advancedConfigError: '' });
  },

  addDiySuggestion: function () {
    const suggestions = this.data.advanced.diyName.suggestions || [];
    if (suggestions.length >= 6) return toast('备选名最多 6 个');
    this._setFormState({ 'advanced.diyName.suggestions': suggestions.concat(''), advancedConfigError: '' });
  },
  updateDiySuggestion: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const suggestions = this.data.advanced.diyName.suggestions.map((item, i) => i === index ? e.detail.value : item);
    this._setFormState({ 'advanced.diyName.suggestions': suggestions, advancedConfigError: '' });
  },
  removeDiySuggestion: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({
      'advanced.diyName.suggestions': this.data.advanced.diyName.suggestions.filter((_, i) => i !== index),
      advancedConfigError: ''
    });
  },

  // ===== 《预制人生》五段:建档 / 拍照审核 / 检定 / 留言 / 限时打字 =====
  // 标量字段照样走 onAdvancedField / onAdvancedSubToggle,只有建档的问题与选项、
  // 留言的预设短句是列表形状,需要各自的增删改(与签文池、盲品选项同一套做法)。
  addProfileQuestion: function () {
    const questions = (this.data.advanced.profile || {}).questions || [];
    if (questions.length >= 8) return toast('建档最多 8 个问题');
    // 变量名自动给一个没被占用的 —— 留空会直接吃校验红,而商家以为自己只是还没填
    const used = questions.map((question) => String(question.key || ''));
    let seq = questions.length + 1;
    while (used.indexOf('q' + seq) >= 0) seq += 1;
    this._setFormState({
      'advanced.profile.questions': questions.concat({
        key: 'q' + seq, label: '', kind: 'text', maxLength: 12, required: false
      }),
      advancedConfigError: ''
    });
  },
  updateProfileQuestion: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const numeric = e.currentTarget.dataset.numeric === '1';
    const questions = (this.data.advanced.profile.questions || []).map((question, i) => i === index
      ? Object.assign({}, question, { [field]: numeric ? Number(e.detail.value) : e.detail.value })
      : question);
    this._setFormState({ 'advanced.profile.questions': questions, advancedConfigError: '' });
  },
  toggleProfileRequired: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const questions = (this.data.advanced.profile.questions || []).map((question, i) => i === index
      ? Object.assign({}, question, { required: !!e.detail.value }) : question);
    this._setFormState({ 'advanced.profile.questions': questions, advancedConfigError: '' });
  },
  removeProfileQuestion: function (e) {
    const questions = (this.data.advanced.profile.questions || []);
    // 契约 §2.1:questions 至少 1 条。删到空 = 这一屏什么都不问,不如关掉这段
    if (questions.length <= 1) return toast('建档至少留一个问题');
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({
      'advanced.profile.questions': questions.filter((_, i) => i !== index),
      advancedConfigError: ''
    });
  },
  /** 打字题 ↔ 选项题。切到选项题时补两个空选项 —— 一个 options 都没有的 pick
      在契约里必红(2–6 个),而商家会以为自己只是刚切过来。 */
  pickProfileKind: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const picked = pickedItem(this.data.profileKinds, e);
    const kind = picked && picked.key === 'pick' ? 'pick' : 'text';
    const questions = (this.data.advanced.profile.questions || []).map((question, i) => {
      if (i !== index) return question;
      if (kind === 'text') return Object.assign({}, question, { kind: 'text' });
      const options = (question.options || []).length >= 2
        ? question.options
        : [{ key: 'A', label: '', effects: [] }, { key: 'B', label: '', effects: [] }];
      return Object.assign({}, question, { kind: 'pick', options });
    });
    this._setFormState({ 'advanced.profile.questions': questions, advancedConfigError: '' });
  },
  addProfileOption: function (e) {
    const qIndex = Number(e.currentTarget.dataset.qindex);
    const questions = (this.data.advanced.profile.questions || []).map((question, i) => {
      if (i !== qIndex) return question;
      const options = question.options || [];
      if (options.length >= 6) return question;
      // key 顺位补第一个没被占用的字母,和盲品选项同一套 —— 撞 key 会被判重复
      const used = options.map((option) => String(option.key || ''));
      const key = 'ABCDEF'.split('').find((letter) => used.indexOf(letter) < 0) || 'opt' + (options.length + 1);
      return Object.assign({}, question, { options: options.concat({ key, label: '', effects: [] }) });
    });
    this._setFormState({ 'advanced.profile.questions': questions, advancedConfigError: '' });
  },
  updateProfileOption: function (e) {
    const qIndex = Number(e.currentTarget.dataset.qindex);
    const oIndex = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const questions = (this.data.advanced.profile.questions || []).map((question, i) => i !== qIndex
      ? question
      : Object.assign({}, question, {
        options: (question.options || []).map((option, j) => j === oIndex
          ? Object.assign({}, option, { [field]: e.detail.value }) : option)
      }));
    this._setFormState({ 'advanced.profile.questions': questions, advancedConfigError: '' });
  },
  /* ===== 状态写入(effects)编辑器 =====
     建档选项的加成与 R14 检定四条效果用的是同一个形状(契约 §2.1 / §2.3):
     `[{ var, op, value }]`,op ∈ SET / INC / ADD_TAG。变量名真源是服务端的
     STATE_VAR 正则(必须带 clue. / relation. / counter. 前缀),幸运用 sys.luck。
     路径走字符串(如 profile.questions.0.options.1.effects / check.successEffects),
     这样一套增删改能同时服务三处列表,不必写三份。 */
  _effectsList: function (path) {
    const list = String(path || '').split('.').reduce((node, key) => {
      if (node == null) return undefined;
      return /^\d+$/.test(key) ? node[Number(key)] : node[key];
    }, this.data.advanced);
    return Array.isArray(list) ? list : [];
  },
  _setEffects: function (path, list) {
    // 数字段要写成 [0] 下标 —— setData 的路径认数组下标,不认 `.0`
    const dataPath = 'advanced' + String(path || '').split('.')
      .map((key) => (/^\d+$/.test(key) ? `[${key}]` : `.${key}`)).join('');
    this._setFormState({ [dataPath]: list, advancedConfigError: '' });
  },
  addEffectRow: function (e) {
    const path = e.currentTarget.dataset.path;
    const list = this._effectsList(path);
    if (list.length >= 16) return toast('一项最多配 16 条效果');
    this._setEffects(path, list.concat({ var: '', op: 'INC', value: 1 }));
  },
  updateEffectField: function (e) {
    const path = e.currentTarget.dataset.path;
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    const list = this._effectsList(path).map((row, i) => {
      if (i !== index) return row;
      // ADD_TAG 的值是 tag 字符串,数值 op 的值是整数 —— 混着存会让服务端判格式错
      const next = Object.assign({}, row, { [field]: e.detail.value });
      if (field === 'value' && row.op !== 'ADD_TAG') next.value = Number(e.detail.value);
      return next;
    });
    this._setEffects(path, list);
  },
  pickEffectOp: function (e) {
    const path = e.currentTarget.dataset.path;
    const index = Number(e.currentTarget.dataset.index);
    // 画像段是下拉(按下标取);检定段还是芯片(data-op 带值)—— 检定段改成下拉后删掉 data-op 这条路
    const picked = pickedItem(this.data.effectOps, e);
    const op = e.currentTarget.dataset.op || (picked && picked.key) || 'INC';
    const list = this._effectsList(path).map((row, i) => {
      if (i !== index) return row;
      // 换 op 就把值换成那一档的形状:数字 ↔ tag,不留下一个上一档的残值
      const value = op === 'ADD_TAG'
        ? (typeof row.value === 'string' ? row.value : '')
        : (Number.isFinite(Number(row.value)) && row.value !== '' ? Number(row.value) : 1);
      return Object.assign({}, row, { op, value });
    });
    this._setEffects(path, list);
  },
  removeEffectRow: function (e) {
    const path = e.currentTarget.dataset.path;
    const index = Number(e.currentTarget.dataset.index);
    this._setEffects(path, this._effectsList(path).filter((_, i) => i !== index));
  },
  // ===== 条件修正与放宽:都从预设里选,不让作者手敲条件 DSL(9-22 用户拍板) =====
  /** 回显开关与放宽列表 —— advanced 变了就得重算,不然开关会停在上一次的状态。 */
  _syncCheckDerived: function (adv) {
    const cfg = advancedGameConfig;
    const a = adv || this.data.advanced || {};
    const mods = (a.check && a.check.mods) || [];
    const choices = cfg.relaxChoices(a);
    const own = (a.variants || []).filter(cfg.isEditorVariant)[0];
    this.setData({
      hpLadderOn: cfg.hpLadderOn(mods),
      luckIndex: cfg.luckIndex(mods),
      relaxOptions: choices.map((c) => ({ key: c.key, label: c.pick })),
      relaxIndex: own ? choices.findIndex((c) => JSON.stringify(c.relax) === JSON.stringify(own.relax)) : -1,
    });
  },
  _writeMods: function (mods) {
    const adv = JSON.parse(JSON.stringify(this.data.advanced));
    adv.check = adv.check || {};
    adv.check.mods = mods;
    this.setData({ advanced: adv, advancedConfigError: '' });
    this._syncCheckDerived(adv);
  },
  // 开 = 默认第一档;具体哪档在下面的下拉里换
  toggleLuck: function (e) {
    this._writeMods(advancedGameConfig.applyLuck((this.data.advanced.check || {}).mods, e.detail.value ? 0 : -1));
  },
  onLuckPick: function (e) {
    this._writeMods(advancedGameConfig.applyLuck((this.data.advanced.check || {}).mods, Number(e.detail.value)));
  },
  // 放宽只有一个触发条件(血量低),多配几条也只有第一条生效 —— 所以是单选,不是列表。
  _writeRelax: function (index) {
    const c = advancedGameConfig.relaxChoices(this.data.advanced)[index];
    const adv = JSON.parse(JSON.stringify(this.data.advanced));
    const rest = (adv.variants || []).filter((v) => !advancedGameConfig.isEditorVariant(v));
    adv.variants = c ? rest.concat({ when: Object.assign({}, c.when), relax: Object.assign({}, c.relax) }) : rest;
    this.setData({ advanced: adv, advancedConfigError: '' });
    this._syncCheckDerived(adv);
  },
  toggleRelax: function (e) {
    this._writeRelax(e.detail.value ? 0 : -1);
  },
  onRelaxPick: function (e) {
    this._writeRelax(Number(e.detail.value));
  },
  toggleHpLadder: function (e) {
    this._writeMods(advancedGameConfig.toggleHpLadder((this.data.advanced.check || {}).mods, !!(e.detail && e.detail.value)));
  },
  pickCheckTier: function (e) {
    this._setFormState({ 'advanced.check.tier': (pickedItem(this.data.checkTiers, e) || { key: 'medium' }).key, advancedConfigError: '' });
  },
  removeProfileOption: function (e) {
    const qIndex = Number(e.currentTarget.dataset.qindex);
    const oIndex = Number(e.currentTarget.dataset.index);
    const question = (this.data.advanced.profile.questions || [])[qIndex];
    // 契约 §2.1:pick 的 options 至少 2 个
    if (!question || (question.options || []).length <= 2) return toast('选项题至少留 2 个选项');
    const questions = this.data.advanced.profile.questions.map((item, i) => i === qIndex
      ? Object.assign({}, item, { options: (item.options || []).filter((_, j) => j !== oIndex) })
      : item);
    this._setFormState({ 'advanced.profile.questions': questions, advancedConfigError: '' });
  },
  pickPhotoCheckFallback: function (e) {
    this._setFormState({
      'advanced.photoCheck.fallback': (pickedItem(this.data.photoCheckFallbacks, e) || { key: 'retake' }).key,
      advancedConfigError: ''
    });
  },
  /* 取景轮廓(S1):上传拿站内地址。清空时置空串 —— normalize 会把空串整键删掉,
     不把 "" 存进库(服务端判它非法)。

     ⚠️ 必须带 skipCrop:app.chooseImage 默认要过裁剪台,而 pages/crop/index.js 导出固定是 jpg、
     导出前还先铺一层白底(不铺白 PNG 的透明像素会被合成成黑)。轮廓要的正是透明底线条图,
     过一趟就变成白底 —— 铺在实时画面上就是一层白纱,恰好是「现场感」的反面。
     裁剪页那条「没动过画布就原样透传」的旁路要求商家一根手指都不碰,靠不住。
     ⚠️ 也别改成页面里直接调 wx.chooseMedia:privacy-gate-coverage 门禁会判红 ——
     这一页没挂 cy-privacy-gate,直接调的话触发隐私授权时整页会被隐私页盖住(实测踩过)。 */
  uploadPhotoFrame: function () {
    var that = this;
    app.chooseImage(function (res) {
      if (!res || !res[0]) return;
      that._setFormState({ 'advanced.photoCheck.frameUrl': res[0], advancedConfigError: '' });
    }, 1, { skipCrop: true });
  },
  /* 显形档 AR 的 3D 模型:从会话里选一个 .glb,走 app 的统一上传通道(隐私闸 + 10MB 前置拒绝),
     拿回来的是 OSS 地址。清空置空串,normalize 会在关了 AR 时一并作废。 */
  uploadScanModel: function () {
    var that = this;
    app.chooseDocument(function (res) {
      var file = res && res[0];
      if (file && file.url) that._setFormState({ 'advanced.scan.modelUrl': file.url, advancedConfigError: '' });
    }, 1, ['glb']);
  },
  clearScanModel: function () {
    this._setFormState({ 'advanced.scan.modelUrl': '', advancedConfigError: '' });
  },
  clearPhotoFrame: function () {
    this._setFormState({ 'advanced.photoCheck.frameUrl': '', advancedConfigError: '' });
  },
  addNotePreset: function () {
    const presets = (this.data.advanced.note || {}).presets || [];
    if (presets.length >= 6) return toast('预设短句最多 6 条');
    this._setFormState({ 'advanced.note.presets': presets.concat(''), advancedConfigError: '' });
  },
  updateNotePreset: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({
      'advanced.note.presets': (this.data.advanced.note.presets || [])
        .map((item, i) => (i === index ? e.detail.value : item)),
      advancedConfigError: ''
    });
  },
  removeNotePreset: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({
      'advanced.note.presets': (this.data.advanced.note.presets || []).filter((_, i) => i !== index),
      advancedConfigError: ''
    });
  },

  // ===== 推理类三玩法(排序 / 连线 / 分类) =====
  // id 一律自动生成:手填必然出现重复和空值,而那两种错都要到提交时才被服务端拦下。
  // 数量上下限在这里就拦住 —— 校验器兜底,但不该先让人填完再报错。
  addSortItem: function () {
    const items = this.data.advanced.sort.items || [];
    if (items.length >= 8) { toast('排序最多 8 条'); return; }
    this._setFormState({ 'advanced.sort.items': items.concat({ id: rowId('srt'), label: '' }), advancedConfigError: '' });
  },
  removeSortItem: function (e) {
    const items = this.data.advanced.sort.items || [];
    if (items.length <= 2) { toast('排序至少 2 条'); return; }
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({ 'advanced.sort.items': items.filter((_, i) => i !== index), advancedConfigError: '' });
  },
  /* 连线按「左 | 右」成对录入:增删都成对动 left/right,下标对齐是 pairs 的前提。 */
  addMatchPair: function () {
    const left = this.data.advanced.match.left || [];
    if (left.length >= 6) { toast('连线最多 6 对'); return; }
    const right = this.data.advanced.match.right || [];
    this._setFormState({
      'advanced.match.left': left.concat({ id: rowId('lft'), label: '' }),
      'advanced.match.right': right.concat({ id: rowId('rgt'), label: '' }),
      advancedConfigError: ''
    });
  },
  removeMatchPair: function (e) {
    const left = this.data.advanced.match.left || [];
    if (left.length <= 2) { toast('连线至少 2 对'); return; }
    const index = Number(e.currentTarget.dataset.index);
    this._setFormState({
      'advanced.match.left': left.filter((_, i) => i !== index),
      'advanced.match.right': (this.data.advanced.match.right || []).filter((_, i) => i !== index),
      advancedConfigError: ''
    });
  },
  addClassifyBin: function () {
    const bins = this.data.advanced.classify.bins || [];
    if (bins.length >= 4) { toast('分类最多 4 个类别'); return; }
    this._setFormState({ 'advanced.classify.bins': bins.concat({ id: rowId('bin'), label: '' }), advancedConfigError: '' });
  },
  /* 删类别时,归到它的那些条目**回到未选**而不是悄悄改到别的类 ——
     自动改类等于替商家做了选择,而那条数据看起来是对的。 */
  removeClassifyBin: function (e) {
    const bins = this.data.advanced.classify.bins || [];
    if (bins.length <= 2) { toast('分类至少 2 个类别'); return; }
    const index = Number(e.currentTarget.dataset.index);
    const removed = bins[index];
    const answer = Object.assign({}, this.data.advanced.classify.answer || {});
    if (removed) Object.keys(answer).forEach((itemId) => { if (answer[itemId] === removed.id) delete answer[itemId]; });
    this._setFormState({
      'advanced.classify.bins': bins.filter((_, i) => i !== index),
      'advanced.classify.answer': answer,
      advancedConfigError: ''
    });
  },
  addClassifyItem: function () {
    const items = this.data.advanced.classify.items || [];
    if (items.length >= 10) { toast('分类最多 10 条'); return; }
    this._setFormState({ 'advanced.classify.items': items.concat({ id: rowId('itm'), label: '' }), advancedConfigError: '' });
  },
  removeClassifyItem: function (e) {
    const items = this.data.advanced.classify.items || [];
    if (items.length <= 2) { toast('分类至少 2 条'); return; }
    const index = Number(e.currentTarget.dataset.index);
    const removed = items[index];
    const answer = Object.assign({}, this.data.advanced.classify.answer || {});
    if (removed) delete answer[removed.id];
    this._setFormState({
      'advanced.classify.items': items.filter((_, i) => i !== index),
      'advanced.classify.answer': answer,
      advancedConfigError: ''
    });
  },
  /** 某一条归到某一类。itemId 是自动生成的稳定 id,不是下标 —— 删条目不串行。 */
  setClassifyBin: function (e) {
    const itemId = e.currentTarget.dataset.item;
    const bin = pickedItem(this.data.advanced.classify.bins, e);
    const binId = bin && bin.id;
    if (!itemId || !binId) return;
    const answer = Object.assign({}, this.data.advanced.classify.answer || {});
    answer[itemId] = binId;
    this._setFormState({ 'advanced.classify.answer': answer, advancedConfigError: '' });
  },

  onLoad: function (options) {
    options = options || {};
    var that = this;

    const editingId = positiveId(options.id);
    this._templateId = editingId || 0;
    const initialTitle = options.templateName ? safeDecode(options.templateName) : '';

    this.data.dirty = !!initialTitle;
    this.setData({
      'formData.title': initialTitle,
      operationScope: options.scope === 'MERCHANT' ? 'MERCHANT' : '',
      // R9-04:scope=my 说明 id 来自「我的模板」,回填要走 /api/template/myinfo 才能读草稿。
      // 它不参与写链路身份 —— 写身份仍只由 operationScope(MERCHANT)决定。
      isMyScope: options.scope === 'my',
      from: options.from || '',
      editorLoading: !!editingId,
      loadError: editingId || options.id == null ? '' : '模板编号无效，请返回后重试',
      // FE-04:纯预览态(调用方传 mode=preview 或 preview=1)——隐藏发布/草稿控件,temp 只做预览确认。
      // 现有编辑调用方不传该参 → previewMode=false,行为完全不变。
      previewMode: options.mode === 'preview' || options.preview === '1'
    });

    if (options.from === 'citynode') that.loadCityNodeAccess();

    if (editingId) {
      if (editingId > 0) {
        that.getData();
      }
    }
    that.getUserData();

    that.getDictTypeList('app_template_duration', 'durationOptions', 'duration', function (data) {
      if (data && data.length > 0 && !that.data.formData.duration) {
        that._setFormState({ durationIndex: 0, 'formData.duration': data[0].dictValue, durationText: data[0].dictLabel }, null, { pristine: true });
      } else if (that.data.formData.duration) {
        const index = data.findIndex(item => item.dictValue == that.data.formData.duration);
        if (index >= 0) that._setFormState({ durationIndex: index, durationText: data[index].dictLabel }, null, { pristine: true });
      }
    });

    that.getDictTypeList('app_template_difficulty', 'difficultyOptions', 'difficulty', function (data) {
      if (that.data.formData.difficulty) {
        const index = data.findIndex(item => item.dictValue == that.data.formData.difficulty);
        if (index >= 0) that._setFormState({ difficultyIndex: index, difficultyLabel: data[index].dictLabel }, null, { pristine: true });
      }
    });

    that.getDictTypeList('app_template_players', 'playersOptions', 'players', function (data) {
      if (data && data.length > 0 && !that.data.formData.players) {
        that._setFormState({ playersIndex: 0, 'formData.players': data[0].dictValue, playersText: data[0].dictLabel }, null, { pristine: true });
      } else if (that.data.formData.players) {
        const index = data.findIndex(item => item.dictValue == that.data.formData.players);
        if (index >= 0) that._setFormState({ playersIndex: index, playersText: data[index].dictLabel }, null, { pristine: true });
      }
    });

    // 模块初始态(新建态默认核心模块;id>0 由 getData 回填后再调一次)
    if (!editingId) {
      that.initModuleState(true);
    }
  },

  loadCityNodeAccess: function () {
    const that = this;
    this.setData({
      merchantAccess: merchantAccessPolicy.inactiveAccess(),
    });
    app.sendRequest({
      url: '/api/merchant/access/me', method: 'POST', hideLoading: true, silentError: true,
      success: function (res) {
        if (!(res && (res.code === '200' || res.code === 200))) {
          toast('商家权限没能读取');
          return;
        }
        const access = merchantAccessPolicy.normalizeMerchantAccess(res.data);
        that.setData({ merchantAccess: access });
      },
      fail: function () { toast('商家权限没能读取'); },
      successStatusAbnormal: function () { toast('商家权限没能读取'); },
    });
  },

  getDictTypeList: function (dictType, listName, stateKey, callback) {
    var that = this;
    this._dictRequestTokens = this._dictRequestTokens || {};
    const token = (this._dictRequestTokens[dictType] || 0) + 1;
    this._dictRequestTokens[dictType] = token;
    this.setData({ [`dictLoading.${stateKey}`]: true, [`dictErrors.${stateKey}`]: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/common/dict',
      method: "POST",
      data: { dictType: dictType },
      success: function (res) {
        if (token !== that._dictRequestTokens[dictType]) return;
        if (res && res.code == "200" && isRecordList(res.data)) {
          var optionLabels = res.data.map(item => item.dictLabel);
          that.setData({
            [listName]: optionLabels,
            [listName + 'Data']: res.data,
            [`dictErrors.${stateKey}`]: ''
          });
          if (callback && typeof callback === 'function') {
            callback(res.data);
          }
        } else that.setData({ [`dictErrors.${stateKey}`]: '选项加载失败，请重试' });
      },
      fail: function () {
        if (token === that._dictRequestTokens[dictType]) {
          that.setData({ [`dictErrors.${stateKey}`]: '选项加载失败，请重试' });
        }
      },
      complete: function () {
        if (token === that._dictRequestTokens[dictType]) {
          that.setData({ [`dictLoading.${stateKey}`]: false });
        }
      }
    });
  },

  retryDurationOptions: function () {
    this.getDictTypeList('app_template_duration', 'durationOptions', 'duration', function (data) {
      if (!this.data.formData.duration && data.length) {
        this._setFormState({ durationIndex: 0, 'formData.duration': data[0].dictValue, durationText: data[0].dictLabel }, null, { pristine: true });
      } else {
        const index = data.findIndex(item => item.dictValue == this.data.formData.duration);
        if (index >= 0) this._setFormState({ durationIndex: index, durationText: data[index].dictLabel }, null, { pristine: true });
      }
    });
  },
  retryDifficultyOptions: function () {
    this.getDictTypeList('app_template_difficulty', 'difficultyOptions', 'difficulty', function (data) {
      const index = data.findIndex(item => item.dictValue == this.data.formData.difficulty);
      if (index >= 0) this._setFormState({ difficultyIndex: index, difficultyLabel: data[index].dictLabel }, null, { pristine: true });
    });
  },
  retryPlayersOptions: function () {
    this.getDictTypeList('app_template_players', 'playersOptions', 'players', function (data) {
      if (!this.data.formData.players && data.length) {
        this._setFormState({ playersIndex: 0, 'formData.players': data[0].dictValue, playersText: data[0].dictLabel }, null, { pristine: true });
      } else {
        const index = data.findIndex(item => item.dictValue == this.data.formData.players);
        if (index >= 0) this._setFormState({ playersIndex: index, playersText: data[index].dictLabel }, null, { pristine: true });
      }
    });
  },

  // ===== 基本信息字段 =====
  _setFormState: function (patch, callback, options) {
    const next = Object.assign({}, patch);
    if (!(options && options.pristine)) {
      this.data.dirty = true;
      next.submitError = '';
    }
    this.setData(next, () => {
      this._refreshOutcomeContract();
      this._syncCheckDerived();   // 开关玩法段 / 改次数都会改变「能放宽什么」
      this.refreshPreviewState();
      if (callback) callback.call(this);
    });
  },
  _refreshOutcomeContract: function () {
    const outcome = nodeOutcomeContract.extract({
      validationMethod: this.data.formData.validationMethod,
      preferenceJson: this.data.formData.preferenceJson,
      advancedConfigJson: this.data.advanced
    });
    this.setData({ outcomePreview: outcome.items, outcomeContractErrors: outcome.errors });
    return outcome;
  },
  onTitleChange: function (e) {
    this._setFormState({ 'formData.title': e.detail.value, 'errors.title': '' });
  },
  onDescriptionChange: function (e) {
    this._setFormState({ 'formData.description': e.detail.value, 'errors.description': '' });
  },
  clearBasicField: function (e) {
    const field = e.currentTarget.dataset.field;
    if (field !== 'title' && field !== 'description') return;
    this._setFormState({ [`formData.${field}`]: '', [`errors.${field}`]: '' });
  },
  onRequiredMaterialsChange: function (e) {
    this._setFormState({ 'formData.requiredMaterials': e.detail.value });
  },
  /* ===== 玩法规则:步骤列表(原型 B 卡「玩家按顺序照做」) =====
     ★ 不新建后端字段:整份规则仍然存在 formData.ruleInstructions 里,**一行一步**。
     ruleSteps 只是这一页的展示形态,存盘前拼回去 —— 存量模板里那一大段文字
     按换行拆开就是现成的步骤,不会因为换了界面就读不出来。 */
  _stepsFromText: function (text) {
    const lines = String(text || '').split('\n').map((one) => one.trim()).filter(Boolean);
    return lines.length ? lines : [''];
  },
  _syncRuleSteps: function (steps) {
    this._setFormState({
      ruleSteps: steps,
      // 空步骤不写进去:玩家那边会读成一行空规则
      'formData.ruleInstructions': steps.map((one) => String(one || '').trim()).filter(Boolean).join('\n'),
    });
  },
  onRuleStepInput: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const steps = (this.data.ruleSteps || []).slice();
    if (!(index >= 0 && index < steps.length)) return;
    steps[index] = e.detail.value;
    this._syncRuleSteps(steps);
  },
  addRuleStep: function () {
    const steps = (this.data.ruleSteps || []).slice();
    if (steps.length >= 12) { app.tips('最多 12 步'); return; }
    steps.push('');
    this._syncRuleSteps(steps);
  },
  removeRuleStep: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const steps = (this.data.ruleSteps || []).slice();
    // 留最后一步:一条都不剩的话这张卡看着像坏了
    if (steps.length <= 1 || !(index >= 0 && index < steps.length)) return;
    steps.splice(index, 1);
    this._syncRuleSteps(steps);
  },

  // ===== 通用底部选择器(玩家人数 / 玩法时长 / 玩法难度 / 适用场所) =====
  openDifficultySheet: function () {
    const data = this.data.difficultyOptionsData || [];
    if (!data.length) { this.retryDifficultyOptions(); return; }
    const cur = this.data.formData.difficulty;
    this.setData({
      pickerSheet: {
        open: true, key: 'difficulty', title: '选择玩法难度',
        options: data.map(d => ({ value: d.dictValue, label: d.dictLabel, active: d.dictValue === cur }))
      }
    });
  },
  openPlayersSheet: function () {
    const data = this.data.playersOptionsData || [];
    if (!data.length) { this.retryPlayersOptions(); return; }
    const cur = this.data.formData.players;
    this.setData({
      pickerSheet: {
        open: true, key: 'players', title: '选择玩家人数',
        options: data.map(d => ({ value: d.dictValue, label: d.dictLabel, active: d.dictValue === cur }))
      }
    });
  },
  openDurationSheet: function () {
    const data = this.data.durationOptionsData || [];
    if (!data.length) { this.retryDurationOptions(); return; }
    const cur = this.data.formData.duration;
    this.setData({
      pickerSheet: {
        open: true, key: 'duration', title: '选择玩法时长',
        options: data.map(d => ({ value: d.dictValue, label: d.dictLabel, active: d.dictValue === cur }))
      }
    });
  },
  openVenueSheet: function () {
    const cur = this.data.formData.usageLocation;
    this.setData({
      pickerSheet: {
        open: true, key: 'usageLocation', title: '选择适用场所',
        options: VENUE_OPTIONS.map(v => ({ value: v, label: v, active: v === cur }))
      }
    });
  },
  closePickerSheet: function () {
    this.setData({ 'pickerSheet.open': false });
  },
  onPickerSheetSelect: function (e) {
    const value = e.currentTarget.dataset.value;
    const label = e.currentTarget.dataset.label;
    const key = this.data.pickerSheet.key;
    const patch = { 'pickerSheet.open': false };
    if (key === 'players') {
      patch['formData.players'] = value;
      patch['playersText'] = label;
      const idx = (this.data.playersOptionsData || []).findIndex(d => d.dictValue === value);
      if (idx !== -1) patch['playersIndex'] = idx;
    } else if (key === 'duration') {
      patch['formData.duration'] = value;
      patch['durationText'] = label;
      const idx = (this.data.durationOptionsData || []).findIndex(d => d.dictValue === value);
      if (idx !== -1) patch['durationIndex'] = idx;
    } else if (key === 'difficulty') {
      patch['formData.difficulty'] = value;
      patch['difficultyLabel'] = label;
      const idx = (this.data.difficultyOptionsData || []).findIndex(d => d.dictValue === value);
      if (idx !== -1) patch['difficultyIndex'] = idx;
    } else if (key === 'usageLocation') {
      patch['formData.usageLocation'] = value;
    }
    this._setFormState(patch);
  },

  // ===== 完成方式模块 =====
  selectValidationMethod: function (e) {
    const value = parseInt(e.currentTarget.dataset.value);
    const supportsHint = HINT_METHODS.includes(value);
    const patch = {
      'formData.validationMethod': value,
      methodSupportsHint: supportsHint
    };
    // 选项问答首次进入,确保至少 2 个选项
    if (value === 3 && this.data.optionItems.length < 2) {
      patch.optionItems = this._normalizeOptions([
        ...this.data.optionItems,
        ...Array(2 - this.data.optionItems.length).fill(null).map(() => ({ text: '', isCorrect: false }))
      ]);
    }
    // 不支持提示时收起提示开关
    if (!supportsHint) patch.hintEnabled = false;
    this._setFormState(patch);
  },

  onQuestionNameChange: function (e) {
    this._setFormState({ 'formData.questionName': e.detail.value });
  },
  onQuestionAnswerChange: function (e) {
    this._setFormState({ 'formData.questionAnswer': e.detail.value });
  },
  onOptionQuestionChange: function (e) {
    this._setFormState({ optionQuestion: e.detail.value });
  },
  onPhotoRequireDescChange: function (e) {
    this._setFormState({ 'formData.photoRequireDesc': e.detail.value });
  },
  onPreferenceJsonChange: function (e) {
    const value = e.detail.value || '';
    const preview = this.parsePreferencePreview(value);
    this._setFormState({
      'formData.preferenceJson': value,
      preferencePreview: preview.rows,
      preferenceConfigError: preview.error
    });
  },
  fillPreferenceExample: function () {
    const value = JSON.stringify({
      steps: [{ key: 'space', type: 'single', title: '你现在的空间更像哪一种?', options: [
        { key: 'A', text: '小而紧凑', scores: { compact: 2, open: 0 } },
        { key: 'B', text: '开阔但杂乱', scores: { compact: 0, open: 2 } }
      ] }],
      dimensions: ['compact', 'open'],
      tiebreak: { key: 'tradeoff', type: 'single', title: '如果只能先改一个?', options: [
        { key: 'A', text: '先减物品', scores: { compact: 1 } },
        { key: 'B', text: '先改动线', scores: { open: 1 } }
      ] },
      results: {
        compact: { title: '小空间先减负', body: '因为你选择了{{choices}}', nextStep: '清掉一层柜子', nextStepDays: 7 },
        open: { title: '开放空间先定动线', body: '因为你选择了{{choices}}', nextStep: '重排一次动线', nextStepDays: 30 }
      },
      tagConsumes: ['space_constraints'],
      tagOutput: { code: 'space_constraints', fromDimension: true, recipientLabel: '本主题下一家生活方式店', purpose: '生成适合你空间条件的本站建议', revocable: true }
    }, null, 2);
    const preview = this.parsePreferencePreview(value);
    this._setFormState({ 'formData.preferenceJson': value, preferencePreview: preview.rows, preferenceConfigError: '' });
  },
  parsePreferencePreview: function (value) {
    if (!value) return { rows: [], error: '请填写偏好题配置' };
    try {
      const config = JSON.parse(value);
      if (!Array.isArray(config.steps) || !config.steps.length) return { rows: [], error: 'steps 至少要有一道题' };
      if (!Array.isArray(config.dimensions) || !config.dimensions.length) return { rows: [], error: 'dimensions 至少要有一项' };
      if (config.dimensions.length > 1 && !config.tiebreak) return { rows: [], error: '多维结果必须配置 tiebreak' };
      const results = config && config.results;
      if (!results || Array.isArray(results) || typeof results !== 'object') return { rows: [], error: 'results 必须是结果对象' };
      const rows = Object.keys(results).map((code) => ({ code, ...(results[code] || {}) }));
      if (!rows.length || rows.some((row) => !row.title || !row.body || !row.nextStep || ![7, 30].includes(Number(row.nextStepDays)))) {
        return { rows, error: '每个结果都要有 title、body、nextStep 和 7/30 天周期' };
      }
      const output = config.tagOutput;
      if (output && (!output.recipientLabel || !output.purpose || output.revocable !== true)) {
        return { rows, error: '标签必须写明接收方、用途并声明可撤回' };
      }
      return { rows, error: '' };
    } catch (e) { return { rows: [], error: 'JSON 格式不正确' }; }
  },

  // ----- 提示(并入完成方式) -----
  onHintEnabledChange: function (e) {
    const on = !!e.detail.value;
    const patch = { hintEnabled: on };
    if (!on) {
      patch['formData.hint1'] = '';
      patch['formData.hint2'] = '';
      patch['formData.answerReveal'] = '';
    }
    this._setFormState(patch);
  },
  onHint1Change: function (e) {
    this._setFormState({ 'formData.hint1': e.detail.value });
  },
  onHint2Change: function (e) {
    this._setFormState({ 'formData.hint2': e.detail.value });
  },
  onAnswerRevealChange: function (e) {
    this._setFormState({ 'formData.answerReveal': e.detail.value });
  },

  // ----- 题干附件(看图答题 / 听音答题) -----
  // 走与封面图、语音讲解同一条上传通道;上传成功才写进 formData,失败不留半个字段。
  uploadQuestionImg: function () {
    var that = this;
    app.chooseImage(function (res) {
      if (res && res[0]) that._setFormState({ 'formData.questionImg': res[0] });
    }, 1);
  },

  clearQuestionImg: function () {
    this._setFormState({ 'formData.questionImg': '' });
  },

  uploadQuestionAudio: function () {
    var that = this;
    app.chooseDocument(function (res) {
      var file = res && res[0];
      if (file && file.url) that._setFormState({ 'formData.questionAudio': file.url });
    }, 1, ['mp3', 'm4a', 'aac']);
  },

  clearQuestionAudio: function () {
    this._setFormState({ 'formData.questionAudio': '' });
  },

  // ----- 选项媒体 -----
  // 媒体挂在 optionItems 的行上,提交时由 option-media.toJson 序列化成一列 JSON。
  _patchOption: function (index, patch) {
    if (index < 0 || index >= this.data.optionItems.length) return;
    var options = this.data.optionItems.map(function (item, i) {
      return i === index ? Object.assign({}, item, patch) : item;
    });
    this._setFormState({ optionItems: options });
  },

  uploadOptionImg: function (e) {
    var that = this;
    var index = Number(e.currentTarget.dataset.index);
    app.chooseImage(function (res) {
      if (res && res[0]) that._patchOption(index, { img: res[0] });
    }, 1);
  },

  uploadOptionAudio: function (e) {
    var that = this;
    var index = Number(e.currentTarget.dataset.index);
    app.chooseDocument(function (res) {
      var file = res && res[0];
      if (file && file.url) that._patchOption(index, { audio: file.url });
    }, 1, ['mp3', 'm4a', 'aac']);
  },

  clearOptionMedia: function (e) {
    this._patchOption(Number(e.currentTarget.dataset.index), { img: '', audio: '' });
  },

  // ----- 选项问答(行内编辑) -----
  _normalizeOptions: function (items) {
    const letters = ['A', 'B', 'C', 'D'];
    // 保证只有一个正确答案
    let correctSeen = false;
    return items.slice(0, 4).map((it, i) => {
      let isCorrect = !!it.isCorrect;
      if (isCorrect && correctSeen) isCorrect = false;
      if (isCorrect) correctSeen = true;
      // ⚠️ img/audio 必须原样带过去 —— 归一化被增删选项、选正确答案等每条路径复用,
      //    这里漏一个字段,用户配好的选项图会在「点一下圆圈」时无声消失。
      return { letter: letters[i], text: it.text || '', isCorrect: isCorrect,
        img: it.img || '', audio: it.audio || '' };
    });
  },
  pickCorrectOption: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const options = this.data.optionItems.map((item, i) => ({ ...item, isCorrect: i === index }));
    const correct = options[index] ? options[index].letter : 'A';
    this._setFormState({ optionItems: options, correctAnswerIndex: index, 'formData.correctAnswer': correct });
  },
  pickQaMode: function (e) {
    this._setFormState({ 'advanced.qa.mode': e.currentTarget.dataset.mode || 'TYPE' });
  },
  /* 扫码段的两组选项是 cy-dropdown:detail.value 是下标,存的是那一项的 key */
  pickScanKind: function (e) {
    const item = pickedItem(this.data.scanKinds, e);
    this._setFormState({ 'advanced.scan.kind': item ? item.key : 'TEXT' });
  },
  pickScanArMode: function (e) {
    const item = pickedItem(this.data.scanArModes, e);
    this._setFormState({ 'advanced.scan.arMode': item ? item.key : 'NONE' });
  },
  /** 选项问答:单选时点谁谁是;开了「允许多选」就变成逐个勾/取消。 */
  pickCorrectQaOption: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const multi = !!this.data.advanced.qa.multi;
    const options = (this.data.advanced.qa.options || [])
      .map((item, i) => {
        if (!multi) return Object.assign({}, item, { correct: i === index });
        if (i !== index) return item;
        return Object.assign({}, item, { correct: !item.correct });
      });
    this._setFormState({ 'advanced.qa.options': options, advancedConfigError: '' });
  },
  /* 允许多选开关。关掉时只留第一个正确答案 ——
     留着两个正确答案在单选模式下过不了校验,而报错看起来像商家填错了选项。 */
  onQaMultiToggle: function (e) {
    const on = !!e.detail.value;
    const patch = { 'advanced.qa.multi': on, advancedConfigError: '' };
    if (!on) {
      let kept = false;
      patch['advanced.qa.options'] = (this.data.advanced.qa.options || []).map((item) => {
        const correct = !!item.correct && !kept;
        if (correct) kept = true;
        return Object.assign({}, item, { correct });
      });
    }
    this._setFormState(patch);
  },
  /** 猜图:把某一张设为正确答案。单选 —— 点谁谁是,其余自动取消。
   *  用开关做的话会出现「把答案关掉」这种无意义状态,校验器也会当场判红。 */
  pickCorrectPicture: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const items = (this.data.advanced.pricePair.items || [])
      .map((item, i) => Object.assign({}, item, { correct: i === index }));
    this._setFormState({ 'advanced.pricePair.items': items });
  },
  onOptionTextChange: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const value = e.detail.value;
    const options = this.data.optionItems.map((item, i) => (i === index ? { ...item, text: value } : item));
    this._setFormState({ optionItems: options });
  },
  addChoiceOption: function () {
    if (this.data.optionItems.length >= 4) {
      toast('最多 4 个选项');
      return;
    }
    const options = this._normalizeOptions([...this.data.optionItems, { text: '', isCorrect: false }]);
    this._setFormState({ optionItems: options });
  },
  deleteOption: function (e) {
    if (this.data.optionItems.length <= 2) {
      toast('至少需要 2 个选项');
      return;
    }
    const index = parseInt(e.currentTarget.dataset.index);
    const removedWasCorrect = this.data.optionItems[index] && this.data.optionItems[index].isCorrect;
    let options = this.data.optionItems.filter((item, i) => i !== index);
    options = this._normalizeOptions(options);
    if (removedWasCorrect && options.length && !options.some(o => o.isCorrect)) {
      options[0].isCorrect = true;
    }
    const correctIdx = options.findIndex(o => o.isCorrect);
    this._setFormState({
      optionItems: options,
      correctAnswerIndex: correctIdx < 0 ? 0 : correctIdx,
      'formData.correctAnswer': options[correctIdx < 0 ? 0 : correctIdx] ? options[correctIdx < 0 ? 0 : correctIdx].letter : 'A'
    });
  },

  // ===== 完成奖励模块 =====
  onToggleCoupon: function (e) {
    const on = !!e.detail.value;
    const patch = { rwCoupon: on };
    if (!on) {
      patch['formData.couponId'] = 0;
      patch.selectedCouponId = 0;
      patch.selectedCouponName = '';
    }
    this._setFormState(patch, this._syncRwAny);
  },
  onToggleText: function (e) {
    const on = !!e.detail.value;
    const patch = { rwText: on };
    if (!on) patch['formData.feedbackText'] = '';
    this._setFormState(patch, this._syncRwAny);
  },
  onToggleMedal: function (e) {
    const on = !!e.detail.value;
    const patch = { rwMedal: on };
    if (!on) {
      patch['formData.medalImg'] = '';
      patch['formData.medalName'] = '';
    }
    this._setFormState(patch, this._syncRwAny);
  },
  _syncRwAny: function () {
    this.setData({ rwAny: !!(this.data.rwCoupon || this.data.rwText || this.data.rwMedal) });
  },

  onRewardCouponChange: function (e) {
    const detail = e.detail || {};
    const couponId = Number(detail.couponId || 0);
    this._setFormState({
      selectedCouponName: detail.couponName || '',
      selectedCouponId: couponId,
      'formData.couponId': couponId,
      rwCoupon: couponId > 0
    }, this._syncRwAny);
  },

  onFeedbackTextChange: function (e) {
    this._setFormState({ 'formData.feedbackText': e.detail.value });
  },
  uploadMedal: function (e) {
    var that = this;
    app.chooseImage(function (res) {
      that._setFormState({ 'formData.medalImg': res[0] });
    }, 1, { crop: true, cropScale: '1:1' });
  },
  onMedalNameInput: function (e) {
    this._setFormState({ 'formData.medalName': e.detail.value });
  },
  onMedalStyle(e) {
    this._setFormState({ 'formData.medalStyle': (pickedItem(this.data.medalStyleOptions, e) || { key: 'glow' }).key });
  },
  clearMedal: function () {
    this._setFormState({ 'formData.medalImg': '', 'formData.medalName': '', 'formData.medalStyle': 'glow' });
  },

  // ===== 剧情故事模块(多时间节点) =====
  onStoryBeatText: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const beats = this.data.storyBeats.map((b, i) => (i === index ? { ...b, text: e.detail.value } : b));
    this._setFormState({ storyBeats: beats });
  },
  onStoryBeatTag: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const beats = this.data.storyBeats.map((b, i) => (i === index ? { ...b, tag: e.detail.value } : b));
    this._setFormState({ storyBeats: beats });
  },
  uploadStoryBeatImg: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    var that = this;
    const cur = (that.data.storyBeats[index] && that.data.storyBeats[index].imgs) || [];
    const remain = 6 - cur.length;
    if (remain <= 0) { toast('每个节点最多6张'); return; }
    app.chooseImage(function (res) {
      const beats = that.data.storyBeats.map((b, i) => (i === index ? { ...b, imgs: (b.imgs || []).concat(res).slice(0, 6) } : b));
      that._setFormState({ storyBeats: beats });
    }, remain);
  },
  removeStoryBeatImg: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    const imgIndex = parseInt(e.currentTarget.dataset.imgindex);
    const beats = this.data.storyBeats.map((b, i) => (i === index ? { ...b, imgs: (b.imgs || []).filter((_, k) => k !== imgIndex) } : b));
    this._setFormState({ storyBeats: beats });
  },
  addStoryBeat: function () {
    const beats = [...this.data.storyBeats, { id: Date.now() + Math.floor(Math.random() * 1000), text: '', tag: '', imgs: [] }];
    this._setFormState({ storyBeats: beats });
  },
  removeStoryBeat: function (e) {
    if (this.data.storyBeats.length <= 1) return;
    const index = parseInt(e.currentTarget.dataset.index);
    const beats = this.data.storyBeats.filter((b, i) => i !== index);
    this._setFormState({ storyBeats: beats });
  },

  // ===== 语音讲解模块 =====
  uploadAudio: function () {
    var that = this;
    // 每次选择都开一个新代:后一次选择/清空/模板回填会让前一次上传的回调失效,
    // 避免上传返回乱序时用旧结果覆盖新状态(不靠比 URL 假隔离)。
    var uploadSeq = (this._audioUploadSeq = (this._audioUploadSeq || 0) + 1);
    app.chooseDocument(function (res) {
      if (uploadSeq !== that._audioUploadSeq) return;
      if (res && res[0] && res[0].url) {
        var file = res[0];
        // 换新音频:先销毁旧预听并换代,再把新地址与空时长写进去(新时长由预听 onPlay 回填)。
        // 失败时 chooseDocument 不会回调到这里,旧音频与旧时长保持不动,可重试。
        that._invalidateAudioSource(true);
        that._setFormState({
          'formData.audioUrl': file.url,
          'formData.audioDuration': '',
          'formData.audioFileName': file.filename || '',
          'formData.audioFormat': file.type || ''
        });
      }
    }, 1, ['mp3', 'm4a', 'aac']);
  },
  onAudioDurationChange: function (e) {
    this._setFormState({ 'formData.audioDuration': e.detail.value });
  },
  clearAudio: function () {
    this.destroyPreviewAudio();
    this._setFormState({
      'formData.audioUrl': '', 'formData.audioDuration': '',
      'formData.audioFileName': '', 'formData.audioFormat': ''
    });
  },

  // 预听上传的音频
  onPreviewAudio: function () {
    var that = this;
    var url = this.data.formData.audioUrl;
    if (!url) return;
    if (this._previewAudio && this._previewAudio.src === url) {
      // 同一段音频 → 切换播放/暂停
      if (this.data.audioPreviewPlaying) {
        this._previewAudio.pause();
      } else {
        this._previewAudio.play();
      }
      return;
    }
    // 换源:销毁旧实例并换代,旧实例的异步回调从此失效(实例+代际双校验)
    this._invalidateAudioSource(false);
    var generation = this._audioGeneration;
    var audio = wx.createInnerAudioContext();
    audio.src = url;
    audio.obeyMuteSwitch = false;
    var isCurrent = function () {
      return generation === that._audioGeneration && that._previewAudio === audio;
    };
    audio.onPlay(function () {
      if (!isCurrent()) return;
      that.setData({ audioPreviewPlaying: true });
      // 自动识别时长
      if (!that.data.formData.audioDuration) {
        var d = Math.round(audio.duration || 0);
        if (d > 0) that._setFormState({ 'formData.audioDuration': d });
      }
    });
    audio.onPause(function () { if (isCurrent()) that.setData({ audioPreviewPlaying: false }); });
    audio.onStop(function () { if (isCurrent()) that.setData({ audioPreviewPlaying: false }); });
    audio.onEnded(function () { if (isCurrent()) that.setData({ audioPreviewPlaying: false }); });
    audio.onError(function (err) {
      if (!isCurrent()) return;
      that.setData({ audioPreviewPlaying: false });
      toast(safeUserMessage(err, '预听失败'));
    });
    // 先登记再 play:play() 若同步触发 onPlay,isCurrent 校验的实例已经是本实例。
    this._previewAudio = audio;
    audio.play();
  },

  stopPreviewAudio: function () {
    if (!this._previewAudio) return;
    try { this._previewAudio.stop(); } catch (e) {}
    this.setData({ audioPreviewPlaying: false });
  },

  // 音频源换代:销毁当前预听实例,并让所有旧预听回调失效。
  // 换文件、清空、模板回填、卸载都走这里;旧 audioContext 的 onPlay/onEnded 等即使晚到,
  // 也因「实例+代际」不匹配而写不进新音频的状态 —— 不再靠只比 URL 假隔离。
  // cancelUploads=true 时同时让在途上传回调失效(清空/换模板/卸载这类「整个音频态被替换」的动作)。
  _invalidateAudioSource: function (cancelUploads) {
    this._audioGeneration = (this._audioGeneration || 0) + 1;
    if (cancelUploads) this._audioUploadSeq = (this._audioUploadSeq || 0) + 1;
    var audio = this._previewAudio;
    this._previewAudio = null;
    if (audio) {
      try { audio.destroy(); } catch (e) {}
    }
    if (this.data.audioPreviewPlaying) this.setData({ audioPreviewPlaying: false });
  },

  destroyPreviewAudio: function () {
    this._invalidateAudioSource(true);
  },

  // ===== 封面 =====
  uploadPic: function (e) {
    var that = this;
    app.chooseImage(function (res) {
      that._setFormState({ 'formData.imgUrl': res[0] });
    }, 1, { crop: true, cropScale: '16:9' });
  },
  clearCover: function () {
    this._setFormState({ 'formData.imgUrl': '' });
  },

  switch1Change: function (e) {
    this._setFormState({ 'formData.isSync': e.detail.value ? 1 : 0 });
  },

  // ===== 模块增删 =====
  openAddSheet: function () {
    this.setData({ showAddSheet: true });
  },
  closeAddSheet: function () {
    this.setData({ showAddSheet: false });
  },

  addModule: function (e) {
    const key = e.currentTarget.dataset.key;
    const def = this.MODULE_DEFS.find(d => d.key === key);
    if (!def) return;
    const patch = {
      moduleList: [...this.data.moduleList, { key: key, name: def.name }],
      availableModules: this.data.availableModules.filter(d => d.key !== key),
      showAddSheet: false
    };
    if (key === 'finish') {
      patch['formData.validationMethod'] = 0;
      patch.methodSupportsHint = false;
    }
    if (key === 'story' && this.data.storyBeats.length === 0) {
      patch.storyBeats = [{ id: 1, text: '', tag: '', imgs: [] }];
    }
    this._setFormState(patch);
  },

  removeModule: function (e) {
    const key = e.currentTarget.dataset.key;
    const def = this.MODULE_DEFS.find(d => d.key === key);
    if (!def) return;
    if (key === 'voice') this.destroyPreviewAudio();
    const clearMap = {
      finish: {
        'formData.validationMethod': 0, optionItems: [], optionQuestion: '',
        'formData.questionImg': '', 'formData.questionAudio': '',
        'formData.questionOptionMediaJson': '',
        'formData.questionName': '', 'formData.questionAnswer': '',
        'formData.photoRequireDesc': '', 'formData.photoReview': 0,
        methodSupportsHint: false, hintEnabled: false,
        'formData.hint1': '', 'formData.hint2': '', 'formData.answerReveal': ''
      },
      reward: {
        'formData.couponId': 0, 'formData.feedbackText': '', 'formData.medalImg': '',
        'formData.medalName': '', 'formData.medalStyle': 'glow', selectedCouponName: '', selectedCouponId: 0,
        'formData.feedbackMethod': 0,
        rwCoupon: false, rwText: false, rwMedal: false, rwAny: false
      },
      story: { 'formData.storyText': '', storyBeats: [{ id: 1, text: '', tag: '', imgs: [] }] },
      voice: { 'formData.audioUrl': '', 'formData.audioDuration': '', 'formData.audioFileName': '', 'formData.audioFormat': '' }
    };
    const order = this.MODULE_DEFS.map(d => d.key);
    const newAvailable = [...this.data.availableModules, this._availItem(def)]
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    this._setFormState({
      moduleList: this.data.moduleList.filter(m => m.key !== key),
      availableModules: newAvailable,
      ...(clearMap[key] || {})
    });
  },

  _availItem: function (def) {
    return { key: def.key, name: def.name, desc: def.desc, iconName: def.iconName, tag: def.tag, tagClass: def.tagClass };
  },

  // 由当前 formData 反推模块状态
  initModuleState: function (pristine) {
    const f = this.data.formData;
    const onKeys = [];
    if (f.validationMethod > 0 || f.questionName || this.data.optionQuestion || this.data.optionItems.length) onKeys.push('finish');
    if (f.couponId > 0 || f.feedbackText || f.medalImg || f.medalName) onKeys.push('reward');
    if (this.data.storyBeats.some(b => (b.text && b.text.trim()) || (b.imgs && b.imgs.length))) onKeys.push('story');
    if (f.audioUrl) onKeys.push('voice');

    // 新建态默认核心模块;复用/草稿态用反推结果
    const keys = (this._templateId > 0) ? onKeys : ['finish', 'reward'];

    this._setFormState({
      moduleList: this.MODULE_DEFS.filter(d => keys.includes(d.key)).map(d => ({ key: d.key, name: d.name })),
      availableModules: this.MODULE_DEFS.filter(d => !keys.includes(d.key)).map(d => this._availItem(d)),
      methodSupportsHint: HINT_METHODS.includes(f.validationMethod),
      hintEnabled: !!(f.hint1 || f.hint2 || f.answerReveal),
      rwCoupon: f.couponId > 0,
      rwText: !!f.feedbackText,
      rwMedal: !!(f.medalImg || f.medalName),
      rwAny: !!(f.couponId > 0 || f.feedbackText || f.medalImg || f.medalName)
    }, null, { pristine: !!pristine });
  },

  hasModule: function (key) {
    return this.data.moduleList.some(m => m.key === key);
  },

  // ===== 校验滚动(scroll-view 内,用 scroll-into-view) =====
  scrollToError: function (key) {
    const selectorMap = {
      title: 'sec-top',
      description: 'sec-basic',
      players: 'sec-basic',
      duration: 'sec-basic',
      categoryIds: 'sec-basic',
      // 「玩法形态」那排 chip 与它的红字都在「模板信息」卡里(temp/index.wxml:132-137)
      interactionType: 'sec-basic',
      finish: 'sec-module',
      advanced: 'sec-module',
      reward: 'sec-module'
    };
    const target = selectorMap[key];
    if (!target) return;
    // 先清空再设置,确保同 id 重复触发也能滚动
    this.setData({ scrollIntoView: '' });
    setTimeout(() => { this.setData({ scrollIntoView: target }); }, 30);
  },

  // ===== 玩法类别 =====
  removeCategory: function (e) {
    const categoryId = parseInt(e.currentTarget.dataset.id);
    const that = this;
    const newSelectedIds = that.data.selectedCategoryIds.filter(id => id !== categoryId);
    const newSelectedNames = that.data.selectedCategoryNames.filter((name, index) => {
      return that.data.selectedCategoryIds[index] !== categoryId;
    });
    const newCategoryList = that.data.categoryList.filter(item => item.id !== categoryId);
    that._setFormState({
      selectedCategoryIds: newSelectedIds,
      selectedCategoryNames: newSelectedNames,
      categoryList: newCategoryList,
      'formData.activityCategoryids': newSelectedIds.join(',')
    });
    toast.success('移除成功', { duration: 1000 });
  },

  // 分类选择弹窗化(2026-07-31):不再 wx.navigateTo 到独立页面 + getCurrentPages() 回填,
  // 改成半屏 cy-category-sheet + 事件回传,直接复用既有 updateCategorySelection 不用改接收逻辑。
  navigateToCategorySelect: function () {
    this.setData({
      categorySheetVisible: true,
      categorySheetIds: this.data.selectedCategoryIds.join(','),
    });
  },

  onCategorySelect: function (e) {
    this.updateCategorySelection(e.detail.selectedIds, e.detail.selectedCategories);
  },

  onCategorySheetClose: function () {
    this.setData({ categorySheetVisible: false });
  },

  updateCategorySelection: function (selectedIds, selectedCategories) {
    const that = this;
    const selectedCategoryIds = selectedIds || [];
    const selectedCategoryNames = selectedCategories ? selectedCategories.map(item => item.categoryName) : [];
    const selectedCategoryNamesStr = selectedCategoryNames.join('，');
    that._setFormState({
      selectedCategoryIds: selectedCategoryIds,
      selectedCategoryNames: selectedCategoryNames,
      selectedCategoryNamesStr: selectedCategoryNamesStr,
      categoryList: selectedCategories || [],
      'formData.activityCategoryids': selectedCategoryIds.join(',')
    });
  },

  getCategoryNamesByIds: function (ids, callback) {
    const that = this;
    const categoryList = that.data.categoryList;
    const selectedNames = [];
    if (categoryList && categoryList.length > 0) {
      ids.forEach(id => {
        const category = categoryList.find(item => item.id === id);
        if (category) { selectedNames.push(category.categoryName); }
      });
    }
    if (callback && typeof callback === 'function') {
      callback(selectedNames);
    }
  },

  // ===== 预览态状态机 =====
  _buildPvSteps: function () {
    const steps = ['arrival'];
    if (this.hasModule('story') && this.data.storyBeats.some(b => (b.text && b.text.trim()) || (b.imgs && b.imgs.length))) {
      steps.push('story');
    }
    steps.push('challenge');
    steps.push('complete');
    const f = this.data.formData;
    const rewardFilled = (this.data.rwCoupon && this.data.selectedCouponName) ||
      (this.data.rwText && f.feedbackText) ||
      (this.data.rwMedal && (f.medalName || f.medalImg));
    if (rewardFilled) steps.push('reward');
    return steps;
  },

  /* ===== 玩法模块:选一个玩法 ===== */
  _gameSlotPatch: function (advanced) {
    const gameKey = nodeGameCatalog.detectGame(advanced);
    const game = nodeGameCatalog.findGame(gameKey);
    /* gameSection 是给 WXML 用的:十九个玩法的配置面板各自认自己的段名,
       比写十九条 gameKey === 'xxx' 短,也不会因为三种问答共用一段而写错。 */
    return Object.assign({
      gameKey: gameKey,
      gameCurrent: game,
      gameSection: game ? game.section : '',
      timerAvailable: nodeGameCatalog.supportsTimer(gameKey),
    }, this._presentPatch(advanced, game ? game.section : ''));
  },

  /* 呈现方式(契约 §1.5)的编辑器视图:显式配的优先,缺省按默认表(选项类默认内嵌,
     其余默认整屏);「只能全屏」那批把内嵌这一档锁死并给原因。 */
  _presentPatch: function (advanced, gameSection) {
    const explicit = advancedGameConfig.explicitPresent(advanced);
    const locked = advancedGameConfig.presentInlineLocked(gameSection);
    return {
      presentChoice: explicit || advancedGameConfig.defaultPresent(gameSection),
      presentInlineLocked: locked,
      presentLockReason: locked ? advancedGameConfig.PRESENT_LOCK_REASON : '',
    };
  },

  /* 点「内嵌故事流 / 整屏」。⚠️ 置灰那一道在这里也真拦:「只能全屏」的段即使被点到,
     applyPresent 也返回 null —— 只靠 WXML 的 aria-disabled 不是防线。 */
  onPickPresent: function (e) {
    const item = pickedItem(this.data.presentOptions, e);
    const value = item && item.key;
    const advanced = advancedGameConfig.applyPresent(this.data.advanced, this.data.gameSection, value);
    if (!advanced) return;
    const present = this._presentPatch(advanced, this.data.gameSection);
    /* 字段逐个写真源(不用展开/拼对象):U4 门禁要能静态核对 setData 顶层字段,
       拼出来的键它核不了,只能进动态债务 —— 这里本来就只有三个固定字段。 */
    this.setData({
      advanced: advanced,
      advancedConfigError: '',
      presentChoice: present.presentChoice,
      presentInlineLocked: present.presentInlineLocked,
      presentLockReason: present.presentLockReason,
    }, () => { this.refreshPreviewState(); });
    this._syncCheckDerived(advanced);
  },

  /* ===== 找东西:在图上点出目标位置 =====
     商家不填坐标、不填半径(原型:「你点哪儿就是哪儿,半径系统定」)。
     先点某个目标的「标位置」武装它,再点图 —— 不武装就点图不动,
     否则一张图上三个目标,点一下不知道该算给谁。 */
  armHotspot: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ hotspotArming: this.data.hotspotArming === index ? -1 : index });
  },

  placeHotspot: function (e) {
    const index = this.data.hotspotArming;
    if (index < 0) return;
    const spots = (this.data.advanced.hiddenObject || {}).hotspots || [];
    if (!spots[index]) return;
    const touch = (e.touches && e.touches[0]) || e.detail || {};
    const px = touch.x != null ? touch.x : touch.clientX;
    const py = touch.y != null ? touch.y : touch.clientY;
    wx.createSelectorQuery().in(this).select('.cg-ho-scene').boundingClientRect((rect) => {
      /* 量不到图的位置(还没布局完)就什么都不改 —— 这时候写进去的是一个错坐标,
         比不写更糟:商家看不出错,玩家点哪儿都不中。 */
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
        app.tips('图还没加载好，过一下再标');
        return;
      }
      const x = Math.min(1, Math.max(0, (px - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (py - rect.top) / rect.height));
      const next = spots.map((spot, i) => (i === index
        ? Object.assign({}, spot, { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) })
        : spot));
      this.setData({ 'advanced.hiddenObject.hotspots': next, hotspotArming: -1 });
    }).exec();
  },

  openGameSheet: function () {
    // 锚点要归零:不清的话第二次打开还停在上次跳到的那一组
    this.setData({ gameSheetOpen: true, sheetGroup: 0, sheetAnchor: '' });
  },

  /** 分类快捷条:点一下滚到那一组(原型 #sheetNav 的 scrollTo)。 */
  jumpGameGroup: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({ sheetGroup: index, sheetAnchor: 'gsheet-g' + index });
  },

  closeGameSheet: function () {
    this.setData({ gameSheetOpen: false });
  },

  pickGame: function (e) {
    const key = e.currentTarget.dataset.key;
    const modifier = nodeGameCatalog.MODIFIERS.find(item => item.key === key);
    if (modifier) {
      if (!this.data.gameKey) return toast('请先选择主玩法');
      if (this.data.gameKey === 'album') return toast('相册暂不支持叠加玩法');
      if (key === 'timer' && !this.data.timerAvailable) return toast('当前玩法不支持限时挑战');
      this.onAdvancedToggle({ currentTarget: { dataset: { key } }, detail: { value: true } });
      this.closeGameSheet();
      return;
    }
    const game = nodeGameCatalog.findGame(key);
    if (!game) return;
    /* 整段 advanced 一次写回,不用「advanced.xx.enabled」这种拼出来的路径 ——
       拼路径的写法过不了零消费门禁,也让人看不出到底动了哪几段。 */
    const advanced = nodeGameCatalog.applyToConfig(this.data.advanced, key);
    /* R14 检定的 checkId 是这一处检定的稳定标识。选中时就在本地模型里落一个 ——
       拖到保存时才由 normalize 补,会让同一次编辑里两次存盘生成两个不同的 id。 */
    if (advanced && advanced.check && advanced.check.enabled && !advanced.check.checkId) {
      advanced.check.checkId = rowId('check');
    }
    /* 玩法决定这个节点怎么算通关 —— 老链路的 validationMethod 也要跟着换,
       只改 advanced 的话节点会按上一个玩法的规则判通关,而且不报错。 */
    const present = this._presentPatch(advanced, game.section);
    this.setData({
      advanced: advanced,
      gameKey: key,
      gameCurrent: game,
      gameSection: game.section,
      timerAvailable: nodeGameCatalog.supportsTimer(key),
      gameSheetOpen: false,
      'formData.validationMethod': game.validationMethod,
      pvMethodLabel: game.label,
      pvMethodIconName: game.icon,
      presentChoice: present.presentChoice,
      presentInlineLocked: present.presentInlineLocked,
      presentLockReason: present.presentLockReason,
    }, () => {
      this._refreshOutcomeContract();
      this.refreshPreviewState();
    });
    this._syncCheckDerived(advanced);
  },

  /** 按商家此刻填的这份配置试玩(原型 §1.1 玩法模块底下那一条)。
      与「先看再选」不同:那个用样例,这个用真配置 —— 商家要看的是自己填的东西。 */
  tryCurrentGame: function () {
    const pvKit = advancedGamePreview.buildPreviewKit(this.data.advanced, {
      title: this.data.formData.title,
      limitSeconds: (this.data.advanced.timer && this.data.advanced.timer.enabled)
        ? Number(this.data.advanced.timer.durationSeconds) || 0 : 0,
    });
    if (!pvKit) { app.tips(noPreviewTip(this.data.gameSection)); return; }
    this.setData({
      previewVisible: true, canPublishGame: false,
      pvSteps: ['challenge'], pvStep: 0, pvKit,
    }, () => { this._applyPvStep(0); });
  },

  /* 先看再选:按「假如选了它」的那份配置造一屏,真配置一个字都不动。 */
  previewGameFromSheet: function (e) {
    const key = e.currentTarget.dataset.key;
    const draft = nodeGameCatalog.applyToConfig(this.data.advanced, key, { demo: true });
    if (!draft) return;
    /* 没有节点级配置的玩法(九宫格:九格与两档奖励配在主题上)永远建不出 kit ——
       给它一副范例屏,别让商家点了预览只吃到一句「要先配一点内容」、看不到这玩法长什么样。 */
    const pvKit = advancedGamePreview.buildPreviewKit(draft, { title: this.data.formData.title, limitSeconds: 0 })
      || advancedGamePreview.buildSampleKit(key);
    if (!pvKit) {
      app.tips(noPreviewTip(nodeGameCatalog.findGame(key) && nodeGameCatalog.findGame(key).section));
      return;
    }
    this.setData({
      gameSheetOpen: false, previewVisible: true, canPublishGame: false,
      pvSteps: ['challenge'], pvStep: 0, pvKit
    }, () => { this._applyPvStep(0); });
  },

  openPreview: function () {
    // 查看预览前必填校验
    const formData = this.prepareFormData();
    if (!this.validateForm(formData, false)) return;

    const steps = this._buildPvSteps();
    /* 按**商家刚填的那份**配置造 kit,不是按已保存的 —— 预览的全部意义就在于
       还没保存也能看到改动。配置里的秘密字段(答案之类)只走本地这一条路,
       不经过任何下发通道。 */
    const pvKit = advancedGamePreview.buildPreviewKit(this.data.advanced, {
      title: this.data.formData.title,
      limitSeconds: (this.data.advanced.timer && this.data.advanced.timer.enabled)
        ? Number(this.data.advanced.timer.durationSeconds) || 0 : 0,
    });
    this.setData({ previewVisible: true, canPublishGame: true, pvSteps: steps, pvStep: 0, pvKit }, () => {
      this._applyPvStep(0);
    });
  },
  /* 预览里的玩法事件。这里**不做判定** —— 判定在服务端,商家预览时没有会话。
     走到判定屏(玩法自己会出)就当这一步过了,让商家能继续往下看完整条流程。 */
  onPvKitAction: function (e) {
    const d = e.detail || {};
    if (d.action === 'close') { this.closePreview(); return; }
    if (d.action === 'roll' && this.data.pvKit && this.data.pvKit.mode === 'd20') {
      this.setData({ 'pvKit.result': advancedGamePreview.previewD20Result(this.data.pvKit) });
      return;
    }
    if (d.action === 'verdict' || d.action === 'drawn' || d.action === 'scanned') this.pvNext();
    // CU-C-11:问答类提交在预览里不判定,原来静默吞掉 ⇒ 点「提交」像坏了。明说,别让商家以为答错/没反应。
    else if (d.action === 'answer' || d.action === 'submit' || d.action === 'shoot') app.tips('试玩只看样子，不判对错');
  },
  closePreview: function () {
    this.setData({ previewVisible: false, canPublishGame: false, pvKit: null });
  },

  // 物理返回守卫(见 wxml 尾部 page-container):关最上层浮层,而不是退出编辑页
  onNativeBackGuard: function () {
    if (this.data.pickerSheet && this.data.pickerSheet.open) {
      this.closePickerSheet();
    } else if (this.data.categorySheetVisible) {
      this.onCategorySheetClose();
    } else if (this.data.showAddSheet) {
      this.closeAddSheet();
    } else if (this.data.previewVisible) {
      this.closePreview();
    }
    const stillGuarded = (this.data.pickerSheet && this.data.pickerSheet.open)
      || this.data.categorySheetVisible || this.data.showAddSheet || this.data.previewVisible;
    if (stillGuarded) {
      this.setData({ backGuardOff: true });
      setTimeout(() => this.setData({ backGuardOff: false }), 50);
    }
  },

  _applyPvStep: function (idx) {
    const steps = this.data.pvSteps;
    const i = Math.max(0, Math.min(idx, steps.length - 1));
    const key = steps[i];
    const labelMap = { arrival: '到达点位', story: '剧情解锁', challenge: '点位任务', complete: '任务完成', reward: '获得奖励' };

    const patch = {
      pvStep: i,
      pvStepKey: key,
      pvStepLabel: labelMap[key] || '',
      // 重置点位任务临时态
      pvAnswer: '',
      pvSelected: null,
      pvWrong: false,
      pvHintShown: false
    };

    if (key === 'story') {
      const beats = this.data.storyBeats.filter(b => (b.text && b.text.trim()) || (b.imgs && b.imgs.length));
      patch.pvBeats = beats.map((b, n) => ({
        id: n,
        label: (b.tag && b.tag.trim()) ? b.tag : ('时刻 ' + (n + 1)),
        text: b.text || '',
        imgs: Array.isArray(b.imgs) ? b.imgs : []
      }));
    }

    if (key === 'challenge') {
      const vm = this.data.formData.validationMethod;
      const tile = this._methodTile(vm);
      /* 选了玩法就报玩法的名字。十九个玩法里有十二个的 validationMethod 都是 0,
         照老表查名字会把「抛硬币」「倒计时」全说成「无需验证」。 */
      const game = this.data.gameCurrent;
      patch.pvMethodIconName = game ? game.icon : tile.iconName;
      patch.pvMethodLabel = game ? game.label : tile.label;
      const titleMap = {
        1: this.data.formData.questionName || '请回答下面的问题',
        3: this.data.optionQuestion || '请选择正确答案',
        2: this.data.formData.photoRequireDesc || '拍下你在现场的照片',
        4: '扫描现场的二维码',
        5: '走到目标位置',
        0: '点击下方按钮完成打卡'
      };
      patch.pvChallengeTitle = titleMap[vm] || '完成点位任务';
      const subMap = { 1: '提交答案', 3: '提交答案', 2: '上传并完成', 4: '完成扫码', 5: '我已到达此处', 0: '完成打卡' };
      patch.pvSubmitLabel = subMap[vm] || '完成';
      patch.pvHasHint = HINT_METHODS.includes(vm) && this.data.hintEnabled && !!(this.data.formData.hint1 || this.data.formData.answerReveal);
      patch.pvHintText = this.data.formData.hint1 || this.data.formData.answerReveal || '再仔细观察周围的细节';
    }

    this.setData(patch);
  },

  pvNext: function () {
    if (this.data.pvStep >= this.data.pvSteps.length - 1) return;
    this._applyPvStep(this.data.pvStep + 1);
  },
  pvPrev: function () {
    if (this.data.pvStep <= 0) return;
    this._applyPvStep(this.data.pvStep - 1);
  },
  onPvAnswer: function (e) {
    this.setData({ pvAnswer: e.detail.value, pvWrong: false });
  },
  onPvSelectChoice: function (e) {
    const index = parseInt(e.currentTarget.dataset.index);
    this.setData({ pvSelected: index, pvWrong: false });
  },
  pvUseHint: function () {
    this.setData({ pvHintShown: true });
  },
  pvSubmitChallenge: function () {
    const vm = this.data.formData.validationMethod;
    if (vm === 1) {
      const ans = (this.data.formData.questionAnswer || '')
        .split(/[、,，;；\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      const got = (this.data.pvAnswer || '').trim().toLowerCase();
      if (!got || (ans.length && !ans.includes(got))) {
        this.setData({ pvWrong: true });
        return;
      }
    } else if (vm === 3) {
      const correctIdx = this.data.optionItems.findIndex(o => o.isCorrect);
      if (this.data.pvSelected === null || this.data.pvSelected !== correctIdx) {
        this.setData({ pvWrong: true });
        return;
      }
    }
    this.pvNext();
  },

  // ===== 数据准备 / 校验 / 提交 =====
  prepareFormData: function () {
    const formData = { ...this.data.formData };
    formData.categoryIds = this.data.selectedCategoryIds.join(',');
    formData.imgArr = formData.imgUrl;

    // 完成方式模块:未添加则清空相关字段
    if (this.hasModule('finish')) {
      if (formData.validationMethod === 3) {
        formData.questionA = formData.questionB = formData.questionC = formData.questionD = '';
        this.data.optionItems.forEach((item) => {
          formData[`question${item.letter}`] = item.text;
        });
        formData.questionName = this.data.optionQuestion;
        const correct = this.data.optionItems.find(o => o.isCorrect);
        formData.correctAnswer = correct ? correct.letter : 'A';
        formData.questionOptionMediaJson = optionMedia.toJson(this.data.optionItems);
      } else {
        // 非选择题不带选项媒体:留着会在后端 sanitize 时对不上已被清空的选项文本
        formData.questionOptionMediaJson = '';
      }
      if (formData.validationMethod !== 6) formData.preferenceJson = '';
      // 题干附件只属于问答型(1 文字 / 3 选项),换成拍照/扫码/GPS 要一并清掉
      if (formData.validationMethod !== 1 && formData.validationMethod !== 3) {
        formData.questionImg = '';
        formData.questionAudio = '';
      }
      // 提示:开关关闭则清空
      if (!this.data.hintEnabled || !HINT_METHODS.includes(formData.validationMethod)) {
        formData.hint1 = '';
        formData.hint2 = '';
        formData.answerReveal = '';
      }
      // 非拍照清空拍照字段
      if (formData.validationMethod !== 2) {
        formData.photoRequireDesc = '';
        formData.photoReview = 0;
      }
    } else {
      formData.validationMethod = 0;
      formData.questionName = '';
      formData.questionAnswer = '';
      formData.photoRequireDesc = '';
      formData.photoReview = 0;
      formData.questionA = formData.questionB = formData.questionC = formData.questionD = '';
      formData.hint1 = formData.hint2 = formData.answerReveal = '';
    }

    // 完成奖励模块:推导 feedbackMethod;未添加则清空
    if (this.hasModule('reward')) {
      if (formData.couponId > 0) {
        formData.feedbackMethod = 1;
      } else if (formData.feedbackText) {
        formData.feedbackMethod = 2;
      } else {
        formData.feedbackMethod = 0;
      }
    } else {
      formData.feedbackMethod = 0;
      formData.couponId = 0;
      formData.feedbackText = '';
      formData.medalImg = '';
      formData.medalName = '';
    }

    // 剧情模块:序列化进 storyJson(后端 DTO CmsTemplatePublishRequest.storyJson,驼峰);未添加则空
    // 原字段名 story_json(下划线)与后端不匹配 → 剧情永不落库,故改驼峰。
    if (this.hasModule('story')) {
      const beats = this.data.storyBeats
        .filter(b => (b.text && b.text.trim()) || (b.imgs && b.imgs.length))
        .map(b => ({ text: b.text || '', tag: b.tag || '', imgs: Array.isArray(b.imgs) ? b.imgs : [] }));
      formData.storyText = beats.map(b => b.text.trim()).filter(Boolean).join('\n').slice(0, 500);
      formData.storyJson = beats.length ? JSON.stringify(beats) : '';
    } else {
      formData.storyText = '';
      formData.storyJson = '';
    }

    // 语音模块:未添加则清空
    if (!this.hasModule('voice')) {
      formData.audioUrl = '';
      formData.audioDuration = '';
    }

    const advancedOpts = this._advancedValidateOpts();
    const advancedError = advancedGameConfig.validate(this.data.advanced, advancedOpts);
    formData.advancedConfigJson = advancedError
      ? JSON.stringify(this.data.advanced)
      : advancedGameConfig.serialize(this.data.advanced, advancedOpts);

    return formData;
  },

  // 采用公共库模板时,blindTaste.answerKey / dailySign.poems 被服务端投影剥掉,
  // 本地必然为空 —— 校验放行这两个空值,发布时服务端从源模板补回(backfillAdoptedSecrets)。
  _advancedValidateOpts: function () {
    return { adoptedFromLibrary: Number(this.data.formData.originalTemplateId) > 0 };
  },

  _collectValidationErrors: function (draft) {
    const errors = {};
    const f = this.data.formData;

    // 标题(草稿也校验)
    if (!f.title || !f.title.trim()) errors.title = '请填写玩法标题';
    const advancedError = advancedGameConfig.validate(this.data.advanced, this._advancedValidateOpts());
    if (advancedError) errors.advanced = advancedError;
    const outcome = this._refreshOutcomeContract();
    if (outcome.errors.length) errors.advanced = outcome.errors[0].message;
    if (draft) return errors;

    // 发布:全量
    if (!f.description || !f.description.trim()) errors.description = '请填写玩法描述';
    else if (f.description.length > 30) errors.description = '玩法描述不超过30字';
    if (!f.players) errors.players = '请选择玩家人数';
    if (!f.duration) errors.duration = '请选择玩法时长';
    if (this.data.selectedCategoryIds.length === 0) errors.categoryIds = '请选择至少一个玩法类别';

    // 据点:玩法形态必选 —— 它决定玩家在店里看到的是什么(故事卡/隐藏菜单/拍照点/扫码)
    if (this.data.from === 'citynode' && !this.data.interactionType) {
      errors.interactionType = '请选择玩法形态';
    }

    // 玩法为核心:必须添加
    if (!this.hasModule('finish')) {
      errors.finish = '请添加「玩法」并选一个玩法，这是节点体验的核心';
    } else if (this.data.gameKey) {
      /* 选了玩法之后,题面/答案/选项都在它自己的配置里(advancedGameConfig.validate 把关),
         下面那串老的 validationMethod 必填只对「还没选玩法的旧模板」有效 ——
         两套一起跑的话,选项问答会被老链路要一遍 formData.questionName,而新模型里
         那个字段根本不再填,预览和发布会被一条永远填不满的必填卡死。
         主题级玩法(九宫格)在节点这一层也没有可填的东西,同样不额外要求。 */
    } else {
      const vm = f.validationMethod;
      if (vm === 1 && (!f.questionName || !f.questionAnswer)) errors.finish = '请填写问题和正确答案';
      if (vm === 3) {
        const filled = this.data.optionItems.filter(o => o.text && o.text.trim());
        if (!this.data.optionQuestion) errors.finish = '请填写问题';
        else if (filled.length < 2) errors.finish = '至少需要 2 个选项';
        else if (!this.data.optionItems.some(o => o.isCorrect)) errors.finish = '请设置正确答案';
      }
      if (vm === 6) {
        const preview = this.parsePreferencePreview(f.preferenceJson);
        if (preview.error) errors.finish = preview.error;
      }
      // ★ 选了估数/比价/找东西,却没把对应的玩法配置段打开 = 节点退化成到达即通关
      //   (ValidationMethod.completesOnArrive 收了 8/9/10),玩法静默不存在、零报错。
      //   这条不拦住,商家会以为自己配好了。
      const playSection = PLAY_METHOD_SECTIONS[vm];
      if (playSection && !(this.data.advanced[playSection] || {}).enabled) {
        errors.finish = `选了「${PLAY_METHOD_LABELS[vm]}」就要在「玩法」里打开并填完它`;
      }
    }

    // 完成奖励(若添加)
    if (this.hasModule('reward')) {
      const hasCoupon = f.couponId > 0, hasText = !!f.feedbackText, hasMedal = !!f.medalImg || !!f.medalName;
      if (!hasCoupon && !hasText && !hasMedal) errors.reward = '请至少配置一种奖励';
      else if (hasMedal && (!f.medalImg || !f.medalName)) errors.reward = '勋章需同时上传图片和名称';
    }

    // 语音讲解(若添加)
    if (this.hasModule('voice') && !f.audioUrl) {
      errors.voice = '请上传音频文件';
    }

    return errors;
  },

  refreshPreviewState: function () {
    const canOpenPreview = Object.keys(this._collectValidationErrors(false)).length === 0;
    if (canOpenPreview !== this.data.canOpenPreview) this.setData({ canOpenPreview });
    /* 推理类三段:校验错当场显示在玩法面板里(保存本来就会被 validateForm 拦下,
       这里解决的是「填错了要等点保存才知道」)。常量段名,不是拿 selected 的段去算。 */
    const gameConfigError = PANEL_LIVE_ERROR_SECTIONS.indexOf(this.data.gameSection) >= 0
      ? advancedGameConfig.validate(this.data.advanced, this._advancedValidateOpts()) : '';
    if (gameConfigError !== this.data.gameConfigError) this.setData({ gameConfigError });
    /* CU-M-69:「保存前摘要」跟着表单即时重算。把它挂在这里是因为每当 _setFormState 都会跑到 ——
       摘要不能只在「预览切到第 3 步」时才对,那时商家可能已经按着摘要看完了。 */
    const summary = this._summaryLabels();
    if (summary.method !== this.data.summaryMethodLabel || summary.duration !== this.data.summaryDurationText) {
      this.setData({ summaryMethodLabel: summary.method, summaryDurationText: summary.duration });
    }
  },

  /* 完成方式 ↔ 玩法名字的同一处取法(摘要与预览第 3 步共用,两处不再各算一份) */
  _methodTile: function (vm) {
    return METHOD_TILES.find(t => t.value === vm) || METHOD_TILES[METHOD_TILES.length - 1];
  },
  _summaryLabels: function () {
    const game = this.data.gameCurrent;
    const tile = this._methodTile(this.data.formData.validationMethod);
    return {
      // 选了玩法配置就报玩法的名字 —— 十九个玩法里有十二个 validationMethod 都是 0,
      // 照老表查会把「抛硬币」「倒计时」全说成「无需验证」
      method: game ? game.label : tile.label,
      duration: durationWithUnit(this.data.formData.duration),
    };
  },

  validateForm: function (formData, draft) {
    const errors = this._collectValidationErrors(draft);

    this.setData({ errors });
    if (draft) {
      if (errors.title) { this.scrollToError('title'); return false; }
      if (errors.advanced) { this.scrollToError('advanced'); return false; }
      return true;
    }
    const firstKey = PUBLISH_ERROR_ORDER.find(k => errors[k]);
    if (firstKey) { this.scrollToError(firstKey); return false; }
    return true;
  },

  // 「查看预览」置灰 = 还有必填没交。点它不空转:走一遍发布同款全量校验,
  // toast 报第一条缺项 + 定位滚动(errors 落字段旁红字),比「点了没反应」给得多。
  onPreviewDisabledTap: function () {
    const errors = this._collectValidationErrors(false);
    const firstKey = PUBLISH_ERROR_ORDER.find(k => errors[k]);
    if (firstKey) toast(errors[firstKey]);
    this.validateForm(this.data.formData, false);
  },

  publishGame: function () {
    if (this.data.from === 'citynode' && !this.data.merchantAccess.canManageProjects) {
      toast('当前岗位没有据点管理权限');
      return;
    }
    const formData = this.prepareFormData();
    if (this.data.from !== 'citynode') formData.scope = this.data.operationScope;
    if (!this.validateForm(formData, false)) return;
    delete formData.id;
    if (this._templateId && this._templateId != 0) {
      formData.copyFromTemplateId = this._templateId;
    }
    formData.status = 1;
    this.data.lastSubmitAction = 'publish';
    // 据点玩法走另一条写入路径。★ 不能图省事复用 /api/template/publish ——
    // 据点端点额外做两件这里没有的事:validationMethodError(按验证方式校验必填,
    // 配不全就落库的话玩家侧只表现成「怎么答都不对」)+ 微信内容安全 msgSecCheck,
    // 并落 merchantNodeEnabled=1 / nodeSubmitStatus=2。绕过去 = 静默把闸拆了。
    if (this.data.from === 'citynode') {
      return this.sendData(this.toNodeTemplate(formData), '/api/merchant/city-node/template/submit', 'publish');
    }
    this.sendData(formData, '/api/template/publish', 'publish');
  },

  /**
   * 表单形状 → CmsMemberTemplate 形状。两边字段名绝大多数同名(同一套模板模型),
   * 这里只处理对不上的那几个;漏一个就是静默丢配置,所以配了契约锁字段清单。
   */
  toNodeTemplate: function (formData) {
    const body = Object.assign({}, formData);
    // 表单的 feedbackMethod 是 UI 推导出来的数字,实体上叫 feedbackMethodStr(字符串)
    if (body.feedbackMethod != null) {
      body.feedbackMethodStr = String(body.feedbackMethod);
      delete body.feedbackMethod;
    }
    // 玩法语义:正交于 validationMethod,只有据点用,普通模板发布链路没有这个字段
    body.interactionType = this.data.interactionType || '';
    // categoryIds 是本页拼给发布 DTO 的,实体侧取 categoryId / activityCategoryids
    if (body.categoryIds) {
      body.activityCategoryids = body.categoryIds;
      const first = String(body.categoryIds).split(',')[0];
      if (first) body.categoryId = Number(first) || null;
      delete body.categoryIds;
    }
    // 本页独有的上传辅助字段,实体上没有,别塞
    delete body.audioFileName;
    delete body.audioFormat;
    delete body.copyFromTemplateId;
    return body;
  },

  onPickInteraction: function (e) {
    const item = pickedItem(this.data.interactionTypes, e);
    if (item) this._setFormState({ interactionType: item.key });
  },

  saveDraft: function () {
    if (this.data.from === 'citynode') {
      toast('据点玩法请配置完成后直接保存');
      return;
    }
    const formData = this.prepareFormData();
    formData.scope = this.data.operationScope;
    if (!this.validateForm(formData, true)) return;
    formData.status = 0;
    /* CU-M-68:只有「本人草稿续编」才能带 id —— 这个字段在两处含义不同:
       scope=my 进来时 _templateId 是 cms_member_template.id(后端按它 + memberId 归属更新);
       从货架/公开库进 来时 _templateId 是 cms_template_library.id(回填走的也是 /api/template/info)。
       把库 id 当草稿 id 发给 /api/template/draft,后端按 cms_member_template 查归属必然抛错
       —— 隔离环境实测:采用公开玩法后点「保存草稿」报「保存草稿失败，请稍后重试」,草稿零写入。
       采用态只带 originalTemplateId(formData 里现成),后端据此 insert 新草稿并保留来源。 */
    if (this.data.isMyScope === true && this._templateId > 0) {
      formData.id = this._templateId;
    }
    this.data.lastSubmitAction = 'draft';
    this.sendData(formData, '/api/template/draft', 'draft');
  },

  retrySubmit: function () {
    if (this.data.lastSubmitAction === 'publish') this.publishGame();
    else this.saveDraft();
  },

  sendData: function (data, url, action) {
    const that = this;
    if (url === '/api/merchant/city-node/template/submit'
        && !that.data.merchantAccess.canManageProjects) {
      toast('当前岗位没有据点管理权限');
      return;
    }
    if (that._submitting) return;
    that._submitting = true;

    const isDraft = (data.status === 0);
    const submittingAction = action || (isDraft ? 'draft' : 'publish');
    that.data.lastSubmitAction = submittingAction;
    that.setData({
      submitting: true,
      submittingAction: submittingAction,
      lastSubmitAction: submittingAction,   // 失败说明要按它说「草稿 / 发布」哪一步没成,得进视图层
      submitError: ''
    });

    app.sendRequest({
      url: url,
      hideLoading: true,
      silentError: true,
      data: JSON.stringify(data),
      method: "POST",
      header: {
        'Content-Type': 'application/json',
        'Authorization': app.getAuthorization()
      },
      success: function (res) {
        const createdId = positiveId(res && res.data && typeof res.data === 'object' ? res.data.id : res && res.data);
        if (res && res.code == "200" && createdId) {
          /* CU-M-68:草稿存成功后,本页此后编辑的就是「本人这份草稿」—— 换成新草稿 id 并切到本人口径。
             否则采用公开玩法后留在页里再存一次,还会拿公开库 id 走「采用」分支,再建一份重复草稿。 */
          if (submittingAction === 'draft') {
            that._templateId = createdId;
            that.data.isMyScope = true;
          }
          if (that.data.from === 'citynode') {
            // 回传给据点页:它拿 templateId 去提交投放申请。
            // 走 eventChannel 而不是 storage —— 页面栈回去就要用,存 storage 只会多一份可能过期的副本。
            const ch = that.getOpenerEventChannel && that.getOpenerEventChannel();
            if (ch && ch.emit) {
              ch.emit('templateCreated', {
                id: createdId,
                title: that.data.formData.title,
                interactionType: that.data.interactionType,
                advancedConfigJson: data.advancedConfigJson,
                validationMethod: that.data.formData.validationMethod
              });
            }
            that._submitting = false;
            that.data.dirty = false;
            that.setData({ submitting: false, submittingAction: '', submitError: '' });
            toast.success('玩法已保存');
            setTimeout(function () { that.exitPage(); }, 600);
            return;
          }
          if (that.data.from === 'fabu') {
            const tpl = {
              id: createdId,
              title: that.data.formData.title,
              players: that.data.formData.players,
              duration: that.data.formData.duration,
              advancedConfigJson: data.advancedConfigJson,
              imgUrl: that.data.formData.imgUrl || ''
            };
            const ch = that.getOpenerEventChannel && that.getOpenerEventChannel();
            if (ch && ch.emit) ch.emit('templateCreated', tpl);
            that._submitting = false;
            that.data.dirty = false;
            that.setData({
              submitting: false,
              submittingAction: '',
              submitError: '',
              creationSuccess: {
                show: true, eyebrow: '节点玩法已保存', title: tpl.title || '新玩法',
                detail: '已加入当前路线，可以继续完成主题。',
                metaPrimary: tpl.players ? (tpl.players + ' 人玩法') : '节点玩法已保存',
                metaSecondary: tpl.duration ? ('预计 ' + tpl.duration + ' 分钟') : '可继续补齐路线内容',
                primaryText: '返回路线编辑', secondaryText: '继续编辑玩法', showSecondary: true,
                primaryAction: 'back', secondaryAction: 'dismiss', closeAction: 'back'
              }
            });
          } else {
            that._submitting = false;
            that.data.dirty = false;
            that.setData({
              submitting: false,
              submittingAction: '',
              submitError: '',
              /* 2026-09-06 用户裁决:这一支的两颗按钮(查看模板库 / 返回上一页)都只是
                 选去哪一页,与其它发布链路同类 ⇒ 收敛成面板自愈后直接落模板库。
                 ⚠️ 上面那一支(「节点玩法已保存」)**没有**一起收:它的次要动作是
                 dismiss —— 「继续编辑玩法」是留在本页接着编,不是去别的页。
                 那是真分叉,自动跳走等于保存一次就把人踢出编辑器。 */
              resultSheet: {
                show: true, kind: 'success',
                title: isDraft ? '模板草稿已保存' : '节点玩法已发布',
                sub: isDraft ? '可以随时回到模板库继续编辑。' : '已进入你的模板库，可以用于新的城市路线。',
                meta: that.data.formData.duration ? ('预计 ' + that.data.formData.duration + ' 分钟') : '',
                pill: '', why: '', duration: RESULT_SHEET_MS,
              }
            });
          }
        } else {
          that._submitting = false;
          that.setData({
            submitting: false,
            submittingAction: '',
            submitError: safeUserMessage(res, '保存失败，请检查网络后重试')
          });
        }
      },
      fail: function (res) {
        that._submitting = false;
        that.setData({
          submitting: false,
          submittingAction: '',
          submitError: safeUserMessage(res, '网络暂时不可用，内容已保留，请重试')
        });
      }
    });
  },

  /* 面板收掉才走。只有「模板草稿已保存 / 节点玩法已发布」那一支用面板,落点固定模板库;
     「节点玩法已保存」那支仍走 creation-success 的两颗按钮(它有 dismiss = 留在原地)。 */
  onResultSheetClose() {
    this.setData({ 'resultSheet.show': false });
    wx.reLaunch({ url: '/subpackageMember/mytemplate/mytemplate' });
  },

  onCreationSuccessAction(e) {
    const key = (e.detail && e.detail.key) || 'close';
    this._leaveCreationSuccess(key === 'close' ? 'closeAction' : (key + 'Action'));
  },
  _leaveCreationSuccess(key) {
    const flow = this.data.creationSuccess || {};
    this.setData({ 'creationSuccess.show': false });
    if (flow[key] === 'dismiss') return;
    if (flow[key] === 'back') this.exitPage();
    else if (flow[key] === 'templates') wx.reLaunch({ url: '/subpackageMember/mytemplate/mytemplate' });
  },

  // ===== 回填 =====
  getData: function () {
    var that = this;
    const requestToken = (this._templateLoadToken || 0) + 1;
    this._templateLoadToken = requestToken;
    const isMyScope = this.data.isMyScope === true;
    this.setData({ editorLoading: true, loadError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: isMyScope ? '/api/template/myinfo' : '/api/template/info',
      data: { id: that._templateId },
      method: "POST",
      success: function (res) {
        if (requestToken !== that._templateLoadToken) return;
        const validRecord = isTemplateDetailPayload(res && res.data);
        if (res && res.code == "200" && validRecord) {
          if (isRecordList(res.data.sysCategoryList) && res.data.sysCategoryList.length > 0) {
            const selectedIds = res.data.sysCategoryList.map(item => item.id);
            const selectedNames = res.data.sysCategoryList.map(item => item.categoryName);
            that.setData({
              useNum: res.data.useNum,
              categoryList: res.data.sysCategoryList,
              selectedCategoryIds: selectedIds,
              selectedCategoryNames: selectedNames,
              selectedCategoryNamesStr: selectedNames.join('，')
            });
          }
          that.fillFormWithTemplateData(res.data);
          that.data.dirty = false;
          that.setData({ editorLoading: false, loadError: '' });
        } else {
          that.setData({
            editorLoading: false,
            loadError: safeUserMessage(res, '玩法详情格式异常，请重试')
          });
        }
      },
      fail: function (res) {
        if (requestToken !== that._templateLoadToken) return;
        that.setData({
          editorLoading: false,
          loadError: safeUserMessage(res, '网络暂时不可用，玩法详情未加载')
        });
      },
      complete: function () {
        if (requestToken === that._templateLoadToken && that.data.editorLoading) {
          that.setData({ editorLoading: false });
        }
      }
    });
  },

  retryGetData: function () {
    if (positiveId(this._templateId)) this.getData();
  },

  fillFormWithTemplateData: function (templateData) {
    this._albumEditRevision = (this._albumEditRevision || 0) + 1;
    if (!templateData) return;
    const that = this;
    // 模板回填会整块替换音频:先换代销毁旧预听,旧回调(含在途上传)不得再写进模板 C 的状态。
    that._invalidateAudioSource(true);

    let feedbackMethod = 2;
    if (templateData.feedbackMethodStr) {
      if (templateData.feedbackMethodStr === '优惠券反馈') feedbackMethod = 1;
      else if (templateData.feedbackMethodStr === '文字反馈') feedbackMethod = 2;
    } else if (templateData.feedbackMethod) {
      feedbackMethod = templateData.feedbackMethod;
    }

    const formData = {
      originalTemplateId: templateData.id || 0,
      categoryId: templateData.categoryId || 1,
      title: templateData.title ? `${templateData.title}` : "",
      description: templateData.description || "",
      imgUrl: templateData.imgUrl || "",
      players: templateData.players || "",
      usageLocation: templateData.usageLocation || "",
      requiredMaterials: templateData.requiredMaterials || "",
      duration: templateData.duration || "",
      difficulty: templateData.difficulty || "",
      isSync: 0,
      ruleInstructions: templateData.ruleInstructions || "",
      validationMethod: templateData.validationMethod || 0,
      feedbackMethod: feedbackMethod,
      questionName: templateData.questionName || "",
      questionAnswer: templateData.questionAnswer || "",
      feedbackText: templateData.feedbackText || "",
      couponId: templateData.couponId || 0,
      medalImg: templateData.medalImg || "",
      medalName: templateData.medalName || "",
      medalStyle: templateData.medalStyle || "glow",
      questionA: templateData.questionA || "",
      questionB: templateData.questionB || "",
      questionC: templateData.questionC || "",
      questionD: templateData.questionD || "",
      correctAnswer: templateData.correctAnswer || "A",
      activityCategoryids: templateData.activityCategoryids || "",

      hint1: templateData.hint1 || "",
      hint2: templateData.hint2 || "",
      answerReveal: templateData.answerReveal || "",
      photoRequireDesc: templateData.photoRequireDesc || "",
      // 拍照人工审核开关已下线(2026-09-17 用户拍板,一律机审):回显/保存恒 0,
      // 存量 photo_review=1 由 migration_play_photo_review_off_20260917.sql 置回。
      photoReview: 0,
      audioUrl: templateData.audioUrl || "",
      audioDuration: templateData.audioDuration || "",
      questionImg: templateData.questionImg || "",
      questionAudio: templateData.questionAudio || "",
      questionOptionMediaJson: templateData.questionOptionMediaJson || "",
      storyText: templateData.storyText || "",
      preferenceJson: templateData.preferenceJson || "",
      advancedConfigJson: templateData.advancedConfigJson || "",
      storyJson: templateData.storyJson || "",
      status: (templateData.status != null) ? templateData.status : 1
    };

    // 回填优惠券名称(用于奖励模块展示)
    const couponPatch = {};
    if (templateData.couponId) {
      couponPatch.selectedCouponId = templateData.couponId;
      if (templateData.couponName) couponPatch.selectedCouponName = templateData.couponName;
    }

    // 反序列化 storyJson -> storyBeats(后端返回驼峰 storyJson)
    const storyBeats = that._parseStoryJson(templateData.storyJson, templateData.storyText);

    // 难度 label
    const diffData = that.data.difficultyOptionsData || [];
    const diffItem = diffData.find(d => d.dictValue === formData.difficulty);

    const preferencePreview = that.parsePreferencePreview(formData.preferenceJson);
    const advancedResult = advancedGameConfig.parse(formData.advancedConfigJson);
    /* 旧版换玩法不关限时,库里有「检定 + 开着的限时」这种存量:开关藏着关不掉,玩家却会超时。
       打开时就关掉,作者一存就修好。 */
    nodeGameCatalog.dropStaleTimer(advancedResult.value, nodeGameCatalog.detectGame(advancedResult.value));
    const gameSlot = that._gameSlotPatch(advancedResult.value);
    const outcomeResult = nodeOutcomeContract.extract({
      validationMethod: formData.validationMethod,
      preferenceJson: formData.preferenceJson,
      advancedConfigJson: advancedResult.value
    });
    that.setData({
      formData: formData,
      // 存量模板里规则是一整段文字,按换行拆成步骤 —— 换界面不能让老数据读不出来
      ruleSteps: that._stepsFromText(formData.ruleInstructions),
      playersText: formData.players ? String(formData.players) : '',
      durationText: formData.duration ? String(formData.duration) : '',
      difficultyLabel: formData.difficulty ? String(formData.difficulty) : '',
      storyBeats: storyBeats,
      preferencePreview: preferencePreview.rows,
      preferenceConfigError: formData.preferenceJson ? preferencePreview.error : '',
      advanced: advancedResult.value,
      gameKey: gameSlot.gameKey,
      gameCurrent: gameSlot.gameCurrent,
      gameSection: gameSlot.gameSection,
      timerAvailable: gameSlot.timerAvailable,
      presentChoice: gameSlot.presentChoice,
      presentInlineLocked: gameSlot.presentInlineLocked,
      presentLockReason: gameSlot.presentLockReason,
      dailySignDrafts: that._dailySignDraftsOf(advancedResult.value),
      advancedConfigError: advancedResult.error,
      outcomePreview: outcomeResult.items,
      outcomeContractErrors: outcomeResult.errors,
      difficultyLabel: diffItem ? diffItem.dictLabel : (formData.difficulty ? String(formData.difficulty) : ''),
      ...couponPatch
    });

    if (templateData.activityCategoryids) {
      that.setCategorySelectionFromTemplate(templateData);
    }

    if (templateData.validationMethod === 3) {
      that.setOptionDataFromTemplate(templateData);
    }

    that.updatePickerSelectionsFromTemplate(templateData);

    // 反推模块状态(含 hint/rw 开关)
    that.initModuleState(true);

    /* CU-M-69:回填走的是整块 setData(不经过 _setFormState),摘要得在这里显式重算一次 ——
       否则采用来的模板第一次打开预览时,摘要还是初值「待配置/未设置时长」。 */
    that.refreshPreviewState();

    if (that.data.previewMode) {
      // FE-04 纯预览态:模板加载完直接进只读预览浮层(cg-pv-bottombar 发布控件已被 previewMode 隐藏)。
      that.openPreview();
    }
  },

  _parseStoryJson: function (raw, storyText) {
    const fallback = [{ id: 1, text: String(storyText || ''), tag: '', imgs: [] }];
    if (!raw) return fallback;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.map((b, i) => ({
          id: i + 1,
          text: b.text || '',
          tag: b.tag || '',
          // 兼容旧数据:老的单图 b.img 字符串 → 收进 imgs 数组
          imgs: Array.isArray(b.imgs) ? b.imgs : (b.img ? [b.img] : [])
        }));
      }
    } catch (err) { }
    return fallback;
  },

  getUserData: function () {
    let that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      data: { member_id: app.getUserID() },
      method: "POST",
      success: function (res) {
        if (res.code == "200") {
          that.setData({ 'userData': res.data });
          loading.hide();
        }
      },
      fail: function (res) { }
    });
  },

  setOptionDataFromTemplate: function (templateData) {
    const optionItems = [];
    const correctAnswerOptions = [];
    let correctAnswerIndex = 0;
    const letters = ['A', 'B', 'C', 'D'];

    letters.forEach(letter => {
      const text = templateData[`question${letter}`];
      if (text) {
        optionItems.push({
          letter: letter,
          text: text,
          isCorrect: templateData.correctAnswer === letter,
          img: '',
          audio: ''
        });
        correctAnswerOptions.push(`${letter}.${text}`);
        if (templateData.correctAnswer === letter) correctAnswerIndex = optionItems.length - 1;
      }
    });

    this.setData({
      optionItems: optionMedia.applyToOptions(optionItems, templateData.questionOptionMediaJson),
      optionQuestion: templateData.questionName || "",
      correctAnswerOptions: correctAnswerOptions,
      correctAnswerIndex: correctAnswerIndex
    });
  },

  setCategorySelectionFromTemplate: function (templateData) {
    const that = this;
    if (templateData.sysCategoryList && templateData.sysCategoryList.length > 0) {
      return;
    }
    if (templateData.activityCategoryids) {
      const idArray = String(templateData.activityCategoryids).split(',').map(id => parseInt(id.trim())).filter(Number.isSafeInteger);
      that.getCategoryNamesByIds(idArray, function (selectedNames) {
        that._setFormState({
          selectedCategoryIds: idArray,
          selectedCategoryNames: selectedNames,
          selectedCategoryNamesStr: selectedNames.join('，'),
          'formData.activityCategoryids': templateData.activityCategoryids
        }, null, { pristine: true });
      });
    }
  },

  updatePickerSelectionsFromTemplate: function (templateData) {
    const that = this;
    const patch = {};
    if (templateData.duration && that.data.durationOptionsData) {
      const idx = that.data.durationOptionsData.findIndex(item => item.dictValue == templateData.duration);
      if (idx !== -1) { patch.durationIndex = idx; patch.durationText = that.data.durationOptionsData[idx].dictLabel; }
    }
    if (templateData.difficulty && that.data.difficultyOptionsData) {
      const idx = that.data.difficultyOptionsData.findIndex(item => item.dictValue == templateData.difficulty);
      if (idx !== -1) { patch.difficultyIndex = idx; patch.difficultyLabel = that.data.difficultyOptionsData[idx].dictLabel; }
    }
    if (templateData.players && that.data.playersOptionsData) {
      const idx = that.data.playersOptionsData.findIndex(item => item.dictValue == templateData.players);
      if (idx !== -1) { patch.playersIndex = idx; patch.playersText = that.data.playersOptionsData[idx].dictLabel; }
    }
    if (Object.keys(patch).length) that.setData(patch);
  },
});
