const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  applyEvidenceGates,
  expectedRouteEvidence,
  routeEvidenceMatches,
  allowFrameException,
  identityMatches,
  settlePendingPrivacy,
  screenshotWithRetry,
  readFixtureValue,
  resolveFixtureScope,
  resolveAssertionScope,
  recordRunFailure,
  digestSourceSnapshot,
  normalizeScreenshotFixture,
  collectVisibleNodeEvidence,
  countVisibleNodes,
} = require('../../scripts/_shot_full_matrix')
const { SHOTS } = require('../../scripts/shot-matrix')
const FIXTURES = require('../../scripts/fixtures.json')
const SELECTORS = require('../../scripts/selectors.json')

function evidence(viewNodeCount, selector = 'view', injectUnstable) {
  return applyEvidenceGates(
    { viewNodeCount, dom: { pass: true }, injectUnstable },
    { selector },
  )
}

test('填充态截图夹具不得把示例占位文案带进页面', () => {
  const normalized = normalizeScreenshotFixture({
    title: '示例title',
    nested: {
      name: '示例name',
      subtitle: '示例subtitle',
      description: '示例description',
    },
  })

  assert.deepEqual(normalized, {
    title: '外滩夜行计划',
    nested: {
      name: '河畔咖啡',
      subtitle: '沿城市线索重新发现熟悉街区',
      description: '沿街寻找建筑细节，完成今天的城市任务。',
    },
  })
  assert.doesNotMatch(JSON.stringify(normalized), /示例/)
})

test('全量填充态夹具不得残留任何位置的示例占位文案', () => {
  for (const [id, fixture] of Object.entries(FIXTURES)) {
    const normalized = normalizeScreenshotFixture(fixture.data || {})
    assert.doesNotMatch(JSON.stringify(normalized), /示例/, id)
  }
})

test('B59 不得覆盖顶栏对微信胶囊的运行时避让值', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(FIXTURES.B59.data, 'headerRightInset'), false)
  assert.equal(FIXTURES.B59.switchKeys.includes('headerRightInset'), false)
})

test('填充态截图夹具按字段恢复数字、布尔和数组类型', () => {
  const normalized = normalizeScreenshotFixture({
    x: '示例x',
    opacity: '示例opacity',
    completed: '示例completed',
    loaded: '示例loaded',
    avatars: '示例avatars',
    paras: '示例paras',
  })

  assert.deepEqual(normalized, {
    x: 24,
    opacity: 1,
    completed: false,
    loaded: true,
    avatars: [],
    paras: [],
  })
})

test('截图 manifest 绑定当前工作树内容，不能只记录可能相同的 HEAD', () => {
  const head = 'a'.repeat(40)
  const first = digestSourceSnapshot(head, Buffer.from('tracked diff'), [
    { path: 'chengyinhub-xcx/new.js', content: Buffer.from('one') },
  ])
  const sameReordered = digestSourceSnapshot(head, Buffer.from('tracked diff'), [
    { path: 'chengyinhub-xcx/new.js', content: Buffer.from('one') },
  ])
  const changed = digestSourceSnapshot(head, Buffer.from('tracked diff'), [
    { path: 'chengyinhub-xcx/new.js', content: Buffer.from('two') },
  ])
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(first, sameReordered)
  assert.notEqual(first, changed, '未跟踪源码内容变化必须让截图出身 digest 变化')

  const source = fs.readFileSync(path.join(__dirname, '../../scripts/_shot_full_matrix.js'), 'utf8')
  assert.match(source, /sourceDigest:\s*sourceSnapshot\.digest/)
  assert.match(source, /dirty:\s*sourceSnapshot\.dirty/)
})

test('截图桥瞬时失败必须有限重试，成功后停止且最终失败保留原异常', async () => {
  let attempts = 0
  const pauses = []
  await screenshotWithRetry(async () => {
    attempts += 1
    if (attempts < 3) throw new Error(`bridge-${attempts}`)
  }, {
    attempts: 3,
    pause: async (ms) => { pauses.push(ms) },
    delayMs: 25,
  })
  assert.equal(attempts, 3)
  assert.deepEqual(pauses, [25, 25])

  await assert.rejects(
    screenshotWithRetry(async () => { throw new Error('still-down') }, {
      attempts: 2,
      pause: async () => {},
      delayMs: 0,
    }),
    /still-down/,
  )
})

test('DevTools 启动探活失败必须落进 manifest，不能只靠进程退出码报红', () => {
  const target = { failure: null, finishedAt: null }
  const result = recordRunFailure(
    target,
    new Error('logic layer did not become responsive'),
    '2026-08-24T04:40:00.000Z',
  )

  assert.equal(result, target)
  assert.match(target.failure, /logic layer did not become responsive/)
  assert.equal(target.finishedAt, '2026-08-24T04:40:00.000Z')

  const source = fs.readFileSync(path.join(__dirname, '../../scripts/_shot_full_matrix.js'), 'utf8')
  assert.match(source, /run\(\)\.catch\(\(e\)\s*=>\s*\{[\s\S]*recordRunFailure\(manifest,\s*e\)[\s\S]*writeManifest\(\)/,
    '顶层 catch 必须在退出前把启动失败写回 manifest')
})

test('viewNodeCount 普通页低于 8 必须红，cover-view 页面按独立节点树放行', () => {
  const compileErrorLike = evidence(0)
  assert.equal(compileErrorLike.dom.pass, false)
  assert.deepEqual(compileErrorLike.viewNodeGate, { min: 8, pass: false })

  const ordinary = evidence(8)
  assert.equal(ordinary.dom.pass, true)
  assert.deepEqual(ordinary.viewNodeGate, { min: 8, pass: true })

  const webgl = evidence(2, 'cover-view')
  assert.equal(webgl.dom.pass, true)
  assert.deepEqual(webgl.viewNodeGate, { min: 1, pass: true })
})

test('fixture 未稳定回读不能继续假绿', () => {
  const rec = evidence(20, 'view', ['projectState'])
  assert.equal(rec.dom.pass, false)
  assert.match(rec.fixtureFailure, /projectState/)
})

test('截图文字节点必须有尺寸并落在当前视口内才算可见', async () => {
  const node = (top, left, width, height, text = '') => ({
    async offset() { return { top, left } },
    async size() { return { width, height } },
    async text() { return text },
  })
  assert.equal(await countVisibleNodes([
    node(20, 10, 80, 30),
    node(700, 10, 80, 30),
    node(50, 400, 80, 30),
    node(50, 10, 0, 30),
  ], 375, 640), 1)

  const result = await collectVisibleNodeEvidence([
    node(20, 10, 80, 30, '屏内文案'),
    node(700, 10, 80, 30, '屏外文案'),
  ], 375, 640)
  assert.deepEqual(result, { count: 1, text: '屏内文案' })
})

test('fixture 回读必须保留 null，不能把 automator 的 keyed undefined 当成注入失败', async () => {
  const scope = {
    async data(key) {
      if (key === undefined) return { recoHero: null, nested: { state: 'ready' } }
      if (key === 'nested') return { state: 'ready' }
      return undefined
    },
  }
  assert.equal(await readFixtureValue(scope, 'recoHero'), null)
  assert.equal(await readFixtureValue(scope, 'nested.state'), 'ready')
})

test('组件内部状态断言与 fixture 注入 scope 独立', async () => {
  const fixtureScope = { name: 'page-fixture-scope' }
  const componentScope = { name: 'qr-shadow-scope' }
  const nestedScope = { name: 'nested-poi-scope' }
  componentScope.$$ = async (selector) => selector === 'cy-scene-roam-poi-detail' ? [nestedScope] : []
  const page = {
    async $(selector) { return selector === 'cy-qr-voucher' ? componentScope : null },
    async $$(selector) { return selector === 'cy-scene-deep-link' ? [componentScope] : [] },
  }

  assert.equal(await resolveAssertionScope(page, fixtureScope, {}), fixtureScope)
  assert.equal(await resolveFixtureScope(page, null), page)
  assert.equal(await resolveFixtureScope(page, 'cy-qr-voucher'), componentScope)
  assert.equal(
    await resolveFixtureScope(page, [
      { selector: 'cy-scene-deep-link', index: 0 },
      { selector: 'cy-scene-roam-poi-detail', index: 0 },
    ]),
    nestedScope,
  )
  assert.equal(
    await resolveAssertionScope(page, fixtureScope, { assertTarget: 'cy-qr-voucher' }),
    componentScope,
  )
  assert.equal(
    await resolveAssertionScope(page, fixtureScope, {
      assertPath: [
        { selector: 'cy-scene-deep-link', index: 0 },
        { selector: 'cy-scene-roam-poi-detail', index: 0 },
      ],
    }),
    nestedScope,
  )
  await assert.rejects(
    resolveAssertionScope(page, fixtureScope, { assertTarget: '#missing' }),
    /assert target 不存在: #missing/,
  )
  await assert.rejects(
    resolveAssertionScope(page, fixtureScope, { assertPath: [{ selector: '#missing', index: 0 }] }),
    /assert path 不存在: #missing\[0\]/,
  )
})

test('同路由重建必须使用无隐私副作用的中转页', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/_shot_full_matrix.js'), 'utf8')
  assert.doesNotMatch(source, /reLaunch\(['"]\/pages\/privacy\/index['"]\)/,
    '隐私页 onUnload 会结算待决授权，不能拿它当截图中转页')
  assert.match(source, /reLaunch\(['"]\/pages\/agreement\/index\?type=user_agreement['"]\)/)
})

test('AI 店铺参谋按内容态验收，不依赖已迁入导航栏的旧页标题', () => {
  const shots = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot]))
  assert.equal(shots.C12b.expect.selector, '.value-card, .ai-card')
  assert.equal(shots.C12c.expect.selector, '.value-card, .ai-card--down')
  assert.equal(shots.C12c.data.ai, false,
    'automator 对 null 回读为 undefined；降级夹具用稳定的 falsy 值并由 DOM 锁住真实分支')
})

test('首页游客态直接验收匿名问候并禁止玩家身份徽章', () => {
  assert.equal(SELECTORS.A04.selector, '.v3-hero-hi')
  assert.deepEqual(SELECTORS.A04.forbid, ['.v3-hero-mem'])
})

test('动态二维码不锁会自然递减的 countdown，玩法缺参页按真实最小节点树验收', () => {
  const shots = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot]))
  assert.equal(Object.hasOwn(shots.E27.data, 'countdown'), false)
  assert.equal(Object.hasOwn(FIXTURES.E27.data, 'countdown'), false)
  assert.deepEqual(SELECTORS.F01, {
    selector: '.mp-empty__b',
    min: 1,
    viewNodeMin: 3,
  })
})

test('F11 优惠券薄壳必须注入嵌套正文的真实 ready 态，错误响应不能再冒充 normal', () => {
  const shot = SHOTS.find((item) => item.id === 'F11')
  const expectedPath = [
    { selector: 'cy-scene-deep-link', index: 0 },
    { selector: 'cy-scene-game-coupon-wallet', index: 0 },
  ]
  assert.equal(shot.state, 'normal')
  assert.equal(shot.control, 'setData')
  assert.deepEqual(shot.fixtureTarget, expectedPath)
  assert.equal(shot.data.state, 'ready')
  assert.ok(shot.data.items.length > 0)
  assert.deepEqual(FIXTURES.F11.target, expectedPath)
  assert.equal(FIXTURES.F11.data.state, 'ready')
  assert.equal(SELECTORS.F11.selector, '.wallet-card')
  assert.deepEqual(SELECTORS.F11.assertPath, expectedPath)
  assert.deepEqual(SELECTORS.F11.forbid, ['cy-skeleton', 'cy-error', 'cy-empty'])
})

test('B04 无轨迹证据必须来自真实结算分支，不再用不存在的首屏字段或 blocked 逃生', () => {
  const shot = SHOTS.find((item) => item.id === 'B04')
  assert.equal(shot.blocked, '')
  assert.equal(shot.data.screen, 'arrive')
  assert.deepEqual(shot.data.polyline, [])
  assert.equal(shot.data.trackTip, '这次没有记录到轨迹')
  assert.ok(shot.data.finish && Array.isArray(shot.data.finish.photos))
  assert.equal(Object.hasOwn(shot.data, 'locationAuthorized'), false)
  assert.equal(Object.hasOwn(shot.data, 'track'), false)
  assert.equal(FIXTURES.B04.data.screen, 'arrive')
  assert.equal(SELECTORS.B04.selector, '.settle__track-empty')
  assert.deepEqual(SELECTORS.B04.forbid, ['cy-skeleton', 'cy-error'])
})

test('B71/B72/B73 排行榜 fixture 必须命中当前 metric/period 合同并渲染真实榜单', () => {
  const expected = {
    B71: { metric: 'point', period: 'week', unit: '积分' },
    B72: { metric: 'point', period: 'total', unit: '积分' },
    B73: { metric: 'exp', period: 'total', unit: 'EXP' },
  }
  for (const [id, state] of Object.entries(expected)) {
    const shot = SHOTS.find((item) => item.id === id)
    assert.equal(shot.blocked, '', `${id} 不得继续用 blocked 掩盖旧字段`)
    assert.equal(shot.data.loading, false)
    assert.equal(shot.data.errorMsg, '')
    assert.equal(shot.data.boardState, 'error')
    assert.equal(shot.data.metric, state.metric)
    assert.equal(shot.data.period, state.period)
    assert.equal(shot.data.unit, state.unit)
    assert.equal(shot.data.top3.length, 3)
    assert.ok(shot.data.rest.length > 0)
    assert.ok(shot.data.me)
    assert.equal(Object.hasOwn(shot.data, 'activeTab'), false)
    assert.equal(Object.hasOwn(shot.data, 'list'), false)
    assert.equal(Object.hasOwn(shot.data, 'rankType'), false)
    assert.equal(FIXTURES[id].data.metric, state.metric)
    assert.equal(FIXTURES[id].data.period, state.period)
    assert.equal(SELECTORS[id].selector, '.gc-pod-name')
    assert.equal(SELECTORS[id].min, 3)
    assert.deepEqual(SELECTORS[id].forbid, ['cy-skeleton', 'cy-error', 'cy-empty', '.gc-state'])
  }
})

test('A40/A61 票夹空态与同构 loading 使用当前互斥状态合同', () => {
  const empty = SHOTS.find((item) => item.id === 'A40')
  const loading = SHOTS.find((item) => item.id === 'A61')
  // 2026-09-09 票夹合并两个 tab:互斥状态由合成的 walletState 表达,
  // 两条支线的原料已挪出 data(否则被 U4 死数据字段门禁判红)。
  assert.deepEqual(empty.data, {
    walletState: 'empty',
    ticketList: [],
  })
  assert.equal(SELECTORS.A40.selector, 'cy-state-shell')
  assert.deepEqual(SELECTORS.A40.forbid, ['cy-skeleton', 'cy-error'])

  assert.ok(loading)
  assert.equal(loading.state, 'loading')
  assert.equal(loading.data.walletState, 'loading')
  assert.deepEqual(loading.data.ticketList, [])
  assert.equal(SELECTORS.A61.selector, 'cy-skeleton')
  assert.deepEqual(SELECTORS.A61.forbid, ['cy-state-shell'])
})

test('route gate 同时校验 path 与 query，不能把错误深链当成已到达', () => {
  const expected = expectedRouteEvidence('/pages/demo/index?id=7&name=%E5%A4%96%E6%BB%A9')
  assert.deepEqual(expected, { path: '/pages/demo/index', query: { id: '7', name: '外滩' } })
  assert.equal(routeEvidenceMatches(expected, { path: '/pages/demo/index', query: { id: '7', name: '外滩' } }), true)
  assert.equal(routeEvidenceMatches(expected, { path: '/pages/demo/index', query: { id: '8', name: '外滩' } }), false)
  assert.equal(routeEvidenceMatches(expected, { path: '/pages/other/index', query: { id: '7', name: '外滩' } }), false)
})

test('route gate 的中文 query 不许因为编码不同源而假红', () => {
  // 真实运行时:getCurrentPages().options 拿到的是**未解码**的值,而 expected 是解码后的。
  // 修之前这一行必红 —— A25/A28/E03 等带 keyword 深链因此拍不出来。
  const expected = expectedRouteEvidence('/pages/search2/result/index?keyword=路线')
  assert.deepEqual(expected, { path: '/pages/search2/result/index', query: { keyword: '路线' } })
  const encodedActual = { path: '/pages/search2/result/index', query: { keyword: '%E8%B7%AF%E7%BA%BF' } }
  assert.equal(routeEvidenceMatches(expected, encodedActual), true)

  // 负控:归一化只能抹平编码差,不许把「值真的不一样」也抹平。
  assert.equal(routeEvidenceMatches(expected, {
    path: '/pages/search2/result/index', query: { keyword: '%E5%9F%8E%E5%B8%82' },
  }), false)
  assert.equal(routeEvidenceMatches(expected, {
    path: '/pages/index/index', query: { keyword: '%E8%B7%AF%E7%BA%BF' },
  }), false)
  // 负控:缺这个 query 键也必须红,别被 decode(undefined) 变成空串蒙混过去。
  assert.equal(routeEvidenceMatches(expected, {
    path: '/pages/search2/result/index', query: {},
  }), false)
  // (来自 UI 复核批1 的补充)畸形百分号序列 decodeURIComponent 会抛,
  // 抛了要按原样比,不许因为一个坏 query 把整轮采集打断 —— 但也不许因此判成「已兑现」。
  assert.equal(routeEvidenceMatches(expected, {
    path: '/pages/search2/result/index', query: { keyword: '%E0%A4%A' },
  }), false)
})

test('身份必须回读兑现:写了 storage 没改 globalData 就是没兑现(B21 那张商家浅色图的成因)', () => {
  const wantPlayer = { role: 'user', userType: 1 }
  const ok = { globalRole: 'user', globalType: 1, storageRole: 'user', storageType: 1, hasAuth: true }
  assert.equal(identityMatches(wantPlayer, ok), true)
  // ★真实故障形状:storage 写成了 player,globalData 还留着上一个实例的 merchant。
  assert.equal(identityMatches(wantPlayer, { ...ok, globalRole: 'merchant', globalType: 2 }), false)
  // 两条判据各自独立:只有 globalRole 漂了 / 只有 globalType 漂了,都必须单独判红,
  // 否则「摘掉其中一条」这个变异不会被任何用例抓住。
  assert.equal(identityMatches(wantPlayer, { ...ok, globalRole: 'merchant' }), false)
  assert.equal(identityMatches(wantPlayer, { ...ok, globalType: 2 }), false)
  // storage 侧没写进去(setStorageSync 抛了被吞)也必须红,两个键同样各判各的
  assert.equal(identityMatches(wantPlayer, { ...ok, storageRole: '', storageType: 0 }), false)
  assert.equal(identityMatches(wantPlayer, { ...ok, storageRole: 'merchant' }), false)
  assert.equal(identityMatches(wantPlayer, { ...ok, storageType: 2 }), false)
  // 回读整个拿不到(evaluate 失败)不许当通过
  assert.equal(identityMatches(wantPlayer, null), false)
  // 游客:userType=0 时必须没有 token;残留 token 就是没兑现
  const wantGuest = { role: '', userType: 0 }
  assert.equal(identityMatches(wantGuest, {
    globalRole: '', globalType: 0, storageRole: '', storageType: 0, hasAuth: false,
    hasIdentitySnapshot: false,
  }), true)
  assert.equal(identityMatches(wantGuest, {
    globalRole: '', globalType: 0, storageRole: '', storageType: 0, hasAuth: true,
    hasIdentitySnapshot: false,
  }), false)
  assert.equal(identityMatches(wantGuest, {
    globalRole: '', globalType: 0, storageRole: '', storageType: 0, hasAuth: false,
    hasIdentitySnapshot: true,
  }), false, '游客夹具残留 user_id/avatar/nickname/权限快照时必须判红')
})

test('每张截图前必须结算上一状态遗留的隐私 resolver，并从 app 回读 pending=0', async () => {
  const calls = []
  const mp = {
    async evaluate(fn) {
      calls.push(String(fn))
      return { settled: 2, pending: 0, navigationPending: false }
    },
  }
  assert.deepEqual(await settlePendingPrivacy(mp), {
    settled: 2, pending: 0, navigationPending: false,
  })
  assert.equal(calls.length, 1)

  await assert.rejects(
    settlePendingPrivacy({ evaluate: async () => ({ settled: 1, pending: 1, navigationPending: false }) }),
    /隐私授权 resolver 未清空/,
  )
})

test('深色边缘例外只豁免 flat-edge 命中，尺寸错误仍必须红', () => {
  const want = { allowFlatDarkEdge: true }
  assert.equal(allowFrameException(want, 'right edge column is 87% flat DevTools-chrome grey; simulator inset'), true)
  assert.equal(allowFrameException(want, 'unexpected frame size 800x600, expected 624x1352'), false)
})

test('B49/B50 使用产品当前可达的章节弹层与票务页，不再注入已删除的 step', () => {
  const shots = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot]))
  assert.equal(shots.B49.data.editorPage, 1)
  assert.equal(shots.B49.data.popChapter, true)
  assert.equal(FIXTURES.B49.data.editorPage, 1)
  assert.equal(FIXTURES.B49.data.popChapter, true)
  assert.equal(Object.hasOwn(FIXTURES.B49.data, 'step'), false)
  assert.equal(SELECTORS.B49.selector, '.pop-chapter-settings.show, .chapter-atmosphere')
  assert.equal(SELECTORS.B49.allowFlatDarkEdge, true)

  assert.equal(shots.B50.data.editorPage, 2)
  assert.equal(FIXTURES.B50.data.editorPage, 2)
  assert.ok(Array.isArray(FIXTURES.B50.data['formData.tickets']))
  assert.equal(Object.hasOwn(FIXTURES.B50.data, 'step'), false)
  assert.equal(SELECTORS.B50.selector, '#ticketSection, .slopes-tabbar')
  assert.equal(SELECTORS.B50.min, 2)
  assert.equal(SELECTORS.B67.viewNodeMin, 1)
})

test('B36/B37/C10 只采集页面真实存在且可区分的状态', () => {
  const shots = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot]))

  assert.equal(shots.B36.scrollTop, 900)
  assert.equal(FIXTURES.B37.data.detailData.title, '城市定向怎么玩')
  assert.equal(FIXTURES.B37.data.detailData.createTime, '2026-08-19 10:00:00')
  assert.match(FIXTURES.B37.data.contentNodes, /定位权限/)
  assert.equal(SELECTORS.B37.selector, '.detail-time, rich-text')
  assert.equal(SELECTORS.B37.min, 2)
  assert.deepEqual(FIXTURES.B37.dropped, [])

  assert.equal(shots.C10.route, '/pages/merchant/profile/index')
  assert.equal(shots.C10.state, 'missing-param')
  assert.equal(FIXTURES.C10.data, null)
  assert.equal(SELECTORS.C10.selector, 'cy-empty')
  assert.match(shots.C10.note, /兼容壳/)
})

test('重复二维码错误屏只保留一份动态证据', () => {
  const shots = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot]))
  assert.equal(shots.D18.blocked, '')
  assert.match(shots.E28.blocked, /D18/)
  assert.match(shots.E28.blocked, /同一屏/)
})

test('B60 圈层缺参状态断言真实 cy-state-shell，不使用已删除 class', () => {
  const play = fs.readFileSync(path.join(__dirname, '../../pages/play/circle/index.wxml'), 'utf8')
  assert.match(play, /<cy-state-shell/)
  for (const id of ['B60']) {   // B61 随圈层配置页退役(2026-08-26)
    assert.equal(SELECTORS[id].selector, 'cy-state-shell')
    assert.equal(SELECTORS[id].min, 1)
    assert.deepEqual(SELECTORS[id].forbid, ['cy-skeleton'])
  }
})

test('C11 blocked 说明必须与已退役商家兼容壳真源一致', () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../scripts/uiaudit/blocked-baseline.json'),
    'utf8',
  ))
  const reason = baseline.additions.C11

  assert.match(reason, /已退役.*兼容壳/)
  assert.match(reason, /C10/)
  assert.doesNotMatch(reason, /内容态待补|解除 blocked/)
})

test('B14/B15/B16 通过产品方法进入手记、故事和完成态', () => {
  assert.deepEqual(FIXTURES.B14.calls.map((action) => action.method), ['openJournal'])
  assert.equal(Object.hasOwn(FIXTURES.B14.data, 'showJournal'), false)

  assert.deepEqual(FIXTURES.B15.calls.map((action) => action.method), ['onComplete', 'openStory'])
  assert.equal(Object.hasOwn(FIXTURES.B15.data, 'story'), false)

  assert.deepEqual(FIXTURES.B16.calls.map((action) => action.method), [
    'onComplete', 'onComplete', 'onComplete', 'onComplete',
  ])
  assert.equal(Object.hasOwn(FIXTURES.B16.data, 'showFinish'), false)
  for (const id of ['B14', 'B15', 'B16']) {
    assert.equal(Object.hasOwn(FIXTURES[id].data, 'total'), false)
    assert.equal(Object.hasOwn(FIXTURES[id].data, 'doneCount'), false)
  }
})
