const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '../../')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

// publish/simple、roam/history、roam/passport、roam/session 已被后续「2026-07-29 裁决」
// 移出这条统一 cy-nav-bar 规则:AI 页自带品牌头、漫游三页统一成裸 chevron 的页面级出口
// (hs-back/pp-x/ss-x 现在是这些页**当前**的实现,不是要清理的 legacy)。这里只留仍然
// 走共享 cy-nav-bar 显式 title 模式的页面。
// 2026-09-06 裁决:申请页的大标题用回共享的 cy-page-title(房规「能用 cy-* 就用」),
// 不再自绘 .ca-q。收口保护的三件事没变 —— 返回出口走共享 nav、nav 不重复标题、
// 顶部安全区有占位 —— 只有"标题由哪个节点承担"这一条随裁决更新。
const pages = [
  ['pages/club/apply/index', /<cy-page-title title="\{\{mode==='done' \? '成为主理人' : stepTitle\}\}"/, 'back-pill'],
]

function assertUnifiedNav(page, titlePattern, legacyClass) {
  const json = JSON.parse(read(`${page}.json`))
  assert.equal(json.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index', `${page} must use cy-nav-bar`)
  const wxml = read(`${page}.wxml`)
  assert.match(wxml, titlePattern, `${page} page must own the dynamic form heading`)
  assert.doesNotMatch(wxml, /<cy-nav-bar[^>]*title="[^"]+"/, `${page} must not duplicate the title in cy-nav-bar`)
  assert.match(wxml, /custom-back\s+bind:back=/, `${page} must own its back action through the shared nav`)
  assert.doesNotMatch(wxml, new RegExp(`class="[^"]*${legacyClass}[^"]*"`), `${page} must not render its legacy back control`)
  assert.match(wxml, /statusBarHeight\s*\+\s*navBarHeight/, `${page} must reserve the native top inset`)
}

test('玩家二级/三级页面统一使用 cy-nav-bar 与安全区占位', () => {
  pages.forEach(([page, titlePattern, legacyClass]) => assertUnifiedNav(page, titlePattern, legacyClass))
})

test('导航负控：重新挂回任一旧返回控件必须判红', () => {
  const wxml = read('subpackageRoam/history/index.wxml')
  assert.throws(() => {
    // ⚠️ 原锚点 '<view class="hs-nav-spacer"' 在 wxml 里根本不存在,replace 是空操作 ——
    // 这条负控一直是靠「原文本来就有 hs-back」才抛异常的假绿。2026-08-04 收口后原文没了
    // hs-back,它才诚实地红出来。锚点改挂到收口后真实存在的 cy-nav-bar 上。
    const mutated = wxml.replace('<cy-nav-bar plain', '<view class="hs-back">‹</view>\n  <cy-nav-bar plain')
    assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
    assert.doesNotMatch(mutated, /class="hs-back"/, 'history must not render a duplicate legacy back control')
  })
})

// 原来这条锁的是「文字标签放按钮内侧(row-reverse)」,目的是别被右缘裁掉。
// 2026-08-04 做减法后文字标签整个撤了,.fmap-tool 也不存在了 —— 锁法失效,但**担心的事没变**:
// 控件轨不能贴到屏幕右缘之外。改为直接锁那个真原因。
test('地图工具轨从右缘留出边距，不会被裁切', () => {
  const wxss = read('components/cy/free-map/index.wxss')
  const right = wxss.match(/\.fmap-ctrl\s*\{[^}]*right:\s*(\d+)rpx/s)
  assert.ok(right, '.fmap-ctrl 必须显式声明 right 偏移')
  assert.ok(Number(right[1]) >= 16, `控件轨右边距 ${right[1]}rpx 太小,按钮会贴边`)
  assert.doesNotMatch(wxss, /\.fmap-tool\s*\{/, '.fmap-tool 已随文字标签一并移除,别复活')
})

test('主题详情两种顶栏状态复用 DS back 图标而不是拉伸 PNG', () => {
  const json = JSON.parse(read('pages/topic/index/index.json'))
  const wxml = read('pages/topic/index/index.wxml')
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.equal((wxml.match(/<cy-icon name="back"/g) || []).length, 2)
  assert.doesNotMatch(wxml, /icon_back\.png/)
})

test('主题详情返回图标负控：恢复旧 PNG 必须判红', () => {
  const wxml = read('pages/topic/index/index.wxml').replace('<cy-icon name="back" size="40" />', '<image src="/subpackageP3/images/icon_back.png" />')
  assert.throws(() => assert.doesNotMatch(wxml, /icon_back\.png/))
})

// tabBar 页只能用 switchTab。navigateTo/redirectTo 指向 tabBar 页时微信直接失败,
// 且不抛异常、不弹提示 —— 表现为「按钮点了没反应」,肉眼走查抓不到。
// 2026-08-05 实证:subpackageRoam/passport 的 goRoam/goBack 两处这样写,漫游护照返不回漫游首页。
const TAB_PAGES = new Set(
  JSON.parse(read('app.json')).tabBar.list.map((item) => item.pagePath)
)

function findTabNavViolations(source) {
  const hits = []
  // 只读当前调用对象里的 url；遇到嵌套的 wx.* fallback 就停止，避免把
  // redirectTo({ fail: () => wx.switchTab(...) }) 错配成 redirectTo 的目标。
  const re = /wx\.(navigateTo|redirectTo)\(\s*\{(?:(?!\bwx\.|}).)*?\burl:\s*['"`]\/([^'"`?]+)/gs
  let m
  while ((m = re.exec(source)) !== null) {
    if (TAB_PAGES.has(m[2])) hits.push(`wx.${m[1]} -> ${m[2]}`)
  }
  return hits
}

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walkJs(rel, out)
    else if (entry.name.endsWith('.js')) out.push(rel)
  }
  return out
}

test('tabBar 页只能用 switchTab 进入,不能 navigateTo/redirectTo', () => {
  const violations = []
  for (const dir of ['pages', 'components', 'utils', 'subpackageA', 'subpackageB', 'subpackageP3']) {
    for (const file of walkJs(dir)) {
      findTabNavViolations(read(file)).forEach((hit) => violations.push(`${file}: ${hit}`))
    }
  }
  assert.deepEqual(violations, [], `tabBar 页必须用 wx.switchTab,以下调用会静默失败:\n${violations.join('\n')}`)
})

test('tabBar 导航负控：把 switchTab 改回 redirectTo 必须判红', () => {
  // 变异锚点原为 subpackageRoam/passport/index.js,该页 2026-08-10 已整页删除;
  // 换成 components/cy/profile —— 它在上面那条测试真正扫描的目录里,锚点比原来更贴。
  const source = read('components/cy/profile/index.js')
  const mutated = source.replace(
    "wx.switchTab({ url: '/pages/roam/index' })",
    "wx.redirectTo({ url: '/pages/roam/index' })"
  )
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.deepEqual(findTabNavViolations(mutated), ['wx.redirectTo -> pages/roam/index'])
})
