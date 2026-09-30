const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('Roadmap 只高亮现有下一站，并保留完成与未来状态', () => {
  const { buildRoadmapModel } = require('../../pages/play/utils/play-roadmap.js')
  const model = buildRoadmapModel({
    eyebrow: '第一章',
    title: '顺着旧街走到黄昏',
    activeNodeId: 1002,
    nodes: [
      { nodeId: 1001, num: 1, name: '街角绿地补给点', gameTitle: '城市颜色采样', done: true },
      { nodeId: 1002, num: 2, name: '梧桐下的橱窗', gameTitle: '门牌线索', done: false },
      { nodeId: 1003, num: 3, name: '隐蔽展墙', description: '找到被海报覆盖的墙', done: false },
      { nodeId: 1004, num: 4, name: '黄昏观景口', gameTitle: '黄昏选择题', done: false, locked: true },
    ],
  })

  assert.equal(model.eyebrow, '第一章')
  assert.equal(model.title, '顺着旧街走到黄昏')
  assert.deepEqual(model.items.map((item) => item.state), ['done', 'active', 'future', 'locked'])
  assert.equal(model.items.filter((item) => item.state === 'active').length, 1)
  assert.equal(model.items[1].body, '门牌线索')
  assert.equal(model.progressText, '1 / 4 已完成')
})

test('Roadmap 缺少 activeNodeId 时不伪造高亮节点', () => {
  const { buildRoadmapModel } = require('../../pages/play/utils/play-roadmap.js')
  const model = buildRoadmapModel({
    nodes: [
      { nodeId: 'a', name: '已完成', done: true },
      { nodeId: 'b', name: '前路未知', done: false, locked: true },
      { nodeId: 'c', name: '可以开始', done: false },
      { nodeId: 'd', name: '以后再去', done: false },
    ],
  })

  assert.deepEqual(model.items.map((item) => item.state), ['done', 'locked', 'future', 'future'])
  assert.equal(model.items.filter((item) => item.state === 'active').length, 0)
  assert.equal(model.ctaDelayMs, model.highlightDelayMs + 220,
    '没有当前站高亮时，CTA 不得空等一段不存在的 600ms 动画')
})

test('Roadmap 任意节点数都依次进入，CTA 排在最后一个节点之后', () => {
  const { buildRoadmapModel } = require('../../pages/play/utils/play-roadmap.js')
  const model = buildRoadmapModel({
    activeNodeId: 4,
    nodes: Array.from({ length: 7 }, (_, index) => ({ nodeId: index + 1, name: '节点' + (index + 1) })),
  })

  assert.equal(model.items.length, 7)
  assert.equal(model.pathDelayMs, 350, '标题的 350ms 入场结束后才开始画路径')
  assert.equal(model.items[0].delayMs >= model.pathDelayMs + 350, true, '首节点必须等路径画完')
  assert.equal(model.items.every((item, index, list) => index === 0 || item.delayMs > list[index - 1].delayMs), true)
  assert.equal(model.highlightDelayMs >= model.items[model.items.length - 1].delayMs + 220, true,
    '当前节点高亮必须等最后一个节点入场结束')
  assert.equal(model.ctaDelayMs >= model.highlightDelayMs + 600, true,
    'CTA 必须等当前节点高亮演出结束')
})

test('城市定向开始页按 Figma Roadmap 骨架接入现有真实数据和动作', () => {
  const pageJson = JSON.parse(read('pages/play/index.json'))
  const pageWxml = read('pages/play/index.wxml')
  const componentWxml = read('pages/play/components/roadmap/index.wxml')
  const componentWxss = read('pages/play/components/roadmap/index.wxss')
  const pageWxss = read('pages/play/index.wxss')
  const tokensWxss = read('style/tokens.wxss')

  // 2026-09-22 起始页整屏删除后,组件在页面上已没有挂载点;页面注册保留,由城市定向那条线决定去留。
  assert.equal(pageJson.usingComponents['cy-play-roadmap'], '/pages/play/components/roadmap/index')
  assert.doesNotMatch(pageWxml, /<cy-play-roadmap\b/s, '起始页已删:组件不得再被挂回游玩页')

  assert.match(componentWxml, /class="roadmap__path"/)
  assert.match(componentWxml, /class="roadmap__path"[^>]*animation-delay:\{\{model\.pathDelayMs\}\}ms/s)
  assert.match(componentWxml, /class="roadmap__path-tail"/)
  assert.match(componentWxml, /wx:for="\{\{model\.items\}\}"/)
  assert.match(componentWxml, /roadmap__node--\{\{item\.state\}\}/)
  assert.match(componentWxml, /animation-delay:\{\{item\.delayMs\}\}ms/)
  assert.match(componentWxml, /class="roadmap__marker"[^>]*animation-delay:\{\{model\.highlightDelayMs\}\}ms/s)
  assert.match(componentWxml, /class="roadmap__cta"/)
  assert.match(componentWxml, /roadmap__footer" style="animation-delay:\{\{model\.ctaDelayMs\}\}ms"/)
  assert.doesNotMatch(componentWxml, /<view\b(?=[^>]*class="roadmap__node)[^>]*\bbindtap=/s, '站点不扩展参考稿没有的交互')
  assert.match(componentWxss, /\.roadmap--reduced-motion/)
  assert.match(componentWxss, /\.roadmap__marker-core\s*\{[\s\S]*?inset:\s*var\(--cy-legacy-4\)/,
    '24rpx marker 扣除 4rpx 边框后，core 必须仍有可见尺寸')
  assert.match(componentWxss, /\.roadmap__node--active \.roadmap__marker\s*\{[\s\S]*?box-shadow:/,
    '下一站必须比 done 节点多一层独立高亮')
  assert.doesNotMatch(componentWxss, /#[0-9A-Fa-f]{3,8}/, '新组件必须复用 --cy-* token，不另造颜色')
  assert.match(componentWxss, /background:\s*var\(--cy-comp-play-roadmap-bg\)/,
    'Figma Roadmap 是固定浅色舞台，不能继承游玩页的黑色 --cy-color-bg-page')
  assert.doesNotMatch(componentWxss, /background:\s*var\(--cy-color-bg-page\)/,
    'Roadmap 不得随玩家暗色主题退回黑底')
  assert.match(tokensWxss, /--cy-color-play-story-page:\s*#FFFFFF;/)
  assert.match(tokensWxss, /--cy-color-play-story-accent:\s*#4B46F5;/)
  assert.match(tokensWxss, /--cy-color-play-story-text:\s*#111111;/)
  assert.match(tokensWxss, /--cy-color-play-story-muted:\s*#5E6470;/)
  assert.match(tokensWxss, /--cy-color-play-story-line:\s*#8B8F99;/)
  assert.match(tokensWxss, /--cy-color-play-story-accent-fade:\s*#8C91A0;/)
  assert.match(tokensWxss, /--cy-comp-play-roadmap-bg:\s*var\(--cy-color-play-story-page\);/)
  // 起始页删除后页面侧已没有 .play-intro--roadmap 这层皮;「页面层不得反向消费组件层 token」
  // 这条改成对整份页面样式断言,比只看那一条规则更严。
  assert.doesNotMatch(pageWxss, /--cy-comp-play-roadmap-/,
    '页面层只能读语义 token，不得反向消费组件层')
})

test('Roadmap 时间线、章节卡、站点圆点同轴,且不再拐出方框', () => {
  const componentWxss = read('pages/play/components/roadmap/index.wxss')
  const headRule = /\.roadmap__head\s*\{([\s\S]*?)\}/.exec(componentWxss)
  assert.ok(headRule, 'roadmap__head 规则必须在')
  assert.match(headRule[1], /padding:[^;]*calc\(var\(--cy-page-x\) \+ var\(--cy-space-5\)\)/,
    '章节卡左缘 = page-x + space-5')

  const pathRule = /\.roadmap__path\s*\{([\s\S]*?)\}/.exec(componentWxss)
  assert.ok(pathRule, 'roadmap__path 规则必须在')
  assert.match(pathRule[1], /left:\s*calc\(var\(--cy-page-x\) \+ var\(--cy-space-5\) - 2rpx\)/,
    '竖线中线必须落在章节卡左缘(-2rpx 是 4rpx 线宽的居中补偿)')
  assert.doesNotMatch(pathRule[1], /border-(top|left|bottom|right):/,
    '竖线不能再借边框拐出上下横线(截图里的「框」)')

  const nodeRule = /\.roadmap__node\s*\{([\s\S]*?)\}/.exec(componentWxss)
  assert.ok(nodeRule, 'roadmap__node 规则必须在')
  assert.match(nodeRule[1], /grid-template-columns:\s*var\(--cy-space-4\) var\(--cy-space-4\)/,
    '圆点中线 = page-x + space-4 + space-4/2 = 与竖线/章节卡同轴')
})

test('Roadmap 提供可重复的开发者工具截图入口与组件读回', () => {
  const driver = read('scripts/_verify_play_roadmap_shots.js')

  assert.match(driver, /require\('\.\/_infra'\)/)
  assert.match(driver, /selectComponent\('#playRoadmap'\)/)
  assert.match(driver, /await captureScreenshot\(miniProgram, outputFile\)/)
  assert.match(driver, /miniProgram\.screenshot\(\{ path: file \}\)/)
  assert.match(driver, /frameDefect\(outputFile, \{ width: 624, height: 1352 \}\)/)
})
