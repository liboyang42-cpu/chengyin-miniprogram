// cy-play-countin · 限时挑战开跑前的 3-2-1(原型真源:模板编辑页 v2 · playkit countIn)
//
// 为什么必须有:计时从看到题的那一刻起跳的话,人还在读题就已经在扣秒 ——
// 那不是「限时」,是偷时间。数完再跑,大家的起点才一样。
//
// ⚠️ 用 setInterval 不用 requestAnimationFrame:页面不渲染时 rAF 会整个停掉,
// 倒数会卡在 3 —— 这一条在原型里踩过,小程序 onHide 同理。
//
// 变色就点没有限时开关,所以它天然不数 —— 那个玩法测的就是突然性。

const TICK_MS = 620;
const FROM = 3;
/* 数完之后整层淡掉这么久才真开跑 —— 逐值照原型 countIn:
   .cin.go 的 transition 是 .26s,cb() 也在 260ms 之后才调。
   少了这一下,3-2-1 会「啪」地消失,开跑那一瞬间很硬。 */
const GO_MS = 260;

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
  },
  data: {
    n: FROM,
    // 轮着挂的两个类名:同一个元素要重放动画,只能换个类名让它重新起跑
    popClass: '',
    going: false,
  },
  observers: {
    show: function (show) {
      this._stop();
      if (!show) return;
      // 减动效:不数了,直接开始 —— 数字跳动本身就是动效
      if (this.data.reducedMotion) { this.triggerEvent('done'); return; }
      this.setData({ n: FROM, going: false });
      this._bump();
      this._timer = setInterval(() => {
        const next = this.data.n - 1;
        if (next > 0) { this.setData({ n: next }); this._bump(); return; }
        this._stop();
        // 先淡掉,淡完再 done —— 与原型同序同值
        this.setData({ going: true });
        this._go = setTimeout(() => { this._go = null; this.triggerEvent('done'); }, GO_MS);
      }, TICK_MS);
    },
  },
  lifetimes: { detached() { this._stop(); } },
  pageLifetimes: {
    // 切后台就停,回来由页面重新起 —— 不停的话回来会一口气把积压的 tick 走完
    hide() { this._stop(); },
  },
  methods: {
    _from: () => FROM,          // 纯出口,供单测
    _stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this._go) { clearTimeout(this._go); this._go = null; }
    },
    _bump() {
      this.setData({ popClass: this.data.popClass === 'ci__n--a' ? 'ci__n--b' : 'ci__n--a' });
    },
  },
});
