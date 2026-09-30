// F21 契约:后端 recruitmentBlocked/recruitmentBlockedReason 必须被商家招募口径真正消费
// (2026-09-16;2026-09-17 拍板 C 扩到公开列表)
//
// 病象:e2673bbf4 只在后端产出两个字段,小程序全仓零读取 —— 商家永远看不到
// 「关键承接方缺失，待补位」,「缺口期间撤下或标缺口」这条产品裁决在用户侧等于没发生。
// 2026-09-17 用户拍板:列表标「信息不全」保留(不撤下),主标固定「信息不全」+副文案给原因;
// 公开列表(官方活动 tab)与商家招募列表(合作中心)都要能看到。
// 本契约钉住两端:①字段为 true 时标记文案必须出来;②两处列表真的渲染它。
// 负控:把消费代码或渲染节点删掉,必须判红。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const channel = require('../../utils/merchant-official-channel.js')

const PAGE_JS = 'pages/merchant/coop-center/index.js'
const PAGE_WXML = 'pages/merchant/coop-center/index.wxml'
const LIST_JS = 'pages/activity/list/index.js'
const LIST_WXML = 'pages/activity/list/index.wxml'
const GAP_LABEL = '信息不全'
const GAP_TEXT = '关键承接方缺失，待补位'

// 挂公开列表页,只为拿 _decorate 这个纯函数跑真实一行数据
function mountListPage() {
  let definition
  global.getApp = () => ({ globalData: {}, sendRequest() {} })
  vm.runInNewContext(read(LIST_JS), {
    getApp: () => ({ globalData: {}, sendRequest() {} }),
    Page(config) { definition = config },
    require(request) {
      const base = path.basename(request)
      if (request.indexOf('../../../utils/') === 0) {
        return require(path.join(ROOT, 'utils', base))
      }
      throw new Error(`unexpected require: ${request}`)
    },
    Date, Math, Number, String, JSON, isNaN,
  }, { filename: LIST_JS })
  return definition
}

// 页面消费契约:列表必须逐条装饰(decorateRecruitableEvent),卡片必须渲染主标+副文案
function assertPageConsumesGap(wxml) {
  assert.match(wxml, /<view class="cc-gap" wx:if="\{\{item\.recruitmentGapLabel\}\}">/,
    '合作中心官方活动卡片必须渲染「' + GAP_LABEL + '」主标(缺口标记不得只停在后端)')
  assert.match(wxml, /\{\{item\.recruitmentGapLabel\}\}[\s\S]*?\{\{item\.recruitmentGapText\}\}/,
    '缺口标记必须主标「' + GAP_LABEL + '」+ 副文案原因')
}

function assertPublicListConsumesGap(js, wxml) {
  assert.match(js, /officialChannel\.recruitmentGapLabel\(e\)/,
    '公开列表必须逐条消费 recruitmentBlocked 字段(utils/merchant-official-channel.js)')
  assert.match(js, /officialChannel\.recruitmentGapText\(e\)/,
    '公开列表必须逐条消费 recruitmentBlockedReason 字段')
  assert.match(wxml, /<view wx:if="\{\{item\._gapLabel\}\}" class="oe-gap">/,
    '公开列表卡片必须渲染「' + GAP_LABEL + '」主标')
  assert.match(wxml, /\{\{item\._gapLabel\}\}[\s\S]*?\{\{item\._gapText\}\}/,
    '公开列表缺口标记必须主标「' + GAP_LABEL + '」+ 副文案原因')
}

test('F21:关键承接方缺失时标记文案从后端字段生成', () => {
  const blocked = channel.decorateRecruitableEvent({
    id: 7,
    title: '官方活动',
    status: 2,
    fulfillmentPolicy: 'REQUIRED_FULFILLMENT',
    recruitmentBlocked: true,
    recruitmentBlockedReason: GAP_TEXT,
  })
  assert.equal(blocked.recruitmentGapLabel, GAP_LABEL, 'recruitmentBlocked=true 必须给出「信息不全」主标')
  assert.equal(blocked.recruitmentGapText, GAP_TEXT, 'recruitmentBlocked=true 必须给出缺口原因副文案')
  // 后端只给了布尔没给原因时,按裁决固定文案兜底(不得渲染 undefined)
  assert.equal(channel.decorateRecruitableEvent({ recruitmentBlocked: true }).recruitmentGapText, GAP_TEXT)
  // 负控:覆盖完好 / 字段缺失时不得凭空标缺口
  assert.equal(channel.decorateRecruitableEvent({ recruitmentBlocked: false }).recruitmentGapLabel, '')
  assert.equal(channel.decorateRecruitableEvent({ recruitmentBlocked: false }).recruitmentGapText, '')
  assert.equal(channel.decorateRecruitableEvent({}).recruitmentGapLabel, '')
  assert.equal(channel.decorateRecruitableEvent({}).recruitmentGapText, '')
  assert.equal(channel.decorateRecruitableEvent(null).recruitmentGapLabel, '')
  assert.equal(channel.decorateRecruitableEvent(null).recruitmentGapText, '')
})

test('F21:缺口活动仍在招募列表(标缺口,不撤下),标记随字段消失', () => {
  const event = { status: 2, fulfillmentPolicy: 'REQUIRED_FULFILLMENT', recruitmentBlocked: true }
  assert.equal(channel.isMerchantRecruitableEvent(event), true,
    '裁决 A 案允许「撤下或标缺口」,本仓选标缺口:活动留在列表供商家看到缺口与补位入口')
  assert.equal(channel.decorateRecruitableEvent(
    Object.assign({}, event, { recruitmentBlocked: false })).recruitmentGapLabel, '')
})

test('F21:合作中心官方活动列表真的消费并渲染缺口标记', () => {
  assert.match(read(PAGE_JS), /\.map\(officialChannel\.decorateRecruitableEvent\)/,
    '合作中心官方活动列表必须逐条消费 recruitBlocked 字段(utils/merchant-official-channel.js decorateRecruitableEvent)')
  assertPageConsumesGap(read(PAGE_WXML))
})

test('F21:公开列表(官方活动 tab)真的消费并渲染缺口标记', () => {
  const page = mountListPage()
  const decorated = page._decorate({
    id: 9, title: '官方活动', status: 2,
    recruitmentBlocked: true, recruitmentBlockedReason: GAP_TEXT,
  })
  assert.equal(decorated._gapLabel, GAP_LABEL, '_decorate 必须把主标带进渲染数据')
  assert.equal(decorated._gapText, GAP_TEXT, '_decorate 必须把原因带进渲染数据')
  assert.equal(page._decorate({ id: 10, title: '正常活动', status: 2 })._gapLabel, '')
  assertPublicListConsumesGap(read(LIST_JS), read(LIST_WXML))
})

test('负控:合作中心列表不再装饰字段(回到「后端发了前端没人读」)必须判红', () => {
  const js = read(PAGE_JS)
  const mutated = js.replace('.map(officialChannel.decorateRecruitableEvent)', '')
  assert.notEqual(mutated, js, '变异锚点失效(消费代码已改动?)')
  assert.throws(() => assert.match(mutated, /\.map\(officialChannel\.decorateRecruitableEvent\)/),
    assert.AssertionError)
})

test('负控:合作中心卡片删掉缺口标记节点必须判红', () => {
  const wxml = read(PAGE_WXML)
  const mutated = wxml.replace(/<view class="cc-gap"[\s\S]*?<\/view>\n?\s*/g, '')
  assert.notEqual(mutated, wxml, '变异锚点失效(标记节点已改动?)')
  assert.throws(() => assertPageConsumesGap(mutated), assert.AssertionError)
})

test('负控:公开列表不再消费字段 / 删掉标记节点必须判红', () => {
  const js = read(LIST_JS)
  const mutatedJs = js.replace('officialChannel.recruitmentGapLabel(e)', '')
  assert.notEqual(mutatedJs, js, '变异锚点失效(消费代码已改动?)')
  assert.throws(() => assertPublicListConsumesGap(mutatedJs, read(LIST_WXML)), assert.AssertionError)

  const wxml = read(LIST_WXML)
  const mutatedWxml = wxml.replace(/<view wx:if="\{\{item\._gapLabel\}\}"[\s\S]*?<\/view>\n?\s*/g, '')
  assert.notEqual(mutatedWxml, wxml, '变异锚点失效(标记节点已改动?)')
  assert.throws(() => assertPublicListConsumesGap(read(LIST_JS), mutatedWxml), assert.AssertionError)
})
