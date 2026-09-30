// cy-playkit-ballshake · 弹球(原型真源:模板编辑页 v2 · playkit shake)
//
// 倾斜手机让球撞够手机四条边。三条设计决定都不是随手定的:
//   · **不画内框** —— 墙就是手机的四条边。多一个框,人会以为框外还有别的东西;
//   · **不给默认重力** —— 球只跟着倾斜走。给一个默认向下的话,手机平放它也一直在弹,
//     玩家会以为这屏在自己动,而不是自己在控制它;
//   · **球很轻** —— 重力只有普通的三分之一、阻尼几乎不给。沉的球会滚到底边来回蹭,
//     弹不起来就没得玩。
//
// ★ 零点必须校准:人举着手机是三十几度不是平的。把开局那一刻的姿势记成「水平」,
// 之后只按相对偏移给力 —— 不然一撒手球就一直往下滚。校准由 cy-play-stage 统一出屏。
//
// ★ 撞击数报服务端复核:后端按 MAX_SHAKE_HITS_PER_SECOND(12)乘真实经过时间算上限,
// 超了就是伪造。设备可以谎报次数,谎报不了时间。

const STEP_MS = 16;
const R = 26;                  // 球半径,rpx。换算见下面 _r(按 750rpx 基准折成 px)
const GRAVITY = 0.05;          // 倾斜 → 加速度。普通重力的三分之一
const DAMP = 0.999;            // 阻尼几乎不给:球要一直有劲
const EDGES = ['top', 'bottom', 'left', 'right'];

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 反弹:反向 + 一点随机。不加随机的话球会卡进一条来回直线,
 *  分照涨但人已经不用操作了 —— 那是动画不是游戏。 */
function bounce(v, rand) {
  const r = typeof rand === 'function' ? rand() : Math.random();
  return -v * 0.98 + (r - 0.5) * 0.5;
}

/** 相对零点的倾斜 → 这一帧的加速度。零点没量过时不给力,球不动。 */
function tiltAccel(acc, zero) {
  if (!acc || !zero) return { gx: 0, gy: 0 };
  return {
    gx: -((acc.x || 0) - zero.x) * GRAVITY,
    gy: ((acc.y || 0) - zero.y) * GRAVITY,
  };
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '撞够 30 次' },
    goal: { type: Number, value: 30 },
    timed: { type: Boolean, value: false },
    seconds: { type: Number, value: 12 },
  },
  data: {
    hits: 0,
    running: false,
    ball: { x: 0, y: 0 },
    trail: [],
    flash: '',
    edges: EDGES,
  },
  observers: {
    show: function (show) {
      this._stop();
      if (!show) { this._offTilt(); return; }
      this.setData({ hits: 0, running: false, flash: '', trail: [] });
      this._measure();
    },
  },
  lifetimes: { detached() { this._stop(); this._offTilt(); } },
  // 切后台就停:回来时球还在原地,但这段时间没人在玩,继续跑等于白送时间
  pageLifetimes: { hide() { this._stop(); this._offTilt(); } },
  methods: {
    _bounce: bounce,            // 纯算法出口,供单测
    _tiltAccel: tiltAccel,

    _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
    _offTilt() {
      if (!this._tiltOn) return;
      this._tiltOn = false;
      wx.stopAccelerometer({ fail() {} });
      wx.offAccelerometerChange && wx.offAccelerometerChange(this._onTilt);
    },

    _measure() {
      const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : { windowWidth: 375, windowHeight: 700 };
      this._w = info.windowWidth;
      this._h = info.windowHeight;
      /* rpx → px:750rpx = 屏宽,所以 1rpx = windowWidth/750 px。
         写死 R/2 只在 375pt 的屏上对,窄屏球会偏大、宽屏偏小 —— 而这一屏
         的判定是「球撞到边几次」,球的大小直接改变难度。 */
      this._r = R * (this._w / 750);
    },

    onStart() {
      if (this.data.running) return;
      // 先把「现在这个握法」记成水平,再开局 —— 校准屏由 stage 出,量完它会回调 onRun
      this._zero = null;
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },

    /** stage 校准完 + 数完 3-2-1 之后才真正开跑 */
    onRun() {
      this._measure();
      this._x = this._w / 2;
      this._y = this._h * 0.35;
      this._vx = 0; this._vy = 0;   // 静止起步,倾斜了才动
      this._gx = 0; this._gy = 0;
      this._hits = 0;
      this.setData({ hits: 0, running: true });
      /* 开表要报给服务端:成绩按服务器时间复核,不先开表提交会被判成「还没开始」。
         设备时钟玩家改得动,所以这一条不能省。 */
      this.triggerEvent('start');

      this._onTilt = (res) => {
        if (!this._zero) { this._zero = { x: res.x || 0, y: res.y || 0 }; return; }
        const a = tiltAccel(res, this._zero);
        this._gx = a.gx; this._gy = a.gy;
      };
      wx.startAccelerometer({ interval: 'game', fail() {} });
      wx.onAccelerometerChange(this._onTilt);
      this._tiltOn = true;

      this._stop();
      this._timer = setInterval(() => this._step(), STEP_MS);
    },

    _step() {
      if (!this.data.running) return;
      this._vx += this._gx; this._vy += this._gy;
      this._vx *= DAMP; this._vy *= DAMP;
      this._x += this._vx; this._y += this._vy;

      const r = this._r;
      let hit = '';
      if (this._x < r)             { this._x = r;             this._vx = bounce(this._vx); hit = 'left'; }
      if (this._x > this._w - r)   { this._x = this._w - r;   this._vx = bounce(this._vx); hit = 'right'; }
      if (this._y < r)             { this._y = r;             this._vy = bounce(this._vy); hit = 'top'; }
      if (this._y > this._h - r)   { this._y = this._h - r;   this._vy = bounce(this._vy); hit = 'bottom'; }

      const trail = (this.data.trail || []).slice(0, 3);
      trail.unshift({ i: Date.now(), x: Math.round(this._x), y: Math.round(this._y), o: 0.14 });
      trail.forEach((t, i) => { t.o = 0.14 - i * 0.035; });

      if (hit) {
        this._hits += 1;
        motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      }
      /* 字段写死成字面量,不拼 patch 对象:UI-GATE-0 认不出动态 setData 写了哪些顶层字段,
         也就核不出它们在 WXML 有没有被消费。撞边那两个字段没撞时按原值回写,不多不少。 */
      this.setData({
        ball: { x: Math.round(this._x), y: Math.round(this._y) },
        trail: trail,
        hits: this._hits,
        flash: hit ? hit : this.data.flash,
      });

      if (hit && this._hits >= this.data.goal) this._finish(true);
    },

    _finish(won) {
      this._stop(); this._offTilt();
      this.setData({ running: false });
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) { if (won) stage.win('撞满了'); else stage.fail(true); }
      this.triggerEvent('submit', { hits: this._hits || 0, passed: !!won });
    },

    onVerdict(e) {
      // 限时走到点由 stage 判负,这里只负责把传感器关掉
      if (e.detail && e.detail.kind === 'fail') { this._stop(); this._offTilt(); this.setData({ running: false }); }
      this.triggerEvent('verdict', e.detail);
    },
    onClose() { this._stop(); this._offTilt(); this.triggerEvent('close'); },
  },
});
