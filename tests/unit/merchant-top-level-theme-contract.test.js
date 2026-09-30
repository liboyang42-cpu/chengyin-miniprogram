// 原生 chrome 换肤是页面级职责,分润组件化后这条仍盯页面壳。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAGES = [
  'pages/merchant/marketing/index.js',
  'pages/merchant/relation/index.js',
  'pages/merchant/citynode/index.js',
  'pages/coop/finance/index.js',
  'pages/coop/withdraw/index.js',
]
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertMerchantThemeLifecycle(source, pagePath) {
  assert.match(source, /require\(['"]\.\.\/\.\.\/\.\.\/utils\/merchant-theme\.js['"]\)/,
    `${pagePath} must use the shared merchant theme helper`)
  assert.match(source, /onShow\(\)\s*\{[\s\S]*?merchantTheme\.merchantPageShow\(\);/,
    `${pagePath} must switch the native chrome to merchant light on show`)
  assert.match(source, /onHide\(\)\s*\{\s*merchantTheme\.merchantPageRestore\(\);\s*\}/,
    `${pagePath} must restore player dark chrome on hide`)
  assert.match(source, /onUnload\(\)\s*\{[\s\S]*?merchantTheme\.merchantPageRestore\(\);[\s\S]*?\}/,
    `${pagePath} must restore player dark chrome on unload`)
}

test('merchant top-level and discover pages keep native chrome aligned with their light surface', () => {
  PAGES.forEach(pagePath => assertMerchantThemeLifecycle(read(pagePath), pagePath))
})

test('negative control: removing a lifecycle restore is rejected', () => {
  const pagePath = PAGES[0]
  const source = read(pagePath)
  const broken = source.replace(
    'onHide() { merchantTheme.merchantPageRestore(); },',
    'onHide() {},'
  )
  assert.notEqual(broken, source, 'negative control must mutate the source')
  assert.throws(() => assertMerchantThemeLifecycle(broken, pagePath), assert.AssertionError)
})

function assertSquarePlayerDomain(source, wxml) {
  assert.match(source, /onShow\(\)\s*\{[\s\S]*?merchantTheme\.merchantPageRestore\(\);/,
    'square belongs to the player content domain and must always restore dark native chrome')
  assert.doesNotMatch(source, /merchantTheme\.merchantPageShow\(\)/,
    'merchant identity must not turn the player square light')
  assert.match(wxml, /<view class="square theme-dark sq-page">/)
  assert.doesNotMatch(wxml, /theme-merchant/)
}

test('shared square stays in the player dark domain for every identity', () => {
  const source = read('pages/square/list/index.js')
  assert.match(source, /require\(['"]\.\.\/\.\.\/\.\.\/utils\/merchant-theme\.js['"]\)/)
  assert.match(source, /onHide\(\)\s*\{\s*merchantTheme\.merchantPageRestore\(\);\s*\}/)
  assert.match(source, /onUnload\(\)\s*\{[\s\S]*?merchantTheme\.merchantPageRestore\(\);[\s\S]*?\}/)
  assertSquarePlayerDomain(source, read('pages/square/list/index.wxml'))
})

test('negative control: adding a merchant light branch to square is rejected', () => {
  const source = read('pages/square/list/index.js')
  const wxml = read('pages/square/list/index.wxml')
  const brokenSource = source.replace('merchantTheme.merchantPageRestore();', 'merchantTheme.merchantPageShow();')
  const brokenWxml = wxml.replace('square theme-dark sq-page', "square {{isMerchantView ? 'theme-merchant' : 'theme-dark'}} sq-page")
  assert.notEqual(brokenSource, source, 'negative control must mutate native chrome')
  assert.notEqual(brokenWxml, wxml, 'negative control must mutate the page surface')
  assert.throws(() => assertSquarePlayerDomain(brokenSource, brokenWxml), assert.AssertionError)
})
