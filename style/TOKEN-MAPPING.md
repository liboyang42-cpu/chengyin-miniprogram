# 排版与间距 token 映射

页面迁移必须按语义选择，不按数字全局替换。相同的 `32rpx` 可能是卡片标题、按钮或 glyph；展示数字和 Figma 特批也不能压进正文档。

## 字号

| 语义 | canonical token | 典型用途 |
|---|---|---|
| 展示数字 | `--cy-type-data-2xl` / `--cy-type-data-xl` | 首页 hero、金额、里程 |
| 展示标题 | `--cy-type-display` | 完成时刻、低频 hero |
| 页面标题 | `--cy-type-page-title` | L1 页面标题 |
| 分区标题 | `--cy-type-section-title` | L2 模块标题、导航标题 |
| Sheet 标题 | `--cy-type-sheet-title` | 浮层主标题 |
| 卡片标题 | `--cy-type-card-title` | 卡片与详情标题 |
| 按钮 | `--cy-type-button` | 主次按钮；小按钮按现有 label 档 |
| 正文 | `--cy-type-body` | 段落与主要说明 |
| 标签 | `--cy-type-label` | Tab、字段标签、Chip |
| 辅助说明 | `--cy-type-caption` | 时间、元数据、次级说明 |
| 微型标签 | `--cy-type-micro` | Badge 最小档，禁止更小 |
| glyph | 不按字号映射 | 图标按组件的 `size` API 与视觉盒子选档 |
| Figma 特批 | 保留并写 `ds-ok` | 46rpx、28px、cover-view/canvas 等需逐页截图裁决 |

## 间距

| 语义 | canonical token | 值 |
|---|---|---:|
| 紧凑内联 | `--cy-space-1` / `--cy-space-1-5` | 8 / 12rpx |
| 行内/标签 gap | `--cy-space-2` / `--cy-space-2-5` | 16 / 20rpx |
| 常规分组 gap | `--cy-space-3` / `--cy-space-3-5` | 24 / 28rpx |
| card padding / 页面横向留白 | `--cy-space-4` / `--cy-page-x` | 32rpx |
| 大分区留白 | `--cy-space-5`～`--cy-space-8` | 48 / 64 / 80 / 96rpx |

负 margin、`auto`、safe-area/calc、hero 大留白及 card padding 的 120/162rpx 属于布局结构，不做机械收敛。`gap` 可先收 canonical 同值项，但仍要保留 selector 语义和截图负控。

## 2026-08-28 未定义名兼容映射

`--cy-font-micro` 映射 `--cy-type-micro`；`--cy-text-tertiary` / `--cy-text-muted` 映射三级文字；`--cy-text-sub` 映射二级文字；`--cy-border` 映射弱边界，`--cy-color-border-default` 映射强边界；`--cy-surface` 映射标准表面；`--cy-opacity-disabled` 固定为 `0.4`。
