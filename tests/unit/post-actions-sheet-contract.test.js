/**
 * cy-post-actions 契约(Figma 347:737)。
 * 钉三件容易被后来的人「顺手改回去」的事:
 *   ① 玻璃面板走 cy-sheet,不是组件自己画一块纯黑底(纯黑压纯黑页 = 看不见边界);
 *   ② 两张分组卡 + 组内发丝线,不是一条平列表;
 *   ③ 删除必须先过 utils/danger-actions.js 里登记的危险确认闸,不能裸发。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const WXML = read('pages/square/components/cy/post-actions/index.wxml')
const WXSS = read('pages/square/components/cy/post-actions/index.wxss')
const JS = read('pages/square/components/cy/post-actions/index.js')
const JSON_SRC = read('pages/square/components/cy/post-actions/index.json')

test('帖文菜单使用真实依赖可注册，删除仍先打开确认闸', () => {
  const filename = path.join(ROOT, 'pages/square/components/cy/post-actions/index.js')
  let component
  vm.runInNewContext(JS, { require: createRequire(filename), Component: (value) => { component = value } }, { filename })
  assert.equal(typeof component.methods.onDelete, 'function')
  const events = []
  const ctx = {
    data: { postId: '42', summary: '待核对的帖文' },
    _danger: () => ({ open: (key, params) => events.push([key, params.id]) }),
    triggerEvent: (name) => events.push(name),
  }
  component.methods.onDelete.call(ctx)
  assert.deepEqual(events, ['close', ['club.post.delete', '42']])
})

function rule(source, selector) {
  const matches = source.match(new RegExp('\\.' + selector.replace(/[+ ]/g, '\\$&') + '\\s*\\{[^}]*\\}', 'g'))
  assert.ok(matches, `找不到 .${selector} 样式规则`)
  return matches[0]
}

test('面板底走 cy-sheet 的玻璃档,组件不自绘实底与遮罩', () => {
  assert.match(WXML, /<cy-sheet show="\{\{show\}\}"/, '面板必须是 cy-sheet,玻璃底/模糊/24 圆角/遮罩都由它出')
  assert.doesNotMatch(WXSS, /backdrop-filter/, '模糊是 cy-sheet 的职责,组件里重复一份会两处漂移')
  assert.doesNotMatch(WXSS, /background:\s*var\(--cy-color-overlay\)/, '遮罩是 cy-sheet 的职责,组件不得另画一层')
  assert.doesNotMatch(WXML, /title=/, '稿上没有标题栏,传 title 会让 cy-sheet 多画一条头部')
})

test('内容是两张分组卡,不是平列表', () => {
  const cards = WXML.match(/class="pa-card"/g) || []
  assert.equal(cards.length, 2, '编辑(可逆)与 删除/举报(处置)是两种性质,必须分两张卡')

  const card = rule(WXSS, 'pa-card')
  assert.match(card, /background:\s*var\(--cy-color-bg-interactive\)/, '卡面走 bg-interactive')
  assert.match(card, /border-radius:\s*var\(--cy-radius-lg\)/, '稿:卡圆角 16pt = 32rpx = --cy-radius-lg')

  const hairline = rule(WXSS, 'pa-row + .pa-row')
  assert.match(
    hairline,
    /border-top:\s*2rpx solid var\(--cy-color-border-subtle\)/,
    '组内两行之间必须有 1px(=2rpx)发丝线,且用 border-subtle',
  )
})

test('行:16pt 文字弹性撑开 + 22×22 图标,危险行用登记过 AA 豁免的红', () => {
  const row = rule(WXSS, 'pa-row')
  assert.match(row, /padding:\s*22rpx var\(--cy-space-3-5\)/, '稿:上下 11pt=22rpx、左右 14pt=28rpx')
  assert.match(row, /align-items:\s*center/, '稿:行内垂直居中')

  const label = rule(WXSS, 'pa-row__label')
  assert.match(label, /flex:\s*1/, '稿:文字弹性撑开,图标贴右')
  assert.match(label, /font-size:\s*var\(--cy-type-button\)/, '稿:16pt = 32rpx,用既有 token 不写裸值')

  assert.match(
    rule(WXSS, 'pa-row--danger'),
    /color:\s*var\(--cy-color-status-danger-on-interactive\)/,
    '删除/举报用的是那条明写 AA 豁免的红(2.41:1),边界见 tokens.wxss 注释',
  )
  assert.match(WXSS, /AA 豁免/, '豁免理由必须写在组件里,免得后来的人当对比度 bug 改掉')

  for (const [name, icon] of [['编辑', 'edit'], ['删除', 'trash'], ['举报', 'warning']]) {
    assert.match(
      WXML,
      new RegExp(`<view class="pa-row__label">${name}</view>\\s*<cy-icon name="${icon}" size="44" />`),
      `${name} 行必须配 ${icon} 图标,44rpx = 稿上 22pt`,
    )
  }
})

test('三个入口的交互语义一个都不能少', () => {
  for (const [action, handler] of [['edit', 'onEdit'], ['delete', 'onDelete'], ['report', 'onReport']]) {
    const re = new RegExp(`bindtap="${handler}" data-action="${action}"[\\s\\S]{0,160}?hover-class="cy-pressed"`)
    assert.match(WXML, re, `${action} 行必须保留 bindtap + data-action + 按压反馈`)
  }
  const labels = WXML.match(/aria-label="[^"]+"/g) || []
  assert.equal(labels.length, 3, '三行都要有可读的 aria-label')
  assert.equal((WXML.match(/aria-role="button"/g) || []).length, 3, '三行都要有 button 语义')
})

test('只有本人看得到编辑与删除', () => {
  assert.match(WXML, /class="pa-card" wx:if="\{\{owner\}\}"/, '编辑卡整张只给本人')
  assert.match(WXML, /class="pa-row pa-row--danger" wx:if="\{\{owner\}\}" bindtap="onDelete"/, '删除只给本人')
  assert.doesNotMatch(
    WXML,
    /bindtap="onReport"[^>]*wx:if/,
    '举报对所有人可见,非本人时它是卡2 里唯一一行(发丝线自然不画)',
  )
})

test('删除必须过组件内部的危险确认闸,不能裸发', () => {
  assert.match(JSON_SRC, /"cy-danger-confirm"/, '确认闸长在组件内部,接入页挂上就自动带闸')
  assert.match(WXML, /<cy-danger-confirm id="pa-danger" bind:confirm="onDeleteConfirmed"/, '确认通过才回调')

  const { DANGER_ACTIONS } = require(path.join(ROOT, 'utils/danger-actions.js'))
  const key = (JS.match(/DELETE_CONFIRM_KEY\s*=\s*'([^']+)'/) || [])[1]
  assert.ok(key, '删除的 confirmKey 必须是一个常量,门禁才扫得到')
  assert.ok(DANGER_ACTIONS[key], `confirmKey「${key}」必须在 utils/danger-actions.js 登记过`)
  assert.equal(DANGER_ACTIONS[key].irreversible, true, '删帖不可逆')

  // onDelete 只开闸,不发 select;select 只能出现在 onDeleteConfirmed 里。
  const onDelete = JS.slice(JS.indexOf('onDelete()'), JS.indexOf('onDeleteConfirmed()'))
  assert.doesNotMatch(onDelete, /triggerEvent\('select'/, '点「删除」当场就上报 = 绕过确认闸')
  assert.match(onDelete, /dc\.open\(DELETE_CONFIRM_KEY/, '点「删除」只负责开闸')
  assert.match(JS, /onDeleteConfirmed\(\)[\s\S]*?triggerEvent\('select', \{ action: 'delete'/, '确认后才上报 delete')
})
