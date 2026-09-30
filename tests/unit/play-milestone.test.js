const assert = require('node:assert/strict')
const test = require('node:test')
const { buildMilestone, TIERS } = require('../../pages/play/utils/play-milestone.js')

// 这条是任务书的硬要求:「不许摆假数据凑档位」。
// 所以最该被钉住的不是「档位算得对」,而是「拿不到数据时必须交出 null,让调用方整条不渲染」——
// 一旦有人图省事把它改成 return buildMilestone(0),页面就会出现一条看起来有数据、
// 实际上什么都没有的轴,而且不会有任何报错。下面第一组就是盯这个的。
test('取不到累计数时返回 null(调用方据此整条轴不渲染,不退化成全灰轴)', () => {
  ;[null, undefined, '', 'abc', NaN, -1, -100].forEach((bad) => {
    assert.equal(buildMilestone(bad), null, `${String(bad)} 必须判成「没有数据」而不是 0`)
  })
})

test('负控:把非法输入当 0 处理会让「没有数据」和「一个都没完成」变得无法区分', () => {
  // 模拟那个偷懒改法:非法输入不返回 null,而是按 0 走
  const lenient = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? buildMilestone(v) : buildMilestone(0))
  const fromBadData = lenient('abc')
  const fromRealZero = buildMilestone(0)
  // 两者会渲染成一模一样的一条轴 —— 这正是要防的「假数据」
  assert.deepEqual(fromBadData, fromRealZero)
  // 而现行实现能把它们分开
  assert.equal(buildMilestone('abc'), null)
  assert.notEqual(buildMilestone(0), null)
})

test('count=0:没有 current,全部 future(第一个主题还没完成)', () => {
  const m = buildMilestone(0)
  assert.equal(m.count, 0)
  assert.ok(m.tiers.every((t) => t.state === 'future'))
  assert.match(m.title, /第一个主题/)
  assert.deepEqual(m.next, { value: 1, remaining: 1 })
  assert.equal(m.progress, 0)
})

test('里程碑给出当前区间真实进度与下一档，不虚构稀有度和日期', () => {
  const m = buildMilestone(7)
  assert.deepEqual(m.next, { value: 10, remaining: 3 })
  assert.equal(m.progress, 35)
  assert.equal(Object.hasOwn(m, 'rarity'), false)
  assert.equal(Object.hasOwn(m, 'unlockedAt'), false)
})

test('当前档 = 已达成的最大档位,前面标 past、后面标 future', () => {
  const m = buildMilestone(12)   // 12 → 落在 10 这一档(1/5/10 已达成,30/100 未到)
  const states = m.tiers.map((t) => t.state)
  assert.deepEqual(states, ['past', 'past', 'current', 'future', 'future'])
  assert.equal(m.tiers[2].value, 10)
})

test('正好踩在档位上时,该档是 current 而不是 past', () => {
  const m = buildMilestone(5)
  assert.equal(m.tiers[1].value, 5)
  assert.equal(m.tiers[1].state, 'current')
  assert.equal(m.tiers[0].state, 'past')
})

test('超过最高档:最高档为 current,不越界', () => {
  const m = buildMilestone(999)
  assert.equal(m.tiers[m.tiers.length - 1].state, 'current')
  assert.equal(m.tiers.filter((t) => t.state === 'current').length, 1)
  assert.equal(m.next, null)
  assert.equal(m.progress, 100)
})

test('称号文案带真实数字(不是写死的占位话术)', () => {
  assert.equal(buildMilestone(7).title, '你已完成第 7 个主题')
  assert.equal(buildMilestone(1).title, '你已完成第 1 个主题')
})

test('档位表本身稳定:有且只有一个 current(除非一个都没到)', () => {
  for (let n = 0; n <= 120; n++) {
    const m = buildMilestone(n)
    const cur = m.tiers.filter((t) => t.state === 'current').length
    assert.ok(cur === (n >= TIERS[0] ? 1 : 0), `count=${n} 时 current 数量应为 ${n >= TIERS[0] ? 1 : 0},实际 ${cur}`)
  }
})
