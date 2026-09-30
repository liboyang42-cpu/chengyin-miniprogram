const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const INCOME_DIR = path.join(ROOT, 'components/cy/scene-asset-income-detail')
const PROFIT_DIR = path.join(ROOT, 'components/cy/scene-merchant-profit')

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8')
}

function loadDefinition(source, app) {
  let definition = null
  const component = (value) => { definition = value }
  const localRequire = (request) => {
    if (request.includes('merchant-theme')) return {}
    // 2026-09-15 提现改弹客服微信后 scene-merchant-profit 多了一条 require;本组件测试不驱动提现。
    if (request.includes('withdraw-cs')) return { showWithdrawCsPopup() {} }
    throw new Error(`unexpected require: ${request}`)
  }
  new Function('Component', 'getApp', 'require', 'wx', source)(component, () => app, localRequire, {})
  return definition
}

function instantiate(definition) {
  const context = {
    data: JSON.parse(JSON.stringify(definition.data)),
    events: [],
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }
  Object.assign(context, definition.methods)
  return context
}

test('收益明细提供俱乐部筛选分支，并委托给财务唯一正文', () => {
  const requests = []
  const definition = loadDefinition(read(INCOME_DIR, 'index.js'), {
    sendRequest(options) { requests.push(options) },
  })
  const context = instantiate(definition)
  const clubTab = context.data.filterTabs.find((tab) => tab.key === 'club')

  assert.ok(clubTab, '收益筛选必须有稳定的 club 语义键')
  assert.ok(typeof clubTab.label === 'string' && clubTab.label.trim(), 'club tab 必须有可见标签')

  context.onFilterChange({ detail: { key: clubTab.key } })
  assert.equal(context.data.activeFilter, clubTab.key)
  assert.equal(requests.length, 0, '俱乐部分支不得误请求普通收益流水')
  context.data.hasMore = true
  context.loadMore()
  assert.equal(context.data.page_no, 1, '页面触底不得推进俱乐部分支的普通流水页码')
  assert.equal(requests.length, 0, '页面触底也不得误请求普通收益流水')

  const json = JSON.parse(read(INCOME_DIR, 'index.json'))
  assert.equal(json.usingComponents['cy-scene-merchant-profit'], '/components/cy/scene-merchant-profit/index')

  const wxml = read(INCOME_DIR, 'index.wxml')
  const branchStart = wxml.indexOf('<cy-scene-merchant-profit')
  const branchEnd = wxml.indexOf('<block wx:else', branchStart)
  assert.ok(branchStart >= 0 && branchEnd > branchStart, 'club 条件分支必须存在且与普通流水互斥')
  const clubBranch = wxml.slice(branchStart, branchEnd)
  assert.match(clubBranch, /<cy-scene-merchant-profit\b[^>]*activeFilter === 'club'/,
    'club 分支必须复用财务正文，不能复制一套流水')
  assert.match(clubBranch, /<cy-scene-merchant-profit\b[^>]*bind:close="onClubClose"/,
    '下钻结算详情前必须把财务正文的 close 事件交回场景宿主')

  const hostWxml = fs.readFileSync(path.join(ROOT, 'subpackageA/pages/assetcenter/earnings/index.wxml'), 'utf8')
  assert.match(hostWxml, /<cy-scene-asset-income-detail\b[^>]*bind:close="closeScene"/,
    '收益场景宿主必须接住新 tab 的离场事件')
})

/* CU-M-162(2026-09-24 走查):这一支读的是 /api/coop/finance —— 我作为发布方的各主题结算,
   自有商家主题(club_id 为空)的分润同样在列。标签写「俱乐部」等于把商家自己那本主题的钱
   说成俱乐部的钱。语义键 club 是两端契约,不动;对外按数据真覆盖的范围写。 */
function clubLabelOf(source) {
  const definition = loadDefinition(source, { sendRequest() {} })
  const tab = definition.data.filterTabs.find((item) => item.key === 'club')
  assert.ok(tab, "收益筛选必须有 club 这一支(语义键不许动)")
  return tab.label
}

test('CU-M-162 club 分支的对外标签覆盖它真装的数据', () => {
  const label = clubLabelOf(read(INCOME_DIR, 'index.js'))
  assert.doesNotMatch(label, /俱乐部/, 'tab 不得把主办分润只标成俱乐部')
  assert.ok(label.trim().length > 0, '标签不许为空')
})

test('negative control CU-M-162: 标签退回「俱乐部」必须判红', () => {
  const source = read(INCOME_DIR, 'index.js')
  const reverted = source.replace("{ key: 'club', label: '主办分润' }", "{ key: 'club', label: '俱乐部' }")
  assert.notEqual(reverted, source, '负控锚点失效:club 标签写法变了')
  assert.throws(() => assert.doesNotMatch(clubLabelOf(reverted), /俱乐部/), assert.AssertionError)
})

test('俱乐部分支可见地保留由应收与已付金额推导的打款状态', () => {
  const requests = []
  const definition = loadDefinition(read(PROFIT_DIR, 'index.js'), {
    sendRequest(options) { requests.push(options) },
  })
  const context = instantiate(definition)
  definition.lifetimes.attached.call(context)

  requests[0].success({
    code: '200',
    data: {
      topics: [
        { topicId: 1, settled: true, myIncome: 60, myIncomeArrived: true, merchantTotal: 100, merchantPaid: 0 },
        { topicId: 2, settled: true, myIncome: 60, myIncomeArrived: true, merchantTotal: 100, merchantPaid: 40 },
        { topicId: 3, settled: true, myIncome: 60, myIncomeArrived: true, merchantTotal: 100, merchantPaid: 100 },
      ],
    },
  })

  const rows = new Map(context.data.topics.map((row) => [row.topicId, row]))
  const statuses = new Set()
  for (const topicId of [1, 2, 3]) {
    const row = rows.get(topicId)
    assert.match(row.merchantTotalText, /^\d+\.\d{2}$/, '应收金额必须沿用两位小数口径')
    assert.ok(row.merchantStatus, '每条主题必须产出打款状态字段')
    assert.ok(row.metaText.includes(row.merchantStatus), '可见摘要必须包含打款状态')
    statuses.add(row.merchantStatus)
  }
  assert.equal(statuses.size, 3, '未付、部分支付、全额支付必须是三个可区分状态')

  const wxml = read(PROFIT_DIR, 'index.wxml')
  assert.match(wxml, /class="fc-meta[^>]*>\{\{item\.merchantStatus\s*\|\|/,
    '新 tab 必须渲染打款状态摘要，不能只保留收入流水')
})

test('资产正文不再保留独立俱乐部分润入口', () => {
  const wxml = read(path.join(ROOT, 'components/cy/scene-asset-earnings'), 'index.wxml')
  const js = read(path.join(ROOT, 'components/cy/scene-asset-earnings'), 'index.js')
  assert.doesNotMatch(wxml, /bind:tap="openCoopFinance"/)
  assert.doesNotMatch(js, /openCoopFinance\s*\(/)
})
