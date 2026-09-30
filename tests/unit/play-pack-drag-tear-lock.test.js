// ③′ 拖拽撕开:JS 常量 ↔ WXSS/WXML 的同步锁,与 play-pack-timing-lock 同一套路。
//
// 锁三件事:
// ① TEAR_SNAP(松手补完/弹回时长)与 .is-snap 三条 transition 一致 —— 不一致时
//    JS 定时器会在过渡播完前/后动手,撕口要么闪断要么僵住;
// ② .is-torn 的 transform 必须逐字等于 fxSink 的 0% 帧 —— 拖拽路径的空袋下坠
//    从 is-torn 起步,不相等就会在下坠第一帧跳变;
// ③ 撕口节点的 wx:if 必须同时认 packTear 和 tearPct —— 只认 packTear 的话,
//    拖拽路径整个撕口不存在,手指拖的是空气(黑锯齿漏光的教训反着犯)。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const JS = fs.readFileSync(path.join(ROOT, 'pages/play/index.js'), 'utf8')
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxss'), 'utf8')
const WXML = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxml'), 'utf8')

function jsConst(name) {
  const m = JS.match(new RegExp('^const ' + name + '\\s*=\\s*([0-9.]+)\\s*;', 'm'))
  assert.ok(m, `index.js 里找不到常量 ${name}(锚点失效,不是代码没问题)`)
  return Number(m[1])
}

function toMs(raw) {
  const m = String(raw).match(/^([0-9.]+)(ms|s)$/)
  assert.ok(m, `解析不了时长:${raw}`)
  return m[2] === 'ms' ? Number(m[1]) : Math.round(Number(m[1]) * 1000)
}

function ruleBody(selector) {
  const i = WXSS.indexOf(selector + '{')
  assert.ok(i >= 0, `WXSS 里找不到选择器 ${selector}(锚点失效)`)
  return WXSS.slice(i, WXSS.indexOf('}', i) + 1)
}

const TEAR_SNAP = jsConst('TEAR_SNAP')
const TEAR_DONE_PCT = jsConst('TEAR_DONE_PCT')

test('① is-snap 三条过渡都等于 TEAR_SNAP', () => {
  for (const sel of ['.fx-pack.is-snap', '.fx-pack.is-snap .fx-pack__seal--t', '.fx-pack.is-snap .fx-pack__mouth']) {
    const m = ruleBody(sel).match(/transition:[a-z]+\s+([0-9.]+m?s)/)
    assert.ok(m, `${sel} 里没抓到 transition 时长(锚点失效)`)
    assert.equal(toMs(m[1]), TEAR_SNAP, `${sel} 的过渡时长 ≠ TEAR_SNAP`)
  }
})

test('② is-torn 的 transform 逐字等于 fxSink 的 0% 帧', () => {
  const torn = ruleBody('.fx-pack.is-torn').match(/transform:([^;]+);/)
  assert.ok(torn, '.fx-pack.is-torn 里没抓到 transform(锚点失效)')
  const sinkKf = WXSS.slice(WXSS.indexOf('@keyframes fxSink'))
  const sink0 = sinkKf.match(/0%\{\s*transform:([^;]+?)(?:\s+translateY\(0\))?;/)
  assert.ok(sink0, 'fxSink 的 0% 帧里没抓到 transform(锚点失效)')
  assert.equal(torn[1].trim(), sink0[1].trim(),
    '不相等 ⇒ 拖拽路径空袋下坠第一帧会跳变')
})

test('③ 撕口节点的 wx:if 同时认 packTear 和 tearPct', () => {
  const m = WXML.match(/class="fx-pack__mouth"\s+wx:if="\{\{([^}]+)\}\}"/)
  assert.ok(m, 'WXML 里没抓到撕口节点的 wx:if(锚点失效)')
  assert.ok(/packTear/.test(m[1]) && /tearPct/.test(m[1]),
    `撕口 wx:if 现在是「${m[1]}」—— 少任何一个,对应路径的撕口就不存在`)
})

test('阈值 sanity:TEAR_DONE_PCT 在 (0,100) 开区间', () => {
  assert.ok(TEAR_DONE_PCT > 0 && TEAR_DONE_PCT < 100)
})

test('负控:把任一侧改掉都必须判红', () => {
  const mutated = WXSS.replace('.fx-pack.is-snap{ transition:transform .18s', '.fx-pack.is-snap{ transition:transform .5s')
  assert.notEqual(mutated, WXSS, 'is-snap 锚点失效')
  const body = mutated.slice(mutated.indexOf('.fx-pack.is-snap{'))
  const got = toMs(body.match(/transition:transform\s+([0-9.]+m?s)/)[1])
  assert.notEqual(got, TEAR_SNAP, '变异之后仍然相等 ⇒ 这条锁是橡皮图章')
})
