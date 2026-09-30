const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = (...parts) => path.join(__dirname, '../..', ...parts)
const read = (...parts) => fs.readFileSync(root(...parts), 'utf8')

test('结算页把资产动作与到账提醒从金额卡拆开，并为零调整使用中性色', () => {
  const js = read('pages/merchant/ledger/index.js')
  const wxml = read('pages/merchant/ledger/index.wxml')
  const wxss = read('pages/merchant/ledger/index.wxss')
  assert.match(wxml, /class="fin-assets-cta"/)
  assert.match(wxml, /class="fin-alert-row"/)
  assert.match(wxml, /role="switch"/)
  assert.match(wxml, /bind:change="enableCoopSettleAlerts"/)
  assert.match(js, /event\.detail\.value/)
  assert.match(js, /wx\.openSetting/)
  assert.match(js, /wx\.getSetting/)
  assert.match(wxml, /overview\.hasPersonalAdjustment\s*\?\s*'fin-kv__v--neg'/)
  assert.match(wxss, /\.fin-alert-row/)
})

test('成为节点常显主动作、驳回理由与三项运营动作', () => {
  const wxml = read('pages/merchant/citynode/index.wxml')
  // 2026-09-23 CU-M-01:配额满/0 时同一颗主动作带 --disabled 修饰,仍常显
  assert.match(wxml, /class="cn-primary-action[ "]/)
  assert.match(wxml, /cn-primary-action--disabled/)
  assert.match(wxml, /class="cn-reject-reason"/)
  assert.match(wxml, />认领节点</)
  assert.match(wxml, />取打卡码</)
  assert.match(wxml, />扫码核销</)
})

// 2026-09-17 B-06:原「合作条款只读页(pricing/partner)展示冻结时间且不重复条款摘要」
// 契约随孤儿页整页退役 —— 页面已从 app.json 摘除,该断言没有宿主。

test('俱乐部分润显式区分已结算与已入账', () => {
  const js = read('components/cy/scene-merchant-profit/index.js')
  const wxml = read('components/cy/scene-merchant-profit/index.wxml')
  assert.match(wxml, /已结算不等于已入账/)
  assert.match(wxml, /class="fc-settled-badge"/)
  assert.match(wxml, /class="fc-arrived-date"/)
  assert.match(wxml, /columns="\{\{1\}\}"/)
  assert.doesNotMatch(js, /arriveDateText:\s*t\.merchantPayoutTime/)
})

test('附近商家每行固定显示承接章节与确定动作', () => {
  const wxml = read('pages/coop/nearby/index.wxml')
  assert.match(wxml, /暂无可承接章节/)
  assert.match(wxml, />进入承接</)
  assert.match(wxml, />电话联系</)
})

test('退款售后详情不再保留查单表单与最近查询(2026-09-17 改 Revolut 313 结构)', () => {
  const js = read('pages/merchant/aftercare/detail/index.js')
  const wxml = read('pages/merchant/aftercare/detail/index.wxml')
  assert.doesNotMatch(wxml, /这里能查到什么|最近查询|onRefundIdInput|findAftercare/)
  assert.doesNotMatch(js, /recentQueries|merchant_aftercare_recent_queries|findAftercare/)
  assert.match(js, /refundId == null\)\s*\{\s*wx\.redirectTo\(\{ url: '\/pages\/merchant\/aftercare\/index' \}\)/)
})

test('经营团队空态内含主邀请动作和门店说明详情入口', () => {
  const wxml = read('pages/merchant/team/index.wxml')
  assert.match(wxml, /<cy-empty wx:else title="还没有员工"[^>]*cta="邀请员工" bind:cta="openInviteRoleSheet"/)   // 2026-09-06 空态收编进 cy-empty,主动作走 cta
  assert.match(wxml, /class="tm-store-details"/)
})

test('编辑章节使用浅色内容高度弹窗与二次确认删除', () => {
  const wxml = read('pages/publish/fabu/index.wxml')
  const js = read('pages/publish/fabu/index.js')
  assert.match(wxml, /chapter-settings-delete/)
  assert.doesNotMatch(wxml, /variant="danger"[^>]*bindtap="deleteChapter"/)
  assert.match(js, /确认删除章节/)
})

test('商家官方活动保留现有结构并使用商家浅色主题', () => {
  const wxml = read('pages/activity/official-detail/index.wxml')
  const wxss = read('pages/activity/official-detail/index.wxss')
  assert.match(wxml, /theme-merchant/)
  assert.match(wxss, /merchant-light\.wxss/)
  assert.doesNotMatch(wxml, /theme-dark/)
})

test('协作对象列表是裸行头像样式，确认页回显锁定对象与条款', () => {
  const invite = read('pages/coop/invite/index.wxml')
  assert.match(invite, /class="target-list"/)
  assert.match(invite, /邀请对象 · 已锁定/)
  assert.match(invite, /合作条款 · 已锁定/)
})

test('日期范围使用商家主题日历弹窗并保留范围选择状态', () => {
  const wxml = read('pages/topic/components/cy/date-range-sheet/index.wxml')
  const merchantApply = read('pages/topic/merchantapply/index.wxml')
  const wxss = read('pages/topic/components/cy/date-range-sheet/index.wxss')
  assert.doesNotMatch(wxml, /theme-merchant/)
  assert.match(merchantApply, /class="ma-page theme-merchant/)
  assert.match(wxml, /选择开始日期/)
  assert.match(wxml, /选择结束日期/)
  assert.match(wxss, /transition:[^;}]*(?:opacity|transform)/)
  assert.doesNotMatch(wxss, /@keyframes\s+drs-phase-in/)
})

test('订单详情采用摘要、时间线和明细三段结构', () => {
  const member = read('components/cy/scene-member-order-detail/index.wxml')
  const memberJs = read('components/cy/scene-member-order-detail/index.js')
  const merchant = read('pages/merchant/ledger/order-detail/index.wxml')
  const settlement = read('pages/coop/components/settlement-detail/index.wxml')
  /* 2026-09-11 按稿 578:2298 重排:摘要从正文里的一张「商品卡」搬到了头图上
     (稿的口径是「大金额与状态先行」)。三段结构本身没变 ——
     摘要 = 头图上的金额/路线名/时间/状态药丸,时间线照旧,明细换成成组的行。 */
  assert.match(member, /class="hero-amt"/)
  assert.match(member, /class="hero-pill hero-pill--\{\{statusTone\}\}"/)
  assert.match(member, /order-timeline/)
  assert.match(member, /class="sec-title">订单明细/)
  assert.match(member, /class="sec-title">支付明细/)
  assert.match(memberJs, /buildOrderTimeline/)
  assert.doesNotMatch(member, /order-timeline-time">\{\{info\.registrationNo\}\}/)
  assert.match(merchant, /order-summary/)
  assert.match(merchant, /order-timeline/)
  assert.match(settlement, /order-summary/)
  assert.match(settlement, /order-timeline/)
})
