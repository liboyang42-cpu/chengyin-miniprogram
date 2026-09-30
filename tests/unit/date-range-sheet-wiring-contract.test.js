'use strict'

/* 日期区间弹层的三根线(2026-08-27 立;2026-09-03 换宿主)。
 *
 * ⚠️ 2026-09-03:原来这条盯的是 pages/activity/list 的「发起官方活动」面板,
 * 那个面板已随用户裁决整块删掉(官方活动改由 Web 后台上传)。
 * **保护不能跟着面板一起消失** —— 现存唯一的 cy-date-range-sheet 消费方是
 * pages/topic/merchantapply(选可配合日期),把三根线钉到它身上。
 * 其中 months:merchantapply 没传(用组件默认),只钉 allow-same-day 与 min。
 *
 * ① allow-same-day —— 单日活动 start=end;组件默认 false 时同一天点两次 = 重开区间,
 *    单日活动永远选不出来(改造前两个独立日期滚轮 start=end 完全合法,这是回归)。
 * ② min = 今天 —— 原来当月 1 号起全部可点,pubOnSubmit 前端零校验,过去的日子直接提交。
 * ③ months = 12 —— 老滚轮无上界,月历默认只渲染 6 个月,放宽到一年。 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const WXML = fs.readFileSync(path.join(ROOT, 'pages/topic/merchantapply/index.wxml'), 'utf8')
const cal = require(path.join(ROOT, 'utils/calendar.js'))

function assertSheetWiring(source) {
  const m = source.match(/<cy-date-range-sheet[\s\S]*?\/>/)
  assert.ok(m, '页面必须保留 cy-date-range-sheet')
  assert.match(m[0], /allow-same-day="\{\{true\}\}"/, '单日活动 start=end 必须放行')
  assert.match(m[0], /min="\{\{availabilityMin\}\}"/, '起始日不得早于今天')
}

test('cy-date-range-sheet 必须带 allow-same-day / min 两根线', () => {
  assertSheetWiring(WXML)
})

test('负控:抽掉任意一根线,契约必须判红', () => {
  assert.throws(() => assertSheetWiring(WXML.replace(/\s*allow-same-day="\{\{true\}\}"/, '')))
  assert.throws(() => assertSheetWiring(WXML.replace(/\s*min="\{\{availabilityMin\}\}"/, '')))
})

/* 2026-09-03:原来这里还有一条「pubOpenRange 打开时把 min 现算成今天」——
   它测的是已删掉的官方活动发布面板。min 现算这件事在 merchantapply 上由
   下面这条接住:min 必须来自 data 里一个会被赋值的字段,而不是写死的字面日期。 */
test('min 是运行时算出来的,不是烤死在 wxml 里的字面日期', () => {
  const m = WXML.match(/<cy-date-range-sheet[\s\S]*?\/>/)
  assert.doesNotMatch(m[0], /min="\d{4}-\d{2}-\d{2}"/, '写死日期会随时间过期,必须运行时算')
  const js = fs.readFileSync(path.join(ROOT, 'pages/topic/merchantapply/index.js'), 'utf8')
  assert.match(js, /availabilityMin/, '页面 js 必须真的给 availabilityMin 赋值')
})
