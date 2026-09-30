const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { maskNonCode } = require('../../scripts/lib/xcx-scan')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function readWxmlTree(relativePath, seen = new Set()) {
  const normalized = path.posix.normalize(relativePath)
  if (seen.has(normalized)) return ''
  seen.add(normalized)
  const source = read(normalized)
  const includes = Array.from(source.matchAll(/<include\b[^>]*\bsrc="([^"]+)"[^>]*\/?\s*>/g), (match) => match[1])
  return source + includes.map((src) => {
    let target = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), src))
    if (!/\.wxml$/.test(target)) target += '.wxml'
    return readWxmlTree(target, seen)
  }).join('\n')
}

function boundHandlers(wxml) {
  return new Set(Array.from(
    wxml.matchAll(/\b(?:bind|catch)(?::[a-z-]+|[a-z-]+)="([^"]+)"/g),
    (match) => match[1],
  ))
}

function methodBody(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'm'),
    new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{`, 'm'),
  ]
  const match = patterns.map((pattern) => pattern.exec(source)).find(Boolean)
  if (!match) return ''

  const start = match.index + match[0].lastIndexOf('{')
  let depth = 0
  let quote = ''
  let lineComment = false
  let blockComment = false
  let escapedChar = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1 }
      continue
    }
    if (quote) {
      if (escapedChar) { escapedChar = false; continue }
      if (char === '\\') { escapedChar = true; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue }
    if (char === '{') depth += 1
    if (char === '}' && (depth -= 1) === 0) return source.slice(start, index + 1)
  }
  return ''
}

function runBackCase(spec, stackLength, transform = (source) => source) {
  const events = []
  const navigation = {
    stackLength,
    wx: {
      navigateBack(options = {}) {
        events.push({ api: 'navigateBack', options })
        if (stackLength === 1 && options.fail) options.fail({ errMsg: 'navigateBack:fail cannot navigate back' })
      },
      switchTab(options) { events.push({ api: 'switchTab', options }) },
      reLaunch(options) { events.push({ api: 'reLaunch', options }) },
      redirectTo(options) { events.push({ api: 'redirectTo', options }) },
    },
  }
  const original = read(spec.file)
  const source = transform(original)
  const methods = {}
  for (const name of spec.methods) {
    const body = methodBody(source, name)
    if (body) Object.assign(methods, vm.runInNewContext(`({${name}() ${body}})`, {
      getCurrentPages: () => Array.from({ length: stackLength }, () => ({})),
      wx: navigation.wx,
      // 券编辑页的离场闸先问脏数据;本用例只验根栈落点,按「无未保存修改」直走返回。
      couponForm: { isDirty: () => false },
    }))
  }
  assert.ok(methods[spec.handler], `${spec.file} 缺少 ${spec.handler}`)
  const context = Object.assign({
    data: Object.assign({ previewVisible: false, mode: 'form', step: 1, clubId: 7 }, spec.data),
    setData(patch) { Object.assign(this.data, patch) },
    refreshStep() {},
    destroyPreviewAudio() {},
  }, spec.instance, methods)
  context[spec.handler]()
  return events
}

const CASES = [
  { file: 'pages/play/index.js', handler: 'previewGoBack', methods: ['previewGoBack'], fallbackApi: 'switchTab', fallbackUrl: '/pages/template/index' },
  { file: 'pages/publish/fabu/index.js', handler: 'goBack', methods: ['goBack', '_exitEditor'], fallbackApi: 'switchTab', fallbackUrl: '/pages/template/index' },
  { file: 'pages/publish/temp/index.js', handler: 'goBack', methods: ['goBack', 'exitPage'], fallbackApi: 'switchTab', fallbackUrl: '/pages/template/index' },
  { file: 'pages/club/apply/index.js', handler: 'onHeaderBack', methods: ['onHeaderBack', 'onBack', 'onExit', 'exitPage'], data: { mode: 'intro' }, fallbackApi: 'switchTab', fallbackUrl: '/pages/talent/list/index' },
  { file: 'pages/club/create/index.js', handler: 'onBack', methods: ['onBack', 'onClose', 'exitPage'], data: { introMode: true }, fallbackApi: 'switchTab', fallbackUrl: '/pages/talent/list/index' },
  { file: 'pages/club/join-requests/index.js', handler: 'goBack', methods: ['goBack'], fallbackApi: 'redirectTo', fallbackUrl: '/pages/club/detail/index?id=7' },
  { file: 'pages/club/enroll/index.js', handler: 'goBack', methods: ['goBack'], fallbackApi: 'redirectTo', fallbackUrl: '/pages/club/detail/index?id=7', requiresCustomNav: true },
  { file: 'pages/topic/pricing/index.js', handler: 'goBack', methods: ['goBack'], data: { topicId: 9 }, fallbackApi: 'redirectTo', fallbackUrl: '/pages/topic/index/index?id=9', requiresCustomNav: true },
  { file: 'pages/topic/merchantapply/index.js', handler: 'onSheetClose', methods: ['onSheetClose', 'goHome'], fallbackApi: 'reLaunch', fallbackUrl: '/pages/merchant/index/index' },
  { file: 'pages/merchant/apply/index.js', handler: 'onHeaderBack', methods: ['onHeaderBack', 'onBack', 'onExit', 'exitPage'], data: { introMode: true }, fallbackApi: 'reLaunch', fallbackUrl: '/pages/merchant/index/index' },
  { file: 'subpackageMember/couponInfo/couponInfo.js', handler: 'onCancel', methods: ['onCancel', 'exitPage'], fallbackApi: 'redirectTo', fallbackUrl: '/subpackageMember/coupon/coupon' },
]

// 2026-09-06 三条向导加了「四步之前的开场屏」后,第一步的返回是退到开场屏、不再离场;
// 真正会离场的是开场屏本身,所以这三条用例的桩数据钉在开场态(见各自 data)。
test('全量页面盘点发现的页面级返回入口：有栈回来源，根栈回所属业务入口', () => {
  for (const spec of CASES) {
    if (spec.requiresCustomNav) {
      const wxml = read(spec.file.replace(/\.js$/, '.wxml'))
      assert.match(wxml, new RegExp(`<cy-nav-bar[^>]*custom-back[^>]*bind:back="${spec.handler}"`), `${spec.file} 顶栏必须复用安全返回方法`)
    }
    const stacked = runBackCase(spec, 2)
    assert.equal(stacked[0].api, 'navigateBack', `${spec.file} 有来源页时必须返回来源`)

    const root = runBackCase(spec, 1)
    const landing = root.find((event) => event.api === spec.fallbackApi)
    assert.ok(landing, `${spec.file} 根栈返回必须落到 ${spec.fallbackApi}`)
    assert.equal(landing.options.url, spec.fallbackUrl, `${spec.file} 根栈返回落点不对`)
  }
})

test('负控：移除任一根栈落点时，页面级返回合同必须判红', () => {
  const spec = CASES[1]
  const events = runBackCase(spec, 1, (source) => source.replace(
    "fail: () => wx.switchTab({ url: '/pages/template/index' })",
    'fail: () => {}',
  ))
  assert.equal(events.some((event) => event.api === spec.fallbackApi), false)
})

function runTeamJoinExit(routes, transform = (source) => source) {
  const events = []
  const source = transform(read('pages/team/join/index.js'))
  const body = methodBody(source, 'goDetail')
  const page = vm.runInNewContext(`({goDetail() ${body}})`, {
    getCurrentPages: () => routes.map((route) => ({ route })),
    wx: {
      navigateBack(options = {}) { events.push({ api: 'navigateBack', options }) },
      redirectTo(options) { events.push({ api: 'redirectTo', options }) },
    },
  })
  page.teamId = '12'
  page.goDetail()
  return JSON.parse(JSON.stringify(events))
}

test('队伍详情进入邀请页后，加入成功返回原详情，不再堆出第二张详情页', () => {
  assert.deepEqual(runTeamJoinExit(['pages/team/detail/index', 'pages/team/join/index']), [
    { api: 'navigateBack', options: { delta: 1 } },
  ])
  assert.deepEqual(runTeamJoinExit(['pages/team/join/index']), [
    { api: 'redirectTo', options: { url: '/pages/team/detail/index?teamId=12' } },
  ])
})

// 2026-09-17 B-06:合作方页(pricing/partner)整页退役,上一条「topicId 存实例状态」契约随页删除。

test('负控：队伍加入成功无条件 redirectTo 时，重复详情页合同必须判红', () => {
  const events = runTeamJoinExit(
    ['pages/team/detail/index', 'pages/team/join/index'],
    (source) => source.replace(/goDetail\(\)\s*\{[\s\S]*?\n\s*\}/, "goDetail() { wx.redirectTo({ url: '/pages/team/detail/index?teamId=' + this.teamId });\n  }"),
  )
  assert.notDeepEqual(events, [{ api: 'navigateBack', options: { delta: 1 } }])
})

function registeredRoutes() {
  const app = JSON.parse(read('app.json'))
  return (app.pages || []).concat((app.subpackages || app.subPackages || []).flatMap((subpackage) => (
    (subpackage.pages || []).map((page) => `${subpackage.root}/${page}`)
  )))
}

function reachableBodies(source, entry) {
  const seen = new Set()
  const bodies = []
  const visit = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    const body = methodBody(source, name)
    if (!body) return
    bodies.push(body)
    for (const call of body.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)) visit(call[1])
  }
  visit(entry)
  return bodies.join('\n')
}

function hasAlternativeRootExit(route, handler, wxml) {
  if (route !== 'pages/merchant/profile/index' || handler !== 'goBack') return false
  return /wx:if="\{\{canBack\}\}"[^>]*bindtap="goBack"/.test(wxml)
    && /bindtap="goHome"/.test(wxml)
}

function findUnsafePageBacks(overrides = {}) {
  const violations = []
  const routes = registeredRoutes()
  let scanned = 0
  for (const route of routes) {
    const jsPath = `${route}.js`
    const wxmlPath = `${route}.wxml`
    if (!fs.existsSync(path.join(ROOT, jsPath)) || !fs.existsSync(path.join(ROOT, wxmlPath))) continue
    scanned += 1
    const source = overrides[jsPath] || read(jsPath)
    const wxml = readWxmlTree(wxmlPath)
    const handlers = boundHandlers(wxml)

    for (const handler of handlers) {
      const closure = reachableBodies(source, handler)
      const executable = maskNonCode(closure)
      if (!/wx\.navigateBack\s*\(/.test(executable)) continue
      if (/wx\.(switchTab|reLaunch|redirectTo)\s*\(/.test(executable)) continue
      if (hasAlternativeRootExit(route, handler, wxml)) continue
      violations.push(`${route}#${handler}`)
    }
  }
  return { routes: routes.length, scanned, violations }
}

test('app.json 全部注册页面的可见返回入口均经过根栈安全审计', () => {
  const audit = findUnsafePageBacks()
  assert.equal(audit.scanned, audit.routes, '每个注册页面都必须有 JS/WXML 并进入返回审计')
  assert.deepEqual(audit.violations, [])
})

test('页面审计递归读取 include，不把分片里的可见动作漏掉', () => {
  const handlers = boundHandlers(readWxmlTree('pages/publish/fabu/index.wxml'))
  assert.ok(handlers.has('saveTicket'), 'step3.wxml 的保存票种动作必须进审计')
  assert.ok(handlers.has('clearLocalDraft'), 'topic-detail-sheet.wxml 的清空草稿动作必须进审计')
})

test('负控：全页面审计能抓住新增的裸 navigateBack', () => {
  const file = 'pages/publish/fabu/index.js'
  const mutated = read(file).replace(
    "fail: () => wx.switchTab({ url: '/pages/template/index' })",
    'fail: () => {}',
  )
  assert.notEqual(mutated, read(file), '负控必须真实移除主题创作页根栈落点')
  assert.ok(findUnsafePageBacks({ [file]: mutated }).violations.includes('pages/publish/fabu/index#goBack'))
})

function runDefaultNavBack(stackLength, transform = (source) => source) {
  let definition = null
  const events = []
  const source = transform(read('components/cy/nav-bar/index.js'))
  vm.runInNewContext(source, {
    Component(config) { definition = config },
    getCurrentPages: () => Array.from({ length: stackLength }, () => ({})),
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } }),
    wx: {
      getMenuButtonBoundingClientRect: () => ({ left: 300, right: 350 }),
      getSystemInfoSync: () => ({ windowWidth: 375 }),
      navigateBack(options = {}) { events.push({ api: 'navigateBack', options }) },
      exitMiniProgram(options = {}) { events.push({ api: 'exitMiniProgram', options }) },
    },
  })
  assert.ok(definition && definition.methods && definition.methods.onBack, '共享导航栏必须声明 onBack')
  definition.methods.onBack.call({
    data: { customBack: false },
    triggerEvent() {},
  })
  return events
}

test('共享导航栏默认返回：有栈回上一页，直达根栈退出小程序而不是强送主页', () => {
  assert.equal(runDefaultNavBack(2)[0].api, 'navigateBack')
  assert.equal(runDefaultNavBack(1)[0].api, 'exitMiniProgram')
})

test('负控：共享导航栏移除根栈出口时必须判红', () => {
  const events = runDefaultNavBack(1, (source) => source.replace(
    'else if (wx.exitMiniProgram) wx.exitMiniProgram();',
    '',
  ))
  assert.equal(events.some((event) => event.api === 'exitMiniProgram'), false)
})
