# 领队四工具接线验证证据

- 基线：`github/master` = `5c7878526b3111017e18be96248130b9c901505b`
- 范围：`pages/play/index.{js,wxml}`；未改既有布局/WXSS，仅在既有抽屉新增 4 行入口，且未触碰禁动目录。
- 计数口径：JS 统计核心方法的完整标识符；WXML 统计消费该核心方法的 `FromTools` 适配器绑定。

| 核心方法 | JS 前→后 | WXML 绑定前→后 | 最终绑定 |
|---|---:|---:|---|
| `leadVerifyMemberTicket` | 2→2 | 0→1 | `leadVerifyMemberTicketFromTools` |
| `leadShowGroupCode` | 2→2 | 0→1 | `leadShowGroupCodeFromTools` |
| `leadUnlock` | 2→2 | 0→1 | `leadUnlockFromTools` |
| `leadSettle` | 2→2 | 0→1 | `leadSettleFromTools` |

## 三条变异负控

1. 移除 `leadVerifyMemberTicketFromTools` 的 `bindtap`
   - RED：目标契约 `1 failed`，实际只解析出 3 个领队工具绑定，缺少扫码核销入口。
   - 撤销：恢复该 `bindtap`。
   - GREEN：同一目标契约 `1 passed / 0 failed`。
2. 将整团码入口从 `lead.exists && lead.isLeader` 降为仅 `lead.exists`
   - RED：目标契约 `1 failed`，非领队场景求值得到 `true !== false`。
   - 撤销：恢复双条件可见性。
   - GREEN：同一目标契约 `1 passed / 0 failed`。
3. 删除整团结算网络失败反馈、只保留成功反馈
   - RED：目标契约 `1 failed`，可观察反馈数由预期 3 降为 2。
   - 撤销：恢复失败分支反馈。
   - GREEN：同一目标契约 `1 passed / 0 failed`。

上述负控均直接变异真实页面源码后运行，确认判红后立即恢复；最终工作树只保留 GREEN 实现。

## 最终验证

- `node --test tests/unit/play-lead-tools-entry-contract.test.js`：8 passed，0 failed。
- `npm run test:unit`：2094 passed，0 failed，2 skipped。
- `bash ci/xcx-check.sh`：通过；死链按钮门禁核对 209 个 WXML、2276 处纯标识符绑定。

## 遗留

- `pages/play/index.wxml:264` · P2：本任务按调度要求不申请截图槽位，视觉验收由总控执行；源码、行为与静态门已验证。
