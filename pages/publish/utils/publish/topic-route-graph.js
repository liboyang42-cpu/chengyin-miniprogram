'use strict';

const ROUTE_MODES = Object.freeze({ LINEAR: 'LINEAR', BRANCH_GRAPH: 'BRANCH_GRAPH' });
const TRIGGER_TYPES = Object.freeze(['CHOICE', 'PREFERENCE_RESULT', 'ADVANCED_RESULT']);
const CONDITION_OPERATORS = Object.freeze(['EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'HAS_TAG', 'NODE_COMPLETED']);
const EFFECT_OPERATORS = Object.freeze(['SET', 'INC', 'ADD_TAG']);
const PURCHASE_KINDS = Object.freeze([1, 2, 3]);
const ROLE_CODES = Object.freeze(['NAVIGATOR', 'OBSERVER', 'RECORDER', 'NEGOTIATOR', 'DECODER']);

function emptyGraph() {
  return { schemaVersion: 1, startNodeId: '', terminalNodeIds: [], variables: {}, edges: [], fallbacks: [], nodeRequirements: [] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringId(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function nodeId(node) {
  return stringId(node && (node.id || node.clientNodeKey || node._localId));
}

function flattenNodes(chapters) {
  const result = [];
  (chapters || []).forEach((chapter, chapterIndex) => {
    (chapter.nodes || []).forEach((node, nodeIndex) => {
      const id = nodeId(node);
      if (!id) return;
      result.push(Object.assign({}, node, {
        id,
        clientNodeKey: stringId(node.clientNodeKey || node._localId),
        chapterIndex,
        nodeIndex,
        label: node.name || ('节点 ' + (result.length + 1)),
      }));
    });
  });
  return result;
}

function normalizeGraph(input) {
  let raw = input;
  if (typeof input === 'string') {
    if (!input.trim()) return { graph: emptyGraph(), error: '' };
    try { raw = JSON.parse(input); } catch (error) {
      return { graph: emptyGraph(), error: '路线 JSON 格式不正确' };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { graph: emptyGraph(), error: raw == null ? '' : '路线配置必须是对象' };
  }
  const graph = emptyGraph();
  graph.schemaVersion = Number(raw.schemaVersion) || 1;
  graph.startNodeId = stringId(raw.startNodeId);
  graph.terminalNodeIds = Array.isArray(raw.terminalNodeIds) ? raw.terminalNodeIds.map(stringId).filter(Boolean) : [];
  graph.variables = raw.variables && typeof raw.variables === 'object' && !Array.isArray(raw.variables) ? clone(raw.variables) : {};
  graph.edges = Array.isArray(raw.edges) ? raw.edges.map(normalizeEdge) : [];
  graph.fallbacks = Array.isArray(raw.fallbacks) ? raw.fallbacks.map((fallback) => ({
    fromNodeId: stringId(fallback && fallback.fromNodeId),
    toNodeId: stringId(fallback && fallback.toNodeId),
  })) : [];
  graph.nodeRequirements = Array.isArray(raw.nodeRequirements)
    ? raw.nodeRequirements.map(normalizeNodeRequirement) : [];
  return { graph, error: '' };
}

function normalizeNodeRequirement(requirement) {
  const raw = requirement && typeof requirement === 'object' && !Array.isArray(requirement) ? requirement : {};
  const normalized = raw.nodeKey && !raw.nodeId
    ? { nodeKey: stringId(raw.nodeKey) } : { nodeId: stringId(raw.nodeId) };
  ['allowedTicketIds', 'allowedPurchaseKinds', 'requiredRoleCodes'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(raw, field)) normalized[field] = clone(raw[field]);
  });
  ['requireOpen', 'requireReachable', 'maxDistanceMeters'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(raw, field)) normalized[field] = raw[field];
  });
  return normalized;
}

function normalizeEdge(edge, index) {
  const raw = edge && typeof edge === 'object' ? edge : {};
  const trigger = raw.trigger && typeof raw.trigger === 'object' ? raw.trigger : {};
  return {
    id: stringId(raw.id || ('edge_' + (index + 1))),
    fromNodeId: stringId(raw.fromNodeId),
    trigger: {
      type: TRIGGER_TYPES.includes(trigger.type) ? trigger.type : 'CHOICE',
      outcomeCode: stringId(trigger.outcomeCode),
    },
    conditions: Array.isArray(raw.conditions) ? raw.conditions.map(normalizeCondition) : [],
    effects: Array.isArray(raw.effects) ? raw.effects.map(normalizeEffect) : [],
    toNodeId: stringId(raw.toNodeId),
    priority: finiteNumber(raw.priority, 0),
    weight: numberOrInvalid(raw.weight, 1, 0),
    once: raw.once !== false,
    maxVisits: numberOrInvalid(raw.maxVisits, 1, -1),
    allowLoop: raw.allowLoop === true,
  };
}

function normalizeCondition(condition) {
  const raw = condition && typeof condition === 'object' ? condition : {};
  const op = stringId(raw.op || raw.operator || raw.type).toUpperCase();
  if (op === 'NODE_COMPLETED') {
    const reference = stringId(raw.nodeId || raw.nodeKey || raw.value);
    return raw.nodeKey && !raw.nodeId ? { op, nodeKey: reference } : { op, nodeId: reference };
  }
  if (op === 'HAS_TAG') return { op, value: stringId(raw.value || raw.tag) };
  return { var: stringId(raw.var || raw.variable || raw.name), op, value: raw.value };
}

function normalizeEffect(effect) {
  const raw = effect && typeof effect === 'object' ? effect : {};
  const op = stringId(raw.op || raw.type).toUpperCase();
  if (op === 'ADD_TAG') return { op, value: stringId(raw.value || raw.tag) };
  return { op, var: stringId(raw.var || raw.name), value: raw.value };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function numberOrInvalid(value, fallback, invalid) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : invalid;
}

function normalizeTopicRoute(topic) {
  const raw = topic || {};
  const parsed = normalizeGraph(raw.routeGraphJson);
  return {
    routeMode: raw.routeMode === ROUTE_MODES.BRANCH_GRAPH ? ROUTE_MODES.BRANCH_GRAPH : ROUTE_MODES.LINEAR,
    configVersion: stringId(raw.configVersion),
    graph: parsed.graph,
    error: parsed.error,
  };
}

function serialize(graph) {
  const payload = normalizeGraph(graph).graph;
  payload.nodeRequirements.forEach((requirement) => {
    const value = Number(requirement.nodeId);
    if (Number.isSafeInteger(value) && value > 0) requirement.nodeId = value;
  });
  return JSON.stringify(payload);
}

function serializeWithNodeKeys(input) {
  const graph = normalizeGraph(input).graph;
  const payload = clone(graph);
  payload.startNodeKey = payload.startNodeId;
  payload.terminalNodeKeys = payload.terminalNodeIds.slice();
  delete payload.startNodeId;
  delete payload.terminalNodeIds;
  payload.edges.forEach((edge) => {
    edge.fromNodeKey = edge.fromNodeId;
    edge.toNodeKey = edge.toNodeId;
    delete edge.fromNodeId;
    delete edge.toNodeId;
    edge.conditions = edge.conditions.map((condition) => {
      if (condition.op !== 'NODE_COMPLETED') return condition;
      const next = Object.assign({}, condition, { nodeKey: condition.nodeKey || condition.nodeId });
      delete next.nodeId;
      return next;
    });
  });
  payload.fallbacks.forEach((fallback) => {
    fallback.fromNodeKey = fallback.fromNodeId;
    fallback.toNodeKey = fallback.toNodeId;
    delete fallback.fromNodeId;
    delete fallback.toNodeId;
  });
  payload.nodeRequirements.forEach((requirement) => {
    requirement.nodeKey = requirement.nodeKey || requirement.nodeId;
    delete requirement.nodeId;
  });
  return JSON.stringify(payload);
}

function routeError(code, message, extra) {
  return Object.assign({ code, message, nodeId: '', edgeId: '', field: '' }, extra || {});
}

function validate(input, nodes, context) {
  const parsed = normalizeGraph(input);
  const graph = parsed.graph;
  const errors = [];
  const nodeList = (nodes || []).map((node) => Object.assign({}, node, { id: nodeId(node) })).filter((node) => node.id);
  const nodeIds = new Set(nodeList.map((node) => node.id));
  const nodeById = new Map(nodeList.map((node) => [node.id, node]));
  if (parsed.error) errors.push(routeError('INVALID_JSON', parsed.error, { field: 'routeGraphJson' }));
  if (graph.schemaVersion !== 1) errors.push(routeError('SCHEMA_VERSION', '只支持 schemaVersion = 1', { field: 'schemaVersion' }));
  if (!graph.startNodeId) errors.push(routeError('MISSING_START', '请选择起点', { field: 'startNodeId' }));
  else if (!nodeIds.has(graph.startNodeId)) errors.push(routeError('DANGLING_START', '起点不属于当前主题', { nodeId: graph.startNodeId, field: 'startNodeId' }));
  if (!graph.terminalNodeIds.length) errors.push(routeError('MISSING_TERMINAL', '请至少选择一个终点', { field: 'terminalNodeIds' }));
  graph.terminalNodeIds.forEach((id) => {
    if (!nodeIds.has(id)) errors.push(routeError('DANGLING_TERMINAL', '终点不属于当前主题', { nodeId: id, field: 'terminalNodeIds' }));
  });
  validateNodeRequirements(graph, nodeIds, context || {}, errors);

  const edgeIds = new Set();
  graph.edges.forEach((edge) => {
    if (edgeIds.has(edge.id)) errors.push(routeError('DUPLICATE_EDGE', '路线边 ID 重复', { edgeId: edge.id, field: 'id' }));
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.fromNodeId)) errors.push(routeError('DANGLING_SOURCE', '起始节点不属于当前主题', { edgeId: edge.id, nodeId: edge.fromNodeId, field: 'fromNodeId' }));
    if (!nodeIds.has(edge.toNodeId)) errors.push(routeError('DANGLING_TARGET', '目标节点不属于当前主题', { edgeId: edge.id, nodeId: edge.toNodeId, field: 'toNodeId' }));
    if (!TRIGGER_TYPES.includes(edge.trigger.type)) errors.push(routeError('INVALID_TRIGGER', '不支持的触发类型', { edgeId: edge.id, field: 'trigger.type' }));
    if (!edge.trigger.outcomeCode) errors.push(routeError('MISSING_OUTCOME', '请填写稳定 outcomeCode', { edgeId: edge.id, field: 'trigger.outcomeCode' }));
    const sourceNode = nodeById.get(edge.fromNodeId);
    if (sourceNode && Array.isArray(sourceNode.outcomes) && sourceNode.outcomes.length
        && !sourceNode.outcomes.some((outcome) => outcome.triggerType === edge.trigger.type
          && outcome.code === edge.trigger.outcomeCode)) {
      errors.push(routeError('UNKNOWN_OUTCOME', '源节点玩法没有声明这个 outcomeCode', {
        edgeId: edge.id, nodeId: edge.fromNodeId, field: 'trigger.outcomeCode'
      }));
    }
    if (!(edge.weight > 0)) errors.push(routeError('INVALID_WEIGHT', '权重必须大于 0', { edgeId: edge.id, field: 'weight' }));
    if (!Number.isInteger(edge.maxVisits) || edge.maxVisits < 0) errors.push(routeError('INVALID_MAX_VISITS', 'maxVisits 必须是非负整数', { edgeId: edge.id, field: 'maxVisits' }));
    edge.conditions.forEach((condition, index) => {
      const field = 'conditions[' + index + ']';
      if (!CONDITION_OPERATORS.includes(condition && condition.op)) {
        errors.push(routeError('INVALID_CONDITION', '不支持的条件运算符', { edgeId: edge.id, field: field + '.op' }));
      } else if (condition.op === 'NODE_COMPLETED' && !nodeIds.has(stringId(condition.nodeId))) {
        errors.push(routeError('DANGLING_CONDITION_NODE', '条件引用的节点不属于当前主题', {
          edgeId: edge.id, nodeId: stringId(condition.nodeId), field: field + '.nodeId'
        }));
      } else if (condition.op === 'HAS_TAG' && !stringId(condition.value).trim()) {
        errors.push(routeError('MISSING_CONDITION_VALUE', '标签条件必须填写标签', {
          edgeId: edge.id, field: field + '.value'
        }));
      } else if (!['NODE_COMPLETED', 'HAS_TAG'].includes(condition.op)) {
        if (!Object.prototype.hasOwnProperty.call(graph.variables, condition.var)) {
          errors.push(routeError('UNDECLARED_CONDITION_VAR', '条件必须选择已声明变量', {
            edgeId: edge.id, field: field + '.var'
          }));
        }
        if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
          errors.push(routeError('INVALID_CONDITION_VALUE', '比较条件值必须是数值', {
            edgeId: edge.id, field: field + '.value'
          }));
        }
      }
    });
    edge.effects.forEach((effect, index) => {
      if (!EFFECT_OPERATORS.includes(effect && effect.op)) {
        errors.push(routeError('INVALID_EFFECT', '不支持的路线效果', { edgeId: edge.id, field: 'effects[' + index + '].op' }));
      } else if (effect.op !== 'ADD_TAG' && !effect.var) {
        errors.push(routeError('MISSING_EFFECT_VAR', '路线效果必须选择变量', { edgeId: edge.id, field: 'effects[' + index + '].var' }));
      } else if (effect.op === 'ADD_TAG' && !stringId(effect.value)) {
        errors.push(routeError('MISSING_EFFECT_VALUE', '标签效果必须填写标签', { edgeId: edge.id, field: 'effects[' + index + '].value' }));
      }
    });
  });

  const fallbackBySource = new Map();
  graph.fallbacks.forEach((fallback, index) => {
    if (!nodeIds.has(fallback.fromNodeId)) errors.push(routeError('DANGLING_FALLBACK_SOURCE', 'fallback 起始节点不属于当前主题', { nodeId: fallback.fromNodeId, field: 'fallbacks[' + index + '].fromNodeId' }));
    if (!nodeIds.has(fallback.toNodeId)) errors.push(routeError('DANGLING_FALLBACK_TARGET', 'fallback 目标节点不属于当前主题', { nodeId: fallback.toNodeId, field: 'fallbacks[' + index + '].toNodeId' }));
    if (fallbackBySource.has(fallback.fromNodeId)) errors.push(routeError('DUPLICATE_FALLBACK', '每个节点只能配置一个 fallback', { nodeId: fallback.fromNodeId, field: 'fallbacks[' + index + ']' }));
    fallbackBySource.set(fallback.fromNodeId, fallback.toNodeId);
  });
  const outgoing = adjacency(graph);
  outgoing.forEach((edges, from) => {
    if (edges.length > 1 && !fallbackBySource.has(from)) {
      errors.push(routeError('MISSING_FALLBACK', '分支节点必须配置 fallback', { nodeId: from, field: 'fallbacks' }));
    }
  });
  const requirementIndexByNode = new Map(graph.nodeRequirements.map((requirement, index) => [
    stringId(requirement.nodeId), index
  ]));
  const missingRequirementFallbacks = new Set();
  graph.edges.forEach((edge) => {
    const requirementIndex = requirementIndexByNode.get(edge.toNodeId);
    const key = edge.fromNodeId + ':' + requirementIndex;
    if (requirementIndex !== undefined && !fallbackBySource.has(edge.fromNodeId)
        && !missingRequirementFallbacks.has(key)) {
      missingRequirementFallbacks.add(key);
      errors.push(routeError('MISSING_REQUIREMENT_FALLBACK', '现实门禁可能淘汰候选地点，来源节点必须配置 fallback', {
        edgeId: edge.id, nodeId: edge.toNodeId, field: 'nodeRequirements[' + requirementIndex + ']'
      }));
    }
  });

  const allConnections = graph.edges.map((edge) => ({ from: edge.fromNodeId, to: edge.toNodeId, edgeId: edge.id }))
    .concat(graph.fallbacks.map((fallback) => ({ from: fallback.fromNodeId, to: fallback.toNodeId, edgeId: '' })));
  const reachable = walk(graph.startNodeId, allConnections, false);
  nodeIds.forEach((id) => {
    if (graph.startNodeId && !reachable.has(id)) errors.push(routeError('UNREACHABLE_NODE', '节点无法从起点到达', { nodeId: id, field: 'nodes' }));
  });
  const canReachTerminal = new Set();
  graph.terminalNodeIds.forEach((terminal) => walk(terminal, allConnections, true).forEach((id) => canReachTerminal.add(id)));
  reachable.forEach((id) => {
    if (!canReachTerminal.has(id)) errors.push(routeError('NO_TERMINAL_PATH', '节点没有通往终点的路线', { nodeId: id, field: 'edges' }));
  });

  findCycleEdges(graph.edges).forEach((edge) => {
    if (!(edge.allowLoop && edge.maxVisits > 0)) errors.push(routeError('ILLEGAL_CYCLE', '循环边必须显式开启 allowLoop 并限制 maxVisits', { edgeId: edge.id, nodeId: edge.fromNodeId, field: 'allowLoop' }));
  });

  return { valid: errors.length === 0, errors, graph, reachableNodeIds: Array.from(reachable), terminalReachableNodeIds: Array.from(canReachTerminal) };
}

function validateNodeRequirements(graph, nodeIds, context, errors) {
  const seenNodes = new Set();
  const allowedTicketIds = Array.isArray(context.allowedTicketIds)
    ? new Set(context.allowedTicketIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)) : null;
  graph.nodeRequirements.forEach((requirement, index) => {
    const prefix = 'nodeRequirements[' + index + ']';
    const id = stringId(requirement.nodeId);
    if (!nodeIds.has(id)) {
      errors.push(routeError('DANGLING_REQUIREMENT_NODE', '现实门禁节点不属于当前主题', {
        nodeId: id, field: prefix + '.nodeId'
      }));
    }
    if (seenNodes.has(id)) {
      errors.push(routeError('DUPLICATE_NODE_REQUIREMENT', '同一节点只能配置一条现实门禁', {
        nodeId: id, field: prefix + '.nodeId'
      }));
    }
    seenNodes.add(id);
    validateRequirementArray(requirement, index, 'allowedTicketIds', null, allowedTicketIds, errors);
    validateRequirementArray(requirement, index, 'allowedPurchaseKinds', PURCHASE_KINDS, null, errors);
    validateRequirementArray(requirement, index, 'requiredRoleCodes', ROLE_CODES, null, errors);
    ['requireOpen', 'requireReachable'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(requirement, field) && typeof requirement[field] !== 'boolean') {
        errors.push(routeError('INVALID_REQUIREMENT_BOOLEAN', '现实门禁开关必须是布尔值', {
          nodeId: id, field: prefix + '.' + field
        }));
      }
    });
    if (Object.prototype.hasOwnProperty.call(requirement, 'maxDistanceMeters')
        && (typeof requirement.maxDistanceMeters !== 'number'
          || !Number.isFinite(requirement.maxDistanceMeters)
          || requirement.maxDistanceMeters <= 0
          || requirement.maxDistanceMeters > 1000000)) {
      errors.push(routeError('INVALID_REQUIREMENT_DISTANCE', '距离必须大于 0 且不超过 1000000 米', {
        nodeId: id, field: prefix + '.maxDistanceMeters'
      }));
    }
  });
}

function validateRequirementArray(requirement, requirementIndex, field, allowedValues, allowedTicketIds, errors) {
  if (!Object.prototype.hasOwnProperty.call(requirement, field)) return;
  const prefix = 'nodeRequirements[' + requirementIndex + '].' + field;
  const values = requirement[field];
  if (!Array.isArray(values) || !values.length) {
    errors.push(routeError('INVALID_REQUIREMENT_ARRAY', '现实门禁选项必须是非空数组', {
      nodeId: stringId(requirement.nodeId), field: prefix
    }));
    return;
  }
  const seen = new Set();
  values.forEach((value, index) => {
    const canonical = field === 'requiredRoleCodes' ? value : Number(value);
    const validType = field === 'requiredRoleCodes'
      ? typeof value === 'string'
      : typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    if (!validType || (allowedValues && !allowedValues.includes(canonical))) {
      errors.push(routeError('INVALID_REQUIREMENT_VALUE', '现实门禁选项值不受支持', {
        nodeId: stringId(requirement.nodeId), field: prefix + '[' + index + ']'
      }));
    } else if (seen.has(canonical)) {
      errors.push(routeError('INVALID_REQUIREMENT_VALUE', '现实门禁选项不能重复', {
        nodeId: stringId(requirement.nodeId), field: prefix + '[' + index + ']'
      }));
    } else if (allowedTicketIds && !allowedTicketIds.has(canonical)) {
      errors.push(routeError('UNKNOWN_REQUIREMENT_TICKET', '票种不属于当前主题或尚未保存', {
        nodeId: stringId(requirement.nodeId), field: prefix + '[' + index + ']'
      }));
    }
    seen.add(canonical);
  });
}

function adjacency(graph) {
  const map = new Map();
  graph.edges.forEach((edge) => {
    const list = map.get(edge.fromNodeId) || [];
    list.push(edge);
    map.set(edge.fromNodeId, list);
  });
  return map;
}

function walk(start, connections, reverse) {
  const seen = new Set();
  if (!start) return seen;
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    connections.forEach((connection) => {
      const from = reverse ? connection.to : connection.from;
      const to = reverse ? connection.from : connection.to;
      if (from === current && !seen.has(to)) queue.push(to);
    });
  }
  return seen;
}

function findCycleEdges(edges) {
  const outgoing = new Map();
  edges.forEach((edge) => {
    const list = outgoing.get(edge.fromNodeId) || [];
    list.push(edge);
    outgoing.set(edge.fromNodeId, list);
  });
  return edges.filter((edge) => walk(edge.toNodeId, edges.map((candidate) => ({ from: candidate.fromNodeId, to: candidate.toNodeId })), false).has(edge.fromNodeId));
}

function buildPreview(input, nodes, runtime, context) {
  const validation = validate(input, nodes, context);
  const graph = validation.graph;
  const state = runtime || {};
  const completed = new Set((state.completedNodeIds || []).map(stringId));
  const errorNodes = new Set(validation.errors.map((error) => error.nodeId).filter(Boolean));
  const errorEdges = new Set(validation.errors.map((error) => error.edgeId).filter(Boolean));
  const terminal = new Set(graph.terminalNodeIds);
  const nodeMap = new Map((nodes || []).map((node) => [nodeId(node), node.name || node.label || nodeId(node)]));
  return {
    valid: validation.valid,
    errors: validation.errors,
    nodes: Array.from(nodeMap.entries()).map(([id, label]) => ({
      id, label,
      state: errorNodes.has(id) ? 'ERROR' : completed.has(id) ? 'COMPLETED' : stringId(state.currentNodeId) === id ? 'CURRENT' : terminal.has(id) ? 'TERMINAL' : 'AVAILABLE',
      start: graph.startNodeId === id,
      terminal: terminal.has(id),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      fromLabel: nodeMap.get(edge.fromNodeId) || '未知节点',
      toNodeId: edge.toNodeId,
      toLabel: nodeMap.get(edge.toNodeId) || '未知节点',
      label: edge.trigger.type + ' · ' + (edge.trigger.outcomeCode || '未配置结果'),
      fallback: false,
      error: errorEdges.has(edge.id),
    })).concat(graph.fallbacks.map((fallback, index) => ({
      id: 'fallback_' + index,
      fromNodeId: fallback.fromNodeId,
      fromLabel: nodeMap.get(fallback.fromNodeId) || '未知节点',
      toNodeId: fallback.toNodeId,
      toLabel: nodeMap.get(fallback.toNodeId) || '未知节点',
      label: 'fallback', fallback: true, error: errorNodes.has(fallback.fromNodeId) || errorNodes.has(fallback.toNodeId),
    }))),
  };
}

function matchesTrigger(edge, outcome) {
  const input = outcome || {};
  return edge.trigger.type === input.type && edge.trigger.outcomeCode === stringId(input.outcomeCode);
}

function conditionValue(condition, state) {
  if (condition.op === 'HAS_TAG') return (state.tags || []).includes(condition.value);
  if (condition.op === 'NODE_COMPLETED') return (state.completedNodeIds || []).map(stringId).includes(stringId(condition.nodeId));
  const actual = (state.variables || {})[condition.var];
  if (condition.op === 'EQ') return actual === condition.value;
  if (condition.op === 'NE') return actual !== condition.value;
  if (condition.op === 'GT') return actual > condition.value;
  if (condition.op === 'GTE') return actual >= condition.value;
  if (condition.op === 'LT') return actual < condition.value;
  if (condition.op === 'LTE') return actual <= condition.value;
  return false;
}

function applyEffects(effects, state) {
  (effects || []).forEach((effect) => {
    if (effect.op === 'ADD_TAG') {
      if (!state.tags.includes(effect.value)) state.tags.push(effect.value);
    } else if (effect.op === 'SET') state.variables[effect.var] = effect.value;
    else if (effect.op === 'INC') state.variables[effect.var] = Number(state.variables[effect.var] || 0) + Number(effect.value || 0);
  });
}

function distanceMeters(left, right) {
  if (!left || !right) return null;
  const leftLat = Number(left.latitude != null ? left.latitude : left.lat);
  const leftLng = Number(left.longitude != null ? left.longitude : left.lng);
  const rightLat = Number(right.latitude != null ? right.latitude : right.lat);
  const rightLng = Number(right.longitude != null ? right.longitude : right.lng);
  if (![leftLat, leftLng, rightLat, rightLng].every(Number.isFinite)) return null;
  const radians = (value) => value * Math.PI / 180;
  const latDelta = radians(rightLat - leftLat);
  const lngDelta = radians(rightLng - leftLng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(lngDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function seededFraction(seed) {
  let hash = 2166136261;
  const text = String(seed || 'preview');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function previewNext(input, state, outcome, seed) {
  const graph = normalizeGraph(input).graph;
  const currentNodeId = stringId(state && state.currentNodeId);
  const visits = (state && state.visits) || {};
  let candidates = graph.edges.filter((edge) => edge.fromNodeId === currentNodeId && matchesTrigger(edge, outcome));
  candidates = candidates.filter((edge) => edge.conditions.every((condition) => conditionValue(condition, state || {})));
  candidates = candidates.filter((edge) => !(edge.once && Number(visits[edge.id] || 0) > 0)
    && !(edge.maxVisits > 0 && Number(visits[edge.id] || 0) >= edge.maxVisits));
  if (!candidates.length) {
    const fallback = graph.fallbacks.find((item) => item.fromNodeId === currentNodeId);
    return fallback
      ? { selectedEdgeId: '', toNodeId: fallback.toNodeId, candidateEdgeIds: [], fallback: true, reason: '没有符合条件的路线边，使用显式 fallback' }
      : { selectedEdgeId: '', toNodeId: '', candidateEdgeIds: [], fallback: false, reason: '没有符合条件的路线边，且未配置 fallback' };
  }
  const maxPriority = Math.max.apply(null, candidates.map((edge) => edge.priority));
  candidates = candidates.filter((edge) => edge.priority === maxPriority);
  const total = candidates.reduce((sum, edge) => sum + edge.weight, 0);
  let cursor = seededFraction(seed + ':' + currentNodeId + ':' + stringId(outcome && outcome.outcomeCode)) * total;
  let selected = candidates[candidates.length - 1];
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= candidates[index].weight;
    if (cursor < 0) { selected = candidates[index]; break; }
  }
  return {
    selectedEdgeId: selected.id,
    toNodeId: selected.toNodeId,
    candidateEdgeIds: candidates.map((edge) => edge.id),
    fallback: false,
    reason: '最高优先级 ' + maxPriority + ' 内按权重确定性选择',
  };
}

function cloneSubgraph(input, selectedNodeIds, keyFactory) {
  const graph = normalizeGraph(input).graph;
  const selected = new Set((selectedNodeIds || []).map(stringId));
  const factory = keyFactory || ((kind, id) => kind + '_copy_' + id);
  const nodeIdMap = {};
  selected.forEach((id) => { nodeIdMap[id] = stringId(factory('node', id)); });
  const edges = graph.edges.filter((edge) => selected.has(edge.fromNodeId) && selected.has(edge.toNodeId)).map((edge) => {
    const copied = Object.assign({}, clone(edge), {
      id: stringId(factory('edge', edge.id)),
      fromNodeId: nodeIdMap[edge.fromNodeId],
      toNodeId: nodeIdMap[edge.toNodeId],
    });
    copied.conditions = copied.conditions.map((condition) => {
      if (condition.op !== 'NODE_COMPLETED') return condition;
      const oldId = stringId(condition.nodeKey || condition.nodeId);
      const mapped = nodeIdMap[oldId] || '';
      return condition.nodeKey
        ? Object.assign({}, condition, { nodeKey: mapped })
        : Object.assign({}, condition, { nodeId: mapped });
    });
    return copied;
  });
  const fallbacks = graph.fallbacks.filter((fallback) => selected.has(fallback.fromNodeId) && selected.has(fallback.toNodeId)).map((fallback) => ({
    fromNodeId: nodeIdMap[fallback.fromNodeId], toNodeId: nodeIdMap[fallback.toNodeId],
  }));
  let omittedTicketRestrictionCount = 0;
  const nodeRequirements = graph.nodeRequirements.filter((requirement) => selected.has(stringId(requirement.nodeId)))
    .map((requirement) => {
      const copied = Object.assign({}, clone(requirement), { nodeId: nodeIdMap[stringId(requirement.nodeId)] });
      if (Object.prototype.hasOwnProperty.call(copied, 'allowedTicketIds')) {
        delete copied.allowedTicketIds;
        omittedTicketRestrictionCount += 1;
      }
      return copied;
    });
  return {
    nodeIdMap,
    startNodeId: nodeIdMap[graph.startNodeId] || '',
    terminalNodeIds: graph.terminalNodeIds.filter((id) => selected.has(id)).map((id) => nodeIdMap[id]),
    edges,
    fallbacks,
    nodeRequirements,
    omittedTicketRestrictionCount,
  };
}

function simulate(input, nodes, options) {
  const graph = normalizeGraph(input).graph;
  const settings = options || {};
  const runs = Math.max(1000, Math.min(10000, Number(settings.runs) || 1000));
  const terminal = new Set(graph.terminalNodeIds);
  const edgeCounts = {};
  const nodeCounts = {};
  const terminalCounts = {};
  let deadEnds = 0;
  let infiniteLoops = 0;
  let repeatedNodeVisits = 0;
  const lengths = [];
  const distances = [];
  let unknownDistanceRuns = 0;
  const nodeMap = new Map((nodes || []).map((node) => [nodeId(node), node]));
  const maxSteps = Math.max(10, Number(settings.maxSteps) || Math.max((nodes || []).length * 10, 50));
  for (let run = 0; run < runs; run += 1) {
    const state = { currentNodeId: graph.startNodeId, variables: clone(graph.variables), tags: [], completedNodeIds: [], visits: {} };
    const seenNodes = new Set();
    let length = 0;
    let distance = 0;
    let distanceKnown = true;
    while (!terminal.has(state.currentNodeId) && length < maxSteps) {
      nodeCounts[state.currentNodeId] = (nodeCounts[state.currentNodeId] || 0) + 1;
      if (seenNodes.has(state.currentNodeId)) repeatedNodeVisits += 1;
      seenNodes.add(state.currentNodeId);
      const configured = settings.outcomes && settings.outcomes[state.currentNodeId];
      const outcomes = (Array.isArray(configured) ? configured : (configured ? [configured] : graph.edges
        .filter((edge) => edge.fromNodeId === state.currentNodeId)
        .map((edge) => edge.trigger)))
        .filter((item, index, list) => item && list.findIndex((other) => other.type === item.type
          && stringId(other.outcomeCode) === stringId(item.outcomeCode)) === index);
      const outcome = outcomes.length ? clone(outcomes[(run + length) % outcomes.length]) : null;
      if (!outcome) { deadEnds += 1; break; }
      const decision = previewNext(graph, state, outcome, stringId(settings.seed || 'simulation') + ':' + run + ':' + length);
      if (!decision.toNodeId) { deadEnds += 1; break; }
      if (decision.selectedEdgeId) {
        const selected = graph.edges.find((edge) => edge.id === decision.selectedEdgeId);
        edgeCounts[decision.selectedEdgeId] = (edgeCounts[decision.selectedEdgeId] || 0) + 1;
        state.visits[decision.selectedEdgeId] = Number(state.visits[decision.selectedEdgeId] || 0) + 1;
        if (selected) applyEffects(selected.effects, state);
      }
      const legDistance = distanceMeters(nodeMap.get(state.currentNodeId), nodeMap.get(decision.toNodeId));
      if (legDistance == null) distanceKnown = false;
      else distance += legDistance;
      state.completedNodeIds.push(state.currentNodeId);
      state.currentNodeId = decision.toNodeId;
      length += 1;
    }
    if (terminal.has(state.currentNodeId)) {
      nodeCounts[state.currentNodeId] = (nodeCounts[state.currentNodeId] || 0) + 1;
      terminalCounts[state.currentNodeId] = (terminalCounts[state.currentNodeId] || 0) + 1;
    } else if (length >= maxSteps) infiniteLoops += 1;
    lengths.push(length);
    if (distanceKnown) distances.push(distance);
    else unknownDistanceRuns += 1;
  }
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
  const uncoveredEdgeIds = graph.edges.map((edge) => edge.id).filter((edgeId) => !edgeCounts[edgeId]);
  const edgeCoverage = graph.edges.length ? Object.keys(edgeCounts).length / graph.edges.length : 1;
  const terminalDistributionText = Object.keys(terminalCounts).sort()
    .map((nodeId) => nodeId + ' ' + terminalCounts[nodeId] + '局').join(' · ');
  return {
    runs,
    edgeCounts,
    nodeCounts,
    terminalCounts,
    terminalDistributionText: terminalDistributionText || '无终点',
    edgeCoverage,
    edgeCoveragePercent: Math.round(edgeCoverage * 10000) / 100,
    uncoveredEdgeIds,
    nodeCoverage: (nodes || []).length ? Object.keys(nodeCounts).length / (nodes || []).length : 1,
    averageLength: totalLength / runs,
    minLength: Math.min.apply(null, lengths),
    maxLength: Math.max.apply(null, lengths),
    averageDistanceMeters: distances.length ? totalDistance / distances.length : null,
    minDistanceMeters: distances.length ? Math.min.apply(null, distances) : null,
    maxDistanceMeters: distances.length ? Math.max.apply(null, distances) : null,
    unknownDistanceRuns,
    deadEnds,
    infiniteLoops,
    repeatedNodeVisits,
    releaseReady: deadEnds === 0 && infiniteLoops === 0 && uncoveredEdgeIds.length === 0,
  };
}

module.exports = {
  ROUTE_MODES,
  TRIGGER_TYPES,
  CONDITION_OPERATORS,
  EFFECT_OPERATORS,
  PURCHASE_KINDS,
  ROLE_CODES,
  emptyGraph,
  flattenNodes,
  normalizeGraph,
  normalizeTopicRoute,
  serialize,
  serializeWithNodeKeys,
  validate,
  buildPreview,
  previewNext,
  cloneSubgraph,
  simulate,
};
