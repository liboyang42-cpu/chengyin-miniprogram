const { test } = require('node:test')
const assert = require('node:assert/strict')

// 3-22:举报固定报最后一条(可能是自己发的);拉黑后重进会话输入框又能打字。
function loadChat() {
  let def
  const requests = []
  const tips = []
  global.getApp = () => ({
    globalData: {}, sendRequest: o => requests.push(o), tips: t => tips.push(t),
    getUserID: () => 1, getRequestErrorMessage: (_r, f) => f,
  })
  global.wx = { getStorageSync: () => '' }
  global.Page = c => { def = c }
  const mod = require.resolve('../../subpackageB/pages/im/chat/index.js')
  delete require.cache[mod]
  require(mod)
  const page = Object.assign({}, def)
  page.data = JSON.parse(JSON.stringify(def.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page.scrollBottom = () => {}
  page.markRead = () => {}
  return { page, requests, tips }
}

test('举报:只报对方发的最近一条,不报自己刚发的', () => {
  const { page, requests } = loadChat()
  page.data.myId = 1
  page.data.msgs = [{ id: 10, senderId: 2 }, { id: 11, senderId: 1 }, { id: 'tmp_x', senderId: 1 }]
  page.doReport()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].data.message_id, 10)
})

test('举报:对方没发过消息就不提交', () => {
  const { page, requests, tips } = loadChat()
  page.data.myId = 1
  page.data.msgs = [{ id: 11, senderId: 1 }]
  page.doReport()
  assert.equal(requests.length, 0)
  assert.equal(tips.length, 1)
})

test('进会话读服务端拉黑态:我拉黑了对方 → 禁用输入', () => {
  const { page, requests } = loadChat()
  page.data.conversationId = 100
  page.loadMessages()
  requests[0].success({ code: 200, data: { list: [], blocked: true, blockedByMe: true } })
  assert.equal(page.data.disabled, true)
  assert.equal(page.data.disabledText, '你已拉黑对方，无法发送消息')
})

test('进会话读服务端拉黑态:对方拉黑了我 → 也禁用', () => {
  const { page, requests } = loadChat()
  page.data.conversationId = 100
  page.loadMessages()
  requests[0].success({ code: 200, data: { list: [], blocked: true, blockedByMe: false } })
  assert.equal(page.data.disabled, true)
  assert.equal(page.data.disabledText, '对方暂不可联系，无法发送消息')
})
