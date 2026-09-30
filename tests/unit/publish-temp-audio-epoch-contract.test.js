// R9-48/R9-49 小程序侧:预听 audioContext 的代际隔离(真实 Page 源码 + 真实回调)。
//
// 审查用真实 Page 负控 2/2 RED:
//   ① A 预听在途 → 上传 B → A onPlay(duration=111) 把 B 写成 111;
//   ② A 预听在途 → 模板库回填 C → A onPlay(duration=222) 把 C 写成 222。
// 根因:换文件/清空/模板回填都不销毁也不换代旧 audioContext,回调只闭包捕获旧 audio。
// 修复:换源时销毁实例并递增代际,回调仅在「实例 + 代际」仍匹配时才写状态;上传返回乱序也绑定本次选择。
//
// 本测试直接加载真实 Page 配置并手动触发 wx.createInnerAudioContext 回调 —— 不是正则匹配源码。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/publish/temp/index.js'

let pageConfig = null
let appStub = null
let audios = []

function makeAudio() {
  const handlers = {}
  const audio = {
    src: '', duration: 0, handlers,
    play() {}, pause() {}, stop() {}, destroy() {},
    onPlay(fn) { handlers.play = fn },
    onPause(fn) { handlers.pause = fn },
    onStop(fn) { handlers.stop = fn },
    onEnded(fn) { handlers.ended = fn },
    onError(fn) { handlers.error = fn },
  }
  audios.push(audio)
  return audio
}

function makeAppStub() {
  return {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest() {}, getAuthorization() { return 'Bearer test' },
    getUserID() { return 101 }, getUserInfo() { return null }, getToken() { return '' },
    chooseImage() {}, chooseDocument() {}, tips() {},
  }
}

function setAtPath(target, rawPath, value) {
  const parts = rawPath.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => setAtPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  page._refreshOutcomeContract = () => {}
  page.refreshPreviewState = () => {}
  page.initModuleState = () => {}
  page.updatePickerSelectionsFromTemplate = () => {}
  return page
}

beforeEach(() => {
  pageConfig = null
  appStub = makeAppStub()
  audios = []
  global.getApp = () => appStub
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync() {}, removeStorageSync() {},
    showToast() {}, navigateBack() {},
    getBackgroundAudioManager: () => ({ stop() {} }),
    createInnerAudioContext: makeAudio,
  }
  global.Page = (config) => { pageConfig = config }
})

test('预听正常:当前实例 onPlay 仍自动回填时长(正控)', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/A.mp3'
  page.data.formData.audioDuration = ''

  page.onPreviewAudio()
  audios[0].duration = 45
  audios[0].handlers.play()

  assert.equal(page.data.formData.audioDuration, 45)
  assert.equal(page.data.audioPreviewPlaying, true)
})

test('换新音频:旧预听回调不得写进新上传的 B', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/A.mp3'
  page.data.formData.audioDuration = ''
  page.onPreviewAudio()
  const old = audios[0]

  appStub.chooseDocument = (cb) => cb([{ url: 'https://cdn/B.mp3', filename: 'B.mp3', type: 'mp3' }])
  page.uploadAudio()

  old.duration = 111
  old.handlers.play()

  assert.equal(page.data.formData.audioUrl, 'https://cdn/B.mp3')
  assert.equal(page.data.formData.audioDuration, '', '旧 A 回调把 A 的时长写进了 B')
})

test('模板库回填:旧预听回调不得污染模板 C', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/A.mp3'
  page.data.formData.audioDuration = ''
  page.onPreviewAudio()
  const old = audios[0]

  page.fillFormWithTemplateData({ id: 9, title: 'C', audioUrl: 'https://cdn/C.mp3', audioDuration: null })

  old.duration = 222
  old.handlers.play()

  assert.equal(page.data.formData.audioUrl, 'https://cdn/C.mp3')
  assert.equal(page.data.formData.audioDuration, '', '旧 A 回调把 A 的时长写进了模板 C')
})

test('清空音频:旧预听回调不得把时长写回来', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/A.mp3'
  page.data.formData.audioDuration = ''
  page.onPreviewAudio()
  const old = audios[0]

  page.clearAudio()
  old.duration = 333
  old.handlers.play()

  assert.equal(page.data.formData.audioUrl, '')
  assert.equal(page.data.formData.audioDuration, '')
})

test('上传返回乱序:晚到的旧选择结果不得覆盖新选择', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/A.mp3'
  page.data.formData.audioDuration = ''

  const pending = []
  appStub.chooseDocument = (cb) => { pending.push(cb) }
  page.uploadAudio()   // 第 1 次选择
  page.uploadAudio()   // 第 2 次选择

  // 第二次先返回,第一次后返回
  pending[1]([{ url: 'https://cdn/C.mp3', filename: 'C.mp3', type: 'mp3' }])
  pending[0]([{ url: 'https://cdn/B.mp3', filename: 'B.mp3', type: 'mp3' }])

  assert.equal(page.data.formData.audioUrl, 'https://cdn/C.mp3', '晚到的旧上传结果不得覆盖新选择')
})

test('同地址再次选择并上传:旧实例回调失效,新状态不被旧时长污染', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/A.mp3'
  page.data.formData.audioDuration = ''
  page.onPreviewAudio()
  const first = audios[0]

  // 同一地址再次选择上传:仍应换代
  appStub.chooseDocument = (cb) => cb([{ url: 'https://cdn/A.mp3', filename: 'A.mp3', type: 'mp3' }])
  page.uploadAudio()

  first.duration = 444
  first.handlers.play()

  assert.equal(page.data.formData.audioUrl, 'https://cdn/A.mp3')
  assert.equal(page.data.formData.audioDuration, '', '同一地址重选后旧实例回调仍不得写状态')
})

test('上传失败/取消:chooseDocument 不回调页面时,旧音频与旧时长保持不动可重试', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/old.mp3'
  page.data.formData.audioDuration = 600

  appStub.chooseDocument = () => {}   // 失败/取消:chooseDocument 只弹提示,不回调页面
  page.uploadAudio()

  assert.equal(page.data.formData.audioUrl, 'https://cdn/old.mp3')
  assert.equal(page.data.formData.audioDuration, 600)
})
