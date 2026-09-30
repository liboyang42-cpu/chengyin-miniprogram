'use strict'

/* 断链 #5 · 今日城市签「保存到相册」
 *
 * 票面右下角那颗钮(index.wxml:105)aria-label 写着「保存签卡到相册」,点下去却只
 * triggerEvent('save') —— 全链路无人接收:玩家点了没反应、没 toast、没图。
 * 修法是把它做成**组件内的本地行为**:canvas 复刻票面 → canvasToTempFilePath → saveImageToPhotosAlbum。
 *
 * 这份契约钉四件事:
 *   ① 那条往父级抛的死线**摘掉了**,不再有人靠它(有测试在,别加回来);
 *   ② 版式装配(_buildSignPoster)与落笔(_drawSignPoster)**分离** —— 装配是纯函数,
 *      不碰 wx / ctx,所以能真测;落笔只消费装配结果,不在里面算排版;
 *   ③ 票面字段/色表/条码数组与 wxml 那张票**同源**(同一批 props、同一批 ds-ok 色值),
 *      保存下来的必须就是刚才看到的那张纸,不是另画一张像的;
 *   ④ 失败反馈分三支齐全:生成失败 toast / 相册没写进去 toast / 拒过授权去 openSetting,
 *      玩家自己取消则**静默**;生成中按钮给禁用态、不许连点。
 *
 * ⚠️ 照片那块:下载或解码没成就是**整块不排**(票面往上收,不留空洞),也**不画假占位**。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const DIR = path.join(ROOT, 'pages/play/components/playkit-dailysign')
const JS = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8')
const WXML = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8')
const WXSS = fs.readFileSync(path.join(DIR, 'index.wxss'), 'utf8')

/** 载入组件定义拿 methods(不把实现复制一份到测试里) */
function load() {
  const abs = path.join(DIR, 'index.js')
  const prevC = global.Component
  const prevB = global.Behavior
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally { global.Component = prevC; global.Behavior = prevB }
  assert.ok(captured && captured.methods, '没认出组件定义')
  return captured
}

const C = load()

const BASE = {
  show: true, dateLabel: '09 / 19', address: '巷口', lines: ['雨天走后门'],
  signer: '阿May', leftAt: '2026-09-18 18:30', serialLabel: 'NO. 0004',
  timeLabel: '20:41', photoUrl: '', claimed: true, revealed: true, saving: false,
  bars: [],
}

/** 确定性尺子:字号 × 0.6 × 字数。产线注入的是 ctx.measureText,同一批断言不依赖字体加载。 */
function measure(text, font) {
  const size = Number((/(\d+(?:\.\d+)?)px/.exec(String(font)) || [])[1] || 28)
  return String(text).length * size * 0.6
}

function page(over) {
  return Object.assign({}, C.methods, {
    data: Object.assign({}, BASE, over || {}),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name) { (this._events || (this._events = [])).push(name) },
  })
}

const of = (poster, type) => poster.blocks.filter((b) => b.type === type)
const typesOf = (poster) => poster.blocks.map((b) => b.type)

/* ── ① 死线摘除 ── */

test('★onSave 不再往父级抛 save —— 那条线全链路无人接收,玩家点了没反应', async () => {
  assert.doesNotMatch(JS, /triggerEvent\(\s*['"]save['"]\s*\)/,
    '又抛回父级了:分发器那条 bind:save 是死线,保存必须是组件内的本地行为')
  const p = page()
  global.wx = fakeWx({})
  await C.methods.onSave.call(p)
  assert.deepEqual(p._events || [], [], '一次事件都不该抛(既不 save 也不 close)')
})

/* ── ③ 票面字段 / 色表 / 条码同源 ── */

test('★票面字段逐项进画布:标题/日期/地址/出票时刻/签号/留签人/留于/那句', () => {
  const poster = C.methods._buildSignPoster.call(page(), measure, false)
  const head = of(poster, 'head')[0]
  assert.equal(head.title, '今日城市签', '标题与 wxml .ds__t 同一句')
  assert.equal(head.date, BASE.dateLabel)

  const od = of(poster, 'od')[0]
  assert.equal(od.pickLabel, '出发')
  assert.equal(od.address, BASE.address)
  assert.equal(od.time, BASE.timeLabel)
  assert.equal(od.serialLabel, BASE.serialLabel)
  assert.equal(od.serialCaption, '你是第几位')

  const cells = of(poster, 'grid')[0].cells
  assert.deepEqual(cells.map((c) => c.k), ['留签人', '留于'])
  assert.equal(cells[0].v, BASE.signer)
  assert.equal(cells[1].v, BASE.leftAt)

  const poem = of(poster, 'poem')[0]
  assert.equal(poem.k, '留给你的一句')
  assert.deepEqual(poem.lines, BASE.lines, 'lines 服务端已断好行,组件不许再按标点重排')
})

test('★票面回落文案与 wxml 逐字一致:没有留签人写「这一站的发起人」、没有时刻写「这一站开场」', () => {
  const poster = C.methods._buildSignPoster.call(page({ signer: '', leftAt: '' }), measure, false)
  const cells = of(poster, 'grid')[0].cells
  assert.equal(cells[0].v, '这一站的发起人')
  assert.equal(cells[1].v, '这一站开场')
  assert.match(WXML, /\{\{signer \|\| '这一站的发起人'\}\}/, 'wxml 改了口径就得同步画布')
  assert.match(WXML, /\{\{leftAt \|\| '这一站开场'\}\}/)
})

test('★色表就是 wxss 里那批标注过的 ds-ok 值 —— 画布读不到 CSS 变量,只能逐字同步', () => {
  const c = C.methods._buildSignPoster.call(page(), measure, false).c
  assert.ok(Object.isFrozen(c), '色表要 freeze(同 PLAY_STORY_CARD 的先例)')
  const same = (key, cls, prop) => {
    assert.ok(new RegExp(cls + '[^}]*' + prop + ':\\s*[^;]*' + c[key] + '\\s*[;)]').test(WXSS),
      key + '(' + c[key] + ') 必须能在 wxss ' + cls + ' 上找到同一个值')
  }
  same('paper', '.ds__slip', 'background')
  same('ink', '.ds__slip', 'color')
  same('faint', '.ds__k', 'color')
  same('rule', '.ds__hr', 'border-top')
  same('poemBg', '.ds__scratch', 'background')
  assert.equal(c.deskTop, '#F6F7F9')
  assert.match(WXSS, /linear-gradient\(180deg, #F6F7F9 0%, #EEF0F3 45%, #E6E8EC 100%\)/,
    '台面三段渐变与 .ds__bg 同一批 stop')
  assert.equal(c.deskMid, '#EEF0F3')
  assert.equal(c.deskBottom, '#E6E8EC')
})

test('★条码用 buildBars 的宽/间隙逐条画:同一张签每次一样,且不溢出票面', () => {
  const withBars = page({ bars: [{ w: 2, g: 2 }, { w: 4, g: 4 }] })
  const bar = of(C.methods._buildSignPoster.call(withBars, measure, false), 'barcode')[0]
  assert.deepEqual(bar.bars, withBars.data.bars, '票面与画布必须用同一个 bars')

  const build = () => C.methods._buildSignPoster.call(page(), measure, false)
  const bars = of(build(), 'barcode')[0].bars
  assert.equal(bars.length, 46, 'bars 还没到时按签号补出 46 根,底部不许留一段空白')
  assert.deepEqual([...new Set(bars.map((b) => b.w))].sort(), [2, 4, 6])
  assert.deepEqual([...new Set(bars.map((b) => b.g))].sort(), [2, 4])
  assert.deepEqual(bars, of(build(), 'barcode')[0].bars, '同一签号必须长一样(种子生成,不是随机)')
  assert.notDeepEqual(bars,
    of(C.methods._buildSignPoster.call(page({ serialLabel: 'NO. 0005' }), measure, false), 'barcode')[0].bars,
    '换一张签就该换一条码')

  for (const b of [bar, of(build(), 'barcode')[0]]) {
    const total = b.bars.reduce((acc, x) => acc + (x.w + x.g) * b.scale, 0)
    assert.ok(total <= b.maxW + 0.5, '条码总宽必须收得进 ' + b.maxW + ' 单位,溢出就是被裁掉的假条码')
  }
})

/* ── ② 装配与落笔分离 + 版式自洽 ── */

test('★装配是纯函数:不碰 wx、不 setData、不读 canvas', () => {
  const body = /_buildSignPoster\(measure, hasPhoto\)\s*\{[\s\S]*?\n    \},/.exec(JS)
  assert.ok(body, '找不到 _buildSignPoster(measure, hasPhoto)')
  assert.doesNotMatch(body[0], /\bwx\./, '装配里出现 wx = 测不了')
  assert.doesNotMatch(body[0], /setData/)
  assert.doesNotMatch(body[0], /getContext/)
})

test('★落笔只消费装配结果:不再量文字、不再算排版', () => {
  const body = /_drawSignPoster\(entry, poster, photo\)\s*\{[\s\S]*?\n    \},/.exec(JS)
  assert.ok(body, '找不到 _drawSignPoster(entry, poster, photo)')
  assert.doesNotMatch(body[0], /measureText/)
  assert.doesNotMatch(body[0], /_buildSignPoster/)
})

test('区块自上而下不重叠、全部落在纸内,纸落在台面内', () => {
  const poster = C.methods._buildSignPoster.call(page({ address: '巷口那家豆浆七点才开，别去早了' }), measure, false)
  assert.equal(poster.w, 750, '1 画布单位 = 1rpx,与 wxss 同一把尺')
  assert.ok(poster.dpr >= 2, '导出至少 2 倍,存进相册的图不能糊')
  assert.ok(poster.paper.x > 0 && poster.paper.x + poster.paper.w <= poster.w)
  assert.ok(poster.paper.y + poster.paper.h + 40 <= poster.h, '纸下沿要留出台面,否则锯齿被裁掉')
  let prevEnd = poster.paper.y
  for (const b of poster.blocks) {
    assert.ok(b.y >= prevEnd - 0.01, b.type + ' 与上一块重叠')
    assert.ok(b.h > 0, b.type + ' 高度为 0 就是隐形空洞')
    assert.ok(b.y + b.h <= poster.paper.y + poster.paper.h + 0.01, b.type + ' 画出纸外了')
    prevEnd = b.y + b.h
  }
  assert.ok(poster.paper.y + poster.paper.h - prevEnd >= 14, '底部留白不足,锯齿会压到最后一块')
})

test('★没拿到照片就整块不排:票面往上收,不留空洞、不画假占位', () => {
  const props = { photoUrl: 'https://cdn.chengyinhub.com/u/8/lane.jpg' }
  const noPhoto = C.methods._buildSignPoster.call(page(props), measure, false)
  const withPhoto = C.methods._buildSignPoster.call(page(props), measure, true)
  assert.deepEqual(of(noPhoto, 'photo'), [], '照片没成就该整块不出现')
  assert.ok(!JSON.stringify(noPhoto).includes('暂无照片'), '不许画占位文案')

  assert.deepEqual(typesOf(withPhoto),
    ['head', 'hr', 'od', 'hr', 'grid', 'hr', 'photo', 'hr', 'poem', 'hr', 'barcode'])
  assert.deepEqual(typesOf(noPhoto),
    ['head', 'hr', 'od', 'hr', 'grid', 'hr', 'poem', 'hr', 'barcode'],
    '跳过照片时连带它前面那道虚线一起跳,否则票面出现两道挨着的虚线')
  assert.ok(!typesOf(noPhoto).some((t, i, all) => t === 'hr' && all[i + 1] === 'hr'))

  const photo = of(withPhoto, 'photo')[0]
  const photoHr = withPhoto.blocks[withPhoto.blocks.indexOf(photo) - 1]
  const ruleHr = of(withPhoto, 'hr').filter((b) => b !== photoHr)[0]
  assert.equal(photoHr.h, ruleHr.h)
  assert.equal(withPhoto.paper.h - noPhoto.paper.h, photo.h + photoHr.h,
    '票面高度必须正好收掉照片那一整段')
  assert.equal(photo.h, 200 + 8 + 28, '照片 200 + 间距 8 + 标注一行(同 wxss .ds__photo)')
  assert.deepEqual([photo.captionL, photo.captionR], ['阿May 拍的', BASE.leftAt])
  assert.equal(photo.x, of(withPhoto, 'poem')[0].x, '照片与正文同一列左边距')
  assert.equal(of(withPhoto, 'poem')[0].y, photo.y + photo.h + photoHr.h, '后面的块要跟着往上收')
})

test('负控:照片没成却照样留块(票面出现两道挨着的虚线),契约必须判红', () => {
  const broken = ['head', 'hr', 'od', 'hr', 'grid', 'hr', 'hr', 'poem', 'hr', 'barcode']
  const real = typesOf(C.methods._buildSignPoster.call(page(), measure, false))
  assert.notDeepEqual(broken, real, '负控构造失败:坏版本与好版本一模一样,等于没在测')
  assert.ok(broken.some((t, i) => t === 'hr' && broken[i + 1] === 'hr'),
    '负控要自证:坏版本的空洞正是「两道挨着的虚线」')
  assert.ok(!real.some((t, i) => t === 'hr' && real[i + 1] === 'hr'))
})

test('地址过长就折行,块高按行数长出来(不许横向溢出票面)', () => {
  const short = of(C.methods._buildSignPoster.call(page({ address: '巷口' }), measure, false), 'od')[0]
  const long = of(C.methods._buildSignPoster.call(
    page({ address: '南京西路 1266 号 恒隆广场东侧第二次入口' }), measure, false), 'od')[0]
  assert.equal(short.addrLines.length, 1)
  assert.ok(long.addrLines.length > 1, '长地址没折行 = 画出纸外')
  assert.equal(long.addrLines.join(''), long.address, '折行不许吞字')
  for (const line of long.addrLines) {
    assert.ok(measure(line, '700 28px sans-serif') <= long.addrMaxW + 0.5, '折完还在溢出:' + line)
  }
  // 两列各自垂直居中(.ds__od 是 align-items: center):块高取两列之大,左列按行数长
  assert.equal(short.h, Math.max(short.leftH, short.rightH))
  assert.equal(long.h, Math.max(long.leftH, long.rightH))
  assert.ok(long.leftH > long.rightH, '这个用例要让地址那列 dominating,否则长不出高度')
  assert.equal(long.leftH - short.leftH, (long.addrLines.length - 1) * long.addrLineH)
  assert.equal(long.addrLineH, short.addrLineH)
})

test('签文行数与票面一致:服务端给几行就画几行,块高随之长', () => {
  const one = C.methods._buildSignPoster.call(page(), measure, false)
  const many = C.methods._buildSignPoster.call(page({ lines: ['一', '二', '三'] }), measure, false)
  assert.deepEqual(of(one, 'poem')[0].lines, ['雨天走后门'])
  assert.equal(many.paper.h - one.paper.h, 2 * of(many, 'poem')[0].lineH)
})

/* ── ④ 保存流程与反馈 ── */

function fakeWx(opt) {
  const o = opt || {}
  const rec = {
    texts: [], fills: 0, strokes: 0, images: 0, rects: 0, toasts: [],
    exports: 0, albums: [], downloads: [], openSettings: 0,
  }
  const ctx = {
    font: '', fillStyle: '', textAlign: '', textBaseline: '', lineWidth: 1,
    strokeStyle: '', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, shadowOffsetX: 0,
    scale() {}, save() {}, restore() {}, clip() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, rect() {},
    fill() { rec.fills += 1 }, stroke() { rec.strokes += 1 },
    fillRect() { rec.rects += 1 },
    fillText(text) { rec.texts.push(String(text)) },
    measureText: (t) => ({ width: measure(t, ctx.font) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    drawImage() { rec.images += 1 },
    setLineDash() {},
  }
  const node = {
    get width() { return rec.width || 0 },
    set width(v) { rec.width = v },
    get height() { return rec.height || 0 },
    set height(v) { rec.height = v },
    getContext: () => ctx,
    createImage: () => {
      const img = { src: '' }
      setTimeout(() => {
        if (o.photoBroken) { if (img.onerror) img.onerror({}) }
        else if (img.onload) img.onload({})
      }, 0)
      return img
    },
  }
  const wx = {
    showToast: (x) => { rec.toasts.push(x.title) },
    hideToast: () => {},
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, screenHeight: 800 }),
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    getMenuButtonBoundingClientRect: () => ({ left: 280, right: 368, bottom: 88 }),
    createSelectorQuery: () => ({
      in: () => ({
        select: () => ({
          fields: () => ({ exec: (cb) => cb(o.noCanvas ? [] : [{ node }]) }),
          boundingClientRect: () => ({ exec: (cb) => cb({ width: 375, height: 500 }) }),
        }),
      }),
    }),
    canvasToTempFilePath: (x) => {
      rec.exports += 1
      if (!x.canvas || !x.destWidth || !x.destHeight) { x.fail({ errMsg: 'dest 没显式给' }); return }
      if (o.exportFail) x.fail({ errMsg: 'canvasToTempFilePath:fail' })
      else x.success({ tempFilePath: '/tmp/ds-sign.png' })
    },
    saveImageToPhotosAlbum: (x) => {
      rec.albums.push(x.filePath)
      if (o.albumFail) x.fail({ errMsg: o.albumFail })
      else x.success({})
    },
    downloadFile: (x) => {
      rec.downloads.push(x.url)
      if (o.downloadFail) x.fail({ errMsg: 'downloadFile:fail' })
      else x.success({ statusCode: 200, tempFilePath: '/tmp/ds-photo.jpg' })
    },
    openSetting: () => { rec.openSettings += 1 },
  }
  wx.__rec = rec
  return wx
}

test('保存成功:票面被真画出来(标题/地址/签号/那句都落到画布上)再写相册', async () => {
  global.wx = fakeWx({})
  const p = page()
  await C.methods.onSave.call(p)
  const rec = global.wx.__rec
  assert.equal(rec.exports, 1, '没有真的导出 canvas')
  assert.ok(rec.width > 750, '画布按 dpr 放大过,导出不是 750 逻辑宽的糊图:' + rec.width)
  assert.ok(rec.rects > 46, '台面 + 46 根条码都该是 fillRect 出来的:' + rec.rects)
  assert.ok(rec.strokes >= 40, '票面那道虚线是一段一段画的(.ds__hr 就是 dashed):' + rec.strokes)
  assert.deepEqual(rec.albums, ['/tmp/ds-sign.png'])
  for (const s of ['今日城市签', BASE.dateLabel, BASE.address, BASE.serialLabel, BASE.lines[0], BASE.signer]) {
    assert.ok(rec.texts.includes(s), '画布上少了这一行字:' + s)
  }
  assert.ok(rec.toasts.some((t) => /已保存到相册/.test(t)), '成了要出声:' + JSON.stringify(rec.toasts))
  assert.equal(p.data.saving, false, '落定后要交回按钮')
})

test('生成中给禁用态、连点不重画', async () => {
  global.wx = fakeWx({})
  const p = page()
  const seen = []
  const orig = p.setData
  p.setData = function (patch) { seen.push(Object.assign({}, patch)); return orig.call(this, patch) }
  const first = C.methods.onSave.call(p)
  assert.equal(p.data.saving, true, '点下去就要立刻置 saving(wxml 靠它出「生成中…」)')
  const second = C.methods.onSave.call(p)
  await second
  assert.equal(seen.filter((s) => 'saving' in s).length, 1, '第二次点击连 setData 都不该发')
  await first
  assert.equal(global.wx.__rec.exports, 1, 'saving 期间第二次点击必须被拦掉')
  assert.ok(seen.some((s) => s.saving === true) && seen.some((s) => s.saving === false))
  assert.match(WXML, /saving \? '生成中…' : '保存到相册'/, '按钮得有可见的生成中态')
  assert.match(WXSS, /\.ds__save\.is-off/, '禁用态要有可见差异(不能只靠文案)')
})

test('★canvas 取不到:一句「生成失败」,不假装保存过', async () => {
  global.wx = fakeWx({ noCanvas: true })
  const p = page()
  await C.methods.onSave.call(p)
  const rec = global.wx.__rec
  assert.equal(rec.albums.length, 0)
  assert.ok(rec.toasts.some((t) => /失败/.test(t)), '静默失败就是原 bug 换了个位置')
  assert.equal(p.data.saving, false)
})

test('★导出失败:toast 一句,不写相册、不弹权限', async () => {
  global.wx = fakeWx({ exportFail: true })
  const p = page()
  await C.methods.onSave.call(p)
  const rec = global.wx.__rec
  assert.equal(rec.albums.length, 0)
  assert.equal(rec.openSettings, 0)
  assert.ok(rec.toasts.some((t) => /失败/.test(t)))
  assert.equal(p.data.saving, false)
})

test('★相册权限被拒:去 wx.openSetting,不弹「失败」误人', async () => {
  global.wx = fakeWx({ albumFail: 'saveImageToPhotosAlbum:fail auth deny' })
  const p = page()
  await C.methods.onSave.call(p)
  const rec = global.wx.__rec
  assert.equal(rec.openSettings, 1, '拒过授权自己再问不会弹,只能带去设置')
  assert.ok(!rec.toasts.some((t) => /失败/.test(t)), JSON.stringify(rec.toasts))
  assert.equal(p.data.saving, false)
})

test('★玩家自己取消:静默,不打扰也不出错', async () => {
  global.wx = fakeWx({ albumFail: 'saveImageToPhotosAlbum:fail cancel' })
  const p = page()
  await C.methods.onSave.call(p)
  const rec = global.wx.__rec
  assert.deepEqual(rec.toasts, [], '取消不是失败:' + JSON.stringify(rec.toasts))
  assert.equal(rec.openSettings, 0)
  assert.equal(p.data.saving, false)
})

test('相册写入真失败(空间/系统):说清楚没存进去', async () => {
  global.wx = fakeWx({ albumFail: 'saveImageToPhotosAlbum:fail disk full' })
  const p = page()
  await C.methods.onSave.call(p)
  const rec = global.wx.__rec
  assert.ok(rec.toasts.some((t) => /没存进相册|保存失败/.test(t)), JSON.stringify(rec.toasts))
  assert.equal(rec.openSettings, 0)
})

test('★有照片:先落到本地文件再解码,成了才 drawImage 并计入票面', async () => {
  global.wx = fakeWx({})
  const p = page({ photoUrl: 'https://cdn.chengyinhub.com/u/8/lane.jpg' })
  await C.methods.onSave.call(p)
  const rec = global.wx.__rec
  assert.deepEqual(rec.downloads, ['https://cdn.chengyinhub.com/u/8/lane.jpg'])
  assert.equal(rec.images, 1, '照片成了就该画进票面')
  assert.equal(rec.albums.length, 1)
})

test('★照片下不下来 / 解不开:整块跳过,票面照样出、不留空洞', async () => {
  for (const opt of [{ downloadFail: true }, { photoBroken: true }]) {
    global.wx = fakeWx(opt)
    const p = page({ photoUrl: 'https://cdn.chengyinhub.com/u/8/lane.jpg' })
    await C.methods.onSave.call(p)
    const rec = global.wx.__rec
    assert.equal(rec.images, 0, JSON.stringify(opt) + ' 不该 drawImage')
    assert.equal(rec.exports, 1, '照片没了照样要出得来票')
    assert.deepEqual(rec.albums, ['/tmp/ds-sign.png'])
    assert.ok(rec.texts.includes(BASE.lines[0]), '正文不许因为照片缺就错位丢失')
    assert.ok(!rec.texts.some((t) => /占位|暂无|加载中/.test(t)), '不许画假占位:' + JSON.stringify(rec.texts))
  }
})

test('没有 photoUrl 时连下载都不发(开场签本来就没照片)', async () => {
  global.wx = fakeWx({})
  await C.methods.onSave.call(page({ photoUrl: '' }))
  assert.deepEqual(global.wx.__rec.downloads, [])
  assert.equal(global.wx.__rec.images, 0)
})

test('非 https 的 photoUrl 一律不画(统一上传通道只给 https)', async () => {
  global.wx = fakeWx({})
  await C.methods.onSave.call(page({ photoUrl: 'http://img.test/a.jpg' }))
  assert.deepEqual(global.wx.__rec.downloads, [])
  assert.equal(global.wx.__rec.images, 0)
})

/* ── 接线 ── */

test('★离屏 canvas 已挂在组件里,并且不进无障碍树', () => {
  assert.match(WXML, /<canvas[^>]*type="2d"[^>]*id="dsSignCv"[^>]*class="ds__cv"[^>]*aria-hidden="true"/,
    'type="2d" 才有 canvasToTempFilePath 的 canvas 参数;aria-hidden 防读屏念出一块无名画布')
  assert.match(WXSS, /\.ds__cv\s*\{[^}]*position:\s*fixed/, '离屏:不能占版面')
  assert.match(WXSS, /\.ds__cv\s*\{[^}]*left:\s*-\d+px/, '离屏:挪出屏外,而不是 display:none(那样取不到节点)')
  assert.doesNotMatch(WXSS, /^canvas\s*\{/m, '组件 wxss 里不许有 tag selector(选择器门禁)')
})

test('留过签才给保存出口 —— 没留下的票面存进去是半张', () => {
  assert.match(WXML, /<block wx:if="\{\{claimed\}\}">[\s\S]*?bindtap="onSave"[\s\S]*?<\/block>/,
    '保存只在留过之后出现(那时票面才是完整的一张)')
  global.wx = fakeWx({})
  const p = page({ claimed: false })
  return C.methods.onSave.call(p).then(() => {
    assert.equal(global.wx.__rec.exports, 0)
    assert.equal(p.data.saving, false)
  })
})
