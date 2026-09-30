const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const { SHOTS } = require(path.join(ROOT, 'scripts/shot-matrix.js'))
const FIXTURES = require(path.join(ROOT, 'scripts/fixtures.json'))
const SELECTORS = require(path.join(ROOT, 'scripts/selectors.json'))
const B51_PROMPTS = ['老城建筑与咖啡', '周末亲子探险', '雨天室内漫游']

const TARGETS = {
  D07: '#orderDetail',
  D22: '#withdrawHistory',
  D23: '#inviteHistory',
  D28: '#incomeDetail',
  D29: '#incomeDetail',
  D32: '#incomeDetail',
  D33: '#assetEarnings',
  D38: '#deregisterFlow',
}

function assertB51Contract(fixtures, selectors = SELECTORS) {
  assert.deepEqual(fixtures.B51.data.aiPrompts, B51_PROMPTS,
    'B51 必须注入三条真实可读的灵感文案，不能由生成器补示例占位')
  assert.deepEqual(selectors.B51.textIncludes, B51_PROMPTS,
    'B51 截图必须逐条回读灵感文案，不能只统计空 text 节点')
  assert.equal(selectors.B51.visibleMin, 3,
    'B51 三条灵感必须都在截图视口内可见')
}

function assertShotFixtureContract(fixtures, selectors = SELECTORS) {
  const shots = Object.fromEntries(SHOTS.map(shot => [shot.id, shot]))
  for (const [id, target] of Object.entries(TARGETS)) {
    assert.equal(shots[id].fixtureTarget, target, `${id}: 矩阵必须声明正文子组件 target`)
    assert.equal(fixtures[id].target, target, `${id}: 生成 fixture 不得把 target 丢掉`)
    assert.deepEqual(fixtures[id].dropped, [], `${id}: 子组件字段不得按壳页面 data 过滤`)
  }

  assert.equal(fixtures.D07.data.id, 1001)
  assert.equal(fixtures.D07.data.loadState, 'ready')
  assert.equal(fixtures.D07.data.info.statusText, '退款处理中')
  assert.match(fixtures.D07.data.info.refundDisplayText, /退款处理中/)

  assert.equal(fixtures.D22.data.nodata, true)
  assert.deepEqual(fixtures.D22.data.list, [])

  assert.equal(fixtures.D23.data.groups.length, 1)
  assert.equal(fixtures.D23.data.groups[0].items.length, 2)
  assert.equal(fixtures.D23.data.groups[0].items[0].rewardText, '+10 积分')

  // 2026-08-11:amountText 的形状变了。符号原来由 wxml 硬拼 '+¥',支出会渲成 +¥-50.00;
  // 现在由 formatList 按 changeType 方向给,fixture 注入的是**成品串**,所以不再是裸 \d+\.\d{2}。
  for (const id of ['D28', 'D29']) {
    const rows = fixtures[id].data.list
    assert.ok(rows.length >= 1, `${id}: 至少要有一行,否则拍出来是空列表`)
    for (const r of rows) {
      assert.match(r.amountText, /^[+−]¥\d+\.\d{2}$/,
        `${id}: amountText 必须自带方向符号与 ¥(wxml 已不再拼),否则支出会渲成 +¥-50.00`)
      assert.equal(r.amountText.startsWith('+'), r.isIncome === true,
        `${id}: 符号必须与 isIncome 一致 —— 符号和颜色分别取自两个字段,不一致就会出现绿色的减号`)
      assert.equal(r.directionText, r.isIncome ? '收入' : '支出',
        `${id}: directionText 是 changeType 的如实翻译,不许再退回「已到账/处理中」那对编出来的状态`)
      assert.equal(r.statusText, undefined, `${id}: statusText 是已删除的假状态,不得复活`)
      assert.equal(r.changeBalance, undefined)
    }
  }
  // D28 是「全部」筛选:必须同时有收和支,否则截图证明不了红绿两档都对
  assert.ok(fixtures.D28.data.list.some(r => r.isIncome === true), 'D28 必须有一行收入')
  assert.ok(fixtures.D28.data.list.some(r => r.isIncome === false), 'D28 必须有一行支出')
  // D29 是「品牌收益」筛选:该档只会有收入,混进支出说明筛选口径错了
  assert.ok(fixtures.D29.data.list.every(r => r.isIncome === true), 'D29 品牌筛选下不应出现支出')
  assert.equal(fixtures.D33.data.state, 'ready')
  assert.equal(fixtures.D32.data.activeFilter, 'create')
  assert.notEqual(fixtures.D32.data.activeFilter, 'all', 'D32 必须证明筛选胶囊态，不能与 D30 的全部收益空态重复')
  assert.deepEqual(fixtures.D32.data.list, [])

  assert.deepEqual(selectors.D07.selector, '.david')
  assert.deepEqual(selectors.D22.selector, '.txjl-state')
  assert.deepEqual(selectors.D23.selector, '.ir-summary, .ir-group, .ir-row')
  assert.deepEqual(selectors.D28.selector, '.id-item')
  assert.deepEqual(selectors.D29.selector, '.id-item')
  assert.deepEqual(selectors.D32.selector, '.id-tabs, .id-state-fill')
  assert.equal(selectors.D32.min, 2)
  for (const hidden of ['.id-item', 'cy-skeleton', 'cy-error', 'cy-scene-merchant-profit']) {
    assert.ok(selectors.D32.forbid.includes(hidden), `D32 筛选空态必须排除 ${hidden}`)
  }
  assert.deepEqual(selectors.D33.selector, '.ae-hero, .ae-section')
  assert.equal(selectors.D33.min, 2)
  assert.equal(fixtures.D38.data.status, 'ELIGIBLE')
  assert.equal(selectors.D38.selector, '.deregister-copy')
  assert.ok(selectors.D38.forbid.includes('cy-error'))
  assert.ok(selectors.D38.forbid.includes('cy-empty'))
  assert.deepEqual(selectors.D07.forbid, ['.rs--fail', '.order-load-loading'])
  for (const id of ['D22', 'D23', 'D28', 'D29', 'D33']) {
    assert.ok(selectors[id].forbid.includes('cy-skeleton'), `${id}: 正文断言必须排除骨架态`)
    assert.ok(selectors[id].forbid.includes('cy-error'), `${id}: 正文断言必须排除错误态`)
  }

  const d08 = fixtures.D08.data.list[0]
  assert.deepEqual(
    Object.keys(d08).sort(),
    ['dateText', 'id', 'sourceAddress', 'sourceCover', 'sourceName', 'stateText', 'stateVariant', 'typeLabel'].sort(),
    'D08 必须注入页面真实消费的 source* / dateText 字段，旧 title/dateRange/place 会拍成灰色空条',
  )
  const d08Wxml = read('subpackageMember/mycanyu/mycanyu.wxml')
  for (const field of ['sourceCover', 'sourceName', 'stateVariant', 'stateText', 'dateText', 'typeLabel', 'sourceAddress']) {
    assert.match(d08Wxml, new RegExp(`item\\.${field}`), `D08 页面必须真实消费 ${field}`)
  }

  assert.equal(fixtures.C20.data.loadState, 'ok')
  assert.equal(Object.hasOwn(fixtures.C20.data, 'loaded'), false,
    'C20 已改用 loadState，生成 fixture 不得继续注入页面不消费的旧 loaded')
  assert.ok(fixtures.C20.data.m && fixtures.C20.data.m.name,
    'C20 必须给 M2 行式 DOM 注入商家实体，不能落到尚未入驻兜底')
  assert.equal(selectors.C20.selector, '.dc-identity, .dc-card', 'C20 必须锚定 M2 行式正文')
  assert.equal(selectors.C20.min, 2, 'C20 必须同时命中预览与分组正文')
  assert.deepEqual(selectors.C20.forbid, ['cy-empty', 'cy-error', 'cy-skeleton'],
    'C20 必须排除兜底、错误与骨架态')

  assert.equal(shots.C36.expect.selector, '.pr-name-row, .pr-detail-block, .pr-row')
  assert.equal(shots.C36.expect.min, 5,
    'C36 夹具固定渲染名称、档案块和三条合作条款；不得虚构第六个内容块')

  assert.equal(fixtures.C44.data.detailLoaded, true)
  assert.equal(fixtures.C44.data.notFound, false)
  assert.ok(fixtures.C44.data.club && fixtures.C44.data.club.name,
    'C44 必须注入 club，不能落到俱乐部错误态')
  assert.equal(fixtures.C44.data.club.isOwner, false)
  assert.equal(fixtures.C44.data.club.isJoined, true)
  assert.ok(fixtures.C44.data.posts.length > 0, 'C44 成员态必须能看到动态')
  assert.equal(selectors.C44.selector, '.cover-wrap, cy-post-card', 'C44 必须锚定 Hero 与成员动态')
  assert.equal(selectors.C44.min, 2, 'C44 必须同时命中 Hero 与成员动态')
  assert.deepEqual(selectors.C44.forbid, ['.error-state', 'cy-skeleton'],
    'C44 必须排除错误与骨架态')

  assert.equal(fixtures.C45.data.detailLoaded, true)
  assert.equal(fixtures.C45.data.notFound, false)
  assert.ok(fixtures.C45.data.club && fixtures.C45.data.club.name,
    'C45 必须注入 club，不能落到俱乐部错误态')
  assert.equal(fixtures.C45.data.club.isOwner, true)
  assert.equal(fixtures.C45.data.canUseManageTab, true)
  assert.ok(fixtures.C45.data.posts.length > 0, 'C45 主理人态必须能看到动态')
  assert.equal(selectors.C45.selector, '.cover-wrap, .cover-nav-act', 'C45 必须锚定 Hero、分享与设置入口')
  assert.equal(selectors.C45.min, 3, 'C45 必须同时命中 Hero、分享与设置入口')
  assert.deepEqual(selectors.C45.forbid, ['.error-state', 'cy-skeleton'],
    'C45 必须排除错误与骨架态')
}

test('D07/D22/D23/D28/D29/D32/D33：深链壳 fixture 注入并断言正文子组件', () => {
  assertShotFixtureContract(FIXTURES)
  const runtime = read('scripts/_shot_full_matrix.js')
  // 注入作用域已从内联三元升级为 resolveFixtureScope:同时支持字符串 target 与嵌套
  // assertPath 数组,且 target 找不到时 fail-closed 抛错(旧内联式会静默回落到 page)。
  assert.match(runtime, /const scope = await resolveFixtureScope\(page, fixtureTarget\);/)
  assert.match(runtime, /throw new Error\(`fixture target 不存在: \$\{target\}`\)/)
  assert.match(runtime, /await scope\.setData\(inject\)/)
  assert.match(runtime, /await readFixtureValue\(scope, k\)/)
  assert.match(runtime, /const assertScope = await resolveAssertionScope\(page, scope, want\);/)
  assert.match(runtime, /await assertScope\.\$\$\(sel\)/)
  assert.match(runtime, /await Promise\.race\(\[[\s\S]*mp\.reLaunch\('\/pages\/index\/index'\)\.catch\(\(\) => \{\}\),[\s\S]*setTimeout\(resolve, 5000\)[\s\S]*try \{ mp\.disconnect\(\); \} catch/,
    '截图结束后必须限时离开 fixture 页面，再断开开发者工具')
  assert.match(runtime, /try \{ mp\.disconnect\(\); \} catch/)
  assert.doesNotMatch(runtime, /disconnect\(\)\.catch/)
  assert.doesNotMatch(runtime, /await mp\.close\(\)/)
  const generator = read('scripts/_gen_fixtures.js')
  assert.match(generator, /if \(s\.fixtureTarget\)/)
  assert.match(generator, /target: s\.fixtureTarget, dropped: \[\], switchKeys: \[\]/)
})

test('C20/C44/D08：生成 fixture 保留新 DOM 真正消费的字段', () => {
  assertShotFixtureContract(FIXTURES)
})

test('俱乐部编辑组件与申请页复用可编译的表单样式单一真源', () => {
  const pageStyle = read('pages/club/apply/index.wxss')
  const componentStyle = read('components/cy/scene-club-edit/index.wxss')
  const sharedStyle = read('style/club-apply-form.wxss')

  assert.match(pageStyle, /@import ['"]\.\.\/\.\.\/\.\.\/style\/club-apply-form\.wxss['"];/)
  assert.match(componentStyle, /@import ['"]\.\.\/\.\.\/\.\.\/style\/club-apply-form\.wxss['"];/)
  assert.doesNotMatch(componentStyle, /@import[^;]*pages\/club\/apply/)
  for (const selector of ['.body', '.card', '.frow', '.chip', '.bottom']) {
    assert.match(sharedStyle, new RegExp(`\\${selector}\\s*\\{`), `共享样式必须保留 ${selector}`)
  }
})

test('negative control：D08 回退旧 title/dateRange/place 字段必须判红', () => {
  const broken = JSON.parse(JSON.stringify(FIXTURES))
  broken.D08.data.list = [{ id: 1, title: '城市夜行', dateRange: '08.01 - 08.31', place: '外滩' }]
  assert.throws(() => assertShotFixtureContract(broken), /D08 必须注入页面真实消费/)
})

test('negative control：C20 摘掉商家实体、C44 摘掉 club 时必须判红', () => {
  const decorBroken = JSON.parse(JSON.stringify(FIXTURES))
  decorBroken.C20.data.m = null
  assert.throws(() => assertShotFixtureContract(decorBroken), /C20 必须给 M2 行式 DOM 注入商家实体/)

  const clubBroken = JSON.parse(JSON.stringify(FIXTURES))
  clubBroken.C44.data.club = null
  assert.throws(() => assertShotFixtureContract(clubBroken), /C44 必须注入 club/)
})

test('negative control：C20/C44 退回弱选择器时必须判红', () => {
  const decorSelectorsBroken = JSON.parse(JSON.stringify(SELECTORS))
  decorSelectorsBroken.C20 = { selector: 'page', min: 1, forbid: [] }
  assert.throws(
    () => assertShotFixtureContract(FIXTURES, decorSelectorsBroken),
    /C20 必须锚定 M2 行式正文/,
  )

  const clubSelectorsBroken = JSON.parse(JSON.stringify(SELECTORS))
  clubSelectorsBroken.C44 = { selector: 'page', min: 1, forbid: [] }
  assert.throws(
    () => assertShotFixtureContract(FIXTURES, clubSelectorsBroken),
    /C44 必须锚定 Hero 与成员动态/,
  )
})

test('B51 灵感截图锁住真实文字与视口可见性', () => {
  assertB51Contract(FIXTURES)
})

test('negative control：B51 灵感为空或退回只数节点时必须判红', () => {
  const fixtureBroken = JSON.parse(JSON.stringify(FIXTURES))
  fixtureBroken.B51.data.aiPrompts = ['', '', '']
  assert.throws(
    () => assertB51Contract(fixtureBroken),
    /B51 必须注入三条真实可读的灵感文案/,
  )

  const selectorBroken = JSON.parse(JSON.stringify(SELECTORS))
  delete selectorBroken.B51.textIncludes
  delete selectorBroken.B51.visibleMin
  assert.throws(
    () => assertB51Contract(FIXTURES, selectorBroken),
    /B51 截图必须逐条回读灵感文案/,
  )
})

test('negative control：D28/D29 退回旧金额形状或假状态,各自判红', () => {
  // ① 退回 wxml 硬拼 '+¥' 那版:amountText 是裸数字
  const bare = JSON.parse(JSON.stringify(FIXTURES))
  bare.D28.data.list = bare.D28.data.list.map(r => ({ ...r, amountText: '128.00' }))
  assert.throws(() => assertShotFixtureContract(bare), /必须自带方向符号与 ¥/)

  // ② 支出带加号(符号与 isIncome 不一致 ⇒ 会出现红色的加号)
  const wrongSign = JSON.parse(JSON.stringify(FIXTURES))
  wrongSign.D28.data.list = wrongSign.D28.data.list.map(
    r => (r.isIncome ? r : { ...r, amountText: r.amountText.replace('−', '+') }))
  assert.throws(() => assertShotFixtureContract(wrongSign), /符号必须与 isIncome 一致/)

  // ③ 被删掉的假状态复活
  const zombie = JSON.parse(JSON.stringify(FIXTURES))
  zombie.D28.data.list[0].statusText = '处理中'
  assert.throws(() => assertShotFixtureContract(zombie), /statusText 是已删除的假状态/)

  // ④ directionText 退回状态词
  const asStatus = JSON.parse(JSON.stringify(FIXTURES))
  asStatus.D28.data.list[0].directionText = '已到账'
  assert.throws(() => assertShotFixtureContract(asStatus), /changeType 的如实翻译/)

  // ⑤ D28 只剩收入一行 ⇒ 截图证明不了红那一档
  const incomeOnly = JSON.parse(JSON.stringify(FIXTURES))
  incomeOnly.D28.data.list = incomeOnly.D28.data.list.filter(r => r.isIncome)
  assert.throws(() => assertShotFixtureContract(incomeOnly), /D28 必须有一行支出/)

  // ⑥ D29 品牌筛选里混进支出
  const mixed = JSON.parse(JSON.stringify(FIXTURES))
  mixed.D29.data.list = [...mixed.D29.data.list, { id: 9, isIncome: false, directionText: '支出', amountText: '−¥1.00' }]
  assert.throws(() => assertShotFixtureContract(mixed), /D29 品牌筛选下不应出现支出/)
})
