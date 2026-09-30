const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js
const { createRequestClient } = require('../../utils/transport/request-client.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function applyDataPatch(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.match(/[^.[\]]+/g) || []
    if (parts.length < 2) {
      data[key] = value
      return
    }
    let cursor = data
    parts.slice(0, -1).forEach((part) => {
      if (cursor[part] == null) cursor[part] = /^\d+$/.test(part) ? [] : {}
      cursor = cursor[part]
    })
    cursor[parts[parts.length - 1]] = value
  })
}

function loadPage(relativePath, mutate, harnessOptions = {}) {
  let source = read(relativePath)
  if (mutate) {
    const changed = mutate(source)
    assert.notEqual(changed, source, '负控锚点失效:生产 guard 未命中')
    source = changed
  }

  const requests = []
  const locationCalls = []
  const navigations = []
  const modals = []
  const timers = []
  let definition
  const app = {
    _userId: 'member-a',
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID() { return this._userId },
    getUserRole() { return 'merchant' },
    getUserType() { return 2 },
    sendRequest(options) {
      if (typeof harnessOptions.sendRequest === 'function') return harnessOptions.sendRequest(options)
      requests.push(options)
      return { abort() {} }
    },
    getRequestErrorMessage(value, fallback) {
      return (value && (value.msg || value.message)) || fallback
    },
  }
  const wx = {
    getLocation(options) { locationCalls.push(options) },
    stopPullDownRefresh() {},
    showToast() {},
    showLoading() {},
    hideLoading() {},
    requestPayment() {},
    setClipboardData() {},
    makePhoneCall() {},
    openSetting(options) { if (options && options.success) options.success({}) },
    showModal(options) {
      modals.push(options)
      if (!harnessOptions.deferModals && options && options.success) {
        options.success({ confirm: true, content: '保留原业务原因' })
      }
    },
    showActionSheet(options) { if (options && options.success) options.success({ tapIndex: 0 }) },
    navigateBack() {},
    navigateTo(options) {
      navigations.push(options.url)
      if (options.complete) options.complete({ errMsg: 'navigateTo:ok' })
    },
    getStorageSync() { return '' },
    setStorageSync() {},
  }
  const pageFile = path.join(ROOT, relativePath)
  const sandbox = {
    Page(value) { definition = value },
    getApp() { return app },
    wx,
    console,
    Promise,
    Date,
    Number,
    String,
    Object,
    Array,
    Math,
    JSON,
    setTimeout(fn) { timers.push(fn); return timers.length },
    clearTimeout() {},
    require(id) {
      if (id.includes('datetime')) return { toTimestamp: () => Date.now() + 3600000 }
      if (id.includes('subscribe')) return { request: () => Promise.resolve({ status: 'accepted' }) }
      if (id.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} }
      if (id.includes('identity-policy')) return { isMerchantView: () => true }
      if (id.includes('response-shape')) {
        return { isRecordList: (rows) => Array.isArray(rows) && rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)) }
      }
      if (id.includes('checkout-workflow')) {
        return {
          createCheckoutWorkflow: () => ({ submit: () => true, destroy() {} }),
          hasCompletePaymentParams: () => true,
        }
      }
      if (id.includes('payment-verifier')) return { createPaymentVerifier: () => () => {} }
      if (id.includes('merchant-home-link')) {
        return { merchantHomeUrl: (id) => id ? `/pages/merchant/home/index?id=${id}` : '' }
      }
      return require(path.resolve(path.dirname(pageFile), id))
    },
  }
  vm.runInNewContext(source, sandbox, { filename: relativePath })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function setData(patch) { applyDataPatch(this.data, patch) }
  return { page, app, requests, locationCalls, navigations, timers, modals }
}

const byUrl = (requests, url) => requests.filter((request) => request.url === url)
const flush = () => new Promise((resolve) => setImmediate(resolve))

// 用真实页面数据求值 wxml 里的空态 wx:if —— 空态是否会在这一屏落下,按生产表达式判,不靠肉眼。
function emptyVisible(wxml, title, data) {
  const tag = wxml.match(new RegExp('<cy-empty[^>]*title="' + title + '"[^>]*>'))
  assert.ok(tag, '找不到空态: ' + title)
  const expr = tag[0].match(/wx:if="\{\{([\s\S]*?)\}\}"/)
  assert.ok(expr, '空态缺 wx:if: ' + title)
  const names = Object.keys(data)
  const fn = new Function(...names, 'return (' + expr[1] + ');')
  return !!fn(...names.map((name) => data[name]))
}

test('合作列表首载 single-flight，刷新保留旧列表并区分网络失败；旧航班不能覆盖重试', () => {
  const { page, app, requests } = loadPage('pages/coop/list/index.js')
  page.onLoad({})
  page.onShow()
  // 合作池 tab 已收编:首屏 = 协作邀约 + 俱乐部申请收/发两路,不再拉 /pool/list
  // 官方邀约随合作中心「邀约我的」tab 收进收到的;承接报名候选单请求跨主题聚合
  assert.deepEqual(requests.map((request) => request.url), ['/api/coop/list', '/api/coop/pool/received', '/api/coop/pool/mine', '/api/official/merchant-invites', '/api/coop/candidates/received'])
  page.load()
  assert.equal(requests.length, 5, '同身份同查询同步重入不得重复发请求')

  const firstList = byUrl(requests, '/api/coop/list')[0]
  firstList.success({ code: 200, data: { received: [{ id: 1, inviteType: 0, status: 0 }], sent: [], slots: {} } })
  byUrl(requests, '/api/coop/pool/received')[0].success({ code: 200, data: [] })
  byUrl(requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [] })
  assert.equal(page.data.received[0].id, 1)
  assert.equal(page.data.listState, 'ready')

  page.onPullDownRefresh()
  const secondList = byUrl(requests, '/api/coop/list')[1]
  const secondPool = byUrl(requests, '/api/coop/pool/mine')[1]
  assert.ok(secondList && secondPool && byUrl(requests, '/api/coop/pool/received')[1], '邀约与带队申请都必须参与下拉刷新')
  assert.equal(page.data.listState, 'ready')
  assert.equal(page.data.listRefreshing, true)
  assert.equal(page.data.received[0].id, 1, '刷新开始不能清掉旧列表')
  secondList.fail({ errMsg: 'request:fail timeout' })
  secondPool.fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.listState, 'ready')
  assert.equal(page.data.listErrorKind, 'network')
  assert.equal(page.data.received[0].id, 1, '刷新失败仍须保留旧列表')

  page.load()
  const thirdList = byUrl(requests, '/api/coop/list')[2]
  secondList.fail({ msg: '迟到的旧业务失败' })
  assert.equal(page.data.listRefreshing, true, '旧航班迟到回调不得覆盖新重试')
  thirdList.success({ code: 200, data: { received: [{ id: 2, inviteType: 0, status: 0 }], sent: [], slots: {} } })
  assert.equal(page.data.received[0].id, 2)

  page.load()
  const oldIdentityRequest = byUrl(requests, '/api/coop/list')[3]
  app._userId = 'member-b'
  page.load()
  const newIdentityRequest = byUrl(requests, '/api/coop/list')[4]
  assert.ok(newIdentityRequest, '身份改变必须启动新身份航班，不能被旧 single-flight 卡住')
  oldIdentityRequest.success({ code: 200, data: { received: [{ id: 99, inviteType: 0, status: 0 }], sent: [], slots: {} } })
  assert.notEqual(page.data.received[0] && page.data.received[0].id, 99)
  newIdentityRequest.success({ code: 200, data: { received: [{ id: 3, inviteType: 0, status: 0 }], sent: [], slots: {} } })
  assert.equal(page.data.received[0].id, 3)
})

test('带队申请两路各自结算:一路失败只影响自己那一栏,另一路照常出数据', () => {
  const { page, requests } = loadPage('pages/coop/list/index.js')
  const receivedApply = { applyId: 31, topicId: 8, status: 0, clubName: '夜跑团', topicName: '周末路线' }
  const sentApply = { applyId: 41, topicId: 9, status: 0, clubName: '晨跑团', topicName: '滨江路线' }
  page.loadApplies()
  byUrl(requests, '/api/coop/pool/received')[0].success({ code: 200, data: [receivedApply] })
  byUrl(requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [sentApply] })
  assert.equal(page.data.receivedApplyState, 'ready')
  assert.equal(page.data.sentApplyState, 'ready')

  page.loadApplies()
  byUrl(requests, '/api/coop/pool/received')[1].success({ code: 200, data: [] })
  byUrl(requests, '/api/coop/pool/mine')[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.receivedApplyState, 'ready')
  assert.equal(page.data.receivedApplyErrorText, '', '收到的这一路成功就不该挂它的错误')
  assert.equal(page.data.receivedApplies.length, 0, '收到的这一路新结果(空)照常落地')
  assert.equal(page.data.sentApplyState, 'ready')
  assert.match(page.data.sentApplyErrorText, /网络/)
  assert.equal(page.data.sentApplies[0].applyId, 41, '发件箱这一路失败只保留自己的旧快照')
})

test('两路错误各自归属:收到的失败不顶到「我发出的」,反之亦然', () => {
  const first = { applyId: 31, topicId: 8, status: 0, clubName: '夜跑团', topicName: '周末路线' }
  const second = { applyId: 41, topicId: 9, status: 0, clubName: '晨跑团', topicName: '滨江路线' }

  const receivedFails = loadPage('pages/coop/list/index.js')
  receivedFails.page.loadApplies()
  byUrl(receivedFails.requests, '/api/coop/pool/received')[0].fail({ errMsg: 'request:fail timeout' })
  byUrl(receivedFails.requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [second] })
  assert.match(receivedFails.page.data.receivedApplyErrorText, /网络/)
  assert.equal(receivedFails.page.data.sentApplyErrorText, '', '收到的错误不得出现在发件箱这一路')
  assert.deepEqual(receivedFails.page.data.sentApplies.map(r => r.applyId), [41], '另一路成功照常落地')

  const sentFails = loadPage('pages/coop/list/index.js')
  sentFails.page.loadApplies()
  byUrl(sentFails.requests, '/api/coop/pool/received')[0].success({ code: 200, data: [first] })
  byUrl(sentFails.requests, '/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' })
  assert.match(sentFails.page.data.sentApplyErrorText, /网络/)
  assert.equal(sentFails.page.data.receivedApplyErrorText, '', '发件箱的错误不得出现在收到的这一路')
  assert.deepEqual(sentFails.page.data.receivedApplies.map(r => r.applyId), [31], '另一路成功照常落地')
})

test('★mutation:两路错误共用一个出口时一路的失败会写进另一路,专项断言必须真红', () => {
  const { page, requests } = loadPage('pages/coop/list/index.js', (source) => source.replace(
    'sentApplyErrorText: text,',
    'sentApplyErrorText: text, receivedApplyErrorText: text,',
  ))
  page.loadApplies()
  byUrl(requests, '/api/coop/pool/received')[0].success({ code: 200, data: [] })
  byUrl(requests, '/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' })
  assert.match(page.data.receivedApplyErrorText, /网络/, '负控必须真实复现「发件箱错误串到收到的」')
})

test('带队申请行缺关键字段或状态未知时 fail-closed，不冒充真实空态', () => {
  for (const data of [null, [{}], [{ applyId: 1, topicId: 8, status: 9 }], [{ topicId: 8, status: 0 }]]) {
    const { page, requests } = loadPage('pages/coop/list/index.js')
    page.loadApplies()
    byUrl(requests, '/api/coop/pool/received')[0].success({ code: 200, data })
    byUrl(requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [] })
    assert.equal(page.data.receivedApplyState, 'error')
    assert.equal(page.data.receivedApplies.length, 0)
    assert.ok(page.data.receivedApplyErrorText)
    assert.equal(page.data.sentApplyState, 'ready', '另一路好着的不受牵连')
    assert.equal(page.data.sentApplyErrorText, '')
  }
})

// 空态条件直接对着生产 wxml 求值:失败信号在场时必须为假,真读到空列表时才为真。
function emptyStateVisible(wxml, title, data) {
  const tag = wxml.match(new RegExp('<cy-empty[^>]*title="' + title + '"[^>]*>'))
  assert.ok(tag, '空态标签必须存在: ' + title)
  const expr = tag[0].match(/wx:if="\{\{([\s\S]*?)\}\}"/)
  assert.ok(expr, '空态必须挂 wx:if: ' + title)
  const names = Object.keys(data)
  return new Function(...names, 'return (' + expr[1] + ');')(...names.map(n => data[n]))
}

test('失败态与空态互斥:两路申请失败时「还没有…」不许落(真空列表仍可达)', () => {
  const wxml = read('pages/coop/list/index.wxml')

  const failed = loadPage('pages/coop/list/index.js')
  failed.page.loadApplies()
  byUrl(failed.requests, '/api/coop/pool/received')[0].fail({ errMsg: 'request:fail timeout' })
  byUrl(failed.requests, '/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(failed.page.data.receivedApplyState, 'error')
  assert.equal(failed.page.data.sentApplyState, 'error')
  assert.ok(failed.page.data.receivedApplyErrorText)
  assert.ok(failed.page.data.sentApplyErrorText)
  assert.equal(emptyStateVisible(wxml, '还没有收到协作邀请', failed.page.data), false, '失败时不许说「还没有收到」')
  assert.equal(emptyStateVisible(wxml, '还没有发出协作邀请', failed.page.data), false, '失败时不许说「还没有发出」')

  const officialFails = loadPage('pages/coop/list/index.js')
  officialFails.page.loadApplies()
  byUrl(officialFails.requests, '/api/coop/pool/received')[0].success({ code: 200, data: [] })
  byUrl(officialFails.requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [] })
  officialFails.page.loadOfficialInvites()
  byUrl(officialFails.requests, '/api/official/merchant-invites')[0].success({ code: 500, msg: '服务暂不可用' })
  assert.ok(officialFails.page.data.officialErrorText)
  assert.equal(emptyStateVisible(wxml, '还没有收到协作邀请', officialFails.page.data), false, '官方邀约失败时也不许说「还没有收到」')

  const refresh = loadPage('pages/coop/list/index.js')
  refresh.page.load()
  byUrl(refresh.requests, '/api/coop/list')[0].success({ code: 200, data: { received: [], sent: [], slots: {} } })
  byUrl(refresh.requests, '/api/coop/pool/received')[0].success({ code: 200, data: [] })
  byUrl(refresh.requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [] })
  byUrl(refresh.requests, '/api/official/merchant-invites')[0].success({ code: 200, data: [] })
  assert.equal(emptyStateVisible(wxml, '还没有收到协作邀请', refresh.page.data), true, '真读到空列表时空态必须可达')
  assert.equal(emptyStateVisible(wxml, '还没有发出协作邀请', refresh.page.data), true, '真读到空列表时空态必须可达')

  refresh.page.onPullDownRefresh()
  byUrl(refresh.requests, '/api/coop/list')[1].fail({ errMsg: 'request:fail timeout' })
  byUrl(refresh.requests, '/api/coop/pool/received')[1].success({ code: 200, data: [] })
  byUrl(refresh.requests, '/api/coop/pool/mine')[1].success({ code: 200, data: [] })
  byUrl(refresh.requests, '/api/official/merchant-invites')[1].success({ code: 200, data: [] })
  assert.equal(refresh.page.data.listState, 'ready')
  assert.ok(refresh.page.data.listErrorText)
  assert.equal(emptyStateVisible(wxml, '还没有收到协作邀请', refresh.page.data), false, '刷新失败保留旧快照时也不许说「还没有」')
  assert.equal(emptyStateVisible(wxml, '还没有发出协作邀请', refresh.page.data), false, '刷新失败保留旧快照时也不许说「还没有」')
})

test('★mutation:摘掉空态的失败守卫后失败会被说成「还没有」,专项断言必须真红', () => {
  const source = read('pages/coop/list/index.wxml')
  const mutated = source
    .replace("receivedApplyState === 'ready' && !receivedApplyErrorText && ", '')
    .replace("sentApplyState === 'ready' && !sentApplyErrorText && ", '')
  assert.notEqual(mutated, source, '负控锚点失效:空态失败守卫不存在')

  const failed = loadPage('pages/coop/list/index.js')
  failed.page.loadApplies()
  byUrl(failed.requests, '/api/coop/pool/received')[0].fail({ errMsg: 'request:fail timeout' })
  byUrl(failed.requests, '/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(emptyStateVisible(mutated, '还没有收到协作邀请', failed.page.data), true, '负控必须真实复现「失败被说成还没有收到」')
  assert.equal(emptyStateVisible(mutated, '还没有发出协作邀请', failed.page.data), true, '负控必须真实复现「失败被说成还没有发出」')
})

test('失败态与空态互斥:任一路失败时该栏不许落「还没有…」空态', () => {
  const wxml = read('pages/coop/list/index.wxml')

  // 两路都失败且无旧快照 —— 列表是空的,但这是失败不是空数据:空态条件必须为假
  const failed = loadPage('pages/coop/list/index.js')
  failed.page.loadApplies()
  byUrl(failed.requests, '/api/coop/pool/received')[0].fail({ errMsg: 'request:fail timeout' })
  byUrl(failed.requests, '/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(failed.page.data.receivedApplyState, 'error')
  assert.equal(failed.page.data.sentApplyState, 'error')
  assert.equal(failed.page.data.receivedApplies.length, 0)
  assert.equal(failed.page.data.sentApplies.length, 0)
  assert.equal(emptyVisible(wxml, '还没有收到协作邀请', failed.page.data), false, '失败不许被说成「还没有收到」')
  assert.equal(emptyVisible(wxml, '还没有发出协作邀请', failed.page.data), false, '失败不许被说成「还没有发出」')

  // 真正读到空列表(两路都成功)—— 空态是数据的真话,必须仍然可达
  const empty = loadPage('pages/coop/list/index.js')
  empty.page.loadApplies()
  byUrl(empty.requests, '/api/coop/pool/received')[0].success({ code: 200, data: [] })
  byUrl(empty.requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [] })
  assert.equal(empty.page.data.receivedApplyState, 'ready')
  assert.equal(empty.page.data.sentApplyState, 'ready')
  assert.equal(emptyVisible(wxml, '还没有收到协作邀请', empty.page.data), true, '成功读到空列表才准落空态')
  assert.equal(emptyVisible(wxml, '还没有发出协作邀请', empty.page.data), true, '成功读到空列表才准落空态')

  // 官方邀约失败也算「这一栏没加载出来」:收到的空态同样不许落
  const officialFailed = loadPage('pages/coop/list/index.js')
  officialFailed.page.loadApplies()
  byUrl(officialFailed.requests, '/api/coop/pool/received')[0].success({ code: 200, data: [] })
  byUrl(officialFailed.requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [] })
  officialFailed.page.loadOfficialInvites()
  byUrl(officialFailed.requests, '/api/official/merchant-invites')[0].success({ code: 500, msg: '服务暂不可用' })
  assert.ok(officialFailed.page.data.officialErrorText)
  assert.equal(emptyVisible(wxml, '还没有收到协作邀请', officialFailed.page.data), false, '官方邀约失败不许被说成「还没有收到」')

  // 邀请列表刷新失败(旧快照保留,listState 仍是 ready)时两个空态都不许落
  const refreshFailed = loadPage('pages/coop/list/index.js')
  refreshFailed.page.load()
  byUrl(refreshFailed.requests, '/api/coop/list')[0].success({ code: 200, data: { received: [], sent: [], slots: {} } })
  byUrl(refreshFailed.requests, '/api/coop/pool/received')[0].success({ code: 200, data: [] })
  byUrl(refreshFailed.requests, '/api/coop/pool/mine')[0].success({ code: 200, data: [] })
  refreshFailed.page.onPullDownRefresh()
  byUrl(refreshFailed.requests, '/api/coop/list')[1].fail({ errMsg: 'request:fail timeout' })
  byUrl(refreshFailed.requests, '/api/coop/pool/received')[1].success({ code: 200, data: [] })
  byUrl(refreshFailed.requests, '/api/coop/pool/mine')[1].success({ code: 200, data: [] })
  assert.equal(refreshFailed.page.data.listState, 'ready')
  assert.ok(refreshFailed.page.data.listErrorText)
  assert.equal(emptyVisible(wxml, '还没有收到协作邀请', refreshFailed.page.data), false, '刷新失败不许被说成「还没有收到」')
  assert.equal(emptyVisible(wxml, '还没有发出协作邀请', refreshFailed.page.data), false, '刷新失败不许被说成「还没有发出」')
})

test('★mutation:摘掉空态的失败守卫后,失败会被重新说成「还没有…」,专项断言必须真红', () => {
  const source = read('pages/coop/list/index.wxml')
  const mutated = source
    .replace("receivedApplyState === 'ready' && !receivedApplyErrorText && !receivedRegErrorText && !officialErrorText && !listErrorText && ", '')
    .replace("sentApplyState === 'ready' && !sentApplyErrorText && !listErrorText && ", '')
  assert.notEqual(mutated, source, '负控锚点失效:空态失败守卫不存在')

  const failed = loadPage('pages/coop/list/index.js')
  failed.page.loadApplies()
  byUrl(failed.requests, '/api/coop/pool/received')[0].fail({ errMsg: 'request:fail timeout' })
  byUrl(failed.requests, '/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(emptyVisible(mutated, '还没有收到协作邀请', failed.page.data), true, '负控必须真实复现「失败说成还没有收到」')
  assert.equal(emptyVisible(mutated, '还没有发出协作邀请', failed.page.data), true, '负控必须真实复现「失败说成还没有发出」')
})

test('收到的带队申请:拒绝同步防重并回读,回邀约带 originApplyId 进带条款邀约', () => {
  const { page, requests, navigations } = loadPage('pages/coop/list/index.js')
  const event = { currentTarget: { dataset: { applyid: 31, name: '夜跑团' } } }
  page.declineApply(event)
  page.declineApply(event)
  const writes = byUrl(requests, '/api/coop/pool/decline')
  assert.equal(writes.length, 1, '确认框同步回调内也只能发一条拒绝')
  assert.deepEqual(JSON.parse(writes[0].data), { applyId: 31 })
  writes[0].success({ code: 200 })
  assert.match(page.data.actionReceipt, /已拒绝/)
  assert.ok(byUrl(requests, '/api/coop/pool/received').length >= 1, '拒绝成功后必须回读申请列表')

  page.replyApplyInvite({ currentTarget: { dataset: { applyid: 31, clubid: 7, topicid: 8, name: '夜跑团' } } })
  assert.equal(navigations.pop(), '/pages/coop/invite/index?type=1&toId=7&toName=%E5%A4%9C%E8%B7%91%E5%9B%A2&topicId=8&originApplyId=31')
})

test('邀约主题/对象刷新保留草稿与旧列表，提交使用同步锁并留下成功回执', () => {
  const { page, requests } = loadPage('pages/coop/invite/index.js')
  page.onLoad({ type: '1' })
  assert.deepEqual(requests.map((request) => request.url), ['/api/topic/list', '/api/merchant/clubs'])
  page.loadMyTopics()
  page.loadTargets()
  assert.equal(requests.length, 2, '主题和对象各自必须 single-flight')
  requests[0].success({ code: 200, data: { rows: [{ id: 9, name: '旧主题' }] } })
  requests[1].success({ code: 200, data: [{ id: 11, name: '甲俱乐部' }] })
  page.setData({ topicId: 9, topicName: '旧主题', message: '保留这段邀约语' })
  page._setSelected([{ toId: 11, name: '甲俱乐部' }])

  page.retryTopics()
  assert.equal(page.data.topicsState, 'ready')
  assert.equal(page.data.topicsRefreshing, true)
  assert.equal(page.data.myTopics[0].id, 9)
  byUrl(requests, '/api/topic/list')[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.topicsErrorKind, 'network')
  assert.equal(page.data.message, '保留这段邀约语')
  assert.equal(page.data.selected[0].toId, 11)

  page.confirmInvite()
  page.confirmInvite()
  const writes = byUrl(requests, '/api/coop/invite')
  assert.equal(writes.length, 1, 'setData 生效前的连点也只能发一条写请求')
  assert.deepEqual(JSON.parse(writes[0].data), {
    inviteType: 1,
    toType: 'club',
    toId: 11,
    topicId: 9,
    shareMode: 0,
    message: '保留这段邀约语',
  })
  writes[0].success({ code: 200, data: { inviteId: 101 } })
  writes[0].complete()
  assert.match(page.data.sendReceipt, /已发起 1 条/)
  assert.equal(page.data.submitting, false)
})

test('邀约对象响应含非法条目时是服务错误，不能冒充真实空态', () => {
  const { page, requests } = loadPage('pages/coop/invite/index.js')
  page.onLoad({ topicId: '9', type: '1' })
  assert.equal(requests.length, 1)
  requests[0].success({ code: 200, data: [null] })
  assert.equal(page.data.targetsState, 'error')
  assert.equal(page.data.targetsErrorKind, 'server')
})

test('邀约主题与两类对象缺少提交身份或名称时 fail-closed', () => {
  const topics = loadPage('pages/coop/invite/index.js')
  topics.page.onLoad({ type: '1' })
  topics.requests[0].success({ code: 200, data: { rows: [{}] } })
  assert.equal(topics.page.data.topicsState, 'error')
  assert.equal(topics.page.data.topicsErrorKind, 'server')

  const clubs = loadPage('pages/coop/invite/index.js')
  clubs.page.onLoad({ topicId: '9', type: '1' })
  clubs.requests[0].success({ code: 200, data: [{ name: '甲俱乐部' }] })
  assert.equal(clubs.page.data.targetsState, 'error')
  assert.equal(clubs.page.data.targetsErrorKind, 'server')

  const merchants = loadPage('pages/coop/invite/index.js')
  merchants.page.onLoad({ topicId: '9', type: '0' })
  merchants.requests[0].success({ code: 200, data: [{ id: 11, name: '甲商家' }] })
  assert.equal(merchants.page.data.targetsState, 'error')
  assert.equal(merchants.page.data.targetsErrorKind, 'server')
})

test('邀约对象权限失效时清除旧列表并阻断发送，但保留本地邀约语', () => {
  const { page, requests } = loadPage('pages/coop/invite/index.js')
  page.onLoad({ topicId: '9', type: '1' })
  requests[0].success({ code: 200, data: [{ id: 11, name: '甲俱乐部' }] })
  page.setData({ message: '保留这段邀约语' })
  page._setSelected([{ toId: 11, name: '甲俱乐部' }])
  page.retryTargets()
  requests[1].success({ code: 403, msg: '当前身份无权读取合作对象' })
  assert.equal(page.data.targetsState, 'permission')
  assert.equal(page.data.clubs.length, 0)
  assert.equal(page.data.message, '保留这段邀约语')
  page.sendInvite()
  assert.equal(page.data.inviteModal.show, false, '权限态不能借旧选择继续发送')
  page.retryTargets()
  requests[2].success({ code: 500, msg: '服务仍不可用' })
  assert.equal(page.data.targetsState, 'error', '权限清屏后不能用空列表冒充可刷新快照')
})

test('附近页拒绝非法 topicId，不写成 0；刷新保留旧列表并区分网络失败', async () => {
  const invalid = loadPage('pages/coop/nearby/index.js')
  invalid.page.onLoad({ topicId: 'not-a-topic' })
  assert.equal(invalid.page.data.pageState, 'missing-param')
  assert.equal(invalid.locationCalls.length, 0)
  assert.equal(invalid.requests.length, 0)

  const unavailable = loadPage('pages/coop/nearby/index.js')
  unavailable.page.onLoad({})
  unavailable.locationCalls[0].fail({ errMsg: 'getLocation:fail system error' })
  assert.equal(unavailable.page.data.pageState, 'error', '定位服务失败不能冒充用户拒绝权限')
  assert.equal(unavailable.page.data.errorKind, 'server')

  const denied = loadPage('pages/coop/nearby/index.js')
  denied.page.onLoad({})
  denied.locationCalls[0].fail({ errMsg: 'getLocation:fail auth deny' })
  assert.equal(denied.page.data.pageState, 'permission')
  assert.equal(denied.page.data.errorKind, 'permission')

  const { page, requests, locationCalls } = loadPage('pages/coop/nearby/index.js')
  page.onLoad({ topicId: '7', topicName: '路线' })
  page.locate()
  assert.equal(locationCalls.length, 1, '定位同步重入必须 single-flight')
  locationCalls[0].success({ longitude: 121.5, latitude: 31.2 })
  assert.deepEqual(requests.map((request) => request.url), [
    '/api/merchant/nearby',
    '/api/merchant/chapter-application/invitable',
  ])
  assert.deepEqual(JSON.parse(requests[1].data), { topicId: 7, longitude: 121.5, latitude: 31.2 })
  requests[0].success({ code: 200, data: [{ id: 1, memberId: 2, name: '旧商家', distance: 0 }] })
  requests[1].success({ code: 200, data: [] })
  await flush()
  assert.equal(page.data.merchants[0].name, '旧商家')
  assert.equal(page.data.merchants[0].distanceText, 0, '真实距离 0 不能被当未知隐藏')

  page.onPullDownRefresh()
  assert.equal(locationCalls.length, 2)
  assert.equal(page.data.refreshing, true)
  assert.equal(page.data.merchants[0].name, '旧商家')
  locationCalls[1].success({ longitude: 121.6, latitude: 31.3 })
  const refreshRequests = requests.slice(2)
  refreshRequests[0].fail({ errMsg: 'request:fail timeout' })
  refreshRequests[1].success({ code: 200, data: [] })
  await flush()
  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.refreshErrorKind, 'network')
  assert.equal(page.data.merchants[0].name, '旧商家')
})

test('附近页任一可承接商家元素或数组字段损坏时整批 fail-closed，不让 merge 抛错或冒充空态', async () => {
  for (const badRows of [
    [null],
    [{ memberId: 8, name: '坏字段商家', chapterName: '第一章', chapterNames: {} }],
  ]) {
    const { page, requests, locationCalls } = loadPage('pages/coop/nearby/index.js')
    page.onLoad({ topicId: '7' })
    locationCalls[0].success({ longitude: 121.5, latitude: 31.2 })
    requests[0].success({ code: 200, data: [] })
    requests[1].success({ code: 200, data: badRows })
    await flush()
    assert.equal(page.data.pageState, 'error')
    assert.equal(page.data.merchants.length, 0)
    assert.match(page.data.errorText, /加载|失败|不可用/)
  }
})

test('页面结构提供首载、原位刷新/错误、操作回执、aria 与真实 88rpx 点击区', () => {
  const listWxml = read('pages/coop/list/index.wxml')
  const inviteWxml = read('pages/coop/invite/index.wxml')
  const nearbyWxml = read('pages/coop/nearby/index.wxml')
  const listWxss = read('pages/coop/list/index.wxss')
  const inviteWxss = read('pages/coop/invite/index.wxss')
  const nearbyWxss = read('pages/coop/nearby/index.wxss')
  const sharedBtnWxss = read('components/cy/btn/index.wxss')

  ;[listWxml, inviteWxml, nearbyWxml].forEach((wxml) => {
    assert.match(wxml, /<cy-skeleton\b/, '三页首载都必须有 skeleton')
    assert.match(wxml, /<cy-empty\b/, '三页都必须有真实空态或缺参态')
    assert.match(wxml, /<cy-error\b/, '三页都必须有可恢复错误态')
    assert.match(wxml, /aria-role="(?:status|alert)"/, '原位状态或回执必须可被辅助技术读到')
  })
  assert.match(listWxml, /listRefreshing[\s\S]*listErrorText/)
  assert.match(inviteWxml, /topicsRefreshing[\s\S]*topicsErrorText/)
  assert.match(nearbyWxml, /refreshing[\s\S]*refreshErrorText/)
  assert.match(listWxml, /aria-label="复制合作方电话"/)
  assert.match(inviteWxml, /aria-label="发送协作邀约"/)
  assert.match(nearbyWxml, /aria-label="查看商家详情/)
  assert.match(listWxml, /listErrorText && listState === 'ready'/)
  assert.match(inviteWxml, /topicsErrorText && topicsState === 'ready'/)
  assert.match(inviteWxml, /targetsErrorText && targetsState === 'ready'/)
  // 稿 261:277 按钮视觉高 32px(64rpx),命中区由 ::after 上下各外扩 12rpx 补足 88rpx
  assert.match(listWxss, /\.inv-btn\s*\{[^}]*height:\s*64rpx/)
  assert.match(listWxss, /\.inv-btn::after\s*\{[^}]*top:\s*-12rpx;[^}]*bottom:\s*-12rpx/)
  assert.match(inviteWxss, /\.iv-send\s*\{[^}]*min-height:\s*88rpx/)
  assert.match(inviteWxss, /\.fee-input\s*\{[^}]*height:\s*88rpx/)
  const nearbyCardHeight = /\.card\s*\{[^}]*min-height:\s*(\d+)rpx/.exec(nearbyWxss)
  assert.ok(nearbyCardHeight, '附近商家卡必须声明最小触达高度')
  assert.ok(Number(nearbyCardHeight[1]) >= 88, '附近商家卡点击区不得小于 88rpx')
  assert.match(sharedBtnWxss, /\.btn--sm::after\s*\{[^}]*88rpx/)
})

test('★mutation:删除真实 88rpx 点击区后结构断言会真红', () => {
  const source = read('pages/coop/invite/index.wxss')
  const mutated = source.replace(
    '.iv-send { min-height: 88rpx;',
    '.iv-send { min-height: 64rpx;',
  )
  assert.notEqual(mutated, source, '负控锚点失效:88rpx 不存在')
  assert.throws(() => assert.match(mutated, /\.iv-send\s*\{[^}]*min-height:\s*88rpx/), assert.AssertionError)
})
