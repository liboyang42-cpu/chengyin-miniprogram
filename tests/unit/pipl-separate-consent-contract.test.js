// PIPL 单独同意契约(2026-08-04)
//
// 报名结算页要把参与人姓名/手机号提供给活动主办方 —— 这是【向第三方提供个人信息】,
// 个人信息保护法第 23 条要求取得【单独同意】:
//   · 不得默认勾选(初始值必须 false)
//   · 不得与通用条款打包成一个勾选
//   · 不得靠"点击付款即视为同意"推定
//
// 2026-08-07 依用户裁决，页面底部只保留这一句单独同意与一个勾选；通用条款说明不再
// 占结算页正文。风险仍是后续为了更短把唯一勾选也拿掉，或默认勾上。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const BAOMING = path.join(__dirname, '../../pages/activity/baoming/baoming')
const readJs = () => fs.readFileSync(BAOMING + '.js', 'utf8')
const readWxml = () => fs.readFileSync(BAOMING + '.wxml', 'utf8')

function assertSeparateConsentIntact(js, wxml) {
  // ① 不得默认勾选
  assert.match(
    js,
    /hostShareChecked:\s*false/,
    'PIPL 单独同意不得默认勾选,hostShareChecked 初始值必须是 false',
  )
  // ② 必须有独立的、用户可点的勾选控件(不能只剩一行说明文字)
  assert.match(
    wxml,
    /class="bmbottom_box"[^>]*bindtap="toggleHostShare"[^>]*aria-role="checkbox"[^>]*aria-checked="\{\{hostShareChecked\}\}"/,
    '单独同意必须由用户主动操作独立控件,不能收成小字或推定同意',
  )
  assert.match(
    wxml,
    /<icon[^>]*wx:if="\{\{hostShareChecked\}\}"[^>]*type="success"/,
    '微信原生 icon 组件必须真实反映 hostShareChecked,否则是个假勾子',
  )
  // ③ 没勾就不能付款 —— WXML 只读 canPay，单独同意闸收口在 JS 派生函数
  const btn = /<cy-btn[^>]*bindtap="handlePayment"[^>]*>/.exec(wxml)
  assert.ok(btn, '找不到付款按钮')
  assert.match(
    btn[0],
    /disabled="\{\{!canPay\}\}"/,
    '付款按钮 disabled 必须只读 canPay',
  )
  const refreshPaymentState = /refreshPaymentState\s*\(\)\s*\{([\s\S]*?)\n\s*\},/.exec(js)
  assert.ok(refreshPaymentState, '必须存在 refreshPaymentState 单一真源')
  assert.match(
    refreshPaymentState[1],
    /data\.hostShareChecked/,
    'canPay 的 JS 单一真源必须包含 hostShareChecked,否则没勾也能付',
  )
}

test('报名结算页:向主办方提供个人信息必须是单独同意(不默认勾选/独立控件/拦付款)', () => {
  assertSeparateConsentIntact(readJs(), readWxml())
})

test('negative control: 把 hostShareChecked 改成默认勾选必须判红', () => {
  const js = readJs().replace(/hostShareChecked:\s*false/, 'hostShareChecked: true')
  assert.throws(() => assertSeparateConsentIntact(js, readWxml()), assert.AssertionError)
})

test('negative control: 把单独同意也收成一行小字(删掉勾选控件)必须判红', () => {
  const wxml = readWxml().replace(/<icon[^>]*wx:if="\{\{hostShareChecked\}\}"[^>]*\/>/g, '')
  assert.notEqual(wxml, readWxml(), '负控锚点失效：页面没有原生 icon')
  assert.throws(() => assertSeparateConsentIntact(readJs(), wxml), assert.AssertionError)
})

test('negative control: 从 canPay 派生式摘掉 hostShareChecked 闸必须判红', () => {
  const js = readJs().replace(/data\.hostShareChecked\s*&&\s*/, '')
  assert.notEqual(js, readJs(), '负控锚点失效：canPay 没有 hostShareChecked')
  assert.throws(() => assertSeparateConsentIntact(js, readWxml()), assert.AssertionError)
})

test('报名声明精简后不得残留不可见的第二道 agreementChecked 闸', () => {
  const js = readJs()
  const wxml = readWxml()
  assert.doesNotMatch(js, /agreementChecked/)
  assert.doesNotMatch(wxml, /toggleAgreement|bmbottom_terms/)
})
