const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('活动运营页支持单次/每周/自定义日期、容量与候补，不暴露未实现 RRULE', () => {
  const js = read('pages/club/event-ops/index.js')
  const wxml = read('pages/club/event-ops/index.wxml')

  assert.match(js, /ONCE/)
  assert.match(js, /WEEKLY/)
  assert.match(js, /CUSTOM_DATES/)
  assert.doesNotMatch(wxml, /RRULE|CUSTOM_RRULE/)
  assert.match(js, /capacity/)
  assert.match(js, /waitlistEnabled/)
  assert.match(js, /offerMinutes/)
  assert.match(js, /defaultLeadMemberId/)
  assert.match(js, /\/api\/club\/event-ops\/series\/create/)
})

test('活动运营选择器统一到 DS 组件且保持原值与 handler 契约', () => {
  const js = read('pages/club/event-ops/index.js')
  const wxml = read('pages/club/event-ops/index.wxml')
  const config = JSON.parse(read('pages/club/event-ops/index.json'))

  assert.doesNotMatch(wxml, /<picker(?=[\s>])/)
  // CU-C-34(用户裁决 B):同名主题在候选里要能区分 ⇒ range-key 换成带起止日期与承接来源的组合文案
  // (文案内容本身由 club-g2a-club-ops-fix-contract 钉住,这里钉的是选择器仍走 DS 组件与原 handler 契约)。
  assert.match(wxml, /<cy-dropdown\b[^>]*range="\{\{topics\}\}"[^>]*range-key="dropdownLabel"[^>]*value="\{\{topicIndex\}\}"[^>]*bind:change="onTopicChange"/)
  assert.match(wxml, /<cy-date-field\b[^>]*mode="date"[^>]*value="\{\{startDate\}\}"[^>]*start="\{\{minDate\}\}"[^>]*bind:change="onStartDateChange"/)
  assert.match(wxml, /<cy-date-field\b[^>]*value="\{\{item\}\}"[^>]*data-index="\{\{index\}\}"[^>]*bind:change="onCustomDateChange"/)
  // 5.9:集合时刻是场次退款钟锚点,开场表单必须有时间选择且随请求提交。
  assert.match(wxml, /<cy-date-field\b[^>]*mode="time"[^>]*value="\{\{startTime\}\}"[^>]*bind:change="onStartTimeChange"/)
  assert.match(js, /onStartTimeChange/)
  assert.match(js, /startDate:\s*this\.data\.startDate,\s*\n\s*startTime,/)
  assert.match(js, /请选择集合时刻/)
  assert.match(wxml, /<cy-dropdown\b[^>]*range="\{\{leadOptions\}\}"[^>]*range-key="nickname"[^>]*value="\{\{leadIndex\}\}"[^>]*bind:change="onLeadChange"/)
  assert.equal(config.usingComponents['cy-dropdown'], '/components/cy/dropdown/index')
  assert.equal(config.usingComponents['cy-date-field'], '/components/cy/date-field/index')
  assert.doesNotMatch(wxml, /name="expand"/)
  assert.equal((wxml.match(/class="field-chevron" name="back"/g) || []).length, 5)
  assert.match(read('pages/club/event-ops/index.wxss'), /\.field-chevron\s*\{[^}]*transform:\s*rotate\(-90deg\)/s)
})

test('活动运营条件链不能把 wx:else 或 wx:elif 与 wx:for 放在同一节点', () => {
  const wxml = read('pages/club/event-ops/index.wxml')
  const tags = wxml.match(/<[^>]+>/g) || []
  const invalid = tags.filter(tag => /\bwx:(?:else|elif)\b/.test(tag) && /\bwx:for\b/.test(tag))

  assert.deepEqual(invalid, [], '微信编译器会因条件分支与列表渲染共用节点而拒绝整个分包')
})

test('活动名册只有真实四段与更正接口，并覆盖加载、空、错误和处理中状态', () => {
  const js = read('pages/club/event-ops/index.js')
  const wxml = read('pages/club/event-ops/index.wxml')

  for (const state of ['registered', 'waitlist', 'arrived', 'noShow']) assert.match(js, new RegExp(state))
  assert.match(js, /rosterState: 'loading'/)
  assert.match(js, /rosterState: 'error'/)
  assert.match(wxml, /activeRoster\.length === 0/)
  assert.match(js, /actingMemberId/)
  assert.match(js, /\/api\/club\/event-ops\/attendance\/correct/)
  assert.match(js, /data\.phoneIncluded !== false/)
})

test('活动运营页权限未知或无权时 fail-closed', () => {
  const js = read('pages/club/event-ops/index.js')

  assert.match(js, /url: '\/api\/club\/access\/me'/)
  assert.match(js, /permissions\.indexOf\('club:activity:manage'\)/)
  assert.match(js, /permissions\.indexOf\('club:event:checkin'\)/)
  assert.match(js, /当前角色没有活动运营或本场核销权限/)
  assert.match(js, /state: 'error'/)
})

test('活动运营页从后端读取系列与版本，并提供未来场次批量编辑入口', () => {
  const js = read('pages/club/event-ops/index.js')
  const wxml = read('pages/club/event-ops/index.wxml')

  assert.match(js, /\/api\/club\/event-ops\/series\/list/)
  assert.match(js, /\/api\/club\/event-ops\/series\/detail/)
  assert.match(js, /\/api\/club\/event-ops\/series\/update-future/)
  assert.match(js, /expectedVersion/)
  assert.match(wxml, /编辑未来场次/)
  assert.match(wxml, /退出编辑/)
  assert.doesNotMatch(wxml, /cy-club-card|club-card/)
})

test('系列更新遇到 409 会重新读取列表与详情，绝不沿用旧 version', () => {
  let config
  const requests = []
  const appMock = {
    globalData: {},
    sendRequest(options) {
      requests.push(options)
      if (options.url.endsWith('/series/update-future')) {
        options.success({ code: 409, msg: '系列状态已变化' })
      } else if (options.url.endsWith('/series/list')) {
        options.success({ code: 200, data: [] })
      } else if (options.url.endsWith('/series/detail')) {
        options.success({
          code: 200,
          data: {
            id: 61, clubId: 21, topicId: 31, recurrenceType: 'CUSTOM_DATES',
            defaultLeadMemberId: 51, defaultCapacity: null,
            waitlistEnabled: true, offerMinutes: 30, version: 4,
            futureDates: ['2026-09-01'],
          },
        })
      }
      if (options.complete) options.complete()
    },
  }
  global.getApp = () => appMock
  global.Page = value => { config = value }
  global.wx = {
    showToast() {}, stopPullDownRefresh() {}, navigateBack() {},
  }
  const modulePath = path.join(root, 'pages/club/event-ops/index.js')
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const vm = Object.assign({}, config, {
    data: Object.assign({}, config.data, {
      clubId: 21,
      canManage: true,
      submitting: false,
      topics: [{ id: 31, name: '周末路线' }],
      topicIndex: 0,
      editingSeriesId: 61,
      editingTopicId: 31,
      recurrenceType: 'CUSTOM_DATES',
      customDates: ['2026-09-01'],
      defaultLeadMemberId: 51,
      capacity: '',
      waitlistEnabled: true,
      offerMinutes: 30,
    }),
    setData(patch) { Object.assign(this.data, patch) },
  })

  vm._expectedVersion = 3
  vm.submitSeries()

  assert.equal(requests[0].url, '/api/club/event-ops/series/update-future')
  const update = JSON.parse(requests[0].data)
  assert.equal(update.seriesId, 61)
  assert.equal(update.expectedVersion, 3)
  assert.deepEqual(requests.slice(1).map(item => item.url), [
    '/api/club/event-ops/series/list',
    '/api/club/event-ops/series/detail',
  ])
  assert.equal(vm._expectedVersion, 4)
  assert.equal(Object.hasOwn(vm.data, 'expectedVersion'), false)
})

test('编辑态缺少后端 expectedVersion 时 fail-closed，不得把 null 猜成 0', () => {
  let config
  const requests = []
  global.getApp = () => ({ globalData: {}, sendRequest(options) { requests.push(options) } })
  global.Page = value => { config = value }
  global.wx = { showToast() {}, stopPullDownRefresh() {}, navigateBack() {} }
  const modulePath = path.join(root, 'pages/club/event-ops/index.js')
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const vm = Object.assign({}, config, {
    data: Object.assign({}, config.data, {
      clubId: 21, canManage: true, topics: [{ id: 31 }], topicIndex: 0,
      editingSeriesId: 61, editingTopicId: 31,
      recurrenceType: 'CUSTOM_DATES', customDates: ['2026-09-01'],
      defaultLeadMemberId: 51, waitlistEnabled: true, offerMinutes: 30,
    }),
    setData(patch) { Object.assign(this.data, patch) },
  })

  vm.submitSeries()

  assert.equal(requests.length, 0)
})

test('通知页先预览再发送，明确站内回执、部分失败与失败项重试', () => {
  const js = read('pages/club/notify/index.js')
  const wxml = read('pages/club/notify/index.wxml')

  assert.match(js, /\/api\/club\/event-notification\/preview/)
  assert.match(js, /\/api\/club\/event-notification\/send/)
  assert.match(js, /\/api\/club\/event-notification\/retry/)
  assert.match(js, /previewState: 'loading'/)
  assert.match(js, /count === 0 \? 'empty' : 'ready'/)
  assert.match(js, /previewState: 'error'/)
  assert.match(js, /sending: true/)
  // 2026-09-09 按稿 R4 290:526 删掉顶部那两张渠道卡(站内可用 / 微信订阅暂不可用)。
  // 「只发得出站内」这件事没变,由发送按钮的文案与投递状态卡承载。
  assert.match(wxml, /发送站内通知/)
  assert.doesNotMatch(wxml, /微信订阅/, '渠道卡已按稿删除,不许悄悄回来')
  // 「送达以站内回执为准」原本写在那张渠道卡上,卡随稿删了,判据落到它真正的承载处:
  // 投递状态三个数各自独立(总人数 / 已送达 / 失败),不是把「任务已创建」当成已送达。
  assert.match(wxml, /已送达站内[\s\S]{0,120}campaign\.successCount/)
  assert.match(wxml, /失败[\s\S]{0,200}campaign\.failedCount/)
  assert.match(wxml, /只重试失败项/)
  assert.match(js, /data\.phoneIncluded !== false/)
  assert.match(js, /permissions\.indexOf\('club:notify:send'\)/)
  assert.match(js, /permissions\.indexOf\('club:event:operate'\)/)
  assert.match(js, /item\.eventOnly[\s\S]*?\? !canOperateEvent[\s\S]*?: !canNotifyAllMembers/)
  assert.match(js, /activityId && canOperateEvent \? 'REGISTERED' : 'ALL_MEMBERS'/)
})

test('F-35：通知任务仍为 PROCESSING 时只能提示已提交，不得冒充已送达', () => {
  let config
  const requests = []
  const toasts = []
  global.getApp = () => ({
    globalData: {},
    sendRequest(options) { requests.push(options) },
  })
  global.Page = value => { config = value }
  global.getCurrentPages = () => []
  global.wx = {
    showToast(options) { toasts.push(options) },
  }
  const modulePath = path.join(root, 'pages/club/notify/index.js')
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, config, {
    data: Object.assign({}, config.data, {
      clubId: 21,
      previewState: 'ready',
      title: '集合提醒',
      content: '请按时到场',
    }),
    setData(patch) { Object.assign(this.data, patch) },
  })

  page.send()
  assert.equal(requests[0].url, '/api/club/event-notification/send')
  requests[0].success({
    code: 200,
    data: { id: 13, status: 'PROCESSING', totalCount: 1, successCount: 0, failedCount: 0 },
  })
  requests[0].complete()

  assert.equal(page.data.campaign.status, 'PROCESSING')
  assert.equal(toasts.at(-1).title, '通知已提交，正在投递')
  assert.notEqual(toasts.at(-1).title, '站内通知已发送')
})

test('通知页 club-wide 与 activity-scoped 权限必须分别对齐 NOTIFY_SEND 和 EVENT_OPERATE', () => {
  let config
  let request
  global.getApp = () => ({
    globalData: {},
    sendRequest(options) { request = options },
  })
  global.Page = value => { config = value }
  global.wx = { stopPullDownRefresh() {} }
  const modulePath = path.join(root, 'pages/club/notify/index.js')
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)

  const page = () => Object.assign({}, config, {
    data: Object.assign({}, config.data),
    setData(patch) { Object.assign(this.data, patch) },
  })

  const clubWide = page()
  clubWide.onLoad({ clubId: '21' })
  request.success({
    code: 200,
    data: { active: true, club: { id: 21 }, permissions: ['club:notify:send'] },
  })
  assert.equal(clubWide.data.state, 'ready')
  assert.equal(clubWide.data.audienceType, 'ALL_MEMBERS')
  assert.equal(clubWide.data.audiences.find(item => item.value === 'ALL_MEMBERS').disabled, false)
  assert.equal(clubWide.data.audiences.find(item => item.value === 'REGISTERED').disabled, true)

  const eventScoped = page()
  eventScoped.onLoad({ clubId: '21', activityId: '31' })
  request.success({
    code: 200,
    data: { active: true, club: { id: 21 }, permissions: ['club:event:operate'] },
  })
  assert.equal(eventScoped.data.state, 'ready')
  assert.equal(eventScoped.data.audienceType, 'REGISTERED')
  assert.equal(eventScoped.data.audiences.find(item => item.value === 'ALL_MEMBERS').disabled, true)
  assert.equal(eventScoped.data.audiences.find(item => item.value === 'REGISTERED').disabled, false)
})

test('自定义日期每次只新增一个场次日期', () => {
  let config
  global.getApp = () => ({ globalData: {} })
  global.Page = value => { config = value }
  const modulePath = path.join(root, 'pages/club/event-ops/index.js')
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const vm = Object.assign({}, config, {
    data: Object.assign({}, config.data, { customDates: ['2026-08-23'], startDate: '2026-08-30' }),
    setData(patch) { Object.assign(this.data, patch) },
  })

  vm.addCustomDate()

  assert.deepEqual(vm.data.customDates, ['2026-08-23', '2026-08-30'])
})

test('活动名册用 cy-tabs 的 detail.key 切换真实数据段', () => {
  let config
  global.getApp = () => ({ globalData: {} })
  global.Page = value => { config = value }
  const modulePath = path.join(root, 'pages/club/event-ops/index.js')
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const vm = Object.assign({}, config, {
    data: Object.assign({}, config.data, {
      rosterTab: 'registered',
      registered: [{ memberId: 1 }],
      arrived: [{ memberId: 2 }],
      activeRoster: [{ memberId: 1 }],
    }),
    setData(patch) { Object.assign(this.data, patch) },
  })

  vm.chooseRosterTab({ detail: { key: 'arrived' } })

  assert.equal(vm.data.rosterTab, 'arrived')
  assert.deepEqual(vm.data.activeRoster, [{ memberId: 2 }])
  vm.chooseRosterTab({ detail: { key: 'unknown' } })
  assert.equal(vm.data.rosterTab, 'arrived', '未知 key 不得清空当前名册')
  assert.match(read('pages/club/event-ops/index.wxml'),
    /<cy-tabs[^>]*tabs="\{\{rosterTabs\}\}"[^>]*active="\{\{rosterTab\}\}"[^>]*bind:change="chooseRosterTab"/)
})

test('签到更正丢响应后跨页面复用同一意图，5xx保留、4xx清理、成功后回读名册', () => {
  const storage = {}
  function mount() {
    let config
    const requests = []
    global.getApp = () => ({ globalData: {}, getUserID: () => '9', sendRequest(options) { requests.push(options) } })
    global.Page = value => { config = value }
    global.wx = {
      showToast() {}, stopPullDownRefresh() {}, navigateBack() {},
      getStorageSync(key) { return storage[key] },
      setStorageSync(key, value) { storage[key] = value },
      removeStorageSync(key) { delete storage[key] },
    }
    const modulePath = path.join(root, 'pages/club/event-ops/index.js')
    delete require.cache[require.resolve(modulePath)]
    require(modulePath)
    const page = Object.assign({}, config, {
      data: Object.assign({}, config.data, {
        clubId: 21, activityId: 31, canCheckin: true, actingMemberId: null,
      }),
      setData(patch) { Object.assign(this.data, patch) },
    })
    return { page, requests }
  }

  const first = mount()
  first.page.submitCorrection(52, true, 0, '现场漏扫，核对后补记')
  const firstWrite = first.requests[0]
  const firstRequestId = JSON.parse(firstWrite.data).requestId
  firstWrite.fail()
  firstWrite.complete()

  const reopened = mount()
  reopened.page.submitCorrection(52, true, 0, '现场漏扫，核对后补记')
  const replay = reopened.requests[0]
  assert.equal(JSON.parse(replay.data).requestId, firstRequestId)
  replay.success({ code: 200, data: { id: 71, activityId: 31, memberId: 52, version: 1 } })
  replay.complete()
  assert.equal(reopened.requests[1].url, '/api/club/event-ops/roster')
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(firstRequestId))

  const uncertain = mount()
  uncertain.page.submitCorrection(53, false, 2, '纠正误签到')
  const uncertainId = JSON.parse(uncertain.requests[0].data).requestId
  uncertain.requests[0].successStatusAbnormal({ code: 503, msg: '暂不可用' }, 503)
  uncertain.requests[0].complete()
  uncertain.page.submitCorrection(53, false, 2, '纠正误签到')
  assert.equal(JSON.parse(uncertain.requests[1].data).requestId, uncertainId)
  uncertain.requests[1].successStatusAbnormal({ code: 409, msg: 'requestId 冲突' }, 409)
  uncertain.requests[1].complete()
  uncertain.page.submitCorrection(53, false, 2, '纠正误签到')
  assert.notEqual(JSON.parse(uncertain.requests[2].data).requestId, uncertainId)
})

// 候补认领窗口的上限在三个地方各写了一份:小程序前置校验、后端 service、
// club_event_series 的 CHECK 约束。任何一处没跟上,主理人填的值会在更靠后的那一层被拒,
// 而错误信息一层比一层难懂(最坏是数据库约束报错)。这条把三者钉在一起。
test('★候补认领窗口:前端上限必须与后端和库里的 CHECK 约束同一个数', () => {
  const js = read('pages/club/event-ops/index.js')
  const wxml = read('pages/club/event-ops/index.wxml')
  const service = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/ClubEventOpsServiceImpl.java')
  const waitlist = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/ClubWaitlistServiceImpl.java')
  const migration = read('../chengyinhub-admin/sql/migration_club_waitlist_offer_window_20260911.sql')

  assert.equal((js.match(/offerMinutes > 1440/g) || []).length, 2,
    '两处前置校验(行校验与提交校验)都要是 1440')
  assert.match(js, /offerMinutes: 1440/, '新建系列的默认值就是一天')
  assert.match(wxml, /placeholder="5 分钟 – 1 天"/)
  assert.match(service, /offerMinutes < 5 \|\| offerMinutes > 1440/)
  assert.match(waitlist, /minutes < 5 \|\| minutes > 1440/)
  assert.match(waitlist, /configuredMinutes == null \? 1440 : configuredMinutes/)
  assert.match(migration, /offer_minutes BETWEEN 5 AND 1440/)
})


test('通知人数与权限和预览使用同一场次，未指定场次不伪造零人数', () => {
  let config
  const requests = []
  global.getApp = () => ({ globalData: {}, sendRequest(options) { requests.push(options) } })
  global.Page = value => { config = value }
  global.wx = { stopPullDownRefresh() {} }
  const modulePath = path.join(root, 'pages/club/notify/index.js')
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = () => Object.assign({}, config, {
    data: Object.assign({}, config.data),
    setData(patch) { Object.assign(this.data, patch) },
  })
  const scoped = page()
  scoped.onLoad({ clubId: '21', activityId: '31' })
  assert.equal(requests.length, 1, '人数必须等待权限确认')
  assert.equal(JSON.parse(requests[0].data).activityId, 31)
  requests[0].success({ code: 200, data: { active: true, club: { id: 21 }, permissions: ['club:event:operate'] } })
  const counts = requests.at(-1)
  assert.equal(counts.url, '/api/club/event-notification/audience-counts')
  assert.deepEqual(JSON.parse(counts.data), { clubId: 21, activityId: 31 })
  counts.success({ code: 200, data: { counts: { REGISTERED: 1, WAITLIST: 0, NO_SHOW: 1 } } })
  assert.equal(scoped.data.audiences.find(x => x.value === 'REGISTERED').countText, '1 人')
  assert.equal(scoped.data.audiences.find(x => x.value === 'WAITLIST').countText, '0 人')
  assert.equal(scoped.data.audiences.find(x => x.value === 'REGISTERED').hint, '')
  scoped.onTitleInput({ detail: { value: '集合提醒' } })
  scoped.onContentInput({ detail: { value: '请按原时间集合' } })
  scoped.preview()
  assert.equal(JSON.parse(requests.at(-1).data).activityId, 31)
  const wide = page()
  wide.onLoad({ clubId: '21' })
  requests.at(-1).success({ code: 200, data: { active: true, club: { id: 21 }, permissions: ['club:notify:send'] } })
  assert.equal(JSON.parse(requests.at(-1).data).activityId, null)
  requests.at(-1).success({ code: 200, data: { counts: { ALL_MEMBERS: 2, REGISTERED: null } } })
  assert.equal(wide.data.audiences.find(x => x.value === 'REGISTERED').countText, '')
  assert.equal(wide.data.audiences.find(x => x.value === 'REGISTERED').disabled, true)
  assert.equal(wide.data.audiences.find(x => x.value === 'REGISTERED').hint, '从具体活动进入后才可选')
  const restricted = page()
  restricted.onLoad({ clubId: '21', activityId: '31' })
  requests.at(-1).success({ code: 200, data: { active: true, club: { id: 21 }, permissions: ['club:notify:send'] } })
  assert.equal(restricted.data.audiences.find(x => x.value === 'REGISTERED').disabled, true)
  assert.equal(restricted.data.audiences.find(x => x.value === 'REGISTERED').hint, '当前角色没有本场通知权限')
  assert.ok(requests.every(x => !/\/(send|retry)$/.test(x.url)), '此链仅预览不发送')
})
