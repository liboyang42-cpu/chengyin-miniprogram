// 俱乐部 · 活动详情(Figma H1–H6)
//
// 这是**俱乐部视角**的主题详情:这条路线有几章几站、剧情写没写、玩法配没配、今天这一场谁来。
// 在这个页面之前,俱乐部点开主题跳的是 pages/topic/merchantinfo —— 那是**商家承接视角**
// (「这一站玩什么」是讲给商家听的「玩家到店会跟你做什么」),不是俱乐部要看的东西。
// 日常详情不跳 merchantinfo；只有「承接审核」显式复用它已有的主办方审核台，避免复制审核链。
const toast = require('../../../utils/toast.js');
const { resolveMenuChrome } = require('../../../utils/nav-safe-area.js');
const app = getApp();
const { toTimestamp } = require('../../../utils/datetime');
// 2026-09-03 导演台收编:pages/club/game-director 整页已删,它的状态机与写入安全
// (executeAction 的「回执未知」落盘 / 对账 / 重试)原样搬进 ./director.js,
// 由本页承载,渲染改用 cy-club-director-* 八个组件。见 director.js 顶部说明。
const { DIRECTOR_DATA, DIRECTOR_METHODS } = require('./director.js');
const { listGroupCodeActivities } = require('../../../utils/group-code-session.js');
const { bizFailureMessage } = require('../../../utils/response-shape.js');

function jsonBody(data) { return JSON.stringify(data || {}); }
function jsonHeader() { return { 'Content-Type': 'application/json' }; }
// 展示用掩码。真号只在「商家已确认」时由服务端下发,拨号用真号、屏幕上只露头尾
function maskPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 7) return '';
  return digits.slice(0, 3) + '****' + digits.slice(-4);
}
// 没有值和 0 不是一回事:0 要显示成 0,缺值才是「—」。
function countText(v) { return v == null ? '—' : String(v); }

// 结束主题的回执。退了几笔要说,含已核销票退不掉的那几笔更要说 ——
// 只报「已结束」会让主理人以为钱全退干净了。toast 上限 16 字,超了就只留最要紧的一句。
function endResultText(d) {
  const refunded = Number(d && d.refundedOrders) || 0;
  const manual = Number(d && d.manualOrders) || 0;
  if (manual > 0) return manual + ' 笔需人工处理';
  if (refunded > 0) return '已结束，退款 ' + refunded + ' 笔';
  return '已结束，无可退订单';
}

// 后端按场次分组,稿上是平铺 —— 把场次时间落到每一行,信息不丢。
function flattenCustomerRows(sessions) {
  const out = [];
  (Array.isArray(sessions) ? sessions : []).forEach(function (s) {
    const timeText = s.timeText || '时间待定';
    (Array.isArray(s.rows) ? s.rows : []).forEach(function (r) {
      const name = r.displayName || '这位成员';
      // phoneText 由后端决定是掩码还是替代说明,前端原样显示,不自己拼。
      // ⚠️ 稿 471:449 在这一行画了复制钮,但这里拿到的**只可能是掩码**
      // (ClubCrmAppServiceImpl.phoneText 有权限也走 maskPhone),复制过去是
      // 「1385621」这种废字符串 —— 宁可不给这个钮,也不给一个骗人的钮。
      // 要真能复制,得服务端另开一条按 MEMBER_LIST_READ 下发真号的口子。
      out.push({
        key: r.key,
        displayName: name,
        initial: name.slice(0, 1),
        timeText: timeText,
        phoneText: r.phoneText || '',
        statusCode: r.statusCode,
        statusText: r.statusText || '',
        verifyText: r.timeText && r.timeText !== '—' ? r.timeText : '',
      });
    });
  });
  return out;
}

function isSuccess(res) { return !!res && (res.code === '200' || res.code === 200); }
function positiveId(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }

// HO-26 集合时间:后端 edit-ops 用 DateUtils.parseDate 收 "yyyy-MM-dd HH:mm:ss"。
// 这里只拆/拼这一种格式;拿不到合法时间就不给改 —— 宁可不给入口,也不给一个会写错的入口。
const OPS_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/;
const OPS_RESULT_SHEET_MS = 2000;

// 六个状态 → 状态胶囊文案 / 主键 / 出不出核销与未通过原因。
// key 同时用作胶囊圆点的配色修饰符,别在 wxml 里散落 if。
const STATES = {
  reviewing: { text: '审核中',  primary: '等待审核中',   disabled: true,  verify: false, reject: false, sessions: false },
  rejected:  { text: '未通过',  primary: '修改并重新提交', disabled: false, verify: false, reject: true,  sessions: true  },
  confirmed: { text: '已确认',  primary: '开始准备',     disabled: false, verify: false, reject: false, sessions: true  },
  preparing: { text: '准备中',  primary: '开始活动',     disabled: false, verify: false, reject: false, sessions: true  },
  running:   { text: '进行中',  primary: '结束活动',     disabled: false, verify: true,  reject: false, sessions: true  },
  // ⚠️ 2026-09-11:原文案是「去核销」,而 onPrimary 对 selfrun 走的是 directorEndConfirmShow ——
  //    读着像个查看动作,点下去弹的是「结束这场活动?」。写动作不许挂在读文案下面,
  //    所以让文案跟行为走(结束活动的确认弹层自己会再说一遍要干什么)。
  //    核销台账另有入口:主题设置半屏里的「核销台账」。
  selfrun:   { text: '进行中',  primary: '结束活动',     disabled: false, verify: true,  reject: false, sessions: true  },
  ended:     { text: '已结束',  primary: '查看结算报告',  disabled: false, verify: true,  reject: false, sessions: true  },
};

// 场次状态(导演台 projection.status / topic-manage-stats.sessionStatus 同一套枚举)→ 页面六态
const SESSION_STATUS_KEYS = {
  NOT_PREPARED: 'confirmed', DRAFT: 'confirmed',
  PREPARING: 'preparing', READY: 'preparing',
  RUNNING: 'running', FINISHED: 'ended', CANCELLED: 'ended',
};

// Figma J8「退出与暂停规则」。写给主理人读的业务口径:只说会怎样、什么情况下做不了 ——
// 规则的真源是代码,但页面不需要把代码里的类名、判据原话和开发备注一并端出去(CU-C-74)。
const RULES_SECTIONS = [
  { key: 'quit-club', label: '退出俱乐部', rows: [
    { title: '主理人不能直接退出', text: '要先在成员治理里转让主理人，或解散俱乐部。' },
    { title: '退出会一并终止会籍', text: '会一并处理未到期的会籍：列出已取消的期数、被拦下的账单、待审条数与不可退条数，并告诉你打款是否已完成。' },
    { title: '群聊清理与退出一起完成', text: '群聊权限没清理干净就不会退出，不会出现「退了但群还在」。', tone: 'warning' },
  ] },
  { key: 'quit-team', label: '退出队伍', rows: [
    { title: '最后一人退出 = 队伍解散', text: '同时关闭队伍群聊。' },
    { title: '队长退出会自动移交', text: '移交给最早加入的其他在队成员，并通知他已成为队长。' },
    { title: '不在队里就退不了', text: '只有当前在队的成员能退出。' },
  ] },
  { key: 'refund', label: '退出以后的钱', rows: [
    { title: '已核销不退', text: '已核销的报名不可退款；自由探索是唯一例外，需人工核实，请联系客服。', tone: 'danger' },
    { title: '过了时点不退', text: '城市定向按集合时间、自由探索按主题有效期、活动按开始时间，各有一个截止时点。' },
    { title: '进了履约窗不退', text: '已进入履约窗的报名不可退款。' },
    { title: '算不出来 ≠ 不该退', text: '退款截止时间缺失时转人工核实，不由系统自行决定。', tone: 'warning' },
  ] },
  { key: 'pause', label: '暂停一个站点', rows: [
    { title: '原因和预计恢复时间都必填', text: '两个都要填，否则提交不了。' },
    { title: '必须绑一个已批准的备用方案', text: '不能直接指定备用站点。' },
    { title: '暂停期间这一站停摆', text: '玩家提交不了，商家也核验不了。' },
    { title: '暂停只影响本站', text: '不改变已发放的权益，也不动已经完成的提交。' },
    { title: '「兜底完成」是自动的', text: '站点暂停并绑好方案后，玩家走到备用站点时会自动记为兜底完成，不需要手动操作。', tone: 'warning' },
    { title: '恢复要过两个服务窗', text: '活动服务窗和站点服务窗都得在窗内才恢复得了。' },
  ] },
  { key: 'cancel', label: '取消一整场', rows: [
    { title: '会下架本场、处理退款并终止候补', text: '取消原因 2–255 字必填，会随通知一起发给已报名的人。', tone: 'danger' },
  ] },
];

// 四圆钮(2026-09-08 改):编辑并进「更多」,腾出的位置给团码。
// 图标改成语义对得上的 —— 原来成员用 tab-club、编辑用 image、团码用 edit(铅笔),
// 后两个是反的。这几个名字都在 components/cy/icon/icons.wxss 的 62 枚里,不是新造。
const CUSTOMER_CHIPS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待核销' },
  { value: 'contacted', label: '已接洽' },
  { value: 'verified', label: '已核销' },
];

const QUICK_ACTIONS = [
  { key: 'merchant', label: '商家', icon: 'discover-shop' },
  // CU-C-88(用户裁决 A):这个圆钮后面统计的是主题报名/购票参与者(cms_registration),
  // 与俱乐部成员名单(club_member)不是同一套对象 —— 按购票口径叫「报名参与者」。
  { key: 'customer', label: '报名参与者', icon: 'mtab-customers' },
  { key: 'groupcode',label: '团码', icon: 'qr' },
  { key: 'more',     label: '更多', icon: 'more' },
];

Page({
  data: {
    loaded: false,
    loadError: false,
    chromeClearTop: 0,
    topic: {},
    statusKey: 'reviewing',
    statusText: '',
    // 胶囊圆点的展示态(空=跟 statusKey);只影响展示,不参与主键判定
    statusDisplayKey: '',
    primary: { text: '', disabled: true },
    // §5-断6:没场次时主键换成「去开场」,原因就地写在页尾(见 resolvePrimary)
    sessionHint: '',
    showVerify: false,
    showReject: false,
    missingParam: false,
    verifyMetrics: [],
    sessions: [],
    canManageSessions: false,
    canReviewChapterApplications: false,
    quickActions: QUICK_ACTIONS,
    // 导演台自己的 44 个状态字段(见 director.js 的 DIRECTOR_DATA),
    // 用 Object.assign 并进来而不是逐个抄 —— 抄一遍就多一处会漂的真源。
    ...DIRECTOR_DATA,
    // 「结束活动」按稿是 T2 居中确认,旧页没有这个态,本页新增
    directorEndConfirmShow: false,
    // D5 队伍弹层 / D8 现场事件:旧 game-director 页没有这两个入口
    //(incident-sheet 组件自己的注释也写着「这是现有 game-director 页面里没有的新能力」)。
    // 打开/关闭本页承担;提交走 director.js 的 submitIncident(2026-09-07 后端补齐)。
    teamSheetVisible: false,
    incidentSheetVisible: false,
    // J4 主题设置 / J3 招商台:master 上这两块还没有,后端 2026-09-07 补齐
    settingSheetVisible: false,
    settingState: 'loading',   // loading | ready | denied | error
    settingSaving: false,
    setting: null,
    // J5 结束主题:只下架,不动已售出的票(主题这一层没有退款接口)
    endConfirmVisible: false,
    endSubmitting: false,
    endErrorText: '',
    merchantSheetVisible: false,
    merchantState: 'loading',
    customerSheetVisible: false,
    merchantRows: [],
    customerState: 'loading',
    customerStats: [],
    // 稿 471:449:四个筛选 chip 就是服务端 filter 的四个取值,不是前端再筛一遍。
    // 空串 = 不带 filter = 全部;其余三个原样发给 /api/club/crm/topic-customers。
    customerChips: CUSTOMER_CHIPS,
    customerFilter: '',
    customerRows: [],
    rulesSheetVisible: false,
    // CU-C-79(用户裁决 B):主键「去选一场」先弹这张选场半屏,选中后带 activityId 进活动运营。
    sessionPickVisible: false,
    sessionPickRows: [],
    // J8 退出与暂停规则:业务口径写在 RULES_SECTIONS 里,静态内容不打接口
    rulesSections: RULES_SECTIONS,
    // 角色接管候选。旧页把守卫写在模板的 wx:if 里
    //(canTakeoverRoles && item.roleCode && item.confirmationStatus === 'CONFIRMED');
    // 抽成组件后组件只管渲染给它的列表,守卫必须挪到这边 ——
    // 而且「不合格的人根本不进列表」比「进了列表再靠 wx:if 藏起来」更硬:
    // 组件换个写法也漏不出必定失败的接管入口。
    directorTakeoverCandidates: [],
    // 队伍行(喂给 cy-club-director-row-list)。异常队伍多带三行权威明细。
    directorTeamRows: [],
    // 只有带 activityId 进来才是「这一场」,导演台那套才有意义
    directorActive: false,
    // HO-26 集合时间(承接方领队改运营详情):显示值取 /api/topic/info-to-user 的 activityList
    // (与本场同一个 activity.startDate),改完回读,不本地先改。
    opsTimeAvailable: false,
    opsTimeText: '',
    opsTimeSheetVisible: false,
    opsTimeSubmitting: false,
    opsTimeDraft: { date: '', time: '' },
    resultSheet: { show: false, kind: 'success', title: '', sub: '', why: '', duration: OPS_RESULT_SHEET_MS },
  },

  onLoad(query) {
    let windowInfo; let menuButtonInfo;
    try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) {}
    try { menuButtonInfo = wx.getMenuButtonBoundingClientRect(); } catch (e) {}
    this.setData({ chromeClearTop: resolveMenuChrome(windowInfo, menuButtonInfo).contentTop });
    const topicId = positiveId(query && query.topicId);
    const clubId = positiveId(query && query.clubId);
    // E-12(2026-09-16):缺参是终态,不是网络波动 —— 只给「返回」,不给必失败的重试。
    if (!topicId) { this.setData({ loaded: true, loadError: true, missingParam: true }); return; }
    // topicId / clubId 只在 js 里当路由参数用,wxml 一个字都不渲染 —— 进 data 就是死字段(U4)
    this._topicId = topicId;
    this._clubId = clubId;
    // activityId 是「这一场」的标识,只有从场次进来才有;没有就不进导演台状态机,
    // 页面仍按主题维度正常展示(H1-H6)。
    this._directorActivityId = positiveId(query && query.activityId);
    // 导演台状态机等 canDirect 下发后再启动(startDirector):联席/核销员从场次入口带 activityId 进来,
    // 不先打一串会被 requireClubOwner 拒掉的导演台请求。
    this.fetchDetail();
    this.loadManageStats();
  },

  // CU-C-80:从活动运营(C10)保存改期后 navigateBack 回来,页面实例被复用、onLoad 不会重跑,
  // 「接下来」卡会停在改期前的 activityList(实测返回后仍写旧日期,退出重进才对)。
  // 首展闸照 pages/club/customers/index.js:首屏由 onLoad 负责,返回即重拉。
  onShow() {
    if (!this._hasShown) { this._hasShown = true; return; }
    if (!this.data.loaded || this.data.loadError || this.data.missingParam) return;
    this.fetchDetail();
    this.loadManageStats();
  },

  // 第二轮拍板第 1 条(2026-09-17):主理人侧字段(几站/本场人数/待核销/我已核销 + 导演台/场次管理/核销区三个身份)
  // 由管理向接口按俱乐部角色下发,页面只读字段,不再拿 isOwner/缺省值去猜。
  // 带 clubId 才是俱乐部视角;拉不到就走整页失败重试,不降级成「看起来是普通成员」。
  loadManageStats() {
    if (!this._clubId) return;
    const that = this;
    const activityId = this._directorActivityId || null;
    const seq = (this._manageStatsSeq || 0) + 1;
    this._manageStatsSeq = seq;   // 只认最后一次请求:旧请求晚到的成功/失败都丢弃
    this._manageStatsFailed = false;
    app.sendRequest({
      hideLoading: true,
      url: '/api/club/crm/topic-manage-stats',
      method: 'POST',
      data: jsonBody({ clubId: this._clubId, topicId: this._topicId, activityId }),
      header: jsonHeader(),
      success(res) {
        if (seq !== that._manageStatsSeq) return;
        if (!isSuccess(res) || !res.data) { that.failManageStats(); return; }
        that._manageStats = res.data;
        if (that._lastRaw) that.applyDetail(that._lastRaw);
      },
      fail() { if (seq === that._manageStatsSeq) that.failManageStats(); },
    });
  },

  // 记下失败再出错误态:详情可能晚到,applyDetail 不能把这次失败盖成「加载成功的普通成员视图」。
  failManageStats() {
    this._manageStatsFailed = true;
    this.setData({ loaded: true, loadError: true });
  },

  onRetry() {
    // 缺 topicId 时重发什么都是同一个 400/失败 —— 出口只能是回去,不是再来一次(E-12)。
    if (this.data.missingParam) { this.goBack(); return; }
    this.setData({ loaded: false, loadError: false });
    this.fetchDetail();
    this.loadManageStats();
  },

  fetchDetail() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/topic/info-to-user',
      method: 'POST',
      // 后端 topicInfo(String id) 是 form 绑定(ApiTopicController:1175);jsonBody 会让 id 恒空 → 永远「参数不合规」。
      data: { id: this._topicId },
      header: { 'Content-Type': 'application/x-www-form-urlencoded' },
      success(res) {
        if (!isSuccess(res) || !res.data) { that.setData({ loaded: true, loadError: true }); return; }
        that.applyDetail(res.data);
      },
      fail() { that.setData({ loaded: true, loadError: true }); },
    });
  },

  applyDetail(raw) {
    this._lastRaw = raw;
    if (this._manageStatsFailed) { this.setData({ loaded: true, loadError: true }); return; }
    // 俱乐部视角下身份还没拿到就不渲染,免得主理人先看到一闪普通成员视图;统计到了会用 _lastRaw 重放
    if (this._clubId && !this._manageStats) return;
    // P0(2026-09-05 审核):/api/topic/info-to-user 不返回 preparingAt/startedAt/endedAt 这类场次字段,
    // 按 raw 推永远落 confirmed。进了导演台就以 /api/game/session/view 的 projection.status 为准
    //(applyProjectionStatus 写进 _directorStatusKey),raw 只负责审核态(reviewing/rejected)。
    const auditKey = this.resolveStateKey(raw);
    this._auditKey = auditKey;
    // E-14 + 拍板1(总控复查裁定):三块管理向界面各读各的身份字段,判据都在后端 topic-manage-stats:
    //   导演台 canDirect(= requireClubOwner) / 场次管理 canManageSessions(= ClubEventOps) / 核销区 canViewVerify(= 核销台账)。
    // 没有对应字段就不出对应界面 —— 被转发进来的普通成员看不到任何管理向入口。
    const stats = this._manageStats || {};
    this._canDirect = stats.canDirect === true;
    this._canManageSessions = stats.canManageSessions === true;
    this._canViewVerify = stats.canViewVerify === true;
    const statusKey = (auditKey === 'reviewing' || auditKey === 'rejected')
      ? auditKey
      : (this._directorStatusKey || auditKey);
    const state = STATES[statusKey] || STATES.reviewing;
    const plan = this.resolvePrimary(state, statusKey, raw);
    this.setData({
      loaded: true,
      loadError: false,
      statusKey,
      // 重放详情(统计晚到/按场次重拉)时别把 projection 给的「已取消」冲回「已结束」
      statusText: statusKey === 'ended' && this._sessionCancelled ? '已取消' : state.text,
      primary: plan.primary,
      sessionHint: plan.sessionHint,
      showReject: state.reject && !!raw.rejectReason,
      topic: {
        name: raw.name || raw.title || '',
        cover: raw.cover || raw.coverUrl || '',
        merchantLogo: raw.merchantLogo || '',
        dateRange: this.formatRange(raw.startDate, raw.endDate),
        verifyModeText: raw.verifyModeText || '玩家可到店核销',
        chips: this.buildChips(raw, stats),
        structureText: this.buildStructureText(raw, stats),
        statusChips: this.buildTopicStatusChips(raw),
        rejectReason: raw.rejectReason || '',
      },
      sessions: state.sessions ? this.buildSessions(raw) : [],
      canManageSessions: this._canManageSessions,
      canReviewChapterApplications: stats.canReviewChapterApplications === true,
    });
    this.applyVerifyVisibility();
    this._topicActivities = (Array.isArray(raw.activityList) ? raw.activityList : [])
      .map(function (a) { return { id: positiveId(a && a.id), startDate: (a && a.startDate) || '' }; })
      .filter(function (a) { return !!a.id; });
    this.startDirector();
    this.maybeEnterDirector(raw);
    this.syncOpsTime();
  },

  /* ——— HO-26 集合时间(承接方领队改运营详情)———
   * 后端 POST /api/club/lead/edit-ops(ApiClubLeadController.editOps):只有承接方领队可改;
   * 已售出(cms_registration 有待支付/支付中/已支付)的场次一律拒改集合时间与地点(CR-63,9-15 裁决
   * 「已售锁时间地点」)—— 所以改成功时本场必然没有在册报名,后端也不另发通知、不重算退款窗,
   * 只记日志报备发起人。前端不自判能不能改:入口常显,半屏里先说清已售不可改,
   * 后端拒绝原文进失败半屏。 */
  _opsTimeMatch() {
    const activityId = this._directorActivityId;
    const row = activityId
      ? (this._topicActivities || []).find(function (a) { return String(a.id) === String(activityId); })
      : null;
    return OPS_TIME_RE.exec((row && row.startDate) || '');
  },

  syncOpsTime() {
    const match = this._opsTimeMatch();
    this.setData({
      opsTimeAvailable: !!match,
      opsTimeText: match ? (Number(match[2]) + '月' + Number(match[3]) + '日 ' + match[4]) : '',
    });
  },

  openOpsTimeSheet() {
    if (this.data.opsTimeSubmitting) return;
    const match = this._opsTimeMatch();
    if (!match) { this.syncOpsTime(); return; }
    this.setData({
      opsTimeSheetVisible: true,
      opsTimeDraft: { date: match[1] + '-' + match[2] + '-' + match[3], time: match[4] },
    });
  },

  closeOpsTimeSheet() {
    if (this.data.opsTimeSubmitting) return;
    this.setData({ opsTimeSheetVisible: false });
  },

  onOpsDateChange(e) { this.setData({ 'opsTimeDraft.date': (e.detail && e.detail.value) || '' }); },
  onOpsTimeChange(e) { this.setData({ 'opsTimeDraft.time': (e.detail && e.detail.value) || '' }); },

  confirmOpsTime() {
    if (this.data.opsTimeSubmitting) return;
    const activityId = this._directorActivityId;
    const draft = this.data.opsTimeDraft || {};
    if (!activityId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '') || !/^\d{2}:\d{2}$/.test(draft.time || '')) {
      toast('请选择集合日期与时间');
      return;
    }
    const that = this;
    const failSheet = function (why) {
      that.setData({
        opsTimeSubmitting: false,
        opsTimeSheetVisible: false,
        resultSheet: { show: true, kind: 'fail', title: '集合时间没改成', sub: '', why: why, duration: OPS_RESULT_SHEET_MS },
      });
    };
    this.setData({ opsTimeSubmitting: true });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/lead/edit-ops', method: 'POST',
      data: jsonBody({ activityId: activityId, startDate: draft.date + ' ' + draft.time + ':00' }),
      header: jsonHeader(),
      success(res) {
        // 后端拒绝文案(已售锁定 / 只有承接方领队可改)是写给主理人看的,原样进失败半屏
        if (!isSuccess(res)) { failSheet((res && res.msg) || '稍后再试一次'); return; }
        that.setData({
          opsTimeSubmitting: false,
          opsTimeSheetVisible: false,
          resultSheet: {
            show: true, kind: 'success', title: '集合时间已更新',
            sub: '已报备发起人；退款截止按新的集合时间前 24 小时计算。', why: '', duration: OPS_RESULT_SHEET_MS,
          },
        });
        that.fetchDetail(); // 回读真源:新时间从 activityList 重新取,不在本地先改
      },
      fail() {
        // 传输层失败 = 写结果未知,不能下「没改成」的结论;回读让页面显示服务端真相
        failSheet('网络异常，结果待确认；已重新读取当前时间');
        that.fetchDetail();
      },
      successStatusAbnormal(res, statusCode) {
        const status = Number(statusCode);
        const definite = status >= 400 && status < 500 && status !== 408; // 4xx = 明确拒绝;5xx/408 = 结果未知
        failSheet(definite ? ((res && res.msg) || '服务拒绝了这次修改') : '服务暂时不可用，结果待确认；已重新读取当前时间');
        if (!definite) that.fetchDetail();
      },
    });
  },

  onOpsResultClose() { this.setData({ 'resultSheet.show': false }); },

  // 导演台只在 canDirect 为真时启动一次(带 activityId 进来或唯一一场自动接管)。
  startDirector() {
    if (this._directorStarted || !this._directorActivityId || !this._canDirect) return;
    this._directorStarted = true;
    this.setData({ directorActive: true });
    this.initDirector(this._directorActivityId);
  },

  // 核销区可见性的唯一真源:真状态 + 场次未取消 + canViewVerify(主理人/管理员/核销员,与核销台账接口同判据)。
  // 与 fix-be-0917 E-RPT-5 的 applyVerifyVisibility 同名同位:那边用 isOwner||/api/club/detail 的 viewerIsAdmin 补管理员,
  // 这里由后端 canViewVerify 一次给全(含核销员),合并时以本实现为准、删掉 loadViewerAdmin。
  // 核销员等 canDirect=false 的人不启动导演台、拿不到 projection:改读 topic-manage-stats 下发的
  // 本场真状态 sessionStatus(服务端给,不拿客户端时钟猜)。审核中/未通过仍以审核态为准;
  // canDirect 的主理人照旧只认导演台 projection(不让排期状态在 projection 到达前闪出核销区)。
  // 总控裁定(2026-09-17):胶囊文案/圆点跟 sessionStatus 走(纯展示,statusDisplayKey),
  // 决定主键与「查看结算报告」的 statusKey 不动 —— 核销员看得到「进行中」,拿不到导演台/结算主键。
  applyVerifyVisibility() {
    const stats = this._manageStats || {};
    let key = this.data.statusKey;
    let cancelled = this._sessionCancelled;
    let statusDisplayKey = '';
    let statusText = this.data.statusText;
    const sessionStatus = String(stats.sessionStatus || '').toUpperCase();
    if (!this._canDirect && SESSION_STATUS_KEYS[sessionStatus]
      && key !== 'reviewing' && key !== 'rejected') {
      key = SESSION_STATUS_KEYS[sessionStatus];
      cancelled = sessionStatus === 'CANCELLED';
      statusDisplayKey = key;
      statusText = cancelled ? '已取消' : STATES[key].text;
    }
    const state = STATES[key] || STATES.reviewing;
    const show = !!state.verify && !cancelled && this._canViewVerify === true;
    this.setData({
      statusDisplayKey,
      statusText,
      showVerify: show,
      verifyMetrics: show ? [
        { label: '待核销', value: countText(stats.pendingVerifyCount) },
        { label: '我已核销', value: countText(stats.verifiedByMeCount) },
        { label: '本场总人数', value: countText(stats.sessionHeadcount) },
      ] : [],
    });
  },

  // 从俱乐部页进来大多只带 topicId/clubId 没有 activityId(那是场次列表才有的)。
  // 主题下只有一场时,这一场就是导演台的对象 —— 不进状态机,页面就是九个 notReady 的空壳。
  maybeEnterDirector(raw) {
    if (this._directorActivityId || !this._clubId || !this._canDirect) return;
    const activities = listGroupCodeActivities(raw && raw.activityList);
    if (activities.length !== 1) return;
    const activityId = positiveId(activities[0].id);
    if (!activityId) return;
    this._directorActivityId = activityId;
    this.startDirector();
    this.loadManageStats(); // 「本场」口径换成这一场
  },

  // 导演台每次拉到 projection 都回调这里:场次状态 → 页面六态。审核中/未通过仍以审核态为准。
  applyProjectionStatus(status) {
    const key = SESSION_STATUS_KEYS[String(status || '').toUpperCase()];
    if (!key) return;
    this._directorStatusKey = key;
    if (this._auditKey === 'reviewing' || this._auditKey === 'rejected') return;
    const state = STATES[key];
    // 已取消的场次按「已结束」渲染,但不开核销区(取消场没有可核销的人)
    const cancelled = String(status || '').toUpperCase() === 'CANCELLED';
    this._sessionCancelled = cancelled;
    // 开始准备/开始活动/结束活动是导演台写动作,只给 canDirect;已结束的主键是结算报告,不归导演台
    const directorAction = key !== 'ended';
    this.setData({
      statusKey: key,
      statusText: cancelled ? '已取消' : state.text,
      primary: directorAction && !this._canDirect ? { text: '', disabled: true } : { text: state.primary, disabled: state.disabled },
    });
    this.applyVerifyVisibility();
  },

  // 底部主键在**没场次**时的出口(§5-断6)。导演台的状态流转(开始准备/开始活动/结束活动)
  // 都以一场具体场次为对象(onPrimary 的 _directorActivityId 闸),主题下没有这一场时它
  // 真做不了事 —— 留一个「开始准备」点下去只弹 toast,就是死入口。这时把开场本身给出去,
  // 文案跟动作走;clubId 缺失(开不了场)时干脆不出主键。
  // 有场次时一个字都不改:唯一一场会被 maybeEnterDirector 接管,多场只能去场次管理选。
  resolvePrimary(state, statusKey, raw) {
    const base = { primary: { text: state.primary, disabled: state.disabled }, sessionHint: '' };
    // 只有这四个状态的主键动作挂在导演台上;rejected / ended 各有去处(编辑主题 / 结算报告)
    if (statusKey !== 'confirmed' && statusKey !== 'preparing'
      && statusKey !== 'running' && statusKey !== 'selfrun') return base;
    const none = { primary: { text: '', disabled: true }, sessionHint: '' };
    // 已在导演台(带 activityId 进来或已自动接管):主键是导演台写动作,只给 canDirect
    if (this._directorActivityId) return this._canDirect ? base : none;
    const sessions = listGroupCodeActivities(raw && raw.activityList);
    // 唯一一场且能进导演台:maybeEnterDirector 马上会把导演台接起来,主键归它
    if (this._clubId && this._canDirect && sessions.length === 1 && positiveId(sessions[0].id)) return base;
    // 其余出口都是去场次管理(开场/选场),只给 canManageSessions。
    // 被转发的普通成员即使带着 clubId,也不该看到一个点进去是管理页的 CTA。
    if (!this._clubId || !this._canManageSessions) return none;
    if (sessions.length >= 1) return { primary: { text: '去选一场', disabled: false }, sessionHint: '' };
    return {
      primary: { text: '去开场', disabled: false },
      sessionHint: '这个主题还没有场次：核销与团码都要先开一场。',
    };
  },

  // 状态口径:后端 info-to-user 里**没有** auditStatus 字段(全库不存在),
  // 审核态的真源是 cms_topic.status(0 待审核 / 1 审核通过 / 2 审核失败)。
  // E-06(2026-09-16):原来读 raw.auditStatus 恒 undefined ⇒ 审核中/未通过一律显示「已确认」。
  resolveStateKey(raw) {
    const status = Number(raw.status);
    if (status === 2 || raw.rejectReason) return 'rejected';
    if (status === 0) return 'reviewing';
    if (raw.endedAt || raw.status === 'ended') return 'ended';
    if (raw.startedAt || raw.status === 'running') return raw.selfPublished ? 'selfrun' : 'running';
    if (raw.preparingAt || raw.status === 'preparing') return 'preparing';
    return 'confirmed';
  },

  formatRange(start, end) {
    const fmt = (v) => {
      const ts = v ? toTimestamp(String(v)) : 0;
      if (!ts) return '';
      const d = new Date(ts);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    };
    const a = fmt(start), b = fmt(end);
    if (a && b) return a + ' – ' + b;
    return a || b || '';
  },

  buildChips(raw, stats) {
    const chips = [];
    if (raw.playModeText) chips.push(raw.playModeText);
    if (stats.sessionHeadcount > 0) chips.push('本场 ' + stats.sessionHeadcount + ' 人');
    return chips;
  },

  buildStructureText(raw, stats) {
    const parts = [];
    // E-06(2026-09-16):chapterCount 是幻字段,真源是 totalChapterCount(章节总数)。
    // 拍板1:站数读管理向接口的 nodeCount(主题下上架节点总数)。
    if (Number(raw.totalChapterCount) > 0) parts.push(raw.totalChapterCount + ' 章');
    if (stats.nodeCount > 0) parts.push(stats.nodeCount + ' 站');
    if (raw.playModeText) parts.push(raw.playModeText);
    return parts.join(' · ');
  },

  buildTopicStatusChips(raw) {
    const chips = [];
    if (raw.storyReady) chips.push({ text: '剧情已写', tone: 'success' });
    // 「玩法 x/y」:x(已配玩法数)后端不下发,不拿 0 冒充「一个都没配」,这枚不出。
    return chips;
  },

  buildSessions(raw) {
    // E-06(2026-09-16):真源是 VO 里的 activityList(PublicActivitySummaryVO:id/name/startDate/endDate/addressName)。
    const rows = Array.isArray(raw.activityList) ? raw.activityList : [];
    return rows.map((s, i) => ({
      id: s.id || ('s' + i),
      whenText: this.formatRange(s.startDate, s.endDate),
      whoText: s.name || '',
      etaText: s.addressName || '',
      // 场次类型后端没下发,留空;wxml 会整格不出,不冒充足球/到店。
      kindText: '',
    }));
  },

  onQuickAction(e) {
    const key = e.currentTarget.dataset.key;
    const action = QUICK_ACTIONS.filter((a) => a.key === key)[0];
    if (!action || action.disabled) return;
    // 「更多」= Figma J9:原「编辑」那张主题设置,外加这一页其它次要入口
    //(剧情与玩法 / 核销台账 / 场次管理 / 退出与暂停规则)。
    // 主题内容仍去编辑主题页,由弹层里那一行带过去;结束主题不放在俱乐部这一层。
    if (key === 'more') { this.openTopicSetting(); return; }
    if (key === 'merchant') { this.openMerchants(); return; }
    if (key === 'customer') { this.openCustomers(); return; }
    if (key === 'groupcode') { this.goGroupCode(); return; }
    this.notReady(action.label);
  },

  /* 剧情与玩法整页 pages/club/topic-story 已进 app.json(#988),这里接上入口。
     两边同时改到了这一处:代码体逐字相同,合并保留信息更全的这一份注释。
     ⚠️ 留着后半段是因为它记的是一个门禁盲区:nav-route-exists 拦的是
     「跳向不存在的路由」,拦不住反过来的「页存在但没人跳」——
     这一页正是那样在 master 上挂了几天(契约与截图矩阵都在跑,入口却停在 notReady)。
     clubId 可选:topic-story 只把它当治理身份的线索,缺了也能按主题公开投影渲染。 */
  goStory() {
    if (!this._topicId) return;
    wx.navigateTo({ url: '/pages/club/topic-story/index?topicId=' + this._topicId
      + (this._clubId ? '&clubId=' + this._clubId : '') });
  },

  goEventOps() {
    if (!this._clubId) return;
    wx.navigateTo({ url: '/pages/club/event-ops/index?clubId=' + this._clubId
      + '&topicId=' + this._topicId });
  },

  // CU-C-79(用户裁决 B):主键文案是「去选一场」,而原来它只跳场次管理页且不带 activityId ——
  // 页面里根本没有「选」这个动作。现在先弹选场半屏(场次来自本主题的 activityList),
  // 选中后带 activityId 进活动运营,进去就是这一场的本场管理。
  // 没场次时文案是「去开场」,那个动作仍是直接进场次管理建系列。
  goSessionEntry() {
    if (!(this._topicActivities || []).length) { this.goEventOps(); return; }
    this.openSessionPick();
  },

  openSessionPick() {
    const sessions = this.data.sessions || [];
    const rows = (this._topicActivities || []).map(function (item) {
      const row = sessions.filter(function (s) { return String(s.id) === String(item.id); })[0] || {};
      return {
        id: item.id,
        whenText: row.whenText || '时间待定',
        whoText: row.whoText || '',
      };
    });
    if (!rows.length) { this.goEventOps(); return; }
    this.setData({ sessionPickVisible: true, sessionPickRows: rows });
  },

  closeSessionPick() { this.setData({ sessionPickVisible: false, sessionPickRows: [] }); },

  onSessionPick(e) {
    const picked = this.data.sessionPickRows.filter(function (row) {
      return String(row.id) === String(e.currentTarget.dataset.id);
    })[0];
    this.setData({ sessionPickVisible: false, sessionPickRows: [] });
    const activityId = picked && positiveId(picked.id);
    if (!activityId || !this._clubId) return;
    wx.navigateTo({ url: '/pages/club/event-ops/index?clubId=' + this._clubId
      + '&topicId=' + this._topicId + '&activityId=' + activityId });
  },

  // 核销台账 = 本团名册里每个人的到场状态。名册页早就有这份数据,
  // 只是原来没把核销态显示出来(它只被用来算「能不能退款」)。
  goLedger() {
    if (!this._clubId || !this._topicId) { this.notReady('核销台账'); return; }
    wx.navigateTo({ url: '/pages/club/enroll/index?clubId=' + this._clubId + '&topicId=' + this._topicId });
  },


  // 底部主键三段就是导演台的状态流转(施工文档 §5.4):
  //   已确认 ──[开始准备]──► 准备中 ──[开始活动]──► 进行中 ──[结束活动]──► 已结束
  // 前两段直接调导演台的处理器;「结束活动」按稿走 T2 居中确认(无顶栏无 ✕),
  // 所以先开确认弹层,由 onDirectorEndConfirm 再落到 onFinishSession。
  onPrimary() {
    if (this.data.primary.disabled) return;
    const key = this.data.statusKey;
    // ⚠️ 「修改并重新提交」必须排在 _directorActivityId 那道闸**前面**:
    //    被拒的主题通常一场都还没开,导演台对象根本不存在 —— 放在闸后面等于永远走不到,
    //    那正是它原来只会弹「修改并重新提交即将开放」的原因。真正的编辑入口就在本页「更多」里。
    if (key === 'rejected') { this.goEditTopic(); return; }
    if (key === 'ended') { this.goSettlement(); return; }
    // 没场次:主键已被 resolvePrimary 换成真动作(去开场 / 去选一场)—— 走它,
    // 不再弹「还没有场次」那句点了没反应的 toast(§5-断6)
    if (!this._directorActivityId) { this.goSessionEntry(); return; }
    if (key === 'confirmed') { this.onPrepareSession(); return; }
    if (key === 'preparing') { this.onStartSession(); return; }
    if (key === 'running' || key === 'selfrun') { this.setData({ directorEndConfirmShow: true }); return; }
    this.notReady(this.data.primary.text);
  },

  goSettlement() {
    wx.navigateTo({ url: '/pages/club/settlement/index?clubId=' + (this._clubId || '') });
  },

  // roles 每次刷新都要重算候选 —— 服务端把某人的确认状态改回 PENDING 时,
  // 他的接管入口必须当场消失,不能等下次进页面。
  refreshTakeoverCandidates() {
    const canTakeover = !!this.data.canTakeoverRoles;
    // 5-03:行组件认 {id,title,subtitle} 并把点击回传成 {id};原来直接喂 roleView 行,
    // 组件读 item.title 得到空白,openTakeoverRole 也拿不到 teamId/memberId。
    const rows = canTakeover ? (this.data.roles || []).filter(function (item) {
      return !!(item && item.roleCode) && item.confirmationStatus === 'CONFIRMED';
    }).map(function (item) {
      return {
        id: String(item.teamId) + ':' + String(item.memberId),
        title: item.memberNameText,
        subtitle: item.roleNameText,
      };
    }) : [];
    this.setData({ directorTakeoverCandidates: rows });
  },

  // 队伍模型 → 行模型。异常队伍把「卡点节点 / 提示层级 / 最近有效事件」摊成 details 三行 ——
  // 这三条是旧页就有的权威信息,抽成组件时一度丢了。
  // ⚠️ 缺值写「待确认」,**不写 0 也不留空**:0 会被读成「没有卡点」,空会被读成「查过了没有」,
  //    而真相是服务端没下发。这条规则和广播预览「不写成 0 人」是同一个道理。
  refreshTeamRows() {
    const pending = '待确认';
    const rows = (this.data.teams || []).map(function (team) {
      const row = {
        id: team.teamId != null ? team.teamId : team.nameText,
        title: team.nameText,
        subtitle: team.issueText || team.progressText,
        value: team.statusText,
        valueTone: team.isAbnormal ? 'warning' : 'default',
        details: [],
      };
      if (team.isAbnormal) {
        row.details = [
          { label: '卡点节点', text: team.stuckNodeText || pending },
          { label: '提示层级', text: team.hintLevelText || pending },
          { label: '最近有效事件', text: team.recentEventText || pending },
        ];
      }
      return row;
    });
    this.setData({ directorTeamRows: rows });
  },

  /* ——— Figma J7 商家(弹窗)———
   * 商家与成员是两个圆钮、两个各自独立的弹层(H 系稿就是这么画的)。
   * ⚠️ 联系方式是服务端裁剪的 —— 未确认的商家回包里没有 phone 这个键,不是前端藏起来。 */
  openMerchants() {
    if (!this._clubId || !this._topicId) { this.notReady('商家'); return; }
    this.setData({ merchantSheetVisible: true });
    this.loadMerchants();
  },
  closeMerchants() { this.setData({ merchantSheetVisible: false }); },

  loadMerchants() {
    this.setData({ merchantState: 'loading' });
    const that = this;
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/recruit/overview', method: 'POST',
      data: jsonBody({ clubId: this._clubId, topicId: this._topicId }), header: jsonHeader(),
      success(res) {
        if (res && Number(res.code) === 403) { that.setData({ merchantState: 'denied' }); return; }
        if (!isSuccess(res) || !res.data) { that.setData({ merchantState: 'error' }); return; }
        that.setData({ merchantState: 'ready', merchantRows: that.buildMerchantRows(res.data) });
      },
      fail() { that.setData({ merchantState: 'error' }); },
    });
  },

  buildMerchantRows(d) {
    return (Array.isArray(d.nodes) ? d.nodes : [])
      .filter(function (n) { return n.state !== 'OPEN'; })
      .map(function (n) {
        const phone = typeof n.phone === 'string' ? n.phone.trim() : '';
        const name = n.merchantName || '未命名商家';
        return {
          nodeId: n.nodeId,
          merchantName: name,
          initial: name.slice(0, 1),
          stationName: n.name || '未命名站点',
          phone: phone,
          // 未确认的商家回包里压根没有 phone —— 这里说清是「还没确认」,
          // 不要写成空字符串,空会被读成「这家没留电话」。
          contactText: phone ? maskPhone(phone) : '未确认，暂无联系方式',
        };
      });
  },

  // 屏幕上只露掩码,复制到剪贴板的是真号 —— 真号本来就只在「商家已确认」时才下发。
  copyPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.setClipboardData({ data: String(phone), success() { toast('手机号已复制'); }, fail() {} });
  },

  /* ——— Figma J2 报名参与者 · 主题内(弹窗)———
   * CU-C-88(用户裁决 A):这一层统计的是主题报名/购票参与者(cms_registration),
   * 与俱乐部成员名单(club_member)是两套对象 —— 入口与弹层都按购票口径叫「报名参与者」。
   * 按场次分组;手机号那一格由后端按权限决定给号码还是给替代说明,前端原样显示,不自己拼。 */
  openCustomers() {
    if (!this._clubId || !this._topicId) { this.notReady('报名参与者'); return; }
    this.setData({ customerSheetVisible: true });
    this.loadCustomers();
  },
  closeCustomers() { this.setData({ customerSheetVisible: false }); },

  onCustomerFilter(e) {
    const value = e.currentTarget.dataset.value || '';
    if (value === this.data.customerFilter) return;
    this.setData({ customerFilter: value });
    this.loadCustomers();
  },

  loadCustomers() {
    this.setData({ customerState: 'loading' });
    const that = this;
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/crm/topic-customers', method: 'POST',
      data: jsonBody({ clubId: this._clubId, topicId: this._topicId, filter: this.data.customerFilter }),
      header: jsonHeader(),
      success(res) {
        if (!isSuccess(res) || !res.data) { that.setData({ customerState: 'error' }); return; }
        const d = res.data;
        that.setData({
          customerState: 'ready',
          // 三个数是全量口径,不随 chip 变 —— 服务端在过滤前先数完。
          customerStats: [
            { key: 'sold', tone: 'default', text: '已售 ' + countText(d.soldCount) },
            { key: 'pending', tone: 'warning', text: '待核销 ' + countText(d.pendingCount) },
            { key: 'verified', tone: 'success', text: '已核销 ' + countText(d.verifiedCount) },
          ],
          // 稿上是一条平铺名单,场次时间落到每行 —— 分组的信息没丢,换了个位置。
          customerRows: flattenCustomerRows(d.sessions),
        });
      },
      fail() { that.setData({ customerState: 'error' }); },
    });
  },

  // 定向广播的弹层是导演台那套(D7),这里只是多开一个入口。
  // 半屏叠半屏会糊在一起,所以先关掉报名参与者弹层;不可发送时入口已置灰并写明条件(CU-C-76)。
  goBroadcast() {
    this.setData({ customerSheetVisible: false });
    this.openBroadcast();
  },

  /* ——— Figma J6 出示团码 ——— */
  goGroupCode() {
    // 团码页早就有(pages/club/group-code),认 activityId 或 topicId
    const q = this._directorActivityId
      ? ('activityId=' + this._directorActivityId)
      : (this._topicId ? ('topicId=' + this._topicId) : '');
    if (!q) { this.notReady('出示团码'); return; }
    wx.navigateTo({ url: '/pages/club/group-code/index?' + q });
  },

  /* ——— Figma J8 退出与暂停规则 ———
   * 静态内容,不打接口;文案是给主理人的业务口径(实现细节不外露,见 RULES_SECTIONS)。 */
  /* ——— Figma J5 结束主题 ———
   * 停售 + 把这个主题名下所有在办场次逐场取消并全额退款。服务端 /api/club/topic-setting/end
   * 先下架再逐场退(顺序反了会在退款过程中又卖出新票),每一场自己一个事务 ——
   * 一场失败不回滚已经退掉的那几场,失败的场次原样报回来。
   * 含已核销票的整单退不了,回包的 manualOrders 必须照实说,不能吞。 */
  openEndTopic() {
    const setting = this.data.setting;
    if (!setting || !setting.canManage) return;
    this.setData({ settingSheetVisible: false, endConfirmVisible: true, endErrorText: '' });
  },

  closeEndTopic() {
    if (this.data.endSubmitting) return;
    this.setData({ endConfirmVisible: false, endErrorText: '' });
  },

  confirmEndTopic() {
    if (this.data.endSubmitting || !this._topicId || !this._clubId) return;
    this.setData({ endSubmitting: true, endErrorText: '' });
    const that = this;
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/topic-setting/end', method: 'POST',
      data: jsonBody({ clubId: this._clubId, topicId: this._topicId }), header: jsonHeader(),
      success(res) {
        that.setData({ endSubmitting: false });
        if (!isSuccess(res) || !res.data) {
          // 后端的拒绝文案是写给主理人看的(「当前岗位没有这个权限」「主题状态刚刚变过」),非 200 原样回显;
          // 200 但缺 data 时 msg 是「操作成功」,不能当失败原因(2026-09-17 拍板)。
          that.setData({ endErrorText: bizFailureMessage(res, '没能结束，请重试。') });
          return;
        }
        const d = res.data;
        const failed = Array.isArray(d.failedSessions) ? d.failedSessions : [];
        if (failed.length) {
          // 有场次没退成:框不关,把是哪一场、为什么留在屏幕上,让人能再点一次
          that.setData({ endErrorText: failed.length + ' 场没能取消：' + failed[0] });
          return;
        }
        that.setData({ endConfirmVisible: false });
        toast(endResultText(d));
        that.fetchDetail();
        that.loadTopicSetting();
      },
      fail() { that.setData({ endSubmitting: false, endErrorText: '网络开小差了，没能结束。' }); },
    });
  },

  // 从「更多」进来时要先关掉「更多」,否则两张半屏叠在一起
  goRules() { this.setData({ settingSheetVisible: false, rulesSheetVisible: true }); },
  closeRules() { this.setData({ rulesSheetVisible: false }); },

  /* ——— Figma J4 主题 · 俱乐部设置 ——— */
  openTopicSetting() {
    if (!this._clubId || !this._topicId) { this.notReady('主题设置'); return; }
    this.setData({ settingSheetVisible: true, settingState: 'loading' });
    this.loadTopicSetting();
  },
  closeTopicSetting() { this.setData({ settingSheetVisible: false }); },

  loadTopicSetting() {
    const that = this;
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/topic-setting/detail', method: 'POST',
      data: jsonBody({ clubId: this._clubId, topicId: this._topicId }), header: jsonHeader(),
      success(res) {
        if (res && Number(res.code) === 403) { that.setData({ settingState: 'denied' }); return; }
        if (!isSuccess(res) || !res.data) { that.setData({ settingState: 'error' }); return; }
        that.setData({ settingState: 'ready', setting: that.buildSetting(res.data) });
      },
      fail() { that.setData({ settingState: 'error' }); },
    });
  },

  buildSetting(d) {
    return {
      topicName: d.topicName || '未命名主题',
      lifecycleText: d.lifecycleText || '',
      coopOpen: !!d.coopOpen,
      pinned: !!d.pinned,
      memberOnly: !!d.memberOnly,
      canManage: !!d.canManage,
      // 未开放的章节不显示「N 家」——那会让人以为已经招到了
      chapterRows: (Array.isArray(d.chapters) ? d.chapters : []).map(function (c) {
        return {
          id: c.chapterId,
          title: c.name || '未命名章节',
          value: c.recruiting
            ? ((c.category || '不限品类') + ' · ' + (Number(c.merchantCount) || 0) + ' 家')
            : '未开放',
          valueTone: c.recruiting ? 'default' : 'muted',
        };
      }),
    };
  },

  // 三个开关一起提交:后端少收一个就拒绝,不会把没传的那个当 false 关掉
  onSettingToggle(e) {
    const key = e.currentTarget.dataset.key;
    const before = this.data.setting;
    if (!before || !before.canManage || this.data.settingSaving) return;
    const next = Object.assign({}, before);
    next[key] = !!e.detail.value;
    this.setData({ setting: next, settingSaving: true });
    const that = this;
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/topic-setting/save', method: 'POST',
      data: jsonBody({
        clubId: this._clubId, topicId: this._topicId,
        coopOpen: next.coopOpen, pinned: next.pinned, memberOnly: next.memberOnly,
      }),
      header: jsonHeader(),
      success(res) {
        if (!isSuccess(res) || !res.data) {
          // 存不上就把开关拨回去:留在新位置等于骗人说存住了
          that.setData({ settingSaving: false, setting: before });
          toast(bizFailureMessage(res, '没能保存，请重试'));
          return;
        }
        that.setData({ settingSaving: false, setting: that.buildSetting(res.data) });
      },
      fail() { that.setData({ settingSaving: false, setting: before }); toast('网络开小差了，没能保存'); },
    });
  },

  // 5-04:fabu 的编辑入口只读 options.id(pages/publish/fabu/index.js onLoad),
  // 原来拼 ?topicId= 会打开空白新建表单 —— 保存多出一条主题,原主题没改。
  goEditTopic() { wx.navigateTo({ url: '/pages/publish/fabu/index?id=' + this._topicId }); },

  goChapterApplications() {
    if (!this.data.canReviewChapterApplications || !this._topicId) return;
    this.setData({ settingSheetVisible: false });
    wx.navigateTo({
      url: '/pages/topic/merchantinfo/merchantinfo?topicId=' + this._topicId + '&scope=CLUB',
    });
  },

  /* ——— Figma J3-A(按节点)/ J3-B(按章节)招商台 ——— */

  openTeamSheet() { this.setData({ teamSheetVisible: true }); },
  closeTeamSheet() { this.setData({ teamSheetVisible: false }); },
  openIncidentSheet() { this.setData({ incidentSheetVisible: true }); },
  closeIncidentSheet() { this.setData({ incidentSheetVisible: false }); },

  // 2026-09-07:后端补上了俱乐部专用的三个动作(CLUB_STATION_PAUSE / CLUB_STATION_RESUME /
  // CLUB_REJECT_SUBMISSION),这里不再是假提交。真正的写入在 director.js 的 submitIncident。
  confirmIncident() { this.submitIncident(); },

  onDirectorEndCancel() { this.setData({ directorEndConfirmShow: false }); },
  onDirectorEndConfirm() { this.setData({ directorEndConfirmShow: false }); this.onFinishSession(); },

  // 主题/俱乐部上下文缺失时的入场闸(正常从俱乐部进入走不到这里)。
  // 只说缺什么,不再报「还没有场次」—— 没场次的主键另有出口(见 resolvePrimary)。
  notReady(what) { toast(what + '：缺少俱乐部信息'); },

  ...DIRECTOR_METHODS,

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) { wx.navigateBack(); return; }
    wx.switchTab({ url: '/pages/index/index' });
  },
});
