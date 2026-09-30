/* 阶段 2 判错扣血档位 mistakeTier:配置**根层**的一个键,与 present 同级。
 *
 * 为什么要这个文件:施工计划 §6.4 写死「每个阶段只要动了配置形状,前后端两个校验器必须
 * 同一个 PR 里一起改」——前端宽后端严 = 作者存不上还没理由;前端严后端宽 = 新字段永远
 * 配不出来。本测试把**后端那份档位表读进来对拍**,跟 publish-present-choice-contract
 * 同一个套路:两处独立记录,改名就至少有一个见证人会红。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')

const ROOT = path.resolve(__dirname, '../..')
const BACKEND = path.resolve(ROOT, '../chengyinhub-system/src/main/java/com/chengyinhub/business'
  + '/service/support/AdvancedGameConfigValidator.java')

test('前端档位表与后端 CHECK_TIERS 逐字一致', () => {
  const java = fs.readFileSync(BACKEND, 'utf8')
  const m = java.match(/CHECK_TIERS\s*=\s*setOf\(([^)]*)\)/)
  assert.ok(m, '后端 CHECK_TIERS 没找到 —— 改名了就该红')
  const backend = m[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
  assert.deepEqual(cfg.MISTAKE_TIERS, backend,
    '前后端档位表漂移:后端 ' + JSON.stringify(backend) + ' vs 前端 ' + JSON.stringify(cfg.MISTAKE_TIERS))
})

test('后端确实对 mistakeTier 有形状闸(不是只有前端拦)', () => {
  const java = fs.readFileSync(BACKEND, 'utf8')
  assert.match(java, /validateMistakeTier/, '后端少了 validateMistakeTier,前端单边校验等于没校验')
  assert.match(java, /mistakeTier 只能是 easy、medium 或 hard/)
})

test('三档放行,其余一律拒', () => {
  for (const tier of cfg.MISTAKE_TIERS) {
    assert.equal(cfg.mistakeTierError({ mistakeTier: tier }), '', tier + ' 该放行')
  }
  for (const bad of ['nightmare', 'EASY', '', ' ', 1, true, {}]) {
    assert.notEqual(cfg.mistakeTierError({ mistakeTier: bad }), '',
      JSON.stringify(bad) + ' 该被拒 —— 坏值不许在本页悄悄落回 easy')
  }
})

/* 前端 text() 会 trim,后端 CHECK_TIERS.contains() 是精确匹配 —— 这是一处真实的宽严差异。
   它之所以不构成漂移,只因为 normalize 先把值 trim 了再存,后端永远见不到带空格的值。
   把这条依赖钉死:哪天 normalize 不 trim 了,作者存得下、发布必被后端拒,这里先红。 */
test('带空格的档位由 normalize 收口,后端见不到空白', () => {
  assert.equal(cfg.mistakeTierError({ mistakeTier: 'easy ' }), '', '前端 trim 后视为合法')
  assert.equal(cfg.normalize({ schemaVersion: 1, mistakeTier: 'easy ' }).mistakeTier, 'easy',
    'normalize 必须 trim —— 否则后端精确匹配会拒,而作者在本页看不到任何理由')
})

test('不配 = 合法(运行期按 easy 走,与并入难度表前的固定 -1 等价)', () => {
  assert.equal(cfg.mistakeTierError({}), '')
  assert.equal(cfg.mistakeTierError({ mistakeTier: null }), '')
})

test('normalize:配了原样留,空值不留键', () => {
  const kept = cfg.normalize({ schemaVersion: 1, mistakeTier: 'hard' })
  assert.equal(kept.mistakeTier, 'hard', '配了就得带上,否则作者存完就丢')
  const dropped = cfg.normalize({ schemaVersion: 1, mistakeTier: '  ' })
  assert.ok(!('mistakeTier' in dropped), '空值该删键,别留一份谁也没配的档位')
})
