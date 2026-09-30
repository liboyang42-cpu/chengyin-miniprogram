/* 审查 C · B1(2026-09-15):取消活动**成功**,却只让主办方看到一个「操作失败」
 *
 * 病:弹窗合同第 3 轮把成功回执从单钮告知弹窗改成了 toast(components/cy/
 * scene-play-activity-detail/index.js · submitCancel)。但 utils/toast.js 对
 * 非 success 档的文案要过 safeUserMessage,而后端 ApiActivityController 的成功
 * 文案是拼出来的长句 —— 订单里有已核销票时会追加「另有 N 笔订单含已核销的票,
 * 无法自动退款,平台将人工跟进处理」,整句 66 字,超过 safeUserMessage 的 60 字闸,
 * 被兜底成「操作失败」。
 *
 * 两层后果,第二层更糟:
 *   ① 成功被显示成失败 —— 主办方会以为没取消,可能再点一次;
 *   ② 越是需要人读到的那句(平台人工跟进退款)越会把文案顶过 60 字,
 *      也就越会被吞掉。文案越重要越看不到,这是反的。
 *
 * 合同:这一处成功回执必须是**能读完的**告知弹窗 —— 标题固定「活动已取消」,
 * 正文带上后端讲的退款去向,且正文不得经过会按长度兜底的通道。
 */
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { safeUserMessage } = require('../../utils/transport/safe-user-message.js')

const fs = require('node:fs')
const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 后端 ApiActivityController#cancel 真拼出来的两种成功文案(含已核销票 / 不含)
const MSG_WITH_MANUAL = '活动已取消,已为 3 笔订单全额退款(原路退回,预计1-3个工作日);另有 2 笔订单含已核销的票,无法自动退款,平台将人工跟进处理'
const MSG_PLAIN = '活动已取消,已为 3 笔订单全额退款(原路退回,预计1-3个工作日)'

function mount() {
  const modals = []
  const requests = []
  let reloads = 0

  global.getApp = () => ({ sendRequest: (o) => requests.push(o) })
  global.wx = { showModal: (o) => modals.push(o), showToast: (o) => toasts.push(o), nextTick: (fn) => fn() }
  global.getCurrentPages = () => [{}]

  // 拦 utils/modal 与 utils/toast 的**真模块**,这样 toast 那条 safeUserMessage 通道是真的
  const modalPath = require.resolve(path.join(ROOT, 'utils/modal.js'))
  const toastPath = require.resolve(path.join(ROOT, 'utils/toast.js'))
  delete require.cache[modalPath]
  delete require.cache[toastPath]
  require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true,
    exports: { show: (o) => { modals.push(o); return true } } }
  // 记录「用户最终看到的字」——照 utils/toast.js 的真通道过一遍 safeUserMessage,不是原文
  const seenToast = []
  const wrapped = function (title, options) {
    const opts = options || {}
    const kind = opts.kind || 'info'
    seenToast.push(kind === 'success' ? String(title) : safeUserMessage(title, opts.fallback || '操作失败'))
    return true
  }
  wrapped.success = (t, o) => wrapped(t, Object.assign({}, o, { kind: 'success' }))
  wrapped.error = (t, o) => wrapped(t, Object.assign({}, o, { kind: 'error' }))
  wrapped.show = wrapped
  wrapped.hide = () => true
  require.cache[toastPath] = { id: toastPath, filename: toastPath, loaded: true, exports: wrapped }

  let def = null
  global.Component = (c) => { def = c }
  const abs = require.resolve(path.join(ROOT, 'components/cy/scene-play-activity-detail/index.js'))
  delete require.cache[abs]
  require(abs)
  delete global.Component
  delete require.cache[modalPath]
  delete require.cache[toastPath]

  const data = Object.assign({}, def.data)
  for (const [k, spec] of Object.entries(def.properties || {})) data[k] = spec.value
  Object.assign(data, { activityId: 42, cancelShow: true, cancelReason: '临时有事', canCancel: true, cancelling: false, cancelError: '' })
  // 取消面板打开时预览到的已付款人数(实例字段,不进 setData)
  const paid = { _cancelPaidPlayers: 3 }
  const inst = Object.assign({ data }, paid, def.methods, {
    setData(patch, cb) { Object.assign(this.data, patch); if (typeof cb === 'function') cb() },
    triggerEvent() {},
    reload() { reloads += 1 },
  })
  return { inst, modals, seenToast, requests, reloads: () => reloads }
}

function cancelWith(msg) {
  const m = mount()
  m.inst.submitCancel()
  assert.equal(m.modals.length, 1, '应先弹危险确认(dangerKey=activity.cancel-refund)')
  assert.equal(m.modals[0].dangerKey, 'activity.cancel-refund')
  m.modals[0].success({ confirm: true })
  assert.equal(m.requests.length, 1, '确认后应发出 /api/activity/cancel')
  m.requests[0].success({ code: '200', msg })
  return m
}

test('① 前提坐实:后端含已核销票的成功文案 66 字,过 safeUserMessage 就成了「操作失败」', () => {
  assert.ok(MSG_WITH_MANUAL.length > 60, '前提失效:后端文案不再超 60 字,这条合同要重写')
  assert.equal(safeUserMessage(MSG_WITH_MANUAL, '操作失败'), '操作失败')
  // 对照:不含人工单的短文案能过 —— 说明越要紧的那句越会被吞,不是随机的
  assert.equal(safeUserMessage(MSG_PLAIN, '操作失败'), MSG_PLAIN)
})

test('② 取消成功必须给能读完的告知弹窗:标题固定,正文带退款去向,且不得出现「操作失败」', () => {
  const m = cancelWith(MSG_WITH_MANUAL)
  assert.equal(m.modals.length, 2, '成功之后应有第二个弹窗(告知),而不是一闪而过的 toast')
  const notice = m.modals[1]
  assert.equal(notice.title, '活动已取消', '标题固定,不跟着后端文案跑')
  assert.equal(notice.showCancel, false, '纯告知:只有一颗按钮')
  assert.match(String(notice.content), /人工跟进/, '「平台人工跟进退款」这句必须能读到')
  assert.equal(String(notice.content), MSG_WITH_MANUAL, '正文用后端讲的退款去向原文')
  assert.ok(!m.seenToast.includes('操作失败'), '成功不能被显示成失败,实际看到:' + JSON.stringify(m.seenToast))
})

test('③ 告知弹窗关掉之后才 reload,别在用户还没读完时把页面刷了', () => {
  const m = cancelWith(MSG_WITH_MANUAL)
  assert.equal(m.reloads(), 0, '弹窗还开着就不该 reload')
  m.modals[1].success({ confirm: true })
  assert.equal(m.reloads(), 1)
})

test('④ 后端没给文案时有前端兜底,不至于弹个空白框', () => {
  const m = cancelWith('')
  assert.equal(m.modals.length, 2)
  assert.ok(String(m.modals[1].content).trim().length > 0, '正文不能是空的')
})

test('⑤ 失败仍走页内 inline 错误,不弹告知窗(负控:成功分支不能顺手把失败也吃了)', () => {
  const m = mount()
  m.inst.submitCancel()
  m.modals[0].success({ confirm: true })
  m.requests[0].success({ code: '500', msg: '活动已结束,不能取消' })
  assert.equal(m.modals.length, 1, '失败不该弹告知窗')
  assert.equal(m.inst.data.cancelError, '活动已结束,不能取消')
  assert.equal(m.reloads(), 0)
})

/* ⑥ 这条不是 B1 本身,是修 B1 时踩到的坑:告知弹窗必须留在 submitCancel 外面。
 * 台账 build-action-ledger.js#synchronousModalContract 判「这颗钮有没有确认框」时,
 * 是对**外层 modal.show 的整段实参源码**扫 /showCancel:\s*false/ 的。把告知弹窗内联进
 * success 回调,这个 showCancel:false 就落进了确认框的实参源码里,确认框被当成告知框跳过,
 * submitCancel 被记成 confirmationMode=None、丢掉 modal-cancelled ——
 * 台账上多出一条「全额退款动作没有确认框」的假事实。实测过,不是推演。 */
test('⑥ 告知弹窗不得内联回 submitCancel:否则台账会把这颗退款钮记成「没有确认框」', () => {
  // 先去注释:这条判据下面那段说明文字本身就写着 showCancel:false,不剥会自己咬自己
  const src = read('components/cy/scene-play-activity-detail/index.js')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const body = code.slice(code.indexOf('submitCancel()'), code.indexOf('noticeCancelled(message)'))
  assert.ok(body.length > 0, '锚点失配:submitCancel / noticeCancelled 不在了')
  assert.doesNotMatch(body, /showCancel:\s*false/,
    'submitCancel 体内出现 showCancel:false —— 台账会据此认定这颗退款钮没有确认框')
  assert.match(body, /this\.noticeCancelled\(/, '告知应当调出去,而不是就地展开')
  assert.match(code, /dangerKey: 'activity\.cancel-refund'/, '确认框本身还在')
})

/* [C8-05] 确认框要写明「将给 N 位已付款玩家全额退款」:N 在打开取消面板时向后端要,
 * submitCancel 同步把它塞进 dangerParams;没算出来就不弹确认、不发取消。 */
test('⑧ 打开取消面板就问退款人数,确认框拿到 count', () => {
  const m = mount()
  m.inst._cancelPaidPlayers = null
  m.inst.openCancel()
  assert.equal(m.requests[0].url, '/api/activity/cancel_preview')
  assert.deepEqual(m.requests[0].data, { id: 42 })
  m.requests[0].success({ code: '200', data: { paidPlayers: 4 } })
  m.inst.setData({ cancelReason: '暴雨预警', canCancel: true })
  m.inst.submitCancel()
  assert.equal(m.modals.length, 1)
  assert.deepEqual(m.modals[0].dangerParams, { count: 4 })
})

test('⑨ 人数没算出来:不弹确认、不发取消,页内说明', () => {
  const m = mount()
  m.inst._cancelPaidPlayers = null
  m.inst.submitCancel()
  assert.equal(m.modals.length, 0)
  assert.equal(m.requests.length, 0)
  assert.ok(m.inst.data.cancelError)
})

test('⑦ 负控:把正文改回 toast 通道,② 的「不能显示成失败」必须判红', () => {
  // 模拟改回 toast(res.msg):用户看到的就是 safeUserMessage 的产物
  const seen = safeUserMessage(MSG_WITH_MANUAL, '操作失败')
  assert.throws(
    () => assert.ok(!['操作失败'].includes(seen), '成功不能被显示成失败'),
    /成功不能被显示成失败/,
    '负控失效:走 toast 通道居然没被判红,那 ② 就是摆设',
  )
})

// 2026-09-23 CU-C-23:预检被服务端拒(没有取消权限)时,原来表单照常让人填原因、按确认,白填一遍才撞同一个拒绝。
test('⑩ 预检被拒:收起原因表单,不发取消、不弹确认', () => {
  const m = mount()
  m.inst.openCancel()
  m.requests[0].success({ code: 500, msg: '仅俱乐部主理人可取消活动' })
  assert.equal(m.inst.data.cancelBlocked, true)
  assert.equal(m.inst.data.cancelError, '仅俱乐部主理人可取消活动')
  m.inst.setData({ cancelReason: '暴雨预警', canCancel: true })
  m.inst.submitCancel()
  assert.equal(m.modals.length, 0, '拒绝后不得再走到确认框')
  assert.equal(m.requests.length, 1, '拒绝后不得发取消请求')
  const wxml = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../components/cy/scene-play-activity-detail/index.wxml'), 'utf8')
  assert.match(wxml, /wx:if="\{\{cancelBlocked\}\}"[^>]*title="暂不能取消这场活动"[^>]*retry="重新检查" bind:retry="openCancel"[\s\S]*?<block wx:else>[\s\S]*?activity-form__textarea/)
  // 重新检查 = 再跑一次预检;这次通过就回到可填表状态
  m.inst.openCancel()
  assert.equal(m.inst.data.cancelBlocked, false)
  m.requests[m.requests.length - 1].success({ code: '200', data: { paidPlayers: 2 } })
  assert.equal(m.inst.data.cancelBlocked, false)
})
