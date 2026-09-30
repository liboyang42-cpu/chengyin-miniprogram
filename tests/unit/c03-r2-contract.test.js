// C03-R2:真实复拍(~/Desktop/城瘾_UI_C03_复拍_20260730_053425)暴露出的四类缺陷的守卫。
// 判据真源:vault《小程序_UI_第1轮_C03_..._优化文档_20260729.md》§10。
//
// 覆盖:
//  ① infomation 列表:副标题与标题逐字相同 = 零信息量的第二行,不渲染;
//     title/contents 缺失的行不可点(点进去是空详情),给显式状态 —— 但绝不按「标题看着没意义」隐藏行。
//  ② 退出账号可逆 ⇒ 不得用 danger 红;红只留给注销(deregister)。
//  ③ 返回可达性:cy-nav-bar 的箭头无条件渲染,而组件内 onBack 在页面栈只有 1 页时什么都不做
//     ⇒ 深链/扫码直达时是个死控件。C03 每个 L2 页必须自己接管并带 switchTab 兜底。
//  ④ 组件属性不得收到 null(roleBadge.role / cy-page-title.title),以及 gerenziliao 底栏占位
//     必须等于该页底栏真实高度(全局规范 G5 无门禁,只能靠这条守卫)。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => readResolved(p)
// 断言「模板里有没有真的用到某个东西」时必须先去掉注释:
// 否则一句解释性注释(例如「别改回 .sz-bottom-btn」)就会把 doesNotMatch 判红 —— 假红。
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')

let sandbox

beforeEach(() => {
  sandbox = { requests: [], toasts: [], navBacks: [], switchTabs: [], navigates: [] }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
    tips: (m) => sandbox.toasts.push(m),
    sendRequest: (options) => { sandbox.requests.push(options) },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback || '未知错误',
    getPageSize: () => 10,
    hasPendingPrivacyAuthorization: () => false,
    recordConsent: () => Promise.resolve(),
    resolvePrivacyAuthorization() {},
  })
  global.Page = (config) => { sandbox.pageConfig = config }
  global.Component = (config) => { sandbox.componentConfig = config }
  global.wx = {
    showToast: (o) => sandbox.toasts.push(o && o.title),
    hideLoading() {}, showLoading() {}, showModal() {},
    navigateTo: (o) => sandbox.navigates.push(o && o.url),
    navigateBack: (o) => sandbox.navBacks.push(o || {}),
    switchTab: (o) => sandbox.switchTabs.push(o && o.url),
    reLaunch: (o) => sandbox.navigates.push(o && o.url),
    setNavigationBarTitle() {},
    stopPullDownRefresh() {}, stopLocationUpdate() {},
    getWindowInfo: () => ({ windowWidth: 375 }),
    getSystemInfoSync: () => ({ windowWidth: 375 }),
    openPrivacyContract() {},
  }
})

function loadPage(rel) {
  const abs = path.join(ROOT, rel)
  delete require.cache[require.resolve(abs)]
  require(abs)
  const vm = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.pageConfig.data || {}))
  return vm
}

/* ---------- ① infomation 列表渲染契约 ---------- */

const INFO_JS = 'subpackageA/pages/infomation/infomation.js'
const INFO_WXML = 'subpackageA/pages/infomation/infomation.wxml'

// 数据契约来自后端 CmsInfomation{ id, title, subtitle, sortId, contents }
// (ApiCommonController#infomationList → selectCmsInfomationList,Mapper 的 select 含 contents)
function runInfoList(rows) {
  const vm = loadPage(INFO_JS)
  vm.getList()
  const req = sandbox.requests.find((r) => r.url === '/api/common/infomation_list')
  assert.ok(req, '必须走 /api/common/infomation_list')
  req.success({ code: '200', data: rows })
  if (req.complete) req.complete()
  return vm.data.list
}

test('① 副标题与标题逐字相同时不渲染第二行(同一个值印两遍 = 零信息量)', () => {
  // 这就是复拍图 09 上的真实脏数据行
  const [row] = runInfoList([{ id: 7, title: '11', subtitle: '11', contents: '<p>正文</p>' }])
  assert.equal(row.title, '11', '标题是真实数据,不许被代码改写或编造')
  assert.equal(row.description, '', 'subtitle 与 title 相同 ⇒ 摘要不渲染')
})

test('① 副标题有独立内容时正常作为摘要渲染', () => {
  const [row] = runInfoList([{ id: 1, title: '城市定向怎么玩', subtitle: '三分钟上手', contents: '<p>x</p>' }])
  assert.equal(row.title, '城市定向怎么玩')
  assert.equal(row.description, '三分钟上手')
})

test('① title/subtitle 前后空白要 trim,空白副标题不占一行', () => {
  const [row] = runInfoList([{ id: 2, title: '  玩法  ', subtitle: '   ', contents: 'x' }])
  assert.equal(row.title, '玩法')
  assert.equal(row.description, '')
})

test('① contents 为空 ⇒ 该行不可用(点进去是空详情),必须给显式状态而不是死链', () => {
  const [row] = runInfoList([{ id: 3, title: '有标题没正文', subtitle: '', contents: '   ' }])
  assert.equal(row.usable, false)
})

test('① title 为空 ⇒ 不可用', () => {
  const [row] = runInfoList([{ id: 4, title: '', subtitle: '摘要', contents: '<p>有正文</p>' }])
  assert.equal(row.usable, false)
})

// ⚠️ 决策反转(R3,2026-07-30):R2 这条原本断言「title=subtitle='11' 但字段齐全 ⇒ 仍可用」,
//    理由是「标题看着没意义」不可作判据。总控逐张看过 R2 真实图后裁决:剩下那个可点的「11」
//    仍是不专业的无语义内容,须收紧为「**纯数字标题且无可区分副标题**」判不可读。
//    那不是「按观感隐藏」,而是一条可判定的契约规则 ⇒ 本条改为断言新规则。
//    「不得笼统过滤数字」这层保护没有丢,由 c03-r3-contract.test.js 的 2024/新手指南/72小时
//    三条正例继续钉住。
test('① 纯数字标题且无可区分副标题 ⇒ 不可读(R3 收紧;原 R2 判可用已被裁决推翻)', () => {
  const [row] = runInfoList([{ id: 5, title: '11', subtitle: '11', contents: '<p>真的有正文</p>' }])
  assert.equal(row.usable, false)
  assert.equal(row.title, '11', '仍不改写真实数据 —— 只是不做成可点死链')
})

test('① 但数值命名 + 有效副标题必须保留,不许笼统过滤数字', () => {
  const [row] = runInfoList([{ id: 9, title: '2024', subtitle: '年度城市定向回顾', contents: '<p>x</p>' }])
  assert.equal(row.usable, true)
})

test('① 不可用行在 WXML 上不可点且无 chevron,并带显式状态说明', () => {
  const wxml = read(INFO_WXML)
  assert.match(wxml, /item\.usable/, 'WXML 必须消费 usable 分流两种渲染')
  const unusable = wxml.split('item.usable').slice(1).join('')
  assert.match(unusable, /disabled/, '不可用行必须 disabled(不可点)')
  assert.match(unusable, /arrow="\{\{\s*false\s*\}\}"/, '不可用行不得留 chevron(暗示可点)')
  // R3 起文案统一为「内容待完善，暂不可查看」(原「内容未配置」)
  assert.match(unusable, /内容待完善/, '必须给显式状态说明,不能只是空着')
})

test('① 空列表仍然走 cy-empty 且 nodata 真被消费(R1 已修,别回退)', () => {
  assert.match(stripComments(read(INFO_WXML)), /<cy-empty[^>]*wx:if="\{\{nodata\}\}"/,
    'cy-empty 必须由 nodata 驱动 —— 它曾经只在 JS 里算、WXML 从不消费')
  const vm = loadPage(INFO_JS)
  vm.getList()
  const req = sandbox.requests.find((r) => r.url === '/api/common/infomation_list')
  req.success({ code: '200', data: [] })
  req.complete()
  assert.deepEqual(vm.data.list, [])
  assert.equal(vm.data.nodata, true, '空列表必须把 nodata 置真,否则空态不渲染')
})

/* ---------- ② 退出账号 = 可逆 ⇒ 中性;红只留给注销 ---------- */

test('② 退出账号不得用 danger 红(可逆操作)', () => {
  const wxml = read('pages/shezhi/shezhi.wxml')
  const logoutBlock = wxml.slice(wxml.indexOf('sz-logout'), wxml.indexOf('sz-logout') + 400)
  assert.ok(logoutBlock.includes('退出账号'), '定位到退出账号块')
  assert.doesNotMatch(logoutBlock, /variant="danger"/, '退出登录可逆,不得用危险语义')
  assert.match(logoutBlock, /variant="secondary"/, '应为中性动作语义')
})

test('② 注销(不可逆)必须保留 danger 红 —— 红色语义不能被清空', () => {
  assert.match(read('components/cy/scene-settings-deregister/index.wxml'), /variant="danger"/,
    'deregister 的确认注销必须仍是 danger,否则整组没有任何红色破坏语义了')
})

test('② 页面侧不得改回 .sz-bottom-btn 类名(会被 style/components.wxss 的 !important 钉成红实底)', () => {
  assert.doesNotMatch(stripComments(read('pages/shezhi/shezhi.wxml')), /class="[^"]*sz-bottom-btn/)
  assert.doesNotMatch(read('pages/shezhi/shezhi.wxss'), /^\s*\.sz-bottom-btn\s*\{/m)
})

/* ---------- ③ 导航:守卫已迁到 R3/R4,本文件不再重复 ----------
 *
 * ⚠️ 本段注释在 R3 之后已更新过一次。R2 当时的结论是「深链可达性无证据 ⇒ 不动、不设守卫」。
 *
 * R3(2026-07-30)取到了证据并**已经改了**:
 *   · 三个真·二级页的 caller 全是 navigateTo —— agreement ← shezhi.js:125 / deregister/index.js:49;
 *     address ← activity/baoming/baoming.js:310;infomationdetail ← infomation.js:71,
 *     且 infomationdetail 自身 onShareAppMessage 把该路由做成分享 path ⇒ 分享点开即栈首页(硬证据)。
 *   · 这三页已加 custom-back + bind:back,fallback 落到各自功能上说得通的无参路由。
 * R4 又修了 agreement 的兜底丢上下文问题(按 ?type= 分流回 shezhi / deregister)。
 *
 * ⇒ 导航相关断言的真源是 **tests/unit/c03-r3-contract.test.js 的 B / B-R4 两段**,
 *   本文件不重复设断言(避免同一条规则两处漂移)。C03 其余页面仍未取到深链证据,仍不处理。
 */

/* ---------- ④ 组件属性不得为 null + 底栏占位必须等于底栏实高 ---------- */

test('④ cy-page-title 的 title 不得收到 null(agreement 首帧 doc 为 null)', () => {
  const wxml = read('pages/agreement/index.wxml')
  assert.doesNotMatch(wxml, /title="\{\{doc\.title\}\}"/, 'doc 初值为 null,直接取 doc.title 会传 null 并告警')
  assert.match(wxml, /title="\{\{doc \? doc\.title : ''\}\}"/, '需空串兜底(仍绑 doc.title,不许写死标题:本页也承载《账号注销须知》)')
  // 行为侧:onLoad 前 data.doc 必须是可安全取值的形态
  const vm = loadPage('pages/agreement/index.js')
  assert.ok(!vm.data.doc || typeof vm.data.doc.title === 'string')
})

test('④ agreement 标题仍随 ?type= 变化(不许为了消告警写死)', () => {
  const vm = loadPage('pages/agreement/index.js')
  vm.onLoad({ type: 'cancellation_notice' })
  assert.equal(vm.data.doc.title, '账号注销须知')
  const vm2 = loadPage('pages/agreement/index.js')
  vm2.onLoad({})
  assert.equal(vm2.data.doc.title, '用户服务协议')
})

test('④ roleBadge 的 role 不得收到 null(未登录时 userInfo.role 为空)', () => {
  const wxml = read('pages/member/index/index.wxml')
  assert.match(wxml, /<roleBadge role="\{\{userInfo\.role \|\| ''\}\}"/, 'C03 调用方补空串兜底(不动 components/roleBadge)')
})

// ⚠️ R5 变更:本页的自造底栏 .bmbottom 已被删除,保存栏收编 cy-footer-bar
//    (原因:裸 fixed 无 z-index,C03-R4 复拍 S1 里滚到底后整条消失)。
//    「占位必须 ≥ 底栏实高」这条不变量没有丢,已迁到 c03-r5-contract.test.js 的 ④ 段
//    与 c03-r3-contract.test.js 的 D 段(改为对 cy-footer-bar 解算)。
test.skip('④ gerenziliao 底栏占位必须等于 .bmbottom 的真实高度(R5 已迁走,见注释)', () => {
  const wxss = read('pages/gerenziliao/gerenziliao.wxss')
  const hold = /\.gz-footer-hold\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(hold, '必须有占位规则')
  const bar = /\.bmbottom\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(bar, '必须有底栏规则')

  // 底栏实高 = 上内距(--cy-space-4)+ 按钮高 + 下内距(--cy-space-6)+ 安全区。
  // 按钮高不写在 .bmbottom 里,而是内嵌 cy-btn 自己的 --cy-btn-h 默认档 ⇒ 分别断言:
  //  a) .bmbottom 的两档内距与安全区
  for (const tok of ['--cy-space-4', '--cy-space-6']) {
    assert.ok(bar[1].includes(tok), `.bmbottom 应仍使用 ${tok}`)
  }
  assert.match(bar[1], /env\(safe-area-inset-bottom\)/, '.bmbottom 必须自带安全区')
  //  b) .bmbottom 不得覆写 --cy-btn-h,否则按钮实高与占位算式脱钩
  assert.doesNotMatch(bar[1], /--cy-btn-h\s*:/, '.bmbottom 覆写 --cy-btn-h 会让占位算式失真')
  assert.match(stripComments(read('pages/gerenziliao/gerenziliao.wxml')),
    /<view class="bmbottom">\s*<cy-btn/, '底栏内必须是 cy-btn(高度取 --cy-btn-h 默认档)')
  //  c) 占位必须把这四项逐项算齐,且不得借 --cy-comp-footer-h
  //     (那是 cy-footer-bar 的 144rpx+safe;本页底栏 184rpx+safe,差 40rpx 会压住最后一行)
  for (const tok of ['--cy-space-4', '--cy-btn-h', '--cy-space-6']) {
    assert.ok(hold[1].includes(tok), `占位必须包含 ${tok}(与 .bmbottom 同源)`)
  }
  assert.match(hold[1], /env\(safe-area-inset-bottom\)/, '占位必须含安全区')
  assert.doesNotMatch(hold[1], /--cy-comp-footer-h/, '本页底栏不是 cy-footer-bar,借它的高度会短 40rpx')
})

test('④ 用 cy-footer-bar 的两页仍应留 --cy-comp-footer-h 等高空白(别被上一条带偏)', () => {
  assert.match(read('pages/address/address.wxss'), /--cy-comp-footer-h/)
  assert.match(read('pages/addressinfo/addressinfo.wxss'), /--cy-comp-footer-h/)
})
