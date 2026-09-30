const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const readRaw = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

/* 系统深色模式(2026-08-22)引入后:本文件断言的是**浅色外观**下的取值。
 * @media (prefers-color-scheme: dark) 是另一个维度(系统外观),排在源码后面会赢层叠,
 * 解析浅色值前必须先摘掉,否则这里会读到深色值而误判。
 * 深色那一维由 tests/unit/system-darkmode-contract.test.js 单独锁。 */
const stripDarkMedia = (css) => {
  let out = '', i = 0
  for (;;) {
    const at = css.indexOf('@media (prefers-color-scheme: dark)', i)
    if (at < 0) { out += css.slice(i); return out }
    out += css.slice(i, at)
    let depth = 0, j = css.indexOf('{', at)
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') { depth--; if (depth === 0) { j++; break } }
    }
    i = j
  }
}
const read = relativePath => stripDarkMedia(readRaw(relativePath))

const FILES = {
  tokens: 'style/tokens.wxss',
  merchantLight: 'style/merchant-light.wxss',
  dateSheet: 'components/cy/date-sheet/index.wxss',
  dateSheetWxml: 'components/cy/date-sheet/index.wxml',
  fabu: 'pages/publish/fabu/index.wxss',
  fabuWxml: 'pages/publish/fabu/index.wxml',
  profitWxml: 'components/cy/scene-merchant-profit/index.wxml',
  profitWxss: 'components/cy/scene-merchant-profit/index.wxss',
  profitJs: 'components/cy/scene-merchant-profit/index.js',
  activityWxml: 'pages/publish/activity/index.wxml',
  activityWxss: 'pages/publish/activity/index.wxss',
  withdrawWxss: 'subpackageMember/tixian/tixian.wxss',
}

function blockAfter(source, matcher, label) {
  const match = matcher.exec(source)
  assert.ok(match, `missing block: ${label}`)
  const open = source.indexOf('{', match.index + match[0].length)
  assert.notEqual(open, -1, `missing opening brace: ${label}`)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, i)
  }
  assert.fail(`missing closing brace: ${label}`)
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return blockAfter(source, new RegExp('(?:^|,)\\s*' + escaped + '\\s*(?=,|\\{)', 'm'), selector)
}

function pageToken(source, name) {
  return resolveCustomProperty(source, [cssNode([], 'page')], name, 'root page tokens')
}

function topicEditorToken(source, name) {
  return resolveCustomProperty(
    source,
    [cssNode([], 'page'), cssNode(['theme-topic-editor'], 'view')],
    name,
    'theme-topic-editor tokens',
  )
}

function darkThemeToken(source, name) {
  return resolveCustomProperty(
    source,
    [cssNode([], 'page'), cssNode(['theme-dark'], 'view')],
    name,
    'theme-dark tokens',
  )
}

function rgb(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `expected opaque hex color, got ${hex}`)
  return hex.slice(1).match(/../g).map(part => Number.parseInt(part, 16))
}

function luminance(color) {
  const channels = color.map(value => value / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

function composite(foreground, alpha, background) {
  return foreground.map((value, index) => Math.round(value * alpha + background[index] * (1 - alpha)))
}

function rgbaBackground(body, label) {
  const match = /background:\s*rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d*\.?\d+)\s*\)/.exec(body)
  assert.ok(match, `${label} 必须声明可计算的 rgba 背景`)
  const color = match.slice(1, 4).map(Number)
  const alpha = Number(match[4])
  assert.ok(color.every(channel => channel >= 0 && channel <= 255), `${label} RGB 通道越界`)
  assert.ok(alpha >= 0 && alpha <= 1, `${label} alpha 越界`)
  return { color, alpha }
}

function declaration(body, name, label) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...body.matchAll(new RegExp(`${escaped}\\s*:\\s*([^;]+);`, 'g'))]
  assert.ok(matches.length, `${label} 缺少 ${name}`)
  return matches.at(-1)[1].trim()
}

function rgba(value, label) {
  const match = /^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d*\.?\d+)\s*\)$/.exec(value)
  assert.ok(match, `${label} 必须是可计算的 rgba 值`)
  return {
    color: match.slice(1, 4).map(Number),
    alpha: Number(match[4]),
  }
}

function merchantTheme(source) {
  return blockAfter(
    source,
    /page\.theme-light\s*,\s*\.theme-light\s*,\s*\.theme-merchant\s*/,
    'merchant/light theme tokens',
  )
}

function merchantScopedToken(source, name) {
  const page = cssNode([], 'page')
  const light = resolveCustomProperty(
    source,
    [page, cssNode(['theme-light'], 'view')],
    name,
    'theme-light tokens',
  )
  const merchant = resolveCustomProperty(
    source,
    [page, cssNode(['theme-merchant'], 'view')],
    name,
    'theme-merchant tokens',
  )
  assert.equal(merchant, light, `${name} 在 theme-light / theme-merchant 的最终解析值必须一致`)
  return light
}

function merchantMirrorToken(source, name) {
  const page = cssNode([], 'page')
  const light = resolveCustomProperty(
    source,
    [page, cssNode(['theme-light'], 'view')],
    name,
    'merchant-light 镜像的 theme-light 路径',
  )
  const merchant = resolveCustomProperty(
    source,
    [page, cssNode(['theme-merchant'], 'view')],
    name,
    'merchant-light 镜像的 theme-merchant 路径',
  )
  assert.equal(merchant, light, `${name} 的 merchant-light 镜像在两条真实根路径必须一致`)
  return light
}

function assertMerchantLightLayers(tokens, merchantLight) {
  const page = rgb(merchantScopedToken(tokens, '--cy-color-bg-page'))
  const surface = rgb(merchantScopedToken(tokens, '--cy-color-bg-surface'))
  const border = rgb(merchantScopedToken(tokens, '--cy-color-border-subtle'))
  const strongBorder = rgb(merchantScopedToken(tokens, '--cy-color-border-strong'))
  const cellFill = rgb(merchantScopedToken(tokens, '--cy-comp-cell-fill-bg'))
  const cellForeground = rgb(merchantScopedToken(tokens, '--cy-color-text-secondary'))
  const darkTheme = blockAfter(tokens, /page\.theme-dark,\s*\.theme-dark\s*/, 'theme-dark tokens')
  assert.equal(
    declaration(darkTheme, '--cy-comp-cell-fill-bg', 'theme-dark 显式逃生口'),
    'var(--cy-color-bg-surface-subtle)',
    'theme-dark 必须显式把共享填充恢复为暗域 subtle 表面',
  )
  const darkCellFill = rgb(darkThemeToken(tokens, '--cy-comp-cell-fill-bg'))
  const darkSurfaceSubtle = rgb(darkThemeToken(tokens, '--cy-color-bg-surface-subtle'))
  const defaultDarkSurfaceSubtle = rgb(pageToken(tokens, '--cy-color-bg-surface-subtle'))
  const shadow = merchantScopedToken(tokens, '--cy-comp-card-shadow-day')
  const shadowMatch = /^0\s+([\d.]+)rpx\s+([\d.]+)rpx\s+rgba\(([^)]+)\)$/.exec(shadow)
  assert.ok(shadowMatch, '商家浅端卡投影必须是单层、可计算的下投影')
  const shadowColor = rgba(`rgba(${shadowMatch[3]})`, '商家浅端卡投影')
  const shadowComposite = composite(shadowColor.color, shadowColor.alpha, page)

  assert.ok(Number(shadowMatch[1]) > 0, '商家浅端卡投影需要非零 y-offset')
  assert.ok(Number(shadowMatch[2]) > 0, '商家浅端卡投影需要非零 blur')
  // 裁决:卡片 vs 页底是识别 UI 组件所需的边界信息,按 WCAG 1.4.11 锁 3:1。
  // 卡内发丝线只做内容分组,沿用玩家新卡 1.23:1 的「可感知」尺度,下限 1.2:1；不得误套 3:1。
  // 卡内共享填充同走 1.2:1,并反向锁其上的 secondary 前景 ≥4.5:1,避免修分层时压垮文字。
  assert.ok(
    contrast(shadowComposite, page) >= 3,
    '商家浅端卡投影峰值与页底至少 3:1，避免组件边界消失',
  )
  assert.equal(merchantScopedToken(tokens, '--cy-comp-card-border'), 'transparent')
  const groupingContrast = contrast(border, surface)
  assert.ok(groupingContrast >= 1.2, '商家浅端卡内 subtle 分组线对白卡至少 1.2:1')
  assert.ok(groupingContrast < 1.5, '卡内分组线不得冒充组件边界而压垮内容前景')
  const cellContrast = contrast(cellFill, surface)
  assert.ok(cellContrast >= 1.2, '商家浅端卡内共享填充对白卡至少 1.2:1')
  assert.ok(cellContrast < 1.5, '卡内共享填充不得冒充组件边界')
  assert.ok(contrast(cellForeground, cellFill) >= 4.5, '卡内共享填充上的 secondary 前景必须保持 AA')
  assert.deepEqual(darkCellFill, darkSurfaceSubtle, 'theme-dark 必须把共享填充恢复为暗域 subtle 表面')
  assert.notDeepEqual(darkCellFill, cellFill, '嵌套 theme-dark 不得漏用商家浅色共享填充')
  assert.deepEqual(darkSurfaceSubtle, defaultDarkSurfaceSubtle, 'theme-dark subtle 表面必须与默认暗域真源一致')
  ;['theme-light', 'theme-merchant'].forEach(parentTheme => {
    const nestedDarkChain = [
      cssNode([], 'page'),
      cssNode([parentTheme], 'view'),
      cssNode(['theme-dark'], 'view'),
    ]
    const nestedCellFill = rgb(resolveCustomProperty(
      tokens,
      nestedDarkChain,
      '--cy-comp-cell-fill-bg',
      `${parentTheme} 内嵌 theme-dark 共享填充`,
    ))
    const nestedSurface = rgb(resolveCustomProperty(
      tokens,
      nestedDarkChain,
      '--cy-color-bg-surface-subtle',
      `${parentTheme} 内嵌 theme-dark subtle 表面`,
    ))
    assert.deepEqual(nestedCellFill, defaultDarkSurfaceSubtle, `${parentTheme} 内嵌暗域不得继承浅色共享填充`)
    assert.deepEqual(nestedSurface, defaultDarkSurfaceSubtle, `${parentTheme} 内嵌暗域 subtle 必须回到默认暗真源`)
  })
  assert.ok(
    contrast(strongBorder, surface) > contrast(border, surface),
    '商家浅端 strong 边界不得比 subtle 更弱',
  )

  ;[
    '--cy-color-border-subtle',
    '--cy-color-border-strong',
    '--cy-comp-card-shadow-day',
    '--cy-comp-card-border',
    '--cy-comp-cell-fill-bg',
  ].forEach(name => {
    assert.equal(
      merchantMirrorToken(merchantLight, name),
      merchantScopedToken(tokens, name),
      `${name} 必须同步到真实由页面 import 的 merchant-light 镜像`,
    )
  })
}

function cssNode(classes, tag = null) {
  return { classes, tag }
}

function parseSelector(selector) {
  if (/[+~#:[\]]/.test(selector)) return null
  const groups = selector.trim().split(/\s*>\s*/)
  const compounds = []
  const relations = []
  groups.forEach((group, groupIndex) => {
    group.trim().split(/\s+/).filter(Boolean).forEach((compound, compoundIndex) => {
      relations.push(compounds.length === 0 ? null : (groupIndex > 0 && compoundIndex === 0 ? 'child' : 'descendant'))
      compounds.push(compound)
    })
  })
  return compounds.length ? { compounds, relations } : null
}

function compoundMatchesNode(compound, rawNode) {
  const node = Array.isArray(rawNode) ? cssNode(rawNode) : rawNode
  const tag = /^[a-z][a-z0-9-]*/i.exec(compound)?.[0]?.toLowerCase() || null
  if (tag && tag !== node.tag) return false
  const classes = [...compound.matchAll(/\.([a-z0-9_-]+)/gi)].map(match => match[1])
  if (!tag && !classes.length) return false
  const residue = compound
    .replace(/^[a-z][a-z0-9-]*/i, '')
    .replace(/\.[a-z0-9_-]+/gi, '')
  if (residue) return false
  return classes.every(name => node.classes.includes(name))
}

function selectorMatchesChain(selector, chain) {
  const parsed = parseSelector(selector)
  if (!parsed) return false
  let node = chain.length - 1
  if (!compoundMatchesNode(parsed.compounds.at(-1), chain[node])) return false
  for (let i = parsed.compounds.length - 2; i >= 0; i -= 1) {
    node -= 1
    if (parsed.relations[i + 1] === 'child') {
      if (node < 0 || !compoundMatchesNode(parsed.compounds[i], chain[node])) return false
      continue
    }
    while (node >= 0 && !compoundMatchesNode(parsed.compounds[i], chain[node])) node -= 1
    if (node < 0) return false
  }
  return true
}

function selectorSpecificity(selector) {
  const ids = (selector.match(/#[a-z0-9_-]+/gi) || []).length
  const classes = (selector.match(/\.[a-z0-9_-]+/gi) || []).length
  const elements = selector
    .split(/[\s>+~]+/)
    .filter(compound => /^[a-z][a-z0-9-]*/i.test(compound))
    .length
  return ids * 10000 + classes * 100 + elements
}

function resolveCssProperty(source, chain, property, label, required = true) {
  const css = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:charset|import)\s+[^;]+;/gi, '')
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g
  let block
  let order = 0
  let winner = null
  while ((block = blockPattern.exec(css))) {
    const declarations = [...block[2].matchAll(/(--[a-z0-9-]+|[a-z-]+)\s*:\s*([^;]+?)(?=;|$)/gi)]
    block[1].split(',').forEach(rawSelector => {
      const selector = rawSelector.trim()
      order += 1
      if (!selectorMatchesChain(selector, chain)) return
      let local = null
      declarations.forEach(([, declaredProperty, declaredValue], declarationOrder) => {
        const normalized = declaredProperty.toLowerCase()
        if (normalized === property || (property === 'background-color' && normalized === 'background')) {
          const important = /!important\s*$/i.test(declaredValue)
          const value = declaredValue.replace(/\s*!important\s*$/i, '').trim()
          if (
            !local
            || (important && !local.important)
            || (important === local.important && declarationOrder > local.order)
          ) {
            local = { value, important, order: declarationOrder }
          }
        }
      })
      if (!local) return
      const specificity = selectorSpecificity(selector)
      if (
        !winner
        || (local.important && !winner.important)
        || (local.important === winner.important && (
          specificity > winner.specificity
          || (specificity === winner.specificity && order > winner.order)
        ))
      ) {
        winner = { ...local, specificity, order, selector }
      }
    })
  }
  if (required) assert.ok(winner, `${label} 缺少层叠后生效的 ${property}`)
  return winner ? winner.value : null
}

function resolveCustomProperty(source, chain, property, label, seen = new Set()) {
  assert.ok(!seen.has(property), `${label} 的 token alias 不得形成环`)
  for (let node = chain.length - 1; node >= 0; node -= 1) {
    const originChain = chain.slice(0, node + 1)
    const value = resolveCssProperty(source, originChain, property, label, false)
    if (value === null) continue
    const alias = /^var\((--[^,)]+)\)$/.exec(value)
    if (!alias) return value
    const nextSeen = new Set(seen)
    nextSeen.add(property)
    return resolveCustomProperty(source, originChain, alias[1], label, nextSeen)
  }
  assert.fail(`${label} 缺少层叠/继承后生效的 ${property}`)
}

function resolvedToken(source, chain, property, label) {
  const value = resolveCssProperty(source, chain, property, label)
  const match = /^var\((--cy-[^)]+)\)$/.exec(value)
  assert.ok(match, `${label} 的最终 ${property} 必须消费语义 token，实际为 ${value}`)
  return match[1]
}

function resolvedOpacity(source, chain, label, fallback = null) {
  const value = resolveCssProperty(source, chain, 'opacity', label, fallback === null)
  if (value === null) return fallback
  assert.match(value, /^\d*\.?\d+$/, `${label} 最终 opacity 必须可计算`)
  const opacity = Number(value)
  assert.ok(opacity >= 0 && opacity <= 1, `${label} opacity 越界`)
  return opacity
}

function assertOpaqueCssChain(source, chain, label) {
  chain.forEach((node, index) => {
    const prefix = chain.slice(0, index + 1)
    const opacity = resolvedOpacity(source, prefix, `${label}祖先层 ${index + 1}`, 1)
    assert.equal(opacity, 1, `${label}任一祖先 opacity 都不得削弱承载面`)
  })
}

function assertOpaqueStepDescendantChain(source, chain, label) {
  chain.forEach((node, index) => {
    if (node.classes.includes('pd-step')) return
    const prefix = chain.slice(0, index + 1)
    const opacity = resolvedOpacity(source, prefix, `${label}层 ${index + 1}`, 1)
    assert.equal(opacity, 1, `${label}除状态 step 外的任一层都不得再次淡出`)
  })
}

function assertTransparentCssNodes(source, cascadeSource, chain, indexes, label) {
  indexes.forEach(index => {
    const prefix = chain.slice(0, index + 1)
    let value = resolveCssProperty(source, prefix, 'background-color', label, false)
    if (value === null) return
    const token = /^var\((--[^,)]+)\)$/.exec(value)
    if (token) value = resolveCustomProperty(cascadeSource, prefix, token[1], label)
    const transparentRgba = /^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\)$/.test(value)
    assert.ok(value === 'transparent' || value === 'none' || transparentRgba, `${label} 的中间祖先不得盖掉双层 scrim`)
  })
}

function attribute(openingTag, name, label, required = true) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`\\b${escaped}="([^"]*)"`).exec(openingTag)
  if (required) assert.ok(match, `${label} 缺少 ${name} 属性`)
  return match ? match[1] : null
}

function elementByClass(source, tag, className, label) {
  const openingPattern = new RegExp(`<${tag}\\b[^>]*>`, 'g')
  let openingMatch
  while ((openingMatch = openingPattern.exec(source))) {
    const classes = attribute(openingMatch[0], 'class', label, false)?.split(/\s+/).filter(Boolean) || []
    if (!classes.includes(className)) continue
    const elementPattern = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}\\s*>`, 'g')
    elementPattern.lastIndex = openingMatch.index
    let depth = 0
    let elementMatch
    while ((elementMatch = elementPattern.exec(source))) {
      depth += elementMatch[0].startsWith(`</${tag}`) ? -1 : 1
      if (depth === 0) {
        return {
          classes,
          opening: openingMatch[0],
          source: source.slice(openingMatch.index, elementPattern.lastIndex),
        }
      }
    }
    assert.fail(`${label} 缺少闭合标签`)
  }
  assert.fail(`${label} 缺少 .${className}`)
}

function domPathToClass(source, targetTag, className, label) {
  const tagPattern = /<(\/)?([a-z][a-z0-9-]*)\b([^>]*)>/gi
  const stack = []
  let match
  while ((match = tagPattern.exec(source))) {
    const tag = match[2].toLowerCase()
    if (match[1]) {
      const open = stack.pop()
      assert.equal(open?.tag, tag, `${label} 前的 WXML 标签必须正确嵌套`)
      continue
    }
    const classes = attribute(match[0], 'class', label, false)?.split(/\s+/).filter(Boolean) || []
    const node = { classes, opening: match[0], tag }
    if (tag === targetTag && classes.includes(className)) return [...stack, node]
    if (!/\/\s*>$/.test(match[0])) stack.push(node)
  }
  assert.fail(`${label} 缺少真实 DOM 路径`)
}

function domPathsToClass(source, targetTag, className, label) {
  const tagPattern = /<(\/)?([a-z][a-z0-9-]*)\b([^>]*)>/gi
  const stack = []
  const paths = []
  let match
  while ((match = tagPattern.exec(source))) {
    const tag = match[2].toLowerCase()
    if (match[1]) {
      const open = stack.pop()
      assert.equal(open?.tag, tag, `${label} 前的 WXML 标签必须正确嵌套`)
      continue
    }
    const classes = attribute(match[0], 'class', label, false)?.split(/\s+/).filter(Boolean) || []
    const node = { classes, opening: match[0], tag }
    if (tag === targetTag && classes.includes(className)) paths.push([...stack, node])
    if (!/\/\s*>$/.test(match[0])) stack.push(node)
  }
  assert.ok(paths.length, `${label} 缺少真实 DOM 路径`)
  return paths
}

function assertNoInlineOpacity(opening, label) {
  const style = attribute(opening, 'style', label, false)
  if (!style) return
  const declarations = [...style.matchAll(/(?:^|;)\s*opacity\s*:\s*([^;]+)/gi)]
  declarations.forEach(([, value]) => {
    assert.equal(value.trim(), '1', `${label} 的 inline opacity 不得削弱整个承载面`)
  })
}




function cssChainFromDomPath(path) {
  return [cssNode([], 'page'), ...path.map(node => cssNode(node.classes, node.tag))]
}



function colorToken(body, label) {
  const match = /color:\s*var\((--cy-color-action-[^)]+)\)/.exec(body)
  assert.ok(match, `${label} 必须消费 action 语义 token`)
  return match[1]
}

function assertSkeletonContract(source) {
  const base = rgb(pageToken(source, '--cy-color-skeleton-base'))
  const highlight = rgb(pageToken(source, '--cy-color-skeleton-highlight'))
  const black = [0, 0, 0]
  const playerCard = rgb('#1C1C1E')
  const baseLightness = (Math.max(...base) + Math.min(...base)) / 510
  const highlightLightness = (Math.max(...highlight) + Math.min(...highlight)) / 510

  assert.equal(new Set(base).size, 1, '骨架基色必须饱和度归零')
  assert.equal(new Set(highlight).size, 1, '骨架高光必须饱和度归零')
  assert.ok(baseLightness >= 0.09 && baseLightness <= 0.105, '骨架基色应保留原明度档')
  assert.ok(highlightLightness >= 0.13 && highlightLightness <= 0.15, '骨架高光应保留原明度档')
  assert.ok(contrast(base, black) >= 1.19, '骨架基色相对纯黑需要可辨')
  assert.ok(contrast(base, black) < contrast(playerCard, black), '骨架基色不能撞到玩家卡片层级')
  assert.ok(contrast(highlight, base) >= 1.12, 'shimmer 高光与基色需要可辨')
}

function assertActionTokenContract(dateSheet, dateSheetWxml, fabu, tokens) {
  /* CU-M-149(2026-09-24):头部改成与 cy-sheet 同构的「左标题 / 右上角 ✕」,
     「完成」下到底部整宽主按钮。标题行两端各摆一颗文字动作(左取消 / 右完成)是
     全仓唯一不用右上 ✕ 的弹层头部,而且两颗文字挤在一行里,实拍读不出哪个是主操作
     (CU-C-166 的另一半:面板底被遮罩压暗,整行更灰)。
     现在语义色的文字动作只剩 ✕ 一处 ⇒ 它必须是中性次级,不是危险色也不是主动作。 */
  const close = rule(dateSheet, '.ds-pop--dark .ds-close')
  const closeToken = colorToken(close, '日期面板关闭动作')
  assert.match(closeToken, /^--cy-color-action-secondary-/, '✕ 是中性退出,不许借用主动作色')
  assert.doesNotMatch(closeToken, /danger/, '关闭一次日期选择不是破坏性动作')

  // 「完成」不再是标题行右端的一颗文字,而是 cy-sheet footer 同档的整宽主按钮。
  assert.match(
    dateSheetWxml,
    /<cy-btn variant="primary"[^>]*bindtap="onConfirm">\{\{confirmText\}\}<\/cy-btn>/,
    '完成必须是主按钮，且仍然只发 confirm 这一条事件',
  )
  assert.match(dateSheetWxml, /class="ds-close"[^>]*bindtap="onCancel"/, '✕ 走 cancel，与点遮罩同一条出口')
  assert.doesNotMatch(dateSheetWxml, /ds-btn-cancel/, '左上「取消」按 2026-09-19 裁决退役，不许回来')

  const fabuPrimarySelectors = /\.slopes-info-page \.g-category-add-btn\s*,\s*\.slopes-info-page \.ticket-add-more\s*,\s*\.slopes-info-page \.te-save-btn\s*/
  const fabuPrimary = blockAfter(fabu, fabuPrimarySelectors, 'fabu primary text actions')
  const fabuRequired = rule(fabu, '.slopes-info-page .g-req')

  assert.match(fabuPrimary, /color:\s*var\(--cy-color-action-primary-bg\)/)
  assert.match(fabuRequired, /color:\s*var\(--cy-color-action-danger-bg\)/)
  ;[close, fabuPrimary, fabuRequired].forEach(body => {
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, '交互文字色必须由语义 token 提供')
  })

  const panelLayer = rgbaBackground(rule(dateSheet, '.ds-pop--dark::before'), '日期面板暗色层')
  ;[
    ['暗主题', darkThemeToken],
    ['主题发布页', topicEditorToken],
  ].forEach(([label, resolveToken]) => {
    const pageBackground = rgb(resolveToken(tokens, '--cy-color-bg-page'))
    const datePanel = composite(panelLayer.color, panelLayer.alpha, pageBackground)
    const closeColor = rgb(resolveToken(tokens, closeToken))
    // ✕ 是图形控件:按 WCAG 非文本 3:1 判(4.5 那一档留给正文文字)
    assert.ok(contrast(closeColor, datePanel) >= 3, `${label}日期面板 ✕ 必须与面板底可辨`)
  })

  /* 主按钮只对【暗主题】判:传 dark 的那两处(searchmap / search2)恒在 theme-dark 页上,
     实心档取的是页面主题的 --cy-btn-solid-*。主题发布页那颗面板不走 dark 档,
     拿 theme-topic-editor 的实心色去比暗面板是在比一个不存在的组合。 */
  {
    const pageBackground = rgb(darkThemeToken(tokens, '--cy-color-bg-page'))
    const panel = rgbaBackground(rule(dateSheet, '.ds-pop--dark::before'), '日期面板暗色层')
    const datePanel = composite(panel.color, panel.alpha, pageBackground)
    const solidBg = rgb(darkThemeToken(tokens, '--cy-btn-solid-bg'))
    const solidFg = rgb(darkThemeToken(tokens, '--cy-btn-solid-fg'))
    assert.ok(
      contrast(solidBg, datePanel) >= 3,
      '日期面板主按钮必须浮在面板上 —— CU-C-166 实拍就是它和遮罩同灰、读不出主操作',
    )
    assert.ok(contrast(solidFg, solidBg) >= 4.5, '主按钮文字对自身底色必须保持 AA 对比')
  }

  const fabuPanel = rgb(topicEditorToken(tokens, '--cy-color-bg-surface'))
  const topicPrimary = rgb(topicEditorToken(tokens, '--cy-color-action-primary-bg'))
  const topicDanger = rgb(topicEditorToken(tokens, '--cy-color-action-danger-bg'))
  assert.notDeepEqual(topicPrimary, topicDanger, '发布页主动作与必填提示不得塌成同色')
  assert.ok(contrast(topicPrimary, fabuPanel) >= 4.5, '发布页浅色表单主动作文字必须保持 AA 对比')
  assert.ok(contrast(topicDanger, fabuPanel) >= 4.5, '发布页浅色表单必填提示必须保持 AA 对比')
}

function assertProfitPresentation(wxml, wxss, js) {
  const statTag = wxml.match(/<cy-stat-card\b[^>]*class="stat-grid"[^>]*>/)
  assert.ok(statTag, '分润指标网格必须存在')
  assert.match(statTag[0], /columns="\{\{1\}\}"/)
  assert.match(rule(wxss, '.stat-grid'), /width:\s*100%/)
  assert.match(rule(wxss, '.stat-grid'), /min-width:\s*0/)

  const button = wxml.match(/<cy-btn\b[^>]*bind:tap="goWithdraw"[^>]*>/)
  assert.ok(button, '银行卡提现入口必须保留')
  assert.match(button[0], /variant="\{\{canWithdraw \? 'primary' : 'secondary'\}\}"/)
  assert.match(button[0], /disabled="\{\{!canWithdraw\}\}"/)
  assert.match(button[0], /aria-disabled="\{\{!canWithdraw\}\}"/)
  assert.match(wxml, /<text class="withdraw-reason"\s+wx:if="\{\{withdrawState === 'unknown'\}\}">已入账金额待确认<\/text>/)
  assert.match(wxml, /<text class="withdraw-reason"\s+wx:elif="\{\{withdrawState === 'zero'\}\}">还没有已入账分润<\/text>/)
  assert.doesNotMatch(wxml, /wx:if="\{\{!canWithdraw\}\}"[^>]*>暂无可提现金额/, 'unknown 与合法 0 不得共用同一句结论')
  assert.match(rule(wxss, '.withdraw-reason'), /color:\s*var\(--cy-text-secondary\)/)
  assert.match(js, /canWithdraw:\s*false/)
  assert.match(js, /withdrawState:\s*'unknown'/)
  assert.match(js, /goWithdraw\(\)\s*\{\s*if \(!this\.data\.canWithdraw\) return;/s)

  // CU-M-122:这条原本硬性要求空态必须带 sub,而那句 sub 只是把标题换个说法再念一遍
  // (「还没有合作结算 / 完成合作结算后，收入明细会显示在此」),已按要求删掉。
  // 本条真正要守的是「有副文案时不得长到末尾孤字」⇒ 改成:空态必须有标题;
  // 若还带 sub,才检查长度。
  const emptyTag = wxml.match(/<cy-empty\b[^>]*title="([^"]+)"[^>]*\/>/)
  assert.ok(emptyTag, '分润空态必须保留标题')
  const emptySub = /sub="([^"]+)"/.exec(emptyTag[0])
  if (emptySub) {
    assert.ok([...emptySub[1]].length <= 18, '空态副文案需缩短到常见手机宽度内，避免末尾孤字')
  }
}

function assertActivityDateLayout(wxml, wxss) {
  assert.match(wxml, /class="ul flex-b date-type-fields"/)
  assert.equal((wxml.match(/class="date-value /g) || []).length, 2, '开始/结束日期都要使用受控换行规则')
  const dateValue = rule(wxss, '.fabu .form .date-value')
  assert.match(dateValue, /white-space:\s*normal/)
  assert.match(dateValue, /word-break:\s*keep-all/)
  assert.match(dateValue, /overflow-wrap:\s*normal/)
  assert.doesNotMatch(dateValue, /break-all/)

  const mediaMatch = /@media\s*\(max-width:\s*(\d+)px\)/.exec(wxss)
  assert.ok(mediaMatch, '日期/类型需要手机窄屏重排断点')
  const breakpoint = Number(mediaMatch[1])
  assert.ok(breakpoint >= 375 && breakpoint <= 430, '窄屏断点应覆盖常见小屏且不外溢到宽屏')
  const media = blockAfter(wxss, /@media\s*\(max-width:\s*\d+px\)/, 'activity narrow layout')
  assert.match(rule(media, '.fabu .form .date-type-fields'), /flex-direction:\s*column/)
  assert.match(rule(media, '.fabu .form .date-type-fields .li'), /width:\s*100%/)
}

function assertWithdrawTextAction(wxss) {
  const action = rule(wxss, '.txyr_right')
  assert.match(action, /min-height:\s*var\(--cy-btn-h\)/)
  assert.match(action, /background:\s*var\(--cy-color-action-secondary-bg\)/)
  assert.match(action, /border-radius:\s*var\(--cy-radius-pill\)/)
  assert.doesNotMatch(action, /text-decoration:\s*underline/)
}

test('暗域骨架保持原明度档、去色相并与纯黑可辨', () => {
  assertSkeletonContract(read(FILES.tokens))
})

test('negative control: 骨架基色恢复色相时合同必须判红', () => {
  const source = read(FILES.tokens)
  const mutated = source.replace(/(--cy-color-skeleton-base:\s*)#[0-9a-f]{6}/i, '$1#19171F')
  assert.notEqual(mutated, source, '负控未命中根骨架 token')
  assert.throws(() => assertSkeletonContract(mutated), assert.AssertionError)
})

test('P06 暗色日期面板 ✕ 为中性次级、完成为主按钮，二者语义不塌且可辨', () => {
  assertActionTokenContract(
    read(FILES.dateSheet), read(FILES.dateSheetWxml), read(FILES.fabu), read(FILES.tokens),
  )
})

test('negative control: P06 关闭 ✕ 退回非 action token 时合同必须判红', () => {
  const dateSheet = read(FILES.dateSheet)
  const mutated = dateSheet.replace(
    /(\.ds-pop--dark \.ds-close\s*\{[^}]*?)--cy-color-action-[^)]+/s,
    '$1--cy-color-status-info',
  )
  assert.notEqual(mutated, dateSheet, '负控未命中 ✕ 动作 token')
  assert.throws(
    () => assertActionTokenContract(
      mutated, read(FILES.dateSheetWxml), read(FILES.fabu), read(FILES.tokens),
    ),
    assert.AssertionError,
  )
})

test('negative control: P06 把 ✕ 染成主动作色(和完成塌成一个语义)时合同必须判红', () => {
  const dateSheet = read(FILES.dateSheet)
  const mutated = dateSheet.replace(
    /(\.ds-pop--dark \.ds-close\s*\{[^}]*?color:\s*var\()--cy-color-action-[^)]+/s,
    '$1--cy-color-action-primary-fg-on-dark',
  )
  assert.notEqual(mutated, dateSheet, '负控未命中 ✕ 动作 token')
  assert.throws(
    () => assertActionTokenContract(
      mutated, read(FILES.dateSheetWxml), read(FILES.fabu), read(FILES.tokens),
    ),
    assert.AssertionError,
  )
})

test('negative control: P06 「完成」退回标题行的一颗文字时合同必须判红', () => {
  const wxml = read(FILES.dateSheetWxml)
  const mutated = wxml.replace(
    /<cy-btn variant="primary"[^>]*bindtap="onConfirm">\{\{confirmText\}\}<\/cy-btn>/,
    '<view class="ds-btn-confirm" bindtap="onConfirm">{{confirmText}}</view>',
  )
  assert.notEqual(mutated, wxml, '负控未命中完成主按钮')
  assert.throws(
    () => assertActionTokenContract(
      read(FILES.dateSheet), mutated, read(FILES.fabu), read(FILES.tokens),
    ),
    assert.AssertionError,
  )
})

test('negative control: P06 暗面 action token 退化为低对比色时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const dateSheet = read(FILES.dateSheet)
  const closeToken = colorToken(rule(dateSheet, '.ds-pop--dark .ds-close'), '日期面板关闭动作')
  const escaped = closeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const mutated = tokens.replace(
    new RegExp(`(${escaped}:\\s*)#[0-9a-f]{6}`, 'i'),
    '$1#1C1C1E',
  )
  assert.notEqual(mutated, tokens, '负控未命中暗面次级动作 token')
  assert.throws(
    () => assertActionTokenContract(
      dateSheet, read(FILES.dateSheetWxml), read(FILES.fabu), mutated,
    ),
    assert.AssertionError,
  )
})

test('negative control: P06 暗面实际背景退化为浅色时合同必须判红', () => {
  const dateSheet = read(FILES.dateSheet)
  const mutated = dateSheet.replace(
    /(\.ds-pop--dark::before\s*\{[^}]*?background:\s*)rgba\([^)]+\)/s,
    '$1rgba(248, 248, 248, 0.96)',
  )
  assert.notEqual(mutated, dateSheet, '负控未命中日期面板真实背景')
  assert.throws(
    () => assertActionTokenContract(
      mutated, read(FILES.dateSheetWxml), read(FILES.fabu), read(FILES.tokens),
    ),
    assert.AssertionError,
  )
})

test('negative control: P06 主按钮与暗面板同灰(CU-C-166 实拍)时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const mutated = tokens.replace(
    /(--cy-btn-solid-bg:\s*)var\(--cy-color-action-primary-bg\)/g,
    '$1#1C1C1E',
  )
  assert.notEqual(mutated, tokens, '负控未命中实心主按钮底色')
  assert.throws(
    () => assertActionTokenContract(
      read(FILES.dateSheet), read(FILES.dateSheetWxml), read(FILES.fabu), mutated,
    ),
    assert.AssertionError,
  )
})

test('negative control: P06 发布页任一文字 action 漏出选择器组时合同必须判红', () => {
  const fabu = read(FILES.fabu)
  const mutated = fabu.replace('.slopes-info-page .g-category-add-btn,\n', '')
  assert.notEqual(mutated, fabu, '负控未命中发布页文字 action 选择器')
  assert.throws(
    () => assertActionTokenContract(read(FILES.dateSheet), mutated, read(FILES.tokens)),
    assert.AssertionError,
  )
})

test('C60/X11 分润 CTA 按可提现金额降级，单指标通栏且空态无末尾孤字', () => {
  assertProfitPresentation(read(FILES.profitWxml), read(FILES.profitWxss), read(FILES.profitJs))
})

test('negative control: 去掉分润提现行为守卫时合同必须判红', () => {
  const js = read(FILES.profitJs)
  const mutated = js.replace('if (!this.data.canWithdraw) return;', '')
  assert.notEqual(mutated, js, '负控未命中分润提现守卫')
  assert.throws(
    () => assertProfitPresentation(read(FILES.profitWxml), read(FILES.profitWxss), mutated),
    assert.AssertionError,
  )
})

test('E15 小屏日期/活动类型纵向整行，日期仅在日期与时间之间换行', () => {
  assertActivityDateLayout(read(FILES.activityWxml), read(FILES.activityWxss))
})

test('negative control: 日期退回数字中间可断行时合同必须判红', () => {
  const wxss = read(FILES.activityWxss)
  const mutated = wxss.replace('word-break: keep-all;', 'word-break: break-all;')
  assert.notEqual(mutated, wxss, '负控未命中日期断行守卫')
  assert.throws(() => assertActivityDateLayout(read(FILES.activityWxml), mutated), assert.AssertionError)
})

test('D19 全部提现是有 88rpx 热区的 secondary chip，不使用下划线', () => {
  assertWithdrawTextAction(read(FILES.withdrawWxss))
})

test('negative control: 全部提现退回下划线文字链接时合同必须判红', () => {
  const wxss = read(FILES.withdrawWxss)
  const action = rule(wxss, '.txyr_right')
  const mutatedAction = action.replace(
    'background: var(--cy-color-action-secondary-bg);',
    'text-decoration: underline;',
  )
  const mutated = wxss.replace(action, mutatedAction)
  assert.notEqual(mutated, wxss, '负控未命中 secondary action 背景')
  assert.throws(() => assertWithdrawTextAction(mutated), assert.AssertionError)

  const renamed = wxss.replace('.txyr_right {', '.txyr_right-old {')
  assert.notEqual(renamed, wxss, '负控未命中全部提现 selector')
  assert.throws(() => assertWithdrawTextAction(renamed), assert.AssertionError)
})

test('商家浅端卡投影达到组件边界 3:1，卡内线/填充保持 1.2:1 且前景 AA', () => {
  assertMerchantLightLayers(read(FILES.tokens), read(FILES.merchantLight))
})

test('negative control: 商家浅端卡投影退回 6% 时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const mutated = tokens.replace(
    /(--cy-comp-card-shadow-day:\s*0\s+[\d.]+rpx\s+[\d.]+rpx\s+rgba\(15,23,43,)\.[\d]+\)/,
    '$1.06)',
  )
  assert.notEqual(mutated, tokens, '负控未命中商家浅端卡投影')
  assert.throws(
    () => assertMerchantLightLayers(mutated, read(FILES.merchantLight)),
    assert.AssertionError,
  )
})

test('negative control: 商家浅端 subtle 边界退回低对比时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const theme = merchantTheme(tokens)
  const current = declaration(theme, '--cy-color-border-subtle', '商家浅端主题')
  const mutated = tokens.replace(
    new RegExp(`(--cy-color-border-subtle:\\s*)${current}`),
    '$1#ECECEC',
  )
  assert.notEqual(mutated, tokens, '负控未命中商家浅端 subtle 边界')
  assert.throws(
    () => assertMerchantLightLayers(mutated, read(FILES.merchantLight)),
    assert.AssertionError,
  )
})

test('negative control: 商家浅端 subtle 被同块后置低对比值覆盖时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const theme = merchantTheme(tokens)
  const mutated = tokens.replace(
    theme,
    `${theme}\n  --cy-color-border-subtle: #ECECEC;`,
  )
  assert.notEqual(mutated, tokens, '负控未向商家浅端主题追加后置声明')
  assert.throws(
    () => assertMerchantLightLayers(mutated, read(FILES.merchantLight)),
    assert.AssertionError,
  )
})

test('negative control: 商家浅端或镜像被独立后置块覆盖时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const merchantLight = read(FILES.merchantLight)
  const mutatedSources = [
    [`${tokens}\n.theme-merchant {\n  --cy-comp-cell-fill-bg: #F4F4F4;\n}\n`, merchantLight],
    [tokens, `${merchantLight}\npage {\n  --cy-comp-cell-fill-bg: #F4F4F4;\n}\n`],
    [tokens, `${merchantLight}\npage > .theme-merchant {\n  --cy-comp-cell-fill-bg: #F4F4F4;\n}\n`],
  ]
  mutatedSources.forEach(([mutatedTokens, mutatedMirror]) => {
    assert.throws(
      () => assertMerchantLightLayers(mutatedTokens, mutatedMirror),
      assert.AssertionError,
    )
  })
})

test('negative control: 商家卡内共享填充退回 F4 或前景退到 tertiary 时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const lowSeparation = tokens.replace(
    /(--cy-comp-cell-fill-bg:\s*)#[0-9a-f]{6}/i,
    '$1#F4F4F4',
  )
  assert.notEqual(lowSeparation, tokens, '负控未命中商家卡内共享填充')
  assert.throws(
    () => assertMerchantLightLayers(lowSeparation, read(FILES.merchantLight)),
    assert.AssertionError,
  )

  const lowForeground = tokens.replace(
    /(--cy-color-text-secondary:\s*)#404040/i,
    '$1#6B6B6B',
  )
  assert.notEqual(lowForeground, tokens, '负控未命中商家卡内 secondary 前景')
  assert.throws(
    () => assertMerchantLightLayers(lowForeground, read(FILES.merchantLight)),
    assert.AssertionError,
  )
})

test('negative control: theme-dark 共享填充漏回浅值时合同必须判红', () => {
  const tokens = read(FILES.tokens)
  const dark = blockAfter(tokens, /page\.theme-dark,\s*\.theme-dark\s*/, 'theme-dark tokens')
  const mutatedDark = dark.replace(
    /(--cy-comp-cell-fill-bg:\s*)[^;]+/,
    '$1#EAEAEA',
  )
  assert.notEqual(mutatedDark, dark, '负控未命中 theme-dark 共享填充')
  const mutated = tokens.replace(dark, mutatedDark)
  assert.throws(
    () => assertMerchantLightLayers(mutated, read(FILES.merchantLight)),
    assert.AssertionError,
  )

  const darkWithoutEscape = dark.replace(
    /\s*--cy-comp-cell-fill-bg:\s*var\(--cy-color-bg-surface-subtle\);/,
    '',
  )
  assert.notEqual(darkWithoutEscape, dark, '负控未命中 theme-dark 共享填充逃生口')
  const deletedEscape = tokens.replace(dark, darkWithoutEscape)
  assert.notEqual(deletedEscape, tokens, '负控未删除 theme-dark 共享填充逃生口')
  assert.throws(
    () => assertMerchantLightLayers(deletedEscape, read(FILES.merchantLight)),
    assert.AssertionError,
  )

  const descendantOverride = `${tokens}\npage .theme-dark {\n  --cy-comp-cell-fill-bg: #EAEAEA;\n}\n`
  assert.throws(
    () => assertMerchantLightLayers(descendantOverride, read(FILES.merchantLight)),
    assert.AssertionError,
  )

  const directRootOverride = `${tokens}\npage > .theme-dark {\n  --cy-comp-cell-fill-bg: #EAEAEA;\n}\n`
  assert.throws(
    () => assertMerchantLightLayers(directRootOverride, read(FILES.merchantLight)),
    assert.AssertionError,
  )

  const coupledDrift = `${tokens}\npage .theme-dark {\n  --cy-color-bg-surface-subtle: #E9E9E9;\n  --cy-comp-cell-fill-bg: #E9E9E9;\n}\n`
  assert.throws(
    () => assertMerchantLightLayers(coupledDrift, read(FILES.merchantLight)),
    assert.AssertionError,
  )
})

// ── 2026-08-10:步骤条契约整体退役 ────────────────────────────────────────
// 原来这里有一套 B48/B50 契约,钉的是「画在 <map> 里的四格步骤条,双层 scrim 合成
// 不透明度 ≥.7、三态语义可区分」。专业发布改平铺形态后**步骤条不存在了**(没有步骤,
// 所以没有步骤条),那套断言的对象整个消失,留着就是恒真的橡皮图章 —— 一并删除。
//
// 但它真正保护的东西没消失:地图视图下仍有 UI 压在浅色地图瓦片上(返回钮、左下角
// 视图切换药丸)。浅瓦片 + 无承托 = 白字读不出来。保护迁到下面这条。
test('地图视图下压在瓦片上的 chrome 必须自带承托,不能裸压浅色地图', () => {
  const wxml = read(FILES.fabuWxml)
  const wxss = read(FILES.fabu)

  // 视图切换的两个图标在地图视图下浮在瓦片上,必须有自己的底。
  // 2026-08-10:载体从独立浮层 .pd-viewswitch 收进底部导航条 .slopes-tabbar(两者位置
  // 重叠,实拍两组图标叠在一起),断言跟着搬家 —— 断言的对象没了就成了橡皮图章。
  const bar = rule(wxss, '.slopes-tabbar')
  assert.match(bar, /background:\s*linear-gradient\([^;]*var\(--cy-[\w-]+\)/,
    '底部导航条没有承托底 —— 压在浅色地图瓦片上会糊成一片')
  assert.match(bar, /position:\s*fixed/, '导航条必须固定在屏幕上,跟着列表滚就切不动了')

  // 返回钮压在瓦片上同样要有承托。原先靠 --on-map 把前景翻成 on-cover 白;
  // 按稿(4028:13649)改成白色圆钮后,承托由「自己的底」提供,比翻色更稳
  // (翻色只解决字,圆钮把整个热区从瓦片里抠出来)。
  assert.match(wxml, /class="slopes-back"/, '返回钮的类名不再带视图分支')
  const back = rule(wxss, '.slopes-back')
  assert.match(back, /background:\s*var\(--cy-[\w-]+\)/,
    '压在地图上的返回钮必须自带承托底')
  assert.match(back, /border-radius:\s*var\(--cy-radius-pill\)/,
    '承托底必须是圆钮形,方块会和地图上的建筑色块混在一起')

  // 地图与列表互斥,且都由同一个 viewMode 驱动(不是各写各的条件)
  assert.match(wxml, /class="slopes-map-wrap" wx:if="\{\{editorPage === 1 && viewMode === 'map'\}\}"/)
  assert.match(wxml, /class="slopes-sheet \{\{editorPage === 1 && viewMode === 'map' \? '' : 'slopes-sheet--full'\}\}"/)
})

test('negative control: 导航条失去承托底/脱离 fixed、返回钮失去承托底时必须判红', () => {
  const wxss = read(FILES.fabu)

  const noBg = wxss.replace(/(\.slopes-tabbar\s*\{[^}]*?)background:\s*linear-gradient\([^;]*;/, '$1')
  assert.notEqual(noBg, wxss, '负控未命中导航条承托底')
  assert.throws(() => assert.match(rule(noBg, '.slopes-tabbar'), /background:\s*linear-gradient\([^;]*var\(--cy-[\w-]+\)/), assert.AssertionError)

  const notFixed = wxss.replace(/(\.slopes-tabbar\s*\{[^}]*?)position:\s*fixed;/, '$1position: static;')
  assert.notEqual(notFixed, wxss, '负控未命中导航条定位')
  assert.throws(() => assert.match(rule(notFixed, '.slopes-tabbar'), /position:\s*fixed/), assert.AssertionError)

  const backNoBg = wxss.replace(/(\.slopes-back\s*\{[^}]*?)background:\s*var\(--cy-[\w-]+\);/, '$1')
  assert.notEqual(backNoBg, wxss, '负控未命中返回钮承托底')
  assert.throws(() => assert.match(rule(backNoBg, '.slopes-back'), /background:\s*var\(--cy-[\w-]+\)/), assert.AssertionError)
})
