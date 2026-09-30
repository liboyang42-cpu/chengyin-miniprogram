// 6-16 拉黑确认文案不得指向不存在的入口。
//
// 病:文案写「随时可以在设置里解除」,但全仓没有任何地方调用 /api/im/unblock,
// 设置页也没有黑名单入口 —— 用户按文案去找,永远找不到。
// 合同:文案只说当前真实做得到的事(对方不知情 + 无法自助解除),不承诺入口。
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const { getDangerAction } = require('../../utils/danger-actions.js')

function actionText(key) {
  const action = getDangerAction(key, {})
  return [action.title, action.content, action.confirmText, action.done.title, action.done.text]
    .concat(action.consequences.map((item) => item.text))
    .filter(Boolean)
    .join('\n')
}

test('拉黑文案不再承诺「设置里解除」', () => {
  const all = actionText('im.block')

  assert.doesNotMatch(all, /设置里解除|随时可以在设置/, '没有这个入口,不许写')
  assert.match(all, /对方不会收到拉黑提示/, '真实后果要保留')
  // RV-p6 #3:「需要时请联系客服」同样做不到 —— 客服端只有 adminUnblock,只删平台级拉黑(memberId=0),
  // 解不了「我拉黑了谁」。在有黑名单列表接口 + 解除入口之前,只能写真话。
  assert.match(all, /拉黑后暂不支持解除/, '要如实告知:目前不能解除')
  assert.doesNotMatch(all, /联系客服/, '客服也解不了用户之间的拉黑,不许把人引过去')
})

test('负控锚点:解除入口真的不存在时,文案里的承诺才是假的', () => {
  // 若将来补了黑名单页,这个测试会失败 —— 那时应把文案改回「可在设置里解除」并删掉本契约。
  const files = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (name.endsWith('.js') || name.endsWith('.wxml')) files.push(full)
    }
  }
  walk(path.join(ROOT, 'pages'))
  walk(path.join(ROOT, 'subpackageB'))
  const unblockCallers = files.filter((f) => /api\/im\/unblock/.test(fs.readFileSync(f, 'utf8')))
  assert.deepEqual(unblockCallers, [], '发现了解除入口调用方,文案需要同步改口')
})
