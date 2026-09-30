const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('三个主理人入口统一到俱乐部详情，旧 workbench 路由仅保留深链兼容', () => {
  const app = JSON.parse(read('app.json'))
  const clubPackage = app.subPackages.find((item) => item.root === 'pages/club')
  assert.ok(clubPackage)
  assert.ok(clubPackage.pages.includes('workbench/index'), '旧外部深链路由不得删除')

  const settings = read('pages/shezhi/shezhi.js')
  assert.equal((settings.match(/\/pages\/club\/detail\/index\?owner=1/g) || []).length, 2)
  assert.doesNotMatch(settings, /\/pages\/club\/workbench\/index/)

  const shell = read('pages/club/workbench/index.js')
  assert.match(shell, /options\.id\s*\|\|\s*options\.clubId/)
  assert.match(shell, /wx\.redirectTo\(\{[\s\S]*?url:\s*target,[\s\S]*?fail\(\)/,
    '深链跳转必须消费 redirectTo 失败，不能让壳永久停在 loading')
  assert.match(shell, /\/pages\/club\/detail\/index\?owner=1/)
  assert.doesNotMatch(shell, /\/api\/club\/(?:my|detail|topics)|\/api\/coop\/(?:finance|list)/,
    '深链壳不得保留第二套工作台请求')
})

test('俱乐部详情用第四个 owner-only 管理 tab 承接工作台，页壳保持 C 端深色', () => {
  const page = read('pages/club/detail/index.js')
  const view = read('pages/club/detail/index.wxml')
  const style = read('pages/club/detail/index.wxss')

  assert.match(view, /<cy-tabs\b[^>]*tabs="\{\{clubTabs\}\}"[^>]*active="\{\{activeTab\}\}"/)
  assert.match(page, /\{ key: 'posts', label: '帖子' \}/)
  assert.match(page, /\{ key: 'events', label: '活动' \}/)
  assert.match(page, /\{ key: 'overview', label: '概览' \}/)
  assert.match(page, /PUBLIC_TABS\.concat\(\[\{ key: 'manage', label: '管理' \}\]\)/)
  assert.match(view, /activeTab === 'manage'/)
  assert.match(page, /url:\s*'\/api\/project\/my'/)
  assert.match(page, /url:\s*'\/api\/coop\/list'/)
  assert.match(page, /url:\s*'\/api\/club\/topics'/)
  assert.doesNotMatch(style, /merchant-light|theme-light|theme-merchant/)
})

test('俱乐部详情与深链壳都不展示收益或分账概览', () => {
  const sources = [
    read('pages/club/detail/index.js'),
    read('pages/club/detail/index.wxml'),
    read('pages/club/workbench/index.js'),
    read('pages/club/workbench/index.wxml'),
  ].join('\n')
  assert.doesNotMatch(sources, /\/api\/coop\/finance/)
  assert.doesNotMatch(sources, /已结算收益|分账概览|俱乐部分账|待结算项目/)
})

test('workbench 深链壳仍使用既有标题系统', () => {
  const config = JSON.parse(read('pages/club/workbench/index.json'))
  const view = read('pages/club/workbench/index.wxml')
  const style = read('pages/club/workbench/index.wxss')
  assert.equal(config.navigationStyle, 'custom')
  assert.equal(config.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index')
  assert.equal(config.usingComponents['cy-page-title'], '/components/cy/page-title/index')
  assert.match(view, /<cy-nav-bar\s*\/>\s*<cy-page-title\b[^>]*safe-top="\{\{false\}\}"/)
  assert.match(view, /仅服务外部直达/)
  assert.doesNotMatch(style, /--cy-text-primary|--cy-space-xl/, '深链壳不得引用未定义 token')
})
