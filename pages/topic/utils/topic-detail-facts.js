function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/* 稿 214:384(玩家深色)/ 181:575(商家浅色)封面下面那条**数据条**。
   两端是同一块,只换色板 —— 所以格子必须同一份,不能两页各算各的。
   稿上的五格:评价 / 预计游玩 / 开放时间 / 总里程 / 参与商家。
   ⚠️ 2026-09-10 之前玩家页走的是另一套格子(章节 / 预计用时 / 总里程 / 参与玩家),
      与稿和商家页都对不上:同一条路线,两个身份看到的关键数字不是同一套。
   每格「有就出、没有就整格不出」——「—」占位会让一条真空数据条看着像有内容。 */
function buildTopicStatBar(info) {
  const data = info || {}
  const cells = []

  const rating = positiveNumber(data.averageRating)
  if (rating) {
    cells.push({
      key: 'rating', label: '评价',
      // 稿写的是 4.8,不是 5 —— 星星取整,评分本身不取整
      value: String(Math.round(rating * 10) / 10),
      // 数组不是数字:wx:for 只遍历数组,给个 count 会静默什么都不渲染
      starList: Array.from({ length: Math.max(0, Math.min(5, Math.round(rating))) }, (v, i) => i),
    })
  }

  const hours = positiveNumber(data.totalTime) / 3600
  if (hours >= 0.1) {
    const rounded = hours % 1 === 0 ? hours : Math.round(hours * 10) / 10
    cells.push({ key: 'hour', label: '预计游玩', value: rounded + '+', sub: '小时' })
  }

  const start = String(data.showStartDate || '').trim()
  const end = String(data.showEndDate || '').trim()
  /* CU-M-88:这一格的值是**起止日期区间**(7.4-7.29),副标签原来固定写「总时长」,
     把一段日期说成了时长 —— 而真正的时长是上一格「预计游玩 · 小时」,两格语义撞车。
     日期区间不需要副标签,删掉它(wxml 的 wx:elif 缺 sub 时整行不出)。 */
  if (start && end) cells.push({ key: 'open', label: '开放时间', value: start + '-' + end })

  const mileage = positiveNumber(data.totalMileage)
  if (mileage) cells.push({ key: 'mileage', label: '总里程', value: String(mileage), sub: '公里' })

  const merchants = Math.floor(positiveNumber(data.registrationMerchantCount))
  if (merchants) cells.push({ key: 'merchant', label: '参与商家', value: String(merchants), sub: '家' })

  return cells
}

module.exports = { buildTopicStatBar }
