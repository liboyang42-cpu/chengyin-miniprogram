// C01 Codex fallback 复验：只走真实 reLaunch 与真实点击，不注入 setData/eventChannel/假图片。
// 用法：WX_AUTO_PORT=9648 WX_SHOT_DIR=/abs/output node tests/automator/c01-codex-recheck.js
const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')
const automator = require('miniprogram-automator')
const { closeMiniProgram, patchVersionCheck, waitForLogicLayerOrDisconnect } = require('./harness')

patchVersionCheck()

const PROJECT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.WX_AUTO_PORT) || 9648
const OUT = process.env.WX_SHOT_DIR || '/Users/developer/Desktop/城瘾_UI_第1轮_C01_Codex复验_20260730'
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pageData = async (page, key) => {
  const data = await page.data()
  return data && data[key]
}
const isPortFree = (port) => new Promise((resolve) => {
  const server = net.createServer()
  server.once('error', () => resolve(false))
  server.once('listening', () => server.close(() => resolve(true)))
  server.listen(port, '127.0.0.1')
})

async function launchFixed() {
  const args = ['auto', '--project', PROJECT, '--auto-port', String(PORT), '--trust-project']
  spawn(CLI, args, { stdio: 'ignore', detached: true }).unref()
  const deadline = Date.now() + 30000
  while (Date.now() < deadline && await isPortFree(PORT)) await wait(500)
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` })
  await waitForLogicLayerOrDisconnect(mp, 30, 1000, wait, 5000)
  return mp
}

const routes = [
  ['/pages/index/index', '01-index'],
  ['/pages/square/list/index', '02-square-list'],
  ['/pages/square/detail/index', '03-square-detail-no-id'],
  ['/pages/search2/index', '05-search2'],
  ['/pages/searchmap/index', '06-searchmap'],
  ['/pages/userinfo/userinfo', '08-userinfo'],
  ['/pages/mylike/mylike', '09-mylike'],
  ['/pages/crop/index', '10-crop-no-source'],
]

async function capture(mp, route, name, errors) {
  const errorStart = errors.length
  const page = await mp.reLaunch(route)
  await page.waitFor(1800)
  const file = path.join(OUT, `${name}.png`)
  await mp.screenshot({ path: file })
  return {
    name,
    route,
    landed: await page.path,
    screenshot: file,
    bytes: fs.statSync(file).size,
    consoleErrors: errors.slice(errorStart),
    status: 'CAPTURED',
  }
}

async function captureSearchmapSheet(mp, errors) {
  const route = '/pages/searchmap/index'
  const errorStart = errors.length
  const page = await mp.reLaunch(route)
  let state = await pageData(page, 'listState')
  const deadline = Date.now() + 12000
  while (state === 'loading' && Date.now() < deadline) {
    await page.waitFor(500)
    state = await pageData(page, 'listState')
  }

  const result = {
    name: '11-searchmap-bmshow-sheet',
    route,
    landed: await page.path,
    listState: state,
    status: 'BLOCKED',
    consoleErrors: errors.slice(errorStart),
  }
  if (state !== 'ready' && state !== 'empty') {
    result.limit = `真实列表状态为 ${state}，openList 不会伪造 bmShow。`
    return result
  }

  const trigger = await page.$('.smap-listbtn')
  if (!trigger) {
    result.limit = '未找到真实结果入口，未伪造点击或状态。'
    return result
  }
  await trigger.tap()
  await page.waitFor(700)
  const bmShow = await pageData(page, 'bmShow')
  if (!bmShow) {
    result.limit = '真实点击后 bmShow 仍为 false，未伪造 sheet。'
    return result
  }

  const file = path.join(OUT, `${result.name}.png`)
  await mp.screenshot({ path: file })
  result.screenshot = file
  result.bytes = fs.statSync(file).size
  result.bmShow = bmShow
  result.consoleErrors = errors.slice(errorStart)
  result.status = 'CAPTURED'
  return result
}

;(async () => {
  if (!fs.existsSync(CLI)) throw new Error(`未找到微信开发者工具 CLI: ${CLI}`)
  fs.mkdirSync(OUT, { recursive: true })
  const mp = await launchFixed()
  const errors = []
  const results = []
  mp.on('console', (message) => {
    if (message.type === 'error') errors.push(String(message.args && message.args[0]).slice(0, 200))
  })
  mp.on('exception', (error) => errors.push(`EXC:${String(error && error.message).slice(0, 200)}`))

  try {
    for (const [route, name] of routes) {
      try {
        results.push(await capture(mp, route, name, errors))
      } catch (error) {
        results.push({ name, route, status: 'BLOCKED', error: String(error && error.message || error) })
      }
    }
    try {
      results.push(await captureSearchmapSheet(mp, errors))
    } catch (error) {
      results.push({
        name: '11-searchmap-bmshow-sheet',
        route: '/pages/searchmap/index',
        status: 'BLOCKED',
        error: String(error && error.message || error),
      })
    }
  } finally {
    await closeMiniProgram({ mp })
  }

  const manifest = {
    port: PORT,
    project: PROJECT,
    fakeStateInjection: false,
    results,
  }
  const manifestPath = path.join(OUT, 'manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  for (const result of results) console.log(JSON.stringify(result))
  console.log(`MANIFEST ${manifestPath}`)
  if (results.some((result) => result.status !== 'CAPTURED')) process.exitCode = 2
})().catch((error) => {
  console.error('C01_RECHECK_ERROR', error && error.stack || error)
  process.exit(1)
})
