const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const XCX = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(XCX, file), 'utf8')

function assertCompletionIcon({ wxml, json }) {
  const badge = wxml.match(/<view class="ap-badge">([\s\S]*?)<\/view>/)
  assert.ok(badge, '已通关活动必须保留 ap-badge 容器')
  assert.match(badge[1], /<cy-icon\s+name="check"\s+size="40"\s*\/>/,
    '已通关活动必须使用 DS check 图标')
  assert.doesNotMatch(badge[1], /🏆/, '正式 UI 不得回退为奖杯 emoji')
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index',
    'activity-picker 必须注册 DS cy-icon 组件')
}

test('已通关活动用 DS check 图标而非奖杯 emoji', () => {
  const source = {
    wxml: read('pages/square/components/activity-picker/index.wxml'),
    json: JSON.parse(read('pages/square/components/activity-picker/index.json')),
  }

  assertCompletionIcon(source)

  assert.throws(() => assertCompletionIcon({
    ...source,
    wxml: source.wxml.replace(/<cy-icon\s+name="check"\s+size="40"\s*\/>/, ''),
  }), /DS check 图标/)
  assert.throws(() => assertCompletionIcon({
    ...source,
    wxml: source.wxml.replace(/<cy-icon\s+name="check"\s+size="40"\s*\/>/, '🏆'),
  }), /DS check 图标/)
})
