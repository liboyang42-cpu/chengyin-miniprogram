const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildLedger, discoverExternalHelperNames } = require('../../scripts/uiaudit/build-action-ledger')
let currentLedger
const ledger = () => currentLedger || (currentLedger = buildLedger())

test('台账按混入方法真实文件提取，保留剪贴板能力与状态选择', () => {
  const rows = ledger().controls.filter(row => row.entry.wxml === 'pages/club/topic-detail/index.wxml')
  const copy = rows.find(row => row.control.handler === 'copyPhone')
  assert.ok(copy.externalCapabilities.includes('setClipboardData'))
  assert.equal(copy.actionClass, 'external')
  assert.deepEqual(copy.requiredPlatforms, ['ios', 'android'])
  assert.ok(copy.requiredBranches.includes('timeout'))
  assert.ok(copy.requiredBranches.includes('duplicate-trigger'))
  const select = rows.find(row => row.control.handler === 'onIncidentSelect')
  assert.deepEqual(select.effectClasses, ['state'])
  for (const row of rows) {
    const name = row.control.handler
    if (['onIncidentSelect', 'onStartSession', 'onReconcileUnknownWrite', 'retryUnknownWrite'].includes(name)) {
      assert.match(row.evidence.staticSource, /^pages\/club\/topic-detail\/director\.js:\d+$/, name)
    }
  }
})

test('草稿重试保留真实写入合同，不因 draft 命名降成读取', () => {
  const row = ledger().controls.find(item => item.entry.wxml === 'pages/publish/temp/index.wxml'
    && item.control.handler === 'retrySubmit' && item.variant.id === 'draft')
  assert.ok(row.effectClasses.includes('write'))
  assert.deepEqual(row.targets.writeApis, ['/api/template/draft'])
  assert.ok(row.targets.apiContracts.some(api => api.url === '/api/template/draft' && api.method === 'POST'))
  assert.ok(row.requiredBranches.includes('forbidden-owner'))
  assert.ok(row.requiredBranches.includes('duplicate-trigger'))
})

test('导演台重试追踪 command 写入，核对只读取 receipt 与刷新 view', () => {
  const rows = ledger().controls.filter(row => row.entry.wxml === 'pages/club/topic-detail/index.wxml')
  const retry = rows.find(row => row.control.handler === 'retryUnknownWrite')
  assert.ok(retry.effectClasses.includes('write'))
  assert.deepEqual(retry.targets.writeApis, ['/api/game/session/command'])
  assert.ok(retry.requiredBranches.includes('forbidden-owner'))
  assert.ok(retry.requiredBranches.includes('duplicate-trigger'))
  const read = rows.find(row => row.control.handler === 'onReconcileUnknownWrite')
  assert.ok(read.effectClasses.includes('read'))
  assert.ok(!read.effectClasses.includes('write'))
  assert.deepEqual(read.targets.primaryApis, ['/api/game/session/receipt', '/api/game/session/view'])
  assert.deepEqual(read.targets.writeApis, [])
  assert.ok(read.targets.apiContracts.every(api => api.method === 'GET'))
  assert.ok(read.requiredBranches.includes('error'))
  assert.ok(read.requiredBranches.includes('timeout'))
})

test('真实反引号模板 URL 动作保留读写分类与分支，不因去污降成 state', () => {
  const cases = [
    ['pages/merchant/aftercare/detail/index.js', 'submitResponse', 'write', '/api/merchant/aftercare/respond'],
    ['pages/merchant/aftercare/index.js', 'switchBucket', 'read', '/api/merchant/aftercare/list'],
    ['pages/merchant/aftercare/index.js', 'loadMore', 'read', '/api/merchant/aftercare/list'],
    ['pages/merchant/customer/detail/index.js', 'removeTag', 'write', '/api/merchant/crm/customers/{param}/tags/remove'],
    ['pages/merchant/customer/detail/index.js', 'submitTag', 'write', '/api/merchant/crm/customers/{param}/tags'],
    ['pages/merchant/customer/detail/index.js', 'hideNote', 'write', '/api/merchant/crm/customers/{param}/notes/hide'],
    ['pages/merchant/customer/detail/index.js', 'submitNote', 'write', '/api/merchant/crm/customers/{param}/notes'],
    ['pages/merchant/customer/index.js', 'retryExportStatus', 'read', '/api/merchant/crm/exports/{param}/status'],
    ['pages/merchant/reviews/index.js', 'retry', 'read', '/api/merchant/reviews/manage'],
    ['pages/merchant/reviews/index.js', 'loadMore', 'read', '/api/merchant/reviews/manage'],
  ]
  for (const [js, handler, actionClass, url] of cases) {
    const hits = ledger().controls.filter(row => row.entry.js === js && row.control.handler === handler)
    assert.ok(hits.length, `${handler} 在台账中缺项`)
    for (const row of hits) {
      assert.equal(row.actionClass, actionClass, `${handler} 读写分类被降级`)
      assert.ok(row.targets.primaryApis.includes(url), `${handler} 缺真实模板 URL ${url}`)
      for (const branch of ['error', 'timeout', 'duplicate-trigger']) {
        assert.ok(row.requiredBranches.includes(branch), `${handler} 缺 ${branch} 分支`)
      }
      if (actionClass === 'write') {
        assert.ok(row.requiredBranches.includes('forbidden-owner'), `${handler} 缺 forbidden-owner 分支`)
        assert.equal(row.accessBoundary, 'owned-resource', `${handler} 写归属边界`)
      }
    }
  }
})

test('四条商家写端点精确落入 writeApis，详情查询保留在 primaryApis 但不被当写', () => {
  const cases = [
    ['pages/merchant/aftercare/detail/index.js', 'submitResponse', '/api/merchant/aftercare/respond', '/api/merchant/aftercare/detail'],
    ['pages/merchant/customer/detail/index.js', 'submitTag', '/api/merchant/crm/customers/{param}/tags', '/api/merchant/crm/customers/{param}/detail'],
    ['pages/merchant/customer/detail/index.js', 'submitNote', '/api/merchant/crm/customers/{param}/notes', '/api/merchant/crm/customers/{param}/detail'],
    ['pages/merchant/customer/detail/index.js', 'hideNote', '/api/merchant/crm/customers/{param}/notes/hide', '/api/merchant/crm/customers/{param}/detail'],
  ]
  for (const [js, handler, writeUrl, readUrl] of cases) {
    const hits = ledger().controls.filter(row => row.entry.js === js && row.control.handler === handler)
    assert.ok(hits.length, `${handler} 在台账中缺项`)
    for (const row of hits) {
      assert.equal(row.actionClass, 'write', `${handler} 必须判写`)
      assert.deepEqual(row.targets.writeApis, [writeUrl], `${handler} writeApis 必须只含真实写端点`)
      assert.ok(row.targets.primaryApis.includes(writeUrl), `${handler} primaryApis 保留写端点`)
      assert.ok(row.targets.primaryApis.includes(readUrl), `${handler} 详情读取必须保留`)
      assert.ok(!row.targets.writeApis.includes(readUrl), `${handler} 详情读取不得冒充写`)
      assert.ok(row.requiredBranches.includes('forbidden-owner'), `${handler} 缺 forbidden-owner`)
      assert.ok(row.requiredBranches.includes('timeout'), `${handler} 缺 timeout`)
      assert.equal(row.accessBoundary, 'owned-resource', `${handler} 写归属边界`)
      const contract = row.targets.apiContracts.find(api => api.url === writeUrl)
      assert.equal(contract && contract.method, 'POST', `${handler} 写端点 method 合同`)
    }
  }
})

test('权威回读负控：绑定详情读端点冒充写被拒，绑定真实写端点被接受（实际 validator）', () => {
  const { validateAuthorityReceipt } = require('../../scripts/uiaudit/action-evidence-store')
  const attestation = { identityFingerprint: 'synthetic-principal', accountRole: 'merchant' }
  const receiptFor = (action, urlTemplate, actualUrl) => ({
    actionId: action.id,
    fixtureId: 'v8-synthetic-control',
    request: { method: 'POST', url: actualUrl, resourceId: '99', authMode: 'authenticated' },
    expectedRequest: { urlTemplate, method: 'POST' },
    authority: { endpoint: 'synthetic-only', resourceId: '99', before: { value: 1 }, after: { value: 2 } },
    assertions: ['synthetic-check'],
    accessScope: {
      principalFingerprint: attestation.identityFingerprint, role: 'merchant',
      ownerFingerprint: 'synthetic-owner', scope: 'customer:99', scopeVerified: true, decision: 'allowed',
    },
  })
  const cases = [
    ['pages/merchant/aftercare/detail/index.js', 'submitResponse', '/api/merchant/aftercare/respond', '/api/merchant/aftercare/respond?refundId=99', '/api/merchant/aftercare/detail', '/api/merchant/aftercare/detail?refundId=99'],
    ['pages/merchant/customer/detail/index.js', 'submitTag', '/api/merchant/crm/customers/{param}/tags', '/api/merchant/crm/customers/99/tags', '/api/merchant/crm/customers/{param}/detail', '/api/merchant/crm/customers/99/detail'],
    ['pages/merchant/customer/detail/index.js', 'submitNote', '/api/merchant/crm/customers/{param}/notes', '/api/merchant/crm/customers/99/notes', '/api/merchant/crm/customers/{param}/detail', '/api/merchant/crm/customers/99/detail'],
    ['pages/merchant/customer/detail/index.js', 'hideNote', '/api/merchant/crm/customers/{param}/notes/hide', '/api/merchant/crm/customers/99/notes/hide', '/api/merchant/crm/customers/{param}/detail', '/api/merchant/crm/customers/99/detail'],
  ]
  for (const [js, handler, writeTemplate, writeUrl, readTemplate, readUrl] of cases) {
    const action = ledger().controls.find(row => row.entry.js === js && row.control.handler === handler)
    assert.ok(action, `${handler} 在台账中缺项`)
    // 错误证据：把详情查询读端点绑定成写成功回读，必须被拒
    assert.throws(() => validateAuthorityReceipt(action, receiptFor(action, readTemplate, readUrl), 'write', 'success', attestation),
      /不在动作 API 真源中|未命中本次 fixture 声明/, `${handler} 详情读端点不得被接受为写`)
    // 真实写正控：绑定真实写端点且服务端状态变化，必须被接受
    assert.doesNotThrow(() => validateAuthorityReceipt(action, receiptFor(action, writeTemplate, writeUrl), 'write', 'success', attestation),
      `${handler} 真实写端点回读必须被接受`)
  }
})

test('聊天拉黑选项只打开确认，不混入举报和清空分支的导航或写入', () => {
  const row = ledger().controls.find(item => item.entry.wxml === 'subpackageB/pages/im/chat/index.wxml'
    && item.control.handler === 'onMoreSelect' && item.variant.id === 'block')
  assert.deepEqual(row.effectClasses, ['state'])
  assert.deepEqual(row.targets.primaryApis, [])
  assert.deepEqual(row.targets.routes, [])
})

test('聊天拉黑确认落库记为真实写入，不因 confirm 被 Danger 隔断降成读取', () => {
  const rows = ledger().controls.filter(row => row.entry.js === 'subpackageB/pages/im/chat/index.js')
  const confirm = rows.find(row => row.control.handler === 'onDangerConfirm')
  assert.ok(confirm, 'onDangerConfirm 在台账中缺项')
  assert.equal(confirm.actionClass, 'write')
  assert.deepEqual(confirm.targets.writeApis, ['/api/im/block'])
  assert.ok(confirm.targets.apiContracts.some(api => api.url === '/api/im/block' && api.method === 'POST'))
  assert.ok(confirm.requiredBranches.includes('forbidden-owner'))
  assert.equal(confirm.accessBoundary, 'owned-resource')
  const more = rows.find(row => row.control.handler === 'onMoreSelect' && row.variant.id === 'block')
  assert.deepEqual(more.effectClasses, ['state'])
  assert.deepEqual(more.targets.primaryApis, [])
})

test('导演台对账能力是保守传递闭包：loadProjection 合法可达 receipt，retryUnknownWrite 为 over-approx 候选', () => {
  const rows = ledger().controls.filter(row => row.entry.wxml === 'pages/club/topic-detail/index.wxml')
  const load = rows.find(row => row.control.handler === 'loadProjection')
  // init 存在未确认写入时 writeLocked/_unknownRequestId 为真，applyProjection 的 setData 回调
  // 会调用 onReconcileUnknownWrite → readReceipt，故 loadProjection 的 receipt 是合法传递能力。
  assert.ok(load.targets.primaryApis.includes('/api/game/session/receipt'))
  assert.ok(load.targets.primaryApis.includes('/api/game/session/view'))
  const retry = rows.find(row => row.control.handler === 'retryUnknownWrite')
  // primaryApis 是静态可达候选集合，不是本次点击实际发生清单。retryUnknownWrite 成功分支在
  // loadProjection 前已清 _unknownRequestId/writeLocked，守卫必假，receipt 属 over-approx 候选。
  assert.deepEqual(retry.targets.writeApis, ['/api/game/session/command'])
  assert.ok(retry.targets.primaryApis.includes('/api/game/session/receipt'),
    '保守闭包保留可达候选，不为通过复核裁剪真实请求')
})

test('基础玩法后的投影读取不能凭依赖文件混入游戏 command 写入', () => {
  const rows = ledger().controls.filter(row => row.entry.js === 'pages/play/index.js')
  // 2026-09-22 retryArrival 随底部读数卡的到达错误条一起删除,不再有可达入口。
  for (const name of ['photoGame', 'scanGame', 'submitGame', 'revealAnswer', 'onScanArrive']) {
    const matched = rows.filter(row => row.control.handler === name)
    assert.ok(matched.length, name)
    for (const row of matched) {
      assert.ok(row.targets.primaryApis.includes('/api/game/session/view'))
      assert.ok(!row.targets.primaryApis.includes('/api/game/session/command'), row.id)
      assert.equal(row.targets.writeApis.length, 1, row.id)
    }
  }
  assert.ok(rows.some(row => row.targets.writeApis.includes('/api/game/session/command')),
    '真实游戏指令入口必须保留写入合同')
  const photo = rows.find(row => row.control.handler === 'photoGame')
  assert.ok(photo.targets.primaryApis.includes('/api/play/photo'))
  assert.ok(photo.targets.primaryApis.includes('/api/common/uploadOSS'), '真实照片上传不能随白名单一起删除')
  assert.ok(photo.targets.primaryApis.includes('/api/club/lead/team-progress'), '实际完成回调的领队进度读取必须保留')
})

test('保存草稿按普通草稿与据点拒绝两条真实分支登记', () => {
  const rows = ledger().controls.filter(row => row.entry.js === 'pages/publish/temp/index.js'
    && row.control.handler === 'saveDraft')
  assert.equal(rows.length, 2)
  const draft = rows.find(row => row.variant.id === 'draft')
  assert.deepEqual(draft.targets.writeApis, ['/api/template/draft'])
  assert.deepEqual(draft.targets.primaryApis, ['/api/template/draft'])
  const blocked = rows.find(row => row.variant.id === 'citynode-unavailable')
  assert.deepEqual(blocked.targets.primaryApis, [])
  assert.ok(!blocked.effectClasses.includes('write'))
})

test('同一行的独立方法不互相截断或串入后续函数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-handler-source-'))
  try {
    const file = path.join(dir, 'index.js')
    fs.writeFileSync(file, "Page({noop(){return 1},copy(){wx.setClipboardData({data:'x'})},last(){return 2}}); function outside(){wx.getLocation({})}\n")
    assert.deepEqual([...discoverExternalHelperNames([file])], ['copy'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('本文件覆盖混入方法后仍只提取获胜方法自身', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cy-handler-override-'))
  try {
    fs.writeFileSync(path.join(dir, 'mixed.js'), "const METHODS = {copy(){wx.setClipboardData({data:'x'})},locate(){wx.getLocation({})}}; module.exports = {METHODS};\n")
    const file = path.join(dir, 'index.js')
    fs.writeFileSync(file, "const {METHODS} = require('./mixed');\nPage({...METHODS,copy(){return 'overridden'}});\n")
    assert.deepEqual([...discoverExternalHelperNames([file])], ['locate'])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
