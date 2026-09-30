/* 滚动驱动动效契约(2026-08-22)
 *
 * 为什么必须走 this.animate 的 scrollSource,而不是 onPageScroll + setData:
 * 后者每帧一次跨线程数据拷贝,是小程序头号性能反模式 —— 动效越复杂越卡,与目的相反。
 *
 * ⚠️ 它在 WebView 渲染器上就能用,**不需要 Skyline**。审查文档说容器变形「依赖 Skyline」,
 * 对滚动驱动这一类是过严的;本契约就是那句话的反证。
 *
 * 锁三件事:
 *   ① 减动效偏好下**整个跳过**(大动效退化为不做,不是做快一点);
 *   ② 参数不全/区间非法时返回 null,而不是挂上一个静默无效的动画;
 *   ③ 页面真的接上了 —— 滚动源 id 存在、选择器指向真实节点、挂在 onReady(节点已渲染)。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const sm = require('../../pages/templatedetail/utils/scroll-motion.js')

/* ---------- ① 减动效 ---------- */

test('减动效偏好下整个跳过,不生成任何动画配置', () => {
  assert.equal(sm.heroRecedeOptions({ scrollSource: '#s', endOffset: 240, reducedMotion: true }), null)
  const page = { animate() { throw new Error('减动效下不该调 animate') } }
  assert.equal(
    sm.applyHeroRecede(page, '.hero', { scrollSource: '#s', endOffset: 240, reducedMotion: true }),
    false,
    '必须返回 false 且不触碰 page.animate',
  )
})

test('未开减动效时正常挂上,参数完整传给 animate', () => {
  const calls = []
  const page = { animate: (...a) => calls.push(a) }
  const ok = sm.applyHeroRecede(page, '.hero', { scrollSource: '#s', endOffset: 240, reducedMotion: false })
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  const [selector, frames, duration, options] = calls[0]
  assert.equal(selector, '.hero')
  assert.equal(options.scrollSource, '#s')
  assert.equal(options.endScrollOffset, 240)
  assert.equal(duration, options.timeRange, 'duration 必须与 timeRange 一致,否则补间与滚动不同步')
  assert.equal(frames[0].offset, 0)
  assert.equal(frames[frames.length - 1].offset, 1, '关键帧必须覆盖 0→1 全程')
})

/* ---------- ② 参数校验:宁可不做,不做静默无效的动画 ---------- */

test('参数不全或区间非法一律返回 null(不挂静默无效的动画)', () => {
  const base = { reducedMotion: false }
  assert.equal(sm.heroRecedeOptions({ ...base, endOffset: 240 }), null, '缺 scrollSource:没有滚动源就没有驱动')
  assert.equal(sm.heroRecedeOptions({ ...base, scrollSource: '#s' }), null, '缺 endOffset')
  assert.equal(sm.heroRecedeOptions({ ...base, scrollSource: '#s', startOffset: 300, endOffset: 240 }), null,
    'end <= start 会得到怪异补间')
  assert.equal(sm.heroRecedeOptions({ ...base, scrollSource: '#s', startOffset: 240, endOffset: 240 }), null,
    '零区间同样非法')
  assert.equal(sm.applyHeroRecede(null, '.hero', { ...base, scrollSource: '#s', endOffset: 240 }), false,
    '没有页面实例时安静返回 false,不抛')
  assert.equal(sm.applyHeroRecede({}, '.hero', { ...base, scrollSource: '#s', endOffset: 240 }), false,
    '页面没有 animate 方法时同样安静返回 false')
})

test('隐退幅度留底,不整块消失', () => {
  const frames = sm.heroRecedeFrames()
  const last = frames[frames.length - 1]
  assert.ok(last.opacity > 0, '整块淡到 0 会让页面显得空;应留一点底')
  assert.ok(last.opacity < 1, '不隐退等于没做')
  assert.match(last.transform, /scale\(0?\.\d+\)/, '应带轻微缩放以表达「退远了」')
})

/* ---------- ③ 页面真的接上了 ---------- */

test('templatedetail 真的接上了滚动驱动(源/选择器/时机三者都对)', () => {
  const wxml = read('pages/templatedetail/templatedetail.wxml')
  const js = read('pages/templatedetail/templatedetail.js')

  const src = /scrollSource:\s*'(#[\w-]+)'/.exec(js)
  assert.ok(src, 'js 里必须指定 scrollSource')
  assert.ok(wxml.includes(`id="${src[1].slice(1)}"`),
    `滚动源 ${src[1]} 在 wxml 里找不到对应 id —— 指向不存在的源会静默无效`)

  const sel = /applyHeroRecede\(this,\s*'([.#][\w-]+)'/.exec(js)
  assert.ok(sel, 'js 里必须给出要隐退的选择器')
  assert.ok(wxml.includes(sel[1].slice(1)),
    `选择器 ${sel[1]} 在 wxml 里找不到对应节点 —— 选不中就是白挂`)

  assert.match(js, /onReady\(\)[\s\S]{0,400}applyHeroRecede/,
    '必须挂在 onReady:onLoad 时节点还没渲染,选择器找不到')
})

/* ---------- 负控 ---------- */

test('负控:把滚动源指向不存在的 id,契约必须判红', () => {
  const wxml = read('pages/templatedetail/templatedetail.wxml')
  const fakeSrc = '#doesNotExist'
  assert.equal(wxml.includes(fakeSrc.slice(1)), false)
  assert.throws(() => {
    assert.ok(wxml.includes(`id="${fakeSrc.slice(1)}"`), '滚动源在 wxml 里找不到')
  })
})

test('负控:减动效判定若写反(reduced 时反而挂上),行为断言必须抓到', () => {
  const inverted = (cfg) => (cfg.reducedMotion ? { scrollSource: cfg.scrollSource } : null)
  assert.notEqual(inverted({ scrollSource: '#s', reducedMotion: true }), null,
    '证明写反的实现确实会在减动效下挂上动画')
  assert.equal(sm.heroRecedeOptions({ scrollSource: '#s', endOffset: 240, reducedMotion: true }), null)
})
