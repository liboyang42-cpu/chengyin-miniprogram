const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('地图详情的核销码入口必须先进入单店授权页', () => {
  const wxml = read('pages/play/index.wxml')
  const js = read('pages/play/index.js')
  assert.match(wxml, /bindtap="openMerchantFromSheet"/)
  assert.doesNotMatch(wxml, /sheet-nav--verify[\s\S]{0,180}bindtap="openEntryQr"/)
  assert.match(js, /openMerchantFromSheet\(\)[\s\S]{0,300}pages\/play\/merchant\/index/)
})

test('门店页只读 normNode 的归一化规则与拍摄字段', () => {
  const wxml = read('pages/play/merchant/index.wxml')
  assert.match(wxml, /node\.rule/)
  assert.match(wxml, /node\.photoDesc/)
  assert.doesNotMatch(wxml, /node\.(ruleInstructions|photoRequireDesc)/)
})
