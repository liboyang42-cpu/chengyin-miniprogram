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
  const navigations = []
  const choices = []
  const guards = { enabled: 0, disabled: 0 }
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
    navigateTo(options) { navigations.push({ type: 'navigateTo', options }) },
    navigateBack(options) { navigations.push({ type: 'navigateBack', options }) },
    redirectTo(options) { navigations.push({ type: 'redirectTo', options }) },
    reLaunch(options) { navigations.push({ type: 'reLaunch', options }) },
    chooseLocation(options) { choices.push(options) },
    showModal() {},
    openSetting() {},
    enableAlertBeforeUnload() { guards.enabled += 1 },
    disableAlertBeforeUnload() { guards.disabled += 1 },
  }

  let definition
  global.Page = config => { definition = config }
  delete require.cache[require.resolve(absolutePath)]
  require(absolutePath)

  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  // 本文件验证的是通过 PROJECT_MANAGE 权限闸后的恢复行为；权限拒绝本身由
  // merchant-citynode-access.test.js 独立覆盖。
  page.data.merchantAccess = { active: true, canManageProjects: true }
  page.data.accessState = 'ready'
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback()
  }

  return {
    page,
    requests,
    toasts,
    navigations,
    choices,
    guards,
    restore() {
      delete require.cache[require.resolve(absolutePath)]
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete global[name]
        else global[name] = value
      }
    },
  }
}

test('配额只接受非负整数，未知态不冒充 0/0 或已达上限', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.loadMine()
    env.requests[0].success({
      code: 200,
      data: { nodes: [], applications: [], used: '1', max: 2 },
    })

    assert.equal(env.page.data.quotaState, 'unknown')
    assert.equal(env.page.data.used, null)
    assert.equal(env.page.data.max, null)

    env.page.goCreate()
    assert.equal(env.navigations.length, 0, '未知配额先恢复读取，不能进入一份注定无法判定的表单')
    assert.doesNotMatch(env.toasts[0].title, /已满/)

    const wxml = read('pages/merchant/citynode/index.wxml')
    assert.match(wxml, /quotaState === 'ready'[\s\S]{0,120}\{\{used\}\}\/\{\{max\}\}/)
    assert.match(wxml, /quotaState === 'unknown'/)
  } finally {
    env.restore()
  }
})

test('合法配额保留 0，且只在已知达到上限时拦投放', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.loadMine()
    env.requests[0].success({
      code: 200,
      data: { nodes: [], applications: [], used: 0, max: 2 },
    })
    assert.equal(env.page.data.quotaState, 'ready')
    assert.equal(env.page.data.used, 0)
    assert.equal(env.page.data.max, 2)

    env.page.goCreate()
    assert.equal(env.navigations[0].options.url, '/pages/merchant/citynode/create/index')

    env.page.setData({ used: 2, max: 2, quotaState: 'ready' })
    env.page.goCreate()
    assert.match(env.toasts[0].title, /已满/)
  } finally {
    env.restore()
  }
})

test('可认领节点把 loading/error/empty 分开，只有合法空数组进入空态', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.loadClaimable()
    assert.equal(env.page.data.claimState, 'loading')
    env.requests[0].success({ code: 200, data: null })
    assert.equal(env.page.data.claimState, 'error')
    assert.ok(env.page.data.claimError)

    env.page.retryClaimable()
    env.requests[1].success({ code: 200, data: [{}] })
    assert.equal(env.page.data.claimState, 'error', '非空畸形数据不能被过滤后冒充业务空态')

    env.page.retryClaimable()
    env.requests[2].success({ code: 200, data: [] })
    assert.equal(env.page.data.claimState, 'ready')
    assert.deepEqual(env.page.data.claimable, [])

    const wxml = read('pages/merchant/citynode/index.wxml')
    assert.match(wxml, /claimState === 'loading'/)
    assert.match(wxml, /claimState === 'error'/)
    assert.match(wxml, /claimState === 'ready' && !claimable\.length/)
    assert.match(wxml, /bind:retry="retryClaimable"/)
  } finally {
    env.restore()
  }
})

test('认领按行 single-flight，失败留在原行并可重试', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.setData({
      showClaim: true,
      claimState: 'ready',
      claimable: [{ id: 66, name: '旧码头', actionState: 'idle', actionError: '' }],
    })
    const event = { currentTarget: { dataset: { poiid: 66 } } }
    env.page.submitClaim(event)
    env.page.submitClaim(event)
    assert.equal(env.requests.length, 1)

    env.requests[0].success({ code: 500, msg: '当前节点暂不可认领' })
    assert.equal(env.page.data.claimable[0].actionState, 'error')
    assert.equal(env.page.data.claimable[0].actionError, '当前节点暂不可认领')
    assert.equal(env.page.data.showClaim, true)

    env.page.retryClaim(event)
    assert.equal(env.requests.length, 2)
  } finally {
    env.restore()
  }
})

test('上下架按行 single-flight，失败留在原行并可重试', () => {
  const env = mountPage('pages/merchant/citynode/index.js')
  try {
    env.page.setData({
      nodes: [{ poiId: 9, name: '外滩据点', status: 1, actionState: 'idle', actionError: '' }],
    })
    const event = { currentTarget: { dataset: { poiid: 9, status: 1 } } }
    env.page.toggleNode(event)
    env.page.toggleNode(event)
    assert.equal(env.requests.length, 1)

    env.requests[0].fail({ errMsg: 'request:fail timeout' })
    assert.equal(env.page.data.nodes[0].actionState, 'error')
    assert.match(env.page.data.nodes[0].actionError, /网络/)

    env.page.retryToggle(event)
    assert.equal(env.requests.length, 2)
  } finally {
    env.restore()
  }
})

test('档案坐标只是候选，确认或地图重选后才允许提交', () => {
  const env = mountPage('pages/merchant/citynode/create/index.js')
  try {
    env.page.setData({ tpl: { id: 9, title: '暗号' } })
    env.page.loadShop()
    env.requests[0].success({
      code: 200,
      data: { name: '山岚咖啡', address: '湖滨路 1 号', locationLat: 30.1, locationLng: 120.2 },
    })
    assert.equal(env.page.data.pickedFromProfile, true)
    assert.equal(env.page.data.addressConfirmed, false)
    assert.equal(env.page.data.canSubmit, false)

    env.page.submitNode()
    assert.equal(env.requests.length, 1)
    assert.match(env.toasts[0].title, /确认店址/)

    env.page.confirmProfileAddress()
    assert.equal(env.page.data.addressConfirmed, true)
    assert.equal(env.page.data.canSubmit, true)

    env.page.repick()
    env.choices[0].success({ latitude: 31.2, longitude: 121.5, name: '新店址', address: '江边路 2 号' })
    assert.equal(env.page.data.addressConfirmed, true)
    assert.equal(env.page.data.pickedFromProfile, false)
  } finally {
    env.restore()
  }
})

test('有未提交草稿时离页由 cy-modal 确认，取消不会丢草稿', () => {
  const env = mountPage('pages/merchant/citynode/create/index.js')
  try {
    env.page.setData({
      picked: { lat: 30.1, lng: 120.2 },
      pickedFromProfile: true,
      addressConfirmed: false,
    })
    env.page.confirmProfileAddress()
    assert.equal(env.page.data.dirty, true)
    assert.ok(env.guards.enabled > 0)

    env.page.onNavBack()
    assert.equal(env.page.data.showLeaveConfirm, true)
    assert.equal(env.navigations.length, 0)

    env.page.cancelLeave()
    assert.equal(env.page.data.showLeaveConfirm, false)
    assert.equal(env.page.data.dirty, true)

    env.page.onNavBack()
    env.page.confirmLeave()
    assert.equal(env.page.data.dirty, false)
    assert.equal(env.navigations[0].type, 'navigateBack')

    const wxml = read('pages/merchant/citynode/create/index.wxml')
    assert.match(wxml, /<cy-modal[\s\S]*show="\{\{showLeaveConfirm\}\}"/)
    assert.match(wxml, /bind:confirm="confirmLeave"/)
    assert.match(wxml, /bind:cancel="cancelLeave"/)
  } finally {
    env.restore()
  }
})

test('提交 single-flight，失败保留草稿和页内重试，成功后只重试回读', () => {
  const env = mountPage('pages/merchant/citynode/create/index.js')
  try {
    const draft = { lat: 30.1, lng: 120.2, name: '山岚咖啡', address: '湖滨路 1 号' }
    env.page.setData({
      tpl: { id: 9, title: '暗号' },
      picked: draft,
      addressConfirmed: true,
      canSubmit: true,
      dirty: true,
    })
    env.page.submitNode()
    env.page.submitNode()
    assert.equal(env.requests.length, 1)

    env.requests[0].fail({ errMsg: 'request:fail timeout' })
    env.requests[0].complete()
    assert.match(env.page.data.submitError, /网络/)
    assert.deepEqual(env.page.data.picked, draft)
    assert.equal(env.page.data.dirty, true)

    env.page.retrySubmit()
    assert.equal(env.requests.length, 2)
    env.requests[1].success({ code: 200, data: 101 })
    env.requests[1].complete()
    assert.equal(env.page.data.dirty, false)
    assert.equal(env.requests.length, 3, '保存成功后必须回读申请状态')

    env.requests[2].fail({ errMsg: 'request:fail timeout' })
    env.requests[2].complete()
    assert.match(env.page.data.readbackError, /状态/)

    env.page.retryReadback()
    assert.equal(env.requests.length, 4)
    assert.equal(env.requests[3].url, '/api/merchant/city-node/list')
    assert.equal(env.requests.filter(item => item.url === '/api/merchant/city-node/save').length, 2)
  } finally {
    env.restore()
  }
})

test('页面复用统一状态、确认与图标组件，不再用字符图标', () => {
  const listJson = JSON.parse(read('pages/merchant/citynode/index.json'))
  const createJson = JSON.parse(read('pages/merchant/citynode/create/index.json'))
  for (const name of ['cy-skeleton', 'cy-error', 'cy-inline-error', 'cy-icon']) {
    assert.ok(listJson.usingComponents[name], `列表页缺少 ${name}`)
  }
  for (const name of ['cy-skeleton', 'cy-inline-error', 'cy-modal', 'cy-icon']) {
    assert.ok(createJson.usingComponents[name], `创建页缺少 ${name}`)
  }

  const markup = `${read('pages/merchant/citynode/index.wxml')}\n${read('pages/merchant/citynode/create/index.wxml')}`
  assert.doesNotMatch(markup, />\+ 投放据点</)
  assert.doesNotMatch(markup, /已配置 ✓|已确认 ✓|取到店打卡码 ›/)
})
