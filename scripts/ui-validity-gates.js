#!/usr/bin/env node
'use strict'

const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

// 解析层 2026-08-18 搬进 lib/xcx-scan.js(与 U2/U3/U4 共用);本文件只用解析函数,不用判据。
const handlerLint = require('./lib/xcx-scan')
const inventory = require('./mini-program-source-inventory')
const silentErrorAllowlist = require('./ui-silent-error-allowlist')
const stateVisibilityGate = require('./state-visibility-gate')

const REPO_ROOT = path.resolve(inventory.XCX_ROOT, '..')
const JAVA_CONTROLLER_ROOT = path.join(REPO_ROOT, 'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller')
const PAGE_LIFECYCLES = new Set([
  'onLoad', 'onReady', 'onShow', 'onHide', 'onUnload', 'onPullDownRefresh', 'onReachBottom',
  'onShareAppMessage', 'onShareTimeline', 'onAddToFavorites', 'onPageScroll', 'onResize',
  'onTabItemTap', 'onSaveExitState',
])

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function maskWxmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function walkFiles(directory, extension, files) {
  files = files || []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walkFiles(absolute, extension, files)
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute)
  }
  return files
}

function normalizeRoute(route) {
  const normalized = route.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

function quotedValues(text) {
  return Array.from(text.matchAll(/(['"])(.*?)\1/g), (match) => match[2])
}

function javaMappingRoutes(javaSources) {
  const routes = []
  for (const item of javaSources) {
    const source = item.source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
      .replace(/\/\/.*$/gm, '')
    const classMatch = /\b(?:public\s+)?class\s+\w+/.exec(source)
    if (!classMatch) continue
    const beforeClass = source.slice(0, classMatch.index)
    const classMappings = Array.from(beforeClass.matchAll(/@RequestMapping\s*\(([^)]*)\)/g))
    const baseValues = classMappings.length ? quotedValues(classMappings[classMappings.length - 1][1]) : ['']
    const bases = baseValues.length ? baseValues : ['']
    const afterClass = source.slice(classMatch.index)
    const mappingPattern = /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*(?:\(([^)]*)\))?/g
    for (const mapping of afterClass.matchAll(mappingPattern)) {
      const values = mapping[2] === undefined ? [''] : quotedValues(mapping[2])
      const suffixes = values.length ? values : ['']
      for (const base of bases) {
        for (const suffix of suffixes) {
          routes.push({ route: normalizeRoute(base + suffix), file: item.file })
        }
      }
    }
  }
  return routes
}

function miniProgramLiteralUrls(jsSources) {
  const calls = []
  for (const item of jsSources) {
    const source = handlerLint.maskNonCode(item.source)
    const original = item.source
    const pattern = /\burl\s*:\s*(['"])(\/api\/[^'"?#]*)\1/g
    // maskNonCode 会抹掉字符串，故先用原文取 URL，再用同位置的 masked 判断该命中是否在代码中。
    for (const match of original.matchAll(pattern)) {
      const prefix = source.slice(Math.max(0, match.index - 16), match.index + 4)
      if (!/\burl\s*:\s*$/.test(prefix)) continue
      calls.push({ route: normalizeRoute(match[2]), file: item.file, line: lineNumber(original, match.index) })
    }
  }
  return calls
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function routeMatches(frontendRoute, backendRoute) {
  const pattern = backendRoute.split('/').map((segment) => {
    if (/^\{[^/]+\}$/.test(segment)) return '[^/]+'
    return escapeRegex(segment)
  }).join('/')
  return new RegExp(`^${pattern}$`).test(frontendRoute)
}

function findU1Issues(jsSources, javaSources) {
  const backendRoutes = javaMappingRoutes(javaSources)
  const calls = miniProgramLiteralUrls(jsSources)
  const issues = calls.filter((call) => !backendRoutes.some((mapping) => routeMatches(call.route, mapping.route)))
  return { issues, callCount: calls.length, backendRouteCount: backendRoutes.length }
}

function extractOwnHandlerNames(source) {
  const masked = handlerLint.maskNonCode(source)
  const call = /\b(Page|Component)\s*\(/.exec(masked)
  if (!call) return []
  const open = masked.indexOf('{', call.index + call[0].length)
  if (open < 0) return []
  const close = handlerLint.matchBrace(masked, open)
  if (close < 0) return []
  if (call[1] === 'Page') {
    return handlerLint.scanTopLevelKeys(masked, open + 1, close)
      .filter((key) => key.isFunction)
      .map((key) => key.name)
  }
  const body = masked.slice(open + 1, close)
  const methods = /\bmethods\s*:\s*\{/.exec(body)
  if (!methods) return []
  const methodsOpen = open + 1 + methods.index + methods[0].length - 1
  const methodsClose = handlerLint.matchBrace(masked, methodsOpen)
  if (methodsClose < 0) return []
  return handlerLint.scanTopLevelKeys(masked, methodsOpen + 1, methodsClose).map((key) => key.name)
}

function boundHandlerNames(wxmlSource) {
  if (!wxmlSource) return new Set()
  return new Set(handlerLint.findEventBindings(wxmlSource)
    .map((binding) => handlerLint.classifyBinding(binding.value))
    .filter((binding) => binding.kind === 'identifier')
    .map((binding) => binding.name))
}

function findU3Names(jsSource, wxmlSource) {
  const bindings = boundHandlerNames(wxmlSource)
  const masked = handlerLint.maskNonCode(jsSource)
  return extractOwnHandlerNames(jsSource).filter((name) => {
    // 开工计划把 retryReco 点名为既有标本；retry* 虽不在 on/go/tap/handle 四个前缀里，
    // 语义仍是必须由 UI 触发的重试 handler，不能让示例本身落出扫描器。
    if (!/^(?:on|go|tap|handle|retry)(?:[A-Z_$]|$)/.test(name) || PAGE_LIFECYCLES.has(name)) return false
    if (bindings.has(name)) return false
    const references = masked.match(new RegExp(`\\b${escapeRegex(name)}\\b`, 'g')) || []
    return references.length <= 1
  })
}

function topLevelObjectSegments(masked, start, end) {
  const segments = []
  let depth = 0
  let segmentStart = start
  for (let i = start; i < end; i += 1) {
    const c = masked[i]
    if (depth === 0 && c === ',') {
      segments.push([segmentStart, i])
      segmentStart = i + 1
      continue
    }
    if (c === '{' || c === '(' || c === '[') depth += 1
    else if (c === '}' || c === ')' || c === ']') depth -= 1
  }
  segments.push([segmentStart, end])
  return segments
}

function setDataTopLevelFields(source) {
  const masked = handlerLint.maskNonCode(source)
  const fields = new Set()
  const pattern = /\b(?:this|that)\s*\.\s*setData\s*\(\s*\{/g
  for (const match of masked.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf('{')
    const close = handlerLint.matchBrace(masked, open)
    if (close < 0) continue
    for (const [start, end] of topLevelObjectSegments(masked, open + 1, close)) {
      const raw = source.slice(start, end)
      const key = /^\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(raw)
      if (!key) continue
      const fullName = key[2] || key[3]
      const topLevel = fullName.split(/[.\[]/, 1)[0]
      if (/^[A-Za-z_$][\w$]*$/.test(topLevel)) fields.add(topLevel)
    }
  }
  return fields
}

function wxmlConsumesField(wxmlSource, field) {
  if (!wxmlSource) return false
  const source = maskWxmlComments(wxmlSource)
  return new RegExp(`\\b${escapeRegex(field)}\\b`).test(source)
}

function jsConsumesField(jsSource, field) {
  const source = handlerLint.maskNonCode(jsSource)
  const escaped = escapeRegex(field)
  return new RegExp(`\\b(?:this|that)\\s*\\.\\s*data\\s*\\.\\s*${escaped}\\b`).test(source)
    || new RegExp(`\\b(?:this|that)\\s*\\.\\s*data\\s*\\[\\s*['"]${escaped}['"]\\s*\\]`).test(jsSource)
}

function findU4Fields(jsSource, wxmlSource) {
  return Array.from(setDataTopLevelFields(jsSource))
    .filter((field) => !wxmlConsumesField(wxmlSource, field) && !jsConsumesField(jsSource, field))
    .sort()
}

function silentErrorCounts(jsSources) {
  const counts = new Map()
  for (const item of jsSources) {
    const count = (handlerLint.maskNonCode(item.source).match(/\bsilentError\s*:\s*true\b/g) || []).length
    if (count) counts.set(item.file, count)
  }
  return counts
}

function findU5Issues(jsSources, allowlist) {
  const counts = silentErrorCounts(jsSources)
  const entries = new Map()
  const issues = []
  for (const entry of allowlist) {
    if (entries.has(entry.file)) issues.push(`白名单重复:${entry.file}`)
    if (!entry.reason || entry.reason.trim().length < 12) issues.push(`白名单缺少具体原因:${entry.file}`)
    if (!Number.isInteger(entry.count) || entry.count < 1) issues.push(`白名单 count 非正整数:${entry.file}`)
    entries.set(entry.file, entry)
  }
  for (const [file, count] of counts) {
    const entry = entries.get(file)
    if (!entry) issues.push(`未进白名单:${file}(${count} 处)`)
    else if (entry.count !== count) issues.push(`调用数变化:${file}(白名单 ${entry.count},实际 ${count})`)
  }
  for (const entry of allowlist) {
    if (!counts.has(entry.file)) issues.push(`白名单已陈旧:${entry.file}`)
  }
  return { issues, callCount: Array.from(counts.values()).reduce((sum, count) => sum + count, 0), fileCount: counts.size }
}

function readWxmlWithIncludes(wxmlFile, seen) {
  if (!wxmlFile || !fs.existsSync(wxmlFile)) return ''
  seen = seen || new Set()
  if (seen.has(wxmlFile)) return ''
  seen.add(wxmlFile)
  const source = fs.readFileSync(wxmlFile, 'utf8')
  let combined = source
  for (const match of source.matchAll(/<include\s+src="([^"]+)"/g)) {
    combined += `\n${readWxmlWithIncludes(path.resolve(path.dirname(wxmlFile), match[1]), seen)}`
  }
  return combined
}

function resolveBase(repoRoot, execFileSync) {
  repoRoot = repoRoot || REPO_ROOT
  execFileSync = execFileSync || childProcess.execFileSync
  const candidates = [process.env.XCX_UI_GATE_BASE, 'github/master', 'origin/master'].filter(Boolean)
  for (const candidate of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `${candidate}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
      return execFileSync('git', ['merge-base', 'HEAD', candidate], { cwd: repoRoot, encoding: 'utf8' }).trim()
    } catch (_) {
      // 继续尝试下一条远端基线。
    }
  }
  throw new Error('U3/U4 无可用基线：必须 fetch github/master 或 origin/master，禁止静默降级到 HEAD^')
}

// 基线外新增文件的点名册:U3/U4/U6 都会读同一个基线对象,只播报一次。
const ANNOUNCED_BASELINE_MISSING = new Set()

function announceBaselineMissing(relativePath) {
  if (ANNOUNCED_BASELINE_MISSING.has(relativePath)) return
  ANNOUNCED_BASELINE_MISSING.add(relativePath)
  // 明确判定,不是静默跳过:调用方对 null 一律按「新增文件 → 全量扫描」处理。
  console.log(`基线外新增文件(无 diff 基线,按全量扫描):${relativePath}`)
}

function pathInBaseline(base, relativePath, execFileSync) {
  try {
    execFileSync('git', ['cat-file', '-e', `${base}:${relativePath}`], { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch (_) {
    return false
  }
}

// 2026-09-15 假绿收口:这里原来把 `git show` 的任何失败连同 fatal 一起吞成 null,
// 门禁照常打印「通过」并 exit 0 —— 一旦失败原因不是「文件真的新增」,diff 门禁就
// 已经悄悄换了语义,而绿看不出来。现在两类失败必须分开:
//   ① 路径确实不在基线 = 本分支新增文件 → 返回 null,调用方按全量扫描判(不是跳过);
//   ② 基线里明明有这个路径却读不出来(对象缺失 / ref 损坏 / maxBuffer 溢出)= 真错误 → 抛出,
//      拒绝降级放行(与 resolveBase 的「禁止静默降级」同一口径)。
function gitShow(base, relativePath, execFileSync) {
  execFileSync = execFileSync || childProcess.execFileSync
  if (!base) return null
  try {
    return execFileSync('git', ['show', `${base}:${relativePath}`], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (pathInBaseline(base, relativePath, execFileSync)) {
      throw new Error(`读取基线失败(${base}:${relativePath}),门禁拒绝静默降级;先修基线(git fetch github master / git fsck)再重跑。git 原始报错:${error.stderr || error.message}`)
    }
    announceBaselineMissing(relativePath)
    return null
  }
}

function gitReadWxmlWithIncludes(base, relativePath, seen) {
  seen = seen || new Set()
  if (!relativePath || seen.has(relativePath)) return ''
  seen.add(relativePath)
  const source = gitShow(base, relativePath)
  if (!source) return ''
  let combined = source
  for (const match of source.matchAll(/<include\s+src="([^"]+)"/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), match[1]))
    combined += `\n${gitReadWxmlWithIncludes(base, target, seen)}`
  }
  return combined
}

function incrementalUiIssues(jsFiles, base, analyzer) {
  const issues = []
  for (const absolute of jsFiles) {
    const relativeXcx = path.relative(inventory.XCX_ROOT, absolute).split(path.sep).join('/')
    const relativeRepo = `chengyinhub-xcx/${relativeXcx}`
    const currentJs = fs.readFileSync(absolute, 'utf8')
    const currentWxml = readWxmlWithIncludes(absolute.slice(0, -3) + '.wxml')
    if (!currentWxml) continue
    const current = analyzer(currentJs, currentWxml)
    if (!current.length) continue
    const baseJs = gitShow(base, relativeRepo)
    const baseWxml = gitReadWxmlWithIncludes(base, relativeRepo.slice(0, -3) + '.wxml')
    const previous = new Set(baseJs ? analyzer(baseJs, baseWxml) : [])
    for (const name of current) {
      if (!previous.has(name)) issues.push({ file: relativeXcx, name })
    }
  }
  return issues
}

function changedWxmlSince(base) {
  const tracked = childProcess.execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', base, '--', 'chengyinhub-xcx'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  const untracked = childProcess.execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', 'chengyinhub-xcx'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return new Set(`${tracked}\n${untracked}`.split('\n')
    .filter((file) => file.endsWith('.wxml'))
    .map((file) => file.slice('chengyinhub-xcx/'.length)))
}

function findU6Issues(wxmlFiles, base) {
  const changed = changedWxmlSince(base)
  const issues = []
  for (const absolute of wxmlFiles) {
    const relativeXcx = path.relative(inventory.XCX_ROOT, absolute).split(path.sep).join('/')
    if (!changed.has(relativeXcx)) continue
    const relativeRepo = `chengyinhub-xcx/${relativeXcx}`
    const currentSource = fs.readFileSync(absolute, 'utf8')
    const baseSource = gitShow(base, relativeRepo) || ''
    const current = stateVisibilityGate.analyzeWxml(currentSource, relativeXcx)
    const previous = stateVisibilityGate.analyzeWxml(baseSource, relativeXcx)
    issues.push(...stateVisibilityGate.newIssues(current, previous))
  }
  return issues
}

function runSelftest() {
  const javaGood = [{ file: 'ApiDemoController.java', source: '@RequestMapping("/api/demo")\npublic class ApiDemoController { @GetMapping("/{id}") public void get() {} }' }]
  const jsGood = [{ file: 'pages/demo/index.js', source: "Page({ load() { app.sendRequest({ url: '/api/demo/42' }) } })" }]
  assert.equal(findU1Issues(jsGood, javaGood).issues.length, 0)
  const u1Red = findU1Issues([{ file: 'pages/demo/index.js', source: "Page({ load() { app.sendRequest({ url: '/api/missing' }) } })" }], javaGood)
  assert.deepEqual(u1Red.issues.map((issue) => issue.route), ['/api/missing'])

  const handlerJs = 'Page({ retryReco() {}, onLoad() {} })'
  assert.deepEqual(findU3Names(handlerJs, '<view></view>'), ['retryReco'])
  assert.deepEqual(findU3Names(handlerJs, '<button bindtap="retryReco">重试</button>'), [])

  const dataJs = "Page({ load() { this.setData({ reco: [], 'sheet.show': true }) } })"
  assert.deepEqual(findU4Fields(dataJs, '<view wx:if="{{sheet.show}}"></view>'), ['reco'])
  assert.deepEqual(findU4Fields(dataJs, '<view wx:if="{{sheet.show}}">{{reco.length}}</view>'), [])
  const jsOnlyData = "Page({ load() { this.setData({ viewerIsMerchant: true }); return this.data.viewerIsMerchant } })"
  assert.deepEqual(findU4Fields(jsOnlyData, '<view>JS-only state</view>'), [])
  const foreignPageData = "Page({ writeBack() { this._prev.setData({ nodes: [] }) } })"
  assert.deepEqual(findU4Fields(foreignPageData, '<view>cross-page writeback</view>'), [])

  const u5Source = [{ file: 'pages/demo/index.js', source: 'Page({ load() { app.sendRequest({ silentError: true }) } })' }]
  assert.match(findU5Issues(u5Source, []).issues[0], /未进白名单/)
  assert.equal(findU5Issues(u5Source, [{ file: 'pages/demo/index.js', count: 1, reason: '页面已有明确可见错误态承接失败。' }]).issues.length, 0)
  assert.match(findU5Issues(u5Source, [{ file: 'pages/demo/index.js', count: 1, reason: '太短' }]).issues[0], /缺少具体原因/)

  const u6Broken = '<block wx:if="{{state === \'error\'}}"></block><view>{{submitError}}</view>'
  assert.deepEqual(
    stateVisibilityGate.analyzeWxml(u6Broken).map((issue) => issue.rule).sort(),
    ['BLANK_STATE_BRANCH', 'RAW_ERROR_TEXT'],
  )
  assert.deepEqual(
    stateVisibilityGate.analyzeWxml('<cy-error wx:if="{{state === \'error\'}}" sub="{{submitError}}" retry="重试" bind:retry="reload" />'),
    [],
  )

  // 2026-09-15 假绿收口(U3/U4/U6 读基线):git show 的两种失败必须分开,不许一律吞成「新增文件」。
  const fakeGit = (showFails, pathInBase) => (command, args) => {
    assert.equal(command, 'git')
    if (args[0] === 'show') {
      if (!showFails) return 'page {}'
      const failure = new Error('fatal: 基线对象读取失败')
      failure.stderr = 'fatal: 基线对象读取失败'
      throw failure
    }
    if (args[0] === 'cat-file') {
      if (!pathInBase) throw new Error('fatal: Not a valid object name')
      return ''
    }
    return ''
  }
  // 正控:路径确实不在基线 = 新增文件 → null,调用方按全量扫描(明确判定,不是静默跳过)。
  assert.equal(gitShow('base', 'components/cy/new-probe/index.wxml', fakeGit(true, false)), null)
  // 负控:基线里明明有却读不出来 → 必须抛出;吞成 null 就是本文件原病象。
  assert.throws(() => gitShow('base', 'components/cy/old-probe/index.wxml', fakeGit(true, true)), /拒绝静默降级/)
  assert.equal(gitShow('base', 'components/cy/old-probe/index.wxml', fakeGit(false, true)), 'page {}')

  const productionJs = inventory.productionFiles('.js')
  assert.equal(inventory.uncoveredRegisteredSubpackages(productionJs).length, 0)
  console.log('U1 自证通过:伪造不存在的 /api 路径会红，真实 @*Mapping 与路径参数会绿')
  console.log('U3 自证通过:伪造孤儿 retryReco 会红，绑定到 WXML 后复绿')
  console.log('U4 自证通过:伪造 WXML 零消费的 reco 会红，渲染消费后复绿')
  console.log('U5 自证通过:新增未白名单 silentError 会红，精确计数 + 具体原因后复绿')
  console.log('U6 自证通过:空白错误分支与裸错误文案会红，统一错误组件承接后复绿')
  console.log('U3/U4/U6 基线读取自证通过:新增文件按全量扫描(不跳过)，基线对象读不出来必须抛错(不静默降级)')
  console.log('扫描根自证通过:app.json 注册分包全部进入生产 JS 清单')
}

function main() {
  if (process.argv.includes('--selftest')) return runSelftest()

  const jsFiles = inventory.productionFiles('.js')
  const relativeJsSources = jsFiles.map((file) => ({
    file: path.relative(inventory.XCX_ROOT, file).split(path.sep).join('/'),
    source: fs.readFileSync(file, 'utf8'),
  }))
  const uncovered = inventory.uncoveredRegisteredSubpackages(jsFiles)
  const javaSources = walkFiles(JAVA_CONTROLLER_ROOT, '.java').map((file) => ({
    file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
    source: fs.readFileSync(file, 'utf8'),
  }))
  const u1 = findU1Issues(relativeJsSources, javaSources)
  const base = resolveBase()
  const u3 = incrementalUiIssues(jsFiles, base, findU3Names)
  const u4 = incrementalUiIssues(jsFiles, base, findU4Fields)
  const u5 = findU5Issues(relativeJsSources, silentErrorAllowlist)
  const u6 = findU6Issues(inventory.productionFiles('.wxml'), base)

  let failed = false
  if (uncovered.length) {
    failed = true
    uncovered.forEach((root) => console.error(`扫描根遗漏 app.json 已注册分包:${root}`))
  }
  if (u1.issues.length) {
    failed = true
    u1.issues.forEach((issue) => console.error(`U1 FAIL:${issue.file}:${issue.line} ${issue.route} 没有后端 @*Mapping`))
  }
  if (u3.length) {
    failed = true
    u3.forEach((issue) => console.error(`U3 FAIL:${issue.file} 孤儿 handler ${issue.name}（WXML 零绑定且 JS 无调用）`))
  }
  if (u4.length) {
    failed = true
    u4.forEach((issue) => console.error(`U4 FAIL:${issue.file} setData 顶层字段 ${issue.name} 未被 WXML 消费`))
  }
  if (u5.issues.length) {
    failed = true
    u5.issues.forEach((issue) => console.error(`U5 FAIL:${issue}`))
  }
  if (u6.length) {
    failed = true
    u6.forEach((issue) => console.error(`U6 FAIL:${issue.file}:${issue.line} ${issue.rule} ${issue.evidence}`))
  }

  console.log(`U1:${u1.issues.length ? '未通过' : '通过'}（${u1.callCount} 个前端字面量 /api 调用，${u1.backendRouteCount} 个后端映射）`)
  console.log(`U3:${u3.length ? '未通过' : '通过'}（相对 ${base || '无可用基线'} ${u3.length ? `新增 ${u3.length} 个` : '无新增'}孤儿 handler）`)
  console.log(`U4:${u4.length ? '未通过' : '通过'}（相对 ${base || '无可用基线'} ${u4.length ? `新增 ${u4.length} 个` : '无新增'}死 setData 字段）`)
  console.log(`U5:${u5.issues.length ? '未通过' : '通过'}（${u5.fileCount} 文件 / ${u5.callCount} 个调用${u5.issues.length ? `有 ${u5.issues.length} 项白名单问题` : '均精确白名单并说明原因'}）`)
  console.log(`U6:${u6.length ? '未通过' : '通过'}（相对 ${base || '无可用基线'} ${u6.length ? `新增 ${u6.length} 个裸错误/空白状态问题` : '无新增裸错误文案或空白状态分支'}）`)
  console.log(`扫描范围:${jsFiles.length} 个生产 JS，app.json ${inventory.registeredSubpackageRoots().length} 个注册分包全部覆盖`)
  if (failed) process.exit(1)
}

if (require.main === module) main()

module.exports = {
  findU1Issues,
  findU3Names,
  findU4Fields,
  findU5Issues,
  findU6Issues,
  miniProgramLiteralUrls,
  javaMappingRoutes,
  routeMatches,
  setDataTopLevelFields,
  resolveBase,
}
