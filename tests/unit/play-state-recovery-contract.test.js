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

function loadPage(relative, requireMap = {}) {
  let definition
  const requests = []
  const backs = []
  const relaunches = []
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options) },
  }
  const redirects = []
  const wx = {
    getStorageSync() { return '' },
    setStorageSync() {},
    showToast() {},
    navigateBack(options) { backs.push(options || {}) },
    reLaunch(options) { relaunches.push(options) },
    redirectTo(options) { redirects.push(options && options.url) },
    setClipboardData() {},
    makePhoneCall() {},
  }
  vm.runInNewContext(read(relative), {
    getApp: () => app,
    Page(value) { definition = value },
    require(request) {
      if (requireMap[request]) return requireMap[request]
      throw new Error(`unexpected require: ${request}`)
    },
    wx,
    getCurrentPages: () => [],
    setInterval: () => 1,
    clearInterval() {},
    console,
  }, { filename: relative })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    applyPatch(this.data, patch)
    if (callback) callback()
  }
  return { page, requests, backs, relaunches, redirects }
}

function assertStateComponents(route, wxml, jsonText) {
  const json = JSON.parse(jsonText)
  const components = json.usingComponents || {}
  for (const name of ['cy-skeleton', 'cy-state-shell', 'cy-inline-error']) {
    assert.ok(components[name], `${route} 必须注册 ${name}`)
  }
  assert.match(wxml, /<cy-skeleton\b[^>]*wx:if="\{\{loading && ![^}]+\}\}"/,
    `${route} 首载必须使用同构骨架`)
  assert.match(wxml, /<cy-state-shell\b[^>]*wx:elif="\{\{[^}]+ && ![^}]+\}\}"[^>]*bind:primary="onStateAction"/,
    `${route} 首载错误必须有语义和恢复动作`)
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*errorText && card/,
    `${route} stale/动作失败必须留在内容附近并可重试`)
}

test('圈层探索不再用纯文字 loading 或错误后空白', () => {
  assertStateComponents(
    '圈层探索',
    read('pages/play/circle/index.wxml'),
    read('pages/play/circle/index.json'),
  )
})

test('圈层旧链有主题 id 时转到统一 play，不再在本页找圈层主题码', () => {
  const requireMap = {
    '../utils/circle-theme.js': require('../../pages/play/utils/circle-theme.js'),
    '../../../utils/play-state-contract.js': require(path.join(ROOT, 'utils/play-state-contract.js')),
  }
  const h = loadPage('pages/play/circle/index.js', requireMap)
  h.page.onLoad({ topicId: '31', inviteCode: 'SAFE' })
  assert.equal(h.requests.length, 0)
  assert.equal(h.redirects[0], '/pages/play/index?topicId=31&inviteCode=SAFE')
  assert.notEqual(h.page.data.errorKind, 'missing-param')
})

test('圈层探索缺参不发请求；stale 刷新失败保留卡片与商家', async () => {
  const circleTheme = require('../../pages/play/utils/circle-theme.js')
  // #821 起 circle 页还会 require play-state-contract(回执语义真源),沙箱得放行真实模块
  const requireMap = {
    '../utils/circle-theme.js': circleTheme,
    '../../../utils/play-state-contract.js': require(path.join(ROOT, 'utils/play-state-contract.js')),
  }
  const missing = loadPage('pages/play/circle/index.js', requireMap)
  missing.page.onLoad({})
  assert.equal(missing.page.data.errorKind, 'missing-param')
  assert.equal(missing.requests.length, 0)

  const stale = loadPage('pages/play/circle/index.js', requireMap)
  stale.page._topicId = '31'
  stale.page.data.card = { id: 8, inviteCode: 'SAFE' }
  stale.page.data.offers = [{ offerId: 4, candidateName: '旧商家' }]
  const pending = stale.page.load()
  const duplicate = stale.page.load()
  assert.equal(stale.requests.length, 1, '恢复动作同步连点不能并发创建圈层会话')
  assert.equal(stale.page.data.loading, false)
  assert.equal(stale.page.data.refreshing, true)
  stale.requests[0].fail()
  await Promise.all([pending, duplicate])
  assert.equal(stale.page.data.refreshing, false)
  assert.equal(stale.page.data.errorKind, 'network')
  assert.equal(stale.page.data.card.inviteCode, 'SAFE')
  assert.equal(stale.page.data.offers[0].candidateName, '旧商家')
})

test('圈层选项暴露 radio 语义与可见选中态', () => {
  const wxml = read('pages/play/circle/index.wxml')
  assert.match(wxml, /class="choice \{\{shanghaiDrafts\[[^\]]+\] === keyword \? 'choice-active' : ''\}\}"[^>]*aria-role="radio"[^>]*aria-checked=/)
  assert.match(wxml, /class="choice \{\{answerDrafts\[interaction\.stage\] === choice\.value \? 'choice-active' : ''\}\}"[^>]*aria-role="radio"[^>]*aria-checked=/)
})

test('play 入口必须读 inviteCode 并走与圈层相同的加入接口', () => {
  const playJs = read('pages/play/index.js')
  assert.match(playJs, /options\.inviteCode/)
  assert.match(playJs, /\/api\/circle-theme\/session\/join/)
  assert.match(playJs, /circle_session_/)
})

test('负控:退回纯文字 loading 或摘掉圈层选中语义时必须判红', () => {
  const circle = read('pages/play/circle/index.wxml')
  const noRadio = circle.replace(/ aria-role="radio"/g, '')
  assert.ok(noRadio !== circle, '圈层 radio 负控锚点失效')
  assert.doesNotMatch(noRadio, /aria-role="radio"/)
})
