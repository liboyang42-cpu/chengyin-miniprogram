'use strict'

// DevTools simulator diagnosis only: proves screen-mask rendering and page-handler policy.
// It does not prove Experience Build / real-device native map layering or native POI hit-through.
const assert = require('node:assert/strict')
const path = require('node:path')
const { openMiniProgram, closeMiniProgram } = require('../tests/automator/harness.js')

const projectPath = path.resolve(__dirname, '..')
const port = Number(process.env.DEVTOOLS_AUTO_PORT || 9651)
const screenshotPath = process.env.ROAM_FOG_SCREENSHOT || '/private/tmp/roam-fog-label-layering.png'
const fogColor = process.env.ROAM_FOG_COLOR || '#060606D9'

function rect(south, north, west, east) {
  return {
    points: [
      { latitude: south, longitude: west },
      { latitude: south, longitude: east },
      { latitude: north, longitude: east },
      { latitude: north, longitude: west },
    ],
    fillColor: fogColor,
    strokeColor: '#00000000',
    strokeWidth: 0,
    zIndex: 999,
  }
}

function diagnosticFog(center) {
  if (process.env.ROAM_FOG_HOLE !== '1') {
    return [rect(center.lat - 0.2, center.lat + 0.2, center.lng - 0.2, center.lng + 0.2)]
  }
  const outer = 0.2
  const hole = 0.0025
  return [
    rect(center.lat + hole, center.lat + outer, center.lng - outer, center.lng + outer),
    rect(center.lat - outer, center.lat - hole, center.lng - outer, center.lng + outer),
    rect(center.lat - hole, center.lat + hole, center.lng - outer, center.lng - hole),
    rect(center.lat - hole, center.lat + hole, center.lng + hole, center.lng + outer),
  ]
}

async function main() {
  const session = await openMiniProgram({ projectPath, port, connectAttempts: 100, stackAttempts: 100, retryDelay: 500 })
  const { mp } = session
  try {
    const page = await mp.reLaunch('/pages/roam/index')
    await page.waitFor(3000)

    const center = { lat: 31.2304, lng: 121.4737 }
    if (process.env.ROAM_SCREEN_FOG === '1') {
      await mp.evaluate(() => {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        page._historyReveals = []
        page._reveals = []
      })
      await page.callMethod('_openRoamMap', center, false)
      await page.waitFor(3500)
      await page.callMethod('_renderScreenFog')
      await page.waitFor(1000)
      const readScreenFogState = () => mp.evaluate(() => {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        return {
          anchor: page._fogScreenAnchor || null,
          mode: page._fogMode,
          draws: page._fogScreenDraws || 0,
          circles: page._fogScreenCircleCount || 0,
          bytes: page._fogScreenBytes || 0,
          publishMs: page._fogScreenPublishMs,
          loadMs: page._fogScreenLoadMs,
          region: page._fogScreenLastRegion || null,
          reveals: (page._reveals || []).length,
          error: page._fogScreenErr || '',
          guard: page.data.fogScreenGuard,
          renderError: page.data.fogScreenError,
          scale: page.data.mapScale,
        }
      })
      const state = await readScreenFogState()
      assert.equal(state.mode, 'screen', `正式诊断必须命中地图外屏幕雾主路径: ${JSON.stringify(state)}`)
      assert.ok(state.draws > 0, '屏幕雾必须至少完成一次绘制')
      assert.ok(state.bytes > 0 && state.bytes < 1024 * 1024,
        `单帧 PNG 必须保持在 1MiB 内: ${JSON.stringify(state)}`)
      assert.ok(Number.isFinite(state.publishMs) && state.publishMs <= 200,
        `DevTools 绘制到写盘必须在 200ms 内: ${JSON.stringify(state)}`)
      assert.ok(Number.isFinite(state.loadMs) && state.loadMs <= 1000,
        `DevTools 绘制到 image load 必须在 1000ms 内: ${JSON.stringify(state)}`)
      assert.ok(state.anchor, '玩家揭雾圆必须进入当前地图视野')
      assert.equal(await page.data('fogScreenReady'), true, '屏幕雾绘制后必须上屏')
      assert.equal(state.guard, false, '首帧 image load 后必须撤掉全黑 bootstrap 层')
      assert.equal(state.renderError, false, '成功上屏后不得残留迷雾错误态')
      assert.deepEqual(await page.data('fogPolys'), [], '屏幕雾主路径不得再叠 map polygon')

      await page.callMethod('onRegionChange', { detail: { phase: 'begin', causedBy: 'drag' } })
      assert.equal(await page.data('fogScreenGuard'), true, '视野变化开始必须先全黑，不能沿用错位圆洞')
      await page.callMethod('onRegionChange', { detail: { phase: 'end', causedBy: 'drag', scale: state.scale } })
      await page.waitFor(900)
      assert.equal(await page.data('fogScreenGuard'), false, '当前视野的新 image load 后才可撤过渡黑层')

      await mp.evaluate(() => {
        const app = getApp()
        app.__fogVerifySendRequest = app.sendRequest
        app.__fogVerifyRequests = 0
        app.sendRequest = (options) => {
          app.__fogVerifyRequests += 1
          if (options && options.success) options.success({ data: {} })
        }
      })
      await page.callMethod('onPoiTap', { detail: { name: '雾外点', latitude: center.lat + 0.01, longitude: center.lng } })
      await page.callMethod('onPoiTap', { detail: { name: '已揭点', latitude: center.lat, longitude: center.lng } })
      const poiRequestCount = await mp.evaluate(() => getApp().__fogVerifyRequests || 0)
      assert.equal(poiRequestCount, 1, '雾外 POI 必须被拦，圆洞内 POI 必须继续进入点到店请求链')

      await page.setData({ center: { lat: center.lat, lng: center.lng + 0.001 } })
      await page.waitFor(900)
      await page.callMethod('_renderScreenFog')
      await page.waitFor(700)
      const panned = await readScreenFogState()
      assert.ok(panned.anchor, '小幅平移后揭雾圆仍应留在视野内')
      assert.ok(panned.anchor.x < state.anchor.x, '地图向东平移后，旧揭雾圆必须同步向屏幕左侧移动')

      await page.setData({ center, mapScale: 16 })
      await page.waitFor(900)
      await page.callMethod('_renderScreenFog')
      await page.waitFor(700)
      const zoomedOut = await readScreenFogState()
      assert.ok(zoomedOut.anchor.radiusX < state.anchor.radiusX, '地图缩小时，55m 揭雾圆的屏幕半径必须同步缩小')

      await page.setData({ center, mapScale: 17 })
      await page.waitFor(2500)
      await page.callMethod('_renderScreenFog')
      await page.waitFor(700)
      const finalState = await readScreenFogState()
      await mp.screenshot({ path: screenshotPath })
      console.log(`DevTools simulator screen-fog draws=${finalState.draws} bytes=${finalState.bytes} publishMs=${finalState.publishMs} loadMs=${finalState.loadMs} circles=${finalState.circles} reveals=${finalState.reveals} scale=${finalState.scale} screenshot=${screenshotPath}`)
      return
    }
    const fog = diagnosticFog(center)

    await page.setData({
      screen: 'map',
      center,
      mapScale: 16,
      markers: [],
      polyline: [],
      sparkCircles: [],
      fogPolys: fog,
    })
    await page.waitFor(2000)

    assert.deepEqual(await page.data('markers'), [], '诊断截图必须先清空项目自有 markers')
    assert.ok((await page.data('fogPolys')).length >= 1, '诊断截图必须保留 polygon 雾层')
    await mp.screenshot({ path: screenshotPath })

    console.log(`DevTools simulator diagnostic screenshot=${screenshotPath}`)
  } finally {
    try {
      await mp.evaluate(() => {
        const app = getApp()
        if (app.__fogVerifySendRequest) app.sendRequest = app.__fogVerifySendRequest
        delete app.__fogVerifySendRequest
        delete app.__fogVerifyRequests
      })
    } catch (_) {}
    await closeMiniProgram(session)
  }
}

main().catch((error) => {
  console.error(error && error.stack || error)
  process.exit(1)
})
