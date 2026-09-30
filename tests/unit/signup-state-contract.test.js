const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const source = () => read('subpackageMember/signup/index.js')
const wxml = () => read('subpackageMember/signup/index.wxml').replace(/<!--[\s\S]*?-->/g, '')

function setPath(target, dotted, value) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]] || (cursor[parts[index]] = {})
  }
  cursor[parts.at(-1)] = value
}

function loadPage(js = source()) {
  const sandbox = { requests: [], navigations: [], toasts: [] }
  const app = {
    getImgUrl: name => '/images/' + name,
    getPageSize: () => 10,
    getTotalPage: (total, size) => Math.ceil(Number(total || 0) / size),
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest(options) { sandbox.requests.push(options) },
  }
  const context = {
    getApp: () => app,
    Page(config) { sandbox.config = config },
    setTimeout() { return 1 },
    wx: {
      navigateTo(options) { sandbox.navigations.push(Object.assign({}, options)) },
      showToast(options) { sandbox.toasts.push(options && options.title) },
    },
    console,
    require(request) {
      if (request === '../../utils/play-engine.js') return require('../../utils/play-engine.js')
      throw new Error('unexpected require: ' + request)
    },
  }
  vm.createContext(context)
  vm.runInContext(js, context, { filename: 'subpackageMember/signup/index.js' })

  const page = Object.assign({}, sandbox.config)
  page.data = JSON.parse(JSON.stringify(sandbox.config.data))
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setPath(page.data, key, value))
    if (callback) callback()
  }
  return { page, sandbox }
}

/* 2026-09-09 票夹合并「路线 / 场次」两个 tab(用户裁决),这个 helper 随之重写。

   原来它钉三件事,都是为「两个 tab」而设:
     ① ready 主容器只由**当前 tab** 自己的 state 与列表控制
     ② 不能让 inactive tab 的数据拉起当前 tab 的 ready 容器
     ③ tabs 必须在 ready 容器外,当前 tab 为空时仍能切到另一类票

   合并之后 ①②③ 都不再是可能出错的形态 —— 只有一个 walletState、一条 ticketList,
   没有「当前 tab / 另一类票」这回事。但它们背后的**性质**要留住,换成合并后的说法:
     · 四态互斥:loading / error / empty / ready 只能有一个成立(用 wx:if + wx:elif 串起来)
     · 首载不闪空态:两路都还在 loading 时,walletState 必须是 loading 而不是 empty
       (这条在 rebuildTicketList 里,由下面那个 test 用真实状态跑出来验)
*/
function assertWalletStatesAreExclusive(template) {
  assert.match(
    template,
    /wx:if="\{\{walletState === 'loading'\}\}"/,
    'loading 态必须由 walletState 单独控制',
  )
  for (const state of ['error', 'empty']) {
    assert.match(
      template,
      new RegExp(`wx:elif="\\{\\{walletState === '${state}'\\}\\}"`),
      `${state} 必须挂在 wx:elif 上 —— 四态用 if/elif 串起来才互斥,并列 wx:if 会同时出现两块`,
    )
  }
  assert.match(
    template,
    /class="flex-a flex-col main"\s+wx:if="\{\{walletState === 'ready'\}\}"/,
    'ready 主容器只由 walletState 控制',
  )
  assert.doesNotMatch(
    template,
    /activeTab2|ticketTabs|<cy-tabs/,
    '票夹不再分 tab:残留的 tab 变量或组件说明合并没做干净',
  )
}

test('票夹首载两路保持 loading，当前 tab 不闪真实空态', () => {
  const { page, sandbox } = loadPage()

  page.onLoad({})

  // 两条支线的状态挂在实例上,不进 data:wxml 渲染的只有合成后的 walletState,
  // 原料也 setData 一遍会被 U4 死数据字段门禁判红。断言跟着搬,保护的性质不变。
  assert.equal(page._topic.state, 'loading')
  assert.equal(page._activity.state, 'loading')
  // 2 → 3:2026-09-06 补了队伍入口,onLoad 多一条 /api/team/my。
  // 这里原来只数条数,数条数说不清「多的那条是什么」——改成点名:两条票列表必须都在,
  // 队伍那条必须是 silentError(它挂了只该让那一行不出,不该在票夹上盖个全局报错)。
  assert.equal(sandbox.requests.length, 3)
  assert.ok(sandbox.requests.find((r) => r.data && r.data.owner_type === 1), '缺路线票列表请求')
  assert.ok(sandbox.requests.find((r) => r.data && r.data.owner_type === 2), '缺场次票列表请求')
  const teamRequest = sandbox.requests.find((r) => r.url === '/api/team/my')
  assert.ok(teamRequest, '缺我的队伍请求')
  assert.equal(teamRequest.silentError, true, '队伍拉不到只影响那一行,不许弹全局错')

  const template = wxml()
  const components = JSON.parse(read('subpackageMember/signup/index.json')).usingComponents
  assert.equal(components['cy-state-shell'], '/components/cy/state-shell/index')
  assert.equal(components['cy-skeleton'], '/components/cy/skeleton/index')
  // 2026-09-09 合并两个 tab 之后:一套骨架、一套空态,不再分「路线票 / 场次票」两句文案。
  assert.match(template, /walletState === 'loading'[\s\S]{0,240}<cy-skeleton\b[^>]*type="ticket"[^>]*loading-label="正在加载我的票"/)
  assert.doesNotMatch(template, /kind="loading"/, '票券结构已知，首载应使用同构票券骨架而不是通用转圈')
  assert.match(template, /walletState === 'empty'[\s\S]{0,240}还没有票/)
  // 空态文案要把两条来路都说清 —— 合并之后用户不知道票该从哪来
  assert.match(template, /去首页发现路线或报名场次/)
})

test('票券 skeleton 保留票面与票根轮廓，加载完成时不会产生大幅布局跳变', () => {
  const skeletonWxml = read('components/cy/skeleton/index.wxml')
  const skeletonWxss = read('components/cy/skeleton/index.wxss')
  assert.match(skeletonWxml, /type === 'ticket'[\s\S]*class="sk-ticket"/)
  assert.match(skeletonWxml, /class="sk-ticket-face"[\s\S]*class="sk-ticket-stub"/)
  assert.match(skeletonWxss, /\.sk-ticket\s*\{[^}]*border-radius:\s*var\(--cy-radius-lg\)/s)
  assert.match(skeletonWxss, /\.sk-ticket-stub\s*\{[^}]*border-top:\s*2rpx dashed/s)

  const mutated = skeletonWxml.replace(/<view wx:elif="\{\{type === 'ticket'\}\}"[\s\S]*?<\/view>\n\n<!-- 卡片骨架/, '<!-- 卡片骨架')
  assert.notEqual(mutated, skeletonWxml, '变异锚点失效：未找到 ticket skeleton 分支')
  assert.throws(() => assert.match(mutated, /type === 'ticket'[\s\S]*class="sk-ticket"/), assert.AssertionError)
})

test('票夹两路只把有效非空响应标为 ready，有效空列表标为 empty', () => {
  const { page, sandbox } = loadPage()
  page.onLoad({})
  const topicRequest = sandbox.requests.find(request => request.data.owner_type === 1)
  const activityRequest = sandbox.requests.find(request => request.data.owner_type === 2)

  topicRequest.success({
    code: 200,
    data: { rows: [{ id: 11, cmsTopic: { name: '梧桐路线' } }], total: 1 },
  })
  activityRequest.success({ code: 200, data: { rows: [], total: 0 } })

  assert.equal(page._topic.state, 'ready')
  assert.equal(page._topic.list.length, 1)
  assert.equal(page._activity.state, 'empty')
  assert.equal(page._activity.list.length, 0)
})

test('票夹两路失败各自进入 error，不会停在 loading 或伪装成 empty', () => {
  const { page, sandbox } = loadPage()
  page.onLoad({})
  const topicRequest = sandbox.requests.find(request => request.data.owner_type === 1)
  const activityRequest = sandbox.requests.find(request => request.data.owner_type === 2)

  topicRequest.success({ code: 200, data: null, msg: '路线票数据异常' })
  activityRequest.fail({ errMsg: 'request:fail timeout' })

  assert.equal(page._topic.state, 'error')
  assert.equal(page._activity.state, 'error')
  // 2026-09-09 合并后:两路都 error,合成的 walletState 才是 error。
  // 只有一路失败时不判死整页(那一路的票拿不到,另一路照常显示)——见 rebuildTicketList。
  assert.equal(page.data.walletState, 'error')
  assert.match(page._topic.err, /路线票数据异常|路线票加载失败/)
  assert.match(page._activity.err, /timeout|网络/)
})

/* 2026-09-09 原 test 是「inactive tab 有票时,当前 empty 仍只显示自己的空态并可切换」。
   合并两个 tab 之后没有「当前 / 另一类」了,那个场景不存在。
   但它保护的性质更要紧,而且合并之后**更容易踩**:一路空、一路有票时,
   整页必须是 ready 并且把有票那些显示出来 —— 绝不能因为「路线票为空」就整页空态。 */
test('一路空一路有票:合起来是 ready,有票的那些照常显示', () => {
  const { page, sandbox } = loadPage()
  page.onLoad({})
  const topicRequest = sandbox.requests.find(request => request.data.owner_type === 1)
  const activityRequest = sandbox.requests.find(request => request.data.owner_type === 2)

  topicRequest.success({ code: 200, data: { rows: [], total: 0 } })
  activityRequest.success({
    code: 200,
    data: { rows: [{ id: 22, cmsActivity: { name: '周末场次' } }], total: 1 },
  })

  assert.equal(page._topic.state, 'empty')
  assert.equal(page._activity.state, 'ready')
  assert.equal(page.data.walletState, 'ready', '一路空不该把整页判成空')
  assert.equal(page.data.ticketList.length, 1)
  assert.equal(page.data.ticketList[0].wTitle, '周末场次')
  assert.equal(page.data.ticketList[0].kind, 'activity', 'kind 决定点开跳哪,不能丢')
  assertWalletStatesAreExclusive(wxml())
})

test('负控：把 empty 从 wx:elif 改成并列 wx:if 时，互斥契约必须判红', () => {
  const template = wxml()
  const mutated = template.replace(
    `wx:elif="{{walletState === 'empty'}}"`,
    `wx:if="{{walletState === 'empty'}}"`,
  )
  assert.notEqual(mutated, template, '变异锚点失效：未找到 empty 的 wx:elif')
  assert.throws(() => assertWalletStatesAreExclusive(mutated), assert.AssertionError)
})

test('待支付和已取消票不得进 play，报名成功才带齐 id 开玩', () => {
  const { page, sandbox } = loadPage()
  const tap = (index) => ({ currentTarget: { dataset: { index } } })

  /* 2026-09-09 合并两个 tab 后入口从 goInfo 换成 goTicket,读的是合成后的 ticketList。
     ★ 这条钉的性质一个字没改:待支付 / 已取消的票**不许进 play**。
       它是资损闸 —— 让没付钱或已退的票开玩,等于白送一次体验。 */
  page.data.ticketList = [
    { id: 11, kind: 'topic', registrationStatus: 1, cmsTopic: { id: 501 } },
    { id: 12, kind: 'topic', registrationStatus: 3, cmsTopic: { id: 502 } },
    { id: 13, kind: 'topic', registrationStatus: 2, cmsTopic: {} },
    { id: 14, kind: 'topic', registrationStatus: 2, cmsTopic: { id: 990059 }, wTitle: '已经改名的四站试玩版' },
    { id: 15, kind: 'topic', registrationStatus: 2, cmsTopic: { id: 504 }, wTitle: '预制人生 · 同名普通活动' },
  ]

  page.goTicket(tap(0))
  assert.match(sandbox.navigations[0].url, /orderinfo\?id=11/)
  page.goTicket(tap(1))
  assert.equal(sandbox.navigations.length, 1)
  assert.ok(sandbox.toasts.includes('票已取消'))
  page.goTicket(tap(2))
  assert.equal(sandbox.navigations.length, 1)
  page.goTicket(tap(3))
  assert.equal(sandbox.navigations[1].url, '/subpackagePrefab/index?topicId=990059&registrationId=14&entry=ticket&topicName=' + encodeURIComponent('已经改名的四站试玩版'))
  page.goTicket(tap(4))
  assert.match(sandbox.navigations[2].url, /^\/pages\/play\/index\?topicId=504&/)
})

// 1-31 T31:registrationStatus=4(已过期)以前落进 wxs 默认分支,显示「待支付 / 去支付」。
test('T31:已过期票标签为「已过期」,不给支付按钮', () => {
  const m = wxml().match(/<wxs module="tk">([\s\S]*?)<\/wxs>/)
  assert.ok(m, 'tk wxs 模块必须存在')
  const mod = { exports: {} }
  new Function('module', m[1])(mod)
  const tk = mod.exports
  const expired = { registrationStatus: 4 }
  assert.equal(tk.label(expired), '已过期')
  assert.equal(tk.cta(expired), '')
  assert.notEqual(tk.state(expired), 'pending')
  assert.equal(tk.label({ registrationStatus: 1 }), '待支付', '待支付不受影响')
  assert.equal(tk.cta({ registrationStatus: 1 }), '去支付')
})
