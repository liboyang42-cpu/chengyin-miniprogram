'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function applyPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.')
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]]
    cursor[parts.at(-1)] = value
  })
}

function loadPage() {
  let definition
  const requests = []
  const toasts = []
  const backs = []
  const timers = []
  const clearedTimers = new Set()
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 7,
    tips() {},
    chooseImage() {},
    sendRequest(options) { requests.push(options) },
  }
  vm.runInNewContext(read('pages/gerenziliao/gerenziliao.js'), {
    getApp: () => app,
    // 有上一页:全页返回合同(#806)按 getCurrentPages().length 选 navigateBack 还是根栈落点
    getCurrentPages: () => [{}, {}],
    Page(value) { definition = value },
    require(request) {
      if (request === '../../utils/response-shape.js') return require('../../utils/response-shape.js')
      if (request === '../../utils/form-state.js') return require('../../utils/form-state.js')
      throw new Error(`unexpected require: ${request}`)
    },
    wx: {
      hideLoading() {},
      showLoading() {},
      showToast(options) { toasts.push(options) },
      navigateBack(options) { backs.push(options || {}) },
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length },
    clearTimeout(id) { clearedTimers.add(id) },
    console,
  }, { filename: 'pages/gerenziliao/gerenziliao.js' })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    applyPatch(this.data, patch)
    if (callback) callback()
  }
  return { page, requests, toasts, backs, timers, clearedTimers }
}

function assertStateContract(wxml, jsonText) {
  const json = JSON.parse(jsonText)
  const components = json.usingComponents || {}
  for (const name of ['cy-skeleton', 'cy-state-shell', 'cy-inline-error', 'cy-progress-status']) {
    assert.ok(components[name], `个人资料页必须注册 ${name}`)
  }
  assert.match(wxml, /<cy-skeleton\b[^>]*wx:if="\{\{loading && !loaded\}\}"[^>]*type="form-section"/,
    '首载不能先把未知资料渲染成“未填写”')
  assert.match(wxml, /<cy-state-shell\b[^>]*wx:elif="\{\{loadError && !loaded\}\}"[^>]*kind="\{\{loadErrorKind\}\}"[^>]*bind:primary="retryLoad"/,
    '首载失败必须有语义状态与恢复动作')
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*loadError/,
    '刷新失败必须保留最后确认的资料并局部重试')
  assert.match(wxml, /<cy-progress-status\b[^>]*wx:if="\{\{saving \|\| saveSucceeded\}\}"/,
    '保存中与成功必须留下可读进度/回执')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{saveError\}\}"[^>]*bind:action="saveInfo"/,
    '保存失败必须在表单内留下重试入口')
  assert.match(wxml, /<cy-btn\b[^>]*loading="\{\{saving\}\}"[^>]*disabled="\{\{!canSave \|\| saving\}\}"[^>]*bindtap="saveInfo"/,
    '保存按钮必须绑定 pending 与防重入状态')
}

test('个人资料首载、stale 刷新和保存回执采用统一状态组件', () => {
  assertStateContract(
    read('pages/gerenziliao/gerenziliao.wxml'),
    read('pages/gerenziliao/gerenziliao.json'),
  )
})

test('个人资料未知值不会伪装为空；失败可重试且保留最后确认内容', () => {
  const first = loadPage()
  assert.equal(first.page.data.loading, true)
  assert.equal(first.page.data.loaded, false)
  first.page.getUserData()
  first.page.getUserData()
  assert.equal(first.requests.length, 1, '资料恢复动作同步连点不能并发请求并产生乱序覆盖')
  first.requests[0].fail()
  assert.equal(first.page.data.loading, false)
  assert.equal(first.page.data.loaded, false)
  assert.equal(first.page.data.loadErrorKind, 'network')
  first.page.retryLoad()
  assert.equal(first.requests.length, 2)

  const stale = loadPage()
  stale.page.data.loaded = true
  stale.page.data.userInfo.name = '已确认昵称'
  stale.page.getUserData()
  assert.equal(stale.page.data.refreshing, true)
  stale.requests[0].success({ code: 500, msg: '服务繁忙' })
  assert.equal(stale.page.data.refreshing, false)
  assert.equal(stale.page.data.userInfo.name, '已确认昵称')
  assert.equal(stale.page.data.loadErrorKind, 'data')
})

test('保存防重复提交；失败保留草稿，成功留下回执再返回', () => {
  const h = loadPage()
  h.page.data.loaded = true
  h.page.data.canSave = true
  h.page.data.userInfo.name = '城市玩家'
  h.page.data.userInfo.introduction = '夜行路线'
  h.page.saveInfo()
  h.page.saveInfo()
  assert.equal(h.requests.length, 1)
  assert.equal(h.page.data.saving, true)
  h.requests[0].fail()
  assert.equal(h.page.data.saving, false)
  assert.match(h.page.data.saveError, /网络/)
  assert.equal(h.page.data.userInfo.introduction, '夜行路线')

  h.page.saveInfo()
  h.requests[1].success({ code: 200 })
  assert.equal(h.page.data.saving, false)
  assert.equal(h.page.data.saveSucceeded, true)
  assert.equal(h.page.data.saveError, '')
  assert.equal(h.timers.length, 1)
  h.timers[0].callback()
  assert.equal(h.backs.length, 1)
})

test('个人资料保存成功后主动离页会取消延迟返回，不能从下一页再多退一层', () => {
  const h = loadPage()
  Object.assign(h.page.data, {
    loaded: true,
    canSave: true,
    userInfo: Object.assign({}, h.page.data.userInfo, { name: '城市玩家' }),
  })
  h.page.saveInfo()
  h.requests[0].success({ code: 200 })
  assert.equal(h.timers.length, 1)

  h.page.onUnload()
  h.timers.forEach((timer, index) => {
    if (!h.clearedTimers.has(index + 1)) timer.callback()
  })

  assert.deepEqual(h.backs, [])
})

test('个人资料页卸载后，迟到的资料请求不得再改写已离开的页面', () => {
  const h = loadPage()
  h.page.getUserData()
  const request = h.requests[0]
  h.page.onUnload()
  let postUnloadWrites = 0
  const originalSetData = h.page.setData
  h.page.setData = function (patch, callback) {
    postUnloadWrites += 1
    originalSetData.call(this, patch, callback)
  }

  request.success({ code: 200, data: { name: '迟到资料' } })
  request.fail({ msg: '迟到失败' })

  assert.equal(postUnloadWrites, 0)
})

test('个人资料页卸载后，迟到的保存回执不得再展示成功或安排返回', () => {
  const h = loadPage()
  Object.assign(h.page.data, {
    loaded: true,
    canSave: true,
    userInfo: Object.assign({}, h.page.data.userInfo, { name: '城市玩家' }),
  })
  h.page.saveInfo()
  const request = h.requests[0]
  h.page.onUnload()
  let postUnloadWrites = 0
  const originalSetData = h.page.setData
  h.page.setData = function (patch, callback) {
    postUnloadWrites += 1
    originalSetData.call(this, patch, callback)
  }

  request.success({ code: 200 })
  request.fail({ msg: '迟到失败' })

  assert.equal(postUnloadWrites, 0)
  assert.deepEqual(h.toasts, [])
  assert.deepEqual(h.timers, [])
})

test('负控:去掉首载骨架或保存 pending 接线时状态契约必须判红', () => {
  const source = read('pages/gerenziliao/gerenziliao.wxml')
  const json = read('pages/gerenziliao/gerenziliao.json')
  const noSkeleton = source.replace(/<cy-skeleton\b[^>]*\/>/, '<view wx:if="{{loading}}">加载中</view>')
  assert.ok(noSkeleton !== source, '首载骨架负控锚点失效')
  assert.throws(() => assertStateContract(noSkeleton, json), /首载不能/)

  const noPending = source.replace(' loading="{{saving}}"', '')
  assert.ok(noPending !== source, '保存 pending 负控锚点失效')
  assert.throws(() => assertStateContract(noPending, json), /保存按钮/)
})
