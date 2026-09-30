// cy-playkit-classify · 分类题(施工文档 R3 · 证据板)
//
// ★ 答案(answer:itemId → binId)不在客户端:服务端只下发分类箱与卡片,判定在服务端。
//   组件只报「每张卡被放进了哪个箱」;全部分完之前按钮不可用,并写清还差几条。
//
// 判定回来只有整体对错(服务端没开逐张字段):判错不逐张标红(整列红等于假装知道是哪张错了),
// 只出整体提示条并允许继续改;整体通过才逐条变绿 + 行尾「对」。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** items → 本地行。bin 是玩家选的分类箱 id,空串 = 还没分。 */
function paint(items) {
  return (items || []).map((it, i) => ({
    id: it.id || ('i' + i),
    label: it.label || '',
    bin: '',
  }));
}

/** 已经分好的条数。 */
function placedCount(rows) {
  return (rows || []).filter((r) => !!r.bin).length;
}

/** 全部分完才让提交:少一张服务端会整条打回「每张卡片都要放进一个分类」。 */
function canSubmit(placed, total) {
  return total > 0 && placed >= total;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    prompt: { type: String, value: '' },
    bins: { type: Array, value: [] },
    items: { type: Array, value: [] },
    attempts: { type: Number, value: 0 },
    passed: { type: Boolean, value: false },
    lastCorrect: { type: Boolean, value: false },
  },
  data: {
    // ⚠️ 派生行换键名(rows),别写回被监听的 items —— 那会自触发死循环
    rows: [],
    total: 0,
    placed: 0,
    verdict: '',          // '' 未判 / 'ok' 通过 / 'no' 判错
  },
  observers: {
    'show, items, bins': function (show, items) {
      if (!show) return;
      const rows = paint(items);
      this.setData({ rows: rows, total: rows.length, placed: 0, verdict: '' });
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
    _paint: paint,              // 纯算法出口,供单测
    _placedCount: placedCount,
    _canSubmit: canSubmit,

    onPickBin(e) {
      const i = Number(e.currentTarget.dataset.i);
      const bin = e.currentTarget.dataset.b || '';
      if (i < 0 || i >= this.data.rows.length || !bin) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      const rows = this.data.rows.map((r, at) => (at === i ? Object.assign({}, r, { bin: bin }) : r));
      // 改过了就是新的一版:上一次的判定标记撤掉
      this.setData({ rows: rows, placed: placedCount(rows), verdict: '' });
    },

    onSubmit() {
      if (!canSubmit(this.data.placed, this.data.total)) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      // ★ 只报放法,不报对错 —— 对错在服务端
      const placement = {};
      this.data.rows.forEach((r) => { if (r.bin) placement[r.id] = r.bin; });
      this.triggerEvent('submit', { placement: placement });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
