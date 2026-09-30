#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { openMiniProgram } = require('./harness')
const {
  assertProjectLease,
  leasePathForPort,
  readProjectLease,
} = require('../../scripts/lib/devtools-project-lease')

const PROJECT_PATH = path.resolve(__dirname, '../..')
const EXPECTED_ENDPOINT = 'ws://127.0.0.1:9787'
const EXPECTED_PORT = 9787
const MANIFEST_NAME = 'p2-motion-wip-manifest.json'
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function parseBorrowEndpoint(value) {
  if (!value) throw new Error(`缺少 WS_ENDPOINT；本驱动只允许借用 ${EXPECTED_ENDPOINT}`)
  if (String(value) !== EXPECTED_ENDPOINT) {
    throw new Error(`WS_ENDPOINT 必须精确等于 ${EXPECTED_ENDPOINT}（host 固定 127.0.0.1，port 固定 9787）`)
  }
  return { endpoint: EXPECTED_ENDPOINT, port: EXPECTED_PORT }
}

function assertBorrowContract(options) {
  const input = options || {}
  const parsed = parseBorrowEndpoint(input.wsEndpoint)
  const expected = {
    projectPath: path.resolve(String(input.projectPath || '')),
    sourceSha: String(input.head || '').toLowerCase(),
    port: parsed.port,
  }
  if (!input.lease) throw new Error(`缺少 DevTools project 租约: ${leasePathForPort(parsed.port)}`)
  return assertProjectLease(expected, input.lease)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function assertPngArtifact(file) {
  if (!fs.existsSync(file)) throw new Error(`截图文件不存在: ${file}`)
  const bytes = fs.readFileSync(file)
  if (bytes.length < 1024) throw new Error(`截图文件过小: ${file} (${bytes.length} bytes)`)
  const signature = Buffer.from('89504e470d0a1a0a', 'hex')
  if (!bytes.subarray(0, 8).equals(signature) || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`截图不是合法 PNG/IHDR: ${file}`)
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width < 100 || height < 100) {
    throw new Error(`截图像素尺寸异常: ${file} (${width}x${height})`)
  }
  return { path: file, bytes: bytes.length, width, height, sha256: sha256(bytes) }
}

function gitOutput(args, encoding) {
  return execFileSync('git', args, {
    cwd: PROJECT_PATH,
    encoding: encoding === undefined ? 'utf8' : encoding,
    maxBuffer: 128 * 1024 * 1024,
  })
}

function readSourceProvenance() {
  const head = gitOutput(['rev-parse', 'HEAD']).trim()
  const branch = gitOutput(['branch', '--show-current']).trim()
  const status = gitOutput(['status', '--porcelain=v1', '-z'], null)
  const trackedDiff = gitOutput(['diff', '--binary', '--no-ext-diff', 'HEAD', '--', '.'], null)
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], null)
    .toString('utf8').split('\0').filter(Boolean).sort()
  const digest = crypto.createHash('sha256')
  digest.update('status\0').update(status)
  digest.update('\0tracked-diff\0').update(trackedDiff)
  for (const relative of untracked) {
    const absolute = path.join(PROJECT_PATH, relative)
    digest.update('\0untracked-path\0').update(relative).update('\0untracked-bytes\0')
    if (fs.statSync(absolute).isFile()) digest.update(fs.readFileSync(absolute))
  }
  return {
    projectPath: PROJECT_PATH,
    head,
    branch,
    dirty: status.length > 0,
    diffDigest: `sha256:${digest.digest('hex')}`,
    diffDigestAlgorithm: 'sha256(git-status-z + git-diff-binary-HEAD + sorted-untracked-path-and-bytes)',
    changedEntryCount: status.toString('utf8').split('\0').filter(Boolean).length,
  }
}

function addAssertion(manifest, id, pass, observed) {
  const entry = { id, pass: Boolean(pass), observed }
  manifest.assertions.push(entry)
  if (!entry.pass) throw new Error(`${id} 断言失败: ${JSON.stringify(observed)}`)
  return observed
}

function writeManifest(outputDir, manifest) {
  fs.mkdirSync(outputDir, { recursive: true })
  const target = path.join(outputDir, MANIFEST_NAME)
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.renameSync(temporary, target)
  return target
}

async function capture(mp, outputDir, manifest, id, fileName) {
  const file = path.join(outputDir, fileName)
  await mp.screenshot({ path: file })
  const artifact = assertPngArtifact(file)
  manifest.screenshots.push(Object.assign({ id, visualReview: 'PENDING_MANUAL_VIEW_IMAGE' }, artifact))
  return artifact
}

async function waitUntil(read, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await wait(25)
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内未兑现，最后状态=${JSON.stringify(last)}`)
}

function routeOf(page) {
  return `/${String(page && page.path || '').replace(/^\//, '')}`
}

async function reLaunchVerified(mp, route, expectedRoute) {
  let page
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await mp.reLaunch(route)
    await wait(700)
    // reLaunch 的返回对象可能仍是上一页的缓存 handle；路由证据只认 DevTools
    // 重新读取的 currentPage。一次重试仍不兑现就交给调用方判红。
    page = await mp.currentPage()
    if (routeOf(page) === expectedRoute) return page
  }
  return page
}

async function runAiFlow(mp, outputDir, manifest) {
  const page = await reLaunchVerified(mp, '/pages/publish/simple/index', '/pages/publish/simple/index')
  await page.waitFor(200)
  addAssertion(manifest, 'ai.route', routeOf(page) === '/pages/publish/simple/index', routeOf(page))
  await page.setData({
    aiGenerating: true,
    aiError: '',
    aiPlan: null,
    aiQuotaLoaded: true,
    aiRemaining: 3,
    reducedMotion: false,
  })
  await page.waitFor(120)

  let progress = await page.$('cy-progress-status')
  addAssertion(manifest, 'ai.single-request.host', Boolean(progress), { found: Boolean(progress) })
  const motionRoot = await progress.$('.ps')
  const motionClass = motionRoot && await motionRoot.attribute('class')
  const runnerCount = (await progress.$$('.ps__runner')).length
  const stepCount = (await progress.$$('.ps__step')).length
  const motionData = await page.data()
  addAssertion(manifest, 'ai.single-request.state', motionData.aiGenerating === true
    && runnerCount === 1 && stepCount === 0, {
    aiGenerating: motionData.aiGenerating,
    runnerCount,
    stepCount,
  })
  addAssertion(manifest, 'ai.motion.enabled', !String(motionClass || '').includes('ps--reduced-motion'), motionClass)
  await capture(mp, outputDir, manifest, 'ai.motion', '01-ai-motion.png')

  await page.setData({ reducedMotion: true })
  await page.waitFor(100)
  progress = await page.$('cy-progress-status')
  const reducedRoot = progress && await progress.$('.ps')
  const reducedClass = reducedRoot && await reducedRoot.attribute('class')
  const reducedData = await page.data()
  addAssertion(manifest, 'ai.reduced-motion.static-fallback', reducedData.reducedMotion === true
    && String(reducedClass || '').includes('ps--reduced-motion'), {
    reducedMotion: reducedData.reducedMotion,
    className: reducedClass,
  })
  await capture(mp, outputDir, manifest, 'ai.reduced-motion', '02-ai-reduced-motion.png')
  manifest.flows.ai = {
    route: routeOf(page),
    injectedState: 'aiGenerating=true, no fabricated steps/percent',
    motionClass,
    reducedClass,
  }
}

async function installLedgerFixture(mp) {
  return mp.evaluate(function (memberId) {
    var app = getApp()
    if (!app || !app.globalData) throw new Error('App 尚未 ready')
    if (app.__p2MotionLedger) throw new Error('ledger fixture 已存在，拒绝覆盖')
    var keys = ['authorization', 'open_id', 'user_id', 'role', 'user_type']
    var storedKeys = (wx.getStorageInfoSync && wx.getStorageInfoSync().keys) || []
    var previousStorage = {}
    keys.forEach(function (key) {
      previousStorage[key] = { had: storedKeys.indexOf(key) >= 0, value: wx.getStorageSync(key) }
    })
    var globalKeys = ['authorization', 'open_id', 'user_id', 'role', 'user_type']
    var previousGlobal = {}
    globalKeys.forEach(function (key) {
      previousGlobal[key] = {
        had: Object.prototype.hasOwnProperty.call(app.globalData, key),
        value: app.globalData[key],
      }
    })
    var state = {
      originalSendRequest: app.sendRequest,
      previousStorage: previousStorage,
      previousGlobal: previousGlobal,
      trace: [],
      timers: [],
      unexpected: [],
    }
    app.__p2MotionLedger = state
    wx.setStorageSync('authorization', 'p2-motion-token')
    wx.setStorageSync('open_id', 'p2-motion-openid')
    wx.setStorageSync('user_id', memberId)
    wx.setStorageSync('role', 'merchant')
    wx.setStorageSync('user_type', 2)
    app.globalData.authorization = 'p2-motion-token'
    app.globalData.open_id = 'p2-motion-openid'
    app.globalData.user_id = memberId
    app.globalData.role = 'merchant'
    app.globalData.user_type = 2

    app.sendRequest = function (options) {
      var request = options || {}
      var url = String(request.url || '')
      var payload = request.data || {}
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload) } catch (error) { payload = {} }
      }
      var entry = { url: url, filter: payload.filter || '', at: Date.now() }
      state.trace.push(entry)
      var response
      var delay
      if (url === '/api/user/info') {
        delay = 25
        response = {
          code: 200,
          data: {
            role: 'merchant', userType: 2,
            merchant: { status: 1, accountStatus: 1, delFlag: 0 },
          },
        }
      } else if (url === '/api/merchant/finance/redemptions') {
        delay = payload.filter === 'pending' ? 520 : 25
        response = {
          code: 200,
          data: {
            rows: payload.filter === 'pending' ? [{
              recordKey: 'redemption:p2-pending',
              recordType: 'redemption',
              recordId: 20260823,
              topicName: '外滩夜行',
              chapterName: '第 2 章',
              settlementAmount: 18,
              settlementRoute: 'CHAPTER_OFFER',
              displayState: 'PENDING_SETTLEMENT',
              customerDisplayName: '周**',
              occurredAt: '2026-08-12 20:15:00',
            }] : [],
            total: payload.filter === 'pending' ? 1 : 0,
            summary: payload.filter === 'pending'
              ? { count: 1, pendingAmount: 18, arrivedAmount: 0 }
              : { count: 0, pendingAmount: 0, arrivedAmount: 0 },
          },
        }
      } else {
        state.unexpected.push(url)
        delay = 0
      }
      var timer = setTimeout(function () {
        if (response && typeof request.success === 'function') request.success(response)
        else if (!response && typeof request.fail === 'function') request.fail({ errMsg: 'p2-motion unhandled request: ' + url })
      }, delay)
      state.timers.push(timer)
      return { abort: function () { clearTimeout(timer); entry.aborted = true } }
    }
    return {
      role: wx.getStorageSync('role'),
      userType: wx.getStorageSync('user_type'),
      userId: String(wx.getStorageSync('user_id')),
    }
  }, '902823')
}

async function readLedgerTrace(mp) {
  return mp.evaluate(function () {
    var app = getApp()
    var state = app && app.__p2MotionLedger
    return state ? {
      trace: state.trace.slice(),
      unexpected: state.unexpected.slice(),
    } : null
  })
}

async function restoreLedgerFixture(mp) {
  return mp.evaluate(function () {
    var app = getApp()
    var state = app && app.__p2MotionLedger
    if (!state) return false
    state.timers.forEach(function (timer) { clearTimeout(timer) })
    app.sendRequest = state.originalSendRequest
    Object.keys(state.previousStorage).forEach(function (key) {
      var previous = state.previousStorage[key]
      if (previous.had) wx.setStorageSync(key, previous.value)
      else wx.removeStorageSync(key)
    })
    Object.keys(state.previousGlobal).forEach(function (key) {
      var previous = state.previousGlobal[key]
      if (previous.had) app.globalData[key] = previous.value
      else delete app.globalData[key]
    })
    delete app.__p2MotionLedger
    return app.sendRequest === state.originalSendRequest
  })
}

async function runLedgerFlow(mp, outputDir, manifest) {
  const identity = await installLedgerFixture(mp)
  addAssertion(manifest, 'ledger.merchant-identity', identity.role === 'merchant'
    && Number(identity.userType) === 2 && identity.userId === '902823', identity)
  try {
    const page = await reLaunchVerified(mp, '/pages/merchant/ledger/index?view=redemptions', '/pages/merchant/ledger/index')
    await page.waitFor(200)
    addAssertion(manifest, 'ledger.route', routeOf(page) === '/pages/merchant/ledger/index', routeOf(page))
    const fixture = JSON.parse(fs.readFileSync(path.join(PROJECT_PATH, 'scripts/fixtures.json'), 'utf8')).C07
    addAssertion(manifest, 'ledger.c07-fixture', Boolean(fixture && fixture.data), { fixture: 'C07' })
    await page.setData(fixture.data)
    await page.waitFor(120)

    let tabs = await page.$('.ledger-filter')
    addAssertion(manifest, 'ledger.filter-host', Boolean(tabs), { found: Boolean(tabs) })
    let slab = await tabs.$('.cy-tabs__slab')
    const beforeStyle = slab && await slab.attribute('style')
    const beforeData = await page.data()
    addAssertion(manifest, 'ledger.before.all', beforeData.redemptionFilter === 'all'
      && beforeData.hasLoaded === true && beforeData.redemptionGroups.length === 1,
    { filter: beforeData.redemptionFilter, hasLoaded: beforeData.hasLoaded, groups: beforeData.redemptionGroups.length })
    addAssertion(manifest, 'ledger.slab.before', /translateX\(0%\)/.test(String(beforeStyle)), beforeStyle)
    await capture(mp, outputDir, manifest, 'ledger.before', '03-ledger-before.png')

    const items = await tabs.$$('.cy-tabs__item')
    addAssertion(manifest, 'ledger.real-tap.target', items.length === 4, { itemCount: items.length, tappedIndex: 1 })
    await items[1].tap()
    await page.waitFor(85)
    const midData = await page.data()
    tabs = await page.$('.ledger-filter')
    slab = tabs && await tabs.$('.cy-tabs__slab')
    const midStyle = slab && await slab.attribute('style')
    addAssertion(manifest, 'ledger.real-tap.pending-state', midData.redemptionFilter === 'pending'
      && midData.loading === true && midData.hasLoaded === false
      && midData.redemptionGroups.length === 0 && midData.summary === null, {
      filter: midData.redemptionFilter,
      loading: midData.loading,
      hasLoaded: midData.hasLoaded,
      groups: midData.redemptionGroups.length,
      summary: midData.summary,
    })
    addAssertion(manifest, 'ledger.slab.transform', /translateX\(100%\)/.test(String(midStyle)), {
      before: beforeStyle,
      mid: midStyle,
    })
    await capture(mp, outputDir, manifest, 'ledger.mid', '04-ledger-mid.png')

    const settledData = await waitUntil(
      () => page.data(),
      (data) => data && data.redemptionFilter === 'pending' && data.loading === false && data.hasLoaded === true,
      2500,
      'pending 筛选终态',
    )
    addAssertion(manifest, 'ledger.pending.settled', settledData.redemptionGroups.length === 1
      && settledData.summary && settledData.summary.pendingDisplay === '¥18.00', {
      filter: settledData.redemptionFilter,
      loading: settledData.loading,
      hasLoaded: settledData.hasLoaded,
      groups: settledData.redemptionGroups.length,
      summary: settledData.summary,
    })
    await capture(mp, outputDir, manifest, 'ledger.settled', '05-ledger-settled.png')
    const trace = await readLedgerTrace(mp)
    const pendingRequests = trace.trace.filter((entry) => entry.url === '/api/merchant/finance/redemptions'
      && entry.filter === 'pending')
    addAssertion(manifest, 'ledger.mock-contract', pendingRequests.length === 1 && trace.unexpected.length === 0, {
      pendingRequestCount: pendingRequests.length,
      unexpected: trace.unexpected,
      trace: trace.trace,
    })
    manifest.flows.ledger = {
      route: routeOf(page),
      fixture: 'C07',
      realTap: { selector: '.cy-tabs__item', index: 1 },
      slab: { before: beforeStyle, mid: midStyle },
      finalFilter: settledData.redemptionFilter,
    }
  } finally {
    const restored = await restoreLedgerFixture(mp)
    addAssertion(manifest, 'ledger.fixture-restored', restored === true, { restored })
  }
}

async function installFollowHarness(mp) {
  return mp.evaluate(function (viewerId) {
    var app = getApp()
    if (!app || !app.globalData) throw new Error('App 尚未 ready')
    if (app.__p2MotionFollow) throw new Error('follow fixture 已存在，拒绝覆盖')
    var keys = ['authorization', 'open_id', 'user_id', 'role', 'user_type']
    var storedKeys = (wx.getStorageInfoSync && wx.getStorageInfoSync().keys) || []
    var previousStorage = {}
    keys.forEach(function (key) {
      previousStorage[key] = { had: storedKeys.indexOf(key) >= 0, value: wx.getStorageSync(key) }
    })
    var previousGlobal = {}
    keys.forEach(function (key) {
      previousGlobal[key] = {
        had: Object.prototype.hasOwnProperty.call(app.globalData, key),
        value: app.globalData[key],
      }
    })
    var state = {
      originalSendRequest: app.sendRequest,
      previousStorage: previousStorage,
      previousGlobal: previousGlobal,
      requestCount: 0,
      timers: [],
      trace: [],
      unexpected: [],
    }
    app.__p2MotionFollow = state
    wx.setStorageSync('authorization', 'p2-motion-player-token')
    wx.setStorageSync('open_id', 'p2-motion-player-openid')
    wx.setStorageSync('user_id', viewerId)
    wx.setStorageSync('role', 'user')
    wx.setStorageSync('user_type', 1)
    app.globalData.authorization = 'p2-motion-player-token'
    app.globalData.open_id = 'p2-motion-player-openid'
    app.globalData.user_id = viewerId
    app.globalData.role = 'user'
    app.globalData.user_type = 1

    app.sendRequest = function (options) {
      var request = options || {}
      var url = String(request.url || '')
      var entry = { url: url, at: Date.now() }
      state.trace.push(entry)
      var response
      var delay = 20
      if (url === '/api/common/banner') {
        response = { code: '200', data: [] }
      } else if (url === '/api/merchant/public-home') {
        response = { code: '500', msg: '商家不存在或未开放' }
      } else if (url === '/api/user/public-info') {
        response = {
          code: '200',
          data: {
            id: 88,
            nickname: '城市漫游者',
            avatar: '',
            role: 'user',
            userType: 1,
            isFollow: 0,
            friendNum: 8,
            followNum: 12,
            fansNum: 34,
            city: '上海',
          },
        }
      } else if (url === '/api/creativesquare/list') {
        response = { code: '200', data: { rows: [], total: 0 } }
      } else if (url === '/api/user/follow/action') {
        state.requestCount += 1
        delay = 1500
        response = { code: '200' }
      } else {
        state.unexpected.push(url)
        entry.unexpected = true
      }
      var timer = setTimeout(function () {
        if (response && typeof request.success === 'function') request.success(response)
        else if (!response && typeof request.fail === 'function') {
          request.fail({ errMsg: 'p2-motion unhandled request: ' + url })
        }
      }, delay)
      state.timers.push(timer)
      return { abort: function () { clearTimeout(timer); entry.aborted = true } }
    }
    return {
      role: wx.getStorageSync('role'),
      userType: wx.getStorageSync('user_type'),
      userId: String(wx.getStorageSync('user_id')),
    }
  }, '99')
}

async function readFollowHarness(mp) {
  return mp.evaluate(function () {
    var app = getApp()
    var state = app && app.__p2MotionFollow
    return state ? {
      requestCount: state.requestCount,
      trace: state.trace.slice(),
      unexpected: state.unexpected.slice(),
    } : null
  })
}

async function restoreFollowHarness(mp) {
  return mp.evaluate(function () {
    var app = getApp()
    var state = app && app.__p2MotionFollow
    if (!state) return false
    state.timers.forEach(function (timer) { clearTimeout(timer) })
    app.sendRequest = state.originalSendRequest
    Object.keys(state.previousStorage).forEach(function (key) {
      var previous = state.previousStorage[key]
      if (previous.had) wx.setStorageSync(key, previous.value)
      else wx.removeStorageSync(key)
    })
    Object.keys(state.previousGlobal).forEach(function (key) {
      var previous = state.previousGlobal[key]
      if (previous.had) app.globalData[key] = previous.value
      else delete app.globalData[key]
    })
    delete app.__p2MotionFollow
    return app.sendRequest === state.originalSendRequest
  })
}

async function runFollowFlow(mp, outputDir, manifest) {
  const identity = await installFollowHarness(mp)
  addAssertion(manifest, 'follow.player-identity', identity.role === 'user'
    && Number(identity.userType) === 1 && identity.userId === '99', identity)
  try {
    const page = await reLaunchVerified(mp, '/pages/userinfo/userinfo?userId=88', '/pages/userinfo/userinfo')
    await page.waitFor(400)
    addAssertion(manifest, 'follow.route', routeOf(page) === '/pages/userinfo/userinfo', routeOf(page))
    const profile = await page.$('#profile')
    addAssertion(manifest, 'follow.profile-host', Boolean(profile), { selector: '#profile', found: Boolean(profile) })
    await profile.setData({
      hostSelf: false,
      isSelf: false,
      viewerIsMerchant: false,
      subjectIsMerchant: false,
      subjectMerchant: null,
      merchantState: 'not-merchant',
      isMerchantView: false,
      userInfo: { id: 88, nickname: '城市漫游者', avatar: '', isFollow: 0 },
      userId: '88',
      friendNum: 8,
      followNum: 12,
      fansNum: 34,
      primaryCta: '关注',
      followSubmitting: false,
      followReceipt: false,
      reducedMotion: false,
    })
    await page.waitFor(100)
    const beforeData = await profile.data()
    addAssertion(manifest, 'follow.before.unfollowed', beforeData.isSelf === false
      && beforeData.subjectIsMerchant === false && Number(beforeData.userInfo.isFollow) === 0
      && beforeData.followSubmitting === false, {
      isSelf: beforeData.isSelf,
      subjectIsMerchant: beforeData.subjectIsMerchant,
      isFollow: beforeData.userInfo && beforeData.userInfo.isFollow,
      followSubmitting: beforeData.followSubmitting,
    })
    await capture(mp, outputDir, manifest, 'follow.before', '06-follow-before.png')

    const button = await profile.$('.pc-primary--follow')
    addAssertion(manifest, 'follow.real-tap.target', Boolean(button), { selector: '.pc-primary--follow', found: Boolean(button) })
    await Promise.all([button.tap(), button.tap()])
    const pendingData = await profile.data()
    const pendingHarness = await readFollowHarness(mp)
    addAssertion(manifest, 'follow.double-tap.single-request', pendingHarness.requestCount === 1, pendingHarness)
    addAssertion(manifest, 'follow.pending', pendingData.followSubmitting === true
      && Number(pendingData.userInfo.isFollow) === 0 && pendingData.followReceipt === false, {
      followSubmitting: pendingData.followSubmitting,
      isFollow: pendingData.userInfo && pendingData.userInfo.isFollow,
      followReceipt: pendingData.followReceipt,
    })
    await capture(mp, outputDir, manifest, 'follow.pending', '07-follow-pending.png')
    // screenshot 是跨 DevTools 的异步桥；截图前为 pending 不代表落盘像素仍是 pending。
    // 必须等截图返回后再从组件回读一次，证明 07 帧采集期间成功回调尚未兑现。
    const pendingAfterCapture = await profile.data()
    const harnessAfterCapture = await readFollowHarness(mp)
    addAssertion(manifest, 'follow.pending-frame-stable', pendingAfterCapture.followSubmitting === true
      && Number(pendingAfterCapture.userInfo.isFollow) === 0
      && pendingAfterCapture.followReceipt === false
      && harnessAfterCapture.requestCount === 1, {
      followSubmitting: pendingAfterCapture.followSubmitting,
      isFollow: pendingAfterCapture.userInfo && pendingAfterCapture.userInfo.isFollow,
      followReceipt: pendingAfterCapture.followReceipt,
      requestCount: harnessAfterCapture.requestCount,
    })

    const successData = await waitUntil(
      () => profile.data(),
      (data) => data && data.followSubmitting === false && Number(data.userInfo && data.userInfo.isFollow) === 1,
      4000,
      '关注成功终态',
    )
    const check = await profile.$('.pc-follow-check')
    const settledButton = await profile.$('.pc-primary--followed')
    const settledText = settledButton && await settledButton.text()
    const successHarness = await readFollowHarness(mp)
    addAssertion(manifest, 'follow.success-receipt', successHarness.requestCount === 1
      && successData.followReceipt === true && Boolean(check)
      && String(settledText || '').includes('已关注'), {
      requestCount: successHarness.requestCount,
      followSubmitting: successData.followSubmitting,
      isFollow: successData.userInfo && successData.userInfo.isFollow,
      followReceipt: successData.followReceipt,
      checkFound: Boolean(check),
      buttonText: settledText,
    })
    await capture(mp, outputDir, manifest, 'follow.success', '08-follow-success.png')
    addAssertion(manifest, 'follow.mock-contract', successHarness.unexpected.length === 0, {
      unexpected: successHarness.unexpected,
      trace: successHarness.trace,
    })
    manifest.flows.follow = {
      route: routeOf(page),
      fixtureTarget: '#profile',
      realRapidTap: { selector: '.pc-primary--follow', count: 2 },
      requestDelayMs: 1500,
      requestCount: successHarness.requestCount,
      mockedReadRequests: successHarness.trace
        .filter((entry) => entry.url !== '/api/user/follow/action')
        .map((entry) => entry.url),
      finalReceipt: settledText,
    }
  } finally {
    const restored = await restoreFollowHarness(mp)
    addAssertion(manifest, 'follow.sendRequest-restored', restored === true, { restored })
  }
}

async function main() {
  const outputDir = process.env.P2_MOTION_OUT
  if (!outputDir || !path.isAbsolute(outputDir)) {
    throw new Error('P2_MOTION_OUT 必须是绝对路径')
  }
  fs.mkdirSync(outputDir, { recursive: true })
  const startedSource = readSourceProvenance()
  const manifest = {
    schemaVersion: 1,
    status: 'WIP',
    runResult: 'RUNNING',
    releaseReady: false,
    createdAt: new Date().toISOString(),
    source: startedSource,
    devtools: {},
    assertions: [],
    flows: {},
    screenshots: [],
    visualReview: 'PENDING_MANUAL_VIEW_IMAGE',
    limits: [
      'WIP evidence only; not Action Ledger release evidence',
      'PNG gate checks file/header/dimensions/hash only; visual quality requires view_image review',
      'Borrowed DevTools is disconnected, never closed, killed, started, or relaunched',
    ],
  }
  let session
  try {
    const parsed = parseBorrowEndpoint(process.env.WS_ENDPOINT)
    const leaseFile = leasePathForPort(parsed.port)
    const lease = readProjectLease(parsed.port)
    const assertedLease = assertBorrowContract({
      wsEndpoint: parsed.endpoint,
      projectPath: PROJECT_PATH,
      head: startedSource.head,
      lease,
    })
    manifest.devtools = {
      endpoint: parsed.endpoint,
      port: parsed.port,
      leaseFile,
      lease: assertedLease,
      ownership: 'borrowed',
      cleanup: 'disconnect-only',
    }
    addAssertion(manifest, 'preflight.ws-endpoint', true, parsed)
    addAssertion(manifest, 'preflight.lease-project-head-port', true, assertedLease)

    session = await openMiniProgram({
      projectPath: PROJECT_PATH,
      wsEndpoint: parsed.endpoint,
      connectAttempts: 3,
      stackAttempts: 8,
      retryDelay: 250,
      stackCallTimeoutMs: 5000,
    })
    addAssertion(manifest, 'preflight.borrowed-session', session.borrowed === true
      && session.endpoint === parsed.endpoint, {
      borrowed: session.borrowed,
      endpoint: session.endpoint,
    })

    await runAiFlow(session.mp, outputDir, manifest)
    await runLedgerFlow(session.mp, outputDir, manifest)
    await runFollowFlow(session.mp, outputDir, manifest)

    const completedSource = readSourceProvenance()
    addAssertion(manifest, 'source.provenance-stable', completedSource.head === startedSource.head
      && completedSource.branch === startedSource.branch
      && completedSource.dirty === startedSource.dirty
      && completedSource.diffDigest === startedSource.diffDigest, {
      started: startedSource,
      completed: completedSource,
    })
    addAssertion(manifest, 'screenshots.basic-png-gate', manifest.screenshots.length === 8
      && manifest.screenshots.every((item) => item.bytes >= 1024 && item.width >= 100 && item.height >= 100), {
      count: manifest.screenshots.length,
      files: manifest.screenshots.map((item) => item.path),
    })
    manifest.runResult = 'PASS'
    manifest.completedAt = new Date().toISOString()
  } catch (error) {
    manifest.runResult = 'FAIL'
    manifest.completedAt = new Date().toISOString()
    manifest.failure = {
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : '',
    }
    throw Object.assign(error, { p2Manifest: manifest, p2OutputDir: outputDir })
  } finally {
    if (session && session.mp && typeof session.mp.disconnect === 'function') {
      try { await session.mp.disconnect() } catch (error) {
        manifest.disconnectError = error && error.message ? error.message : String(error)
      }
    }
    manifest.disconnectedAt = new Date().toISOString()
    const manifestPath = writeManifest(outputDir, manifest)
    manifest.manifestPath = manifestPath
    console.log(`P2_MOTION_MANIFEST ${manifestPath}`)
  }
  return manifest
}

if (require.main === module) {
  main().then((manifest) => {
    console.log(`P2_MOTION_PASS screenshots=${manifest.screenshots.length} assertions=${manifest.assertions.length}`)
  }).catch((error) => {
    console.error('P2_MOTION_FAIL', error && error.stack ? error.stack : error)
    process.exit(1)
  })
}

module.exports = {
  assertBorrowContract,
  assertPngArtifact,
  main,
  parseBorrowEndpoint,
  readSourceProvenance,
}
