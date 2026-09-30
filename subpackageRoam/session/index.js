// 城瘾 · 单次漫游回看 —— 读 roam_sessions 里指定 ts 的一次记录
const modal = require('../../utils/modal.js');
const loading = require('../../utils/loading.js');
const toast = require('../../utils/toast.js');
const { ROUTE_COLORS, ROUTE_BORDER_COLOR } = require('../../utils/play-visual-tokens.js');
const { currentPlayerRoamMemory } = require('../../utils/roam-player-memory.js');
const { clipSavedTrackForSharing, readSharePrivacy } = require('../../utils/roam-route-privacy.js');
const { readNonNegative } = require('../../utils/roam-history-metrics.js');
const { limitTrack } = require('../../utils/roam-track-simplify.js');
const { publishShareSnapshot, readShareSnapshot } = require('../../utils/roam-share-snapshot.js');
const app = typeof getApp === 'function' ? getApp() : { globalData: {} };
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
// 路线图画布(ss-map:750-80=670rpx 宽,520rpx 高)
const MW = 670, MH = 520, PAD = 60;
// Canvas 读不到 WXSS token；这里逐字同步 Figma 浅色叙事 token(220:1415)，
// 不再让分享卡回退到旧的黑色路线舞台。
const SHARE_CARD = Object.freeze({
  width: 750,
  height: 1000,
  scale: 2,
  bgStart: '#FFFFFF',
  bgEnd: '#F6F7FA',
  mapBg: '#F6F7FA',
  primary: '#121317',
  route: '#4B46F5',
  secondary: '#4B46F5',
  tertiary: '#646B78',
  muted: '#8C91A0',
  ring: '#FFFFFF',
  poi: ['#4B46F5', '#8C91A0', '#646B78', '#121317'],
});

function sharePath(token) {
  return '/subpackageRoam/session/index?shareToken=' + token;
}

Page({
  // err: '' | 'read'(storage 读失败) | 'notfound'(ts 对应的记录不存在)
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    ts: '',
    s: { pois: [] },
    segs: [],
    poiDots: [],
    err: '',
    share: { show: false, drawing: false, imagePath: '', error: '', retrySave: false, saving: false, token: '', linkReason: '' },
    // 第二轮拍板 17:朋友分享进来(带 shareToken)时只读快照 —— sharedState: '' 非分享 | loading | ready | gone | error
    sharedState: '',
    snapshot: null,
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad(options) {
    this._ts = Number(options && options.ts);
    this.setData({
      ts: (options && options.ts) || '',
      statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44,
    });
    this._shareToken = (options && options.shareToken) || '';
    if (this._shareToken) this._loadShared();
    else this._load();
  },

  // 朋友分享进来:不读本机(那是分享者的记录),只读服务端快照;未登录也能看。
  _loadShared() {
    this.setData({ sharedState: 'loading' });
    return readShareSnapshot(getApp(), this._shareToken).then((result) => {
      if (result.state !== 'ready' || !this._isValidSession(result.session)) {
        this.setData({ sharedState: result.state === 'error' ? 'error' : 'gone', snapshot: null });
        return false;
      }
      const d = new Date(Number(result.session.ts));
      this.setData({
        sharedState: 'ready',
        snapshot: result.session,
        s: {
          pois: [],
          routeName: result.session.routeName || '城市漫游足迹',
          completeFact: '已完成本次漫游',
          time: result.session.time || '—',
          dateFull: Number.isNaN(d.getTime()) ? '日期不可用' : `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`,
        },
      });
      return true;
    });
  },

  retryShared() { return this._loadShared(); },

  _isValidCoordinate(value, max) {
    const primitive = typeof value === 'number'
      || (typeof value === 'string' && value.trim() !== '');
    if (!primitive) return false;
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= max;
  },

  _isValidPoint(point) {
    return !!point && typeof point === 'object' && !Array.isArray(point)
      && this._isValidCoordinate(point.lat, 90)
      && this._isValidCoordinate(point.lng, 180);
  },

  _isValidSession(raw) {
    const timestamp = raw && raw.ts;
    const timestampPrimitive = typeof timestamp === 'number'
      || (typeof timestamp === 'string' && timestamp.trim() !== '');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !timestampPrimitive || !Number.isFinite(Number(timestamp))) return false;
    return ['pois', 'track'].every((key) => {
      const points = raw[key];
      if (points == null) return true;
      if (!Array.isArray(points)) return false;
      for (let i = 0; i < points.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(points, i) || !this._isValidPoint(points[i])) return false;
      }
      return true;
    });
  },

  _clearSessionView(err) {
    this._shareEpoch = (this._shareEpoch || 0) + 1;
    this._saveInFlight = null;
    const share = this.data && this.data.share;
    if (share && (share.drawing || share.saving)) loading.hide();
    this.setData({
      err,
      s: { pois: [] },
      segs: [],
      poiDots: [],
      'share.show': false,
      'share.drawing': false,
      'share.imagePath': '',
      'share.error': '',
      'share.retrySave': false,
      'share.saving': false,
    });
  },

  _setSessionView(raw) {
    if (!this._isValidSession(raw)) return false;
    this._sessionOwner = String(getApp().getUserID() || '');
    const s = Object.assign({}, raw, {
      pois: (raw.pois || []).map((poi) => Object.assign({}, poi, {
        iconName: poi.cat === 'merchant' ? 'poi-shop' : (poi.cat === 'park' ? 'poi-park' : 'poi-landmark'),
      })),
    });

    const d = new Date(Number(s.ts));
    const validDate = !Number.isNaN(d.getTime());
    s.dateFull = validDate ? `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}` : '日期不可用';
    s.time = s.time || this._fmt(s.durSec);
    const zone = String(s.zone || '').trim();
    const poiNames = s.pois.map((poi) => String(poi.name || '').trim()).filter(Boolean);
    // 现有落盘记录的 zone 固定为“这片街区”，不能把占位区名冒充真实足迹名；
    // 优先用本次真实点亮地点命名；没有地点时才以记录日期命名，不依赖后端补字段。
    s.routeName = zone && zone !== '这片街区'
      ? zone
      : (poiNames.length > 1
        ? `${poiNames[0]}等${poiNames.length}处足迹回看`
        : (poiNames.length === 1
          ? `${poiNames[0]}周边足迹回看`
          : (validDate ? `${d.getMonth() + 1}月${d.getDate()}日城市漫游足迹` : '城市漫游足迹')));
    s.distance = readNonNegative(s.distance);
    s.distanceText = s.distance === null ? '—' : String(s.distance);
    s.completeFact = '已完成本次漫游';

    this.setData({ err: '', s, ...this._route(s) });
    return true;
  },

  // 读失败与"这条记录不存在"必须各自可见:两者都退成空 session 的话,
  // 页面会拿一张 0km/无足迹的漂亮空卡冒充"你这次真的没走"。
  onShow() {
    if (this._shareToken) return;
    if (this._sessionOwner !== String(getApp().getUserID() || '')) this._load();
  },

  _load() {
    const owner = String(getApp().getUserID() || '');
    if (this._sessionOwner !== owner) this._clearSessionView('notfound');
    this._sessionOwner = owner;
    let stored;
    try {
      const sessionState = currentPlayerRoamMemory(getApp(), wx).readSessionState();
      if (!sessionState.ok) throw new Error('漫游记录存储损坏');
      stored = sessionState.sessions;
    } catch (e) {
      this._clearSessionView('read');
      return;
    }
    // 微信未命中 key 时可能回空字符串；这和 null/undefined 一样表示没有历史记录。
    const sessions = stored == null || stored === '' ? [] : stored;
    if (!Array.isArray(sessions)) {
      this._clearSessionView('read');
      return;
    }
    const raw = sessions.find(x => x && typeof x === 'object' && !Array.isArray(x) && Number(x.ts) === this._ts);
    // 找不到就退 sessions[0] 会把"另一次漫游"冒充成用户点的那次,比空态更坏。
    if (!raw) {
      this._clearSessionView('notfound');
      return;
    }
    if (!this._setSessionView(raw)) {
      this._clearSessionView('read');
    }
  },

  _fmt(sec) {
    sec = sec || 0;
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  },

  // 轨迹 + POI 一起做 bbox 归一化居中(lat/lng → 卡内 rpx)
  //
  // ⚠️ 本页 data.segs/poiDots 的**唯一**消费方是分享足迹卡(sheet 里那张预览 + 导出 canvas
  //    共用同一份,见 index.wxml ss-card-route / _drawShareCard)。页面正文的回放是
  //    cy-scene-roam-session 自己算的,不走这里。所以位置隐私裁剪放在这一层:
  //    进这里的就是要给别人看的轨迹,首尾各裁掉设置里的比例。
  _route(s) {
    const track = limitTrack(clipSavedTrackForSharing(s.track || [], readSharePrivacy(wx)));
    if (track.length < 2) return { segs: [], poiDots: [] };
    const lat0 = track[0].lat;
    const kx = Math.cos(lat0 * Math.PI / 180);
    const M = p => ({ x: p.lng * kx, y: -p.lat });
    const tp = track.map(M);
    const pp = (s.pois || []).filter(p => p.lat).map(M);
    const all = tp.concat(pp);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    all.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    const sc = Math.min((MW - PAD * 2) / Math.max(1e-9, x1 - x0), (MH - PAD * 2) / Math.max(1e-9, y1 - y0));
    const ox = (MW - (x1 - x0) * sc) / 2 - x0 * sc;
    const oy = (MH - (y1 - y0) * sc) / 2 - y0 * sc;
    const X = p => p.x * sc + ox, Y = p => p.y * sc + oy;
    const segs = [];
    for (let i = 1; i < tp.length; i++) {
      const ax = X(tp[i - 1]), ay = Y(tp[i - 1]), bx = X(tp[i]), by = Y(tp[i]);
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 2) continue;
      segs.push({ i, x: Math.round(ax), y: Math.round(ay), len: Math.round(len) + 2, deg: Math.round(Math.atan2(by - ay, bx - ax) * 180 / Math.PI) });
    }
    const poiDots = pp.map((p, i) => ({ i, x: Math.round(X(p)), y: Math.round(Y(p)), color: SHARE_CARD.poi[i % SHARE_CARD.poi.length] }));
    return { segs, poiDots };
  },

  share() {
    if (this._shareDestroyed) return Promise.resolve({ ok: false, imagePath: '' });
    this._load();
    if (this.data.err || !this.data.s || this.data.s.ts == null) {
      this.setData({
        share: {
          show: true,
          drawing: false,
          imagePath: '',
          error: '这次漫游记录无法生成足迹卡',
          retrySave: false,
          saving: false,
        },
      });
      return Promise.resolve({ ok: false, imagePath: '' });
    }
    this._saveInFlight = null;
    // 裁剪比例可能在上次算完之后被改过;缓存住的 segs 是**旧设置**下的轨迹,重算一次。
    // ⚠️ 逐字段写,不用 `...this._route()` 展开:展开会新增一条 UI-GATE-0 的动态 setData 债务。
    const route = this._route(this.data.s);
    this.setData({
      segs: route.segs,
      poiDots: route.poiDots,
      share: { show: true, drawing: true, imagePath: '', error: '', retrySave: false, saving: false, token: '', linkReason: '' },
    });
    // 每次打开都重新发布:快照按**当前**裁剪设置重算(服务端按足迹 ts 更新同一令牌)。
    this._sharePublish = null;
    this._ensureShareToken();
    return this._prepareShareCard();
  },

  /** 第二轮拍板 17:发布分享快照,拿到令牌后分享 path 直达这条足迹。同一次分享只发一次。 */
  _ensureShareToken() {
    if (this._shareToken || this.data.err || !this.data.s || this.data.s.ts == null) return Promise.resolve('');
    if (this._sharePublish) return this._sharePublish;
    const owner = this._sessionOwner;
    const ts = this.data.s.ts;
    const pending = publishShareSnapshot(getApp(), wx, this.data.s).then(({ token, reason }) => {
      if (this._shareDestroyed || owner !== String(getApp().getUserID() || '') || !this.data.s || this.data.s.ts !== ts) return '';
      if (!token && this._sharePublish === pending) this._sharePublish = null;
      this.setData({ 'share.token': token, 'share.linkReason': reason });
      return token;
    });
    this._sharePublish = pending;
    return pending;
  },

  retryShareLink() {
    this._sharePublish = null;
    return this._ensureShareToken();
  },

  closeShare() {
    this._shareEpoch = (this._shareEpoch || 0) + 1;
    this._saveInFlight = null;
    const share = this.data && this.data.share;
    if (share && (share.drawing || share.saving)) loading.hide();
    if (!this._shareDestroyed) {
      this.setData({
        'share.show': false,
        'share.drawing': false,
        'share.imagePath': '',
        'share.error': '',
        'share.retrySave': false,
        'share.saving': false,
      });
    }
  },

  onUnload() {
    this._shareDestroyed = true;
    this._shareEpoch = (this._shareEpoch || 0) + 1;
    this._saveInFlight = null;
    const share = this.data && this.data.share;
    if (share && (share.drawing || share.saving)) loading.hide();
  },

  _isShareCurrent(token) {
    return !this._shareDestroyed && token === (this._shareEpoch || 0)
      && this._sessionOwner === String(getApp().getUserID() || '');
  },

  _prepareShareCard() {
    if (!this._isShareCurrent(this._shareEpoch || 0)) {
      if (!this._shareDestroyed) this._clearSessionView('notfound');
      return Promise.resolve({ ok: false, imagePath: '' });
    }
    this._saveInFlight = null;
    const token = (this._shareEpoch || 0) + 1;
    this._shareEpoch = token;
    loading.show('生成足迹卡');
    this.setData({ 'share.drawing': true, 'share.error': '', 'share.retrySave': false, 'share.saving': false });
    return Promise.resolve().then(() => this._drawShareCard()).then((imagePath) => {
      if (typeof imagePath !== 'string' || !imagePath.trim()) throw new Error('empty session share card path');
      if (!this._isShareCurrent(token)) return { ok: false, imagePath: '' };
      loading.hide();
      this.setData({ 'share.drawing': false, 'share.imagePath': imagePath });
      return { ok: true, imagePath };
    }).catch((error) => {
      if (!this._isShareCurrent(token)) return { ok: false, imagePath: '' };
      loading.hide();
      console.warn('session share card export fail');
      this.setData({
        'share.drawing': false,
        'share.imagePath': '',
        'share.error': '足迹卡生成失败，请重试',
      });
      return { ok: false, imagePath: '' };
    });
  },

  retryShare() {
    if (this._sessionOwner !== String(getApp().getUserID() || '')) return this.share();
    if (this.data.err || !this.data.s || this.data.s.ts == null) return this.share();
    if (this.data.share.retrySave && this.data.share.imagePath) return this.saveShareCard();
    return this._prepareShareCard();
  },

  saveShareCard() {
    if (!this._isShareCurrent(this._shareEpoch || 0)) {
      if (!this._shareDestroyed) this._clearSessionView('notfound');
      return Promise.resolve({ ok: false, saved: false });
    }
    if (this._saveInFlight) return this._saveInFlight;
    const imagePath = this.data.share.imagePath;
    if (!imagePath) {
      if (!this._shareDestroyed) {
        this.setData({ 'share.error': '足迹卡还没生成，请重试', 'share.retrySave': false });
      }
      return Promise.resolve({ ok: false, saved: false });
    }
    if (this._shareDestroyed) return Promise.resolve({ ok: false, saved: false });
    const token = this._shareEpoch || 0;
    this.setData({ 'share.saving': true });
    loading.show('保存中');
    let request;
    try {
      request = Promise.resolve(this._saveToAlbum(imagePath, token));
    } catch (error) {
      request = Promise.reject(error);
    }
    let flight;
    const finish = (result) => {
      if (this._saveInFlight === flight) this._saveInFlight = null;
      return result;
    };
    flight = request.then((saved) => {
      if (!this._isShareCurrent(token)) return { ok: false, saved: false };
      loading.hide();
      this.setData({ 'share.saving': false });
      if (saved) {
        this.setData({ 'share.error': '', 'share.retrySave': false });
        return { ok: true, saved: true };
      }
      return { ok: false, saved: false };
    }, (error) => {
      if (!this._isShareCurrent(token)) return { ok: false, saved: false };
      loading.hide();
      console.warn('session share card save fail');
      this.setData({
        'share.saving': false,
        'share.error': '保存失败，请重试',
        'share.retrySave': true,
      });
      return { ok: false, saved: false };
    }).then(finish, finish);
    this._saveInFlight = flight;
    return flight;
  },

  _saveToAlbum(imagePath, token) {
    const activeToken = token == null ? (this._shareEpoch || 0) : token;
    return new Promise((resolve) => {
      if (!this._isShareCurrent(activeToken)) { resolve(false); return; }
      wx.saveImageToPhotosAlbum({
        filePath: imagePath,
        success: () => {
          if (this._isShareCurrent(activeToken)) toast('已保存到相册');
          resolve(true);
        },
        fail: (error) => {
          const message = (error && error.errMsg) || '';
          const denied = /auth|deny/i.test(message);
          if (this._isShareCurrent(activeToken)) {
            this.setData({
              'share.error': denied
                ? '没有相册权限，允许后再重试保存'
                : '保存失败，请重试',
              'share.retrySave': true,
            });
          }
          if (denied && this._isShareCurrent(activeToken)) {
            modal.show({
              title: '需要相册权限',
              content: '在设置里允许保存到相册，返回后点“重试保存”。',
              confirmText: '去设置',
              cancelText: '返回',
              success: (result) => {
                if (result.confirm && this._isShareCurrent(activeToken)) wx.openSetting({});
              },
            });
          }
          resolve(false);
        },
      });
    });
  },

  _getShareCanvas() {
    if (this._shareCanvas) return Promise.resolve(this._shareCanvas);
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery().select('#sessionShareCanvas').fields({ node: true }).exec((result) => {
        const node = result && result[0] && result[0].node;
        if (!node) { reject(new Error('no session share canvas')); return; }
        this._shareCanvas = node;
        resolve(node);
      });
    });
  },

  _drawShareCard() {
    const token = this._shareEpoch || 0;
    return this._getShareCanvas().then((canvas) => {
      if (!this._isShareCurrent(token)) throw new Error('session share cancelled');
      const width = SHARE_CARD.width;
      const height = SHARE_CARD.height;
      const scale = SHARE_CARD.scale;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const g = canvas.getContext('2d');
      g.scale(scale, scale);

      const bg = g.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, SHARE_CARD.bgStart);
      bg.addColorStop(1, SHARE_CARD.bgEnd);
      g.fillStyle = bg;
      g.fillRect(0, 0, width, height);

      const map = { x: 60, y: 86, w: 630, h: 430 };
      g.fillStyle = SHARE_CARD.mapBg;
      g.fillRect(map.x, map.y, map.w, map.h);
      g.save();
      g.beginPath();
      g.moveTo(map.x, map.y);
      g.lineTo(map.x + map.w, map.y);
      g.lineTo(map.x + map.w, map.y + map.h);
      g.lineTo(map.x, map.y + map.h);
      g.lineTo(map.x, map.y);
      g.clip();
      const routeScale = Math.min(map.w / MW, map.h / MH);
      const routeX = map.x + (map.w - MW * routeScale) / 2;
      const routeY = map.y + (map.h - MH * routeScale) / 2;
      g.strokeStyle = SHARE_CARD.route;
      g.lineWidth = 5;
      g.lineCap = 'round';
      (this.data.segs || []).forEach((segment) => {
        const rad = segment.deg * Math.PI / 180;
        const x = routeX + segment.x * routeScale;
        const y = routeY + segment.y * routeScale;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(
          x + segment.len * Math.cos(rad) * routeScale,
          y + segment.len * Math.sin(rad) * routeScale
        );
        g.stroke();
      });
      (this.data.poiDots || []).forEach((poi) => {
        g.beginPath();
        g.arc(routeX + poi.x * routeScale, routeY + poi.y * routeScale, 8, 0, Math.PI * 2);
        g.fillStyle = poi.color || SHARE_CARD.secondary;
        g.fill();
        g.strokeStyle = SHARE_CARD.ring;
        g.lineWidth = 3;
        g.stroke();
      });
      if (!this.data.segs.length) {
        g.fillStyle = SHARE_CARD.tertiary;
        g.font = '26px sans-serif';
        g.textAlign = 'center';
        g.fillText('这次没有记录到轨迹', width / 2, map.y + map.h / 2);
      }
      g.restore();

      const s = this.data.s || {};
      g.textAlign = 'center';
      g.fillStyle = SHARE_CARD.primary;
      g.font = 'bold 48px sans-serif';
      g.fillText(s.routeName || '城市漫游足迹', width / 2, 610);
      g.fillStyle = SHARE_CARD.secondary;
      g.font = '28px sans-serif';
      g.fillText(s.completeFact || '已完成本次漫游', width / 2, 662);
      g.fillStyle = SHARE_CARD.tertiary;
      g.font = '24px sans-serif';
      g.fillText(s.dateFull || '', width / 2, 706);

      const stats = [
        { value: s.distanceText, label: 'km' },
        { value: String(s.explorePct != null ? s.explorePct : 0) + '%', label: '探索度' },
        { value: String(s.shops != null ? s.shops : 0), label: '点亮' },
      ];
      stats.forEach((stat, index) => {
        const x = 170 + index * 205;
        g.fillStyle = SHARE_CARD.primary;
        g.font = 'bold 38px sans-serif';
        g.fillText(stat.value, x, 800);
        g.fillStyle = SHARE_CARD.tertiary;
        g.font = '21px sans-serif';
        g.fillText(stat.label, x, 834);
      });
      g.fillStyle = SHARE_CARD.muted;
      g.font = '22px sans-serif';
      g.fillText('城瘾 · CityFog', width / 2, 930);

      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          destWidth: canvas.width,
          destHeight: canvas.height,
          success: (result) => {
            const tempFilePath = result && result.tempFilePath;
            if (!tempFilePath || typeof tempFilePath !== 'string' || !tempFilePath.trim()) {
              reject(new Error('empty session share card path'));
              return;
            }
            resolve(tempFilePath);
          },
          fail: reject,
        });
      });
    });
  },

  onShareAppMessage() {
    const s = this.data.s || {};
    const result = {
      title: (s.routeName || '城市漫游足迹') + ' · ' + (s.completeFact || '已完成本次漫游'),
      path: '/pages/roam/index',
    };
    if (this.data.share.imagePath) result.imageUrl = this.data.share.imagePath;
    const withToken = (token) => (token ? Object.assign({}, result, { path: sharePath(token) }) : result);
    // 朋友分享进来的再转发:沿用同一令牌(快照仍由原分享者掌控,作废后一起失效)。
    if (this._shareToken) return this.data.sharedState === 'ready' ? withToken(this._shareToken) : result;
    if (this.data.share.token) return withToken(this.data.share.token);
    // 没打开过分享面板(右上角直接转发):先发布,拿到令牌就带上;拿不到仍落漫游首页。
    return Object.assign({}, result, { promise: this._ensureShareToken().then(withToken) });
  },

  goRoam() { wx.switchTab({ url: '/pages/roam/index' }); },

  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/roam/index' });
  },
});
