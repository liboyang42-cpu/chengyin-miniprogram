const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 本轮从系统导航迁到共享 cy-nav-bar 的普通二级页(用户点名的旧页面 + coop 列表)。
// 迁移三件套缺一不可:
//   ① json 声明 custom + 引入组件(否则 <cy-nav-bar> 是未知标签,静默不渲染)
//   ② wxml 顶部渲染 cy-nav-bar,并自留一块与顶栏等高的占位(custom 导航不占文档流,
//      不留占位首屏内容会被顶栏压住 —— 这是自定义导航最常见的回退)
//   ③ js 把状态栏/导航条高度落进 data(占位靠它算高)
// 2026-07-29 导航统一后,标题主流落点从 cy-nav-bar 的 title 属性下沉到独立的
// cy-page-title 组件(nav 只剩返回出口,避免同屏双标题;自带 safe-top,页面不必
// 再手留 cy-nav-spacer 占位)。coop/list、mycanyuinfo 的标题文案也各有一处术语/
// 层级修正(见各自页面注释),随之更新。
const MIGRATED = {
  'pages/addressinfo/addressinfo': '参与人信息',
  'pages/address/address': '参与人信息',
  'subpackageMember/order/order': '我的订单',
  'subpackageMember/tixian/tixian': '提现申请',
  'subpackageMember/mycanyuinfo/mycanyuinfo': '参与详情',
  'pages/coop/list/index': '协作邀请',
}

const TITLELESS_MIGRATED = {
  'pages/gerenziliao/gerenziliao': '个人资料',
}

function assertSharedNav(route, title, sources) {
  const cfg = JSON.parse(sources.json)
  assert.equal(cfg.navigationStyle, 'custom', `${route} 必须走自定义导航`)
  assert.equal(cfg.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index', `${route} 必须引入共享 nav`)
  // 自定义导航下系统栏配色键已无作用,留着只会让人以为还能靠它调色
  assert.equal(cfg.navigationBarBackgroundColor, undefined, `${route} 自定义导航不该再留 navigationBarBackgroundColor`)
  assert.equal(cfg.navigationBarTitleText, title, `${route} 仍须保留原生标题(分享卡片/回退栈读它)`)

  // 标题要么显式挂在 cy-nav-bar 上,要么由页内 cy-page-title 承接——二者恰好一个即可,
  // 都没有才是真缺口。
  const navHasTitle = new RegExp(`<cy-nav-bar[^>]*title="${title}"`).test(sources.wxml)
  // 标题允许是条件表达式(历史上 coop/list 带 ?tab=pool 会整屏换成「合作池」;该形态 2026-09-06 已删,
  // 但这条放宽本身对别的页仍成立,不收窄)。
  // 只认「{{}} 里出现带引号的该文案」这一种写法,不放宽成子串匹配——否则 title="不是协作邀请" 也能蒙混过关。
  const pageTitleHasTitle =
    new RegExp(`<cy-page-title[^>]*title="${title}"`).test(sources.wxml) ||
    new RegExp(`<cy-page-title[^>]*title="\\{\\{[^"]*'${title}'[^"]*\\}\\}"`).test(sources.wxml)
  assert.ok(navHasTitle || pageTitleHasTitle, `${route} 顶栏或 cy-page-title 必须有一处显式标题「${title}」`)

  assert.match(sources.js, /^\s*statusBarHeight:/m, `${route} data 必须落状态栏高度`)
  assert.match(sources.js, /^\s*navBarHeight:/m, `${route} data 必须落导航条高度`)
}

function assertTitlelessSharedNav(route, title, sources) {
  const cfg = JSON.parse(sources.json)
  assert.equal(cfg.navigationStyle, 'custom', `${route} 必须走自定义导航`)
  assert.equal(cfg.navigationBarTitleText, title, `${route} 必须保留原生标题兜底`)
  assert.equal(cfg.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index')
  assert.equal(cfg.usingComponents['cy-page-title'], undefined)
  assert.match(sources.wxml, /<cy-nav-bar\b/)
  assert.match(sources.wxml, /style="height: \{\{statusBarHeight \+ navBarHeight\}\}px;"/)
  assert.doesNotMatch(sources.wxml, /<cy-page-title\b/, `${route} 是用户点名的无标题页`)
  assert.match(sources.js, /^\s*statusBarHeight:/m)
  assert.match(sources.js, /^\s*navBarHeight:/m)
}

function sourcesOf(route) {
  return { json: read(`${route}.json`), wxml: read(`${route}.wxml`), js: read(`${route}.js`) }
}

test('用户点名的普通二级页全部迁到共享 cy-nav-bar', () => {
  Object.entries(MIGRATED).forEach(([route, title]) => assertSharedNav(route, title, sourcesOf(route)))
})

test('用户点名的无标题资料页保留共享返回栏和等高占位', () => {
  Object.entries(TITLELESS_MIGRATED).forEach(([route, title]) => assertTitlelessSharedNav(route, title, sourcesOf(route)))
})

test('负控:把旧个人资料大标题加回无标题页必须判红', () => {
  const route = 'pages/gerenziliao/gerenziliao'
  const s = sourcesOf(route)
  s.wxml = s.wxml.replace('<cy-nav-bar />', '<cy-nav-bar />\n<cy-page-title title="个人资料" />')
  assert.notEqual(s.wxml, read(`${route}.wxml`), '变异未生效,负控本身是假的')
  assert.throws(() => assertTitlelessSharedNav(route, '个人资料', s))
})

test('负控:只加标签不在 json 里引组件(静默不渲染)必须判红', () => {
  const route = 'pages/addressinfo/addressinfo'
  const s = sourcesOf(route)
  const cfg = JSON.parse(s.json)
  delete cfg.usingComponents['cy-nav-bar']
  s.json = JSON.stringify(cfg)
  assert.throws(() => assertSharedNav(route, '参与人信息', s))
})

test('负控:忘记把导航高度落进 data(占位算成 0)必须判红', () => {
  const route = 'subpackageMember/order/order'
  const s = sourcesOf(route)
  s.js = s.js.replace(/statusBarHeight:/g, '_statusBarHeight:')
  assert.throws(() => assertSharedNav(route, '我的订单', s))
})

// 迁移后自绘的大标题必须删掉,否则同一个页面上下各有一个标题。
const REMOVED_SELF_DRAWN_TITLES = [
  ['pages/addressinfo/addressinfo.wxml', 'address-title'],
  ['pages/gerenziliao/gerenziliao.wxml', 'shzl cy-h1'],
  ['pages/coop/list/index.wxml', 'coop-head-tit'],
]

test('迁移页不再自绘重复标题', () => {
  REMOVED_SELF_DRAWN_TITLES.forEach(([file, cls]) => {
    assert.doesNotMatch(read(file), new RegExp(cls), `${file} 仍留着自绘标题,与 nav 标题重复`)
  })
})

test('负控:把自绘标题挂回去必须判红', () => {
  const file = 'pages/gerenziliao/gerenziliao.wxml'
  const mutated = `<view class="shzl cy-h1">个人资料</view>\n${read(file)}`
  assert.throws(() => assert.doesNotMatch(mutated, /shzl cy-h1/))
})
