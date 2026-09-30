const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function declarations(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少样式块 ${selector}`)
  return Object.fromEntries(match[1].split(';').map((line) => line.trim()).filter(Boolean).map((line) => {
    const splitAt = line.indexOf(':')
    return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()]
  }))
}

function directRpx(value, label) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)rpx$/)
  assert.ok(match, `${label} 必须落到可测量的 rpx，收到 ${value}`)
  return Number(match[1])
}

function mountPage(relativePath, wxOverrides = {}) {
  const redirects = []
  let definition
  const wx = Object.assign({
    redirectTo(options) { redirects.push(options) },
    navigateBack() {},
    switchTab() {},
  }, wxOverrides)
  vm.runInNewContext(read(relativePath), {
    getApp: () => ({ globalData: { statusBarHeight: 44, navBarHeight: 44 } }),
    getCurrentPages: () => [{}, {}],
    Page(config) { definition = config },
    wx,
  }, { filename: relativePath })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callback.call(this)
    },
  })
  return { page, redirects }
}

// 2026-09-09 用户裁决整页删除「探店日质量证据」(pages/club/edition-report),
// 它的四条合同随页一并撤走。团码那几条与本页无关,原样留下。

function mountGroupCodePage(source = read('pages/club/group-code/index.js')) {
  const requests = []
  const redirects = []
  let definition
  const app = {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    sendRequest(options) { requests.push(options) },
  }
  vm.runInNewContext(source, {
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(config) { definition = config },
    require(request) {
      if (request === '../../../utils/group-code-session.js') {
        return require(path.join(ROOT, 'utils/group-code-session.js'))
      }
      if (request === '../../../utils/response-shape.js') {
        return require(path.join(ROOT, 'utils/response-shape.js'))
      }
      throw new Error(`unexpected require: ${request}`)
    },
    setInterval() { return 1 },
    clearInterval() {},
    wx: {
      navigateBack() {},
      switchTab(options) { redirects.push(options) },
      redirectTo(options) { redirects.push(options) },
      reLaunch(options) { redirects.push(options) },
    },
  }, { filename: 'pages/club/group-code/index.js' })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callback.call(this)
    },
  })
  return { page, requests, redirects }
}

function assertOldGroupCodeIgnored(source) {
  const harness = mountGroupCodePage(source)
  harness.page.onLoad({ activityId: '11', activityName: '上午场' })
  assert.equal(harness.requests.length, 1)

  harness.page.setData({ activityId: 22, title: '下午场' })
  harness.page.issue()
  assert.equal(harness.requests.length, 2)

  harness.requests[0].success({ code: '200', data: { code: 'OLD-CODE', qrcodeUrl: 'OLD-QR', ttlMs: 300000 } })
  assert.equal(harness.page.data.state, 'loading', '旧场次回包不得提前结束新场次 loading')
  // 2026-09-03 出码换成 cy-club-game-code-sheet 后,码号不再上屏(稿 335:1275 只画二维码图),
  //   页面也就不再存 data.code。真正会串到界面的是 qrcodeUrl —— 断言跟着那个走,
  //   钉一个已经不存在的字段只会恒等于 undefined,变成永远不会红的空断言。
  assert.equal(harness.page.data.qrcodeUrl, '', '旧场次的码图不得串到当前页面')

  harness.requests[1].success({ code: '200', data: { code: 'NEW-CODE', qrcodeUrl: 'NEW-QR', ttlMs: 300000 } })
  assert.equal(harness.page.data.state, 'ready')
  assert.equal(harness.page.data.qrcodeUrl, 'NEW-QR')
}

test('workbench 跳转失败退出 loading，持久提供原目标重试与返回', () => {
  const harness = mountPage('pages/club/workbench/index.js')
  harness.page.onLoad({ id: 'club-7' })

  assert.equal(harness.redirects.length, 1)
  assert.match(harness.redirects[0].url, /id=club-7/)
  assert.equal(typeof harness.redirects[0].fail, 'function', 'redirectTo 必须消费失败回调')
  harness.redirects[0].fail({ errMsg: 'redirectTo:fail' })
  assert.equal(harness.page.data.state, 'error', '失败后不能永久停在 loading')
  assert.ok(harness.page.data.errorText, '失败原因必须留在页面状态中')

  harness.page.retryRedirect()
  assert.equal(harness.redirects.length, 2, '重试必须重新发起跳转')
  assert.equal(harness.redirects[1].url, harness.redirects[0].url, '重试必须沿用同一管理目标')

  const view = read('pages/club/workbench/index.wxml')
  const config = JSON.parse(read('pages/club/workbench/index.json'))
  assert.equal(config.usingComponents['cy-skeleton'], '/components/cy/skeleton/index')
  assert.equal(config.usingComponents['cy-error'], '/components/cy/error/index')
  assert.equal(config.usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.match(view, /<cy-skeleton\b[^>]*wx:if="\{\{state === 'loading'\}\}"/)
  assert.match(view, /<cy-error\b[^>]*wx:elif="\{\{state === 'error'\}\}"[^>]*bind:retry="retryRedirect"/)
  assert.match(view, /bindtap="onBack"[^>]*aria-role="button"/)
  assert.match(view, /<cy-icon\b[^>]*name="back"/)
})

// 2026-08-25：工时自报整块退役，本页只剩证据提交。
// 「期次没就绪不得提交」这条保证一字未变，只是可提交的路径从两条变成一条。
test('团码缺参只提供返回与管理入口，不渲染无效出码重试', () => {
  const harness = mountGroupCodePage()
  harness.page.onLoad({})
  assert.equal(harness.page.data.state, 'invalid')
  assert.equal(harness.requests.length, 0)
  harness.page.onRetry()
  assert.equal(harness.requests.length, 0, 'invalid 状态不得被隐藏的 retry 重新发起无参请求')

  const view = read('pages/club/group-code/index.wxml')
  const config = JSON.parse(read('pages/club/group-code/index.json'))
  assert.equal(config.usingComponents['cy-error'], '/components/cy/error/index')
  assert.equal(config.usingComponents['cy-icon'], '/components/cy/icon/index')
  // 钉的是「缺参块紧跟一个 wx:else 出码块」这个结构,不钉具体组件名 ——
  // 2026-09-03 出码从 cy-qr-voucher 换成 cy-club-game-code-sheet(稿改成 T1 底部弹层
  // 并加了打印用的保存入口),原来写死元素名的正则当场失配。互斥关系一字未变。
  const invalid = view.match(/<view wx:elif="\{\{state === 'invalid'\}\}"[\s\S]*?<\/view>\s*(?:<!--[\s\S]*?-->\s*)*<cy-[\w-]+\s+wx:else/)
  assert.ok(invalid, '缺参终态必须与出码块互斥(wx:elif 之后紧跟 wx:else)')
  assert.match(view, /<cy-nav-bar\b[^>]*custom-back[^>]*bind:back="onClose"/)
  assert.match(invalid[0], /<cy-error\b[^>]*retry=""/)
  assert.match(invalid[0], /bindtap="goManage"/)
  assert.doesNotMatch(invalid[0], /bind:retry="onRetry"/)
  assert.doesNotMatch(view, />\s*›\s*</, '场次进入提示必须复用 cy-icon，不能画文本箭头')
})

test('团码出码使用 epoch，旧请求回包不能覆盖新场次码', () => {
  assertOldGroupCodeIgnored(read('pages/club/group-code/index.js'))
})

test('negative control：摘掉出码成功回调的 epoch 守卫必须判红', () => {
  const source = read('pages/club/group-code/index.js')
  const mutated = source.replace('        if (epoch !== that._requestEpoch) return;\n', '')
  assert.notEqual(mutated, source, '负控锚点失效：出码成功回调缺少 epoch 守卫')
  assert.throws(() => assertOldGroupCodeIgnored(mutated), assert.AssertionError)
})
