// CU-C-56 / CU-C-58 / CU-M-49:必填原因类命令式弹窗,校验不过必须**不关面板**。
// 原来 cy-modal-host._close 无条件先 setData({show:false}) 再结算,调用方拿不到拦截关闭的机会 ——
// 空理由点确认后弹窗消失、输入一起丢,只剩一条 2 秒 toast,用户得重开重打。
// 契约:open({ validate(content) → '' | '文案' });返回文案时面板留在原地、提示贴回输入框下、success 不结算。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const MODAL = path.resolve(__dirname, '../../utils/modal.js')
const HOST = path.resolve(__dirname, '../../components/cy/modal-host/index.js')
function fresh(mod) { delete require.cache[mod]; return require(mod) }
function withGlobals(globals, fn) {
  const prev = {}
  for (const k of Object.keys(globals)) { prev[k] = global[k]; global[k] = globals[k] }
  try { return fn() } finally { for (const k of Object.keys(globals)) { if (prev[k] === undefined) delete global[k]; else global[k] = prev[k] } }
}
function loadHost() {
  let captured = null
  withGlobals({ Component: (o) => { captured = o }, Behavior: (o) => o, getApp: () => ({ globalData: {} }), wx: {} }, () => fresh(HOST))
  return Object.assign({}, captured.methods, { data: Object.assign({}, captured.data), setData(p) { Object.assign(this.data, p) } })
}
const REQUIRED_REASON = function (value) {
  return typeof value === 'string' && value.trim() ? '' : '请填写封禁原因'
}

test('cy-modal-host:validate 不过时不关面板、不结算,提示与输入都留在框里', () => {
  const host = loadHost()
  const results = []
  host.open({ title: '确认封禁 小林', editable: true, placeholderText: '填写封禁原因（必填）', validate: REQUIRED_REASON, success: (r) => results.push(r) })

  host.onInput({ detail: { value: '   ' } })
  host.onConfirm()
  assert.equal(host.data.show, true, '校验不过必须留着面板')
  assert.equal(host.data.inputError, '请填写封禁原因', '提示要贴在面板里,不能只 toast')
  assert.deepEqual(results, [], '校验不过不得结算 success')
  assert.equal(host.data.inputValue, '   ', '已输入的内容不能丢')

  host.onInput({ detail: { value: '线下骚扰' } })
  assert.equal(host.data.inputError, '', '用户开始改就把上一轮提示撤掉')
  host.onConfirm()
  assert.equal(host.data.show, false)
  assert.deepEqual(results, [{ errMsg: 'showModal:ok', confirm: true, cancel: false, content: '线下骚扰' }])
})

test('cy-modal-host:不传 validate 时行为与旧版逐字一致(确认即关即结算)', () => {
  const host = loadHost()
  const results = []
  host.open({ title: '解除封禁', editable: true, success: (r) => results.push([r.confirm, r.content]) })
  host.onInput({ detail: { value: '' } })
  host.onConfirm()
  assert.equal(host.data.show, false)
  assert.deepEqual(results, [[true, '']])
})

test('utils/modal:无宿主回落原生弹窗时,validate 不通过就用同一份参数重开并带上文案', () => {
  const shown = []
  const results = []
  withGlobals({
    wx: { showModal: (o) => shown.push(o) },
    getCurrentPages: () => [{ route: 'pages/club/governance/index' }],
  }, () => {
    fresh(MODAL).show({ title: '确认取消', content: '取消本场活动', editable: true, validate: REQUIRED_REASON, success: (r) => results.push(r) })
    assert.equal(shown.length, 1)
    shown[0].success({ confirm: true, cancel: false, content: '  ' })
    assert.deepEqual(results, [], '空内容不得结算 success')
    assert.equal(shown.length, 2, '校验不过要重开面板,不能悄悄关掉')
    // 可编辑弹窗的 content 是输入框预填值:提示不能进 content,否则再点确认就把提示当理由交了
    assert.equal(shown[1].content, '', '提示不得预填进输入框')
    assert.match(shown[1].placeholderText, /请填写封禁原因/)
    shown[1].success({ confirm: true, cancel: false, content: '临时状况' })
    assert.deepEqual(results, [{ confirm: true, cancel: false, content: '临时状况' }])
  })
})

// 光有宿主钩子不够:每个「必填原因」调用点都得真的把 validate 传下去,否则修复形同虚设。
test('必填原因的命令式弹窗调用点都接上了 validate(撤掉任何一个都该变红)', () => {
  const fs = require('node:fs')
  const root = path.resolve(__dirname, '../..')
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
  const count = (source, pattern) => (source.match(pattern) || []).length

  // 治理:封禁原因 / 交接原因 / 事实说明(报告与申诉共用一处)
  assert.equal(count(read('pages/club/governance/index.js'), /validate\(value\) \{/g), 3)
  // 本场运营:取消原因 / 更正原因
  assert.equal(count(read('pages/club/event-ops/index.js'), /validate\(value\) \{/g), 2)
  // 合作:撤回邀约的取消理由 / 拒绝理由
  assert.equal(count(read('pages/coop/list/index.js'), /validate\(r\) \{/g), 2)
})
