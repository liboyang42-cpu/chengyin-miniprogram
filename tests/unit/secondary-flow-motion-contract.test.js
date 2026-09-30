const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

const CASES = [
  {
    id: 'club-enroll',
    js: 'pages/club/enroll/index.js',
    wxml: 'pages/club/enroll/index.wxml',
    wxss: 'pages/club/enroll/index.wxss',
    wxmlRules: [/class="team cy-rise-in"/, /hover-class="team-head--pressed"/],
    wxssRules: [
      /@keyframes\s+club-team-expand/,
      /\.cy-motion-reduced\s+\.team-head,\s*\.cy-motion-reduced\s+\.team-arrow\s*\{[^}]*transition:\s*none\s*!important/s,
      /\.cy-motion-reduced\s+\.team-body\s*\{[^}]*animation:\s*none\s*!important/s,
    ],
  },
  {
    id: 'topic-pricing',
    js: 'pages/topic/pricing/index.js',
    wxml: 'pages/topic/pricing/index.wxml',
    wxss: 'pages/topic/pricing/index.wxss',
    wxmlRules: [/class="pg-card cy-rise-in/],
    wxssRules: [/\.pg-actions\s*\{[^}]*animation:\s*pricing-actions-in/s, /\.cy-motion-reduced\s+\.pg-actions\s*\{[^}]*animation:\s*none\s*!important/s],
  },
  {
    id: 'club-apply',
    js: 'pages/club/apply/index.js',
    wxml: 'pages/club/apply/index.wxml',
    wxss: 'pages/club/apply/index.wxss',
    // 四步内容随 wx:if 重挂自动重播;大标题不重挂,由 refreshStep 的 stepIn 开关重播。
    wxmlRules: [
      /class="step cy-rise-in" wx:if/,
      /class="step-head \{\{stepIn \? 'cy-rise-in' : ''\}\}"/,
      // 开场 CTA→进度条的共享元素形变:三层结构与 morphRun 开关缺一不可
      /class="morph" wx:if="\{\{morph\}\}"/,
      /class="morph__track"/,
      /class="morph__fill"/,
      /scale\(\{\{morphRun \? morph\.sx : 1\}\}, \{\{morphRun \? morph\.sy : 1\}\}\)/,
    ],
    wxssRules: [
      /\.cy-motion-reduced\s+\.opt,\s*\.cy-motion-reduced\s+\.cap,\s*\.cy-motion-reduced\s+\.sw,\s*\.cy-motion-reduced\s+\.sw__knob,\s*\.cy-motion-reduced\s+\.prog__seg\s*\{[^}]*transition:\s*none\s*!important/s,
      // 形变样式住在 style/wizard-intro.wxss(三页共用),页面这边只查确实引了它
      /@import '\.\.\/\.\.\/\.\.\/style\/wizard-intro\.wxss';/,
    ],
  },
  {
    id: 'club-create',
    js: 'pages/club/create/index.js',
    wxml: 'pages/club/create/index.wxml',
    wxss: 'pages/club/create/index.wxss',
    // 四个步骤体随 wx:if 重挂自动重播;问题标题不重挂,由 refreshStep 的 stepIn 开关重播。
    // 2026-09-06 按 G1–G4 稿对齐后,重播的开关从 .cc-q 挪到了包住
    // eyebrow/标题/副标题 的 .cc-head 上 —— 三段要一起进场,不能只动标题。
    wxmlRules: [
      /class="cc-body cy-rise-in"/,
      /class="cc-head \{\{stepIn \? 'cy-rise-in' : ''\}\}"/,
      /class="morph" wx:if="\{\{morph\}\}"/,
      /scale\(\{\{morphRun \? morph\.sx : 1\}\}, \{\{morphRun \? morph\.sy : 1\}\}\)/,
    ],
    wxssRules: [/\.cy-motion-reduced\s+\.cc-opt,[\s\S]*?\.cy-motion-reduced\s+\.cc-chip\s*\{[^}]*transition:\s*none\s*!important/s],
  },
  {
    id: 'merchant-apply',
    js: 'pages/merchant/apply/index.js',
    wxml: 'pages/merchant/apply/index.wxml',
    wxss: 'pages/merchant/apply/index.wxss',
    // 商家档是浅色:动效照抄玩家档,配色不串。
    wxmlRules: [
      /class="step cy-rise-in" wx:if/,
      /class="wizard-head__copy \{\{stepIn \? 'cy-rise-in' : ''\}\}"/,
      /class="morph" wx:if="\{\{morph\}\}"/,
      /scale\(\{\{morphRun \? morph\.sx : 1\}\}, \{\{morphRun \? morph\.sy : 1\}\}\)/,
    ],
    wxssRules: [/@import '\.\.\/\.\.\/\.\.\/style\/wizard-intro\.wxss';/],
  },
  {
    id: 'merchant-topic-apply',
    js: 'pages/topic/merchantapply/index.js',
    wxml: 'pages/topic/merchantapply/index.wxml',
    wxss: 'pages/topic/merchantapply/index.wxss',
    wxmlRules: [/class="ma-card wizard-card cy-rise-in/, /hover-class="ma-row--pressed"/, /hover-class="ma-pgrid-add--pressed"/],
    wxssRules: [
      /\.ma-success\s*\{[^}]*animation:\s*merchant-success-in/s,
      /\.cy-motion-reduced\s+\.ma-row,\s*\.cy-motion-reduced\s+\.ma-pgrid-add\s*\{[^}]*transition:\s*none\s*!important/s,
      /\.cy-motion-reduced\s+\.ma-success\s*\{[^}]*animation:\s*none\s*!important/s,
    ],
  },
]

function findViolations(overrides = {}) {
  const violations = []
  for (const spec of CASES) {
    const js = spec.js ? (overrides[spec.js] || read(spec.js)) : ''
    const wxml = spec.wxml ? (overrides[spec.wxml] || read(spec.wxml)) : ''
    const wxss = overrides[spec.wxss] || read(spec.wxss)
    if (spec.js && !/require\(['"][^'"]*motion-preference\.js['"]\)/.test(js)) violations.push(`${spec.id}:js:motionPreferenceImport`)
    if (spec.js && !/const reducedMotion = readReducedMotion\(\)/.test(js)) violations.push(`${spec.id}:js:readReducedMotion`)
    if (spec.js && !/setData\(\{ reducedMotion \}\)/.test(js)) violations.push(`${spec.id}:js:setReducedMotion`)
    if (spec.wxml && !/reducedMotion\s*\?\s*'cy-motion-reduced'/.test(wxml)) violations.push(`${spec.id}:wxml:reducedMotion-root`)
    for (const rule of spec.wxmlRules || []) {
      if (!rule.test(wxml)) violations.push(`${spec.id}:wxml:${rule}`)
    }
    for (const rule of spec.wxssRules) {
      if (!rule.test(wxss)) violations.push(`${spec.id}:wxss:${rule}`)
    }
    if (/animation-delay\s*:/.test(wxss)) violations.push(`${spec.id}:wxss:animation-delay`)
  }
  // 形变的共用真源:只准动 transform / border-radius。
  // 动 width/left 会同时踩布局属性棘轮和掉帧,这条是把那个约束钉死的地方。
  const morphCss = read('style/wizard-intro.wxss')
  if (!/\.morph\s*\{[^}]*transition:\s*transform\s+400ms\s+cubic-bezier\(\.65,\s*0,\s*\.35,\s*1\)/s.test(morphCss)) {
    violations.push('style/wizard-intro.wxss:形变的 transition 不再是 transform 400ms 慢快慢')
  }
  if (/\.morph\s*\{[^}]*transition:[^;}]*\b(width|height|left|top)\b/s.test(morphCss)) {
    violations.push('style/wizard-intro.wxss:形变动了布局属性')
  }
  if (!/\.cy-motion-reduced\s+\.morph,/.test(morphCss)) {
    violations.push('style/wizard-intro.wxss:形变没有减动效兜底')
  }
  const sharedPath = 'style/motion-entry.wxss'
  const sharedMotion = overrides[sharedPath] || read(sharedPath)
  if (!/\.cy-motion-reduced\s+\.cy-rise-in\s*\{[^}]*animation:\s*none\s*!important/s.test(sharedMotion)) {
    violations.push('shared-motion:reduced-motion-guard')
  }
  if (/animation-delay\s*:/.test(sharedMotion)) violations.push('shared-motion:animation-delay')
  if (!/@import\s+'\.\/motion-entry\.wxss'/.test(overrides['style/components.wxss'] || read('style/components.wxss'))) {
    violations.push('shared-motion:not-imported')
  }
  return violations
}

test('第二批非编辑页在不改版式的前提下提供进入、展开与按压反馈', () => {
  assert.deepEqual(findViolations(), [])
})

test('第二批动效继续服从全局系统减动效设置', () => {
  const appStyle = read('app.wxss')
  assert.match(appStyle, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(appStyle, /animation-duration:\s*0\.01ms\s*!important/)
  assert.match(appStyle, /transition-duration:\s*0\.01ms\s*!important/)
  assert.deepEqual(findViolations(), [])
})

test('负控：移除任一页面的进入动效时，第二批合同必须判红', () => {
  const file = 'pages/topic/pricing/index.wxml'
  const mutated = read(file).replaceAll('cy-rise-in', '')
  assert.notEqual(mutated, read(file), '负控必须真实移除终价卡片进入动效')
  assert.ok(findViolations({ [file]: mutated }).some((item) => item.startsWith('topic-pricing:')))
})

test('负控：保存偏好、共享 guard、独有动画 guard、按压 guard 或 delay 回潮都必须判红', () => {
  const cases = [
    {
      file: 'pages/topic/pricing/index.js',
      mutate: (source) => source.replace('const reducedMotion = readReducedMotion();', 'const reducedMotion = false;'),
      prefix: 'topic-pricing:',
    },
    {
      file: 'pages/club/enroll/index.js',
      mutate: (source) => source.replace(/const \{ readReducedMotion \} = require\([^\n]+\);\n/, ''),
      prefix: 'club-enroll:',
    },
    {
      file: 'style/motion-entry.wxss',
      mutate: (source) => source.replace('.cy-motion-reduced .cy-rise-in { animation: none !important; }', ''),
      prefix: 'shared-motion:',
    },
    {
      file: 'pages/topic/pricing/index.wxss',
      mutate: (source) => source.replace('.cy-motion-reduced .pg-actions { animation: none !important; }', ''),
      prefix: 'topic-pricing:',
    },
    {
      file: 'pages/topic/merchantapply/index.wxss',
      mutate: (source) => source.replace(/\.cy-motion-reduced \.ma-row,[\s\S]*?transition: none !important; \}/, ''),
      prefix: 'merchant-topic-apply:',
    },
  ]

  for (const spec of cases) {
    const original = read(spec.file)
    const mutated = spec.mutate(original)
    assert.notEqual(mutated, original, `${spec.file} 负控必须真实改变输入`)
    assert.ok(findViolations({ [spec.file]: mutated }).some((item) => item.startsWith(spec.prefix)), `${spec.file} 负控没有判红`)
  }
})
