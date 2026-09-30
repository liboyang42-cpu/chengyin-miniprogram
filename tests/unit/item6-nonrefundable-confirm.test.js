// 拍板纪要 2026-09-19 第6条(1-22 附注口径)契约:开场前 24h 内的 ¥ 单,
// 下单确认弹层必须明确写「本单不可退」。
// 铁律:退款性只许消费后端 quote 下发的 tri-state(RefundPolicy 唯一场次钟),
// 前端任何位置都不许再减/再猜 24h;null(旧 jar 未下发)必须零动作放行。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const baomingJs = read('pages/activity/baoming/baoming.js')

test('退款性走实例属性 _quoteRefundableNow,绝不进 data(U4 死数据门禁:data 字段必须被 wxml 渲染)', () => {
  assert.doesNotMatch(baomingJs, /quoteRefundableNow: /, 'data/setData 里再出现该字段会被死数据门禁判红')
  assert.match(baomingJs, /that\._quoteRefundableNow = null;/, '未知态必须显式清 null')
})

test('refreshQuote 每次重报价都作废旧确认与旧退款性', () => {
  const reset = baomingJs.match(/_quoteRetried = false;\s*\n\s*that\._nonRefundableConfirmed = false;\s*\n\s*that\._quoteRefundableNow = null;\s*\n\s*that\.setData\(\{ quoteReady: false \}\);/)
  assert.ok(reset, 'refreshQuote 开头必须同时清 _nonRefundableConfirmed 与 _quoteRefundableNow')
})

test('两处 quote 消费点都只认 JSON true/false,其余一律落 null', () => {
  const triState = /res\.data\.refundableNow === true \|\| res\.data\.refundableNow === false\s*\n?\s*\? res\.data\.refundableNow : null/
  const hits = baomingJs.match(new RegExp(triState.source, 'g'))
  assert.ok(hits && hits.length === 2, `tri-state 映射必须恰有 2 处(refreshQuote + BE-10 补报价),实际 ${hits && hits.length}`)
})

test('闸门:现金单 + refundableNow===false + 未确认 ⇒ modal「本单不可退」并中止本次提交', () => {
  // 判据读实例属性:_quoteRefundableNow 不是渲染态,进 data 会被 U4 死数据门禁判红(2026-09-19 CI 实证)
  assert.match(baomingJs, /if \(Number\(that\.data\.totalAmount \|\| 0\) > 0\s*\n\s*&& that\._quoteRefundableNow === false && !that\._nonRefundableConfirmed\) \{/)
  assert.match(baomingJs, /title: '本单不可退'/)
  assert.match(baomingJs, /content: '该场次已过「集合前 24 小时」退款截止时间，支付后不可退款。确认继续下单？'/)
  assert.match(baomingJs, /confirmText: '继续下单'/)
  assert.match(baomingJs, /cancelText: '再想想'/)
  // 确认后只能置一次性标记重入 handlePayment,不许绕过后续存证/订阅链
  assert.match(baomingJs, /_nonRefundableConfirmed = true;\s*\n\s*that\.handlePayment\(\);/)
})

test('前端零自算时钟:baoming 里不许出现 24h 毫秒数或 startDate 减法', () => {
  assert.doesNotMatch(baomingJs, /86400000|24 \* 60 \* 60 \* 1000|24\*60\*60\*1000/, '出现了第二口钟')
  assert.doesNotMatch(baomingJs, /startDate.*-.*24|24.*startDate/)
})

test('闸门位于单独同意存证与订阅授权之前(确认键提供手势上下文)', () => {
  const gate = baomingJs.indexOf("_nonRefundableConfirmed)")
  const consent = baomingJs.indexOf('recordConsent({')
  const subscribe = baomingJs.indexOf("subscribe.request(['signupSuccess'")
  assert.ok(gate > 0 && consent > gate, '闸门必须在存证之前')
  assert.ok(subscribe > gate, '闸门必须在订阅授权之前')
})

test('跨端契约:后端 quote 出参必须带 refundDeadline/refundableNow,且钟来自 RefundPolicy', () => {
  const BE_ROOT = path.resolve(ROOT, '..')
  const dto = fs.readFileSync(path.join(BE_ROOT,
    'chengyinhub-system/src/main/java/com/chengyinhub/business/domain/dto/RegistrationQuoteResult.java'), 'utf8')
  assert.match(dto, /private Date refundDeadline;/)
  assert.match(dto, /private Boolean refundableNow;/)
  const svc = fs.readFileSync(path.join(BE_ROOT,
    'chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/CmsRegistrationServiceImpl.java'), 'utf8')
  assert.match(svc, /RefundPolicy\.sessionRefundDeadline\(activity\.getStartDate\(\)\)/)
  assert.match(svc, /result\.setRefundableNow\(deadline == null \? null : !new Date\(\)\.after\(deadline\)\)/)
})
