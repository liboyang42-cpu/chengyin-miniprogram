/* 全仓 WXSS 的 @import 必须真的指得到一个文件 —— 2026-09-22
 *
 * 为什么有这条:playkit-sort / match / classify 三个屏的第一行写的是
 * `@import "/style/play-surface.wxss"`,而那份皮面在 `/pages/play/style/` 下。
 * 路径指空的后果不是报错,是**整份皮面没加载** —— `--ink`/`--sub`/`--soft` 全成了未定义 var,
 * 凡是用到它们的声明按 WXSS 规则**整条静默作废**(见 memory
 * feedback-undefined-css-var-kills-whole-declaration)。屏还在、字还在,就是颜色排版全不对,
 * 而全量单测、lint、ds-gate 当时**全绿**:没有任何一道门禁看 @import 指向哪。
 *
 * 判据只有一条:解析得到。注释里的用法示例不算(那是文档,不是声明)。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', '.git', 'docs'])

/** 冻结基线:合这条门禁时就已经断着的。只能减不能加 —— 修掉一个就从这里删一个。
 *  合进来时唯一那条(topic/pricing/partner 指向不存在的 style/pr-settings.wxss)
 *  当场就修好了,所以这里是空的。空不等于这条基线没用:再有一条断的就得先进这里。 */
const FROZEN_BROKEN = []

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.wxss')) out.push(full)
  }
  return out
}

/** @param overrides 负控用:把某个文件的内容替换掉再扫 */
function survey(overrides = {}) {
  const files = walk(ROOT)
  const broken = []
  let imports = 0
  for (const file of files) {
    const relative = path.relative(ROOT, file)
    const raw = overrides[relative] !== undefined ? overrides[relative] : fs.readFileSync(file, 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '')   // 注释里的用法示例不是声明
    for (const m of src.matchAll(/@import\s+["']([^"']+)["']/g)) {
      imports += 1
      const spec = m[1]
      // 以 / 开头 = 小程序根(即 chengyinhub-xcx/),否则相对当前文件
      const abs = spec.startsWith('/') ? path.join(ROOT, spec) : path.resolve(path.dirname(file), spec)
      if (!fs.existsSync(abs)) broken.push(`${relative} -> ${spec}`)
    }
  }
  return { broken, imports, fileCount: files.length }
}

test('扫描分母正常:全仓 wxss 与 @import 都要读得到', () => {
  const { imports, fileCount } = survey()
  assert.ok(fileCount >= 200, `只扫到 ${fileCount} 份 wxss`)
  assert.ok(imports >= 100, `只扫到 ${imports} 条 @import`)
})

test('★每条 @import 都必须解析得到 —— 指空不会报错,只会让整份样式静默消失', () => {
  const { broken } = survey()
  const unexpected = broken.filter((b) => !FROZEN_BROKEN.includes(b))
  assert.deepEqual(unexpected, [], '这些 @import 指向不存在的文件')
})

test('冻结基线只能减不能加:修好的必须从 FROZEN_BROKEN 里删掉', () => {
  const { broken } = survey()
  const stale = FROZEN_BROKEN.filter((b) => !broken.includes(b))
  assert.deepEqual(stale, [], '这些已经修好了,请从冻结基线删除,别留空位')
})

test('negative control:把一条 @import 改指到不存在的文件必须判红', () => {
  const target = path.join('pages', 'play', 'components', 'playkit-sort', 'index.wxss')
  const src = fs.readFileSync(path.join(ROOT, target), 'utf8')
  const mutated = src.replace('/pages/play/style/play-surface.wxss', '/style/play-surface.wxss')
  assert.notEqual(mutated, src, '负控锚点失效:那一行的写法变了,判据要跟着改')
  const { broken } = survey({ [target]: mutated })
  assert.ok(broken.includes(`${target} -> /style/play-surface.wxss`), '门禁没认出被改坏的 @import')
})

test('negative control:注释里的用法示例不算违规 —— 判据看声明不看说明', () => {
  const target = path.join('pages', 'play', 'components', 'playkit-sort', 'index.wxss')
  const src = fs.readFileSync(path.join(ROOT, target), 'utf8')
  const mutated = `/* 用法:@import '/完全不存在的/路径.wxss'; */\n${src}`
  const { broken } = survey({ [target]: mutated })
  assert.deepEqual(broken.filter((b) => b.startsWith(target)), [], '把注释里的示例当成了真声明')
})
