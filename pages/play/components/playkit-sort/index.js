// cy-playkit-sort · 排序题(施工文档 R3 · 证据板)
//
// ★ 答案(answerOrder)不在客户端:服务端只下发**打乱顺序**的 items,判定也在服务端。
//   组件只做两件事:让玩家把顺序排出来、把 order 交上去。前端判对错的话,
//   抓个包就能直接看到答案,这一题当场作废。
//
// 拖拽 + 上移/下移两条路都留着:拖拽是手感,上移/下移是读屏器与手抖的人唯一能走的路 ——
// 只给拖拽等于把一部分玩家挡在门外(设计规格明写:不能只靠拖拽)。
//
// 判定回来只有**整体对错**(服务端有意不给逐位置对错 —— 逐位提示配合可重排
// 等于把答案一格格试出来)。所以判错**不逐行标红**,只出一条整体提示条并允许继续重排;
// 整体通过才逐行变绿(那意味着每一位都对)。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** items → 本地行。就三个字段 —— 对错由 wxml 按 verdict 上色,别把答案状态混进来。 */
function paint(items) {
  return (items || []).map((it, i) => ({
    id: it.id || ('i' + i),
    label: it.label || '',
    img: it.img || '',
  }));
}

/** 把第 from 行搬到第 to 格。越界/原地返回原数组引用,调用方据此不再 setData。 */
function moveRow(list, from, to) {
  const rows = list || [];
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice();
  const [one] = next.splice(from, 1);
  next.splice(to, 0, one);
  return next;
}

/** 有东西可排才能提交:空列表 = 配置还没来,按钮亮着也没东西可交。 */
function canSubmit(rows) {
  return (rows || []).length > 0;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    prompt: { type: String, value: '' },
    items: { type: Array, value: [] },
    attempts: { type: Number, value: 0 },
    passed: { type: Boolean, value: false },
    finished: { type: Boolean, value: false },
    lastCorrect: { type: Boolean, value: false },
  },
  data: {
    // ⚠️ 派生行换键名(rows),别写回被监听的 items —— 那会自触发死循环(见 playkit-observer-selfloop)
    rows: [],
    dragging: -1,
    verdict: '',        // '' 未判 / 'ok' 通过 / 'no' 判错
  },
  observers: {
    'show, items': function (show, items) {
      if (!show) return;
      this._dragTo = -1;
      this.setData({ rows: paint(items), dragging: -1, verdict: '' });
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
    // 回执来了才画对错。attempts 为 0 说明这一次是刚打开的旧视图,不是刚判完
    'attempts, passed, lastCorrect': function (attempts, passed) {
      if (!(attempts > 0)) return;
      const verdict = passed ? 'ok' : 'no';
      if (verdict !== this.data.verdict) this.setData({ verdict });
    },
  },
  methods: {
    _paint: paint,          // 纯算法出口,供单测
    _moveRow: moveRow,
    _canSubmit: canSubmit,

    /** 拖拽:按下时量一次行高,移动时按「走了几行」算落点,松手才真正搬。
     *  不用 setData 逐帧重排 —— 那是每帧一次列表重建,八行就开始掉帧。 */
    onDragStart(e) {
      if (this.data.verdict === 'ok') return;   // 过了就别再动;判错还要重排再交
      const i = Number(e.currentTarget.dataset.i);
      this._dragFrom = i;
      this._dragY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0;
      this._dragTo = i;
      wx.createSelectorQuery().in(this).select('.so__list').boundingClientRect((rect) => {
        const n = this.data.rows.length;
        this._rowH = (rect && rect.height > 0 && n > 0) ? rect.height / n : 0;
      }).exec();
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this.setData({ dragging: i });
    },
    onDragMove(e) {
      if (this._dragFrom == null || !(this._rowH > 0)) return;
      const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : this._dragY;
      const steps = Math.round((y - this._dragY) / this._rowH);
      // 落点是纯计算(没渲染),放实例字段 —— 进 data 就是死数据字段
      this._dragTo = Math.max(0, Math.min(this.data.rows.length - 1, this._dragFrom + steps));
    },
    onDragEnd() {
      const from = this._dragFrom;
      const to = this._dragTo;
      this._dragFrom = null;
      this._rowH = 0;
      this._dragTo = -1;
      if (from != null && from >= 0 && to >= 0 && from !== to) {
        this._applyMove(from, to);
        return;
      }
      this.setData({ dragging: -1 });
    },

    /** 上移 / 下移:读屏器与手抖玩家的那条路 */
    onUp(e) { this._moveBy(Number(e.currentTarget.dataset.i), -1); },
    onDown(e) { this._moveBy(Number(e.currentTarget.dataset.i), 1); },
    _moveBy(i, delta) {
      if (this.data.verdict === 'ok') return;
      const to = i + delta;
      if (i < 0 || i >= this.data.rows.length || to < 0 || to >= this.data.rows.length) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this._applyMove(i, to);
    },
    _applyMove(from, to) {
      const rows = moveRow(this.data.rows, from, to);
      if (rows === this.data.rows) return;
      // 动过了就是新的一版:上一次的判定标记全部撤掉
      this._dragTo = -1;
      this.setData({ rows, dragging: -1, verdict: '' });
    },

    onSubmit() {
      if (!canSubmit(this.data.rows)) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      // ★ 只报顺序,不报对错 —— 对错在服务端
      this.triggerEvent('submit', { order: this.data.rows.map((r) => r.id) });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
