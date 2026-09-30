// R9-22(P1):经营团队「进入工作台」按钮无效。
//
// 审查复现(第九轮 R9-22):核销员从个人页「经营团队」进入,点「进入工作台」不动,
// 原生诊断返回 switchTab:fail can not switch to no-tabBar page
// (pages/merchant/index/index 不在 app.json tabBar 里)。
//
// 契约:跳工作台必须用商家域的统一导航方式(reLaunch,与 components/tabBar 及
// relation/index「返回工作台」同口径),且落点是真实注册页面、成为根页面(无错误返回栈);
// 不允许再用 switchTab 打非 tabBar 页。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const WORKBENCH = '/pages/merchant/index/index'

function loadTeamPage(options) {
  const navigations = []
  const requests = []
  let config
  const state = Object.assign({ memberId: 42 }, options || {})
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => state.memberId,
    getRequestErrorMessage: (_res, fallback) => fallback,
    getSessionManager: () => ({
      ensureSession: () => {
        if (!state.memberId) state.memberId = 42
        return Promise.resolve({ ok: true })
      },
    }),
    sendRequest(request) { requests.push(request); return { abort() {} } },
    tips: () => {},
  })
  global.Page = value => { config = value }
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateTo(options) { navigations.push({ method: 'navigateTo', url: options.url }) },
    redirectTo(options) { navigations.push({ method: 'redirectTo', url: options.url }) },
    reLaunch(options) { navigations.push({ method: 'reLaunch', url: options.url }) },
    switchTab(options) { navigations.push({ method: 'switchTab', url: options.url }) },
    navigateBack() {},
    showToast() {},
    setNavigationBarColor() {},
  }
  const absolute = path.join(ROOT, 'pages/merchant/team/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = patch => Object.assign(page.data, patch)
  return { page, navigations, requests, state }
}

function registeredRoutes(appJson) {
  const routes = new Set(appJson.pages || [])
  for (const sub of appJson.subPackages || []) {
    const root = String(sub.root || '').replace(/\/$/, '')
    for (const page of sub.pages || []) routes.add(root + '/' + page)
  }
  return routes
}

test('RED 锚点:进入工作台不得用 switchTab 打开非 tabBar 页', () => {
  const { page, navigations } = loadTeamPage()
  page.goWorkbench()
  assert.equal(navigations.length, 1)
  assert.notEqual(navigations[0].method, 'switchTab', 'switchTab 对非 tabBar 页必然原生失败')
  assert.deepEqual(navigations[0], { method: 'reLaunch', url: WORKBENCH })
})

test('工作台落点真实注册,且 reLaunch 使其成为根页(无错误返回栈)', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const routes = registeredRoutes(appJson)
  assert.ok(routes.has(WORKBENCH.slice(1)), '工作台必须在 app.json 注册')
  const tabBar = new Set((appJson.tabBar && appJson.tabBar.list || []).map(item => '/' + item.pagePath))
  assert.ok(!tabBar.has(WORKBENCH), '工作台不在 tabBar 中,所以只能 reLaunch/redirectTo,不能 switchTab')

  const { page, navigations } = loadTeamPage()
  page.goWorkbench()
  assert.equal(navigations[0].method, 'reLaunch', 'reLaunch 清掉经营团队页,工作台成为根页,返回栈不残留半截')
})

test('未登录不再摆「去登录」整屏闸:静默登录后自动确认身份', async () => {
  const { page, navigations, requests, state } = loadTeamPage({ memberId: '' })
  page.onLoad({})
  page.onShow()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(state.memberId, 42, '必须先静默登录再拉身份')
  assert.equal(requests[0].url, '/api/merchant/access/me')
  assert.deepEqual(navigations, [], '正常团队账号不得被整屏闸赶去会员中心')
})

function assertNoTeamGate(wxml) {
  assert.doesNotMatch(wxml, /登录后处理团队邀请|去登录|goLogin|还没有经营团队身份/, '整屏身份闸必须删除')
}

test('无经营团队身份的深链账号静默 switchTab 回会员中心,不弹整屏页', () => {
  const { page, navigations, requests } = loadTeamPage()
  page.onLoad({})
  page.onShow()
  requests[0].success({
    code: 200,
    data: { active: false, applicationState: 'NONE', permissions: [], merchant: null },
  })
  assert.deepEqual(navigations, [{ method: 'switchTab', url: '/pages/member/index/index' }])
  assertNoTeamGate(fs.readFileSync(path.join(ROOT, 'pages/merchant/team/index.wxml'), 'utf8'))
})

test('负控:把「登录后处理团队邀请」整屏闸加回必须判红', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/team/index.wxml'), 'utf8')
  const mutated = wxml.replace(
    '<scroll-view wx:else class="tm-scroll"',
    '<view class="tm-state" wx:elif="{{accessState === \'anonymous\'}}"><cy-empty title="登录后处理团队邀请" cta="去登录" bind:cta="goLogin" /></view>\n  <scroll-view wx:else class="tm-scroll"',
  )
  assert.notEqual(mutated, wxml, '负控锚点失效')
  assert.throws(() => assertNoTeamGate(mutated), /整屏身份闸必须删除/)
})
