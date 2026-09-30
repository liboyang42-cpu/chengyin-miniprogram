// cy-play-verdict · 全局判定屏(原型真源:模板编辑页 v2 · playkit 的 liquidWin / failScreen)
//
// 为什么是组件而不是各玩法自己画:十九个玩法各发明一套判定屏,玩家会以为自己在玩不同的产品。
// 这里只有两张 —— 猜中了(绿 + 对勾),没猜中(红 + 两个字)。
//
// 「两个字」是产品拍板:配了限时且走到点是「时间到」,其余(次数用完之类)是「失败」。
// 不写「这一关限时 N 秒,没在里面做完就算没过」—— 那是写给刚失败的人看的规则说明,
// 那个时候没人读。

/** 失败措辞只有两种。timedOut 是「有没有限时且走到点」,不是「这局有没有限时」。 */
function failWord(timedOut) {
  return timedOut ? '时间到' : '失败';
}

/** 气泡的位置/大小/相位一次算好放进 data:每帧在 wxml 里算会把 setData 打满。 */
function makeBubbles(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      i,
      left: 8 + i * 10,
      size: 8 + (i % 4) * 6,
      delay: Number((0.12 + i * 0.07).toFixed(2)),
    });
  }
  return out;
}

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    kind: { type: String, value: 'win' },      // win | fail
    // fail 专用:调用方传 timedOut,措辞由 failWord 统一决定,不让各玩法自己拼字
    timedOut: { type: Boolean, value: false },
    // win 专用:一句话。空着就只有对勾 —— 没内容就不要显示提示语
    text: { type: String, value: '' },
  },
  data: {
    rising: false,
    word: '失败',
    bubbles: makeBubbles(9),
  },
  observers: {
    'show, kind, timedOut': function (show, kind, timedOut) {
      this.setData({ word: failWord(timedOut) });
      if (!show) { this._clear(); this.setData({ rising: false }); return; }
      // 先挂上再涨:同一帧里设 true 的话过渡没有起点,会直接就位、看不见涌上来那一下
      this._clear();
      this._raf = setTimeout(() => this.setData({ rising: true }), 20);
    },
  },
  lifetimes: { detached() { this._clear(); } },
  methods: {
    _failWord: failWord,        // 纯算法出口,供单测
    _makeBubbles: makeBubbles,
    _clear() { if (this._raf) { clearTimeout(this._raf); this._raf = null; } },
  },
});
