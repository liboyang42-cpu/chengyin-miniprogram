'use strict'

const http = require('node:http')

const TOPIC_ID = '88001'
const PLAYER_ACTIVITY_IDS = new Set(['99001', '99002'])

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function savedBranchGraph() {
  return {
    schemaVersion: 1,
    startNodeId: '1001',
    terminalNodeIds: ['1004', '1005'],
    variables: {},
    edges: [
      {
        id: 'history-choice', fromNodeId: '1001', toNodeId: '1002',
        trigger: { type: 'ADVANCED_RESULT', outcomeCode: 'HISTORY' },
        conditions: [], effects: [], priority: 10, weight: 1, once: true, maxVisits: 1, allowLoop: false,
      },
      {
        id: 'art-choice', fromNodeId: '1001', toNodeId: '1003',
        trigger: { type: 'ADVANCED_RESULT', outcomeCode: 'ART' },
        conditions: [], effects: [], priority: 10, weight: 1, once: true, maxVisits: 1, allowLoop: false,
      },
      {
        id: 'history-ending', fromNodeId: '1002', toNodeId: '1004',
        trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' },
        conditions: [], effects: [], priority: 10, weight: 1, once: true, maxVisits: 1, allowLoop: false,
      },
      {
        id: 'art-ending', fromNodeId: '1003', toNodeId: '1005',
        trigger: { type: 'CHOICE', outcomeCode: 'COMPLETED' },
        conditions: [], effects: [], priority: 10, weight: 1, once: true, maxVisits: 1, allowLoop: false,
      },
    ],
    fallbacks: [
      { fromNodeId: '1001', toNodeId: '1002' },
      { fromNodeId: '1002', toNodeId: '1004' },
      { fromNodeId: '1003', toNodeId: '1005' },
    ],
  }
}

function advancedChoiceConfig() {
  return JSON.stringify({
    branch: {
      enabled: true,
      steps: [
        { id: 'history', terminal: true, outcomeCode: 'HISTORY', outcomeLabel: '寻找历史' },
        { id: 'art', terminal: true, outcomeCode: 'ART', outcomeLabel: '寻找艺术' },
      ],
    },
  })
}

function editorNodes() {
  return [
    { id: 1001, name: '旧城门抉择', address: '旧城门', longitude: 121.4701, latitude: 31.2301, nodeTime: 10,
      description: '在旧城门选择一条线索。', templateId: 7001, validationMethod: 3,
      advancedConfigJson: advancedChoiceConfig(), templateInfo: { title: '旧城门抉择', validationMethod: 3, advancedConfigJson: advancedChoiceConfig() } },
    { id: 1002, name: '历史支线', address: '城市档案馆', longitude: 121.4711, latitude: 31.2311, nodeTime: 10,
      description: '从旧档案寻找城市答案。', templateId: 7002, validationMethod: 3,
      templateInfo: { title: '历史支线任务', validationMethod: 3 } },
    { id: 1003, name: '艺术支线', address: '街角画廊', longitude: 121.4691, latitude: 31.2291, nodeTime: 10,
      description: '从作品寻找城市答案。', templateId: 7003, validationMethod: 3,
      templateInfo: { title: '艺术支线任务', validationMethod: 3 } },
    { id: 1004, name: '历史守望者结局', address: '城市档案馆顶层', longitude: 121.4721, latitude: 31.2321, nodeTime: 10,
      description: '你保存了老城记忆，成为历史守望者。', templateId: 7004, validationMethod: 3,
      templateInfo: { title: '历史守望者结局', validationMethod: 3 } },
    { id: 1005, name: '艺术漫游者结局', address: '钟楼艺术露台', longitude: 121.4731, latitude: 31.2331, nodeTime: 10,
      description: '你用新的视角重新诠释城市，成为艺术漫游者。', templateId: 7005, validationMethod: 3,
      templateInfo: { title: '艺术漫游者结局', validationMethod: 3 } },
  ]
}

function editorDetail(topicState) {
  return {
    editScope: 'FULL',
    topic: {
      id: Number(TOPIC_ID), name: 'M5 分支路线验收', subtitle: '选择会改变下一站',
      description: '从旧城门出发，选择历史或艺术线索，解锁完全不同的城市结局。',
      startDate: '2026-08-24 09:00:00', endDate: '2026-12-31 23:59:59',
      imgUrl: '/pages/play/images/d_topic1.png', imgArr: '/pages/play/images/d_topic1.png',
      categoryIds: '1', productType: 1, merchantStatus: 0, openClubPool: 0,
      selfPlay: 1, selfPlayPrice: 1, selfPlayQuota: 100, teamMode: 0, teamMaxMembers: 4,
      publishMode: 'pro', routeMode: topicState.routeMode,
      routeGraphJson: topicState.routeGraphJson, configVersion: String(topicState.configVersion),
    },
    chapters: [{
      id: 501, chapterId: 501, name: '旧城的两种记忆', description: '同一座城市，会因选择而显出不同面貌。',
      atmospherePreset: 'DEFAULT', imgArr: '/pages/play/images/d_topic1.png',
      blocks: [
        { type: 'text', content: '一扇旧城门把记忆分成历史与艺术两条路。' },
        { type: 'node', nodeId: 1001 },
        { type: 'node', nodeId: 1002 },
        { type: 'node', nodeId: 1003 },
        { type: 'node', nodeId: 1004 },
        { type: 'node', nodeId: 1005 },
      ],
      cmsTopicNodeList: editorNodes(),
    }],
    tickets: [{
      id: 601, name: '验收票', price: 1, totalInventory: 100, mode: 1,
      startTime: '2026-08-24 09:00:00', endTime: '2026-12-31 23:59:59', meetingPoint: '旧城门',
    }],
    collaboratorIds: [90001],
  }
}

function playerNode(id) {
  const common = {
    validationMethod: 3,
    hasGame: true,
    chapterId: 501,
    longitude: 121.47 + (id - 1001) * 0.001,
    latitude: 31.23 + (id - 1001) * 0.001,
    options: { A: '选择 A', B: '选择 B' },
    question: '选择你的城市线索',
    feedbackText: '请选择一条可继续的路线。',
  }
  const rows = {
    1001: { name: '旧城门抉择', address: '旧城门', gameTitle: '选择历史或艺术', options: { A: '沿历史线索', B: '沿艺术线索' } },
    1002: { name: '历史支线', address: '城市档案馆', gameTitle: '完成历史线索' },
    1003: { name: '艺术支线', address: '街角画廊', gameTitle: '完成艺术线索' },
    1004: { name: '历史守望者结局', address: '城市档案馆顶层', gameTitle: '完成历史结局' },
    1005: { name: '艺术漫游者结局', address: '钟楼艺术露台', gameTitle: '完成艺术结局' },
  }
  return Object.assign({}, common, rows[id], { nodeId: id, sortId: id - 1000 })
}

function newPlayerSession(activityId) {
  return {
    activityId: String(activityId),
    version: 1,
    currentNodeId: 1001,
    recommendedNodeId: 1001,
    completed: [],
    chosenBranch: '',
    branchNodeId: null,
    decisionLog: [],
    actions: new Map(),
  }
}

function routeEdge(graph, fromNodeId, outcomeCode) {
  return ((graph && graph.edges) || []).find((edge) => Number(edge.fromNodeId) === Number(fromNodeId)
    && edge.trigger && String(edge.trigger.outcomeCode) === String(outcomeCode)) || null
}

function routeTarget(graph, fromNodeId, outcomeCode) {
  const edge = routeEdge(graph, fromNodeId, outcomeCode)
  if (edge) return Number(edge.toNodeId) || null
  const fallback = ((graph && graph.fallbacks) || [])
    .find((item) => Number(item.fromNodeId) === Number(fromNodeId))
  return fallback ? (Number(fallback.toNodeId) || null) : null
}

function routeState(session, graph) {
  const completed = new Set(session.completed)
  const states = {
    1001: completed.has(1001) ? 'COMPLETED' : 'PLAYABLE',
    1002: 'HIDDEN', 1003: 'HIDDEN', 1004: 'HIDDEN', 1005: 'HIDDEN',
  }
  // 首站选项提交前，后续地点都不进入 /nodes 公开投影。
  if (session.chosenBranch) {
    const selected = session.branchNodeId || routeTarget(graph, 1001, session.chosenBranch)
    const hidden = selected === 1002 ? 1003 : 1002
    states[selected] = completed.has(selected) ? 'COMPLETED' : 'PLAYABLE'
    states[hidden] = 'HIDDEN'
    if (completed.has(selected)) {
      const ending = routeTarget(graph, selected, 'COMPLETED')
      states[ending] = completed.has(ending) ? 'COMPLETED' : 'PLAYABLE'
    }
  }
  const selectedNodeId = session.branchNodeId || routeTarget(graph, 1001, session.chosenBranch)
  const endingNodeId = selectedNodeId ? routeTarget(graph, selectedNodeId, 'COMPLETED') : null
  const status = session.chosenBranch && completed.has(endingNodeId) ? 'COMPLETED' : 'ACTIVE'
  return {
    routeMode: 'BRANCH_GRAPH',
    sessionId: 'fixture-' + session.activityId,
    status,
    currentNodeId: session.currentNodeId,
    recommendedNodeId: status === 'COMPLETED' ? null : session.recommendedNodeId,
    version: session.version,
    nodeStates: states,
    lockReasons: {},
    decisionLog: clone(session.decisionLog),
  }
}

function visiblePlayerNodes(session, graph) {
  const state = routeState(session, graph)
  return Object.keys(state.nodeStates)
    .filter((id) => state.nodeStates[id] !== 'HIDDEN')
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => Object.assign(playerNode(id), {
      done: state.nodeStates[id] === 'COMPLETED',
      locked: state.nodeStates[id] === 'DISCOVERED_LOCKED',
    }))
}

function parseMaybeJson(value) {
  if (value == null || typeof value === 'object') return value || {}
  const text = String(value)
  try { return JSON.parse(text) } catch (error) {}
  return Object.fromEntries(new URLSearchParams(text).entries())
}

function createRouteGraphM5Fixture() {
  const topicState = {
    routeMode: 'BRANCH_GRAPH',
    routeGraphJson: JSON.stringify(savedBranchGraph()),
    configVersion: 1,
  }
  const sessions = new Map(Array.from(PLAYER_ACTIVITY_IDS, (id) => [id, newPlayerSession(id)]))
  const topicUpdates = []
  const playerWrites = []
  const requestLog = []
  const currentGraph = () => parseMaybeJson(topicState.routeGraphJson)

  function sessionOf(input) {
    const activityId = String((input && input.activityId) || '')
    if (!PLAYER_ACTIVITY_IDS.has(activityId)) return null
    return sessions.get(activityId)
  }

  function ok(data) {
    return { statusCode: 200, body: { code: 200, msg: 'ok', data } }
  }

  function conflict(message, data) {
    return { statusCode: 200, body: { code: 409, msg: message, data: data || null } }
  }

  function request(input) {
    const method = String(input.method || 'GET').toUpperCase()
    const pathname = input.path || '/'
    const query = input.query || {}
    const body = parseMaybeJson(input.body)
    requestLog.push({ method, path: pathname, query: clone(query), body: clone(body) })

    if (pathname === '/api/topic/edit-detail') return ok(editorDetail(topicState))
    if (pathname === '/api/topic/update') {
      const graph = parseMaybeJson(body.routeGraphJson)
      if (String(body.id) !== TOPIC_ID || body.routeMode !== 'BRANCH_GRAPH' || !graph || !Array.isArray(graph.edges)) {
        return { statusCode: 200, body: { code: 400, msg: '路线保存参数无效' } }
      }
      topicState.routeMode = body.routeMode
      topicState.routeGraphJson = JSON.stringify(graph)
      topicState.configVersion += 1
      topicUpdates.push({ routeMode: body.routeMode, routeGraphJson: topicState.routeGraphJson })
      return ok({ id: Number(TOPIC_ID), configVersion: topicState.configVersion })
    }
    if (pathname === '/api/play/nodes') {
      const session = sessionOf(query)
      if (!session) return { statusCode: 200, body: { code: 404, msg: '验收玩家会话不存在' } }
      const graph = currentGraph()
      return ok({
        topicId: Number(TOPIC_ID), topicName: 'M5 分支路线验收', mode: 1, playable: true, registered: true,
        nodes: visiblePlayerNodes(session, graph),
        chapters: [{ chapterId: 501, name: '旧城的两种记忆', description: '选择不同线索，将解锁不同城市结局。', totalMileage: 1.2 }],
        routeState: routeState(session, graph),
      })
    }
    if (pathname === '/api/play/route-state') {
      const session = sessionOf(query)
      return session ? ok(routeState(session, currentGraph())) : { statusCode: 200, body: { code: 404, msg: '验收玩家会话不存在' } }
    }
    if (pathname === '/api/play/answer') {
      const session = sessionOf(body)
      if (!session) return { statusCode: 200, body: { code: 404, msg: '验收玩家会话不存在' } }
      const nodeId = Number(body.nodeId)
      const actionId = String(body.routeActionId || '')
      const expectedVersion = Number(body.expectedRouteVersion)
      const graph = currentGraph()
      if (!actionId || !Number.isInteger(expectedVersion)) return conflict('缺少路线幂等键或版本', routeState(session, graph))
      if (session.actions.has(actionId)) return clone(session.actions.get(actionId))
      const state = routeState(session, graph)
      if (expectedVersion !== session.version || state.nodeStates[nodeId] !== 'PLAYABLE') {
        return conflict('路线状态已变化', state)
      }

      let outcomeCode = 'COMPLETED'
      let target = null
      if (nodeId === 1001) {
        outcomeCode = body.answer === 'B' ? 'ART' : 'HISTORY'
        target = routeTarget(graph, nodeId, outcomeCode)
        session.chosenBranch = outcomeCode
        session.branchNodeId = target
      } else if (nodeId === 1002 || nodeId === 1003) {
        target = routeTarget(graph, nodeId, outcomeCode)
      } else if ([1004, 1005].includes(nodeId)) {
        target = null
      } else {
        return conflict('节点不属于验收路线', state)
      }
      session.completed.push(nodeId)
      session.currentNodeId = target
      session.recommendedNodeId = target
      session.version += 1
      const chosenEdge = routeEdge(graph, nodeId, outcomeCode)
      session.decisionLog.push({
        fromNodeId: nodeId,
        outcomeCode,
        edgeId: chosenEdge ? chosenEdge.id : 'finish',
        toNodeId: target,
        reason: nodeId === 1001 ? '玩家选择' + (outcomeCode === 'ART' ? '艺术线' : '历史线')
          : ([1004, 1005].includes(nodeId) ? '专属结局完成' : '支线完成后解锁专属结局'),
        at: 1787500000000 + session.decisionLog.length,
      })
      const response = ok({
        completedAt: 1787500000000 + session.version,
        xp: 12,
        completed: [1004, 1005].includes(nodeId),
        routeState: routeState(session, graph),
      })
      session.actions.set(actionId, clone(response))
      playerWrites.push({ activityId: session.activityId, nodeId, answer: body.answer, routeActionId: actionId, expectedRouteVersion: expectedVersion })
      return response
    }

    if (pathname === '/api/ai/safety/precheck') return ok({ issues: [] })
    if (pathname === '/api/user/info') return ok({ id: 90001, nickname: 'M5 验收员', avatar: '' })
    if (pathname === '/api/club/my') return ok({ owned: [] })
    if (pathname === '/api/category/list') return ok([{ id: 1, categoryName: '城市探索' }])
    if (pathname === '/api/template/my-list') return ok({ rows: [] })
    if (pathname === '/api/template/homeData') return ok({ recommendList: [], hotList: [], latestList: [] })
    if (pathname === '/api/role/info') return ok({ role: 'creator', roles: ['creator'] })
    if (pathname === '/api/activity/list' || pathname === '/api/topic/list') return ok({ rows: [], total: 0 })
    if (pathname === '/api/config/features') return ok({})
    if (pathname === '/api/club/lead/team-progress') return { statusCode: 200, body: { code: 404, msg: '无带队会话' } }
    return ok([])
  }

  return {
    request,
    facts() {
      return {
        topicUpdates: clone(topicUpdates),
        playerWrites: clone(playerWrites),
        requests: clone(requestLog),
        sessions: Array.from(sessions.values(), (session) => routeState(session, currentGraph())),
      }
    },
  }
}

function startRouteGraphM5FixtureServer(backend, host) {
  const fixture = backend || createRouteGraphM5Fixture()
  const bindHost = host || '127.0.0.1'
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || bindHost}`)
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const result = fixture.request({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: raw,
      })
      res.writeHead(result.statusCode || 200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(result.body))
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, bindHost, () => {
      const address = server.address()
      resolve({
        backend: fixture,
        baseUrl: `http://${bindHost}:${address.port}`,
        close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
      })
    })
  })
}

module.exports = {
  createRouteGraphM5Fixture,
  savedBranchGraph,
  startRouteGraphM5FixtureServer,
}
