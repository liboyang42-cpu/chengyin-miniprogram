const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

// 2026-08-10:cy-scene-sheet 的 .ss__stack 上挂着 `width:100%` + `max-width:392.975px`
// (iPhone 14 画板宽被当成了布局约束),面板跟着被夹住 ⇒ 屏宽 >393px 的机器右侧露出
// 底层页面(iPhone 15 Pro Max 430px 露 37px,常见安卓 412px 露 19px)。
//
// 为什么全站都要拦这一类:
//  · 390px 及以下**不触发**,而截图矩阵和模拟器都跑在 ≤393px ⇒ 这类缺陷在现有证据链里
//    结构性不可见,只有真机才报。多拍几张截图救不了(DevTools 模拟器机型没有编程接口
//    可改,automator 和 CLI 都没有),所以只能在源码层拦。
//  · 53 个注册场景共用一个弹窗宿主,一处写错就是全站弹窗一起坏。
//
// 判据:同一条规则里既写 `width: 100%`(我要满宽)又写定长 `max-width` 或非零横向
// margin(但我又把自己夹窄了)—— 这个自相矛盾就是本类缺陷的指纹。
// 只在**含全屏固定浮层的文件**里查,避免误伤普通内容页里合理的响应式限宽。

const OVERLAY_HOST = /position:\s*fixed/
const OVERLAY_FULLSCREEN = /(^|[;{\s])(inset|bottom)\s*:\s*0/

const ESCAPE_HATCH = /fullbleed-ok/

// ★ 判据的物理依据:只有**绝对长度**会在宽屏上把面板夹住。
//   rpx 是 750rpx = 屏宽 的等比单位,屏越宽它越宽;% / vw 同理 —— 这几种永远夹不出缝。
//   2026-08-10 那次真实回归是 392.975px,绝对单位。
//   (先把 var() 解析到底层值再判,否则 token 一包装就看不出单位了 —— 真实那次正是 var() 形态。)
const ABSOLUTE_LENGTH = /(^|[\s(,])-?\d*\.?\d+(px|pt|pc|in|cm|mm|q)\b/i

const TOKENS = (() => {
  const map = new Map()
  const styleDir = path.join(ROOT, 'style')
  const files = fs.existsSync(styleDir)
    ? fs.readdirSync(styleDir).filter((f) => f.endsWith('.wxss')).map((f) => path.join(styleDir, f))
    : []
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
      if (!map.has(m[1])) map.set(m[1], m[2].trim())
    }
  }
  return map
})()

// var(--x, fallback) → 底层值。跟不动就原样返回(交给调用方按「解析不出」处理)。
function resolveValue(value, depth = 0) {
  if (depth > 5) return value
  const m = value.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i)
  if (!m) return value
  const looked = TOKENS.get(m[1])
  if (looked != null) return resolveValue(looked.trim(), depth + 1)
  return m[2] ? resolveValue(m[2].trim(), depth + 1) : value
}

// 夹不夹得住?解析后含绝对长度 = 夹得住;仍是未解析的 var() = 说不准,响亮报出来让人显式确认。
function isClamping(value) {
  const resolved = resolveValue(value)
  if (ABSOLUTE_LENGTH.test(resolved)) return true
  return /^var\(/i.test(resolved) // token 查不到定义,不敢判绿
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.wxss')) out.push(full)
  }
  return out
}

// margin 简写的横向分量:1 值→全部;2/3 值→第 2 个;4 值→第 2 和第 4 个
function horizontalMargins(value) {
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts
  if (parts.length === 2 || parts.length === 3) return [parts[1]]
  if (parts.length >= 4) return [parts[1], parts[3]]
  return []
}

// 逐行拆声明:逃生口注释通常写在分号**之后**(`max-width: 392px; /* fullbleed-ok: … */`),
// 按 `;` 切会把它分到下一段去,所以按行走 —— 也跟仓库 ds-ok 的行级惯例一致。
// 跨行书写的声明拿不到豁免,那是安全的失败方向(宁可多红,不可漏拦)。
function splitDeclarations(body) {
  const out = []
  for (const line of body.split('\n')) {
    if (ESCAPE_HATCH.test(line)) continue // 带理由的逃生口:整行跳过
    for (const decl of line.split(';')) out.push(decl)
  }
  return out
}

function clampsWidth(declarations) {
  const offenders = []
  for (const decl of declarations) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const prop = decl.slice(0, idx).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const value = decl.slice(idx + 1).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (!value) continue

    if (prop === 'max-width') {
      if (isClamping(value)) offenders.push(`${prop}: ${value}`)
    } else if (prop === 'margin') {
      if (horizontalMargins(value).some(isClamping)) offenders.push(`${prop}: ${value}`)
    } else if (/^margin-(left|right|inline|inline-start|inline-end)$/.test(prop)) {
      if (isClamping(value)) offenders.push(`${prop}: ${value}`)
    }
  }
  return offenders
}

function findSelfClampingFullBleed(wxss) {
  if (!(OVERLAY_HOST.test(wxss) && OVERLAY_FULLSCREEN.test(wxss))) return []
  const hits = []
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = ruleRe.exec(wxss)) !== null) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (!selector || selector.startsWith('@')) continue
    const declarations = splitDeclarations(match[2])
    const wantsFullWidth = declarations.some((d) => /^\s*width\s*:\s*100%\s*$/.test(d.replace(/\/\*[\s\S]*?\*\//g, '')))
    if (!wantsFullWidth) continue
    for (const offender of clampsWidth(declarations)) {
      hits.push(`${selector} { width: 100%; ${offender} }`)
    }
  }
  return hits
}

test('全屏浮层里不得出现「声明满宽又把自己夹窄」的自相矛盾(宽屏真机会露出底层页)', () => {
  const offenders = []
  for (const file of walk(ROOT)) {
    for (const hit of findSelfClampingFullBleed(fs.readFileSync(file, 'utf8'))) {
      offenders.push(`${path.relative(ROOT, file)}: ${hit}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '这些浮层元素同时声明了 width:100% 和定长夹宽,>393px 的机器上右侧会露出底层页面。\n' +
      '面板要满宽就别夹;确属居中窄卡请改掉 width:100%,或在该行加 /* fullbleed-ok: 理由 */:\n' +
      offenders.join('\n'),
  )
})

// 负控:门禁必须能判红,而且要红得精准 —— 不然它只是个恒真断言。
test('自相矛盾检测器自证:能判红也能判绿', () => {
  const overlay = '.ov { position: fixed; inset: 0; display: flex; align-items: flex-end; }\n'

  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__stack { width: 100%; max-width: 392.975px; }'),
    ['.ov__stack { width: 100%; max-width: 392.975px }'],
    '漏掉了 2026-08-10 真实回归形态(定长 max-width)',
  )
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__stack { width: 100%; max-width: var(--x); }'),
    ['.ov__stack { width: 100%; max-width: var(--x) }'],
    'token 包装的夹宽同样要认 —— 真实那次就是 var() 形态,只认字面量等于没拦',
  )
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__panel { width: 100%; margin-right: 40px; }'),
    ['.ov__panel { width: 100%; margin-right: 40px }'],
    '横向 margin 会露出同一条缝',
  )
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__panel { width: 100%; margin: 0 24px; }'),
    ['.ov__panel { width: 100%; margin: 0 24px }'],
    'margin 简写的横向分量也要认',
  )

  // 不该红的别红
  assert.deepEqual(findSelfClampingFullBleed(overlay + '.ov__panel { width: 100%; }'), [], '满宽写法不该被误报')
  // ★ rpx 是等比单位(750rpx = 屏宽),屏越宽它越宽,物理上夹不出缝。把 rpx 也拦了会造出
  //   一堆假阳性(实测本仓 3 处),而假阳性会让门禁被当噪音关掉。
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__panel { width: 100%; max-width: 560rpx; }'), [],
    'rpx 夹宽随屏等比放大,不构成本类缺陷',
  )
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__panel { width: 100%; margin-left: var(--cy-space-3-5); }'), [],
    'token 要解析到底层单位再判 —— --cy-space-3-5 是 28rpx,无害',
  )
  assert.ok(TOKENS.get('--cy-space-3-5'), 'token 表没加载起来,上面那条 rpx 断言就是空转')
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__panel { width: 100%; margin: 0 auto; max-width: 100%; }'), [],
    'auto 居中与 max-width:100% 都不构成夹窄',
  )
  assert.deepEqual(
    findSelfClampingFullBleed('.card { width: 100%; max-width: 300px; }'), [],
    '不含全屏固定浮层的文件不在管辖内(普通内容页的响应式限宽是合理的)',
  )
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__dialog { width: 640rpx; max-width: 90vw; }'), [],
    '居中窄卡(没写 width:100%)是有意设计,不该拦 —— cy-modal 就是这一类',
  )
  assert.deepEqual(
    findSelfClampingFullBleed(overlay + '.ov__panel { width: 100%; max-width: 392px; /* fullbleed-ok: 有意为之 */ }'), [],
    '带理由的逃生口要生效',
  )
})
