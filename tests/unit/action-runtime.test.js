'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  assertAccessible,
  assertBaselineStable,
  assertInteractable,
  assertNoCoveringOverlay,
  normalizeTapSelector,
  selectUniqueTapTarget,
  judgeFailureEffect,
  judgeObservedEffect,
} = require('../../scripts/uiaudit/action-runtime')

test('无法解析的 selector 必须失败，不能调用 handler 伪造点击', () => {
  assert.equal(normalizeTapSelector({ tag: 'button', event: 'bindtap', selectorHint: 'button[bindtap]' }), 'button')
  assert.throws(
    () => selectUniqueTapTarget([], { id: 'missing', control: { selectorHint: '.missing' } }),
    /未找到可点击控件/,
  )
})

test('同一 selector 命中多个控件时必须失败，不能默认点第一个', () => {
  assert.throws(
    () => selectUniqueTapTarget([{}, {}], { id: 'ambiguous', control: { selectorHint: '.chip' } }),
    /命中 2 个控件/,
  )
})

test('state 动作点击后没有 page.data 或可见 DOM 变化必须失败', () => {
  const before = { routeStack: ['pages/test/index'], dataDigest: 'same', domDigest: 'same' }
  assert.throws(
    () => judgeObservedEffect({ id: 'state', baseActionClass: 'state' }, before, { ...before }, {}),
    /精确状态断言/,
  )
})

test('navigation 动作必须回读页面栈变化，toast 不算下一步', () => {
  const before = { routeStack: ['pages/test/index'], dataDigest: 'a', domDigest: 'a' }
  assert.throws(
    () => judgeObservedEffect(
      { id: 'nav', baseActionClass: 'navigation', targets: { routes: ['pages/next/index'] } },
      before,
      { ...before, dataDigest: 'b', domDigest: 'b', wxCalls: [{ method: 'showToast' }] },
    ),
    /页面栈没有变化/,
  )
})

test('真实点击产生状态变化时返回结构化 readback', () => {
  const readback = judgeObservedEffect(
    { id: 'state-pass', baseActionClass: 'state' },
    { routeStack: ['pages/test/index'], dataDigest: 'a', domDigest: 'a', data: { open: false } },
    { routeStack: ['pages/test/index'], dataDigest: 'b', domDigest: 'b', data: { open: true } },
    { data: { open: true } },
  )
  assert.deepEqual(readback.changed, { data: true, dom: true, routeStack: false })
  assert.deepEqual(readback.assertions.state, { expected: { open: true }, observed: { open: true } })
})

test('任意变化不算成功：state 必须命中声明的数据值，navigation 必须到声明 route', () => {
  assert.throws(
    () => judgeObservedEffect(
      { id: 'state-noop', baseActionClass: 'state' },
      { routeStack: ['pages/test/index'], dataDigest: 'a', domDigest: 'a', data: { open: true } },
      { routeStack: ['pages/test/index'], dataDigest: 'a', domDigest: 'a', data: { open: true } },
      { data: { open: true } },
    ),
    /点击前已是预期值/,
  )
  assert.throws(
    () => judgeObservedEffect(
      { id: 'state-wrong', baseActionClass: 'state' },
      { routeStack: ['pages/test/index'], dataDigest: 'a', domDigest: 'a', data: { open: false } },
      { routeStack: ['pages/test/index'], dataDigest: 'b', domDigest: 'b', data: { open: false, noise: 1 } },
      { data: { open: true } },
    ),
    /open.*不符合预期/,
  )
  assert.throws(
    () => judgeObservedEffect(
      { id: 'nav-wrong', baseActionClass: 'navigation', targets: { routes: ['pages/right/index'] } },
      { routeStack: [{ path: 'pages/test/index', query: {} }], dataDigest: 'a', domDigest: 'a' },
      { routeStack: [{ path: 'pages/wrong/index', query: {} }], dataDigest: 'b', domDigest: 'b' },
      {},
    ),
    /目标 route/,
  )
})

test('尺寸为零、隐藏或 disabled 的控件必须在 tap 前失败', () => {
  assert.throws(() => assertInteractable({ size: { width: 43, height: 44 }, disabled: false, display: 'flex' }), /44×44/)
  assert.throws(() => assertInteractable({ size: { width: 44, height: 44 }, disabled: true, display: 'flex' }), /disabled/)
  assert.throws(() => assertInteractable({ size: { width: 44, height: 44 }, disabled: false, display: 'none' }), /不可见/)
  assert.throws(() => assertInteractable({
    size: { width: 44, height: 44 }, offset: { left: -60, top: 10 }, disabled: false, display: 'flex',
    viewport: { width: 390, height: 844, safeArea: { left: 0, top: 47, right: 390, bottom: 810 } },
  }), /安全区/)
})

test('自定义点击控件必须有可回读的 aria role/label/state', () => {
  const action = { id: 'edit', control: { tag: 'view', ariaLabel: '编辑昵称' } }
  assert.throws(() => assertAccessible(action, { ariaLabel: '', ariaRole: '' }), /aria-label/)
  assert.throws(() => assertAccessible(action, { ariaLabel: '编辑昵称', ariaRole: '' }), /aria-role/)
  assert.doesNotThrow(() => assertAccessible(action, {
    ariaLabel: '编辑昵称', ariaRole: 'button', ariaDisabled: 'false', ariaExpanded: 'false',
  }))
  assert.throws(() => assertAccessible(
    { id: 'toggle', control: { tag: 'view', ariaLabel: '通知' } },
    { ariaLabel: '通知', ariaRole: 'switch', ariaChecked: null },
  ), /aria-checked/)
  const dynamic = {
    id: 'retry',
    control: { tag: 'view', ariaLabelExpression: '{{cta}}', ariaDisabledExpression: '{{busy}}' },
  }
  assert.throws(() => assertAccessible(dynamic, {
    ariaLabel: '重试', ariaRole: 'button', ariaDisabled: 'false',
  }, {}), /动态 aria-label/)
  assert.doesNotThrow(() => assertAccessible(dynamic, {
    ariaLabel: '重试', ariaRole: 'button', ariaDisabled: 'false',
  }, { accessibility: { label: '重试', disabled: false } }))
})

test('cy-* 宿主不能绕过语义门；内部根可用可见文本作为 accessible name', () => {
  const action = { id: 'cy-btn-save', control: { tag: 'cy-btn' } }
  assert.throws(() => assertAccessible(action, {
    tagName: 'view', text: '', ariaLabel: '', ariaRole: '', ariaDisabled: 'false',
  }), /可访问名称/)
  assert.throws(() => assertAccessible(action, {
    tagName: 'view', text: '保存', ariaLabel: '', ariaRole: '', ariaDisabled: 'false',
  }), /aria-role/)
  assert.doesNotThrow(() => assertAccessible(action, {
    tagName: 'view', text: '保存', ariaLabel: '', ariaRole: 'button', ariaDisabled: 'false',
  }))
})

test('微信胶囊重叠与 fixed 高层遮挡必须在 tap 前判红', () => {
  assert.throws(() => assertInteractable({
    size: { width: 50, height: 44 }, offset: { left: 320, top: 50 }, disabled: false, display: 'flex',
    viewport: {
      width: 390, height: 844, safeArea: { left: 0, top: 47, right: 390, bottom: 810 },
      menuButton: { left: 315, top: 48, right: 380, bottom: 82 },
    },
  }), /胶囊/)
  assert.throws(() => assertNoCoveringOverlay({ id: 'save' }, [{ tag: 'view', zIndex: 800 }]), /遮挡/)
})

test('不点击也会变化的页面必须失败，避免把后台加载误判为按钮效果', () => {
  assert.throws(
    () => assertBaselineStable(
      { routeStack: ['pages/test/index'], dataDigest: 'a', domDigest: 'a' },
      { routeStack: ['pages/test/index'], dataDigest: 'b', domDigest: 'a' },
    ),
    /基线仍在变化/,
  )
})

test('read/other 不能靠任意 DOM 变化通过，必须声明页面映射或精确副作用', () => {
  const before = { routeStack: ['pages/test/index'], dataDigest: 'a', domDigest: 'a', data: { ready: false } }
  const after = {
    routeStack: ['pages/test/index'], dataDigest: 'b', domDigest: 'b', data: { ready: true },
    authoritativeReadback: { actionId: 'read' },
  }
  assert.throws(() => judgeObservedEffect({ id: 'read', baseActionClass: 'read' }, before, after, {}), /精确断言/)
  assert.doesNotThrow(() => judgeObservedEffect(
    { id: 'read', baseActionClass: 'read' }, before, after, { data: { ready: true } },
  ))
  assert.throws(() => judgeObservedEffect(
    { id: 'other', baseActionClass: 'other' }, before, { ...after, authoritativeReadback: null }, {},
  ), /精确 data 或 route/)
})

test('失败、超时与拒权必须精确回读 UI 终态和恢复合同', () => {
  const action = { id: 'write-error', effectClasses: ['write', 'state'] }
  const before = {
    routeStack: ['pages/form/index'], dataDigest: 'a', domDigest: 'a', data: { submitting: true },
  }
  const after = {
    routeStack: ['pages/form/index'], dataDigest: 'b', domDigest: 'b',
    data: { submitting: false, error: '网络异常' },
  }
  assert.throws(() => judgeFailureEffect(action, before, after, {}, 'error'), /必须声明/)
  const result = judgeFailureEffect(action, before, after, {
    branches: { error: { data: { submitting: false, error: '网络异常' }, recovery: { selector: '.retry' } } },
  }, 'error')
  assert.equal(result.assertions.failure.branch, 'error')
  assert.throws(() => judgeFailureEffect(action, after, after, {
    branches: { error: { data: { submitting: false, error: '网络异常' }, recovery: { selector: '.retry' } } },
  }, 'error'), /点击前已是声明的失败终态/)
  assert.throws(() => judgeFailureEffect(action, before, { ...after, routeStack: ['pages/wrong/index'] }, {
    branches: { error: { data: { submitting: false }, recovery: { dismissed: true } } },
  }, 'error'), /未声明的页面跳转/)
})
