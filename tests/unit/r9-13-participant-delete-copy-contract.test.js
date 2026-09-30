// R9-13(P3):参与人删除文案仍称「配送地址」。
//
// 审查复现(第九轮 R9-13):pages/address 现在是「参与人信息」列表(姓名/手机号,
// 页面与表单都写明「用于报名联系和到场核验,不用于配送」),但删除确认弹窗
// 仍说「删除这个地址 / 重新填写完整地址 / 地址已删除」。
//
// 契约:删除文案统一为参与人资料,并说明删除资料不等于取消历史报名;
// 「此操作不可撤销」保留(scripts/danger-confirm-gate.js D3:irreversible 动作强制)。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { getDangerAction, DANGER_ACTIONS } = require('../../utils/danger-actions.js')

function assertParticipantCopy(action) {
  const texts = [action.title, action.content, action.confirmText, action.done.title, action.done.text]
    .concat(action.consequences.map(item => item.text))
    .filter(Boolean)
  const all = texts.join('\n')

  assert.doesNotMatch(all, /地址/, '参与人信息删除不得再自称「地址」')
  assert.match(all, /参与人/, '必须用参与人资料/信息的说法')
  assert.ok(action.irreversible === true, '删除仍是不可逆动作')
  assert.match(all, /此操作不可撤销/, '不可逆动作必须保留「此操作不可撤销」(danger-confirm-gate D3)')
  assert.ok(
    action.consequences.some(item => /报名/.test(item.text) && /(不|不会)(自动)?取消|仍然有效|不受影响|历史报名/.test(item.text)),
    '必须说明删除资料不等于取消历史报名',
  )
}

test('RED 锚点:参与人信息删除文案不再提「地址」并交代历史报名', () => {
  assertParticipantCopy(getDangerAction('address.delete'))
})

test('负控:退回「删除这个地址」文案时断言必须判红', () => {
  const legacy = {
    irreversible: true,
    title: '删除这个地址?',
    content: '',
    consequences: [
      { icon: 'warning', text: '此操作不可撤销,删除后需要重新填写完整地址' },
    ],
    confirmText: '删除地址',
    alt: null,
    done: { title: '地址已删除', text: '' },
  }
  assert.equal(DANGER_ACTIONS['address.delete'] !== undefined, true)
  assert.throws(() => assertParticipantCopy(legacy), assert.AssertionError)
})
