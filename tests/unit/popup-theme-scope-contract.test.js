// 弹窗主题作用域契约(2026-08-04)
//
// 背景:结算/订单域拍板「玩家侧纯黑、商家侧正常白」。配色本身由 token 作用域决定——
// 页面根节点挂 .theme-merchant / .theme-light / .theme-topic-editor 就得日间值,
// 不挂就落玩家夜间默认。cy-sheet / cy-modal 全走 token,本身没有硬编码色。
//
// ⚠️ 真正的坑不在颜色值,在「节点位置」:弹窗是 fixed 层,写 wxml 时习惯甩在根容器
// 外面(平级于根 <view>)。它就取不到根上的主题变量 ⇒ 白底商家页弹出一个玩家黑弹窗,
// 零报错、零告警。同一个坑 2026-08-04 已在 member/index 的 tabBar 上实拍到一次
// (白页配黑底栏),弹窗是同一类。
//
// 修法两选一:①把弹窗移进主题容器内 ②主题类直接挂弹窗宿主节点
// (变量继承不受自定义组件样式隔离影响——隔离挡的是类选择器,不挡变量继承)。
// 本契约两种都认。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const PAGES = path.join(__dirname, '../../pages')
const LIGHT_THEME = /\btheme-(merchant|light|topic-editor)\b/
// 2026-09-02:cy-option-sheet 内部就是一个 cy-sheet(收编 wx.showActionSheet 用的平列表壳),
// 同样是 fixed 层、同样会被甩在主题容器外,必须一起看住。
const POPUP_TAG = /<(cy-sheet|cy-modal|cy-option-sheet)\b/

function listWxml(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listWxml(full))
    else if (entry.name.endsWith('.wxml')) out.push(full)
  }
  return out
}

// 返回:该 wxml 里「落在浅色主题容器外、自己也没挂主题类」的弹窗标签数组。
// 走标签栈,遇到挂主题类的开标签就记下深度,出栈到该深度以下才算离开作用域。
function straySheets(source) {
  // ⚠️ 必须先剥注释:wxml 注释里常抄着标签片段(<view class="...">),不剥就会把注释
  // 当成真节点压栈,祖先链整体虚高 ⇒ 容器外的弹窗被误判成容器内(实测踩过这个假绿)。
  const wxml = source.replace(/<!--[\s\S]*?-->/g, '')
  const tokens = [...wxml.matchAll(/<\/?[a-zA-Z-]+\b[^>]*?\/?>/g)]
  const stack = []
  let themeDepth = -1
  const strays = []
  for (const t of tokens) {
    const raw = t[0]
    if (raw.startsWith('</')) {
      stack.pop()
      if (themeDepth >= 0 && stack.length <= themeDepth) themeDepth = -1
      continue
    }
    const selfClosing = raw.endsWith('/>')
    const hasTheme = LIGHT_THEME.test(raw)
    // 弹窗自己挂了主题类,或身处主题容器内,两者任一即合格
    if (POPUP_TAG.test(raw) && themeDepth < 0 && !hasTheme) strays.push(raw)
    if (!selfClosing) {
      if (hasTheme && themeDepth < 0) themeDepth = stack.length
      stack.push(raw)
    }
  }
  return strays
}

// 只管「页面里出现过浅色主题作用域」的那些页 —— 纯玩家夜间页不挂类是正确状态,
// 它的弹窗本来就该跟着默认夜间走,不该被这条契约拖进来。
function lightScopedPages() {
  return listWxml(PAGES)
    .map(f => ({ file: f, wxml: fs.readFileSync(f, 'utf8') }))
    .filter(p => LIGHT_THEME.test(p.wxml) && POPUP_TAG.test(p.wxml))
}

test('浅色/商家页的弹窗必须落在主题作用域内(否则白页弹黑窗)', () => {
  const offenders = lightScopedPages()
    .map(p => ({ file: path.relative(PAGES, p.file), strays: straySheets(p.wxml) }))
    .filter(p => p.strays.length)

  assert.deepEqual(
    offenders.map(o => o.file),
    [],
    '这些页的 cy-sheet/cy-modal 挂在主题容器外且自身没挂主题类,商家/浅色态会弹出玩家黑弹窗:\n' +
      offenders.map(o => `  ${o.file}\n` + o.strays.map(s => `    ${s.slice(0, 100)}`).join('\n')).join('\n'),
  )
})

// ⚠️ 负控用构造字符串,不拿真实页面当变异锚点:页面归属哪个主题会随别的改动漂移,
//    绑上去的负控在别人改动后会莫名其妙地红(实测:在干净 master 上 member/index
//    还没做商家双态,三个 sheet 本就在容器外,"基线应当干净"直接断言失败)。
//    契约要抓的是【规则】,不是某一页此刻的样子。
test('negative control: 把主题类从弹窗宿主节点上摘掉必须判红', () => {
  const good =
    '<view class="p theme-merchant"></view>\n' +
    '<cy-sheet class="theme-merchant" show="{{a}}"></cy-sheet>\n' +
    '<cy-sheet class="theme-merchant" show="{{b}}"></cy-sheet>'
  assert.equal(straySheets(good).length, 0, '宿主自带主题类的弹窗不该被抓')
  const mutated = good.replace(/<cy-sheet class="theme-merchant" /g, '<cy-sheet ')
  assert.notEqual(mutated, good, '变异锚点失效')
  assert.equal(straySheets(mutated).length, 2, '摘掉主题类后两个弹窗都必须被抓出来')
})

// 注释里抄标签片段是本仓常见写法,解析器不剥注释就会假绿(实测踩过)。
test('negative control: 注释里的假标签不得把容器外的弹窗洗成合格', () => {
  const fake =
    '<view class="p theme-merchant"></view>\n' +
    '<!-- 参考写法:<view class="p theme-merchant"> -->\n' +
    '<cy-sheet show="{{a}}"></cy-sheet>'
  assert.equal(straySheets(fake).length, 1, '注释必须被剥掉,弹窗仍应判为容器外')
})

// ============================================================================
// 第二层:位置对了,取到的值也得对(2026-08-10 补)
//
// 上面那条只校验「弹窗有没有落在主题容器内」。2026-08-10 实拍发现位置全对、颜色照样
// 全黑:pages/publish/fabu 的主题详情弹窗在 .theme-topic-editor 容器内,却是玩家黑弹窗。
// 根因不在页面,在 tokens.wxss —— cy-sheet 的 .sh__panel 只消费 --cy-comp-sheet-role-*,
// 基础 page{} 把这组指向 player(暗),.theme-light/.theme-merchant 早已整组切白,
// 唯独 .theme-topic-editor 整组缺席,于是继承回暗端。同一个洞当时打中 5 个页面。
//
// ⚠️ 所需 token 名不写死在测试里,从 cy-sheet 自己的 wxss 里反解「它实际消费了哪些」——
// 组件哪天多读一个 role token,本契约自动跟着要求各主题块补上,不会悄悄失效。
// ============================================================================
const XCX = path.join(__dirname, '../..')
const SHEET_WXSS = fs.readFileSync(path.join(XCX, 'components/cy/sheet/index.wxss'), 'utf8')
const TOKENS_WXSS = fs.readFileSync(path.join(XCX, 'style/tokens.wxss'), 'utf8')

// cy-sheet 面板实际 var() 读到的 role token 全集
function requiredRoleTokens(sheetWxss) {
  const names = new Set()
  for (const m of sheetWxss.matchAll(/var\(\s*(--cy-comp-sheet-role-[\w-]+)/g)) names.add(m[1])
  return [...names].sort()
}

// 取出「浅色主题根」块的声明体。只认纯根选择器(page.theme-x / .theme-x),
// 不认 `.theme-light .foo` 这类后代规则 —— 那些不是主题档,不该被要求声明整组。
const THEME_ROOT_PART = /^(page)?\.theme-(light|merchant|topic-editor)$/
function lightThemeRootBlocks(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = m[1].split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length && parts.every(p => THEME_ROOT_PART.test(p))) out.push({ selector: parts.join(','), body: m[2] })
  }
  return out
}

// 返回缺陷描述数组(空 = 合格)。缺声明、或声明了却指回 player 暗档,都算缺陷。
function roleTokenDefects(sheetWxss, tokensCss) {
  const required = requiredRoleTokens(sheetWxss)
  const defects = []
  for (const block of lightThemeRootBlocks(tokensCss)) {
    for (const name of required) {
      const decl = new RegExp(`(^|;|\\s)${name}\\s*:\\s*([^;]+)`, 'm').exec(block.body)
      if (!decl) { defects.push(`${block.selector} 缺 ${name}`); continue }
      if (/player/.test(decl[2])) defects.push(`${block.selector} 的 ${name} 指回了玩家暗档:${decl[2].trim()}`)
    }
  }
  return defects
}

test('浅色主题块必须整组声明 cy-sheet 消费的 role token(否则位置对、颜色仍是玩家黑)', () => {
  const required = requiredRoleTokens(SHEET_WXSS)
  assert.ok(required.length >= 10, `从 cy-sheet 只解析出 ${required.length} 个 role token,反解逻辑八成失效了`)
  assert.deepEqual(roleTokenDefects(SHEET_WXSS, TOKENS_WXSS), [])
})

test('negative control: 从 .theme-topic-editor 摘掉这组声明必须判红', () => {
  const idx = TOKENS_WXSS.indexOf('.theme-topic-editor {')
  assert.notEqual(idx, -1, '锚点失效:tokens.wxss 里找不到 .theme-topic-editor 块')
  const end = TOKENS_WXSS.indexOf('\n}', idx)
  const head = TOKENS_WXSS.slice(0, idx)
  const block = TOKENS_WXSS.slice(idx, end)
  const stripped = block.replace(/^\s*--cy-comp-sheet-role-[\w-]+\s*:[^;]+;\s*$/gm, '')
  assert.notEqual(stripped, block, '变异锚点失效:该块里压根没有 role 声明可摘')
  const mutated = head + stripped + TOKENS_WXSS.slice(end)
  const defects = roleTokenDefects(SHEET_WXSS, mutated)
  assert.ok(defects.length > 0, '摘掉整组声明后必须判红')
  assert.ok(defects.every(d => d.includes('theme-topic-editor')), `只应抓 topic-editor,实际:${defects.join(' / ')}`)
})

test('negative control: 把某个 role token 改回 player 值必须判红(补了名字不等于补对了档)', () => {
  const mutated = TOKENS_WXSS.replace(
    /--cy-comp-sheet-role-text:\s*var\(--cy-comp-sheet-merchant-title\);/,
    '--cy-comp-sheet-role-text: var(--cy-comp-sheet-player-text);',
  )
  assert.notEqual(mutated, TOKENS_WXSS, '变异锚点失效')
  assert.ok(
    roleTokenDefects(SHEET_WXSS, mutated).some(d => d.includes('指回了玩家暗档')),
    '声明存在但取值是玩家暗档,必须判红',
  )
})

test('negative control: 后代规则(.theme-light .foo)不得被要求声明整组', () => {
  const fake = '.theme-light .foo { color: red; }\n' + TOKENS_WXSS
  assert.deepEqual(roleTokenDefects(SHEET_WXSS, fake), [], '只有主题根块才是主题档,后代规则不该被抓')
})

test('negative control: 把弹窗从主题容器内挪到容器外必须判红', () => {
  // 合格形态:弹窗在挂了主题类的根容器内
  const good = '<view class="p theme-merchant"><cy-sheet show="{{a}}"></cy-sheet></view>'
  assert.equal(straySheets(good).length, 0, '容器内的弹窗不该被抓')
  // 同一个弹窗挪到容器外 —— 只改位置,不改任何颜色值
  const bad = '<view class="p theme-merchant"></view><cy-sheet show="{{a}}"></cy-sheet>'
  assert.equal(straySheets(bad).length, 1, '容器外的弹窗必须被抓')
})
