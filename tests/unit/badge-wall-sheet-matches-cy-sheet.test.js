/* 2026-09-24 用户看勋章墙详情截图:「弹窗做的不对,重新看其他弹窗怎么做的」;
 * 第二轮:「还是不对 右上角的x 还有标题大小」—— 参照的是玩家侧场景弹窗 cy-scene-sheet(Figma 量出来那套),
 * 不是 cy-sheet 的默认标题档。
 *
 * 勋章墙在 WebGL 原生层之上,只能用 cover-view(chrome-spec 登记的例外),套不了 cy-sheet;
 * 但外观要跟全站的 cy-sheet 底部面板一样,不能自成一套:
 *   · 贴满两边、贴底、只有顶部两个圆角(原来是 92vw 居中浮着的卡)
 *   · 面板底色读玩家弹层令牌(cover-view 做不了毛玻璃,用同档实色),不写死色值、不加描边
 *   · 遮罩读 --cy-color-overlay
 *   · 标题字号与 cy-sheet 同档;叉号不带圆底(cy-sheet 已去掉圆底)
 *   · 信息行不用 grid(cover-view 不认 grid,标签和值挤成一列),改成面内卡的分组行
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const wxss = fs.readFileSync(path.resolve(__dirname, '../../subpackageP3/pages/badge-wall/index/index.wxss'), 'utf8')
const rule = (sel) => ((wxss.match(new RegExp('(^|\\n)' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}')) || [])[2] || '')

test('★详情面板与玩家场景弹窗(cy-scene-sheet)同一副外观', () => {
  const sheet = rule('.bw-sheet')
  assert.match(sheet, /left:\s*0/, '面板要贴满左边')
  assert.match(sheet, /right:\s*0/, '面板要贴满右边')
  assert.ok(!/92vw|max-width/.test(sheet), '面板还是居中浮着的窄卡')
  assert.match(sheet, /background:\s*var\(--cy-comp-sheet-player-bg\)/, '面板底色要读玩家弹层令牌(cover-view 做不了毛玻璃,取实色档)')
  assert.match(sheet, /border-top:\s*var\(--cy-comp-sheet-border-width\) solid var\(--cy-comp-sheet-player-border\)/, '顶边细线与场景弹窗同')
  assert.match(sheet, /border-radius:\s*var\(--cy-comp-sheet-radius\) var\(--cy-comp-sheet-radius\) 0 0/)
  const hd = rule('.bw-sh-hd')
  assert.match(hd, /padding:\s*var\(--cy-comp-sheet-header-pad-top\) var\(--cy-comp-sheet-header-pad-x\) var\(--cy-comp-sheet-header-pad-bottom\)/, '标题行内边距与场景弹窗同')
  const name = rule('.bw-sh-name')
  assert.match(name, /font-size:\s*var\(--cy-comp-sheet-title-size\)/, '标题字号要用场景弹窗的 28px 档')
  assert.match(name, /line-height:\s*var\(--cy-comp-sheet-title-leading\)/)
  assert.match(rule('.bw-sh-x-visual'), /width:\s*var\(--cy-comp-sheet-close-size\)/, '叉号视觉框与场景弹窗同为 32px')
  assert.ok(!/border/.test(rule('.bw-sh-x-visual')), '叉号还带圆底描边')
  assert.match(rule('.bw-sh-x-icon'), /width:\s*44rpx/, '叉号字形与 cy-icon close-sm 44 同大')
  assert.match(rule('.bw-sh-body'), /padding:\s*0 var\(--cy-comp-sheet-body-pad-x\)/, '正文左右边距与场景弹窗同')
})

test('★信息行是面内卡分组行,不用 cover-view 不认的 grid', () => {
  assert.ok(!/display:\s*grid/.test(wxss), 'cover-view 不认 grid')
  assert.match(rule('.bw-sh-meta'), /background:\s*var\(--cy-comp-sheet-player-history-card\)/, '信息卡与场景弹窗里的记录卡同底')
  assert.match(rule('.bw-sh-meta'), /border-radius:\s*var\(--cy-comp-sheet-history-card-radius\)/)
  assert.match(rule('.bw-sm'), /display:\s*flex/)
  assert.match(rule('.bw-sm'), /justify-content:\s*space-between/, '标签在左、值在右')
  assert.match(rule('.bw-sm-k'), /font-size:\s*var\(--cy-font-body\)/, '标签字号太小(原 16rpx)')
})

test('★第三轮(自审)补齐场景弹窗剩下的规格:字体、遮罩、左右细边、限高可滚、长标题截断', () => {
  const sheet = rule('.bw-sheet')
  assert.match(sheet, /font-family:\s*-apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", sans-serif/, '页面根是等宽字体,弹窗要改回场景弹窗的系统字体')
  assert.match(rule('.bw-veil'), /background:\s*var\(--cy-comp-sheet-player-overlay\)/, '遮罩要用玩家弹层那档(.30),不是 cy-sheet 的 .56')
  assert.match(sheet, /border-left:\s*var\(--cy-comp-sheet-border-width\) solid var\(--cy-comp-sheet-player-border\)/)
  assert.match(sheet, /border-right:\s*var\(--cy-comp-sheet-border-width\) solid var\(--cy-comp-sheet-player-border\)/)
  assert.match(sheet, /box-shadow:\s*var\(--cy-comp-sheet-player-inset-shadow\)/)
  assert.match(sheet, /max-height:\s*calc\(100vh - var\(--sbh\) - var\(--nbh\)\)/, '长说明会把面板顶过胶囊(用页面根上的状态栏+导航栏高)')
  assert.match(wxss, /\.bw-sh-rar, \.bw-sh-desc, \.bw-sh-meta, \.bw-sh-3d \{ flex: none; \}/, '正文子项会被压扁')
  assert.match(rule('.bw-sh-body'), /overflow-y:\s*(auto|scroll)/, '正文要能滚')
  const name = rule('.bw-sh-name')
  assert.match(name, /overflow:\s*hidden/)
  assert.match(name, /white-space:\s*nowrap/)
  assert.match(name, /text-overflow:\s*ellipsis/, '长标题会压到叉')
})

test('★类别小胶囊放回来,挪到标题下一行;「来源」行删掉(和胶囊说的是同一件事)', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../subpackageP3/pages/badge-wall/index/index.wxml'), 'utf8')
  const hd = (wxml.match(/<cover-view class="bw-sh-hd">[\s\S]*?\n    <\/cover-view>/) || [''])[0]
  assert.ok(hd && !/bw-sh-rar/.test(hd), '胶囊不能再和叉挤在标题行')
  assert.match(wxml, /<cover-view class="bw-sh-body">\s*(<!--[\s\S]*?-->\s*)?<cover-view class="bw-sh-rar" style="color:\{\{sheet\.rarColor\}\};">\{\{sheet\.rarZh\}\}<\/cover-view>/, '胶囊放在正文第一行')
  assert.ok(!/>来源</.test(wxml), '来源行删掉')
})
