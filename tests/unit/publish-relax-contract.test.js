/* 阶段 4 自适应难度 variants:配置根层的一段,与 present 同级。
 *
 * 为什么要这个文件:施工计划 §6.4 —— 动了配置形状,前后端两个校验器必须同一个 PR 里一起改。
 * 阶段 2 就是漏了这条(后端支持 mistakeTier、编辑器根本配不出来)。这里把**后端的白名单
 * 读进来对拍**:两处独立记录,改名或挪档就至少有一个见证人会红。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')

const ROOT = path.resolve(__dirname, '../..')

/* relaxError 现在要看「这个段启用没有」,所以直调它的用例得给一份段都开着的配置。
   段没启用是另一条闸(见下面两条),别让它混进方向 / 白名单那几条的判定里。 */
const ENABLED = {
  schemaVersion: 1,
  timer: { enabled: true, durationSeconds: 60 },
  typeIn: { enabled: true, seconds: 30, tries: 2 },
  musicCorner: { enabled: true, durationSeconds: 60 },
  sort: { enabled: true, maxAttempts: 2 },
  pricePair: { enabled: true, maxTries: 2 },
  qa: { enabled: true },
  hiddenObject: { enabled: true },
}
const BACKEND = path.resolve(ROOT, '../chengyinhub-system/src/main/java/com/chengyinhub/business'
  + '/service/support/AdvancedGameConfigValidator.java')

/** 从后端 static 块里抽 RELAX_FIELDS.put("路径", "类别") */
function backendRelaxFields() {
  const java = fs.readFileSync(BACKEND, 'utf8')
  const out = { SECONDS: [], ATTEMPTS: [], TOLERANCE: [], LOWER: [] }
  const re = /RELAX_FIELDS\.put\("([^"]+)",\s*"([A-Z]+)"\)/g
  let m
  while ((m = re.exec(java)) !== null) out[m[2]].push(m[1])
  return out
}

test('前后端容错面白名单逐字一致', () => {
  const backend = backendRelaxFields()
  assert.ok(backend.SECONDS.length && backend.ATTEMPTS.length, '后端 RELAX_FIELDS 没抽到 —— 改名了就该红')
  assert.deepEqual(cfg.RELAX_SECONDS, backend.SECONDS, '时长类白名单漂移')
  assert.deepEqual(cfg.RELAX_ATTEMPTS, backend.ATTEMPTS, '次数类白名单漂移')
  assert.deepEqual(cfg.RELAX_TOLERANCE, backend.TOLERANCE, '误差类白名单漂移')
  assert.deepEqual(cfg.RELAX_LOWER, backend.LOWER, '越小越容易类白名单漂移')
})

test('后端确实有 variants 形状闸(不是只有前端拦)', () => {
  const java = fs.readFileSync(BACKEND, 'utf8')
  assert.match(java, /validateVariants/)
  assert.match(java, /validateRelax/)
  assert.match(java, /只能放宽/)
  assert.match(java, /容错面/)
})

test('条数上限两边一致', () => {
  const java = fs.readFileSync(BACKEND, 'utf8')
  const m = java.match(/MAX_STATE_REFS\s*=\s*(\d+)/)
  assert.ok(m, '后端 MAX_STATE_REFS 没找到')
  assert.equal(cfg.MAX_VARIANTS, Number(m[1]))
})

test('收紧一律拒', () => {
  assert.match(cfg.relaxError({ 'timer.durationSeconds': '-10' }, ENABLED), /只能放宽/)
  assert.match(cfg.relaxError({ 'sort.maxAttempts': '-1' }, ENABLED), /只能放宽/)
})

test('题面一个字都不许动', () => {
  for (const p of ['qa.options', 'qa.title', 'qa.xp', 'hiddenObject.hotspots', 'sort.answerOrder']) {
    assert.match(cfg.relaxError({ [p]: '+1' }, ENABLED), /容错面/, p + ' 属题面,必须拒')
  }
})

/* 次数类 0 = 不限:放宽不等于数字变大,大小比较会把两种都判反。 */
test('=0 是放宽,=K 是收紧', () => {
  assert.equal(cfg.relaxError({ 'sort.maxAttempts': '=0' }, ENABLED), '', '改成不限是放宽')
  assert.match(cfg.relaxError({ 'sort.maxAttempts': '=5' }, ENABLED), /只能放宽/, '把不限改成有限次数是收紧')
  assert.match(cfg.relaxError({ 'timer.durationSeconds': '=0' }, ENABLED), /只能放宽/, '时长没有「不限」语义')
})

test('每条都必须带 when', () => {
  const withVariants = (variants) => Object.assign({}, ENABLED, { variants })
  assert.match(cfg.variantsError(withVariants([{ relax: { 'timer.durationSeconds': '+30' } }])), /必须带 when/)
  assert.equal(cfg.variantsError(withVariants([{ when: {}, relax: { 'timer.durationSeconds': '+30' } }])), '')
})

test('不配 = 合法', () => {
  assert.equal(cfg.variantsError({}), '')
})

/* 「配了等于没配」的两条闸:后端 validateRelax 与本页同判据。
 * 不在本页拦 = 作者存得下、发布被后端拒、且看不到理由。 */
test('relax 指向未启用的玩法段:两边都拒', () => {
  const java = fs.readFileSync(BACKEND, 'utf8')
  assert.match(java, /没有启用/, '后端少了这条闸,前端单边拦等于没拦')
  assert.match(
    cfg.variantsError({
      schemaVersion: 1,
      timer: { enabled: true, durationSeconds: 60 },
      variants: [{ when: {}, relax: { 'typeIn.seconds': '+10' } }],
    }),
    /没有启用/)
})

test('底值已经是不限还要 +N:两边都拒', () => {
  const java = fs.readFileSync(BACKEND, 'utf8')
  assert.match(java, /已经是不限/)
  assert.match(
    cfg.variantsError({
      schemaVersion: 1,
      sort: { enabled: true, maxAttempts: 0 },
      variants: [{ when: {}, relax: { 'sort.maxAttempts': '+3' } }],
    }),
    /已经是不限/)
})

/* 越界改成发布期判红之后,运行期不该再留「夹值」那一手 ——
 * 留着就是把作者写的数字悄悄抹平,两头都不报错。 */
test('运行期不再夹值(越界由发布期拒)', () => {
  const runtime = fs.readFileSync(
    path.resolve(ROOT, '../chengyinhub-system/src/main/java/com/chengyinhub/business'
      + '/service/impl/AdvancedGameRuntimeServiceImpl.java'), 'utf8')
  assert.doesNotMatch(runtime, /Math\.min\(value,/, '运行期又出现夹值 —— 越界会被悄悄抹平')
  assert.doesNotMatch(fs.readFileSync(BACKEND, 'utf8'), /RELAX_MAX/,
    '上界的真源只该有各 kit 校验器那一份,别再抄第二张表')
})

/* 次数类字段缺省即 0 即不限 —— 只认显式 0 会漏掉「不写」那一半,
 * 而那一半 +N 是把不限变成只剩 N 次,方向是收紧。前后端同判据。 */
test('缺省的次数字段与显式 0 同判:都算不限', () => {
  const java = fs.readFileSync(BACKEND, 'utf8')
  assert.doesNotMatch(java, /isIntegralNumber\(\) && base\.intValue\(\) == 0/,
    '后端又回到「只认显式 0」,缺省那一半会被放行成收紧')
  for (const seg of [{ sort: { enabled: true } }, { typeIn: { enabled: true, seconds: 30 } }]) {
    const key = Object.keys(seg)[0]
    const field = key === 'sort' ? 'sort.maxAttempts' : 'typeIn.tries'
    assert.match(
      cfg.variantsError(Object.assign({ schemaVersion: 1 }, seg,
        { variants: [{ when: {}, relax: { [field]: '+3' } }] })),
      /已经是不限/, field + ' 缺省时必须拒')
  }
})

/* 2026-09-23 走查 W-01:音乐角的 durationSeconds 只是进度条上的曲目时长,音乐角不判定通关 ——
 * 「放宽」它对玩家难度毫无作用。编辑器不许再给这个选项,前端校验也要拒(后端同步见上面的逐字对拍)。 */
test('音乐角曲目时长不是容错面:不出选项、前端也拒', () => {
  const offered = cfg.relaxChoices(ENABLED).map((c) => Object.keys(c.relax)[0])
  assert.ok(!offered.includes('musicCorner.durationSeconds'), '编辑器又把音乐角时长当放宽选项给出去了')
  assert.ok(offered.includes('timer.durationSeconds'), '对照:真正的容错面(限时)还得在')
  assert.match(cfg.relaxError({ 'musicCorner.durationSeconds': '+30' }, ENABLED), /容错面/)
})

/* 放宽改的是限时 / 打字 / 排序 / 比价的容错面,入口得在这些玩法都看得到的「高级玩法」卡里;
 * 放在检定段时,检定模板里唯一能放宽的就是音乐角,而真正该用它的模板根本看不到入口。 */
test('「状态不好时松一点」住在高级玩法卡,不在检定段', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/temp/index.wxml'), 'utf8')
  const at = wxml.indexOf('bindchange="toggleRelax"')
  assert.ok(at > 0, '放宽开关不见了')
  const checkStart = wxml.indexOf("gameSection === 'check'")
  const checkEnd = wxml.indexOf('<view class="cg-gcfg"', checkStart + 1)
  assert.ok(!(at > checkStart && at < checkEnd), '放宽又回到检定段里了')
  assert.ok(at > wxml.indexOf('id="sec-advanced"'), '放宽应该在「高级玩法」卡里')
})

/* 2026-09-23 扩面:更多次数字段 + 判定误差。选项必须是后端会收的那种 —— 超上界的不给。 */
test('误差与新增次数字段:出选项、方向对、不越界', () => {
  const m = {
    schemaVersion: 1,
    compass: { enabled: true, tolerance: 20 },
    stopwatch: { enabled: true, toleranceMs: 300, tries: 9 },
    estimate: { enabled: true, tolerance: 2.5 },
    qa: { enabled: true, maxTries: 3 },
  }
  const byKey = {}
  for (const c of cfg.relaxChoices(m)) byKey[c.key] = c.relax
  assert.deepEqual(byKey['compass.tolerance'], { 'compass.tolerance': '+15' })
  assert.deepEqual(byKey['stopwatch.toleranceMs'], { 'stopwatch.toleranceMs': '+300' })
  assert.deepEqual(byKey['estimate.tolerance'], { 'estimate.tolerance': '+3' })
  assert.deepEqual(byKey['qa.maxTries:more'], { 'qa.maxTries': '+2' })
  assert.ok(!byKey['stopwatch.tries:more'], '9 + 2 超过上界 10,不该给「多 2 次」')
  assert.deepEqual(byKey['stopwatch.tries:free'], { 'stopwatch.tries': '=0' })
  assert.ok(!cfg.relaxChoices({ compass: { enabled: true, tolerance: 80 } }).length, '80 + 15 超过 90,不该给')
  assert.equal(cfg.relaxError({ 'compass.tolerance': '=60' }, m).includes('证明不了'), true, '误差不许 =N')
  assert.match(cfg.relaxError({ 'photoCheck.maxTries': '+2' }, { photoCheck: { enabled: true, maxTries: 2 } }), /不在白名单/)
})

/* 2026-09-24 挑战类补齐:越小越容易的只能 -N;选项不越 kit 下界;弹球没开限时不给时长选项。 */
test('挑战类:坚持几秒 / 撞几次只能往小里放宽,选项在下界之上', () => {
  const m = {
    schemaVersion: 1,
    quietHold: { enabled: true, seconds: 12 },
    shout: { enabled: true, seconds: 6 },
    compass: { enabled: true, holdSeconds: 3, tolerance: 20 },
    ballShake: { enabled: true, goal: 20, timed: false, seconds: 10 },
    reaction: { enabled: true, rounds: 3, goalMs: 400 },
  }
  const byKey = {}
  for (const c of cfg.relaxChoices(m)) byKey[c.key] = c.relax
  assert.deepEqual(byKey['quietHold.seconds'], { 'quietHold.seconds': '-4' })
  assert.deepEqual(byKey['compass.holdSeconds'], { 'compass.holdSeconds': '-1' })
  assert.deepEqual(byKey['ballShake.goal'], { 'ballShake.goal': '-7' })
  assert.deepEqual(byKey['reaction.goalMs'], { 'reaction.goalMs': '+150' })
  assert.ok(!byKey['shout.seconds'], '6 - 2 = 4 低于下界 5,不该给')
  assert.ok(!byKey['ballShake.seconds'], '弹球没开限时,不该给时长选项')
  m.ballShake.timed = true
  assert.ok(cfg.relaxChoices(m).some((c) => c.key === 'ballShake.seconds'))
  assert.match(cfg.relaxError({ 'quietHold.seconds': '+3' }, m), /只能写 -N/)
  assert.equal(cfg.relaxError({ 'quietHold.seconds': '-3' }, m), '')
  assert.match(cfg.relaxError({ 'compass.tolerance': '-5' }, m), /收紧/)
  m.ballShake.timed = false
  assert.match(cfg.relaxError({ 'ballShake.seconds': '+5' }, m), /没开限时/)
})
