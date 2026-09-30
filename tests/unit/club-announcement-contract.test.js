const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const script = fs.readFileSync(path.join(ROOT, 'pages/club/detail/index.js'), 'utf8')
const view = fs.readFileSync(path.join(ROOT, 'pages/club/detail/index.wxml'), 'utf8')
const postCard = fs.readFileSync(path.join(ROOT, 'components/cy/post-card/index.wxml'), 'utf8')

test('内容管理员可发布公告，普通成员的创建请求仍固定为普通动态', () => {
  assert.match(view, /wx:if="\{\{canModerateContent\}\}"[^>]*bindtap="onToggleAnnouncement"/)
  assert.match(script, /type:\s*this\.data\.postAsAnnouncement\s*\?\s*2\s*:\s*0/)
  assert.match(script, /postAsAnnouncement:\s*false/)
})

test('帖子流原位展示置顶公告并提供编辑、置顶和历史入口', () => {
  assert.match(script, /noticeBadge:\s*Number\(p\.type\)\s*===\s*2\s*\?\s*\(isPinned\s*\?\s*'公告 · 置顶'\s*:\s*'公告'\)/)
  assert.match(postCard, /post\.noticeBadge[^>]*>\{\{post\.noticeBadge\}\}/)
  assert.match(view, /catchtap="onEditPost"/)
  assert.match(view, /catchtap="onTogglePin"/)
  assert.match(view, /catchtap="onViewPostHistory"/)
})

test('编辑、置顶和历史都调用独立真接口并在写后回读帖子列表', () => {
  assert.match(script, /url:\s*'\/api\/club\/post\/update'/)
  assert.match(script, /url:\s*'\/api\/club\/post\/pin'/)
  assert.match(script, /url:\s*'\/api\/club\/post\/history'/)
  assert.match(script, /onEditPost[\s\S]*?that\.loadPosts\(\)/)
  assert.match(script, /onTogglePin[\s\S]*?that\.loadPosts\(\)/)
})
