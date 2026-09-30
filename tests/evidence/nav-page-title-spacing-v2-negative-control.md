# 标题间距基准 v2 负控回执

## RED：临时把共享标题上下 margin 改回 0

临时变异：

```css
.pt {
  margin-top: 0;
  margin-bottom: 0;
}
```

命令：

```bash
node --test --test-name-pattern='全仓 66 个 cy-page-title 页面' chengyinhub-xcx/tests/unit/nav-page-title-spacing-contract.test.js
```

输出：

```text
✖ 全仓 66 个 cy-page-title 页面：共享标题统一提供上 space-3 / 下 space-5
tests 1
pass 0
fail 1

AssertionError [ERR_ASSERTION]: 返回行/导航底到大标题必须恰好为 space-3
actual: [ '0' ]
expected: [ 'var(--cy-space-3)' ]
```

进程退出码：`1`。

## GREEN：撤销临时变异后复跑

命令同上，输出：

```text
✔ 全仓 66 个 cy-page-title 页面：共享标题统一提供上 space-3 / 下 space-5
tests 1
pass 1
fail 0
```

进程退出码：`0`；共享组件已恢复为 `margin-top: var(--cy-space-3)`、`margin-bottom: var(--cy-space-5)`。
