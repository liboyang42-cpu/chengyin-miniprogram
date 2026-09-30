/* custom-tab-bar · 极简 shim(批3 Role Shell)
 *
 * 唯一职责:让 app.json 的 tabBar.custom:true 合法,从而隐藏微信原生 tab 条,
 * 消灭"原生条 + 页内 tabBar"双栏(第一阶段 P0-01)。
 *
 * 本组件不渲染导航 UI、不承载任何逻辑——真实一级导航底栏是页内 components/tabBar,
 * 它已用 mode/dark/raised/activeKey 正确处理双端与"同页双角色"(template/member/square)
 * 的分状态渲染,那是单例 custom-tab-bar 无法胜任的,故保留页内实现。
 * 详见 docs/superpowers/specs/2026-07-12-shell-custom-tabbar-design.md §3。 */
Component({});
