/* 拍物成卡 · 当场揭晓的纯逻辑(施工文档第四版 §3.2,样稿 artifact 9U7HFWDfbinjmt2tppvVGp)
 *
 * 揭晓那一屏的三件事都是算出来的,算错了不报错,只会「长得不对」:
 *   ① 照片在取景框里是 aspectFill 裁着显示的 —— 物品位置要按同一个裁法换算,否则背景散掉时物品会跳一下;
 *   ② 物品浮到上方时按 aspectFit 放进固定的框里;
 *   ③ 拍完之后等回来的是哪一种结果(过了有卡 / 过了没卡 / 没过 / 没能审 / 机会用完),决定下一屏。
 */
const assert = require('node:assert/strict')
const test = require('node:test')

const reveal = require('../../utils/object-card-reveal.js')

test('照片按 aspectFill 铺满取景框:宽图左右裁,居中', () => {
  // 4:3 横图放进 300×400 的竖框:高度撑满,宽度溢出后居中
  const r = reveal.coverRect(1600, 1200, 300, 400)
  assert.equal(r.h, 400)
  assert.equal(Math.round(r.w), 533)
  assert.equal(Math.round(r.x), -117)
  assert.equal(r.y, 0)
})

test('物品位置按照片同一个裁法换算到屏上', () => {
  const drawn = { x: -100, y: 0, w: 500, h: 400 }
  const obj = reveal.boxToRect([0.2, 0.25, 0.5, 0.5], drawn)
  assert.deepEqual(obj, { x: 0, y: 100, w: 250, h: 200 })
})

test('浮到上方时按 aspectFit 放进框里,居中不变形', () => {
  // 1:2 的竖物件放进 250×200 的框:高度顶满 200,宽 100,水平居中
  const r = reveal.fitRect(50, 100, { cx: 195, cy: 222, w: 250, h: 200 })
  assert.deepEqual(r, { x: 145, y: 122, w: 100, h: 200 })
})

test('负控:位置不是四个 0 到 1 的数就当没有 —— 位置错了比没有更难看', () => {
  for (const bad of [null, undefined, [], [0.1, 0.2, 0.3], ['a', 0, 0.1, 0.1], [0.5, 0, 0.6, 0.5], [0, 0, 0, 0.5]]) {
    assert.equal(reveal.validBox(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(reveal.validBox([0.1, 0.25, 0.5, 0.5]), [0.1, 0.25, 0.5, 0.5])
})

/* ③ 下一屏由结果决定。before = 按快门那一刻的状态,after = 回来的状态。 */
const BEFORE = { tries: 0, passed: false, flagged: false, degraded: false, card: null }

test('还没回来(次数没涨、也没过、也没降级)→ 继续转圈', () => {
  assert.equal(reveal.outcome(BEFORE, BEFORE), null)
})

test('过了且卡带着抠图与位置 → 点阵消散', () => {
  const card = { cutoutUrl: 'https://x/c.png', cutoutBox: [0.1, 0.2, 0.5, 0.5] }
  assert.equal(reveal.outcome(BEFORE, Object.assign({}, BEFORE, { tries: 1, passed: true, card })), 'dissolve')
})

test('过了、有卡但没抠出来 → 照片直接浮上去(不演粒子)', () => {
  const card = { cutoutUrl: null, cutoutBox: null }
  assert.equal(reveal.outcome(BEFORE, Object.assign({}, BEFORE, { tries: 1, passed: true, card })), 'photo')
})

test('负控:有贴纸但位置不对 → 照片直接浮上去,不演点阵(物品会落在错的地方)', () => {
  const card = { cutoutUrl: 'https://x/c.png', cutoutBox: [0.6, 0, 0.6, 0.5] }
  assert.equal(reveal.outcome(BEFORE, Object.assign({}, BEFORE, { tries: 1, passed: true, card })), 'photo')
})

test('负控:过了但铸卡失败没带卡 → 只说过了,不摆一张册子里不存在的卡', () => {
  assert.equal(reveal.outcome(BEFORE, Object.assign({}, BEFORE, { tries: 1, passed: true })), 'passedNoCard')
})

test('没过 / 没能审 / 机会用完 各走各的', () => {
  assert.equal(reveal.outcome(BEFORE, Object.assign({}, BEFORE, { tries: 1 })), 'retry')
  assert.equal(reveal.outcome(BEFORE, Object.assign({}, BEFORE, { tries: 1, degraded: true })), 'degraded')
  assert.equal(reveal.outcome(BEFORE, Object.assign({}, BEFORE, { tries: 3, flagged: true })), 'flagged')
})
