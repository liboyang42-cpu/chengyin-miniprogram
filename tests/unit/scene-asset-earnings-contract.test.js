// H01 账户收益场景(方案 §5.2 + §10.3)。
// 盯三件事:①金额三态不串(loading 骨架 / error 不渲任何金额 / ready 才有数字)
//          ②余额字段为 null/空(库列可空=还没收益)按 0.00 展示,不算网络错
//            (2026-09-16 截图冒烟:真实商家号余额为空被渲染成「收益没加载出来,网络可能不稳定」)
//          ③金额卡瘦身:卡内只剩数字,邀请记录留在卡外 cy-cell
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const DIR = path.join(ROOT, 'components/cy/scene-asset-earnings')
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

/** 把组件 js 跑起来,拿到 Component() 的定义对象 */
function loadComponent() {
  const src = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8')
  let def = null
  const requests = []
  const sandbox = {
    Component: (d) => { def = d },
    // 组件在模块顶层 const app = getApp(),globalData 必须走 getter ——
    // 写成普通字段会在加载那一刻按值捕获,后面换 __globalData 就打不进去了。
    getApp: () => ({
      get globalData() { return sandbox.__globalData },
      getUserID: () => 1,
      sendRequest: (opts) => { requests.push(opts) },
    }),
    require: (p) => {
      // utils/toast.js 真件,在只带本沙箱 wx 的上下文里求值(回落 wx.showToast 才打得到下面的桩)
      if (vm.isUiModule(p)) return vm.loadUiModule(p, vm.createContext({ wx: sandbox.wx }))
      if (p.indexOf('roleGuard') >= 0) return { load: (cb) => cb(), can: (cap) => cap === 'withdrawable' && sandbox.__withdrawable }
      // countUp 接线(2026-08-21):motion 是纯 node 兼容模块,直接给真件;
      // 减动效偏好固定 true → 单帧直落,金额断言保持同步可判
      if (p.indexOf('motion-preference') >= 0) return { readReducedMotion: () => true }
      if (p.indexOf('motion') >= 0) return require(path.join(ROOT, 'utils/motion.js'))
      throw new Error('unexpected require: ' + p)
    },
    wx: { showToast: (o) => { sandbox.__toast = o } },
    module: { exports: {} },
    __globalData: { userInfo: null },
    __withdrawable: true,
  }
  const fn = new Function('Component', 'getApp', 'require', 'wx', 'module', src)
  fn(sandbox.Component, sandbox.getApp, sandbox.require, sandbox.wx, sandbox.module)
  return { def, requests, sandbox }
}

/** 造一个最小的组件实例:setData 直接合进 data */
function instantiate({ globalData, withdrawable } = {}) {
  const { def, requests, sandbox } = loadComponent()
  if (globalData !== undefined) sandbox.__globalData = globalData
  if (withdrawable !== undefined) sandbox.__withdrawable = withdrawable
  const ctx = {
    data: JSON.parse(JSON.stringify(def.data)),
    properties: {},
    events: [],
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }
  Object.assign(ctx, def.methods)
  return { ctx, def, requests, sandbox }
}

test('缓存里有合法余额时直接 ready,不再发请求', () => {
  const { ctx, requests } = instantiate({ globalData: { userInfo: { balance: '12.5' } } })
  ctx.load()
  assert.equal(ctx.data.state, 'ready')
  assert.equal(ctx.data.balance, '12.50')
  assert.equal(requests.length, 0)
})

test('余额字段缺失(null/undefined/空串)是正常数据,按 0.00 展示而不是网络错', () => {
  for (const missing of [null, undefined, '', '  ']) {
    const { ctx, requests } = instantiate({ globalData: { userInfo: null } })
    ctx.load()
    assert.equal(ctx.data.state, 'loading', '发请求前应停在 loading')
    requests[0].success({ code: '200', data: { balance: missing } })
    assert.equal(ctx.data.state, 'ready', `balance=${String(missing)} 是「还没有收益」,不该落 error`)
    assert.equal(ctx.data.balance, '0.00', `balance=${String(missing)} 应按 0.00 展示`)
  }
})

test('余额是坏值(非数字/负数)仍落 error,不摆伪 ¥0.00', () => {
  for (const bad of ['abc', -1, NaN]) {
    const { ctx, requests } = instantiate({ globalData: { userInfo: null } })
    ctx.load()
    requests[0].success({ code: '200', data: { balance: bad } })
    assert.equal(ctx.data.state, 'error', `balance=${String(bad)} 是坏值不是「没有收益」,应落 error`)
    assert.equal(ctx.data.balance, '', 'error 态不得残留任何金额')
  }
})

test('请求非 200 / 缺 data 落 error(真失败才报错)', () => {
  const nonOk = instantiate({ globalData: { userInfo: null } })
  nonOk.ctx.load()
  nonOk.requests[0].success({ code: '500', msg: '服务异常' })
  assert.equal(nonOk.ctx.data.state, 'error')

  const noData = instantiate({ globalData: { userInfo: null } })
  noData.ctx.load()
  noData.requests[0].success({ code: '200' })
  assert.equal(noData.ctx.data.state, 'error')
})

test('余额是 0 是合法数据,必须 ready 并渲 0.00(不能当成取不到)', () => {
  const { ctx, requests } = instantiate({ globalData: { userInfo: null } })
  ctx.load()
  requests[0].success({ code: '200', data: { balance: 0 } })
  assert.equal(ctx.data.state, 'ready')
  assert.equal(ctx.data.balance, '0.00')
})

test('请求失败落 error', () => {
  const { ctx, requests } = instantiate({ globalData: { userInfo: null } })
  ctx.load()
  requests[0].fail()
  assert.equal(ctx.data.state, 'error')
})

test('组件销毁后忽略晚到请求,不得重新启动金额动画或 setData', () => {
  const { ctx, def, requests } = instantiate({ globalData: { userInfo: null } })
  def.lifetimes.attached.call(ctx)
  def.lifetimes.detached.call(ctx)
  const snapshot = JSON.stringify(ctx.data)
  requests[0].success({ code: '200', data: { balance: 88 } })
  assert.equal(JSON.stringify(ctx.data), snapshot)
  requests[0].fail()
  assert.equal(JSON.stringify(ctx.data), snapshot)
})

test('提现只认 withdrawable 能力，不按玩家或商家角色猜测', () => {
  const allowed = instantiate({ globalData: { userInfo: null }, withdrawable: true })
  allowed.def.lifetimes.attached.call(allowed.ctx)
  allowed.ctx.openWithdraw()
  assert.deepEqual(allowed.ctx.events.find((e) => e.name === 'open').detail, { id: 'member-withdraw' })

  const denied = instantiate({ globalData: { userInfo: null }, withdrawable: false })
  denied.def.lifetimes.attached.call(denied.ctx)
  denied.ctx.openWithdraw()
  assert.equal(denied.ctx.events.filter((e) => e.name === 'open').length, 0)
  assert.match(denied.sandbox.__toast.title, /暂无提现权限/)
})

test('三态在 wxml 里互斥,error 分支不含任何金额绑定', () => {
  const wxml = read('index.wxml')
  assert.match(wxml, /wx:if="\{\{state === 'loading'\}\}"[\s\S]*?cy-skeleton|cy-skeleton[^>]*wx:if="\{\{state === 'loading'\}\}"/)
  const errorBlock = wxml.slice(wxml.indexOf("state === 'error'"), wxml.indexOf('<block wx:else>'))
  assert.doesNotMatch(errorBlock, /money\.amount|\{\{balance\}\}|¥/, 'error 态不得出现任何金额')
})

test('D33 金额卡只承载金额，三项主动作与辅助入口分层放在卡外', () => {
  const wxml = read('index.wxml')
  const card = wxml.slice(wxml.indexOf('<view class="ae-card">'), wxml.indexOf('<view class="ae-actions">'))
  assert.match(card, /ae-card__label[\s\S]*ae-card__amount/)
  assert.doesNotMatch(card, /cy-cell|ae-action/, '入口链不得留在金额卡内')
  const actions = wxml.slice(wxml.indexOf('<view class="ae-actions">'), wxml.indexOf('<view class="ae-section">'))
  for (const t of ['明细', '提现', '提现记录']) assert.match(actions, new RegExp(`ae-action[^>]*[\\s\\S]*?>${t}<`))
  const section = wxml.slice(wxml.indexOf('<view class="ae-section">'))
  assert.match(section, /cy-cell[^>]*bind:tap="openInvite"/, '邀请记录必须保留卡外入口')
  assert.doesNotMatch(section, /bind:tap="openCoopFinance"/, '俱乐部分润已归并到收益明细 tab')
})

test('D33 白色金额卡与灰色动作区保持两级，动作热区走统一按钮高度', () => {
  const wxss = read('index.wxss')
  const card = wxss.slice(wxss.indexOf('.ae-card {'), wxss.indexOf('.ae-card__label'))
  const action = wxss.slice(wxss.indexOf('.ae-action {'), wxss.indexOf('.ae-section'))
  assert.match(card, /background:\s*var\(--cy-btn-solid-bg\)/)
  assert.match(card, /border:\s*0/)
  assert.match(action, /min-height:\s*var\(--cy-btn-h\)/)
  assert.match(action, /background:\s*var\(--cy-color-action-secondary-bg\)/)
})

test('不重刷面板底色(否则和 .ss__panel 叠成近实色)', () => {
  const wxss = read('index.wxss')
  const root = wxss.slice(wxss.indexOf('.ae {'), wxss.indexOf('.ae-card {'))
  assert.doesNotMatch(root, /background:\s*var\(--cy-color-bg-surface\)/)
})

// CU-M-144(2026-09-24 走查):商家从「财务 → 去我的资产」进的就是这一页。余额为 0 时空态过去写
// 「发布路线与场次获得创作收益，或创建俱乐部获得分润」—— 后半句把主办分润说成只有建俱乐部才拿得到,
// 而商家自有主题的分润同样会落进这个余额(asset-income 的 club 分支读的就是它)。空态按余额真来路说。
function assertEarningsEmptyState(wxml) {
  const empty = wxml.match(/<cy-empty[^>]*title="还没有收益"[^>]*>/)
  assert.ok(empty, '余额为 0 必须有空态')
  assert.doesNotMatch(empty[0], /创建俱乐部/, '空态不许把主办分润限定成只有俱乐部才有')
  assert.match(empty[0], /sub="创作收益与主办分润到账后都会显示在这里"/, '空态要说出这笔余额的两条真来路')
  return empty[0]
}

test('CU-M-144 空态按余额真来路说，不把主办分润限定成俱乐部', () => {
  assertEarningsEmptyState(read('index.wxml'))
})

test('negative control CU-M-144: 空态退回「创建俱乐部获得分润」必须判红', () => {
  const wxml = read('index.wxml')
  const reverted = wxml.replace('sub="创作收益与主办分润到账后都会显示在这里"',
    'sub="发布路线与场次获得创作收益，或创建俱乐部获得分润"')
  assert.notEqual(reverted, wxml, '负控锚点失效(源码已改动?)')
  assert.throws(() => assertEarningsEmptyState(reverted), assert.AssertionError)
})
