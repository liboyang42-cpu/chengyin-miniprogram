// R9-49 小程序侧:语音讲解模块的音频生命周期。
//
// 审查复现:草稿 6031 由 600 秒替换为 1 秒后保存,DB 里 audioUrl='' 但 audioDuration 仍残留旧值。
// 服务端已按「带 audioUrl 时时长随之为权威」兜底;这里钉客户端的两条行为:
//   ① 换新音频必须把旧时长一起清掉(不继承),新时长由预听 onPlay 自动识别;
//   ② 清空音频/未启用语音模块时 audioUrl 与 audioDuration 一起清空。
// 另加一条连通性:服务端 R9-48 的可操作超限文案不能被客户端 safeUserMessage 又降级成兜底。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/publish/temp/index.js'
const { safeUserMessage } = require('../../utils/transport/safe-user-message.js')

let pageConfig = null
let appStub = null

function makeAppStub() {
  return {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: () => {},
    getAuthorization: () => 'Bearer test',
    getUserID: () => 101,
    getUserInfo: () => null,
    getToken: () => '',
    chooseImage: () => {},
    chooseDocument: () => {},
    tips: () => {},
  }
}

global.getApp = () => appStub
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: () => {},
  navigateBack: () => {},
  getBackgroundAudioManager: () => ({ stop: () => {} }),
  createInnerAudioContext: () => ({
    src: '', play() {}, pause() {}, stop() {}, destroy() {},
    onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {},
  }),
}
global.Page = (config) => { pageConfig = config }

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
  return page
}

beforeEach(() => { pageConfig = null; appStub = makeAppStub() })

test('换新音频:写入新地址的同时清掉旧时长,不继承', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/old.mp3'
  page.data.formData.audioDuration = 600
  appStub.chooseDocument = (callback) => callback([
    { url: 'https://cdn/new.mp3', filename: 'new.mp3', type: 'mp3' },
  ])

  page.uploadAudio()

  assert.equal(page.data.formData.audioUrl, 'https://cdn/new.mp3')
  assert.equal(page.data.formData.audioDuration, '', '换新音频不得继承上一段的时长')
  assert.equal(page.data.formData.audioFileName, 'new.mp3')
})

test('清空音频:地址与时长一起清空', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/old.mp3'
  page.data.formData.audioDuration = 600

  page.clearAudio()

  assert.equal(page.data.formData.audioUrl, '')
  assert.equal(page.data.formData.audioDuration, '')
})

test('未启用语音模块:提交前 audioUrl 与 audioDuration 一起清空', () => {
  const page = loadPage()
  page.data.formData.audioUrl = 'https://cdn/old.mp3'
  page.data.formData.audioDuration = 600
  page.hasModule = () => false

  const formData = page.prepareFormData()

  assert.equal(formData.audioUrl, '')
  assert.equal(formData.audioDuration, '')
})

test('R9-48 服务端可操作超限文案在客户端不会被降级成兜底', () => {
  const message = '文件过大，请压缩或更换文件后上传（单个文件最大10MB，单次请求最大20MB）'
  assert.equal(safeUserMessage({ code: 400, msg: message }, '上传失败'), message)
})
