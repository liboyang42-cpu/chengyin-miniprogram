'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  authorityRequestPlan, captureAuthority, composeAuthorityReceipt, coveringOverlays, elementMetrics, launchPath, loadReadbackAdapter, parseExpectation,
  completeModalInteraction, performTapInteraction, resolveActionScope, resolveTapInteractionTarget,
  predicateMatches, routeStack, scrollElementIntoView, selectElement, waitForObservedNavigation, waitForStableBaseline,
} = require('../automator/action-evidence-runner')
const interactionSequence = require('../automator/events/interaction-sequence')

test('variant predicate 支持排除枚举，默认验证方式不能落入其它互斥路径', () => {
  assert.equal(predicateMatches(0, { $notIn: [1, 2, 3, 4] }), true)
  assert.equal(predicateMatches(5, { $notIn: [1, 2, 3, 4] }), true)
  assert.equal(predicateMatches(2, { $notIn: [1, 2, 3, 4] }), false)
})

test('read/write 无仓库内权威回读适配器时 fail-closed', async () => {
  const previous = process.env.ACTION_READBACK_ADAPTER
  delete process.env.ACTION_READBACK_ADAPTER
  await assert.rejects(
    Promise.resolve().then(() => loadReadbackAdapter({ id: 'write-action', baseActionClass: 'write' })),
    /权威回读适配器/,
  )
  if (previous == null) delete process.env.ACTION_READBACK_ADAPTER
  else process.env.ACTION_READBACK_ADAPTER = previous
})

test('read/write 只接受 tests/automator/readbacks 内返回 authority/readback 的适配器', async () => {
  const previous = process.env.ACTION_READBACK_ADAPTER
  process.env.ACTION_READBACK_ADAPTER = 'tests/automator/readbacks/test-fixture.js'
  const action = {
    id: 'read-action', baseActionClass: 'read',
    targets: {
      apis: ['/api/test/resource'], primaryApis: ['/api/test/resource'],
      apiContracts: [{ url: '/api/test/resource', method: 'GET' }],
    },
  }
  const fixture = { id: 'synthetic-player' }
  const fixtureAttestation = { identityFingerprint: 'sha256:test-account', accountRole: 'player' }
  const loaded = loadReadbackAdapter(action)
  const before = await captureAuthority(action, loaded, 'before', { action, fixture })
  const after = await captureAuthority(action, loaded, 'after', { action, fixture })
  const receipt = composeAuthorityReceipt(action, loaded, 'success', before, after, {
    method: 'GET', urlTemplate: '/api/test/resource',
  }, fixtureAttestation)
  assert.equal(receipt.actionId, action.id)
  assert.equal(receipt.fixtureId, fixture.id)
  assert.equal(receipt.request.resourceId, receipt.authority.resourceId)
  if (previous == null) delete process.env.ACTION_READBACK_ADAPTER
  else process.env.ACTION_READBACK_ADAPTER = previous
})

test('精确期望只能来自合法 JSON object', () => {
  const previous = process.env.ACTION_EXPECT_JSON
  process.env.ACTION_EXPECT_JSON = '[]'
  assert.throws(() => parseExpectation({ id: 'state-action' }), /必须是 object/)
  process.env.ACTION_EXPECT_JSON = '{"data":{"open":true}}'
  assert.deepEqual(parseExpectation({ id: 'state-action' }), { data: { open: true } })
  if (previous == null) delete process.env.ACTION_EXPECT_JSON
  else process.env.ACTION_EXPECT_JSON = previous
})

test('详情页入口 query 与 component 宿主页必须由 fixture 明确绑定', () => {
  const fixture = {
    entry: { route: 'pages/detail/index', query: { id: 42, scene: 'audit' } },
    locator: {
      selector: '.cta', index: 0, componentPath: 'components/cy/detail/index',
      componentHostPath: [{ selector: '#detail-component', index: 0 }],
    },
  }
  assert.equal(launchPath({ id: 'page', route: 'pages/detail/index' }, fixture), '/pages/detail/index?id=42&scene=audit')
  assert.equal(launchPath({ id: 'component', route: 'component:components/cy/detail/index' }, fixture), '/pages/detail/index?id=42&scene=audit')
  assert.throws(() => launchPath({ id: 'wrong', route: 'component:components/cy/other/index' }, fixture), /componentPath/)
})

test('组件动作只在已绑定的组件实例内找控件，不能命中同页其它组件', async () => {
  const buttonA = { id: 'button-a', attribute: async () => null }
  const buttonB = { id: 'button-b', attribute: async () => null }
  const componentA = { $$: async (selector) => selector === '.cta' ? [buttonA] : [], data: async () => ({}) }
  const componentB = { $$: async (selector) => selector === '.cta' ? [buttonB] : [], data: async () => ({}) }
  const page = {
    $$: async (selector) => selector === '#component-a' ? [componentA]
      : selector === '#component-b' ? [componentB] : [],
  }
  const action = {
    id: 'component-a-action', route: 'component:components/cy/a/index', interactionMode: 'tap',
    control: { selectorHint: '.cta', ariaLabel: null, ariaLabelExpression: null },
  }
  const scope = await resolveActionScope(page, action, {
    componentHostPath: [{ selector: '#component-a', index: 0 }],
  })
  const selected = await selectElement(scope, action, {}, { selector: '.cta' })
  assert.equal(selected.element, buttonA)
  assert.notEqual(selected.element, buttonB)
  await assert.rejects(resolveActionScope(page, action, {
    componentHostPath: [{ selector: '#missing', index: 0 }],
  }), /不存在/)
})

test('遮挡探测不得把通配符翻译成 DevTools 不接受的 wx-* selector', async () => {
  const selectors = []
  const page = {
    $$: async (selector) => {
      selectors.push(selector)
      if (selector === '*') throw new Error("'wx-*' is not a valid selector")
      return []
    },
  }
  const selected = { id: 'target', $$: async () => [] }
  const overlays = await coveringOverlays(page, selected, '.target', {
    offset: { left: 10, top: 10 }, size: { width: 44, height: 44 },
  })
  assert.deepEqual(overlays, [])
  assert.ok(selectors.length > 0)
  assert.ok(selectors.every((selector) => selector !== '*'))
})

test('遮挡探测忽略普通文档流重叠框，只拦 fixed/absolute/sticky 或原生覆盖节点', async () => {
  function candidate(id, position, zIndex) {
    return {
      id,
      tagName: 'view',
      style: async (name) => ({
        position, 'z-index': String(zIndex), display: 'flex', visibility: 'visible', opacity: '1', 'pointer-events': 'auto',
      })[name],
      size: async () => ({ width: 100, height: 100 }),
      offset: async () => ({ left: 0, top: 0 }),
      $: async () => null,
      $$: async () => [],
    }
  }
  const normalFlow = candidate('normal', 'static', 0)
  const absolute = candidate('absolute', 'absolute', 1)
  const page = { $$: async (selector) => selector.split(',').includes('view') ? [normalFlow, absolute] : [] }
  const selected = { id: 'target', $$: async () => [] }
  const overlays = await coveringOverlays(page, selected, '.target', {
    offset: { left: 10, top: 10 }, size: { width: 44, height: 44 },
  })
  assert.deepEqual(overlays.map((item) => item.tag), ['view'])
  assert.equal(overlays[0].zIndex, 1)
})

test('cy-* 自定义组件必须点击真实内层根节点，不能用 dispatchEvent 冒充用户点击', async () => {
  const calls = []
  const inner = {
    tap: async () => calls.push('tap'),
    dispatchEvent: async () => { throw new Error('dispatchEvent 不会触发组件 WXML catchtap') },
  }
  const host = {
    tap: async () => { throw new Error('custom component host tap 不会触发内部 catchtap') },
    $: async (selector) => selector === '.cell' ? inner : null,
  }
  const transport = await performTapInteraction(host, { id: 'cell-action', control: { tag: 'cy-cell' } })
  assert.equal(transport, 'miniprogram-automator inner Element.tap')
  assert.deepEqual(calls, ['tap'])
})

test('component: 内部原生 tap 同样必须 dispatch，shadow tree 的 Element.tap 不得假绿', async () => {
  const calls = []
  const element = {
    tap: async () => { throw new Error('shadow tree Element.tap 不应被调用') },
    dispatchEvent: async (detail) => calls.push(detail),
  }
  const transport = await performTapInteraction(element, {
    id: 'component-root-action', route: 'component:components/cy/btn/index', control: { tag: 'view' },
  })
  assert.equal(transport, 'miniprogram-automator custom-component dispatchEvent')
  assert.deepEqual(calls, [{ eventName: 'tap' }])
})

test('自定义组件的可达性与遮挡检查必须绑定实际点击的内部根节点', async () => {
  const inner = { id: 'inner', tap: async () => {} }
  const host = { id: 'host', $: async (selector) => selector === '.btn' ? inner : null }
  const target = await resolveTapInteractionTarget(host, { id: 'btn-action', control: { tag: 'cy-btn' } })
  assert.equal(target, inner)
  assert.notEqual(target, host)
  await performTapInteraction(host, { id: 'btn-action', control: { tag: 'cy-btn' } }, target)
})

test('wx.showModal 动作必须显式驱动原生确认或取消并返回绑定分支的回执', async () => {
  const calls = []
  const mp = { native: () => ({
    confirmModal: async () => calls.push('confirm'),
    cancelModal: async () => calls.push('cancel'),
  }) }
  const action = { id: 'team-kick', confirmationMode: 'wx.showModal' }
  assert.deepEqual(await completeModalInteraction(mp, action, 'success', 'fixture-1', async () => {}), {
    actionId: 'team-kick', branch: 'success', fixtureId: 'fixture-1',
    kind: 'wx.showModal', decision: 'confirm', nativeObserved: true, attempts: 1,
  })
  assert.deepEqual(await completeModalInteraction(mp, action, 'modal-cancelled', 'fixture-1', async () => {}), {
    actionId: 'team-kick', branch: 'modal-cancelled', fixtureId: 'fixture-1',
    kind: 'wx.showModal', decision: 'cancel', nativeObserved: true, attempts: 1,
  })
  assert.deepEqual(calls, ['confirm', 'cancel'])
})

test('异步确认框必须轮询到 DevTools 原生 modal 真出现，超前调用不能自造回执', async () => {
  let attempts = 0
  const mp = { native: () => ({
    confirmModal: async () => {
      attempts += 1
      if (attempts < 3) throw new Error('no modal')
    },
  }) }
  const previousTimeout = process.env.ACTION_MODAL_TIMEOUT_MS
  const previousPoll = process.env.ACTION_MODAL_POLL_MS
  process.env.ACTION_MODAL_TIMEOUT_MS = '30'
  process.env.ACTION_MODAL_POLL_MS = '10'
  const receipt = await completeModalInteraction(
    mp, { id: 'async-confirm', confirmationMode: 'wx.showModal' }, 'success', 'fixture-1', async () => {},
  )
  assert.equal(receipt.nativeObserved, true)
  assert.equal(receipt.attempts, 3)
  if (previousTimeout == null) delete process.env.ACTION_MODAL_TIMEOUT_MS
  else process.env.ACTION_MODAL_TIMEOUT_MS = previousTimeout
  if (previousPoll == null) delete process.env.ACTION_MODAL_POLL_MS
  else process.env.ACTION_MODAL_POLL_MS = previousPoll
})

test('视口下方控件必须先滚入安全区，再执行交互', async () => {
  const scrolls = []
  const mp = { pageScrollTo: async (top) => scrolls.push(top) }
  const viewport = { width: 390, height: 760, safeArea: { top: 44, bottom: 726 } }
  const offscreen = {
    offset: async () => ({ left: 20, top: 920 }),
    size: async () => ({ width: 350, height: 50 }),
  }
  assert.equal(await scrollElementIntoView(mp, offscreen, viewport), true)
  assert.deepEqual(scrolls, [864])

  const visible = {
    offset: async () => ({ left: 20, top: 120 }),
    size: async () => ({ width: 350, height: 50 }),
  }
  assert.equal(await scrollElementIntoView(mp, visible, viewport), false)
  assert.deepEqual(scrolls, [864])

  const documentOffset = {
    offset: async () => ({ left: 0, top: 825.5 }),
    size: async () => ({ width: 390, height: 66 }),
  }
  assert.equal(await scrollElementIntoView(mp, documentOffset, viewport, 200), false)
})

test('Element.getOffset 的文档坐标必须扣除 page.scrollTop 后再做安全区判断', async () => {
  const element = {
    size: async () => ({ width: 390, height: 66 }),
    offset: async () => ({ left: 0, top: 825.5 }),
    attribute: async () => null,
    style: async (name) => ({ display: 'flex', visibility: 'visible', opacity: '1', 'pointer-events': 'auto' })[name] || 'auto',
  }
  const metrics = await elementMetrics(element, { width: 390, height: 844 }, 141.5)
  assert.deepEqual(metrics.documentOffset, { left: 0, top: 825.5 })
  assert.deepEqual(metrics.offset, { left: 0, top: 684 })
  assert.equal(metrics.scrollTop, 141.5)
})

test('基线轮询必须等到连续两次相同，持续变化则 fail-closed', async () => {
  const changingThenStable = [
    { routeStack: ['a'], dataDigest: '1', domDigest: '1' },
    { routeStack: ['a'], dataDigest: '2', domDigest: '2' },
    { routeStack: ['a'], dataDigest: '2', domDigest: '2' },
  ]
  const stable = await waitForStableBaseline(
    async () => changingThenStable.shift(),
    { intervalMs: 1, timeoutMs: 100, wait: async () => {} },
  )
  assert.equal(stable.before.dataDigest, '2')

  let serial = 0
  await assert.rejects(waitForStableBaseline(
    async () => ({ routeStack: ['a'], dataDigest: String(serial++), domDigest: String(serial) }),
    { intervalMs: 1, timeoutMs: 50, wait: async () => {} },
  ), /持续变化/)
})

test('导航动作必须轮询到目标页面栈，不能用固定 500ms 截图制造假失败', async () => {
  const before = { routeStack: [{ path: 'pages/shezhi/shezhi', query: {} }] }
  let captures = 0
  let logicalNow = 0
  let clockReads = 0
  const after = await waitForObservedNavigation(async () => {
    captures += 1
    return captures < 3
      ? { routeStack: before.routeStack }
      : { routeStack: [...before.routeStack, { path: 'pages/shezhi/about/index', query: {} }] }
  }, before, {
    id: 'settings-about', effectClasses: ['navigation'],
    targets: { routes: ['pages/shezhi/about/index'] },
  }, {}, {
    intervalMs: 1,
    timeoutMs: 10,
    now: () => { clockReads += 1; return logicalNow },
    wait: async (milliseconds) => { logicalNow += milliseconds },
  })
  assert.equal(captures, 3)
  assert.ok(clockReads > 0, '轮询 deadline 必须使用可注入时钟，避免 CI 调度抢占伪造 10ms 超时')
  assert.equal(after.routeStack.at(-1).path, 'pages/shezhi/about/index')
})

test('导航已观测到错误路由后，后续协议超时不得覆盖精确失败原因', async () => {
  const before = { routeStack: [{ path: 'pages/shezhi/shezhi', query: {} }] }
  let captures = 0
  await assert.rejects(() => waitForObservedNavigation(async () => {
    captures += 1
    if (captures === 1) {
      return {
        routeStack: [...before.routeStack, { path: 'pages/shezhi/about/index', query: {} }],
        dataDigest: 'after',
        domDigest: 'after',
      }
    }
    return new Promise(() => {})
  }, before, {
    id: 'settings-about', effectClasses: ['navigation'],
    targets: { routes: ['pages/index/index'] },
  }, {}, { intervalMs: 1, timeoutMs: 20, wait: async () => {} }), /实际目标 route pages\/shezhi\/about\/index 不符合预期 pages\/index\/index/)
})

test('运行态 pageStack 与导航 capture 永不回调时都必须按墙钟 deadline 判红', async () => {
  const originalTimeout = process.env.DEVTOOLS_STACK_CALL_TIMEOUT_MS
  process.env.DEVTOOLS_STACK_CALL_TIMEOUT_MS = '5'
  try {
    await assert.rejects(() => routeStack({ pageStack: () => new Promise(() => {}) }), /pageStack 在 5ms 内未返回/)
  } finally {
    if (originalTimeout === undefined) delete process.env.DEVTOOLS_STACK_CALL_TIMEOUT_MS
    else process.env.DEVTOOLS_STACK_CALL_TIMEOUT_MS = originalTimeout
  }

  await assert.rejects(() => waitForObservedNavigation(
    () => new Promise(() => {}),
    { routeStack: [{ path: 'pages/shezhi/shezhi', query: {} }] },
    { id: 'settings-about', effectClasses: ['navigation'] },
    {},
    { intervalMs: 1, timeoutMs: 5, wait: async () => {} }
  ), /导航终态在 5ms 内未出现/)

  await assert.rejects(() => waitForStableBaseline(
    () => new Promise(() => {}),
    { intervalMs: 1, timeoutMs: 5, wait: async () => {} }
  ), /页面基线采集在 5ms 内未返回/)
})

test('event-contract 只能驱动当前 action 元素，并按真实绑定事件执行', async () => {
  const calls = []
  const element = {
    trigger: async (name, detail) => calls.push({ name, detail }),
    tap: async () => calls.push({ name: 'tap' }),
    input: async (value) => calls.push({ name: 'input', value }),
  }
  const receipt = await interactionSequence.perform({
    action: { id: 'change-action', control: { event: 'bindchange' } },
    fixture: { id: 'fixture-1' },
    expectation: { event: { detail: { value: 'A' } } },
    element,
    page: { $$: async () => { throw new Error('不得查询或驱动其它 selector') } },
  })
  assert.deepEqual(calls, [{ name: 'change', detail: { value: 'A' } }])
  assert.equal(receipt.observed.nativeEvent, 'change')
})

test('复合写按分支生成有序请求计划，首步失败不能伪造第二步已调用', () => {
  const action = {
    id: 'compound',
    requiredRequests: [
      { urlTemplate: '/api/publish', method: 'POST' },
      { urlTemplate: '/api/broadcast', method: 'POST' },
    ],
    requiredRequestOutcomes: {
      success: ['success', 'success'],
      'publish-error': ['error'],
      'broadcast-error-after-publish': ['success', 'error'],
    },
  }
  assert.deepEqual(authorityRequestPlan(action, 'publish-error', {
    requests: [{ urlTemplate: '/api/publish', method: 'POST' }],
  }).map((item) => item.outcome), ['error'])
  assert.deepEqual(authorityRequestPlan(action, 'broadcast-error-after-publish', {
    requests: [
      { urlTemplate: '/api/publish', method: 'POST' },
      { urlTemplate: '/api/broadcast', method: 'POST' },
    ],
  }).map((item) => item.outcome), ['success', 'error'])
  assert.throws(() => authorityRequestPlan(action, 'success', {
    requests: [{ urlTemplate: '/api/publish', method: 'POST' }],
  }), /2 个有序/)
})
