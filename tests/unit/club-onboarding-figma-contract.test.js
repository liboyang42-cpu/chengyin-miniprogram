const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 2026-09-02 Figma 建团 G1-G4(32:3/32:54/32:87/32:130)与主理人申请 H1-H4
// (33:2/33:35/33:77/33:118)改版的三条易被"顺手改回去"的裁决,各配负控。
const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const TOKENS = read('style/tokens.wxss')
const CREATE_WXML = read('pages/club/create/index.wxml')
const CREATE_WXSS = read('pages/club/create/index.wxss')
const CREATE_JS = read('pages/club/create/index.js')
const APPLY_WXML = read('pages/club/apply/index.wxml')
const APPLY_WXSS = read('pages/club/apply/index.wxss')

// tokens.wxss 的 ② alias 段真值,自己读一遍而不是抄进注释里 —— 别人改了真源这里要跟着红。
function darkAliasTarget(alias) {
  const dark = TOKENS.slice(0, TOKENS.indexOf('--cy-color-bg-elevated:       #FFFFFF'))
  const hit = new RegExp(`^\\s*${alias}:\\s*var\\((--cy-color-[a-z-]+)\\)`, 'm').exec(dark)
  assert.ok(hit, `取不到 ${alias} 的 alias 目标,锚点可能被改动`)
  const value = new RegExp(`^\\s*${hit[1]}:\\s*(#[0-9A-Fa-f]{6})`, 'm').exec(dark)
  assert.ok(value, `取不到 ${hit[1]} 的真值`)
  return value[1].toUpperCase()
}

// ── ① 说明文案的 token 陷阱:别按字面挑 alias 名 ──
// 仓库里 --cy-text-secondary 是历史错位,解析到 text-tertiary(#919191);
// Figma 的 text/secondary(#B7B7B7) 对应的是 --cy-text-body / --cy-color-text-secondary。
// 2026-09-06 裁决:四步标题下的副标题(.cc-sub/.ca-sub)整体删除,所以这条改盯
// 仍然存在的**开场屏副标题**,把「别挑错 alias」这条知识留在活的锚点上。
test('说明文案用 text/secondary(#B7B7B7)，不是解析成 #919191 的同名 alias', () => {
  assert.equal(darkAliasTarget('--cy-text-body'), '#B7B7B7', '--cy-text-body 必须仍解析到 text/secondary')
  assert.equal(darkAliasTarget('--cy-text-secondary'), '#919191', '--cy-text-secondary 仍是历史错位,别当 secondary 用')

  const introCss = read('style/wizard-intro.wxss')
  assert.match(introCss, /^\.intro__sub \{[^}]*color:\s*var\(--cy-color-text-secondary\)/ms,
    '开场屏副标题必须走 text/secondary(#B7B7B7),不是同名 alias')

  // 四步的副标题已按裁决删除,别在下一轮"照旧稿补回来"
  assert.doesNotMatch(CREATE_WXSS, /^\.cc-sub \{/ms, '建团四步副标题已按 2026-09-06 裁决删除')
  assert.doesNotMatch(APPLY_WXML, /class="ca-sub"|class="step-sub"/, '申请页四步副标题已按 2026-09-06 裁决删除')
})

test('负控:开场屏副标题换回 --cy-text-secondary 必须判红', () => {
  const css = read('style/wizard-intro.wxss')
  const mutated = css.replace(
    /^(\.intro__sub \{[^}]*color:\s*)var\(--cy-color-text-secondary\)/ms, '$1var(--cy-text-secondary)')
  assert.notEqual(mutated, css, '变异未生效,负控本身是假的')
  assert.throws(() => assert.match(mutated, /^\.intro__sub \{[^}]*color:\s*var\(--cy-color-text-secondary\)/ms))
})

// ── ② G4「入会审批默认开启」这句不许出现在任何地方 ──
// migration_club_join_policy_20260809.sql 的 join_policy DEFAULT 0,
// ApiClubController.createClubForMember 没有 setJoinPolicy —— 稿上那句与代码相反。
// 2026-09-06 裁决:向导忠于现码四步(类型→方向→资料→城市),没有确认页,
// 所以承载那句话的 .cc-note 节点本身不存在了。这里保留的是**那句话不许回来**这条知识。
test('「入会审批默认开启」这句与后端默认相反，不许出现在建团向导里', () => {
  assert.doesNotMatch(CREATE_WXML, /入会审批默认开启/,
    '后端默认 join_policy=0,这句会骗人;要改行为得先动后端,不能只改文案')
})

// ── ③ 稿没画、但现码有的字段一律保留,别在下一轮"照稿清理"里被删掉 ──
const KEPT_BEYOND_FIGMA = [
  [() => CREATE_WXML, 'data-field="description"', '建团页 · 一句话介绍(稿未画)'],
  [() => CREATE_WXML, 'data-field="style"', '建团页 · 风格/调性(稿未画)'],
  [() => APPLY_WXML, 'data-field="coFounders"', '申请页 · 联合创始人(稿未画)'],
  [() => APPLY_WXML, 'data-field="avgEventSize"', '申请页 · 平均参与人数(稿未画)'],
  [() => APPLY_WXML, '<cy-upload', '申请页 · 资质图上传(稿的摘要有「资质」行却没画入口)'],
  [() => APPLY_WXML, 'data-field="hasGuideCert"', '申请页 · 导游/旅游资质(稿未画)'],
]

test('稿没画但现码有的字段全部保留', () => {
  KEPT_BEYOND_FIGMA.forEach(([source, anchor, label]) => {
    assert.ok(source().includes(anchor), `${label} 被删了 —— 稿漏画不等于产品要砍掉这个字段`)
  })
})

test('负控:删掉任一保留字段必须判红', () => {
  KEPT_BEYOND_FIGMA.forEach(([source, anchor, label]) => {
    const mutated = source().replace(anchor, 'data-field="__removed__"')
    assert.notEqual(mutated, source(), `${label} 的变异锚点失效`)
    assert.throws(() => assert.ok(mutated.includes(anchor)), undefined, label)
  })
})

// ── ④ 输入框空/已填两态走专用 token 对,不近似映射到别的中性面 ──
test('输入框空态与已填态各用专用 token，并由字段值驱动', () => {
  // 2026-09-06:申请页版式以本轮裁决为准,输入框类名是 .field__box(建团仍是 .cc-input)。
  // 保护点不变 —— 两态各用专用 token 且由字段值驱动。
  for (const [label, wxss, wxml, sel] of [
    ['建团页', CREATE_WXSS, CREATE_WXML, 'cc-input'],
    ['申请页', APPLY_WXSS, APPLY_WXML, 'field__box'],
  ]) {
    assert.match(wxss, new RegExp(`^\\.${sel} \\{[^}]*background:\\s*var\\(--cy-color-input-bg-empty\\)`, 'ms'),
      `${label}输入框空态必须用 input-bg-empty`)
    assert.match(wxss, new RegExp(`^\\.${sel}\\.is-filled \\{[^}]*background:\\s*var\\(--cy-color-input-bg-filled\\)`, 'ms'),
      `${label}输入框已填态必须用 input-bg-filled`)
    assert.match(wxml, new RegExp(`class="${sel}[^"]*\\{\\{\\s*\\w+ \\? 'is-filled' : ''\\s*\\}\\}`),
      `${label}已填态必须由字段值驱动,不能是死类名`)
  }
})

// ── ⑤ 四步问句文案齐备(改版后标题不再来自 cy-page-title,漏一条就是空标题) ──
// 2026-09-06 裁决:副标题整体删除,所以只断言四步问句齐备(漏一条就是空标题)。
test('两个向导各自 4 步的问句都在 JS 真源里', () => {
  const applyJs = read('pages/club/apply/index.js')
  assert.equal((/const STEP_TITLES = \[([^\]]*)\]/.exec(applyJs)[1].match(/'/g) || []).length / 2, 4,
    '申请页 STEP_TITLES 必须是 4 步')
  assert.equal((/const STEP_TITLES = \[([^\]]*)\]/.exec(CREATE_JS) || [null, ''])[1] !== undefined, true)
})

// ── ⑥ G3 chip 的选中态必须由 JS 预算好的 item.on 驱动 ──
// 2026-09-02 截图对稿实测:WXML 表达式不支持方法调用,`activityPrefs.indexOf(item) >= 0`
// 恒为假 —— 选满 3 个后 chip 底色仍是 rgb(20,20,20)(未选态 action/secondary-bg),
// 稿 32:108 要求的白底黑字加粗从来没出现过,而同一屏的 activityPrefs.length(属性访问)
// 是好的。静态门禁与 4790 条单测全绿也照样漏,所以把形状钉在这里。
test('G3 活动倾向 chip 的选中判定不得写成 WXML 里的方法调用', () => {
  // 只看真正会被编译的标签,注释里解释这条裁决时会写到 indexOf,不能让它把断言撞红
  const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
  const chipBlock = stripComments(CREATE_WXML.slice(CREATE_WXML.indexOf('<view class="cc-chips">'), CREATE_WXML.indexOf('cc-count')))
  assert.ok(chipBlock.includes('cc-chip'), 'G3 chip 区块锚点失效')
  assert.doesNotMatch(chipBlock, /\.\s*indexOf\s*\(/, 'chip 选中态不能靠 WXML 里的 indexOf,它恒为假')
  assert.match(chipBlock, /class="cc-chip \{\{\s*item\.on \? 'on' : ''\s*\}\}"/, 'chip 选中态必须读 JS 预算的 item.on')
  assert.match(chipBlock, /wx:for="\{\{dirList\}\}"/, 'chip 必须遍历带 on 标记的 dirList,不是裸 dirOptions')
  // JS 侧:dirList 是投影,activityPrefs 仍是真值,且 toggle 后两者一起更新
  assert.match(CREATE_JS, /^function buildDirList\(options, prefs\) \{/m, 'buildDirList 必须存在')
  assert.match(CREATE_JS, /setData\(\{ activityPrefs: arr, dirList: buildDirList\(/, 'toggleDir 必须同步刷新 dirList')
})

test('负控:chip 选中态改回 WXML 方法调用必须判红', () => {
  const mutated = CREATE_WXML.replace(
    /class="cc-chip \{\{\s*item\.on \? 'on' : ''\s*\}\}"/,
    `class="cc-chip {{activityPrefs.indexOf(item) >= 0 ? 'on' : ''}}"`
  )
  assert.notEqual(mutated, CREATE_WXML, '变异锚点失效:没有真的改掉 chip 的 class 表达式')
  const block = mutated.slice(mutated.indexOf('<view class="cc-chips">'), mutated.indexOf('cc-count'))
    .replace(/<!--[\s\S]*?-->/g, '')
  assert.throws(() => assert.doesNotMatch(block, /\.\s*indexOf\s*\(/))
})

// ── ⑦ 提交失败条要有页边,不能通栏 ──
// 改版把页边从 .cc-page/.page 下放到各块之后,cy-inline-error 成了唯一没有页边的元素:
// 实测 390px 通栏,同屏其余块都是 358px @16,且与 CTA 之间零间距。
test('两页的提交失败条都有页边与到 CTA 的间隔', () => {
  for (const [label, wxml, wxss, cls] of [
    ['建团页', CREATE_WXML, CREATE_WXSS, 'cc'],
    ['申请页', APPLY_WXML, APPLY_WXSS, 'ca'],
  ]) {
    assert.match(wxml, new RegExp(`<cy-inline-error class="${cls}-alert"`), `${label}失败条必须挂上带页边的类`)
    assert.match(wxss, new RegExp(`^\\.${cls}-alert \\{[^}]*padding:\\s*0 var\\(--cy-page-x\\)`, 'ms'),
      `${label}失败条必须补页边`)
    assert.match(wxss, new RegExp(`^\\.${cls}-alert \\{[^}]*margin-bottom:`, 'ms'),
      `${label}失败条必须与 CTA 留出间隔`)
  }
})

// ── ⑧ 申请页完成态的标题不能贴到 nav 底下 ──
// 表单态的顶距由进度轨给;完成态没有进度轨,标题块必须自带顶距(实测原来只剩 4px)。
// 2026-09-06:申请页改成「.page 承接规范顶距 + .head 包住进度条与标题」的结构
// (nav-page-title-spacing 门禁只放行祖先自带 statusBarHeight+navBarHeight 的写法)。
// 保护点仍是同一个:完成态没有进度条时,标题不能贴着 nav。
test('申请页规范顶距挂在包住 nav 的容器上，标题任何状态都不贴 nav', () => {
  assert.match(APPLY_WXML, /<view class="page" style="padding-top: \{\{statusBarHeight \+ navBarHeight\}\}px;">/,
    '规范顶距必须挂在把 nav 一起包住的 .page 上')
  assert.match(APPLY_WXSS, /^\.page \{[^}]*box-sizing:\s*border-box/ms,
    '.page 带了 padding-top 就必须 border-box,否则页面比屏幕高一个导航')
  assert.match(APPLY_WXML, /class="step-head [^"]*" wx:if="\{\{mode !== 'intro'\}\}"/,
    '标题块在开场屏之外无条件渲染,加载/错误/完成态都不丢标题')
})
