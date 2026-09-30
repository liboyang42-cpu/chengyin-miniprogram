// WT2「DS/组件 ADA 基建」契约(2026-07-29)
//
// 每条断言都配一条负控:先证明「注入错误必红」,再让正向断言有意义。
// 禁止「常量==常量」——所有断言都读磁盘上的真实源码/真实模块行为。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

// ============================================================
// 1) cy-nav-bar 返回钮:视觉裸 chevron,无可见圆背景(2026-07-29 设计裁决)
// ============================================================
// ⚠️ 本节的正负极性在 2026-07-29 被总控设计裁决翻过面:
//   旧要求 = 64rpx 圆 chip 成为全站默认;
//   新裁决 = 二级页返回是**视觉裸 chevron,不得有可见圆背景**,命中区仍 ≥88rpx(44pt)。
//   所以负控也跟着翻面:现在「私自给默认返回钮加圆背景」才是必须判红的那一侧。
//   pill(hero 玻璃胶囊)不受裁决影响 —— 它是「压在照片上没底就看不见箭头」的显式 opt-in。

function assertNavBackBare(wxss) {
  const base = wxss.match(/\.nav__back-inner \{[\s\S]*?\n\}/)
  assert.ok(base, 'cy-nav-bar 必须有默认返回钮内层 .nav__back-inner')
  // 「裸」的判据是三条否定 + 一条命中区肯定,不是「长得像箭头」
  assert.doesNotMatch(base[0], /background\s*:/, '默认返回钮不得有可见背景(裁决:裸 chevron)')
  assert.doesNotMatch(base[0], /border-radius\s*:/, '默认返回钮不得有圆角背景')
  assert.doesNotMatch(base[0], /border\s*:/, '默认返回钮不得有描边')
  // tint 分支同样不许偷偷补底(此前的 chip 实现就是从这里给亮/暗 hero 各塞了一个底)
  assert.doesNotMatch(wxss, /\.nav--tint-(dark|light) \.nav__back-inner[^{]*\{[^}]*background/,
    'tint 分支也不得给默认返回钮补背景')

  // 命中区:视觉收掉了,触控面积一点不能少(裁决明确要求 ≥88rpx / 44pt)
  const hit = wxss.match(/\.nav__back \{[\s\S]*?\n\}/)
  assert.ok(hit, '找不到 .nav__back 命中区规则')
  const width = hit[0].match(/width:\s*(\d+)rpx/)
  assert.ok(width, '命中区必须显式给宽度')
  assert.ok(Number(width[1]) >= 88, `返回钮命中区必须 ≥88rpx,实为 ${width[1]}rpx`)
  assert.match(hit[0], /color:\s*var\(--cy-text-title\)/, '箭头色必须随主题 token(chevron 走 currentColor)')

  // pill 是独立 opt-in 语义,不能被"裸 chevron"顺手删掉
  assert.match(wxss, /\.nav__back-inner--pill \{[\s\S]*?backdrop-filter/, 'pill(hero 玻璃胶囊)语义必须保留')
}

test('cy-nav-bar 返回钮默认态 = 视觉裸 chevron,无可见圆背景,命中区仍 ≥88rpx', () => {
  assertNavBackBare(read('components/cy/nav-bar/index.wxss'))
})

// 2026-07-29 裁决(第二版):普通二级页 = 居中导航标题 + 裸 chevron 返回,不再另起大标题。
// WT2 只负责「组件具备这个能力」;页面迁移(把大标题收回导航条)留给后续全页轮次。
// 判据是能力,不是页面用没用:标题槽必须是几何居中且左右留等宽 gutter,右侧 action 变宽也不挤偏。
function assertNavCenteredTitle(wxss, wxml) {
  // 几何居中的唯一模板写法:左右绑**同一个**变量。
  // ⚠️ 2026-07-29 复核阻塞项 1:旧写法 left=actionsRight / right=titleRight 左右不等,
  //   右 action 一宽,标题的几何中心就被推向左边 —— 那不是居中,是"没被遮住"而已。
  assert.match(wxml, /class="nav__title"[^>]*style="left: \{\{titleLeft\}\}px; right: \{\{titleRight\}\}px;"/,
    '标题槽必须用左右两个内距变量,由 _titleInsets 保证恒相等')
  assert.match(wxml, /<view wx:if="\{\{showTitle\}\}" class="nav__title"/,
    '槽窄到读不出词时必须整个不渲染(裁决:不许挤成 0 宽,也不许左偏)')
  const title = wxss.match(/\.nav__title \{[\s\S]*?\n\}/)
  assert.ok(title, '找不到 .nav__title 规则')
  assert.match(title[0], /position:\s*absolute/, '标题必须脱离流居中,不能跟着返回钮排')
  assert.match(title[0], /text-align:\s*center/, '二级页导航标题必须居中')
  assert.match(title[0], /text-overflow:\s*ellipsis/, '长标题必须省略号收尾而不是撑破导航条')
  assert.match(title[0], /color:\s*var\(--cy-text-title\)/, '标题色随主题 token')
}

test('cy-nav-bar 具备「居中导航标题」能力(裁决二:普通二级页标准形态)', () => {
  assertNavCenteredTitle(read('components/cy/nav-bar/index.wxss'), read('components/cy/nav-bar/index.wxml'))
})

test('负控:标题槽退成左对齐 / 去掉 gutter 必须判红', () => {
  const wxss = read('components/cy/nav-bar/index.wxss')
  const mutated = wxss.replace('  text-align: center;\n', '')
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertNavCenteredTitle(mutated, read('components/cy/nav-bar/index.wxml')), assert.AssertionError)

  const wxml = read('components/cy/nav-bar/index.wxml')
  const mutatedWxml = wxml.replace('style="left: {{titleLeft}}px; right: {{titleRight}}px;"', '')
  assert.notEqual(mutatedWxml, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertNavCenteredTitle(wxss, mutatedWxml), assert.AssertionError)
})

test('负控:去掉「槽太窄就不渲染标题」的闸(退回挤成 0 宽)必须判红', () => {
  const wxss = read('components/cy/nav-bar/index.wxss')
  const wxml = read('components/cy/nav-bar/index.wxml')
  const mutatedWxml = wxml.replace('<view wx:if="{{showTitle}}" class="nav__title"', '<view class="nav__title"')
  assert.notEqual(mutatedWxml, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertNavCenteredTitle(wxss, mutatedWxml), assert.AssertionError)
})

// 直接跑组件的纯算法 _titleInsets,不必造整套生命周期
function titleInsets(windowWidth, actionsRight, actionWidth) {
  const prevGetApp = global.getApp
  const prevWx = global.wx
  global.getApp = () => ({ globalData: {} })
  global.wx = { getWindowInfo: () => ({ windowWidth }) }
  try {
    const options = loadComponent('components/cy/nav-bar/index.js')
    assert.ok(options.methods && options.methods._titleInsets, 'cy-nav-bar 必须有 _titleInsets 纯算法')
    return options.methods._titleInsets(windowWidth, actionsRight, actionWidth)
  } finally {
    global.getApp = prevGetApp
    global.wx = prevWx
  }
}

test('cy-nav-bar 行为:普通 action 宽度下标题严格几何居中(左右内距恒相等)', () => {
  // 2026-07-29 裁决:①几何居中 ②不与 action 重叠 —— 这两条永不让步。
  ;[[375, 96, 0], [375, 96, 40], [375, 96, 60], [414, 96, 80], [320, 90, 30]].forEach(([sw, ar, aw]) => {
    const r = titleInsets(sw, ar, aw)
    assert.equal(r.titleLeft, r.titleRight,
      `sw=${sw} action=${aw}:左右内距必须相等,不等即标题偏离几何中心`)
    if (aw > 8) {
      assert.ok(r.titleLeft >= ar + aw,
        `sw=${sw} action=${aw}:内距(${r.titleLeft})必须把 action 完整让开,否则标题压住它`)
    }
  })
  // 无 action 页零漂移:退回基线,不被窄 action 反向收小
  const bare = titleInsets(375, 96, 0)
  assert.equal(bare.titleLeft, 96)
  assert.equal(bare.showTitle, true, '无 action 页当然要显示标题')
})

test('cy-nav-bar 行为:槽窄到读不出词时整个不渲染标题(不挤 0 宽、不左偏)', () => {
  // 实测出来的那一档:375pt + 「看公开主页」胶囊(≈98px)⇒ 对称内距 218,可用宽度为负。
  // 裁决:此时不渲染 nav 标题,语义由页面自己的内容标题承担。
  const squeezed = titleInsets(375, 96, 98)
  assert.equal(squeezed.titleLeft, squeezed.titleRight, '即便降级也不许左右不等(不许左偏)')
  assert.equal(squeezed.showTitle, false, '可用槽宽为负,必须整个不渲染而不是挤成 0 宽')
  assert.ok(375 - squeezed.titleLeft * 2 < 96, '这一档的可用宽度确实低于最小可读宽度')

  // 边界两侧各取一点,证明闸是连续的而不是写死某个宽度
  // 还放得下的那一侧:窄 action(≈16px 图标)+ 更宽的屏
  assert.equal(titleInsets(414, 96, 16).showTitle, true, '还放得下就必须显示')
  assert.equal(titleInsets(375, 96, 0).showTitle, true, '无 action 页必须显示')
  // 逐格逼近:showTitle 必须从 true 单调翻到 false,不能来回跳
  let flipped = false
  for (let aw = 0; aw <= 160; aw += 4) {
    const r = titleInsets(375, 96, aw)
    if (!r.showTitle) flipped = true
    else assert.equal(flipped, false, `action=${aw}:showTitle 翻成 false 后不得又变回 true`)
  }
  assert.ok(flipped, '宽到一定程度必须真的翻成不渲染')
})

test('负控(已翻面):默认返回钮私自加可见圆背景必须判红', () => {
  const source = read('components/cy/nav-bar/index.wxss')
  const mutated = source.replace(
    '.nav__back-inner {\n  display: flex;',
    '.nav__back-inner {\n  background: var(--cy-bg-glass);\n  border-radius: 50%;\n  display: flex;',
  )
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertNavBackBare(mutated), assert.AssertionError)
})

test('负控:从 tint 分支偷偷给返回钮补底必须判红', () => {
  const source = read('components/cy/nav-bar/index.wxss')
  const mutated = source + '\n.nav--tint-light .nav__back-inner { background: var(--cy-bg-glass); }\n'
  assert.throws(() => assertNavBackBare(mutated), assert.AssertionError)
})

test('负控:把命中区从 88rpx 缩小(视觉收了连触控一起收)必须判红', () => {
  const source = read('components/cy/nav-bar/index.wxss')
  const mutated = source.replace('  width: 88rpx;', '  width: 64rpx;')
  assert.notEqual(mutated, source, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertNavBackBare(mutated), assert.AssertionError)
})

// ============================================================
// 2) cy-footer-bar:固定底栏 + 安全区 + 不透明承托
// ============================================================
function assertFooterBar(files) {
  assert.match(files.wxml, /<view class="cy-footer-bar/, 'footer-bar 必须有根节点')
  assert.match(files.wxml, /<slot/, 'footer-bar 必须留自定义槽(复合底栏用)')
  assert.match(files.wxml, /<cy-btn[\s\S]*?bindtap="onPrimary"/, '主按钮必须复用 cy-btn,不自造按钮')
  assert.match(files.json, /"cy-btn"\s*:\s*"\.\.\/btn\/index"/, 'footer-bar 必须声明 cy-btn')

  const root = files.wxss.match(/\.cy-footer-bar \{[\s\S]*?\n\}/)
  assert.ok(root, '找不到 .cy-footer-bar 规则')
  assert.match(root[0], /position:\s*fixed/, '底栏必须 fixed')
  assert.match(root[0], /bottom:\s*0/, '底栏必须贴底')
  // 安全区:这条没了 = iPhone 上按钮压在 home indicator 上
  assert.match(root[0], /padding-bottom:\s*calc\([\s\S]*?env\(safe-area-inset-bottom\)/,
    '底栏底部内距必须含 env(safe-area-inset-bottom)')
  // 不透明承托:半透明底会让滚动内容从按钮下透出来
  assert.match(root[0], /background:\s*var\(--cy-color-bg-page\)/, '承托底必须与页面同底且不透明')

  const actions = files.wxss.match(/\.cy-footer-bar__actions \{[\s\S]*?\n\}/)
  assert.ok(actions, '找不到 .cy-footer-bar__actions 规则')
  assert.doesNotMatch(actions[0], /--cy-btn-h\s*:/, '底栏主按钮不得另起局部高度档')
  assert.match(read('style/tokens.wxss'), /--cy-btn-h:\s*88rpx/, '底栏主按钮必须消费全站默认高度档')
}

const footerFiles = () => ({
  wxml: read('components/cy/footer-bar/index.wxml'),
  wxss: read('components/cy/footer-bar/index.wxss'),
  json: read('components/cy/footer-bar/index.json'),
  js: read('components/cy/footer-bar/index.js'),
})

test('cy-footer-bar 组件成立:fixed 底 + 安全区 + 不透明承托 + 复用 cy-btn', () => {
  assert.ok(exists('components/cy/footer-bar/index.js'), 'footer-bar 组件必须存在')
  assertFooterBar(footerFiles())
})

// Standards(非阻塞项 A):index.js 注释让页面「留出 --cy-comp-footer-h 的底部空白」,
// 但这个 token 从来没被定义过 —— 页面照抄会解析成空值,等于没留空白、末条内容被动作条压住。
// 判据不是"注释里提了这个名字",而是「它真被定义」且「构成与组件盒子逐项对应」。
function assertFooterHeightToken(tokens, footerWxss, footerJs) {
  const decl = tokens.match(/--cy-comp-footer-h:\s*([^;]+);/)
  assert.ok(decl, 'index.js 注释引用的 --cy-comp-footer-h 必须真被定义')
  const value = decl[1]
  // 组件盒子 = 上内距 + 按钮 + 下内距 + 安全区;占位高必须与这四项一一对应,少一项就压内容
  assert.match(value, /var\(--cy-btn-h\)/, '占位高必须含全站默认按钮高')
  assert.match(value, /var\(--cy-comp-footer-pad-y\) \* 2/, '占位高必须含上下两段内距')
  assert.match(value, /env\(safe-area-inset-bottom\)/, '占位高必须含安全区')
  // 反向核对:组件真的按这三项搭盒子(否则 token 是个自说自话的常量)
  assert.match(footerWxss, /padding: var\(--cy-comp-footer-pad-y\)/)
  assert.match(footerWxss, /padding-bottom: calc\(var\(--cy-comp-footer-pad-y\) \+ env\(safe-area-inset-bottom\)\)/)
  assert.doesNotMatch(footerWxss, /--cy-btn-h\s*:/, 'footer-bar 不得覆写全站按钮高度')
  assert.match(footerJs, /--cy-comp-footer-h/, '注释仍应指向这个 token')
}

test('cy-footer-bar:注释引用的 --cy-comp-footer-h 是真 token,且构成与组件盒子对应', () => {
  assertFooterHeightToken(read('style/tokens.wxss'), read('components/cy/footer-bar/index.wxss'),
    read('components/cy/footer-bar/index.js'))
})

test('负控:--cy-comp-footer-h 未定义(注释指向空气)必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace(/  --cy-comp-footer-h: calc\([^;]+\);\n/, '')
  assert.notEqual(mutated, tokens, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFooterHeightToken(mutated, read('components/cy/footer-bar/index.wxss'),
    read('components/cy/footer-bar/index.js')), assert.AssertionError)
})

test('负控:占位高漏掉安全区(iPhone 上末条内容被压)必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace(
    '--cy-comp-footer-h: calc(var(--cy-btn-h) + var(--cy-comp-footer-pad-y) * 2 + env(safe-area-inset-bottom));',
    '--cy-comp-footer-h: calc(var(--cy-btn-h) + var(--cy-comp-footer-pad-y) * 2);')
  assert.notEqual(mutated, tokens, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFooterHeightToken(mutated, read('components/cy/footer-bar/index.wxss'),
    read('components/cy/footer-bar/index.js')), assert.AssertionError)
})

// Standards(非阻塞项 B):FADE_SWAP_MS 原来是 JS 里的孤立字面量,WXSS 侧没有对应 token。
// WXSS 变量在 JS 里读不到,镜像逃不掉;能做的是**把漂移判红**。
function assertFadeSwapMirror(tokens, motionJs) {
  const tok = tokens.match(/--cy-motion-fade-swap:\s*(\d+)ms;/)
  assert.ok(tok, 'WXSS 侧必须有 --cy-motion-fade-swap,不能只在 JS 里留字面量')
  const js = motionJs.match(/const FADE_SWAP_MS = (\d+);/)
  assert.ok(js, 'utils/motion.js 必须有 FADE_SWAP_MS 镜像')
  assert.equal(Number(js[1]), Number(tok[1]),
    `FADE_SWAP_MS(${js[1]}ms)与 --cy-motion-fade-swap(${tok[1]}ms)漂移了`)
  // 量级关系:淡切必须比 standard 短一档,否则首屏要多等
  const standard = tokens.match(/--cy-motion-standard:\s*(\d+)ms;/)
  assert.ok(standard, '找不到 --cy-motion-standard')
  assert.ok(Number(tok[1]) < Number(standard[1]), '淡切必须短于 standard 档')
}

test('动效时长:--cy-motion-fade-swap 与 JS 镜像 FADE_SWAP_MS 一致', () => {
  assertFadeSwapMirror(read('style/tokens.wxss'), read('utils/motion.js'))
})

test('负控:JS 镜像与 WXSS token 漂移必须判红', () => {
  const motionJs = read('utils/motion.js')
  const mutated = motionJs.replace('const FADE_SWAP_MS = 200;', 'const FADE_SWAP_MS = 320;')
  assert.notEqual(mutated, motionJs, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFadeSwapMirror(read('style/tokens.wxss'), mutated), assert.AssertionError)
})

test('负控:删掉 WXSS 侧 token(退回 JS 孤立字面量)必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace(/  --cy-motion-fade-swap: \d+ms;\n/, '')
  assert.notEqual(mutated, tokens, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFadeSwapMirror(mutated, read('utils/motion.js')), assert.AssertionError)
})

test('负控:去掉 footer-bar 的 safe-area 内距必须判红', () => {
  const files = footerFiles()
  const mutated = Object.assign({}, files, {
    wxss: files.wxss.replace(
      'padding-bottom: calc(var(--cy-comp-footer-pad-y) + env(safe-area-inset-bottom));',
      'padding-bottom: var(--cy-comp-footer-pad-y);',
    ),
  })
  assert.notEqual(mutated.wxss, files.wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFooterBar(mutated), assert.AssertionError)
})

test('负控:footer-bar 承托底改半透明(内容透出)必须判红', () => {
  const files = footerFiles()
  const mutated = Object.assign({}, files, {
    wxss: files.wxss.replace('background: var(--cy-color-bg-page);', 'background: var(--cy-color-bg-glass);'),
  })
  assert.notEqual(mutated.wxss, files.wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFooterBar(mutated), assert.AssertionError)
})

// ============================================================
// 3) cy-empty 语义状态族 + 向后兼容
// ============================================================
// 行为判据:真 require 组件文件(用 Component 桩接住注册选项),再跑它自己的 observer。
// 不比对源码字符串,也不复制一份状态表到测试里 —— 复制的那份只会证明它自己。
function loadComponent(rel) {
  const abs = path.join(ROOT, rel)
  const prevComponent = global.Component
  let captured = null
  global.Component = (options) => { captured = options }
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prevComponent
  }
  assert.ok(captured, `${rel} 必须调用 Component() 注册`)
  return captured
}

function resolveEmpty({ kind = '', icon = '', title = '', sub = '' } = {}) {
  const options = loadComponent('components/cy/empty/index.js')
  const observer = options.observers && options.observers['kind, icon, title, sub']
  assert.ok(observer, 'cy-empty 必须有解析语义状态默认值的 observer')
  const state = {}
  observer.call({ setData: (patch) => Object.assign(state, patch) }, kind, icon, title, sub)
  return {
    icon: state._icon || '',
    glyph: state._glyph || '',
    title: state._title,
    sub: state._sub,
    loading: state._loading,
  }
}

// 状态表本身:通过「跑一遍每个 kind」反推,而不是直接读常量
function emptyKindTable() {
  const table = {}
  ;['empty', 'offline', 'no-permission', 'not-started', 'missing-param', 'loading']
    .forEach((k) => { table[k] = resolveEmpty({ kind: k }) })
  return table
}

function visualIdentity(state) {
  if (state.loading) return 'loading'
  if (state.glyph) return `glyph:${state.glyph}`
  if (state.icon) return `image:${state.icon}`
  return ''
}

function assertEmptySemanticVisuals(table) {
  // 2026-08-11 补洞:missing-param 原本不在这份清单里,于是它可以跟 empty 共用同一张位图
  // 而门禁不红 —— 实测就是这么漏的(我把它的默认图从 icon_cat.png 改成 empty 那张 no_data.svg,
  // 违反本组件表头「位图只留给真正的 empty」,这里一声不吭)。它是终态之一,纳入同一条判据。
  const requiredKinds = ['empty', 'offline', 'no-permission', 'not-started', 'missing-param']
  const visualIdentities = requiredKinds.map((kind) => visualIdentity(table[kind]))
  requiredKinds.forEach((kind, index) => {
    assert.ok(table[kind].title && table[kind].title.length > 0, `kind=${kind} 必须有默认主文案`)
    assert.ok(visualIdentities[index], `kind=${kind} 必须有可见状态表达`)
  })
  assert.equal(new Set(visualIdentities).size, requiredKinds.length,
    '空 / 错 / 无权限 / 未开始 / 缺参必须使用五种可区分的视觉身份')
  assert.notEqual(visualIdentity(table.empty), visualIdentity(table.offline),
    'empty 与 offline 不能继续共用同一张灰色插画')
}

test('cy-empty 状态族:空 / 错 / 无权限 / 未开始具备不同视觉身份', () => {
  const table = emptyKindTable()
  const kinds = ['empty', 'offline', 'no-permission', 'not-started', 'missing-param', 'loading']
  const seen = new Set()
  kinds.forEach((k) => {
    const r = table[k]
    assert.ok(r.title && r.title.length > 0, `kind=${k} 必须有默认主文案`)
    assert.ok(!seen.has(r.title), `kind=${k} 的文案与其它态重复,用户分不清是哪种"空"`)
    seen.add(r.title)
  })
  assertEmptySemanticVisuals(table)
  // 终态可使用现有位图或 cy-icon 线性图标；loading 单独走转圈。
  ;['empty', 'offline', 'no-permission', 'not-started', 'missing-param'].forEach((k) => {
    assert.ok(visualIdentity(table[k]), `kind=${k} 必须有默认视觉反馈`)
  })
  assert.equal(resolveEmpty({ kind: 'loading' }).loading, true, 'loading 必须走转圈而不是插画')
  assert.equal(resolveEmpty({ kind: 'empty' }).loading, false, '终态不得转圈')
  // 位图必须真实存在；线性图标必须来自既有 cy-icon 包，不能写一个不存在的名字。
  const glyphSource = read('components/cy/icon/icons.wxss')
  kinds.forEach((k) => {
    const state = table[k]
    if (state.icon) assert.ok(exists(state.icon.replace(/^\//, '')), `kind=${k} 引用的插画必须真实存在`)
    if (state.glyph) assert.match(glyphSource, new RegExp(`\\.cyi--${state.glyph}\\s*\\{`), `kind=${k} 的线性图标必须已注册`)
  })
})

function assertEmptySemanticRenderer(wxml, config) {
  assert.match(wxml, /wx:elif="\{\{_glyph\}\}"[^>]*class="cy-empty-glyph"/,
    '线性图标分支必须消费 observer 解析出的 _glyph')
  assert.match(wxml, /<cy-icon\b[^>]*name="\{\{_glyph\}\}"/,
    '状态线性图标必须交给既有 cy-icon 渲染')
  assert.ok(config.usingComponents && config.usingComponents['cy-icon'],
    'cy-empty 必须注册 cy-icon，不能依赖页面碰巧注册')
}

test('cy-empty 把语义 glyph 交给已注册的 cy-icon 渲染', () => {
  assertEmptySemanticRenderer(
    read('components/cy/empty/index.wxml'),
    JSON.parse(read('components/cy/empty/index.json')),
  )
})

test('负控:删掉 glyph 渲染分支时必须命中语义视觉闸', () => {
  const wxml = read('components/cy/empty/index.wxml')
  const mutated = wxml.replace(/\s*<view wx:elif="\{\{_glyph\}\}"[\s\S]*?<\/view>/, '')
  assert.notEqual(mutated, wxml, '负控锚点失效：找不到 cy-empty glyph 分支')
  assert.throws(() => assertEmptySemanticRenderer(
    mutated,
    JSON.parse(read('components/cy/empty/index.json')),
  ), /线性图标分支必须消费/)
})

test('负控:任一终态视觉撞车都必须命中区分闸', () => {
  const table = emptyKindTable()
  // offline 撞 empty(原有用例)
  assert.throws(() => assertEmptySemanticVisuals(Object.assign({}, table, {
    offline: Object.assign({}, table.offline, table.empty),
  })), /可区分的视觉身份/)
  // 2026-08-11 补:missing-param 撞 empty —— 正是把它纳入 requiredKinds 之前漏掉的那种撞车
  assert.throws(() => assertEmptySemanticVisuals(Object.assign({}, table, {
    'missing-param': Object.assign({}, table['missing-param'], table.empty),
  })), /可区分的视觉身份/)
})

test('cy-empty:状态默认值里不得埋 CTA(默认 CTA 没有默认动作 = 点不动的假按钮)', () => {
  const src = read('components/cy/empty/index.js')
  const table = src.match(/const KIND_DEFAULTS = \{[\s\S]*?\n\};/)
  assert.ok(table, '找不到 KIND_DEFAULTS 表')
  assert.doesNotMatch(table[0], /\bcta\s*:/, '状态默认表里不得出现 cta')
  // CTA 只能由页面显式传,且必须有对应事件出口给页面接住
  const wxml = read('components/cy/empty/index.wxml')
  assert.match(wxml, /wx:if="\{\{cta\}\}"/, 'CTA 只在页面显式传入时才渲染')
  assert.match(wxml, /bindtap="onCta"/, 'CTA 必须绑到真实处理函数')
  assert.match(read('components/cy/empty/index.js'), /onCta\(\)\s*\{\s*this\.triggerEvent\('cta'\)/,
    'CTA 必须把动作抛给页面,不能自己吞掉(吞掉 = 点了没反应)')
})

test('负控:给状态默认表塞一个默认 CTA(点了没动作)必须判红', () => {
  const src = read('components/cy/empty/index.js')
  const mutated = src.replace(/(empty:\s*\{[^{}\n]*)(\})/, "$1, cta: '去逛逛' $2")
  assert.notEqual(mutated, src, '变异锚点失效(源码已改动?)')
  const table = mutated.match(/const KIND_DEFAULTS = \{[\s\S]*?\n\};/)
  assert.throws(() => assert.doesNotMatch(table[0], /\bcta\s*:/), assert.AssertionError)
})

test('负控:显式 kind="empty" 退回无插画(状态族之一没有视觉表达)必须判红', () => {
  // 变异 = 把 empty 那一档的插画抹掉,此时"显式声明空态"和"什么都没声明"又长得一样
  const table = emptyKindTable()
  const broken = Object.assign({}, table, { empty: Object.assign({}, table.empty, { icon: '' }) })
  assert.throws(() => {
    assert.ok(visualIdentity(broken.empty), 'kind=empty 必须有默认视觉反馈')
  }, /kind=empty 必须有默认视觉反馈/)
})

test('cy-empty 向后兼容:不传 kind 与既有用法行为不变', () => {
  // 68 处既有用法:不传 kind、不传 icon ⇒ 必须还是「暂无内容」且无插画(不能凭空多出一张图)
  const bare = resolveEmpty({})
  assert.equal(bare.title, '暂无内容')
  assert.equal(bare.icon, '')
  assert.equal(bare.glyph, '')
  assert.equal(bare.sub, '')
  assert.equal(bare.loading, false)
  // 显式传入恒优先于 kind 默认值
  const explicitIcon = '/images/no_data.svg'
  const overridden = resolveEmpty({ kind: 'offline', title: '这一带还没有活动', icon: explicitIcon })
  assert.equal(overridden.title, '这一带还没有活动')
  assert.equal(overridden.icon, explicitIcon)
  assert.equal(overridden.glyph, '', '显式位图优先时不能再叠默认 glyph')
  // wxml 必须消费解析后的字段,否则上面这套解析形同虚设
  const wxml = read('components/cy/empty/index.wxml')
  assert.match(wxml, /\{\{_title\}\}/)
  assert.match(wxml, /src="\{\{_icon\}\}"/)
})

test('负控:让 kind 默认值盖过页面显式文案必须判红', () => {
  // 变异 = 把优先级写反(默认值优先),此时既有页面传的 title 会被 kind 默认文案顶掉
  const table = emptyKindTable()
  const brokenResolve = ({ kind = '', title = '' }) => ((table[kind] || table.empty).title || title)
  assert.throws(() => {
    assert.equal(brokenResolve({ kind: 'offline', title: '这一带还没有活动' }), '这一带还没有活动')
  }, assert.AssertionError)
})

// ============================================================
// 5) cy-tabs fill 横滑
// ============================================================
function assertTabsFillScrollable(files) {
  assert.match(files.wxml, /<scroll-view wx:elif="\{\{variant === 'fill'\}\}"[^>]*scroll-x/,
    'fill 变体必须渲染成可横滑的 scroll-view')
  assert.match(files.wxml, /class="cy-tabs__track"/, 'fill 必须有内层等宽轨道')
  const track = files.wxss.match(/\.cy-tabs--fill \.cy-tabs__track \{[\s\S]*?\n\}/)
  assert.ok(track, '找不到 .cy-tabs--fill .cy-tabs__track 规则')
  assert.match(track[0], /min-width:\s*100%/, 'tab 少时必须仍铺满整行(否则现有四处用法视觉回归)')
  // 实测坐实的一条:只有 min-width:100% 时轨道恒等于容器宽(9 tab 量到 364px = 容器 364px),
  // item 溢出但 scroll-view 量不到可滚宽度 ⇒ 看着被切掉、其实滑不动。max-content 才真能滚(量到 918px)。
  assert.match(track[0], /width:\s*max-content/,
    '轨道必须 width:max-content,否则 fill 只是把 tab 切掉而不是真横滑')
  const item = files.wxss.match(/\.cy-tabs--fill \.cy-tabs__item \{[\s\S]*?\n\}/)
  assert.ok(item, '找不到 .cy-tabs--fill .cy-tabs__item 规则')
  // 不挤压的真正机制是 flex-shrink:0(flex: 1 0 auto 的中间那位);min-width 是短标签时的兜底下限
  assert.match(item[0], /flex:\s*1 0 auto/, 'item 必须 flex-shrink:0,否则 tab 一多就被压扁而不是横滑')
  assert.match(item[0], /min-width:\s*var\(--cy-comp-tabs-fill-min-w\)/, '短标签的宽度下限走 token')
  // content-box 下 min-width 只管内容盒、内距会加在外面:实测 150rpx 下限 + 24rpx 内距 = 实际 103px,
  // 4 个 tab 就把 390pt 的行撑爆(member/index 已复现)。box-sizing 这条是那次回归的修法本身。
  assert.match(item[0], /box-sizing:\s*border-box/,
    'fill item 必须 border-box,否则 min-width 会与内距叠加把行撑爆')
}

test('cy-tabs fill 变体横向可滚,tab 少时仍铺满', () => {
  assertTabsFillScrollable({
    wxml: read('components/cy/tabs/index.wxml'),
    wxss: read('components/cy/tabs/index.wxss'),
  })
})

test('负控:fill 退回不可滚的 flex(item 无最小宽度)必须判红', () => {
  const wxss = read('components/cy/tabs/index.wxss')
  const mutated = wxss.replace(
    'min-width: var(--cy-comp-tabs-fill-min-w);',
    '',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertTabsFillScrollable({
    wxml: read('components/cy/tabs/index.wxml'),
    wxss: mutated,
  }), assert.AssertionError)
})

// ============================================================
// 6) 表面规范 token 化(卡片高光 / 浅端投影)
// ============================================================
function assertCardSurface(cardWxss, tokens) {
  assert.match(cardWxss, /box-shadow:\s*inset 0 1rpx 0 0 var\(--cy-comp-card-highlight\), var\(--cy-comp-card-shadow-day\);/,
    '卡片必须固定写两段 box-shadow(高光 + 投影),不做主题判断')
  assert.match(tokens, /--cy-comp-card-highlight:\s*rgba\(255,255,255,\.08\)/, '暗端顶缘高光 = 白 8%')
  const lightBlock = tokens.match(/^page\.theme-light,[\s\S]*?^\}/m)
  assert.ok(lightBlock, '找不到 .theme-light 块')
  assert.match(lightBlock[0], /--cy-comp-card-shadow-day:\s*0 [1-9][\d.]*rpx [1-9][\d.]*rpx rgba\([^)]+\)/, '浅端卡投影')
  assert.match(lightBlock[0], /--cy-comp-card-highlight:\s*transparent/, '浅端不要顶缘高光')
}

test('表面规范:暗端顶缘高光 + 浅端投影,两档都 token 化', () => {
  assertCardSurface(read('components/cy/card/index.wxss'), read('style/tokens.wxss'))
})

// 复核阻塞项 3:亮色域严格禁止「描边 + 投影」同时出现(一张卡两条外沿,浅底上尤其脏)。
// 判据不是"某一行长什么样",而是遍历每个主题块自己算:凡设了非零投影的块,描边必须是 transparent。
// 暗域不受此限 —— 顶缘高光是 inset,不是外沿。
const ZERO_SHADOW = /^0 0 0 0 transparent$/

function themeBlocks(tokens) {
  // 抓 `page.theme-xxx, .theme-xxx { ... }` 形态的块(含逗号分隔的多选择器)
  const blocks = []
  const re = /^((?:[^\n{};]*theme-[^\n{};]*,?\n?)+)\{([\s\S]*?)^\}/gm
  let m
  while ((m = re.exec(tokens))) blocks.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
  return blocks
}

const declOf = (body, name) => {
  const m = body.match(new RegExp('--cy-comp-card-' + name + ':\\s*([^;]+);'))
  return m ? m[1].trim() : null
}

function assertLightCardSingleEdge(tokens) {
  const blocks = themeBlocks(tokens)
  assert.ok(blocks.length >= 2, `主题块解析失败(只解析到 ${blocks.length} 块),断言会变成恒真`)
  let checked = 0
  blocks.forEach(({ selector, body }) => {
    const shadow = declOf(body, 'shadow-day')
    if (!shadow || ZERO_SHADOW.test(shadow)) return   // 没投影的块(暗域/白底细线域)不在本条管辖内
    checked++
    const border = declOf(body, 'border')
    assert.ok(border, `${selector} 设了投影却没声明 --cy-comp-card-border,会继承到可见描边`)
    assert.equal(border, 'transparent',
      `${selector} 同时有描边(${border})与投影(${shadow}):亮色域二者只能选一`)
  })
  assert.ok(checked > 0, '没有任何带投影的亮色块被检查到,这条断言是恒真的')
}

test('表面规范:亮色域「描边 / 投影」二选一,不得同时出现', () => {
  assertLightCardSingleEdge(read('style/tokens.wxss'))
})

test('负控:亮色块同时留描边与投影必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace('  --cy-comp-card-border:        transparent;\n', '')
  assert.notEqual(mutated, tokens, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertLightCardSingleEdge(mutated), assert.AssertionError)
})

test('负控:亮色块把描边改回可见色必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace('  --cy-comp-card-border:        transparent;',
    '  --cy-comp-card-border:        #E8ECF1;')
  assert.notEqual(mutated, tokens, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertLightCardSingleEdge(mutated), assert.AssertionError)
})

// merchant-light 是 .theme-light 的逐字镜像,但 ds-theme-sync 门禁只锁 --cy-color-*(+5 字面),
// --cy-comp-card-* 不在它的锁定键集里 ⇒ 镜像同步只能由本条契约守。
function assertMerchantMirrorsCardSurface(tokens, merchantLight) {
  const light = tokens.match(/^page\.theme-light,[\s\S]*?^\}/m)
  assert.ok(light, '找不到 .theme-light 块')
  const page = merchantLight.match(/^page \{[\s\S]*?^\}/m)
  assert.ok(page, '找不到 merchant-light page{} 块')
  ;['highlight', 'shadow-day', 'border'].forEach((name) => {
    const src = declOf(light[0], name)
    assert.ok(src, `真源 .theme-light 缺 --cy-comp-card-${name}`)
    assert.equal(declOf(page[0], name), src,
      `merchant-light 的 --cy-comp-card-${name} 与真源漂移(商家页会拿到另一套表面规范)`)
  })
}

test('表面规范:merchant-light 镜像与 .theme-light 真源逐字一致', () => {
  assertMerchantMirrorsCardSurface(read('style/tokens.wxss'), read('style/merchant-light.wxss'))
})

test('负控:merchant-light 镜像漏同步描边一档必须判红', () => {
  const ml = read('style/merchant-light.wxss')
  const mutated = ml.replace('  --cy-comp-card-border:        transparent;\n', '')
  assert.notEqual(mutated, ml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertMerchantMirrorsCardSurface(read('style/tokens.wxss'), mutated), assert.AssertionError)
})

test('负控:浅端漏掉「关掉高光」这一档(暗端高光漏进白卡)必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace('  --cy-comp-card-highlight:     transparent;\n', '')
  assert.notEqual(mutated, tokens, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCardSurface(read('components/cy/card/index.wxss'), mutated), assert.AssertionError)
})

// ============================================================
// 7) cy-cover-fallback 资产合同
// ============================================================
function assertCoverFallback(files) {
  assert.match(files.wxml, /binderror="onError"/, '图必须挂 error 回调,否则挂图就是个黑洞')
  assert.match(files.wxml, /wx:if="\{\{src && !failed\}\}"/, '有图且未失败才渲染 <image>')
  assert.match(files.wxml, /wx:else[\s\S]*class="cy-cover__fallback"[\s\S]*\{\{title\}\}/,
    '无图 / 图挂时必须渲染主题名文字封面')
  assert.match(files.js, /onError\(\)[\s\S]*failed: true/, '失败态必须落到组件 data')
  // 身份闸:src 换了要清失败态,否则列表复用节点会把 A 条的失败带给 B 条
  assert.match(files.js, /observers[\s\S]*src\(next\)[\s\S]*failed: false/,
    'src 变更必须清掉 failed(列表节点复用身份闸)')
  assert.match(files.wxss, /background: linear-gradient\(135deg, var\(--cy-color-brand-soft\), var\(--cy-color-bg-surface-subtle\)\)/,
    '兜底底色必须沿用既有配方,不另造第二套')
  assert.match(files.wxss, /font-size: var\(--cy-comp-cover-fallback-font\)/, '文字封面字号走 token')
}

const coverFiles = () => ({
  wxml: read('pages/publish/components/cover-fallback/index.wxml'),
  wxss: read('pages/publish/components/cover-fallback/index.wxss'),
  js: read('pages/publish/components/cover-fallback/index.js'),
})

test('cy-cover-fallback:图挂 / 空图都落到主题名文字封面', () => {
  assertCoverFallback(coverFiles())
})

test('负控:去掉 src 变更清失败态的身份闸必须判红', () => {
  const files = coverFiles()
  const mutated = Object.assign({}, files, {
    js: files.js.replace('this.setData({ _boundSrc: next, failed: false });', 'this.setData({ _boundSrc: next });'),
  })
  assert.notEqual(mutated.js, files.js, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCoverFallback(mutated), assert.AssertionError)
})

// 复核阻塞项 6:封面「3 倍图资产合同」在小程序运行时**无法真实验证**,所以这里守的是
// 「不许伪造」这条底线,而不是假装验证了。
// 原因:小程序 <image> 没有 srcset/sizes,也没有 <picture>;真正的多倍图选择发生在
// CDN/上传侧(远端 URL 由 utils/config.js baseImgUrl 拼),本仓不持有那些资产、
// 也没有能在 node 里问到远端真相的通道。写 srcset 只会得到一个被静默忽略的无效属性 ——
// 那比不写更坏:它看起来像"做了"。边界已在交付报告里写明。
function assertNoFakeDensityAttrs(files) {
  ;[/srcset=/, /sizes=/, /<picture[\s>]/, /image-set\(/].forEach((re) => {
    assert.doesNotMatch(files.wxml, re, `小程序不支持该多倍图写法,写了 = 无效属性冒充资产合同(${re})`)
    assert.doesNotMatch(files.wxss, re, `小程序不支持该多倍图写法(${re})`)
  })
  // 能真守住的那一半:无图 / 图挂都必须落到主题名文字兜底,不留黑洞
  assert.match(files.wxml, /wx:else[\s\S]*class="cy-cover__fallback"/, '兜底分支必须覆盖 wx:if 的全部否定面')
}

test('cy-cover-fallback:不伪造小程序不支持的多倍图属性,文字兜底仍覆盖无图/图挂两态', () => {
  assertNoFakeDensityAttrs(coverFiles())
})

test('负控:给 <image> 塞 srcset 冒充 3 倍图合同必须判红', () => {
  const files = coverFiles()
  const mutated = Object.assign({}, files, {
    wxml: files.wxml.replace('src="{{src}}"', 'src="{{src}}" srcset="{{src}} 3x"'),
  })
  assert.notEqual(mutated.wxml, files.wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertNoFakeDensityAttrs(mutated), assert.AssertionError)
})

test('负控:去掉 binderror(挂图留黑洞)必须判红', () => {
  const files = coverFiles()
  const mutated = Object.assign({}, files, { wxml: files.wxml.replace('binderror="onError"', '') })
  assert.notEqual(mutated.wxml, files.wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCoverFallback(mutated), assert.AssertionError)
})

// ============================================================
// 9) 地图浮动退出钮 = 「‹ 退出」显式特殊控制(2026-07-29 复核裁决,极性翻面)
// ============================================================
// ⚠️ 本节极性在 2026-07-29 复核里被翻过一次面:
//   旧要求 = 与二级页返回钮统一成 64rpx 裸圆钮(只剩一个「‹」);
//   新裁决 = **必须保留「退出」二字**。理由不是审美:裸 chevron 全站语义是「返回上一页」,
//   而这一颗按下去是**退出整局游玩**,后果不可逆地不同。把显式特殊控制降级成普通返回,
//   等于让用户在零文字提示下丢掉进行中的一局。
//   ⇒ 它是全站导航范式的**显式例外**:共用高度钩子,但不共用形态。
function assertFloatingExitExplicit(wxss, wxml) {
  const rule = wxss.match(/\.fmap-exit \{[^}]*\}/)
  assert.ok(rule, '找不到 .fmap-exit 规则')
  // 视觉:高度仍走返回钮同一尺寸钩子(64rpx 一档),横向是文字胶囊
  assert.match(rule[0], /height: var\(--cy-comp-nav-back-size\)/, '视觉高度必须与返回钮同一尺寸钩子')
  assert.match(rule[0], /border-radius: var\(--cy-radius-pill\)/)

  // 真实触控热区**横纵都**必须 ≥88rpx(=44pt)。aria-label 不算命中区,那是读屏用的。
  // ⚠️ 横向不许靠「四个字正好够宽」碰巧满足 —— 内外层各写一条 min-width,各配负控。
  const hit = wxss.match(/\.fmap-exit-hit \{[^}]*\}/)
  assert.ok(hit, '浮动退出钮必须有独立的外层命中区 .fmap-exit-hit')
  const hitW = hit[0].match(/min-width:\s*(\d+)rpx/)
  const hitH = hit[0].match(/min-height:\s*(\d+)rpx/)
  assert.ok(hitW && hitH, '命中区必须显式给横纵下限(min-width / min-height)')
  assert.ok(Number(hitW[1]) >= 88, `命中区宽下限必须 ≥88rpx,实为 ${hitW[1]}rpx`)
  assert.ok(Number(hitH[1]) >= 88, `命中区高下限必须 ≥88rpx,实为 ${hitH[1]}rpx`)
  const innerW = rule[0].match(/min-width:\s*(\d+)rpx/)
  assert.ok(innerW, '视觉胶囊也必须给横向下限,否则文案一改命中区跟着缩水')
  assert.ok(Number(innerW[1]) >= 88, `视觉胶囊宽下限必须 ≥88rpx,实为 ${innerW[1]}rpx`)
  assert.match(hit[0], /align-items:\s*center/, '64rpx 胶囊必须在 88rpx 命中区里纵向居中')

  if (wxml) {
    // 显式标签:这是本项的核心判据,不是装饰
    assert.match(wxml, /class="fmap-exit">退出</, '地图退出必须保留「退出」二字,不得收成无文字图标')
    assert.match(wxml, /class="fmap-exit-hit"[^>]*aria-label="退出游玩"/, 'aria-label 必须保留')
    // tap 必须在外层:挂回视觉层 = 命中区又缩回视觉尺寸(那正是本项要修的缺陷)
    assert.match(wxml, /class="fmap-exit-hit"[^>]*bindtap="onExitTap"/, 'tap 必须挂在命中区外层')
    assert.doesNotMatch(wxml, /class="fmap-exit"[^>]*bindtap/, 'tap 不得挂回视觉层')
    // 视觉不漂:命中区与原视觉同左原点,top 仍由 exitTop 定位
    assert.match(wxml, /class="fmap-exit-hit"[^>]*style="top:\{\{exitTop\}\}px;"/, '命中区必须承接原来的 exitTop 定位')
    assert.match(hit[0], /left:\s*24rpx/, '命中区左缘必须与原视觉同原点(否则钮会横向漂)')
  }
}

test('play/searchmap 浮动退出钮 = 「退出」显式标签 + 横纵均 ≥88rpx 真命中区', () => {
  assertFloatingExitExplicit(read('components/cy/free-map/index.wxss'), read('components/cy/free-map/index.wxml'))
  // 事件面零回归:视觉改了,对外契约(prop / event)一个字都不能动
  const js = read('components/cy/free-map/index.js')
  assert.match(js, /showExit:\s*\{[\s\S]{0,80}type:\s*Boolean/, 'showExit 开关必须保留')
  assert.match(js, /onExitTap\(\)\s*\{[^}]*triggerEvent\('exit'\)/, 'exit 事件必须仍由 onExitTap 触发')
  // 二级页返回按 7-29 裁决仍是裸 chevron —— 本例外不许反过来污染它
  const nav = read('components/cy/nav-bar/index.wxss')
  const pill = nav.match(/\.nav__back-inner--pill \{[\s\S]*?\n\}/)
  assert.ok(pill, '找不到 pill 规则')
  assert.match(pill[0], /width: var\(--cy-comp-nav-back-size\)/, 'pill 仍与退出钮共用尺寸钩子')
  assert.match(read('style/tokens.wxss'), /--cy-comp-nav-back-size:\s*64rpx/)
})

test('负控:地图退出丢掉「退出」二字必须判红', () => {
  const wxml = read('components/cy/free-map/index.wxml')
  const mutated = wxml.replace('class="fmap-exit">退出<', 'class="fmap-exit"><')
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFloatingExitExplicit(read('components/cy/free-map/index.wxss'), mutated),
    assert.AssertionError)
})

test('负控:命中区横向缩到 44pt 以下(文案变短就悄悄缩水)必须判红', () => {
  const wxss = read('components/cy/free-map/index.wxss')
  const mutated = wxss.replace('.fmap-exit { min-width: 88rpx;', '.fmap-exit { min-width: 64rpx;')
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFloatingExitExplicit(mutated, read('components/cy/free-map/index.wxml')),
    assert.AssertionError)
})

test('负控:命中区纵向缩到 44pt 以下必须判红', () => {
  const wxss = read('components/cy/free-map/index.wxss')
  const mutated = wxss.replace('min-width: 88rpx; min-height: 88rpx;', 'min-width: 88rpx; min-height: 64rpx;')
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFloatingExitExplicit(mutated, read('components/cy/free-map/index.wxml')),
    assert.AssertionError)
})

test('负控:把 tap 挂回视觉层(命中区形同虚设)必须判红', () => {
  const wxml = read('components/cy/free-map/index.wxml')
  const mutated = wxml
    .replace('class="fmap-exit-hit" style="top:{{exitTop}}px;" bindtap="onExitTap"', 'class="fmap-exit-hit" style="top:{{exitTop}}px;"')
    .replace('<cover-view class="fmap-exit">', '<cover-view class="fmap-exit" bindtap="onExitTap">')
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFloatingExitExplicit(read('components/cy/free-map/index.wxss'), mutated), assert.AssertionError)
})

// ============================================================
// 10) 底栏底色/分隔线读 v2 真值层;spinner 转速读语义 token
// ============================================================
// 复核阻塞项:底栏原来读 --cy-bg-page(v1 别名)+ --cy-comp-card-highlight(卡片钩子)。
// 两条都是「语义借错层」:别名在 page{} 就地解析,类作用域主题(.theme-light/.theme-merchant)
// 继承到的是暗端已解析值;卡片高光在浅端各主题块被设成 transparent(浅端卡改用投影起层),
// 而底栏没有投影这条退路 ⇒ 浅色页下分隔线整条消失。
// 判据 = 读的是每个主题块都有真值的 v2 token。
function assertFooterUsesV2Surface(wxss) {
  const root = wxss.match(/\.cy-footer-bar \{[\s\S]*?\n\}/)
  assert.ok(root, '找不到 .cy-footer-bar 规则')
  assert.match(root[0], /background:\s*var\(--cy-color-bg-page\)/, '底栏底色必须读 v2 --cy-color-bg-page')
  assert.doesNotMatch(root[0], /background:\s*var\(--cy-bg-page\)/, '底栏不得读 v1 别名 --cy-bg-page')

  const hl = wxss.match(/\.cy-footer-bar--highlight \{[\s\S]*?\n\}/)
  assert.ok(hl, '找不到 .cy-footer-bar--highlight 规则')
  assert.match(hl[0], /box-shadow:[^;]*var\(--cy-color-border-subtle\)/, '顶缘分隔线必须读 v2 边框语义')
  assert.doesNotMatch(hl[0], /box-shadow:[^;]*--cy-comp-card-highlight/, '底栏不得借用卡片高光钩子(浅端为 transparent)')

  // 反向核对:这两个 v2 token 在浅色主题块里真有非透明值,否则等于换个名字继续消失
  const tokens = read('style/tokens.wxss')
  const light = tokens.match(/page\.theme-light,[\s\S]*?\n\}/)
  assert.ok(light, '找不到浅色主题块')
  assert.match(light[0], /--cy-color-bg-page:\s*#[0-9A-Fa-f]{6}/, '浅端必须给 --cy-color-bg-page 真值')
  assert.match(light[0], /--cy-color-border-subtle:\s*#[0-9A-Fa-f]{6}/, '浅端必须给 --cy-color-border-subtle 真值')
}

test('cy-footer-bar 底色/分隔线读 v2 真值层,浅暗两端都不消失', () => {
  assertFooterUsesV2Surface(read('components/cy/footer-bar/index.wxss'))
})

test('负控:底栏底色退回 v1 别名 --cy-bg-page 必须判红', () => {
  const wxss = read('components/cy/footer-bar/index.wxss')
  const mutated = wxss.replace('background: var(--cy-color-bg-page);', 'background: var(--cy-bg-page);')
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFooterUsesV2Surface(mutated), assert.AssertionError)
})

test('负控:底栏分隔线借用卡片高光钩子(浅端整条消失)必须判红', () => {
  const wxss = read('components/cy/footer-bar/index.wxss')
  const mutated = wxss.replace(
    'box-shadow: inset 0 1rpx 0 0 var(--cy-color-border-subtle);',
    'box-shadow: inset 0 1rpx 0 0 var(--cy-comp-card-highlight);',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertFooterUsesV2Surface(mutated), assert.AssertionError)
})

// spinner 转速:原来是散在组件里的字面秒数。字面量调不动 —— 改转速要满仓 grep 且必漏一处,
// 两个 spinner 同屏转速不一致肉眼可见。收成 --cy-motion-spinner-cycle 一个入口。
//
// ⚠️ 2026-07-29 复核补齐:上一轮只收了 cy-empty 一侧,cy-btn 仍留着字面值 ——
//   token 存在但没被共用 = 这个入口是假的。判据必须是「所有同形制 spinner 都读它」,
//   不能是「有一处读它就算过」,否则下一个新 spinner 照样可以另写一份字面值溜进来。
const SPINNER_RULES = [
  { rel: 'components/cy/empty/index.wxss', selector: '.cy-empty-spinner', keyframe: 'cy-empty-spin' },
  { rel: 'components/cy/btn/index.wxss',   selector: '.btn__spinner',     keyframe: 'cy-btn-spin' },
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 拆出文件里每一条 CSS 规则(WXSS 是平的,规则体内不会再有花括号;@keyframes 的内层块
// 会被当成独立规则拆出来,但它们的选择器是 `to`/`0%` 之类,选不中 spinner 类,天然被滤掉)。
function cssRules(wxss) {
  return [...wxss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
    text: m[0],
  }))
}

// 「这条规则会不会作用到 spinner 上」——判据是选择器里出现了 spinner 类本身,
// 不是「选择器等于它」:`.cy-scope .btn__spinner` / `.btn--loading.btn__spinner` 都算,
// 后置 + 更高特异性正是层叠覆盖的常见形态。`(?![\w-])` 挡掉 `.btn__spinnerx` 这种别的类。
function rulesTargeting(wxss, selector) {
  const re = new RegExp(`${escapeRe(selector)}(?![\\w-])`)
  return cssRules(wxss).filter((r) => re.test(r.selector))
}

// 字面时长(0.7s / 700ms);var(--…) 里没有裸数字+单位,不会命中
const LITERAL_DURATION = /(?:^|[\s,:])\d+(?:\.\d+)?m?s(?![\w-])/
// 能决定转速的两个属性:简写 animation 与长属性 animation-duration。
// ⚠️ 只守 animation 是第四轮复核抓到的漏:`animation-duration` 字符串里没有 "animation:",
//   高特异性规则单独覆写它就能改掉转速,而旧判据一个字都看不见。
const DURATION_DECLS = /(animation|animation-duration)\s*:\s*([^;]*)/g

function assertSpinnerCycleToken(tokens, wxssByRel) {
  assert.match(tokens, /--cy-motion-spinner-cycle:\s*\d+ms;/, '必须有 spinner 转速语义 token')
  for (const { rel, selector, keyframe } of SPINNER_RULES) {
    const targeting = rulesTargeting(wxssByRel[rel], selector)
    assert.ok(targeting.length >= 1, `找不到作用于 ${selector} 的规则(${rel})`)

    // 凡是能落到 spinner 上的规则,它写的每一条转速声明都必须读 token。
    // ⚠️ 范围只到「选择器里含 spinner 类」为止:同文件里与 spinner 无关的动画
    //   (`.btn__auxiliary`)不归本契约管 —— 假红会逼人给无关代码加豁免,门禁就是这么被架空的。
    let declaredCount = 0
    for (const rule of targeting) {
      for (const [, prop, value] of rule.body.matchAll(DURATION_DECLS)) {
        declaredCount += 1
        assert.doesNotMatch(value, LITERAL_DURATION,
          `${rule.selector} 的 ${prop} 写了字面时长,会层叠覆盖 spinner 转速(${rel}):${value.trim()}`)
        assert.match(value, /var\(--cy-motion-spinner-cycle\)/,
          `${rule.selector} 的 ${prop} 必须读 --cy-motion-spinner-cycle(${rel})`)
      }
    }
    assert.ok(declaredCount >= 1, `${selector} 必须声明转速(${rel})`)

    // 正向:确实有一条简写把本组件的 keyframe 和 token 接上了(不只是"没写错")
    assert.ok(
      targeting.some((r) => new RegExp(`animation:\\s*${keyframe}\\s+var\\(--cy-motion-spinner-cycle\\)`).test(r.body)),
      `${selector} 必须有一条 animation 简写把 ${keyframe} 与语义 token 接上(${rel})`)
  }
}

const readSpinnerWxss = (overrides = {}) => {
  const out = {}
  for (const { rel } of SPINNER_RULES) out[rel] = overrides[rel] || read(rel)
  return out
}

test('spinner 转速走 --cy-motion-spinner-cycle,cy-empty / cy-btn 两侧零字面时长', () => {
  assertSpinnerCycleToken(read('style/tokens.wxss'), readSpinnerWxss())
})

test('负控:cy-empty spinner 退回字面秒数必须判红', () => {
  const rel = 'components/cy/empty/index.wxss'
  const wxss = read(rel)
  const mutated = wxss.replace(
    'animation: cy-empty-spin var(--cy-motion-spinner-cycle) linear infinite;',
    'animation: cy-empty-spin 0.7s linear infinite;',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSpinnerCycleToken(read('style/tokens.wxss'), readSpinnerWxss({ [rel]: mutated })),
    assert.AssertionError)
})

// 这一条是本轮补齐的那一半:上一轮 token 已经存在、cy-empty 也读了它,
// 唯独 cy-btn 留着字面值 —— 而当时的契约看不见 cy-btn,所以全绿。
test('负控:cy-btn spinner 退回字面秒数必须判红', () => {
  const rel = 'components/cy/btn/index.wxss'
  const wxss = read(rel)
  const mutated = wxss.replace(
    'animation: cy-btn-spin var(--cy-motion-spinner-cycle) linear infinite;',
    'animation: cy-btn-spin 0.7s linear infinite;',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSpinnerCycleToken(read('style/tokens.wxss'), readSpinnerWxss({ [rel]: mutated })),
    assert.AssertionError)
})

// ⚠️ 2026-07-29 第三轮复核发现的**假绿**:上一版用 `wxss.match(...)` 只取**第一个**同名规则块。
//   CSS 的胜者是后置同特异性规则 —— 在文件末尾再追加一条 `.btn__spinner { animation: …0.7s }`,
//   真实渲染已经退回字面转速,而契约还在读文件开头那个干净的块 ⇒ 全绿。
//   「读回来」必须读到能让绿变红的那一面:改判所有同名规则块 + 全文件禁字面秒数,两层都守。
for (const { rel, selector, keyframe } of SPINNER_RULES) {
  test(`负控:${selector} 后置同特异性裸动画覆盖(层叠倒退)必须判红`, () => {
    const wxss = read(rel)
    // 追加在文件末尾:同 selector、同特异性、后来居上 —— 这正是真实回归的样子
    const mutated = `${wxss}\n${selector} { animation: ${keyframe} 0.7s linear infinite; }\n`
    assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
    assert.throws(() => assertSpinnerCycleToken(read('style/tokens.wxss'), readSpinnerWxss({ [rel]: mutated })),
      assert.AssertionError)
  })
}

// ⚠️ 2026-07-29 第四轮复核抓到的两条:上一版「全文件扫 animation:」这层兜底同时错了两头。
//   漏:`animation-duration:` 是独立长属性,字符串里根本没有 "animation:",高特异性规则
//       只覆写 duration 就能把转速改掉,两层都看不见。
//   误伤:那层不看选择器,同文件里一个跟 spinner 毫不相干的动画(如 .btn__auxiliary)
//       写自己的字面时长也会被判红 —— 假红逼人给无关代码加豁免,门禁会被慢慢架空。
//   ⇒ 判据收敛为「选择器里含 spinner 类的规则」,在其中同时守 animation 与 animation-duration。
for (const { rel, selector, keyframe } of SPINNER_RULES) {
  test(`负控:${selector} 高特异性只覆写 animation-duration(长属性绕过)必须判红`, () => {
    const wxss = read(rel)
    const mutated = `${wxss}\n.cy-scope ${selector} { animation-duration: 0.7s; }\n`
    assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
    assert.throws(() => assertSpinnerCycleToken(read('style/tokens.wxss'), readSpinnerWxss({ [rel]: mutated })),
      assert.AssertionError)
  })

  test(`正控:${rel} 里与 spinner 无关的动画写字面时长不得误伤`, () => {
    const wxss = read(rel)
    // 同文件、同样带字面时长,但选择器与 spinner 无关 ⇒ 不归本契约管,必须放行
    const mutated = `${wxss}\n.btn__auxiliary { animation: ${keyframe}-aux 2s linear infinite; }\n`
    assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
    assert.doesNotThrow(() => assertSpinnerCycleToken(read('style/tokens.wxss'), readSpinnerWxss({ [rel]: mutated })))
  })
}

test('负控:删掉 --cy-motion-spinner-cycle(组件指向空气)必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace(/  --cy-motion-spinner-cycle: \d+ms;\n/, '')
  assert.notEqual(mutated, tokens, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertSpinnerCycleToken(mutated, readSpinnerWxss()), assert.AssertionError)
})

// ============================================================
// 11) 设计文档写的必须是现行裁决,不是已被推翻的旧裁决
// ============================================================
// ⚠️ 文档在 Obsidian vault(仓库外),CI 机器上不存在 ⇒ 缺文件时 skip,不是 pass。
//   skip 会在报告里显式打印,不会伪装成绿。本机磁盘负控已跑过(见 WT2 报告「负控」节)。
const VAULT = process.env.CY_VAULT_DIR
  || path.join(process.env.HOME || '', 'Documents/城瘾/文档整理_20260711')
const DESIGN_DOCS = [
  '04-未开始/小程序UI总执行表_规整加ADA整合_20260729.md',
  '04-未开始/小程序ADA级设计升级方案_页面级处方_20260729.md',
]

function assertDocsMatchDecision(texts) {
  for (const { rel, text } of texts) {
    // 旧裁决:返回钮圆 chip 成为全站默认。7-29 已被推翻两次(先裸 chevron,再补地图例外)。
    assert.doesNotMatch(text, /chip[^\n]*全站默认|全站默认[^\n]*chip|全站升级为[^\n]*chip/,
      `${rel} 仍写着「圆 chip 全站默认」——该裁决已被推翻`)
    // 现行裁决必须写明,且必须写明地图退出是例外(否则下一个人又会去"统一"它)
    assert.match(text, /裸\s*chevron/, `${rel} 必须写明普通二级页返回 = 裸 chevron`)
    assert.match(text, /地图[^\n]{0,6}退出[^\n]*例外|例外[^\n]*地图[^\n]{0,6}退出/,
      `${rel} 必须写明地图「‹ 退出」是显式例外`)
  }
}

test('设计文档写的是现行裁决:普通二级页裸 chevron + 地图退出例外', (t) => {
  const texts = []
  for (const rel of DESIGN_DOCS) {
    const p = path.join(VAULT, rel)
    if (!fs.existsSync(p)) return t.skip(`vault 不在本机(${p}),文档契约跳过`)
    texts.push({ rel, text: fs.readFileSync(p, 'utf8') })
  }
  assertDocsMatchDecision(texts)
})

test('负控:文档写回「圆 chip 全站默认」旧裁决必须判红', () => {
  assert.throws(() => assertDocsMatchDecision([
    { rel: '<mutated>', text: '- [ ] 2.1 返回钮升级 64rpx 圆形 chip 并设全站默认\n裸 chevron\n地图退出是例外\n' },
  ]), assert.AssertionError)
})

test('负控:文档漏写「地图退出例外」必须判红', () => {
  assert.throws(() => assertDocsMatchDecision([
    { rel: '<mutated>', text: '普通二级页返回 = 裸 chevron,全站统一。\n' },
  ]), assert.AssertionError)
})
