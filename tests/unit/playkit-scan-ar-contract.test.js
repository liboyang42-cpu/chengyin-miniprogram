/* 显形档的真 AR(2026-09-22 用户定:平面放置 + 图像识别两种都做)
 *
 * 用户原话:「这个 ar 的效果并没有遵循物理 … 大多数不是需要放到一个平面然后生成的吗
 *          现在看起来就是一张图贴过去了」
 *
 * <camera> 只出画面、不知道手机在空间里怎么动,叠上去的图钉在「屏幕」上。
 * 真 AR 用微信 xr-frame:Plane = 识别地面/桌面、点一下放在那儿;Marker = 认出商家那张实物照片、贴着它长出来。
 *
 * 这里能测的是不依赖真机的部分:模式字符串、卡片尺寸、长出来的曲线、放置/识别事件、宿主的切换与回落。
 * 真机上画面长什么样,只能手机扫预览码看 —— 开发者工具模拟不了 VisionKit。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const AR = 'pages/play/components/playkit-scan/ar/'
const HOST = 'pages/play/components/playkit-scan/'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function load(rel) {
  const abs = path.join(ROOT, rel)
  const prev = { Component: global.Component, Behavior: global.Behavior }
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (c) => c
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prev.Component
    global.Behavior = prev.Behavior
  }
  assert.ok(captured, rel + ' 必须导出组件定义')
  return captured
}

function instanceOf(component, patch) {
  const inst = {
    data: Object.assign({}, component.data, patch || {}),
    properties: {},
    events: [],
    setData(p) { Object.assign(this.data, p) },
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }
  Object.assign(inst.properties, inst.data)
  return Object.assign(inst, component.methods)
}

// ==================== 纯算法 ====================

test('ar-system:平面只开 Plane;识别图开 Plane+Marker(认到后锁进世界空间要靠平面追踪),认不出的一律不开', () => {
  const { arSystemOf } = require('../../' + AR + 'ar-math.js')
  assert.equal(arSystemOf('PLANE'), 'modes:Plane')
  // 官方 xr-template-markerLock:vio + marker 模式下 planeMode 需设为 1(只认水平面)
  assert.equal(arSystemOf('MARKER'), 'modes:Plane Marker; planeMode: 1')
  assert.equal(arSystemOf('NONE'), '')
  assert.equal(arSystemOf('GEO'), '', '认不出就别开')
})

test('卡片按商家那张图的宽高比长,不拉伸', () => {
  const { cardScaleOf } = require('../../' + AR + 'ar-math.js')
  assert.deepEqual(cardScaleOf(800, 400, 0.4), { x: 0.4, z: 0.2 }, '横图')
  assert.deepEqual(cardScaleOf(400, 800, 0.4), { x: 0.4, z: 0.8 }, '竖图')
  assert.deepEqual(cardScaleOf(0, 0, 0.4), { x: 0.4, z: 0.4 }, '图的尺寸还没拿到时按正方形,不给 0 或 NaN')
})

test('长出来:从很小长到原大,先快后慢,到点不再动', () => {
  const { growOf } = require('../../' + AR + 'ar-math.js')
  assert.ok(growOf(0, 500) > 0 && growOf(0, 500) < 0.1, '起点很小但不是 0(0 缩放在部分机型上会被剔除)')
  assert.equal(growOf(500, 500), 1)
  assert.equal(growOf(9999, 500), 1, '到点之后夹在 1')
  const a = growOf(100, 500), b = growOf(200, 500), c = growOf(300, 500)
  assert.ok(a < b && b < c, '单调递增')
  assert.ok((b - a) > (c - b), '先快后慢(ease-out),东西是「长出来」不是匀速放大')
})

// ==================== xr-frame 组件 ====================

test('AR 组件声明 xr-frame 渲染器,场景里不混写 <view>(官方限制)', () => {
  const json = JSON.parse(read(AR + 'index.json'))
  assert.equal(json.component, true)
  assert.equal(json.renderer, 'xr-frame', '不声明渲染器,xr-* 标签一个都不认')
  const wxml = read(AR + 'index.wxml').replace(/<!--[\s\S]*?-->/g, '')   // 注释不是标签
  assert.equal((wxml.match(/<xr-scene\b/g) || []).length, 1, '同一个 xr-frame 组件只能有一个 xr-scene')
  assert.doesNotMatch(wxml, /<view\b|<text\b|<image\b/, 'xr-frame 组件里不支持和传统标签混写 —— 界面放在宿主里')
  assert.match(wxml, /ar-system="\{\{arSystem\}\}"/, '模式由配置决定,挂载时定死(不支持运行中切换)')
  assert.match(wxml, /is-ar-camera/, '相机要交给 AR 系统接管')
  assert.match(wxml, /background="ar"/, '背景是手机摄像头的画面')
})

test('平面模式:点一下屏幕,把东西放到识别出的平面上', () => {
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'PLANE' })
  inst._found = true   // 平面已找到
  const placed = []
  const listeners = {}
  inst.scene = {
    ar: { placeHere: (id, visible) => placed.push([id, visible]) },
    event: { add: (name, fn) => { listeners[name] = fn } },
  }
  inst._bindPlacement()
  assert.ok(listeners.touchstart, '要监听点屏幕')
  listeners.touchstart()
  assert.deepEqual(placed, [['reveal-root', true]], '放到当前平面交点,并显形')
  assert.equal(inst.events.filter((e) => e.name === 'placed').length, 1, '放下了要告诉宿主,好换说明文字')
})

test('平面模式:还没找到平面时点屏幕不放 —— 放了也是飘在半空', () => {
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'PLANE' })
  const placed = []
  const listeners = {}
  inst.scene = { ar: { placeHere: (id) => placed.push(id) }, event: { add: (n, fn) => { listeners[n] = fn } } }
  inst._bindPlacement()
  inst._found = false
  listeners.touchstart()
  assert.equal(placed.length, 0)
})

/* 官方 xr-ar-2dmarker:识别器等 ar-ready 之后才挂(wx:if="{{arReady}}")—— 我们原来素材一加载完就挂,
   AR 系统还没起来,识别器可能从一开始就认不出。 */
test('识别图:识别器等 AR 准备好(ar-ready)才挂;锁定之后卸掉', () => {
  const src = read(AR + 'index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.match(src, /<xr-node wx:if="\{\{loaded && arReady && !markerLocked && mode === 'MARKER'\}\}">\s*<xr-ar-tracker id="marker-tracker" mode="Marker"/)
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'MARKER' })
  inst.handleArReady()
  assert.equal(inst.data.arReady, true)
})

/* 官方 xr-template-markerLock:认到之后把识别器的世界矩阵抄给内容根节点,内容从此钉在现实里 ——
   图挪开、手机转开、识别丢了,东西都还在原地。原来的写法东西挂在识别器下面,一丢识别就消失。 */
test('识别图:认到那一刻把识别器的世界位置抄给内容,内容显形并长出来;只锁一次', () => {
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'MARKER' })
  const M = { tag: 'tracker-world-matrix' }
  const copied = []
  const root = { visible: false, getComponent: () => ({ setLocalMatrix: (m) => copied.push(m) }) }
  const tracker = { getComponent: () => ({ worldMatrix: M }) }
  inst.scene = { getElementById: (id) => (id === 'marker-tracker' ? tracker : null), getNodeById: (id) => (id === 'marker-root' ? root : null) }
  const prevWx = global.wx
  global.wx = { getXrFrameSystem: () => ({ Transform: 'Transform' }) }
  try {
    inst.handleTrackerSwitch({ detail: { value: true } })
    inst.handleTrackerSwitch({ detail: { value: true } })
    assert.equal(inst._lockPending, true)
    inst._lockMarker()
    inst._lockMarker()
  } finally { global.wx = prevWx }
  assert.deepEqual(copied, [M], '只抄一次:锁定后不再跟着识别器走')
  assert.equal(root.visible, true)
  assert.equal(inst.data.markerLocked, true, '锁定后卸掉识别器,不再白白耗电')
  assert.ok(inst._growFrom > 0, '锁定那一刻开始长出来')
  assert.deepEqual(inst.events.filter((e) => e.name === 'tracked').map((e) => e.detail.value), [true], '认到只告诉宿主一次')
})

test('识别图模式:锁定前认丢要告诉宿主;AR 启动失败要报出来,宿主据此回落', () => {
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'MARKER' })
  inst.handleTrackerSwitch({ detail: { value: false } })
  assert.deepEqual(inst.events.filter((e) => e.name === 'tracked').map((e) => e.detail.value), [false])
  inst.handleArError({ detail: { value: new Error('VK 不支持') } })
  assert.equal(inst.events.filter((e) => e.name === 'arerror').length, 1, '启动失败不报 = 玩家对着一块黑屏,永远等不到东西')
})

// ==================== 宿主:切换、说明文字、回落 ====================

test('宿主只在「显形 + 已扫中 + 配了 AR + 手机支持 + 没失败过」时切到 AR', () => {
  const { shouldUseAr } = require('../../' + HOST + 'ar-gate.js')
  const base = { kindKey: '显形', overlayUrl: '/a.png', arMode: 'PLANE', supported: true, arFail: false }
  assert.equal(shouldUseAr(base), true)
  assert.equal(shouldUseAr(Object.assign({}, base, { overlayUrl: '' })), false, '扫中之前还是扫码取景:到店凭证只认码')
  assert.equal(shouldUseAr(Object.assign({}, base, { arMode: 'NONE' })), false, '存量显形配置照旧走屏幕叠加')
  assert.equal(shouldUseAr(Object.assign({}, base, { supported: false })), false, '手机跑不动 AR 就回落')
  assert.equal(shouldUseAr(Object.assign({}, base, { arFail: true })), false, '启动失败过一次就别再撞')
  assert.equal(shouldUseAr(Object.assign({}, base, { kindKey: '图片' })), false)
})

test('宿主:AR 接管时 <camera> 必须先退场(一页只能一个相机,VisionKit 也要用它)', () => {
  const wxml = read(HOST + 'index.wxml')
  const camOpen = (wxml.match(/<view class="sc__cam"[^>]*>/) || [''])[0]
  assert.match(camOpen, /!arLive/, '<camera> 与 AR 同时在,相机被抢,两边都黑')
  assert.match(wxml, /<cy-scan-ar[^>]*wx:if="\{\{arLive\}\}"/, 'AR 组件只在 arLive 时挂')
  const json = JSON.parse(read(HOST + 'index.json'))
  assert.ok(json.usingComponents['cy-scan-ar'], '没注册 = 标签渲染不出来')
})

test('宿主:AR 启动失败回落到屏幕叠加,这一站照样走得完', () => {
  const component = load(HOST + 'index.js')
  const inst = instanceOf(component, { arLive: true, kindKey: '显形', overlayUrl: '/a.png' })
  inst.onArError()
  assert.equal(inst._arFail, true, '失败过是内部状态,走实例字段(wxml 不读的 setData 字段是死数据)')
  assert.equal(inst.data.arLive, false, 'AR 退场,屏幕叠加接手')
})

test('宿主:说明文字跟着阶段走,平面与识别图各说各的', () => {
  const { pillOf } = require('../../' + HOST + 'ar-gate.js')
  assert.equal(pillOf('PLANE', 'finding'), '对着地面慢慢移动手机')
  assert.equal(pillOf('PLANE', 'found'), '点一下屏幕，把它放在这儿')
  assert.equal(pillOf('MARKER', 'finding'), '对准这张图')
  assert.equal(pillOf('PLANE', 'placed'), '', '放下了就把画面让出来,话交给气泡')
  assert.equal(pillOf('MARKER', 'tracked'), '')
  for (const t of ['对着地面慢慢移动手机', '点一下屏幕，把它放在这儿', '对准这张图']) {
    assert.doesNotMatch(t, /[(),:]/, '中文文案禁半角标点(ui-copy-states 门禁)')
  }
})

test('分发器与 view 层把 AR 方式与识别图喂到组件', () => {
  const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js')
  const kit = pickPlayKit({
    sessionId: 1, version: 1,
    playKit: { scan: { kind: 'OVERLAY', scanned: true, overlayUrl: '/a.png', arMode: 'MARKER', markerUrl: '/m.jpg' } },
  }, new Date(2026, 8, 22))
  assert.equal(kit.arMode, 'MARKER')
  assert.equal(kit.markerUrl, '/m.jpg')
  const none = pickPlayKit({ sessionId: 1, version: 1, playKit: { scan: { kind: 'OVERLAY', scanned: true, overlayUrl: '/a.png' } } }, new Date(2026, 8, 22))
  assert.equal(none.arMode, 'NONE', '缺省就是不开,不是 undefined')
  const tag = (() => { const w = read('pages/play/components/playkit/index.wxml'); const s = w.slice(w.indexOf('<cy-playkit-scan ')); return s.slice(0, s.indexOf('/>')) })()
  assert.match(tag, /ar-mode="\{\{kit\.arMode\}\}"/, '分发器不喂 = 组件永远是默认值,零报错')
  assert.match(tag, /marker-url="\{\{kit\.markerUrl\}\}"/)
})

// ==================== 编辑页:商家选 AR 方式、传识别图 ====================

function scanModel(patch) {
  const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
  const model = cfg.defaultConfig()
  model.scan = Object.assign({}, model.scan, { enabled: true, kind: 'OVERLAY', overlayUrl: '/a.png' }, patch || {})
  return { cfg, model }
}

test('编辑页默认形状带上 AR 方式与识别图,缺省是不开', () => {
  const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
  const scan = cfg.defaultConfig().scan
  assert.equal(scan.arMode, 'NONE')
  assert.equal(scan.markerUrl, '')
})

test('编辑页校验与服务端逐字一致:图像识别没配识别图、AR 方式认不出都拦下', () => {
  let { cfg, model } = scanModel({ arMode: 'MARKER', markerUrl: '' })
  assert.equal(cfg.validate(model), '图像识别要配一张识别图', '不在本页拦,作者存得下、发布被后端拒、而且看不到理由')
  ;({ cfg, model } = scanModel({ arMode: 'MARKER', markerUrl: '/m.jpg' }))
  assert.equal(cfg.validate(model), '', '配齐了放行')
  ;({ cfg, model } = scanModel({ arMode: 'PLANE' }))
  assert.equal(cfg.validate(model), '', '平面放置不需要识别图')
  ;({ cfg, model } = scanModel({ arMode: 'GEO' }))
  assert.equal(cfg.validate(model), '显形的 AR 方式只能是不开、平面放置或图像识别')
})

test('从显形换到别的回复形态:AR 方式跟着作废回 NONE,不留一个会被服务端拒的配置', () => {
  // 与切到「只能全屏」的段时清掉 inline 同一个道理:换形态这个作者动作本身让 AR 失效
  const { cfg, model } = scanModel({ kind: 'TEXT', reply: '到了', arMode: 'PLANE' })
  const out = cfg.normalize(model)
  assert.equal(out.scan.arMode, 'NONE')
  assert.equal(cfg.validate(model), '')
})

test('编辑页:显形档里能选 AR 方式,选了图像识别才出识别图输入框', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const block = wxml.slice(wxml.indexOf("advanced.scan.kind === 'OVERLAY'"))
  const overlay = block.slice(0, block.indexOf('</block>'))
  assert.match(overlay, /<cy-dropdown [^>]*range="\{\{scanArModes\}\}" range-key="label"[^>]*bind:change="pickScanArMode"/, 'AR 方式用下拉,不平铺')
  assert.match(overlay, /wx:if="\{\{advanced\.scan\.arMode === 'MARKER'\}\}"/, '识别图只在图像识别时要')
  assert.match(overlay, /data-field="markerUrl"/)
  const js = read('pages/publish/temp/index.js')
  assert.match(js, /scanArModes: \[/)
  for (const key of ['NONE', 'PLANE', 'MARKER']) assert.ok(js.includes("key: '" + key + "'"), '缺选项 ' + key)
  assert.match(js, /pickScanArMode: function/)
})

/* 2026-09-22 用户定:扫码段的两组选项用下拉(同页「玩家人数」那种 cy-dropdown),不要平铺一排点着选的芯片。 */
function loadTempPage() {
  const vm = require('../helpers/ui-sandbox-vm.js')
  const dir = path.join(ROOT, 'pages/publish/temp')
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined })
  let opts
  const sandbox = { Page: (o) => { opts = o }, getApp: () => ({ globalData: {} }), wx: noop, console, setTimeout, clearTimeout,
    getCurrentPages: () => [], require: (r) => require(path.resolve(dir, r)) }
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), sandbox, { filename: path.join(dir, 'index.js') })
  return opts
}

test('编辑页:扫码段两组选项都是下拉,不是平铺芯片', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const start = wxml.indexOf("gameSection === 'scan'")
  const section = wxml.slice(start, wxml.indexOf('<view class="cg-gcfg"', start + 1))
  assert.doesNotMatch(section, /cg-chip/, '扫码段里不该再有平铺芯片')
  assert.match(section, /<cy-dropdown [^>]*range="\{\{scanKinds\}\}" range-key="label"[^>]*bind:change="pickScanKind"/)
  assert.match(section, /<cy-dropdown [^>]*range="\{\{scanArModes\}\}" range-key="label"[^>]*bind:change="pickScanArMode"/)
})

test('编辑页:下拉选第 N 项 = 存第 N 项的 key(存 key 不存中文)', () => {
  const page = loadTempPage()
  const calls = []
  const self = { data: page.data, _setFormState: (patch) => calls.push(patch) }
  page.pickScanKind.call(self, { detail: { value: 3 } })
  page.pickScanArMode.call(self, { detail: { value: 2 } })
  page.pickScanArMode.call(self, { detail: { value: 99 } })
  // 页面在 vm 里跑,patch 是另一个 realm 的对象:过一遍 JSON 再比,只比值
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ 'advanced.scan.kind': 'OVERLAY' }, { 'advanced.scan.arMode': 'MARKER' }, { 'advanced.scan.arMode': 'NONE' }])
})

/* 2026-09-23 用户:「那个重力和吸附呢」。平面模式放下时补三样(AR 通行做法,Apple Quick Look 同款):
   从上方落下、着地轻弹一下;脚下一块软影子;着地那一刻轻震。 */
test('落下:先加速往下掉(重力),在 70% 处着地,再轻弹一下落定;到点之后不再动', () => {
  const { dropOf, DROP_CONTACT } = require('../../' + AR + 'ar-math.js')
  const H = 0.3
  assert.equal(dropOf(0, 600, H).y, H, '起点在正上方 H 处')
  const a = dropOf(100, 600, H).y, b = dropOf(200, 600, H).y, c = dropOf(300, 600, H).y
  assert.ok((H - a) < (a - b) && (a - b) < (b - c), '越落越快 —— 匀速下滑不像重力')
  assert.equal(DROP_CONTACT, 0.7)
  assert.equal(dropOf(600 * DROP_CONTACT, 600, H).y, 0, '着地那一刻贴地')
  const hop = dropOf(600 * 0.85, 600, H).y
  assert.ok(hop > 0 && hop < H * 0.15, '弹一下,但幅度小(不是卡通皮球)')
  assert.equal(dropOf(600, 600, H).y, 0)
  assert.equal(dropOf(99999, 600, H).y, 0, '到点之后夹在地面')
})

/* 官方 xr-template-planeShadow 的透明阴影材质(effect-planeShadow,MIT):地面本身透明,只把影子画出来 ——
   东西落下时影子由真光照算出来,落地那一刻脚下自然合上。上一版是贴一张软影子图,是假的。 */
test('影子:注册官方透明阴影效果;地面接影子、东西投影子、主光开投影', () => {
  const effect = read(AR + 'effect-plane-shadow.js')
  assert.match(effect, /registerEffect\('plane-shadow'/)
  assert.match(effect, /WX_RECEIVE_SHADOW/)
  assert.match(read(AR + 'index.js'), /require\('\.\/effect-plane-shadow\.js'\)/)
  const src = read(AR + 'index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.match(src, /<xr-asset-material asset-id="shadow-mat" effect="plane-shadow"/)
  assert.match(src, /node-id="reveal-ground"[^>]*material="shadow-mat"[^>]*receive-shadow/)
  assert.match(src, /<xr-light type="directional"[^>]*cast-shadow/)
  // 立牌的影子由板子投(第 4 项起图贴在板子正面,有厚度的是板子);有模型时由模型投
  assert.match(src, /node-id="reveal-board"[^>]*cast-shadow/)
  assert.match(src, /node-id="reveal-model"[^>]*cast-shadow/)
  assert.doesNotMatch(src, /shadow\.png/, '贴图假影子撤掉')
  assert.ok(!fs.existsSync(path.join(ROOT, AR + 'shadow.png')))
})

test('落点:平面上的提示是一圈光环图(对齐官方 ar-plane-marker),不是一块白圆片', () => {
  const src = read(AR + 'index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  const plane = /<xr-ar-tracker[^>]*mode="Plane"[\s\S]*?<\/xr-ar-tracker>/.exec(src)[0]
  assert.match(plane, /material="reticle-mat"/)
  assert.doesNotMatch(plane, /geometry="cylinder"/)
  assert.match(src, /<xr-asset-load type="texture" asset-id="reticle" src="[^"]*reticle\.png"/)
  assert.ok(fs.existsSync(path.join(ROOT, AR + 'reticle.png')))
})

test('AR 组件:放下后按 dropOf 落下,着地那一刻只报一次 landed;减弱动效直接落定', () => {
  const js = read(AR + 'index.js')
  assert.match(js, /dropOf\(/)
  assert.match(js, /triggerEvent\('landed'\)/)
  assert.match(js, /reducedMotion/)
  const host = read(HOST + 'index.wxml')
  assert.match(host, /bind:landed="onArLanded"/)
  assert.match(host, /reduced-motion="\{\{reducedMotion\}\}"/)
  const hostJs = read(HOST + 'index.js')
  assert.match(hostJs, /onArLanded\(\)\s*\{\s*motion\.haptic\(\{ reducedMotion: this\.data\.reducedMotion, type: 'light' \}\)/)
})

// ==================== 第 4 项:内容从「一张图」变成「立体」(2026-09-23 用户:看起来假;有模型用模型,没模型退回立牌) ====================

test('模型自动定尺寸:最长边缩到目标大小,底面贴地,居中', () => {
  const { fitModelOf } = require('../../' + AR + 'ar-math.js')
  // 2 米宽、1 米高、底面在 y=0 的模型,目标 0.4 米 → 缩 0.2,不用挪
  assert.deepEqual(fitModelOf({ x: 0, y: 0.5, z: 0 }, { x: 2, y: 1, z: 0.5 }, 0.4), { scale: 0.2, x: 0, y: 0, z: 0 })
  // 模型原点不在脚下(常见):中心 (1,2,3)、边长 1 → 缩 0.5,整体挪回原点且底面贴 y=0
  assert.deepEqual(fitModelOf({ x: 1, y: 2, z: 3 }, { x: 1, y: 1, z: 1 }, 0.5), { scale: 0.5, x: -0.5, y: -0.75, z: -1.5 })
  // 包围盒拿不到(空模型/异常):原样摆,别除以 0
  assert.deepEqual(fitModelOf({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.4), { scale: 1, x: 0, y: 0, z: 0 })
})

test('立牌转向玩家:只取水平方向(永远立着,不前俯后仰);重合时不转', () => {
  const { flatForward } = require('../../' + AR + 'ar-math.js')
  assert.deepEqual(flatForward({ x: 1, y: 1.6, z: 0 }, { x: 0, y: 0, z: 0 }), { x: 1, z: 0 }, '玩家举着手机在高处,牌子也只转水平')
  assert.equal(flatForward({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }), null, '正上方俯视:水平方向是 0,别算出 NaN 让牌子消失')
})

test('编辑页配置:3D 模型只收 .glb;不开 AR 时模型跟着作废', () => {
  let { cfg, model } = scanModel({ arMode: 'PLANE', modelUrl: 'https://cdn/x/cat.glb?Expires=1&Signature=a' })
  assert.equal(cfg.validate(model), '', 'OSS 签名地址带查询串')
  ;({ cfg, model } = scanModel({ arMode: 'PLANE', modelUrl: 'https://cdn/x/cat.fbx' }))
  assert.equal(cfg.validate(model), '3D 模型只支持 .glb')
  ;({ cfg, model } = scanModel({ arMode: 'NONE', modelUrl: 'https://cdn/x/cat.glb' }))
  assert.ok(!('modelUrl' in cfg.normalize(model).scan), '关了 AR 就没有三维空间放它,留着会被服务端拒')
  assert.equal(cfg.defaultConfig().scan.modelUrl, '')
})

test('编辑页:开了 AR 才出「3D 模型」一栏,传 .glb 走统一上传通道,可清掉', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const block = wxml.slice(wxml.indexOf("advanced.scan.kind === 'OVERLAY'"))
  const overlay = block.slice(0, block.indexOf('<view class="cg-cfg-label">扫到的奖励分</view>'))
  assert.match(overlay, /wx:if="\{\{advanced\.scan\.arMode !== 'NONE'\}\}"[\s\S]*3D 模型/)
  assert.match(overlay, /bindtap="uploadScanModel"/)
  assert.match(overlay, /catchtap="clearScanModel"/, '删除钮在槽里:catchtap 不冒泡(同取景轮廓)')
  const js = read('pages/publish/temp/index.js')
  assert.match(js, /uploadScanModel: function[\s\S]*?app\.chooseDocument\([\s\S]*?\['glb'\]\)/, '选会话文件要走 app 的统一通道(隐私闸 + 10MB 前置拒绝)')
  assert.match(js, /clearScanModel: function[\s\S]*?'advanced\.scan\.modelUrl': ''/)
})

test('3D 模型一路喂到 AR 组件:view 层 → 分发器 → 扫码壳 → AR 组件', () => {
  assert.match(read('pages/play/utils/playkit-view.js'), /modelUrl: seg\.modelUrl \|\| ''/)
  assert.match(read('pages/play/components/playkit/index.wxml'), /model-url="\{\{kit\.modelUrl\}\}"/)
  assert.match(read(HOST + 'index.js'), /modelUrl: \{ type: String, value: '' \}/)
  assert.match(read(HOST + 'index.wxml'), /<cy-scan-ar[^>]*model-url="\{\{modelUrl\}\}"/)
})

test('AR 组件:有模型放模型(自带动画、投影子),没模型放有厚度的立牌;两种都在 reveal-body 里一起落下/长出来', () => {
  const src = read(AR + 'index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.match(src, /<xr-asset-load wx:if="\{\{modelUrl\}\}" type="gltf" asset-id="reveal-model" src="\{\{modelUrl\}\}"/)
  assert.equal((src.match(/node-id="reveal-body"/g) || []).length, 2, '平面与识别图各一个')
  assert.equal((src.match(/<xr-gltf node-id="reveal-model" model="reveal-model" anim-autoplay cast-shadow/g) || []).length, 2)
  assert.equal((src.match(/<xr-node wx:if="\{\{!modelUrl\}\}" node-id="reveal-face">/g) || []).length, 2)
  assert.match(src, /node-id="reveal-board" geometry="cube"[^>]*cast-shadow/, '立牌要有厚度:一块薄板打底,图贴在正面')
  assert.match(src, /<xr-camera id="ar-camera"/)
  const js = read(AR + 'index.js')
  assert.match(js, /calcTotalBoundBox\(\)/)
  assert.match(js, /fitModelOf\(/)
  assert.match(js, /Quaternion\.lookRotation\(/, '立牌转向玩家(官方 xr-template-lookat 的做法)')
  assert.match(js, /_transform\('reveal-body'\)/, '落下/长出来动的是 reveal-body,模型与立牌共用')
})

test('AR 组件:模型加载完按包围盒自动定尺寸(平面约 0.4 米,识别图约 0.8 倍图宽)', () => {
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'PLANE', modelUrl: 'https://cdn/cat.glb' })
  const set = {}
  const tf = { scale: { setValue: (...a) => { set.scale = a } }, position: { setValue: (...a) => { set.position = a } } }
  const gltf = { calcTotalBoundBox: () => ({ center: { x: 0, y: 0.5, z: 0 }, size: { x: 2, y: 1, z: 0.5 } }) }
  inst.scene = { getNodeById: (id) => (id === 'reveal-model' ? { getComponent: (C) => (C === 'GLTF' ? gltf : tf) } : null) }
  const prevWx = global.wx
  global.wx = { getXrFrameSystem: () => ({ GLTF: 'GLTF', Transform: 'Transform' }) }
  try { inst._fitModel() } finally { global.wx = prevWx }
  assert.deepEqual(set.scale, [0.2, 0.2, 0.2])
  assert.deepEqual(set.position, [0, 0, 0])
})

// ==================== 自审修复(2026-09-24) ====================

test('宿主:AR 迟迟放不下 / 认不出,15 秒后自动回落屏幕叠加;也可以手动点「看不到?」', () => {
  const js = read(HOST + 'index.js')
  assert.match(js, /const AR_GIVE_UP_MS = 15000/)
  assert.match(js, /this\._arTimer = setTimeout\(\(\) => this\.onArGiveUp\(\), AR_GIVE_UP_MS\)/, '进 AR 就开始计时')
  const wxml = read(HOST + 'index.wxml')
  assert.match(wxml, /bindtap="onArGiveUp"[^>]*aria-role="button"/, '玩家自己也能喊停,不用干等 15 秒')
  assert.match(read(HOST + 'index.wxss'), /\.sc__ar-giveup\s*\{[^}]*pointer-events:\s*auto/, '文字层整体不吃点击,这一颗要单独放开')
  const component = load(HOST + 'index.js')
  const inst = instanceOf(component, { arLive: true, kindKey: '显形', overlayUrl: '/a.png', arMode: 'PLANE' })
  inst.onArGiveUp()
  assert.equal(inst._arFail, true)
  assert.equal(inst.data.arLive, false, '回落到屏幕叠加:图和那句话照样出来,这一站照样过')
})

test('宿主:放下 / 锁定之后就不再计时回落', () => {
  const component = load(HOST + 'index.js')
  for (const done of ['onArPlaced', 'onArTracked']) {
    const inst = instanceOf(component, { arLive: true, arMode: done === 'onArPlaced' ? 'PLANE' : 'MARKER' })
    inst._arTimer = setTimeout(() => { throw new Error('计时器没清,放下之后还会被回落') }, 60000)
    inst[done]({ detail: { value: true } })
    assert.equal(inst._arTimer, null, done + ' 之后计时器要清掉')
  }
})

test('宿主:放下之后平面追踪丢了,说明条也不再冒出来', () => {
  const component = load(HOST + 'index.js')
  const inst = instanceOf(component, { arLive: true, arMode: 'PLANE', arPill: '对着地面慢慢移动手机' })
  inst.onArPlaced()
  inst.onArFound({ detail: { value: false } })
  assert.equal(inst.data.arPill, '', '放下之后画面让给东西,话交给气泡')
})

test('识别图:减弱动效时锁定即落定,不走「长出来」', () => {
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'MARKER', reducedMotion: true })
  const root = { visible: false, getComponent: () => ({ setLocalMatrix: () => {} }) }
  inst.scene = { getElementById: () => ({ getComponent: () => ({ worldMatrix: {} }) }), getNodeById: () => root }
  const prevWx = global.wx
  global.wx = { getXrFrameSystem: () => ({ Transform: 'Transform' }) }
  try { inst._lockMarker() } finally { global.wx = prevWx }
  assert.ok(Date.now() - inst._growFrom >= 520, '起点拨到终点之前:下一帧就是原大')
})

test('识别图:认到先不报 tracked,锁定成功才报;锁定失败不清说明条,下次认到再锁', () => {
  const component = load(AR + 'index.js')
  const inst = instanceOf(component, { mode: 'MARKER' })
  inst.handleTrackerSwitch({ detail: { value: true } })
  assert.deepEqual(inst.events.filter((e) => e.name === 'tracked'), [], '还没锁上就说「认到了」,说明条先没了,画面却是空的')
  inst.scene = { getElementById: () => null, getNodeById: () => null }
  const prevWx = global.wx
  global.wx = { getXrFrameSystem: () => ({ Transform: 'Transform' }) }
  try { inst._lockMarker() } finally { global.wx = prevWx }
  assert.equal(inst._lockPending, false, '锁定失败:放开,下次认到再试')
  assert.deepEqual(inst.events.filter((e) => e.name === 'tracked'), [])
})

test('3D 模型:识别图贴墙时也立着 —— 锁定那一刻把模型扶正(世界竖直),之后不再动', () => {
  const src = read(AR + 'index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.equal((src.match(/<xr-node wx:if="\{\{modelUrl\}\}" node-id="reveal-upright">\s*<xr-gltf node-id="reveal-model"/g) || []).length, 2)
  const js = read(AR + 'index.js')
  assert.match(js, /_lockMarker\(\) \{[\s\S]*?if \(this\.data\.modelUrl\) this\._uprightNext = true/, '下一帧(世界坐标已更新)再扶正')
  assert.match(js, /if \(this\._uprightNext\) \{ this\._uprightNext = false; this\._uprightModel\(\); \}/)
  assert.match(js, /_uprightModel\(\) \{ this\._standUpright\('reveal-upright'\); \}/)
  assert.match(js, /_standUpright\(nodeId\) \{[\s\S]*?Quaternion\.lookRotation\(/, '立牌与模型共用同一套「世界竖直」算法')
})

test('编辑页:显形图占比填 0 也拦下(与服务端一致:20 至 100);清空按默认 60', () => {
  let { cfg, model } = scanModel({ overlayScale: 0 })
  assert.equal(cfg.validate(model), '扫码显形图占比须为 20 至 100')
  ;({ cfg, model } = scanModel({ overlayScale: '' }))
  assert.equal(cfg.normalize(model).scan.overlayScale, 60)
  assert.equal(cfg.validate(model), '')
})

test('没配的显形图 / 识别图 / 3D 模型整键不送:空串会被服务端判成「格式不对」,整份扫码发不出去(同 #1164 C-01)', () => {
  const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
  const model = cfg.defaultConfig()
  model.scan = Object.assign({}, model.scan, { enabled: true, kind: 'TEXT', reply: '到了' })
  const out = cfg.normalize(model).scan
  for (const key of ['overlayUrl', 'markerUrl', 'modelUrl', 'audioUrl', 'imageUrl']) {
    assert.ok(!(key in out), key + ' 是空串却还在,文字档的扫码也会被服务端拒')
  }
  assert.equal(cfg.validate(model), '')
})
