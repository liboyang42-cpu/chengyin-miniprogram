const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function visibleMarkup(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

test('俱乐部主页用真实资源与 DS 图标，不把字符伪装成按钮图形', () => {
  const view = visibleMarkup(read('pages/club/detail/index.wxml'))
  assert.doesNotMatch(view, />\s*[›×+]\s*</, '箭头、关闭、加图必须使用真实图标组件')
  assert.doesNotMatch(view, /cover-fallback-mark/, '缺封面不能用首字伪造视觉资产')
  assert.doesNotMatch(view, /route_city_cover\.png/, '俱乐部缺封面时不能拿路线业务图冒充真实封面')
  assert.match(view, /<image\b[^>]*wx:if="\{\{club\.cover\}\}"[^>]*src="\{\{club\.cover\}\}"/)
  // 2026-09-02:缺封面不再是「灰底 + 图片图标」,改用稿 304:395「默认俱乐部顶图 / BG-11 一起玩」
  // 那张插画资源。本条守的仍是原来那件事 —— 兜底必须是**真实图片资产**且对读屏可感知,
  // 只是资产从 DS 图标换成了专门画的默认封面,所以 aria-label 也从「暂无封面」改成「使用默认封面」。
  assert.match(view, /<view\b[^>]*wx:else[^>]*class="cover-fallback"[^>]*aria-role="img"[^>]*aria-label="\{\{club\.name\}\} 使用默认封面"/)
  assert.match(view, /<image\b[^>]*class="cover-fallback-art"[^>]*src="\/pages\/club\/images\/club_cover_default\.png"[^>]*mode="aspectFill"/,
    '缺封面必须落到真实的默认封面图片资产上,不能又退回字符/图标凑数')
  assert.match(view, /<cy-icon\b[^>]*name="close-sm"/)
  assert.match(view, /<cy-icon\b[^>]*name="image"/)
  assert.ok((view.match(/<cy-icon\b[^>]*name="arrow-right"/g) || []).length >= 10)
})

test('俱乐部首载与错误恢复状态对读屏和触控均可感知', () => {
  const view = read('pages/club/detail/index.wxml')
  assert.match(view, /class="empty error-state"[^>]*aria-role="alert"[^>]*aria-live="polite"/)
  assert.match(view, /class="error-primary"[^>]*aria-role="button"[^>]*aria-label="重新加载俱乐部"/)
  assert.match(view, /class="error-secondary"[^>]*aria-role="button"[^>]*aria-label="返回俱乐部管理"/)
  assert.match(view, /<cy-skeleton\b[^>]*wx:elif="\{\{!detailLoaded\}\}"[^>]*loading-label="正在加载俱乐部详情"/)
  assert.match(view, /ownerStage === 'loading'[\s\S]*aria-disabled="\{\{ownerStage === 'loading'\}\}"/)
})

test('俱乐部管理入口统一暴露按钮语义和最小命中区', () => {
  const view = read('pages/club/detail/index.wxml')
  const style0 = () => read('pages/club/detail/index.wxss')
  // 2026-08-26 管理 tab 收敛:小节标题里的 .sec-link 换成了「折叠行 + 设置弹窗行」。
  // 要守的还是同一条 —— 每个管理入口都得有按钮语义,并且命中区不低于 --cy-btn-h。
  const foldRows = view.match(/class="manage-fold-row"[\s\S]{0,240}?aria-role="button"/g) || []
  assert.ok(foldRows.length >= 4, `经营折叠行需 >=4 个且带按钮语义,实得 ${foldRows.length}`)
  assert.ok((view.match(/aria-expanded="\{\{openManageSection === '[a-z]+'\}\}"/g) || []).length >= 4,
    '折叠行必须对读屏暴露展开态')
  const setRows = view.match(/class="cset-row"[\s\S]{0,320}?aria-role="button"/g) || []
  assert.ok(setRows.length >= 5, `设置弹窗行需 >=5 个且带按钮语义,实得 ${setRows.length}`)
  // 2026-09-02 对稿(Figma 23:14 MembersHead):邀请成员从 .member-invite 挪成分区头右侧文字链
  // 2026-09-24 CU-C-61:两处邀请成员都换成原生 <button open-type="share">(按钮语义由原生按钮提供)
  assert.match(view, /<button[^>]*class="ov-head-link"[^>]*aria-label="邀请成员"/, '概览仍保留邀请成员入口')
  assert.match(view, /class="cset-panel-act"[^>]*open-type="share"[^>]*aria-label="邀请成员"/, '成员管理面板内保留邀请成员')
  assert.match(style0(), /\.manage-add-row\s*\{[^}]*min-height:\s*var\(--cy-btn-h\)/s, '发布主题行命中区不得低于 --cy-btn-h')
  assert.match(style0(), /\.cset-panel-act\s*\{[^}]*min-height:\s*var\(--cy-btn-h\)/s, '弹窗内文字动作命中区不得低于 --cy-btn-h')
  const style = read('pages/club/detail/index.wxss')
  assert.match(style, /\.cover-fallback\s*\{[^}]*background:\s*var\(--cy-bg-card-2\)[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s)
  assert.match(style, /\.manage-chevron\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(style, /\.post-addimg\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s)
})
