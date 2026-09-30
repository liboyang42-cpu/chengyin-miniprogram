// C01(首页·广场·搜索·个人主页)UI 第 1 轮契约。
// 判据真源:vault 03-进行中/小程序_UI_第1轮_C01_首页广场搜索个人页_优化文档_20260729.md
//
// 纪律(规范 §6):每条正向断言都配一条同文件内的负控 —— 把源码变异成"该红的样子",
// 用 assert.throws 包住同一条断言,证明它**能变红**,而不是恒真。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => readResolved(rel)
const readJson = (rel) => JSON.parse(read(rel))

const selectorOwnsTarget = (selector, wanted) => {
  const rightmost = selector.split(/\s+|[>+~]/).filter(Boolean).pop() || ''
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}(?![\\w-])`).test(rightmost)
}

const declarationValuesForSelector = (css, wanted, property) => {
  const values = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(selector => selector.trim())
    if (!selectors.some(selector => selectorOwnsTarget(selector, wanted))) continue
    for (const declaration of match[2].split(';')) {
      const parsed = declaration.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/)
      if (parsed && parsed[1] === property) values.push(parsed[2])
    }
  }
  return values
}

const assertSharedC1TitleSpacing = (css = read('components/cy/page-title/index.wxss')) => {
  assert.deepEqual(declarationValuesForSelector(css, '.pt', 'margin'), [], '共享标题不得用 margin shorthand 模糊覆盖上下基准')
  assert.deepEqual(declarationValuesForSelector(css, '.pt', 'margin-top'), ['var(--cy-space-5)'], 'C01 标题上方必须恰好为 space-5(aaa v3)')
  assert.deepEqual(declarationValuesForSelector(css, '.pt', 'margin-bottom'), ['var(--cy-space-2)'], 'C01 标题下方必须恰好为 space-2(aaa v3)')
}

const nonZeroTopSpacingForSelector = (css, wanted, includePadding = false) => {
  const properties = includePadding ? ['margin', 'margin-top', 'padding', 'padding-top'] : ['margin', 'margin-top']
  const values = []
  for (const property of properties) {
    for (const value of declarationValuesForSelector(css, wanted, property)) {
      const top = property.endsWith('-top') ? value : value.trim().split(/\s+/)[0]
      if (!/^0(?:r?px|rem|em|%)?$/.test(top)) values.push(`${property}:${top}`)
    }
  }
  return values
}

const assertNoC1ContentTopSpacing = (wxssPath, selector, includePadding = false, cssOverride) => {
  const css = cssOverride === undefined ? read(wxssPath) : cssOverride
  assert.deepEqual(
    nonZeroTopSpacingForSelector(css, selector, includePadding),
    [],
    `${wxssPath} 的 ${selector} 不得在共享 space-5 外再叠加标题后间距`,
  )
}

// 只驱动页面公开生命周期与真实 request 回调；不注入视觉状态或 eventChannel。
// 这让“无参数进入”和“分页请求失败”能在 Node 契约里走到页面自身的公开分支。
const loadPage = (rel, options = {}) => {
  let definition
  const requests = []
  const appOverrides = options.app || {}
  const originalSendRequest = appOverrides.sendRequest || (() => {})
  const app = Object.assign({
    getUserID: () => 0,
    getAvatar: () => '',
    getPageSize: () => 10,
    getTotalPage: () => 1,
    getRequestErrorMessage: () => '服务返回异常，重试会重新拉取一次',
    tips: () => {},
  }, appOverrides, {
    sendRequest(request) {
      requests.push(request)
      return originalSendRequest(request)
    },
  })
  const wx = Object.assign({
    getWindowInfo: () => ({
      statusBarHeight: 20,
      screenHeight: 844,
      windowHeight: 844,
      windowWidth: 390,
      safeArea: { bottom: 810 },
    }),
    navigateBack: () => {},
    reLaunch: () => {},
  }, options.wx || {})
  const requireStub = (request) => {
    if (request === '../../../utils/datetime') return { toTimestamp: (value) => value }
    if (request === '../../../utils/analytics.js') return { track: () => {} }
    if (request === '../../../utils/feed-play-card.js') return require(path.join(ROOT, 'utils/feed-play-card.js'))
    if (request === '../../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'))
    if (request === '../utils/topic-template-remix.js') return { remixTopicTemplate: () => Promise.resolve(false) }
    if (request === '../../../utils/ui-state-request.js') {
      return {
        sendUiStateRequest(targetApp, endpoint, requestOptions) {
          return targetApp.sendRequest(Object.assign({}, requestOptions, {
            url: endpoint,
            hideLoading: true,
            silentError: true,
          }))
        },
      }
    }
    if (request === './utils/crop-geometry') {
      return {
        parseRatio: () => null,
        clampTransform: (value) => value,
        computeCropRect: () => null,
      }
    }
    // 2026-08-26 点赞爆一下:动效与减动效偏好走既有真源,用真模块不用桩 ——
    // 桩会和真值漂移,而「减少动态效果时不播、触感一并跳过」正是靠它们判定的。
    if (request.endsWith('motion.js')) return require(path.join(ROOT, 'utils/motion.js'))
    if (request.endsWith('motion-preference.js')) {
      return require(path.join(ROOT, 'utils/motion-preference.js'))
    }
    throw new Error(`未为 C01 页面契约提供 require stub: ${request}`)
  }

  // options.source 让负控在内存里跑变异后的源码,不写回磁盘、不 checkout 复原。
  const source = options.source || read(rel)
  const timers = { armed: [], cleared: [] }
  let nextTimerId = 1
  vm.runInNewContext(source, {
    Page: (config) => { definition = config },
    getApp: () => app,
    getCurrentPages: () => [],
    wx,
    require: requireStub,
    // 默认立即执行 = 定时闸"已到期";options.deferTimers 只登记不触发,用来观测首帧。
    setTimeout: (callback, ms) => {
      const id = nextTimerId++
      timers.armed.push({ id, ms, callback })
      if (!options.deferTimers) callback()
      return id
    },
    clearTimeout: (id) => { timers.cleared.push(id) },
  }, { filename: rel || 'mutated-source' })

  assert.ok(definition, `${rel || 'mutated-source'} 必须注册 Page`)
  const page = Object.assign({}, definition, {
    // 只在测试显式提供时才存在,默认仍是"无 opener 通道"的真实直开场景
    getOpenerEventChannel: options.getOpenerEventChannel,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.')
        let target = this.data
        while (parts.length > 1) {
          const part = parts.shift()
          target[part] = target[part] || {}
          target = target[part]
        }
        target[parts[0]] = value
      }
      if (callback) callback()
    },
  })
  return { page, requests, wx, timers }
}

// C1 的八个可改目录(分组矩阵 §1 的文件边界)
const C1_DIRS = [
  'pages/index', 'pages/square', 'pages/search2', 'pages/searchmap',
  'pages/mylike', 'pages/crop', 'pages/userinfo',
]

const walk = (dir) => {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
}

// ---------------------------------------------------------------------------
// P0-E · cy-icon 的 name 必须在 icons.wxss 里真有 mask
// 名字不存在时 mask-image: var(--cyi-m) 无值 ⇒ 不裁形 ⇒ 整块渲染成 currentColor 实心方块,
// 且没有任何报错(基线图 007 底部那个白方块就是 name="map")。
// ---------------------------------------------------------------------------
const declaredIconNames = () =>
  new Set([...read('components/cy/icon/icons.wxss').matchAll(/cyi--([a-z0-9-]+)/g)].map((m) => m[1]))

const usedIconNames = (source) =>
  [...source.matchAll(/<cy-icon[^>]*\sname="([a-z0-9-]+)"/g)].map((m) => m[1])

test('P0-E: every cy-icon name used in the repo has a real mask in icons.wxss', () => {
  const declared = declaredIconNames()
  const offenders = []
  for (const dir of ['pages', 'components', 'subpackageA', 'subpackageB', 'subpackageP3']) {
    for (const file of walk(dir).filter((f) => f.endsWith('.wxml'))) {
      for (const name of usedIconNames(read(file))) {
        if (!declared.has(name)) offenders.push(`${file}: name="${name}"`)
      }
    }
  }
  assert.deepEqual(offenders, [], `cy-icon 使用了 icons.wxss 里不存在的 name(会静默渲染成实心方块):\n${offenders.join('\n')}`)
})

test('P0-E negative control: a bogus cy-icon name is rejected', () => {
  const declared = declaredIconNames()
  const mutated = read('pages/search2/index.wxml').replace('name="gps"', 'name="definitely-not-an-icon"')
  const offenders = usedIconNames(mutated).filter((n) => !declared.has(n))
  // 负控要证明"这条断言抓得住",而且抓到的正是那个假名字 —— 不是"抛了某个异常"就算数
  assert.deepEqual(offenders, ['definitely-not-an-icon'])
  assert.throws(() => assert.deepEqual(offenders, []))
})

// ---------------------------------------------------------------------------
// P0 · 动态详情不能把无 id、加载中、服务错误和空数据退化成同一张空壳。
// 公开 seam：onLoad(options) 只在有 id 时请求；详情 request 的回调决定页面状态。
// ---------------------------------------------------------------------------
test('P0: square/detail gives no-id, loading, error and empty data distinct visible exits', () => {
  const wxml = read('pages/square/detail/index.wxml')
  const json = readJson('pages/square/detail/index.json')
  for (const component of ['cy-skeleton', 'cy-error', 'cy-empty', 'cy-btn']) {
    assert.ok(json.usingComponents[component], `square/detail 必须注册 ${component}`)
  }
  assert.match(wxml, /wx:if="\{\{detailState === 'loading'\}\}"/)
  assert.match(wxml, /<cy-error[^>]*bind:retry="onRetryDetail"/)
  assert.match(wxml, /<cy-empty[^>]*kind="missing-param"[^>]*bind:cta="goBack"/)
  assert.match(wxml, /<cy-empty[^>]*kind="empty"/)

  const missing = loadPage('pages/square/detail/index.js')
  missing.page.onLoad({})
  assert.equal(missing.requests.length, 0, '没有 id 时不得向详情/评论接口发空请求')
  assert.equal(missing.page.data.detailState, 'missing-param')

  const failed = loadPage('pages/square/detail/index.js')
  failed.page.onLoad({ id: 'post-1' })
  const detailRequest = failed.requests.find((request) => request.url === '/api/creativesquare/info')
  assert.ok(detailRequest, '有 id 时必须请求动态详情')
  detailRequest.fail()
  assert.equal(failed.page.data.detailState, 'error')

  const empty = loadPage('pages/square/detail/index.js')
  empty.page.onLoad({ id: 'post-empty' })
  empty.requests.find((request) => request.url === '/api/creativesquare/info').success({ code: '200', data: {} })
  assert.equal(empty.page.data.detailState, 'empty')

  const ready = loadPage('pages/square/detail/index.js')
  ready.page.onLoad({ id: 'post-2' })
  ready.requests.find((request) => request.url === '/api/creativesquare/info').success({
    code: '200',
    data: { id: 2, memberNickname: '正常内容', pics: '' },
  })
  assert.equal(ready.page.data.detailState, 'ready', '正常内容必须仍进入原详情结构')
  assert.equal(ready.page.data.info.memberNickname, '正常内容')
})

test('square/detail 的更多入口先打开操作菜单，再由菜单进入举报确认', () => {
  const detail = loadPage('pages/square/detail/index.js')
  let reportCalls = 0
  detail.page.reportSquare = () => { reportCalls += 1 }

  detail.page.openPostActions()
  assert.equal(detail.page.data.postActionShow, true)
  assert.equal(reportCalls, 0, '点省略号不得直接触发举报')

  detail.page.reportSquareFromActions()
  assert.equal(detail.page.data.postActionShow, false)
  assert.equal(reportCalls, 1, '只有点击菜单中的举报项才进入举报确认')
})

test('square/detail 关注评论者只在服务端回读确认后报成功，回读失败保留旧列表', () => {
  const event = { currentTarget: { dataset: { index: 0 } } }
  const original = [{ id: 31, memberId: 9, memberNickname: '玩家九', isFollowTheUser: 0 }]

  const failedToasts = []
  const failed = loadPage('pages/square/detail/index.js', {
    wx: { showToast: (options) => failedToasts.push(options.title) },
  })
  failed.page.data.id = 88
  failed.page.data.list = JSON.parse(JSON.stringify(original))
  failed.page.commentFollowClick(event)
  const failedPost = failed.requests.find((request) => request.url === '/api/user/follow/action')
  assert.ok(failedPost)
  failedPost.success({ code: '200' })
  assert.doesNotMatch(failedToasts.join('|'), /关注成功/, 'POST 200 还不是权威终态')
  const failedReadback = failed.requests.find((request) => request.url === '/api/comment/list')
  assert.ok(failedReadback, '写后必须回读评论行的 isFollowTheUser')
  failedReadback.fail()
  assert.deepEqual(failed.page.data.list, original, '回读失败不能清空或伪造列表终态')
  assert.match(failedToasts.at(-1), /状态确认失败.*刷新/)

  const malformedToasts = []
  const malformed = loadPage('pages/square/detail/index.js', {
    wx: { showToast: (options) => malformedToasts.push(options.title) },
  })
  malformed.page.data.id = 88
  malformed.page.data.list = JSON.parse(JSON.stringify(original))
  malformed.page.commentFollowClick(event)
  malformed.requests.find((request) => request.url === '/api/user/follow/action').success({ code: '200' })
  const malformedReadback = malformed.requests.find((request) => request.url === '/api/comment/list')
  assert.doesNotThrow(() => malformedReadback.success({ code: '200', data: { rows: {} } }))
  assert.deepEqual(malformed.page.data.list, original, '畸形回读不能写入或清空旧列表')
  assert.match(malformedToasts.at(-1), /状态确认失败.*刷新/)

  const successToasts = []
  const success = loadPage('pages/square/detail/index.js', {
    wx: { showToast: (options) => successToasts.push(options.title) },
  })
  success.page.data.id = 88
  success.page.data.list = JSON.parse(JSON.stringify(original))
  success.page.commentFollowClick(event)
  success.requests.find((request) => request.url === '/api/user/follow/action').success({ code: '200' })
  success.requests.find((request) => request.url === '/api/comment/list').success({
    code: '200',
    data: { rows: [{ id: 31, memberId: 9, memberNickname: '玩家九', isFollowTheUser: 1 }] },
  })
  assert.equal(success.page.data.list[0].isFollowTheUser, 1)
  assert.equal(successToasts.at(-1), '关注成功')
})

test('广场列表与详情销毁时中止 RequestTask 并使详情/评论 epoch 失效', () => {
  const listSource = read('pages/square/list/index.js')
  const listUnload = listSource.slice(listSource.indexOf('onUnload()'), listSource.indexOf('goUserInfoClcik'))
  assert.match(listUnload, /_feedRequestId\s*=\s*\(this\._feedRequestId\s*\|\|\s*0\)\s*\+\s*1/)
  assert.match(listUnload, /_feedRequestTask[\s\S]*\.abort\(\)/)

  const detailSource = read('pages/square/detail/index.js')
  assert.match(detailSource, /onUnload\(\)\s*\{[\s\S]*_detailRequestId\s*=\s*\(this\._detailRequestId\s*\|\|\s*0\)\s*\+\s*1/)
  assert.match(detailSource, /onUnload\(\)\s*\{[\s\S]*_commentsRequestId\s*=\s*\(this\._commentsRequestId\s*\|\|\s*0\)\s*\+\s*1/)
  assert.match(detailSource, /onUnload\(\)\s*\{[\s\S]*_detailRequestTask[\s\S]*\.abort\(\)/)
  assert.match(detailSource, /onUnload\(\)\s*\{[\s\S]*_commentsRequestTask[\s\S]*\.abort\(\)/)
})

// ---------------------------------------------------------------------------
// P0 · 裁剪页没有真实 cropInit 图片时，要留在清楚空态并给用户返回入口，不能黑画布或自动离开。
// 公开 seam：没有 opener channel 的 onLoad()。
// ---------------------------------------------------------------------------
test('P0: crop without a real cropInit source renders a returnable missing-source state', () => {
  const wxml = read('pages/crop/index.wxml')
  const json = readJson('pages/crop/index.json')
  assert.ok(json.usingComponents['cy-empty'], 'crop 必须注册 cy-empty')
  assert.match(wxml, /wx:if="\{\{sourceState === 'missing'\}\}"/)
  assert.match(wxml, /<cy-empty[^>]*kind="missing-param"/)
  assert.doesNotMatch(wxml, /<cy-empty[^>]*kind="missing-param"[^>]*icon=/,
    '缺参必须露出 KIND_DEFAULTS 的 info glyph，不能再盖空态位图')
  assert.match(wxml, /\{\{sourceState === 'missing' \? '返回上一页' : '取消'\}\}/)

  let navigatedBack = 0
  const { page } = loadPage('pages/crop/index.js', {
    wx: { navigateBack: () => { navigatedBack += 1 } },
  })
  page.onLoad()
  assert.equal(navigatedBack, 0, '缺少 cropInit 不得自动跳过可解释的空态')
  assert.equal(page.data.sourceState, 'missing')
  assert.match(read('pages/crop/index.wxss'), /\.crop__stage--empty\s*\{[^}]*background: var\(--cy-color-bg-elevated\)/,
    '无图空态必须离开黑色取景台，不能伪装成可裁剪画布')

  // 真实 cropInit 仍必须切回裁剪流程 —— 驱动真实通道回调,不只查源码里有没有这个字面串
  const emitters = {}
  const { page: fed } = loadPage('pages/crop/index.js', {
    getOpenerEventChannel: () => ({ on: (name, cb) => { emitters[name] = cb } }),
    wx: { getImageInfo: () => {} },
  })
  fed.onLoad()
  emitters.cropInit({ paths: ['/tmp/a.jpg'], ratio: '1:1' })
  assert.notEqual(fed.data.sourceState, 'missing', '真实 cropInit 必须离开无源态')
  assert.equal(fed.data.src, '/tmp/a.jpg', '真实 cropInit 必须把第一张图喂进取景框')
})

// ---------------------------------------------------------------------------
// C01-R4 · cropInit 走 navigateTo 的 success 回调,必然晚于 crop 页首帧。
// 首帧若直接渲染"没有可裁剪的图片",每一次**正常**选图裁剪都会闪一次假空态 ——
// 这是对成功路径说谎,和"失败伪装成空"是同一类错误的反面。
// ---------------------------------------------------------------------------
test('C01-R4 crop: the pre-cropInit first frame is a neutral waiting state, not the missing-source empty state', () => {
  const wxml = read('pages/crop/index.wxml')
  const js = read('pages/crop/index.js')

  // 初始态必须是 waiting:直接从源码的 data 字面量读,不从渲染结果反推
  assert.match(js, /sourceState: 'waiting'/, 'crop 初始图源态必须是 waiting')
  assert.match(wxml, /wx:elif="\{\{sourceState === 'waiting'\}\}"/, 'waiting 必须有自己的可见分支')
  const waiting = wxml.match(/<view class="crop__waiting"[\s\S]*?<\/view>/)
  assert.ok(waiting, 'waiting 分支必须真实渲染内容')
  assert.equal(/没有可裁剪的图片/.test(waiting[0]), false, 'waiting 不得复用无源态文案')
  assert.match(waiting[0], /正在准备/, 'waiting 必须说明"在等图"')
  // 新增的可见状态必须能被读屏播报,不能只是一段裸 text
  assert.match(waiting[0], /aria-live="polite"/, 'waiting 必须可被读屏播报')
  assert.match(waiting[0], /aria-label="正在准备要裁剪的图片"/, 'waiting 必须有无障碍名称')
  // 浅色面只给需要解释/恢复的 missing 与 error；waiting 仍留在取景台底色上。
  assert.match(wxml, /class="crop__stage \{\{sourceState === 'missing' \|\| sourceState === 'error' \? 'crop__stage--empty' : ''\}\}"/,
    'waiting 必须留在取景台底色上')

  // 有真实 opener 通道时,onLoad 结束的那一刻不能已经是 missing
  const { page } = loadPage('pages/crop/index.js', {
    deferTimers: true, // 只登记不触发:模拟"首帧已渲染但等图闸还没到期"
    getOpenerEventChannel: () => ({ on: () => {} }),
  })
  page.onLoad()
  assert.equal(page.data.sourceState, 'waiting',
    '有 opener 通道时首帧必须是 waiting —— 渲染 missing 就是对正常选图流程说谎')

  // 但也不能永远转圈:通道在、图始终不来时,等图闸必须兜到可返回的无源态
  const { page: timedOut } = loadPage('pages/crop/index.js', {
    getOpenerEventChannel: () => ({ on: () => {} }), // 默认 setTimeout 立即执行 = 闸到期
  })
  timedOut.onLoad()
  assert.equal(timedOut.data.sourceState, 'missing',
    'cropInit 始终不来时必须落到无源态,不能把用户留在等待里')
})

// eventChannel 会把 on() 之前就 emit 的事件在 on() 里同步回放。等图闸若晚于 ch.on 才上,
// 那一路的撤闸会空跑,留一只 3s 悬空定时器。
test('C01-R4 crop: a cropInit that replays synchronously inside on() still cancels the wait gate', () => {
  const { page, timers } = loadPage('pages/crop/index.js', {
    deferTimers: true,
    getOpenerEventChannel: () => ({
      on: (name, cb) => { if (name === 'cropInit') cb({ paths: ['/tmp/a.jpg'] }) },
    }),
    wx: { getImageInfo: () => {} },
  })
  page.onLoad()
  assert.notEqual(page.data.sourceState, 'missing', '同步回放的 cropInit 必须离开无源态')
  assert.equal(timers.armed.length, 1, '等图闸必须在 ch.on 之前就上,才可能被同步回放撤掉')
  assert.deepEqual(timers.cleared, [timers.armed[0].id],
    '同步回放的 cropInit 必须真的撤掉等图闸,不能留悬空定时器')
})

test('C01-R4 crop: leaving the page cancels the wait gate', () => {
  const { page, timers } = loadPage('pages/crop/index.js', {
    deferTimers: true,
    getOpenerEventChannel: () => ({ on: () => {} }),
  })
  page.onLoad()
  page.onUnload()
  assert.deepEqual(timers.cleared, [timers.armed[0].id], 'onUnload 必须撤掉等图闸')
})

test('C01-R4 crop negative control: rendering the missing state on the first frame turns this exact guard red', () => {
  const mutated = read('pages/crop/index.js').replace(
    "sourceState: 'waiting', // waiting | ready | missing | error",
    "sourceState: 'missing', // waiting | ready | missing | error")
  assert.notEqual(mutated, read('pages/crop/index.js'), '负控必须真实把 crop 初始态改回无源态')
  // 真跑变异后的页面,不是拿正则去查一个刚被自己替换掉的字面串(那是恒真)
  const { page } = loadPage(null, {
    source: mutated,
    deferTimers: true,
    getOpenerEventChannel: () => ({ on: () => {} }),
  })
  page.onLoad()
  assert.throws(
    () => assert.equal(page.data.sourceState, 'waiting',
      '有 opener 通道时首帧必须是 waiting —— 渲染 missing 就是对正常选图流程说谎'),
    /对正常选图流程说谎/,
  )
})

test('C01-R4 crop negative control: dropping the wait gate strands the user on the waiting state', () => {
  const source = read('pages/crop/index.js')
  const mutated = source.replace(
    /this\.sourceWaitTimer = setTimeout\([\s\S]*?\}, SOURCE_WAIT_MS\);/,
    '',
  )
  assert.notEqual(mutated, source, '负控必须真实拆掉等图闸')
  const { page } = loadPage(null, {
    source: mutated,
    getOpenerEventChannel: () => ({ on: () => {} }),
  })
  page.onLoad()
  assert.throws(
    () => assert.equal(page.data.sourceState, 'missing',
      'cropInit 始终不来时必须落到无源态,不能把用户留在等待里'),
    /不能把用户留在等待里/,
    '拆掉等图闸后必须停在 waiting —— 证明这条断言真的靠那只闸',
  )
})

test('C01-R4 crop negative control: arming the wait gate after ch.on leaks a dangling timer', () => {
  const source = read('pages/crop/index.js')
  const gate = source.match(/    this\.sourceWaitTimer = setTimeout\([\s\S]*?\}, SOURCE_WAIT_MS\);\n/)
  assert.ok(gate, '负控锚点失效(源码已改动?)')
  // 把上闸挪到 ch.on 之后 = 修复前的顺序
  const mutated = source.replace(gate[0], '').replace(
    /(ch\.on\('cropInit',[\s\S]*?\n    \}\);\n)/, `$1${gate[0]}`)
  assert.notEqual(mutated, source, '负控必须真实把上闸挪到 ch.on 之后')

  const { page, timers } = loadPage(null, {
    source: mutated,
    deferTimers: true,
    getOpenerEventChannel: () => ({
      on: (name, cb) => { if (name === 'cropInit') cb({ paths: ['/tmp/a.jpg'] }) },
    }),
    wx: { getImageInfo: () => {} },
  })
  page.onLoad()
  assert.throws(
    () => assert.deepEqual(timers.cleared, [timers.armed[0].id],
      '同步回放的 cropInit 必须真的撤掉等图闸,不能留悬空定时器'),
    /悬空定时器/,
  )
})

test('C01-R4 crop negative control: reusing the missing-source copy for waiting turns its exact guard red', () => {
  const source = read('pages/crop/index.wxml')
  // 只动可见标题,不动 aria-label —— 变异必须落在被断言的那一段上,而不是顺手全替
  const mutated = source.replace('title="正在准备图片"', 'title="没有可裁剪的图片"')
  assert.notEqual(mutated, source, '负控必须真实把等图文案改成无源文案')
  const waiting = mutated.match(/<view class="crop__waiting"[\s\S]*?<\/view>/)
  assert.ok(waiting)
  assert.throws(
    () => assert.equal(/没有可裁剪的图片/.test(waiting[0]), false, 'waiting 不得复用无源态文案'),
    /waiting 不得复用无源态文案/,
  )
})

test('C01-R4 crop negative control: stripping the waiting aria-live turns its exact guard red', () => {
  const source = read('pages/crop/index.wxml')
  const mutated = source.replace(' aria-live="polite"', '')
  assert.notEqual(mutated, source, '负控必须真实拆掉 waiting 的读屏播报')
  const waiting = mutated.match(/<view class="crop__waiting"[\s\S]*?<\/view>/)
  assert.ok(waiting)
  assert.throws(() => assert.match(waiting[0], /aria-live="polite"/), /aria-live/)
})

test('P0 crop negative control: covering missing-param with empty artwork turns the readable-icon guard red', () => {
  const source = read('pages/crop/index.wxml')
  const mutated = source.replace(
    'kind="missing-param"',
    'kind="missing-param" icon="/images/no_data.svg"',
  )
  assert.notEqual(mutated, source, '负控必须真实给裁剪缺参盖上位图')
  assert.throws(
    () => assert.doesNotMatch(mutated, /<cy-empty[^>]*kind="missing-param"[^>]*icon=/,
      '缺参必须露出 KIND_DEFAULTS 的 info glyph，不能再盖空态位图'),
    /不能再盖空态位图/,
  )
})

// ---------------------------------------------------------------------------
// P0-B · --cy-text-inverse 只能配反色实底,配深色面就是 ≈1:1 的不可读
// 实证:userinfo 已关注钮(--cy-bg-subtle 底)。
// ---------------------------------------------------------------------------
test('P0-B: 「已关注」态不得把 inverse 文字压在暗表面上', () => {
  // 2026-08-06：主页统一到 cy-profile 后，原 userinfo 的 .ygz 搬成了组件里的
  // .pc-primary--followed。约束一字未改：已关注态是「浅灰底 + 次级文字」，
  // 不能用 --cy-text-inverse(#09080C) —— 压在暗表面上对比度≈1:1。
  const wxss = read('components/cy/profile/index.wxss')
  const rule = wxss.match(/\.pc-primary--followed\s*\{[^}]*\}/)
  assert.ok(rule, '.pc-primary--followed 规则必须存在(已关注态)')
  assert.doesNotMatch(rule[0], /--cy-text-inverse/,
    '已关注态底是 surface-subtle，配 --cy-text-inverse 对比度≈1:1')
  assert.match(rule[0], /color:\s*var\(--cy-color-text-secondary\)/)
})

test('P0-A/B negative control: inverse-on-dark-surface is caught, not merely "some assertion threw"', () => {
  const mutated = read('components/cy/profile/index.wxss')
    .replace(/\.pc-primary--followed\s*\{[^}]*\}/, '.pc-primary--followed{ background: var(--cy-bg-subtle); color: var(--cy-text-inverse);}')
  const ygz = mutated.match(/\.pc-primary--followed\s*\{[^}]*\}/)
  assert.throws(
    () => assert.doesNotMatch(ygz[0], /--cy-text-inverse/),
    /cy-text-inverse/,   // 断言红的是**这一道闸**,不是相邻某条同型断言接住的
  )
})

// ---------------------------------------------------------------------------
// P0-D · 结构已知的首屏加载走 cy-skeleton,不写裸文案 / 虚线占位框(规范 §3.12)
// ---------------------------------------------------------------------------
test('P0-D: search2 uses skeletons instead of bare loading labels', () => {
  const wxmlPath = 'pages/search2/index.wxml'
  const jsonPath = 'pages/search2/index.json'
  const wxml = read(wxmlPath)
  assert.ok(readJson(jsonPath).usingComponents['cy-skeleton'], `${jsonPath} 必须注册 cy-skeleton`)
  assert.match(wxml, /<cy-skeleton[^>]*type="/, `${wxmlPath} 必须渲染骨架`)
  assert.equal(/>[^<]*(加载中|搜索中|正在查找)[.…]/.test(wxml), false,
    `${wxmlPath} 不得再渲染裸加载文案`)
  // 虚线占位框(把 loading 画成一个框)也一并退场
  assert.doesNotMatch(read('pages/search2/index.wxss'), /dashed/)
})

test('P0-D negative control: a bare loading label without a skeleton is rejected', () => {
  const mutated = read('pages/search2/index.wxml')
    .replace('<cy-skeleton wx:if="{{categoryLoading}}" type="card" count="2" />',
             '<view wx:if="{{categoryLoading}}">类别加载中...</view>')
  assert.throws(() => assert.equal(/>[^<]*加载中[.…]/.test(mutated), false))
})

// ---------------------------------------------------------------------------
// P0-F / P0-G · C1 页面里不许有内联字面色 / 字号,行高只能是 token 或 1(规范 §10-1 / §3.3)
// ---------------------------------------------------------------------------
test('P0-G: no inline literal color/font-size in C1 WXML', () => {
  const offenders = []
  for (const dir of C1_DIRS) {
    for (const file of walk(dir).filter((f) => f.endsWith('.wxml'))) {
      const src = read(file)
      for (const m of src.matchAll(/style="([^"]*)"/g)) {
        if (/(^|;)\s*color\s*:\s*#/.test(m[1]) || /font-size\s*:\s*\d/.test(m[1])) {
          offenders.push(`${file}: ${m[1]}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `C1 页面 WXML 内联硬编码色/字号:\n${offenders.join('\n')}`)
})

test('P0-G negative control: an inline literal color changes this exact guard to red', () => {
  const source = read('pages/square/detail/index.wxml')
  const mutated = source
    .replace('<view class="ph-more"', '<view class="ph-more" style="color:#7A5CFF;font-size:26rpx;"')
  assert.notEqual(mutated, source, '负控必须真实突变 C01 源文件')
  const styles = [...mutated.matchAll(/style="([^"]*)"/g)].map((match) => match[1])
  const offenders = styles.filter((style) => /(^|;)\s*color\s*:\s*#/.test(style) || /font-size\s*:\s*\d/.test(style))
  assert.deepEqual(offenders, ['color:#7A5CFF;font-size:26rpx;'])
  assert.throws(() => assert.deepEqual(offenders, []), /color:#7A5CFF/)
})

test('P0-F: 广场三个灰色统计块已删除，由 token 横向活动卡轨承接', () => {
  const wxml = read('pages/square/list/index.wxml')
  const js = read('pages/square/list/index.js')
  const wxss = read('pages/square/list/index.wxss')
  assert.doesNotMatch(wxml, /class="(?:summary|sum-card)"/)
  assert.doesNotMatch(js, /creativesquare\/summary|getSummary/)
  assert.match(wxml, /class="sq-upcoming-track"[^>]*scroll-x[\s\S]*?class="sq-upcoming-card/)
  const banner = wxss.slice(wxss.indexOf('.sq-upcoming-track {'), wxss.indexOf('/* ===== 内联发布框'))
  assert.match(banner, /background: var\(--cy-color-bg-elevated\)/)
  assert.doesNotMatch(banner.replace(/\/\*[\s\S]*?\*\//g, ''), /(?:#|rgba\()/,
    '新 banner 的颜色必须全部由 token 提供')
})

test('P0-F negative control: 把旧三格统计块塞回广场必须判红', () => {
  const source = read('pages/square/list/index.wxml')
  const mutated = source.replace('<scroll-view class="sq-upcoming-track"', '<view class="summary"><view class="sum-card"></view></view>\n    <scroll-view class="sq-upcoming-track"')
  assert.notEqual(mutated, source, '负控必须真实突变 C01 源文件')
  assert.throws(() => assert.doesNotMatch(mutated, /class="(?:summary|sum-card)"/), /summary/)
})

// ---------------------------------------------------------------------------
// P1-H · L1 大标题统一节奏
// ---------------------------------------------------------------------------
// 2026-08-07 用户新拍板取代昨日「紧贴」基准：共享 cy-page-title 独家提供
// 返回栏→标题 space-3、标题→首内容 space-5；页面级 c1 样式不得再叠加。
test('P1-H: every C1 page 的 L1 标题统一由共享组件提供上 space-3 / 下 space-5', () => {
  assertSharedC1TitleSpacing()
  const pages = [
    // 2026-08-07 用户裁决:广场帖文流不设大标题,摘出清单
    ['pages/search2/index.wxml', 'pages/search2/index.wxss'],
    ['pages/mylike/mylike.wxml', 'pages/mylike/mylike.wxss'],
  ]
  for (const [wxmlPath, wxssPath] of pages) {
    // search2 走"外面包一层"的写法(见该文件注释:不动 system-navigation-title-contract 的变异锚点),
    // 其余页直接把类挂在组件标签上 —— 两种写法都要能被这条断言认出来
    const wxml = read(wxmlPath)
    assert.match(wxml, /<cy-page-title/, `${wxmlPath} 必须用 cy-page-title 承担 L1 标题`)
    assert.match(wxml, /class="c1-page-title"/, `${wxmlPath} 标题(或其外层)需挂 c1-page-title`)
    assert.deepEqual(
      nonZeroTopSpacingForSelector(read(wxssPath), '.c1-page-title'),
      [],
      `${wxssPath} 的 .c1-page-title 不得叠加共享 space-3`,
    )
  }

  assertNoC1ContentTopSpacing('pages/search2/index.wxss', '.sousuo')
  assertNoC1ContentTopSpacing('pages/mylike/mylike.wxss', '.favorite-list')
})

test('P1-H: mylike no longer stacks the legacy .wp 25rpx inset on top of --cy-page-x', () => {
  const wxml = read('pages/mylike/mylike.wxml')
  // 根节点不再用全局 .wp(style/lib.wxss:80 = padding: 0 25rpx)
  assert.doesNotMatch(wxml.split('\n')[1] || '', /class="wp"/)
  assert.match(wxml, /<view class="mylike">/)
  assert.match(read('pages/mylike/mylike.wxss'), /\.mylike \.tablist\s*\{[^}]*padding:\s*0 var\(--cy-page-x\)/)
})

test('P1-H negative control: putting the legacy .wp back on the mylike root is rejected', () => {
  const mutated = read('pages/mylike/mylike.wxml').replace('<view class="mylike">', '<view class="wp">')
  assert.throws(() => assert.match(mutated, /<view class="mylike">/))
})

test('P1-H negative control: 共享基准归零/错档或首内容叠加都必须判红', () => {
  const shared = read('components/cy/page-title/index.wxss')
  const zeroTop = shared.replace('margin-top: var(--cy-space-5);', 'margin-top: 0;')
  const wrongTop = shared.replace('margin-top: var(--cy-space-5);', 'margin-top: var(--cy-space-4);')
  const zeroBottom = shared.replace('margin-bottom: var(--cy-space-2);', 'margin-bottom: 0;')
  assert.notEqual(zeroTop, shared, 'C01 top=0 负控必须真实突变源码')
  assert.notEqual(wrongTop, shared, 'C01 top=space-4 负控必须真实突变源码')
  assert.notEqual(zeroBottom, shared, 'C01 bottom=0 负控必须真实突变源码')
  assert.throws(
    () => assertSharedC1TitleSpacing(zeroTop),
    /space-5/,
  )
  assert.throws(
    () => assertSharedC1TitleSpacing(wrongTop),
    /space-5/,
  )
  assert.throws(
    () => assertSharedC1TitleSpacing(zeroBottom),
    /space-2/,
  )

  const mylike = read('pages/mylike/mylike.wxss')
  assert.throws(
    () => assertNoC1ContentTopSpacing(
      'pages/mylike/mylike.wxss',
      '.favorite-list',
      false,
      `${mylike}\n.favorite-list { margin-top: var(--cy-space-4); }\n`,
    ),
    /不得在共享 space-5 外再叠加/,
  )
})

// ---------------------------------------------------------------------------
// P1-I / P1-J · 命中区与死控件
// ---------------------------------------------------------------------------
test('P1-I: crop bottom-bar actions reach the 88rpx (44pt) hit target', () => {
  const wxss = read('pages/crop/index.wxss')
  const block = wxss.match(/\.crop__action \{[^}]*\}/)
  assert.ok(block)
  assert.match(block[0], /min-height: 88rpx/)
})

test('P1-I negative control: shrinking crop actions below 88rpx changes its exact guard to red', () => {
  const mutated = read('pages/crop/index.wxss').replace('min-height: 88rpx;', 'min-height: 64rpx;')
  const block = mutated.match(/\.crop__action \{[^}]*\}/)
  assert.ok(block)
  assert.throws(() => assert.match(block[0], /min-height: 88rpx/), /88rpx/)
})

// 2026-08-06 主页统一到 cy-profile：旧 userinfo 的 .mer2 / .mer3 头部结构没了，
// 原来靠这两个类名 slice 出「头部」再查空 button。立意不变：
// **整页都不许有看不见但可点的空 <button>**（比只查头部更严）。
test('P1-J: 他人主页不得有看不见但可点的空 button', () => {
  const wxml = read('pages/userinfo/userinfo.wxml')
  assert.ok(wxml.length > 200, '展开后应拿到组件内容，不是一行 <cy-profile />')
  assert.doesNotMatch(wxml, /<button>\s*<\/button>/, '空 <button> 是看不见但可点的死控件')
  assert.doesNotMatch(wxml, /<button[^>]*>\s*<\/button>/, '只带属性、无内容的 button 同样是死控件')
})

test('P1-J negative control: an empty placeholder button is caught', () => {
  const source = read('pages/userinfo/userinfo.wxml')
  // 锚「结构特征」不锚具体某一行：注入一个空 button，主检查必须抓到
  const mutated = source.replace(/<view class="pc-actions">/, '<view class="pc-actions"><button></button>')
  assert.notEqual(mutated, source, '负控必须真实突变源文件')
  assert.throws(
    () => assert.doesNotMatch(mutated, /<button>\s*<\/button>/),
    /button/,
  )
})

// ---------------------------------------------------------------------------
// P1-K · 个人主页深底上的身份徽标必须读得清
// 第3批 UI 复查:"探索动态" tab(赞/踩/评论/分享的动态操作区)已随该 tab 一起下线,
// 相关 userinfo-dynamic-action / C01-R3 A 系列断言随之退场(测的功能已不存在,不是被绕过)。
// ---------------------------------------------------------------------------
test('P1-K: userinfo badge and stat foregrounds use the readable secondary token', () => {
  const wxml = read('pages/userinfo/userinfo.wxml')
  const wxss = read('pages/userinfo/userinfo.wxss')
  // 2026-08-06：旧 .explorer-kicker 随 userinfo 重构没了，等级徽章现在是
  // cy-profile 的 .pc-gamer-lv。约束不变：**用可读的次级文字色，不用品牌紫**
  // （实测重构后它一度是 --cy-color-brand，被这条抓到）。
  const badge = wxss.match(/\.pc-gamer-lv\s*\{[^}]*\}/)
  assert.ok(badge, '等级徽章规则(.pc-gamer-lv)必须存在')
  assert.match(badge[0], /color: var\(--cy-color-text-secondary\)/)
  assert.doesNotMatch(badge[0], /--cy-color-brand/, '等级徽章不许用品牌紫')
  assert.match(badge[0], /font-weight: 600/)

  // 三组统计（好友/关注/粉丝）的标签必须可读。旧结构是 .merchant .mer3 .attr .dd
  // 配三个 .userinfo-meta-icon；新结构是 .pc-stats 里的三个 .pc-statcol。
  assert.equal((wxml.match(/class="pc-statcol"/g) || []).length, 3,
    '身份卡必须有三组统计(好友/关注/粉丝)')
  const statLabel = wxss.match(/\.pc-stat-l\s*\{[^}]*\}/)
  assert.ok(statLabel, '统计标签规则(.pc-stat-l)必须存在')
  assert.doesNotMatch(statLabel[0], /--cy-color-text-(tertiary|disabled)/,
    '统计标签压在深色卡上，用 tertiary/disabled 会掉到 AA 以下')
})

test('P1-K negative control: 把等级徽章改回品牌紫必须判红', () => {
  const source = read('pages/userinfo/userinfo.wxss')
  const mutated = source.replace(
    /(\.pc-gamer-lv\s*\{[^}]*?)color: var\(--cy-color-text-secondary\)/,
    '$1color: var(--cy-color-brand)',
  )
  assert.notEqual(mutated, source, '负控必须真实突变源文件')
  const badge = mutated.match(/\.pc-gamer-lv\s*\{[^}]*\}/)
  assert.ok(badge)
  assert.throws(
    () => assert.doesNotMatch(badge[0], /--cy-color-brand/),
    /cy-color-brand/,   // 红的是**这一道闸**，不是相邻某条同型断言接住的
  )
})

test('P1-K negative control: 把统计标签调暗到 tertiary 必须判红', () => {
  const source = read('pages/userinfo/userinfo.wxss')
  const mutated = source.replace(
    /(\.pc-stat-l\s*\{[^}]*?)color: var\(--cy-color-text-primary\)/,
    '$1color: var(--cy-color-text-tertiary)',
  )
  assert.notEqual(mutated, source, '负控必须真实突变源文件')
  const label = mutated.match(/\.pc-stat-l\s*\{[^}]*\}/)
  assert.ok(label)
  assert.throws(
    () => assert.doesNotMatch(label[0], /--cy-color-text-(tertiary|disabled)/),
    /tertiary/,
  )
})

// ---------------------------------------------------------------------------
// C01-R3 B · 地图的视觉返回钮保持原 64rpx 锚点，外层命中区扩大至 88rpx；
// 搜索占位必须是完整、较短且仍涵盖路线/地点等结果的文案。
// ---------------------------------------------------------------------------
test('C01-R3 B: searchmap keeps its 64rpx visible back control at the original page edge inside an 88rpx hit target', () => {
  const wxml = read('pages/searchmap/index.wxml')
  const wxss = read('pages/searchmap/index.wxss')

  assert.match(wxml, /<view class="smap-back"[^>]*bindtap="goBack"[^>]*aria-role="button"[^>]*aria-label="返回"/)
  assert.match(wxml, /<view class="smap-back-visual">\s*<cy-icon name="back" size="32"/)
  const hitRule = wxss.match(/\.smap-back\s*\{[^}]*\}/)
  assert.ok(hitRule)
  assert.match(hitRule[0], /width: 88rpx/)
  assert.match(hitRule[0], /height: 88rpx/)
  /* UI-14 返修(2026-09-18):返回钮并进顶部 flex 行后,原 absolute + translate 的左上补偿
     改成行左内边距补偿 —— 88rpx 命中盒里的 64rpx 圆居中后左缘会右偏 12rpx,
     减掉 --cy-space-1-5 后仍锚在 --cy-space-4 页面边距上(与右端 filter 到胶囊的间距对称)。 */
  const rowRule = wxss.match(/\.smapso\s*\{[^}]*\}/)
  assert.ok(rowRule)
  assert.match(rowRule[0], /padding-left: calc\(var\(--cy-space-4\) - var\(--cy-space-1-5\)\)/,
    '88rpx 命中盒的 12rpx 左偏必须在行内边距里补掉，否则 64rpx 可见圆钮偏离原 32rpx edge')
  const visualRule = wxss.match(/\.smap-back-visual\s*\{[^}]*\}/)
  assert.ok(visualRule)
  assert.match(visualRule[0], /width: var\(--cy-space-6\)/)
  assert.match(visualRule[0], /height: var\(--cy-space-6\)/)
  assert.match(wxml, /<cy-search[^>]*placeholder="搜索路线、地点等"/,
    '占位须使用完整短文案，不能显示被裁掉的「商」')
})

test('C01-R3 B negative control: shrinking the searchmap back hot zone turns its exact guard red', () => {
  const source = read('pages/searchmap/index.wxss')
  const mutated = source.replace(/(\.smap-back\s*\{[^}]*height:) 88rpx/, '$1 64rpx')
  assert.notEqual(mutated, source, '负控必须实际缩小地图返回的热区')
  const hitRule = mutated.match(/\.smap-back\s*\{[^}]*\}/)
  assert.ok(hitRule)
  assert.throws(() => assert.match(hitRule[0], /height: 88rpx/), /88rpx/)
})

test('C01-R3 B negative control: a visibly truncated search placeholder turns its exact guard red', () => {
  const source = read('pages/searchmap/index.wxml')
  const mutated = source.replace('placeholder="搜索路线、地点等"', 'placeholder="搜索路线、地点、商"')
  assert.notEqual(mutated, source, '负控必须实际把完整占位改回被裁掉的文本')
  assert.throws(() => assert.match(mutated, /placeholder="搜索路线、地点等"/), /placeholder/)
})

test('C01-R3 B negative control: removing the 12rpx row compensation turns the visual-anchor guard red', () => {
  const source = read('pages/searchmap/index.wxss')
  const mutated = source.replace(
    'padding-left: calc(var(--cy-space-4) - var(--cy-space-1-5));',
    'padding-left: var(--cy-space-4);',
  )
  assert.notEqual(mutated, source, '负控必须实际移除行内边距对 64rpx 视觉圆钮 12rpx 左偏的补偿')
  const rowRule = mutated.match(/\.smapso\s*\{[^}]*\}/)
  assert.ok(rowRule)
  assert.throws(
    () => assert.match(rowRule[0], /padding-left: calc\(var\(--cy-space-4\) - var\(--cy-space-1-5\)\)/),
    /padding-left/,
  )
})

// ---------------------------------------------------------------------------
// C01-R3 C · 无 cropInit 时唯一退出必须是居中的、明确的 88rpx 次级返回动作；
// 真实 cropInit 仍由既有 P0 契约保护，不在这里伪造图片输入。
// ---------------------------------------------------------------------------
// ⚠️ 2026-07-31 由整体次级语义拆成按状态两条(不是放宽):.crop__action 这同一个元素
// 在 ready 态是"取消"(纯文字次级动作,右侧并列的 .crop__action--confirm「选取」才是白色
// 实心主 CTA,两者层级靠"有没有底色"区分)、在 missing 态是"返回上一页"(选取按钮 wx:if
// 让其不渲染,本按钮 flex:1 独占整条底栏,是这一屏唯一动作)——同一元素随状态切换语义,
// 不能用单一断言锁死,详见 pages/crop/index.wxss 里两条 --confirm/--return 规则上的注释。
test('C01-R3 C: crop action aria follows its visible state, ready-state cancel stays plain/secondary', () => {
  const wxml = read('pages/crop/index.wxml')
  const wxss = read('pages/crop/index.wxss')

  assert.match(wxml, /class="crop__bar \{\{sourceState === 'missing' \? 'crop__bar--missing' : ''\}\}"/)
  assert.match(wxml, /class="crop__action \{\{sourceState === 'missing' \? 'crop__action--return' : ''\}\}"[^>]*bindtap="onCancel"[^>]*aria-role="button"[^>]*aria-label="\{\{sourceState === 'missing' \? '返回上一页' : '取消'\}\}"/)
  // 「选取」只在真有图时出现:waiting 也不许给,否则点下去会对着空队列导出
  assert.match(wxml, /wx:if="\{\{sourceState === 'ready'\}\}" class="crop__action crop__action--confirm/)

  // ready 态的基类规则(取消/选取共用)必须保持纯文字次级样式:不带任何 background 声明
  const baseRule = wxss.match(/\.crop__action\s*\{[^}]*\}/)
  assert.ok(baseRule)
  assert.match(baseRule[0], /min-height: 88rpx/)
  assert.match(baseRule[0], /color: var\(--cy-color-text-primary\)/)
  assert.doesNotMatch(baseRule[0], /background:/, 'ready 态"取消"不许带底色,否则和右侧「选取」的层级就分不清了')

  // 而右侧「选取」是这一屏的主 CTA,必须是白色实心(与全站 --cy-btn-solid-* 一致)。
  // 两条合起来才是"层级",少任何一边都会退回"两个都是纯文字、分不出主次"。
  const confirmRule = wxss.match(/\.crop__action--confirm\s*\{[^}]*\}/)
  assert.ok(confirmRule, '缺少 .crop__action--confirm 规则')
  assert.match(confirmRule[0], /background: var\(--cy-btn-solid-bg\)/, '「选取」必须是白色实心主 CTA')
  assert.match(confirmRule[0], /color: var\(--cy-btn-solid-fg\)/, '「选取」前景必须用反色 token')
})

test('C01-R3 C negative control: flattening 选取 back to plain text fails the ready-state hierarchy guard', () => {
  const source = read('pages/crop/index.wxss')
  const targetRule = source.match(/\.crop__action--confirm\s*\{[^}]*\}/)
  assert.ok(targetRule, '负控锚点失效:找不到「选取」的规则块')
  const mutatedRule = targetRule[0]
    .replace(/\s*color: var\(--cy-btn-solid-fg\);/, '')
    .replace(/\s*background: var\(--cy-btn-solid-bg\);/, '')
  assert.notEqual(mutatedRule, targetRule[0], '负控必须实际抽掉「选取」的实心底色')
  assert.throws(
    () => {
      assert.match(mutatedRule, /background: var\(--cy-btn-solid-bg\)/)
      assert.match(mutatedRule, /color: var\(--cy-btn-solid-fg\)/)
    },
    /cy-btn-solid/,
  )
})

test('C01-R3 C: missing-source return action is the sole exit and must use solid-white primary semantics', () => {
  const wxss = read('pages/crop/index.wxss')
  const returnRule = wxss.match(/\.crop__bar--missing \.crop__action--return\s*\{[^}]*\}/)
  assert.ok(returnRule)
  assert.match(returnRule[0], /flex: 1/)
  assert.match(returnRule[0], /justify-content: center/)
  assert.match(returnRule[0], /text-align: center/)
  // 用户备注实证:此按钮应与全站白色实心按钮统一(cy-empty/cy-error 的 CTA 同款 token)
  assert.match(returnRule[0], /background: var\(--cy-btn-solid-bg\)/)
  assert.match(returnRule[0], /color: var\(--cy-btn-solid-fg\)/)
})

test('C01-R3 C negative control: a static return aria label violates the visible-state name guard', () => {
  const source = read('pages/crop/index.wxml')
  const mutated = source.replace(
    'aria-label="{{sourceState === \'missing\' ? \'返回上一页\' : \'取消\'}}"',
    'aria-label="返回上一页"',
  )
  assert.notEqual(mutated, source, '负控必须实际把动态可见名称退化为静态返回名称')
  assert.throws(
    () => assert.match(mutated, /aria-label="\{\{sourceState === 'missing' \? '返回上一页' : '取消'\}\}"/),
    /aria-label/,
  )
})

test('C01-R3 C negative control: giving ready-state cancel a background fails the plain/secondary guard', () => {
  const source = read('pages/crop/index.wxss')
  const mutated = source.replace(
    '.crop__action {\n  min-width: var(--cy-btn-pad-x);\n  min-height: 88rpx;\n  display: flex;\n  align-items: center;\n  padding: var(--cy-space-2) var(--cy-space-2);\n  font-size: var(--cy-type-button);\n  color: var(--cy-color-text-primary);\n  border-radius: var(--cy-comp-btn-radius);\n}',
    '.crop__action {\n  min-width: var(--cy-btn-pad-x);\n  min-height: 88rpx;\n  display: flex;\n  align-items: center;\n  padding: var(--cy-space-2) var(--cy-space-2);\n  font-size: var(--cy-type-button);\n  color: var(--cy-color-text-primary);\n  background: var(--cy-btn-solid-bg);\n  border-radius: var(--cy-comp-btn-radius);\n}',
  )
  assert.notEqual(mutated, source, '负控必须实际给 ready 态基类加上一条 background 声明')
  const baseRule = mutated.match(/\.crop__action\s*\{[^}]*\}/)
  assert.ok(baseRule)
  assert.throws(
    () => assert.doesNotMatch(baseRule[0], /background:/),
    /background/,
  )
})

test('C01-R3 C negative control: reverting the missing-source return action to secondary tokens fails the solid guard', () => {
  const source = read('pages/crop/index.wxss')
  // ⚠️ 变异必须锁定 .crop__bar--missing .crop__action--return 这一个规则块再替换:
  // 用全文件 String.replace 只改第一处,而「选取」(.crop__action--confirm)改实心后同样带
  // --cy-btn-solid-*、且排在本规则之前 —— 那样变异会打偏到「选取」上,目标规则原封不动,
  // 负控就永远红不了(2026-07-31 实际踩到)。
  const targetRule = source.match(/\.crop__bar--missing \.crop__action--return\s*\{[^}]*\}/)
  assert.ok(targetRule, '负控锚点失效:找不到无源返回按钮的规则块')
  const mutatedRule = targetRule[0]
    .replace('background: var(--cy-btn-solid-bg);', 'background: var(--cy-comp-btn-secondary-bg);')
    .replace('color: var(--cy-btn-solid-fg);', 'color: var(--cy-comp-btn-secondary-fg);')
  assert.notEqual(mutatedRule, targetRule[0], '负控必须实际把无源返回按钮退回次级 token')
  const mutated = source.replace(targetRule[0], mutatedRule)
  const returnRule = mutated.match(/\.crop__bar--missing \.crop__action--return\s*\{[^}]*\}/)
  assert.ok(returnRule)
  assert.throws(
    () => {
      assert.match(returnRule[0], /background: var\(--cy-btn-solid-bg\)/)
      assert.match(returnRule[0], /color: var\(--cy-btn-solid-fg\)/)
    },
    /cy-btn-solid/,
  )
})

test('C01-R3 C negative control: left-aligning the missing-source return action turns its exact guard red', () => {
  const source = read('pages/crop/index.wxss')
  const mutated = source.replace(
    /\.crop__bar--missing \.crop__action--return\s*\{([^}]*)justify-content: center;/,
    '.crop__bar--missing .crop__action--return {$1justify-content: flex-start;',
  )
  assert.notEqual(mutated, source, '负控必须实际移除无源返回动作的居中布局')
  const returnRule = mutated.match(/\.crop__bar--missing \.crop__action--return\s*\{[^}]*\}/)
  assert.ok(returnRule)
  assert.throws(() => assert.match(returnRule[0], /justify-content: center/), /center/)
})

// ---------------------------------------------------------------------------
// C01-R5 · 广场帖文卡溢出菜单入口(判据见文档 §16):
// 旧形态是低对比位图入口 + 过小命中区;改用既有 cy-icon more + 88rpx 命中区,行为不变。
// ---------------------------------------------------------------------------
const phMoreRule = (wxss) => {
  const m = wxss.match(/\.post-card__more\s*\{[^}]*\}/)
  assert.ok(m, '必须能定位 .post-card__more 规则')
  return m[0]
}
const phMoreTag = (wxml) => {
  const m = wxml.match(/<view class="post-card__more"[\s\S]*?<\/view>/)
  assert.ok(m, '必须能定位 .post-card__more 这个溢出入口')
  return m[0]
}

test('C01-R5: the square feed overflow control is a visible DS icon with a real 88rpx hit target, and still opens showAction', () => {
  const hostWxml = read('pages/square/list/index.wxml')
  const wxml = read('components/cy/post-card/index.wxml')
  const wxss = read('components/cy/post-card/index.wxss')
  const tag = phMoreTag(wxml)
  const rule = phMoreRule(wxss)

  // ① 行为与语义不变
  assert.match(tag, /catchtap="emitMore"/, '溢出入口必须从共享卡派发 more 事件')
  assert.match(hostWxml, /bind:more="showAction"/, '广场必须继续把 more 事件交给 showAction')
  assert.match(read('components/cy/post-card/index.js'), /eventDetail\(\)[\s\S]*index: this\.data\.index/, '共享卡必须仍把 index 交给 showAction')
  assert.match(tag, /aria-role="button"/, '图标钮必须声明 button 角色')
  assert.match(tag, /aria-label="更多操作"/, '图标钮必须有可读名称')

  // ② 用既有 cy-icon more 替掉旧的低对比位图入口
  assert.match(tag, /<cy-icon[^>]*name="more"/, '必须使用既有 cy-icon 的 more 图标')
  assert.equal(/icon_dot\.png/.test(tag.replace(/<!--[\s\S]*?-->/g, '')), false,
    '不得再渲染旧的位图入口')
  assert.ok(declaredIconNames().has('more'), 'cyi--more mask 必须真实存在于 icons.wxss')
  assert.ok(readJson('components/cy/post-card/index.json').usingComponents['cy-icon'],
    '共享帖文卡必须已注册 cy-icon')

  // ③ 命中区 ≥88rpx,且旧的 8rpx 图片盒已撤
  assert.match(rule, /min-width: 88rpx/, '命中区宽必须 ≥88rpx')
  assert.match(rule, /min-height: 88rpx/, '命中区高必须 ≥88rpx')
  assert.doesNotMatch(wxss, /\.post-head \.ph-more image\s*\{[^}]*height: var\(--cy-space-1\)/,
    '旧的过小图片盒必须撤掉')

  // ④ cy-icon 走 currentColor,前景必须钉住(否则删掉 color 也会假绿)
  assert.match(rule, /color: var\(--cy-color-text-secondary\)/, '溢出入口前景必须钉住 secondary token')
})

test('C01-R5 negative control: reintroducing the invisible black bitmap turns the visibility guard red', () => {
  const source = read('components/cy/post-card/index.wxml')
  // 锚点钉结构不钉字面量:原先写死 size="40",2026-09-02 按 Figma 297:1827 把 more 图标
  // 改成 22pt=44rpx,replace 就静默失配 —— 变异没发生、负控照样「通过」,比没有负控更危险。
  const mutated = source.replace(
    /<cy-icon[^>]*name="more"[^>]*\/>/,
    '<image lazy-load="true" src="/pages/square/images/icon_dot.png" mode="widthFix" />',
  )
  assert.notEqual(mutated, source, '负控必须真实把溢出入口改回纯黑位图')
  const tag = phMoreTag(mutated)
  assert.throws(
    () => assert.match(tag, /<cy-icon[^>]*name="more"/, '必须使用既有 cy-icon 的 more 图标'),
    /cy-icon/,
  )
  assert.throws(
    () => assert.equal(/icon_dot\.png/.test(tag.replace(/<!--[\s\S]*?-->/g, '')), false,
      '不得再渲染旧的位图入口'),
    /不得再渲染旧的位图入口/,
  )
})

// C01-R6 · crop 只在真的能裁时才露「选取」:尺寸没读到就置 ready 会让按钮可见但 onConfirm 静默 return。
test('C01-R6: crop only reaches ready once the image size actually resolved', () => {
  const calls = []
  const { page } = loadPage('pages/crop/index.js', {
    deferTimers: true,
    getOpenerEventChannel: () => ({ on: (n, cb) => { if (n === 'cropInit') cb({ paths: ['/tmp/a.jpg'] }) } }),
    wx: { getImageInfo: (opt) => calls.push(opt) },
  })
  page.onLoad()
  assert.equal(calls.length, 1, '必须真的去读图片尺寸')
  assert.notEqual(page.data.sourceState, 'ready', '尺寸未回来之前不得进入 ready(否则「选取」是死钮)')
  assert.equal(page.data.ready, false)

  calls[0].success({ width: 1200, height: 900 })
  assert.equal(page.data.sourceState, 'ready', '尺寸回来后才允许 ready')
  assert.equal(page.data.ready, true, 'sourceState 与 ready 必须同时翻')
})

test('C01-R6 negative control: marking ready before the size resolves turns its exact guard red', () => {
  const source = read('pages/crop/index.js')
  const mutated = source.replace(
    "      sourceState: 'waiting',\n      sourceError: '',\n      exportError: '',\n      ready: false,",
    "      sourceState: 'ready',\n      sourceError: '',\n      exportError: '',\n      ready: false,",
  )
  assert.notEqual(mutated, source, '负控必须真实把加载前的状态改回 ready')
  const { page } = loadPage(null, {
    source: mutated,
    deferTimers: true,
    getOpenerEventChannel: () => ({ on: (n, cb) => { if (n === 'cropInit') cb({ paths: ['/tmp/a.jpg'] }) } }),
    wx: { getImageInfo: () => {} },
  })
  page.onLoad()
  assert.throws(
    () => assert.notEqual(page.data.sourceState, 'ready', '尺寸未回来之前不得进入 ready(否则「选取」是死钮)'),
    /死钮/,
  )
})

// C01-R6 · 分享/扫码直达详情时栈首只有本页,裸 cy-nav-bar 的箭头点不动;整链须有兜底。
test('C01-R6: square/detail hands its nav back to goBack, and the whole chain has a fallback', () => {
  assert.match(read('pages/square/detail/index.wxml'), /<cy-nav-bar custom-back bind:back="goBack" \/>/,
    '详情页必须接管返回')
  assert.match(read('pages/square/detail/index.js'), /goBack\(\)\s*\{[\s\S]*reLaunch\(\{ url: '\/pages\/square\/list\/index' \}\)/,
    '详情 goBack 必须在栈空时回广场列表')
  assert.match(read('pages/square/list/index.js'), /goBack\(\)\s*\{[\s\S]*switchTab\(\{ url: '\/pages\/index\/index' \}\)/,
    '广场列表 goBack 必须再有 home 兜底')
})

test('C01-R6 negative control: leaving the detail nav bar bare turns its exact guard red', () => {
  const mutated = read('pages/square/detail/index.wxml')
    .replace('<cy-nav-bar custom-back bind:back="goBack" />', '<cy-nav-bar />')
  assert.throws(
    () => assert.match(mutated, /<cy-nav-bar custom-back bind:back="goBack" \/>/, '详情页必须接管返回'),
    /详情页必须接管返回/,
  )
})

test('C01-R6 negative control: dropping the overflow foreground token turns its exact guard red', () => {
  const source = read('components/cy/post-card/index.wxss')
  const mutated = source.replace('\n  color: var(--cy-color-text-secondary);', '')
  assert.notEqual(mutated, source, '负控必须真实删掉溢出入口的前景 token')
  const rule = phMoreRule(mutated)
  assert.throws(
    () => assert.match(rule, /color: var\(--cy-color-text-secondary\)/, '溢出入口前景必须钉住 secondary token'),
    /溢出入口前景必须钉住 secondary token/,
  )
})

test('C01-R5 negative control: shrinking the overflow control back under 88rpx turns the hit-target guard red', () => {
  const source = read('components/cy/post-card/index.wxss')
  // 还原成旧形态:去掉 88rpx 命中区,退回原来的 padding 盒
  const mutated = source.replace(
    /\.post-card__more\s*\{[^}]*\}/,
    '.post-card__more { flex-shrink: 0; padding: var(--cy-space-1) 0 var(--cy-space-1) var(--cy-space-2-5); }',
  )
  assert.notEqual(mutated, source, '负控必须真实把命中区缩回旧的 24rpx 盒')
  const rule = phMoreRule(mutated)
  assert.throws(() => assert.match(rule, /min-height: 88rpx/, '命中区高必须 ≥88rpx'), /88rpx/)
  assert.throws(() => assert.match(rule, /min-width: 88rpx/, '命中区宽必须 ≥88rpx'), /88rpx/)
})
