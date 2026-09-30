/* 全仓 <button> 样式存活审计。
 *
 * 机制(已用 miniprogram-automator 读计算样式坐实:同一个单类挂 button 上是 rgba(0,0,0,0),
 * 挂 view 上或挂 size=mini 的 button 上都是设定色 —— 差异只由 :not([size=mini]) 那一支造成):
 *   style/lib.wxss 的全局 reset 写成 `button, wx-button:not([size=mini])`。
 *   后半支特异度 (0,1,1),压过任何单类 (0,1,0) 声明 —— 于是页面/组件里
 *   `.xxx { background: ... }` 挂在原生 <button> 上会被静默吃掉。
 *   前半支 `button` (0,0,1) 已经把同一批声明发给所有 button(含 size=mini),
 *   所以后半支唯一的作用就是抬特异度。
 *
 * 本脚本按 reset 覆盖的 7 个属性逐个判:谁赢。
 * 用法: node scripts/button-reset-specificity-lint.js [--json] [--selftest]
 */
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const RESET_PROPS = ['background', 'font-weight', 'padding', 'margin', 'display', 'align-items', 'justify-content']
const PROP_ALIASES = {
  background: /^background(-color|-image)?$/,
  padding: /^padding(-top|-right|-bottom|-left)?$/,
  margin: /^margin(-top|-right|-bottom|-left)?$/,
  'font-weight': /^font-weight$/,
  display: /^display$/,
  'align-items': /^align-items$/,
  'justify-content': /^justify-content$/,
}
/** 值等于 reset 自身效果 ⇒ 被吃掉也看不出来,不算缺陷 */
const NOOP_VALUE = {
  background: /^(none|transparent|rgba\(0,\s*0,\s*0,\s*0\)|0 0|initial|unset)$/i,
  padding: /^0(px|rpx)?( 0(px|rpx)?)*$/,
  margin: /^0(px|rpx)?( 0(px|rpx)?)*$/,
  display: /^flex$/,
  'align-items': /^center$/,
  'justify-content': /^center$/,
  'font-weight': /^(normal|400)$/,
}

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    e.isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}
const ALL = walk(ROOT)

/* ---------- wxss 解析(@import 按源码顺序内联展开) ---------- */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
function loadSheet(file, seen = new Set()) {
  const abs = path.resolve(file)
  if (seen.has(abs) || !fs.existsSync(abs)) return []
  seen.add(abs)
  const src = stripComments(fs.readFileSync(abs, 'utf8'))
  const rules = []
  for (const part of src.split(/(@import\s+['"][^'"]+['"]\s*;)/g)) {
    const imp = part.match(/^@import\s+['"]([^'"]+)['"]\s*;$/)
    if (imp) { rules.push(...loadSheet(path.resolve(path.dirname(abs), imp[1]), seen)); continue }
    const body = part.replace(/@(media|supports)[^{]*\{/g, '').replace(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/g, '')
    let m; const re = /([^{}]+)\{([^{}]*)\}/g
    while ((m = re.exec(body))) {
      const decls = [...m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)]
        .map((d) => ({ prop: d[1], value: d[2].replace(/!important/i, '').trim(), important: /!important/i.test(d[2]) }))
      if (!decls.length) continue
      for (const sel of m[1].split(',')) {
        const s = sel.trim()
        if (s) rules.push({ sel: s, file: path.relative(ROOT, abs), decls })
      }
    }
  }
  return rules
}

/* ---------- 选择器 ---------- */
const PSEUDO_EL = /::(after|before|first-line|placeholder|selection)/
const keyCompound = (sel) => { const p = sel.split(/\s*[>+~]\s*|\s+/).filter(Boolean); return p[p.length - 1] || '' }
const isSingleCompound = (sel) => !/[\s>+~]/.test(sel.trim())
function specificity(sel) {
  const s = sel.replace(/::[a-z-]+/g, '')
  const ids = (s.match(/#[\w-]+/g) || []).length
  let b = 0, c = 0
  const rest = s.replace(/:not\(([^)]*)\)/g, (_, inner) => { const sp = specificity(inner); b += sp[1]; c += sp[2]; return ' ' })
  b += (rest.match(/\.[\w-]+/g) || []).length + (rest.match(/\[[^\]]+\]/g) || []).length + (rest.match(/:(?!:)[a-z-]+(\([^)]*\))?/g) || []).length
  c += (rest.replace(/\.[\w-]+|\[[^\]]+\]|#[\w-]+|:[a-z-]+(\([^)]*\))?/g, ' ').match(/\b(?:wx-)?[a-z][\w-]*\b/g) || []).length
  return [ids, b, c]
}
const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const classesOf = (c) => (c.match(/\.[\w-]+/g) || []).map((x) => x.slice(1))
const tagOf = (c) => { const m = c.match(/^(?:wx-)?([a-z][\w-]*)/); return m ? m[1] : null }
function keyMatches(compound, btnClasses) {
  if (PSEUDO_EL.test(compound)) return false
  const tag = tagOf(compound)
  if (tag && tag !== 'button') return false
  return classesOf(compound).every((c) => btnClasses.has(c))
}

const GLOBAL = loadSheet(path.join(ROOT, 'app.wxss'))
/* reset = 全局里对**所有** button 无条件生效的规则:单个复合选择器、tag 是 button、
 * 且不带 class/id 限定(`button.pr-cta` 这种只命中特定 class,不是 reset)。 */
const RESET = GLOBAL.filter((r) =>
  isSingleCompound(r.sel) && tagOf(r.sel) === 'button' && !PSEUDO_EL.test(r.sel) &&
  !/[.#]/.test(r.sel.replace(/:not\([^)]*\)/g, '')))

/* ---------- 扫 wxml ---------- */
function analyze(extraReset = []) {
const RESET_ALL = [...RESET, ...extraReset]
const findings = []
for (const wxml of ALL.filter((f) => f.endsWith('.wxml'))) {
  const src = fs.readFileSync(wxml, 'utf8')
  const scoped = loadSheet(wxml.replace(/\.wxml$/, '.wxss'))
  const rel = path.relative(ROOT, wxml)
  let m; const re = /<button\b([^>]*)>/g
  while ((m = re.exec(src))) {
    const before = src.slice(0, m.index)
    const open = before.lastIndexOf('<!--'), close = before.lastIndexOf('-->')
    if (open > close) continue                                  // 注释里的
    const attrs = m[1]
    const line = before.split('\n').length
    const clsAttr = (attrs.match(/\bclass\s*=\s*"([^"]*)"/) || [])[1] || ''
    const btnClasses = new Set(clsAttr.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean))
    const sizeMini = /\bsize\s*=\s*"mini"/.test(attrs)

    const suppressed = []
    for (const prop of RESET_PROPS) {
      const alias = PROP_ALIASES[prop]
      // reset 在这个 button 上对该属性的最高特异度
      let resetSpec = null
      for (const r of RESET_ALL) {
        if (/\[size=mini\]/.test(r.sel) && sizeMini) continue    // :not([size=mini]) 排除了它
        if (!r.decls.some((d) => alias.test(d.prop))) continue
        const sp = specificity(r.sel)
        if (!resetSpec || cmpSpec(sp, resetSpec) > 0) resetSpec = sp
      }
      if (!resetSpec) continue

      // 作者侧候选:key compound 靠 class 命中(纯 tag 规则就是 reset 自己,不算)
      let best = null
      for (const r of [...GLOBAL, ...scoped]) {
        const kc = keyCompound(r.sel)
        if (!classesOf(kc).length || !keyMatches(kc, btnClasses)) continue
        const d = r.decls.filter((x) => alias.test(x.prop)).pop()
        if (!d) continue
        const sp = specificity(r.sel)
        const better = !best || (d.important && !best.d.important) || (d.important === best.d.important && cmpSpec(sp, best.sp) >= 0)
        if (better) best = { r, d, sp }
      }
      if (!best) continue
      if (best.d.important || cmpSpec(best.sp, resetSpec) >= 0) continue   // 作者赢,没问题
      suppressed.push({
        prop, decl: best.d.prop, value: best.d.value, sel: best.r.sel, file: best.r.file,
        spec: best.sp.join(','), resetSpec: resetSpec.join(','),
        noop: (NOOP_VALUE[prop] || /$^/).test(best.d.value),
      })
    }
    findings.push({ rel, line, cls: clsAttr, sizeMini, suppressed })
  }
}
return findings
}

/* 负控:注入历史上真实存在过的那条有害 reset(style/lib.wxss 曾写成
 * `button, wx-button:not([size=mini])`),检查器必须能判红。判不红说明它是橡皮图章。 */
if (process.argv.includes('--selftest')) {
  const BAD = [{ sel: 'wx-button:not([size=mini])', file: '<selftest>', decls: RESET_PROPS.map((prop) => ({ prop, value: prop === 'background' ? 'none' : '0', important: false })) }]
  const withBad = analyze(BAD).filter((f) => f.suppressed.some((s) => !s.noop))
  const clean = analyze().filter((f) => f.suppressed.some((s) => !s.noop))
  const ok = withBad.length > 0 && clean.length === 0
  console.log(`selftest: 注入 (0,1,1) reset -> ${withBad.length} 处判红 ; 当前仓库 -> ${clean.length} 处判红`)
  console.log(ok ? 'selftest PASS(能判红也能判绿)' : 'selftest FAIL')
  process.exit(ok ? 0 : 1)
}

const findings = analyze()

if (process.argv.includes('--json')) { console.log(JSON.stringify(findings, null, 2)); process.exit(0) }
const only = (process.argv.find((a) => a.startsWith('--prop=')) || '').split('=')[1]
const hit = findings.filter((f) => f.suppressed.some((s) => !only || s.prop === only))
const visible = hit.filter((f) => f.suppressed.some((s) => !s.noop && (!only || s.prop === only)))
console.log(`<button> 共 ${findings.length} 处 · 有声明被 reset 压掉的 ${hit.length} 处 · 其中值与 reset 不同(肉眼可见) ${visible.length} 处\n`)
const bg = (f) => f.suppressed.filter((s) => s.prop === 'background')
console.log('【A】background 被吃掉且值不是透明/none —— 真实视觉缺陷')
for (const f of findings) for (const s of bg(f)) if (!s.noop) console.log(`  ${f.rel}:${f.line}  class="${f.cls}"\n      ${s.file}: ${s.sel} { background: ${s.value} }   ${s.spec} < ${s.resetSpec}`)
console.log('\n【B】background 被吃掉但值本就是透明/none —— 今天不可见,是同一根因的哑弹')
for (const f of findings) for (const s of bg(f)) if (s.noop) console.log(`  ${f.rel}:${f.line}  class="${f.cls}"   (${s.value})`)
console.log('\n【C】background 之外、同样被 reset 压掉的属性 —— 修 reset 后这些会「突然生效」,是回归风险面')
for (const f of findings) for (const s of f.suppressed) if (s.prop !== 'background' && !s.noop) console.log(`  ${f.rel}:${f.line}  class="${f.cls}"   ${s.decl}: ${s.value}   (${s.file}: ${s.sel})`)
process.exit(visible.length ? 1 : 0)
