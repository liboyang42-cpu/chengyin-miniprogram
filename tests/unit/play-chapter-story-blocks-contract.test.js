const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const PLAY = '../../pages/play/index.js'
const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 章节剧情屏读的是 /api/play/nodes 下发的章节 blocks(文字 / 图片 / 音频)。
// ⚠️ 2026-09-06 用户裁决:**两种音频并存** ——
//    · chapter.audioUrl = 整章背景旁白,打开本章自动播,没有位置(key='chapter');
//    · blocks 里的 audio = 带位置的片段,读到那一段才响,要点(key='ch<i>')。
//    两者共用同一个播放器,后播的把前面那段顶掉。
// 这一屏此前只读 chapter.description —— blocks 后端发了三个版本没人消费。
// 所以这里必须是**行为测**:真调 openChapterFull,断言它铺出来的 chapterParas。
// 静态匹配挡不住「读到了但铺错顺序 / 把图片 url 当正文打出来」这类。

let pageConfig
let audio

global.getApp = () => ({ globalData: {}, getUserID: () => 1, sendRequest: () => {} })

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
  createInnerAudioContext: () => {
    audio = {
      src: '', played: 0, paused: 0, stopped: 0,
      play() { this.played += 1 }, pause() { this.paused += 1 }, stop() { this.stopped += 1 },
      onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {}, onWaiting() {}, onCanplay() {},
      destroy() {},
    }
    return audio
  },
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

function makePage(chapter, nodes) {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.data.chapter = chapter
  page.data.nodes = nodes || []
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(key => setAtPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  page.measureChapter = () => {}
  return page
}

beforeEach(() => {
  audio = null
  pageConfig = null
  delete require.cache[require.resolve(PLAY)]
  require(PLAY)
})

test('章节块流按作者编排的顺序铺开,文字与图片都到得了玩家眼前', () => {
  // ⚠️ 节点必须是 done —— 这条测的是「三类媒体按序渲染」,不是截断闸。
  //    节点留 undone 的话「收尾」会被截断闸正确地挡掉,这条会红在一个它不负责的原因上。
  const page = makePage({
    description: '开场',
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'image', url: 'https://cdn/x.jpg' },
      { type: 'node', nodeId: 501 },
      { type: 'text', content: '收尾' },
    ],
  }, [{ nodeId: 501, done: true, story: '' }])

  page.openChapterFull()

  // node 块不在这屏展开:站点有自己的卡片,再摆一遍会把剧情读成目录
  assert.deepEqual(page.data.chapterParas.map(p => p.kind), ['text', 'image', 'text'])
  assert.equal(page.data.chapterParas[0].text, '开场')
  assert.equal(page.data.chapterParas[1].url, 'https://cdn/x.jpg')
  assert.equal(page.data.chapterParas[2].text, '收尾')
})

// ★ description 就是块流里首个节点之前那些文字块的后端投影。两个都推 = 开头整段重复,
//   而且只在「章节确实有块流」时才复现 —— 存量无块章节看不出来。
test('有块流时不再叠加 description,开头不会重复一遍', () => {
  const page = makePage({
    description: '开场',
    blocks: [{ type: 'text', content: '开场' }],
  })

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.text), ['开场'])
})

test('没有块流的存量章节回退到 description,老数据不能变成空屏', () => {
  const page = makePage({ description: '第一段\n第二段', blocks: null })

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.text), ['第一段', '第二段'])
  assert.deepEqual(page.data.chapterParas.map(p => p.kind), ['text', 'text'])
})

test('缺 url 的媒体块整块丢掉,不铺一个点了没反应的空条', () => {
  const page = makePage({
    description: '',
    blocks: [
      { type: 'image', url: '' },
      { type: 'audio' },
      { type: 'text', content: '正文还在' },
    ],
  })

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.kind), ['text'])
})

// 2026-09-04 拍板:进本章即播,不要玩家点。所以这里没有 tap 入口可测 ——
// 断言必须挂在「打开章节屏」这个动作上。
test('章节背景旁白在打开本章时自动起播,audioNodeId 用 chapter 不与块/节点相撞', () => {
  const page = makePage({
    description: '正文',
    audioUrl: 'https://cdn/x.mp3',
    blocks: [{ type: 'text', content: '正文' }],
  })

  page.openChapterFull()

  assert.equal(audio.src, 'https://cdn/x.mp3')
  assert.equal(audio.played, 1)
  assert.equal(page.data.audioNodeId, 'chapter')
})

// ★ 两种音频共用一个 InnerAudioContext。key 撞了就会出现「点块却把旁白当成同一段」这种
//   看不出来的错 —— 旁白是 'chapter',块是 'ch<i>',字符串不相等。
test('故事流音频块能点着播,且与整章旁白的 key 不相撞', () => {
  const page = makePage({
    description: '',
    audioUrl: 'https://cdn/narration.mp3',
    blocks: [{ type: 'audio', url: 'https://cdn/clip.mp3' }],
  })
  page.openChapterFull()
  assert.deepEqual(page.data.chapterParas.map(p => p.kind), ['audio'])
  assert.equal(page.data.audioNodeId, 'chapter', '进本章先起播旁白')

  page.toggleChapterAudio({ currentTarget: { dataset: { i: 0 } } })
  assert.equal(page.data.audioNodeId, 'ch0', '点块之后换成块')
  assert.equal(audio.src, 'https://cdn/clip.mp3')
})

// ★ 上面那条会假绿:makePage 是直接给 page.data.chapter 赋值的,绕过了 buildChapter。
//   而 buildChapter 是**白名单**映射 —— 后端下发了、它不列,页面就永远拿不到。
//   E1 第一版就漏在这:audioUrl 没进白名单,自动播放是死链,上面那条却照样绿。
//   所以必须单独钉「后端下发的那个字段真的走得进 data.chapter」。
test('buildChapter 必须把后端下发的 audioUrl 映射进 chapter —— 白名单漏一个就是死链', () => {
  const page = makePage({}, [])
  const built = page.buildChapter(
    { chapters: [{ name: '第一章', audioUrl: 'https://cdn/narration.mp3', blocks: [] }] },
    [],
  )

  assert.equal(built.audioUrl, 'https://cdn/narration.mp3',
    'buildChapter 漏了 audioUrl:playChapterAudio 读到的永远是 undefined,自动播放整条不发生')
})

test('没配旁白的章节不碰播放器,不要为了统一而空放一次', () => {
  const page = makePage({ description: '正文', blocks: [{ type: 'text', content: '正文' }] })

  page.openChapterFull()

  assert.equal(audio, null)
})

// 滚动/重测都会再进 playChapterAudio,重播会把旁白剁成开头一秒。
test('已经在放同一章旁白时不重播', () => {
  const page = makePage({
    description: '正文',
    audioUrl: 'https://cdn/x.mp3',
    blocks: [{ type: 'text', content: '正文' }],
  })
  page.openChapterFull()
  page.data.audioPlaying = true

  page.playChapterAudio()

  assert.equal(audio.played, 1)
})

test('收起章节屏要停掉章节音频,不留一段在后台继续念', () => {
  const page = makePage({
    description: '正文',
    audioUrl: 'https://cdn/x.mp3',
    blocks: [{ type: 'text', content: '正文' }],
  })
  page.openChapterFull()

  page.closeChapterFull()

  assert.equal(audio.stopped >= 1, true)
  assert.equal(page.data.audioNodeId, null)
  assert.equal(page.data.chapterFull, false)
})

// ===== 故事流截断闸(设计文档 §7.1「其后的块:完全不渲染」)=====
// ★ 这组是防回归的:master 上这屏只读 chapter.description,而后端 description 投影
//   本来就在首个 node 块处停,所以旧代码天然安全。是「开始消费完整块流」这件事
//   把潜在泄漏变成真泄漏 —— 没有这道闸,节点之后的剧情会在玩家走到之前就全看见。

test('未完成的节点块之后,一个块都不渲染 —— 否则就是剧透', () => {
  const page = makePage({
    description: '',
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'node', nodeId: 501 },
      { type: 'text', content: '这段是走到第一站之后才该看见的' },
      { type: 'image', url: 'https://cdn/spoiler.jpg' },
    ],
  }, [{ nodeId: 501, done: false, story: '' }])

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.text), ['开场'])
  assert.equal(page.data.chapterParas.some(p => p.kind === 'image'), false,
    '未完成节点之后的图片同样不许出现')
})

test('节点完成后,它的手记就地接上,后面的块继续往下放', () => {
  const page = makePage({
    description: '',
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'node', nodeId: 501 },
      { type: 'text', content: '第一站之后的剧情' },
      { type: 'node', nodeId: 502 },
      { type: 'text', content: '第二站之后的剧情' },
    ],
  }, [
    { nodeId: 501, done: true, story: '你在门牌下找到了刻痕。' },
    { nodeId: 502, done: false, story: '' },
  ])

  page.openChapterFull()

  // 501 已完成 ⇒ 开场 + 它的手记 + 它后面那段;502 未完成 ⇒ 到此为止
  assert.deepEqual(page.data.chapterParas.map(p => p.text),
    ['开场', '你在门牌下找到了刻痕。', '第一站之后的剧情'])
})

test('节点块自身不占一段 —— 站点有自己的卡片,再摆一遍会读成目录', () => {
  const page = makePage({
    description: '',
    blocks: [{ type: 'node', nodeId: 501 }, { type: 'text', content: '走完之后' }],
  }, [{ nodeId: 501, done: true, story: '' }])

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.text), ['走完之后'])
})

// nodeId 后端下发是数字、页面上归一后也可能是字符串,类型不一致会让闸「永远判未完成」
// —— 那样整章只剩开场一段,是另一个方向的静默故障。
test('nodeId 数字与字符串混用仍能配上,不会把已完成误判成未完成', () => {
  const page = makePage({
    description: '',
    blocks: [{ type: 'node', nodeId: 501 }, { type: 'text', content: '走完之后' }],
  }, [{ nodeId: '501', done: true, story: '' }])

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.text), ['走完之后'])
})

test('块流里引用了页面上不存在的节点时按未完成处理,宁可少显示不可剧透', () => {
  const page = makePage({
    description: '',
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'node', nodeId: 999 },
      { type: 'text', content: '不该出现' },
    ],
  }, [{ nodeId: 501, done: true, story: '' }])

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.text), ['开场'])
})

test('章节剧情复用滚动叙事结构，面色照原型 c-chfull 的近黑', () => {
  const wxml = read('pages/play/index.wxml')
  const wxss = read('pages/play/index.wxss')
  const tokens = read('style/tokens.wxss')
  const driver = read('scripts/_verify_play_roadmap_shots.js')
  const storyStart = wxml.indexOf('<view class="chfull ')
  const storyEnd = wxml.indexOf('<!-- ===================== 底部运行栈', storyStart)
  const storyWxml = wxml.slice(storyStart, storyEnd)

  assert.match(storyWxml, /class="chfull__eyebrow"[^>]*>\{\{chapter\.idxLabel/)
  assert.match(storyWxml, /class="chfull__title"[^>]*>\{\{chapter\.name/)
  assert.match(storyWxml, /item\.kind === 'cover'[^>]*class="chfull__cover"/,
    '主物件进入与正文相同的滚动衰减序列')
  assert.match(storyWxml, /class="chfull__continue"[^>]*bindtap="closeChapterFull"/,
    '参考稿最终 CTA 映射到现有收起并继续玩法动作')
  assert.match(wxml, /!chapterFull/, '章节叙事打开时必须隐藏底部黑色运行栏')
  /* ⚠️ 2026-09-10 用户裁决推翻了 2026-08 那条「浅色城瘾舞台」偏好:
     漫游四模式脱离小程序 DS、逐条照原型 HTML,而原型 c-chfull / x-intro 是 .settle 的
     近黑面 #08090B。所以这三条从「不得纯黑」翻成「必须是原型那一面」。
     结构没变(块流 / 近焦正文 / 三格 / CTA 仍在上面各条里守着)。
     浅色那组 token 本身不动 —— roadmap 与 session 还在用。 */
  assert.match(wxss, /\.chfull\s*\{[^}]*background:\s*#08090B/i,
    '章节剧情必须是原型 c-chfull 的 #08090B')
  assert.doesNotMatch(wxss, /\.chfull\s*\{[^}]*background:\s*var\(--cy-color-play-story-page\)/,
    '不许退回浅色纸面')
  assert.match(wxss, /\.chfull__para\{[^}]*color:#D5DAE1/, '正文照原型 15px #D5DAE1')
  assert.match(wxss, /\.chfull__eyebrow\{[^}]*color:#E2C489/, '眉标照原型 11px #E2C489')
  assert.match(tokens, /--cy-color-play-story-page:\s*#FFFFFF;/, '浅色 token 留着给 roadmap / session')
  assert.doesNotMatch(storyWxml, /passport|invite code|护照|邀请码/i,
    '只复用 Infinity 结构，不把 Atlys 业务对象带入城瘾')
  assert.equal((wxss.match(/\.chfull\s*\{/g) || []).length, 1,
    '章节全屏样式只能保留一份，避免同一改版被迫双改')

  const page = makePage({
    cover: '/images/route_city_cover.png',
    description: '',
    blocks: [{ type: 'text', content: '正文' }],
  })
  page.openChapterFull()
  assert.deepEqual(page.data.chapterParas.map(item => item.kind), ['cover', 'text'])
  assert.equal(page.data.chapterParas[0].url, '/images/route_city_cover.png')
  assert.match(driver, /page\.callMethod\('openChapterFull'\)/,
    'DevTools 必须从页面公开 handler 打开真实章节滚动态')
  assert.match(driver, /play-infinity-story-figma-2026-08-23\.png/)
})

// 2026-09-18 UI-20 返修:发布端历史默认章节名是英文占位「Chapter N」,截图里 topicId=10
// 的起始页标题就是原样上屏的「Chapter 1」。占位必须显示成中文序数,不能再露给玩家。
test('buildChapter 把英文占位章节名显示成中文「第 N 章」', () => {
  const page = makePage({}, [])
  const built = page.buildChapter({ topicName: '哈哈哈', chapters: [{ name: 'Chapter 1' }] }, [])

  assert.equal(built.name, '第 1 章', '英文占位要换成中文序数,且不能落回主题名')
  assert.equal(built.idxLabel, '', '眉标和标题重复同一个序数时不再重复')
})

test('buildChapter 保留真实章节名,空名仍回落主题名', () => {
  const page = makePage({}, [])

  assert.equal(page.buildChapter({ topicName: '哈哈', chapters: [{ name: '雨夜的第一站' }] }, []).name,
    '雨夜的第一站')
  assert.equal(page.buildChapter({ topicName: '哈哈', chapters: [{}] }, []).name, '哈哈')
})

test('buildChapterCards 的占位章节不把 Chapter N 或重复序数露给玩家', () => {
  const page = makePage({}, [])
  const cards = page.buildChapterCards({
    chapters: [{ name: 'Chapter 2' }, { name: '真实的第二章' }],
  }, { idxLabel: '', name: '' })

  assert.equal(cards[0].title, '第 2 章', '占位里的序号优先于数组下标')
  assert.equal(cards[0].meta, '', '序数标签与标题重复时不出')
  assert.equal(cards[1].title, '真实的第二章')
  assert.equal(cards[1].meta, '第 2 章', '真实章节名仍带序数标签')
})

// 显示层兜住旧数据,发布端也不该再制造英文占位(只影响新发布,不动存量)。
test('发布端不再把英文占位 Chapter N 写进新章节', () => {
  assert.doesNotMatch(read('pages/publish/simple/index.js'), /name:\s*'Chapter/,
    'simple 发布默认章节名必须是中文')
  assert.doesNotMatch(read('pages/publish/fabu/index.js'), /name:\s*(ch\.name\s*\|\|\s*)?'Chapter/,
    'fabu 发布/AI 草稿默认章节名必须是中文')
})

