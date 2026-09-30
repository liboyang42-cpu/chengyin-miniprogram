const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAGES = [
  ['pages/publish/temp/index', 'goBack'],
  ['pages/merchant/apply/index', 'onHeaderBack'],
  ['pages/merchant/ledger/index', 'onNavBack'],
  ['pages/merchant/citynode/index', 'onNavBack'],
]
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertBusinessNavSource(base, callback, wxml, json) {
  assert.match(wxml, new RegExp(`<cy-nav-bar[^>]*custom-back[^>]*bind:back="${callback}"`), `${base} must use cy-nav custom back`)
  assert.match(wxml, /class="(?:cg|merchant-apply2|merchant-apply|ledger|cn)-nav-spacer"[^>]*style="[^\"]*\{\{\s*statusBarHeight\s*\+\s*navBarHeight\s*\}\}\s*px;"/, `${base} must offset content below the fixed nav`)
  assert.match(json, /"cy-nav-bar"\s*:\s*"\/components\/cy\/nav-bar\/index"/, `${base} must register cy-nav`)
}

function assertBusinessNav(base, callback) {
  assertBusinessNavSource(base, callback, read(`${base}.wxml`), read(`${base}.json`))
}

test('P1 business editors use one cy-nav contract without retaining per-page mnav markup', () => {
  PAGES.forEach(([base, callback]) => assertBusinessNav(base, callback))
  const markup = PAGES.map(([base]) => read(`${base}.wxml`)).join('\n')
  assert.doesNotMatch(markup, /class="(?:mnav|cg-topbar|topbar|ledger-nav|cn-nav)(?:"|\s)/, 'business pages must not render legacy mnav shells')
})

test('negative control: replacing a cy-nav with legacy mnav markup is rejected', () => {
  const base = 'pages/merchant/ledger/index'
  const original = read(`${base}.wxml`)
  const json = read(`${base}.json`)
  const mutated = original.replace('<cy-nav-bar', '<view class="mnav"')
  assert.notEqual(mutated, original, '变异锚点失效')
  assert.throws(() => assertBusinessNavSource(base, 'onNavBack', mutated, json), {
    name: 'AssertionError',
    message: /pages\/merchant\/ledger\/index must use cy-nav custom back/,
  })
})
