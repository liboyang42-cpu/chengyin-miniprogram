'use strict'

/* 编辑玩法模板页:单选一律用下拉(2026-09-22 用户定)
 *
 * 用户原话:「选项不要这样 要下拉框 …… 不是全部显示出来点击的」,随后「全页都统一成下拉」。
 * 下拉 = 同页已有的 cy-dropdown(就地展开,≤7 项互斥单选),不是底部整屏滚轮。
 *
 * 不在本条范围的(不是「N 选 1 的选项组」,或另有人在改):
 *   · 玩法类别 —— 多选标签,点了跳选择页;
 *   · 各选项行里的「设为正确答案」—— 是给某一行打标,不是从一组里挑一个;
 *   · 检定段(难度 / 条件修正)—— feat/mods-picker-0922 正在把它改成下拉 + 开关,这里不重复做。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const DIR = path.join(ROOT, 'pages/publish/temp')
const WXML = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')

function checkSection(src) {
  const start = src.indexOf("gameSection === 'check'")
  return src.slice(start, src.indexOf('<view class="cg-gcfg"', start + 1))
}

/* 不只扫 cg-chip:掷骰「几颗」用的是 cg-adv-answer、勋章样式用的是 cg-ms-opt,上一版只认 cg-chip 就漏了这两组。
   判据改成「检定段以外,任何 aria-role="radio" 的元素都只能是给某一行打标的正确答案」。 */
const ANSWER_MARKERS = new Set(['pickCorrectPicture', 'pickCorrectOption', 'setBlindAnswer'])

test('检定段以外,页上没有「平铺一排点着选」的单选(只剩给某一行打标的正确答案)', () => {
  const outside = WXML.replace(checkSection(WXML), '')
  const radios = outside.match(/<view\b[^>]*aria-role="radio"[^>]*>/g) || []
  const leftovers = radios
    .map((tag) => (/bindtap="(\w+)"/.exec(tag) || [, '(无处理器)'])[1])
    .filter((handler) => !ANSWER_MARKERS.has(handler))
  assert.deepEqual(leftovers, [], '还有单选没改成下拉')
})

test('十组单选都是 cy-dropdown,且接回原来那个处理器', () => {
  const groups = [
    ['玩法形态', 'onPickInteraction'],
    ['这个玩法怎么出现', 'onPickPresent'],
    ['扫码后回什么', 'pickScanKind'],
    ['分类条目归哪一类', 'setClassifyBin'],
    ['画像问题的作答方式', 'pickProfileKind'],
    ['画像选项的加成方式', 'pickEffectOp'],
    ['拍照次数用尽', 'pickPhotoCheckFallback'],
    ['掷骰几颗', 'onDiceCount'],
    ['D20 掷骰方式', 'onD20RollMode'],
    ['勋章样式', 'onMedalStyle'],
  ]
  for (const [name, handler] of groups) {
    const re = new RegExp('<cy-dropdown [^>]*bind:change="' + handler + '"')
    assert.match(WXML, re, name + ' 没改成下拉')
  }
})

test('「只能整屏」时呈现方式下拉整个置灰,原因照旧写出来', () => {
  assert.match(WXML, /<cy-dropdown [^>]*disabled="\{\{presentInlineLocked\}\}"[^>]*bind:change="onPickPresent"/)
  assert.match(WXML, /只能整屏：\{\{presentLockReason\}\}/)
})

/* 空值(没选过 / 老模板里存了不认识的值)统一显示「请选择」,不留一个空白框 */
function loadOptWxs() {
  const src = /<wxs module="opt">([\s\S]*?)<\/wxs>/.exec(WXML)[1]
  const module = { exports: {} }
  new Function('module', src)(module)
  return module.exports
}

test('下拉显示:找得到就显示那一项;找不到一律「请选择」;没起名的类别按序号叫', () => {
  const opt = loadOptWxs()
  const list = [{ key: 'a', label: '甲' }, { key: 'b', label: '' }]
  assert.equal(opt.label(list, 'a'), '甲')
  assert.equal(opt.label(list, 'zzz'), '请选择', '老模板存了不认识的值')
  assert.equal(opt.label(list, undefined), '请选择', '还没选过')
  assert.equal(opt.label([{ id: 'b1', label: '' }], 'b1', 'id', '类别 '), '类别 1')
  assert.equal(opt.idx(list, 'zzz'), -1, '找不到 = -1,面板里不打勾')
})

test('每个下拉触发器上显示的字都走 opt.label,不自己拿下标去取', () => {
  assert.doesNotMatch(WXML, /\[opt\.idx\(/, '拿 -1 去取 list[-1] 就是空白框')
})

function loadPage() {
  const vm = require('../helpers/ui-sandbox-vm.js')
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined })
  let opts
  const sandbox = { Page: (o) => { opts = o }, getApp: () => ({ globalData: {} }), wx: noop, console, setTimeout, clearTimeout,
    getCurrentPages: () => [], require: (r) => require(path.resolve(DIR, r)) }
  vm.runInNewContext(fs.readFileSync(path.join(DIR, 'index.js'), 'utf8'), sandbox, { filename: path.join(DIR, 'index.js') })
  return opts
}

/** 用页面自己的方法拼一个假实例;写入全部记下来。页面在 vm 里跑,对象过一遍 JSON 再比。 */
function instance(dataPatch) {
  const page = loadPage()
  const calls = []
  const self = Object.assign({}, page, {
    data: Object.assign(JSON.parse(JSON.stringify(page.data)), dataPatch || {}),
    _setFormState: (patch) => calls.push(JSON.parse(JSON.stringify(patch))),
    setData: (patch, cb) => { calls.push(JSON.parse(JSON.stringify(patch))); if (cb) cb() },
    refreshPreviewState: () => {},
  })
  return { self, calls }
}
const pick = (value, dataset) => ({ detail: { value }, currentTarget: { dataset: dataset || {} } })

test('下拉选第 N 项 = 存第 N 项的 key(存 key 不存中文)', () => {
  const { self, calls } = instance()
  self.onPickInteraction(pick(2))
  self.pickScanKind(pick(2))
  self.pickPhotoCheckFallback(pick(self.data.photoCheckFallbacks.length - 1))
  assert.equal(calls[0].interactionType, 'photo_spot')
  assert.equal(calls[1]['advanced.scan.kind'], 'IMAGE')
  assert.equal(calls[2]['advanced.photoCheck.fallback'], self.data.photoCheckFallbacks[self.data.photoCheckFallbacks.length - 1].key)
})

test('掷骰几颗、勋章样式:存的是 2 / enamel,不是「两颗」「3D 珐琅」', () => {
  const { self, calls } = instance()
  self.onDiceCount(pick(self.data.diceCountOptions.findIndex((o) => o.key === 2)))
  self.onMedalStyle(pick(self.data.medalStyleOptions.findIndex((o) => o.key === 'enamel')))
  assert.equal(calls[0]['advanced.diceRoll.diceCount'], 2)
  assert.equal(calls[1]['formData.medalStyle'], 'enamel')
})

test('分类:某一条目的下拉选第 N 类 = 把这一条归到第 N 类的 id', () => {
  const classify = { items: [{ id: 'i1', label: '滤杯' }], bins: [{ id: 'b1', label: '器具' }, { id: 'b2', label: '豆子' }], answer: {} }
  const { self, calls } = instance()
  self.data.advanced = Object.assign({}, self.data.advanced, { classify })
  self.setClassifyBin(pick(1, { item: 'i1' }))
  assert.deepEqual(calls[0]['advanced.classify.answer'], { i1: 'b2' })
})

test('画像:问题的作答方式与选项的加成方式都按下标取 key', () => {
  const effects = [{ var: 'counter.energy', op: 'INC', value: 1 }]
  const profile = { questions: [{ key: 'q', label: '你是谁', kind: 'text', options: [{ key: 'A', label: '', effects }, { key: 'B', label: '', effects: [] }] }] }
  const { self, calls } = instance()
  self.data.advanced = Object.assign({}, self.data.advanced, { profile })
  const pickIdx = self.data.profileKinds.findIndex((k) => k.key === 'pick')
  self.pickProfileKind(pick(pickIdx, { index: 0 }))
  assert.equal(calls[0]['advanced.profile.questions'][0].kind, 'pick')

  const tagIdx = self.data.effectOps.findIndex((o) => o.key === 'ADD_TAG')
  self.pickEffectOp(pick(tagIdx, { path: 'profile.questions.0.options.0.effects', index: 0 }))
  const written = JSON.stringify(calls[calls.length - 1])
  assert.ok(written.includes('"op":"ADD_TAG"'), '加成方式没按下标换成 ADD_TAG')
})

test('pickEffectOp 仍认检定段芯片的 data-op(那一段不在本次改动内)', () => {
  const effects = [{ var: 'counter.energy', op: 'INC', value: 1 }]
  const profile = { questions: [{ key: 'q', label: '', kind: 'pick', options: [{ key: 'A', label: '', effects }, { key: 'B', label: '', effects: [] }] }] }
  const { self, calls } = instance()
  self.data.advanced = Object.assign({}, self.data.advanced, { profile })
  self.pickEffectOp({ currentTarget: { dataset: { path: 'profile.questions.0.options.0.effects', index: 0, op: 'DEC' } }, detail: {} })
  assert.ok(JSON.stringify(calls[calls.length - 1]).includes('"op":"DEC"'))
})

test('呈现方式:下拉选「整屏」写 fullscreen;被锁时硬选内嵌也写不进去(真防线在 applyPresent)', () => {
  const { self, calls } = instance({ gameSection: 'qa' })
  const full = self.data.presentOptions.findIndex((o) => o.key === 'fullscreen')
  self.onPickPresent(pick(full))
  assert.equal(calls[0].presentChoice, 'fullscreen')

  const locked = instance({ gameSection: 'reaction' })
  const inline = locked.self.data.presentOptions.findIndex((o) => o.key === 'inline')
  locked.self.onPickPresent(pick(inline))
  assert.deepEqual(locked.calls, [], '「只能整屏」的段被选内嵌,不该写任何东西')
})

/* 2026-09-23 用户:「选框应该下拉应该是向下的箭头」。图标集是脚本生成、禁手改,没有 chevron-down;
   照俱乐部开场页先例(club/event-ops):back(‹)转 -90° = ∨。 */
test('下拉箭头是向下的 ∨,不是斜向的 expand', () => {
  const src = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8')
  assert.doesNotMatch(src, /name="expand"/)
  const carets = src.match(/<view class="cg-caret"><cy-icon name="(\w+)"/g) || []
  assert.ok(carets.length >= 20, '下拉箭头只扫到 ' + carets.length + ' 个')
  assert.ok(carets.every((c) => c.includes('name="back"')))
  assert.match(fs.readFileSync(path.join(DIR, 'index.wxss'), 'utf8'), /\.cg-caret\s*\{[^}]*transform:\s*rotate\(-90deg\)/)
})

test('D20 下拉按选项 key 保存，越界选择不修改配置', () => {
  const { self, calls } = instance()
  const idx = self.data.d20RollModes.findIndex((o) => o.key === 'advantage')
  assert.ok(idx >= 0)
  self.onD20RollMode(pick(idx))
  assert.equal(calls[0]['advanced.diceRoll.rollMode'], 'advantage')
  self.onD20RollMode(pick(999))
  assert.equal(calls.length, 1)
})
