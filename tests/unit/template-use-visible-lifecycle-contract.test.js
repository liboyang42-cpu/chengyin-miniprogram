'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const SOURCE = fs.readFileSync(path.join(ROOT, 'pages/template/index.js'), 'utf8')

function loadPage() {
  let definition
  let nextTimerId = 1
  const requests = []
  const navigations = []
  const toasts = []
  const timers = new Map()
  const cleared = new Set()
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: {} },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options) },
  }

  vm.runInNewContext(SOURCE, {
    console,
    getApp: () => app,
    Page(value) { definition = value },
    require(request) {
      // 页面 onShow 要读「减少动态效果」偏好(utils/motion-preference.js),沙箱得给它这个模块;
      // 它自己会 guard 全局 wx,Node 侧取不到存储 ⇒ 与真机默认一致(动态效果开)。
      if (request === '../../utils/motion-preference.js') return require(path.join(ROOT, 'utils/motion-preference.js'))
      if (request === '../../utils/font-scale.js') return { readPageStyle: () => '' }
      if (request === '../../utils/mockData.js') return {}
      if (request === '../../utils/identity/identity-policy.js') return { isMerchantView: () => false }
      if (request === '../../utils/merchant-theme.js') return { merchantPageRestore() {}, merchantPageShow() {} }
      if (request === '../../utils/merchant-access-policy.js') {
        return {
          inactiveAccess: () => ({ active: false, canManageProjects: false }),
          normalizeMerchantAccess: (value) => value || { active: false, canManageProjects: false },
        }
      }
      if (request === '../../utils/circle-theme.js') return { PRIMARY_THEME_CODES: [], themeOf: () => null }
      if (request === '../../utils/analytics.js') return { track() {} }
      if (request === '../../utils/template-display.js') {
        return { formatDurationMinutes: () => '', ratingPercent: () => 0, formatRating: () => '' }
      }
      if (request === '../../utils/response-shape.js') {
        return { isRecord: (value) => !!value && typeof value === 'object', isRecordList: Array.isArray }
      }
      throw new Error(`unexpected require: ${request}`)
    },
    setTimeout(callback) {
      const id = nextTimerId++
      timers.set(id, callback)
      return id
    },
    clearTimeout(id) { cleared.add(id) },
    wx: {
      showToast(options) { toasts.push(options.title) },
      navigateTo(options) { navigations.push(options.url) },
    },
  }, { filename: 'pages/template/index.js' })

  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch) {
    Object.assign(this.data, patch)
  }

  return {
    page,
    requests,
    navigations,
    toasts,
    runLiveTimers() {
      for (const [id, callback] of timers) {
        if (!cleared.has(id)) callback()
      }
    },
  }
}

// CU-M-116:分类横幅原本写 `top[0] || tail[0]` —— 本分类零命中时从**别的分类**借一张挂上
// 「<分类名> · 精选」,把不属于这个分类的内容说成这个分类的精选;并且选了分类后 top[0]
// 既当横幅又留在列表里,同一张卡同屏两遍。
test('CU-M-116 分类横幅只认本分类命中项,并与列表去重', () => {
  const page = loadPage().page
  page.data.tab = 'game'
  page.data.home.categoryList = [{ id: 7, categoryName: '解谜互动' }, { id: 9, categoryName: '店内探索' }]
  const inCat = { id: 101, _title: '今晚的暗号', _cats: '7' }
  const other = { id: 202, _title: '风味巡游', _cats: '9' }

  // ① 本分类有命中:横幅取命中的首项,列表不再重复它
  page.data.activeCat = 7
  page._gameRows = [other, inCat]
  page.rebuildLists()
  assert.equal(page.data.banner.id, 101)
  assert.equal(page.data.bannerTitle, '解谜互动 · 精选')
  assert.equal(page.data.topList.length, 0)
  assert.equal(page.data.tailList.length, 1)
  assert.equal(page.data.tailList[0].id, 202)

  // ② 本分类零命中:横幅不许借别的分类那张,内容仍走「其他模板」
  page._gameRows = [other]
  page.rebuildLists()
  assert.notEqual(page.data.banner.id, 202)
  assert.equal(page.data.banner.id, undefined)
  assert.equal(page.data.tailList.length, 1)
  assert.equal(page.data.tailList[0].id, 202)

  // ③ 不选分类(推荐):横幅仍取全量首项,列表照样去重
  page.data.activeCat = 0
  page._gameRows = [other, inCat]
  page.rebuildLists()
  assert.equal(page.data.banner.id, 202)
  assert.equal(page.data.topList.length, 1)
  assert.equal(page.data.topList[0].id, 101)
  assert.equal(page.data.tailList.length, 0)
})

test('复制模板的 pending 重入守卫必须阻止重复提交并在完成后释放', () => {  const h = loadPage()
  const event = { currentTarget: { dataset: { item: { id: 23, name: '城市夜行' } } } }

  h.page.useTt(event)
  h.page.useTt(event)

  assert.equal(h.requests.length, 1)

  h.requests[0].complete()
  h.page.useTt(event)
  assert.equal(h.requests.length, 2, '请求完成后必须释放重入守卫,允许下一次真实操作')
})

test('复制模板 pending 必须全局拦住第二个不同模板，不能只防同一张卡', () => {
  const h = loadPage()
  const first = { currentTarget: { dataset: { item: { id: 23, name: '城市夜行' } } } }
  const second = { currentTarget: { dataset: { item: { id: 24, name: '街角漫游' } } } }

  h.page.useTt(first)
  h.page.useTt(second)
  assert.equal(h.requests.length, 1, '任一复制请求在途时,第二个模板也不得重复提交')

  h.requests[0].fail({ msg: '复制失败' })
  h.requests[0].complete()
  h.page.useTt(second)
  assert.equal(h.requests.length, 2, '失败完成后必须释放重入守卫')
})

test('复制请求或成功跳转在页面卸载后到达时不得写页或把用户拉走', () => {
  const h = loadPage()
  const event = { currentTarget: { dataset: { item: { id: 23, name: '城市夜行' } } } }
  h.page.useTt(event)
  const request = h.requests[0]

  request.success({ code: 200 })
  h.page.onUnload()
  request.complete()
  h.runLiveTimers()

  assert.deepEqual(h.navigations, [])

  const late = loadPage()
  late.page.useTt(event)
  late.page.onUnload()
  late.requests[0].success({ code: 200 })
  late.requests[0].fail({ msg: '迟到失败' })
  late.requests[0].complete()
  late.runLiveTimers()

  assert.deepEqual(late.navigations, [])
  assert.deepEqual(late.toasts, [])
})
