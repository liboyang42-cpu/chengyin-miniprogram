// H09:订单列表内容与逻辑已搬到 components/cy/scene-member-order-history(页面退化成深链薄壳),
// 断言随之指向组件文件;判据本身一条没放宽。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const ORDER_PATH = path.join(ROOT, 'components/cy/scene-member-order-history/index.js')
const policy = require(path.join(ROOT, 'utils/identity/identity-policy.js'))

function loadOrderPage(storage) {
  const snapshot = storage || {}
  const sandbox = { requests: [], switchTabs: [] }
  global.getApp = () => ({
    getPageSize: () => 10,
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest: request => sandbox.requests.push(request),
  })
  global.Page = config => { sandbox.pageConfig = config }
  // 订单列表现在是 Component;摊平成 Page 的形状,下面的断言逐字不变。
  global.Component = config => {
    sandbox.componentConfig = config
    sandbox.pageConfig = Object.assign({}, config.methods, { data: config.data })
  }
  global.wx = {
    switchTab(options) { sandbox.switchTabs.push(options) },
    getStorageSync: key => snapshot[key] || '',
  }
  delete require.cache[require.resolve(ORDER_PATH)]
  require(ORDER_PATH)

  const page = Object.assign({}, sandbox.pageConfig, {
    setData(patch) { Object.assign(this.data, patch) },
    // attached 会顺手建支付工作流;这些用例只验空态入口,单测不需要它。
    _initWorkflow() {},
    attached: sandbox.componentConfig.lifetimes.attached,
  })
  page.data = Object.assign({}, sandbox.pageConfig.data)
  return { page, sandbox }
}

// R4-C04:四列手写 order-filter 网格未获文档 §5.3 授权,源码已按 github/master 原形恢复为
// 共享 cy-tabs(chip + sticky),故此处期望回到 master 的 chip 口径,并加一条防回潮断言。
function assertOrderTabsContract(wxml, wxss) {
  assert.match(
    wxml,
    /<cy-tabs\s+tabs="{{orderTabs}}"\s+active="{{activeTab}}"\s+variant="chip"\s+sticky\s+bind:change="switchTab"\s*\/>/,
    '订单页应使用可横滑的 chip 标签，不能让七个状态等分挤压'
  )
  assert.doesNotMatch(wxml, /class="order-filter"/, '手写四列网格(§5.3 未授权)不得回潮')
  assert.doesNotMatch(wxss, /\.order-filter\s*\{/, '手写四列网格样式不得回潮')
}

test('我的订单状态筛选可横向滚动，长标签不会被等分窄列折行', () => {
  assertOrderTabsContract(read('components/cy/scene-member-order-history/index.wxml'), read('components/cy/scene-member-order-history/index.wxss'))
})

test('订单筛选经共享 cy-tabs 的 change 事件切换并刷新该状态的订单', () => {
  const { page, sandbox } = loadOrderPage()
  page.switchTab({ detail: { key: 'completed' } })
  assert.equal(page.data.activeTab, 'completed')
  assert.equal(sandbox.requests.length, 1, '切换状态后必须刷新该筛选的订单')
})

test('负控：订单筛选退回手写四列网格时必须判红', () => {
  const wxml = read('components/cy/scene-member-order-history/index.wxml')
  const mutated = wxml.replace(
    /<cy-tabs\s+tabs="{{orderTabs}}"[^>]*\/>/,
    '<view class="order-filter" aria-role="tablist"><view class="order-filter__item"></view></view>',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效：未找到 cy-tabs')
  assert.throws(() => assertOrderTabsContract(mutated, read('components/cy/scene-member-order-history/index.wxss')), assert.AssertionError)
})

test('我的订单空态只在真正无订单时提供返回发现页的下一步', () => {
  const js = read('components/cy/scene-member-order-history/index.js')
  const wxml = read('components/cy/scene-member-order-history/index.wxml')

  // 总控根因修复轮:两个 cy-empty 各自直接传 fill 属性做剩余空间居中(取代上一轮的
  // orderbox_state wrapper div,fill 依赖父容器 flex column 而不是额外套壳),判据不变。
  const stateBlock = wxml.slice(wxml.indexOf('<cy-skeleton'), wxml.indexOf('class="orderbox_li"'))
  assert.match(stateBlock, /list\.length==0/, '空态整体只在 list 为空时渲染')
  // CU-M-103 起 cta 是三元:商家身份下这个按钮兑现不了(见下面两条),文案本身仍留在 wxml。
  assert.match(stateBlock, /wx:if="\{\{!loading && !errorMsg && list\.length==0 && !hasOrders\}\}" fill[\s\S]*?cta="\{\{canDiscoverRoutes \? '去发现城市路线' : ''\}\}"[\s\S]*?bind:cta="goDiscoverRoutes"/)
  assert.match(stateBlock, /wx:if="\{\{!loading && !errorMsg && list\.length==0 && hasOrders\}\}" fill[\s\S]*?title="当前筛选暂无订单"[\s\S]*?试试切换其他状态查看订单。/)
  assert.match(
    js,
    /goDiscoverRoutes\(\)\s*\{\s*wx\.switchTab\(\{\s*url:\s*'\/pages\/index\/index'\s*}\);?\s*}/,
    '空态 CTA 必须回到小程序发现首页'
  )
})

/* ===== CU-M-103:商家身份下不给「去发现城市路线」 =====
 * 走查实测:商家 9002 在订单空态点这个按钮,路径短暂进 pages/index/index,
 * 最终停在商家工作台(收入/扫码/客户/财务)—— 按钮承诺的发现页对商家身份不可达。
 * 商家能不能逛玩家发现页是产品规则,不在本条改判;这一条只要求:不给兑现不了的按钮。
 */
test('★玩家身份的订单空态照旧给「去发现城市路线」，点了回发现首页', () => {
  const { page, sandbox } = loadOrderPage({ role: 'user', user_type: 1 })
  page.attached()
  assert.equal(page.data.canDiscoverRoutes, true)
  page.goDiscoverRoutes()
  assert.deepEqual(sandbox.switchTabs, [{ url: '/pages/index/index' }])
})

test('★商家身份不给这个按钮;debug_user_view=user 是玩家展示视角,按钮留着', () => {
  const merchant = loadOrderPage({ role: 'merchant', user_type: 2 })
  merchant.page.attached()
  assert.equal(merchant.page.data.canDiscoverRoutes, false, '商家点了只会落到商家工作台,不该承诺去发现')

  const legacy = loadOrderPage({ role: '', user_type: 2 })
  legacy.page.attached()
  assert.equal(legacy.page.data.canDiscoverRoutes, false, '存量 user_type=2 同样按商家口径')

  const debugPlayer = loadOrderPage({ role: 'merchant', user_type: 2, debug_user_view: 'user' })
  debugPlayer.page.attached()
  assert.equal(debugPlayer.page.data.canDiscoverRoutes, true, '判据必须与 pages/index/index 的 viewSnap 同源')
})

test('★负控：撤掉商家身份判定，商家又会拿到兑现不了的按钮', () => {
  const js = read('components/cy/scene-member-order-history/index.js')
  const real = judgeBody(js, 'canReachDiscoverRoutes')
  const mutated = js.replace(
    /function canReachDiscoverRoutes\(\) \{[\s\S]*?\n\}/,
    'function canReachDiscoverRoutes() {\n  return true\n}',
  )
  assert.notEqual(mutated, js, '负控未命中 CU-M-103 的身份判定')
  const storage = { getStorageSync: key => (key === 'role' ? 'merchant' : '') }
  assert.equal(real(storage), false)
  assert.equal(judgeBody(mutated, 'canReachDiscoverRoutes')(storage), true,
    '撤掉身份判定后商家仍拿到按钮 = 上一条合同是假的')
})

/** 把源码里的身份判定函数体取出来跑:测试不复制一份判定逻辑,负控也只改这段源码。 */
function judgeBody(source, name) {
  const matched = source.match(new RegExp('function ' + name + '\\(\\) \\{([\\s\\S]*?)\\n\\}'))
  assert.ok(matched, `源码里找不到 ${name}`)
  return storage => new Function('policy', 'wx', matched[1])(policy, storage)
}

test('当前状态筛选无命中不被当作真正无订单', () => {
  const { page, sandbox } = loadOrderPage()
  page.data.activeTab = 'completed'

  page.getList()
  const request = sandbox.requests[0]
  request.success({ code: '200', data: { rows: [{ id: 1, registrationStatus: 1 }] } })
  request.complete()

  assert.equal(page.data.hasOrders, true, '服务端返回过订单时应保留真实订单存在状态')
  assert.deepEqual(page.data.list, [], '非当前状态的订单不应混入筛选结果')
})

test('cy-empty CTA 具备按钮语义并以 CTA 文案作为标签', () => {
  const wxml = read('components/cy/empty/index.wxml')

  assert.match(wxml, /class="cy-empty-cta"[^>]*aria-role="button"[^>]*aria-label="{{cta}}"[^>]*bindtap="onCta"/)
})

function assertErrorActionAccessible(wxml) {
  const action = wxml.match(/<view\b[^>]*class="cy-error-retry"[^>]*>/)
  assert.ok(action, 'cy-error 必须渲染统一主动作')
  assert.match(action[0], /aria-role="button"/, 'cy-error 主动作必须暴露按钮语义')
  assert.match(action[0], /aria-label="{{retryLabel}}"/, 'cy-error 主动作必须用可见动作作为无障碍标签')
  assert.match(action[0], /bindtap="onRetry"/, 'cy-error 主动作必须触发真实 retry 事件')
}

test('cy-error 重试具备按钮语义并以动作文案作为标签', () => {
  assertErrorActionAccessible(read('components/cy/error/index.wxml'))
})

test('负控:cy-error 重试拿掉按钮语义时必须命中无障碍闸', () => {
  const wxml = read('components/cy/error/index.wxml')
  const mutated = wxml.replace(' aria-role="button"', '')
  assert.notEqual(mutated, wxml, '负控锚点失效：cy-error 主动作没有 aria-role')
  assert.throws(() => assertErrorActionAccessible(mutated), /主动作必须暴露按钮语义/)
})
