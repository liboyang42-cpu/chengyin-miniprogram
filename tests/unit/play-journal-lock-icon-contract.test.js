// 旅程手记「未点亮的站不剧透」契约。
//
// 2026-09-10 改口:手记按用户裁决照原型 journalScreen 重做成「半屏 + 一行行 .kv」,
// 原来那条断言钉的是「locked 渲染成 DS 的 lock 图标」—— 原型的失效行(.drow.is-off)
// 只是整行压暗,没有图标,这四个模式也不再走 DS 图标那套。
// **但要守的行为一点没变**:未点亮的站必须压暗、且不给展开入口(点进去就是剧透)。
// 断言改成钉这条行为,不是钉某个图标。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const XCX = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(XCX, p), 'utf8')

function assertJournalLockContract(source) {
  const { js, wxml, wxss } = source
  // ① locked 仍是 buildJournal 算出来的语义字段,不是 wxml 现编
  assert.match(js, /seg\.locked = true/, '锁态必须由 buildJournal 判定')
  // ② 行整体压暗
  assert.match(wxml, /class="jkv \{\{item\.locked \? 'is-locked' : ''\}\}"/,
    '未点亮的站必须整行压暗')
  assert.match(wxss, /\.jkv\.is-locked\{[^}]*opacity:\.42/, '压暗必须真有样式,不能只挂个类名')
  // ③ 不给展开入口 —— 点它不触发 openStory,右边的 › 也不出
  assert.match(wxml, /bindtap="\{\{item\.locked \? 'noop' : 'openStory'\}\}"/,
    '未点亮的站点进去就是剧透,不许接 openStory')
  assert.match(wxml, /class="jkv__go" wx:if="\{\{!item\.locked\}\}"/,
    '未点亮的站不该显示可展开的箭头')
}

test('未点亮的站在手记里压暗且不给展开入口', () => {
  assertJournalLockContract({
    js: read('pages/play/index.js'),
    wxml: read('pages/play/index.wxml'),
    wxss: read('pages/play/index.wxss'),
  })

  // ★负控:把锁态的分流去掉(所有行都接 openStory)必须判红
  assert.throws(() => assertJournalLockContract({
    js: read('pages/play/index.js'),
    wxml: read('pages/play/index.wxml').replace(
      /bindtap="\{\{item\.locked \? 'noop' : 'openStory'\}\}"/, 'bindtap="openStory"'),
    wxss: read('pages/play/index.wxss'),
  }), /不许接 openStory/)
})
