// cy-playkit-objectcard · 拍物成卡的当场揭晓(施工文档第四版 §3.1 §3.2,样稿 artifact 9U7HFWDfbinjmt2tppvVGp)
//
// 一张底部面板走完:取景 → 处理中 → 背景碎成点阵散掉、物品留在原位 → 物品上移 + 信息卡。
// 判定与铸卡全在服务端:组件只拍、只报临时路径(bind:shoot),页面上传再提交;
// 结果经 kit 属性回来(tries / passed / card …),下一屏由 utils/object-card-reveal.js 的 outcome 决定。
//
// ⚠️ 不用 Behavior(node 单测环境没有全局 Behavior,会拖垮加载本组件的旧测试);
//    减弱动态效果直接读 motion-preference。不新增 @keyframes:点阵与上移全由 canvas 逐帧画。

const motionPreference = require('../../../../utils/motion-preference.js');
const motion = require('../../../../utils/motion.js');
const cyToast = require('../../../../utils/toast.js');
const reveal = require('../../../../utils/object-card-reveal.js');

/** 等结果的上限:视觉审核 + 铸卡最坏十来秒,过了这个数还没回来就放玩家回取景,别让他对着转圈干等。 */
const WAIT_MS = 45000;
/** 点阵格子边长(px):样稿 6pt,手机上 7px 点数少一截、看着一样。 */
const CELL = 7;
/** 节奏照样稿:成功字样、点阵散完、停一下、物品上移。 */
const T = { success: 450, dissolve: 1300, hold: 450, move: 650 };
/** 信息态物品框(rpx,面板坐标):中心 427、480×384 —— 与 wxss 的 .oc__obj 同一个框。 */
const OBJ_RPX = { cy: 427, w: 480, h: 384 };
/** 取景框圆角(rpx),与 .oc__vf 的 --cy-radius-2xl 一致。 */
const VF_RADIUS_RPX = 44;

function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    const timer = setTimeout(() => reject(new Error('timeout')), 6000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('load fail')); };
    img.src = src;
  });
}

function roundClip(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.clip();
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    tries: { type: Number, value: 0 },
    passed: { type: Boolean, value: false },
    flagged: { type: Boolean, value: false },
    degraded: { type: Boolean, value: false },
    fallback: { type: String, value: 'retake' },
    lastReason: { type: String, value: '' },
    // 判过时服务端随回包带回来的那张卡(utils/object-card.js 的 toCard)。null = 没有卡
    card: { type: Object, value: null },
    // 主题名 · 节点名(页面给)
    place: { type: String, value: '' },
    // 页面每失败一次加一(上传没成 / 题目变了):只认比见过的大
    photoFailSeq: { type: Number, value: 0 },
    // 编辑页预览:没有会话可提交,按快门只提示,不拍、不上抛
    preview: { type: Boolean, value: false },
  },
  data: {
    topSafe: 96,
    reducedMotion: false,
    phase: 'cam',        // cam 取景 / proc 处理中 / reveal 点阵与上移 / info 信息 / retry 没过 / note 一句话收尾
    camOn: true,
    busy: false,
    shot: '',
    shotHidden: false,
    head: '',
    sub: '',
    headOn: true,
    pill: '',
    pillReady: false,
    objSrc: '',
    formOn: false,
    // 这一屏自己留一份卡:卡只在判过那一次回包里有,之后的会话视图(回读)都不带,
    // 直接绑 card 的话信息卡会在下一次视图到来时凭空消失
    cardView: null,
    spin: 0,
    spokes: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  lifetimes: {
    attached() {
      // 面板顶边避开微信胶囊:与 cy-proto-cam 同一条算式
      let topSafe = 96;
      try {
        const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const menu = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
        if (menu && menu.bottom) topSafe = Math.round(menu.bottom + 8);
        else if (sys && sys.statusBarHeight) topSafe = Math.round(sys.statusBarHeight + 52);
      } catch (e) { /* 拿不到就用默认值 */ }
      this._timers = [];
      this._failSeen = Number(this.data.photoFailSeq) || 0;
      this.setData({ topSafe, reducedMotion: motionPreference.readReducedMotion() });
      if (this.data.show) this._enter();
    },
    detached() { this._stopAll(); },
  },
  observers: {
    show(v) { if (v) this._enter(); else this._stopAll(); },
    'tries, passed, flagged, degraded, card': function () { this._maybeResult(); },
    photoFailSeq(seq) {
      const n = Number(seq) || 0;
      if (n <= (this._failSeen || 0)) return;
      this._failSeen = n;
      if (this.data.phase === 'proc') this._openCam();
    },
  },
  methods: {
    // ---------------- 进出 ----------------
    _enter() {
      if (this._shown) return;
      this._shown = true;
      const d = this.data;
      // 回看:这一段已经判过且有卡 → 直接信息态
      if (d.passed && d.card) { this._showInfo(false); return; }
      // 判过了但手里没卡(回读过 / 铸卡没成):只说过了,不能又打开相机让人重拍一段已经过了的
      if (d.passed) { this._note('这张过了'); return; }
      if (d.flagged) { this._note(this._flaggedCopy()); return; }
      this._openCam();
    },
    _stopAll() {
      this._shown = false;
      this._before = null;
      (this._timers || []).forEach(clearTimeout);
      this._timers = [];
      this._stopSpin();
      this._stopLoop();
      this._clearCanvas();
    },
    _later(ms, fn) { this._timers.push(setTimeout(fn, ms)); },

    _openCam() {
      (this._timers || []).forEach(clearTimeout);
      this._timers = [];
      this._stopSpin();
      this._stopLoop();
      this._clearCanvas();
      this._before = null;
      this.setData({
        phase: 'cam', camOn: !this._camErr, busy: false, shot: '', shotHidden: false,
        head: '把物品放进框里', sub: '', headOn: true, pill: '', pillReady: false, objSrc: '', formOn: false, cardView: null,
      });
    },

    // ---------------- 拍 ----------------
    onShutter() {
      if (this.data.preview) { cyToast('试玩只看样子，不拍照也不判定'); return; }
      if (this.data.busy) return;
      if (this.data.phase === 'retry') { this._openCam(); return; }
      if (this.data.phase !== 'cam') return;
      if (!this.data.camOn) { this.onAlbum(); return; }
      this.setData({ busy: true });
      wx.createCameraContext(this).takePhoto({
        quality: 'high',
        success: (res) => this._shoot(res && res.tempImagePath),
        fail: () => {
          this.setData({ busy: false });
          // 连着两次拍不上:相机被占或机型不兼容,这两种都不触发 binderror —— 改走相册,别把玩家卡在取景器里
          this._shutterFails = (this._shutterFails || 0) + 1;
          if (this._shutterFails >= 2) { this.onCamError(); return; }
          cyToast('这张没拍上，再按一次');
        },
      });
    },
    onAlbum() {
      if (this.data.preview) { cyToast('试玩只看样子，不拍照也不判定'); return; }
      if (this.data.busy || (this.data.phase !== 'cam' && this.data.phase !== 'retry')) return;
      this.setData({ busy: true });
      wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: ['album'], sizeType: ['compressed'],
        success: (res) => {
          const file = (res && res.tempFiles && res.tempFiles[0]) || {};
          this._shoot(file.tempFilePath, file.size);
        },
        fail: () => this.setData({ busy: false }),
      });
    },
    onCamError() {
      this._camErr = true;
      this.setData({ camOn: false });
      cyToast('相机打不开，可以从相册选一张');
    },
    _shoot(path, size) {
      if (!path) { this.setData({ busy: false }); cyToast('没拿到照片'); return; }
      this._before = this._snapshot();
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.setData({
        phase: 'proc', busy: false, camOn: false, shot: path, shotHidden: false,
        head: '处理中…', sub: '背景越干净，效果越好', headOn: true,
      });
      this._startSpin();
      this._later(WAIT_MS, () => {
        if (this.data.phase !== 'proc') return;
        cyToast('这次没等到结果，再拍一次');
        this._openCam();
      });
      this.triggerEvent('shoot', { tempFilePath: path, size: size });
    },
    _snapshot() {
      const d = this.data;
      return { tries: d.tries, passed: d.passed, flagged: d.flagged, degraded: d.degraded, card: d.card };
    },

    // ---------------- 结果 ----------------
    _maybeResult() {
      if (this.data.phase !== 'proc' || !this._before) return;
      const out = reveal.outcome(this._before, this._snapshot());
      if (!out) return;
      this._before = null;
      (this._timers || []).forEach(clearTimeout);
      this._timers = [];
      this._stopSpin();
      if (out === 'dissolve') { this._playDissolve(); return; }
      if (out === 'photo') {
        // 抠图没成:不演粒子,照片直接当卡面(施工文档 §3.2 第 4 条)
        this.setData({ head: '成功！', sub: '' });
        this._later(T.success, () => this._showInfo(true));
        return;
      }
      if (out === 'passedNoCard') { this._note('这张过了'); return; }
      if (out === 'retry') {
        this.setData({ phase: 'retry', head: '还差一点，再拍一张', sub: String(this.data.lastReason || '').trim() });
        return;
      }
      if (out === 'degraded') { this._note('这次没能审，先往下走'); return; }
      this._note(this._flaggedCopy());
    },
    _flaggedCopy() {
      return this.data.fallback === 'pass' ? '机会用完了，这张先算过' : '机会用完了';
    },
    _note(title) {
      this.setData({ phase: 'note', head: title, sub: '', headOn: true, pill: '继续', pillReady: true });
    },
    /** 信息态。fresh = 刚揭晓(保存按钮稍后才亮);回看直接能点「完成」。 */
    _showInfo(fresh) {
      const card = this.data.card || this.data.cardView || {};
      const src = card.cutoutUrl || card.sourceUrl || (card.frames && card.frames[0]) || '';
      this.setData({ phase: 'info', headOn: false, objSrc: src, formOn: true, cardView: card, pill: fresh ? '保存' : '完成', pillReady: !fresh });
      if (fresh) this._later(500, () => this.setData({ pillReady: true }));
    },

    // ---------------- 点阵消散 ----------------
    _playDissolve() {
      if (this.data.reducedMotion) { this._showInfo(true); return; }
      this.setData({ phase: 'reveal', cardView: this.data.card });
      this._stage().then((stage) => {
        if (!stage || this.data.phase !== 'reveal') { if (this.data.phase === 'reveal') this._showInfo(true); return; }
        const card = this.data.cardView;
        return Promise.all([
          loadImage(stage.canvas, this.data.shot).catch(() => null),
          loadImage(stage.canvas, card.cutoutUrl).catch(() => null),
        ]).then(([photo, cut]) => {
          if (this.data.phase !== 'reveal') return;
          // 任何一张没加载出来(例如图床域名没进 downloadFile 白名单):不演,直接出结果
          if (!photo || !cut) { this._showInfo(true); return; }
          this._animate(stage, photo, cut, card.cutoutBox);
        });
      }).catch(() => { if (this.data.phase === 'reveal') this._showInfo(true); });
    },
    _stage() {
      return new Promise((resolve) => {
        this.createSelectorQuery()
          .select('#ocStage').fields({ node: true, size: true })
          .select('.oc__vf').boundingClientRect()
          .select('.oc__sheet').boundingClientRect()
          .exec((res) => {
            const node = res && res[0] && res[0].node;
            const vfRect = res && res[1];
            const sheet = res && res[2];
            if (!node || !vfRect || !sheet) { resolve(null); return; }
            let dpr = 2;
            let winW = 375;
            try { const w = wx.getWindowInfo(); dpr = w.pixelRatio || 2; winW = w.windowWidth || 375; } catch (e) { /* 默认值 */ }
            const W = res[0].width;
            const H = res[0].height;
            node.width = Math.round(W * dpr);
            node.height = Math.round(H * dpr);
            const ctx = node.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this._canvas = node;
            this._ctx = ctx;
            resolve({
              canvas: node, ctx, dpr, W, H, k: winW / 750,
              vf: { x: vfRect.left - sheet.left, y: vfRect.top - sheet.top, w: vfRect.width, h: vfRect.height },
            });
          });
      });
    },
    _animate(stage, photo, cut, box) {
      const { ctx, canvas, dpr, vf, W, H, k } = stage;
      const radius = VF_RADIUS_RPX * k;
      const drawn = reveal.coverRect(photo.width, photo.height, vf.w, vf.h);
      drawn.x += vf.x;
      drawn.y += vf.y;
      const from = reveal.boxToRect(box, drawn);
      const to = reveal.fitRect(cut.width, cut.height, { cx: W / 2, cy: OBJ_RPX.cy * k, w: OBJ_RPX.w * k, h: OBJ_RPX.h * k });

      // 先取一次颜色与物品遮罩(设备像素坐标),之后逐帧只画不读
      const ix = Math.round(vf.x * dpr);
      const iy = Math.round(vf.y * dpr);
      const iw = Math.round(vf.w * dpr);
      const ih = Math.round(vf.h * dpr);
      let colors;
      let mask;
      try {
        ctx.clearRect(0, 0, W, H);
        ctx.save(); roundClip(ctx, vf.x, vf.y, vf.w, vf.h, radius); ctx.drawImage(photo, drawn.x, drawn.y, drawn.w, drawn.h); ctx.restore();
        colors = ctx.getImageData(ix, iy, iw, ih).data;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(cut, from.x, from.y, from.w, from.h);
        mask = ctx.getImageData(ix, iy, iw, ih).data;
        ctx.clearRect(0, 0, W, H);
      } catch (e) { this._showInfo(true); return; }

      const cols = Math.ceil(vf.w / CELL);
      const rows = Math.ceil(vf.h / CELL);
      const cells = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const px = Math.min(iw - 1, Math.round((i * CELL + CELL / 2) * dpr));
          const py = Math.min(ih - 1, Math.round((j * CELL + CELL / 2) * dpr));
          const o = (py * iw + px) * 4;
          if (mask[o + 3] > 110) continue;   // 物品本身的格子不碎
          const u = i / cols;
          cells.push({
            x: vf.x + i * CELL, y: vf.y + j * CELL,
            c: 'rgb(' + colors[o] + ',' + colors[o + 1] + ',' + colors[o + 2] + ')',
            pix: u * 380 + Math.random() * 60,              // 先变成点(从左往右扫)
            go: u * 620 + 260 + Math.random() * 260,        // 再飘走
            vx: 0.6 + Math.random() * 2.2, vy: (Math.random() - 0.6) * 1.3,
          });
        }
      }
      const tMove = T.dissolve + T.hold;
      const tEnd = tMove + T.move;
      this._later(T.success, () => this.setData({ head: '成功！', sub: '' }));
      this._later(tMove, () => this.setData({ headOn: false, pill: '保存' }));
      this._later(tMove + 120, () => this.setData({ formOn: true }));
      this._later(tMove + 620, () => this.setData({ pillReady: true }));

      const t0 = Date.now();
      let first = true;
      const frame = () => {
        const t = Date.now() - t0;
        ctx.clearRect(0, 0, W, H);
        if (t < 520) { // 照片还没全变成点:画照片,抠掉已经变点的格子
          ctx.save(); roundClip(ctx, vf.x, vf.y, vf.w, vf.h, radius);
          ctx.drawImage(photo, drawn.x, drawn.y, drawn.w, drawn.h);
          for (let n = 0; n < cells.length; n++) if (t > cells[n].pix) ctx.clearRect(cells[n].x, cells[n].y, CELL, CELL);
          ctx.restore();
        }
        for (let n = 0; n < cells.length; n++) {
          const c = cells[n];
          if (t <= c.pix) continue;
          const g = t - c.go;
          let s = CELL - clamp01((t - c.pix) / 220) * 3.7;
          let x = c.x + (CELL - s) / 2;
          let y = c.y + (CELL - s) / 2;
          let a = 1;
          if (g > 0) {
            const q = g / 16.7;
            x += c.vx * q + q * q * 0.02;
            y += c.vy * q;
            a = clamp01(1 - g / 700);
            s *= 1 - Math.min(0.6, g / 900);
          }
          if (a <= 0) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = c.c;
          ctx.fillRect(x, y, s, s);
        }
        ctx.globalAlpha = 1;
        const m = ease(clamp01((t - tMove) / T.move));
        ctx.drawImage(cut, from.x + (to.x - from.x) * m, from.y + (to.y - from.y) * m,
          from.w + (to.w - from.w) * m, from.h + (to.h - from.h) * m);
        if (first) { first = false; this.setData({ shotHidden: true }); }
        if (t >= tEnd) {
          this._loop = null;
          // 定格:canvas 停在终点,信息态的 <image> 盖在同一个框上,交接不跳
          this.setData({ phase: 'info', objSrc: this.data.cardView.cutoutUrl });
          return;
        }
        this._loop = canvas.requestAnimationFrame(frame);
      };
      this._loop = canvas.requestAnimationFrame(frame);
    },
    _stopLoop() {
      if (this._loop && this._canvas) this._canvas.cancelAnimationFrame(this._loop);
      this._loop = null;
    },
    _clearCanvas() {
      if (this._ctx && this._canvas) {
        try { this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height); } catch (e) { /* 画布已销毁 */ }
      }
    },

    // ---------------- 转圈 ----------------
    _startSpin() {
      this._stopSpin();
      if (this.data.reducedMotion) return;   // 减弱动态效果:辐条静止,只靠「处理中…」三个字
      this._spinTimer = setInterval(() => this.setData({ spin: (this.data.spin + 1) % 8 }), 100);
    },
    _stopSpin() {
      if (this._spinTimer) clearInterval(this._spinTimer);
      this._spinTimer = null;
    },

    // ---------------- 收尾 ----------------
    onPill() {
      if (!this.data.pillReady) return;
      this.triggerEvent('close');
    },
    onClose() { this.triggerEvent('close'); },
  },
});
