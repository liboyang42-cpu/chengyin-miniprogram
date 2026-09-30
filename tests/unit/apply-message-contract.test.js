'use strict'
// 2026-09-17 用户拍板第19条:applyMessage 接成真的申请留言(地图组队 · 漫游附近页)。
// 两端字段对齐:`message`(小程序发送)→ `apply_message`(库列)→ `applyMessage`(队长审批列表下发)
// → P5 申请人行渲染引号留言。空留言不出话;内容安全与 200 字上限由后端承担
// (PlayTeamServiceImpl:trimToNull + length>200 拒 + wxContentSecurityService.checkText)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const REPO = path.resolve(ROOT, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const readBackend = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const T = require('../../subpackageRoam/utils/map-team.js')

const NEARBY_JS = read('subpackageRoam/nearby/index.js')
const NEARBY_WXML = read('subpackageRoam/nearby/index.wxml')

test('P5 申请人行:applyMessage 出引号留言,空/缺省不出话', () => {
  const now = new Date(2026, 8, 15, 12, 10, 0).getTime()
  const rows = T.applicantRows([
    { memberId: 5, memberName: '阿杰', appliedAt: '2026-09-15 12:08:00', applyMessage: '我们两个人,想跟着走完全程' },
    { memberId: 6, memberName: '小满', appliedAt: '2026-09-15 12:09:00', applyMessage: '' },
    { memberId: 7, memberName: '无留言', appliedAt: '2026-09-15 12:09:00' },
  ], now)
  assert.equal(rows[0].messageText, '“我们两个人,想跟着走完全程”')
  assert.equal(rows[1].messageText, '', '空串不当留言渲染')
  assert.equal(rows[2].messageText, '', '缺字段不当留言渲染')
  assert.equal(rows[0].sub, '持本场票 · 2 分钟前申请')
})

test('申请动作弹可选留言输入(≤200),提交时才带上 message;取消不发请求', () => {
  assert.match(NEARBY_JS, /require\('\.\.\/\.\.\/utils\/modal\.js'\)/)
  const apply = NEARBY_JS.slice(NEARBY_JS.indexOf('  apply() {'), NEARBY_JS.indexOf('  _applyErrorToCard('))
  assert.match(apply, /modal\.show\(\{/, '申请必须走弹层(不再一键直发)')
  assert.match(apply, /editable: true/)
  assert.match(apply, /maxlength: 200/, '前端限长与后端 200 字口径一致')
  assert.match(apply, /if \(!r\.confirm\) return;/, '取消不能发申请')
  assert.match(apply, /if \(message\) body\.message = message;/, '空留言不发 message,有留言才带')
  assert.match(apply, /'\/api\/team\/apply'/, '仍走原申请端点')
  assert.match(NEARBY_WXML, /<cy-modal-host id="cy-modal-host" \/>/, '命令式弹窗需要宿主')
  assert.match(read('subpackageRoam/nearby/index.json'), /"cy-modal-host": "\/components\/cy\/modal-host\/index"/)
  assert.match(NEARBY_WXML, /wx:if="\{\{item\.messageText\}\}"/, 'P5 行必须有留言渲染位')
})

test('跨端字段对齐:message → apply_message → applyMessage,限长与内容安全在后端', () => {
  const controller = readBackend('chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayTeamController.java')
  assert.match(controller, /Convert\.toStr\(body\.get\("message"\), null\)/, '控制器必须读 message 字段')
  const service = readBackend('chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/PlayTeamServiceImpl.java')
  assert.match(service, /message\.length\(\) > 200/, '后端 200 字上限')
  assert.match(service, /wxContentSecurityService\.checkText\(message/, '留言过微信内容安全机审')
  assert.match(service, /visible\.put\("applyMessage", row\.getApplyMessage\(\)\)/, '队长审批列表下发 applyMessage')
  const mapper = readBackend('chengyinhub-system/src/main/resources/mapper/business/PlayTeamMapper.xml')
  assert.match(mapper, /apply_message/, '落库列名 apply_message')
})
