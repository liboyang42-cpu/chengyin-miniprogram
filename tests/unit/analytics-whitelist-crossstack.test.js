const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sourceInventory = require('../../scripts/mini-program-source-inventory')

const XCX_ROOT = path.join(__dirname, '../..')
const CLIENT_SOURCE = fs.readFileSync(path.join(XCX_ROOT, 'utils/analytics.js'), 'utf8')
const SERVER_PATH = path.join(XCX_ROOT, '../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiAnalyticsController.java')
const SERVER_SOURCE = fs.readFileSync(SERVER_PATH, 'utf8')

function extractClientAllowlist(source) {
  const match = /const ALLOWED_EVENTS = \{([\s\S]*?)\n\};/.exec(source)
  assert.ok(match, '客户端 ALLOWED_EVENTS 解析失败')
  return new Set(Array.from(match[1].matchAll(/^\s*([a-z0-9_]+):\s*true,?\s*$/gm), item => item[1]))
}

function extractServerAllowlist(source) {
  const match = /private static final Set<String> ALLOWED_EVENTS = new HashSet<>\(Arrays\.asList\(([\s\S]*?)\n\s*\)\);/.exec(source)
  assert.ok(match, '服务端 ALLOWED_EVENTS 解析失败')
  return new Set(Array.from(match[1].matchAll(/"([a-z0-9_]+)"/g), item => item[1]))
}

function productionJsFiles() {
  const files = sourceInventory.productionFiles('.js')
  const uncovered = sourceInventory.uncoveredRegisteredSubpackages(files)
  assert.deepEqual(uncovered, [], `生产埋点扫描漏掉 app.json 注册分包: ${uncovered.join(', ')}`)
  return files
}

function literalTrackCalls(sourceOverrides) {
  const calls = new Map()
  const pattern = /(?:analytics\.)?track\(\s*['"]([a-z0-9_]+)['"]/g
  for (const file of productionJsFiles()) {
    const source = sourceOverrides && sourceOverrides.has(file)
      ? sourceOverrides.get(file)
      : fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const event = match[1]
      if (!calls.has(event)) calls.set(event, path.relative(XCX_ROOT, file))
    }
  }
  return calls
}

function assertCrossStackContract(clientSource, serverSource, sourceOverrides) {
  const client = extractClientAllowlist(clientSource)
  const server = extractServerAllowlist(serverSource)
  const missingOnServer = Array.from(client).filter((event) => !server.has(event)).sort()
  assert.deepEqual(missingOnServer, [], `客户端可投递、服务端不接受: ${missingOnServer.join(', ')}`)

  const undeclaredCalls = Array.from(literalTrackCalls(sourceOverrides))
    .filter(([event]) => !client.has(event))
    .map(([event, file]) => `${event}@${file}`)
    .sort()
  assert.deepEqual(undeclaredCalls, [], `生产代码调用了客户端白名单外事件: ${undeclaredCalls.join(', ')}`)
}

test('客户端可投递事件是服务端白名单子集，且生产 track 字面量全部已声明', () => {
  assertCrossStackContract(CLIENT_SOURCE, SERVER_SOURCE)
})

test('负控:客户端新增但服务端未接受的事件必须精确报名转红', () => {
  const mutated = CLIENT_SOURCE.replace('  search_submit: true,', '  zz_client_only_event: true,\n  search_submit: true,')
  assert.notEqual(mutated, CLIENT_SOURCE, '负控锚点失效')
  assert.throws(
    () => assertCrossStackContract(mutated, SERVER_SOURCE),
    /zz_client_only_event/
  )
})

test('负控:任一 app.json 已注册分包新增白名单外埋点必须转红', () => {
  const searchFile = path.join(XCX_ROOT, 'pages/search2/result/index.js')
  const mutated = fs.readFileSync(searchFile, 'utf8') + "\nanalytics.track('zz_unlisted_event')\n"
  assert.throws(
    () => assertCrossStackContract(CLIENT_SOURCE, SERVER_SOURCE, new Map([[searchFile, mutated]])),
    /zz_unlisted_event@pages\/search2\/result\/index\.js/
  )
})
