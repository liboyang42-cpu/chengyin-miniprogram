// F14:故事流音频块有播放键却没有动作。
//
// 旧码 pages/publish/fabu/index.wxml 的已上传音频块只有一个 <cy-icon name="play-filled">,
// 没有 tap 绑定;父层只有长按选中。点击播放图标不会有任何播放调用 —— UI61 显示 ▶,
// UI62 点了没反馈。章节旁白的 onPreviewChapterAudio 是另一条路,不能抵消这个缺口。
//
// 契约(复用现有音频管理,不建第二套):故事流音频块与章节旁白共用同一个 InnerAudioContext
// (_previewAudio),所以两者天然互斥;播放/暂停切换、失败 toast、换块/关编辑器/删块都要停。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE = '../../pages/publish/fabu/index.js'
const ROOT = path.join(__dirname, '../..')
const WXML = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.wxml'), 'utf8')

let pageConfig
let toasts
let createdAudios

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
  page.data.storyEditor = { show: true, chapterIndex: 0, insertMenuAt: -1, focusBlockKey: '', selectedBlockKey: '' }
  page.data.formData = Object.assign({}, page.data.formData, {
    chapters: [{
      name: '第1章',
      blocks: [
        { key: 'a1', type: 'audio', url: 'https://cdn/a1.mp3', _name: 'a1.mp3' },
        { key: 'a2', type: 'audio', url: 'https://cdn/a2.mp3', _name: 'a2.mp3' },
      ],
    }],
  })
  return page
}

function tap(page, blockKey) {
  return page.onPreviewStoryAudio({ currentTarget: { dataset: { blockkey: blockKey } } })
}

beforeEach(() => {
  toasts = []
  createdAudios = []
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

test('RED 锚点:故事流音频块必须绑定播放处理,而不是一个点了没反应的图标', () => {
  assert.match(WXML, /catchtap="onPreviewStoryAudio"/, '音频块没有绑定播放处理')
})

test('点播放键真的创建播放器并起播,状态回写为这一块', () => {
  const page = makePage()
  tap(page, 'a1')

  assert.equal(createdAudios.length, 1)
  const audio = createdAudios[0]
  assert.equal(audio.src, 'https://cdn/a1.mp3')
  assert.equal(audio.played, 1)

  audio.handlers.play()
  assert.equal(page.data.storyAudioPlaying, true)
  assert.equal(page.data.storyAudioKey, 'a1')
})

test('同一章节替换音频URL后预听新文件，不能沿用旧播放器', () => {
  const page = makePage()
  page.setData({ 'chapterForm.audioUrl': 'https://cdn/old.mp3' })
  page.onPreviewChapterAudio()
  const old = createdAudios[0]
  old.handlers.play()
  page.setData({ 'chapterForm.audioUrl': 'https://cdn/new.mp3' })
  page.onPreviewChapterAudio()
  assert.equal(old.destroyed, 1)
  assert.equal(createdAudios[1].src, 'https://cdn/new.mp3')
  assert.equal(createdAudios[1].played, 1)
  old.handlers.play()
  assert.equal(page.data.audioPreviewPlaying, false, '旧文件回调不能污染新文件状态')
})

test('同一故事块替换音频URL后预听新文件，保留同块暂停契约', () => {
  const page = makePage()
  tap(page, 'a1')
  const old = createdAudios[0]
  old.handlers.play()
  page.setData({ 'formData.chapters[0].blocks[0].url': 'https://cdn/replaced.mp3' })
  tap(page, 'a1')
  assert.equal(old.destroyed, 1)
  assert.equal(createdAudios[1].src, 'https://cdn/replaced.mp3')
  createdAudios[1].handlers.play()
  tap(page, 'a1')
  assert.equal(createdAudios[1].paused, 1)
})

test('同一块再点是暂停,再点继续;不重复建播放器', () => {
  const page = makePage()
  tap(page, 'a1')
  const audio = createdAudios[0]
  audio.handlers.play()

  tap(page, 'a1')
  assert.equal(audio.paused, 1)
  audio.handlers.pause()
  assert.equal(page.data.storyAudioPlaying, false)

  tap(page, 'a1')
  assert.equal(audio.played, 2)
  assert.equal(createdAudios.length, 1, '同块续播不该另起一个播放器')
})

test('播放失败给明确 toast 并复位状态', () => {
  const page = makePage()
  tap(page, 'a1')
  const audio = createdAudios[0]
  audio.handlers.play()

  audio.handlers.error({ errMsg: 'decode fail' })

  assert.equal(page.data.storyAudioPlaying, false)
  assert.equal(page.data.storyAudioKey, '')
  assert.ok(toasts.some((t) => /decode fail|预听失败/.test(String(t))), '失败必须给玩家反馈')
})

test('换一块播时停掉上一块,不叠音', () => {
  const page = makePage()
  tap(page, 'a1')
  const first = createdAudios[0]
  first.handlers.play()

  tap(page, 'a2')

  assert.equal(first.destroyed, 1, '换块必须销毁上一块的播放器')
  const second = createdAudios[1]
  assert.equal(second.src, 'https://cdn/a2.mp3')
  assert.equal(second.played, 1)
  assert.equal(page.data.storyAudioKey, '', '换块先停旧块,key 复位;新块 onPlay 后才指向新块')
  second.handlers.play()
  assert.equal(page.data.storyAudioKey, 'a2')
})

test('关闭故事流编辑器停掉音频,不留后台声音', () => {
  const page = makePage()
  tap(page, 'a1')
  const audio = createdAudios[0]
  audio.handlers.play()

  page.closeStoryEditor()

  assert.equal(audio.destroyed, 1)
  assert.equal(page.data.storyAudioPlaying, false)
  assert.equal(page.data.storyAudioKey, '')
})

test('删掉正在播的音频块会停掉它', () => {
  const page = makePage()
  tap(page, 'a1')
  const audio = createdAudios[0]
  audio.handlers.play()

  page.removeStoryMedia({ currentTarget: { dataset: { blockkey: 'a1' } } })

  assert.equal(audio.destroyed, 1)
  assert.equal(page.data.storyAudioPlaying, false)
})

test('已有章节旁白与故事流音频互斥:开一个必然停另一个', () => {
  const page = makePage()
  page.data.chapterForm = { audioUrl: 'https://cdn/chapter.mp3', audioFileName: 'chapter.mp3' }

  page.onPreviewChapterAudio()
  const narration = createdAudios[0]
  narration.handlers.play()
  assert.equal(page.data.audioPreviewPlaying, true)

  tap(page, 'a1')
  assert.equal(narration.destroyed, 1, '故事流音频起播必须停掉正在放的章节旁白')

  const story = createdAudios[1]
  story.handlers.play()

  page.onPreviewChapterAudio()
  assert.equal(story.destroyed, 1, '章节旁白起播必须停掉正在放的故事流音频')
  assert.equal(page.data.storyAudioPlaying, false)
})

test('无 url 的音频块点了不建播放器(空态走上传,不走预听)', () => {
  const page = makePage()
  page.data.formData.chapters[0].blocks[0].url = ''
  tap(page, 'a1')
  assert.equal(createdAudios.length, 0)
})

// ── F14 P2 回归:来源身份登记 / 缓冲期删除 / 同 URL 双向切换 ────────────────
// 审查发现:①storyAudioKey 直到 onPlay 才赋值,网络缓冲期删块匹配不到 ⇒ 不 destroy,
// 缓冲完还会响;②旁白只按 URL 复用,故事块与旁白同址时沿用故事块监听器 ⇒
// audioPreviewPlaying 永远 false、点了 pause 不了。两条都靠「建播放器时登记来源身份」修。

test('P2-1 删除正在缓冲(未 onPlay)的音频块必须停掉播放器', () => {
  const page = makePage()
  tap(page, 'a1')
  const audio = createdAudios[0]
  assert.equal(audio.played, 1, '已经请求起播')
  assert.equal(page.data.storyAudioKey, '', 'onPlay 之前还没有 UI key')

  page.removeStoryMedia({ currentTarget: { dataset: { blockkey: 'a1' } } })

  assert.equal(audio.destroyed, 1, '缓冲期删除也必须 destroy')
  assert.equal(page._previewAudio, null)
})

test('P2-1 删除后旧播放器迟到的 onPlay 不能复活状态', () => {
  const page = makePage()
  tap(page, 'a1')
  const audio = createdAudios[0]
  page.removeStoryMedia({ currentTarget: { dataset: { blockkey: 'a1' } } })

  audio.handlers.play() // 缓冲完成,迟到回调

  assert.equal(page.data.storyAudioPlaying, false)
  assert.equal(page.data.storyAudioKey, '')
})

test('P2-1 删另一块时不能误停当前块', () => {
  const page = makePage()
  tap(page, 'a1')
  const audio = createdAudios[0]
  audio.handlers.play()

  page.removeStoryMedia({ currentTarget: { dataset: { blockkey: 'a2' } } })

  assert.equal(audio.destroyed, 0)
})

test('P2-2 同 URL:故事块→章节旁白必须换监听器,旁白可暂停', () => {
  const page = makePage()
  page.data.formData.chapters[0].blocks[0].url = 'https://cdn/same.mp3'
  page.data.chapterForm = { audioUrl: 'https://cdn/same.mp3', audioFileName: 'same.mp3' }

  tap(page, 'a1')
  const story = createdAudios[0]
  story.handlers.play()
  assert.equal(page.data.storyAudioPlaying, true)

  page.onPreviewChapterAudio()

  assert.equal(story.destroyed, 1, '同 URL 也不能沿用故事块的监听器')
  const chapter = createdAudios[1]
  assert.equal(chapter.src, 'https://cdn/same.mp3')
  chapter.handlers.play()
  assert.equal(page.data.audioPreviewPlaying, true, '旁白自己的监听器必须置真')
  assert.equal(page.data.storyAudioPlaying, false)

  page.onPreviewChapterAudio()
  assert.equal(chapter.paused, 1, '旁白要能暂停')
  chapter.handlers.pause()
  assert.equal(page.data.audioPreviewPlaying, false)
})

test('P2-2 同 URL:章节旁白→故事块必须换监听器,故事块可暂停', () => {
  const page = makePage()
  page.data.formData.chapters[0].blocks[0].url = 'https://cdn/same.mp3'
  page.data.chapterForm = { audioUrl: 'https://cdn/same.mp3', audioFileName: 'same.mp3' }

  page.onPreviewChapterAudio()
  const chapter = createdAudios[0]
  chapter.handlers.play()

  tap(page, 'a1')
  assert.equal(chapter.destroyed, 1)
  const story = createdAudios[1]
  story.handlers.play()
  assert.equal(page.data.storyAudioPlaying, true)

  tap(page, 'a1')
  assert.equal(story.paused, 1, '故事块要能暂停')
  story.handlers.pause()
  assert.equal(page.data.storyAudioPlaying, false)
})
