const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const XCX_ROOT = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(XCX_ROOT, '..')
const LINTER = path.join(XCX_ROOT, 'scripts/js-scope-lint.js')

function run(...args) {
  return spawnSync(process.execPath, ['--expose-internals', LINTER, ...args], {
    cwd: XCX_ROOT,
    encoding: 'utf8',
  })
}

test('作用域门禁先跑红绿自证，再扫描全部生产 JS', () => {
  const selftest = run('--selftest')
  assert.equal(selftest.status, 0, selftest.stderr)
  assert.match(selftest.stdout, /SELFTEST PASS/)

  const scan = run()
  assert.equal(scan.status, 0, scan.stderr)
  assert.match(scan.stdout, /未解析标识符 0，不存在导出 0/)
})

test('作用域门禁已接入共用 xcx-check，不能只躺在仓库里', () => {
  const ci = fs.readFileSync(path.join(REPO_ROOT, 'ci/xcx-check.sh'), 'utf8')
  assert.match(ci, /js-scope-lint\.js" --selftest/)
  assert.match(ci, /js-scope-lint\.js"; then/)

  const packageJson = JSON.parse(fs.readFileSync(path.join(XCX_ROOT, 'package.json'), 'utf8'))
  assert.equal(packageJson.scripts['lint:scope'], 'node --expose-internals scripts/js-scope-lint.js')
  assert.equal(packageJson.scripts['lint:scope:selftest'], 'node --expose-internals scripts/js-scope-lint.js --selftest')
})
