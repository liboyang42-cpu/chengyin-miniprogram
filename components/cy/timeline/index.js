// cy-timeline · 状态时间线(2026-08-27 新建)
//
// 照抄 Revolut Business 的两种形态:
//   vertical   —— 左侧彩色圆点 + 同色竖线,右侧标题(白)/ 时间说明(灰),可折叠成一行摘要。
//   horizontal —— 横向步骤条,圆点串在一条横线上,每步标题 + 时间戳挂在下面。
//
// 两条硬规矩:
//   ① 状态色只落在圆点和连线上。标题/说明/背景一律中性 token,不做彩色底。
//   ② 连线取【下一个节点】的状态色 —— 走到哪一站线就亮到哪。全用自己的状态,
//      最后一段会把「还没走到」画成已完成色,正好把这个组件唯一要回答的问题答错。
const STATUS_TEXT = { done: '已完成', doing: '进行中', rejected: '已拒绝', todo: '未开始' };
const FALLBACK_STATUS = 'todo';

function statusOf(node) {
  const raw = node && typeof node === 'object' ? node.status : '';
  // 未知/缺失一律落灰。继承上一节点会让脏数据看起来像「已完成」。
  return STATUS_TEXT[raw] ? raw : FALLBACK_STATUS;
}

function textOf(value) {
  return value === null || value === undefined ? '' : String(value);
}

Component({
  properties: {
    mode: { type: String, value: 'vertical' },      // vertical | horizontal
    // [{ title, time, desc, note, avatar, action, status: done|doing|rejected|todo }]
    nodes: { type: Array, value: [] },
    summary: { type: String, value: '' },          // 折叠时显示的那一行摘要
    collapsible: { type: Boolean, value: false },
    expanded: { type: Boolean, value: true },
  },
  data: {
    _nodes: [],
    _open: true,
    _mode: 'vertical',
  },
  observers: {
    'nodes, mode': function (nodes, mode) {
      this.setData({
        _mode: mode === 'horizontal' ? 'horizontal' : 'vertical',
        _nodes: this.buildNodes(nodes),
      });
    },
    expanded: function (value) {
      this.setData({ _open: !!value });
    },
  },
  methods: {
    /** 纯函数式归一:契约测试直接调它,不必去模拟 setData。 */
    buildNodes(nodes) {
      const list = Array.isArray(nodes) ? nodes : [];
      return list.map(function (raw, index) {
        const node = raw && typeof raw === 'object' ? raw : { title: raw };
        const status = statusOf(node);
        return {
          key: 'n' + index,
          title: textOf(node.title),
          time: textOf(node.time),
          desc: textOf(node.desc),
          note: textOf(node.note),
          avatar: textOf(node.avatar),
          // 只有「进行中」那一步才给操作入口,和参考图 291 一致。
          action: status === 'doing' ? textOf(node.action) : '',
          status: status,
          statusText: STATUS_TEXT[status],
          lineStatus: statusOf(list[index + 1]),
          isLast: index === list.length - 1,
        };
      });
    },
    onToggle() {
      if (!this.data.collapsible) return;
      const open = !this.data._open;
      this.setData({ _open: open });
      this.triggerEvent('toggle', { expanded: open });
    },
    onAction(e) {
      const index = Number(e.currentTarget.dataset.index);
      const node = this.data._nodes[index];
      if (!node) return;
      this.triggerEvent('action', { index: index, key: node.key, title: node.title });
    },
  },
});
