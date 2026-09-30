'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = () => fs.readFileSync(path.join(ROOT, 'pages/play/merchant/index.wxml'), 'utf8')

function assertStateSemantics(view) {
  assert.match(view, /class="mp-empty"[^>]*aria-role="alert"[^>]*aria-live="polite"/)
  assert.match(view, /class="mp-feedback"[^>]*wx:if="\{\{feedback\}\}"[^>]*aria-role="status"[^>]*aria-live="polite"/)
  // #821 之后这条同时承担「回执 unknown 时的再核对入口」,aria-role 因此是条件式:
  // 可点时报 button、否则报 alert;aria-live 恒为 assertive(降级消息必须被立刻播报)。
  // 2026-08-25:这条降级消息从页面中段搬进了底栏(原位置在折叠线以下,首屏读不到
  // 「为什么现在不能提交」),class 随之由 mp-feedback--warn 改名 mp-status。
  // 契约守的是语义不是位置:可点时报 button、否则报 alert,aria-live 恒 assertive。
  assert.match(view, /class="mp-status mp-status--\{\{receipt\}\}"[^>]*wx:if="\{\{degradedMessage\}\}"[\s\S]{0,200}aria-role="\{\{receipt === 'unknown' \? 'button' : 'alert'\}\}"[^>]*aria-live="assertive"/)
  assert.match(view, /bindtap="revokeMerchantConsent"[^>]*aria-disabled="\{\{consentBusy\}\}"/)
  assert.match(view, /class="mp-sheet__input"[^>]*aria-label="填写任务答案"/)
  // 同上:这条也兼任 unknown 的再核对入口,class 带状态修饰符、aria-role 条件化,
  // 但「必须被播报」这条没变。
  assert.match(view, /class="mp-sheet__err mp-sheet__err--\{\{game\.receipt\}\}"[\s\S]{0,200}aria-role="\{\{game\.receipt === 'unknown' \? 'button' : 'alert'\}\}"[^>]*aria-live="polite"/)
  // unknown 也必须置灰:结果未知时重答等于重复写入,所以 aria-disabled 是两者之或。
  assert.match(view, /class="mp-sheet__btn [^"]+"[^>]*bindtap="submitGame"[^>]*aria-role="button"[^>]*aria-disabled="\{\{game\.submitting \|\| game\.receipt === 'unknown'\}\}"/)
  assert.match(view, /class="mp-cta__main [^"]+"[^>]*bindtap="scanArrival"[^>]*aria-role="button"[^>]*aria-disabled="\{\{busy\}\}"/)
  assert.match(view, /class="mp-cta__main [^"]+"[^>]*bindtap="uploadProof"[^>]*aria-role="button"[^>]*aria-disabled="\{\{busy\}\}"/)
  assert.match(view, /class="mp-cta__main [^"]+"[^>]*bindtap="openVerifyCode"[^>]*aria-role="button"[^>]*aria-disabled="\{\{consentBusy\}\}"/)
}

test('探店日商家页的错误、提交与授权状态具备可访问语义', () => {
  assertStateSemantics(read())
})

test('负控：移除防重复提交语义后契约必须判红', () => {
  const view = read()
  const mutated = view.replace(" aria-disabled=\"{{game.submitting || game.receipt === 'unknown'}}\"", '')
  assert.notEqual(mutated, view)
  assert.throws(() => assertStateSemantics(mutated), assert.AssertionError)
})
