/* 决定类与挑战类七个玩法的配置层(原型真源:模板编辑页 v2)
 *
 * 这七段一度只有服务端有、编辑页没有 —— 商家根本配不了,而且**不报错**:
 * 段名不在 SECTIONS 里,parse 读不出来、serialize 也存不回去,静默丢掉。
 * 所以第一条断言钉的是「段名在册」,它才是这一层真正会烂的地方。
 *
 * 边界值与服务端 AdvancedGameConfigValidator 一一对齐。两边不一致的后果是:
 * 本地放行、发布时服务端拒绝,而商家这时候已经离开那个字段很久了。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')

const DECIDE = ['coinFlip', 'diceRoll', 'reaction', 'ballShake', 'quietHold', 'countdown', 'stopwatch']
const mk = (patch) => Object.assign(cfg.defaultConfig(), patch)

test('★七段都在 SECTIONS 里,且默认配置带得出来', () => {
  for (const k of DECIDE) {
    assert.ok(cfg.SECTIONS.indexOf(k) >= 0, k + ' 不在 SECTIONS,读不出来也存不回去')
    assert.ok(cfg.defaultConfig()[k], k + ' 没有默认段')
    assert.equal(cfg.defaultConfig()[k].enabled, false, k + ' 默认必须是关的')
  }
})

test('★负控:把任一段从 SECTIONS 摘掉,parse 就丢内容', () => {
  const raw = JSON.stringify(mk({
    coinFlip: { enabled: true, kicker: 'k', heads: { label: '正', action: 'a' }, tails: { label: '反', action: 'b' } },
  }))
  const back = cfg.parse(raw)
  assert.equal(back.error, '', 'parse 不该报错')
  assert.equal(back.value.coinFlip.enabled, true, '在册时读得回来')
  assert.equal(back.value.coinFlip.heads.action, 'a')

  // 负控:名单外的段走「未知段透传」,不该被静默丢掉 —— v5.1 七款玩法就是这么没的
  const odd = cfg.parse(JSON.stringify({ schemaVersion: 1, someFutureGame: { enabled: true, x: 1 } }))
  assert.equal(odd.value.someFutureGame.x, 1, '名单外的段必须原样保留,不能静默清空')
})

test('抛硬币:两面的「要做什么」都是必填 —— 只写正反面不是一个玩法', () => {
  assert.match(cfg.validate(mk({
    coinFlip: { enabled: true, heads: { label: '正面', action: '' }, tails: { label: '反面', action: '这杯你请' } },
  })), /正面要做什么不能为空/)
  assert.equal(cfg.validate(mk({
    coinFlip: { enabled: true, heads: { label: '正面', action: '这杯店家请' }, tails: { label: '反面', action: '这杯你请' } },
  })), '', '两面都写了就该放行')
})

test('掷骰子:六个面缺一不可;颗数由 normalize 夹回,不是校验拦', () => {
  assert.match(cfg.validate(mk({
    diceRoll: { enabled: true, diceCount: 1, faces: ['a', 'b', 'c', 'd', 'e', ''] },
  })), /第 6 面不能为空/)
  // 3 颗是脏数据(UI 只给一颗/两颗),normalize 夹回而不是报错给商家看
  assert.equal(cfg.normalize(mk({
    diceRoll: { enabled: true, diceCount: 3, faces: ['a', 'b', 'c', 'd', 'e', 'f'] },
  })).diceRoll.diceCount, 1)
  // 面数不足也补齐到 6,补出来的空面由 validate 拦
  assert.equal(cfg.normalize(mk({
    diceRoll: { enabled: true, diceCount: 1, faces: ['a'] },
  })).diceRoll.faces.length, 6)
})

test('★变色就点:达标毫秒不能低于人类反应下限 120ms —— 低于它是设了个没人能达标的目标', () => {
  assert.match(cfg.validate(mk({ reaction: { enabled: true, rounds: 3, goalMs: 80 } })), /120 至 2000/)
  assert.match(cfg.validate(mk({ reaction: { enabled: true, rounds: 99, goalMs: 320 } })), /1 至 10/)
  assert.equal(cfg.validate(mk({ reaction: { enabled: true, rounds: 3, goalMs: 320 } })), '')
})

test('弹球:不限时那一档不留秒数 —— 留着下次开开关会冒出商家没设过的值', () => {
  const off = cfg.normalize(mk({ ballShake: { enabled: true, goal: 30, timed: false, seconds: 12 } }))
  assert.equal('seconds' in off.ballShake, false)
  const on = cfg.normalize(mk({ ballShake: { enabled: true, goal: 30, timed: true, seconds: 12 } }))
  assert.equal(on.ballShake.seconds, 12)
  assert.match(cfg.validate(mk({ ballShake: { enabled: true, goal: 30, timed: true, seconds: 1 } })), /3 至 300/)
})

test('倒计时:到点那句话是必填 —— 走到 0 却没有话说,这一屏就断在那儿', () => {
  assert.match(cfg.validate(mk({ countdown: { enabled: true, seconds: 90, doneText: '' } })), /不能为空/)
  assert.equal(cfg.validate(mk({ countdown: { enabled: true, seconds: 90, doneText: '时间到。' } })), '')
})

test('精准停表:容差与次数各有区间;0 次表示不限,不是不许停', () => {
  assert.match(cfg.validate(mk({ stopwatch: { enabled: true, targetSeconds: 10, toleranceMs: 9, tries: 3 } })), /50 至 5000/)
  assert.match(cfg.validate(mk({ stopwatch: { enabled: true, targetSeconds: 1, toleranceMs: 300, tries: 3 } })), /3 至 120/)
  assert.equal(cfg.validate(mk({ stopwatch: { enabled: true, targetSeconds: 10, toleranceMs: 300, tries: 0 } })), '',
    '0 次 = 不限,必须放行')
})

test('安静挑战:阈值不入配置 —— 它由客户端开局前现场校准', () => {
  const n = cfg.normalize(mk({ quietHold: { enabled: true, seconds: 15, kicker: '别出声' } }))
  assert.equal('threshold' in n.quietHold, false, '写死阈值等于把书店的线拿到咖啡馆用')
  assert.match(cfg.validate(mk({ quietHold: { enabled: true, seconds: 2 } })), /5 至 300/)
})

test('数字字段全部过 num():商家删空输入框拿到的是空串,不是 0', () => {
  const n = cfg.normalize(mk({
    reaction: { enabled: true, rounds: '', goalMs: '320' },
    stopwatch: { enabled: true, targetSeconds: '10', toleranceMs: '', tries: '3' },
  }))
  assert.equal(typeof n.reaction.rounds, 'number')
  assert.equal(typeof n.stopwatch.toleranceMs, 'number')
  assert.equal(n.reaction.goalMs, 320)
})
