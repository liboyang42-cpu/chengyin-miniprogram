const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PROFILE_JS = path.join(ROOT, 'components/cy/profile/index.js')
const PROFILE_WXML = path.join(ROOT, 'components/cy/profile/index.wxml')
const PROFILE_WXSS = path.join(ROOT, 'components/cy/profile/index.wxss')
const read = (file) => fs.readFileSync(file, 'utf8')

let componentDefinition
let requests

const app = {
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => '42',
  getUserRole: () => 'player',
  getUserType: () => 1,
  isDevEnv: () => false,
  setUserRole() {},
  sendRequest(options) { requests.push(options) },
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

function loadProfile() {
  const previous = { Component: global.Component, getApp: global.getApp, wx: global.wx }
  requests = []
  componentDefinition = null
  global.getApp = () => app
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    hideTabBar() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
  }
  global.Component = (definition) => { componentDefinition = definition }
  delete require.cache[require.resolve(PROFILE_JS)]
  require(PROFILE_JS)
  global.Component = previous.Component
  global.getApp = previous.getApp
  global.wx = previous.wx

  const component = Object.assign({}, componentDefinition.methods, {
    data: JSON.parse(JSON.stringify(componentDefinition.data)),
  })
  component.data.isSelf = true
  component.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(component.data, key, value))
    if (callback) callback()
  }
  return component
}

function respond(url, response) {
  const request = requests.find((item) => item.url === url)
  assert.ok(request, `缺少请求 ${url}`)
  if (response === 'fail') request.fail({ errMsg: 'network error' })
  else request.success(response)
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
}

function successSources(overrides) {
  const values = Object.assign({
    user: {
      followNum: 0,
      fansNum: 0,
      topicNum: 0,
      activityNum: 0,
      likeNum: 0,
      point: 0,
    },
    play: { level: 1, totalCheckins: 0, totalMileage: 0, streakDays: 0 },
    center: { growth: { levelNo: 1, expValue: 0 }, points: 0 },
    completed: [],
    points: { weekPoints: 0, rankPercentage: 'TOP0%', rankDelta: 0 },
  }, overrides)
  return {
    '/api/user/info': { code: 200, data: values.user },
    '/api/play/growth': { code: 200, data: values.play },
    '/api/growth/center': { code: 200, data: values.center },
    '/api/play/my-completed': { code: 200, data: values.completed },
    '/api/user/points/statistics': { code: 200, data: values.points },
  }
}

async function loadMetricSources(component, sources) {
  component.resetProfileMetricState()
  const pending = [
    component.loadUserData(),
    component.loadGrowthBundle(),
    component.loadThemes(),
    component.loadPointsStat(),
  ]
  Object.entries(sources).forEach(([url, response]) => respond(url, response))
  await Promise.all(pending)
  await flush()
}

test('首访：所有来源成功且从未参与时进入引导态，不把空数据渲染成一屏零值', async () => {
  const component = loadProfile()
  await loadMetricSources(component, successSources())

  assert.equal(component.data.profileMetricState, 'empty')
  // 2026-09-18 UI-04 用户拍板:数字统计没取到显示 0,不再是「—」。
  // 空态判定不受影响(它看的是 userSignals 原值,不是这个展示兜底)。
  assert.equal(component.data.friendNum, 0, '字段缺失按 UI-04 兜底成 0')
})

test('真实零：有过节点参与的老用户即使里程、EXP、周积分都为零，仍展示真实指标', async () => {
  const component = loadProfile()
  await loadMetricSources(component, successSources({
    play: { level: 1, totalCheckins: 2, totalMileage: 0, streakDays: 0 },
  }))

  assert.equal(component.data.profileMetricState, 'ready')
  assert.equal(component.data.identityCard.km, '0.0')
  assert.equal(component.data.exploreValue, 0)
  assert.equal(component.data.exploreStat.weekExp, 0)
  assert.equal(component.data.followNum, 0)
  assert.equal(component.data.fansNum, 0)
})

test('历史参与：没有节点打卡但已有核销通关记录时，不得误判为首访', async () => {
  const component = loadProfile()
  await loadMetricSources(component, successSources({
    completed: [{ activityId: 9, topicId: 3, doneCount: 0, completed: true }],
  }))

  assert.equal(component.data.profileMetricState, 'ready')
})

test('非零资料：已有关注或发布记录时直接展示，不用探索空态遮住真实资料', async () => {
  const component = loadProfile()
  await loadMetricSources(component, successSources({
    user: {
      followNum: 1,
      fansNum: 0,
      topicNum: 0,
      activityNum: 0,
      likeNum: 0,
      point: 0,
    },
  }))

  assert.equal(component.data.profileMetricState, 'ready')
  assert.equal(component.data.followNum, 1)
  assert.equal(component.data.fansNum, 0)
})

test('请求失败：参与判据这次没取到时进入错误态，不能降级成首访或真实零', async () => {
  const component = loadProfile()
  const sources = successSources()
  sources['/api/play/growth'] = 'fail'
  await loadMetricSources(component, sources)

  assert.equal(component.data.profileMetricState, 'error')
})

test('字段缺失：成功响应缺少 totalCheckins 时仍是错误态，不能把缺失字段补成零', async () => {
  const component = loadProfile()
  await loadMetricSources(component, successSources({
    play: { level: 1, totalMileage: 0, streakDays: 0 },
  }))

  assert.equal(component.data.profileMetricState, 'error')
})

test('字段缺失：积分响应只有 weekPoints 时进入错误态，不能把缺失排名标成 ready', async () => {
  const component = loadProfile()
  await loadMetricSources(component, successSources({
    points: { weekPoints: 0 },
  }))

  assert.equal(component.data.profileMetricState, 'error')
})

function assertFirstRunMarkup(wxml, wxss) {
  assert.match(wxml, /class="pc-gamer-streak" wx:if="\{\{isSelf && profileMetricState === 'ready'\}\}">连续探索：\{\{streakDays \|\| 0\}\}天/)
  assert.match(wxml, /class="pc-stats" wx:if="\{\{!isSelf \|\| profileMetricState === 'ready'\}\}"/)
  assert.match(wxml, /class="pc-stat-n">\{\{friendNum\}\}[\s\S]*class="pc-stat-n">\{\{followNum\}\}[\s\S]*class="pc-stat-n">\{\{fansNum\}\}/)
  assert.match(wxml, /wx:elif="\{\{isSelf && profileMetricState === 'empty'\}\}"[^>]*title="第一段城市探索还没开始"[^>]*cta="去探索"[^>]*bind:cta="goRoam"/)
  // 2026-08-19:重取按钮从自绘的 .pc-metric-retry 收编进 cy-error 自己的 retry 按钮 ——
  // 原写法不传 retry 也不绑 bind:retry,cy-error 仍会渲染一个默认「重试」而没人监听 = 死按钮,
  // 与下面自绘的「重新加载」凑成两个 CTA。契约跟着改成「事件必须绑在组件上」。
  assert.match(wxml, /wx:elif="\{\{isSelf && profileMetricState === 'error'\}\}"[^>]*class="pc-metric-error"[\s\S]{0,400}?<cy-error[\s\S]{0,300}?bind:retry="reloadProfileMetrics"/)
  assert.doesNotMatch(wxml, /class="pc-metric-retry"/, '自绘的第二个 CTA 必须已经删掉,一屏只留一个重取入口')
  assert.match(wxml, /class="pc-achievement-metrics" wx:if="\{\{profileMetricState === 'ready'\}\}"/)
  assert.match(wxml, /aria-label="城瘾积分 \{\{profilePoint\}\}"[\s\S]*class="pc-gs-num">\{\{profilePoint\}\}/)
  assert.match(wxml, /class="pc-rank-v">\{\{exploreStat\.shops \|\| 0\}\}家店/)
  assert.match(wxml, /wx:elif="\{\{profileMetricState === 'empty'\}\}"[^>]*title="成长记录从第一次探索开始"/)
  // UI-04(2026-09-18):这三个数字位就是要走 || 0 兜底;仍不许把 userInfo 的原值直接兜底
  // (userInfo 真源走 metricNumber,缺字段的兜底只发生在展示字段上)。
  assert.doesNotMatch(wxml, /class="pc-stat-n">\{\{userInfo\.(?:followNum|fansNum)\s*\|\|\s*0\}\}/)
  assert.doesNotMatch(wxml, /class="pc-gs-num">\{\{userInfo\.point\s*\|\|\s*0\}\}/)
  // 点击高度的保证随按钮一起搬到 cy-error 组件里(.cy-error-retry 的 height 就是 --cy-btn-h)。
  assert.doesNotMatch(wxss, /\.pc-metric-retry\s*\{/, '自绘重试按钮的样式应随标签一起删除,别留孤儿')
  const errWxss = fs.readFileSync(path.join(ROOT, 'components/cy/error/index.wxss'), 'utf8')
  assert.match(errWxss, /\.cy-error-retry\s*\{[^}]*height:\s*var\(--cy-btn-h\)/s,
    'cy-error 的重试按钮必须保持 --cy-btn-h 的可点高度')
}

test('界面契约：首访只显示引导与首个动作，ready 分支继续直出真实零，失败分支可重试', () => {
  assertFirstRunMarkup(read(PROFILE_WXML), read(PROFILE_WXSS))
})

test('负控：把首访统计闸改成恒真时，契约必须精准变红', () => {
  const wxml = read(PROFILE_WXML)
  const mutated = wxml.replace(
    'class="pc-stats" wx:if="{{!isSelf || profileMetricState === \'ready\'}}"',
    'class="pc-stats" wx:if="{{true}}"',
  )
  assert.notEqual(mutated, wxml, '负控锚点失效：没有找到首访统计闸')
  assert.throws(() => assertFirstRunMarkup(mutated, read(PROFILE_WXSS)), assert.AssertionError)
})

test('负控：把 ready 分支的真实 0 改成占位符时，契约必须精准变红', () => {
  const wxml = read(PROFILE_WXML)
  const mutated = wxml.replaceAll('{{profilePoint}}', "{{profilePoint || '—'}}")
  assert.notEqual(mutated, wxml, '负控锚点失效：没有找到 ready 分支积分')
  assert.throws(() => assertFirstRunMarkup(mutated, read(PROFILE_WXSS)), assert.AssertionError)
})
