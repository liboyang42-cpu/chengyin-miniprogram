// cy-playkit-hidden · 找东西(原型真源:模板编辑页 v2 · playkit hidden)
//
// ★ 热区的 x / y / r **一个都不下发**。这是本玩法唯一的防线 —— 坐标到了客户端,
// 抓包就知道东西藏在哪,题当场作废。所以命中判定必须在服务端:
// 组件只报「玩家点在图上的百分比坐标」。
//
// 下发 label 是有意的:玩家要知道自己在找什么(底部那排待找清单)。
//
// 商家配置时不填坐标、不填判定半径 —— 点哪儿就是哪儿,半径由系统定。
// 让商家调半径等于让他调难度,而他没有手感依据。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 触点 → 相对底图的百分比坐标。用百分比不用像素:不同机型图的显示尺寸不一样,
 *  报像素过去服务端还得知道客户端画多大,那是把判定条件交给客户端。 */
function toPercent(touchX, touchY, rect) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const x = ((touchX - rect.left) / rect.width) * 100;
  const y = ((touchY - rect.top) / rect.height) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    imageUrl: { type: String, value: '' },
    targets: { type: Array, value: [] },      // 只有 id + label,没有坐标
    total: { type: Number, value: 0 },
    limitSeconds: { type: Number, value: 0 },
    maxTries: { type: Number, value: 0 },
  },
  data: { hits: [], miss: null, foundCount: 0, quad: '' },
  observers: {
    'show, targets': function (show) {
      if (!show) return;
      this.setData({ hits: [], miss: null, foundCount: 0, quad: '' });
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
  },
  lifetimes: { detached() { this._clearMiss(); } },
  methods: {
    _toPercent: toPercent,      // 纯算法出口,供单测
    _clearMiss() { if (this._missTimer) { clearTimeout(this._missTimer); this._missTimer = null; } },

    onTapScene(e) {
      const q = wx.createSelectorQuery().in(this);
      q.select('.hd__scene').boundingClientRect((rect) => {
        const t = (e.touches && e.touches[0]) || e.detail || {};
        const p = toPercent(t.clientX != null ? t.clientX : t.x,
                            t.clientY != null ? t.clientY : t.y, rect);
        /* 量不到图的位置(组件还没布局完)时,这一下点击是废的。
           以前这里直接 return:玩家连点几下没有任何反应,会以为图是死的。
           现在抖一下 —— 「我收到了,但这一下不算」,而不是什么都不发生。 */
        if (!p) {
          const stage = this.selectComponent('#cy-play-stage');
          if (stage && stage.nudge) stage.nudge();
          return;
        }
        // 命中与否由服务端判 —— 坐标就是这个玩法的答案
        this.triggerEvent('submit', p);
      }).exec();
    },

    /** 服务端判完回调:命中就把点留在图上,没中放一圈涟漪。 */
    settle(hit, detail) {
      const d = detail || {};
      const stage = this.selectComponent('#cy-play-stage');
      if (hit) {
        motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
        const hits = this.data.hits.concat([{ id: d.id || String(Date.now()), x: d.x, y: d.y }]);
        const targets = this.data.targets.map((t) => (t.id === d.id ? Object.assign({}, t, { found: true }) : t));
        const foundCount = hits.length;
        this.setData({ hits, targets, foundCount, miss: null });
        if (foundCount >= this.data.total && stage) stage.win('全找到了');
        return;
      }
      this.setData({ miss: { x: d.x, y: d.y } });
      this._clearMiss();
      this._missTimer = setTimeout(() => this.setData({ miss: null }), 340);
      const exhausted = stage ? stage.miss() : false;
      if (stage && stage.nudge) stage.nudge();   // 答错整块台面抖一下(原型 .phone.shake)
      if (exhausted && stage) stage.fail(false);
    },

    /** 提示:服务端告诉哪一象限还有没找到的,这里只泛一片琥珀。
     *  ★ 象限也要由服务端给 —— 客户端没有坐标,自己算不出来,
     *  而这正是这个玩法唯一的防线。 */
    showQuadrant(q) {
      const map = {
        tl: 'left:0;top:0;right:50%;bottom:50%;',
        tr: 'left:50%;top:0;right:0;bottom:50%;',
        bl: 'left:0;top:50%;right:50%;bottom:0;',
        br: 'left:50%;top:50%;right:0;bottom:0;',
      };
      this.setData({ quad: map[q] || '' });
    },
    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this._clearMiss(); this.triggerEvent('close'); },
  },
});
