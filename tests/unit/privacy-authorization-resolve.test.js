const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

// 隐私授权页是被「伪弹窗」化的:app.js 用 navigateTo 把它压进页面栈(见 openPrivacyAuthorizationPage)。
// 于是它多了一个真浮层组件没有的出口 —— 系统返回(左滑 / 物理返回键)。走那个出口时
// agree/disagree 都不会执行,wx.onNeedPrivacyAuthorization 交来的 resolve 永远不被调用,
// 后续需要隐私授权的接口全部静默挂起:不报错、不提示、也不重试。
test('隐私页被系统返回卸掉时必须兜底 resolve 授权,否则后续接口静默挂起', () => {
  const js = read('pages/privacy/index.js')
  assert.match(js, /onUnload\(\)\s*\{[\s\S]{0,300}?hasPendingPrivacyAuthorization\(\)[\s\S]{0,200}?resolvePrivacyAuthorization\(/,
    'pages/privacy/index.js 必须在 onUnload 里对未决授权兜底 resolve')

  // 兜底必须先问「还有没有未决的」:agree/disagree 里已经 resolve 过再走 navigateBack 也会触发
  // onUnload,无条件再 resolve 一次会把语义从「同意」翻成「拒绝」。
  const unload = js.slice(js.indexOf('onUnload()'))
  assert.ok(unload.indexOf('hasPendingPrivacyAuthorization') < unload.indexOf('resolvePrivacyAuthorization'),
    'onUnload 必须先判 hasPendingPrivacyAuthorization 再 resolve,避免把已同意翻成拒绝')

  // app 侧的两个方法是这条链路的另一半,一起钉住
  const appJs = read('app.js')
  assert.match(appJs, /hasPendingPrivacyAuthorization:\s*function/)
  assert.match(appJs, /resolvePrivacyAuthorization:\s*function/)
})
