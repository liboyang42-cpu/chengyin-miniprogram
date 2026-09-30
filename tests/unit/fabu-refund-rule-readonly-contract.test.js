// 2026-09-23 裁决(CU-C-08):票种编辑页「支持随时退款」开关后端从不读(OmsTicket.refundSupported 仅落库回显),
// 说明写的「活动前 24 小时」还是场次票口径。改为只读展示主题票真实规则(与 RefundPolicy 同口径)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

test('票种编辑:退款是只读规则说明,不是开关;城市定向按集合时间、自由探索按有效期开始', () => {
  const wxml = read('pages/publish/fabu/step3.wxml')
  const js = read('pages/publish/fabu/index.js')
  assert.doesNotMatch(wxml, /onEditTicketRefundToggle/, '不能再给一个关了也照样退的开关')
  assert.doesNotMatch(wxml, />支持随时退款</)
  assert.doesNotMatch(js, /onEditTicketRefundToggle/, '开关删了,处理函数不留孤儿')
  assert.match(wxml, /formData\.productType === 2 \? '有效期开始前可全额退款；开始后或已核销不退' : '集合时间前可全额退款；错过集合或已核销不退'/)
  // 口径钉在主题票实际在跑的判定上(TeamGroupServiceImpl / ApiRegistrationController 都调它):
  // 截止点 = 履约窗起点 = 票的开始时间。它改了,这里的文案要跟着改。
  const policy = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/util/RefundPolicy.java')
  const fn = policy.slice(policy.indexOf('public static Verdict evaluateTopicFulfillmentWindow'))
  assert.match(fn, /Date deadline = window\.getStartInclusive\(\);/, '主题票退款截止点必须仍是履约窗起点')
  const resolver = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/support/FulfillmentWindowResolver.java')
  assert.match(resolver, /new Window\(ticket\.getStartTime\(\), ticket\.getEndTime\(\)\)/, '履约窗起点 = 票的开始时间')
})
