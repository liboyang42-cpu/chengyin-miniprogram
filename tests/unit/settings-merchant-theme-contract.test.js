const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertSettingsTheme(script, wxml, wxss) {
  assert.match(script, /require\(['"]\.\.\/\.\.\/utils\/merchant-theme\.js['"]\)/, 'settings must use the shared merchant theme lifecycle')
  assert.match(script, /syncViewStateAndTheme\(\)[\s\S]*?merchantTheme\.merchantPageShow\(\)[\s\S]*?merchantTheme\.merchantPageRestore\(\)/, 'merchant and player views must select opposite native themes')
  assert.match(script, /onHide\(\)\s*\{\s*merchantTheme\.merchantPageRestore\(\);\s*\}/, 'settings must restore player theme on hide')
  assert.match(script, /onUnload\(\)\s*\{\s*merchantTheme\.merchantPageRestore\(\);\s*\}/, 'settings must restore player theme on unload')
  assert.match(wxml, /class="sz-page \{\{isMerchantView \? 'theme-merchant' : 'theme-dark'\}\}"/, 'settings root must keep merchant/player themes distinct')
  assert.match(wxss, /min-height:\s*198rpx/, 'profile card must reserve avatar and edit-action height')
  assert.match(wxss, /padding-right:\s*120rpx/, 'profile text must clear the edit action')
}

const SHARED_PAGES = [
  { name: '活动详情', dir: 'pages/activity/detail', root: 'detail' },
  { name: '官方活动邀约', dir: 'pages/activity/official-inbox', root: 'oi-page' },
  { name: '我发布的官方活动', dir: 'pages/activity/official-mine', root: 'om-page' },
  { name: '俱乐部列表', dir: 'pages/talent/list', root: 'talent-v2', tabBar: true },
].map((page) => ({
  ...page,
  script: read(`${page.dir}/index.js`),
  wxml: read(`${page.dir}/index.wxml`),
  wxss: read(`${page.dir}/index.wxss`),
}))

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 旧断言把 talent/list 永远钉成深色,实际想守的是「共用页两种身份不能互相污染」。
// 2026-08-05 用户已把这些共用页统一裁决为:商家根作用域走 theme-merchant,玩家走
// theme-dark；同时原生导航栏跟身份同步,离页恢复 dark。这里按每个具体页面判语义,
// 不再用某个固定 class 字面形态代表所有身份。
function assertSharedPageTheme(page) {
  const rootTheme = new RegExp(
    `class="[^\"]*${escapeRegExp(page.root)}[^\"]*\\{\\{\\s*isMerchantViewer\\s*\\?\\s*'theme-merchant'\\s*:\\s*'theme-dark'\\s*\\}\\}[^\"]*"`
  )
  assert.match(page.wxml, rootTheme, `${page.name}根节点必须按身份切换商家浅色/玩家深色`)
  assert.match(page.script, /identity\/identity-policy\.js/, `${page.name}必须复用统一身份策略`)
  assert.match(page.script, /policy\.isMerchantView\s*\(/, `${page.name}必须由 identity-policy 判商家视角`)
  assert.match(page.script, /merchant-theme\.js/, `${page.name}必须复用原生栏主题生命周期`)
  assert.match(page.script, /merchantPageShow\s*\(/, `${page.name}商家显示时必须切浅色原生栏`)
  assert.match(page.script, /merchantPageRestore\s*\(/, `${page.name}玩家显示/离页时必须恢复深色原生栏`)

  const rootSurface = new RegExp(
    `\\.${escapeRegExp(page.root)}\\s*\\{[^}]*min-height:\\s*100vh[^}]*background:\\s*var\\(--cy-(?:color-)?bg-(?:page|card)\\)`
  )
  assert.match(page.wxss, rootSurface, `${page.name}根节点必须用主题变量覆盖整屏底色`)

  const consumesLegacyAlias = /var\(--cy-(?:bg|text|border|btn)-/.test(page.wxss)
  if (consumesLegacyAlias) {
    assert.match(page.wxss, /@import\s+['"][^'"]*merchant-light-scope\.wxss['"];/,
      `${page.name}消费旧 alias 时必须在根作用域重新桥接日间值`)
  }

  if (page.tabBar) {
    assert.match(page.wxml, /<tabBar\s+dark="\{\{!isMerchantViewer\}\}"\s+monochrome="\{\{!isMerchantViewer\}\}"\s*\/>/,
      `${page.name}底部栏必须随商家浅色/玩家深色切换`)
  }
}

test('P1 settings synchronizes merchant native theme and preserves profile card hit targets', () => {
  assertSettingsTheme(
    read('pages/shezhi/shezhi.js'),
    read('pages/shezhi/shezhi.wxml'),
    read('pages/shezhi/shezhi.wxss'),
  )
})

test('P1 玩家商家共用页:商家浅色、玩家深色,且原生栏生命周期一致', () => {
  SHARED_PAGES.forEach(assertSharedPageTheme)
})

test('negative control:任一共用页把商家分支改回深色都必须判红', () => {
  SHARED_PAGES.forEach((page) => {
    const mutated = {
      ...page,
      wxml: page.wxml.replace("'theme-merchant' : 'theme-dark'", "'theme-dark' : 'theme-dark'"),
    }
    assert.notEqual(mutated.wxml, page.wxml, `${page.name}负控必须真的改坏商家分支`)
    assert.throws(() => assertSharedPageTheme(mutated), assert.AssertionError)
  })
})

test('negative control:消费旧 alias 的页面摘掉 merchant bridge 必须判红', () => {
  SHARED_PAGES.filter((page) => /var\(--cy-(?:bg|text|border|btn)-/.test(page.wxss)).forEach((page) => {
    const mutated = {
      ...page,
      wxss: page.wxss.replace(/@import\s+['"][^'"]*merchant-light-scope\.wxss['"];?\s*/, ''),
    }
    assert.notEqual(mutated.wxss, page.wxss, `${page.name}负控必须真的移除 merchant bridge`)
    assert.throws(() => assertSharedPageTheme(mutated), assert.AssertionError)
  })
})

test('negative control:talent/list 底部栏锁回深色必须判红', () => {
  const page = SHARED_PAGES.find((item) => item.tabBar)
  const mutated = {
    ...page,
    wxml: page.wxml.replace(
      'dark="{{!isMerchantViewer}}" monochrome="{{!isMerchantViewer}}"',
      'dark="{{true}}" monochrome="{{true}}"',
    ),
  }
  assert.notEqual(mutated.wxml, page.wxml, '负控必须真的把 talent/list 底部栏锁回深色')
  assert.throws(() => assertSharedPageTheme(mutated), assert.AssertionError)
})
