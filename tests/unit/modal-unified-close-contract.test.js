/* CU-M-153 / CU-C-136 / CU-C-154 · cy-modal 统一右上角 X
 *
 * 用户统一规则(2026-09-24 走查反复引用):应用弹层关闭一律放右上角 X,各类型一致。
 * 居中确认框原来只有底部按钮,和同表单里的类型弹层(有 X)凑在一起就是两套关闭手势。
 *
 * 本契约锁三件真会坏的事:
 *   ① ✕ 必须存在,且走 cancel 这条出口 —— ✕ 永远不许按下带业务后果的确认键;
 *   ② 请求在途(loading)时 ✕ 必须收起,和底部按钮一起锁住;
 *   ③ 卡片顶格必须留出一整档 --cy-btn-h 热区,标题不许压到 ✕ 底下。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const WXML = 'components/cy/modal/index.wxml'
const WXSS = 'components/cy/modal/index.wxss'
const JS = 'components/cy/modal/index.js'

function closeControl(wxml) {
  const m = wxml.match(/<view class="mo__close"([^>]*)>/)
  assert.ok(m, '居中确认框必须渲染右上角关闭控件')
  assert.match(m[1], /wx:if="\{\{!loading\}\}"/, '请求在途时必须收起 ✕')
  assert.match(m[1], /bindtap="onClose"/, '✕ 必须触发 onClose')
  assert.match(m[1], /aria-role="button"/, '✕ 必须声明 button 语义')
  assert.match(m[1], /aria-label="\{\{title \? '关闭' \+ title : '关闭当前弹窗'\}\}"/, '✕ 必须有关闭当前弹窗的可读标签')
  assert.match(
    wxml,
    /<view class="mo__close"[\s\S]*?<cy-icon name="close-sm" size="44" \/>/,
    '✕ 必须复用全站同一个 close-sm 字形',
  )
}

function assertModalUnifiedClose(wxml, wxss, js) {
  closeControl(wxml)

  // ✕ = 放弃这次弹窗:必须落到 cancel,不许落到 confirm
  const onClose = js.match(/onClose\(\)\s*\{\s*this\.onCancel\(\);\s*\}/)
  assert.ok(onClose, 'onClose 必须复用 onCancel 这条出口(✕ 不等于确认)')
  const onCancel = js.match(/onCancel\(\)\s*\{[\s\S]*?\}/)
  assert.ok(onCancel && /triggerEvent\('cancel'\)/.test(onCancel[0]), 'onCancel 必须继续抛 cancel 事件')
  assert.ok(onCancel && /if \(this\.data\.loading\) return;/.test(onCancel[0]), '在途时不许重复结算')

  const card = wxss.match(/\.mo__card\s*\{[^}]*\}/)
  assert.ok(card, '找不到 .mo__card 样式规则')
  assert.match(card[0], /position:\s*relative/, '✕ 相对卡片定位')
  assert.match(card[0], /padding:\s*var\(--cy-btn-h\)\s/, '卡片顶格必须留出一整档关闭热区')

  const compactCard = wxss.match(/\.mo--compact \.mo__card\s*\{[^}]*\}/)
  assert.ok(compactCard, '找不到 compact 档卡片样式规则')
  assert.match(compactCard[0], /padding:\s*var\(--cy-btn-h\)\s/, 'compact 档同样要给 ✕ 留出顶格')

  const close = wxss.match(/\.mo__close\s*\{[^}]*\}/)
  assert.ok(close, '找不到 .mo__close 样式规则')
  assert.match(close[0], /position:\s*absolute/, '✕ 脱离文档流,不挤动标题')
  assert.match(close[0], /top:\s*0/, '✕ 锚在卡片右上角(上)')
  assert.match(close[0], /right:\s*0/, '✕ 锚在卡片右上角(右)')
  assert.match(close[0], /width:\s*var\(--cy-btn-h\)/, '✕ 热区宽度读 88rpx 按钮 token')
  assert.match(close[0], /height:\s*var\(--cy-btn-h\)/, '✕ 热区高度读 88rpx 按钮 token')
  assert.match(close[0], /background:\s*transparent/, '✕ 不许有圆底(§3.21 只留字形)')
  assert.match(close[0], /color:\s*var\(--cy-text-secondary\)/, '关闭色必须走主题 token')
}

test('cy-modal 有右上角 X、走 cancel、在途收起且卡片顶格预留热区', () => {
  assertModalUnifiedClose(read(WXML), read(WXSS), read(JS))
})

test('负控:摘掉 ✕ 必须判红', () => {
  const mutated = read(WXML).replace(/<view class="mo__close"[\s\S]*?<\/view>/, '')
  assert.notEqual(mutated, read(WXML), '变异锚点失效(源码已改动?)')
  assert.throws(() => assertModalUnifiedClose(mutated, read(WXSS), read(JS)), assert.AssertionError)
})

test('负控:把 ✕ 接到确认键上必须判红', () => {
  const mutated = read(JS).replace(/onClose\(\)\s*\{\s*this\.onCancel\(\);\s*\}/, 'onClose() { this.onConfirm(); }')
  assert.notEqual(mutated, read(JS), '变异锚点失效(源码已改动?)')
  assert.throws(() => assertModalUnifiedClose(read(WXML), read(WXSS), mutated), assert.AssertionError)
})

test('负控:在途还留着 ✕ 必须判红', () => {
  const mutated = read(WXML).replace('wx:if="{{!loading}}"', '')
  assert.notEqual(mutated, read(WXML), '变异锚点失效(源码已改动?)')
  assert.throws(() => assertModalUnifiedClose(mutated, read(WXSS), read(JS)), assert.AssertionError)
})

test('负控:卡片顶格缩回原 padding(标题压到 ✕ 底下)必须判红', () => {
  const mutated = read(WXSS).replace('padding: var(--cy-btn-h) 40rpx 40rpx;', 'padding: 40rpx;')
  assert.notEqual(mutated, read(WXSS), '变异锚点失效(源码已改动?)')
  assert.throws(() => assertModalUnifiedClose(read(WXML), mutated, read(JS)), assert.AssertionError)
})

test('负控:给 ✕ 加回圆底必须判红', () => {
  const mutated = read(WXSS).replace(
    /(\.mo__close\s*\{[^}]*?)background:\s*transparent;/,
    '$1background: var(--cy-bg-card-2);',
  )
  assert.notEqual(mutated, read(WXSS), '变异锚点失效(源码已改动?)')
  assert.throws(() => assertModalUnifiedClose(read(WXML), mutated, read(JS)), assert.AssertionError)
})

// CU-C-154:长主题名不再撑标题。「结束主题「隔离走查…」？」实拍跨两行、吃掉首屏。
test('CU-C-154 结束主题确认:标题固定,主题名降到正文副信息', () => {
  const wxml = read('pages/club/components/cy/club-topic-end-confirm/index.wxml')
  const js = read('pages/club/components/cy/club-topic-end-confirm/index.js')
  assert.match(wxml, /title="结束主题"/, '标题只承担「结束主题」这一件事')
  assert.doesNotMatch(wxml, /title="\{\{[^}]*topicName/, '主题名不许再拼进标题')
  assert.match(js, /'errorText, bodyCopy, topicName'/, '正文必须随主题名重算')
  assert.match(js, /'「' \+ name \+ '」\\n'/, '主题名作为正文首行的可换行副信息')
})

// CU-M-153:模板详情「节点交互预览」原来在面板里自摆一行「取消 / 标题 / 关闭」。
test('CU-M-153 节点交互预览:chrome 归 cy-sheet,不再自摆取消/关闭文字', () => {
  const wxml = read('pages/templatedetail/templatedetail.wxml')
  const start = wxml.indexOf('<cy-sheet show="{{ popDavid }}"')
  assert.notEqual(start, -1, '找不到节点预览 sheet')
  const sheet = wxml.slice(start, wxml.indexOf('</cy-sheet>', start))
  assert.match(sheet, /title="节点交互预览"/, '标题走 sheet 头部,右上 ✕ 才会渲染')
  assert.doesNotMatch(sheet, /closable="\{\{\s*false\s*\}\}"/, '不许再关掉 sheet 的关闭控件')
  assert.doesNotMatch(sheet, /pop-top/, '自摆的顶栏必须退役')
  assert.doesNotMatch(sheet, /取消|关闭/, '面板内不许再有文字版退出口(2026-09-19 裁决:只留右上 ✕)')
})
