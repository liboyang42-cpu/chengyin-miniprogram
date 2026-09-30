/* 换玩法时「限时挑战」不能留成看不见的开着(2026-09-23)。
 *
 * 先选排序、开限时,再换成技能检定:限时开关被 wx:if="{{timerAvailable}}" 藏掉,
 * 但 advanced.timer.enabled 还是 true 并且会被存下去。服务端不查「这个玩法支不支持限时」——
 * validateTimer 只看格式,运行期 deadline() 照样给会话挂截止时间,到点 expireIfNeeded
 * 把会话判成 FAILED/EXPIRED。作者看不见、关不掉,玩家那边却真的会超时。
 *
 * 连带的一条:放宽里选过「血量低时多给 30 秒」(relax timer.durationSeconds)的,
 * 计时一关这条放宽就指向没启用的段,前后端 validateRelax 都会拒存;而新玩法下放宽区
 * 可能根本不显示,作者删不掉它。所以换玩法时要一并清掉这类编辑器放宽。
 *
 * 旧版已经存下的「检定 + 开着的限时」同理,打开模板回填时就要关掉(文件末两条)。
 *
 * 负控:把目录源码里那两行修复 / 页面回填那一行删掉,重新加载一份模块,断言 bug 会复现 ——
 * 否则上面的断言就可能是恒真的。 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')

const CATALOG_FILE = path.resolve(
  __dirname, '../../pages/publish/utils/publish/node-game-catalog.js')

function loadCatalog(transformedSource) {
  const mod = new Module(CATALOG_FILE, null)
  mod.filename = CATALOG_FILE
  mod.paths = Module._nodeModulePaths(path.dirname(CATALOG_FILE))
  mod._compile(transformedSource, CATALOG_FILE)
  return mod.exports
}

/** 排序 + 开限时 + 选了「血量低时多给 30 秒」。 */
function sortWithTimerAndRelax(cat) {
  const s = cat.applyToConfig(cfg.defaultConfig(), 'sort')
  s.timer.enabled = true
  const timerRelax = cfg.relaxChoices(s).find((c) => c.key === 'timer.durationSeconds')
  assert.ok(timerRelax, '前置:排序开了限时,放宽里应该有「多给 30 秒」')
  s.variants = [{ when: Object.assign({}, timerRelax.when), relax: Object.assign({}, timerRelax.relax) }]
  return s
}

test('★换到不支持限时的玩法:限时关掉,放宽里不再给「多给 30 秒」', () => {
  assert.equal(catalog.supportsTimer('check'), false, '前置:技能检定不支持限时')
  const next = catalog.applyToConfig(sortWithTimerAndRelax(catalog), 'check')
  assert.equal(next.timer.enabled, false, '限时开关已被藏起来,不能还开着被存下去')
  assert.ok(!cfg.relaxChoices(next).some((c) => c.key === 'timer.durationSeconds'))
})

test('★换玩法后,指向已关段的编辑器放宽被清掉,整份配置能过 variantsError', () => {
  const next = catalog.applyToConfig(sortWithTimerAndRelax(catalog), 'check')
  assert.deepEqual(next.variants, [])
  assert.equal(cfg.variantsError(next), '')
})

test('后台手配的放宽(条件不是编辑器那条)原样留着', () => {
  const s = sortWithTimerAndRelax(catalog)
  const manual = { when: { var: 'sys.hp', op: 'LTE', value: 1 }, relax: { 'timer.durationSeconds': '+60' } }
  s.variants.push(manual)
  assert.deepEqual(catalog.applyToConfig(s, 'check').variants, [manual])
})

test('在两个都支持限时的玩法之间换:作者开的限时和放宽都保留', () => {
  const next = catalog.applyToConfig(sortWithTimerAndRelax(catalog), 'match')
  assert.equal(next.timer.enabled, true)
  assert.equal(next.variants.length, 1)
})

test('负控:删掉修复那两行,bug 复现(证明上面的断言不是恒真)', () => {
  const src = fs.readFileSync(CATALOG_FILE, 'utf8')
  const timerFix = /\n[^\n]*next\.timer\.enabled = false;/
  const relaxFix = /\n[^\n]*next\.variants = next\.variants\.filter\([^\n]*/
  assert.ok(timerFix.test(src) && relaxFix.test(src), '负控构造失败:目录源码里找不到修复那两行')
  const broken = loadCatalog(src.replace(timerFix, '').replace(relaxFix, ''))
  const next = broken.applyToConfig(sortWithTimerAndRelax(broken), 'check')
  assert.equal(next.timer.enabled, true)
  assert.equal(next.variants.length, 1)
})

/* ===== 打开已保存的旧模板(fillFormWithTemplateData):存量「检定 + 开着的限时」要在回填时就关掉 =====
   页面桩与 publish-temp-v51-roundtrip.test.js 同形。 */
const PAGE_FILE = path.resolve(__dirname, '../../pages/publish/temp/index.js')
let pageConfig = null
global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: () => {}, getAuthorization: () => 'Bearer test', getUserID: () => 101,
  getUserInfo: () => null, getToken: () => '', chooseImage: () => {}, tips: () => {},
})
global.wx = {
  getStorageSync: () => undefined, setStorageSync: () => {}, removeStorageSync: () => {},
  showToast: () => {}, navigateBack: () => {}, getBackgroundAudioManager: () => ({ stop: () => {} }),
}
global.Page = (config) => { pageConfig = config }

function loadPage(source) {
  const mod = new Module(PAGE_FILE, null)
  mod.filename = PAGE_FILE
  mod.paths = Module._nodeModulePaths(path.dirname(PAGE_FILE))
  mod._compile(source, PAGE_FILE)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (!key.includes('.')) { this.data[key] = value; continue }
      const parts = key.split('.')
      let cursor = this.data
      for (const part of parts.slice(0, -1)) cursor = cursor[part]
      cursor[parts[parts.length - 1]] = value
    }
  }
  page._refreshOutcomeContract = () => ({ items: [], errors: [] })
  page.refreshPreviewState = () => {}
  page.hasModule = () => false
  return page
}

/** 旧版存下的样子:检定 + 开着的限时 + 编辑器选的「多给 30 秒」。 */
function staleSavedJson() {
  const s = sortWithTimerAndRelax(catalog)
  s.sort.enabled = false
  s.check.enabled = true
  return JSON.stringify(s)
}

function openAndSave(source) {
  const page = loadPage(source)
  page.fillFormWithTemplateData({ id: 9, title: '检定', validationMethod: 0, status: 1, advancedConfigJson: staleSavedJson() })
  return { page, saved: JSON.parse(page.prepareFormData().advancedConfigJson) }
}

test('★打开存量模板:藏着的限时回填即关,放宽一并清掉,存回去就修好', () => {
  const { page, saved } = openAndSave(fs.readFileSync(PAGE_FILE, 'utf8'))
  assert.equal(page.data.gameKey, 'check')
  assert.equal(page.data.timerAvailable, false)
  assert.equal(page.data.advanced.timer.enabled, false)
  assert.equal(saved.timer.enabled, false)
  assert.deepEqual(saved.variants || [], [])
})

test('负控:删掉回填那一行,存量模板原样存回(限时仍开着)', () => {
  const src = fs.readFileSync(PAGE_FILE, 'utf8')
  const loadFix = /\n[^\n]*nodeGameCatalog\.dropStaleTimer\(advancedResult\.value[^\n]*/
  assert.ok(loadFix.test(src), '负控构造失败:页面源码里找不到回填时的 dropStaleTimer')
  const { page, saved } = openAndSave(src.replace(loadFix, ''))
  assert.equal(page.data.advanced.timer.enabled, true)
  assert.equal(saved.timer.enabled, true)
})
