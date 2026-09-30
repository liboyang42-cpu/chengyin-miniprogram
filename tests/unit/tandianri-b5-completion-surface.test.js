// 批5 · 探店日完局面(玩家角色)的行为契约 + 负控。
//
// 真源:裁决表 F4(图鉴复用 MemberCollectible 加 coll_type,不做稀有度/展示位/实体兑换)
//       开工计划 2-8 / 5-1 玩家链路末格「通关后图鉴落行」
//       审计 3 S10「展示复用既有面,不新建页面」· S7 的 J(自愿关注/入群)与 R90
//       遗留 U1「grantOnce 结果上凭证面(通关奖励到账明细)」· U3「F7 完局后 J/R90 入口」
//
// 落点为什么是订单详情:pages/play/index.js 与 pages/play/merchant/** 由别的会话拥有,
// 本轮不动;订单详情本来就是探店日的凭证面(已在渲染 entitlements 与票种快照),
// 图鉴/到账明细/回访入口三块与它同域,零新页(S10 明写不新建页面)。
//
// ★最要紧的一条负控:**没有数据不许渲染成 0**。
//   积分无流水 ⇒ 后端返 points=null,前端不得显示「获得 0 积分」;
//   没有下期 ⇒ nextEdition=null,前端不得显示「0 场」「0%」。
//   这与漏斗 R90「未满窗报观察中、不得记 0」是同一条纪律的前端半边。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ORDER_DETAIL = path.resolve(__dirname, '../../components/cy/scene-member-order-detail/index.js')
const ORDER_DETAIL_WXML = path.resolve(__dirname, '../../components/cy/scene-member-order-detail/index.wxml')

let sandbox

beforeEach(() => {
  sandbox = { requests: [], toasts: [], navigations: [] }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, user_id: 9 },
    getUserID: () => 9,
    tips: (m) => sandbox.toasts.push(m),
    sendRequest: (options) => { sandbox.requests.push(options) },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback || '未知错误',
    isDevEnv: () => false,
  })
  global.Component = (config) => {
    sandbox.config = Object.assign({}, config.methods, { data: config.data },
      config.lifetimes && config.lifetimes.attached ? { onLoad: config.lifetimes.attached } : {})
  }
  global.wx = {
    showLoading() {}, hideLoading() {},
    showToast: (o) => sandbox.toasts.push(o && o.title),
    showModal: (o) => { if (o && o.success) o.success({ confirm: true }) },
    navigateTo: (o) => sandbox.navigations.push(o.url),
    redirectTo: (o) => sandbox.navigations.push(o.url),
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    setClipboardData() {}, openLocation() {},
    requestPayment() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  }
})

function loadComponent() {
  delete require.cache[require.resolve(ORDER_DETAIL)]
  require(ORDER_DETAIL)
  const vm = Object.assign({}, sandbox.config, {
    setData(patch, cb) {
      if (!this.data) this.data = {}
      Object.entries(patch).forEach(([key, value]) => {
        if (key.indexOf('.') === -1) { this.data[key] = value; return }
        const parts = key.split('.')
        let cursor = this.data
        for (let i = 0; i < parts.length - 1; i += 1) {
          if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {}
          cursor = cursor[parts[i]]
        }
        cursor[parts[parts.length - 1]] = value
      })
      if (cb) cb()
    },
    triggerEvent() {},
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.config.data))
  return vm
}

function exploreOrder(extra) {
  return Object.assign({
    id: 1001,
    ownerType: 2,
    ownerId: 55,
    purchaseKind: 3,
    registrationStatus: 2,
    paymentStatus: 2,
    entitlements: [{ chapterId: 1, statusLabel: '待核销' }, { chapterId: 2, statusLabel: '待核销' }],
  }, extra || {})
}

function settleInfo(vm, order) {
  vm._orderId = 1001
  vm.getData()
  const infoReq = sandbox.requests.find((r) => r.url === '/api/registration/info')
  infoReq.success({ code: '200', data: order })
}

function completionRequests() {
  return sandbox.requests.filter((r) => r.url === '/api/registration/explore-completion')
}

function completionPayload(extra) {
  return Object.assign({
    registrationId: 1001,
    topicId: 77,
    completed: true,
    requiredChapterCount: 2,
    redeemedChapterCount: 2,
    stamps: [
      { chapterId: 1, title: '第一章 · 咖啡店', collected: true, obtainedAt: '2026-08-16 10:00:00' },
      { chapterId: 2, title: '第二章 · 面包房', collected: true, obtainedAt: '2026-08-16 12:00:00' },
    ],
    awards: { credited: true, points: 13, couponGranted: null, items: [
      { kind: 'BADGE', title: '通关勋章', iconUrl: '/x.png', grantedAt: '2026-08-16 12:00:00' },
      { kind: 'POINTS', title: '通关积分', amount: 13, grantedAt: '2026-08-16 12:00:00' },
    ] },
    revisit: { clubId: 7, clubName: '毛孩子俱乐部', clubLeaderMemberId: 70, followed: false, joined: false,
      nextEdition: { topicId: 88, name: '第二期', startDate: '2026-09-01 10:00:00' } },
  }, extra || {})
}

test('通关回执的 stamps 或 awards.items 包含空元素时不得崩溃或渲染伪凭证', () => {
  for (const payload of [
    completionPayload({ stamps: [null] }),
    completionPayload({ awards: { credited: true, items: [null] } }),
  ]) {
    sandbox.requests = []
    const vm = loadComponent()
    settleInfo(vm, exploreOrder())
    const request = completionRequests()[0]
    assert.doesNotThrow(() => request.success({ code: '200', data: payload }))
    assert.equal(vm.data.completion.show, false)
  }
})

// ---------- 拉取时机 ----------

test('探店日订单加载完成后拉完局面', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  assert.equal(completionRequests().length, 1)
  assert.deepEqual(completionRequests()[0].data, { id: 1001 })
})

test('negative control:非探店日订单(purchaseKind!=3)不得白查完局面', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder({ purchaseKind: 1, entitlements: [{ chapterId: 1 }] }))
  assert.equal(completionRequests().length, 0)
})

test('negative control:未支付的探店日订单不拉完局面(还没有可看的凭证)', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder({ registrationStatus: 1, paymentStatus: 0 }))
  assert.equal(completionRequests().length, 0)
})

test('negative control:两次刷新叠在一起时,先发的旧响应不得覆盖后发的新响应', () => {
  // onShow 会重复触发 getData ⇒ 完局面也会被重复拉。旧响应后到就把新数据顶掉,
  // 屏幕上会出现「核销完第二章后图鉴又退回一格」。订单本体已有同型守卫,这里必须同款。
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  vm.loadCompletion(exploreOrder()) // onShow 再拉一次,两条在途

  const reqs = completionRequests()
  assert.equal(reqs.length, 2)
  reqs[1].success({ code: '200', data: completionPayload() })            // 新响应先到
  reqs[0].success({ code: '200', data: completionPayload({               // 旧响应后到
    redeemedChapterCount: 0,
    stamps: [{ chapterId: 1, title: '第一章', collected: false }],
  }) })

  assert.equal(vm.data.completion.stampProgressText, '已集齐 2/2', '旧响应把新结果顶掉了')
})

test('negative control:完局面接口失败 ⇒ 整块不渲染,不留半个空壳', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].fail({})
  assert.equal(vm.data.completion.show, false)
})

// ---------- 图鉴(F4) ----------

test('图鉴按章渲染,并给出已集齐进度', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  assert.equal(vm.data.completion.show, true)
  assert.equal(vm.data.completion.stamps.length, 2)
  assert.equal(vm.data.completion.stamps[0].title, '第一章 · 咖啡店')
  assert.equal(vm.data.completion.stampProgressText, '已集齐 2/2')
})

test('未核销的章显示待核销,不伪装成已获得', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    completed: false, redeemedChapterCount: 1,
    stamps: [
      { chapterId: 1, title: '第一章', collected: true, obtainedAt: '2026-08-16 10:00:00' },
      { chapterId: 2, title: '第二章', collected: false },
    ],
    awards: { credited: false, points: null, couponGranted: null, items: [] },
  }) })
  assert.equal(vm.data.completion.stamps[1].collected, false)
  assert.equal(vm.data.completion.stamps[1].subText, '待核销')
  assert.equal(vm.data.completion.stampProgressText, '已集齐 1/2')
})

// ---------- 通关奖励到账明细 ----------

test('通关后列出真到账的勋章与积分', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  const items = vm.data.completion.awards.items
  assert.equal(items.length, 2)
  assert.equal(items[1].amountText, '+13')
})

test('玩家完局面列出持久化回读的通关探索值', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    awards: { credited: true, points: 13, earnedXp: 36, couponGranted: null, items: [
      { kind: 'BADGE', title: '通关勋章' },
      { kind: 'POINTS', title: '通关积分', amount: 13 },
      { kind: 'XP', title: '通关探索值', amount: 36 },
    ] },
  }) })

  const xp = vm.data.completion.awards.items.find((item) => item.kind === 'XP')
  assert.ok(xp, '玩家自己的完局面必须能看到 XP，不只给商家扫码 toast')
  assert.equal(xp.amountText, '+36')
})

test('negative control:没有积分流水(points=null)⇒ 不得渲染成「0 积分」', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    awards: { credited: true, points: null, couponGranted: null,
      items: [{ kind: 'BADGE', title: '通关勋章', grantedAt: '2026-08-16 12:00:00' }] },
  }) })
  const rendered = JSON.stringify(vm.data.completion.awards)
  assert.equal(vm.data.completion.awards.items.length, 1, '无流水时不许凭空多出一行积分')
  assert.equal(vm.data.completion.awards.items[0].kind, 'BADGE')
  assert.ok(!/0\s*积分|"amountText":"\+?0"/.test(rendered), '无流水时不许出现 0 积分:' + rendered)
})

test('negative control:后端把 amount 下成 null ⇒ 数字位留空,不折成 +0', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    awards: { credited: true, points: null, couponGranted: null,
      items: [{ kind: 'COUPON', title: '通关奖励券', amount: null, grantedAt: '2026-08-16 12:00:00' }] },
  }) })
  assert.equal(vm.data.completion.awards.items[0].amountText, '')
})

test('negative control:未通关 ⇒ 奖励区是进度提示,不是「暂无奖励」', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    completed: false, redeemedChapterCount: 1,
    awards: { credited: false, points: null, couponGranted: null, items: [] },
  }) })
  assert.equal(vm.data.completion.awards.emptyText, '走完全部 2 家店后发放')
})

test('negative control:已通关但一条到账都读不到 ⇒ 说「发放中」,不说「没有奖励」', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    awards: { credited: false, points: null, couponGranted: null, items: [] },
  }) })
  assert.equal(vm.data.completion.awards.emptyText, '奖励发放中，可稍后在勋章与积分明细里查看')
})

// ---------- J:自愿关注 / 入群 ----------

test('完局后出现自愿关注与入群入口', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  assert.equal(vm.data.completion.revisit.show, true)
  assert.equal(vm.data.completion.revisit.canFollow, true)
  assert.equal(vm.data.completion.revisit.canJoin, true)
})

test('negative control:已关注 / 已入群 ⇒ 不再重复引导', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    revisit: { clubId: 7, clubName: '毛孩子俱乐部', clubLeaderMemberId: 70, followed: true, joined: true, nextEdition: null },
  }) })
  assert.equal(vm.data.completion.revisit.canFollow, false)
  assert.equal(vm.data.completion.revisit.canJoin, false)
})

test('negative control:没有俱乐部事实(clubId 缺失)⇒ 回访入口整块不出现,不猜一个俱乐部', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    revisit: { clubId: null, clubName: null, clubLeaderMemberId: null, followed: false, joined: false, nextEdition: null },
  }) })
  assert.equal(vm.data.completion.revisit.show, false)
})

test('关注走既有 /api/user/follow/action,成功后刷新状态', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  vm.followClub()
  const follow = sandbox.requests.filter((r) => r.url === '/api/user/follow/action')
  assert.equal(follow.length, 1)
  assert.equal(follow[0].data.follow_member_id, 70)
  follow[0].success({ code: '200' })
  assert.equal(vm.data.completion.revisit.followed, true)
  assert.equal(vm.data.completion.revisit.canFollow, false)
})

test('negative control:关注重复提交 ⇒ 在途只发一次', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  vm.followClub()
  vm.followClub()
  vm.followClub()
  assert.equal(sandbox.requests.filter((r) => r.url === '/api/user/follow/action').length, 1)
})

test('negative control:关注失败 ⇒ 不得乐观置为已关注', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  vm.followClub()
  sandbox.requests.filter((r) => r.url === '/api/user/follow/action')[0].fail({})
  assert.equal(vm.data.completion.revisit.followed, false)
  assert.equal(vm.data.completion.revisit.canFollow, true, '失败后必须还能再试')
})

test('入群走既有 /api/club/join;pending 与 joined 两种回执都有明确表达', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  vm.joinClub()
  const join = sandbox.requests.filter((r) => r.url === '/api/club/join')
  assert.equal(join.length, 1)
  join[0].success({ code: '200', data: { state: 'pending' } })
  assert.equal(vm.data.completion.revisit.joined, false, 'pending 不是已入群')
  assert.equal(vm.data.completion.revisit.joinStateText, '申请已提交，等待主理人审核')
})

test('negative control:入群重复提交 ⇒ 在途只发一次', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  vm.joinClub()
  vm.joinClub()
  assert.equal(sandbox.requests.filter((r) => r.url === '/api/club/join').length, 1)
})

// ---------- R90:回访入口 ----------

test('有下期 ⇒ 出预告入口,点进去是那一期的主题详情', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  assert.equal(vm.data.completion.revisit.nextEditionText, '第二期 · 09-01 开场')
  vm.goNextEdition()
  assert.ok(sandbox.navigations.some((u) => u.indexOf('/pages/topic/index/index?id=88') === 0))
})

test('negative control:没有下期 ⇒ 明说没有,绝不渲染 0 场/0%', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    revisit: { clubId: 7, clubName: '毛孩子俱乐部', clubLeaderMemberId: 70, followed: false, joined: false, nextEdition: null },
  }) })
  assert.equal(vm.data.completion.revisit.hasNextEdition, false)
  assert.equal(vm.data.completion.revisit.nextEditionText, '下一期开售后会在这里出现')
  assert.ok(!/0\s*(场|%)/.test(vm.data.completion.revisit.nextEditionText))
})

test('negative control:没有下期时点预告钮不得跳空页', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    revisit: { clubId: 7, clubName: 'c', clubLeaderMemberId: 70, followed: false, joined: false, nextEdition: null },
  }) })
  vm.goNextEdition()
  assert.equal(sandbox.navigations.length, 0)
})

// ---------- 商家核销 → 玩家读面(跨角色的那一格) ----------

test('商家又核销一章后,玩家重进订单详情能看到图鉴前进(不必重启小程序)', () => {
  const vm = loadComponent()
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload({
    completed: false, redeemedChapterCount: 1,
    stamps: [
      { chapterId: 1, title: '第一章', collected: true, obtainedAt: '2026-08-16 10:00:00' },
      { chapterId: 2, title: '第二章', collected: false },
    ],
    awards: { credited: false, points: null, couponGranted: null, items: [] },
  }) })
  assert.equal(vm.data.completion.stampProgressText, '已集齐 1/2')

  // 商家在现场核销了第二章 —— 玩家侧靠 onShow 重新拉,不是靠冷启动。
  sandbox.requests.length = 0
  settleInfo(vm, exploreOrder())
  completionRequests()[0].success({ code: '200', data: completionPayload() })
  assert.equal(vm.data.completion.stampProgressText, '已集齐 2/2')
  assert.equal(vm.data.completion.awards.credited, true)
})

// ---------- wxml 真的消费了这些字段(防「数据链路通、屏幕上没有」) ----------

test('wxml 真的渲染了图鉴 / 到账明细 / 回访三块', () => {
  const wxml = fs.readFileSync(ORDER_DETAIL_WXML, 'utf8')
  assert.ok(/completion\.stamps/.test(wxml), '图鉴未被 wxml 消费')
  assert.ok(/completion\.awards\.items/.test(wxml), '到账明细未被 wxml 消费')
  assert.ok(/completion\.revisit\.show/.test(wxml), '回访入口未被 wxml 消费')
  assert.ok(/bindtap="followClub"/.test(wxml) && /bindtap="joinClub"/.test(wxml),
    '关注/入群必须有真绑定,不能只写 handler')
})
