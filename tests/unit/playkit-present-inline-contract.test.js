/* 契约 §1.5 呈现方式(2026-09-18 用户拍板):内嵌 / 全屏 —— 玩家端三件事:
 *   ① pickPlayKit 逐字搬服务端会话视图**根层**的 present(inline / fullscreen):
 *      默认表的唯一实现在服务端(AdvancedGameConfigValidator#resolvePresent),客户端不重推;
 *   ② 内嵌 kit 铺进 chapterParas 是一个 kind:'kit' 段,外层仍是 .chfull__para 每一项一个 ——
 *      measureChapter 用 selectAll('.chfull__para') 按下标对齐,多一个少一个整屏焦点错位;
 *   ③ cy-play-stage 的内嵌档:在流里渲染(不 position:fixed)、退出钮隐藏,但 z-index 与
 *      skin 仍走既有通道 —— 手写 z-index 会渲染到地图/角色卡(80–90 档)底下且不报错。
 *
 * 另:diceRoll 是用户点名的例外 —— 整屏(摇)与内嵌(故事流里直接掷)两套呈现都保留,
 * 删掉任何一版都算没做完。
 */
const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const PLAY = '../../pages/play/index.js'
const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const { pickPlayKit, presentOf } = require('../../pages/play/utils/playkit-view.js')

let pageConfig

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
  createInnerAudioContext: () => ({
    src: '', play() {}, pause() {}, stop() {}, destroy() {},
    onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {}, onWaiting() {}, onCanplay() {},
  }),
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

function makePage(chapter, nodes, playKit) {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.data.chapter = chapter || {}
  page.data.nodes = nodes || []
  if (playKit) page.data.playKit = playKit
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(key => setAtPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  page.measureChapter = () => {}
  return page
}

beforeEach(() => {
  pageConfig = null
  delete require.cache[require.resolve(PLAY)]
  require(PLAY)
})

// ===== ① 呈现方式读数(服务端唯一真源)=====

test('present 逐字搬服务端会话视图根层;字段缺失按 fullscreen,存量行为逐字不变', () => {
  const qa = { playKit: { qa: { mode: 'PICK', title: 't', options: [] } }, sessionId: 1, version: 0 }
  assert.equal(presentOf(Object.assign({ present: 'inline' }, qa)), 'inline')
  assert.equal(presentOf(Object.assign({ present: 'fullscreen' }, qa)), 'fullscreen')
  // 旧后端 / mock / 试玩没有这个字段:整屏,与改动前一模一样
  assert.equal(presentOf(qa), 'fullscreen')
  assert.equal(presentOf(null), 'fullscreen')

  assert.equal(pickPlayKit(Object.assign({ present: 'inline' }, qa)).present, 'inline')
  assert.equal(pickPlayKit(qa).present, 'fullscreen')
})

// ===== ② 内嵌 kit 进 chapterParas(一项一个 .chfull__para)=====

const INLINE_KIT = { show: false, kit: { type: 'qa', present: 'inline', title: 't' } }

test('★内嵌 kit 铺成一个 kind:kit 段,正好落在第一个未完成节点处', () => {
  const page = makePage({
    description: '',
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'node', nodeId: 501 },
      { type: 'text', content: '第一站之后' },
      { type: 'node', nodeId: 502 },
      { type: 'text', content: '这段不该出现(502 还没走)' },
    ],
  }, [
    { nodeId: 501, done: true, story: '' },
    { nodeId: 502, done: false, story: '' },
  ], INLINE_KIT)

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.kind), ['text', 'text', 'kit'],
    '内嵌 kit 必须正好占一项,且落在截断闸(第一个未完成节点)处')
  assert.equal(page.data.chapterParas.filter(p => p.kind === 'kit').length, 1)
  assert.equal(page.data.chapterParas[2].text, '')
})

test('★不是内嵌 / 没有玩法 → 一个 kit 段都不铺:整屏那批照旧走弹层,不重复铺一份', () => {
  const chapter = {
    description: '',
    blocks: [{ type: 'text', content: '开场' }],
  }
  const fullscreen = makePage(chapter, [], { show: true, kit: { type: 'qa', present: 'fullscreen' } })
  fullscreen.openChapterFull()
  assert.deepEqual(fullscreen.data.chapterParas.map(p => p.kind), ['text'])

  const none = makePage(chapter, [], { show: false, kit: null })
  none.openChapterFull()
  assert.deepEqual(none.data.chapterParas.map(p => p.kind), ['text'])
})

test('★没有未完成节点(线性走完)时,内嵌 kit 接在故事流末尾,不漏铺', () => {
  const page = makePage({
    description: '',
    blocks: [
      { type: 'text', content: '开场' },
      { type: 'node', nodeId: 501 },
      { type: 'text', content: '收尾' },
    ],
  }, [{ nodeId: 501, done: true, story: '' }], INLINE_KIT)

  page.openChapterFull()

  assert.deepEqual(page.data.chapterParas.map(p => p.kind), ['text', 'text', 'kit'])
})

test('★kit 段的外层仍是循环里那个唯一的 .chfull__para —— 少一个/多一个都整屏焦点错位', () => {
  const wxml = read('pages/play/index.wxml')
  // 外层:chapterParas 逐项铺,类名逐字 chfull__para,没有条件包在这一层(一旦包了,下标就对不上)
  const loops = wxml.match(/<view wx:for="\{\{chapterParas\}\}"[^>]*class="chfull__para"/g) || []
  assert.equal(loops.length, 1, '.chfull__para 的外层循环只能有一个,且不带条件')
  // 内嵌 kit 的渲染分支在同一个循环体内(wx:elif),不是另起一个循环
  assert.match(wxml, /wx:elif="\{\{item\.kind === 'kit'\}\}"[\s\S]*?cy-playkit kit="\{\{playKit\.kit\}\}" show="\{\{true\}\}"/,
    'kit 段没有在循环里渲染,或 kit 绑的不是页面上那份 playKit.kit')
})

// ===== ③ play-stage 内嵌档:在流里 + 退出钮隐藏 + z-index/skin 不走样 =====

test('play-stage 内嵌档在流里渲染、退出钮走变量隐藏;z-index 仍走 token,不写死数字', () => {
  const wxss = read('pages/play/components/play-stage/index.wxss')
  const pageWxss = read('pages/play/index.wxss')

  // 切档靠变量(变量能穿组件边界,所以 24 个 kit 一个都不用改)
  assert.match(wxss, /position:\s*var\(--pk-stage-pos,\s*fixed\)/,
    '内嵌档没接 --pk-stage-pos:缺省必须仍是 fixed(存量模板逐字不变)')
  assert.match(wxss, /height:\s*var\(--pk-stage-height,\s*auto\)/,
    '内嵌块没有高度变量:relative 下 top/bottom:0 撑不起来,整块会塌成 0')
  assert.match(wxss, /\.st__back\s*\{[^}]*display:\s*var\(--pk-back-display,\s*flex\)/,
    '内嵌态退出钮没有隐藏通道')
  // z-index:内嵌态(position:relative)同样认它,手写数字会压到地图/角色卡底下。
  // 只看台面根节点那一条 `.st`(内部小件 .st__back/.st__limit 的 12 档是台面内层,不参与外压)
  const stageRule = wxss.match(/\.st\s*\{[^}]*\}/)
  assert.ok(stageRule, 'play-stage 的 .st 规则丢了')
  assert.match(stageRule[0], /z-index:\s*var\(--cy-z-sheet\)/, 'z-index 必须走 --cy-z-sheet token')
  assert.equal(/z-index:\s*\d/.test(stageRule[0]), false, '台面根节点出现了手写数字 z-index')
  // skin 认领:play-surface 必须还在 import 里,否则 --bg 解析成空、整层透明且不报错
  assert.ok(wxss.includes('@import "/pages/play/style/play-surface.wxss"'),
    'play-surface 的皮肤表没被 import:skin-xxx 无人认领,--bg 空,内嵌态同样整层透明')

  // 故事流那层把变量给到位(名字对不上就不生效且不报错)
  const kitRule = pageWxss.match(/\.chfull__kit\{[^}]*\}/)
  assert.ok(kitRule, '故事流里没有 .chfull__kit 这一层,变量没有落脚点')
  assert.match(kitRule[0], /--pk-stage-pos:relative/)
  assert.match(kitRule[0], /--pk-stage-height:/)
  assert.match(kitRule[0], /--pk-back-display:none/)
  assert.equal(/z-index/.test(kitRule[0]), false, '内嵌块的 z-index 不许在这一层手写')
})

// ===== diceRoll 例外:两套呈现都保留 =====

test('★diceRoll 两套呈现都在:整屏(摇一摇)与内嵌(故事流里直接掷)不许删任何一版', () => {
  const wxml = read('pages/play/components/playkit-diceroll/index.wxml')
  const wxss = read('pages/play/components/playkit-diceroll/index.wxss')
  const js = read('pages/play/components/playkit-diceroll/index.js')
  const dispatcherWxml = read('pages/play/components/playkit/index.wxml')
  const dispatcherJs = read('pages/play/components/playkit/index.js')

  // 两套构图各占一条分支
  assert.match(wxml, /wx:if="\{\{inline\}\}"/, '内嵌那套构图被删了')
  assert.match(wxml, /wx:else/, '整屏那套构图被删了')
  // 内嵌那套不许复用整屏那套的几何假设(绝对铺满 / --pk-top 让位)
  const inlineBlock = wxss.match(/\.dzi\s*\{[^}]*\}/)
  assert.ok(inlineBlock, '内嵌版样式块 .dzi 丢了')
  assert.equal(/position:\s*absolute/.test(inlineBlock[0]), false,
    '内嵌版照搬了整屏的绝对铺满:在滚动流里会错位')
  assert.equal(/--pk-top/.test(inlineBlock[0]), false,
    '内嵌版照搬了整屏的 --pk-top 让位假设')
  assert.match(wxss, /\.dz\s*\{[^}]*position:\s*absolute/, '整屏那套的几何被改掉了')
  // 内嵌不靠摇手机(走在路上会误触发);整屏照旧摇
  assert.match(js, /if \(this\.data\.inline\) this\._offShake\(\); else this\._onShake\(\);/,
    '内嵌版没有关掉摇一摇监听,或整屏版不再监听')
  // 分发器要把 inline 属性转给 diceroll(别的 kit 不需要这个属性)
  assert.match(dispatcherWxml, /cy-playkit-diceroll[\s\S]*?inline="\{\{inline\}\}"/,
    '分发器没有把 inline 转给 diceroll')
  assert.match(dispatcherJs, /inline:\s*\{\s*type:\s*Boolean/, '分发器没有声明 inline 属性')
})
