const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertPointsRowContract(js, wxml) {
  // 行必须受 pointsUsable 门禁:服务端关闭积分抵扣(D2)后不许再渲染可点的 -¥0.00
  assert.match(wxml, /class="setly_li" wx:if="\{\{pointsUsable !== false\}\}"/)
  assert.match(js, /useDiscount && pd <= 0/)
  assert.match(js, /pointsUsable: false/)
}

test('下单页积分抵扣行受服务端报价门禁(D2 关闭即收起)', () => {
  assertPointsRowContract(
    read('pages/activity/baoming/baoming.js'),
    read('pages/activity/baoming/baoming.wxml'))
})

test('mutation 负控:删掉报价回 0 的收起逻辑时契约变红', () => {
  const js = read('pages/activity/baoming/baoming.js')
    .replace('pointsUsable: false', 'pointsUsable: true')
  assert.throws(() => assertPointsRowContract(
    js, read('pages/activity/baoming/baoming.wxml')), assert.AssertionError)
})
