// 2026-09-17 总控裁定:余额三段(/api/wallet/stages 返回登录者本人的钱)在分润页只给主体本人看。
// 商家分润页:/api/coop/finance 的 isOwner;俱乐部分润页:/api/club/settlement/summary 的 isOwner。
// 员工/管理员 isOwner=false、字段缺失或不是严格 true ⇒ 一律不显示(不猜)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

function loadMerchantProfit(mutate) {
  let source = read('components/cy/scene-merchant-profit/index.js')
  if (mutate) {
    const changed = mutate(source)
    assert.notEqual(changed, source, '负控锚点失效')
    source = changed
  }
  const requests = []
  let definition
  vm.runInNewContext(source, {
    getApp: () => ({ sendRequest: (o) => requests.push(o) }),
    require: () => ({}),
    Component: (v) => { definition = v },
    wx: { navigateTo() {} },
  })
  const scene = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent() {},
  })
  return (isOwner) => {
    requests.length = 0
    scene.load()
    const data = { topics: [] }
    if (isOwner !== undefined) data.isOwner = isOwner
    requests[0].success({ code: '200', data })
    return scene.data.isOwner
  }
}

test('商家分润页:只有后端判定 isOwner===true 才显示三段,员工/缺字段/非布尔都不显示', () => {
  const run = loadMerchantProfit()
  assert.equal(run(true), true)
  assert.equal(run(false), false, '门店员工进入不显示')
  assert.equal(run(undefined), false, '后端没说是本人就不显示')
  assert.equal(run('true'), false, '字符串 true 不算')
  assert.match(read('components/cy/scene-merchant-profit/index.wxml'), /<cy-funds-stages wx:if="\{\{isOwner\}\}" \/>/)
})

test('负控:商家分润页若把 isOwner 恒置 true,员工也会看到本人余额 ⇒ 必须判红', () => {
  const run = loadMerchantProfit((src) => src.replace('isOwner: res.data.isOwner === true,', 'isOwner: true,'))
  assert.equal(run(false), true, '变异后员工被放行,说明上面的断言确实守着这条')
})

function loadClubSettlement() {
  const PAGE = path.join(ROOT, 'pages/club/settlement/index.js')
  let config
  const requests = []
  global.getApp = () => ({ globalData: {}, sendRequest(o) { requests.push(o) } })
  global.Page = (v) => { config = v }
  global.getCurrentPages = () => [{}, {}]
  global.wx = { showToast() {}, stopPullDownRefresh() {}, navigateBack() {}, switchTab() {}, navigateTo() {}, showModal() {} }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const page = Object.assign({}, config, { data: Object.assign({}, config.data), setData(p) { Object.assign(this.data, p) } })
  return (isOwner) => {
    requests.length = 0
    page.onLoad({ clubId: '21' })
    const data = { settledAmountText: '¥0.00', settledAmountStatus: 'verified', unverifiedSettledCount: 0, pendingAdjustment: null, topics: [] }
    if (isOwner !== undefined) data.isOwner = isOwner
    requests[0].success({ code: 200, data })
    return page.data.summary.isOwner
  }
}

test('俱乐部分润页:只有主理人本人(isOwner===true)显示三段,管理员/缺字段不显示', () => {
  const run = loadClubSettlement()
  assert.equal(run(true), true)
  assert.equal(run(false), false, '管理员不显示')
  assert.equal(run(undefined), false)
  const wxml = read('pages/club/settlement/index.wxml')
  assert.match(wxml, /<cy-funds-stages class="section" wx:if="\{\{summary && summary\.isOwner && \(state === 'ready' \|\| state === 'empty'\)\}\}"(?: bind:stages="onStages")? \/>/)
})
