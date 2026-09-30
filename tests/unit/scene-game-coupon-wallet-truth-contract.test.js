const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'components/cy/scene-game-coupon-wallet/index.js')

function loadComponent() {
  const sandbox = { requests: [], events: [] }
  global.getApp = () => ({ getUserID: () => 'member-A', sendRequest: (options) => sandbox.requests.push(options) })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {}
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const vm = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { sandbox.events.push({ name, detail }) },
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.def.data))
  return { vm, sandbox }
}

function loadRows(rows) {
  const { vm, sandbox } = loadComponent()
  vm.load()
  sandbox.requests[0].success({ code: 200, data: rows })
  return { vm, sandbox }
}

test('券状态只认数值 0/1/2/3，unknown 不得伪装成待使用', () => {
  const { vm } = loadRows([
    { id: 1, useStatus: 0 },
    { id: 2, useStatus: 1 },
    { id: 3, useStatus: 2 },
    { id: 4, useStatus: 3 },
    ...[null, undefined, true, false, '0', '1', '2', '3', 4, 5].map((useStatus, index) => ({ id: index + 10, useStatus })),
  ])

  assert.deepEqual(vm.data.items.slice(0, 4).map((item) => [item._statusText, item._statusVariant, item._isUsable]), [
    // 2026-09-01 迁 cy-badge 词表:blue→info、done→neutral(未知券本来就是 neutral,没动)
    ['待使用', 'info', true],
    ['已使用', 'neutral', false],
    ['已过期', 'neutral', false],
    // 2026-09-17 券拍板:平台手动失效(3)是有效终态,显示「已失效」且不可用
    ['已失效', 'danger', false],
  ])
  for (const item of vm.data.items.slice(4)) {
    assert.equal(item._statusText, '状态待确认')
    assert.equal(item._statusVariant, 'neutral')
    assert.equal(item._isUsable, false)
  }
})

test('状态筛选与打开核销码都使用严格投影，未知券没有动作语义', () => {
  const { vm, sandbox } = loadRows([
    { id: 1, couponName: '合法券', useStatus: 0 },
    { id: 2, couponName: '字符串伪券', useStatus: '0' },
    { id: 3, couponName: '空值伪券', useStatus: null },
  ])

  vm.selectTab({ currentTarget: { dataset: { tab: 1 } } })
  assert.deepEqual(vm.data.items.map((item) => item.id), [1])

  vm.openCode({ currentTarget: { dataset: { item: vm.data.all[1] } } })
  vm.openCode({ currentTarget: { dataset: { item: vm.data.all[2] } } })
  assert.equal(sandbox.events.length, 0)

  vm.openCode({ currentTarget: { dataset: { item: vm.data.all[0] } } })
  assert.deepEqual(sandbox.events, [{
    name: 'open',
    detail: { id: 'qr-coupon', params: { couponHistoryId: '1', name: '合法券' } },
  }])
})

test('可操作性不靠原始字段，箭头使用项目图标资产', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/scene-game-coupon-wallet/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'components/cy/scene-game-coupon-wallet/index.json'), 'utf8'))
  assert.match(wxml, /item\._isUsable/)
  assert.doesNotMatch(wxml, /item\.useStatus\s*===/)
  assert.match(wxml, /<cy-icon[^>]*name="arrow-right"/)
  assert.doesNotMatch(wxml, /›/)
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
})

test('negative control: Number(useStatus) 强转会被契约判红', () => {
  const source = fs.readFileSync(MODULE, 'utf8')
  assert.doesNotMatch(source, /Number\([^)]*useStatus[^)]*\)/)
})
