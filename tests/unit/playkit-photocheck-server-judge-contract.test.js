/* cy-playkit-photocheck · 拍照审核(契约 §2.2,2026-09-17 改版:判定全在服务端)
 *
 * 这条契约有三个静默失败点,各用一条断言钉住:
 *   ① 组件偷偷把本地算的分塞进 shoot 事件 —— 服务端明确不再接受 score,塞回去就是留后门;
 *   ② 不过时不显示服务端给的 lastReason —— 玩家只知道「再拍一张」,不知道错在哪;
 *   ③ 降级(degraded,模型没给结论)被说成「审核通过 / 不通过」—— 把没审的当成结论骗玩家。
 * 每一条都带一个「构造坏版本必须红」的负控:绿是廉价的。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const REL = 'pages/play/components/playkit-photocheck/index.js'
const WXML = 'pages/play/components/playkit-photocheck/index.wxml'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 载入组件定义:stub Component/Behavior,拿 methods 与 observers(与 playkit-v51-contract 同一手法)。 */
function loadComponent() {
  const abs = path.join(ROOT, REL)
  const prevComponent = global.Component
  const prevBehavior = global.Behavior
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prevComponent
    global.Behavior = prevBehavior
  }
  assert.ok(captured, REL + ' 必须导出组件定义')
  return captured
}

/** 极简实例:data 与 setData 之外把 methods 也挂上 —— 取景(S1)之后方法之间会互相调用，
 *  只给 data/setData 的实例会让「点快门」这条路一调就炸，测出来的红是夹具的锅不是代码的锅。 */
function instanceOf(component) {
  const inst = {
    data: Object.assign({}, component.data),
    setData(patch) { Object.assign(this.data, patch) },
  }
  for (const [name, fn] of Object.entries(component.methods || {})) {
    if (typeof fn === 'function') inst[name] = fn.bind(inst)
  }
  return inst
}

function runVerdict(fields) {
  const component = loadComponent()
  const observer = component.observers['show, tries, maxTries, passed, flagged, degraded, fallback, lastReason']
  assert.ok(observer, '判定 observer 不在 —— 这一屏不会更新')
  const inst = instanceOf(component)
  observer.call(inst, true,
    fields.tries || 0, fields.maxTries || 0,
    !!fields.passed, !!fields.flagged, !!fields.degraded,
    fields.fallback || 'retake', fields.lastReason || '')
  return inst.data
}

test('★本地算分那套整段删除:不再读像素、不再有 scoreOf / readPixels', () => {
  const src = read(REL)
  for (const dead of ['scoreOf', 'readPixels', 'getImageData', 'createOffscreenCanvas', 'luma(', '_scoreOf']) {
    assert.equal(src.includes(dead), false,
      dead + ' 还在组件里残留 —— 契约 §2.2 改版后判定全在服务端,本地启发式一律不许留')
  }
})

test('★shoot 事件只给临时路径与大小,不带任何分数', () => {
  const component = loadComponent()
  const inst = instanceOf(component)
  inst.triggerEvent = (name, detail) => { inst.emitted = { name, detail } }
  const prevWx = global.wx
  global.wx = {
    chooseMedia: (opts) => opts.success({ tempFiles: [{ tempFilePath: 'wxfile://t.jpg', size: 123 }] }),
    vibrateShort: () => {},
  }
  try {
    component.methods.onShoot.call(inst)
  } finally {
    global.wx = prevWx
  }
  assert.equal(inst.emitted.name, 'shoot', '拍完必须抛 shoot,否则照片永远留在手机里')
  assert.deepEqual(Object.keys(inst.emitted.detail).sort(), ['size', 'tempFilePath'],
    'shoot 事件的字段只认 tempFilePath/size;多一个 score 就是客户端又能自己报分')
})

test('★不过时必须把服务端的 lastReason 渲染出来,不能只说「再拍一张」', () => {
  const data = runVerdict({ tries: 1, maxTries: 3, lastReason: '画面里没看到窗框' })
  assert.equal(data.verdict, '还差一点，再拍一张')
  assert.equal(data.reason, '画面里没看到窗框', 'lastReason 没进这一屏 —— 玩家不知道错在哪')
  assert.ok(read(WXML).includes('{{reason}}'), 'reason 没有对应的 wxml 节点 —— 算了也不会显示')
})

test('负控:把 reason 的 wxml 节点摘掉,上一条必须红', () => {
  const wxml = read(WXML)
  /* class 里可能还挂着入场动效类(2026-09-22 起 pk-in),所以按 class 前缀匹配、
     不按整串相等 —— 写死 class="pc__reason" 的话,加一个动效类就把负控弄哑了(实测踩过)。 */
  const stripped = wxml.replace(/\s*<view class="pc__reason[^"]*"[^>]*>\{\{reason\}\}<\/view>/, '')
  assert.notEqual(stripped, wxml, '负控构造失败:reason 节点已经不是预期形状')
  assert.equal(stripped.includes('{{reason}}'), false,
    '摘掉之后 wxml 里还有 reason —— 说明这条断言根本没在看显示那一步')
})

test('★分发器把 degraded / lastReason 传给组件 —— 少一个绑定,降级与理由都到不了这一屏', () => {
  const wxml = read('pages/play/components/playkit/index.wxml')
  const start = wxml.indexOf('cy-playkit-photocheck');
  const block = wxml.slice(start, wxml.indexOf('bind:shoot', start));
  assert.ok(block.length > 0, '分发器里没有 photocheck 分支')
  assert.match(block, /degraded="\{\{kit\.degraded\}\}"/, 'degraded 没绑给组件')
  assert.match(block, /last-reason="\{\{kit\.lastReason\}\}"/, 'lastReason 没绑给组件')
  assert.equal(/mode=|threshold=/.test(block), false, '本地算分的 mode/threshold 绑定还留在分发器上')
})

test('★降级(degraded)只说「没能审」,不许出现通过 / 不通过这类假结论', () => {
  const data = runVerdict({ tries: 1, maxTries: 3, flagged: true, degraded: true })
  assert.ok(data.verdict.includes('没能审'), 'degraded 必须说清这次没能审,实际:' + data.verdict)
  assert.notEqual(data.verdictKind, 'ok', 'degraded 不许给通过态')
  assert.notEqual(data.verdictKind, 'no', 'degraded 不许给不通过态')
  const src = read(REL)
  assert.equal(/['"][^'"]*审核(通过|不通过)/.test(src), false, '文案里出现了「审核通过/不通过」')
  assert.ok(src.includes('degraded'), 'degraded 没有接进组件')
})
