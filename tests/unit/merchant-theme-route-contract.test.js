const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  THEMELESS_REDIRECT_SHELLS,
  classifyPageDomain,
  hasPageEntityMarkup,
  pageRoutes,
  topLevelThemeClasses,
} = require('../../scripts/ui-theme-unit-lint')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function assertMerchantThemeRoot(source, route) {
  const themes = topLevelThemeClasses(source)
  assert.ok(themes.has('theme-merchant') || themes.has('theme-topic-editor'),
    `${route}:页面顶层必须含 theme-merchant 或 theme-topic-editor`)
  assert.equal(themes.has('theme-dark'), false, `${route}:商家页禁止声明 theme-dark`)
}

test('商家工作域从 app.json 自动发现且页面顶层显式挂商家主题', () => {
  const app = JSON.parse(read('app.json'))
  const merchantRoutes = pageRoutes(app).filter((route) => classifyPageDomain(route) === 'merchant')
  assert.ok(merchantRoutes.length > 0, '必须自动发现至少一个商家域页面')
  merchantRoutes.forEach((route) => {
    const source = read(`${route}.wxml`)
    if (THEMELESS_REDIRECT_SHELLS.has(route)) {
      assert.equal(hasPageEntityMarkup(source), false, `${route}:重定向壳不得伪造主题根节点`)
      return
    }
    assertMerchantThemeRoot(source, route)
  })
  assert.deepEqual(
    merchantRoutes.filter((route) => THEMELESS_REDIRECT_SHELLS.has(route)),
    ['pages/publish/topicadd/topicadd'],
    '无实体主题根的商家域重定向壳必须保持显式、唯一',
  )
})

test('负控:topicadd 重定向壳重新渲染实体节点必须判红', () => {
  const broken = '<view class="theme-topic-editor"></view>'
  assert.equal(hasPageEntityMarkup(broken), true, '重定向壳长回实体 UI 后必须离开无主题豁免')
})

test('负控:从任一商家页面根摘掉 theme-merchant 会被拒绝', () => {
  const app = JSON.parse(read('app.json'))
  const route = pageRoutes(app).find((candidate) => classifyPageDomain(candidate) === 'merchant'
    && topLevelThemeClasses(read(`${candidate}.wxml`)).has('theme-merchant'))
  assert.ok(route, '必须自动发现至少一个 theme-merchant 页面供负控使用')
  const source = read(`${route}.wxml`)
  const broken = source.replace(/\s*theme-merchant\b/, '')
  assert.notEqual(broken, source, '负控必须实际摘掉主题 class')
  assert.throws(() => assertMerchantThemeRoot(broken, route), /页面顶层必须含/)
})

test('我的项目使用商家浅色桥接，旧版卡片 token 不得停留在深色 page 快照', () => {
  const wxss = read('subpackageA/pages/myproject/index.wxss')
  assert.match(wxss, /^@import\s+['"]\.\.\/\.\.\/\.\.\/style\/merchant-light\.wxss['"];/)
})
