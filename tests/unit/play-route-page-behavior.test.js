const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const PAGE_PATH = path.resolve(__dirname, '../../pages/play/index.js')

function loadPage() {
  const requests = []
  const app = {
    sendRequest(options) {
      requests.push(options)
    },
  }
  let definition = null
  global.getApp = () => app
  global.Page = (value) => { definition = value }
  global.wx = {
    nextTick(callback) { if (callback) callback() },
    showToast() {},
    vibrateShort() {},
  }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  assert.ok(definition, 'play page definition was not registered')
  return { definition, app, requests }
}

function context(definition, data) {
  const page = Object.assign({}, definition)
  page.data = Object.assign({}, definition.data, data)
  page._routeState = (data && data.routeState) || definition._routeState
  Object.defineProperty(page.data, 'routeState', {
    enumerable: true,
    get() { return page._routeState },
    set(value) { page._routeState = value },
  })
  page.setData = function setData(patch, callback) {
    Object.keys(patch || {}).forEach((key) => {
      if (!key.includes('.')) this.data[key] = patch[key]
      else {
        const parts = key.split('.')
        let target = this.data
        for (let i = 0; i < parts.length - 1; i++) {
          target[parts[i]] = target[parts[i]] || {}
          target = target[parts[i]]
        }
        target[parts[parts.length - 1]] = patch[key]
      }
    })
    if (callback) callback()
  }
  return page
}

const rows = [
  { nodeId: 20, sortId: 1, name: '未选支线', done: false },
  { nodeId: 30, sortId: 9, name: '服务端下一站', done: false },
]

test('play 页 LINEAR 保持 sortId，BRANCH_GRAPH 只消费服务端下一站', () => {
  const { definition } = loadPage()
  const linear = context(definition, { mode: 1, routeState: { routeMode: 'LINEAR' } })
  const branch = context(definition, {
    mode: 1,
    routeState: {
      routeMode: 'BRANCH_GRAPH', currentNodeId: 30, recommendedNodeId: 30, version: 4,
      nodeStates: { 20: 'HIDDEN', 30: 'PLAYABLE' }, decisionLog: [],
    },
  })

  assert.equal(linear.computeNext(rows, null).nodeId, 20)
  assert.equal(branch.computeNext(rows, null).nodeId, 30)
})

test('play 页完成请求只追加稳定 routeActionId 和 expectedRouteVersion', () => {
  const { definition } = loadPage()
  const page = context(definition, {
    activityId: 88,
    routeState: { routeMode: 'BRANCH_GRAPH', version: 4 },
  })

  const first = page._routeWritePayload('answer', 30, { nodeId: 30, answer: 'A' })
  const retry = page._routeWritePayload('answer', 30, { nodeId: 30, answer: 'A' })
  assert.equal(first.routeActionId, retry.routeActionId)
  assert.equal(first.expectedRouteVersion, 4)
  assert.deepEqual(Object.keys(first).sort(), [
    'activityId', 'answer', 'expectedRouteVersion', 'nodeId', 'routeActionId',
  ])
  assert.equal('targetNodeId' in first, false)
  assert.equal('outcomeCode' in first, false)

  page._resolveRouteAction('answer', 30)
  const nextIntent = page._routeWritePayload('answer', 30, { nodeId: 30, answer: 'A' })
  assert.notEqual(nextIntent.routeActionId, first.routeActionId)
})

test('play 页版本冲突不会重放动作，而是刷新服务端路线状态', () => {
  const { definition } = loadPage()
  const page = context(definition, { routeState: { routeMode: 'BRANCH_GRAPH', version: 4 } })
  let refreshCount = 0
  page.refreshRouteState = () => { refreshCount += 1 }

  assert.equal(page._handleRouteConflict({ code: 'ROUTE_VERSION_CONFLICT' }, 'answer', 30), true)
  assert.equal(refreshCount, 1)
  assert.equal(page.data.routeNotice, '路线状态有更新，正在同步…')
})

test('路线同步失败或状态不可用时禁用旧 PLAYABLE 节点', async () => {
  const { definition, requests } = loadPage()
  const page = context(definition, {
    topicId: 9,
    routeState: { routeMode: 'BRANCH_GRAPH', status: 'ACTIVE', version: 4, nodeStates: { 30: 'PLAYABLE' } },
    nodes: [{ nodeId: 30, routeNodeState: 'PLAYABLE', playable: true }],
  })
  page._routeNodeCatalog = page.data.nodes.slice()
  page.rebuild = () => {}

  const pending = page.refreshRouteState()
  requests[0].success({ code: 500, msg: '同步失败' })
  await pending
  assert.equal(page.data.nodes[0].playable, false)
  assert.equal(page._routeInteractionBlocked(), true)

  page._applyRouteState({ routeMode: 'BRANCH_GRAPH', status: 'UNAVAILABLE', version: 5, nodeStates: { 30: 'PLAYABLE' } })
  assert.equal(page.data.nodes[0].playable, false)
  assert.equal(page._routeInteractionBlocked(), true)
})

test('标准路线 status 优先呈现 ACTIVE、COMPLETED 与 UNAVAILABLE', () => {
  const { definition } = loadPage()
  const page = context(definition, {})
  const base = { routeMode: 'BRANCH_GRAPH', nodeStates: { 30: 'PLAYABLE' }, decisionLog: [] }

  assert.equal(page._routeNoticeForState({ ...base, status: 'ACTIVE' }), '')
  assert.equal(page._routeNoticeForState({ ...base, status: 'COMPLETED' }), '')
  assert.equal(page._routeNoticeForState({ ...base, status: 'UNAVAILABLE' }), '路线配置已调整，当前行程暂不可继续')
})

test('play 页通过只读 route-state 接口恢复权威当前节点', async () => {
  const { definition, requests } = loadPage()
  const page = context(definition, {
    topicId: 9,
    mode: 1,
    routeState: { routeMode: 'BRANCH_GRAPH', version: 4 },
    nodes: [{ nodeId: 30, sortId: 9, done: true }],
  })
  page._routeNodeCatalog = [
    { nodeId: 20, sortId: 1, done: false },
    { nodeId: 30, sortId: 9, done: true },
    { nodeId: 40, sortId: 2, done: false },
  ]
  page.rebuild = () => {}

  const promise = page.refreshRouteState()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/play/route-state')
  assert.equal(requests[0].method, 'GET')
  assert.deepEqual(requests[0].data, { topicId: 9 })
  requests[0].success({
    code: 200,
    data: {
      routeMode: 'BRANCH_GRAPH', currentNodeId: 40, recommendedNodeId: 40, version: 5,
      nodeStates: { 20: 'HIDDEN', 30: 'COMPLETED', 40: 'PLAYABLE' },
      decisionLog: [{ fromNodeId: 30, toNodeId: 40, at: 1720000002000 }],
    },
  })
  await promise

  assert.equal(page.data.routeState.version, 5)
  assert.deepEqual(page.data.nodes.map((node) => node.nodeId), [30, 40])
  assert.equal(page.data.routeNotice, '')
})

test('分支节点完成后同页重新读取 nodes，让刚解锁地点进入当前页面', async () => {
  const { definition, requests } = loadPage()
  const page = context(definition, {
    activityId: 88,
    mode: 1,
    routeState: {
      routeMode: 'BRANCH_GRAPH', status: 'ACTIVE', version: 1,
      currentNodeId: 1001, recommendedNodeId: 1001,
      nodeStates: { 1001: 'PLAYABLE' }, decisionLog: [],
    },
    nodes: [{ nodeId: 1001, name: 'A', done: false, routeNodeState: 'PLAYABLE', playable: true }],
  })
  page._routeNodeCatalog = page.data.nodes.slice()
  page.clearArrivalError = () => {}
  page.clearGameNetworkError = () => {}
  page.stopNav = () => {}
  page.rebuild = () => {}
  page._triggerCelebration = () => {}
  page.markJustWrote = () => {}
  page.probeCelebrateEntry = () => {}
  page._ensureSessionClock = () => {}
  page._syncIdleStats = () => {}
  page._syncRunState = () => {}
  page.loadTeamProgress = () => {}
  page._maybeShowRoleCard = () => {}
  page.buildChapter = () => ({ name: '验收章节' })
  page.buildChapterCards = () => []
  page.normNode = (node) => Object.assign({}, node)

  page.onComplete(1001, {
    completedAt: 1787500000001,
    completed: false,
    routeState: {
      routeMode: 'BRANCH_GRAPH', status: 'ACTIVE', version: 2,
      currentNodeId: 1002, recommendedNodeId: 1002,
      nodeStates: { 1001: 'COMPLETED', 1002: 'PLAYABLE' }, decisionLog: [],
    },
  })

  const nodesRequest = requests.find((request) => request.url === '/api/play/nodes')
  assert.ok(nodesRequest, '完成节点后必须读取 /api/play/nodes，不能只刷新缺少新节点资料的 route-state')
  assert.deepEqual(nodesRequest.data, { activityId: 88 })
  nodesRequest.success({
    code: 200,
    data: {
      topicId: 9, topicName: '验收路线', mode: 1, registered: true,
      chapters: [],
      nodes: [
        { nodeId: 1001, name: 'A', done: true },
        { nodeId: 1002, name: 'B', done: false },
      ],
      routeState: {
        routeMode: 'BRANCH_GRAPH', status: 'ACTIVE', version: 2,
        currentNodeId: 1002, recommendedNodeId: 1002,
        nodeStates: { 1001: 'COMPLETED', 1002: 'PLAYABLE' }, decisionLog: [],
      },
    },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(page.data.nodes.map((node) => node.name), ['A', 'B'])
  assert.equal(page.data.nodes[1].routeNodeState, 'PLAYABLE')
})

test('所有会完成节点的请求都走统一路线动作上下文与冲突恢复', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  const contracts = [
    ["'/api/play/arrive'", 'arrive'],
    ["'/api/play/checkin'", 'checkin'],
    ["'/api/play/preference/' + nodeId + '/submit'", 'preference'],
    ["'/api/play/photo'", 'photo'],
    ["'/api/play/answer'", 'answer'],
    ["'/api/play/puzzle/reveal'", 'puzzleReveal'],
  ]

  contracts.forEach(([endpoint, kind]) => {
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(source, new RegExp("req\\(" + escaped + "[\\s\\S]{0,180}_routeWritePayload\\('" + kind + "'"),
      `${endpoint} 未使用 ${kind} 路线动作上下文`)
  })
  assert.ok((source.match(/_handleRouteConflict\(r,/g) || []).length >= contracts.length,
    '每个完成请求都必须识别路线版本冲突并刷新，不得按旧版本重放')
})

test('分支地图、手记与完赛足迹都消费真实 decisionLog 顺序', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  assert.match(source, /const routePathNodes = [\s\S]{0,180}buildVisibleRoutePath\(/)
  assert.ok((source.match(/orderedJourneyNodes\(/g) || []).length >= 3,
    'buildJournal、_reviewOrderedNodes、_drawRoute 必须全部按真实路线顺序')
})
