/* 5-01~5-04(阻断#19-a~d、#19-g):导演台弹层喂给 cy-club-director-row-list / chip-group 的
 * 数据必须跟组件协议对上 —— 行 {id,title,subtitle}、选项 {id,label}、事件回传 detail.id。
 *
 * 病:宿主页把原始投影直接喂进通用组件(roleView / teamView / 字符串数组),组件按
 *     item.title / item.label 渲染 → 整排空白;点击时组件只回传 { id },宿主页却读
 *     e.detail.value 或 e.currentTarget.dataset(组件事件里没有 currentTarget.dataset)→ 永远选不中。
 * 治:统一在宿主页这一侧做投影(director.js 的 applyProjection / index.js 的
 *     refreshTakeoverCandidates),通用组件协议一行不改 —— 别的页面也在用。
 * 负控:任一处投影被删掉(喂回原始对象)、或 handler 改回 detail.value/dataset,本文件必红。
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const WXML = read('pages/club/topic-detail/index.wxml')
const PAGE_JS = read('pages/club/topic-detail/index.js')
const DIRECTOR_PATH = path.resolve(ROOT, 'pages/club/topic-detail/director.js')

function directorModule() {
  global.wx = global.wx || { showToast() {} }
  delete require.cache[DIRECTOR_PATH]
  return require(DIRECTOR_PATH)
}

function directorMethods() {
  return directorModule().DIRECTOR_METHODS
}

// 与后端 GSR 下发形状一致的投影样例;只保留本文件要验的键。
const PROJECTION = {
  status: 'RUNNING',
  revision: 7,
  availableActions: ['ASSIGN_ROLES', 'TAKEOVER_ROLE', 'BROADCAST', 'UNLOCK_CHAPTER'],
  readiness: {},
  stations: [{ nodeId: 8, nodeName: '外滩钟楼', status: 'PAUSED', pauseReason: '商家暂停' }],
  submissions: [],
  roles: [
    { teamId: 11, memberId: 21, memberName: '阿青', roleCode: 'SCOUT', roleName: '侦察员', confirmationStatus: 'CONFIRMED' },
    { teamId: 11, memberId: 22, memberName: '阿蓝', roleCode: '', confirmationStatus: '' },
  ],
  teams: [{ teamId: 11, name: '一队', memberCount: 2 }],
  roleOptions: [{ roleCode: 'SCOUT', roleName: '侦察员' }, { roleCode: 'KEEPER', roleName: '守护员' }],
  chapterOptions: [{ chapterId: 2, title: '第二章' }, { chapterId: 5, title: '第五章' }],
  broadcasts: [],
}

// 真页面把 DIRECTOR_DATA + DIRECTOR_METHODS 都铺在同一个 Page 上;这里复刻同样的装载。
function directorHost(overrides) {
  const host = Object.assign({
    data: JSON.parse(JSON.stringify(directorModule().DIRECTOR_DATA)),
    _roleOptions: [],
    setData(patch, cb) { Object.assign(this.data, patch); if (typeof cb === 'function') cb() },
  }, directorModule().DIRECTOR_METHODS, overrides)
  return host
}

function hostWithProjection() {
  const host = directorHost()
  host.applyProjection(PROJECTION)
  return host
}

// index.js 的页面方法:按源码抠出来绑到给定 this 上跑,验的是逻辑不是文本。
function pageMethod(name) {
  const m = new RegExp('\\n  ' + name + '\\(\\) \\{([\\s\\S]*?)\\n  \\},').exec(PAGE_JS)
  assert.ok(m, 'index.js 缺 ' + name)
  return new Function('return function () {' + m[1] + '\n}')()
}

test('D8 现场事件:行有 id/title/subtitle,选中按 detail.id 命中', () => {
  const host = hostWithProjection()
  const row = host.data.incidentRows[0]
  assert.equal(row.id, 'pause:8', '行 id 必须存在,否则组件 data-id 为空、点击回传 undefined')
  assert.equal(row.title, '商家暂停')
  assert.match(row.subtitle, /外滩钟楼/)

  directorMethods().onIncidentSelect.call(host, { detail: { id: 'pause:8' } })
  assert.equal(host.data.incidentSelectedKey, 'pause:8')
  assert.deepEqual(host.data.incidentModes.map((m) => m.id), ['resume'], '选中的行必须能推出处理方式')
  assert.equal(host.data.incidentMode, 'resume')
})

test('D6 角色分配:chip 选项投影成 {id,label},选中按 detail.id 找 roleCode', () => {
  const host = hostWithProjection()
  assert.deepEqual(host.data.roleOptions, [
    { id: 'SCOUT', label: '侦察员' },
    { id: 'KEEPER', label: '守护员' },
  ])
  host.data.roleDraft = { teamId: 11, memberId: 21, roleCode: 'SCOUT' }
  directorMethods().onRoleOptionChange.call(host, { detail: { id: 'KEEPER' } })
  assert.equal(host.data.roleDraft.roleCode, 'KEEPER', '点第二个 chip 必须真的切过去,不是永远第一个')
})

test('D6 角色接管:候选行 id=teamId:memberId 且带标题,点击按 detail.id 解析来源', () => {
  const page = {
    data: {
      canTakeoverRoles: true,
      roles: [
        { teamId: 11, memberId: 21, memberNameText: '阿青', roleNameText: '侦察员', roleCode: 'SCOUT', confirmationStatus: 'CONFIRMED' },
        { teamId: 11, memberId: 22, memberNameText: '阿蓝', roleNameText: '角色待分配', roleCode: '', confirmationStatus: '' },
      ],
      directorTakeoverCandidates: [],
    },
    setData(patch) { Object.assign(this.data, patch) },
  }
  pageMethod('refreshTakeoverCandidates').call(page)
  assert.deepEqual(page.data.directorTakeoverCandidates.map((r) => r.id), ['11:21'], '候选行要有可定位 id')
  assert.equal(page.data.directorTakeoverCandidates[0].title, '阿青')

  const takeoverHost = directorHost({
    data: { writeLocked: false, canTakeoverRoles: true, roles: page.data.roles },
  })
  takeoverHost.openTakeoverRole({ detail: { id: '11:21' } })
  assert.equal(takeoverHost.data.takeoverSheetVisible, true, '点了候选行必须真开接管填写区')
  assert.equal(takeoverHost.data.takeoverDraft.sourceMemberId, 21)
  assert.equal(takeoverHost.data.takeoverDraft.targetMemberId, 22)
})

test('D7 定向广播:范围 chip 是 {id,label} 且按 detail.id 切换;目标行有 id/title 且按 detail.id 选中', () => {
  const host = hostWithProjection()
  assert.deepEqual(host.data.broadcastScopeOptions.map((o) => o.id), ['ALL', 'TEAM', 'ROLE'])

  directorMethods().selectBroadcastTargetType.call(host, { detail: { id: 'TEAM' } })
  assert.equal(host.data.broadcastDraft.targetType, 'TEAM', '切范围必须读 detail.id,不是 currentTarget.dataset')
  assert.deepEqual(host.data.broadcastTargetRows.map((r) => r.id), [11])
  assert.equal(host.data.broadcastTargetRows[0].title, '一队')
  assert.equal(host.data.broadcastPreviewReady, true)
  assert.match(host.data.broadcastPreviewText, /2 人/)

  directorMethods().onBroadcastTargetChange.call(host, { detail: { id: 11 } })
  assert.equal(host.data.broadcastDraft.targetIndex, 0, '选目标必须按 detail.id 反查 index,读 detail.value 会得到 NaN')
})

test('D4 手动解锁:章节行补 id,选择按 detail.id 反查索引', () => {
  const host = hostWithProjection()
  assert.deepEqual(host.data.chapterOptions.map((c) => c.id), [2, 5])
  directorMethods().onUnlockChapterChange.call(host, { detail: { id: 5 } })
  assert.equal(host.data.unlockChapterIndex, 1, '点第二章必须选中第二章,不是永远第 0 个')
})

test('宿主页 wxml 只喂投影后的数据,不许再喂原始投影/字符串数组', () => {
  assert.match(WXML, /role-options="\{\{roleOptions\}\}"/)
  assert.doesNotMatch(WXML, /role-options="\{\{roles\}\}"/)
  assert.match(WXML, /scope-options="\{\{broadcastScopeOptions\}\}"/)
  assert.doesNotMatch(WXML, /scope-options="\{\{broadcastTargetLabels\}\}"/)
  assert.match(WXML, /targets="\{\{broadcastTargetRows\}\}"/)
  assert.doesNotMatch(WXML, /targets="\{\{teams\}\}"/)
  assert.match(WXML, /bind:takeovertap="openTakeoverRole"/)
})
