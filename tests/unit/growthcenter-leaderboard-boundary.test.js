const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PAGE_PATH = path.resolve(__dirname, '../../subpackageP3/pages/growthcenter/leaderboard/index.js')
let pageConfig

global.getApp = () => ({ sendRequest() {} })
global.wx = { stopPullDownRefresh() {} }
global.Page = (config) => { pageConfig = config }

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)]
  pageConfig = null
  require(PAGE_PATH)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

test('排行榜：同分顺排名次按后端 rank 原样展示', () => {
  const page = loadPage()
  page.buildBoard({
    list: [
      { memberId: 1, nickname: '甲', score: 10, rank: 1 },
      { memberId: 2, nickname: '乙', score: 10, rank: 2 },
      { memberId: 3, nickname: '丙', score: 8, rank: 3 }
    ],
    me: { memberId: 9, nickname: '我', score: 0, rank: null }
  })

  assert.deepEqual(page.data.top3.map((row) => row.rank), [1, 2, 3])
  assert.equal(page.data.me, null)
})

test('排行榜拒绝含空元素的榜单载荷', () => {
  const page = loadPage()
  assert.doesNotThrow(() => page.buildBoard({ list: [null] }))
  assert.match(page.data.errorMsg, /没有加载出来/)
})
