// cy-playkit-typein · 限时打字(契约 §2.5)
//
// ★ 必须先开表:开始那一刻先发 START_CHALLENGE,服务端拿服务器时间记起点,
//   提交时的 elapsedMs 只是客户端读数、供核对用 —— 设备时钟玩家改得动。
// ★ 限时交给 cy-play-stage:它那条截止时刻是单独 setTimeout 钉死的,切后台也会到点判负;
//   组件自己再数一遍秒只负责显示,不参与判定。
// ★ 判定在服务端:内容相等 + 用时 <= seconds 都在后端算,组件只报原始输入。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const replayMotionBehavior = require('../../../../behaviors/replay-motion.js');
const motion = require('../../../../utils/motion.js');

Component({
  behaviors: [reducedMotionBehavior, replayMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    target: { type: String, value: '' },
    seconds: { type: Number, value: 10 },
    caseSensitive: { type: Boolean, value: false },
    tries: { type: Number, value: 0 },        // 0 = 不限
    attempts: { type: Number, value: 0 },
    passed: { type: Boolean, value: false },
  },
  data: {
    phase: 'intro',                            // intro | run
    typed: '',
    attemptLabel: '',
    canSubmit: false,
    locked: false,
    submitting: false,
  },
  observers: {
    /* 同一类型换到下一个 typein 节点时,playkit 的 wx:elif 分支不变、组件不重建,
       .ti__target 只是原地改字 —— 不重播的话目标文本直接跳变。
       首次挂载 prev 是 undefined,不走(那时节点本来就是新建的)。 */
    target(value) {
      const prev = this._seenTarget;
      this._seenTarget = value;
      if (prev !== undefined && prev !== value) this.replayMotion();
    },
    'show, attempts, passed': function (show, attempts, passed) {
      if (!show) return;
      /* 没打对整块台面抖一下 —— 与原版问答答错同一条(cy-play-stage 的 nudge,
         原型 .phone.shake:.28s cubic-bezier(.36,.07,.19,.97))。
         判据是「次数涨了但仍没过」:判定在服务端,客户端只认回流的这两个属性。
         ⚠️ 首次进屏(_seenAttempts 还没有)不抖,否则重进一次就平白抖一下。 */
      const seen = this._seenAttempts;
      const now = Number(attempts) || 0;
      if (seen != null && now > seen && !passed) {
        const stage = this.selectComponent('#cy-play-stage');
        if (stage && stage.nudge) stage.nudge();
      }
      this._seenAttempts = now;

      this._t0 = 0;
      const tries = Number(this.data.tries) || 0;
      this.setData({
        phase: 'intro',
        typed: '',
        canSubmit: false,
        submitting: false,
        attemptLabel: tries > 0 ? ('第 ' + ((Number(attempts) || 0) + 1) + ' / ' + tries + ' 次') : '',
        // 打对了就锁住:服务端也不会再收
        locked: !!passed,
      });
    },
  },
  methods: {
    /** 「开始」→ 台面数 3-2-1 → bind:run 回到这儿真正开跑(与 stopwatch 同一条路) */
    onStart() {
      if (this.data.locked) return;
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin(); else this.onRun();
    },

    onRun() {
      this._t0 = Date.now();
      this.setData({ phase: 'run', typed: '', canSubmit: false });
      // 开表要报给服务端:成绩按服务器时间复核,不先开表提交会被判「还没开始」
      this.triggerEvent('start');
    },

    onInput(e) {
      const typed = e.detail.value == null ? '' : String(e.detail.value);
      this.setData({ typed, canSubmit: !!typed.trim() });
    },

    onSubmit() {
      if (this.data.locked || this.data.submitting || this.data.phase !== 'run' || !this.data.canSubmit) return;
      // 交卷不可撤销 —— 与作答同一档触感。提交中锁住按钮:幂等键能兜住重复,但连点两次
      // 会多发一次请求,等回读那段时间里按钮看着还能点
      this.setData({ submitting: true });
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('submit', {
        text: this.data.typed,
        elapsedMs: this._t0 ? Date.now() - this._t0 : 0,
      });
    },

    onClose() { this.triggerEvent('close'); },
  },
});
