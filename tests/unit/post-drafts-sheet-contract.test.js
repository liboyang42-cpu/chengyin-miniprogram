/**
 * cy-post-drafts 契约(Figma 379:923)。钉住几件后来的人最容易「顺手改回去」的事:
 *   ① 面板外观走 cy-sheet,组件不自绘实底/遮罩;
 *   ② 三态互斥且完整:Loading / Filled / Empty —— 稿上没画 Empty,但没有它就是一块空白面板;
 *   ③ 骨架色必须是 --cy-color-skeleton-on-sheet(不是页面档 -base:压在玻璃面板上会读成「挖了个洞」);
 *   ④ 骨架与真行共用同一条左边线(24+80+24 = 128rpx),加载完不横向跳;
 *   ⑤ 删除必须过组件内部的危险确认闸,且不能顺带触发整行的「继续编辑」;
 *   ⑥ 组件不自己读 storage —— 草稿真源是 utils/publish/pro-editor-draft.js,由页面喂进来;
 *   ⑦ 两个小于 88rpx 的可点元素(✕ / 垃圾桶)必须把热区撑到 88rpx。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const DIR = 'pages/square/components/cy/post-drafts'
const WXML = read(`${DIR}/index.wxml`)
const WXSS = read(`${DIR}/index.wxss`)
const JS = read(`${DIR}/index.js`)
const JSON_SRC = read(`${DIR}/index.json`)

// 断言一律读「抹掉注释后」的样式:本文件头部的注释里逐字写着 backdrop-filter /
// --cy-color-skeleton-base 这些反面教材,不剥注释的话 doesNotMatch 会被自己的说明文字咬红。
const CSS = WXSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** 取一条 class 规则的声明块(不含伪元素规则)。 */
function rule(source, selector) {
  const escaped = selector.replace(/[+.*?^${}()|[\]\\]/g, '\\$&')
  const matches = source.match(new RegExp('(?:^|[\\s,}])\\.' + escaped + '\\s*\\{[^}]*\\}', 'gm'))
  assert.ok(matches, `找不到 .${selector} 样式规则`)
  return matches[0]
}

/** 把 `calc((40rpx - 88rpx) / 2)` 这类外扩量算成 rpx 数值。 */
function outset(decl) {
  const m = /calc\(\((\d+)rpx\s*-\s*(\d+)rpx\)\s*\/\s*2\)/.exec(decl)
  assert.ok(m, `热区外扩必须写成 calc((自身尺寸 - 目标尺寸) / 2),实得:${decl}`)
  return { own: Number(m[1]), target: Number(m[2]) }
}

test('面板外观交给 cy-sheet,组件不自绘实底与遮罩', () => {
  assert.match(WXML, /<cy-sheet show="\{\{show\}\}"/, '面板必须是 cy-sheet:玻璃底/模糊/顶部 24 圆角/遮罩都由它出')
  assert.doesNotMatch(CSS, /backdrop-filter/, '模糊是 cy-sheet 的职责,组件里再写一份 = 两处漂移')
  assert.doesNotMatch(CSS, /var\(--cy-color-overlay\)/, '遮罩是 cy-sheet 的职责,组件不得另画一层')
  assert.doesNotMatch(WXML, /<cy-sheet[^>]*\stitle=/, '自绘 header(标题 + ✕),传 title 会让 cy-sheet 再画一条头部')
})

test('Header 是 T4 的长相:标题左对齐大字 + 右上角 ✕,不是「取消 + 居中标题」', () => {
  // 弹层四型真源(2026-09-01 修订「关闭:✕ 只给全屏」):
  //   ✕ 只给全屏(T3 / T4),固定右上角;标题同一行走左侧大字 30px。
  //   「凡是关闭这个动作,一律用 ✕,不用文字。」
  //   2026-09-18 终裁改口径:✕ 一律纯字形无圆底、size 44(close-sm)。
  // 草稿是 T4 全屏叠 —— 曾按 379:922 样张做成「取消 + 居中标题」,那是 T1 的长相。
  assert.doesNotMatch(WXML, /pd-cancel|>取消</, '关闭不许用「取消」文字,真源写死一律 ✕')
  assert.match(WXML, /<view class="pd-head__title">草稿<\/view>/, '标题就是「草稿」')
  assert.match(WXML, /class="pd-close"[\s\S]*?<cy-icon name="close-sm" size="44"/, '关闭是纯字形 ✕ 44(无圆底,2026-09-18 终裁)')
  assert.match(rule(CSS, 'pd-head'), /justify-content:\s*space-between/,
    '标题左、✕ 右 —— 不再是两侧等分把标题挤到中线')
  assert.match(rule(CSS, 'pd-head__title'), /font-size:\s*var\(--cy-type-page-title\)/,
    '稿 25:6870 是 30px 大字;走 page-title 档(58rpx),不写裸值')
  assert.match(rule(CSS, 'pd-head'), /padding:\s*var\(--cy-space-3\) var\(--cy-page-x\) var\(--cy-space-2-5\)/,
    '稿:上 12pt=24rpx、左右 16pt=32rpx、下 10pt=20rpx')
})

test('分割线通栏:面板的 32rpx 内边距要被抵掉,不能只画一条缩进的线', () => {
  assert.match(rule(CSS, 'pd'), /margin:\s*0 calc\(var\(--cy-page-x\) \* -1\)/,
    'cy-sheet 面板自带 --cy-page-x 横向内边距,通栏线必须用负外边距抵掉(且跟着 token 走,别写死 -32rpx)')
  assert.match(rule(CSS, 'pd-hr'), /height:\s*2rpx/, '稿上 1px,仓库统一记 2rpx')
  assert.match(rule(CSS, 'pd-hr'), /background:\s*var\(--cy-color-border-subtle\)/, '发丝线走 border-subtle')
})

test('草稿行几何:内容列从 128rpx 起(12+40+12pt),与新建页/首页发文入口同一条左边线', () => {
  const row = rule(CSS, 'pd-row')
  assert.match(row, /padding:\s*var\(--cy-space-4\) var\(--cy-space-3\)/, '稿:上下 16pt=32rpx、左右 12pt=24rpx')
  assert.match(row, /gap:\s*var\(--cy-space-3\)/, '稿:列间距 12pt=24rpx')
  assert.match(row, /align-items:\s*flex-start/, '稿:顶对齐(摘要两行时头像不能跟着往下飘)')

  const avatar = rule(CSS, 'pd-avatar')
  assert.match(avatar, /width:\s*80rpx/, '稿:头像 40pt=80rpx')
  assert.match(avatar, /flex:\s*none/, '头像不许被挤扁,否则左边线就漂了')
  // 24(行左内边距) + 80(头像) + 24(列间距) = 128rpx = 稿上 64pt
  assert.equal(24 + 80 + 24, 128)

  assert.match(rule(CSS, 'pd-col'), /gap:\s*var\(--cy-space-1\)/, '稿:内容列竖间距 4pt=8rpx')
  assert.match(rule(CSS, 'pd-name'), /font-size:\s*var\(--cy-type-card-title\)/, '昵称必须大于摘要,否则行内没有层级')
  assert.match(rule(CSS, 'pd-sum'), /font-size:\s*var\(--cy-type-body\)/, '稿:摘要 14pt=28rpx')
  assert.match(rule(CSS, 'pd-date'), /font-size:\s*var\(--cy-type-label\)/, '稿:日期 12pt=24rpx')
  assert.match(rule(CSS, 'pd-date'), /color:\s*var\(--cy-color-text-tertiary\)/, '稿:日期 tertiary')
  assert.doesNotMatch(CSS, /font-size:\s*[0-9]/, '字号一律走 token,不写裸值(ds-hardcode-gate 也拦)')
})

test('Loading 用 skeleton-on-sheet,且与真行共用同一条左边线', () => {
  const bar = rule(CSS, 'pd-skeleton-bar')
  assert.match(bar, /background:\s*var\(--cy-color-skeleton-on-sheet\)/,
    '玻璃面板上的骨架必须用 on-sheet 档 —— 页面档比面板还暗,会读成「挖了个洞」而不是「正在加载」')
  assert.doesNotMatch(CSS, /--cy-color-skeleton-base/, '别顺手改回页面档「统一一下」,那正是要修的那个 bug')
  assert.doesNotMatch(CSS, /--cy-color-skeleton-highlight/, 'on-sheet 没有配对的 highlight 档,拿页面档去做流光会往暗里扫')

  // 骨架行直接复用 .pd-row,几何不可能与真行走散 —— 这就是「加载完不横向跳」的实现方式。
  const skRow = /<view class="pd-row" wx:for="\{\{\[1, 2, 3\]\}\}"/
  assert.match(WXML, skRow, '骨架行必须复用 .pd-row 的几何,而不是另抄一份 padding/gap')
  assert.match(rule(CSS, 'pd-skeleton-avatar'), /width:\s*80rpx/, '骨架头像与真头像同宽,否则加载完成时内容列横向弹一下')
  // 稿 379:838 每个骨架行是【三条】(105 / 299 / 233,容器 299 ⇒ 35% / 100% / 78%),
  // 对应 Filled 行的「昵称 1 行 + 摘要 2 行」。少一条 = 骨架比真行矮一行 = 加载完纵向跳,
  // 而横向跳已经被上面的头像同宽挡住了 —— 纵向这条得单独钉(2026-09-03 审查抓到画成了 2 条)。
  const LINES = ['name', 'sum1', 'sum2']
  LINES.forEach((n) => assert.match(
    WXML, new RegExp('pd-skeleton-line--' + n),
    `骨架行缺 --${n}:必须三条,与 Filled 行的昵称+两行摘要一一对应,否则加载完纵向跳`
  ))
  const rowLines = (WXML.match(/pd-skeleton-line--/g) || []).length
  assert.equal(rowLines, LINES.length, `骨架行只能有 ${LINES.length} 条线,实测 ${rowLines} 条`)
  const widths = LINES.map((n) => /width:\s*(\d+)%/.exec(rule(CSS, 'pd-skeleton-line--' + n))[1])
  assert.equal(new Set(widths).size, LINES.length,
    `三条骨架线宽度必须两两不同(等长看着像表格不像文字),实测 ${JSON.stringify(widths)}`)
  // 2026-09-03:骨架改成【静态,无动画】—— 两条约束把动画这条路堵死了:
  // ① motion-property-ratchet「只减不增」(上限 130),为一个加载态自增一组不划算;
  // ② 本组件 styleIsolation:isolated,cy-skeleton 的 .sk-bar/@keyframes 复用不了。
  // 骨架真正承重的是「几何与真行同构 ⇒ 加载完不横向跳」,扫光只是锦上添花。
  // 断言反过来钉:不许再自开 @keyframes(回潮会让棘轮红,这里先一步点名原因)。
  assert.doesNotMatch(CSS, /@keyframes/, '骨架不许自开 @keyframes:动效棘轮只减不增,几何同构才是承重的那条')
})

test('三态互斥且完整:Loading / Filled / Empty 各占一支', () => {
  assert.match(WXML, /wx:if="\{\{loading\}\}"/, '读取中先走骨架 —— 空态是个结论,读完才知道对不对')
  assert.match(WXML, /wx:elif="\{\{drafts\.length\}\}"/, '有草稿才画列表')
  assert.match(WXML, /<cy-empty wx:else kind="empty"/, '稿上没画 Empty,但一条都没有时不能是一块空白面板;且必须用 cy-empty 不自绘')
  assert.doesNotMatch(WXML, /<cy-empty[^>]*\scta=/, 'cy-empty 的默认 CTA 没有默认动作 = 假按钮;要 CTA 得由接入页显式接住')
  assert.match(WXML, /只有 \{\{drafts\.length \|\| 0\}\} 条草稿/, '数字插值后紧跟量词必须有 || 兜底(孤立单位门禁)')
})

test('两个小于 88rpx 的可点元素都把热区撑到了 88rpx', () => {
  // ✕ 视觉按真源的圆形 40pt(=80rpx),但仓库触控下限是 88rpx —— 差 4rpx 一圈,
  // 用透明 ::after 补齐。不许为了对稿降热区。
  const close = rule(CSS, 'pd-close')
  assert.match(close, /width:\s*80rpx/, '稿:关闭键圆形 40pt = 80rpx')
  assert.match(close, /border-radius:\s*var\(--cy-radius-pill\)/, '真源写死「圆形」✕,不是方块')
  const closeAfter = /\.pd-close::after \{([^}]*)\}/.exec(CSS)
  assert.ok(closeAfter, '✕ 必须有 ::after 热区层')
  assert.match(closeAfter[1], /position:\s*absolute/, '::after 不 absolute 就不是热区层')
  for (const side of ['width', 'height']) {
    assert.match(closeAfter[1], new RegExp(side + ':\\s*88rpx'),
      `✕ 的 ${side} 必须撑到 88rpx —— 视觉 80rpx 差 4rpx 一圈`)
  }

  const delAfter = /\.pd-del::after \{([^}]*)\}/.exec(CSS)
  assert.ok(delAfter, '垃圾桶必须有 ::after 热区层')
  assert.match(delAfter[1], /position:\s*absolute/, '::after 不 absolute 就不是热区层')
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const decl = new RegExp(side + ':\\s*([^;]+);').exec(delAfter[1])[1]
    const { own, target } = outset(decl)
    assert.equal(own, 40, '稿上垃圾桶 20pt=40rpx,视觉按稿')
    assert.equal(target, 88, `垃圾桶的 ${side} 必须撑到 88rpx —— 删除还误触不得`)
  }
  assert.match(WXML, /<cy-icon name="trash" size="40" \/>/, '稿:垃圾桶 20pt=40rpx')
})

test('删除必须过组件内部的危险确认闸,且不能顺带点中整行', () => {
  assert.match(JSON_SRC, /"cy-danger-confirm"/, '确认闸长在组件内部,接入页挂上就自动带闸')
  assert.match(WXML, /<cy-danger-confirm id="pd-danger" bind:confirm="onDeleteConfirmed"/, '确认通过才回调')
  assert.match(WXML, /class="pd-del"[^>]*catchtap="onDelete"/,
    '删除必须 catchtap:bindtap 会冒泡到整行,点「删除」顺带把「继续编辑」也点了')

  const { DANGER_ACTIONS } = require(path.join(ROOT, 'utils/danger-actions.js'))
  const key = (JS.match(/DELETE_CONFIRM_KEY\s*=\s*'([^']+)'/) || [])[1]
  assert.ok(key, '删除的 confirmKey 必须是一个常量,门禁才扫得到')
  assert.ok(DANGER_ACTIONS[key], `confirmKey「${key}」必须在 utils/danger-actions.js 登记过`)
  assert.equal(DANGER_ACTIONS[key].irreversible, true, '本地草稿删了就没了,不可逆')
  assert.ok(
    DANGER_ACTIONS[key].consequences.some((c) => c.text.includes('此操作不可撤销')),
    '不可逆动作必须明写「此操作不可撤销」(danger-confirm-gate 也拦)',
  )

  // onDelete 只开闸,不发 delete;delete 只能出现在 onDeleteConfirmed 里。
  const onDelete = JS.slice(JS.indexOf('onDelete(e)'), JS.indexOf('onDeleteConfirmed()'))
  assert.doesNotMatch(onDelete, /triggerEvent\('delete'/, '点垃圾桶当场就上报 = 绕过确认闸')
  assert.match(onDelete, /dc\.open\(DELETE_CONFIRM_KEY/, '点垃圾桶只负责开闸')
  assert.match(JS, /onDeleteConfirmed\(\)[\s\S]*?triggerEvent\('delete'/, '确认后才上报 delete')
})

test('组件只渲染:不自己读 storage,草稿真源在 pro-editor-draft', () => {
  assert.doesNotMatch(JS, /getStorageSync|setStorageSync|removeStorageSync/, '组件不碰 storage —— 由页面 load 好再传进来')
  assert.doesNotMatch(JS, /require\([^)]*pro-editor-draft/, '组件不直接消费草稿工具,免得渲染层长出一条隐藏的数据路径')
  assert.match(JS, /pro-editor-draft\.js/, '但注释里必须点名真源是哪一套,接入页才知道 key 要喂什么')
  for (const prop of ['show', 'loading', 'drafts']) {
    assert.match(JS, new RegExp(`${prop}:\\s*\\{\\s*type:`), `属性 ${prop} 必须声明`)
  }
  for (const evt of ['close', 'select', 'delete']) {
    assert.match(JS, new RegExp(`triggerEvent\\('${evt}'`), `事件 ${evt} 必须发出`)
  }
})
