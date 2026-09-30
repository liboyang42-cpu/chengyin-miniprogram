const { test } = require('node:test')
const assert = require('node:assert/strict')

// 3-20:评论点赞是开关语义。第二次点后端已取消,前端曾仍置 isLiked=1 并 +1。
function loadDetail() {
  let def
  const requests = []
  global.getApp = () => ({
    globalData: {}, sendRequest: o => requests.push(o),
    getRequestErrorMessage: (_r, f) => f, getUserID: () => 7,
  })
  global.wx = { getStorageSync: () => '', showToast() {} }
  global.Page = c => { def = c }
  const mod = require.resolve('../../pages/square/detail/index.js')
  delete require.cache[mod]
  require(mod)
  const page = Object.assign({}, def)
  page.data = { list: [{ id: 5, isLiked: 1, likeCount: 3 }] }
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return { page, requests }
}

const tap = (page) => page.commentLikeClick({ currentTarget: { dataset: { index: 0 } } })

test('后端回包 isLiked=0(已取消):前端取消高亮并 -1', () => {
  const { page, requests } = loadDetail()
  tap(page)
  requests[0].success({ code: 200, msg: '取消点赞成功', data: { isLiked: 0 } })
  assert.equal(page.data.list[0].isLiked, 0)
  assert.equal(page.data.list[0].likeCount, 2)
})

test('后端回包 isLiked=1:高亮并 +1;已是终态不重复加', () => {
  const { page, requests } = loadDetail()
  page.data.list[0] = { id: 5, isLiked: 0, likeCount: 3 }
  tap(page)
  requests[0].success({ code: 200, msg: '点赞成功', data: { isLiked: 1 } })
  assert.equal(page.data.list[0].isLiked, 1)
  assert.equal(page.data.list[0].likeCount, 4)
  requests[0].complete()
  tap(page)
  requests[1].success({ code: 200, data: { isLiked: 1 } })
  assert.equal(page.data.list[0].likeCount, 4, '终态没变就不动计数')
})

test('旧后端没回 isLiked:按开关语义取反', () => {
  const { page, requests } = loadDetail()
  tap(page)
  requests[0].success({ code: 200, msg: '取消点赞成功' })
  assert.equal(page.data.list[0].isLiked, 0)
  assert.equal(page.data.list[0].likeCount, 2)
})
