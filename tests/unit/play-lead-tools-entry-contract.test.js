'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_JS = path.join(ROOT, 'pages/play/index.js')
const PAGE_WXML = path.join(ROOT, 'pages/play/index.wxml')
const GROUP_CODE_JS = path.join(ROOT, 'components/cy/scene-qr-group-code/index.js')

const LEAD_TOOL_HANDLERS = [
  'leadVerifyMemberTicketFromTools',
  'leadShowGroupCodeFromTools',
  'leadUnlockFromTools',
  'leadSettleFromTools',
]

function parseAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([:\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  )
}

function leadToolRows(wxml) {
  // 抽屉 2026-09-09 换成 scroll-view(到屏底内部滚动),锚点跟着走
  const toolsStart = wxml.indexOf('<scroll-view class="tools"')
  assert.notEqual(toolsStart, -1, '游玩工具抽屉必须存在')
  return [...wxml.slice(toolsStart).matchAll(/<view class="drow"[^>]*>/g)]
    .map((match) => parseAttributes(match[0]))
    .filter((attrs) => LEAD_TOOL_HANDLERS.includes(attrs.bindtap))
}

function evaluateVisibility(expression, lead) {
  const body = expression.replace(/^\{\{/, '').replace(/\}\}$/, '')
  return Boolean(Function('lead', `return (${body})`)(lead))
}

function assertLeadToolWiring(wxml) {
  const rows = leadToolRows(wxml)
  assert.deepEqual(rows.map((row) => row.bindtap).sort(), LEAD_TOOL_HANDLERS.slice().sort())
  for (const row of rows) {
    assert.equal(evaluateVisibility(row['wx:if'], { exists: false, isLeader: true }), false)
    assert.equal(evaluateVisibility(row['wx:if'], { exists: true, isLeader: false }), false)
    assert.equal(evaluateVisibility(row['wx:if'], { exists: true, isLeader: true }), true)
  }
}

function loadPage() {
  const original = { getApp: global.getApp, Page: global.Page, wx: global.wx }
  let definition
  const requests = []
  const platform = {
    scans: [], modals: [], loadings: [], hiddenLoadings: 0, toasts: [],
    scanCode(options) { this.scans.push(options) },
    showModal(options) { this.modals.push(options) },
    showLoading(options) { this.loadings.push(options) },
    hideLoading() { this.hiddenLoadings += 1 },
    showToast(options) { this.toasts.push(options) },
  }
  const app = {
    sendRequest(options) { requests.push(options) },
  }
  global.getApp = () => app
  global.Page = (value) => { definition = value }
  global.wx = platform
  delete require.cache[require.resolve(PAGE_JS)]
  require(PAGE_JS)
  delete require.cache[require.resolve(PAGE_JS)]
  global.getApp = original.getApp
  global.Page = original.Page
  global.wx = platform
  return { definition, requests, platform, restore: () => { global.wx = original.wx } }
}

function createPageContext(definition, lead = { exists: true, isLeader: true }) {
  const context = {
    ...definition,
    data: { ...definition.data, activityId: '7', lead, sessionToolsOpen: true },
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => {
        if (!key.includes('.')) this.data[key] = value
      })
      if (callback) callback()
    },
  }
  return context
}

function loadGroupCodeComponent() {
  const original = { getApp: global.getApp, Component: global.Component }
  let definition
  const requests = []
  const events = []
  global.getApp = () => ({ sendRequest(options) { requests.push(options) } })
  global.Component = (value) => { definition = value }
  delete require.cache[require.resolve(GROUP_CODE_JS)]
  require(GROUP_CODE_JS)
  delete require.cache[require.resolve(GROUP_CODE_JS)]
  global.getApp = original.getApp
  global.Component = original.Component
  const data = { ...definition.data, activityId: '7', topicId: '', name: '本场' }
  const context = {
    ...definition.methods,
    data,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name) { events.push(name) },
  }
  return { context, requests, events }
}

function settlePromiseQueue() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('领队四工具在既有抽屉完成接线，且可见性由真实领队态共同决定', () => {
  assertLeadToolWiring(fs.readFileSync(PAGE_WXML, 'utf8'))
})

test('负控：移除任一工具 bindtap 时接线契约必须判红', () => {
  const source = fs.readFileSync(PAGE_WXML, 'utf8')
  const mutated = source.replace(` bindtap="${LEAD_TOOL_HANDLERS[0]}"`, '')
  assert.notEqual(mutated, source, '负控锚点失效')
  assert.throws(() => assertLeadToolWiring(mutated), assert.AssertionError)
})

test('负控：入口对非领队或非带队场次可见时权限契约必须判红', () => {
  const source = fs.readFileSync(PAGE_WXML, 'utf8')
  const mutated = source.replace(/wx:if="\{\{lead\.exists && lead\.isLeader\}\}"/, 'wx:if="{{true}}"')
  assert.notEqual(mutated, source, '负控锚点失效')
  assert.throws(() => assertLeadToolWiring(mutated), assert.AssertionError)
})

test('非领队直接调用四个核心方法也不会触发扫码、弹窗、场景或请求', () => {
  const harness = loadPage()
  try {
    const context = createPageContext(harness.definition, { exists: true, isLeader: false })
    context.openScene = () => { throw new Error('非领队不得打开团码场景') }
    context.leadVerifyMemberTicket()
    context.leadShowGroupCode()
    context.leadUnlock()
    context.leadSettle()
    assert.equal(harness.platform.scans.length, 0)
    assert.equal(harness.platform.modals.length, 0)
    assert.equal(harness.requests.length, 0)
  } finally {
    harness.restore()
  }
})

test('扫成员票的等待、成功、失败与取消都产生可观察反馈', async () => {
  const harness = loadPage()
  try {
    const context = createPageContext(harness.definition)
    context.leadVerifyMemberTicket()
    harness.platform.scans.pop().fail({ errMsg: 'scanCode:fail cancel' })
    assert.equal(harness.platform.toasts.length, 1)

    context.leadVerifyMemberTicket()
    harness.platform.scans.pop().success({ result: 'v1.900.topic.1999999999999.7.signature' })
    assert.equal(harness.platform.loadings.length, 1)
    harness.requests.pop().success({ code: 200 })
    await settlePromiseQueue()
    assert.equal(harness.platform.hiddenLoadings, 1)
    assert.equal(harness.platform.toasts.length, 2)

    context.leadVerifyMemberTicket()
    harness.platform.scans.pop().success({ result: 'v1.900.topic.1999999999999.7.signature' })
    harness.requests.pop().fail()
    await settlePromiseQueue()
    assert.equal(harness.platform.hiddenLoadings, 2)
    assert.equal(harness.platform.toasts.length, 3)
  } finally {
    harness.restore()
  }
})

test('整团码场景以状态变化覆盖等待、成功、失败与关闭取消', () => {
  const failed = loadGroupCodeComponent()
  failed.context.start('7', '')
  assert.equal(failed.context.data.state, 'loading')
  failed.requests.pop().fail()
  assert.equal(failed.context.data.state, 'error')

  // CU-C-01:团码只能扫,回包没有二维码图 = 没出成码,不得把长令牌当文字铺在码区
  const noImage = loadGroupCodeComponent()
  noImage.context.start('7', '')
  noImage.requests.pop().success({ code: 200, data: { code: 'group-code', ttlMs: 300000 } })
  assert.equal(noImage.context.data.state, 'error')
  noImage.context.clearTimer()

  const succeeded = loadGroupCodeComponent()
  succeeded.context.start('7', '')
  succeeded.requests.pop().success({ code: 200, data: { code: 'group-code', qrcodeUrl: 'https://img/qr.png', ttlMs: 300000 } })
  assert.equal(succeeded.context.data.state, 'ready')
  succeeded.context.close()
  assert.equal(succeeded.events.length, 1)
  succeeded.context.clearTimer()
})

test('解锁下一章节的等待、成功、失败与取消都产生可观察反馈', async () => {
  const harness = loadPage()
  try {
    const context = createPageContext(harness.definition)
    let progressLoads = 0
    context.loadTeamProgress = () => { progressLoads += 1 }
    context.leadUnlock()
    harness.platform.modals.pop().success({ confirm: false })
    assert.equal(harness.platform.toasts.length, 1)

    context.leadUnlock()
    harness.platform.modals.pop().success({ confirm: true })
    assert.equal(harness.platform.loadings.length, 1)
    harness.requests.pop().success({ code: 200 })
    await settlePromiseQueue()
    assert.equal(harness.platform.hiddenLoadings, 1)
    assert.equal(harness.platform.toasts.length, 2)
    assert.equal(progressLoads, 1)

    context.leadUnlock()
    harness.platform.modals.pop().success({ confirm: true })
    harness.requests.pop().success({ code: 500 })
    await settlePromiseQueue()
    assert.equal(harness.platform.hiddenLoadings, 2)
    assert.equal(harness.platform.toasts.length, 3)
    assert.equal(progressLoads, 1)

    context.leadUnlock()
    harness.platform.modals.pop().success({ confirm: true })
    harness.requests.pop().fail()
    await settlePromiseQueue()
    assert.equal(harness.platform.hiddenLoadings, 3)
    assert.equal(harness.platform.toasts.length, 4)
    assert.equal(progressLoads, 1)
  } finally {
    harness.restore()
  }
})

test('整团结算的等待、成功、失败与取消都产生可观察反馈', async () => {
  const harness = loadPage()
  try {
    const context = createPageContext(harness.definition)
    context.loadTeamProgress = () => {}
    context.leadSettle()
    harness.platform.modals.pop().success({ confirm: false })
    assert.equal(harness.platform.toasts.length, 1)

    context.leadSettle()
    harness.platform.modals.pop().success({ confirm: true })
    assert.equal(harness.platform.loadings.length, 1)
    harness.requests.pop().success({ code: 200 })
    await settlePromiseQueue()
    assert.equal(harness.platform.hiddenLoadings, 1)
    assert.equal(harness.platform.toasts.length, 2)

    context.leadSettle()
    harness.platform.modals.pop().success({ confirm: true })
    harness.requests.pop().fail()
    await settlePromiseQueue()
    assert.equal(harness.platform.hiddenLoadings, 2)
    assert.equal(harness.platform.toasts.length, 3)
  } finally {
    harness.restore()
  }
})
