// 漫游地图 · 附近的队伍(地图组队 P 方案,Figma txQoyVyKb3aQdFCnc8qmhj 590:1014 · P1–P6)。
// 地图只做展示层:挂票务组队(公开队伍),不能开新局(9-15 裁决,搭子局 A 下架)。
// 数据:GET /api/team/nearby(队伍点位)+ GET /api/roam/hangout/nearby(只取主题 / 活动点位,局一律不画)。
// 纯函数在 utils/map-team.js(卡片五态 / errorCode 分支 / P6 三态)与 utils/roam-hangout*.js(主题点位 canvas),本文件只做接线。
// ⚠️ 失败只按 errorCode 分支(map-team.resolveTeamError),走 cy-result-sheet 失败半屏,不解析 msg。
const app = getApp();
const { MAP_STYLE } = require('../../utils/map-style.js');
const { getCurrentLocation } = require('../../utils/location/location-manager.js');
const { isRecordList } = require('../../utils/response-shape.js');
const H = require('../../utils/roam-hangout.js');
const T = require('../utils/map-team.js');
const cyToast = require('../../utils/toast.js');
const modal = require('../../utils/modal.js');
const M = require('../../utils/roam-hangout-marker.js');
const { MAP_AVATAR_COLORS } = require('../../utils/play-visual-tokens.js');

const DEFAULT_CENTER = { lat: 31.2304, lng: 121.4737 };   // 定位拿不到时的兜底中心(人民广场),只用于首屏,不落库
/* 稿 591:1020 的角控件写死「范围 1 km」⇒ 首屏默认就是 1 km,不取 /api/team/nearby 的 3000 缺省。
 * data.scale 初值 14 本来就是按 1 km 画的(见 onRangePick 的档位表),原来 3000 与它对不上。 */
const DEFAULT_RADIUS = 1000;
const ACTIVITY_PAGE = '/pages/activity/detail/index';
const TOPIC_PAGE = '/pages/topic/index/index';
const TEAM_PAGE = '/pages/team/detail/index';
const JSON_HEADER = { 'Content-Type': 'application/json' };
const RANGE_ITEMS = T.RADII.map((r) => T.rangeText(r).replace('范围 ', ''));

function safeBottom() {
  try {
    const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return Math.max(0, (w.screenHeight || 0) - ((w.safeArea && w.safeArea.bottom) || w.screenHeight || 0));
  } catch (e) { return 0; }
}

function hudTop() {
  try {
    const r = wx.getMenuButtonBoundingClientRect();
    return (r && r.bottom ? r.bottom : 80) + 10;
  } catch (e) { return 90; }
}

function emptyResult() {
  return { show: false, kind: 'fail', title: '', why: '', primaryText: '', secondaryText: '' };
}

Page({
  data: {
    safeBottom: 0,
    hudTop: 90,
    fmSubkey: MAP_STYLE.subkey,
    fmLayerStyle: MAP_STYLE.layerStyle,
    center: DEFAULT_CENTER,
    scale: 14,
    markers: [],
    circles: [],
    headerText: T.headerText(0),
    rangeText: T.rangeText(DEFAULT_RADIUS),
    myTeamsText: T.myTeamsText(0),
    rangeItems: RANGE_ITEMS,
    rangeIndex: T.RADII.indexOf(DEFAULT_RADIUS),
    rangeSheetShow: false,
    loadError: false,
    /* sheet = '' | team(P2/P3/P4/被拒/已加入)| leader(P5)| mine(P6)| topic。非空时底部角控件收起。 */
    sheet: '',
    sheetIn: false,
    current: null,
    busy: false,
    applicants: [],
    leaderSub: '',
    leaderFoot: '',
    myRows: [],
    myLoading: false,
    topic: null,
    resultSheet: emptyResult(),
  },

  onLoad(options) {
    const requestedRadius = Number(options && options.radius); this._radius = T.RADII.indexOf(requestedRadius) >= 0 ? requestedRadius : DEFAULT_RADIUS; this._requestedTeamId = options && options.teamId;
    this._teams = [];        // /api/team/nearby 原始行(只在内存,视图走 T.decorateTeam 白名单)
    this._items = [];        // 主题 / 活动点位
    this._icons = {};
    this._far = {};
    this._iconFailed = {};
    this._selfIcon = '';
    this._me = null;
    this.setData({ safeBottom: safeBottom(), hudTop: hudTop(), rangeText: T.rangeText(this._radius), rangeIndex: T.RADII.indexOf(this._radius) });
    const that = this; const linkedLat = H.numOrNull(options && options.lat); const linkedLng = H.numOrNull(options && options.lng);
    if (linkedLat != null && linkedLng != null) { const center = { lat: linkedLat, lng: linkedLng }; this.setData({ center, circles: H.buildRangeCircle(center) }); this.refresh(center); this.loadMyTeams(false); return; }
    getCurrentLocation({
      onSuccess(res) {
        const c = { lat: res.latitude, lng: res.longitude };
        that._me = c;
        that.setData({ center: c, circles: H.buildRangeCircle(c) });
        that.refresh(c);
      },
      onFail() { that.refresh(that.data.center); },
    }); this.loadMyTeams(false);
  },

  /* 买完票回到地图,卡片要从「去买这场的票」变成「申请加入」(P2 底注):回前台重拉一次。 */
  onShow() { if (this._shownOnce) this.refresh(this.data.center); this._shownOnce = true; },

  onUnload() { if (this._regionTimer) clearTimeout(this._regionTimer); },

  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/roam/index' });
  },

  refresh(center) {
    this.fetchTeams(center, this._radius);
    this.fetchTopics(center, this._radius);
  },

  retryNearby() { this.refresh(this.data.center); },

  /* ---------- 数据 ---------- */

  fetchTeams(center, radius) {
    const that = this;
    const seq = (this._teamSeq = (this._teamSeq || 0) + 1);
    app.sendRequest({
      url: '/api/team/nearby', method: 'GET', hideLoading: true, silentError: true,
      data: { lat: center.lat, lng: center.lng, radius },
      success(res) {
        if (seq !== that._teamSeq) return;   // 拖图过程中的旧响应丢弃
        if (!(res && res.code == 200 && Array.isArray(res.data))) { that.setData({ loadError: true }); return; }
        that._teams = res.data.filter(Boolean);
        that._syncTeams(); if (that._requestedTeamId) { const teamId = that._requestedTeamId; that._requestedTeamId = null; that.openTeam(teamId); }
        that._queueIcons(() => that._genTeamIcons()).then((made) => { if (made && seq === that._teamSeq) that._syncMarkers(); });
      },
      fail() { if (seq === that._teamSeq) that.setData({ loadError: true }); },
    });
  },

  /* 主题 / 活动点位沿用漫游附近接口;接口里存量的局(kind=hangout)不再画 —— 地图上不存在「局」了。 */
  fetchTopics(center, radius) {
    const that = this;
    const seq = (this._topicSeq = (this._topicSeq || 0) + 1);
    app.sendRequest({
      url: '/api/roam/hangout/nearby', method: 'GET', hideLoading: true, silentError: true,
      data: { lat: center.lat, lng: center.lng, radius },
      success(res) {
        if (seq !== that._topicSeq) return;
        const d = res && res.code == 200 && res.data ? res.data : null;
        if (!d) return;                      // 主题层拉不到只是少一层点,队伍层照常
        that._items = (isRecordList(d.items) ? d.items : []).filter((it) => it && it.kind !== 'hangout');
        that._syncMarkers();
        that._queueIcons(() => that._genIcons(that._items)).then((made) => { if (made && seq === that._topicSeq) that._syncMarkers(); });
      },
    });
  },

  _syncTeams() {
    const teams = this._teams || [];
    const cur = this.data.current;
    const row = cur && teams.find((t) => String(t.teamId) === String(cur.teamId));
    const next = row ? T.decorateTeam(row) : cur;
    this.setData({ loadError: false, headerText: T.headerText(teams.length), current: next,
      leaderSub: next ? T.leaderSub(next) : '', leaderFoot: next ? T.leaderFoot(next) : '' });
    // 卡片开着的那支队伍刷新后不在了(满员 / 开场 / 审核中,服务端已过滤):卡上的「申请加入」已经不成立,收掉
    if (cur && !row && this.data.sheet === 'team') this.closeSheet();
    this._syncMarkers();
  },

  _syncMarkers() {
    const fallback = H.HANGOUT_FALLBACK_ICON;
    this.setData({
      markers: H.buildHangoutMarkers(this._items, this._icons, this._far)
        .concat(T.buildTeamMarkers(this._teams, this._icons, this._far[MAP_AVATAR_COLORS.cream] || fallback))
        .concat(H.buildSelfMarker(this._me, this._selfIcon)),
    });
  },

  /* ---------- marker 图标(离屏 canvas) ---------- */

  _canvas() {
    return new Promise((res, rej) => {
      wx.createSelectorQuery().select('#teamcv').fields({ node: true }).exec((r) =>
        (r && r[0] && r[0].node ? res(r[0].node) : rej(new Error('no teamcv'))));
    });
  },

  _loadImage(cv, src) {
    return new Promise((res, rej) => {
      const img = cv.createImage();
      const timer = setTimeout(() => rej(new Error('timeout')), 6000);
      img.onload = () => { clearTimeout(timer); res(img); };
      img.onerror = () => { clearTimeout(timer); rej(new Error('load fail')); };
      img.src = src;
    });
  },

  _save(cv) {
    return new Promise((res, rej) => wx.canvasToTempFilePath({ canvas: cv, fileType: 'png', success: (r) => res(r.tempFilePath), fail: rej }));
  },

  /* 两个生成器共用 #teamcv 一张画布,并发会互相清掉 cv.width —— 串行排队,晚到的批次排在后面照样生成。 */
  _queueIcons(job) {
    const run = (this._iconQueue || Promise.resolve()).then(job, job);
    this._iconQueue = run.catch(() => false);
    return run;
  },

  /* 队伍点位:圆头像(队长)+ 人数角标。头像下不来就画首字,一个点都不少。 */
  async _genTeamIcons() {
    const need = (this._teams || []).filter((t) => !this._icons[T.teamIconKey(t)]).slice(0, M.ICON_MAX);
    const wantFar = !this._far[MAP_AVATAR_COLORS.cream];
    if (!need.length && !wantFar) return false;
    let made = 0;
    try {
      const cv = await this._canvas();
      if (wantFar) {
        cv.width = 28; cv.height = 28;
        try { M.drawFarDot(cv.getContext('2d'), 28, MAP_AVATAR_COLORS.cream); this._far[MAP_AVATAR_COLORS.cream] = await this._save(cv); made++; } catch (e) { /* 兜底图 */ }
      }
      const S = 108; cv.width = S; cv.height = S;
      const g = cv.getContext('2d');
      for (const t of need) {
        let img = null;
        const url = t.leaderAvatar ? app.getImgUrl(t.leaderAvatar) : '';
        if (url && !this._iconFailed[url]) { try { img = await this._loadImage(cv, url); } catch (e) { this._iconFailed[url] = true; } }
        try { M.drawMarker(g, S, T.teamMarkerSpec(t), img); this._icons[T.teamIconKey(t)] = await this._save(cv); made++; } catch (e) { /* 留给远距点 */ }
      }
    } catch (e) { /* canvas 拿不到:全部走远距点 */ }
    return made > 0;
  },

  /* 主题 / 活动点位(照片瓦片 + 玩法描边),画法与漫游同源。 */
  async _genIcons(raw) {
    const need = new Map();
    const farNeed = new Set();
    (raw || []).forEach((it) => {
      const spec = M.markerSpec(it);
      if (!this._far[spec.color]) farNeed.add(spec.color);
      const near = it.distance != null && Number(it.distance) <= M.NEAR_M;
      const key = M.iconKey(spec, spec.initial);
      if (near && !this._icons[key] && need.size < M.ICON_MAX) need.set(key, { spec, url: it.picUrl ? app.getImgUrl(it.picUrl) : '' });
    });
    const wantSelf = !this._selfIcon && !!this._me;
    if (!need.size && !farNeed.size && !wantSelf) return false;
    let made = 0;
    try {
      const cv = await this._canvas();
      cv.width = 28; cv.height = 28;
      let g = cv.getContext('2d');
      for (const color of farNeed) {
        try { M.drawFarDot(g, 28, color); this._far[color] = await this._save(cv); made++; } catch (e) { /* 兜底图 */ }
      }
      const S = 108; cv.width = S; cv.height = S;
      g = cv.getContext('2d');
      if (wantSelf) {
        let me = null;
        const av = app.getImgUrl(app.globalData.avatar || '');
        if (av && !this._iconFailed[av]) { try { me = await this._loadImage(cv, av); } catch (e) { this._iconFailed[av] = true; } }
        try { M.drawMarker(g, S, { role: 'player', state: 'joined', color: MAP_AVATAR_COLORS.player, initial: '我', self: true }, me); this._selfIcon = await this._save(cv); made++; } catch (e) { /* 没有自己的点也不影响队伍 */ }
      }
      for (const [key, n] of need) {
        let img = null;
        if (n.url && !this._iconFailed[n.url]) { try { img = await this._loadImage(cv, n.url); } catch (e) { this._iconFailed[n.url] = true; } }
        try { M.drawMarker(g, S, n.spec, img); this._icons[key] = await this._save(cv); made++; } catch (e) { /* 留给远距点 */ }
      }
    } catch (e) { /* canvas 拿不到:全部走远距点 */ }
    return made > 0;
  },

  /* ---------- 地图 ---------- */

  onMarkerTap(e) {
    const markerId = Number(e.detail && e.detail.markerId);
    if (markerId % 10 === T.TEAM_MARKER_TAG) { this.openTeam(Math.floor(markerId / 10)); return; }
    const hit = H.parseMarkerId(markerId);
    if (!hit) return;
    if (hit.kind === 'activity') { wx.navigateTo({ url: ACTIVITY_PAGE + '?id=' + encodeURIComponent(hit.id) }); return; }
    if (hit.kind === 'topic') this.openTopicCard(hit.id);
  },

  onRegionChange(e) {
    const d = e.detail || {};
    if (d.phase !== 'end' || !d.centerLocation) return;
    if (d.causedBy !== 'drag' && d.causedBy !== 'scale') return;
    const c = { lat: d.centerLocation.latitude, lng: d.centerLocation.longitude };
    if (this._regionTimer) clearTimeout(this._regionTimer);
    this._regionTimer = setTimeout(() => {
      this._regionTimer = null;
      this.setData({ center: c });
      this.refresh(c);
    }, 600);
  },

  /* ---------- 角控件:范围 / 我的队伍 ---------- */

  openRange() { this.setData({ rangeSheetShow: true }); },
  closeRange() { this.setData({ rangeSheetShow: false }); },
  onRangePick(e) {
    const idx = Number(e.detail && e.detail.index);
    const r = T.RADII[idx];
    if (!r) { this.closeRange(); return; }
    this._radius = r;
    this.setData({ rangeSheetShow: false, rangeIndex: idx, rangeText: T.rangeText(r), scale: r >= 10000 ? 11 : r >= 5000 ? 12 : r >= 3000 ? 13 : 14 });
    this.refresh(this.data.center);
  },

  /* ---------- 半屏壳 ---------- */

  _openSheet(name) {
    if (this._sheetInTimer) { clearTimeout(this._sheetInTimer); this._sheetInTimer = null; }
    this.setData({ sheet: name, sheetIn: false });
    this._sheetInTimer = setTimeout(() => this.setData({ sheetIn: true }), 20);
  },
  closeSheet() {
    if (this._sheetInTimer) { clearTimeout(this._sheetInTimer); this._sheetInTimer = null; }
    this.setData({ sheet: '', sheetIn: false });
  },
  /* 半屏本体吃掉冒泡,免得点正文把自己关了。 */
  noop() {},

  /* ---------- 队伍卡(P2/P3/P4/被拒/已加入)与 P5 ---------- */

  openTeam(teamId) {
    const row = (this._teams || []).find((t) => String(t.teamId) === String(teamId));
    if (!row) return;
    const cur = T.decorateTeam(row);
    if (cur.viewerStatus === 'LEADER') {
      this.setData({ current: cur, applicants: [], leaderSub: T.leaderSub(cur), leaderFoot: T.leaderFoot(cur) }, () => this._openSheet('leader'));
      this.loadApplicants();
    } else {
      this.setData({ current: cur }, () => this._openSheet('team'));
    }
  },

  _patchCurrent(patch) {
    const cur = this.data.current;
    if (!cur) return;
    const row = (this._teams || []).find((t) => String(t.teamId) === String(cur.teamId));
    if (row) Object.assign(row, patch);
    this.setData({ current: T.decorateTeam(row || Object.assign({}, cur, patch)) });
    this._syncMarkers();
  },

  _dropCurrent() {
    const cur = this.data.current;
    if (cur) this._teams = (this._teams || []).filter((t) => String(t.teamId) !== String(cur.teamId));
    this.closeSheet();
    this.setData({ headerText: T.headerText((this._teams || []).length) });
    this._syncMarkers();
  },

  onCardPrimary() {
    const cur = this.data.current;
    const btn = cur && cur.card && cur.card.primary;
    if (!btn) return;
    if (btn.action === 'buy') this._goBuy(cur);
    else if (btn.action === 'apply') this.apply();
    else if (btn.action === 'enter') wx.navigateTo({ url: TEAM_PAGE + '?teamId=' + encodeURIComponent(cur.teamId) });
  },

  onCardSecondary() {
    const cur = this.data.current;
    const btn = cur && cur.card && cur.card.secondary;
    if (btn && btn.action === 'withdraw') this.withdraw(cur.teamId);
  },

  /* 买票 = 这支队伍挂的那一场的详情页(购票在那儿),买完回来 onShow 重拉。 */
  _goBuy(cur) {
    if (!cur) return;
    if (cur.activityId) wx.navigateTo({ url: ACTIVITY_PAGE + '?id=' + encodeURIComponent(cur.activityId) });
    else if (cur.topicId) wx.navigateTo({ url: TOPIC_PAGE + '?id=' + encodeURIComponent(cur.topicId) });
  },

  _post(url, body, op, onOk, onFail) {
    if (this.data.busy) return;
    const that = this;
    this.setData({ busy: true });
    app.sendRequest({
      url, method: 'POST', hideLoading: true, silentError: true,
      data: JSON.stringify(body), header: JSON_HEADER,
      success(res) {
        that.setData({ busy: false });
        if (res && res.code == 200) { onOk(res); return; }
        const r = T.resolveTeamError(op, res);
        if (onFail) onFail(r);
        that._showFail(r);
      },
      fail(res) { that.setData({ busy: false }); that._showFail(T.resolveTeamError(op, res)); },
    });
  },

  apply() {
    const cur = this.data.current;
    if (!cur || this.data.busy) return;
    const that = this;
    // 申请留言(可选,≤200 字;后端 trimToNull + 内容安全机审):
    // 陌生队伍先自报来意,队长在 P5 审批行按留言决定同不同意。空留言照旧只发 teamId。
    modal.show({
      title: '申请加入「' + cur.name + '」',
      content: '队长会看到你这句话,一起出发后用微信群沟通。',
      editable: true,
      placeholderText: '想跟队长说一句(可选):同场打算、几个人…',
      maxlength: 200,
      confirmText: '提交申请',
      success(r) {
        if (!r.confirm) return;
        const message = String(r.content || '').trim();
        const body = { teamId: Number(cur.teamId) };
        if (message) body.message = message;
        that._post('/api/team/apply', body, 'apply',
          // 服务端回执带 applyExpireTime(真实失效时刻 = min(申请+24h, 场次开始)),卡片据此说剩余时间
          (res) => that._patchCurrent({ viewerStatus: 'PENDING', applyExpireTime: res && res.data && res.data.applyExpireTime }),
          (err) => that._applyErrorToCard(err));
      },
      fail: () => cyToast('操作确认没有打开，请重试'),
    });
  },

  _applyErrorToCard(r) {
    if (r.dropTeam) { this._dropCurrent(); return; }
    if (r.patch) this._patchCurrent(r.patch);
  },

  withdraw(teamId, done) {
    this._post('/api/team/withdraw', { teamId: Number(teamId) }, 'withdraw',
      () => {
        const cur = this.data.current;
        if (cur && String(cur.teamId) === String(teamId)) this._patchCurrent({ viewerStatus: 'NONE' });
        if (done) done();
      },
      (r) => { if (r.refresh) this.refresh(this.data.center); if (done) done(); });
  },

  loadApplicants() {
    const cur = this.data.current;
    if (!cur) return;
    const that = this;
    app.sendRequest({
      url: '/api/team/applications', method: 'POST', hideLoading: true, silentError: true,
      data: JSON.stringify({ teamId: Number(cur.teamId) }), header: JSON_HEADER,
      success(res) {
        const now = that.data.current;
        if (!now || String(now.teamId) !== String(cur.teamId)) return;   // 已经切到别的队伍,旧列表丢弃
        if (!(res && res.code == 200 && Array.isArray(res.data))) { that._showFail(T.resolveTeamError('applications', res)); return; }
        that.setData({ applicants: T.applicantRows(res.data) });
      },
      fail(res) { that._showFail(T.resolveTeamError('applications', res)); },
    });
  },

  onHandle(e) {
    const cur = this.data.current;
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!cur || !ds.id) return;
    const memberId = Number(ds.id);
    const approved = ds.ok === true || ds.ok === 'true';
    const drop = () => this.setData({ applicants: this.data.applicants.filter((a) => Number(a.memberId) !== memberId) });
    this._post('/api/team/handle', { teamId: Number(cur.teamId), memberId, approved }, 'handle',
      () => {
        drop();
        // 同意会让人数变、满员会让队伍从地图消失 —— 以服务端为准重拉
        if (approved) this.refresh(this.data.center);
      },
      (r) => { if (r.dropApplicant) drop(); if (r.refresh) this.refresh(this.data.center); });
  },

  /* ---------- P6 我的队伍 ---------- */

  openMyTeams() {
    this._openSheet('mine');
    this.loadMyTeams(true);
  },

  /* 角控件计数也靠它:onLoad 静默拉一次(不弹失败),打开 P6 / 撤回后再拉。 */
  loadMyTeams(showFail) {
    this.setData({ myLoading: true });
    const that = this;
    let joined = null; let apps = null; let pending = 2;
    const settle = () => {
      pending -= 1;
      if (pending) return;
      const rows = T.myTeamRows(joined || [], apps || []);
      that.setData({ myRows: rows, myLoading: false, myTeamsText: T.myTeamsText(rows.filter((r) => r.tone !== 'bad').length) });
      if (showFail && joined == null && apps == null) that._showFail(T.resolveTeamError('my', null));
    };
    // 两条都读不到时 settle 里弹失败半屏;只读到一条就先显示那一条。
    app.sendRequest({
      url: '/api/team/my', method: 'POST', hideLoading: true, silentError: true, data: JSON.stringify({}), header: JSON_HEADER,
      success(res) { if (res && res.code == 200 && Array.isArray(res.data)) joined = res.data; settle(); },
      fail() { settle(); },
    });
    app.sendRequest({
      url: '/api/team/my-applications', method: 'POST', hideLoading: true, silentError: true, data: JSON.stringify({}), header: JSON_HEADER,
      success(res) { if (res && res.code == 200 && Array.isArray(res.data)) apps = res.data; settle(); },
      fail() { settle(); },
    });
  },

  onMyRowAction(e) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index);
    const row = this.data.myRows[idx];
    if (!row) return;
    if (row.action.act === 'enter') { wx.navigateTo({ url: TEAM_PAGE + '?teamId=' + encodeURIComponent(row.teamId) }); return; }
    if (row.action.act === 'nearby') { this.closeSheet(); return; }
    if (row.action.act === 'withdraw') this.withdraw(row.teamId, () => this.loadMyTeams(false));
  },

  /* ---------- 失败半屏(cy-result-sheet kind=fail) ---------- */

  _showFail(r) {
    this._resultAction = r.primaryAction || '';
    this.setData({ resultSheet: { show: true, kind: 'fail', title: r.title, why: r.why, primaryText: r.primary, secondaryText: r.secondary } });
  },
  onResultClose() { this._resultAction = ''; this.setData({ resultSheet: emptyResult() }); },
  onResultPrimary() {
    const act = this._resultAction;
    this.onResultClose();
    if (act === 'buy') this._goBuy(this.data.current);
  },

  /* ---------- 主题半屏 ---------- */

  openTopicCard(id) {
    const row = (this._items || []).find((it) => String(it.id) === String(id) && it.kind === 'topic');
    if (!row) { wx.navigateTo({ url: TOPIC_PAGE + '?id=' + encodeURIComponent(id) }); return; }
    const free = Number(row.productType) === 2;
    this.setData({
      topic: {
        id: row.id,
        tag: free ? '自由探索' : '城市定向',
        tone: free ? 'free' : 'city',
        eyebrow: [row.addressName, H.fmtKm(row.distance)].filter(Boolean).join(' · '),
        title: row.name || '',
        desc: row.description || (free ? '不规定顺序、不要求一天跑完，只用一家也成立。' : '按顺序一站站走完。'),
        pics: [app.getImgUrl(row.picUrl || '')].filter(Boolean),
      },
    }, () => this._openSheet('topic'));
  },
  openTopicPage() {
    const t = this.data.topic;
    if (t && t.id) wx.navigateTo({ url: TOPIC_PAGE + '?id=' + encodeURIComponent(t.id) });
  },
});
