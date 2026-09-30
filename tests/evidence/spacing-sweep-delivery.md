# 标题间距、A45 与截图 fixture 交付回执

## 标题间距

- 静态清单实际为 65 个 `cy-page-title` 页面；全部逐页校验。另动态盘点 19 个使用 `cy-nav-bar` 但没有 `cy-page-title` 的页面，其中 1 个自绘 L1 标题页纳入同一契约、18 个封面头/搜索框/向导/码卡等非 L1 形态显式归类，清单漂移会直接判红。
- 功能性归一页面：
  - `pages/activity/official-inbox/index`
  - `pages/coop/list/index`
  - `subpackageMember/mycanyuinfo/mycanyuinfo`
  - `pages/publish/simple/index`（自绘 L1 标题）
  - `subpackageRoam/session/index`（自绘返回区）
  - `subpackageP3/pages/creator/index/index`
  - `subpackageP3/pages/stamp-album/index/index`
- `pages/search2/index` 的透明标题包装已是零间距，只同步了与现状相符的注释。基准页 `pages/mylike/mylike` 的标题结构和间距未改。
- `ds-ok` 行没有改动；契约也按要求对整条 `ds-ok` 行保持豁免。
- 新契约：`tests/unit/nav-page-title-spacing-contract.test.js`。真实文件注入 `margin-top` 的 RED、撤销后的 GREEN 输出见 `tests/evidence/nav-page-title-spacing-negative-control.md`。

## A45 去紫

- 紫色源头为 `images/heart_cur.png`；仓内全部 4 个玩家侧消费点已替换为黑白 `cy-icon(name="heart")`：`pages/mylike/mylike` 1 处、`subpackageTalent/search/index` 2 处、`components/cy/scene-route-content/index` 1 处。
- 删除已无消费方的 `images/heart_cur.png` 与 `images/heart.png`；均可从 Git 历史恢复。
- `tests/unit/a45-favorite-monochrome-contract.test.js` 动态扫描生产 WXML，禁止旧资产或紫色收藏图标回潮，并包含负控。

## 截图 fixture 与 D08

- D07、D22、D28、D29、D33 的深链壳现在声明 `fixtureTarget`，数据注入、回读和 DOM 断言都在真实正文子组件内执行；D22/D28/D29/D33 已按新 DOM 类名断言。
- `miniprogram-automator@0.12.1` 的 `disconnect()` 是同步 API；采集脚本已改为同步断开且不调用 `close()`。
- 为解除微信编译器对组件跨页 `@import pages/club/apply/index.wxss` 的阻断，把申请页和 `scene-club-edit` 共用的表单规则抽为 `style/club-apply-form.wxss` 单一真源；页面专属 chrome 仍留在申请页。选定矩阵由真实 DevTools 编译并采集成功，证明新 import 可解析。
- 运行：`WX_AUTO_PORT=9790 SHOT_ONLY=D07,D22,D28,D29,D33 node scripts/_shot_full_matrix.js`；结果 5/5 `OK`、0 `STATE-UNMET`、`failure: null`，manifest 位于 `/tmp/chengyin-spacing-sweep-selected-v6/manifest.json`。
- D08 根因不是拍摄时序或遮罩，而是旧 fixture 注入 `title/statusText/dateRange/place/imgUrl`，页面实际消费 `sourceName/sourceCover/stateText/stateVariant/dateText/typeLabel/sourceAddress`。修正后单独采集 1/1 `OK`、文字清晰、`consoleErrors: []`，manifest 位于 `/tmp/chengyin-spacing-sweep-d08-v6/manifest.json`。

## 验证

- `npm run test:unit`：1845 tests，1843 pass，2 skip，0 fail。
- `bash ci/xcx-check.sh`：通过。
- `git diff --check`：通过。
- 标题间距真实负控：注入后 exit 1；撤销后 3/3 pass、exit 0。

## 遗留

确认无遗留。截图为 DevTools 受控态证据，不替代真机视觉验收或微信上传。
