const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT_PATH = require.resolve('../../components/cy/slide-confirm/index.js')

function loadDefinition() {
  const previous = global.Component
  // 组件用 behaviors/reduced-motion 自读「减少动态效果」偏好,该文件靠小程序全局 Behavior() 注册
  const previousBehavior = global.Behavior
  global.Behavior = (config) => config
  let definition
  global.Component = options => { definition = options }
  delete require.cache[COMPONENT_PATH]
  require(COMPONENT_PATH)
  global.Component = previous
  global.Behavior = previousBehavior
  return definition
}

function create(properties = {}) {
  const definition = loadDefinition()
  const instance = {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), properties),
    events: [],
    setData(update) { Object.assign(this.data, update) },
    triggerEvent(name) { this.events.push(name) },
  }
  Object.assign(instance, definition.methods)
  return instance
}

test('系统取消触摸时必须弹回，不能把不可撤销动作当成松手确认', () => {
  const component = create({ state: 'release', x: 250, pct: 0.96 })
  component._dragging = true

  component.onCancel()

  assert.equal(component._dragging, false)
  assert.deepEqual(
    { state: component.data.state, x: component.data.x, pct: component.data.pct },
    { state: 'default', x: 0, pct: 0 },
  )
  assert.deepEqual(component.events, [])
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/slide-confirm/index.wxml'), 'utf8')
  assert.match(wxml, /bindtouchcancel="onCancel"/)
})

test('确认事件幂等，完成态重复点按或重复结束不会二次核销', () => {
  const component = create({ reduced: true })

  component.onTap()
  component.onTap()

  assert.equal(component.data.state, 'done')
  assert.deepEqual(component.events, ['confirm'])
})

test('拖动按组件真实左边界换算，嵌套布局不会把页面坐标当轨道坐标', () => {
  const component = create()
  component._dragging = true
  component._w = 300
  component._left = 100

  component.onMove({ touches: [{ clientX: 120 }], currentTarget: { offsetLeft: 0 } })

  assert.equal(component.data.x, 0)
  assert.equal(component.data.pct, 0)
  assert.equal(component.data.state, 'default')
})
