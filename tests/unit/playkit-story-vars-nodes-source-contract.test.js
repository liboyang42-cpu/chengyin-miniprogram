/* 故事变量两个来源的合并口径(2026-09-18 集成缺口)
 *
 * 缺口形状:vars 只在 advanced 会话视图到达时落进 _storyVars,而章节文本与节点 story
 * 来自 /api/play/nodes —— 玩家还没开这一站的会话就读故事时,{name} 全部原样留着。
 * A 已把同一份 vars 也挂到 /api/play/nodes 回包(data.vars)。
 *
 * 两条口径在这里钉死:
 *   · 两个来源逐键合并,新回包覆盖旧键,谁都不许把另一个覆盖成空;
 *   · 空/缺失的 vars 一律不动已有值(服务端取不到时整块不下发)。
 * 再加一条:profile 提交成功后必须补拉一次 nodes,把刚填的名字带回来。
 */
const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const path = require('node:path')

const PLAY = '../../pages/play/index.js'

let pageConfig
let requests
let responder = null

/* 页面模块在加载时就 const app = getApp():所以这个对象必须稳定,回包行为靠 responder 换。 */
const APP = {
  globalData: {},
  getUserID: () => 1,
  sendRequest: (options) => { if (responder) responder(options) },
}
global.getApp = () => APP

global.wx = {
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  getMenuButtonBoundingClientRect: () => ({ top: 20, height: 32 }),
  getStorageSync: () => null,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: () => {},
  createSelectorQuery: () => ({
    selectAll: () => ({ boundingClientRect: () => {} }),
    select: () => ({ boundingClientRect: () => {}, scrollOffset: () => {} }),
    exec: () => {},
  }),
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

/** 页面替身:setData 只落数据,不跑回调(回调里是渲染后处理,这些用例只验数据)。 */
function makePage(overrides) {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) {
    Object.keys(patch).forEach(key => setAtPath(page.data, key, patch[key]))
  }
  page.measureChapter = () => {}
  page.playChapterAudio = () => {}
  Object.assign(page, overrides || {})
  return page
}

/** 假 sendRequest:按 URL 给回包;默认成功。 */
function respond(map) {
  return (options) => {
    requests.push(options)
    const hit = map[options.url]
    if (typeof hit === 'function') hit(options)
    else if (hit) options.success(hit)
    else options.success({ code: 200, data: {} })
  }
}

const NODES_OK = {
  code: 200,
  data: {
    mode: 1, topicId: 77, registered: true,
    chapters: [{ name: '第一章', blocks: [{ type: 'text', content: '「{name|有人}推开门。」' }] }],
    nodes: [{ nodeId: 501, name: '巷口', validationMethod: 0 }],
  },
}

const flush = () => new Promise(resolve => setImmediate(resolve))

beforeEach(() => {
  pageConfig = null
  requests = []
  responder = null
  delete require.cache[require.resolve(PLAY)]
  require(PLAY)
})

test('★/api/play/nodes 回包的 vars 必须落进 _storyVars,章节文本立刻就替换得动', async () => {
  const page = makePage()
  page.data.activityId = ''
  page.data.topicId = '77'
  responder = respond({
    '/api/play/nodes': {
      code: 200,
      data: Object.assign({}, NODES_OK.data, { vars: { name: '阿岚' } }),
    },
  })

  await page.loadData(true)
  await flush()

  assert.deepEqual(page._storyVars, { name: '阿岚' },
    'nodes 回包的 vars 没落进 _storyVars —— 章节里会一直显示 {name}')
  page.openChapterFull()
  assert.equal(page.data.chapterParas[0].text, '「阿岚推开门。」')
})

test('★合并口径:新回包逐键覆盖、空/缺失不动已有值,谁也不许把对方清空', async () => {
  const page = makePage()
  page._storyVars = { name: '阿岚', job: '店员' }

  assert.equal(page._mergeStoryVars({ job: '老师', luck: 2 }), true)
  assert.deepEqual(page._storyVars, { name: '阿岚', job: '老师', luck: 2 },
    '逐键合并:两边各有的键都要在,新回包的同名键覆盖旧值')

  assert.equal(page._mergeStoryVars({}), false, '空对象不算一次有效更新')
  assert.equal(page._mergeStoryVars(null), false, '缺失整块不算更新')
  assert.deepEqual(page._storyVars, { name: '阿岚', job: '老师', luck: 2 },
    '空/缺失的 vars 绝不能把已有值清掉(服务端取不到时整块不下发)')
})

test('★profile 提交成功后补拉 nodes:刚填的名字回到章节文本里(且只补拉一次)', async () => {
  const page = makePage()
  page.data.topicId = '77'
  page.data.chapter = {
    description: '',
    blocks: [{ type: 'text', content: '「{name|有人}推开门。」' }],
  }
  let nodesCalls = 0
  responder = (options) => {
    requests.push(options)
    if (options.url === '/api/play/nodes') {
      nodesCalls += 1
      options.success({
        code: 200,
        data: Object.assign({}, NODES_OK.data, { vars: { name: '阿岚' } }),
      })
      return
    }
    options.success({ code: 200, data: {} })
  }

  page.onAdvancedSession({ detail: { sessionId: 1, version: 2, playKit: { profile: { title: '出生登记', done: true } } } })
  await flush()

  assert.equal(nodesCalls, 1, 'profile 提交成功必须补拉一次 /api/play/nodes')
  assert.equal(page._storyVars.name, '阿岚')
  page.openChapterFull()
  assert.equal(page.data.chapterParas[0].text, '「阿岚推开门。」',
    '补拉回来的名字要能立刻替换 —— 章节开着就重铺')

  // 后续每个会话视图都会再抛一次:上升沿只认一次,不许反复重拉
  page.onAdvancedSession({ detail: { sessionId: 1, version: 4, playKit: { profile: { title: '出生登记', done: true } } } })
  await flush()
  assert.equal(nodesCalls, 1, 'profile.done 的上升沿只触发一次补拉')
})

test('章节屏没开时补拉只更新 vars,不强行打开章节', async () => {
  const page = makePage()
  page.data.topicId = '77'
  page.data.chapterFull = false
  responder = (options) => {
    requests.push(options)
    options.success(options.url === '/api/play/nodes'
      ? { code: 200, data: Object.assign({}, NODES_OK.data, { vars: { name: '阿岚' } }) }
      : { code: 200, data: {} })
  }

  page.onAdvancedSession({ detail: { sessionId: 1, version: 2, playKit: { profile: { done: true } } } })
  await flush()

  assert.equal(page._storyVars.name, '阿岚')
  assert.equal(page.data.chapterFull, false, '补拉不该把章节屏顶开')
})

test('不是 profile 提交(还没 done)时不补拉 —— 别拿每次会话视图去刷 nodes', async () => {
  const page = makePage()
  page.data.topicId = '77'
  let nodesCalls = 0
  responder = (options) => {
    requests.push(options)
    if (options.url === '/api/play/nodes') nodesCalls += 1
    options.success({ code: 200, data: {} })
  }

  page.onAdvancedSession({ detail: { sessionId: 1, version: 2, playKit: { profile: { done: false } } } })
  await flush()

  assert.equal(nodesCalls, 0)
})
