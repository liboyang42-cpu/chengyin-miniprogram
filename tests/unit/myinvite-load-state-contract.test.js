const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT_PATH = path.join(ROOT, 'components/cy/scene-member-invite-history/index.js')
const ROUTE_JS = path.join(ROOT, 'subpackageMember/myinvite/myinvite.js')
const ROUTE_WXML = path.join(ROOT, 'subpackageMember/myinvite/myinvite.wxml')
const SCENE_WXML = path.join(ROOT, 'components/cy/scene-member-invite-history/index.wxml')
const EARNINGS_WXML = path.join(ROOT, 'subpackageA/pages/assetcenter/earnings/index.wxml')
const EARNINGS_SCENE_JS = path.join(ROOT, 'components/cy/scene-asset-earnings/index.js')
const REGISTRY_JS = path.join(ROOT, 'utils/scene-registry.js')
const read = (file) => fs.readFileSync(file, 'utf8')

let componentConfig
let requests

global.getApp = () => ({
  getPageSize: () => 10,
  sendRequest(options) { requests.push(options) },
})
global.Component = (config) => { componentConfig = config }

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadComponent() {
  delete require.cache[require.resolve(COMPONENT_PATH)]
  requests = []
  componentConfig = null
  require(COMPONENT_PATH)
  const component = Object.assign({}, componentConfig.methods, {
    data: JSON.parse(JSON.stringify(componentConfig.data)),
  })
  component.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(component.data, key, value))
    if (callback) callback()
  }
  return component
}

function respond(index, response) {
  if (response === 'fail') requests[index].fail({ errMsg: 'network error' })
  else requests[index].success(response)
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
}

test('邀请记录同时读取真实邀请列表与积分流水，并按记录时间分组', async () => {
  const component = loadComponent()
  component.load(true)
  assert.deepEqual(requests.map((request) => request.url), ['/api/user/invite_list', '/api/user/points/list'])

  respond(1, {
    code: '200',
    data: {
      rows: [{ eventType: 5, eventId: 11, changePoints: 10, createTime: '2026-08-07 10:30:00' }],
      total: 1,
    },
  })
  respond(0, {
    code: '200',
    data: {
      rows: [{ id: 11, nickname: '小城', avatar: 'avatar.png', createTime: '2026-08-06 09:15:00' }],
      total: 1,
    },
  })
  await flush()

  assert.equal(component.data.loadErr, false)
  assert.equal(component.data.total, 1)
  assert.equal(component.data.groups.length, 1)
  assert.equal(component.data.groups[0].label, '2026年8月')
  assert.equal(component.data.groups[0].rewardText, '+10 积分')
  assert.deepEqual(component.data.groups[0].items[0], {
    id: 11,
    nickname: '小城',
    avatar: 'avatar.png',
    timeText: '8月6日 09:15',
    statusText: '首购奖励已到账',
    rewardText: '+10 积分',
  })
})

test('奖励到账时间不得冒充邀请时间或邀请月份', async () => {
  const component = loadComponent()
  component.load(true)
  respond(1, {
    code: '200',
    data: {
      rows: [{ eventType: 5, eventId: 13, changePoints: 10, createTime: '2026-08-07 10:30:00' }],
      total: 1,
    },
  })
  respond(0, {
    code: '200',
    data: { rows: [{ id: 13, nickname: '小桥', avatar: '' }], total: 1 },
  })
  await flush()

  assert.equal(component.data.groups[0].label, '其他邀请')
  assert.equal(component.data.groups[0].items[0].timeText, '邀请时间暂未记录')
  assert.equal(component.data.groups[0].items[0].statusText, '首购奖励已到账 · 8月7日 10:30')
})

test('积分流水失败不把真实邀请记录整页判错，奖励字段明确降级为待同步', async () => {
  const component = loadComponent()
  component.load(true)
  respond(1, 'fail')
  respond(0, {
    code: '200',
    data: { rows: [{ id: 12, nickname: '阿林', avatar: '' }], total: 1 },
  })
  await flush()

  assert.equal(component.data.loadErr, false)
  assert.equal(component.data.rewardReady, false)
  assert.equal(component.data.groups[0].items[0].timeText, '邀请时间暂未记录')
  assert.equal(component.data.groups[0].items[0].statusText, '已加入 · 奖励待同步')
  assert.equal(component.data.groups[0].items[0].rewardText, '待同步')
})

test('积分流水被分页截断时不把未匹配记录误判为首购未完成', async () => {
  const component = loadComponent()
  component.load(true)
  respond(1, {
    code: '200',
    data: {
      rows: [{ eventType: 5, eventId: 99, changePoints: 10, createTime: '2026-08-07 10:30:00' }],
      total: 201,
    },
  })
  respond(0, {
    code: '200',
    data: { rows: [{ id: 12, nickname: '阿林', avatar: '' }], total: 1 },
  })
  await flush()

  assert.equal(component.data.rewardReady, false)
  assert.equal(component.data.groups[0].items[0].statusText, '已加入 · 奖励待同步')
  assert.equal(component.data.groups[0].items[0].rewardText, '待同步')
})

test('邀请人 Long ID 以字符串关联奖励，不经 Number 转换丢精度', async () => {
  const component = loadComponent()
  component.load(true)
  const longId = '90071992547409931234'
  respond(1, {
    code: '200',
    data: { rows: [{ eventType: 5, eventId: longId, changePoints: 10 }], total: 1 },
  })
  respond(0, {
    code: '200',
    data: { rows: [{ id: longId, nickname: '长 ID 用户', avatar: '' }], total: 1 },
  })
  await flush()

  assert.equal(component.data.groups[0].items[0].id, longId)
  assert.equal(component.data.groups[0].items[0].rewardText, '+10 积分')
})

test('邀请列表失败进入可重试错误态，200 + 空列表才是空态', async () => {
  const failed = loadComponent()
  failed.load(true)
  respond(0, 'fail')
  respond(1, { code: '200', data: { rows: [], total: 0 } })
  await flush()
  assert.equal(failed.data.loadErr, true)
  assert.equal(failed.data.empty, false)

  const empty = loadComponent()
  empty.load(true)
  respond(0, { code: '200', data: { rows: [], total: 0 } })
  respond(1, { code: '200', data: { rows: [], total: 0 } })
  await flush()
  assert.equal(empty.data.loadErr, false)
  assert.equal(empty.data.empty, true)
})

test('邀请总数缺失或为负数时不得用当前页长度伪造累计人数', async () => {
  for (const total of [undefined, -1]) {
    const component = loadComponent()
    component.load(true)
    respond(0, {
      code: '200',
      data: { rows: [{ id: 21, nickname: '小满', avatar: '' }], total },
    })
    respond(1, { code: '200', data: { rows: [], total: 0 } })
    await flush()

    assert.equal(component.data.loadErr, true)
    assert.equal(component.data.empty, false)
    assert.equal(component.data.total, 0)
    assert.deepEqual(component.data.groups, [])
  }
})

test('邀请昵称缺失时显示未知语义，不虚构用户加 ID', async () => {
  const component = loadComponent()
  component.load(true)
  respond(0, {
    code: '200',
    data: { rows: [{ id: 22, nickname: '', avatar: '' }], total: 1 },
  })
  respond(1, { code: '200', data: { rows: [], total: 0 } })
  await flush()

  assert.equal(component.data.groups[0].items[0].nickname, '昵称待确认')
})

function assertInviteSheetContract(files) {
  assert.match(files.route, /<cy-page-title title="邀请记录"/)
  assert.doesNotMatch(files.route, /<cy-sheet/,
    '邀请记录独立路由不再套常驻半屏（同收益明细 / 提现记录）')
  assert.match(files.route, /<cy-scene-member-invite-history id="inviteHistory"/)
  assert.match(files.earnings, /sceneCurrent\.id === 'member-invite-history'[\s\S]*?<cy-scene-sheet show="\{\{true\}\}"[\s\S]*?<cy-scene-member-invite-history/)
  assert.match(files.entry, /openInvite\(\)\s*\{\s*this\.triggerEvent\('open', \{ id: 'member-invite-history' \}\)\s*\}/)
  assert.match(files.registry, /'member-invite-history':\s*\{[^}]*route:\s*'\/subpackageMember\/myinvite\/myinvite'[^}]*variant:\s*'half'/)
  assert.match(files.scene, /class="ir-row"[\s\S]*?class="ir-time"[\s\S]*?class="ir-status"[\s\S]*?class="ir-reward"/)
  // CU-M-145:空态标题不再复述「邀请记录」(弹层/页头已经说过一次),改陈述事实本身。
  // 这条断言的意图一直是「空态存在且给了明确标题」,字面串只是锚点 —— 跟着换锚点,意图不放宽。
  assert.match(files.scene, /<cy-empty[^>]*title="还没有人接受你的邀请"/)
  assert.match(files.scene, /<cy-error[^>]*bind:retry="retry"/)
  assert.doesNotMatch(
    [files.routeJs, files.route, files.sceneJs, files.scene].join('\n'),
    /积分任务|loadPointCard|\/api\/points\/result_list/,
    'D23 不得把被否决的积分任务形态与邀请记录并存',
  )
}

function inviteSources() {
  return {
    routeJs: read(ROUTE_JS),
    route: read(ROUTE_WXML),
    sceneJs: read(COMPONENT_PATH),
    scene: read(SCENE_WXML),
    earnings: read(EARNINGS_WXML),
    entry: read(EARNINGS_SCENE_JS),
    registry: read(REGISTRY_JS),
  }
}

test('D23：收益页入口仍走 scene sheet，独立路由正文落页且共用同一份邀请记录', () => {
  assertInviteSheetContract(inviteSources())
})

test('负控一：独立路由再套常驻半屏必须判红', () => {
  const files = inviteSources()
  const swapped = files.route.replace(
    '<cy-scene-member-invite-history id="inviteHistory" />',
    '<cy-sheet show="{{true}}" title="邀请记录"><cy-scene-member-invite-history id="inviteHistory" /></cy-sheet>',
  )
  assert.notEqual(swapped, files.route, '负控锚点失效：myinvite scene 宿主不存在')
  files.route = swapped
  assert.throws(() => assertInviteSheetContract(files), assert.AssertionError)
})

test('负控二：邀请行移除奖励字段必须判红', () => {
  const files = inviteSources()
  files.scene = files.scene.replace('class="ir-reward"', 'class="ir-reward-removed"')
  assert.throws(() => assertInviteSheetContract(files), assert.AssertionError)
})

test('负控三：独立路由混回旧积分任务形态必须判红', () => {
  const files = inviteSources()
  files.routeJs += "\nfunction loadPointCard() { return '/api/points/result_list' }\n"
  assert.throws(() => assertInviteSheetContract(files), assert.AssertionError)
})

// ── CU-M-145:空态文案的两条不变量 ─────────────────────────────────────────
// 半屏弹层的标题栏写着「邀请记录」,空态标题原先又写「还没有邀请记录」——
// 同一屏把面名说了两遍,真正要说的"还没有人加入"反而没说。
// 说明句「好友通过你的邀请加入后,会按时间出现在这里」21 个全角字符,正好压在
// 一行放得下的边界上:可用宽 = 750 − 弹层左右内距 2×32rpx(--cy-comp-sheet-body-pad-x)
// − cy-empty 自身左右 padding 2×32rpx(--cy-space-4) = 622rpx,
// cy-empty--lg 的说明句字号 = --cy-type-body = 28rpx ⇒ 容量 22.2 字,只留 1.2 字余量;
// 系统无障碍字号一放大就溢出,真机上「里」被挤成孤零零的末行。
// 判据锁关系不锁字面量:① 空态标题不得复述本面标题;② 说明句必须留出行宽余量。
const EMPTY_STATE_TITLE = '还没有人接受你的邀请'
const EMPTY_STATE_SUB = '好友加入后，会按时间出现在这里'
// 622rpx / 28rpx = 22.2 字;取 16 是给 1.38× 的系统字号放大留余量(22.2 / 1.38 ≈ 16)。
const EMPTY_STATE_SUB_MAX_CHARS = 16

function assertEmptyStateCopy(sceneWxml) {
  const m = sceneWxml.match(/<cy-empty[^>]*?title="([^"]*)"[^>]*?sub="([^"]*)"/)
  assert.ok(m, '邀请记录空态必须同时给出标题与说明句')
  const [, title, sub] = m

  const sheetTitle = read(REGISTRY_JS).match(/'member-invite-history':\s*\{[^}]*title:\s*'([^']+)'/)[1]
  assert.ok(
    !title.includes(sheetTitle),
    `空态标题「${title}」复述了弹层标题「${sheetTitle}」:同一屏两次面名,信息量为零`,
  )
  assert.ok(
    !/[，,]$/.test(sub) && sub.length <= EMPTY_STATE_SUB_MAX_CHARS,
    `说明句「${sub}」${sub.length} 字,超过一行预算 ${EMPTY_STATE_SUB_MAX_CHARS} 字 —— ` +
      '末字会被挤成孤行(走查 CU-M-145 读到的就是这个)',
  )
}

test('CU-M-145：空态标题不复述面名，说明句留出一行宽度余量', () => {
  assertEmptyStateCopy(read(SCENE_WXML))
})

test('负控:把说明句写回走查里那 21 字长句必须判红', () => {
  const mutated = read(SCENE_WXML).replace(`sub="${EMPTY_STATE_SUB}"`, 'sub="好友通过你的邀请加入后，会按时间出现在这里"')
  assert.notEqual(mutated, read(SCENE_WXML), '变异锚点漂了,负控本身是假的')
  assert.throws(() => assertEmptyStateCopy(mutated), assert.AssertionError)
})

test('负控:空态标题退回复述「邀请记录」必须判红', () => {
  const mutated = read(SCENE_WXML).replace(`title="${EMPTY_STATE_TITLE}"`, 'title="还没有邀请记录"')
  assert.notEqual(mutated, read(SCENE_WXML), '变异锚点漂了,负控本身是假的')
  assert.throws(() => assertEmptyStateCopy(mutated), assert.AssertionError)
})
