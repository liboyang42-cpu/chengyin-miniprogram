// cy-playkit-diceroll · 掷骰子(原型真源:模板编辑页 v2 · playkit dice)
//
// ★ 点数由服务端出。跟抛硬币同理:客户端的随机数玩家改得动,而这玩法的结果直接对应任务。
// 后端 ROLL_DICE 幂等 —— 重复提交返回第一次的点数,不重摇。
//
// 两颗那一档**只报点数和**,不对应任务:一颗才是「掷到几就做第几件事」,
// 两颗是用来分胜负的。把两颗的和拿去索引六个面会越界,那是另一个玩法。

const ROLL_MS = 900;

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const { createShakeDetector } = require('../../utils/play-shake.js');
const { createD20Renderer } = require('../../utils/d20-renderer.js');

/* 骰面点位:九宫格里哪几格有点。1 在中心、2 走对角,与真骰子一致 —— 
   随便摆的话玩家一眼看得出不对劲,虽然说不上哪儿不对。 */
const PIPS = {
  1: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  2: [1, 0, 0, 0, 0, 0, 0, 0, 1],
  3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  4: [1, 0, 1, 0, 0, 0, 1, 0, 1],
  5: [1, 0, 1, 0, 1, 0, 1, 0, 1],
  6: [1, 0, 1, 1, 0, 1, 1, 0, 1],
};

/** 点数 → 九格布尔。越界给一颗空骰子,不抛错:一次显示异常好过整屏白。 */
function pipsOf(n) {
  return PIPS[n] || [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/** 一颗时任务 = 第 N 面;两颗时没有任务,只有点数和。 */
function taskFor(values, faces) {
  if (!Array.isArray(values) || values.length !== 1) return '';
  const face = (faces || [])[values[0] - 1];
  return face || '';
}

const sumOf = (values) => (values || []).reduce((a, b) => a + b, 0);

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    mode: { type: String, value: 'd6' },
    dc: { type: Number, value: 10 },
    modifier: { type: Number, value: 0 },
    rollMode: { type: String, value: 'normal' },
    result: { type: Object, value: null },
    preview: { type: Boolean, value: false },
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '掷到几就做第几件事' },
    faces: { type: Array, value: [] },
    // 服务端给的点数,如 [4] 或 [5,4]。空 = 还没摇
    values: { type: Array, value: [] },
    /* 一颗还是两颗。玩家可以自己切,页面拿到 count 事件后按新颗数去要点数。
       ⚠️ 这是**属性**,组件内部不许写它 —— observer 监听它、内部又写它,
       会自己触发自己,死循环把运行时打挂,而且一条错都不报。
       内部要用的那份叫 count(见 data),两者在 observer 里同步一次。 */
    diceCount: { type: Number, value: 1 },
    /* ★ 内嵌(契约 §1.5,diceRoll 例外):故事流里直接掷的那一套构图。
       由 cy-playkit 分发器转发;整屏那套(摇一摇/点屏幕)在 inline=false 时逐字不变。 */
    inline: { type: Boolean, value: false },
  },
  data: {
    d20Rolling: false,
    d20Error: false,
    dice: [],
    rolling: false,
    sum: 0,
    count: 1,               // 内部用的颗数。**不要**叫 diceCount,那是属性名
    // 摇之前是「怎么玩」,摇之后是「摇到了什么、要做什么」。同一行字,两种职责
    sub: '摇一摇，把骰子扔出去',
    hint: '摇一摇手机',
  },
  observers: {
    'show, mode, rollMode': function () { this._mountD20(); },
    result: function (result) {
      if (!this._d20 || !result) return;
      clearTimeout(this._d20Timeout);
      try { this._d20.settle(result.values, result.kept, !this.data.d20Rolling || this.data.reducedMotion); }
      catch (error) { this.onD20CanvasError(); }
    },
    'show, diceCount': function (show, diceCount) {
      if (!show) { this._offShake(); return; }
      if (this.data.mode === 'd20') { this._offShake(); return; }
      /* 内嵌那套在故事流里,不靠摇手机:边走边看故事时误摇一下就掷,那不是玩法是事故。
         要掷就按那个按钮。整屏那套照旧摇一摇 + 点屏幕。 */
      if (this.data.inline) this._offShake(); else this._onShake();
      // 换颗数要把骰子重新摆一遍,但不清掉已经摇出来的结果
      if (!this.data.sum) this._place(diceCount, []);   // 属性 → 内部 count,单向
    },
    values: function (values) {
      if (this.data.mode === 'd20') return;
      const list = (values || []).filter((n) => n >= 1 && n <= 6);
      if (!list.length) {
        this.setData({ sum: 0, rolling: false, sub: '摇一摇，把骰子扔出去', hint: '摇一摇手机' });
        this._place(this.data.count, []);
        return;
      }
      this._place(list.length, list);
      const settled = {
        sum: sumOf(list),
        /* 一颗时报「摇到几 → 做哪件事」;两颗只报点数和,用来分胜负,不对应任务 ——
           拿两颗的和去索引六个面会越界,那是另一个玩法。 */
        sub: list.length === 1
          ? (taskFor(list, this.data.faces) || ('摇到 ' + list[0]))
          : (list.join(' + ') + '，两颗只比大小'),
        hint: '再摇一次',
      };
      if (this.data.reducedMotion) { this._settle(settled); return; }
      /* 字段写死成字面量,不 Object.assign:动态 setData 门禁核不出写了哪些顶层字段。
         滚动这一拍先把点数和清零 —— 骰子还在转就报和,等于结果比动作先到。 */
      this.setData({ rolling: true, sum: 0, sub: settled.sub, hint: settled.hint });
      this._stop();
      this._timer = setTimeout(() => this._settle(settled), ROLL_MS);
    },
  },
  lifetimes: {
    /* 摇一摇就扔。与抛硬币共用同一个识别器 —— 各写一份的话阈值迟早不一样,
       而阈值不一样意味着同一个动作在两屏里一个认一个不认。 */
    attached() { this._shake = createShakeDetector(() => this.onRoll()); },
    ready() { this._d20Mounted = true; this._mountD20(); },
    detached() { this._d20Mounted = false; this._destroyD20(); this._stop(); this._offShake(); },
  },
  pageLifetimes: {
    hide() { this._offShake(); this._destroyD20(); },
    show() { this._mountD20(); },
  },
  methods: {
    _destroyD20() {
      this._d20Key = null;
      this._d20Version = (this._d20Version || 0) + 1;
      if (this._d20) this._d20.dispose();
      this._d20 = null;
      clearTimeout(this._d20Timeout);
    },
    _mountD20() {
      if (!this._d20Mounted) return;
      const key = [this.data.show, this.data.mode, this.data.rollMode].join(':');
      // Parent result updates can notify unchanged properties; preserve the active animation.
      if (this._d20Key === key) return;
      this._destroyD20();
      this._d20Key = key;
      if (!this.data.show || this.data.mode !== 'd20') return;
      const version = this._d20Version;
      this.setData({ d20Rolling: false, d20Error: false });
      wx.nextTick(() => {
        this.createSelectorQuery().select('#d20Canvas').fields({ node: true, size: true }).exec((res) => {
          if (version !== this._d20Version) return;
          const item = res && res[0];
          if (!item || !item.node || !item.width || !item.height) { this.onD20CanvasError(); return; }
          try {
            const count = this.data.rollMode === 'normal' ? 1 : 2;
            const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
            this._d20 = createD20Renderer(item.node, item.width, item.height, count, info.pixelRatio, () => {
              clearTimeout(this._d20Timeout);
              this.setData({ d20Rolling: false });
            }, () => this.onD20CanvasError());
            const result = this.data.result;
            if (result) this._d20.settle(result.values, result.kept, true);
          } catch (error) { this.onD20CanvasError(); }
        });
      });
    },
    onD20CanvasError() {
      this._destroyD20();
      this.setData({ d20Error: true, d20Rolling: false });
    },
    onRetryD20() { this._mountD20(); },
    _pipsOf: pipsOf,            // 纯算法出口,供单测
    _taskFor: taskFor,
    _sumOf: sumOf,
    _stop() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } },
    _onShake() {
      if (this._shakeOn) return;
      this._shakeOn = true;
      this._tick = (res) => this._shake(res);
      wx.startAccelerometer({ interval: 'normal', fail() {} });
      wx.onAccelerometerChange(this._tick);
    },
    _offShake() {
      if (!this._shakeOn) return;
      this._shakeOn = false;
      wx.stopAccelerometer({ fail() {} });
      wx.offAccelerometerChange && wx.offAccelerometerChange(this._tick);
    },

    _settle(settled) {
      this.setData({ rolling: false, sum: settled.sum, sub: settled.sub, hint: settled.hint });
      // 「做成了」= 骰子停下那一刻;摇的那一下只是请求发出去了
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('settled', { sum: settled.sum });
    },

    /** 摆位照原型 place():场地正中,两颗时左右各偏 62px,**同一条水平线上**。
     *
     *  ⚠️ 居中交给 CSS 的 calc(50% …),不在 JS 里量场地 —— 量要走
     *  createSelectorQuery,那是异步的;而这个方法同一帧会被两个 observer
     *  各调一次(show/diceCount 一次、values 一次),异步回调的先后一反,
     *  后写的那次会拿着旧的 count 把「两颗」覆盖回「一颗」。踩过一次。
     */
    _place(count, values) {
      const n = count === 2 ? 2 : 1;
      const dice = [];
      for (let i = 0; i < n; i++) {
        dice.push({
          i,
          /* 还没摇过时六个面朝哪由原型的初始姿态决定:ax=ay=az=0 就是 1 点朝人。
             给个空白骰子的话,这一屏开局看着像还没加载完。 */
          pips: pipsOf(values[i] || 1),
          delay: i * 0.06,
          dx: n === 2 ? (i ? 62 : -62) : 0,        // 原型 place():两颗各偏 62px
        });
      }
      this.setData({ dice, count: n });
    },

    onCount(e) {
      const n = Number(e.currentTarget.dataset.n) === 2 ? 2 : 1;
      if (n === this.data.count) return;
      this._place(n, []);
      this.setData({ sum: 0, sub: '摇一摇，把骰子扔出去', hint: '摇一摇手机' });
      this.triggerEvent('count', { diceCount: n });
    },

    onRoll() {
      if (this.data.rolling) return;
      if (this.data.mode === 'd20') {
        if (this.data.result || this.data.d20Rolling) return;
        if (this._d20) {
          this.setData({ d20Rolling: true });
          // Also covers reduced-motion mode, which deliberately schedules no animation frames.
          this._d20Timeout = setTimeout(() => this.setData({ d20Rolling: false }), 8000);
          try { this._d20.roll(this.data.reducedMotion); }
          catch (error) { this.onD20CanvasError(); }
        }
      }
      this.triggerEvent('roll', { diceCount: this.data.count });
    },
    onClose() { this._destroyD20(); this._stop(); this.triggerEvent('close'); },
  },
});
