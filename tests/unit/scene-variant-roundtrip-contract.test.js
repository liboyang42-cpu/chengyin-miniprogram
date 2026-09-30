/**
 * scene variant 往返契约
 *
 * 为什么有这条:scene-sheet 的 WXSS 实现了 peek/half/full 三档,registry 也登记了三个 variant:'half'
 * 的场景,但 normalizeScene() 原来只放行 peek、其余一律归一成 full —— 三个「半屏」场景从来没半屏过,
 * 不报错、无覆盖,`.ss--half` 那段样式是死代码。
 *
 * 判据是**registry 与 normalize 的一致性**,不是写死的 variant 名单:
 * 往 registry 里加新场景不需要改这条测试,而把某个 variant 从 normalize 里摘掉会立刻红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const { normalizeScene } = require(path.join(ROOT, 'utils/scene-stack.js'))
const registry = require(path.join(ROOT, 'utils/scene-registry.js'))

/** registry 的导出形状随版本变过,这里只认「值里带 route 的那张表」 */
function sceneTable() {
  const candidates = [registry, registry.SCENES, registry.scenes, registry.default]
  for (const c of candidates) {
    if (c && typeof c === 'object') {
      const entries = Object.entries(c).filter(([, v]) => v && typeof v === 'object' && 'route' in v)
      if (entries.length) return entries
    }
  }
  throw new Error('没能从 utils/scene-registry.js 里找到场景表,契约无法判定(不是通过)')
}

test('registry 里声明的 variant 必须原样活过 normalizeScene', () => {
  const entries = sceneTable()
  assert.ok(entries.length > 10, `场景表只解析出 ${entries.length} 条,疑似解析失败`)

  const declared = new Set(entries.map(([, v]) => v.variant).filter(Boolean))
  assert.ok(declared.size >= 2, `registry 只声明了 ${[...declared]} 一种 variant,这条契约失去意义`)

  const dropped = []
  for (const [id, cfg] of entries) {
    if (!cfg.variant) continue
    const got = normalizeScene({ id, route: cfg.route, variant: cfg.variant }).variant
    if (got !== cfg.variant) dropped.push(`${id}: registry 声明 ${cfg.variant},normalize 后变成 ${got}`)
  }
  assert.deepEqual(dropped, [], `variant 被 normalizeScene 吞掉,对应的 scene-sheet 样式档位永远不会生效:\n${dropped.join('\n')}`)
})

test('未知 variant 仍 fail-closed 到 full', () => {
  assert.equal(normalizeScene({ id: 'x', variant: 'gigantic' }).variant, 'full')
  assert.equal(normalizeScene({ id: 'x' }).variant, 'full')
})

test('negative control:两个档位各自都要被 normalize 认得', () => {
  // 任何一档被摘掉,这里就红 —— 防止「只放行某一档」那种收敛悄悄回潮
  for (const v of ['half', 'full']) {
    assert.equal(
      normalizeScene({ id: 'x', variant: v }).variant,
      v,
      `normalizeScene 把 ${v} 改成了别的档位;scene-sheet 的 .ss--${v} 会变成死样式`,
    )
  }
})

test('scene-sheet 确实实现了 registry 声明的每一档', () => {
  const wxss = fs.readFileSync(path.join(ROOT, 'components/cy/scene-sheet/index.wxss'), 'utf8')
  const declared = new Set(sceneTable().map(([, v]) => v.variant).filter(Boolean))
  const missing = [...declared].filter(v => v !== 'full' && !wxss.includes(`.ss--${v}`))
  assert.deepEqual(missing, [], `registry 声明了这些 variant 但 scene-sheet 没有对应样式:${missing.join(', ')}`)
})
