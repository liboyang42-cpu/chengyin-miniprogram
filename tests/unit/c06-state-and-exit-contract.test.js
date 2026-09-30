// C06(漫游 / 游玩 / 集邮 / 消息)第 1 轮 UI 优化的状态与出口契约。
//
// 六条都不是审美偏好,都是逐张打开 2026-07-29 基线截图(036–041/056/057/059/060)后判定的:
//  C06-1 集邮册在数据还没回来时用最大字号显示「0 枚」(假零),且请求失败与「真的一枚都没有」
//        落到同一个终态 ⇒ 页面渲染空态、连重试都没有(微信官方指南:异常必须「告知解决方案,使其有路可退」)。
//  C06-2 会话页缺 conversationId / 请求失败,全渲染成「还没有消息」,输入栏照常可用 ⇒
//        邀请用户做一件一定会失败的事;对方名字为空 ⇒ 页面没有身份(官方:导航要告诉用户「当前在哪」)。
//  C06-3 漫游历史同一行有两个动作完全相同的出口(裸 ‹ 与圆底 ✕),圆底 chip 还违反 2.1 裸 chevron 裁决。
//  C06-4 单次漫游回看整页没有任何页面身份大标题(错误态尤甚),出口是圆底 × chip(弹层语义用在页面上)。
//  C06-5 游玩页把「缺场次参数」判成 error,于是渲染「重新加载」—— 而 reloadPlay 会再次命中同一个
//        缺参 return,这个按钮物理上永远回到同一状态 = 假按钮。
//  C06-6 集邮相机的快门是盖在拟物机身上的透明热区,页面上没有一个字说「按哪里拍」。
//
// 每条都配非恒真负控:把源码改回病灶形态,检查器必须判红。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const ALBUM_JS = 'subpackageP3/pages/stamp-album/index/index.js'
const ALBUM_WXML = 'subpackageP3/pages/stamp-album/index/index.wxml'
const CHAT_JS = 'subpackageB/pages/im/chat/index.js'
const CHAT_WXML = 'subpackageB/pages/im/chat/index.wxml'
const HISTORY_WXML = 'subpackageRoam/history/index.wxml'
const HISTORY_WXSS = 'subpackageRoam/history/index.wxss'
const HISTORY_SCENE_WXML = 'components/cy/scene-roam-history/index.wxml'
const SESSION_WXML = 'subpackageRoam/session/index.wxml'
const SESSION_WXSS = 'subpackageRoam/session/index.wxss'
const SESSION_SCENE_WXML = 'components/cy/scene-roam-session/index.wxml'
const PLAY_WXML = 'pages/play/index.wxml'
const CAMERA_WXML = 'subpackageP3/pages/stamp-camera/index/index.wxml'

// ---------------------------------------------------------------- 页面沙箱
// 与 play-request-recovery.test.js 同构:只装配被调用到的宿主 API,页面配置由 global.Page 接住。
function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

// 从**源码字符串**装载页面:负控要能把真源码改回病灶形态后**真跑一遍**,
// 而不是拿一个手搭的假对象证明「断言不是恒真」——后者证不到源码那一侧。
function loadPage(rel, hostOverrides, transform) {
  const requests = []
  const routes = []
  global.getApp = () => Object.assign({
    globalData: { user_id: 9, statusBarHeight: 20, navBarHeight: 44, features: {} },
    isDevEnv: () => false,
    getUserID: () => 9,
    getAvatar: () => '',
    sendRequest: (options) => { requests.push(options) },
  }, (hostOverrides && hostOverrides.app) || {})
  global.wx = Object.assign({
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 300 }),
    showLoading() {}, hideLoading() {}, showToast() {},
    navigateTo({ url }) { routes.push(url) },
    redirectTo({ url }) { routes.push(url) },
    navigateBack() { routes.push('back') },
    switchTab({ url }) { routes.push(url) },
    reLaunch({ url }) { routes.push(url) },
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }),
  }, (hostOverrides && hostOverrides.wx) || {})

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
  const factory = new Function('Page', 'getApp', 'wx', 'require', 'module', 'exports', src)
  factory(global.Page, global.getApp, global.wx, localRequire, { exports: {} }, {})
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) })
  page.setData = (patch, cb) => {
    Object.entries(patch).forEach(([k, v]) => setByPath(page.data, k, v))
    if (cb) cb()
  }
  page.createSelectorQuery = global.wx.createSelectorQuery
  return { page, requests, routes }
}

function rule(wxss, selector) {
  const m = wxss.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
  return m ? m[1] : null
}

// ================================================================ C06-1 集邮册
// 「成功读到空列表」是真实空态;「没接通 / 读失败」是另一种状态。两者必须落在不同终态,
// 否则用户会以为册子被清空了 —— 而且现状连重试都没有。
function assertAlbumStates(js, wxml) {
  // ① 计数大字必须等数据到位才渲染,否则首屏就是权威口吻的「0 枚」
  const head = wxml.match(/<view class="al-hd"[^>]*>/)
  assert.ok(head, 'al-hd 计数行必须存在')
  assert.match(head[0], /wx:if="\{\{loaded\}\}"/, '计数大字必须 gate 在 loaded 上,否则数据没回来就先说「0 枚」:' + head[0])

  // ② 失败必须有自己的态 + 一个真的走得通的下一步。整屏失败只属「一枚都没渲染出来」;
  //    已有邮票时那是续页失败,不该把看到的墙换成一张错误页。
  assert.match(wxml, /<cy-error[^>]*wx:if="\{\{error && !items\.length\}\}"[\s\S]{0,240}?bind:retry="retryLoad"/,
    '失败态必须走 cy-error、给重试出口,且整屏形态限定在首屏失败')
  assert.match(wxml, /class="al-more" wx:elif="\{\{error && items\.length\}\}"[^>]*bindtap="retryLoad"/,
    '续页失败必须在页尾给这一页的重试,而不是整屏报错或静默')
  assert.match(js, /retryLoad\s*\(/, 'js 必须实现 retryLoad')

  // ③ 空态与失败态互斥(空态挂 wx:elif 接在失败/加载链上,不能各自独立 wx:if)
  const empty = wxml.match(/<cy-empty [^>]*title="还没有邮票"[^>]*>/)
  assert.ok(empty, '空态必须是 cy-empty(2026-09-06 裸文字空态收编)')
  assert.match(empty[0], /wx:elif="\{\{loaded && total === 0\}\}"/,
    '空态必须挂在失败/加载链的 wx:elif 上,否则失败时空态照样渲染:' + empty[0])
}

test('C06-1 集邮册:计数不假零、失败与空是两个态', () => {
  assertAlbumStates(read(ALBUM_JS), read(ALBUM_WXML))
})

test('C06-1 行为:成功空列表 / 非200 / fail 落三个不同终态', () => {
  // ① 成功且真的零枚 ⇒ loaded=true, error=false, 空态可达
  let ctx = loadPage(ALBUM_JS)
  ctx.page.onLoad()
  ctx.requests[0].success({ code: '200', data: { list: [], total: 0 } })
  assert.equal(ctx.page.data.loaded, true, '成功读到空列表是真实空态')
  assert.equal(ctx.page.data.error, false)

  // ② 非 200 / 无 data ⇒ error 且 loaded 保持 false(空态物理不可达)
  ctx = loadPage(ALBUM_JS)
  ctx.page.onLoad()
  ctx.requests[0].success({ code: '500' })
  assert.equal(ctx.page.data.error, true, '非 200 必须落失败态')
  assert.equal(ctx.page.data.loaded, false, '失败不得置 loaded —— 否则空态「还没有邮票」照样渲染')

  // ③ 网络 fail ⇒ 同上
  ctx = loadPage(ALBUM_JS)
  ctx.page.onLoad()
  ctx.requests[0].fail()
  assert.equal(ctx.page.data.error, true, 'fail 必须落失败态')
  assert.equal(ctx.page.data.loaded, false, 'fail 不得置 loaded')

  // ④ HTTP 层非 200 走 successStatusAbnormal(不是 success 也不是 fail):
  //    不接住它,loading 永远为真 ⇒ 骨架转到底,且 load() 的 if (loading) return 锁死后续分页。
  ctx = loadPage(ALBUM_JS)
  ctx.page.onLoad()
  assert.equal(typeof ctx.requests[0].successStatusAbnormal, 'function', 'HTTP 非 200 必须有人接')
  ctx.requests[0].successStatusAbnormal({})
  assert.equal(ctx.page.data.error, true, 'HTTP 非 200 必须落失败态')
  assert.equal(ctx.page.data.loading, false, '必须解掉 loading,否则分页被永久锁死')
})

test('negative control: 不挂 successStatusAbnormal ⇒ HTTP 非 200 卡在骨架且锁死分页', () => {
  const ctx = loadPage(ALBUM_JS, null, (src) => src.replace(
    /,\n\s*\/\/ HTTP 层非 200[\s\S]*?successStatusAbnormal\(\) \{ that\.setData\(\{ loading: false, error: true \}\); \}/,
    '',
  ))
  ctx.page.onLoad()
  assert.equal(typeof ctx.requests[0].successStatusAbnormal, 'undefined', '变异没生效')
  assert.equal(ctx.page.data.loading, true, '病灶形态下 loading 卡真 —— 这就是骨架转到底的原因')
  ctx.page.load()
  assert.equal(ctx.requests.length, 1, '并且 if (loading) return 把后续分页锁死了')
})

test('negative control: fail 改回 loaded:true(失败伪装成空)必须判红', () => {
  // 真把源码改回病灶形态后跑一遍:失败落进 loaded ⇒ 空态「还没有邮票」会替失败背书。
  const ctx = loadPage(ALBUM_JS, null, (src) => src.replace(
    "fail() { that.setData({ loading: false, error: true }); }",
    "fail() { that.setData({ loading: false, loaded: true }); }",
  ))
  ctx.page.onLoad()
  ctx.requests[0].fail()
  assert.equal(ctx.page.data.loaded, true, '病灶形态下 loaded 竟没被置真,说明变异没生效')
  assert.throws(
    () => assert.equal(ctx.page.data.loaded, false, '失败不得置 loaded'),
    assert.AssertionError,
  )
})

test('negative control: 拿掉计数行的 wx:if 与空态的 wx:elif 各自判红', () => {
  const js = read(ALBUM_JS)
  const wxml = read(ALBUM_WXML)

  const noGate = wxml.replace('<view class="al-hd" wx:if="{{loaded}}">', '<view class="al-hd">')
  assert.notEqual(noGate, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertAlbumStates(js, noGate), assert.AssertionError)

  const looseEmpty = wxml.replace('wx:elif="{{loaded && total === 0}}"', 'wx:if="{{loaded && total === 0}}"')
  assert.notEqual(looseEmpty, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertAlbumStates(js, looseEmpty), assert.AssertionError)
})

// ================================================================ C06-2 会话页
function assertChatStates(js, wxml) {
  // 四态各有专属分支,且互斥
  assert.match(wxml, /<cy-skeleton[^>]*wx:if="\{\{loadState === 'loading'\}\}"/, '加载态必须是骨架,不是「还没有消息」')
  assert.match(wxml, /<cy-empty[^>]*wx:elif="\{\{loadState === 'missing'\}\}"[^>]*kind="missing-param"/, '缺参必须走 missing-param 态')
  assert.match(wxml, /<cy-error[^>]*wx:elif="\{\{loadState === 'error'\}\}"[^>]*bind:retry="retryLoad"/, '失败必须走 cy-error 并给重试')
  assert.match(wxml, /<cy-empty[^>]*wx:elif="\{\{!msgs\.length\}\}"[^>]*kind="empty"[^>]*title="还没有消息"/, '真空态保留原文案并显式声明 kind')

  // 非 ready 时输入栏必须禁用:不能邀请用户做一件一定会失败的事
  const input = wxml.match(/<input class="inp"[\s\S]*?\/>/)
  assert.ok(input, '输入框必须存在')
  assert.match(input[0], /disabled="\{\{disabled \|\| loadState !== 'ready'\}\}"/, '非 ready 态输入栏必须禁用:' + input[0])
  assert.match(js, /loadState !== 'ready'/, 'onSend 必须在非 ready 态短路')

  // 页面身份:名字为空时给按会话类型的兜底,不留无名头像
  assert.match(wxml, /class="hero-name">\{\{heroName\}\}/, 'hero 名字必须用带兜底的 heroName')
  assert.match(js, /heroName/, 'js 必须计算 heroName')
}

test('C06-2 会话页:四态分流 + 非 ready 禁输入 + 会话有身份', () => {
  assertChatStates(read(CHAT_JS), read(CHAT_WXML))
})

test('C06-2 行为:缺参零请求落 missing;fail/非200 落 error;正常落 ready', () => {
  // ① 缺 conversationId ⇒ 不发请求(坏链接不该打后端),落 missing
  let ctx = loadPage(CHAT_JS)
  ctx.page.onLoad({})
  assert.equal(ctx.page.data.loadState, 'missing', '缺 conversationId 必须落 missing')
  assert.equal(ctx.requests.length, 0, '缺参不得发请求')

  // ② 网络 fail ⇒ error
  ctx = loadPage(CHAT_JS)
  ctx.page.onLoad({ conversationId: '11' })
  assert.equal(ctx.requests.length, 1)
  ctx.requests[0].fail()
  assert.equal(ctx.page.data.loadState, 'error', 'fail 必须落 error')

  // ③ 业务失败 ⇒ error
  ctx = loadPage(CHAT_JS)
  ctx.page.onLoad({ conversationId: '11' })
  ctx.requests[0].success({ code: 500, msg: '炸了' })
  assert.equal(ctx.page.data.loadState, 'error', '非 200 必须落 error')

  // ④ 成功 ⇒ ready(零条也是 ready,空态由 msgs.length 决定)
  ctx = loadPage(CHAT_JS)
  ctx.page.onLoad({ conversationId: '11' })
  ctx.requests[0].success({ code: 200, data: { list: [], hasMore: false } })
  assert.equal(ctx.page.data.loadState, 'ready', '成功必须落 ready')
})

// 「坏链接不打后端」如果只在 onLoad 成立,onShow 一来轮询就又破了 —— 这条量的是整条链路。
test('C06-2 行为:缺参态连轮询也不打后端', () => {
  const ctx = loadPage(CHAT_JS)
  ctx.page.onLoad({})
  ctx.page.onShow()
  assert.equal(ctx.requests.length, 0, '缺 conversationId 时 onShow 的轮询也不得发请求')

  // 正常会话必须照旧轮询(证明上面不是把轮询整个关掉换来的)
  const healthy = loadPage(CHAT_JS)
  healthy.page.onLoad({ conversationId: '11' })
  healthy.page.onShow()
  assert.ok(healthy.page._poll, '正常会话的轮询不能被顺手关掉')
  healthy.page.onUnload()
})

test('negative control: 轮询不看 conversationId ⇒ 坏链接每 8s 拿 0 打后端', () => {
  const ctx = loadPage(CHAT_JS, null, (src) => src.replace(
    '    if (!this.data.conversationId) return;\n',
    '',
  ))
  ctx.page.onLoad({})
  ctx.page.onShow()
  assert.ok(ctx.page._poll, '变异没生效(轮询没被启动)')
  ctx.page.pollNew()
  assert.equal(ctx.requests[0].data.conversation_id, 0, '病灶形态就是拿 0 去打后端')
  ctx.page.onUnload()
  assert.throws(
    () => assert.equal(ctx.requests.length, 0, '缺参时轮询也不得发请求'),
    assert.AssertionError,
  )
})

// 一次瞬时失败之后:轮询读到消息就是恢复了,错误卡不能钉在实时消息上方、输入栏不能一直死。
test('C06-2 行为:轮询读到消息即自动解除 error(输入栏不会被永久禁死)', () => {
  const ctx = loadPage(CHAT_JS)
  ctx.page.onLoad({ conversationId: '11' })
  ctx.requests[0].fail()
  assert.equal(ctx.page.data.loadState, 'error')
  ctx.page.pollNew()
  ctx.requests[1].success({ code: 200, data: { list: [{ id: 9, msgType: 1, content: 'hi', senderId: 3 }] } })
  assert.equal(ctx.page.data.loadState, 'ready', '轮询恢复后必须解掉 error,否则输入栏永久禁用')
})

test('negative control: 轮询不解 error ⇒ 消息在流里、输入栏还是死的', () => {
  const ctx = loadPage(CHAT_JS, null, (src) => src.replace(
    "        if (that.data.loadState !== 'ready') that.setData({ loadState: 'ready' });\n",
    '',
  ))
  ctx.page.onLoad({ conversationId: '11' })
  ctx.requests[0].fail()
  ctx.page.pollNew()
  ctx.requests[1].success({ code: 200, data: { list: [{ id: 9, msgType: 1, content: 'hi', senderId: 3 }] } })
  assert.equal(ctx.page.data.msgs.length, 1, '变异没生效(消息没进来)')
  assert.throws(
    () => assert.equal(ctx.page.data.loadState, 'ready', '轮询恢复后必须解掉 error'),
    assert.AssertionError,
  )
})

// 闸要守在每个真发 /api/im/send 的出口上:只挡输入框等于没挡住图片/位置/路线三条路。
test('C06-2 行为:非 ready 态所有发送出口都不发请求', () => {
  const ctx = loadPage(CHAT_JS, null)
  ctx.page.onLoad({})
  ctx.page.onPickImage()
  ctx.page.sendCard({ cardType: 'route', topicId: 7 })
  ctx.page.setData({ text: '在吗' })
  ctx.page.onSend()
  assert.equal(ctx.requests.length, 0, '缺参态下图片/卡片/文字三条出口都不许发送')
})

test('negative control: 共享发送出口不设闸 ⇒ 卡片照旧发出去', () => {
  const ctx = loadPage(CHAT_JS, null, (src) => src.replace(
    '    if (!this._canSend() || this._disposed) return;',
    '    if (this._disposed) return;',
  ))
  ctx.page.onLoad({})
  ctx.page.sendCard({ cardType: 'route', topicId: 7 })
  assert.equal(ctx.requests.length, 1, '变异没生效')
  assert.equal(ctx.requests[0].data.conversation_id, 0)
  assert.throws(
    () => assert.equal(ctx.requests.length, 0, '缺参态下所有发送出口都不许发请求'),
    assert.AssertionError,
  )
})

// CU-M-125 系统通知详情:走查实测在这里输入并发送 ⇒ 只生成一条失败气泡、重试仍失败、
// 本地库里没有对应消息(这个会话没有收件人)。所以它不是"能发但没发出去",而是整条
// 输入区在这个会话里都是必然失败的入口 ⇒ 按只读渲染,并且闸要守在真发请求的那一处。
const sentReqs = (ctx) => ctx.requests.filter((r) => r.url === '/api/im/send')

function openSystemNoticeChat(transform) {
  const ctx = loadPage(CHAT_JS, null, transform)
  ctx.page.onLoad({ conversationId: '26', type: '2' })
  ctx.requests[0].success({ code: 200, data: { list: [{ id: 5, msgType: 1, content: '报名已确认', senderId: 0 }], hasMore: false } })
  assert.equal(ctx.page.data.loadState, 'ready', '夹具没搭好:系统通知的会话列表本身是拉得到的')
  return ctx
}

test('CU-M-125 行为:系统通知会话按只读渲染,文字/图片/卡片三条出口都不发请求', () => {
  const ctx = openSystemNoticeChat()
  assert.equal(ctx.page.data.disabled, true, '系统通知必须置只读')
  assert.match(ctx.page.data.disabledText, /系统通知/, '只读必须说出原因,不能只留一条灰掉的输入栏')

  ctx.page.setData({ text: '在吗' })
  ctx.page.onSend()
  ctx.page.onPlus()
  ctx.page.onPickImage()
  ctx.page.sendCard({ cardType: 'route', topicId: 7 })
  assert.deepEqual(sentReqs(ctx), [], '只读会话的文字/附件/卡片出口都不许打 /api/im/send')
})

test('CU-M-125 行为:只读闸不许顺手把普通私信也关掉', () => {
  const ctx = loadPage(CHAT_JS)
  ctx.page.onLoad({ conversationId: '11', type: '1' })
  assert.equal(ctx.page.data.disabled, false, '私信不该被只读闸波及')
  ctx.requests[0].success({ code: 200, data: { list: [], hasMore: false } })
  ctx.page.setData({ text: '在吗' })
  ctx.page.onSend()
  assert.equal(sentReqs(ctx).length, 1, '私信照旧发得出去,证明上面的零请求是闸生效而不是发送整个坏了')
})

test('negative control CU-M-125: 去掉按会话类型的只读判定 / 发送闸不看只读,各自照样发出失败请求', () => {
  // M125 的 disabled 与 C120 的 readOnly 共同保护系统通知,回到病灶需同时撤掉两处类型判定。
  const noReadOnly = openSystemNoticeChat((src) => src.replace(
    "    if (type == 2) this.setData({ disabled: true, disabledText: '系统通知不支持回复，有新动态会出现在这里' });\n",
    '',
  ).replace('const readOnly = type === 2;', 'const readOnly = false;'))
  assert.equal(noReadOnly.page.data.disabled, false)
  assert.equal(noReadOnly.page.data.readOnly, false)
  noReadOnly.page.setData({ text: '在吗' })
  noReadOnly.page.onSend()
  assert.equal(sentReqs(noReadOnly).length, 1, '病灶形态就是照旧把消息发给一个没有收件人的会话')
  assert.throws(
    () => assert.deepEqual(sentReqs(noReadOnly), [], '系统通知会话不得发发送请求'),
    assert.AssertionError,
  )

  const gateIgnoresReadOnly = openSystemNoticeChat((src) => src.replace(
    "  _canSend() { return this.data.loadState === 'ready' && !this.data.disabled && !this.data.readOnly; },",
    "  _canSend() { return this.data.loadState === 'ready'; },",
  ))
  assert.equal(gateIgnoresReadOnly.page.data.disabled, true, '变异没生效:只读判定本身被改掉了')
  gateIgnoresReadOnly.page.sendCard({ cardType: 'route', topicId: 7 })
  assert.equal(sentReqs(gateIgnoresReadOnly).length, 1, '病灶形态:亮了只读样式,卡片还是发得出去')
  assert.throws(
    () => assert.deepEqual(sentReqs(gateIgnoresReadOnly), [], '发送闸必须同时看 disabled'),
    assert.AssertionError,
  )
})

test('C06-2 行为:名字缺失时按会话类型兜底,不留无名会话', () => {
  const dm = loadPage(CHAT_JS)
  dm.page.onLoad({ conversationId: '11' })
  assert.equal(dm.page.data.heroName, '对话')

  const sys = loadPage(CHAT_JS)
  sys.page.onLoad({ conversationId: '11', type: '2' })
  assert.equal(sys.page.data.heroName, '系统通知')

  const named = loadPage(CHAT_JS)
  named.page.onLoad({ conversationId: '11', name: encodeURIComponent('阿岚') })
  assert.equal(named.page.data.heroName, '阿岚', '有真名时不得被兜底顶掉')
  assert.equal(named.page.data.name, '阿岚', '气泡上的发送人名仍取真名,不能被兜底串污染')
})

test('negative control: 去掉缺参短路 ⇒ 坏链接照样打后端且被说成空对话', () => {
  const ctx = loadPage(CHAT_JS, null, (src) => src.replace(
    "    if (!conversationId) { this.setData({ loadState: 'missing' }); return; }\n",
    '',
  ))
  ctx.page.onLoad({})
  assert.equal(ctx.requests.length, 1, '病灶形态下应当照旧发请求,否则变异没生效')
  assert.notEqual(ctx.page.data.loadState, 'missing')
  assert.throws(
    () => assert.equal(ctx.page.data.loadState, 'missing', '缺 conversationId 必须落 missing'),
    assert.AssertionError,
  )
})

test('negative control: 去掉 fail 分支 ⇒ 网络失败停在 loading,永远不承认异常', () => {
  const ctx = loadPage(CHAT_JS, null, (src) => src.replace(
    "      fail(res) {\n        if (requestEpoch !== that._messageRequestEpoch) return;\n        that._setMessageLoadError(res);\n      },\n",
    '',
  ))
  ctx.page.onLoad({ conversationId: '11' })
  // 病灶形态下请求根本没挂 fail 钩子 ⇒ 真实请求失败时无人接住,页面永远停在 loading。
  assert.equal(typeof ctx.requests[0].fail, 'undefined', '变异没生效(fail 钩子还在)')
  if (typeof ctx.requests[0].fail === 'function') ctx.requests[0].fail()
  assert.throws(
    () => assert.equal(ctx.page.data.loadState, 'error', 'fail 必须落 error'),
    assert.AssertionError,
  )
  // 而正确形态下同一条断言是能过的 —— 证明这条负控量的是源码而不是运气。
  const healthy = loadPage(CHAT_JS)
  healthy.page.onLoad({ conversationId: '11' })
  healthy.requests[0].fail()
  assert.equal(healthy.page.data.loadState, 'error')
})

test('negative control: 输入栏解禁 / 名字退回裸 name,各自判红', () => {
  const js = read(CHAT_JS)
  const wxml = read(CHAT_WXML)

  const openInput = wxml.replace(`disabled="{{disabled || loadState !== 'ready'}}"`, 'disabled="{{disabled}}"')
  assert.notEqual(openInput, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatStates(js, openInput), assert.AssertionError)

  const bareName = wxml.replace('class="hero-name">{{heroName}}', 'class="hero-name">{{name}}')
  assert.notEqual(bareName, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatStates(js, bareName), assert.AssertionError)
})

// ================================================================ C06-3 漫游历史
// 判据是「整页只有一个出口触点」,不是「存在一个返回钮」(后者在多出一个 ✕ 时同样为真)。
function assertSingleExit(wxml, wxss, sceneWxml) {
  // 2026-08-04 收口:手写的 .hs-back 换成 cy-nav-bar plain + cy-page-title,返回由 bind:back 接。
  // 判据不变(整页只有一个出口触点),只是把「触点长什么样」放宽成两种合法写法之一。
  const backTaps = wxml.match(/bindtap="goBack"|bind:back="goBack"/g) || []
  assert.equal(backTaps.length, 1, `漫游历史的出口只能有一个,现有 ${backTaps.length} 个(裸 ‹ 与圆底 ✕ 动作完全相同)`)
  assert.doesNotMatch(wxml, /class="hs-x"/, '圆底 ✕ 是弹层语义,不能当页面出口')
  assert.equal(rule(wxss, '.hs-x'), null, '.hs-x 的圆底样式也必须一并清掉,否则下次有人把它挂回去')
  assert.match(sceneWxml, /<cy-empty[^>]*kind="empty"/, '空态必须随正文组件显式声明四态族,否则没有插画(LEGACY_DEFAULT)')
}

test('C06-3 漫游历史:唯一出口 + 空态显式声明', () => {
  assertSingleExit(read(HISTORY_WXML), read(HISTORY_WXSS), read(HISTORY_SCENE_WXML))
})

test('negative control: 把圆底 ✕ 加回去必须判红', () => {
  const wxml = read(HISTORY_WXML)
  const wxss = read(HISTORY_WXSS)
  const mutated = wxml.replace(
    '<cy-scene-roam-history',
    '<view class="hs-x" bindtap="goBack" aria-label="关闭漫游历史">✕</view>\n    <cy-scene-roam-history',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSingleExit(mutated, wxss, read(HISTORY_SCENE_WXML)), assert.AssertionError)
})

// ================================================================ C06-4 单次漫游回看
// 页面身份必须两个状态分支都在场 —— 判据是「标题节点排在条件分支之前」,
// 不是「页面里存在一个标题」(后者在标题被塞进 wx:else 时同样为真,而错误态恰恰是它缺失的那一态)。
function assertSessionIdentity(wxml, wxss, sceneWxml) {
  const title = wxml.match(/<cy-page-title[^>]*>/)
  assert.ok(title, '必须有页面身份大标题')
  assert.match(title[0], /title="本次漫游"/, '页面身份文案必须稳定:' + title[0])
  assert.ok(
    wxml.indexOf('<cy-page-title') < wxml.indexOf('<cy-scene-roam-session'),
    '大标题必须排在正文组件之前,让组件内错误/正常两态共享页面身份',
  )
  const identities = wxml.match(/class="ss-name"/g) || []
  assert.deepEqual(identities, [], '正文中段不得再留一处身份文案(双标题)')

  // 页面退为深链壳后，出口归共享 nav-bar；正文组件不再自画页面 chrome。
  assert.match(wxml, /<cy-nav-bar[^>]*plain[^>]*custom-back[^>]*bind:back="goBack"/, '深链壳必须使用共享裸返回导航')
  assert.doesNotMatch(wxml, /class="ss-x"/, '页面不得留第二个自绘返回触点')
  assert.equal(rule(wxss, '.ss-x'), null, '自绘返回样式也必须随壳化删除')
  assert.match(sceneWxml, /wx:elif="\{\{state === 'error'\}\}"/)
  assert.match(sceneWxml, /wx:elif="\{\{state === 'empty'\}\}"/)
}

test('C06-4 单次漫游回看:两态共享页面身份 + 裸 chevron 出口', () => {
  assertSessionIdentity(read(SESSION_WXML), read(SESSION_WXSS), read(SESSION_SCENE_WXML))
})

test('negative control: 标题塞进正常态分支内 / 圆底回潮 / 命中区缩到 64rpx,各自判红', () => {
  const wxml = read(SESSION_WXML)
  const wxss = read(SESSION_WXSS)

  const titleInside = wxml
    .replace(/\n\s*<cy-page-title[^>]*\/>/, '')
    .replace(
      '    <cy-scene-roam-session ts="{{ts}}" bind:back="goBack" bind:close="goBack" bind:share="share" />',
      '    <cy-scene-roam-session ts="{{ts}}" bind:back="goBack" bind:close="goBack" bind:share="share" />\n    <cy-page-title title="本次漫游" safe-top="{{false}}" />',
    )
  assert.notEqual(titleInside, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSessionIdentity(titleInside, wxss, read(SESSION_SCENE_WXML)), assert.AssertionError)

  const pillBack = wxml.replace(
    '<cy-nav-bar plain custom-back bind:back="goBack" />',
    '<view class="ss-x" bindtap="goBack">✕</view>',
  )
  assert.notEqual(pillBack, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSessionIdentity(pillBack, wxss, read(SESSION_SCENE_WXML)), assert.AssertionError)

  const missingBackContract = wxml.replace(' plain custom-back bind:back="goBack"', '')
  assert.notEqual(missingBackContract, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSessionIdentity(missingBackContract, wxss, read(SESSION_SCENE_WXML)), assert.AssertionError)
})

// ================================================================ C06-5 游玩页缺参态
// 「重新加载」在缺参态下物理上回不到别的状态 —— 下面这条不是读代码得出的,是真跑一遍 reloadPlay。
test('C06-5 行为:缺场次参数落 missing,且重试证明无效(故不得给重试按钮)', () => {
  const { page } = loadPage('pages/play/index.js')
  page.data.activityId = ''
  page.data.topicId = ''
  page.loadData(true)
  assert.equal(page.data.emptyKind, 'missing', '缺参不是「加载失败」,它是另一种状态')
  assert.match(page.data.emptyTip, /场次信息缺失/, '文案不变')

  // 真按一次「重新加载」会发生什么:回到同一个状态。这就是它是假按钮的证据。
  page.reloadPlay()
  assert.equal(page.data.emptyKind, 'missing', 'reloadPlay 回到同一状态 ⇒ 重试对缺参无效')

  const wxml = read(PLAY_WXML)
  const missingBranch = wxml.match(/wx:elif="\{\{emptyKind=='missing'\}\}"[\s\S]*?<\/view>/)
  assert.ok(missingBranch, 'wxml 必须有独立的缺参分支')
  assert.doesNotMatch(missingBranch[0], /reloadPlay/, '缺参分支不得渲染重试(物理上走不通的按钮)')
  assert.match(missingBranch[0], /goBackDetail/, '缺参态必须给一个真的走得通的出口')
})

test('negative control: 把缺参改回 emptyKind:error ⇒ 缺参又被渲染成可重试的加载失败', () => {
  const { page } = loadPage('pages/play/index.js', null, (src) => src.replace(
    "emptyTip: '场次信息缺失，请从票夹或路线详情进入', emptyKind: 'missing'",
    "emptyTip: '场次信息缺失，请从票夹或路线详情进入', emptyKind: 'error'",
  ))
  page.data.activityId = ''
  page.data.topicId = ''
  page.loadData(true)
  assert.equal(page.data.emptyKind, 'error', '病灶形态下应落 error,否则变异没生效')
  assert.throws(
    () => assert.equal(page.data.emptyKind, 'missing', '缺参不是「加载失败」'),
    assert.AssertionError,
  )
})

// ================================================================ C06-6 集邮相机
// 2026-09-11 用户裁决「不是 canon 了 用原型的」:拟物机身退场,快门是原型那枚**看得见**的白圆,
// 不再是盖在圆盘上的透明热区 ⇒ 「按哪里拍」不必再靠文字说。
// 这条改成守另外那半:提示条还在,而且仍然告诉用户这一屏能双指缩放裁切 —— 那件事光看是看不出来的。
function assertShutterDiscoverable(wxml) {
  const hint = wxml.match(/<view class="sc-hint"[\s\S]*?<\/view>/)
  assert.ok(hint, 'sc-hint 提示必须存在')
  assert.match(hint[0], /\{\{cropScaleLabel\}\}/, '缩放倍率必须留着:双指裁切是看不出来的操作')
  assert.match(hint[0], /缩放|裁切/, '提示必须说清这一屏能做什么:' + hint[0])
  // 快门本身要可见 —— 不可见就又回到「主动作靠猜」那个病灶
  assert.match(wxml, /class="sc-shutter"[\s\S]{0,300}?bindtap="onShutter"/, '快门必须是看得见且可点的那一枚')
  assert.doesNotMatch(wxml, /sc-shutter-hit/, '不许退回透明热区')
}

test('C06-6 集邮相机:快门看得见,缩放裁切有文字说明', () => {
  assertShutterDiscoverable(read(CAMERA_WXML))
})

test('negative control: 快门退回透明热区、或提示丢掉缩放倍率,都必须判红', () => {
  const wxml = read(CAMERA_WXML)
  const backToHit = wxml.replace('class="sc-shutter"', 'class="sc-shutter-hit"')
  assert.notEqual(backToHit, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertShutterDiscoverable(backToHit), assert.AssertionError)

  const noScale = wxml.replace(/<text>[^<]*\{\{cropScaleLabel\}\}<\/text>/, '<text>对准了就按</text>')
  assert.notEqual(noScale, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertShutterDiscoverable(noScale), assert.AssertionError)
})

// ================================================================ C06-7 游玩页黑屏无出口(2026-09-16 截图冒烟)
// 现象:带真实参数打开 /pages/play/index,整屏纯黑,既没有加载骨架也没有任何提示与出路。
// 根因面:① 地图是原生层,加载/空态/失败态时它还在场,提示被压住(仓库 2026-08-04 已实测过普通
//          view 盖不住 <map>);② 首屏成功态的 screen='intro' 原来只在 setData 回调末尾落地,
//          回调里任一处理(rebuild / 会话时钟 / 角色卡)抛错都会把页面永久留在「无 screen、无提示」
//          的纯黑地图态。两条都按「任何失败都有明确提示与出路」修掉。
function assertNoMainMapLayer(wxml) {
  // 2026-09-22 用户裁决「不要了」:主地图整层删除,根因①(原生层压住提示)不复存在。
  // 这条改成钉死「主地图不许回潮」——回潮就等于把那块会压住提示与出路的原生层又请回来。
  assert.doesNotMatch(wxml, /<view class="stage"/, '地图舞台已删,不得回潮')
  const maps = wxml.match(/<free-map\b[^>]*/g) || []
  assert.equal(maps.length, 1, '页面只允许保留完成页回放那一张地图:' + maps.join(' | '))
  assert.match(maps[0], /class="finsheet__map-native"/, '唯一保留的地图必须是完成页路径回放')
}

test('C06-7 游玩页:主地图整层已删,提示与出路是屏幕上唯一的东西', () => {
  assertNoMainMapLayer(read(PLAY_WXML))
})

test('negative control: 把主地图挂回页面 ⇒ 上面这条必须判红', () => {
  const source = read(PLAY_WXML)
  const anchor = '<!-- ===================== 已删除的层:别回潮 ====================='
  const broken = source.replace(anchor,
    '<view class="stage"><free-map wx:if="{{!showJournal}}" id="fmMap"></free-map></view>\n' + anchor)
  assert.notEqual(broken, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertNoMainMapLayer(broken), assert.AssertionError)
})

/** 真跑一次首屏成功:载荷是最小可用路线数据(一个已发布节点)。 */
async function loadPlayWithSuccessPayload(transform) {
  const { page, requests } = loadPage('pages/play/index.js', null, transform)
  page.data.topicId = '10'
  page.loadData(true)
  assert.equal(requests.length, 1, 'loadData 必须发出 /api/play/nodes')
  requests[0].success({
    code: 200,
    data: { registered: true, mode: 1, topicId: 10, topicName: '测试路线', nodes: [{ id: 1, name: '第一站', lat: 31.23, lng: 121.47 }] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  return page
}

test('C06-7 首屏成功态与数据同一次 setData 落地:回调中途抛错也不留在无 screen 的纯黑态', async () => {
  const page = await loadPlayWithSuccessPayload((src) => src.replace(
    'that._loadPlayerGameModule();',
    "that._loadPlayerGameModule(); throw new Error('回调中途抛错');",
  ))
  assert.equal(page.data.loading, false)
  assert.equal(page.data.emptyTip, '', '成功态不该有提示文案')
  // 起始页删除后首屏直接落卡包:screen='' 正是主内容块(wx:if="{{!screen && ...}}")的渲染条件。
  assert.equal(page.data.screen, '', '首屏必须落在卡包态,回调抛错也不能被推去别的屏')
})

test('预制人生稳定 topicId 直接换轨到独立游戏页，不渲染通用 intro', async () => {
  const { page, requests, routes } = loadPage('pages/play/index.js')
  page.data.topicId = '990059'
  page._entryTopicName = '普通主题名'
  page.loadData(true)
  requests[0].success({
    code: 200,
    data: { registered: true, mode: 1, topicId: 990059, nodes: [{ id: 1, name: '第一站', lat: 31.23, lng: 121.47 }] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(routes, ['/subpackagePrefab/index?topicId=990059'])
})

test('negative control: screen 改回只在回调末尾落地 ⇒ 回调抛错后页面真的回不到 intro', async () => {
  const page = await loadPlayWithSuccessPayload((src) => src
    .replace("screen: first ? 'intro' : that.data.screen", 'screen: that.data.screen')
    .replace(
      'that._loadPlayerGameModule();',
      "that._loadPlayerGameModule(); if (first) that.setData({ screen: 'intro' }); throw new Error('回调中途抛错');",
    ))
  assert.equal(page.data.loading, false, '载荷本身必须能走到成功分支,否则负控与正控都恒真')
  assert.notEqual(page.data.screen, 'intro', '病灶形态(回调抛错)必须真回不到 intro,否则上一条断言恒真')
})

// CU-M-124 通用卡片:报名没挂主题时系统下发的是一张没有 action 的「报名成功」卡,
// 页面过去对所有通用卡一律写 interactive="{{true}}" ⇒ 读屏报 aria-role=button「查看卡片详情」,
// 实点哪也不去(onCardTap 只认 action / 系统 result / bcId)。可点性必须按卡真有的动作给。
function decorateCard(extraJson, overrides, transform) {
  const ctx = loadPage(CHAT_JS, null, transform)
  ctx.page.data.name = '系统通知'
  return ctx.page.decorate([Object.assign(
    { id: 61, senderId: 0, msgType: 3, content: '报名成功', extraJson: extraJson },
    overrides || {},
  )])[0]
}

function assertGenericCardAffordance(wxml) {
  const card = wxml.match(/<cy-card wx:elif="\{\{item\.msgType == 3\}\}"[^>]*>/)
  assert.ok(card, '通用卡片节点必须存在')
  assert.match(card[0], /interactive="\{\{item\.cardTarget\}\}"/,
    '通用卡的可点性必须由 decorate 算出的 cardTarget 决定:' + card[0])
  assert.match(card[0], /hover-class="\{\{item\.cardTarget \? 'cy-pressed' : 'none'\}\}"/,
    '没有去处的卡不得给按压反馈,否则看起来仍可点:' + card[0])
}

test('CU-M-124 行为:通用卡按真有的动作决定可点性,无去向的通知不再冒充按钮', () => {
  assert.equal(decorateCard('{"title":"报名成功","sub":"你的报名已提交"}').cardTarget, false,
    '没有 action / 结果 / 回流的通用卡必须报成不可点')
  assert.equal(decorateCard('{"title":"路线","action":"/subpackageRoam/detail/index?topicId=7"}').cardTarget, true,
    '带 action 的卡照旧可点,收口不许把所有卡片一起做成死的')
  assert.equal(decorateCard('{"title":"公告","bcId":9}').cardTarget, true,
    '官方通知卡点开要打回流,不能因为没 action 就判成不可点')
  assert.equal(decorateCard('{"title":"举报结果","result":{"taskId":40}}').cardTarget, true,
    '系统发的结果卡可回查')
  assert.equal(decorateCard('{"title":"结果","result":{"taskId":40}}', { senderId: 8 }).cardTarget, false,
    'result 只有系统消息(senderId=0)才回查得到,普通发卡不得据此报成可点')

  assertGenericCardAffordance(read(CHAT_WXML))
})

test('negative control CU-M-124: 退回「一律可点」或漏掉 bcId/result,各自判红', () => {
  // ① 渲染层退回硬编码 interactive ⇒ 死点击复活
  assert.throws(
    () => assertGenericCardAffordance(read(CHAT_WXML).replace(
      'interactive="{{item.cardTarget}}"', 'interactive="{{true}}"',
    )),
    assert.AssertionError,
    '把可点性写回 true 时本节必须判红,否则上一条断言恒真',
  )
  // ② 判定漏掉 bcId ⇒ 公告卡的 cardTarget 变 false,正控里的真值断言不是白拿的
  const dropBcId = decorateCard('{"title":"公告","bcId":9}', null, (src) => src.replace(
    "          || (card.result && m.senderId == 0) || card.bcId));",
    '          || (card.result && m.senderId == 0)));',
  ))
  assert.equal(dropBcId.cardTarget, false, '病灶形态:漏判 bcId 后官方通知又变成不可点,回流入口消失')
  assert.throws(
    () => assert.equal(dropBcId.cardTarget, true, '官方通知卡必须可点'),
    assert.AssertionError,
  )
})
