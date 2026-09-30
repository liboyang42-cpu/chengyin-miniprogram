/* CU-M-47 / CU-M-90 · 协作详情页的发言身份与用户可见文案(2026-09-24 走查第二轮 G3)
 *
 * CU-M-47:商家在发件箱打开自己发出的邀约,留言气泡却硬编码标「对方」——把自己写的留言
 *   说成对方写的。留言只由发起方在建约时写(message 字段,后端处理动作不覆盖它),
 *   所以发言身份只能按方向判:box=sent 即我是发起方 → 我方;box=received → 对方。
 *   同一张卡上的「处理理由」气泡同理:status=2 拒绝只可能由受邀方写(rejectPendingInviteWithLock
 *   只认受邀方),status=3 撤回只可能由发起方写(cancelPendingInviteWithLock 只认发起方;
 *   取消已接受合作走 cancelAcceptedInvite,只记信用日志、不写 handleReason)。
 * CU-M-90:待确认邀约的联系方式提示把内部条款号「§3.8」打给了用户。
 *
 * 断言方式:把 <text class="bubble-time"> 里的 WXML 表达式抠出来当渲染函数跑,直接看四个
 * (box, status) 组合渲染出什么 —— 只查字符串存在的话,三元写反(我方/对方对调)照样绿。
 * 判据只看代码:注释里必然出现反例(§3.8、「对方」),所以先剥 <!-- --> 再判。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE = 'pages/coop/invite-detail/index.wxml'
const WXML = fs.readFileSync(path.join(ROOT, PAGE), 'utf8')

/** 剥掉 wxml 注释:解释这条规则的注释里必然出现反例,按原文扫会把注释判成违规 */
const codeOf = (src) => src.replace(/<!--[\s\S]*?-->/g, '')

/** 抠出 class="bubble-time" 那两处 <text> 的表达式,返回两个 (box, status) → 文案 的渲染函数。
 *  顺序即页面顺序:第 0 个是留言气泡,第 1 个是处理理由气泡。 */
function bubbleSpeakers(src) {
  const exprs = [...codeOf(src).matchAll(/<text[^>]*class="bubble-time"[^>]*>\{\{([\s\S]*?)\}\}/g)]
    .map((m) => m[1].trim())
  assert.equal(exprs.length, 2, `bubble-time 应正好两处(留言 / 处理理由),实际 ${exprs.length}`)
  // 表达式里的变量名与页面 data 同名,直接喂同名入参,和渲染时同口径
  return exprs.map((expr) => (box, status) =>
    new Function('box', 'invite', `return (${expr});`)(box, { status }))
}

const speakers = () => bubbleSpeakers(WXML)

test('发件箱的留言标「我方」,收件箱才标「对方」', () => {
  const [messageSpeaker] = speakers()
  // 待确认/已接受/已撤回(撤回理由另在 handleReason,message 仍是当初那条留言)
  for (const status of [0, 1, 3]) {
    assert.equal(messageSpeaker('sent', status), '我方',
      `box=sent(我发出的邀约)时我写的留言不能标成对方,status=${status}`)
  }
  assert.equal(messageSpeaker('received', 0), '对方', 'box=received 时留言是对方写的')
})

test('处理理由按写作者标:拒绝归受邀方、撤回归发起方', () => {
  const [, reasonSpeaker] = speakers()
  assert.equal(reasonSpeaker('sent', 2), '对方', '发件箱里的拒绝理由是受邀方写的')
  assert.equal(reasonSpeaker('sent', 3), '我方', '发件箱里的撤回理由是我自己写的')
  assert.equal(reasonSpeaker('received', 2), '我方', '收件箱里的拒绝理由是我自己写的')
  assert.equal(reasonSpeaker('received', 3), '对方', '收件箱里的撤回理由是发起方写的')
})

test('待确认邀约的联系方式提示不再把内部条款号打给用户', () => {
  const code = codeOf(WXML)
  assert.doesNotMatch(code, /§/, '用户可见文案里不该出现内部条款编号(§),它只属于开发注释')
  assert.doesNotMatch(code, /对方接受后下发/, '旧文案带着 (§3.8) 必须换掉')
  assert.match(code, /对方接受后可查看联系方式/,
    '待确认态要照实说明联系方式什么时候能看,不留空也不假装有')
})

test('判据负控:留言身份写死成「对方」必须被识别', () => {
  const mutated = WXML.replace(
    "{{box === 'sent' ? '我方' : '对方'}}", "{{'对方'}}")
  assert.notEqual(mutated, WXML, '变异锚点失效')
  const [messageSpeaker] = bubbleSpeakers(mutated)
  assert.throws(() => assert.equal(messageSpeaker('sent', 0), '我方'), assert.AssertionError,
    '写死「对方」的版本必须在发件箱用例上判红')
})

test('判据负控:三元写反(我方/对方对调)必须被识别', () => {
  const mutated = WXML.replace(
    "{{box === 'sent' ? '我方' : '对方'}}", "{{box === 'sent' ? '对方' : '我方'}}")
  assert.notEqual(mutated, WXML, '变异锚点失效')
  const [messageSpeaker] = bubbleSpeakers(mutated)
  assert.throws(() => assert.equal(messageSpeaker('sent', 0), '我方'), assert.AssertionError,
    '方向写反的版本必须判红——只查表达式存在的断言抓不住这种错')
})

test('判据负控:把内部条款号放回用户可见文案必须被识别', () => {
  const mutated = WXML.replace(
    '对方接受后可查看联系方式', '对方接受后下发(§3.8)')
  assert.notEqual(mutated, WXML, '变异锚点失效')
  assert.match(codeOf(mutated), /§/, '文案回潮必须落到 § 判据上')
})
