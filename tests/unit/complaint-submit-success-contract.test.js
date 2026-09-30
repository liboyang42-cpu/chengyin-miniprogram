const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 为什么有这份契约:投诉页**没有页内「已提交」状态** —— 成功走的是 toast + 离开本页。
// 截图矩阵的 D26 因此永远拍不出与 D25 不同的一屏(2026-08-18 实测两张逐字节相同),
// 已按 blocked 规范登记(scripts/uiaudit/blocked-baseline.json)。
// blocked 不是逃生口:那一屏的行为改由本文件锁住。
test('投诉提交成功后必须离开本页,且不能是裸 navigateBack(栈长为 1 时点不动)', () => {
  const js = read('subpackageMember/complaint/index.js')

  // ① 成功分支存在,并且成功之后调的是页面自己的 onBack(带栈长兜底),不是裸 navigateBack。
  // 2026-09-06 轻提示收口:成功提示从 wx.showToast({ title }) 改为 toast.success('…')
  assert.match(js, /toast\.success\('投诉已提交'\)/, '成功提示文案不在了,先确认成功分支还在')
  assert.match(js, /setTimeout\(function \(\) \{ that\.onBack\(\); \}/,
    '成功后必须复用 onBack()(它带栈长兜底);裸 wx.navigateBack 在直达进来时什么都不会发生')

  // ② onBack 的兜底本身:栈长 > 1 才 navigateBack,否则 switchTab 回会员中心(tabBar 页)。
  const onBack = js.slice(js.indexOf('onBack() {'), js.indexOf('onBack() {') + 260)
  assert.match(onBack, /getCurrentPages\(\)\.length > 1/, 'onBack 必须先看栈长')
  assert.match(onBack, /wx\.switchTab\(\{\s*url:\s*'\/pages\/member\/index\/index'/,
    '栈首的出口必须是 switchTab —— 会员中心是 tabBar 页,navigateTo/navigateBack 都到不了')

  // ③ 页面确实没有「已提交」的页内状态 —— 这正是 D26 被 blocked 的理由。
  //    哪天真加了 submitted 态,这条会红,提醒把 D26 从 blocked 里放回来重新拍。
  const dataBlock = js.slice(js.indexOf('data: {'), js.indexOf('data: {') + 600)
  assert.doesNotMatch(dataBlock, /\bsubmitted\b/,
    '页面新增了 submitted 页内状态 ⇒ D26 可以拍了,请把它从 blocked-baseline.json 里移除并重新拍')

  // ④ 失败分支必须把 submitting 放回去,否则用户永久卡在「提交中」。
  const submitBlock = js.slice(js.indexOf('submitting: true'))
  assert.ok((submitBlock.match(/setData\(\{\s*submitting:\s*false\b/g) || []).length >= 2,
    '非 200 与网络失败两条路径都要把 submitting 复位')
})

test('D26 已按 blocked 规范登记:基线里有它,且矩阵行写清了 reason 与 altVerification', () => {
  const baseline = JSON.parse(read('scripts/uiaudit/blocked-baseline.json'))
  assert.ok(baseline.blockedIds.includes('D26'), 'D26 必须在 blocked 基线里')
  assert.match(baseline.additions.D26, /altVerification/, '新增 blocked 必须写 altVerification')

  const { SHOTS } = require('../../scripts/shot-matrix')
  const d26 = SHOTS.find((s) => s.id === 'D26')
  assert.ok(d26.blocked, 'D26 必须是 blocked')
  assert.match(d26.blocked, /altVerification/, 'blocked 文案必须给出替代验证手段')
  assert.match(d26.blocked, /complaint-submit-success-contract/, '替代验证要指名到文件,别写"有单测"')
})
