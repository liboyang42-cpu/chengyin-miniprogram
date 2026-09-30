// cy-album-glass · 相册全屏(2026-09-24,效果照 X 上 @insporadesign「3D gradient cards」)
//
// 整个画面画在一块画布上,每帧两步(几何见 pages/play/utils/album-lens.js):
//   1. 照片排成一圈跟手转:中间那张正对;往两边走的绕自己竖轴转,过 90° 翻成镜像。
//   2. 屏幕左右边缘套一层固定的弯玻璃:底下画面经过时横向拉成拖影、竖向张开,
//      红绿蓝三层张开量不同 → 边上裂出五彩色散。
// 翻下一张 = 整圈转一格,全程连着。当前第几张由页面管:手滑 / 点两侧停稳后只抛 change。
const { offsetOf, cardColumns, lensColumns, HIDE_AT } = require('../../utils/album-lens.js');

const H_RPX = 900;
const CARD_W_RPX = 420;
const CARD_H_RPX = 620;
const SIDE_X_RPX = 420;     // 转满一格时侧卡中心离中线多远
const P_RPX = 640;          // 透视距离:越小侧卡外沿越往镜头张
const ZONE = 0.2;           // 每侧玻璃占屏宽多少
// 红 / 绿 / 蓝 的外沿放大量与横向错位(rpx):只差一点,彩边细细一圈落在轮廓上(照 Figma Liquid Glass 的 Dispersion,不能把整片染花)
const FLARES = [0.51, 0.5, 0.49];
const SHIFTS_RPX = [-1, 0, 1];
const BLUR_RPX = 6;          // 拖影横向模糊半径:越往屏幕边越糊,内沿不糊
const SETTLE_MS = 450;

Component({
  properties: {
    images: { type: Array, value: [], observer() { this._imgs = {}; this._draw(); } },
    cur: { type: Number, value: 0, observer(v) { this._goTo(v); } },
  },
  lifetimes: {
    attached() { this._pos = this.data.cur; this._imgs = {}; },
    ready() {
      this.createSelectorQuery().select('#ag').fields({ node: true, size: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (!node || this._gone) return;
        const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
        const dpr = Math.min(Number(info.pixelRatio) || 2, 2);
        this._u = ((Number(info.windowWidth) || 375) / 750) * dpr;   // 1rpx = 多少画布像素
        node.width = Math.round(750 * this._u);
        node.height = Math.round(H_RPX * this._u);
        this._canvas = node;
        this._ctx = node.getContext('2d');
        const mk = () => wx.createOffscreenCanvas({ type: '2d', width: node.width, height: node.height });
        // 底图 + 红绿蓝三张单通道图(色散用);环境没有离屏画布就只拉伸不色散
        this._off = typeof wx.createOffscreenCanvas === 'function' ? [mk(), mk(), mk(), mk()] : null;
        this._draw();
      });
    },
    detached() { this._gone = true; },
  },
  methods: {
    _n() { return (this.data.images || []).length; },
    /** 照片只载一次;载好了重画 */
    _img(url) {
      if (!this._imgs[url]) {
        const host = this._off ? this._off[0] : this._canvas;
        const img = host.createImage();
        this._imgs[url] = { img, ok: false };
        img.onload = () => { this._imgs[url].ok = true; this._draw(); };
        img.src = url;
      }
      return this._imgs[url].ok ? this._imgs[url].img : null;
    },
    _draw() {
      if (!this._ctx || this._gone || this._raf) return;
      const raf = this._canvas.requestAnimationFrame || ((f) => setTimeout(f, 16));
      this._raf = raf(() => { this._raf = 0; this._paint(); });
    },
    _paint() {
      if (!this._ctx || this._gone) return;
      const W = this._canvas.width;
      const H = this._canvas.height;
      const u = this._u;
      const base = this._off ? this._off[0].getContext('2d') : this._ctx;
      this._ctx.clearRect(0, 0, W, H);
      if (base !== this._ctx) base.clearRect(0, 0, W, H);
      const n = this._n();
      const geom = {
        cx: W / 2, cy: H / 2, cardW: CARD_W_RPX * u, cardH: CARD_H_RPX * u,
        sideX: SIDE_X_RPX * u, P: P_RPX * u, radius: 36 * u,
      };
      // 远的先画,中间那张最后压上去
      (this.data.images || []).map((shot, k) => ({ shot, o: offsetOf(k, this._pos, n) }))
        .filter((c) => Math.abs(c.o) <= HIDE_AT)
        .sort((a, b) => Math.abs(b.o) - Math.abs(a.o))
        .forEach(({ shot, o }) => {
          const img = this._img(shot.url);
          if (!img) return;
          // aspectFill:按卡片比例裁照片中间那块
          const ratio = CARD_W_RPX / CARD_H_RPX;
          const sw = Math.min(img.width, img.height * ratio);
          const sh = sw / ratio;
          const sx0 = (img.width - sw) / 2;
          const sy0 = (img.height - sh) / 2;
          const columns = cardColumns(Object.assign({ o }, geom));
          this._paintShadow(this._ctx, columns, u);
          columns.forEach((col) => {
            base.drawImage(img, sx0 + Math.min(sw - 1, col.u01 * sw), sy0, 1, sh, col.dx, col.dy, 1, col.dh);
          });
        });
      if (!this._off) return;
      const ctx = this._ctx;
      const zone = Math.round(W * ZONE);
      ctx.drawImage(this._off[0], zone, 0, W - 2 * zone, H, zone, 0, W - 2 * zone, H);
      // 拆红绿蓝:乘上纯色,再用底图的透明度把空白处抠回透明
      const layers = ['#FF0000', '#00FF00', '#0000FF'].map((color, i) => {   /* ds-ok 色散拆通道用的纯色 */
        const off = this._off[i + 1];
        const x = off.getContext('2d');
        x.globalCompositeOperation = 'source-over';
        x.clearRect(0, 0, W, H);
        x.drawImage(this._off[0], 0, 0);
        x.globalCompositeOperation = 'multiply';
        x.fillStyle = color;
        x.fillRect(0, 0, W, H);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(this._off[0], 0, 0);
        return off;
      });
      ctx.globalCompositeOperation = 'lighter';
      layers.forEach((layer, i) => {
        lensColumns({ W, zone, flare: FLARES[i], shift: SHIFTS_RPX[i] * u }).forEach((c) => {
          const dh = H * c.scale;
          const dy = (H - dh) / 2;
          const b = BLUR_RPX * u * c.t * c.t;
          if (b < 1) {
            ctx.drawImage(layer, Math.round(c.sx), 0, 1, H, c.dx, dy, 1, dh);
            return;
          }
          // 模糊:左中右三处各取一列、各三分之一叠加('lighter' 下正好是平均)
          ctx.globalAlpha = 1 / 3;
          [-b, 0, b].forEach((d) => {
            const sx = Math.min(W - 1, Math.max(0, Math.round(c.sx + d)));
            ctx.drawImage(layer, sx, 0, 1, H, c.dx, dy, 1, dh);
          });
          ctx.globalAlpha = 1;
        });
      });
      ctx.globalCompositeOperation = 'source-over';
    },
    // 用同一组透视轮廓画一次软阴影,不逐列模糊;留在最终画布上,不进入 RGB 色散。
    _paintShadow(ctx, columns, u) {
      if (!columns.length) return;
      ctx.save();
      ctx.fillStyle = 'rgba(35,42,54,.24)'; /* ds-ok 白色空间中卡片的中性软阴影 */
      ctx.shadowColor = 'rgba(35,42,54,.50)'; /* ds-ok 与卡片同轮廓的悬浮投影 */
      ctx.shadowBlur = 32 * u;
      ctx.shadowOffsetY = 24 * u;
      ctx.beginPath();
      ctx.moveTo(columns[0].dx, columns[0].dy);
      columns.forEach(col => ctx.lineTo(col.dx, col.dy));
      for (let i = columns.length - 1; i >= 0; i -= 1) {
        const col = columns[i];
        ctx.lineTo(col.dx, col.dy + col.dh);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    /** 从当前位置缓动到 target(整数格) */
    _animateTo(target) {
      const from = this._pos;
      const t0 = Date.now();
      const tick = () => {
        if (this._gone || this._touching) return;
        const k = Math.min(1, (Date.now() - t0) / SETTLE_MS);
        this._pos = from + (target - from) * (1 - Math.pow(1 - k, 3));
        this._paint();
        if (k < 1) this._timer = setTimeout(tick, 16);
      };
      clearTimeout(this._timer);
      tick();
    },
    /** 页面改了 cur:转到离当前最近的那一圈上的那张 */
    _goTo(cur) {
      const n = this._n();
      if (!n || this._touching) return;
      const o = offsetOf(cur, Math.round(this._pos || 0), n);
      if (o === 0) return;
      this._animateTo(Math.round(this._pos) + o);
    },
    onTouchStart(e) {
      const t = e.touches && e.touches[0];
      if (!t || this._n() < 2) return;
      clearTimeout(this._timer);
      this._touching = true;
      this._x0 = t.clientX;
      this._p0 = this._pos || 0;
      const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
      this._step = (Number(info.windowWidth) || 375) * 0.6;   // 手指挪 60% 屏宽 = 转一格
    },
    onTouchMove(e) {
      const t = e.touches && e.touches[0];
      if (!this._touching || !t) return;
      this._pos = this._p0 - (t.clientX - this._x0) / this._step;
      this._draw();
    },
    onTouchEnd(e) {
      if (!this._touching) return;
      this._touching = false;
      const t = e.changedTouches && e.changedTouches[0];
      const dx = t ? t.clientX - this._x0 : 0;
      const from = Math.round(this._p0);
      let target = Math.round(this._pos);
      if (Math.abs(dx) < 8) target = from;                       // 这是一下轻点,交给 onTap
      else if (target === from && Math.abs(dx) > 40) target = from + (dx < 0 ? 1 : -1);   // 挪过 40px 至少翻一格
      this._settle(target);
    },
    /** 轻点左右两侧:上一张 / 下一张 */
    onTap(e) {
      const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
      const x = (e.detail && e.detail.x) / (Number(info.windowWidth) || 375);
      if (x < 0.3) this._settle(Math.round(this._pos) - 1);
      else if (x > 0.7) this._settle(Math.round(this._pos) + 1);
    },
    _settle(target) {
      const n = this._n();
      if (!n) return;
      this._animateTo(target);
      const cur = ((target % n) + n) % n;
      if (cur !== this.data.cur) this.triggerEvent('change', { cur });
    },
  },
});
