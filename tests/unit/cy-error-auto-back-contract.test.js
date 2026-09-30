/* cy-error auto-back(2026-09-15 弹窗合同 · 稿 356-5220)
 * 整页失败 = 零按钮 fail 半屏讲原因,收起后自动返回。锁住三件会静默出错的事:
 *   ① 失败原因必须真画进面板(title + why=sub),不能变成无声返回;
 *   ② 返回只走一次(到点收起与点遮罩可能先后到);
 *   ③ 栈>1 回退、栈=1 按身份域 reLaunch;custom-back 时交给页面,组件不自己导航。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT = path.join(ROOT, 'components/cy/error/index.js')

function mount(props, stack) {
  let def = null
  global.Component = (c) => { def = c }
  delete require.cache[require.resolve(COMPONENT)]
  require(COMPONENT)
  delete global.Component
  const data = Object.assign({}, def.data)
  for (const [k, spec] of Object.entries(def.properties)) data[k] = spec.value
  Object.assign(data, props)
  const nav = []
  global.getCurrentPages = () => stack
  global.wx = {
    navigateBack: () => nav.push('back'),
    reLaunch: (o) => nav.push('reLaunch:' + o.url),
  }
  const inst = Object.assign({ data, events: [], nav }, def.methods, {
    setData(d) { Object.assign(this.data, d) },
    triggerEvent(name) { this.events.push(name) },
  })
  if (def.lifetimes && def.lifetimes.attached) def.lifetimes.attached.call(inst)
  return inst
}

test('原因画进面板:auto-back 分支用 result-sheet fail,标题与 sub 都传进去,且不渲染重试', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/error/index.wxml'), 'utf8')
  assert.match(wxml, /<block wx:if="\{\{autoBack\}\}">[\s\S]*<cy-result-sheet [^>]*kind="fail"[^>]*title="\{\{title\}\}"[^>]*why="\{\{sub\}\}"[^>]*bind:close="onAutoBack"/)
  assert.match(wxml, /<view class="cy-error [^>]*wx:else/, '重试按钮只在非 auto-back 分支')
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'components/cy/error/index.json'), 'utf8'))
  assert.equal(json.usingComponents['cy-result-sheet'], '/components/cy/result-sheet/index')
})

test('挂上即打开面板;不开 auto-back 时不打开', () => {
  assert.equal(mount({ autoBack: true }, [{}, {}]).data._sheet, true)
  assert.equal(mount({}, [{}, {}]).data._sheet, false)
})

test('栈>1 回退一次,重复收起不重复导航;同页第二个 auto-back 实例也不再导航', () => {
  const stack = [{}, { route: 'pages/club/customers/index' }]
  const c = mount({ autoBack: true }, stack)
  c.onAutoBack(); c.onAutoBack()
  assert.deepEqual(c.nav, ['back'])
  const twin = mount({ autoBack: true }, stack); twin.onAutoBack()
  assert.deepEqual(twin.nav, [], '同一页已经返回过')
  assert.equal(c.data._sheet, false)
})

test('栈=1 按域兜底:商家页回工作台,其它回首页', () => {
  const m = mount({ autoBack: true }, [{ route: 'pages/merchant/predict/index' }]); m.onAutoBack()
  assert.deepEqual(m.nav, ['reLaunch:/pages/merchant/index/index'])
  const p = mount({ autoBack: true }, [{ route: 'pages/topic/index/index' }]); p.onAutoBack()
  assert.deepEqual(p.nav, ['reLaunch:/pages/index/index'])
})

test('custom-back:只发 back 事件,组件不导航(负控:去掉 customBack 就会自己回退)', () => {
  const c = mount({ autoBack: true, customBack: true }, [{}, {}]); c.onAutoBack()
  assert.deepEqual(c.events, ['back']); assert.deepEqual(c.nav, [])
  const n = mount({ autoBack: true }, [{}, {}]); n.onAutoBack()
  assert.deepEqual(n.events, []); assert.deepEqual(n.nav, ['back'])
})
