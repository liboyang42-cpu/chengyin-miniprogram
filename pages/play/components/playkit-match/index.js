// cy-playkit-match · 连线题(施工文档 R3 · 证据板)
//
// ★ 不画线,左右两列卡片点两下配对:先点左边一张(白描边表示选中)再点右边一张,
//   两张卡各出现同一个圆形序号角标。再点已配对的卡就取消 —— 手指比线准。
//
// ★ 答案(pairs)不在客户端:服务端只下发左右两组条目(右侧已打乱),判定在服务端。
//   组件交上去的是玩家自己连的那些 [左 id, 右 id];连满之前按钮不可用,
//   差一条服务端也会整条打回 —— 与其让玩家点一下挨一句报错,不如按钮先不亮。
//
// 判定回来只有整体对错(服务端没开逐条字段):判错不逐条标红,只出整体提示条,改了就能再交;
// 整体通过才全部变绿(那意味着每条连线都在答案里)。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 一列条目 → 本地行。badge = 它在 pairs 里的序号 +1(0 = 还没连),渲染时按 verdict 上色。 */
function paintSide(list, side, pairs) {
  const at = side === 'l' ? 0 : 1;
  return (list || []).map((it, i) => {
    const id = it.id || (side + i);
    const index = (pairs || []).findIndex((p) => p[at] === id);
    return { id: id, label: it.label || '', badge: index < 0 ? 0 : index + 1 };
  });
}

/** 连满才让提交:左右一一对应,少一条服务端不收,按钮亮着也没意义。 */
function canSubmit(pairedCount, total) {
  return total > 0 && pairedCount >= total;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    prompt: { type: String, value: '' },
    left: { type: Array, value: [] },
    right: { type: Array, value: [] },
    attempts: { type: Number, value: 0 },
    passed: { type: Boolean, value: false },
    lastCorrect: { type: Boolean, value: false },
  },
  data: {
    // ⚠️ 派生行换键名(leftRows/rightRows),别写回被监听的 left/right —— 那会自触发死循环
    leftRows: [],
    rightRows: [],
    selected: '',
    pairedCount: 0,
    total: 0,
    verdict: '',          // '' 未判 / 'ok' 通过 / 'no' 判错
  },
  observers: {
    'show, left, right': function (show, left, right) {
      if (!show) return;
      this._paintPairs([], '', left, right);
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
    'attempts, passed, lastCorrect': function (attempts, passed) {
      if (!(attempts > 0)) return;
      const verdict = passed ? 'ok' : 'no';
      if (verdict !== this.data.verdict) this.setData({ verdict });
    },
  },
  methods: {
    _paintSide: paintSide,      // 纯算法出口,供单测
    _canSubmit: canSubmit,

    /** 重画两列与角标。任何改动都要把上一次的判定撤掉 —— 红角标跟着新连线走是误导。 */
    _paintPairs(pairs, selected, left, right) {
      const l = left || this.data.left || [];
      const r = right || this.data.right || [];
      // ⚠️ pairs 只喂逻辑(拆线 / 提交)不渲染:进 data 就是死数据字段,放实例字段
      this._pairs = pairs;
      this.setData({
        selected: selected,
        leftRows: paintSide(l, 'l', pairs),
        rightRows: paintSide(r, 'r', pairs),
        pairedCount: pairs.length,
        total: l.length,
        verdict: '',
      });
    },

    onTapLeft(e) {
      const id = e.currentTarget.dataset.id;
      const row = this.data.leftRows.filter((r) => r.id === id)[0] || {};
      // 再点已配对的卡 = 取消(设计规格),不是「换个连法」。取消掉自己那张时把选中态一起收掉
      if (row.badge) {
        this._unpair((p) => p[0] !== id, this.data.selected === id ? '' : this.data.selected);
        return;
      }
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this.setData({ selected: this.data.selected === id ? '' : id });
    },
    onTapRight(e) {
      const id = e.currentTarget.dataset.id;
      const row = this.data.rightRows.filter((r) => r.id === id)[0] || {};
      if (row.badge) { this._unpair((p) => p[1] !== id, this.data.selected); return; }
      const leftId = this.data.selected;
      if (!leftId) return;                       // 先点左边那张,右边单点没有意义
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      // 左边若已连过别人、或右边被占着,先把旧线拆掉再连 —— 一一对应
      const next = this._pairs
        .filter((p) => p[0] !== leftId && p[1] !== id)
        .concat([[leftId, id]]);
      this._paintPairs(next, '');
    },
    _unpair(keep, selected) {
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this._paintPairs(this._pairs.filter(keep), selected);
    },

    onSubmit() {
      if (!canSubmit(this.data.pairedCount, this.data.total)) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      // ★ 只报玩家连的那些,不报对错 —— 对错在服务端
      this.triggerEvent('submit', { pairs: (this._pairs || []).map((p) => [p[0], p[1]]) });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
