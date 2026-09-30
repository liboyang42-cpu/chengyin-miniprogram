// 游玩照片问答恢复链 v2:真实 pages/play + 真实 playkit-qa + 真实 advanced-game 状态机,
// 只在传输边界(app.sendRequest)注入合成接口——不替换 action/resolveUnknown,不用替身 action 假装成功。
//
// 覆盖独立要求:SUBMIT_QA 未提交网络失败、已提交丢回包(unknown)、unknown 回读失败后再次恢复;
// 并核实 kit.sessionId/version 来自真实 start→emitSession→onAdvancedSession 生命周期,
// 不重复算完成、不丢基础路线、恢复后可继续。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PLAY_PAGE = '../../pages/play/index.js'
const QA_COMPONENT = '../../pages/play/components/playkit-qa/index.js'
const ADVANCED_GAME = '../../pages/play/components/advanced-game/index.js'
const upload = require('../../utils/transport/upload-client.js')

const MIB = 1024 * 1024
const SESSION_ID = 501

let pageConfig
let componentConfig
let advancedConfig
let componentSlot = 'advanced'
let wxUploads
let toasts
let lastOperation
let mediaSuccess
let server

function setByPath(target, rawPath, value) {
  const parts = rawPath.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function makeOperation() {
  const listeners = []
  const op = {
    aborted: false,
    isAborted() { return op.aborted },
    onAbort(fn) { listeners.push(fn) },
    attach() {},
    finish() {},
    abort() { op.aborted = true; listeners.forEach((fn) => fn()) },
  }
  return op
}

/** 合成"服务端":只做契约层(I/O + 幂等 + 版本),状态机与页面链路全部用真实实现。 */
function makeServer() {
  const s = {
    sessionId: SESSION_ID,
    version: 1,
    persisted: [],
    idempotency: new Map(),
    actionPlan: [],
    statePlan: [],
    posts: [],
    gets: [],
  }
  s.view = () => ({
    sessionId: s.sessionId,
    version: s.version,
    status: 'RUNNING',
    readyForBase: true,
    config: {
      timer: { enabled: false }, random: { enabled: false, drawCount: 0, items: [] },
      branch: { enabled: false, steps: [] }, leaderboard: { enabled: false },
      multiplayer: { enabled: false, roles: [], requiredTurns: 1 },
    },
    draws: [],
    branch: null,
    multiplayer: null,
    playKit: { qa: { mode: 'SHOT', title: '拍一张', shotLead: '拍门口', complete: s.persisted.length > 0 } },
  })
  s.persist = (body) => {
    const key = String(body.idempotencyKey || '')
    if (s.idempotency.has(key)) return s.idempotency.get(key)
    s.persisted.push({ action: body.action, payload: body.payload, key })
    s.version += 1
    const result = { code: 200, data: s.view() }
    s.idempotency.set(key, result)
    return result
  }
  s.onRequest = (opts) => {
    if (opts.url.endsWith('/start')) { opts.success({ code: 200, data: s.view() }); return }
    if (opts.url.endsWith('/action')) {
      const body = JSON.parse(opts.data)
      s.posts.push(body)
      const plan = s.actionPlan.shift() || 'ok'
      if (plan === 'network-fail') { opts.fail({ errMsg: 'request:fail timeout' }); return }
      if (plan === 'persist-then-lose') { s.persist(body); opts.fail({ errMsg: 'request:fail socket close' }); return }
      if (plan === 'business-error') { opts.success({ code: 500, msg: '操作失败，请重试' }); return }
      opts.success(s.persist(body))
      return
    }
    if (opts.url.endsWith('/state')) {
      s.gets.push(opts.data)
      const plan = s.statePlan.shift() || 'ok'
      if (plan === 'network-fail') { opts.fail({ errMsg: 'request:fail' }); return }
      opts.success({ code: 200, data: s.view() })
      return
    }
    opts.success({ code: 200, data: {} })
  }
  return s
}

function makeAppStub() {
  const client = upload.createUploadClient({
    wxUploadFile(opts) { wxUploads.push(opts); return { abort() {} } },
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token',
  })
  return {
    globalData: { user_id: 9, features: {} },
    isDevEnv: () => false,
    sendRequest: (opts) => server.onRequest(opts),
    getAuthorization: () => 'token',
    getUploadClient: () => client,
    createPageBoundOperation: () => { lastOperation = makeOperation(); return lastOperation },
  }
}

global.Behavior = (config) => config
global.wx = {  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() {},
  hideLoading() {},
  showToast(opts) { toasts.push(String((opts && opts.title) || '')) },
  hideToast() {},
  showModal(opts) { if (opts && opts.success) opts.success({ confirm: false }) },
  vibrateShort() {},
  chooseMedia(opts) { mediaSuccess = opts && opts.success },
}
global.Page = (config) => { pageConfig = config }
// 两个真实组件都用 Component(...) 注册:按装载槽位分流,避免后加载的覆盖前一个。
global.Component = (config) => {
  if (componentSlot === 'qa') componentConfig = config
  else advancedConfig = config
}

beforeEach(() => {
  pageConfig = null
  componentConfig = null
  advancedConfig = null
  wxUploads = []
  toasts = []
  lastOperation = null
  mediaSuccess = null
  server = makeServer()
  global.getApp = makeAppStub
})

function instance(def) {
  const out = {
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(patch, cb) {
      Object.keys(patch || {}).forEach((key) => setByPath(out.data, key, patch[key]))
      if (cb) cb()
    },
    triggerEvent() {},
  }
  Object.entries(def.methods || {}).forEach(([name, fn]) => { out[name] = fn.bind(out) })
  return out
}

function loadChain() {
  delete require.cache[require.resolve(PLAY_PAGE)]
  require(PLAY_PAGE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch, cb) => {
    Object.keys(patch || {}).forEach((key) => setByPath(page.data, key, patch[key]))
    if (cb) cb()
  }
  page.data.playKit = { show: false, kit: null }

  componentSlot = 'advanced'
  delete require.cache[require.resolve(ADVANCED_GAME)]
  require(ADVANCED_GAME)
  const advanced = instance(advancedConfig)
  advanced.triggerEvent = (name, detail) => {
    if (name === 'session') page.onAdvancedSession({ detail })
  }
  page.selectComponent = (selector) => (selector === '#advancedGame' ? advanced : null)
  return { page, advanced }
}

function loadQaComponent() {
  componentSlot = 'qa'
  delete require.cache[require.resolve(QA_COMPONENT)]
  require(QA_COMPONENT)
  const comp = Object.assign({}, componentConfig.methods)
  comp.data = Object.assign({}, JSON.parse(JSON.stringify(componentConfig.data)), {
    mode: 'shot', ctaDisabled: false, reducedMotion: false,
  })
  comp.setData = (patch, cb) => {
    Object.keys(patch || {}).forEach((key) => setByPath(comp.data, key, patch[key]))
    if (cb) cb()
  }
  comp.selectComponent = () => null
  comp._events = []
  comp.triggerEvent = (name, detail) => { comp._events.push({ name, detail }) }
  return comp
}

function chooseAndShoot(comp, file) {
  comp._events = []
  comp.onCta()
  assert.ok(mediaSuccess, 'onCta 必须调 wx.chooseMedia')
  mediaSuccess({ tempFiles: [file] })
  const evt = comp._events.find((item) => item.name === 'shoot')
  assert.ok(evt, '必须抛出 shoot 事件')
  return evt.detail
}

function dispatchShoot(page, detail, type = 'qa') {
  page.onPlayKitAction({ detail: { type, action: 'shoot', detail } })
}

/** 拍照 → 上传(合成成功) → 由页面调用真实 advanced.action。 */
function shootAndUpload(page, comp, name, size = 1 * MIB) {
  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/' + name, name, size }))
  assert.equal(wxUploads.length >= 1, true)
  const control = wxUploads[wxUploads.length - 1]
  control.success({ data: JSON.stringify({ code: 200, url: 'https://cdn/' + name }) })
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('真实生命周期:start→emitSession→页面 kit 携带 sessionId/version,拍照链不被误关', async () => {
  const { page, advanced } = loadChain()
  advanced.start()
  await tick()

  const kit = page.data.playKit.kit
  assert.ok(kit, 'start 后必须产出 kit')
  assert.equal(kit.type, 'qa')
  assert.equal(kit.mode, 'shot')
  assert.equal(kit.sessionId, SESSION_ID, 'kit.sessionId 必须来自真实 start 视图')
  assert.equal(kit.version, 1, 'kit.version 必须来自真实 start 视图')
  assert.equal(advanced.data.state.sessionId, SESSION_ID)

  const comp = loadQaComponent()
  shootAndUpload(page, comp, 'life.jpg')
  await tick()
  assert.equal(server.posts.length, 1, '身份字段存在,拍照链必须能走到 SUBMIT_QA')
  assert.equal(server.posts[0].action, 'SUBMIT_QA')
  assert.equal(server.persisted.length, 1)
  assert.equal(server.persisted[0].payload.imageUrl, 'https://cdn/life.jpg', '提交的必须是刚拍的那张')
  assert.equal(advanced.data.unknown, false)
  assert.equal(advanced.data.error, '')
})

test('负控:生命周期视图缺 sessionId/version 时失败关闭并明确提示,不上传', async () => {
  const { page, advanced } = loadChain()
  advanced.start()
  await tick()
  const comp = loadQaComponent()

  // 构造生产契约不允许的状态(服务端 toView 必带 sessionId/version):必须失败关闭而不是上传到虚空
  page.data.playKit.kit = { type: 'qa', mode: 'shot', sessionId: undefined, version: undefined }
  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/x.jpg', name: 'x.jpg', size: 1 * MIB }))
  assert.equal(wxUploads.length, 0, '状态不完整不得上传')
  assert.equal(server.posts.length, 0)
  assert.ok(toasts.some((t) => /玩法状态不完整/.test(t)), '必须给人话提示,不静默')
})

test('SUBMIT_QA 未提交网络失败:不重复发、不假完成、基础路线可继续', async () => {
  const { page, advanced } = loadChain()
  advanced.start()
  await tick()
  const comp = loadQaComponent()

  server.actionPlan.push('network-fail')   // 服务端未写入
  server.statePlan.push('ok')              // 回读:版本未前进
  shootAndUpload(page, comp, 'a.jpg')
  await tick()

  assert.equal(server.posts.length, 1, '不得自动重发')
  assert.equal(server.persisted.length, 0, '不得算完成')
  assert.equal(advanced.data.unknown, false, '回读给出结论后应退出 unknown')
  assert.match(advanced.data.error, /没有提交成功/, '必须明说未提交,不装成功')
  assert.equal(advanced.data.state.version, 1)
  assert.equal(page.data.playKit.kit.version, 1, '题目会话保持一致')
  assert.equal(page.data.playKit.show, true, '基础路线不得丢')

  // 恢复后可继续:重拍一次并成功提交,只执行一次
  server.actionPlan.push('ok')
  server.statePlan.push('ok')
  shootAndUpload(page, comp, 'b.jpg')
  await tick()
  assert.equal(server.persisted.length, 1, '恢复后成功提交一次')
  assert.equal(server.persisted[0].payload.imageUrl, 'https://cdn/b.jpg', '恢复后提交的是重拍的那张')
  assert.equal(advanced.data.state.version, 2)
  assert.equal(advanced.data.error, '')
  assert.equal(advanced.data.unknown, false)
})

test('SUBMIT_QA 已提交但丢回包:回读判 landed,不重复算完成', async () => {
  const { page, advanced } = loadChain()
  advanced.start()
  await tick()
  const comp = loadQaComponent()

  server.actionPlan.push('persist-then-lose')  // 服务端已写入,回包丢失
  server.statePlan.push('ok')                  // 回读:版本已前进
  shootAndUpload(page, comp, 'c.jpg')
  await tick()

  assert.equal(server.posts.length, 1, '不得二次提交')
  assert.equal(server.persisted.length, 1, '服务端只执行一次')
  assert.equal(server.persisted[0].payload.imageUrl, 'https://cdn/c.jpg')
  assert.equal(advanced.data.unknown, false)
  assert.equal(advanced.data.error, '', 'landed 后不得再报失败')
  assert.equal(advanced.data.state.version, 2, '本地必须回读权威版本')
  assert.equal(page.data.playKit.kit.version, 2, '页面会话与权威一致')

  await tick()
  assert.equal(server.posts.length, 1, '恢复后不得补发重复动作')
})

test('unknown 回读失败后再次恢复(点再核对一次),期间不得提交', async () => {
  const { page, advanced } = loadChain()
  advanced.start()
  await tick()
  const comp = loadQaComponent()

  server.actionPlan.push('persist-then-lose')  // 已写入,回包丢失
  server.statePlan.push('network-fail')        // 第一次回读失败
  shootAndUpload(page, comp, 'd.jpg')
  await tick()

  assert.equal(advanced.data.unknown, true, '回读失败必须保持 unknown')
  assert.equal(advanced.data.readingBack, false)
  assert.match(advanced.data.unknownText, /再试/)
  assert.equal(advanced.data.state.version, 1, '未知态不得伪装完成')
  assert.equal(server.persisted.length, 1)
  assert.equal(server.persisted[0].payload.imageUrl, 'https://cdn/d.jpg')
  assert.equal(server.posts.length, 1)

  // unknown 未决期间再拍:页面不得再提交(否则重复执行)
  shootAndUpload(page, comp, 'd2.jpg')
  await tick()
  assert.equal(server.posts.length, 1, 'unknown 未决不得再发动作')
  assert.ok(toasts.some((t) => /确认中/.test(t)), '必须给可恢复提示')

  // 点「再核对一次」(真实 resolveUnknown)
  server.statePlan.push('ok')
  await advanced.resolveUnknown()
  assert.equal(advanced.data.unknown, false)
  assert.equal(advanced.data.error, '', 'landed 后清空')
  assert.equal(advanced.data.state.version, 2, '恢复后本地回到权威版本')
  assert.equal(page.data.playKit.kit.version, 2)
  assert.ok(page.data.playKit.show, '基础路线仍在')
})

test('unknown 回读失败后恢复为未提交:可重拍并只成功一次', async () => {
  const { page, advanced } = loadChain()
  advanced.start()
  await tick()
  const comp = loadQaComponent()

  server.actionPlan.push('network-fail')       // 未写入
  server.statePlan.push('network-fail', 'ok')  // 第一次回读失败,重试回读:未前进
  shootAndUpload(page, comp, 'e.jpg')
  await tick()
  assert.equal(advanced.data.unknown, true)

  await advanced.resolveUnknown()
  assert.equal(advanced.data.unknown, false)
  assert.match(advanced.data.error, /没有提交成功/)
  assert.equal(server.persisted.length, 0)

  server.actionPlan.push('ok')
  server.statePlan.push('ok')
  shootAndUpload(page, comp, 'e2.jpg')
  await tick()
  assert.equal(server.persisted.length, 1)
  assert.equal(server.persisted[0].payload.imageUrl, 'https://cdn/e2.jpg')
  assert.equal(advanced.data.state.version, 2)
  assert.equal(advanced.data.error, '')
})
