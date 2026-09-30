/* WXSS 不是 CSS —— 有几类选择器它直接编译不过,而仓里的 lint 和单测都查不出来:
 * 只有把项目真编译一次才会炸,而那时候人已经在等截图了。
 *
 * 2026-09-16 实证:抽卡按钮的三尖角流光用了 `.dk__ch > * + *`,
 * ui-integrity / js-scope 全绿、单测全绿,开发者工具一编译:
 *   ./pages/play/components/playkit-random/index.wxss(130:11): error at token `*`
 * 连带整个渲染层起不来(__route__ is not defined),那一轮截图全废。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

function wxssFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'miniprogram_npm' || name === '.git') continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) wxssFiles(full, out)
    else if (name.endsWith('.wxss')) out.push(full)
  }
  return out
}

/** 抹掉块注释但保住行号 —— 注释里的 `*` 满地都是,不抹就全是假阳性 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 选择器里的通配符(不是 calc 里的乘号,也不是注释) */
function scanWildcard(files) {
  const hits = []
  for (const file of files) {
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('{')) return
      const selector = line.split('{')[0]
      if (/(^|[\s,>+~])\*([\s,>+~]|$)/.test(selector)) {
        hits.push(path.relative(ROOT, file) + ':' + (i + 1))
      }
    })
  }
  return hits
}

const FILES = wxssFiles(ROOT)

test('扫描分母正常:全仓 wxss 必须都被看到', () => {
  assert.ok(FILES.length > 100, '只扫到 ' + FILES.length + ' 个 wxss,扫描根多半错了')
})

test('★WXSS 里不许出现通配符选择器 —— 它编译不过,而且会把整个渲染层带崩', () => {
  assert.deepEqual(scanWildcard(FILES), [],
    '把 `*` 换成写死的类名(`:nth-child` 在组件 wxss 里同样不保险)')
})

test('负控:注入一条 `> * + *` 必须判红', () => {
  const tmp = path.join(require('node:os').tmpdir(), 'wxss-wildcard-negative-control.wxss')
  fs.writeFileSync(tmp, '.a { color: red; }\n.a > * + * { margin-left: -8rpx; }\n')
  try {
    assert.equal(scanWildcard([tmp]).length, 1, '负控构造失败:通配符没被判出来')
  } finally {
    fs.unlinkSync(tmp)
  }
})

test('负控:calc 里的乘号不能被误判成通配符', () => {
  const tmp = path.join(require('node:os').tmpdir(), 'wxss-wildcard-false-positive.wxss')
  fs.writeFileSync(tmp, '.a { width: calc(100% - 2 * 16rpx); }\n')
  try {
    assert.deepEqual(scanWildcard([tmp]), [], 'calc 里的乘号被误判了,门禁会天天报假警')
  } finally {
    fs.unlinkSync(tmp)
  }
})
