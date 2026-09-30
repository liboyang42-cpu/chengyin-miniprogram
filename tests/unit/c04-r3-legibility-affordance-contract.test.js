// H10:订单详情正文与逻辑已搬到 components/cy/scene-member-order-detail(页面退化成深链薄壳),
// 断言随之指向组件文件;判据本身一条没放宽。
// C04 R3:复拍实图带出的三处「排版/可见性」缺陷契约。
//
// 基线图:~/Desktop/C04复拍_9692_20260730
//   P1a / 03 orderinfo —— 正文末行只剩一个「入」字(孤字)。
//   09      mytemplate —— 列表行 `⋯` 在深色卡上几近不可见(命中区其实已达标,是字形隐形)。
//   10      complaint  —— 副标题顶到右边缘;直达路由时左上 chevron 点不动。
//
// 取向:能驱动的走行为级(真装载页面、真调 handler、断言导航 API / 文案分档);
// 纯排版事实退回静态断言,但**连它依赖的前提一起断言**——否则改了盒子模型,
// 字数预算就悄悄过期,断言还绿着(那是另一种假绿)。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = s => s.replace(/<!--[\s\S]*?-->/g, '')
const rule = (wxss, selector) => {
  const i = wxss.indexOf(selector + '{') >= 0 ? wxss.indexOf(selector + '{') : wxss.indexOf(selector + ' {')
  assert.notEqual(i, -1, `选择器锚点失效: ${selector}`)
  return wxss.slice(i, wxss.indexOf('}', i) + 1)
}

const ORDERINFO = 'components/cy/scene-member-order-detail/index'
const COMPLAINT = 'subpackageMember/complaint/index'
const MEMBER_HOME = '/pages/member/index/index'

// ————— 受控装载(录导航调用;跨 realm 的 options 复制回本 realm) —————
function loadPage(pageRelDir, source, stack) {
  const sandbox = { requests: [], nav: [], toasts: [], timers: [] }
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: r => sandbox.requests.push(r),
    tips: m => sandbox.toasts.push(m),
  }
  const nav = api => options => sandbox.nav.push({ api, options: options ? Object.assign({}, options) : options })
  const ctx = {
    getApp: () => app,
    Page: cfg => { sandbox.pageConfig = cfg },
    // H10 后订单详情是 Component:摊平成 Page 的形状,断言逐字不变。
    Component: cfg => { sandbox.pageConfig = flattenComponentToPage(cfg) },
    getCurrentPages: () => stack.map(route => ({ route })),
    wx: {
      navigateBack: nav('navigateBack'), redirectTo: nav('redirectTo'), navigateTo: nav('navigateTo'),
      reLaunch: nav('reLaunch'), switchTab: nav('switchTab'),
      showToast: o => sandbox.toasts.push(o && o.title), showLoading() {}, hideLoading() {}, showModal() {},
      stopPullDownRefresh() {}, vibrateShort() {},
    },
    require: id => (id.startsWith('.') ? require(path.resolve(ROOT, pageRelDir, id)) : require(id)),
    module: { exports: {} }, exports: {}, console,
    // 可控 setTimeout(fake timer):记下回调与延时,由测试用 flushTimers 显式推进。
    // vm context 默认没有 setTimeout,必须显式注入,否则被测代码里那一跳直接抛错。
    setTimeout: (fn, ms) => { sandbox.timers.push({ fn, ms }); return sandbox.timers.length },
    clearTimeout: () => {},
  }
  vm.createContext(ctx)
  vm.runInContext(source, ctx, { filename: path.join(ROOT, pageRelDir, 'under-test.js') })
  assert.ok(sandbox.pageConfig, `${pageRelDir} 未调用 Page()`)
  const page = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  page.data = Object.assign({}, sandbox.pageConfig.data)
  return { page, sandbox }
}
// require 的相对路径按**源文件自己的位置**解析 —— 这里装的是组件源码,不是页面壳。
// 2026-08-07 前传的是页面目录 subpackageMember/orderinfo,能跑通只因为它跟组件目录恰好同深度;
// 页面搬进 subpackageMember/ 少了一层后就解析到仓库外去了。
const loadOrderInfo = (stack = [ORDERINFO], src = read(`${ORDERINFO}.js`)) =>
  loadPage(path.dirname(ORDERINFO), src, stack)
const loadComplaint = (stack = [COMPLAINT], src = read(`${COMPLAINT}.js`)) =>
  loadPage('subpackageMember/complaint', src, stack)

// CJK 单行字数预算:全角字宽 ≈ 1em,故 可用宽 / 字号 = 一行放得下的字数。
const cjkBudget = (innerRpx, fontRpx) => Math.floor(innerRpx / fontRpx)
const countChars = s => Array.from(s).length

// ============================================================
// R3-1 orderinfo:失败正文必须单行收尾,不留孤字
// ============================================================

// 预算前提(改了盒子/字号就必须重算,否则下面的字数断言会悄悄过期):
//   稿 356:5220 之后原因落在 cy-result-sheet 的 .rs__reason:宽 672rpx(稿 336px),左右内距 space-3 = 24rpx
//   ⇒ 内宽 672-48 = 624rpx
//   2026-09-15 集成总线(order-detail × dialog-contract 语义冲突 X1):T4 按稿 356-5220 把原因条字号改成
//   --cy-comp-result-fail-reason-size = 27rpx(13.5px),预算随之重算 floor(624/27) = 23 字;约束不降,只换依据。
const ORDERINFO_INNER_RPX = 672 - 2 * 24
const ORDERINFO_FONT_RPX = 27
const ORDERINFO_LINE_BUDGET = cjkBudget(ORDERINFO_INNER_RPX, ORDERINFO_FONT_RPX) // 23

const assertReasonBox = (sheetWxss, tokens) => {
  const box = rule(sheetWxss, '.rs__reason')
  assert.match(box, /(?:^|\n)\s*width:\s*672rpx/, '内宽推导依赖 672rpx')
  assert.match(box, /padding:\s*var\(--cy-space-2\)\s+var\(--cy-space-3\)/, '内宽推导依赖左右 space-3')
  assert.match(box, /box-sizing:\s*border-box/)
  assert.match(box, /font-size:\s*var\(--cy-comp-result-fail-reason-size\)/, '字数预算依赖原因条专用字号 token')
  assert.match(tokens, /--cy-comp-result-fail-reason-size:\s*(?:calc\()?27rpx(?:\s*\*\s*var\(--cy-type-scale\)\))?/, '字数预算依赖 reason-size = 27rpx(稿 13.5px)')
  assert.match(tokens, /--cy-space-3:\s*24rpx/, '字数预算依赖 space-3 = 24rpx')
}

test('R3-1 前提:失败原因行的盒子与字号仍是字数预算所依据的那一套', () => {
  assert.match(read(`${ORDERINFO}.wxml`), /<cy-result-sheet\b[^>]*why="\{\{loadErrorText\}\}"/)
  assertReasonBox(read('components/cy/result-sheet/index.wxss'), read('style/tokens.wxss'))
  assert.equal(ORDERINFO_LINE_BUDGET, 23)
})

test('negative control: 原因行内距改大时,失败正文预算前提必须判红', () => {
  const sheetWxss = read('components/cy/result-sheet/index.wxss')
  const mutated = sheetWxss.replace('padding: var(--cy-space-2) var(--cy-space-3);', 'padding: var(--cy-space-2) var(--cy-space-5);')
  assert.notEqual(mutated, sheetWxss, '变异锚点失效:未找到 .rs__reason 内距声明')
  assert.throws(() => assertReasonBox(mutated, read('style/tokens.wxss')), assert.AssertionError)
})

test('negative control: 原因条字号 token 改回 24rpx 或改用 type-label 时,预算前提必须判红', () => {
  const sheetWxss = read('components/cy/result-sheet/index.wxss')
  const tokens = read('style/tokens.wxss')
  const mutatedTokens = tokens.replace(/(--cy-comp-result-fail-reason-size:\s*calc\()27rpx/g, '$124rpx')
  assert.notEqual(mutatedTokens, tokens, '变异锚点失效:未找到 reason-size token')
  assert.throws(() => assertReasonBox(sheetWxss, mutatedTokens), assert.AssertionError)
  const mutatedSheet = sheetWxss.replace('font-size: var(--cy-comp-result-fail-reason-size);', 'font-size: var(--cy-type-label);')
  assert.notEqual(mutatedSheet, sheetWxss, '变异锚点失效:未找到 .rs__reason 字号声明')
  assert.throws(() => assertReasonBox(mutatedSheet, tokens), assert.AssertionError)
})

test('R3-1 缺参数失败正文在 375px 下放得下单行(无孤字),只说原因', () => {
  const { page } = loadOrderInfo()
  page.onLoad({})
  const text = page.data.loadErrorText
  assert.ok(
    countChars(text) <= ORDERINFO_LINE_BUDGET,
    `失败正文 ${countChars(text)} 字 > 一行 ${ORDERINFO_LINE_BUDGET} 字预算,375px 下会折行并留下孤字:「${text}」`,
  )
  // 真实性不许因为缩短而丢:原因要在。
  // 2026-09-15 T3f 总控裁决:面板 2s 自动回订单列表,「请返回订单列表重新进入」这句指令多余,只说原因。
  assert.match(text, /订单参数缺失/, '必须说清原因')
  assert.doesNotMatch(text, /重新进入|请返回/, '面板会自动返回,不再叫用户自己返回')
})

test('R3-1 失败正文不得复述卡标题(重复才是字数超标的根因)', () => {
  const { page } = loadOrderInfo()
  page.onLoad({})
  const wxml = read(`${ORDERINFO}.wxml`)
  assert.match(wxml, /title="加载失败"/, '面板标题锚点失效')
  assert.doesNotMatch(
    page.data.loadErrorText, /加载失败|无法加载订单详情/,
    '原因行复述面板标题「加载失败」,重复占掉了整行预算',
  )
})

test('负控 R3-1:把失败正文改回 27 字的旧文案,单行预算必须判红', () => {
  const src = read(`${ORDERINFO}.js`)
  const OLD = '订单参数缺失，无法加载订单详情，请返回订单列表重新进入'
  const mutated = src.replace(/'订单参数缺失[^']*'/, `'${OLD}'`)
  assert.notEqual(mutated, src, '变异锚点失效:未找到 loadErrorText')
  const { page } = loadOrderInfo([ORDERINFO], mutated)
  page.onLoad({})
  assert.equal(countChars(page.data.loadErrorText), 27, '变异体应为 27 字旧文案')
  assert.throws(
    () => assert.ok(countChars(page.data.loadErrorText) <= ORDERINFO_LINE_BUDGET),
    assert.AssertionError,
    '旧文案超一行预算,必须判红',
  )
})

test('R3-1 R2 的恢复行为未被本轮改动波及', () => {
  // H10 之后:正文在组件里,而「返回订单列表」的导航语义留在深链薄壳上
  // (弹窗里它是 triggerEvent('back') 回上一层场景)。这里验的是壳那一半。
  const SHELL = 'subpackageMember/orderinfo/orderinfo'
  const { page, sandbox } = loadPage('subpackageMember/orderinfo', read(`${SHELL}.js`), [SHELL])
  page.onLoad({})
  page.backToOrderList()
  assert.deepEqual(sandbox.nav, [{ api: 'redirectTo', options: { url: '/subpackageMember/order/order' } }])
})

// ============================================================
// R3-2 mytemplate:44pt 靶要有**看得见**的可点提示
// ============================================================

function assertDotAffordance(wxml, wxss) {
  const box = rule(wxss, '.project .activity-list .li .item .item-txt2 .item-tit .dot')
  // 命中区(R1 已达标)不许被本轮改小
  assert.match(box, /width:\s*88rpx/, '更多钮命中区必须保持 88rpx = 44pt')
  assert.match(box, /height:\s*88rpx/, '更多钮命中区必须保持 88rpx = 44pt')
  // 图标可见性由父级 color 驱动:cy-icon 是 mask + background-color: currentColor
  assert.match(box, /color:\s*var\(--cy-text-title\)/, 'cy-icon 取 currentColor,父级必须给 token 色')
  /* ⚠️ 2026-07-31 用户明确要求「删除三个点的圆圈背景」,推翻了 R4 依据决策表 §12.2 加的
     「一档实心底 + pill 圆角」。这是一次**有意的产品覆盖**,不是回潮:
       · 保留的 a11y 保障:88rpx=44pt 命中区(上面两条)、token 驱动的图标对比度(上一条)、
         aria-role/aria-label/bindtap(下面几条)
       · 放弃的:靶自身的可见底面(§12.2)
     故这里改成断言「确实没有底面」,把这个决定钉住,防止后人当成 bug 又加回来;
     若产品改主意要恢复,连同本注释一起改。 */
  assert.doesNotMatch(box, /background:/, '用户要求去掉圆形背景(覆盖 §12.2 可见底面)')
  assert.doesNotMatch(box, /border-radius:/, '圆底既然去掉,pill 圆角一并不留')
  assert.doesNotMatch(box, /border:/, '§3.5:不叠描边')
  // 字形必须用**已注册的图标库**,不许 CSS / 伪元素手绘假图标
  const bare = stripComments(wxml)
  assert.doesNotMatch(
    bare, /class="dot flex-cc"[\s\S]{0,200}?icon_dot\.png/,
    '近黑色 icon_dot.png 压在深色卡上等于隐形,本页不得再用它当更多钮字形',
  )
  assert.match(bare, /<cy-icon\s+name="more"\s+size="40"\s*\/>/, '更多钮字形必须是已注册的 cy-icon name="more"')
  assert.doesNotMatch(wxss, /\.dot-glyph/, '禁止用 CSS/伪元素伪造可见图标(产品设计约束)')
  assert.match(read('components/cy/icon/icons.wxss'), /\.cyi--more\s*\{/, 'cyi--more 必须在图标库里已注册')
  assert.match(
    read('subpackageMember/mytemplate/mytemplate.json'), /"cy-icon":\s*"\/components\/cy\/icon\/index"/,
    'cy-icon 必须在本页 usingComponents 注册',
  )
  // 无障碍语义不许丢
  assert.match(bare, /class="dot flex-cc"[^>]*aria-role="button"/)
  assert.match(bare, /class="dot flex-cc"[^>]*aria-label="更多操作"/)
  assert.match(bare, /class="dot flex-cc"[^>]*bindtap="toggleDropdown"/)
}

test('R3-2 mytemplate 更多钮:88pt 靶 + 可见底面 + token 化三点字形', () => {
  assertDotAffordance(read('subpackageMember/mytemplate/mytemplate.wxml'), read('subpackageMember/mytemplate/mytemplate.wxss'))
})

test('负控 R3-2:把更多钮字形改回近黑 icon_dot.png,可见性必须判红', () => {
  const wxml = read('subpackageMember/mytemplate/mytemplate.wxml')
  const wxss = read('subpackageMember/mytemplate/mytemplate.wxss')
  const mutated = stripComments(wxml).replace(
    /<cy-icon\s+name="more"\s+size="40"\s*\/>/,
    '<image lazy-load="true" src="/pages/square/images/icon_dot.png" mode="widthFix" />',
  )
  assert.notEqual(mutated, stripComments(wxml), '变异锚点失效:未找到 cy-icon name="more"')
  assert.throws(() => assertDotAffordance(mutated, wxss), assert.AssertionError)
})

test('负控 R3-2:抽掉父级 color(图标退回不可见)必须判红', () => {
  const wxml = read('subpackageMember/mytemplate/mytemplate.wxml')
  const wxss = read('subpackageMember/mytemplate/mytemplate.wxss')
  const mutated = wxss.replace(/(\.dot\s*\{[^}]*?)\n\s*color:\s*var\(--cy-text-title\);/, '$1')
  assert.notEqual(mutated, wxss, '变异锚点失效:未找到 .dot 的 color')
  assert.throws(() => assertDotAffordance(wxml, mutated), assert.AssertionError)
})

// ============================================================
// R3-3a complaint:直达路由也必须真的退得出去
// ============================================================

test('R3-3a 直达进入(栈长 1)点返回 → 落到会员中心,而不是原地不动', () => {
  const { page, sandbox } = loadComplaint([COMPLAINT])
  page.onBack()
  assert.deepEqual(sandbox.nav, [{ api: 'switchTab', options: { url: MEMBER_HOME } }])
})

test('R3-3a 从会员中心进来(栈长 2)点返回 → 回退一层,不越级跳 tab', () => {
  const { page, sandbox } = loadComplaint(['pages/member/index/index', COMPLAINT])
  page.onBack()
  assert.deepEqual(sandbox.nav, [{ api: 'navigateBack', options: { delta: 1 } }])
})

test('R3-3a 返回由页面接管(裸 cy-nav-bar 在栈长 1 时点不动)', () => {
  const bare = stripComments(read(`${COMPLAINT}.wxml`))
  const navTag = bare.match(/<cy-nav-bar[^>]*\/?>/)
  assert.ok(navTag, '缺少 cy-nav-bar')
  assert.match(navTag[0], /custom-back/, '必须由页面接管返回')
  assert.match(navTag[0], /bind:back="onBack"/, '必须接到本页 onBack')
})

test('负控 R3-3a:去掉栈长兜底分支后,直达路由必须判红', () => {
  const src = read(`${COMPLAINT}.js`)
  const mutated = src.replace(
    /  onBack\(\) \{[\s\S]*?\n  \},\n/,
    '  onBack() {\n    wx.navigateBack({ delta: 1 });\n  },\n',
  )
  assert.notEqual(mutated, src, '变异锚点失效:未找到 complaint.onBack')
  const { page, sandbox } = loadComplaint([COMPLAINT], mutated)
  page.onBack()
  assert.throws(
    () => assert.deepEqual(sandbox.nav, [{ api: 'switchTab', options: { url: MEMBER_HOME } }]),
    assert.AssertionError,
    '没有兜底时直达路由退不出去,必须判红',
  )
})

test('负控 R3-3a:把导航条改回裸 cy-nav-bar 必须判红', () => {
  const bare = stripComments(read(`${COMPLAINT}.wxml`))
  const mutated = bare.replace(/<cy-nav-bar[^>]*\/>/, '<cy-nav-bar />')
  assert.notEqual(mutated, bare, '变异锚点失效:未找到 cy-nav-bar')
  const navTag = mutated.match(/<cy-nav-bar[^>]*\/?>/)
  assert.throws(() => assert.match(navTag[0], /custom-back/), assert.AssertionError)
})

// ============================================================
// R3-3b complaint:页头副标题不许吃满整行
// ============================================================

// 预算前提:cy-page-title 的 .pt padding 左右各 --cy-page-x(32rpx) ⇒ 内宽 750-64 = 686rpx;
//           .pt__sub font-size = --cy-font-body = --cy-type-body = 28rpx ⇒ 一行 floor(686/28) = 24 字
const SUB_INNER_RPX = 750 - 2 * 32
const SUB_FONT_RPX = 28
const SUB_LINE_BUDGET = cjkBudget(SUB_INNER_RPX, SUB_FONT_RPX) // 24

test('R3-3b 前提:cy-page-title 的内距与副标题字号仍是预算所依据的那一套', () => {
  const wxss = read('components/cy/page-title/index.wxss')
  assert.match(rule(wxss, '.pt'), /padding:\s*0\s+var\(--cy-page-x\)/)
  assert.match(rule(wxss, '.pt__sub'), /font-size:\s*var\(--cy-font-body\)/)
  assert.match(read('style/tokens.wxss'), /--cy-type-body:\s*(?:calc\()?28rpx(?:\s\*\s*var\(--cy-type-scale\)\))?/)
  assert.match(read('style/tokens.wxss'), /--cy-page-x:\s*32rpx/)
  assert.equal(SUB_LINE_BUDGET, 24)
})

const complaintSubtitle = () => {
  const tag = stripComments(read(`${COMPLAINT}.wxml`)).match(/<cy-page-title[^>]*\/>/)
  assert.ok(tag, '缺少 cy-page-title')
  const m = tag[0].match(/subtitle="([^"]*)"/)
  assert.ok(m, 'cy-page-title 缺少 subtitle')
  return m[1]
}

test('R3-3b 页头副标题留有余量,不贴右边缘', () => {
  const sub = complaintSubtitle()
  assert.ok(
    countChars(sub) < SUB_LINE_BUDGET,
    `副标题 ${countChars(sub)} 字,一行预算 ${SUB_LINE_BUDGET} 字 —— 吃满或超出就是视觉上的「顶到右边缘」:「${sub}」`,
  )
  assert.match(sub, /已报名并支付/, '「仅限已报名并支付的活动」这条限制不许丢')
  assert.match(sub, /介入处理/, '「平台会介入处理」这条承诺不许丢')
})

test('R3-3b 页头副标题与空态副文案不再逐字重复', () => {
  const wxml = stripComments(read(`${COMPLAINT}.wxml`))
  const sub = complaintSubtitle()
  const emptyTag = wxml.match(/<cy-empty[^>]*kind="empty"[\s\S]*?\/>/)
  assert.ok(emptyTag, '缺少空态')
  assert.doesNotMatch(emptyTag[0], new RegExp(sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('负控 R3-3b:把副标题改回 25 字旧文案,余量断言必须判红', () => {
  const OLD = '投诉需针对你已报名并支付的活动，平台受理后介入处理'
  assert.equal(countChars(OLD), 25, '旧文案应为 25 字(超一行 24 字预算)')
  assert.throws(() => assert.ok(countChars(OLD) < SUB_LINE_BUDGET), assert.AssertionError)
})

// R4-C04:提交成功后的那一跳原为裸 wx.navigateBack() —— 直达进来栈长为 1 时什么都不发生,
// 用户被留在已提交的表单上。必须复用 onBack() 的栈长兜底,与导航条返回同一条路径。
function assertSubmitSuccessExit(js) {
  assert.match(js, /setTimeout\(function \(\) \{ that\.onBack\(\); \}, 1200\)/,
    '提交成功后必须走 onBack()(带栈长兜底),不能裸 navigateBack')
  assert.doesNotMatch(js, /setTimeout\(function \(\) \{ wx\.navigateBack\(\); \}/,
    '裸 navigateBack 在直达栈首是空操作,不得回潮')
}

test('R4 投诉提交成功后的退出复用 onBack,直达栈首也有出口', () => {
  assertSubmitSuccessExit(read(`${COMPLAINT}.js`))
})

/**
 * 真跑一遍「提交成功 → 1200ms 后退出」:栈首(栈长 1)下必须落到 switchTab 会员中心。
 * 只有把 success 回调和定时器回调都真触发,才证明那一跳不是空操作 —— 正则只能证明写法。
 * @param {string} src 被测源码(原文或变异体)
 */
function runSubmitSuccessAtStackHead(src) {
  const { page, sandbox } = loadComplaint([COMPLAINT], src)
  page.onLoad()
  // 可投诉对象来自第一条请求;按 loadTopics 的真实口径构造(仅 registrationStatus===2 计入)
  sandbox.requests[0].success({
    code: '200',
    data: [{ topicId: 9, topicName: '城市路线 A' }],
  })
  // 逐字段比对:topics 数组是在 vm realm 里建的,deepStrictEqual 会因原型不同而误报
  assert.equal(page.data.topics.length, 1, '可投诉对象未装载')
  assert.equal(page.data.topics[0].id, 9)
  assert.equal(page.data.topics[0].name, '城市路线 A')
  page.data.topicIndex = 0
  page.data.reason = '商家未按约定时间接待,现场等待超过一小时'
  page.submit()

  const report = sandbox.requests[sandbox.requests.length - 1]
  assert.match(report.url, /complaint\/report/, '未捕获到投诉提交请求')
  report.success({ code: 200 })
  assert.ok(sandbox.toasts.includes('投诉已提交'), '成功提示必须先出现')

  // 此刻退出还没发生,全靠那个 1200ms 回调
  assert.deepEqual(sandbox.nav, [], '退出必须等到定时器回调,不能立即跳')
  assert.equal(sandbox.timers.length, 1, '成功后应排入一个退出定时器')
  assert.equal(sandbox.timers[0].ms, 1200)
  sandbox.timers[0].fn()   // 推进 fake timer
  return sandbox
}

test('R4 行为级:提交成功 1200ms 后在栈首真的退出到会员中心', () => {
  const sandbox = runSubmitSuccessAtStackHead(read(`${COMPLAINT}.js`))
  assert.deepEqual(sandbox.nav, [{ api: 'switchTab', options: { url: MEMBER_HOME } }],
    '栈首提交成功后必须经 onBack 兜底落到会员中心')
})

test('负控 R4 行为级:成功回调退回裸 navigateBack 时,栈首退出必须行为失败', () => {
  const src = read(`${COMPLAINT}.js`)
  const mutated = src.replace(
    'setTimeout(function () { that.onBack(); }, 1200)',
    'setTimeout(function () { wx.navigateBack(); }, 1200)',
  )
  assert.notEqual(mutated, src, '变异锚点失效:未找到提交成功后的退出跳转')
  const sandbox = runSubmitSuccessAtStackHead(mutated)
  // 变异体在栈首只会发一个无效的 navigateBack,而不是 switchTab
  assert.deepEqual(sandbox.nav, [{ api: 'navigateBack', options: undefined }],
    '变异体应退化为裸 navigateBack')
  assert.throws(
    () => assert.deepEqual(sandbox.nav, [{ api: 'switchTab', options: { url: MEMBER_HOME } }]),
    assert.AssertionError,
    '栈首退不出去时必须判红',
  )
})

test('负控 R4:提交成功后退回裸 navigateBack 必须判红', () => {
  const src = read(`${COMPLAINT}.js`)
  const mutated = src.replace(
    'setTimeout(function () { that.onBack(); }, 1200)',
    'setTimeout(function () { wx.navigateBack(); }, 1200)',
  )
  assert.notEqual(mutated, src, '变异锚点失效:未找到提交成功后的退出跳转')
  assert.throws(() => assertSubmitSuccessExit(mutated), assert.AssertionError)
})

test('R3-3b 过期登录错误态与重试未被本轮改动波及', () => {
  const wxml = stripComments(read(`${COMPLAINT}.wxml`))
  // aaa 三件套(整屏空态补 fill+size=lg)后属性顺序变了，正则放宽到"包含"而非"紧邻"，断言意图不变
  assert.match(wxml, /<cy-error\b[^>]*\btitle="可投诉活动没能加载出来"[^>]*\bsub="\{\{errorMsg\}\}"[^>]*\bbind:retry="onRetry"[^>]*\/>/)
  const { page, sandbox } = loadComplaint([COMPLAINT])
  page.onLoad()
  assert.equal(sandbox.requests.length, 1)
  sandbox.requests[0].successStatusAbnormal({ code: 401, msg: '登录已过期，请重新进入' })
  assert.equal(page.data.loading, false)
  assert.equal(page.data.errorMsg, '登录已过期，请重新进入', '后端错误文案必须原样透传')
  page.onRetry()
  assert.equal(page.data.loading, true)
  assert.equal(sandbox.requests.length, 2, '重试必须真的重新发请求')
})
