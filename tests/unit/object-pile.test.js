/* 藏品册物品堆(施工文档第四版 §3.3,样稿 artifact 9U7HFWDfbinjmt2tppvVGp):
 * 物品从上往下掉、堆在地面线上;右上角 ✦ 按一下聚成一团浮在中间,再按一下落回去。
 * 物理只要「看着对」:落定后都在地面线以上、互相不大片重叠;聚团时都离开地面、围在中心。
 * 还有一条省电的:全都停下来以后要能判「静止」,页面据此停掉逐帧重画。 */
const assert = require('node:assert/strict')
const test = require('node:test')

const pile = require('../../utils/object-pile.js')

const WORLD = { W: 390, floor: 600, cx: 195, cy: 330 }
const drop = (n) => Array.from({ length: n }, (_, i) => pile.body({ id: i }, WORLD, { size: 40, seed: i + 1, fromTop: true }))

function run(bodies, world, steps) { for (let k = 0; k < steps; k++) pile.step(bodies, world, 1) }

test('落定后都在地面线以上、在左右边界之内', () => {
  const bodies = drop(30)
  run(bodies, WORLD, 900)
  for (const b of bodies) {
    assert.ok(b.y <= WORLD.floor - b.r + 0.5, '掉到地面线下面去了:' + b.y)
    assert.ok(b.x >= b.r - 0.5 && b.x <= WORLD.W - b.r + 0.5, '出了左右边界:' + b.x)
  }
})

test('落定后互相不大片重叠(堆着,不是摞在同一个点上)', () => {
  const bodies = drop(30)
  run(bodies, WORLD, 900)
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    assert.ok(d > (a.r + b.r) * 0.6, '两件叠成一团:' + d.toFixed(1))
  }
})

test('全都停下来以后判「静止」;还在掉的时候不是', () => {
  const bodies = drop(12)
  run(bodies, WORLD, 5)
  assert.equal(pile.settled(bodies), false)
  run(bodies, WORLD, 900)
  assert.equal(pile.settled(bodies), true)
})

test('聚成一团:都离开地面、围在中心附近', () => {
  const bodies = drop(30)
  run(bodies, WORLD, 900)
  run(bodies, Object.assign({}, WORLD, { ball: true }), 700)
  const far = bodies.filter((b) => Math.hypot(b.x - WORLD.cx, b.y - WORLD.cy) > 170)
  assert.equal(far.length, 0, '有 ' + far.length + ' 件没聚过来')
  assert.ok(bodies.every((b) => b.y < WORLD.floor - b.r - 20), '聚团时还有贴在地面上的')
})

test('点中:返回最上面(最后画的)那一件', () => {
  const a = { r: 20, x: 100, y: 100 }
  const b = { r: 20, x: 110, y: 100 }
  assert.equal(pile.hit([a, b], 105, 100), b)
  assert.equal(pile.hit([a, b], 300, 300), null)
})

/* ---------- 页面接线 ---------- */
const fs = require('node:fs')
const path = require('node:path')
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('★藏品册页:用共用的物理与映射、分类交给服务端筛、画在 2d canvas 上', () => {
  const js = strip(read('../../subpackageP3/pages/object-cards/index/index.js'))
  const wxml = read('../../subpackageP3/pages/object-cards/index/index.wxml')
  assert.ok(/require\(['"][./]*utils\/object-pile(\.js)?['"]\)/.test(js), '物理要走 utils/object-pile,别在页面里再写一份')
  assert.ok(/category: category === ALL \? '' : category/.test(js), '分类要交给服务端筛:客户端筛只筛得到第一页')
  assert.ok(/<canvas type="2d" id="ocPile"/.test(wxml), '物品堆要画在 2d canvas 上')
  assert.ok(/pile\.settled\(this\._bodies\)/.test(js), '全停住以后要停掉逐帧重画,不然一直耗电')
})

test('负控:首屏失败才整页报错,切分类失败只提示并退回原来那一类', () => {
  const js = strip(read('../../subpackageP3/pages/object-cards/index/index.js'))
  const at = js.indexOf('_failed(previous) {')
  const body = js.slice(at, js.indexOf('\n  },', at))
  assert.ok(/if \(!this\.data\.loaded\) \{ this\.setData\(\{ loading: false, error: true \}\); return; \}/.test(body), body)
  assert.ok(/filter: previous/.test(body), '切分类失败要退回原来那一类,不然药丸和堆对不上')
})

test('★藏品册页隐藏时停掉逐帧重画、回来再接着画 —— 聚成一团时它一直在画', () => {
  const js = strip(read('../../subpackageP3/pages/object-cards/index/index.js'))
  const hide = js.slice(js.indexOf('onHide() {'), js.indexOf('\n  },', js.indexOf('onHide() {')))
  const show = js.slice(js.indexOf('onShow() {'), js.indexOf('\n  },', js.indexOf('onShow() {')))
  assert.ok(/this\._stop\(\)/.test(hide), '没有 onHide 停画:切到后台还在逐帧重画')
  assert.ok(/this\._run\(\)/.test(show), '回来不接着画:聚成一团停在半空')
})

test('★点开一件时藏起物品堆画布 —— canvas 会压在半屏弹层与遮罩上面(2026-09-24 模拟器实拍)', () => {
  const wxml = read('../../subpackageP3/pages/object-cards/index/index.wxml')
  const wxss = read('../../subpackageP3/pages/object-cards/index/index.wxss')
  assert.ok(/<canvas type="2d" id="ocPile" class="oc-pile__cv \{\{active \? 'is-hidden' : ''\}\}"/.test(wxml), '画布没跟着放大态藏起来')
  assert.ok(/\.oc-pile__cv\.is-hidden\s*\{\s*display: none;/.test(wxss), '藏画布要用 display:none(visibility 对 canvas 不管用)')
})
