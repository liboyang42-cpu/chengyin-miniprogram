/* 契约 §3 三项玩家端能力:故事变量 / dream 块 / 站末分支图(2026-09-17)
 *
 * 三件都坏在**静默**上:
 *   · {名字} 渲染成空串 = 句子缺一块,作者永远看不出漏了哪个键;
 *   · dream 少一个 .chfull__para 或块内多占一层 = measureChapter 按下标对齐错位,整屏焦点全乱;
 *   · 分支图用猜的数据硬凑 = 拿没走过的东西冒充走过的路。
 * 所以这里按行为测:真调 openChapterFull / onDreamTap / _buildBranchPath。
 */
const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const path = require('node:path')

const PLAY = '../../pages/play/index.js'
const { applyStoryVars } = require('../../pages/play/utils/playkit-view.js')

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
  page.data.chapter = chapter || {}
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

// ===== 故事变量(契约 §3.1)=====

test('变量替换:有值用值,没值用竖线后的兜底,两者都没有就原样留花括号', () => {
  const vars = { name: '阿岚', job: '店员' }
  assert.equal(applyStoryVars('{name}推门进来', vars), '阿岚推门进来')
  assert.equal(applyStoryVars('{name|那个人}推门进来', vars), '阿岚推门进来')
  assert.equal(applyStoryVars('{job|一个店员}在等', vars), '店员在等')
  assert.equal(applyStoryVars('{job|一个店员}在等', {}), '一个店员在等')
  assert.equal(applyStoryVars('{window|窗外}', {}), '窗外')
  // ★ 没值且没兜底:原样留着 —— 渲染成空串的话作者永远看不到自己漏了哪个键
  assert.equal(applyStoryVars('窗外是{window}', {}), '窗外是{window}')
  assert.equal(applyStoryVars('{:不是键', {}), '{:不是键')
  // 同一句里多个变量各替各的
  assert.equal(applyStoryVars('{name}在{job}', vars), '阿岚在店员')
})

test('★章节正文与节点 story 都过变量替换;服务端没下发 vars 时行为逐字不变', () => {
  const page = makePage({
    description: '「{name|有人}推开门,看见{window}。」',
    blocks: [{ type: 'text', content: '「{name|有人}推开门,看见{window}。」' }, { type: 'node', nodeId: 501 }],
  }, [{ nodeId: 501, done: true, story: '{name|有人}在门牌下站了一会儿。', description: '{name|有人}在门牌下站了一会儿。' }])

  // 没有 vars:有兜底的吃兜底,没兜底的原样留着花括号
  page.openChapterFull()
  assert.equal(page.data.chapterParas[0].text, '「有人推开门,看见{window}。」')
  assert.equal(page.data.chapterParas[1].text, '有人在门牌下站了一会儿。')

  // 服务端下发 vars 之后:值与兜底各就各位
  page._storyVars = { name: '阿岚', window: '一扇亮着的窗' }
  page.openChapterFull()
  assert.deepEqual(page.data.chapterParas.map(p => p.text), [
    '「阿岚推开门,看见一扇亮着的窗。」',
    '阿岚在门牌下站了一会儿。',
  ])

  // 节点 story 半屏(openStory)走同一条替换
  page.openStory({ currentTarget: { dataset: { id: 501, step: '第 1 站' } } })
  assert.equal(page.data.story.text, '阿岚在门牌下站了一会儿。')
})

test('契约只认一条正则,不许长成模板引擎', () => {
  const src = require('node:fs').readFileSync(
    path.resolve(__dirname, '../../pages/play/utils/playkit-view.js'), 'utf8')
  assert.ok(src.includes('\\\\{([a-zA-Z][a-zA-Z0-9_]{0,15})'), '正则与契约 §3.1 逐字一致')
  assert.equal(/eval\(|new Function/.test(src), false, '替换不许用 eval 那套')
})

// ===== dream 块(契约 §3.2)=====

const DREAM_BLOCKS = [{
  type: 'dream', key: 'd1',
  images: [{ url: 'https://cdn/a.jpg', line: '{name|有人}走进雾里' }, { url: 'https://cdn/b.jpg', line: '灯亮了' }],
}]

test('★dream 块铺成一个 chapterParas 项,不按张数铺 —— 少一个整屏焦点错位', () => {
  const page = makePage({ description: '', blocks: DREAM_BLOCKS }, [])
  page._storyVars = { name: '阿岚' }
  page.openChapterFull()

  assert.equal(page.data.chapterParas.length, 1, '一块 dream = 一个 .chfull__para,不是一张图一个')
  const para = page.data.chapterParas[0]
  assert.equal(para.kind, 'dream')
  assert.equal(para.images.length, 2)
  assert.equal(para.strip.length, 4)
  assert.deepEqual(para.strip.map(x => x.url), [para.images[0].url, para.images[1].url, para.images[0].url, para.images[1].url])
  assert.equal(para.images[0].line, '阿岚走进雾里', '每张那句也过故事变量')
  assert.equal(para.title, '相册', '旧梦块缺省名称为相册')
})

test('dream 相册打开和收起保留故事位置，不完成任何节点', () => {
  const page = makePage({ description: '', blocks: DREAM_BLOCKS }, [])
  page.openChapterFull()
  const paras = page.data.chapterParas
  page.openAlbum({currentTarget:{dataset:{i:0}}})
  assert.equal(page.data.album.show, true)
  assert.deepEqual(page.data.album.images, paras[0].images)
  page.closeAlbum()
  assert.equal(page.data.album.show, false)
  assert.equal(page.data.chapterFull, true)
  assert.equal(page.data.chapterParas, paras)
  page.closeChapterFull()
  assert.equal(page.data.chapterFull, false)
})

test('缺 url 的梦帧整帧丢掉;一帧都不剩时这一块不出现在正文里', () => {
  const page = makePage({
    description: '',
    blocks: [{ type: 'dream', key: 'd', images: [{ url: '', line: '空' }, { url: 'https://cdn/b.jpg', line: '有' }] }],
  }, [])
  page.openChapterFull()
  assert.equal(page.data.chapterParas[0].images.length, 1)

  const empty = makePage({ description: '', blocks: [{ type: 'dream', key: 'd', images: [{ line: '没图' }] }] }, [])
  empty.openChapterFull()
  assert.deepEqual(empty.data.chapterParas.map(p => p.kind), ['text'], '梦块空了就退回「这一章还没有写下的内容。」')
  assert.equal(empty.data.chapterParas[0].text, '这一章还没有写下的内容。')
})

test('减动效时照片带不自动滚 —— 这不是判定,不该跟系统偏好较劲', () => {
  const wxml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/play/index.wxml'), 'utf8')
  const strip = wxml.match(/<swiper class="chfull__album-strip"[^>]*>/)
  assert.ok(strip, '故事流里的相册照片带不见了')
  assert.match(strip[0], /autoplay="\{\{!reducedMotion\}\}"/, 'autoplay 必须绑 !reducedMotion')
})

// ===== 站末分支图(契约 §3.3)=====

test('分支图只读会话已有的 decisionLog,按走过顺序列出来', () => {
  const page = makePage({}, [
    { nodeId: 11, name: '巷口' }, { nodeId: 12, name: '河堤' }, { nodeId: 13, name: '旧书店' },
  ])
  page._routeState = {
    routeMode: 'BRANCH_GRAPH', status: 'COMPLETED',
    nodeStates: { 11: 'COMPLETED', 12: 'COMPLETED', 13: 'COMPLETED' },
    decisionLog: [
      { fromNodeId: 11, toNodeId: 12, edgeId: 'e1', outcomeCode: 'COMPLETED', at: '2026-09-17T10:00:00+08:00' },
      { fromNodeId: 12, toNodeId: 13, edgeId: 'e2', outcomeCode: 'COMPLETED', at: '' },
    ],
  }
  const rows = page._buildBranchPath()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].from, '巷口')
  assert.equal(rows[0].to, '河堤')
  assert.equal(rows[1].to, '旧书店')
})

test('★不是分支路线 / 没有选择记录 → 空数组,整块不渲染,不硬凑一条假路', () => {
  const page = makePage({}, [{ nodeId: 11, name: '巷口' }, { nodeId: 12, name: '河堤' }])
  // 线性路线也会写 decisionLog(按时序),但它不是分支图 —— 画出来就是另一条路的故事
  page._routeState = {
    routeMode: 'LINEAR',
    decisionLog: [{ fromNodeId: 11, toNodeId: 12, edgeId: 'e1', at: '' }],
  }
  assert.deepEqual(page._buildBranchPath(), [], '线性路线没有「分支」可画')

  page._routeState = { routeMode: 'BRANCH_GRAPH', status: 'ACTIVE', nodeStates: {}, decisionLog: [] }
  assert.deepEqual(page._buildBranchPath(), [], '一条记录都没有时不拿当前节点凑数')
})

test('★wxml 里 dream 真有一条渲染分支,且 .chfull__para 是不带条件的外层 —— 少一层就是空白段/整屏错位', () => {
  const fs = require('node:fs')
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.wxml'), 'utf8')
  assert.ok(wxml.includes("item.kind === 'dream'"), 'dream 块没有渲染分支,玩家会读到一个空白段')
  const loop = wxml.match(/<view wx:for="\{\{chapterParas\}\}"[^>]*class="chfull__para"/)
  assert.ok(loop, '.chfull__para 必须仍按 chapterParas 逐项铺 —— 条件包在外层会让下标对不上')
})
