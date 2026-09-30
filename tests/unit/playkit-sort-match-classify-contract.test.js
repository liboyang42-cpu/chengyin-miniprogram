/* R3 三个新玩法组件:排序 / 连线 / 分类(2026-09-16)
 *
 * 三件事各测一遍,因为它们坏起来的样子完全不同:
 *   ① 属性契约 —— 组件声明的属性必须真从分发器的 kit.* 喂进来,且 kit 里真有这个键。
 *      漏一个在真机上就是「那行字恒空」:不报错、不打日志、不掉布局;
 *   ② 提交 payload 形状 —— 与服务端 submitSort / submitMatch / submitClassify 逐字对齐。
 *      字段名对不上服务端会打回,但那是「玩家做完动作却过不了」的卡死;
 *   ③ 全部完成前按钮不可用 —— 半成品 payload 不许发出去,少一条服务端必打回。
 *
 * 装配方式跟 cancellation-feedback 一致:vm 里 stub Component/Behavior/wx,
 * 拿真定义的方法配一个假实例,喂真参数跑 —— 不是把实现抄一遍到测试里。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const { pickPlayKit, serverAction, serverPayload } = require('../../pages/play/utils/playkit-view.js')

const ROOT = path.resolve(__dirname, '../..')
/* vm 沙箱里造出来的对象是**另一个 realm** 的:原型不是宿主的 Object.prototype,
   deepStrictEqual 会判「结构一样但不是同一个原型」而红。断言前先往返一次 JSON。 */
const plain = (v) => JSON.parse(JSON.stringify(v))
const DISPATCH_WXML = 'pages/play/components/playkit/index.wxml'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 载入组件定义:stub 掉 Component / Behavior,拿到真 options。
 *  ⚠️ 组件里 require 的 behaviors/reduced-motion.js 是在 **Node 上下文**里跑的,
 *  它模块加载时就调 Behavior() —— 沙箱里给了不够,得临时挂到 global 上
 *  (playkit-v51-contract 踩过同一个坑)。 */
function loadComponent(rel) {
  const abs = path.join(ROOT, rel)
  const localRequire = createRequire(abs)
  const prevBehavior = global.Behavior
  global.Behavior = (b) => b
  let definition = null
  try {
    vm.runInNewContext(fs.readFileSync(abs, 'utf8'), {
      Component: (c) => { definition = c },
      Behavior: (b) => b,
      Page: (c) => { definition = c },
      getApp: () => ({ globalData: {} }),
      wx: {},
      require: (name) => localRequire(name),
      console, setTimeout, clearTimeout,
    }, { filename: abs })
  } finally {
    global.Behavior = prevBehavior
  }
  assert.ok(definition, rel + ' 必须调用 Component()')
  return definition
}

/** 假实例:把真 methods 挂上,data 从默认值深拷一份,properties 默认值也铺进去。 */
function mount(rel) {
  const def = loadComponent(rel)
  const events = []
  const inst = Object.assign({}, def.methods, {
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name: name, detail: detail }); },
    selectComponent() { return null; },
  })
  for (const key of Object.keys(def.properties || {})) {
    const spec = def.properties[key] || {}
    if (!(key in inst.data)) {
      inst.data[key] = spec.value === undefined ? undefined : JSON.parse(JSON.stringify(spec.value))
    }
  }
  return { def, inst, events }
}

/** 组件声明的属性都该被喂。show 是分发器自己的开合;reducedMotion 由 behavior 注入。 */
const NOT_FED = new Set(['show', 'reducedMotion'])

const SHELLS = [
  { type: 'sort', rel: 'pages/play/components/playkit-sort/index.js' },
  { type: 'match', rel: 'pages/play/components/playkit-match/index.js' },
  { type: 'classify', rel: 'pages/play/components/playkit-classify/index.js' },
]

test('★属性契约:三个组件声明的每个属性都从分发器的 kit.* 喂进来', () => {
  const wxml = read(DISPATCH_WXML)
  for (const { type, rel } of SHELLS) {
    const tag = new RegExp('<cy-playkit-' + type + '[\\s\\S]*?/>').exec(wxml)
    assert.ok(tag, type + ' 没在分发器里注册 —— 服务端下发了也没有一屏会出现')
    const props = Object.keys(loadComponent(rel).properties || {})
    assert.ok(props.length >= 4, type + ' 只声明了 ' + props.length + ' 个属性,扫描器多半坏了')
    const notFed = props.filter((p) => !NOT_FED.has(p) && !tag[0].includes('kit.' + p))
    assert.deepEqual(notFed, [],
      type + ' 的这些属性没人喂,真机上恒为默认值:' + notFed.join(', '))
  }
})

test('★属性契约:绑的 kit.X 必须真由 pickPlayKit 产出 —— 空键就是那行字静默消失', () => {
  for (const { type, rel } of SHELLS) {
    const tag = new RegExp('<cy-playkit-' + type + '[\\s\\S]*?/>').exec(read(DISPATCH_WXML))[0]
    const kit = pickPlayKit({ sessionId: 's1', version: 1, playKit: { [type]: { prompt: 't' } } })
    assert.ok(kit && kit.type === type, type + ' 段还不出 kit')
    const bound = [...tag.matchAll(/\{\{kit\.([A-Za-z0-9_]+)/g)].map((m) => m[1])
    assert.ok(bound.length >= 4, type + ' 在分发器里没绑几个属性,正则或接线坏了')
    const missing = bound.filter((key) => !(key in kit))
    assert.deepEqual(missing, [], type + ' 绑了没人产出的属性:' + missing.join(', '))
  }
})

test('★提交 payload 形状:动作名与字段名跟服务端 submitXxx 逐字对齐', () => {
  assert.equal(serverAction('sort', 'submit'), 'SUBMIT_SORT')
  assert.equal(serverAction('match', 'submit'), 'SUBMIT_MATCH')
  assert.equal(serverAction('classify', 'submit'), 'SUBMIT_CLASSIFY')

  assert.deepEqual(serverPayload('sort', 'submit', { order: ['c', 'a', 'b'] }), { order: ['c', 'a', 'b'] })
  assert.deepEqual(serverPayload('match', 'submit', { pairs: [['l1', 'r2'], ['l2', 'r1']] }),
    { pairs: [['l1', 'r2'], ['l2', 'r1']] })
  assert.deepEqual(serverPayload('classify', 'submit', { placement: { i1: 'b1', i2: 'b2' } }),
    { placement: { i1: 'b1', i2: 'b2' } })
  // 多选只发 optionIds;单选一字不变
  assert.deepEqual(serverPayload('qa', 'submit', { mode: 'pick', optionIds: ['a', 'c'] }), { optionIds: ['a', 'c'] })
  assert.deepEqual(serverPayload('qa', 'submit', { mode: 'pick', index: 1, optionId: 'b' }), { optionId: 'b' })
})

test('排序:题面照服务端顺序铺开,提交报的是一整列 order', () => {
  const { def, inst, events } = mount(SHELLS[0].rel)
  const items = [
    { id: 's2', label: '说明原声只授权在展厅播放' },
    { id: 's1', label: '承认删掉了那一分钟录音' },
    { id: 's3', label: '请求更正展签「从未存在」' },
  ]
  def.observers['show, items'].call(inst, true, items)
  assert.deepEqual(plain(inst.data.rows.map((r) => r.id)), ['s2', 's1', 's3'], '题面顺序照服务端给,不许客户端再排')

  inst.onDown({ currentTarget: { dataset: { i: 0 } } })
  assert.deepEqual(plain(inst.data.rows.map((r) => r.id)), ['s1', 's2', 's3'], '下移一位')
  inst.onSubmit()
  assert.deepEqual(plain(events[0]), { name: 'submit', detail: { order: ['s1', 's2', 's3'] } })
  assert.equal(JSON.stringify(events[0].detail).indexOf('answerOrder'), -1)

  // 纯算法边界:越界与原地不动都返回原引用(调用方据此不再 setData)
  const same = ['a', 'b', 'c']
  assert.equal(inst._moveRow(same, 0, 5), same)
  assert.equal(inst._moveRow(same, 1, 1), same)
  assert.deepEqual(inst._moveRow(same, 0, 2), ['b', 'c', 'a'])
})

test('排序:空列表不许提交(配置还没来,按钮亮着也没东西可交)', () => {
  const { def, inst, events } = mount(SHELLS[0].rel)
  def.observers['show, items'].call(inst, true, [])
  inst.onSubmit()
  assert.deepEqual(events, [], '没有待排项时提交按钮必须是死的')
  assert.equal(inst._canSubmit([]), false)
  assert.equal(inst._canSubmit([{ id: 'a' }]), true)
})

test('★连线:没连满按钮拦得住;连满才发 [左,右] 对列表', () => {
  const { def, inst, events } = mount(SHELLS[1].rel)
  // 真机上 properties 会在 observer 之前进 data;这里照同一时序摆好
  inst.data.left = [{ id: 'l1', label: '签收联 071' }, { id: 'l2', label: '原声录音' }]
  inst.data.right = [{ id: 'r1', label: '是谁来拿走了东西' }, { id: 'r2', label: '码头原本叫什么' }]
  def.observers['show, left, right'].call(inst, true, inst.data.left, inst.data.right)

  assert.equal(inst.data.total, 2)
  inst.onSubmit()
  assert.deepEqual(events, [], '一条都没连就点提交,按钮必须是死的')

  inst.onTapLeft({ currentTarget: { dataset: { id: 'l1' } } })
  assert.equal(inst.data.selected, 'l1')
  inst.onTapRight({ currentTarget: { dataset: { id: 'r2' } } })
  assert.equal(inst.data.pairedCount, 1)
  assert.equal(inst.data.leftRows[0].badge, 1)
  assert.equal(inst.data.rightRows[1].badge, 1, '同一个序号出现在左右两张卡上')
  inst.onSubmit()
  assert.deepEqual(events, [], '还差一条,仍然不许提交')

  inst.onTapLeft({ currentTarget: { dataset: { id: 'l2' } } })
  inst.onTapRight({ currentTarget: { dataset: { id: 'r1' } } })
  assert.equal(inst.data.pairedCount, 2)
  inst.onSubmit()
  assert.deepEqual(plain(events[0]), { name: 'submit', detail: { pairs: [['l1', 'r2'], ['l2', 'r1']] } })

  // 再点已配对的卡 = 取消(设计规格)
  inst.onTapRight({ currentTarget: { dataset: { id: 'r2' } } })
  assert.equal(inst.data.pairedCount, 1)
  assert.equal(inst.data.rightRows[1].badge, 0)
})

test('★分类:没分完按钮拦得住 + 还差几条说得出来;分满才发 placement', () => {
  const { def, inst, events } = mount(SHELLS[2].rel)
  const bins = [{ id: 'b1', label: '事实' }, { id: 'b2', label: '证词' }, { id: 'b3', label: '猜测' }]
  const items = [
    { id: 'i1', label: '签收栏是空白的' },
    { id: 'i2', label: '阿蓉说来拿东西的是许闻' },
  ]
  def.observers['show, items, bins'].call(inst, true, items, bins)
  assert.equal(inst.data.total, 2)
  assert.equal(inst.data.placed, 0)

  inst.onSubmit()
  assert.deepEqual(events, [], '一条都没分就点提交,按钮必须是死的')

  inst.onPickBin({ currentTarget: { dataset: { i: 0, b: 'b1' } } })
  assert.equal(inst.data.placed, 1)
  inst.onSubmit()
  assert.deepEqual(events, [], '还差一条,仍然不许提交')

  inst.onPickBin({ currentTarget: { dataset: { i: 1, b: 'b2' } } })
  assert.equal(inst.data.placed, 2)
  inst.onSubmit()
  assert.deepEqual(plain(events[0]), { name: 'submit', detail: { placement: { i1: 'b1', i2: 'b2' } } })

  assert.equal(inst._canSubmit(1, 2), false)
  assert.equal(inst._canSubmit(2, 2), true)
  assert.equal(inst._canSubmit(0, 0), false, '空题不许提交')
})

test('★qa 多选:勾多个再提交,发的是 optionIds 全集', () => {
  const { def, inst, events } = mount('pages/play/components/playkit-qa/index.js')
  inst.data.mode = 'pick'
  def.observers['show, options, mode, multi'].call(inst, true,
    [{ id: 'a', t: '冷萃' }, { id: 'b', t: '拿铁' }, { id: 'c', t: '冰滴' }], 'pick', true)
  inst.data.multi = true

  inst.onPick({ currentTarget: { dataset: { i: 0 } } })
  assert.deepEqual(events, [], '多选点一下只是勾上,不许立刻提交')
  inst.onPick({ currentTarget: { dataset: { i: 2 } } })
  assert.equal(inst.data.ctaDisabled, false)
  inst.onPick({ currentTarget: { dataset: { i: 2 } } })
  assert.equal(inst.data.optionList[2].state, '', '再点一下取消勾选')
  inst.onPick({ currentTarget: { dataset: { i: 2 } } })

  inst.onCta()
  assert.deepEqual(plain(events[0]), { name: 'submit', detail: { mode: 'pick', optionIds: ['a', 'c'] } })
  if (inst._introTimer) clearTimeout(inst._introTimer)
})

test('★qa 单选一字不变:点选项即提交,仍然是单个 optionId', () => {
  const { def, inst, events } = mount('pages/play/components/playkit-qa/index.js')
  inst.data.mode = 'pick'
  def.observers['show, options, mode, multi'].call(inst, true,
    [{ id: 'a', t: '冷萃' }, { id: 'b', t: '拿铁' }], 'pick', false)
  inst.data.multi = false
  inst.onPick({ currentTarget: { dataset: { i: 1 } } })
  assert.deepEqual(plain(events[0]), { name: 'submit', detail: { mode: 'pick', index: 1, optionId: 'b' } })
  if (inst._introTimer) clearTimeout(inst._introTimer)
})

test('★回执只有整体对错:判错不逐行标红,只出整体提示条(总控 2026-09-16 定调)', () => {
  for (const { type, rel } of SHELLS) {
    const src = fs.readFileSync(path.join(ROOT, path.dirname(rel), 'index.wxml'), 'utf8')
    assert.ok(!/is-wrong|is-bad/.test(src),
      type + ' 判错时逐行标红了 —— 服务端不给逐项对错,整列红等于假装知道错在哪一条')
    assert.ok(/verdict/.test(src), type + ' 连整体提示条都没有,玩家人不知道过没过')

    // 判定来自「判过 + 整体通过」这两个回执字段,组件自己不判对错
    const js = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    assert.ok(/attempts > 0/.test(js), type + ' 没把「这一屏刚打开」和「刚判完」分开')
    assert.ok(!/answerOrder|answer\b/.test(js.replace(/\/\/[^\n]*/g, '')),
      type + ' 里出现了答案类字段 —— 判定只能在服务端')
  }
})

test('★qa 多选回执:多选标记 / 判过没 / 服务端反馈三件都从 kit 喂进来', () => {
  const wxml = read(DISPATCH_WXML)
  const tag = new RegExp('<cy-playkit-qa[\\s\\S]*?/>').exec(wxml)[0]
  for (const key of ['multi', 'attempts', 'feedback']) {
    assert.ok(tag.includes('kit.' + key), 'qa 的 ' + key + ' 没人喂 —— 多选回执条恒不出现')
  }
  const kit = pickPlayKit({
    sessionId: 's1', version: 3,
    playKit: { qa: { mode: 'PICK', multi: true, attempts: 1, lastFeedback: '冷萃是冷的。', options: [] } },
  })
  assert.equal(kit.multi, true)
  assert.equal(kit.attempts, 1)
  assert.equal(kit.feedback, '冷萃是冷的。', '服务端把所选项的反馈拼成一段,直接显示')
})
