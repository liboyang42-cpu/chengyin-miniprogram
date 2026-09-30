// 俱乐部帖子的「引用」:一条帖子可以带上一次游玩记录或一个模板,卡片形态由引用类型派生。
//
// 2026-09-10 用户拍板:一套引用机制,两种引用对象。要守住的是三条:
//   ① variant 判定复用广场那一份,俱乐部这边不许写第二套判据(两套迟早分叉);
//   ② 引用投影不出来时降级成普通图文帖,而不是渲染一张标题空着的成绩卡;
//   ③ refType 的编号就是广场的 dataType —— 自己发明一套编号,前端那套判定就得改。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const PAGE = 'pages/club/detail/index.js'

/** 只取 normalizeClubPost 与它依赖的那两个判定,不必把整页 Page() 起起来 */
function loadNormalizer() {
  const src = read(PAGE)
  const start = src.indexOf('function normalizeClubPost(')
  assert.ok(start > 0, '找不到 normalizeClubPost')
  let depth = 0
  let end = start
  for (; end < src.length; end += 1) {
    if (src[end] === '{') depth += 1
    else if (src[end] === '}') { depth -= 1; if (depth === 0) { end += 1; break } }
  }
  const sandbox = {
    module: {}, console,
    formatPostTime: (v) => String(v || ''),
    isCompletedShare: require(path.join(ROOT, 'utils/feed-play-card.js')).isCompletedShare,
    hasFeedPlayCover: require(path.join(ROOT, 'utils/feed-play-card.js')).hasFeedPlayCover,
  }
  vm.runInNewContext(src.slice(start, end) + '\nmodule.exports = normalizeClubPost;', sandbox, { filename: PAGE })
  return sandbox.module.exports
}

const normalize = loadNormalizer()
const base = { id: 1, authorMemberId: 7, nickname: '林小野', content: '外滩夜巡走完了', images: '' }

test('不带引用 = 普通图文帖,两个 variant 判定都必须是假', () => {
  const post = normalize(Object.assign({}, base), 9)
  assert.equal(post.isCompletionShare, false)
  assert.equal(post.hasPlayCover, false)
})

test('引用一次活动完赛(refType=1)渲染成漫游卡', () => {
  const post = normalize(Object.assign({}, base, {
    refType: 1, refId: 88, sportName: '外滩夜巡', sportCover: '/cover.png',
  }), 9)
  assert.equal(post.isCompletionShare, true, 'refType 就是广场的 dataType,1 + completed + sportName = 成绩帖')
})

test('引用一个模板(refType=2)渲染成模板卡,而不是漫游卡', () => {
  const post = normalize(Object.assign({}, base, {
    refType: 2, refId: 12, sportName: '梧桐区寻味', sportCover: '/t.png', isTopicTemplate: true,
  }), 9)
  assert.equal(post.isCompletionShare, false, '模板不是成绩,不能挂成漫游卡')
  assert.equal(post.hasPlayCover, true)
})

test('★被引对象已删:投影不出 sportName 时必须降级成图文帖', () => {
  const post = normalize(Object.assign({}, base, { refType: 1, refId: 88 }), 9)
  assert.equal(post.isCompletionShare, false, '标题都没有的成绩卡比没有卡更糟')
  assert.equal(post.hasPlayCover, false)
})

test('★判定必须复用广场那一份,不许在俱乐部页里再写一套', () => {
  const src = read(PAGE)
  assert.match(src, /require\('\.\.\/\.\.\/\.\.\/utils\/feed-play-card\.js'\)/,
    'variant 判定要 require 广场那份')
  assert.doesNotMatch(src, /function\s+(isCompletedShare|hasFeedPlayCover)\s*\(/,
    '俱乐部页不许自己再定义一份同名判据')
})

test('★refType 的编号必须和广场的 dataType 对齐', () => {
  const guard = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiClubController.java')
  assert.match(guard, /if \(refType != 1 && refType != 2\) return error\("暂不支持这种引用"\)/,
    '只放行 1/2:3(自由漫游成绩)全仓还没有生产者,放行等于开一个没人写得进去的入口')
  assert.match(guard, /if \(refType == null \|\| refId == null \|\| refId <= 0\) return error\("引用信息不完整"\)/,
    '半个引用(只有类型没有 ID)必须挡住,否则投影出来是一张空卡')
})

// 2026-09-11:派生出 variant 却没人渲染,是比不派生更坏的状态 —— 图廊会被
// isCompletionShare 关掉,整条帖子只剩一行文字。所以这两条盯的是「谁来画」。
test('★俱乐部帖子的成绩卡/模板卡由帖文卡组件自己画,不靠页面塞 slot', () => {
  const card = read('components/cy/post-card/index.wxml')
  assert.match(card, /<cy-completion-share-card[\s\S]*wx:if="\{\{post\.isCompletionShare\}\}"/,
    '成绩卡要在组件里按 post 字段出,页面不判')
  assert.match(card, /<cy-feed-play-card[\s\S]*wx:if="\{\{post\.hasPlayCover && !post\.isCompletionShare\}\}"/)
  const json = JSON.parse(read('components/cy/post-card/index.json'))
  assert.equal(json.usingComponents['cy-completion-share-card'], '/components/cy/completion-share-card/index')
  assert.equal(json.usingComponents['cy-feed-play-card'], '/components/cy/feed-play-card/index')
})

test('★点那张卡要跳被引主题,拿不到 topicId 才退回展开评论(不做死区)', () => {
  const wxml = read('pages/club/detail/index.wxml')
  assert.match(wxml, /bind:playdetail="onPostReference"/, '俱乐部页要接住帖文卡转出来的 playdetail')
  const src = read(PAGE)
  assert.match(src, /onPostReference\(e\)\s*\{[\s\S]*sportTopicId[\s\S]*\/pages\/topic\/index\/index\?id='/,
    '跳的是主题详情页;sportTopicId 是 cms_topic 的真实 id')
  assert.match(src, /if \(!post \|\| !post\.sportTopicId\) return this\.onToggleComments\(e\)/,
    '投影不出主题时退回展开评论,不是静默什么都不做')
})
