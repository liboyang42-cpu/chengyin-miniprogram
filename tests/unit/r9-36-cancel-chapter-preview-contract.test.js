// R9-36(P2):取消章节编辑后旁白预听仍在播。
//
// 审查复现(第九轮 R9-36):实际点击预听后再点章节弹层取消,popChapter 由 true 变 false,
// 但 audioPreviewPlaying 仍 true、原生 paused 仍 false,currentTime 继续走;
// 关闭控件后没有可见暂停入口。源码 cancelChapter 只关弹层,未停止 destroyPreviewAudio。
//
// 契约:章节弹层的每条退出路径——取消、完成、删除章节——都必须停掉旁白预听并复位状态;
// 离开页面(onUnload)已有的停播不能回退。再做一次「再开弹层状态正确」的正向确认。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/publish/fabu/index.js'

let pageConfig
let toasts
let createdAudios
let modalAnswer

function makeAudio() {
  const audio = {
    src: '', played: 0, paused: 0, stopped: 0, destroyed: 0,
    handlers: {},
    play() { this.played += 1 },
    pause() { this.paused += 1 },
    stop() { this.stopped += 1 },
    destroy() { this.destroyed += 1 },
    onPlay(fn) { this.handlers.play = fn },
    onPause(fn) { this.handlers.pause = fn },
    onStop(fn) { this.handlers.stop = fn },
    onEnded(fn) { this.handlers.ended = fn },
    onError(fn) { this.handlers.error = fn },
    onCanplay(fn) { this.handlers.canplay = fn },
  }
  createdAudios.push(audio)
  return audio
}

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 42,
  sendRequest: () => {},
  chooseImage: () => {},
  chooseDocument: () => {},
  tips: () => {},
  getRequestErrorMessage: (err, fallback) => (err && err.errMsg) || fallback,
})

global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  showToast: (options) => { toasts.push(options && options.title) },
  hideLoading: () => {},
  showLoading: () => {},
  createInnerAudioContext: makeAudio,
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }),
  pageScrollTo: () => {},
  nextTick: (cb) => cb(),
  showModal: (options) => { options && options.success && options.success({ confirm: modalAnswer }) },
}

global.Page = (config) => { pageConfig = config }

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
    Object.keys(patch).forEach((key) => setAtPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  page.data.formData = Object.assign({}, page.data.formData, {
    productType: 2,
    chapters: [{
      _localId: 'ch1', name: '第1章', nodes: [], blocks: [],
      audioUrl: 'https://cdn/chapter.mp3', audioDuration: 600,
    }],
  })
  page.data.chapterForm = {
    _localId: 'ch1', name: '第1章', nodes: [], blocks: [],
    audioUrl: 'https://cdn/chapter.mp3', audioDuration: 600, audioFileName: 'chapter.mp3',
    recruitEnabled: 0, required: 1,
  }
  page.data.popChapterAction = 1
  page.data.popChapterIndex = 0
  return page
}

function startPreview(page) {
  page.onPreviewChapterAudio()
  const audio = createdAudios[createdAudios.length - 1]
  audio.handlers.play()
  assert.equal(page.data.audioPreviewPlaying, true)
  return audio
}

beforeEach(() => {
  toasts = []
  createdAudios = []
  pageConfig = null
  modalAnswer = true
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

test('RED 锚点:取消章节编辑必须停掉旁白预听并复位播放状态', () => {
  const page = makePage()
  const audio = startPreview(page)

  page.cancelChapter({})

  assert.equal(audio.destroyed, 1, '取消后不得留一段在后台继续响')
  assert.equal(page.data.audioPreviewPlaying, false)
  assert.equal(page.data.popChapter, false)
})

test('完成章节编辑(确认)同样停掉预听,新增与编辑两条分支都要收口', () => {
  const edit = makePage()
  const editingAudio = startPreview(edit)
  edit.confrimChapter({})
  assert.equal(editingAudio.destroyed, 1, '编辑完成也必须停')

  const add = makePage()
  add.data.popChapterAction = 0
  add.data.chapterForm.name = '第2章'
  const addingAudio = startPreview(add)
  add.confrimChapter({})
  assert.equal(addingAudio.destroyed, 1, '新增完成也必须停')
})

test('删除章节(弹层内第三出口)也停预听,不留孤儿播放器', () => {
  const page = makePage()
  const audio = startPreview(page)

  page.deleteChapter({})

  assert.equal(audio.destroyed, 1)
  assert.equal(page.data.audioPreviewPlaying, false)
})

test('离开页面仍停预听;再开弹层时播放状态是干净的', () => {
  const leaving = makePage()
  const leavingAudio = startPreview(leaving)
  leaving.onUnload()
  assert.equal(leavingAudio.destroyed, 1)

  const again = makePage()
  const first = startPreview(again)
  again.cancelChapter({})
  assert.equal(first.destroyed, 1)
  assert.equal(again.data.audioPreviewPlaying, false)
  assert.equal(again._previewAudio, null, '取消后不得保留旧播放器引用')
})
