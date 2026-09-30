// cy-stat-card · 指标卡网格(商家侧七页规范 §〇.3,对照 Shopify 201)
// 2 列网格,单卡 = 标签小字(上) + 大数字(下) + 可选趋势/占比小件(右上)。
// 纯展示:不取数、不格式化业务语义,调用方把算好的字符串传进来。
//
// 与 cy-metric 的分工(别选错):
//   cy-metric   = 单个仪表盘指标,重型 —— 必带时间范围、趋势对比、空/加载态、跳转动作。
//   cy-stat-card = 一组轻量指标的网格,只负责「标签 + 数字 + 可选小件」和排布。
//   一句话:要展示「一屏四五个并列小指标」用这个;要展示「一个带同比的核心指标」用 cy-metric。
//
// items 每项:
//   { label, value, trend?, tone?, span? }
//     label —— 标签小字(必填)
//     value —— 主数字。字符串或数字都收;0 / '0' 会照常显示成 0(见下方 _cards 的说明)
//     trend —— 右上角小件文案,如 '72% Used' / '+12%';不传则不渲染
//     tone  —— normal(默认) | danger | success,只染主数字,不染整卡
//     span  —— 占几列,默认 1;传 2 即整行通栏(Shopify 201 里 Top locations 那种)
Component({
  properties: {
    items: { type: Array, value: [] },
    columns: { type: Number, value: 2 },
  },
  data: { _cards: [], _colStyle: '' },
  observers: {
    'items, columns'(items, columns) {
      const cols = Math.max(1, Math.round(Number(columns) || 2));
      const list = Array.isArray(items) ? items : [];
      const _cards = list.map((it, i) => {
        const o = it || {};
        // ⚠️ 主数字不能用真值判断:0 和 '0' 都是合法指标值(「今日 0 单」是要显示的事实),
        //    而 0 是 falsy —— 一旦写成 value || '—' 就会把真实的 0 显示成占位符。
        //    这里只把「压根没给」(null/undefined/空串)当作缺数据。
        const raw = o.value;
        const missing = raw === null || raw === undefined
          || (typeof raw === 'string' && raw.trim() === '');
        const text = missing ? '—' : String(raw);
        const span = Math.min(cols, Math.max(1, Math.round(Number(o.span) || 1)));
        return {
          // key 要把「调用方给的 key」和「回落用的下标」分成两个命名空间:
          // 混在一起时,item0 传 key:1、item1 回落成下标 1,会撞成同一个 wx:key,
          // WeChat 复用节点就会张冠李戴(渲染出上一条的内容)。
          key: o.key != null ? 'k' + o.key : 'i' + i,
          label: o.label == null ? '' : String(o.label),
          value: text,
          missing: missing,
          // 字号按值的长度自动降档。实拍发现的:2 列卡宽放不下「¥12,480.50」这类金额,
          // 单靠 ellipsis 会把钱截成「¥12,48…」—— 指标卡要进的正是合作结算页,
          // 把金额截断比字小一号严重得多,所以宁可降档也不截。
          // 阈值按 2 列卡可用宽度实测:750rpx 屏下卡内可用约 279rpx,数字约 0.55em,
          //   64rpx 档 ≈ 放得下 6 字,56rpx 档 ≈ 9 字,36rpx 档 ≈ 14 字。
          // 对应 wxss 的三档必须严格递减(64→56→36),改任一侧都要同步另一侧。
          sizeStep: text.length >= 10 ? 'sm' : (text.length >= 7 ? 'md' : 'lg'),
          trend: o.trend == null || o.trend === '' ? '' : String(o.trend),
          tone: o.tone === 'danger' || o.tone === 'success' ? o.tone : 'normal',
          // span 超过总列数就按总列数封顶,免得算出跨 3 列的格子把网格挤坏
          span: span,
          // 跨列走内联样式,不用 .sc__card--spanN 类:类得为每个 N 各写一条,
          // 而 columns 是调用方自由传的整数 —— 只写了 span2 的话,columns=3 + span=3
          // 会匹配不到任何类、静默塌回 1 列且不报错。内联对任意 N 都成立。
          spanStyle: span > 1 ? 'grid-column:span ' + span + ';' : '',
        };
      });
      this.setData({
        _cards,
        // grid-template-columns 用内联给:列数是运行期变量,wxss 里写不出 repeat(变量)
        _colStyle: 'grid-template-columns:repeat(' + cols + ',minmax(0,1fr));',
      });
    },
  },
});
