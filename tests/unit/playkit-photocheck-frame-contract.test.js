/* 拍照审核 · 取景轮廓(S1，2026-09-22 现场感三件套)
 *
 * 契约口径三条，各钉一条断言：
 *   ① 轮廓是**题面不是答案** —— 开局就随 requirement 下发，不等 passed；
 *   ② 轮廓是**取景辅助不是判定条件** —— 没配 frameUrl 时玩家行为与今天逐字相同，
 *      取景器起不来 / 轮廓图没加载出来，都必须还能把这一张拍完；
 *   ③ 判定仍然只在服务端按 requirement 判 —— 客户端不算「对齐度」，也不把对齐塞进 shoot。
 * 每条都配一个「构造坏版本必须真红」的负控：绿是廉价的。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const VIEW_REL = 'pages/play/utils/playkit-view.js'
const COMPONENT_REL = 'pages/play/components/playkit-photocheck/index.js'
const COMPONENT_WXML = 'pages/play/components/playkit-photocheck/index.wxml'
const DISPATCH_REL = 'pages/play/components/playkit/index.wxml'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 只喂一个 photoCheck 段，拿玩家端视图。 */
function photoCheckView(seg) {
  const { pickPlayKit } = require(path.join(ROOT, VIEW_REL))
  return pickPlayKit({ sessionId: 's1', version: 1, playKit: { photoCheck: seg } }, new Date(2026, 8, 22, 12))
}

// ==================== ① 视图层透传 ====================

test('★配了取景轮廓就透传到玩家端视图，不透明度缺省四成', () => {
  const out = photoCheckView({
    title: 't', requirement: 'r', frameUrl: '/profile/upload/school_gate.png',
  }).frameUrl
  assert.equal(out, '/profile/upload/school_gate.png')
  const kit = photoCheckView({ title: 't', requirement: 'r', frameUrl: '/profile/a.png' })
  assert.equal(kit.frameOpacity, 40, '商家没填不透明度时按四成，别把 undefined 丢给 style 去乘')
})

test('★不透明度越界夹回 0 至 100，与后端同一口径', () => {
  assert.equal(photoCheckView({ frameUrl: '/a.png', frameOpacity: 999 }).frameOpacity, 100)
  assert.equal(photoCheckView({ frameUrl: '/a.png', frameOpacity: -5 }).frameOpacity, 0)
  assert.equal(photoCheckView({ frameUrl: '/a.png', frameOpacity: '60' }).frameOpacity, 60)
  assert.equal(photoCheckView({ frameUrl: '/a.png', frameOpacity: 'abc' }).frameOpacity, 40)
})

test('★两个键恒产出 —— 分发器绑了 kit.frameUrl，缺一个就是那行绑定静默失效', () => {
  const kit = photoCheckView({ title: 't', requirement: 'r' })
  assert.ok('frameUrl' in kit && 'frameOpacity' in kit, '没配时也要有默认形状:' + Object.keys(kit))
  assert.equal(kit.frameUrl, '', '没配 = 空串，组件靠它判断走不走取景分支')
})

// ==================== ② 组件分支：没配 = 与今天逐字相同 ====================

/** 载入组件定义（stub Component / Behavior），并造一个带 methods 的实例。 */
function loadComponent(abs) {
  const prevComponent = global.Component
  const prevBehavior = global.Behavior
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prevComponent
    global.Behavior = prevBehavior
  }
  assert.ok(captured, abs + ' 必须导出组件定义')
  return captured
}

function instanceOf(component, props) {
  const inst = {
    data: Object.assign({}, component.data, props || {}),
    setData(patch) { Object.assign(this.data, patch) },
  }
  for (const [name, fn] of Object.entries(component.methods || {})) {
    if (typeof fn === 'function') inst[name] = fn.bind(inst)
  }
  return inst
}

/** 装一台只有 chooseMedia 的假 wx，记下都被调了什么。 */
function fakeWx(overrides) {
  const calls = []
  const toasts = []
  const prev = global.wx
  global.wx = Object.assign({
    chooseMedia: (opts) => {
      calls.push('chooseMedia')
      opts.success({ tempFiles: [{ tempFilePath: 'wxfile://picked.jpg', size: 456 }] })
    },
    createCameraContext: () => ({
      takePhoto: (opts) => {
        calls.push('takePhoto')
        opts.success({ tempImagePath: 'wxfile://framed.jpg' })
      },
    }),
    vibrateShort: () => {},
    // 降级路径都要给玩家一句话，假 wx 没有原生 toast 会直接抛，把「该说话」这件事记下来即可
    showToast: (opts) => { toasts.push(opts && opts.title) },
    hideToast: () => {},
  }, overrides || {})
  return { calls, toasts, restore: () => { global.wx = prev } }
}

const COMPONENT_ABS = path.join(ROOT, COMPONENT_REL)

test('★没配 frameUrl 时点快门还是走 wx.chooseMedia，一条没变', () => {
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '' })
  inst.triggerEvent = (name, detail) => { inst.emitted = { name, detail } }
  const wx = fakeWx()
  try {
    inst.onShoot()
  } finally {
    wx.restore()
  }
  assert.deepEqual(wx.calls, ['chooseMedia'], '没配轮廓却动了别的调用:' + wx.calls)
  assert.equal(inst.data.framing, false, '没配轮廓不许进取景层')
  assert.equal(inst.emitted.name, 'shoot')
  assert.deepEqual(Object.keys(inst.emitted.detail).sort(), ['size', 'tempFilePath'],
    'shoot 的载荷形状必须与今天逐字相同')
})

test('★配了 frameUrl 时点快门进取景层，且不去调 chooseMedia', () => {
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png' })
  const wx = fakeWx()
  try {
    inst.onShoot()
  } finally {
    wx.restore()
  }
  assert.equal(inst.data.framing, true, '配了轮廓却没进取景层 —— 那个框等于白配')
  assert.deepEqual(wx.calls, [], '进取景层时不该同时弹系统选图')
})

test('★取景层按快门 → takePhoto → 抛给页面的仍是 tempFilePath', () => {
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png', framing: true })
  inst.triggerEvent = (name, detail) => { inst.emitted = { name, detail } }
  const wx = fakeWx()
  try {
    inst.onFrameShutter()
  } finally {
    wx.restore()
  }
  assert.deepEqual(wx.calls, ['takePhoto'])
  assert.equal(inst.emitted.name, 'shoot')
  assert.equal(inst.emitted.detail.tempFilePath, 'wxfile://framed.jpg')
  assert.equal(inst.data.framing, false, '拍完要退出取景层，否则上传中玩家还对着一个空镜头')
})

test('★取景器起不来（相机被拒 / 设备不支持）：立刻回落 chooseMedia，玩法照常能完成', () => {
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png', framing: true })
  inst.triggerEvent = (name, detail) => { inst.emitted = { name, detail } }
  const wx = fakeWx()
  try {
    inst.onFrameError()
  } finally {
    wx.restore()
  }
  assert.equal(inst.data.framing, false, '镜头起不来还赖在取景层 = 这一张永远拍不了')
  assert.equal(inst.data.camErr, undefined, '取景不可用是实例状态，不进 data(U4 零消费字段门禁)')
  assert.equal(inst._camErr, true, '要记住取景不可用，别下一次又撞一遍')
  assert.deepEqual(wx.calls, ['chooseMedia'], '回落到系统选图，玩家才还有路可走:' + wx.calls)
  assert.equal(inst.emitted.detail.tempFilePath, 'wxfile://picked.jpg')
  assert.ok(String(wx.toasts[0] || '').length > 0, '回落要给玩家一句话:' + wx.toasts)

  // 记性测试:回落过一次后再点快门，不许又去撞同一个坏镜头
  const again = fakeWx()
  try {
    inst.onShoot()
  } finally {
    again.restore()
  }
  assert.deepEqual(again.calls, ['chooseMedia'], 'camErr 之后必须直接走系统选图:' + again.calls)
  assert.equal(inst.data.framing, false)
})

test('★轮廓图自己加载失败：只藏掉那条线，取景与快门照常', () => {
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png', framing: true })
  inst.onOutlineError()
  assert.equal(inst.data.outlineFailed, true)
  assert.equal(inst.data.framing, true, '一张轮廓图没加载出来，不该把玩家踢出取景层')
  inst.triggerEvent = (name, detail) => { inst.emitted = { name, detail } }
  const wx = fakeWx()
  try {
    inst.onFrameShutter()
  } finally {
    wx.restore()
  }
  assert.equal(inst.emitted.detail.tempFilePath, 'wxfile://framed.jpg', '藏线之后快门必须还能拍')
})

test('★过了 / 定局之后不再进取景层', () => {
  for (const flag of [{ passed: true }, { flagged: true }]) {
    const inst = instanceOf(loadComponent(COMPONENT_ABS), Object.assign({ frameUrl: '/profile/a.png' }, flag))
    const wx = fakeWx()
    try {
      inst.onShoot()
    } finally {
      wx.restore()
    }
    assert.equal(inst.data.framing, false, JSON.stringify(flag) + ' 之后还能进取景层 = 能继续交第二张')
    assert.deepEqual(wx.calls, [])
  }
})

// ==================== ③ 渲染与接线（静态契约） ====================

test('★取景层与 cy-play-stage 平级，camera 挂 binderror', () => {
  const wxml = read(COMPONENT_WXML)
  const stageClose = wxml.indexOf('</cy-play-stage>')
  const overlay = wxml.indexOf('<view class="pcv"')
  assert.ok(stageClose > 0 && overlay > stageClose,
    '取景层必须排在台面之后（套在 cy-play-stage 里会被 overflow:hidden 与抖动关键帧压住同层渲染）')
  assert.match(wxml, /<camera[^>]*binderror="onFrameError"/, 'camera 没挂 binderror —— 相机被拒就是静默黑屏')
  assert.match(wxml, /<image[^>]*binderror="onOutlineError"/, '轮廓图没挂 binderror —— 加载失败就永远不画')
})

test('★分发器把 frame-url / frame-opacity 喂给组件', () => {
  const wxml = read(DISPATCH_REL)
  const start = wxml.indexOf('cy-playkit-photocheck')
  const block = wxml.slice(start, wxml.indexOf('bind:shoot', start))
  assert.ok(block.length > 0, '分发器里没有 photocheck 分支')
  assert.match(block, /frame-url="\{\{kit\.frameUrl\}\}"/, 'frameUrl 没绑给组件')
  assert.match(block, /frame-opacity="\{\{kit\.frameOpacity\}\}"/, 'frameOpacity 没绑给组件')
})

test('★客户端不算对齐度：取景不引入任何本地图案判定，shoot 也不带分数', () => {
  const src = read(COMPONENT_REL)
  for (const dead of ['getImageData', 'createOffscreenCanvas', 'scoreOf', 'align', 'threshold']) {
    assert.equal(src.includes(dead), false, dead + ' 出现在取景组件里 —— 对齐度是能被伪造的假判定')
  }
})

test('★商家端没配轮廓时，编辑页存的配置里不出现空 frameUrl', () => {
  const config = require(path.join(ROOT, 'pages/publish/utils/publish/advanced-game-config.js'))
  const model = config.normalize({
    photoCheck: {
      enabled: true, title: '拍一张窗外', requirement: '要拍到窗', maxTries: 3,
      fallback: 'retake', xp: 0, frameUrl: '', frameOpacity: 40,
    },
  })
  assert.equal('frameUrl' in model.photoCheck, false, '空串留在配置里，服务端会判成非法地址')
  assert.equal('frameOpacity' in model.photoCheck, false, '没有轮廓还留一个不透明度 = 存了个没人读的数')
  const kept = config.normalize({
    photoCheck: {
      enabled: true, title: '拍一张窗外', requirement: '要拍到窗', maxTries: 3,
      fallback: 'retake', xp: 0, frameUrl: '/profile/a.png', frameOpacity: 999,
    },
  })
  assert.equal(kept.photoCheck.frameOpacity, 100, '越界值要在落库前夹回合法')
})

// ==================== 负控：坏版本必须真红 ====================

/** 把 playkit-view.js 连同它的依赖抄到临时目录、按 patch 改坏，再 require 回来。 */
function loadPatchedView(patch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-frame-negctl-'))
  const viewAbs = path.join(ROOT, VIEW_REL)
  // 按仓库里的相对位置搭一棵小树:playkit-view 的相对 require(同级 playkit-steps、
  // 上三级 utils/object-card)在临时目录里才解析得到
  const viewDir = path.join(dir, path.dirname(VIEW_REL))
  fs.mkdirSync(viewDir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true })
  fs.copyFileSync(path.join(path.dirname(viewAbs), 'playkit-steps.js'), path.join(viewDir, 'playkit-steps.js'))
  fs.copyFileSync(path.join(ROOT, 'utils/object-card.js'), path.join(dir, 'utils/object-card.js'))
  fs.copyFileSync(path.join(ROOT, 'utils/object-card-reveal.js'), path.join(dir, 'utils/object-card-reveal.js'))
  const target = path.join(viewDir, 'playkit-view.js')
  const original = fs.readFileSync(viewAbs, 'utf8')
  const patched = patch(original)
  assert.notEqual(patched, original, '负控构造失败：这一刀没砍到任何东西，测出来的绿是假的')
  fs.writeFileSync(target, patched)
  try {
    return { mod: require(target), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

test('负控：把 frameUrl 透传那一行删掉，透传断言必须红', () => {
  const { mod, cleanup } = loadPatchedView(
    (src) => src.replace("    frameUrl: seg.frameUrl || '',\n", ''))
  try {
    const kit = mod.pickPlayKit(
      { sessionId: 's1', version: 1, playKit: { photoCheck: { frameUrl: '/profile/a.png' } } },
      new Date(2026, 8, 22, 12))
    assert.equal(kit.frameUrl, undefined,
      '负控失败：删掉透传之后视图里仍然带着 frameUrl —— 上面那条断言根本没在看这一行')
  } finally {
    cleanup()
  }
})

test('负控：去掉不透明度的夹紧，越界值必须能原样漏出去', () => {
  const { mod, cleanup } = loadPatchedView(
    (src) => src.replace('  return Math.max(0, Math.min(100, raw));', '  return raw;'))
  try {
    const kit = mod.pickPlayKit(
      { sessionId: 's1', version: 1, playKit: { photoCheck: { frameUrl: '/a.png', frameOpacity: 999 } } },
      new Date(2026, 8, 22, 12))
    assert.equal(kit.frameOpacity, 999, '负控失败：夹还在，这条负控没构造出坏版本')
  } finally {
    cleanup()
  }
})

test('负控：把取景分支的入口条件拆掉，「配了轮廓进取景层」必须红', () => {
  const src = read(COMPONENT_REL)
  /* 入口条件会随着新守卫加长(2026-09-22 加了 !this.data.inline),所以按**前缀**改写,
     不写死整串 —— 写死的话加一个守卫就把负控弄哑了,而哑掉的负控不会报错。 */
  const stripped = src.replace(/if \(this\.data\.frameUrl && [^)]*\) \{/, 'if (false) {')
  assert.notEqual(stripped, src, '负控构造失败：取景分支的入口已经不是预期形状')
  assert.equal(/if \(this\.data\.frameUrl/.test(stripped), false, '拆完之后还留着同一个入口 —— 上一条断言没真砍')
})

/* ===== code review 追加的三条(2026-09-22)=====
 * 都是「看着接上了、实际会坑玩家」的那一类,单测不写就只能等真机撞。 */

test('★内嵌呈现下不进取景层 —— 故事流段落会把 fixed 的取景器圈进 190rpx 里', () => {
  // .chfull__para 恒带 transform:scale() 与 filter:blur(),非 none 就是 fixed 后代的包含块;
  // photoCheck 不在 PRESENT_FULLSCREEN_ONLY 里,作者确实配得出 present:'inline'。
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png', inline: true })
  inst.triggerEvent = (name, detail) => { inst.emitted = { name, detail } }
  const wx = fakeWx()
  try {
    inst.onShoot()
  } finally {
    wx.restore()
  }
  assert.equal(inst.data.framing, false, '内嵌下进了取景层 —— 真机上它会被圈进段落里还跟着糊')
  assert.deepEqual(wx.calls, ['chooseMedia'], '内嵌下必须回落选图,玩法照常能完成')
})

test('★分发器把 inline 传给拍照审核 —— 不传的话上面那条判据永远是 false', () => {
  assert.match(read(DISPATCH_REL), /cy-playkit-photocheck[\s\S]*?inline="\{\{inline\}\}"/,
    'playkit/index.wxml 没把 inline 传下去,组件里那个判据就是死的')
})

test('★快门在途点「退出取景」不生效 —— 否则照片照样提交、白吃一次机会', () => {
  // takePhoto 已经发出去了,回调必到;这时候放人走 = 玩家以为取消了,服务端 tries 却 +1
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png', framing: true, busy: true })
  inst.onFrameCancel()
  assert.equal(inst.data.framing, true, 'busy 时不许退出取景')
  assert.equal(inst.data.busy, true, 'busy 不该被顺手清掉 —— 清了下一次快门会重入')
  // 不 busy 时照常能退
  const idle = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png', framing: true, busy: false })
  idle.onFrameCancel()
  assert.equal(idle.data.framing, false, '不 busy 时必须退得掉,否则玩家被关在取景器里')
})

test('★快门连着失败两次就回落选图 —— binderror 不响的那些机型只能靠这条', () => {
  // 相机被别的应用占着 / takePhoto 机型不兼容:camera 起得来,binderror 不触发,
  // onFrameError 那条回落路永远够不着。没有这条的话这一段只能弃玩。
  const inst = instanceOf(loadComponent(COMPONENT_ABS), { frameUrl: '/profile/a.png', framing: true })
  inst.triggerEvent = (name, detail) => { inst.emitted = { name, detail } }
  const wx = fakeWx({
    createCameraContext: () => ({
      takePhoto: (opts) => { wxCalls.push('takePhoto'); opts.fail({ errMsg: 'takePhoto:fail' }) },
    }),
  })
  const wxCalls = wx.calls
  try {
    inst.onFrameShutter()
    assert.deepEqual(wx.calls, ['takePhoto'], '第一次失败先让玩家再按一次,不该立刻放弃取景')
    inst.onFrameShutter()
  } finally {
    wx.restore()
  }
  assert.ok(wx.calls.includes('chooseMedia'), '连着两次拍不上仍不回落,玩家被卡在取景器里')
  assert.equal(inst.data.framing, false, '回落后必须退出取景层')
})
