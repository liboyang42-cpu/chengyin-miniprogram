// 商家 AI 分身直接录音合同：授权 → 录音 → 试听 → 共享上传 → 发起音色复刻。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const upload = require('../../utils/transport/upload-client.js')

const PAGE = path.join(__dirname, '../../pages/merchant/decor/ai-npc/index.js')
const SOURCE = fs.readFileSync(PAGE, 'utf8')
const WXML = fs.readFileSync(path.join(__dirname, '../../pages/merchant/decor/ai-npc/index.wxml'), 'utf8')
const WXSS = fs.readFileSync(path.join(__dirname, '../../pages/merchant/decor/ai-npc/index.wxss'), 'utf8')

function setAtPath(target, rawPath, value) {
  const parts = rawPath.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function loadPage(options = {}) {
  const state = { page: null, recorderStarts: [], recorderPauses: 0, recorderResumes: 0, recorderStops: 0, recorderOffs: 0, wxUploads: 0, requests: [] }
  const audio = {
    stop() {}, play() {}, destroy() {}, onEnded() {}, onStop() {}, onError() {},
  }
  const recorder = {
    onStop(fn) { state.onRecorderStop = fn },
    onError(fn) { state.onRecorderError = fn },
    offStop() { state.recorderOffs += 1 },
    offError() { state.recorderOffs += 1 },
    start(opts) { state.recorderStarts.push(opts) },
    pause() { state.recorderPauses += 1 },
    resume() { state.recorderResumes += 1 },
    stop() { state.recorderStops += 1 },
  }
  const client = upload.createUploadClient({
    wxUploadFile(opts) {
      state.wxUploads += 1
      if (options.onWxUpload) options.onWxUpload(opts)
      return { abort() {} }
    },
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token',
    setTimer: () => 1,
    clearTimer: () => {},
  })
  const app = { globalData: {}, getUploadClient: () => client, sendRequest() {} }
  const wx = {
    authorize: () => options.authorizePromise || (options.authorizeError ? Promise.reject(options.authorizeError) : Promise.resolve()),
    getRecorderManager: () => recorder,
    createInnerAudioContext: () => audio,
    getSystemInfoSync: () => ({}),
  }
  const localRequire = (id) => {
    if (id.endsWith('toast.js')) return function () {}
    if (id.endsWith('merchant-theme.js')) return { merchantPageShow() {}, merchantPageRestore() {} }
    if (id.endsWith('pixel-avatar.js')) return {
      AVATAR_IDS: ['one'], isPixelAvatar() { return false }, parseCode() { return 'one' }, stringifyCode() { return 'px1:one' },
    }
    if (id.endsWith('pixel-avatar-data.js')) return { AVATARS: { one: { name: 'one' } } }
    if (id.endsWith('pixel-portrait.js')) return {}
    if (id.endsWith('transport/upload-client.js')) return upload
    throw new Error('unexpected require ' + id)
  }
  vm.runInNewContext(SOURCE, {
    getApp: () => app, Page(def) { state.page = def }, wx, require: localRequire, console,
    setTimeout, clearTimeout, setInterval, clearInterval, Promise, Object, Error, JSON, Math, Number, String, Array,
  }, { filename: PAGE })
  const page = Object.assign({}, state.page, { data: JSON.parse(JSON.stringify(state.page.data)) })
  page.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach((key) => setAtPath(this.data, key, patch[key]))
    if (cb) cb()
  }
  page._request = (url, payload) => {
    state.requests.push({ url, payload })
    return Promise.resolve({ data: { voiceStatus: 2 } })
  }
  state.page = page
  return state
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('录音面板是三句逐句录制的 Voice mode', () => {
  assert.match(WXML, /Voice mode/)
  assert.match(SOURCE, /你好，欢迎来到我的小店/)
  assert.match(SOURCE, /你可以告诉我想找什么商品/)
  assert.match(SOURCE, /如果还有价格、服务或者到店方面的问题/)
  assert.match(WXML, /bindtouchstart="onVoiceHoldStart"/)
  assert.match(WXML, /bindtouchend="onVoiceHoldEnd"/)
  assert.match(WXML, /npc-voice-progress/)
  assert.match(WXML, /npc-wave/)
  assert.match(WXSS, /\.npc-voice-hold/)
  assert.match(WXSS, /\.npc-voice-hold::after\s*\{\s*border:\s*0/)
  assert.doesNotMatch(WXML, /npc-recorder__status/)
  assert.doesNotMatch(WXML, /npc-voice-script/)
})

test('未确认声音权利时不能启动录音', async () => {
  const h = loadPage()

  h.page.onVoiceHoldStart()
  await tick()

  assert.equal(h.recorderStarts.length, 0)
  assert.match(h.page.data.voiceError, /本人|授权/)
})

test('按住开始第一句，松开暂停并等待确认', async () => {
  const h = loadPage()
  h.page.onVoiceConsentChange({ detail: { checked: true } })

  h.page.onVoiceHoldStart()
  await tick()

  assert.equal(h.recorderStarts.length, 1)
  assert.equal(h.recorderStarts[0].format, 'mp3')
  assert.equal(h.recorderStarts[0].duration, 60000)
  assert.equal(h.page.data.voiceHolding, true)

  h.page.onVoiceHoldEnd()
  assert.equal(h.recorderPauses, 1)
  assert.equal(h.recorderStops, 0)
  assert.equal(h.page.data.voiceSentenceReady, true)
})

test('三句确认间复用同一录音会话，最后才保存', async () => {
  const h = loadPage()
  h.page.onVoiceConsentChange({ detail: { checked: true } })

  h.page.onVoiceHoldStart()
  await tick()
  h.page.onVoiceHoldEnd()
  h.page.confirmVoiceSentence()
  assert.equal(h.page.data.voiceSentenceIndex, 1)

  h.page.onVoiceHoldStart()
  h.page.onVoiceHoldEnd()
  h.page.confirmVoiceSentence()
  h.page.onVoiceHoldStart()
  h.page.onVoiceHoldEnd()
  h.page.confirmVoiceSentence()

  assert.equal(h.recorderStarts.length, 1)
  assert.equal(h.recorderResumes, 2)
  assert.equal(h.recorderPauses, 3)
  assert.equal(h.recorderStops, 1)
})

test('录音被系统提前结束时不能绕过三句确认', async () => {
  const h = loadPage()
  h.page.onVoiceConsentChange({ detail: { checked: true } })
  h.page.onVoiceHoldStart()
  await tick()

  h.onRecorderStop({ tempFilePath: '/tmp/incomplete.mp3', duration: 20000, fileSize: 1024 })

  assert.equal(h.page.data.voiceFile, null)
  assert.equal(h.page.data.voiceSentenceConfirmed, 0)
  assert.match(h.page.data.voiceError, /三句|重新录制/)
})

test('录音不足 10 秒时明确拒绝', async () => {
  const h = loadPage()
  h.page.onVoiceConsentChange({ detail: { checked: true } })
  h.page.onVoiceHoldStart()
  await tick()
  h.page.data.voiceSentenceConfirmed = 3

  h.onRecorderStop({ tempFilePath: '/tmp/short.mp3', duration: 9000, fileSize: 1000 })

  assert.equal(h.page.data.voiceFile, null)
  assert.match(h.page.data.voiceError, /10 秒/)
})

test('合法录音上传一次并携带声音授权发起复刻', async () => {
  const h = loadPage({
    onWxUpload(opts) { opts.success({ data: JSON.stringify({ code: 200, url: 'https://cdn/voice.mp3' }) }) },
  })
  h.page.onVoiceConsentChange({ detail: { checked: true } })
  h.page.onVoiceHoldStart()
  await tick()
  h.page.data.voiceSentenceConfirmed = 3
  h.onRecorderStop({ tempFilePath: '/tmp/voice.mp3', duration: 20000, fileSize: 1024 * 1024 })

  assert.equal(h.page.data.voiceFile.duration, 20)
  h.page.uploadVoice()
  await tick()

  assert.equal(h.wxUploads, 1)
  assert.equal(h.requests[0].url, '/api/merchant/npc/voice/enroll')
  assert.equal(h.requests[0].payload.voiceSample, 'https://cdn/voice.mp3')
  assert.equal(h.requests[0].payload.voiceConsent, true)
})

test('录完后撤回声音授权不能提交', async () => {
  const h = loadPage()
  h.page.onVoiceConsentChange({ detail: { checked: true } })
  h.page.onVoiceHoldStart()
  await tick()
  h.page.data.voiceSentenceConfirmed = 3
  h.onRecorderStop({ tempFilePath: '/tmp/voice.mp3', duration: 20000, fileSize: 1024 })
  h.page.onVoiceConsentChange({ detail: { checked: false } })

  h.page.uploadVoice()

  assert.equal(h.wxUploads, 0)
  assert.equal(h.requests.length, 0)
  assert.match(h.page.data.voiceError, /本人|授权/)
})

test('页面卸载时解绑全局录音监听', async () => {
  const h = loadPage()
  h.page.onVoiceConsentChange({ detail: { checked: true } })
  h.page.onVoiceHoldStart()
  await tick()

  h.page.onUnload()

  assert.equal(h.recorderOffs, 2)
})

test('录音权限被拒绝时不假装开始', async () => {
  const h = loadPage({ authorizeError: new Error('deny') })
  h.page.onVoiceConsentChange({ detail: { checked: true } })

  h.page.onVoiceHoldStart()
  await tick()

  assert.equal(h.recorderStarts.length, 0)
  assert.equal(h.page.data.voiceHolding, false)
  assert.match(h.page.data.voiceError, /录音权限/)
})

test('等待录音授权时切后台不会晚到启动麦克风', async () => {
  let grant
  const h = loadPage({ authorizePromise: new Promise((resolve) => { grant = resolve }) })
  h.page.onVoiceConsentChange({ detail: { checked: true } })

  h.page.onVoiceHoldStart()
  h.page.onHide()
  grant()
  await tick()

  assert.equal(h.recorderStarts.length, 0)
  assert.equal(h.page.data.voiceHolding, false)
})

test('后续句录音出错时完整回到第一句', async () => {
  const h = loadPage()
  h.page.onVoiceConsentChange({ detail: { checked: true } })
  h.page.onVoiceHoldStart()
  await tick()
  h.page.onVoiceHoldEnd()
  h.page.confirmVoiceSentence()
  h.page.onVoiceHoldStart()

  h.onRecorderError(new Error('record failed'))

  assert.equal(h.page.data.voiceSentenceIndex, 0)
  assert.equal(h.page.data.voiceSentenceConfirmed, 0)
  assert.equal(h.page.data.voiceSentenceText, h.page.data.voiceSentences[0])
  assert.equal(h.page.data.voiceSessionActive, false)
})

test('录音回调拒绝缺失、空、负数与非有限文件大小', () => {
  for (const fileSize of [undefined, 0, -1, NaN, Infinity]) {
    const h = loadPage()
    h.page.voiceRecorder()
    h.page.data.voiceSentenceConfirmed = 3
    h.onRecorderStop({ tempFilePath: '/tmp/voice.mp3', duration: 12000, fileSize })
    assert.equal(h.page.data.voiceFile, null)
    assert.ok(h.page.data.voiceError)
  }
})
