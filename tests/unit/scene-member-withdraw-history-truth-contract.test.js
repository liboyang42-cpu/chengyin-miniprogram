const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'components/cy/scene-member-withdraw-history/index.js')

function loadComponent() {
  const sandbox = { requests: [] }
  global.getApp = () => ({
    getPageSize: () => 10,
    getTotalPage: (total, pageSize) => Math.ceil(total / pageSize),
    sendRequest: (options) => sandbox.requests.push(options),
  })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {}
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const vm = Object.assign({}, sandbox.def, {
    setData(patch) { Object.assign(this.data, patch) },
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.def.data))
  return { vm, sandbox }
}

function project(rows) {
  const { vm, sandbox } = loadComponent()
  vm.getList()
  sandbox.requests[0].success({ code: '200', data: { rows, total: rows.length } })
  sandbox.requests[0].complete()
  return vm.data.list
}

test('提现金额只接受有限非负 JSON number；unknown 与合法 0 分开', () => {
  const invalid = project([false, true, [], [5], '', ' ', '0', null, undefined, -1, NaN]
    .map((receivedAmount, id) => ({ id, receivedAmount, status: 0 })))
  for (const row of invalid) assert.equal(row.receivedAmountText, null)

  const [zero, positive] = project([
    { id: 1, receivedAmount: 0, status: 0 },
    { id: 2, receivedAmount: 12.3, status: 1 },
  ])
  assert.equal(zero.receivedAmountText, '0.00')
  assert.equal(positive.receivedAmountText, '12.30')
})

test('提现状态只认数值 0/1/2；其他值必须显示状态待确认', () => {
  const known = project([
    { id: 1, receivedAmount: 10, status: 0 },
    { id: 2, receivedAmount: 10, status: 1 },
    { id: 3, receivedAmount: 10, status: 2 },
  ])
  assert.deepEqual(known.map((row) => [row.statusText, row.statusVariant]), [
    ['提现中', 'warn'],
    ['提现成功', 'success'],
    ['提现失败，提现金额已全部退回', 'danger'],
  ])

  const unknown = project([null, undefined, true, false, '0', '1', '2', 3]
    .map((status, id) => ({ id, receivedAmount: 10, status })))
  for (const row of unknown) {
    assert.equal(row.statusText, '状态待确认')
    assert.equal(row.statusVariant, 'neutral')
  }
})

test('wxml 只渲染投影后的状态文案，不再用宽松等号把 true/字符串冒充合法状态', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-withdraw-history/index.wxml'), 'utf8')
  assert.match(wxml, /item\.statusText/)
  assert.match(wxml, /txjl-st--\{\{item\.statusVariant\}\}/)
  assert.doesNotMatch(wxml, /item\.status\s*==/)
})

test('negative control: Number(value) 和宽松状态判断会被门禁判红', () => {
  const js = fs.readFileSync(MODULE, 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-withdraw-history/index.wxml'), 'utf8')
  assert.doesNotMatch(js, /const amount = Number\(value\)/)
  assert.doesNotMatch(wxml, /status\s*==/)
})
