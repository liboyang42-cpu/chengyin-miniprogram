const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildTopicStatBar } = require('../../pages/topic/utils/topic-detail-facts.js')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/* 稿 214:384(玩家深色)/ 181:575(商家浅色)的数据条。
   2026-09-10 用户实拍并排后判定:两端必须是同一块,只换色板。
   在此之前玩家页走的是另一套格子(章节 / 预计用时 / 总里程 / 参与玩家),
   商家页把五格写死在自己的 wxml 里 —— 同一条路线,两个身份看到的关键数字不是同一套。 */

test('数据条的五格按稿:评价 / 预计游玩 / 开放时间 / 总里程 / 参与商家', () => {
  const cells = buildTopicStatBar({
    averageRating: 4.8,
    totalTime: 15300,          // 4.25h
    showStartDate: '7.4',
    showEndDate: '10.3',
    totalMileage: '48',
    registrationMerchantCount: 5,
  })

  assert.deepEqual(cells.map((c) => [c.label, c.value, c.sub || '']), [
    ['评价', '4.8', ''],
    ['预计游玩', '4.3+', '小时'],
    ['开放时间', '7.4-10.3', ''],
    ['总里程', '48', '公里'],
    ['参与商家', '5', '家'],
  ])
})

/* ⚠️ 这条防的是一个真出过的 bug:商家版曾经把 averageRating 覆盖成四舍五入后的整数,
   数据条上那格就把 4.8 印成了 5。星星取整,评分本身不取整 —— 两个值必须分开存。 */
test('星星取整,评分本身不取整', () => {
  const [rating] = buildTopicStatBar({ averageRating: 4.8 })
  assert.equal(rating.value, '4.8', '评分显示的是真值')
  assert.equal(rating.starList.length, 5, '星星是取整后的颗数')
  // wx:for 只遍历数组。给个数字会静默什么都不渲染 —— 一颗星都不出,还不报错。
  assert.ok(Array.isArray(rating.starList), '星星必须是数组,不能是 count')
})

test('缺值的格子整格不出,不拿 0 或「—」占位', () => {
  assert.deepEqual(buildTopicStatBar({ averageRating: null, totalTime: 0 }), [])
  // 开放时间要首尾都有才成立:只有开始日期时「7.4-」不是一个区间
  assert.deepEqual(buildTopicStatBar({ showStartDate: '7.4' }), [])
})

test('开放时间那格不写「总时长」——日期区间不是时长,时长另有「预计游玩」格', () => {
  const cells = buildTopicStatBar({ showStartDate: '7.4', showEndDate: '7.29', totalTime: 15300 })
  const open = cells.filter((c) => c.key === 'open')[0]
  const hour = cells.filter((c) => c.key === 'hour')[0]
  assert.equal(open.sub || '', '', '副标签不得把起止日期说成时长(CU-M-88)')
  assert.equal(hour.sub, '小时', '真正带时长语义的是这一格')
})

test('两端共用同一份格子 —— 各写各的 wxml 就是这次要修的问题', () => {
  const player = read('pages/topic/index/index.wxml')
  const merchant = read('pages/topic/merchantinfo/merchantinfo.wxml')
  for (const [name, wxml] of [['玩家版', player], ['商家版', merchant]]) {
    assert.match(wxml, /class="statbar"[^>]*wx:if="\{\{statBar\.length\}\}"/, `${name}必须渲染共用的 statBar`)
    assert.match(wxml, /class="statbar__sep"[^>]*wx:if="\{\{index > 0\}\}"/, `${name}的格间竖线首尾不出(稿 188:2968)`)
    assert.match(wxml, /<scroll-view scroll-x class="statbar"/, `${name}的数据条是横滑,不是网格`)
  }
  for (const [name, js] of [['玩家版', read('pages/topic/index/index.js')], ['商家版', read('pages/topic/merchantinfo/merchantinfo.js')]]) {
    assert.match(js, /buildTopicStatBar\(/, `${name}必须调共用函数,不许自己再算一套`)
  }
})
