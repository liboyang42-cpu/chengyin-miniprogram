/* cy-skeleton 宿主不许被压成 row flex 容器(2026-09-05)
 *
 * 2026-09-05 实测:pages/club/apply 把 `.bootstrap-state{display:flex;flex:1;min-height:0}`
 * 挂在 cy-skeleton 上,进页头一两秒是**纯黑**——宿主量出来 390x658 占着高度,
 * 却一个像素都不画。根因:宿主成了 row 方向 flex 容器后,组件内部根节点 .sk
 * 变成 row flex item,骨架条没有固有宽度被压成 0。
 *
 * 三次单变量实测:
 *   display:flex(默认 row)          → 不渲染
 *   display:block + flex:1           → 正常
 *   display:flex + flex-direction:column → 正常
 * ⇒ 判据 = 「display:flex 且没有 flex-direction:column」,不是「有没有 flex」。
 *
 * 这条只查页面 wxss 里直接给 cy-skeleton 的 class;组件内部样式不归它管。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'tests', 'docs', 'images', '.git'])

function collect(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, ext, out)
    else if (entry.name.endsWith(ext)) out.push(full)
  }
  return out
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 该 wxss 里「声明了 display:flex 但没声明 flex-direction:column」的类名 */
function rowFlexClasses(css) {
  const hit = new Set()
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = m[2]
    if (!/display\s*:\s*(?:inline-)?flex/.test(body)) continue
    if (/flex-direction\s*:\s*column/.test(body)) continue
    for (const c of m[1].matchAll(/\.([\w-]+)/g)) hit.add(c[1])
  }
  return hit
}

function survey(overrides = {}) {
  const gaps = []
  const wxmls = collect(ROOT, '.wxml')
  for (const file of wxmls) {
    const rel = path.relative(ROOT, file)
    const source = overrides[rel] !== undefined ? overrides[rel] : fs.readFileSync(file, 'utf8')
    const wxssPath = file.replace(/\.wxml$/, '.wxss')
    if (!fs.existsSync(wxssPath)) continue
    const relWxss = path.relative(ROOT, wxssPath)
    const css = overrides[relWxss] !== undefined ? overrides[relWxss] : fs.readFileSync(wxssPath, 'utf8')
    const rowFlex = rowFlexClasses(css)
    for (const tag of source.matchAll(/<cy-skeleton\b[^>]*class="([^"]*)"/g)) {
      for (const cls of tag[1].split(/\s+/).filter(Boolean)) {
        if (rowFlex.has(cls)) gaps.push(`${rel}#cy-skeleton.${cls}`)
      }
    }
  }
  return { gaps, fileCount: wxmls.length }
}

test('cy-skeleton 宿主不得被页面样式变成 row flex 容器(会整块不渲染)', () => {
  const { gaps, fileCount } = survey()
  assert.ok(fileCount >= 200, '扫描分母异常,必须覆盖全部 wxml')
  assert.deepEqual(gaps, [], '这些骨架屏会占着高度但一个像素都不画')
})

test('负控:把 club/apply 那个已知缺陷放回去必须判红', () => {
  const wxml = 'pages/club/apply/index.wxml'
  const source = fs.readFileSync(path.join(ROOT, wxml), 'utf8')
  const reverted = source.replace(
    /<cy-skeleton wx:if="\{\{bootstrapState === 'checking-role'\}\}"/,
    '<cy-skeleton class="bootstrap-state" wx:if="{{bootstrapState === \'checking-role\'}}"',
  )
  assert.notEqual(reverted, source, '负控锚点失效')
  const { gaps } = survey({ [wxml]: reverted })
  assert.ok(gaps.includes(`${wxml}#cy-skeleton.bootstrap-state`), `负控没判红,实际:${JSON.stringify(gaps)}`)
})

test('负控:column 方向的 flex 宿主不算缺口,别把它们也拖进来', () => {
  const css = '.ok-col{display:flex;flex-direction:column;flex:1;min-height:0;}'
  assert.equal(rowFlexClasses(css).has('ok-col'), false)
  assert.equal(rowFlexClasses('.bad-row{display:flex;flex:1;}').has('bad-row'), true)
})
