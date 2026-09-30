// CU-C-142 / CU-C-120 —— 会话页顶栏入口名 + 系统通知只读。
//
// CU-C-142:顶栏右侧药丸写「详情」,点开的却是标题「更多」的举报/拉黑/清空面板,里面没有会话详情。
//          走查给的两条出路(改名 / 换图标)里选改名:面板内容本来就没有「详情」这一层,改名才是真一致。
// CU-C-120:俱乐部群发通知落进 type=2 的系统通知会话,前端照常给输入栏、加号、发送,右上角照常给
//          举报/拉黑。后端拒收(库里没写进去)是正确边界,但用户先被界面邀请打字,发出去才红一个
//          气泡、还能点重试 —— 可供性说了假话。系统的「对方」在后端恒为 id=0,举报与拉黑没有对象。
//          修法是进入前就按会话类型收窄,不是发完再报错。
// 每条都配负控:把守卫改回病灶形态,检查器必须判红。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const CHAT_JS = 'subpackageB/pages/im/chat/index.js'
const CHAT_WXML = 'subpackageB/pages/im/chat/index.wxml'

// ---------------------------------------------------------------- 页面沙箱
// 与 c06-r2-affordance-contract.test.js 同构:从源码字符串装载,负控才能把真源码改回病灶形态后真跑。
function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(rel, transform) {
  const requests = []
  global.getApp = () => ({
    globalData: { user_id: 9, statusBarHeight: 20, navBarHeight: 44, features: {} },
    isDevEnv: () => false,
    getUserID: () => 9,
    getAvatar: () => '',
    tips() {},
    chooseImage() {},
    sendRequest: (options) => { requests.push(options) },
  })
  global.getCurrentPages = () => [{}, {}]
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    showLoading() {}, hideLoading() {}, showToast() {},
    navigateTo() {}, navigateBack() {}, redirectTo() {},
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }),
  }

  let config = null
  global.Page = (cfg) => { config = cfg }
  const abs = path.join(ROOT, rel)
  let src = fs.readFileSync(abs, 'utf8')
  if (transform) {
    const next = transform(src)
    assert.notEqual(next, src, '变异锚点失效(源码已改动?)')
    src = next
  }
  const dir = path.dirname(abs)
  const localRequire = (id) => require(id.startsWith('.') ? path.resolve(dir, id) : id)
  const factory = new Function('Page', 'getApp', 'getCurrentPages', 'wx', 'require', 'module', 'exports', src)
  factory(global.Page, global.getApp, global.getCurrentPages, global.wx, localRequire, { exports: {} }, {})
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) })
  page.setData = (patch, cb) => {
    Object.entries(patch).forEach(([k, v]) => setByPath(page.data, k, v))
    if (cb) cb()
  }
  return { page, requests }
}

const openChat = (type, transform) => {
  const ctx = loadPage(CHAT_JS, transform)
  ctx.page.onLoad({ type: String(type), conversationId: '55', name: type === 2 ? '系统通知' : '主理人' })
  ctx.page.setData({ loadState: 'ready' })
  return ctx
}

// ============================================================ CU-C-142 入口名 = 面板标题
function assertMoreEntryNamed(wxml) {
  const pill = wxml.match(/class="hd-details">([^<]*)<\/view>/)
  assert.ok(pill, '顶栏必须保留那枚入口药丸')
  assert.equal(pill[1].trim(), '更多', '入口名必须与它打开的面板标题一致(原来写「详情」,面板里根本没有详情)')
  assert.match(wxml, /cy-option-sheet show="\{\{moreSheetShow\}\}" title="更多"/, '面板标题必须仍是「更多」')
  // 名字改了,绑的事件不能被顺手改错
  assert.match(wxml, /class="hd-info-hit"[\s\S]{0,120}?bindtap="onMore"/, '入口仍必须绑 onMore')
}

test('CU-C-142 静态:顶栏入口写「更多」,与面板标题同名', () => {
  assertMoreEntryNamed(read(CHAT_WXML))
})

test('negative control CU-C-142: 入口名改回「详情」⇒ 判红', () => {
  const wxml = read(CHAT_WXML)
  const renamed = wxml.replace('class="hd-details">更多<', 'class="hd-details">详情<')
  assert.notEqual(renamed, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertMoreEntryNamed(renamed), assert.AssertionError)
})

// ============================================================ CU-C-120 系统通知只读
function assertSystemReadOnlyMarkup(wxml) {
  // ① 输入控件必须整组被 !readOnly 罩住 —— 只把 input 置 disabled 就是走查里那种「先开放再报错」。
  const gate = wxml.indexOf('<block wx:if="{{!readOnly}}">')
  assert.ok(gate >= 0, '输入栏必须存在 !readOnly 的条件层')
  const plus = wxml.search(/<view\b[^>]*\bclass="plus"/)
  const input = wxml.indexOf('<input class="inp"')
  const close = wxml.indexOf('</block>', gate)
  assert.ok(plus > gate && input > gate, '加号与输入框都必须在 !readOnly 条件层之内')
  assert.ok(plus < close && input < close, '条件层必须真的包住加号与输入框(不能提前闭合)')

  // ② 只读时同一位置给一句说明,不留一条空栏。
  assert.match(wxml, /<text wx:else class="input-notice">\{\{readOnlyTip\}\}<\/text>/,
    '只读会话必须在输入栏原位说明为什么不能回复')

  // ③ 重试不能留在只读会话里(发送失败的气泡根本不该出现)。
  assert.doesNotMatch(wxml.slice(gate - 400, gate), /onResend/, '输入栏条件层之前不该另起一处重试入口')
}

test('CU-C-120 静态:输入控件整组挂在 !readOnly 下,原位给出说明', () => {
  assertSystemReadOnlyMarkup(read(CHAT_WXML))
})

test('CU-C-120 行为:type=2 系统通知 ⇒ 只读,一个字都发不出去', () => {
  const ctx = openChat(2)
  assert.equal(ctx.page.data.readOnly, true, 'type=2 必须落进只读')
  assert.deepEqual(ctx.page.data.moreSheetItems, ['清空聊天'],
    '系统通知的对方是 id=0 的平台,举报/拉黑没有目标 ⇒ 只留真能做的清空聊天')
  assert.equal(ctx.page._canSend(), false)

  ctx.page.setData({ text: '隔离走查：系统通知回复入口验证' })
  ctx.page.onSend()
  assert.equal(ctx.requests.filter((r) => r.url === '/api/im/send').length, 0, '只读会话不许打发送接口')

  ctx.page.onPlus()
  assert.equal(ctx.page.data.plusSheetShow, false, '只读会话不该打开附件面板')
})

test('CU-C-120 行为:type=1/3 仍可回复,只读不许扩大', () => {
  ;[1, 3].forEach((type) => {
    const ctx = openChat(type)
    assert.equal(ctx.page.data.readOnly, false, `type=${type} 是可回复会话,不能被一起锁死`)
    assert.deepEqual(ctx.page.data.moreSheetItems, ['举报', '拉黑', '清空聊天'])
    assert.equal(ctx.page._canSend(), true)
  })
})

test('negative control CU-C-120: 撤掉只读闸 ⇒ 系统通知又能发消息,行为与静态同时判红', () => {
  // 行为侧:把 _canSend 改回只看 loadState
  const ctx = openChat(2, (src) => src.replace(
    "_canSend() { return this.data.loadState === 'ready' && !this.data.disabled && !this.data.readOnly; }",
    "_canSend() { return this.data.loadState === 'ready'; }",
  ))
  assert.equal(ctx.page._canSend(), true, '变异没生效')
  assert.throws(() => assert.equal(ctx.page._canSend(), false), assert.AssertionError)
  const healthy = openChat(2)
  assert.equal(healthy.page._canSend(), false)

  // 行为侧:onLoad 不再按 type 收 moreSheetItems ⇒ 举报/拉黑复活
  const items = openChat(2, (src) => src.replace(
    "moreSheetItems: readOnly ? ['清空聊天'] : ['举报', '拉黑', '清空聊天'],",
    "moreSheetItems: ['举报', '拉黑', '清空聊天'],",
  ))
  assert.throws(
    () => assert.deepEqual(items.page.data.moreSheetItems, ['清空聊天']),
    assert.AssertionError,
  )

  // 静态侧:把 !readOnly 换成 loadState 条件 ⇒ 只读会话又长出输入控件
  const wxml = read(CHAT_WXML)
  const ungated = wxml.replace('<block wx:if="{{!readOnly}}">', '<block wx:if="{{true}}">')
  assert.notEqual(ungated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSystemReadOnlyMarkup(ungated), assert.AssertionError)

  // 静态侧:只留一句说明、把说明摘掉 ⇒ 判红
  const noNotice = wxml.replace('<text wx:else class="input-notice">{{readOnlyTip}}</text>', '<view wx:else></view>')
  assert.notEqual(noNotice, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSystemReadOnlyMarkup(noNotice), assert.AssertionError)
})
