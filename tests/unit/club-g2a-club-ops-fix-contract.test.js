// 走查第二轮修复 · 批次 G2a-club-ops(C10 活动运营 / C11 主题详情 / C12 剧情与玩法)
//
// 每条都对应一个用户可观察的行为。页面断言尽量落在真跑出来的结果上(vm 装真页面、调真方法),
// 而不是「源码里有这串字」;负控用源码变异证明这条门禁能判红,不是橡皮图章。
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const datetime = require(path.resolve(__dirname, '../../utils/datetime.js'))

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const EVENT_OPS_JS = 'pages/club/event-ops/index.js'
const EVENT_OPS_WXML = 'pages/club/event-ops/index.wxml'
const TOPIC_DETAIL_JS = 'pages/club/topic-detail/index.js'
const TOPIC_DETAIL_WXML = 'pages/club/topic-detail/index.wxml'
const TOPIC_DETAIL_DIRECTOR_JS = 'pages/club/topic-detail/director.js'
const TOPIC_STORY_JS = 'pages/club/topic-story/index.js'
const CHINA_TODAY = datetime.chinaDateKey(new Date())
const pad2 = (n) => (n < 10 ? '0' + n : String(n))

// —— 共享沙箱 ——
// utils/toast.js 与 utils/modal.js 认「宿主」(getCurrentPages → page.selectComponent),宿主不在才回落原生。
// 这三个全局必须整份文件一直挂着:toast 是在页面方法被调用那一刻才发的,装完就还原会让它掉进回落分支。
const COLLECTED = { requests: [], toasts: [], modals: [], navigations: [] }
function resetCollected() {
  COLLECTED.requests = []
  COLLECTED.toasts = []
  COLLECTED.modals = []
  COLLECTED.navigations = []
}
const SANDBOX_PAGE = {
  selectComponent(id) {
    if (id === '#cy-toast') return { show: (o) => COLLECTED.toasts.push(o && o.title), hide() {} }
    return { open: (o) => COLLECTED.modals.push(o) }
  },
}
const REAL_WX = global.wx
const REAL_GETAPP = global.getApp
const REAL_GETPAGES = global.getCurrentPages
global.wx = {
  showToast: (o) => COLLECTED.toasts.push(o && o.title),
  hideToast: () => {},
  showModal: (o) => COLLECTED.modals.push(o),
  navigateTo: (o) => COLLECTED.navigations.push(o.url),
  navigateBack: () => {},
  switchTab: () => {},
  stopPullDownRefresh: () => {},
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
  getSystemInfoSync: () => ({}),
  setNavigationBarColor: () => {},
  setBackgroundColor: () => {},
}
global.getCurrentPages = () => [SANDBOX_PAGE]
test.after(() => {
  global.wx = REAL_WX
  global.getApp = REAL_GETAPP
  global.getCurrentPages = REAL_GETPAGES
})

function appMock() {
  return {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (options) => COLLECTED.requests.push(options),
    getUserID: () => 9008,
    getUserRole: () => 'CLUB',
    getUserType: () => 1,
  }
}

// 装页面:源码可传入(负控用变异后的源码);require 按页面目录解析相对路径。
function loadPage(rel, source) {
  resetCollected()
  let definition = null
  const app = appMock()
  global.getApp = () => app
  vm.runInNewContext(source || read(rel), {
    getApp: () => app,
    Page: (config) => { definition = config },
    wx: global.wx,
    console,
    // Date 用外层的:页面 require 的 utils/datetime.js 是外层模块,
    // 沙箱自带的 Date 实例过不了它的 `value instanceof Date`,会被当成解析失败。
    Date,
    setTimeout,
    clearTimeout,
    getCurrentPages: global.getCurrentPages,
    require: (id) => require(path.resolve(ROOT, path.dirname(rel), id)),
  }, { filename: rel })
  assert.ok(definition, `${rel} 没有注册到 Page()`)
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (typeof callback === 'function') callback.call(this)
    },
  })
  return { page, collected: COLLECTED }
}

// 页面里的纯函数抠出来真跑一遍(club-event-ops-series-title 同一手法)。
function loadPure(rel, names) {
  const src = read(rel)
  const body = names.map((name) => {
    const match = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(src)
    assert.ok(match, `${rel} 里找不到 function ${name},本合同的锚点要重挑`)
    return match[0]
  }).join('\n')
  const header = `const { chinaParts, chinaDateKey } = datetimeUtils;`
  const factory = new Function('datetimeUtils', `${header}\n${body}\nreturn { ${names.join(', ')} }`)
  return factory(datetime)
}

/* —————————————————— CU-C-34 开场主题选择器要能区分同名主题 —————————————————— */

test('CU-C-34:同名主题的候选文案带起止日期与承接来源,两条不再长得一样', () => {
  const { topicDropdownLabel } = loadPure(EVENT_OPS_JS, ['topicDropdownLabel'])
  const own = topicDropdownLabel({ id: 12, name: 'E2E 探店日一期', clubId: 7002, startDate: '2026-09-23 00:00:00', endDate: '2026-10-24 00:00:00' }, 7002)
  const coop = topicDropdownLabel({ id: 13, name: 'E2E 探店日一期', clubId: 8001, startDate: '2026-10-02 00:00:00', endDate: '2026-10-02 00:00:00' }, 7002)
  assert.notEqual(own, coop, '两条同名主题的候选文案完全一样 —— 管理员无从确认选的是哪一条')
  assert.ok(own.includes('E2E 探店日一期'), '名称要保留')
  assert.ok(own.includes('9月23日') && own.includes('10月24日'), `起止日期没进去:${own}`)
  assert.ok(own.includes('自有') && coop.includes('合作'), `承接来源没进去:${own} / ${coop}`)
})

test('CU-C-34:日期缺失时不编日期,但来源段仍在(不退回「看不出区别」)', () => {
  const { topicDropdownLabel } = loadPure(EVENT_OPS_JS, ['topicDropdownLabel'])
  assert.equal(topicDropdownLabel({ id: 12, name: '同名主题', clubId: 7002 }, 7002), '同名主题 · 日期未定 · 自有')
})

test('CU-C-34:展开候选与收起态都渲染这个字段(不能只改一半)', () => {
  const wxml = read(EVENT_OPS_WXML)
  assert.match(wxml, /range-key="dropdownLabel"/, '展开候选仍按 name 取名字段,同名项还是分不出来')
  assert.match(wxml, /\{\{topics\[topicIndex\]\.dropdownLabel\}\}/, '收起态还在显示纯名称')
  assert.doesNotMatch(wxml, /\{\{topics\[topicIndex\]\.name\}\}/, '收起态还留着旧的 name 绑定')
  assert.match(read(EVENT_OPS_JS), /dropdownLabel:\s*topicDropdownLabel\(item,\s*that\.data\.clubId\)/,
    'loadTopics 没给候选补上区分字段')
})

test('CU-C-34 负控:退化回「只回名称」,同名主题确实分不出来(判据认得出)', () => {
  const degenerate = (item) => String((item || {}).name || '')
  const a = { id: 12, name: 'E2E 探店日一期', clubId: 7002, startDate: '2026-09-23 00:00:00' }
  const b = { id: 13, name: 'E2E 探店日一期', clubId: 8001, startDate: '2026-10-02 00:00:00' }
  assert.equal(degenerate(a), degenerate(b), '只回名称时两条就是同一个字符串')
  const { topicDropdownLabel } = loadPure(EVENT_OPS_JS, ['topicDropdownLabel'])
  assert.throws(() => assert.equal(topicDropdownLabel(a, 7002), topicDropdownLabel(b, 7002)),
    (error) => error instanceof assert.AssertionError)
})

/* —————————————————— CU-C-46 下拉面板在深色页要拿到自己那份 token —————————————————— */

// 面板经 root-portal 脱离页面作用域,取不到页面那几个 --cy-color-*;组件必须自带一份默认镜像。
// 这份镜像与 tokens.wxss 的暗色语义真值层是「逐字对称」的关系 —— 值一漂,深色页上面板就与
// 页面其它表面不是同一套色。所以这里跨文件比对,而不是往测试里抄几个字面量。
function tokenValues(source, selectorPattern) {
  const block = new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(source)
  assert.ok(block, `找不到 ${selectorPattern} 块`)
  const values = {}
  for (const m of block[1].matchAll(/(--cy-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) values[m[1]] = m[2].trim()
  return values
}

test('CU-C-46:cy-dropdown 面板自带暗色 token 镜像,与 tokens.wxss 的暗色档逐字相同', () => {
  const tokens = tokenValues(read('style/tokens.wxss'), '^page')
  const dropdown = read('components/cy/dropdown/index.wxss')
  const layer = tokenValues(dropdown, '^\\.cdd__layer--portal')
  for (const key of ['--cy-color-bg-elevated', '--cy-color-text-primary', '--cy-color-border-subtle',
    '--cy-color-state-pressed', '--cy-color-action-primary-bg', '--cy-comp-card-shadow-day']) {
    assert.ok(tokens[key], `tokens.wxss 的页面块里没有 ${key},本合同的锚点要重挑`)
    assert.equal(layer[key], tokens[key], `.cdd__layer--portal 的 ${key} 与暗色真值层不一致`)
  }
  // 没兜底值的 var(--cy-z-modal) 一旦取不到,整条 z-index 作废 —— 面板会落到下方字段后面
  assert.match(dropdown, /z-index:\s*var\(--cy-z-modal,\s*900\)/, 'z-index 缺兜底值')
})

test('CU-C-46:商家亮色镜像仍压过默认镜像(别把商家页也拖成暗的)', () => {
  const dropdown = read('components/cy/dropdown/index.wxss')
  const merchant = tokenValues(dropdown, '^\\.cdd__layer\\.theme-merchant')
  assert.equal(merchant['--cy-color-bg-elevated'], '#FFFFFF')
  assert.equal(merchant['--cy-color-text-primary'], '#000000')
  assert.ok(dropdown.indexOf('.cdd__layer--portal {') < dropdown.indexOf('.cdd__layer.theme-merchant'),
    '默认镜像要写在商家镜像之前,免得后来者把商家值覆盖掉')
})

test('CU-C-46 负控:摘掉默认镜像,逐字对称那条断言必须判红', () => {
  const dropdown = read('components/cy/dropdown/index.wxss')
  const mutated = dropdown.replace(/[^\n]*--cy-color-bg-elevated:\s*#1C1C1E;[^\n]*\n/, '')
  assert.notEqual(mutated, dropdown, '变异没生效:锚点已漂,这个负控在空转')
  const tokens = tokenValues(read('style/tokens.wxss'), '^page')
  assert.equal(tokenValues(mutated, '^\\.cdd__layer--portal')['--cy-color-bg-elevated'], undefined)
  assert.notEqual(tokenValues(mutated, '^\\.cdd__layer--portal')['--cy-color-bg-elevated'], tokens['--cy-color-bg-elevated'])
})

/* —————————————————— CU-C-35 当天已过集合时刻不许提交 —————————————————— */

function clockNow(offsetMs) {
  const parts = datetime.chinaParts(new Date(Date.now() + offsetMs))
  return { date: datetime.chinaDateKey(new Date(Date.now() + offsetMs)), time: pad2(parts.hours) + ':' + pad2(parts.minutes) }
}

test('CU-C-35:日期=上海今天且时刻已过 ⇒ 判为已过;今天但时刻未到 / 非今天 ⇒ 放行', () => {
  const { assemblyAlreadyPast } = loadPure(EVENT_OPS_JS, ['assemblyAlreadyPast'])
  const now = Date.parse('2026-09-23T10:21:00+08:00')
  assert.equal(assemblyAlreadyPast(['2026-09-23', '2026-09-30'], '09:00', now), true,
    '表单日期就是今天、真正过期的是 09:00 的集合时刻 —— 这一条必须拦')
  assert.equal(assemblyAlreadyPast(['2026-09-23'], '11:00', now), false)
  assert.equal(assemblyAlreadyPast(['2026-09-24'], '09:00', now), false, '明天 09:00 当然没过期')
  assert.equal(assemblyAlreadyPast(['2026-09-23'], '下班', now), false, '时刻形状不对交给形状校验,这里不猜')
})

test('CU-C-35:提交时按上海当前时刻拦下,文案直说时刻(不是「早于今天」)', () => {
  const { page, collected } = loadPage(EVENT_OPS_JS)
  const past = clockNow(-5 * 60 * 1000)
  page.data.canManage = true
  page.data.clubId = 21
  page.data.topics = [{ id: 31, name: '周末路线', dropdownLabel: '周末路线 · 9月1日–9月30日 · 自有' }]
  page.data.recurrenceType = 'ONCE'
  page.data.startDate = past.date
  page.data.startTime = past.time
  page.submitSeries()
  assert.deepEqual(collected.requests, [], '已过时刻却把请求发出去了')
  assert.ok(collected.toasts.includes('集合时间必须晚于当前时间'),
    `提示必须说清是时刻的问题,实际:${JSON.stringify(collected.toasts)}`)
})

test('CU-C-35:客户端「今天」按上海日历算,不再读设备本地日历', () => {
  const { page } = loadPage(EVENT_OPS_JS)
  assert.equal(page.data.minDate, CHINA_TODAY, 'minDate 不是上海日历的今天')
  assert.equal(page.data.startDate, CHINA_TODAY)
  assert.deepEqual(Array.from(page.data.customDates), [CHINA_TODAY])
  const js = read(EVENT_OPS_JS)
  assert.doesNotMatch(js, /function localDate\(/, '设备本地日历的 localDate 还留着')
  assert.doesNotMatch(js, /minDate:\s*localDate\(/, 'minDate 又回到设备本地日历了')
})

test('CU-C-35 负控:把前置闸短路,「不许提交」那条断言必须判红(请求会真的发出去)', () => {
  const source = read(EVENT_OPS_JS)
  const mutated = source.replace('if (assemblyAlreadyPast(', 'if (false && assemblyAlreadyPast(')
  assert.notEqual(mutated, source, '变异没生效:锚点已漂,这个负控在空转')
  const { page, collected } = loadPage(EVENT_OPS_JS, mutated)
  const past = clockNow(-5 * 60 * 1000)
  page.data.canManage = true
  page.data.clubId = 21
  page.data.topics = [{ id: 31, name: '周末路线' }]
  page.data.recurrenceType = 'ONCE'
  page.data.startDate = past.date
  page.data.startTime = past.time
  page.submitSeries()
  assert.equal(collected.requests.length, 1, '闸被短路后请求没发出去 —— 这条判据认不出修复被撤掉')
})

/* —————————————————— CU-C-62 本场名册总人数 —————————————————— */

function rosterPayload(patch) {
  return {
    code: 200,
    data: Object.assign({
      registered: [],
      waitlist: [],
      arrived: [],
      noShow: [],
      phoneIncluded: false,
    }, patch || {}),
  }
}

test('CU-C-62:名册总数是三个到场桶之和,不是只数「已报名」', () => {
  const { rosterTotal } = loadPure(EVENT_OPS_JS, ['rosterTotal'])
  assert.equal(rosterTotal({ registered: [1], arrived: [2, 3], noShow: [] }), 3,
    '活动过点后后端把未到场整批挪进 noShow,只数 registered 会归零')
  assert.equal(rosterTotal({ registered: [], arrived: [], noShow: [1] }), 1)
  assert.equal(rosterTotal({ registered: [], arrived: [], noShow: [], waitlist: [1, 2] }), 0,
    '候补是另一份名单,不算进场名册')
  assert.equal(rosterTotal({}), 0, '字段缺失不许算成 NaN')
})

test('CU-C-62:roster 回包落到 rosterTotal,页面渲染它', () => {
  const { page, collected } = loadPage(EVENT_OPS_JS)
  page.data.canCheckin = true
  page.data.activityId = 31
  page.loadRoster()
  const call = collected.requests[0]
  assert.ok(call, 'loadRoster 没发请求')
  call.success(rosterPayload({
    arrived: [{ memberId: 9009, nickname: '到场的人' }, { memberId: 9010, nickname: '另一位' }],
    noShow: [{ memberId: 9011, nickname: '没到的人' }],
  }))
  assert.equal(page.data.rosterTotal, 3, '顶部总数随到场更正变成 0 就是这条要防的现场')
  assert.match(read(EVENT_OPS_WXML), /rosterTotal \+ ' 人'/, 'wxml 没渲染 rosterTotal')
})

/* —————————————————— CU-C-73 未来场次提前置灰更正入口 —————————————————— */

test('CU-C-73:roster 下发的可更正时段驱动置灰,并写明可操作时段', () => {
  const { page, collected } = loadPage(EVENT_OPS_JS)
  page.data.canCheckin = true
  page.data.activityId = 31
  page.loadRoster()
  collected.requests[0].success(rosterPayload({
    registered: [{ memberId: 9009, nickname: '已报名的人' }],
    correctionWindow: { startAt: '2026-10-02T10:00:00+08:00', endAt: '2026-10-04T10:00:00+08:00', operable: false },
  }))
  assert.equal(page.data.correctionOperable, false, '服务端说不能更正,前端却仍放开')
  assert.match(page.data.correctionWindowText, /10月2日 10:00/, `没写出可操作时段:${page.data.correctionWindowText}`)
  assert.match(page.data.correctionWindowText, /10月4日 10:00/)
  const wxml = read(EVENT_OPS_WXML)
  assert.match(wxml, /correctionWindowText/, '算出来的时段没渲染')
  assert.match(wxml, /\{\{actingMemberId \|\| !correctionOperable \? 'disabled' : ''\}\}/, '按钮没按可更正状态置灰')
})

test('CU-C-73:不可更正时点按钮不再弹原因输入框(填完才吃 409 就是这条要防的来回)', () => {
  const { page, collected } = loadPage(EVENT_OPS_JS)
  page.data.canCheckin = true
  page.data.activityId = 31
  page.loadRoster()
  collected.requests[0].success(rosterPayload({
    registered: [{ memberId: 9009, nickname: '已报名的人' }],
    correctionWindow: { startAt: '2026-10-02T10:00:00+08:00', endAt: '2026-10-04T10:00:00+08:00', operable: false },
  }))
  page.correctAttendance({ currentTarget: { dataset: { memberId: 9009, version: 0, arrived: true } } })
  assert.deepEqual(collected.modals, [], '不可更正却弹出了原因输入框')
  assert.ok(collected.toasts.includes('现在不能更正'))
  // toast 上限 16 字(UI-GATE-0),完整时段落在名册区那行提示上
  assert.match(page.data.correctionWindowText, /可更正时段/)
})

test('CU-C-73:可更正时段内照旧能打开原因输入框(不许把正常路径一起关掉)', () => {
  const { page, collected } = loadPage(EVENT_OPS_JS)
  page.data.canCheckin = true
  page.data.activityId = 31
  page.data.correctionOperable = true
  page.correctAttendance({ currentTarget: { dataset: { memberId: 9009, version: 0, arrived: true } } })
  assert.equal(collected.modals.length, 1, '可更正时段内反而打不开更正框')
})

test('CU-C-73:老后端没下发 correctionWindow 时不锁死入口(服务端仍会拦)', () => {
  const { page, collected } = loadPage(EVENT_OPS_JS)
  page.data.canCheckin = true
  page.data.activityId = 31
  page.loadRoster()
  collected.requests[0].success(rosterPayload())
  assert.equal(page.data.correctionOperable, true, '字段缺失就把入口锁死 = 新客户端配旧后端时更正功能整体消失')
  assert.equal(page.data.correctionWindowText, '')
})

test('CU-C-73 负控:去掉前置闸,「不可更正」那条断言必须判红(弹层会打开)', () => {
  const source = read(EVENT_OPS_JS)
  const mutated = source.replace('if (!this.data.correctionOperable) {', 'if (false) {')
  assert.notEqual(mutated, source, '变异没生效:锚点已漂,这个负控在空转')
  const { page, collected } = loadPage(EVENT_OPS_JS, mutated)
  page.data.canCheckin = true
  page.data.activityId = 31
  page.data.correctionOperable = false
  page.correctAttendance({ currentTarget: { dataset: { memberId: 9009, version: 0, arrived: true } } })
  assert.equal(collected.modals.length, 1, '闸被拿掉后行为没变 —— 这条判据认不出修复被撤掉')
})

/* —————————————————— CU-C-74 规则页不展示代码与开发备注 —————————————————— */

test('CU-C-74:RULES_SECTIONS 不再夹带代码原话、类名与给开发者的备注', () => {
  const js = read(TOPIC_DETAIL_JS)
  const block = /const RULES_SECTIONS = \[[\s\S]*?\n\];/.exec(js)
  assert.ok(block, 'RULES_SECTIONS 找不到了')
  for (const forbidden of ['RefundPolicy', '"', '原话', '判据', '许愿', '回包']) {
    assert.ok(!block[0].includes(forbidden), `规则文案里还留着实现细节:${forbidden}`)
  }
  // 业务句子必须还在 —— 别用「删空」冒充「改干净」
  for (const kept of ['主理人不能直接退出', '已核销不退', '进了履约窗不退', '取消一整场', '退出队伍']) {
    assert.ok(block[0].includes(kept), `业务规则被一起删掉了:${kept}`)
  }
})

test('CU-C-74:弹层里那两句开发者口径的页脚也没了', () => {
  const wxml = read(TOPIC_DETAIL_WXML)
  assert.doesNotMatch(wxml, /括号里是代码里的原话/)
  assert.doesNotMatch(wxml, /改文案前先改判据/)
  assert.doesNotMatch(wxml, /变成许愿/)
})

test('CU-C-74 负控:把类名放回 label,禁用词断言必须判红', () => {
  const js = read(TOPIC_DETAIL_JS)
  const mutated = js.replace("label: '退出以后的钱'", "label: '退出以后的钱（RefundPolicy 是唯一真源）'")
  assert.notEqual(mutated, js, '变异没生效:锚点已漂,这个负控在空转')
  assert.ok(/const RULES_SECTIONS = \[[\s\S]*?\n\];/.exec(mutated)[0].includes('RefundPolicy'))
})

/* —————————————————— CU-C-76 零成员时定向广播不可点 —————————————————— */

test('CU-C-76:广播入口按 canBroadcast 出两态,不可发送时写明是哪一种不能', () => {
  const wxml = read(TOPIC_DETAIL_WXML)
  const director = read(TOPIC_DETAIL_DIRECTOR_JS)
  assert.match(wxml, /wx:if="\{\{canBroadcast\}\}" class="cli-entry" bindtap="goBroadcast"/,
    '入口没有按 canBroadcast 分态 —— 零成员时仍可点')
  assert.match(wxml, /wx:else class="cli-entry cli-entry--disabled"/, '没有不可发送的那一态')
  // 2026-09-25 leftover 批次:置灰那句从模板里的固定串改成投影算好的 broadcastDisabledText ——
  // 「本场没跑起来」和「跑起来了但没人可送达」是两件事,写在模板里就只剩一句。
  assert.match(wxml, /<text class="cli-sub">\{\{broadcastDisabledText\}\}<\/text>/,
    '不可发送的文案没走投影算出来的那句')
  assert.match(director, /canBroadcast: hasAction\(availableActions, 'BROADCAST'\) && !projection\.broadcastBlocker/,
    '可点性没接后端的原因码,零成员仍然放行')
  assert.match(director, /NO_RECIPIENT: '[^']*报名进场[^']*'/,
    '零成员这一种原因没给下一步 —— 走查抱怨的正是「只说不能,不说怎样才能」')
  assert.match(director, /只有本场进行中才能发送/, '丢了「本场没跑起来」那一种说法')
  assert.match(read('pages/club/utils/club-game-director-adapter.js'), /broadcastBlocker/,
    '后端的原因码没进投影,前端只能继续按场次状态猜')
  assert.match(read('pages/club/topic-detail/index.wxss'), /\.cli-entry--disabled\s*\{[^}]*--cy-color-text-disabled/,
    '置灰态没走 token')
})

test('CU-C-76:发送被驳回时按后端原因码出话,不再统一「操作未生效」', () => {
  const director = read(TOPIC_DETAIL_DIRECTOR_JS)
  assert.match(director, /GAME_BROADCAST_NO_RECIPIENT/, '后端这个原因码前端没接住')
  assert.match(director, /toast\(rejectedActionText\(command\.action, result\.raw\)/,
    '驳回分支没读原因码')
})

test('CU-C-76 负控:把分态去掉,入口不分态那条断言必须判红', () => {
  const wxml = read(TOPIC_DETAIL_WXML)
  const mutated = wxml.replace('wx:if="{{canBroadcast}}" class="cli-entry"', 'class="cli-entry"')
  assert.notEqual(mutated, wxml, '变异没生效:锚点已漂,这个负控在空转')
  assert.equal(/wx:if="\{\{canBroadcast\}\}" class="cli-entry" bindtap="goBroadcast"/.test(mutated), false)
})

test('CU-C-76 负控:可点性不接原因码时,零成员入口判绿断言必须真红', () => {
  const director = read(TOPIC_DETAIL_DIRECTOR_JS)
  const mutated = director.replace(
    "canBroadcast: hasAction(availableActions, 'BROADCAST') && !projection.broadcastBlocker,",
    "canBroadcast: hasAction(availableActions, 'BROADCAST'),"
  )
  assert.notEqual(mutated, director, '变异没生效:锚点已漂,这个负控在空转')
  assert.equal(/canBroadcast: hasAction\(availableActions, 'BROADCAST'\) && !projection\.broadcastBlocker/.test(mutated), false,
    '回到旧写法 = BROADCAST 只看场次状态,零成员又能点进去')
})

/* —————————————————— CU-C-77 C12「看看模板」要带 scope=my —————————————————— */

test('CU-C-77:剧情与玩法的模板入口指向个人玩法(cms_member_template)', () => {
  const { page, collected } = loadPage(TOPIC_STORY_JS)
  page.onViewTemplate({ currentTarget: { dataset: { templateId: 990057 } } })
  assert.deepEqual(collected.navigations, ['/pages/templatedetail/templatedetail?id=990057&scope=my'],
    '丢了 scope=my 就会去 cms_template_library 查同一串 id,两个 id 空间各自自增 —— 实测弹「模版不存在」')
})

test('CU-C-77 负控:去掉 scope=my,上面那条断言必须判红', () => {
  const source = read(TOPIC_STORY_JS)
  const mutated = source.replace("templateId + '&scope=my'", 'templateId')
  assert.notEqual(mutated, source, '变异没生效:锚点已漂,这个负控在空转')
  const { page, collected } = loadPage(TOPIC_STORY_JS, mutated)
  page.onViewTemplate({ currentTarget: { dataset: { templateId: 990057 } } })
  assert.deepEqual(collected.navigations, ['/pages/templatedetail/templatedetail?id=990057'])
})

/* —————————————————— CU-C-80 改期返回后重拉「接下来」卡 —————————————————— */

test('CU-C-80:返回主题详情重拉详情与统计(首展不重复拉)', () => {
  const { page, collected } = loadPage(TOPIC_DETAIL_JS)
  page._topicId = 88
  page._clubId = 9
  page.data.loaded = true
  page.onShow()
  assert.deepEqual(collected.requests, [], '首次展示由 onLoad 负责,不该重复拉一遍')
  page.onShow()
  assert.deepEqual(collected.requests.map((r) => r.url),
    ['/api/topic/info-to-user', '/api/club/crm/topic-manage-stats'],
    '返回后没有重拉 —— 「接下来」卡会停在改期前的 activityList')
})

test('CU-C-80:整页错误态下返回不重拉(别把错误页刷成闪一下又回来)', () => {
  const { page, collected } = loadPage(TOPIC_DETAIL_JS)
  page._hasShown = true
  page.data.loaded = true
  page.data.loadError = true
  page.onShow()
  assert.deepEqual(collected.requests, [])
})

test('CU-C-80 负控:把首展闸去掉,「首展不重复拉」那条断言必须判红', () => {
  const source = read(TOPIC_DETAIL_JS)
  const mutated = source.replace(
    'if (!this._hasShown) { this._hasShown = true; return; }', 'if (false) { this._hasShown = true; }')
  assert.notEqual(mutated, source, '变异没生效:锚点已漂,这个负控在空转')
  const { page, collected } = loadPage(TOPIC_DETAIL_JS, mutated)
  page._topicId = 88
  page._clubId = 9
  page.data.loaded = true
  page.onShow()
  assert.equal(collected.requests.length, 2,
    '没有首展闸时首展就会重拉 —— 上面那条「首展不重复拉」的断言认得出区别,不是橡皮图章')
})

/* —————————————————— CU-C-88 主题内按报名口径命名 —————————————————— */

test('CU-C-88:入口与弹层都叫「报名参与者」,空态改「还没有人报名」', () => {
  const js = read(TOPIC_DETAIL_JS)
  const wxml = read(TOPIC_DETAIL_WXML)
  assert.match(js, /key: 'customer', label: '报名参与者'/)
  assert.match(wxml, /<cy-scene-sheet show="\{\{customerSheetVisible\}\}"[^>]*title="报名参与者"/, '弹层标题还叫「成员」')
  assert.match(wxml, /'还没有人报名'/, '空态文案没改')
  assert.doesNotMatch(wxml, /这个主题还没有成员/, '空态还按俱乐部成员口径写')
  assert.doesNotMatch(wxml, /title="成员"/, '页面上还留着「成员」标题')
})

test('CU-C-88 负控:把入口文案换回「成员」,同一条断言必须判红', () => {
  const js = read(TOPIC_DETAIL_JS)
  const mutated = js.replace("label: '报名参与者'", "label: '成员'")
  assert.notEqual(mutated, js, '变异没生效:锚点已漂,这个负控在空转')
  assert.equal(/key: 'customer', label: '报名参与者'/.test(mutated), false)
})

// 集成复审:镜像若挂在所有 .cdd__layer 上,portal=false 的内联下拉(编辑页亮色主题)会被暗色值盖掉 ⇒ 亮页上出暗面板。
test('CU-C-46:暗色镜像只给 portal 模式,.cdd__layer 本身不声明颜色 token', () => {
  const dropdown = read('components/cy/dropdown/index.wxss')
  const base = tokenValues(dropdown, '^\\.cdd__layer')
  assert.equal(base['--cy-color-bg-elevated'], undefined, '非 portal 的下拉必须继承页面 token')
  assert.match(read('components/cy/dropdown/index.wxml'), /\{\{portal \? 'cdd__layer--portal' : ''\}\}/)
})
