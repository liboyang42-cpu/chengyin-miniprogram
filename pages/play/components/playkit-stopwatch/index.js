// cy-playkit-stopwatch · 精准停表(原型真源:模板编辑页 v2 的试玩台 #kit2 · 549 精准停表)
//
// 盲停:表一走起来,走动的数字就藏了 —— 目标和容差不藏,它们是规则,不是答案。
// 不藏数字的话这题是「读秒」不是「估时」,谁都满分。
//
// ★ 容差在这个玩法里**不是**秘密,要下发:玩家得先知道才谈得上瞄准。
// 这一点与猜数字相反 —— 那边容差能反推出答案区间,所以那边藏。
//
// 判定仍在服务端:客户端报的毫秒数是设备时钟算的,而设备时钟玩家改得动。
// 后端 SUBMIT_STOPWATCH 用 START_CHALLENGE 记的服务器时间戳复核。

const TICK_MS = 50;                 // 与原型同值
const HIDE_AFTER_MS = 1000;         // 开跑 1 秒后数字消失
const MASK = '––:––.––';
const EYEBROW = '把手机拿到面前,随时可以开始';
const CAP_ON = '开跑 1 秒后数字消失 · 点屏幕任意处停';
const CAP_HID = '数字已隐藏 · 点屏幕任意处停';

/** 走动读数:秒,两位小数。原型 secs()。 */
const secs = (ms) => (Math.max(0, ms) / 1000).toFixed(2);

/** 底部那颗表:mm:ss.xx。原型 cs()。 */
function clockText(ms) {
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  return String(m).padStart(2, '0') + ':' + (t - m * 60).toFixed(2).padStart(5, '0');
}

/** 差多少秒。早停与晚停一视同仁,取绝对值。 */
const diffSeconds = (elapsedMs, targetSeconds) =>
  Math.abs(Math.max(0, elapsedMs) / 1000 - targetSeconds);

/** 三档措辞。「优秀」那一档不能比容差还宽 —— 容差配得极小时它得跟着收。 */
function tierLabel(diff, tolSeconds) {
  const fine = Math.min(0.05, tolSeconds / 2);
  if (diff <= fine) return '优秀';
  return diff <= tolSeconds ? '达标' : '差一点';
}

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    // 准备屏最上面那行小字。原型写死这一句;商家填了标题就用商家的
    kicker: { type: String, value: '' },
    targetSeconds: { type: Number, value: 10 },
    toleranceMs: { type: Number, value: 300 },
    tries: { type: Number, value: 0 },      // 0 = 不限
  },
  data: {
    phase: 'intro',                          // intro | run | paused | over
    eyebrow: EYEBROW,
    big: '0.00',
    hidden: false,
    timeText: '00:00.00',
    cap: CAP_ON,
    round: 1,
    targetText: '10.00',
    tolText: '0.30',
    dev: '',                                 // 没停准时的偏差「早 2.40 秒」
    left: 0,                                 // 没停准时还剩几次(台面记账,这里只读来显示)
  },
  /* ⚠️ 这里监听的四个全是**属性**,组件内部一个都不许写(targetText / tolText 才是
     内部那份)。observer 监听它、内部又写它,会自己触发自己,死循环把运行时打挂,
     而且一条错都不报 —— 掷骰子那屏踩过一次,查了很久才发现不是环境的问题。 */
  observers: {
    'show, kicker, targetSeconds, toleranceMs, tries': function (show, kicker, target, tol) {
      this._stop();
      if (!show) return;
      this.setData({
        phase: 'intro', big: '0.00', hidden: false, timeText: '00:00.00',
        cap: CAP_ON, round: 1,
        // 商家没填标题就用原型那句 —— 空着的话这一屏最上面会缺一行
        eyebrow: String(kicker || '').trim() || EYEBROW,
        targetText: Number(target || 0).toFixed(2),
        tolText: (Number(tol || 0) / 1000).toFixed(2),
      });
    },
  },
  lifetimes: { detached() { this._stop(); } },
  // 切后台这一轮作废:回来时表还在走,那个成绩不是估出来的
  pageLifetimes: { hide() { this._abort(); } },
  methods: {
    _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },

    _abort() {
      if (this.data.phase === 'intro') return;
      this._stop();
      this.setData({ phase: 'intro', big: '0.00', hidden: false, timeText: '00:00.00', cap: CAP_ON });
    },

    /** 「开始」→ 台面数 3-2-1 → bind:run 回到这儿真正开跑 */
    onStart() {
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin(); else this.onRun();
    },

    onRun() {
      this._t0 = Date.now();
      this.setData({ phase: 'run', big: '0.00', hidden: false, timeText: '00:00.00', cap: CAP_ON });
      this._stop();
      this._timer = setInterval(() => this._tick(), TICK_MS);
      // 开表要报给服务端:成绩按服务器时间复核(设备时钟玩家改得动),
      // 不先开表,SUBMIT_STOPWATCH 会被判成「还没开始」
      this.triggerEvent('start');
    },

    _tick() {
      const ms = Date.now() - this._t0;
      // 忘了停也不能永远走下去:超目标 30 秒当这局没发生
      if (ms > (this.data.targetSeconds + 30) * 1000) { this._abort(); return; }
      if (ms >= HIDE_AFTER_MS) {
        // 藏起来之后每拍再 setData 一次是白刷:屏上那两处已经不动了
        if (!this.data.hidden) this.setData({ hidden: true, cap: CAP_HID, timeText: MASK });
        return;
      }
      this.setData({ big: secs(ms), timeText: clockText(ms) });
    },

    onPause() {
      if (this.data.phase === 'run') {
        this._stop();
        this._paused = Date.now() - this._t0;
        this.setData({ phase: 'paused' });
        return;
      }
      if (this.data.phase !== 'paused') return;
      this._t0 = Date.now() - this._paused;
      this.setData({ phase: 'run' });
      this._timer = setInterval(() => this._tick(), TICK_MS);
    },

    /** 整个舞台就是「停」的按钮。暂停中不接受停 —— 那等于把表停在自己挑的一刻 */
    onStop() {
      // 停完还有次数时停在这一屏,读数留着;再点一下开下一局(原型那颗「再来一局」)
      if (this.data.phase === 'over') { this.setData({ round: this.data.round + 1 }); this.onRun(); return; }
      if (this.data.phase !== 'run') return;
      this._stop();
      const elapsed = Date.now() - this._t0;
      const tol = this.data.toleranceMs / 1000;
      const diff = diffSeconds(elapsed, this.data.targetSeconds);
      const hit = diff <= tol;
      const late = elapsed / 1000 > this.data.targetSeconds;
      const detail = diff < 0.005 ? '正好命中' : (late ? '晚 ' : '早 ') + diff.toFixed(2) + ' 秒';

      // 「做成了」= 按下停那一刻,不管准不准 —— 那一下是玩家真正做的动作
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });

      // 次数记账在台面:十九个玩法共用同一套「还能错几次」,不各存一份
      const stage = this.selectComponent('#cy-play-stage');
      const exhausted = !hit && stage ? stage.miss() : false;

      this.setData({
        phase: hit || exhausted ? 'run' : 'over',
        big: secs(elapsed), hidden: false, timeText: clockText(elapsed),
        cap: detail,
        dev: detail,
        left: stage ? stage.data.triesLeft : 0,
      });
      // 答错不算通关:没停准且次数用完就是失败,不给「差不多也算」
      if (stage) {
        if (hit) stage.win(tierLabel(diff, tol) + ' · ' + detail);
        else if (exhausted) stage.fail(false);
      }
      this.triggerEvent('submit', { elapsedMs: elapsed, deviationMs: diff * 1000, hit: hit });
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this._stop(); this.triggerEvent('close'); },
  },
});
