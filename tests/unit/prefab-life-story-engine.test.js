const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const story = require('../../subpackagePrefab/story-engine.js')
const ROOT = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8')

function storage(initial) {
  const values = Object.assign({}, initial)
  return {
    values,
    getStorageSync(key) { return values[key] },
    setStorageSync(key, value) { values[key] = value },
    removeStorageSync(key) { delete values[key] },
  }
}

test('预制人生按 HTML 的序章到分支图顺序推进', () => {
  let state = story.createState()
  const visited = [state.scene]
  while (state.scene !== 'flow') {
    state = story.advance(state)
    visited.push(state.scene)
  }

  assert.deepEqual(visited, [
    'prologue', 'register', 'boot', 'walk', 'hall', 'birth', 'dream1',
    'learning', 'dream2', 'career', 'work', 'dream3', 'flow',
  ])
})

test('选择与照片进入同一份可恢复档案', () => {
  let state = story.createState()
  state = story.patch(state, { profile: { name: '阿岚', dream: '看见窗外' } })
  state = story.choose(state, 'first', 1)
  state = story.photo(state, 'window', 'wxfile://window.jpg')
  state = story.setStep(state, 2)
  state = story.observe(state, '展示馆的窗', '一个老人在等公交')
  state = story.gain(state, { luck: 1, dreams: 2, thought: 'afternoon' })

  assert.equal(state.profile.name, '阿岚')
  assert.equal(state.picks.first, 1)
  assert.equal(state.photos.window, 'wxfile://window.jpg')
  assert.equal(state.luck, 3)
  assert.equal(state.step, 2)
  assert.equal(story.photoCount(state), 1)
  assert.equal(state.dreams, 2)
  assert.deepEqual(state.thoughts, ['afternoon'])
  assert.deepEqual(state.observations, [{ where: '展示馆的窗', text: '一个老人在等公交' }])
  assert.deepEqual(story.restore(JSON.stringify(state)), state)
})

test('章内步骤推进和检定结果可重复验证', () => {
  let state = story.setStep(story.createState(), 3)
  state = story.advance(state)
  const passed = story.check(state, 'rule', 9, [3, 4])
  const failed = story.check(state, 'heart', 9, [1, 2])

  assert.equal(state.step, 0)
  assert.deepEqual(passed, { state, dice: [3, 4], roll: 7, score: 9, ok: true })
  assert.equal(failed.ok, false)
})

test('出生登记按 HTML 把出生地与梦想各转成一次能力成长', () => {
  const base = story.createState()
  const precise = story.applyProfile(base, { place: '想不起来', dream: '宇航员' })
  const heart = story.applyProfile(base, { place: '海边小镇', dream: '画家' })

  assert.deepEqual(precise.skills, { rule: 2, window: 2, heart: 2, precision: 3 })
  assert.deepEqual(heart.skills, { rule: 2, window: 3, heart: 3, precision: 1 })
})

test('旧存档升级时保留剧情并补齐新字段', () => {
  const restored = story.restore(JSON.stringify({
    version: 1,
    scene: 'work',
    profile: { name: '旧玩家' },
    hp: 8,
    luck: 2,
    dreams: 2,
    thoughts: [],
    picks: {},
    photos: {},
    job: '设计师',
  }))

  assert.equal(restored.version, 2)
  assert.equal(restored.scene, 'work')
  assert.equal(restored.step, 0)
  assert.equal(restored.profile.name, '旧玩家')
  assert.equal(restored.skills.rule, 2)
})

test('账号、活动与主题三层隔离，重启后不串姓名、照片和进度', () => {
  const local = storage()
  const activityScope = { activityId: 123, memberId: 7 }
  const topicScope = { topicId: 123, memberId: 7 }
  const otherMemberScope = { activityId: 123, memberId: 8 }
  const activity = story.photo(story.patch(story.createState(), {
    profile: { name: '活动玩家' }, scene: 'work',
  }), 'hall', 'wxfile://activity.jpg')
  const topic = story.photo(story.patch(story.createState(), {
    profile: { name: '主题玩家' }, scene: 'learning',
  }), 'hall', 'wxfile://topic.jpg')

  story.saveArchive(local, activityScope, activity)
  story.saveArchive(local, topicScope, topic)

  assert.equal(story.loadArchive(local, activityScope).profile.name, '活动玩家')
  assert.equal(story.loadArchive(local, activityScope).photos.hall, 'wxfile://activity.jpg')
  assert.equal(story.loadArchive(local, activityScope).scene, 'work')
  assert.equal(story.loadArchive(local, topicScope).profile.name, '主题玩家')
  assert.equal(story.loadArchive(local, topicScope).photos.hall, 'wxfile://topic.jpg')
  assert.equal(story.loadArchive(local, topicScope).scene, 'learning')
  assert.deepEqual(story.loadArchive(local, otherMemberScope), story.createState())
  assert.ok(local.values.prefab_life_v3_member_7_activity_123)
  assert.ok(local.values.prefab_life_v3_member_7_topic_123)
})

test('来源不明的 v1 旧档不挂到当前会话，也不带入可同步的照片或完成状态', () => {
  const legacy = story.photo(story.patch(story.createState(), {
    profile: { name: '不明玩家' }, scene: 'flow',
  }), 'hall', 'wxfile://unknown.jpg')
  const local = storage({ prefab_life_v1_123: JSON.stringify(legacy) })

  const activity = story.loadArchive(local, { activityId: 123, memberId: 7 })
  const topic = story.loadArchive(local, { topicId: 123, memberId: 7 })

  assert.deepEqual(activity, story.createState())
  assert.deepEqual(topic, story.createState())
  assert.equal(local.values.prefab_life_v3_member_7_activity_123, undefined)
  assert.equal(local.values.prefab_life_v3_member_7_topic_123, undefined)
})

test('损坏的本地进度不会把玩家锁在空白页', () => {
  assert.deepEqual(story.restore('{broken'), story.createState())
  assert.deepEqual(story.restore(JSON.stringify({ scene: 'unknown' })), story.createState())
})

test('票夹里的预制人生直达独立游戏页，不经过漫游壳', () => {
  const app = JSON.parse(read('app.json'))
  const signup = read('subpackageMember/signup/index.js')
  const genericPlay = read('pages/play/index.js')
  const game = read('subpackagePrefab/index.js')
  const page = read('subpackagePrefab/index.wxml')
  const pkg = app.subPackages.find((item) => item.root === 'subpackagePrefab')

  assert.deepEqual(pkg.pages, ['index'])
  assert.match(signup, /\/subpackagePrefab\/index\?/)
  assert.match(genericPlay, /wx\.redirectTo\(\{ url: '\/subpackagePrefab\/index\?'/)
  assert.match(game, /story\.loadArchive\(wx, this\._archive\)/)
  assert.match(game, /story\.saveArchive\(wx, nextArchive, this\._state\)/)
  assert.doesNotMatch(game, /prefab_life_v1_/)
  assert.match(page, /class="radar"[^>]*bindtap="toggleMap"/)
  assert.match(page, /class="story-ring"[^>]*bindtap="toggleMap"/)
  assert.match(page, /是你选择的命运/)
  assert.match(page, /bindtouchstart="wakeStart"/)
  assert.match(page, /data-key="{{item}}" bindtap="bootKey"/)
  assert.match(page, /PRESET-LIFE BIOS v1\.0/)
  assert.match(page, /registerStep == 0/)
  assert.match(page, /registerStep == 4/)
  assert.match(page, /teacherSeconds/)
  assert.match(page, /保持 3 秒/)
  assert.match(page, /check\.dice\[0\]/)
  assert.match(page, /check\.dice\[1\]/)
  assert.doesNotMatch(page, /bindinput="onBootInput"/)
  assert.doesNotMatch(page, /<swiper/)
  assert.doesNotMatch(page, /开始主题|出发前|章节数|已完成|游戏数/)
})

test('HTML 原型里的现场玩法都接了真实动作，不是静态卡片', () => {
  const js = read('subpackagePrefab/index.js')
  const page = read('subpackagePrefab/index.wxml')

  for (const action of [
    'standStart', 'windowPhoto', 'submitNote', 'quizPick', 'submitCount',
    'teacherPick', 'openStickerMap', 'placeSticker', 'careerPick', 'bossPick',
    'phonePhoto',
  ]) assert.match(page, new RegExp('bind(?:tap|touchstart)="' + action + '"'))
  assert.doesNotMatch(page, /bindtap="likeMapNote"/)
  assert.match(js, /request\('\/api\/play\/arrive'/)
  assert.match(js, /request\('\/api\/play\/photo'/)
  assert.match(js, /request\('\/api\/play\/nodes'/)
  assert.match(js, /story\.setStep\(this\._state, 1\)/)
  assert.doesNotMatch(js, /_sync\(\{ sceneStep:/)
})

test('HTML 的 36 张照片全部进入专属分包且分包小于 2 MiB', () => {
  const dir = path.join(ROOT, 'subpackagePrefab/assets')
  const assets = fs.readdirSync(dir).filter((name) => name.endsWith('.webp'))
  const bytes = assets.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0)

  assert.equal(assets.length, 36)
  assert.ok(bytes < 2 * 1024 * 1024)
})
