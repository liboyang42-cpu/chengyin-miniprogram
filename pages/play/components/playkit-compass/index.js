// cy-playkit-compass · 罗盘指向(原型真源:模板编辑页 v2 · playkit compass)
//
// ★ 做过就算,没有对错、不限次数 —— 与估数/预测同口径(现场感契约 §3.4)。
// ★ 判「对准并保持」不判「扫过」:手抖、边走边看会在某一帧正好压进容差区,
//   只认瞬间值等于送分。holdSeconds 就是商家要人站在那儿的那几秒。
// ★ 针角必须走**连续**轨道:朝向从 359° 回到 1° 时针只该转 2°,
//   直接拿 (target-heading) mod 360 会让针每次过正北都倒着绕一大圈。
// ★ 判定在服务端复核(容差同样验一遍),客户端只做呈现,不做裁决。
// ★ 禁止当到店凭证或有金额的完成条件 —— 罗盘读数在室内偏几十度是常事,
//   拿它换真金白银的东西,第一周就会做成一个没人能赢的活动。

const motion = require('../../../../utils/motion.js');
const { readReducedMotion } = require('../../../../utils/motion-preference.js');

const TICK_MS = 100;
const NODATA_TICKS = 30;   // 3 秒没等到一帧方向 = 这台机器压根没在报,别装忙

/** 两方位角的最小夹角。与服务端 angleDiff 同口径:359° 与 1° 相差 2° 而不是 358°。 */
function angleDiff(a, b) {
  const raw = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(raw, 360 - raw);
}

/** 归一到 0-359(提交前用,服务端门禁认这个区间)。 */
function normalize(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** 连续针角:在等价角度里挑离上一帧最近的那个,针就永远走短弧。 */
function continuous(target, prev) {
  let deg = ((target % 360) + 360) % 360;
  if (prev == null) return deg;
  while (deg - prev > 180) deg -= 360;
  while (deg - prev < -180) deg += 360;
  return deg;
}

/** 目标相对当前朝向的带符号夹角,落在 [-180, 180):正 = 目标在右手边(往右转朝向变大)。 */
function signedDelta(target, heading) {
  return ((((target - heading) % 360) + 540) % 360) - 180;
}

/** 转向提示:只说往哪边、还差多少度,不另立规则。 */
function turnText(delta) {
  const n = Math.round(Math.abs(delta));
  return (delta > 0 ? '往右转 ' : '往左转 ') + n + '°';
}

/** 读数不稳:Android 给枚举串;iOS 的 accuracy 是相对磁北的偏角、不表精度,不据此判 */
const LOW_ACCURACY = ['low', 'unreliable', 'no-contact'];
function isLowAccuracy(accuracy) {
  return typeof accuracy === 'string' && LOW_ACCURACY.indexOf(accuracy) !== -1;
}

// 刻度尺:每 5° 一格、30° 一道长刻度并标度数,四个正方位换成方位字
/** 容差区:顶上 ±tolerance 那一段,每 2.5° 一根短棒(固定在屏上,不随刻度盘转) */
function zoneBars(tol) {
  const n = Math.floor(tol / 2.5);
  const bars = Array.from({ length: n * 2 + 1 }, (_, i) => (i - n) * 2.5);
  // 容差不是 2.5 的整数倍时补上两端,画出来的区不能比判定区窄
  return n * 2.5 < tol ? [-tol].concat(bars, [tol]) : bars;
}

const TICKS = Array.from({ length: 72 }, (_, i) => ({ deg: i * 5, major: i % 6 === 0 }));
const CARDINAL = { 0: '北', 90: '东', 180: '南', 270: '西' };
const LABELS = Array.from({ length: 12 }, (_, i) => {
  const deg = i * 30;
  return { deg, text: CARDINAL[deg] || String(deg), cardinal: !!CARDINAL[deg], north: deg === 0 };
});

Component({
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '' },
    target: { type: Number, value: 0 },        // 商家选定的目标方位角 0-359
    tolerance: { type: Number, value: 15 },
    holdSeconds: { type: Number, value: 3 },
    hint: { type: String, value: '' },
    done: { type: Boolean, value: false },     // 进来就对准过:只读状态,不再收
  },
  data: {
    phase: 'idle',       // idle = 还没开始 / run = 表在走
    heading: 0,          // 当前朝向(屏上那个大数)
    needleDeg: 0,        // 连续针角,transform 用它
    aligned: false,
    holdLeft: '0.0',
    noData: false,
    rm: false,
    ticks: TICKS,
    labels: LABELS,
    roseDeg: 0,          // 刻度盘反转角(连续轨道,同针角)
    hasHeading: false,   // 拿到过朝向才画方位字,没朝向时方位字是假的
    zoneBars: zoneBars(15),
    holdPct: 0,
    turnHint: '',
    lowAccuracy: false,
  },
  observers: {
    show(v) { if (!v) { this._stop(); this._stopCompass(); this.setData({ phase: 'idle', aligned: false, noData: false, lowAccuracy: false }); } },
    tolerance(v) { this.setData({ zoneBars: zoneBars(v > 0 ? v : 15) }); },
  },
  lifetimes: {
    attached() { this.setData({ rm: readReducedMotion() }); },
    detached() { this._stop(); this._stopCompass(); },
  },
  // 切后台停表:罗盘事件在后台会被限频,回来那一帧的间隔可能好几秒 ——
  // 不夹住的话等于「揣兜里那半分钟」白赚保持时长(与 quiethold 同一条)
  pageLifetimes: { hide() { this._abort(); } },
  methods: {
    _angleDiff: angleDiff,       // 纯算法出口,供单测
    _normalize: normalize,
    _continuous: continuous,
    _signedDelta: signedDelta,
    _turnText: turnText,
    _isLowAccuracy: isLowAccuracy,
    _zoneBars: zoneBars,

    _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
    _stopCompass() {
      if (!this._listening) return;
      this._listening = false;
      try { if (this._cb && wx.offCompassChange) wx.offCompassChange(this._cb); } catch (e) { /* 没注册成功过 */ }
      try { wx.stopCompass(); } catch (e) { /* 已经停了 */ }
      this._cb = null;
    },
    _abort() {
      if (this.data.phase !== 'run' || this._sent) return;
      this._stop(); this._stopCompass();
      this.setData({ phase: 'idle', aligned: false, noData: false, lowAccuracy: false });
    },

    onStart() {
      if (this.data.done || this.data.phase === 'run') return;
      const stage = this.selectComponent('#cy-play-stage');
      // 没有限时也没有校准:begin() 会直接回 'run',走这一层是为了和其余玩法同一条开跑线
      if (stage) stage.begin(); else this.onRun();
    },

    /** stage 放行后真正开跑:订阅罗盘 + 起表 */
    onRun() {
      if (this._sent || this.data.done) return;
      this._heading = null;
      this._prevNeedle = null;
      this._prevRose = null;
      this._held = 0;
      this._ticks = 0;
      this._last = Date.now();
      this._lowAccuracy = false;
      this.setData({
        phase: 'run', aligned: false, noData: false, holdLeft: (this._holdTotal()).toFixed(1),
        hasHeading: false, roseDeg: 0, holdPct: 0, turnHint: '', lowAccuracy: false,
      });

      this._cb = (res) => {
        const d = res && Number(res.direction);
        if (Number.isFinite(d)) { this._heading = d; this._ticks = 0; }
        if (res) this._lowAccuracy = isLowAccuracy(res.accuracy);
      };
      this._listening = true;
      wx.onCompassChange(this._cb);

      this._stop();
      this._timer = setInterval(() => this._tick(), TICK_MS);
    },

    _holdTotal() {
      const h = this.data.holdSeconds;
      return h > 0 ? h : 1;
    },

    _tick() {
      // 判过之后就算计时器还在也别再动:清表靠 _stop,这一行兜住任何漏网的拍
      if (this._sent || this.data.phase !== 'run') return;
      const now = Date.now();
      // 一帧最多只记 0.1 秒:定时器被后台限频时,回来那一帧的间隔可能有好几秒
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;

      if (this._heading == null) {
        this._ticks += 1;
        if (this._ticks === NODATA_TICKS) this.setData({ noData: true });
        return;
      }

      const target = this.data.target || 0;
      const tol = this.data.tolerance > 0 ? this.data.tolerance : 15;
      const diff = angleDiff(this._heading, target);
      const aligned = diff <= tol;
      const needle = continuous(target - this._heading, this._prevNeedle);
      this._prevNeedle = needle;
      const rose = continuous(-this._heading, this._prevRose);
      this._prevRose = rose;

      if (aligned) {
        this._held += dt;
        if (this._held >= this._holdTotal()) { this._finish(); return; }
      } else {
        this._held = 0;
      }

      this.setData({
        heading: normalize(this._heading),
        needleDeg: needle,
        roseDeg: rose,
        hasHeading: true,
        aligned,
        holdPct: Math.round(Math.min(1, this._held / this._holdTotal()) * 100),
        turnHint: turnText(signedDelta(target, this._heading)),
        lowAccuracy: this._lowAccuracy,
        holdLeft: Math.max(0, this._holdTotal() - this._held).toFixed(1),
      });
    },

    _finish() {
      this._stop(); this._stopCompass();
      this._sent = true;
      this.setData({ holdPct: 100 });
      motion.haptic({ reducedMotion: this.data.rm, type: 'medium' });
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.win('对准了，保持了 ' + this._holdTotal() + ' 秒');
      // 报当前读数不报目标值:服务端按同一容差复核,拿读数去复核才是真判过
      this.triggerEvent('submit', { bearing: normalize(this._heading || this.data.target) });
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this._stop(); this._stopCompass(); this.triggerEvent('close'); },
  },
});
