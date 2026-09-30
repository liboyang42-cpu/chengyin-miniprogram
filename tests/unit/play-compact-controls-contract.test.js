'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML = path.join(ROOT, 'pages/play/index.wxml')
const WXSS = path.join(ROOT, 'pages/play/index.wxss')
// 2026-09-11 商家横滑卡的样式抽去 style/proto-shopstrip.wxss(漫游也用同一件),
// 本页 @import 了它 —— 断言要连着读,否则会把「搬到共用件里」误判成「规则没了」。
const SHOPSTRIP_WXSS = path.join(ROOT, 'style/proto-shopstrip.wxss')

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector}`)
  return match[1]
}

function assertContract(overrides = {}) {
  const wxml = overrides.wxml === undefined ? fs.readFileSync(WXML, 'utf8') : overrides.wxml
  const wxss = (overrides.wxss === undefined ? fs.readFileSync(WXSS, 'utf8') : overrides.wxss)
    + '\n' + fs.readFileSync(SHOPSTRIP_WXSS, 'utf8')
  assert.match(wxml, /class="gp2__opt-audio"[^>]*aria-label="\{\{audioNodeId==='opt'\+item\.k && audioPlaying \? '暂停选项音频' : '播放选项音频'\}\}"/)
  // ⚠️ .poi__go 2026-09-09 照原型搬后视觉高只有 30px,热区改由透明 ::after 撑 ——
  //    它有下面那三条专门的断言,不再走这个「视觉高即命中高」的循环。
  // .chfull__audio 2026-09-04 曾因「音频升章节级」下线,#1047 专业发布页把章节音频装了回来,
  //    它又是一个真可点的块,所以仍在这条循环里。
  for (const selector of ['.chfull__audio', '.woo__coupon']) {
    assert.match(rule(wxss, selector), /min-height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
    assert.match(rule(wxss, selector), /box-sizing:\s*border-box/, `${selector} 必须按 border-box 计算 owner`)
  }
  // 2026-09-09 .poi__go 照原型搬:视觉高度是原型的 30px = 58rpx,不再拿 44px 当视觉高。
  // 命中区改用透明 ::after 撑 —— 这是本仓 a11y 门禁自己认的写法(cy-info-pop 同款),
  // 由 scripts/a11y-tap-target-lint.js 逐文件把关,这里只钉「热区那一层确实在」。
  assert.match(rule(wxss, '.poi__go'), /height:58rpx/, '.poi__go 视觉高度必须照原型的 30px')
  assert.match(rule(wxss, '.poi__go'), /box-sizing:\s*border-box/)
  assert.match(rule(wxss, '.poi__go::after'), /height:88rpx/, '.poi__go 命中区必须撑到 44px')
  for (const selector of ['.navtop__x', '.gp2__opt-audio']) {
    assert.match(rule(wxss, selector), /width:\s*var\(--cy-btn-h\)/, `${selector} 宽度不足 44px`)
    assert.match(rule(wxss, selector), /height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
  }
}

test('核心游玩页五个紧凑控件统一 44px，播放语义随状态切换', () => {
  assertContract()
})

test('负控：结束导航恢复 56rpx 会判红', () => {
  const wxss = fs.readFileSync(WXSS, 'utf8').replace(
    /(\.navtop__x\s*\{[^}]*?)width:\s*var\(--cy-btn-h\);\s*height:\s*var\(--cy-btn-h\);/s,
    '$1width:56rpx; height:56rpx;',
  )
  assert.throws(() => assertContract({ wxss }), /宽度不足/)
})

test('负控：选项音频退回静态播放名称会判红', () => {
  const wxml = fs.readFileSync(WXML, 'utf8').replace(
    "aria-label=\"{{audioNodeId==='opt'+item.k && audioPlaying ? '暂停选项音频' : '播放选项音频'}}\"",
    'aria-label="播放选项音频"',
  )
  assert.throws(() => assertContract({ wxml }), /gp2__opt-audio/)
})
