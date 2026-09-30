// utils/motion.js 单测(WT2,2026-07-29)
// 只测行为,不测常量:断言的是「末帧一定落在目标值」「降级动效真的不震」这类性质,
// 不是「COUNT_UP_MS === 220」那种自证。
const assert = require('node:assert/strict')
const test = require('node:test')

const motion = require('../../utils/motion.js')
const { easeOutCubic, countUpFrames, countUp, stampInPlan, stampIn, fadeSwapPlan, fadeSwap, routeDrawPlan, routeDraw } = motion

// ---- easeOutCubic ----

test('easeOutCubic:定义域收敛、单调递增、减速收尾', () => {
  assert.equal(easeOutCubic(0), 0)
  assert.equal(easeOutCubic(1), 1)
  // 超界与脏值一律夹住,不让 NaN 漏进数字滚动
  assert.equal(easeOutCubic(-3), 0)
  assert.equal(easeOutCubic(9), 1)
  assert.equal(easeOutCubic(NaN), 0)

  let prev = -1
  for (let i = 0; i <= 20; i++) {
    const v = easeOutCubic(i / 20)
    assert.ok(v > prev, `t=${i / 20} 必须严格递增`)
    prev = v
  }
  // 「减速收尾」= 前半程已经走完一半以上;这是它和 linear 的区别所在
  assert.ok(easeOutCubic(0.5) > 0.5, 'ease-out 的中点必须已过半程')
})

// ---- countUpFrames ----

test('countUpFrames:末帧恒等于目标值,途中单调逼近', () => {
  const frames = countUpFrames(0, 1280, { duration: 220, fps: 30 })
  assert.ok(frames.length > 1, '正常动效必须多帧')
  assert.equal(frames[frames.length - 1].value, 1280, '末帧必须精确落在目标值')
  assert.ok(frames[0].value > 0 && frames[0].value < 1280, '首帧应在起止之间')

  let prevValue = -Infinity
  let prevAt = -Infinity
  frames.forEach((f) => {
    assert.ok(f.value >= prevValue, '数值必须单调不减')
    assert.ok(f.atMs > prevAt, '时间戳必须严格递增')
    prevValue = f.value
    prevAt = f.atMs
  })
  assert.equal(frames[frames.length - 1].atMs, 220, '末帧落在总时长上')
})

// 上面那条「末帧 = 目标值」在 easeOutCubic 下是恒真的(它本来就在 t=1 收敛到 1),
// 单靠它证明不了代码里那句显式钉死。换一个**不在 t=1 收敛**的缓动才逼得出来:
// 没有那句钉死,金额就会停在 1500 而不是 1280。
test('countUpFrames:换过冲缓动时末帧仍被钉死在目标值(金额不会停错)', () => {
  const overshoot = () => 1.2   // 恒返回 1.2:任何一帧照算都会冲过头
  const frames = countUpFrames(0, 1280, { duration: 220, fps: 30, ease: overshoot })
  assert.equal(frames[frames.length - 1].value, 1280, '末帧必须被显式钉死,不能跟着缓动冲过去')
  assert.ok(frames[0].value > 1280, '中途允许过冲(这正是 spring 想要的观感)')
})

test('countUpFrames:递减方向同样收敛到目标值', () => {
  const frames = countUpFrames(500, 120, { duration: 220 })
  assert.equal(frames[frames.length - 1].value, 120)
  assert.ok(frames[0].value < 500 && frames[0].value > 120)
})

test('countUpFrames:decimals 控制小数位,不漏浮点尾巴', () => {
  const frames = countUpFrames(0, 12.34, { decimals: 2 })
  frames.forEach((f) => {
    const s = String(f.value)
    const dot = s.indexOf('.')
    if (dot >= 0) assert.ok(s.length - dot - 1 <= 2, `${s} 小数位超过 2`)
  })
  assert.equal(frames[frames.length - 1].value, 12.34)
})

test('countUpFrames:降级动效 / 起止相同 ⇒ 单帧直达终值', () => {
  const reduced = countUpFrames(0, 999, { reducedMotion: true })
  assert.equal(reduced.length, 1)
  assert.equal(reduced[0].value, 999)

  const same = countUpFrames(42, 42, {})
  assert.equal(same.length, 1)
  assert.equal(same[0].value, 42)
})

// ---- countUp 执行器 ----

function fakeClock() {
  let seq = 0
  const jobs = new Map()
  return {
    setTimeout(fn, ms) { const id = ++seq; jobs.set(id, { fn, ms }); return id },
    clearTimeout(id) { jobs.delete(id) },
    runAll() {
      Array.from(jobs.entries())
        .sort((a, b) => a[1].ms - b[1].ms)
        .forEach(([id, job]) => { jobs.delete(id); job.fn() })
    },
    pending() { return jobs.size },
  }
}

test('countUp:按帧回调,末帧触发 onDone 且值 = 目标值', () => {
  const clock = fakeClock()
  const seen = []
  let done = null
  countUp(0, 100, (v) => seen.push(v), {
    duration: 220,
    fps: 10,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDone: (v) => { done = v },
  })
  assert.equal(seen.length, 0, '排程阶段不应同步回调')
  clock.runAll()
  assert.ok(seen.length > 1)
  assert.equal(seen[seen.length - 1], 100)
  assert.equal(done, 100)
})

test('countUp:cancel 后不再有任何回调(离开页面必须停得住)', () => {
  const clock = fakeClock()
  const seen = []
  const stop = countUp(0, 100, (v) => seen.push(v), {
    duration: 220,
    fps: 10,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  stop()
  assert.equal(clock.pending(), 0, 'cancel 必须清掉已排程的定时器')
  clock.runAll()
  assert.equal(seen.length, 0)
})

// ---- stampIn ----

test('stampIn:正常态触发一次短震并给出弹性缓动', () => {
  const calls = []
  const plan = stampIn({ haptics: { vibrateShort: (o) => calls.push(o) } })
  assert.equal(calls.length, 1, '落章必须震一次')
  assert.ok(plan.durationMs > 0)
  assert.match(plan.easing, /^cubic-bezier\(/, '落章走弹性缓动而非 linear')
  assert.ok(plan.from.scale > plan.to.scale, '落章是从大落到 1(盖下去),不是放大')
})

test('stampIn:降级动效不震、时长归零(触感也是动效)', () => {
  const calls = []
  const plan = stampIn({ reducedMotion: true, haptics: { vibrateShort: (o) => calls.push(o) } })
  assert.equal(calls.length, 0, 'reduce-motion 下不得震动')
  assert.equal(plan.durationMs, 0)
  assert.equal(plan.haptic, null)
})

test('stampIn:震动源报错不掀翻动效(部分机型会 reject)', () => {
  const plan = stampIn({ haptics: { vibrateShort() { throw new Error('no permission') } } })
  assert.ok(plan.durationMs > 0, '震动失败后计划仍须返回,动画照常')
})

test('stampIn:没有震动源时静默降级,不抛异常', () => {
  const plan = stampIn({ haptics: null })
  assert.ok(plan.durationMs > 0)
})

// ---- fadeSwap ----

test('fadeSwap:两层同时补间,总时长不是两段相加', () => {
  const plan = fadeSwapPlan({})
  assert.equal(plan.skeleton.durationMs, plan.durationMs)
  assert.equal(plan.content.durationMs, plan.durationMs)
  assert.equal(plan.skeleton.from, 1)
  assert.equal(plan.skeleton.to, 0)
  assert.equal(plan.content.from, 0)
  assert.equal(plan.content.to, 1)
})

test('fadeSwap:立即把两层置到目标态,并在时长后 onDone', () => {
  const clock = fakeClock()
  const applied = []
  let done = false
  fadeSwap((s) => applied.push(s), {
    setTimeout: clock.setTimeout,
    onDone: () => { done = true },
  })
  assert.equal(applied.length, 1, 'apply 必须同步调用一次(补间由 CSS transition 完成)')
  assert.equal(applied[0].skeletonOpacity, 0)
  assert.equal(applied[0].contentOpacity, 1)
  assert.ok(applied[0].durationMs > 0)
  assert.equal(done, false)
  clock.runAll()
  assert.equal(done, true)
})

test('fadeSwap:降级动效 ⇒ 零时长直切,内容不被动画拖住', () => {
  const clock = fakeClock()
  const applied = []
  const plan = fadeSwap((s) => applied.push(s), { reducedMotion: true, setTimeout: clock.setTimeout })
  assert.equal(plan.durationMs, 0)
  assert.equal(applied[0].contentOpacity, 1)
})

test('三支动效的默认时长互不相同,且落在各自的量级上', () => {
  // 不断言具体毫秒(那是常量自证),只断言量级关系:
  // 淡切 < 数字滚动 < 落章庆祝 —— 这个次序错了就是动效体系错了
  const fade = fadeSwapPlan({}).durationMs
  const count = countUpFrames(0, 1, {})[countUpFrames(0, 1, {}).length - 1].atMs
  const stamp = stampInPlan({}).durationMs
  assert.ok(fade < count, '淡切必须快于数字滚动')
  assert.ok(count < stamp, '数字滚动必须快于落章庆祝')
})

// ---- routeDrawPlan / routeDraw(路线画入,2026-07-29 复核阻塞项 5)----
// 只测性质:线一定画到终点、笔尖恒在线上、速度按弧长恒定。不测常量。

// 一条「直路很长、拐弯处点很密」的路线:顶点分布极不均匀,专门用来照出
// 「按顶点等分」这种错实现 —— 它在这条线上会先飞后爬。
const UNEVEN_ROUTE = [
  { lng: 0, lat: 0 },
  { lng: 10, lat: 0 },      // 一段长 10
  { lng: 10.1, lat: 0 },    // 后面三段各长 0.1
  { lng: 10.2, lat: 0 },
  { lng: 10.3, lat: 0 },
]

const routeLen = (pts) => pts.reduce((sum, p, i) =>
  i === 0 ? 0 : sum + Math.hypot(p.lng - pts[i - 1].lng, p.lat - pts[i - 1].lat), 0)

test('routeDrawPlan:末帧 = 完整路线(线必须画到终点,不留断头路)', () => {
  const plan = routeDrawPlan(UNEVEN_ROUTE, { duration: 350, fps: 30 })
  assert.ok(plan.frames.length > 1, '正常路线必须多帧')
  const last = plan.frames[plan.frames.length - 1]
  assert.deepEqual(last.points, UNEVEN_ROUTE, '末帧必须精确等于完整路线')
  assert.equal(last.progress, 1)
  assert.equal(last.atMs, plan.durationMs, '末帧必须落在总时长上')
})

test('routeDrawPlan:已画长度单调递增,时间轴单调递增', () => {
  const plan = routeDrawPlan(UNEVEN_ROUTE, { duration: 350, fps: 30 })
  let prevLen = -1
  let prevAt = -1
  plan.frames.forEach((f) => {
    const len = routeLen(f.points)
    assert.ok(len >= prevLen, '已画长度不得回退(线不能缩回去)')
    assert.ok(f.atMs > prevAt, '帧时间必须严格递增')
    assert.ok(f.points.length >= 1, '每帧至少含起点')
    prevLen = len
    prevAt = f.atMs
  })
})

test('routeDrawPlan:按弧长取样 —— 已画长度恒等于 progress×总长(笔速恒定)', () => {
  // 这条断言就是「按顶点等分」实现的死刑判决:顶点等分下,
  // 第 1/4 帧会画掉 25% 的顶点却是 ~97% 的长度,与 progress 对不上。
  const plan = routeDrawPlan(UNEVEN_ROUTE, { duration: 350, fps: 30 })
  const total = routeLen(UNEVEN_ROUTE)
  plan.frames.forEach((f) => {
    const len = routeLen(f.points)
    assert.ok(Math.abs(len - f.progress * total) < 1e-9,
      `弧长 ${len} 与 progress ${f.progress}×总长 ${total} 不符 = 笔速不恒定`)
  })
})

test('routeDrawPlan:笔尖(末点)恒落在原路线的线段上', () => {
  const plan = routeDrawPlan(UNEVEN_ROUTE, { duration: 350, fps: 30 })
  plan.frames.forEach((f) => {
    const tip = f.points[f.points.length - 1]
    // 本路线全在 lat=0 上,笔尖必须也在这条线上且不越过终点
    assert.equal(tip.lat, 0, '插值点跑出了原路线')
    assert.ok(tip.lng >= 0 && tip.lng <= 10.3 + 1e-9, '笔尖越过了路线端点')
  })
})

test('routeDrawPlan:降级动效 / 不足两点 / 全重合点 ⇒ 单帧直接给完整线', () => {
  const reduced = routeDrawPlan(UNEVEN_ROUTE, { reducedMotion: true })
  assert.equal(reduced.frames.length, 1)
  assert.equal(reduced.durationMs, 0)
  assert.deepEqual(reduced.frames[0].points, UNEVEN_ROUTE, '降级也必须画出完整路线')

  const single = routeDrawPlan([{ lng: 1, lat: 2 }], {})
  assert.equal(single.frames.length, 1)
  assert.equal(single.frames[0].progress, 1)

  assert.equal(routeDrawPlan([], {}).frames[0].points.length, 0, '空路线不得抛异常')

  // 全部点重合:总长 0,不能除零产出 NaN 坐标
  const degenerate = routeDrawPlan([{ lng: 3, lat: 3 }, { lng: 3, lat: 3 }], {})
  assert.equal(degenerate.frames.length, 1)
  degenerate.frames[0].points.forEach((p) => {
    assert.ok(isFinite(p.lng) && isFinite(p.lat), '重合点不得产出 NaN')
  })
})

test('routeDrawPlan:脏点(NaN/缺字段)被滤掉,不把 NaN 喂给 map polyline', () => {
  const plan = routeDrawPlan([
    { lng: 0, lat: 0 }, null, { lng: NaN, lat: 1 }, { lng: 1, lat: 0 },
  ], { duration: 100, fps: 10 })
  plan.frames.forEach((f) => f.points.forEach((p) => {
    assert.ok(isFinite(p.lng) && isFinite(p.lat), 'NaN 漏进了帧点')
  }))
  assert.deepEqual(plan.frames[plan.frames.length - 1].points, [{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }])
})

test('routeDraw:按帧回调,末帧触发 onDone;cancel 后不再有帧', () => {
  const clock = fakeClock()
  const seen = []
  let donePlan = null
  routeDraw(UNEVEN_ROUTE, (pts, progress) => seen.push({ n: pts.length, progress }), {
    duration: 350,
    fps: 10,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDone: (plan) => { donePlan = plan },
  })
  assert.equal(seen.length, 0, '排程阶段不应同步回调')
  clock.runAll()
  assert.ok(seen.length > 1)
  assert.equal(seen[seen.length - 1].progress, 1, '最后一次回调必须是完整路线')
  assert.ok(donePlan && donePlan.frames.length === seen.length)

  const clock2 = fakeClock()
  const seen2 = []
  const stop = routeDraw(UNEVEN_ROUTE, () => seen2.push(1), {
    duration: 350, fps: 10, setTimeout: clock2.setTimeout, clearTimeout: clock2.clearTimeout,
  })
  stop()
  assert.equal(clock2.pending(), 0, 'cancel 必须清掉所有未跑的定时器')
  clock2.runAll()
  assert.equal(seen2.length, 0, 'cancel 后不得再有帧')
})

test('routeDraw:复用既有缓动与时长档,不新造第五个时长', () => {
  // 判据是「与既有档位对齐」这个关系,不是「等于 350」这个常量
  assert.equal(routeDrawPlan(UNEVEN_ROUTE, {}).easing, motion.EASE_OUT, '必须复用 --cy-ease-out')
  const draw = routeDrawPlan(UNEVEN_ROUTE, {}).durationMs
  assert.ok(draw > countUpFrames(0, 1, {}).slice(-1)[0].atMs, '路线画入应慢于数字滚动')
  assert.ok(draw < stampInPlan({}).durationMs, '路线画入应快于落章庆祝')
})
