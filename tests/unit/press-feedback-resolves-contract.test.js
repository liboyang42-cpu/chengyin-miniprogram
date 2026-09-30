/* 按压类必须**真的生效**(2026-08-25)
 *
 * 起因:#819 rebase 时发现全仓有 130 处 `hover-class="cy-pressed"` 挂在自定义组件里,
 * 而组件默认 styleIsolation:isolated —— 全局 style/components.wxss 里的 .cy-pressed
 * **进不来**。80 个组件里只有 1 个声明了 addGlobalClass。
 * 也就是说:那 130 个元素按下去毫无反应,而 press-feedback-coverage-contract
 * 只数「写没写 hover-class」,照样判绿 —— 它在给死代码盖章。
 *
 * 这条补的就是那一层观测:写了的类,必须在**该文件真能取到的样式表**里找得到定义。
 *   · 页面 / 声明了 addGlobalClass|apply-shared 的组件 → 自己的 wxss(含 @import)+ app.wxss(含 @import)
 *   · 其余组件(isolated)→ 只有自己的 wxss(含 @import)
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIR = new Set(['node_modules', 'miniprogram_npm', 'tests', 'docs', 'images', '.git', 'scripts'])

function collectWxml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectWxml(full, out)
    else if (entry.name.endsWith('.wxml')) out.push(full)
  }
  return out
}

/** 跟着 @import 递归读全,否则会把「定义在被 import 的公共表里」误判成没定义 */
function readCss(file, seen = new Set()) {
  const abs = path.resolve(file)
  if (seen.has(abs) || !fs.existsSync(abs)) return ''
  seen.add(abs)
  let source = fs.readFileSync(abs, 'utf8')
  for (const m of source.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const raw = m[1]
    const target = raw.startsWith('/') ? path.join(ROOT, raw) : path.resolve(path.dirname(abs), raw)
    source += readCss(target, seen)
  }
  return source
}

/** 三元只取 `?` 之后的分支 —— 条件里的比较值(`state === 'loading'`)不是类名 */
function hoverClasses(source) {
  const out = []
  for (const m of source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/hover-class="([^"]*)"/g)) {
    const value = m[1]
    if (!value.includes('{{')) { out.push(...value.split(/\s+/)); continue }
    for (const expr of value.split('{{').slice(1).map((s) => s.split('}}')[0])) {
      const q = expr.indexOf('?')
      const branches = q < 0 ? expr : expr.slice(q + 1)
      for (const lit of branches.matchAll(/'([^']*)'/g)) out.push(...lit[1].split(/\s+/))
    }
  }
  return out.filter((c) => c && c !== 'none')
}

function unresolved(wxmlPath) {
  const meta = (() => {
    const j = wxmlPath.replace(/\.wxml$/, '.json')
    return fs.existsSync(j) ? fs.readFileSync(j, 'utf8') : ''
  })()
  const isolated = /"component"\s*:\s*true/.test(meta) && !/addGlobalClass|apply-shared/.test(meta)
  let css = readCss(wxmlPath.replace(/\.wxml$/, '.wxss'))
  if (!isolated) css += readCss(path.join(ROOT, 'app.wxss'))
  return [...new Set(hoverClasses(fs.readFileSync(wxmlPath, 'utf8')))]
    .filter((c) => !new RegExp('\\.' + c.replace(/-/g, '\\-') + '\\s*[,{:]').test(css))
}

test('每个 hover-class 都必须在该文件真能取到的样式表里有定义', () => {
  const dead = []
  for (const file of collectWxml(ROOT)) {
    for (const cls of unresolved(file)) dead.push(`${path.relative(ROOT, file)} → .${cls}`)
  }
  assert.deepEqual(dead, [], '这些按压类取不到定义,元素按下去没有任何反应:\n  ' + dead.join('\n  '))
})

test('负控:往 isolated 组件里塞一个只有全局定义的类,必须判红', () => {
  // cy-tabs 是 isolated,且全局 style/components.wxss 里确实有 .cy-pressed
  const tabs = path.join(ROOT, 'components/cy/tabs/index.wxml')
  const original = fs.readFileSync(tabs, 'utf8')
  assert.deepEqual(unresolved(tabs), [], '负控锚点失效:cy-tabs 现在就有取不到的类')
  fs.writeFileSync(tabs, original.replace('hover-class="cy-tabs__item--press"', 'hover-class="cy-pressed"'))
  try {
    assert.deepEqual(unresolved(tabs), ['cy-pressed'],
      'isolated 组件引用全局 .cy-pressed 必须被判成取不到 —— 判不出来这条门禁就是橡皮图章')
  } finally {
    fs.writeFileSync(tabs, original)
  }
})

test('负控:页面引用全局类不算缺口(别把 app.wxss 这条链一起误杀)', () => {
  const page = path.join(ROOT, 'pages/play/circle/index.wxml')
  assert.ok(fs.readFileSync(page, 'utf8').includes('hover-class="cy-pressed"'), '负控锚点失效')
  assert.deepEqual(unresolved(page), [], '页面不隔离,全局 .cy-pressed 对它有效,不该报缺口')
})
