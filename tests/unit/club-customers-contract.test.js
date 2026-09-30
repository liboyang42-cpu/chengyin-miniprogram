/* 俱乐部客户系统契约(2026-09-02,Figma K1/K2/K2-B~F/J2)
 *
 * 守三条,每条都能因为实现退化而变红:
 *   1) 手机号只走服务端渲染好的 phoneText —— 整形层是白名单,原始号码字段进不了 data。
 *      这是「脱敏必须在服务端做」的前端那一半:前端不藏号码,而是**根本拿不到**。
 *   2) 客户详情核对 memberId,拒收串号响应(照 merchant CRM 的同款护栏)。
 *   3) 金额缺失 = 无查看权限(K2-B),不能退化成 ¥0 冒充真实数字。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const viewModel = require('../../pages/club/customers/view-model.js')

const RAW_PHONE = '13812345621'
const MASKED_PHONE = '138****5621'

function listPayload(extra) {
  return Object.assign({
    total: 328,
    monthNew: 24,
    canEdit: true,
    items: [{
      memberId: 41,
      displayName: '林小满',
      avatar: '',
      verifiedCount: 6,
      pendingCount: 0,
      lastVisitDate: '2026-08-26',
      remark: '常带朋友',
      phoneText: MASKED_PHONE,
    }],
  }, extra || {})
}

function detailPayload(extra) {
  return Object.assign({
    summary: {
      memberId: 41,
      displayName: '林小满',
      avatar: '',
      phoneText: MASKED_PHONE,
      lastInteractionTime: '2026-08-26 20:10:00',
      arrivedCount: 6,
      pendingCount: 0,
      refundedCount: 1,
      paidAmount: '486',
    },
    records: [
      { key: 'reg-1', topicId: 9, title: '城市微醺路线', occurredAt: '2026-08-26', statusCode: 'VERIFIED' },
      { key: 'reg-2', topicId: 10, title: '周末手冲小聚', occurredAt: '2026-08-12', statusCode: 'REFUNDED' },
    ],
    tags: ['常客', '带朋友'],
    remark: '喜欢靠窗位置',
    canEdit: true,
  }, extra || {})
}

test('★手机号:整形层只放行服务端渲染好的 phoneText，原始号码字段一律丢弃', () => {
  // 服务端哪天误带了明文,前端也不能把它带进 data —— 白名单整形是最后一道闸
  const dirtyList = listPayload()
  dirtyList.items[0].phone = RAW_PHONE
  dirtyList.items[0].mobile = RAW_PHONE
  const list = viewModel.shapeCustomerList(dirtyList)
  assert.ok(list)
  assert.equal(JSON.stringify(list).includes(RAW_PHONE), false, '列表整形结果里不得出现完整手机号')
  assert.equal(list.items[0].subText, '常带朋友', '有备注时第三行显示备注')

  const dirtyDetail = detailPayload()
  dirtyDetail.summary.phone = RAW_PHONE
  const detail = viewModel.shapeCustomerDetail(dirtyDetail, 41)
  assert.ok(detail)
  assert.equal(JSON.stringify(detail).includes(RAW_PHONE), false, '详情整形结果里不得出现完整手机号')
  assert.equal(detail.summary.phoneText, MASKED_PHONE)
})

test('★负控:整形层改成透传原始 summary 时，明文手机号必须泄到 data 里并被本测试判红', () => {
  const file = path.resolve(__dirname, '../../pages/club/customers/view-model.js')
  const source = fs.readFileSync(file, 'utf8')
  // 锚点钉结构(白名单对象的起始),不钉注释文案
  const anchor = '  return {\n    summary: {\n      memberId,'
  const mutated = source.replace(anchor, '  return {\n    summary: {\n      ...raw.summary,\n      memberId,')
  assert.notEqual(mutated, source, '负控锚点失效:白名单 summary 的结构变了,先修锚点')
  const sandbox = { module: { exports: {} }, exports: {} }
  vm.runInNewContext(mutated, sandbox)
  const leaky = detailPayload()
  leaky.summary.phone = RAW_PHONE
  const shaped = sandbox.module.exports.shapeCustomerDetail(leaky, 41)
  assert.equal(JSON.stringify(shaped).includes(RAW_PHONE), true, '变异实现应当把明文手机号透传出来')
})

test('客户详情核对 memberId，跨客户响应一律拒收', () => {
  assert.equal(viewModel.shapeCustomerDetail(detailPayload(), 41).summary.memberId, 41)
  const other = detailPayload()
  other.summary.memberId = 99
  assert.equal(viewModel.shapeCustomerDetail(other, 41), null)
})

test('负控:详情不再核对 memberId 时，串号响应会被错误接纳', () => {
  const file = path.resolve(__dirname, '../../pages/club/customers/view-model.js')
  const source = fs.readFileSync(file, 'utf8')
  const anchor = '  if (memberId !== expected) return null;'
  const mutated = source.replace(anchor, '  if (false) return null;')
  assert.notEqual(mutated, source, '负控锚点失效')
  const sandbox = { module: { exports: {} }, exports: {} }
  vm.runInNewContext(mutated, sandbox)
  const other = detailPayload()
  other.summary.memberId = 99
  assert.notEqual(sandbox.module.exports.shapeCustomerDetail(other, 41), null)
})

test('K2-B 金额无权限:paidAmount 缺失时是「无查看权限」，不是 ¥0', () => {
  const locked = detailPayload()
  locked.summary.paidAmount = null
  const shaped = viewModel.shapeCustomerDetail(locked, 41)
  assert.equal(shaped.summary.paidAmountText, '无查看权限')
  assert.equal(shaped.summary.amountVisible, false)
  assert.equal(viewModel.shapeCustomerDetail(detailPayload(), 41).summary.paidAmountText, '¥486')
})

test('K2-C 暂无记录 / 状态色档:已核销=success、已退款=danger、待核销=warning', () => {
  const shaped = viewModel.shapeCustomerDetail(detailPayload(), 41)
  assert.deepEqual(shaped.records.map(r => [r.statusLabel, r.tone]), [['已核销', 'success'], ['已退款', 'danger']])
  const empty = viewModel.shapeCustomerDetail(detailPayload({ records: [] }), 41)
  assert.deepEqual(empty.records, [])
  assert.equal(viewModel.shapeCustomerDetail(detailPayload({ tags: [], remark: '' }), 41).remarkText, '还没有备注')
  const pending = viewModel.shapeCustomerDetail(detailPayload({
    records: [{ key: 'r', topicId: 1, title: 'T', occurredAt: '2026-08-01', statusCode: 'PENDING' }],
  }), 41)
  assert.equal(pending.records[0].tone, 'warning')
})

test('列表第二行按待核销优先,没有互动时详情显示「尚未发生互动」', () => {
  assert.equal(viewModel.listMetaText(0, 6, '', '2026-08-26'), '核销 6 次 · 最近 08-26')
  assert.equal(viewModel.listMetaText(1, 0, '老城寻迹', ''), '待核销 1 张 · 最近参加「老城寻迹」')
  const cold = detailPayload()
  cold.summary.lastInteractionTime = null
  assert.equal(viewModel.shapeCustomerDetail(cold, 41).summary.lastInteractionText, '尚未发生互动')
})

test('标签备注草稿只放行白名单,越界当场拦下', () => {
  assert.deepEqual(viewModel.buildTagRemarkDraft([' 常客 ', '常客', ''], '  喜欢靠窗  '),
    { valid: true, tags: ['常客'], remark: '喜欢靠窗' })
  assert.equal(viewModel.buildTagRemarkDraft(['一二三四五六七八九十十一十二十三'], '').valid, false)
  assert.equal(viewModel.buildTagRemarkDraft([], 'x'.repeat(201)).valid, false)
  assert.equal(viewModel.buildTagRemarkDraft(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], '').valid, false)
})

test('页面与组件接的是俱乐部客户契约,且不自行拼装手机号', () => {
  const read = rel => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')
  const listJs = read('pages/club/customers/index.js')
  const detailJs = read('pages/club/customer-detail/index.js')
  const sheetJs = read('components/cy/scene-topic-customers/index.js')
  assert.match(listJs, /'\/api\/club\/crm\/customers\/list'/)
  assert.match(detailJs, /'\/api\/club\/crm\/customers\/detail'/)
  assert.match(detailJs, /'\/api\/club\/crm\/customers\/tag-remark'/)
  assert.match(sheetJs, /'\/api\/club\/crm\/topic-customers'/)
  // 前端不许自己做脱敏(那等于承认明文已经下发到端上了)
  for (const source of [listJs, detailJs, sheetJs, read('pages/club/customers/view-model.js')]) {
    assert.doesNotMatch(source, /\*\*\*\*/, '前端不得拼装脱敏串:脱敏必须在服务端做')
    assert.doesNotMatch(source, /\bmaskPhone\b/)
  }
  // K2-D / K2-E 两态在 wxml 上必须各有独立出口
  const detailWxml = read('pages/club/customer-detail/index.wxml')
  assert.match(detailWxml, /state === 'no-permission'/)
  assert.match(detailWxml, /bind:retry="retry"/)
  assert.match(detailWxml, /wx:if="\{\{detail\.canEdit\}\}"/, '编辑入口按服务端下发的 canEdit 显示')
})
