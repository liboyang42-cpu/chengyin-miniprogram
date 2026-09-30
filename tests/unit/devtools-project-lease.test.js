const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  assertProjectLease,
  leasePathForPort,
  readProjectLease,
  writeProjectLease,
} = require('../../scripts/lib/devtools-project-lease')

test('DevTools 端口租约只允许同一 project、同一 HEAD 复用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-devtools-lease-'))
  const expected = {
    projectPath: '/tmp/worktree-a/chengyinhub-xcx',
    sourceSha: 'a'.repeat(40),
    port: 9624,
  }
  writeProjectLease(expected, { directory: dir })
  assert.deepEqual(readProjectLease(9624, { directory: dir }), expected)
  assert.deepEqual(assertProjectLease(expected, expected), expected)

  assert.throws(
    () => assertProjectLease(expected, { ...expected, projectPath: '/tmp/worktree-b/chengyinhub-xcx' }),
    /project 不匹配/,
  )
  assert.throws(
    () => assertProjectLease(expected, { ...expected, sourceSha: 'b'.repeat(40) }),
    /HEAD 不匹配/,
  )
  assert.throws(
    () => assertProjectLease(expected, { ...expected, port: 9625 }),
    /端口不匹配/,
  )

  fs.rmSync(dir, { recursive: true, force: true })
})

test('缺失或损坏租约不得把任意 DevTools 实例当成当前项目', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-devtools-lease-bad-'))
  assert.equal(readProjectLease(9624, { directory: dir }), null)
  fs.writeFileSync(leasePathForPort(9624, { directory: dir }), '{broken')
  assert.throws(() => readProjectLease(9624, { directory: dir }), /租约损坏/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('截图矩阵复用端口前必须核对租约，成功启动后登记当前 project 与 HEAD', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/_infra.js'), 'utf8')
  assert.match(source, /readProjectLease\(PORT\)/)
  assert.match(source, /assertProjectLease\(projectLease, existingLease\)/)
  assert.match(source, /writeProjectLease\(projectLease\)/)
})
