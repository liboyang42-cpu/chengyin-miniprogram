// 城市贴纸 / 今日城市签 · 投一张换一张(§6.4)
//
// 三步一页:拍照 → 写签 → 换票。三步共用同一套实现,城市贴纸与今日城市签只是入口不同
// (kind=sticker 带照片进来,kind=sign 从这里现拍),视觉一像素没改。
//
// ★ 这不是相册。投一张换一张 —— 写是代价,看是回报。
//   所以「换」一定跟在「投」后面:先 /api/roam/stamp/create 存下自己那张,
//   再拿它的 id 去 /api/roam/stamp/exchange 换回别人那张。没投成就不换。
const app = getApp();
const cyToast = require('../../utils/toast.js');
const { resolveMenuChrome } = require('../../utils/nav-safe-area.js');
const { readReducedMotion } = require('../../utils/motion-preference.js');

// 配文上限。§6.4 定的是 30 字带计数 —— 比试玩台那版(40)紧,按裁决走。
const CAPTION_MAX = 30;
// 撕断的阈值:按住往下拉过这么多就撕,不到就弹回去(试玩台原值 80px)。
const TEAR_PX = 80;
// 刮开六成才解锁「收下,出发」。
const SCRATCH_DONE = 0.6;
// 刮头半径,和试玩台一致。
const SCRATCH_R = 15;

function req(url, data) {
  return new Promise((resolve) => {
    app.sendRequest({
      url, method: 'POST', data, hideLoading: true,
      success: (res) => resolve(res || {}),
      successStatusAbnormal: () => resolve({ code: 'fail' }),
      fail: () => resolve({ code: 'fail', netFail: true }),
    });
  });
}

/** 条码:同一个签号画出来的条形永远一样 —— 它是签号的样子,不是随机装饰。 */
function barcodeOf(serial) {
  let s = 77 + Number(serial || 0) * 31;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const out = [];
  for (let i = 0; i < 46; i++) {
    out.push({ w: [1, 1, 1, 2, 2, 3][Math.floor(rnd() * 6)], g: 1 + Math.floor(rnd() * 2) });
  }
  return out;
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

Page({
  data: {
    privacyGateShow: false,
    reducedMotion: false,
    step: 'cam',            // cam=拍照 | write=写签 | print=换票
    title: '今日城市签',
    place: '',
    dateLabel: '',
    timeLabel: '',
    topSafe: 96,
    mapShot: '',
    CAPTION_MAX,

    // 取景框

    // 写签
    photo: '',
    note: '',
    sent: false,
    sending: false,
    sendLabel: '投进信箱',
    hint: '把它拖进信箱，或点下面',
    noteGrab: false,
    noteDx: 0, noteDy: 0, noteRot: 0, noteScale: 1, noteOpacity: 1, noteTrans: 'none',
    boxArmed: false,
    // 信滑进投信口 + 箱子一顿。分腿由 _thump() 驱动 transition,不走 @keyframes
    letterY: 0, letterOpacity: 1, letterTrans: 'none',
    boxY: 0, boxTrans: 'none',

    // 换票
    got: false,
    gotReason: '',
    gotPic: '',
    gotCaption: '',
    gotAt: '',
    serial: 'NO. 0001',
    bars: [],
    torn: false,
    revealed: false,
    paperY: 0, paperRot: 0, paperTrans: 'none',
  },

  /* 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),把本页整个盖住 ——
   * 相机与「保存到相册」都会触发它,所以这页必须自己挂一个。 */
  showPrivacyGate() { this.setData({ privacyGateShow: true }); },
  onPrivacyGateSettled() { this.setData({ privacyGateShow: false }); },

  onLoad(q) {
    const kind = (q && q.kind) || 'sign';
    const place = decodeURIComponent((q && q.place) || '') || '这一站';
    const now = new Date();
    let topSafe = 96;
    try {
      const w = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const getMenu = wx.getMenuButtonBoundingClientRect || wx.getMenuButtonBoundingRect;
      // 顶边让到胶囊底下(§6.6)。取实测坐标,不写死。
      topSafe = resolveMenuChrome(w, getMenu && getMenu.call(wx)).contentTop;
    } catch (e) { /* 拿不到胶囊坐标就用兜底 96,内容照样不会钻到胶囊底下 */ }
    this.setData({
      title: kind === 'sticker' ? '城市贴纸' : '今日城市签',
      place,
      topSafe,
      mapShot: decodeURIComponent((q && q.shot) || ''),
      reducedMotion: readReducedMotion(),
      dateLabel: (now.getMonth() + 1) + '.' + pad2(now.getDate()),
      timeLabel: pad2(now.getHours()) + ':' + pad2(now.getMinutes()),
    });
  },

  onUnload() { this._clearTimers(); },

  _clearTimers() {
    (this._timers || []).forEach((t) => clearTimeout(t));
    this._timers = [];
  },
  _later(fn, ms) {
    this._timers = this._timers || [];
    this._timers.push(setTimeout(fn, ms));
  },

  // ---------- ① 拍照(取景与授权都在 cy-proto-cam 里)----------

  /* 取景卡上那枚 ✕:这一屏是整段玩法的第一步,关掉就等于不玩了,直接退页。 */
  onCamClose() { this._leave(); },

  /* 三个出口(取景卡 ✕ / 写签页返回 / 最后「收下,出发」)共用一条退路。
     2026-09-12 取景卡抽组件时本方法被删漏,三处调用全成 TypeError —— 页面无返回箭头,
     用户只能靠系统返回键逃出。这里补回:有上一页就退,直接冷启动进来的回漫游页。 */
  _leave() {
    if (getCurrentPages().length > 1) { wx.navigateBack(); return; }
    wx.switchTab({ url: '/pages/roam/index' });
  },
  /* 组件把 tempImagePath 交回来,页面只负责进下一步。 */
  onCamShot(e) {
    this.setData({ step: 'write', photo: (e.detail && e.detail.path) || '' });
  },

  onRetake() {
    if (this.data.sent) return;
    this.setData({ step: 'cam' });
  },

  // ---------- ② 写签 ----------
  onNoteInput(e) { this.setData({ note: (e.detail && e.detail.value) || '' }); },

  onBack() { this._leave(); },

  /* 留言条可以拖进投信口。压到箱子上松手就投;没压上就弹回去。 */
  onNoteDown(e) {
    if (this.data.sent) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._drag = { x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
    this.setData({ noteGrab: true, noteTrans: 'none' });
    this._measureBox();
  },

  _measureBox() {
    wx.createSelectorQuery().in(this).select('.sgpb__wrap').boundingClientRect((r) => {
      this._box = r || null;
    }).exec();
  },

  onNoteMove(e) {
    if (!this._drag) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - this._drag.x;
    const dy = t.clientY - this._drag.y;
    this._drag.dx = dx; this._drag.dy = dy;
    const rot = Math.max(-6, Math.min(6, dx / 18));
    const over = this._overBox(t.clientX, t.clientY);
    this.setData({
      noteDx: dx, noteDy: dy, noteRot: Number(rot.toFixed(1)), noteScale: 0.88,
      boxArmed: over,
      hint: over ? '松手，投进去' : '把它拖进信箱，或点下面',
    });
  },

  /* 判据用手指位置而不是纸的中心:纸被缩到 .88 之后中心会偏,手指才是用户以为的「它在哪」。 */
  _overBox(x, y) {
    const b = this._box;
    if (!b) return false;
    return x > b.left - 34 && x < b.right + 34 && y > b.top - 24 && y < b.bottom;
  },

  onNoteUp(e) {
    if (!this._drag) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    const over = t ? this._overBox(t.clientX, t.clientY) : false;
    const d = this._drag;
    this._drag = null;
    this.setData({ noteGrab: false, boxArmed: false });
    if (over) { this._deliver(d.dx, d.dy); return; }
    this.setData({
      noteTrans: 'transform .34s cubic-bezier(.3,1.4,.5,1)',
      noteDx: 0, noteDy: 0, noteRot: 0, noteScale: 1,
      hint: '把它拖进信箱，或点下面',
    });
  },

  onSend() { this._deliver(0, 0); },

  /**
   * 投进去:先把自己这张存下来,再拿它换回别人那张。
   * 顺序不能反 —— 换是投的回报,没投成就不该拿到东西。
   */
  _deliver(dx0, dy0) {
    if (this.data.sent || this.data.sending) return;
    if (!this.data.photo) { cyToast('先拍一张'); return; }
    this.setData({ sending: true, sendLabel: '换 TA 那张…' });

    // 动画:纸缩进投信口。拖进去的比点按钮的短一点 —— 手已经把它送到门口了。
    const dragged = !!(dx0 || dy0);
    const dur = dragged ? 360 : 580;
    const fly = () => this.setData({
      noteTrans: 'transform ' + dur + 'ms cubic-bezier(.45,0,.2,1),opacity .18s ease ' + (dur - 150) + 'ms',
      noteDx: dx0, noteDy: dy0 + 120, noteRot: 0, noteScale: 0.2, noteOpacity: 0,
    });
    if (dragged) fly(); else {
      this.setData({ noteTrans: 'transform .16s ease-out', noteDy: -8, noteScale: 1.02 });
      this._later(fly, 190);
    }
    const t0 = dragged ? 0 : 190;
    this._later(() => { this.setData({ sent: true, hint: '投进去了' }); this._thump(); }, t0 + dur - 40);

    this._postAndExchange();
  },

  /* 信滑进去、箱子一顿。原型里这是两组 @keyframes,这里拆成分腿 transition ——
   * 本仓 keyframes 是只准降的棘轮,而这两下是一次性的,transition 表达得下。 */
  _thump() {
    if (this.data.reducedMotion) {
      // 减少动态效果:直接落定,结果照给、过程不播
      this.setData({ letterTrans: 'none', letterY: 228, letterOpacity: 0.1 });
      return;
    }
    this.setData({ letterTrans: 'transform 225ms cubic-bezier(.4,0,.6,1)', letterY: 110,
                   boxTrans: 'transform 137ms cubic-bezier(.3,1.6,.5,1)', boxY: 6 });
    this._later(() => this.setData({
      letterTrans: 'transform 275ms cubic-bezier(.4,0,.6,1),opacity 275ms linear', letterY: 228, letterOpacity: 0.1,
      boxTrans: 'transform 223ms cubic-bezier(.3,1.6,.5,1)', boxY: 0,
    }), 225);
  },

  _postAndExchange() {
    const state = this._stampState || (this._stampState = {
      idem: 'cs-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
      stampId: 0,
    });
    // ★ 换那步断网重试时,库里已经有自己那张了:直接续换。
    //   原来每次重试都重新 create(且每次生成新幂等键),自己的贴纸重复入册,
    //   而第一次换回的票已经丢了。
    if (state.stampId) { this._exchange(state.stampId); return; }
    // 图先上传,拿到可外链的 URL 再存票 —— 本地临时路径别人看不到,存进去别人换到的是一张裂图。
    // ⚠️ 走 app.getUploadClient().uploadAll(全站统一上传通道,自带会话认证与超时看门狗),
    //    不是 wx.uploadFile:后者不带 Authorization,服务端认不出人。
    //    uploadAll 默认 mapResult 直接返回 data.url(字符串),不是 {url} 对象。
    const that = this;
    app.getUploadClient().uploadAll([this.data.photo], {
      bizType: 'stamp',
      onDone(r) {
        const url = r && r.results && r.results[0];
        if (!url) { that._failDeliver('图没传上去，回去重试一次'); return; }
        that._createStamp(url, state.idem);
      },
    });
  },

  _createStamp(picUrl, idem) {
    req('/api/roam/stamp/create', { picUrl, caption: this.data.note, idempotencyKey: idem }).then((res) => {
      const id = res && res.code == 200 && res.data ? res.data.id : null;
      if (!id) { this._failDeliver((res && res.msg) || '没存上，回去重试一次'); return; }
      if (this._stampState) this._stampState.stampId = id;   // 换失败再重试时复用它,不再 create
      this._exchange(id);
    });
  },

  _exchange(givenStampId) {
    req('/api/roam/stamp/exchange', { givenStampId }).then((res) => {
      const d = res && res.code == 200 ? res.data : null;
      if (!d) { this._failDeliver((res && res.msg) || '换的时候断了，回去重试一次'); return; }
      const stamp = d.exchanged ? d.stamp : null;
      const serial = stamp && stamp.id ? Number(stamp.id) : 0;
      this.setData({
        step: 'print',
        got: !!stamp,
        gotReason: d.reason || '',
        gotPic: stamp ? stamp.picUrl : '',
        gotCaption: stamp ? (stamp.caption || '') : '',
        gotAt: stamp ? String(stamp.createTime || '').slice(0, 16).replace('T', ' ') : '',
        serial: 'NO. ' + String(serial % 10000).padStart(4, '0'),
        bars: barcodeOf(serial),
        hint: stamp ? '按住小票，往下拉' : '',
        sending: false,
      }, () => { if (this.data.got) this._printOut(); });
    });
  },

  /** 投出去了但没换成:说清楚是哪一步断的,并把按钮还回去,不把人困在一张空屏上。 */
  _failDeliver(msg) {
    this._clearTimers();
    this.setData({
      sending: false, sent: false, sendLabel: '投进信箱',
      letterTrans: 'none', letterY: 0, letterOpacity: 1, boxTrans: 'none', boxY: 0,
      hint: msg, noteTrans: 'transform .3s ease', noteDx: 0, noteDy: 0,
      noteRot: 0, noteScale: 1, noteOpacity: 1,
    });
    cyToast(msg);
  },

  // ---------- ③ 换票:出纸 → 撕断 → 刮开 → 收下 ----------
  /** 出纸:票从槽里滚出来。clip 在 .sgpaperwrap 上,所以看起来是从缝里出来的。 */
  _printOut() {
    wx.createSelectorQuery().in(this).select('.sgpaper').boundingClientRect((r) => {
      const h = (r && r.height) || 420;
      this.setData({ paperTrans: 'none', paperY: -h - 20 }, () => {
        this._later(() => this.setData({ paperTrans: 'transform 1500ms cubic-bezier(.2,.8,.3,1)', paperY: 0 }), 30);
      });
    }).exec();
  },

  onPaperDown(e) {
    if (this.data.torn) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._pull = { y: t.clientY, x: t.clientX, dy: 0 };
    this.setData({ paperTrans: 'none' });
  },

  onPaperMove(e) {
    if (!this._pull) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dy = Math.max(0, t.clientY - this._pull.y);
    this._pull.dy = dy;
    const off = (t.clientX - this._pull.x) / 40;
    this.setData({ paperY: dy * 0.7, paperRot: Math.max(-9, Math.min(9, off + dy * 0.03)) });
  },

  onPaperUp() {
    if (!this._pull) return;
    const dy = this._pull.dy;
    this._pull = null;
    if (dy < TEAR_PX) {
      // 没拉够就弹回去 —— 撕断是有意的动作,不该被一次误触完成
      this.setData({ paperTrans: 'transform 420ms cubic-bezier(.2,.8,.3,1)', paperY: 0, paperRot: 0 });
      return;
    }
    this.setData({ paperTrans: 'transform 280ms cubic-bezier(.2,.8,.3,1)', paperY: dy * 0.7 + 54, paperRot: -6 });
    this._later(() => {
      wx.vibrateShort && wx.vibrateShort({ type: 'light' });
      this.setData({ torn: true, paperTrans: 'none', paperY: 0, paperRot: 0, hint: '刮开 TA 留给你的那句' },
        () => this._initScratch());
    }, 240);
  },

  /* 刮层:撕下来之前刮不动 —— 纸还连在机器上,刮它没有道理。 */
  _initScratch() {
    if (this.data.revealed) return;
    // ⚠️ 必须带 rect:true —— size 只给 width/height,不给 left/top。
    //    少了它下面 clientX - left 就是 NaN,arc(NaN,NaN) 什么也不画:
    //    刮层永远刮不开,「收下,出发」永远解不开锁,而且一句报错都没有。
    wx.createSelectorQuery().in(this).select('#sgcover').fields({ node: true, size: true, rect: true }).exec((r) => {
      const item = r && r[0];
      if (!item || !item.node) return;   // 拿不到画布就让它保持盖着,下面 onDone 有兜底
      const cv = item.node;
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      cv.width = item.width * dpr;
      cv.height = item.height * dpr;
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = '#C9CDD3';   /* ds-ok 刮层的灰,canvas 拿不到 var() */
      g.fillRect(0, 0, item.width, item.height);
      g.fillStyle = '#6E747D';   /* ds-ok 刮层上「刮开」二字,同上 */
      g.font = '500 12px sans-serif';
      g.textAlign = 'center';
      g.fillText('刮开', item.width / 2, item.height / 2 + 4);
      g.globalCompositeOperation = 'destination-out';
      this._cv = { node: cv, g, w: item.width, h: item.height, dpr, left: item.left, top: item.top, dug: 0 };
    });
  },

  onScratch(e) {
    const c = this._cv;
    if (!c || !this.data.torn || this.data.revealed) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const x = t.clientX - c.left;
    const y = t.clientY - c.top;
    c.g.beginPath();
    c.g.arc(x, y, SCRATCH_R, 0, Math.PI * 2);
    c.g.fill();
    c.dug += 1;
  },

  /** 刮开六成才解锁。抽样读像素:整张读一遍在低端机上会卡一下,而这里只要个比例。 */
  onScratchEnd() {
    const c = this._cv;
    if (!c || this.data.revealed) return;
    let cleared = 0; let n = 0;
    try {
      const d = c.g.getImageData(0, 0, c.w * c.dpr, c.h * c.dpr).data;
      for (let i = 3; i < d.length; i += 40) { n++; if (d[i] < 128) cleared++; }
    } catch (err) {
      // 读不到像素(部分机型 canvas 2d 受限)就按刮的次数兜底,别让人永远解不开
      if (c.dug > 24) { this._reveal(); }
      return;
    }
    if (n && cleared / n >= SCRATCH_DONE) this._reveal();
  },

  _reveal() {
    this._cv = null;
    this.setData({ revealed: true, hint: '收下就走 · 你留的那句已经在等下一个人' });
  },

  onSave() {
    if (!this.data.torn) { cyToast('先把小票撕下来'); return; }
    const src = this.data.gotPic;
    if (!src) { cyToast('这张没有图可存'); return; }
    // 票图是接口回的远端 URL。wx.saveImageToPhotosAlbum 只认本地文件路径,
    // 直接喂 URL 会永久失败,而原来无论失败原因都把用户引去开相册权限 —— 权限明明开着。
    const save = (filePath) => wx.saveImageToPhotosAlbum({
      filePath,
      success: () => cyToast('已存进相册'),
      fail: (err) => {
        const msg = String((err && err.errMsg) || '');
        // 存不进去且确实是授权被拒:说清楚并给一条路。其余(下载/写盘失败)别扯权限。
        if (msg.indexOf('auth') >= 0 || msg.indexOf('authorize') >= 0) {
          wx.openSetting({ success: () => {}, fail: () => cyToast('相册没授权') });
          return;
        }
        cyToast('存进相册失败，请重试');
      },
    });
    if (/^https?:\/\//.test(src)) {
      wx.downloadFile({
        url: src,
        success: (r) => {
          if (r && r.tempFilePath) { save(r.tempFilePath); return; }
          cyToast('票图没下下来，请重试');
        },
        fail: () => cyToast('票图没下下来，请重试'),
      });
      return;
    }
    save(src);
  },

  onDone() {
    if (this.data.got && !this.data.revealed) { cyToast('先刮开 TA 留的那句'); return; }
    this._leave();
  },
});
