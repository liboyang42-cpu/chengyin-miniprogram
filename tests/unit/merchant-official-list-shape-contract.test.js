// 合作中心「官方活动」tab 线上恒空(2026-09-17 模拟回放发现)。
//
// 病:商家侧 isMerchantRecruitableEvent 只认 fulfillmentPolicy ∈ {OPTIONAL_PARTNERS, REQUIRED_FULFILLMENT},
//     而 /api/official/events 的 v2 行由 OfficialEventV2Mapper.selectPublicV2Events(resultType=map)直出,
//     原来没 select fulfillment_policy ⇒ 字段恒缺 ⇒ 商家侧整列过滤成空,F21「信息不全」对商家也不可达。
//     之前的单测全用手造的 fulfillmentPolicy 桩,所以一直绿。
// 本契约:从真 SQL 的列别名拼出列表行的真实形状,喂进合作中心真页面的 loadEvents,断言能命中。
// 负控:把 XML 里的 fulfillment_policy 列删掉 → 同一条行形状被过滤成空。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const MAPPER = path.resolve(ROOT, '../chengyinhub-system/src/main/resources/mapper/business/OfficialEventV2Mapper.xml')
const PAGE = path.join(ROOT, 'pages/merchant/coop-center/index.js')

// selectPublicV2Events 的顶层 select 列 → map 键名(别名;无别名取列名)
function publicListKeys(xml) {
  const at = xml.indexOf('<select id="selectPublicV2Events"')
  assert.ok(at >= 0, 'OfficialEventV2Mapper 缺 selectPublicV2Events')
  const body = xml.slice(xml.indexOf('>', at) + 1, xml.indexOf('</select>', at))
  const list = body.slice(body.search(/\bselect\b/) + 6, body.search(/\n\s*from official_event e\b/))
  const items = []
  let depth = 0, cur = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { items.push(cur); cur = '' } else cur += ch
  }
  items.push(cur)
  return items.map((item) => item.trim().split(/\s+/).pop().split('.').pop())
}

// 按 SQL 形状造一行;值只给列表 SQL 真会给的类型,listPublic 追加的两个 F21 字段照后端补上
function rowFromShape(keys, policy) {
  const row = {}
  for (const key of keys) row[key] = null
  Object.assign(row, { id: 7, title: '城市晨跑打卡周', status: 1 })
  if ('fulfillmentPolicy' in row) row.fulfillmentPolicy = policy
  row.recruitmentBlocked = policy === 'REQUIRED_FULFILLMENT'
  row.recruitmentBlockedReason = row.recruitmentBlocked ? '关键承接方缺失，待补位' : null
  return row
}

function loadEventsWith(rows) {
  const requests = []
  let definition
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options) },
    getRequestErrorMessage(res, fallback) { return fallback },
    tips() {},
  })
  global.getCurrentPages = () => [{ route: 'pages/merchant/coop-center/index' }]
  global.wx = { navigateTo() {}, navigateBack() {}, reLaunch() {}, showToast() {} }
  global.Page = (config) => { definition = config }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page.loadEvents()
  requests.find((r) => r.url === '/api/official/events').success({ code: 200, data: rows })
  return page.data.events
}

test('列表真实形状(真 SQL 列)带 fulfillmentPolicy,商家合作中心能命中可承接模式', () => {
  const keys = publicListKeys(fs.readFileSync(MAPPER, 'utf8'))
  assert.ok(keys.includes('title') && keys.includes('status'), '列解析自检:基础列必须解析得出')
  assert.ok(keys.includes('fulfillmentPolicy'), 'selectPublicV2Events 必须下发 fulfillmentPolicy')
  const events = loadEventsWith([
    rowFromShape(keys, 'OPTIONAL_PARTNERS'),
    Object.assign(rowFromShape(keys, 'REQUIRED_FULFILLMENT'), { id: 8 }),
    Object.assign(rowFromShape(keys, 'SELF_RUN'), { id: 9 }),
  ])
  assert.deepEqual(events.map((e) => e.id), [7, 8], '可选合作/必须承接进商家列表;自办不进(过滤语义不变)')
  assert.equal(events[1].recruitmentGapLabel, '信息不全', 'F21 缺口标记对商家可达')
})

test('负控:删掉 SQL 里的 fulfillment_policy 列 → 同形状被商家侧过滤成空(即线上现象)', () => {
  const xml = fs.readFileSync(MAPPER, 'utf8')
  const broken = xml.replace('e.fulfillment_policy fulfillmentPolicy,', '')
  assert.notEqual(broken, xml, '负控必须真的改到那一列')
  const keys = publicListKeys(broken)
  assert.ok(!keys.includes('fulfillmentPolicy'))
  assert.deepEqual(loadEventsWith([rowFromShape(keys, 'OPTIONAL_PARTNERS')]), [])
})
