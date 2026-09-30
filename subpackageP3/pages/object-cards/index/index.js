// 藏品册(施工文档第四版 §3.3,样稿 artifact 9U7HFWDfbinjmt2tppvVGp):
// 物品从上往下掉、堆在地面线上;右上角 ✦ 聚成一团,再按一下落回去;点一件放大看。
//
// 堆是一块 2d canvas:最近 40 件,分类筛选在服务端做(计数与分页跟着筛过的走)。
// 物理在 utils/object-pile.js;这里只管拉数据、加载图、逐帧画,全停住以后停掉逐帧重画(省电)。
// ponytail: 只画最近 40 件,更早的不进堆;真有人收到上百件再加「往前翻」。
const app = getApp();
const { toCard } = require('../../../../utils/object-card.js');
const pile = require('../../../../utils/object-pile.js');
const motionPreference = require('../../../../utils/motion-preference.js');
const cyToast = require('../../../../utils/toast.js');

const PAGE_SIZE = 40;
const ALL = '全部';
const CATEGORIES = ['电子产品', '服饰', '鞋包', '食物饮料', '书籍文具', '玩具摆件', '日用杂物', '其他'];
/** 地面线离画布底边(px):下面留给安全区和一点呼吸 */
const FLOOR_GAP = 56;

Page({
  data: {
    cats: [ALL].concat(CATEGORIES).map((c) => ({ key: c, label: c })),
    filter: ALL,
    cards: [],
    // loaded = 「真的读到过后端答复」;error = 「整页没读到」。两者不能合并:
    // 失败时把 loaded 置真,空态就会替失败背书,玩家以为册子被清空了。
    loading: false,
    loaded: false,
    error: false,
    ball: false,
    // 放大态:null = 堆;非空 = 盖在堆上的那一件
    active: null,
  },

  onLoad() {
    this._reduced = motionPreference.readReducedMotion();
    this._images = {};
    this._bodies = [];
    this.load(ALL);
  },

  onReady() {
    this.createSelectorQuery().select('#ocPile').fields({ node: true, size: true, rect: true }).exec((res) => {
      if (this._destroyed) return;
      const info = res && res[0];
      if (!info || !info.node) return;
      let dpr = 2;
      try { dpr = wx.getWindowInfo().pixelRatio || 2; } catch (e) { /* 默认值 */ }
      const canvas = info.node;
      canvas.width = Math.round(info.width * dpr);
      canvas.height = Math.round(info.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._canvas = canvas;
      this._ctx = ctx;
      this._rect = { left: info.left, top: info.top, width: info.width, height: info.height };
      this._world = { W: info.width, floor: info.height - FLOOR_GAP, cx: info.width / 2, cy: info.height * 0.42 };
      if (this.data.cards.length) this._build(false);
    });
  },

  // 页面藏起来就停画(聚成一团时逐帧重画永远不会自己停),回来接着画
  onHide() { this._hidden = true; this._stop(); },
  onShow() { this._hidden = false; if (this._bodies && this._bodies.length) this._run(); },
  onUnload() { this._destroyed = true; this._stop(); },

  load(category) {
    const that = this;
    const previous = this.data.filter;
    this.setData({ loading: true, filter: category });
    app.sendRequest({
      url: '/api/object-card/list',
      method: 'POST',
      autoErrorToast: false,
      data: { pageNum: 1, pageSize: PAGE_SIZE, category: category === ALL ? '' : category },
      success(res) {
        if (that._destroyed) return;
        const d = res && res.code == '200' && res.data ? res.data : null;
        // 非 200 / 没有 data / 行形状不对 = 没接通,不是「一张都没有」
        const okRows = d && Array.isArray(d.list) && d.list.every(function (row) {
          return row && typeof row === 'object' && !Array.isArray(row)
            && row.id !== null && row.id !== undefined && typeof row.title === 'string';
        });
        const okTotal = d && typeof d.total === 'number' && Number.isInteger(d.total) && d.total >= 0;
        if (!okRows || !okTotal) { that._failed(previous); return; }
        const cards = d.list.map(toCard);
        const firstTime = !that.data.loaded;
        that._total = d.total;   // 只给自证探针读,不进 setData(界面不渲染它)
        that.setData({ cards, loading: false, loaded: true, error: false, ball: false });
        that._build(!firstTime);
      },
      fail() { that._failed(previous); },
      // HTTP 层非 200 走这一条:不挂它 success/fail 都不跑,骨架转到底
      successStatusAbnormal() { that._failed(previous); },
    });
  },

  /** 首屏没读到 = 整页失败(自动返回);切分类没读到 = 提示一句,退回原来那一类,堆不动。 */
  _failed(previous) {
    if (this._destroyed) return;
    if (!this.data.loaded) { this.setData({ loading: false, error: true }); return; }
    this.setData({ loading: false, filter: previous });
    cyToast('这一类没读到，再点一次试试');
  },

  onFilter(e) {
    const key = e && e.detail && e.detail.key;
    if (!key || key === this.data.filter || this.data.loading) return;
    this.load(key);
  },

  // ---------------- 物品堆 ----------------
  /** fromTop = 从屏幕上方掉进来(切分类);首屏直接落定再画,不让玩家干等。 */
  _build(fromTop) {
    if (!this._world) return;   // 画布还没量好,onReady 里会再建一次
    const world = this._world;
    this._bodies = this.data.cards.map((card, i) => pile.body(card, world, {
      size: card.cutoutUrl ? 60 : 50, seed: i + 7, fromTop,
    }));
    if (!fromTop || this._reduced) for (let k = 0; k < 600; k++) pile.step(this._bodies, world, 1);
    this.data.cards.forEach((card) => this._loadImage(card.cutoutUrl || card.sourceUrl || card.frames[0]));
    this._run();
  },

  _loadImage(src) {
    if (!src || this._images[src] !== undefined || !this._canvas) return;
    this._images[src] = null;   // 在路上
    const img = this._canvas.createImage();
    img.onload = () => { this._images[src] = img; this._run(); };
    // 图床域名没进 downloadFile 白名单也会走这里:画一块占位,堆照常能点
    img.onerror = () => { this._images[src] = false; this._run(); };
    img.src = src;
  },

  onGather() {
    const ball = !this.data.ball;
    this.setData({ ball });
    this._world.ball = ball;
    this._bodies.forEach((b) => { b.vx += (Math.random() - 0.5) * 2; if (ball) b.vy -= 2 + Math.random() * 3; });
    if (this._reduced) for (let k = 0; k < 500; k++) pile.step(this._bodies, this._world, 1);
    this._run();
  },

  /** 逐帧:走一步物理、画一遍;全停住(且没在聚团)就停,省电。减弱动态效果时只画一帧。 */
  _run() {
    if (!this._canvas || this._hidden || this._destroyed) return;
    if (this._raf) return;
    const frame = () => {
      this._raf = null;
      if (this._hidden || this._destroyed) return;
      if (!this._reduced) pile.step(this._bodies, this._world, 1);
      this._draw();
      const still = this._reduced || (!this._world.ball && pile.settled(this._bodies));
      if (!still) this._raf = this._canvas.requestAnimationFrame(frame);
    };
    this._raf = this._canvas.requestAnimationFrame(frame);
  },

  _stop() {
    if (this._raf && this._canvas) this._canvas.cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  _draw() {
    const ctx = this._ctx;
    const w = this._world;
    ctx.clearRect(0, 0, w.W, w.floor + FLOOR_GAP);
    // 地面线 + 一点往下的雾
    const g = ctx.createLinearGradient(0, w.floor, 0, w.floor + 18);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(18, w.floor, w.W - 36, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(18, w.floor, w.W - 36, 1);
    // 右下角的木牌(样稿里就有)
    ctx.fillStyle = '#6b5a47'; /* ds-ok: 样稿里的木牌,插画色不走主题 token */
    ctx.fillRect(w.W - 93, w.floor - 60, 5, 60);
    ctx.fillStyle = '#8a7660'; /* ds-ok: 同上,木牌牌面 */
    ctx.fillRect(w.W - 118, w.floor - 76, 56, 24);
    for (const b of this._bodies) this._drawBody(ctx, b);
  },

  _drawBody(ctx, b) {
    const card = b.item;
    const src = card.cutoutUrl || card.sourceUrl || card.frames[0];
    const img = this._images[src];
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    const s = b.size;
    if (img && card.cutoutUrl) {
      const k = s / Math.max(img.width, img.height);
      ctx.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k);
    } else if (img) {
      // 没抠出来的:一小块照片,圆角
      const k = Math.max(s / img.width, s / img.height);
      ctx.beginPath();
      ctx.moveTo(-s / 2 + 6, -s / 2);
      ctx.arcTo(s / 2, -s / 2, s / 2, s / 2, 6);
      ctx.arcTo(s / 2, s / 2, -s / 2, s / 2, 6);
      ctx.arcTo(-s / 2, s / 2, -s / 2, -s / 2, 6);
      ctx.arcTo(-s / 2, -s / 2, s / 2, -s / 2, 6);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k);
    } else {
      ctx.fillStyle = '#2A2A2C'; /* ds-ok: 图没加载出来的占位块,= bg-raised 的深色值(canvas 读不到 CSS 变量) */
      ctx.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    }
    ctx.restore();
  },

  onTapPile(e) {
    if (!this._rect || !e || !e.detail) return;
    const hitBody = pile.hit(this._bodies, e.detail.x - this._rect.left, e.detail.y - this._rect.top);
    if (hitBody) this.setData({ active: hitBody.item });
  },

  // 画布在放大态时是 display:none,回来补画一帧(停住的堆不会自己再画)
  onCloseActive() { this.setData({ active: null }, () => { if (this._ctx) this._draw(); }); },

  // 自动化自证:堆里画了几件 + 后端说共几件
  __layoutProbe() { return { n: this._bodies.length, total: this._total, filter: this.data.filter }; },
});
