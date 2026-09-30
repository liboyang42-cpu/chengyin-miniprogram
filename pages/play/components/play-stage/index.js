// cy-play-stage · 玩法整屏台面(原型真源:模板编辑页 v2 · playkit)
//
// 这一层管的是**每个玩法都一样的那部分**:限时条、还能错几次、开跑前的 3-2-1、
// 传感器校准、判定屏。十九个玩法各写一份的话,玩家会以为自己在玩不同的产品。
//
// 铁律都在这儿,不在各玩法里:
//   · 限时条用 setInterval 对时,**截止时刻另用 setTimeout 钉死** ——
//     只靠逐帧刷新的话,切后台就永远不会超时,等于开了个作弊口子;
//   · 3-2-1 只在开了限时的玩法出现(变色就点没有限时开关,天然不数);
//   · 一局有了结果就 markDone,之后倒计时到点不再追上来判失败 ——
//     不然答对的人等两秒会莫名其妙变成失败。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 剩余 / 总时长 → 条还剩多长。总时长缺失时画满,不能读成「已超时」。 */
function limitPercent(leftSeconds, totalSeconds) {
  if (!(totalSeconds > 0)) return 100;
  const left = leftSeconds > 0 ? leftSeconds : 0;
  return Math.max(0, Math.min(100, Math.round((left / totalSeconds) * 100)));
}

/* 烧穿那一下的时长,与 WXSS 里 burnaway 同值;两边错开会出现「烧完了还停在黑屏上」 */
const BURN_MS = 1500;

Component({
  behaviors: [reducedMotionBehavior],
  options: { multipleSlots: false },
  properties: {
    show: { type: Boolean, value: false },
    backLabel: { type: String, value: '退出' },
    /* 皮肤名,逐字对应原型 .phone[data-skin=...]:estimate/guess/hidden/predict/
       bingo/draw/qa/qadark/branch;glass = 精准停表的浅色玻璃。空的落到 skin-none(问答暗版)。 */
    skin: { type: String, value: '' },
    limitSeconds: { type: Number, value: 0 },     // 0 = 不限时
    /* 不限时但开局也要数 3-2-1 的玩法(精准停表):它的成绩从第一毫秒起算,
       不数完就开跑等于把「还没准备好」那半秒记进成绩里。 */
    countIn: { type: Boolean, value: false },
    tries: { type: Number, value: 0 },            // 0 = 不限次数
    calibrateLabel: { type: String, value: '' },  // 非空 = 开局前要校准
    calibrateMs: { type: Number, value: 1200 },
  },
  data: {
    // 状态栏高度从系统信息读,不靠 env(safe-area-inset-top):
    // 模拟器里那个 env 返回 0,退出按钮会压在状态栏时钟上(实测)。
    topPad: 44,
    /* 顶上两行各占多高(px)。原型里它们排在流里、天然把内容顶下去;我们为了让各屏
       自己刷底色改成了绝对定位,就得把这两个高度手动加进 --pk-top。 */
    contentTop: 106,
    triesTop: 106,
    limitLeft: 0,
    limitScale: 1,
    triesTotal: 0,
    triesLeft: 0,
    triesDots: [],
    countingIn: false,
    calibrating: false,
    verdict: '',
    shaking: false,
    verdictText: '',
    timedOut: false,
  },
  observers: {
    'show, tries, limitSeconds': function (show, tries, limitSeconds) {
      if (!show) { this._stopAll(); return; }
      const n = tries > 0 ? tries : 0;
      const top = this._layout(limitSeconds > 0, n > 0);
      this.setData({
        contentTop: top.contentTop,
        triesTop: top.triesTop,
        triesTotal: n, triesLeft: n,
        triesDots: Array.from({ length: n }, (_, i) => i),
        // 还没开跑时条是**满**的、读数是总时长。初值留 0 的话,
        // 玩家在 3-2-1 那两秒里看到的是「限时 0s」—— 像是已经超时了
        limitLeft: limitSeconds > 0 ? limitSeconds : 0,
        limitScale: 1,
      });
    },
  },
  lifetimes: {
    attached() {
      try {
        const info = wx.getSystemInfoSync();
        if (info && info.statusBarHeight > 0) {
          /* topPad 是异步读回来的,读到之后那两行的位置和内容起点都要跟着重算 ——
             只 setData topPad 的话,--pk-top 还停在默认 44 那一版上。 */
          this.setData({ topPad: info.statusBarHeight });
          const top = this._layout(this.data.limitSeconds > 0, this.data.triesTotal > 0);
          this.setData({ contentTop: top.contentTop, triesTop: top.triesTop });
        }
      } catch (e) { /* 读不到就用默认 44,不让一次读取失败把整屏顶掉 */ }
    },
    detached() { this._stopAll(); },
  },
  pageLifetimes: { hide() { this._stopTick(); } },
  methods: {
    /* 顶上那两行谁在、谁不在,决定内容从哪儿开始。
       ⚠️ 不能写死:2026-09-16 之前限时条从来喂不到值、永远不显示,于是写死的
       `topPad + 62` 一直看着没问题;接通那天起它就正好压在题干上。 */
    _layout(hasLimit, hasTries) {
      const BASE = 62;      // 退出按钮那一行之下
      const LIMIT_H = 40;   // 限时条整行(含间距)
      const TRIES_H = 38;   // 还能错整行(含间距)
      const pad = this.data.topPad;
      const triesTop = pad + BASE + (hasLimit ? LIMIT_H : 0);
      /* ⚠️ 键名别叫 tries/content:observer 正监听属性 `tries`,返回一个同名键
         在形状上分不清「读它」还是「写它」—— 自触发 observer 门禁会判红,
         而那条门禁防的是死循环打挂运行时且一条错都不报。 */
      return {
        triesTop: triesTop,
        contentTop: triesTop + (hasTries ? TRIES_H : 0),
      };
    },

    _limitPercent: limitPercent,        // 纯算法出口,供单测

    _stopTick() { if (this._tick) { clearInterval(this._tick); this._tick = null; } },
    _stopDeadline() { if (this._deadline) { clearTimeout(this._deadline); this._deadline = null; } },
    _stopBurn() { if (this._burn) { clearTimeout(this._burn); this._burn = null; } this._burning = false; },
    _stopShake() { if (this._shakeTimer) { clearTimeout(this._shakeTimer); this._shakeTimer = null; } },
    _stopAll() {
      this._stopTick(); this._stopDeadline(); this._stopBurn(); this._stopShake();
      this._done = false;
      this.setData({ countingIn: false, calibrating: false, verdict: '', verdictText: '' });
    },

    /** 开一局。校准 → 3-2-1 → 真正开跑,缺哪步跳哪步。 */
    begin() {
      this._done = false;
      this.setData({ verdict: '', verdictText: '', timedOut: false });
      if (this.data.calibrateLabel) { this.setData({ calibrating: true }); return; }
      this._afterCalibrate();
    },
    onCalibrateTick() { this.triggerEvent('calibratetick'); },
    onCalibrated() {
      this.setData({ calibrating: false });
      this.triggerEvent('calibrated');
      this._afterCalibrate();
    },
    _afterCalibrate() {
      // 3-2-1 给限时的、以及自己要求数的那些:计时从看到题那一刻起跳的话,人还在读题就在扣秒
      if (this.data.limitSeconds > 0 || this.data.countIn) { this.setData({ countingIn: true }); return; }
      this._run();
    },
    onCountedIn() { this.setData({ countingIn: false }); this._run(); },

    _run() {
      const total = this.data.limitSeconds;
      if (total > 0) {
        const t0 = Date.now();
        this.setData({ limitLeft: total, limitScale: 1 });
        this._stopTick();
        this._tick = setInterval(() => {
          const left = Math.max(0, Math.ceil(total - (Date.now() - t0) / 1000));
          this.setData({ limitLeft: left, limitScale: limitPercent(left, total) / 100 });
        }, 1000);
        // ★ 截止时刻单独钉死:逐拍刷新会被后台限频,只靠它就永远不会超时
        this._stopDeadline();
        this._deadline = setTimeout(() => this.failByTime(), total * 1000 + 60);
      }
      this.triggerEvent('run');
    },

    /** 错一次。返回是否已经用完 —— 用完由调用方决定要不要直接判负。 */
    miss() {
      if (this.data.triesTotal <= 0) return false;
      const left = Math.max(0, this.data.triesLeft - 1);
      this.setData({ triesLeft: left });
      return left === 0;
    },

    win(text) {
      if (this._done) return;
      this._done = true;
      this._stopTick(); this._stopDeadline();
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.setData({ verdict: 'win', verdictText: text || '', timedOut: false });
      this.triggerEvent('verdict', { kind: 'win' });
    },
    /** 判负。timedOut 决定屏上那两个字是「时间到」还是「失败」。 */
    fail(timedOut) {
      if (this._done) return;
      this._done = true;
      this._stopTick(); this._stopDeadline();
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.setData({ verdict: 'fail', verdictText: '', timedOut: !!timedOut });
      this.triggerEvent('verdict', { kind: 'fail', timedOut: !!timedOut });
    },
    /* 时间到:先让屏上的内容烧掉(原型 .burning + burnaway 1.5s),烧完才出判定屏。
       直接弹判定屏的话,「时间到」这件事只剩两个字,玩家看不到它是怎么没的。
       减动效跳过这一段 —— 烧的是观感,判定不能等。 */
    failByTime() {
      if (this._done || this._burning) return this.fail(true);
      if (this.data.reducedMotion) return this.fail(true);
      this._burning = true;
      this.triggerEvent('burn');
      this._burn = setTimeout(() => { this._burn = null; this.fail(true); }, BURN_MS);
    },

    /** 答错抖一下。由玩法在判错那一刻调:stage.nudge()。
        减动效直接不抖 —— 这一下是反馈不是信息,信息在那一行的红上。 */
    nudge() {
      if (this.data.reducedMotion || this.data.shaking) return;
      this.setData({ shaking: true });
      // 句柄要存:同文件另外三个计时器都存了,这一个不存的话 300ms 内退出会对已销毁组件 setData
      if (this._shakeTimer) clearTimeout(this._shakeTimer);
      this._shakeTimer = setTimeout(() => {
        this._shakeTimer = null;
        this.setData({ shaking: false });
      }, 300);
    },

    onBack() { this._stopAll(); this.triggerEvent('back'); },
  },
});
