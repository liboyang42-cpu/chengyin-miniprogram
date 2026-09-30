const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE = '../../pages/publish/fabu/index.js'
const ROOT = path.join(__dirname, '../..')
const draftStore = require('../../utils/publish/pro-editor-draft.js')

let pageConfig
let storage
let toasts
let modals
let chooseLocationCalls
let chooseLocationOptions
let requests

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 42,
  getNickname: () => '测试创作者',
  getAvatar: () => '',
  sendRequest: options => { requests.push(options) },
  chooseImage: () => {},
  tips: () => {},
})

global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key, value) => { storage[key] = value },
  removeStorageSync: key => { delete storage[key] },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: options => { toasts.push(options && options.title) },
  hideLoading: () => {},
  showModal: options => {
    modals.push(options)
    if (options && options.success) options.success({ confirm: true })
  },
  chooseLocation: options => {
    chooseLocationCalls += 1
    chooseLocationOptions = options
  },
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {},
  nextTick: callback => callback(),
}

global.Page = config => { pageConfig = config }

function setAtPath(target, rawPath, value) {
  const parts = rawPath.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function makePage() {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(key => setAtPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  page.updateAllStatistics = function () { this.refreshPrimaryActionState() }
  return page
}

beforeEach(() => {
  storage = {}
  toasts = []
  modals = []
  chooseLocationCalls = 0
  chooseLocationOptions = null
  requests = []
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

test('自由探索空态主动作自动落「第1章」并打开正式节点弹窗（2026-08-20 拍板，取代旧的待编排入口）', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = []
  // 2026-09-05:三条起点的 CTA 收敛成同一颗「创建章节」,分支判据从 action.key 换成
  // productType —— 这条用例守的行为没变:自由探索建完章节必须把节点弹窗开在第 1 章上。
  page.data.starterAction = { key: 'createChapter', label: '＋ 创建章节' }

  page.onTapPrimaryStarter()

  assert.equal(page.data.formData.chapters.length, 1, '必须自动创建章节')
  assert.equal(page.data.formData.chapters[0].name, '第1章')
  assert.equal(page.data.popChapterNodes, true)
  assert.equal(page.data.nodeDraftDestination, 'formal')
  assert.equal(page.data.editTargetChapterLid, page.data.formData.chapters[0]._localId,
    '节点必须直接建进第1章，不再进待编排池')
})

test('添加章节不再弹弹窗：onTapAddChapter 直接以默认名落一章', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = []

  page.onTapAddChapter()

  assert.equal(page.data.popChapter, false, '不许打开章节弹窗')
  assert.equal(page.data.formData.chapters.length, 1)
  assert.equal(page.data.formData.chapters[0].name, '第1章')

  page.onTapAddChapter()
  assert.equal(page.data.formData.chapters.length, 2)
  assert.equal(page.data.formData.chapters[1].name, '第2章')
})

// ★ 2026-09-05 用户实测:「我先添加了,再删除了,就没办法再添加了」。
// 死锁长这样:starterAction 是派生态,只在 refreshPrimaryActionState 里算。章节有了内容之后
// 它变成 null;deleteChapter 当时不重算,于是删掉最后一章后它还是 null ——
// 而空态卡的 CTA 挂 `wx:if="{{starterAction}}"`、「添加章节」行挂
// `wx:if="{{chapters.length || pendingMaterials.length}}"`,两个条件同时不成立,
// 页面上再没有任何添加章节的入口。
// 这条必须是**行为测**:静态查 deleteChapter 里有没有那行调用,改个写法就绕过去了。
test('删掉最后一章之后必须还能再添加 —— 空态入口不能因为派生态没重算而消失', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = [{
    _localId: 'ch-1', name: '第1章', nodes: [{ _localId: 'n-1', name: '站点', address: '某地' }], blocks: [],
  }]
  page.data.popChapterIndex = 0

  // 前置条件不硬写,由现码自己派生出来:有内容的章节 ⇒ 不是空草稿 ⇒ 没有空态 CTA
  page.refreshPrimaryActionState()
  assert.equal(page.data.starterAction, null, '前置:有内容时空态 CTA 本来就不该在')

  page.deleteChapter({ currentTarget: { dataset: {} } })

  assert.equal(page.data.formData.chapters.length, 0)
  assert.ok(page.data.starterAction, '删空之后空态 CTA 必须回来,否则页面上没有任何添加入口')
  // 把 WXML 那两个条件原样复述一遍:两个都不成立 = 用户看到的那个死锁
  const emptyCtaVisible = page.data.formData.chapters.length === 0 && !!page.data.starterAction
  const addRowVisible = !!(page.data.formData.chapters.length || page.data.pendingMaterials.length)
  assert.ok(emptyCtaVisible || addRowVisible, '空态 CTA 与「添加章节」行必须至少有一个在')
})

test('自由探索节点可不填地点保存，但只能进入待编排区', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = []
  page.data.nodeDraftDestination = 'pending'
  page.data.nodesForm = Object.assign({}, page.data.nodesForm, {
    name: '先写好的观察任务',
    description: '找到一扇蓝色的门',
    longitude: '',
    latitude: '',
  })

  page.confrimNode()

  assert.equal(page.data.pendingMaterials.length, 1)
  assert.equal(page.data.pendingMaterials[0].kind, 'node')
  assert.equal(page.data.pendingMaterials[0].name, '先写好的观察任务')
  assert.equal(page.data.pendingMaterials[0].longitude, '')
  assert.deepEqual(page.data.formData.chapters, [])
  assert.equal(toasts.at(-1), '已保存到待编排区')
})

test('每次素材变更立即原子保存完整草稿信封，重进恢复同一新草稿', () => {
  const first = makePage()
  first.onLoad({ mode: '2' })
  first.data.nodeDraftDestination = 'pending'
  first.data.nodesForm = Object.assign({}, first.data.nodesForm, {
    name: '稍后选地点的观察任务',
    description: '先记录任务内容',
    longitude: '',
    latitude: '',
  })

  first.confrimNode()

  const draftUuid = first.data.draftUuid
  const draftKey = draftStore.draftKeyFor({ draftUuid })
  const envelope = storage[draftKey]
  assert.equal(envelope.memberId, 42)
  assert.equal(envelope.draftUuid, draftUuid)
  assert.deepEqual(envelope.chapters, first.data.formData.chapters)
  assert.deepEqual(envelope.pendingMaterials, first.data.pendingMaterials)
  assert.equal(envelope.pendingMaterials.length, 1)

  const reopened = makePage()
  reopened.onLoad({ mode: '2' })
  assert.equal(reopened.data.draftUuid, draftUuid, '同一账号重进必须恢复活动草稿，不得另开固定 _new 桶')
  assert.equal(reopened.data.pendingMaterials.length, 1)
  assert.equal(reopened.data.pendingMaterials[0].name, '稍后选地点的观察任务')
  // 2026-08-11:常驻提示条下线,改成恢复瞬间弹一次 toast(见 _applyDraftEnvelope)。
  // 契约钉 toast 的文案。原来这里还有一条 assert.equal(pendingRestoreNotice, '') ——
  // 字段本身已随提示条一起删掉,那条是恒真断言,一并去掉,别留橡皮图章。
  assert.ok(toasts.includes('已恢复上次未编排完的 1 个素材'),
    '恢复草稿必须弹一次 toast:提示条撤了之后,不弹就等于什么都没告诉人')

  reopened.data.nodeDraftDestination = 'pending'
  reopened.data.nodesForm = Object.assign({}, reopened.data.nodesForm, {
    name: '恢复后新增的第二个任务', description: '验证本地 ID 不复用', longitude: '', latitude: '',
  })
  reopened.confrimNode()
  assert.equal(new Set(reopened.data.pendingMaterials.map(item => item._localId)).size, 2,
    '恢复后必须推进本地 ID 序号，不能用新素材覆盖旧素材')
})

test('俱乐部锁定入口不恢复其它俱乐部的活跃草稿', () => {
  draftStore.saveDraft(wx, {
    memberId: 42,
    draftUuid: 'club-a-draft',
    formData: Object.assign({}, pageConfig.data.formData, { clubId: '11', chapters: [] }),
    pendingMaterials: [{
      _localId: 'place-a', kind: 'place', name: 'A 俱乐部地点', description: '',
      address: 'A 路', longitude: 121.4, latitude: 31.2, imgUrl: '', duration: 30, gameplay: null,
    }],
  })
  const page = makePage()
  page.startClubPlaceCapture = () => {}

  page.onLoad({ clubId: '22' })

  assert.notEqual(page.data.draftUuid, 'club-a-draft')
  assert.equal(page.data.formData.clubId, '22')
  assert.deepEqual(page.data.pendingMaterials, [])
})

test('待编排状态与归章闸共用可用坐标语义，零值变体不能显示已配置', () => {
  const page = makePage()
  page.data.pendingMaterials = [{
    _localId: 'zero-place', kind: 'place', name: '错误地点', description: '', address: '测试路',
    longitude: '0.0', latitude: '31.2', imgUrl: '', duration: 30, gameplay: null,
  }]

  page.refreshPrimaryActionState()

  assert.equal(page.data.pendingMaterialStates['zero-place'], false)
})

test('节点弹窗坐标状态也由同一可用坐标闸派生', () => {
  const page = makePage()
  page.onLoad({ mode: '2' })

  page.setData({ nodesForm: Object.assign({}, page.data.nodesForm, { longitude: '0.0', latitude: '31.2' }) })
  assert.equal(page.data.nodesFormLocationReady, false)

  page.setData({ nodesForm: Object.assign({}, page.data.nodesForm, { longitude: '121.48', latitude: '31.23' }) })
  assert.equal(page.data.nodesFormLocationReady, true)
})

test('恢复完整草稿后用户资料回调不能清空已有合作者', () => {
  const formData = Object.assign({}, pageConfig.data.formData, {
    productType: 2,
    chapters: [],
    collaboratorList: [
      { id: 42, nickname: '旧昵称', isOwner: 1 },
      { id: 99, nickname: '同行者' },
    ],
    collaboratorIds: [42, 99],
  })
  draftStore.saveDraft(wx, {
    memberId: 42,
    draftUuid: 'collaborator-draft',
    formData,
    pendingMaterials: [],
  })
  const page = makePage()

  page.onLoad({ mode: '2' })
  const userRequest = requests.find(request => request.url === '/api/user/info')
  userRequest.success({ code: '200', data: { id: 42, nickname: '新昵称', avatar: 'new.png' } })

  assert.deepEqual(page.data.formData.collaboratorIds, [42, 99])
  assert.equal(page.data.formData.collaboratorList.length, 2)
  assert.equal(page.data.formData.collaboratorList[1].nickname, '同行者')
})

test('既有主题服务端版本变化时明确询问，确认后才恢复本地完整草稿', () => {
  const page = makePage()
  const localForm = Object.assign({}, page.data.formData, { name: '本地未保存版本', chapters: [] })
  page.data.editingTopicId = '77'
  page.data.formData.name = '服务端新版'
  draftStore.saveDraft(wx, {
    memberId: 42,
    topicId: '77',
    baseRevision: 'server-v1',
    formData: localForm,
    pendingMaterials: [],
  })

  page._finishEditingDraftBootstrap({ topic: { memberId: 42, updateTime: 'server-v2' } })

  assert.equal(modals.at(-1).content, '其他设备上的草稿已更新，是否用本机草稿覆盖？')
  assert.equal(page.data.formData.name, '本地未保存版本')
  assert.equal(page.data.baseRevision, 'server-v2')
})

test('发布校验精确报 pendingMaterials，不能被其它必填闸掩盖', () => {
  const page = makePage()
  page.data.pendingMaterials = [{ _localId: 'p1', kind: 'node', name: '未归章节点' }]

  const bag = page._buildValidationBag()

  assert.equal(bag.errors.pendingMaterials, '还有 1 个素材未编排进章节')
})

test('发布校验拒绝越界坐标并指认到具体章节节点', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = [{
    name: '第一章',
    description: '',
    nodes: [{ name: '错误地点', longitude: 181, latitude: 31.2 }],
  }]

  const bag = page._buildValidationBag()

  assert.equal(bag.errors.chapter0, '第1章第1个节点还没有选地点')
})

test('城市定向新建第一章进入空故事流，章节卡不再写剧情或自动塞节点', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.showAddChapter({ currentTarget: { dataset: {} } })
  page.data.chapterForm.name = '第一章'
  page.data.chapterForm.description = ''

  page.confrimChapter()
  assert.equal(page.data.formData.chapters.length, 1)
  assert.deepEqual(page.data.formData.chapters[0].nodes, [])
  assert.deepEqual(page.data.formData.chapters[0].blocks, [])
  assert.equal(page.data.storyEditor.show, true)
})

test('俱乐部连续 POI：每次有效选择落入地点素材并立即继续搜索，取消才结束', () => {
  const page = makePage()
  page._scheduleClubPoiContinuation = callback => callback()

  page.startClubPlaceCapture()
  assert.equal(chooseLocationCalls, 1)
  chooseLocationOptions.success({
    type: 0,
    name: '旧码头',
    address: '滨江路 8 号',
    longitude: 121.48,
    latitude: 31.23,
  })

  assert.equal(page.data.pendingMaterials.length, 1)
  assert.equal(page.data.pendingMaterials[0].kind, 'place')
  assert.equal(page.data.pendingMaterials[0].longitude, 121.48)
  assert.equal(chooseLocationCalls, 2, '成功录入后 POI 搜索必须保持连续')

  chooseLocationOptions.success({ name: '', address: '', longitude: 0, latitude: 0 })
  assert.equal(page.data.pendingMaterials.length, 1, '无可用坐标的返回不能落入地点素材')
  assert.equal(chooseLocationCalls, 3, '拒绝无坐标结果后仍应保持连续搜索，不能被 active 状态卡死')

  chooseLocationOptions.fail({ errMsg: 'chooseLocation:fail cancel' })
  assert.equal(page.data.clubPlaceCaptureActive, false)
})

test('城市定向待编排素材先进入故事流选缝，补文字后才在目标缝转正', () => {
  const page = makePage()
  const pending = {
    _localId: 'p1', kind: 'node', name: '河畔线索', description: '找刻字',
    address: '滨江路 8 号', longitude: '121.48', latitude: '31.23',
    imgUrl: '', duration: 30, gameplay: null,
  }
  page.data.pendingMaterials = [pending]
  page.data.formData.productType = 1
  page.data.formData.chapters = [{ _localId: 'c1', name: '第一章', description: '', nodes: [] }]
  page._canAddFormalNodes = () => true

  page.arrangePendingIntoChapter({
    detail: { value: '0' },
    currentTarget: { dataset: { localid: 'p1' } },
  })
  assert.equal(page.data.pendingMaterials.length, 1)
  assert.equal(page.data.formData.chapters[0].nodes.length, 0)
  assert.equal(page.data.storyEditor.show, true)
  assert.equal(page.data.storyPendingMaterialLocalId, 'p1')
  assert.equal(toasts.at(-1), '请先添加文字，再点击目标缝插入节点')

  const textBlock = page.data.formData.chapters[0].blocks[0]
  page.onStoryTextInput({
    currentTarget: { dataset: { blockkey: textBlock.key } },
    detail: { value: '沿河寻找旧码头的来历。' },
  })
  page.insertStoryNodeAt({ currentTarget: { dataset: { index: 1 } } })
  page.confrimNode()
  assert.equal(page.data.pendingMaterials.length, 0)
  assert.equal(page.data.formData.chapters[0].nodes.length, 1)
  assert.equal(page.data.formData.chapters[0].nodes[0].name, '河畔线索')
  assert.equal(page.data.formData.chapters[0].blocks[1].nodeKey, 'p1')
})

test('待编排素材放入已有章节或新章节都必须经过正式节点配额闸', () => {
  const material = {
    _localId: 'quota-pending', kind: 'node', name: '额外节点', description: '测试配额',
    address: '测试路', longitude: 121.4, latitude: 31.2,
    imgUrl: '', duration: 30, gameplay: null,
  }
  const existing = makePage()
  existing.data.formData.productType = 2
  existing.data.formData.chapters = [{ _localId: 'c1', name: '第一章', description: '', nodes: [] }]
  existing.data.pendingMaterials = [material]
  existing._canAddFormalNodes = () => false

  existing.arrangePendingIntoChapter({
    detail: { value: '0' }, currentTarget: { dataset: { localid: material._localId } },
  })
  assert.equal(existing.data.formData.chapters[0].nodes.length, 0)
  assert.equal(existing.data.pendingMaterials.length, 1)

  const created = makePage()
  created.data.formData.productType = 2
  created.data.formData.chapters = []
  created.data.pendingMaterials = [material]
  created.showAddChapter({ currentTarget: { dataset: {} } })
  created.setData({ assignPendingLocalId: material._localId })
  created._canAddFormalNodes = () => false
  created.confrimChapter()
  assert.equal(created.data.formData.chapters.length, 0)
  assert.equal(created.data.pendingMaterials.length, 1)
})

test('新建章节归入素材后撤销必须同时恢复章节与待编排区', () => {
  const page = makePage()
  const material = {
    _localId: 'undo-pending', kind: 'node', name: '可撤销节点', description: '测试完整快照',
    address: '测试路', longitude: 121.4, latitude: 31.2,
    imgUrl: '', duration: 30, gameplay: null,
  }
  page.data.formData.productType = 2
  page.data.formData.chapters = []
  page.data.pendingMaterials = [material]
  page.showAddChapter({ currentTarget: { dataset: {} } })
  page.setData({ assignPendingLocalId: material._localId })
  page._canAddFormalNodes = () => true

  page.confrimChapter()
  assert.equal(page.data.formData.chapters.length, 1)
  assert.equal(page.data.pendingMaterials.length, 0)

  page.undo()
  assert.equal(page.data.formData.chapters.length, 0)
  assert.equal(page.data.pendingMaterials.length, 1)
  assert.equal(page.data.pendingMaterials[0]._localId, material._localId)
})

test('删除正式节点不是销毁，而是原样移回待编排区', () => {
  const page = makePage()
  page.data.formData.chapters = [{
    _localId: 'c1', name: '第一章', description: '真实剧情', nodes: [{
      _localId: 'n1', name: '旧码头', description: '找刻字', address: '滨江路 8 号',
      longitude: '121.48', latitude: '31.23', nodeTime: 45,
      templateId: 7, templateInfo: { title: '文字暗号' }, hookText: '看桥洞',
    }],
  }]
  page.data.editTargetChapterLid = 'c1'
  page.data.editTargetNodeLid = 'n1'

  page.deleteNode()

  assert.equal(page.data.formData.chapters[0].nodes.length, 0)
  assert.equal(page.data.pendingMaterials.length, 1)
  assert.equal(page.data.pendingMaterials[0].name, '旧码头')
  assert.equal(page.data.pendingMaterials[0].gameplay.templateId, 7)
  assert.equal(page.data.pendingUndo.show, true)
})

test('WXML 提供三起点主动作、待编排区、补内容与两种归章入口', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.js'), 'utf8')
  assert.match(wxml, /bindtap="onTapPrimaryStarter"/)
  assert.match(wxml, /\{\{starterAction\.label\}\}/)
  assert.match(wxml, /待编排区/)
  assert.match(wxml, /bindtap="editPendingMaterial"/)
  // 2026-08-25:选择器由原生 <picker> 迁到 <cy-dropdown>,绑定写法从 bindchange 变成
  // bind:change。断言的意图(控件必须接上 handler)不变,所以两种写法都认。
  assert.match(wxml, /bind:?change="arrangePendingIntoChapter"/)
  assert.match(wxml, /bindtap="createChapterForPending"/)
  assert.match(wxml + js, /把这段剧情落到地点/)
  assert.match(wxml, /bindinput="onNodeNameInput"/)
})
