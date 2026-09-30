const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function assertNoFakePlayAssets(wxml, js) {
  const visibleWxml = wxml.replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(visibleWxml, /[🔒🧭👁✍🗣🧩🎲⚡👑▶❚✦✓]/u,
    '游玩页不得用 emoji 充当锁、角色、技能或榜首图标')
  assert.doesNotMatch(js, /🧭|👁|✍|🗣|🧩|🎲/u,
    '角色元数据必须引用现有 cy-icon 名称，而不是 emoji')
}

test('游玩首载与榜单首载都使用现有 skeleton，而不是裸加载文字', () => {
  const wxml = read('pages/play/index.wxml')
  const config = JSON.parse(read('pages/play/index.json'))

  assert.match(wxml, /class="play-loading"[^>]*wx:if="\{\{loading\}\}"[\s\S]*?<cy-skeleton\b/)
  assert.doesNotMatch(wxml, /class="tip"[^>]*wx:if="\{\{loading\}\}">加载中/)
  assert.match(wxml, /wx:if="\{\{board\.loading\}\}"[\s\S]*?<cy-skeleton\b/)
  assert.equal(config.usingComponents['cy-skeleton'], '/components/cy/skeleton/index')
})

test('未接后端的主题码与地点搜索不再伪装成可点能力', () => {
  const wxml = read('pages/play/index.wxml')
  const js = read('pages/play/index.js')

  assert.doesNotMatch(wxml, /bindtap="openThemeQr"|themeQr\.show|需接小程序码接口/)
  assert.doesNotMatch(js, /openThemeQr\(|themeQr:\s*\{\s*show/)
  assert.doesNotMatch(wxml, /bindtap="openPoiSearch"|name="filter-lines"/)
  assert.doesNotMatch(js, /openPoiSearch\(/)
})

test('锁定地点、角色卡、技能提示和榜首标记全部复用 cy-icon', () => {
  const wxml = read('pages/play/index.wxml')
  const js = read('pages/play/index.js')

  assertNoFakePlayAssets(wxml, js)
  assert.match(js, /NAVIGATOR:\s*\{\s*iconName:\s*'tab-explore'/)
  assert.match(wxml, /class="rolecard__emb"[\s\S]*?<cy-icon\b[^>]*name="\{\{roleCard\.iconName\}\}"/)
  assert.match(wxml, /class="rolecard__skill"[\s\S]*?<cy-icon\b[^>]*name="star"/)
  assert.match(wxml, /class="board__crown"[\s\S]*?<cy-icon\b[^>]*name="star"/)
})

test('负控：把榜首 DS 图标换回 emoji 会让资源真实性守卫判红', () => {
  const wxml = read('pages/play/index.wxml')
  const mutated = wxml.replace(
    /<view class="board__crown"[^>]*>[\s\S]*?<\/view>/,
    '<text class="board__crown">👑</text>',
  )
  assert.notEqual(mutated, wxml, '负控必须真实改动榜首标记')
  assert.throws(() => assertNoFakePlayAssets(mutated, read('pages/play/index.js')), /emoji/)
})
