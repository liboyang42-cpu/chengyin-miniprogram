const ROUTE_MODE_LINEAR = 'LINEAR'
const ROUTE_MODE_BRANCH = 'BRANCH_GRAPH'
const NODE_STATES = new Set(['HIDDEN', 'DISCOVERED_LOCKED', 'PLAYABLE', 'COMPLETED'])

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value) {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch (error) {
    return {}
  }
}

function normalizeRouteState(raw) {
  const source = asRecord(raw)
  const routeMode = String(source.routeMode || '').toUpperCase() === ROUTE_MODE_BRANCH
    ? ROUTE_MODE_BRANCH
    : ROUTE_MODE_LINEAR
  const rawStates = asRecord(source.nodeStates)
  const nodeStates = {}
  Object.keys(rawStates).forEach((nodeId) => {
    const state = String(rawStates[nodeId] || '').toUpperCase()
    if (NODE_STATES.has(state)) nodeStates[String(nodeId)] = state
  })
  return {
    routeMode,
    sessionId: source.sessionId == null ? '' : String(source.sessionId),
    status: source.status == null ? '' : String(source.status).toUpperCase(),
    currentNodeId: source.currentNodeId == null ? null : source.currentNodeId,
    recommendedNodeId: source.recommendedNodeId == null ? null : source.recommendedNodeId,
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : null,
    nodeStates,
    decisionLog: Array.isArray(source.decisionLog) ? source.decisionLog.filter(isRecord) : [],
    lockReasons: asRecord(source.lockReasons),
  }
}

function sameNodeId(left, right) {
  return left != null && right != null && String(left) === String(right)
}

function asTimestamp(value) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function nodeRouteState(routeState, nodeId) {
  if (!routeState || routeState.routeMode !== ROUTE_MODE_BRANCH) return ''
  return routeState.nodeStates[String(nodeId)] || 'HIDDEN'
}

function decisionFacts(routeState) {
  const order = {}
  const completedAt = {}
  ;(routeState && routeState.decisionLog || []).forEach((entry, index) => {
    const at = asTimestamp(entry.at != null ? entry.at : entry.completedAt)
    const completedId = entry.completedNodeId != null ? entry.completedNodeId
      : (entry.nodeId != null ? entry.nodeId : entry.fromNodeId)
    if (completedId != null) {
      const key = String(completedId)
      if (order[key] == null) order[key] = index * 2
      if (at > 0 && completedAt[key] == null) completedAt[key] = at
    }
    if (entry.toNodeId != null) {
      const key = String(entry.toNodeId)
      if (order[key] == null) order[key] = index * 2 + 1
    }
  })
  return { order, completedAt }
}

function applyRouteStateToNodes(nodes, routeStateInput) {
  const routeState = normalizeRouteState(routeStateInput)
  const rows = Array.isArray(nodes) ? nodes : []
  if (routeState.routeMode !== ROUTE_MODE_BRANCH) return rows.slice()
  const facts = decisionFacts(routeState)
  return rows.reduce((visible, node) => {
    if (!node || node.nodeId == null) return visible
    const state = nodeRouteState(routeState, node.nodeId)
    if (state === 'HIDDEN') return visible
    const key = String(node.nodeId)
    const completedAt = facts.completedAt[key]
    visible.push(Object.assign({}, node, {
      routeNodeState: state,
      routeDecisionOrder: facts.order[key] == null ? Number.MAX_SAFE_INTEGER : facts.order[key],
      locked: state === 'DISCOVERED_LOCKED',
      playable: state === 'PLAYABLE',
      done: state === 'COMPLETED',
      doneAt: state === 'COMPLETED'
        ? (completedAt || asTimestamp(node.completedAt) || asTimestamp(node.doneAt) || 0)
        : (Number(node.doneAt) || 0),
      lockReason: state === 'DISCOVERED_LOCKED'
        ? (routeState.lockReasons[key] || node.lockReason || '完成当前路线后解锁')
        : '',
    }))
    return visible
  }, [])
}

function findNode(nodes, nodeId) {
  return (nodes || []).find((node) => node && sameNodeId(node.nodeId, nodeId)) || null
}

function resolveNextRouteNode(nodes, routeStateInput) {
  const routeState = normalizeRouteState(routeStateInput)
  const rows = Array.isArray(nodes) ? nodes : []
  if (routeState.routeMode !== ROUTE_MODE_BRANCH) {
    return rows.filter((node) => node && !node.done)
      .slice()
      .sort((left, right) => (Number(left.sortId) || 0) - (Number(right.sortId) || 0))[0] || null
  }
  const candidateIds = [routeState.recommendedNodeId, routeState.currentNodeId]
  for (let i = 0; i < candidateIds.length; i++) {
    const node = findNode(rows, candidateIds[i])
    if (node && !node.done && node.routeNodeState !== 'COMPLETED'
        && nodeRouteState(routeState, node.nodeId) === 'PLAYABLE') return node
  }
  return null
}

function orderedJourneyNodes(nodes, routeStateInput) {
  const routeState = normalizeRouteState(routeStateInput)
  const rows = Array.isArray(nodes) ? nodes.slice() : []
  if (routeState.routeMode !== ROUTE_MODE_BRANCH) {
    return rows.sort((left, right) => (Number(left.sortId) || 0) - (Number(right.sortId) || 0))
  }
  const rank = (node) => {
    if (node.done || node.routeNodeState === 'COMPLETED') return 0
    if (sameNodeId(node.nodeId, routeState.currentNodeId)
        || sameNodeId(node.nodeId, routeState.recommendedNodeId)) return 1
    return 2
  }
  return rows.sort((left, right) => {
    const group = rank(left) - rank(right)
    if (group) return group
    const leftDecision = Number.isFinite(Number(left.routeDecisionOrder)) ? Number(left.routeDecisionOrder) : Number.MAX_SAFE_INTEGER
    const rightDecision = Number.isFinite(Number(right.routeDecisionOrder)) ? Number(right.routeDecisionOrder) : Number.MAX_SAFE_INTEGER
    const decision = leftDecision - rightDecision
    if (decision) return decision
    const completed = (Number(left.doneAt) || Number.MAX_SAFE_INTEGER)
      - (Number(right.doneAt) || Number.MAX_SAFE_INTEGER)
    if (completed) return completed
    return (Number(left.sortId) || 0) - (Number(right.sortId) || 0)
  })
}

function buildVisibleRoutePath(nodes, routeStateInput) {
  const routeState = normalizeRouteState(routeStateInput)
  if (routeState.routeMode !== ROUTE_MODE_BRANCH) return Array.isArray(nodes) ? nodes.slice() : []
  const ordered = orderedJourneyNodes(nodes, routeState)
  const path = ordered.filter((node) => node && (node.done || node.routeNodeState === 'COMPLETED'))
  const next = resolveNextRouteNode(ordered, routeState)
  if (next && !path.some((node) => sameNodeId(node.nodeId, next.nodeId))) path.push(next)
  return path
}

function defaultActionId() {
  return 'route-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

function createRouteActionStore(idFactory) {
  const makeId = typeof idFactory === 'function' ? idFactory : defaultActionId
  const pending = Object.create(null)
  const keyOf = (kind, nodeId) => String(kind || 'complete') + ':' + String(nodeId == null ? '' : nodeId)
  return {
    context(kind, nodeId, routeStateInput) {
      const key = keyOf(kind, nodeId)
      if (!pending[key]) pending[key] = String(makeId())
      const routeState = normalizeRouteState(routeStateInput)
      return {
        routeActionId: pending[key],
        expectedRouteVersion: routeState.version,
      }
    },
    resolve(kind, nodeId) {
      delete pending[keyOf(kind, nodeId)]
    },
    clear() {
      Object.keys(pending).forEach((key) => delete pending[key])
    },
  }
}

function isRouteConflict(response) {
  const source = isRecord(response) ? response : {}
  const code = String(source.upstreamCode != null && source.upstreamCode !== '' ? source.upstreamCode : (source.code || '')).toUpperCase()
  if (code === '409' || code === 'ROUTE_VERSION_CONFLICT' || code === 'STALE_ROUTE_VERSION') return true
  const message = String(source.msg || '')
  return /(?:路线|route).*(?:冲突|已更新|过期)|(?:版本|version).*(?:冲突|已更新|过期)/i.test(message)
}

module.exports = {
  ROUTE_MODE_LINEAR,
  ROUTE_MODE_BRANCH,
  normalizeRouteState,
  applyRouteStateToNodes,
  resolveNextRouteNode,
  orderedJourneyNodes,
  buildVisibleRoutePath,
  createRouteActionStore,
  isRouteConflict,
}
