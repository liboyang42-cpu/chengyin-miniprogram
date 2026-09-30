# 标题间距契约负控回执

## RED：临时给 mylike 的 nav spacer 注入 `margin-top`

临时变异：

```css
.title-nav-spacer { flex: none; margin-top: var(--cy-space-4); }
```

命令：`node --test tests/unit/nav-page-title-spacing-contract.test.js`

```text
✖ 全仓 65 个 cy-page-title 页面：返回导航到大标题统一为 mylike 基线
✔ 全仓 cy-nav-bar 无组件标题页均已归类，自绘大标题同样紧贴 canonical spacer
✔ negative control：标题、spacer 或自绘页头注入 top spacing 必须判红
tests 3
pass 2
fail 1

AssertionError [ERR_ASSERTION]: pages/mylike/mylike.wxml: .title-nav-spacer 不得在 nav 与大标题之间追加 margin-top/padding-top
actual: [ 'margin-top:var(--cy-space-4)' ]
expected: []
```

进程退出码：`1`。

## GREEN：撤销临时注入后复跑

命令：`node --test tests/unit/nav-page-title-spacing-contract.test.js`

```text
✔ 全仓 65 个 cy-page-title 页面：返回导航到大标题统一为 mylike 基线
✔ 全仓 cy-nav-bar 无组件标题页均已归类，自绘大标题同样紧贴 canonical spacer
✔ negative control：标题、spacer 或自绘页头注入 top spacing 必须判红
tests 3
pass 3
fail 0
```

进程退出码：`0`；临时变异已撤销。
