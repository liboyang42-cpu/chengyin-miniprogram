'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_JS = 'pages/talent/list/index.js'
const PAGE_WXML = 'pages/talent/list/index.wxml'
const PAGE_JSON = 'pages/talent/list/index.json'
const POST_CARD_WXML = 'components/cy/post-card/index.wxml'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function setPath(target, dotted, value) {
  const parts = dotted.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}) })
  cursor[parts.at(-1)] = value
}

function loadPage(initialRole) {
  const requests = []
  let definition
  let role = initialRole || 'player'
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
    sendRequest(options) { requests.push(options) },
    getRequestErrorMessage(res, fallback) { return (res && res.msg) || fallback },
    getUserRole() { return role },
    getUserType() { return role === 'merchant' ? 2 : 1 },
    getImgUrl(value) { return value || '' },
  }
  global.getApp = () => app
  global.Page = (page) => { definition = page }
  global.wx = {
    getStorageSync() { return '' },
    showToast() {}, showModal() {}, navigateTo() {}, stopPullDownRefresh() {},
  }
  const modulePath = path.join(ROOT, PAGE_JS)
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value))
      if (callback) callback.call(this)
    },
  })
  return { page, requests, setRole(next) { role = next } }
}

function validHome() {
  return {
    code: '200',
    data: {
      owned: [{ id: 1, name: '夜行俱乐部' }],
      joined: [],
      nearby: [{ id: 2, name: '骑行社' }],
      leaderStatus: { isClubLeader: true, canCreate: true, ownedCount: 1, maxOwned: 3 },
    },
  }
}

function validFeed() {
  return {
    code: '200',
    data: {
      rows: [{ id: 8, clubId: 1, nickname: '小城', images: '', createTime: '2026-08-23 12:30:00' }],
      clubCount: 1,
    },
  }
}

test('成员管理首次业务失败进入可重试错误态，不伪装成暂无成员', () => {
  const { page, requests } = loadPage()
  page.data.managingClub = { id: 1, name: '夜行俱乐部' }
  page.loadClubMembers(1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/club/members')
  assert.equal(requests[0].hideLoading, true)
  assert.equal(requests[0].silentError, true)
  assert.deepEqual(JSON.parse(requests[0].data), { clubId: 1 })
  requests[0].success({ code: '500', msg: '无权查看' })
  assert.equal(page.data.clubMembersState, 'error')
  assert.equal(page.data.clubMembersError, '无权查看')
  assert.deepEqual(page.data.clubMembers, [])
})

test('成员列表拒绝 200 非数组载荷，网络失败也保持错误而非空态', () => {
  const business = loadPage()
  business.page.data.managingClub = { id: 1 }
  business.page.loadClubMembers(1)
  business.requests[0].success({ code: '200', data: {} })
  assert.equal(business.page.data.clubMembersState, 'error')

  const network = loadPage()
  network.page.data.managingClub = { id: 1 }
  network.page.loadClubMembers(1)
  network.requests[0].fail({ errMsg: 'request:fail offline' })
  assert.equal(network.page.data.clubMembersState, 'error')
})

test('成员刷新失败保留旧名单并进入 stale-error，重试复用当前俱乐部', () => {
  const { page, requests } = loadPage()
  page.data.managingClub = { id: 1 }
  page.loadClubMembers(1)
  requests[0].success({ code: '200', data: [{ memberId: 7, nickname: '阿城' }] })
  assert.equal(page.data.clubMembersState, 'ready')

  page.loadClubMembers(1)
  assert.equal(page.data.clubMembersState, 'refreshing')
  requests[1].fail({ errMsg: 'request:fail offline' })
  assert.equal(page.data.clubMembersState, 'stale-error')
  assert.deepEqual(page.data.clubMembers.map((item) => item.memberId), [7])

  page.retryClubMembers()
  assert.equal(requests.length, 3)
  assert.deepEqual(JSON.parse(requests[2].data), { clubId: 1 })
})

test('成员、首页与 feed 的同一资源重复加载只发一个请求', () => {
  const members = loadPage()
  members.page.data.managingClub = { id: 1 }
  members.page.loadClubMembers(1)
  members.page.loadClubMembers(1)
  assert.equal(members.requests.length, 1)

  const clubs = loadPage()
  clubs.page.loadClubHome()
  clubs.page.loadClubHome()
  assert.equal(clubs.requests.length, 1)

  const feed = loadPage()
  feed.page.loadFeed()
  feed.page.loadFeed()
  assert.equal(feed.requests.length, 1)
})

test('俱乐部首页刷新业务失败保留已展示分区并进入 stale-error', () => {
  const { page, requests } = loadPage()
  page.loadClubHome()
  assert.equal(requests[0].silentError, true)
  requests[0].success(validHome())
  assert.equal(page.data.clubsState, 'ready')

  page.loadClubHome()
  assert.equal(page.data.clubsState, 'refreshing')
  requests[1].success({ code: '200', data: { owned: [], joined: {}, nearby: [] } })
  assert.equal(page.data.clubsState, 'stale-error')
  assert.deepEqual(page.data.myClubs.map((item) => item.id), [1])
  assert.deepEqual(page.data.nearbyClubs.map((item) => item.id), [2])
})

test('俱乐部 feed 刷新网络失败保留旧帖，合法空结果进入 empty', () => {
  const { page, requests } = loadPage()
  page.loadFeed()
  requests[0].success(validFeed())
  assert.equal(page.data.feedState, 'ready')

  page.loadFeed()
  assert.equal(page.data.feedState, 'refreshing')
  requests[1].fail({ errMsg: 'request:fail offline' })
  assert.equal(page.data.feedState, 'stale-error')
  assert.deepEqual(page.data.feed.map((item) => item.id), [8])

  page.loadFeed()
  requests[2].success({ code: '200', data: { rows: [], clubCount: 0 } })
  assert.equal(page.data.feedState, 'empty')
  assert.deepEqual(page.data.feed, [])
})

test('商户同城范围读取失败以内联部分错误披露，并静默保留俱乐部列表', () => {
  const { page, requests } = loadPage('merchant')
  page.data._nearbyAll = [{ id: 2, city: '上海' }, { id: 3, city: '杭州' }]
  page.data.nearbyClubs = page.data._nearbyAll.slice()
  page.detectMerchant()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/merchant/info')
  assert.equal(requests[0].hideLoading, true)
  assert.equal(requests[0].silentError, true)
  requests[0].success({ code: '500', msg: '店铺资料不可用' })
  assert.equal(page.data.merchantCityState, 'error')
  assert.equal(page.data.merchantCityError, '店铺资料不可用')
  assert.equal(page.data.merchantCityErrorKind, 'data')
  assert.deepEqual(page.data.nearbyClubs.map((item) => item.id), [2, 3])
})

function assertStateMarkup(wxml, json, postCardWxml = read(POST_CARD_WXML)) {
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.equal(json.usingComponents['cy-progress-status'], '/components/cy/progress-status/index')
  assert.equal(json.usingComponents['cy-post-card'], '/components/cy/post-card/index')
  assert.match(wxml, /feedState === 'refreshing'/)
  assert.match(wxml, /clubsState === 'refreshing'/)
  // 刷新失败横幅退役:旧内容留在屏上,静默降级
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*State === 'stale-error'/)
  assert.match(wxml, /merchantCityState === 'error'[^>]*kind="\{\{merchantCityErrorKind\}\}"[^>]*bind:action="detectMerchant"/)
  assert.match(wxml, /clubMembersState === 'loading'[\s\S]*clubMembersState === 'error'[\s\S]*bind:retry="retryClubMembers"/)
  assert.match(wxml, /clubMembersState === 'empty'[\s\S]*title="暂无成员"/)
  assert.match(wxml, /aria-label="移除\{\{item\.nickname \|\| '该成员'\}\}"/)
  assert.match(wxml, /class="club-create-btn"[^>]*bindtap="onClubApply"[^>]*aria-role="button"[^>]*aria-label="创建俱乐部"/)
  // 2026-09-18 UI-19 用户:邀约情况不在俱乐部 tab 看,也不分「我的 / 附近」—— 这里是一张完整的俱乐部列表
  assert.doesNotMatch(wxml, /goCoopCenter|俱乐部邀约情况|>附近</)
  assert.match(wxml, /<cy-post-card\b[^>]*post="\{\{item\}\}"/)
  // 点赞图标已从位图 <image heart-filled.svg> 换成矢量 <cy-icon name="heart-filled">(已赞态)。
  assert.match(postCardWxml, /class="post-card__action[^>]*[\s\S]*?<cy-icon[^>]*class="post-card__heart[^>]*name="heart-filled"/)
  assert.doesNotMatch(wxml, /class="post-card__heart"/)
}

test('loading/refreshing/error/stale-error/empty 都有 DS 状态组件与可访问重试', () => {
  assertStateMarkup(read(PAGE_WXML), JSON.parse(read(PAGE_JSON)))
})

test('负控：把 stale-error 刷新失败横幅加回来时，状态闸门必须判红', () => {
  const wxml = read(PAGE_WXML).replace('</view>',
    '<cy-inline-error wx:if="{{clubMembersState === \'stale-error\'}}" bind:action="retryClubMembers" /></view>')
  assert.throws(() => assertStateMarkup(wxml, JSON.parse(read(PAGE_JSON))), /stale-error/)
})
