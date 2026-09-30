'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const TARGETS = [
  'pages/topic/components/cy/chapter-node-form/index',
  'components/cy/profile/index',
  'components/cy/scene-sheet/index',
  'components/cy/search/index',
  'components/cy/sheet/index',
  'components/cy/upload/index',
  'pages/play/components/story-sheet/index',
  'pages/publish/components/creation-success/index',
  'pages/publish/components/reward-selector/index',
  'subpackageMember/coupon-qr/index',
]

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const visibleSource = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

function assertRealIconContract() {
  for (const base of TARGETS) {
    const view = visibleSource(read(`${base}.wxml`))
    const config = JSON.parse(read(`${base}.json`))
    assert.doesNotMatch(view, /[›‹×✕＋✓]/, `${base} 仍以文字字符充当图标`)
    assert.match(view, /<cy-icon\b/, `${base} 没有接入统一图标组件`)
    assert.equal(config.usingComponents && config.usingComponents['cy-icon'], '/components/cy/icon/index', `${base} 未注册 cy-icon`)
  }

  const progress = visibleSource(read('components/cy/level-progress/index.wxml'))
  assert.doesNotMatch(progress, /→/, '升级提示不应以箭头字符充当视觉图标')
}

test('高频共享组件不再用文字字符伪造返回、关闭、勾选与箭头图标', () => {
  assertRealIconContract()
})

test('负控：恢复一个文字关闭图标时契约必须判红', () => {
  const base = 'components/cy/search/index'
  const source = read(`${base}.wxml`)
  const mutated = source.replace(/<cy-icon\b[^>]*name="close-sm"[^>]*\/>/, '<text>✕</text>')
  assert.notEqual(mutated, source)
  assert.match(visibleSource(mutated), /✕/)
})

// 发布菜单按已确认原型使用同一套 Microsoft 3D PNG。
test('发布菜单使用真实 3D 素材', () => {
  const view = read('components/cy/publish-sheet/index.wxml')
  for (const name of ['explore', 'city', 'interaction', 'return']) {
    assert.ok(view.includes('/images/publish-quick/' + name + '.png'))
    assert.ok(fs.statSync(path.join(ROOT, 'images/publish-quick', name + '.png')).size > 1000)
  }
})
