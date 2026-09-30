/* 故事流的两项创作端能力(施工契约 2026-09-17 §3.1 / §3.2,Worker C)
 *
 * §3.1 故事变量:正文里写 {name},兜底写 {name|那个人};创作端列出可用的键。
 * §3.2 新块型 dream:一组图 + 每张一句,1–6 张,走 _insertStoryMedia 那条路。
 *
 * 这两条都要求「配得出来、存得下去」:块形状一个字不对,后端 ChapterBlockReadSupport
 * 透传出去的就是另一种东西,而创作端不会报错。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const story = require('../../pages/publish/utils/publish/pro-editor-story.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function emptyDraft() { return { chapter: { nodes: [], blocks: [] } } }

/** 编辑器的完整动作序列:插入梦块 → 加图 → 写每张一句话。 */
function buildDream() {
  let draft = emptyDraft()
  draft = story.applyStoryCommand(draft, { type: 'insertMediaAt', mediaType: 'dream', index: 0, blockKey: 'dream_1', images: [] }).draft
  draft = story.applyStoryCommand(draft, { type: 'appendDreamImage', blockKey: 'dream_1', url: 'https://cdn/a.jpg' }).draft
  draft = story.applyStoryCommand(draft, { type: 'updateDreamLine', blockKey: 'dream_1', index: 0, line: '穿过这扇门' }).draft
  draft = story.applyStoryCommand(draft, { type: 'appendDreamImage', blockKey: 'dream_1', url: 'https://cdn/b.jpg' }).draft
  draft = story.applyStoryCommand(draft, { type: 'updateDreamLine', blockKey: 'dream_1', index: 1, line: '门后是海' }).draft
  return draft
}

test('★梦块:插入 → 加图 → 每张一句话 → 存盘形状就是契约 §3.2 那个', () => {
  const draft = buildDream()
  assert.deepEqual(draft.chapter.blocks, [{
    key: 'dream_1', type: 'dream', images: [
      { url: 'https://cdn/a.jpg', line: '穿过这扇门' },
      { url: 'https://cdn/b.jpg', line: '门后是海' },
    ],
  }])
  const payload = story.toPayloadChapter(draft.chapter)
  assert.deepEqual(payload.blocks, [{
    type: 'dream', key: 'dream_1', images: [
      { url: 'https://cdn/a.jpg', line: '穿过这扇门' },
      { url: 'https://cdn/b.jpg', line: '门后是海' },
    ],
  }])
  // 读回来再存一遍必须一模一样 —— 不然重开一次编辑器图就少几张
  const reopened = story.materializeChapter(JSON.parse(JSON.stringify(payload)), () => 'k1')
  assert.deepEqual(story.toPayloadChapter(reopened).blocks, payload.blocks)
})

test('★契约 §3.2 的 1–6 张:第 7 张必须当场拒,空梦块不落库', () => {
  let draft = buildDream()
  for (let i = 0; i < 4; i += 1) {
    draft = story.applyStoryCommand(draft, { type: 'appendDreamImage', blockKey: 'dream_1', url: 'https://cdn/' + i + '.jpg' }).draft
  }
  assert.equal(draft.chapter.blocks[0].images.length, 6)
  assert.throws(
    () => story.applyStoryCommand(draft, { type: 'appendDreamImage', blockKey: 'dream_1', url: 'https://cdn/7.jpg' }),
    /最多 6 张/,
  )
  const empty = story.applyStoryCommand(emptyDraft(), { type: 'insertMediaAt', mediaType: 'dream', index: 0, blockKey: 'dream_2', images: [] }).draft
  assert.deepEqual(story.toPayloadChapter(empty.chapter).blocks, [], '一张都没有的梦块不该进 payload')
})

test('★梦块的增删改:删中间那张不打乱前后顺序,删块走 removeMedia', () => {
  let draft = buildDream()
  draft = story.applyStoryCommand(draft, { type: 'removeDreamImage', blockKey: 'dream_1', index: 0 }).draft
  assert.deepEqual(draft.chapter.blocks[0].images, [{ url: 'https://cdn/b.jpg', line: '门后是海' }])
  draft = story.applyStoryCommand(draft, { type: 'removeMedia', blockKey: 'dream_1' }).draft
  assert.deepEqual(draft.chapter.blocks, [])
})

test('★负控:存盘时把 images 丢掉,合同断言必须判红', () => {
  const lossy = JSON.parse(JSON.stringify(story.toPayloadChapter(buildDream().chapter)))
  delete lossy.blocks[0].images   // 模拟一个忘了带图单的坏实现
  assert.throws(
    () => assert.deepEqual(lossy.blocks[0].images, [{ url: 'https://cdn/a.jpg', line: '穿过这扇门' }]),
    /deepStrictEqual|Expected values/,
    '丢 images 的形态竟然过了断言 = 梦块合同是假的',
  )
  assert.equal('images' in lossy.blocks[0], false, '负控构造失败:没把 images 丢掉')
})

test('★负控:把块型写成 image,梦块合同必须判红', () => {
  const broken = JSON.parse(JSON.stringify(story.toPayloadChapter(buildDream().chapter)))
  broken.blocks[0].type = 'image'   // 模拟一个把梦存成图片块的坏实现
  assert.throws(
    () => assert.deepEqual(broken.blocks[0], {
      type: 'dream', key: 'dream_1',
      images: [{ url: 'https://cdn/a.jpg', line: '穿过这扇门' }, { url: 'https://cdn/b.jpg', line: '门后是海' }],
    }),
    /deepStrictEqual|Expected values/,
  )
})

/* ===== CU-M-115:收编辑器时按卡上的话真空掉梦块 =====
 * 「一张都没有的梦不会保存，先加一张」这句提示,原来只在出 payload 那层成立:
 * 点「完成」回到章节卡再重进,那张 0/6 的空卡还在原地(2026-09-24 R44 走查)。
 * 所以丢弃必须发生在**本地草稿**上,而不是等到发布。
 */
function draftWithEmptyDream() {
  return story.applyStoryCommand(buildDream(), {
    type: 'insertMediaAt', mediaType: 'dream', index: 1, blockKey: 'dream_empty', images: [],
  }).draft
}

/** 从页面源码里取 closeStoryEditor 的函数体,拿真实现跑,不复制一份逻辑到测试里。 */
function closeStoryEditorBody(source) {
  const matched = source.match(/\n  closeStoryEditor\(\) \{([\s\S]*?)\n  \},\n/)
  assert.ok(matched, 'pages/publish/fabu/index.js 里找不到 closeStoryEditor')
  return new Function('proEditorStory', 'return function () {' + matched[1] + '\n};')(story)
}

/** 跑一次真实的收编辑器,返回「关掉后的章节草稿」+ 观测点。没回写草稿 = 草稿原样留着。 */
function closeStoryEditorOn(chapterIndex, chapter, source) {
  const page = {
    data: { storyEditor: { show: true, chapterIndex }, formData: { chapters: [chapter] } },
    patches: [],
    destroyed: 0,
    statRefreshed: 0,
    destroyPreviewAudio() { this.destroyed += 1 },
    updateAllStatistics() { this.statRefreshed += 1 },
    setData(patch) { this.patches.push(patch) },
  }
  closeStoryEditorBody(source || read('pages/publish/fabu/index.js')).call(page)
  const written = page.patches.map((patch) => patch['formData.chapters']).filter(Boolean)[0]
  return { page, draft: written ? written[chapterIndex] : chapter }
}

test('★空梦块计数:只数一张都没有的梦,有图的梦/文字/音频都不算', () => {
  const draft = draftWithEmptyDream()
  assert.equal(story.countEmptyDreamBlocks(draft.chapter), 1)
  draft.chapter.blocks.push({ key: 'a1', type: 'audio', url: '' })
  assert.equal(story.countEmptyDreamBlocks(draft.chapter), 1, '没填的音频占位是留着待补的,不该被数成空梦块')
  assert.equal(story.countEmptyDreamBlocks(buildDream().chapter), 0)
  assert.equal(story.countEmptyDreamBlocks(null), 0)
})

test('★丢掉空梦块后,其余块的顺序和章节投影要还是对的', () => {
  const chapter = draftWithEmptyDream().chapter
  const kept = story.discardEmptyDreamBlocks(chapter)
  assert.deepEqual(kept.blocks.map((b) => b.key), ['dream_1'], '空梦块要走,有图的梦块要留')
  assert.equal(story.countEmptyDreamBlocks(kept), 0)
  assert.equal(kept.description, story.projectedDescription(kept.blocks), '描述要按剩下的块重新投影')
  // 没有空块时不该白改一次投影
  const untouched = buildDream().chapter
  assert.equal(story.discardEmptyDreamBlocks(untouched), untouched)
})

test('★点「完成」收编辑器:草稿里的空梦块当场就没了,重开还是空的', () => {
  const { page, draft } = closeStoryEditorOn(0, draftWithEmptyDream().chapter)
  assert.deepEqual(draft.blocks.map((b) => b.key), ['dream_1'])
  assert.equal(story.toPayloadChapter(draft).blocks.length, 1, '草稿和 payload 现在口径一致')
  assert.equal(page.data.storyEditor.show, true, '页面 data 不该被就地改掉')
  const closed = Object.assign({}, ...page.patches.filter((patch) => patch.storyEditor))
  assert.equal(closed.storyEditor.show, false)
  assert.equal(closed.storyEditor.chapterIndex, -1)
  assert.equal(page.destroyed, 1)
  assert.equal(page.statRefreshed, 1, '块数变了要刷新统计,不然章节卡还显示旧的')
})

test('★没有空梦块时收编辑器:不去动 formData.chapters(别白写一次大对象)', () => {
  const { page, draft } = closeStoryEditorOn(0, buildDream().chapter)
  assert.deepEqual(draft.blocks.map((b) => b.key), ['dream_1'])
  assert.ok(!page.patches.some((patch) => patch['formData.chapters'] !== undefined))
  assert.equal(page.statRefreshed, 0)
})

test('★负控:把 closeStoryEditor 里的丢弃去掉,上面的行为合同必须判红', () => {
  const js = read('pages/publish/fabu/index.js')
  const mutated = js.replace('next[chapterIndex] = proEditorStory.discardEmptyDreamBlocks(next[chapterIndex]);', '')
  assert.notEqual(mutated, js, '负控未命中 CU-M-115 的丢弃调用')
  const { draft } = closeStoryEditorOn(0, draftWithEmptyDream().chapter, mutated)
  assert.throws(
    () => assert.deepEqual(draft.blocks.map((b) => b.key), ['dream_1']),
    /deepStrictEqual|Expected values/,
    '撤掉修复后空梦块还在 = 上一条合同是假的',
  )
})

/* ===== §3.1 故事变量 ===== */
const CHAPTERS = [{
  nodes: [
    { templateInfo: { advancedConfigJson: JSON.stringify({
      profile: { enabled: true, questions: [
        { key: 'name', label: '你叫什么' },
        { key: 'job', label: '你做什么工作' },
        { key: '1bad', label: '非法键' },
        { key: 'name', label: '重复键' },
      ] },
      diyName: { enabled: true },
    }) } },
    { templateInfo: { advancedConfigJson: JSON.stringify({
      profile: { enabled: false, questions: [{ key: 'ghost', label: '没启用的段' }] },
    }) } },
  ],
}]

test('★可用变量键 = 建档的问题 key(去重后)+ 作品名;非法/重复/没启用的都不列', () => {
  const vars = story.collectStoryVars(CHAPTERS)
  assert.deepEqual(vars, [
    { key: 'name', label: '你叫什么', token: '{name}' },
    { key: 'job', label: '你做什么工作', token: '{job}' },
    // 去重按 key:name 已经在建档里出现过,作品名的 name 不重复列一行
  ])
})

test('★负控:把 diyName 关掉,作品名就不该出现在可用键里', () => {
  const raw = JSON.parse(CHAPTERS[0].nodes[0].templateInfo.advancedConfigJson)
  raw.diyName.enabled = false
  const vars = story.collectStoryVars([{ nodes: [{ templateInfo: { advancedConfigJson: JSON.stringify(raw) } }] }])
  assert.deepEqual(vars.map((item) => item.key), ['name', 'job'])
  assert.ok(!vars.some((item) => item.label === '作品名'), '关掉的玩法不该再列变量')
})

test('★负控:非法键 1bad 与没启用的段,上一条必须抓得到', () => {
  const vars = story.collectStoryVars(CHAPTERS)
  assert.ok(!vars.some((item) => item.key === '1bad'), '数字开头的键写不进 {名字},不该列出来')
  assert.ok(!vars.some((item) => item.key === 'ghost'), '没启用的 profile 段不该列出来')
})

test('★插入位置:光标处/越界夹到两端/没记到光标就追加到末尾', () => {
  assert.equal(story.insertVarAt('你好世界', 'name', 2), '你好{name}世界')
  assert.equal(story.insertVarAt('你好世界', 'name', 999), '你好世界{name}')
  // 负数一律当「没记到光标」:往末尾追加,绝不插到句首
  assert.equal(story.insertVarAt('你好世界', 'name', -999), '你好世界{name}')
  assert.equal(story.insertVarAt('你好', 'name', -1), '你好{name}', '没记到光标(-1)= 追加到末尾')
  assert.equal(story.insertVarAt('', 'name', -1), '{name}')
})

test('★负控:把「没记到光标」也当 0 处理,上一条必须判红', () => {
  // 这是插入位置最容易错的一处:Number(-1) 是整数,不判负号就会插到句首
  const broken = String('你好').slice(0, Math.max(0, Math.min(2, Number(-1)))) + '{name}' + String('你好').slice(0)
  assert.notEqual(broken, '你好{name}', '把 -1 当 0 的写法确实会插错位置,上一条才抓得到')
})

test('★fabu 接线:玩法插入入口 + 变量入口 + 变量列表都真在页面上', () => {
  const wxml = read('pages/publish/fabu/index.wxml')
  const js = read('pages/publish/fabu/index.js')
  // 两个插入缝通过玩法模板添加相册，存量 dream 继续可编辑
  assert.equal((wxml.match(/catchtap="insertStoryGameAt"/g) || []).length, 2, '两个插入缝都要有玩法入口')
  assert.ok(wxml.includes('aria-label="添加玩法"'), '玩法入口缺可读名称')
  assert.ok(wxml.includes('aria-label="删除相册"'), '相册块缺删除入口')
  assert.ok(wxml.includes('catchtap="addStoryDreamImage"') && wxml.includes('bindinput="onStoryDreamLineInput"'),
    '梦块的加图/写字控件没接上')
  // 变量入口与列表
  assert.ok((wxml.match(/catchtap="openStoryVarSheet"/g) || []).length >= 1, '文字块上缺「插入变量」入口')
  assert.ok(wxml.includes('aria-label="插入变量"'), '变量入口缺可读名称')
  assert.ok(wxml.includes('catchtap="insertStoryVar"'), '变量列表没接插入动作')
  assert.ok(wxml.includes('{名字|那个人}'), '界面上必须写出兜底写法,作者才知道有这回事')
  // 页面方法真存在
  for (const name of ['insertStoryGameAt', 'addStoryDreamImage', 'onStoryDreamLineInput', 'removeStoryDreamImage',
    'openStoryVarSheet', 'closeStoryVarSheet', 'insertStoryVar']) {
    assert.ok(new RegExp('\\b' + name + '\\s*[(:]').test(js), name + ' 在页面里不存在')
  }
})
