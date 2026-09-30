/* 契约 §1.5 呈现方式(2026-09-18 用户拍板):创作端(Worker C)——
 *   ① 玩法单子上加「这个玩法怎么出现」二选一:内嵌故事流 / 整屏;
 *   ② 默认值照契约三档表,一个段都不许挪档(默认选中态,不写进配置也生效);
 *   ③ 「只能全屏」那批的开关**置灰并写明原因**(不是藏起来),点了也不许改出服务端必拒的配置;
 *   ④ diceRoll 例外:默认整屏,但 inline 必须放行 —— 两种写法都保留。
 *
 * 为什么把表抄死在测试里:后端 validator 按同一份契约写,挪档或改名要到保存/发布才暴露;
 * 这张表必须有两处独立记录,改名就至少有一个见证人会红。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/* 契约 §1.5 三档表,逐字抄。
 * 2026-09-22 现场感契约 S2:新增 compass 进「只能全屏」档 —— 罗盘盘面就是整屏
 * 判定区,与 reaction/quietHold 同因(设备能力),置灰原因句子不变。
 * 2026-09-22 现场感契约 S3b:新增 shout 进「只能全屏」档 —— 与 quietHold 同因
 * (设备麦克风 + 整屏电平反馈),置灰原因句子不变。 */
/* 2026-09-24 blindTaste 撤出:它的外壳是 cy-sheet(半屏),而内嵌要放进 .chfull__para,
   那个段落恒带 transform+filter,是 fixed 后代的包含块 —— 半屏弹层会被圈进去跟着糊。
   撤的是做不到的声明,组件(Figma v5.1 稿)不动。见 playkit-shell-present-contract。 */
const INLINE_DEFAULT = ['qa', 'branch', 'predict', 'pricePair', 'random']
const FULLSCREEN_ONLY = ['reaction', 'ballShake', 'countdown', 'stopwatch', 'quietHold',
  'coinFlip', 'hiddenObject', 'scan', 'steps', 'compass', 'shout', 'blindTaste']
const DICE = 'diceRoll'

test('★默认表逐段对账:可内嵌默认内嵌五个(0924 撤 blindTaste)、只能全屏十二个(含半屏盲品),diceRoll 默认整屏但可内嵌', () => {
  assert.deepEqual(cfg.PRESENT_INLINE_DEFAULT, INLINE_DEFAULT)
  assert.deepEqual(cfg.PRESENT_FULLSCREEN_ONLY, FULLSCREEN_ONLY)
  assert.equal(cfg.PRESENT_LOCK_REASON,
    '判定依赖整屏几何或设备能力（整屏就是判定区 / 墙就是手机四条边 / 整屏被油盖住）',
    '置灰原因必须逐字照抄契约 §1.5')
  for (const section of INLINE_DEFAULT) {
    assert.equal(cfg.defaultPresent(section), 'inline', section + ' 的默认档被挪了')
    assert.equal(cfg.presentInlineLocked(section), false)
  }
  for (const section of FULLSCREEN_ONLY) {
    assert.equal(cfg.defaultPresent(section), 'fullscreen')
    assert.equal(cfg.presentInlineLocked(section), true, section + ' 必须置灰内嵌档')
  }
  assert.equal(cfg.defaultPresent(DICE), 'fullscreen', 'diceRoll 默认是整屏(用户两种写法都在,默认照旧)')
  assert.equal(cfg.presentInlineLocked(DICE), false, 'diceRoll 不许被锁:内嵌那套是用户点名要保留的')
})

test('★玩法目录里每个段都有明确档位,没有漏网的默认漂移', () => {
  for (const section of catalog.GAME_SECTIONS) {
    const expected = INLINE_DEFAULT.indexOf(section) >= 0 ? 'inline' : 'fullscreen'
    assert.equal(cfg.defaultPresent(section), expected, section + ' 的档位与契约表不一致')
  }
  // 目录里这十个正是「只能全屏」那批 —— 多一个少一个都会被上面两条抓到,
  // 这里再钉一次交集,防有人只改目录不改表
  const lockedInCatalog = catalog.GAME_SECTIONS.filter((s) => cfg.presentInlineLocked(s))
  assert.deepEqual(lockedInCatalog.sort(), FULLSCREEN_ONLY.filter(s => s !== 'blindTaste').sort()) // 盲品已退出现有创作目录，存量运行态仍需限制内嵌
})

test('★「只能全屏」段配 inline:本地校验必须真拒,并写出原因', () => {
  const m = cfg.defaultConfig()
  m.reaction.enabled = true
  m.present = 'inline'
  const error = cfg.validate(m)
  assert.match(error, /reaction 只能整屏/, '服务端必拒的配置在本页必须先拦下来')
  assert.ok(error.includes(cfg.PRESENT_LOCK_REASON), '拒的理由要照抄契约那句')
  // 同一条链路的正例:改成整屏就合法
  m.present = 'fullscreen'
  assert.equal(cfg.validate(m), '')
})

test('★diceRoll 配 inline 必须放行(用户点名两种写法都保留);不认识的 present 必须拒', () => {
  const inlineDice = cfg.defaultConfig()
  inlineDice.diceRoll.enabled = true
  inlineDice.diceRoll.faces = ['一', '二', '三', '四', '五', '六']
  inlineDice.present = 'inline'
  assert.equal(cfg.validate(inlineDice), '', 'diceRoll 的内嵌那套被误当「只能全屏」拦了')

  const weird = cfg.defaultConfig()
  weird.qa.enabled = true
  weird.qa.title = '题'
  weird.qa.answerText = '答案'
  weird.present = 'halfscreen'
  assert.match(cfg.validate(weird), /呈现方式/, '不认识的 present 不许静默落默认表')
})

test('★present 往返一字不差;没开任何玩法段时被清掉,不冒充一份空配置', () => {
  const m = cfg.defaultConfig()
  m.qa.enabled = true
  m.qa.title = '题'
  m.qa.answerText = '答案'
  m.present = 'fullscreen'          // 作者显式把默认内嵌的 qa 配成整屏:必须存得住
  const saved = JSON.parse(cfg.serialize(m))
  assert.equal(saved.present, 'fullscreen')
  const back = cfg.parse(cfg.serialize(m))
  assert.equal(back.value.present, 'fullscreen')
  assert.equal(back.error, '')

  const empty = cfg.defaultConfig()
  empty.present = 'inline'          // 一个段都没开:present 没有意义
  assert.equal(cfg.serialize(empty), '', '空配置里残留的 present 会让「没配高级玩法」判定失真')
})

test('★换玩法时的失效处理:切到「只能全屏」段清掉 inline;切到可内嵌段保持', () => {
  const base = cfg.defaultConfig()
  base.qa.enabled = true
  base.present = 'inline'

  const toReaction = catalog.applyToConfig(base, 'react')
  assert.equal(toReaction.reaction.enabled, true)
  assert.equal('present' in toReaction, false, '切到只能全屏的段还留着 inline,下次保存必被服务端拒')

  const toNote = catalog.applyToConfig(base, 'note')
  assert.equal(toNote.note.enabled, true)
  assert.equal(toNote.present, 'inline', 'note 可内嵌:作者的选择要跟着走')

  // 显式整屏在切换时也不该被莫名删掉(它对新段同样合法)
  const full = cfg.defaultConfig()
  full.qa.enabled = true
  full.present = 'fullscreen'
  assert.equal(catalog.applyToConfig(full, 'react').present, 'fullscreen')

  // 选了主题级九宫格:没有玩法段,present 一并清掉
  const toBingo = catalog.applyToConfig(base, 'bingo')
  assert.equal('present' in toBingo, false)
})

test('★置灰的开关不是防线就够:applyPresent 对「只能全屏」段必须真返回 null', () => {
  const m = cfg.defaultConfig()
  m.reaction.enabled = true
  assert.equal(cfg.applyPresent(m, 'reaction', 'inline'), null,
    '被点到也放行 = 作者能配出服务端必拒的配置')
  assert.equal(cfg.applyPresent(m, 'reaction', 'fullscreen').present, 'fullscreen')
  assert.equal(cfg.applyPresent(m, DICE, 'inline').present, 'inline', 'diceRoll 的内嵌必须走得通')
  assert.equal(cfg.applyPresent(m, 'qa', 'halfscreen'), null, '不认识的值不许写进配置')
})

test('★编辑器真有一块二选一开关,置灰说明与点击 handler 都绑在页面上', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const js = read('pages/publish/temp/index.js')
  assert.ok(wxml.includes('这个玩法怎么出现'), '编辑器没有呈现方式这一块')
  // 2026-09-22 用户定全页单选改下拉:两档从两颗芯片变成 presentOptions 里的两项
  assert.ok(js.includes("key: 'inline'") && js.includes("key: 'fullscreen'"),
    '二选一的两档没有绑定')
  assert.ok(wxml.includes('presentInlineLocked') && wxml.includes('presentLockReason'),
    '「只能全屏」那批没有置灰与原因展示')
  assert.ok(/<cy-dropdown [^>]*range="\{\{presentOptions\}\}"[^>]*bind:change="onPickPresent"/.test(wxml), '开关没有接上 handler')
  assert.ok(js.includes('onPickPresent') && js.includes('applyPresent'),
    'handler 没走真防线(applyPresent),只靠 WXML 属性拦不住点击')
})
