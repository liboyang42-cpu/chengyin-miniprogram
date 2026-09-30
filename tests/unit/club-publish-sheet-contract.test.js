const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const JS = path.join(root, 'components/cy/club-publish-sheet/index.js')
const WXML = path.join(root, 'components/cy/club-publish-sheet/index.wxml')

test('G1 三选一：图标名取自已登记 icon 集，choose 事件只带合法 key', () => {
  const wxml = fs.readFileSync(WXML, 'utf8')
  // T1：标题 + ✕（cy-scene-sheet 内置），没有独立圆底热区之外的裸文字关闭符。
  assert.match(wxml, /variant="half"/)
  assert.doesNotMatch(wxml, />\s*\+\s*</, '不得用文字/符号伪造图标')

  let config
  global.Component = value => { config = value }
  delete require.cache[require.resolve(JS)]
  require(JS)

  const keys = config.data.options.map(item => item.key)
  assert.deepEqual(keys, ['city', 'explore', 'event'])
  const icons = config.data.options.map(item => item.icon)
  assert.deepEqual(icons, ['flag', 'tab-explore', 'calendar'])
})

test('负控：未登记的 key 不会触发 choose 事件', () => {
  let config
  global.Component = value => { config = value }
  delete require.cache[require.resolve(JS)]
  require(JS)

  const events = []
  const vm = Object.assign({}, config, {
    triggerEvent(name, detail) { events.push({ name, detail }) },
  })

  vm.methods.onChoose.call(vm, { currentTarget: { dataset: { key: 'not-a-real-option' } } })
  assert.deepEqual(events, [], '未登记的 key 必须被拦下，不能把伪造 key 透传给调用方')

  vm.methods.onChoose.call(vm, { currentTarget: { dataset: { key: 'event' } } })
  assert.deepEqual(events, [{ name: 'choose', detail: { key: 'event' } }])
})
