/* 阶段 5:check.mods 第一次接进编辑器。
 *
 * 此前 mods 是「代码支持但无人可用」——后端 validateMods 一直在、玩家侧
 * playkit-journey-check 也一直逐条显示「生效/未生效」,唯独编辑器配不出来,
 * 只能直接改库。本文件把契约的四个边界与后端对拍:两处独立记录,改一边就有见证人会红。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')

const ROOT = path.resolve(__dirname, '../..')
const BACKEND = path.resolve(ROOT, '../chengyinhub-system/src/main/java/com/chengyinhub/business'
  + '/service/support/AdvancedGameConfigValidator.java')
const java = () => fs.readFileSync(BACKEND, 'utf8')

test('条数上限与后端 MAX_STATE_REFS 一致', () => {
  const m = java().match(/MAX_STATE_REFS\s*=\s*(\d+)/)
  assert.ok(m, '后端 MAX_STATE_REFS 没找到 —— 改名了就该红')
  assert.equal(cfg.MAX_MODS, Number(m[1]))
})

test('label 上限与后端 MAX_CHECK_TEXT 一致', () => {
  const m = java().match(/MAX_CHECK_TEXT\s*=\s*(\d+)/)
  assert.ok(m, '后端 MAX_CHECK_TEXT 没找到')
  assert.equal(cfg.MAX_MOD_LABEL, Number(m[1]))
})

test('后端确实有 validateMods,且 when 必填、value 必整数', () => {
  const src = java()
  assert.match(src, /validateMods/)
  assert.match(src, /mods 必须带 when 条件/)
  assert.match(src, /requireStateValue\(mod, "check 的 mods"\)/)
})

test('四个边界前端同判', () => {
  assert.match(cfg.modsError([{ value: 1 }]), /必须带 when/)
  assert.match(cfg.modsError([{ when: {}, value: 1 }]), /必须带 when/, '空对象不算条件')
  assert.match(cfg.modsError([{ when: { var: 'sys.luck' }, value: 1.5 }]), /整数/)
  assert.match(cfg.modsError(Array.from({ length: cfg.MAX_MODS + 1 },
    () => ({ when: { var: 'sys.luck', op: 'GTE', value: 3 }, value: 1 }))), /最多配置/)
  assert.match(cfg.modsError([{ when: { var: 'sys.luck', op: 'GTE', value: 3 }, value: 1,
    label: 'x'.repeat(cfg.MAX_MOD_LABEL + 1) }]), /不能超过/)
  assert.equal(cfg.modsError([{ when: { var: 'sys.luck', op: 'GTE', value: 3 }, value: 1 }]), '')
  assert.equal(cfg.modsError(null), '', '不配 = 合法')
})

/* 预设只放零风险的两条:它们引用 sys.luck,与节点无关,模板被多站复用也成立。
 * 「熟门熟路」要引用 sys.passed.{nodeId},而模板编辑期拿不到 nodeId —— 9-22 裁决延后。 */
test('预设只有两条,且都不引用带 nodeId 的变量', () => {
  assert.equal(cfg.MOD_PRESETS.length, 2)
  for (const p of cfg.MOD_PRESETS) {
    assert.equal(cfg.modsError([{ when: p.when, value: p.value, label: p.label }]), '',
      p.label + ' 这条预设自己必须是合法配置')
    assert.doesNotMatch(JSON.stringify(p.when), /sys\.(passed|outcome|asked|mistakes)\./,
      p.label + ' 引用了带 nodeId 的变量 —— 模板可被多站复用,编辑期拿不到 nodeId')
  }
})

/* ⚠️ 下面几条一律走**公开入口** validate / normalize,不直接调 modsError / normalizeMods。
 * 直调只证明函数本身对,证明不了它被接进了链路 —— 第一版就是这么写的,
 * 把接线从 normalize()/validateNormalized() 里摘掉,测试照样全绿。 */

test('接线:validate 必须真的校 mods(摘掉接线这条会红)', () => {
  const bad = {
    schemaVersion: 1,
    check: { enabled: true, checkId: 'c1', tier: 'easy', mods: [{ value: 1 }] },
  }
  assert.match(cfg.validate(bad), /必须带 when/, 'validate 没把 mods 校到 = 坏配置能存下去')
})

test('接线:normalize 必须真的清洗 mods(摘掉接线这条会红)', () => {
  const out = cfg.normalize({
    schemaVersion: 1,
    check: {
      enabled: true, checkId: 'c1', tier: 'easy',
      mods: [{ when: {}, value: 0 }, { when: { var: 'sys.luck', op: 'GTE', value: 3 }, value: 1 }],
    },
  })
  assert.equal(out.check.mods.length, 1, 'normalize 没清洗 = 空行会被存出去')
})

/* normalize 的两条:空行丢掉、when 原样不改写。 */
test('normalize:空行丢掉,when 原样带上', () => {
  const out = cfg.normalizeMods([
    { when: {}, value: 0 },
    { when: { var: 'sys.luck', op: 'GTE', value: 3 }, value: 1, label: '幸运加持' },
  ])
  assert.equal(out.length, 1, '没填完的空行不该存出去')
  assert.deepEqual(out[0].when, { var: 'sys.luck', op: 'GTE', value: 3 },
    'when 必须原样 —— 悄悄改写等于替作者改语义')
})

/* 暴露 mods 之后,其余五项仍然必须「读进来原样留、存回去原样带」。 */
test('未暴露的五项仍然原样保留,不被 normalize 吃掉', () => {
  const kept = cfg.normalize({
    schemaVersion: 1,
    check: {
      enabled: true, checkId: 'c1', tier: 'easy',
      advantageIf: [{ var: 'clue.x', op: 'GTE', value: 1 }],
      critEffects: [{ op: 'INC', var: 'clue.y', value: 1 }],
      failCostTag: 'tag.hurried',
    },
  }).check
  assert.ok(kept.advantageIf, 'advantageIf 被吃掉 = 把作者配好的优劣势静默删了')
  assert.ok(kept.critEffects)
  assert.equal(kept.failCostTag, 'tag.hurried')
})

/* 「幸运」开关 + 档位下拉:换档只动两条幸运预设,生命阶梯与作者别的修正原样留着。 */
test('幸运档位:回显与换档互逆,关掉只摘幸运两条', () => {
  const hp = cfg.toggleHpLadder([], true)
  assert.equal(cfg.luckIndex(hp), -1, '没配幸运 = 开关关着')
  for (let i = 0; i < cfg.LUCK_OPTIONS.length; i++) {
    const mods = cfg.applyLuck(hp, i)
    assert.equal(cfg.luckIndex(mods), i, '第 ' + i + ' 档写进去读不回来')
    assert.equal(cfg.hpLadderOn(mods), true, '换幸运档把生命阶梯冲掉了')
  }
  const off = cfg.applyLuck(cfg.applyLuck(hp, 2), -1)
  assert.deepEqual(off, hp, '关掉幸运只该摘幸运两条')
})
