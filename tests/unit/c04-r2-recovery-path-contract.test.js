// C04 R2:终态页面的「出路」契约。
//
// 本文件盯的不是样式,是**控件说的话与它能做的事是否一致**。三条都来自 2026-07-30 受控截图
// (~/Desktop/C04截图_9676_20260730)与源码互证:
//   03 orderinfo    —— 文案写「请返回订单列表重新进入」,卡上却只有「联系客服」。
//   05 mycanyuinfo  —— 缺参数时整屏无按钮,用户被钉在一段死文字上。
//   08 coupon-qr    —— 返回箭头被 z=900 的凭证遮罩埋在下面,看得见、点不动。
//
// 断言取向:能驱动的走**行为级**(真的装载页面、真的调 handler、断言它调了哪个导航 API)。
// 负控分两路,都**文件特定**:
//   ① 输入级:同一个 handler 喂不同页面栈,拿到不同导航结果 —— 任何一侧被写死就有测试红。
//   ② 源码级:把该文件的守卫改坏后重新装载,断言行为真的退化。
// ⚠️ ② 用 node:vm 装载**本仓自己的源码文件**(无任何字符串插值、无外部输入),
//    这是拿到「守卫拆掉后行为真的变了」这一证据的唯一办法;不是在执行不可信输入。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ORDER_LIST = 'subpackageMember/order/order'
const ORDERINFO = 'subpackageMember/orderinfo/orderinfo'
// H10:订单详情正文已搬到组件,页面退化成深链薄壳。
// 导航语义(按钮字面必须为真)仍由壳的 backToOrderList 承担 → js 断言继续读 ORDERINFO;
// 失败卡 markup 在组件里 → wxml 断言读 ORDERINFO_WXML。判据一条没放宽。
const ORDERINFO_WXML = 'components/cy/scene-member-order-detail/index'
const MYCANYU_LIST = 'subpackageMember/mycanyu/mycanyu'
const MYCANYUINFO = 'subpackageMember/mycanyuinfo/mycanyuinfo'
// H12:参与详情正文与「错误态动作」判定已搬进组件(页面退化成深链薄壳)。
// 逻辑断言读组件;深链兜底导航仍由壳承担,那两条继续读 MYCANYUINFO。
const MYCANYUINFO_C = 'subpackageMember/components/scene-member-participation-detail/index'

/**
 * 在受控沙箱里装载一个页面模块的源码,录下它的导航调用。
 *
 * @param {string} pageRelDir  页面所在目录(相对仓库根),用于解析该模块的相对 require
 * @param {string} source      要装载的源码(原文或变异体)
 * @param {string[]} stack     getCurrentPages() 返回的 route 列表,最后一项是本页
 */
function loadPage(pageRelDir, source, stack) {
  const sandbox = { requests: [], nav: [], toasts: [] }
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: request => sandbox.requests.push(request),
    tips: message => sandbox.toasts.push(message),
  }
  // ⚠️ 把 vm 里传出来的 options 复制成**本 realm** 的普通对象:跨 realm 的对象原型不同,
  // deepStrictEqual 会报「same structure but not reference-equal」而与被测行为无关。
  const nav = api => options => sandbox.nav.push({
    api,
    options: options ? Object.assign({}, options) : options,
  })
  const context = {
    getApp: () => app,
    Page: config => { sandbox.pageConfig = config },
    // H10 之后订单详情是 Component:摊平成 Page 的形状(attached→onLoad),下面的断言逐字不变。
    Component: config => { sandbox.pageConfig = flattenComponentToPage(config) },
    getCurrentPages: () => stack.map(route => ({ route })),
    wx: {
      navigateBack: nav('navigateBack'),
      redirectTo: nav('redirectTo'),
      navigateTo: nav('navigateTo'),
      reLaunch: nav('reLaunch'),
      switchTab: nav('switchTab'),
      showToast: options => sandbox.toasts.push(options && options.title),
      showLoading() {}, hideLoading() {}, showModal() {},
      stopPullDownRefresh() {}, vibrateShort() {},
    },
    // 相对 require 以该页面目录为基准解析,与真机一致
    require: id => (id.startsWith('.')
      ? require(path.resolve(ROOT, pageRelDir, id))
      : require(id)),
    module: { exports: {} },
    exports: {},
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: path.join(ROOT, pageRelDir, 'loaded-under-test.js') })

  assert.ok(sandbox.pageConfig, `${pageRelDir} 未调用 Page()`)
  // 组件化后的内容会 triggerEvent 回宿主(back/close/refresh);沙箱里录下来即可。
  sandbox.events = []
  const page = Object.assign({}, sandbox.pageConfig, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { sandbox.events.push({ name, detail }) },
  })
  page.data = Object.assign({}, sandbox.pageConfig.data)
  return { page, sandbox }
}

const loadOrderInfo = (stack = [ORDER_LIST, ORDERINFO], source = read(`${ORDERINFO}.js`)) =>
  loadPage('subpackageMember/orderinfo', source, stack)

const loadMyCanyuInfo = (stack = [MYCANYU_LIST, MYCANYUINFO], source = read(`${MYCANYUINFO_C}.js`)) =>
  loadPage('subpackageMember/components/scene-member-participation-detail', source, stack)

// ————————————————————————————————————————————————————————————
// 11.1 orderinfo:文案指的那条路,必须真的存在
// ————————————————————————————————————————————————————————————

// 2026-09-15 T3f 总控裁决:失败面板 2s 自动回订单列表,原因行只说原因,不再叫用户自己返回;
// 「真的回到列表」由下面两条 backToOrderList 导航断言证明。
test('订单详情缺参数时落在失败态(面板自动回订单列表),原因只说原因', () => {
  // 这一档的判定随正文搬进了组件的 attached(壳只负责把 options.id 透传下去)。
  const { page } = loadPage(
    'components/cy/scene-member-order-detail',
    read(`${ORDERINFO_WXML}.js`),
    [ORDERINFO],
  )
  page.properties = { orderId: '' }
  page.onLoad()
  assert.equal(page.data.loadState, 'failed_business')
  assert.match(page.data.loadErrorText, /订单参数缺失/)
  assert.doesNotMatch(page.data.loadErrorText, /重新进入|请返回/)
})

test('上一页就是订单列表 ⇒ 回退一层(不新开一个列表页)', () => {
  const { page, sandbox } = loadOrderInfo([ORDER_LIST, ORDERINFO])
  page.onLoad({})
  page.backToOrderList()
  assert.deepEqual(sandbox.nav, [{ api: 'navigateBack', options: { delta: 1 } }])
})

test('深链直落详情(栈里没有列表)⇒ redirectTo 落到列表,不把已坏的详情页留在栈里', () => {
  const { page, sandbox } = loadOrderInfo([ORDERINFO])
  page.onLoad({})
  page.backToOrderList()
  assert.deepEqual(sandbox.nav, [{ api: 'redirectTo', options: { url: `/${ORDER_LIST}` } }])
})

test('上一页不是订单列表(从票夹跳来)⇒ 仍然落到订单列表,按钮字面必须为真', () => {
  const { page, sandbox } = loadOrderInfo(['subpackageMember/signup/index', ORDERINFO])
  page.onLoad({})
  page.backToOrderList()
  assert.deepEqual(sandbox.nav, [{ api: 'redirectTo', options: { url: `/${ORDER_LIST}` } }])
})

test('负控:orderinfo 的出路退化成裸 navigateBack 后,「按钮字面为真」这条真的红', () => {
  const source = read(`${ORDERINFO}.js`)
  const mutated = source.replace(
    /  backToOrderList\(\) \{[\s\S]*?\n  \},\n/,
    '  backToOrderList() {\n    wx.navigateBack({ delta: 1 });\n  },\n',
  )
  assert.notEqual(mutated, source, '变异锚点失效:未找到 orderinfo.backToOrderList')

  // 从票夹进来的场景:守卫在时应 redirectTo 到订单列表,守卫拆了就退回票夹
  const { page, sandbox } = loadOrderInfo(['subpackageMember/signup/index', ORDERINFO], mutated)
  page.onLoad({})
  page.backToOrderList()
  assert.deepEqual(sandbox.nav, [{ api: 'navigateBack', options: { delta: 1 } }],
    '变异体应退化为裸 navigateBack')
  assert.throws(
    () => assert.deepEqual(sandbox.nav, [{ api: 'redirectTo', options: { url: `/${ORDER_LIST}` } }]),
    assert.AssertionError,
    '守卫拆掉后必须判红',
  )
})

// 稿 356:5220 之后失败态没有按钮:「回订单列表」由面板 2s 自愈关闭兑现(原因行不再写这句指令),
// 所以约束从「返回钮无条件」翻成「面板关闭事件无条件回列表」。缺 id 仍是最需要它的一档。
const failSheetTag = (wxml) => (wxml.match(/<cy-result-sheet\b[^>]*\/>/) || [''])[0]

test('orderinfo 失败面板关闭无条件回订单列表', () => {
  const tag = failSheetTag(read(`${ORDERINFO_WXML}.wxml`))
  assert.ok(tag, '失败面板锚点失效(源码已改动?)')
  assert.match(tag, /bind:close="backToOrderList"/)
  assert.doesNotMatch(tag, /wx:if/, '缺 id 时它是唯一出路,不得挂条件')
})

test('负控:给失败面板挂上 wx:if="{{id}}" 后必须判红(缺 id 正是最需要它的一档)', () => {
  const wxml = read(`${ORDERINFO_WXML}.wxml`)
  const mutated = wxml.replace('<cy-result-sheet ', '<cy-result-sheet wx:if="{{id}}" ')
  assert.notEqual(mutated, wxml, '变异锚点失效:未找到 cy-result-sheet')
  assert.throws(
    () => assert.doesNotMatch(failSheetTag(mutated), /wx:if/),
    assert.AssertionError,
  )
})

// ————————————————————————————————————————————————————————————
// 11.2 mycanyuinfo:缺参数时也必须有一个能走的出口
// ————————————————————————————————————————————————————————————

test('参与详情缺参数 ⇒ 动作标签是「返回参与列表」,点了真的回参与列表', () => {
  const { page, sandbox } = loadMyCanyuInfo([MYCANYU_LIST, MYCANYUINFO])
  page.onLoad()
  assert.equal(page.data.loadState, 'missing-param')
  assert.equal(page.data.errorActionText, '返回参与列表', '缺参数时不能是空标签(空 ⇒ 整屏无按钮)')

  // 组件里这一步是 triggerEvent('back'):回到宿主(我的参与列表),
  // 「点了真的回参与列表」由宿主保证 —— 弹窗宿主是列表页本身,深链壳里则 redirectTo 列表(见下一条)。
  page.onErrorAction()
  assert.deepEqual(sandbox.events.map((e) => e.name), ['back'])
})

test('参与详情缺参数且是深链直落 ⇒ redirectTo 落到参与列表', () => {
  // 这一档由深链薄壳承担:组件发 back,壳翻译成页面导航。
  const { page, sandbox } = loadPage('subpackageMember/mycanyuinfo', read(`${MYCANYUINFO}.js`), [MYCANYUINFO])
  page.backToList()
  assert.deepEqual(sandbox.nav, [{ api: 'redirectTo', options: { url: `/${MYCANYU_LIST}` } }])
})

test('参与详情有 id 但接口失败 ⇒ 动作仍是「重试」,点了重新发请求而不是跳走', () => {
  const { page, sandbox } = loadMyCanyuInfo([MYCANYU_LIST, MYCANYUINFO])
  page.data.recordId = '77'
  page.onLoad()
  assert.equal(sandbox.requests.length, 1)
  sandbox.requests[0].fail({ code: -1, msg: '网络异常' })
  assert.equal(page.data.loadState, 'error')
  assert.equal(page.data.errorActionText, '重试')

  page.onErrorAction()
  assert.equal(sandbox.requests.length, 2, '「重试」必须真的重新发请求')
  assert.deepEqual(sandbox.nav, [], '「重试」不得偷偷跳转')
})

test('负控:把缺参数档的动作标签清空(退回 R1 的纯文字终态)必须判红', () => {
  const source = read(`${MYCANYUINFO_C}.js`)
  const mutated = source.replace(/errorActionText:\s*'返回参与列表'/g, "errorActionText: ''")
  assert.notEqual(mutated, source, '变异锚点失效:未找到缺参数档的动作标签')

  const { page } = loadMyCanyuInfo([MYCANYU_LIST, MYCANYUINFO], mutated)
  page.onLoad()
  assert.equal(page.data.errorActionText, '', '变异体应退回无动作')
  assert.throws(
    () => assert.equal(page.data.errorActionText, '返回参与列表'),
    assert.AssertionError,
    '缺参数档没有出口时必须判红',
  )
})

test('负控:把「重试」档也改成跳转(标签与行为不符)必须判红', () => {
  const source = read(`${MYCANYUINFO_C}.js`)
  const mutated = source.replace(
    /      if \(!this\.data\.id\) \{\n        this\.backToList\(\);\n        return;\n      \}\n/,
    '      this.backToList();\n      if (true) return;\n',
  )
  assert.notEqual(mutated, source, '变异锚点失效:未找到 onErrorAction 的分档守卫')

  const { page, sandbox } = loadMyCanyuInfo([MYCANYU_LIST, MYCANYUINFO], mutated)
  page.data.recordId = '77'
  page.onLoad()
  sandbox.requests[0].fail({ code: -1, msg: '网络异常' })
  const before = sandbox.requests.length
  page.onErrorAction()
  assert.throws(
    () => assert.equal(sandbox.requests.length, before + 1, '「重试」必须真的重新发请求'),
    assert.AssertionError,
  )
})

test('mycanyuinfo 的 cy-error 动作槽由页面状态驱动,不再写死 id 三元', () => {
  const wxml = read(`${MYCANYUINFO_C}.wxml`)
  const errorTag = wxml.match(/<cy-error[^>]*>/)
  assert.ok(errorTag, '缺少 cy-error')
  assert.match(errorTag[0], /retry="\{\{errorActionText\}\}"/)
  assert.match(errorTag[0], /bind:retry="onErrorAction"/)
  assert.doesNotMatch(errorTag[0], /retry="\{\{id \? '重试' : ''\}\}"/,
    '缺参数时给空标签 = 整屏无按钮,已被 R2 推翻')
})

// ————————————————————————————————————————————————————————————
// 11.3 coupon-qr:返回钮必须浮在凭证遮罩之上,而不是被埋住
// ————————————————————————————————————————————————————————————

// 层级事实只能静态断言(WXSS/组件默认值不进 JS 运行时),但判据是**具体数字关系**:
// nav 的 z(--cy-z-nav=90)必须大于本页传给 cy-qr-voucher 的 z,否则遮罩盖住返回钮。
// 注释里会出现示例标签(如「此前这里是裸 <cy-nav-bar />」),不剥注释会匹配到注释而非真标签。
const stripComments = wxml => wxml.replace(/<!--[\s\S]*?-->/g, '')

function navZIndex() {
  const tokens = read('style/tokens.wxss')
  const match = tokens.match(/--cy-z-nav:\s*(\d+)/)
  assert.ok(match, '--cy-z-nav 定义失效')
  return Number(match[1])
}

function voucherZIndexOn(rawWxml) {
  const wxml = stripComments(rawWxml)
  const tag = wxml.match(/<cy-qr-voucher[\s\S]*?\/>/)
  assert.ok(tag, '缺少 cy-qr-voucher')
  const explicit = tag[0].match(/z-index="\{\{(\d+)\}\}"/)
  if (explicit) return Number(explicit[1])
  // 没传就是组件默认值
  const comp = read('components/cy/qr-voucher/index.js').match(/zIndex:\s*\{[^}]*value:\s*(\d+)/)
  assert.ok(comp, 'qr-voucher zIndex 默认值失效')
  return Number(comp[1])
}

function assertBackReachableAboveVoucher(rawWxml, label) {
  const wxml = stripComments(rawWxml)
  const navZ = navZIndex()
  const voucherZ = voucherZIndexOn(rawWxml)
  assert.ok(
    voucherZ < navZ,
    `${label}:凭证层 z=${voucherZ} 必须低于导航层 z=${navZ},否则 82% 黑遮罩会把返回钮盖住(看得见、点不动)`,
  )
  // 遮罩本身不响应点击(maskClosable=false)⇒ 返回钮是这一态唯一的 44pt 出口,必须真接上处理器
  const navTag = wxml.match(/<cy-nav-bar[^>]*\/?>/)
  assert.ok(navTag, `${label}:缺少 cy-nav-bar`)
  assert.match(navTag[0], /custom-back/, `${label}:返回必须由页面接管`)
  assert.match(navTag[0], /bind:back="onClose"/, `${label}:复用本页已正确的 onClose`)
  assert.match(navTag[0], /tint="light"/, `${label}:暗遮罩上必须强制白箭头,不能随主题漂移`)
}

test('coupon-qr:凭证层降到导航层之下,返回钮浮在遮罩上且接管了返回', () => {
  assertBackReachableAboveVoucher(read('subpackageMember/coupon-qr/index.wxml'), 'coupon-qr')
})

test('coupon-qr:遮罩仍不可点关闭 ⇒ 更加要求返回钮真的可用', () => {
  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  assert.match(wxml, /maskClosable="\{\{false\}\}"/, '本页有意不允许点遮罩关闭')
})

test('负控:coupon-qr 退回 cy-qr-voucher 默认 z(900)时,返回钮可达性必须判红', () => {
  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  const mutated = wxml.replace(/\n\s*z-index="\{\{\d+\}\}"/, '')
  assert.notEqual(mutated, wxml, '变异锚点失效:未找到 coupon-qr 的 z-index')
  assert.equal(voucherZIndexOn(mutated), 900, '变异体应退回组件默认 900')
  assert.throws(() => assertBackReachableAboveVoucher(mutated, 'coupon-qr'), assert.AssertionError)
})

test('负控:coupon-qr 去掉 tint="light"(白箭头随主题漂移)必须判红', () => {
  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  // 先剥注释再变异:注释里也写着 tint="light",否则 replace 会改到注释而真标签不变(假绿)
  const bare = stripComments(wxml)
  const mutated = bare.replace(' tint="light"', '')
  assert.notEqual(mutated, bare, '变异锚点失效:未找到 tint="light"')
  assert.throws(() => assertBackReachableAboveVoucher(mutated, 'coupon-qr'), assert.AssertionError)
})

test('负控:coupon-qr 的返回钮不接 onClose(退回组件内建 navigateBack)必须判红', () => {
  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  const mutated = stripComments(wxml).replace(/<cy-nav-bar[^>]*\/>/, '<cy-nav-bar tint="light" />')
  assert.notEqual(mutated, wxml, '变异锚点失效:未找到 cy-nav-bar')
  assert.throws(() => assertBackReachableAboveVoucher(mutated, 'coupon-qr'), assert.AssertionError)
})

test('coupon-qr 未使用 pill(非 hero 页禁用,与 secondary-nav-consistency 一致)', () => {
  assert.doesNotMatch(read('subpackageMember/coupon-qr/index.wxml'), /<cy-nav-bar[^>]*\bpill(?:\s|=|\/)/)
})
