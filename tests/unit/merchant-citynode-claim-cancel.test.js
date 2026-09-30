'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function mountPage(relativePath) {
  const absolutePath = path.join(ROOT, relativePath)
  const previous = {
    Page: global.Page,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx,
  }
  const requests = []
  const toasts = []
  const app = {
    globalData: { navBarHeight: 44 },
    getRequestErrorMessage(res, fallback) {
      return (res && res.msg) || fallback
    },
    sendRequest(options) { requests.push(options) },
  }
  global.getApp = () => app
  global.getCurrentPages = () => [{ route: 'merchant' }, { route: 'citynode' }]
  global.wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    setNavigationBarColor() {},
    setBackgroundColor() {},
    showToast(options) { toasts.push(options) },
    navigateTo() {},
    navigateBack() {},
    redirectTo() {},
    reLaunch() {},
    openSetting() {},
  }

  let definition
  global.Page = config => { definition = config }
  delete require.cache[require.resolve(absolutePath)]
  require(absolutePath)

  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.data.merchantAccess = { active: true, canManageProjects: true, canVerify: true }
  page.data.accessState = 'ready'
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback()
  }

  return {
    page,
    requests,
    toasts,
    restore() {
      delete require.cache[require.resolve(absolutePath)]
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete global[name]
        else global[name] = value
      }
    },
  }
}

/**
 * 渲染层契约:撤回入口必须画在待审认领行上(不是只存在 data 里的一个布尔)。
 * 负控断言写在用例里 —— 抽掉按钮或换掉端点,这里必须判红。
 */
function assertClaimCancelSurface(js, wxml) {
  assert.match(js, /url: '\/api\/merchant\/city-node\/claim\/cancel'/, '撤回必须走认领撤回端点')
  assert.match(
    wxml,
    /wx:if="\{\{item\.applicationType === 2 && item\.auditStatus === 0 && merchantAccess\.canManageProjects\}\}"[\s\S]{0,200}bindtap="cancelClaim"/,
    '待审认领行必须渲染撤回入口'
  )
  assert.match(wxml, /bind:action="retryCancel"/, '撤回失败必须给页内重试')
}

test('待审认领行撤回走认领撤回端点且按行 single-flight', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.setData({
      applications: [{ id: 600, applicationType: 2, auditStatus: 0, displayName: '旧码头', actionState: 'idle', actionError: '' }],
    })
    const event = { currentTarget: { dataset: { poiid: 600 } } }
    env.page.cancelClaim(event)
    env.page.cancelClaim(event)

    assert.equal(env.requests.length, 1, '撤回期间再点不得重发')
    assert.equal(env.requests[0].url, '/api/merchant/city-node/claim/cancel')
    assert.equal(env.requests[0].data.poiId, 600)
    assert.equal(env.page.data.applications[0].actionState, 'loading')
  } finally {
    env.restore()
  }
})

test('撤回成功后作废认领缓存并回读申请列表', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.setData({
      applications: [{ id: 600, applicationType: 2, auditStatus: 0, displayName: '旧码头', actionState: 'idle', actionError: '' }],
      claimState: 'ready',
      claimable: [{ id: 600, name: '旧码头', actionState: 'idle', actionError: '' }],
    })
    env.page.cancelClaim({ currentTarget: { dataset: { poiid: 600 } } })
    env.requests[0].success({ code: 200, data: 600 })

    assert.equal(env.page.data.claimState, 'idle', '节点回到可认领池，缓存必须作废')
    assert.deepEqual(env.page.data.claimable, [])
    assert.ok(env.requests.some(item => item.url === '/api/merchant/city-node/list'), '撤回成功后必须回读')
  } finally {
    env.restore()
  }
})

test('撤回失败留在原行并可重试；已通过或投放行不出现撤回请求', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.setData({
      applications: [
        { id: 600, applicationType: 2, auditStatus: 0, displayName: '旧码头', actionState: 'idle', actionError: '' },
        { id: 601, applicationType: 2, auditStatus: 1, displayName: '已通过节点', actionState: 'idle', actionError: '' },
        { id: 101, applicationType: 1, auditStatus: 0, displayName: '投放中的据点', actionState: 'idle', actionError: '' },
      ],
    })
    const event = { currentTarget: { dataset: { poiid: 600 } } }
    env.page.cancelClaim(event)
    env.requests[0].success({ code: 500, msg: '该认领申请已不可撤回，请刷新后重试' })

    assert.equal(env.page.data.applications[0].actionState, 'error')
    assert.equal(env.page.data.applications[0].actionError, '该认领申请已不可撤回，请刷新后重试')

    env.page.retryCancel(event)
    assert.equal(env.requests.length, 2)
    env.requests[1].fail({ errMsg: 'request:fail timeout' })
    assert.match(env.page.data.applications[0].actionError, /网络/)

    env.page.cancelClaim({ currentTarget: { dataset: { poiid: 601 } } })
    env.page.cancelClaim({ currentTarget: { dataset: { poiid: 101 } } })
    assert.equal(env.requests.length, 2, '非待审认领行不得发撤回请求')
  } finally {
    env.restore()
  }
})

test('渲染层负控：抽掉撤回按钮或换掉端点必红', () => {
  const js = read('pages/merchant/citynode/index.js')
  const wxml = read('pages/merchant/citynode/index.wxml')
  assertClaimCancelSurface(js, wxml)

  const anchor = 'wx:if="{{item.applicationType === 2 && item.auditStatus === 0 && merchantAccess.canManageProjects}}"'
  const unrendered = wxml.replace(anchor, 'wx:if="{{false}}"')
  assert.notEqual(unrendered, wxml, '负控锚点失效：撤回按钮条件已不在 wxml')
  assert.throws(() => assertClaimCancelSurface(js, unrendered), /渲染撤回入口/)

  const rerouted = js.replace("url: '/api/merchant/city-node/claim/cancel'", "url: '/api/merchant/city-node/offline'")
  assert.notEqual(rerouted, js, '负控锚点失效：撤回端点已不在 js')
  assert.throws(() => assertClaimCancelSurface(rerouted, wxml), /认领撤回端点/)
})
