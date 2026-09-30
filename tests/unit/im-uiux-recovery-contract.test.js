'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const LIST_MODULE = path.join(ROOT, 'subpackageB/pages/im/list/index.js')
const CHAT_MODULE = path.join(ROOT, 'subpackageB/pages/im/chat/index.js')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadPage(modulePath) {
  const requests = []
  const toasts = []
  let definition
  global.getApp = () => ({
    globalData: {},
    getUserID: () => 8,
    getAvatar: () => '',
    getRequestErrorMessage: (response, fallback) => (response && (response.msg || response.errMsg)) || fallback,
    sendRequest: (options) => requests.push(options),
  })
  global.Page = (config) => { definition = config }
  global.wx = {
    showToast: (options) => toasts.push(options && options.title),
  }
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
  })
  return { page, requests, toasts }
}

test('消息列表静默刷新失败保留旧会话，并给原位重试而不是整页错误', () => {
  const h = loadPage(LIST_MODULE)
  const old = [{ conversationId: 1, unread: 0, type: 1 }]
  h.page.data.loaded = true
  h.page.data.list = old
  h.page.data.viewList = old
  h.page.loadConversations(true)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].hideLoading, true)
  assert.equal(h.requests[0].silentError, true)
  h.requests[0].fail({ msg: '刷新失败，请稍后重试' })
  assert.equal(h.page.data.error, false)
  assert.deepEqual(h.page.data.list, old)
  assert.deepEqual(h.toasts, [])
})

test('消息列表只接受最新请求，迟到失败不能覆盖新列表', () => {
  const h = loadPage(LIST_MODULE)
  h.page.loadConversations()
  h.page.loadConversations()
  assert.equal(h.requests.length, 2)
  h.requests[1].success({ code: 200, data: [] })
  h.requests[0].fail({ msg: '旧请求失败' })
  assert.equal(h.page.data.loaded, true)
  assert.equal(h.page.data.error, false)
})

test('聊天记录加载更多单飞，失败保留现有消息与同一游标重试入口', () => {
  const h = loadPage(CHAT_MODULE)
  const old = [{ id: 9, content: '已确认消息' }]
  h.page.data.conversationId = 7
  h.page.data.hasMore = true
  h.page.data.cursor = 42
  h.page.data.msgs = old
  h.page.loadMore()
  h.page.loadMore()
  assert.equal(h.requests.length, 1)
  assert.equal(h.page.data.loadingMore, true)
  assert.equal(h.requests[0].silentError, true)
  h.requests[0].fail({ msg: '更早消息暂时不可用' })
  assert.equal(h.page.data.loadingMore, false)
  assert.equal(h.page.data.loadMoreError, '更早消息暂时不可用')
  assert.deepEqual(h.page.data.msgs, old)
  assert.equal(h.page.data.cursor, 42)
  assert.deepEqual(h.toasts, [])
})

test('关闭的组局不是网络错误：展示终态并提供返回消息列表入口', () => {
  const h = loadPage(CHAT_MODULE)
  h.page._setMessageLoadError({ errorCode: 'HANGOUT_CLOSED', msg: '该组局已结束，聊天已关闭' })
  assert.equal(h.page.data.loadState, 'closed')
  assert.match(read('subpackageB/pages/im/chat/index.wxml'), /loadState === 'closed'/)
  assert.match(read('subpackageB/pages/im/chat/index.wxml'), /返回消息列表/)
  assert.match(read('subpackageB/pages/im/chat/index.js'), /returnToMessageList/)
  const destinations = []
  global.wx.redirectTo = ({ url }) => destinations.push(url)
  h.page.returnToMessageList()
  assert.deepEqual(destinations, ['/subpackageB/pages/im/list/index'])
  h.page._setMessageLoadError({ errorCode: 'HANGOUT_CLOSED', returnPath: '/subpackageB/pages/im/list/index?closed=1' })
  h.page.returnToMessageList()
  assert.equal(destinations[1], '/subpackageB/pages/im/list/index?closed=1')
})

test('路线选择器把畸形或失败载荷显示为错误，不冒充搜索空结果', () => {
  const malformed = loadPage(CHAT_MODULE)
  malformed.page.loadRoutes()
  malformed.requests[0].success({ code: 200, data: { rows: {} } })
  assert.equal(malformed.page.data.routeLoading, false)
  assert.notEqual(malformed.page.data.routeError, '')
  assert.deepEqual(malformed.page.data.routeList, [])

  const failed = loadPage(CHAT_MODULE)
  failed.page.loadRoutes()
  failed.requests[0].fail({ msg: '路线加载失败' })
  assert.equal(failed.page.data.routeError, '路线加载失败')
})

test('消息页使用图标库与持久恢复组件，不再用文字或 CSS 伪造图标', () => {
  const listWxml = read('subpackageB/pages/im/list/index.wxml')
  const listJson = JSON.parse(read('subpackageB/pages/im/list/index.json'))
  const chatWxml = read('subpackageB/pages/im/chat/index.wxml')
  assert.equal(listJson.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.doesNotMatch(listWxml, /<cy-inline-error[^>]*staleError/)  // 刷新失败静默降级
  assert.match(listWxml, /<cy-icon name="bell"/)
  assert.match(listWxml, /<cy-icon[^>]*name="trash"/)
  assert.doesNotMatch(listWxml, /act-check|act-bell-body|class="bell"|mute-bell/)
  assert.match(chatWxml, /loadMoreError/)
  assert.match(chatWxml, /routeError/)
  assert.match(chatWxml, /<cy-icon name="plus"/)
  assert.match(chatWxml, /<cy-icon[^>]*name="pin"/)
  assert.match(chatWxml, /<cy-icon[^>]*name="warning"/)
  assert.doesNotMatch(chatWxml, /class="pin"|class="card-ico"|class="fail-bang"|<text>\+<\/text>/)
})

test('负控：把刷新失败横幅加回列表页必须判红', () => {
  const wxml = read('subpackageB/pages/im/list/index.wxml')
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*staleError/, '刷新失败静默降级')
  const broken = wxml.replace('</view>', '<cy-inline-error wx:if="{{staleError}}" /></view>')
  assert.notEqual(broken, wxml, '负控锚点失效')
  assert.match(broken, /<cy-inline-error[^>]*staleError/)
})

test('系统举报通知可回查完整结果，普通消息不能伪造结果入口', () => {
  const { page } = loadPage(CHAT_MODULE)
  const result = { taskId: 40, bizId: 88, outcome: '举报成立，组局已关闭', reason: '扰民', followUp: '联系客服并提供任务编号' }
  page.data.msgs = [{ id: 51, senderId: 0, msgType: 3, card: { result } }]
  page.onCardTap({ currentTarget: { dataset: { msg: 51 } } })
  assert.deepEqual(page.data.reviewResult, result)
  page.closeReviewResult()
  assert.equal(page.data.reviewResult, null)
  page.data.msgs[0].senderId = 8
  page.onCardTap({ currentTarget: { dataset: { msg: 51 } } })
  assert.equal(page.data.reviewResult, null)
  assert.match(read('subpackageB/pages/im/chat/index.wxml'), /查看处理结果/)
  assert.match(read('subpackageB/pages/im/chat/index.wxml'), /reviewResult.reason/)
})
