'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { SHOTS } = require('../../scripts/shot-matrix')
const FIXTURES = require('../../scripts/fixtures.json')
const SELECTORS = require('../../scripts/selectors.json')

function shot(id) {
  const value = SHOTS.find((item) => item.id === id)
  assert.ok(value, `缺少截图状态 ${id}`)
  return value
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function fixture(id) {
  const value = FIXTURES[id]
  assert.ok(value, `缺少生成后的 fixture ${id}`)
  return value
}

function assertRewardStrings(data, label) {
  assert.ok(Array.isArray(data && data.rewards) && data.rewards.length > 0,
    `${label} 缺少 rewards`)
  assert.ok(data.rewards.every(hasText),
    `${label} rewards 只能是可见字符串，不能把对象交给 WXML`)
}

function assertTopicBody(detail, route, label) {
  assert.ok(hasText(detail && detail.info && detail.info.imgUrl), `${label} 缺少首屏封面`)
  assert.ok(hasText(detail && detail.info && detail.info.name), `${label} 缺少主题名称`)
  assert.ok(Array.isArray(route && route.info && route.info.chaptersList)
    && route.info.chaptersList.some((chapter) => Array.isArray(chapter.nodes) && chapter.nodes.length > 0),
  `${label} 缺少路线正文`)
}

test('B30 正常活动详情 fixture 必须注入可直接渲染的奖励文字', () => {
  const data = shot('B30').data
  const generated = fixture('B30').data
  assertRewardStrings(data, 'B30 矩阵')
  assertRewardStrings(generated, 'B30 生成后的 fixture')
})

test('A02 首页首载 fixture 必须按页面嵌套 loading 合同点亮同构骨架', () => {
  const fixture = FIXTURES.A02
  assert.ok(fixture && fixture.data)
  assert.equal(typeof fixture.data.listLoading, 'object', 'listLoading 是分区对象，不能注入布尔值')
  assert.equal(fixture.data.listLoading.recommendedTopicList, true)
  assert.equal(fixture.data.listLoading.nearbyActivityList, true)
  assert.equal(SELECTORS.A02.selector, 'cy-skeleton')

  const mutant = JSON.parse(JSON.stringify(fixture))
  mutant.data.listLoading = true
  assert.throws(() => {
    assert.equal(typeof mutant.data.listLoading, 'object', '嵌套 loading 被降成布尔值必须判红')
  }, /必须判红/)
})

test('C23/C24 正常主题 fixture 必须包含首屏与路线正文，不能只把 topicLoaded 改成 true', () => {
  const detailShot = shot('C23')
  const routeShot = shot('C24')
  const detail = detailShot.data
  const route = routeShot.data
  const generatedDetail = fixture('C23').data
  const generatedRoute = fixture('C24').data

  assertTopicBody(detail, route, 'C23/C24 矩阵')
  assertTopicBody(generatedDetail, generatedRoute, 'C23/C24 生成后的 fixture')

  assert.ok(hasText(detail.info && detail.info.subtitle), 'C23 缺少详情摘要')
  assert.ok(Number.isFinite(routeShot.scrollTop) && routeShot.scrollTop > 0,
    'C24 必须滚到路线正文，不能只拍首屏上的吸顶 tabs')
  for (const generated of [generatedDetail, generatedRoute]) {
    assert.deepEqual(generated.detailFacts, [], '主题 fixture 不得凭空生成示例指标')
    assert.deepEqual(generated.ratingRows, [], '主题 fixture 不得凭空生成示例评价')
    assert.deepEqual(generated.starsBox, [], '主题 fixture 不得凭空生成示例星级')
    assert.deepEqual(generated.uploadImages, [], '主题 fixture 不得凭空生成示例上传图')
  }
})

test('P0 页面必须使用正文强锚点，弱页面壳不得作为通过条件', () => {
  assert.equal(shot('A42').fixtureTarget, '#profile', 'A42 必须把断言作用域锚到 cy-profile')
  assert.equal(fixture('A42').target, '#profile', 'A42 生成后的 fixture 必须保留组件作用域')
  assert.equal(SELECTORS.A42.selector, '.pc-page')
  assert.equal(SELECTORS.A42.weak, undefined)
  assert.match(SELECTORS.C23.selector, /topic-hero-meta/)
  assert.equal(SELECTORS.C23.weak, undefined)
  assert.match(SELECTORS.C24.selector, /chart-tit/)
  assert.match(SELECTORS.C24.selector, /topic-list \.li/)
  assert.equal(SELECTORS.C24.viewportSelector, '.topic-list .li')
  assert.equal(SELECTORS.C24.weak, undefined)
})

test('C24 scrolled 证据必须回读路线正文确实进入截图视口', () => {
  const runtime = fs.readFileSync(path.resolve(__dirname, '../../scripts/_shot_full_matrix.js'), 'utf8')
  assert.match(runtime, /want\.viewportSelector/)
  assert.match(runtime, /bottom\s*>\s*0\s*&&\s*top\s*<\s*viewportHeight/)
  assert.match(runtime, /viewportAnchor\s*=\s*\{[^}]*visible/)

  const mutant = { top: 1400, bottom: 1500, viewportHeight: 1352 }
  assert.equal(mutant.bottom > 0 && mutant.top < mutant.viewportHeight, false,
    '屏外正文必须让视口证据判红')
})

test('fixture 生成是单向且可解释的：不自读产物、不注入 dropped 键、不继承陈旧 target', () => {
  const generator = fs.readFileSync(path.resolve(__dirname, '../../scripts/_gen_fixtures.js'), 'utf8')
  assert.doesNotMatch(generator, /readFileSync\(OUTPUT/, '生成器不得把 fixtures.json 自己作为下一轮输入')

  for (const item of SHOTS.filter((value) => !value.blocked)) {
    const generated = fixture(item.id)
    const intersection = Object.keys(generated.data || {}).filter((key) => (generated.dropped || []).includes(key))
    assert.deepEqual(intersection, [], `${item.id}: data 与 dropped 不能同时声明 ${intersection.join(',')}`)
    // deepEqual:target 是对象,strictEqual 比引用 —— 只有生成物陈旧(target 缺失)时才会
    // 意外变绿,那正是本条要防的「继承陈旧 target」。
    assert.deepEqual(generated.target, item.fixtureTarget, `${item.id}: target 必须只来自 shot-matrix`)
  }
})

test('fixtureVerified 只能标记当前页面真实消费的键', () => {
  const stale = SHOTS
    .filter((item) => item.fixtureVerified && !item.blocked)
    .filter((item) => (fixture(item.id).dropped || []).length > 0)
    .map((item) => `${item.id}:${fixture(item.id).dropped.join(',')}`)

  assert.deepEqual(stale, [],
    'fixtureVerified 不得继续背书已被生成器丢弃的旧页面键')
})

test('C29 只验收当前可达的经典定向表单，不伪造已退役 mode=2', () => {
  const current = shot('C29')
  const generated = fixture('C29')

  assert.doesNotMatch(current.file, /mode2/)
  assert.equal(Object.hasOwn(current.data || {}, 'mode'), false)
  assert.equal(current.data.phase, 'form')
  assert.equal(generated.data.phase, 'form')
  assert.equal(generated.dropped.includes('mode'), false)
  assert.equal(SELECTORS.C29.selector, '.ma-form .ma-card')
})

test('selector 生成同样单向，实跑审校锚只来自显式 overrides', () => {
  const generator = fs.readFileSync(path.resolve(__dirname, '../../scripts/_gen_selectors.js'), 'utf8')
  assert.doesNotMatch(generator, /readFileSync\(OUTPUT/, 'selector 生成器不得把 selectors.json 自己作为输入')
  assert.match(generator, /selectors-overrides\.json/)
  const overrides = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/selectors-overrides.json'), 'utf8'))
  assert.deepEqual(overrides.C24.viewportSelector, '.topic-list .li')
  assert.equal(overrides.C01.selector, SELECTORS.C01.selector,
    '已审校的工作台强锚必须进入显式真源')
})

test('负控：对象奖励、缺封面、空路线与弱页面壳必须分别判红', () => {
  const badReward = { rewards: [{ missionCode: 'ARRIVAL' }] }
  assert.throws(() => assertRewardStrings(badReward, 'B30 变异体'), /只能是可见字符串/)

  const goodDetail = fixture('C23').data
  const goodRoute = fixture('C24').data
  const noCover = { ...goodDetail, info: { ...goodDetail.info, imgUrl: '' } }
  const noRoute = { ...goodRoute, info: { ...goodRoute.info, chaptersList: [] } }
  assert.throws(() => assertTopicBody(noCover, goodRoute, 'C23 变异体'), /缺少首屏封面/)
  assert.throws(() => assertTopicBody(goodDetail, noRoute, 'C24 变异体'), /缺少路线正文/)

  const weak = { selector: 'view', weak: true }
  assert.throws(() => {
    assert.equal(weak.weak, undefined, '弱页面壳不得作为正文证据')
  }, /弱页面壳不得作为正文证据/)

  const ambiguous = { data: { loading: true }, dropped: ['loading'] }
  assert.throws(() => {
    const intersection = Object.keys(ambiguous.data).filter((key) => ambiguous.dropped.includes(key))
    assert.deepEqual(intersection, [], 'data 与 dropped 同键必须判红')
  }, /必须判红/)
})
