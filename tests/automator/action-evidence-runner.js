'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { closeMiniProgram, openMiniProgram, withDeadline } = require('./harness')
const {
  assertAccessible,
  assertBaselineStable,
  assertInteractable,
  assertNoCoveringOverlay,
  judgeFailureEffect,
  judgeObservedEffect,
  normalizeControlSelector,
  selectUniqueTapTarget,
} = require('../../scripts/uiaudit/action-runtime')
const {
  authorityKindFor,
  fixtureDigest,
  parseObjectEnv,
  provenanceGeneration,
  redactEvidence,
  validateAuthorityEvidence,
  validateAuthorityReceipt,
  validateActionLocator,
  validateBranchReceipt,
  validateFragment,
  validateFixture,
  writeFragment,
} = require('../../scripts/uiaudit/action-evidence-store')
const {
  buildLedger,
  sourceDigestAtCommit,
  sourceDigestFor,
} = require('../../scripts/uiaudit/build-action-ledger')

const PROJECT_PATH = path.resolve(__dirname, '..', '..')

const CUSTOM_COMPONENT_TAP_TARGETS = Object.freeze({
  'cy-avatar': '.av',
  'cy-btn': '.btn',
  'cy-card': '.cy-card',
  'cy-cell': '.cell',
  'cy-club-card': '.cc',
  'cy-merchant-card': '.mc',
})

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function readDataPath(data, key) {
  return String(key).split('.').reduce((value, part) => (value == null ? undefined : value[part]), data)
}

async function routeStack(mp) {
  const timeoutMs = Number(process.env.DEVTOOLS_STACK_CALL_TIMEOUT_MS || 5000)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`非法 DEVTOOLS_STACK_CALL_TIMEOUT_MS: ${timeoutMs}`)
  }
  const pages = await withDeadline(
    mp.pageStack(),
    timeoutMs,
    `pageStack 在 ${timeoutMs}ms 内未返回`
  )
  return pages.map((page) => ({ path: page.path, query: page.query || {} }))
}

async function snapshot(mp, page) {
  const root = await page.$('page')
  const data = await page.data()
  const dom = root ? await root.outerWxml() : ''
  return {
    routeStack: await routeStack(mp),
    dataDigest: sha256(stableJson(data)),
    domDigest: sha256(dom),
    data,
  }
}

async function waitForStableBaseline(capture, options) {
  const settings = options || {}
  const intervalMs = Math.max(1, Number(settings.intervalMs || 500))
  const timeoutMs = Math.max(intervalMs, Number(settings.timeoutMs || 4000))
  const wait = settings.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs))
  const deadline = Date.now() + timeoutMs
  const captureBeforeDeadline = () => {
    const remainingMs = Math.max(1, deadline - Date.now())
    return withDeadline(capture(), remainingMs, `页面基线采集在 ${timeoutMs}ms 内未返回`)
  }
  let previous = await captureBeforeDeadline()
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await wait(Math.min(intervalMs, remainingMs))
    const current = await captureBeforeDeadline()
    try {
      assertBaselineStable(previous, current)
      return { baseline: previous, before: current }
    } catch (error) {
      lastError = error
      previous = current
    }
  }
  throw new Error(`页面基线在 ${timeoutMs}ms 内持续变化，拒绝在异步漂移中点击: ${lastError && lastError.message}`)
}

async function waitForObservedNavigation(capture, before, action, expectation, options) {
  const settings = options || {}
  const intervalMs = Math.max(1, Number(settings.intervalMs || 250))
  const timeoutMs = Math.max(intervalMs, Number(settings.timeoutMs || 4000))
  const wait = settings.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const now = typeof settings.now === 'function' ? settings.now : Date.now
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs))
  const deadline = now() + timeoutMs
  const navigationAction = { ...action, effectClasses: ['navigation'] }
  let lastError = null
  let lastObservationError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remainingBeforeWait = deadline - now()
    if (remainingBeforeWait <= 0) break
    await wait(Math.min(intervalMs, remainingBeforeWait))
    let current
    try {
      const remainingMs = Math.max(1, deadline - now())
      current = await withDeadline(
        capture(),
        remainingMs,
        `导航终态采集在 ${timeoutMs}ms 内未返回`
      )
    } catch (error) {
      lastError = error
      continue
    }
    try {
      judgeObservedEffect(navigationAction, before, current, expectation)
      return current
    } catch (error) {
      lastError = error
      lastObservationError = error
    }
  }
  const cause = lastObservationError || lastError
  throw new Error(`导航终态在 ${timeoutMs}ms 内未出现: ${cause && cause.message}`)
}

async function elementMetrics(element, viewport, scrollTop) {
  const [size, documentOffset, disabled, hidden, display, visibility, opacity, pointerEvents, position, zIndex,
    ariaLabel, ariaRole, ariaDisabled, ariaExpanded, ariaChecked, text] = await Promise.all([
    element.size(), element.offset(), element.attribute('disabled'), element.attribute('hidden'),
    element.style('display'), element.style('visibility'), element.style('opacity'), element.style('pointer-events'),
    element.style('position'), element.style('z-index'),
    element.attribute('aria-label'), element.attribute('aria-role'), element.attribute('aria-disabled'),
    element.attribute('aria-expanded'), element.attribute('aria-checked'),
    typeof element.text === 'function' ? element.text() : '',
  ])
  const pageScrollTop = Number(scrollTop) || 0
  const offset = {
    left: Number(documentOffset.left),
    top: Number(documentOffset.top) - pageScrollTop,
  }
  return {
    size, offset, documentOffset, scrollTop: pageScrollTop,
    disabled, hidden, display, visibility, opacity, pointerEvents, position, zIndex, viewport,
    tagName: element.tagName || null, text: String(text || '').trim(),
    ariaLabel, ariaRole, ariaDisabled, ariaExpanded, ariaChecked,
  }
}

async function viewportMetrics(mp) {
  const value = await mp.evaluate(() => {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    return { width: info.windowWidth, height: info.windowHeight, safeArea: info.safeArea || null, menuButton }
  })
  if (!value || !Number(value.width) || !Number(value.height)) throw new Error('无法读取视口与安全区')
  return value
}

async function scrollElementIntoView(mp, element, viewport, scrollTop) {
  const [offset, size] = await Promise.all([element.offset(), element.size()])
  const safeTop = Number(viewport.safeArea && viewport.safeArea.top) || 0
  const safeBottom = Number(viewport.safeArea && viewport.safeArea.bottom) || Number(viewport.height)
  const documentTop = Number(offset.top)
  const top = documentTop - (Number(scrollTop) || 0)
  const bottom = top + Number(size.height)
  if (top >= safeTop && bottom <= safeBottom) return false
  const targetScrollTop = Math.max(0, documentTop - safeTop - 12)
  await mp.pageScrollTo(targetScrollTop)
  return true
}

async function coveringOverlays(page, selected, selector, metrics) {
  const center = {
    x: Number(metrics.offset.left) + Number(metrics.size.width) / 2,
    y: Number(metrics.offset.top) + Number(metrics.size.height) / 2,
  }
  // DevTools 36.x 会把 `*` 翻译成非法的 `wx-*`，真实运行直接抛 DOMException。
  // 分类型查询实际可能承载/遮挡点击的节点；自定义组件的可见面最终仍落到这些基础节点。
  const inspectableTags = [
    'view', 'cover-view', 'cover-image', 'button', 'image', 'text', 'rich-text', 'navigator',
    'scroll-view', 'swiper', 'swiper-item', 'movable-area', 'movable-view', 'input', 'textarea',
    'picker', 'picker-view', 'slider', 'switch', 'canvas', 'map', 'video', 'camera', 'web-view',
  ]
  // 单次 group selector 既避开 `wx-*`，又保留 DOM/paint 顺序；逐 tag 合并会把所有 view
  // 人工排到 image/swiper 前面，随后用 candidateIndex 判断同 z-index 时会制造假遮挡。
  const inspectableSelector = inspectableTags.join(',')
  const queryInspectable = async (scope) => scope.$$(inspectableSelector)
  const candidates = await queryInspectable(page)
  const targetIndex = candidates.findIndex((candidate) => candidate.id === selected.id)
  const descendants = new Set((await queryInspectable(selected)).map((candidate) => candidate.id))
  const covering = []
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex]
    if (candidate.id === selected.id || descendants.has(candidate.id)) continue
    const [position, zIndex, display, visibility, opacity, pointerEvents, size, offset] = await Promise.all([
      candidate.style('position'), candidate.style('z-index'), candidate.style('display'), candidate.style('visibility'),
      candidate.style('opacity'), candidate.style('pointer-events'), candidate.size(), candidate.offset(),
    ])
    const layer = Number.parseInt(zIndex, 10) || 0
    const nativeOverlay = ['cover-view', 'cover-image', 'map', 'video', 'camera', 'canvas', 'web-view']
      .includes(String(candidate.tagName || '').toLowerCase())
    const canOverlay = ['fixed', 'absolute', 'sticky'].includes(position)
      || (position === 'relative' && layer !== 0) || nativeOverlay
    if (!canOverlay || layer < 0
        || (layer === 0 && targetIndex >= 0 && candidateIndex < targetIndex)
        || display === 'none' || visibility === 'hidden'
        || Number(opacity) === 0 || pointerEvents === 'none') continue
    const fixedToViewport = position === 'fixed' || position === 'sticky'
    const candidateLeft = Number(offset.left)
    const candidateTop = Number(offset.top) - (fixedToViewport ? 0 : Number(metrics.scrollTop || 0))
    const containsCenter = center.x >= candidateLeft && center.x <= candidateLeft + Number(size.width)
      && center.y >= candidateTop && center.y <= candidateTop + Number(size.height)
    if (!containsCenter) continue
    const nested = await candidate.$(selector)
    if (nested && nested.id === selected.id) continue
    covering.push({ tag: candidate.tagName, zIndex: layer, offset, size })
  }
  return covering
}

async function resolveActionScope(page, action, locator) {
  if (!String(action.route || '').startsWith('component:')) return page
  if (!locator || !Array.isArray(locator.componentHostPath) || !locator.componentHostPath.length) {
    throw new Error(`${action.id}: component fixture 缺少 componentHostPath`)
  }
  let scope = page
  for (const segment of locator.componentHostPath) {
    const matches = await scope.$$(segment.selector)
    if (!Array.isArray(matches) || !matches[segment.index]) {
      throw new Error(`${action.id}: 宿主组件实例 ${segment.selector}[${segment.index}] 不存在`)
    }
    scope = matches[segment.index]
  }
  if (!scope || typeof scope.$$ !== 'function' || typeof scope.data !== 'function') {
    throw new Error(`${action.id}: componentHostPath 未解析到可查询、可回读 data 的组件实例`)
  }
  return scope
}

async function selectElement(scope, action, expectation, locator) {
  const selector = locator && locator.selector ? locator.selector : normalizeControlSelector(action.control)
  let matches = await scope.$$(selector)
  const expectedLabel = action.interactionMode === 'tap' ? (action.control.ariaLabel
    || (action.control.ariaLabelExpression && expectation && expectation.accessibility && expectation.accessibility.label)) : null
  if (action.interactionMode === 'tap' && action.control.ariaLabelExpression && !String(expectedLabel || '').trim()) {
    throw new Error(`${action.id}: 动态 aria-label 必须提供 ACTION_EXPECT_JSON.accessibility.label`)
  }
  if (expectedLabel) {
    const filtered = []
    for (const element of matches) {
      if (await element.attribute('aria-label') === expectedLabel) filtered.push(element)
    }
    matches = filtered
  }
  if (locator && locator.expectedText != null) {
    const filtered = []
    for (const element of matches) {
      if (String(await element.text()).trim() === String(locator.expectedText).trim()) filtered.push(element)
    }
    matches = filtered
  }
  if (locator && locator.instance) {
    if (!/^data-[\w-]+$/.test(locator.instance.attribute) || !locator.instance.value) {
      throw new Error(`${action.id}: locator.instance 必须绑定 data-* attribute/value`)
    }
    const filtered = []
    for (const element of matches) {
      if (String(await element.attribute(locator.instance.attribute)) === locator.instance.value) filtered.push(element)
    }
    matches = filtered
  }
  if (locator) {
    return { element: selectUniqueTapTarget(matches, action), selector }
  }
  return { element: selectUniqueTapTarget(matches, action), selector }
}

function tapStrategyFor(action) {
  const tag = String(action && action.control && action.control.tag || '').toLowerCase()
  const innerSelector = CUSTOM_COMPONENT_TAP_TARGETS[tag]
  if (innerSelector) {
    return { innerSelector, transport: 'miniprogram-automator inner Element.tap' }
  }
  if (String(action && action.route || '').startsWith('component:')) {
    return { innerSelector: null, transport: 'miniprogram-automator custom-component dispatchEvent' }
  }
  return { innerSelector: null, transport: 'miniprogram-automator Element.tap' }
}

async function resolveTapInteractionTarget(element, action) {
  const tag = String(action && action.control && action.control.tag || '').toLowerCase()
  const { innerSelector, transport } = tapStrategyFor(action)
  if (transport === 'miniprogram-automator Element.tap') return element
  const physical = innerSelector ? await element.$(innerSelector) : element
  if (!physical) throw new Error(`${action.id}: ${tag} 缺少可触达的内部根节点 ${innerSelector}`)
  return physical
}

async function performTapInteraction(element, action, resolvedTarget) {
  const physical = resolvedTarget || await resolveTapInteractionTarget(element, action)
  const { transport } = tapStrategyFor(action)
  if (transport !== 'miniprogram-automator custom-component dispatchEvent') {
    await physical.tap()
    return transport
  }
  // component: 动作已经在 shadow tree 内解析到原生节点；这里保留协议层事件派发并在证据中明示。
  // cy-* 宿主则必须找到真实内层根节点后调用 Element.tap()，因为 dispatchEvent 不会执行 WXML catchtap。
  await physical.dispatchEvent({ eventName: 'tap' })
  return transport
}

async function completeModalInteraction(mp, action, branch, fixtureId, wait) {
  if (!action || action.confirmationMode !== 'wx.showModal') return null
  const pause = wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const decision = branch === 'modal-cancelled' ? 'cancel' : 'confirm'
  const native = mp.native()
  if (!native || typeof native[`${decision}Modal`] !== 'function') {
    throw new Error(`${action.id}: DevTools native API 不支持 ${decision}Modal`)
  }
  const pollMs = Math.max(10, Number(process.env.ACTION_MODAL_POLL_MS || 100))
  const timeoutMs = Math.max(pollMs, Number(process.env.ACTION_MODAL_TIMEOUT_MS || 4000))
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollMs))
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await pause(attempt === 1 ? Number(process.env.ACTION_MODAL_SETTLE_MS || 150) : pollMs)
    try {
      await native[`${decision}Modal`]()
      // Tool.native 只有在 DevTools 原生弹框真实存在且完成对应按钮操作时才 resolve；
      // 提前调用会 reject 并继续轮询，因此 receipt 不是 runner 自报的“假点击”。
      return {
        actionId: action.id, branch, fixtureId, kind: 'wx.showModal', decision,
        nativeObserved: true, attempts: attempt,
      }
    } catch (error) { lastError = error }
  }
  throw new Error(`${action.id}: ${timeoutMs}ms 内未观察到可${decision === 'confirm' ? '确认' : '取消'}的原生 modal: ${lastError && lastError.message}`)
}

function modalCancellationEffect(action, before, after) {
  if (JSON.stringify(before.routeStack) !== JSON.stringify(after.routeStack)
      || before.dataDigest !== after.dataDigest || before.domDigest !== after.domDigest) {
    throw new Error(`${action.id}: 取消确认后出现未声明的页面、数据或 DOM 变化`)
  }
  return { assertions: { failure: { branch: 'modal-cancelled', unchanged: true } } }
}

function launchPath(action, fixture) {
  const entry = fixture.entry
  if (action.route.startsWith('component:')) {
    const componentPath = action.route.slice('component:'.length)
    if (fixture.locator.componentPath !== componentPath) {
      throw new Error(`${action.id}: component fixture locator.componentPath 未绑定 ${componentPath}`)
    }
  } else if (entry.route !== action.route) {
    throw new Error(`${action.id}: fixture entry.route 必须等于动作 route`)
  }
  const query = new URLSearchParams(Object.entries(entry.query).map(([key, value]) => [key, String(value)]))
  return `/${entry.route}${query.toString() ? `?${query}` : ''}`
}

function predicateMatches(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.prototype.hasOwnProperty.call(expected, '$not')) return actual !== expected.$not
    if (Array.isArray(expected.$notIn)) return !expected.$notIn.includes(actual)
    if (Object.prototype.hasOwnProperty.call(expected, '$gt')) return Number(actual) > Number(expected.$gt)
    if (Array.isArray(expected.$someTrue)) {
      return !!actual && expected.$someTrue.some((key) => actual[key] === true)
    }
  }
  return actual === expected
}

function outputLocations(action, branch, fixture, sourceSha) {
  const token = sha256([action.id, branch, fixtureDigest(fixture), sourceSha].join('\0')).slice(0, 24)
  const configured = process.env.ACTION_SCREENSHOT_DIR
  const releaseRoot = path.join(PROJECT_PATH, 'scripts/uiaudit/evidence/artifacts')
  const root = configured
    ? (path.isAbsolute(configured) ? configured : path.resolve(PROJECT_PATH, configured))
    : (process.env.ACTION_RECORD_FRAGMENT === '1' ? releaseRoot : path.join(os.tmpdir(), 'chengyin-action-audit'))
  if (process.env.ACTION_RECORD_FRAGMENT === '1'
      && root !== releaseRoot && !root.startsWith(`${releaseRoot}${path.sep}`)) {
    throw new Error('record 模式 ACTION_SCREENSHOT_DIR 必须位于 scripts/uiaudit/evidence/artifacts/')
  }
  fs.mkdirSync(root, { recursive: true })
  const unique = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  const release = process.env.ACTION_RECORD_FRAGMENT === '1'
  return {
    before: path.join(root, release ? `.${token}-before-${unique}.tmp.png` : `${token}-${unique}-before.png`),
    after: path.join(root, release ? `.${token}-after-${unique}.tmp.png` : `${token}-${unique}-after.png`),
    finalBefore: path.join(root, `${token}-${branch}-${unique}-before.png`),
    finalAfter: path.join(root, `${token}-${branch}-${unique}-after.png`),
  }
}

function displayPath(file) {
  return file.startsWith(`${PROJECT_PATH}${path.sep}`) ? path.relative(PROJECT_PATH, file) : file
}

function publicSnapshot(value) {
  return {
    routeStack: value.routeStack,
    dataDigest: value.dataDigest,
    domDigest: value.domDigest,
  }
}

function parseExpectation(action) {
  const raw = process.env.ACTION_EXPECT_JSON
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是 object')
    return parsed
  } catch (error) {
    throw new Error(`${action.id}: ACTION_EXPECT_JSON 非法: ${error.message}`)
  }
}

function loadReadbackAdapter(action) {
  const kind = authorityKindFor(action)
  if (!kind) return null
  const relative = process.env.ACTION_READBACK_ADAPTER
  if (!relative) throw new Error(`${action.id}: ${kind} 动作必须提供仓库内 ACTION_READBACK_ADAPTER 权威回读适配器`)
  const resolved = path.resolve(PROJECT_PATH, relative)
  const adapterRoot = path.resolve(PROJECT_PATH, 'tests/automator/readbacks')
  if (!resolved.startsWith(`${adapterRoot}${path.sep}`)) throw new Error('ACTION_READBACK_ADAPTER 必须位于 tests/automator/readbacks')
  delete require.cache[require.resolve(resolved)]
  const adapter = require(resolved)
  if (!adapter || typeof adapter.capture !== 'function') throw new Error(`${relative}: readback adapter 必须 export capture()`)
  return { adapter, relative, resolved, kind }
}

async function captureAuthority(action, loaded, phase, context) {
  if (!loaded) return null
  const capture = await loaded.adapter.capture({ ...context, phase })
  if (!capture || capture.actionId !== action.id || capture.fixtureId !== context.fixture.id
      || !capture.request || !capture.authority || capture.authority.fact === undefined
      || !capture.authority.endpoint || !capture.authority.resourceId
      || !capture.accessScope || !capture.accessScope.principalFingerprint
      || !Array.isArray(capture.assertions) || capture.assertions.length === 0) {
    throw new Error(`${loaded.relative}: ${phase} 权威观测缺少 action/fixture/request/authority.fact/assertions`)
  }
  return capture
}

function authorityRequestPlan(action, branch, expectation) {
  const branchRequests = action.requiredRequestsByBranch && action.requiredRequestsByBranch[branch]
  const required = Array.isArray(branchRequests) ? branchRequests
    : (Array.isArray(action.requiredRequests) ? action.requiredRequests : [])
  if (!required.length) return [{ expectedRequest: expectation.request, outcome: branch, requestIndex: 0 }]
  const outcomes = action.requiredRequestOutcomes && action.requiredRequestOutcomes[branch]
  const declared = expectation && expectation.requests
  if (!Array.isArray(outcomes) || !Array.isArray(declared) || declared.length !== outcomes.length) {
    throw new Error(`${action.id}: ${branch} 必须声明 ${outcomes ? outcomes.length : 0} 个有序 expectation.requests`)
  }
  return outcomes.map((outcome, index) => {
    const expected = required[index]
    const actual = declared[index]
    if (!actual || actual.urlTemplate !== expected.urlTemplate
        || String(actual.method).toUpperCase() !== String(expected.method).toUpperCase()) {
      throw new Error(`${action.id}: expectation.requests[${index}] 未命中静态有序请求合同`)
    }
    return { expectedRequest: actual, outcome, requestIndex: index }
  })
}

async function captureAuthoritySequence(action, loaded, phase, context, plan) {
  if (!loaded) return []
  const captures = []
  for (const item of plan) {
    captures.push(await captureAuthority(action, loaded, phase, {
      ...context,
      requestIndex: item.requestIndex,
      requestExpectation: item.expectedRequest,
      expectation: { ...context.expectation, request: item.expectedRequest },
    }))
  }
  return captures
}

function composeAuthorityReceipt(action, loaded, branch, beforeCapture, afterCapture, expectedRequest, fixtureAttestation) {
  if (!loaded) return null
  for (const key of ['url', 'method', 'resourceId', 'authMode']) {
    if (beforeCapture.request[key] !== afterCapture.request[key]) throw new Error(`${action.id}: 权威观测前后 request.${key} 不一致`)
  }
  if (beforeCapture.authority.resourceId !== afterCapture.authority.resourceId
      || beforeCapture.authority.endpoint !== afterCapture.authority.endpoint) {
    throw new Error(`${action.id}: 权威观测前后不是同一资源`)
  }
  if (JSON.stringify(beforeCapture.accessScope) !== JSON.stringify(afterCapture.accessScope)) {
    throw new Error(`${action.id}: 权威观测前后 accessScope 不一致`)
  }
  const receipt = {
    actionId: action.id,
    fixtureId: beforeCapture.fixtureId,
    request: beforeCapture.request,
    authority: {
      endpoint: beforeCapture.authority.endpoint,
      resourceId: beforeCapture.authority.resourceId,
      before: beforeCapture.authority.fact,
      after: afterCapture.authority.fact,
    },
    mapping: afterCapture.mapping,
    timeoutResolution: afterCapture.timeoutResolution,
    expectedRequest,
    accessScope: beforeCapture.accessScope,
    assertions: beforeCapture.assertions.concat(afterCapture.assertions),
    controlPlaneAttestations: [beforeCapture.controlPlaneAttestation, afterCapture.controlPlaneAttestation].filter(Boolean),
  }
  return validateAuthorityReceipt(action, receipt, loaded.kind, branch, fixtureAttestation)
}

function composeAuthorityEvidence(action, loaded, plan, beforeCaptures, afterCaptures, fixtureAttestation) {
  if (!loaded) return null
  const sequence = plan.map((item, index) => composeAuthorityReceipt(
    action, loaded, item.outcome, beforeCaptures[index], afterCaptures[index], item.expectedRequest, fixtureAttestation,
  ))
  const traceCandidates = afterCaptures.map((capture) => capture && capture.requestTrace)
    .filter((trace) => Array.isArray(trace))
  if (traceCandidates.length > 1) {
    const canonical = JSON.stringify(traceCandidates[0])
    if (traceCandidates.some((trace) => JSON.stringify(trace) !== canonical)) {
      throw new Error(`${action.id}: 受控后端返回的 requestTrace 前后不一致`)
    }
  }
  const evidence = action.requiredRequests
    ? { sequence, ...(traceCandidates.length ? { requestTrace: traceCandidates[0] } : {}) }
    : sequence[0]
  return validateAuthorityEvidence(
    action, evidence, loaded.kind, action.requiredRequests ? plan.branch : plan[0].outcome, fixtureAttestation,
  )
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(PROJECT_PATH, '..'), encoding: 'utf8' }).trim()
}

function publishScreenshots(shots) {
  if (process.env.ACTION_RECORD_FRAGMENT !== '1') return [shots.before, shots.after]
  const pairs = [[shots.before, shots.finalBefore], [shots.after, shots.finalAfter]]
  pairs.forEach(([, final]) => {
    if (fs.existsSync(final)) throw new Error(`证据截图已存在，拒绝覆盖: ${displayPath(final)}`)
  })
  pairs.forEach(([temporary, final]) => {
    const fd = fs.openSync(temporary, 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.linkSync(temporary, final)
    fs.unlinkSync(temporary)
  })
  const dirFd = fs.openSync(path.dirname(shots.finalBefore), 'r')
  try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
  return [shots.finalBefore, shots.finalAfter]
}

function screenshotArtifacts(files) {
  return files.map((file) => ({ uri: displayPath(file), sha256: sha256(fs.readFileSync(file)) }))
}

function loadBranchDriver(action, branch) {
  if (branch === 'success' || (action.confirmationMode === 'wx.showModal' && branch === 'modal-cancelled')) return null
  const relative = process.env.ACTION_BRANCH_DRIVER
  if (!relative) throw new Error(`${action.id}: ${branch} 分支必须提供 ACTION_BRANCH_DRIVER`)
  const resolved = path.resolve(PROJECT_PATH, relative)
  const root = path.resolve(PROJECT_PATH, 'tests/automator/branches')
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('ACTION_BRANCH_DRIVER 必须位于 tests/automator/branches')
  delete require.cache[require.resolve(resolved)]
  const driver = require(resolved)
  if (!driver || typeof driver.verify !== 'function') throw new Error(`${relative}: branch driver 必须 export verify()`)
  return { driver, relative, resolved }
}

function loadFixtureDriver() {
  if (process.env.ACTION_RECORD_FRAGMENT !== '1' && !process.env.ACTION_REPORT) return null
  const relative = process.env.ACTION_FIXTURE_DRIVER
  if (!relative) throw new Error('写入 release fragment 必须提供 ACTION_FIXTURE_DRIVER 验证受控账号')
  const resolved = path.resolve(PROJECT_PATH, relative)
  const root = path.resolve(PROJECT_PATH, 'tests/automator/fixtures')
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('ACTION_FIXTURE_DRIVER 必须位于 tests/automator/fixtures')
  delete require.cache[require.resolve(resolved)]
  const driver = require(resolved)
  if (!driver || typeof driver.setup !== 'function' || typeof driver.verifyIdentity !== 'function') {
    throw new Error(`${relative}: fixture driver 必须 export setup()/verifyIdentity()`)
  }
  return { driver, relative, resolved }
}

function loadEventDriver(action) {
  if (action.interactionMode === 'tap') return null
  const relative = process.env.ACTION_EVENT_DRIVER
  if (!relative) throw new Error(`${action.id}: event-contract 必须提供 ACTION_EVENT_DRIVER`)
  const resolved = path.resolve(PROJECT_PATH, relative)
  const root = path.resolve(PROJECT_PATH, 'tests/automator/events')
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('ACTION_EVENT_DRIVER 必须位于 tests/automator/events')
  delete require.cache[require.resolve(resolved)]
  const driver = require(resolved)
  if (!driver || typeof driver.perform !== 'function') throw new Error(`${relative}: event driver 必须 export perform()`)
  return { driver, relative, resolved }
}

function validateEventReceipt(action, fixture, receipt) {
  if (!receipt || receipt.actionId !== action.id || receipt.event !== action.control.event
      || receipt.fixtureId !== fixture.id || !Array.isArray(receipt.assertions) || receipt.assertions.length === 0
      || !receipt.observed || typeof receipt.observed !== 'object') {
    throw new Error(`${action.id}: event driver 回执未绑定 action/event/fixture/observed`)
  }
  return receipt
}

function validateFixtureAttestation(fixture, attestation) {
  if (!attestation || attestation.fixtureId !== fixture.id || attestation.synthetic !== true
      || attestation.accountRole !== fixture.accountRole || !String(attestation.identityFingerprint || '').trim()
      || !String(attestation.backendBase || '').trim()
      || !/^[0-9a-f]{40}$/i.test(String(attestation.backendDeploymentSha || ''))
      || !Array.isArray(attestation.assertions)
      || attestation.assertions.length === 0) {
    throw new Error('fixture driver 未回读受控账号 identityFingerprint/backendBase/backendDeploymentSha/assertions')
  }
  return attestation
}

function writeReport(report) {
  const target = process.env.ACTION_REPORT
  if (!target) return null
  const resolved = path.resolve(PROJECT_PATH, target)
  const reportRoot = path.join(PROJECT_PATH, 'scripts/uiaudit/evidence/reports')
  if (!resolved.startsWith(`${reportRoot}${path.sep}`) || !resolved.endsWith('.json')) {
    throw new Error('ACTION_REPORT 必须是 scripts/uiaudit/evidence/reports/ 下的新 JSON 文件')
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const temporary = `${resolved}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, `${JSON.stringify(redactEvidence(report), null, 2)}\n`)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  try {
    fs.linkSync(temporary, resolved)
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`ACTION_REPORT 已存在，拒绝覆盖: ${target}`)
    throw error
  } finally {
    try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return path.relative(PROJECT_PATH, resolved)
}

async function main() {
  const actionId = process.env.ACTION_ID
  if (!actionId) throw new Error('缺少 ACTION_ID，拒绝执行未锁定的控件')
  const ledger = buildLedger()
  const action = ledger.controls.find((item) => item.id === actionId)
  if (!action) throw new Error(`Action Ledger 不存在 ${actionId}`)
  if (action.actionClass === 'external') throw new Error(`${actionId}: external 动作只接受真机证据`)
  const branch = String(process.env.ACTION_BRANCH || 'success')
  if (!action.requiredBranches.includes(branch)) throw new Error(`${actionId}: 分支 ${branch} 不在 requiredBranches`)
  const fixture = validateFixture(parseObjectEnv('ACTION_FIXTURE_JSON', true))
  validateActionLocator(action, fixture)
  const branchDriver = loadBranchDriver(action, branch)
  const fixtureDriver = loadFixtureDriver()
  const readbackAdapter = loadReadbackAdapter(action)
  const eventDriver = loadEventDriver(action)

  const sourceSha = gitHead()
  const runNonce = crypto.randomBytes(24).toString('hex')
  const session = await openMiniProgram({ projectPath: PROJECT_PATH })
  const shots = outputLocations(action, branch, fixture, sourceSha)
  let faultActivated = false
  try {
    if (fixtureDriver) await fixtureDriver.driver.setup({ action, branch, fixture, mp: session.mp, runNonce })
    const page = await session.mp.reLaunch(launchPath(action, fixture))
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.ACTION_SETTLE_MS || 1200)))
    if (String(page.path || '').replace(/^\//, '') !== fixture.entry.route) {
      throw new Error(`${action.id}: 实际入口 route 未命中 fixture.entry.route`)
    }
    Object.entries(fixture.entry.query).forEach(([key, value]) => {
      if (String((page.query || {})[key]) !== String(value)) throw new Error(`${action.id}: 入口 query.${key} 未回读一致`)
    })
    const initialScope = await resolveActionScope(page, action, fixture.locator)
    if (action.variant && action.variant.predicate) {
      const stateOwner = action.variant.predicateScope === 'component' ? initialScope : page
      const pageData = await stateOwner.data()
      Object.entries(action.variant.predicate).forEach(([key, expected]) => {
        if (!predicateMatches(readDataPath(pageData, key), expected)) {
          throw new Error(`${action.id}: variant 前置状态 ${key} 未命中 ${JSON.stringify(expected)}`)
        }
      })
    }
    const expectation = parseExpectation(action)
    const requestPlan = authorityRequestPlan(action, branch, expectation)
    requestPlan.branch = branch
    if (branchDriver && typeof branchDriver.driver.setup === 'function') {
      await branchDriver.driver.setup({ action, branch, fixture, expectation, mp: session.mp, page, runNonce })
      faultActivated = true
    }
    let selected = await selectElement(initialScope, action, expectation, fixture.locator)
    let viewport = await viewportMetrics(session.mp)
    let pageScrollTop = typeof page.scrollTop === 'function' ? await page.scrollTop() : 0
    if (action.interactionMode === 'tap'
        && await scrollElementIntoView(session.mp, selected.element, viewport, pageScrollTop)) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const scrolledPage = await session.mp.currentPage()
      const scrolledScope = await resolveActionScope(scrolledPage, action, fixture.locator)
      selected = await selectElement(scrolledScope, action, expectation, fixture.locator)
      viewport = await viewportMetrics(session.mp)
      pageScrollTop = typeof scrolledPage.scrollTop === 'function' ? await scrolledPage.scrollTop() : 0
    }
    let metrics = await elementMetrics(selected.element, viewport, pageScrollTop)
    const stableBaseline = await waitForStableBaseline(async () => {
      const baselinePage = await session.mp.currentPage()
      return snapshot(session.mp, baselinePage)
    }, {
      intervalMs: Number(process.env.ACTION_BASELINE_MS || 500),
      timeoutMs: Number(process.env.ACTION_BASELINE_TIMEOUT_MS || 4000),
    })
    const { baseline, before } = stableBaseline
    const fixtureAttestation = fixtureDriver
      ? validateFixtureAttestation(fixture, await fixtureDriver.driver.verifyIdentity({
        action, branch, fixture, mp: session.mp, page, before, runNonce,
      })) : null
    const beforeAuthority = await captureAuthoritySequence(action, readbackAdapter, 'before', {
      action, branch, fixture, expectation, mp: session.mp, page, snapshot: before, runNonce,
    }, requestPlan)
    const driverContext = { action, branch, fixture, expectation, mp: session.mp, page, before }
    await session.mp.screenshot({ path: shots.before })
    let interactionTransport = action.interactionMode === 'tap'
      ? tapStrategyFor(action).transport
      : 'event-contract-driver'
    const performInteraction = async () => {
      if (action.interactionMode === 'tap') {
        const currentPage = await session.mp.currentPage()
        const currentScope = await resolveActionScope(currentPage, action, fixture.locator)
        selected = await selectElement(currentScope, action, expectation, fixture.locator)
        viewport = await viewportMetrics(session.mp)
        pageScrollTop = typeof currentPage.scrollTop === 'function' ? await currentPage.scrollTop() : 0
        if (await scrollElementIntoView(session.mp, selected.element, viewport, pageScrollTop)) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          const settledPage = await session.mp.currentPage()
          const settledScope = await resolveActionScope(settledPage, action, fixture.locator)
          selected = await selectElement(settledScope, action, expectation, fixture.locator)
          viewport = await viewportMetrics(session.mp)
          pageScrollTop = typeof settledPage.scrollTop === 'function' ? await settledPage.scrollTop() : 0
        }
        const physicalTarget = await resolveTapInteractionTarget(selected.element, action)
        metrics = await elementMetrics(physicalTarget, viewport, pageScrollTop)
        assertInteractable(metrics)
        assertAccessible(action, metrics, expectation)
        const currentPageForOverlay = await session.mp.currentPage()
        const overlays = await coveringOverlays(currentPageForOverlay, physicalTarget, selected.selector, metrics)
        if (physicalTarget !== selected.element) {
          overlays.push(...await coveringOverlays(selected.element, physicalTarget, selected.selector, metrics))
        }
        assertNoCoveringOverlay(action, overlays)
        interactionTransport = await performTapInteraction(selected.element, action, physicalTarget)
        return completeModalInteraction(session.mp, action, branch, fixture.id)
      }
      return validateEventReceipt(action, fixture, await eventDriver.driver.perform({
        action, branch, fixture, expectation, mp: session.mp, page, element: selected.element,
      }))
    }
    const interactionReceipts = [await performInteraction()]
    if (branch === 'duplicate-trigger') interactionReceipts.push(await performInteraction())
    let currentPage
    const captureCurrent = async () => {
      currentPage = await session.mp.currentPage()
      return snapshot(session.mp, currentPage)
    }
    const hasNavigation = (action.effectClasses || [action.baseActionClass || action.actionClass]).includes('navigation')
    const after = hasNavigation
      ? await waitForObservedNavigation(captureCurrent, before, action, expectation, {
        intervalMs: Number(process.env.ACTION_AFTER_MS || 500),
        timeoutMs: Number(process.env.ACTION_EFFECT_TIMEOUT_MS || 5000),
      })
      : await (async () => {
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.ACTION_AFTER_MS || 500)))
        const timeoutMs = Number(process.env.ACTION_EFFECT_TIMEOUT_MS || 5000)
        return withDeadline(captureCurrent(), timeoutMs, `动作终态采集在 ${timeoutMs}ms 内未返回`)
      })()
    const afterAuthority = await captureAuthoritySequence(action, readbackAdapter, 'after', {
      action, expectation, fixture, branch, mp: session.mp, page: currentPage, snapshot: after, runNonce,
    }, requestPlan)
    const authority = composeAuthorityEvidence(
      action, readbackAdapter, requestPlan, beforeAuthority, afterAuthority, fixtureAttestation,
    )
    if (authority) after.authoritativeReadback = authority
    await session.mp.screenshot({ path: shots.after })
    let readback
    if (branch === 'success') {
      readback = judgeObservedEffect(action, before, after, expectation)
    } else if (branch === 'modal-cancelled') {
      readback = validateBranchReceipt(action, branch, {
        actionId: action.id,
        branch,
        fixtureId: fixture.id,
        assertions: ['已通过 DevTools native.cancelModal 执行用户取消，且独立回读无副作用'],
        observed: { outcome: 'cancelled', capability: 'wx.showModal', sideEffectCount: 0 },
        uiEffect: modalCancellationEffect(action, before, after),
        authoritativeReadback: authority,
      }, fixture)
    } else {
      const failureEffect = judgeFailureEffect(action, before, after, expectation, branch)
      const recoverySelector = expectation.branches[branch].recovery.selector
      if (recoverySelector && !(await currentPage.$(recoverySelector))) {
        throw new Error(`${action.id}: ${branch} 恢复入口 ${recoverySelector} 不存在`)
      }
      readback = {
        ...validateBranchReceipt(action, branch, await branchDriver.driver.verify({
          ...driverContext, page: currentPage, after, authority, runNonce,
        }), fixture),
        uiEffect: failureEffect,
        authoritativeReadback: authority,
      }
    }
    if (eventDriver) readback.eventReceipts = interactionReceipts
    if (action.confirmationMode === 'wx.showModal') {
      readback.modalReceipts = interactionReceipts.filter(Boolean)
    }
    const sourceDigest = sourceDigestFor(action)
    if (sourceDigestAtCommit(action, sourceSha) !== sourceDigest) {
      throw new Error(`${action.id}: 工作树真源与 HEAD 不一致，先提交源码再生成 release evidence`)
    }
    const artifacts = screenshotArtifacts(publishScreenshots(shots))
    const provenance = {
      runner: 'tests/automator/action-evidence-runner.js',
      runnerSha256: sha256(fs.readFileSync(__filename)),
      transport: interactionTransport,
      eventDriver: eventDriver ? eventDriver.relative : null,
      eventDriverSha256: eventDriver ? sha256(fs.readFileSync(eventDriver.resolved)) : null,
      fixtureDriver: fixtureDriver ? fixtureDriver.relative : null,
      fixtureDriverSha256: fixtureDriver ? sha256(fs.readFileSync(fixtureDriver.resolved)) : null,
      branchDriver: branchDriver ? branchDriver.relative : null,
      branchDriverSha256: branchDriver ? sha256(fs.readFileSync(branchDriver.resolved)) : null,
      readbackAdapter: readbackAdapter ? readbackAdapter.relative : null,
      readbackAdapterSha256: readbackAdapter ? sha256(fs.readFileSync(readbackAdapter.resolved)) : null,
    }
    const fragment = {
      schemaVersion: 1,
      actionId,
      branch,
      sourceSha,
      sourceDigest,
      verifiedAt: new Date().toISOString(),
      fixture,
      fixtureDigest: fixtureDigest(fixture),
      expectation,
      fixtureAttestation,
      provenance,
      generation: provenanceGeneration(provenance),
      artifacts,
      readback,
    }
    const report = {
      schemaVersion: 1,
      actionId,
      route: action.route,
      selector: selected.selector,
      ariaLabel: action.control.ariaLabel,
      event: action.control.event,
      baseActionClass: action.baseActionClass,
      sourceSha,
      sourceDigest,
      branch,
      fixture,
      verifiedAt: fragment.verifiedAt,
      baseline: publicSnapshot(baseline),
      controlMetrics: metrics,
      expectation,
      before: publicSnapshot(before),
      after: publicSnapshot(after),
      readback,
      interactionProof: {
        transport: interactionTransport,
        center: {
          x: Number(metrics.offset.left) + Number(metrics.size.width) / 2,
          y: Number(metrics.offset.top) + Number(metrics.size.height) / 2,
        },
        insideSafeArea: true,
        exactEffectAsserted: true,
      },
      screenshots: artifacts,
      fragment,
    }
    const reportPath = writeReport(report)
    if (process.env.ACTION_RECORD_FRAGMENT === '1') validateFragment(action, fragment, PROJECT_PATH)
    const fragmentPath = process.env.ACTION_RECORD_FRAGMENT === '1' ? writeFragment(PROJECT_PATH, fragment) : null
    process.stdout.write(`${JSON.stringify(redactEvidence({ ...report, reportPath, fragmentPath }), null, 2)}\n`)
  } finally {
    let teardownError = null
    if (faultActivated && branchDriver && typeof branchDriver.driver.teardown === 'function') {
      try { await branchDriver.driver.teardown({ action, branch, fixture, mp: session.mp, runNonce }) } catch (error) {
        teardownError = error
      }
    }
    await closeMiniProgram(session)
    if (process.env.ACTION_RECORD_FRAGMENT !== '1' && !process.env.ACTION_REPORT) {
      ;[shots.before, shots.after].forEach((file) => {
        try { fs.unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
      })
    }
    if (teardownError) throw teardownError
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ACTION-RUNTIME FAIL: ${error && error.message ? error.message : error}`)
    process.exit(1)
  })
}

module.exports = {
  authorityRequestPlan,
  captureAuthority,
  coveringOverlays,
  composeAuthorityReceipt,
  composeAuthorityEvidence,
  elementMetrics,
  parseExpectation,
  predicateMatches,
  completeModalInteraction,
  performTapInteraction,
  resolveTapInteractionTarget,
  loadBranchDriver,
  loadFixtureDriver,
  loadEventDriver,
  loadReadbackAdapter,
  launchPath,
  resolveActionScope,
  routeStack,
  scrollElementIntoView,
  selectElement,
  snapshot,
  stableJson,
  writeReport,
  viewportMetrics,
  validateFixtureAttestation,
  validateEventReceipt,
  waitForObservedNavigation,
  waitForStableBaseline,
}
