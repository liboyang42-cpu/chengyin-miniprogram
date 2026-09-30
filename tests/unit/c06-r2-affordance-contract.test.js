// C06 第 2 轮:可供性(affordance)契约 —— 「看起来能做的」必须等于「真的能做的」。
//
// 五条全部来自 2026-07-30 的真实复采(端口 9685,零注入,10/10 出图),逐张打开后判定,
// 证据目录 ~/Desktop/城瘾_UI_第1轮_C06_真实复拍_20260730_9685/:
//  R2-1 040 据点核销码:缺参态被交给 cy-qr-voucher,组件内硬编码「点此重试」——参数不会因为
//       重试而出现,这是假按钮;且组件内四个定位角写了非法的 -var() 偏移,坍缩到占位框中央
//       压住错误文案(真图上「参数缺失」/紫方块/「点此重试」三层相撞)。组件是禁区 ⇒
//       页面改为**根本不进入那个分支**:缺参自己渲染,零重试。
//  R2-2 037 探索护照:读取失败用 cy-empty(无数据语义)呈现 = 把「读失败」说成「你没有数据」;
//       页面出口是圆底 × chip(圆底属 sheet/modal 语义,两份本地参考里圆底 × 全在半屏上)。
//  R2-3 056 集邮相机:快门是盖在拟物圆盘上的**全透明**热区,整屏没有任何可见控件 ⇒ 主动作靠猜。
//  R2-4 057 集邮册:「重新载入」呈淡底深字,在浅纸底上视觉近似禁用(别名 token 被暗色主题
//       就地解析后继承进组件所致)。参考一致结论:可点 = 实心高对比填充。
//  R2-5 060 会话页:缺参态输入栏整条照常亮着(placeholder「发消息...」+ 未变暗的发送钮),
//       解释行只看 disabled 不看 loadState ⇒ 用户看不到原因,视觉构成「可发送」暗示。
//       行为层其实已闸死 ⇒ 本轮补的是可供性那一半。
//
// 每条都配**真改源码守卫**的负控:把守卫改回病灶形态,检查器必须判红(证明不是恒真断言)。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const CODE_JS = 'subpackageRoam/citynode-code/index.js'
const CODE_WXML = 'subpackageRoam/citynode-code/index.wxml'
const CAMERA_WXML = 'subpackageP3/pages/stamp-camera/index/index.wxml'
const CAMERA_WXSS = 'subpackageP3/pages/stamp-camera/index/index.wxss'
const ALBUM_WXSS = 'subpackageP3/pages/stamp-album/index/index.wxss'
const CHAT_WXML = 'subpackageB/pages/im/chat/index.wxml'
const CHAT_WXSS = 'subpackageB/pages/im/chat/index.wxss'

// ---------------------------------------------------------------- 页面沙箱
// 与 c06-state-and-exit-contract.test.js 同构:从**源码字符串**装载,负控才能把真源码
// 改回病灶形态后真跑一遍(拿手搭假对象证不到源码那一侧)。
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
  const routes = []
  global.getApp = () => ({
    globalData: { user_id: 9, statusBarHeight: 20, navBarHeight: 44, features: {} },
    isDevEnv: () => false,
    getUserID: () => 9,
    sendRequest: (options) => { requests.push(options) },
  })
  global.getCurrentPages = () => [{}, {}]
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 300 }),
    showLoading() {}, hideLoading() {}, showToast() {},
    navigateTo({ url }) { routes.push(url) },
    navigateBack() { routes.push('back') },
    switchTab({ url }) { routes.push(url) },
    reLaunch({ url }) { routes.push(url) },
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
  return { page, requests, routes }
}

// 取某个选择器的声明块。注意:块内不得出现 `}`(含注释里的 `page{}`),否则截断。
function rule(wxss, selector) {
  const m = wxss.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
  return m ? m[1] : null
}

// ======================================================== R2-1 据点核销码:缺参零重试
// 判据不是「有个缺参分支」,而是「缺参分支里一个重试字样都不能有,且不把 state 交给
// cy-qr-voucher」—— 后者组件内硬编码重试,交过去就等于又长出一个假按钮。
function assertCodeMissingState(wxml) {
  const missing = wxml.match(/<view wx:if="\{\{state === 'missing'\}\}"[\s\S]*?<\/view>/)
  assert.ok(missing, '缺参必须有页面自渲染的 missing 分支(不能把缺参交给 cy-qr-voucher)')

  // ① 真插画 + 真实原因 + 唯一真出口
  assert.match(missing[0], /kind="missing-param"/, 'missing 态要用四态族的 missing-param(自带既有插画,不臆造资源)')
  assert.match(missing[0], /cta="返回"[\s\S]*?bind:cta="onMissingBack"/, 'missing 态必须给一个真的走得通的出口')

  // ② 零重试:缺参重试永远回到同一状态
  assert.doesNotMatch(missing[0], /重试|重新载入|重新加载/, 'missing 分支不得出现任何重试字样(参数不会因重试而出现)')

  // ③ cy-qr-voucher 必须挂 wx:else,缺参时物理不渲染 ⇒ 组件内那个假重试与坍缩紫角都进不来
  assert.match(wxml, /<cy-qr-voucher\s*\n?\s*wx:else/, 'cy-qr-voucher 必须挂 wx:else,使缺参态不渲染它')
}

test('R2-1 静态:缺参态自渲染、零重试、不落到 cy-qr-voucher', () => {
  assertCodeMissingState(read(CODE_WXML))
})

test('R2-1 行为:无 poiId ⇒ state=missing 且零请求;有 poiId ⇒ 照常出码', () => {
  const noParam = loadPage(CODE_JS)
  noParam.page.onLoad({})
  assert.equal(noParam.page.data.state, 'missing', '缺参必须落 missing,不能混进 error')
  assert.equal(noParam.requests.length, 0, '缺参不该打后端')

  const withParam = loadPage(CODE_JS)
  withParam.page.onLoad({ poiId: '77' })
  assert.equal(withParam.page.data.state, 'loading')
  assert.equal(withParam.requests.length, 1, '有参数时必须真的去出码(别把正常流程一起挡掉)')
  assert.match(withParam.requests[0].url, /\/api\/verify\/citynode\/issue/)
})

test('R2-1 行为:missing 出口真的能走(有上一页回退,无上一页回 roam)', () => {
  const back = loadPage(CODE_JS)
  back.page.onMissingBack()
  assert.deepEqual(back.routes, ['back'])
})

test('negative control R2-1: 缺参退回 error ⇒ 假重试复活,静态与行为同时判红', () => {
  // 行为侧:改回病灶形态后 state 不再是 missing
  const ctx = loadPage(CODE_JS, (src) => src.replace(
    "      this.setData({ state: 'missing' });",
    "      this.setData({ state: 'error', errMsg: '参数缺失' });",
  ))
  ctx.page.onLoad({})
  assert.equal(ctx.page.data.state, 'error', '变异没生效')
  assert.throws(
    () => assert.equal(ctx.page.data.state, 'missing'),
    assert.AssertionError,
  )
  // 而正确形态下同一条断言能过 ⇒ 这条负控量的是源码不是运气
  const healthy = loadPage(CODE_JS)
  healthy.page.onLoad({})
  assert.equal(healthy.page.data.state, 'missing')

  // 静态侧:把 wx:else 摘掉(缺参又会同时渲染组件)⇒ 判红
  const wxml = read(CODE_WXML)
  const noElse = wxml.replace('<cy-qr-voucher\n  wx:else', '<cy-qr-voucher')
  assert.notEqual(noElse, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCodeMissingState(noElse), assert.AssertionError)

  // 静态侧:往 missing 分支里塞回一个重试 ⇒ 判红
  const withRetry = wxml.replace('cta="返回"', 'cta="点此重试"')
  assert.notEqual(withRetry, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCodeMissingState(withRetry), assert.AssertionError)
})

// ======================================================== R2-3 集邮相机:主动作可见
// 2026-09-11 用户裁决「不是 canon 了 用原型的」:拟物圆盘退场,快门换成原型 camPanel 那一枚
// 白圆(.sc-shutter)。原来那条「看见的圈」与「点得到的热区」要同坐标的判据,现在由
// **可见元素自己就是命中元素**天然满足 —— 所以判据改成钉死这一点:不许再分成两层。
function assertShutterDiscoverable(wxml, wxss) {
  assert.doesNotMatch(wxml, /sc-shutter-hit|sc-shutter-ring/,
    '快门不许再拆成「透明热区 + 可见环」两层 —— 那正是 R2-3 要治的病')
  const shutter = wxml.match(/class="sc-shutter"[\s\S]*?style="([^"]*)"/)
  assert.ok(shutter, '必须有可见快门')
  assert.match(shutter[1], /left:\{\{shutterL\}\}px;top:\{\{shutterT\}\}px/,
    '快门坐标必须来自 layout.js 的同一组变量,不许写死')
  assert.match(wxml, /class="sc-shutter"[\s\S]{0,300}?bindtap="onShutter"/, '快门本体就是命中元素')

  const r = rule(wxss, '.sc-shutter')
  assert.ok(r, '.sc-shutter 必须有样式规则')
  assert.doesNotMatch(r, /pointer-events:\s*none/, '快门本体不能不吃事件 —— 它就是那个可点的东西')
  assert.match(r, /border:/, '快门必须真有可见描边(原型 4px 半透白)')
  assert.match(r, /background:\s*#FFFFFF/i, '快门是白圆(原型 .cam__shutter)')

  // 环内不叠文字:原型这一枚就是纯白圆,压字会把它变成按钮
  assert.match(wxml, /class="sc-shutter"[^>]*\n?[^>]*><\/view>/, '快门内不得叠加文字节点')
}

test('R2-3 静态:快门本体可见且就是命中元素,坐标取自 layout', () => {
  assertShutterDiscoverable(read(CAMERA_WXML), read(CAMERA_WXSS))
})

test('negative control R2-3: 坐标写死 / 退回两层热区 / 快门内叠字,各自判红', () => {
  const wxml = read(CAMERA_WXML)
  const wxss = read(CAMERA_WXSS)

  const driftCoords = wxml.replace(
    'style="left:{{shutterL}}px;top:{{shutterT}}px;width:{{shutterS}}px;height:{{shutterS}}px;" bindtap="onShutter"',
    'style="left:100px;top:100px;width:80px;height:80px;" bindtap="onShutter"',
  )
  assert.notEqual(driftCoords, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertShutterDiscoverable(driftCoords, wxss), assert.AssertionError)

  const twoLayers = wxml.replace('class="sc-shutter"', 'class="sc-shutter-hit"')
  assert.notEqual(twoLayers, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertShutterDiscoverable(twoLayers, wxss), assert.AssertionError)

  const inert = wxss.replace('.sc-shutter { position: absolute;', '.sc-shutter { pointer-events: none; position: absolute;')
  assert.notEqual(inert, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertShutterDiscoverable(wxml, inert), assert.AssertionError)
})

// ======================================================== R2-4 集邮册:重试看起来可点
// 根因是别名 token:--cy-btn-solid-* 在 page 根规则里就被解析成暗色主题的值(星白底+深墨字)
// 并以计算值继承进 cy-error;子节点挂 .theme-light 只覆盖 --cy-color-*,追不回已解析的别名。
// 组件内选择器被样式隔离挡死 ⇒ 唯一页面内修法是重新声明别名(CSS 变量能穿透隔离)。
function assertAlbumRetryReadsEnabled(wxss) {
  const root = rule(wxss, '.al-root')
  assert.ok(root, '.al-root 必须有规则')
  assert.match(root, /--cy-btn-solid-bg:\s*var\(--cy-color-action-primary-bg\)/,
    '.al-root 必须重新声明 --cy-btn-solid-bg,否则组件内按钮沿用暗色主题的淡底 ⇒ 浅纸底上近似禁用')
  assert.match(root, /--cy-btn-solid-fg:\s*var\(--cy-color-action-primary-fg\)/,
    '.al-root 必须重新声明 --cy-btn-solid-fg,保证字色与新底色配套')
  // 纸感浅色是有意设计,别顺手翻成暗色
  assert.match(wxss, /theme-light|纸感/, '集邮册浅色纸感是有意设计,不应被改掉')
}

test('R2-4 静态:.al-root 重声明 btn-solid 别名,重试呈实心可点', () => {
  assertAlbumRetryReadsEnabled(read(ALBUM_WXSS))
})

test('negative control R2-4: 去掉别名重声明 ⇒ 判红', () => {
  const wxss = read(ALBUM_WXSS)
  const stripped = wxss.replace(/\n\s*--cy-btn-solid-bg: var\(--cy-color-action-primary-bg\);/, '')
  assert.notEqual(stripped, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertAlbumRetryReadsEnabled(stripped), assert.AssertionError)
})

// ======================================================== R2-5 会话页:不暗示可发送
// 行为闸(input disabled + _canSend 守 onSend/sendCard)R1 已正确;本轮量的是**可供性**:
// 一条点不动的输入栏不许看起来像能发消息,且必须说出原因。
function assertChatNoSendableIllusion(wxml, wxss) {
  // ① 输入栏在非 ready 时进入可见禁用态
  assert.match(wxml, /class="input-bar \{\{\(disabled \|\| loadState !== 'ready'\) \? 'input-bar--off' : ''\}\}"/,
    '禁用态(拉黑 / 系统通知)与非 ready 时输入栏都必须带可见禁用态 class')
  const off = rule(wxss, '.input-bar--off')
  assert.ok(off && /opacity/.test(off), '.input-bar--off 必须真有视觉降级(不能只是个空 class)')

  // ② placeholder 不许在不可用时还写「发消息...」
  assert.match(wxml, /placeholder="\{\{disabled \? '不可回复' : loadState === 'ready' \? '发消息\.\.\.' : '会话不可用'\}\}"/,
    '不可用时 placeholder 必须换掉,否则文案本身就在邀请发送')

  // ③ 发送钮高亮必须同时要求 ready(否则打了字就亮起来,像能发)
  assert.match(wxml, /send-circle \{\{text && !disabled && loadState === 'ready' \? 'active' : ''\}\}/,
    "发送钮的 active 必须同时要求 loadState === ready 且未被置只读")

  // ④ 解释行必须覆盖 loadState 两类原因,不能只看拉黑
  assert.match(wxml, /class="disabled-tip"/, '必须有解释行')
  const tip = wxml.match(/<view wx:if="\{\{([^}]*)\}\}" class="disabled-tip"/)
  assert.ok(tip, '解释行必须有条件')
  assert.match(tip[1], /loadState/, '解释行的条件必须看 loadState,否则缺参/失败时用户看不到任何原因')

  // ⑤ 行为闸不许在改可供性时被顺手拆掉(修入口 ≠ 修整条链路)
  assert.match(wxml, /disabled="\{\{disabled \|\| loadState !== 'ready'\}\}"/, '输入框的行为闸必须保留')

  // ⑥ CU-M-125:只读会话(系统通知 / 拉黑)不许留「+」这张必然失败的动作面板入口
  const plus = wxml.match(/<view ([^>]*)class="plus"/)
  assert.ok(plus, '「+」入口必须存在')
  assert.match(plus[1], /wx:if="\{\{!disabled\}\}"/, '只读会话必须收掉「+」,否则点开只能得到失败:' + plus[1])
}

test('R2-5 静态:非 ready 的输入栏可见禁用 + 说明原因 + 行为闸仍在', () => {
  assertChatNoSendableIllusion(read(CHAT_WXML), read(CHAT_WXSS))
})

test('R2-5 数据:每个非 ready 态都有一句真实原因,不留空白解释', () => {
  const ctx = loadPage('subpackageB/pages/im/chat/index.js')
  const map = ctx.page.data.sendBlockedMap
  ;['loading', 'missing', 'error'].forEach((state) => {
    assert.ok(map && map[state] && map[state].length > 0, `${state} 态必须有解释文案,否则解释行渲染成空`)
  })
  // 缺参的那句要真的把出路说清楚
  assert.match(map.missing, /消息列表/, '缺参态要告诉用户回哪里去,不能只说「不可用」')
})

test('negative control R2-5: 解禁视觉 / placeholder 不变 / 解释行只看 disabled,各自判红', () => {
  const wxml = read(CHAT_WXML)
  const wxss = read(CHAT_WXSS)

  const noOff = wxml.replace(
    `class="input-bar {{(disabled || loadState !== 'ready') ? 'input-bar--off' : ''}}"`,
    'class="input-bar"',
  )
  assert.notEqual(noOff, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatNoSendableIllusion(noOff, wxss), assert.AssertionError)

  const oldPlaceholder = wxml.replace(
    `placeholder="{{disabled ? '不可回复' : loadState === 'ready' ? '发消息...' : '会话不可用'}}"`,
    `placeholder="{{loadState === 'ready' ? '发消息...' : '会话不可用'}}"`,
  )
  assert.notEqual(oldPlaceholder, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatNoSendableIllusion(oldPlaceholder, wxss), assert.AssertionError)

  const tipOnlyBlocked = wxml.replace(
    `<view wx:if="{{disabled || loadState !== 'ready'}}" class="disabled-tip"`,
    '<view wx:if="{{disabled}}" class="disabled-tip"',
  )
  assert.notEqual(tipOnlyBlocked, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatNoSendableIllusion(tipOnlyBlocked, wxss), assert.AssertionError)

  const alwaysActive = wxml.replace(
    `send-circle {{text && !disabled && loadState === 'ready' ? 'active' : ''}}`,
    "send-circle {{text ? 'active' : ''}}",
  )
  assert.notEqual(alwaysActive, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatNoSendableIllusion(alwaysActive, wxss), assert.AssertionError)

  // CU-M-125 负控:把「+」放回只读会话 ⇒ 判红
  const plusAlways = wxml.replace('<view wx:if="{{!disabled}}" class="plus"', '<view class="plus"')
  assert.notEqual(plusAlways, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatNoSendableIllusion(plusAlways, wxss), assert.AssertionError)

  // 空的 --off 规则(只有 class 没有视觉)也必须判红
  const emptyOff = wxss.replace('.input-bar--off { opacity: 0.45; }', '.input-bar--off { }')
  assert.notEqual(emptyOff, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertChatNoSendableIllusion(wxml, emptyOff), assert.AssertionError)
})
