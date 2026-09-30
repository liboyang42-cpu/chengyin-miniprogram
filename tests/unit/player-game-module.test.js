const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizePlayerProjection,
  buildPlayerChoiceInput,
  buildPlayerSubmissionInput,
  buildPlayerRoleConfirmInput,
  buildPlayerHintInput,
  buildPlayerRevealInput,
  mergeConfirmedReceipt,
  completedRouteSegment,
  normalizePlayerPendingWrite,
  normalizePlayerPendingReceiptIndex,
} = require('../../pages/play/utils/player-game-module.js')

test('玩家投影只保留本角色可见字段，未知和隐藏字段 fail closed', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 4,
    availableActions: ['PLAYER_SUBMIT', 'PLAYER_HINT'],
    snapshotAt: '2026-08-23T10:00:00Z',
    configSnapshotJson: '{"answer":"leak"}',
    player: {
      teamId: 8,
      role: { code: 'SCOUT', name: '侦察员', confirmed: false, secret: '不应透传' },
      nodes: [{
        nodeId: 11,
        personalState: 'AVAILABLE',
        playable: false,
        clue: '看门牌第三行',
        playerTask: {
          taskCode: 'CLOCK_WORD', prompt: '向店员说出钟楼暗号', inputType: 'TEXT',
          verificationRequired: true, answer: '不应透传',
        },
        allowedChoices: [{ id: 'A', label: '记录蓝色符号', hiddenEffect: 'ending_b' }],
        answer: '不应透传',
      }],
      mySubmissions: [{ submissionId: 301, nodeId: 11, taskCode: 'CLOCK_WORD', status: 'PENDING', evidenceJson: '不应透传' }],
      teamActions: [{ memberId: 12, displayName: '队友甲', roleCode: 'DECODER', status: 'COMPLETED', latitude: 31.2, longitude: 121.4 }],
      story: { visibleVariables: [{ code: 'trust', value: 'HIGH' }], ending: null, hiddenVariables: { culprit: 1 } },
    },
    merchant: { stations: [{ answer: '不应存在' }] },
  })

  assert.equal(view.enabled, true)
  assert.equal(view.canSubmitTask, true)
  assert.equal(view.role.code, 'SCOUT')
  assert.equal(view.role.name, '侦察员')
  assert.equal(view.role.confirmed, false)
  assert.equal(view.role.secret, undefined)
  assert.deepEqual(view.nodes[0].choices, [{ id: 'A', label: '记录蓝色符号' }])
  assert.equal(view.nodes[0].answer, undefined)
  assert.deepEqual(view.nodes[0].playerTask, {
    taskCode: 'CLOCK_WORD', prompt: '向店员说出钟楼暗号', inputType: 'TEXT', verificationRequired: true,
  })
  assert.equal(view.hiddenVariables, undefined)
  assert.equal(view.merchant, undefined)
  assert.deepEqual(view.story.visibleVariables, [{ code: 'trust', value: 'HIGH' }])
  assert.deepEqual(view.teamActions, [{ memberId: 12, displayName: '队友甲', roleCode: 'DECODER', status: 'COMPLETED', statusLabel: '已完成' }])
  assert.equal(view.teamActions[0].latitude, undefined)
  assert.deepEqual(view.mySubmissions, [{
    submissionId: 301, nodeId: 11, taskCode: 'CLOCK_WORD', status: 'PENDING', statusLabel: '待商家核验',
  }])
  assert.deepEqual(view.nodes[0].submission, {
    submissionId: 301, nodeId: 11, taskCode: 'CLOCK_WORD', status: 'PENDING', statusLabel: '待商家核验',
  })
  assert.equal(view.mySubmissions[0].evidenceJson, undefined)
})

test('玩家投影严格适配服务端角色状态、公开变量对象与结局正文', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 5,
    player: {
      teamId: 8,
      role: { code: 'SCOUT', name: '侦察员', status: 'CONFIRMED', publicBrief: '负责发现现场线索' },
      nodes: [{
        nodeId: 11, personalState: 'IN_PROGRESS', playable: true, clue: '看门牌第三行',
        playerTask: { taskCode: 'CLOCK_WORD', prompt: '扫描本站任务码', inputType: 'SCAN', verificationRequired: true },
        allowedChoices: [],
      }],
      story: {
        visibleVariables: { trust: 2, alarm: false },
        ending: { code: 'FOUND', title: '真相浮现', text: '队伍找到了最后一块证据。' },
      },
    },
  })

  assert.equal(view.role.confirmed, true)
  assert.equal(view.role.publicBrief, '负责发现现场线索')
  assert.equal(view.nodes[0].status, 'IN_PROGRESS')
  assert.equal(view.nodes[0].playerTask.inputType, 'SCAN')
  assert.deepEqual(view.story.visibleVariables, [
    { code: 'trust', value: 2 },
    { code: 'alarm', value: false },
  ])
  assert.deepEqual(view.story.ending, {
    code: 'FOUND', title: '真相浮现', summary: '队伍找到了最后一块证据。',
  })
})

test('D05 提示只投影已揭示正文，命令只能按服务端 nextLevel 请求 1→2', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 5,
    player: {
      teamId: 8,
      role: {},
      nodes: [{
        nodeId: 11,
        personalState: 'IN_PROGRESS',
        hint: {
          currentLevel: 1,
          revealedTexts: [
            { level: 1, text: '先看门牌第三行' },
            { level: 2, text: '尚未揭示的正文不得进入 UI' },
          ],
          nextLevel: 2,
          nextImpactLabel: '使用后本关解谜分上限降至 40 分',
          revealAvailable: false,
          revealImpactLabel: '不应在当前状态展示',
          nextText: '不应透传',
          allHints: ['不应透传'],
        },
      }],
    },
  })

  assert.deepEqual(view.nodes[0].hint, {
    currentLevel: 1,
    revealedTexts: [{ level: 1, text: '先看门牌第三行' }],
    nextLevel: 2,
    nextImpactLabel: '使用后本关解谜分上限降至 40 分',
    revealAvailable: false,
    revealImpactLabel: '',
  })
  assert.equal(view.nodes[0].hint.nextText, undefined)
  assert.equal(view.nodes[0].hint.allHints, undefined)

  assert.deepEqual(buildPlayerHintInput(
    { activityId: 7, nodeId: 11, revision: 5 }, 2, 'pg-hint-7-11-2',
  ), {
    activityId: 7,
    nodeId: 11,
    requestId: 'pg-hint-7-11-2',
    expectedRevision: 5,
    action: 'PLAYER_HINT',
    payload: { level: 2 },
  })
  assert.throws(() => buildPlayerHintInput(
    { activityId: 7, nodeId: 11, revision: 5 }, 0, 'pg-hint-7-11-0',
  ), /PLAYER_HINT_INPUT_INVALID/)
  assert.throws(() => buildPlayerHintInput(
    { activityId: 7, nodeId: 11, revision: 5 }, 3, 'pg-hint-7-11-3',
  ), /PLAYER_HINT_INPUT_INVALID/)
})

test('F06 reveal 只发送空 payload，权威兜底完成状态明确进入玩家投影', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 6,
    player: {
      teamId: 8,
      role: {},
      nodes: [{
        nodeId: 11,
        personalState: 'FALLBACK_COMPLETED',
        completionStatus: 'FALLBACK_COMPLETED',
        completionSource: 'PLAYER_REVEAL',
        completionOrder: 405,
        completedAt: '2026-08-23 10:30:59',
        hint: {
          currentLevel: 2,
          revealedTexts: [{ level: 1, text: '第一条' }, { level: 2, text: '第二条' }],
          nextLevel: null,
          nextImpactLabel: '',
          revealAvailable: true,
          revealImpactLabel: '查看答案将记为兜底完成，不计正常榜单分',
          answerReveal: '未授权字段不得透传',
        },
      }, {
        nodeId: 12,
        personalState: 'IN_PROGRESS',
        completionStatus: 'FALLBACK_COMPLETED',
        completionSource: 'FORGED',
      }],
    },
  })

  assert.equal(view.nodes[0].completionStatus, 'FALLBACK_COMPLETED')
  assert.equal(view.nodes[0].completionSource, 'PLAYER_REVEAL')
  assert.equal(view.nodes[0].hint.revealAvailable, true)
  assert.equal(view.nodes[0].hint.revealImpactLabel, '查看答案将记为兜底完成，不计正常榜单分')
  assert.equal(view.nodes[0].hint.answerReveal, undefined)
  assert.equal(view.nodes[1].completionStatus, undefined, '非完成节点不得靠 completionStatus 伪造兜底完成')
  assert.equal(view.nodes[1].completionSource, undefined)

  assert.deepEqual(buildPlayerRevealInput(
    { activityId: 7, nodeId: 11, revision: 6 }, 'pg-reveal-7-11',
  ), {
    activityId: 7,
    nodeId: 11,
    requestId: 'pg-reveal-7-11',
    expectedRevision: 6,
    action: 'PLAYER_REVEAL',
    payload: {},
  })
  assert.throws(() => buildPlayerRevealInput(
    { activityId: 7, revision: 6 }, 'pg-reveal-7-11',
  ), /PLAYER_REVEAL_INPUT_INVALID/)
})

test('D05 暂停节点只展示服务端批准的版本化替代行动', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 6,
    player: {
      teamId: 8,
      role: {},
      nodes: [{
        nodeId: 11,
        personalState: 'PAUSED',
        fallback: {
          planCode: 'CLOCK_TO_ARCHIVE',
          planVersion: 1,
          targetNodeId: 12,
          targetNodeName: '旧档案馆',
          playerMessage: '请前往旧档案馆完成替代任务',
          merchantInstruction: '不应透传',
        },
      }, {
        nodeId: 12,
        personalState: 'ACTIVE',
        fallback: {
          planCode: 'FORGED', planVersion: 1, targetNodeId: 13,
          targetNodeName: '伪造站点', playerMessage: '不应展示',
        },
      }],
    },
  })

  assert.deepEqual(view.nodes[0].fallback, {
    planCode: 'CLOCK_TO_ARCHIVE',
    planVersion: 1,
    targetNodeId: 12,
    targetNodeName: '旧档案馆',
    playerMessage: '请前往旧档案馆完成替代任务',
  })
  assert.equal(view.nodes[0].fallback.merchantInstruction, undefined)
  assert.equal(view.nodes[1].fallback, undefined, '非 PAUSED 节点不得伪造替代行动')
})

test('R9-38 暂停节点无兜底路线也带出原因与预计恢复，非暂停节点不得夹带', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 6,
    player: {
      teamId: 8,
      role: {},
      nodes: [{
        nodeId: 11,
        personalState: 'PAUSED',
        pause: { reasonCode: 'CAPACITY', reason: '现场满员', resumeEta: '2026-08-23 16:00', hidden: '不应透传' },
      }, {
        nodeId: 12,
        personalState: 'ACTIVE',
        pause: { reasonCode: 'CAPACITY', reason: '不应展示', resumeEta: '2026-08-23 16:00' },
      }, {
        nodeId: 13,
        personalState: 'PAUSED',
        pause: 'CAPACITY',
      }],
    },
  })

  assert.deepEqual(view.nodes[0].pause, {
    reasonCode: 'CAPACITY',
    reason: '现场满员',
    resumeEta: '2026-08-23 16:00',
  })
  assert.equal(view.nodes[0].pause.hidden, undefined, '认不出的键不得透传')
  assert.equal(view.nodes[1].pause, undefined, '非 PAUSED 节点不得带暂停安排')
  assert.equal(view.nodes[2].pause, undefined, '畸形 pause 不得渲染成空壳')
})

test('尚未分配角色的 JOINED 队员显示待分配，不得冒充 ASSIGNED 待确认', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'PREPARING',
    revision: 5,
    snapshotAt: '2026-08-23 10:30',
    player: {
      teamId: 8,
      role: {},
      nodes: [],
      teamActions: [
        { memberId: 12, displayName: '等待分配的队员', roleCode: '', status: 'JOINED' },
        { memberId: 13, displayName: '已分配的队员', roleCode: 'SCOUT', status: 'ASSIGNED' },
      ],
    },
  })

  assert.deepEqual(view.teamActions, [
    { memberId: 12, displayName: '等待分配的队员', roleCode: '', status: 'JOINED', statusLabel: '待分配' },
    { memberId: 13, displayName: '已分配的队员', roleCode: 'SCOUT', status: 'ASSIGNED', statusLabel: '待确认身份' },
  ])
})

test('snapshotAt 只接受后端 yyyy-MM-dd HH:mm:ss 快照格式，ISO 与非法日期 fail closed', () => {
  const projection = (snapshotAt) => normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 5,
    snapshotAt,
    player: { teamId: 8, role: {}, nodes: [] },
  })

  assert.equal(projection('2026-08-23 10:30:59').snapshotAt, '2026-08-23 10:30:59')
  assert.equal(projection('2026-08-23T10:30:59Z').snapshotAt, '', 'ISO 字符串不是当前后端契约')
  assert.equal(projection('2026-02-30 10:30:59').snapshotAt, '', '不存在的日期不得进入 UI 状态')
  assert.equal(projection('2026-08-23 25:30:59').snapshotAt, '', '越界时间不得进入 UI 状态')
  assert.equal(projection({ value: '2026-08-23 10:30:59' }).snapshotAt, '')
})

test('玩家节点状态只信服务端 personalState，不得用非契约 status 伪装解锁', () => {
  const projection = (node) => normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 6,
    player: { teamId: 8, role: {}, nodes: [node] },
  })

  const authoritative = projection({ nodeId: 11, personalState: 'IN_PROGRESS', playable: true })
  assert.equal(authoritative.nodes[0].status, 'IN_PROGRESS')

  // 负控：后端契约没有 node.status，仅伪造 status 必须 fail closed。
  const nonContract = projection({ nodeId: 11, status: 'IN_PROGRESS', playable: true })
  assert.equal(nonContract.nodes[0].status, 'LOCKED')

  const unsupportedTask = projection({
    nodeId: 11,
    personalState: 'IN_PROGRESS',
    playable: true,
    playerTask: { taskCode: 'CLOCK_WORD', prompt: '不可执行的任务', inputType: 'HTML' },
  })
  assert.equal(unsupportedTask.nodes[0].playerTask.inputType, undefined)
})

test('已完成节点只允许安全 completedAt 与 completionOrder 进入玩家投影', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 6,
    player: {
      teamId: 8,
      role: {},
      nodes: [{
        nodeId: 11,
        personalState: 'COMPLETED',
        completedAt: '2026-08-23T10:30:00Z',
        completionOrder: 401,
        completedBy: 99,
        internalResult: '不应透传',
      }, {
        nodeId: 12,
        personalState: 'IN_PROGRESS',
        completionOrder: 402,
      }],
    },
  })

  assert.equal(view.nodes[0].status, 'COMPLETED')
  assert.equal(view.nodes[0].completedAt, '2026-08-23T10:30:00Z')
  assert.equal(view.nodes[0].completionOrder, 401)
  assert.equal(view.nodes[0].completedBy, undefined)
  assert.equal(view.nodes[0].internalResult, undefined)
  assert.equal(view.nodes[1].completionOrder, undefined, '未完成节点不得伪造完成顺序')
})

test('角色确认只引用本局服务端分配，不让玩家自己挑 roleCode', () => {
  assert.deepEqual(buildPlayerRoleConfirmInput({ activityId: 7, revision: 4 }, 'req-role-7'), {
    activityId: 7,
    nodeId: null,
    requestId: 'req-role-7',
    expectedRevision: 4,
    action: 'CONFIRM_ROLE',
    payload: {},
  })
})

test('非 PLAYER、缺 session 或脏数组都不启用玩家模组', () => {
  assert.deepEqual(normalizePlayerProjection(null), { enabled: false, reason: 'EMPTY' })
  assert.deepEqual(normalizePlayerProjection({ perspective: 'MERCHANT', sessionId: 1, player: {} }), {
    enabled: false,
    reason: 'FORBIDDEN_PROJECTION',
  })
  assert.deepEqual(normalizePlayerProjection({ perspective: 'PLAYER', sessionId: 0, player: {} }), {
    enabled: false,
    reason: 'INVALID_SESSION',
  })
  assert.deepEqual(normalizePlayerProjection({
    perspective: 'PLAYER', sessionId: 1, activityId: 7, status: 'RUNNING', player: {},
  }), { enabled: false, reason: 'INVALID_REVISION' })
  assert.deepEqual(normalizePlayerProjection({
    perspective: 'PLAYER', sessionId: 1, activityId: 7, status: 'UNKNOWN', revision: 0, player: {},
  }), { enabled: false, reason: 'INVALID_STATUS' })
  assert.throws(() => buildPlayerRoleConfirmInput({ activityId: 7 }, 'req-role-7'), /CONFIRM_ROLE_INPUT_INVALID/)
  assert.throws(() => buildPlayerChoiceInput({ activityId: 7, nodeId: 11, revision: -1 }, 'A', 'req-choice-7'), /PLAYER_CHOICE_INPUT_INVALID/)
})

test('玩家榜单只保留服务端显式开放的安全字段，隐藏或脏响应不冒充可见', () => {
  const visible = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 5,
    player: {
      teamId: 8,
      role: {},
      nodes: [],
      leaderboard: {
        visible: true,
        entries: [{ rank: 1, teamId: 8, displayName: '侦探队', score: 3, phone: '不应透传' }],
      },
    },
  })
  assert.deepEqual(visible.leaderboard, {
    visible: true,
    entries: [{ rank: 1, teamId: 8, displayName: '侦探队', score: 3 }],
  })
  assert.equal(visible.leaderboard.entries[0].phone, undefined)

  const hidden = normalizePlayerProjection({
    sessionId: 92, activityId: 7, perspective: 'PLAYER', status: 'RUNNING', revision: 5,
    player: { teamId: 8, role: {}, nodes: [], leaderboard: { visible: false, entries: [{ rank: 1 }] } },
  })
  assert.equal(hidden.leaderboard, null)
})

test('玩家可看到本人被驳回的结构化原因，但不透传证据或内部备注', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 6,
    player: {
      teamId: 8,
      role: {},
      nodes: [{ nodeId: 11, personalState: 'IN_PROGRESS', playable: true }],
      mySubmissions: [{
        submissionId: 302,
        nodeId: 11,
        taskCode: 'CLOCK_WORD',
        status: 'REJECTED',
        reasonCode: 'WRONG_CODE',
        reason: '暗号不匹配，请重新向店员确认',
        evidenceJson: '["private.jpg"]',
        internalRemark: '不得透传',
      }],
    },
  })

  assert.deepEqual(view.mySubmissions, [{
    submissionId: 302,
    nodeId: 11,
    taskCode: 'CLOCK_WORD',
    status: 'REJECTED',
    statusLabel: '商家已驳回，可重新提交',
    decisionReasonCode: 'WRONG_CODE',
    decisionReason: '暗号不匹配，请重新向店员确认',
  }])
  assert.equal(view.mySubmissions[0].evidenceJson, undefined)
  assert.equal(view.mySubmissions[0].internalRemark, undefined)
})

test('PHOTO EVIDENCE_ONLY 的 RECORDED 只显示证据已记录，不冒充待商家核验', () => {
  const view = normalizePlayerProjection({
    sessionId: 91,
    activityId: 7,
    perspective: 'PLAYER',
    status: 'RUNNING',
    revision: 6,
    player: {
      teamId: 8,
      role: {},
      nodes: [{
        nodeId: 11,
        personalState: 'COMPLETED',
        playerTask: {
          taskCode: 'PHOTO_SCENE',
          prompt: '拍下现场标记',
          inputType: 'PHOTO',
          completionPolicy: 'EVIDENCE_ONLY',
          verificationRequired: false,
        },
      }, {
        nodeId: 12,
        personalState: 'IN_PROGRESS',
        playerTask: {
          taskCode: 'PHOTO_UNKNOWN',
          prompt: '未知策略不得进入 UI',
          inputType: 'PHOTO',
          completionPolicy: 'AUTO_APPROVE_INTERNAL',
        },
      }],
      mySubmissions: [{
        submissionId: 303,
        nodeId: 11,
        taskCode: 'PHOTO_SCENE',
        status: 'RECORDED',
        evidenceJson: '["private.jpg"]',
      }],
    },
  })

  assert.equal(view.nodes[0].playerTask.completionPolicy, 'EVIDENCE_ONLY')
  assert.equal(view.nodes[1].playerTask.completionPolicy, undefined)
  assert.deepEqual(view.mySubmissions, [{
    submissionId: 303,
    nodeId: 11,
    taskCode: 'PHOTO_SCENE',
    status: 'RECORDED',
    statusLabel: '证据已记录',
  }])
  assert.equal(view.nodes[0].submission.statusLabel, '证据已记录')
  assert.notEqual(view.nodes[0].submission.statusLabel, '待商家核验')
  assert.equal(view.mySubmissions[0].evidenceJson, undefined)
})

test('剧情选择命令不允许客户端上报角色、变量、结局或 actor', () => {
  const input = buildPlayerChoiceInput({
    activityId: 7,
    nodeId: 11,
    revision: 4,
  }, 'A', 'req-7-11-a')

  assert.deepEqual(input, {
    activityId: 7,
    nodeId: 11,
    requestId: 'req-7-11-a',
    expectedRevision: 4,
    action: 'PLAYER_CHOICE',
    payload: { choiceId: 'A' },
  })
  assert.equal(input.actorMemberId, undefined)
  assert.equal(input.roleCode, undefined)
  assert.equal(input.variables, undefined)
})

test('玩家本站提交只发送服务端下发的 taskCode，不允许夹带判定结果', () => {
  const input = buildPlayerSubmissionInput({ activityId: 7, nodeId: 11, revision: 4 }, 'CLOCK_WORD', 'req-submit-11')
  assert.deepEqual(input, {
    activityId: 7,
    nodeId: 11,
    requestId: 'req-submit-11',
    expectedRevision: 4,
    action: 'PLAYER_SUBMIT',
    payload: { taskCode: 'CLOCK_WORD', evidenceUrls: [] },
  })
  assert.equal(input.payload.approved, undefined)
  assert.equal(input.payload.ending, undefined)
})

test('玩家本站提交净化 TEXT、SCAN 与 HTTPS 图片证据，旧调用仍默认空证据', () => {
  const legacy = buildPlayerSubmissionInput(
    { activityId: 7, nodeId: 11, revision: 4 }, 'CLOCK_WORD', 'req-submit-11',
  )
  assert.deepEqual(legacy.payload.evidenceUrls, [])

  const input = buildPlayerSubmissionInput(
    { activityId: 7, nodeId: 11, revision: 4 },
    'CLOCK_WORD',
    'req-submit-12',
    [
      '  text:%E9%92%9F%E6%A5%BC%E6%9A%97%E5%8F%B7%E6%98%AF%E8%93%9D%E8%89%B2  ',
      'scan:https%3A%2F%2Fexample.com%2F%E5%9F%8E%E7%98%BE%3Fcode%3DCY-2026',
      'https://cdn.example.com/evidence/a.WEBP?token=abc',
    ],
  )
  assert.deepEqual(input.payload.evidenceUrls, [
    'text:%E9%92%9F%E6%A5%BC%E6%9A%97%E5%8F%B7%E6%98%AF%E8%93%9D%E8%89%B2',
    'scan:https%3A%2F%2Fexample.com%2F%E5%9F%8E%E7%98%BE%3Fcode%3DCY-2026',
    'https://cdn.example.com/evidence/a.WEBP?token=abc',
  ])
})

test('玩家本站提交对非契约、空内容、非 HTTPS 或超量证据 fail closed', () => {
  const source = { activityId: 7, nodeId: 11, revision: 4 }
  const build = (evidenceUrls) => buildPlayerSubmissionInput(
    source, 'CLOCK_WORD', 'req-submit-13', evidenceUrls,
  )
  assert.throws(() => build(['file:///tmp/private.jpg']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['http://cdn.example.com/a.jpg']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['https://user@cdn.example.com/a.jpg']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['https://cdn.example.com/a.txt']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['https://cdn.example.com/a.jpg#fragment']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['text:   ']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['text:未编码中文']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['text:%E0%A4%A']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['text:%0A']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['scan:']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['scan:CY/2026']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['scan:https%3a%2f%2fexample.com']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['scan:%ZZ']), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(['scan:' + 'A'.repeat(257)]), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build([123]), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build([]), /PLAYER_SUBMIT_INPUT_INVALID/)
  assert.throws(() => build(new Array(7).fill('text:合法')), /PLAYER_SUBMIT_INPUT_INVALID/)
})

test('unknown 写不能本地推进，只有匹配的权威 APPLIED 回执才能更新 revision', () => {
  const before = { enabled: true, activityId: 7, revision: 4, write: { status: 'unknown', requestId: 'req-a' } }
  assert.equal(mergeConfirmedReceipt(before, null), before)
  assert.equal(mergeConfirmedReceipt(before, { requestId: 'req-b', outcome: 'APPLIED', revision: 5 }), before)

  const next = mergeConfirmedReceipt(before, {
    requestId: 'req-a',
    action: 'PLAYER_CHOICE',
    outcome: 'APPLIED',
    revision: 5,
  })
  assert.equal(next.revision, 5)
  assert.equal(next.write.status, 'confirmed')
  assert.equal(next.write.requestId, 'req-a')
})

test('路线只画上一个真实完成节点到本次服务端确认节点的一段', () => {
  const nodes = [
    { nodeId: 1, done: true, doneAt: 100, lng: 121.1, lat: 31.1 },
    { nodeId: 2, done: true, doneAt: 300, lng: 121.3, lat: 31.3 },
    { nodeId: 3, done: true, doneAt: 200, lng: 121.2, lat: 31.2 },
  ]
  assert.deepEqual(completedRouteSegment(nodes, 2), [
    { lng: 121.2, lat: 31.2 },
    { lng: 121.3, lat: 31.3 },
  ])
  assert.deepEqual(completedRouteSegment(nodes, 1), [])
  assert.deepEqual(completedRouteSegment(nodes, 999), [])
})

test('路线完成顺序优先使用服务端 completionOrder，同秒完成也不能丢段', () => {
  const sameSecond = [
    { nodeId: 1, done: true, completionOrder: 801, doneAt: 1000, lng: 121.1, lat: 31.1 },
    { nodeId: 2, done: true, completionOrder: 803, doneAt: 1000, lng: 121.3, lat: 31.3 },
    { nodeId: 3, done: true, completionOrder: 802, doneAt: 1000, lng: 121.2, lat: 31.2 },
  ]
  assert.deepEqual(completedRouteSegment(sameSecond, 2), [
    { lng: 121.2, lat: 31.2 },
    { lng: 121.3, lat: 31.3 },
  ])

  const misleadingTimes = [
    { nodeId: 1, done: true, completionOrder: 801, doneAt: 900, lng: 121.1, lat: 31.1 },
    { nodeId: 2, done: true, completionOrder: 803, doneAt: 1000, lng: 121.3, lat: 31.3 },
    { nodeId: 3, done: true, completionOrder: 802, doneAt: 100, lng: 121.2, lat: 31.2 },
  ]
  assert.deepEqual(completedRouteSegment(misleadingTimes, 2), [
    { lng: 121.2, lat: 31.2 },
    { lng: 121.3, lat: 31.3 },
  ], 'completionOrder 是主顺序，doneAt 只在主顺序不可用或相同时兜底')

  const futureOrderWithEarlierTime = [
    { nodeId: 1, done: true, completionOrder: 804, doneAt: 900, lng: 121.4, lat: 31.4 },
    { nodeId: 2, done: true, completionOrder: 803, doneAt: 1000, lng: 121.3, lat: 31.3 },
  ]
  assert.deepEqual(completedRouteSegment(futureOrderWithEarlierTime, 2), [],
    '已知顺序更晚的节点不得因 doneAt 更早而伪装成上一站')
})

test('玩家未知写同页内存只保留原命令的安全字段，请求号或动作不匹配则拒绝重试', () => {
  assert.deepEqual(normalizePlayerPendingWrite({
    requestId: 'pg-submit-7-11-1234',
    action: 'PLAYER_SUBMIT',
    command: {
      activityId: 7, nodeId: 11, requestId: 'pg-submit-7-11-1234', expectedRevision: 6,
      action: 'PLAYER_SUBMIT', payload: {
        taskCode: 'CLOCK_WORD',
        evidenceUrls: [
          'text:%E9%92%9F%E6%A5%BC%E6%9A%97%E5%8F%B7%E6%98%AF%E8%93%9D%E8%89%B2',
          'https://cdn.example.com/evidence/a.jpg',
        ],
      },
      actorMemberId: 999,
    },
  }, 7), {
    requestId: 'pg-submit-7-11-1234',
    action: 'PLAYER_SUBMIT',
    command: {
      activityId: 7, nodeId: 11, requestId: 'pg-submit-7-11-1234', expectedRevision: 6,
      action: 'PLAYER_SUBMIT', payload: {
        taskCode: 'CLOCK_WORD',
        evidenceUrls: [
          'text:%E9%92%9F%E6%A5%BC%E6%9A%97%E5%8F%B7%E6%98%AF%E8%93%9D%E8%89%B2',
          'https://cdn.example.com/evidence/a.jpg',
        ],
      },
    },
  })
  assert.equal(normalizePlayerPendingWrite({
    requestId: 'pg-submit-7-11-1234', action: 'PLAYER_SUBMIT',
    command: {
      activityId: 7, nodeId: 11, requestId: 'different-request', expectedRevision: 6,
      action: 'PLAYER_SUBMIT', payload: { taskCode: 'CLOCK_WORD' },
    },
  }, 7), null)
})

test('玩家未知写持久化只保留回执索引，绝不落盘任务内容与凭证', () => {
  const index = normalizePlayerPendingReceiptIndex({
    activityId: 7,
    nodeId: 11,
    requestId: 'pg-submit-7-11-1234',
    expectedRevision: 6,
    action: 'PLAYER_SUBMIT',
    payload: {
      choiceId: 'A',
      taskCode: 'CLOCK_WORD',
      evidenceUrls: [
        'text:%E9%92%9F%E6%A5%BC%E6%9A%97%E5%8F%B7%E6%98%AF%E8%93%9D%E8%89%B2',
        'scan:CY-2026',
        'https://cdn.example.com/evidence/a.jpg',
      ],
      revealText: '答案是 1998',
    },
  }, 7)

  assert.deepEqual(index, {
    activityId: 7,
    nodeId: 11,
    requestId: 'pg-submit-7-11-1234',
    expectedRevision: 6,
    action: 'PLAYER_SUBMIT',
  })
  assert.doesNotMatch(JSON.stringify(index), /payload|evidenceUrls|text:|scan:|https:\/\/|CLOCK_WORD|1998/)
})

test('D05/F06 unknown 写同页内存只保留精确 PLAYER_HINT/PLAYER_REVEAL 命令', () => {
  assert.deepEqual(normalizePlayerPendingWrite({
    requestId: 'pg-hint-7-11-2',
    action: 'PLAYER_HINT',
    command: {
      activityId: 7,
      nodeId: 11,
      requestId: 'pg-hint-7-11-2',
      expectedRevision: 6,
      action: 'PLAYER_HINT',
      payload: { level: 2, text: '未揭示提示不得持久化' },
    },
  }, 7), {
    requestId: 'pg-hint-7-11-2',
    action: 'PLAYER_HINT',
    command: {
      activityId: 7,
      nodeId: 11,
      requestId: 'pg-hint-7-11-2',
      expectedRevision: 6,
      action: 'PLAYER_HINT',
      payload: { level: 2 },
    },
  })

  assert.deepEqual(normalizePlayerPendingWrite({
    requestId: 'pg-reveal-7-11',
    action: 'PLAYER_REVEAL',
    command: {
      activityId: 7,
      nodeId: 11,
      requestId: 'pg-reveal-7-11',
      expectedRevision: 6,
      action: 'PLAYER_REVEAL',
      payload: { answer: '客户端不得携带答案' },
    },
  }, 7), {
    requestId: 'pg-reveal-7-11',
    action: 'PLAYER_REVEAL',
    command: {
      activityId: 7,
      nodeId: 11,
      requestId: 'pg-reveal-7-11',
      expectedRevision: 6,
      action: 'PLAYER_REVEAL',
      payload: {},
    },
  })

  assert.equal(normalizePlayerPendingWrite({
    requestId: 'pg-hint-7-11-3',
    action: 'PLAYER_HINT',
    command: {
      activityId: 7, nodeId: 11, requestId: 'pg-hint-7-11-3', expectedRevision: 6,
      action: 'PLAYER_HINT', payload: { level: 3 },
    },
  }, 7), null)
})
