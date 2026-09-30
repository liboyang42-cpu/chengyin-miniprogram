const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertClubStateNav(source) {
  const nav = source.indexOf('<cy-nav-bar')
  const firstState = source.indexOf('<!-- 不存在/加载失败 -->')
  assert.ok(nav >= 0 && nav < firstState, 'club nav must render before error/loading/success states')
  assert.match(source, /<cy-nav-bar[^>]*custom-back[^>]*bind:back="goBack"/, 'club nav must use the page fallback')
  assert.match(source, /wx:if="\{\{notFound\}\}"/, 'club error state must stay reachable')
  assert.match(source, /wx:elif="\{\{!detailLoaded\}\}"/, 'club loading state must stay reachable')
  assert.match(source, /wx:elif="\{\{club\}\}"/, 'club success state must stay reachable')
}

function assertTemplateStateNav(source) {
  const nav = source.indexOf('<cy-nav-bar')
  const loading = source.indexOf('wx:if="{{ loading }}"')
  assert.ok(nav >= 0 && nav < loading, 'template nav must render before loading/error/success states')
  const navTag = source.match(/<cy-nav-bar[^>]*>/)
  assert.ok(navTag, 'template must render cy-nav-bar')
  // 导航统一(2026-07-29):导航条只剩返回出口,标题下沉为页面自己的大标题。
  // 这里锁两件事:①nav 上不许再挂 title(否则与 hero 大标题重复成双标题)
  //             ②标题必须真的还在页面上(否则这一页会静默变成无题页)
  assert.doesNotMatch(
    navTag[0],
    /\stitle=/,
    'template nav must not carry a title any more — 标题已下沉为 hero 大标题,nav 再挂就是双标题',
  )
  assert.match(navTag[0], /\soverlay\b/, 'template nav stays overlay on the hero cover')
  assert.match(navTag[0], /pill="\{\{!!coverUrl\}\}"/, 'pill 只在有封面时启用,无封面回落素箭头')
  assert.match(navTag[0], /custom-back[^>]*bind:back="goBack"/, 'template nav needs the page-owned back fallback')
  // 2026-07-31 Xbox 重设计:出血 hero 换成「小方封面 + 标题 + 发行方」的紧凑吸顶头。
  // 这条断言锁的东西没变 —— 标题必须真的还在页面上(nav 卸下 title 后不能连标题一起消失),
  // 只是承接它的节点从 .xb-hero-title 换成了 .xb-head-title。
  assert.match(
    source,
    /class="xb-head-title[^"]*">\{\{ info\.title \|\| '玩法' \}\}</,
    'template 标题下沉后必须由紧凑头大标题承接,不能连标题一起消失',
  )
  assert.match(source, /class="xb-state"[^>]*padding-top:\{\{statusBarHeight \+ navBarHeight \+ 24\}\}px/, 'loading/error state needs explicit safe top padding')
  assert.match(source, /wx:if="\{\{ loading \}\}"/, 'template loading state must stay reachable')
  assert.match(source, /wx:if="\{\{ loadError && !loading \}\}"/, 'template error state must stay reachable')
  assert.match(source, /wx:if="\{\{ !loading && !loadError \}\}"/, 'template success state must stay reachable')

  // 2026-07-29 ADA(WT3a):成功态 .xb-scroll 不挂行内 padding-top,显式走 --bleed 变体。
  // 2026-07-31 Xbox 重设计后这两条依然成立,但「谁来让开固定顶栏」换了机制:
  // 出血 hero 时代是封面自己垫在导航下;现在是滚动区内第一个等高 spacer + 紧凑头 sticky 到
  // 顶栏下缘。所以这里补一条:spacer 必须在,否则紧凑头会被 fixed 顶栏压住(静默失效)。
  assert.match(source, /class="xb-scroll xb-scroll--bleed"/, 'template success scroll must declare the bleed variant explicitly')
  assert.doesNotMatch(
    source,
    /class="xb-scroll[^"]*" style="padding-top:/,
    '成功态不能再挂行内 padding-top,让位由滚动区内的 spacer 负责',
  )
  assert.match(
    source,
    /<view style="height: \{\{statusBarHeight \+ navBarHeight\}\}px;"><\/view>/,
    '紧凑头前必须有等高 spacer 让开 fixed 顶栏,否则首屏标题被顶栏压住',
  )
  // 2026-08-04 按参考图(Xbox 63)重排:头部是**首屏大头、随页滚动**,不再吸顶;
  // 主动作也从固定底栏搬进页面流。原来钉死「xb-head 带 sticky top」「CTA 带 wx:if」的写法
  // 是在钉那一版的实现形态,不是在钉可达性本身,故按新形态重写 —— 立意不变:
  // 成功态必须有主动作,且主动作不许压在正文上。
  assert.match(source, /class="xb-cta"/, '成功态必须有主动作(CTA)')
  const successScroll = source.indexOf('class="xb-scroll xb-scroll--bleed"')
  assert.ok(successScroll >= 0 && source.indexOf('class="xb-cta"') > successScroll,
    'CTA 必须落在成功态滚动区内(loading/error 没有可点的主动作)')
  const ctaBtn = source.match(/<cy-btn[^>]*class="xb-cta-btn"[^>]*>/)
  assert.ok(ctaBtn, 'CTA 主按钮必须存在')
  assert.doesNotMatch(ctaBtn[0], /--cy-btn-h\s*:/, 'CTA 主按钮必须消费全站 --cy-btn-h')
  assert.match(source, /class="xb-scroll-pad"/, '正文末尾必须留收尾留白 + 安全区')
}

// CTA 进入页面流后,「正文被遮」的防线从「让位够不够」变成「它压根不许是固定层」。
function assertTemplateCtaDoesNotCoverContent(wxss) {
  const cta = wxss.match(/\.xb-cta \{[^}]*\}/s)
  assert.ok(cta, 'templatedetail 必须有 CTA 的样式')
  assert.doesNotMatch(cta[0], /position:\s*(fixed|sticky)/,
    'CTA 必须在页面流里,不能是固定/吸底层 —— 固定层会压住正文最后一段(沉浸详情踩过的坑)')

  const pad = wxss.match(/\.xb-scroll-pad \{[^}]*\}/s)
  assert.ok(pad, 'templatedetail 必须有 scroll-pad')
  assert.match(pad[0], /env\(safe-area-inset-bottom\)/, 'scroll-pad 必须把安全区一起让掉')
}

function assertSquareStandaloneNav(wxml, json, script) {
  const navTag = wxml.match(/<cy-nav-bar[\s\S]*?\/>/)
  assert.ok(navTag, 'standalone square page needs cy-nav back')
  assert.match(navTag[0], /custom-back[\s\S]*?bind:back="goBack"/, 'square nav must keep the page-owned back fallback')
  assert.equal((navTag[0].match(/\stitle=/g) || []).length, 1, 'square nav must carry exactly one title')
  assert.match(navTag[0], /\stitle="动态"/, 'square nav must carry only the user-confirmed 动态 title')
  assert.doesNotMatch(navTag[0], /推荐/, '动态标题旁不得出现推荐')
  assert.match(wxml, /class="sq-nav-spacer" style="height: \{\{statusBarHeight \+ navBarHeight\}\}px;"/, 'feed must be offset below the full fixed nav')
  // 2026-08-07 用户裁决反转:广场帖文流不设页面大标题(顶部直接进内容,对齐 Live Campfire 参考)。
  // 原「恰好一处 cy-page-title」断言随之改为「不得出现」——防有人把标题加回来。
  const pageTitles = wxml.match(/<cy-page-title[^>]*>/g) || []
  assert.equal(pageTitles.length, 0, `square feed must not render a page title, got ${pageTitles.length}`)
  assert.match(json, /"cy-nav-bar"\s*:\s*"\/components\/cy\/nav-bar\/index"/, 'square must register cy-nav')
  assert.match(json, /"cy-page-title"\s*:\s*"\/components\/cy\/page-title\/index"/, 'square must register cy-page-title')
  assert.match(script, /goBack\(\)\s*\{[\s\S]*?wx\.navigateBack\([\s\S]*?wx\.switchTab\(\{ url: '\/pages\/index\/index' \}\)/, 'standalone square back must recover to root tab only on stack failure')
  assert.match(script, /navBarHeight:\s*44/, 'square page must keep a nav-height fallback for the fixed nav spacer')
  assert.match(script, /navBarHeight: app\.globalData\.navBarHeight \|\| 44/, 'square page must use the shared nav height when available')
}

test('P0 club/template/square keep state-safe navigation and recoverable standalone back', () => {
  assertClubStateNav(read('pages/club/detail/index.wxml'))
  assertTemplateStateNav(read('pages/templatedetail/templatedetail.wxml'))
  assertTemplateCtaDoesNotCoverContent(read('pages/templatedetail/templatedetail.wxss'))
  assertSquareStandaloneNav(
    read('pages/square/list/index.wxml'),
    read('pages/square/list/index.json'),
    read('pages/square/list/index.js'),
  )
})

test('negative control: a nav moved below the club state branch is rejected', () => {
  const source = read('pages/club/detail/index.wxml')
  const mutated = source.replace('<cy-nav-bar', '<!-- removed cy-nav-bar')
  assert.throws(() => assertClubStateNav(mutated))
})

test('negative control: 把 title 挂回 template 导航条(双标题)必须判红', () => {
  const source = read('pages/templatedetail/templatedetail.wxml')
  const mutated = source.replace('<cy-nav-bar overlay', '<cy-nav-bar title="{{info.title || \'玩法详情\'}}" overlay')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertTemplateStateNav(mutated), assert.AssertionError)
})

test('negative control: template 标题下沉后紧凑头大标题被删掉必须判红', () => {
  const source = read('pages/templatedetail/templatedetail.wxml')
  const mutated = source.replace('class="xb-head-title ep2">{{ info.title || \'玩法\' }}<', 'class="xb-head-title ep2"><')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertTemplateStateNav(mutated), assert.AssertionError)
})

test('negative control: 拿掉紧凑头的顶栏让位 spacer(标题被压)必须判红', () => {
  const source = read('pages/templatedetail/templatedetail.wxml')
  const mutated = source.replace('<view style="height: {{statusBarHeight + navBarHeight}}px;"></view>', '')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertTemplateStateNav(mutated), assert.AssertionError)
})

test('negative control: square 导航加入第二标题必须判红', () => {
  const wxml = read('pages/square/list/index.wxml')
  const json = read('pages/square/list/index.json')
  const script = read('pages/square/list/index.js')
  const mutated = wxml.replace('<cy-nav-bar\n', '<cy-nav-bar\n    title="广场帖文"\n')
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSquareStandaloneNav(mutated, json, script), assert.AssertionError)
})

test('negative control: square 把页面大标题加回来必须判红(2026-08-07 裁决:帖文流无大标题)', () => {
  const wxml = read('pages/square/list/index.wxml')
  const json = read('pages/square/list/index.json')
  const script = read('pages/square/list/index.js')
  const mutated = wxml.replace(
    '    <view class="sq-nav-spacer"',
    '  <cy-page-title class="c1-page-title" title="广场帖文" safe-top="{{false}}" />\n    <view class="sq-nav-spacer"',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSquareStandaloneNav(mutated, json, script), assert.AssertionError)
})

// spacer 已经让过一次位,行内 padding-top 会让成功态二次让位(顶部空出一整条)。
test('negative control: template 成功态把 padding-top 加回来(与 spacer 二次让位)必须判红', () => {
  const source = read('pages/templatedetail/templatedetail.wxml')
  const mutated = source.replace(
    'class="xb-scroll xb-scroll--bleed"',
    'class="xb-scroll xb-scroll--bleed" style="padding-top:{{statusBarHeight + navBarHeight}}px;"',
  )
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertTemplateStateNav(mutated),
    (e) => e instanceof assert.AssertionError && /padding-top/.test(e.message),
    '加回 padding-top 必须由「让位归 spacer 管」这道闸判红',
  )
})

test('negative control: 删掉 template 主动作 CTA 必须判红', () => {
  const source = read('pages/templatedetail/templatedetail.wxml')
  const mutated = source.replace(/<view class="xb-cta">[\s\S]*?<\/view>/, '')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertTemplateStateNav(mutated),
    (e) => e instanceof assert.AssertionError && /成功态必须有主动作/.test(e.message),
    '删掉 CTA 必须由「成功态要有主动作」这道闸判红',
  )
})

test('negative control: CTA 改回固定底栏(压住正文)必须判红', () => {
  const wxss = read('pages/templatedetail/templatedetail.wxss')
  const mutated = wxss.replace('.xb-cta {\n  display: flex;', '.xb-cta {\n  position: fixed;\n  display: flex;')
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertTemplateCtaDoesNotCoverContent(mutated),
    (e) => e instanceof assert.AssertionError && /不能是固定\/吸底层/.test(e.message),
    '固定层必须由「CTA 不许压正文」这道闸判红,而不是被别的断言顺手接住',
  )
})

test('negative control: scroll-pad 不让安全区(末段被 home indicator 吃掉)必须判红', () => {
  const wxss = read('pages/templatedetail/templatedetail.wxss')
  const mutated = wxss.replace(
    /\.xb-scroll-pad \{[^}]*\}/s,
    '.xb-scroll-pad {\n  height: 80rpx;\n}',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertTemplateCtaDoesNotCoverContent(mutated),
    (e) => e instanceof assert.AssertionError && /安全区/.test(e.message),
    '不让安全区必须由「scroll-pad 要让掉安全区」这道闸判红',
  )
})
