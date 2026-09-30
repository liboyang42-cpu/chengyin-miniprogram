const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const storyFlow = require('../../pages/publish/utils/publish/pro-editor-story.js')
const draftStore = require('../../utils/publish/pro-editor-draft.js')

const PAGE = '../../pages/publish/fabu/index.js'
let pageConfig
let storage
let storageWrites
let navigated
let toasts = []

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 42,
  getNickname: () => '测试创作者',
  getAvatar: () => '',
  sendRequest: () => {},
  chooseImage: () => {},
  tips: () => {},
})

global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key, value) => { storageWrites += 1; storage[key] = value },
  removeStorageSync: key => { delete storage[key] },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: options => { toasts.push((options && options.title) || '') },
  showModal: options => { if (options && options.success) options.success({ confirm: true }) },
  navigateTo: options => { navigated = options },
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
  page.updateAllStatistics = () => {}
  return page
}

function storyChapter() {
  return {
    _localId: 'chapter-1', name: '第一章', description: '开场', required: 1,
    nodes: [{
      id: 501, _localId: 'node-1', name: '旧码头', address: '滨江路 8 号',
      longitude: 121.48, latitude: 31.23, imgUrl: 'pier.jpg', nodeTime: 45,
      templateId: 7, templateInfo: { title: '文字暗号' }, hookText: '先看桥洞',
    }],
    blocks: [
      { key: 'text-1', type: 'text', content: '开场' },
      { key: 'node-block', type: 'node', nodeKey: 'node-1' },
      { key: 'text-2', type: 'text', content: '收尾' },
    ],
  }
}

beforeEach(() => {
  toasts = []
  storage = {}
  storageWrites = 0
  navigated = null
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

function chapterWithTwoTextBlocks() {
  return {
    _localId: 'chapter-1',
    name: '第一章',
    nodes: [],
    blocks: [
      { key: 'before', type: 'text', content: '游戏之前' },
      { key: 'after', type: 'text', content: '游戏之后' },
    ],
  }
}

test('A12：文字块插入到被点击的缝，不会追加到末尾', () => {
  const result = storyFlow.applyStoryCommand(
    { chapter: chapterWithTwoTextBlocks(), pendingMaterials: [] },
    { type: 'insertTextAt', index: 1, blockKey: 'inserted' },
  )

  assert.deepEqual(
    result.draft.chapter.blocks.map(block => block.key),
    ['before', 'inserted', 'after'],
  )
})

// 2026-08-11 语义改判:✕ = 真删,不再"移到待编排区"(待编排区已按用户要求下线)。
// 契约跟着钉新的保证 —— 删干净【且】撤销拿得回来:removed 快照必须带齐
// blockIndex / block / node 三样,少一样都塞不回原位。
test('A13：删除节点真删,但 removed 快照必须带齐能塞回原位的三样', () => {
  const chapter = {
    _localId: 'chapter-1',
    name: '第一章',
    nodes: [{
      _localId: 'node-1',
      id: 501,
      name: '旧码头',
      description: '找桥洞刻字',
      address: '滨江路 8 号',
      longitude: 121.48,
      latitude: 31.23,
      imgUrl: 'pier.jpg',
      nodeTime: 45,
      templateId: 7,
      templateInfo: { title: '文字暗号' },
      hookText: '先看桥洞',
      cardHookLong: '找到第三块砖',
      fragmentText: '一段旧报纸',
    }],
    blocks: [
      { key: 'before', type: 'text', content: '雨夜抵达码头。' },
      { key: 'node-block', type: 'node', nodeKey: 'node-1' },
      { key: 'after', type: 'text', content: '潮声盖住了脚步。' },
    ],
  }

  const result = storyFlow.applyStoryCommand(
    { chapter, pendingMaterials: [] },
    { type: 'removeNode', blockKey: 'node-block' },
  )

  assert.deepEqual(result.draft.chapter.blocks.map(block => block.key), ['before', 'after'])
  assert.deepEqual(result.draft.chapter.nodes, [])
  // 真删:不再往 pendingMaterials 里留影子副本
  assert.deepEqual(result.draft.pendingMaterials, [])
  // 撤销靠这份快照,配置一样不能少
  assert.equal(result.removed.blockIndex, 1)
  assert.equal(result.removed.block.key, 'node-block')
  assert.equal(result.removed.node.name, chapter.nodes[0].name)
  assert.equal(result.removed.node.address, chapter.nodes[0].address)
  assert.equal(result.removed.node.imgUrl, chapter.nodes[0].imgUrl)
  assert.equal(result.removed.node.templateId, chapter.nodes[0].templateId)
  assert.equal(result.removed.node.cardHookLong, chapter.nodes[0].cardHookLong)

  // 正向:三样齐全时,原位塞得回去、配置一样不少
  const back = storyFlow.applyStoryCommand(
    { chapter: result.draft.chapter, pendingMaterials: [] },
    { type: 'insertNodeAt', index: result.removed.blockIndex, blockKey: result.removed.block.key, node: result.removed.node },
  )
  assert.deepEqual(back.draft.chapter.blocks.map(block => block.key), ['before', 'node-block', 'after'])
  assert.equal(back.draft.chapter.nodes[0].templateId, chapter.nodes[0].templateId)
})

// ⚠️ 上面那条曾经把这段正向 round-trip 标成「负控」—— 它什么都没抽掉,永远不会红,
// 是个橡皮图章。真负控在这:逐样抽掉快照里的东西,必须真的塞不回原位。
test('negative control: 撤销快照少任一样,都塞不回原位', () => {
  const chapter = storyChapter()
  const result = storyFlow.applyStoryCommand(
    { chapter, pendingMaterials: [] },
    { type: 'removeNode', blockKey: 'node-block' },
  )
  const { blockIndex, block, node } = result.removed
  const restored = () => JSON.parse(JSON.stringify(result.draft.chapter))

  // ① 少了 node:命令拿不到要塞回去的节点本体
  assert.throws(() => storyFlow.applyStoryCommand(
    { chapter: restored(), pendingMaterials: [] },
    { type: 'insertNodeAt', index: blockIndex, blockKey: block.key, node: undefined },
  ), /节点缺少本地标识/, '少了 node 竟然还能插回去 ⇒ 快照里 node 这一样是白存的')

  // ② 少了 blockIndex:插入点失效,不能默默塞到末尾(那是"位置丢了"却装作成功)
  assert.throws(() => storyFlow.applyStoryCommand(
    { chapter: restored(), pendingMaterials: [] },
    { type: 'insertNodeAt', index: undefined, blockKey: block.key, node },
  ), /插入点已失效/, '少了 blockIndex 竟然还能插 ⇒ 撤销会把节点塞到错的位置')

  // ③ 少了 block.key:块没有本地标识,后续所有按 key 的操作都会失联
  const noKey = storyFlow.applyStoryCommand(
    { chapter: restored(), pendingMaterials: [] },
    { type: 'insertNodeAt', index: blockIndex, blockKey: undefined, node },
  )
  assert.equal(noKey.draft.chapter.blocks[blockIndex].key, undefined,
    '少了 blockKey 却凭空补出一个 key ⇒ 撤销出来的块和原来那个不是同一个')
})

test('删除文字块后不合并相邻文字块', () => {
  const chapter = chapterWithTwoTextBlocks()
  chapter.blocks.splice(1, 0, { key: 'remove-me', type: 'text', content: '误加文字' })

  const result = storyFlow.applyStoryCommand(
    { chapter, pendingMaterials: [] },
    { type: 'removeText', blockKey: 'remove-me' },
  )

  assert.deepEqual(result.draft.chapter.blocks, chapterWithTwoTextBlocks().blocks)
})

test('A12：节点块和待编排素材也插入到被点击的缝', () => {
  const pending = {
    _localId: 'pending-node', kind: 'node', name: '邻里苑', description: '找到门牌',
    address: '春申路 1 号', longitude: 121.4, latitude: 31.1, imgUrl: 'gate.jpg',
    duration: 30, gameplay: { templateId: 9, hookText: '先看门牌' },
  }
  const node = {
    _localId: pending._localId, name: pending.name, description: pending.description,
    address: pending.address, longitude: pending.longitude, latitude: pending.latitude,
    imgUrl: pending.imgUrl, nodeTime: pending.duration, templateId: pending.gameplay.templateId,
    hookText: pending.gameplay.hookText,
  }

  const result = storyFlow.applyStoryCommand(
    { chapter: chapterWithTwoTextBlocks(), pendingMaterials: [pending] },
    { type: 'insertNodeAt', index: 1, blockKey: 'node-block', node },
  )

  assert.deepEqual(result.draft.chapter.blocks.map(block => block.key), ['before', 'node-block', 'after'])
  assert.equal(result.draft.chapter.blocks[1].nodeKey, pending._localId)
  assert.equal(result.draft.chapter.nodes.length, 1)
  assert.equal(result.draft.chapter.nodes[0]._localId, node._localId)
  assert.equal(result.draft.chapter.nodes[0].templateId, node.templateId)
  assert.equal(result.draft.chapter.nodes[0].sortID, 1)
  assert.deepEqual(result.draft.pendingMaterials, [])
})

test('编辑文字只修改目标块', () => {
  const chapter = chapterWithTwoTextBlocks()
  const result = storyFlow.applyStoryCommand(
    { chapter, pendingMaterials: [] },
    { type: 'editText', blockKey: 'after', content: '新的游戏后文字' },
  )

  assert.equal(result.draft.chapter.blocks[0].content, chapter.blocks[0].content)
  assert.equal(result.draft.chapter.blocks[1].content, '新的游戏后文字')
})

test('编辑节点通过故事流命令更新配置且不改变块位置', () => {
  const chapter = storyChapter()
  const editedNode = Object.assign({}, chapter.nodes[0], {
    name: '修缮后的旧码头',
    address: '滨江路 18 号',
    templateId: 11,
  })

  const result = storyFlow.applyStoryCommand(
    { chapter, pendingMaterials: [] },
    { type: 'editNode', node: editedNode },
  )

  assert.deepEqual(result.draft.chapter.blocks.map(block => block.key), chapter.blocks.map(block => block.key))
  assert.equal(result.draft.chapter.nodes[0].name, editedNode.name)
  assert.equal(result.draft.chapter.blocks[1]._nodeName, editedNode.name)
  assert.equal(result.draft.chapter.blocks[1]._nodeAddress, editedNode.address)
})

test('删除携带最新编辑的节点时,快照要拿到编辑后的值而不是删除前的旧值', () => {
  const chapter = storyChapter()
  const editedNode = Object.assign({}, chapter.nodes[0], {
    longitude: '',
    latitude: '',
    hookText: '保留修改后的钩子',
  })

  const result = storyFlow.applyStoryCommand(
    { chapter, pendingMaterials: [] },
    { type: 'removeNode', blockKey: 'node-block', node: editedNode },
  )

  assert.equal(result.draft.chapter.blocks.some(block => block.type === 'node'), false)
  assert.deepEqual(result.draft.chapter.nodes, [])
  assert.deepEqual(result.draft.pendingMaterials, [])
  assert.equal(result.removed.node.hookText, editedNode.hookText)
})

test('编辑回填把服务端 nodeId 块映射成本地 nodeKey，并按故事流排列节点', () => {
  const source = {
    id: 41,
    name: '第一章',
    description: '旧描述投影',
    nodes: [
      { id: 501, _localId: 'node-a', name: 'A' },
      { id: 502, _localId: 'node-b', name: 'B' },
    ],
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'node', nodeId: 502 },
      { type: 'text', content: '转场' },
      { type: 'node', nodeId: 501 },
    ],
  }
  let keySequence = 0

  const chapter = storyFlow.materializeChapter(source, () => 'block-' + (++keySequence))

  assert.deepEqual(chapter.blocks.map(block => block.nodeKey || block.content), ['开场', 'node-b', '转场', 'node-a'])
  assert.deepEqual(chapter.nodes.map(node => node._localId), ['node-b', 'node-a'])
})

test('提交投影只上送 schemaVersion、nodeIndex 与正文，不泄漏本地块 key', () => {
  const chapter = {
    _localId: 'chapter-1', name: '第一章', description: '旧投影', required: 1,
    nodes: [
      { _localId: 'node-b', name: 'B' },
      { _localId: 'node-a', name: 'A' },
    ],
    blocks: [
      { key: 'text-1', type: 'text', content: '开场' },
      { key: 'node-1', type: 'node', nodeKey: 'node-b' },
      { key: 'text-2', type: 'text', content: '转场' },
      { key: 'node-2', type: 'node', nodeKey: 'node-a' },
    ],
  }

  const payload = storyFlow.toPayloadChapter(chapter)

  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.required, 1)
  assert.deepEqual(payload.blocks, [
    { type: 'text', content: '开场' },
    { type: 'node', nodeIndex: 0 },
    { type: 'text', content: '转场' },
    { type: 'node', nodeIndex: 1 },
  ])
  assert.equal(Object.hasOwn(payload.blocks[0], 'key'), false)
  assert.equal(Object.hasOwn(payload.blocks[1], 'nodeKey'), false)
})

test('A15：pendingInsertAt 存在页面 data，跳模板编辑页并回传后仍保留原锚点', () => {
  const page = makePage()
  page.data.formData.name = '码头故事'
  page.data.formData.productType = 1
  page.data.formData.chapters = [storyChapter()]

  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  page.insertStoryNodeAt({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.pendingInsertAt, 1)

  page.onCreateGame()
  navigated.events.templateCreated({ id: 19, title: '新建玩法' })

  assert.equal(page.data.pendingInsertAt, 1)
  assert.equal(page.data.nodesForm.templateId, 19)
})

test('A16：取消添加节点严格不改 blocks', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.data.formData.chapters = [storyChapter()]
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  page.insertStoryNodeAt({ currentTarget: { dataset: { index: 1 } } })
  const beforeBlocks = JSON.parse(JSON.stringify(page.data.formData.chapters[0].blocks))
  const beforeDraft = JSON.parse(JSON.stringify({
    formData: page.data.formData,
    pendingMaterials: page.data.pendingMaterials,
  }))

  page.cancelPopChapter()

  assert.deepEqual(page.data.formData.chapters[0].blocks, beforeBlocks)
  assert.deepEqual({
    formData: page.data.formData,
    pendingMaterials: page.data.pendingMaterials,
  }, beforeDraft)
  assert.equal(page.data.pendingInsertAt, null)
})

test('A13：删除节点后一次 storage 写入,且删掉的节点不在信封里留影子副本', () => {
  const page = makePage()
  page.data.editingTopicId = '77'
  page.data.baseRevision = 'server-v1'
  page.data.draftMemberId = 42
  page.data.formData.productType = 1
  page.data.formData.chapters = [storyChapter()]
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  page._installDraftAutosave()
  page._draftAutosaveReady = true
  const writesBeforeDelete = storageWrites

  page.removeStoryNode({ currentTarget: { dataset: { blockkey: 'node-block' } } })

  const envelope = storage[draftStore.draftKeyFor({ topicId: '77' })]
  assert.equal(envelope.baseRevision, 'server-v1')
  assert.deepEqual(envelope.chapters, page.data.formData.chapters)
  assert.deepEqual(envelope.pendingMaterials, page.data.pendingMaterials)
  assert.equal(envelope.chapters[0].nodes.length, 0)
  // 真删:落盘的信封里不该再有那个节点的任何副本(撤销走的是内存快照,不落盘)
  assert.deepEqual(envelope.pendingMaterials, [])
  assert.equal(storageWrites - writesBeforeDelete, 1)
})

test('故事流删节点:撤销快照必须真建起来 —— 不能"节点已删却报删除失败、撤销条卡死"', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.data.formData.chapters = [storyChapter()]
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  const before = JSON.parse(JSON.stringify(page.data.formData.chapters[0].nodes[0]))

  page.removeStoryNode({ currentTarget: { dataset: { blockkey: 'node-block' } } })

  // 节点确实删了
  assert.equal(page.data.formData.chapters[0].nodes.length, 0)
  // ⚠️ 这条是本测试的核心:_removeStoryNodeNow 整段包在一个 try 里,中途任何 TypeError
  //    都会被 catch 成一句「删除失败」—— 而此时 _storyCommand 早已把节点删掉、盘也写了。
  //    「删了却说失败」是最坏的一种谎,而且后面的 setTimeout 没跑 ⇒ 撤销条永不消失。
  //    只断言"节点没了"抓不到它(删除发生在抛错之前),必须连 toast 一起断。
  // ⚠️ 观测点选择本身踩过一次坑,记在这:第一版断的是「toast 不含"失败"」,结果没红 ——
  //    catch 走的是 error.message,而 TypeError 的 message 是英文
  //    ("Cannot read properties of undefined"),压根不含那两个字。
  //    快照也不行:它在抛错【之前】就赋值了,恒为真。
  //    唯一在抛错【之后】才发生、因而真能判红的观测点,是 5 秒自动收起的定时器。
  assert.ok(!/Cannot read|undefined|TypeError|is not a function/.test(toasts.join(' | ')),
    '弹出了异常文本当提示 ⇒ 中途抛错被 catch 吞掉:' + JSON.stringify(toasts))
  assert.ok(page._pendingUndoTimer,
    '5 秒自动收起的定时器没建 ⇒ 撤销条会永远挂在屏幕上(而节点其实已经删了)')
  assert.ok(page._pendingUndoSnapshot, '撤销快照没建 ⇒ 撤不回来')

  // 撤销要能原样塞回去(配置一样不少)
  page.undoPendingRemoval()
  const back = page.data.formData.chapters[0].nodes
  assert.equal(back.length, 1)
  assert.equal(back[0]._localId, before._localId)
  assert.equal(back[0].templateId, before.templateId)
})

test('A14：删服务端节点后重开不会把它复活,且版本变化必须报冲突', () => {
  const page = makePage()
  page.data.editingTopicId = '77'
  page.data.baseRevision = 'server-v1'
  page.data.draftMemberId = 42
  page.data.formData.productType = 1
  page.data.formData.chapters = [storyChapter()]
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } })
  page._installDraftAutosave()
  page._draftAutosaveReady = true
  page.removeStoryNode({ currentTarget: { dataset: { blockkey: 'node-block' } } })

  const ready = draftStore.loadDraft(wx, { topicId: '77' }, {
    memberId: 42, currentBaseRevision: 'server-v1',
  })
  assert.equal(ready.status, 'ready')
  const reopened = makePage()
  reopened._applyDraftEnvelope(ready.envelope)
  // 删掉之后重开:章节里没有、待编排区也没有 —— 一处都不许残留,
  // 否则"删了"和"没删"取决于你从哪个列表看,是最难查的一类脏数据。
  const occurrences = reopened.data.formData.chapters[0].nodes
    .filter(node => node._localId === 'node-1').length
    + reopened.data.pendingMaterials.filter(item => item._localId === 'node-1').length
  assert.equal(occurrences, 0)

  const conflict = draftStore.loadDraft(wx, { topicId: '77' }, {
    memberId: 42, currentBaseRevision: 'server-v2',
  })
  assert.equal(conflict.status, 'revision_conflict')
})

test('自由探索提交投影剔除故事流字段，不会误入块化写路径', () => {
  const page = makePage()
  const source = storyChapter()
  source.schemaVersion = 1

  const payload = page._nonStoryPayloadChapter(source)

  assert.equal(Object.hasOwn(payload, 'blocks'), false)
  assert.equal(Object.hasOwn(payload, 'schemaVersion'), false)
  assert.equal(payload.nodes.length, source.nodes.length)
})

// ===== 章节图片 / 音频块(2026-08-16)=====
// 后端 ChapterFlowCompiler 是严格白名单,前端这三条契约必须与它同口径,否则编辑器里
// 摆得好好的块,提交时被后端整章打回 —— 而报错只说「块类型只允许…」,查不到是哪一块。

test('图片块插到被点击的缝,并带着 url 一起落块', () => {
  const result = storyFlow.applyStoryCommand(
    { chapter: chapterWithTwoTextBlocks(), pendingMaterials: [] },
    { type: 'insertMediaAt', mediaType: 'image', index: 1, blockKey: 'img-1', url: 'https://cdn/x.jpg' },
  )

  assert.deepEqual(
    result.draft.chapter.blocks.map(block => block.key),
    ['before', 'img-1', 'after'],
  )
  assert.equal(result.draft.chapter.blocks[1].type, 'image')
  assert.equal(result.draft.chapter.blocks[1].url, 'https://cdn/x.jpg')
})

test('没有 url 的媒体块必须当场被拒,不许落成一个点不开的空壳', () => {
  assert.throws(() => storyFlow.applyStoryCommand(
    { chapter: chapterWithTwoTextBlocks(), pendingMaterials: [] },
    { type: 'insertMediaAt', mediaType: 'image', index: 0, blockKey: 'img-1', url: '   ' },
  ), /媒体块缺少地址/)
})

// ★ 这条是整组里最容易悄悄坏的:description 是章节摘要,会漏到列表页/分享卡。
// 把图片 url 拼进去不会报错,只会在列表页出现一行 https://cdn/x.jpg。
test('媒体块不进 description 投影 —— 章节摘要是纯文本', () => {
  const chapter = {
    _localId: 'chapter-1', name: '第一章', nodes: [],
    blocks: [
      { key: 'text-1', type: 'text', content: '开场' },
      { key: 'img-1', type: 'image', url: 'https://cdn/x.jpg' },
      { key: 'audio-1', type: 'audio', url: 'https://cdn/x.mp3' },
      { key: 'text-2', type: 'text', content: '收尾' },
    ],
  }

  const payload = storyFlow.toPayloadChapter(chapter)

  assert.equal(payload.description, '开场\n收尾')
  assert.equal(payload.description.includes('cdn'), false)
})

test('媒体块往返序列化:只留 type + url', () => {
  const chapter = {
    _localId: 'chapter-1', name: '第一章', nodes: [],
    blocks: [
      { key: 'img-1', type: 'image', url: 'https://cdn/x.jpg' },
    ],
  }

  const payload = storyFlow.toPayloadChapter(chapter)

  assert.deepEqual(payload.blocks, [
    { type: 'image', url: 'https://cdn/x.jpg' },
  ])
})

test('存量章节重新打开时认得媒体块,不再抛「不支持的故事流块类型」', () => {
  let seq = 0
  const chapter = storyFlow.materializeChapter({
    _localId: 'chapter-1', name: '第一章', nodes: [],
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'image', url: 'https://cdn/x.jpg' },
      { type: 'audio', url: 'https://cdn/x.mp3' },
    ],
  }, () => 'k' + (seq += 1))

  assert.deepEqual(chapter.blocks.map(b => b.type), ['text', 'image', 'audio'])
  chapter.blocks.forEach(block => assert.ok(block.key, '每个块都要拿到本地 key'))
})

// 2026-09-06 用户裁决 B(章节旁白 + 故事流块并存)之后,原来那两条「存量 audio 块升成
// 章节属性」的用例作废 —— 块不再被搬走。改成钉「块原样留着、往返序列化不丢」。
test('audio 块原样留在故事流里,不再被升成章节属性', () => {
  let seq = 0
  const chapter = storyFlow.materializeChapter({
    _localId: 'chapter-1', name: '第一章', nodes: [],
    blocks: [
      { type: 'audio', url: 'https://cdn/first.mp3' },
      { type: 'text', content: '开场' },
      { type: 'audio', url: 'https://cdn/second.mp3' },
    ],
  }, () => 'k' + (seq += 1))

  assert.deepEqual(chapter.blocks.map(b => b.type), ['audio', 'text', 'audio'],
    '两段都留着:章节级那段是另一件事,不从块里迁')
  assert.equal(chapter.audioUrl, undefined, '不许顺手写章节级字段')
})

test('audio 块往返序列化只留 type + url', () => {
  const chapter = {
    _localId: 'chapter-1', name: '第一章', nodes: [],
    blocks: [{ key: 'a-1', type: 'audio', url: 'https://cdn/x.mp3' }],
  }
  assert.deepEqual(storyFlow.toPayloadChapter(chapter).blocks,
    [{ type: 'audio', url: 'https://cdn/x.mp3' }])
})

test('removeMedia 删得掉媒体块,且不误伤同 key 之外的块', () => {
  const result = storyFlow.applyStoryCommand({
    chapter: {
      _localId: 'chapter-1', name: '第一章', nodes: [],
      blocks: [
        { key: 'text-1', type: 'text', content: '开场' },
        { key: 'img-1', type: 'image', url: 'https://cdn/x.jpg' },
      ],
    },
    pendingMaterials: [],
  }, { type: 'removeMedia', blockKey: 'img-1' })

  assert.deepEqual(result.draft.chapter.blocks.map(b => b.key), ['text-1'])
})

test('removeMedia 不许拿去删文字块 —— 类型不符要报错而不是静默删掉', () => {
  assert.throws(() => storyFlow.applyStoryCommand({
    chapter: chapterWithTwoTextBlocks(), pendingMaterials: [],
  }, { type: 'removeMedia', blockKey: 'before' }), /未找到要删除的媒体块/)
})


test('相册从故事添加玩法入口插入原位置，模板快照不串数据且不创建必做节点', () => {
  const page = makePage();
  page.data.formData.chapters = [chapterWithTwoTextBlocks()];
  page.getTempList = () => {};
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } });
  page.insertStoryGameAt({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.editTargetChapterLid, 'chapter-1');
  assert.equal(page.data.popChapterNodesAction, 0);
  assert.equal(page.data.nodeSheetView, 'games');
  const template = { title: '梦', advancedConfigJson: JSON.stringify({ album: { enabled: true, images: [{ url: 'https://example.com/a.jpg', line: '童年' }] } }) };
  assert.equal(page._insertAlbumTemplate(template), true);
  const chapter = page.data.formData.chapters[0];
  assert.deepEqual(chapter.blocks.map(b => b.type), ['text', 'dream', 'text']);
  assert.equal(chapter.blocks[1].title, '梦');
  assert.equal(chapter.blocks[1].images[0].line, '童年');
  assert.deepEqual(chapter.nodes, []);
  assert.equal(page.data.popChapterNodes, false);
  page.insertStoryGameAt({ currentTarget: { dataset: { index: 2 } } });
  page._insertAlbumTemplate(template);
  page.onAlbumTitleInput({ currentTarget: { dataset: { blockkey: chapter.blocks[1].key } }, detail: { value: '旧梦' } });
  assert.deepEqual(page.data.formData.chapters[0].blocks.filter(b => b.type === 'dream').map(b => b.title), ['旧梦', '梦']);
});


test('新相册删光照片后不能静默删除或关闭保存', () => {
  const page = makePage();
  const chapter = chapterWithTwoTextBlocks();
  chapter.blocks.splice(1, 0, {type: 'dream', key: 'album-empty', title: '梦', images: []});
  page.data.formData.chapters = [chapter];
  page.openStoryEditor({ currentTarget: { dataset: { index: 0 } } });
  page.closeStoryEditor();
  assert.equal(page.data.storyEditor.show, true);
  assert.ok(toasts.includes('相册至少添加 1 张照片'));
  assert.equal(page.data.formData.chapters[0].blocks.length, 3);
  assert.throws(() => storyFlow.toPayloadChapter(chapter), /至少添加 1 张/);
});
