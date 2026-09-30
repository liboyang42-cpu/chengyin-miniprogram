const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
// 2026-08-07 压主包体积:member/roam/talent 的非 tabBar 子页搬进了各自分包。
// 它们仍是页面,必须留在扫描范围内 —— 漏掉的话这份清单会从「锁死」退化成「只锁主包」。
const PAGE_ROOTS = ['pages', 'subpackageA', 'subpackageB', 'subpackageP3',
  'subpackageMember', 'subpackageRoam']
const SHARED_TITLE_CSS = 'components/cy/page-title/index.wxss'
const HIDDEN_TITLE = new Set(['subpackageMember/orderinfo/orderinfo.wxml'])
const SELF_DRAWN_NAV = new Set()
const SELF_DRAWN_TITLE = new Set(['pages/publish/simple/index.wxml'])
// 整屏编辑器里的「步骤标题」:文件本身是页面的一个 include,该页没有 cy-nav-bar(见下面
// assertEditorStepTitleSpacing 的理由)。标题仍然只准由 cy-page-title 提供、上下仍然只准吃
// 组件自己的 space-5/space-2,只是不适用「nav → canonical spacer → 标题」那段结构。
// 2026-09-25 CU-C-167 建名单:pages/publish/fabu 的票务屏(editorPage 2)原来一个页级标题都没有。
const EDITOR_STEP_TITLES = new Set(['pages/publish/fabu/step3.wxml'])
// 这些都有返回导航，但承担的是封面头、搜索框、会话名、向导问题或码卡，不是独立 L1 大标题行。
// 清单锁死后，新自绘页不会因为没用 cy-page-title 而静默漏扫。
const NAV_WITHOUT_L1_TITLE = new Set([
  'pages/merchant/decor/ai-npc/index.wxml',
  // 2026-09-05 漫游·附近的局:全屏地图页,nav overlay 居中标题,正文是地图 + 抽屉,没有 L1 大标题行。
  'subpackageRoam/nearby/index.wxml',
  // 2026-09-02 剧情与玩法(Figma J1-A/B/C):标题只在 cy-nav-bar 居中,不挂 cy-page-title。
  'pages/club/topic-story/index.wxml',
  // 2026-08-27 精准停表玩一局:沉浸玩法屏,标题只在 cy-nav-bar 居中,正文首屏是刻度轮,
  // 不适用「返回 + L1 大标题」——放大标题会把玩法读数从视觉主角位置挤下去。
  // 2026-08-20 商家侧标题统一(用户拍板,参照「核销记录」新规范):一级/二级商家页取消
  // Threads 式 L1 大标题,标题移入 cy-nav-bar 居中(17px 档)。整批 15 页显式迁入本名单。
  'pages/merchant/apply/index.wxml',
  'pages/merchant/ledger/batch-detail/index.wxml',
  'pages/merchant/coop-center/index.wxml',
  'pages/merchant/profile/index.wxml',
  'pages/merchant/citynode/create/index.wxml',
  'pages/merchant/decor/index.wxml',
  'pages/merchant/decor/coop-setting/index.wxml',
  'pages/merchant/decor/gallery/index.wxml',
  'pages/merchant/decor/perks/index.wxml',
  'pages/merchant/customer/index.wxml',
  // 2026-09-10 竞猜待答:与售后同一类商家待办页,标题走 cy-nav-bar 居中,
  // 首屏主角是「哪一轮、还剩几天」那几张卡,不给 L1 大标题
  'pages/merchant/predict/index.wxml',
  'pages/merchant/customer/detail/index.wxml',
  'pages/merchant/reviews/index.wxml',
  'pages/merchant/marketing/ai-insight/index.wxml',
  'pages/merchant/game-node/index.wxml',
  // 2026-08-25 收尾:营销/合作两个商家 tab 页也撤销左对齐 L1 大标题,标题移入居中 cy-nav-bar
  // (无返回箭头),与上面这批同一形态。
  'pages/merchant/marketing/index.wxml',
  'pages/merchant/relation/index.wxml',
  'pages/activity/baoming/baoming.wxml',
  'pages/activity/list/index.wxml',
  // Figma 2233:11353：官方活动详情由全幅封面承担内容标题，导航只保留覆盖式返回按钮。
  'pages/activity/official-detail/index.wxml',
  'pages/club/create/index.wxml',
  'pages/club/detail/index.wxml',
  // 2026-09-02 Figma H1–H6:俱乐部活动详情同 club/detail 的形 —— 240px 全幅封面承担活动名,
  // 顶栏是压在封面上的 overlay,只留返回圆钮。再挂 L1 大标题就是同屏双标题。
  'pages/club/topic-detail/index.wxml',
  'pages/gerenziliao/gerenziliao.wxml',
  'subpackageMember/coupon-qr/index.wxml',
  // 2026-09-20 UI-17:票夹改沉浸背景，导航只留返回；当前票名承担页面上下文。
  'subpackageMember/signup/index.wxml',
  'pages/publish/template-intro/index.wxml',
  'subpackageRoam/citynode-code/index.wxml',
  'pages/search2/result/index.wxml',
  'pages/square/detail/index.wxml',
  'pages/square/list/index.wxml', // 2026-08-07 用户裁决:帖文流无大标题
  'pages/templatedetail/templatedetail.wxml',
  'pages/topic/index/index.wxml',
  'pages/topic/merchantinfo/merchantinfo.wxml',
  // 2026-09-19 批复1-a=2:pricing/partner 页按用户裁决复活,标题只在 cy-nav-bar 居中
  //   (动态「合作方/合作俱乐部/承接商家」),正文主角是条款卡,不挂 L1 大标题。
  'pages/topic/pricing/partner/index.wxml',
  // 圈层两页均由首屏主题 hero 承担内容标题，导航栏只保留场景名，不重复叠 L1。
  'pages/play/circle/index.wxml',
  'subpackageB/pages/im/chat/index.wxml',
  'subpackageB/pages/im/list/index.wxml',
  // 2026-09-11 集邮相机改成原型取景卡,整屏不挂 cy-nav-bar 了 —— 与 citystamp 同形态,
  //   不进本清单(本清单管的是「有导航条但不挂 L1 大标题」的页)。
])
const FIRST_CONTENT_MARGIN_GUARDS = [
  ['pages/addressinfo/addressinfo.wxss', '.add'],
  ['pages/club/group-code/index.wxss', '.session-picker__hint'],
  ['pages/merchant/decor/index.wxss', '.dc-prev'],
  ['pages/merchant/decor/coop-setting/index.wxss', '.cs-card'],
  ['pages/merchant/decor/perks/index.wxss', '.dp-card'],
  ['pages/merchant/citynode/index.wxss', '.cn-intro'],
  ['pages/merchant/citynode/create/index.wxss', '.cnc-card--first'],
  ['pages/coop/invite/index.wxss', '.seg'],
  ['pages/coop/list/index.wxss', '.coop-tabs'],
  ['pages/merchant/coop-center/index.wxss', '.cc-tabs'],
  ['subpackageMember/coupon/coupon.wxss', '.david'],
  ['pages/merchant/apply/index.wxss', '.dots'],
  ['pages/mylike/mylike.wxss', '.favorite-list'],
  ['subpackageRoam/session/index.wxss', '.session-shell__body'],
  ['pages/search2/index.wxss', '.sousuo'],
  ['pages/shezhi/shezhi.wxss', '.sz-menu'],
  ['subpackageP3/pages/growthcenter/index/index.wxss', '.gc-score-card'],
  ['subpackageP3/pages/growthcenter/leaderboard/index.wxss', '.gc-tabs'],
]
const FIRST_CONTENT_TOP_SPACING_GUARDS = [
  ['pages/agreement/index.wxss', '.agr-page'],
  ['pages/coop/nearby/index.wxss', '.nearby-page'],
  ['pages/merchant/decor/index.wxss', '.dc-state'],
  ['pages/merchant/decor/index.wxss', '.dc-state--skeleton'],
  ['pages/merchant/decor/coop-setting/index.wxss', '.cs-state'],
  ['pages/merchant/decor/gallery/index.wxss', '.dg-scroll'],
  ['pages/merchant/decor/perks/index.wxss', '.dp-scroll'],
  ['pages/merchant/citynode/create/index.wxss', '.cnc-scroll'],
  ['subpackageMember/order/order.wxss', '.order-shell'],
  // 2026-08-07 第二批补漏(worker 复审扫出后随会话丢失,总控补录)
  // 路径已跟着「非 tabBar 子页搬进分包」对齐,couponInfo 与 roam/history 都在搬迁清单里
  ['subpackageMember/couponInfo/couponInfo.wxss', '.wp'],
  ['subpackageA/pages/myproject/index.wxss', '.mp-tabs'],
  ['subpackageRoam/history/index.wxss', '.hs-shell__body'],
  ['pages/team/team.wxss', '.team-head'],
  ['pages/team/team.wxss', '.team-loading'],
  ['pages/team/team.wxss', '.team-error'],
]

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = source => source.replace(/<!--[\s\S]*?-->/g, '')

function allWxmlFiles() {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      // 2026-08-07:压主包体积时,只被单一分包使用的组件搬进了 <分包>/components/。
      // 这条契约管的是「页面」的返回导航与大标题间距,组件不在其列 —— 不跳过的话,
      // 搬家会让 project-host / project-join 这类组件凭空出现在页面清单里。
      if (entry.isDirectory()) { if (entry.name !== 'components') walk(rel) }
      else if (rel.endsWith('.wxml')) out.push(rel)
    }
  }
  PAGE_ROOTS.forEach(walk)
  return out.sort()
}

function pageTitleFiles() {
  return allWxmlFiles().filter(rel => read(rel).includes('<cy-page-title'))
}

function navWithoutPageTitleFiles() {
  return allWxmlFiles().filter(rel => {
    const source = stripComments(read(rel))
    return source.includes('<cy-nav-bar') && !source.includes('<cy-page-title')
  })
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
}

function openAncestors(source, until) {
  const stack = []
  for (const match of source.slice(0, until).matchAll(/<\/?[\w:-]+\b[^>]*>/g)) {
    const tag = match[0]
    const name = (tag.match(/^<\/?([\w:-]+)/) || [])[1]
    if (tag.startsWith('</')) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].name === name) {
          stack.length = index
          break
        }
      }
    } else if (!tag.endsWith('/>')) {
      stack.push({ name, tag, attributes: attributes(tag) })
    }
  }
  return stack
}

function isZero(value) {
  return /^0(?:r?px|rem|em|%)?$/.test(value.trim())
}

function topSpacingFromDeclarations(body) {
  const out = []
  // 用户显式要求 ds-ok 行保持原样；与现有静态门一致，把整行视为受审豁免。
  const withoutComments = body.split('\n').filter(line => !line.includes('ds-ok')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const declaration of withoutComments.split(';')) {
    const match = declaration.match(/^\s*(padding(?:-top)?|margin(?:-top)?)\s*:\s*(.+?)\s*$/)
    if (!match) continue
    const value = match[1].endsWith('-top') ? match[2] : match[2].trim().split(/\s+/)[0]
    if (!isZero(value)) out.push(`${match[1]}:${value}`)
  }
  return out
}

function topSpacingForSelector(css, wanted) {
  const out = []
  const clean = css.split('\n').filter(line => !line.includes('ds-ok')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(selector => selector.trim())
    const ownsTarget = selectors.some(selector => selectorOwnsTarget(selector, wanted))
    if (ownsTarget) out.push(...topSpacingFromDeclarations(match[2]))
  }
  return out
}

function selectorOwnsTarget(selector, wanted) {
  const rightmost = selector.split(/\s+|[>+~]/).filter(Boolean).pop() || ''
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return wanted.startsWith('.')
    ? new RegExp(`${escaped}(?![\\w-])`).test(rightmost)
    : new RegExp(`(?:^|[^\\w-])${escaped}(?![\\w-])`).test(rightmost)
}

function selectorExists(css, wanted) {
  const clean = css.split('\n').filter(line => !line.includes('ds-ok')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of clean.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const selectors = match[1].split(',').map(selector => selector.trim())
    if (selectors.some(selector => selectorOwnsTarget(selector, wanted))) return true
  }
  return false
}

function declarationValuesForSelector(css, wanted, property) {
  const out = []
  const clean = css.split('\n').filter(line => !line.includes('ds-ok')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(selector => selector.trim())
    if (!selectors.some(selector => selectorOwnsTarget(selector, wanted))) continue
    for (const declaration of match[2].split(';')) {
      const parsed = declaration.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/)
      if (parsed && parsed[1] === property) out.push(parsed[2])
    }
  }
  return out
}

function outerMarginFromDeclarations(body) {
  const out = []
  const withoutComments = body.split('\n').filter(line => !line.includes('ds-ok')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const declaration of withoutComments.split(';')) {
    const match = declaration.match(/^\s*(margin(?:-(?:top|bottom))?)\s*:\s*(.+?)\s*$/)
    if (!match) continue
    if (match[1] !== 'margin') {
      if (!isZero(match[2])) out.push(`${match[1]}:${match[2]}`)
      continue
    }
    const values = match[2].trim().split(/\s+/)
    const top = values[0]
    const bottom = values.length < 3 ? values[0] : values[2]
    if (!isZero(top)) out.push(`margin-top:${top}`)
    if (!isZero(bottom)) out.push(`margin-bottom:${bottom}`)
  }
  return out
}

function outerMarginForSelector(css, wanted) {
  const out = []
  const clean = css.split('\n').filter(line => !line.includes('ds-ok')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(selector => selector.trim())
    if (selectors.some(selector => selectorOwnsTarget(selector, wanted))) {
      out.push(...outerMarginFromDeclarations(match[2]))
    }
  }
  return out
}

function assertSharedTitleSpacing(cssOverride) {
  const css = cssOverride === undefined ? read(SHARED_TITLE_CSS) : cssOverride
  assert.deepEqual(declarationValuesForSelector(css, '.pt', 'margin'), [], '共享标题不得用 margin shorthand 模糊覆盖上下基准')
  assert.deepEqual(declarationValuesForSelector(css, '.pt', 'margin-top'), ['var(--cy-space-5)'], '返回行/导航底到大标题必须恰好为 space-5(aaa v3)')
  assert.deepEqual(declarationValuesForSelector(css, '.pt', 'margin-bottom'), ['var(--cy-space-2)'], '大标题到下方内容必须恰好为 space-2(aaa v3)')
}

function assertPageContentSpacing(cssOverrides = {}) {
  const cssFor = cssPath => cssOverrides[cssPath] === undefined ? read(cssPath) : cssOverrides[cssPath]
  const historyShellPath = 'subpackageRoam/history/index.wxss'
  assert.ok(
    selectorExists(cssFor(historyShellPath), '.hs-shell__body'),
    `${historyShellPath}: 首内容选择器 .hs-shell__body 不存在，间距门禁不得假绿`,
  )
  for (const [cssPath, selector] of FIRST_CONTENT_MARGIN_GUARDS) {
    const css = cssFor(cssPath)
    const topMargins = outerMarginForSelector(css, selector).filter(value => value.startsWith('margin-top:'))
    assert.deepEqual(topMargins, [], `${cssPath}: ${selector} 不得在标题下方共享 space-2 外叠加首内容上外边距`)
  }
  for (const [cssPath, selector] of FIRST_CONTENT_TOP_SPACING_GUARDS) {
    const css = cssFor(cssPath)
    assert.deepEqual(topSpacingForSelector(css, selector), [], `${cssPath}: ${selector} 不得在标题下方共享 space-2 外叠加专用 top spacing`)
  }

  assert.match(
    cssFor('pages/coop/invite/index.wxss'),
    /cy-page-title\s*\+\s*\.card\s*\{[^}]*margin-top:\s*0;/,
    'coop/invite 的可选 seg 隐藏时，首张 card 也必须只吃标题下方共享 space-2',
  )
}

function openingNodes(source) {
  return [...source.matchAll(/<([\w:-]+)\b[^>]*>/g)].map(match => ({
    name: match[1],
    tag: match[0],
    attributes: attributes(match[0]),
  }))
}

function navEndBeforeTitle(source, titleIndex, rel) {
  const navStart = source.lastIndexOf('<cy-nav-bar', titleIndex)
  assert.notEqual(navStart, -1, `${rel}: 可见 cy-page-title 前必须有返回导航`)
  const openEnd = source.indexOf('>', navStart) + 1
  if (/\/\s*>$/.test(source.slice(navStart, openEnd))) return openEnd
  const closeEnd = source.indexOf('</cy-nav-bar>', openEnd)
  assert.notEqual(closeEnd, -1, 'cy-nav-bar 标签没有闭合')
  return closeEnd + '</cy-nav-bar>'.length
}

function assertNoCssTopSpacing(rel, titleTag, nodes, cssOverride) {
  const cssPath = rel.replace(/\.wxml$/, '.wxss')
  const css = cssOverride !== undefined ? cssOverride : (fs.existsSync(path.join(ROOT, cssPath)) ? read(cssPath) : '')
  const selectors = new Set(['cy-page-title'])
  for (const node of nodes.concat([{ name: 'cy-page-title', attributes: attributes(titleTag) }])) {
    if (node.name && node.name.startsWith('cy-')) selectors.add(node.name)
    const staticClasses = (node.attributes.class || '').split('{{')[0]
    for (const className of staticClasses.split(/\s+/)) {
      if (className) selectors.add(`.${className}`)
    }
  }
  for (const selector of selectors) {
    assert.deepEqual(
      topSpacingForSelector(css, selector),
      [],
      `${rel}: ${selector} 不得在 nav 与大标题之间追加 margin-top/padding-top`,
    )
  }

  const titleSelectors = new Set(['cy-page-title'])
  const staticTitleClasses = (attributes(titleTag).class || '').split('{{')[0]
  for (const className of staticTitleClasses.split(/\s+/)) {
    if (className) titleSelectors.add(`.${className}`)
  }
  for (const selector of titleSelectors) {
    assert.deepEqual(
      outerMarginForSelector(css, selector),
      [],
      `${rel}: ${selector} 不得在共享上 space-5/下 space-2 之外叠加标题外边距`,
    )
  }
}

function assertPageSpacing(rel, overrides = {}) {
  const raw = overrides.wxml === undefined ? read(rel) : overrides.wxml
  const source = stripComments(raw)
  const titleIndex = source.indexOf('<cy-page-title')
  assert.notEqual(titleIndex, -1, `${rel}: 缺 cy-page-title`)
  const titleTag = (source.slice(titleIndex).match(/^<cy-page-title[\s\S]*?>/) || [])[0]
  assert.ok(titleTag, `${rel}: cy-page-title 标签不完整`)
  if (HIDDEN_TITLE.has(rel)) return

  const selfDrawnNav = SELF_DRAWN_NAV.has(rel)
  const navEnd = selfDrawnNav ? 0 : navEndBeforeTitle(source, titleIndex, rel)
  const between = source.slice(navEnd, titleIndex).replace(/<\/?block\b[^>]*>/g, '').trim()
  const betweenNodes = selfDrawnNav ? [] : openingNodes(between)
  const ancestors = openAncestors(source, titleIndex)
  const safeTopOff = /safe-top="\{\{false\}\}"/.test(titleTag)
  const canonicalHeight = '\\{\\{\\s*statusBarHeight\\s*\\+\\s*navBarHeight\\s*\\}\\}px'
  const parentOwnsCanonicalTop = ancestors.some(node => {
    const style = node.attributes.style || ''
    return new RegExp(`padding-top:\\s*${canonicalHeight}`).test(style)
  })

  if (selfDrawnNav) {
    assert.match(source, /<view class="ss-top" style="height:\{\{navBarHeight\}\}px;padding-top:\{\{statusBarHeight\}\}px;padding-right:\{\{topRightSafe\}\}px">/)
    assert.match(read(rel.replace(/\.wxml$/, '.wxss')), /\.ss-top\{[^}]*box-sizing:content-box;[^}]*padding:0 var\(--cy-page-x\);/)
  } else if (safeTopOff && !parentOwnsCanonicalTop) {
    const afterSpacerWrappersRemoved = between.replace(/(?:<view\b[^>]*>\s*)+$/, '').trim()
    const exactSpacer = new RegExp(
      `(?:<cy-nav-spacer\\s*\\/>|<view\\b[^>]*style="[^"]*height:\\s*${canonicalHeight};?[^"]*"[^>]*><\\/view>)$`,
    )
    assert.match(afterSpacerWrappersRemoved, exactSpacer, `${rel}: safeTop=false 时，nav 后必须只留一段 statusBarHeight + navBarHeight 等高 spacer`)
  } else if (!safeTopOff) {
    const transparentWrappersRemoved = between.replace(/(?:<view\b[^>]*>\s*)+$/, '').trim()
    assert.equal(transparentWrappersRemoved, '', `${rel}: nav 与默认 safeTop 的 cy-page-title 之间不得夹额外布局节点`)
  }

  for (const node of betweenNodes) {
    assert.deepEqual(topSpacingFromDeclarations(node.attributes.style || ''), [], `${rel}: spacer/透明包装不得自带额外顶距`)
  }
  for (const node of ancestors) {
    const style = node.attributes.style || ''
    const nodeOwnsCanonicalTop = new RegExp(`padding-top:\\s*${canonicalHeight}`).test(style)
    const extra = topSpacingFromDeclarations(style).filter(value => {
      return !(nodeOwnsCanonicalTop && new RegExp(`^padding-top:\\s*${canonicalHeight}$`).test(value))
    })
    assert.deepEqual(extra, [], `${rel}: 标题祖先不得叠加额外顶距`)
  }
  assert.deepEqual(topSpacingFromDeclarations(attributes(titleTag).style || ''), [], `${rel}: 标题标签不得自带额外顶距`)
  assertNoCssTopSpacing(rel, titleTag, ancestors.concat(betweenNodes), overrides.wxss)
}

// 整屏编辑器的步骤标题:这类文件没有 cy-nav-bar(整个编辑器共用一个页面级返回浮钮,
// 屏与屏之间由底部 sheet 切换),所以「nav → canonical spacer → 标题」那一段没法照搬。
// 该验的仍然要验:① 标题只有这一个、由共享组件提供;② safe-top 关掉(它不是顶格导航页,
// 上面还有 sheet 把手,组件再让一次状态栏高度就是双倍顶距);③ 容器与首内容都不许在组件
// 自己的 space-5/space-2 之外再加顶距 —— 这条与 coop/invite 的 `cy-page-title + .card` 同源。
function assertEditorStepTitleSpacing(rel) {
  const source = stripComments(read(rel))
  const titles = source.match(/<cy-page-title\b[^>]*>/g) || []
  assert.equal(titles.length, 1, `${rel}: 一屏只准一个 L1 标题`)
  assert.ok(!/<cy-nav-bar\b/.test(source),
    `${rel}: 这一屏没有导航条才走本分支;补了 cy-nav-bar 就该回到 assertPageSpacing 重新归类`)
  assert.match(titles[0], /safe-top="\{\{false\}\}"/, `${rel}: 页内步骤标题必须显式关掉 safe-top`)
  assert.match(titles[0], /flush="\{\{true\}\}"/, `${rel}: 容器自带页边距时标题必须 flush,否则双倍缩进`)

  const cssPath = rel.replace(/step3\.wxml$/, 'index.wxss')
  const css = read(cssPath)
  assert.deepEqual(topSpacingForSelector(css, '.slopes-info-page'), [],
    `${cssPath}: 标题所在容器不得在共享 space-5 之外追加顶距`)
  assert.match(css, /cy-page-title\s*\+\s*\.pd-section-title\s*\{[^}]*padding-top:\s*0;/,
    `${cssPath}: 标题下方第一个区块标题只准吃共享 space-2,不得再叠自己的顶距`)
}

function assertSelfDrawnTitleSpacing(rel, cssOverride) {
  const source = stripComments(read(rel))
  const canonicalHeight = '\\{\\{\\s*statusBarHeight\\s*\\+\\s*navBarHeight\\s*\\}\\}px'
  assert.match(
    source,
    new RegExp(`<cy-nav-bar\\s*\\/>\\s*<view class="simple-ai__nav-spacer" style="height:\\s*${canonicalHeight};?"></view>\\s*<view class="simple-ai__nav">`),
    `${rel}: 自绘页头必须紧跟 canonical nav spacer`,
  )
  const css = cssOverride === undefined ? read(rel.replace(/\.wxml$/, '.wxss')) : cssOverride
  assert.deepEqual(declarationValuesForSelector(css, '.simple-ai__nav', 'margin'), [], `${rel}: 自绘 L1 页头不得用 margin shorthand 模糊覆盖上下基准`)
  assert.deepEqual(declarationValuesForSelector(css, '.simple-ai__nav', 'margin-top'), ['var(--cy-space-5)'], `${rel}: 自绘 L1 页头上方必须恰好为 space-5(aaa v3)`)
  assert.deepEqual(declarationValuesForSelector(css, '.simple-ai__nav', 'margin-bottom'), ['var(--cy-space-2)'], `${rel}: 自绘 L1 页头下方必须恰好为 space-2(aaa v3)`)
  assert.deepEqual(declarationValuesForSelector(css, '.simple-ai__nav', 'min-height'), [], `${rel}: 自绘 L1 页头不得靠 min-height 制造隐性下间距`)
  assert.deepEqual(declarationValuesForSelector(css, '.simple-ai__nav', 'padding'), ['0 var(--cy-page-x)'], `${rel}: 自绘 L1 页头不得用 bottom padding 叠加共享 space-2`)
  assert.deepEqual(declarationValuesForSelector(css, '.simple-ai__body', 'padding-top'), ['0'], `${rel}: 自绘 L1 页头后的正文必须清零专用 top padding`)
  assert.match(css, /\.simple-ai__nav\s*\{[^}]*align-items:\s*flex-start;/, `${rel}: 自绘页头不得靠定高容器垂直居中制造隐性顶距`)
}

// 2026-08-07 M1 与 M2 合流后，coop/mybiz 并入 ledger 并删除独立路由，73→72。
// 2026-08-09:+2 入会申请/解散阻断主理人页。
// 2026-08-10:-1 章节邀请页并入 coop/nearby 后退役,page-title 页面总数为 70。
// 2026-08-10:-1 topicadd 退役为无实体重定向壳,page-title 页面总数为 69。
// 2026-08-10:+1 商家客户名册页(merchant/customer)新建,总数为 70。
// 2026-08-11:+1 对公批次详情页，复用 shared page-title 间距，总数为 71。
// 2026-08-16:+1 探店日俱乐部自报页(club/edition-report)，同样复用 shared 间距，总数为 72。
//   ⚠️ 这一页是 2026-08-16 的四个 A 那一批建的，但当时只跑了 ci/xcx-check.sh（它不跑 tests/unit），
//   所以这条棘轮从那天起就一直红着没人看见。
// 2026-08-20:+1 商家 AI 店铺参谋页(marketing/ai-insight),复用 shared 间距,总数为 73。
// 计数是「清单漂移就重新归类」的哨兵,新页的间距仍由 assertPageSpacing 逐条真校验。
// 2026-08-20:-15 商家侧标题统一,15 个商家页撤销 L1 大标题移入 NAV_WITHOUT_L1_TITLE,总数 72→57。
// 2026-08-20:+3 玩家邀请制组队 create/detail/join，按普通二级页规范登记，总数 57→60。
// 2026-08-21:-1 独立 create 表单下线；建队入口并入报名流程，detail/join 仍是普通二级页，总数 60→59。
// 2026-08-21:+1 仪式板页(play/celebrate),复用 shared 间距,总数 59→60；2026-08-29 整页退役,回到 59。
// 2026-08-23:+1 历史提现记录跳转壳补完整过场/失败恢复，复用 shared 间距,总数 60→61。
// 2026-08-24:+1 userinfo 缺 userId 恢复态补标准页头，总数 61→62。
// 2026-08-24:+1 活动导演台复用 shared page-title 间距，总数 62→63。
// 2026-08-25:+4 俱乐部岗位/治理/活动运营/通知页复用 shared 间距，总数 63→67。
//   商家本站页标题居中在 nav，不入此数。
// 2026-08-29:-2 创作者中心与独立图像来源页退役；署名并入设置页，当前实测 65 页。
// 2026-08-30:-1 官方活动详情改为封面沉浸页，65→64。
// 2026-08-30:+5 结算/订单详情/成为节点/售后详情/经营团队按用户裁决恢复「返回独立行 + L1 大标题」，64→69。
// 2026-09-01:-1 承接商家条款页标题移入 cy-nav-bar，69→68。
// 2026-09-06:-2 孤儿页清理:club/dissolution-blockers 与 publish/biaoqian 整页删除，69→67。
// 2026-09-09:-1 会费设置页整页删除,69→68(会员状态页与质量证据页不在此清单里)。
// 2026-09-12:-1 退役 subpackageTalent/search,69→68。
// 2026-09-16:-1 孤儿页 pages/coop/candidates 整页删除(候选池收编进协作列表),68→67。
// 2026-09-17:+1 退款售后列表按用户裁决改 Revolut 316 形态(返回 + 左对齐 L1 大标题),移出居中 nav 名单,67→68。
// 2026-09-20:-1 票夹改沉浸背景，当前票名承担页面上下文，68→67。
// 2026-09-22:+1 Phase 0 物品卡实验室页(object-card-lab)，cy-nav-bar + cy-page-title 标准二级页，67→68。
// 2026-09-22:+1 Phase 3 藏品册页(object-cards/index)，同上标准二级页，68→69。
// 2026-09-24:-1 Phase 0 实验室页随正式页接进玩法删除(它页头自己写着「随之作废」)，69→68。
// 2026-09-25:+1 CU-C-167 给创作编辑器的票务屏补页级标题,67→68。
//   ⚠️ 这一条不是普通二级页:pages/publish/fabu 是**单页两屏**的整屏编辑器
//   (editorPage 1 创作 / 2 票务,靠底部 sheet 切屏),全页没有 cy-nav-bar ——
//   返回是页面级浮钮 .slopes-back,离开的是整个编辑器。所以「nav → canonical spacer → 标题」
//   这一段结构在这里不成立,它走 assertEditorStepTitleSpacing(见下面那张名单)。
test('全仓 69 个 cy-page-title 页面：共享标题统一提供上 space-5 / 下 space-2', () => {
  assertSharedTitleSpacing()
  const files = pageTitleFiles()
  /* 2026-09-08 +1:pages/coop/invite-detail(02d 协作详情)。自定义导航 + 实底顶栏无标题,
     按契约页内挂 cy-page-title 承接;顶部那个大字是状态不是页名,两者并存。 */
  /* 2026-09-08 +1:新增 pages/club/checkin-detail(Figma K3 俱乐部端核销详情)。 */
  /* 2026-09-11 并 github/master:本分支把 club/apply 从自绘 cy-h1 改回共享 cy-page-title,
     master 的 68 不含这一页 ⇒ 68+1=69。 */
  assert.equal(files.length, 69, 'cy-page-title 页面清单漂移时必须重新做间距归类')
// 2026-09-02:+2 俱乐部客户列表与客户详情，复用 shared page-title 间距，64→66。
//   客户详情的头像绝对定位在标题行上，不进入标题流，不影响上 space-5 / 下 space-2。
  files.forEach((rel) => {
    if (EDITOR_STEP_TITLES.has(rel)) assertEditorStepTitleSpacing(rel)
    else assertPageSpacing(rel)
  })
  // 名单本身也要能被发现漂移:进了这张名单却不再用共享标题,就是偷偷退回自绘大标题
  EDITOR_STEP_TITLES.forEach((rel) => {
    assert.ok(read(rel).includes('<cy-page-title'), `${rel}: 编辑器步骤标题必须由 cy-page-title 提供`)
  })
})

test('全仓 cy-nav-bar 无组件标题页均已归类，自绘大标题同样使用上 space-5 / 下 space-2', () => {
  const classified = [...SELF_DRAWN_TITLE, ...NAV_WITHOUT_L1_TITLE].sort()
  assert.deepEqual(navWithoutPageTitleFiles(), classified, '自绘/封面/向导页清单漂移时必须重新判断是否属于返回 + L1 大标题')
  SELF_DRAWN_TITLE.forEach(rel => assertSelfDrawnTitleSpacing(rel))
})

test('页面级首内容不再叠加标题下方共享 space-2', () => {
  assertPageContentSpacing()
})

test('negative control：共享基准归零、页面叠加或自绘页头错档都必须判红', () => {
  const sharedCss = read(SHARED_TITLE_CSS)
  const zeroTop = sharedCss.replace('margin-top: var(--cy-space-5);', 'margin-top: 0;')
  const zeroBottom = sharedCss.replace('margin-bottom: var(--cy-space-2);', 'margin-bottom: 0;')
  assert.notEqual(zeroTop, sharedCss, '共享标题 top 负控必须真实突变源码')
  assert.notEqual(zeroBottom, sharedCss, '共享标题 bottom 负控必须真实突变源码')
  assert.throws(
    () => assertSharedTitleSpacing(zeroTop),
    /space-5/,
  )
  assert.throws(
    () => assertSharedTitleSpacing(zeroBottom),
    /space-2/,
  )
  const rel = 'pages/mylike/mylike.wxml'
  const baseCss = read(rel.replace(/\.wxml$/, '.wxss'))
  assert.throws(
    () => assertPageSpacing(rel, { wxss: `${baseCss}\n.mylike .c1-page-title { margin-top: var(--cy-space-4); }\n` }),
    error => error instanceof assert.AssertionError && /不得在 nav 与大标题之间追加/.test(error.message),
  )
  assert.throws(
    () => assertPageSpacing(rel, { wxss: `${baseCss}\n.mylike .title-nav-spacer { margin-top: var(--cy-space-4); }\n` }),
    error => error instanceof assert.AssertionError && /不得在 nav 与大标题之间追加/.test(error.message),
  )
  const selfDrawn = 'pages/publish/simple/index.wxml'
  assert.throws(
    () => assertSelfDrawnTitleSpacing(selfDrawn, read(selfDrawn.replace(/\.wxml$/, '.wxss')).replace('margin-top: var(--cy-space-5);', 'margin-top: var(--cy-space-4);')),
    /自绘 L1 页头上方必须恰好/,
  )
  assert.throws(
    () => assertPageContentSpacing({
      'pages/mylike/mylike.wxss': `${baseCss}\n.favorite-list { margin-top: var(--cy-space-4); }\n`,
    }),
    /不得在标题下方共享 space-2 外叠加/,
  )
  const historyShellPath = 'subpackageRoam/history/index.wxss'
  const historyWithoutGuard = read(historyShellPath).replace('.hs-shell__body', '.hs-shell__body-removed')
  assert.throws(
    () => assertPageContentSpacing({ [historyShellPath]: historyWithoutGuard }),
    /间距门禁不得假绿/,
  )
  for (const [cssPath, selector] of FIRST_CONTENT_TOP_SPACING_GUARDS) {
    assert.throws(
      () => assertPageContentSpacing({
        [cssPath]: `${read(cssPath)}\n${selector} { padding-top: var(--cy-space-1); }\n`,
      }),
      /不得在标题下方共享 space-2 外叠加专用 top spacing/,
      `${cssPath}: ${selector} 专用 top spacing 负控必须判红`,
    )
  }
})

test('门店相册按确认稿保留图片网格顶部及行间距', () => {
  const css = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/gallery/index.wxss'), 'utf8')
  assert.match(css, /\.dg-grid\s*\{[^}]*margin-top:var\(--cy-space-3\);\s*row-gap:var\(--cy-space-3\)/)
})
