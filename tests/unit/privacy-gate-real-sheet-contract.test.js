// 隐私授权闸必须是【真弹窗】:页内组件 + wx:if,不压页面栈。
//
// 真弹窗 vs 伪弹窗的差别不在长相:伪弹窗是 navigateTo 压进来的独立页,于是
// 转场从右推入、占一层页面栈、底层页触发 onHide(play/roam 会暂停计时与定位)、
// 盖掉 tabBar、**系统返回直接退整页绕过你的闸**、授权多一次路由跳转。
// 最后一条在这里曾是真 bug(Promise 永不 settle,接口静默挂起)。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 会触发隐私授权的页面(定位 / 相机 / 主要 tab)都必须挂真弹窗闸
const GATE_PAGES = [
  'pages/roam/index',
  'pages/play/index',
  'pages/member/index/index',
  'pages/merchant/index/index',
  'pages/shezhi/shezhi',
  'pages/index/index',
]

test('app.js 触发授权时优先调当前页的真弹窗,路由页只作回退', () => {
  const src = read('app.js')
  const fn = src.slice(src.indexOf('openPrivacyAuthorizationPage:'), src.indexOf('resolvePrivacyAuthorization:'))
  assert.match(fn, /typeof current\.showPrivacyGate === 'function'/, '必须先探测当前页的真弹窗')
  const gateIdx = fn.indexOf('showPrivacyGate()')
  const navIdx = fn.indexOf('wx.navigateTo')
  assert.ok(gateIdx > 0 && navIdx > gateIdx, '真弹窗必须排在 navigateTo 之前,否则永远走不到')
})

test('每个可触发授权的页面都挂了 cy-privacy-gate,并暴露 showPrivacyGate', () => {
  for (const p of GATE_PAGES) {
    // ⚠️ 别用 /<cy-privacy-gate\b/ —— \b 在 'e' 与 '-' 之间成立,cy-privacy-gate-off 也会匹配上,
    // 负控就假绿了(今天第二次踩:detail-cta-bar 撞过 \bdetail\b)。后面必须是空白或标签结束。
    assert.match(read(`${p}.wxml`), /<cy-privacy-gate[\s/>]/, `${p} 缺真弹窗闸`)
    assert.match(read(`${p}.js`), /showPrivacyGate\(\)\s*\{/, `${p} 没暴露 showPrivacyGate`)
    const json = JSON.parse(read(`${p}.json`))
    assert.equal(json.usingComponents['cy-privacy-gate'], '/components/cy/privacy-gate/index', `${p} 未注册组件`)
  }
})

test('闸本体是真弹窗:不含 navigateTo,显隐靠 wx:if', () => {
  // 先剥注释:注释里解释「旧实现用 navigateTo」是说明,不是真调用。
  const js = read('components/cy/privacy-gate/index.js').replace(/\/\/[^\n]*/g, '')
  const wxml = read('components/cy/privacy-gate/index.wxml')
  assert.doesNotMatch(js, /navigateTo|redirectTo|navigateBack/, '真弹窗不得靠路由显隐')
  assert.match(wxml, /<cy-scene-sheet[^>]*wx:if="\{\{show\}\}"/, '显隐必须是页内 wx:if')
})

test('同意按钮仍是原生 button open-type —— 微信强制,收编成 cy-btn 会让授权失效', () => {
  const wxml = read('components/cy/privacy-gate/index.wxml')
  assert.match(wxml, /<button[^>]*open-type="agreePrivacyAuthorization"/)
  assert.match(wxml, /bindagreeprivacyauthorization="agreePrivacy"/)
})

test('待决策态不给静默退出:遮罩不可关,且组件销毁时兜底结算', () => {
  const wxml = read('components/cy/privacy-gate/index.wxml')
  assert.match(wxml, /mask-closable="\{\{false\}\}"/, '强制闸不能点遮罩关掉')
  const js = read('components/cy/privacy-gate/index.js')
  assert.match(js, /detached\(\)[\s\S]*resolvePrivacyAuthorization/, '宿主页被回收时必须结算,否则同样挂起')
})
