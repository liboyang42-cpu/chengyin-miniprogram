'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少样式 ${selector}`)
  return match[1]
}

function assertContract(overrides = {}) {
  const source = (file) => overrides[file] === undefined ? read(file) : overrides[file]
  const publishWxml = source('components/cy/publish-sheet/index.wxml')
  const publishWxss = source('components/cy/publish-sheet/index.wxss')
  assert.match(publishWxml, /ps__quick-action--return"[^>]*aria-role="button"[^>]*aria-label="返回发布类型"/)
  assert.match(publishWxml, /ps__quick-action--return"[^>]*aria-role="button"[^>]*aria-label="返回"/)
  assert.match(rule(publishWxss, '.ps__quick-action'), /min-height:\s*var\(--cy-comp-publish-trigger\)/)

  const successWxss = source('pages/publish/components/creation-success/index.wxss')
  assert.match(rule(successWxss, '.cs__close'), /width:\s*var\(--cy-btn-h\)/)
  assert.match(rule(successWxss, '.cs__close'), /height:\s*var\(--cy-btn-h\)/)

  const drawerWxml = source('pages/topic/components/project-drawer/index.wxml')
  const drawerWxss = source('pages/topic/components/project-drawer/index.wxss')
  const drawerJs = source('pages/topic/components/project-drawer/index.js')
  const hostWxml = source('pages/topic/components/project-host/index.wxml')
  assert.match(drawerWxml, /class="dw-close"[^>]*aria-role="button"[^>]*aria-label="关闭"/)
  assert.match(rule(drawerWxss, '.dw-close'), /width:\s*var\(--cy-btn-h\)/)
  assert.match(rule(drawerWxss, '.dw-close'), /height:\s*var\(--cy-btn-h\)/)
  // CU-C-126:「承接商家」原来用 headerVariant="action" 的「取消/完成」头,两颗都只执行 onClose,
  // 让人误以为招商已经完成。现在抽屉只剩「标题 + 右上 ✕」一种头,退出通道唯一。
  assert.doesNotMatch(drawerWxml, /dw-act|dw-head--action/, '抽屉里不该再有取消/完成那一对假动作')
  assert.doesNotMatch(drawerJs, /headerVariant:\s*\{\s*type/, 'headerVariant 属性已经废弃,不该留在组件接口上')
  // 锚在 <project-drawer ...> 开标签上,不要用裸 headerVariant="action" 全文匹配:
  // host 文件里有一行注释正解释「原来 headerVariant=action 为什么废」,全文匹配会命中注释假红。
  assert.doesNotMatch(hostWxml, /<project-drawer[^>]*headerVariant="action"/, '承接商家必须回到默认标题头')

  // CU-M-157:悬浮发布菜单原来只有底部「返回」,且玻璃层 inset:0 铺到状态栏,
  // 把原页的导航标题与消息入口一起压暗。修好后必须同时满足两件事:
  // ① 面板顶边(= 遮罩 top)从微信胶囊下方开始,由同一份实测几何下发,不是写死的 vh;
  // ② 面板自己的右上角有一颗真 ✕(热区整档、读屏可念)。
  assert.match(publishWxml, /class="ps__mask"[^>]*style="top:\{\{chrome\.contentTop\}\}px"/)
  assert.match(publishWxml, /class="ps__close"[^>]*style="top:\{\{chrome\.contentTop\}\}px"[^>]*bindtap="onClose"[^>]*aria-role="button"[^>]*aria-label="关闭发布菜单"/)
  assert.match(publishWxml, /class="ps__close"[\s\S]{0,300}?<cy-icon name="close-sm"/)
  assert.match(source('components/cy/publish-sheet/index.js'), /resolveMenuChrome\(windowInfo, menuButtonInfo\)/, 'ps__close 的顶边没走胶囊实测几何')
  assert.match(rule(publishWxss, '.ps__close'), /width:\s*var\(--cy-btn-h\)/, 'ps__close 热区宽度')
  assert.match(rule(publishWxss, '.ps__close'), /height:\s*var\(--cy-btn-h\)/, 'ps__close 热区高度')
}

test('复用弹层的返回/关闭/完成动作具有 44px 热区和按钮语义', () => {
  assertContract()
})

test('负控：任一关闭动作缩回 64rpx 会判红', () => {
  const file = 'components/cy/publish-sheet/index.wxss'
  const broken = read(file).replace('min-height: var(--cy-comp-publish-trigger);', 'min-height: 64rpx;')
  assert.throws(() => assertContract({ [file]: broken }), /min-height/)
})

test('负控：移除项目抽屉关闭语义会判红', () => {
  const file = 'pages/topic/components/project-drawer/index.wxml'
  const broken = read(file).replace(
    /(<view class="dw-close"[^>]*?) aria-role="button" aria-label="关闭"/,
    '$1',
  )
  assert.throws(() => assertContract({ [file]: broken }), /dw-close/)
})

test('负控：CU-C-126 把「取消/完成」那对假动作头塞回抽屉必须判红', () => {
  const file = 'pages/topic/components/project-drawer/index.wxml'
  const head = '  <view class="dw-head">'
  const broken = read(file).replace(head, head + '\n    <text class="dw-act dw-act--cancel" catchtap="onClose">取消</text>')
  assert.notEqual(broken, read(file), '负控变异注入失败:抽屉标题头锚点要先同步')
  assert.throws(() => assertContract({ [file]: broken }), /假动作/)
})

test('负控：CU-C-126 承接商家重新挂上 headerVariant="action" 必须判红', () => {
  const file = 'pages/topic/components/project-host/index.wxml'
  const broken = read(file).replace(
    '<project-drawer show="{{ merchantSheet.show }}" title="承接商家" actions=',
    '<project-drawer show="{{ merchantSheet.show }}" title="承接商家" headerVariant="action" actions=',
  )
  assert.notEqual(broken, read(file), '负控变异注入失败:承接商家开标签要先同步')
  assert.throws(() => assertContract({ [file]: broken }), /默认标题头/)
})

const PUBLISH_WXML = 'components/cy/publish-sheet/index.wxml'
const PUBLISH_WXSS = 'components/cy/publish-sheet/index.wxss'
const PUBLISH_JS = 'components/cy/publish-sheet/index.js'

test('负控：把发布菜单的右上角 ✕ 摘掉(退回只剩底部返回)会判红', () => {
  const broken = read(PUBLISH_WXML).replace(/[ \t]*<view class="ps__close"[\s\S]*?<\/view>\n/, '')
  assert.notEqual(broken, read(PUBLISH_WXML), '负控未命中 ps__close')
  assert.throws(() => assertContract({ [PUBLISH_WXML]: broken }), /ps__close/)
})

test('负控：发布菜单顶边不再让开微信导航(遮罩铺回状态栏)会判红', () => {
  const broken = read(PUBLISH_WXML).replace('class="ps__mask" style="top:{{chrome.contentTop}}px"', 'class="ps__mask"')
  assert.notEqual(broken, read(PUBLISH_WXML), '负控未命中遮罩 top')
  assert.throws(() => assertContract({ [PUBLISH_WXML]: broken }), /ps__mask/)
})

test('负控：胶囊几何退回写死兜底(不实测)会判红', () => {
  const broken = read(PUBLISH_JS).replace('this.setData({ chrome: resolveMenuChrome(windowInfo, menuButtonInfo) });', 'this.setData({ chrome: { contentTop: 56 } });')
  assert.notEqual(broken, read(PUBLISH_JS), '负控未命中 chrome 实测')
  assert.throws(() => assertContract({ [PUBLISH_JS]: broken }), /胶囊实测几何/)
})

test('负控：发布菜单 ✕ 热区缩回图标尺寸会判红', () => {
  const broken = read(PUBLISH_WXSS).replace(
    /\.ps__close \{[\s\S]*?\n\}/,
    (m) => m.replace('width: var(--cy-btn-h);', 'width: 44rpx;').replace('height: var(--cy-btn-h);', 'height: 44rpx;'),
  )
  assert.notEqual(broken, read(PUBLISH_WXSS), '负控未命中 ps__close 热区')
  assert.throws(() => assertContract({ [PUBLISH_WXSS]: broken }), /ps__close/)
})
