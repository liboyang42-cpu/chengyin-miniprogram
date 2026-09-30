'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  assertBorrowContract,
  assertPngArtifact,
  parseBorrowEndpoint,
} = require('../automator/p2-motion-visual')

const PROJECT = path.resolve(__dirname, '../..')
const HEAD = '133c62f0d4e78db496efba071574550d5cc88f67'
const DRIVER_SOURCE = fs.readFileSync(path.resolve(__dirname, '../automator/p2-motion-visual.js'), 'utf8')

test('P2 动效驱动只接受显式 9787 loopback WebSocket，缺失或漂移必须红', () => {
  assert.deepEqual(parseBorrowEndpoint('ws://127.0.0.1:9787'), {
    endpoint: 'ws://127.0.0.1:9787',
    port: 9787,
  })
  assert.throws(() => parseBorrowEndpoint(), /WS_ENDPOINT/)
  assert.throws(() => parseBorrowEndpoint('ws://127.0.0.1:9788'), /9787/)
  assert.throws(() => parseBorrowEndpoint('ws://localhost:9787'), /127\.0\.0\.1/)
})

test('借用现有 DevTools 前必须同时锁住 project、HEAD 与 port', () => {
  const lease = { projectPath: PROJECT, sourceSha: HEAD, port: 9787 }
  assert.deepEqual(assertBorrowContract({
    wsEndpoint: 'ws://127.0.0.1:9787',
    projectPath: PROJECT,
    head: HEAD,
    lease,
  }), lease)

  assert.throws(() => assertBorrowContract({
    wsEndpoint: 'ws://127.0.0.1:9787',
    projectPath: PROJECT,
    head: HEAD,
    lease: Object.assign({}, lease, { projectPath: path.dirname(PROJECT) }),
  }), /project/i)
  assert.throws(() => assertBorrowContract({
    wsEndpoint: 'ws://127.0.0.1:9787',
    projectPath: PROJECT,
    head: HEAD,
    lease: Object.assign({}, lease, { sourceSha: '0'.repeat(40) }),
  }), /HEAD/i)
})

test('截图门只做 PNG 文件和像素尺寸基础检查，不把脚本判断冒充目检', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-motion-png-'))
  const valid = path.join(dir, 'valid.png')
  const tiny = path.join(dir, 'tiny.png')
  const invalid = path.join(dir, 'invalid.png')

  function fakePng(file, width, height) {
    const bytes = Buffer.alloc(2048)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0)
    bytes.write('IHDR', 12, 'ascii')
    bytes.writeUInt32BE(width, 16)
    bytes.writeUInt32BE(height, 20)
    fs.writeFileSync(file, bytes)
  }

  fakePng(valid, 375, 812)
  fakePng(tiny, 1, 1)
  fs.writeFileSync(invalid, Buffer.alloc(2048))

  const evidence = assertPngArtifact(valid)
  assert.equal(evidence.width, 375)
  assert.equal(evidence.height, 812)
  assert.equal(evidence.bytes, 2048)
  assert.match(evidence.sha256, /^[0-9a-f]{64}$/)
  assert.throws(() => assertPngArtifact(tiny), /像素尺寸/)
  assert.throws(() => assertPngArtifact(invalid), /PNG/)
})

test('关注 pending 截图必须有稳定窗口，并在截图返回后再次证明成功尚未兑现', () => {
  const harnessStart = DRIVER_SOURCE.indexOf('async function installFollowHarness')
  const flowStart = DRIVER_SOURCE.indexOf('async function runFollowFlow')
  const mainStart = DRIVER_SOURCE.indexOf('async function main')
  assert.ok(harnessStart >= 0 && flowStart > harnessStart && mainStart > flowStart)
  const harnessSource = DRIVER_SOURCE.slice(harnessStart, flowStart)
  const flowSource = DRIVER_SOURCE.slice(flowStart, mainStart)
  assert.ok(harnessSource.includes("url === '/api/user/follow/action'"))
  assert.ok(harnessSource.includes('delay = 1500'),
    '关注成功 mock 必须留出足够截图桥完成的稳定窗口')

  const captureAt = flowSource.indexOf("'follow.pending', '07-follow-pending.png'")
  const rereadAt = flowSource.indexOf('const pendingAfterCapture = await profile.data()')
  const stableAssertAt = flowSource.indexOf("'follow.pending-frame-stable'")
  const successWaitAt = flowSource.indexOf("'关注成功终态'")
  assert.ok(captureAt >= 0 && rereadAt > captureAt && stableAssertAt > rereadAt,
    '截图完成后必须再次回读 pending，不能只在截图前断言')
  assert.ok(successWaitAt > stableAssertAt, 'pending 图之后仍必须等待真实成功终态')
  assert.ok(flowSource.includes("4000,\n      '关注成功终态'"),
    '成功终态 timeout 必须覆盖 1500ms mock 延迟和截图开销')
  assert.ok(flowSource.includes('requestDelayMs: 1500'),
    'manifest 必须如实记录新的受控延迟')
})

test('关注夹具必须在导航前接管初始化读请求，未知请求不得触网', () => {
  const harnessStart = DRIVER_SOURCE.indexOf('async function installFollowHarness')
  const flowStart = DRIVER_SOURCE.indexOf('async function runFollowFlow')
  const mainStart = DRIVER_SOURCE.indexOf('async function main')
  const harnessSource = DRIVER_SOURCE.slice(harnessStart, flowStart)
  const flowSource = DRIVER_SOURCE.slice(flowStart, mainStart)

  for (const url of [
    '/api/common/banner',
    '/api/merchant/public-home',
    '/api/user/public-info',
    '/api/creativesquare/list',
    '/api/user/follow/action',
  ]) {
    assert.ok(harnessSource.includes(url), `受控夹具缺少 ${url}`)
  }
  assert.ok(harnessSource.includes('state.unexpected.push(url)'), '未知请求必须留下证据')
  assert.doesNotMatch(harnessSource, /originalSendRequest\.call\(/,
    '完整夹具期间未知请求不得回落真实网络')
  assert.ok(flowSource.indexOf('await installFollowHarness(mp)')
    < flowSource.indexOf("reLaunchVerified(mp, '/pages/userinfo/userinfo?userId=88'"),
  'follow fixture 必须在 reLaunch 前安装')
  assert.ok(flowSource.includes("'follow.mock-contract'"))
  assert.ok(flowSource.includes('unexpected.length === 0'), '终态必须断言无未知请求')
})
