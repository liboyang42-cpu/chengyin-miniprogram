// 2026-09-16 总控真实商家号 + 真形状模拟数据拍的填充态截图里看到的界面问题(FILLED/21、23,SMOKE/003、095)。
// 每条锁:①行为(跑真代码) ②展示绑定 ③负控(把修复改回去必须真红)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matched = css.match(new RegExp('(?:^|\\n|\\})\\s*' + escaped + '\\s*\\{([^}]*)\\}'))
  assert.ok(matched, '缺少样式规则 ' + selector)
  return matched[1]
}

function mutated(source, from, to) {
  assert.ok(source.includes(from), '负控锚点失效: ' + from)
  return source.replace(from, to)
}

// ---------- 1. 优惠券管理页:券名看全 + 有效期只到日 ----------

function loadCouponPage(source) {
  const rel = 'subpackageMember/coupon/coupon.js'
  let definition
  const requests = []
  const modals = []
  vm.runInNewContext(source || read(rel), {
    getApp: () => ({ sendRequest: (options) => requests.push(options) }),
    Page: (value) => { definition = value },
    // 券类型文案走 utils/coupon-form.js 单一真源(资金线 C-38);日期/弹窗/提示取真模块 ——
    // 2026-09-17 起本页有「停发」动作,modal/toast 契约要真跑,不能再一律桩成主题对象。
    require: (id) => {
      if (/coupon-form\.js$/.test(id)) return require(path.join(ROOT, 'utils/coupon-form.js'))
      if (/datetime\.js$/.test(id)) return require(path.join(ROOT, 'utils/datetime.js'))
      if (/\/modal\.js$/.test(id)) return { show: (opts) => modals.push(opts) }
      if (/\/toast\.js$/.test(id)) return Object.assign(() => {}, { success() {}, error() {} })
      return { merchantPageShow() {}, merchantPageRestore() {} }
    },
  }, { filename: rel })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.__requests = requests
  page.__modals = modals
  page.getList()
  requests[0].success({
    code: 200,
    data: [{ id: 1, name: '城市运动装备馆 · 满100减20', startTime: '2026-09-01 00:00:00', endTime: '2026-10-31 23:59:59', publishCount: 120, receiveCount: 7 }],
  })
  return page
}

test('优惠券卡:有效期显示到分钟 YYYY.MM.DD HH:mm,缺失回「—」', () => {
  const coupon = loadCouponPage().data.list[0]
  assert.equal(coupon.startDay, '2026.09.01 00:00')
  assert.equal(coupon.endDay, '2026.10.31 23:59')

  const wxml = read('subpackageMember/coupon/coupon.wxml')
  assert.match(wxml, /class="david_tkb_li_con_top_time">\{\{item\.startDay\}\} – \{\{item\.endDay\}\}</)
  assert.match(wxml, /有效期（北京时间）[\s\S]*\{\{currentCoupon\.startDay\}\}[\s\S]*至 \{\{currentCoupon\.endDay\}\}/)
  assert.doesNotMatch(wxml, /\{\{(item|currentCoupon)\.(startTime|endTime)\}\}/, '券卡与详情弹窗不得再直出秒级原始时间')
})

test('优惠券卡负控:有效期展示退回整串时间必须真红', () => {
  const source = mutated(read('subpackageMember/coupon/coupon.js'),
    "return datetime.formatDayDots(value) + ' ' + String(parts.hours).padStart(2, '0')\n    + ':' + String(parts.minutes).padStart(2, '0');",
    'return String(value);')
  assert.notEqual(loadCouponPage(source).data.list[0].endDay, '2026.10.31 23:59')
})

function assertCouponHead(wxss) {
  const top = rule(wxss, '.david_tkb_li_con_top')
  const title = rule(wxss, '.david_tkb_li_con_top_tit')
  assert.match(top, /flex-direction:\s*column/)
  assert.match(title, /-webkit-line-clamp:\s*2/)
  assert.match(title, /width:\s*100%/)
  assert.doesNotMatch(title, /white-space:\s*nowrap/)
  assert.doesNotMatch(rule(wxss, '.david_tkb_li_con_top_time'), /flex-shrink:\s*0/)
}

test('优惠券卡头:券名独占整行最多两行,不再与有效期胶囊并排被挤成省略号', () => {
  assertCouponHead(read('subpackageMember/coupon/coupon.wxss'))
})

test('优惠券卡头负控:卡头改回左右并排必须真红', () => {
  const wxss = mutated(read('subpackageMember/coupon/coupon.wxss'), 'flex-direction: column; align-items: flex-start; gap: var(--cy-space-1);', 'align-items: center; justify-content: space-between;')
  assert.throws(() => assertCouponHead(wxss))
})

// ---------- 2. 我的参与:标题不被状态签挤压 ----------

function assertCanyuCard(wxml, wxss) {
  assert.match(wxml, /class="canyubox_li_right_top">\s*<view class="canyubox_li_right_top_zt">\s*<cy-badge[^>]*\/>\s*<\/view>\s*<view class="canyubox_li_right_top_name ep2">\{\{item\.sourceName\}\}<\/view>/)
  assert.match(rule(wxss, '.canyubox_li_right_top'), /flex-direction:\s*column/)
  assert.match(rule(wxss, '.canyubox_li_right_top_name'), /width:\s*100%/)
  assert.doesNotMatch(rule(wxss, '.canyubox_li_right_top_zt'), /(^|[;\s])width:\s*102rpx/)
}

test('我的参与卡:状态签在标题上方,标题整宽两行,状态签不再 102rpx 定宽', () => {
  assertCanyuCard(read('subpackageMember/mycanyu/mycanyu.wxml'), read('subpackageMember/mycanyu/mycanyu.wxss'))
})

test('我的参与卡负控:标题退回 ep1 / 状态签退回 102rpx 定宽都必须真红', () => {
  const wxml = read('subpackageMember/mycanyu/mycanyu.wxml')
  const wxss = read('subpackageMember/mycanyu/mycanyu.wxss')
  // 先在 thunk 外做变异:锚点漂移时 mutated 自己抛错会让测试红,不会被 assert.throws 吞成假绿
  const ep1Wxml = mutated(wxml, 'canyubox_li_right_top_name ep2', 'canyubox_li_right_top_name ep1')
  const fixedWidthWxss = mutated(wxss, '.canyubox_li_right_top_zt{ max-width: 100%;', '.canyubox_li_right_top_zt{ width: 102rpx;')
  assert.throws(() => assertCanyuCard(ep1Wxml, wxss))
  assert.throws(() => assertCanyuCard(wxml, fixedWidthWxss))
})

// ---------- 3. 「我的」主页我的项目预览:隐藏已结束(与工作台同一判据) ----------

function loadProfile(profileSource) {
  const PROFILE_JS = path.join(ROOT, 'components/cy/profile/index.js')
  const requests = []
  let definition
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '42', getUserRole: () => 'merchant', getUserType: () => 2,
    isDevEnv: () => false, setUserRole() {},
    sendRequest(options) { requests.push(options) },
  }
  const previous = { Component: global.Component, getApp: global.getApp, wx: global.wx }
  global.getApp = () => app
  global.wx = { getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {}, hideTabBar() {}, setNavigationBarColor() {}, setBackgroundColor() {} }
  global.Component = (value) => { definition = value }
  try {
    if (profileSource) {
      const Module = require('node:module')
      const m = new Module(PROFILE_JS, module)
      m.filename = PROFILE_JS
      m.paths = Module._nodeModulePaths(path.dirname(PROFILE_JS))
      m._compile(profileSource, PROFILE_JS)
    } else {
      delete require.cache[require.resolve(PROFILE_JS)]
      require(PROFILE_JS)
    }
  } finally {
    global.Component = previous.Component
    global.getApp = previous.getApp
    global.wx = previous.wx
  }
  const component = Object.assign({}, definition.methods, { data: JSON.parse(JSON.stringify(definition.data)) })
  component.setData = (patch) => Object.assign(component.data, patch)
  return { component, requests }
}

async function previewWith(rows, profileSource) {
  const { component, requests } = loadProfile(profileSource)
  const pending = component.loadProjectPreview()
  const request = requests.find((item) => item.url === '/api/topic/list')
  assert.ok(request, '缺少 /api/topic/list 请求')
  request.success({ code: 200, data: { rows } })
  await pending
  return component.data
}

// UI-7:预览要能翻页取够未结束项目 —— 按次序喂每一页,返回 { data, requests }。
async function previewSeq(pages, profileSource) {
  const { component, requests } = loadProfile(profileSource)
  const pending = component.loadProjectPreview()
  for (const rows of pages) {
    const request = requests.filter((item) => item.url === '/api/topic/list').at(-1)
    assert.ok(request, '缺少 /api/topic/list 请求')
    request.success({ code: 200, data: { rows } })
    await Promise.resolve() // 让 .then 链推进到下一页请求再喂下一页
  }
  await pending
  return { data: component.data, requests }
}

const ENDED = { id: 1, name: '早已结束', startDate: '2020-02-05', endDate: '2020-03-28' }
const LIVE = { id: 2, name: '还在进行', startDate: '2020-01-01', endDate: '2099-12-31' }
const UNKNOWN = { id: 3, name: '档期未知' }
const NOT_STARTED = { id: 4, name: '还没开始', startDate: '2099-01-01', endDate: '2099-12-31' }

test('我的项目预览:隐藏已结束项目,档期未知不算结束(与工作台 isEndedProject 同源)', async () => {
  const data = await previewWith([ENDED, LIVE, UNKNOWN])
  assert.deepEqual(data.projectPreviewList.map((item) => item.id), [2, 3])
  assert.equal(data.projectAllEnded, false)

  const js = read('components/cy/profile/index.js')
  assert.match(js, /const \{ isEndedProject, statusLabelOf \} = require\('\.\.\/\.\.\/\.\.\/utils\/merchant-workbench\.js'\);/,
    '状态章与已结束判据必须共用同一真源模块')
  assert.match(js, /isLiveProject\(item\)/)
  assert.doesNotMatch(js, /statusDone:\s*time\.percent/, '状态章不得再按毫秒进度另算一套已结束口径')
})

// 用户 2026-09-17 拍板第 38 条:未开始的项目原来也写「进行中」,与商家工作台不一致。
test('我的项目预览:未开始的项目状态章写「未开始」,与工作台 statusLabelOf 同源', async () => {
  const { statusLabelOf } = require('../../utils/merchant-workbench.js')
  assert.equal(statusLabelOf('2099-01-01', '2099-12-31'), '未开始', '共享真源必须给出「未开始」')

  const data = await previewWith([NOT_STARTED, LIVE])
  const notStarted = data.projectPreviewList.find((item) => item.id === 4)
  const live = data.projectPreviewList.find((item) => item.id === 2)
  assert.equal(notStarted.statusText, '未开始')
  assert.equal(notStarted.statusDone, false)
  assert.equal(live.statusText, '进行中')
})

test('我的项目预览:档期未知不给状态章(空文案),不编「进行中」', async () => {
  const data = await previewWith([UNKNOWN])
  assert.equal(data.projectPreviewList[0].statusText, '', '档期未知时与工作台同样不编状态')
  const wxml = read('components/cy/profile/index.wxml')
  assert.match(wxml, /<view wx:if="\{\{item\.statusText\}\}" class="pc-xbox-status/, '空文案不渲染章壳')
})

test('我的项目预览负控:状态章退回三元的「已结束/进行中」,未开始必须真红', async () => {
  const source = mutated(read('components/cy/profile/index.js'),
    'var statusText = statusLabelOf(item.startDate, item.endDate);',
    "var statusText = isEndedProject(item.startDate, item.endDate) ? '已结束' : '进行中';")
  const data = await previewWith([NOT_STARTED], source)
  assert.equal(data.projectPreviewList[0].statusText, '进行中', '负控应复现「未开始被写成进行中」')
})

test('我的项目预览:结束当天仍在预览里,状态章按日历日写「进行中」(旧毫秒进度会写已结束)', async () => {
  const { localToday } = require('../../utils/merchant-workbench.js')
  const today = localToday()
  const data = await previewWith([{ id: 9, name: '今天收尾', startDate: '2020-01-01', endDate: today }])
  assert.equal(data.projectPreviewList.length, 1)
  assert.equal(data.projectPreviewList[0].statusText, '进行中')
  assert.equal(data.projectPreviewList[0].statusDone, false)
})

test('我的项目预览负控:状态章改回毫秒进度判据,结束当天必须真红', async () => {
  const source = mutated(read('components/cy/profile/index.js'),
    'var statusText = statusLabelOf(item.startDate, item.endDate);',
    "var statusText = time.percent >= 100 ? '已结束' : '进行中';")
  const { localToday } = require('../../utils/merchant-workbench.js')
  const data = await previewWith([{ id: 9, name: '今天收尾', startDate: '2020-01-01', endDate: localToday() }], source)
  assert.equal(data.projectPreviewList[0].statusText, '已结束', '负控应复现结束当天被写成已结束')
})

test('我的项目预览:取完所有页都结束时才给「已收起」空态,不谎报「还没有项目」', async () => {
  const data = await previewWith([ENDED])
  assert.deepEqual(data.projectPreviewList, [])
  assert.equal(data.projectAllEnded, true)
  const wxml = read('components/cy/profile/index.wxml')
  assert.match(wxml, /<cy-empty wx:elif="\{\{projectAllEnded\}\}" title="已结束的项目已收起"[^>]*\/>\s*<cy-empty wx:else title="还没有项目"/)
})

// UI-7:第一页 8 条全结束时,必须继续翻页把后面进行中的项目取进预览(而不是整块空)。
test('UI-7 我的项目预览:第一页全结束时继续翻页,取够进行中的项目', async () => {
  const endedPage = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, name: '已结束 ' + i, startDate: '2020-01-01', endDate: '2020-02-01' }))
  const { data, requests } = await previewSeq([endedPage, [{ id: 7, name: '第二页进行中', startDate: '2020-01-01', endDate: '2099-12-31' }]])
  assert.equal(requests.filter((r) => r.url === '/api/topic/list').length, 2, '第一页零进行中时必须翻第二页')
  assert.deepEqual(data.projectPreviewList.map((item) => item.id), [7])
  assert.equal(data.projectAllEnded, false, '后面还有进行中的项目,不许落「已收起」空态')
})

test('UI-7 我的项目预览:取够 8 条进行中就停,不继续翻', async () => {
  const livePage = Array.from({ length: 8 }, (_, i) => ({ id: 200 + i, name: '进行中 ' + i, startDate: '2020-01-01', endDate: '2099-12-31' }))
  const { data, requests } = await previewSeq([livePage, [{ id: 999, name: '不该被取', startDate: '2020-01-01', endDate: '2099-12-31' }]])
  assert.equal(requests.filter((r) => r.url === '/api/topic/list').length, 1, '取够 8 条就不该再翻页')
  assert.equal(data.projectPreviewList.length, 8)
  assert.equal(data.projectPreviewList.some((item) => item.id === 999), false)
})

test('UI-7 我的项目预览负控:去掉翻页,第二页的进行中项目必须消失 ⇒ 用例真红', async () => {
  const source = mutated(read('components/cy/profile/index.js'), 'return fetchPage(pageNum + 1);', 'render(); return;')
  const endedPage = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, name: '已结束 ' + i, startDate: '2020-01-01', endDate: '2020-02-01' }))
  const { data } = await previewSeq([endedPage, [{ id: 7, name: '第二页进行中', startDate: '2020-01-01', endDate: '2099-12-31' }]], source)
  assert.deepEqual(data.projectPreviewList, [], '负控应复现「只取第一页 → 预览为空」')
  assert.equal(data.projectAllEnded, true, '负控里第二页的进行中项目不可见')
})

test('我的项目预览负控:去掉过滤后已结束项目必须重新出现', async () => {
  const source = mutated(read('components/cy/profile/index.js'), 'if (isLiveProject(item)) live.push(item);', 'live.push(item);')
  const data = await previewWith([ENDED, LIVE], source)
  assert.ok(data.projectPreviewList.some((item) => item.id === 1), '负控应复现已结束项目出现在预览里')
})

test('isEndedProject 判据:结束当天仍算进行中、档期未知不算结束(工作台同一函数)', () => {
  const { isEndedProject } = require('../../utils/merchant-workbench.js')
  assert.equal(isEndedProject('2026-09-01', '2026-09-02', '2026-09-16'), true)
  assert.equal(isEndedProject('2026-09-10', '2026-09-16', '2026-09-16'), false, '结束当天仍算进行中')
  assert.equal(isEndedProject('', '', '2026-09-16'), false, '档期未知不算结束')
})

// ---------- 4. 商家侧提现记录深链:保持商家白底 ----------

function loadTixianjilu(source) {
  const rel = 'subpackageMember/tixianjilu/tixianjilu.js'
  let definition
  vm.runInNewContext(source || read(rel), {
    getApp: () => ({}),
    Page: (value) => { definition = value },
    require: () => ({ merchantPageShow() {}, merchantPageRestore() {} }),
    getCurrentPages: () => [],
    wx: {},
  }, { filename: rel })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return page
}

test('商家提现记录深链:redirect 带 theme=merchant,目标页挂 theme-merchant;玩家入口仍是暗色', () => {
  assert.match(read('pages/coop/withdraw/records/index.js'),
    /const RECORDS_URL = '\/subpackageMember\/tixianjilu\/tixianjilu\?theme=merchant';/)

  const merchant = loadTixianjilu()
  merchant.onLoad({ theme: 'merchant' })
  assert.equal(merchant.data.isMerchant, true)

  const player = loadTixianjilu()
  player.onLoad({})
  assert.equal(player.data.isMerchant, false)

  const wxml = read('subpackageMember/tixianjilu/tixianjilu.wxml')
  assert.match(wxml, /^<view class="\{\{isMerchant \? 'theme-merchant' : 'theme-dark'\}\}">/)
  const wxss = read('subpackageMember/tixianjilu/tixianjilu.wxss')
  assert.match(wxss, /\.theme-dark,\s*\.theme-merchant\s*\{[^}]*background:\s*var\(--cy-color-bg-page\)/)
  assert.match(rule(wxss, '.theme-merchant .txjl-page-body'), /--cy-scene-card-bg:\s*var\(--cy-color-bg-surface\)/)
})

test('商家提现记录负控:onLoad 不读 theme 参数时商家入口必须真红', () => {
  const source = mutated(read('subpackageMember/tixianjilu/tixianjilu.js'),
    "options.theme === 'merchant'", 'false')
  const page = loadTixianjilu(source)
  page.onLoad({ theme: 'merchant' })
  assert.notEqual(page.data.isMerchant, true)
})

test('页面根主题门禁:提现记录归共享域(双主题),相邻玩家页不被放宽', () => {
  const { classifyPageDomain, topLevelThemeClasses } = require('../../scripts/ui-theme-unit-lint.js')
  assert.equal(classifyPageDomain('subpackageMember/tixianjilu/tixianjilu'), 'shared')
  const themes = topLevelThemeClasses(read('subpackageMember/tixianjilu/tixianjilu.wxml'))
  assert.ok(themes.has('theme-dark') && themes.has('theme-merchant'))
  // 对照:共享域正则只放行 tixianjilu,相邻的提现发起页 tixian 仍按玩家域判(没有被顺手放宽)
  assert.equal(classifyPageDomain('subpackageMember/tixian/tixian'), 'player')
})

// ---------- 5. 券有效期展示只到日(2026-09-17 拍板,替代上一轮「最多到分钟」) ----------

test('券核销码孪生页:有效期展示都走 datetime.formatDayDots,不再出现时刻', () => {
  const scene = read('components/cy/scene-qr-coupon/index.js')
  assert.match(scene, /endTime: dateText\(d\.endTime\)/)
  assert.doesNotMatch(scene, /slice\(0, 16\)/)
  const page = read('subpackageMember/coupon-qr/index.js')
  assert.match(page, /patch\['coupon\.startTimeText'\] = datetime\.formatDayDots\(d\.startTime\)/)
  assert.match(page, /patch\['coupon\.endTimeText'\] = datetime\.formatDayDots\(d\.endTime\)/)
  const shared = require('../../utils/datetime.js')
  assert.equal(shared.formatDayDots('2026-08-15 09:00:00'), '2026.08.15')
  assert.equal(shared.formatDayDots('2026-08-15T09:00:00.000+08:00'), '2026.08.15')
  assert.equal(shared.formatDayDots(''), '')
})
