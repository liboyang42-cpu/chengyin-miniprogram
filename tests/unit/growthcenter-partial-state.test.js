const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE_PATH = path.resolve(__dirname, '../../subpackageP3/pages/growthcenter/index/index.js')
const WXML_PATH = path.resolve(__dirname, '../../subpackageP3/pages/growthcenter/index/index.wxml')

let pageConfig
let requests

global.getApp = () => ({
  sendRequest(options) {
    requests.push(options)
  },
  getRequestErrorMessage(response, fallback) {
    return (response && (response.msg || response.message)) || fallback
  },
})

global.wx = {
  stopPullDownRefresh() {},
  switchTab() {},
  navigateBack() {}
}

global.Page = (config) => {
  pageConfig = config
}

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)]
  pageConfig = null
  require(PAGE_PATH)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data))
  })
  page.setData = (patch) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value))
  }
  return page
}

function respond(index, response) {
  const request = requests[index]
  if (response === 'fail') request.fail()
  else request.success(response)
}

async function loadOverview(page, responses) {
  requests = []
  page.loadOverview()
  assert.equal(requests.length, 3, '成长中心概览必须读取三条既有数据源')
  responses.forEach((response, index) => respond(index, response))
  await new Promise((resolve) => setImmediate(resolve))
}

const okCenter = (badges) => ({ code: 200, data: { growth: { levelNo: 2, expValue: 18 }, badges } })
const okPlay = { code: 200, data: { totalMileage: 1.2 } }
const okCompleted = { code: 200, data: [{ topicId: 7 }] }
const okRank = (me) => ({
  code: 200,
  data: { metric: 'point', period: 'total', list: [], me }
})

test('成长中心：徽章源失败时不得伪装成空徽章，必须给出可重试状态', async () => {
  const page = loadPage()
  await loadOverview(page, ['fail', okPlay, okCompleted])

  assert.equal(page.data.badgeLoadError, true)
  assert.equal(page.data.badgeCountText, '0')  // UI-04(2026-09-18):数字统计没取到显示 0
  assert.equal(page.data.showBadges, false)
  assert.equal(page.data.showBadgeEmpty, false)
  assert.equal(page.data.overview.stats[2].value, '1')
})

test('成长中心：徽章源成功且为空才进入“还没有点亮”空态', async () => {
  const page = loadPage()
  await loadOverview(page, [okCenter([]), okPlay, okCompleted])

  assert.equal(page.data.badgeLoadError, false)
  assert.equal(page.data.badgeCountText, '0')
  assert.equal(page.data.showBadges, false)
  assert.equal(page.data.showBadgeEmpty, true)
})

test('成长中心：徽章源恢复后清除错误态并显示徽章', async () => {
  const page = loadPage()
  await loadOverview(page, ['fail', okPlay, okCompleted])
  await loadOverview(page, [okCenter([{ badgeName: '开始在场' }]), okPlay, okCompleted])

  assert.equal(page.data.badgeLoadError, false)
  assert.equal(page.data.badgeCountText, '1')
  assert.equal(page.data.showBadges, true)
  assert.equal(page.data.showBadgeEmpty, false)
})

test('负控：删除徽章失败态接线时契约必须变红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const assertContract = (source) => {
    assert.match(source, /wx:if="\{\{badgeLoadError\}\}"/)
    assert.match(source, /bindtap="loadOverview"/)
    assert.match(source, /徽章数据暂时不可用/)
  }
  assertContract(wxml)
  assert.throws(() => assertContract(wxml.replace(/wx:if="\{\{badgeLoadError\}\}"/, 'wx:if="{{false}}"')))
  assert.throws(() => assertContract(wxml.replace('bindtap="loadOverview"', 'bindtap="noop"')))
})

test('成长中心：空榜不得把无排名用户显示成第一名', () => {
  const page = loadPage()
  page.buildMyRank({ me: { rank: null, score: 0 } })

  assert.equal(page.data.me, null)
})

test('成长中心：后端契约空榜 rank=null 是合法空态，不得误报数据畸形', () => {
  requests = []
  const page = loadPage()
  page.loadMyRank()
  requests[0].success(okRank({ memberId: 9, rank: null, score: 0, nickname: '林野' }))

  assert.equal(page.data.rankState, 'ready')
  assert.equal(page.data.rankLoaded, true)
  assert.equal(page.data.me, null)
  assert.equal(page.data.errorMsg, '')
})

test('成长中心：已确认空榜刷新失败保留空态快照，不退回首载错误', () => {
  requests = []
  const page = loadPage()
  page.loadMyRank()
  requests[0].success(okRank({ memberId: 9, rank: null, score: 0, nickname: '林野' }))

  page.loadMyRank()
  assert.equal(page.data.rankState, 'refreshing')
  requests[1].fail({ errMsg: 'request:fail timeout' })

  assert.equal(page.data.rankState, 'stale-error')
  assert.equal(page.data.rankLoaded, true)
  assert.equal(page.data.me, null)
  assert.equal(page.data.rankErrorKind, 'network')
})

test('成长中心：排行首载 single-flight，刷新失败保留旧排名，离页后迟到响应失效', () => {
  requests = []
  const page = loadPage()
  page.loadMyRank()
  page.loadMyRank()
  assert.equal(requests.length, 1, '同步重入不能发两次排行请求')
  requests[0].success(okRank({ rank: 3, score: 88, nickname: '林野' }))
  requests[0].complete()
  assert.equal(page.data.rankState, 'ready')
  assert.equal(page.data.me.name, '林野')

  page.loadMyRank()
  assert.equal(page.data.rankState, 'refreshing')
  assert.equal(page.data.me.name, '林野', '刷新时旧排名不能消失')
  requests[1].fail({ errMsg: 'request:fail timeout' })
  requests[1].complete()
  assert.equal(page.data.rankState, 'stale-error')
  assert.equal(page.data.rankErrorKind, 'network')
  assert.equal(page.data.me.name, '林野')

  page.loadMyRank()
  const late = requests[2]
  page.onUnload()
  late.success(okRank({ rank: 1, score: 999, nickname: '迟到数据' }))
  late.complete()
  assert.equal(page.data.me.name, '林野', '离页后的排行响应不得写回')
})

test('成长中心：排行榜 HTTP 403、404 与 500 分别落权限错误与可重试服务错误', () => {
  requests = []
  const cases = [
    [{ statusCode: 403, msg: '无权查看' }, 'permission', 'error', /权限|登录/],
    [{ statusCode: 404, msg: 'not found' }, 'error', 'error', /not found|没有加载出来/],
    [{ statusCode: 500, msg: '服务异常' }, 'error', 'error', /服务异常/],
  ]
  cases.forEach(([response, boardState, rankState, message]) => {
    const page = loadPage()
    requests = []
    page.loadMyRank()
    requests[0].successStatusAbnormal(response)
    assert.equal(page.data.boardState, boardState)
    assert.equal(page.data.rankState, rankState)
    assert.match(page.data.errorMsg, message)
    assert.doesNotMatch(page.data.errorMsg, /暂未开放/)
  })
})

test('成长中心：HTTP 200 但排行榜结构缺失必须 fail-closed', () => {
  requests = []
  const page = loadPage()
  page.loadMyRank()
  requests[0].success({ code: 200, data: {} })

  assert.equal(page.data.rankState, 'error')
  assert.equal(page.data.me, null)
  assert.match(page.data.errorMsg, /不完整|重试/)
})

test('成长中心：排行榜 null 数值或畸形榜单元素不得进入 ready', () => {
  const invalidResponses = [
    okRank({ memberId: 9, rank: false, score: 88, nickname: '林野' }),
    okRank({ memberId: 9, rank: 3, score: null, nickname: '林野' }),
    {
      code: 200,
      data: {
        metric: 'point',
        period: 'total',
        list: [{}],
        me: { memberId: 9, rank: 3, score: 88, nickname: '林野' }
      }
    },
  ]

  invalidResponses.forEach((response) => {
    requests = []
    const page = loadPage()
    page.loadMyRank()
    requests[0].success(response)
    assert.equal(page.data.rankState, 'error')
    assert.equal(page.data.me, null)
    assert.match(page.data.errorMsg, /不完整|重试/)
  })
})

test('成长中心：三路 HTTP 200 空对象不得伪造为零或空徽章', async () => {
  const page = loadPage()
  await loadOverview(page, [
    { code: 200, data: {} },
    { code: 200, data: {} },
    { code: 200, data: {} },
  ])

  assert.equal(page.data.overviewState, 'error')
  assert.equal(page.data.overviewLoaded, false)
  assert.equal(page.data.badgeLoadError, true)
  assert.equal(page.data.showBadges, false)
  assert.equal(page.data.showBadgeEmpty, false)
  assert.ok(page.data.overview.stats.every((item) => item.value === '0'), 'UI-04:概览统计没取到显示 0')
})

test('成长中心：概览 null 数值和畸形数组元素必须 fail-closed', async () => {
  const cases = [
    [
      { code: 200, data: { growth: { levelNo: null, expValue: 18 }, badges: [] } },
      okPlay,
      okCompleted,
    ],
    [
      { code: 200, data: { growth: { levelNo: 2, expValue: null }, badges: [] } },
      okPlay,
      okCompleted,
    ],
    [okCenter([{}]), okPlay, okCompleted],
    [okCenter([]), { code: 200, data: { totalMileage: null } }, okCompleted],
    [okCenter([]), okPlay, { code: 200, data: [{}] }],
  ]

  for (const responses of cases) {
    const page = loadPage()
    await loadOverview(page, responses)
    assert.notEqual(page.data.overviewState, 'ready')
    assert.match(page.data.overviewError, /部分|不可用|重试/)
  }
})

test('成长中心：概览首载有同构骨架，刷新保留内容且新徽章只在第二次真实新增时庆祝', async () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const json = fs.readFileSync(WXML_PATH.replace(/\.wxml$/, '.json'), 'utf8')
  assert.match(wxml, /rankState === 'loading' && !me[\s\S]*?<cy-skeleton/)
  assert.match(wxml, /overviewState === 'loading' && !overviewLoaded[\s\S]*?<cy-skeleton/)
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*rankState === 'stale-error'/)
  assert.match(wxml, /<cy-celebrate\b[^>]*event-key="\{\{celebrationEvent\}\}"/)
  assert.match(json, /"cy-celebrate"/)
  assert.match(json, /"cy-inline-error"/)
  assert.match(json, /"cy-progress-status"/)
  assert.match(json, /"cy-skeleton"/)

  const page = loadPage()
  await loadOverview(page, [okCenter([{ badgeCode: 'A', badgeName: '先行者' }]), okPlay, okCompleted])
  assert.equal(page.data.overviewState, 'ready')
  assert.equal(page.data.celebrationEvent, '', '首次装载已有徽章不能误庆祝')

  const oldOverview = page.data.overview
  requests = []
  page.loadOverview()
  assert.equal(page.data.overviewState, 'refreshing')
  assert.equal(page.data.overview, oldOverview, '刷新中必须保留最后一次足迹')
  assert.equal(requests.length, 3)
  respond(0, okCenter([
    { badgeCode: 'A', badgeName: '先行者' },
    { badgeCode: 'B', badgeName: '城市漫游者' },
  ]))
  respond(1, okPlay)
  respond(2, okCompleted)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.overviewState, 'ready')
  assert.match(page.data.celebrationEvent, /^badge:/)
  assert.match(page.data.badgeAnnouncement, /城市漫游者/)
})

test('负控：去掉排行 single-flight 或离页 epoch 后，状态机契约必须真红', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  const assertGuard = (candidate) => {
    assert.match(candidate, /if \(this\._rankLoading\)/)
    assert.match(candidate, /this\._rankEpoch = \(this\._rankEpoch \|\| 0\) \+ 1/)
    assert.match(candidate, /if \(epoch !== this\._rankEpoch\) return/)
  }
  assertGuard(source)
  assert.throws(() => assertGuard(source.replace('if (this._rankLoading)', 'if (false)')))
  assert.throws(() => assertGuard(source.replaceAll('if (epoch !== this._rankEpoch) return', 'if (false) return')))
})
