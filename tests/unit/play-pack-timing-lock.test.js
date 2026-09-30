// 开卡包四拍:JS 常量 ↔ WXSS 时长/缩放 的同步锁。
//
// 为什么需要这条:同一组数在 index.js(定时器)和 index.wxss(关键帧/过渡)各写了一份,
// 原来只靠注释「改了要同步」维持 —— 结果 2026-08-16 就漏了:JS 侧全部按 0.5× 乘了 2,
// 而 fxBloom/fxFlash/fxShock/fxSink 四条 CSS 时长忘了乘,光晕白闪冲击波都播完了、
// 碎片才飞到一半。注释拦不住这种漏,断言可以。
//
// 锁的是「两边必须一致」,不锁具体数值 —— 要调节奏,改 index.js 的常量,这里自动跟着走。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const JS = fs.readFileSync(path.join(ROOT, 'pages/play/index.js'), 'utf8')
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxss'), 'utf8')

function jsConst(name) {
  const m = JS.match(new RegExp('^const ' + name + '\\s*=\\s*([0-9.]+)\\s*;', 'm'))
  assert.ok(m, `index.js 里找不到常量 ${name}(锚点失效,不是代码没问题)`)
  return Number(m[1])
}

// '.64s' / '1s' / '1.24s' / '640ms' → ms
function toMs(raw) {
  const m = String(raw).match(/^([0-9.]+)(ms|s)$/)
  assert.ok(m, `解析不了时长:${raw}`)
  return m[2] === 'ms' ? Number(m[1]) : Math.round(Number(m[1]) * 1000)
}

// 在 WXSS 里按选择器取一段规则体,再从中抓第一个匹配
function ruleBody(selector) {
  const i = WXSS.indexOf(selector + '{')
  assert.ok(i >= 0, `WXSS 里找不到选择器 ${selector}(锚点失效)`)
  return WXSS.slice(i, WXSS.indexOf('}', i) + 1)
}
function durationIn(selector, re) {
  const m = ruleBody(selector).match(re)
  assert.ok(m, `${selector} 里没抓到时长(锚点失效)`)
  return toMs(m[1])
}

const PACK_CHARGE = jsConst('PACK_CHARGE')
const PACK_TEAR = jsConst('PACK_TEAR')
const DEAL_FLIGHT = jsConst('DEAL_FLIGHT')
const DEAL_ARC = jsConst('DEAL_ARC')
const DEAL_MID_SCALE = jsConst('DEAL_MID_SCALE')

test('② 蓄力:JS 的 PACK_CHARGE 与摇晃动画、压暗过渡三者同步', () => {
  assert.equal(durationIn('.fx-pack.is-shake', /animation:fxShake\s+([0-9.]+m?s)/), PACK_CHARGE)
  assert.equal(durationIn('.fx-dim.is-on', /transition:opacity\s+([0-9.]+m?s)/), PACK_CHARGE)
})

test('③ 横撕:封口条、撕口、袋口片三条动画都等于 PACK_TEAR', () => {
  assert.equal(durationIn('.fx-pack.is-tear .fx-pack__seal--t', /animation:fxRip\s+([0-9.]+m?s)/), PACK_TEAR)
  assert.equal(durationIn('.fx-pack.is-tear .fx-pack__mouth', /animation:fxMouth\s+([0-9.]+m?s)/), PACK_TEAR)
  assert.equal(durationIn('.fx-pack.is-tear .fx-pack__flap--l', /animation:fxFlapL\s+([0-9.]+m?s)/), PACK_TEAR)
  assert.equal(durationIn('.fx-pack.is-tear .fx-pack__flap--r', /animation:fxFlapR\s+([0-9.]+m?s)/), PACK_TEAR)
})

test('④ 发牌两段之和 = DEAL_FLIGHT，分界 = DEAL_ARC', () => {
  const fly = durationIn('.fx-tile.is-flying', /transition:transform\s+([0-9.]+m?s)/)
  const land = durationIn('.fx-tile.is-dealt', /transition:transform\s+([0-9.]+m?s)/)
  assert.equal(fly, Math.round(DEAL_FLIGHT * DEAL_ARC), '弧顶段时长对不上 DEAL_FLIGHT×DEAL_ARC')
  assert.equal(fly + land, DEAL_FLIGHT, '两段之和必须等于单张飞行总时长')
})

test('④ 弧顶缩放:夹取用的 DEAL_MID_SCALE 必须就是 WXSS 里真正的那个 scale', () => {
  const m = ruleBody('.fx-tile.is-flying').match(/scale\(([0-9.]+)\)/)
  assert.ok(m, '.fx-tile.is-flying 里没抓到 scale(锚点失效)')
  assert.equal(Number(m[1]), DEAL_MID_SCALE,
    '不一致会让弧顶夹取按错误的卡片尺寸留边 —— 卡角照样探出画面')
})

test('负控：把任一侧改掉都必须判红', () => {
  // 模拟「JS 乘了 0.5×、CSS 忘了乘」这个真实漏过的场景
  const mutated = WXSS.replace('animation:fxShake 1s', 'animation:fxShake .5s')
  assert.notEqual(mutated, WXSS, '摇晃动画锚点失效')
  const body = mutated.slice(mutated.indexOf('.fx-pack.is-shake{'))
  const got = toMs(body.match(/animation:fxShake\s+([0-9.]+m?s)/)[1])
  assert.notEqual(got, PACK_CHARGE, '变异之后仍然相等 ⇒ 这条锁是橡皮图章')
})
