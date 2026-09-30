const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = 'components/cy/scene-merchant-profit/index.js'
const WXSS_PATH = 'components/cy/scene-merchant-profit/index.wxss'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadScene(mutate) {
  let source = read(JS_PATH)
  if (mutate) {
    const changed = mutate(source)
    assert.notEqual(changed, source, '负控锚点失效')
    source = changed
  }
  const requests = []
  let definition
  vm.runInNewContext(source, {
    getApp: () => ({ sendRequest: (options) => requests.push(options) }),
    require: () => ({}),
    Component: (value) => { definition = value },
    wx: { navigateTo() {} },
  }, { filename: JS_PATH })
  const scene = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent() {},
  })
  return { scene, requests }
}

function loadRows(harness, topics) {
  harness.scene.load()
  harness.requests[0].success({ code: '200', data: { topics } })
  return new Map(harness.scene.data.topics.map((row) => [row.topicId, row]))
}

test('俱乐部分润只接受后端真实 boolean 与 finite number，不把字符串、布尔金额伪装成资金事实', () => {
  const h = loadScene()
  const rows = loadRows(h, [
    { topicId: 1, settled: '0', myIncome: 88, myIncomeArrived: true, merchantTotal: false, merchantPaid: false },
    { topicId: 2, settled: true, myIncome: false, myIncomeArrived: true, merchantTotal: 0, merchantPaid: 0 },
    { topicId: 3, settled: true, myIncome: 50, myIncomeArrived: '1', merchantTotal: 100, merchantPaid: null },
    { topicId: 4, settled: true, myIncome: 60, myIncomeArrived: true, merchantTotal: 100, merchantPaid: null },
  ])

  assert.equal(rows.get(1).settled, false)
  assert.equal(rows.get(1).statusText, '结算状态待确认')
  assert.equal(rows.get(1).merchantTotalText, null, 'boolean merchantTotal 不能变成 0.00')
  assert.equal(rows.get(2).incomeText, null, 'boolean myIncome 不能变成 0.00')
  assert.equal(rows.get(2).statusText, '金额待确认')
  assert.equal(rows.get(3).arrived, false)
  assert.equal(rows.get(3).statusText, '到账状态待确认')
  assert.equal(rows.get(4).merchantStatus, '打款状态待确认', 'merchantPaid=null 不能伪装成待打款')
  assert.equal(h.scene.data.myIncomeTotal, null, '存在状态/金额未知行时，不得给出可提现合计')
  assert.equal(h.scene.data.canWithdraw, false)
})

test('真实布尔状态与非负数仍正常计算已入账分润', () => {
  const h = loadScene()
  const rows = loadRows(h, [
    { topicId: 7, settled: true, myIncome: 60, myIncomeArrived: true, merchantTotal: 100, merchantPaid: 100 },
    { topicId: 8, settled: false, myIncome: 40, myIncomeArrived: false, merchantTotal: 0, merchantPaid: 0 },
  ])
  assert.equal(rows.get(7).statusText, '已入账')
  assert.equal(rows.get(7).merchantStatus, '已打款')
  assert.equal(rows.get(8).statusText, '待结算')
  assert.equal(h.scene.data.myIncomeTotal, '60.00')
  assert.equal(h.scene.data.canWithdraw, true)
})

test('分润 scene 使用宿主高度，不把 100vh 撑出弹窗', () => {
  const wxss = read(WXSS_PATH).replace(/\/\*[\s\S]*?\*\//g, '')
  const block = wxss.match(/\.mp\s*\{([^}]*)\}/g)
  assert.ok(block && block.length >= 2)
  const merged = block.join('\n')
  assert.match(merged, /height:\s*100%/)
  assert.match(merged, /min-height:\s*0/)
  assert.doesNotMatch(merged, /min-height:\s*100vh/)
})

test('负控：结算状态退回 truthy、金额退回 Number 强转时，资金真值契约判红', () => {
  const truthy = loadScene((source) => source
    .replace("const settledKnown = typeof t.settled === 'boolean';", 'const settledKnown = true;')
    .replace('const settled = t.settled === true;', 'const settled = !!t.settled;'))
  const truthyRows = loadRows(truthy, [
    { topicId: 1, settled: '0', myIncome: 88, myIncomeArrived: true, merchantTotal: 0, merchantPaid: 0 },
  ])
  assert.notEqual(truthyRows.get(1).statusText, '结算状态待确认')

  const coercing = loadScene((source) => source.replace(
    "if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;",
    "const amount = Number(value); if (!Number.isFinite(amount) || amount < 0) return null; value = amount;",
  ))
  const coercingRows = loadRows(coercing, [
    { topicId: 2, settled: true, myIncome: false, myIncomeArrived: true, merchantTotal: 0, merchantPaid: 0 },
  ])
  assert.equal(coercingRows.get(2).incomeText, '0.00', '负控必须证明 boolean 会被错误强转')
})

// —— Figma G2「调整待处理 / 已执行调整」——
// 这两行是钱。查不到的时候必须是「—」,不能是「¥0.00」:
// 后者等于告诉主理人这笔结算是干净的,可以放心提现。
function loadAdjust(harness, adjustments) {
  harness.scene.load()
  harness.requests[0].success({ code: '200', data: { topics: [], adjustments } })
  return new Map(harness.scene.data.statItems.map((item) => [item.key, item]))
}

test('结算调整:后端下发 null 时显示「—」，不显示 ¥0.00', () => {
  const items = loadAdjust(loadScene(), { pendingAmount: null, executedAmount: null, pendingReason: null })
  assert.equal(items.get('adjustPending').value, null, '待处理调整查不到却显示成了金额')
  assert.equal(items.get('adjustExecuted').value, null, '已执行调整查不到却显示成了金额')
})

test('结算调整:后端整个字段缺席时同样是「—」', () => {
  const items = loadAdjust(loadScene(), undefined)
  assert.equal(items.get('adjustPending').value, null)
  assert.equal(items.get('adjustExecuted').value, null)
})

test('结算调整:真有金额时按稿显示，待处理为 0 时整行不出现', () => {
  const items = loadAdjust(loadScene(), { pendingAmount: 486.5, executedAmount: 0, pendingReason: '结束退款扣回' })
  assert.equal(items.get('adjustPending').value, '¥486.50')
  assert.equal(items.get('adjustExecuted'), undefined, '已执行调整为 0 不该占一行')
  assert.equal(items.get('income').label, '已入账分润')
})

test('结算调整:已执行金额按稿带负号', () => {
  const items = loadAdjust(loadScene(), { pendingAmount: 0, executedAmount: 12.5, pendingReason: '' })
  assert.equal(items.get('adjustExecuted').value, '−¥12.50')
  assert.equal(items.get('adjustPending'), undefined, '待处理为 0 不该占一行')
})
