/* objectCard(拍物成卡)接进玩法目录 —— 施工文档 §2.1 / §2.2。
 *
 * 这一屏的断链**不报错**:objectCard 与 photoCheck 共用 photoCheck 段,靠 mode 区分
 * (与 qaText / qaPick / qaShot 共用 qa 段同一姿势)。detectGame 按 ALL 的顺序取第一个
 * section.enabled 的条目,所以顺序与「谁带 mode」两件事必须同时钉死 ——
 * 否则商家配好的老模板会显示成「没选玩法」,或新选的藏品卡被认成普通拍照审核。
 *
 * 文档 §2.2 的三条断言逐条落在下面,外加一条真·负控:把目录源码里两条目的顺序对调,
 * 重新加载一份模块,验证「objectCard 就再也认不出来了」。只有把源码喂进断言,
 * 这条负控才不是恒真的。 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')

const CATALOG_FILE = path.resolve(
  __dirname, '../../pages/publish/utils/publish/node-game-catalog.js')

function positionOf(key) {
  const at = catalog.ALL.findIndex((item) => item.key === key)
  assert.ok(at >= 0, '玩法目录里没有 ' + key)
  return at
}

/** 改一份目录源码再加载一遍(负控用),require.cache 不受影响。 */
function loadCatalog(transformedSource) {
  const mod = new Module(CATALOG_FILE, null)
  mod.filename = CATALOG_FILE
  mod.paths = Module._nodeModulePaths(path.dirname(CATALOG_FILE))
  mod._compile(transformedSource, CATALOG_FILE)
  return mod.exports
}

/** 把 objectCard 那条从「互动类」搬到「挑战类」的 photoCheck **后面** —— 也就是文档
 *  §2.2 警告的那种「哪天有人调了分组顺序」。 */
function moveObjectCardAfterPhotoCheck(src) {
  const card = src.match(/[ \t]*\{ key: 'objectCard'[^\n]*\n/)
  assert.ok(card, '负控构造失败:目录里找不到 objectCard 那一条')
  const withoutCard = src.replace(card[0], '')
  const photoLine = withoutCard.match(/[ \t]*\{ key: 'photoCheck'[^\n]*\n/)
  assert.ok(photoLine, '负控构造失败:目录里找不到 photoCheck 那一条')
  return withoutCard.replace(photoLine[0], photoLine[0] + card[0])
}

test('objectCard 在册:共用 photoCheck 段、带 mode CARD、不叠加第二个段', () => {
  const game = catalog.findGame('objectCard')
  assert.ok(game, '目录里没有 objectCard —— 商家在「选玩法」那一屏根本看不到它')
  assert.equal(game.section, 'photoCheck', '文档 §2.1:不新建段,复用 photoCheck')
  assert.equal(game.mode, 'CARD', '没有 mode 就分不开「拍物成卡」与「拍照审核」')
  assert.equal(game.label, '拍物成卡')
  assert.equal(game.validationMethod, 0, '判定在服务端,不走老的通关校验方式')
})

test('★老模板(配置里没有 mode)仍认出 photoCheck —— 认不出会把商家已有的配置显示成「没选玩法」', () => {
  assert.equal(catalog.detectGame({
    photoCheck: { enabled: true, title: '拍门头', requirement: '拍到招牌上那个字' },
  }), 'photoCheck')
})

test('★新模板(mode CARD)认出 objectCard', () => {
  assert.equal(catalog.detectGame({
    photoCheck: { enabled: true, mode: 'CARD', title: '捡一件东西', requirement: '拍到一件金属的东西' },
  }), 'objectCard')
})

test('★顺序依赖:objectCard 必须排在 photoCheck 前面 —— 反序后新玩法永远认不出来', () => {
  assert.ok(positionOf('objectCard') < positionOf('photoCheck'),
    'objectCard 排在 photoCheck 后面时,无 mode 的 photoCheck 会抢先匹配,藏品卡静默变回普通拍照审核')
  // 同一条依赖的另一半:photoCheck 条目**绝不能**补 mode。
  assert.equal(catalog.findGame('photoCheck').mode, undefined,
    'photoCheck 一旦带上 mode,老模板(配置里没有 mode)就再也认不出玩法了')

  const swapped = loadCatalog(moveObjectCardAfterPhotoCheck(catalogSource()))
  assert.equal(swapped.detectGame({ photoCheck: { enabled: true, mode: 'CARD' } }), 'photoCheck',
    '负控失效:对调顺序后本该认不出 objectCard')
  assert.notEqual(catalog.detectGame({ photoCheck: { enabled: true, mode: 'CARD' } }), 'photoCheck',
    '当前顺序下必须认出 objectCard')
})

function catalogSource() {
  return fs.readFileSync(CATALOG_FILE, 'utf8')
}

test('选中 objectCard 会把 mode 写成 CARD;切回拍照审核必须清掉它', () => {
  const picked = catalog.applyToConfig(cfgDefaults(), 'objectCard')
  assert.equal(picked.photoCheck.enabled, true)
  assert.equal(picked.photoCheck.mode, 'CARD')

  /* 从藏品卡切回普通拍照审核:photoCheck 条目不带 mode,而上一选择留下的
     mode:'CARD' 若不清掉,detectGame 会把它又认成 objectCard —— 商家改完一保存
     发现自己选的玩法被换了回去。这是 qa 那批不曾出现的问题(qa 三条都带 mode)。 */
  const back = catalog.applyToConfig(picked, 'photoCheck')
  assert.equal(back.photoCheck.enabled, true)
  assert.ok(!('mode' in back.photoCheck), '切回拍照审核必须删掉 mode:' + JSON.stringify(back.photoCheck.mode))
})

function cfgDefaults() {
  return require('../../pages/publish/utils/publish/advanced-game-config.js').defaultConfig()
}
