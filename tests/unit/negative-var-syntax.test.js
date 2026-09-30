const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

// CSS 里 `-var(--x)` 不是合法值。解析器丢掉的不是那个负号,是**整条声明** ——
// 属性静默回退成默认值,不报错、不警告,页面只是"看着有点不对"。
// 2026-08-04 由 free-map 的 .fmap-plus::after { top: -var(--cy-space-1-5) } 追出来:
// top 回退成 auto,＋ 号的竖线掉到横线下方,放大按钮渲染成一个「T」。
// 全仓一次扫出 27 个文件 60 处,涉及 top/right/bottom/left/margin-* —— 全是位置和间距。
// 负值的正确写法只有 calc(var(--x) * -1)。
const NEG_VAR = /(?<![\w)])-var\(--[a-z0-9-]+\)/g

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.wxss')) out.push(p)
  }
  return out
}

test('wxss 里不得出现 -var(--x):CSS 会丢掉整条声明', () => {
  const roots = ['pages', 'components', 'style', 'subpackageA', 'subpackageB', 'subpackageP3']
    .map((d) => path.join(ROOT, d))
    .filter((d) => fs.existsSync(d))

  const hits = []
  for (const file of roots.flatMap((d) => walk(d))) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const m of line.match(NEG_VAR) || []) {
        hits.push(`${path.relative(ROOT, file)}:${i + 1} ${m} —— 应写成 calc(var(...) * -1)`)
      }
    })
  }

  assert.deepEqual(hits, [], `\n${hits.join('\n')}\n`)
})
