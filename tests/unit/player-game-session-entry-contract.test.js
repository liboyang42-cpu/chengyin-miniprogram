const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const pageDir = path.resolve(__dirname, '../../pages/play')
const js = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8')
const wxml = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8')

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

function loadUnknownWritePlayer(options = {}) {
  const pageModule = path.join(pageDir, 'index.js')
  const client = require('../../utils/game-session-client.js')
  const previous = {
    Page: global.Page,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx,
    submitAction: client.submitAction,
    readReceipt: client.readReceipt,
    loadProjection: client.loadProjection,
  }
  const storage = options.storage || new Map()
  const submitCalls = []
  const receiptCalls = []
  const removedKeys = []
  const modalCalls = []
  const toastCalls = []
  let submitResult = { status: 'unknown' }
  let receiptResult = { status: 'pending' }
  let projectionResult = { status: 'network-error' }
  let definition
  client.submitAction = (role, input) => {
    submitCalls.push({ role, input })
    return Promise.resolve(typeof submitResult === 'function' ? submitResult(role, input) : submitResult)
  }
  client.readReceipt = (activityId, requestId) => {
    receiptCalls.push({ activityId, requestId })
    return Promise.resolve(receiptResult)
  }
  client.loadProjection = () => Promise.resolve(projectionResult)
  global.getApp = () => ({ globalData: { features: {} }, getUserID: () => '9', sendRequest() {}, chooseImage() {} })
  global.getCurrentPages = () => []
  global.wx = {
    getStorageSync(key) { return storage.get(key) || '' },
    setStorageSync(key, value) {
      if (options.storageWriteError) throw new Error('storage unavailable')
      storage.set(key, value)
    },
    removeStorageSync(key) { removedKeys.push(key); storage.delete(key) },
    showToast(options) { toastCalls.push(options) },
    showModal(options) {
      modalCalls.push(options)
      if (options && options.success) options.success({ confirm: true, cancel: false })
    },
  }
  global.Page = (config) => { definition = config }
  delete require.cache[require.resolve(pageModule)]
  require(pageModule)

  const command = {
    activityId: 701,
    nodeId: 31,
    requestId: 'pg-701-exact-terminal',
    expectedRevision: 9,
    action: 'PLAYER_CHOICE',
    payload: { choiceId: 'A' },
  }
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    _playerPendingWrite: { requestId: command.requestId, action: command.action, command },
    _reloads: 0,
    _loadPlayerGameModule() { this._reloads += 1 },
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback.call(this)
    },
  })
  page.data.activityId = 701
  page.data.gameModule = Object.assign({}, page.data.gameModule, {
    enabled: true,
    activityId: 701,
    revision: 9,
    write: { status: 'unknown', requestId: command.requestId, message: '结果待核对' },
  })

  return {
    page,
    definition,
    command,
    submitCalls,
    receiptCalls,
    removedKeys,
    modalCalls,
    toastCalls,
    setSubmitResult(value) { submitResult = value },
    setReceiptResult(value) { receiptResult = value },
    setProjectionResult(value) { projectionResult = value },
    cleanup() {
      client.submitAction = previous.submitAction
      client.readReceipt = previous.readReceipt
      client.loadProjection = previous.loadProjection
      if (previous.Page === undefined) delete global.Page; else global.Page = previous.Page
      if (previous.getApp === undefined) delete global.getApp; else global.getApp = previous.getApp
      if (previous.getCurrentPages === undefined) delete global.getCurrentPages; else global.getCurrentPages = previous.getCurrentPages
      if (previous.wx === undefined) delete global.wx; else global.wx = previous.wx
    },
  }
}

function terminalReceipt(command, outcome, overrides) {
  return Object.assign({
    receiptId: 801,
    activityId: command.activityId,
    requestId: command.requestId,
    action: command.action,
    outcome,
    revision: outcome === 'APPLIED' ? 10 : 9,
  }, overrides || {})
}

function readyPlayerProjection(revision = 9) {
  return {
    status: 'ready',
    data: {
      sessionId: 91,
      activityId: 701,
      perspective: 'PLAYER',
      status: 'RUNNING',
      revision,
      availableActions: ['PLAYER_SUBMIT'],
      player: { teamId: 8, role: {}, nodes: [] },
    },
  }
}

test('玩家页从共享三身份客户端读取服务端投影并提供精确回执回读', () => {
  assert.match(js, /require\('\.\.\/\.\.\/utils\/game-session-client\.js'\)/)
  assert.match(js, /loadProjection\('player', activityId\)/)
  assert.match(js, /submitAction\('player', input\)/)
  assert.match(js, /readReceipt\(gameModule\.activityId, requestId\)/)
  assert.match(js, /buildPlayerRoleConfirmInput\(gameModule, requestId\)/)
  assert.match(js, /buildPlayerSubmissionInput\(/)
  assert.match(wxml, /bindtap="submitPlayerTask"/)
  assert.match(wxml, /核验编号 \{\{item\.submission\.submissionId\}\}/)
  assert.match(wxml, /bindtap="confirmPlayerRole"/)
  assert.match(js, /game_player_pending_/)
  assert.match(js, /结果待核对，请勿重复提交/)
  assert.match(js, /normalizePlayerPendingReceiptIndex/)
  assert.match(js, /setStorageSync\(key, receiptIndex\)/)
  assert.match(js, /retryPlayerUnknownWrite\s*\(\)/)
  assert.match(js, /submitAction\('player',\s*pending\.command\)/)
  assert.match(wxml, /bindtap="retryPlayerUnknownWrite"/)
  assert.match(wxml, /gameModule\.write\.canRetry/)
})

test('玩家页不再内置角色秘密，角色卡和线索都来自投影', () => {
  assert.doesNotMatch(js, /路线在你脑子里|队伍里没有第二双眼睛|谜面到你手里/)
  assert.match(js, /myRole\.summary/)
  // 2026-09-11 半屏脱离 cy-sheet:标题改由原型壳里的 .sheet-name 承担,title 属性没有了。
  assert.match(wxml, /<view class="sheet-name">本局线索<\/view>/)
  assert.match(wxml, /\{\{item\.clue\}\}/)
  assert.match(wxml, /data-choice="\{\{choice\.id\}\}"/)
})

test('F01 弱网刷新保留旧快照时明确标注旧数据时间并可重试，首次失败仍是错误空态', async () => {
  const retained = loadUnknownWritePlayer()
  try {
    retained.page._loadPlayerGameModule = retained.definition._loadPlayerGameModule
    retained.page.rebuild = () => {}
    retained.page.data.gameModule = Object.assign({}, retained.page.data.gameModule, {
      enabled: true,
      activityId: 701,
      snapshotAt: '2026-08-23 10:30:59',
      stale: false,
      nodes: [{ nodeId: 31, status: 'AVAILABLE' }],
    })
    retained.setProjectionResult({ status: 'network-error', message: '网络连接失败' })

    retained.page._loadPlayerGameModule()
    await settle()

    assert.equal(retained.page.data.gameModule.enabled, true)
    assert.equal(retained.page.data.gameModule.snapshotAt, '2026-08-23 10:30:59')
    assert.equal(retained.page.data.gameModule.stale, true)
    assert.equal(retained.page.data.gameModule.error, '网络连接失败')
  } finally {
    retained.cleanup()
  }

  const firstLoad = loadUnknownWritePlayer()
  try {
    firstLoad.page._loadPlayerGameModule = firstLoad.definition._loadPlayerGameModule
    firstLoad.page.rebuild = () => {}
    firstLoad.page.data.gameModule = Object.assign({}, firstLoad.page.data.gameModule, {
      enabled: false, snapshotAt: '', stale: false,
    })
    firstLoad.setProjectionResult({ status: 'network-error', message: '网络连接失败' })

    firstLoad.page._loadPlayerGameModule()
    await settle()

    assert.equal(firstLoad.page.data.gameModule.enabled, false)
    assert.equal(firstLoad.page.data.gameModule.stale, false)
    assert.equal(firstLoad.page.data.gameModule.error, '网络连接失败')
  } finally {
    firstLoad.cleanup()
  }

  assert.match(wxml, /class="gmod__stale" wx:if="\{\{gameModule\.stale\}\}"/)
  assert.match(wxml, /旧数据更新于 \{\{gameModule\.snapshotAt\}\}/)
  assert.match(wxml, /class="gmod__retry" bindtap="retryGameModule"/)
})

test('暂停节点在所有进入路径共用的锁闸被阻断', () => {
  assert.match(js, /if \(node && node\.paused\)/)
  assert.match(js, /本站已暂停/)
  assert.match(js, /filter\(\(o\) => !o\.x\.done && !o\.x\.paused\)/)
})

test('D05 暂停节点把服务端批准的替代行动展示给玩家', () => {
  assert.match(wxml, /item\.status === 'PAUSED'/)
  assert.match(wxml, /\{\{item\.fallback\.playerMessage\}\}/)
  assert.match(wxml, /\{\{item\.fallback\.targetNodeName\}\}/)
  assert.match(wxml, /\{\{item\.fallback\.planCode\}\} v\{\{item\.fallback\.planVersion\}\}/)
})

test('R9-38 暂停节点无兜底路线也展示暂停安排与退款去处', () => {
  assert.match(wxml, /\{\{item\.pause\.reason\}\}/)
  assert.match(wxml, /\{\{item\.pause\.resumeEta\}\}/)
  assert.match(wxml, /如需退款请联系平台客服/)
  assert.doesNotMatch(wxml, /item\.status === 'PAUSED' && item\.fallback/,
    '暂停说明不能只在有兜底路线时才渲染')
})

test('完成回执只触发上一确认节点到本节点的路线分段表现', () => {
  assert.match(js, /completedRouteSegment\(nodes, nodeId\)/)
  assert.match(js, /motion\.routeDraw\(segment/)
  assert.match(js, /reducedMotion: this\.data\.reducedMotion/)
  assert.match(js, /if \(this\._routeDrawStop\) this\._routeDrawStop\(\)/)
  assert.match(js, /completed = projected\.status === 'COMPLETED' \|\| projected\.status === 'FALLBACK_COMPLETED'/)
  assert.match(js, /done:\s*completed/)
  assert.match(js, /doneAt:\s*completedAt/)
  assert.match(js, /if \(newlyCompleted\) this\._animateCompletedSegment\(this\.data\.nodes, newlyCompleted\.nodeId\)/)
})

test('服务端结局进入现有单屏结算，不再为三身份模组叠加第二个庆祝层', () => {
  assert.match(wxml, /finsheet__game-ending/)
  assert.match(wxml, /\{\{gameModule\.story\.ending\.title\}\}/)
  assert.match(wxml, /\{\{gameModule\.story\.ending\.summary\}\}/)
})

test('玩家任务不是一键通关：文字、现场码和照片都先形成真实凭证再提交', () => {
  assert.match(wxml, /item\.playerTask\.inputType === 'TEXT'/)
  assert.match(wxml, /bindinput="onPlayerTaskTextInput"/)
  assert.match(wxml, /item\.playerTask\.inputType === 'SCAN'/)
  assert.match(wxml, /bindtap="scanPlayerTaskEvidence"/)
  assert.match(wxml, /item\.playerTask\.inputType === 'PHOTO'/)
  assert.match(wxml, /bindtap="photoPlayerTaskEvidence"/)
  assert.match(wxml, /!item\.taskEvidence\.ready \? 'is-disabled'/)
  assert.match(wxml, /gameModule\.canSubmitTask/)
  assert.doesNotMatch(wxml, /gameModule\.availableActions\.indexOf\('PLAYER_SUBMIT'\)/)
  assert.match(js, /if \(!evidence\.ready \|\| !Array\.isArray\(evidence\.evidenceUrls\) \|\| !evidence\.evidenceUrls\.length\)/)
  assert.match(js, /\['text:' \+ encodeURIComponent\(trimmed\)\]/)
  assert.match(js, /\['scan:' \+ encodeURIComponent\(value\)\]/)
  assert.match(js, /filter\(\(url\) => url\.toLowerCase\(\)\.startsWith\('https:\/\/'\)\)/)
  assert.match(js, /buildPlayerSubmissionInput\([\s\S]*?evidence\.evidenceUrls/)
})

test('D05 提示点击前显示影响，确认后只提交服务端 nextLevel', async () => {
  assert.match(wxml, /\{\{item\.hint\.nextImpactLabel\}\}/)
  assert.match(wxml, /wx:for="\{\{item\.hint\.revealedTexts\}\}"/)
  assert.match(wxml, /bindtap="requestPlayerHint"/)

  const harness = loadUnknownWritePlayer()
  try {
    harness.page.data.gameModule = Object.assign({}, harness.page.data.gameModule, {
      enabled: true,
      activityId: 701,
      revision: 9,
      availableActions: ['PLAYER_HINT'],
      write: { status: 'idle', requestId: '', message: '' },
      nodes: [{
        nodeId: 31,
        hint: {
          currentLevel: 1,
          revealedTexts: [{ level: 1, text: '先看门牌第三行' }],
          nextLevel: 2,
          nextImpactLabel: '使用后本关解谜分上限降至 40 分',
          revealAvailable: false,
          revealImpactLabel: '',
        },
      }],
    })
    harness.page._playerPendingWrite = null
    harness.setSubmitResult((role, command) => ({
      status: 'success', requestId: command.requestId,
      receipt: terminalReceipt(command, 'APPLIED'),
    }))

    harness.page.requestPlayerHint({ currentTarget: { dataset: { node: 31, level: 2 } } })
    await settle()

    assert.equal(harness.modalCalls.length, 1)
    assert.equal(harness.modalCalls[0].content, '使用后本关解谜分上限降至 40 分')
    assert.equal(harness.submitCalls.length, 1)
    assert.equal(harness.submitCalls[0].role, 'player')
    assert.deepEqual(harness.submitCalls[0].input, {
      activityId: 701,
      nodeId: 31,
      requestId: harness.submitCalls[0].input.requestId,
      expectedRevision: 9,
      action: 'PLAYER_HINT',
      payload: { level: 2 },
    })
    assert.equal(harness.page._reloads, 1)
  } finally {
    harness.cleanup()
  }
})

test('F06 reveal 明示兜底完成影响，确认后只提交空 payload', async () => {
  assert.match(wxml, /\{\{item\.hint\.revealImpactLabel\}\}/)
  assert.match(wxml, /bindtap="requestPlayerReveal"/)
  assert.match(wxml, /记为兜底完成、不计正常榜单分/)
  assert.match(wxml, /兜底完成 · 不计正常榜单分/)

  const harness = loadUnknownWritePlayer()
  try {
    harness.page.data.gameModule = Object.assign({}, harness.page.data.gameModule, {
      enabled: true,
      activityId: 701,
      revision: 9,
      availableActions: ['PLAYER_REVEAL'],
      write: { status: 'idle', requestId: '', message: '' },
      nodes: [{
        nodeId: 31,
        hint: {
          currentLevel: 2,
          revealedTexts: [],
          nextLevel: null,
          nextImpactLabel: '',
          revealAvailable: true,
          revealImpactLabel: '查看答案将记为兜底完成，不计正常榜单分',
        },
      }],
    })
    harness.page._playerPendingWrite = null
    harness.setSubmitResult((role, command) => ({
      status: 'success', requestId: command.requestId,
      receipt: terminalReceipt(command, 'APPLIED'),
    }))

    harness.page.requestPlayerReveal({ currentTarget: { dataset: { node: 31 } } })
    await settle()

    assert.equal(harness.modalCalls.length, 1)
    assert.equal(harness.modalCalls[0].content, '查看答案将记为兜底完成，不计正常榜单分')
    assert.deepEqual(harness.submitCalls[0].input, {
      activityId: 701,
      nodeId: 31,
      requestId: harness.submitCalls[0].input.requestId,
      expectedRevision: 9,
      action: 'PLAYER_REVEAL',
      payload: {},
    })
    assert.equal(harness.page._reloads, 1)
  } finally {
    harness.cleanup()
  }
})

test('PLAYER_REVEAL 的权威答案立即展示，刷新后的兜底完成节点仍保留答案', async () => {
  const storage = new Map()
  const harness = loadUnknownWritePlayer({ storage })
  try {
    harness.page.data.gameModule = Object.assign({}, harness.page.data.gameModule, {
      enabled: true,
      sessionId: 91,
      activityId: 701,
      teamId: 8,
      revision: 9,
      availableActions: ['PLAYER_REVEAL'],
      write: { status: 'idle', requestId: '', message: '' },
      nodes: [{
        nodeId: 31,
        hint: {
          currentLevel: 2,
          revealedTexts: [],
          nextLevel: null,
          nextImpactLabel: '',
          revealAvailable: true,
          revealImpactLabel: '查看答案将记为兜底完成，不计正常榜单分',
        },
      }],
    })
    harness.page._playerPendingWrite = null
    harness.setSubmitResult((role, command) => ({
      status: 'success', requestId: command.requestId,
      receipt: terminalReceipt(command, 'APPLIED', {
        result: { revealText: '答案是 1998' },
      }),
    }))

    harness.page.requestPlayerReveal({ currentTarget: { dataset: { node: 31 } } })
    await settle()

    assert.equal(harness.modalCalls.length, 2)
    assert.deepEqual({
      title: harness.modalCalls[1].title,
      content: harness.modalCalls[1].content,
      showCancel: harness.modalCalls[1].showCancel,
    }, {
      title: '答案已揭示',
      content: '答案是 1998',
      showCancel: false,
    })
    assert.doesNotMatch(JSON.stringify(Array.from(storage.entries())), /答案是 1998|revealText/,
      '答案正文只能留在当前页面内存，不能写入本地 storage')

    harness.setProjectionResult({
      status: 'ready',
      data: {
        sessionId: 91,
        activityId: 701,
        perspective: 'PLAYER',
        status: 'RUNNING',
        revision: 10,
        availableActions: [],
        player: {
          teamId: 8,
          role: {},
          nodes: [{
            nodeId: 31,
            personalState: 'FALLBACK_COMPLETED',
            completionStatus: 'FALLBACK_COMPLETED',
            completionSource: 'PLAYER_REVEAL',
            hint: {
              currentLevel: 2,
              revealedTexts: [],
              revealAvailable: false,
            },
          }],
        },
      },
    })
    harness.page._loadPlayerGameModule = harness.definition._loadPlayerGameModule
    harness.page.rebuild = () => {}
    harness.page._loadPlayerGameModule()
    await settle()

    assert.equal(harness.page.data.gameModule.nodes[0].revealedAnswer, '答案是 1998')
    assert.match(wxml, /答案 · \{\{item\.revealedAnswer\}\}/)
  } finally {
    harness.cleanup()
  }
})

test('敏感玩家写只在内存保留原命令，重启后仅按落盘回执索引核对且绝不自动重发', async () => {
  const storage = new Map()
  const first = loadUnknownWritePlayer({ storage })
  try {
    const evidenceUrl = 'https://cdn.example.com/private/scene.jpg'
    first.page.data.gameModule = Object.assign({}, first.page.data.gameModule, {
      enabled: true,
      activityId: 701,
      revision: 9,
      availableActions: ['PLAYER_SUBMIT'],
      write: { status: 'idle', requestId: '', message: '' },
      nodes: [{
        nodeId: 31,
        playerTask: {
          taskCode: 'PHOTO_SCENE', prompt: '拍下现场标记', inputType: 'PHOTO',
          completionPolicy: 'EVIDENCE_ONLY', verificationRequired: false,
        },
        taskEvidence: {
          type: 'PHOTO', ready: true, text: '', evidenceUrls: [evidenceUrl], statusText: '已上传 1 张现场照片',
        },
        submission: null,
      }],
    })
    first.page._playerPendingWrite = null
    first.setSubmitResult({ status: 'unknown', message: '结果待核对' })

    first.page.submitPlayerTask({ currentTarget: { dataset: { node: 31, task: 'PHOTO_SCENE' } } })
    await settle()

    const command = first.submitCalls[0].input
    assert.deepEqual(first.page._playerPendingWrite.command, command, '同页内存仍保留原命令供精确重试')
    assert.deepEqual(storage.get('game_player_pending_m9_a701'), {
      activityId: 701,
      nodeId: 31,
      requestId: command.requestId,
      expectedRevision: 9,
      action: 'PLAYER_SUBMIT',
    })
    assert.doesNotMatch(JSON.stringify(storage.get('game_player_pending_m9_a701')), /payload|PHOTO_SCENE|evidenceUrls|https:\/\//)
  } finally {
    first.cleanup()
  }

  const reopened = loadUnknownWritePlayer({ storage })
  try {
    reopened.setProjectionResult(readyPlayerProjection(9))
    reopened.setReceiptResult({ status: 'pending', requestId: storage.get('game_player_pending_m9_a701').requestId })
    reopened.page._loadPlayerGameModule = reopened.definition._loadPlayerGameModule
    reopened.page.rebuild = () => {}
    reopened.page._loadPlayerGameModule()
    await settle()
    await settle()

    assert.equal(reopened.submitCalls.length, 0, '重启恢复只能查回执，不能重发敏感命令')
    assert.equal(reopened.receiptCalls.length, 1)
    assert.equal(reopened.page.data.gameModule.write.status, 'unknown')
    assert.equal(reopened.page.data.gameModule.write.canRetry, false)
    assert.equal(reopened.page._playerPendingWrite.command, undefined)
    assert.equal(reopened.page.retryPlayerUnknownWrite(), false)
    assert.equal(reopened.submitCalls.length, 0)

    const pending = reopened.page._playerPendingWrite
    reopened.setReceiptResult({
      status: 'matched', requestId: pending.requestId,
      receipt: terminalReceipt(pending, 'APPLIED'),
    })
    reopened.page.reconcilePlayerChoice()
    await settle()

    assert.equal(reopened.page.data.gameModule.write.status, 'idle', '精确 APPLIED 后清锁并回到最新服务端投影')
    assert.equal(reopened.page._playerPendingWrite, null)
    assert.equal(storage.has('game_player_pending_m9_a701'), false)
    assert.equal(reopened.submitCalls.length, 0)
  } finally {
    reopened.cleanup()
  }
})

test('玩家回执索引落盘失败时 fail closed，敏感任务网络请求不得发出', async () => {
  const storage = new Map()
  const harness = loadUnknownWritePlayer({ storage, storageWriteError: true })
  try {
    harness.page.data.gameModule = Object.assign({}, harness.page.data.gameModule, {
      enabled: true,
      activityId: 701,
      revision: 9,
      availableActions: ['PLAYER_SUBMIT'],
      write: { status: 'idle', requestId: '', message: '' },
      nodes: [{
        nodeId: 31,
        playerTask: {
          taskCode: 'PHOTO_SCENE', prompt: '拍下现场标记', inputType: 'PHOTO',
          completionPolicy: 'EVIDENCE_ONLY', verificationRequired: false,
        },
        taskEvidence: {
          type: 'PHOTO', ready: true, text: '',
          evidenceUrls: ['https://cdn.example.com/private/scene.jpg'], statusText: '已上传 1 张现场照片',
        },
        submission: null,
      }],
    })
    harness.page._playerPendingWrite = null

    harness.page.submitPlayerTask({ currentTarget: { dataset: { node: 31, task: 'PHOTO_SCENE' } } })
    await settle()

    assert.equal(harness.submitCalls.length, 0)
    assert.equal(harness.page._playerPendingWrite, null)
    assert.equal(harness.page.data.gameModule.write.status, 'error')
    assert.match(harness.page.data.gameModule.write.message, /无法安全保存/)
    assert.match(harness.toastCalls[0].title, /无法安全保存/)
    assert.equal(storage.size, 0)
  } finally {
    harness.cleanup()
  }
})

test('重启恢复的回执索引收到精确 FAILED 后清锁，仍不重发原命令', async () => {
  const storage = new Map([['game_player_pending_m9_a701', {
    activityId: 701,
    nodeId: 31,
    requestId: 'pg-submit-701-31-failed',
    expectedRevision: 9,
    action: 'PLAYER_SUBMIT',
  }]])
  const reopened = loadUnknownWritePlayer({ storage })
  try {
    const pending = storage.get('game_player_pending_m9_a701')
    reopened.setProjectionResult(readyPlayerProjection(9))
    reopened.setReceiptResult({
      status: 'business-error', requestId: pending.requestId, message: '服务端未接受原操作',
      receipt: terminalReceipt(pending, 'FAILED'),
    })
    reopened.page._loadPlayerGameModule = reopened.definition._loadPlayerGameModule
    reopened.page.rebuild = () => {}
    reopened.page._loadPlayerGameModule()
    await settle()
    await settle()

    assert.equal(reopened.page.data.gameModule.write.status, 'error')
    assert.equal(reopened.page.data.gameModule.write.message, '服务端未接受原操作')
    assert.equal(reopened.page._playerPendingWrite, null)
    assert.equal(storage.has('game_player_pending_m9_a701'), false)
    assert.equal(reopened.submitCalls.length, 0)
    assert.equal(reopened.receiptCalls.length, 1)
  } finally {
    reopened.cleanup()
  }
})

test('PHOTO EVIDENCE_ONLY 提交后显示证据已记录，RECORDED 不进入商家核验语义', async () => {
  assert.match(wxml, /item\.playerTask\.completionPolicy === 'EVIDENCE_ONLY' \? '记录现场证据'/)
  assert.match(wxml, /item\.submission\.status === 'PENDING'/)
  assert.match(wxml, /\{\{item\.submission\.statusLabel\}\}/)

  const harness = loadUnknownWritePlayer()
  try {
    const photoNode = {
      nodeId: 31,
      playerTask: {
        taskCode: 'PHOTO_SCENE',
        prompt: '拍下现场标记',
        inputType: 'PHOTO',
        completionPolicy: 'EVIDENCE_ONLY',
        verificationRequired: false,
      },
      taskEvidence: {
        type: 'PHOTO', ready: true, text: '',
        evidenceUrls: ['https://cdn.example.com/evidence/scene.jpg'], statusText: '已上传 1 张现场照片',
      },
      submission: null,
    }
    harness.page.data.gameModule = Object.assign({}, harness.page.data.gameModule, {
      enabled: true,
      activityId: 701,
      revision: 9,
      availableActions: ['PLAYER_SUBMIT'],
      write: { status: 'idle', requestId: '', message: '' },
      nodes: [photoNode],
    })
    harness.page._playerPendingWrite = null
    harness.setSubmitResult((role, command) => ({
      status: 'success', requestId: command.requestId,
      receipt: Object.assign(terminalReceipt(command, 'APPLIED'), {
        result: { submissionId: 303, status: 'RECORDED' },
      }),
    }))

    harness.page.submitPlayerTask({ currentTarget: { dataset: { node: 31, task: 'PHOTO_SCENE' } } })
    await settle()

    assert.equal(harness.submitCalls.length, 1)
    assert.equal(harness.submitCalls[0].input.action, 'PLAYER_SUBMIT')
    assert.equal(harness.toastCalls.at(-1).title, '证据已记录')
    assert.equal(harness.page.data.gameModule.write.message, '证据已记录')

    harness.page.data.gameModule.write = { status: 'idle', requestId: '', message: '' }
    harness.page.data.gameModule.nodes[0] = Object.assign({}, photoNode, {
      submission: { submissionId: 303, status: 'RECORDED', statusLabel: '证据已记录' },
    })
    harness.page.submitPlayerTask({ currentTarget: { dataset: { node: 31, task: 'PHOTO_SCENE' } } })
    await settle()
    assert.equal(harness.submitCalls.length, 1, 'RECORDED 证据不能绕过页面状态重复提交')
  } finally {
    harness.cleanup()
  }
})

test('D05/F06 unknown-write 只有精确动作终态 receipt 才解锁', async () => {
  const cases = [{ action: 'PLAYER_HINT', payload: { level: 2 }, outcome: 'APPLIED' }, {
    action: 'PLAYER_REVEAL', payload: {}, outcome: 'FAILED',
  }]
  for (const row of cases) {
    const harness = loadUnknownWritePlayer()
    try {
      const command = {
        activityId: 701,
        nodeId: 31,
        requestId: 'pg-exact-' + row.action.toLowerCase(),
        expectedRevision: 9,
        action: row.action,
        payload: row.payload,
      }
      harness.page._playerPendingWrite = {
        requestId: command.requestId,
        action: command.action,
        command,
      }
      harness.page.data.gameModule.write = {
        status: 'unknown', requestId: command.requestId, message: '结果待核对',
      }

      const wrongAction = row.action === 'PLAYER_HINT' ? 'PLAYER_REVEAL' : 'PLAYER_HINT'
      harness.setSubmitResult({
        status: 'business-error', requestId: command.requestId,
        receipt: terminalReceipt(command, 'FAILED', { action: wrongAction }),
      })
      assert.equal(harness.page.retryPlayerUnknownWrite(), true)
      await settle()
      assert.equal(harness.page.data.gameModule.write.status, 'unknown')
      assert.equal(harness.page._playerPendingWrite.command, command)
      assert.deepEqual(harness.removedKeys, [])

      harness.setSubmitResult(row.outcome === 'APPLIED' ? {
        status: 'success', requestId: command.requestId,
        receipt: terminalReceipt(command, 'APPLIED'),
      } : {
        status: 'business-error', requestId: command.requestId, message: '操作未被接受',
        receipt: terminalReceipt(command, 'FAILED'),
      })
      harness.page.retryPlayerUnknownWrite()
      await settle()
      assert.equal(harness.page.data.gameModule.write.status, row.outcome === 'APPLIED' ? 'confirmed' : 'error')
      assert.equal(harness.page._playerPendingWrite, null)
      assert.deepEqual(harness.removedKeys, ['game_player_pending_m9_a701'])
      assert.ok(harness.submitCalls.every((call) => call.input === command))
    } finally {
      harness.cleanup()
    }
  }
})

test('玩家未知写精确重试：无回执业务错误和错 action 回执都继续全页锁，精确 FAILED 才解锁', async () => {
  const harness = loadUnknownWritePlayer()
  try {
    harness.setSubmitResult({
      status: 'business-error', requestId: harness.command.requestId,
      reasonCode: 'GAME_LOGIN_REQUIRED', message: '请重新登录',
    })
    assert.equal(harness.page.retryPlayerUnknownWrite(), true)
    await settle()
    assert.equal(harness.page.data.gameModule.write.status, 'unknown')
    assert.equal(harness.page.data.gameModule.write.requestId, harness.command.requestId)
    assert.equal(harness.page._playerPendingWrite.command, harness.command)
    assert.deepEqual(harness.removedKeys, [])

    harness.setSubmitResult({
      status: 'business-error', requestId: harness.command.requestId,
      receipt: terminalReceipt(harness.command, 'FAILED', { action: 'CONFIRM_ROLE' }),
    })
    harness.page.retryPlayerUnknownWrite()
    await settle()
    assert.equal(harness.page.data.gameModule.write.status, 'unknown')
    assert.equal(harness.page._playerPendingWrite.command, harness.command)
    assert.deepEqual(harness.removedKeys, [])

    harness.setSubmitResult({
      status: 'business-error', requestId: harness.command.requestId,
      message: '状态冲突', receipt: terminalReceipt(harness.command, 'FAILED'),
    })
    harness.page.retryPlayerUnknownWrite()
    await settle()
    assert.equal(harness.page.data.gameModule.write.status, 'error')
    assert.equal(harness.page.data.gameModule.write.requestId, harness.command.requestId)
    assert.equal(harness.page._playerPendingWrite, null)
    assert.deepEqual(harness.removedKeys, ['game_player_pending_m9_a701'])
    assert.equal(harness.submitCalls.length, 3)
    assert.ok(harness.submitCalls.every((call) => call.input === harness.command))
  } finally {
    harness.cleanup()
  }
})

test('玩家初次选择收到无回执业务错误也进入 unknown，精确 FAILED 才按失败收口', async () => {
  const unknown = loadUnknownWritePlayer()
  try {
    unknown.page.data.gameModule.write = { status: 'idle', requestId: '', message: '' }
    unknown.page._playerPendingWrite = null
    unknown.setSubmitResult({ status: 'business-error', reasonCode: 'GAME_LOGIN_REQUIRED', message: '请重新登录' })
    unknown.page.submitPlayerChoice({ currentTarget: { dataset: { node: 31, choice: 'A' } } })
    await settle()
    const command = unknown.submitCalls[0].input
    assert.equal(unknown.page.data.gameModule.write.status, 'unknown')
    assert.equal(unknown.page.data.gameModule.write.requestId, command.requestId)
    assert.equal(unknown.page._playerPendingWrite.command.requestId, command.requestId)
    assert.deepEqual(unknown.removedKeys, [])
  } finally {
    unknown.cleanup()
  }

  const failed = loadUnknownWritePlayer()
  try {
    failed.page.data.gameModule.write = { status: 'idle', requestId: '', message: '' }
    failed.page._playerPendingWrite = null
    failed.setSubmitResult((role, command) => ({
      status: 'business-error', requestId: command.requestId, message: '状态冲突',
      receipt: terminalReceipt(command, 'FAILED'),
    }))
    failed.page.submitPlayerChoice({ currentTarget: { dataset: { node: 31, choice: 'A' } } })
    await settle()
    assert.equal(failed.page.data.gameModule.write.status, 'error')
    assert.equal(failed.page._playerPendingWrite, null)
    assert.deepEqual(failed.removedKeys, ['game_player_pending_m9_a701'])
  } finally {
    failed.cleanup()
  }
})

test('玩家未知写回读：非终态不解锁，精确 APPLIED/FAILED 终态分别确认或驳回', async () => {
  const failed = loadUnknownWritePlayer()
  try {
    failed.setReceiptResult({
      status: 'business-error', requestId: failed.command.requestId,
      reasonCode: 'GAME_LOGIN_REQUIRED', message: '请重新登录',
    })
    failed.page.reconcilePlayerChoice()
    await settle()
    assert.equal(failed.page.data.gameModule.write.status, 'unknown')
    assert.equal(failed.page._playerPendingWrite.command, failed.command)
    assert.deepEqual(failed.removedKeys, [])

    failed.setReceiptResult({
      status: 'business-error', requestId: failed.command.requestId,
      receipt: terminalReceipt(failed.command, 'FAILED', { action: 'PLAYER_SUBMIT' }),
    })
    failed.page.reconcilePlayerChoice()
    await settle()
    assert.equal(failed.page.data.gameModule.write.status, 'unknown')
    assert.equal(failed.page._playerPendingWrite.command, failed.command)

    failed.setReceiptResult({
      status: 'business-error', requestId: failed.command.requestId,
      message: '状态冲突', receipt: terminalReceipt(failed.command, 'FAILED'),
    })
    failed.page.reconcilePlayerChoice()
    await settle()
    assert.equal(failed.page.data.gameModule.write.status, 'error')
    assert.equal(failed.page._playerPendingWrite, null)
    assert.deepEqual(failed.removedKeys, ['game_player_pending_m9_a701'])
  } finally {
    failed.cleanup()
  }

  const applied = loadUnknownWritePlayer()
  try {
    applied.setReceiptResult({
      status: 'matched', requestId: applied.command.requestId,
      receipt: terminalReceipt(applied.command, 'APPLIED'),
    })
    applied.page.reconcilePlayerChoice()
    await settle()
    assert.equal(applied.page.data.gameModule.write.status, 'confirmed')
    assert.equal(applied.page._playerPendingWrite, null)
    assert.deepEqual(applied.removedKeys, ['game_player_pending_m9_a701'])
    assert.equal(applied.page._reloads, 1)
  } finally {
    applied.cleanup()
  }
})
