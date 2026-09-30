// C03-R3:总控逐张打开 C03-R2 真实图后提出的四项。判据真源:vault C03 优化文档 §11。
//
// A) shezhi「退出账号」不再红了但图上近黑不可辨 —— 量化后是「按钮面 1.06:1 + 描边 1.45:1 +
//    未染色的深色图标」三者叠加,不是文字太暗(文字 9.48:1 本就达标)。改法:页面作用域把
//    cy-btn 的 secondary 三个钩子重映射到**已有** token,并给图标补同文件既有的 mono 染色。
// B) agreement / address / infomationdetail 是真·二级页(caller 全是 navigateTo),但
//    cy-nav-bar 的箭头无条件渲染而组件内 onBack 在栈深 1 时不动 ⇒ 栈首页时是死箭头。
//    只对这三页按既有 shezhi 范式接管,fallback 落到各自功能上说得通的无参路由。
// C) 「11」仍可点 ⇒ 收紧为「纯数字标题且无可区分副标题」判不可读,给禁用显式状态;
//    但**不能笼统过滤数字**:2024+有效副标题、非纯数字标题都必须保留。
// D) .gz-footer-hold 用**从现码解算的几何**证明够让最后一项滚过固定栏,不靠首屏截图假设。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

/* ---------- 颜色工具:真算对比度,不靠肉眼也不靠 token 名 ---------- */

const TOKENS = read('style/tokens.wxss')
// 只在夜端 page{} 段里取值(浅色主题块会重定义同名 token)。
// ⚠️ 必须按**行首**定位 `.theme-light` 选择器:文件头部注释里就提到过这个名字,
//    用 indexOf 会把切片截到第 227 字符,后面所有 token 都查不到(实测踩过)。
const LIGHT_AT = /^\.theme-light/m.exec(TOKENS)
const NIGHT = TOKENS.slice(0, LIGHT_AT ? LIGHT_AT.index : TOKENS.length)

function rawToken(name) {
  const re = new RegExp(`${name.replace(/[-]/g, '\\-')}:\\s*([^;]+);`)
  const m = re.exec(NIGHT)
  return m ? m[1].trim() : null
}
// 顺着 var(...) 链解析到字面色值
function resolveToken(name, depth = 0) {
  if (depth > 8) return null
  const v = rawToken(name)
  if (!v) return null
  const varRef = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(v)
  if (varRef) return resolveToken(varRef[1], depth + 1)
  return v
}
function parseColor(s) {
  let m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
  throw new Error(`无法解析色值:${s}`)
}
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
})
function luminance(c) {
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
// 取 .sz-logout 作用域内对某个钩子的重映射目标(页面侧覆写)
function scopedHook(wxss, selector, hook) {
  const block = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g')
  let m, found = null
  while ((m = block.exec(wxss))) {
    const h = new RegExp(`${hook}:\\s*var\\(\\s*(--[a-z0-9-]+)\\s*\\)`).exec(m[1])
    if (h) found = h[1]
  }
  return found
}

/* ---------- A · 退出账号可辨性 ---------- */

const SZ_WXSS = 'pages/shezhi/shezhi.wxss'
const SZ_WXML = 'pages/shezhi/shezhi.wxml'
const PAGE_BG = () => parseColor(resolveToken('--cy-color-bg-page'))

test('A 退出账号仍是中性语义,红只留给注销', () => {
  const logout = stripComments(read(SZ_WXML))
  const seg = logout.slice(logout.indexOf('sz-logout'), logout.indexOf('sz-logout') + 400)
  assert.doesNotMatch(seg, /variant="danger"/, '可逆操作不得用 danger')
  assert.doesNotMatch(seg, /variant="accent"/, '也不得借品牌紫')
  assert.match(seg, /variant="secondary"/)
  assert.match(read('components/cy/scene-settings-deregister/index.wxml'), /variant="danger"/, '注销必须仍是唯一那处红')
})

// R4:这条原先只断言 ≥4.5:1,而夜端 text-secondary(8.70:1)/ text-tertiary(5.44:1) 都能过线
// ⇒ 「不得停留在更暗档」这个裁决**根本抓不到**,是橡皮图章。
// 现在加第二条:映射目标的相对亮度必须 ≥ text-primary 的亮度(比从 tokens.wxss 解出的真值,
// 不比 token 名字符串)。换成 secondary/tertiary 会真红。
test('A 文案必须映射到最亮那一档中性文字 token,且与按钮面 ≥4.5:1', () => {
  const wxss = read(SZ_WXSS)
  const fgHook = scopedHook(wxss, '.sz-logout', '--cy-comp-btn-secondary-fg')
  const bgHook = scopedHook(wxss, '.sz-logout', '--cy-comp-btn-secondary-bg')
  assert.ok(fgHook, '.sz-logout 必须在页面作用域内重映射 --cy-comp-btn-secondary-fg')
  assert.ok(bgHook, '.sz-logout 必须在页面作用域内重映射 --cy-comp-btn-secondary-bg')
  const fg = parseColor(resolveToken(fgHook))
  const bg = over(parseColor(resolveToken(bgHook)), PAGE_BG())

  const ratio = contrast(fg, bg)
  assert.ok(ratio >= 4.5, `文案/按钮面对比度 ${ratio.toFixed(2)}:1 应 ≥4.5:1`)

  const primaryLum = luminance(parseColor(resolveToken('--cy-color-text-primary')))
  const fgLum = luminance(fg)
  assert.ok(fgLum >= primaryLum - 1e-9,
    `文案映射到 ${fgHook}(亮度 ${fgLum.toFixed(5)}),暗于 text-primary(${primaryLum.toFixed(5)});`
    + ` 夜端 secondary 8.70:1 / tertiary 5.44:1 都能过 4.5:1 的线,所以必须另判亮度档`)
})

test('A 按钮面必须是实色档,不能再是近透明的 wash(原 --cy-bg-subtle 面 vs 页底仅 1.06:1)', () => {
  const bgHook = scopedHook(read(SZ_WXSS), '.sz-logout', '--cy-comp-btn-secondary-bg')
  const raw = resolveToken(bgHook)
  const c = parseColor(raw)
  assert.equal(c.a, 1, `按钮面 ${bgHook}=${raw} 必须是不透明实色,半透明 wash 在夜端等于没有面`)
  const improved = contrast(over(c, PAGE_BG()), PAGE_BG())
  const before = contrast(over(parseColor(resolveToken('--cy-bg-subtle')), PAGE_BG()), PAGE_BG())
  assert.ok(improved > before, `面 vs 页底必须优于原状(${improved.toFixed(3)} > ${before.toFixed(3)})`)
})

test('A 描边必须真勾得出轮廓:与页底 ≥3:1（WCAG 1.4.11 非文本对比）', () => {
  const wxss = read(SZ_WXSS)
  const borderHook = scopedHook(wxss, '.sz-logout', '--cy-border-line')
  assert.ok(borderHook, '.sz-logout 必须重映射 --cy-border-line(原 rgba(255,255,255,.16) 只有 1.45:1)')
  const ratio = contrast(over(parseColor(resolveToken(borderHook)), PAGE_BG()), PAGE_BG())
  assert.ok(ratio >= 3, `描边 vs 页底 ${ratio.toFixed(2)}:1 应 ≥3:1`)
})

test('A 退出图标必须染色:源 svg 是浅色主题的深 slate,不染在暗底上看不见', () => {
  const wxss = read(SZ_WXSS)
  const rule = /\.sz-logout-icon\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(rule, '必须有 .sz-logout-icon 规则')
  assert.match(rule[1], /filter:\s*brightness\(0\)\s*invert\(/,
    '沿用同文件 .sz-card-row-icon / cy-cell tint=mono 的既有染色手法')
})

/* ---------- B · 三个真·二级页的可用返回 ---------- */

const L2 = [
  {
    name: 'agreement',
    js: 'pages/agreement/index.js', wxml: 'pages/agreement/index.wxml',
    // 默认(无 query)= user_agreement,其真实 caller 是 shezhi.js:125
    fallbackApi: 'redirectTo', fallbackUrl: '/pages/shezhi/shezhi',
  },
  {
    name: 'address',
    js: 'pages/address/address.js', wxml: 'pages/address/address.wxml',
    fallbackApi: 'switchTab', fallbackUrl: '/pages/member/index/index',
  },
  {
    name: 'infomationdetail',
    js: 'subpackageA/pages/infomationdetail/infomationdetail.js',
    wxml: 'subpackageA/pages/infomationdetail/infomationdetail.wxml',
    fallbackApi: 'redirectTo', fallbackUrl: '/subpackageA/pages/infomation/infomation',
  },
]

let sandbox

beforeEach(() => {
  sandbox = { requests: [], toasts: [], navBacks: [], switchTabs: [], redirects: [], navigates: [] }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
    tips: (m) => sandbox.toasts.push(m),
    sendRequest: (o) => { sandbox.requests.push(o) },
    getRequestErrorMessage: (r, f) => (r && r.msg) || f || '未知错误',
    getPageSize: () => 10,
    hasPendingPrivacyAuthorization: () => false,
    recordConsent: () => Promise.resolve(),
    resolvePrivacyAuthorization() {},
  })
  global.Page = (c) => { sandbox.pageConfig = c }
  global.Component = (c) => { sandbox.componentConfig = c }
  global.wx = {
    showToast: (o) => sandbox.toasts.push(o && o.title),
    hideLoading() {}, showLoading() {}, showModal() {},
    navigateTo: (o) => sandbox.navigates.push(o && o.url),
    navigateBack: (o) => sandbox.navBacks.push(o || {}),
    switchTab: (o) => sandbox.switchTabs.push(o && o.url),
    redirectTo: (o) => sandbox.redirects.push(o && o.url),
    reLaunch: (o) => sandbox.navigates.push(o && o.url),
    setNavigationBarTitle() {}, stopPullDownRefresh() {}, stopLocationUpdate() {},
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

test('B 前提:cy-nav-bar 箭头无条件渲染,组件内 onBack 在栈深 1 时不动(所以要页面接管)', () => {
  assert.match(read('components/cy/nav-bar/index.wxml'), /nav__back" wx:if="\{\{back\}\}"/)
  assert.match(read('components/cy/nav-bar/index.js'), /pages\.length > 1/)
})

for (const p of L2) {
  test(`B ${p.name} 的 nav 接管返回(custom-back + bind:back),箭头保持可见`, () => {
    const wxml = stripComments(read(p.wxml))
    assert.match(wxml, /<cy-nav-bar[^>]*custom-back/, '必须 custom-back 接管')
    assert.match(wxml, /<cy-nav-bar[^>]*bind:back="onBack"/, '必须绑 onBack')
    assert.doesNotMatch(wxml, /<cy-nav-bar[^>]*back="\{\{false\}\}"/, '不得靠隐藏箭头假修')
  })

  test(`B ${p.name} onBack:先 navigateBack,栈首页时落到 ${p.fallbackApi} ${p.fallbackUrl}`, () => {
    const vm = loadPage(p.js)
    assert.equal(typeof vm.onBack, 'function', '必须定义 onBack')
    vm.onBack()
    assert.equal(sandbox.navBacks.length, 1, 'onBack 必须先尝试 navigateBack')
    const opts = sandbox.navBacks[0]
    assert.equal(typeof opts.fail, 'function', 'navigateBack 必须带 fail 兜底,否则栈首页时箭头是死的')
    opts.fail()
    const bucket = p.fallbackApi === 'switchTab' ? sandbox.switchTabs : sandbox.redirects
    assert.deepEqual(bucket, [p.fallbackUrl], `fallback 必须是无参可达路由 ${p.fallbackUrl}`)
  })
}

test('B fallback 目标必须是无参路由(带 query 的 caller 不能盲跳)', () => {
  for (const p of L2) assert.doesNotMatch(p.fallbackUrl, /\?/, `${p.name} 的 fallback 不得带 query`)
})

/* ---------- B-R4 · agreement 的栈空兜底必须按 ?type= 回到各自真实 caller ----------
 * caller 矩阵(全仓 grep,只有两个 caller):
 *   ?type=user_agreement      ← pages/shezhi/shezhi.js:125       ⇒ 兜底 /pages/shezhi/shezhi
 *   ?type=cancellation_notice ← pages/deregister/index.js:49     ⇒ 兜底 /pages/deregister/index
 * R3 写死了设置页 ⇒ 从注销页进《账号注销须知》再返回会被丢到设置页,注销上下文整段丢失。
 * 下面是**场景级**断言:走真实 onLoad(query) 再触发 onBack,而不是只比一个字符串常量。 */

const AGREEMENT_JS = 'pages/agreement/index.js'

function agreementBackTarget(query) {
  // 同一条 test 里可能连问多个 type ⇒ 每次清桶,否则第二次会看到累加结果(假红)
  sandbox.navBacks.length = 0
  sandbox.redirects.length = 0
  sandbox.switchTabs.length = 0
  const vm = loadPage(AGREEMENT_JS)
  vm.onLoad(query)
  vm.onBack()
  assert.equal(sandbox.navBacks.length, 1, 'onBack 必须先尝试 navigateBack')
  const opts = sandbox.navBacks[0]
  assert.equal(typeof opts.fail, 'function', 'navigateBack 必须带 fail 兜底')
  opts.fail()
  return { redirects: sandbox.redirects, switchTabs: sandbox.switchTabs, doc: vm.data.doc }
}

test('B-R4 场景:设置 → 用户服务协议,栈空兜底仍回设置页(既有行为不得改变)', () => {
  const r = agreementBackTarget({ type: 'user_agreement' })
  assert.equal(r.doc.title, '用户服务协议')
  assert.deepEqual(r.redirects, ['/pages/shezhi/shezhi'])
})

test('B-R4 场景:注销页 → 账号注销须知,栈空兜底必须回注销页而不是设置页', () => {
  const r = agreementBackTarget({ type: 'cancellation_notice' })
  assert.equal(r.doc.title, '账号注销须知')
  assert.deepEqual(r.redirects, ['/pages/deregister/index'],
    '回设置页会把用户正在走的注销流程整段丢掉 —— 必须回注销页')
})

test('B-R4 场景:无 query / 未知 type 落到 user_agreement,兜底随之回设置页', () => {
  assert.deepEqual(agreementBackTarget({}).redirects, ['/pages/shezhi/shezhi'])
  assert.deepEqual(agreementBackTarget({ type: 'no_such_doc' }).redirects, ['/pages/shezhi/shezhi'])
})

// docType 是「当前实际展示的是哪份文档」这个事实本身,不只是路由查表的钥匙。
// 没有这条,`docType = type`(不做回退归一)也能靠 onBack 里的 || 蒙对路由 ⇒ 那行变异不会红,
// data 里却留着一个与页面内容不符的假 docType。这条把它钉成可观测的不变量。
test('B-R4 data.docType 必须描述实际展示的文档,未知 type 不得留下假值', () => {
  const vm = loadPage(AGREEMENT_JS)
  vm.onLoad({ type: 'no_such_doc' })
  assert.equal(vm.data.doc.title, '用户服务协议', '未知 type 应回退到用户服务协议')
  assert.equal(vm.data.docType, 'user_agreement',
    'docType 应随文档一起归一,不能留 no_such_doc —— 否则 data 与页面内容不一致')
})

/* 2026-07-31 用户定「协议类长文 = 全屏弹窗」:shezhi / deregister 两处入口从 navigateTo
 * 改成原地开 cy-agreement-sheet,pages/agreement 路由页保留(深链 / 分享 / 扫码直达仍走它)。
 * ⇒ 本条的**机制**跟着变:不再断言那两处存在 navigateTo 字面量,改断言
 *   ① 两处入口确实以正确的 type 打开了弹窗;
 *   ② 全仓已无任何 navigateTo 进 agreement(有的话必须回来补 ORIGIN_BY_TYPE 映射);
 *   ③ ORIGIN_BY_TYPE 两条映射仍在 —— 深链直达栈空时靠它回落,这条没因为弹窗化而失效。
 * **意图不变**:兜底路由表必须与真实入口保持一致,入口变了这条要红。 */
test('B-R4 协议入口已弹窗化,兜底路由表仍与真实入口对齐(入口变了这条要红)', () => {
  const shezhi = read('pages/shezhi/shezhi.js')
  const shezhiWxml = read('pages/shezhi/shezhi.wxml')
  const dereg = read('utils/deregister-flow.js')
  const deregWxml = read('components/cy/scene-settings-deregister/index.wxml')

  // ① 入口改成弹窗,且 type 传对(传错会静默回退成用户服务协议,注销须知就打不开了)
  assert.match(shezhi, /goUserAgreement\(\)\s*\{\s*this\.setData\(\{\s*showAgreementSheet:\s*true/,
    'shezhi 的用户服务协议入口应打开全屏弹窗')
  assert.match(shezhiWxml, /<cy-agreement-sheet[^>]*type="service"/,
    'shezhi 弹窗必须传 type="service"(用户服务协议)')
  assert.match(dereg, /goCancellationNotice\(\)\s*\{\s*this\.setData\(\{\s*showNoticeSheet:\s*true/,
    'deregister 的《账号注销须知》入口应打开全屏弹窗')
  assert.match(deregWxml, /<cy-agreement-sheet[^>]*type="deregister"/,
    'deregister 弹窗必须传 type="deregister"(账号注销须知)')

  // ② 全仓不应再有 navigateTo 进 agreement 路由页;新增了就必须回来补兜底映射
  const callers = []
  for (const dir of ['pages', 'subpackageA', 'subpackageB', 'subpackageP3']) {
    const base = path.join(ROOT, dir)
    if (!fs.existsSync(base)) continue
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name)
      if (e.isDirectory()) return walk(p)
      if (!/\.(js|wxml)$/.test(e.name)) return
      const src = fs.readFileSync(p, 'utf8')
      // 路由页自身不算 caller
      if (p.includes(path.join('pages', 'agreement'))) return
      if (src.includes('/pages/agreement/index')) callers.push(path.relative(ROOT, p))
    })
    walk(base)
  }
  assert.deepEqual(callers.sort(), [],
    `agreement 又出现了 navigateTo caller(${callers.join(', ')}) ⇒ 必须回 ORIGIN_BY_TYPE 补映射`)

  // ③ 深链直达(栈空)时的回落映射仍在 —— 弹窗化不影响这条路径
  const agreement = read(AGREEMENT_JS)
  assert.match(agreement, /user_agreement:\s*'\/pages\/shezhi\/shezhi'/,
    '深链直达用户服务协议、栈空时应回落设置页')
  assert.match(agreement, /cancellation_notice:\s*'\/pages\/deregister\/index'/,
    '深链直达注销须知、栈空时应回落注销页(不能丢回设置页)')
})

/* ---------- C · infomation「纯数字且无可区分副标题」判不可读 ---------- */

const INFO_JS = 'subpackageA/pages/infomation/infomation.js'
const INFO_WXML = 'subpackageA/pages/infomation/infomation.wxml'

function rows(input) {
  const vm = loadPage(INFO_JS)
  vm.getList()
  const req = sandbox.requests.find((r) => r.url === '/api/common/infomation_list')
  assert.ok(req)
  req.success({ code: '200', data: input })
  if (req.complete) req.complete()
  return vm.data.list
}

test('C 线上那行:title=subtitle=纯数字 ⇒ 不可读、不可点', () => {
  const [r] = rows([{ id: 1, title: '11', subtitle: '11', contents: '<p>x</p>' }])
  assert.equal(r.usable, false)
  assert.equal(r.title, '11', '仍不改写真实数据')
})

test('C 纯数字标题且无副标题 ⇒ 不可读', () => {
  const [r] = rows([{ id: 2, title: '11', subtitle: '', contents: '<p>x</p>' }])
  assert.equal(r.usable, false)
})

test('C 不能笼统过滤数字:数值命名 + 有效副标题必须保留', () => {
  const [r] = rows([{ id: 3, title: '2024', subtitle: '年度城市定向回顾', contents: '<p>x</p>' }])
  assert.equal(r.usable, true)
  assert.equal(r.description, '年度城市定向回顾')
})

test('C 纯数字标题但副标题提供了语义 ⇒ 保留', () => {
  const [r] = rows([{ id: 4, title: '11', subtitle: '新手上路指南', contents: '<p>x</p>' }])
  assert.equal(r.usable, true)
})

test('C 非纯数字标题一律保留(含含数字的正常标题)', () => {
  const [a, b] = rows([
    { id: 5, title: '72小时城市漫游', subtitle: '', contents: '<p>x</p>' },
    { id: 6, title: '11 号线沿线玩法', subtitle: '', contents: '<p>x</p>' },
  ])
  assert.equal(a.usable, true)
  assert.equal(b.usable, true)
})

test('C 原有两条不可用判据保留:标题空 / 正文空', () => {
  const [a, b] = rows([
    { id: 7, title: '', subtitle: '有副标题', contents: '<p>x</p>' },
    { id: 8, title: '有标题', subtitle: '', contents: '   ' },
  ])
  assert.equal(a.usable, false)
  assert.equal(b.usable, false)
})

test('C 不可读行的显式状态文案是「内容待完善，暂不可查看」且不可点、无 chevron', () => {
  const wxml = stripComments(read(INFO_WXML))
  // 只取 wx:else 那一枚 cy-cell 标签本身 —— 按 'item.usable' 切会把可用分支的 bindtap 也带进来(假红)
  const unusable = /<cy-cell\s+wx:else[^>]*\/>/.exec(wxml)
  assert.ok(unusable, '必须有 wx:else 的不可读行分支')
  assert.match(unusable[0], /内容待完善，暂不可查看/)
  assert.match(unusable[0], /disabled="\{\{true\}\}"/, '必须显式 disabled')
  assert.match(unusable[0], /arrow="\{\{\s*false\s*\}\}"/, '不得留 chevron 暗示可点')
  assert.doesNotMatch(unusable[0], /bindtap|catchtap/, '不可读行不得挂点击')
})

/* ---------- D · 底栏占位的几何证明 ---------- */

test('D 资料页底栏:保存必须在带层级的固定栏里,且页面留足官方等高空白', () => {
  const wxss = read('pages/gerenziliao/gerenziliao.wxss')
  const wxml = stripComments(read('pages/gerenziliao/gerenziliao.wxml'))

  // R5:自造的 .bmbottom(position:fixed 但无 z-index)在 C03-R4 复拍 S1 滚到底后整条消失,
  // 已收编同队列范式 cy-footer-bar(自带 z-index/安全区/页边距)。
  assert.match(wxml, /<cy-footer-bar>\s*<cy-btn[^>]*bindtap="saveInfo"/, '保存必须包在 cy-footer-bar 内')
  assert.doesNotMatch(wxss, /\.bmbottom\s*\{/, '不得再留自造底栏规则')
  assert.doesNotMatch(wxml, /class="bmbottom"/, '不得再引用自造底栏')

  // 避让空白直接用底栏组件的官方高度 token —— 同源即等高,不再手算三档。
  const hold = /\.gz-footer-hold\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(hold, '必须保留底栏避让占位')
  assert.match(hold[1], /height:\s*var\(--cy-comp-footer-h\)/,
    '占位必须等于 cy-footer-bar 的官方高度 --cy-comp-footer-h')
})
