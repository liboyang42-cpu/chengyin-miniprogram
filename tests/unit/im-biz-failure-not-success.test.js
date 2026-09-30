const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const ROOT = path.resolve(__dirname, '../..')

/**
 * 2026-08-28 全量审核 A3 抓到的一类假保证:IM 把 HTTP 200 里的**业务失败**当成功。
 *
 * 统一请求层(utils/transport/request-client.js:136-140)对 HTTP 200 且业务
 * code != 200 的响应**仍然调用 success()** —— 后端 AjaxResult.error(...) 正是这种形状
 * (ApiImController 捕获异常后返回的就是它,不是 HTTP 非 200)。
 * 于是「已读 / 删除会话 / 全部已读 / 拉黑」四处在 success 里直接改本地状态并弹成功提示,
 * 服务端明明失败了,用户看到的却是「已删除」「已拉黑」,而且没有重试入口。
 *
 * ⚠️ 这里必须是**行为测**:真把页面的 handler 跑一遍,喂 {code:500} 进 success 回调,
 * 断言本地状态没被改、提示是失败文案。静态匹配挡不住「判了 code 但判反了」这类。
 */
function loadPage(relPath, { onRequest, tips }) {
  const abs = path.join(ROOT, relPath)
  const src = fs.readFileSync(abs, 'utf8')
  let captured = null
  const app = {
    sendRequest: onRequest,
    tips: tips,
    globalData: {},
    getUserID: () => 1,
  }
  global.getApp = () => app
  global.Page = (cfg) => { captured = cfg }
  global.wx = {
    getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 20, height: 32, left: 300 }),
    showToast: (o) => { global.__toasts.push(o && o.title) },
    showModal: (o) => { o.success && o.success({ confirm: true }) },
    navigateBack: (o) => { global.__backs.push(o || {}); if (o && o.fail) o.fail({ errMsg: 'navigateBack:fail' }) },
    redirectTo: (o) => { global.__redirects.push(o && o.url) },
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    nextTick: (fn) => fn(),
    createSelectorQuery: () => ({
      in: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) }),
      select: () => ({ boundingClientRect: () => ({}), scrollOffset: () => ({}) }),
      selectAll: () => ({ boundingClientRect: () => ({}) }),
      exec: () => {},
    }),
    onKeyboardHeightChange: () => {},
    offKeyboardHeightChange: () => {},
    setNavigationBarTitle: () => {},
  }
  global.__toasts = []
  global.__backs = []
  global.__redirects = []
  const m = new Module(abs, null)
  m.filename = abs
  m.paths = Module._nodeModulePaths(path.dirname(abs))
  m._compile(src, abs)
  assert.ok(captured, `${relPath} 没有调用 Page({...})`)
  return captured
}

function makePage(cfg, data) {
  const page = Object.assign(Object.create(null), cfg)
  page.data = Object.assign({}, cfg.data, data)
  page.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('[') === -1 && k.indexOf('.') === -1) { page.data[k] = patch[k]; return }
      // 只需支持 list[i].unread 这一种路径
      const m = /^list\[(\d+)\]\.(\w+)$/.exec(k)
      if (m) page.data.list[Number(m[1])][m[2]] = patch[k]
    })
  }
  // 2026-09-06 危险写走 cy-danger-confirm 三段式:页面用 selectComponent('#dc') 打开确认,
  // 确认后走 onDangerConfirm;结果由 dc.done()/dc.failed(text) 呈现。沙箱里用一个直接确认的假 dc。
  global.__dc = { failed: [], done: 0 }
  page.selectComponent = (id) => (id === '#dc' ? {
    open: (key) => { page.onDangerConfirm({ detail: { key } }); return true },
    busyOn: () => {},
    done: () => { global.__dc.done += 1 },
    failed: (text) => { global.__dc.failed.push(text) },
    close: () => {},
  } : null)
  return page
}

const BIZ_FAIL = { code: 500, msg: '操作失败' }

test('删除会话:业务失败时会话不能从列表里消失,也不能报「已删除」', () => {
  let sent = null
  const tipped = []
  const cfg = loadPage('subpackageB/pages/im/list/index.js', {
    onRequest: (p) => { sent = p },
    tips: (t) => tipped.push(t),
  })
  const page = makePage(cfg, { list: [{ conversationId: 'c1', unread: 3 }] })
  page.closeRow = () => {}
  page.refreshView = () => {}

  page.onRowDelete({ currentTarget: { dataset: { id: 'c1', index: 0 } } })
  assert.ok(sent && sent.url === '/api/im/delete', '应当发出删除请求')

  sent.success(BIZ_FAIL)
  assert.equal(page.data.list.length, 1, '业务失败时会话必须还在列表里')
  assert.ok(!global.__toasts.includes('已删除') && global.__dc.done === 0, '业务失败时不能报「已删除」')
  assert.ok(tipped.length > 0 || global.__dc.failed.length > 0, '业务失败时必须给用户一个可见的失败提示')
})

test('删除会话:业务成功时照旧移除并提示', () => {
  let sent = null
  const cfg = loadPage('subpackageB/pages/im/list/index.js', {
    onRequest: (p) => { sent = p }, tips: () => {},
  })
  const page = makePage(cfg, { list: [{ conversationId: 'c1', unread: 3 }] })
  page.closeRow = () => {}
  page.refreshView = () => {}
  page.onRowDelete({ currentTarget: { dataset: { id: 'c1', index: 0 } } })
  sent.success({ code: 200 })
  assert.equal(page.data.list.length, 0, '业务成功时应当移除')
  assert.ok(global.__toasts.includes('已删除') || global.__dc.done === 1, '成功要有结果确认(dc.done)')
})

test('单条已读:业务失败时未读数不能被清零', () => {
  let sent = null
  const tipped = []
  const cfg = loadPage('subpackageB/pages/im/list/index.js', {
    onRequest: (p) => { sent = p }, tips: (t) => tipped.push(t),
  })
  const page = makePage(cfg, { list: [{ conversationId: 'c1', unread: 3 }] })
  page.closeRow = () => {}
  page.refreshView = () => {}
  page.onRowRead({ currentTarget: { dataset: { id: 'c1', index: 0 } } })
  sent.success(BIZ_FAIL)
  assert.equal(page.data.list[0].unread, 3, '业务失败时未读数必须保持原值')
  assert.ok(tipped.length > 0, '必须提示失败')
})

test('全部已读:一条都没成功时不能报「已全部标为已读」', () => {
  const sentList = []
  const tipped = []
  const cfg = loadPage('subpackageB/pages/im/list/index.js', {
    onRequest: (p) => { sentList.push(p) }, tips: (t) => tipped.push(t),
  })
  const page = makePage(cfg, {
    list: [{ conversationId: 'c1', unread: 2 }, { conversationId: 'c2', unread: 1 }],
  })
  page.tabOf = () => 0
  page.loadConversations = () => {}
  page.onReadAll()
  assert.equal(sentList.length, 2, '两条未读应当各发一次请求')
  sentList.forEach((p) => { p.success && p.success(BIZ_FAIL); p.complete && p.complete() })
  assert.ok(!global.__toasts.includes('已全部标为已读'),
    '全部业务失败时不能弹「已全部标为已读」—— 原实现用 complete 计数,断网也会弹')
  assert.ok(tipped.length > 0, '必须提示失败')
})

test('拉黑:业务失败时不能禁用输入框、不能报「已拉黑」', () => {
  let sent = null
  const tipped = []
  const cfg = loadPage('subpackageB/pages/im/chat/index.js', {
    onRequest: (p) => { sent = p }, tips: (t) => tipped.push(t),
  })
  // doBlock 从最近一条「对方发的」消息里取 otherId(chat/index.js:457-462),所以要喂 msgs
  const page = makePage(cfg, {
    myId: 1,
    msgs: [{ senderId: 1 }, { senderId: 42 }],
    disabled: false,
    disabledText: '',
  })
  // 不写死 handler 名:找出源码里真的发 /api/im/block 的那个方法,改名了也不会假绿
  // 发请求的是 onDangerConfirm(确认后),发起确认的是 doBlock;两步都真跑
  assert.ok(typeof cfg.doBlock === 'function' && /api\/im\/block/.test(String(cfg.onDangerConfirm)), '拉黑必须走 dc 确认后再发请求')
  page.doBlock({})
  assert.ok(sent && sent.url === '/api/im/block', '应当发出拉黑请求')
  sent.success(BIZ_FAIL)
  assert.equal(page.data.disabled, false, '业务失败时输入框不能被禁用')
  assert.ok(!global.__toasts.includes('已拉黑') && global.__dc.done === 0, '业务失败时不能报「已拉黑」')
  assert.ok(tipped.length > 0 || global.__dc.failed.length > 0, '必须提示失败')
})

test('清空聊天:必须先 POST /api/im/delete,业务失败时不能假装已清空也不能离开会话', () => {
  let sent = null
  const tipped = []
  const cfg = loadPage('subpackageB/pages/im/chat/index.js', {
    onRequest: (p) => { sent = p }, tips: (t) => tipped.push(t),
  })
  const page = makePage(cfg, {
    conversationId: 9,
    msgs: [{ id: 1, senderId: 42 }],
  })
  page.onMoreSelect({ detail: { label: '清空聊天' } })
  assert.ok(sent && sent.url === '/api/im/delete', '清空聊天必须打与列表相同的删除接口')
  assert.equal(sent.data.conversation_id, 9)
  sent.success(BIZ_FAIL)
  assert.equal(page.data.msgs.length, 1, '业务失败时消息不能被本地抹掉')
  assert.equal(global.__backs.length, 0, '失败时不能退出会话')
  assert.ok(tipped.length > 0, '必须提示失败')
})

test('清空聊天:业务成功后回到会话列表', () => {
  let sent = null
  const cfg = loadPage('subpackageB/pages/im/chat/index.js', {
    onRequest: (p) => { sent = p }, tips: () => {},
  })
  const page = makePage(cfg, { conversationId: 9, msgs: [{ id: 1, senderId: 42 }] })
  page.onMoreSelect({ detail: { label: '清空聊天' } })
  sent.success({ code: 200 })
  assert.ok(global.__backs.length > 0 || global.__redirects.includes('/subpackageB/pages/im/list/index'),
    '删除成功必须回到会话列表')
})
