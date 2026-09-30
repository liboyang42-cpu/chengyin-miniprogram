// H10:订单详情正文与逻辑已搬到 components/cy/scene-member-order-detail(页面退化成深链薄壳),
// 断言随之指向组件文件;判据本身一条没放宽。
// P2-5:订单详情页 registration/info 失败时必须有可观察的错误态与重试入口。
//
// 病灶:失败分支只弹一个 toast,info 保持为 {},页面继续渲染空白订单卡 +
// 「联系客服」「查看票夹」,用户看不出是加载失败还是订单真的空。
//
// 契约:loadState 四态 loading / ready / failed_business / failed_network,
// 失败态不渲染订单详情与订单动作,展示错误文案 + 重新加载入口;
// 重试沿用原 id,成功后回到 ready。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
// H10:订单详情是组件,入参是 orderId property(会镜像进 data),不再是页面的 onLoad(options)。
const { flattenComponentToPage } = require('../helpers/component-as-page.js')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const ORDERINFO_JS = path.join(ROOT, 'components/cy/scene-member-order-detail/index.js')
const ORDERINFO_WXML = path.join(ROOT, 'components/cy/scene-member-order-detail/index.wxml')
const ORDERINFO_WXSS = path.join(ROOT, 'components/cy/scene-member-order-detail/index.wxss')

let sandbox

beforeEach(() => {
  sandbox = { requests: [], toasts: [], modals: [], payments: [] }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    tips: message => sandbox.toasts.push(message),
    sendRequest: options => { sandbox.requests.push(options) },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback || '未知错误',
  })
  global.Page = config => { sandbox.pageConfig = config }
  // H10 后订单详情是 Component:摊平成 Page 的形状,断言逐字不变。
  global.Component = config => {
    sandbox.componentConfig = config
    sandbox.pageConfig = flattenComponentToPage(config)
  }
  global.wx = {
    showToast: opts => sandbox.toasts.push(opts.title),
    hideLoading() {},
    showLoading() {},
    showModal(options) { sandbox.modals.push(options) },
    requestPayment(options) { sandbox.payments.push(options) },
    navigateTo() {},
    navigateBack() {},
  }
})

function loadPage() {
  delete require.cache[require.resolve(ORDERINFO_JS)]
  require(ORDERINFO_JS)
  const vm = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  vm.data = Object.assign({}, sandbox.pageConfig.data)
  return vm
}

function infoRequests() {
  return sandbox.requests.filter(r => r.url === '/api/registration/info')
}

function changeOrderId(vm, id) {
  vm.data.orderId = id
  const observer = sandbox.componentConfig.observers && sandbox.componentConfig.observers.orderId
  if (observer) observer.call(vm, id)
}

test('F12: attached 后深链参数到达仍加载订单，同值更新不重复请求', () => {
  const vm = loadPage()
  vm.onLoad()
  changeOrderId(vm, '76')
  assert.equal(infoRequests().length, 1)
  assert.equal(String(infoRequests()[0].data.id), '76')
  changeOrderId(vm, '76')
  assert.equal(infoRequests().length, 1)
})

test('F12: 切单清除旧内容，旧单迟到响应不能占据新单加载态', () => {
  const vm = loadPage()
  vm.data.orderId = '76'
  vm.onLoad()
  const old = infoRequests()[0]
  changeOrderId(vm, '77')
  old.success({ code: 200, data: { id: 76, registrationStatus: 2 } })
  assert.deepEqual(vm.data.info, {})
  assert.equal(vm.data.loadState, 'loading')
  assert.equal(infoRequests().length, 2)
  infoRequests()[1].success({ code: 403, msg: '无权查看该订单' })
  assert.equal(vm.data.loadState, 'failed_business')
  assert.match(vm.data.loadErrorText, /无权/)
})

test('F12: 非法或清空参数清除旧单并拒绝发请求', () => {
  const vm = loadPage()
  vm.data.orderId = '76'
  vm.onLoad()
  infoRequests()[0].success({ code: 200, data: { id: 76, registrationStatus: 2 } })
  for (const id of ['', 'abc', '-1', '1.2', '0']) {
    changeOrderId(vm, id)
    assert.deepEqual(vm.data.info, {})
    assert.equal(vm.data.loadState, 'failed_business')
    assert.equal(infoRequests().length, 1)
  }
})

test('F12: A→B→A 后第一轮A响应不能复活，旧完局奖励也不能串单', () => {
  const vm = loadPage()
  vm.data.orderId = '76'
  vm.onLoad()
  const old = infoRequests()[0]
  old.success({ code: 200, data: { id: 76, registrationStatus: 2, purchaseKind: 3 } })
  const completion = sandbox.requests.find(r => r.url === '/api/registration/explore-completion')
  changeOrderId(vm, '77')
  changeOrderId(vm, '76')
  old.success({ code: 200, data: { id: 76, registrationStatus: 2 } })
  completion.success({ code: 200, data: { completed: true, stamps: [], awards: { items: [] } } })
  assert.deepEqual(vm.data.info, {})
  assert.equal(vm.data.loadState, 'loading')
  assert.equal(vm.data.completion.show, false)
})

test('F12: 旧单退款确认在切单后失效，不发送旧单退款', () => {
  const vm = loadPage()
  vm.data.orderId = '76'
  vm.onLoad()
  vm.data.info = { id: 76, paymentStatus: 2, canRequestRefund: true }
  vm.cancelRegistration()
  assert.equal(sandbox.modals.length, 1)
  changeOrderId(vm, '77')
  sandbox.modals[0].success({ confirm: true })
  assert.equal(sandbox.requests.filter(r => r.url === '/api/registration/cancel-refund').length, 0)
  assert.equal(vm.data.cancelling, false)
})

test('F12: 旧单支付参数迟到不打开支付，也不影响新单支付状态', () => {
  const vm = loadPage()
  vm.data.orderId = '76'
  vm.onLoad()
  vm.data.info = { id: 76, paymentStatus: 1 }
  vm.payOrder()
  const pay = sandbox.requests.find(r => r.url === '/api/registration/pay')
  changeOrderId(vm, '77')
  vm.data.info = { id: 77, paymentStatus: 1 }
  vm.payOrder()
  pay.success({ code: 200, data: { registrationId: 76, payParams: {
    timeStamp: '123', nonceStr: 'nonce', package: 'prepay_id=old', signType: 'RSA', paySign: 'sign',
  } } })
  assert.equal(sandbox.payments.length, 0)
  assert.equal(vm.data.paying, true)
  assert.equal(sandbox.requests.filter(r => r.url === '/api/registration/pay').length, 2)
})

test('F12: 已打开的旧单支付回执不在新单显示成功或继续查款', () => {
  const vm = loadPage()
  vm.data.orderId = '76'
  vm.onLoad()
  vm.data.info = { id: 76, paymentStatus: 1 }
  vm.payOrder()
  sandbox.requests.find(r => r.url === '/api/registration/pay').success({ code: 200, data: {
    registrationId: 76, payParams: { timeStamp: '123', nonceStr: 'nonce', package: 'prepay_id=old',
      signType: 'RSA', paySign: 'sign' },
  } })
  assert.equal(sandbox.payments.length, 1)
  changeOrderId(vm, '77')
  const count = sandbox.requests.length
  sandbox.payments[0].success()
  assert.equal(sandbox.requests.length, count)
  assert.equal(vm.data.paying, false)
  assert.equal(sandbox.toasts.includes('支付成功'), false)
})

test('F12: 已发送旧单退款的回执不刷新新单或解除新单忙碌态', () => {
  const vm = loadPage()
  vm.data.orderId = '76'
  vm.onLoad()
  vm.data.info = { id: 76, paymentStatus: 2, canRequestRefund: true }
  vm.cancelRegistration()
  sandbox.modals[0].success({ confirm: true })
  const refund = sandbox.requests.find(r => r.url === '/api/registration/cancel-refund')
  changeOrderId(vm, '77')
  vm.data.cancelling = true
  const count = sandbox.requests.length
  refund.success({ code: 200 })
  refund.complete()
  assert.equal(sandbox.requests.length, count)
  assert.equal(vm.data.cancelling, true)
  assert.equal(sandbox.toasts.includes('退款已受理'), false)
})

test('orderinfo:首次加载期间处于 loading 态,不是伪装成功的空订单', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()

  assert.equal(infoRequests().length, 1, '应发起一次订单详情请求')
  assert.equal(vm.data.loadState, 'loading', '请求在途期间必须是 loading 态')
})

test('orderinfo:业务失败(code!=200)进入 failed_business 并保留错误文案,不落成功态', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoRequests()[0].success({ code: '500', msg: '订单不存在' })

  assert.equal(vm.data.loadState, 'failed_business', '业务失败必须落 failed_business')
  assert.ok(
    String(vm.data.loadErrorText).includes('订单不存在'),
    '错误文案应带上后端返回的原因,当前=' + vm.data.loadErrorText
  )
  assert.deepEqual(vm.data.info, {}, '业务失败不得留下半成品 info')
})

test('orderinfo:网络失败进入 failed_network 且与业务失败可区分', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoRequests()[0].fail({ errMsg: 'request:fail timeout' })

  assert.equal(vm.data.loadState, 'failed_network', '网络失败必须落 failed_network')
  assert.ok(vm.data.loadErrorText, '网络失败必须给出可读文案')
})

test('orderinfo:重新加载沿用原 id,成功后回到 ready 并清空错误文案', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoRequests()[0].fail({ errMsg: 'request:fail' })

  vm.reloadOrder()

  const retry = infoRequests()[1]
  assert.ok(retry, '重试应重新发起 /api/registration/info 请求')
  assert.equal(String(retry.data.id), '1001', '重试必须沿用原订单 id')
  assert.equal(vm.data.loadState, 'loading', '重试在途期间回到 loading')

  retry.success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })
  assert.equal(vm.data.loadState, 'ready', '重试成功后必须回到 ready')
  assert.equal(vm.data.loadErrorText, '', '成功后错误文案必须清空')
  assert.equal(vm.data.info.id, 1001)
})

test('orderinfo:purchaseKind 有值时是主真源,不拿 entitlements 覆盖', () => {
  const explore = loadPage()
  explore.data.orderId = '1001'
  explore.onLoad()
  infoRequests()[0].success({
    code: '200',
    data: { id: 1001, purchaseKind: 3, entitlements: [], registrationStatus: 2, ownerType: 2 }
  })
  assert.equal(explore.data.info.isExploreOrder, true, '真实探店日即使权益列表为空也必须识别')
  assert.equal(explore.data.info.typeLabel, '探店日')

  sandbox.requests.length = 0
  const classic = loadPage()
  classic.data.orderId = '1002'
  classic.onLoad()
  infoRequests()[0].success({
    code: '200',
    data: { id: 1002, purchaseKind: 1, entitlements: [{ type: 'LEGACY' }], registrationStatus: 2, ownerType: 2 }
  })
  assert.equal(classic.data.info.isExploreOrder, false, '经典订单不能因附带权益被误判为探店日')
  assert.equal(classic.data.info.typeLabel, '城市定向场次')   // 2026-09-18 UI-20 用户定:模式名统一「城市定向 / 自由探索」
})

test('orderinfo:purchaseKind 缺失时只回落明确的章节权益事实', () => {
  const vm = loadPage()
  vm.data.orderId = '1003'
  vm.onLoad()
  infoRequests()[0].success({
    code: '200',
    data: {
      id: 1003,
      purchaseKind: null,
      entitlements: [{ registrationId: 1003, topicId: 77, chapterId: 9, status: 0 }],
      registrationStatus: 2,
      ownerType: 2,
    }
  })

  assert.equal(vm.data.info.isExploreOrder, true, '存量/手工单的明确章节权益必须触发 NULL 回落')
  assert.equal(vm.data.info.typeLabel, '探店日')

  sandbox.requests.length = 0
  const legacy = loadPage()
  legacy.data.orderId = '1004'
  legacy.onLoad()
  infoRequests()[0].success({
    code: '200',
    data: { id: 1004, purchaseKind: null, entitlements: [{ type: 'LEGACY' }], registrationStatus: 2, ownerType: 2 }
  })
  assert.equal(legacy.data.info.isExploreOrder, false, '普通非空数组不是探店日事实，不能退回长度 heuristic')
})

test('orderinfo:探店日集合点缺经纬度时明确显示待补充状态', () => {
  const vm = loadPage()
  vm.data.orderId = '1003'
  vm.onLoad()
  infoRequests()[0].success({
    code: '200',
    data: {
      id: 1003,
      purchaseKind: 3,
      registrationStatus: 2,
      ownerType: 2,
      omsTicket: { meetingPoint: '武康大楼', gatherLat: null, gatherLng: '' }
    }
  })

  assert.equal(vm.data.info.meetingPointCoordinateMissing, true)
  assert.match(vm.data.info.meetingPointDisplayText, /武康大楼/)
  assert.match(vm.data.info.meetingPointDisplayText, /坐标待补充/)
})

test('orderinfo:onShow 刷新失败时,已经渲染出来的订单不被错误态顶掉', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoRequests()[0].success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })
  assert.equal(vm.data.loadState, 'ready')

  vm.onShow()
  infoRequests()[1].fail({ errMsg: 'request:fail' })

  assert.equal(vm.data.loadState, 'ready', '后台刷新失败不应把已有订单换成错误页')
  assert.equal(vm.data.info.id, 1001, '已渲染的订单数据必须保留')
})

test('orderinfo:失败面板在场时 onShow 不重拉(否则面板切回 loading、2s 计时从头来)', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoRequests()[0].success({ code: '403', msg: '无权查看该订单' })
  assert.equal(vm.data.loadState, 'failed_business')
  vm.onShow()
  assert.equal(infoRequests().length, 1, '失败态 onShow 不得再发详情请求')
  assert.equal(vm.data.loadState, 'failed_business', '面板原因必须留在屏上')
})

test('orderinfo:首次请求仍在途时 onShow 不重复发起同一详情请求', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  vm.onShow()

  const [initial] = infoRequests()
  assert.equal(infoRequests().length, 1, '首次进入的 attached/show 只能产生一个详情请求')
  initial.success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })

  assert.equal(vm.data.loadState, 'ready')
  assert.equal(vm.data.info.id, 1001)
})

test('orderinfo:较早请求的失败不能打断较新的重试请求', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  vm.reloadOrder()

  const [initial, retry] = infoRequests()
  initial.fail({ errMsg: 'request:fail timeout' })
  assert.equal(vm.data.loadState, 'loading', '旧请求失败时较新的重试仍在途,不能提前落错误态')

  retry.success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })
  assert.equal(vm.data.loadState, 'ready', '较新的重试成功后必须进入 ready')
  assert.equal(vm.data.info.id, 1001)
})

test('orderinfo:较新的请求失败后,更早请求的迟到成功不能复活旧结果', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  vm.reloadOrder()

  const [initial, retry] = infoRequests()
  retry.fail({ errMsg: 'request:fail timeout' })
  initial.success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })

  assert.equal(vm.data.loadState, 'failed_network', '最新请求失败后应保持失败态')
  assert.deepEqual(vm.data.info, {}, '更早请求的迟到成功不得写入旧订单')
})

test('orderinfo:较新请求成功后,更早请求的网络失败不弹误导 toast', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  vm.reloadOrder()

  const [initial, retry] = infoRequests()
  retry.success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })
  initial.fail({ errMsg: 'request:fail timeout' })

  assert.equal(vm.data.loadState, 'ready', '旧请求失败不得改写较新请求的成功态')
  assert.equal(sandbox.toasts.length, 0, '旧请求失败不得弹出误导性的网络错误提示')
})

test('orderinfo:较新请求成功后,更早请求的业务失败不弹误导 toast', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  vm.reloadOrder()

  const [initial, retry] = infoRequests()
  retry.success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })
  initial.success({ code: '500', msg: '旧请求已过时' })

  assert.equal(vm.data.loadState, 'ready', '旧请求失败不得改写较新请求的成功态')
  assert.equal(sandbox.toasts.length, 0, '旧请求失败不得弹出误导性的业务错误提示')
})

test('orderinfo:code=200 但 data=null 不抛 TypeError,落 failed_business 且可重试', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()

  assert.doesNotThrow(
    () => infoRequests()[0].success({ code: '200', data: null }),
    'data=null 不应把页面炸成 TypeError'
  )
  assert.equal(vm.data.loadState, 'failed_business', '空 data 不是成功态')
  assert.ok(vm.data.loadErrorText, '必须给出可读文案')
  assert.deepEqual(vm.data.info, {}, '不得把 null 塞进 info 渲染空白订单卡')
  // 稿 356:5220:首屏失败只由结果面板说一次,不再叠一条同义 toast
  assert.equal(sandbox.toasts.length, 0, '首屏失败不得再弹同义 toast')

  vm.reloadOrder()
  assert.ok(infoRequests()[1], '空 data 失败后仍可重试')
})

test('orderinfo:code=200 但 data 是数组/字符串等非订单对象,同样落 failed_business', () => {
  for (const bad of [[], 'oops', 0]) {
    const vm = loadPage()
    vm.data.orderId = '1001'
  vm.onLoad()
    infoRequests()[0].success({ code: '200', data: bad })
    assert.equal(
      vm.data.loadState,
      'failed_business',
      'data=' + JSON.stringify(bad) + ' 不是有效订单对象,不能当成功'
    )
    sandbox.requests.length = 0
  }
})

test('orderinfo:成功态解析中的真实异常不被吞掉,不会伪装成业务失败', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()

  const poisoned = { id: 1001, ownerType: 2 }
  Object.defineProperty(poisoned, 'registrationStatus', {
    get() { throw new Error('boom') },
    enumerable: true
  })

  assert.throws(
    () => infoRequests()[0].success({ code: '200', data: poisoned }),
    /boom/,
    '真实解析异常必须冒出来,不能被 guard 静默转成业务失败'
  )
})

test('orderinfo:缺少 id 参数时不会卡在无限 loading,而是落失败态', () => {
  const vm = loadPage()
  vm.onLoad({})

  assert.equal(infoRequests().length, 0, '没有 id 时不应发请求')
  assert.notEqual(vm.data.loadState, 'loading', '没有 id 时不能永久停在 loading 态')
  assert.equal(vm.data.loadState, 'failed_business', '缺参数属于业务失败态')
  assert.ok(vm.data.loadErrorText, '必须给出可读的失败文案')
  assert.deepEqual(vm.data.info, {}, '不得渲染出订单主体')
})

test('orderinfo:缺少 id 时点重新加载不会误发请求,也不会退回 loading', () => {
  const vm = loadPage()
  vm.onLoad({})

  vm.reloadOrder()

  assert.equal(infoRequests().length, 0, '无 id 重试不应发起请求')
  assert.equal(vm.data.loadState, 'failed_business', '无 id 重试后仍应停在失败态')
})

// 稿 356:5220(2026-09-15 用户裁决):加载失败 = 零按钮结果半屏,原因停 2s 自动回订单列表。
// 旧契约(三颗竖排大钮:重试/返回/客服)按该裁决整体作废。
function assertFailSheet(wxml, json) {
  const sheet = wxml.match(/<cy-result-sheet\b[^>]*\/>/)
  assert.ok(sheet, '失败态必须由 cy-result-sheet 承载')
  const tag = sheet[0]
  assert.equal(json.usingComponents['cy-result-sheet'], '/components/cy/result-sheet/index')
  assert.match(tag, /show="\{\{loadState==='failed_business' \|\| loadState==='failed_network'\}\}"/, '两种失败态都要出面板')
  assert.match(tag, /kind="fail"/)
  assert.match(tag, /why="\{\{loadErrorText\}\}"/, '失败不静默:面板必须带原因')
  assert.match(tag, /duration="\{\{2000\}\}"/, '停 2s 让用户读到原因')
  assert.match(tag, /bind:close="backToOrderList"/, '自愈/手动关闭都必须回订单列表')
  assert.doesNotMatch(tag, /primary-text|secondary-text|primaryText|secondaryText|wx:if/, '零按钮且无条件:有按钮 cy-result-sheet 不会自愈')
  assert.doesNotMatch(wxml, /order-load-(error|retry|back|contact)/, '旧三按钮失败卡不得回潮')
}

test('orderinfo:加载失败按稿 356:5220 走零按钮结果半屏,2s 后回订单列表', () => {
  const wxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')
  const json = JSON.parse(fs.readFileSync(ORDERINFO_JS.replace(/js$/, 'json'), 'utf8'))
  assertFailSheet(wxml, json)
  const wxss = fs.readFileSync(ORDERINFO_WXSS, 'utf8')
  const rule = wxss.match(/\.order-load-loading\s*\{([^}]*)\}/)
  assert.ok(rule && rule[1].trim(), 'loading 态必须有可见样式')

  const vm = loadPage()
  const events = []
  vm.triggerEvent = name => events.push(name)
  vm.backToOrderList()
  assert.deepEqual(events, ['back'], '面板关闭后必须真的回上一层(订单列表)')
})

test('negative control: 失败面板加回按钮 / 丢掉原因 / 关闭不回列表 都必须判红', () => {
  const wxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')
  const json = JSON.parse(fs.readFileSync(ORDERINFO_JS.replace(/js$/, 'json'), 'utf8'))
  for (const [from, to] of [
    ['kind="fail"', 'kind="fail" primary-text="重试"'],
    [' why="{{loadErrorText}}"', ''],
    ['bind:close="backToOrderList"', 'bind:close="noop"'],
  ]) {
    const mutated = wxml.replace(from, to)
    assert.notEqual(mutated, wxml, '变异锚点失效:' + from)
    assert.throws(() => assertFailSheet(mutated, json), assert.AssertionError, from)
  }
})

test('orderinfo:订单已在屏时后台刷新失败没有面板,toast 仍是唯一信号(不静默)', () => {
  const vm = loadPage()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoRequests()[0].success({ code: '200', data: { id: 1001, registrationStatus: 2, ownerType: 2 } })
  assert.equal(vm.data.loadState, 'ready')
  vm.getData('1001')
  infoRequests()[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(vm.data.loadState, 'ready', '刷新失败不顶掉已渲染订单')
  assert.equal(sandbox.toasts.length, 1, '已在屏刷新失败必须仍有 toast')
})

// 2026-08-03 场景弹窗规范与 2026-08-04 交接覆盖 07-30 的页面级例外:
// H10 现在是玩家 scene-full 子层,外壳与正文都必须消费玩家暗色语义。
function assertPlayerDarkTheme(wxml, wxss) {
  assert.match(
    wxml,
    /class="[^"]*\btheme-dark\b/,
    '订单详情是玩家场景,根容器必须显式挂 theme-dark',
  )
  assert.doesNotMatch(wxml, /\btheme-light\b/, '玩家订单详情不得回潮浅色主题')
  assert.doesNotMatch(wxss, /\.detail\.theme-light\s*\{/, '不得在组件内硬写浅色桥绕过玩家主题')
}

test('orderinfo:H10 跟随玩家暗色场景,不保留旧浅色例外', () => {
  const componentWxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')
  const componentWxss = fs.readFileSync(ORDERINFO_WXSS, 'utf8')
  assertPlayerDarkTheme(componentWxml, componentWxss)
  const deepLinkShell = fs.readFileSync(path.join(ROOT, 'subpackageMember/orderinfo/orderinfo.wxml'), 'utf8')
  assert.match(deepLinkShell, /class="[^"]*\btheme-dark\b/)
  assert.doesNotMatch(deepLinkShell, /\btheme-light\b/)
})

test('negative control: 玩家订单详情退回 theme-light 必须判红', () => {
  const wxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')
  const wxss = fs.readFileSync(ORDERINFO_WXSS, 'utf8')
  const mutated = wxml.replace('<view class="detail theme-dark">', '<view class="detail theme-light">')
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertPlayerDarkTheme(mutated, wxss), assert.AssertionError)
})

test('negative control: 在玩家订单组件里重新注入浅色桥必须判红', () => {
  const wxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')
  const wxss = fs.readFileSync(ORDERINFO_WXSS, 'utf8')
  const mutated = `.detail.theme-light { --cy-bg-page: #F8F9FA; }\n${wxss}`
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertPlayerDarkTheme(wxml, mutated), assert.AssertionError)
})

test('orderinfo:根背景支持弹窗透明覆盖,独立页仍回退主题页面 token', () => {
  const wxss = fs.readFileSync(ORDERINFO_WXSS, 'utf8')
  const detail = wxss.match(/\.detail\s*\{([^}]*)\}/)
  assert.ok(detail, '订单详情根容器必须存在')
  assert.match(detail[1], /background:\s*var\(--cy-scene-content-bg,\s*var\(--cy-color-bg-page\)\)/)
  assert.doesNotMatch(detail[1], /linear-gradient|#[0-9A-Fa-f]{3,8}/)
})

// 终审质疑:ready 闸是否只包住 .david,页面后半段有内容漏在闸外?
// WXML 没有 renderer,用标签配平走一遍结构:凡是 .detail 下、
// loading/error/.david 之外还留着内容容器,失败态就会照样渲染出来。
// 导航统一(2026-07-29)后 .detail 下多了一块导航让位:cy-nav-bar 是 position:fixed,
// 让位块负责把正文顶下来。它必须在闸外——任何 loadState 下都得给出返回出口,
// 否则加载失败就成了退不出去的死页。除它之外,订单内容仍必须全部在 loadState 闸内。
const NAV_SPACER = /^<view style="height:\s*\{\{statusBarHeight \+ navBarHeight\}\}px;?\s*"\s*>$/
function detailChildrenOutsideGates(wxml) {
  const source = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const tokens = [...source.matchAll(/<([\w-]+)\b[^>]*\/?\s*>|<\/([\w-]+)>/g)]
  const stack = []
  const strays = []
  for (const token of tokens) {
    const raw = token[0]
    const closingTag = token[2]
    if (closingTag) { stack.pop(); continue }
    const tag = token[1]
    const parent = stack[stack.length - 1]
    if (parent === 'detail') {
      const cls = (raw.match(/class="([^"]*)"/) || [, ''])[1]
      const gated = /\border-load-loading\b|\bdavid\b/.test(cls)
        || (tag === 'cy-result-sheet' && /show="\{\{loadState==='failed_/.test(raw))
      const pageChrome = tag === 'cy-nav-bar' || tag === 'cy-page-title'
      if (!gated && !pageChrome && !NAV_SPACER.test(raw)) strays.push(raw)
    }
    if (!/\/\s*>$/.test(raw)) stack.push(/class="[^"]*\bdetail\b/.test(raw) ? 'detail' : 'other')
  }
  return strays
}

// 让位只有一处:.detail 下那块 statusBarHeight+navBarHeight 的 spacer。
// .david 曾经自带 margin-top:12vh(overlay nav 时代它自己给固定导航让位),
// 导航转实底 + 补 spacer 之后那 12vh 就是第二份让位,而且 88vh+12vh 会溢出可视区。
// 纵向滚动面只许 scene-sheet 正文区一处;组件内部不得再开 overflow-y:auto。
function assertSingleTopOffsetAndScroller(wxss) {
  const david = wxss.match(/\.david\s*\{([^}]*)\}/)
  assert.ok(david, '订单主体容器 .david 必须存在')
  assert.doesNotMatch(
    david[1],
    /(margin|padding)-top:/,
    '.david 自带顶部让位,会与 spacer 叠成第二份让位把订单主体推下去:' + david[1],
  )
  assert.doesNotMatch(
    david[1],
    /height:\s*\d/,
    '.david 写死视口高度会与让位相加溢出可视区,高度应由内容决定:' + david[1],
  )
  const detail = wxss.match(/\.detail\s*\{([^}]*)\}/)
  assert.ok(detail, '订单详情根容器必须存在')
  assert.doesNotMatch(detail[1], /overflow-y:\s*auto/, '.detail 再开滚动面会与 scene-sheet 嵌套:' + detail[1])
  assert.doesNotMatch(david[1], /overflow-y:\s*auto/, '.david 再开滚动面会与 scene-sheet 嵌套:' + david[1])
}

test('orderinfo:顶部让位与滚动面各只有一处,订单主体不自带偏移', () => {
  assertSingleTopOffsetAndScroller(fs.readFileSync(ORDERINFO_WXSS, 'utf8'))
})

test('negative control: .david 把 12vh 第二份让位加回来必须判红', () => {
  const wxss = fs.readFileSync(ORDERINFO_WXSS, 'utf8')
  const davidRule = wxss.match(/\.david\s*\{[^}]*\}/)
  assert.ok(davidRule, '找不到 .david 规则块(源码已改动?)')
  const mutated = wxss.replace(davidRule[0], '.david { width: 100%; height: 88vh; margin-top: 12vh; overflow-y: auto; }')
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSingleTopOffsetAndScroller(mutated), assert.AssertionError)
})

test('negative control: 组件内任一层重新打开滚动面必须判红', () => {
  const wxss = fs.readFileSync(ORDERINFO_WXSS, 'utf8')
  const detailRule = wxss.match(/\.detail\s*\{[^}]*\}/)
  assert.ok(detailRule, '找不到 .detail 规则块(源码已改动?)')
  const nestedDetail = wxss.replace(detailRule[0], detailRule[0].replace(/\}$/, '  overflow-y: auto;\n}'))
  assert.notEqual(nestedDetail, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSingleTopOffsetAndScroller(nestedDetail), assert.AssertionError)

  const davidRule = wxss.match(/\.david\s*\{[^}]*\}/)
  assert.ok(davidRule, '找不到 .david 规则块(源码已改动?)')
  const nested = wxss.replace(davidRule[0], '.david { width: 100%; overflow-y: auto; }')
  assert.notEqual(nested, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSingleTopOffsetAndScroller(nested), assert.AssertionError)
})

test('orderinfo:退出出口在闸外 —— 任何 loadState 都退得出去', () => {
  // H10 之后返回/关闭由 scene-sheet 的统一头部承担(左 ‹ 右 ×),它由宿主无条件渲染,
  // 天然在组件的 loadState 闸之外。所以这条从"组件里必须有 cy-nav-bar 且在闸外"
  // 翻成两条等价约束:①组件自己不许再画一套会被闸住的返回;②宿主的头部不受任何 loadState 影响。
  const wxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')
  assert.doesNotMatch(wxml, /<cy-nav-bar\b/, '返回栏应交给 scene-sheet,组件里再画一套就会被 loadState 闸住')

  const host = fs.readFileSync(path.join(ROOT, 'subpackageMember/order/order.wxml'), 'utf8')
  const mount = host.match(/<view class="order-scene-host" wx:if="\{\{sceneCurrent && sceneCurrent\.id === 'member-order-detail'\}\}"[\s\S]*?<\/view>/)
  assert.ok(mount, '宿主里没挂 member-order-detail 场景')
  assert.match(mount[0], /can-back="\{\{sceneCurrent\.canBack\}\}"/, '子层必须给出 ‹ 返回')
  assert.match(mount[0], /bind:requestclose="closeScene"/, '必须有关闭整个场景的出口')
  assert.doesNotMatch(mount[0], /loadState/, '宿主头部不得被内容的 loadState 闸住')

  // 深链壳同理:它没有任何 loadState 闸,nav-bar 与页标题恒在
  const shell = fs.readFileSync(path.join(ROOT, 'subpackageMember/orderinfo/orderinfo.wxml'), 'utf8')
  assert.match(shell, /<cy-nav-bar\b/)
  assert.match(shell, /<cy-page-title\b/)
  assert.doesNotMatch(shell, /wx:if="\{\{loadState/, '壳里不该有 loadState 闸')
})

test('negative control: 把返回出口关进 ready 闸(失败态退不出去)必须判红', () => {
  // 变异:宿主把整个场景挂载点关进内容的 ready 闸 —— 加载失败时连 ‹ / × 都消失
  const host = fs.readFileSync(path.join(ROOT, 'subpackageMember/order/order.wxml'), 'utf8')
  const mutated = host.replace(
    `<view class="order-scene-host" wx:if="{{sceneCurrent && sceneCurrent.id === 'member-order-detail'}}"`,
    `<view class="order-scene-host" wx:if="{{sceneCurrent && sceneCurrent.id === 'member-order-detail' && loadState === 'ready'}}"`,
  )
  assert.notEqual(mutated, host, '变异锚点失效(宿主挂载点已改动?)')
  const mount = mutated.match(/<view class="order-scene-host" wx:if="\{\{sceneCurrent && sceneCurrent\.id === 'member-order-detail'[\s\S]*?<\/view>/)
  assert.ok(mount)
  assert.throws(
    () => assert.doesNotMatch(mount[0], /loadState/, '宿主头部不得被内容的 loadState 闸住'),
    assert.AssertionError,
    '闸内化之后检查器仍判绿 —— 这条断言是恒真的橡皮图章',
  )
})

test('orderinfo:ready 闸覆盖整页,失败/加载态下没有任何订单内容漏在闸外', () => {
  const wxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')

  const strays = detailChildrenOutsideGates(wxml)
  assert.deepEqual(
    strays,
    [],
    '这些内容容器直挂在 .detail 下且不受 loadState 闸控制,失败态会照样渲染:\n' + strays.join('\n')
  )

  // 自证:检查器能判红——把一个节点挪到闸外必须被抓到
  const escaped = wxml.replace(
    '<view class="david" wx:if="{{loadState===\'ready\'}}">',
    '<view class="david" wx:if="{{loadState===\'ready\'}}"></view>\n<view class="bmbottom">'
  )
  assert.ok(
    detailChildrenOutsideGates(escaped).length > 0,
    '检查器必须能抓到漏在闸外的节点(否则是恒真断言)'
  )
})

test('orderinfo:无 id 时 reloadOrder 是空动作(失败面板因此不给重试钮)', () => {
  const vm = loadPage()
  vm.onLoad({})
  vm.reloadOrder()
  assert.equal(vm.data.loadState, 'failed_business', '无 id 应停在失败态')
  assert.equal(infoRequests().length, 0, '无 id 重试什么都不会发生')
})

test('orderinfo:WXML 订单主体与订单动作被 ready 态闸住,失败态展示原因', () => {
  const wxml = fs.readFileSync(ORDERINFO_WXML, 'utf8')

  const body = wxml.match(/<view class="david"[^>]*>/)
  assert.ok(body, 'WXML 应保留订单主体容器 .david')
  assert.match(body[0], /wx:if="\{\{loadState==='ready'\}\}"/, '订单主体必须只在 ready 态渲染')
  assert.match(wxml, /<cy-result-sheet\b[^>]*why="\{\{loadErrorText\}\}"/, '失败态必须展示错误文案')
  assert.match(wxml, /class="order-load-loading"/, 'loading 态必须有可见占位')
})
