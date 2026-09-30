const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const WXML = fs.readFileSync(path.join(ROOT, 'pages/coop/withdraw/index.wxml'), 'utf8')

test('提现方式调整是中性告知态，不得复用错误态语义', () => {
  assert.doesNotMatch(WXML, /<cy-error\b/,
    '方式调整不是加载或业务错误，cy-error 会向辅助技术宣告 alert')
  assert.match(WXML, /<cy-empty\b[^>]*\bkind="empty"[^>]*>/s,
    '中性告知应使用 polite status 语义的 cy-empty')
})

test('中性告知保留清晰的下一步且动作可达(2026-09-15 起改为联系平台客服线下处理)', () => {
  assert.match(WXML, /<cy-empty\b[^>]*title="联系平台客服提现"[^>]*sub="添加客服微信，核对金额后线下处理。"[^>]*\/>/s)
  assert.match(WXML, /bindtap="goBankWithdraw"[^>]*aria-role="button"[^>]*aria-label="联系平台客服提现"/s)
})

test('判据负控：把中性告知改回 cy-error 必须被识别', () => {
  const mutated = WXML.replace(/<cy-empty\b/, '<cy-error')
  assert.match(mutated, /<cy-error\b/)
  assert.doesNotMatch(mutated, /<cy-empty\b[^>]*\bkind="empty"/s)
})
