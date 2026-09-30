// cy-playkit-countdown · 倒计时 · 一钟油(原型真源:模板编辑页 v2 · playkit countdown)
//
// 它**不附加玩法**:没有对错、没有次数、没有额外的限时开关 —— 它就是倒计时本身。
// 所以这里没有判定屏,到点只是把商家写的那句话亮出来。
//
// ★ 后端 SUBMIT_COUNTDOWN **不接受客户端报的数字**,一个都不收:
// 到没到点由服务端拿 START_CHALLENGE 记的时间戳算。这里报的只是「我这边走完了」。
//
// ⚠️ 用 setInterval 钉住,并且每一拍都重新拿 Date.now() 对时,不做 seconds-- 累加:
// 小程序切后台时 timer 会被限频甚至停掉,累加法回来会少算 —— 那等于白送时间。

const { formatElapsed } = require('../../../../utils/play-ui-contract.js');

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 已过 / 总时长 → 油面退到哪儿(0 = 满,100 = 空)。总时长缺失时不退。 */
function oilPercent(elapsedMs, totalSeconds) {
  if (!(totalSeconds > 0)) return 0;
  const k = elapsedMs / (totalSeconds * 1000);
  return Math.max(0, Math.min(100, Math.round(k * 100)));
}

/** 剩余秒数,向上取整:还剩 0.4 秒时显示 0 会让人以为已经到点了。 */
function remainSeconds(elapsedMs, totalSeconds) {
  if (!(totalSeconds > 0)) return 0;
  return Math.max(0, Math.ceil(totalSeconds - elapsedMs / 1000));
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '倒计时' },
    seconds: { type: Number, value: 90 },
    doneText: { type: String, value: '' },
  },
  data: {
    clock: '00:00',
    oilY: 0,
    running: false,
    finished: false,
  },
  observers: {
    'show, seconds': function (show, seconds) {
      this._stop();
      if (!show) return;
      this.setData({
        clock: formatElapsed(seconds > 0 ? seconds : 0),
        oilY: 0, running: false, finished: false,
      });
    },
  },
  lifetimes: { detached() { this._stop(); } },
  methods: {
    _oilPercent: oilPercent,            // 纯算法出口,供单测
    _remainSeconds: remainSeconds,
    _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },

    _tick() {
      const total = this.data.seconds > 0 ? this.data.seconds : 0;
      const elapsed = Date.now() - this._t0;      // 每拍对时,不累加
      const left = remainSeconds(elapsed, total);
      this.setData({ clock: formatElapsed(left), oilY: oilPercent(elapsed, total) });
      if (left > 0) return;
      this._stop();
      this.setData({ running: false, finished: true });
      // 「做成了」= 到点那一下。倒计时的全部意义就在这一刻
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('finish');
    },

    onStart() {
      if (this.data.running) return;
      this._t0 = Date.now();
      this.setData({ running: true, finished: false, oilY: 0 });
      this._stop();
      this._timer = setInterval(() => this._tick(), 1000);
      this.triggerEvent('start');
    },
    onClose() { this._stop(); this.triggerEvent('close'); },
  },
});
