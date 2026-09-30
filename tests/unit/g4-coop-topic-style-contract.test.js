const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  assert.ok(match, `missing CSS rule: ${selector}`)
  return match[1]
}

const { NESTED_FILL } = require('../helpers/nested-fill.js')

function assertG4Contract(overrides = {}) {
  const source = file => overrides[file] === undefined ? read(file) : overrides[file]

  const list = source('pages/coop/list/index.wxml')
  assert.match(list, /<cy-tabs[^>]*variant="fill"/, 'coop/list 内容 tab 必须是 fill')

  const nearbyJson = JSON.parse(source('pages/coop/nearby/index.json'))
  const nearbyJs = source('pages/coop/nearby/index.js')
  const nearbyWxml = source('pages/coop/nearby/index.wxml')
  const nearbyWxss = source('pages/coop/nearby/index.wxss')
  // 读 token 真值而不是钉字面量,理由同 std-g1(2026-08-10 改底色时踩到)
  const pageBg = /--cy-color-bg-page:\s*(#[0-9A-Fa-f]{6})/.exec(source('style/merchant-light.wxss'))[1]
  assert.equal(nearbyJson.backgroundColor.toLowerCase(), pageBg.toLowerCase())
  assert.match(nearbyWxml, /class="card"[^>]*wx:if="\{\{item\.name\}\}"/, '缺商家名时不渲染半成品卡')
  assert.match(nearbyJs, /res\.data\.every\(validNearbyRow\)/,
    '任一附近商家缺名称或关键标识时必须整批 fail-closed，不得悄悄过滤后冒充完整列表')
  assert.match(nearbyWxml,
    /<cy-btn wx:if="\{\{item\.memberId\}\}" variant="primary"[^>]*>[\s\S]*?进入承接<\/cy-btn>/,
    '已入驻商家必须给出明确的进入承接主动作')
  assert.match(nearbyWxml,
    /<cy-btn wx:elif="\{\{item\.canCall\}\}" variant="secondary"[^>]*>[\s\S]*?电话联系<\/cy-btn>/,
    '未入驻商家只能给出互斥的电话联系次动作，不能与主动作堆叠')
  assert.match(rule(nearbyWxss, '.card'), /border-radius:\s*var\(--cy-radius-lg\)/)
  assert.match(rule(nearbyWxss, '.badge-on'), /background:\s*var\(--cy-bg-card-2\)/)
  assert.doesNotMatch(rule(nearbyWxss, '.badge-on'), /--cy-brand/)

  const financeWxss = source('components/cy/scene-merchant-profit/index.wxss')
  const financeWxml = source('components/cy/scene-merchant-profit/index.wxml')
  assert.match(rule(financeWxss, '.stat-grid'), /--cy-color-border-subtle:\s*transparent/)
  assert.match(rule(financeWxss, '.stat-grid'), /--cy-radius-md:\s*var\(--cy-radius-lg\)/)
  assert.doesNotMatch(rule(financeWxss, '.fc-list'), /(^|;)\s*border\s*:/)
  assert.match(rule(financeWxss, '.fc-card'), /border-radius:\s*var\(--cy-radius-lg\)/)
  assert.doesNotMatch(rule(financeWxss, '.fc-card'), /border-bottom\s*:/)
  assert.doesNotMatch(rule(financeWxss, '.fc-bottom'), /background\s*:/,
    '结算状态行不再嵌套灰底卡，只靠文字与徽章分层')
  assert.match(financeWxml, /class="fc-arrived-date"[^>]*>\{\{item\.statusText\}\}/)
  assert.match(financeWxml, /class="fc-meta[^>]*>\{\{item\.merchantStatus\s*\|\|/)
  assert.match(financeWxml, /class="fc-settled-badge"/)

  const inviteWxml = source('pages/coop/invite/index.wxml')
  const inviteJs = source('pages/coop/invite/index.js')
  const tabsJs = source('components/cy/tabs/index.js')
  const inviteWxss = source('pages/coop/invite/index.wxss')
  assert.equal((inviteWxml.match(/<cy-tabs\b/g) || []).length, 0, 'type2 撤销后邀约页不再需要类型切换')
  assert.match(tabsJs, /active:\s*\{\s*type:\s*String/, 'cy-tabs active 的公开合同为 String')
  assert.match(inviteJs, /switchShareMode|onFeeInput/, '邀约档位必须保留按类型选择与金额输入')
  assert.doesNotMatch(inviteJs, /shareModeTabs:|ratePresets:|引流型|固定型|分成型|计酬档/,
    '邀约页不得出现内部档位词或分成选择器')
  assert.match(inviteWxml, /class="terms-options"/)
  assert.match(rule(inviteWxss, '.terms-option'), /min-height:\s*88rpx/,
    '合作条款选项触达高度必须至少 44px（88rpx@375）')
  assert.doesNotMatch(inviteJs + inviteWxml, /activeType\s*===\s*2|inviteTypeTabs|邀商家做节点|承接节点/)
  assert.doesNotMatch(inviteWxml, /引流型|固定型|分成型|计酬档/)
  assert.doesNotMatch(inviteWxml, /seg-item/, '旧手写分段控件不得回潮')
  assert.match(rule(inviteWxss, '.card'), /border-radius:\s*var\(--cy-radius-lg\)/)
  const separator = /(^|;)\s*border(?:-(?:top|bottom|left|right))?\s*:/
  assert.doesNotMatch(rule(inviteWxss, '.card-subtit'), separator)
  assert.match(rule(inviteWxss, '.target'), /border-bottom:\s*1rpx solid var\(--cy-border-card\)/,
    '邀请对象使用头像、文字、状态组成的分隔行')

  const pricingWxml = source('pages/topic/pricing/index.wxml')
  const pricingJs = source('pages/topic/pricing/index.js')
  const pricingWxss = source('pages/topic/pricing/index.wxss')
  assert.match(pricingWxml, /<cy-tabs[^>]*variant="chip"/)
  assert.match(pricingWxml, /<cy-error[^>]*title="定价信息加载失败"/)
  assert.match(pricingWxml, /class="pg-actions"/)
  assert.doesNotMatch(rule(pricingWxss, '.pg-card'), /border:/)
  assert.match(rule(pricingWxss, '.pg-actions'), /position:\s*sticky/)
  assert.match(pricingJs, /value == null \|\| \(typeof value === 'string' && !value\.trim\(\)\)/,
    '金额格式化不得把 null 或空字符串显示为 0.00')
  assert.match(pricingJs, /res\.data\.priceMin == null \|\| res\.data\.priceMin === ''/,
    '缺定价地板时不得渲染 0.00 半成品')

  // 2026-09-17 B-06:合作方档案页(pricing/partner)整页退役,上面这组 G4 断言随之删除。

  const merchantWxml = source('pages/topic/merchantinfo/merchantinfo.wxml')
  const merchantJs = source('pages/topic/merchantinfo/merchantinfo.js')
  const merchantWxss = source('pages/topic/merchantinfo/merchantinfo.wxss')
  assert.match(merchantWxml, /<cy-nav-bar\s*\/>/, '商家详情使用默认返回形态')
  assert.match(merchantWxml, /<cy-tabs[^>]*variant="fill"/)
  assert.match(merchantWxml, /class="cover-fb-skeleton"/)
  assert.match(merchantWxml, /class="detail-cover-fallback"/)
  assert.match(merchantWxml, /<cy-error[^>]*wx:if="\{\{browseLoadError\}\}"[^>]*title="加载失败"/)
  assert.match(merchantWxml, /bind:retry="retryBrowseData"/)
  assert.match(merchantJs, /browseLoadError:\s*''/)
  assert.match(merchantJs, /res\.code == '200' && res\.data && res\.data\.name/, '缺主题名不得渲染半成品详情')
  for (const selector of ['.topic .muban', '.davidxfxi', '.davidomxi']) {
    assert.doesNotMatch(rule(merchantWxss, selector), /border-bottom\s*:/, `${selector} 卡内不得使用横线分层`)
    // 卡片本体一律白卡色:灰只留给控件底/占位/chip/只读派生值,不当卡底也不当分层。
    assert.match(rule(merchantWxss, selector), /background:\s*var\(--cy-bg-card\)/, `${selector} 卡底必须是白卡色`)
  }
  assert.doesNotMatch(merchantWxss, /rgba\(24,\s*24,\s*24,/, '近黑字面量统一为纯黑')
}

test('G4 协作与主题页遵循商家版统一卡片、tab、底色和兜底契约', () => {
  assertG4Contract()
})

test('负控：chip tab 回退为 segmented 会判红', () => {
  const file = 'pages/topic/pricing/index.wxml'
  const broken = read(file).replace('variant="chip"', 'variant="segmented"')
  assert.throws(() => assertG4Contract({ [file]: broken }), /variant="chip"/)
})

test('负控：合作条款选项触达高度退回 40px 会判红', () => {
  const file = 'pages/coop/invite/index.wxss'
  const broken = read(file).replace(/(\.terms-option\s*\{[^}]*min-height:\s*)88rpx/,
    (_, prefix) => `${prefix}80rpx`)
  assert.throws(() => assertG4Contract({ [file]: broken }), /触达高度必须至少 44px/)
})

test('负控：删除封面骨架兜底会判红', () => {
  const file = 'pages/topic/merchantinfo/merchantinfo.wxml'
  const broken = read(file).replace('class="cover-fb-skeleton"', 'class="cover-fb-removed"')
  assert.throws(() => assertG4Contract({ [file]: broken }), /cover-fb-skeleton/)
})

test('负控：创作者侧恢复分成选择器会判红', () => {
  const file = 'pages/coop/invite/index.js'
  const broken = read(file).replace('shareMode: 0', "shareModeTabs: [{ key: '1', label: '分成型' }], shareMode: 0")
  assert.throws(() => assertG4Contract({ [file]: broken }), /邀约页不得出现内部档位词/)
})
