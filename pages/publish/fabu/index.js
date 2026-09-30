const modal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const cyToast = require('../../../utils/toast.js');
let app = getApp();
const AI_DRAFT_LEGACY_KEY = 'ai_topic_draft';
function aiDraftStorageKey() {
  const memberId = app.getUserID && app.getUserID();
  return memberId === null || memberId === undefined || memberId === ''
    ? '' : AI_DRAFT_LEGACY_KEY + ':m' + memberId;
}
function readAiDraft() {
  wx.removeStorageSync(AI_DRAFT_LEGACY_KEY);
  const key = aiDraftStorageKey();
  return key ? wx.getStorageSync(key) : null;
}
function writeAiDraft(draft) {
  wx.removeStorageSync(AI_DRAFT_LEGACY_KEY);
  const key = aiDraftStorageKey();
  if (key) wx.setStorageSync(key, draft);
}
const analytics = require('../../../utils/analytics.js');
const roleGuard = require('../../../utils/roleGuard.js');
const { createErrorBag, nonEmpty } = require('../utils/publish/publish-validator.js');
const { cityOrientationScheduleIssues } = require('../utils/publish/publish-ticket-schedule.js');
const { createPublishWorkflow } = require('../utils/publish/publish-workflow.js');
const proEditorPolicy = require('../../../utils/publish/pro-editor-policy.js');
const proEditorDraft = require('../../../utils/publish/pro-editor-draft.js');
const proEditorMaterials = require('../utils/publish/pro-editor-materials.js');
const proEditorStory = require('../utils/publish/pro-editor-story.js');
const publishStats = require('../utils/publish/publish-stats.js');
const publishDate = require('../utils/publish/publish-datetime.js');
const { pickLocation } = require('../../../utils/location/location-manager.js');
const subscribe = require('../../../utils/subscribe.js');
const { TOPIC_EDITOR_SWITCH_COLOR } = require('../../../utils/play-visual-tokens.js');
const { resolveMenuChrome } = require('../../../utils/nav-safe-area.js');
const { PRESETS: CHAPTER_ATMOSPHERES, normalizeAtmosphere } = require('../../../utils/chapter-atmosphere.js');
const { isRecord, isRecordList } = require('../../../utils/response-shape.js');
const advancedGameConfig = require('../utils/publish/advanced-game-config.js');
const topicRouteGraph = require('../utils/publish/topic-route-graph.js');
const routeMapView = require('../utils/publish/route-map-view.js');
const publishValidationBag = require('../utils/publish/publish-validation-bag.js');
const publisherIdentity = require('../../../utils/publisher-identity.js');
const nodeOutcomeContract = require('../utils/publish/node-outcome-contract.js');
const { sendUiStateRequest } = require('../../../utils/ui-state-request.js');

// 时/分选项与 HH:mm 格式化的单一真源(补零口径全仓一致)
const timeOptions = require('../../../utils/time-picker-options.js');

// CU-C-160:发布前检查里每条缺项的「去填写」要落到字段真正所在的那一屏。
// 票务与档期(editorPage 2)与主题详情弹窗是两块各自渲染的容器,同一个锚点只在
// 所属那一屏里存在 —— 所以定位要先切屏/开层、再滚锚点,顺序反了就是一次空滚。
const ISSUE_PAGE2_ANCHORS = ['fieldDates', 'fieldRecruitDeadline', 'ticketSection'];
const ISSUE_SHEET_ANCHORS = ['fieldDescription', 'fieldVisual', 'fieldCategory', 'fieldCompletionRule'];

// CU-C-87:章节标题 = 位置序号 + 用户填的名字;名字自带编号(「第1章 隔离书店站」)时
// 不再叠一层,否则编辑页与发布确认页都会出现「第1章 第1章 隔离书店站」。
// ⚠️ utils/wxs/chapter-title.wxs 是这份的第二份实现(章节卡在 wxml 里渲染,WXS 不能
// require 普通 JS 模块)。两份不许漂移,tests/unit/chapter-title-dedupe-contract.test.js 钉住。
const CHAPTER_ORDINAL = /^第.{1,3}章/;
function chapterCardTitle(index, name) {
  const raw = name === null || name === undefined ? '' : String(name);
  const seq = '第' + (index + 1) + '章';
  if (CHAPTER_ORDINAL.test(raw)) return raw;
  return raw ? seq + ' ' + raw : seq;
}
function isEditingTopicPayload(detail) {
  if (!isRecord(detail) || !isRecord(detail.topic)) return false;
  if (detail.chapters != null && !isRecordList(detail.chapters)) return false;
  if (detail.tickets != null && !isRecordList(detail.tickets)) return false;
  if (detail.collaboratorIds != null && (!Array.isArray(detail.collaboratorIds)
      || !detail.collaboratorIds.every(function (id) {
        if (typeof id === 'number') return Number.isSafeInteger(id) && id > 0;
        return typeof id === 'string' && /^\d+$/.test(id)
          && Number.isSafeInteger(Number(id)) && Number(id) > 0;
      }))) return false;
  return (detail.chapters || []).every(function (chapter) {
    return chapter.cmsTopicNodeList == null || isRecordList(chapter.cmsTopicNodeList);
  });
}

// —— 路线地图(Strava 化)——
// 章节分段色(<map> 颜色只能在 JS 设)
// ⚠️ <map> 的颜色只能在 JS 里设,吃不到 CSS var —— 这是本色板必须留一份 JS 字面量
//    的原因,不是漏改。它与 tokens.wxss 的 --cy-route* 是**两份要手动同步的真源**。
// 2026-08-05 去紫收口:首色 2026-08-01 已改中性 #1A1A1A,当时注释里留了两条待裁决
//    (「--cy-route 仍是 #7A5CFF」「索引 3 的 #7048E8 也带紫相」)。用户已裁决紫色
//    只在极特殊情况用,两条一并清掉:tokens 的 --cy-route 改 #1A1A1A、--cy-route-4
//    改青 #0CA5A5,这里的索引 3 同步。六色现在的色相是 0/221/162/180/39/339,互相拉开。
const ROUTE_COLORS = ['#1A1A1A', '#155DFC', '#12B886', '#0CA5A5', '#F59F00', '#E64980'];
// 节点照片裁剪比例:消费面是 topic 详情节点缩略图(common.wxss .item-pic image 234×160rpx ≈ 1.46),
// 微信 cropScale 里最贴近的横图档就是 4:3。两个上传入口(内联行 / 抽屉)必须同比例,
// 否则同一批节点图在详情页里高矮不一。
const NODE_PHOTO_RATIO = '4:3';
// 地图图钉。2026-08-11 换掉 /images/d_location.png:那张只有 24×25px,而 marker 要显示到
// 30 / 42px(选中态),位图放大必糊 —— 这才是"地图上的节点标记看着不对"的真原因,
// 不是没有 icon。新图 144×144 正方形(marker 的 width/height 传同一个值,非正方会被拉伸)、
// 尖端落到底边(marker 默认锚点是底部中心,尖端不到底边则标点整体上偏)。
// ⚠️ 放分包 pages/publish/images/,不进主包 —— #697 刚做完主包瘦身,别往回加。
// ⚠️ 只做一张黑图钉:选中态靠"放大 + 序号标签变色"表达,白图钉压在浅色地图瓦片上反而看不见。
const MAP_PIN = '/pages/publish/images/map-pin.png';
// pin 状态色:起点固定绿 / 终点固定红 / 未配游戏的草稿节点灰(已配游戏仍用章节色)
const START_COLOR = '#12B886'; // 起点
const END_COLOR = '#FA5252';   // 终点
const DRAFT_COLOR = '#ADB5BD'; // 草稿(未配游戏)
const SELECTED_COLOR = '#1A1A1A'; // 列表↔地图联动选中态(去紫,与 route-map/topic 同值)
const MAP_DEFAULT_CENTER = { longitude: 121.4737, latitude: 31.2304 }; // 上海人民广场兜底
const UNDO_CAP = 20; // 撤销栈上限
const IMG_ARR_MAX = 9; // 横版封面张数上限(与门店相册一致)
// AI 频控超限文案前缀:后端运行时拼上限数字(`今日AI次数已用完(20/天),明天再来吧`),只能前缀匹配
const AI_QUOTA_HINT = '今日AI次数已用完';
// AI 预检的输入(_buildPrecheckReq)里根本没有这些字段 ⇒ 模型的判断是凭空猜测,不能拿来阻断发布
const AI_BLIND_ISSUE_TYPES = ['missing_cover'];
/* 结果面板终态的停留时长(cy-result-sheet 的 duration 默认也是 2000)。
   保存成功后要跳走,面板时长与跳转延时必须是同一个数 —— 分开写会漂成
   「面板还在播就被顶掉」或者「收完了还空等一截」。 */
const RESULT_SHEET_MS = 2000;

Page({
  _routeGraph: topicRouteGraph.emptyGraph(),
  _routeMappingSourceNodeId: '',
  _routeMappingReturnToNodeEditor: false,

  data: {
    // [B3b] 编辑既有主题:三个入口(项目列表草稿/未通过卡、模板「使用此模板」)都带 ?id= 跳进来。
    // 空 = 新建。非空时 onLoad 拉 /api/topic/edit-detail 回填,保存走 /api/topic/update 而不是 create
    // —— 原来页面压根不读 options.id,于是「编辑」= 在空表单上再建一条,草稿越编越多。
    editingTopicId: '',
    operationScope: '',
    // 后端下发的编辑窗口档位:FULL=全字段可改 / WHITELIST=已过审开卖,只能改文案与图
    editScope: 'FULL',
    // 能不能开商家池(只有俱乐部主理人可以)。初值 true = 「还没判出来」,与
    // _syncMerchantPoolEligibility 的「快照不可靠时不压值」同一口径:宁可多显示一个开关,
    // 也不要在判不出资格时把主理人的招商静默关掉。
    merchantPoolEditable: true,
    // 稿 E2(99:6181 / 99:6679):能不能设通关勋章(can_design_medal)。
    // 默认 true —— 拿不到权限快照时不擅自上锁,与上面招商资格同一条取舍。
    medalEditable: true,
    // 回填是否已到位。编辑态下没到位就不许保存 —— FULL 档保存会整体重建章节/票,
    // 拿一份空表单去重建 = 把原主题的路线和票删光
    editLoaded: false,
    editorPage: 1,          // 1 创作 / 2 票务。两页是固定的,不是向导 —— 页内不设门控
    modePickerShow: false,  // 主题模式选择器(城市定向 / 自由探索)
    modePickerMode: 1,      // 选择器里的暂选档;点「确定」才真的切
    viewMode: 'list',       // list | map —— 左下角药丸切换,只在第 1 页有意义
    topicDetailShow: false, // 主题详情弹窗
    topicDetailSummary: '', // 入口卡上的摘要:还差几项
    chapterStates: [],      // 由 pro-editor-policy 算出的派生态,不进 formData(见 refreshPrimaryActionState)
    chapterActionLabels: [],
    creationAnchor: 'story',
    starterAction: null,
    pendingMaterials: [],
    pendingMaterialStates: {},
    // text 由各删除路径自带:故事流 ✕ 是真删,自由探索的删除是移到待编排区 ——
    // 语义不同,共用一句文案必然有一条在骗人。
    pendingUndo: { show: false, materialLocalId: '', text: '' },
    storyEditor: { show: false, chapterIndex: -1, insertMenuAt: -1, focusBlockKey: '', selectedBlockKey: '' },
    /* 故事变量选择器(契约 §3.1):列出这个主题里可用的 {键}。keys 在打开时现算 ——
       它跟着各节点玩法模板走,节点玩法改了它就得跟着变,存一份快照迟早对不上。 */
    storyVarSheet: { show: false, blockKey: '', keys: [] },
    pendingInsertAt: null,
    storyPendingMaterialLocalId: '',
    clubPlaceCaptureActive: false,
    draftUuid: '',
    baseRevision: '',
    draftMemberId: '',
    canPublish: false,
    editorState: 'idle', // 编辑器状态机 合法值:idle/addNode/moveNode/editNode/editGame/preview/publishCheck
    publishToCreative: true,
    aiSimple: false,
    themeSwitchColor: TOPIC_EDITOR_SWITCH_COLOR,
    // 发布前检查弹层(M4·A):blocking=硬必填(阻断),advisory=软建议(不阻断)
    publishCheck: { show: false, blocking: [], advisory: [], summary: [], passed: [], preview: null },
    // RUN-52 发布者实名(挂进上面那一层弹层)。registered 只有真/假 —— 接口不下发姓名与证件号;
    // ready 驱动「必填项」那条与「确认发布」的可点性;字段刻意不放 formData,免得混进主题提交 payload。
    identityRegistered: false,
    identityReady: false,
    identityRealName: '',
    identityIdCard: '',
    identityConsented: false,
    identityError: '',
    identityHint: publisherIdentity.CONSENT_TEXT,
    // 通用设置 Tab 渐进折叠(M4·B,'_' 非前缀但纯前端态,不参与提交):票务/合作者卡可折叠,默认展开
    secCollapsed: { ticket: false, collab: false },
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    chrome: { actionTop: 28, actionRight: 12, contentTop: 76, sheetTop: 69 },

    // 通用编辑弹框数据
    submitErrorWhy: false,   // 「为什么会这样」展开与否(稿 S15/S16)

    //章节参数
    popChapter: false, //显示添加章节弹框
    // 编辑章节弹窗是不是从故事流底栏「下一步」进来的 —— 决定它叠在故事流上还是单层,
    // 以及「完成」要不要连故事流一起收(用户 2026-09-05 定的两种呈现)
    chapterSettingsFromStory: false,
    popChapterAction: 0, //0添加 1编辑
    popChapterIndex: 0, //章节索引

    //节点参数
    popChapterNodes: false, //显示添加节点弹框
    nodeSheetView: 'detail', //节点抽屉视图 'detail' | 'games'
    popChapterNodesAction: 0, //0添加 1编辑
    popChapterNodesIndex: 0, //节点索引
    editTargetChapterLid: '', //当前编辑/添加目标章节 _localId
    editTargetNodeLid: '', //当前编辑目标节点 _localId
    editingPendingLocalId: '',
    nodeDraftDestination: 'formal', // formal | pending
    assignPendingLocalId: '',

    selectedCategoryIds: [], // 选中的分类ID数组
    selectedCategoryNames: [], // 选中的分类名称数组
    categorySheetVisible: false,
    categorySheetIds: '',
    selectedCategoryNamesStr: '', // 选中的分类名称字符串，用于显示
    categoryList: [],
    categoryIndex: 0,
    // 章节承接只认商家档案同口径的受控分类；与主题分类列表分开，避免互相污染选择态。
    merchantCategoryList: [],
    merchantCategoryLoading: false,
    atmosphereOptions: CHAPTER_ATMOSPHERES,

    minuteOptions: ['30', '60', '90', '120'], // 分钟选项
    minuteIndex: 0, // 默认选中的索引

    tempList: [], //我自己的模板
    publicTempList: [], //公共玩法库(平台精选/热门/最新)
    searchKeyword: '', // 搜索关键词
    selectedTempId: null, // 当前选中的模板ID
    selectedTempInfo: null, // 选中的模板完整信息

    //章节数据
    chapterForm: {
      name: '',
      description: '',
      imgArr: '',
      nodes: [],
      calculatedDistance: 0,
      category: '',
      categoryId: null,
      recruitEnabled: 0,
      termsMode: 'PERK',
      perkMinValue: null,
      maxMerchant: 0,
      atmospherePreset: 'DEFAULT',
      // 章节背景旁白,一章最多一段(2026-09-04 拍板)。玩家进入本章自动播放。
      audioUrl: '',
      audioDuration: 0,
      audioFileName: '',
      // 玩法边界:空 = 不限(存量语义)。承接通过时冻进 offer,之后按冻结的那份校验。
      allowedValidationMethods: '',
      maxNodeXp: null
    },
    // 与 cms_member_template.validation_method 取值域一致;后端 assertAllowedValidationMethods 只收 1-5
    validationMethodOptions: [
      { v: '1', label: '文字作答' },
      { v: '3', label: '选项问答' },
      { v: '2', label: '拍照打卡' },
      { v: '4', label: '到店扫码' },
      { v: '5', label: 'GPS 到达' }
    ],

    //节点数据
    nodesForm: {
      description: '',
      name: '',
      subtitle: '',
      address: '',
      longitude: '',
      latitude: '',
      imgUrl: '',
      nodeTime: 0,
      showTemplate: false,
      templateId: 0,
      templateInfo: {},
      templateName: '',
      businessTime: '',
      sortID: 1,
      // 自由定向(mode2)选填叙事文案:留空后端回退用 description
      hookText: '',
      cardHookLong: '',
      fragmentText: ''
    },
    nodesFormLocationReady: false,
    // 表单数据
    formData: {
      name: '',
      subtitle: '',
      description: '',
      startDate: '',
      endDate: '',
      imgUrl: '',
      // 横版封面:多张,存逗号分隔 CSV(与章节 imgArr、utils/wxs/img.wxs 同约定)。
      // step3 画廊渲染用的展开数组是 imgArrList,两者由 _setImgArr 统一写。
      imgArr: '',
      categoryIds: [],
      chapters: [],
      collaboratorIds: [],
      collaboratorList: [],
      tickets: [],
      openMerchantPool: false, // 是否允许路线进入商家池(默认关=自办;能不能开由 merchantPoolEditable 决定)
      openClubPool: true, // 开放范围·俱乐部承接(P0-4):开=俱乐部可在合作池申请承接。2026-09-15 裁决 12B:默认开,主办可手动关;自由探索无此池(上送归一为 0)
      // 自由定向必须经招商→锁价链路，截止日不能由前端静默兜底。
      recruitDeadline: '',
      clubId: '', // 归属俱乐部ID(经典定向必选,自由定向可选挂靠·2026-07-02拍板;一人多俱乐部时由发布者选定,D3/D12)
      // M2 自玩票(仅经典定向):是否开放 + 价格 + 票数配额
      selfPlay: false,
      selfPlayPrice: '',
      selfPlayQuota: '',
      teamMode: 0,
      teamMaxMembers: 4,
      // P0.5 勋章(两模式;XP 自动分配零配置)
      finishMedalName: '',
      finishMedalImg: '',
      completeRewardCouponId: 0,
      completeRuleJson: '',
      // 主题级路线真源。旧数据/空值保持 LINEAR；BRANCH_GRAPH 才序列化 routeGraphJson。
      routeMode: 'LINEAR',
      routeGraphJson: '',
      configVersion: ''
    },
    teamMemberOptions: [2, 3, 4],

    // formData.imgArr 的展开数组,只服务 step3 画廊渲染(WXML 不能 split)
    imgArrList: [],
    imgArrMax: IMG_ARR_MAX, // 给 WXML 用,别在模板里再写一遍 9
    completionRewardCouponName: '',
    completeRewardOn: false,   // 纯 UI 态:开关开着但还没选券的那一档
    completionRuleMode: 'ALL',
    completionRequiredCount: 1,
    completionRuleError: '',

    // 节点内的轻量「模板结果 → 下一站」编辑态。技术起点/终点由故事流顺序派生，
    // 创作者只处理当前节点的结果对应关系。
    routeMappingShow: false,
    routeMappingSourceLabel: '',
    routeMappingTemplateLabel: '',
    routeMappingRows: [],
    routeMappingFallbackLabel: '继续故事流',
    routeNodeMappingSummary: {},

    audioPreviewPlaying: false,
    // 故事流音频块预听(与章节旁白共用同一个播放器,见 onPreviewStoryAudio)。
    // storyAudioKey = 正在播/暂停的那一块 key;'' 表示没有块音频在播。
    storyAudioPlaying: false,
    storyAudioKey: '',

    // 归属俱乐部选择(达人多俱乐部:/api/club/my 的 owned[])
    myClubs: [], // 我创建的俱乐部列表 [{id,name}]
    clubIndex: -1, // 当前选中俱乐部在 myClubs 的索引,-1=未选

    // 错误信息
    errors: {},
    editLoading: false,
    editLoadError: '',
    submitting: false,
    submitError: '',
    /* 动作结果面板(cy-result-sheet)。loading 不自愈,终态 2s 自收。
       duration=0 表示不自愈 —— 失败原因要留够读的时间。 */
    resultSheet: { show: false, kind: 'success', title: '', sub: '', why: '', duration: 2000 },
    canUndo: false, // 撤销栈是否非空(控制撤销按钮显隐/置灰)

    // 统计信息
    totalDuration: '0h,0min',
    totalNodes: 0,
    // 宾果九宫格(主题级,存进 complete_rule_json)
    bingoEnabled: false,
    // 九格按 S 形依次呈现:第一行左→右,第二行右→左,第三行左→右。
    // rows 是给 wxml 用的视图序,pos 指回真正的格位。
    bingoRows: advancedGameConfig.BINGO_S_ORDER.map((pos, i) => ({
      pos, seq: i + 1, hint: advancedGameConfig.BINGO_DEFAULT_LABELS[pos],
      label: '', couponId: 0, couponName: '', feedbackText: ''
    })),
    bingoError: '',

    // 统计信息
    chapterStats: [], // 每个章节的统计信息
    chapterDescExpanded: {}, // 步骤2：章节概述展开态 { '0': true }
    nodeStoryExpanded: {}, // 步骤2：节点剧情展开态 { '0-0': true }
    narrativeEditor: {
      show: false,
      chapterIndex: -1,
      nodeIndex: -1,
      chapterName: '',
      nodeName: '',
      description: '',
      hookText: '',
      cardHookLong: '',
      fragmentText: ''
    },
    scrollIntoView: '',
    // 滚轮的选中条与上下渐隐罩。picker-view 的 indicator-style/mask-style 只吃内联字符串,
    // 读不到 WXSS 变量 —— 这是本页必须留一份颜色字面量的地方,不是漏改(同 ROUTE_COLORS)。
    // 2026-08-11:原值是给深色弹窗配的(白 8% 选中条 + #2C2C2E 渐隐),日期面板改浅色后
    // 变成浅底上盖深块,滚轮整个读不出来。换成浅端同构值。
    slopesPickerIndicator: 'height: 80rpx; background: rgba(17,17,17,0.06);',
    // ⚠️ 渐隐必须【中间收到全透明】。原写法两端 .95 → 另一端 .35,两层叠加后连正中间
    // 都压着 ~.58 的罩 —— 连选中那一行都被冲淡(深色版同样有这个毛病,只是深底上看不出来)。
    slopesPickerMask: 'background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0) 35%), linear-gradient(0deg, rgba(255,255,255,0.95), rgba(255,255,255,0) 35%);',
    totalStats: { // 总统计信息
      totalDurationDisplay: '0min',
      totalDistance: '0km',
      totalNodes: 0,
      totalTemplates: 0
    },

    // —— 路线地图 Hero(Strava 化)——
    mapMarkers: [],        // 编号 marker(按章节分色)
    mapPolyline: [],       // 路线折线(每章一段)
    mapInclude: [MAP_DEFAULT_CENTER], // include-points 自动适配视野;空数组会让腾讯 SDK fitBounds 崩,兜底中心点
    mapCenter: MAP_DEFAULT_CENTER,
    mapScale: 12,
    hasRoute: false,       // 是否已有有效坐标节点(空态判断)
    selectedNodeLid: '',   // 列表↔地图双向高亮选中的节点 _localId
    rowHpx: 0,             // 节点卡片行高(px),movable-view y 用 px,onLoad 由 rpx 折算
    dragNodeLid: '',       // 当前被手柄按住进入拖拽的节点 _localId(门控,非空时其余行 disabled)
    dragNudge: 0,          // 松手后强制 movable-view 复位用的 1px 抖动(见 _resetDragOffsets)
    completeness: { percent: 0, missing: [] }, // 路线完整度评分
    _showCompletenessDetail: false, // 完整度 pill 是否展开缺失项
    inlineEdit: null,

    // 节点营业时间选择器数据
    timePicker: {
      show: false,
      startTime: {
        hour: 9,
        minute: 0
      },
      endTime: {
        hour: 18,
        minute: 0
      }
    },

    // 路线日期时间选择器数据
    startTimePicker: {
      show: false
    },
    startDateIndex: [0],
    startTimeIndex: [9, 0],

    endTimePicker: {
      show: false
    },
    endDateIndex: [0],
    endTimeIndex: [18, 0],

    // 时间选择相关
    dateList: [], // 日期列表（今天至30天内）
    hours: timeOptions.HOURS,     // '00'..'23'
    minutes: timeOptions.MINUTES, // '00'..'59'

    // 路线日期显示
    startDateTime: '开始时间',
    endDateTime: '结束时间',

    // 票种编辑器状态
    showTicketEditor: false,
    canSaveTicket: false,
    editingTicket: {
      editIndex: -1,
      name: '',
      price: 0,
      totalStock: 100,
      mode: 1,
      meetingPoint: '',
      meetingPointAddress: '',
      meetingPointLongitude: '',
      meetingPointLatitude: '',
      teamSize: 0,
      startTime: '',
      endTime: '',
      saleStartTime: '',
      saleEndTime: '',
      description: '',
      refundSupported: true,
      syncWithTheme: false
    },

    // 票种时间选择弹窗
    ticketTimePicker: {
      show: false,
      field: '',
      mode: 'date',
      title: '选择时间'
    },
    ticketDateIndex: [0],
    ticketTimeIndex: [9, 0],
  },

  goBack() {
    if (this.data.submitting) return;
    if (!this._draftAutosaveReady || this._persistDraftEnvelope()) {
      this._exitEditor();
      return;
    }
    modal.show({
      title: '草稿还没有保存',
      content: '本机存储空间可能不足，直接返回会丢失本次修改。',
      confirmText: '仍要返回',
      cancelText: '继续编辑',
      success: (res) => {
        if (res.confirm) this._exitEditor();
      }
    });
  },

  // 唯一离场口:根栈直链进入时 navigateBack 会 fail,落回模板库而不是卡死。
  _exitEditor() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/template/index' }) });
  },

  _draftIdentity() {
    if (this.data.editingTopicId) return { topicId: this.data.editingTopicId };
    if (this.data.draftUuid) return { draftUuid: this.data.draftUuid };
    return null;
  },

  _installDraftAutosave() {
    if (this._draftSetDataInstalled) return;
    this._draftSetDataInstalled = true;
    const nativeSetData = this.setData;
    this.setData = (patch, callback) => {
      nativeSetData.call(this, patch, () => {
        const finish = () => {
          if (this._draftAutosaveReady && this._isDraftPatch(patch)) {
            this._persistDraftEnvelope();
          }
          if (callback) callback();
        };
        const nodeLocationChanged = Object.keys(patch || {}).some((key) => {
          return key === 'nodesForm'
            || key === 'nodesForm.longitude'
            || key === 'nodesForm.latitude';
        });
        if (nodeLocationChanged) {
          // 2026-08-11:坐标文本(nodesFormCoordText)随「节点卡不显示经纬度」一起去掉。
          // ⚠️ 上一版这里写的是「ready 是"能不能发布"的判据」—— 那句是错的,已更正:
          // 发布校验走的是 proEditorPolicy.hasUsableCoords 现算(见 validateForm),
          // 根本不读这个 data 字段。随着 .node-location-ok 那行 UI 被删,
          // nodesFormLocationReady 目前【没有任何消费方】,只剩两条契约断言钉着
          // 「它和发布闸用同一个 hasUsableCoords」的口径。要么给它找回消费方、要么连
          // 断言一起清掉 —— 别再照着上面那句错注释以为它在拦发布。
          nativeSetData.call(this, {
            nodesFormLocationReady: proEditorPolicy.hasUsableCoords(this.data.nodesForm),
          }, finish);
        } else {
          finish();
        }
      });
    };
  },

  _isDraftPatch(patch) {
    return Object.keys(patch || {}).some((key) => {
      return key === 'formData' || key.indexOf('formData.') === 0
        || key === 'pendingMaterials'
        || key === 'selectedCategoryIds'
        || key === 'selectedCategoryNames'
        || key === 'startDateTime'
        || key === 'endDateTime';
    });
  },

  _persistDraftEnvelope() {
    const identity = this._draftIdentity();
    const memberId = this.data.draftMemberId || app.getUserID();
    if (!identity || !memberId) return false;
    try {
      proEditorDraft.saveDraft(wx, {
        memberId,
        topicId: identity.topicId,
        draftUuid: identity.draftUuid,
        baseRevision: this.data.baseRevision,
        formData: this.data.formData,
        pendingMaterials: this.data.pendingMaterials,
        editorMeta: {
          selectedCategoryIds: this.data.selectedCategoryIds || [],
          selectedCategoryNames: this.data.selectedCategoryNames || [],
          startDateTime: this.data.startDateTime,
          endDateTime: this.data.endDateTime,
        },
      });
      this._draftSaveWarned = false;
      return true;
    } catch (error) {
      if (!this._draftSaveWarned) {
        this._draftSaveWarned = true;
        cyToast('本地草稿保存失败，请检查存储空间');
      }
      return false;
    }
  },

  _applyDraftEnvelope(envelope) {
    if (!envelope) return;
    this._localDraftRestored = true;
    const formData = envelope.formData || Object.assign({}, this.data.formData, {
      chapters: envelope.chapters || [],
    });
    const pendingMaterials = envelope.pendingMaterials || [];
    const meta = envelope.editorMeta || {};
    const patch = {
      formData,
      pendingMaterials,
    };
    if (Array.isArray(meta.selectedCategoryIds)) patch.selectedCategoryIds = meta.selectedCategoryIds;
    if (Array.isArray(meta.selectedCategoryNames)) {
      patch.selectedCategoryNames = meta.selectedCategoryNames;
      patch.selectedCategoryNamesStr = meta.selectedCategoryNames.join('、');
    }
    if (meta.startDateTime) patch.startDateTime = meta.startDateTime;
    if (meta.endDateTime) patch.endDateTime = meta.endDateTime;
    cyToast(pendingMaterials.length
        ? ('已恢复上次未编排完的 ' + pendingMaterials.length + ' 个素材')
        : '已恢复上次本地草稿');
    this.setData(patch, () => {
      this._ensureLocalIds();
      this._materializeCityStoryChapters();
      this.updateAllStatistics();
    });
  },

  _newDraftUuid(options, memberId) {
    const explicit = options && options.draftUuid ? String(options.draftUuid) : '';
    if (explicit) return explicit;
    const forceNew = options && String(options.newDraft) === '1';
    const hasIncomingAiDraft = !!readAiDraft();
    if (!forceNew && !hasIncomingAiDraft && memberId) {
      const active = proEditorDraft.readActiveNewDraft(wx, memberId);
      if (active) return active;
    }
    return proEditorDraft.createDraftUuid();
  },

  _bootstrapNewLocalDraft(options) {
    const memberId = app.getUserID() || '';
    let draftUuid = this._newDraftUuid(options || {}, memberId);
    this.setData({ draftUuid, draftMemberId: memberId });
    if (!memberId) return false;
    const restored = proEditorDraft.loadDraft(wx, { draftUuid }, { memberId });
    if (restored.status === 'member_mismatch') {
      draftUuid = proEditorDraft.createDraftUuid();
      this.setData({ draftUuid });
      cyToast('草稿属于其他账号，已新建草稿');
      return false;
    }
    if (restored.status !== 'ready') return false;
    const restoredForm = restored.envelope.formData || {};
    const modeMismatch = !options.draftUuid && options.mode != null
      && Number(restoredForm.productType) !== (Number(options.mode) === 2 ? 2 : 1);
    const clubMismatch = options.clubId != null && String(options.clubId)
      && String(restoredForm.clubId || '') !== String(options.clubId);
    if (modeMismatch || clubMismatch) {
      draftUuid = proEditorDraft.createDraftUuid();
      this.setData({ draftUuid });
      return false;
    }
    this._applyDraftEnvelope(restored.envelope);
    return true;
  },

  _finishEditingDraftBootstrap(detail) {
    const topic = (detail && detail.topic) || {};
    const memberId = app.getUserID() || topic.memberId || '';
    const baseRevision = topic.updateTime || topic.createTime || '';
    this.setData({ baseRevision, draftMemberId: memberId });
    if (!memberId) {
      this._draftAutosaveReady = true;
      return;
    }
    const result = proEditorDraft.loadDraft(wx, { topicId: this.data.editingTopicId }, {
      memberId,
      currentBaseRevision: baseRevision,
    });
    const finish = () => { this._draftAutosaveReady = true; };
    if (result.status === 'ready') {
      this._applyDraftEnvelope(result.envelope);
      finish();
      return;
    }
    if (result.status === 'revision_conflict') {
      modal.show({
        title: '另一端草稿已更新',
        content: '其他设备上的草稿已更新，是否用本机草稿覆盖？',
        confirmText: '使用本地草稿',
        cancelText: '使用已保存版本',
        success: (res) => {
          if (res.confirm) this._applyDraftEnvelope(result.envelope);
          else proEditorDraft.removeDraft(wx, { topicId: this.data.editingTopicId }, { memberId });
          finish();
        },
      });
      return;
    }
    finish();
  },

  _clearDraftEnvelope() {
    const identity = this._draftIdentity();
    const memberId = this.data.draftMemberId || app.getUserID();
    if (!identity) return;
    try {
      proEditorDraft.removeDraft(wx, identity, { memberId });
    } catch (error) {}
  },

  clearLocalDraft() {
    modal.show({
      title: '清空本地草稿？',
      content: '当前未发布的章节和待编排素材都会从本机删除。',
      confirmText: '清空',
      success: (res) => {
        if (!res.confirm) return;
        this._draftAutosaveReady = false;
        this._clearDraftEnvelope();
        const mode = Number(this.data.formData.productType) === 2 ? 2 : 1;
        const club = this.data.formData.clubId ? ('&clubId=' + encodeURIComponent(this.data.formData.clubId)) : '';
        wx.redirectTo({ url: '/pages/publish/fabu/index?newDraft=1&mode=' + mode + club });
      },
    });
  },


  onTapAddChapter() {
    this._createChapterDirect();
  },

  // 2026-08-20 用户拍板:添加章节不再走黑色弹窗,直接以默认名「第N章」落一章;
  // 改名/剧情/删除仍走章节卡上的「编辑章节」。复用 confrimChapter 的追加事务
  // (含 undo、城市定向自动进全屏故事流)。可选 assignPendingLocalId:同时把该
  // 待编排素材归入新章(createChapterForPending 用)。
  _createChapterDirect(assignPendingLocalId) {
    const nextChapterNumber = (this.data.formData.chapters || []).length + 1;
    this.setData({
      popChapterAction: 0,
      assignPendingLocalId: assignPendingLocalId || '',
      'chapterForm.name': `第${nextChapterNumber}章`,
      'chapterForm.description': '',
      'chapterForm.imgArr': '',
      'chapterForm.nodes': [],
      'chapterForm.calculatedDistance': 0,
      'chapterForm.category': '',
      'chapterForm.categoryId': null,
      'chapterForm.recruitEnabled': 0,
      'chapterForm.termsMode': 'PERK',
      'chapterForm.perkMinValue': null,
      'chapterForm.maxMerchant': 0,
      'chapterForm.atmospherePreset': 'DEFAULT',
      'chapterForm.audioUrl': '',
      'chapterForm.audioDuration': 0,
      'chapterForm.audioFileName': ''
    });
    this.confrimChapter();
  },

  _materializeCityStoryChapters() {
    if (Number(this.data.formData && this.data.formData.productType) !== 1) return;
    const chapters = JSON.parse(JSON.stringify((this.data.formData && this.data.formData.chapters) || []));
    chapters.forEach((chapter, index) => {
      try {
        chapters[index] = proEditorStory.materializeChapter(chapter, () => this._genLocalId());
      } catch (error) {
        // 单章坏数据不崩整页(onLoad / 草稿恢复 / 编辑回填三条路都走这):保留原章节,
        // 打开该章时 openStoryEditor 会再次拦截并 toast。
      }
    });
    this.setData({ 'formData.chapters': chapters });
  },

  _storyCommand(command, uiPatch) {
    const chapterIndex = Number(this.data.storyEditor.chapterIndex);
    const chapters = JSON.parse(JSON.stringify((this.data.formData && this.data.formData.chapters) || []));
    const chapter = chapters[chapterIndex];
    if (!chapter) throw new Error('未找到故事流章节');
    const result = proEditorStory.applyStoryCommand({
      chapter,
      pendingMaterials: this.data.pendingMaterials || [],
    }, command);
    chapters[chapterIndex] = result.draft.chapter;
    this.setData(Object.assign({
      'formData.chapters': chapters,
      pendingMaterials: result.draft.pendingMaterials,
    }, uiPatch || {}));
    this.updateAllStatistics();
    return result;
  },

  openStoryEditor(e) {
    this.destroyPreviewAudio(); // 换一章/重开编辑器:先停掉上一章里正在播的音频块
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const chapterIndex = Number(ds.index == null ? ds.chapterindex : ds.index);
    const chapters = JSON.parse(JSON.stringify((this.data.formData && this.data.formData.chapters) || []));
    if (!chapters[chapterIndex]) return;
    try {
      chapters[chapterIndex] = proEditorStory.materializeChapter(
        chapters[chapterIndex], () => this._genLocalId());
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '故事流内容不完整，请检查后重试'));
      return;
    }
    this._storyTextCursor = null;
    this.setData({
      'formData.chapters': chapters,
      storyEditor: { show: true, chapterIndex, insertMenuAt: -1, focusBlockKey: '', selectedBlockKey: '' },
      storyVarSheet: { show: false, blockKey: '', keys: [] },
      pendingInsertAt: null,
      // ⚠️ 这里**不**探时长。探时长要 wx.createInnerAudioContext,而动作台账是按调用图
      //    判 actionClass 的 —— 一挂上来,openStoryEditor 连同 onTapAddChapter /
      //    confrimChapter / onMarkerTap 等 9 个控件会一起被判成 external(实测),
      //    "真实点击 vs 外部能力"的分母就废了。存量块只显示从地址派生的文件名;
      //    时长在**上传当下**探(见 insertStoryAudioAt),那条路本来就是 external。
    }, () => this._reflowStoryTextareas(chapterIndex));
  },

  /**
   * 逼 <textarea auto-height> 重算一次高度。
   *
   * ⚠️ 这不是装饰:auto-height 的**首次渲染**用的是 textarea 组件自身的默认高,不是内容高。
   *    实测(2026-09-06)一行文字首帧量到 136px,第二次渲染才收敛到 56px ——
   *    表现就是「打开一个已有文字的章节,每段文字下面空一大截」。
   *    CSS 够不着(height:auto / min-height 都试过,无效),只能再渲染一次。
   *    这里把同一份 blocks 原样写回去:不新增任何 data 字段(那会变成零消费债务),
   *    只借 setData 触发一帧。
   */
  _reflowStoryTextareas(chapterIndex) {
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    if (!chapter || !(chapter.blocks || []).some((b) => b && b.type === 'text')) return;
    wx.nextTick(() => {
      this.setData({ [`formData.chapters[${chapterIndex}].blocks`]: chapter.blocks });
    });
  },

  closeStoryEditor() {
    const current = (this.data.formData.chapters || [])[this.data.storyEditor.chapterIndex];
    if ((current && current.blocks || []).some(b => b.type === 'dream' && b.title != null && !b.images.length)) {
      cyToast('相册至少添加 1 张照片');
      return;
    }
    this.destroyPreviewAudio(); // 关编辑器停掉故事流预听,不留一段在后台继续响
    this._storyTextCursor = null;
    // 梦块卡上写着「一张都没有的梦不会保存,先加一张」,收编辑器就得真在本地草稿里丢掉 ——
    // 只在出 payload 那层过滤的话,回到章节卡再重进,那张 0/6 的空卡还在原地(CU-M-115)。
    const chapterIndex = Number(this.data.storyEditor.chapterIndex);
    const chapters = (this.data.formData && this.data.formData.chapters) || [];
    const discarded = chapterIndex >= 0 && proEditorStory.countEmptyDreamBlocks(chapters[chapterIndex]) > 0;
    if (discarded) {
      const next = JSON.parse(JSON.stringify(chapters));
      next[chapterIndex] = proEditorStory.discardEmptyDreamBlocks(next[chapterIndex]);
      this.setData({ 'formData.chapters': next });
      this.updateAllStatistics();
    }
    this.setData({
      storyEditor: { show: false, chapterIndex: -1, insertMenuAt: -1, focusBlockKey: '', selectedBlockKey: '' },
      storyVarSheet: { show: false, blockKey: '', keys: [] },
      pendingInsertAt: null,
      storyPendingMaterialLocalId: '',
    });
  },

  // 物理返回守卫(见 wxml 尾部 page-container):按层级关最上层浮层,而不是退出编辑器
  onNativeBackGuard() {
    if (this.data.routeMappingShow) {
      this.closeNodeRouteMapping();
    } else if (this.data.popChapterNodes) {
      // 节点抽屉:玩法选择视图先退回详情,详情视图才关抽屉
      if (this.data.nodeSheetView === 'games') this.backToNodeDetail();
      else this.cancelPopChapter();
    } else if (this.data.publishCheck && this.data.publishCheck.show) {
      this.closePublishCheck();
    } else if (this.data.popChapter) {
      this.cancelChapter();
    } else if (this.data.modePickerShow) {
      this.closeModePicker();
    } else if (this.data.topicDetailShow) {
      this.closeTopicDetail();
    } else if (this.data.storyVarSheet && this.data.storyVarSheet.show) {
      // 变量列表是故事流里叠的一层,返回键先收它再收故事流
      this.closeStoryVarSheet();
    } else if (this.data.storyEditor && this.data.storyEditor.show) {
      this.closeStoryEditor();
    }
    // 关掉一层后若还有受护浮层(浮层叠浮层),翻转一次让 page-container 重新挂上
    const stillGuarded = this.data.routeMappingShow || this.data.popChapterNodes || this.data.popChapter
      || (this.data.publishCheck && this.data.publishCheck.show)
      || (this.data.storyEditor && this.data.storyEditor.show)
      || this.data.modePickerShow || this.data.topicDetailShow;
    if (stillGuarded) {
      this.setData({ backGuardOff: true });
      setTimeout(() => this.setData({ backGuardOff: false }), 50);
    }
  },

  onStoryChapterNameInput(e) {
    const chapterIndex = Number(this.data.storyEditor.chapterIndex);
    if (chapterIndex < 0) return;
    this.setData({ ['formData.chapters[' + chapterIndex + '].name']: e.detail.value });
  },

  toggleStoryInsertMenu(e) {
    const index = Number(e.currentTarget.dataset.index);
    const current = Number(this.data.storyEditor.insertMenuAt);
    this.setData({ 'storyEditor.insertMenuAt': current === index ? -1 : index });
  },

  insertStoryTextAt(e) {
    const index = Number(e.currentTarget.dataset.index);
    const blockKey = this._genLocalId();
    try {
      this._storyCommand({ type: 'insertTextAt', index, blockKey }, {
        'storyEditor.insertMenuAt': -1,
        'storyEditor.focusBlockKey': blockKey,
      });
      // 新建的 textarea 首帧同样是默认高,补一次渲染(见 _reflowStoryTextareas)
      this._reflowStoryTextareas(this.data.storyEditor.chapterIndex);
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '添加文字失败'));
    }
  },

  insertStoryNodeAt(e) {
    const index = Number(e.currentTarget.dataset.index);
    const chapterIndex = Number(this.data.storyEditor.chapterIndex);
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    if (!chapter) return;
    const issue = proEditorPolicy.formalNodeCreationIssue(this.data.formData, chapterIndex);
    if (issue) {
      cyToast('请先添加并填写故事文字');
      return;
    }
    const pendingLocalId = this.data.storyPendingMaterialLocalId;
    const material = (this.data.pendingMaterials || []).find(item => item._localId === pendingLocalId);
    this.setData({
      pendingInsertAt: index,
      'storyEditor.insertMenuAt': -1,
      popChapterNodes: true,
      popChapterNodesAction: 0,
      nodeSheetView: 'detail',
      nodeDraftDestination: 'formal',
      editingPendingLocalId: material ? material._localId : '',
      editTargetChapterLid: chapter._localId,
      editTargetNodeLid: '',
      inlineEdit: null,
      nodesForm: material ? proEditorMaterials.nodeFromMaterial(material, 1) : this._emptyNodesForm(),
    });
  },

  // 图片 / 音频块走与节点实拍同一条上传通道(app.chooseImage / app.chooseDocument)。
  // ⚠️ 先上传、拿到 url 再落块 —— 反过来先插一个空壳块再回填,上传失败时会留下一个
  // 既点不开也说不清的空块,而这块已经算进「每章 200 块」的额度里了。
  insertStoryImageAt(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ 'storyEditor.insertMenuAt': -1 });
    app.chooseImage((res) => {
      const url = res && res[0];
      if (!url) return;
      this._insertStoryMedia('image', index, { url });
    }, 1);
  },

  // 故事流里的音频块(2026-09-06 用户裁决恢复,与章节级背景旁白并存):
  // 章节那段是整章底噪、进本章自动播;这一段有位置,读到这儿才响。
  // ⚠️ 收 mp3 系列,不收 mp4 —— 用户 9-06 明确说的是 mp3;mp4 是视频容器,
  //    玩家端用的是 InnerAudioContext,喂视频容器不保证能解。
  // 稿(TE · Screens P8)的流程是两步:先落一个空音频块,再点那个块去选文件。
  // 不在这里直接拉起选择器 —— 那样中途取消就什么都不剩,人不知道自己刚才点没点中。
  insertStoryAudioAt(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ 'storyEditor.insertMenuAt': -1 });
    try {
      this._insertStoryMedia('audio', index, { url: '' });
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '添加音频块失败'));
    }
  },

  // 点空音频块 → 选文件 → 回填到这个块上。文件名当场就有;
  // 时长要等播放器能播才知道,所以先回填 url、再异步补(见 _fillStoryAudioMeta)。
  uploadStoryAudio(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    app.chooseDocument((res) => {
      const file = res && res[0];
      if (!file || !file.url) return;
      try {
        this._storyCommand({
          type: 'fillMedia',
          blockKey,
          url: file.url,
          name: file.filename || proEditorStory.fileNameOf(file.url),
        });
        this._fillStoryAudioMeta();
      } catch (error) {
        cyToast(app.getRequestErrorMessage(error, '音频保存失败'));
      }
    }, 1, ['mp3', 'm4a', 'aac']);
  },

  /**
   * 给故事流里还不知道时长的音频块补上时长。
   *
   * ⚠️ 只在**上传当下**调(insertStoryAudioAt)。时长没法从 url 派生,只能让播放器去读,
   *    而 createInnerAudioContext 会把调用方在动作台账里判成 external —— 挂到
   *    openStoryEditor 上会连累 9 个无关控件(实测),所以重开章节时那些块只显示文件名。
   *    这里对「有 url、没 _duration」的块各起一个一次性的 InnerAudioContext,
   *    onCanplay 拿到 duration 就写回并 destroy。
   * ⚠️ _duration 是本地字段(下划线开头):stripLocalFields 会剥掉,
   *    toPayloadChapter 也只重建 {type,url},所以它进不了 payload,不影响后端块形状。
   */
  _fillStoryAudioMeta() {
    const chapterIndex = this.data.storyEditor.chapterIndex;
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    if (!chapter) return;
    (chapter.blocks || []).forEach((block, blockIndex) => {
      if (!block || block.type !== 'audio' || !block.url || block._duration) return;
      const probe = wx.createInnerAudioContext();
      probe.src = block.url;
      probe.obeyMuteSwitch = false;
      const done = () => { try { probe.destroy(); } catch (err) {} };
      probe.onCanplay(() => {
        const seconds = Math.round(probe.duration || 0);
        if (seconds > 0) {
          this.setData({
            [`formData.chapters[${chapterIndex}].blocks[${blockIndex}]._duration`]: seconds,
          });
        }
        done();
      });
      probe.onError(done);
    });
  },

  _insertStoryMedia(mediaType, index, payload) {
    const blockKey = this._genLocalId();
    try {
      this._storyCommand(Object.assign({
        type: 'insertMediaAt', mediaType, index, blockKey,
      }, payload), {
        'storyEditor.insertMenuAt': -1,
        'storyEditor.selectedBlockKey': '',
      });
      return true;
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '添加失败'));
      return false;
    }
  },

  // 故事中的玩法选择：相册物化为展示块，其余模板继续走节点配置。
  insertStoryGameAt(e) {
    const index = Number(e.currentTarget.dataset.index);
    const chapter = (this.data.formData.chapters || [])[this.data.storyEditor.chapterIndex];
    if (!chapter) return;
    this.setData({
      popChapterNodesAction: 0, editTargetChapterLid: chapter._localId, editTargetNodeLid: '',
      nodeDraftDestination: 'formal', editingPendingLocalId: '', inlineEdit: null,
      nodesForm: this._emptyNodesForm(),
      pendingInsertAt: index, 'storyEditor.insertMenuAt': -1,
      popChapterNodes: true, nodeSheetView: 'games',
      selectedTempId: null, selectedTempInfo: null,
    });
    this.getTempList('');
  },
  _insertAlbumTemplate(template) {
    const parsed = advancedGameConfig.parse(template.advancedConfigJson);
    if (parsed.error) { cyToast(parsed.error); return true; }
    if (!parsed.value.album || !parsed.value.album.enabled) return false;
    const error = advancedGameConfig.validate(parsed.value);
    if (error) { cyToast(error); return true; }
    if (!this.data.storyEditor.show || this.data.pendingInsertAt == null) {
      cyToast('请在故事流中添加相册');
      return true;
    }
    const inserted = this._insertStoryMedia('dream', this.data.pendingInsertAt, {
      title: template.title || '相册', images: parsed.value.album.images,
    });
    if (inserted) this.setData({ popChapterNodes: false, pendingInsertAt: null, selectedTempId: null, selectedTempInfo: null });
    return true;
  },
  onAlbumTitleInput(e) {
    try { this._storyCommand({ type: 'updateAlbumTitle', blockKey: e.currentTarget.dataset.blockkey, title: e.detail.value }); }
    catch (error) { cyToast(app.getRequestErrorMessage(error, '修改相册名称失败')); }
  },


  // 加一张:先选图拿到 url 再进块(与 insertStoryImageAt 同一条规矩,不留空壳)。
  addStoryDreamImage(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    app.chooseImage((res) => {
      const url = res && res[0];
      if (!url) return;
      try {
        this._storyCommand({ type: 'appendDreamImage', blockKey, url });
      } catch (error) {
        cyToast(app.getRequestErrorMessage(error, '添加失败'));
      }
    }, 1);
  },

  onStoryDreamLineInput(e) {
    try {
      this._storyCommand({
        type: 'updateDreamLine',
        blockKey: e.currentTarget.dataset.blockkey,
        index: Number(e.currentTarget.dataset.index),
        line: e.detail.value,
      });
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '保存失败'));
    }
  },

  removeStoryDreamImage(e) {
    try {
      this._storyCommand({
        type: 'removeDreamImage',
        blockKey: e.currentTarget.dataset.blockkey,
        index: Number(e.currentTarget.dataset.index),
      });
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '删除失败'));
    }
  },

  // 媒体块没有「内容为空自己消失」这条路(它要么有 url 要么不存在),所以 ✕ 是唯一删除入口。
  // 与文字块一致:长按选中后才出现 ✕。
  removeStoryMedia(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    // 删掉的正好是当前这一块时,先把播放器停掉再删,免得删完还在响。
    // ⚠️ 按 _previewSource(建播放器时就登记)判断,不能按 data.storyAudioKey ——
    //    后者要等 onPlay,网络缓冲期删块会匹配不到,destroy 不掉,缓冲完照样响(F14 P2)。
    const source = this._previewSource;
    if (blockKey && source && source.kind === 'story' && source.key === blockKey) this.destroyPreviewAudio();
    try {
      this._storyCommand({ type: 'removeMedia', blockKey }, { 'storyEditor.selectedBlockKey': '' });
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '删除失败'));
    }
  },

  onStoryTextInput(e) {
    /* 光标只服务「插入变量」,记在实例上不进 data —— 每敲一个字都 setData 一次
       光标位置只为偶尔一次的插入,不值。 */
    const cursor = Number(e.detail && e.detail.cursor);
    this._storyTextCursor = {
      blockKey: e.currentTarget.dataset.blockkey,
      index: Number.isInteger(cursor) ? cursor : -1,
    };
    try {
      this._storyCommand({
        type: 'editText',
        blockKey: e.currentTarget.dataset.blockkey,
        content: e.detail.value,
      });
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '文字保存失败'));
    }
  },

  /**
   * 打开「插入变量」列表(契约 §3.1)。可用键跟着主题里各节点的玩法模板走
   * (建档的问题 key + 会产出结果的玩法),所以每次打开现算 —— 存快照迟早对不上。
   */
  openStoryVarSheet(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    const chapterIndex = Number(this.data.storyEditor.chapterIndex);
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    const block = chapter && (chapter.blocks || []).find((item) => item && item.key === blockKey);
    /* 点这颗键会让 textarea 失焦;空文字块在失焦时是按既有语义**被删掉**的
       (见 onStoryTextBlur),所以到这儿可能已经没有可插的块了 —— 提示而不是开一张空列表。 */
    if (!block || block.type !== 'text') {
      cyToast('先写几个字，再把变量插到光标处');
      return;
    }
    const keys = proEditorStory.collectStoryVars(this.data.formData.chapters || []);
    // 先收起插入缝,免得两个浮层叠在一起
    this.setData({
      'storyEditor.insertMenuAt': -1,
      storyVarSheet: { show: true, blockKey: blockKey, keys: keys },
    });
  },

  closeStoryVarSheet() {
    this.setData({ storyVarSheet: { show: false, blockKey: '', keys: [] } });
  },

  /**
   * 点一下变量 → 插到光标处(没记到光标就追加到末尾)。
   * ⚠️ 插入后把光标移到 token 后面这件事小程序 textarea 做不到可靠定位
   * (selection-start 要基础库 2.33+ ,且 auto-height 下二次渲染会错位),
   * 所以只保证「插进去了」,连点两次会接在上一段后面(见 _storyTextCursor 的推进)。
   */
  insertStoryVar(e) {
    const sheet = this.data.storyVarSheet;
    const key = e.currentTarget.dataset.key;
    if (!sheet.show || !sheet.blockKey || !key) return;
    const chapterIndex = Number(this.data.storyEditor.chapterIndex);
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    const block = chapter && (chapter.blocks || []).find((item) => item && item.key === sheet.blockKey);
    if (!block || block.type !== 'text') { this.closeStoryVarSheet(); return; }
    const content = String(block.content == null ? '' : block.content);
    const cursor = this._storyTextCursor && this._storyTextCursor.blockKey === sheet.blockKey
      ? this._storyTextCursor.index : -1;
    const at = proEditorStory.varInsertIndex(content, cursor);
    try {
      this._storyCommand({
        type: 'editText',
        blockKey: sheet.blockKey,
        content: proEditorStory.insertVarAt(content, key, cursor),
      }, { 'storyVarSheet.show': false });
      this._storyTextCursor = { blockKey: sheet.blockKey, index: at + String(key).length + 2 };
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '插入变量失败'));
    }
  },

  // 文字块删除:2026-08-10 用户定「直接手动键盘删除就行」,所以页面上不再挂红色
  // 「删除文字块」按钮 —— 一个块的内容全删光,它本身就该消失,再让人点一次按钮 +
  // 确认一次弹窗是三步做一件事。
  // ⚠️ 判空必须在 blur 而不是 input:input 里一路退格,退到最后一个字时块当场被移除,
  // 光标连同 textarea 一起消失,人还在按退格 —— 相当于输入中途把编辑器抽走。
  // ⚠️ 也不弹二次确认:内容已经是空的,没有什么可丢的。
  // 选中态:✕ 只在选中的块上出现(用户 2026-08-10 定「选中的时候再出现」)。
  // 触屏没有 hover,所以映射成两种最不抢主路径的手势:
  //   文字块 = 聚焦即选中(正在写的那块就是当前块);
  //   节点块 = 长按选中(单击仍然是"打开节点弹窗",那是主路径,不能被选中抢走)。
  selectStoryBlock(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    if (this.data.storyEditor.selectedBlockKey === blockKey) return;
    this.setData({ 'storyEditor.selectedBlockKey': blockKey });
  },

  // ✕ 删文字块。内容为空时 blur 会自己删掉(见 onStoryTextBlur),这里管的是
  // 「写了字但整段不要了」—— 有内容才值得二次确认。
  removeStoryText(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    modal.show({
      title: '删除这段文字？',
      content: '前后的文字块会保持原样，不会自动合并。',
      success: (res) => {
        if (!res.confirm) return;
        try {
          this._storyCommand({ type: 'removeText', blockKey }, { 'storyEditor.selectedBlockKey': '' });
        } catch (error) {
          cyToast(app.getRequestErrorMessage(error, '删除失败'));
        }
      },
    });
  },

  onStoryTextBlur(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    const blocks = ((this.data.formData.chapters[this.data.storyEditor.chapterIndex] || {}).blocks) || [];
    const block = blocks.filter((b) => b && b.key === blockKey)[0];
    if (!block || block.type !== 'text') return;
    if (String(block.content == null ? '' : block.content).trim() !== '') {
      if (this.data.storyEditor.selectedBlockKey === blockKey) {
        this.setData({ 'storyEditor.selectedBlockKey': '' });
      }
      return;
    }
    try {
      this._storyCommand({ type: 'removeText', blockKey }, { 'storyEditor.selectedBlockKey': '' });
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '删除失败'));
    }
  },

  editStoryNode(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    const chapterIndex = Number(this.data.storyEditor.chapterIndex);
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    const block = chapter && (chapter.blocks || []).find(item => item.key === blockKey);
    const nodeIndex = chapter && (chapter.nodes || []).findIndex(item => item._localId === (block && block.nodeKey));
    if (!chapter || !block || nodeIndex < 0) return;
    this.showEditNodes({ currentTarget: { dataset: { chapterindex: chapterIndex, nodeindex: nodeIndex } } });
  },

  removeStoryNode(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    modal.show({
      title: '确认删除节点',
      content: '删除后 5 秒内可以撤销，过后不可恢复。',
      success: (res) => {
        if (res.confirm) this._removeStoryNodeNow(blockKey);
      },
    });
  },

  _appendPendingRemoval(removal) {
    const current = this._pendingUndoSnapshot;
    let removals = [];
    if (current && Array.isArray(current.removals)) {
      removals = current.removals.slice();
    } else if (current && Array.isArray(current.storyRemovals)) {
      removals = current.storyRemovals.map((item) => Object.assign({ kind: 'story' }, item));
    } else if (current && current.block && current.node) {
      removals = [Object.assign({ kind: 'story' }, current)];
    } else if (current && current.material) {
      removals = [Object.assign({ kind: 'material' }, current)];
    }
    this._pendingUndoSnapshot = {
      removals: removals.concat([removal]),
      route: removals.length && current.route ? current.route : {
        mode: this.data.formData.routeMode,
        json: this.data.formData.routeGraphJson,
        graph: JSON.parse(JSON.stringify(this._routeGraph)),
      },
    };
  },

  _removeStoryNodeNow(blockKey) {
    const previousRouteNodes = this._routeNodes();
    try {
      const result = this._storyCommand({ type: 'removeNode', blockKey }, {
        popChapterNodes: false,
        popChapterNodesAction: 0,
        'storyEditor.selectedBlockKey': '',
        pendingUndo: { show: true, materialLocalId: '', text: '节点已删除' },
      });
      const removed = result.removed;
      // ⚠️ 2026-08-11:removeNode 改真删后,removed 里【不再有 material】(不留影子副本)。
      // 这里原先还在读 removed.material._localId —— 上一轮改命令时漏改的调用方,
      // 结果是:_storyCommand 已经把节点删掉并落盘,下一行才抛 TypeError,被本函数外层
      // 那个 try 吞成一句英文报错 toast,而后面的 setTimeout 根本没跑 ⇒
      // 「节点已经删了、提示却说出错、撤销条永远挂在屏幕上」。
      // 撤销认的是 node._localId,materialLocalId 只是提示条上的标识,同源即可。
      const removalSnapshot = {
        chapterLid: result.draft.chapter._localId,
        blockIndex: removed.blockIndex,
        block: removed.block,
        node: removed.node,
      };
      this._appendPendingRemoval(Object.assign({ kind: 'story' }, removalSnapshot));
      this._realignStoryRouteGraph(previousRouteNodes);
      this._pruneRouteGraphToCurrentNodes();
      this._commitNodeRouteEdit();
      this.setData({ 'pendingUndo.materialLocalId': removed.node._localId });
      if (this._pendingUndoTimer) clearTimeout(this._pendingUndoTimer);
      this._pendingUndoTimer = setTimeout(() => {
        this._pendingUndoTimer = null;
        this._pendingUndoSnapshot = null;
        this.setData({ pendingUndo: { show: false, materialLocalId: '', text: '' } });
      }, 5000);
      if (this._pendingUndoTimer && typeof this._pendingUndoTimer.unref === 'function') {
        this._pendingUndoTimer.unref();
      }
      cyToast('节点已删除');
    } catch (error) {
      cyToast(app.getRequestErrorMessage(error, '删除失败'));
    }
  },

  _createEmptyNode(sortId) {
    return {
      _localId: this._genLocalId(),
      name: '',
      subtitle: '',
      description: '',
      address: '',
      longitude: '',
      latitude: '',
      imgUrl: '',
      nodeTime: 30,
      showTemplate: false,
      templateId: 0,
      templateInfo: {},
      templateName: '',
      businessTime: '',
      sortID: sortId || 1,
      // 自由定向(mode2)选填叙事文案:留空后端回退用 description
      hookText: '',
      cardHookLong: '',
      fragmentText: ''
    };
  },

  addChapterDirect() {
    // 兼容旧调用名，但创建必须走弹窗事务：取消时不留下空章节/空节点。
    this.onTapAddChapter();
  },

  isBlankCreationCanvas() {
    const chapters = (this.data.formData && this.data.formData.chapters) || [];
    return chapters.length === 0 && !(this.data.pendingMaterials || []).length;
  },

  onTapPrimaryStarter() {
    const policy = proEditorPolicy.evaluateProfessionalDraft({
      formData: this.data.formData,
      clubId: this.data.formData && this.data.formData.clubId,
      pendingMaterials: this.data.pendingMaterials,
      categoryIds: this.data.selectedCategoryIds,
    });
    const action = this.data.starterAction || policy.starterAction;
    if (!action) return;
    // 2026-09-05 用户裁决:三条起点收敛成同一颗「创建章节」——
    // 原来的三个起手动作(写第一章 / 添加第一个地点 / 添加第一个探索节点)落点其实是同一个:
    // 都要先有章节。三句话只是把同一件事说了三遍,反而让人以为选错起点就走不通。
    //
    // ⚠️ 只统一「按钮文案与第一步」,后面那一步照旧按模式分 —— 建完章节把人带到能干活的地方:
    //   城市定向:confrimChapter 内部会打开故事流(cityStoryFlow 分支),这里不用再管;
    //   自由探索:没有故事流,沿用 2026-08-20 的拍板,直接把节点弹窗开在第 1 章上,
    //            否则建完章节人停在一张空章节卡前,不知道下一步点哪。
    // startClubPlaceCapture 没删:待编排区的「继续录入地点」还在用它。
    const hadChapters = (this.data.formData.chapters || []).length > 0;
    this._createChapterDirect();
    if (Number(this.data.formData.productType) !== 1 && !hadChapters) {
      this.showAddNode({ currentTarget: { dataset: { chapterIndex: 0 } } });
    }
  },

  _emptyNodesForm() {
    return {
      name: '', subtitle: '', description: '', address: '', longitude: '', latitude: '',
      imgUrl: '', nodeTime: 30, showTemplate: false, templateId: 0, templateInfo: {},
      templateName: '', businessTime: '', sortID: 1, hookText: '', cardHookLong: '',
      fragmentText: '',
    };
  },

  openPendingNodeDraft() {
    this.setData({
      popChapterNodes: true,
      popChapterNodesAction: 0,
      nodeSheetView: 'detail',
      nodeDraftDestination: 'pending',
      editingPendingLocalId: '',
      editTargetChapterLid: '',
      editTargetNodeLid: '',
      inlineEdit: null,
      nodesForm: this._emptyNodesForm(),
    });
  },

  onNodeNameInput(e) {
    this.setData({ 'nodesForm.name': e.detail.value });
  },

  editPendingMaterial(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const localId = ds.localid || ds.localId;
    const material = (this.data.pendingMaterials || []).find(item => item._localId === localId);
    if (!material) {
      cyToast('未找到待编排素材');
      return;
    }
    this.setData({
      popChapterNodes: true,
      popChapterNodesAction: 0,
      nodeSheetView: 'detail',
      nodeDraftDestination: 'pending',
      editingPendingLocalId: localId,
      editTargetChapterLid: '',
      editTargetNodeLid: '',
      inlineEdit: null,
      nodesForm: proEditorMaterials.nodeFromMaterial(material, 1),
    });
  },

  _savePendingMaterial(material, message) {
    const pending = (this.data.pendingMaterials || []).slice();
    const index = pending.findIndex(item => item._localId === material._localId);
    if (index >= 0) pending[index] = material;
    else pending.push(material);
    this.setData({
      pendingMaterials: pending,
      popChapterNodes: false,
      popChapterNodesAction: 0,
      nodeSheetView: 'detail',
      editingPendingLocalId: '',
      nodeDraftDestination: 'formal',
      nodesForm: this._emptyNodesForm(),
    });
    this.updateAllStatistics();
    if (message) cyToast(message);
  },

  removePendingMaterial(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const localId = ds.localid || ds.localId;
    const material = (this.data.pendingMaterials || []).find(item => item._localId === localId);
    if (!material) return;
    modal.show({
      title: '删除这个素材？',
      content: '素材尚未进入正式章节，删除后无法恢复。',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({
          pendingMaterials: (this.data.pendingMaterials || []).filter(item => item._localId !== localId),
        });
        this.updateAllStatistics();
      },
    });
  },

  _canAddFormalNodes(additionalCount) {
    const count = Math.max(1, Number(additionalCount) || 1);
    if (!roleGuard.hasSnapshot()) {
      cyToast('权限加载中，请稍候重试');
      return false;
    }
    const maxNodes = roleGuard.quota('maxNodesPerTheme');
    if (maxNodes == null) return true;
    let total = 0;
    (this.data.formData.chapters || []).forEach((chapter) => { total += (chapter.nodes || []).length; });
    if (total + count <= maxNodes) return true;
    modal.show({
      title: '节点已达上限',
      content: '当前身份单条路线最多 ' + maxNodes + ' 个节点。升级为俱乐部可解锁不限节点与分支玩法。',
      showCancel: false,
    });
    return false;
  },

  arrangePendingIntoChapter(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const localId = ds.localid || ds.localId;
    const chapterIndex = Number(e && e.detail && e.detail.value);
    const pending = (this.data.pendingMaterials || []).slice();
    const materialIndex = pending.findIndex(item => item._localId === localId);
    const chapters = JSON.parse(JSON.stringify((this.data.formData && this.data.formData.chapters) || []));
    const material = pending[materialIndex];
    const chapter = chapters[chapterIndex];
    if (!material || !chapter) {
      cyToast('未找到素材或章节');
      return;
    }
    if (!proEditorPolicy.hasUsableCoords(material)) {
      cyToast('请先补齐有效地点坐标');
      this.editPendingMaterial({ currentTarget: { dataset: { localid: localId } } });
      return;
    }
    if (Number(this.data.formData.productType) === 1) {
      this.setData({ storyPendingMaterialLocalId: localId });
      this.openStoryEditor({ currentTarget: { dataset: { index: chapterIndex } } });
      cyToast(proEditorPolicy.hasRealStory(chapter)
          ? '请点击目标缝插入节点' : '请先添加文字，再点击目标缝插入节点');
      return;
    }
    const issue = proEditorMaterials.arrangementIssue({
      productType: this.data.formData.productType,
      chapter,
      material,
    });
    if (issue) {
      cyToast(issue.message);
      if (issue.field === 'chapterStory') {
        this.showEditChapter({ currentTarget: { dataset: { index: chapterIndex } } });
      } else {
        this.editPendingMaterial({ currentTarget: { dataset: { localid: localId } } });
      }
      return;
    }
    if (!this._canAddFormalNodes(1)) return;
    chapter.nodes = chapter.nodes || [];
    chapter.nodes.push(proEditorMaterials.nodeFromMaterial(material, chapter.nodes.length + 1));
    pending.splice(materialIndex, 1);
    this._pushUndo();
    this.setData({ 'formData.chapters': chapters, pendingMaterials: pending });
    this.updateAllStatistics();
    cyToast.success('已放入' + (chapter.name || '章节'));
  },

  createChapterForPending(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const localId = ds.localid || ds.localId;
    const material = (this.data.pendingMaterials || []).find(item => item._localId === localId);
    if (!material) return;
    if (!proEditorPolicy.hasUsableCoords(material)) {
      cyToast('请先补齐有效地点坐标');
      this.editPendingMaterial({ currentTarget: { dataset: { localid: localId } } });
      return;
    }
    // 2026-08-20:归章同样不弹窗,直接落「第N章」并把素材归入
    this._createChapterDirect(localId);
  },

  _scheduleClubPoiContinuation(callback) {
    setTimeout(callback, 80);
  },

  startClubPlaceCapture() {
    if (this.data.clubPlaceCaptureActive) return;
    this.setData({ clubPlaceCaptureActive: true });
    this._pickNextClubPlace();
  },

  _pickNextClubPlace() {
    if (!this.data.clubPlaceCaptureActive) return;
    pickLocation({
      onPick: (poi) => {
        const node = this._emptyNodesForm();
        node._localId = this._genLocalId();
        node.name = poi.name || '';
        node.address = poi.address || poi.name || '';
        node.longitude = poi.longitude;
        node.latitude = poi.latitude;
        const material = proEditorMaterials.materialFromNode(node, 'place');
        const pending = (this.data.pendingMaterials || []).concat([material]);
        this.setData({ pendingMaterials: pending });
        this.updateAllStatistics();
        cyToast('已录入地点，可继续添加');
        this._scheduleClubPoiContinuation(() => this._pickNextClubPlace());
      },
      onCancel: () => this.setData({ clubPlaceCaptureActive: false }),
      onFail: (error) => {
        if (error && (error.code === 'POI_COORDS_MISSING' || error.code === 'POI_CITY_ONLY')) {
          this._scheduleClubPoiContinuation(() => this._pickNextClubPlace());
        } else {
          this.setData({ clubPlaceCaptureActive: false });
        }
      },
    });
  },

  _prepareInlineNode(chapterIndex, nodeIndex) {
    const ci = Number(chapterIndex);
    const ni = Number(nodeIndex);
    const chapters = this.data.formData.chapters || [];
    const chapter = chapters[ci];
    if (!chapter || !chapter.nodes || !chapter.nodes[ni]) return null;
    const node = chapter.nodes[ni];
    this.setData({
      inlineEdit: { chapterIndex: ci, nodeIndex: ni },
      editTargetChapterLid: chapter._localId,
      editTargetNodeLid: node._localId,
      nodesForm: Object.assign({}, node)
    });
    return node;
  },

  _commitInlineNodeAt(chapterIndex, nodeIndex, updates) {
    const ci = Number(chapterIndex);
    const ni = Number(nodeIndex);
    if (isNaN(ci) || isNaN(ni)) return false;
    const chapters = JSON.parse(JSON.stringify(this.data.formData.chapters || []));
    const chapter = chapters[ci];
    if (!chapter || !Array.isArray(chapter.nodes) || !chapter.nodes[ni]) {
      cyToast('未找到节点，请重试');
      return false;
    }
    const node = chapter.nodes[ni];
    Object.assign(node, updates);
    if (!node.description) {
      node.description = node.name || node.address || '';
    }
    chapter.nodes[ni] = node;
    chapters[ci] = chapter;
    this.setData({
      'formData.chapters': chapters,
      selectedNodeLid: node._localId,
      inlineEdit: { chapterIndex: ci, nodeIndex: ni },
      nodesForm: Object.assign({}, node)
    });
    this.updateAllStatistics();
    return true;
  },

  _startMapPickForNode(chapterIndex, nodeIndex) {
    const ci = Number(chapterIndex);
    const ni = Number(nodeIndex);
    const chapter = (this.data.formData.chapters || [])[ci];
    const node = chapter && chapter.nodes && chapter.nodes[ni];
    if (!node) {
      cyToast('未找到节点');
      return;
    }
    this.setData({
      inlineEdit: { chapterIndex: ci, nodeIndex: ni },
      editTargetChapterLid: chapter._localId,
      editTargetNodeLid: node._localId,
      nodesForm: Object.assign({}, node)
    });
    this.setEditorState('addNode');
    cyToast('拖动地图对准位置后确认');
  },

  pickNodePhoto(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    if (chapterindex == null || nodeindex == null) return;
    const that = this;
    const ch = (this.data.formData.chapters || [])[chapterindex];
    const node = ch && ch.nodes && ch.nodes[nodeindex];
    const cur = (node && node.imgUrl) ? node.imgUrl.split(',').filter(Boolean) : [];
    const remain = 9 - cur.length;
    if (remain <= 0) { cyToast('每个节点最多9张'); return; }
    app.chooseImage(function (res) {
      const next = cur.concat(res).slice(0, 9);
      that._commitInlineNodeAt(chapterindex, nodeindex, { imgUrl: next.join(',') });
    }, remain, { crop: true, cropScale: NODE_PHOTO_RATIO });
  },

  pickNodeLocation(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    if (chapterindex == null || nodeindex == null) {
      cyToast('节点信息不完整，请检查后重试');
      return;
    }
    const that = this;
    // pickLocation 已经保证:回调进来的 poi 一定带可用坐标(没坐标它自己 toast + 走 onFail),
    // 所以这里不再判空写空串 —— 那正是「地址显示得好好的、下一步却说没加地点」的成因。
    pickLocation({
      onPick(poi) {
        that._commitInlineNodeAt(chapterindex, nodeindex, {
          name: ((that.data.formData.chapters || [])[chapterindex].nodes || [])[nodeindex].name || poi.name || '',
          address: poi.address || poi.name || '',
          longitude: String(poi.longitude),
          latitude: String(poi.latitude)
        });
        that.setData({
          mapCenter: { longitude: poi.longitude, latitude: poi.latitude },
          mapScale: Math.max(that.data.mapScale || 12, 16)
        });
      }
    });
  },

  onTapAddNode(e) {
    const chapterIndex = e.currentTarget.dataset.chapterIndex;
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    if (!chapter) return;
    if (Number(this.data.formData.productType) === 1) {
      this.openStoryEditor({ currentTarget: { dataset: { index: chapterIndex } } });
      cyToast('请点击目标缝添加节点');
      return;
    }
    const issue = proEditorPolicy.formalNodeCreationIssue(this.data.formData, chapterIndex);
    if (issue) {
      cyToast(issue.message);
      this.showEditChapter({ currentTarget: { dataset: { index: chapterIndex } } });
      return;
    }
    this.showAddNode({ currentTarget: { dataset: { chapterIndex } } });
  },

  onTapQuickAdd() {
    this.onTapPrimaryStarter();
  },

  onNodeStoryChange(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({
      [`formData.chapters[${chapterindex}].nodes[${nodeindex}].description`]: value
    });
  },

  // 自由定向(mode2)选填叙事三字段:直写 formData.chapters,与 onNodeStoryChange 同一模式
  onNodeHookInput(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    this.setData({
      [`formData.chapters[${chapterindex}].nodes[${nodeindex}].hookText`]: e.detail.value
    });
  },

  onNodeCardHookInput(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    this.setData({
      [`formData.chapters[${chapterindex}].nodes[${nodeindex}].cardHookLong`]: e.detail.value
    });
  },

  onNodeFragmentInput(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    this.setData({
      [`formData.chapters[${chapterindex}].nodes[${nodeindex}].fragmentText`]: e.detail.value
    });
  },

  onChapterDescChange(e) {
    const { chapterindex } = e.currentTarget.dataset;
    this.setData({
      [`formData.chapters[${chapterindex}].description`]: e.detail.value
    });
  },

  toggleChapterDescExpand(e) {
    const { chapterindex } = e.currentTarget.dataset;
    const key = String(chapterindex);
    const expanded = !!(this.data.chapterDescExpanded && this.data.chapterDescExpanded[key]);
    this.setData({
      [`chapterDescExpanded.${key}`]: !expanded
    });
  },

  toggleNodeStoryExpand(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    const key = chapterindex + '-' + nodeindex;
    const expanded = !!(this.data.nodeStoryExpanded && this.data.nodeStoryExpanded[key]);
    this.setData({
      [`nodeStoryExpanded.${key}`]: !expanded
    });
  },

  openNarrativeEditor(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    const chapter = (this.data.formData.chapters || [])[chapterindex];
    const node = chapter && chapter.nodes && chapter.nodes[nodeindex];
    if (!chapter || !node) return;
    const textParts = [node.description, node.hookText, node.cardHookLong, node.fragmentText]
      .map(item => (item || '').trim())
      .filter((item, index, arr) => item && arr.indexOf(item) === index);
    this.setData({
      narrativeEditor: {
        show: true,
        chapterIndex: Number(chapterindex),
        nodeIndex: Number(nodeindex),
        chapterName: chapter.name || '',
        nodeName: node.name || '',
        description: textParts.join('\n'),
        hookText: '',
        cardHookLong: '',
        fragmentText: ''
      }
    });
  },

  closeNarrativeEditor() {
    this.setData({
      'narrativeEditor.show': false
    });
  },

  onNarrativeEditorInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [`narrativeEditor.${field}`]: e.detail.value
    });
  },

  saveNarrativeEditor() {
    const editor = this.data.narrativeEditor || {};
    const ci = editor.chapterIndex;
    const ni = editor.nodeIndex;
    if (ci < 0 || ni < 0) return;
    this.setData({
      [`formData.chapters[${ci}].nodes[${ni}].description`]: editor.description || '',
      [`formData.chapters[${ci}].nodes[${ni}].hookText`]: editor.hookText || '',
      [`formData.chapters[${ci}].nodes[${ni}].cardHookLong`]: editor.cardHookLong || '',
      [`formData.chapters[${ci}].nodes[${ni}].fragmentText`]: editor.fragmentText || '',
      'narrativeEditor.show': false
    });
  },

  removeNodeGame(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    const chapters = [...this.data.formData.chapters];
    const chapter = chapters[chapterindex];
    if (!chapter || !chapter.nodes || !chapter.nodes[nodeindex]) return;
    this._pushUndo();
    const node = { ...chapter.nodes[nodeindex] };
    node.templateId = 0;
    node.templateInfo = {};
    node.showTemplate = false;
    node.templateName = '';
    chapters[chapterindex].nodes[nodeindex] = node;
    this.setData({ 'formData.chapters': chapters });
    this.updateAllStatistics();
    this.buildRouteMap();
  },

  openNodeGame(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    const chapter = this.data.formData.chapters[chapterindex];
    const node = chapter && chapter.nodes && chapter.nodes[nodeindex];
    this.showEditNodes({
      currentTarget: { dataset: { chapterindex, nodeindex } }
    });
    this.setData({
      nodeSheetView: 'games',
      selectedTempId: node && node.templateId ? node.templateId : null,
      selectedTempInfo: node && node.templateInfo && node.templateInfo.title ? node.templateInfo : null
    });
  },


  // editorState 状态机切换器 合法值:idle/addNode/moveNode/editNode/editGame/preview/publishCheck
  setEditorState(s) {
    this.setData({ editorState: s });
  },

  // —— 地图中心准星加点/移点(对标 Strava 移动端落点)——
  // idle 态浮动入口:进入地图加点态
  enterAddNodeOnMap() {
    this.setEditorState('addNode');
  },

  // 进入移点态(供后续移动已有节点用):接 data-chapterlid/data-nodelid,缺省回退到 editTargetChapterLid/NodeLid
  enterMoveNode(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    this.setData({
      editTargetChapterLid: ds.chapterlid || this.data.editTargetChapterLid,
      editTargetNodeLid: ds.nodelid || this.data.editTargetNodeLid
    });
    this.setEditorState('moveNode');
  },

  // 地图拖动结束:仅记录中心点到实例变量,不 setData(性能 R7)
  onRegionChange(e) {
    if (e.type !== 'end') return;
    const that = this;
    // getCenterLocation 返回坐标系为 gcj02,与 <map> 一致,无需转换
    wx.createMapContext('routeMap', this).getCenterLocation({
      success(r) {
        that._pickCenter = { longitude: r.longitude, latitude: r.latitude };
      }
    });
  },

  // 取消地图加点/移点
  cancelMapEdit() {
    this.setEditorState('idle');
    this._pickCenter = null;
  },

  // 保存当前中心点为节点坐标
  saveNodeLocation() {
    const that = this;
    const proceed = (center) => {
      const state = that.data.editorState;
      if (state === 'addNode') {
        const ie = that.data.inlineEdit;
        if (ie) {
          const addr = that.data.nodesForm.address || '';
          that._commitInlineNodeAt(ie.chapterIndex, ie.nodeIndex, {
            longitude: String(center.longitude),
            latitude: String(center.latitude),
            address: addr
          });
          that.setData({
            mapCenter: { longitude: center.longitude, latitude: center.latitude },
            mapScale: Math.max(that.data.mapScale || 12, 16)
          });
          that.setEditorState('idle');
          that._pickCenter = null;
          return;
        }
        const chapters = (that.data.formData && that.data.formData.chapters) || [];
        const firstChapter = chapters[0];
        if (!firstChapter) {
          cyToast('请先添加章节');
          return;
        }
        that.setData({
          editTargetChapterLid: firstChapter._localId,
          editTargetNodeLid: '',
          popChapterNodes: true,
          popChapterNodesAction: 0,
          'nodesForm.name': '',
          'nodesForm.address': '',
          'nodesForm.description': '',
          'nodesForm.imgUrl': '',
          'nodesForm.longitude': center.longitude,
          'nodesForm.latitude': center.latitude,
          mapCenter: { longitude: center.longitude, latitude: center.latitude },
          mapScale: Math.max(that.data.mapScale, 16)
        }, function () {
          that.buildRouteMap();
        });
        that.setEditorState('idle');
      } else if (state === 'moveNode') {
        const chapters = [...((that.data.formData && that.data.formData.chapters) || [])];
        const ci = chapters.findIndex(c => c._localId === that.data.editTargetChapterLid);
        if (ci < 0) { cyToast('未找到章节'); return; }
        const nodes = [...(chapters[ci].nodes || [])];
        const ni = nodes.findIndex(n => n._localId === that.data.editTargetNodeLid);
        if (ni < 0) { cyToast('未找到节点'); return; }
        nodes[ni] = Object.assign({}, nodes[ni], {
          longitude: center.longitude,
          latitude: center.latitude
        });
        chapters[ci].nodes = nodes;
        that.setData({ 'formData.chapters': chapters });
        that.updateAllStatistics();
        that.setEditorState('idle');
      }
      that._pickCenter = null;
    };

    if (this._pickCenter) {
      proceed(this._pickCenter);
    } else {
      wx.createMapContext('routeMap', this).getCenterLocation({
        success(r) { proceed({ longitude: r.longitude, latitude: r.latitude }); },
        fail() { cyToast('获取中心点失败'); }
      });
    }
  },

  /**
   * 生命周期函数--监听页面加载
   */
  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),
  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  onLoad(options) {
    options = options || {};
    this._routeGraph = topicRouteGraph.emptyGraph();
    this._routeMappingSourceNodeId = '';
    this._routeMappingReturnToNodeEditor = false;
    this._installDraftAutosave();
    this._draftAutosaveReady = false;
    const editingTopicId = options.id ? String(options.id) : '';
    const entryMode = Number(options.mode) === 2 ? 2 : 1;
    let windowInfo = null;
    let menuButtonInfo = null;
    try {
      windowInfo = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const getMenuButtonInfo = wx.getMenuButtonBoundingClientRect || wx.getMenuButtonBoundingRect;
      menuButtonInfo = getMenuButtonInfo && getMenuButtonInfo.call(wx);
    } catch (e) {}
    // 2026-09-06 从 clubId 入口进来 = 归属俱乐部已锁死。它只喂 applyAiDraft 的回填判断,
    // 不上屏 —— 原来那句唯一的 WXML 用法(「愿意商家参与 / 开放给商家市场」按入口切文案)
    // 已按 0905 用户拍板删掉,再走 setData 就是白渲染一次。放实例属性。
    this._lockClub = !!options.clubId;
    this.setData({
      editingTopicId,
      editLoading: !!editingTopicId,
      editLoadError: '',
      operationScope: options.scope === 'MERCHANT' ? 'MERCHANT' : '',
      'formData.name': options.templateName ? decodeURIComponent(options.templateName) : '',
      'formData.clubId': options.clubId || '',   // 从俱乐部入口发团:预选并锁定归属
      'editingTicket.mode': entryMode,
      chrome: resolveMenuChrome(windowInfo, menuButtonInfo),
    });

    // movable-view y 单位是 px,把行定高按屏宽折算成 px。
    // ⚠️ CARD_H_RPX 必须等于 index.wxss 里 .slopes-node-row 的 height(120) + margin-bottom(16)。
    //    两边对不上 → 松手后落点算偏,拖一行掉两行。
    const CARD_H_RPX = 136;
    const sys = wx.getSystemInfoSync();
    this.setData({ rowHpx: Math.round(CARD_H_RPX * sys.windowWidth / 750) });

    this._syncMerchantPoolEligibility();       // 先按现有快照算一次,首帧不闪
    roleGuard.load(() => {                     // 预热权限缓存，保证节点上限守卫可靠
      this._syncMerchantPoolEligibility();     // 快照刷新后重算
    });
    this.initData();
    // 顺序不可颠倒:两者都以 isBlankTopicDraft() 为门控,谁先跑谁赢。
    // starter 先跑会灌满 formData → applyAiDraft 门控直接 return → AI 草稿静默失效(且 ai_topic_draft 不被清、滞留到下次)。
    // ⚠️ 编辑既有主题时两条都跳过:它们是「新建时灌初值」的路径,会跟异步回填抢同一批字段
    //    (谁后到谁赢),等于让草稿内容随网络快慢随机被覆盖。
    let restoredLocalDraft = false;
    if (!editingTopicId) {
      restoredLocalDraft = this._bootstrapNewLocalDraft(options);
    }
    if (!editingTopicId && !restoredLocalDraft) {
      this.applyAiDraft(options);
    }
    const restoredMode = Number(this.data.formData.productType) === 2 ? 2 : 1;
    this.applyEntryMode(restoredLocalDraft && options.mode == null ? restoredMode : entryMode);
    this.captureEntryTicketSnapshot();
    this.getUserData();
    this.loadMyClubs();
    this._ensureLocalIds();
    this._materializeCityStoryChapters();
    this.setDefaultDates();
    this.getTempList();
    this.getPublicTempList();

    // 生成日期列表
    this.generateDateList();

    // 初始化统计信息
    this.updateAllStatistics();

    if (!editingTopicId) {
      this._draftAutosaveReady = true;
      // AI 草稿在 onLoad 内会被消费；这里立刻把当前完整页面快照接力到专业草稿信封，
      // 避免用户尚未触发下一次输入就杀进程时丢失已消费内容。
      this._persistDraftEnvelope();
      if (options.clubId && !restoredLocalDraft && this.isBlankCreationCanvas()) {
        setTimeout(() => this.startClubPlaceCapture(), 0);
      }
    }

    // 放在最后:回填是异步的,要盖掉上面所有「新建默认值」(setDefaultDates/applyEntryMode 等)
    if (editingTopicId) {
      this.loadEditingTopic(editingTopicId);
    }
    // 实名状态开页查一次:已登记的人不该在发布确认里再看到那三格(值也永不下发,只有真/假)
    publisherIdentity.loadIdentityStatus((registered) => {
      if (!registered) return;
      const patch = { identityRegistered: true, identityReady: true };
      // 回答得比「点发布」还晚时,弹层已经开着 —— 顺手把那行补进已通过清单,别让清单少一项
      if (this.data.publishCheck.show) patch['publishCheck.passed'] = this._buildPublishPassed(this._publishPrecheckOk);
      this.setData(patch);
    });
  },

  /** [B3b] 带 ?id= 进来 → 拉本人主题全量详情回填表单。 */
  loadEditingTopic(id) {
    const that = this;
    const requestToken = (this._editLoadToken || 0) + 1;
    this._editLoadToken = requestToken;
    this.setData({ editLoading: true, editLoadError: '' });
    app.sendRequest({
      url: '/api/topic/edit-detail',
      method: 'POST',
      hideLoading: true,
      silentError: true,
      data: { id, scope: this.data.operationScope },
      success(res) {
        if (requestToken !== that._editLoadToken) return;
        if (res.code != '200' || !isEditingTopicPayload(res.data)) {
          that.setData({
            editLoading: false,
            editLoadError: app.getRequestErrorMessage
              ? app.getRequestErrorMessage(res, '主题内容不完整，请重试')
              : '主题内容不完整，请重试'
          });
          return;
        }
        that.applyEditingTopic(res.data);
        that.setData({ editLoading: false, editLoadError: '' });
      },
      fail(res) {
        if (requestToken !== that._editLoadToken) return;
        that.setData({
          editLoading: false,
          editLoadError: app.getRequestErrorMessage
            ? app.getRequestErrorMessage(res, '网络暂时不可用，主题未加载')
            : '网络暂时不可用，主题未加载'
        });
      },
      complete() {
        if (requestToken === that._editLoadToken && that.data.editLoading) {
          that.setData({ editLoading: false });
        }
      }
    });
  },

  retryLoadEditingTopic() {
    if (this.data.editingTopicId) this.loadEditingTopic(this.data.editingTopicId);
  },

  /**
   * 后端形状 → 编辑器 formData。
   *
   * ⚠️ 字段名两边不一致的地方都在这一层落差:
   *   merchantStatus → openMerchantPool、totalInventory → totalStock、radiusM → radius、
   *   chapter.cmsTopicNodeList → chapter.nodes。漏一个就是「编辑一次静默丢一批配置」。
   */
  applyEditingTopic(detail) {
    if (!isEditingTopicPayload(detail)) return false;
    const topic = detail.topic || {};
    const productType = Number(topic.productType) === 2 ? 2 : 1;
    const chapters = (detail.chapters || []).map((chapter) => Object.assign({}, chapter, {
      atmospherePreset: normalizeAtmosphere(chapter.atmospherePreset),
      nodes: (chapter.cmsTopicNodeList || []).map((node) => Object.assign({}, node)),
      cmsTopicNodeList: undefined
    }));
    const tickets = (detail.tickets || []).map((ticket) => Object.assign({}, ticket, {
      mode: productType,
      totalStock: ticket.totalInventory
    }));
    const categoryIds = topic.categoryIds ? String(topic.categoryIds).split(',').filter(Boolean) : [];
    const completionRule = advancedGameConfig.parseTopicCompletion(topic.completeRuleJson || '');
    const bingo = advancedGameConfig.parseTopicBingo(topic.completeRuleJson || '');
    const topicRoute = topicRouteGraph.normalizeTopicRoute(topic);
    this._routeGraph = topicRoute.graph;

    this.setData({
      editScope: detail.editScope || 'FULL',
      editLoaded: true,
      bingoEnabled: bingo.enabled,
      bingoRows: advancedGameConfig.BINGO_S_ORDER.map((pos, i) => Object.assign(
        { pos, seq: i + 1, hint: advancedGameConfig.BINGO_DEFAULT_LABELS[pos], couponName: '' },
        bingo.cells[pos])),
      bingoError: bingo.error,
      selectedCategoryIds: categoryIds,
      publishToCreative: false, // 编辑不重复往创意广场发帖
      aiSimple: topic.publishMode === 'ai_simple',
      'formData.name': topic.name || '',
      'formData.subtitle': topic.subtitle || '',
      'formData.description': topic.description || '',
      'formData.startDate': topic.startDate || '',
      'formData.endDate': topic.endDate || '',
      startDateTime: topic.startDate || '开始时间',
      endDateTime: topic.endDate || '结束时间',
      'formData.imgUrl': topic.imgUrl || '',
      'formData.imgArr': topic.imgArr || '',
      'formData.productType': productType,
      'formData.chapters': chapters,
      'formData.tickets': tickets,
      'formData.collaboratorIds': (detail.collaboratorIds || []).map(Number),
      'formData.openMerchantPool': Number(topic.merchantStatus) === 1,   // 存量可能是无资格者开的,回填后由 _syncMerchantPoolEligibility 复核
      'formData.openClubPool': Number(topic.openClubPool) === 1,
      'formData.recruitDeadline': topic.recruitDeadline || '',
      'formData.clubId': topic.clubId || '',
      'formData.selfPlay': Number(topic.selfPlay) === 1,
      'formData.selfPlayPrice': topic.selfPlayPrice || '',
      'formData.selfPlayQuota': topic.selfPlayQuota || '',
      'formData.teamMode': Number(topic.teamMode) || 0,
      'formData.teamMaxMembers': Number(topic.teamMaxMembers) || 4,
      'formData.finishMedalName': topic.finishMedalName || '',
      'formData.finishMedalImg': topic.finishMedalImg || '',
      'formData.completeRewardCouponId': topic.completeRewardCouponId || 0,
      completeRewardOn: !!(topic.completeRewardCouponId),   // 回填:选过券就把开关点亮
      'formData.completeRuleJson': topic.completeRuleJson || '',
      'formData.routeMode': topicRoute.routeMode,
      'formData.routeGraphJson': topic.routeGraphJson || '',
      'formData.configVersion': topicRoute.configVersion,
      'editingTicket.mode': productType,
      completionRuleMode: completionRule.mode,
      completionRequiredCount: completionRule.requiredCount,
      completionRuleError: completionRule.error
    });
    // imgArr(CSV)与 imgArrList(数组)必须走同一个写入口,单独 setData 其一会让 step3 画廊与提交值分家
    this._setImgArr(this._parseImgArr(topic.imgArr || ''));
    this._ensureLocalIds();
    this._materializeCityStoryChapters();
    this.captureEntryTicketSnapshot();
    this._captureLockedSnapshot();
    this.updateAllStatistics();
    this.refreshRouteGraph();
    this._syncMerchantPoolEligibility();   // 回填之后复核:存量主题可能是无资格者开的池
    this._finishEditingDraftBootstrap(detail);
    return true;
  },

  /**
   * 招商资格(2026-08-11 拍板):**只有俱乐部主理人能开商家池**,纯玩家不招商。
   *
   * ⚠️ 快照拿不到时**按可编辑处理,不擅自压值** —— roleGuard 的 load() 失败会回落本地缓存,
   *    缓存为空时 isClubLeader() 返 false。若据此把 openMerchantPool 压成 0,一个主理人
   *    编辑正在招商的主题就会**静默关掉招商、孤立已报名商家**,而这正是后端
   *    resolveMerchantPoolFlag 的注释里明令拒绝的那件事。判不出资格就交后端裁决:
   *    它有权威身份数据,拒也会拒得有声。
   *
   * ⚠️ 确证无资格才清 formData —— 草稿复制/编辑回填带来的旧值必须清掉,否则开关已不露面,
   *    pro-editor-policy 仍按「要招商」校验(merchantRequired 直接读 formData),玩家卡死且看不到原因。
   */
  _syncMerchantPoolEligibility() {
    const editable = !roleGuard.hasSnapshot() || roleGuard.isClubLeader();
    /* 稿 E2 的锁态跟着同一份快照算:此前这张卡三端都能编,而「我的权益」页上写着
       「未解锁勋章设计」—— 写着不能用、点进来却能用,是假保证。
       ⚠️ 锁态**只读不清空**:formData.finishMedal* 一个字都不动 ——
          存量勋章可能是有资格的时候设的,清掉等于替用户删图。
       ⚠️ 真正的闸在后端(ApiTopicController 的 checkDesignMedal),前端这层只是不让人误填;
          只做前端就是又一个假保证。 */
    const patch = {
      merchantPoolEditable: editable,
      medalEditable: !roleGuard.hasSnapshot() || roleGuard.can('canDesignMedal'),
    };
    if (!editable && this.data.formData && this.data.formData.openMerchantPool) {
      patch['formData.openMerchantPool'] = false;
    }
    this.setData(patch);
  },

  // WHITELIST 档三类锁定字段(日期 / 章节站点结构 / 票)的回填原样,用来判「用户到底改没改它们」
  _lockedFingerprint() {
    const f = this.data.formData || {};
    return JSON.stringify({
      startDate: f.startDate, endDate: f.endDate, chapters: f.chapters, tickets: f.tickets
    });
  },

  _captureLockedSnapshot() {
    this._lockedSnapshot = this._lockedFingerprint();
  },

  /**
   * 已开卖的主题改了锁定字段 → 当场说清楚,别让它变成「保存成功但没生效」。
   *
   * ⚠️ 这一条是本次改动的要害:后端在 WHITELIST 档是拒收这三类字段的,而前端为了让「只改文案」
   *    还能存得下去会把它们剔掉。若不在剔之前比一次,用户改了票价 → 被剔 → 后端只收到文案 →
   *    回来一句「已保存」而价格纹丝不动,零提示。静默忽略盖住的恰好是资损面。
   */
  _assertLockedFieldsUntouched() {
    if (this._lockedSnapshot === this._lockedFingerprint()) return true;
    modal.show({
      title: '这些改动存不下来',
      content: '主题已过审开卖，开始/结束日期、章节站点结构、票种与价格都不能再改了。'
        + '要改这些只能先下架 → 退款 → 重发。其余文案与图片的修改可以正常保存。',
      showCancel: false,
      confirmText: '知道了'
    });
    return false;
  },

  applyEntryMode(mode) {
    const nextMode = Number(mode) === 2 ? 2 : 1;
    const tickets = (this.data.formData && this.data.formData.tickets) ? this.data.formData.tickets.slice() : [];
    if (tickets.length) {
      // [P0-02] 全量覆盖,不能只改 tickets[0] —— 只改首张会把 [1..n] 留在旧 mode 上 = 混票。
      this.setData({
        'formData.tickets': tickets.map((t) => Object.assign({}, t, { mode: nextMode })),
        'formData.productType': nextMode,
        'editingTicket.mode': nextMode
      });
    } else {
      this.setData({
        'formData.tickets': [this.createDefaultTicket(nextMode)],
        'formData.productType': nextMode,
        'editingTicket.mode': nextMode
      });
    }
  },

  captureEntryTicketSnapshot() {
    this._entryTicketSnapshot = JSON.stringify((this.data.formData && this.data.formData.tickets) || []);
  },

  hasUserDraftConfig() {
    const formData = this.data.formData || {};
    const hasRouteContent = !!(formData.name || formData.subtitle || formData.description || formData.imgUrl || formData.imgArr)
      || (formData.chapters || []).some(chapter => chapter && (chapter.name || chapter.description || chapter.imgArr
        || (chapter.nodes || []).some(node => node && (node.name || node.description || node.address || node.imgUrl))));
    const tickets = JSON.stringify(formData.tickets || []);
    return hasRouteContent || (this.data.pendingMaterials || []).length > 0
      || tickets !== (this._entryTicketSnapshot || '[]');
  },

  _buildCopiedDraft(mode, aiSimple) {
    const nextMode = Number(mode) === 2 ? 2 : 1;
    const formData = JSON.parse(JSON.stringify(this.data.formData || {}));
    formData.productType = nextMode;
    formData.tickets = (formData.tickets || []).map(ticket => Object.assign({}, ticket, { mode: nextMode }));
    return {
      formData,
      selectedCategoryIds: (this.data.selectedCategoryIds || []).slice(),
      selectedCategoryNames: (this.data.selectedCategoryNames || []).slice(),
      pendingMaterials: JSON.parse(JSON.stringify(this.data.pendingMaterials || [])),
      aiSimple: !!aiSimple,
      productType: nextMode
    };
  },

  _openCopiedDraft(mode, aiSimple, replaceCurrent) {
    const nextMode = Number(mode) === 2 ? 2 : 1;
    writeAiDraft(this._buildCopiedDraft(nextMode, aiSimple));
    const navigate = replaceCurrent ? wx.redirectTo : wx.navigateTo;
    navigate({ url: '/pages/publish/fabu/index?mode=' + nextMode });
  },

  // 模式选择器。左卡原来是「点一下就对切」,两种模式的差别全靠创作者自己知道;
  // 切错了整条票务链路的必填项都跟着变(定向要集合时间地点、探索只要有效期)。
  // 拆成「先摊开讲、再让人选」,真正的切换动作仍然落回 requestModeSwitch,不复制一份逻辑。
  openModePicker() {
    if (this.data.operationScope === 'MERCHANT') return;   // 商家档模式已固定,见 wxml 注释
    this.setData({
      modePickerShow: true,
      modePickerMode: Number(this.data.formData.productType) === 2 ? 2 : 1,
    });
  },
  closeModePicker() { this.setData({ modePickerShow: false }); },

  // 点选项只【暂选】,不落地 —— 切模式会连带复制一份新草稿,那是不该被"手滑点中"触发的动作。
  onPickMode(e) {
    this.setData({ modePickerMode: Number(e.currentTarget.dataset.mode) === 2 ? 2 : 1 });
  },

  confirmModePicker() {
    const mode = this.data.modePickerMode;
    this.setData({ modePickerShow: false });
    if (Number(this.data.formData.productType) === mode) return;
    this.requestModeSwitch({ currentTarget: { dataset: { mode } } });
  },

  requestModeSwitch(e) {
    // ★ 这是模式的唯一写入口 —— 商家档的闸必须落在这里,而不是只挡 openModePicker。
    //   模式选择器是看得见的那条路,confirmModePicker 之外还有草稿恢复等路径也会走到这。
    if (this.data.operationScope === 'MERCHANT') return;
    const nextMode = Number(e.currentTarget.dataset.mode) === 2 ? 2 : 1;
    if (Number(this.data.formData.productType) === nextMode) return;
    if (!this.hasUserDraftConfig()) {
      this.applyEntryMode(nextMode);
      this.captureEntryTicketSnapshot();
      return;
    }
    modal.show({
      title: '复制为新草稿？',
      content: '当前草稿会保留不变；将复制一份并切换主题模式。',
      confirmText: '复制并切换',
      success: (res) => {
        if (res.confirm) this._openCopiedDraft(nextMode, false, false);
      }
    });
  },

  copyToProfessionalDraft() {
    this._openCopiedDraft(this.data.formData.productType, false, true);
  },

  createDefaultTicket(mode) {
    const nextMode = Number(mode) === 2 ? 2 : 1;
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return {
      name: nextMode === 2 ? '自由探索票' : '城市定向票',
      price: 0,
      totalStock: 100,
      mode: nextMode,
      meetingPoint: '',
      meetingPointAddress: '',
      meetingPointLongitude: '',
      meetingPointLatitude: '',
      teamSize: 0,
      startTime: nextMode === 2 ? fmt(start) : '',
      endTime: nextMode === 2 ? fmt(end) : '',
      saleStartTime: fmt(now),
      saleEndTime: fmt(start),
      description: nextMode === 2 ? '全点开放，玩家可在有效期内自由安排顺序。' : '集合出发，按路线完成现场节点互动。',
      refundSupported: true,
      syncWithTheme: true
    };
  },

  // 页面销毁:让在途发布回调失效,避免 setData / redirect after unload
  onUnload() {
    this.destroyPreviewAudio();
    if (this._pendingUndoTimer) clearTimeout(this._pendingUndoTimer);
    this._pendingUndoTimer = null;
    this._pendingUndoSnapshot = null;
    this.data.clubPlaceCaptureActive = false;
    this._precheckToken = (this._precheckToken || 0) + 1; // 让在途预检回调失效
    this._editLoadToken = (this._editLoadToken || 0) + 1;
    if (this._publishWorkflow) {
      this._publishWorkflow.destroy();
    }
  },

  // 生成日期列表（今天至30天内）
  generateDateList() {
    this.setData({
      dateList: publishDate.buildDateList(new Date())
    });
  },

  // 显示开始时间选择器
  showStartTimePicker() {
    this.setData({
      'startTimePicker.show': true
    });
  },

  // 显示结束时间选择器
  showEndTimePicker() {
    this.setData({
      'endTimePicker.show': true
    });
  },

  

  // 开始日期变化
  onStartDateChange(e) {
    const value = e.detail.value;
    this.setData({
      startDateIndex: value
    });
  },

  // 开始时间变化 - 路线日期选择器（重命名避免冲突）
  onStartTimePickerChange(e) {
    const value = e.detail.value;
    this.setData({
      startTimeIndex: value
    });
  },

  // 关闭开始时间选择器
  closeStartTimePicker() {
    this.setData({
      'startTimePicker.show': false
    });
  },

  // 确认开始时间
  confirmStartTime() {
    const {
      startDateIndex,
      startTimeIndex,
      dateList,
      hours,
      minutes
    } = this.data;

    const selectedDate = dateList[startDateIndex[0]];
    const hour = hours[startTimeIndex[0]];
    const minute = minutes[startTimeIndex[1]];

    // 格式化开始时间为 2025-11-19 09:00:00 格式
    const startDateTime = this.formatDateTimeForAPI(selectedDate.date, hour, minute);
    const displayText = `${selectedDate.display} ${timeOptions.formatHM(hour, minute)}`;


    // 更新显示
    this.setData({
      startDateTime: displayText,
      'formData.startDate': startDateTime,
      'startTimePicker.show': false
    }, () => this.refreshPrimaryActionState());

    // 显示结束时间选择器
    setTimeout(() => {
      this.setData({
        'endTimePicker.show': true
      });
    }, 300);
  },

  // [P1-41] 日期时间归一为 'YYYY-MM-DD HH:mm:ss'。formData/票时间的写入点格式不一
  // (纯日期 / 'HH:mm' / 'HH:mm:ss' / ISO T…Z),原提交处无脑追加 ':00'/' 00:00:00' 会拼出
  // 非法串(如 '…09:00:00 00:00:00'),后端 Date 反序列化必败。格式不符传 null,由后端兜底。
  _normalizeDateTime(v, defaultTime) {
    return publishDate.normalizeDateTime(v, defaultTime);
  },

  // 工具方法：格式化日期时间为 API 需要的格式 (2025-11-19 09:00:00)
  formatDateTimeForAPI(dateStr, hour, minute) {
    return publishDate.formatDateTimeForAPI(dateStr, hour, minute);
  },

  // 结束日期变化
  onEndDateChange(e) {
    const value = e.detail.value;
    this.setData({
      endDateIndex: value
    });
  },

  // 结束时间变化 - 路线日期选择器（重命名避免冲突）
  onEndTimePickerChange(e) {
    const value = e.detail.value;
    this.setData({
      endTimeIndex: value
    });
  },

  // 关闭结束时间选择器
  closeEndTimePicker() {
    this.setData({
      'endTimePicker.show': false
    });
  },

  // 确认结束时间
  confirmEndTime() {
    const {
      endDateIndex,
      endTimeIndex,
      dateList,
      hours,
      minutes,
      formData
    } = this.data;

    const selectedDate = dateList[endDateIndex[0]];
    const hour = hours[endTimeIndex[0]];
    const minute = minutes[endTimeIndex[1]];

    // 格式化结束时间为 2025-11-19 18:00:00 格式
    const endDateTime = this.formatDateTimeForAPI(selectedDate.date, hour, minute);
    const displayText = `${selectedDate.display} ${timeOptions.formatHM(hour, minute)}`;


    // 验证时间合理性
    const startTime = new Date(formData.startDate);
    const endTime = new Date(endDateTime);

    if (endTime <= startTime) {
      cyToast('结束时间必须晚于开始时间');
      return;
    }

    // 更新显示
    this.setData({
      endDateTime: displayText,
      'formData.endDate': endDateTime,
      'endTimePicker.show': false
    }, () => this.refreshPrimaryActionState());

    cyToast.success('时间设置完成');
  },

  // 节点营业时间相关方法
  formatTime: function (hour, minute) {
    return publishDate.formatTime(hour, minute);
  },

  // cy-date-sheet 组件事件桥接(替代原 data-action dispatch)
  onBusinessTimeCancel() {
    this.setData({ 'timePicker.show': false });
  },
  onBusinessTimeConfirm() {
    this.handleTimePopup({ currentTarget: { dataset: { action: 'confirm' } } });
  },

  handleTimePopup: function (e) {
    const {
      action
    } = e.currentTarget.dataset;
    if (action === 'open') {
      let startTimeIndex = [9, 0];
      let endTimeIndex = [18, 0];

      if (this.data.nodesForm.businessTime) {
        const timeParts = this.parseBusinessTime(this.data.nodesForm.businessTime);
        if (timeParts) {
          startTimeIndex = [timeParts.startHour, timeParts.startMinute];
          endTimeIndex = [timeParts.endHour, timeParts.endMinute];
        }
      }

      this.setData({
        'timePicker.show': true,
        startTimeIndex: startTimeIndex,
        endTimeIndex: endTimeIndex,
        'timePicker.startTime': {
          hour: startTimeIndex[0],
          minute: startTimeIndex[1]
        },
        'timePicker.endTime': {
          hour: endTimeIndex[0],
          minute: endTimeIndex[1]
        }
      });
    } else if (action === 'confirm') {
      const startTime = this.data.timePicker.startTime;
      const endTime = this.data.timePicker.endTime;

      const businessTime = this.formatTime(startTime.hour, startTime.minute) +
        '-' +
        this.formatTime(endTime.hour, endTime.minute);

      this.setData({
        'nodesForm.businessTime': businessTime,
        'timePicker.show': false
      });
    } else if (action === 'close') {
      this.setData({
        'timePicker.show': false
      });
    }
  },

  // 节点营业时间变化
  onStartTimeChange: function (e) {
    const value = e.detail.value;
    this.setData({
      'timePicker.startTime': {
        hour: this.data.hours[value[0]],
        minute: this.data.minutes[value[1]]
      }
    });
  },

  onEndTimeChange: function (e) {
    const value = e.detail.value;
    this.setData({
      'timePicker.endTime': {
        hour: this.data.hours[value[0]],
        minute: this.data.minutes[value[1]]
      }
    });
  },

  parseBusinessTime: function (businessTime) {
    return publishDate.parseBusinessTime(businessTime);
  },

  // 初始化数据
  initData() {
    // let today = new Date();
    // let tomorrow = new Date(today);
    // tomorrow.setDate(tomorrow.getDate() + 30); // 默认结束日期为30天后

    // let formatDate = (date) => {
    //   return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
    // };

    // let startDate = formatDate(today);
    // let endDate = formatDate(tomorrow);

    // this.setData({
    //   startdate: startDate,
    //   enddate: endDate,
    //   'formData.startDate': startDate,
    //   'formData.endDate': endDate,
    //   'formData.tickets[0].startTime': startDate,
    //   'formData.tickets[0].endTime': endDate
    // });
  },

  applyStarterContent(options = {}) {
    const storageKey = 'topic_starter_prefilled_v1';
    const hasSeenStarter = !!wx.getStorageSync(storageKey);
    const hasTemplateName = !!options.templateName;
    const isBlankDraft = this.isBlankTopicDraft();

    if (hasSeenStarter || !isBlankDraft) {
      return;
    }

    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const startDate = `${fmt(start)} 10:00`;
    const endDate = `${fmt(end)} 18:00`;
    const name = this.data.formData.name || (hasTemplateName ? decodeURIComponent(options.templateName) : '城市街角探索');

    this.setData({
      // 分类必须经标签页选真实分类(留空让 validateForm 拦截,避免发出 mock 分类id)
      selectedCategoryIds: [],
      selectedCategoryNames: [],
      selectedCategoryNamesStr: '',
      categoryList: [],
      startDateTime: startDate,
      endDateTime: endDate,
      'formData.name': name,
      'formData.subtitle': '沿着街角线索，完成一次可报名的城市路线。',
      'formData.description': '这是一条可直接改写的路线草稿：参与者从起点出发，依次完成观察、问答、拍照和协作节点互动，最终拼出关于这片街区的隐藏故事。你可以保留结构，只替换地点、剧情和互动。',
      'formData.startDate': startDate,
      'formData.endDate': endDate,
      // 封面置空,逼用户上传真封面(原 mock 本地路径会发出坏图)
      'formData.imgUrl': '',
      'formData.imgArr': '',
      imgArrList: [],
      'formData.categoryIds': '',
      'formData.tickets': [{
        name: '体验票',
        price: 0,
        totalStock: 100,
        mode: 2,
        meetingPoint: '',
        teamSize: 0,
        startTime: startDate,
        endTime: endDate,
        saleStartTime: fmt(now),
        saleEndTime: fmt(start),
        description: '适合内测和线下试玩',
        refundSupported: true,
        syncWithTheme: true
      }],
      'formData.chapters': [{
        name: '第1章',
        description: '从城市入口开始，寻找第一组可被验证的现场线索。',
        imgArr: '',
        calculatedDistance: 0,
        nodes: [{
          name: '街角集合点',
          subtitle: '观察入口',
          description: '找到现场最醒目的招牌或公共艺术，记录它和路线之间的关系。',
          address: '上海市徐汇区钦州北路1001号',
          longitude: '121.384904',
          latitude: '31.167199',
          imgUrl: '',
          nodeTime: 30,
          showTemplate: false,
          businessTime: '10:00-18:00',
          sortID: 1
        }]
      }]
    });
    wx.setStorageSync(storageKey, true);
    this.updateAllStatistics();
  },

  /** AI 创作助手回填:读 ai_topic_draft → 灌入 formData(幂等门控:blank 才灌,灌完即清) */
  applyAiDraft(options) {
    options = options || {};
    if (!this.isBlankTopicDraft()) return;
    const source = options.from === 'ai' ? options : null;
    const draft = source || readAiDraft();
    if (!draft) return;
    const sourceData = draft.formData || draft;
    const productType = Number(sourceData.productType) === 2 ? 2 : 1;
    const lockedClubId = this._lockClub ? (this.data.formData.clubId || options.clubId || '') : '';
    const chapters = (sourceData.chapters || []).map(ch => ({
      name: ch.name || '第1章',
      description: ch.description || '',
      atmospherePreset: normalizeAtmosphere(ch.atmospherePreset),
      schemaVersion: ch.schemaVersion,
      blocks: ch.blocks,
      required: ch.required,
      imgArr: ch.imgArr || '',
      calculatedDistance: ch.calculatedDistance || 0,
      nodes: (ch.nodes || []).map((n, i) => ({
        _localId: n._localId || '',
        id: n.id,
        name: n.name || ('节点' + (i + 1)),
        subtitle: n.subtitle || '',
        description: n.description || n.address || '',
        address: n.address || '',
        longitude: String(n.longitude || ''),
        latitude: String(n.latitude || ''),
        imgUrl: n.imgUrl || '',
        nodeTime: parseInt(n.nodeTime) || 30,
        showTemplate: false,
        businessTime: n.businessTime || '',
        sortID: n.sortID || (i + 1),
        templateId: n.templateId || 0,
        templateName: n.templateName || '',
        hookText: n.hookText || '',
        cardHookLong: n.cardHookLong || '',
        fragmentText: n.fragmentText || ''
      }))
    }));
    const pendingMaterials = Array.isArray(draft.pendingMaterials)
      ? JSON.parse(JSON.stringify(draft.pendingMaterials)) : [];
    chapters.forEach((chapter) => {
      const canFormalize = productType !== 1 || proEditorPolicy.hasRealStory(chapter);
      const formalNodes = [];
      (chapter.nodes || []).forEach((node) => {
        if (canFormalize && proEditorPolicy.hasUsableCoords(node)) {
          formalNodes.push(node);
        } else {
          pendingMaterials.push(proEditorMaterials.materialFromNode(
            node, lockedClubId ? 'place' : 'node'
          ));
        }
      });
      chapter.nodes = formalNodes;
    });
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const startDate = `${fmt(start)} 10:00`;
    const endDate = `${fmt(end)} 18:00`;
    const restoredStartDate = sourceData.startDate || startDate;
    const restoredEndDate = sourceData.endDate || endDate;

    this.setData({
      aiSimple: !!draft.aiSimple,
      selectedCategoryIds: (draft.selectedCategoryIds || []).slice(),
      selectedCategoryNames: (draft.selectedCategoryNames || []).slice(),
      selectedCategoryNamesStr: (draft.selectedCategoryNames || []).join('、'), categoryList: [],
      startDateTime: restoredStartDate, endDateTime: restoredEndDate,
      'formData.name': sourceData.name || '',
      'formData.subtitle': sourceData.subtitle || '',
      'formData.description': (sourceData.description || '') + (draft.aiTraceId ? '  [AI 辅助生成]' : ''),
      'formData.startDate': restoredStartDate,
      'formData.endDate': restoredEndDate,
      'formData.imgUrl': sourceData.imgUrl || '',
      'formData.imgArr': sourceData.imgArr || '',
      imgArrList: this._parseImgArr(sourceData.imgArr),
      'formData.categoryIds': sourceData.categoryIds || '',
      'formData.collaboratorIds': sourceData.collaboratorIds || [],
      'formData.collaboratorList': sourceData.collaboratorList || [],
      'formData.productType': productType,
      'formData.openMerchantPool': !!sourceData.openMerchantPool,
      'formData.openClubPool': !!sourceData.openClubPool,
      'formData.recruitDeadline': sourceData.recruitDeadline || '',
      'formData.clubId': lockedClubId || sourceData.clubId || '',
      'formData.selfPlay': !!sourceData.selfPlay,
      'formData.selfPlayPrice': sourceData.selfPlayPrice || '',
      'formData.selfPlayQuota': sourceData.selfPlayQuota || '',
      'formData.teamMode': Number(sourceData.teamMode) || 0,
      'formData.teamMaxMembers': Number(sourceData.teamMaxMembers) || 4,
      'formData.finishMedalName': sourceData.finishMedalName || '',
      'formData.finishMedalImg': sourceData.finishMedalImg || '',
      'formData.completeRewardCouponId': sourceData.completeRewardCouponId || 0,
      completeRewardOn: !!(sourceData.completeRewardCouponId),   // 回填:选过券就把开关点亮
      'formData.tickets': sourceData.tickets || [{
        name: '体验票', price: 0, totalStock: 100, mode: 2,
        meetingPoint: '', teamSize: 0, startTime: startDate, endTime: endDate,
        saleStartTime: fmt(now), saleEndTime: fmt(start),
        description: 'AI 辅助生成的体验票', refundSupported: true, syncWithTheme: true
      }],
      'formData.chapters': chapters,
      pendingMaterials
    });
    const aiDraftKey = aiDraftStorageKey();
    if (aiDraftKey) wx.removeStorageSync(aiDraftKey);
    this.updateAllStatistics();
  },

  isBlankTopicDraft() {
    const formData = this.data.formData || {};
    const chapters = formData.chapters || [];
    const hasNamedChapter = chapters.some(chapter => {
      if (!chapter) return false;
      if (chapter.description || chapter.imgArr) return true;
      return (chapter.nodes || []).some(node => node && (node.name || node.description || node.address || node.imgUrl));
    });
    return !formData.name &&
      !formData.subtitle &&
      !formData.description &&
      !formData.imgUrl &&
      !formData.imgArr &&
      !(formData.tickets && formData.tickets.length) &&
      !hasNamedChapter;
  },

  // 分钟选择改变事件
  bindMinuteChange: function (e) {
    const index = e.detail.value;
    const selectedMinuteStr = this.data.minuteOptions[index];
    const selectedMinute = parseInt(selectedMinuteStr, 10); // 转为数字（基数10避免进制问题）

    this.setData({
      minuteIndex: index,
      'nodesForm.nodeTime': selectedMinute // 正确：赋值数字
    });
  },

  // 分类选择弹窗化(2026-07-31):半屏 cy-category-sheet + 事件回传,不再跳转独立页面
  navigateToCategorySelect: function () {
    this.setData({
      categorySheetVisible: true,
      categorySheetIds: this.data.selectedCategoryIds.join(','),
      // CU-C-45:入口在主题详情面板内(topic-detail-sheet.wxml 的 id=fieldCategory),
      // 两个 sheet 同吃 --cy-z-sheet(800),而详情在 DOM 里更靠后 ⇒ 详情全屏遮罩+面板把
      // 分类弹层整个压住,点分类项/保存都落在详情遮罩上(顺手把详情关掉)。所以打开分类
      // 必须同时关掉详情 —— 与合作者选择器同一套互斥,不是靠遮罩顺带挡住。
      topicDetailShow: false,
      // 与合作者选择器互斥。两者都套 cy-sheet、同吃 --cy-z-sheet(800),谁盖谁只由 DOM 顺序决定。
      // 2026-08-01 automator 实测:同时 show 时 DOM 里能查到 2 个各自带 sh__mask 的 cy-sheet,
      // 两块 panel 几乎完全重叠(合作者 top=377/h=467、分类 top=387/h=457,都贴底 844),
      // 叠成两层全屏遮罩,下层面板被夹在遮罩之间发暗、顶部还露出约 10px。
      // 此前摸不到只是因为先开那个的全屏遮罩顺带挡住了另一个入口,不是代码级互斥 —— 这里把闸写进代码。
    });
  },

  onCategorySelect: function (e) {
    this.updateCategorySelection(e.detail.selectedIds, e.detail.selectedCategories);
  },

  onCategorySheetClose: function () {
    // CU-M-160:这一层是叠在「编辑主题」之上的,关掉最上层必须回到原编辑上下文。
    // 开分类时把详情关掉是为了躲同档遮罩互压(CU-C-45),不是要退出编辑主题 ——
    // 不补这一句,用户点完右上角 ✕ 直接落回主编辑器,填了一半的主题描述得重开一层才看得见。
    // 只有 topic-detail-sheet 的 id=fieldCategory 一处会打开这个弹层,所以「关分类 ⇒ 开详情」
    // 恒等于回到它上一层;两者仍是先后出现,不违反 dual-sheet-mutex 那条互斥。
    this.setData({ categorySheetVisible: false, topicDetailShow: true });
  },

  // 从分类选择弹窗回调更新选择 - 需要同时接收ID和名称
  updateCategorySelection: function (selectedIds, selectedCategories) {
    const that = this;

    const selectedCategoryIds = selectedIds || [];
    const selectedCategoryNames = selectedCategories ? selectedCategories.map(item => item.categoryName) : [];
    const selectedCategoryNamesStr = selectedCategoryNames.join('，');

    that.setData({
      selectedCategoryIds: selectedCategoryIds, // 正确更新 selectedCategoryIds
      selectedCategoryNames: selectedCategoryNames,
      selectedCategoryNamesStr: selectedCategoryNamesStr,
      categoryList: selectedCategories || [],
      'formData.categoryIds': selectedCategoryIds.join(',')
    }, () => that.refreshPrimaryActionState());


    // console.log('更新选中的分类数据:', {
//       ids: selectedCategoryIds,
//       names: selectedCategoryNames,
//       namesStr: selectedCategoryNamesStr,
//       list: selectedCategories
//     });
  },

  // 显示添加章节弹框
  showAddChapter(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    let chapterIndex = dataset.index;
    // 计算下一个章节的编号
    const currentChapterCount = this.data.formData.chapters.length;
    const nextChapterNumber = currentChapterCount + 1;
    const defaultChapterName = `第${nextChapterNumber}章`;

    this.setData({
      popChapterAction: 0,
      popChapter: true,
      popChapterIndex: chapterIndex,
      assignPendingLocalId: '',
      'chapterForm.name': defaultChapterName,
      'chapterForm.description': '',
      'chapterForm.imgArr': '',
      'chapterForm.nodes': [],
      'chapterForm.calculatedDistance': 0,
      'chapterForm.category': '',
      'chapterForm.categoryId': null,
      'chapterForm.recruitEnabled': 0,
      'chapterForm.termsMode': 'PERK',
      'chapterForm.perkMinValue': null,
      'chapterForm.maxMerchant': 0,
      'chapterForm.atmospherePreset': 'DEFAULT',
      'chapterForm.audioUrl': '',
      'chapterForm.audioDuration': 0,
      'chapterForm.audioFileName': ''
    });
    if (Number(this.data.formData.productType) === 2) this.loadMerchantCategories();
  },
  // 折叠/展开章节(_collapsed 为 '_' 前缀前端态,提交时由 _stripLocalFields 自动剥离)
  toggleChapterCollapse(e) {
    const ci = e.currentTarget.dataset.chapterindex;
    const chapters = this.data.formData.chapters;
    if (ci == null || !chapters[ci]) return;
    chapters[ci]._collapsed = !chapters[ci]._collapsed;
    this.setData({ 'formData.chapters': chapters });
  },
  // 渐进折叠(M4·B):翻转通用设置 Tab 内可折叠卡(票务/合作者)的展开态
  toggleSection(e) {
    const sec = e.currentTarget.dataset.sec;
    if (!sec) return;
    const secCollapsed = { ...this.data.secCollapsed };
    secCollapsed[sec] = !secCollapsed[sec];
    this.setData({ secCollapsed });
  },
  // ★ setData 回调里的 updateAllStatistics 不是"顺手刷一下",少了它就是一条死锁
  //   (2026-09-05 用户实测:「先添加了,再删除了,就没办法再添加了」)。
  //   starterAction 是派生态,只在 refreshPrimaryActionState 里算:加了一章并写进内容后
  //   它变成 null;删掉这章若不重算,它就一直是 null —— 而空态卡的 CTA 挂
  //   `wx:if="{{starterAction}}"`、「添加章节」行挂 `wx:if="{{chapters.length || pendingMaterials.length}}"`,
  //   删掉最后一章时两个条件同时不成立,页面上**再没有任何添加章节的入口**。
  //   顺带 chapterStats / totalStats / completeness / canPublish 也都会停在删除前的值,
  //   底栏「发布」还是亮的,要到发布时才被打回。
  deleteChapter(e) {
    const that = this;
    let popChapterIndex = this.data.popChapterIndex;
    modal.show({
      title: '确认删除章节',
      // CU-C-158:这里原本写「删除后不可恢复(可撤销)」,前后语义相反。
      // _pushUndo() 确实压了栈,但 canUndo 在本页 WXML 零消费(已登记进
      // scripts/baselines/u4-dead-setdata-field.json),页面上没有绑定 undo() 的控件;
      // 唯一可见的「撤销」条属于待编排素材的 5 秒窗口(undoPendingRemoval),救不回章节。
      // 承诺给不出就等于骗人按下去,删掉括号。要恢复这条承诺得先做出可见入口。
      content: '删除后不可恢复。',
      success(r) {
        if (!r.confirm) return;
        that._pushUndo();
        that.destroyPreviewAudio(); // R9-36:删除章节同样关闭弹层,预听一并停
        that.setData({
          'formData.chapters': that.data.formData.chapters.filter((_, index) => index !== popChapterIndex),
          popChapter: false,
          chapterSettingsFromStory: false
        }, () => that.updateAllStatistics());
      }
    });
  },
  //显示编辑章节弹框
  showEditChapter(e) {
    var that = this
    let chapterIndex = e.currentTarget.dataset.index;
    let newChapters = that.data.formData.chapters[chapterIndex];
    let chapterForm = Object.assign({}, newChapters, {
      categoryId: newChapters.categoryId || null,
      recruitEnabled: Number(newChapters.recruitEnabled) === 1 ? 1 : 0,
      termsMode: newChapters.termsMode === 'TRAFFIC' ? 'TRAFFIC' : 'PERK',
      perkMinValue: newChapters.perkMinValue == null ? null : String(newChapters.perkMinValue),
      maxMerchant: Number.isInteger(Number(newChapters.maxMerchant)) ? Number(newChapters.maxMerchant) : 0,
      required: Number(newChapters.required) === 0 ? 0 : 1,
      atmospherePreset: normalizeAtmosphere(newChapters.atmospherePreset),
    });
    this.setData({
      chapterForm: chapterForm,
      popChapter: true,
      popChapterAction: 1,
      popChapterIndex: chapterIndex,
      assignPendingLocalId: ''
    })
    if (Number(that.data.formData.productType) === 2) that.loadMerchantCategories();
  },
  
  onSubtitleChange(e) {
    this.setData({
      'formData.subtitle': e.detail.value
    });
  },
  // 举办方式：是否允许路线进入商家池
  onMerchantPoolChange(e) {
    this.setData({
      'formData.openMerchantPool': e.detail.value
    });
  },

  // 开放范围·俱乐部承接(2026-09-15 裁决 12B:默认开,主办可手动关)
  onClubPoolChange(e) {
    this.setData({
      'formData.openClubPool': e.detail.value
    });
  },

  onTeamSupportChange(e) {
    this.setData({ 'formData.teamMode': e.detail.value ? 1 : 0 })
  },

  onTeamModeSelect(e) {
    this.setData({ 'formData.teamMode': Number(e.currentTarget.dataset.mode) })
  },

  onTeamMaxMembersChange(e) {
    const options = this.data.teamMemberOptions
    this.setData({ 'formData.teamMaxMembers': options[Number(e.detail.value)] })
  },

  // 章节承接的品类与 mms_merchant.category_id 同口径；parentid 必须显式传字符串 "0"，
  // ApiCategoryController 会直接调用 parentid.equals("0")。
  loadMerchantCategories() {
    if (this.data.merchantCategoryLoading || this.data.merchantCategoryList.length) return;
    const that = this;
    that.setData({ merchantCategoryLoading: true });
    app.sendRequest({
      hideLoading: true,
      url: '/api/category/list',
      method: 'POST',
      data: { type: 1, parentid: '0' },
      success(res) {
        if (res.code == '200' && Array.isArray(res.data)) {
          that.setData({ merchantCategoryList: res.data });
        }
      },
      complete() {
        that.setData({ merchantCategoryLoading: false });
      }
    });
  },

  _updateChapterRecruitConfig(index, patch) {
    const chapterIndex = Number(index);
    const chapters = (this.data.formData.chapters || []).slice();
    if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || !chapters[chapterIndex]) return;
    chapters[chapterIndex] = Object.assign({}, chapters[chapterIndex], patch);
    // 章节招商配置进 _buildValidationBag(errors key 以 chapterRecruit 开头),会改 canPublish ——
    // 不重算的话底栏按钮状态停在改之前那一版。
    this.setData({ 'formData.chapters': chapters }, () => this.updateAllStatistics());
  },

  onChapterRecruitToggle(e) {
    const enabled = !!(e.detail && e.detail.value);
    const index = e.currentTarget.dataset.index;
    const chapter = (this.data.formData.chapters || [])[Number(index)] || {};
    this._updateChapterRecruitConfig(index, {
      recruitEnabled: enabled ? 1 : 0,
      // 打开时补 V1 默认值；关闭时保留配置，重新打开无需重填。
      termsMode: chapter.termsMode === 'TRAFFIC' ? 'TRAFFIC' : 'PERK',
      perkMinValue: chapter.termsMode === 'TRAFFIC' ? null : chapter.perkMinValue,
      maxMerchant: Number.isInteger(Number(chapter.maxMerchant)) && Number(chapter.maxMerchant) >= 0
        ? Number(chapter.maxMerchant) : 0
    });
    if (enabled) this.loadMerchantCategories();
  },

  onChapterMerchantCategory(e) {
    const category = this.data.merchantCategoryList[Number(e.detail.value)];
    if (!category || category.id == null) return;
    this._updateChapterRecruitConfig(e.currentTarget.dataset.index, {
      categoryId: Number(category.id),
      category: category.categoryName || ''
    });
  },

  onChapterTermsMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode !== 'PERK' && mode !== 'TRAFFIC') return;
    const chapter = (this.data.formData.chapters || [])[Number(e.currentTarget.dataset.index)] || {};
    this._updateChapterRecruitConfig(e.currentTarget.dataset.index, {
      termsMode: mode,
      perkMinValue: mode === 'PERK' ? chapter.perkMinValue : null
    });
  },

  onChapterPerkMinValue(e) {
    let raw = String((e.detail && e.detail.value) || '').replace(/[^\d.]/g, '');
    const decimal = raw.indexOf('.');
    if (decimal >= 0) raw = raw.slice(0, decimal + 1) + raw.slice(decimal + 1).replace(/\./g, '');
    this._updateChapterRecruitConfig(e.currentTarget.dataset.index, {
      perkMinValue: raw === '' ? null : raw
    });
  },

  onChapterMaxMerchant(e) {
    const raw = String((e.detail && e.detail.value) || '').replace(/[^\d]/g, '');
    this._updateChapterRecruitConfig(e.currentTarget.dataset.index, {
      maxMerchant: raw === '' ? 0 : Number(raw)
    });
  },

  // 开放范围:是否开放给俱乐部承接(P0-4,俱乐部在合作池申请→商家发带条款邀约→接受成合作)

  // 加载我创建的俱乐部(达人多俱乐部:仅 owned[]),用于发布经典定向团时选归属
  loadMyClubs() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/club/my',
      method: 'POST',
      success(res) {
        if (res.code != '200' || !res.data) return;
        let owned = res.data.owned || [];
        if (owned && !Array.isArray(owned)) owned = [owned]; // 兼容单对象
        owned = owned.filter(c => c && (c.status === 1 || c.status === '1' || c.status == null));
        // 只取已通过(status=1)的俱乐部;单个则默认选中
        const patch = { myClubs: owned };
        const lockedId = that.data.formData.clubId;
        if (lockedId) {
          // 从俱乐部入口锁定:预选传入的归属俱乐部
          let lockedIdx = -1;
          for (let i = 0; i < owned.length; i++) {
            if (String(owned[i].id) === String(lockedId)) { lockedIdx = i; break; }
          }
          if (lockedIdx >= 0) patch.clubIndex = lockedIdx;
        } else if (owned.length === 1) {
          patch.clubIndex = 0;
          patch['formData.clubId'] = owned[0].id;
        }
        that.setData(patch, () => that.refreshPrimaryActionState());
      }
    });
  },

  // 选择归属俱乐部
  onClubChange(e) {
    const idx = Number(e.detail.value);
    const club = this.data.myClubs[idx];
    if (!club) return;
    this.setData({ clubIndex: idx, 'formData.clubId': club.id }, () => this.refreshPrimaryActionState());
  },
  // 章节名称输入框变化处理
  onNameChange(e) {
    this.setData({
      'formData.name': e.detail.value
    }, () => this.refreshPrimaryActionState());
  },
  // 章节名称输入框变化处理
  onChapterNameInputChange(e) {
    this.setData({
      'chapterForm.name': e.detail.value
    });
  },
  // 章节剧情:弹窗内唯一编辑入口(2026-08-10 从章节卡的页面内 textarea 迁来)
  onChapterDescInput(e) {
    this.setData({ 'chapterForm.description': e.detail.value });
  },

  onChapterAtmosphereSelect(e) {
    this.setData({ 'chapterForm.atmospherePreset': normalizeAtmosphere(e.currentTarget.dataset.value) });
  },
  // 章节描述输入框变化处理
  onChapterDescriptionInputChange(e) {
    this.setData({
      'chapterForm.description': e.detail.value
    });
  },

  onChapterRecruitToggleChange(e) {
    const enabled = !!(e.detail && e.detail.value);
    const form = this.data.chapterForm || {};
    this.setData({
      'chapterForm.recruitEnabled': enabled ? 1 : 0,
      'chapterForm.termsMode': form.termsMode === 'TRAFFIC' ? 'TRAFFIC' : 'PERK',
      'chapterForm.maxMerchant': Number.isInteger(Number(form.maxMerchant)) ? Number(form.maxMerchant) : 0,
    });
    if (enabled) this.loadMerchantCategories();
  },

  onChapterMerchantCategoryChange(e) {
    const category = this.data.merchantCategoryList[Number(e.detail.value)];
    if (!category || category.id == null) return;
    this.setData({
      'chapterForm.categoryId': Number(category.id),
      'chapterForm.category': category.categoryName || '',
    });
  },

  onChapterMaxMerchantInput(e) {
    const raw = String((e.detail && e.detail.value) || '').replace(/[^\d]/g, '');
    this.setData({ 'chapterForm.maxMerchant': raw === '' ? 0 : Number(raw) });
  },

  onChapterRequiredChange(e) {
    this.setData({ 'chapterForm.required': e.detail.value ? 1 : 0 });
  },

  onChapterTermsModeChange(e) {
    const termsMode = e.currentTarget.dataset.mode;
    if (termsMode !== 'PERK' && termsMode !== 'TRAFFIC') return;
    this.setData({
      'chapterForm.termsMode': termsMode,
      'chapterForm.perkMinValue': termsMode === 'PERK' ? this.data.chapterForm.perkMinValue : null
    });
  },

  /**
   * 玩法边界(2026-08-06 拍板):允许的验证方式 + 单节点探索值上限。
   *
   * ★这两项是**招商时公示、承接时冻结**的 —— 商家申请前就看得到,不是做完了才被告知超标。
   * 承接通过时冻进 offer(MerchantOfferServiceImpl.enroll),之后按冻结的那份校验,
   * 主办方事后改章节不会让已承接商家突然违规。
   *
   * 不填 = 不限。⚠️ 不限是**存量语义**,别为了"对称"给个默认值,那会把老章节一夜之间收紧。
   */
  onChapterValidationMethodToggle(e) {
    const v = String(e.currentTarget.dataset.v || '');
    const index = Number(e.currentTarget.dataset.index);
    if (!v) return;
    // ⚠️ 走 _updateChapterRecruitConfig(index, ...) 而不是 chapterForm ——
    // step3 那块渲染的是 formData.chapters 列表(wx:for 的 item),不是编辑弹窗的 chapterForm。
    // 写错对象的话:界面看着变了(其实没变),提交时带的还是旧值,且不报错。
    const chapter = (this.data.formData.chapters || [])[index] || {};
    const cur = String(chapter.allowedValidationMethods || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
    const i = cur.indexOf(v);
    if (i >= 0) cur.splice(i, 1); else cur.push(v);
    // 排序后再存:后端只做集合判断,但存成稳定顺序便于人肉核对与 diff
    cur.sort();
    this._updateChapterRecruitConfig(index, { allowedValidationMethods: cur.join(',') });
  },

  onChapterMaxNodeXpInput(e) {
    const raw = String((e.detail && e.detail.value) || '').replace(/[^\d]/g, '');
    this._updateChapterRecruitConfig(e.currentTarget.dataset.index, {
      maxNodeXp: raw === '' ? null : Number(raw)
    });
  },

  onChapterPerkMinValueInput(e) {
    let raw = String((e.detail && e.detail.value) || '').replace(/[^\d.]/g, '');
    const decimal = raw.indexOf('.');
    if (decimal >= 0) raw = raw.slice(0, decimal + 1) + raw.slice(decimal + 1).replace(/\./g, '');
    this.setData({ 'chapterForm.perkMinValue': raw === '' ? null : raw });
  },

  normalizeChapterMerchantConfig(chapter) {
    chapter.required = Number(chapter.required) === 0 ? 0 : 1;
    chapter.recruitEnabled = Number(chapter.recruitEnabled) === 1 ? 1 : 0;
    if (Number(this.data.formData.productType) !== 2 || chapter.recruitEnabled !== 1) return true;
    if (!(Number(chapter.categoryId) > 0)) {
      cyToast('请选择适合商家的招募品类');
      return false;
    }
    if (chapter.termsMode !== 'PERK' && chapter.termsMode !== 'TRAFFIC') {
      cyToast('请选择平台条款档');
      return false;
    }
    const maxMerchant = Number(chapter.maxMerchant);
    if (!Number.isInteger(maxMerchant) || maxMerchant < 0 || maxMerchant > 127) {
      cyToast('商家名额填 0 到 127 的整数');
      return false;
    }
    chapter.maxMerchant = maxMerchant;
    if (chapter.termsMode !== 'PERK') {
      chapter.perkMinValue = null;
      return true;
    }
    if (chapter.perkMinValue === '' || chapter.perkMinValue == null) {
      chapter.perkMinValue = null;
      return true;
    }
    const perkMinValue = Number(chapter.perkMinValue);
    if (!Number.isFinite(perkMinValue) || perkMinValue <= 0) {
      cyToast('权益门槛请输入大于0的金额');
      return false;
    }
    chapter.perkMinValue = perkMinValue;
    return true;
  },

  //章节弹框 完成 按钮
  confrimChapter(e) {
    var that = this
    let chapterAction = that.data.popChapterAction;
    let newChapter = {
      ...this.data.chapterForm
    };
    newChapter.atmospherePreset = normalizeAtmosphere(newChapter.atmospherePreset);
    if (!this.normalizeChapterMerchantConfig(newChapter)) {
      return false;
    }
    const cityStoryFlow = Number(this.data.formData.productType) === 1;

    if (chapterAction == 0) {
      // 如果用户没有修改名称，使用默认名称
      if (!newChapter.name || newChapter.name.trim() === '') {
        const currentChapterCount = this.data.formData.chapters.length;
        const nextChapterNumber = currentChapterCount + 1;
        newChapter.name = `第${nextChapterNumber}章`;
      }

      if (newChapter.name == '') {
        cyToast('请输入章节名称');
        return false
      }

      // 2026-08-10 删除「空剧情写暂无描述」:占位文案在库里和真实剧情长得一样,
      // 城市定向的剧情闸(没剧情不许建节点)会被它整个绕过。空值就保持空值。

      const pending = (this.data.pendingMaterials || []).slice();
      const pendingIndex = pending.findIndex(item => item._localId === this.data.assignPendingLocalId);
      if (this.data.assignPendingLocalId && pendingIndex < 0) {
        cyToast('待编排素材已不存在');
        return false;
      }
      if (pendingIndex >= 0 && !cityStoryFlow) {
        const issue = proEditorMaterials.arrangementIssue({
          productType: this.data.formData.productType,
          chapter: newChapter,
          material: pending[pendingIndex],
        });
        if (issue) {
          cyToast(issue.message);
          return false;
        }
        if (!this._canAddFormalNodes(1)) return false;
        newChapter.nodes = newChapter.nodes || [];
        newChapter.nodes.push(proEditorMaterials.nodeFromMaterial(pending[pendingIndex], 1));
        pending.splice(pendingIndex, 1);
      }
      newChapter._localId = newChapter._localId || this._genLocalId();
      newChapter.nodes = newChapter.nodes || [];
      if (cityStoryFlow) {
        newChapter.required = 1;
        newChapter.schemaVersion = 1;
        newChapter.blocks = [];
        newChapter.description = '';
      }
      this._pushUndo();
      let updatedChapters = [...this.data.formData.chapters, newChapter];
      const pendingStoryMaterial = cityStoryFlow ? this.data.assignPendingLocalId : '';
      this.destroyPreviewAudio(); // R9-36:完成新增=弹层关闭,正在播的本章旁白一起收
      this.setData({
        'formData.chapters': updatedChapters,
        pendingMaterials: pending,
        'popChapter': false,
        assignPendingLocalId: '',
        // 重置表单，但为下一个章节预填名称
        'chapterForm.name': `第${updatedChapters.length + 1}章`,
        'chapterForm.description': '',
        'chapterForm.imgArr': '',
        'chapterForm.nodes': [],
        'chapterForm.calculatedDistance': 0,
        'chapterForm.category': '',
        'chapterForm.categoryId': null,
        'chapterForm.recruitEnabled': 0,
        'chapterForm.termsMode': 'PERK',
        'chapterForm.perkMinValue': null,
        'chapterForm.maxMerchant': 0,
        'chapterForm.atmospherePreset': 'DEFAULT',
        'chapterForm.audioUrl': '',
        'chapterForm.audioDuration': 0,
        'chapterForm.audioFileName': ''
      }, () => {
        if (!cityStoryFlow) return;
        this.setData({ storyPendingMaterialLocalId: pendingStoryMaterial || '' });
        this.openStoryEditor({ currentTarget: { dataset: { index: updatedChapters.length - 1 } } });
      });
    } else {
      // 编辑现有章节的逻辑保持不变
      let chapterIndex = that.data.popChapterIndex;
      // 同上:不再用占位文案凑完成态
      let chapters = that.data.formData.chapters;
      this._pushUndo();
      chapters[chapterIndex] = newChapter
      this.destroyPreviewAudio(); // R9-36:完成编辑=弹层关闭,正在播的本章旁白一起收
      this.setData({
        'formData.chapters': chapters,
        'popChapter': false,
        assignPendingLocalId: '',
        // 重置表单
        'chapterForm.name': '',
        'chapterForm.description': '',
        'chapterForm.imgArr': '',
        'chapterForm.nodes': [],
        'chapterForm.calculatedDistance': 0,
        'chapterForm.category': '',
        'chapterForm.categoryId': null,
        'chapterForm.recruitEnabled': 0,
        'chapterForm.termsMode': 'PERK',
        'chapterForm.perkMinValue': null,
        'chapterForm.maxMerchant': 0,
        'chapterForm.atmospherePreset': 'DEFAULT',
        'chapterForm.audioUrl': '',
        'chapterForm.audioDuration': 0,
        'chapterForm.audioFileName': ''
      });
      // 从故事流「下一步」进来的:「完成」是整条编排的收尾,两层一起收。
      // 只收上层会把人丢回故事流,而他刚点过的正是"下一步"。
      if (this.data.chapterSettingsFromStory) {
        this.setData({ chapterSettingsFromStory: false });
        this.closeStoryEditor();
      }
    }

    this.updateAllStatistics();
  },

  // 故事流底栏「下一步」→ 编辑章节。与章节卡上的「编辑章节」是同一个弹窗,
  // 区别只在**从哪进来**(用户 2026-09-05 定):从这里进来是叠层(故事流留在下层),
  // 完成后两层一起收;从章节卡进来是单层,完成只收弹窗。
  // 叠不叠层不需要额外的层级机制 —— pop-model z-index=333 本来就压在 story-editor(240)之上,
  // 这里只是**不关故事流**而已;下层压暗由 .story-editor.is-stacked 负责。
  openChapterSettingsFromStory(e) {
    this.setData({ chapterSettingsFromStory: true });
    this.showEditChapter(e);
  },

  // 关闭章节弹框
  cancelChapter(e) {
    // R9-36:弹层里预听的是本章旁白,取消后弹层与播放入口一起消失,
    // 不停就会留一段在后台响。与 closeStoryEditor/openStoryEditor 同口径。
    this.destroyPreviewAudio();
    this.setData({
      popChapter: false,
      popChapterIndex: 0,
      assignPendingLocalId: '',
      chapterSettingsFromStory: false
    })
  },
  // 显示编辑节点弹框
  showEditNodes(e) {
    var that = this
    let chapterIndex = e.currentTarget.dataset.chapterindex;
    let nodeIndex = e.currentTarget.dataset.nodeindex;

    let chapter = that.data.formData.chapters[chapterIndex]
    let node = chapter['nodes'][nodeIndex]
    let nodesForm = Object.assign({}, node)
    // 玩法开关不入库,由 templateId 派生:绑过模板就是"开"。
    // 不派生的话,已配玩法的节点重开抽屉会显示成"关",看着像配置丢了。
    nodesForm.showTemplate = !!Number(node.templateId)
    this.setData({
      nodesForm: nodesForm,
      popChapterNodes: true,
      popChapterNodesAction: 1,
      nodeDraftDestination: 'formal',
      editingPendingLocalId: '',
      editTargetChapterLid: chapter._localId,
      editTargetNodeLid: node._localId,
      // 抽屉里的「文字说明」要跳二级页,而二级页按 index 定位,所以开抽屉时一并记下
      inlineEdit: { chapterIndex: Number(chapterIndex), nodeIndex: Number(nodeIndex) },
    })
  },
  // 点地图 pin → 用 _markerMap 反查打开该节点编辑(复用 showEditNodes 效果)
  onMarkerTap(e) {
    const markerId = (e.detail && e.detail.markerId != null) ? e.detail.markerId : e.markerId;
    const m = this._markerMap && this._markerMap[markerId];
    if (!m) return;
    if (m.pendingLocalId) {
      this.editPendingMaterial({ currentTarget: { dataset: { localid: m.pendingLocalId } } });
      return;
    }
    const chapters = this.data.formData.chapters || [];
    const ci = chapters.findIndex(c => c._localId === m.chapterLid);
    if (ci < 0) return;
    const node = (chapters[ci].nodes || []).find(n => n._localId === m.nodeLid);
    if (!node) return;
    if (Number(this.data.formData.productType) === 1) {
      this.openStoryEditor({ currentTarget: { dataset: { index: ci } } });
      cyToast('已定位到故事流，请点节点卡编辑');
      return;
    }
    this.setEditorState('editNode');
    this.setData({
      nodesForm: Object.assign({}, node),
      popChapterNodes: true,
      popChapterNodesAction: 1,
      editTargetChapterLid: m.chapterLid,
      editTargetNodeLid: m.nodeLid,
      selectedNodeLid: m.nodeLid, // 点 marker → 列表同步高亮
    });
    this.buildRouteMap();
  },
  // 点列表序号圈 → 仅定位+高亮(不打开编辑抽屉),并把地图中心移到该节点
  selectNode(e) {
    const { chapterindex, nodeindex } = e.currentTarget.dataset;
    const chapters = (this.data.formData && this.data.formData.chapters) || [];
    const chapter = chapters[chapterindex];
    if (!chapter) return;
    const node = (chapter.nodes || [])[nodeindex];
    if (!node) return;
    const lat = Number(node.latitude);
    const lng = Number(node.longitude);
    const patch = { selectedNodeLid: node._localId };
    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
      patch.mapCenter = { longitude: lng, latitude: lat };
      patch.mapScale = Math.max(this.data.mapScale, 16);
    }
    this.setData(patch);
    this.buildRouteMap();
  },
  //关闭节点编辑弹框
  cancelPopChapter(e) {
    this._rollbackNodeRouteEdit();
    this.setData({
      popChapterNodes: false,
      nodeSheetView: 'detail',
      editingPendingLocalId: '',
      nodeDraftDestination: 'formal',
      pendingInsertAt: null,
      'storyEditor.insertMenuAt': -1,
    })
  },
  // 显示添加节点弹框
  showAddNode(e) {
    let chapterIndex = e.currentTarget.dataset.chapterIndex;
    let chapter = this.data.formData.chapters[chapterIndex];
    if (!chapter) return;
    const issue = proEditorPolicy.formalNodeCreationIssue(this.data.formData, chapterIndex);
    if (issue) {
      cyToast(issue.message);
      return;
    }
    this.setData({
      popChapterNodes: true,
      popChapterNodesAction: 0,
      nodeSheetView: 'detail',
      nodeDraftDestination: 'formal',
      editingPendingLocalId: '',
      editTargetChapterLid: chapter._localId,
      editTargetNodeLid: '',
      inlineEdit: null,
      nodesForm: this._emptyNodesForm(),
    })
  },
  // 节点描述输入框变化处理
  onNodesDescriptionInputChange(e) {
    this.setData({
      'nodesForm.description': e.detail.value
    });
  },

  // 删除节点
  deleteNode(e) {
    if (Number(this.data.formData.productType) === 1 && this.data.storyEditor.show) {
      const chapter = (this.data.formData.chapters || [])[this.data.storyEditor.chapterIndex];
      const block = chapter && (chapter.blocks || []).find(item => {
        return item.type === 'node' && item.nodeKey === this.data.editTargetNodeLid;
      });
      if (block) {
        this.removeStoryNode({ currentTarget: { dataset: { blockkey: block.key } } });
        return;
      }
    }
    const chapters = JSON.parse(JSON.stringify(this.data.formData.chapters || []));
    const ci = chapters.findIndex(c => c._localId === this.data.editTargetChapterLid);
    if (ci < 0) {
      cyToast('未找到章节');
      return;
    }
    const nodes = chapters[ci].nodes || [];
    const ni = nodes.findIndex(n => n._localId === this.data.editTargetNodeLid);
    if (ni < 0) {
      cyToast('未找到节点');
      return;
    }
    modal.show({
      title: '确认删除',
      content: '节点会移到待编排区，5 秒内可以撤销。',
      success: (r) => {
        if (!r.confirm) return;
        const previousRouteNodes = this._routeNodes();
        const removed = nodes.splice(ni, 1)[0];
        const material = proEditorMaterials.materialFromNode(removed, 'node');
        chapters[ci].nodes = nodes;
        const pending = (this.data.pendingMaterials || [])
          .filter(item => item._localId !== material._localId)
          .concat([material]);
        this._appendPendingRemoval({
          kind: 'material',
          chapterLid: chapters[ci]._localId,
          nodeIndex: ni,
          material,
          node: removed,
        });
        if (this._pendingUndoTimer) clearTimeout(this._pendingUndoTimer);
        this.setData({
          'formData.chapters': chapters,
          pendingMaterials: pending,
          popChapterNodes: false,
          popChapterNodesAction: 0,
          pendingUndo: { show: true, materialLocalId: material._localId, text: '节点已移到待编排区' },
        });
        this._realignStoryRouteGraph(previousRouteNodes);
        this._pruneRouteGraphToCurrentNodes();
        this._commitNodeRouteEdit();
        this.updateAllStatistics();
        cyToast('已移到待编排区');
        this._pendingUndoTimer = setTimeout(() => {
          this._pendingUndoTimer = null;
          this._pendingUndoSnapshot = null;
          this.setData({ pendingUndo: { show: false, materialLocalId: '', text: '' } });
        }, 5000);
        if (this._pendingUndoTimer && typeof this._pendingUndoTimer.unref === 'function') {
          this._pendingUndoTimer.unref();
        }
      }
    });
  },

  undoPendingRemoval() {
    const snapshot = this._pendingUndoSnapshot;
    if (!snapshot) return;
    let removals = Array.isArray(snapshot.removals) ? snapshot.removals.slice() : [];
    if (!removals.length && Array.isArray(snapshot.storyRemovals)) {
      removals = snapshot.storyRemovals.map((item) => Object.assign({ kind: 'story' }, item));
    } else if (!removals.length && snapshot.block && snapshot.node) {
      removals = [Object.assign({ kind: 'story' }, snapshot)];
    } else if (!removals.length && snapshot.material) {
      removals = [Object.assign({ kind: 'material' }, snapshot)];
    }
    if (removals.length) {
      const chapterIds = new Set((this.data.formData.chapters || []).map((item) => item._localId));
      const pendingIds = new Set((this.data.pendingMaterials || []).map((item) => item._localId));
      const canRestore = removals.every((removal) => chapterIds.has(removal.chapterLid)
        && (removal.kind !== 'material'
          || (removal.material && pendingIds.has(removal.material._localId))));
      if (!canRestore) return;
      try {
        const restoredChapters = JSON.parse(JSON.stringify(this.data.formData.chapters || []));
        let restoredPending = JSON.parse(JSON.stringify(this.data.pendingMaterials || []));
        for (let index = removals.length - 1; index >= 0; index -= 1) {
          const removal = removals[index];
          if (removal.kind === 'material') {
            const chapter = restoredChapters.find((item) => item._localId === removal.chapterLid);
            const pendingIndex = restoredPending
              .findIndex((item) => item._localId === removal.material._localId);
            const insertAt = Math.max(0, Math.min((chapter.nodes || []).length, removal.nodeIndex));
            chapter.nodes = chapter.nodes || [];
            const restoredNode = removal.node
              ? JSON.parse(JSON.stringify(removal.node))
              : proEditorMaterials.nodeFromMaterial(removal.material, insertAt + 1);
            chapter.nodes.splice(insertAt, 0, restoredNode);
            chapter.nodes.forEach((node, nodeIndex) => { node.sortID = nodeIndex + 1; });
            restoredPending.splice(pendingIndex, 1);
          } else {
            const chapterIndex = restoredChapters
              .findIndex((item) => item._localId === removal.chapterLid);
            const result = proEditorStory.applyStoryCommand({
              chapter: restoredChapters[chapterIndex],
              pendingMaterials: restoredPending,
            }, {
              type: 'insertNodeAt',
              index: removal.blockIndex,
              blockKey: removal.block.key,
              node: removal.node,
            });
            restoredChapters[chapterIndex] = result.draft.chapter;
            restoredPending = result.draft.pendingMaterials;
          }
        }
        const restoredRoute = snapshot.route || {
          mode: this.data.formData.routeMode,
          json: this.data.formData.routeGraphJson,
          graph: this._routeGraph,
        };
        this._routeGraph = restoredRoute.graph;
        this.setData({
          'formData.chapters': restoredChapters,
          pendingMaterials: restoredPending,
          pendingUndo: { show: false, materialLocalId: '' },
          'formData.routeMode': restoredRoute.mode,
          'formData.routeGraphJson': restoredRoute.json,
        }, () => this.refreshRouteGraph());
      } catch (error) {
        if (this._pendingUndoTimer) clearTimeout(this._pendingUndoTimer);
        this._pendingUndoTimer = null;
        cyToast(app.getRequestErrorMessage(error, '撤销失败'));
        return;
      }
      if (this._pendingUndoTimer) clearTimeout(this._pendingUndoTimer);
      this._pendingUndoTimer = null;
      this._pendingUndoSnapshot = null;
      this.updateAllStatistics();
      cyToast.success('已撤销');
      return;
    }
  },
  // —— 节点重排:上移/下移(可靠兜底)+ movable-view 拖拽 ——
  // 行高常量(rpx):.item-box1 min-height 186 + .li margin-bottom 60(fabu 覆盖)≈ 246
  // 用于 movable-view bindchange/bindtouchend 把实时 y 折算成目标 index。
  // 定位全靠 _localId,重排后 buildRouteMap 经 _markerMap 自然跟随,不引 index 依赖。
  _reorderNode(chapterLid, nodeLid, dir) {
    let chapters = [...this.data.formData.chapters];
    let ci = chapters.findIndex(c => c._localId === chapterLid);
    if (ci < 0) return;
    let nodes = chapters[ci].nodes || [];
    let ni = nodes.findIndex(n => n._localId === nodeLid);
    if (ni < 0) return;
    let target = ni + dir;
    if (target < 0 || target >= nodes.length) return; // 首项禁上移、末项禁下移
    const previousRouteNodes = this._routeNodes();
    this._pushUndo();
    let tmp = nodes[ni];
    nodes[ni] = nodes[target];
    nodes[target] = tmp;
    nodes.forEach((n, idx) => { n.sortID = idx + 1; }); // 重算 sortID
    chapters[ci].nodes = nodes;
    this.setData({ 'formData.chapters': chapters });
    this._realignStoryRouteGraph(previousRouteNodes);
    this.updateAllStatistics(); // 末尾会重画地图
  },
  moveNodeUp(e) {
    const ds = e.currentTarget.dataset;
    this._reorderNode(ds.chapterlid, ds.nodelid, -1);
  },
  moveNodeDown(e) {
    const ds = e.currentTarget.dataset;
    this._reorderNode(ds.chapterlid, ds.nodelid, 1);
  },
  // —— movable-view 竖向拖拽重排(手柄门控,上下移按钮仍作兜底)——
  // 按住 .drag-handle 才进入拖拽态(dragNodeLid),其余行 disabled;松手折算 y→目标 index。
  onNodeDragStart(e) {
    this.setData({ dragNodeLid: e.currentTarget.dataset.nodelid });
  },
  onNodeDragChange(e) {
    if (e.detail.source === 'touch') this._dragY = e.detail.y; // 实例变量,拖拽中不 setData
  },
  onNodeDragEnd(e) {
    const ds = e.currentTarget.dataset;
    if (this._dragY == null) { this.setData({ dragNodeLid: '' }); this._resetDragOffsets(); return; }
    const chapters = (this.data.formData && this.data.formData.chapters) || [];
    const chapter = chapters.find(c => c._localId === ds.chapterlid);
    const maxIdx = chapter ? (chapter.nodes || []).length - 1 : 0;
    const toIdx = Math.max(0, Math.min(maxIdx, Math.round(this._dragY / this.data.rowHpx)));
    this._dragY = null;
    this._moveNodeToIndex(ds.chapterlid, ds.nodelid, toIdx);
    this.setData({ dragNodeLid: '' });
    this._resetDragOffsets();
  },

  // movable-view 只在 y 属性「变化」时才移动;拖回原位(toIdx===fromIdx)时行序没变、
  // y 算出来还是老值 —— 于是那一行就停在手指松开的地方不回弹。
  // 故意 nudge 1px 再收回,制造一次值变化把它拽回格子里。
  _resetDragOffsets() {
    this.setData({ dragNudge: 1 }, () => this.setData({ dragNudge: 0 }));
  },
  // 把节点移动到指定 index(_localId 定位,clamp,撤销快照,重算 sortID,重画地图)
  _moveNodeToIndex(chapterLid, nodeLid, toIdx) {
    let chapters = [...this.data.formData.chapters];
    let ci = chapters.findIndex(c => c._localId === chapterLid);
    if (ci < 0) return;
    let nodes = chapters[ci].nodes || [];
    let fromIdx = nodes.findIndex(n => n._localId === nodeLid);
    if (fromIdx < 0) return;
    toIdx = Math.max(0, Math.min(nodes.length - 1, toIdx));
    if (toIdx === fromIdx) return;
    const previousRouteNodes = this._routeNodes();
    this._pushUndo();
    let moved = nodes.splice(fromIdx, 1)[0];
    nodes.splice(toIdx, 0, moved);
    nodes.forEach((n, idx) => { n.sortID = idx + 1; }); // 重算 sortID
    chapters[ci].nodes = nodes;
    this.setData({ 'formData.chapters': chapters });
    this._realignStoryRouteGraph(previousRouteNodes);
    this.updateAllStatistics(); // 末尾重画地图;各行 y 经 nodeIndex*rowHpx 自然复位
  },
  // 添加节点
  confrimNode(e) {
    const nodesAction = this.data.popChapterNodesAction;
    const node = Object.assign({}, this.data.nodesForm);
    node.name = String(node.name || '').trim();
    if (!node.name) {
      cyToast('请填写节点名称');
      return;
    }
    node.nodeTime = Number(node.nodeTime || 30);

    const editingPending = this.data.editingPendingLocalId;
    const insertingStoryNode = Number(this.data.formData.productType) === 1
      && this.data.storyEditor.show
      && this.data.pendingInsertAt !== null;
    if ((this.data.nodeDraftDestination === 'pending' || editingPending) && !insertingStoryNode) {
      const existing = (this.data.pendingMaterials || []).find(item => item._localId === editingPending);
      const material = proEditorMaterials.materialFromNode(Object.assign({}, node, {
        _localId: editingPending || this._genLocalId(),
      }), existing && existing.kind === 'place' ? 'place' : 'node');
      this._savePendingMaterial(material, editingPending ? '素材已更新' : '已保存到待编排区');
      return;
    }

    const chapters = JSON.parse(JSON.stringify(this.data.formData.chapters || []));
    const chapterIndex = chapters.findIndex(chapter => chapter._localId === this.data.editTargetChapterLid);
    if (chapterIndex < 0) {
      cyToast('未找到章节');
      return;
    }
    const creationIssue = proEditorPolicy.formalNodeCreationIssue(this.data.formData, chapterIndex);
    if (creationIssue) {
      cyToast(creationIssue.message);
      return;
    }

    const currentNodes = chapters[chapterIndex].nodes || [];
    const nodeIndex = nodesAction === 1
      ? currentNodes.findIndex(item => item._localId === this.data.editTargetNodeLid) : -1;
    if (nodesAction === 1 && nodeIndex < 0) {
      cyToast('未找到节点');
      return;
    }
    node._localId = nodeIndex >= 0
      ? currentNodes[nodeIndex]._localId : (editingPending || this._genLocalId());

    // 没地点的内容草稿不能进入正式章节；保留为待编排素材，不伪造空坐标节点。
    if (!proEditorPolicy.hasUsableCoords(node)) {
      if (Number(this.data.formData.productType) === 1
          && this.data.storyEditor.show && nodeIndex >= 0) {
        const storyBlock = (chapters[chapterIndex].blocks || []).find(item => {
          return item && item.type === 'node' && item.nodeKey === node._localId;
        });
        if (!storyBlock) {
          cyToast('未找到节点块');
          return;
        }
        try {
          this._pushUndo();
          // ⚠️ removeNode 2026-08-11 起是【真删】,不再自己往待编排区放一份。
          // 所以"移到待编排区"这件事必须在这里显式做完 —— 否则这段 toast 说的话
          // 和实际发生的事对不上,节点直接没了。
          const material = proEditorMaterials.materialFromNode(node, 'node');
          const pending = (this.data.pendingMaterials || [])
            .filter(item => item._localId !== material._localId)
            .concat([material]);
          this._storyCommand({
            type: 'removeNode',
            blockKey: storyBlock.key,
            node,
          }, {
            pendingMaterials: pending,
            popChapterNodes: false,
            popChapterNodesAction: 0,
            editingPendingLocalId: '',
            nodeDraftDestination: 'formal',
            pendingInsertAt: null,
            storyPendingMaterialLocalId: '',
            nodesForm: this._emptyNodesForm(),
          });
          cyToast('地点待补，已移到待编排区');
        } catch (error) {
          cyToast(app.getRequestErrorMessage(error, '移动节点失败'));
        }
        return;
      }
      const material = proEditorMaterials.materialFromNode(node, 'node');
      const pending = (this.data.pendingMaterials || []).filter(item => item._localId !== material._localId);
      pending.push(material);
      if (nodeIndex >= 0) currentNodes.splice(nodeIndex, 1);
      chapters[chapterIndex].nodes = currentNodes;
      this.setData({
        'formData.chapters': chapters,
        pendingMaterials: pending,
        popChapterNodes: false,
        popChapterNodesAction: 0,
        editingPendingLocalId: '',
        nodeDraftDestination: 'formal',
        pendingInsertAt: null,
        storyPendingMaterialLocalId: '',
        nodesForm: this._emptyNodesForm(),
      });
      this.updateAllStatistics();
      cyToast('地点待补，已移到待编排区');
      return;
    }

    if (nodesAction === 0) {
      // 新建与待编排转正必须共用同一配额闸，避免先堆 pending 再归章绕过 Lite 上限。
      if (!this._canAddFormalNodes(1)) return;
    }

    if (insertingStoryNode && nodesAction === 0) {
      try {
        this._pushUndo();
        this._storyCommand({
          type: 'insertNodeAt',
          index: this.data.pendingInsertAt,
          blockKey: this._genLocalId(),
          node,
        }, {
          popChapterNodes: false,
          popChapterNodesAction: 0,
          editingPendingLocalId: '',
          nodeDraftDestination: 'formal',
          pendingInsertAt: null,
          storyPendingMaterialLocalId: '',
          nodesForm: this._emptyNodesForm(),
          selectedNodeLid: node._localId,
        });
        cyToast.success('已插入故事流');
      } catch (error) {
        cyToast(app.getRequestErrorMessage(error, '插入节点失败'));
      }
      return;
    }

    if (Number(this.data.formData.productType) === 1
        && this.data.storyEditor.show && nodeIndex >= 0) {
      try {
        this._pushUndo();
        this._storyCommand({ type: 'editNode', node }, {
          popChapterNodes: false,
          popChapterNodesAction: 0,
          editingPendingLocalId: '',
          nodeDraftDestination: 'formal',
          nodesForm: this._emptyNodesForm(),
          selectedNodeLid: node._localId,
        });
        this._commitNodeRouteEdit();
        cyToast.success('节点已更新');
      } catch (error) {
        cyToast(app.getRequestErrorMessage(error, '更新节点失败'));
      }
      return;
    }

    this._pushUndo();
    if (nodeIndex >= 0) currentNodes[nodeIndex] = node;
    else currentNodes.push(Object.assign(node, { sortID: currentNodes.length + 1 }));
    chapters[chapterIndex].nodes = currentNodes;
    if (Number(this.data.formData.productType) === 1) {
      chapters[chapterIndex] = proEditorStory.materializeChapter(
        chapters[chapterIndex], () => this._genLocalId());
    }
    this.setData({
      'formData.chapters': chapters,
      popChapterNodes: false,
      popChapterNodesAction: 0,
      editingPendingLocalId: '',
      nodeDraftDestination: 'formal',
      nodesForm: this._emptyNodesForm(),
      selectedNodeLid: node._localId,
    });
    this._commitNodeRouteEdit();
    this.updateAllStatistics();
    cyToast.success(nodesAction === 0 ? '已添加到路线' : '节点已更新');
  },

  // —— 撤销栈 —— (栈放实例变量 this._undoStack,不进 data 避免渲染开销)
  // 结构性变更前调:formData 与待编排区必须进同一快照，否则“素材归章→撤销”会丢素材。
  _pushUndo() {
    if (!this._undoStack) this._undoStack = [];
    this._undoStack.push(JSON.parse(JSON.stringify({
      formData: this.data.formData,
      pendingMaterials: this.data.pendingMaterials || [],
      routeGraph: this._routeGraph,
    })));
    if (this._undoStack.length > UNDO_CAP) this._undoStack.shift();
    this.setData({ canUndo: this._undoStack.length > 0 });
  },
  // 撤销:恢复完整编辑快照并重画地图与统计
  undo() {
    if (!this._undoStack || this._undoStack.length === 0) return;
    const snapshot = this._undoStack.pop();
    this._routeGraph = snapshot.routeGraph || topicRouteGraph.emptyGraph();
    this.setData({
      formData: snapshot.formData,
      pendingMaterials: snapshot.pendingMaterials || [],
      // 快照整体覆盖 formData,imgArrList 是它的派生视图,必须跟着回滚
      imgArrList: this._parseImgArr(snapshot.formData.imgArr),
      canUndo: this._undoStack.length > 0
    });
    this.updateAllStatistics();
  },

  // 生成前端态主键(仅前端用,提交时剥离)
  _genLocalId() { return 'lid' + (this._lidSeq = (this._lidSeq || 0) + 1); },

  // 为章节、节点与待编排素材补齐 _localId；先扫描已恢复 ID 推进序号，避免重开后复用 lid1。
  _ensureLocalIds() {
    const chapters = this.data.formData.chapters || [];
    const pendingMaterials = this.data.pendingMaterials || [];
    let maxSeq = this._lidSeq || 0;
    const scan = (item) => {
      const match = item && /^lid(\d+)$/.exec(String(item._localId || item.key || ''));
      if (match) maxSeq = Math.max(maxSeq, Number(match[1]));
    };
    chapters.forEach(chapter => {
      scan(chapter);
      (chapter.nodes || []).forEach(scan);
      (chapter.blocks || []).forEach(scan);
    });
    pendingMaterials.forEach(scan);
    this._lidSeq = maxSeq;
    chapters.forEach(chapter => {
      if (!chapter._localId) chapter._localId = this._genLocalId();
      (chapter.nodes || []).forEach(node => {
        if (!node._localId) node._localId = this._genLocalId();
      });
    });
    pendingMaterials.forEach(material => {
      if (!material._localId) material._localId = this._genLocalId();
    });
    this.setData({ 'formData.chapters': chapters, pendingMaterials });
  },

  // 返回去掉所有 '_' 开头键的浅拷贝(提交时剥离前端态字段)
  _stripLocalFields(obj) {
    let res = {};
    Object.keys(obj).forEach(key => {
      if (key.charAt(0) !== '_') res[key] = obj[key];
    });
    return res;
  },

  // 设置默认日期
  setDefaultDates() {
    if (this.data.formData.startDate && this.data.formData.endDate) {
      return;
    }

    let today = new Date();
    let tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let formatDate = (date) => {
      return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
    };

    this.setData({
      startdate: formatDate(today),
      enddate: formatDate(tomorrow),
      'formData.startDate': formatDate(today),
      'formData.endDate': formatDate(tomorrow)
    });
  },
  // 输入框变化处理
  onInputChange(e) {
    let {
      field
    } = e.currentTarget.dataset;
    this.setData({
      [`formData.${field}`]: e.detail.value
    });
  },

  // 路线介绍输入处理
  onIntroductionChange: function (e) {
    const value = e.detail.value;
    this.setData({
      'formData.description': value
    }, () => this.refreshPrimaryActionState());
  },

  // 两页切换。两页都可直达 —— 没有「必须填完第 1 页」的门控,
  // 因为三种创作起点想先做的事不同,强加顺序总会别扭其中一种。
  switchEditorPage(e) {
    const page = Number(e.currentTarget.dataset.page) === 2 ? 2 : 1;
    if (page === this.data.editorPage) return;
    this.setData({ editorPage: page }, () => this._scrollSheetTo('sheetTop'));
  },


  // 2026-09-05 用户裁决:删掉 previewTopic()。它跳的是玩家端主题详情页,读【服务端已保存
  // 那一版】—— 编辑器里刚写的改动不在里面;新建主题没有 editingTopicId 时更是点了不动,
  // 只弹一句 toast。底部药丸改成真正推进流程的「发布 →」(submitForm)。
  // ⚠️ 以后要补回「发布前看成品」,走**本地草稿预览**(主题详情页加 preview 入参 + 一条
  // 本地数据源分支),不要再把按钮接回 ?id= —— 那条路读的永远是服务端那一版。

  openTopicDetail() { this.setData({ topicDetailShow: true }); },
  closeTopicDetail() { this.setData({ topicDetailShow: false }); },

  // 列表 ↔ 地图 视图切换(左下角药丸)。
  // 地图挂在 wx:if 上,切走会连 markers/polyline 一起销毁,所以切回来必须重画一次,
  // 否则是一张没有路线的空地图。
  switchViewMode(e) {
    const mode = e.currentTarget.dataset.mode === 'map' ? 'map' : 'list';
    if (mode === this.data.viewMode) return;
    this.setData({ viewMode: mode }, () => {
      if (mode === 'map') this.buildRouteMap();
    });
  },

  // 节点坐标是否可用。三处口径原本各写各的(下一步闸 ≥1 / 完整度 ≥2 / validateForm 压根不查),
  // 收敛成这一个判据:没坐标的节点在地图上不存在、玩家走不到,发布前必须全部补齐。
  nodesMissingCoords(chapters) {
    const bad = [];
    (chapters || []).forEach((chapter, ci) => {
      (chapter.nodes || []).forEach((node, ni) => {
        const lng = node && node.longitude;
        const lat = node && node.latitude;
        if (!lng || !lat || lng === '0' || lat === '0') {
          bad.push({ chapterIndex: ci, nodeIndex: ni, chapterName: (chapter && chapter.name) || ('第' + (ci + 1) + '章') });
        }
      });
    });
    return bad;
  },

  _scrollSheetTo(anchorId) {
    this.setData({ scrollIntoView: '' });
    if (!anchorId) return;
    setTimeout(() => {
      this.setData({ scrollIntoView: anchorId });
      setTimeout(() => {
        this.setData({ scrollIntoView: '' });
      }, 500);
    }, 220);
  },

  _anchorForErrorKey(key) {
    // CU-C-160 负控:认不出来就返回空锚点。原来末尾一把 `return 'ticketSection'` 兜底,
    // 等于任何缺项(包括页面上根本没有的那一条)都能「切到票务 + 滚到档区」—— 屏幕动了、
    // 层也开了,看着像定位成功,实际那一格并不在那儿。空锚点是各处的「不动」信号。
    if (!key) return '';
    if (key.indexOf('ticket') === 0) return 'ticketSection';
    if (key === 'name') return 'fieldName';
    if (key === 'description') return 'fieldDescription';
    if (key === 'startDate' || key === 'endDate') return 'fieldDates';
    if (key === 'recruitDeadline') return 'fieldRecruitDeadline';
    // 通关规则(必达数)在主题详情弹窗里,不在票务页 —— 漏这一条会掉到末尾的 ticketSection,
    // 「去填写」把人带去档期/票单,而他要改的那一格在另一层。
    if (key === 'completionRule') return 'fieldCompletionRule';
    if (key === 'imgUrl') return 'fieldVisual';
    if (key === 'categoryIds') return 'fieldCategory';
    if (key === 'pendingMaterials') return 'pendingMaterialsSection';
    if (key === 'routeGraph') return 'routeSection';
    if (key.indexOf('chapterRecruit') === 0) return 'chapterRecruitSection';
    if (key.indexOf('chapter') === 0 || key === 'chapters') return 'routeSection';
    // CU-C-160 负控:认不出的字段返回空锚点,而不是兜到 ticketSection。
    // 兜底等于「页面上根本没有的缺项」也能切屏 + 滚档区 —— 看着像定位成功,那一格却不在那儿。
    // 空锚点是 focusValidationError / _scrollSheetTo 共用的「不动」信号。
    return '';
  },

  // 票务信息变化处理
  onTicketChange(e) {
    let {
      field,
      index
    } = e.currentTarget.dataset;
    let value = e.detail.value;

    // 价格和库存需要转换为数字
    if (field === 'price' || field === 'totalStock') {
      value = value === '' ? 0 : Number(value);
      // 确保不为负数
      value = Math.max(0, value);
    }

    this.setData({
      [`formData.tickets[${index}].${field}`]: value
    }, () => this.refreshPrimaryActionState());
  },

  onTicketModeChange(e) {
    const { index, mode } = e.currentTarget.dataset;
    const newMode = Number(mode);
    let tickets = [...this.data.formData.tickets];
    if (newMode === 1) {
      tickets[index] = { ...tickets[index], mode: 1, startTime: '', endTime: '' };
    } else {
      tickets[index] = { ...tickets[index], mode: 2, meetingPoint: '', teamSize: 0 };
    }
    this.setData({ 'formData.tickets': tickets }, () => this.refreshPrimaryActionState());
  },

  // 票务信息变化处理
  onTicketNumChange(e) {
    let {
      field,
      index
    } = e.currentTarget.dataset;
    let value = e.detail.value;

    if (field === 'totalStock' || field === 'teamSize') {
      value = value === '' ? 0 : Number(value);
      value = Math.max(0, value);
    }

    this.setData({
      [`formData.tickets[${index}].${field}`]: value
    }, () => this.refreshPrimaryActionState());
  },

  // 日期选择
  bindDateChange(e) {
    let value = e.detail.value;
    this.setData({
      startdate: value,
      'formData.startDate': value
    });

    // 更新票务时间
    this.updateTicketTimes(value, this.data.enddate);
  },

  bindDateChange2(e) {
    let value = e.detail.value;
    this.setData({
      enddate: value,
      'formData.endDate': (() => { const d = new Date(value + 'T00:00:00+08:00'); d.setHours(23, 59, 59, 999); return d.toISOString(); })()
    });

    // 更新票务时间
    this.updateTicketTimes(this.data.startdate, value);
  },

  // 更新票务时间
  updateTicketTimes(startDate, endDate) {
    let tickets = this.data.formData.tickets.map(ticket => ({
      ...ticket,
      startTime: startDate,
      endTime: endDate
    }));

    this.setData({
      'formData.tickets': tickets
    });
  },

  // 上传节点照片(抽屉内,多张,存逗号分隔 CSV)
  uploadAddressPic() {
    let that = this;
    const cur = that.data.nodesForm.imgUrl ? that.data.nodesForm.imgUrl.split(',').filter(Boolean) : [];
    const remain = 9 - cur.length;
    if (remain <= 0) { cyToast('每个节点最多9张'); return; }
    app.chooseImage(function (res) {
      const next = cur.concat(res).slice(0, 9);
      that.setData({ 'nodesForm.imgUrl': next.join(',') });
    }, remain, { crop: true, cropScale: NODE_PHOTO_RATIO });
  },
  // 删除节点照片(抽屉内,按索引)
  removeNodePhoto(e) {
    const i = Number(e.currentTarget.dataset.imgindex);
    const arr = this.data.nodesForm.imgUrl ? this.data.nodesForm.imgUrl.split(',').filter(Boolean) : [];
    if (i < 0 || i >= arr.length) return;
    arr.splice(i, 1);
    this.setData({ 'nodesForm.imgUrl': arr.join(',') });
  },

  // 上传 step3「竖版封面」的必填封面(字段 imgUrl)
  // 主消费面是 topic 详情首屏 .slide1(height:100vh 全屏 hero),3:4 竖图在竖屏下最贴合。
  // ⚠️ imgUrl 是跨实体复用的字段名:template 首页的 .feat-media / .cml-pic 消费的是
  //    CmsTemplateLibrary(玩法模板,publish/temp 裁 16:9),与本字段无关,改比例时别顺手动它们。
  uploadBanner() {
    let that = this;
    app.chooseImage(function (res) {
      that.setData({
        'formData.imgUrl': res[0]
      }, () => that.refreshPrimaryActionState());
    }, 1, { crop: true, cropScale: '3:4' });
  },

  // ===== 章节音频(2026-09-04 拍板:一章最多一段,挂在章节上而不是故事流的块里)=====
  // ⚠️ 这三个方法原来写的是主题级 formData.audioUrl,但 fabu 里从来没有任何 WXML 绑定它们
  //    (ui-integrity 把 onPreviewAudio 记成零绑定债务)。这次改挂 chapterForm ——
  //    主题级 audioUrl 已按 2026-09-15 拍板清理(小程序不再读写;后端字段保留,存量数据不受影响)。
  uploadChapterAudio() {
    var that = this;
    app.chooseDocument(function (res) {
      if (res && res[0] && res[0].url) {
        var file = res[0];
        that.setData({
          'chapterForm.audioUrl': file.url,
          'chapterForm.audioFileName': file.filename || ''
        });
        // 自动识别时长
        that.autoDetectAudioDuration(file.url);
      }
    }, 1, ['mp3', 'm4a', 'aac']);
  },

  autoDetectAudioDuration(url) {
    var that = this;
    var audio = wx.createInnerAudioContext();
    audio.src = url;
    audio.obeyMuteSwitch = false;
    audio.onCanplay(function () {
      var d = Math.round(audio.duration || 0);
      if (d > 0) that.setData({ 'chapterForm.audioDuration': d });
      audio.destroy();
    });
    audio.onError(function () { audio.destroy(); });
  },

  clearChapterAudio() {
    this.destroyPreviewAudio();
    this.setData({
      'chapterForm.audioUrl': '', 'chapterForm.audioDuration': 0,
      'chapterForm.audioFileName': ''
    });
  },

  // 来源与URL都一致才复用：同址不同来源须换监听器，同来源替换文件也须重建。
  onPreviewChapterAudio() {
    var that = this;
    var url = this.data.chapterForm.audioUrl;
    if (!url) return;
    var source = this._previewSource;
    if (this._previewAudio && source && source.kind === 'chapter' && this._previewAudio.src === url) {
      if (this.data.audioPreviewPlaying) {
        this._previewAudio.pause();
      } else {
        this._previewAudio.play();
      }
      return;
    }
    this.destroyPreviewAudio();
    var audio = wx.createInnerAudioContext();
    audio.src = url;
    audio.obeyMuteSwitch = false;
    this._previewSource = { kind: 'chapter' };
    this._previewAudio = audio;
    // 回调先认「还是当前这个播放器」:被换掉/销毁后迟到的回调必须弃权。
    audio.onPlay(function () { if (that._previewAudio !== audio) return; that.setData({ audioPreviewPlaying: true }); });
    audio.onPause(function () { if (that._previewAudio !== audio) return; that.setData({ audioPreviewPlaying: false }); });
    audio.onStop(function () { if (that._previewAudio !== audio) return; that.setData({ audioPreviewPlaying: false }); });
    audio.onEnded(function () { if (that._previewAudio !== audio) return; that.setData({ audioPreviewPlaying: false }); });
    audio.onError(function (err) {
      if (that._previewAudio !== audio) return;
      that.setData({ audioPreviewPlaying: false });
      cyToast(app.getRequestErrorMessage(err, '预听失败'));
    });
    audio.play();
  },

  // 故事流音频块预听:与章节旁白共用同一个 InnerAudioContext(_previewAudio),
  // 所以两者天然互斥 —— 谁后起播谁把对方顶掉,不会两段一起响。
  // ⚠️ 空 url 的块不建播放器:那是还没选文件的占位,点它走上传(uploadStoryAudio),不是预听。
  onPreviewStoryAudio(e) {
    const blockKey = e.currentTarget.dataset.blockkey;
    const chapterIndex = this.data.storyEditor.chapterIndex;
    const chapter = (this.data.formData.chapters || [])[chapterIndex];
    const block = ((chapter && chapter.blocks) || []).filter((b) => b && b.type === 'audio' && b.key === blockKey)[0];
    const url = block && block.url;
    if (!url) return;
    // 同一块再点 = 暂停/继续,不另起播放器。按来源身份判,不只比 URL。
    const source = this._previewSource;
    if (this._previewAudio && source && source.kind === 'story' && source.key === blockKey && this._previewAudio.src === url) {
      if (this.data.storyAudioPlaying) this._previewAudio.pause();
      else this._previewAudio.play();
      return;
    }
    this.destroyPreviewAudio();
    const that = this;
    const audio = wx.createInnerAudioContext();
    audio.src = url;
    audio.obeyMuteSwitch = false;
    // ★ 有效来源身份在**建播放器时**登记(不等 onPlay):网络缓冲期删这块时
    //   removeStoryMedia 要能匹配到并 destroy,否则缓冲完还会响(F14 P2)。
    this._previewSource = { kind: 'story', key: blockKey };
    this._previewAudio = audio;
    audio.onPlay(function () { if (that._previewAudio !== audio) return; that.setData({ storyAudioPlaying: true, storyAudioKey: blockKey }); });
    audio.onPause(function () { if (that._previewAudio !== audio) return; that.setData({ storyAudioPlaying: false }); });
    audio.onStop(function () { if (that._previewAudio !== audio) return; that.setData({ storyAudioPlaying: false }); });
    audio.onEnded(function () { if (that._previewAudio !== audio) return; that.setData({ storyAudioPlaying: false, storyAudioKey: '' }); });
    audio.onError(function (err) {
      if (that._previewAudio !== audio) return;
      that.setData({ storyAudioPlaying: false, storyAudioKey: '' });
      cyToast(app.getRequestErrorMessage(err, '预听失败'));
    });
    audio.play();
  },

  destroyPreviewAudio() {
    if (this._previewAudio) {
      try { this._previewAudio.destroy(); } catch (e) {}
      this._previewAudio = null;
    }
    this._previewSource = null;
    if (this.data.audioPreviewPlaying || this.data.storyAudioPlaying || this.data.storyAudioKey) {
      this.setData({ audioPreviewPlaying: false, storyAudioPlaying: false, storyAudioKey: '' });
    }
  },

  // formData.imgArr(CSV)与 imgArrList(数组)的唯一写入口,别绕过它单独 setData 其中一个
  _setImgArr(list) {
    const arr = (list || []).filter(Boolean).slice(0, IMG_ARR_MAX);
    this.setData({ 'formData.imgArr': arr.join(','), imgArrList: arr });
  },

  // 读 CSV。逗号是本字段约定,但首页 feed 的 decorateImgs 历史上按 ';' 拆,
  // 故两种分隔符都吃,免得存量/别处写进来的串在这里被当成单个坏 URL
  _parseImgArr(csv) {
    return String(csv || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
  },

  // 上传横版封面(step3「横版封面」画廊):多张 16:9,消费面是 topic/index 顶部轮播
  uploadImgArr() {
    let that = this;
    const remain = IMG_ARR_MAX - this.data.imgArrList.length;
    if (remain <= 0) { cyToast('最多' + IMG_ARR_MAX + '张'); return; }
    app.chooseImage(function (res) {
      if (res && res.length) {
        that._setImgArr(that.data.imgArrList.concat(res));
      }
    }, remain, { crop: true, cropScale: '16:9' });
  },

  removeImgArr(e) {
    const i = e.currentTarget.dataset.i;
    const arr = this.data.imgArrList.slice();
    arr.splice(i, 1);
    this._setImgArr(arr);
  },

  // 上传横版图片
  uploadHorizontalImage() {
    let that = this;
    app.chooseImage(function (res) {
      that.setData({
        horizontalImage: res[0]
      });
    }, 1, { crop: true, cropScale: '16:9' });
  },

  getUserData: function () {
    let that = this;
    if (app.getUserID() && !that._localDraftRestored) {
      that.setData({
        'formData.collaboratorList': [{
          name: app.getNickname(),
          nickname: app.getNickname(),
          avatar: app.getAvatar(),
          id: app.getUserID(),
          isOwner: 1
        }],
        'formData.collaboratorIds': [app.getUserID()]
      });
    }
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      data: {
        member_id: app.getUserID()
      },
      method: "POST",
      success: function (res) {
        if (res && res.code == "200" && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          let userData = {
            name: res.data.nickname,
            nickname: res.data.nickname,
            avatar: res.data.avatar,
            id: res.data.id,
            isOwner: 1
          }

          let collaboratorList = [];
          let collaboratorIds = [];

          collaboratorList = [...collaboratorList, userData];
          collaboratorIds = [...collaboratorIds, userData.id];

          const patch = {
            draftMemberId: that.data.draftMemberId || userData.id
          };
          // 完整本地信封里可能有多位合作者；恢复后这里只刷新当前用户展示信息，
          // 不能把已恢复列表重置成 owner 一人并立刻覆盖保存。
          if (!that._localDraftRestored) {
            patch['formData.collaboratorList'] = collaboratorList;
            patch['formData.collaboratorIds'] = collaboratorIds;
          }
          that.setData(patch, () => {
            // 编辑既有主题时必须等 edit-detail 回填完并打开 autosave 闸，
            // 否则用户资料请求先返回会把空表单写成该 topic 的本地草稿。
            if (that._draftAutosaveReady) that._persistDraftEnvelope();
          })
          cyLoading.hide();
        }
      },
      fail: function (res) {
      }
    })
  },
  // 显示分类选择弹窗
  showCategoryModal() {
    this.setData({
      showCategoryModal: true
    });
  },

  // 隐藏分类选择弹窗
  hideCategoryModal() {
    this.setData({
      showCategoryModal: false
    });
  },
  // 切换分类选择
  toggleCategorySelect(e) {
    let categoryId = e.currentTarget.dataset.id;
    let categoryName = e.currentTarget.dataset.name;
    let selectedIds = [...this.data.selectedCategoryIds];
    let selectedNames = [...this.data.selectedCategoryNames];

    let index = selectedIds.indexOf(categoryId);
    if (index > -1) {
      selectedIds.splice(index, 1);
      selectedNames.splice(index, 1);
    } else {
      selectedIds.push(categoryId);
      selectedNames.push(categoryName);
    }

    this.setData({
      selectedCategoryIds: selectedIds,
      selectedCategoryNames: selectedNames
    });
  },

  // 确认分类选择
  confirmCategorySelect() {
    this.setData({
      showCategoryModal: false,
      'formData.categoryIds': this.data.selectedCategoryIds
    });
  },

  // 移除分类
  removeCategory(e) {
    let index = e.currentTarget.dataset.index;
    let selectedIds = [...this.data.selectedCategoryIds];
    let selectedNames = [...this.data.selectedCategoryNames];

    selectedIds.splice(index, 1);
    selectedNames.splice(index, 1);

    this.setData({
      selectedCategoryIds: selectedIds,
      selectedCategoryNames: selectedNames,
      'formData.categoryIds': selectedIds
    });
  },

  // 添加票单
  // 打开票种编辑器（index=-1 表示新建）
  openTicketEditor(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index >= 0) {
      const ticket = this.data.formData.tickets[index];
      this.setData({
        showTicketEditor: true,
        editingTicket: {
          editIndex: index,
          id: ticket.id,
          name: ticket.name || '',
          price: ticket.price || 0,
          totalStock: ticket.totalStock || 100,
          mode: this.data.formData.productType || 1,
          meetingPoint: ticket.meetingPoint || '',
          meetingPointAddress: ticket.meetingPointAddress || '',
          meetingPointLongitude: ticket.meetingPointLongitude || '',
          meetingPointLatitude: ticket.meetingPointLatitude || '',
          teamSize: ticket.teamSize || 0,
          startTime: ticket.startTime || '',
          endTime: ticket.endTime || '',
          saleStartTime: ticket.saleStartTime || '',
          saleEndTime: ticket.saleEndTime || '',
          description: ticket.description || '',
          refundSupported: ticket.refundSupported !== false,
          syncWithTheme: ticket.syncWithTheme || false
        }
      }, () => this.refreshTicketSaveState());
    } else {
      this.setData({
        showTicketEditor: true,
        editingTicket: {
          editIndex: -1,
          name: '',
          price: 0,
          totalStock: 100,
          // [P0-02] 新票跟主题走,不硬编码 1 —— 这是活的混票源:从自由定向入口进来再加一张票,
          // saveTicket 会把这张 mode=1 的票推进列表 ⇒ 混票主题当场产生。
          mode: this.data.formData.productType || 1,
          meetingPoint: '',
          meetingPointAddress: '',
          meetingPointLongitude: '',
          meetingPointLatitude: '',
          teamSize: 0,
          startTime: '',
          endTime: '',
          saleStartTime: '',
          saleEndTime: '',
          description: '',
          refundSupported: true,
          syncWithTheme: false
        }
      }, () => this.refreshTicketSaveState());
    }
  },

  closeTicketEditor() {
    this.setData({ showTicketEditor: false, canSaveTicket: false });
  },

  refreshTicketSaveState() {
    const canSaveTicket = !this._ticketBlockReason(this.data.editingTicket);
    if (canSaveTicket !== this.data.canSaveTicket) this.setData({ canSaveTicket });
  },

  // 一张票填没填全的唯一判据(保存票种的可用态、发布确认页的「已配置 N 种票单」都用它)。
  // CU-C-168:之前「已配置」只数数组长度,一张集合时间/地点全空的默认票既能以缺项身份
  // 出现在「还差什么」里,又能同时被算进「自动检查已通过」—— 同一张空票既红又绿。
  _ticketBlockReason(ticket) {
    const et = ticket || {};
    if (!(et.name || '').trim()) return '请填写票种名称';
    const issue = cityOrientationScheduleIssues(et)[0];
    if (issue) return issue.message;
    if (Number(et.mode) === 1 && !nonEmpty(et.meetingPoint)) return '请选择集合地点';
    return '';
  },

  // 票种保存的第一条拦截原因(与 refreshTicketSaveState 的可用态同一套判据)。
  _ticketSaveBlockReason() {
    return this._ticketBlockReason(this.data.editingTicket);
  },

  // 置灰的「保存票种」被点 → 报同一条原因,别静默按不动。
  onSaveTicketDisabledTap() {
    const reason = this._ticketSaveBlockReason();
    if (reason) cyToast(reason);
  },

  // 保存票种（新增 or 覆盖）
  saveTicket() {
    if (!this.data.canSaveTicket) return;
    const et = this.data.editingTicket;
    const blocked = this._ticketSaveBlockReason();
    if (blocked) {
      cyToast(blocked);
      return;
    }
    const ticketData = {
      name: et.name,
      price: Number(et.price) || 0,
      totalStock: Number(et.totalStock) || 100,
      mode: this.data.formData.productType || 1,
      meetingPoint: et.meetingPoint,
      meetingPointAddress: et.meetingPointAddress,
      meetingPointLongitude: et.meetingPointLongitude,
      meetingPointLatitude: et.meetingPointLatitude,
      // 集合点经纬度落库:后端 OmsTicket 只有 gather_lng/gather_lat(无 meeting_point_longitude 列),
      // 故 meetingPointLongitude/Latitude 发出去会丢;这里以数字形式补 gatherLng/gatherLat(空则 null)。
      gatherLng: et.meetingPointLongitude ? Number(et.meetingPointLongitude) : null,
      gatherLat: et.meetingPointLatitude ? Number(et.meetingPointLatitude) : null,
      // 成团已下线(2026-07-15):不再派生 minPeople / signupDeadline / refundRule。
      // teamSize 保留(恒 0)以免连锁改动 editingTicket 的多处初始化;列保留不物理删。
      teamSize: Number(et.teamSize) || 0,
      startTime: et.startTime,
      endTime: et.endTime,
      saleStartTime: et.saleStartTime,
      saleEndTime: et.saleEndTime,
      description: et.description,
      refundSupported: et.refundSupported,
      syncWithTheme: et.syncWithTheme
    };
    const savedTicketId = Number(et.id);
    if (Number.isSafeInteger(savedTicketId) && savedTicketId > 0) ticketData.id = savedTicketId;
    let tickets = [...this.data.formData.tickets];
    if (et.editIndex >= 0) {
      tickets[et.editIndex] = ticketData;
    } else {
      tickets.push(ticketData);
    }
    this.setData({ 'formData.tickets': tickets, showTicketEditor: false }, () => {
      this.refreshRouteGraph();
      this.refreshPrimaryActionState();
    });
  },

  // 删除票种
  deleteTicket(e) {
    const index = e.currentTarget.dataset.index;
    let tickets = [...this.data.formData.tickets];
    tickets.splice(index, 1);
    this.setData({ 'formData.tickets': tickets }, () => {
      this.refreshRouteGraph();
      this.refreshPrimaryActionState();
    });
  },

  // 编辑器内字段变更
  onEditTicketChange(e) {
    const field = e.currentTarget.dataset.field;
    let value = e.detail.value;
    if (field === 'price') {
      const sanitized = value.replace(/[^\d.]/g, '');
      // 只拦「多于一个小数点」;保留 sanitized 字符串,别在输入中途 parseFloat→String
      // (受控输入下那样会把刚敲的小数点抹掉,导致小数价格永远输不进去)。数值化(saveTicket 里 Number())留到提交时做。
      if ((sanitized.match(/\./g) || []).length > 1) {
        cyToast('价格格式错误');
        return;
      }
      value = sanitized;
    } else if (field === 'totalStock' || field === 'teamSize') {
      value = Number(value) || 0;
    }
    this.setData({ [`editingTicket.${field}`]: value }, () => this.refreshTicketSaveState());
  },

  // 编辑器内模式切换
  onEditTicketModeChange(e) {
    const mode = Number(e.currentTarget.dataset.mode);
    this.setData({
      'editingTicket.mode': mode,
      'editingTicket.startTime': '',
      'editingTicket.endTime': ''
    }, () => this.refreshTicketSaveState());
  },

  // 退款 toggle

  // 与路线日期同步 toggle
  onEditTicketSyncToggle() {
    const sync = !this.data.editingTicket.syncWithTheme;
    const update = { 'editingTicket.syncWithTheme': sync };
    if (sync) {
      update['editingTicket.startTime'] = this.data.formData.startDate || '';
      update['editingTicket.endTime'] = this.data.formData.endDate || '';
    }
    this.setData(update, () => this.refreshTicketSaveState());
  },

  // 打开票种时间选择弹窗
  showTicketTimePicker(e) {
    const { field, mode } = e.currentTarget.dataset;
    const currentVal = this.data.editingTicket[field] || '';
    const { dateList, hours, minutes } = this.data;
    let dateIdx = 0;
    let hourIdx = 9;
    let minuteIdx = 0;

    if (currentVal) {
      const m = currentVal.match(/^(\d{4}-\d{2}-\d{2})(?:\s(\d{1,2}):(\d{1,2}))?/);
      if (m) {
        const dIdx = dateList.findIndex(d => d.date === m[1]);
        if (dIdx >= 0) dateIdx = dIdx;
        if (m[2]) hourIdx = hours.indexOf(Number(m[2]));
        if (m[3]) minuteIdx = minutes.indexOf(Number(m[3]));
        if (hourIdx < 0) hourIdx = 9;
        if (minuteIdx < 0) minuteIdx = 0;
      }
    }

    const titleMap = {
      saleStartTime: '选择售票开始日期',
      saleEndTime: '选择售票结束日期',
      startTime: '选择开始时间',
      endTime: '选择结束时间'
    };

    this.setData({
      ticketTimePicker: {
        show: true,
        field,
        mode: mode || 'date',
        title: titleMap[field] || '选择时间'
      },
      ticketDateIndex: [dateIdx],
      ticketTimeIndex: [hourIdx, minuteIdx]
    });
  },

  // 关闭票种时间选择弹窗
  closeTicketTimePicker() {
    this.setData({ 'ticketTimePicker.show': false });
  },

  // 日期列变化
  onTicketPickerDateChange(e) {
    this.setData({ ticketDateIndex: e.detail.value });
  },

  // 时分列变化
  onTicketPickerTimeChange(e) {
    this.setData({ ticketTimeIndex: e.detail.value });
  },

  // 确认票种时间
  confirmTicketTime() {
    const { ticketTimePicker, ticketDateIndex, ticketTimeIndex, dateList, hours, minutes } = this.data;
    const selectedDate = dateList[ticketDateIndex[0]];
    if (!selectedDate) {
      this.setData({ 'ticketTimePicker.show': false });
      return;
    }
    let val = selectedDate.date;
    if (ticketTimePicker.mode === 'datetime') {
      const hour = hours[ticketTimeIndex[0]];
      const minute = minutes[ticketTimeIndex[1]];
      const hourStr = hour.toString().padStart(2, '0');
      const minuteStr = minute.toString().padStart(2, '0');
      val = `${val} ${hourStr}:${minuteStr}`;
    }
    this.setData({
      [`editingTicket.${ticketTimePicker.field}`]: val,
      'ticketTimePicker.show': false
    }, () => this.refreshTicketSaveState());
  },

  // 选择集合地点（腾讯地图）
  chooseTicketMeetingPoint() {
    const that = this;
    pickLocation({
      onPick(poi) {
        that.setData({
          'editingTicket.meetingPoint': poi.name || '',
          'editingTicket.meetingPointAddress': poi.address || '',
          'editingTicket.meetingPointLongitude': poi.longitude || '',
          'editingTicket.meetingPointLatitude': poi.latitude || ''
        }, () => that.refreshTicketSaveState());
      }
    });
  },

  addTicket() {
    let tickets = [...this.data.formData.tickets];

    tickets.push({
      name: `票价${tickets.length + 1}`,
      price: 0,
      totalStock: 100,
      mode: this.data.formData.productType || 1,
      meetingPoint: '',
      teamSize: 0,
      startTime: '',
      endTime: '',
      description: ''
    });

    this.setData({
      'formData.tickets': tickets
    }, () => this.refreshPrimaryActionState());
  },

  // 删除票务项
  removeTicket(e) {
    const index = e.currentTarget.dataset.index;
    if (index === 0) {
      cyToast('至少保留一个票价');
      return;
    }

    let tickets = [...this.data.formData.tickets];
    tickets.splice(index, 1);

    this.setData({
      'formData.tickets': tickets
    }, () => this.refreshPrimaryActionState());
  },

  // 票务日期选择
  bindTicketDateChange(e) {
    const {
      field,
      index
    } = e.currentTarget.dataset;
    const value = e.detail.value;

    this.setData({
      [`formData.tickets[${index}].${field}`]: value
    });
  },

  // 修改参与人数（加减按钮）
  changeParticipantCount(e) {
    const {
      type,
      index
    } = e.currentTarget.dataset;
    let tickets = [...this.data.formData.tickets];
    let currentStock = tickets[index].totalStock || 0;

    if (type === 'add') {
      currentStock += 1;
    } else if (type === 'subtract' && currentStock > 0) {
      currentStock -= 1;
    }

    tickets[index].totalStock = currentStock;

    this.setData({
      'formData.tickets': tickets
    });
  },

  // 同步发布到创意广场开关
  onPublishToCreativeChange(e) {
    this.setData({
      publishToCreative: e.detail.value
    });
  },

  // P0.5 勋章。途中彩蛋整条链路已于 2026-09-07 下线(前后端一起拆,见 feat/decommission-route-eggs-0907)。
  onFinishMedalNameInput(e) {
    this.setData({ 'formData.finishMedalName': e.detail.value });
  },
  /**
   * 通关勋章图。这条链路后端与玩家端早就通了 —— cms_topic.finish_medal_img 建了列、
   * TopicCreateDTO 收得下、play/index.wxml 的 pp-reward__img 也画了 ——
   * 唯独创作端没有入口,于是线上主题的通关勋章一律无图。这里把入口补上。
   * 形态与玩法模板页的勋章上传保持一致:1:1 裁剪、单张、可清除。
   */
  uploadFinishMedal() {
    const that = this;
    app.chooseImage(function (res) {
      that.setData({ 'formData.finishMedalImg': res[0] });
    }, 1, { crop: true, cropScale: '1:1' });
  },
  clearFinishMedal() {
    this.setData({ 'formData.finishMedalImg': '' });
  },
  // 完成奖励的开关。关 = 清掉已选的券(奖励本身就是「有没有选券」,不另存一个 on 字段);
  // 开 = 只把选择器露出来,选没选完全看用户 —— 所以 completeRewardOn 是纯 UI 态。
  onCompleteRewardToggle(e) {
    const on = !!(e.detail && e.detail.value);
    if (on) { this.setData({ completeRewardOn: true }); return; }
    this.setData({
      completeRewardOn: false,
      'formData.completeRewardCouponId': 0,
      completionRewardCouponName: ''
    });
  },

  onCompletionRewardChange(e) {
    const detail = e.detail || {};
    const couponId = Number(detail.couponId || 0);
    this.setData({
      'formData.completeRewardCouponId': couponId,
      completionRewardCouponName: detail.couponName || '',
      completeRewardOn: !!couponId || this.data.completeRewardOn
    });
  },
  onCompletionRuleToggle(e) {
    this.setData({
      completionRuleMode: e.detail.value ? 'AT_LEAST' : 'ALL',
      completionRuleError: '',
      'errors.completionRule': ''
    }, () => this.refreshPrimaryActionState());
  },
  onCompletionRequiredCountInput(e) {
    this.setData({ completionRequiredCount: Number(e.detail.value), completionRuleError: '', 'errors.completionRule': '' },
      () => this.refreshPrimaryActionState());
  },
  onRecruitDeadlineChange(e) {
    this.setData({ 'formData.recruitDeadline': e.detail.value || '' }, () => this.refreshPrimaryActionState());
  },

  // M2 自玩票(仅经典定向):开关 + 价格 + 票数
  onSelfPlayToggle(e) {
    this.setData({ 'formData.selfPlay': !!e.detail.value });
  },
  onSelfPlayPriceInput(e) {
    this.setData({ 'formData.selfPlayPrice': e.detail.value });
  },
  onSelfPlayQuotaInput(e) {
    this.setData({ 'formData.selfPlayQuota': e.detail.value });
  },

  // ===== 主题级分支路线编辑器 =====
  _routeOutcomeContract(node) {
    const templateInfo = node.templateInfo && typeof node.templateInfo === 'object' ? node.templateInfo : null;
    const source = templateInfo || node;
    const hasContractSnapshot = Number(node.templateId || 0) <= 0
      || source.validationMethod !== undefined
      || source.preferenceJson !== undefined
      || source.advancedConfigJson !== undefined;
    return hasContractSnapshot
      ? nodeOutcomeContract.extract(source)
      : { items: [], errors: [] };
  },

  _routeNodes() {
    return topicRouteGraph.flattenNodes((this.data.formData && this.data.formData.chapters) || []).map((node) => {
      const contract = this._routeOutcomeContract(node);
      return Object.assign({}, node, { outcomes: contract.items, outcomeErrors: contract.errors });
    });
  },

  _sequentialRouteGraph(nodes) {
    const list = nodes || this._routeNodes();
    const graph = topicRouteGraph.emptyGraph();
    if (!list.length) return graph;
    graph.startNodeId = list[0].id;
    graph.terminalNodeIds = [list[list.length - 1].id];
    graph.edges = list.slice(0, -1).map((node, index) => ({
      id: 'route_' + (index + 1), fromNodeId: node.id,
      trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' },
      conditions: [], effects: [], toNodeId: list[index + 1].id,
      priority: 0, weight: 1, once: true, maxVisits: 1, allowLoop: false
    }));
    return graph;
  },

  _nextStoryNodeId(sourceId, nodes) {
    const list = nodes || this._routeNodes();
    const index = list.findIndex((node) => node.id === String(sourceId || ''));
    return index >= 0 && index < list.length - 1 ? list[index + 1].id : '';
  },

  _realignStoryRouteGraph(previousNodes) {
    if (this.data.formData.routeMode !== 'BRANCH_GRAPH') return;
    const nextNodes = this._routeNodes();
    const graph = topicRouteGraph.normalizeGraph(this._routeGraph).graph;
    (previousNodes || []).forEach((source) => {
      const oldNextNodeId = this._nextStoryNodeId(source.id, previousNodes);
      const newNextNodeId = this._nextStoryNodeId(source.id, nextNodes);
      if (!oldNextNodeId || oldNextNodeId === newNextNodeId) return;
      const fallback = (graph.fallbacks || []).find((item) => item.fromNodeId === source.id);
      const followsStoryFlow = fallback && fallback.toNodeId === oldNextNodeId;
      if (followsStoryFlow) {
        if (newNextNodeId) fallback.toNodeId = newNextNodeId;
        else graph.fallbacks = graph.fallbacks.filter((item) => item !== fallback);
      }
      graph.edges = (graph.edges || []).filter((edge) => {
        const isStoryEdge = edge.fromNodeId === source.id
          && ((followsStoryFlow && edge.toNodeId === oldNextNodeId)
            || String(edge.id || '').indexOf('route_') === 0);
        if (!isStoryEdge) return true;
        if (!newNextNodeId) return false;
        edge.toNodeId = newNextNodeId;
        return true;
      });
    });
    graph.startNodeId = nextNodes.length ? nextNodes[0].id : '';
    this._routeGraph = graph;
  },

  _pruneRouteGraphToCurrentNodes() {
    if (this.data.formData.routeMode !== 'BRANCH_GRAPH') return;
    const nodes = this._routeNodes();
    const validIds = new Set(nodes.map((node) => node.id));
    const graph = topicRouteGraph.normalizeGraph(this._routeGraph).graph;
    graph.edges = (graph.edges || []).filter((edge) => {
      const endpointsRemain = validIds.has(edge.fromNodeId) && validIds.has(edge.toNodeId);
      const conditionsRemain = (edge.conditions || []).every((condition) => {
        if (condition.op !== 'NODE_COMPLETED') return true;
        return validIds.has(String(condition.nodeId || condition.nodeKey || ''));
      });
      return endpointsRemain && conditionsRemain;
    });
    graph.fallbacks = (graph.fallbacks || []).filter((item) => {
      return validIds.has(item.fromNodeId) && validIds.has(item.toNodeId);
    });
    graph.fallbacks.forEach((fallback, index) => {
      if (graph.edges.some((edge) => edge.fromNodeId === fallback.fromNodeId)) return;
      const source = nodes.find((node) => node.id === fallback.fromNodeId);
      const outcome = source && (source.outcomes || [])[0];
      graph.edges.push({
        id: 'route_repair_' + fallback.fromNodeId + '_' + (index + 1),
        fromNodeId: fallback.fromNodeId,
        trigger: {
          type: outcome ? outcome.triggerType : 'CHOICE',
          outcomeCode: outcome ? outcome.code : 'COMPLETED',
        },
        conditions: [], effects: [], toNodeId: fallback.toNodeId,
        priority: 0, weight: 1, once: true, maxVisits: 1, allowLoop: false,
      });
    });
    graph.nodeRequirements = (graph.nodeRequirements || [])
      .filter((item) => validIds.has(String(item.nodeId || '')));
    if (!validIds.has(graph.startNodeId)) graph.startNodeId = nodes.length ? nodes[0].id : '';
    const outgoingIds = new Set(graph.edges.map((edge) => edge.fromNodeId)
      .concat(graph.fallbacks.map((item) => item.fromNodeId)));
    graph.terminalNodeIds = nodes
      .filter((node) => !outgoingIds.has(node.id))
      .map((node) => node.id);
    this._routeGraph = graph;
    this.refreshRouteGraph();
  },

  _routeMappingSummary(nodes, graph) {
    const summary = {};
    nodes.forEach((node) => {
      const nextNodeId = this._nextStoryNodeId(node.id, nodes);
      const matching = (graph.edges || []).filter((edge) => edge.fromNodeId === node.id
        && (node.outcomes || []).some((outcome) => outcome.triggerType === edge.trigger.type
          && outcome.code === edge.trigger.outcomeCode));
      const hasChoice = (node.outcomes || []).length > 1;
      const hasChangedTarget = matching.some((edge) => edge.toNodeId !== nextNodeId);
      if (matching.length && (hasChoice || hasChangedTarget)) {
        const label = '下一站 ' + matching.length + ' 条';
        summary[node.id] = label;
        if (node.clientNodeKey) summary[node.clientNodeKey] = label;
      }
    });
    return summary;
  },

  _routeSavedTicketOptions() {
    return (this.data.formData.tickets || []).map((ticket) => ({
      id: Number(ticket.id), label: ticket.name || ticket.ticketName || ('票种 #' + ticket.id)
    })).filter((ticket) => Number.isSafeInteger(ticket.id) && ticket.id > 0);
  },

  _ensureRouteFallbacks(graph, nodes) {
    const fallbackSources = new Set((graph.fallbacks || []).map((item) => String(item.fromNodeId)));
    const edgesBySource = new Map();
    (graph.edges || []).forEach((edge) => {
      const sourceId = String(edge.fromNodeId || '');
      if (!sourceId) return;
      if (!edgesBySource.has(sourceId)) edgesBySource.set(sourceId, []);
      edgesBySource.get(sourceId).push(edge);
    });
    edgesBySource.forEach((edges, sourceId) => {
      const source = (nodes || []).find((node) => node.id === sourceId);
      const hasUnmatchedOutcome = !!source && (source.outcomes || []).some((outcome) => {
        return !edges.some((edge) => edge.trigger.type === outcome.triggerType
          && edge.trigger.outcomeCode === outcome.code);
      });
      const hasConditionalEdge = edges.some((edge) => (edge.conditions || []).length);
      if (fallbackSources.has(sourceId)
        || (edges.length < 2 && !hasUnmatchedOutcome && !hasConditionalEdge)) return;
      const storyNextNodeId = this._nextStoryNodeId(sourceId, nodes);
      if (storyNextNodeId) graph.fallbacks.push({ fromNodeId: sourceId, toNodeId: storyNextNodeId });
    });
    return graph;
  },

  refreshRouteGraph() {
    const nodes = this._routeNodes();
    const graph = this._ensureRouteFallbacks(topicRouteGraph.normalizeGraph(this._routeGraph).graph, nodes);
    const ticketOptions = this._routeSavedTicketOptions();
    const preview = topicRouteGraph.buildPreview(graph, nodes, {}, {
      allowedTicketIds: ticketOptions.map((ticket) => ticket.id)
    });
    this._routeGraph = graph;
    this.setData({
      routeNodeMappingSummary: this._routeMappingSummary(nodes, graph),
      'formData.routeGraphJson': this.data.formData.routeMode === 'BRANCH_GRAPH'
        ? topicRouteGraph.serialize(graph) : this.data.formData.routeGraphJson,
    });
    return preview;
  },

  openNodeRouteMapping(e) {
    if (Number(this.data.formData.productType) === 2) return;
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const requestedId = String(dataset.nodeid || this.data.editTargetNodeLid || '');
    const nodes = this._routeNodes();
    let source = nodes.find((node) => node.id === requestedId || node.clientNodeKey === requestedId);
    if (!source) {
      cyToast('请先保存节点');
      return;
    }
    const returnToNodeEditor = !!this.data.popChapterNodes;
    const editingSource = returnToNodeEditor
      && (source.id === String(this.data.editTargetNodeLid || '')
        || source.clientNodeKey === String(this.data.editTargetNodeLid || ''));
    if (editingSource) {
      const liveNode = Object.assign({}, source, this.data.nodesForm || {}, {
        id: source.id,
        clientNodeKey: source.clientNodeKey,
        label: (this.data.nodesForm && this.data.nodesForm.name) || source.label,
      });
      const liveContract = this._routeOutcomeContract(liveNode);
      source = Object.assign(liveNode, {
        outcomes: liveContract.items,
        outcomeErrors: liveContract.errors,
      });
      if (!this._nodeRouteGraphBeforeEdit) {
        this._nodeRouteGraphBeforeEdit = {
          routeMode: this.data.formData.routeMode,
          routeGraphJson: this.data.formData.routeGraphJson,
          routeGraph: JSON.parse(JSON.stringify(this._routeGraph)),
        };
      }
    }
    if (!(source.outcomes || []).length) {
      cyToast('请先重新选择玩法模板');
      return;
    }
    const sourceId = source.id;
    const graph = topicRouteGraph.normalizeGraph(this._routeGraph).graph;
    const nextNodeId = this._nextStoryNodeId(sourceId, nodes);
    const targetOptions = [{ id: '', label: '继续故事流' }].concat(nodes
      .filter((node) => node.id !== sourceId)
      .map((node) => ({ id: node.id, label: node.label })));
    const rows = (source.outcomes || []).map((outcome) => {
      const edge = (graph.edges || []).find((item) => item.fromNodeId === sourceId
        && item.trigger.type === outcome.triggerType
        && item.trigger.outcomeCode === outcome.code);
      // 具体玩法结果一旦已有 edge，就显示真实地点；只有未建立 edge 的结果才显示
      // “继续故事流”。否则目标恰好等于相邻节点时会被伪装成未配置，重进后看不出对应。
      const selectedId = edge ? edge.toNodeId : '';
      const selected = targetOptions.find((item) => item.id === selectedId) || targetOptions[0];
      return {
        code: outcome.code,
        triggerType: outcome.triggerType,
        label: outcome.label,
        toNodeId: selected.id,
        targetLabel: selected.label,
        targetOptions,
      };
    });
    this._routeMappingSourceNodeId = sourceId;
    this._routeMappingReturnToNodeEditor = returnToNodeEditor;
    this.setData({
      routeMappingShow: true,
      routeMappingSourceLabel: source.label,
      routeMappingTemplateLabel: (source.templateInfo && source.templateInfo.title)
        || source.templateName || '节点完成结果',
      routeMappingRows: rows,
      routeMappingFallbackLabel: nextNodeId ? '继续故事流' : '故事流结束',
      popChapterNodes: false,
    });
  },

  onRouteMappingTargetPick(e) {
    const rowIndex = Number(e.currentTarget.dataset.rowindex);
    const rows = (this.data.routeMappingRows || []).map((row) => Object.assign({}, row));
    const row = rows[rowIndex];
    const selected = row && row.targetOptions[Number(e.detail.value)];
    if (!selected) return;
    row.toNodeId = selected.id;
    row.targetLabel = selected.label;
    this.setData({ routeMappingRows: rows });
  },

  closeNodeRouteMapping() {
    const returnToNodeEditor = this._routeMappingReturnToNodeEditor;
    this._routeMappingReturnToNodeEditor = false;
    this.setData({
      routeMappingShow: false,
      popChapterNodes: !!returnToNodeEditor,
    });
  },

  _rollbackNodeRouteEdit() {
    const snapshot = this._nodeRouteGraphBeforeEdit;
    this._nodeRouteGraphBeforeEdit = null;
    if (!snapshot) return;
    this._routeGraph = snapshot.routeGraph;
    this.setData({
      'formData.routeMode': snapshot.routeMode,
      'formData.routeGraphJson': snapshot.routeGraphJson,
    }, () => this.refreshRouteGraph());
  },

  _commitNodeRouteEdit() {
    this._nodeRouteGraphBeforeEdit = null;
  },

  finishNodeRouteMapping() {
    const sourceId = this._routeMappingSourceNodeId;
    const nodes = this._routeNodes();
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) return this.closeNodeRouteMapping();
    const nextNodeId = this._nextStoryNodeId(sourceId, nodes);
    let graph = this.data.formData.routeMode === 'BRANCH_GRAPH'
      ? topicRouteGraph.normalizeGraph(this._routeGraph).graph
      : this._sequentialRouteGraph(nodes);
    const preservedTerminalIds = new Set((graph.terminalNodeIds || []).map(String));
    const previous = graph.edges || [];
    graph.edges = previous.filter((edge) => edge.fromNodeId !== sourceId);
    (this.data.routeMappingRows || []).forEach((row, index) => {
      const targetId = row.toNodeId || nextNodeId;
      if (!targetId) return;
      const existing = previous.find((edge) => edge.fromNodeId === sourceId
        && edge.trigger.type === row.triggerType
        && edge.trigger.outcomeCode === row.code);
      graph.edges.push(Object.assign({
        id: 'mapping_' + sourceId + '_' + row.code,
        conditions: [], effects: [], priority: index, weight: 1,
        once: true, maxVisits: 1, allowLoop: false,
      }, existing || {}, {
        fromNodeId: sourceId,
        trigger: { type: row.triggerType, outcomeCode: row.code },
        toNodeId: targetId,
      }));
    });
    graph.fallbacks = (graph.fallbacks || []).filter((item) => item.fromNodeId !== sourceId);
    if (nextNodeId) graph.fallbacks.push({ fromNodeId: sourceId, toNodeId: nextNodeId });
    if (graph.edges.some((edge) => edge.fromNodeId === sourceId)) preservedTerminalIds.delete(sourceId);

    // 没单独配置的节点仍按原故事流前进；起点和技术终点不暴露给创作者。
    nodes.slice(0, -1).forEach((node, index) => {
      if (preservedTerminalIds.has(node.id)
        || graph.edges.some((edge) => edge.fromNodeId === node.id)) return;
      graph.edges.push({
        id: 'route_' + (index + 1), fromNodeId: node.id,
        trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' },
        conditions: [], effects: [], toNodeId: nodes[index + 1].id,
        priority: 0, weight: 1, once: true, maxVisits: 1, allowLoop: false,
      });
    });
    graph.startNodeId = nodes.length ? nodes[0].id : '';
    const sources = new Set(graph.edges.map((edge) => edge.fromNodeId));
    graph.terminalNodeIds = nodes
      .filter((node) => preservedTerminalIds.has(node.id) || !sources.has(node.id))
      .map((node) => node.id);

    this._routeGraph = graph;
    this.setData({ 'formData.routeMode': 'BRANCH_GRAPH' }, () => {
      this.refreshRouteGraph();
      this.closeNodeRouteMapping();
    });
  },

  _routeSimulationReport() {
    return topicRouteGraph.simulate(this._routeGraph, this._routeNodes(), {
      runs: 1000,
      seed: 'release-check',
    });
  },

  validateRouteGraph(options) {
    if (this.data.formData.routeMode !== 'BRANCH_GRAPH') return true;
    const preview = this.refreshRouteGraph();
    if (options && options.draft) return true;
    if (!preview.valid) return false;
    return this._routeSimulationReport().releaseReady;
  },

  // 表单验证
  // 错误累积/顺序/首错文案走共享 publish-validator;字段集/文案/章节守卫/票务 price+mode 仍是本页口径。
  // errors 映射存字段内联短文案,toast 走"第N个票务"前缀文案(bag 第四参 toastMessage)。
  // 纯判定:产出 errorBag,不做 setData/toast/切Tab(供 validateForm + buildPublishCheck 共用,避免重复造规则)
  // 发布前校验 = 纯函数,见 utils/publish/publish-validation-bag.js。
  // 页面只负责把 data 切片和 4 个路线图私有方法的结果算好传进去。
  _buildValidationBag() {
    const branchGraph = !(Number(this.data.formData.productType) === 2)
      && this.data.formData.routeMode === 'BRANCH_GRAPH';
    return publishValidationBag.buildValidationBag({
      formData: this.data.formData,
      selectedCategoryIds: this.data.selectedCategoryIds,
      startDateTime: this.data.startDateTime,
      endDateTime: this.data.endDateTime,
      completionRuleMode: this.data.completionRuleMode,
      completionRequiredCount: this.data.completionRequiredCount,
      pendingMaterials: this.data.pendingMaterials,
      // 这四项只在分支图模式下才需要,非该模式不白算。
      routeGraph: branchGraph ? this._routeGraph : null,
      routeNodes: branchGraph ? this._routeNodes() : [],
      savedTicketOptions: branchGraph ? this._routeSavedTicketOptions() : [],
      // ⚠️ 传函数不传结果:模拟跑 1000 轮,原实现只在图校验通过后才跑。
      // 提前算好会让每次校验(输入时也触发)都白跑一遍。
      routeSimulationReport: () => this._routeSimulationReport(),
    });
  },

  refreshPrimaryActionState() {
    const d = this.data;
    // 章节状态与「还差几项」由策略层统一算,页面不复制判据(见 pro-editor-policy 头注)
    const policy = proEditorPolicy.evaluateProfessionalDraft({
      formData: d.formData,
      clubId: d.formData && d.formData.clubId,
      pendingMaterials: d.pendingMaterials,
      categoryIds: d.selectedCategoryIds,
    });
    const missing = policy.blockingIssues.length;
    const summaryPatch = {};
    // ⚠️ 派生态必须留在 formData 之外。曾试过挂 formData.chapters[i]._state,结果被
    // editScope=WHITELIST 的「锁定字段未改动」断言判成「章节被改过」,只改文案也保存不了。
    if (JSON.stringify(policy.chapterStates) !== JSON.stringify(d.chapterStates)) {
      summaryPatch.chapterStates = policy.chapterStates;
    }
    const chapterActionLabels = policy.chapterStates.map((state) => {
      return Number(d.formData.productType) === 1 && state.storyDone
        ? '把这段剧情落到地点' : '＋ 创建节点';
    });
    if (JSON.stringify(chapterActionLabels) !== JSON.stringify(d.chapterActionLabels)) {
      summaryPatch.chapterActionLabels = chapterActionLabels;
    }
    if (policy.defaultAnchor !== d.creationAnchor) summaryPatch.creationAnchor = policy.defaultAnchor;
    if (JSON.stringify(policy.starterAction) !== JSON.stringify(d.starterAction)) {
      summaryPatch.starterAction = policy.starterAction;
    }
    const pendingMaterialStates = {};
    (Array.isArray(d.pendingMaterials) ? d.pendingMaterials : []).forEach((material) => {
      pendingMaterialStates[material._localId] = proEditorPolicy.hasUsableCoords(material);
    });
    if (JSON.stringify(pendingMaterialStates) !== JSON.stringify(d.pendingMaterialStates)) {
      summaryPatch.pendingMaterialStates = pendingMaterialStates;
    }
    const summary = missing ? ('还差 ' + missing + ' 项') : '已填完';
    if (summary !== d.topicDetailSummary) summaryPatch.topicDetailSummary = summary;
    if (Object.keys(summaryPatch).length) this.setData(summaryPatch);

    const bag = this._buildValidationBag();
    const needsClub = Number(d.formData.productType) === 1 && d.myClubs.length > 0;
    const canPublish = bag.isValid() && (!needsClub || !!d.formData.clubId)
      && (!d.editingTopicId || d.editLoaded);
    const patch = {};
    if (canPublish !== d.canPublish) patch.canPublish = canPublish;
    if (Object.keys(patch).length) this.setData(patch);
  },

  validateForm() {
    let that = this
    const bag = that._buildValidationBag();

    that.setData({
      errors: bag.errors
    });

    // 九宫格开着但没排满就拦下来。不拦的话服务端会拒(TopicCompletionRulePolicy),
    // 商家看到的是一句从接口透出来的报错,而不是"第 3 格还没选站点"。
    const bingoError = advancedGameConfig.validateTopicBingo({
      enabled: that.data.bingoEnabled, cells: that._bingoCellsByPosition()
    });
    if (bingoError) {
      that.setData({ bingoError });
      cyToast(bingoError, { duration: 3000 });
      return false;
    }
    that.setData({ bingoError: '' });

    // 如果有错误，只显示第一个,避免信息过多
    if (!bag.isValid()) {
      that.focusValidationError(bag.errors);
      cyToast(bag.firstMessage(), { duration: 3000 });
    }

    return bag.isValid();
  },



  focusValidationError(errors) {
    const keys = Object.keys(errors || {});
    if (!keys.length) return;
    const key = keys[0];
    const anchor = this._anchorForErrorKey(key);
    // 平铺后所有区块都在同一屏,不用再跳步骤,滚到锚点即可
    const patch = {};
    if (key.indexOf('ticket') === 0) {
      patch['secCollapsed.ticket'] = false;
    }
    if (key.indexOf('ticket') === 0 && !this.data.showTicketEditor) {
      patch.showTicketEditor = true;
      const idx = key.match(/(\d+)/);
      const ticketIndex = idx ? parseInt(idx[1], 10) : 0;
      const tickets = this.data.formData.tickets || [];
      patch.editingTicket = Object.assign({}, tickets[ticketIndex] || this.createDefaultTicket(this.data.editingTicket.mode || 1), {
        editIndex: tickets.length ? ticketIndex : -1
      });
    }
    this.setData(patch, () => {
      this.refreshTicketSaveState();
      this._scrollSheetTo(anchor);
    });
  },

  // 发布前检查(M4·A):汇总 blocking(硬必填,阻断)+ advisory(软建议,不阻断),供发布弹层逐条定位
  // blocking 直接复用 validateForm 的判定(_buildValidationBag),按字段 key 映射到对应 Tab
  buildPublishCheck() {
    const bag = this._buildValidationBag();
    const errors = bag.errors || {};
    // 单字段错 → 所属 Tab:章节/节点类落「路线」Tab'0',其余落「基本信息」Tab'2'
    const tabOf = (key) => key.indexOf('chapterRecruit') === 0
      ? '2' : (key.indexOf('chapter') === 0 || key === 'chapters') ? '0' : '2';
    // CU-C-160:tab 是旧的粗分类(原三步向导),定位要靠字段名 —— 交给
    // locatePublishIssue → _anchorForErrorKey,别再按 tab 猜。
    const blocking = Object.keys(errors).map((key) => ({
      label: errors[key],
      field: key,
      tab: tabOf(key)
    }));

    // advisory = computeCompleteness().missing 里的软项(站点级缺地点/描述/时长)+ 未配游戏站点;均落 Tab'0'
    // 软项都是站点级事实,没有单一字段:按章节区定位('chapters' → routeSection)。
    const advisory = [];
    const softSet = ['部分站点缺地点', '部分站点缺描述', '部分站点缺时长'];
    const missing = (this.computeCompleteness().missing) || [];
    missing.forEach((m) => {
      if (softSet.indexOf(m) !== -1) advisory.push({ label: m, field: 'chapters', tab: '0' });
    });
    // 未配游戏的站点(无 templateId 视为未配)
    let noGame = 0;
    ((this.data.formData && this.data.formData.chapters) || []).forEach((chapter) => {
      (chapter.nodes || []).forEach((node) => {
        if (node && !node.templateId) noGame++;
      });
    });
    if (noGame > 0) advisory.push({ label: `${noGame} 个站点未配置玩法`, field: 'chapters', tab: '0' });

    return { blocking, advisory };
  },

  // 发布确认页的「自动检查已通过 · N 项」。
  // ⚠️ 它不能拿 blocking/advisory 取反来凑 —— 那样只要没报错就算"通过",
  //    一条从来没跑过的检查也会被算成绿的。这里每一项都自己判一次现值。
  _buildPublishPassed(precheckOk) {
    const fd = this.data.formData || {};
    const chapters = fd.chapters || [];
    const nodeCount = chapters.reduce((sum, c) => sum + ((c && c.nodes) || []).length, 0);
    // CU-C-168:只数**填全了**的票 —— 数组里躺一张空票不等于配好了一种票。
    const readyTickets = (fd.tickets || []).filter((t) => !this._ticketBlockReason(t));
    const items = [
      { label: '主题名称已填写', ok: !!(fd.name && fd.name.trim()) },
      { label: '主题封面已上传', ok: !!fd.imgUrl },
      { label: '主题简介已填写', ok: !!(fd.description && fd.description.trim()) },
      { label: `已编排 ${chapters.length} 个章节`, ok: chapters.length > 0 },
      { label: `已放置 ${nodeCount} 个站点`, ok: nodeCount > 0 },
      { label: `已配置 ${readyTickets.length} 种票单`, ok: readyTickets.length > 0 },
      { label: '通关规则已确定', ok: !!this.data.completionRuleMode },
      { label: '内容安全预检通过', ok: !!precheckOk },
      // RUN-52:已登记才进这份清单(未登记时它出现在「必填项」那一侧,不能两头都算)
      { label: '发布者实名已登记', ok: !!this.data.identityRegistered },
    ];
    return items.filter((item) => item.ok);
  },

  // 发布确认页的「玩家看到的样子」。
  // ⚠️ 数据源必须是编辑器里的**当前草稿**,不是 ?id= 拉服务端 —— 服务端那版是上一次保存的,
  //    拿它当预览就是 2026-09-05 删掉的那个假预览重新长回来。
  _buildPublishPreview() {
    const fd = this.data.formData || {};
    // 直接重算,不读 this.data.totalStats:那个字段全页零渲染(U4 存量债务 A1),
    // 读它只会把一条死字段升级成「内部状态」,而算一次的成本本来就可以忽略。
    const stats = this.calculateTotalStats() || {};
    return {
      cover: fd.imgUrl || '',
      name: fd.name || '未命名主题',
      subtitle: fd.subtitle || '',
      description: fd.description || '',
      stats: [
        { k: '章节', v: String((fd.chapters || []).length) },
        { k: '站点', v: String(stats.totalNodes == null ? 0 : stats.totalNodes) },
        { k: '时长', v: stats.totalDurationDisplay || '—' },
        { k: '里程', v: stats.totalDistance || 0 },
      ],
      chapters: (fd.chapters || []).map((chapter, index) => ({
        // CU-C-87:与章节卡同一把尺子 —— 名字自带「第N章」时不再叠一次序号,
        // 否则确认页会出现「第1章 第1章 隔离书店站」。
        name: chapterCardTitle(index, chapter && chapter.name),
        nodes: (((chapter && chapter.nodes) || []).map((node) => ({
          name: (node && node.name) || '未命名站点',
          address: (node && node.address) || '未选地点',
        }))),
      })),
    };
  },

  _buildPublishSummary() {
    const formData = this.data.formData || {};
    const chapters = formData.chapters || [];
    const nodeCount = chapters.reduce((sum, chapter) => sum + ((chapter && chapter.nodes) || []).length, 0);
    // CU-C-168:同一张「发布前检查」里不能既说票没填完、又说配了 N 种 —— 没填全的不计数,
    // 但也不能不吭声,差额如实报出来。
    const allTickets = formData.tickets || [];
    const ticketCount = allTickets.filter((t) => !this._ticketBlockReason(t)).length;
    const unfinished = allTickets.length - ticketCount;
    const modeLabel = Number(formData.productType) === 2 ? '自由探索' : '城市定向';
    const completionLabel = this.data.completionRuleMode === 'AT_LEAST'
      ? `完成任意 ${Number(this.data.completionRequiredCount) || 0} 个站点即通关`
      : '完成全部站点后通关';
    return [
      `「${formData.name || '未命名主题'}」将按${modeLabel}发布，共 ${chapters.length} 个章节、${nodeCount} 个站点。`,
      `${completionLabel}；当前配置 ${ticketCount} 种票单${unfinished > 0 ? `，另有 ${unfinished} 种没填完` : ''}。`
    ];
  },

  // 组装安全预检请求体(AiSafetyPrecheckReq):路线级文案 + 摊平后的全部节点
  // 节点上只有 name/description;task/hint1/hint2 的真源是所配玩法(node.templateInfo,来自 /api/template/my-list 整行,
  // 含 rule_instructions/question_name/hint1/hint2)。未配玩法的节点没有 task 可言,退化用节点自己的文字说明,
  // 这样至少内容安全那一半始终有料可检(硬传空 = 预检形同虚设)。
  _buildPrecheckReq() {
    const fd = this.data.formData || {};
    const nodes = [];
    (fd.chapters || []).forEach((chapter) => {
      ((chapter && chapter.nodes) || []).forEach((node) => {
        if (!node) return;
        const ti = node.templateInfo || {};
        nodes.push({
          name: node.name || '',
          task: ti.ruleInstructions || ti.questionName || ti.description || node.description || '',
          hint1: ti.hint1 || '',
          hint2: ti.hint2 || ''
        });
      });
    });
    return {
      title: fd.name || '',
      subtitle: fd.subtitle || '',
      description: fd.description || '',
      nodes
    };
  },

  // 预检不可用时的兜底文案(AI 不是发布的硬依赖,只降级成一条建议项)
  _precheckSkipLabel(msg) {
    if (String(msg || '').indexOf(AI_QUOTA_HINT) >= 0) {
      return 'AI 次数已用完,本次跳过安全预检(不影响发布)';
    }
    return '安全预检暂不可用,本次跳过(不影响发布)';
  },

  // 预检结果 → 并进 buildPublishCheck() 的本地判定,复用同一个弹层
  // level=error 才阻断;但 parse_error 是「AI 自己炸了」,不是用户内容有问题,降级为建议,否则 AI 一炸就没人能发布
  _showPublishCheck(aiIssues, skipLabel) {
    const local = this.buildPublishCheck();
    const blocking = local.blocking.slice();
    const advisory = local.advisory.slice();
    // AI 预检只收到文案(_buildPrecheckReq 里没有封面字段),模型永远看不到封面 ⇒ 它报的
    // missing_cover 是必然误报,而 level=error 会把「确认发布」禁用,专业编辑器从此没人能发布。
    // 封面有无归 buildPublishCheck() 本地判定,这类「AI 看不见的字段」整条丢掉。
    const issues = (aiIssues || []).filter((issue) => issue && issue.message
      && AI_BLIND_ISSUE_TYPES.indexOf(issue.type) < 0);
    issues.forEach((issue) => {
      const item = { label: issue.message, tab: '2' };
      if (issue.level === 'error' && issue.type !== 'parse_error') blocking.push(item);
      else advisory.push(item);
    });
    if (skipLabel) advisory.push({ label: skipLabel, tab: '2' });

    const summary = this._buildPublishSummary();
    // 预检通过 = 没有 AI 报的问题、也没有降级跳过。跳过时它是一条 advisory,不能算通过。
    const precheckOk = !skipLabel && !issues.length;
    this._publishPrecheckOk = precheckOk;
    const passed = this._buildPublishPassed(precheckOk);
    this.setData({
      publishCheck: {
        show: true, blocking, advisory, summary, passed, preview: this._buildPublishPreview(),
      },
    });
    this.setEditorState('publishCheck');
  },

  // 发布前 AI 安全预检(入口A):submitForm 的前置闸门
  // silentError:code!=200 由本方法接管(request-client 会自动弹一次 toast,不关掉就是双弹)
  runPublishPrecheck() {
    if (this._prechecking) return; // 防连点重复烧 AI 次数(频控 20/天 是全端点共用一池)
    this._prechecking = true;
    const token = (this._precheckToken || 0) + 1;
    this._precheckToken = token;
    cyLoading.show('安全预检中');
    app.sendRequest({
      url: '/api/ai/safety/precheck',
      method: 'POST',
      silentError: true,
      data: JSON.stringify(this._buildPrecheckReq()),
      header: { 'Content-Type': 'application/json' },
      // ★ complete 是唯一always会跑的回调,重置只能放这:
      // request-client.js:90-98 在 HTTP statusCode != 200(如部署期 502)时只弹 toast 就 return,
      // success 和 fail 一个都不调。若把重置写在 success/fail 里,一次 502 就会让
      // _prechecking 永为 true + 带 mask 的 loading 永不消失 → 之后每次点发布都被
      // runPublishPrecheck 首行的 `if (this._prechecking) return` 挡掉 = 发布按钮永久变哑巴。
      // 这条路正是本仓库部署流程里明写会出现的「200→502→200」窗口。
      complete: () => {
        this._prechecking = false;
        cyLoading.hide(); // loading 是 app 全局的,不随页面跳转消失,漏 hide 会冻住用户落到的任何页
      },
      success: (res) => {
        if (token !== this._precheckToken) return; // 已被新一次提交取代 / 页面已销毁
        if ((res.code == '200' || res.code == 200) && res.data) {
          this._showPublishCheck(res.data.issues, '');
        } else {
          // 频控/身份门禁/AI 异常:降级放行(可用性红线,AI 挂了不能堵死发布路)
          this._showPublishCheck([], this._precheckSkipLabel(res && res.msg));
        }
      },
      fail: () => {
        if (token !== this._precheckToken) return;
        this._showPublishCheck([], this._precheckSkipLabel(''));
      }
    });
  },

  // 发布弹层「继续发布」:仅在无 blocking 时出现,置一次性放行标记后重走 submitForm
  confirmPublishCheck() {
    if (this.data.publishCheck.blocking.length || !this.data.identityReady) return;
    if (this.data.identityRegistered) { this._publishAfterIdentity(); return; }
    // 先落实名、再落主题:后端两道闸就是这个顺序(/api/publisher/identity 先于 /api/topic/create
    // 的实名校验),并发两发会被拦成「请先登记实名信息」。
    this.setData({ identityError: '' });
    cyLoading.show('登记实名信息');
    publisherIdentity.registerIdentity(this.identityForm(), (r) => {
      cyLoading.hide();
      if (!r.ok) {
        // 弹层不关:字段就在原地,改完再点一次;报错用软红整块,不给输入框描红边
        this.setData({ identityError: r.message });
        return;
      }
      this.setData({ identityRegistered: true, identityReady: true, identityError: '' });
      this._publishAfterIdentity();
    });
  },

  _publishAfterIdentity() {
    this._precheckAcked = true;
    this.setData({ 'publishCheck.show': false });
    this.setEditorState('idle');
    this.submitForm();
  },

  // 发布弹层的「确认发布」被置灰时点它 —— 报第一条真缺项,不打空炮。
  onPublishCheckDisabledTap() {
    if (!this.data.identityReady) {
      const check = publisherIdentity.checkIdentityForm(this.identityForm());
      cyToast(check.ok ? '发布者实名还没登记' : check.message);
      return;
    }
    const first = this.data.publishCheck.blocking[0];
    if (first) cyToast(first.label);
  },

  // ===== RUN-52 发布者实名(发布确认弹层内联) =====
  identityForm() {
    const d = this.data;
    return {
      realName: d.identityRealName,
      idCard: d.identityIdCard,
      consented: d.identityConsented,
      identityRegistered: d.identityRegistered,
      source: publisherIdentity.SOURCE_TOPIC_PUBLISH,
    };
  },

  // 三项齐不齐只驱动「必填项」那条与 CTA 可点性;规则仍然只有 utils/publisher-identity.js 一份
  syncIdentityReady() {
    const ready = publisherIdentity.identitySatisfied(this.identityForm());
    if (ready !== this.data.identityReady) this.setData({ identityReady: ready });
  },

  onIdentityFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value, identityError: '' }, () => this.syncIdentityReady());
  },

  onIdentityConsent(e) {
    this.setData({
      identityConsented: !!(e.detail && e.detail.checked),
      identityError: '',
    }, () => this.syncIdentityReady());
  },

  // 发布弹层「去完善」:仅关闭
  closePublishCheck() {
    this.setData({ 'publishCheck.show': false });
    this.setEditorState('idle');
  },

  // 发布钮置灰 = 有硬必填没交。点它不打空炮:直接开同一张「发布前检查」弹层,
  // 逐条列还差什么 + 一键定位。纯本地判定,不烧 AI 预检次数(频控是全端点共用的池)。
  // CU-C-168:这条路径**没跑过**内容安全预检,第二个参数必须说实话 —— 传空串会被
  // 当成「跑过了且没问题」,于是弹层一边列着缺项、一边绿着「内容安全预检通过」。
  onPublishDisabledTap() {
    this._showPublishCheck([], '内容安全预检还没跑');
  },

  // 一键定位:把这一项送到它字段真正所在的那一屏(切页 / 开主题详情弹窗 / 展开票务并打开对应票单),
  // 再滚到锚点。
  // ⚠️ CU-C-160:这里原先只关层 + 页面滚顶,七条必填共用同一个动作 —— 写「去填写」却把人
  //   放回创作总览,主题详情压根没打开、editorPage 也停在 1。那种"看起来响应了"的落点比不响应更糟。
  //   没有 field 的行(AI 预检建议)不猜位置,退回原来的关层行为。
  locatePublishIssue(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const field = ds.field || '';
    this.setData({ 'publishCheck.show': false });
    this.setEditorState('idle');
    if (!field) {
      setTimeout(() => {
        wx.pageScrollTo({ scrollTop: 0, duration: 250 });
      }, 60);
      return;
    }
    const anchor = this._anchorForErrorKey(field);
    // CU-C-160 负控:空锚点 = 这一条缺项在本页认不出对应字段(旧数据、AI 建议行、
    // 或字段改了名而这里没跟上)。此时什么都不切 —— 切屏 + 开层 + 滚一个猜出来的锚点
    // 就是「假装定位成功」,比不动更糟。确认层照关,页面照回顶部。
    if (!anchor) {
      setTimeout(() => {
        wx.pageScrollTo({ scrollTop: 0, duration: 250 });
      }, 60);
      return;
    }
    this.setData({
      editorPage: ISSUE_PAGE2_ANCHORS.indexOf(anchor) >= 0 ? 2 : 1,
      topicDetailShow: ISSUE_SHEET_ANCHORS.indexOf(anchor) >= 0 ? true : this.data.topicDetailShow
    }, () => {
      // 复用提交时那条定位路:票务项要展开折叠卡并打开对应票单编辑器。
      // 主题详情弹窗的锚点在弹窗自己的容器里,页面 scroll-view 滚不动它(空滚),
      // 但弹窗已经开在字段所在的那一层 —— 剩下的距离由用户自己滑,不再骗他说"到了"。
      this.focusValidationError({ [field]: '' });
    });
  },

  // 价格输入处理函数
  onTicketPriceChange(e) {
    let {
      field,
      index
    } = e.currentTarget.dataset;
    let value = e.detail.value;

    // 移除所有非数字和小数点的字符
    value = value.replace(/[^\d.]/g, '');

    // 确保最多只有一个小数点
    const dotCount = (value.match(/\./g) || []).length;
    if (dotCount > 1) {
      value = value.slice(0, -1);
    }

    // 限制小数点后最多两位
    const parts = value.split('.');
    if (parts.length > 1) {
      if (parts[1].length > 2) {
        value = `${parts[0]}.${parts[1].substring(0, 2)}`;
      }
    }

    // 转换为数字（允许0）
    let numericValue = value === '' ? 0 : Number(value);

    this.setData({
      [`formData.tickets[${index}].${field}`]: numericValue
    });
  },
  // 提交表单
  submitForm() {
    // 一次性消费放行标记:必须在任何 early return 之前取走并清掉,
    // 否则「确认发布 → 下面某条校验拦下」会把 true 留到下一次点击,让那一版内容静默绕过预检。
    const precheckAcked = this._precheckAcked;
    this._precheckAcked = false;

    if (this.data.submitting) return;
    // 编辑态回填没到位就保存 = 拿空表单去重建,原主题的章节与票会被删光
    if (this.data.editingTopicId && !this.data.editLoaded) {
      cyToast('主题还在加载，稍等一下');
      return;
    }
    if (!this.validateForm()) {
      return;
    }

    // 经典定向团(含 mode==1 票种)且拥有俱乐部时,必须选归属俱乐部(D3/D12 一人多俱乐部)
    const isCityOrienteering = Number(this.data.formData.productType) === 1;
    if (isCityOrienteering && this.data.myClubs.length > 0 && !this.data.formData.clubId) {
      this._scrollSheetTo('fieldClub');
      cyToast('请选择路线归属的俱乐部');
      return;
    }

    // 发布者会收到招募状态与承接意向通知；只在首次「发布」tap 中请求，预检确认回调不重复弹。
    if (!precheckAcked) {
      subscribe.request(['recruit', 'clubInterest']).then((result) => {
        this._publishSubscribeStatus = result.status;
      });
    }

    // 发布前 AI 安全预检:每次提交跑一次(内容可能已改),用户在弹层点「继续发布」后一次性放行
    if (!precheckAcked) {
      this.runPublishPrecheck();
      return;
    }
    this._doSubmit();
  },

  // 真正组装 payload 并提交(与 submitForm 拆开:预检弹层确认后要能直接走到这)
  _storyPayloadChapter(chapter, chapterIndex) {
    const prepared = JSON.parse(JSON.stringify(chapter || {}));
    let sequence = 0;
    const temporaryKey = () => '_payload_' + chapterIndex + '_' + (++sequence);
    prepared._localId = prepared._localId || temporaryKey();
    prepared.nodes = Array.isArray(prepared.nodes) ? prepared.nodes : [];
    prepared.nodes.forEach((node) => {
      if (!node._localId) node._localId = temporaryKey();
      if (!node.clientNodeKey) node.clientNodeKey = node._localId;
    });
    return proEditorStory.toPayloadChapter(
      proEditorStory.materializeChapter(prepared, temporaryKey));
  },

  _nonStoryPayloadChapter(chapter) {
    const payload = JSON.parse(JSON.stringify(chapter || {}));
    delete payload.blocks;
    delete payload.schemaVersion;
    return payload;
  },

  _buildSubmitChapters(productType) {
    return this.data.formData.chapters.map((chapter, chapterIndex) => {
      const sourceChapter = productType === 1
        ? this._storyPayloadChapter(chapter, chapterIndex) : this._nonStoryPayloadChapter(chapter);
      const nodes = (sourceChapter.nodes || []).map(node => this._stripLocalFields({
        ...node,
        // 首次创建尚无数据库 id；服务端用该稳定键把 routeGraphJson 重映射到新节点。
        clientNodeKey: node.clientNodeKey || node._localId || '',
        nodeTime: parseInt(node.nodeTime || 0, 10) // 转为数字，默认0
      }));
      return this._stripLocalFields({
        ...sourceChapter,
        nodes
      });
    });
  },

  _doSubmit() {
    const productType = Number(this.data.formData.productType) === 2 ? 2 : 1;
    let chapters;
    try {
      chapters = this._buildSubmitChapters(productType);
    } catch (error) {
      // 组装章节 payload 抛错(节点引用失效等)时点「确认发布」原来是静默无反应 —— 兜住给提示。
      cyToast(app.getRequestErrorMessage(error, '故事流内容不完整，请检查后重试'));
      return;
    }

    const formattedTickets = this.data.formData.tickets.map(ticket => ({
      ...ticket,
      mode: productType,
      // [P1-41] 归一化:sync 同步来的值可能已带时间/ISO 串,原样追加会拼出非法时间
      startTime: this._normalizeDateTime(ticket.startTime, '00:00:00'),
      endTime: this._normalizeDateTime(ticket.endTime, '23:59:59'),
      // [2-26] 售票时间是 date 选择器给的纯日期串,后端 DTO 的 @JsonFormat 只吃
      // "YYYY-MM-DD HH:mm:ss";不归一化会 400,归一化口径同 startTime/endTime。
      saleStartTime: this._normalizeDateTime(ticket.saleStartTime, '00:00:00'),
      saleEndTime: this._normalizeDateTime(ticket.saleEndTime, '23:59:59')
    }));

    // 准备API数据
    let apiData = {
      name: this.data.formData.name,
      subtitle: this.data.formData.subtitle,
      description: this.data.formData.description,
      // [P1-41] 写入点格式不一('HH:mm'/'HH:mm:ss'/纯日期),原 +':00' 对后两种拼出非法串
      startDate: this._normalizeDateTime(this.data.formData.startDate, '00:00:00'),
      endDate: this._normalizeDateTime(this.data.formData.endDate, '23:59:59'),
      imgUrl: this.data.formData.imgUrl,
      imgArr: this.data.formData.imgArr,
      categoryIds: this.data.selectedCategoryIds.join(','),
      chapters: chapters,
      collaboratorIds: this.data.formData.collaboratorIds,
      // [P0-02] 产品真源:主题级模式显式上送(= 入口的 entryMode)。后端据此覆盖每张票的 mode,
      // 票里的 mode 自此不再是真源。不传则后端从票 mode 推断,混票会被拒。
      productType,
      tickets: formattedTickets, // 使用格式化后的票价数据
      // 1=进商家池 0=自办。资格归一放在 _syncMerchantPoolEligibility(确证无资格即清 formData),
      // 这里不再二次判断 —— 否则 pro-editor-policy 读到的 formData 与上送值会分家。
      openMerchantPool: this.data.formData.openMerchantPool ? 1 : 0,
      // P0-4 开放范围:1=开放给俱乐部承接 0=自办。
      // spec §2.1「邀请俱乐部带队」只属于城市定向(spec §2.1:自由探索没有俱乐部带队)。
      // 2026-09-15 裁决 12B:专业版与简易版统一默认开(默认值在 formData 初值),主办可手动关。
      // 2026-09-15 补充裁决:归属俱乐部的主题(俱乐部自办团/自动挂靠)不开放公开承接池 ——
      // 开关不露面,存量回填的 1 也在这里归 0;服务端 resolveOpenClubPool/编辑落值同样压 0,两层一致。
      // 归一放在**上送这一处**而不是各个入口:模式切换(applyEntryMode)、草稿复制
      // (_buildCopiedDraft)、编辑回填三条路都可能把 formData 带到自由探索上,
      // 而自由探索上送 1 会撞服务端 assertClubLeadOnlyForCityOrienteering 直接抛。
      openClubPool: (productType === 1 && !this.data.formData.clubId && this.data.formData.openClubPool) ? 1 : 0,
      recruitDeadline: Number(this.data.formData.productType) === 2
        ? this._normalizeDateTime(this.data.formData.recruitDeadline, '23:59:59') : null,
      publishToCreative: this.data.publishToCreative ? 1 : 0, // 1=同步到创意广场 0=否(后端 ApiTopicController.createTopic 已处理:开关开则插 dataType=2 创意广场帖)
      clubId: this.data.formData.clubId || '', // 归属俱乐部(任何 mode 传了即挂靠;经典定向未传后端自动兜底)
      // M2 自玩票:仅「经典定向」生效(后端以 ticket mode=1 再次兜底,自由定向不开)
      selfPlay: this.data.formData.selfPlay ? 1 : 0,
      selfPlayPrice: this.data.formData.selfPlayPrice || 0,
      selfPlayQuota: this.data.formData.selfPlayQuota || 0,
      teamMode: Number(this.data.formData.teamMode) || 0,
      teamMaxMembers: Number(this.data.formData.teamMaxMembers) || 4,
      // P0.5 通关勋章(XP 自动分配无需上送)
      finishMedalName: this.data.formData.finishMedalName || '',
      finishMedalImg: this.data.formData.finishMedalImg || '',
      completeRewardCouponId: this.data.formData.completeRewardCouponId || 0,
      completeRuleJson: advancedGameConfig.mergeTopicBingo(
        advancedGameConfig.mergeTopicCompletion(
          this.data.formData.completeRuleJson,
          productType === 1 ? this.data.completionRuleMode : 'ALL',
          this.data.completionRequiredCount),
        { enabled: this.data.bingoEnabled, cells: this._bingoCellsByPosition() }),
      publishMode: this.data.aiSimple ? 'ai_simple' : 'pro',
      routeMode: productType === 1 && this.data.formData.routeMode === 'BRANCH_GRAPH'
        ? 'BRANCH_GRAPH' : 'LINEAR',
      routeGraphJson: productType === 1 && this.data.formData.routeMode === 'BRANCH_GRAPH'
        ? (this.data.editingTopicId
          ? topicRouteGraph.serialize(this._routeGraph)
          : topicRouteGraph.serializeWithNodeKeys(this._routeGraph)) : '',
      configVersion: this.data.formData.configVersion || '',
      scope: this.data.operationScope
    };

    // 已过审开卖的主题只许改文案与图:日期 / 章节站点结构 / 票价后端一律拒收(方案 §6 口径)。
    // 这里主动剔掉,而不是指望后端忽略 —— 整包上送会当场被拒,用户看到的是「保存失败」而不是「保存成功但没变」。
    if (this.data.editingTopicId && this.data.editScope === 'WHITELIST') {
      if (!this._assertLockedFieldsUntouched()) return;
      apiData = {
        name: apiData.name,
        subtitle: apiData.subtitle,
        description: apiData.description,
        imgUrl: apiData.imgUrl,
        imgArr: apiData.imgArr,
        categoryIds: apiData.categoryIds,
        scope: this.data.operationScope
      };
    }

    // 调用API
    this.sendData(apiData);
  },
  // 发布提交状态机(防重/失败回退/销毁守卫走共享 publish-workflow;url/analytics/toast/跳转保持本页)
  getPublishWorkflow() {
    if (!this._publishWorkflow) {
      this._publishWorkflow = createPublishWorkflow({
        request: (payload, cb) => {
          // 编辑既有主题走 update(带 id),新建才走 create。
          // 在 request 里读而不是建 workflow 时读:workflow 是懒建且只建一次,建它那一刻回填可能还没到。
          const editingId = this.data.editingTopicId;
          sendUiStateRequest(app, editingId ? '/api/topic/update' : '/api/topic/create', {
            data: JSON.stringify(editingId ? Object.assign({}, payload, { id: editingId }) : payload),
            method: "POST",
            header: {
              'Content-Type': 'application/json'
            },
            success: (res) => {
              if (res.code == "200") cb({ ok: true, data: res.data });
              else cb({ ok: false, msg: res.msg });
            },
            fail: () => cb({ ok: false, networkError: true })
          });
        }
      });
    }
    return this._publishWorkflow;
  },

  // 发送数据到API
  sendData(data) {
    let that = this;
    const started = that.getPublishWorkflow().submit(data, {
      onSuccess: (resData) => {
        that._draftAutosaveReady = false;
        that._clearDraftEnvelope();
        // 改已有主题走这条:不进发布成功那套全屏弹层(它的「去招商家 / 预览玩家视角」
        // 对已存在的主题没意义)。这里只报结果、然后回项目主页,没有导航分叉,
        // 正是 result-sheet 的形状。
        if (that.data.editingTopicId) {
          // ⚠️ 文案只说「已发布」:这条链路的 CTA 从头到尾是「检查并发布」,
          // 产品里没有「保存」这个概念(2026-09-05 用户当面纠正),别再写回「已保存」。
          // ⚠️ 不用 master 新引入的 cyToast:用户 2026-09-05/09-06 两次裁决要的是结果面板
          // (徽章 + 动效 + 自愈后跳转),toast 正是被它替代的那一档,不是并列选项。
          // 跳转挂在面板 close 上(落点写进 _resultSheetNext),不再另起 setTimeout ——
          // 面板自愈与硬等两个时长各算各的迟早会漂。
          that._resultSheetNext = '/pages/topic/merchantinfo/merchantinfo?topicId='
            + that.data.editingTopicId + (that.data.operationScope ? '&scope=MERCHANT' : '');
          that.setData({
            submitting: false, submitError: '',
            resultSheet: { show: true, kind: 'success', title: '已发布',
              sub: '这份主题的改动已经发布。', why: '', duration: RESULT_SHEET_MS }
          });
          return;
        }
        analytics.track('topic_publish_success', {
          bizType: 'topic',
          bizId: resData && resData.id ? resData.id : null,
          properties: {
            name: data.name
          }
        });
        const tid = resData; // 后端返回 topicId
        that.setData({ submitting: false, submitError: '' });
        // 发完落到项目主页(主办视图),不是玩家买票页 —— 那页是给买票的人看的,
        // 发布者要的是「谁来接、谁来带团、卖了多少」。招商家和招俱乐部两个入口都在那儿。
        const scopeSuffix = that.data.operationScope ? '&scope=MERCHANT' : '';
        const projectListUrl = '/subpackageA/pages/myproject/index'
          + (that.data.operationScope ? '?scope=MERCHANT' : '');
        const projectUrl = tid ? ('/pages/topic/merchantinfo/merchantinfo?topicId=' + tid + scopeSuffix)
                               : projectListUrl;
        /* 2026-09-06 用户裁决「统一」:发布成功也不再放按钮,报一下就自己收、直接落到
           项目主页。原来两颗按钮是「去项目主页 / 预览玩家看到的」—— 两个都只是选去哪一页,
           不是「留在原地」那种真分叉。
           「预览玩家看到的」这条出口一度随之断掉:goTopicDetail 只在**承接视图**
           (project-join 的「我承接的」卡)上冒泡,而发完落到的是**主办视图**,那边没有入口。
           已在 project-host 标题下补了「预览玩家看到的」,路径接回来了。补在项目主页
           而不是把按钮加回本弹层 —— 发完就落到那一页,下一眼就能点到。
           ⚠️ 这一条推翻了旧交接稿 §4「S28 保留两颗按钮不自愈」。§4 的理由是「有导航分叉」,
           用户这次的裁决就是不要这个分叉。 */
        const chapterCount = (data.chapters || []).length;
        that._resultSheetNext = projectUrl;
        that.setData({
          resultSheet: {
            show: true, kind: 'success', title: '城市路线已发布',
            sub: tid ? '接下来去招商家承接站点、找俱乐部带团。' : '路线已进入你的项目列表。',
            meta: chapterCount ? (chapterCount + ' 个章节') : '',
            why: '', duration: RESULT_SHEET_MS,
          }
        });
      },
      onFail: (res) => {
        const reason = res && res.networkError
          ? '网络暂时不可用，当前草稿仍在本机，请重试'
          : ((res && res.msg) || '保存失败，当前内容已保留，请重试');
        that.setData({
          submitting: false,
          submitError: reason,
          // 面板只负责「说清楚发生了什么」,它自愈;重试出口是页内那条 cy-inline-error,
          // 它跟着 submitError 一直留在页上 —— 把恢复动作放进会自己消失的面板里是丢出口。
          // meta 带「草稿仍在本机」(稿 D):失败这一刻用户最想知道的是"我白写了吗",
          // 这句直接回答它,而且是真的 —— 本地草稿信封没被清(见 _clearDraftEnvelope
          // 只在成功路径调用)。
          resultSheet: { show: true, kind: 'fail', title: '这次还没有发布出去',
            sub: '内容都还在,修好后可以直接重试', meta: '草稿仍在本机',
            why: reason, duration: RESULT_SHEET_MS }
        });
      }
    });
    // submit 在途会返回 false(防重),仅真正发起时点亮 loading
    if (started) {
      that.setData({ submitting: true, submitError: '' });
    }
  },

  /* 面板收掉才跳走 —— 落点由各成功路径事先写进 _resultSheetNext。
     只有一处跳转、只有一个时长(面板的 duration),不再有「setTimeout 和面板各算各的」。
     失败与 loading 不设落点,收掉就只是关面板。 */
  closeResultSheet() {
    const next = this._resultSheetNext;
    this._resultSheetNext = '';
    this.setData({ 'resultSheet.show': false });
    if (next) wx.redirectTo({ url: next });
  },

  // 稿 S15/S16 的「为什么会这样」:出错时除了那一句结果,还得能展开看到人能照做的下一步。
  toggleSubmitErrorWhy() { this.setData({ submitErrorWhy: !this.data.submitErrorWhy }); },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    //this.updateStatistics();
    this.syncNodeGameSwitchWithTemplate();
  },

  /**
   * CU-C-164:「配置模板」开关的唯一真源是 nodesForm.templateId(开关态不入库,见 onToggleNodeGame)。
   * 从玩法编辑器点「放弃未保存的玩法」返回时没人回传 ⇒ 回来的那一刻 templateId 还是 0,
   * 而 showTemplate 停在 true:开关绿着、下面只给「选择或创建玩法模板」,是个点了必落空的假已配置。
   * 返回本页时按同一判据重派生一次(只在节点抽屉开着时,别顺手改到没在看的表单项)。
   */
  syncNodeGameSwitchWithTemplate() {
    if (!this.data.popChapterNodes) return;
    const nodesForm = this.data.nodesForm || {};
    const on = !!Number(nodesForm.templateId);
    if (on !== !!nodesForm.showTemplate) this.setData({ 'nodesForm.showTemplate': on });
  },

  // 更新统计信息
  updateStatistics() {
    let chapters = this.data.formData.chapters;
    let totalNodes = 0;

    if (chapters) {
      chapters.forEach(chapter => {
        if (chapter.nodes) {
          totalNodes += chapter.nodes.length;
        }
      });
    }

    this.setData({
      totalNodes: totalNodes,
      totalDuration: this.calculateTotalDuration()
    });
  },

  onBingoToggle(e) {
    this.setData({ bingoEnabled: !!e.detail.value, bingoError: '' });
  },
  /** 视图是 S 形序,存回去要按格位序 —— 存错序等于九格的奖全对错了格子 */
  _bingoCellsByPosition() {
    const cells = advancedGameConfig.BINGO_S_ORDER.map(() => ({ label: '', couponId: 0, feedbackText: '' }));
    (this.data.bingoRows || []).forEach((row) => {
      cells[row.pos] = { label: row.label, couponId: row.couponId, feedbackText: row.feedbackText };
    });
    return cells;
  },
  _setBingoRow(index, patch) {
    const rows = this.data.bingoRows.map((row, i) => (i === index ? Object.assign({}, row, patch) : row));
    this.setData({ bingoRows: rows, bingoError: '' });
  },
  onBingoLabelInput(e) {
    this._setBingoRow(Number(e.currentTarget.dataset.index), { label: e.detail.value });
  },
  onBingoCouponChange(e) {
    const detail = e.detail || {};
    this._setBingoRow(Number(e.currentTarget.dataset.index), {
      couponId: Number(detail.couponId || 0), couponName: detail.couponName || ''
    });
  },
  onBingoFeedbackInput(e) {
    this._setBingoRow(Number(e.currentTarget.dataset.index), { feedbackText: e.detail.value });
  },


  // 计算总时长
  calculateTotalDuration() {
    return publishStats.totalDurationText(this.data.formData.chapters);
  },

  // 弹框内切换分类选择
  toggleCategorySelect: function (e) {
    var that = this
    let categoryId = e.currentTarget.dataset.id;
    let categoryName = e.currentTarget.dataset.name;
    let selectedIds = this.data.selectedCategoryIds.slice();
    let selectedNames = this.data.selectedCategoryNames.slice();
    let index = selectedIds.indexOf(categoryId);
    let categoryList = that.data.categoryList

    if (index > -1) {
      // 取消选择
      selectedIds.splice(index, 1);
      selectedNames.splice(index, 1);

      for (let i = 0; i < categoryList.length; i++) {
        if (categoryId == categoryList[i]['id']) {
          categoryList[i]['isChecked'] = 0;
        }
      }
    } else {
      // 添加选择
      selectedIds.push(categoryId);
      selectedNames.push(categoryName);

      for (let i = 0; i < categoryList.length; i++) {
        if (categoryId == categoryList[i]['id']) {
          categoryList[i]['isChecked'] = 1;
        }
      }
    }

    this.setData({
      selectedCategoryIds: selectedIds,
      selectedCategoryNames: selectedNames,
      categoryList: categoryList,
    });
  },

  // 显示多选弹框
  showMultiSelectModal: function () {
    this.setData({
      showMultiSelectModal: true
    });
  },

  // 隐藏多选弹框
  hideMultiSelectModal: function () {
    this.setData({
      showMultiSelectModal: false
    });
  },

  // 确认选择
  confirmMultiSelect: function () {
    // 更新表单数据中的categoryIds
    this.setData({
      showMultiSelectModal: false,
      'formData.categoryIds': this.data.selectedCategoryIds
    });

  },

  // 搜索事件处理函数
  handleSearch: function (e) {
    const keyword = e.detail.value; // 获取输入框的值
    this.setData({
      searchKeyword: keyword
    });

    // 执行搜索逻辑
    this.getTempList(keyword);
  },

  // 选择模板事件
  selectTemp: function (e) {
    const item = e.currentTarget.dataset.item;
    if (!isRecord(item) || !item.id) return;
    const tempId = item.id;

    if (this.data.selectedTempId === tempId) {
      this.setData({
        selectedTempId: null,
        selectedTempInfo: null
      });
    } else {
      this.setData({
        selectedTempId: tempId,
        selectedTempInfo: item
      });
    }
  },

  // 完成按钮事件
  confirmTemp: function () {
    if (!this.data.selectedTempInfo) {
      cyToast('请先选择一个模板');
      return;
    }
    const selectedTemplate = this.data.selectedTempInfo;
    if (this._insertAlbumTemplate(selectedTemplate)) return;
    this.setData({
      nodeSheetView: 'detail',
      'nodesForm.templateId': selectedTemplate.id,
      'nodesForm.templateInfo': selectedTemplate
    });
  },
  /**
   * 本站玩法开关。关 = 纯到达打卡(走到即完成)。
   * 开关态不入库(NodeDTO 没有 showTemplate),开抽屉时由 templateId 派生,
   * 因此关掉时必须把 templateId/templateInfo/templateName 一并清空 ——
   * 否则重开抽屉会被派生回"开",看着像开关没保存。
   */
  onToggleNodeGame: function (e) {
    const on = !!(e && e.detail && e.detail.value);
    if (on) {
      this.setData({ 'nodesForm.showTemplate': true });
      // 2026-08-20 用户拍板:开「配置模板」不再停在 sheet 内的玩法选择视图,
      // 没绑过模板就直接进模板编辑器(标题在编辑器里填);已绑过的走药丸改配置。
      if (!Number(this.data.nodesForm.templateId)) this.onCreateGame();
      return;
    }
    this.setData({
      'nodesForm.showTemplate': false,
      'nodesForm.templateId': 0,
      'nodesForm.templateInfo': {},
      'nodesForm.templateName': ''
    });
  },
  // 半屏 sheet 打开时吃掉背景滚动(catchtouchmove 需要一个真实存在的 handler)
  noop() {},
  // 切换到游戏选择视图
  showTemp: function () {
    const info = this.data.nodesForm && this.data.nodesForm.templateInfo;
    this.setData({
      nodeSheetView: 'games',
      selectedTempId: this.data.nodesForm && this.data.nodesForm.templateId ? this.data.nodesForm.templateId : null,
      selectedTempInfo: info && info.title ? info : null
    });
  },
  // 从游戏选择视图返回详情视图（取消）
  cancelTemp: function () {
    this.setData({
      nodeSheetView: 'detail',
      selectedTempId: null,
      selectedTempInfo: null
    });
  },
  // 返回按钮：回到节点详情视图
  backToNodeDetail: function () {
    this.setData({
      nodeSheetView: 'detail',
      selectedTempId: null,
      selectedTempInfo: null
    });
  },
  // 新建玩法：跳转 temp 编辑器，回来经 EventChannel 绑定到当前节点
  onCreateGame: function () {
    const that = this;
    const themeName = this.data.formData.name;
    const nodeName = this.data.nodesForm.name || ('站点' + (this.data.editTargetNodeLid || ''));
    wx.navigateTo({
      url: '/pages/publish/temp/index?from=fabu&themeName=' + encodeURIComponent(themeName || '')
        + '&nodeName=' + encodeURIComponent(nodeName || '')
        + (this.data.operationScope ? '&scope=MERCHANT' : ''),
      events: {
        templateCreated(tpl) {
          if (!tpl || !tpl.id) return;
          if (that._insertAlbumTemplate(tpl)) return;
          const templateInfo = Object.assign({}, tpl, {
            title: tpl.title || '',
            imgUrl: tpl.imgUrl || '',
            players: tpl.players,
            duration: tpl.duration
          });
          that.setData({
            nodeSheetView: 'detail',
            'nodesForm.templateId': tpl.id,
            'nodesForm.templateInfo': templateInfo
          });
          cyToast.success('已绑定新玩法');
        }
      }
    });
  },

  // 公共玩法库。用 /api/template/homeData —— 它不需要 category_id,和创意广场/发布引导页
  // 是同一个数据源(三处已在用),而 /api/template/list 必须带分类,拿"全部"没有稳妥参数。
  // ⚠️ 拉不到就留空并在界面上直说,不塞占位假模板:选中一个不存在的 templateId
  // 会让玩家端到了点位打不开玩法,而创作者这边显示"已配置"。
  getPublicTempList: function () {
    var that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/homeData',
      method: 'POST',
      data: {},
      success: function (res) {
        if (!(res && res.code == '200' && res.data)) { that.setData({ publicTempList: [] }); return; }
        var d = res.data;
        var merged = [].concat(d.recommendList || [], d.hotList || [], d.latestList || []);
        var seen = {};
        var rows = merged.filter(function (item) {
          if (!item || item.id == null || seen[item.id]) return false;
          seen[item.id] = true;
          return true;
        });
        that.setData({ publicTempList: rows });
      },
      fail: function () { that.setData({ publicTempList: [] }); },
    });
  },

  getTempList: function () {
    var that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/template/my-list',
      method: "POST",
      data: {
        is_quote: 1,
        keyword: that.data.searchKeyword,
        scope: that.data.operationScope,
      },
      success: function (res) {
        if (res.code == "200" && res.data && isRecordList(res.data.rows)) {
          that.setData({
            tempList: res.data.rows,
          })
        } else {
          // 无真实模板时显示空,避免把 mock 假模板插入节点
          that.setData({ tempList: [] })
        }
      },
      fail: function (res) {
      },
      complete: function () {

      }
    })
  },

  // 为节点选择地点
  choosePoiForNode() {
    const that = this;
    // wx.chooseLocation(经 pickLocation)返回坐标系为 gcj02,与 <map> 一致,无需转换
    pickLocation({
      onPick(poi) {
        // 更新节点表单数据(保留 nodesForm 其它字段)
        that.setData({
          nodesForm: {
            ...that.data.nodesForm,
            name: that.data.nodesForm.name || poi.name,
            address: poi.address,
            longitude: poi.longitude,
            latitude: poi.latitude
          },
          mapCenter: { longitude: poi.longitude, latitude: poi.latitude },
          mapScale: Math.max(that.data.mapScale, 16)
        }, function () {
          that.buildRouteMap();
          cyToast('地点已定位到地图');
        });
      }
    });
  },
  openTimePopup: function () {
    this.setData({
      'timePicker.show': true
    });
  },

  // 2026-09-05 用户裁决:删掉「合作者」选择器。它只是署名,没有任何协作权限
  // (编辑/删除的归属校验只认 cms_topic.member_id,cms_collaborators 从不参与鉴权),
  // 而且选择器拉的是全平台用户、搜索框还没接过滤 —— 名字叫「合作者」却做不了协作。
  // ⚠️ 保留 formData.collaboratorIds:它被 getUserData 自动种上当前用户(isOwner=1),
  // 玩家端主题页的「发起人」署名和后端「整体替换」防误清空闸都依赖它;清空会连署名一起没。
  // 显示编辑弹框
  // 编辑输入框变化
  // 取消编辑
  // 确认编辑
  // 计算单个章节的统计信息
  calculateChapterStats(chapter) {
    return publishStats.chapterStats(chapter);
  },

  // 计算所有章节的总统计信息
  calculateTotalStats() {
    return publishStats.totalStats(this.data.formData.chapters || [], this.calculateTotalDistance());
  },

  // 计算总里程（优化版：增加经纬度有效性校验）
  calculateTotalDistance() {
    return publishStats.totalDistanceKm(this.data.formData.chapters || []);
  },
  // 更新所有统计信息
  updateAllStatistics() {
    const chapters = this.data.formData.chapters || [];
    const chapterStats = [];

    // 计算每个章节的统计信息
    chapters.forEach(chapter => {
      chapterStats.push(this.calculateChapterStats(chapter));
    });

    // 计算总统计信息
    const totalStats = this.calculateTotalStats();

    this.setData({
      chapterStats: chapterStats,
      totalStats: totalStats,
      completeness: this.computeCompleteness()
    }, () => this.refreshPrimaryActionState());

    // 路线变更 → 合并重绘地图 Hero(debounce,批量变更只重绘一次)
    this._scheduleRouteMap();
    if (this.data.formData.routeMode === 'BRANCH_GRAPH') this.refreshRouteGraph();
  },

  // setData 限频:仅 updateAllStatistics 路径走此 ~120ms debounce,
  // 连续/批量路线变更合并成一次 buildRouteMap 重绘;
  // selectNode / onMarkerTap 的即时高亮仍直调 buildRouteMap,不走这里。
  _scheduleRouteMap() {
    if (this._routeMapTimer) clearTimeout(this._routeMapTimer);
    this._routeMapTimer = setTimeout(() => {
      this._routeMapTimer = null;
      this.buildRouteMap();
    }, 120);
  },

  // —— 路线地图 Hero(Strava 化)——
  // 将 chapters[].nodes[] 按章节顺序展平,产出 markers / polyline / includePoints
  // 路线地图视图 = 纯函数,见 utils/publish/route-map-view.js。
  // 这里只做三件页面才能做的事:取 data 切片、存 markerMap 反查表、setData。
  // 配色/简化阈值/折线规则那 178 行搬去模块后有了单测覆盖 —— 埋在页面里时一行都没有。
  buildRouteMap() {
    const view = routeMapView.buildRouteMapView({
      chapters: (this.data.formData && this.data.formData.chapters) || [],
      selectedNodeLid: this.data.selectedNodeLid,
      pendingMaterials: this.data.pendingMaterials,
      popChapterNodes: this.data.popChapterNodes,
      nodesForm: this.data.nodesForm,
      popChapterNodesAction: this.data.popChapterNodesAction,
    });
    this._markerMap = view.markerMap; // markerId → {chapterLid, nodeLid} 反查表(供 M1.2 bindmarkertap)
    this.setData(view.patch);
  },

  // 完整度 pill 展开/收起缺失项
  toggleCompletenessDetail() {
    this.setData({ _showCompletenessDetail: !this.data._showCompletenessDetail });
  },

  // 路线完整度评分:口径对齐 validateForm(每个节点都必须有可用坐标)
  // 返回 {percent, missing:[...]};在 updateAllStatistics 末尾调用
  computeCompleteness() {
    return publishStats.computeCompleteness(this.data.formData || {}, {
      startDateTime: this.data.startDateTime,
      endDateTime: this.data.endDateTime,
      selectedCategoryIds: this.data.selectedCategoryIds,
    });
  },

});
