// 游玩照片问答完整链:playkit-qa 选择/拍照 → shoot 事件 → pages/play 上传 → SUBMIT_QA 提交 → 失败恢复。
//
// 直接执行真实 Component + 真实 Page 源码 + 真实共享 upload-client(不 mock 预检、不复制解析)。
// 除既有「死分支 / 已知 size 预检」外,本文件钉住独立审查复现的异步回包隔离:
//   ① 上传在途时同一页面切到另一 session/题目版本,旧回包不得提交到新题;
//   ② shoot 必须限定 qa kit,scan 等伪造 shoot 不得上传;
//   ③ 双击不得起第二个必被 advanced-game acting 静默丢掉的请求;
//   ④ advanced-game acting/unknown 时不得装成功。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PLAY_PAGE = '../../pages/play/index.js'
const QA_COMPONENT = '../../pages/play/components/playkit-qa/index.js'
const upload = require('../../utils/transport/upload-client.js')

const MIB = 1024 * 1024

let pageConfig
let componentConfig
let wxUploads
let toasts
let gameActions
let lastOperation
let mediaSuccess

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

function makeAppStub() {
  const client = upload.createUploadClient({
    wxUploadFile(opts) {
      wxUploads.push(opts)
      return { abort() {} }
    },
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token',
  })
  return {
    globalData: { user_id: 9, features: {} },
    isDevEnv: () => false,
    sendRequest: () => {},
    getAuthorization: () => 'token',
    getUploadClient: () => client,
    createPageBoundOperation: () => { lastOperation = makeOperation(); return lastOperation },
  }
}

global.Behavior = (config) => config
global.wx = {
  getStorageSync: () => '',
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
global.Component = (config) => { componentConfig = config }

beforeEach(() => {
  pageConfig = null
  componentConfig = null
  wxUploads = []
  toasts = []
  gameActions = []
  lastOperation = null
  mediaSuccess = null
  global.getApp = makeAppStub
})

function loadPage() {
  delete require.cache[require.resolve(PLAY_PAGE)]
  require(PLAY_PAGE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch, cb) => {
    Object.keys(patch || {}).forEach((key) => setByPath(page.data, key, patch[key]))
    if (cb) cb()
  }
  const game = {
    data: { state: { sessionId: 'session-A', version: 4 }, acting: false, unknown: false },
    action(name, payload) {
      gameActions.push({
        name, payload,
        sessionId: this.data.state && this.data.state.sessionId,
        version: this.data.state && this.data.state.version,
      })
    },
  }
  page.selectComponent = (selector) => (selector === '#advancedGame' ? game : null)
  page.data.playKit = { show: true, kit: { type: 'qa', mode: 'shot', sessionId: 'session-A', version: 4 } }
  return { page, game }
}

function loadComponent() {
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

/** 真实组件的拍照入口:选一张(可带/不带 size)并取出它抛出的 shoot detail。 */
function chooseAndShoot(comp, file) {
  comp._events = []
  comp.onCta()
  assert.ok(mediaSuccess, 'onCta 必须调 wx.chooseMedia')
  mediaSuccess({ tempFiles: [file] })
  const evt = comp._events.find((item) => item.name === 'shoot')
  assert.ok(evt, '必须抛出 shoot 事件')
  return evt.detail
}

/** 复刻 wrapper(pages/play/components/playkit/index.js:73)的转发:kitaction{type,action,detail}。 */
function dispatchShoot(page, detail, type = 'qa') {
  page.onPlayKitAction({ detail: { type, action: 'shoot', detail } })
}

const okBody = (url) => ({ data: JSON.stringify({ code: 200, url }) })

test('合法 5MiB:真实链上传一次并提交 SUBMIT_QA', () => {
  const { page, game } = loadPage()
  const comp = loadComponent()

  const detail = chooseAndShoot(comp, { tempFilePath: '/tmp/q.jpg', name: 'q.jpg', size: 5 * MIB })
  assert.equal(detail.tempFilePath, '/tmp/q.jpg')
  assert.equal(detail.size, 5 * MIB, '组件必须把真实 size 交出来')
  assert.equal(comp.data.ctaDisabled, false, 'shoot 后题目仍可换图重试')

  dispatchShoot(page, detail)
  assert.equal(wxUploads.length, 1, '合法照片必须发起上传')
  assert.equal(wxUploads[0].filePath, '/tmp/q.jpg')

  wxUploads[0].success(okBody('https://cdn/q.jpg'))
  assert.deepEqual(gameActions, [{
    name: 'SUBMIT_QA', payload: { imageUrl: 'https://cdn/q.jpg' },
    sessionId: 'session-A', version: 4,
  }])
  assert.equal(game.data.state.sessionId, 'session-A')
})

test('已知 15MiB:共享预检拒绝,不发网络,可操作文案,绝不提交', () => {
  const { page } = loadPage()
  const comp = loadComponent()

  const detail = chooseAndShoot(comp, { tempFilePath: '/tmp/big.jpg', name: 'big.jpg', size: 15 * MIB })
  dispatchShoot(page, detail)

  assert.equal(wxUploads.length, 0, '已知超限不得发起 wxUploadFile')
  assert.equal(gameActions.length, 0, '超限失败不得提交答案/假完成')
  assert.ok(toasts.some((t) => /文件过大/.test(t) && /压缩|更换/.test(t) && /10MB/.test(t)),
    '必须有可操作超限文案,实际:' + JSON.stringify(toasts))

  // 题目未变化,换一张合法图即可重试成功
  const retry = chooseAndShoot(comp, { tempFilePath: '/tmp/ok.jpg', name: 'ok.jpg', size: 5 * MIB })
  dispatchShoot(page, retry)
  assert.equal(wxUploads.length, 1)
  wxUploads[0].success(okBody('https://cdn/ok.jpg'))
  assert.equal(gameActions.length, 1)
})

test('上传在途切到 B 会话:旧回包不得提交到新题,可重新拍', () => {
  const { page, game } = loadPage()
  const comp = loadComponent()

  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/a.jpg', name: 'a.jpg', size: 1 * MIB }))
  assert.equal(wxUploads.length, 1)

  // 同一页面仍活着,权威会话/题目切到 B(session-B v1)
  game.data.state = { sessionId: 'session-B', version: 1 }
  page.data.playKit = { show: true, kit: { type: 'qa', mode: 'shot', sessionId: 'session-B', version: 1 } }
  wxUploads[0].success(okBody('https://cdn/a.jpg'))

  assert.equal(gameActions.length, 0, 'A 的照片绝不提交到 B 会话')
  assert.ok(toasts.some((t) => /题目已变化/.test(t)), '掉弃必须说明,不静默')

  // 锁已释放:新题可以重新拍并正确提交到 B
  const retry = chooseAndShoot(comp, { tempFilePath: '/tmp/b.jpg', name: 'b.jpg', size: 1 * MIB })
  dispatchShoot(page, retry)
  assert.equal(wxUploads.length, 2)
  wxUploads[1].success(okBody('https://cdn/b.jpg'))
  assert.deepEqual(gameActions, [{
    name: 'SUBMIT_QA', payload: { imageUrl: 'https://cdn/b.jpg' },
    sessionId: 'session-B', version: 1,
  }])
})

test('同会话版本前进:旧回包同样不得提交', () => {
  const { page, game } = loadPage()
  const comp = loadComponent()

  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/a.jpg', name: 'a.jpg', size: 1 * MIB }))
  game.data.state = { sessionId: 'session-A', version: 5 }
  page.data.playKit.kit.version = 5
  wxUploads[0].success(okBody('https://cdn/a.jpg'))

  assert.equal(gameActions.length, 0, '题目版本已前进,旧照片不得提交')
  assert.ok(toasts.some((t) => /题目已变化/.test(t)))
})

test('非 qa kit 的 shoot 不得上传/提交', () => {
  const { page } = loadPage()
  page.data.playKit = { show: true, kit: { type: 'scan' } }

  page.onPlayKitAction({ detail: { type: 'scan', action: 'shoot', detail: { tempFilePath: '/tmp/x.jpg', size: 1 * MIB } } })

  assert.equal(wxUploads.length, 0, 'scan 的异常 shoot 必须被类型门禁挡住')
  assert.equal(gameActions.length, 0)
})

test('双击:上传在途时只起一次请求,不静默丢第二张', () => {
  const { page } = loadPage()
  const comp = loadComponent()

  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/one.jpg', name: 'one.jpg', size: 1 * MIB }))
  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/two.jpg', name: 'two.jpg', size: 1 * MIB }))

  assert.equal(wxUploads.length, 1, '上传在途必须忽略第二次 shoot')
  wxUploads[0].success(okBody('https://cdn/one.jpg'))
  assert.equal(gameActions.length, 1)
  assert.equal(gameActions[0].payload.imageUrl, 'https://cdn/one.jpg')
})

test('advanced-game acting/unknown 时不装成功,给可恢复提示', () => {
  const { page, game } = loadPage()
  const comp = loadComponent()

  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/a.jpg', name: 'a.jpg', size: 1 * MIB }))
  game.data.acting = true
  wxUploads[0].success(okBody('https://cdn/a.jpg'))
  assert.equal(gameActions.length, 0, 'acting 时不得提交(否则被静默 no-op)')
  assert.ok(toasts.some((t) => /确认中/.test(t)))

  // unknown 同理
  toasts.length = 0
  game.data.acting = false
  game.data.unknown = true
  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/b.jpg', name: 'b.jpg', size: 1 * MIB }))
  wxUploads[1].success(okBody('https://cdn/b.jpg'))
  assert.equal(gameActions.length, 0)
  assert.ok(toasts.some((t) => /确认中/.test(t)))
})

test('未知 size(旧组件):照常上传;失败不提交,换图可重试', () => {
  const { page } = loadPage()
  const comp = loadComponent()

  const legacy = chooseAndShoot(comp, { tempFilePath: '/tmp/u.jpg', name: 'u.jpg' })
  assert.equal(legacy.size, undefined, '拿不到 size 不得伪造')
  dispatchShoot(page, legacy)
  assert.equal(wxUploads.length, 1, '未知 size 由服务端拦截,不在此处假装已修')

  wxUploads[0].fail({ errMsg: 'uploadFile:fail socket closed' })
  assert.equal(gameActions.length, 0, '上传失败不得提交答案')

  const retry = chooseAndShoot(comp, { tempFilePath: '/tmp/ok2.jpg', name: 'ok2.jpg', size: 2 * MIB })
  dispatchShoot(page, retry)
  assert.equal(wxUploads.length, 2, '换图必须能重试')
  wxUploads[1].success(okBody('https://cdn/ok2.jpg'))
  assert.deepEqual(gameActions, [{
    name: 'SUBMIT_QA', payload: { imageUrl: 'https://cdn/ok2.jpg' },
    sessionId: 'session-A', version: 4,
  }])
})

test('上传中离页 abort:迟到的成功不得提交', () => {
  const { page } = loadPage()
  const comp = loadComponent()

  dispatchShoot(page, chooseAndShoot(comp, { tempFilePath: '/tmp/q.jpg', name: 'q.jpg', size: 1 * MIB }))
  assert.equal(wxUploads.length, 1)
  lastOperation.abort()
  wxUploads[0].success(okBody('https://cdn/late.jpg'))

  assert.equal(gameActions.length, 0, '页面已离开,迟到回调不得提交')
})
