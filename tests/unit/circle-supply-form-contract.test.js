const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')
}

test('圈层商家在既有承接授权后填写文档供给卡，不新造绕过审核的入口', () => {
  const formJs = source('pages/topic/components/cy/chapter-node-form/index.js')
  const formWxml = source('pages/topic/components/cy/chapter-node-form/index.wxml')
  const topicJs = source('pages/topic/merchantinfo/merchantinfo.js')
  const hostWxml = source('pages/topic/components/project-host/index.wxml')
  assert.match(formJs, /circleSupplyProfile/)
  for (const field of ['supplyName', 'regularPrice', 'durationMinutes', 'availableHours', 'minPeople', 'maxPeople', 'actionValue']) {
    assert.match(formWxml, new RegExp(field), '缺少供给字段 ' + field)
  }
  assert.match(formJs, /splitBookingAllowed/)
  assert.match(formWxml, /附加权益/)
  assert.match(formWxml, /权益来源、有效期与核销规则/)
  assert.match(topicJs, /payload\.circleSupplyProfile/)
  assert.match(topicJs, /\/api\/coop\/offer\/enroll/)
  assert.match(topicJs, /\/api\/coop\/offer\/circle-supply\/reconfirm-current/)
  assert.match(topicJs, /\/api\/coop\/offer\/circle-supply\/pause/)
  assert.match(topicJs, /\/api\/circle-theme\/instance\/review/)
  assert.match(hostWxml, /30天供给复核/)
})
