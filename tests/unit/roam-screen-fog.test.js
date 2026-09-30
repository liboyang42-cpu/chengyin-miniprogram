'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertScreenFogContract({ roamWxml, roamWxss, roamJs, mapWxml }) {
  assert.match(roamWxml, /<view class="map-stack">[\s\S]*?<free-map[\s\S]*?<canvas type="2d" id="fogscreen"/,
    '地图外遮罩必须保留离屏 canvas')
  assert.match(roamWxml, /<image wx:for="\{\{fogScreenLayers\}\}" wx:key="version"[\s\S]*?data-generation="\{\{item\.generation\}\}"[\s\S]*?bindload="onFogScreenLoad" binderror="onFogScreenError"/,
    '地图外遮罩 PNG 必须通过普通 image 上屏')
  assert.match(roamWxss, /\.fogscreen\{[^}]*z-index:\s*3;[^}]*pointer-events:\s*none;/s,
    '可见遮罩必须压住地图且不吃点击')
  assert.match(roamWxml, /class="fogscreen-guard" wx:if="\{\{fogScreenGuard\}\}"/,
    '首张遮罩加载前必须用不透明黑层 fail-closed，不能闪出原生文字')
  assert.match(roamWxss, /\.fogscreen-guard\{[^}]*z-index:\s*5;[^}]*background:\s*var\(--cy-color-play-page\);[^}]*pointer-events:\s*none;/s,
    'fail-closed 保护层必须高于 z-index:3 的旧 image，不能被旧圆洞反压')
  assert.match(roamJs, /this\._fogMode = 'screen'/)
  // 限定在 _drawScreenFog 体内:overlay 降级路径(_paintFogBase)也用同一表达式,全文件 match 会被它顶成恒绿
  assert.match(roamJs, /_drawScreenFog\(region\) \{[\s\S]*?fillStyle = 'rgba\(6,6,6,' \+ FOG_ALPHA \+ '\)';\n\s*g\.fillRect\(0, 0, size\.width, size\.height\)/,
    '屏幕遮罩必须走 FOG_ALPHA 统一浓度(2026-08-20 裁决:70% 浓度雾下地图可辨),不得写死全遮或旁路常量')
  assert.match(roamJs, /onFogScreenLoad\(e\)[\s\S]*?version === this\._fogScreenVersion[\s\S]*?fogScreenReady: true/,
    '只有当前世代 image load 成功后才能把遮罩标为 ready')
  const errorMethod = /onFogScreenError\(e\) \{([\s\S]*?)\n  \},\n\n  retryScreenFog/.exec(roamJs)
  assert.ok(errorMethod, '必须保留可审计的 image error 处理器')
  assert.match(errorMethod[1], /fogScreenGuard: true, fogScreenError: true/,
    '当前 image 失败必须 fail-closed 为全黑保护层')
  assert.doesNotMatch(errorMethod[1], /_fogFallbackToPoly\(/,
    'screen image 失败不能回到会浮出原生文字的 map 内 polygon')
  assert.match(roamJs, /onFogScreenLoad\(e\)[\s\S]*?generation !== this\._fogLifecycleGen\) return;/,
    '卸载或复入后的旧 image load 必须被页面世代拦截')
  assert.match(roamJs, /onFogScreenError\(e\)[\s\S]*?generation !== this\._fogLifecycleGen\) return;/,
    '卸载或复入后的旧 image error 必须被页面世代拦截')
  assert.match(roamJs, /'\/roam_screen_fog_' \+ version \+ '\.png'/,
    '并发发布必须用版本文件，不能覆盖仍在显示的 A\/B 固定文件')
  const activation = /_activateRoamAfterFog\(p, startTracking, generation\) \{([\s\S]*?)\n  \},/.exec(roamJs)
  assert.ok(activation, '漫游启动必须在 screen 就绪后统一激活')
  assert.match(activation[1], /this\._fogMode !== 'screen'\) return;/)
  assert.doesNotMatch(activation[1], /_updateFogNow|_flushFogOverlay/,
    'screen 初始化后不得误跑旧 poly\/overlay 更新')
  assert.doesNotMatch(activation[1], /_startClock|_startReal/,
    'canvas context 就绪不等于首张遮罩上屏，不能提前启动计时或持续定位')
  assert.match(roamJs, /onFogScreenLoad\(e\)[\s\S]*?_completeRoamAfterFogLoad\(generation\)/,
    '首张当前世代 image load 必须是漫游计时与持续定位的启动闸')
  assert.match(roamJs, /_completeRoamAfterFogLoad\(generation\)[\s\S]*?fogScreenReady[\s\S]*?_startClock\(\)[\s\S]*?_startReal\(true\)/,
    '只有遮罩 ready 后才允许真正激活漫游')
  assert.match(roamJs, /this\._fogMode = 'blocked';[\s\S]*?fogScreenGuard: true, fogScreenError: true[\s\S]*?_finishFogSetup\(false, generation\)/,
    'screen 初始化失败必须显式 blocked，不能假装旧 map 内雾可用')
  assert.match(roamJs, /onRegionChange\(e\)[\s\S]*?phase === 'begin'[\s\S]*?_guardScreenViewportChange\(\)[\s\S]*?phase !== 'end'[\s\S]*?_guardScreenViewportChange\(\);[\s\S]*?_scheduleScreenFogRender\(\)/,
    '视野 begin 到新 image load 之间必须先全黑，不能让旧圆洞错位漏字')
  assert.match(roamJs, /onPoiTap\(e\)[\s\S]*?if \(this\.data\.fogScreenGuard\) return;[\s\S]*?this\._fogMode === 'screen'[\s\S]*?!isPointRevealed\([\s\S]*?\)\) return;[\s\S]*?req\('\/api\/roam\/checkin'/,
    '黑雾区的隐形原生 POI 必须在请求前被坐标闸拦住')
  assert.match(mapWxml, /enable-poi="\{\{true\}\}"/, '原生 POI 必须保留，否则点到店入口会失效')
  assert.match(roamWxml, /bind:poitap="onPoiTap"/, '原生 POI 点击链路必须保留')
}

test('屏幕雾把经纬度揭雾点投影为圆形洞，并裁掉视野外点', () => {
  const { isPointRevealed, projectRevealCircles } = require('../../utils/roam-screen-fog.js')
  const region = {
    southwest: { latitude: 31.22, longitude: 121.46 },
    northeast: { latitude: 31.24, longitude: 121.48 },
  }
  const circles = projectRevealCircles(region, { width: 400, height: 400 }, [
    { lat: 31.23, lng: 121.47 },
    { lat: 32, lng: 122 },
  ], 55)

  assert.equal(circles.length, 1)
  assert.ok(Math.abs(circles[0].x - 200) < 0.01)
  assert.ok(Math.abs(circles[0].y - 200) < 0.01)
  assert.ok(circles[0].radiusX > 0)
  assert.ok(circles[0].radiusY > 0)
  assert.equal(isPointRevealed({ lat: 31.2302, lng: 121.47 }, [{ lat: 31.23, lng: 121.47 }], 55), true)
  assert.equal(isPointRevealed({ lat: 31.231, lng: 121.47 }, [{ lat: 31.23, lng: 121.47 }], 55), false)
})

test('屏幕雾可在线性预算内投影大量历史点', (t) => {
  const { projectRevealCircles } = require('../../utils/roam-screen-fog.js')
  const region = {
    southwest: { latitude: 31.20, longitude: 121.44 },
    northeast: { latitude: 31.26, longitude: 121.50 },
  }
  const reveals = Array.from({ length: 2000 }, (_, i) => ({
    lat: 31.20 + (i % 100) * 0.0006,
    lng: 121.44 + Math.floor(i / 100) * 0.003,
  }))
  const started = process.hrtime.bigint()
  const circles = projectRevealCircles(region, { width: 430, height: 932 }, reveals, 55)
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  t.diagnostic(`projected=${circles.length},elapsed=${elapsedMs.toFixed(2)}ms`)
  assert.equal(circles.length, 2000)
  assert.ok(elapsedMs < 250, `2000 点投影耗时失控: ${elapsedMs.toFixed(2)}ms`)
})

test('屏幕雾位于原生地图上方但不吃点击，且保留原生 POI 点到店', () => {
  assertScreenFogContract({
    roamWxml: read('pages/roam/index.wxml'),
    roamWxss: read('pages/roam/index.wxss'),
    roamJs: read('pages/roam/index.js'),
    mapWxml: read('components/cy/free-map/index.wxml'),
  })
})

test('负控：遮罩写死全遮、移除 image 或放开雾外 POI 必须判红', () => {
  const base = {
    roamWxml: read('pages/roam/index.wxml'),
    roamWxss: read('pages/roam/index.wxss'),
    roamJs: read('pages/roam/index.js'),
    mapWxml: read('components/cy/free-map/index.wxml'),
  }
  const noImageWxml = base.roamWxml.replace('<image wx:for="{{fogScreenLayers}}"', '<image-removed wx:for="{{fogScreenLayers}}"')
  assert.notEqual(noImageWxml, base.roamWxml, '负控必须真的改到可见 image')
  const noImage = { ...base, roamWxml: noImageWxml }
  const opaque = { ...base, roamJs: base.roamJs.replace("fillStyle = 'rgba(6,6,6,' + FOG_ALPHA + ')'", "fillStyle = '#060606'") }
  assert.notEqual(opaque.roamJs, base.roamJs, '负控必须真的改到 screen 雾填色')
  const blindTap = { ...base, roamJs: base.roamJs.replace('if (!isPointRevealed({ lat: d.latitude, lng: d.longitude }, reveals, REVEAL_M)) return;', '') }
  const blindGuardTap = { ...base, roamJs: base.roamJs.replace('if (this.data.fogScreenGuard) return;', '') }
  const hitLayer = { ...base, roamWxss: base.roamWxss.replace(/(\.fogscreen\{[^}]*pointer-events:)none;/s, '$1auto;') }
  const noBootstrap = { ...base, roamWxml: base.roamWxml.replace('class="fogscreen-guard"', 'class="fogscreen-guard-removed"') }
  const lowBootstrap = { ...base, roamWxss: base.roamWxss.replace('.fogscreen-guard{ position:absolute; inset:0; z-index:5;', '.fogscreen-guard{ position:absolute; inset:0; z-index:3;') }
  assert.notEqual(lowBootstrap.roamWxss, base.roamWxss, '层级负控必须真的把 guard 降到 image 同层')

  assert.throws(() => assertScreenFogContract(noImage), /遮罩 PNG 必须通过普通 image 上屏/)
  assert.throws(() => assertScreenFogContract(opaque), /屏幕遮罩必须走 FOG_ALPHA 统一浓度/)
  assert.throws(() => assertScreenFogContract(blindTap), /隐形原生 POI 必须在请求前被坐标闸拦住/)
  assert.throws(() => assertScreenFogContract(blindGuardTap), /隐形原生 POI 必须在请求前被坐标闸拦住/)
  assert.throws(() => assertScreenFogContract(hitLayer), /可见遮罩必须压住地图且不吃点击/)
  assert.throws(() => assertScreenFogContract(noBootstrap), /首张遮罩加载前必须用不透明黑层/)
  assert.throws(() => assertScreenFogContract(lowBootstrap), /fail-closed 保护层必须高于/)
})
