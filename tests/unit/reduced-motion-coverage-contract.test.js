/* 「减少动态效果」覆盖率契约(2026-08-25)
 *
 * 会真位移的动画(translate / scale / rotate)如果不理会系统的「减少动态效果」,
 * 对前庭敏感用户就是直接的生理不适 —— 半屏弹窗整块上滑是最典型的一类。
 *
 * ⚠️ 兜底可以落在**两层**,检查器必须都认,否则会大批误报:
 *   ① WXSS:`.xx--reduced` / `.xx--static` 里把 animation 关掉(或改 1ms / 迭代 1 次)
 *   ② WXML:元素本身按 `reducedMotion` 条件渲染(cy-celebrate 直接清空碎片、
 *      cy-node 的慢脉冲 `wx:if` 带 `!reducedMotion`)—— 不渲染当然就不会动
 *
 * 不算缺口:
 *   · 旋转 loading(spinner):停下来会读成「卡死」,本仓已有 ds-ada-foundation-contract
 *     单独裁决,这里不重复管
 *   · 只改 opacity / 颜色的动画:Emil 的原则是「减弱不是归零」,淡入本就该保留
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIR = new Set(['node_modules', 'miniprogram_npm', 'tests', 'docs', 'images', '.git'])
const KILL = String.raw`(?:animation\s*:\s*none|animation-duration\s*:|animation-iteration-count\s*:|animation-play-state\s*:\s*paused|opacity\s*:\s*0)`
// 非捕获组:带捕获会把 REDUCED_RULE 的分组序号顶掉,导致规则体读成了这个分组、兜底集合恒为空
const REDUCED = String.raw`(?:reduced-motion|motion-reduced|--reduced|--static|is-static)`
/** 通配式兜底:`.xx--reduced view, .xx--reduced text … { animation: none }` —— 覆盖整页 */
const BLANKET = new RegExp(String.raw`${REDUCED}[^{]*\b(?:view|text|image|\*)\b[^{]*\{[^}]*${KILL}`, 's')
/** 逐条兜底:收集所有 reduced 规则命中的类名,animated 选择器必须在里面 */
const REDUCED_RULE = new RegExp(String.raw`([^{}]*${REDUCED}[^{}]*)\{([^}]*)\}`, 'g')

/** 兜底写在 WXML 而不是 WXSS 的:元素在 reducedMotion 下压根不渲染。
 *  逐条登记,并由下面的断言反查「这个 WXML 真的按 reducedMotion 条件渲染」。 */
const WXML_GUARDED = {
  'components/cy/celebrate/index.wxss': {
    wxml: 'components/cy/celebrate/index.wxml',
    why: 'reducedMotion 观察者直接把 pieces 清空,碎片不渲染',
  },
  'components/cy/node/index.wxss': {
    wxml: 'components/cy/node/index.wxml',
    why: '慢脉冲的 wx:if 带 !reducedMotion,不渲染就不会呼吸',
  },
}

/** 兜底类与被动画类**同挂一个元素**(如 `class="sf-stars sf-dim"`,兜底写在 .sf-stars)。
 *  静态读 CSS 看不出两个类共存,只能登记 —— 但下面会反查 WXML 里它们确实同时出现。 */
const COOCCURRING_GUARDED = {
  'components/cy/starfield/index.wxss': {
    wxml: 'components/cy/starfield/index.wxml',
    guardClass: 'sf-stars',
    animatedClasses: ['sf-dim', 'sf-bright'],
    why: '.sf-root--static .sf-stars 关掉动画，星层元素同时挂着 sf-stars 与 sf-dim/sf-bright',
  },
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function collect(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, ext, out)
    else if (entry.name.endsWith(ext)) out.push(full)
  }
  return out
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 该 WXSS 里「会真位移、又没有兜底」的动画。
 *  ⚠️ 逐选择器判定,不是「文件里有一处兜底就整份放过」—— 后者会让新加的动画白蹭豁免。 */
function movingUnguarded(source) {
  const css = stripComments(source)
  const blanket = BLANKET.test(css)
  const guardedClasses = new Set()
  if (!blanket) {
    for (const rule of css.matchAll(REDUCED_RULE)) {
      if (!new RegExp(KILL, 's').test(rule[2])) continue
      for (const cls of rule[1].matchAll(/\.[\w-]+/g)) {
        if (!/reduc|static/.test(cls[0])) guardedClasses.add(cls[0])
      }
    }
  }
  const frames = {}
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^}]*\})*)\}/g)) frames[m[1]] = m[2]
  const hits = []
  for (const m of css.matchAll(/([^{}]+)\{([^}]*animation:\s*([a-zA-Z][\w-]*)[^};]*)[;}]/g)) {
    const selector = m[1].trim().split('\n').pop().trim()
    if (/reduc|static/.test(selector)) continue
    const name = m[3]
    const body = frames[name] || ''
    const moves = /transform\s*:\s*[^;]*(translate|scale|rotate)/.test(body)
    const spinner = /rotate\((?:360|1turn)/.test(body) || /spin/i.test(name) || /spin/i.test(selector)
    if (!moves || spinner) continue
    if (blanket) continue
    // BEM 盲区:`.ti-card--0` 在元素上与 `.ti-card` 同时存在,`.xx--reduced .ti-card` 覆盖得到它,
    // 但静态读 CSS 看不出两个类共存 —— 按本仓的 BEM 约定,块名被兜底即视为其修饰符也被兜底。
    const classes = (selector.match(/\.[\w-]+/g) || [])
    const covered = classes.some((c) => [...guardedClasses].some((g) => c === g || c.startsWith(`${g}--`) || c.startsWith(`${g}__`)))
    if (covered) continue
    hits.push({ selector, name })
  }
  return hits
}

function survey(overrides = {}) {
  const files = collect(ROOT, '.wxss')
  const gaps = []
  for (const file of files) {
    const relative = path.relative(ROOT, file)
    if (relative in WXML_GUARDED || relative in COOCCURRING_GUARDED) continue
    const source = overrides[relative] !== undefined ? overrides[relative] : fs.readFileSync(file, 'utf8')
    for (const hit of movingUnguarded(source)) gaps.push(`${relative}#${hit.selector}@${hit.name}`)
  }
  return { gaps, fileCount: files.length }
}

test('会真位移的动画必须全部尊重「减少动态效果」', () => {
  const { gaps, fileCount } = survey()
  assert.ok(fileCount >= 200, '扫描分母异常，必须覆盖全部 WXSS')
  assert.deepEqual(gaps, [], '这些位移动画在减少动态效果时仍会播放')
})

test('登记为 WXML 兜底的，必须真的按 reducedMotion 条件渲染', () => {
  for (const [wxss, spec] of Object.entries(WXML_GUARDED)) {
    const wxml = read(spec.wxml)
    assert.match(wxml, /reducedMotion/,
      `${spec.wxml} 没有消费 reducedMotion，不能靠「WXML 兜底」免掉 WXSS 兜底(${spec.why})`)
  }
})

test('登记为「同挂类兜底」的，必须在 WXML 里真的与兜底类同挂一个元素', () => {
  for (const [wxss, spec] of Object.entries(COOCCURRING_GUARDED)) {
    const wxml = read(spec.wxml)
    for (const animated of spec.animatedClasses) {
      const together = new RegExp(`class="[^"]*\\b${spec.guardClass}\\b[^"]*\\b${animated}\\b|class="[^"]*\\b${animated}\\b[^"]*\\b${spec.guardClass}\\b`)
      assert.match(wxml, together,
        `${spec.wxml} 里 ${animated} 没有与兜底类 ${spec.guardClass} 同挂，豁免不成立(${spec.why})`)
    }
    assert.match(read(wxss), new RegExp(`--static[^{]*\\.${spec.guardClass}[^{]*\\{[^}]*animation:\\s*none`),
      `${wxss} 的兜底规则不见了`)
  }
})

test('负控：把某处 WXSS 兜底摘掉必须判红', () => {
  const victim = 'components/cy/sheet/index.wxss'
  const mutated = read(victim).replace('.sh--reduced-motion .sh__panel { animation: none; }', '')
  assert.notEqual(mutated, read(victim), '负控必须真实移除兜底')
  const { gaps } = survey({ [victim]: mutated })
  assert.ok(gaps.some((g) => g.startsWith(victim)), '摘掉兜底后必须被抓出来')
})

test('负控：新增一条无兜底的位移动画必须判红', () => {
  const victim = 'style/motion-entry.wxss'
  const mutated = `${read(victim)}\n@keyframes fake-slide { from { transform: translateY(40rpx); } to { transform: translateY(0); } }\n.fake-panel { animation: fake-slide 300ms ease-out; }\n`
  const { gaps } = survey({ [victim]: mutated })
  assert.ok(gaps.some((g) => g.includes('fake-slide')), '新增的位移动画必须被计入')
})

test('负控：spinner 与纯淡入不算缺口，别把它们也拖进来', () => {
  const spinner = '@keyframes s-spin { to { transform: rotate(360deg); } }\n.s-spin { animation: s-spin 700ms linear infinite; }'
  const fade = '@keyframes f-in { from { opacity: 0; } to { opacity: 1; } }\n.f-in { animation: f-in 200ms ease-out; }'
  const slide = '@keyframes m-up { from { transform: translateY(20rpx); } to { transform: translateY(0); } }\n.m-up { animation: m-up 200ms ease-out; }'
  assert.deepEqual(movingUnguarded(spinner), [], '旋转 loading 停下来会读成卡死，另有裁决')
  assert.deepEqual(movingUnguarded(fade), [], '只改 opacity 的动画本就该保留(减弱不是归零)')
  assert.equal(movingUnguarded(slide).length, 1, '真位移必须被抓')
})
