'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const {
  aggregateActionEvidence,
  actionLocatorFingerprint,
  assertNoSensitiveEvidence,
  fixtureDigest,
  mergeFragments,
  provenanceGeneration,
  redactEvidence,
  validateAuthorityReceipt,
  validateAuthorityEvidence,
  validateBranchReceipt,
  validateFixture,
  validateActionLocator,
  writeFragment,
} = require('../../scripts/uiaudit/action-evidence-store')

const action = {
  id: 'pages/test/index.wxml:1:bindtap:save:0',
  route: 'pages/test/index',
  entry: { wxml: 'pages/test/index.wxml', js: 'pages/test/index.js' },
  control: { selectorHint: '.save', event: 'bindtap', handler: 'save', line: 1 },
  interactionMode: 'tap',
  baseActionClass: 'write',
  requiredBranches: ['success', 'error'],
  targets: {
    apis: ['/api/test/save'], primaryApis: ['/api/test/save'],
    apiContracts: [{ url: '/api/test/save', method: 'POST', auth: 'authenticated' }],
  },
}
const fixture = {
  id: 'synthetic-player-01', accountRole: 'player', networkProfile: 'wifi-controlled',
  backendMode: 'isolated-test', synthetic: true,
  entry: { route: 'pages/test/index', query: { id: 'fixture-42' } },
  locator: {
    selector: '.save', index: 0, componentPath: null, componentHostPath: null,
    actionFingerprint: actionLocatorFingerprint(action),
    expectedText: null, instance: null,
  },
  controlPlane: null,
  branchFaults: null,
}

function fragment(branch) {
  return {
    schemaVersion: 1, actionId: action.id, branch,
    sourceSha: 'a'.repeat(40), sourceDigest: 'b'.repeat(64),
    verifiedAt: `2026-08-21T12:00:0${branch === 'success' ? 1 : 2}Z`,
    fixture, fixtureDigest: fixtureDigest(fixture), artifacts: [{ uri: `${branch}.png`, sha256: 'c'.repeat(64) }],
    fixtureAttestation: {
      fixtureId: fixture.id, synthetic: true, accountRole: fixture.accountRole,
      identityFingerprint: 'sha256:test-account', backendBase: 'isolated-test', backendDeploymentSha: 'd'.repeat(40),
      assertions: ['identity matched'],
    },
    readback: { assertions: [`${branch} observed`] },
  }
}
const attestation = fragment('success').fixtureAttestation

test('分支证据按 action/source/fixture 累积，缺分支不冒充 passed', () => {
  const options = { skipFileValidation: true }
  assert.deepEqual(aggregateActionEvidence(action, [fragment('success')], options), { complete: false, missing: ['error'] })
  const complete = aggregateActionEvidence(action, [fragment('success'), fragment('error')], options)
  assert.equal(complete.complete, true)
  assert.deepEqual(complete.evidence.branches, ['success', 'error'])
  assert.equal(complete.evidence.observations.length, 2)
  assert.throws(() => aggregateActionEvidence(action, [fragment('success'), fragment('success')], options), /重复片段/)
})

test('不可变片段 + 锁 + 临时文件 rename 汇总，不直接并发覆盖 overlay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'action-evidence-store-'))
  fs.mkdirSync(path.join(root, 'scripts/uiaudit'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts/uiaudit/action-evidence.json'), '{"schemaVersion":1,"results":{}}\n')
  fs.mkdirSync(path.join(root, 'tests/automator'), { recursive: true })
  const runnerFile = path.join(root, 'tests/automator/action-evidence-runner.js')
  fs.writeFileSync(runnerFile, 'test runner\n')
  const toolFiles = {
    fixtureDriver: 'tests/automator/fixtures/test.js',
    branchDriver: 'tests/automator/branches/test.js',
    readbackAdapter: 'tests/automator/readbacks/test.js',
  }
  Object.values(toolFiles).forEach((uri) => {
    fs.mkdirSync(path.dirname(path.join(root, uri)), { recursive: true })
    fs.writeFileSync(path.join(root, uri), `${uri}\n`)
  })
  const materialize = (branch) => {
    const value = fragment(branch)
    const artifactDir = path.join(root, 'scripts/uiaudit/evidence/artifacts')
    fs.mkdirSync(artifactDir, { recursive: true })
    const artifactToken = crypto.createHash('sha256').update([
      action.id, branch, value.fixtureDigest, value.sourceSha,
    ].join('\0')).digest('hex').slice(0, 24)
    value.artifacts = ['before', 'after'].map((name) => {
      const uri = `scripts/uiaudit/evidence/artifacts/${artifactToken}-${branch}-test-${name}.png`
      const content = Buffer.concat([
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      ])
      fs.writeFileSync(path.join(root, uri), content)
      return { uri, sha256: crypto.createHash('sha256').update(content).digest('hex') }
    })
    value.provenance = {
      runner: 'tests/automator/action-evidence-runner.js',
      runnerSha256: crypto.createHash('sha256').update(fs.readFileSync(runnerFile)).digest('hex'),
      transport: 'miniprogram-automator Element.tap',
      fixtureDriver: toolFiles.fixtureDriver,
      fixtureDriverSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, toolFiles.fixtureDriver))).digest('hex'),
      branchDriver: branch === 'error' ? toolFiles.branchDriver : null,
      branchDriverSha256: branch === 'error'
        ? crypto.createHash('sha256').update(fs.readFileSync(path.join(root, toolFiles.branchDriver))).digest('hex') : null,
      readbackAdapter: toolFiles.readbackAdapter,
      readbackAdapterSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, toolFiles.readbackAdapter))).digest('hex'),
    }
    value.fixtureDigest = fixtureDigest(value.fixture)
    value.generation = provenanceGeneration(value.provenance)
    if (branch === 'error') {
      value.readback = {
        actionId: action.id, branch, fixtureId: fixture.id, assertions: ['server unchanged'],
        observed: { errorCode: 'TEST_FAILURE' },
        uiEffect: { assertions: { failure: { branch: 'error', expected: { data: { saving: false } } } } },
        authoritativeReadback: {
          actionId: action.id, fixtureId: fixture.id,
          request: { method: 'POST', url: '/api/test/save', resourceId: '42', authMode: 'jwt-test' },
          expectedRequest: { method: 'POST', urlTemplate: '/api/test/save' },
          accessScope: {
            principalFingerprint: 'sha256:test-account', role: 'player',
            ownerFingerprint: 'sha256:test-account', scope: 'self', scopeVerified: true, decision: 'allowed',
          },
          authority: { endpoint: '/api/test/42', resourceId: '42', before: { status: 0 }, after: { status: 0 } },
          assertions: ['unchanged'],
        },
      }
    } else {
      value.readback = {
        authoritativeReadback: {
          actionId: action.id, fixtureId: fixture.id,
          request: { method: 'POST', url: '/api/test/save', resourceId: '42', authMode: 'jwt-test' },
          expectedRequest: { method: 'POST', urlTemplate: '/api/test/save' },
          accessScope: {
            principalFingerprint: 'sha256:test-account', role: 'player',
            ownerFingerprint: 'sha256:test-account', scope: 'self', scopeVerified: true, decision: 'allowed',
          },
          authority: { endpoint: '/api/test/42', resourceId: '42', before: { status: 0 }, after: { status: 1 } },
          assertions: ['changed'],
        },
      }
    }
    return value
  }
  const success = materialize('success')
  const error = materialize('error')
  writeFragment(root, success)
  assert.throws(() => writeFragment(root, success), /拒绝静默覆盖/)
  writeFragment(root, error)
  const overlay = mergeFragments(root, { controls: [action] }, () => [])
  assert.equal(overlay.results[action.id].status, 'passed')
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(root, 'scripts/uiaudit/action-evidence.json'))))
  const externalAction = { id: 'external-action', actionClass: 'external', requiredBranches: [] }
  const blockedAction = { id: 'blocked-action', actionClass: 'state', requiredBranches: [] }
  const withManual = JSON.parse(fs.readFileSync(path.join(root, 'scripts/uiaudit/action-evidence.json')))
  withManual.results[externalAction.id] = { status: 'passed', marker: 'manual-device-evidence' }
  withManual.results[blockedAction.id] = { status: 'blocked', marker: 'approved-external-gate' }
  fs.writeFileSync(path.join(root, 'scripts/uiaudit/action-evidence.json'), JSON.stringify(withManual))
  const preserved = mergeFragments(root, { controls: [action, externalAction, blockedAction] }, () => [])
  assert.equal(preserved.results[externalAction.id].marker, 'manual-device-evidence')
  assert.equal(preserved.results[blockedAction.id].marker, 'approved-external-gate')
  fs.writeFileSync(path.join(root, 'scripts/uiaudit/action-evidence.json.lock'), JSON.stringify({
    pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString(),
  }))
  assert.throws(() => mergeFragments(root, { controls: [action] }, () => []), /锁已被占用/)
  fs.unlinkSync(path.join(root, 'scripts/uiaudit/action-evidence.json.lock'))
  fs.writeFileSync(path.join(root, 'scripts/uiaudit/action-evidence.json.lock'), JSON.stringify({
    pid: 999999, host: os.hostname(), createdAt: '2026-08-20T00:00:00Z',
  }))
  assert.doesNotThrow(() => mergeFragments(root, { controls: [action] }, () => []))

  fs.writeFileSync(runnerFile, 'test runner generation 2\n')
  const success2 = materialize('success')
  const error2 = materialize('error')
  assert.notEqual(success2.generation, success.generation)
  writeFragment(root, success2)
  writeFragment(root, error2)
  const regenerated = mergeFragments(root, { controls: [action] }, () => [])
  assert.equal(regenerated.results[action.id].observations[0].generation, success2.generation)
  fs.rmSync(root, { recursive: true, force: true })
})

test('证据强制受控 fixture，并脱敏 token/手机号/邮箱', () => {
  assert.deepEqual(validateFixture(fixture), fixture)
  assert.throws(() => validateFixture({ ...fixture, synthetic: false }), /synthetic=true/)
  const safe = redactEvidence({
    Authorization: 'abc123SECRET',
    note: '13800138000 a@b.com token=abc123SECRET openid=openidValue123 password=hunter2 secret=abc123SECRET cookie=JSESSIONID=abc123 session=sessionValue123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature123',
  })
  assert.equal(safe.Authorization, '[REDACTED]')
  assert.doesNotMatch(safe.note, /13800138000|a@b\.com|abc123SECRET|openidValue123|hunter2|JSESSIONID|sessionValue123|eyJ/)
  assert.doesNotThrow(() => assertNoSensitiveEvidence(safe))
  assert.throws(() => assertNoSensitiveEvidence({ note: 'Bearer abc.def' }), /敏感信息/)
  assert.throws(() => assertNoSensitiveEvidence({ note: 'unionid=unionValue123' }), /敏感信息/)
})

test('组件动作 fixture 必须绑定静态可达的宿主实例链，不能借同页其它组件出证', () => {
  const componentAction = {
    ...action,
    id: 'components/cy/a/index.wxml:1:bindtap:save:0',
    route: 'component:components/cy/a/index',
    hostRoutes: ['pages/test/host'],
    hostComponentPaths: [{ route: 'pages/test/host', segments: [{ selector: '#component-a', index: 0 }] }],
  }
  const componentFixture = validateFixture({
    ...fixture,
    entry: { route: 'pages/test/host', query: {} },
    locator: {
      ...fixture.locator,
      componentPath: 'components/cy/a/index',
      componentHostPath: [{ selector: '#component-a', index: 0 }],
      actionFingerprint: actionLocatorFingerprint(componentAction),
    },
  })
  assert.doesNotThrow(() => validateActionLocator(componentAction, componentFixture))
  assert.throws(() => validateActionLocator(componentAction, {
    ...componentFixture,
    locator: { ...componentFixture.locator, componentHostPath: [{ selector: '#component-b', index: 0 }] },
  }), /宿主实例链/)
})

test('服务端回读必须绑定 action、API、资源 ID 与前后权威事实', () => {
  const receipt = {
    actionId: action.id, fixtureId: fixture.id,
    request: { method: 'POST', url: '/api/test/save', resourceId: '42', authMode: 'jwt-test' },
    expectedRequest: { method: 'POST', urlTemplate: '/api/test/save' },
    accessScope: {
      principalFingerprint: 'sha256:test-account', role: 'player', ownerFingerprint: 'sha256:test-account',
      scope: 'self', scopeVerified: true, decision: 'allowed',
    },
    authority: { endpoint: '/api/test/detail/42', resourceId: '42', before: { status: 0 }, after: { status: 1 } },
    assertions: ['status 由 0 变 1'],
  }
  assert.equal(validateAuthorityReceipt(action, receipt, 'write', 'success', attestation), receipt)
  assert.throws(() => validateAuthorityReceipt({ ...action, accessBoundary: 'self' }, {
    ...receipt,
    accessScope: {
      ...receipt.accessScope, ownerFingerprint: 'sha256:another-account', decision: 'denied',
    },
  }, 'write', 'success', attestation), /success.*allowed|self.*owner/i)
  assert.throws(() => validateAuthorityReceipt(action, { ...receipt, actionId: 'other' }, 'write', 'success', attestation), /actionId/)
  assert.throws(() => validateAuthorityReceipt({ ...action, targets: { apis: [] } }, receipt, 'write', 'success', attestation), /API 真源/)
  assert.throws(() => validateAuthorityReceipt(action, {
    ...receipt, request: { ...receipt.request, url: '/api/other' },
  }, 'write', 'success', attestation), /不在动作 API/)
  assert.throws(() => validateAuthorityReceipt(action, {
    ...receipt, request: { ...receipt.request, method: 'GET', authMode: 'anonymous' },
  }, 'write', 'success', attestation), /method|anonymous/)
  assert.throws(() => validateAuthorityReceipt(action, {
    ...receipt, authority: { ...receipt.authority, after: { status: 0 } },
  }, 'write', 'success', attestation), /没有变化/)
  assert.doesNotThrow(() => validateAuthorityReceipt(action, {
    ...receipt, authority: { ...receipt.authority, after: { status: 0 } },
  }, 'write', 'error', attestation))
  assert.throws(() => validateAuthorityReceipt(action, receipt, 'write', 'error', attestation), /不应有/)
  assert.throws(() => validateAuthorityReceipt(action, receipt, 'write', 'timeout', attestation), /确定终态/)
})

test('外部能力在请求前取消时必须证明 not-called 与权威资源未变化', () => {
  const noRequest = {
    actionId: action.id, fixtureId: fixture.id,
    request: {
      url: '/api/test/save', method: 'POST', resourceId: '42', authMode: 'jwt-test', observed: false,
    },
    expectedRequest: { urlTemplate: '/api/test/save', method: 'POST' },
    authority: { endpoint: '/api/test/detail/42', resourceId: '42', before: { saved: false }, after: { saved: false } },
    accessScope: {
      principalFingerprint: 'sha256:test-account', ownerFingerprint: 'sha256:test-account', role: 'player',
      scope: 'self', scopeVerified: true, decision: 'allowed',
    },
    assertions: ['请求 trace 为 0，资源前后未变化'],
  }
  assert.equal(validateAuthorityReceipt(action, noRequest, 'write', 'not-called', attestation), noRequest)
  assert.throws(() => validateAuthorityReceipt(action, {
    ...noRequest, request: { ...noRequest.request, observed: true },
  }, 'write', 'not-called', attestation), /请求未发出/)
  assert.throws(() => validateAuthorityReceipt(action, {
    ...noRequest, authority: { ...noRequest.authority, after: { saved: true } },
  }, 'write', 'not-called', attestation), /权威资源未变化/)
})

test('异常、超时、重复、取消和拒权分支不能只写一句人工结论', () => {
  const base = { actionId: action.id, fixtureId: fixture.id, assertions: ['受控故障已命中'] }
  assert.throws(() => validateBranchReceipt(action, 'error', { ...base, branch: 'error', observed: {} }, fixture), /errorCode/)
  assert.throws(() => validateBranchReceipt(action, 'timeout', {
    ...base, branch: 'timeout', observed: { timedOut: true, aborted: false, elapsedMs: 15000 },
  }, fixture), /aborted=true/)
  assert.throws(() => validateBranchReceipt(action, 'duplicate-trigger', {
    ...base, branch: 'duplicate-trigger', observed: { triggerCount: 2, sideEffectCount: 2 },
  }, fixture), /至多 1 次/)
  assert.doesNotThrow(() => validateBranchReceipt(action, 'duplicate-trigger', {
    ...base, branch: 'duplicate-trigger', observed: { triggerCount: 2, sideEffectCount: 1 },
  }, fixture))
  const checkout = { ...action, requiredCapabilityByBranch: { 'payment-cancelled': 'requestPayment' } }
  assert.throws(() => validateBranchReceipt(checkout, 'payment-cancelled', {
    ...base, branch: 'payment-cancelled', observed: { outcome: 'cancelled', capability: 'requestSubscribeMessage' },
  }, fixture), /requestPayment/)
  assert.doesNotThrow(() => validateBranchReceipt(checkout, 'payment-cancelled', {
    ...base, branch: 'payment-cancelled', observed: { outcome: 'cancelled', capability: 'requestPayment' },
  }, fixture))
})

test('复合写区分首步失败与后步失败，并绑定同一 eventId 链路', () => {
  const compound = {
    ...action,
    requiredRequests: [
      { urlTemplate: '/api/test/publish', method: 'POST' },
      { urlTemplate: '/api/test/broadcast', method: 'POST' },
    ],
    requiredRequestOutcomes: {
      'publish-error': ['error'],
      'broadcast-error-after-publish': ['success', 'error'],
    },
    requiredAuthorityLinks: [{
      fromIndex: 0, fromPath: 'authority.after.id', toIndex: 1, toPath: 'request.parentResourceId',
    }],
    targets: {
      apis: ['/api/test/publish', '/api/test/broadcast'],
      primaryApis: ['/api/test/publish', '/api/test/broadcast'],
      apiContracts: [
        { url: '/api/test/publish', method: 'POST' },
        { url: '/api/test/broadcast', method: 'POST' },
      ],
    },
  }
  const receipt = (url, before, after, extraRequest = {}) => ({
    actionId: compound.id, fixtureId: fixture.id,
    request: { method: 'POST', url, resourceId: 'event-42', authMode: 'jwt-test', ...extraRequest },
    expectedRequest: { method: 'POST', urlTemplate: url },
    accessScope: {
      principalFingerprint: 'sha256:test-account', role: 'player', ownerFingerprint: 'sha256:test-account',
      scope: 'self', scopeVerified: true, decision: 'allowed',
    },
    authority: { endpoint: `${url}/event-42`, resourceId: 'event-42', before, after },
    assertions: ['权威事实已回读'],
  })
  assert.doesNotThrow(() => validateAuthorityEvidence(compound, {
    sequence: [receipt('/api/test/publish', { status: 0 }, { status: 0 })],
  }, 'write', 'publish-error', attestation))
  assert.doesNotThrow(() => validateAuthorityEvidence(compound, {
    sequence: [
      receipt('/api/test/publish', { status: 0 }, { status: 1, id: 'event-42' }),
      receipt('/api/test/broadcast', { sent: 0 }, { sent: 0 }, { parentResourceId: 'event-42' }),
    ],
  }, 'write', 'broadcast-error-after-publish', attestation))
  assert.throws(() => validateAuthorityEvidence(compound, {
    sequence: [
      receipt('/api/test/publish', { status: 0 }, { status: 1, id: 'event-42' }),
      receipt('/api/test/broadcast', { sent: 0 }, { sent: 0 }, { parentResourceId: 'event-other' }),
    ],
  }, 'write', 'broadcast-error-after-publish', attestation), /同一业务资源/)
})

test('并发复合写必须由受控请求 trace 证明真实重叠，串行回执不能冒充 parallel', () => {
  const parallel = {
    ...action,
    requestMode: 'parallel',
    requiredRequests: [
      { urlTemplate: '/api/test/decor', method: 'POST', kind: 'write' },
      { urlTemplate: '/api/test/brand', method: 'POST', kind: 'write' },
    ],
    requiredRequestOutcomes: { success: ['success', 'success'] },
    targets: {
      apis: ['/api/test/decor', '/api/test/brand'],
      primaryApis: ['/api/test/decor', '/api/test/brand'],
      writeApis: ['/api/test/decor', '/api/test/brand'],
      apiContracts: [
        { url: '/api/test/decor', method: 'POST' },
        { url: '/api/test/brand', method: 'POST' },
      ],
    },
  }
  const receipt = (url) => ({
    actionId: parallel.id, fixtureId: fixture.id,
    request: { method: 'POST', url, resourceId: 'merchant-42', authMode: 'jwt-test' },
    expectedRequest: { method: 'POST', urlTemplate: url },
    accessScope: {
      principalFingerprint: 'sha256:test-account', role: 'player', ownerFingerprint: 'sha256:test-account',
      scope: 'self', scopeVerified: true, decision: 'allowed',
    },
    authority: { endpoint: `${url}/merchant-42`, resourceId: 'merchant-42', before: { v: 0 }, after: { v: 1 } },
    assertions: ['changed'],
  })
  const sequence = [receipt('/api/test/decor'), receipt('/api/test/brand')]
  const serialTrace = [
    { requestIndex: 0, requestId: 'req-a', url: '/api/test/decor', method: 'POST', startedAt: '2026-08-21T12:00:00.000Z', completedAt: '2026-08-21T12:00:01.000Z' },
    { requestIndex: 1, requestId: 'req-b', url: '/api/test/brand', method: 'POST', startedAt: '2026-08-21T12:00:01.100Z', completedAt: '2026-08-21T12:00:02.000Z' },
  ]
  assert.throws(() => validateAuthorityEvidence(parallel, { sequence, requestTrace: serialTrace }, 'write', 'success', attestation), /并发重叠/)
  const overlappingTrace = [
    serialTrace[0],
    { ...serialTrace[1], startedAt: '2026-08-21T12:00:00.500Z' },
  ]
  const duplicateRequestId = [overlappingTrace[0], { ...overlappingTrace[1], requestId: 'req-a' }]
  assert.throws(() => validateAuthorityEvidence(
    parallel, { sequence, requestTrace: duplicateRequestId }, 'write', 'success', attestation,
  ), /唯一 requestIndex\/requestId/)
  assert.doesNotThrow(() => validateAuthorityEvidence(parallel, { sequence, requestTrace: overlappingTrace }, 'write', 'success', attestation))
})

test('聚合证据不得拼接不同后端部署代次', () => {
  const success = fragment('success')
  const error = fragment('error')
  error.fixtureAttestation = { ...error.fixtureAttestation, backendDeploymentSha: 'e'.repeat(40) }
  assert.throws(() => aggregateActionEvidence(action, [success, error], { skipFileValidation: true }), /后端部署/)
})
