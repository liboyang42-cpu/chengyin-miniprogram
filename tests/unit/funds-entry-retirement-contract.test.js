'use strict'

// 2026-09-15 收款模型定稿 §3:平台不打款,三处资金写入口(独立提现页 / 账户收益 sheet /
// scene-route 的 member-withdraw 场景表单)不再建提现单,一律弹平台客服微信线下处理。
// 原「三入口校验一致性 / requestId / 单独同意建单」那一族契约随写入口一起退役 —— 它们守的
// 行为已不存在,留着只会让「三个入口还在建单」这个假事实常驻。本文件只保留两件仍成立的事:
//   ① 俱乐部分润站内入口 → 我的资产宿主的场景栈导航(与提现表单无关);
//   ② 提现能力门禁(withdrawable)仍由各入口统一读取;
//   ③ 共享工具与后端接口不陪葬:utils/withdraw-form.js、utils/withdrawal-preflight.js 仍在。
// 新弹窗契约(6 入口打开客服弹窗/复制/常量单一来源)见 withdraw-cs-popup-contract.test.js。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js')

const ROOT = path.resolve(__dirname, '../..')

const PAGES = {
  merchantInfo: 'pages/topic/merchantinfo/merchantinfo.js',
  earnings: 'subpackageA/pages/assetcenter/earnings/index.js',
  standaloneWithdraw: 'subpackageMember/tixian/tixian.js',
  sceneRoute: 'components/cy/scene-route-content/index.js',
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function loadPage(relativePath, source = read(relativePath)) {
  const absolutePath = path.join(ROOT, relativePath)
  const navigations = []
  let pageConfig = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getPageSize: () => 20,
    getUserID: () => 1,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest() {},
    tips() {},
  }
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    Page(config) { pageConfig = config },
    require: createRequire(absolutePath),
    setTimeout() {},
    clearTimeout() {},
    wx: {
      getStorageSync() { return null },
      setStorageSync() {},
      navigateTo(options) { navigations.push(['navigateTo', options]) },
      reLaunch(options) { navigations.push(['reLaunch', options]) },
      navigateBack() {},
      setNavigationBarColor() {},
      setBackgroundColor() {},
    },
  }, { filename: absolutePath })

  assert.ok(pageConfig, `${relativePath} 必须注册 Page`)
  return { page: Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) }), navigations }
}

test('俱乐部分润站内入口进入“我的资产”宿主并由 sceneStack 打开', () => {
  const merchant = loadPage(PAGES.merchantInfo)
  merchant.page.data.topicId = 42
  merchant.page.goFinance()

  assert.equal(merchant.navigations.length, 1)
  assert.equal(merchant.navigations[0][0], 'navigateTo')
  assert.equal(
    merchant.navigations[0][1].url,
    '/subpackageA/pages/assetcenter/earnings/index?scene=merchant-profit&topicId=42',
  )
  assert.doesNotMatch(read(PAGES.merchantInfo), /navigateTo\(\{ url: '\/pages\/coop\/finance\/index/)
})

// 2026-09-15 退役:三处原写入口里,两份仍有显式能力门禁,scene-route 场景表单不按能力展示
// (它在表单渲染上就带 form:true 契约,不再重复角色判断),所以只钉这三份现码的读法一致。
function assertWithdrawalCapabilityGuards(sources = {}) {
  const component = sources.component || read('components/cy/scene-asset-earnings/index.js')
  const earnings = sources.earnings || read(PAGES.earnings)
  const standalone = sources.standalone || read(PAGES.standaloneWithdraw)
  for (const [name, source] of Object.entries({ component, earnings, standalone })) {
    assert.match(source, /roleGuard\.can\(['"]withdrawable['"]\)/, `${name} 必须读取 withdrawable 能力`)
    assert.doesNotMatch(source, /roleGuard\.role\(\) === ['"]player['"]/, `${name} 不得再按玩家角色硬拦提现`)
  }
}

test('提现能力门禁仍统一读取 withdrawable,不再按玩家角色硬拦', () => {
  assertWithdrawalCapabilityGuards()
})

test('负控:任一入口退回 player 角色判断时能力门禁必须判红', () => {
  const component = read('components/cy/scene-asset-earnings/index.js')
    .replace("roleGuard.can('withdrawable')", "roleGuard.role() !== 'player'")
  assert.throws(
    () => assertWithdrawalCapabilityGuards({ component }),
    assert.AssertionError,
  )
})

test('退役不陪葬:共享校验/预检工具仍在(后端接口不动,前端只是不再从入口调用)', () => {
  const withdrawForm = require(path.join(ROOT, 'utils/withdraw-form.js'))
  assert.equal(typeof withdrawForm.canSubmitWithdraw, 'function')
  assert.equal(typeof withdrawForm.checkWithdrawForm, 'function')
  assert.equal(typeof withdrawForm.CONSENT_DOC_TYPE, 'string')

  const preflight = require(path.join(ROOT, 'subpackageA/utils/withdrawal-preflight.js'))
  assert.equal(typeof preflight.submitBankWithdrawal, 'function')
})

test('退役:三个原写入口的处理器里不得再出现建单/预检调用', () => {
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const sliceBetween = (source, from, to) => {
    const start = source.indexOf(from)
    const end = source.indexOf(to, start + from.length)
    assert.ok(start >= 0 && end > start, `切片失败: ${from} → ${to}`)
    return stripComments(source.slice(start, end))
  }
  const standalone = sliceBetween(read(PAGES.standaloneWithdraw), 'saveData: function()', 'getUserData: function()')
  assert.doesNotMatch(standalone, /withdrawal\/create|submitBankWithdrawal/)

  const earnings = sliceBetween(read(PAGES.earnings), 'openWithdrawSheet()', 'onTxAmountInput(')
  assert.doesNotMatch(earnings, /withdrawal\/create|submitBankWithdrawal|txSheet\.show': true/)

  const sceneRoute = sliceBetween(read(PAGES.sceneRoute), 'submitForm()', 'const merchantIdentityPolicy')
  assert.doesNotMatch(sceneRoute, /withdrawal\/create|submitBankWithdrawal/)
})
