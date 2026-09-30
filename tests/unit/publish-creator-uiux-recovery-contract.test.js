'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function setPath(target, dotted, value) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts.at(-1)] = value
}

function harness(relativePath, overrides = {}) {
  const requests = []
  const toasts = []
  const modals = []
  const navigations = []
  let definition
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
    sendRequest(options) { requests.push(options) },
    getRequestErrorMessage(res, fallback) { return (res && res.msg) || fallback },
    getUserID() { return 7 },
    getUserRole() { return 'club' },
    getAuthorization() { return 'Bearer test' },
    getUserInfo() { return null },
    getToken() { return '' },
    getPageSize() { return 10 },
    getTotalPage(total, size) { return Math.ceil(total / size) },
    chooseImage() {},
    tips(message) { toasts.push(message) },
  }, overrides.app)
  global.getApp = () => app
  global.Page = (value) => { definition = value }
  global.wx = Object.assign({
    getStorageSync() { return '' },
    setStorageSync() {},
    removeStorageSync() {},
    getSystemInfoSync() { return { windowWidth: 375 } },
    getWindowInfo() { return { windowWidth: 375 } },
    getMenuButtonBoundingClientRect() { return { left: 300, top: 24, width: 87, height: 32 } },
    showToast(options) { toasts.push(options && options.title) },
    showLoading() {},
    hideLoading() {},
    showModal(options) { modals.push(options) },
    navigateBack(options) { navigations.push({ type: 'back', options }) },
    navigateTo(options) { navigations.push({ type: 'navigate', options }) },
    redirectTo(options) { navigations.push({ type: 'redirect', options }) },
    switchTab(options) { navigations.push({ type: 'tab', options }) },
    pageScrollTo() {},
    nextTick(callback) { callback() },
    createMapContext() { return { getCenterLocation() {} } },
  }, overrides.wx)
  const modulePath = path.join(ROOT, relativePath)
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data || {}))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value))
    if (callback) callback()
  }
  return { page, requests, toasts, modals, navigations, app }
}

test('模板引导示例失败可重试、畸形 payload 不冒充空态，创建入口始终可用', () => {
  const h = harness('pages/publish/template-intro/index.js')
  h.page.loadCards()
  const request = h.requests[0]
  assert.equal(request.silentError, true)
  request.success({ code: 200, data: { recommendList: {} } })
  request.complete()
  assert.match(h.page.data.cardsError, /加载失败/)
  assert.equal(h.page.data.cardsLoading, false)

  h.page.loadCards()
  h.requests[1].success({ code: 200, data: { recommendList: [] } })
  h.requests[1].complete()
  assert.equal(h.page.data.cards.length, 0)
  assert.equal(h.page.data.cardsError, '')
})

test('玩法命名页保护未保存名称，跳转失败保留输入并原位重试', () => {
  const h = harness('pages/publish/templateadd/templateadd.js')
  h.page.onInputChange({ detail: { value: ' 老城暗号 ' } })
  h.page.onNavBack()
  assert.equal(h.modals.length, 1)
  assert.match(h.modals[0].title, /放弃/)

  h.page.onCreateTemplate()
  assert.equal(h.page.data.navigating, true)
  const nav = h.navigations.at(-1).options
  assert.match(nav.url, /templateName=%E8%80%81%E5%9F%8E%E6%9A%97%E5%8F%B7$/)
  nav.fail()
  assert.equal(h.page.data.templateName, ' 老城暗号 ')
  assert.equal(h.page.data.navigating, false)
  assert.match(h.page.data.navigationError, /跳转失败/)
  assert.deepEqual(h.toasts, [])
})

test('活动与两类大型编辑器把首载/提交失败做成可见可重试状态', () => {
  const activityJs = read('pages/publish/activity/index.js')
  const activityWxml = read('pages/publish/activity/index.wxml')
  assert.match(activityJs, /accessState:\s*'checking'/)
  assert.match(activityJs, /templateLoadState:\s*'idle'/)
  assert.match(activityJs, /submitError:\s*''/)
  assert.match(activityWxml, /bind:retry="retryAccessCheck"/)
  assert.match(activityWxml, /bind:retry="getTempList"/)
  assert.match(activityWxml, /submitError/)

  const tempJs = read('pages/publish/temp/index.js')
  const tempWxml = read('pages/publish/temp/index.wxml')
  assert.match(tempJs, /editorLoading:\s*false/)
  assert.match(tempJs, /loadError:\s*''/)
  assert.match(tempJs, /submitError:\s*''/)
  assert.match(tempWxml, /bind:retry="retryGetData"/)
  assert.match(tempWxml, /loading="\{\{submitting\}\}"/)
  assert.match(tempWxml, /submitError/)

  const fabuJs = read('pages/publish/fabu/index.js')
  const fabuWxml = read('pages/publish/fabu/index.wxml')
  assert.match(fabuJs, /editLoading:\s*false/)
  assert.match(fabuJs, /editLoadError:\s*''/)
  assert.match(fabuJs, /submitError:\s*''/)
  // 2026-09-05(E2,稿 S15):重试从 cy-error 自带的居中小钮改成**底部整宽**的本页按钮,
  //   cy-error 那颗显式关掉(retry="")。这条契约要守的是「首载失败必须有人能重来」,
  //   不是「那颗按钮一定长在 cy-error 上」—— 所以断言跟着出口走。
  assert.match(fabuWxml, /class="pd-edit-gate__bottom"[\s\S]{0,200}bindtap="retryLoadEditingTopic"/,
    '回填失败必须有一颗接了 retryLoadEditingTopic 的可见重试按钮')
  assert.match(fabuWxml, /submitError/)
})

test('活动发布身份闸必须等权威回包后才放行，本地 club 缓存不能抢跑 ready', () => {
  const h = harness('pages/publish/activity/index.js', {
    app: { getUserRole() { return 'club' } },
  })
  h.page.onLoad({})
  assert.equal(h.page.data.accessState, 'checking')
  assert.equal(h.page._formBootstrapped, undefined)
  assert.equal(h.requests.length, 1, '权威身份确认前不得抢跑表单数据请求')
  assert.equal(h.requests[0].url, '/api/publish/home')

  h.requests[0].fail({})
  assert.equal(h.page.data.accessState, 'error')
  assert.equal(h.page._formBootstrapped, undefined)
  assert.equal(h.requests.length, 1, '身份失败后不得继续拉取发布表单数据')
})

test('发布编辑页销毁时让新增身份、模板与编辑回调全部失效', () => {
  const activityJs = read('pages/publish/activity/index.js')
  const activityUnloadAt = activityJs.indexOf('onUnload()')
  const activityUnload = activityJs.slice(activityUnloadAt, activityJs.indexOf('onNavBack()', activityUnloadAt))
  assert.match(activityUnload, /_accessRequestToken\s*=\s*\(this\._accessRequestToken\s*\|\|\s*0\)\s*\+\s*1/)
  assert.match(activityUnload, /_templateRequestToken\s*=\s*\(this\._templateRequestToken\s*\|\|\s*0\)\s*\+\s*1/)

  const fabuJs = read('pages/publish/fabu/index.js')
  const fabuUnloadAt = fabuJs.indexOf('onUnload()')
  const fabuUnload = fabuJs.slice(fabuUnloadAt, fabuJs.indexOf('// 生成日期列表', fabuUnloadAt))
  assert.match(fabuUnload, /_editLoadToken\s*=\s*\(this\._editLoadToken\s*\|\|\s*0\)\s*\+\s*1/)
})

function assertVisibleRecoveryMarkup(overrides = {}) {
  const templateadd = overrides.templateadd || read('pages/publish/templateadd/templateadd.wxml')
  const intro = overrides.intro || read('pages/publish/template-intro/index.wxml')
  const topicaddJs = overrides.topicaddJs || read('pages/publish/topicadd/topicadd.js')

  assert.match(templateadd, /custom-back bind:back="onNavBack"/)
  assert.match(templateadd, /class="templateadd-footer"/)
  assert.match(templateadd, /navigationError/)
  assert.match(intro, /cardsLoading/)
  assert.match(intro, /cardsError/)
  assert.doesNotMatch(intro, /class="ti-dots"/, '静态圆点会伪装成不存在的轮播交互')
  assert.match(topicaddJs, /wx\.reLaunch\(/)
  assert.match(topicaddJs, /wx\.switchTab\(/)
}

test('创建链路每页都有可见恢复路径、离页保护和可访问操作', () => {
  assertVisibleRecoveryMarkup()
})

test('负控：摘掉模板命名页返回保护或模板引导重试任一项都会判红', () => {
  const templateadd = read('pages/publish/templateadd/templateadd.wxml')
    .replace(' custom-back bind:back="onNavBack"', '')
  assert.throws(() => assertVisibleRecoveryMarkup({ templateadd }), /custom-back/)

  const intro = read('pages/publish/template-intro/index.wxml')
    .replaceAll('cardsError', 'cardsFailureHidden')
  assert.throws(() => assertVisibleRecoveryMarkup({ intro }), /cardsError/)
})
