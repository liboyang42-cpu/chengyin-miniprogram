const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function createPage(relativePath, appOverrides, wxOverrides) {
  const requests = []
  const navigations = []
  const app = Object.assign({
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    // 商家页入口先静默确认登录(2026-09-16 去闸),未显式覆盖时按已登录处理。
    getUserID: () => 'member-1',
    sendRequest: (request) => requests.push(request),
    tips() {},
  }, appOverrides)

  global.getApp = () => app
  global.wx = Object.assign({
    getStorageSync: () => '',
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getSystemInfoSync: () => ({ statusBarHeight: 44 }),
    setNavigationBarColor() {},
    setBackgroundColor() {},
    navigateTo: (options) => navigations.push(options.url),
    navigateBack() {},
    showToast() {},
    showModal() {},
    getLocation() {},
    makePhoneCall() {},
  }, wxOverrides)

  let config
  global.Page = (pageConfig) => { config = pageConfig }
  const modulePath = path.join(ROOT, relativePath)
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)

  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return { page, requests, navigations }
}

test('type 0 keeps the publisher-to-merchant contract without club-only copy', () => {
  const coopList = read('pages/coop/list/index.js')
  const invite = read('pages/coop/invite/index.js')
  const inviteView = read('pages/coop/invite/index.wxml')

  assert.match(coopList, /type=0&toId=/)
  assert.match(invite, /主题发布者[^\n]*商家/)
  assert.doesNotMatch(invite + inviteView, /type=0[^\n]*(俱乐部邀商家|本俱乐部)/)
  assert.throws(() => assert.match(coopList.replace('type=0&toId=', 'type=2&toId='), /type=0&toId=/))
})

test('invite derives its theme and forged type2 routes fall back to the active type1 flow', () => {
  const colors = []
  const { page, requests } = createPage('pages/coop/invite/index.js', { getUserRole: () => 'player' }, { setNavigationBarColor: (value) => colors.push(value) })
  page.onLoad({ type: '2', topicId: '9' })
  page.onShow()
  assert.equal(colors.at(-1).frontColor, '#000000')
  assert.equal(page.data.activeType, 1)
  assert.equal(requests.length, 1)
  const targets = requests.find((r) => r.url === '/api/merchant/clubs')
  assert.ok(targets, '缺少合作对象列表请求')
  assert.equal(requests.some((r) => r.url === '/api/topic/info-to-user'), false,
    'type2 已撤销，不得再请求承接节点')

  targets.success({ code: '500' })
  assert.equal(page.data.targetsState, 'error')
  assert.equal(page.data.topicsState, 'ready')
})

test('invite picker meets the 88rpx touch baseline', () => {
  const style = read('pages/coop/invite/index.wxss')
  assert.match(style, /\.picker-row\s*\{[^}]*min-height:\s*88rpx/s)
  assert.throws(() => assert.match(style.replace('min-height: 88rpx', 'min-height: 64rpx'), /\.picker-row\s*\{[^}]*min-height:\s*88rpx/s))
})

test('nearby keeps permission, request error, and true empty states separate', async () => {
  let locate
  const { page, requests } = createPage('pages/coop/nearby/index.js', null, {
    getLocation: (options) => { locate = options },
  })
  page.onLoad()
  locate.success({ longitude: 120, latitude: 30 })
  requests[0].success({ code: '500' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(page.data.pageState, 'error')

  page.fetch(120, 30)
  requests[1].success({ code: '200', data: [] })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(page.data.pageState, 'ready')
  assert.deepEqual(page.data.merchants, [])
})

// 2026-08-10:行内发邀请撤掉,改成点整行进商家主页(在那儿看承接档案再发起合作)。
// 2026-08-11:落点从旧「承接商家」页改成统一主页的「关于」。合作名单是唯一带主题上下文的
// 入口 —— 它生成的是 contextual deep link,不是稳定 canonical。
test('nearby opens the unified home about tab and carries the topic context', () => {
  const { page, navigations } = createPage('pages/coop/nearby/index.js')
  page.data.topicId = '301'
  page.data.topicName = '苏河湾夜行'
  page.openMerchant({ currentTarget: { dataset: { memberid: '88' } } })
  assert.equal(navigations[0],
    '/pages/userinfo/userinfo?userId=88&tab=about&topicId=301&topicName=%E8%8B%8F%E6%B2%B3%E6%B9%BE%E5%A4%9C%E8%A1%8C')
})

// 未入驻的 lead 没有 memberId ⇒ 没有主页主体。不许拿列表行 id 当 userId 顶上去 ——
// 那会把人送进别人的主页。
test('nearby keeps unregistered leads on the phone-only path', () => {
  const toasts = []
  const { page, navigations } = createPage('pages/coop/nearby/index.js', null, {
    showToast: (options) => toasts.push(options.title),
  })
  page.openMerchant({ currentTarget: { dataset: { memberid: '' } } })
  assert.deepEqual(navigations, [])
  assert.match(toasts[0], /电话/)
})

test('nearby and list retry controls inherit the 88rpx page action token', () => {
  for (const page of ['nearby', 'list']) {
    const view = read(`pages/coop/${page}/index.wxml`)
    const style = read(`pages/coop/${page}/index.wxss`)
    assert.match(view, /<cy-error[^>]*class="retry-lg"/)
    assert.match(style, /\.retry-lg\s*\{\s*--cy-btn-h-sm:\s*var\(--cy-btn-h\);\s*\}/)
    assert.throws(() => assert.match(style.replace('var(--cy-btn-h)', 'var(--cy-btn-h-sm)'), /--cy-btn-h-sm:\s*var\(--cy-btn-h\)/))
  }
})

test('coop list distinguishes request failures from successful empty lists', () => {
  const { page, requests } = createPage('pages/coop/list/index.js')
  page.load()
  requests[0].success({ code: '500' })
  // 2026-09-07:合作池已删,load() 只剩协作邀请这一条航班
  assert.equal(page.data.listState, 'error')
})

test('coop list rejects a 200 response without received and sent arrays', () => {
  const { page, requests } = createPage('pages/coop/list/index.js')
  page.load()
  requests[0].success({ code: '200', data: {} })
  assert.equal(page.data.listState, 'error')
})

// 2026-09-15 总控裁决「已接受卡最多两个按钮」:供给申报从 coop/list 卡片搬进协作详情页,过滤口径原样跟随。
test('协作详情供给申报过滤历史无零售价或份数的模板', () => {
  const { page, requests } = createPage('pages/coop/invite-detail/index.js')
  page.data.state = 'ready'
  page.data.invite = { inviteId: '31', legacyReadonly: false }
  page.openPerkPick()
  requests[0].success({ code: '200', data: [
    { id: 1, name: '旧权益', retailValue: null, quota: null },
    { id: 2, name: '可用权益', retailValue: 68, quota: 10, perkType: 0 },
  ] })
  requests[1].success({ code: '200', data: [] })
  assert.deepEqual(page.data.perkTemplates.map((item) => item.id), [2])
})

// 2026-08-11:「发起合作」搬到统一主页的主动作位(阶段C 域,coop/invite 的 toId 契约在那边)。
// 旧壳这边守住同一个语义的另一半:merchantId 不得被当成主页主体 ID 用 ——
// 它只能换取 memberId,换不到就停在说明态,绝不拿 id 顶上去。
test('legacy shell resolves merchantId into memberId and never routes with the row id', () => {
  const { page, requests, navigations } = createPage('pages/merchant/profile/index.js', null, {
    redirectTo: (options) => navigations.push(options.url),
  })
  page.data.id = 'profile-row-7'
  page.resolveMerchant()
  assert.equal(requests[0].url, '/api/merchant/public-home')
  assert.deepEqual(JSON.parse(requests[0].data), { id: 'profile-row-7' })
  requests[0].success({ code: '200', data: { id: 7, memberId: 88 } })
  assert.equal(navigations[0], '/pages/userinfo/userinfo?userId=88&tab=about')
  assert.equal(navigations[0].includes('profile-row-7'), false, '旧档案主键不许出现在落点地址里')
})

test('legacy shell stops at an explained state when the merchant has no member subject', () => {
  const { page, requests, navigations } = createPage('pages/merchant/profile/index.js', null, {
    redirectTo: (options) => navigations.push(options.url),
  })
  page.data.id = 'profile-row-7'
  page.resolveMerchant()
  requests[0].success({ code: '200', data: { id: 7, name: '未绑定会员的店' } })
  assert.deepEqual(navigations, [])
  assert.equal(page.data.state, 'business-unavailable')
})

// 2026-08-10:俱乐部这支接上和商家同一条动线 ——
// 项目详情 → 俱乐部发现(合作页 club tab)→ 俱乐部主页 → 发起合作,
// topicId 一路带到条款表单,不许在中间任何一段掉。
test('找俱乐部走发现页,topicId 一路带到条款表单', () => {
  const host = createPage('pages/topic/merchantinfo/merchantinfo.js')
  host.page.data.topicId = 301
  host.page.data.info = { topicName: '苏河湾夜行' }
  host.page.goInviteClub()
  assert.match(host.navigations[0], /^\/pages\/merchant\/relation\/index\?tab=club&topicId=301&topicName=/)
  assert.doesNotMatch(host.navigations[0], /coop\/invite/, '不许一步跳进条款表单')

  const list = createPage('pages/merchant/relation/index.js')
  list.page.onLoad({ tab: 'club', topicId: '301', topicName: '%E8%8B%8F%E6%B2%B3%E6%B9%BE' })
  assert.equal(list.page.data.activeTab, 'club')
  list.page.goClub({ currentTarget: { dataset: { id: '9' } } })
  assert.match(list.navigations[0], /^\/pages\/club\/detail\/index\?id=9&topicId=301&topicName=/)

  const detail = createPage('pages/club/detail/index.js')
  detail.page.onLoad({ id: '9', topicId: '301', topicName: '%E8%8B%8F%E6%B2%B3%E6%B9%BE' })
  detail.page.data.club = { id: 9, name: '夜行团' }
  detail.page.goClubCoop()
  const last = detail.navigations[detail.navigations.length - 1]
  assert.match(last, /^\/pages\/coop\/invite\/index\?type=1&toId=9&toName=/)
  assert.match(last, /topicId=301/, 'topicId 掉在这一段 = 到了表单还要再选一遍主题')
})
