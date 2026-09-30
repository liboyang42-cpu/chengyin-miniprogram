const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const TOKENS = 'style/tokens.wxss'

/**
 * 抽出 tokens.wxss 里每个「主题块」的声明体。
 * 主题块 = 任何声明了 --cy-color-bg-page 的规则块(page{} 与三个 .theme-* 逃生口)。
 */
function themeBlocks(source) {
  // 注释里出现过 `.theme-light{}` 这样的字面写法,不剥注释会把块边界带偏。
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(stripped)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    const body = m[2]
    if (/--cy-color-bg-page\s*:/.test(body)) blocks.push({ selector, body })
  }
  return blocks
}

function navBgOf(body) {
  const m = body.match(/--cy-comp-nav-bg\s*:\s*([^;]+);/)
  return m ? m[1].trim() : null
}

// ── 1. 顶栏底色 = 页面底色,同一枚语义 token ──────────────────────────────
//
// 断层的根因有两条,这条契约同时锁死:
//   (a) 顶栏原本读 --cy-color-bg-glass(暗色是 rgba(24,21,31,.82),带紫),
//       压在 #020104 / #0A090D 正文上合成出蓝紫横带 —— IM 空态截图即此。
//   (b) 自定义属性在【声明它的元素】上就地求值。--cy-comp-nav-bg 只写在 page{} 时,
//       子节点挂 .theme-merchant / .theme-light 只改 --cy-color-*,追不回已求值的
//       comp 别名 —— 浅色页会顶着一条暗色顶栏。
// ⇒ 每个重声明了 --cy-color-bg-page 的主题块,都必须同时重声明 --cy-comp-nav-bg,
//   且值必须是 var(--cy-color-bg-page) 本身,而不是"调得接近"的字面色。
function assertNavSurfaceContract(source) {
  const blocks = themeBlocks(source)
  // page{}(暗) + .theme-light/.theme-merchant(商家日) + .theme-topic-editor(创建域)
  assert.ok(blocks.length >= 3, `expected page{} + 两个浅色逃生口,实得 ${blocks.length}`)
  blocks.forEach(({ selector, body }) => {
    const navBg = navBgOf(body)
    assert.ok(navBg, `${selector} 重声明了 --cy-color-bg-page,却没有重声明 --cy-comp-nav-bg(顶栏会停在父级求值结果上)`)
    assert.equal(navBg, 'var(--cy-color-bg-page)', `${selector} 的顶栏底色必须直接引用页面底色语义 token,不得写字面色`)
  })
}

test('每个主题块都把顶栏底色锁在 var(--cy-color-bg-page) 上', () => {
  assertNavSurfaceContract(read(TOKENS))
})

function declaredVars(body) {
  const out = new Map()
  const re = /(--cy-[a-z0-9-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(body)) !== null) out.set(m[1], m[2].trim())
  return out
}

function blockBody(source, selectorRe, label) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const m = stripped.match(selectorRe)
  assert.ok(m, `${label} 规则块不见了`)
  return m[1]
}

// .theme-dark 可能【嵌在浅色区域内】(广场商家态里切回玩家态的子树)。
// 自定义属性沿 DOM 继承 —— 父级 .theme-light 已把 --cy-color-* 覆成日值,
// 子节点挂 .theme-dark 若不重声明,就只会继续继承浅值;只写 comp 别名更不救,
// 因为 var(--cy-color-bg-page) 在这里求值出来的正是父级那份浅色。
// ⇒ 凡是浅色主题块能覆盖的语义键,.theme-dark 都必须能覆盖回去。
function assertDarkEscapeHatchRestoresNav(source) {
  const dark = blockBody(source, /page\.theme-dark,\s*\.theme-dark\s*\{([\s\S]*?)\}/, '.theme-dark')
  const light = blockBody(source, /page\.theme-light,\s*\.theme-light,\s*\.theme-merchant\s*\{([\s\S]*?)\}/, '.theme-light')

  const darkVars = declaredVars(dark)
  const lightVars = declaredVars(light)

  assert.equal(darkVars.get('--cy-comp-nav-bg'), 'var(--cy-color-bg-page)', '.theme-dark 必须写回顶栏底色,否则嵌在浅色区里会留白顶栏')

  // 只查"有没有声明",不查"值是否与浅色不同":遮罩 / 危险色 / 品牌紫这几枚
  // 明暗两套本就同值,拿"必须不同"当判据会把正确实现judge成错的。
  const missing = []
  lightVars.forEach((_lightValue, key) => {
    if (key.startsWith('--cy-comp-nav-')) return // 别名层,值本就同为 var(...) 引用
    if (!darkVars.has(key)) missing.push(key)
  })

  assert.deepEqual(missing, [], '.theme-dark 必须重声明浅色块覆盖过的每个语义 token,否则嵌套时这些键会停在浅值上')
}

test('.theme-dark 逃生口把顶栏底色写回暗色', () => {
  assertDarkEscapeHatchRestoresNav(read(TOKENS))
})

test('负控:.theme-dark 不写回顶栏底色必须判红', () => {
  const source = read(TOKENS)
  const target = `  --cy-comp-nav-bg:     var(--cy-color-bg-page);
  --cy-comp-nav-border: var(--cy-color-border-subtle);
}`
  const idx = source.lastIndexOf(target)
  assert.ok(idx > 0, '锚点漂了,负控失效')
  const mutated = source.slice(0, idx) + '}' + source.slice(idx + target.length)
  assert.throws(() => assertDarkEscapeHatchRestoresNav(mutated))
})

test('负控:顶栏底色改回 glass(蓝紫带)必须判红', () => {
  const mutated = read(TOKENS).replace(
    '--cy-comp-nav-bg:     var(--cy-color-bg-page);',
    '--cy-comp-nav-bg:     var(--cy-color-bg-glass);',
  )
  assert.notEqual(mutated, read(TOKENS), '变异未生效,负控本身是假的')
  assert.throws(() => assertNavSurfaceContract(mutated))
})

test('负控:任一浅色主题块漏掉 comp 别名重声明必须判红', () => {
  const source = read(TOKENS)
  const target = `  /* comp 别名重声明:见基础 page 规则内「导航」段注释。 */
  --cy-comp-nav-bg:     var(--cy-color-bg-page);
  --cy-comp-nav-border: var(--cy-color-border-subtle);`
  assert.ok(source.includes(target), '锚点漂了,负控失效')
  assert.throws(() => assertNavSurfaceContract(source.replace(target, '')))
})

test('负控:用字面色"调得像"而不是引用语义 token 必须判红', () => {
  const mutated = read(TOKENS).replace(
    '--cy-comp-nav-bg:     var(--cy-color-bg-page);',
    '--cy-comp-nav-bg:     rgba(2, 1, 4, .86);',
  )
  assert.throws(() => assertNavSurfaceContract(mutated))
})

// ── 2. 原生导航页:系统顶栏配色必须跟随正文主题 ────────────────────────────
//
// 走系统导航的页面,顶栏由 json 的 navigationBarBackgroundColor 决定,拿不到 CSS 变量。
// 正文是浅色(挂 .theme-light/.theme-merchant/.theme-topic-editor,或 @import merchant-light)
// 而顶栏留着全局暗色,就是"顶栏黑、正文白"的断层 —— 与 IM 那条同病异形。
const LIGHT_NAV_BG = new Set(['#fff', '#ffffff', '#f3f4f4', '#f9f9f9', '#f8f9fa'])

function pageThemeIsLight(wxml, wxss) {
  if (/@import\s+[^;]*merchant-light(-scope)?\.wxss/.test(wxss)) return true
  return /class="[^"]*\b(theme-light|theme-merchant|theme-topic-editor)\b/.test(wxml)
}

function collectNativeNavPages() {
  const app = JSON.parse(read('app.json'))
  const routes = [...app.pages]
  app.subPackages.forEach((sp) => {
    const root = sp.root.replace(/\/$/, '')
    sp.pages.forEach((p) => routes.push(`${root}/${p}`))
  })
  return routes.filter((route) => {
    const cfgPath = path.join(ROOT, `${route}.json`)
    if (!fs.existsSync(cfgPath)) return false
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8')).navigationStyle !== 'custom'
  })
}

function assertNativeNavMatchesBody(route, configSource) {
  const cfg = JSON.parse(configSource)
  const wxml = fs.existsSync(path.join(ROOT, `${route}.wxml`)) ? read(`${route}.wxml`) : ''
  const wxss = fs.existsSync(path.join(ROOT, `${route}.wxss`)) ? read(`${route}.wxss`) : ''
  const bodyLight = pageThemeIsLight(wxml, wxss)
  // 缺省继承 app.json 的全局暗色顶栏
  const navBg = (cfg.navigationBarBackgroundColor || '#020104').toLowerCase()
  const navLight = LIGHT_NAV_BG.has(navBg)
  assert.equal(navLight, bodyLight, `${route}:正文${bodyLight ? '浅' : '暗'}色,系统顶栏却是 ${navBg} —— 顶栏与正文断层`)
  if (bodyLight) {
    assert.equal(cfg.navigationBarTextStyle, 'black', `${route}:浅色顶栏必须配深色标题/返回键`)
  }
}

test('所有系统导航页的顶栏配色与正文主题同侧', () => {
  collectNativeNavPages().forEach((route) => {
    assertNativeNavMatchesBody(route, read(`${route}.json`))
  })
})

test('负控:把某个浅色正文页的顶栏改回全局暗色必须判红', () => {
  // publish/activity 本身已全量转 custom nav(不再吃 navigationBarBackgroundColor),
  // 全站已找不到「浅色正文 + 原生导航」的活样本——这条负控改用合成 configSource,
  // 只借该页真实 wxml 的 theme-topic-editor 类判 bodyLight,json 部分自己造一份
  // "假设它仍是原生导航"的基线,再验证缺色配置会被判红。
  const route = 'pages/publish/activity/index'
  const nativeLightConfig = JSON.stringify({
    navigationBarTitleText: '发布活动',
    navigationBarBackgroundColor: '#FFFFFF',
    navigationBarTextStyle: 'black',
  })
  assertNativeNavMatchesBody(route, nativeLightConfig)
  const mutated = JSON.parse(nativeLightConfig)
  delete mutated.navigationBarBackgroundColor
  assert.throws(() => assertNativeNavMatchesBody(route, JSON.stringify(mutated)))
})

test('负控:浅色顶栏留着白色标题(看不见的返回键)必须判红', () => {
  const route = 'pages/publish/activity/index'
  const mutated = JSON.stringify({
    navigationBarTitleText: '发布活动',
    navigationBarBackgroundColor: '#FFFFFF',
    navigationBarTextStyle: 'white',
  })
  assert.throws(() => assertNativeNavMatchesBody(route, mutated))
})

// ── 3. 顶栏 token 一律读 ① 语义真值层,不读 ② 旧名别名 ──────────────────────
//
// 别名(--cy-bg-page)在 tokens.wxss 的 page{} 上就已就地求值。任何【类作用域】规则
// 里读别名,拿到的都是 page 那一份;真值层(--cy-color-bg-page)才会随最近的主题块
// 重新求值。两者当前同值,所以这条不是修 bug,是把"挪进类作用域会静默变暗"的雷拆掉。
const NAV_TOKEN_SOURCES = ['style/tokens.wxss', 'style/merchant-light.wxss']

function assertNavTokensUseTruthLayer(sources) {
  sources.forEach(({ file, text }) => {
    const decls = text.match(/--cy-comp-nav-bg\s*:\s*[^;]+;/g) || []
    assert.ok(decls.length > 0, `${file} 里没有 --cy-comp-nav-bg 声明,锚点漂了`)
    decls.forEach((d) => {
      assert.doesNotMatch(d, /var\(--cy-bg-|var\(--cy-text-|var\(--cy-border-/, `${file}:${d} 读了 ② 旧名别名,类作用域下会拿到 page 上求值好的那份`)
      assert.match(d, /var\(--cy-color-/, `${file}:${d} 必须读 ① 语义真值层`)
    })
  })
}

const navTokenSources = () => NAV_TOKEN_SOURCES.map((file) => ({ file, text: read(file) }))

test('顶栏 token 全部读 ① 语义真值层', () => {
  assertNavTokensUseTruthLayer(navTokenSources())
})

test('负控:顶栏 token 退回 ② 旧名别名必须判红', () => {
  const sources = navTokenSources()
  const target = sources.find((s) => s.file === 'style/merchant-light.wxss')
  const before = target.text
  target.text = target.text.replace('--cy-comp-nav-bg: var(--cy-color-bg-page);', '--cy-comp-nav-bg: var(--cy-bg-page);')
  assert.notEqual(target.text, before, '变异未生效,负控本身是假的')
  assert.throws(() => assertNavTokensUseTruthLayer(sources))
})

// ── 4. 自定义导航页:状态栏字色也必须站在正文那一侧 ────────────────────────
//
// 上面第 2 段只遍历【系统导航】页,navigationStyle:"custom" 的页从一开始就被 collectNativeNavPages 滤掉了。
// 但 custom 关掉的是【标题栏】,状态栏(时间/信号/电量)那 44px 仍由 json 的
// navigationBarTextStyle 决定,而它下面的底正是页面自己画的第一屏。
// 创建域三页(templateadd / fabu / template-intro)根节点恒挂 .theme-topic-editor
// (页底 #F3F4F4),却留着全局暗色带的 "white" ⇒ 白字压浅底只剩 1.06:1,
// 状态栏时间和信号在屏幕上等于不存在(2026-09-24 走查 CU-M-158 / CU-C-151 两条实拍同一病)。
// 判据要【black】而不是"别写 white":app.json window 全局就是 navigationBarTextStyle:"white",
// 字段不写等于继承白 —— topic/pricing 与 coop/invite-detail 两页正是这么漏掉的。
//
// ⚠️ 判据只收【恒浅】页:另有 7 页根 class 是 {{isMerchant ? 'theme-merchant' : 'theme-dark'}}
// 这种身份翻转,静态 json 无论写 black 还是 white 都只对一半,得走运行时
// wx.setNavigationBarColor —— 那是另一条卡,不在本条射程内(见 fixt_visual_report 不确定清单)。

function rootClassAttr(wxml) {
  const m = wxml.match(/<view[^>]*\sclass="([^"]*)"/)
  return m ? m[1] : ''
}

/** 根 class 恒为浅色主题:出现浅主题词,且同一表达式里没有可翻转到的 theme-dark */
function rootIsUnconditionallyLight(wxml) {
  const cls = rootClassAttr(wxml)
  if (/\btheme-dark\b/.test(cls)) return false
  return /\b(theme-light|theme-merchant|theme-topic-editor)\b/.test(cls)
}

function collectCustomNavPages() {
  const app = JSON.parse(read('app.json'))
  const routes = [...app.pages]
  ;(app.subPackages || []).forEach((sp) => {
    const root = sp.root.replace(/\/$/, '')
    sp.pages.forEach((p) => routes.push(`${root}/${p}`))
  })
  return routes.filter((route) => {
    const cfgPath = path.join(ROOT, `${route}.json`)
    if (!fs.existsSync(cfgPath)) return false
    try {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8')).navigationStyle === 'custom'
    } catch (e) {
      return false
    }
  })
}

// config / wxml 都可从参数注入:负控要喂"假设的 json""假设的根 class",
// 又不能真去覆写仓库文件(并行的其它断言会读到半成品)。
function assertCustomNavStatusColor(route, configSource, wxmlSource) {
  const cfg = JSON.parse(configSource == null ? read(`${route}.json`) : configSource)
  const wxml = wxmlSource == null ? read(`${route}.wxml`) : wxmlSource
  if (!rootIsUnconditionallyLight(wxml)) return
  assert.equal(
    cfg.navigationBarTextStyle,
    'black',
    `${route}:恒浅色正文(${rootClassAttr(wxml)})配了 navigationBarTextStyle:"${cfg.navigationBarTextStyle}" —— ` +
      'custom 导航只关掉标题栏,状态栏字色仍由它决定,白字压浅底等于隐形',
  )
}

test('恒浅色正文的自定义导航页,状态栏必须是深色字', () => {
  const checked = collectCustomNavPages().filter((route) => {
    const wxml = fs.existsSync(path.join(ROOT, `${route}.wxml`)) ? read(`${route}.wxml`) : ''
    return rootIsUnconditionallyLight(wxml)
  })
  // 创建域四页 + 后续任何恒浅页都在这条里;下限防的是「判据哪天悄悄变成空集,门禁恒绿」。
  assert.ok(checked.length >= 4, `恒浅自定义导航页只认出 ${checked.length} 个,判据八成漂了`)
  checked.forEach((route) => assertCustomNavStatusColor(route))
})

test('负控:把创建节点玩法页状态栏改回 white 必须判红', () => {
  const route = 'pages/publish/templateadd/templateadd'
  const mutated = JSON.stringify({ ...JSON.parse(read(`${route}.json`)), navigationBarTextStyle: 'white' })
  assert.throws(
    () => assertCustomNavStatusColor(route, mutated),
    assert.AssertionError,
    '改回 white 却判绿,说明这条契约没真读到 json',
  )
})

test('负控:身份翻转页(根 class 可翻到 theme-dark)必须放行,而不是把判据拖成恒绿', () => {
  // 反向变异:templateadd 的根 class 改成 {{isMerchant ? ... : 'theme-dark'}} 后,
  // 本条契约应当【放行】它 —— 放行是因为它落进"得走运行时 setNavigationBarColor"的另一格,
  // 不是因为 rootIsUnconditionallyLight 恒返回 false(那会让整条门禁假绿)。
  const route = 'pages/publish/templateadd/templateadd'
  const original = read(`${route}.wxml`)
  const flipped = original.replace(/<view class="theme-topic-editor/, `<view class="{{isMerchant ? 'theme-topic-editor' : 'theme-dark'}}`)
  assert.notEqual(flipped, original, '变异锚点漂了,负控本身是假的')
  assert.equal(rootIsUnconditionallyLight(flipped), false, '身份翻转页必须被排除在本条射程之外')
  // 排除确实生效:同一份 white config 在恒浅下判红、在翻转下放行。
  assert.throws(() => assertCustomNavStatusColor(route, '{"navigationBarTextStyle":"white"}', original))
  assert.doesNotThrow(() => assertCustomNavStatusColor(route, '{"navigationBarTextStyle":"white"}', flipped))
})
