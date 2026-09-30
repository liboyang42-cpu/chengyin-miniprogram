// 主题与二级 chrome 契约：只锁当前能证明的活路由。
//
// D_10/D_11:发布广场的商家共享子树必须重解析 merchant-light；
// B_02:店铺装修使用商家日间顶栏，loading 状态沿用既有四态契约。
// 所有负控只在内存副本上变异，避免结构断言退化成恒真检查。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const XCX = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(XCX, rel), 'utf8')
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SOURCE = {
  templateWxml: read('pages/template/index.wxml'),
  templateWxss: read('pages/template/index.wxss'),
  templateJs: read('pages/template/index.js'),
  decorWxml: read('pages/merchant/decor/index.wxml'),
  decorWxss: read('pages/merchant/decor/index.wxss') + read('pages/merchant/decor/design.wxss'),
  playWxml: read('pages/play/index.wxml'),
  merchantLight: read('style/merchant-light.wxss'),
}

function ruleBody(css, selector) {
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\}`))
  assert.ok(match, `缺少 ${selector} 规则`)
  return match[1]
}

function assertTemplateTheme(src) {
  assert.match(src.templateWxml,
    /<view class="tpl-page \{\{ isMerchant \? 'theme-merchant' : 'theme-dark' \}\}"/,
    '发布广场必须按本地身份显式挂 .theme-merchant / .theme-dark,不靠 app 运行时继承')
  assert.match(src.templateWxss,
    /page\s*\{[\s\S]*?background:\s*var\(--cy-color-bg-page\)\s*!important;/,
    '发布广场 page 外露底色必须读取 page 语义 token,不能在 page 节点先求值旧 card alias')
  const pageBody = ruleBody(src.templateWxss, 'page')
  assert.doesNotMatch(pageBody, /background:\s*var\(--cy-bg-card\)/,
    '发布广场 page 外露背景不能重新引用旧 card alias')
  const rootBody = ruleBody(src.templateWxss, '.tpl-page')
  assert.match(rootBody, /background:\s*var\(--cy-color-bg-page\)/)
  assert.match(rootBody, /color:\s*var\(--cy-color-text-primary\)/)
  assert.doesNotMatch(rootBody, /background:\s*var\(--cy-bg-card\)/,
    '发布广场根容器不能用旧 card alias 作为外露背景')
  assert.match(src.templateJs, /merchantTheme\.merchantPageShow\(\)/,
    '商家进入共享发布广场时原生顶栏必须同步日间主题')
  assert.match(src.templateJs, /merchantTheme\.merchantPageRestore\(\)/,
    '离开共享发布广场必须恢复玩家暗色原生主题')
}

test('D_10/D_11:发布广场 page/root 统一主题表面,商家横条修复有独立行为门', () => {
  assertTemplateTheme(SOURCE)
})

test('D_10/D_11:把 page 语义底色变回旧 alias 时契约必须判红', () => {
  const broken = { ...SOURCE, templateWxss: SOURCE.templateWxss.replace(
    'background: var(--cy-color-bg-page) !important;',
    'background: var(--cy-bg-card) !important;'
  ) }
  assert.notEqual(broken.templateWxss, SOURCE.templateWxss, '负控必须真的改动 page 声明')
  assert.throws(() => assertTemplateTheme(broken), assert.AssertionError)
})

function assertDecorChrome(src) {
  assert.match(src.decorWxml,
    /<view class="dc-page theme-merchant m-flush-nav">/,
    '店铺装修根节点必须同时挂 merchant-light 与 m-flush-nav')
  // 2026-08-20 商家标题统一(推翻 2026-07-29「标题下沉」):除首页外商家页标题一律
  // 回到导航条居中位(17px 档),L1 大标题撤销。「单一标题 + 顶栏/内容同底」语义不变,
  // 只是标题的唯一载体从 cy-page-title 换成 cy-nav-bar title。
  const navTag = src.decorWxml.match(/<cy-nav-bar[\s\S]*?>/)
  assert.ok(navTag, '店铺装修必须保留 cy-nav-bar')
  assert.match(navTag[0], /\stitle="\{\{view === .*pageTitle\}\}"/,
    '标题必须挂在导航条居中位(2026-08-20 统一规范),不能让这页变无题页')
  assert.doesNotMatch(src.decorWxml, /<cy-page-title/,
    'L1 大标题已撤销,再挂 cy-page-title 就是双标题')
  assert.doesNotMatch(src.decorWxml, /slot="actions"/,
    '导航条不应重复放置「看公开主页」入口')
  assert.match(src.decorWxss, /@import ['"]\.\.\/\.\.\/\.\.\/style\/merchant-light\.wxss['"];/)
  const pageBody = ruleBody(src.decorWxss, '.dc-page')
  assert.match(pageBody, /background:\s*var\(--cy-color-bg-page\)/,
    '装修页内容与 nav 必须落在商家 page 语义底色')
  // 「顶栏/内容同底」的另一半:m-flush-nav 必须真的把 nav 底色钩子接到页面同底,
  // 否则根节点挂着类、底下什么也没做,断言就退化成看标签
  assert.match(ruleBody(src.merchantLight, '.m-flush-nav'), /--cy-comp-nav-bg:/,
    'm-flush-nav 必须重设 --cy-comp-nav-bg 才能让顶栏与内容同底')
}

test('B_02:店铺装修 loading 页沿用商家浅色顶栏/内容同底契约', () => {
  assertDecorChrome(SOURCE)
})

test('B_02:移除 m-flush-nav 时顶栏同底契约必须判红', () => {
  const broken = { ...SOURCE, decorWxml: SOURCE.decorWxml.replace(
    'class="dc-page theme-merchant m-flush-nav"',
    'class="dc-page theme-merchant"'
  ) }
  assert.notEqual(broken.decorWxml, SOURCE.decorWxml, '负控必须真的移除 m-flush-nav')
  assert.throws(() => assertDecorChrome(broken), assert.AssertionError)
})

test('B_02:大标题挂回 cy-page-title(双标题)时必须判红', () => {
  const broken = { ...SOURCE, decorWxml: SOURCE.decorWxml.replace(
    SOURCE.decorWxml.match(/<cy-nav-bar[^>]*\/>/)[0], '<cy-nav-bar title="店铺装修" />\n  <cy-page-title title="店铺装修" safe-top="{{false}}" />') }
  assert.notEqual(broken.decorWxml, SOURCE.decorWxml, '负控必须真的挂回大标题')
  assert.throws(() => assertDecorChrome(broken), assert.AssertionError)
})

test('B_02:导航条标题被删(整页无题)时必须判红', () => {
  const broken = { ...SOURCE, decorWxml: SOURCE.decorWxml.replace(SOURCE.decorWxml.match(/<cy-nav-bar[^>]*\/>/)[0], '<cy-nav-bar />') }
  assert.notEqual(broken.decorWxml, SOURCE.decorWxml, '负控必须真的删掉导航条标题')
  assert.throws(() => assertDecorChrome(broken), assert.AssertionError)
})

test('B_02:导航条重复塞回公开主页操作槽时必须判红', () => {
  const broken = { ...SOURCE, decorWxml: SOURCE.decorWxml.replace(
    SOURCE.decorWxml.match(/<cy-nav-bar[^>]*\/>/)[0], '<cy-nav-bar title="店铺装修"><view slot="actions">看公开主页</view></cy-nav-bar>') }
  assert.notEqual(broken.decorWxml, SOURCE.decorWxml, '负控必须真的塞回 actions 槽')
  assert.throws(() => assertDecorChrome(broken), assert.AssertionError)
})

test('B_02:m-flush-nav 不再重设 nav 底色钩子(挂了类却不同底)时必须判红', () => {
  const broken = { ...SOURCE, merchantLight: SOURCE.merchantLight.replace(
    '--cy-comp-nav-bg: var(--cy-color-bg-page);', '') }
  assert.notEqual(broken.merchantLight, SOURCE.merchantLight, '负控必须真的移除底色钩子')
  assert.throws(() => assertDecorChrome(broken), assert.AssertionError)
})

test('玩家游玩页不挂商家/浅色主题,继续吃 default dark', () => {
  const root = SOURCE.playWxml.match(/<view class="play[^\"]*"/)
  assert.ok(root, '玩家游玩页根节点不存在')
  assert.doesNotMatch(root[0], /theme-(?:light|merchant)/)
})
