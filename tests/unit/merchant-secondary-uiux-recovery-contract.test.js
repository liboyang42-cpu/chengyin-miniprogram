'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
let pageConfig
let requests
let navigations
let toasts

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44, menuButtonInfo: {} },
  getUserID: () => 7,
  getUserRole: () => 'merchant',
  getUserType: () => 2,
  setUserRole() {},
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
  tips(message) { toasts.push(message) },
})

global.wx = {
  getStorageSync: () => '',
  getSystemInfoSync: () => ({ statusBarHeight: 44, windowWidth: 375 }),
  getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 375 }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  setNavigationBarColor() {},
  setBackgroundColor() {},
  hideTabBar() {},
  hideLoading() {},
  showLoading() {},
  showToast(options) { toasts.push(options.title) },
  navigateBack() {},
  navigateTo(options) { navigations.push(options.url) },
  redirectTo(options) { navigations.push(options.url) },
  switchTab(options) { navigations.push(options.url) },
  reLaunch(options) { navigations.push(options.url) },
  showModal() {},
}

global.Page = (config) => { pageConfig = config }

function loadPage(relativePath) {
  pageConfig = null
  requests = []
  navigations = []
  toasts = []
  const absolute = path.join(ROOT, relativePath)
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch, done) {
    Object.entries(patch).forEach(([key, value]) => {
      const segments = key.split('.')
      let target = this.data
      for (let i = 0; i < segments.length - 1; i += 1) {
        target[segments[i]] = target[segments[i]] || {}
        target = target[segments[i]]
      }
      target[segments[segments.length - 1]] = value
    })
    if (done) done()
  }
  return page
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('终价预览保留旧结果并只接受最新请求', () => {
  const page = loadPage('pages/topic/pricing/index.js')
  page.data.topicId = 8
  page.data.floor = 20
  page.data.floorText = '20.00'
  page.data.hasPreview = true
  page.preview()
  page.preview()

  assert.equal(page.data.floorText, '20.00', '静默刷新不得先清掉旧价格')
  assert.equal(requests.length, 2)
  requests[1].success({ code: 200, data: { priceMin: 30, cityReferencePrice: 40, cityReferenceSampleSize: 2 } })
  requests[1].complete()
  requests[0].success({ code: 200, data: { priceMin: 10 } })
  requests[0].complete()
  assert.equal(page.data.floorText, '30.00')
  assert.equal(page.data.loading, false)
})

test('终价确认失败保留可恢复的页内错误，且重复点击只发一次', () => {
  const page = loadPage('pages/topic/pricing/index.js')
  Object.assign(page.data, { topicId: 8, canConfirmPrice: true, finalPrice: 45 })
  page.confirmPrice()
  page.confirmPrice()
  assert.equal(requests.length, 1)
  assert.equal(page.data.saving, true)
  requests[0].fail({ msg: '网络断开' })
  requests[0].complete()
  assert.match(page.data.submitError, /网络/)
  assert.equal(page.data.saving, false)
})

test('我的项目刷新失败保留最后一次成功列表并显示局部恢复入口', () => {
  const page = loadPage('subpackageA/pages/myproject/index.js')
  page._seq = 1
  page._all = [{ id: 1, bizType: 'topic', ownerType: 'merchant', state: 'running' }]
  Object.assign(page.data, { loaded: true, projectState: 'ready', list: [{ id: 1 }] })
  page.loadProjects()
  requests[0].fail({ msg: '网络断开' })
  requests[0].complete()
  assert.deepEqual(page.data.list, [{ id: 1 }])
  assert.equal(page.data.projectState, 'ready')
  assert.match(page.data.projectErrorMsg, /网络断开/)

  const wxml = read('subpackageA/pages/myproject/index.wxml')
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*projectErrorMsg/)
  assert.match(read('subpackageA/pages/myproject/index.json'), /"cy-inline-error"/)
})

test('节点玩法刷新失败保留旧货架，错误不再把内容整页替换', () => {
  // 2026-08-26:四刀切退役,旧货架 = topList/tailList;「已有内容」的标志位从 hasHome 换成 listLoaded。
  const page = loadPage('pages/template/index.js')
  page.data.tab = 'game' // 2026-08-27:失败半边按当前 tab 闸,刷新失败场景发生在游戏 tab 上
  page.data.topList = [{ id: 1, _title: '旧玩法' }]
  page.data.listLoaded = true
  page.getGameRows()
  requests[0].fail({ msg: '网络断开' })
  requests[0].complete()
  assert.equal(page.data.topList[0]._title, '旧玩法', '刷新失败不许把已有列表清掉')
  assert.match(page.data.errorMsg, /网络断开/)

  const wxml = read('pages/template/index.wxml')
  // 2026-08-26 拆两 tab:状态位统一到 errorMsg/listLoaded,刷新失败横幅随 #856 一起退役。
  // 守的是同一件事 —— 有旧内容时的刷新失败一律静默降级,不许把横幅加回来。
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{\s*errorMsg && listLoaded\s*\}\}"/)
  assert.match(read('pages/template/index.json'), /"cy-inline-error"/)
})

// 2026-08-26:分类切换改成纯前端重排 —— 不再发请求,「标签与货架错位」这个窗口从根上没有了。
// 原契约守的是「异步期间别让标签先跳」;新结构下更强的等价断言是「切换根本不产生请求」。
test('分类切换不发请求,因此不存在标签与货架错位的窗口', () => {
  const page = loadPage('pages/template/index.js')
  page._gameRows = [
    { id: 1, _title: '餐饮玩法', _cats: '2' },
    { id: 2, _title: '别的玩法', _cats: '9' },
    { id: 3, _title: '另一餐饮玩法', _cats: '2' },
  ]
  page.data.tab = 'game'
  page.data.listLoaded = true
  const before = requests.length

  page.switchCat({ currentTarget: { dataset: { id: 2 } } })
  assert.equal(requests.length, before, '切分类不许再发网络请求')
  assert.equal(page.data.activeCat, 2, '选中标签立即生效')
  assert.equal(page.data.banner._title, '餐饮玩法', '首个命中品类展示为精选')
  assert.deepEqual(page.data.topList.map((r) => r._title), ['另一餐饮玩法'], '其余命中品类置顶，精选不重复进列表')
  assert.deepEqual(page.data.tailList.map((r) => r._title), ['别的玩法'], '未命中的不筛掉,继续显示')
})

test('节点玩法重新显示时请求全部分类，但成功前不让标签与旧货架错位', () => {
  const js = read('pages/template/index.js')
  assert.match(js, /this\.getHome\(\);/, 'onShow 必须重新拉品类')
  assert.match(js, /this\.loadTab\(this\.data\.tab\);/, '并按当前 tab 拉对应列表')
})

test('节点玩法货架不再用首字、字符星星或 CSS 渐变冒充图形资产', () => {
  const js = read('pages/template/index.js')
  const wxml = read('pages/template/index.wxml')
  assert.doesNotMatch(js, /ICON_COLORS|_initial:|_c1:|_c2:/)
  assert.doesNotMatch(wxml, /\{\{\s*item\._initial\s*\}\}/)
  assert.doesNotMatch(wxml, /★★★★★/)
  assert.doesNotMatch(wxml, /linear-gradient/)
  // 2026-08-25 用户裁决删除「热门节点榜」整节:榜单分割线与星形评分两条断言主语已不存在,
  // 随节退役;此处补一条反向断言,防止哪天有人把榜单连同字符星星一起搬回来。
  assert.doesNotMatch(wxml, /hot-divider|class="hot-/)
  // 2026-08-26:货架图形位收敛成「具象图标 → 封面 → 明确失败态」三段,
  // 原来的 cy-icon name="route" 兜底位随主题模板货架独立板块一起退役。
  // 守的不变量没变:没有资源时给明确失败态,不许伪造资产。
  assert.match(wxml, /class="cml-pic cover-error"[\s\S]*?封面暂不可用/)
  assert.match(read('pages/template/index.json'), /"cy-icon"/)
})

// 2026-08-25:「圈层自由探索」整节按用户裁决删除,本契约收窄到模板货架这一半。
test('模板货架公开列表 loading、error、stale 和重试，复制失败仍保留 JS 恢复状态', () => {
  const js = read('pages/template/index.js')
  const wxml = read('pages/template/index.wxml')
  // 2026-08-26:两个 tab 共用一套四态,tt 专属的 loading/error 已退役并入 loading/errorMsg
  assert.match(js, /loading:\s*false/)
  assert.match(js, /errorMsg:\s*''/)
  assert.doesNotMatch(js, /circleThemes/)
  assert.doesNotMatch(wxml, /circleThemes/)
  assert.doesNotMatch(wxml, /ttError && ttLoaded/)  // 刷新失败横幅退役,静默降级
  assert.doesNotMatch(wxml, /bind:action="getTopicTemplates"/)  // 随刷新失败横幅一起退役
  assert.match(wxml, /<cy-error\b[^>]*errorMsg[^>]*bindretry="retryTemplateLoad"/,
    '列表加载失败必须有可见重试入口')
  assert.match(wxml, /wx:if="\{\{ loading && listLoaded \}\}"[^>]*class="tpl-refreshing"/,
    '保留旧内容刷新时必须公开 stale/loading 状态,不能让旧货架冒充最新结果')
  // 2026-08-28 用户裁决撤掉货架按钮:复制动作暂时失去本页可见载体,
  // 但 useTt 仍是未来详情页复用的写入口,失败对象与错误文案必须留给 retryUseTt。
  assert.match(js, /that\.data\.ttUseRetryItem = item;[\s\S]{0,180}?ttUseError:/)
  assert.match(js, /retryUseTt\(\)\s*\{[\s\S]{0,180}?this\.useTt\(/)
})

test('整包模板复制失败保留页内恢复入口，模板上下架重复点击只发一次', () => {
  const page = loadPage('pages/template/index.js')
  const template = { id: 23, name: '城市夜行', previewOnly: false }
  page.useTt({ currentTarget: { dataset: { item: template } } })
  assert.equal(requests.length, 1)
  requests[0].fail({ msg: '复制失败' })
  requests[0].complete()
  assert.match(page.data.ttUseError, /复制失败/)
  assert.equal(page.data.ttUseRetryItem.id, 23)

  const project = loadPage('subpackageA/pages/myproject/index.js')
  const event = { currentTarget: { dataset: { id: 9, pub: 0 } } }
  project.tplToggle(event)
  project.tplToggle(event)
  assert.equal(requests.length, 1)
  // M-06:上架须「已发布且已同步」(后端同口径),否则必败,不给「发布到玩法库」;已上架的仍保留下架
  assert.match(read('subpackageA/pages/myproject/index.wxml'),
    /<view wx:if="\{\{item\.publishStatus == 1 \|\| \(item\.draftStatus == 1 && item\.isSync == 1\)\}\}" class="mp-op mp-op-toggle" catchtap="tplToggle"/)

  const wxml = read('pages/template/index.wxml')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{ttUseError\}\}"[^>]*bind:action="retryUseTt"/)
})

test('提现页的资金提交门闩随建单链路一起退役,只留客服弹窗', () => {
  // 2026-09-15 收款模型定稿 §3:平台不打款,本页「确认提现」不再建提现单。
  // 原来这两条钉的是「submitting 门闩要暴露给按钮 / 同步异常也要释放门闩」——
  // 门闩守的那次资金提交已不存在,留着就是守一个假事实。改成反向断言:
  // saveData 必须只弹平台客服微信,不得再出现门闩置位与建单/预检调用。
  const js = read('subpackageMember/tixian/tixian.js')
  const body = js.slice(js.indexOf('saveData: function()'), js.indexOf('getUserData: function()'))
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.match(stripped, /withdrawCs\.showWithdrawCsPopup\(\)/, '「确认提现」必须弹平台客服微信')
  assert.doesNotMatch(stripped, /submitBankWithdrawal|withdrawal\/create/, '不得再建提现单')
  assert.doesNotMatch(stripped, /_submitting\s*=\s*true|submitting:\s*true/, '资金门闩已随建单链路退役')
  // 2026-09-16:表单本身也已退役(页面只留客服入口)——门闩与输入控件一起从 wxml 撤除。
  assert.doesNotMatch(read('subpackageMember/tixian/tixian.wxml'), /canSubmit|placeholder-class="tx-placeholder"/,
    '银行卡表单已退役,页面不该再有提交门闩或银行卡输入控件')
})

test('设置页查询俱乐部失败不再假装用户未申请，并用真实图标替代字符箭头', () => {
  const page = loadPage('pages/shezhi/shezhi.js')
  page.closeScene = () => {}
  page.pickClub()
  requests[0].fail({ msg: '网络断开' })
  assert.deepEqual(navigations, [])
  assert.match(toasts[0], /加载失败|网络/)

  const wxml = read('pages/shezhi/shezhi.wxml')
  assert.doesNotMatch(wxml, />›</)
  assert.match(wxml, /<cy-icon[^>]*name="arrow-right"/)
  assert.match(read('pages/shezhi/shezhi.json'), /"cy-icon"/)
})
