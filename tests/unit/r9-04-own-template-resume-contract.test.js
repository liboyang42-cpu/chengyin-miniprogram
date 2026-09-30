// R9-04(P1):自己的模板详情无法继续应用。
//
// 审查复现(第九轮 R9-04):玩家 9004 从「我的模板」进入 6029 详情(scope=my)可读,
// 点「开始应用」后显示「模版不存在」——详情页跳转丢失 scope=my,编辑页
// (pages/publish/temp)用公共模板接口 /api/template/info 查个人草稿 ID。
//
// 契约:
//   · 详情页 goPrimary 必须把 scope=my 带到底;
//   · publish/temp 在 scope=my 时走 /api/template/myinfo(owner 可读草稿),其余仍走
//     /api/template/info;
//   · scope=my 不污染写链路身份:operationScope 仍只认 MERCHANT,草稿保存仍带原 id 续编。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const DETAIL_PAGE = '../../pages/templatedetail/templatedetail.js'
const TEMP_PAGE = '../../pages/publish/temp/index.js'

let appStub
let pageConfig
let navigations
let requests

function installGlobals() {
  appStub = {
    globalData: { nickname: '玩家9004', statusBarHeight: 20, navBarHeight: 44 },
    getUserRole: () => 'player',
    getUserType: () => 1,
    getUserID: () => 9004,
    getAuthorization: () => 'Bearer test',
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest: (options) => { requests.push(options); return { abort() {} } },
    chooseImage: () => {},
    chooseDocument: () => {},
    tips: () => {},
  }
  global.getApp = () => appStub
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    showToast: () => {},
    hideLoading: () => {},
    showLoading: () => {},
    nextTick: (cb) => cb(),
    navigateTo(options) { navigations.push({ method: 'navigateTo', url: options.url }) },
    redirectTo(options) { navigations.push({ method: 'redirectTo', url: options.url }) },
    navigateBack() {},
    reLaunch() {},
    createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }) }),
  }
}

function loadPage(relative) {
  let config
  global.Page = (value) => { config = value }
  const absolute = require('node:path').resolve(__dirname, '../../', relative)
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let cursor = this.data
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (cursor[parts[i]] == null) cursor[parts[i]] = {}
        cursor = cursor[parts[i]]
      }
      cursor[parts[parts.length - 1]] = patch[key]
    })
    if (callback) callback()
  }
  return page
}

function templateRequest() {
  return requests.filter((item) => /\/api\/template\/(info|myinfo)$/.test(String(item.url)))[0]
}

beforeEach(() => {
  requests = []
  navigations = []
  installGlobals()
})

test('RED 锚点:scope=my 的详情开始应用必须把 scope 带进编辑页', () => {
  const page = loadPage('pages/templatedetail/templatedetail.js')
  page.data.id = 6029
  page.data.scope = 'my'
  page.data.isMyScope = true

  page.goPrimary()

  assert.deepEqual(navigations, [{
    method: 'navigateTo',
    url: '/pages/publish/temp/index?id=6029&scope=my',
  }])
})

test('公共库模板的应用跳转保持原样(不额外塞 scope)', () => {
  const page = loadPage('pages/templatedetail/templatedetail.js')
  page.data.id = 12
  page.data.scope = 'library'

  page.goPrimary()

  assert.deepEqual(navigations, [{
    method: 'navigateTo',
    url: '/pages/publish/temp/index?id=12',
  }])
})

test('RED 锚点:编辑页带 scope=my 时查个人草稿接口,不再查公共库', () => {
  const page = loadPage('pages/publish/temp/index.js')
  page.onLoad({ id: '6029', scope: 'my' })

  const request = templateRequest()
  assert.ok(request, 'onLoad 必须发起模板详情请求')
  assert.equal(request.url, '/api/template/myinfo')
  assert.equal(request.data.id, 6029)
})

test('公共库应用仍查 /api/template/info,不受 my 分支影响', () => {
  const page = loadPage('pages/publish/temp/index.js')
  page.onLoad({ id: '12' })
  assert.equal(templateRequest().url, '/api/template/info')

  const merchant = loadPage('pages/publish/temp/index.js')
  merchant.onLoad({ id: '12', scope: 'MERCHANT' })
  assert.equal(templateRequest().url, '/api/template/info')
})

test('scope=my 不污染写链路身份:operationScope 仍只认 MERCHANT', () => {
  const page = loadPage('pages/publish/temp/index.js')
  page.onLoad({ id: '6029', scope: 'my' })
  assert.equal(page.data.operationScope, '')

  const merchant = loadPage('pages/publish/temp/index.js')
  merchant.onLoad({ id: '12', scope: 'MERCHANT' })
  assert.equal(merchant.data.operationScope, 'MERCHANT')
})

test('续编:个人草稿保存草稿时仍带原 id 走 /api/template/draft', () => {
  const page = loadPage('pages/publish/temp/index.js')
  page.onLoad({ id: '6029', scope: 'my' })
  page.data.formData.title = '我的草稿'
  page.validateForm = () => true

  page.saveDraft()

  const draft = requests.filter((item) => item.url === '/api/template/draft')[0]
  assert.ok(draft, '必须发起保存草稿请求')
  const body = JSON.parse(draft.data)
  assert.equal(body.id, 6029, '续编必须更新原草稿而不是另建一份')
  assert.equal(body.scope, '')
})
