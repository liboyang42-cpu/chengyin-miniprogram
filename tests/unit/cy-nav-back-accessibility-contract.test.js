// cy-nav-bar 返回钮的无障碍语义契约(C02 实拍复核触发)。
//
// 缺口:全局规范 §3.8 要求「icon-only 必须有可读语义(aria-label / 或旁边的文字标签)」,
// 而 cy-nav-bar 的返回钮是纯图标、零文字
// —— 读屏软件聚焦上去只会念出一个无名 view。77 份 wxml 共用这一个返回出口,缺口是全站级的。
//
// 本契约只锁两件事,不碰图标视觉/事件行为:
//   ① 真正可点的那一层(.nav__back,wx:if="{{back}}" 决定它渲不渲染)必须声明 button 语义 + 中文标签;
//   ② 装饰层(.nav__back-inner / .nav__back-icon)不得挂语义 —— 否则读屏会把一个返回钮念成两三个控件。
// 语义只落在「真渲染的可交互目标」上:back=false 时整个 .nav__back 不存在,语义随之消失,
// 不会出现「念得出返回钮却点不动」。
//
// 命中区(≥88rpx / 44pt)与裸 chevron 视觉裁决**不在本契约管**:
//   ds-ada-foundation-contract.test.js 已用数值断言(≥88,不锁字面量)+ 64rpx 负控在管。
//   这里重复一遍只会更弱(锁字面量 88rpx 会让合理上调到 96rpx 反被判红)。
//
// ⚠️ 本契约不替代真实调用页的截图/读屏复核 —— 静态源码只能证明属性写对了,
//    证明不了读屏在真机上念出来的顺序与内容。
//
// ⚠️ 每条负控都断言**具体那条错误文案**,不只断言"抛了 AssertionError"。
//    相邻多闸会互相接住同型异常:若变异让正则整个失配,报错会变成"找不到 XX 节点",
//    看着也是红的,但它证明的是"节点没了",不是"语义闸生效"。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const NAV_WXML = 'components/cy/nav-bar/index.wxml'

// 变异必须真的命中锚点(否则 replace 落空 ⇒ 拿原文跑 ⇒ 恒绿的假负控),
// 且必须因**指定那条闸**判红,不是被邻居闸接住。
function assertMutationFails(mutated, source, expectedMessage) {
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertNavBackAccessibility(mutated),
    { name: 'AssertionError', message: expectedMessage },
  )
}

const MSG = {
  conditional: '返回语义必须只在返回钮真渲染时存在(back=false 时一并消失)',
  role: '裸 chevron 返回钮必须声明 button 语义',
  label: '裸 chevron 返回钮必须有中文可读标签',
  innerBare: '返回钮内层是纯视觉容器,不得挂无障碍语义',
  chevronBare: '返回图标是装饰层,不得挂无障碍语义',
}

function assertNavBackAccessibility(wxml) {
  const back = wxml.match(/<view class="nav__back"[^>]*>/)
  assert.ok(back, '找不到 cy-nav-bar 返回钮容器 .nav__back')

  // ① 语义落在真正可点、且条件渲染的那一层上
  assert.match(back[0], /wx:if="\{\{back\}\}"/, MSG.conditional)
  assert.match(back[0], /bindtap="onBack"/, '返回钮必须继续触发既有 onBack(事件/回调行为不变)')
  assert.match(back[0], /hover-class="nav__back--press"/, '返回钮必须保留既有按压反馈')
  assert.match(back[0], /aria-role="button"/, MSG.role)
  assert.match(back[0], /aria-label="返回"/, MSG.label)

  // ② 装饰层不得挂语义:一个返回钮只能被读屏念成一个控件。
  //    这里按标签整体取(不假设 class 一定是第一个属性),否则把 aria-* 插到 class 前面
  //    就能绕过闸,而负控还会因为"找不到节点"假红。
  const inner = wxml.match(/<view [^>]*class="nav__back-inner[^>]*>/)
  assert.ok(inner, '找不到返回钮内层 .nav__back-inner')
  assert.doesNotMatch(inner[0], /aria-(role|label)=/, MSG.innerBare)

  const chevron = wxml.match(/<cy-icon [^>]*class="nav__back-icon"[^>]*>/)
  assert.ok(chevron, '找不到 .nav__back-icon')
  assert.doesNotMatch(chevron[0], /aria-(role|label)=/, MSG.chevronBare)
}

test('cy-nav-bar 返回钮有 button 语义与中文标签,装饰层不挂语义', () => {
  assertNavBackAccessibility(read(NAV_WXML))
})

test('负控:移除返回 aria-label 必须判红(且红在 label 那条闸上)', () => {
  const wxml = read(NAV_WXML)
  assertMutationFails(wxml.replace(' aria-label="返回"', ''), wxml, MSG.label)
})

test('负控:移除返回 aria-role 必须判红(且红在 role 那条闸上)', () => {
  const wxml = read(NAV_WXML)
  assertMutationFails(wxml.replace(' aria-role="button"', ''), wxml, MSG.role)
})

test('负控:把语义错挂到装饰 chevron 上必须判红', () => {
  const wxml = read(NAV_WXML)
  assertMutationFails(
    wxml.replace('<cy-icon class="nav__back-icon"', '<cy-icon class="nav__back-icon" aria-role="button" aria-label="返回"'),
    wxml,
    MSG.chevronBare,
  )
})

test('负控:把语义错挂到装饰内层上必须判红(属性写在 class 之前也拦得住)', () => {
  const wxml = read(NAV_WXML)
  assertMutationFails(
    wxml.replace('<view class="nav__back-inner ', '<view aria-role="button" class="nav__back-inner '),
    wxml,
    MSG.innerBare,
  )
})

test('负控:把语义错挂到装饰内层上必须判红(属性写在 class 之后)', () => {
  const wxml = read(NAV_WXML)
  assertMutationFails(
    wxml.replace('--pill-dark\' : \'\'}}">', '--pill-dark\' : \'\'}}" aria-label="返回">'),
    wxml,
    MSG.innerBare,
  )
})

test('负控:让返回钮无条件渲染(丢掉 back 开关)必须判红', () => {
  const wxml = read(NAV_WXML)
  assertMutationFails(wxml.replace(' wx:if="{{back}}"', ''), wxml, MSG.conditional)
})
