// cy-playkit-quiethold · 安静挑战(原型真源:模板编辑页 v2 · playkit quiet)
//
// ★ 过线就判输,不是清零重来。「一声都不许出」这条规则要立得住,就不能给第二次。
//
// ⚠️ 录音**不上传、不落盘,用完即弃**:这一屏只需要每帧的振幅,不需要内容。
// ⚠️ 这是这批里最贵的一个玩法 —— 麦克风授权弹窗会劝退一部分人。
//    适合本来就安静的场所(书店、茶室),不适合街边。

const TICK_MS = 100;
const FRAME_MS = 100;

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
// 电平算法与 shout 共用一份(现场感契约 §5.1 抽出),这里只留用法。
const audioLevel = require('../../utils/play-audio-level.js');
const { baseline, thresholds, bandOf, peakOf } = audioLevel;

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '别出声' },
    sub: { type: String, value: '' },
    seconds: { type: Number, value: 15 },
  },
  data: {
    left: '15.0',
    band: 'ok',
    running: false,
  },
  observers: {
    'show, seconds': function (show, seconds) {
      this._stop();
      if (!show) { this._stopMic(); return; }
      this.setData({ left: (seconds > 0 ? seconds : 0).toFixed(1), band: 'ok', running: false });
    },
  },
  lifetimes: { detached() { this._stop(); this._stopMic(); } },
  // 切后台就停:回来那一帧的间隔可能有好几秒,不停等于「熄屏几秒」白赚几秒安静,
  // 而那几秒根本没在听
  pageLifetimes: { hide() { this._abort(); } },
  methods: {
    _baseline: baseline,        // 纯算法出口,供单测
    _thresholds: thresholds,
    _bandOf: bandOf,
    _peakOf: peakOf,

    _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
    _stopMic() {
      if (!this._rec) return;
      try { this._rec.stop(); } catch (e) { /* 已经停了 */ }
      this._rec = null;
    },
    _abort() {
      if (!this.data.running) return;
      this._stop(); this._stopMic();
      this.setData({ running: false, band: 'ok' });
    },

    onStart() {
      if (this.data.running) return;
      this._samples = [];
      this._peak = 0;
      this._startMic();
      // 校准屏由 stage 出:量 2 秒环境音,期间每一拍回调 onSample
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },

    _startMic() {
      const rec = wx.getRecorderManager();
      this._rec = rec;
      rec.onFrameRecorded((res) => { this._peak = peakOf(res.frameBuffer); });
      // 拿不到麦克风就明说,不假装在听 —— 让人以为在真听是更糟的事
      rec.onError(() => {
        this._stop(); this._stopMic();
        this.setData({ running: false, band: 'ok' });
        this.triggerEvent('micdenied');
      });
      rec.start({ duration: 600000, sampleRate: 16000, numberOfChannels: 1,
                  format: 'PCM', frameSize: 1 });
    },

    /** 校准期间每一拍采一个峰值 */
    onSample() { this._samples.push(this._peak || 0); },

    onCalibrated() {
      const t = thresholds(baseline(this._samples));
      this._mid = t.mid;
      this._hot = t.hot;
    },

    /** stage 校准完(这玩法没有限时开关,所以不数 3-2-1)之后真正开跑 */
    onRun() {
      const total = this.data.seconds > 0 ? this.data.seconds : 15;
      this._held = 0;
      this._last = Date.now();
      this.setData({ running: true, left: total.toFixed(1), band: 'ok' });
      // 开表要报给服务端:成绩按服务器时间复核,不先开表提交会被判成「还没开始」
      this.triggerEvent('start');
      this._stop();
      this._timer = setInterval(() => {
        const now = Date.now();
        // ★ 一帧最多只记 0.1 秒:切后台时定时器会被限频,回来那一帧的间隔可能有好几秒 ——
        // 不夹的话等于熄屏几秒就白得几秒安静,而那几秒根本没在听
        const dt = Math.min(0.1, (now - this._last) / 1000);
        this._last = now;

        const band = bandOf(this._peak || 0, this._mid, this._hot);
        if (band !== this.data.band) this.setData({ band });
        if (band === 'hot') { this._finish(false); return; }

        this._held += dt;
        const left = Math.max(0, total - this._held);
        this.setData({ left: left.toFixed(1) });
        if (this._held >= total) this._finish(true);
      }, TICK_MS);
    },

    _finish(won) {
      this._stop(); this._stopMic();
      this.setData({ running: false });
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) {
        if (won) stage.win('整整 ' + this.data.seconds + ' 秒,一声没出');
        else stage.fail(false);      // 出声不是超时,那两个字是「失败」
      }
      this.triggerEvent('submit', { heldSeconds: Math.round(this._held || 0), passed: !!won });
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this._stop(); this._stopMic(); this.triggerEvent('close'); },
  },
});
