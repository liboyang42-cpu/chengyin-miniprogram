'use strict'

/* F-PK-4 / 审查 #27:cy-calendar 的 maxRange 越界时「既不落值也不提示」,只抛一个
 * 全仓没人监听的 overrange 事件就 return。对用户的表现是「点了第二头,啥也没发生」。
 *
 * 修的方向按审查给的默认提示档:组件自己先给一句看得懂的话,宿主仍可按需接 overrange
 * 换说法(事件必须照常往外抛,不能被默认文案吃掉)。
 *
 * 这里跑真组件代码,不靠正则读源码:提示文案的计数口径(天含首尾 / 晚不含尾日)
 * 只有真调用才验得出来。 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT = path.join(ROOT, 'pages/topic/components/cy/date-range-sheet/index.js')

function mount(patchData) {
  const previousComponent = global.Component
  const previousBehavior = global.Behavior
  let definition = null
  global.Behavior = () => ({})
  global.Component = (config) => { definition = config }
  delete require.cache[require.resolve(path.join(ROOT, 'behaviors/reduced-motion.js'))]
  delete require.cache[require.resolve(COMPONENT)]
  require(COMPONENT)
  global.Component = previousComponent
  global.Behavior = previousBehavior

  const data = Object.assign({}, definition.data, patchData)
  Object.entries(definition.properties || {}).forEach(([name, spec]) => {
    if (!(name in data)) data[name] = spec && spec.value
  })
  const events = []
  const component = Object.assign({}, definition.methods, {
    data,
    setData(patch) { Object.entries(patch).forEach(([key, value]) => { data[key] = value }) },
    triggerEvent(name, detail) { events.push({ name, detail }) },
  })
  return { component, data, events }
}

test('越界时组件自己给一句人话,并且仍然把 overrange 抛给宿主', () => {
  const { component, data, events } = mount({ unit: 'day' })

  component.onOverrange({ detail: { value: ['2026-09-01', '2026-09-11'], span: 11, max: 7 } })

  assert.ok(data._overTitle, '必须立刻有标题,不能只留一个事件')
  assert.match(data._overTitle, /最多选 7 天/)
  assert.match(data._overSub, /11 天/)
  assert.match(data._overSub, /请重新选结束日期/)
  assert.deepEqual(events.map(e => e.name), ['overrange'], '宿主钩子不能被默认文案吃掉')
  assert.equal(events[0].detail.span, 11)
})

test('按晚计数时换算掉尾日:maxRange=3 天含首尾 = 最多 2 晚,4 天跨度 = 3 晚', () => {
  const { component, data } = mount({ unit: 'night' })

  component.onOverrange({ detail: { value: ['2026-09-01', '2026-09-04'], span: 4, max: 3 } })

  assert.equal(data._overTitle, '最多选 2 晚')
  assert.match(data._overSub, /^刚点的这一头是 3 晚/)
})

test('跨度缺失时兜底说法仍在,不许退回「点了没反应」', () => {
  const { component, data } = mount({ unit: 'day' })

  component.onOverrange({ detail: {} })

  assert.ok(data._overTitle)
  assert.ok(data._overSub)
})

test('值一落地提示必须退场,否则好的区间也挂着一条「有错」', () => {
  const { component, data } = mount({ unit: 'day' })
  component.onOverrange({ detail: { value: ['2026-09-01', '2026-09-11'], span: 11, max: 7 } })
  assert.ok(data._overTitle)

  component.onCalChange({ detail: { value: ['2026-09-01', '2026-09-03'] } })

  assert.equal(data._overTitle, '')
  assert.equal(data._overSub, '')
  assert.equal(data._span, 3)
})

test('提示走 cy-inline-error 且组件真的注册了它(漏注册等于渲染不出来)', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/topic/components/cy/date-range-sheet/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/topic/components/cy/date-range-sheet/index.json'), 'utf8'))

  const tag = wxml.match(/<cy-inline-error[\s\S]*?\/>/)
  assert.ok(tag, '越界提示必须用站内联反馈组件,不能自造一行字')
  assert.match(tag[0], /wx:if="\{\{_overTitle\}\}"/)
  assert.match(tag[0], /kind="data"/, '选长了不是动作失败,不能穿红色失败衣')
  // #1103 下沉后组件住在 pages/topic,注册路径改回指主包 components/cy/inline-error
  assert.ok(String(json.usingComponents['cy-inline-error']).endsWith('/components/cy/inline-error/index'))
  assert.ok(fs.existsSync(path.join(ROOT, 'components/cy/inline-error/index.js')))
})
