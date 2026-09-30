const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const readIf = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? read(rel) : '')

// ── 自定义导航页(navigationStyle:custom 且渲染 cy-nav-bar)的两条硬约束 ──
//
// cy-nav-bar 是 position:fixed 的,它带来两类只在这类页面成立的缺陷:
//   (1) 断层:顶栏底色 = --cy-comp-nav-bg → --cy-color-bg-page。页面自己把铺满层
//       画成 --cy-bg-card(--cy-color-bg-surface)时,两色在顶栏下缘接出一条色带。
//       实测踩过:im/list、im/chat、official-detail、infomation。
//   (2) 吸顶元素藏在顶栏底下:页内 position:sticky 若 top:0,吸住时会落进顶栏占据的
//       那 88px 里 —— 顶栏 z-index 更高就把它盖住,更低就反过来盖住顶栏。两种都是缺陷。
//       实测踩过:activity/list .oe-screen。

function customNavRoutes() {
  const app = JSON.parse(read('app.json'))
  const routes = [...app.pages]
  app.subPackages.forEach((sp) => {
    const root = sp.root.replace(/\/$/, '')
    sp.pages.forEach((p) => routes.push(`${root}/${p}`))
  })
  return routes.filter((route) => {
    const cfg = readIf(`${route}.json`)
    if (!cfg) return false
    if (JSON.parse(cfg).navigationStyle !== 'custom') return false
    return /<cy-nav-bar/.test(readIf(`${route}.wxml`))
  })
}

// 艺术指导另择黑值的页面:这些页的正文底色是刻意选的(纯黑取景台 / 广场夜色 / 勋章墙),
// 与 --cy-color-bg-page(#020104)的差值在 1% 明度内或本就是独立视觉语言,不按断层论处。
// ⚠️ 名单要写清"为什么",新页面不得靠往这里加一行来消掉门禁。
const ART_DIRECTED_SURFACES = new Set([
  'pages/square/list/index',                     // 广场夜色 #0a0300(暖黑)
  'subpackageRoam/history/index',                    // 漫游票券纯黑台面 #000
  'pages/templatedetail/templatedetail',         // 模板详情深灰台面 #121212
  'subpackageP3/pages/badge-wall/index/index',   // 勋章墙 shader 底 #050506
  // ⚠️ 这个不是艺术指导,是【已知遗留】:.topic 挂 .theme-merchant(浅色态),整页画成
  //    bg-surface(#FFFFFF),而同一子树里的顶栏读 bg-page(#F8F9FA)—— 白面配灰顶栏,
  //    边界仍在,只是浅色下不刺眼。改它要动商家浅色态的整页分层,不在本轮导航收口范围内。
  'pages/topic/merchantinfo/merchantinfo',
  // 同上,页面显式把 --cy-bg-page/--cy-comp-nav-bg 都重定向到 --cy-bg-card 并跟随同色
  // (见该页 wxss 注释「只重定向 --cy-bg-page 挡不住色缝……这里必须直接改 --cy-comp-nav-bg」)。
  'pages/activity/official-detail/index',
  'pages/activity/official-mine/index',     // 同上
])

function renderedClasses(wxml) {
  const set = new Set()
  for (const m of wxml.matchAll(/class="([^"]*)"/g)) {
    m[1].split(/[\s{}?:'"]+/).forEach((c) => c && set.add(c))
  }
  return set
}

// overlay 顶栏(hero 详情页首屏透明)不参与断层判定:它压根没有底色。
function navIsOverlay(wxml) {
  const tag = /<cy-nav-bar([^>]*)>|<cy-nav-bar([^>]*)\/>/.exec(wxml)
  return !!tag && /\boverlay\b/.test(tag[1] || tag[2] || '')
}

function fullBleedSurfaces(wxss, rendered) {
  // page{} 以及任何【真被渲染的】min-height:100vh 铺满层 —— 它们才是与顶栏相接的那一层。
  // 未被渲染的历史规则(如 publish/simple 里遗留的 .cy-page 局部色板)不判罚。
  const out = []
  const pageRule = /(^|\n)\s*page\s*\{([^}]*)\}/.exec(wxss)
  if (pageRule) out.push({ name: 'page', body: pageRule[2] })
  for (const m of wxss.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    if (/min-height:\s*100vh/.test(m[2]) && rendered.has(m[1])) out.push({ name: `.${m[1]}`, body: m[2] })
  }
  return out
}

function assertNoNavSeam(route, wxml, wxss) {
  if (navIsOverlay(wxml) || ART_DIRECTED_SURFACES.has(route)) return
  fullBleedSurfaces(wxss, renderedClasses(wxml)).forEach(({ name, body }) => {
    const bg = /background(?:-color)?\s*:\s*([^;]+);/.exec(body)
    if (!bg) return
    const value = bg[1].trim()
    if (/^(none|transparent|inherit)$/.test(value)) return
    if (/linear-gradient|radial-gradient|url\(/.test(value)) return // 渐变/图底另论
    assert.match(
      value,
      /var\(--cy-(bg-page|color-bg-page)\)/,
      `${route} 的 ${name} 铺满层底色是 ${value},与固定顶栏(--cy-color-bg-page)不同 —— 顶栏下缘会出色带`,
    )
  })
}

function assertStickyClearsNav(route, wxml, wxss) {
  const rendered = renderedClasses(wxml)
  for (const m of wxss.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const [, cls, body] = m
    if (!/position:\s*sticky/.test(body)) continue
    if (!rendered.has(cls)) continue // 未被渲染的历史死规则不判罚
    if (/(^|[;{\s])bottom:/.test(body)) continue // 吸底动作栏(bottom 锚定)与顶栏无关
    // 判「有效吸顶位置」,不是只判 wxss 写没写 top:0。三种都要判红:
    //   · wxss top:0        → 吸住时落进顶栏那 88px,互相遮挡
    //   · wxss 没写 top      → sticky 永不吸顶,静默失效(比遮挡更难发现)
    //   · 内联 top 被拿掉    → 同上
    const inline = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*style="[^"]*top:\\s*\\{\\{[^}]*navBarHeight`).test(wxml)
      || new RegExp(`style="[^"]*top:\\s*\\{\\{[^}]*navBarHeight[^"]*"[^>]*class="[^"]*\\b${cls}\\b`).test(wxml)
    if (inline) continue

    const wxssTop = /(^|[;{\s])top:\s*([^;]+);/.exec(body)
    assert.ok(wxssTop, `${route} 的 .${cls} 是 sticky 却没有任何 top —— 永远不会吸顶,是静默失效`)
    assert.ok(
      !/^0(px|rpx)?$/.test(wxssTop[2].trim()),
      `${route} 的 .${cls} 吸顶在 top:0,会落进 fixed cy-nav-bar 占据的区域 —— 吸住时与顶栏互相遮挡`,
    )
  }
}

// ── 居中标题 ──
// 验收口径:二三级页统一「三角返回 + 居中标题 + 原生胶囊」。
// overlay(hero 首屏透明顶栏)不在此列 —— 那类页的标题在 hero 里,滚动后才出现。
// 下面是【尚未收口】的实底页,各自另有页内大标题,补 nav 标题会造成同屏重复,
// 需要连同页内标题一起重排,不属于本轮导航收口范围。名单只减不增。
// 2026-07-29 导航统一后,标题的主流落点已从 cy-nav-bar 的 title 属性下沉到独立的
// cy-page-title 组件(nav 只剩返回出口,避免同屏双标题)——本轮收口前的老假设
// (标题必须挂在 nav 上)已被这个后来居上的模式取代,全站 60+ 页都是这个形状。
// 判据放宽为「nav 有 title 属性,或页面另有 cy-page-title 承接」,名单只收
// 「两者都没有,标题另有他法」的真例外。
const TITLELESS_SOLID_NAV = new Set([
  'pages/square/list/index',                // 2026-08-07 用户裁决:帖文流无大标题,顶部直接进内容
  'pages/square/detail/index',              // A10 用户点名删除「动态」标题，正文作者头紧接 nav
  'pages/search2/result/index',             // A26 用户点名只显示搜索框与输入文字
  'pages/gerenziliao/gerenziliao',          // A52 用户点名资料编辑页不要标题
  'subpackageB/pages/im/chat/index',        // 顶栏下方 hero 区居中头像+对话人名
  'pages/club/create/index',                // 向导分段进度条紧贴顶栏
  'pages/club/apply/index',                 // 同上:2026-09-02 改成同形态的问句式向导
  'pages/topic/merchantinfo/merchantinfo',  // 页内 .page-title 是动态主题名
  'pages/merchant/customer/index',          // Figma 25:124 页内 .cu-hero-title 承接「客户」标题
  'pages/merchant/coop-center/index',       // Figma 234:276 返回箭头右侧左对齐 .cc-nav-title「合作中心」,顶栏只留返回(2026-09-15 总控裁决听稿)
  'pages/merchant/customer/detail/index',   // Figma 71:279 标题就是客户名(.cd-name 28px),与头像同排;顶栏只留返回
  'pages/club/detail/index',                // 页内 .profile-name 大标题承接俱乐部名
  'pages/publish/simple/index',             // 页内自带「简单 AI · 路线共创」品牌头,不叠 page-title
  'pages/topic/index/index',                // hero 封面区自带主题名,无独立标题位
  'subpackageMember/coupon-qr/index',           // 标题语义在 cy-qr-voucher 卡内,叠 page-title 会与码卡打架
  'subpackageRoam/citynode-code/index',         // 同上,标题语义在 cy-qr-voucher 卡内
  // 创建流程第0页(价值主张):标题就是页面正中那句两行主张(.ti-copy),
  // 顶栏只承载返回出口 + 右上「跳过」。再挂一个导航级标题就是同屏双标题,
  // 且与已确认的参考构图(顶部只有 Skip、无标题)相悖。
  'pages/publish/template-intro/index',
])

function assertCentredTitle(route, wxml) {
  if (route === 'pages/merchant/decor/coop-setting/index') {
    assert.match(wxml, /<cy-nav-bar title=""/);
    assert.match(wxml, /<text class="dc-brand-title">承接设置<\/text>/);
    return;
  }
  if (navIsOverlay(wxml) || TITLELESS_SOLID_NAV.has(route)) return
  if (/<cy-page-title/.test(wxml)) return
  const tag = /<cy-nav-bar([\s\S]*?)(\/>|>)/.exec(wxml)
  assert.ok(tag, `${route} 应渲染 cy-nav-bar`)
  assert.match(
    tag[1],
    /title="[^"]+"/,
    `${route} 的实底顶栏没有标题,页内也没有 cy-page-title 承接——二三级页要么顶栏挂标题,要么页内有 cy-page-title`,
  )
}

test('自定义导航页:实底顶栏都有居中标题', () => {
  customNavRoutes().forEach((route) => assertCentredTitle(route, read(`${route}.wxml`)))
})

test('负控:把实底页的顶栏标题清空必须判红', () => {
  const route = 'subpackageB/pages/im/list/index'
  const wxml = read(`${route}.wxml`).replace('title="消息"', 'title=""')
  assert.notEqual(wxml, read(`${route}.wxml`), '变异未生效,负控本身是假的')
  assert.throws(() => assertCentredTitle(route, wxml), /没有标题/)
})

test('自定义导航页:铺满层底色与固定顶栏同色,顶栏下缘不出色带', () => {
  const routes = customNavRoutes()
  assert.ok(routes.length > 20, `自定义导航页只扫到 ${routes.length} 个,扫描器可能失效`)
  routes.forEach((route) => assertNoNavSeam(route, read(`${route}.wxml`), readIf(`${route}.wxss`)))
})

test('自定义导航页:页内吸顶元素让开固定顶栏', () => {
  customNavRoutes().forEach((route) => assertStickyClearsNav(route, read(`${route}.wxml`), readIf(`${route}.wxss`)))
})

test('负控:把某个自定义导航页的底色改回 bg-card 必须判红', () => {
  const route = 'subpackageB/pages/im/list/index'
  const wxss = read(`${route}.wxss`).replace('page { background: var(--cy-bg-page); }', 'page { background: var(--cy-bg-card); }')
  assert.notEqual(wxss, read(`${route}.wxss`), '变异未生效,负控本身是假的')
  assert.throws(() => assertNoNavSeam(route, read(`${route}.wxml`), wxss), /顶栏下缘会出色带/)
})

test('负控:把吸顶元素的让位内联样式拿掉必须判红(静默失效)', () => {
  const route = 'pages/activity/list/index'
  const wxml = read(`${route}.wxml`).replace(' style="top: {{statusBarHeight + navBarHeight}}px;"', '')
  assert.notEqual(wxml, read(`${route}.wxml`), '变异未生效,负控本身是假的')
  assert.throws(() => assertStickyClearsNav(route, wxml, read(`${route}.wxss`)), /永远不会吸顶/)
})

test('负控:让位改回 top:0(藏进顶栏)必须判红', () => {
  const route = 'pages/activity/list/index'
  const wxml = read(`${route}.wxml`).replace(' style="top: {{statusBarHeight + navBarHeight}}px;"', '')
  const wxss = read(`${route}.wxss`).replace('position:sticky;', 'position:sticky;top:0;')
  assert.notEqual(wxss, read(`${route}.wxss`), '变异未生效,负控本身是假的')
  assert.throws(() => assertStickyClearsNav(route, wxml, wxss), /会落进 fixed cy-nav-bar/)
})
