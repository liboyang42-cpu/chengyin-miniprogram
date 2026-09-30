const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const controller = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiMerchantController.java')
const aggregate = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/MerchantAggregateReadServiceImpl.java')
const merchantHome = read('pages/merchant/index/index.js')
const marketing = read('pages/merchant/marketing/index.js')
const marketingView = read('pages/merchant/marketing/index.wxml')
const preview = read('scripts/preview-merchant-home.js')

function assertExposureRemoved(sources) {
  assert.doesNotMatch(sources.controller, /exposureCount|funnelStep\(/)
  assert.doesNotMatch(sources.aggregate, /funnelStep\(/)
  assert.doesNotMatch(sources.merchantHome, /exposureCount|曝光→报名/)
  assert.doesNotMatch(sources.marketing, /曝光量|by\['曝光'\]|key:\s*'exposure'|曝光→报名|报名量|核销率/)
  assert.doesNotMatch(sources.marketingView, /曝光量|曝光\/报名/)
  assert.doesNotMatch(sources.preview, /exposureCount/)
}

test('dashboard 不再下发 exposureCount，营销页只展示可追溯浏览事件且不复活相邻漏斗', () => {
  assertExposureRemoved({ controller, aggregate, merchantHome, marketing, marketingView, preview })
  assert.match(controller, /merchantAggregateReadService\.funnel\(access\.getOwnerMemberId\(\), windowDays\)/)
  assert.match(aggregate, /INDEPENDENT_EVENT_COUNTS/)
  assert.match(aggregate, /eventStage\("BROWSE",\s*"浏览"/)
  // 2026-09-18 UI-09:「经营事件」区块按用户稿删除,营销页不再展示事件列表,更不许冒出转化率
  assert.doesNotMatch(marketingView, /经营事件|转化率/)
})

test('负控:重新加回 exposureCount 兼容字段时合同必须转红', () => {
  const mutated = Object.assign({}, {
    controller, aggregate, merchantHome, marketing, marketingView, preview,
  }, { controller: controller + '\ndata.put("exposureCount", 0);' })
  assert.throws(() => assertExposureRemoved(mutated), /exposureCount/)
})
