// 隐私授权闸:用户用**系统返回**离开时,等待中的 Promise 必须被结算,不能永远挂住。
//
// 背景:pages/privacy/index 是被 navigateTo 压进来的独立页面(伪弹窗),不是页内组件。
// 页面上「待决策态不给关闭叉号」的强制闸只挡得住叉号 —— 挡不住左滑 / 物理返回键 / 胶囊返回。
// 系统退页既不走 onClose 也不走同意按钮,于是 app._privacyResolvers 里的 resolve
// 一个都不会被调用,那个 Promise 永不 settle,之后所有需要隐私授权的接口静默挂起。
//
// 无报错、无提示 —— 这类 bug 只能靠这种「离开路径必须结算」的断言抓。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const PAGE = path.join(ROOT, 'pages/privacy/index.js')

/** 在受控沙箱里装载隐私页,并给它一个可观察的 app 假体 */
function loadPrivacyPage(source = fs.readFileSync(PAGE, 'utf8')) {
  const sandbox = { resolved: [], pending: true }
  let config = null
  const app = {
    hasPendingPrivacyAuthorization: () => sandbox.pending,
    resolvePrivacyAuthorization: (result) => {
      sandbox.pending = false
      sandbox.resolved.push(result)
    },
    recordConsent: () => Promise.resolve(),
  }
  const wx = {
    navigateBack() {}, switchTab() {}, redirectTo() {}, showToast() {},
    openPrivacyContract() {}, stopLocationUpdate() {},
  }
  // 页面顶层 require utils/toast.js:真模块在只带本沙箱 wx 的上下文里求值,其它 require 一律意外
  const requireStub = (p) => {
    if (vm.isUiModule(p)) return vm.loadUiModule(p, vm.createContext({ wx }))
    throw new Error('unexpected require: ' + p)
  }
  const fn = new Function('Page', 'getApp', 'wx', 'console', 'require', source)
  fn((c) => { config = c }, () => app, wx, console, requireStub)
  assert.ok(config, 'pages/privacy/index 未调用 Page()')
  const page = Object.assign({}, config, {
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.data = Object.assign({}, config.data)
  return { page, sandbox }
}

test('待决策时被系统返回退掉 ⇒ 授权 Promise 必须被结算,不得永久挂起', () => {
  const { page, sandbox } = loadPrivacyPage()
  page.onLoad()
  assert.equal(page.data.pendingAuthorization, true, '前提:确实处在待决策态')

  // 系统返回只会触发 onUnload —— 不经过叉号,也不经过同意按钮
  assert.equal(typeof page.onUnload, 'function', '缺 onUnload ⇒ 系统返回这条路径无人兜底')
  page.onUnload()

  assert.equal(sandbox.resolved.length, 1, '离开授权闸必须结算等待中的 Promise')
  assert.equal(sandbox.resolved[0].event, 'disagree', '没作出同意 ⇒ 只能按不同意结算')
})

test('不在待决策态时退页不产生多余的结算', () => {
  const { page, sandbox } = loadPrivacyPage()
  sandbox.pending = false
  page.onLoad()
  page.onUnload()
  assert.deepEqual(sandbox.resolved, [], '没有等待中的授权就不该结算任何东西')
})

test('负控:拿掉 onUnload 的兜底后,这条契约必须判红', () => {
  const source = fs.readFileSync(PAGE, 'utf8')
  const mutated = source.replace(
    /  onUnload\(\) \{[\s\S]*?\n  \},/,
    '  onUnload() {},'
  )
  assert.notEqual(mutated, source, '变异锚点失效:未找到 onUnload 兜底')

  const { page, sandbox } = loadPrivacyPage(mutated)
  page.onLoad()
  page.onUnload()
  assert.deepEqual(sandbox.resolved, [], '变异体应当什么都不结算')
  assert.throws(
    () => assert.equal(sandbox.resolved.length, 1),
    assert.AssertionError,
    '拿掉兜底后检查器仍判绿 ⇒ 这条断言是橡皮图章'
  )
})
