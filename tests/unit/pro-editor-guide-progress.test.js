// 创作引导卡四步完成态(guide-progress)。只走 guideStepsOf 这一个 interface。
//
// 承重不变量:
//  - 空草稿四步全 false(负控:引导卡不许对空稿报「已完成」)
//  - 逐步喂数据逐步变 true,且互不串台(封面不点亮 research,介绍不点亮 photo)
//  - story 复用 hasRealStory 口径:占位文案「暂无描述」不算真实剧情
//  - allDone 只在四步全 true 时为 true
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { guideStepsOf } = require('../../utils/publish/guide-progress.js')

const node = (over) => Object.assign({
  name: '邻里苑', longitude: '121.38', latitude: '31.11',
}, over)

test('空草稿四步全 false(负控)', () => {
  const steps = guideStepsOf({ chapters: [] })
  assert.deepEqual(steps, { pick: false, photo: false, research: false, story: false, allDone: false })
})

test('formData 为空/未传时不炸且全 false', () => {
  assert.equal(guideStepsOf(null).allDone, false)
  assert.equal(guideStepsOf({}).pick, false)
})

test('只有空章节(无节点)不算选点完成', () => {
  const steps = guideStepsOf({ chapters: [{ name: '第1章', nodes: [] }] })
  assert.equal(steps.pick, false)
})

test('逐步喂数据逐步变 true', () => {
  // ① 选点:有节点
  let draft = { chapters: [{ name: '第1章', nodes: [node()] }] }
  let steps = guideStepsOf(draft)
  assert.deepEqual(steps, { pick: true, photo: false, research: false, story: false, allDone: false })

  // ② 拍照:竖版封面
  draft.imgUrl = 'https://x/cover.png'
  steps = guideStepsOf(draft)
  assert.deepEqual(steps, { pick: true, photo: true, research: false, story: false, allDone: false })

  // ③ 查资料:节点介绍文案
  draft.chapters[0].nodes[0].description = '这里是石库门里弄,建于 1925 年'
  steps = guideStepsOf(draft)
  assert.deepEqual(steps, { pick: true, photo: true, research: true, story: false, allDone: false })

  // ④ 写故事:章节剧情 blocks
  draft.chapters[0].blocks = [{ type: 'text', content: '故事从弄堂口开始' }]
  steps = guideStepsOf(draft)
  assert.deepEqual(steps, { pick: true, photo: true, research: true, story: true, allDone: true })
})

test('拍照:节点配图(无封面)也算完成', () => {
  const steps = guideStepsOf({ chapters: [{ nodes: [node({ imgUrl: 'https://x/a.png,https://x/b.png' })] }] })
  assert.equal(steps.photo, true)
})

test('互不串台:封面不点亮查资料,介绍不点亮拍照', () => {
  const coverOnly = guideStepsOf({ imgUrl: 'https://x/c.png', chapters: [{ nodes: [node()] }] })
  assert.equal(coverOnly.research, false, '只有封面时 research 必须还是 false')

  const descOnly = guideStepsOf({ chapters: [{ nodes: [node({ description: '有介绍' })] }] })
  assert.equal(descOnly.photo, false, '只有介绍时 photo 必须还是 false')
})

test('占位剧情「暂无描述」不算写故事完成(hasRealStory 同口径)', () => {
  const steps = guideStepsOf({ chapters: [{ description: '暂无描述', nodes: [node()] }] })
  assert.equal(steps.story, false)
})

test('无 blocks 时 description 真剧情算写故事完成', () => {
  const steps = guideStepsOf({ chapters: [{ description: '这一章讲邻里的故事', nodes: [] }] })
  assert.equal(steps.story, true)
})

test('空白字符串不算完成(封面/介绍都 trim)', () => {
  const steps = guideStepsOf({ imgUrl: '   ', chapters: [{ nodes: [node({ description: '  ' })] }] })
  assert.equal(steps.photo, false)
  assert.equal(steps.research, false)
})
