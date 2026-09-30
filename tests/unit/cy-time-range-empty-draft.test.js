'use strict'

/* cy-time-range 空值起草契约(2026-08-27)。
 *
 * 缺陷形态:调用方没传值时内部记 '',而界面显示 00:00。
 * 首次设时段只改「结束」→ 点完成 → _ok 恒 false 且 _hint 恒 '':面板不关、值不落、零提示。
 * 契约:打开面板时内部值必须与界面所见一致(空值按界面显示值 00:00 初始化),
 * _revalidate 正常给 hint,onConfirm 抛出的就是用户看到的那两个时间。
 *
 * 2026-08-27 形态迁移:双滚轮 picker-view 换成自绘的「减—数值—加」调节器
 * (原生滚轮的白色渐变遮罩覆不成深色)。契约本身一条没变,只是操作入口
 * 从 onStart/onEnd(滚轮下标)换成 onStep / onDragStart+onDragMove(±与拖动),
 * 而「所记 = 所见」的真源从内部字符串换成 data._startText/_endText。 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const COMPONENT_JS = path.resolve(__dirname, '../../pages/merchant/components/cy/time-range/index.js')
const DRAG_PX_PER_STEP = 12   // 与组件内常量一致;改一边这里必须跟着改

let componentConfig
global.Behavior = (config) => config
global.Component = (config) => { componentConfig = config }
delete require.cache[COMPONENT_JS]
require(COMPONENT_JS)

function makeInstance(props) {
  const events = []
  const instance = {
    data: Object.assign(
      JSON.parse(JSON.stringify(componentConfig.data)),
      // properties 的默认值摊进 data(与真实运行时一致)
      Object.keys(componentConfig.properties).reduce((acc, k) => {
        acc[k] = JSON.parse(JSON.stringify(componentConfig.properties[k].value))
        return acc
      }, {}),
      props || {}
    ),
    setData(patch, cb) {
      Object.keys(patch).forEach((k) => { instance.data[k] = patch[k] })
      cb && cb()
    },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    __events: events,
  }
  Object.keys(componentConfig.methods).forEach((name) => {
    instance[name] = componentConfig.methods[name].bind(instance)
  })
  return instance
}

/** 模拟打开面板:跑 'show, value, minuteStep' observer */
function open(instance) {
  instance.data.show = true
  componentConfig.observers['show, value, minuteStep'].call(instance, true)
}

/** 走真实的拖动入口把某一头挪 steps 格(正数向后) */
function drag(instance, which, steps) {
  const target = { currentTarget: { dataset: { which: which } } }
  instance.onDragStart(Object.assign({ touches: [{ clientX: 0 }] }, target))
  instance.onDragMove(Object.assign({ touches: [{ clientX: steps * DRAG_PX_PER_STEP }] }, target))
  instance.onDragEnd()
}

/** 走真实的 ± 入口点一下 */
function tapStep(instance, which, dir) {
  instance.onStep({ currentTarget: { dataset: { which: which, dir: dir } } })
}

test('空值打开:内部值 = 界面所见(00:00),提示与确认键状态如实反映', () => {
  const inst = makeInstance({ value: [] })
  open(inst)
  assert.equal(inst.data._startText, '00:00', '内部开始值必须等于界面显示的 00:00')
  assert.equal(inst.data._endText, '00:00')
  assert.equal(inst.data._ok, false)
  assert.equal(inst.data._hint, '结束时间要晚于开始时间',
    '00:00–00:00 不合法,必须当场说清而不是留一个静默的确定键')
})

test('首次只改「结束」→ 完成:值如实落下,不再静默吞掉', () => {
  const inst = makeInstance({ value: [] })
  open(inst)
  drag(inst, 'end', 120)          // step=5 分钟 × 120 格 = 10:00
  assert.equal(inst.data._endText, '10:00')
  assert.equal(inst.data._ok, true)
  inst.onConfirm()
  const confirms = inst.__events.filter((e) => e.name === 'confirm')
  assert.equal(confirms.length, 1, '合法时段点完成必须抛 confirm')
  assert.deepEqual(confirms[0].detail.value, ['00:00', '10:00'],
    '落下去的必须就是界面显示的那两个时间')
  assert.equal(confirms[0].detail.minutes, 600)
})

test('既有行为不回归:非空值仍按 minuteStep 吸附后回写', () => {
  const inst = makeInstance({ value: ['09:07', '10:00'], minuteStep: 5 })
  open(inst)
  assert.equal(inst.data._startText, '09:05', '09:07 在 step=5 下吸附成 09:05')
  assert.equal(inst.data._endText, '10:00')
  assert.equal(inst.data._ok, true)
})

test('± 一下正好走一格,且绕回一天之内不越界', () => {
  const inst = makeInstance({ value: ['00:00', '23:45'], minuteStep: 15 })
  open(inst)
  tapStep(inst, 'end', 1)
  assert.equal(inst.data._endText, '00:00', '23:45 再加一格绕回 00:00,不许出现 24:00')
  tapStep(inst, 'start', -1)
  assert.equal(inst.data._startText, '23:45', '00:00 减一格绕到前一天末尾,不许出现负时间')
})

test('拖动以「按下时的值 + 总位移」计算:来回滑一趟必须回到原处', () => {
  const inst = makeInstance({ value: ['09:00', '12:00'], minuteStep: 15 })
  open(inst)
  const target = { currentTarget: { dataset: { which: 'start' } } }
  inst.onDragStart(Object.assign({ touches: [{ clientX: 0 }] }, target))
  // 每步 +7px:不足半格(12px),按绝对位移算一路都是 0~4 格、最后回 0 即回到 09:00;
  // 若改成增量累加,每步都被 round 成整整一格,余数攒六次就回不去了。
  // ⚠️ 抖动序列要挑得能让两种实现分开 —— 随手写的来回抖动会碰巧殊途同归(实测过一次假绿)。
  for (const x of [7, 14, 21, 28, 35, 42, 0]) {
    inst.onDragMove(Object.assign({ touches: [{ clientX: x }] }, target))
  }
  inst.onDragEnd()
  assert.equal(inst.data._startText, '09:00')
})

test('负控:内部值与界面所见脱钩(旧实现形态)时,同一操作序列 = 零事件零提示', () => {
  const inst = makeInstance({ value: [] })
  open(inst)
  // 手工回退到旧实现的内部状态:界面显示 00:00,内部记 ''
  inst.setData({ _startText: '', _endText: '' })
  drag(inst, 'end', 120)
  inst.onConfirm()
  assert.equal(inst.__events.filter((e) => e.name === 'confirm').length, 0,
    '旧状态下 confirm 发不出去 —— 上面两条契约抓的就是这个静默失败')
  assert.notEqual(inst.data._hint, '结束时间要晚于开始时间',
    '负控必须与修后行为可区分,否则契约什么也没证明')
})
