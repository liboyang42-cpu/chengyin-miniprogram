/*
 * 2026-08-09 用户裁决:白卡里不再嵌一层灰。
 *
 * 灰保留给「动不了的东西」和「控件自己的底」—— 输入框/搜索框、选项与禁用态控件、
 * 封面 logo 占位、状态 chip、锁定态(如 .target--locked)。白卡内的只读键值行、
 * 入口行、说明块一律回到白卡本色,行与行只靠间距分,既不加灰底也不加横线/描边。
 *
 * 单一真源:三份契约(std-g3 / g4 / merchant-detail-five-fixes)共用这一条正则。
 * 各自抄一份的后果是漏 token —— 首版就漏了 --cy-bg-subtle,而那正是 coop-terms-summary
 * 用过的灰,回潮时没人抓得到。新增灰 token 必须同步加进这里。
 */
const NESTED_FILL = /background:\s*var\(--cy-(?:bg-card-2|comp-cell-fill-bg|color-bg-surface-subtle|bg-subtle)\)/;

module.exports = { NESTED_FILL };
