# `cy-error` 错误态 API

`cy-error` 负责可恢复失败的可见终态。页面必须给动作绑定真实 handler，不能只传按钮文案。

| 属性 / 事件 | 默认值 | 用途 |
|---|---|---|
| `title` / `sub` / `aria` | 组件默认错误文案 | 可见原因与读屏名称 |
| `retry` + `bind:retry` | `重试` | 主恢复动作；不用时显式传 `retry=""` |
| `secondary` + `bind:secondary` | 空 | 安全第二出口，例如返回上一页或管理台 |
| `fill` / `size="lg"` | `false` / 空 | 整页或大区块阻断态的布局档 |

整页阻断态在已有安全去处时传 `secondary`，让用户在重试之外还能离开；不存在真实去处时不制造假入口。局部错误态默认保留单出口，不传 `secondary`。`cy-state-shell` 的错误分支会把 `secondary` 转交给本组件，空态分支仍由状态壳渲染第二出口。
