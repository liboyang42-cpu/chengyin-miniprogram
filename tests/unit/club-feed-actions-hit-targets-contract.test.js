'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML = path.join(ROOT, 'pages/club/detail/index.wxml')
const WXSS = path.join(ROOT, 'pages/club/detail/index.wxss')
const POST_CARD_WXML = path.join(ROOT, 'components/cy/post-card/index.wxml')
const POST_CARD_WXSS = path.join(ROOT, 'components/cy/post-card/index.wxss')

function rule(source, selector) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const bodies = []
  for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(',').map((item) => item.trim()).includes(selector)) bodies.push(match[2])
  }
  assert.ok(bodies.length, `缺少 ${selector}`)
  return bodies.join('\n')
}

function assertContract(overrides = {}) {
  const wxml = overrides.wxml === undefined ? fs.readFileSync(WXML, 'utf8') : overrides.wxml
  const wxss = overrides.wxss === undefined ? fs.readFileSync(WXSS, 'utf8') : overrides.wxss
  const postCardWxml = fs.readFileSync(POST_CARD_WXML, 'utf8')
  const postCardWxss = fs.readFileSync(POST_CARD_WXSS, 'utf8')
  const del = rule(wxss, '.post-thumb-del')
  assert.match(del, /width:\s*var\(--cy-btn-h\)/)
  assert.match(del, /height:\s*var\(--cy-btn-h\)/)
  for (const selector of ['.post-send', '.post-moderation__action', '.comment-mod', '.comment-send', '.event-group-code']) {
    assert.match(rule(wxss, selector), /min-height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
  }
  assert.match(rule(postCardWxss, '.post-card__action'), /min-height:\s*88rpx/)
  for (const label of [
    '删除发帖图片 {{index + 1}}', '添加发帖图片', '发布俱乐部动态',
    '删除动态', '举报动态', '删除评论', '举报评论', '发送评论',
    '出示 {{item.name}} 团码',
  ]) {
    assert.match(wxml, new RegExp(`aria-label="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `缺少可读名称：${label}`)
  }
  assert.match(postCardWxml, /aria-label="\{\{post\.isLiked == 1 \? '取消点赞' : '点赞'\}\}，当前 \{\{post\.likeCount \|\| 0\}\}"[^>]*aria-pressed="\{\{post\.isLiked == 1\}\}"/)
  assert.match(postCardWxml, /aria-label="查看评论，当前 \{\{post\.commentCount \|\| 0\}\}"/)
}

test('俱乐部发帖、互动、评论与团码动作均满足 44px 和可读语义', () => {
  assertContract()
})

test('负控：发帖图片删除退回 36rpx 会判红', () => {
  const wxss = fs.readFileSync(WXSS, 'utf8').replace(
    /(\.post-thumb-del\s*\{[^}]*?)width:\s*var\(--cy-btn-h\);\s*height:\s*var\(--cy-btn-h\);/s,
    '$1width:36rpx; height:36rpx;',
  )
  assert.throws(() => assertContract({ wxss }), /--cy-btn-h/)
})

test('负控：删除动态丢失动作名称会判红', () => {
  const wxml = fs.readFileSync(WXML, 'utf8').replace(' aria-label="删除动态"', '')
  assert.throws(() => assertContract({ wxml }), /删除动态/)
})
