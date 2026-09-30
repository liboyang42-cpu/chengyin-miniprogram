'use strict'

// 2026-09-15 收款模型定稿 §3:平台不打款,个人余额「提现」一律改为弹平台客服微信号线下处理。
// 本契约钉住三件事:
//   ① 6 个提现入口点击后都打开同一个客服弹窗,且不发 /api/withdrawal/create;
//   ② 弹窗正文/按钮文案与复制行为(复制的是常量里的号,不是别的);
//   ③ 微信号全仓只有 utils/withdraw-cs.js 一处字面量。
// 负控:把任一入口改回旧逻辑(不弹客服、回到提现请求/跳转)必须判红。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const WITHDRAW_CS_PATH = 'utils/withdraw-cs.js'
const { flattenComponentToPage } = require('../helpers/component-as-page')

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** 从方法定义处(带缩进锚,避开 this.foo() 这类调用)做花括号配对,取出单个方法的正文。 */
function methodBody(source, signature) {
  const start = source.search(signature)
  assert.ok(start >= 0, `找不到方法定义: ${signature}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`花括号不配对: ${signature}`)
}

// —— 弹窗真源沙箱:modal / toast 换成记录桩,只测它自己发了什么 ——
function loadWithdrawCs(source = read(WITHDRAW_CS_PATH)) {
  const file = path.join(ROOT, WITHDRAW_CS_PATH)
  const calls = { modals: [], clipboard: [], toasts: [], clipboardFails: false }
  const sandbox = {
    module: { exports: {} },
    console,
    require(request) {
      if (request === './modal.js') return { show(options) { calls.modals.push(options) } }
      if (request === './toast.js') {
        const toast = (title) => { calls.toasts.push(title) }
        toast.success = (title) => { calls.toasts.push(title) }
        return toast
      }
      return createRequire(file)(request)
    },
    wx: {
      setClipboardData(options) {
        calls.clipboard.push(options && options.data)
        if (calls.clipboardFails) {
          if (options.fail) options.fail({ errMsg: 'setClipboardData:fail' })
        } else if (options.success) options.success({})
      },
    },
  }
  vm.runInNewContext(source, sandbox, { filename: file })
  return { api: sandbox.module.exports, calls }
}

// —— 6 个入口的落点:handler + 驱动方式 ——
const ENTRIES = [
  {
    id: '资产中心→账户收益的「提现」',
    file: 'subpackageA/pages/assetcenter/earnings/index.js',
    signature: /^  openWithdrawSheet\(\)/m,
    drive(page) { page.openScene({ detail: { id: 'member-withdraw' } }) },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /txSheet\.show':\s*true/],
  },
  {
    id: '独立提现页「确认提现」',
    file: 'subpackageMember/tixian/tixian.js',
    signature: /^  saveData: function\(\)/m,
    drive(page) { page.saveData() },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/],
  },
  {
    id: '商家提现页「前往银行卡提现」',
    file: 'pages/coop/withdraw/index.js',
    signature: /^  goBankWithdraw\(\)/m,
    drive(page) { page.goBankWithdraw() },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /subpackageMember\/tixian/],
  },
  {
    id: '俱乐部结算页「提现到银行卡」',
    file: 'pages/club/settlement/index.js',
    signature: /^  goWithdraw\(\)/m,
    // CU-C-92:可提现 >0 才放行(余额由 cy-funds-stages 经 bind:stages 回报);零余额不弹见 club-settlement 自己的用例
    drive(page) { page.data.withdrawState = 'positive'; page.goWithdraw() },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /pages\/coop\/withdraw/],
  },
  {
    id: '商家分润明细「提现到银行卡」',
    file: 'components/cy/scene-merchant-profit/index.js',
    signature: /^    goWithdraw\(\)/m,
    drive(page) { page.data.canWithdraw = true; page.goWithdraw() },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/, /subpackageMember\/tixian/],
  },
  {
    id: '场景表单「确认提现」',
    file: 'components/cy/scene-route-content/index.js',
    signature: /^    submitForm\(\)/m,
    drive(page) {
      page.data.sceneId = 'member-withdraw'
      page.data.submitting = false
      page.data.form = {
        withdrawalAmount: '10.00', balance: 100, realname: '测试用户',
        bankName: '测试银行', bankAccount: '6222020000000000',
        mobilephone: '13800138000', consented: true,
      }
      page.submitForm()
    },
    forbidden: [/\/api\/withdrawal\/create/, /submitBankWithdrawal/],
  },
]

function loadEntry(relPath, source = read(relPath)) {
  const absolutePath = path.join(ROOT, relPath)
  const popups = []
  const requests = []
  const navigations = []
  const modals = []
  let definition = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getPageSize: () => 20,
    getUserID: () => 1,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options) },
    tips() {},
    recordConsent() { return Promise.resolve({}) },
  }
  const wx = {
    getStorageSync: () => null,
    setStorageSync() {},
    removeStorageSync() {},
    showLoading() {},
    hideLoading() {},
    showToast() {},
    showModal(options) { modals.push(options) },
    navigateTo(options) { navigations.push(options && options.url) },
    redirectTo(options) { navigations.push(options && options.url) },
    reLaunch(options) { navigations.push(options && options.url) },
    navigateBack() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
    setClipboardData() {},
  }
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    getCurrentPages: () => [{ selectComponent: () => null }],
    Page: (config) => { definition = config },
    Component: (config) => { definition = flattenComponentToPage(config) },
    require(request) {
      if (request.endsWith('utils/withdraw-cs.js')) {
        return { showWithdrawCsPopup() { popups.push(true) }, WITHDRAW_CS_WECHAT_ID: 'stub-not-real' }
      }
      if (request.endsWith('utils/analytics.js')) return { track() {} }
      if (request.endsWith('utils/roleGuard.js')) return { can: () => true, load(callback) { callback() } }
      if (request.endsWith('utils/merchant-theme.js')) return { merchantPageShow() {}, merchantPageRestore() {} }
      if (request.endsWith('subpackageA/utils/withdrawal-preflight.js')) {
        return {
          submitBankWithdrawal(appArg, wxArg, data, handlers) {
            requests.push({ url: '/api/withdrawal/create' })
            if (handlers && handlers.success) handlers.success({ code: 200, data: { id: 1 } })
          },
        }
      }
      return createRequire(absolutePath)(request)
    },
    setTimeout() { return 0 },
    clearTimeout() {},
    wx,
  }, { filename: absolutePath })

  assert.ok(definition, `${relPath} 必须注册 Page/Component`)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let cursor = page.data
      parts.slice(0, -1).forEach((part) => {
        if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
        cursor = cursor[part]
      })
      cursor[parts[parts.length - 1]] = value
    })
    if (typeof callback === 'function') callback()
  }
  page.triggerEvent = () => {}
  page.selectComponent = () => null
  return { page, popups, requests, navigations, modals }
}

function assertEntryOpensPopup(entry, source = read(entry.file)) {
  const body = stripComments(methodBody(source, entry.signature))
  assert.match(body, /withdrawCs\.showWithdrawCsPopup\(\)/, `${entry.id}: 必须点击后打开平台客服弹窗`)
  entry.forbidden.forEach((pattern) => {
    assert.doesNotMatch(body, pattern, `${entry.id}: 退役后不得再回归旧提现链路 ${pattern}`)
  })
}

test('弹窗合同:标题/正文/两枚按钮并排(返回左次级 · 复制右主),微信号来自常量', () => {
  const { api, calls } = loadWithdrawCs()
  api.showWithdrawCsPopup()
  assert.equal(calls.modals.length, 1, '必须弹一次')
  const opts = calls.modals[0]
  assert.equal(opts.title, '联系平台客服提现')
  assert.equal(opts.cancelText, '返回')
  assert.equal(opts.confirmText, '复制')
  assert.ok(opts.content.includes(api.WITHDRAW_CS_WECHAT_ID), '正文必须显示微信号')
  assert.ok(opts.content.includes(api.WITHDRAW_CS_TIP), '正文必须带线下处理说明')
  assert.equal(opts.showCancel, undefined, '走 cy-modal 默认显示取消键(返回),不额外加第三枚按钮')
})

test('复制:确认键复制的是常量微信号并 toast「已复制微信号」,返回键不复制', () => {
  const { api, calls } = loadWithdrawCs()
  api.showWithdrawCsPopup()
  calls.modals[0].success({ confirm: false, cancel: true })
  assert.deepEqual(calls.clipboard, [], '点「返回」不得写剪贴板')

  api.showWithdrawCsPopup()
  calls.modals[1].success({ confirm: true })
  assert.deepEqual(calls.clipboard, [api.WITHDRAW_CS_WECHAT_ID], '复制参数必须就是常量微信号')
  assert.deepEqual(calls.toasts, ['已复制微信号'])
})

test('复制失败:toast 提示手动添加,不把微信号塞进 toast(会被安全过滤吞掉)', () => {
  const { api, calls } = loadWithdrawCs()
  calls.clipboardFails = true
  api.showWithdrawCsPopup()
  calls.modals[0].success({ confirm: true })
  assert.deepEqual(calls.toasts, ['复制失败，请手动添加客服微信'])
})

test('微信号全仓唯一来源:只有 utils/withdraw-cs.js 含字面量,且只出现一次', () => {
  const { api } = loadWithdrawCs()
  const id = api.WITHDRAW_CS_WECHAT_ID
  assert.match(id, /^\d{8,}$/, '常量必须是真实微信号形态')
  assert.equal(read(WITHDRAW_CS_PATH).split(id).length - 1, 1, '常量文件里应恰好声明一次')

  const hits = []
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((item) => {
      if (item.name === 'node_modules' || item.name === 'miniprogram_npm') return
      const full = path.join(dir, item.name)
      if (item.isDirectory()) { walk(full); return }
      if (!/\.(js|wxml|wxss|json)$/.test(item.name)) return
      const count = fs.readFileSync(full, 'utf8').split(id).length - 1
      if (count) hits.push([path.relative(ROOT, full), count])
    })
  }
  walk(ROOT)
  assert.deepEqual(hits, [[WITHDRAW_CS_PATH, 1]], `微信号字面量只许出现在 ${WITHDRAW_CS_PATH}`)
})

ENTRIES.forEach((entry) => {
  test(`${entry.id}: 点击只弹客服微信,不发提现请求、不再进银行卡链路`, () => {
    assertEntryOpensPopup(entry)
    const runtime = loadEntry(entry.file)
    entry.drive(runtime.page)
    assert.equal(runtime.popups.length, 1, '必须打开客服弹窗')
    assert.deepEqual(runtime.requests, [], '不得再发 /api/withdrawal/create 或任何请求')
    assert.deepEqual(runtime.navigations, [], '不得再跳银行卡表单/独立提现页')
    // ⚠️ 这里**不能**断言 runtime.modals 为空:loadEntry 把 utils/withdraw-cs.js 整体替成了桩,
    //    唯一可能调 wx.showModal 的 modal.js 回落压根不进沙箱,那样的断言恒真、永远不会红。
    //    「不走原生弹窗旁路」由 modal.show 的唯一出口 + 各宿主页挂 cy-modal-host 保证
    //    (宿主挂载由 sheet/modal 相关既有契约钉住)。
  })
})

// 负控:6 个入口逐个退回旧链路(跳银行卡表单)都必须判红 —— 只钉两个入口时,
// 另外四个的正向断言没有「能变红」的证据,等于没有门禁。
ENTRIES.forEach((entry) => {
  test(`负控:${entry.id} 退回旧提现链路时必须判红`, () => {
    const source = read(entry.file)
    const broken = source.replace(
      /withdrawCs\.showWithdrawCsPopup\(\)/,
      "wx.navigateTo({ url: '/subpackageMember/tixian/tixian' })",
    )
    assert.notEqual(broken, source, `负控锚点失效:${entry.id} 没有走客服弹窗`)
    assert.throws(() => assertEntryOpensPopup(entry, broken), assert.AssertionError)
  })
})
