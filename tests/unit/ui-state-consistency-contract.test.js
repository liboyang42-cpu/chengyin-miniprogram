const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const readJson = (relativePath) => JSON.parse(read(relativePath))

function assertLoadingState(wxmlPath, jsonPath, wxml = read(wxmlPath), json = readJson(jsonPath)) {
  assert.ok(json.usingComponents['cy-skeleton'], `${jsonPath} must register cy-skeleton`)
  assert.match(wxml, /<cy-skeleton[\s\S]*type="card"/, `${wxmlPath} must render a card skeleton`)
  assert.equal(/>[^<]*加载中[.…]/.test(wxml), false, `${wxmlPath} must not render a bare loading label`)
}

test('loading states use the shared skeleton instead of a lone loading label', () => {
  const cases = [
    ['subpackageA/pages/myproject/index.wxml', 'subpackageA/pages/myproject/index.json'],
    ['pages/activity/baoming/baoming.wxml', 'pages/activity/baoming/baoming.json'],
    ['pages/merchant/coop-center/index.wxml', 'pages/merchant/coop-center/index.json'],
  ]
  cases.forEach(([wxmlPath, jsonPath]) => {
    assertLoadingState(wxmlPath, jsonPath)
  })
})

// 2026-08-11:旧页收成兼容壳。约束升级而不是取消 —— 冷启动(转发卡片 / 收藏)进来的人
// 没有上一页,只给「返回」等于把人困在空壳里。所以主 CTA 必须是回首页,返回按栈深条件出。
test('merchant profile dead ends explain themselves and always offer a safe landing', () => {
  const wxml = read('pages/merchant/profile/index.wxml')
  const js = read('pages/merchant/profile/index.js')
  assert.match(wxml, /title="商家不存在或未开放"/)
  assert.match(wxml, /title="链接参数无效"/)
  assert.match(wxml, /<cy-skeleton wx:if="\{\{state === 'loading' \|\| state === 'redirecting'\}\}" type="card"/)
  assert.match(wxml, /sub="[^\"]+"/)
  assert.match(wxml, /cta="回首页" bind:cta="goHome"/)
  assert.match(js, /goHome\(\)\s*\{\s*wx\.switchTab/)
  assert.match(wxml, /wx:if="\{\{canBack\}\}"[^>]*bindtap="goBack"/,
    '「返回」必须按栈深条件出,不能无条件渲染')
  assert.match(js, /canBack:\s*typeof getCurrentPages[\s\S]{0,80}getCurrentPages\(\)\.length > 1/)
  assert.match(js, /goBack\(\)\s*\{\s*wx\.navigateBack/)
})

test('negative control: removing the shared skeleton is rejected by the skeleton guard', () => {
  const wxmlPath = 'pages/activity/baoming/baoming.wxml'
  const jsonPath = 'pages/activity/baoming/baoming.json'
  const source = read(wxmlPath)
  const mutated = source.replace('<cy-skeleton wx:if="{{pageState === \'loading\'}}" type="card" count="{{skeletonItems.length}}" />', '')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assertLoadingState(wxmlPath, jsonPath, mutated), {
    name: 'AssertionError',
    message: /baoming\.wxml must render a card skeleton/,
  })
})

test('negative control: a bare loading label is rejected by the label guard', () => {
  const wxmlPath = 'pages/activity/baoming/baoming.wxml'
  const jsonPath = 'pages/activity/baoming/baoming.json'
  const source = read(wxmlPath)
  const mutated = source.replace('</view>', '<view>活动信息加载中…</view>\n</view>')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assertLoadingState(wxmlPath, jsonPath, mutated), {
    name: 'AssertionError',
    message: /baoming\.wxml must not render a bare loading label/,
  })
})
