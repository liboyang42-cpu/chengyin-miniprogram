// CR-308 / 产品拍板 2026-09-15 第 27 问:主题级 BGM 残留代码清理。
//
// 主题级(路线)音频在 fabu 里从来没有任何 WXML 入口:只有 applyEditingTopic / applyAiDraft
// 回填、apiData 原样上送三条残留读写(即「编辑一次就原样带回,免得清掉别处配的」)。
// 用户裁决「删掉残留」—— 只停小程序读写,后端 cms_topic.audio_url 字段保留不删(存量数据兼容)。
// 章节音频(chapterForm.audioUrl,一章一段旁白)是另一条链路,必须原样保留、不得被顺手删掉。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const SOURCE = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.js'), 'utf8')
// 判据只看代码:行首注释里保留的历史说明(「原来写的是主题级 …」)不算读写残留。
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, '')
const WXML = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.wxml'), 'utf8')

const PAGE = '../../pages/publish/fabu/index.js'
let pageConfig
let chosenDocuments

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 42,
  sendRequest: () => {},
  chooseImage: () => {},
  chooseDocument: (cb) => { if (chosenDocuments) cb(chosenDocuments) },
  tips: () => {},
  getRequestErrorMessage: (err, fallback) => (err && err.errMsg) || fallback,
})

const createdAudios = []
function makeAudio() {
  const audio = {
    src: '', destroyed: 0, handlers: {},
    play() {}, pause() {}, stop() {},
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

global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  showToast: () => {},
  hideLoading: () => {},
  showLoading: () => {},
  createInnerAudioContext: makeAudio,
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }),
  pageScrollTo: () => {},
  nextTick: (cb) => cb(),
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
  return page
}

require(PAGE)

test('RED 锚点:主题级 BGM 的读写必须清零(formData.audioUrl / audioDuration 不再出现)', () => {
  assert.doesNotMatch(CODE, /formData\.audioUrl/, '主题级读取/上送残留还在')
  assert.doesNotMatch(CODE, /formData\.audioDuration/, '主题级时长残留还在')
  assert.doesNotMatch(CODE, /topic\.audioUrl|sourceData\.audioUrl/, '回填路径仍在读主题级音频')
})

test('formData 初始态不再声明主题级 audioUrl / audioDuration 字段', () => {
  const page = makePage()
  assert.ok(!('audioUrl' in page.data.formData), 'formData 不该再有主题级 audioUrl')
  assert.ok(!('audioDuration' in page.data.formData), 'formData 不该再有主题级 audioDuration')
})

test('章节音频链路保留:WXML 三个入口 + JS 方法齐备', () => {
  assert.match(WXML, /bindtap="uploadChapterAudio"/, '章节音频上传入口丢了')
  assert.match(WXML, /bindtap="onPreviewChapterAudio"/, '章节音频预听入口丢了')
  assert.match(WXML, /bindtap="clearChapterAudio"/, '章节音频清空入口丢了')
  assert.match(WXML, /chapterForm\.audioUrl/, '章节音频渲染丢了')
  for (const method of ['uploadChapterAudio', 'autoDetectAudioDuration', 'clearChapterAudio', 'onPreviewChapterAudio']) {
    assert.equal(typeof pageConfig[method], 'function', `章节音频方法 ${method} 丢了`)
  }
})

test('章节音频行为不受清理影响:上传写 chapterForm,清空只清 chapterForm', () => {
  const page = makePage()
  chosenDocuments = [{ url: 'https://cdn/chapter.mp3', filename: 'chapter.mp3' }]
  try {
    page.uploadChapterAudio()
  } finally {
    chosenDocuments = null
  }
  assert.equal(page.data.chapterForm.audioUrl, 'https://cdn/chapter.mp3')
  assert.equal(page.data.chapterForm.audioFileName, 'chapter.mp3')
  assert.ok(!('audioUrl' in page.data.formData), '上传章节音频不得回写主题级字段')

  page.clearChapterAudio()
  assert.equal(page.data.chapterForm.audioUrl, '')
  assert.equal(page.data.chapterForm.audioDuration, 0)
  assert.equal(page.data.chapterForm.audioFileName, '')
})
