// cy-playkit-bingo · 九宫格(原型真源:模板编辑页 v2 · playkit bingo)
//
// 主题级的格子:走到一处点亮一格,连成线换奖。它不是一次玩完的玩法 ——
// 所以这一屏只**呈现**进度,点亮发生在别的节点,由服务端记账。
//
// 格子位序与后端 BingoCard 一致:
//   0 1 2
//   3 4 5
//   6 7 8
// ⚠️ 商家填的顺序是 S 形(第一行左→右,第二行右→左,第三行左→右),
// 那是**填写顺序**,不是位序。两者别搞混。
//
// ⚠️ 每格自己的奖与三档奖挤在同一个 reward_mask 里,断言要用位不用全等 ——
// 写全等就等于断言「这个 mask 里只能有三档奖」,一加每格奖就红,而红的是断言不是实现。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 棋盘深浅:(行 + 列) 取模。
 *  ⚠️ 写成 (行 + 序号) % 2 会把中间一整列涂黑 —— 原型里踩过。 */
function shadeOf(idx) {
  return ((Math.floor(idx / 3) + (idx % 3)) % 2) ? 'dark' : 'pale';
}

/** 八条线:三横三竖两斜。 */
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** 连成几条。交叉的线各算各的 —— 共用格子不代表只算一条。 */
function lineCount(filled) {
  return LINES.filter((l) => l.every((i) => filled[i])).length;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    /* 九个格子。每格 { t, how } —— t 是名字,how 是「怎么点亮」。
       how 不是装饰:扫码格和玩法格要做的事不是一回事,不写清楚玩家会站在店门口发呆。 */
    cellSpecs: { type: Array, value: [] },
    // 兼容只给名字的老写法
    labels: { type: Array, value: [] },
    // 已点亮的位序
    filledPositions: { type: Array, value: [] },
    lineReward: { type: String, value: '' },
    fullReward: { type: String, value: '' },
    limitSeconds: { type: Number, value: 0 },
  },
  data: { cells: [], filledCount: 0, ribbon: '', panel: null },
  observers: {
    'show, labels, cellSpecs, filledPositions': function (show, labels) {
      const filledPositions = this.data.filledPositions;
      if (!show) return;
      const filled = Array.from({ length: 9 }, (_, i) => (filledPositions || []).indexOf(i) >= 0);
      const lines = lineCount(filled);
      // 连成线的那三格换成粉色:线是这个玩法的兑现点,得看得出是哪三格连上的
      const inLine = Array.from({ length: 9 }, () => false);
      LINES.forEach((l) => { if (l.every((i) => filled[i])) l.forEach((i) => { inLine[i] = true; }); });
      const full = filled.every(Boolean);
      this.setData({
        cells: Array.from({ length: 9 }, (_, i) => {
          const spec = (this.data.cellSpecs || [])[i] || {};
          const how = spec.how || '走到即亮';
          return {
            i, no: i + 1,
            t: spec.t || (labels || [])[i] || '',
            how: how,
            // 扫码格 vs 玩法格:按「怎么点亮」里有没有「扫码」分,与原型同一条判据
            kind: /扫码/.test(how) ? 'scan' : 'play',
            shade: shadeOf(i), filled: filled[i], inLine: inLine[i],
          };
        }),
        filledCount: filled.filter(Boolean).length,
        /* 领到哪一档就报哪一档,没领到整条不出 ——
           默认摆一条灰的等于提前把奖亮出来,而这玩法的张力就在「还没连上」那一段。 */
        ribbon: full ? (this.data.fullReward ? '九格全亮 · ' + this.data.fullReward : '')
              : (lines > 0 && this.data.lineReward ? '连成一条线 · ' + this.data.lineReward : ''),
      });
      /* 「做成了」不是「又点亮一格」,是**又连成一条线**(或凑满九格)——
         那才是这个玩法真正兑现的时刻。同 playkit-steps:震在那条**边**上,
         首屏就已经连成的不该凭空震,已连成后再进来也不该重复震。 */
      const crossed = this._lastLines !== undefined && lines > this._lastLines;
      const justFull = this._lastFull !== undefined && full && !this._lastFull;
      if (crossed || justFull) {
        motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      }
      this._lastLines = lines;
      this._lastFull = full;
    },
  },
  methods: {
    _shadeOf: shadeOf,          // 纯算法出口,供单测
    _lineCount: lineCount,
    _lines: () => LINES.map((l) => l.slice()),
    /* 点一格看它要怎么亮。已亮的不再弹 —— 那一格的事已经做完了。 */
    onCell(e) {
      const i = Number(e.currentTarget.dataset.i);
      const c = this.data.cells[i];
      if (!c || c.filled) return;
      this.setData({
        panel: {
          t: c.t,
          body: c.kind === 'scan'
            ? 'GPS 可以伪造,进店这件事只认扫码。到店后扫这个点位的静态码。'
            : '这一格装的是「' + c.how + '」。玩完它才会亮。',
        },
      });
      this.triggerEvent('cell', { index: i });
    },
    onClosePanel() { this.setData({ panel: null }); },
    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this.triggerEvent('close'); },
  },
});
