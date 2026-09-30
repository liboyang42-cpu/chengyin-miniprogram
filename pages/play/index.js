// 城瘾 · 游玩页(深色地图沉浸版)
// 视觉真值:编码助手「城瘾游玩页.dc.html」;对接说明见 docs/游玩页-深色地图沉浸版-对接说明.md
// 数据:GET /api/play/nodes(现网) — 缺坐标/章节/模板呈现字段时做降级;扫码 /checkin、答题 /answer、到达 /arrive。
const cyModal = require('../../utils/modal.js');
const cyLoading = require('../../utils/loading.js');
const cyToast = require('../../utils/toast.js');
const motion = require('../../utils/motion.js');
const app = getApp();
const bgTracker = require('../../utils/location/bg-tracker.js');
const analytics = require('../../utils/analytics.js');
const { activityShareFromEvent } = require('../../utils/activity-share.js');
const geo = require('../../utils/geo.js'); // 纯地理/时间工具(haversine/营业窗判定),可单测
const recommend = require('./utils/play-recommend.js'); // P0 推荐评分(纯函数,已单测)
const { buildPlayRoute, createSessionClock, formatElapsed } = require('../../utils/play-ui-contract.js');
const { readPausedRun, writePausedRun, clearRunSession, saveServerPausedRun, clearServerRunSession, readServerPausedRun, newerPausedRun } = require('./utils/play-run-session.js');
const { resolveLeadMemberTicket } = require('./utils/lead-ticket-scan.js');
const { routeColorForKey, ROUTE_BORDER_COLOR } = require('../../utils/play-visual-tokens.js');
const { getPlayMapState, getPlayRouteNodeState } = require('../../utils/play-state-contract.js');
const gameSessionClient = require('../../utils/game-session-client.js');
const {
  normalizePlayerProjection,
  buildPlayerChoiceInput,
  buildPlayerSubmissionInput,
  buildPlayerRoleConfirmInput,
  buildPlayerHintInput,
  buildPlayerRevealInput,
  mergeConfirmedReceipt,
  completedRouteSegment,
  normalizePlayerPendingWrite,
  normalizePlayerPendingReceiptIndex,
} = require('./utils/player-game-module.js');
const { readReducedMotion, writeReducedMotion } = require('../../utils/motion-preference.js');
const { chinaParts, formatDayDots } = require('../../utils/datetime.js');
const npcFigure = require('./utils/npc-figure.js');   // 低模人形:几何代码里生成,不依赖模型资产
const { pickPlayKit, pickJourneyCheck, checkReceiptView, serverAction, serverPayload, dailySignRevealState, applyStoryVars } = require('./utils/playkit-view.js'); // v5.1 新玩法:会话视图→可渲染 kit

const RUN_HOLD_MS = 3000;   // 主键长按结束:与漫游页 END_HOLD_MS 同一口径

const { buildMilestone } = require('./utils/play-milestone.js'); // C 分享卡里程碑轴(纯函数,已单测)
const { fromHttpStatusAbnormal } = require('../../utils/transport/failure-envelope.js');
const { getScene } = require('../../utils/scene-registry.js');
const { resolveOpenState } = require('./utils/play-open-state.js');
const { pushScene, popScene, currentScene, exitDecision } = require('../../utils/scene-stack.js');
const finishRouteRecommendation = require('./finish-route-recommendation.js');
const { buildPlayRecap } = require('./recap.js');
const { summarizePuzzleScores } = require('./utils/play-puzzle-summary.js');
const { normalizeAtmosphere, atmosphereClass } = require('../../utils/chapter-atmosphere.js');
const {
  normalizeRouteState,
  applyRouteStateToNodes,
  resolveNextRouteNode,
  orderedJourneyNodes,
  buildVisibleRoutePath,
  createRouteActionStore,
  isRouteConflict,
} = require('./utils/play-route-state.js');
// 顶部浮层的纵向起点:必须由微信胶囊的真实位置算出。原来 .play-header-wrap 写死 top:104rpx,
// 实拍就是压在胶囊底下、「更多」被吃掉半个字(2026-08-04)。漫游页早就用这套,这里对齐。
const { resolveMenuChrome } = require('../../utils/nav-safe-area.js');
const { isRecord, isRecordList } = require('../../utils/response-shape.js');
const { isPrefabLife } = require('../../utils/play-engine.js');

// canvas(足迹卡截图)只能吃字面色,拿不到 CSS 变量 ⇒ 下面两组必须是字面值,
// 取值与 style/tokens.wxss 及 index.wxss 的叙事层色板保持同步。
// mode2 开卡包的四拍时长(ms)。这套数是在动效台上逐档试出来的定稿,别单独改一个:
// 蓄力太短就没有「憋住」的张力,发牌间隔一小就退回「一起掉」。
const PACK_CHARGE = 1000;   // ② 蓄力:摇 + 四周压暗
const PACK_TEAR = 640;      // ③ 横撕:封口条向右扯走 + 撕口自左向右露出 + 爆炸
const DEAL_STAGGER = 240;   // ④ 每张卡的发牌间隔(动效台 120ms × 0.5× 速度)
const DEAL_FLIGHT = 1600;   // ④ 单张飞行总时长(动效台 800ms × 0.5×;弧顶在 52%,见 index.wxss)
const DEAL_ARC = 0.52;      // 弧顶所处的进度,WXSS 两段 transition 的分界必须与之一致
// 弧顶态的缩放,必须与 index.wxss 的 .fx-tile.is-flying 一致:决定夹取时按多大的卡片留边。
// (待机态的 scale 不需要在这里出现 —— 量尺寸时用 .is-measuring 把 transform 整个关掉,
//  比从变换后的框反推可靠得多:那个框同时吃了 scale 和 rotate,反推必然带误差。)
const DEAL_MID_SCALE = 0.78;
// 扇形半跨:4 家和 6 家都用同一个角。原来 4 家 36°/6 家 54° 摊得太开,
// 收到 ±14° 之后是「从包口窄窄地喷出来」,不是「甩出去一个扇面」。
const DEAL_SPREAD = 14;
// ⑤ 点卡 → hero 展开(2026-09-05,参考 cibby · shelf):卡片从格子原位放大飞到屏幕上部,
//   背景换成这家的模糊图,文字在卡片落定后依次上滑。WXSS .fx-hero__card 的 transform 过渡
//   时长必须与此同步(play-seat-hero-contract 锁)。
const HERO_DUR = 420;
/* 故事流「快滑」阈值:每帧位移超过它就不就地显形,一律等停下来那一刻再补。
   18px/frame 是样机定的那条线 —— 再高文字会在飞驰中一闪而过,再低慢滑也被判成快滑。 */
const STORY_FAST_PX = 18;
// ③′ 拖拽撕开(2026-08-20):横撕从「点一下自动播」升级为「手指跟随」。
// tap 四拍原样保留 —— 拖拽是并行入口,不动 PACK_* 那组定稿。
const TEAR_MAX_PX = 170;    // 撕满需要的水平拖距(px)≈ 卡包宽的 80%
const TEAR_DONE_PCT = 60;   // 松手时撕过这个进度就算撕开,不足弹回
const TEAR_SNAP = 180;      // 松手后补完/弹回的过渡时长(ms),与 WXSS .is-snap 同步
// 爆炸强度(动效台 180):光条数和碎片飞行距离都按它缩放。
const BLAST_POWER = 1.8;
const BLAST_SHARDS = 60;
// 爆炸的镭射色谱:碎片/光条都从这条色谱取色,不是随机彩虹 ——
// 同一条色谱才读作「包装膜炸碎了」,随机彩虹读作「撒了彩纸」。
const HOLO = ['#BFE8E0', '#C9D8EE', '#D8C8E8', '#F5D6C8', '#F2E3B8'];

const BRAND = '#FFFFFF';                                              // = --cy-color-play-accent
// Canvas 不能读取 WXSS 变量；逐字同步 style/tokens.wxss 的 play-story 色板。
// 这组只服务 Figma 220:1415/1437 完赛路线缩略图与保存卡，不改变游玩主舞台主题。
const PLAY_STORY_CARD = Object.freeze({
  page: '#FFFFFF',
  surface: '#F6F7FA',
  text: '#111111',
  muted: '#5E6470',
  line: '#8B8F99',
  accent: '#4B46F5',
  fade: '#8C91A0',
  ring: '#FFFFFF',
  footer: 'rgba(17,17,17,.35)',
});

// 营业态是「状态」,即便在沉浸页也必须服从系统(迁移矩阵 §2.3)。
// 这三个值只进 wxml 的 inline style(<view style="background:{{openDot}}">),CSS 变量在那里能正常解析。
// 营业态三色已随换算逻辑一起搬进 utils/play-open-state.js —— 本文件不再自留副本。

// S9 暗色底图配置已抽到 utils/map-style.js(roam 页共用同一份,避免只改一页导致半暗半亮)。
// 接入文档见 components/cy/free-map/DARK_MAP.md。
const { MAP_STYLE: MAP_DARK } = require('../../utils/map-style.js');
// 服务端 UUID_PATTERN 只收 v4 UUID —— 自造的 'shop-xxx' 会被入参校验直接判 INVALID_REQUEST
/** 卡片转到什么角度才该露出侧脊。
 *  正面/背面朝前时侧脊在几何上是零宽,但实测 ry=0 仍会在卡片两侧漏出两条竖条,
 *  所以按角度显式收掉 —— 别指望 3D 变换刚好把它压没。 */
function turnedAt(ry) {
  const a = ((Number(ry) || 0) % 180 + 180) % 180;
  return a > 8 && a < 172;
}

function uuid4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  });
}

function req(url, method, data) {
  return new Promise((resolve) => {
    app.sendRequest({
      url, method, data, hideLoading: true,
      success: (res) => resolve(res || {}),
      // request-client 对 HTTP 非 200 只调 successStatusAbnormal；必须结束 Promise，
      // 否则首屏加载与节点提交的恢复逻辑会永久等待。
      // HTTP 已返回并不等于请求没送达；尤其 POST 可能已经执行，不能开放盲重试。
      // 强制覆盖 body.code，避免网关错误体里的 200/402 被误当成业务成功/购票态。
      successStatusAbnormal: (res) => resolve(fromHttpStatusAbnormal(res)),
      // netFail 让调用方能区分「请求没送到」与「服务端说不行」—— 二者都走 code!=200,
      // 光看 code 分不出来(submitGame 曾因此把断网当成答错)。
      fail: () => resolve({ code: 'fail', netFail: true, msg: '网络异常，请重试' })
    });
  });
}

function isScanCancelled(error) {
  const message = (error && error.errMsg) || '';
  return /cancel/i.test(message);
}

function parseGameCompletedAt(value) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value.trim().replace(/-/g, '/').replace('T', ' '));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function matchingPlayerTerminalReceipt(result, pending, expectedOutcome) {
  const command = pending && pending.command;
  const receipt = result && result.receipt;
  const activityId = command ? command.activityId : (pending && pending.activityId);
  if (!pending || !receipt) return null;
  const receiptId = Number(receipt.receiptId);
  const revision = Number(receipt.revision);
  if (!Number.isSafeInteger(receiptId) || receiptId <= 0
    || activityId == null || receipt.activityId == null
    || String(receipt.activityId) !== String(activityId)
    || !pending.requestId || (command && command.requestId !== pending.requestId)
    || receipt.requestId !== pending.requestId
    || !pending.action || (command && command.action !== pending.action)
    || receipt.action !== pending.action
    || String(receipt.outcome || '').toUpperCase() !== expectedOutcome
    || receipt.revision == null || receipt.revision === ''
    || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (result.requestId != null && result.requestId !== pending.requestId) return null;
  return receipt;
}

function normalizePlayerRevealText(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= 200 ? text : '';
}

// 2026-09-18 UI-20 返修:发布端历史默认章节名是英文占位「Chapter N」,原样上屏就是玩家看到的
// 「Chapter 1」。占位名一律显示成「第 N 章」(N 取占位里的数字,没有就用章节序号);
// 真实章节名原样保留;空名回落到调用方给的兜底文案。
const CHAPTER_PLACEHOLDER_NAME = /^chapter\s*(\d+)?$/i;
function displayChapterName(raw, index, fallback) {
  const name = String(raw == null ? '' : raw).trim();
  const matched = CHAPTER_PLACEHOLDER_NAME.exec(name);
  if (matched) return '第 ' + (matched[1] ? Number(matched[1]) : index + 1) + ' 章';
  return name || fallback || '';
}

function isChapterPlaceholderName(raw) {
  return CHAPTER_PLACEHOLDER_NAME.test(String(raw == null ? '' : raw).trim());
}

function buildMockPlayData(kind) {
  const free = kind !== 'city';
  const nodes = [
    {
      nodeId: 1001, sortId: 1, name: '街角绿地补给点', address: '复兴公园南门',
      latitude: 31.21784, longitude: 121.46423, imgUrl: '/pages/play/images/d_topic1.png',
      description: '找到最安静的一张长椅,拍下今天的城市颜色。', hookText: '离你最近,适合先热身',
      cardHookLong: '这里不需要按路线走,靠近后完成一次观察打卡。', validationMethod: 2,
      gameTitle: '城市颜色采样', photoRequireDesc: '拍一张能代表此刻心情的城市细节', storyText: '树影、路灯和行人的脚步,会把城市切成很多层。',
      fragmentText: '你拿到了一枚「午后光斑」。'
    },
    {
      nodeId: 1002, sortId: 2, name: '梧桐下的橱窗', address: '思南路街区',
      latitude: 31.21932, longitude: 121.46716, imgUrl: '/pages/play/images/d_topic2.png',
      description: '观察一处橱窗或门牌,找出它和这条街的关系。', hookText: '有合作商户标记', merchantId: 10001,
      cardHookLong: '如果正在营业,可以把这里当成路线中的停靠点。', validationMethod: 1,
      gameTitle: '门牌线索', question: '这条街最常出现的树是什么?', answerReveal: '梧桐', feedbackText: '答案藏在抬头能看到的树冠里。',
      fragmentText: '你拿到了一枚「旧街门牌」。'
    },
    {
      nodeId: 1003, sortId: 3, name: '隐蔽展墙', address: '淮海中路支弄',
      latitude: 31.22224, longitude: 121.47042, imgUrl: '/pages/play/images/d_topic4.png',
      description: '进入支弄,找到一面被海报或涂鸦覆盖的墙。', hookText: '更适合自由绕路发现',
      cardHookLong: '不是必经站,但完成后会解锁一段城市手记。', validationMethod: 5,
      storyText: '支弄里的墙面会保存很多短暂出现过的生活痕迹。', fragmentText: '你拿到了一枚「支弄回声」。'
    },
    {
      nodeId: 1004, sortId: 4, name: '黄昏观景口', address: '新天地北里',
      latitude: 31.22458, longitude: 121.47518, imgUrl: '/pages/play/images/d_topic4.png',
      description: '在天色变化时停留两分钟,记录你看到的城市边界。', hookText: '适合终点收束',
      cardHookLong: '城市定向模式里,这里会作为最后一站。', validationMethod: 3,
      gameTitle: '黄昏选择题', question: '此刻更适合记录什么?', options: { A: '灯光', B: '声音', C: '人流' }, answerReveal: '都可以,关键是停下来观察。',
      fragmentText: '你拿到了一枚「黄昏切面」。'
    }
  ];
  return {
    topicId: free ? 'mock-free-explore' : 'mock-city-route',
    topicName: free ? '自由探索 · 城市附近发现' : '城市定向 · 复兴路微路线',
    mode: free ? 2 : 1,
    selfPlay: free,
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    chapters: [{
      idxLabel: free ? '附近探索' : '第一章',
      name: free ? '今天先从附近开始' : '顺着旧街走到黄昏',
      description: free ? '没有固定路线,挑一个想去的点位出发,完成附近观察打卡。' : '按推荐顺序走完四站,把线索串成一段完整城市故事。',
      cover: '/pages/play/images/d_topic5.png', totalMileage: free ? 1.8 : 2.4, totalTime: free ? 2700 : 3600
    }],
    nodes
  };
}

Page({
  _routeState: normalizeRouteState(null),

  data: {
    tagSheetShow: false,
    tagSheetItems: [],
    privacyGateShow: false,
    loading: true,
    reducedMotion: false,
    statusBarHeight: 44,
    chrome: { actionTop: 54, actionRight: 12, contentTop: 100, sheetTop: 99 },
    emptyTip: '', emptyKind: '',    // 空态:'' 无 / missing 缺场次参数(重试无效) / error 加载失败 / signup 未报名 / empty 无打卡点
    timeBanner: '',                 // 非阻断横幅:活动未开始/已结束(仍可看足迹)
    isPreview: false,           // 预览态:fabu 创作器经 EventChannel 喂数据,屏蔽所有写接口/GPS
    isMock: false,              // 本机演示态:用假数据看玩家 UI,不显示创作器控件
    activityId: '',
    topicId: '',
    mode: 1, serverMode: 1, modeLabel: '城市定向',
    routeNotice: '', routeRefreshing: false,
    screen: '',                 // '' | intro | gameLaunch | gamePlay
    gpsOk: false, gpsHint: '开始后可开启定位，也可扫码到达',
    // 底部运行栈三态(Figma 3957:12602 / 3962:14212 / 3962:14341)。
    // idle = 进了地图但还没按「开始」;running / paused 跟着 _sessionClock 走,不另存一份真值。
    runState: 'idle',
    runHoldPct: 0,          // 主键长按结束的进度环 0–100
    chapterCount: 0,   // 本主题章节数(开始前读数)
    gameCount: 0,      // 配了玩法的节点数,不是节点总数 —— 「游戏数」说的就是有游戏的那些
    searchPlaces: [],   // 顶部输入地址的候选,见 _searchPlaces
    // 自由探索选章弹窗:切换章节=先选章(cur=当前章下标),选完地点卡只出该章的点
    chapterPick: { show: false, cur: 0 },
    // 章节内容全屏态(Figma 3963:14970):一次一段、居中,滚动时按距屏心远近算 scale/opacity/blur
    album: { show: false, title: '', images: [] },
    chapterFull: false, chapterParas: [],
    // 导航态顶部条的第二行。⚠️ 全部是「预计」:没有导航 SDK,只能按直线距离 + 步行速度估。
    navMeta: { km: '0.0', dur: '—', eta: '—' },
    chapter: { idxLabel: '第一章', name: '', description: '', cover: '', mileage: '', timeText: '', atmospherePreset: 'DEFAULT', atmosphereClass: 'atmosphere--default' },
    chapterCards: [],             // 横滑章节卡(buildChapterCards)
    // mode2(自由探索)首屏:卡包 → 六宫格。动画标志位只驱动 WXSS class,不参与业务判定。
    // 四拍:② 蓄力(摇+压暗) → ③ 横撕(封口条扯走+爆炸) → ④ 发牌(逐张飞出) → 空袋下沉。
    // 奖励掉落卡:带服务端稳定 ID(badgeCode),可跳到徽章墙回读,不是一闪而过的 toast
    rewardDrop: { show: false, text: '', badges: [] },
    ringSegs: [],                 // 已核销环:等分间断条,一家一条,核销一家亮一条(见 _ringSegs)
    topicName: '',                // 卡包印刷用:一章一商家后 chapter.name 只是第一章,不能拿它当主题名
    topicCover: '',               // 卡包首屏底图:主题长图,虚化后铺底(没有就退回 chapter.cover)
    topicDesc: '',                // 通行证首屏那段简介:同理,chapters[0].description 讲的是第一家店的事
    seatTiles: [], packOpen: false, packShake: false, packBurst: false,
    // 点卡 hero 层:show 挂节点,open 驱动过渡(先 show 再下一帧 open,过渡才有起点)
    hero: { show: false, open: false, node: null, style: '', bodyTop: 0, ry: 0, spun: false, turned: false, sx: 0, ss: '1', faded: false, collapsed: false, scrollTop: 0 },
    // 店铺分身对话(自由探索卡片详情 → 点店铺卡)。started 一旦为真,居中的大字问候让位给消息流。
    shopNpc: { show: false, open: false, name: '', greeting: '', started: false, msgs: [], input: '', thinking: false, thinkPhase: 0, nodeId: 0, ry: 0, recording: false },
    // 章节剧情全屏故事流(自由探索卡片详情 → 点大卡片)。lines 逐行显形,不是整段一次淡入。
    chapStory: { show: false, open: false, title: '', lines: [], audio: '', audioDur: '', playing: false, barAway: false, frames: 0 },
    // 升级2/3:俱乐部角色卡(首入弹一次) + 同行者榜 sheet
    myRole: null,
    roleCard: { show: false, code: '', name: '', iconName: 'star', desc: '', skill: '', confirmed: false },
    gameModule: {
      enabled: false, loading: false, error: '', sheetShow: false,
      sessionId: 0, activityId: 0, status: '', revision: 0, snapshotAt: '',
      stale: false,
      canSubmitTask: false,
      role: { code: '', name: '' }, nodes: [], teamActions: [], story: { visibleVariables: [], ending: null },
      write: { status: 'idle', requestId: '', message: '', canRetry: false },
    },
    board: { show: false, loading: false, list: [], me: null },
    packDim: false, packTear: false, packSink: false, headIn: false,
    // 拖拽撕开:tearPct 是撕口进度(0-100),两个 style 串由 _applyTear 统一算,
    // 只在拖拽路径非空 —— tap 路径全程为 '',不会跟 fxRip/fxMouth 动画打架。
    tearPct: 0, packGrab: false, packSnap: false, packTorn: false,
    tearSealStyle: '', tearMouthStyle: '',
    // 爆炸的粒子/光条是数据驱动的(WXML 不能生成元素),开包那一刻才建,收场即清空。
    blastRays: [], blastShards: [], measuring: false,
    tileH: 0,                     // 瓦片行高:按剩余高度等分,4 家竖版大卡 / 6 家近方卡
    nodes: [], total: 0, doneCount: 0, allDone: false,
    fmNodes: [], fmPolyline: [], fmPlayer: null, fmCenter: { lat: 31.2304, lng: 121.4737 },
    fmSubkey: MAP_DARK.subkey, fmLayerStyle: MAP_DARK.layerStyle, // S9 暗色底图预留,见上方 MAP_DARK 注释
    nextNode: null,
    sheet: { show: false, node: null, continueText: '前往下一站' },
    advancedPlay: { show: false, node: null },
    // 节点任务
    game: {}, answerInput: '', answerSel: '',
    preference: {
      loading: false, error: '', steps: [], stepIndex: 0, choices: {}, inheritedTags: [],
      answerHere: false, submitting: false, result: null, pendingTag: null,
      tagDisclosure: null, progress: null, availableTagValues: []
    },
    newLifeOS: {
      loading: false, show: false, tags: [], resultCards: [], mapAnchors: [], mapNodes: [],
      actions7Days: [], actions30Days: []
    },
    scanning: false, photoTaken: false, gWrong: false, gNetErr: '', gNetRetryable: false, gRetryType: '', gWriteUnknown: false, shownHints: [],
    canHint: false, canReveal: false, hintLabel: '1/2', revealed: false, wrongCount: 0, hintUnlocking: false,
    puzzleScoreCap: 100,
    // v5.1/v5.2 新玩法(Figma 组件库 v5.1 node 45:248):kit 由服务端在节点上下发,没下发就整块不存在
    playKit: { show: false, kit: null },
    // R14 旅程检定(入口在 encounter.allowedActions,不在 playKit):题面 + 回执 + 请求态
    journeyCheck: {
      show: false, loading: false, error: '', nodeId: 0,
      checkId: '', skill: '', tier: '', mods: [], advantage: false, disadvantage: false,
      receipt: null,
    },
    // 反馈
    flyScore: false, flyText: '', lockHint: false,
    medal: { show: false }, couponToast: false, couponText: '', couponBurst: [],
    // 前往中陪伴态(mode2 专属):方向箭头 + 底部陪伴条 + 50%/90% 路程各一句途中 NPC 气泡
    nav: { active: false, targetNodeId: null, targetName: '', remainM: 0, totalM: 0, hit50: false, hit90: false },
    navBubble: { show: false, text: '' },
    // P1 俱乐部带领(club 场次:集合屏→队长发车→章节放行;3~5s 轮询 team-progress)
    lead: { exists: false, status: 0, isLeader: false, arrived: 0, total: 0, meArrived: false, chapterName: '', broadcast: '', members: [] },
    leadLoadError: false, leadUnlockChecking: false,
    // 手记
    /* 半屏进场用的开关(原型 .sheet 的 @keyframes up 在这儿是 transition)。 */
    sceneIn: false,
    showJournal: false, journalDot: false, journalCards: [], sessionToolsOpen: false,
    /* 自由探索有两种看法(2026-09-10 用户裁决):这一页默认是卡包,
       点「N 家商户」旁边那枚地图钮换成地图模式(原型 x-run)。同一批商户,两种排布。 */
    // 2026-09-22 地图模式已删,本字段恒 false;它还留着只因为 .fx / .pbar 的 wx:if 仍引用,
    // 那两行归城市定向那条线收口(见 PR 说明),不在本次删除范围内。
    freeMap: false,
    sceneStack: [], sceneCurrent: null, sceneConfirm: { show: false, action: null, pending: null },
    // 剧情两段式的第二段(全屏叙事页)。内容由 openStory 从既有节点数据取,不新增接口。
    story: { show: false, title: '', step: '', cover: '', text: '' },
    focusAnchor: '', nextChapterText: '',
    // P0 碎片翻卡(mode2 完成节点即翻出该节点碎片)
    frag: { show: false, text: '', step: '' },
    // M2 夜间提示(自玩 22:00–06:00):后端回执带 nightWarning 时在完成结果时刻出一句
    nightHint: false,
    // 通关
    showFinish: false, celebrationEvent: '', finishScore: 0, finishPuzzleScore: 0, finishPuzzleCount: 0, finishPuzzleBest: 0,
    finishMedals: 0, finishSnap: '', finishSnapError: false, finishPhotos: [], canReplayJournal: false,
    branchPath: [],
    finishRouteRecommendation: null,
    voucher: { show: false },
    ticket: { show: false, url: '', code: '', loading: false, expiresAt: 0 },
    // B 通关轨迹回顾层(2D):只连已完成节点、按真实走法排序,渐进描线 + 成就气泡。
    // reviewEmpty=true 表示一个已完成节点都没有(或没坐标)⇒ 回顾层整块不渲染,不画空地图。
    reviewElapsed: '', reviewDistance: '', reviewEmpty: true,
    // C 结束分享:主视觉徽章 + 里程碑轴。两者都可能为 null,对应「没拿到徽章」「累计数取不到」,
    // 此时各自整块不渲染 —— 不摆假数据(任务书硬要求)。
    finishBadge: null, milestone: null,
    // 终章结局信(mode2)
    ending: { show: false, opener: '', fragments: [] }, endingError: false,
    // 音频播放
    audioPlaying: false, audioLoading: false, audioError: '', audioNodeId: null,
    // FE-19 入场码(玩家出动态码,商家/俱乐部扫核销);regId 由票夹带入,无则不显 fab
    regId: ''
  },

  // 隐私授权闸:app.js 优先调这里(真弹窗),没有这个方法的页面才回退到 /pages/privacy 路由页。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  onLoad(options) {
    options = options || {};
    this._entryTopicName = options.topicName ? decodeURIComponent(options.topicName) : '';
    this._routeState = normalizeRouteState(null);
    const sys = wx.getSystemInfoSync();
    this.setData({
      chrome: resolveMenuChrome(
        (wx.getWindowInfo && wx.getWindowInfo()) || sys,
        wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
      ),
    });
    this.rpx = 750 / sys.windowWidth;                 // px → rpx 系数
    this.screenW = sys.windowWidth * this.rpx;        // = 750
    this.screenH = sys.windowHeight * this.rpx;
    // M2 自玩:onLoad 收 topicId||activityId(自玩会话走 topicId,场次会话走 activityId)
    this.setData({
      activityId: options.activityId || '',
      topicId: options.topicId || '',
      regId: options.registrationId || options.regId || '',
      reducedMotion: readReducedMotion(),
    });
    if (options.mock && app.isDevEnv && app.isDevEnv()) {
      this.setData({
        isMock: true,
        isPreview: false,
        statusBarHeight: getApp().globalData.statusBarHeight || 44
      });
      this.applyPreviewData(buildMockPlayData(options.mock));
      return;
    }
    // 预览模式:fabu 路线创作器经 EventChannel 喂数据,不走后端拉数
    if (options.preview) {
      const that = this;
      this.setData({
        isPreview: true,
        isMock: false,
        statusBarHeight: getApp().globalData.statusBarHeight || 44
      });
      const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
      ec && ec.on && ec.on('previewData', (data) => { that.applyPreviewData(data || {}); });
      return;
    }
    this._pendingInviteCode = String((options.inviteCode) || '').trim();
    if (this._pendingInviteCode) this._consumeInviteCode().then(() => this.loadData(true));
    else this.loadData(true);
  },

  _consumeInviteCode() {
    const code = this._pendingInviteCode;
    if (!code) return Promise.resolve();
    this._pendingInviteCode = '';
    const that = this;
    return new Promise((resolve) => {
      app.sendRequest({
        hideLoading: true,
        url: '/api/circle-theme/session/join',
        method: 'POST',
        data: JSON.stringify({ inviteCode: code }),
        header: { 'Content-Type': 'application/json' },
        success(res) {
          if (res && (res.code == 200 || res.code == '200')) {
            const sessionId = res.data && res.data.id;
            if (sessionId && that.data.topicId) {
              const memberId = app.getUserID && app.getUserID();
              const key = memberId === null || memberId === undefined || memberId === ''
                ? '' : 'circle_session_m' + memberId + '_t' + that.data.topicId;
              try {
                wx.removeStorageSync('circle_session_' + that.data.topicId);
                if (key) wx.setStorageSync(key, sessionId);
              } catch (e) {}
            }
          } else {
            cyToast((res && res.msg) || '无法加入同行探索');
          }
          resolve();
        },
        successStatusAbnormal(res) { cyToast((res && res.msg) || '无法加入同行探索'); resolve(); },
        fail() { cyToast('无法加入同行探索'); resolve(); },
      });
    });
  },
  onShow() {
    this._resetPackFx();   // onHide 清掉定时器后,四拍/拖拽的中间态标志必须归零,否则包把自己挡死
    if (!this.data.isMock && (this.data.activityId || this.data.topicId) && !this.data.loading) this.loadData(false);
  },

  // M2 会话参数:活动会话带 activityId,自玩会话带 topicId(后端二选一,活动优先)
  _sessionParams() { return this.data.activityId ? { activityId: this.data.activityId } : { topicId: this.data.topicId }; },
  _routeWritePayload(kind, nodeId, payload) {
    if (!this._routeActions) this._routeActions = createRouteActionStore();
    return Object.assign({}, this._sessionParams(), payload || {}, this._routeActions.context(kind, nodeId, this._routeState));
  },
  _resolveRouteAction(kind, nodeId) {
    if (this._routeActions) this._routeActions.resolve(kind, nodeId);
  },
  _routeNoticeForState(routeState) {
    const state = normalizeRouteState(routeState);
    const status = state.status;
    const last = state.decisionLog[state.decisionLog.length - 1] || {};
    if (state.routeMode === 'BRANCH_GRAPH' && !Object.keys(state.nodeStates).length) return '路线状态暂未同步，请稍后重试';
    if (status === 'UNAVAILABLE' || status === 'WITHDRAWN' || status === 'CONFIG_WITHDRAWN') return '路线配置已调整，当前行程暂不可继续';
    if (status === 'ENDED' || status === 'CANCELLED' || status === 'EXPIRED') return '本次路线已结束';
    if (status === 'FALLBACK' || /FALLBACK/i.test(String(last.reason || ''))) return '原地点暂不可用，已切换到备用路线';
    return '';
  },
  _routeInteractionBlocked() {
    const routeState = normalizeRouteState(this._routeState);
    return routeState.routeMode === 'BRANCH_GRAPH'
      && (this.data.routeRefreshing || routeState.status !== 'ACTIVE'
        || !(this.data.nodes || []).some((node) => node && !node.done && node.playable === true));
  },
  _failClosedRouteState(message, refreshing) {
    if (this._routeState.routeMode !== 'BRANCH_GRAPH') {
      this.setData({ routeRefreshing: !!refreshing, routeNotice: message || '' });
      return;
    }
    const nodes = (this.data.nodes || []).map((node) => {
      if (node.done || node.routeNodeState === 'COMPLETED') return node;
      return Object.assign({}, node, {
        playable: false,
        locked: true,
        routeNodeState: 'DISCOVERED_LOCKED',
        lockReason: message || '路线状态暂未同步',
      });
    });
    this.setData({
      routeRefreshing: !!refreshing,
      routeNotice: message || '路线状态暂未同步，请稍后重试',
      nodes,
      nextNode: null,
      'sheet.show': false,
    });
  },
  _mergeRouteCatalogCurrent() {
    const current = {};
    (this.data.nodes || []).forEach((node) => { if (node && node.nodeId != null) current[String(node.nodeId)] = node; });
    const source = this._routeNodeCatalog || this.data.nodes || [];
    return source.map((node) => Object.assign({}, node, current[String(node.nodeId)] || {}));
  },
  _applyRouteState(routeStateInput, callback) {
    const routeState = normalizeRouteState(routeStateInput);
    if (this._routeState.routeMode === 'BRANCH_GRAPH' && routeState.routeMode !== 'BRANCH_GRAPH') {
      this._failClosedRouteState('路线状态暂未同步，请稍后重试', false);
      if (callback) callback(false);
      return false;
    }
    const catalog = this._mergeRouteCatalogCurrent();
    this._routeNodeCatalog = catalog;
    let nodes = applyRouteStateToNodes(catalog, routeState);
    if (routeState.routeMode === 'BRANCH_GRAPH' && routeState.status !== 'ACTIVE') {
      const message = this._routeNoticeForState(routeState) || '路线状态异常，当前不可继续';
      nodes = nodes.map((node) => node.done || node.routeNodeState === 'COMPLETED' ? node : Object.assign({}, node, {
        playable: false, locked: true, routeNodeState: 'DISCOVERED_LOCKED', lockReason: message,
      }));
    }
    this._routeState = routeState;
    this.setData({
      nodes,
      total: nodes.length,
      doneCount: nodes.filter((node) => node.done).length,
      routeNotice: this._routeNoticeForState(routeState),
      routeRefreshing: false,
    }, () => {
      this.rebuild();
      if (callback) callback(true);
    });
    return true;
  },
  refreshRouteState() {
    if (this.data.isPreview || this.data.isMock) return Promise.resolve(false);
    this._failClosedRouteState('正在同步路线…', true);
    return req('/api/play/route-state', 'GET', this._sessionParams()).then((response) => {
      if (response.code == 200 || response.code == '200') {
        const data = response.data && response.data.routeState ? response.data.routeState : response.data;
        return this._applyRouteState(data || {});
      }
      this._failClosedRouteState(response.msg || '路线状态暂未同步，请稍后重试', false);
      return false;
    }).catch(() => {
      this._failClosedRouteState('路线状态暂未同步，请稍后重试', false);
      return false;
    });
  },
  _handleRouteConflict(response, kind, nodeId) {
    if (!isRouteConflict(response)) return false;
    this._resolveRouteAction(kind, nodeId);
    this.setData({ routeNotice: '路线状态有更新，正在同步…' });
    this.refreshRouteState();
    return true;
  },

  // M2 有效期"M/D"格式化(容错)
  _fmtMD(t) {
    if (!t) return '';
    try {
      const n = Number(t);
      if (Number.isFinite(n) && n > 0) {
        const d = new Date(n);
        return (d.getMonth() + 1) + '/' + d.getDate();
      }
      const s = String(t).replace('T', ' ');
      const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      return m ? (Number(m[2]) + '/' + Number(m[3])) : '';
    } catch (e) { return ''; }
  },
  /** 本次行程的定位标识:一个主题一次行程 */
  _trackKey() { return 'play:' + (this.data && this.data.topicId != null ? this.data.topicId : 'cur'); },

  /** 行程结束的唯一收尾口(通关/退出/离开页面都走它),幂等 */
  _stopTracking() {
    this._watching = false;
    try { wx.offLocationChange(); } catch (e) {}
    bgTracker.release(this._trackKey());
  },

  onUnload() {
    this._stopTracking();
    this._watching = false;
    this.destroyAudio();
    this._stopShopNpcVoice();
    this._stopLeadPoll();
    // R9-21:先落盘再销毁时钟 —— 暂停/返回页面不算主动离场,未结束的会话要能回来。
    this._persistRunSession();
    this._runRestoreEpoch = (this._runRestoreEpoch || 0) + 1;   // 页面已走,在途的服务端恢复不再回写
    this._destroySessionClock();
    // 开卡包的三个 timeout 都会在销毁后写 UI,必须跟着卸载清掉。
    // 用「有才清」而不是无条件 clearTimeout:未开过包时这个数组根本不存在。
    this._clearPackTimers();
    this._clearTransientUiTimers();
    if (this._routeDrawStop) this._routeDrawStop();
    // 玩法音频归页面持有(见 _togglePlayKitAudio),页面走了就得销毁,否则背景里一直在放
    if (this._kitAudio) { this._kitAudio.destroy(); this._kitAudio = null; }
    // 章节旁白音频与故事流两个 timer 也归页面持有:若卸载时故事流还开着(没走 closeChapStory),
    // 旁白会留在后台继续放、timer 会在卸载后 setData。跟 _kitAudio 一样就地销毁。
    if (this._chapAudio) { try { this._chapAudio.stop(); this._chapAudio.destroy(); } catch (e) {} this._chapAudio = null; }
    if (this._storyTimer) { clearTimeout(this._storyTimer); this._storyTimer = 0; }
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = 0; }
    // 长按结束的 40ms 进度 interval 只有 touchend 会清;卸载若正好压在按住那一拍上,
    // 不清就是卸载后每 40ms 一次 setData。
    this._cancelRunHold();
  },
  // ⚠️ onHide **不再停定位**:玩家锁屏/切走仍在走路,那正是后台定位的理由。
  //    定位只在 onUnload 与 _stopTracking(通关/退出)里停 —— 漏了就是长期采集。
  // 2026-08-20 并 master:开卡包的三个 timeout 与定位无关,该清照清;
  //    只把 master 那侧的 _watching=false / offLocationChange / stopLocationUpdate 三句拿掉。
  onHide() { this._clearPackTimers(); this.pauseAudio(); this._stopShopNpcVoice(); this._stopLeadPoll(); this._pauseSessionClock(); this._persistRunSession(); },

  _clearTransientUiTimers() {
    ['_navBubbleTimer', '_burstTimer', '_couponTimer',
     '_npcTimer', '_thinkTimer', '_spinTimer'].forEach((key) => {
      if (this[key] == null) return;
      clearTimeout(this[key]);
      this[key] = null;
    });
  },

  _ensureSessionClock() {
    if (!this._sessionClock) {
      this._sessionClock = createSessionClock();
      this._sessionClock.start();
    }
  },
  _pauseSessionClock() {
    if (!this._sessionClock || this._sessionClock.isPaused()) return;
    this._sessionClock.pause();
  },
  _destroySessionClock() {
    this._sessionClock = null;
  },
  // ===== R9-21 暂停会话恢复 =====
  /** 快照作用域:先按账号隔离，再按 activityId/topicId 隔离；身份未确定时不碰个人快照。 */
  _runSessionScope() {
    return { memberId: app.getUserID(), activityId: this.data.activityId, topicId: this.data.topicId };
  },
  /** 暂停/离页时落盘。只记「已开始未结束」的行程;结束(通关/退出/服务端判结束)会 clear,
   *  所以重进读到的快照一定是可继续的暂停态,不是一个幽灵计时。 */
  _persistRunSession() {
    if (!this._runStarted || this.data.isPreview || this.data.isMock) return false;
    if (this._sessionClock && !this._sessionClock.isPaused()) this._sessionClock.pause();
    const elapsed = this._sessionClock ? this._sessionClock.elapsedSeconds() : 0;
    const now = Date.now();
    const scope = this._runSessionScope();
    // 第二轮拍板 22:同一份再写服务端,换手机登录同账号能续。写失败本机那份仍在,不影响本机恢复。
    this._queueRunSync(() => saveServerPausedRun(req, scope, elapsed, now));
    return writePausedRun(wx, scope, elapsed, now);
  },
  /** 本机快照作废 + 服务端留结束墓碑:只清本机的话,换台设备又会把已结束的一局恢复回来。
   *  同时作废在途的服务端恢复读 —— 迟到的旧会话不能把刚结束的局拉回暂停态。 */
  _clearRunSessionEverywhere() {
    const scope = this._runSessionScope();
    const now = Date.now();
    this._runRestoreEpoch = (this._runRestoreEpoch || 0) + 1;
    this._queueRunSync(() => clearServerRunSession(req, scope, now));
    return clearRunSession(wx, scope);
  },
  /** 同一页的服务端 save/clear 串行发出:先暂停再结束时,迟到的 save 不能把已结束的会话写回。 */
  _queueRunSync(send) {
    this._runSyncChain = (this._runSyncChain || Promise.resolve()).then(send);
    return this._runSyncChain;
  },
  /** 服务端权威态说这场已经不能继续(时间窗关闭 / 路线终态)时不恢复。 */
  _serverRunSessionEnded(d, routeState) {
    if (d && d.playable === false) return true;
    const status = String((routeState && routeState.status) || '').toUpperCase();
    // R1:COMPLETED/FINISHED 是 BRANCH_GRAPH 通关真实返回的终态(与 rebuild 的 branchFinished 同口径)。
    // 漏了它们,支线终局(还有没走的支线,本地 allDone 不成立)重进就会被当成暂停恢复。
    return ['COMPLETED', 'FINISHED', 'ENDED', 'CANCELLED', 'EXPIRED', 'UNAVAILABLE', 'WITHDRAWN', 'CONFIG_WITHDRAWN'].indexOf(status) >= 0;
  },
  /** 重进页面:读暂停快照,投影回 paused(不重开、不偷跑)。服务端说结束就不恢复并清快照。
   *  第二轮拍板 22:本机快照先同步恢复;再读服务端那份,本机没有(换了手机)或服务端更新时改用服务端的。 */
  _restoreRunSession(d, routeState, nodes) {
    if (this._runStarted || this.data.isPreview || this.data.isMock) return false;
    const scope = this._runSessionScope();
    const allDone = (nodes || []).length > 0 && nodes.every((n) => n && n.done);
    if (allDone || this._serverRunSessionEnded(d, routeState)) {
      this._clearRunSessionEverywhere();
      return false;
    }
    const stored = readPausedRun(wx, scope);
    const restored = stored ? this._applyRestoredRun(stored) : false;
    const epoch = this._runRestoreEpoch = (this._runRestoreEpoch || 0) + 1;
    readServerPausedRun(req, scope).then((result) => {
      if (epoch !== this._runRestoreEpoch || !result.ok) return;
      // 等服务端期间玩家已经自己开了新局 / 点了继续:那一局归玩家,服务端这份不再覆盖或撤销它。
      const untouched = !this._runStarted || (this._restoredRun && this._sessionClock && this._sessionClock.isPaused());
      if (!untouched) return;
      // 另一台设备已经结束了这一局,且结束晚于本机快照:本机快照作废,不能还魂。
      if (stored && result.endedAt && result.endedAt >= stored.savedAt) {
        this._applyServerRunSessionEnd();
        return;
      }
      const next = newerPausedRun(stored, result.record);
      if (!next || next === stored) return;
      writePausedRun(wx, scope, next.elapsedSeconds, next.savedAt);
      this._applyRestoredRun(next, !!stored);
    });
    return restored;
  },
  _applyRestoredRun(record, fromOtherDevice) {
    this._runStarted = true;
    this._restoredRun = true;
    this._ensureSessionClock();
    if (this._sessionClock) this._sessionClock.restorePaused(record.elapsedSeconds);
    this._syncRunState();
    cyToast((fromOtherDevice ? '已同步另一台设备上的进度 · 用时 ' : '已恢复上次暂停的行程 · 用时 ') + formatElapsed(record.elapsedSeconds));
    return true;
  },
  /** 服务端会话已经结束(通关/取消)时,本地兜底的暂停快照作废;只撤「恢复出来的」那一局,
   *  不碰玩家自己按开始的新局。 */
  _applyServerRunSessionEnd() {
    this._clearRunSessionEverywhere();
    if (!this._restoredRun) return false;
    this._restoredRun = false;
    this._runStarted = false;
    this._pauseSessionClock();
    this._syncRunState();
    return true;
  },
  /** 一局结束的唯一收尾(长按结束 / 通关):停表 + 作废暂停快照 + 运行栈归 idle。
   *  R1:通关有多条入口(末站完成 / 勋章层关闭 / 继续),只清快照不够 —— 不清 _runStarted 的话,
   *  onHide/onUnload 的落盘又会把已结束的行程写回去,重进时被当成暂停恢复。 */
  _endRunSession() {
    this._pauseSessionClock();
    this._runStarted = false;
    this._restoredRun = false;
    this._clearRunSessionEverywhere();
    this._syncRunState();
  },
  onPlayHudToggle() {
    if (!this._sessionClock) return;
    if (this._sessionClock.isPaused()) {
      this._sessionClock.resume();
      // 玩家主动继续:这局不再是「服务端判结束就撤」的恢复态,归玩家自己了。
      this._restoredRun = false;
      if (!this.data.isPreview && !this.data.isMock && this.data.gpsOk) this.watchLocation();
    } else {
      this._sessionClock.pause();
      this._watching = false;
      try { wx.offLocationChange(); wx.stopLocationUpdate(); } catch (e) {}
    }
    if (this._sessionClock.isPaused()) this._persistRunSession();
  },

  // ===== 底部运行栈(Figma 3957:12602 / 3962:14212 / 3962:14341)=====
  /** runState 是 _sessionClock 的投影,不是第二份真值:时钟没起来 = idle,
   *  起来了再看 isPaused()。所有改动时钟的地方调一次这个即可,不必各自 setData。 */
  _syncRunState() {
    let runState = 'idle';
    if (this._runStarted && this._sessionClock) {
      runState = this._sessionClock.isPaused() ? 'paused' : 'running';
    }
    if (runState !== this.data.runState) this.setData({ runState });
  },
  /** 开始前那两格读数:章节数 / 有玩法的节点数。
   *  第三格「路程」随底部读数卡一起删了(2026-09-22),这里不再算 mileageText。 */
  _syncIdleStats(chapters, nodes) {
    const list = Array.isArray(nodes) ? nodes : [];
    this.setData({
      chapterCount: Array.isArray(chapters) ? chapters.length : 0,
      // nodes 数组上的字段是 hasTemplate;hasGame 只存在于详情卡的 sheetNode ⇒ 用错了会恒为 0
      gameCount: list.filter((n) => n.hasTemplate).length,
    });
  },
  /** 中键:未开始→开始(起时钟+开定位),进行中→暂停,已暂停→继续。三态一个键,与设计稿一致。 */
  onRunToggle() {
    // 长按满 3 秒已经走了结束链路,松手时还会补一记 tap —— 不吞掉它，结束完会紧接着又开始一局
    if (this._runHoldTriggered) { this._runHoldTriggered = false; return; }
    if (this.data.runState === 'idle') {
      this._runStarted = true;
      this._restoredRun = false;
      // 新起一局必须作废旧暂停快照:否则「开了新的、还没落盘就杀进程」会把上一局的用时还魂。
      this._clearRunSessionEverywhere();
      this._ensureSessionClock();
      // 时钟在数据加载时就建好了,若不重置,「开始」那一刻的用时已经跑了十几秒
      if (this._sessionClock) this._sessionClock.start();
      // requestPlayLocation 自己带了预览/演示/已开启/请求中四道前置判断,这里不重复挡
      this.requestPlayLocation();
      this._syncRunState();
      return;
    }
    this.onPlayHudToggle();
    this._syncRunState();
  },
  /** 长按主键 3 秒 = 结束本次(9-09 裁决)。3 秒有意为之的按住本身就是确认,
   *  所以这里不再叠一层确认弹窗 —— 原来那枚方形「结束」键连同它的弹窗一起删了。
   *  还没开始(idle)时没有可结束的东西,不起计时。 */
  onRunHoldStart() {
    if (this.data.runState === 'idle') return;
    this._cancelRunHold();
    this._runHoldDelay = setTimeout(() => {
      this._runHoldDelay = null;
      const t0 = Date.now();
      this.setData({ runHoldPct: 0 });
      this._runHoldTimer = setInterval(() => {
        const pct = Math.min(100, Math.round(((Date.now() - t0) / RUN_HOLD_MS) * 100));
        this.setData({ runHoldPct: pct });
        if (pct >= 100) {
          this._runHoldTriggered = true;
          this._cancelRunHold();
          wx.vibrateShort && wx.vibrateShort({ type: 'heavy' });
          this._finishRun();
        }
      }, 40);
    }, 180);   // 180ms 之前算点击,不算长按
  },
  onRunHoldEnd() {
    if (this.data.runHoldPct > 0 && this.data.runHoldPct < 100) this._cancelRunHold();
    else this._cancelRunHold();
  },
  _cancelRunHold() {
    if (this._runHoldDelay) { clearTimeout(this._runHoldDelay); this._runHoldDelay = null; }
    if (this._runHoldTimer) { clearInterval(this._runHoldTimer); this._runHoldTimer = null; }
    if (this.data.runHoldPct) this.setData({ runHoldPct: 0 });
  },
  /** 结束:交给既有通关/结算路径,不在这里另写一套收尾 */
  _finishRun() {
    // R9-21:结束是主动收尾,暂停快照必须作废 —— 重进不能再拉回一局已经结束的计时。
    this._endRunSession();
    this.openFinish();
  },
  /** 左键「切换章节」(mode2):先弹章节选择;选完地点卡只出该章的商家/地点(用户裁决)。
   *  多章数据齐(chapterCards>1)才弹选择;单章直接进地点卡层。mode1 仍只给当前站。 */
  openStackOrChapters() {
    if (this.data.chapterCards.length > 1) { this.setData({ 'chapterPick.show': true }); return; }
    // 地点卡层已删:唯一的选点面就是卡包(用户裁决「完整地点列表=卡包」),别让入口点了没反应。
    this.setData({ packOpen: true });
  },
  /** 开卡包的定时器全挂在 _packTimers 上:onUnload 和 onHide 都要清干净 ——
   *  离开页面后它们会继续 vibrateShort、继续往已经不可见的页面 setData。 */
  _clearPackTimers() {
    if (this._packTimers) { this._packTimers.forEach(clearTimeout); this._packTimers = null; }
    if (this._heroTimer) { clearTimeout(this._heroTimer); this._heroTimer = null; }
  },
  /** onHide 清定时器后,四拍/拖拽会停在半路:packShake/packTear/packSnap/tearPct 这些
   *  中间态标志恰是 openPack / onPackTouchStart 的重入 guard ⇒ 不归零,回前台后
   *  点、拖全被自己挡死(与 tabBar「在途守卫 flag 卡死」同款,守卫必须 onShow 归零)。
   *  包已开完(packOpen)是终态,六宫格不动;否则一律回到待机重来。 */
  _resetPackFx() {
    const d = this.data;
    if (d.packOpen) return;
    if (!(d.packShake || d.packDim || d.packTear || d.packBurst || d.packSink
          || d.packGrab || d.packSnap || d.packTorn || d.tearPct > 0 || d.headIn)) return;
    const cleared = d.seatTiles.map((t) => {
      const rest = Object.assign({}, t);
      delete rest.fly;
      delete rest.land;
      return rest;
    });
    this.setData({
      packShake: false, packDim: false, packTear: false, packBurst: false,
      packSink: false, packGrab: false, packSnap: false, packTorn: false, headIn: false,
      tearPct: 0, tearSealStyle: '', tearMouthStyle: '',
      blastRays: [], blastShards: [], seatTiles: cleared,
    });
    this._tearActive = false;
    this._dragMoved = false;
    this._tearRawPct = 0;
  },
  /** mode2 开卡包,四拍:
   *    ② 蓄力 1000ms —— 摇 + 四周压暗(没有这层压暗,后面的闪光炸不出反差)
   *    ③ 横撕  640ms —— 顶部封口条整条向右扯走、撕口自左向右露出,同时爆炸
   *    ④ 发牌        —— 每张间隔 180ms 从卡包正中飞出,空袋下沉
   *  没有「开包」按钮是刻意的:一个居中的、明显是包装的东西,没人会不点。
   *  reducedMotion 直接落定不播 —— 动画永远不能是必须看完的。 */
  openPack() {
    if (this._dragMoved) return;   // 刚做完一次拖拽,吞掉紧跟着的 tap
    if (this.data.packOpen || this.data.packShake || this.data.packTear || this.data.tearPct > 0) return;   // 播放中再点不重入
    if (this.data.reducedMotion) { this.setData({ packOpen: true, headIn: true }); return; }
    this._packTimers = this._packTimers || [];

    this.setData({ packShake: true, packDim: true });
    wx.vibrateShort({ type: 'light' });

    this._packTimers.push(setTimeout(() => {
      this.setData({ packShake: false, packDim: false, packTear: true });
      this._finishTearAndDeal(PACK_TEAR);
    }, PACK_CHARGE));
  },

  /** 撕开完成后的爆炸+发牌收场,tap/拖拽两条路径共用。
   *  delay = 从爆炸到发牌的间隔:tap 路径等横撕动画播完(PACK_TEAR),
   *  拖拽路径撕口已被手指撕到位,只留一个短促的呼吸(90ms)。 */
  _finishTearAndDeal(delay) {
    this._packTimers = this._packTimers || [];
    this.setData({ packBurst: true });
    wx.vibrateShort({ type: 'heavy' });
    this._fireBlast();

    this._packTimers.push(setTimeout(() => {
      this._dealTiles();
      this.setData({ headIn: true });          // 通行证头跟第一张卡一起出来
      this.setData({ packSink: true });   // 爆完立刻自由落体坠出画面,把屏幕正中让给卡片
      // 最后一张落地之后才置 packOpen:它同时是「包已移除」和「兜底 is-dealt」,
      // 早置会把还在飞的卡强行拍到落点。
      const n = this.data.seatTiles.length || 1;
      const done = (n - 1) * DEAL_STAGGER + DEAL_FLIGHT;
      this._packTimers.push(setTimeout(() => this.setData({ packOpen: true }), done + 60));
      this._packTimers.push(setTimeout(
        () => this.setData({ packBurst: false, blastRays: [], blastShards: [] }), done + 400));
    }, delay));
  },

  /** ③′ 拖拽撕开:手指横拖,撕口实时跟随;过 TEAR_DONE_PCT 松手补完并接爆炸发牌,
   *  不足弹回待机。reducedMotion 不接管 —— tap 路径的「直接落定」已经覆盖。 */
  onPackTouchStart(e) {
    // 拖拽路径不走 packTear,所以 torn/snap/tearPct 必须自己挡:撕开完成到 packOpen
    // 之间有 ~2.4s 发牌窗,不挡的话第二根手指会再排一次爆炸+发牌(双开)。
    if (this.data.packOpen || this.data.packTear || this.data.packShake
        || this.data.packTorn || this.data.packSnap || this.data.tearPct > 0
        || this.data.reducedMotion) return;
    this._tearStartX = e.touches[0].clientX;
    this._tearActive = true;
    this._tearLastTs = 0;
    this._tearRawPct = 0;
  },
  onPackTouchMove(e) {
    if (!this._tearActive) return;
    const dx = e.touches[0].clientX - this._tearStartX;
    const pct = Math.max(0, Math.min(100, (dx / TEAR_MAX_PX) * 100));
    this._tearRawPct = pct;   // 节流前先记原始值:松手判阈值用它,不然快划的最后一帧被节流吃掉会误判弹回
    const now = Date.now();
    if (now - this._tearLastTs < 33 && pct < 100) return;   // ~30fps 节流,撕满那帧不丢
    this._tearLastTs = now;
    if (pct > 4 && !this.data.packGrab) {
      this.setData({ packGrab: true });
      wx.vibrateShort({ type: 'light' });    // 咬住封口的那一下
    }
    this._applyTear(pct);
  },
  onPackTouchEnd(e) {
    if (!this._tearActive) return;
    this._tearActive = false;
    const cancelled = !!(e && e.type === 'touchcancel');   // 系统打断(来电/弹窗)≠松手,一律弹回
    const pct = this._tearRawPct || 0;
    if (pct <= 0) {
      // 没拖出撕口 ⇒ 当没发生,交回给 tap;但 4% 抓握反馈可能已经亮了,得撤
      if (this.data.packGrab) this.setData({ packGrab: false });
      return;
    }
    this._dragMoved = true;                  // 同一根手指抬起会再触发 bindtap,吞掉它
    this._packTimers = this._packTimers || [];
    this._packTimers.push(setTimeout(() => { this._dragMoved = false; }, 350));
    if (!cancelled && pct >= TEAR_DONE_PCT) {
      this.setData({ packSnap: true, packTorn: true });   // is-snap 给补完过渡,is-torn 让袋口片翻出
      this._applyTear(100);
      this._packTimers.push(setTimeout(() => this._finishTearAndDeal(90), TEAR_SNAP));
    } else {
      this.setData({ packSnap: true, packGrab: false, tearSealStyle: '', tearMouthStyle: '' });
      this._packTimers.push(setTimeout(() => this.setData({ packSnap: false, tearPct: 0 }), TEAR_SNAP + 60));
    }
  },
  /** 撕口进度 → 两个内联 style。封口条的位移/旋转终点(500rpx,-18rpx,5deg)与 fxRip 的
   *  100% 帧一致 —— 拖到底和 tap 播到底必须停在同一个画面。 */
  _applyTear(pct) {
    const p = Math.round(pct * 10) / 10;
    const fade = p < 30 ? 1 : 1 - (p - 30) / 70;   // 前 30% 只位移不褪,和 fxRip 的节奏对齐
    this.setData({
      tearPct: p,
      tearMouthStyle: 'width:' + p + '%',
      tearSealStyle: 'transform:translate(' + (p * 5) + 'rpx,' + (p * -0.18) + 'rpx) rotate(' + (p * 0.05) + 'deg);opacity:' + fade.toFixed(2),
    });
  },

  /** 逐张发牌:每张两段 —— fly(弹到扇形弧顶) → land(落格)。
   *  分两段是因为一条 transition 画不出弧;弧顶时刻必须与 WXSS 的 DEAL_ARC 一致。
   *  返回真实排期(ms):节奏靠它断言 —— 靠 sleep 去采样「此刻飞了几张」会被
   *  自动化工具的往返延迟带偏,测出来的是延迟不是节奏。 */
  _dealTiles() {
    this._packTimers = this._packTimers || [];
    const arc = Math.round(DEAL_FLIGHT * DEAL_ARC);
    const schedule = this.data.seatTiles.map((_, i) => ({ i, fly: i * DEAL_STAGGER, land: i * DEAL_STAGGER + arc }));
    schedule.forEach(({ i, fly, land }) => {
      this._packTimers.push(setTimeout(() => this._markTile(i, 'fly'), fly));
      this._packTimers.push(setTimeout(() => {
        this._markTile(i, 'land');
        wx.vibrateShort({ type: 'light' });    // 每张落地一次轻震 = 逐张的那个点
      }, land));
    });
    return schedule;
  },

  /** 只翻第 i 张卡的某个动画标志位。
   *  ⚠️ 刻意整表重建、而不是 setData({['seatTiles[i].flag']: true}):
   *  动态 setData 键让 UI-GATE-0 的 U4 无法静态核对顶层字段消费,而那道棘轮
   *  (u4Dynamic ≤ 65)只减不增 —— 新增一条就是给别人留一笔还不掉的债。
   *  这里最多 6 个小对象,整表重建的开销可以忽略。 */
  _markTile(i, flag) {
    const nextTiles = this.data.seatTiles.map((t, idx) => (idx === i ? { ...t, [flag]: true } : t));
    this.setData({ seatTiles: nextTiles });
  },

  /** 已核销环:等分**间断条**,一家一条,核销一家亮一条。
   *  不用 conic-gradient —— 小程序渲染层不认,会渲成实心灰盘(2026-08-12 实拍);
   *  也不再用「两个半圆各转一半」画连续弧:那读起来是百分比进度,
   *  而这里要表达的是「四家里点亮了几家」,离散的条才对得上。
   *  按 doneCount 点亮前 N 条(不是按 seatTiles 各自的 done):环是计数展示,
   *  连续点亮才读得出进度;这几家本来也没有顺序。 */
  _ringSegs(done, total) {
    const n = Number(total) || 0;
    if (n <= 0) return [];   // 零家商户就零条 —— 抬成 1 会画出一根「0/0」的幽灵条
    const step = 360 / n;
    return Array.from({ length: n }, (_, i) => ({
      key: 'sg' + i,
      deg: (i * step).toFixed(2),
      on: i < done,
    }));
  },

  /** 爆炸六层里的两层需要真实元素:放射光条 + 碎片。WXML 生成不了,只能落成数据。
   *  另外四层(压暗/白闪/彩色光晕/冲击波)是固定节点,由 packBurst 开关。 */
  _fireBlast() {
    const rays = [];
    // 圆形光晕收成核心之后,「四射」全靠光条:条数和长度都得撑得住场面
    const RAYS = Math.round(16 * BLAST_POWER);
    for (let j = 0; j < RAYS; j++) {
      // ⚠️ 起步长度必须大于卡包的半对角线(424×741rpx ⇒ 约 222pt),否则光条整根
      //    埋在包后面(z-index 33 < 包 40),看不到「射出来」这件事。
      const len = 250 + Math.random() * 280;   // 长短拉开差距,齐刷刷等长会读成一个圆
      rays.push({
        id: 'r' + j,
        a: (j / RAYS * 360).toFixed(1),        // 爆心在包正中 ⇒ 全向等分,不偏上半圈
        c: HOLO[j % HOLO.length],
        len: Math.round(len),
        w: (3 + Math.random() * 5).toFixed(1),
        dur: Math.round((430 + Math.random() * 260) * 2),
      });
    }
    const shards = [];
    for (let i = 0; i < BLAST_SHARDS; i++) {
      const ang = (-90 + (Math.random() * 230 - 115)) * Math.PI / 180;
      const d = (90 + Math.random() * 210) * (0.6 + 0.6 * BLAST_POWER);
      const big = Math.random() < 0.3;        // 三成大块碎膜,七成细屑 —— 尺寸一致就读成彩纸
      shards.push({
        id: 's' + i,
        dx: Math.round(Math.cos(ang) * d),
        dy: Math.round(Math.sin(ang) * d + 55),
        rot: Math.round(Math.random() * 900 - 450),
        w: (big ? 7 + Math.random() * 9 : 2 + Math.random() * 4).toFixed(1),
        h: (big ? 11 + Math.random() * 18 : 4 + Math.random() * 8).toFixed(1),
        c: HOLO[i % HOLO.length],
        dur: Math.round((620 + Math.random() * 620) * 2),
      });
    }
    this.setData({ blastRays: rays, blastShards: shards });
  },

  /** 量两件事,两趟(第一趟改行高会挪动瓦片,必须落定后再量瓦片):
   *    ① 行高:瓦片按剩余高度等分 —— 写死 268rpx 时 4 家底下空一大块
   *    ② 飞行几何:每张卡从卡包正中弹出、经扇形弧顶、落格
   *  量不到就整个跳过:seatTiles 里 tx0/ty0 留空串,WXSS 的 var() 兜底 0px,
   *  卡片原地淡入 —— 降级成没有弧,不会消失。 */
  _measureDeal() {
    if (this.data.mode !== 2 || !this.data.seatTiles.length || this.data.packOpen) return;
    // 播放中不量:measuring 会给瓦片挂 transform:none,套在正在飞的卡上就是当场瞬移。
    // 只挡 packOpen 不够 —— 它是全程最后一步才置的。
    if (this.data.packShake || this.data.packTear || this.data.measuring) return;
    const that = this;
    const n = this.data.seatTiles.length;
    let rpx = 0.5;
    try { rpx = (wx.getWindowInfo().windowWidth || 375) / 750; } catch (e) {}
    const GAP = 22 * rpx;

    wx.createSelectorQuery()
      .select('.fx').boundingClientRect()
      .select('.fx-grid').boundingClientRect()
      .exec((r1) => {
        const sv = r1 && r1[0], gr = r1 && r1[1];
        if (!sv || !gr) return;
        // 卡片尺寸恒定:高 = 宽 × 1.38(4 章那一版量出来的比例,用户看过的就是它)。
        // ⚠️ 不要再按剩余屏高等分 —— 那样章数一变卡片就变形,同一个主题换个章数换一套观感。
        //    张数多了让它往下滚:.fx 本来就是 scroll-view。
        const PAD_X = 32 * rpx;
        const tileW = Math.max(80 * rpx, (gr.width - PAD_X * 2 - GAP) / 2);
        const tileH = Math.round(tileW * 1.38);
        // measuring 会给瓦片挂 transform:none(见 index.wxss),量到的就是**布局框**本身。
        // 比从变换后的框反推可靠:那个框同时吃了 scale 和 rotate,反推必然带误差。
        that.setData({ tileH: Math.round(tileH), measuring: true }, () => {
          wx.createSelectorQuery()
            .select('.fx-pack').boundingClientRect()
            .selectAll('.fx-tile').boundingClientRect()
            .select('.fx').boundingClientRect()
            .exec((r2) => {
              const pk = r2 && r2[0], tiles = r2 && r2[1], box = r2 && r2[2];
              if (!pk || !box || !tiles || tiles.length !== n) { that.setData({ measuring: false }); return; }
              const px = pk.left + pk.width / 2, py = pk.top + pk.height / 2;
              // 抛出半径对所有卡取同一个常数 —— 按各自落点距离算会让扇形左右不对称
              const R = pk.height * 0.55;
              const spread = DEAL_SPREAD;
              const geom = [];
              tiles.forEach((t, i) => {
                const lw = t.width, lh = t.height;                 // measuring 态 = 真实布局框
                const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
                const k = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
                const ang = k * spread;
                const rad = (ang - 90) * Math.PI / 180;
                // 弧顶必须夹在画面内。不夹的话扇形一大、卡片一高,弧顶顶出上边框,
                // 看到的是「卡片从画面外掉进来」。夹坐标比整体下移好 —— 下移会把
                // 「卡片撑满屏幕、底下不留空档」又打回去。
                // 弧顶那一刻卡片是**转着**的(rotate(--rot * .4)),旋转后的外接框比原框大 ——
                // 按未旋转的尺寸留边,4 家会差 11px、6 家差 16px,卡角照样探出上边框。
                const rot2 = Math.abs(ang * 0.6 * 0.4) * Math.PI / 180;
                const ca = Math.abs(Math.cos(rot2)), sa = Math.abs(Math.sin(rot2));
                const w2 = lw * DEAL_MID_SCALE, h2 = lh * DEAL_MID_SCALE;
                const hw = (w2 * ca + h2 * sa) / 2, hh = (w2 * sa + h2 * ca) / 2, PAD = 6;
                let mx = px + Math.cos(rad) * R, my = py + Math.sin(rad) * R;
                mx = Math.min(Math.max(mx, box.left + hw + PAD), box.right - hw - PAD);
                my = Math.min(Math.max(my, box.top + hh + PAD), box.bottom - hh - PAD);
                geom[i] = {
                  tx0: Math.round(px - cx) + 'px', ty0: Math.round(py - cy) + 'px',
                  tx1: Math.round(mx - cx) + 'px', ty1: Math.round(my - cy) + 'px',
                  rot: (ang * 0.6).toFixed(1) + 'deg',
                };
              });
              // 同上:整表重建,不用动态 setData 键
              const nextTiles = that.data.seatTiles.map((t, i) => Object.assign({}, t, geom[i]));
              that.setData({ seatTiles: nextTiles, measuring: false });
            });
        });
      });
  },
  /** 点瓦片 = 进这家商家的**独立页**,不是半屏。
   *  这几家地理上离得很远、跨天逐个去,「打开某一家」是一次独立浏览:
   *  权益条款 / 到店体验 / 营业信息一屏塞不下,半屏也没法单独回跳。
   *  商家页零新增接口 —— 它从本页 nodes 里按 nodeId 取数据。 */
  onSeatTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id == null) return;
    const node = (this.data.nodes || []).find((n) => String(n.nodeId) === String(id));
    if (this._lockedTip(node)) return;
    this._openHero(node, Number(e.currentTarget.dataset.idx));
  },
  /** 点大卡片 → 全屏故事流(这一章的剧情),不是进游戏 —— 游戏在底部那个按钮。
   *  自由探索的章节走的是「章节概述」那条路(不是城市定向的块化故事流),所以正文就是
   *  chapter.description 一个文本域:多了按空行分段、少了就一句,不硬凑。 */
  openChapStory() {
    const v = this.data.hero.node || {};
    const text = String(v.chapDesc || '').trim();
    if (!text) { cyToast('这一章还没写剧情'); return; }
    const paras = text.split(/\n\s*\n|\r?\n/).map((x) => x.trim()).filter(Boolean);
    // 图片块插在第一段之后(只有一段就排在它后面),和文字共用 .st-line ——
    // 用户 09-06 原话:「章节里有图片,也要和文字一样的样式」,所以入场动效必须是同一套。
    const at = paras.length > 1 ? 1 : paras.length;
    const lines = [];
    // 顶部那一大段留白里先立标题:样机靠 40% 的上内边距把第一段推到屏幕中段,
    // 空着不写东西就只是一片黑。标题也吃同一套显形动效。
    if (v.chapName) lines.push({ id: 'ttl', title: v.chapName, meta: v.chapNo || '', in: false, dir: 'up', d: 0 });
    paras.forEach((t, i) => {
      if (i === at && v.chapCover) lines.push({ id: 'img', img: v.chapCover, in: false, dir: 'up', d: 0 });
      lines.push({ id: 'p' + i, text: t, in: false, dir: 'up', d: 0 });
    });
    if (at >= paras.length && v.chapCover) lines.push({ id: 'img', img: v.chapCover, in: false, dir: 'up', d: 0 });
    this._storyTop = 0;
    this.setData({ chapStory: { show: true, open: false, title: v.chapName || '', lines,
      audio: v.audio || '', audioDur: v.audioDur || '', playing: false, barAway: false, frames: 0 } }, () => {
      this._storyTimer = setTimeout(() => {
        this.setData({ 'chapStory.open': true });
        this._settleStory();          // 首屏那几行不用等滚动,直接显形
        this._startStoryDust();
      }, 30);
    });
  },

  closeChapStory() {
    if (!this.data.chapStory.show) return;
    if (this._storyTimer) { clearTimeout(this._storyTimer); this._storyTimer = 0; }
    if (this._settleTimer) { clearTimeout(this._settleTimer); this._settleTimer = 0; }
    this._stopStoryDust();
    this._stopChapAudio();
    this.setData({ 'chapStory.open': false });
    this._storyTimer = setTimeout(() => this.setData({ 'chapStory.show': false, 'chapStory.lines': [] }), 260);
  },

  onStoryNativeBack() { this.closeChapStory(); },

  /** 这一章的音频:常驻在故事流右侧,点一下播、再点暂停。
   *  只有作者真配了 audioUrl 才渲染这颗按钮 —— 没有音频就不留一个点了没反应的壳。 */
  toggleChapAudio() {
    const st = this.data.chapStory;
    if (!st.audio) return;
    if (st.playing) { this._stopChapAudio(); return; }
    if (!this._chapAudio) {
      const ctx = wx.createInnerAudioContext();
      ctx.src = st.audio;
      // 三个终态都要把按钮态收回去,否则暂停图标会一直亮着
      ctx.onEnded(() => this.setData({ 'chapStory.playing': false }));
      ctx.onStop(() => this.setData({ 'chapStory.playing': false }));
      ctx.onError(() => { this.setData({ 'chapStory.playing': false }); cyToast('这段音频放不出来'); });
      this._chapAudio = ctx;
    }
    this._chapAudio.play();
    this.setData({ 'chapStory.playing': true });
  },

  _stopChapAudio() {
    if (this._chapAudio) { try { this._chapAudio.stop(); this._chapAudio.destroy(); } catch (e) {} this._chapAudio = null; }
    if (this.data.chapStory.playing) this.setData({ 'chapStory.playing': false });
  },

  /** 滚动中不显形 —— tesseract 的手感就是「滑得快时屏幕上没有字」。
   *  只记方向和位移喂给粒子,显形一律等停下来那一刻(70ms 内没有新的滚动事件)。 */
  onStoryScroll(e) {
    const now = Date.now();
    const top = e.detail.scrollTop || 0;
    const dt = Math.max(8, now - (this._storyAt || now));
    // 每帧位移(px):|Δ| / Δt × 16。样机的判据就是这个量,不是「每次事件挪了多少」——
    // 事件不保证一帧一次,直接拿差值当速度会随机器快慢漂。
    this._storyVel = Math.abs(top - (this._storyTop || 0)) / dt * 16;
    this._storyDir = top >= (this._storyTop || 0) ? 'up' : 'down';   // 往下滚 → 字从下方浮起
    this._storyTop = top;
    this._storyAt = now;
    if (!this.data.chapStory.barAway) this.setData({ 'chapStory.barAway': true });   // 滑动时把底栏收下去
    if (this._settleTimer) clearTimeout(this._settleTimer);
    // 慢滑就地显形(样机是每次 scroll 都量一遍;这里量一次要跨线程查询,
    // 每帧查会卡,所以压到下一拍再量,手感上仍是「跟着滑就浮出来」),
    // 快滑一律等停下 —— 滑得快时屏幕上没有字,这就是 tesseract 的手感。
    this._settleTimer = setTimeout(() => this._settleStory(), this._storyVel < STORY_FAST_PX ? 30 : 70);
  },

  /** 停下来这一刻,量所有行相对视口的位置:在屏内且还没显形的,让它上浮一行、由虚到实。
   *  出了屏的复位 —— 再滚回来要能重演一次,而不是「向下滚完再向上就没效果了」。 */
  _settleStory() {
    if (!this.data.chapStory.show) return;
    if (this.data.chapStory.barAway) this.setData({ 'chapStory.barAway': false });   // 停下来,底栏弹回来
    const that = this;
    const dir = this._storyDir === 'down' ? 'down' : 'up';
    wx.createSelectorQuery().in(this)
      .select('.st-scroll').boundingClientRect()
      .selectAll('.st-line').boundingClientRect()
      .exec((r) => {
        const box = r && r[0], list = (r && r[1]) || [];
        if (!box || !list.length) return;
        // 同一批补显形的行要**逐条错开** 50ms:一起亮就是整块淡入,不是样机那种一行一行浮起来
        let order = 0;
        const next = that.data.chapStory.lines.map((ln, i) => {
          const it = list[i];
          if (!it) return ln;
          const cy = it.top + it.height / 2 - box.top;
          const inView = cy > -20 && cy < box.height - 40;
          if (ln.in && !inView) return { ...ln, in: false, dir: cy < 0 ? 'down' : 'up', d: 0 };
          if (!ln.in && inView) { const d = (order++) * 0.05; return { ...ln, in: true, dir, d }; }
          return ln;
        });
        // 只在真有变化时 setData:停一次就整表重刷会把已显形那些行的过渡重放一遍
        const changed = next.some((ln, i) => ln.in !== that.data.chapStory.lines[i].in);
        if (changed) that.setData({ 'chapStory.lines': next });
      });
  },

  /** 分层漂浮粒子。近景那层画在文字上方(第二张 canvas),会遮住字 —— 这是刻意的景深。
   *  视差幅度大于手指位移:k>1 的层跟手跑得比手快,近的才「近」。 */
  _startStoryDust() {
    if (this.data.reducedMotion) return;      // 降低动态:静止的星点即可,不跑 rAF
    const that = this;
    const seed = [];
    // z 越大越近:更大、更实、视差更强。形状只有方/圆/三角,不画十字星、不加光晕。
    // 三层的**数量与视差系数照样机**:远景 190 颗 k=0.7、中景 20 颗 k=1.5、近景 12 颗 k=2.2。
    // 远景要足够密才是「星场」;之前 86 颗是随手写的,稀得像几粒灰。
    for (let i = 0; i < 222; i++) {
      const z = i < 190 ? 0.7 : (i < 210 ? 1.5 : 2.2);
      seed.push({ x: Math.random(), y: Math.random() * 2, z,
        s: (0.9 + Math.random() * 1.4) * z, a: (0.18 + Math.random() * 0.3) * (z > 1 ? 1 : 0.8),
        // vx/vy 的量纲是**像素每帧**,除以画布尺寸才归一化到 0..1 的坐标系。
        // 之前这里给的是 ±0.01 再除以宽度 ⇒ 每帧 0.01px,一秒挪不到一个像素,肉眼就是静止。
        shape: i % 3, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.4 });
    }
    this._dust = seed;
    const paint = (id, near) => wx.createSelectorQuery().in(this).select('#' + id)
      .fields({ node: true, size: true }).exec((res) => {
        const item = res && res[0]; if (!item || !item.node) return;
        const cv = item.node, ctx = cv.getContext('2d');
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        cv.width = item.width * dpr; cv.height = item.height * dpr; ctx.scale(dpr, dpr);
        const W = item.width, H = item.height;
        const loop = () => {
          // show 落 false 比 _stopStoryDust 置 null 晚 260ms(关层动画),窗口内这帧还会跑到 —— 两个都要守
          if (!that.data.chapStory.show || !that._dust) return;
          ctx.clearRect(0, 0, W, H);
          const off = (that._storyTop || 0);
          for (const p of that._dust) {
            if ((p.z > 1.2) !== near) continue;
            p.x += p.vx / W; p.y += p.vy / H;                  // 自己也慢慢漂,不完全靠手
            if (p.x < -0.05) p.x = 1.05; if (p.x > 1.05) p.x = -0.05;
            const y = ((p.y * H - off * p.z) % (H * 2) + H * 2) % (H * 2) - H * 0.5;
            ctx.globalAlpha = p.a;
            ctx.fillStyle = '#FFFFFF';                          /* ds-ok 星点恒白:玩家端整页单色 */
            const x = p.x * W, s = p.s;
            if (p.shape === 0) ctx.fillRect(x, y, s, s);
            else if (p.shape === 1) { ctx.beginPath(); ctx.arc(x, y, s / 2, 0, 6.2832); ctx.fill(); }
            else { ctx.beginPath(); ctx.moveTo(x, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2);
              ctx.lineTo(x - s / 2, y + s / 2); ctx.closePath(); ctx.fill(); }
          }
          // ⚠️ 只在预览态回写帧计数:静态截图看不出「粒子有没有在动」,
          //    而这正是之前漏掉的 bug(漂移量纲写错,每帧只挪 0.01px,看着完全静止)。
          //    生产态不写 —— 一秒一次 setData 是白花的开销。
          if (that.data.isPreview) {
            that._dustFrames = (that._dustFrames || 0) + 1;
            if (that._dustFrames % 60 === 0) that.setData({ 'chapStory.frames': that._dustFrames });
          }
          that['_raf' + id] = cv.requestAnimationFrame(loop);
        };
        loop();
      });
    paint('stBack', false);
    paint('stFront', true);
  },

  _stopStoryDust() {
    this._dust = null;
    // canvas 节点随层一起销毁,这里只把 rAF 句柄清掉,别在下次开层时接着上一轮
    this._rafstBack = 0; this._rafstFront = 0;
  },

  /** 店铺卡 → 店铺分身对话。开场是一句居中大字问候,商家自己写了 greeting 就用他的,
   *  没写才回落到按时段拼的那句 —— 不要用模板顶掉作者写过的话。 */
  openShopNpc() {
    const v = this.data.hero.node || {};
    if (!v.nodeId) { cyToast('这家店还没有可对话的分身'); return; }
    if (!v.npcName) { cyToast('这家还没有店铺分身'); return; }
    const node = (this.data.nodes || []).find((n) => String(n.nodeId) === String(v.nodeId)) || {};
    const h = new Date().getHours();
    const hi = (h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好');
    const authored = node.npc && node.npc.greeting ? String(node.npc.greeting).trim() : '';
    this.setData({
      shopNpc: {
        show: true, open: false, name: v.npcName,
        greeting: authored || (hi + '，我是' + v.npcName + '，欢迎来到' + (v.name || '我们店铺')),
        started: false, msgs: [], input: '', thinking: false, thinkPhase: 0, nodeId: v.nodeId, ry: 0, recording: false,
      },
    }, () => { this._npcTimer = setTimeout(() => { this.setData({ 'shopNpc.open': true }); this._startNpcFigure(); }, 30); });
  },

  /** 画那个人形。几何由 utils/npc-figure 生成(纯函数,可单测),这里只负责上色与绘制 ——
   *  色值必须留在本文件:玩家端整页单色有契约扫描,扫的是这几个文件。 */
  _startNpcFigure() {
    const that = this;
    wx.createSelectorQuery().in(this).select('#npcFig').fields({ node: true, size: true }).exec((res) => {
      const item = res && res[0];
      if (!item || !item.node) return;
      const cv = item.node, ctx = cv.getContext('2d');
      let dpr = 2; try { dpr = wx.getWindowInfo().pixelRatio || 2; } catch (e) {}
      cv.width = item.width * dpr; cv.height = item.height * dpr; ctx.scale(dpr, dpr);
      const W = item.width, H = item.height;
      const model = npcFigure.buildFigure();
      const draw = (ry, bob) => {
        ctx.clearRect(0, 0, W, H);
        ctx.save(); ctx.translate(0, bob);
        const proj = npcFigure.project(model.verts, ry, W, H);
        const faces = npcFigure.shadeFaces(model.verts, model.faces, ry, proj);
        for (const f of faces) {
          const t = model.faces[f.idx];
          const a = proj.p[t[0]], b = proj.p[t[1]], c = proj.p[t[2]];
          // ⚠️ 必须用**不透明**灰阶。半透明填充下,补缝用的重叠区会把 alpha 叠一倍 ——
          //    实拍两轮都栽在这:先是描边描出线框人,再是微膨胀涨出亮网格。
          //    不透明之后重叠只是同色重画,缝彻底看不见了。整体轻重交给画布的 opacity。
          const g = Math.round(28 + f.shade * 86);   // 28..114:再暗就比下面的名字还弱,形象反而成了背景
          ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';  /* ds-ok 人形的体积明暗,中性灰阶不是色板色 */
          // 沿质心把三角微微涨 0.4px,盖住抗锯齿留下的发丝缝
          const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3;
          ctx.beginPath();
          for (const q of [a, b, c]) {
            const dx = q[0] - mx, dy = q[1] - my, L = Math.sqrt(dx * dx + dy * dy) || 1;
            const px = q[0] + dx / L * 0.4, py = q[1] + dy / L * 0.4;
            if (q === a) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      };
      that._drawNpcFig = draw;
      that._npcCanvas = cv;          // 收起时要拿它 cancelAnimationFrame,不能只把句柄置 0
      if (that.data.reducedMotion) { draw(that.data.shopNpc.ry || 0, 0); return; }
      const t0 = Date.now();
      const loop = () => {
        if (!that.data.shopNpc.show) return;
        draw(that.data.shopNpc.ry || 0, Math.sin((Date.now() - t0) / 1400) * 5);   // 呼吸式浮动
        that._rafNpcFig = cv.requestAnimationFrame(loop);
      };
      loop();
    });
  },

  /** 真取消,不是只把句柄置 0:loop 里那句 `if (!show) return` 只在**下一帧**才生效,
   *  置 0 期间画布仍在跑一帧。canvas 的 rAF 要用同一个 canvas 节点去 cancel。 */
  _stopNpcFigure() {
    if (this._npcCanvas && this._rafNpcFig) {
      try { this._npcCanvas.cancelAnimationFrame(this._rafNpcFig); } catch (e) {}
    }
    this._drawNpcFig = null; this._rafNpcFig = 0; this._npcCanvas = null;
  },

  /** 形象跟手左右转。几何是真的绕 Y 轴转,不是把一张平面剪影压扁 ——
   *  ±38° 是样机定的幅度,再大就看见后脑勺,分身「在跟你说话」的感觉就没了。 */
  onNpcTouchStart(e) { this._npcX = e.touches[0].pageX; this._npcRy0 = this.data.shopNpc.ry || 0; },
  onNpcTouchMove(e) {
    if (this._npcX == null) return;
    const dx = e.touches[0].pageX - this._npcX;
    const ry = Math.max(-38, Math.min(38, (this._npcRy0 || 0) + dx * 0.35));
    if (Math.abs(ry - (this.data.shopNpc.ry || 0)) >= 1) this.setData({ 'shopNpc.ry': Math.round(ry) });
  },
  onNpcTouchEnd() { this._npcX = null; },

  closeShopNpc() {
    if (!this.data.shopNpc.show) return;
    if (this._npcTimer) { clearTimeout(this._npcTimer); this._npcTimer = 0; }
    this._stopThinkBeat();
    this._stopShopNpcVoice();
    this._stopNpcFigure();
    this.setData({ 'shopNpc.open': false });
    this._npcTimer = setTimeout(() => this.setData({ 'shopNpc.show': false }), 260);
  },

  /** 点输入框问候语就让位 —— 和样机一致:大字只在还没开口时占着中间那块地方。 */
  onShopNpcFocus() { if (!this.data.shopNpc.started) this.setData({ 'shopNpc.started': true }); },
  onShopNpcInput(e) { this.setData({ 'shopNpc.input': e.detail.value }); },

  /** 按住说话。松开就上传转写,转写出来的文字**走和打字完全相同**的那条链路 ——
   *  所以「点了语音就回不了打字」在结构上不成立:输入框一直在,语音只是它旁边的另一个入口。
   *  ⚠️ 这里直连 wx.uploadFile 而不走 app.getUploadClient():那条通道的契约要求返回
   *  文件 URL(它是给要落 OSS 的资产用的),而语音片段是临时的、刻意不持久化。 */
  onVoiceStart() {
    const s = this.data.shopNpc;
    if (!s.show || s.thinking) return;
    const that = this;
    wx.authorize({ scope: 'scope.record' })
      .then(() => that._beginRecord())
      .catch(() => cyToast('没有录音权限，先在设置里打开'));
  },

  _beginRecord() {
    const rec = wx.getRecorderManager();
    this._rec = rec;
    rec.onStop((res) => {
      this.setData({ 'shopNpc.recording': false });
      if (!res || !res.tempFilePath || (res.duration || 0) < 500) return;   // 误触:不到半秒不算一句话
      this._sendVoice(res.tempFilePath);
    });
    rec.onError(() => { this.setData({ 'shopNpc.recording': false }); cyToast('录音出错了'); });
    rec.start({ duration: 60000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
    this.setData({ 'shopNpc.recording': true, 'shopNpc.started': true });
  },

  onVoiceEnd() {
    if (!this.data.shopNpc.recording) return;
    try { this._rec && this._rec.stop(); } catch (e) { this.setData({ 'shopNpc.recording': false }); }
  },

  /** 语音走**统一上传通道的 uploadOne**,不裸调 wx.uploadFile ——
   *  裸调会漏掉认证头构造,而这条链路是要花钱的写操作。
   *  这里用 uploadOne 而不是 uploadAll:后者强制结果里带文件地址,而语音刻意不落盘,
   *  返回的是分身的回答。 */
  _sendVoice(filePath) {
    const s = this.data.shopNpc;
    const that = this;
    this.setData({ 'shopNpc.thinking': true });
    this._startThinkBeat();
    app.getUploadClient().uploadOne(filePath, {
      path: '/api/ai/npc/voice-chat',
      formData: { nodeId: s.nodeId, requestId: uuid4() },
      onDone(r) {
        if (!r.ok) { that._pushShopNpcReply(r.msg || '没听清，再说一次'); return; }
        const d = r.data;
        // 先把识别出的原话作为我方消息补上 —— 玩家要能看见自己被听成了什么
        const asr = d.asr || '（语音）';
        const msgs = that.data.shopNpc.msgs.concat([{ id: that.data.shopNpc.msgs.length + 1, role: 'me', text: asr }]);
        that.setData({ 'shopNpc.msgs': msgs });
        const reply = (d.data && (d.data.safeText || d.data.text)) || '';
        that._pushShopNpcReply(reply || '这个我说不好，你到店里当面问我一次。', undefined,
          d.data && d.data.audioUrl);
      },
    });
  },

  /** 物理返回:对话层是页内层,不能让返回键直接退出整页。 */
  onShopNpcNativeBack() { this.closeShopNpc(); },

  /** 问一句。requestId 由本端生成,后端按 (user, requestId) 幂等 ——
   *  网络抖动重发不会二次调用模型、不会二次计费。 */
  sendShopNpc() {
    const s = this.data.shopNpc;
    const text = String(s.input || '').trim();
    if (!text || s.thinking) return;
    const msgs = s.msgs.concat([{ id: s.msgs.length + 1, role: 'me', text }]);
    this.setData({ 'shopNpc.msgs': msgs, 'shopNpc.input': '', 'shopNpc.thinking': true, 'shopNpc.started': true });
    this._startThinkBeat();
    this._askShopNpc(text);
  },

  /** 真正发问那一段。打字与「重答」共用 —— 兜底文案的口径只能有一份。
   *  @param replaceIdx 传了就改写这一条(重答),不传则追加一条(正常问答)。 */
  _askShopNpc(text, replaceIdx) {
    const that = this;
    const requestId = uuid4();
    req('/api/ai/npc/shop-chat', 'POST', { requestId, nodeId: this.data.shopNpc.nodeId, message: text }).then((r) => {
      const d = (r && r.data) || {};
      // safeText 是后端在拒绝/失败时给的安全兜底文案;正常回答也走同一个字段。
      const reply = d.safeText || d.text || '';
      // ⚠️ 重答失败时**不能覆盖**原来那条:玩家点「重答」是想要个更好的答案,
      //    结果把已经拿到的好答案换成一句「网络异常」,等于为了再问一次把答案弄丢了。
      //    失败就保住原文,错误走轻提示。(2026-09-08 实拍抓到)
      if (!reply && replaceIdx != null) {
        that._stopThinkBeat();
        that.setData({ 'shopNpc.thinking': false, 'shopNpc.thinkPhase': 0 });
        cyToast(r && r.msg ? String(r.msg) : '没问成，原来那条还在');
        return;
      }
      // ⚠️ 接口被闸掉(店铺分身对话默认关)或没配人设时,不要编一句「我有点忙」——
      //    那是假话,玩家会一直重试。把服务端说的原话端出来。
      that._pushShopNpcReply(reply || (r && r.msg ? String(r.msg) : '这个我说不好，你到店里当面问我一次。'),
        replaceIdx, d.audioUrl);
    });
  },

  /** @param replaceIdx 传了就改写这一条(重答),不传则追加。 */
  _pushShopNpcReply(text, replaceIdx, audioUrl) {
    this._stopThinkBeat();
    if (!this.data.shopNpc.show) return;   // 已经收起来了就别再往里塞
    const old = this.data.shopNpc.msgs;
    const target = old[replaceIdx];
    const msgs = target && target.role === 'ai'
      // id 保持不变:换了 id 会让 wx:key 判成新节点,整条重新入场闪一下
      ? old.map((m, i) => (i === replaceIdx ? { ...m, text } : m))
      : old.concat([{ id: old.length + 1, role: 'ai', text }]);
    this.setData({ 'shopNpc.msgs': msgs, 'shopNpc.thinking': false, 'shopNpc.thinkPhase': 0 });
    this._playShopNpcVoice(audioUrl);
  },

  _playShopNpcVoice(audioUrl) {
    if (!audioUrl) return;
    this._stopShopNpcVoice();
    const audio = wx.createInnerAudioContext();
    this._shopNpcVoiceAudio = audio;
    audio.src = audioUrl;
    audio.onEnded(() => this._stopShopNpcVoice());
    audio.onError(() => this._stopShopNpcVoice());
    audio.play();
  },

  _stopShopNpcVoice() {
    if (!this._shopNpcVoiceAudio) return;
    try { this._shopNpcVoiceAudio.stop(); this._shopNpcVoiceAudio.destroy(); } catch (e) {}
    this._shopNpcVoiceAudio = null;
  },

  /** 等待名条的第二拍:「{名} 正在输入…」→「正在回答」。
   *  一句话不动地挂着,超过一秒就像卡住了;换一拍是在说「还在,只是慢」。 */
  _startThinkBeat() {
    this._stopThinkBeat();
    this.setData({ 'shopNpc.thinkPhase': 0 });
    this._thinkTimer = setTimeout(() => {
      if (this.data.shopNpc.thinking) this.setData({ 'shopNpc.thinkPhase': 1 });
    }, 1200);
  },

  _stopThinkBeat() {
    if (this._thinkTimer) { clearTimeout(this._thinkTimer); this._thinkTimer = 0; }
  },

  /** 复制这一条回答。分身说的话经常是地址、年份、暗号 —— 记不住就得能带走。 */
  copyNpcMsg(e) {
    const text = String(e.currentTarget.dataset.text || '');
    if (!text) return;
    wx.setClipboardData({ data: text });
  },

  /** 重答:把这条回答**之前**最近的那句我方提问原样再问一次,新答案**改写原来那一条**。
   *  两条都不做:不写回输入框(会覆盖玩家正在打的字)、不追加一条新回答
   *  (同一个问题挂两个答案,读起来像分身自言自语说了两遍)。 */
  retryNpcMsg(e) {
    const s = this.data.shopNpc;
    if (s.thinking) return;
    const idx = Number(e.currentTarget.dataset.idx);
    let ask = '';
    for (let i = idx - 1; i >= 0; i--) {
      if (s.msgs[i] && s.msgs[i].role === 'me') { ask = s.msgs[i].text; break; }
    }
    if (!ask) return;
    this.setData({ 'shopNpc.thinking': true });
    this._startThinkBeat();
    this._askShopNpc(ask, idx);
  },

  /** 卡片飞到位之后自转一整圈:一圈之内正面、右脊、背面、左脊各露一次,
   *  「这张卡是有厚度的、背面写着章节」这件事不用文案说,转一圈就看见了。
   *  ⚠️ 用定时器逐帧推 --ry 而不是 CSS animation:转完要**停在 0°**并接上呼吸浮动,
   *  animation 结束回到初值会闪一下,而且中途被手指接管时没法平滑接续。 */
  _spinHeroCard() {
    if (this.data.reducedMotion) { this.setData({ 'hero.spun': true }); return; }
    const that = this;
    if (this._spinTimer) clearTimeout(this._spinTimer);
    this._spinTimer = setTimeout(() => {
      const t0 = Date.now(), DUR = 1100;
      const step = () => {
        if (!that.data.hero.show) return;
        if (that._cardDrag) { that.setData({ 'hero.spun': true }); return; }   // 手指接管:角度交给拖动
        const p = Math.min(1, (Date.now() - t0) / DUR);
        // easeInOutCubic:起步慢、中段快、收尾稳,跟样机同一条
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const ry = Math.round(360 * e) % 360;
        that.setData({ 'hero.ry': ry, 'hero.turned': turnedAt(ry) });
        if (p < 1) { that._spinTimer = setTimeout(step, 16); }   // 复用同一个句柄:延时与逐帧不会同时在跑,收起时才真能取消
        else { that.setData({ 'hero.ry': 0, 'hero.spun': true, 'hero.turned': false }); }   // 收在正面,再交给呼吸浮动
      };
      step();
    }, 350);
  },

  /** 跟手左右转。转的是卡片自己,±180° 之内随便转 —— 背面本来就是给人看的。 */
  onCardTouchStart(e) {
    this._cardDrag = true; this._cardAxis = '';
    this._cardX = e.touches[0].pageX; this._cardY = e.touches[0].pageY;
    this._cardRy0 = this.data.hero.ry || 0; this._cardTop0 = this._heroScrollTop || 0;
  },
  /** 卡片压在正文之上,所以竖向滑动落不到 scroll-view 上 —— 这里按首个明显位移判轴:
   *  横向转卡片,竖向代它把正文滚起来(scroll-top 受控)。不这么做的话,
   *  手指落在卡片上就滚不动页面,而卡片又占了上半屏。 */
  onCardTouchMove(e) {
    if (!this._cardDrag) return;
    const dx = e.touches[0].pageX - this._cardX, dy = e.touches[0].pageY - this._cardY;
    if (!this._cardAxis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      this._cardAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (this._cardAxis === 'y') {
      const top = Math.max(0, (this._cardTop0 || 0) - dy);
      this.setData({ 'hero.scrollTop': Math.round(top) });
      return;
    }
    const ry = (this._cardRy0 || 0) + dx * 0.8;
    if (Math.abs(ry - (this.data.hero.ry || 0)) >= 1) this.setData({ 'hero.ry': Math.round(ry), 'hero.turned': turnedAt(ry) });
  },
  /** 松手吸附到最近的一面。停在 40° 这类角度上只能看见一条厚度,既不是正面也不是背面 ——
   *  样机松手也是吸附到正/背面的。 */
  onCardTouchEnd() {
    this._cardDrag = false;
    if (this._cardAxis === 'y') { this._cardAxis = ''; return; }   // 竖向那次是在滚页面,别去动转角
    this._cardAxis = '';
    const ry = this.data.hero.ry || 0;
    const snap = Math.round(ry / 180) * 180;
    this.setData({ 'hero.ry': snap, 'hero.spun': true, 'hero.turned': turnedAt(snap) });
  },

  /** 正文往上滚时,卡片缩小、左移、淡出,顶栏换成一条「缩略图 + 店名」的紧凑条。
   *  与样机同一条曲线:0→220px 映射到 p 0→1,缩到 0.12,越过 0.85 顶栏接管。
   *  ⚠️ 正文的滚动区从顶栏下面就开始(内容自己顶一段占位),卡片才可能被内容盖过去;
   *  把滚动区压到卡片下方的话,卡片缩走会在上面留下一块空背景。 */
  onHeroScroll(e) {
    const top = e.detail.scrollTop || 0;
    this._heroScrollTop = top;
    const p = Math.min(1, Math.max(0, top / 220));
    // 只缩不移:transform-origin 是 0 0,收缩方向本来就朝卡片左上角(顶栏缩略图那一侧),
    // 再叠一个左移会把它推出屏幕外。
    const next = { sx: 0, ss: (1 - 0.88 * p).toFixed(3), faded: p > 0.92, collapsed: p > 0.85 };
    const cur = this.data.hero;
    if (cur.sx === next.sx && cur.ss === next.ss && cur.collapsed === next.collapsed) return;
    this.setData({ 'hero.sx': next.sx, 'hero.ss': next.ss, 'hero.faded': next.faded, 'hero.collapsed': next.collapsed });
  },

  /** 导航行:整卡是进分身对话,这一行单独接管,catchtap 在 wxml 那侧靠独立 view 分开。
   *  没有坐标就不假装能导航 —— 提示一句比打开一张空白地图诚实。 */
  openHeroNav() {
    const node = (this.data.nodes || []).find((n) => String(n.nodeId) === String(this.data.hero.node.nodeId));
    const lng = node && Number(node.longitude), lat = node && Number(node.latitude);
    if (!lng || !lat) { cyToast('这家还没标坐标'); return; }
    wx.openLocation({ longitude: lng, latitude: lat, name: node.name || '', address: node.address || '', scale: 18 });
  },

  /** 卡片详情的正文投影。三件事分明:章节是章节的、店铺是店铺的、游戏是游戏的 ——
   *  混着写玩家分不清「这段讲的是这一章」还是「这段讲的是这个玩法」。
   *  ⚠️ 只读已下发字段,不在这里补默认文案:没有的段直接不渲染,比编一句占位诚实。 */
  _heroView(node) {
    const chap = ((this.data.chapterCards || []).filter((c) => c.id != null
      && String(c.id) === String(node.chapterId))[0]) || null;
    // 「怎么玩」= 商家/主办方写的规则说明,按换行拆条;拆不出多条就当一段正文。
    const howto = String(node.rule || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const perk = node.perk || null;
    const meta = [];
    if (node.duration) meta.push({ icon: 'clock', text: node.duration });
    if (node.players) meta.push({ icon: 'mtab-customers', text: node.players });
    if (perk && perk.name) meta.push({ icon: 'gift', text: perk.name });
    return {
      nodeId: node.nodeId,
      name: node.name, imgUrl: String(node.imgUrl || '').split(',')[0], done: !!node.done,
      // ① 章节
      chapMeta: chap ? ('本章 · ' + (chap.meta || '')) : '',
      chapNo: chap ? (chap.meta || '') : '',      // 卡面眉标用的是不带「本章」前缀的那一版
      chapName: chap ? (chap.title || '') : '',
      chapDesc: chap ? (chap.description || chap.sub || '') : '',
      audio: node.audio || '', audioDur: node.audioDur || '',
      chapCover: (chap && chap.cover) || String(node.imgUrl || '').split(',')[0] || '',
      playName: node.gameTitle || '',
      // ⚠️ 这里**不再**把整章正文分段下发到详情:章节正文只出现在故事流里。
      // 详情重复念一遍会让「点进故事流」失去理由(用户 9-07 口径:「章节详情里不写章节内容」)。
      // 卡片背面只承载开头那一段(卡面装不下整章,长章节会溢出去)
      chapLead: (chap ? String(chap.description || chap.sub || '') : '')
        .split(/\n\s*\n|\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || '',
      hook: node.hookText || '',
      // ② 店铺
      address: node.address || '', businessTime: node.businessTime || '',
      npcName: node.npc && node.npc.name ? node.npc.name : '',
      // ③ 游戏
      gameKind: node.vm === 2 ? '拍照任务' : (node.vm === 3 || node.vm === 1 ? '答题' : (node.vm === 4 ? '现场打卡' : '')),
      gameTitle: node.gameTitle || '', gameMeta: meta,
      howto, materials: node.materials || '',
      // ④ 到店三步:第一步到店、第二步凭证、第三步商家核销
      stepArrive: !!node.arrived, stepProof: !!node.gameDone, stepRedeem: !!node.done,
      // ⑤ 本店权益
      perkName: perk ? (perk.name || '') : '',
      perkRule: perk ? (perk.redeemRule || '到店出示核销') : '',
      perkValid: (function () {
        const t = perk && perk.validEnd ? chinaParts(perk.validEnd) : null;
        return t ? ('有效期至 ' + t.month + '/' + t.day) : '';
      })(),
    };
  },

  /** 点卡 → hero:量到被点瓦片的视口矩形,克隆一张放在原位,下一帧过渡到目标位。
   *  目标位 = 页边距内居中、顶在 contentTop 之下、等比放大(非等比会把封面拉变形),
   *  高度不超过半屏,给下面的正文留地方。量不到矩形(布局没稳)就退回直接跳商家页 —— 动效永远不能挡住办事。 */
  _openHero(node, idx) {
    if (!node || this.data.hero.show) return;
    const tile = (this.data.seatTiles || [])[idx];
    // 发牌播放中不开:此刻量到的是半空中的矩形
    if (tile && tile.fly && !tile.land && !this.data.packOpen) return;
    const that = this;
    wx.createSelectorQuery().selectAll('.fx-tile').boundingClientRect().exec((r) => {
      const from = r && r[0] && r[0][idx];
      if (!from || !from.width) { that.heroEnter({ currentTarget: { dataset: { id: node.nodeId } } }); return; }
      let win = { windowWidth: 375, windowHeight: 812 };
      try { win = wx.getWindowInfo(); } catch (e2) {}
      const rpx = (win.windowWidth || 375) / 750;
      const top0 = that.data.chrome.contentTop + 12 * rpx;
      const s = Math.min((win.windowWidth - 64 * rpx) / from.width, (win.windowHeight * 0.46) / from.height);
      const tw = from.width * s, th = from.height * s;
      const hx = Math.round((win.windowWidth - tw) / 2 - from.left), hy = Math.round(top0 - from.top);
      const style = 'left:' + Math.round(from.left) + 'px;top:' + Math.round(from.top) + 'px;'
        + 'width:' + Math.round(from.width) + 'px;height:' + Math.round(from.height) + 'px;'
        + '--hx:' + hx + 'px;--hy:' + hy + 'px;--hs:' + s.toFixed(4);
      const view = Object.assign({}, tile || {}, that._heroView(node));
      that.setData({ hero: { show: true, open: false, node: view, style, bodyTop: Math.round(top0 + th + 28 * rpx), ry: 0, spun: false, turned: false, sx: 0, ss: '1', faded: false, collapsed: false, scrollTop: 0 } }, () => {
        // 起点那一帧必须先画出来,否则没有过渡直接出现在终点
        that._heroTimer = setTimeout(() => { that.setData({ 'hero.open': true }); that._spinHeroCard(); }, 30);
      });
    });
  },
  closeHero() {
    if (!this.data.hero.show) return;
    if (this._heroTimer) clearTimeout(this._heroTimer);
    this.setData({ 'hero.open': false });
    const wait = this.data.reducedMotion ? 0 : HERO_DUR + 40;
    if (this._spinTimer) { clearTimeout(this._spinTimer); this._spinTimer = 0; }
    this._heroTimer = setTimeout(() => this.setData({ hero: { show: false, open: false, node: null, style: '', bodyTop: 0, ry: 0, spun: false, turned: false, sx: 0, ss: '1', faded: false, collapsed: false, scrollTop: 0 } }), wait);
  },
  /** 「进店」:hero 是看,商家页是办(扫码/凭证/核销)。跳之前直接收掉 hero,
   *  回来看到的是格子 —— 商家页里状态可能已变,留一张陈旧的 hero 比没有更糟。 */
  heroEnter(e) {
    // 故事流底栏的「开始」也走这里:进游戏前把故事流关掉(顺带停旁白音频),
    // 否则游戏全程叠着章节旁白,退出游戏后故事流还带着旧内容重弹。
    // 必须放在下面两个 early-return 之前:hero.node 为 null(id 取不到)时按钮不能死着不动,
    // 至少把故事流收掉回到卡片层(closeChapStory 自带 show 守卫,没开时是空操作)
    this.closeChapStory();
    const id = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id != null)
      ? e.currentTarget.dataset.id : (this.data.hero.node && this.data.hero.node.nodeId);
    if (id == null) return;
    const node = (this.data.nodes || []).find((n) => String(n.nodeId) === String(id));
    if (node && node.done) return;      // 已核销:按钮是禁用态,点不动
    if (this._heroTimer) clearTimeout(this._heroTimer);
    this.setData({ hero: { show: false, open: false, node: null, style: '', bodyTop: 0, ry: 0, spun: false, turned: false, sx: 0, ss: '1', faded: false, collapsed: false, scrollTop: 0 } });
    // 「开始互动 获得奖励!」直接进玩法面板,不再经商家页中转 ——
    // 中间那一页除了再点一次「开始」之外没有别的事可做(用户 2026-09-08 定)。
    if (node) { this.startGame(node); return; }
    wx.navigateTo({ url: '/pages/play/merchant/index?nodeId=' + id });   // 拿不到节点时的兜底
  },
  /** 物理返回 / iOS 侧滑被 page-container 守卫吃掉后落到这里:关的是 hero,不是 play 页。
   *  按钮关闭时 hero.show 已先置 false,守卫随之 leave 再进来一次 —— closeHero 的 guard 让它成为空操作。 */
  onHeroNativeBack() {
    this.closeHero();
  },
  closeChapterPick() { this.setData({ 'chapterPick.show': false }); },
  onPickChapter(e) {
    const idx = Number(e.currentTarget.dataset.idx) || 0;
    this.setData({ 'chapterPick.show': false, 'chapterPick.cur': idx, packOpen: true });
  },
  /** 顶部输入地址选中一条 = 把地图挪过去并打开它的详情半屏。不跳页。 */
  onSearchPick(e) {
    const p = e.detail || {};
    const lat = Number(p.lat); const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.setData({ fmCenter: { lat, lng } });
    const node = this._nodeById(p.nodeId);
    if (node) this.openSheet(node);
  },

  /** 节点级前置解锁:locked 只提示不放行。服务端四个完成入口另有硬闸,这里是 UX 层(文案与服务端一致:说「先完成什么」,不说「不可用」)。 */
  _lockedTip(node) {
    if (node && node.paused) {
      cyToast('本站已暂停，请改去其他节点');
      return true;
    }
    if (!node || !node.locked) return false;
    if (this._routeState.routeMode === 'BRANCH_GRAPH') {
      cyToast(node.lockReason || '前路未知 · 完成当前路线后解锁');
      return true;
    }
    const prev = (this.data.nodes || []).find((n) => String(n.nodeId) === String(node.unlockAfterNodeId));
    cyToast(prev ? ('先完成「' + prev.name + '」才会解锁') : '前路未知 · 先完成前置关卡');
    return true;
  },

  /** 角色卡只展示服务端投影；客户端不再按 roleCode 自带角色秘密或技能正文。 */
  _maybeShowRoleCard(myRole) {
    if (!myRole || !myRole.roleCode) return;
    // 角色图标只是展示层映射,不含线索/技能正文;desc/skill 仍只取服务端投影。
    const meta = {
      NAVIGATOR:  { iconName: 'tab-explore' },
      OBSERVER:   { iconName: 'search' },
      RECORDER:   { iconName: 'camera' },
      NEGOTIATOR: { iconName: 'tab-feed' },
      DECODER:    { iconName: 'scan' }
    }[myRole.roleCode] || { iconName: 'star' };
    const roleScope = this.data.activityId || this.data.topicId || '';
    const key = this._roleSeenKey(roleScope);
    let seen = false; try { seen = key ? !!wx.getStorageSync(key) : false; } catch (e) {}
    try { wx.removeStorageSync('role_seen_' + roleScope); } catch (e) {}
    if (seen && myRole.confirmed !== false) return;
    this.setData({ roleCard: {
      show: true,
      code: myRole.roleCode,
      name: myRole.roleName || '',
      iconName: meta.iconName,
      desc: myRole.summary || '这是你今晚的身份。留意角色线索，和队友一起推进本局。',
      skill: myRole.skill || '',
      confirmed: myRole.confirmed === true,
    } });
    if (myRole.confirmed === true) {
      try { if (key) wx.setStorageSync(key, 1); } catch (e) {}
    }
  },
  closeRoleCard() { this.setData({ 'roleCard.show': false }); },

  confirmPlayerRole() {
    if (this.data.roleCard.confirmed) { this.closeRoleCard(); return; }
    if (this.data.gameModule.write.status === 'unknown') { this.reconcilePlayerChoice(); return; }
    if (this.data.gameModule.write.status === 'submitting') return;
    const gameModule = this.data.gameModule || {};
    const requestId = 'pg-role-' + gameModule.activityId + '-' + Date.now();
    let input;
    try {
      input = buildPlayerRoleConfirmInput(gameModule, requestId);
    } catch (error) {
      cyToast('身份状态暂未同步');
      return;
    }
    this.setData({ 'gameModule.write': { status: 'submitting', requestId, message: '正在确认身份…' } });
    if (!this._savePlayerPending(input)) {
      this._failPlayerPendingSave(requestId, false);
      return false;
    }
    gameSessionClient.submitAction('player', input).then((result) => {
      const pending = this._playerPendingWrite;
      const applied = result && result.status === 'success'
        && matchingPlayerTerminalReceipt(result, pending, 'APPLIED');
      const failed = result && result.status === 'business-error'
        && matchingPlayerTerminalReceipt(result, pending, 'FAILED');
      if (applied) {
        try {
          this._clearPlayerPending();
          const key = this._roleSeenKey(gameModule.activityId);
          if (key) wx.setStorageSync(key, 1);
        } catch (error) {}
        cyToast.success('身份已确认');
        this.setData({ 'roleCard.show': false, 'gameModule.write': { status: 'confirmed', requestId, message: '身份已确认' } }, () => this._loadPlayerGameModule());
        return;
      }
      if (failed) {
        this._clearPlayerPending();
        this.setData({ 'gameModule.write': { status: 'error', requestId, message: result.message || '身份确认未被接受' } });
        return;
      }
      this.setData({ 'gameModule.write': {
        status: 'unknown', requestId,
        canRetry: true,
        message: (result && result.message) || '身份确认结果待核对，请勿重复提交',
      } });
    }).catch(() => {
      this.setData({ 'gameModule.write': { status: 'unknown', requestId, message: '身份确认结果待核对，请勿重复提交', canRetry: true } });
    });
  },

  _roleSeenKey(scope) {
    const memberId = app.getUserID && app.getUserID();
    return memberId === null || memberId === undefined || memberId === '' || !scope
      ? '' : 'role_seen_m' + memberId + '_s' + scope;
  },

  _playerPendingKey() {
    const memberId = app.getUserID && app.getUserID();
    return memberId === null || memberId === undefined || memberId === '' || !this.data.activityId
      ? '' : 'game_player_pending_m' + memberId + '_a' + this.data.activityId;
  },

  _savePlayerPending(input, preserveMemoryCommand) {
    const pending = normalizePlayerPendingWrite({
      requestId: input && input.requestId,
      action: input && input.action,
      command: input,
    }, this.data.activityId);
    if (!pending) return false;
    const receiptIndex = normalizePlayerPendingReceiptIndex({
      activityId: pending.command.activityId,
      nodeId: pending.command.nodeId,
      requestId: pending.command.requestId,
      expectedRevision: pending.command.expectedRevision,
      action: pending.command.action,
    }, this.data.activityId);
    if (!receiptIndex) return false;
    const key = this._playerPendingKey();
    if (!key) return false;
    try {
      wx.setStorageSync(key, receiptIndex);
    } catch (error) {
      return false;
    }
    if (!preserveMemoryCommand) this._playerPendingWrite = pending;
    return true;
  },

  _failPlayerPendingSave(requestId, keepUnknown) {
    if (!keepUnknown) this._playerPendingWrite = null;
    const message = keepUnknown
      ? '无法安全保存重试状态；原操作仍待核对'
      : '无法安全保存本次操作，请检查小程序存储后重试';
    this.setData({ 'gameModule.write': {
      status: keepUnknown ? 'unknown' : 'error',
      requestId: keepUnknown ? requestId : '',
      message,
      canRetry: keepUnknown,
    } });
    cyToast(keepUnknown ? '无法安全保存，未发送重试' : '无法安全保存，请稍后重试');
    return false;
  },

  _clearPlayerPending() {
    this._playerPendingWrite = null;
    try {
      const key = this._playerPendingKey();
      if (key) wx.removeStorageSync(key);
      const legacyKey = 'game_player_pending_' + (this.data.activityId || '');
      if (wx.getStorageSync(legacyKey)) wx.removeStorageSync(legacyKey);
    } catch (error) {}
  },

  _rememberPlayerReveal(receipt, pending) {
    const command = pending && (pending.command || pending);
    const revealText = normalizePlayerRevealText(receipt && receipt.result && receipt.result.revealText);
    if (!command || pending.action !== 'PLAYER_REVEAL' || receipt.action !== 'PLAYER_REVEAL' || !revealText) return '';
    const nodeId = Number(command.nodeId);
    if (!Number.isSafeInteger(nodeId) || nodeId <= 0) return '';
    const nodes = ((this.data.gameModule && this.data.gameModule.nodes) || []).map((node) => (
      node && node.nodeId === nodeId ? Object.assign({}, node, { revealedAnswer: revealText }) : node
    ));
    this.setData({ 'gameModule.nodes': nodes });
    try {
      cyModal.show({
        title: '答案已揭示',
        content: revealText,
        showCancel: false,
        confirmText: '我知道了',
      });
    } catch (error) {}
    return revealText;
  },

  _loadPlayerGameModule() {
    const activityId = Number(this.data.activityId) || 0;
    if (!activityId || this.data.isPreview || this.data.isMock) return;
    this.setData({ 'gameModule.loading': true, 'gameModule.error': '' });
    gameSessionClient.loadProjection('player', activityId).then((result) => {
      if (!result || result.status !== 'ready') {
        const absent = result && ['GAME_SESSION_NOT_FOUND', 'GAME_SESSION_NOT_PREPARED', 'GAME_MODULE_DISABLED'].includes(result.reasonCode);
        const current = this.data.gameModule || {};
        const retainedSnapshot = !absent && current.enabled === true
          && typeof current.snapshotAt === 'string' && !!current.snapshotAt;
        this.setData({
          'gameModule.loading': false,
          'gameModule.enabled': retainedSnapshot ? true : false,
          'gameModule.stale': retainedSnapshot,
          'gameModule.error': absent ? '' : ((result && result.message) || '本局状态暂未同步'),
        });
        return;
      }
      const projection = normalizePlayerProjection(result.data);
      if (!projection.enabled) {
        this.setData({
          'gameModule.loading': false, 'gameModule.enabled': false,
          'gameModule.stale': false, 'gameModule.error': '',
        });
        return;
      }
      // R9-21:服务端会话已经结束(通关/取消)时,本地兜底的暂停快照不能把玩家拉回一局已结束的计时。
      if (projection.status === 'FINISHED' || projection.status === 'CANCELLED') {
        this._applyServerRunSessionEnd();
      }
      const taskEvidenceByNode = {};
      const previousRuntimeByNode = {};
      ((this.data.gameModule && this.data.gameModule.nodes) || []).forEach((node) => {
        if (!node || !node.nodeId) return;
        previousRuntimeByNode[String(node.nodeId)] = node;
        if (node.taskEvidence) taskEvidenceByNode[String(node.nodeId)] = node.taskEvidence;
      });
      projection.nodes = projection.nodes.map((node) => Object.assign({}, node, {
        taskEvidence: taskEvidenceByNode[String(node.nodeId)] || {
          type: node.playerTask ? node.playerTask.inputType : '',
          ready: false,
          text: '',
          evidenceUrls: [],
          statusText: '',
        },
        revealedAnswer: node.status === 'FALLBACK_COMPLETED' && node.completionSource === 'PLAYER_REVEAL'
          ? normalizePlayerRevealText(previousRuntimeByNode[String(node.nodeId)]
            && previousRuntimeByNode[String(node.nodeId)].revealedAnswer)
          : '',
      }));
      let savedPending = null;
      try {
        const legacyKey = 'game_player_pending_' + activityId;
        if (wx.getStorageSync(legacyKey)) wx.removeStorageSync(legacyKey);
        const pendingKey = this._playerPendingKey();
        savedPending = pendingKey ? (wx.getStorageSync(pendingKey) || null) : null;
      } catch (e) { savedPending = null; }
      const pending = normalizePlayerPendingReceiptIndex(savedPending, activityId);
      this._playerPendingWrite = pending;
      if (savedPending && !pending) this._clearPlayerPending();
      if (pending) {
        projection.write = {
          status: 'unknown', requestId: pending.requestId,
          message: '正在核对上次操作；不会自动重发现场内容', canRetry: false,
        };
      }
      const projectedByNode = {};
      projection.nodes.forEach((node) => { projectedByNode[String(node.nodeId)] = node; });
      const newlyCompleted = projection.nodes.find((node) => {
        const before = previousRuntimeByNode[String(node.nodeId)];
        return before && before.status !== 'COMPLETED' && node.status === 'COMPLETED'
          && parseGameCompletedAt(node.completedAt) > 0;
      });
      const nodes = (this.data.nodes || []).map((node) => {
        const projected = projectedByNode[String(node.nodeId)];
        if (!projected) return node;
        const paused = projected.status === 'PAUSED' || projected.stationStatus === 'PAUSED';
        const completed = projected.status === 'COMPLETED' || projected.status === 'FALLBACK_COMPLETED';
        const completedAt = parseGameCompletedAt(projected.completedAt);
        return Object.assign({}, node, {
          paused,
          runtimeStatus: projected.status,
          done: completed,
          doneAt: completedAt || (completed ? Number(node.doneAt) || 0 : 0),
          locked: paused || projected.status === 'LOCKED',
        });
      });
      const myRole = projection.role.code ? {
        roleCode: projection.role.code,
        roleName: projection.role.name,
        summary: projection.role.publicBrief,
        confirmed: projection.role.confirmed,
      } : this.data.myRole;
      this.setData({
        gameModule: Object.assign({}, projection, {
          loading: false, error: '', stale: false, sheetShow: this.data.gameModule.sheetShow,
        }),
        nodes,
        myRole,
      }, () => {
        this.rebuild();
        if (newlyCompleted) this._animateCompletedSegment(this.data.nodes, newlyCompleted.nodeId);
        if (myRole) this._maybeShowRoleCard(myRole);
        if (pending) this.reconcilePlayerChoice();
      });
    }).catch(() => {
      const current = this.data.gameModule || {};
      const retainedSnapshot = current.enabled === true
        && typeof current.snapshotAt === 'string' && !!current.snapshotAt;
      this.setData({
        'gameModule.loading': false,
        'gameModule.enabled': retainedSnapshot ? true : false,
        'gameModule.stale': retainedSnapshot,
        'gameModule.error': '本局状态暂未同步',
      });
    });
  },

  openGameModule() {
    this.setData({ 'gameModule.sheetShow': true });
  },
  closeGameModule() { this.setData({ 'gameModule.sheetShow': false }); },
  retryGameModule() { this._loadPlayerGameModule(); },

  submitPlayerChoice(e) {
    const gameModule = this.data.gameModule || {};
    if (!gameModule.enabled || gameModule.write.status === 'submitting' || gameModule.write.status === 'unknown') return;
    const nodeId = Number(e.currentTarget.dataset.node) || 0;
    const choiceId = String(e.currentTarget.dataset.choice || '');
    const requestId = 'pg-' + gameModule.activityId + '-' + nodeId + '-' + Date.now();
    let input;
    try {
      input = buildPlayerChoiceInput({ activityId: gameModule.activityId, nodeId, revision: gameModule.revision }, choiceId, requestId);
    } catch (error) {
      cyToast('这个选择暂时不能提交');
      return;
    }
    this.setData({ 'gameModule.write': { status: 'submitting', requestId, message: '正在记录选择…' } });
    if (!this._savePlayerPending(input)) {
      this._failPlayerPendingSave(requestId, false);
      return false;
    }
    gameSessionClient.submitAction('player', input).then((result) => {
      const pending = this._playerPendingWrite;
      const applied = result && result.status === 'success'
        && matchingPlayerTerminalReceipt(result, pending, 'APPLIED');
      const failed = result && result.status === 'business-error'
        && matchingPlayerTerminalReceipt(result, pending, 'FAILED');
      if (applied) {
        this._clearPlayerPending();
        cyToast.success('选择已记录');
        this.setData({ 'gameModule.write': { status: 'confirmed', requestId, message: '选择已记录' } }, () => this._loadPlayerGameModule());
        return;
      }
      if (failed) {
        this._clearPlayerPending();
        this.setData({ 'gameModule.write': { status: 'error', requestId, message: result.message || '选择未被接受' } });
        return;
      }
      this.setData({ 'gameModule.write': {
        status: 'unknown', requestId, message: (result && result.message) || '结果待核对，请勿重复提交', canRetry: true,
      } });
    }).catch(() => {
      this.setData({ 'gameModule.write': { status: 'unknown', requestId, message: '结果待核对，请勿重复提交', canRetry: true } });
    });
  },

  submitPlayerTask(e) {
    const gameModule = this.data.gameModule || {};
    if (!gameModule.enabled || gameModule.write.status === 'submitting' || gameModule.write.status === 'unknown') return;
    if (!(gameModule.availableActions || []).includes('PLAYER_SUBMIT')) return;
    const nodeId = Number(e.currentTarget.dataset.node) || 0;
    const taskCode = String(e.currentTarget.dataset.task || '');
    const node = (gameModule.nodes || []).find((item) => item.nodeId === nodeId);
    if (!node || !node.playerTask || node.playerTask.taskCode !== taskCode
      || (node.submission && node.submission.status !== 'REJECTED')) return;
    const evidence = node.taskEvidence || {};
    if (!evidence.ready || !Array.isArray(evidence.evidenceUrls) || !evidence.evidenceUrls.length) {
      cyToast('请先完成本站任务凭证');
      return;
    }
    const requestId = 'pg-submit-' + gameModule.activityId + '-' + nodeId + '-' + Date.now();
    let input;
    try {
      input = buildPlayerSubmissionInput(
        { activityId: gameModule.activityId, nodeId, revision: gameModule.revision },
        taskCode,
        requestId,
        evidence.evidenceUrls
      );
    } catch (error) {
      cyToast('本站任务暂时不能提交');
      return;
    }
    this.setData({ 'gameModule.write': { status: 'submitting', requestId, message: '正在提交本站任务…' } });
    if (!this._savePlayerPending(input)) {
      this._failPlayerPendingSave(requestId, false);
      return false;
    }
    gameSessionClient.submitAction('player', input).then((result) => {
      const pending = this._playerPendingWrite;
      const applied = result && result.status === 'success'
        && matchingPlayerTerminalReceipt(result, pending, 'APPLIED');
      const failed = result && result.status === 'business-error'
        && matchingPlayerTerminalReceipt(result, pending, 'FAILED');
      if (applied) {
        this._clearPlayerPending();
        this._setPlayerTaskEvidence(nodeId, {
          type: node.playerTask.inputType, ready: false, text: '', evidenceUrls: [], statusText: '',
        });
        const evidenceOnly = node.playerTask.inputType === 'PHOTO'
          && node.playerTask.completionPolicy === 'EVIDENCE_ONLY';
        const submissionId = result.receipt.result && result.receipt.result.submissionId;
        cyToast(evidenceOnly ? '证据已记录' : (submissionId ? ('核验编号 ' + submissionId) : '任务已提交'), { icon: evidenceOnly ? 'none' : 'success' });
        this.setData({ 'gameModule.write': {
          status: 'confirmed', requestId,
          message: evidenceOnly ? '证据已记录' : '任务已记录',
        } }, () => this._loadPlayerGameModule());
        return;
      }
      if (failed) {
        this._clearPlayerPending();
        this.setData({ 'gameModule.write': { status: 'error', requestId, message: result.message || '任务未被接受' } });
        return;
      }
      this.setData({ 'gameModule.write': {
        status: 'unknown', requestId, message: (result && result.message) || '提交结果待核对，请勿重复提交', canRetry: true,
      } });
    }).catch(() => {
      this.setData({ 'gameModule.write': { status: 'unknown', requestId, message: '提交结果待核对，请勿重复提交', canRetry: true } });
    });
  },

  _submitPlayerAssist(input, labels) {
    const gameModule = this.data.gameModule || {};
    const requestId = input.requestId;
    this.setData({ 'gameModule.write': { status: 'submitting', requestId, message: labels.submitting } });
    if (!this._savePlayerPending(input)) {
      this._failPlayerPendingSave(requestId, false);
      return false;
    }
    gameSessionClient.submitAction('player', input).then((result) => {
      const pending = this._playerPendingWrite;
      const applied = result && result.status === 'success'
        && matchingPlayerTerminalReceipt(result, pending, 'APPLIED');
      const failed = result && result.status === 'business-error'
        && matchingPlayerTerminalReceipt(result, pending, 'FAILED');
      if (applied) {
        this._rememberPlayerReveal(result.receipt, pending);
        this._clearPlayerPending();
        cyToast(labels.success);
        this.setData({
          'gameModule.write': { status: 'confirmed', requestId, message: labels.confirmed },
        }, () => this._loadPlayerGameModule());
        return;
      }
      if (failed) {
        this._clearPlayerPending();
        this.setData({
          'gameModule.write': { status: 'error', requestId, message: result.message || labels.rejected },
        });
        return;
      }
      this.setData({ 'gameModule.write': {
        status: 'unknown', requestId,
        canRetry: true,
        message: (result && result.message) || labels.unknown,
      } });
    }).catch(() => {
      this.setData({ 'gameModule.write': { status: 'unknown', requestId, message: labels.unknown, canRetry: true } });
    });
  },

  requestPlayerHint(e) {
    const gameModule = this.data.gameModule || {};
    if (!gameModule.enabled || gameModule.write.status === 'submitting' || gameModule.write.status === 'unknown') return;
    if (!(gameModule.availableActions || []).includes('PLAYER_HINT')) return;
    const nodeId = Number(e.currentTarget && e.currentTarget.dataset.node) || 0;
    const level = Number(e.currentTarget && e.currentTarget.dataset.level);
    const node = (gameModule.nodes || []).find((item) => item.nodeId === nodeId);
    const hint = node && node.hint;
    if (!hint || level !== hint.nextLevel || (level !== 1 && level !== 2) || !hint.nextImpactLabel) return;
    cyModal.show({
      title: '查看第 ' + level + ' 级提示',
      content: hint.nextImpactLabel,
      confirmText: '查看提示',
      cancelText: '继续想想',
      success: (modal) => {
        if (!modal.confirm) return;
        const requestId = 'pg-hint-' + gameModule.activityId + '-' + nodeId + '-' + level + '-' + Date.now();
        let input;
        try {
          input = buildPlayerHintInput(
            { activityId: gameModule.activityId, nodeId, revision: gameModule.revision },
            level,
            requestId
          );
        } catch (error) {
          cyToast('提示状态暂未同步');
          return;
        }
        this._submitPlayerAssist(input, {
          submitting: '正在获取提示…',
          success: '提示已揭示',
          confirmed: '提示已确认揭示',
          rejected: '提示暂时不可用',
          unknown: '提示结果待核对，请勿重复请求',
        });
      },
    });
  },

  requestPlayerReveal(e) {
    const gameModule = this.data.gameModule || {};
    if (!gameModule.enabled || gameModule.write.status === 'submitting' || gameModule.write.status === 'unknown') return;
    if (!(gameModule.availableActions || []).includes('PLAYER_REVEAL')) return;
    const nodeId = Number(e.currentTarget && e.currentTarget.dataset.node) || 0;
    const node = (gameModule.nodes || []).find((item) => item.nodeId === nodeId);
    const hint = node && node.hint;
    if (!hint || hint.revealAvailable !== true || !hint.revealImpactLabel) return;
    cyModal.show({
      title: '揭示答案',
      content: hint.revealImpactLabel,
      confirmText: '查看答案',
      cancelText: '继续想想',
      success: (modal) => {
        if (!modal.confirm) return;
        const requestId = 'pg-reveal-' + gameModule.activityId + '-' + nodeId + '-' + Date.now();
        let input;
        try {
          input = buildPlayerRevealInput(
            { activityId: gameModule.activityId, nodeId, revision: gameModule.revision },
            requestId
          );
        } catch (error) {
          cyToast('答案状态暂未同步');
          return;
        }
        this._submitPlayerAssist(input, {
          submitting: '正在揭示答案…',
          success: '已按兜底完成',
          confirmed: '答案已揭示，并记为兜底完成',
          rejected: '暂时不能揭示答案',
          unknown: '揭示结果待核对，请勿重复请求',
        });
      },
    });
  },

  _setPlayerTaskEvidence(nodeId, evidence) {
    const nodes = ((this.data.gameModule && this.data.gameModule.nodes) || []).map((node) => (
      node && node.nodeId === nodeId ? Object.assign({}, node, { taskEvidence: evidence }) : node
    ));
    this.setData({ 'gameModule.nodes': nodes });
  },

  onPlayerTaskTextInput(e) {
    const nodeId = Number(e.currentTarget && e.currentTarget.dataset.node) || 0;
    const node = ((this.data.gameModule && this.data.gameModule.nodes) || []).find((item) => item.nodeId === nodeId);
    if (!node || !node.playerTask || node.playerTask.inputType !== 'TEXT') return;
    const text = String((e.detail && e.detail.value) || '').slice(0, 300);
    const trimmed = text.trim();
    this._setPlayerTaskEvidence(nodeId, {
      type: 'TEXT',
      ready: !!trimmed,
      text,
      evidenceUrls: trimmed ? ['text:' + encodeURIComponent(trimmed)] : [],
      statusText: trimmed ? '文字凭证已填写' : '',
    });
  },

  scanPlayerTaskEvidence(e) {
    const nodeId = Number(e.currentTarget && e.currentTarget.dataset.node) || 0;
    const node = ((this.data.gameModule && this.data.gameModule.nodes) || []).find((item) => item.nodeId === nodeId);
    if (!node || !node.playerTask || node.playerTask.inputType !== 'SCAN') return;
    wx.scanCode({
      onlyFromCamera: true,
      success: (result) => {
        const value = String((result && result.result) || '').trim().slice(0, 400);
        if (!value) {
          cyToast('没有识别到任务码');
          return;
        }
        this._setPlayerTaskEvidence(nodeId, {
          type: 'SCAN', ready: true, text: '',
          evidenceUrls: ['scan:' + encodeURIComponent(value)],
          statusText: '已识别本站任务码',
        });
      },
      fail: (error) => {
        if (!isScanCancelled(error)) cyToast('未能扫码，请检查相机权限后重试');
      },
    });
  },

  photoPlayerTaskEvidence(e) {
    const nodeId = Number(e.currentTarget && e.currentTarget.dataset.node) || 0;
    const node = ((this.data.gameModule && this.data.gameModule.nodes) || []).find((item) => item.nodeId === nodeId);
    if (!node || !node.playerTask || node.playerTask.inputType !== 'PHOTO') return;
    app.chooseImage((urls) => {
      const evidenceUrls = (Array.isArray(urls) ? urls : [])
        .map((url) => String(url || '').trim())
        .filter((url) => url.toLowerCase().startsWith('https://'))
        .slice(0, 3);
      if (!evidenceUrls.length) return;
      this._setPlayerTaskEvidence(nodeId, {
        type: 'PHOTO', ready: true, text: '', evidenceUrls,
        statusText: '已上传 ' + evidenceUrls.length + ' 张现场照片',
      });
    }, 3);
  },

  reconcilePlayerChoice() {
    const gameModule = this.data.gameModule || {};
    const requestId = gameModule.write && gameModule.write.requestId;
    const pendingWrite = this._playerPendingWrite;
    if (!requestId || gameModule.write.status !== 'unknown') return;
    this.setData({ 'gameModule.write.message': '正在确认操作结果…' });
    gameSessionClient.readReceipt(gameModule.activityId, requestId).then((result) => {
      const applied = result && result.status === 'matched'
        && matchingPlayerTerminalReceipt(result, pendingWrite, 'APPLIED');
      const failed = result && result.status === 'business-error'
        && matchingPlayerTerminalReceipt(result, pendingWrite, 'FAILED');
      if (applied) {
        const merged = mergeConfirmedReceipt(gameModule, result.receipt);
        if (merged !== gameModule) {
          try {
            this._rememberPlayerReveal(result.receipt, pendingWrite);
            this._clearPlayerPending();
            if (result.receipt.action === 'CONFIRM_ROLE') {
              const key = this._roleSeenKey(gameModule.activityId);
              if (key) wx.setStorageSync(key, 1);
            }
          } catch (error) {}
          this.setData({
            gameModule: Object.assign({}, merged, { sheetShow: gameModule.sheetShow, loading: false, error: '' }),
            'roleCard.show': result.receipt.action === 'CONFIRM_ROLE' ? false : this.data.roleCard.show,
          }, () => this._loadPlayerGameModule());
          return;
        }
      }
      if (failed) {
        this._clearPlayerPending();
        this.setData({ 'gameModule.write': {
          status: 'error', requestId: pendingWrite.requestId,
          message: result.message || '原操作未被接受',
        } });
        return;
      }
      const pending = result && result.status === 'pending';
      const restored = !pendingWrite.command;
      this.setData({ 'gameModule.write.message': pending
        ? (restored ? '结果仍在核对；不会自动重发现场内容' : '结果仍在核对，请稍后再试')
        : (restored ? '暂时无法核对；不会自动重发现场内容' : '暂时无法核对，请保留本页稍后重试') });
    }).catch(() => {
      this.setData({ 'gameModule.write.message': pendingWrite && !pendingWrite.command
        ? '暂时无法核对；不会自动重发现场内容'
        : '暂时无法核对，请保留本页稍后重试' });
    });
  },

  retryPlayerUnknownWrite() {
    const gameModule = this.data.gameModule || {};
    const pending = this._playerPendingWrite;
    if (!pending || !pending.command || !gameModule.write || gameModule.write.status !== 'unknown') return false;
    if (!this._savePlayerPending(pending.command, true)) {
      return this._failPlayerPendingSave(pending.requestId, true);
    }
    this.setData({ 'gameModule.write': {
      status: 'submitting', requestId: pending.requestId, message: '正在用原请求号重试…',
    } });
    gameSessionClient.submitAction('player', pending.command).then((result) => {
      const applied = result && result.status === 'success'
        && matchingPlayerTerminalReceipt(result, pending, 'APPLIED');
      const failed = result && result.status === 'business-error'
        && matchingPlayerTerminalReceipt(result, pending, 'FAILED');
      if (applied) {
        this._rememberPlayerReveal(result.receipt, pending);
        this._clearPlayerPending();
        if (pending.action === 'CONFIRM_ROLE') {
          try {
            const key = this._roleSeenKey(gameModule.activityId);
            if (key) wx.setStorageSync(key, 1);
          } catch (error) {}
        }
        cyToast.success('结果已确认');
        this.setData({
          'roleCard.show': pending.action === 'CONFIRM_ROLE' ? false : this.data.roleCard.show,
          'gameModule.write': { status: 'confirmed', requestId: pending.requestId, message: '操作已确认' },
        }, () => this._loadPlayerGameModule());
        return;
      }
      if (failed) {
        this._clearPlayerPending();
        this.setData({ 'gameModule.write': {
          status: 'error', requestId: pending.requestId, message: result.message || '原操作未被接受',
        } });
        return;
      }
      this.setData({ 'gameModule.write': {
        status: 'unknown', requestId: pending.requestId, message: '重试结果仍待核对，请勿另起请求', canRetry: true,
      } });
    }).catch(() => {
      this.setData({ 'gameModule.write': {
        status: 'unknown', requestId: pending.requestId, message: '重试结果仍待核对，请勿另起请求', canRetry: true,
      } });
    });
    return true;
  },

  /** 升级3:同行者榜(GET /api/play/leaderboard,score=完成关数)。入口在通关 sheet。 */
  openBoard() {
    this.setData({ board: { show: true, loading: true, list: [], me: null, error: '' } });
    req('/api/play/leaderboard', 'GET', this._sessionParams()).then((res) => {
      if (res.code == 200 || res.code == '200') {
        const d = res.data || {};
        this.setData({ board: { show: true, loading: false, list: d.list || [], me: d.me || null, error: '' } });
      } else {
        // 失败 ≠ 空:不落 error 的话,WXML 会拿空 list 显示「还没人上榜」——把网络失败说成事实。
        this.setData({ 'board.loading': false, 'board.error': (res && res.msg) || '榜单加载失败' });
      }
    }).catch(() => {
      this.setData({ 'board.loading': false, 'board.error': '网络不太好,榜单没拉到' });
    });
  },
  closeBoard() { this.setData({ 'board.show': false }); },
  /** 底栏左键:城市定向=核销(直接弹大二维码入场码) / 自由探索=切换章节(地点卡层) */
  onLeftAction() {
    if (this.data.mode === 2) return this.openStackOrChapters();
    this.openEntryQr();
  },
  /** 核销入场:动态码收进场景栈(#572 单宿主收口),票面+放大码都在 scene-qr-ticket 组件里 */
  openEntryQr() {
    if (this.data.isPreview || this.data.isMock) return;
    const regId = this.data.regId;
    if (!regId) { this._explainMissingEntryQr(); return; }
    this.openScene('qr-ticket', { registrationId: regId });
  },
  /**
   * 从帖文/俱乐部等入口进来时页面只有 activityId/topicId,没有票夹带的 registrationId,
   * 入场码注定出不来。原来只弹一句「从票夹进入才能出示入场码」就完了 —— 用户被晾在原地,
   * 不知道票夹在哪、怎么去。这里给一条真实出路:直接把他送到票夹(那里才是带 regId 的入口)。
   */
  _explainMissingEntryQr() {
    cyModal.show({
      title: '从票夹进入才能出示入场码',
      content: '入场码要绑定你那张票,所以只有从票夹点进来才带得到。现在去票夹?',
      confirmText: '去票夹',
      cancelText: '先不去',
      success: (r) => { if (r.confirm) wx.reLaunch({ url: '/subpackageMember/signup/index' }); },
    });
  },
  noop() {},
  /* 原型 sheet(inner, closeTo) 的 closeTo:能返回上一层就返回,否则整个收掉
     (脏态确认仍归 requestSceneClose)。漫游页同名同逻辑。 */
  onProtoSheetClose() {
    const cur = this.data.sceneCurrent;
    if (cur && cur.canBack) this.backScene();
    else this.requestSceneClose();
  },
  openBadge3d() {
    const m = this.data.medal || {};
    wx.navigateTo({ url: '/subpackageP3/pages/badge-3d/index?name=' + encodeURIComponent(m.name || '徽章')
      + '&style=' + (m.style || 'glow')
      + (m.img ? '&img=' + encodeURIComponent(m.img) : '') });
  },
  /** 券页显示层:券数据取「被点开的那个节点」(_voucherNode),不锁死 nextNode ——
   *  mode2 点非下一站的带券节点,票面商家名/地址必须是所点那家(review 抓出)。 */
  _syncVoucherView() {
    const node = this._voucherNode || this.data.nextNode || {};
    const reward = this._themeReward || {};
    const c = node.coupon || reward.finishCoupon || null;
    if (!c) return;   // 券页只在有券时打开(openTicket 已挡),不再造「入场」假票面
    const amt = c.amount != null ? String(c.amount).replace(/\.0+$/, '') : '';
    // 「满X可用」门槛已拍板删除展示(2026-09-17):线下到店券平台校验不了金额,只留券名。
    // 有效期展示只到日(全站统一 'YYYY.MM.DD');服务端判定仍用完整时间。
    const endDay = formatDayDots(c.endTime);
    this.setData({
      voucherView: {
        big: amt ? (amt + '元') : '优惠',
        small: c.name || '优惠券',
        expires: endDay ? ('截止日期：' + endDay) : '有效期见券包',
        merchantName: node.name || '合作商家',
        merchantAddress: node.address || '地址待补充',
      },
    });
  },
  /** 章节内容:正文按段拆开,一次只让一段处在「近焦」。
   *  文本来源是当前章节描述 + 已解锁节点的 story,与旅程手记同源,不另编内容。 */
  openChapterFull() {
    const items = [];
    /* 故事变量(契约 §3.1):文本推入前先做 {名字} / {名字|兜底词} 替换。
       值是服务端会话视图下发的 vars map;没值且没兜底时**原样留花括号**(作者看得见),
       不渲染成空串 —— 空串会让漏掉的键永远没人发现。 */
    const vars = this._storyVars || null;
    const push = (t) => { String(t || '').split(/\n+/).forEach((x) => { const v = x.trim(); if (v) items.push({ kind: 'text', text: applyStoryVars(v, vars) }); }); };
    // 真实章节封面是叙事的第一屏，也必须进入 chapterParas，才能和正文共用近焦/渐隐测量。
    if (this.data.chapter && this.data.chapter.cover) {
      items.push({ kind: 'cover', text: '', url: String(this.data.chapter.cover) });
    }
    // 有块流就以块流为准:作者在故事流编辑器里怎么排,这里就怎么铺(文字/图片/音频)。
    //
    // ★ 故事流在【第一个未完成的节点块】处截断 —— 设计文档 §7.1「其后的块:完全不渲染」。
    //   这条不是可选的收敛:节点之后的文字是「走到了才解锁」的剧情,一次铺完就是剧透。
    //   ⚠️ master 上这屏只读 chapter.description,而后端的 description 投影本来就在首个
    //      node 块处停(ChapterFlowCompiler:beforeFirstNode)—— 所以旧代码是安全的,
    //      是「开始消费完整块流」这件事把潜在泄漏变成真泄漏。改块流渲染必须同时补这道闸。
    //   ⚠️ 后端目前仍全量下发 blocks(ApiPlayProgressController 未做 projectPlayerFlow),
    //      所以这只是客户端截断,抓包仍能看到全文。服务端裁剪另开 PR,别把这里当已收口。
    // ⚠️ node 块自身不展开成一段 —— 站点有自己的卡片,再摆一遍会把剧情读成目录;
    //    已完成的节点就地插入它的手记,顺序才跟作者编排的一致。
    // ⚠️ 也不能再叠一次 chapter.description:它就是块流里首个节点之前那些文字块的投影。
    const blocks = (this.data.chapter && this.data.chapter.blocks) || null;
    const nodes = this.data.nodes || [];
    /* 内嵌玩法(契约 §1.5):作者把它配成「长在故事流里」的 kit,铺成一个 kind:'kit' 段。
       ⚠️ 它必须仍是**一个 .chfull__para** —— measureChapter 用 selectAll('.chfull__para')
       按下标对齐 chapterParas,多一个少一个都让整屏焦点错位(见 WXML 的循环注释)。
       位置选在第一个未完成节点处:玩家读到「我当前站在这」,玩法就在这一块里等着。 */
    const inlineKit = this._inlineKit();
    let kitPlaced = false;
    if (blocks && blocks.length) {
      for (let i = 0; i < blocks.length; i += 1) {
        const b = blocks[i];
        if (!b) continue;
        if (b.type === 'node') {
          const n = nodes.find((x) => String(x.nodeId) === String(b.nodeId));
          if (!n || !n.done) {               // 未完成 ⇒ 故事流到此为止
            if (inlineKit) { items.push({ kind: 'kit' }); kitPlaced = true; }
            break;
          }
          if (n.story) push(n.story);        // 已完成 ⇒ 手记就地接上
          continue;
        }
        if (b.type === 'text') push(b.content);
        else if ((b.type === 'image' || b.type === 'audio') && b.url) {
          items.push({ kind: b.type, text: '', url: String(b.url) });
        } else if (b.type === 'dream') {
          /* 梦块(契约 §3.2):一组图 + 每张一句,一张张「穿过去」。
             ⚠️ 整块仍是**一个** .chfull__para —— measureChapter 用 selectAll('.chfull__para')
             按下标对齐 chapterParas,块内多出的元素不进这个选择器,但少一个外层就整屏错位。 */
          const images = (b.images || [])
            .filter((im) => im && im.url)
            .map((im) => ({ url: String(im.url), line: applyStoryVars(im.line || '', vars) }));
          const strip = [];
          while (images.length && strip.length < Math.max(4, images.length)) strip.push({ url: images[strip.length % images.length].url, k: strip.length });
          if (images.length) items.push({ kind: 'dream', title: b.title || '相册', images, strip });
        }
      }
    } else {
      // 无块流的存量章节:沿用旧口径(描述 + 已完成节点的手记),行为逐字不变
      push(this.data.chapter.description);
      nodes.forEach((n) => { if (n.done && n.story) push(n.story); });
    }
    // 没有未完成节点(线性走完 / 没有节点块)时,内嵌玩法接在故事流末尾
    if (inlineKit && !kitPlaced) items.push({ kind: 'kit' });
    if (!items.length) push('这一章还没有写下的内容。');
    this.setData({
      chapterFull: true,
      chapterParas: items.map((item, i) => Object.assign({
        i, text: '', url: '', audioKey: 'ch' + i,
        opacity: i === 0 ? 1 : 0.25, scale: i === 0 ? 1 : 0.86, blur: i === 0 ? 0 : 3,
      }, item)),
    }, () => {
      this.measureChapter();
      this.playChapterAudio();

    });
  },
  openAlbum(e) {
    const para = (this.data.chapterParas || [])[Number(e.currentTarget.dataset.i)];
    if (!para || para.kind !== 'dream' || !para.images.length) return;
    this.setData({ album: { show: true, title: para.title || '相册', images: para.images } });
    this._albumStatusBar(true);
  },
  closeAlbum() {
    if (!this.data.album || !this.data.album.show) return;
    this.setData({ 'album.show': false });
    this._albumStatusBar(false);
  },
  // 相册全屏是白底:状态栏字切黑,收起再切回白(同 #1137)
  _albumStatusBar(light) {
    if (typeof wx.setNavigationBarColor !== 'function') return;
    wx.setNavigationBarColor({ frontColor: light ? '#000000' : '#ffffff', backgroundColor: light ? '#ffffff' : '#000000' });   /* ds-ok 微信 API 只收这两个字面色 */
  },
  closeChapterFull() {
    // 收起就停章节音频:它属于这一屏,留在后台继续念会跟节点语音导览抢同一个播放器。
    // 整章旁白('chapter')和故事流音频块('ch<i>')都属于这一屏,收起时一并停。
    this.closeAlbum();
    const k = String(this.data.audioNodeId || '');
    if (k === 'chapter' || k.indexOf('ch') === 0) this.stopAudio();
    this.setData({ chapterFull: false });
  },

  /** 章节背景旁白。2026-09-04 起音频是章节属性(chapter.audioUrl)、一章一段,
   *  不再是故事流里某个位置上的可点块 —— 打开本章就播,玩家不用点。
   *  与节点语音导览共用同一个 InnerAudioContext —— 两段同时出声是灾难,
   *  共用播放器天然保证「后播的把前面那段顶掉」。
   *  audioNodeId 在这里存字符串 'ch',节点侧存的是数字 nodeId,=== 比较不会撞。 */
  playChapterAudio() {
    const url = this.data.chapter && this.data.chapter.audioUrl;
    if (!url) return;
    // 已经在放这一章的旁白就不要重来 —— 滚动/重测都会再进这里,重播会把它剁成开头一秒。
    if (this.data.audioNodeId === 'chapter' && this.data.audioPlaying) return;
    this.initAudio();
    const audio = this._audio;
    audio.stop();
    audio.src = String(url);
    audio.play();
    this.setData({ audioNodeId: 'chapter' });
  },

  /** 故事流里带位置的音频块(2026-09-06 恢复,与上面的整章旁白并存)。
   *  三者共用同一个 InnerAudioContext —— 章节旁白 / 音频块 / 节点语音导览同时出声是灾难,
   *  共用播放器天然保证「后播的把前面那段顶掉」。
   *  key 分三套且互不相等:整章旁白 = 'chapter',块 = 'ch<i>',节点侧 = 数字 nodeId。 */
  toggleChapterAudio(e) {
    const i = Number(e.currentTarget.dataset.i);
    const item = (this.data.chapterParas || [])[i];
    if (!item || item.kind !== 'audio' || !item.url) return;
    this.initAudio();
    const audio = this._audio;
    const key = 'ch' + i;
    const same = this.data.audioNodeId === key;
    if (same && this.data.audioPlaying) { audio.pause(); return; }
    if (same && !this.data.audioError) { audio.play(); return; }
    audio.stop();
    audio.src = item.url;
    audio.play();
    this.setData({ audioNodeId: key });
  },
  /** 滚动衰减 —— 与旅程手记(Tesseract)同一套机制,三条都照抄它的教训:
   *  ① 先测真实几何(boundingClientRect + scrollOffset 快照),不做「每段固定高」的假设;
   *  ② d = 段中心到「稿上那块 473pt 框中心」的距离,按距离算 scale/opacity/blur,帧间无状态;
   *  ③ _chbusy 节流,防 bindscroll 洪峰把 setData 排队打爆。 */
  measureChapter() {
    const that = this;
    setTimeout(() => {
      const q = wx.createSelectorQuery();
      q.selectAll('.chfull__para').boundingClientRect();
      q.select('.chfull__stage').boundingClientRect();
      q.select('.chfull__stage').scrollOffset();
      q.exec((res) => {
        that._chGeom = res[0] || null;
        that._chStage = res[1] || null;
        that._chScroll0 = (res[2] && res[2].scrollTop) || 0;
      });
    }, 120);
  },
  onChapterScroll(e) {
    if (this._chbusy || !this._chGeom || !this._chStage) return;
    this._chbusy = true;
    const top = e.detail.scrollTop;
    const center = this._chStage.top + this._chStage.height / 2;
    const half = this._chStage.height / 2;
    const next = this.data.chapterParas.map((p, i) => {
      const g = this._chGeom[i]; if (!g) return p;
      const liveTop = g.top + this._chScroll0 - top;
      const d = Math.abs(liveTop + g.height / 2 - center) / half;   // 0=框正中 1=框边缘
      const k = Math.max(0, 1 - d);
      return { ...p, opacity: +(0.15 + k * 0.85).toFixed(2), scale: +(0.82 + k * 0.18).toFixed(3), blur: +((1 - k) * 4).toFixed(1) };
    });
    this.setData({ chapterParas: next }, () => { this._chbusy = false; });
  },
  /** 滑动核销确认:真正的核销是商家扫玩家的码,这里只是玩家侧把码亮出来并标记本次已出示。
   *  ⚠️ 不在客户端写「已核销」到后端 —— 那是商家侧的动作,客户端说了不算。 */
  confirmRedeem() {
    cyToast('请让商家扫这个码');
  },
  /** 顶部条第二行:直线距离 + 按步行 5km/h 的预计用时与到达时刻。
   *  这三个都是估算,文案里已经写了「预计」;真逐向导航要接 SDK,不在这一版。 */
  _syncNavMeta() {
    const m = Number(this.data.nav.remainM) || 0;
    if (!this.data.nav.active) return;
    const minutes = Math.max(1, Math.round(m / (5000 / 60)));
    const eta = new Date(Date.now() + minutes * 60000);
    const pad = (v) => String(v).padStart(2, '0');
    this.setData({
      navMeta: {
        km: (m / 1000).toFixed(1),
        dur: minutes >= 60 ? Math.floor(minutes / 60) + '小时' + (minutes % 60) + '分' : minutes + '分钟',
        eta: pad(eta.getHours()) + ':' + pad(eta.getMinutes()),
      },
    });
  },

  // 空态动作
  goSignup() { this.goBackDetail(); },                                           // 回场次详情去报名
  // C-26:自玩没有(或过期)通行证 → 出路是去主题详情获取通行证(自玩没有「报名」这个动作)。
  // 之前这里会落到 signup 空态文案「你还没有报名这个场次」+「去报名」,把用户指向票务报名。
  goGetPass() {
    const topicId = this.data.topicId;
    if (topicId) { wx.navigateTo({ url: '/pages/topic/index/index?id=' + topicId }); return; }
    this.goBackDetail();
  },
  doRelogin() {
    var that = this;
    app.reLogin(function (ok) {
      if (ok) { that.reloadPlay(); }
      else { cyToast('登录失败，请重新进入'); }
    });
  },
  reloadPlay() { this.setData({ loading: true, emptyTip: '', emptyKind: '' }, () => this.loadData(true)); },

  // 错误态次级退出路径(DS Error §):返回活动详情。play 由详情/票夹压入,优先 navigateBack;无栈则回票夹。
  goBackDetail() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/subpackageMember/signup/index' });
  },

  // ---------- 数据 ----------
  loadData(first) {
    const that = this;
    if (this.data.isPreview || this.data.isMock) { this.setData({ loading: false }); return; }
    this._loadCommitted = false;   // 每轮加载重新武装:上一轮的成功不能替这一轮的失败背书
    // 缺场次参数 ≠ 加载失败:reloadPlay 会再次命中这一行 return,给「重新加载」等于给一个
    // 物理上永远回到同一状态的假按钮。单独落 missing,只留真的走得通的出口(回活动详情)。
    if (!this.data.activityId && !this.data.topicId) { this.setData({ loading: false, emptyTip: '场次信息缺失，请从票夹或路线详情进入', emptyKind: 'missing' }); return; }
    req('/api/play/nodes', 'GET', this._sessionParams()).then((res) => {
      if (res.code == 402 || res.code == '402') {
        // C-26:未购/过期自玩通行证 → needPass 空态 + 「获取通行证」按钮(goGetPass 跳主题详情)。
        // 不再落 registered=false 的「你还没有报名这个场次」——自玩没有报名这个动作,那句指引是错的。
        that.setData({ loading: false, emptyTip: app.getRequestErrorMessage(res, '请先购买自玩通行证后再开始'), emptyKind: 'needPass' });
        return;
      }
      if (res.code != 200 && res.code != '200') {
        var isAuth = (res.msg && (res.msg.indexOf('登录') >= 0 || res.msg.indexOf('认证') >= 0));
        that.setData({ loading: false, emptyTip: isAuth ? '登录已过期，请重新登录' : (res.msg || '加载失败，请稍后重试'), emptyKind: isAuth ? 'auth' : 'error' });
        return;
      }
      const d = res.data;
      if (!isRecord(d) || !isRecordList(d.nodes)) {
        that.setData({ loading: false, emptyTip: '路线没加载出来，请稍后重试', emptyKind: 'error' });
        return;
      }
      // 领队(leadSpectator)是运营身份,本来就不报名本场,不该被未报名空态挡住;
      // 它只解锁渲染,玩家权益仍由 registered 管。判据见 play-lead-spectator-gate.test.js。
      if (d.registered === false && !d.leadSpectator) {
        that.setData({ loading: false, emptyTip: '你还没有报名这个场次', emptyKind: 'signup' });
        return;
      }
      const raw = d.nodes;
      if (!raw.length) {
        that.setData({ loading: false, emptyTip: '本场路线节点还在配置中，请稍后查看', emptyKind: 'empty' });
        return;
      }
      const mode = Number(d.mode) || that.data.mode || 1;
      /* 故事变量的两个来源之一(另一个是 advanced 会话视图):/api/play/nodes 回包 data.vars。
         章节文本与节点 story 大多数时候在这个点的会话之前就被读到 —— 只从会话视图取的话
         {name} 会一直原样留着,所以这条必须在首屏成功分支里落。 */
      that._applyStoryVars(d);
      that._puzzlePersonalBest = Number(d.puzzlePersonalBest) || 0;
      // 规则16 历史履约:已普通下架的本人已完成站只作只读回看,不并入 nodes/total/完成率/解锁/推荐/地图。
      const historyNodes = Array.isArray(d.historyNodes)
        ? d.historyNodes.map((h) => Object.assign({}, h, { history: true, done: true }))
        : [];
      // 只喂 buildJournal / _historyNodeById 的内部状态,不渲染、不进 setData(UI-GATE-0 死数据字段口径)。
      that._historyNodes = historyNodes;
      const catalog = raw.map((n, i) => that.normNode(n, i, mode));
      const routeState = normalizeRouteState(d.routeState || { routeMode: d.routeMode });
      const nodes = applyRouteStateToNodes(catalog, routeState);
      that._routeState = routeState;
      that._routeNodeCatalog = catalog;
      if (that._routeActions) that._routeActions.clear();
      const chapter = that.buildChapter(d, nodes);
      // 成功已落地:此后回调里的后处理(rebuild / 会话时钟 / 角色卡)再抛错,不该冒充「加载失败」
      // 把已经渲染出来的首屏盖成错误页 —— 重试只会重跑同一段计算,用户永远出不去。异常仍打 console。
      that._loadCommitted = true;
      // 通关奖励摘要:唯一渲染点(剧本 tab 的奖励卡)随起始页删除,这里只留 js 侧消费
      // (完成页判「有没有券」与奖励文案),所以退回实例字段,不再占一个没人渲染的 data 位。
      that._themeReward = d.reward || null;
      const topicName = d.topicName || that._entryTopicName || '';
      const usePrefabLife = isPrefabLife({
        topicId: d.topicId || that.data.topicId,
        engineKey: d.engineKey || d.experienceType,
      });
      // 《预制人生》有自己的故事引擎。任何旧入口落到通用 play 页时都立即换轨，
      // 避免同一主题同时维护两套 UI，也绝不短暂露出漫游/通用城市定向首屏。
      if (first && usePrefabLife) {
        const key = that.data.activityId ? ('activityId=' + that.data.activityId) : ('topicId=' + that.data.topicId);
        wx.redirectTo({ url: '/subpackagePrefab/index?' + key });
        return;
      }
      that.setData({
        loading: false, emptyTip: '', emptyKind: '', topicId: d.topicId || '', topicName, topicDesc: d.topicDesc || '', topicCover: d.topicCover || '',
        mode, serverMode: mode,
        modeLabel: mode == 2 ? '自由探索' : '城市定向',
        routeNotice: that._routeNoticeForState(routeState),
        timeBanner: d.playable === false ? (d.timeNote || '') : '',
        // M2 自玩态:顶部状态条"自由探索中 · 有效期至 M/D"
        selfPlay: !!d.selfPlay,
        selfPlayBanner: d.selfPlay ? ('自由探索中 · 有效期至 ' + that._fmtMD(d.expiresAt)) : '',
        chapter, nodes, total: nodes.length,
        chapterCards: that.buildChapterCards(d, chapter).map((c) => ({
          ...c,
          nodeCount: c.id != null ? nodes.filter((n) => String(n.chapterId) === String(c.id)).length || nodes.length : nodes.length,
        })),
        doneCount: nodes.filter((n) => n.done).length,
        myRole: d.myRole || null,
        // 首屏成功态与数据同一次 setData 落地:原来放在 setData 回调里,回调里任一处理抛错
        // (rebuild / 会话时钟 / 角色卡)都会把页面永久留在 screen='' 且无提示的地图态 —— 
        // 2026-09-16 截图冒烟拍到的「整屏纯黑、无任何内容与提示」就是这一类无出口态。
        // 2026-09-22 删起始页后首屏直接落卡包,first 不再切屏,保持当前 screen。
        screen: that.data.screen
      }, () => {
        that.rebuild();
        that._ensureSessionClock();
        that._syncIdleStats(d.chapters, nodes);
        that._syncRunState();
        // R9-21:服务端态允许继续时,把上次暂停的会话恢复成 paused(不重开、不丢用时)
        that._restoreRunSession(d, routeState, nodes);
        that.loadTeamProgress();   // P1 带领场探测(club 场次才 exists,内部自管轮询)
        that._maybeShowRoleCard(d.myRole);   // 升级2:俱乐部局角色卡(首入本场弹一次)
        that._loadPlayerGameModule();
      });
    }).catch(() => {
      // 网络层 reject(超时/断网/req 抛错):落加载失败态,复用「重新加载」(reloadPlay),避免 loading 死转。
      // 已经落地的成功首屏不在这里被覆盖(见上面的 _loadCommitted)。
      if (that._loadCommitted) {
        // 只打固定标签:生产 console 门禁禁止把异常/响应/身份动态值写进开发者日志。
        console.error('[play] 首屏数据已落地,后处理异常');
        return;
      }
      that.setData({ loading: false, emptyTip: '加载失败，请稍后重试', emptyKind: 'error' });
    });
  },

  // 预览态:把 fabu 产出的 previewData 经现有渲染链归一并落到 data(契约字段已对齐 normNode)
  applyPreviewData(data) {
    const that = this;
    const d = data || {};
    const raw = d.nodes || [];
    const mode = Number(d.mode) || 1;
    const catalog = raw.map((n, i) => that.normNode(n, i, mode));
    const routeState = normalizeRouteState(d.routeState || { routeMode: d.routeMode });
    const nodes = applyRouteStateToNodes(catalog, routeState);
    that._routeState = routeState;
    that._routeNodeCatalog = catalog;
    const chapter = that.buildChapter(d, nodes);
    this._historyNodes = [];
    this.setData({
      loading: false, topicId: d.topicId || '', topicName: d.topicName || '', topicDesc: d.topicDesc || '', topicCover: d.topicCover || '', mode, serverMode: mode,
      modeLabel: mode == 2 ? '自由探索' : '城市定向',
      routeNotice: that._routeNoticeForState(routeState),
      screen: '',
      selfPlay: !!d.selfPlay,
      selfPlayBanner: d.selfPlay ? ('自由探索中 · 有效期至 ' + that._fmtMD(d.expiresAt)) : '',
      chapter, nodes, total: nodes.length,
      chapterCards: that.buildChapterCards(d, chapter),
      doneCount: nodes.filter((n) => n.done).length
    }, () => {
      that.rebuild();
      that._ensureSessionClock();
      that._syncIdleStats(d.chapters, nodes);
      that._syncRunState();
    });
  },

  normNode(n, i, mode) {
    // 后端 validationMethod:0/null 到点即完成 · 1 文字 · 2 拍照 · 3 选项 · 4 扫码 · 5 GPS到达 · 6偏好题组
    const vm = Number(n.validationMethod) || 0;
    let advancedConfig = null;
    try { advancedConfig = n.advancedConfigJson ? JSON.parse(n.advancedConfigJson) : null; } catch (e) { advancedConfig = null; }
    const hasAdvanced = !!(advancedConfig && Object.keys(advancedConfig).some(function (key) {
      if (key === 'schemaVersion') return false;
      const seg = advancedConfig[key];
      return seg && typeof seg === 'object' && seg.enabled;
    }));
    const isGame = hasAdvanced || (vm === 1 || vm === 2 || vm === 3 || vm === 4 || vm === 6), shopDay = Number(mode || this.data.mode) === 2; // 5/0 走到达,不开节点任务
    return {
      nodeId: n.nodeId != null ? n.nodeId : i,
      num: n.sortId != null ? n.sortId : (i + 1),
      sortId: n.sortId != null ? n.sortId : (i + 1),
      name: n.name || ('第 ' + (i + 1) + ' 站'),
      address: n.address || '',
      description: n.description || n.question || '走到这里,留意四周——故事就藏在细节里。',
      imgUrl: n.imgUrl || '',
      businessTime: n.businessTime || '',
      openStatus: n.openStatus || '',                       // S4 服务端营业态三态(营业中/即将打烊/已打烊);空则大卡回退客户端 inBizWindow
      lng: Number(n.longitude) || 0, lat: Number(n.latitude) || 0,
      done: !!n.done,
      doneAt: Number(n.doneAt) || 0,   // P0 剧情成书:完成时间(手记按"我的完成顺序"排)
      picUrl: n.picUrl || '',          // 当前玩家本人上传的完赛照片；节点封面仍只走 imgUrl
      arrived: !!n.arrived,
      arrivedAt: n.arrivedAt || null,
      gameDone: !!n.gameDone,   // 到店三步第二步:凭证已记录(后端只在 mode=2 下发)
      selfReported: !!n.selfReported,
      hasGame: !!n.hasGame,   // B5 收窄:该店配了答题模板(题面按进店态另行下发)
      crowded: n.crowded === true ? true : (n.crowded === false ? false : null),
      inStoreLoad: n.inStoreLoad,
      serviceCapacity: n.serviceCapacity || null,
      expectedWaitMinutes: n.expectedWaitMinutes,
      quantityUnavailable: !!n.quantityUnavailable,
      chapterId: n.chapterId != null ? n.chapterId : null,   // S1 卡堆行章节色条
      hookText: n.hookText || '',                            // S1 卡堆行钩子一句(空则行内回退 description)
      merchantId: n.merchantId || 0,                         // S1 卡堆行「合作商户」标注(后端未下发时恒为0,标注不显示)
      // 节点级前置解锁(服务端 /nodes 下发;硬闸在服务端,这里只做置灰与提示)
      locked: !!n.locked,
      paused: String(n.runtimeStatus || n.stationStatus || '').toUpperCase() === 'PAUSED',
      runtimeStatus: String(n.runtimeStatus || '').toUpperCase(),
      unlockAfterNodeId: n.unlockAfterNodeId != null ? Number(n.unlockAfterNodeId) : 0,
      hasTemplate: isGame,
      hasAdvanced, advancedConfig,
      vm,
      question: n.question || '', options: n.options || null,
      // 题面媒体(看图答题 / 听音答题)。与 audio(整节点语音导览)不是一回事:
      // 那是到达就能听的导览,这是这道题的题面,只在答题卡里出现。
      questionImg: n.questionImg || '', questionAudio: n.questionAudio || '',
      optionMedia: n.optionMedia || null,
      points: n.xp || 12,
      // 模板呈现字段(/api/play/nodes 已下发)
      gameTitle: n.gameTitle || (vm === 6 ? '生活偏好校准' : (vm === 4 ? '现场打卡' : (vm === 2 ? '拍照任务' : (vm ? '点位任务' : '')))),
      duration: n.duration ? (n.duration + ' 分钟') : '', difficulty: n.difficulty || '', players: n.players || '',
      materials: n.requiredMaterials || '', rule: n.ruleInstructions || '',
      story: n.storyText || '', cover: n.storyImg || n.imgUrl || '',
      cardHook: n.cardHookLong || '',
      fragmentText: n.fragmentText || '',
      hint1: n.hint1 || '', hint2: n.hint2 || '', reveal: n.answerReveal || '',
      hintLocked: !!n.hintLocked, hintCost: n.hintCost || 0, hintCount: n.hintCount || 0,
      puzzleScoring: !!n.puzzleScoring,
      puzzleHintLevel: Number(n.puzzleHintLevel) || 0,
      puzzleScoreCap: n.puzzleScoreCap == null ? 100 : Number(n.puzzleScoreCap),
      usedHints: Array.isArray(n.usedHints) ? n.usedHints.filter(Boolean) : [],
      puzzleScore: n.puzzleScore == null ? null : Number(n.puzzleScore),
      completionMode: n.completionMode || '',
      feedback: n.feedbackText || '答案还没咬合,再看看四周……',
      photoDesc: n.photoRequireDesc || '', audio: n.audioUrl || '', audioDur: (n.audioDuration ? n.audioDuration + '″' : ''),
      medalName: shopDay ? '' : (n.medalName || ''), medalImg: shopDay ? '' : (n.medalImg || ''), medalStyle: shopDay ? '' : (n.medalStyle || 'glow'), couponId: shopDay ? 0 : (n.couponId || 0),
      // 后端 /nodes 新下发的券公开投影(name/amount/endTime;无 code):券页据此显示真面额
      coupon: shopDay ? null : (n.coupon || null),
      // 探店日卡片详情三段各自的料:章节钩子 / 店铺分身 / 本店权益。
      // 三个都只在 mode=2 下发,经典定向恒空 —— 那边的详情页不长这样。
      hookText: n.hookText || '',
      npc: n.npc || null,
      perk: n.perk || null
    };
  },

  /** 起始页(Figma 3956:12602)章节横滑卡。
   *  后端 chapters 是数组,本页此前只取 [0](见 buildChapter)——卡片行要把多章都摆出来。
   *  拿不到数组就回落到归一后的那一章,不凭空造第二张卡。 */
  buildChapterCards(d, chapter) {
    const list = (d && Array.isArray(d.chapters) && d.chapters.length) ? d.chapters : null;
    if (!list) {
      return [{ key: 'c0', meta: chapter.idxLabel, title: chapter.name, sub: chapter.description,
        cover: chapter.cover, mileage: chapter.mileage, timeText: chapter.timeText,
        description: chapter.description, blocks: chapter.blocks,
        atmospherePreset: chapter.atmospherePreset, atmosphereClass: chapter.atmosphereClass }];
    }
    return list.map((c, i) => ({
      key: 'c' + i,
      id: c.chapterId != null ? c.chapterId : (c.id != null ? c.id : null),   // 后端键=chapterId(id 是我一开始猜错的)
      category: c.category || '',
      // 占位/空名时标题本身就是「第 N 章」,上面再挂一个同样的序数标签是同一件事说两遍。
      meta: (isChapterPlaceholderName(c.name) || !String(c.name || '').trim())
        ? '' : (c.idxLabel || ('第 ' + (i + 1) + ' 章')),
      title: displayChapterName(c.name, i, '第 ' + (i + 1) + ' 章'),
      sub: c.description || '',
      cover: c.imgArr ? String(c.imgArr).split(',')[0] : (c.cover || ''),
      mileage: c.totalMileage ? (c.totalMileage + 'km') : '',
      timeText: c.totalTime ? Math.round(c.totalTime / 60) + ' 分钟' : '',
      description: c.description || '',
      blocks: Array.isArray(c.blocks) ? c.blocks : null,
      atmospherePreset: normalizeAtmosphere(c.atmospherePreset),
      atmosphereClass: atmosphereClass(c.atmospherePreset),
      nodeCount: 0,   // 回填于 loadData:按 chapterId 数节点
    }));
  },

  /** 背景封面:章节图优先,没有就退到第一个有图的商家。
   *  没有兜底时整屏是纯黑 —— 「主题封面 + 玻璃蒙版」这层就静默不存在了。 */
  _coverOf(chapterCover, nodes) {
    if (chapterCover) return chapterCover;
    const withImg = (nodes || []).find((n) => n && n.imgUrl);
    return withImg ? String(withImg.imgUrl).split(',')[0] : '';
  },

  buildChapter(d, nodes) {
    const c = (d.chapters && d.chapters[0]) || {};
    const placeholderName = isChapterPlaceholderName(c.name);
    return {
      // 标题已经是「第 N 章」时,眉标不再重复同一个序数。
      idxLabel: placeholderName ? '' : (c.idxLabel || '第一章'),
      // 2026-09-18 UI-20 返修:publish/simple、fabu 建主题时给章节写的默认名是英文占位「Chapter 1」,
      // 不再原样上屏(也不落回主题名把章节标题变成主题名),统一显示「第 N 章」。
      name: displayChapterName(c.name, 0, d.topicName || '城市探索'),
      description: c.description || '跟着脚步走完这几处坐标,把散落的线索串成一段属于你的城市故事。',
      cover: this._coverOf(c.imgArr ? String(c.imgArr).split(',')[0] : (c.cover || ''), nodes),
      mileage: c.totalMileage ? (c.totalMileage + 'km') : '',
      timeText: c.totalTime ? Math.round(c.totalTime / 60) + ' 分钟' : '',
      atmospherePreset: normalizeAtmosphere(c.atmospherePreset),
      atmosphereClass: atmosphereClass(c.atmospherePreset),
      routeGeometry: c.routeGeometry || null,
      // 章节背景旁白:进本章自动播放(2026-09-04 拍板)。
      // ⚠️ buildChapter 是**白名单**映射 —— 后端下发了、这里不列,页面就永远读不到。
      //    E1 第一版就漏在这:playChapterAudio 读 this.data.chapter.audioUrl 恒为 undefined,
      //    整条自动播放是死链,而契约测试直接给 page.data.chapter 赋值、绕过了本函数,所以是假绿。
      audioUrl: c.audioUrl || '',
      // /api/play/nodes 一直在下发章节 blocks(文字/节点/图片/音频),此前本页没人读它。
      // 章节剧情屏要按作者编排的顺序铺开,所以块流必须带到这一层。
      blocks: Array.isArray(c.blocks) ? c.blocks : null
    };
  },

  rebuild() {
    const mode = this.data.mode;
    const nodes = this.data.nodes;
    const rawNextNode = this.computeNext(nodes, null); // 推荐算法不变(内部 pts 仅 mode1 用 sortId,mode2 用 GPS/doneAt,可传 null)
    const visibleNodes = nodes;
    // 陪伴态的目标就是 nav.targetNodeId(原来另存一份 fmTarget 专喂地图箭头,地图删了就没有第二份真值了)
    const activeTargetId = this.data.nav.active && this.data.nav.targetNodeId != null
      ? this.data.nav.targetNodeId
      : (rawNextNode && rawNextNode.nodeId);
    const pinState = (x) => {
      if (this._routeState.routeMode !== 'BRANCH_GRAPH') return getPlayRouteNodeState(x, mode, activeTargetId);
      if (x.done || x.routeNodeState === 'COMPLETED') return 'completed';
      if (activeTargetId != null && String(x.nodeId) === String(activeTargetId)) return 'target';
      return x.routeNodeState === 'PLAYABLE' ? 'actionable' : 'restricted';
    };
    // 自由探索不编号:没有解锁顺序,「第 3 站」这个数字读不出任何含义(2026-09-09 裁决)。
    // num 给空串,free-map 那边就不挂序号胶囊了。
    const fmNodes = visibleNodes.map((x) => ({
      nodeId: x.nodeId, num: mode === 2 ? '' : x.num, state: pinState(x), lat: x.lat, lng: x.lng,
      imgUrl: String(x.imgUrl || '').split(',')[0],
    }));
    const routePathNodes = this._routeState.routeMode === 'BRANCH_GRAPH'
      ? buildVisibleRoutePath(visibleNodes, this._routeState)
      : nodes;
    const fmPolyline = buildPlayRoute(routePathNodes, mode === 2 ? 'free' : 'classic');
    const fmPlayer = this._loc ? { lat: this._loc.latitude, lng: this._loc.longitude } : null;
    const first = visibleNodes.find((n) => n.lat && n.lng) || nodes.find((n) => n.lat && n.lng) || {};
    const target = activeTargetId != null && this._nodeById(activeTargetId);
    const targetState = getPlayMapState(activeTargetId != null ? 'target' : 'candidate');
    const nextNode = rawNextNode && Object.assign({}, rawNextNode, {
      mapStateLabel: targetState.cardLabel,
      mapA11yLabel: targetState.readerLabel,
    });
    let activeChapter = this.data.chapter;
    if (mode === 1 && rawNextNode) {
      const activeNode = this._nodeById(rawNextNode.nodeId);
      const card = (this.data.chapterCards || []).find((item) => activeNode && item.id != null
        && String(item.id) === String(activeNode.chapterId));
      if (card) {
        activeChapter = {
          idxLabel: card.meta,
          name: card.title,
          description: card.description || card.sub || '',
          cover: card.cover || '',
          mileage: card.mileage || '',
          timeText: card.timeText || '',
          blocks: card.blocks || null,
          atmospherePreset: normalizeAtmosphere(card.atmospherePreset),
          atmosphereClass: atmosphereClass(card.atmospherePreset),
        };
      }
    }
    const fmCenter = (target && target.lat) ? { lat: target.lat, lng: target.lng }
      : (fmPlayer || { lat: first.lat || 31.2304, lng: first.lng || 121.4737 });
    const branchFinished = ['COMPLETED', 'FINISHED'].includes(this._routeState.status);
    const allDone = this._routeState.routeMode === 'BRANCH_GRAPH'
      ? branchFinished
      : nodes.length > 0 && nodes.every((x) => x.done);
    const doneCount = nodes.filter((x) => x.done).length;
    // 凭证三态文案的唯一实现:剧本 tab 方卡与 mode2 六宫格共用 —— 别各写一份,会漂移。
    // 现场状态未知(crowded=null)给空串:WXML 里角标按「有内容才出」渲染。原来的「现场状态待同步」
    // 是占位不是信息,2026-09-05 用户拍板删掉。
    // 已核销**不挂标签**:卡片整张阴掉(.fx-tile.is-done 的 grayscale)已经说清楚了,
    // 再贴一枚「已核销」是同一件事说两遍(用户 2026-09-05 当面定)。
    const proofStatus = (x) => x.done ? '' : (x.crowded === null ? ''
      : (x.selfReported ? '照片已记录' : (x.arrived ? '已到店' : '未到店')));
    // mode2 六宫格瓦片:字段一律取后端有什么显示什么,拿不到就不显示、不编(与商家页 buildPlay 同口径)。
    // ★ 严格保持 nodes 原序 —— 展示顺序由后端决定(商家曝光轮转),前端不许自己 shuffle,
    //   否则商家看板的「谁排第一」对不上账。发牌动画只是把这个已定的顺序演出来。
    // 已核销环改成了等分间断条(见 _ringSegs / index.wxss),
    // 原来那圈点阵的 ringX/ringY 和它们用的 segStep 随之作废,已删。
    const chapById = {};
    (this.data.chapterCards || []).forEach((c) => { if (c.id != null) chapById[String(c.id)] = c; });
    // ⚠️ rebuild() 在发牌那 2.5s 内是可达的(定位成功回调 / 前往 / 结束前往 / 完成任务
    //    四条路径都会调),整表重建会把 fly/land 抹回 false ⇒ 正在飞的卡瞬间消失。
    //    按 nodeId 继承上一轮的动画态和已量好的几何,重建就不再打断动画。
    const prevTile = {};
    (this.data.seatTiles || []).forEach((t) => { prevTile[String(t.nodeId)] = t; });
    // 卡片排布:恒定两列、**卡片尺寸恒定**,张数多了往下滚。
    //   3 章 = 和 4 章一样的排法,右下角空一格;5/6 章卡片一样大,第三行滚下去看。
    // 不按剩余屏高等分:那样 6 章会把卡压扁、3 章又撑得过高,同一个主题换个章数就换一套观感。
    const seatTiles = mode !== 2 ? [] : nodes.map((x, i) => ({
      nodeId: x.nodeId,
      name: x.name || '未命名商家',
      chapterLabel: (() => {
        const c = chapById[String(x.chapterId)];
        return c ? [c.meta, c.title].filter(Boolean).join(' · ') : '';
      })(),
      imgUrl: String(x.imgUrl || '').split(',')[0],
      playName: x.gameTitle || '',
      locked: !!x.locked,
      // ⚠️ normNode() 产的是 businessTime/openStatus,**从来不产 openText** ——
      //    这里原来写 x.openText || '' 导致瓦片营业态永久不显示(2026-08-14 自审发现)。
      openText: resolveOpenState(x).openText,
      openDot: resolveOpenState(x).openDot,
      done: !!x.done,
      // ⚠️ 三态/拥挤字段必须在 seatTiles 上 —— fx-tile__st(index.wxml)读的是这里,
      //    d798cac9c 曾只加进剧本 tab 的那份副本,导致主屏三态与「排队中」提示恒空白。
      crowded: x.crowded,
      statusText: proofStatus(x),
      waitText: (x.crowded && Number(x.expectedWaitMinutes) > 0)
        ? ('排队约 ' + x.expectedWaitMinutes + ' 分钟，建议先去别家') : '',
      // 发牌节奏由 _dealTiles() 的定时器给(每张两段,一条 transition 画不出弧),
      // 不再走 transition-delay ⇒ 原来的 dealDelay 字段已无消费方,删掉。
      // 飞行几何(从卡包正中弹出 → 扇形弧顶 → 落格),由 _measureDeal() 量完回填。
      // 量不到时留空:WXSS 的 var() 兜底 0px 让卡片原地淡入(高度另有 268rpx 兜底)。
      ...(({ fly = false, land = false, tx0 = '', ty0 = '', tx1 = '', ty1 = '', rot = '' }) =>
        ({ fly, land, tx0, ty0, tx1, ty1, rot }))(prevTile[String(x.nodeId)] || {}),
    }));
    const ringSegs = this._ringSegs(doneCount, nodes.length);
    // 顶部输入地址只搜这一局里的地点(§6.1「只显示这一个主题里的地点」);
    // 针的颜色按玩法给 —— 城市定向绿 / 自由探索蓝。
    const searchPlaces = visibleNodes.filter((x) => x.lat && x.lng).map((x) => ({
      id: String(x.nodeId), name: x.name || '未命名地点', address: x.address || '',
      kind: mode === 2 ? 'free' : 'city', lat: x.lat, lng: x.lng, nodeId: x.nodeId,
    }));
    this.setData({ fmNodes, fmPolyline, fmPlayer, fmCenter, nextNode, chapter: activeChapter, allDone, doneCount, total: visibleNodes.length, seatTiles, ringSegs, searchPlaces }, () => {
      wx.nextTick(() => this._measureDeal());   // 布局落定后才量得到瓦片/卡包的真实矩形
      // 探店日:核销完最后一家回到本页(onShow 重拉)时自动弹结算 —— 只认 allDone 上升沿,
      // 重进一个早已完成的主题不重放仪式。经典定向有自己的 completed→openFinish 链,不走这里。
      if (mode === 2) {
        if (!allDone) { this._sawIncomplete = true; }
        else if (this._sawIncomplete && !this._finCelebrated) {
          this._finCelebrated = true;
          setTimeout(() => this.openFinish(), 400);
        }
      }
    });
    this.buildJournal();
  },

  _nodeById(id) { return this.data.nodes.find((n) => n.nodeId === id); },
  // 历史回看专用查找:只在手记/剧情全文里用,不并入可玩 nodes(不给任何操作入口)。
  _historyNodeById(id) {
    return (this._historyNodes || []).find((n) => String(n.nodeId) === String(id));
  },
  computeNext(nodes, pts) {
    pts = pts || [];
    const mode = this.data.mode;
    const undone = nodes.map((x, i) => ({ x, i })).filter((o) => !o.x.done && !o.x.paused);
    if (!undone.length) return null;
    let pick = undone[0], reason = '';
    if (mode === 1) {
      const next = resolveNextRouteNode(nodes, this._routeState);
      if (!next) return null;
      pick = { x: next, i: nodes.findIndex((node) => node && String(node.nodeId) === String(next.nodeId)) };
    } else {
      // P0 推荐条(纯前端加权):距离 × 营业时间窗 × 顺路;正常行走态始终只给第一推荐。
      const scored = this.scoreCandidates(nodes, pts, undone);
      pick = scored[0]; reason = pick.reason;
    }
    const x = pick.x, pt = pts[pick.i] || null;
    return {
      nodeId: x.nodeId, num: x.num, name: x.name, imgUrl: x.imgUrl,
      metaText: mode === 2 && reason ? reason
        : (x.address ? (x.address + (this.data.gpsOk ? '' : ' · 到现场打卡')) : '点开看看这一站'),
      _pt: pt
    };
  },

  // P0 推荐评分收口到 utils/play-recommend(已单测);此处只喂 GPS 与当前分钟数
  scoreCandidates(nodes, pts, undone) {
    const now = new Date();
    return recommend.scoreCandidates(nodes, pts, undone, this._loc, now.getHours() * 60 + now.getMinutes());
  },

  // 营业时间窗:解析 "HH:mm-HH:mm";解析不出返回 null(不加不减)。逻辑收口到 utils/geo(已单测),此处只喂当前分钟数。
  inBizWindow(bt) {
    const now = new Date();
    return geo.bizWindowState(bt, now.getHours() * 60 + now.getMinutes());
  },

  // ---------- 卡堆半屏(mode2 决策层):居中标题 + 圆角候选行 + 推荐状态 ----------
  // 距离展示文本(卡堆行大字用,如 "320m"/"1.2km");与 scoreCandidates 内部的中文 reason 文案互不影响、各自独立格式化
  _distText(node) {
    if (!node.lat || !node.lng) return '';
    let dm = null;
    if (this._loc) {
      dm = this.haversine(this._loc.latitude, this._loc.longitude, node.lat, node.lng);
    } else {
      const doneSorted = this.data.nodes.filter((n) => n.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      const last = doneSorted[0];
      if (last && last.lat && last.lng) dm = this.haversine(last.lat, last.lng, node.lat, node.lng);
    }
    if (dm == null) return '';
    return dm >= 1000 ? (dm / 1000).toFixed(1) + 'km' : Math.round(dm) + 'm';
  },
  // 章节色:现有 buildJournal 里没有独立的按 chapterId 取色表(labelCol/bodyCol 走的是完成度沉降色阶),
  // 故卡堆左条统一按 chapterId 哈希一个稳定色;chapterId 缺失时同一套哈希兜底,保证同章节颜色一致。
  _chapterColor(chapterId) {
    return routeColorForKey(chapterId == null || chapterId === '' ? 'default' : chapterId);
  },
  /** 「看看别家」:完整地点列表就是卡包(seatTiles 覆盖全部 nodes),关掉半屏就回到它。
   *  2026-09-22 地点卡层删除后两个模式合成同一条路 —— 两个选点面并存只会让人问「这两个有什么区别」。 */
  openPoiFromSheet() {
    this.setData({ 'sheet.show': false, packOpen: true });
  },
  /** ③ 的门店核销码必须经过 merchant 页的单店授权写入+回读闸。 */
  openMerchantFromSheet() {
    const node = this.data.sheet && this.data.sheet.node;
    if (!node || node.nodeId == null) return;
    this.setData({ 'sheet.show': false }, () => {
      wx.navigateTo({ url: '/pages/play/merchant/index?nodeId=' + node.nodeId });
    });
  },
  // 结局层关闭(删卡堆时被误伤,门禁抓回):看完故事要能回到原页
  closeEnding() { this.setData({ 'ending.show': false }); },
  // ---------- 定位 ----------
  // 仅由「开始游玩」或「前往此站」触发。进入页面时不预先请求，拒绝后仍可扫码完成。
  requestPlayLocation() {
    if (this.data.isPreview || this.data.isMock || this.data.gpsOk || this._locationRequesting) return;
    const that = this;
    const unavailable = (hint) => {
      that._locationRequesting = false;
      that.setData({ gpsOk: false, gpsHint: hint });
    };
    this._locationRequesting = true;
    this.setData({ gpsHint: '正在请求定位…' });
    cyModal.show({
      title: '开启定位',
      content: '仅在你主动开始游玩后，用于显示当前位置和自动判断到点；未开启时仍可扫码到达。',
      confirmText: '开启定位',
      cancelText: '先用扫码',
      success(result) {
        if (!result.confirm) { unavailable('定位未开启 · 可扫码完成到达'); return; }
        wx.getLocation({
          type: 'gcj02', isHighAccuracy: true,
          success(loc) {
            that._loc = { longitude: loc.longitude, latitude: loc.latitude };
            that._locationRequesting = false;
            that.setData({ gpsOk: true, gpsHint: '定位已开启 · 靠近后会自动点亮' }, () => {
              that.rebuild();
              that.watchLocation();
            });
          },
          fail() { unavailable('定位未开启 · 可扫码完成到达'); }
        });
      },
      fail() { unavailable('定位暂不可用 · 可扫码完成到达'); }
    });
  },
  watchLocation() {
    const that = this;
    if (this._watching) return;                       // 防 onShow 重复注册→监听叠加→一次定位多次 arrive
    this._watching = true;
    try { wx.offLocationChange(); } catch (e) {}
    // 后台定位:玩家锁屏塞兜里走路是本场景的常态(在架路线 2–4.5 小时、7.8–10.5 公里),
    // 前台版一锁屏就断,轨迹断段、走到点位也判不出到达。拿不到后台权限时自动降级前台。
    // ⚠️ 停的时机见 onUnload / _stopTracking —— **不能**在 onHide 停。
    bgTracker.acquire(this._trackKey(), {
      fail() {
        that._watching = false;
        that.setData({ gpsOk: false, gpsHint: '实时定位未开启 · 可扫码完成到达' });
      },
      success() {
        wx.onLocationChange((loc) => {
          that._loc = { longitude: loc.longitude, latitude: loc.latitude };
          // S2 陪伴态:仅 nav.active 时才把玩家位置回灌地图(箭头需要跟着走)+ 刷新剩余距离/途中气泡阈值
          // 性能:回灌地图会触发 free-map 全量 _rebuild(重画节点+circles+箭头),GPS 每 1-3s 一次太频繁,
          // 节流成"移动 ≥5 米才回灌";nav.remainM/气泡阈值仍每 tick 刷(便宜,不受影响)。
          if (that.data.nav.active) {
            const moved = (that._lastNavPushLat == null) ? Infinity
              : that.haversine(that._lastNavPushLat, that._lastNavPushLng, that._loc.latitude, that._loc.longitude);
            if (moved >= 5) {
              that.setData({ fmPlayer: { lat: that._loc.latitude, lng: that._loc.longitude } });
              that._lastNavPushLat = that._loc.latitude;
              that._lastNavPushLng = that._loc.longitude;
            }
            that._updateNav(that._loc);
          }
          // nav 陪伴态下自动到达也要盯 nav.targetNodeId(玩家可能在导航非推荐站的节点),
          // 非 nav 时(含 mode1)仍走原 nextNode 逻辑,行为不变。
          const navTargetNode = that.data.nav.active ? that._nodeById(that.data.nav.targetNodeId) : null;
          const nx = that.data.nextNode;
          const node = navTargetNode || (nx && that.data.nodes.find((n) => n.nodeId === nx.nodeId));
          if (node && node.lng && node.lat) {
            const d = that.haversine(that._loc.latitude, that._loc.longitude, node.lat, node.lng);
            // 仅"到点即完成(vm0)/GPS到达(vm5)"节点自动到达;答题/拍照/选项/扫码(1/2/3/4)须玩家手动完成,
            // 否则后端 arrive 闸会拒绝并在每次定位回调刷 toast。
            if (d <= 50 && !node.done && (node.vm === 0 || node.vm === 5)) that.arrive(node.nodeId, 'gps');
          }
        });
      }
    });
  },
  // ---------- P1 俱乐部带领(轮询 + 队长控) ----------
  loadTeamProgress() {
    const that = this;
    const options = arguments[0];
    if (!this.data.activityId || this.data.isPreview || this.data.isMock) return;
    const requestEpoch = (this._leadProgressEpoch || 0) + 1;
    this._leadProgressEpoch = requestEpoch;
    const explicitAuditToken = options && options.unlockAuditToken;
    const unlockAuditToken = explicitAuditToken != null
      ? explicitAuditToken
      : (this._leadUnlockChecking ? this._leadUnlockAuditToken : null);
    const claimResponse = () => {
      // 只拒绝比「已落地」结果更旧的响应，不能以「最新已发起」为准。
      // 否则当 GET 持续慢于 4s 轮询间隔时，每个响应都会被下一请求提前作废而永不刷新。
      if (requestEpoch < (that._leadProgressAppliedEpoch || 0)) return false;
      that._leadProgressAppliedEpoch = requestEpoch;
      return true;
    };
    const markLeadLoadFailure = () => {
      if (claimResponse()) that.setData({ leadLoadError: true });
    };
    req('/api/club/lead/team-progress', 'GET', { activityId: this.data.activityId }).then((res) => {
      // 轮询、手动重试和放行后对账可能并发；旧响应不得覆盖较新的章节真相。
      if (!claimResponse()) return;
      if (!(res.code == 200 || res.code == '200') || !res.data) {
        that.setData({ leadLoadError: true });
        return;
      }
      const d = res.data;
      const unlockAuditDone = unlockAuditToken != null && unlockAuditToken === that._leadUnlockAuditToken;
      if (!d.exists) {
        if (unlockAuditDone) that._leadUnlockChecking = false;
        that.setData({
          'lead.exists': false,
          leadLoadError: false,
          leadUnlockChecking: unlockAuditDone ? false : !!that._leadUnlockChecking,
        });
        that._stopLeadPoll();
        return;
      }
      // 广播变化时轻提示(一次)
      if (d.broadcast && d.broadcast !== that._lastBroadcast) {
        that._lastBroadcast = d.broadcast;
        that.diegetic('队长:' + d.broadcast);
      }
      that.setData({
        lead: {
          exists: true, status: d.status || 1, isLeader: !!d.isLeader,
          arrived: d.arrived || 0, total: d.total || 0, meArrived: !!d.meArrived,
          chapterName: d.chapterName || '', broadcast: d.broadcast || '',
          members: (d.members || []).slice(0, 8)
        },
        leadLoadError: false,
        leadUnlockChecking: unlockAuditDone ? false : !!that._leadUnlockChecking,
      });
      if (unlockAuditDone) that._leadUnlockChecking = false;
      that._startLeadPoll();
    }).catch(markLeadLoadFailure);
  },
  _startLeadPoll() {
    if (this._leadTimer) return;
    const that = this;
    this._leadTimer = setInterval(() => that.loadTeamProgress(), 4000);
  },
  _stopLeadPoll() {
    if (this._leadTimer) { clearInterval(this._leadTimer); this._leadTimer = null; }
  },
  retryLeadProgress() {
    this.setData({ leadLoadError: false }, () => this.loadTeamProgress());
  },
  leadArrive() {
    const that = this;
    req('/api/club/lead/arrive', 'POST', { activityId: this.data.activityId }).then((r) => {
      that.diegetic(r.msg || '已到集合点');
      that.loadTeamProgress();
    });
  },
  leadStart() {
    const that = this;
    req('/api/club/lead/start', 'POST', { activityId: this.data.activityId }).then((r) => {
      that.diegetic(r.msg || '出发!');
      that.loadTeamProgress();
    });
  },
  _canUseLeadTools() {
    const lead = this.data.lead;
    return !!(lead && lead.exists && lead.isLeader);
  },
  // 规则 1：带队主题的玩家票必须从当前 activity 入口核销。不能复用商家首页的通用扫码，
  // 否则请求没有场次身份，后端会 fail closed，结算也无法区分同主题的不同团。
  leadVerifyMemberTicket() {
    const that = this;
    if (!this._canUseLeadTools() || !this.data.activityId) return;
    wx.scanCode({
      onlyFromCamera: true,
      success(scan) {
        const ticket = resolveLeadMemberTicket(scan.result);
        if (ticket.error) {
          that.diegetic(ticket.error);
          return;
        }
        cyLoading.show('正在核销');
        req('/api/registration/scan_group_member_ticket', 'POST', {
          code: ticket.code, activityId: that.data.activityId
        }).then((r) => {
          cyLoading.hide();
          const verified = r.code == 200 || r.code == '200';
          if (verified) motion.haptic({ type: 'medium', reducedMotion: that.data.reducedMotion });
          that.diegetic(r.msg || (verified ? '核销成功' : '核销失败'));
        });
      },
      fail(error) {
        that.diegetic(isScanCancelled(error) ? '已取消扫码' : '扫码未完成，请重试');
      }
    });
  },
  leadShowGroupCode() {
    if (!this._canUseLeadTools() || !this.data.activityId) return;
    this.openScene('qr-group-code', { activityId: this.data.activityId, name: '本场次' });
  },
  leadUnlock() {
    if (!this._canUseLeadTools() || !this.data.activityId) return;
    if (this._leadUnlockInFlight || this._leadUnlockChecking) return;
    this._leadUnlockInFlight = true;
    const that = this;
    cyModal.show({
      title: '解锁下一章节',
      content: '确认让全队进入下一章节?',
      confirmText: '确认解锁',
      success(res) {
        if (!res.confirm) {
          that._leadUnlockInFlight = false;
          that.diegetic('已取消解锁');
          return;
        }
        cyLoading.show('正在放行');
        req('/api/club/lead/unlock-chapter', 'POST', { activityId: that.data.activityId }).then((r) => {
          cyLoading.hide();
          that._leadUnlockInFlight = false;
          if (r.httpFail) {
            that._leadUnlockChecking = true;
            that._leadUnlockAuditToken = (that._leadUnlockAuditToken || 0) + 1;
            that.setData({ leadUnlockChecking: true });
            that.diegetic('章节放行结果待核对，正在读取队伍进度');
            that.loadTeamProgress({ unlockAuditToken: that._leadUnlockAuditToken });
            return;
          }
          const ok = r.code == 200 || r.code == '200';
          that.diegetic(r.msg || (ok ? '已放行' : '章节放行失败，请重试'));
          if (ok) that.loadTeamProgress();
        }).catch(() => {
          cyLoading.hide();
          that._leadUnlockInFlight = false;
          that.diegetic('章节放行没有送达，请检查网络后重试');
        });
      },
      fail() {
        that._leadUnlockInFlight = false;
        that.diegetic('解锁确认未打开，请重试');
      }
    });
  },
  leadBroadcast() {
    const that = this;
    cyModal.show({
      title: '队长广播',
      editable: true,
      placeholderText: '对全队说一句…',
      success(res) {
        if (res.confirm && res.content) {
          req('/api/club/lead/broadcast', 'POST', { activityId: that.data.activityId, text: res.content })
            .then((r) => { that.diegetic(r.msg || '已广播'); that.loadTeamProgress(); });
        }
      }
    });
  },
  // D-9 队长全团结算:一次核销=全团入结算(到场∩已付)。资金动作,二次确认。
  leadSettle() {
    const that = this;
    if (!this._canUseLeadTools() || !this.data.activityId) return;
    cyModal.show({
      title: '全团结算',
      content: '将为到场已购票的全体队员核销并入结算,确认结算?',
      confirmText: '结算全团',
      success(res) {
        if (!res.confirm) { that.diegetic('已取消结算'); return; }
        cyLoading.show('正在结算');
        req('/api/club/lead/settle', 'POST', { activityId: that.data.activityId }).then((r) => {
          cyLoading.hide();
          const ok = r.code == 200 || r.code == '200';
          that.diegetic(r.msg || (ok ? '全团结算完成' : '整团结算失败，请重试'));
          if (!ok) return;
          that.loadTeamProgress();
        });
      },
      fail() { that.diegetic('结算确认未打开，请重试'); }
    });
  },

  // ---------- P0 途中彩蛋 ----------
  // GPS 回调里判定:进 radius 且未读 且频控(≥180s/条)→ 弹气泡

  // ---------- S2 前往中陪伴态(FF-32:方向箭头 + 底部陪伴条,mode2 专属) ----------
  // 原来这里还有一个 onGoTap,和下面的 onSheetGoTap 逐行同义。它注释里写的入口(底部推荐条
  // 主 CTA)早已不存在,真实的唯一绑定是工具抽屉里一行标着「到点提醒」的行 —— 标签和动作
  // 对不上。前往 / 我到了只留节点半屏这一个入口(9-09 裁决:点不开或点错的功能一律收口)。
  // 入口:节点详情卡「⊡ 我已到达此站」(无模板节点)。仅 mode2 且有坐标才截胡进 nav。
  onSheetGoTap() {
    const node = this.data.sheet.node;
    const navHere = this.data.nav.active && node && this.data.nav.targetNodeId === node.nodeId;
    if (this.data.mode === 2 && node && !node.done && node.lat && node.lng && !navHere) { this.startNav(node); return; }
    if (!this.data.gpsOk) { this.requestPlayLocation(); return; }
    this.onArriveTap();
  },
  // 进入陪伴态:记录目标 + 路程基准(totalM=当前直线距离),隐藏 peek/卡堆。
  // 到达判定仍由既有 watchLocation(vm0/5 自动)/手动「我到了」/扫码(陪伴条上的入口,调既有 onArriveTap)负责,这里只管展示。
  startNav(node) {
    // 原来这里挡了 mode1,但设计稿 3963:15608(城市定向)同样有导航态 ⇒ 只挡缺坐标
    if (!node || !node.lat || !node.lng) return;
    const loc = this._loc;
    const totalM = loc ? this.haversine(loc.latitude, loc.longitude, node.lat, node.lng) : 0;
    this._lastNavPushLat = null; this._lastNavPushLng = null; // 重置节流基准,进入陪伴态首个 tick 必回灌一次
    this.setData({
      nav: { active: true, targetNodeId: node.nodeId, targetName: node.name || '', remainM: Math.round(totalM), totalM: totalM || 1, hit50: false, hit90: false },
      'sheet.show': false, 'stack.show': false
    }, () => {
      this.rebuild();
      this._syncNavMeta();
      this.requestPlayLocation();
    });
  },
  // 退出陪伴态:到达(onComplete 里加一行调用)或用户点「结束前往」X。nav 本就未激活时是安全 no-op。
  stopNav() {
    if (this._navBubbleTimer) { clearTimeout(this._navBubbleTimer); this._navBubbleTimer = null; }
    this._lastNavPushLat = null; this._lastNavPushLng = null; // 重置节流基准
    this.setData({
      nav: { active: false, targetNodeId: null, targetName: '', remainM: 0, totalM: 0, hit50: false, hit90: false },
      navBubble: { show: false, text: '' }
    }, () => this.rebuild());
  },
  // GPS 回调里驱动:刷新剩余距离,过 50%/90% 路程阈值各触发一次途中 NPC 气泡(S3 companionLine 端点)
  _updateNav(loc) {
    const node = this._nodeById(this.data.nav.targetNodeId);
    if (!node || !node.lat || !node.lng) return;
    const remainM = this.haversine(loc.latitude, loc.longitude, node.lat, node.lng);
    this.setData({ 'nav.remainM': Math.round(remainM) }, () => this._syncNavMeta());
    const totalM = this.data.nav.totalM || 1;
    const ratio = 1 - remainM / totalM;
    // hit90 优先判、互斥 else if:稀疏 GPS 一跳跨过 50%/90% 两个阈值时只触发一次气泡,
    // 避免两次 companionLine 请求共用一个 _navBubbleTimer、后一次悄悄覆盖前一次。正常步行仍分两个 tick 各触发一次。
    if (ratio >= 0.9 && !this.data.nav.hit90) { this.setData({ 'nav.hit90': true }); this._fetchCompanionLine(); }
    else if (ratio >= 0.5 && !this.data.nav.hit50) { this.setData({ 'nav.hit50': true }); this._fetchCompanionLine(); }
  },
  _fetchCompanionLine() {
    if (this.data.isPreview || this.data.isMock) return;
    const that = this;
    req('/api/play/companionLine', 'GET', this._sessionParams()).then((r) => {
      if (!(r.code == 200 || r.code == '200') || !r.data || !r.data.line) return;
      that.showNavBubble(r.data.line);
    });
  },
  showNavBubble(text) {
    this.setData({ navBubble: { show: true, text } });
    if (this._navBubbleTimer) clearTimeout(this._navBubbleTimer);
    this._navBubbleTimer = setTimeout(() => this.setData({ 'navBubble.show': false }), 3500);
  },

  haversine(la1, lo1, la2, lo2) { return geo.haversine(la1, lo1, la2, lo2); }, // 收口到 utils/geo(已单测)

  // ---------- 模式 ----------
  setMode(e) {
    const m = Number(e.currentTarget.dataset.m);
    if (m === this.data.mode) return;
    // 模式由后端按票种锁定(serverMode):城市定向(1)顺序探索、自由探索(2)全开。客户端不可切换,
    // 否则把锁定关卡显示成可点、逐个被后端"请先完成上一站"打回(误导)。
    cyToast(this.data.serverMode == 2 ? '本场为自由探索，可任意先后' : '本场为城市定向，需按顺序探索');
  },

  // ---------- 节点详情卡 ----------
  openSheet(node) {
    // 升级4:节点级前置解锁的**唯一收口**。onSeatTap 之外,还有 goToNode(手记行)也经这里
    // 进详情卡 —— 逐个入口加守卫必漏一个,
    // 所以闸放在这一层。(服务端四个完成入口另有硬闸,这里是 UX 层:先说清「还差什么」。)
    if (!node.done && this._routeInteractionBlocked()) { cyToast(this.data.routeNotice || '路线状态同步中'); return; }
    if (this._lockedTip(node)) return;
    const biz = node.businessTime;
    // S4 营业态换算已抽到 utils/play-open-state.js:大卡、六宫格瓦片、商家权益页共用一份,
    // 免得各自抄一份再各自漂。规则未变(openStatus 优先 → businessTime 兜底 → 都无则空)。
    const { openText, openCol, openDot } = resolveOpenState(node);
    const sheetNode = Object.assign({}, node, {
      metaLine: (node.address || '此处') + (biz ? (' · ' + biz) : ''),
      bizText: biz, openText, openCol, openDot,
      hasGame: node.hasTemplate,
      gameLede: node.story ? String(node.story).slice(0, 24) : '到达后开启本站任务',
      cardHook: node.cardHook || ''
    });
    this.setData({
      'sheet.show': true, 'sheet.node': sheetNode,
      'sheet.continueText': this.data.allDone ? '查看城市足迹卡' : '前往下一站'
    });
    // M6:开卡时相机平移,让选中节点落到上 1/3 视野(半屏大卡遮住下半屏时仍可见);无坐标节点优雅跳过
    if (node && node.lat && node.lng) {
      const fm = this.selectComponent('#fmMap');
      if (fm && typeof fm.focusNode === 'function') fm.focusNode(node.lat, node.lng);
    }
    // R14 旅程检定入口(契约:allowedActions)。到店前服务端不会给 'check',这里就什么都不弹。
    this._probeJourneyCheck(node);
  },
  // P0 导航逃生门:微信内置地图看真实街道(写法同 topic/index goLocation)
  sheetNav() {
    const n = this.data.sheet && this.data.sheet.node;
    if (!n || !n.lat || !n.lng) return;
    wx.openLocation({
      latitude: parseFloat(n.lat), longitude: parseFloat(n.lng),
      name: n.name || '目的地', address: n.address || '', scale: 18
    });
  },
  // 节点封面点击:多图时全屏预览(单图/无图不弹)
  previewNodeImages(e) {
    const raw = e.currentTarget.dataset.imgs;
    const urls = raw ? String(raw).split(',').filter(Boolean) : [];
    if (urls.length < 2) return;
    wx.previewImage({ current: urls[0], urls: urls });
  },
  closeSheet() {
    // M9 埋点:节点卡打开后未完成即离开 → node_abandon(可玩性 Lint 原料)
    const n = this.data.sheet && this.data.sheet.node;
    if (n && !n.done && !this.data.isPreview && !this.data.isMock) {
      analytics.track('node_abandon', { bizType: 'topic', bizId: this.data.topicId, properties: { nodeId: n.nodeId, via: 'sheet' } });
    }
    this.setData({ 'sheet.show': false });
  },
  previewGoBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/template/index' })
    });
  },
  // 预览态:从节点详情卡跳回 fabu 创作器并定位该节点编辑
  previewEditNode() {
    const node = this.data.sheet.node;
    const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
    ec && ec.emit && ec.emit('editNode', { nodeId: node && node.nodeId });
    this.previewGoBack();
  },
  flashLock() { this.setData({ lockHint: true }); setTimeout(() => this.setData({ lockHint: false }), 2200); },
  // ---------- 到达(无模板 / GPS / 手动) ----------
  _arriveTarget() {
    // nav 陪伴态优先按 nav.targetNodeId 解目标(玩家可能在导航别的点,sheet.node/nextNode 都可能是别的站),
    // 否则才落回原有 sheet.node/nextNode 链(非 nav 场景行为不变)。
    const nav = this.data.nav;
    return (nav.active && nav.targetNodeId != null && this._nodeById(nav.targetNodeId))
      || this.data.sheet.node || (this.data.nextNode && this.data.nodes.find((n) => n.nodeId === this.data.nextNode.nodeId));
  },
  onArriveTap() {
    const node = this._arriveTarget();
    if (!node) return;
    if (this._arrivalWriteUnknown) return;
    if (!this.data.gpsOk) { this.requestPlayLocation(); return; }
    this.arrive(node.nodeId, 'arrive');
  },
  onScanArrive() {
    const node = this._arriveTarget();
    if (this._arrivalWriteUnknown) return;
    if (node) this.scanArrive(node);
  },
  scanArrive(node) {
    const that = this;
    wx.scanCode({
      onlyFromCamera: true,
      success(r) { that.checkin(node ? node.nodeId : null, r.result); },
      fail(error) {
        if (isScanCancelled(error)) return;
        that.recordArrivalNetworkFailure('未能打开扫码，请检查相机权限后重试', { type: 'scan', nodeId: node && node.nodeId });
      }
    });
  },
  arrive(nodeId, via) {
    if (this.data.isPreview || this.data.isMock) { this.onComplete(nodeId, {}); return; }
    if (!this.beginArrivalWrite()) return;
    const that = this;
    const loc = this._loc || {};
    req('/api/play/arrive', 'POST', this._routeWritePayload('arrive', nodeId, { nodeId, longitude: loc.longitude, latitude: loc.latitude }))
      .then((r) => {
        that._arrivalWriteInFlight = false;
        if (r.code == 200 || r.code == '200') {
          that._resolveRouteAction('arrive', nodeId);
          if (that.data.mode === 2) { that.onShopDayArrived(nodeId, r.data); return; }
          that.onComplete(nodeId, r.data);
        }
        else if (that._handleRouteConflict(r, 'arrive', nodeId)) return;
        else if (r.httpFail) that.recordArrivalHttpUnknown(r.msg, nodeId);
        else if (r.netFail) that.recordArrivalNetworkFailure('打卡请求没有送达', { type: 'arrive', nodeId, via });
        else { that._resolveRouteAction('arrive', nodeId); that.diegetic(r.msg || '还没到这一站附近'); }
      }).catch(() => {
        that._arrivalWriteInFlight = false;
        that.recordArrivalNetworkFailure('打卡请求没有送达', { type: 'arrive', nodeId, via });
      });
  },
  checkin(nodeId, code, source) {
    if (this.data.isPreview || this.data.isMock) { this.onComplete(nodeId, {}); return; }
    const that = this;
    const isGame = source === 'game';
    if (isGame ? !this.beginGameWrite() : !this.beginArrivalWrite()) return;
    const attempt = isGame ? { type: 'gameCheckin', nodeId, code } : null;
    req('/api/play/checkin', 'POST', this._routeWritePayload('checkin', nodeId, { nodeId, code }))
      .then((r) => {
        if (isGame) that._gameWriteInFlight = false;
        else that._arrivalWriteInFlight = false;
        // 扫码以"码→节点"为准:用后端返回的 nodeId 点亮(自由定向扫错码不会点亮错节点)
        if (r.code == 200 || r.code == '200') {
          that._resolveRouteAction('checkin', nodeId);
          if (isGame) that.clearGameNetworkError();
          const litId = (r.data && r.data.nodeId != null) ? r.data.nodeId : nodeId;
          // 探店日(mode2):静态码只记「进店」,后端不置完成 —— 本地也绝不能走 onComplete,
          // 它会置 done+发庆祝,把「进店」演成「已核销」。改走凭证态合并 + 进商家页三步条。
          if (that.data.mode === 2 && !isGame) { that.onShopDayArrived(litId, r.data); return; }
          that.onComplete(litId, r.data);
        } else if (that._handleRouteConflict(r, 'checkin', nodeId)) return;
        else if (r.httpFail) {
          if (isGame) that.recordGameHttpUnknown(r.msg);
          else that.recordArrivalHttpUnknown(r.msg, nodeId);
        } else if (r.netFail) {
          if (isGame) that.recordGameNetworkFailure('扫码结果没有送达', attempt);
          else that.recordArrivalNetworkFailure('扫码结果没有送达', { type: 'checkin', nodeId, code });
        } else if (isGame) {
          that._resolveRouteAction('checkin', nodeId);
          that._lastGameAttempt = null;
          that.setData({ gNetErr: r.msg || '这枚码对不上这一站', gNetRetryable: false });
        } else {
          that._resolveRouteAction('checkin', nodeId);
          that.diegetic(r.msg || '这枚码对不上这一站');
        }
      }).catch(() => {
        if (isGame) that._gameWriteInFlight = false;
        else that._arrivalWriteInFlight = false;
        if (isGame) that.recordGameNetworkFailure('扫码结果没有送达', attempt);
        else that.recordArrivalNetworkFailure('扫码结果没有送达', { type: 'checkin', nodeId, code });
      });
  },
  // 2026-09-22 原来这条失败画在底部读数卡的错误条上(带一枚「重试」)。卡随地图层删除后改走
  // 全局 toast:写请求失败必须留下可见提示,重试就是用户再点一次那个动作 —— 静默是最糟的一种。
  recordArrivalNetworkFailure(message) {
    cyToast(message);
  },
  beginArrivalWrite() {
    if (this._arrivalWriteUnknown || this._arrivalWriteInFlight) return false;
    this._arrivalWriteInFlight = true;
    return true;
  },
  recordArrivalHttpUnknown(message) {
    this._arrivalWriteUnknown = true;
    // 结果未知这条尤其不能静默:看不见它的人只会反复点,而 beginArrivalWrite 已经把后续写拦住了。
    cyToast((message ? message + '；' : '') + '打卡结果待核对，请重新进入后查看，暂不要重复提交');
  },
  recordGameNetworkFailure(message, attempt) {
    if (this._gameWriteUnknown) return;
    this._lastGameAttempt = attempt;
    this.setData({ gNetErr: message, gNetRetryable: true, gRetryType: attempt && attempt.type || '', gWriteUnknown: false });
  },
  beginGameWrite() {
    if (this._gameWriteUnknown || this._gameWriteInFlight) return false;
    this._gameWriteInFlight = true;
    return true;
  },
  recordGameHttpUnknown(message) {
    this._gameWriteUnknown = true;
    this._gameWriteUnknownMessage = (message ? message + '；' : '') + '提交结果待核对，请重新进入后查看，暂不要重复提交';
    this._lastGameAttempt = null;
    this.setData({ gWrong: false, gNetErr: this._gameWriteUnknownMessage, gNetRetryable: false, gWriteUnknown: true });
  },
  clearGameNetworkError() {
    this._lastGameAttempt = null;
    const unknown = !!this._gameWriteUnknown;
    if (this.data.gNetErr || this.data.gNetRetryable || this.data.gWriteUnknown !== unknown) {
      this.setData({
        gNetErr: unknown ? this._gameWriteUnknownMessage : '',
        gNetRetryable: false,
        gRetryType: '',
        gWriteUnknown: unknown,
      });
    }
  },
  retryGameSubmission() {
    if (this._gameWriteUnknown) return;
    const attempt = this._lastGameAttempt;
    this.clearGameNetworkError();
    if (!attempt) return;
    if (attempt.type === 'photo') this.submitPhoto(attempt.nodeId, attempt.pic);
    else if (attempt.type === 'gameCheckin') this.checkin(attempt.nodeId, attempt.code, 'game');
    else if (attempt.type === 'gameScan') this.scanGame();
    else if (attempt.type === 'puzzleReveal') this.revealAnswer();
    else this.submitGame();
  },

  // ---------- 节点玩法 ----------
  startGame(nodeOverride) {
    if (nodeOverride && nodeOverride.nodeId != null) {
      this.setData({ 'sheet.node': nodeOverride, 'sheet.show': true }, () => this.startGame());
      return;
    }
    this.stopAudio();
    const node = this.data.sheet.node;
    if (!node) return;
    if (node.hasAdvanced && this._advancedReadyNodeId !== node.nodeId) {
      this.setData({ 'sheet.show': false, advancedPlay: { show: true, node } });
      return;
    }
    const chips = [];
    if (node.duration) chips.push({ ic: '⏱', v: node.duration });
    if (node.difficulty) chips.push({ ic: '◇', v: node.difficulty });
    if (node.players) chips.push({ ic: '人', v: node.players });
    const opts = [];
    const optMedia = node.optionMedia || {};
    if (node.options) ['A', 'B', 'C', 'D'].forEach((k) => {
      if (!node.options[k]) return;
      const media = optMedia[k] || {};
      opts.push({ k, v: node.options[k], img: media.img || '', audio: media.audio || '' });
    });
    this.setData({
      screen: 'gamePlay', 'sheet.show': false,   // 启动页(p02)已删:详情卡直接进任务
      game: {
        nodeId: node.nodeId, num: node.num, vm: node.vm, title: node.gameTitle || '本站任务',
        cover: node.cover, chips, story: node.story, rule: node.rule, materials: node.materials,
        qname: node.question || '依据现场线索作答', opts,
        qImg: node.questionImg, qAudio: node.questionAudio,
        audio: node.audio, audioDur: node.audioDur, photoDesc: node.photoDesc,
        feedback: node.feedback, reveal: node.reveal, hint1: node.hint1, hint2: node.hint2,
        hintLocked: !!node.hintLocked, hintCost: node.hintCost || 0, hintCount: node.hintCount || 0,
        puzzleScoring: !!node.puzzleScoring,
        medalName: node.medalName, medalImg: node.medalImg, couponId: node.couponId
      },
      answerInput: '', answerSel: '', gWrong: false,
      gNetErr: this._gameWriteUnknown ? this._gameWriteUnknownMessage : '',
      gNetRetryable: false, gWriteUnknown: !!this._gameWriteUnknown,
      shownHints: node.usedHints || [], revealed: false, wrongCount: 0,
      puzzleScoreCap: node.puzzleScoreCap == null ? 100 : node.puzzleScoreCap,
      // 锁态:按钮仍显示(文案带积分价),点击走解锁确认;明文态与原逻辑一致(hint2-only 也可看)
      canHint: node.puzzleScoring ? (node.usedHints || []).length < node.hintCount : (!!(node.hint1 || node.hint2) || !!node.hintLocked),
      canReveal: node.puzzleScoring && node.hintCount > 0 && (node.usedHints || []).length >= node.hintCount,
      hintLabel: node.hintLocked ? (node.hintCost + '积分')
        : (((node.usedHints || []).length || 1) + '/' + (node.hintCount || ((node.hint1 ? 1 : 0) + (node.hint2 ? 1 : 0)) || 1))
    }, () => { if (node.vm === 6) this.loadPreference(node); });
  },
  onAdvancedReady(e) {
    const node = this.data.advancedPlay.node;
    if (!node || (e.detail && e.detail.nodeId != null && e.detail.nodeId !== node.nodeId)) return;
    this._advancedReadyNodeId = node.nodeId;
    this.setData({ advancedPlay: { show: false, node: null }, 'sheet.node': node }, () => {
      /* vm 0/5 靠到达收尾;8/9/10(猜数字/猜图/找东西)也是 —— 后端
         ValidationMethod.completesOnArrive 白名单就把这三个算作「arrive 收尾」。
       以前只放 0/5 过,其余全被塞进 startGame:守卫刚被 _advancedReadyNodeId
       放行,于是落到老任务页 —— 那屏只写了 vm 1/2/3/4/6,这三个进来只剩一屏
       标题文字、零按钮的死路。 */
      if (node.vm === 0 || node.vm === 5 || node.vm === 8 || node.vm === 9 || node.vm === 10) {
        this.setData({ 'sheet.show': true });
        this.onSheetGoTap();
      } else {
        this.startGame();
      }
    });
  },
  onAdvancedClose() {
    const node = this.data.advancedPlay.node;
    this.setData({ advancedPlay: { show: false, node: null }, 'sheet.show': !!node, 'sheet.node': node || null });
  },
  closeGame() {
    // M9 埋点:任务界面未完成即退出 → node_abandon
    const g = this.data.game;
    if (g && g.nodeId && !this.data.isPreview && !this.data.isMock) {
      const n = this.data.nodes.find((x) => x.nodeId === g.nodeId);
      if (n && !n.done) analytics.track('node_abandon', { bizType: 'topic', bizId: this.data.topicId, properties: { nodeId: g.nodeId, via: 'game' } });
    }
    this._preferenceEpoch = (this._preferenceEpoch || 0) + 1;
    this.stopAudio(); this.clearGameNetworkError(); this.setData({ screen: '', scanning: false, gNetRetryable: false });
  },
  onInput(e) { this.setData({ answerInput: e.detail.value }); },
  selOpt(e) { this.setData({ answerSel: e.currentTarget.dataset.k }); },
  loadPreference(node) {
    const that = this;
    const nodeId = node.nodeId;
    const epoch = (this._preferenceEpoch || 0) + 1;
    this._preferenceEpoch = epoch;
    this.setData({ preference: {
      loading: true, error: '', steps: [], stepIndex: 0, choices: {}, inheritedTags: [],
      answerHere: false, submitting: false, result: null, pendingTag: null,
      tagDisclosure: null, progress: null, availableTagValues: []
    } });
    req('/api/play/preference/' + nodeId, 'GET', this._sessionParams()).then((r) => {
      if (that._preferenceEpoch !== epoch || that.data.game.nodeId !== nodeId) return;
      if (r.code == 200 || r.code == '200') {
        const d = r.data || {};
        that.setData({
          'preference.loading': false,
          'preference.steps': Array.isArray(d.steps) ? d.steps : [],
          'preference.inheritedTags': Array.isArray(d.inheritedTags) ? d.inheritedTags : []
        });
      } else {
        that.setData({ 'preference.loading': false, 'preference.error': r.msg || '偏好题暂时没加载出来' });
      }
    });
  },
  retryPreference() {
    const node = (this.data.nodes || []).find((n) => n.nodeId === this.data.game.nodeId);
    if (node) this.loadPreference(node);
  },
  answerPreferenceHere() { this.setData({ 'preference.answerHere': true }); },
  selectPreferenceOption(e) {
    const stepKey = e.currentTarget.dataset.step;
    const optionKey = e.currentTarget.dataset.option;
    this.setData({ ['preference.choices.' + stepKey]: optionKey });
  },
  nextPreferenceStep() {
    const p = this.data.preference;
    const step = p.steps[p.stepIndex];
    if (!step || !p.choices[step.key]) return cyToast('先选一个更像你的答案');
    if (p.stepIndex < p.steps.length - 1) {
      this.setData({ 'preference.stepIndex': p.stepIndex + 1 });
      return;
    }
    this.submitPreference({ choices: p.choices });
  },
  useInheritedPreference(e) {
    this.submitPreference({ choices: {}, reuseTagCode: e.currentTarget.dataset.code });
  },
  submitPreference(payload) {
    if (this.data.preference.submitting) return;
    const that = this;
    const nodeId = this.data.game.nodeId;
    const epoch = this._preferenceEpoch;
    this.setData({ 'preference.submitting': true, 'preference.error': '' });
    req('/api/play/preference/' + nodeId + '/submit', 'POST', this._routeWritePayload('preference', nodeId, payload))
      .then((r) => {
        if (that._preferenceEpoch !== epoch || that.data.game.nodeId !== nodeId) return;
        if (r.code == 200 || r.code == '200') {
          that._resolveRouteAction('preference', nodeId);
          const d = r.data || {};
          if (d.needsTiebreak && d.tiebreak) {
            const steps = that.data.preference.steps.slice();
            if (!steps.some((s) => s.key === d.tiebreak.key)) steps.push(d.tiebreak);
            that.setData({ 'preference.submitting': false, 'preference.steps': steps, 'preference.stepIndex': steps.length - 1 });
            return;
          }
          that.setData({
            'preference.submitting': false,
            'preference.result': d.evaluation || null,
            'preference.pendingTag': d.pendingTag || null,
            'preference.tagDisclosure': d.tagDisclosure || null,
            'preference.progress': d.progress || null,
            'preference.availableTagValues': Array.isArray(d.availableTagValues) ? d.availableTagValues : []
          });
        } else if (that._handleRouteConflict(r, 'preference', nodeId)) {
          that.setData({ 'preference.submitting': false, 'preference.error': '路线状态已更新，请重新确认当前选择' });
        } else {
          if (!r.netFail && !r.httpFail) that._resolveRouteAction('preference', nodeId);
          that.setData({ 'preference.submitting': false, 'preference.error': r.msg || '结果没有生成，请重试' });
        }
      });
  },
  confirmPreferenceTag() {
    const tag = this.data.preference.pendingTag;
    if (!tag || !tag.id || this._preferenceTagWrite) return;
    const that = this;
    const epoch = this._preferenceEpoch;
    this._preferenceTagWrite = true;
    req('/api/play/tag/' + tag.id + '/confirm', 'POST', {}).then((r) => {
      that._preferenceTagWrite = false;
      if (that._preferenceEpoch !== epoch || !that.data.preference.pendingTag || that.data.preference.pendingTag.id !== tag.id) return;
      if (r.code == 200 || r.code == '200') that.setData({ 'preference.pendingTag': r.data });
      else cyToast(r.msg || '标签没有确认成功');
    });
  },
  /* 2026-09-02:原来弹 wx.showActionSheet(系统弹层,设计体系外)。改标签值属于「一次选择」,
     走 cy-option-sheet 默认形态。⚠️ 这处在玩法主流程里,写闸 _preferenceTagWrite 与
     _preferenceEpoch 的判断一条不动,只把「怎么问」换掉。 */
  correctPreferenceTag() {
    const tag = this.data.preference.pendingTag;
    const values = this.data.preference.availableTagValues || [];
    if (!tag || !tag.id || !values.length || this._preferenceTagWrite) return;
    this.setData({ tagSheetShow: true, tagSheetItems: values });
  },
  onTagSheetCancel() { this.setData({ tagSheetShow: false }); },
  onTagSheetSelect(e) {
    const tag = this.data.preference.pendingTag;
    const values = this.data.preference.availableTagValues || [];
    const value = values[e.detail.index];
    this.setData({ tagSheetShow: false });
    if (!tag || !tag.id || !value || value === tag.tagValue || this._preferenceTagWrite) return;
    const epoch = this._preferenceEpoch;
    this._preferenceTagWrite = true;
    req('/api/play/tag/' + tag.id + '/correct', 'POST', { tagValue: value }).then((r) => {
      this._preferenceTagWrite = false;
      if (this._preferenceEpoch !== epoch || !this.data.preference.pendingTag || this.data.preference.pendingTag.id !== tag.id) return;
      if (r.code == 200 || r.code == '200') {
        this.setData({ 'preference.pendingTag': r.data });
        cyToast('已改为 ' + value);
      } else cyToast(r.msg || '结果没有改成功');
    });
  },
  skipPreferenceTag() { this.setData({ 'preference.pendingTag': null }); },
  finishPreferenceResult() {
    const p = this.data.preference;
    this.onComplete(this.data.game.nodeId, p.progress || {});
  },
  scanGame() {
    if (this._gameWriteUnknown) return;
    const that = this; this.setData({ scanning: true });
    wx.scanCode({
      onlyFromCamera: true,
      success(r) { that.setData({ scanning: false }); that.checkin(that.data.game.nodeId, r.result, 'game'); },
      fail(error) {
        that.setData({ scanning: false });
        if (!isScanCancelled(error)) that.recordGameNetworkFailure('未能打开扫码，请检查相机权限后重试', { type: 'gameScan' });
      }
    });
  },
  photoGame() {
    if (this._gameWriteUnknown) return;
    const that = this, g = this.data.game;
    if (this.data.isPreview || this.data.isMock) { this.onComplete(g.nodeId, {}); return; }
    app.chooseImage(function (urls) {
      const pic = (urls && urls[0]) || '';
      if (!pic) return;
      that.setData({ photoTaken: true, gNetErr: '', gNetRetryable: false });
      that.submitPhoto(g.nodeId, pic);
    }, 1);
  },
  submitPhoto(nodeId, pic) {
    if (!this.beginGameWrite()) return;
    const that = this;
    const attempt = { type: 'photo', nodeId, pic };
    this._lastGameAttempt = attempt;
    req('/api/play/photo', 'POST', this._routeWritePayload('photo', nodeId, { nodeId, picUrl: pic }))
      .then((r) => {
        that._gameWriteInFlight = false;
        if (r.code == 200 || r.code == '200') {
          that._resolveRouteAction('photo', nodeId);
          that.clearGameNetworkError();
          that.onComplete(nodeId, r.data);
          that._applyAiScore(nodeId, r.data);
        } else if (that._handleRouteConflict(r, 'photo', nodeId)) return;
        else if (r.httpFail) {
          that.recordGameHttpUnknown(r.msg);
        } else if (r.netFail) {
          that.recordGameNetworkFailure('照片上传没有送达', attempt);
        } else {
          that._resolveRouteAction('photo', nodeId);
          that._lastGameAttempt = null;
          that.setData({ gNetErr: r.msg || '照片未上传成功，请重新选择', gNetRetryable: false });
        }
      }).catch(() => {
        that._gameWriteInFlight = false;
        that.recordGameNetworkFailure('照片上传没有送达', attempt);
      });
  },
  submitGame() {
    if (this._gameWriteUnknown) return;
    const g = this.data.game;
    const answer = g.vm == 3 ? this.data.answerSel : this.data.answerInput;
    if (!answer) return this.setData({ gWrong: true, 'game.feedback': '先把答案填上再提交。' });
    if (this.data.isPreview || this.data.isMock) { this.onComplete(g.nodeId, {}); return; }   // 路线级预览只跳过服务端判题,不跳过空值校验
    if (!this.beginGameWrite()) return;
    const that = this;
    req('/api/play/answer', 'POST', this._routeWritePayload('answer', g.nodeId, { nodeId: g.nodeId, answer }))
      .then((r) => {
        that._gameWriteInFlight = false;
        if (r.code == 200 || r.code == '200') { that._resolveRouteAction('answer', g.nodeId); that.clearGameNetworkError(); that.onComplete(g.nodeId, r.data); }
        else if (that._handleRouteConflict(r, 'answer', g.nodeId)) return;
        // 请求没送到 ≠ 服务端判你答错。原码把 code!=200 一律记 wrongCount++,断网提交两次
        // 就满足 canReveal(wc>=2) —— 系统替你答错两次、直接把答案揭示了。
        else if (r.httpFail) that.recordGameHttpUnknown(r.msg);
        else if (r.netFail) that.recordGameNetworkFailure('提交没送出去，检查网络后重试', { type: 'answer' });
        else {
          that._resolveRouteAction('answer', g.nodeId);
          that._lastGameAttempt = null;
          // ★ 只有后端标了「答案错」(data.answerWrong)才计一次错。业务拒绝(活动已结束/未报名/
          //   先扫码进店/本章未放行…)原来也被计成答错,连碰两次业务错误就解锁「揭示答案」——
          //   等于系统替玩家答错两次。业务拒绝只提示,不计数、不解锁。
          const answerWrong = !!(r.data && r.data.answerWrong);
          const wc = answerWrong ? that.data.wrongCount + 1 : that.data.wrongCount;
          that.setData({ gWrong: true, gNetErr: '', gNetRetryable: false, wrongCount: wc, 'game.feedback': r.msg || g.feedback, canReveal: wc >= 2 && (!!g.reveal || !!g.puzzleScoring) });
        }
      }).catch(() => {
        that._gameWriteInFlight = false;
        that.recordGameNetworkFailure('提交没送出去，检查网络后重试', { type: 'answer' });
      });
  },
  useHint() {
    const g = this.data.game;
    if (g.puzzleScoring && this.data.mode === 1) {
      if (this.data.hintUnlocking) return;
      const level = this.data.shownHints.length + 1;
      this.setData({ hintUnlocking: true });
      req('/api/play/puzzle/hint', 'POST', Object.assign(this._sessionParams(), { nodeId: g.nodeId, level }))
        .then((r) => {
          if (r.code == 200 || r.code == '200') {
            const hints = Array.isArray(r.data.hints) ? r.data.hints.filter(Boolean)
              : this.data.shownHints.concat([r.data.hint]).filter(Boolean);
            const hintCount = Number(r.data.hintCount || g.hintCount || hints.length);
            this.setData({
              shownHints: hints,
              puzzleScoreCap: Number(r.data.scoreCap) || 40,
              canHint: hints.length < hintCount,
              canReveal: hints.length >= hintCount,
              hintLabel: hints.length + '/' + hintCount,
            });
            const nodeIndex = this.data.nodes.findIndex((n) => n.nodeId === g.nodeId);
            if (nodeIndex >= 0) {
              const nodes = this.data.nodes.slice();
              nodes[nodeIndex] = Object.assign({}, nodes[nodeIndex], {
                usedHints: hints,
                puzzleHintLevel: Number(r.data.level) || 0,
                puzzleScoreCap: Number(r.data.scoreCap) || 40,
              });
              this.setData({ nodes });
            }
          } else {
            cyToast(r.msg || '提示暂时不可用');
          }
          this.setData({ hintUnlocking: false });
        })
        .catch(() => {
          this.setData({ hintUnlocking: false });
          cyToast('提示没有加载出来，请重试');
        });
      return;
    }
    if (g.hintLocked) { this.unlockHint(); return; }
    // 按实际配置的提示列表渐进揭示(兼容只配 hint2 的模板,别让人付了分看不到东西)
    const all = [g.hint1, g.hint2].filter(function (t) { return !!t; });
    const hints = this.data.shownHints.slice();
    if (hints.length < all.length) hints.push(all[hints.length]);
    this.setData({ shownHints: hints, canHint: hints.length < all.length, hintLabel: hints.length + '/' + (all.length || 1) });
  },
  // 积分解锁本节点提示:确认弹窗 → 后端扣分(幂等,重复调不重复扣) → 回填明文继续渐进揭示
  unlockHint() {
    const that = this, g = this.data.game;
    if (this.data.hintUnlocking) return;
    this.setData({ hintUnlocking: true }); // 弹窗期间即占位:连点不再叠出第二个弹窗
    cyModal.show({
      title: '解锁提示',
      content: '解锁本节点提示需 ' + (g.hintCost || 0) + ' 积分,确认解锁?',
      confirmText: '解锁',
      cancelText: '再想想',
      success(res) {
        if (!res.confirm) { that.setData({ hintUnlocking: false }); return; }
        app.sendRequest({
          url: '/api/play/hint/unlock', method: 'POST',
          // 必须带会话上下文:后端按它验「真的在这场/这个主题里」(与解谜提示同口径),
          // 只发 nodeId 会被拒 —— 否则任何登录用户拿到节点 id 就能读走提示正文。
          data: Object.assign({ nodeId: g.nodeId }, that._sessionParams()),
          success(resp) {
            if (resp.code == '200' && resp.data) {
              that.setData({
                'game.hint1': resp.data.hint1 || '',
                'game.hint2': resp.data.hint2 || '',
                'game.hintLocked': false
              });
              that.useHint(); // 解锁后立即揭示第一条
            } else {
              cyToast(app.getRequestErrorMessage(resp, '解锁失败,请重试'));
            }
          },
          fail(resp) {
            cyToast(app.getRequestErrorMessage(resp, '网络异常，请重试'));
          },
          complete() { that.setData({ hintUnlocking: false }); }
        });
      },
      fail() { that.setData({ hintUnlocking: false }); }
    });
  },
  revealAnswer() {
    const g = this.data.game;
    if (!g.puzzleScoring || this.data.mode !== 1) {
      this.setData({ revealed: true, canReveal: false });
      return;
    }
    if (!this.beginGameWrite()) return;
    const attempt = { type: 'puzzleReveal', nodeId: g.nodeId };
    this._lastGameAttempt = attempt;
    req('/api/play/puzzle/reveal', 'POST', this._routeWritePayload('puzzleReveal', g.nodeId, { nodeId: g.nodeId }))
      .then((r) => {
        this._gameWriteInFlight = false;
        if (r.code == 200 || r.code == '200') {
          this._resolveRouteAction('puzzleReveal', g.nodeId);
          this.clearGameNetworkError();
          const answer = (r.data && r.data.answerReveal) || '答案已揭示';
          this.setData({ revealed: true, canReveal: false, puzzleScoreCap: 0, 'game.reveal': answer });
          cyModal.show({
            title: '答案', content: answer, showCancel: false, confirmText: '继续',
            success: () => this.onComplete(g.nodeId, r.data || {}),
          });
        } else if (this._handleRouteConflict(r, 'puzzleReveal', g.nodeId)) return;
        else if (r.httpFail) this.recordGameHttpUnknown(r.msg);
        else if (r.netFail) this.recordGameNetworkFailure('查看答案请求没有送达', attempt);
        else {
          this._resolveRouteAction('puzzleReveal', g.nodeId);
          this._lastGameAttempt = null;
          cyToast(r.msg || '暂时不能查看答案');
        }
      })
      .catch(() => {
        this._gameWriteInFlight = false;
        this.recordGameNetworkFailure('查看答案请求没有送达', attempt);
      });
  },

  // ---------- 完成:盖章 + 飞分 + 徽章/券 + 推进 ----------
  /** 探店日进店回执:只合并后端凭证态(arrived/arrivedAt/…),不置 done、不庆祝,
   *  然后带进商家详情页,由三步条接管「拍照 → 出示核销码」。 */
  onShopDayArrived(nodeId, data) {
    const patch = data || {};
    const nodes = this.data.nodes.map((n) => n.nodeId === nodeId ? Object.assign({}, n, patch) : n);
    this.setData({ nodes, 'sheet.show': false }, () => this.rebuild());
    wx.navigateTo({ url: '/pages/play/merchant/index?nodeId=' + nodeId + '&justScanned=1' });
  },
  _animateCompletedSegment(nodes, nodeId) {
    if (this._routeDrawStop) this._routeDrawStop();
    const segment = completedRouteSegment(nodes, nodeId);
    if (segment.length < 2) return;
    const base = (this.data.fmPolyline || []).filter((line) => !line.gameProgressSegment);
    this._routeDrawStop = motion.routeDraw(segment, (points) => {
      const line = {
        gameProgressSegment: true,
        points: points.map((point) => ({ latitude: point.lat, longitude: point.lng })),
        color: routeColorForKey('confirmed-progress'),
        width: 8,
        borderColor: ROUTE_BORDER_COLOR,
        borderWidth: 2,
        dottedLine: false,
        arrowLine: false,
      };
      this.setData({ fmPolyline: base.concat(line) });
    }, { reducedMotion: this.data.reducedMotion });
  },
  onComplete(nodeId, data) {
    // arrival/game 是可并发的两个写域；任一节点完成都不能解除另一写域的在途/待核对锁。
    // 各请求只在自己的 then/catch 中收口 in-flight，unknown 只能由该动作的权威读回或重进页面清除。
    this.clearGameNetworkError();
    this.stopNav();   // S2 陪伴态:到达即收起陪伴条(nav 未激活时是安全 no-op)
    // P0 推荐采纳埋点:完成的正是当前推荐节点(mode=2)
    if (this.data.mode === 2 && this.data.nextNode && this.data.nextNode.nodeId === nodeId && !this.data.isMock) {
      analytics.track('play_rec_accept', { bizType: 'topic', bizId: this.data.topicId, properties: { nodeId } });
    }
    // 完成事实来自本次服务端成功回执；BRANCH_GRAPH 的下一站仍只认随回执返回或只读刷新得到的 routeState。
    const patchCompleted = (n) => n.nodeId === nodeId ? Object.assign({}, n, {
      done: true,
      doneAt: data && data.completedAt ? Number(data.completedAt) : (n.doneAt || Date.now()),
      earnedXp: (data && (data.xp != null || data.score != null))
        ? Number(data.xp != null ? data.xp : data.score) : n.earnedXp,
      routeNodeState: this._routeState.routeMode === 'BRANCH_GRAPH' ? 'COMPLETED' : n.routeNodeState,
      playable: false,
      puzzleScore: data && data.puzzleScore != null ? Number(data.puzzleScore) : n.puzzleScore,
      completionMode: data && data.completionMode ? data.completionMode : n.completionMode,
    }) : n;
    const catalog = (this._routeNodeCatalog || this.data.nodes).map(patchCompleted);
    this._routeNodeCatalog = catalog;
    const returnedRouteState = data && data.routeState ? normalizeRouteState(data.routeState) : null;
    const routeState = returnedRouteState || this._routeState;
    const nodes = returnedRouteState
      ? applyRouteStateToNodes(catalog, routeState)
      : this.data.nodes.map(patchCompleted);
    if (data && data.puzzlePersonalBest != null) {
      this._puzzlePersonalBest = Number(data.puzzlePersonalBest) || 0;
    }
    const node = nodes.find((n) => n.nodeId === nodeId) || {};
    // P0.5 双轨文案:后端回传本次探索值(节点+掉落翻倍);旧后端无 xp 字段时退 12
    const score = (data && data.xp) || (data && data.score) || node.points || 12;
    // M8 到达双震:两次短震间隔 ~120ms,只强化到达这一处;彩蛋(light)/券(heavy)分级不动
    wx.vibrateShort({ type: 'medium' });
    setTimeout(() => wx.vibrateShort({ type: 'medium' }), 120);
    // 飞字(双轨文案:探索值升等级,区别于可抵现积分)
    this.setData({ flyScore: true, flyText: '+' + score + ' 探索值' });
    setTimeout(() => this.setData({ flyScore: false }), 1100);
    // 标记 just-wrote(手记写入)
    const justId = nodeId;
    this._routeState = routeState;
    this.setData({
      nodes,
      routeNotice: returnedRouteState ? this._routeNoticeForState(returnedRouteState) : this.data.routeNotice,
      screen: '',
      'sheet.show': false
    }, () => {
      this.rebuild();
      setTimeout(() => this._animateCompletedSegment(nodes, nodeId), 0);
      this._triggerCelebration('task-complete');
      // M2 夜间提示(自玩 22:00–06:00 后端下发 nightWarning):结果时刻一句,非阻断、自动收
      if (data && data.nightWarning === true) this._flashNightHint();
      // mode2 碎片翻卡:完成即翻出该节点碎片(空则不弹)
      if (this.data.mode === 2) {
        const done = nodes.filter((n) => n.done);
        const frText = node.fragmentText || '';
        // 剩余点位半屏已删(用户裁决):碎片翻卡恢复常弹,剩余点看地点卡层
        if (frText) this.setData({ frag: { show: true, text: frText, step: '我的第 ' + done.length + ' 步 · ' + (node.name || '') } });
      }
      const completed = data && data.completed;
      // 后端本次新得成长徽章(FIRST_STEP/STREAK/TOPIC_CLEAR…),与节点模板勋章不同源,逐一轻提示
      const newBadges = (data && data.newBadges) || [];
      if (newBadges.length) {
        // 原来这里是一句 toast:徽章名一闪就没,badgeCode(服务端给的稳定 ID)被直接丢掉,
        // 玩家既回不到收藏位、也没法核实这枚徽章到底有没有真落进墙里。
        // 改成常驻掉落卡:留住 code,给「查看收藏」和「继续」两条明路。
        this.setData({
          rewardDrop: {
            show: true,
            text: '解锁徽章:' + newBadges.map((b) => b.name).join('、'),
            badges: newBadges.map((b) => ({ code: b.code || '', name: b.name || '徽章' })),
          },
        });
      }
      // 名次奖牌只发给全平台头三个完成该节点的人(node_medal_claim)。原来只要节点配了
      // medalName/medalImg 就弹「专属徽章」——第 4 名起弹的是假奖,勋章墙里根本没有。
      // data.medalRank 才是「这次真夺到了」的事实;没中签就不弹勋章,给一句人话。
      const medalRank = data && Number(data.medalRank) > 0 ? Number(data.medalRank) : 0;
      const hasMedalArt = !!(node.medalName || node.medalImg);
      const previewMedal = !!(this.data.isPreview || this.data.isMock);
      if (hasMedalArt && (medalRank || previewMedal)) {
        // 模板勋章弹层;关闭时若已通关由 closeMedal 触发通关卡
        this.setData({ medal: { show: true, name: node.medalName || '专属徽章', shortName: (node.medalName || '徽章').slice(0, 2), img: node.medalImg, style: node.medalStyle || 'glow', coupon: node.couponId ? '到店出示核销' : '' } });
      } else {
        if (hasMedalArt) this.diegetic('这个节点的名次奖牌已经发完，完成记录已保存');
        if (node.couponId) this.showCoupon('到店出示核销');
        if (completed) setTimeout(() => this.openFinish(), 600);  // 末站即便配券也要弹通关卡(原 else-if 漏掉)
      }
      if (newBadges.length || (hasMedalArt && (medalRank || previewMedal))) this._triggerCelebration('medal-earned');
      this.setData({ journalDot: !this.data.showJournal });
      if (this._routeState.routeMode === 'BRANCH_GRAPH' && !this.data.isPreview && !this.data.isMock) {
        // routeState 只描述节点状态，未包含本次刚从 HIDDEN 解锁节点的地点/玩法资料。
        // 必须同页重读 /nodes，不能等玩家重新进入页面才看见下一站。
        this.loadData(false);
      }
    });
  },
  closeMedal() { this.setData({ 'medal.show': false }); if (this.data.allDone) setTimeout(() => this.openFinish(), 300); },
  // P0 券断链修复:落袋可见(文案+重震动)+ 可点击一跳到卡券包;停留 5s 给足点击窗口
  // M11 掉落分级·重:券=独立 couponBurst 彩带+重震动,不并入完成庆祝语义
  showCoupon(text) {
    wx.vibrateShort({ type: 'heavy' });   // 动效分级:券=重
    const colors = ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#EEEEEE'];
    const couponBurst = [];
    for (let i = 0; i < 22; i++) couponBurst.push({ i, left: Math.round(Math.random() * 100), color: colors[i % colors.length], dur: (1.4 + Math.random() * 1.2).toFixed(2), delay: (Math.random() * 0.4).toFixed(2) });
    this.setData({ couponToast: true, couponText: text, couponBurst });
    if (this._couponTimer) clearTimeout(this._couponTimer);
    if (this._burstTimer) clearTimeout(this._burstTimer);
    this._burstTimer = setTimeout(() => this.setData({ couponBurst: [] }), 2600);
    this._couponTimer = setTimeout(() => this.setData({ couponToast: false }), 5000);
  },
  // 去优惠券列表:券 toast / 勋章弹层券行 共用(2026-07-31:票夹已删优惠券 tab，改跳独立优惠券页)
  goCouponWallet() {
    this.setData({ couponToast: false, 'medal.show': false });
    this.openScene('game-coupon-wallet');
  },
  continueNext() {
    this.setData({ 'sheet.show': false });
    if (this.data.allDone) return this.openFinish();
    const nx = this.data.nextNode;
    if (nx) { const node = this._nodeById(nx.nodeId); if (node && node.lat && node.lng) this.setData({ fmCenter: { lat: node.lat, lng: node.lng } }); }
  },
  diegetic(msg) { cyToast(msg); },
  // M2 夜间提示(自玩 22:00–06:00):完成结果时刻出,4.6s 自动收;纯展示层,不吃点击不弹窗。
  _flashNightHint() {
    if (this._nightHintTimer) clearTimeout(this._nightHintTimer);
    this.setData({ nightHint: true });
    this._nightHintTimer = setTimeout(() => {
      this._nightHintTimer = null;
      this.setData({ nightHint: false });
    }, 4600);
  },

  /** 「查看收藏」:带着 badgeCode 跳徽章墙——奖励必须能在它自己的详情位被回读到。 */
  openRewardCollection() {
    const first = (this.data.rewardDrop.badges || [])[0] || {};
    this.setData({ 'rewardDrop.show': false });
    wx.navigateTo({
      url: '/subpackageP3/pages/badge-wall/index/index'
        + (first.code ? '?badgeCode=' + encodeURIComponent(first.code) : ''),
      fail: () => this.diegetic('徽章墙没打开,可以从成长中心进入'),
    });
  },
  closeRewardDrop() { this.setData({ 'rewardDrop.show': false }); },

  // ---------- 章节过场 ----------
  openScene(id, params = {}) {
    const next = getScene(id, params);
    if (exitDecision(this.data.sceneStack, 'close') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'replace', pending: next } });
      return false;
    }
    const sceneStack = pushScene(this.data.sceneStack, next);
    this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneIn: false, sceneConfirm: { show: false, action: null, pending: null } });
    /* sceneIn 先 false 再置 true:原型 sheet 是 @keyframes up 进场,这里换成同参数的
       transition(仓库 keyframes 只减不增),必须留一帧当起点。 */
    this._sceneInTimer = setTimeout(() => this.setData({ sceneIn: true }), 20);
    return true;
  },
  backScene() {
    if (exitDecision(this.data.sceneStack, 'back') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'back', pending: null } });
      return;
    }
    const sceneStack = popScene(this.data.sceneStack);
    this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
  },
  // 任务列表的行是官方活动:收场景后进官方活动详情(3-18)
  openOfficialEvent(e) {
    this.closeScene();
    wx.navigateTo({ url: '/pages/activity/official-detail/index?id=' + e.detail.id });
  },
  // 「投一张」:scene-roam-poi-detail 只发事件,由宿主收场景再进分包城市签(3-24)
  openCityStamp(e) {
    const place = (e && e.detail && e.detail.place) || '这一站';
    this.closeScene();
    wx.navigateTo({ url: '/subpackageRoam/citystamp/index?kind=sign&place=' + encodeURIComponent(place) });
  },
  closeScene() { if (this._sceneInTimer) { clearTimeout(this._sceneInTimer); this._sceneInTimer = null; }
    this.setData({ sceneStack: [], sceneCurrent: null, sceneIn: false, sceneConfirm: { show: false, action: null, pending: null } }); },
  requestSceneClose() {
    if (exitDecision(this.data.sceneStack, 'close') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'close', pending: null } });
      return;
    }
    this.closeScene();
  },
  confirmSceneDiscard() {
    if (this.data.sceneConfirm.action === 'back') {
      const sceneStack = popScene(this.data.sceneStack);
      this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
      return;
    }
    if (this.data.sceneConfirm.action === 'replace' && this.data.sceneConfirm.pending) {
      const sceneStack = pushScene(this.data.sceneStack, this.data.sceneConfirm.pending);
      this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
      return;
    }
    this.closeScene();
  },
  cancelSceneDiscard() { this.setData({ sceneConfirm: { show: false, action: null, pending: null } }); },
  setSceneDirty(dirty = true) {
    if (!this.data.sceneStack.length) return;
    const sceneStack = this.data.sceneStack.slice();
    sceneStack[sceneStack.length - 1] = { ...sceneStack[sceneStack.length - 1], dirty: dirty === true };
    this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack) });
  },
  openChildScene(event) {
    const detail = event.detail || {};
    if (detail.id) this.openScene(detail.id, detail.params || {});
  },
  onSceneSessionShare() {
    if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: true });
  },
  openStampCameraFromScene() {
    this.closeScene();
    wx.navigateTo({ url: '/subpackageP3/pages/stamp-camera/index/index' });
  },
  openCityStamp(event) {
    const place = (event && event.detail && event.detail.place) || '这一站';
    this.closeScene();
    wx.navigateTo({ url: '/subpackageRoam/citystamp/index?kind=sign&place=' + encodeURIComponent(place) });
  },
  blockSceneTouch() {},
  openSessionTools() { this.setData({ sessionToolsOpen: true }); },
  toggleSessionTools() { this.setData({ sessionToolsOpen: !this.data.sessionToolsOpen }); },
  closeSessionTools() { this.setData({ sessionToolsOpen: false }); },
  /* 定位驱动的两行(自动记录足迹 / 到点提醒)在这一页翻不动:它们跟着系统定位权限走。
   * 没开就去要权限,已经开着就说清楚它由谁决定 —— 不留一枚按下去毫无反应的开关。 */
  onLocationRowTap() {
    if (!this.data.gpsOk) { this.requestPlayLocation(); return; }
    cyToast('跟着定位权限走，去微信设置里改');
  },

  toggleReducedMotion() {
    const reducedMotion = writeReducedMotion(null, !this.data.reducedMotion);
    this.setData({ reducedMotion });
    cyToast(reducedMotion ? '已减少动态效果' : '已恢复动态效果');
  },
  _triggerCelebration(moment) {
    if (!moment) return;
    this._celebrationSeq = (this._celebrationSeq || 0) + 1;
    this.setData({ celebrationEvent: moment + ':' + this._celebrationSeq });
  },
  leadUnlockFromTools() { this.setData({ sessionToolsOpen: false }, () => this.leadUnlock()); },
  leadVerifyMemberTicketFromTools() { this.setData({ sessionToolsOpen: false }, () => this.leadVerifyMemberTicket()); },
  leadShowGroupCodeFromTools() { this.setData({ sessionToolsOpen: false }, () => this.leadShowGroupCode()); },
  leadBroadcastFromTools() { this.setData({ sessionToolsOpen: false }, () => this.leadBroadcast()); },
  leadSettleFromTools() { this.setData({ sessionToolsOpen: false }, () => this.leadSettle()); },
  // ---------- 剧情两段式:摘要卡 → 全屏叙事页 ----------
  // 只做外壳:文案与顺序都来自 buildJournal 已经算好的 journalCards / 既有节点数据,
  // 这里不参与排序,更不碰防剧透那套(未解锁段落在 wxml 层就没有展开入口)。
  openStory(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const node = this._nodeById(ds.id) || this._historyNodeById(ds.id);
    if (!node) return;
    this.setData({
      story: {
        show: true,
        title: node.name || '',
        step: ds.step || '',
        cover: node.imgUrl ? String(node.imgUrl).split(',')[0] : '',
        // 节点手记与章节正文同一条规矩:{名字} 在这也要替换(契约 §3.1 的「节点 story」)
        text: applyStoryVars(String(node.description == null ? '' : node.description), this._storyVars),
      },
    });
  },
  closeStory() { this.setData({ 'story.show': false }); },

  // 起飞过场已删除(用户裁决):过场层与其播放/关闭函数族一并退场

  // ---------- 旅程手记(原型 journalScreen:半屏 + 一行行 .kv) ----------
  openJournal() {
    this.setData({ showJournal: true, journalDot: false }, () => {
      this.buildJournal();
    });
  },
  openJournalFromTools() { this.setData({ sessionToolsOpen: false }, () => this.openJournal()); },
  /* 自由探索抽屉两行(原型 x-tools):我的权益 = 这趟已领到的券;
     这个主题是什么 = 主题正文那一屏(mode2 没有章节,openChapterFull 铺的就是主题介绍)。 */
  openRightsFromTools() { this.setData({ sessionToolsOpen: false }, () => this.goCouponWallet()); },
  openThemeFromTools() { this.setData({ sessionToolsOpen: false }, () => this.openChapterFull()); },

  /* 自由探索的地图模式(原型 x-run):把卡包让开,露出本页本来就有的地图台、读数卡与底栏 ——
     它们原先被 mode!=2 一律关掉。地图那套是按城市定向写的,自由探索只借它的「看」,
     不借「一场会话」:所以底栏没有中键(原型 freeBar 的原话)。 */
  closeJournal() { this.setData({ showJournal: false }); },

  // FE-19 入场码:动态核销码,5 分钟有效,过期重开即重签发。
  // 拆两层(用户裁决:核销≠优惠券页):ensureTicket 只取码;展示层各自决定开哪个面。
  ensureTicket() {
    const that = this;
    if (this.data.isPreview || this.data.isMock) return;             // 预览/mock 不出码
    const regId = this.data.regId;
    if (!regId) { this._explainMissingEntryQr(); return; }
    this.setData({ ticket: { show: this.data.ticket.show, url: '', code: '', loading: true, expiresAt: 0 } });
    req('/api/verify/dyncode/issue', 'POST', { registrationId: regId }).then((res) => {
      if (String(res.code) === '200' && res.data) {
        that.setData({ 'ticket.url': res.data.qrcodeUrl || '', 'ticket.code': res.data.code || '', 'ticket.loading': false, 'ticket.expiresAt': res.data.expiresAt || 0 });
      } else {
        that.setData({ 'ticket.loading': false });
        const msg = (res && res.msg) ? res.msg : '入场码生成失败';
        app.tips ? app.tips(msg) : cyToast(msg);
      }
    });
  },
  /** 优惠券页:只属于优惠券 —— 目标节点没配券就不开这页(没有「入场」兜底票)。
   *  入口在详情卡券行:目标节点 = 详情卡正开着的那个。 */
  openTicketFromSheet() {
    this._voucherNode = (this.data.sheet && this.data.sheet.node) || null;
    this.openVoucher();
  },

  // ================= v5.1/v5.2 新玩法(Figma 组件库 v5.1 node 45:248 / v5.2 node 64:304)=================
  // 玩法数据整块由服务端在节点上下发(node.playKit)。没下发时入口行和弹窗都不渲染,
  // 所以这套 UI 对既有节点是纯增量,不需要额外开关,也不会把没有玩法的站点变成有玩法。
  /** cy-advanced-game 每次拿到权威视图都会抛上来;v5.1 新玩法的 sheet 由本页渲染
   *  (那些壳是独立 sheet,套不进面板自己那层 sheet)。 */
  onAdvancedSession(e) {
    const view = e.detail || {};
    // 故事变量随权威会话视图一起下来(契约 §3.1):{名字} 的取值 = profile 答案 + 已完成 kit 的结果,
    // 由服务端拼成 map。与 /api/play/nodes 那份走同一套合并口径(见 _mergeStoryVars)。
    this._mergeStoryVars(view.vars);
    /* profile 提交成功后必须重拉一次 nodes:页面级 nodes 是读一次的快照,刚填的名字不会自己
       回到 _storyVars 里,章节里就还是 {name}。只认这一条上升沿,后续每个会话视图不重拉。 */
    const profileDone = !!(view.playKit && view.playKit.profile && view.playKit.profile.done);
    if (profileDone && !this._profileStoryVarsRefreshed) {
      this._profileStoryVarsRefreshed = true;
      this._refreshStoryVarsFromNodes();
    }
    const previous = this._kit();
    /* 拍物成卡那一屏的「地点」:会话视图里只有 nodeId,主题名与节点名在本页手里 */
    const placeNode = this.data.advancedPlay && this.data.advancedPlay.node;
    const placeName = [this.data.topicName, placeNode && placeNode.name].filter(Boolean).join(' · ');
    const picked = pickPlayKit(Object.assign({}, view, { placeName }), new Date());
    const kit = dailySignRevealState(previous, picked);
    if (!kit) { this.setData({ playKit: { show: false, kit: null } }); return; }
    /* 内嵌(契约 §1.5):不弹整屏那一层 —— 它已经长在故事流里了(见 openChapterFull 的
       kind:'kit' 段)。show 关掉、kit 留着,那一块绑的就是它。整屏 / 缺字段照旧。 */
    const inline = kit.present === 'inline';
    this.setData({ playKit: { show: !inline, kit } });
    /* 故事流正开着:就地补一块,别让玩家退出重进才看见。只认「还没铺过」这一条上升沿,
       否则每次会话视图(每个动作都来一次)都会重铺整章、把滚到一半的位置弹回开头。 */
    if (inline && this.data.chapterFull
        && !(this.data.chapterParas || []).some((p) => p.kind === 'kit')) {
      this.openChapterFull();
    }
  },

  /**
   * 两个来源的合并口径(契约 §3.1 的 vars 只有一个真源,但有两处回包):
   *   · 只认非空对象 —— 服务端取不到时整块不下发,空值/缺失**绝不能**把已有值清掉;
   *   · 逐键合并,新回包的键覆盖旧值(每份都是服务端当时的完整快照,新的更接近现在);
   *   · 两份各有的键都留着 —— 会话视图带 kit 结果,nodes 带 profile 答案,谁都不是全集。
   */
  _mergeStoryVars(vars) {
    if (!isRecord(vars) || !Object.keys(vars).length) return false;
    this._storyVars = Object.assign({}, this._storyVars || {}, vars);
    return true;
  },

  /** loadData/刷新回包 → vars。只做提取与合并,不重渲染(重渲染由调用点决定)。 */
  _applyStoryVars(payload) {
    return this._mergeStoryVars(payload && payload.vars);
  },

  /** profile 提交成功后的补拉:只取 vars,不重跑 loadData(那会把首屏/章节/角色卡整套重演一遍)。 */
  _refreshStoryVarsFromNodes() {
    if (this.data.isPreview || this.data.isMock) return;
    if (!this.data.activityId && !this.data.topicId) return;
    req('/api/play/nodes', 'GET', this._sessionParams()).then((res) => { // 补拉
      if (!(res.code == 200 || res.code == '200') || !res.data) return;
      if (!this._applyStoryVars(res.data)) return;
      // 章节屏正开着就地重铺一次,让刚填的名字立刻显形(measureChapter 会重新量几何)
      if (this.data.chapterFull) this.openChapterFull();
    }).catch(() => {});
  },

  closePlayKit() {
    this._stopPlayKitAudio();
    this.setData({ 'playKit.show': false });
    const kit = this._kit();
    if (kit.mode === 'd20' && kit.present === 'inline' && kit.result) this.closeChapterFull();
  },

  /** 当前打开的玩法数据;没开玩法时给空对象,让调用方少写一遍空值判断 */
  _kit() { return (this.data.playKit && this.data.playKit.kit) || {}; },

  /** 该铺进故事流的那个内嵌 kit(契约 §1.5);不是内嵌 / 没有玩法 → null。
   *  呈现方式逐字读服务端会话视图的 present(pickPlayKit 搬进来):默认表只在服务端一份,
   *  客户端不重推 —— 字段缺失时按 fullscreen,存量模板行为逐字不变。 */
  _inlineKit() {
    const kit = this._kit();
    return kit.present === 'inline' ? kit : null;
  },

  /** 服务端在照片回执里给了 AI 参考分,就把它挂到这个节点上。
   *  稿写明「最终以商家审核为准」——所以它不参与完成判定,只是回看这一站时的参考。
   *  没给分就没有这张卡,不造一个占位分。 */
  _applyAiScore(nodeId, data) {
    const ai = data && data.aiScore;
    if (!ai || !(Number(ai.score) > 0)) return;
    const card = {
      score: Number(ai.score),
      comment: ai.comment || '',
      note: ai.note || '最终以商家审核为准',
    };
    const patch = (n) => (n.nodeId === nodeId ? Object.assign({}, n, { aiScore: card }) : n);
    if (this._routeNodeCatalog) this._routeNodeCatalog = this._routeNodeCatalog.map(patch);
    // 两次字面量 setData 而不是拼一个动态对象:U4 门禁静态核对顶层字段消费,
    // 动态键名它判不了,只能进基线债 —— 这里本来就只有两个固定字段,不值当欠那笔。
    this.setData({ nodes: this.data.nodes.map(patch) });
    // 卡正开着这一站时同步一份,否则要等下次打开才看得到
    if (this.data.sheet && this.data.sheet.node && this.data.sheet.node.nodeId === nodeId) {
      this.setData({ 'sheet.node.aiScore': card });
    }
  },

  onPlayKitAction(e) {
    const evt = e.detail || {};
    const detail = evt.detail || {};
    switch (evt.action) {
      // 纯本地:关闭 / 改草稿 / 切筛选 / 播放器 —— 这些没有服务端可裁决的东西
      case 'close':
      case 'requestclose':
        this.closePlayKit();
        return;
      case 'namechange':
        this.setData({ 'playKit.kit.value': detail.value || '' });
        return;
      case 'toggle':
      case 'audio':
        // 听音答题(qa)与扫码语音回复(scan)的播放按钮抛的是 'audio',
        // 音乐角抛 'toggle' —— 两个名字同一件事,以前只有 toggle 有人接。
        this._togglePlayKitAudio(!!detail.playing);
        return;
      case 'open':
        // 时段限定到点:组件不自己开门(本地时钟不是权威),回 /state 问一次,
        // 权威视图回来后重新 pickPlayKit —— 门真开了就会弹该节点真正的玩法。
        { const adv = this.selectComponent('#advancedGame');
          if (adv) adv.refreshState(); }
        return;
      case 'giveup':
        // 沉默点单裁决为「不判定通关」(mechanicsReady 注释),认输没有服务端可记,
        // 收尾这一屏就是它的全部语义 —— 以前它掉进 default 被静默吞掉。
        this.closePlayKit();
        return;
      case 'subscribe':
        this._subscribePlayKit();
        return;
      case 'slowstart':
      case 'slowclaim':
        // 跨日任务的开始与领取都要服务端裁决(日期在服务端算),走同一条委托通道
        this._submitPlayKitAction(evt.action, detail);
        return;
      default:
        // 其余都是要服务端裁决的(作答/提交/认输/刷新/收签/CTA)
        this._submitPlayKitAction(evt.action, detail);
    }
  },

  /**
   * 需要服务端裁决的动作:统一委托 cy-advanced-game 发。
   * 不在本页自己拼请求 —— 幂等键、CAS 版本、unknown 回读那一整套都在组件里,
   * 页面再发一份就会和组件的 version 漂移,漂移之后每次提交都撞"状态已更新"。
   */
  _submitPlayKitAction(action, detail) {
    const kit = this._kit();
    /* 拍照问答(qa:shoot)不在服务端动作表里(playkit-view 明确注释:放进去会被当成一步直发,
       而组件手里只有出了手机就不存在的临时路径)。所以必须在 serverAction 门禁**之前**分派,
       否则被 `if (!name) return` 拦成死分支 —— 玩家拍完照既不报错也永远不提交。
       ⚠️ 同时必须限定 qa:shoot 只有 qa 组件是合法来源(scan 等其它 kit 不发 shoot),
       否则伪造一个 shoot 就能绕过类型门禁直接走照片上传/提交。
       《预制人生》的 photoCheck 与建档头像是同一条路:拍/选之后先上传,再提交或写回 kit。 */
    if (action === 'shoot') {
      if (kit.type === 'qa') this._submitKitPhoto(detail, {});
      else if (kit.type === 'photocheck') {
        // 判定全在服务端(契约 §2.2):只报图片地址。客户端本地算分那套已删,别把 score 塞回来
        this._submitKitPhoto(detail, {
          name: 'SUBMIT_PHOTO_CHECK',
          payload: (url) => ({ imageUrl: url }),
        });
      }
      return;
    }
    if (action === 'avatar') {
      if (kit.type === 'profile') this._submitKitPhoto(detail, { avatar: true });
      return;
    }
    const name = serverAction(kit.type, action);
    if (!name) return;                       // 不在册的动作一律不发
    /* 计步:walk 屏发的是 sync(同步微信运动)与 claim(走够了落章),都要走
       wx.login → getWeRunData 拿密文这条路,不能直接 action 空手发。
       ⚠️ 早先只认 'refresh'(旧 steps 屏的事件名)—— 换屏之后那两个动作会掉进
       下面的通用分支,发出去一个没有 encryptedData 的 SUBMIT_STEPS,服务端解不开。 */
    if (kit.type === 'walk' || action === 'refresh') { this._submitSteps(); return; }
    /* 拍照问答:照片得先上传拿到地址,再连地址一起提交。
       组件手里只有临时路径 —— 那个路径出了这台手机就不存在,发给服务端等于发了个空。 */
    if (action === 'shoot') { this._submitQaPhoto(detail); return; }
    const game = this.selectComponent('#advancedGame');
    if (!game) { cyToast('玩法未就绪，请退出后重进'); return; }
    /* payload 要过一次翻译:组件按玩家看到的东西命名,服务端按判定要用的东西命名。
       直接把 detail 发过去,服务端读不到字段会按 0 判 —— 不报错,只是永远不通过。 */
    game.action(name, serverPayload(kit.type, action, detail));
  },

  /**
   * 拍照族的两步走:先上传,再提交地址(qa 拍照题 / photoCheck / 建档头像共用这一条)。
   *
   * <p>两步都可能失败,而且要分开说:上传失败是「照片没传上去」,提交失败是「传上去了但没记上」。
   * 合成一句「提交失败」的话,玩家不知道要不要重拍。
   *
   * <p>cfg.name 给服务端动作名与 payload 组装;cfg.avatar 为真时不发动作,只把地址写回 kit ——
   * 头像在「提交登记」那一步才随 answers 一起走。
   */
  /** 拍物成卡那一屏在等结果:告诉它这一张没交上去,回到取景(页面计数单调递增,组件只认比见过的大)。 */
  _notifyPhotoFail() {
    const kit = this._kit();
    if (!kit || kit.type !== 'photocheck' || kit.mode !== 'CARD') return;
    this._photoFailSeq = (this._photoFailSeq || 0) + 1;
    this.setData({ 'playKit.kit.photoFailSeq': this._photoFailSeq });
  },

  /** 玩法组件说「这一步没提交成功」(被拒 / 状态已更新 / 回读说没写进去 / 回读也失败)。
   *  只有拍照提交会让那一屏在转圈等,别的动作失败由玩法组件自己的错误提示收尾。 */
  onAdvancedActionFail(e) {
    const action = e && e.detail && e.detail.action;
    if (action === 'SUBMIT_PHOTO_CHECK') this._notifyPhotoFail();
  },

  _submitKitPhoto(detail, cfg) {
    const path = (detail && detail.tempFilePath) || '';
    if (!path) return;
    const option = cfg || {};
    const game = this.selectComponent('#advancedGame');
    const kitNow = this._kit();
    /* 拍物成卡那一屏自己有「处理中」,不再盖全屏 loading;失败时那一屏收不到回包,
       要靠 kit.photoFailSeq 通知它回到取景(页面计数单调递增,组件只认比见过的大)。 */
    const cardMode = !!(kitNow && kitNow.type === 'photocheck' && kitNow.mode === 'CARD');
    const fail = (msg) => {
      cyToast(msg);
      if (cardMode) this._notifyPhotoFail();
    };
    if (!game) { fail('玩法未就绪，请退出后重进'); return; }
    // 双击锁:同一次拍照上传在途时再收到 shoot 直接忽略,避免起第二个必被 advanced-game 静默丢掉的请求。
    if (this._kitPhotoUploading) return;
    const kit = this._kit();
    const state = (game.data && game.data.state) || null;
    const sameVersion = (a, b) => a != null && b != null && String(a) === String(b);
    if (!state || !state.sessionId || !kit.sessionId
        || state.sessionId !== kit.sessionId || !sameVersion(state.version, kit.version)) {
      fail('玩法状态不完整，请重进节点');
      return;
    }
    /* ★ 业务身份 + 题目版本隔离:照片是异步上传的,回来时必须仍是**同一 session、同一版本**
       (页面 kit 与 advanced-game 权威 state 都要对得上)。否则玩家在同一页面切到别的节点/会话后,
       旧回包会经 game.action 把上一题的照片提交到下一题/下一个会话。 */
    this._kitPhotoUploading = true;
    /* ★ 绑页面生命周期:上传中途玩家返回的话,不绑会留下三样东西 ——
       转不掉的遮罩、取消不了的请求、对着已销毁组件调的 game.action。
       写法与 app.js 里既有的两处上传一致(attach + isAborted 双守卫)。 */
    const operation = app.createPageBoundOperation();
    operation.onAbort(() => { this._kitPhotoUploading = false; if (!cardMode) cyLoading.hide(); });
    if (!cardMode) cyLoading.show('正在上传');
    operation.attach(app.getUploadClient().uploadAll([path], {
      // 组件拍照回调带了真实 size 就交给共享入口按生产 10MB 预检:超限不发起 wxUploadFile,
      // 直接给「压缩/换文件」可操作文案;size 未知(旧组件/拿不到)按 undefined 放行,由服务端拦截。
      fileSizes: [detail && detail.size],
      onDone: (r) => {
        this._kitPhotoUploading = false;
        if (operation.isAborted()) return;
        operation.finish();
        if (!cardMode) cyLoading.hide();
        const url = r && r.ok && r.results && r.results[0];
        if (!url) {
          fail((r && r.failures && r.failures[0] && r.failures[0].msg) || '照片没传上去');
          return;
        }
        const currentGame = this.selectComponent('#advancedGame');
        const currentState = currentGame && currentGame.data && currentGame.data.state;
        const currentKit = this._kit();
        const sameQuestion = currentState && currentState.sessionId === state.sessionId
          && sameVersion(currentState.version, state.version)
          && currentKit.sessionId === state.sessionId
          && sameVersion(currentKit.version, state.version);
        if (!sameQuestion) {
          fail('题目已变化，上一张照片未提交');
          return;
        }
        // advanced-game 正在 acting/unknown 时会静默 no-op:这里不装成功,给一句可恢复的实话。
        if (currentGame.data.acting || currentGame.data.unknown) {
          fail('确认中，照片未提交，请稍后再试');
          return;
        }
        if (option.avatar) { this.setData({ 'playKit.kit.avatarUrl': url }); return; }
        // cfg 缺省 = qa 拍照题那条老路(不带 name/payload 时按它提交),历史行为逐字不变
        const actionName = option.name || 'SUBMIT_QA';
        const payload = option.payload ? option.payload(url) : { imageUrl: url };
        currentGame.action(actionName, payload);
      },
    }));
  },

  // ================= R14 旅程检定(入口在 encounter.allowedActions,不在 playKit) =================
  /**
   * 节点卡打开时问一次 encounter:服务端只在「已到店 && 未锁定 && 该节点旅程块 check.enabled」
   * 时才把 'check' 放进 allowedActions —— 未到店时这里拿到的是空数组,不弹任何东西。
   * ⚠️ 探测失败一律静默:检定不是通关闸,探测不成功不该打断任何已有路径(打卡/任务/导航都不受影响)。
   */
  _probeJourneyCheck(node) {
    if (this.data.isPreview || this.data.isMock || !node || node.done) return;
    if (!this.data.topicId) return;   // encounter 只吃 topicId(活动会话与自玩都有)
    const current = this.data.journeyCheck;
    if (current.show && current.nodeId === node.nodeId) return;
    const epoch = (this._checkProbeEpoch || 0) + 1;
    this._checkProbeEpoch = epoch;
    req('/api/play/encounter', 'GET', { topicId: this.data.topicId, nodeId: node.nodeId }).then((r) => {
      if (epoch !== this._checkProbeEpoch) return;
      if (!(r.code == 200 || r.code == '200') || !r.data) return;
      const kit = pickJourneyCheck(r.data);
      if (!kit) return;
      this.setData({ journeyCheck: Object.assign({ show: true, nodeId: node.nodeId, receipt: null }, kit) });
    }).catch(() => {});
  },

  /** 上局已结算过:掷骰会被拒,而 settle 是幂等的 —— 回读那份回执补上最终文案,别把玩家卡在掷不了 */
  _recoverSettledCheck(payload) {
    req('/api/play/check/settle', 'POST', payload).then((r) => {
      if ((r.code == 200 || r.code == '200') && r.data) {
        this.setData({ 'journeyCheck.receipt': checkReceiptView(r.data) });
        return;
      }
      cyToast('这次检定已经结算过了');
    });
  },

  onJourneyCheckAction(e) {
    const action = (e.detail && e.detail.action) || '';
    const kit = this.data.journeyCheck;
    if (!kit.show || !kit.checkId || this._checkActing) return;
    const payload = { topicId: this.data.topicId, nodeId: kit.nodeId, checkId: kit.checkId };
    this._checkActing = true;
    // 触感在组件里(掷/结算各一次);这里只管请求与把回执搬进视图。
    // ⚠️ 三条路径各写各的字面 URL:U1 门禁要能枚举出所有 /api 端点,把 URL 包成参数它认不出。
    if (action === 'roll') {
      req('/api/play/check/roll', 'POST', payload).then((r) => this._afterCheck('roll', r, payload));
      return;
    }
    if (action === 'reroll') {
      req('/api/play/check/reroll', 'POST', payload).then((r) => this._afterCheck('reroll', r, payload));
      return;
    }
    if (action === 'settle') {
      req('/api/play/check/settle', 'POST', payload).then((r) => this._afterCheck('settle', r, payload));
      return;
    }
    this._checkActing = false;
  },

  /** 检定回包的统一落点:成功搬回执;「已结算」用幂等 settle 回读;其余给可恢复提示。 */
  _afterCheck(action, r, payload) {
    this._checkActing = false;
    const res = r || {};
    const ok = res.code == 200 || res.code == '200';
    const FAIL = { roll: '掷骰没成功，再试一次', reroll: '重掷没成功，再试一次', settle: '结算没成功，再试一次' };
    if (ok && res.data) { this.setData({ 'journeyCheck.receipt': checkReceiptView(res.data) }); return; }
    if (action === 'roll' && /已结算/.test(res.msg || '')) { this._recoverSettledCheck(payload); return; }
    cyToast(res.msg || FAIL[action] || '操作没成功，再试一次');
  },

  /** 检定屏退出。结算前后都能关 —— 失败也推进是产品口径,这里不设任何通关闸。 */
  closeJourneyCheck() { this.setData({ 'journeyCheck.show': false }); },

  /**
   * 计步提交。微信运动只给密文,而且**必须先 wx.login 再 getWeRunData**
   * (session_key 要新鲜,否则服务端解不开)—— 这个顺序不能调换。
   * 前端不解密也不上报步数本身,只把密文原样转交。
   */
  _submitSteps() {
    const game = this.selectComponent('#advancedGame');
    if (!game) { cyToast('玩法未就绪，请退出后重进'); return; }
    wx.login({
      success: (login) => {
        if (!login || !login.code) { cyToast('微信登录态获取失败'); return; }
        wx.getWeRunData({
          success: (run) => game.action('SUBMIT_STEPS', {
            code: login.code, encryptedData: run.encryptedData, iv: run.iv,
          }),
          fail: () => cyToast('需要授权微信运动才能计步'),
        });
      },
      fail: () => cyToast('微信登录态获取失败'),
    });
  },
  /** 治愈音乐角:音频归页面持有,弹窗收起后还能继续放(这一站的玩法就是"听完") */
  _togglePlayKitAudio(shouldPlay) {
    const kit = this._kit();
    if (!kit.audioUrl) { cyToast('这一站还没有配曲目'); return; }
    if (!this._kitAudio) {
      this._kitAudio = wx.createInnerAudioContext();
      this._kitAudio.onTimeUpdate(() => {
        this.setData({
          'playKit.kit.position': Math.floor(this._kitAudio.currentTime || 0),
          'playKit.kit.duration': Math.floor(this._kitAudio.duration || 0),
        });
      });
      this._kitAudio.onEnded(() => {
        // 只收播放态:音乐角明确**不判定通关**(2026-08-26 拍板,utils/playkit-view.js:318)。
        // 这里原来还跟一句 _submitPlayKitAction('finished'),但 ACTION_OF 没有 musiccorner:finished,
        // 组件也只发 toggle/close —— 那是一次谁也收不到的空提交(审查 #24)。
        this.setData({ 'playKit.kit.playing': false });
      });
      this._kitAudio.onError(() => {
        this.setData({ 'playKit.kit.playing': false });
        cyToast('曲目播放失败');
      });
    }
    if (shouldPlay) {
      if (this._kitAudio.src !== kit.audioUrl) this._kitAudio.src = kit.audioUrl;
      this._kitAudio.play();
    } else {
      this._kitAudio.pause();
    }
    this.setData({ 'playKit.kit.playing': shouldPlay });
  },

  _stopPlayKitAudio() {
    if (!this._kitAudio) return;
    this._kitAudio.stop();
    this.setData({ 'playKit.kit.playing': false });
  },


  /** 时段限定玩法的开播提醒:模板 id 由服务端下发,前端不硬编码模板 */
  _subscribePlayKit() {
    const kit = this._kit();
    const tmplId = kit.subscribeTmplId;
    if (!tmplId) { cyToast('提醒暂不可用'); return; }
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        if (res[tmplId] === 'accept') {
          this.setData({ 'playKit.kit.subscribed': true });
          this._submitPlayKitAction('subscribe', { tmplId });
          return;
        }
        cyToast('没有开启提醒');
      },
      fail: () => cyToast('提醒开启失败'),
    });
  },

  openVoucher() {
    const node = this._voucherNode || this.data.nextNode;
    const hasCoupon = (node && node.coupon) || (this._themeReward && this._themeReward.finishCoupon);
    if (!hasCoupon) { cyToast('本站没有优惠券'); return; }
    this._syncVoucherView();
    this.ensureTicket();
    this.setData({ 'voucher.show': true });
  },
  openTicketFromTools() { this.setData({ sessionToolsOpen: false }, () => this.openEntryQr()); },
  closeVoucher() { this._voucherNode = null; this.setData({ 'voucher.show': false }); },
  closeFragment() { this.setData({ frag: { show: false, text: '', step: '' } }); },
  buildJournal() {
    const mode = this.data.mode, nodes = this.data.nodes;
    let order = nodes.slice();
    const branch = this._routeState.routeMode === 'BRANCH_GRAPH';
    if (branch) order = orderedJourneyNodes(nodes, this._routeState);
    else if (mode === 1) order.sort((a, b) => a.sortId - b.sortId);
    else {
      // P0 剧情成书:已完成按"我的完成顺序"(doneAt 后端 checkinTime,本地完成即时补),未完成殿后保持防剧透
      const doneArr = nodes.filter((n) => n.done).sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
      order = doneArr.concat(nodes.filter((n) => !n.done));
    }
    const focus = branch ? resolveNextRouteNode(order, this._routeState)
      : (mode === 1 ? order.find((n) => !n.done) : nodes.filter((n) => !n.done)[0]);
    const fpos = focus ? order.findIndex((n) => n.nodeId === focus.nodeId) : order.length;
    const cards = order.map((n, i) => {
      /* 只留 .kv 行真会用到的:key(wx:key)/nodeId(点进全文)/locked(不剧透)/kvK|kvT|kvS。
         gap/scale/ty/blur/opacity/justWrote/canGo 是已删的文字流留下的,一起清掉,
         免得成为「写了没人读」的字段(U4 对计算属性名是盲的,靠它抓不出来)。 */
      const seg = { key: n.nodeId, nodeId: n.nodeId };
      const paras = String(n.description).split('\n');
      if (n.done) {
        // mode=2:标签用"我的第 K 步"(K=完成顺序),路线变成自己的故事线;mode=1 保持原站序
        seg.label = mode === 1 && !branch ? ('第 ' + n.num + ' 站 · 已抵达') : ('我的第 ' + (i + 1) + ' 步 · ' + n.name);
        seg.paras = paras;
      } else if (focus && n.nodeId === focus.nodeId) {
        seg.label = '此刻'; seg.paras = paras;
      } else if (mode === 1) {
        const fr = i - fpos - 1;
        seg.label = '前路未知'; seg.locked = true;
        seg.paras = fr <= 0 ? paras : ['░░░░░░░░░ ░░░░░ ░░░░░░░░ ░░░░'];
      } else {
        seg.label = n.name; seg.paras = ['这一页尚未书写。你的脚步还没抵达这里。'];
      }
      /* 原型 .kv 一行三格:左边一格标签、右边标题与一句。
         label 形如「第 3 站 · 已抵达」/「我的第 2 步 · 昼夜咖啡」—— 按「 · 」劈开正好，
         劈不开(「此刻」「前路未知」)就整句当左格、标题回落到节点名。
         正文只取第一段并夹一行:全文仍在点进去那件半屏里,这儿是目录不是正文。 */
      const parts = String(seg.label || '').split(' · ');
      seg.kvK = parts[0] || '';
      seg.kvT = parts.length > 1 ? parts.slice(1).join(' · ') : (n.name || '');
      seg.kvS = String((seg.paras && seg.paras[0]) || '').slice(0, 40);
      return seg;
    });
    /* 规则16 历史履约:普通下架的已完成站以只读卡片续在手记末尾(完成时间序);
       不参与上面的主线 order/focus/locked 计算,也没有任何挑战/发奖入口。 */
    const historyCards = (this._historyNodes || []).slice()
      .sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0))
      .map((n) => {
        const paras = String(n.description == null ? '' : n.description).split('\n');
        const label = '已下架 · ' + (n.name || '');
        const parts = label.split(' · ');
        return {
          key: 'history-' + n.nodeId,
          nodeId: n.nodeId,
          history: true,
          label,
          paras,
          kvK: parts[0] || '',
          kvT: parts.length > 1 ? parts.slice(1).join(' · ') : (n.name || ''),
          kvS: String(paras[0] || '').slice(0, 40),
        };
      });
    this.setData({
      journalCards: cards.concat(historyCards),
      nextChapterText: this.data.allDone ? '你已写满本章。翻过这一页,新的街巷正在等你。' : '走完本章坐标,下一章的扉页才会在流的尽头显形。'
    });
  },
  /* ⚠️ onJournalTouchMove / onJournalScroll(滚动沉降:越靠屏幕中央越清晰)
     随文字流一起退场 —— 原型的手记是一张静态列表,没有对焦/模糊/缩放这一层。
     它们留下的 _segGeom / _jscroll0 / _jbusy 也一并删掉,免得成为读不到的死状态。
     goToNode(手记行里的「前往此站」)同批退场:同一个动作在节点半屏里还有
     (「去这家 / 我已到达此站」),不是丢了入口。 */

  // ---------- 通关足迹卡 ----------
  loadEnding() {
    if (this.data.mode !== 2 || this.data.isPreview || this.data.isMock) return;
    const that = this;
    this.setData({ endingError: false });
    req('/api/play/ending', 'GET', this._sessionParams()).then((r) => {
      if ((r.code == 200 || r.code == '200') && r.data) {
        const opener = typeof r.data.opener === 'string' ? r.data.opener : '';
        const fragments = Array.isArray(r.data.fragments) ? r.data.fragments : [];
        const hasVisibleContent = opener.trim() !== '' || fragments.some((fragment) => fragment
          && (String(fragment.name || '').trim() !== '' || String(fragment.text || '').trim() !== ''));
        that.setData({ ending: { show: hasVisibleContent, opener, fragments }, endingError: false });
      } else {
        that.setData({ endingError: true });
      }
    }).catch(() => {
      that.setData({ endingError: true });
    });
  },
  retryEnding() { this.loadEnding(); },
  openFinish() {
    // R9-21 + R1:通关是会话终点,不管从哪条入口进来都要走统一收尾 —— 只清快照不置 _runStarted,
    // 离页时会被写回;正在跑的那局也在这一刻停表,不能再被当成「暂停中」恢复。
    this._endRunSession();
    this.loadEnding();
    this.loadNewLifeOS();
    const isShopDay = this.data.mode === 2;
    const recap = buildPlayRecap(this.data.nodes);
    // 探店日:探索值(total×12 写死)与模板勋章数都是经典定向的读数,对 mode2 显示会撒谎;
    // 真读数 = 已核销商户的集章列表 + 主题通关奖励(grantOnce 在最后一次核销时已发)。
    const finishStamps = isShopDay
      ? this.data.nodes.filter((n) => n.done).map((n) => ({ nodeId: n.nodeId, name: n.name })) : [];
    const puzzleSummary = summarizePuzzleScores(this.data.nodes);
    this._finishMedals = this.data.nodes.filter((n) => n.medalName || n.medalImg).length;
    // ⚠️ 别在这里加「通关奖励已发放」行:后端对 FREE_COLLECT 不下发 themeReward(B5 剥离),
    //    前端拿不到真数据,写了就是恒空的死 UI。奖励到账明细归修C后端(grantOnce 结果上凭证面)。
    const earnedXp = (this.data.nodes || []).reduce(function (sum, node) {
      return sum + (node && node.done ? (Number(node.earnedXp) || 0) : 0);
    }, 0);
    this.setData({
      showFinish: true,
      finishScore: earnedXp,
      finishPuzzleScore: puzzleSummary.score,
      finishPuzzleCount: puzzleSummary.count,
      finishPuzzleBest: Number(this._puzzlePersonalBest) || 0,
      finishStamps,
      finishSnap: '', finishSnapError: false,
      finishPhotos: recap.photos,
      canReplayJournal: recap.canReplayJournal,
      // 站末分支图(契约 §3.3):只读本次会话已有的走向记录
      branchPath: this._buildBranchPath(),
      // 主视觉:本次拿到的徽章(有图用图,无图用名字首字);一枚都没有时不硬凑
      finishBadge: this._pickFinishBadge(),
    }, () => {
      this._triggerCelebration(this.data.mode === 2 ? 'free-finish' : 'classic-finish');
      this.paintRouteThumb();   // finish-map 盒内=路线缩略图(全卡仅保存时生成,避免和 HTML 数字行重复)
      this.buildReview();       // B:轨迹回顾层(渐进描线 + 成就气泡 + 用时/距离)
    });
    this.loadMilestone();
    this.loadFinishRouteRecommendation();
  },
  closeFinish() {
    this._hideFinish();
  },
  _hideFinish(callback) {
    if (this._reviewTimer) { clearTimeout(this._reviewTimer); this._reviewTimer = null; }
    this._finishRecommendationEpoch = (this._finishRecommendationEpoch || 0) + 1;
    this.setData({ showFinish: false }, callback);
  },
  openFinishJournal() {
    this._hideFinish(() => this.openJournal());
  },

  loadNewLifeOS() {
    if (this.data.mode !== 2 || this.data.isPreview || this.data.isMock || !this.data.topicId) return;
    const that = this;
    this.setData({ 'newLifeOS.loading': true });
    req('/api/play/os/' + this.data.topicId, 'GET', {}).then((r) => {
      if (!(r.code == 200 || r.code == '200') || !r.data) {
        that.setData({ 'newLifeOS.loading': false, 'newLifeOS.show': false });
        return;
      }
      const d = r.data;
      const anchors = Array.isArray(d.mapAnchors) ? d.mapAnchors : [];
      const cards = Array.isArray(d.resultCards) ? d.resultCards : [];
      const tags = Array.isArray(d.tags) ? d.tags : [];
      that.setData({ newLifeOS: {
        loading: false,
        show: anchors.length > 0 || cards.length > 0 || tags.length > 0,
        tags,
        resultCards: cards,
        mapAnchors: anchors,
        mapNodes: anchors.map((a) => ({ nodeId: a.nodeId, name: a.name, lat: Number(a.latitude), lng: Number(a.longitude), done: true })),
        actions7Days: Array.isArray(d.actions7Days) ? d.actions7Days : [],
        actions30Days: Array.isArray(d.actions30Days) ? d.actions30Days : []
      } });
    });
  },
  revokeOsTag(e) {
    const tagId = e.currentTarget.dataset.id;
    this._osTagWrites = this._osTagWrites || {};
    if (!tagId || this._osTagWrites[tagId]) return;
    this._osTagWrites[tagId] = true;
    const that = this;
    req('/api/play/tag/' + tagId + '/revoke', 'POST', {}).then((r) => {
      delete that._osTagWrites[tagId];
      if (r.code == 200 || r.code == '200') {
        that.setData({ 'newLifeOS.tags': that.data.newLifeOS.tags.filter((tag) => tag.id != tagId) });
      } else cyToast(r.msg || '撤回没有成功');
    });
  },

  // ---------- B 通关轨迹回顾层(2D;3D 旋转版已拍板不做)----------
  // 顺序真源:与 _drawRoute 同一套 —— mode2 按我的真实完成顺序(doneAt),mode1 按 sortId。
  // 只连**已完成**节点:回顾的是"我真的走过的路",没走到的点不该出现在轨迹里
  // (页面平时那条 fmPolyline 是全量节点的路线预览,两者语义不同,故另建一条,不复用)。
  _reviewOrderedNodes() {
    const branch = this._routeState.routeMode === 'BRANCH_GRAPH';
    const free = this.data.mode === 2;
    const src = (this.data.nodes || []).filter((n) => n.done && n.lat && n.lng);
    return branch
      ? orderedJourneyNodes(src, this._routeState)
      : free
      ? src.slice().sort((a, b) => (a.doneAt || 9e15) - (b.doneAt || 9e15))
      : src.slice().sort((a, b) => (a.sortId || 0) - (b.sortId || 0));
  },

  // 成就气泡:每一条都必须由**真实存在的字段**推出来,字段没有就不生成这条气泡
  // (任务书硬要求:别摆假数据)。
  // ⚠️ 一个 marker 只能挂一条 callout,所以必须定优先级 + 让位:
  //    徽章/券是"这个点真发生过的事",优先级高于"最快一段"这种统计结论;
  //    最快一段被占了就顺延到下一段最快的**未占用**节点,而不是被静默盖掉
  //    (2026-08-01 实测踩到:最快的那段正好落在有徽章的点上,气泡被覆盖,整条信息消失)。
  _reviewAchievements(ordered) {
    const tag = {};
    if (!ordered.length) return tag;
    // ① 节点自身事实:徽章 > 券
    ordered.forEach((n) => {
      if (n.medalName) tag[n.nodeId] = '徽章 · ' + n.medalName;
      else if (n.couponId) tag[n.nodeId] = '到店券 · 已领';
    });
    // ② 最快一段:两端 doneAt 都是真值才算(否则 doneAt=0 会造出"0 秒最快段");
    //    按间隔升序找第一个还没被占用的节点
    const segs = [];
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1], cur = ordered[i];
      if (!prev.doneAt || !cur.doneAt) continue;
      const gap = cur.doneAt - prev.doneAt;
      if (gap > 0) segs.push({ gap, node: cur });
    }
    segs.sort((a, b) => a.gap - b.gap);
    const seg = segs.find((x) => !tag[x.node.nodeId]);
    if (seg) {
      const mm = Math.floor(seg.gap / 60000), ss = Math.round((seg.gap % 60000) / 1000);
      tag[seg.node.nodeId] = '最快一段 · ' + (mm ? mm + '分' : '') + ss + '秒';
    }
    // ③ 首达:最后补,同样只在该点还空着时给 —— 徽章/最快段都比"第一个到"更具体
    if (!tag[ordered[0].nodeId]) tag[ordered[0].nodeId] = '首达 · ' + (ordered[0].name || '第一站');
    return tag;
  },

  // 总距离:相邻已完成点的球面距离累加。少于 2 个点算不出来 ⇒ 返回 ''(那一格整格不渲染)
  _reviewDistanceKm(ordered) {
    if (ordered.length < 2) return '';
    const R = 6371, rad = (d) => d * Math.PI / 180;
    let km = 0;
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i];
      const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
      km += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    return km >= 10 ? km.toFixed(0) : km.toFixed(1);
  },

  // 渐进描线:把"我真正走过的那条"一段一段叠到 fmPolyline 上,做出轨迹逐渐展开的感觉。
  // ⚠️ 不动 fmPolyline[0](全量路线)—— play-ui-contract 的既有契约要求完成卡展示**完整路径**,
  //   回顾是在它之上加一层高亮,不是把它换掉。关掉动效偏好时一次画完,不做假动画。
  _startReviewDraw(ordered) {
    if (this._reviewTimer) { clearTimeout(this._reviewTimer); this._reviewTimer = null; }
    const base = (this._reviewBase || []).map((seg) => Object.assign({}, seg, {
      color: '#FFFFFF3A', width: 4, borderWidth: 0, arrowLine: false, dottedLine: true,
    }));
    const pts = ordered.map((n) => ({ latitude: n.lat, longitude: n.lng }));
    if (pts.length < 2) { this.setData({ fmPolyline: base.length ? base : this._reviewBase }); return; }
    const layers = (upto) => base.concat([
      // 原生 map 的 polyline 没有 shadow/glow,发光只能用"加粗半透明垫一层"叠出来
      { points: pts.slice(0, upto), color: '#FFFFFF33', width: 14, borderWidth: 0 },
      { points: pts.slice(0, upto), color: '#FFFFFFEE', width: 5, borderColor: '#00000055', borderWidth: 1, arrowLine: this.data.mode !== 2 },
    ]);
    if (this.data.reducedMotion) { this.setData({ fmPolyline: layers(pts.length) }); return; }
    let i = 2;
    const step = () => {
      this.setData({ fmPolyline: layers(i) });
      i += 1;
      if (i <= pts.length) this._reviewTimer = setTimeout(step, 260);
      else this._reviewTimer = null;
    };
    step();
  },

  /** 站末分支图(契约 §3.3):只读本次会话已有的选择历史,画「你走过的路」。
   *  数据 = _routeState.decisionLog(后端路线引擎按走向写的那份)+ 页面已有的节点名。
   *  ⚠️ 不自己造后端字段:没有记录(不是分支模式 / 没走过)就返回空数组,整块不渲染 ——
   *     不用「当前节点」硬凑一条假路线,那是拿猜的东西冒充走过的事实。
   *  ⚠️ 别人的比例契约里已后置,这里不做。 */
  _buildBranchPath() {
    const state = normalizeRouteState(this._routeState);
    if (state.routeMode !== 'BRANCH_GRAPH') return [];
    const nameOf = (id) => {
      const node = (this.data.nodes || []).find((n) => n && String(n.nodeId) === String(id));
      return node ? (node.name || '') : '';
    };
    const rows = [];
    state.decisionLog.forEach((entry) => {
      if (!entry || entry.fromNodeId == null || entry.toNodeId == null) return;
      rows.push({
        key: String(entry.edgeId || (rows.length + ':' + entry.toNodeId)),
        from: nameOf(entry.fromNodeId),
        to: nameOf(entry.toNodeId),
        at: entry.at ? formatDayDots(entry.at) : '',
      });
    });
    return rows;
  },

  buildReview() {
    const ordered = this._reviewOrderedNodes();
    const tags = this._reviewAchievements(ordered);
    // 成就气泡挂到既有 fmNodes 上(节点 pin 全部保留),没有成就的节点 reviewLabel 为空 = 原样显示序号
    const fmNodes = (this.data.fmNodes || []).map((n) => Object.assign({}, n, { reviewLabel: tags[n.nodeId] || '' }));
    const sec = this._sessionClock ? this._sessionClock.elapsedSeconds() : 0;
    if (!this._reviewBase) this._reviewBase = (this.data.fmPolyline || []).slice();
    this.setData({
      fmNodes,
      reviewElapsed: sec > 0 ? formatElapsed(sec) : '',
      reviewDistance: this._reviewDistanceKm(ordered),
      reviewEmpty: ordered.length === 0,
    });
    this._startReviewDraw(ordered);
  },

  // 主视觉徽章:优先本次真正拿到的那一枚(有图优先),一枚都没有时返回 null ⇒ 回落到路线缩略图,
  // 不造一个假徽章占位。
  _pickFinishBadge() {
    const got = (this.data.nodes || []).filter((n) => n.medalName || n.medalImg);
    if (!got.length) return null;
    const withImg = got.find((n) => n.medalImg) || got[0];
    const name = withImg.medalName || '专属徽章';
    return { img: withImg.medalImg || '', name: name, initial: name.slice(0, 2), count: got.length };
  },

  // ---------- C 结束分享:里程碑轴 ----------
  // 档位数字必须是真的:累计完成主题数取 /api/play/my-completed(成长中心同一条只读接口),
  // 按 topicId 去重 —— 与 utils/growth-overview.js 的 completedTopicCount 同口径。
  // ⚠️ 拿不到就整条轴不渲染(milestone=null),不拿本章数据冒充累计、也不填 0 凑一个「第 1 档」。
  //   这条与成长中心「失败不把数据伪装为零」的既有约定一致。
  loadFinishRouteRecommendation() {
    const requestEpoch = (this._finishRecommendationEpoch || 0) + 1;
    this._finishRecommendationEpoch = requestEpoch;
    this.setData({ finishRouteRecommendation: null });
    if (!finishRouteRecommendation.isEnabled(app.globalData && app.globalData.features)
        || this.data.isPreview || this.data.isMock) return Promise.resolve(null);
    const origin = finishRouteRecommendation.resolveOrigin(this._loc, this.data.nodes);
    if (!origin) return Promise.resolve(null);
    return req('/api/activity/list', 'POST', {
      is_my: 0,
      sort_type: 1,
      pageNum: 1,
      pageSize: 5,
      longitude: origin.longitude,
      latitude: origin.latitude
    }).then((response) => {
      if (requestEpoch !== this._finishRecommendationEpoch || !this.data.showFinish) return null;
      const rows = response && response.code == 200 && response.data && response.data.rows;
      const card = finishRouteRecommendation.pickCandidate(
        Array.isArray(rows) ? rows : [], this.data.activityId, this.data.topicId
      );
      this.setData({ finishRouteRecommendation: card }, () => {
        if (!card || requestEpoch !== this._finishRecommendationEpoch || !this.data.showFinish) return;
        analytics.track('finish_route_recommendation_shown', {
          bizType: 'activity', bizId: card.id,
          properties: { mode: this.data.mode, placement: 'play_finish' }
        });
      });
      return card;
    });
  },

  goFinishRouteRecommendation() {
    const card = this.data.finishRouteRecommendation;
    finishRouteRecommendation.openCandidate(card, {
      mode: this.data.mode,
      track: analytics.track,
      openScene: (id, params) => this.openScene(id, params)
    });
  },

  loadMilestone() {
    this.setData({ milestone: null });
    app.sendRequest({
      url: '/api/play/my-completed', method: 'POST', hideLoading: true, silentError: true,
      success: (res) => {
        const ok = res && (res.code === 200 || res.code === '200');
        if (!ok || !Array.isArray(res.data)) return;      // 保持 null,轴不出现
        const ids = {};
        res.data.forEach((it) => {
          const id = it && it.topicId;
          if (id != null && id !== '') ids[String(id)] = true;
        });
        this.setData({ milestone: buildMilestone(Object.keys(ids).length) });
      },
    });
  },

  // ---------- P1 足迹卡:盒内路线缩略图 + 保存用全卡(AD 风格) ----------
  // 共享的路线绘制:把节点(lat/lng)归一化画进 (bx,by,bw,bh) 框(线 + done 实心/未完成描边)
  _drawRoute(g, nodes, bx, by, bw, bh) {
    // P1 自由定向分享卡:按"我的完成顺序"连线+标序号(每个人路径不同=个性化传播点);mode1 保持 sortId 序
    const free = this.data.mode === 2;
    const src = (nodes || []).filter((n) => n.lat && n.lng);
    const branch = this._routeState.routeMode === 'BRANCH_GRAPH';
    const ordered = branch
      ? orderedJourneyNodes(src, this._routeState)
      : free
      ? src.slice().sort((a, b) => (a.doneAt || 9e15) - (b.doneAt || 9e15))
      : src.slice().sort((a, b) => (a.sortId || 0) - (b.sortId || 0));
    const pts = ordered.map((n) => ({ x: n.lng, y: -n.lat, done: n.done })); // 纬度取负,越大越靠上
    if (!pts.length) return;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    pts.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    const pad = 40;
    const s = Math.min((bw - pad * 2) / Math.max(1e-9, maxX - minX), (bh - pad * 2) / Math.max(1e-9, maxY - minY));
    const ox = bx + pad + (bw - pad * 2 - (maxX - minX) * s) / 2, oy = by + pad + (bh - pad * 2 - (maxY - minY) * s) / 2;
    const P = (p) => ({ x: ox + (p.x - minX) * s, y: oy + (p.y - minY) * s });
    const linePts = free ? pts.filter((p) => p.done) : pts; // 自由定向只连走过的路
    g.strokeStyle = PLAY_STORY_CARD.accent; g.lineWidth = 5; g.lineJoin = 'round'; g.beginPath();
    linePts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); });
    g.stroke();
    let seq = 0;
    pts.forEach((p) => {
      const q = P(p); g.beginPath(); g.arc(q.x, q.y, free && p.done ? 13 : 9, 0, 7);
      if (p.done) {
        g.fillStyle = PLAY_STORY_CARD.accent; g.fill();
        if (free) {
          seq += 1;
          g.fillStyle = PLAY_STORY_CARD.ring; g.font = '600 13px Menlo, monospace';
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(seq), q.x, q.y);
        }
      }
      else { g.fillStyle = PLAY_STORY_CARD.surface; g.fill(); g.strokeStyle = PLAY_STORY_CARD.line; g.lineWidth = 2; g.stroke(); }
    });
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; // 还原,别影响后续 fillText
  },
  _rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  },
  // 盒内路线缩略图 → finishSnap(仅路线,数字由 HTML finish-stat 负责,不重复)
  paintRouteThumb() {
    const that = this;
    wx.createSelectorQuery().select('#snapcv').fields({ node: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) { that.setData({ finishSnapError: true }); return; }
      const cv = res[0].node;
      const W = 690, H = 320, dpr = 2;
      cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = PLAY_STORY_CARD.surface; that._rr(g, 0, 0, W, H, 24); g.fill();
      that._drawRoute(g, that.data.nodes || [], 0, 0, W, H);
      wx.canvasToTempFilePath({
        canvas: cv, destWidth: W * dpr, destHeight: H * dpr,
        success(r) { that.setData({ finishSnap: r.tempFilePath, finishSnapError: false }); },
        fail() { that.setData({ finishSnapError: true }); }
      });
    });
  },
  retryRouteThumb() {
    this.setData({ finishSnapError: false }, () => this.paintRouteThumb());
  },
  // 保存/分享用全卡(眉标+衬线题+路线+三列大数字+带领行+品牌脚);回调拿临时路径,不占 finishSnap
  paintFinishCard(cb) {
    const that = this;
    wx.createSelectorQuery().select('#snapcv').fields({ node: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) { cb && cb(''); return; }
      const cv = res[0].node;
      const W = 750, H = 1000, dpr = 2;
      cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = PLAY_STORY_CARD.page; g.fillRect(0, 0, W, H);
      g.fillStyle = PLAY_STORY_CARD.muted; g.font = '600 22px Menlo, monospace'; g.textAlign = 'left';
      g.fillText(that.data.mode === 2 ? 'C H E N G Y I N · 我 的 探 索 顺 序' : 'C H E N G Y I N · 主 题 通 关', 56, 88);
      g.fillStyle = PLAY_STORY_CARD.text; g.font = '500 52px Georgia, serif';
      g.fillText(String(that.data.chapter.name || '城市探索').slice(0, 12), 56, 160);
      const bx = 56, by = 210, bw = W - 112, bh = 380;
      g.fillStyle = PLAY_STORY_CARD.surface; that._rr(g, bx, by, bw, bh, 24); g.fill();
      that._drawRoute(g, that.data.nodes || [], bx, by, bw, bh);
      const stats = [
        // 与通关卡同一处修正:标签是"点亮坐标"就得给已点亮数,不是总数。
        // 这份是**分享卡**,错数字会被烤进图片传播出去,比页面上错得更久。
        [String(that.data.doneCount || 0), '点亮坐标'],
        [String(that.data.finishScore || 0), '探索值'],
        [String(that._finishMedals || 0), '获得徽章']
      ];
      stats.forEach((st, i) => {
        const cx = 56 + i * ((W - 112) / 3) + ((W - 112) / 6);
        g.textAlign = 'center';
        g.fillStyle = PLAY_STORY_CARD.text; g.font = '300 84px Menlo, monospace';
        g.fillText(st[0], cx, by + bh + 130);
        g.fillStyle = PLAY_STORY_CARD.muted; g.font = '500 22px -apple-system, sans-serif';
        g.fillText(st[1], cx, by + bh + 170);
      });
      g.textAlign = 'center'; g.fillStyle = PLAY_STORY_CARD.muted; g.font = '400 24px -apple-system, sans-serif';
      if (that.data.lead && that.data.lead.exists) {
        g.fillText('全队 ' + that.data.lead.total + ' 人同行', W / 2, by + bh + 230);
      }
      const footerY = H - 24;
      // 里程碑轴:海报要和屏幕上那张卡是同一件东西,所以这里也画一条。
      // milestone 为 null(累计数没取到)时整条不画 —— 与页面同一条口径,不在海报上补假数字。
      const ms = that.data.milestone;
      if (ms && ms.tiers && ms.tiers.length) {
        const my = by + bh + 290;
        const r = 30, gap = (W - 112 - r * 2) / (ms.tiers.length - 1);
        g.strokeStyle = PLAY_STORY_CARD.line; g.lineWidth = 2;
        g.beginPath(); g.moveTo(56 + r, my); g.lineTo(W - 56 - r, my); g.stroke();
        ms.tiers.forEach((t, i) => {
          const cx = 56 + r + i * gap;
          g.beginPath(); g.arc(cx, my, r, 0, Math.PI * 2);
          if (t.state === 'current') { g.fillStyle = PLAY_STORY_CARD.accent; g.fill(); g.fillStyle = PLAY_STORY_CARD.ring; }
          else if (t.state === 'past') { g.fillStyle = PLAY_STORY_CARD.accent; g.fill(); g.fillStyle = PLAY_STORY_CARD.ring; }
          else { g.fillStyle = PLAY_STORY_CARD.surface; g.fill(); g.strokeStyle = PLAY_STORY_CARD.line; g.stroke(); g.fillStyle = PLAY_STORY_CARD.fade; }
          g.textAlign = 'center'; g.font = '700 22px Menlo, monospace';
          g.fillText(String(t.value), cx, my + 8);
        });
        g.textAlign = 'center'; g.fillStyle = PLAY_STORY_CARD.muted; g.font = '400 24px -apple-system, sans-serif';
        const milestoneTitleY = Math.min(my + 62, footerY - 40);
        g.fillText(ms.title, W / 2, milestoneTitleY);
      }
      g.fillStyle = PLAY_STORY_CARD.footer; g.font = '600 22px Menlo, monospace';
      g.fillText('城 瘾 · 走 进 城 市 的 瘾', W / 2, footerY);
      wx.canvasToTempFilePath({
        canvas: cv, destWidth: W * dpr, destHeight: H * dpr,
        success(r) { cb && cb(r.tempFilePath); }, fail() { cb && cb(''); }
      });
    });
  },
  saveFinishCard() {
    const that = this;
    that.diegetic('生成足迹卡…');
    that.paintFinishCard((path) => {
      if (!path) { that.diegetic('足迹卡生成失败,再试一次'); return; }
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success() { that.diegetic('已保存到相册'); },
        fail(e) {
          if (e.errMsg && e.errMsg.indexOf('auth') >= 0) { wx.openSetting({}); }
          else if (e.errMsg && e.errMsg.indexOf('cancel') >= 0) { /* 用户取消 */ }
          else { that.diegetic('保存失败,再试一次'); }
        }
      });
    });
  },
  shareFinish() {
    // 通关→广场发布:发帖时活动选择器列出已通关活动(本场已在 /api/play/my-completed 中),选中即关联
    cyToast('去广场发布你的城市足迹');
    setTimeout(() => { wx.navigateTo({ url: '/pages/square/list/index' }); }, 800);
  },

  // ---------- 音频播放 ----------
  initAudio() {
    if (this._audio) return;
    const that = this;
    const audio = wx.createInnerAudioContext();
    audio.obeyMuteSwitch = false;       // 静音开关下也出声（语音导览属于内容消费）
    audio.onPlay(() => {
      that.setData({ audioPlaying: true, audioLoading: false, audioError: '' });
    });
    audio.onPause(() => {
      that.setData({ audioPlaying: false });
    });
    audio.onStop(() => {
      that.setData({ audioPlaying: false, audioLoading: false });
    });
    audio.onEnded(() => {
      that.setData({ audioPlaying: false, audioLoading: false });
    });
    audio.onError((err) => {
      const msg = (err && err.errMsg) ? err.errMsg : '音频加载失败';
      that.setData({ audioPlaying: false, audioLoading: false, audioError: msg });
      cyToast(msg);
    });
    audio.onWaiting(() => {
      that.setData({ audioLoading: true, audioError: '' });
    });
    audio.onCanplay(() => {
      that.setData({ audioLoading: false, audioError: '' });
    });
    this._audio = audio;
  },

  toggleAudio() {
    const g = this.data.game;
    if (!g.audio) return;
    this.initAudio();
    const audio = this._audio;
    const curNodeId = this.data.audioNodeId;
    const sameNode = curNodeId === g.nodeId;

    if (sameNode && this.data.audioPlaying) {
      // 同一节点正在播 → 暂停
      audio.pause();
    } else if (sameNode && !this.data.audioPlaying && !this.data.audioError) {
      // 同一节点暂停中 → 继续
      audio.play();
    } else {
      // 不同节点或错误重试 → 换源
      audio.stop();
      audio.src = g.audio;
      audio.play();
      this.setData({ audioNodeId: g.nodeId });
    }
  },

  /** 题面音频(题干配音 / 选项配音)。与节点语音导览共用同一个 InnerAudioContext ——
   *  三处同时出声是灾难,共用播放器天然保证「后播的把前面那段顶掉」。
   *  audioNodeId 在这里存字符串键('q' / 'optA'),节点侧存的是数字 nodeId,=== 比较不会撞。 */
  _toggleMediaAudio(key, url) {
    if (!url) return;
    this.initAudio();
    const audio = this._audio;
    const same = this.data.audioNodeId === key;
    if (same && this.data.audioPlaying) { audio.pause(); return; }
    if (same && !this.data.audioError) { audio.play(); return; }
    audio.stop();
    audio.src = url;
    audio.play();
    this.setData({ audioNodeId: key });
  },

  toggleQuestionAudio() {
    this._toggleMediaAudio('q', this.data.game && this.data.game.qAudio);
  },

  toggleOptionAudio(e) {
    const k = e.currentTarget.dataset.k;
    const opt = ((this.data.game && this.data.game.opts) || []).find((o) => o.k === k);
    this._toggleMediaAudio('opt' + k, opt && opt.audio);
  },

  previewQuestionImg() {
    const url = this.data.game && this.data.game.qImg;
    if (url) wx.previewImage({ urls: [url], current: url });
  },

  stopAudio() {
    if (!this._audio) return;
    try { this._audio.stop(); } catch (e) {}
    this.setData({ audioPlaying: false, audioLoading: false, audioError: '', audioNodeId: null });
  },

  pauseAudio() {
    if (!this._audio) return;
    try { this._audio.pause(); } catch (e) {}
    // 不清理 audioNodeId——回前台可继续播同一段
  },

  destroyAudio() {
    if (!this._audio) return;
    try { this._audio.destroy(); } catch (e) {}
    this._audio = null;
    this.setData({ audioPlaying: false, audioLoading: false, audioError: '', audioNodeId: null });
  },

  onShareAppMessage(event) {
    return activityShareFromEvent(event)
      || { title: '来城瘾,走一段城市探索', path: '/pages/play/index?activityId=' + this.data.activityId };
  },
  // FE-17 朋友圈分享(游玩页高传播)
  onShareTimeline() { return { title: '来城瘾,走一段城市探索', query: 'activityId=' + this.data.activityId }; }
});
