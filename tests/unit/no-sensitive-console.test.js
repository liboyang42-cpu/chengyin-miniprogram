const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const ENTRY_PATHS = ['app.js', 'pages', 'components', 'subpackageA', 'subpackageP3', 'subpackageRoam', 'utils']
const SKIP_DIRS = new Set(['ec-canvas', 'miniprogram_npm', 'tests', 'scripts'])

function jsFiles(entry) {
  const absolute = path.join(ROOT, entry)
  if (!fs.existsSync(absolute)) return []
  const stat = fs.statSync(absolute)
  if (stat.isFile()) return absolute.endsWith('.js') ? [absolute] : []
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(item => {
    if (item.isDirectory() && SKIP_DIRS.has(item.name)) return []
    return jsFiles(path.relative(ROOT, path.join(absolute, item.name)))
  })
}

test('生产代码 console 只能输出固定标签，禁止异常/响应/身份等动态值进入开发者日志', () => {
  const violations = []
  for (const file of ENTRY_PATHS.flatMap(jsFiles)) {
    const relative = path.relative(ROOT, file)
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      const source = line.trim()
      if (!source || source.startsWith('//') || !/console\.(?:log|warn|error|info|debug)\s*\(/.test(source)) return
      // 固定字符串标签可用于定位故障；任何第二参数、拼接或对象都可能把 URL、token、
      // openid、手机号、服务端响应或堆栈带进微信开发者日志。
      if (!/console\.(?:log|warn|error|info|debug)\s*\(\s*(['"])(?:\\.|(?!\1).)*\1\s*\)\s*;?/.test(source)) {
        violations.push(`${relative}:${index + 1}`)
      }
    })
  }
  assert.deepEqual(violations, [], `发现动态 console 输出:\n${violations.join('\n')}`)
})
