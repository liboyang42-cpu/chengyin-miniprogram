// 2026-09-07 对真稿(主稿 ku2oaN9 页「TE · Screens」= 4843:13332)走查后的四条整改。
// 稿是逐身份画的:玩家 P1–P12 / 俱乐部 C1–C12 / 商家 M1–M12,差异处稿上就有 role-badge。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const storyFlow = require('../../pages/publish/utils/publish/pro-editor-story.js')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const WXML = read('pages/publish/fabu/index.wxml')
const STEP3 = read('pages/publish/fabu/step3.wxml')

const chapter = () => ({ name: '第1章', blocks: [{ key: 't1', type: 'text', content: '雨夜' }], nodes: [] })
const apply = (ch, cmd) => storyFlow.applyStoryCommand({ chapter: ch, pendingMaterials: [] }, cmd)
let keyN = 0
const makeKey = () => 'k' + (++keyN)

// ── A1 音频块的空态 ─────────────────────────────────────
test('音频可以先落一个空块(稿 P8 是两步:先插块,再点它上传)', () => {
  const r = apply(chapter(), { type: 'insertMediaAt', mediaType: 'audio', index: 0, blockKey: 'a1', url: '' })
  const block = r.draft.chapter.blocks.find((b) => b.key === 'a1')
  assert.ok(block, '空音频块没落下来 —— 那点「音频」就等于什么都没发生')
  assert.equal(block.url, '')
})

test('★负控:图片没有空态,空 url 仍必须当场被拒', () => {
  assert.throws(
    () => apply(chapter(), { type: 'insertMediaAt', mediaType: 'image', index: 0, blockKey: 'i1', url: '  ' }),
    /媒体块缺少地址/,
    '图片放行空 url = 落一个点不开的空图壳',
  )
})

test('fillMedia 把 url 与文件名回填到那个空块上', () => {
  let ch = apply(chapter(), { type: 'insertMediaAt', mediaType: 'audio', index: 0, blockKey: 'a1', url: '' }).draft.chapter
  ch = apply(ch, { type: 'fillMedia', blockKey: 'a1', url: 'https://cdn/x.mp3', name: '钟楼旁白.mp3' }).draft.chapter
  const block = ch.blocks.find((b) => b.key === 'a1')
  assert.equal(block.url, 'https://cdn/x.mp3')
  assert.equal(block._name, '钟楼旁白.mp3')
})

test('★负控:fillMedia 也不接受空 url —— 空块可以留在编辑器里,但不许被「填」成空', () => {
  const ch = apply(chapter(), { type: 'insertMediaAt', mediaType: 'audio', index: 0, blockKey: 'a1', url: '' }).draft.chapter
  assert.throws(() => apply(ch, { type: 'fillMedia', blockKey: 'a1', url: '' }), /媒体块缺少地址/)
})

test('没选文件的空音频块不上送 —— 它只是编辑器里的占位', () => {
  const ch = apply(chapter(), { type: 'insertMediaAt', mediaType: 'audio', index: 0, blockKey: 'a1', url: '' }).draft.chapter
  // 走 _storyPayloadChapter 的真实链路 materializeChapter→toPayloadChapter,
  // 而不是直调 toPayloadChapter —— 直调曾绕过 materializeChapter 对空 url 的 throw,契约假绿。
  const payload = storyFlow.toPayloadChapter(storyFlow.materializeChapter(ch, makeKey))
  assert.equal(payload.blocks.filter((b) => b.type === 'audio').length, 0,
    '空音频块上送 = 后端存一条 url 为空的块,玩家端读到一个不响的音频')
  assert.ok(payload.blocks.some((b) => b.type === 'text'), '把别的块也一起过滤掉了')
})

// ── A1' 空音频占位块必须能过 materializeChapter(#1047 崩点)────────────────
// 之前的合同只走 insertMediaAt / fillMedia / toPayloadChapter,唯独不走 materializeChapter ——
// 而草稿恢复(_applyDraftEnvelope → _materializeCityStoryChapters)与重开编辑器(openStoryEditor)
// 走的正是 materializeChapter。它对空 url 一律 throw,导致带空音频占位的草稿一恢复就未捕获崩掉。
test('★回归:带空音频占位块的章节能被 materializeChapter 原样重建(草稿恢复/重开编辑器走这条)', () => {
  const draft = apply(chapter(), { type: 'insertMediaAt', mediaType: 'audio', index: 0, blockKey: 'a1', url: '' }).draft.chapter
  let ch
  assert.doesNotThrow(() => { ch = storyFlow.materializeChapter(draft, makeKey) }, '空音频占位块不该让 materialize 抛错')
  const block = ch.blocks.find((b) => b.type === 'audio')
  assert.ok(block, '空音频占位块被 materialize 丢掉了 —— 用户刚插的占位在重开后凭空消失')
  assert.equal(block.url, '', '占位块的空 url 要原样保留,后续 fillMedia 才有块可填')
})

test('★负控:图片没有空态,空 url 的图片块过 materialize 仍必须抛错', () => {
  const bad = { name: '第1章', blocks: [{ key: 'i1', type: 'image', url: '' }], nodes: [] }
  assert.throws(() => storyFlow.materializeChapter(bad, makeKey), /媒体块缺少地址/,
    '图片空块放行 = 重开后落一个点不开的空图壳')
})

test('materialize 对有 url 的音频块仍派生文件名(占位块才不派生)', () => {
  const src = { name: '第1章', blocks: [{ key: 'a1', type: 'audio', url: 'https://cdn/钟楼.mp3' }], nodes: [] }
  const block = storyFlow.materializeChapter(src, makeKey).blocks.find((b) => b.type === 'audio')
  assert.ok(block._name && block._name.length > 0, '有 url 的音频块要能派生出文件名,别显示成"音频片段"')
})

// ── A2 / A4 / C 三条身份与入口 ──────────────────────────
test('城市定向的章节卡必须有「编辑章节」入口(稿 P2/C2 是两颗并排)', () => {
  const cta = /<view class="slopes-chapter-cta">[\s\S]*?<\/view>/.exec(WXML)
  assert.ok(cta, '.slopes-chapter-cta 不见了')
  assert.match(cta[0], /catchtap="openStoryEditor"/)
  assert.match(cta[0], /catchtap="showEditChapter"/,
    '城市定向档只有「编辑故事流」一颗时,章节设置在卡上没有任何入口')
})

test('商家承接只有俱乐部主理人能开(2026-09-07 用户裁决 + 0811 后端同型闸)', () => {
  assert.match(WXML, /<view class="chapter-recruit" wx:if="\{\{merchantPoolEditable\}\}">/,
    '这一段没有身份闸,玩家和商家也能开,开了要到发布时才被后端 resolveMerchantPoolFlag 拒')
})

test('商家的票务页没有自玩票整段(稿 M11)', () => {
  const idx = STEP3.indexOf('<view class="pd-section-title">自玩票</view>')
  assert.ok(idx > 0, '自玩票段不见了')
  const guard = STEP3.slice(Math.max(0, idx - 400), idx)
  assert.match(guard, /operationScope !== 'MERCHANT'/,
    '自玩票段没有身份闸 —— 商家发的是自由探索、卖的是承接位,这一段对它没有意义')
})

// ── 商家承接的身份闸,判据本身也要有合同 ─────────────────
// 2026-09-07 实拍走查时 merchantPoolEditable 在三种身份下都读成 true —— 那是**没登录**
// (角色快照拿不到)时的 fail-open,不是闸坏了。真机上登录后快照会到,非主理人转 false。
// 光靠 DevTools 走查证不了这一条,所以在这里把判据本身钉住。
test('merchantPoolEditable 的判据:有快照就只认俱乐部主理人,没快照才 fail-open', () => {
  const js = read('pages/publish/fabu/index.js')
  const body = /_syncMerchantPoolEligibility\(\)\s*\{([\s\S]*?)\n  \},/.exec(js)
  assert.ok(body, '_syncMerchantPoolEligibility 不见了')
  assert.match(body[1], /!roleGuard\.hasSnapshot\(\)\s*\|\|\s*roleGuard\.isClubLeader\(\)/,
    '判据必须是「没快照 或 是主理人」—— 少了 hasSnapshot 那半边,弱网首帧会把存量主题的招商静默关掉')
  assert.match(body[1], /formData\.openMerchantPool.*=\s*false|'formData\.openMerchantPool'\]\s*=\s*false/s,
    '判成不可编辑时必须同时把已开的开关压回 false,否则界面没了、值还在,发布时被后端拒')
})

test('★负控:判据退成只看 isClubLeader,合同必须判红', () => {
  const fake = "_syncMerchantPoolEligibility() {\n    const editable = roleGuard.isClubLeader();\n  },"
  assert.doesNotMatch(fake, /!roleGuard\.hasSnapshot\(\)\s*\|\|\s*roleGuard\.isClubLeader\(\)/,
    '负控本身写错了:这段假代码不该匹配上正确判据')
})
