'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertInviteQrLifecycle({ js, json, wxml, wxss }) {
  const components = JSON.parse(json).usingComponents || {}
  assert.equal(components['cy-progress-status'], '/components/cy/progress-status/index')
  assert.equal(components['cy-error'], '/components/cy/error/index')
  assert.equal(components['cy-empty'], '/components/cy/empty/index')

  assert.match(js, /qrState:\s*'empty'/)
  assert.match(js, /onQrLoad\s*\(/)
  assert.match(js, /onQrError\s*\(/)
  assert.match(js, /retryQr\s*\(/)
  assert.match(wxml, /qrState === 'loading'[\s\S]*?<cy-progress-status\b/)
  assert.match(wxml, /<image\b[^>]*bindload="onQrLoad"[^>]*binderror="onQrError"/)
  assert.match(wxml, /qrState === 'error'[\s\S]*?<cy-error\b[^>]*bind:retry="retryQr"/)
  assert.match(wxml, /<cy-empty\b[^>]*二维码暂时不可用/)
  assert.doesNotMatch(wxml, /siv__home-indicator/)
  assert.doesNotMatch(wxss, /\.siv__home-indicator\b/)
}

test('邀请二维码区分加载、成功、失败和未提供，并移除无功能的 CSS home indicator', () => {
  assertInviteQrLifecycle({
    js: read('components/cy/scene-share-invite/index.js'),
    json: read('components/cy/scene-share-invite/index.json'),
    wxml: read('components/cy/scene-share-invite/index.wxml'),
    wxss: read('components/cy/scene-share-invite/index.wxss'),
  })
})

test('negative control：摘掉二维码失败回调会被生命周期契约判红', () => {
  const source = {
    js: read('components/cy/scene-share-invite/index.js'),
    json: read('components/cy/scene-share-invite/index.json'),
    wxml: read('components/cy/scene-share-invite/index.wxml'),
    wxss: read('components/cy/scene-share-invite/index.wxss'),
  }
  const mutated = { ...source, wxml: source.wxml.replace(' binderror="onQrError"', '') }
  assert.notEqual(mutated.wxml, source.wxml, '变异锚点必须真实摘掉 binderror')
  assert.throws(() => assertInviteQrLifecycle(mutated), /binderror="onQrError"/)
})

function loadUserInfoPage(wx, pages = []) {
  let definition
  vm.runInNewContext(read('pages/userinfo/userinfo.js'), {
    Page(value) { definition = value },
    wx,
    getCurrentPages() { return pages },
  })
  return definition
}

test('公开主页缺少用户 ID 时显示真实参数空态，并提供可执行的返回出口', () => {
  const json = JSON.parse(read('pages/userinfo/userinfo.json'))
  const wxml = read('pages/userinfo/userinfo.wxml')
  const calls = []
  const page = loadUserInfoPage({
    navigateBack(options) { calls.push(['navigateBack', options]) },
    switchTab(options) { calls.push(['switchTab', options]) },
  })
  const context = {
    data: { ...page.data },
    setData(patch) { Object.assign(this.data, patch) },
  }

  page.onLoad.call(context, {})

  assert.equal(context.data.missingUser, true)
  assert.equal(context.data.userId, '')
  assert.equal(json.usingComponents['cy-empty'], '/components/cy/empty/index')
  assert.equal(json.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index')
  assert.match(wxml, /<cy-profile\b[^>]*wx:if="\{\{!missingUser\}\}"/)
  assert.match(wxml, /<cy-empty\b[^>]*kind="missing-param"[^>]*bind:cta="goMemberHome"/)
  assert.match(wxml, /<cy-nav-bar\b[^>]*custom-back[^>]*bind:back="onBack"/)

  page.goMemberHome.call(context)
  assert.deepEqual(calls.map(([api, options]) => [api, options.url]), [
    ['switchTab', '/pages/member/index/index'],
  ])
})

function loadMerchantProfilePage(wx) {
  let definition
  vm.runInNewContext(read('pages/merchant/profile/index.js'), {
    Page(value) { definition = value },
    wx,
    getCurrentPages() { return [] },
    getApp() {
      return {
        globalData: { statusBarHeight: 20, navBarHeight: 44 },
        sendRequest() {},
      }
    },
    require(request) {
      if (request.endsWith('merchant-theme.js')) return { merchantPageShow() {}, merchantPageRestore() {} }
      if (request.endsWith('merchant-home-link.js')) return { merchantHomeUrl() { return '/pages/userinfo/userinfo?userId=1&tab=about' } }
      throw new Error(`unexpected dependency: ${request}`)
    },
  })
  return definition
}

test('旧商家深链壳的返回箭头在冷启动也有落点，文字出口具备按钮语义和 88rpx 热区', () => {
  const wxml = read('pages/merchant/profile/index.wxml')
  const wxss = read('pages/merchant/profile/index.wxss')
  const calls = []
  const page = loadMerchantProfilePage({
    navigateBack(options) { calls.push(['navigateBack', options]) },
    switchTab(options) { calls.push(['switchTab', options]) },
  })
  const context = { ...page, data: { ...page.data, canBack: false } }

  assert.match(wxml, /<cy-nav-bar\b[^>]*custom-back[^>]*bind:back="onBack"/)
  assert.match(wxml, /class="pr-exit"[^>]*bindtap="goHome"[^>]*aria-role="button"[^>]*aria-label="回首页"/)
  assert.match(wxml, /class="pr-exit"[^>]*bindtap="goBack"[^>]*aria-role="button"[^>]*aria-label="返回上一页"/)
  assert.match(wxss, /\.pr-exit\s*\{[\s\S]*?min-height:\s*88rpx/)

  page.onBack.call(context)
  context.data.canBack = true
  page.onBack.call(context)
  assert.deepEqual(calls.map(([api, options]) => [api, options.url || options.delta]), [
    ['switchTab', '/pages/index/index'],
    ['navigateBack', 1],
  ])
})

test('足迹卡生成使用共享进度状态，返回动作具备按钮语义和 88rpx 热区', () => {
  const json = JSON.parse(read('subpackageRoam/session/index.json'))
  const wxml = read('subpackageRoam/session/index.wxml')
  const wxss = read('subpackageRoam/session/index.wxss')
  const tokens = read('style/tokens.wxss')

  assert.equal(json.usingComponents['cy-progress-status'], '/components/cy/progress-status/index')
  assert.match(wxml, /share\.drawing[\s\S]*?<cy-progress-status\b[^>]*title="正在生成足迹卡"/)
  assert.doesNotMatch(wxml, /class="ss-share-loading"[^>]*>\s*正在生成/)
  assert.match(wxml, /class="ss-share-back"[^>]*bindtap="closeShare"[^>]*aria-role="button"[^>]*aria-label="返回本次漫游"/)
  assert.match(wxss, /\.ss-share-back\s*\{[^}]*min-height:\s*var\(--cy-btn-h\)/)
  assert.match(tokens, /--cy-btn-h:\s*88rpx/)
})

test('五个可冷启动直达页面的导航箭头都接入安全出口', () => {
  const cases = [
    ['subpackageMember/mycanyuinfo/mycanyuinfo.wxml', 'backToList'],
    ['subpackageMember/tixianjilu/tixianjilu.wxml', 'onClose'],
    ['pages/coop/finance/index.wxml', 'goBack'],
    ['subpackageMember/order/order.wxml', 'goBack'],
    ['subpackageA/pages/assetcenter/income-detail/income-detail.wxml', 'goBack'],
  ]
  cases.forEach(([file, handler]) => {
    assert.match(
      read(file),
      new RegExp(`<cy-nav-bar\\b[^>]*custom-back[^>]*bind:back="${handler}"`),
      `${file}: 深链冷启动的返回箭头不得是死控件`,
    )
  })
  assert.match(
    read('pages/coop/finance/index.js'),
    /goBack\(\)\s*\{[\s\S]*?wx\.navigateBack\([\s\S]*?fail[\s\S]*?wx\.redirectTo\(\{\s*url:\s*'\/subpackageA\/pages\/assetcenter\/earnings\/index'/,
  )
  assert.match(
    read('subpackageMember/order/order.js'),
    /goBack\(\)\s*\{[\s\S]*?wx\.navigateBack\([\s\S]*?fail[\s\S]*?wx\.switchTab\(\{\s*url:\s*'\/pages\/member\/index\/index'/,
  )
  assert.match(
    read('subpackageA/pages/assetcenter/income-detail/income-detail.js'),
    /goBack\(\)\s*\{[\s\S]*?wx\.navigateBack\([\s\S]*?fail[\s\S]*?wx\.redirectTo\(\{\s*url:\s*'\/subpackageA\/pages\/assetcenter\/earnings\/index'/,
  )
})
