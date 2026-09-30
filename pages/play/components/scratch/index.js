// cy-scratch · 擦开 / 刮开(2026-08-27)
//
// 来源:Figma「玩法游戏UI·动效稿」UX 借鉴板 —— 三块讲的是同一件事:
//   · 🏆 ADA C「过程即满足」(PowerWash Simulator,2026 Delight 得主):
//     **锁定内容不是点开的,是玩家手指「擦亮」的** —— 爽感从「拿到奖励那一刻」前移到动作本身;
//   · 🗺 地图 UX 的 Fog of World(雾);
//   · ✋ 直接操控 UX 的 Google Pay Scratch(刮开)。
// 所以只做一个组件,三处都能用。
//
// ⚠️ **无障碍是这件事的硬边界,不是加分项。**
// 「擦」是一个**运动能力要求**:手部不便、用辅助工具、或开了「减少动态效果」的人,
// 可能根本擦不动。所以 reducedMotion 为真时**整层不渲染、内容直接可见** ——
// 不是「擦得快一点」,是**不要求擦**。把内容藏在一个人做不到的手势后面,
// 就是把它变成了不可达内容。
//
// ⚠️ 进度判定不在每次 touchmove 里做:getImageData 很贵,60fps 调它会掉帧。
// 改成**采样网格 + 节流**:每 THROTTLE_MS 才量一次,量的是 SAMPLE×SAMPLE 个点。
const motion = require('../../../../utils/motion.js');
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const { sampledAlphaProgress, shouldReveal } = require('../../utils/scratch-progress.js');

const SAMPLE = 16;          // 采样网格边长(256 个点足以判"擦了多少",不必逐像素)
const THROTTLE_MS = 120;    // 两次进度采样的最小间隔
const HAPTIC_EVERY = 5;     // 每 N 次 move 震一下 —— 每次都震会变成持续嗡鸣

Component({
  behaviors: [reducedMotionBehavior],
  options: { multipleSlots: true },
  properties: {
    /* 遮罩颜色。默认用 DS 的中性遮罩,不写死灰度值 */
    coverColor: { type: String, value: '' },
    /* 擦到多少比例算完成。0.55 是刮刮卡的通行值:再高会逼用户把角落都擦干净 */
    threshold: { type: Number, value: 0.55 },
    /* 笔刷半径(px,已按 dpr 放大) */
    brush: { type: Number, value: 16 },
    /* 已经揭开过的内容不该再盖一层雾 */
    revealed: { type: Boolean, value: false },
    /* 无障碍名字:读屏用户听到的是这个,不是「一块灰色」 */
    label: { type: String, value: '' },
  },
  data: {
    /* 遮罩层是否在画面上。revealed / reducedMotion 任一为真都不挂。
       ⚠️ 「已擦完」记在实例上(this._done)而不是 data:wxml 从头到尾没引用过它,
       进了 data 就是一条死字段(U4 门禁会判红),而且白过一次桥。 */
    _masked: false,
  },
  observers: {
    'revealed, reducedMotion': function (revealed, reducedMotion) {
      const masked = !revealed && !reducedMotion && !this._done;
      if (masked !== this.data._masked) this.setData({ _masked: masked });
      if (masked) this._prepare();
    },
  },
  lifetimes: {
    attached() {
      this._moves = 0;
      this._lastMeasure = 0;
      this._done = false;
    },
    detached() {
      this._canvas = null;
      this._ctx = null;
    },
  },
  methods: {
    _prepare() {
      const query = wx.createSelectorQuery().in(this);
      query.select('#scratchCanvas').fields({ node: true, size: true }).exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) return;   // 组件还没上屏:等下一次 observer 再来
        const canvas = item.node;
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const dpr = info.pixelRatio || 2;
        canvas.width = Math.max(1, Math.round(item.width * dpr));
        canvas.height = Math.max(1, Math.round(item.height * dpr));
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        // 铺遮罩。取不到 token 就退到中性灰 —— 组件不该因为拿不到变量而透出下面的内容
        ctx.fillStyle = this.data.coverColor || '#8C8C8C';
        ctx.fillRect(0, 0, item.width, item.height);
        this._canvas = canvas;
        this._ctx = ctx;
        this._dpr = dpr;
        this._cssW = item.width;
        this._cssH = item.height;
        this._moves = 0;
      });
    },

    _erase(x, y) {
      const ctx = this._ctx;
      if (!ctx) return;
      // destination-out:画的地方变透明,底下的 slot 就露出来
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, this.data.brush, 0, Math.PI * 2);
      ctx.fill();
    },

    _measure() {
      const canvas = this._canvas;
      const ctx = this._ctx;
      if (!canvas || !ctx) return;
      const stepX = canvas.width / (SAMPLE + 1);
      const stepY = canvas.height / (SAMPLE + 1);
      const alphas = [];
      for (let i = 1; i <= SAMPLE; i++) {
        for (let j = 1; j <= SAMPLE; j++) {
          const px = ctx.getImageData(Math.round(stepX * i), Math.round(stepY * j), 1, 1);
          alphas.push(px.data[3]);
        }
      }
      if (shouldReveal(sampledAlphaProgress(alphas), this.data.threshold)) this._finish();
    },

    _finish() {
      if (this._done) return;
      this._done = true;
      this.setData({ _masked: false });
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('reveal');
    },

    onTouchMove(e) {
      if (!this._ctx || this._done) return;
      const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!touch) return;
      // 组件内相对坐标:小程序给的是页面坐标,要减去元素自身的位置
      const rect = this._rect;
      if (!rect) { this._syncRect(); return; }
      this._erase(touch.clientX - rect.left, touch.clientY - rect.top);

      this._moves += 1;
      // 每擦一下轻震(节流):稿里那句「每擦一下轻震」照做,但每 move 都震会变成持续嗡鸣
      if (this._moves % HAPTIC_EVERY === 0) {
        motion.haptic({ reducedMotion: this.data.reducedMotion });
      }
      const now = Date.now();
      if (now - this._lastMeasure >= THROTTLE_MS) {
        this._lastMeasure = now;
        this._measure();
      }
    },

    onTouchStart() {
      this._syncRect();
    },

    _syncRect() {
      wx.createSelectorQuery().in(this).select('#scratchCanvas').boundingClientRect((rect) => {
        if (rect) this._rect = rect;
      }).exec();
    },

    /* 兜底出口:可见按钮直接揭开，不要求持续擦除或长按。 */
    onDirectReveal() {
      this._finish();
    },
  },
});
