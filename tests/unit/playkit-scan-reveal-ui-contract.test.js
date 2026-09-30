/* cy-playkit-scan · 显形档 UI 优化(2026-09-22)
 *
 * 只管「显形」这一档;老三档(文字/语音/图片)是照原型 PV.scan 逐值港的定稿,不在这里。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML = 'pages/play/components/playkit-scan/index.wxml'
const JS = 'pages/play/components/playkit-scan/index.js'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function loadComponent() {
  const abs = path.join(ROOT, JS)
  const prev = { Component: global.Component, Behavior: global.Behavior }
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (c) => c
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prev.Component
    global.Behavior = prev.Behavior
  }
  assert.ok(captured, JS + ' 必须导出组件定义')
  return captured
}

function instanceOf(component, patch) {
  const inst = {
    data: Object.assign({}, component.data, patch || {}),
    setData(p) { Object.assign(this.data, p) },
    triggerEvent() {},
  }
  return Object.assign(inst, component.methods)
}

// ==================== 2026-09-22 显形档 UI 优化 ====================
// 三件事各钉一根,各配一个「构造坏版本必须红」的负控:
//   ① 活相机上要有准星,显形后退场;
//   ② 显形要有过程(先透明挂上、下一拍到位),减弱动态效果时直接终态;
//   ③ 叠加图装进固定高度的框,多高的图都压不到底部那句话。

test('显形档:取景时活相机中央是一个小准星(不是扫码框),显形之后退场', () => {
  // 参照 SAP Fiori「AR Scanner」:扫描态中间只有 scan guide & crosshair;Apple HIG:整屏留给画面
  const wxml = read(WXML)
  const cam = wxml.slice(wxml.indexOf('<view class="sc__cam"'), wxml.indexOf('<view class="sc__camoff"'))
  const ticks = cam.match(/class="sc__tick sc__tick--(tl|tr|bl|br)"/g) || []
  assert.equal(ticks.length, 4, '准星是四个小角,不是老三档那套大取景框角标')
  assert.doesNotMatch(cam, /sc__c--live/, '老三档的大角标(60rpx)放在整屏相机上就是「扫码框」,看起来不对')
  const guard = cam.slice(0, cam.indexOf('sc__tick--tl'))
  assert.match(guard, /wx:if="\{\{!overlayUrl\}\}"/, '识别成功后准星要退场,把画面让给显形出来的东西')
})

test('负控:把准星的 !overlayUrl 条件摘掉,上一条必须红', () => {
  const original = read(WXML)
  const wxml = original.replace('<block wx:if="{{!overlayUrl}}">', '<block>')
  assert.notEqual(wxml, original, '负控构造失败:准星外层已经不是预期的 <block wx:if="{{!overlayUrl}}"> 形状')
  const cam = wxml.slice(wxml.indexOf('<view class="sc__cam"'), wxml.indexOf('<view class="sc__camoff"'))
  const guard = cam.slice(0, cam.indexOf('sc__tick--tl'))
  assert.doesNotMatch(guard, /wx:if="\{\{!overlayUrl\}\}"/, '负控没构造出来')
})

test('显形有过程:先透明挂上,下一拍才到位 —— 同一拍挂上并到位,transition 没有起点', () => {
  const component = loadComponent()
  const inst = instanceOf(component, { overIn: false, reducedMotion: false })
  const timers = []
  const prev = global.setTimeout
  global.setTimeout = (fn) => { timers.push(fn); return timers.length }
  try {
    component.methods._revealOverlay.call(inst)
    assert.equal(inst.data.overIn, false, '同一拍就到位 = 没有过程,等于「啪」一下出现')
    assert.equal(timers.length, 1, '必须排到下一拍')
    timers[0]()
    assert.equal(inst.data.overIn, true, '下一拍要到位')
  } finally { global.setTimeout = prev }
})

test('减弱动态效果:直接终态,不排下一拍', () => {
  const component = loadComponent()
  const inst = instanceOf(component, { overIn: false, reducedMotion: true })
  let scheduled = 0
  const prev = global.setTimeout
  global.setTimeout = () => { scheduled += 1; return 1 }
  try { component.methods._revealOverlay.call(inst) } finally { global.setTimeout = prev }
  assert.equal(inst.data.overIn, true, '减弱动态效果时还要等一拍,就是在对一个要求别动的人做动画')
  assert.equal(scheduled, 0)
})

test('overlayUrl 从空变有值的那一刻触发显形;收起再打开要重新浮一次', () => {
  const component = loadComponent()
  assert.ok(component.observers.overlayUrl, '没接观察者 = 服务端给了图,显形永远不发生')
  const src = read(JS)
  assert.match(src, /if \(url\) this\._revealOverlay\(\)/)
  assert.match(src, /if \(this\.data\.overIn\) this\.setData\(\{ overIn: false \}\)/,
    '收起不复位 = 第二次打开直接停在终态,没有显形')
  assert.match(src, /detached\(\) \{[^}]*clearTimeout\(this\._overTimer\)/, '组件卸载要清掉那一拍')
  assert.match(src, /detached\(\) \{[^}]*clearTimeout\(this\._arTimer\)/, '组件卸载也要清掉 AR 回落计时')
})

test('叠加图装进固定高度的框:不再是 widthFix(图越高越往下长,会压住那句话)', () => {
  const wxml = read(WXML)
  const over = (wxml.match(/<image class="sc__over[^>]*>/) || [''])[0]
  assert.match(over, /mode="aspectFit"/, '固定框 + aspectFit,多高的图都不越界')
  assert.doesNotMatch(over, /widthFix/, 'widthFix 让高度跟着图走,高图直接压到底部气泡')
  const wxss = read('pages/play/components/playkit-scan/index.wxss')
  const rule = (wxss.match(/\.sc__over \{[^}]*\}/) || [''])[0]
  assert.match(rule, /height: \d+rpx/, '框高要写死,不然 aspectFit 没有边界可 fit')
})

// ==================== 2026-09-22 用户定调:显形档是整屏相机,上面不留玩法页的地址栏 ====================
// 用户原话:「这个没有上面的地址输入 而且应该是全屏的 不能只有中间正方块」

test('显形档的相机铺满整屏,不是中间一块方洞', () => {
  const wxss = read('pages/play/components/playkit-scan/index.wxss')
  const rule = (wxss.match(/\.sc__cam \{[^}]*\}/) || [''])[0]
  assert.match(rule, /position: fixed/, '要整屏就得脱离这一列的流')
  for (const edge of ['left: 0', 'top: 0', 'right: 0', 'bottom: 0']) {
    assert.ok(rule.includes(edge), '.sc__cam 缺 ' + edge + ' —— 四边不贴死就不是整屏')
  }
  assert.doesNotMatch(rule, /width: 560rpx/, '560rpx 的方洞就是用户说的「只有中间正方块」')
})

test('准星小而轻;说明收进底部一条半透明条,不压在画面中间', () => {
  // Apple HIG:环境里的文字越少越好;必要说明放在屏幕固定位置、用半透明控件,别挡画面
  const wxss = read('pages/play/components/playkit-scan/index.wxss')
  const aim = (wxss.match(/\.sc__aim \{[^}]*\}/) || [''])[0]
  const w = Number((aim.match(/width: (\d+)rpx/) || [])[1])
  assert.ok(w > 0 && w <= 200, '准星框宽 ' + w + 'rpx —— 超过 200rpx 就又成了扫码框')
  const wxml = read(WXML)
  const cam = wxml.slice(wxml.indexOf('<view class="sc__cam"'), wxml.indexOf('<view class="sc__camoff"'))
  const pill = cam.slice(cam.indexOf('<view class="sc__pill"'))
  assert.ok(cam.includes('<view class="sc__pill"'), '说明要收进底部那条')
  assert.match(pill, /\{\{titleText\}\}/, '商家写的那句标题在说明条里')
  const pillRule = (wxss.match(/\.sc__pill \{[^}]*\}/) || [''])[0]
  assert.match(pillRule, /bottom:/, '说明条贴底')
  assert.match(pillRule, /background: rgba\(/, '半透明,不挡画面')
  const q = (wxml.match(/<view class="sc__q"[^>]*>/) || [''])[0]
  assert.match(q, /wx:if="\{\{kindKey !== '显形'\}\}"/, '显形档里顶部不再放标题')
})

test('相机起不来时标题也不能丢:跟着旁路块走,不留在顶上被地址栏盖住', () => {
  // 2026-09-22 真截图实证:只在 camLive 时让位的话,旁路那一态标题留在原位,被抬上来的地址栏整个盖掉。
  const wxml = read(WXML)
  const off = wxml.slice(wxml.indexOf('<view class="sc__camoff"'), wxml.indexOf('<view class="sc__camoff-t"'))
  assert.match(off, /<view class="sc__camoff-h">\{\{titleText\}\}<\/view>/, '旁路块第一行就是标题')
})

test('显形档整屏取景时不出现玩法页的「输入地址」(用户 2026-09-22 纠正)', () => {
  // 玩法全屏层(--cy-z-sheet)本来就盖住地址栏(z-index 32);只要页面不去抬它,整屏相机上就没有它。
  const page = read('pages/play/index.wxml')
  assert.doesNotMatch(page, /mas-lift/, '不许把地址栏抬到玩法全屏层之上 —— 用户明确说显形档不应该有它')
})

test('显形档动效只走 transition,不新增 keyframes(全仓只减不增)', () => {
  const wxss = read('pages/play/components/playkit-scan/index.wxss')
  const frames = (wxss.match(/@keyframes\s+[\w-]+/g) || [])
  assert.deepEqual(frames, ['@keyframes sc-scan'], '只允许原有的扫描线那一条')
})
