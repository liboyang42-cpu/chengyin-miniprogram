/* Dynamic Type 契约(2026-08-22)
 *
 * 小程序的 rpx 是死值,微信里的字号设置对它完全无效 —— 视力不好的用户把字号调大,界面纹丝不动。
 * 这套断言锁住「跟随」这件事真的成立,而不是写了个变量没人消费。
 *
 * ① 换算是纯函数,边界(非法值/过小/过大)都有确定行为,不会把页面搞炸;
 * ② 字阶 token 真的消费了 --cy-type-scale,且**层级不塌**(等比缩放,不是只放大正文);
 * ③ 超大展示档(data-xl / display)按设计不参与 —— 放大必破版;
 * ④ 挂了 <page-meta> 的页面,js 必须真的算并写入 —— 否则就是个永远为空的样式位。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const fontScale = require('../../utils/font-scale.js')

/* ---------- ① 换算 ---------- */

test('字号换算:默认不放大,调大按比例,超上限夹逼', () => {
  const { scaleFromSetting, MIN_SCALE, MAX_SCALE } = fontScale
  assert.equal(scaleFromSetting(16), 1, '默认 16px 不该放大')
  assert.equal(scaleFromSetting(20), 1.25, '20px 应放大到 1.25')
  assert.equal(scaleFromSetting(64), MAX_SCALE, '超大设置必须夹到上限,否则布局全炸')
  assert.equal(scaleFromSetting(12), MIN_SCALE, '调小不缩小 —— 缩小会把 20rpx 的 micro 档压到不可读')
  assert.ok(MAX_SCALE > 1 && MAX_SCALE <= 1.5, '上限要既有意义又不至于要求换一套布局')
})

test('字号换算:拿不到设置时按不放大处理,绝不抛', () => {
  const { scaleFromSetting, readFontScale } = fontScale
  for (const bad of [undefined, null, NaN, 0, -5, 'abc', {}]) {
    assert.equal(scaleFromSetting(bad), 1, `${String(bad)} 应退化为 1`)
  }
  assert.doesNotThrow(() => readFontScale({}))
  assert.equal(readFontScale({}), 1)
})

test('读取微信字号优先使用 getAppBaseInfo，不触发已废弃的 getSystemInfoSync', () => {
  const originalWx = global.wx
  let legacyCalls = 0
  global.wx = {
    getAppBaseInfo: () => ({ fontSizeSetting: 20 }),
    getSystemInfoSync: () => {
      legacyCalls += 1
      return { fontSizeSetting: 16 }
    },
  }
  try {
    assert.equal(fontScale.readFontScale(), 1.25)
    assert.equal(legacyCalls, 0)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('getAppBaseInfo 异常时安全退化且不触发废弃接口', () => {
  const originalWx = global.wx
  let legacyCalls = 0
  global.wx = {
    getAppBaseInfo: () => { throw new Error('unsupported') },
    getSystemInfoSync: () => {
      legacyCalls += 1
      return { fontSizeSetting: 20 }
    },
  }
  try {
    assert.equal(fontScale.readFontScale(), 1)
    assert.equal(legacyCalls, 0)
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})

test('倍率为 1 时不产生样式串(省掉每页一次无谓 setData)', () => {
  assert.equal(fontScale.pageStyleFor(1), '')
  assert.match(fontScale.pageStyleFor(1.25), /--cy-type-scale:\s*1\.25/)
})

test('负控:去掉上限夹逼必须能被断言抓到', () => {
  const naive = (px) => px / 16          // 没有 clamp 的实现
  assert.equal(naive(64), 4, '变异体确实会给出 4 倍(证明上面那条断言不是恒真)')
  assert.notEqual(fontScale.scaleFromSetting(64), 4)
})

/* ---------- ②③ token 层 ---------- */

const SCALED = ['page-title', 'section-title', 'sheet-title', 'card-title',
                'button', 'body', 'label', 'caption', 'micro']
const NOT_SCALED = ['data-xl', 'display']

test('9 档字阶等比消费 --cy-type-scale(层级不塌)', () => {
  const tokens = read('style/tokens.wxss')
  assert.match(tokens, /--cy-type-scale:\s*1;/, '必须有默认值 1,不注入时行为与改造前等价')
  for (const name of SCALED) {
    const re = new RegExp('--cy-type-' + name + ':\\s*calc\\((\\d+)rpx \\* var\\(--cy-type-scale\\)\\)')
    assert.match(tokens, re, `--cy-type-${name} 必须消费 --cy-type-scale`)
  }
})

test('超大展示档按设计不参与缩放(放大必破版)', () => {
  const tokens = read('style/tokens.wxss')
  for (const name of NOT_SCALED) {
    const decl = new RegExp('--cy-type-' + name + ':\\s*([^;]+);').exec(tokens)
    assert.ok(decl, `找不到 --cy-type-${name}`)
    assert.doesNotMatch(decl[1], /cy-type-scale/,
      `--cy-type-${name} 是 56-64rpx 的巨号,参与缩放必然破版`)
  }
})

test('缩放不改变默认视觉:scale=1 时各档基准值与改造前一致', () => {
  const tokens = read('style/tokens.wxss')
  const expect = { 'page-title': 58, 'section-title': 36, 'sheet-title': 44, 'card-title': 32,
                   button: 32, body: 28, label: 24, caption: 22, micro: 20 }
  for (const [name, base] of Object.entries(expect)) {
    const m = new RegExp('--cy-type-' + name + ':\\s*calc\\((\\d+)rpx').exec(tokens)
    assert.ok(m, `--cy-type-${name} 解析不出基准值`)
    assert.equal(Number(m[1]), base, `--cy-type-${name} 的基准值被改动了(应为 ${base}rpx)`)
  }
})

/* ---------- ④ 页面接线 ---------- */

test('挂了 page-meta 的页面必须真的算并写入字阶(否则是个永远为空的样式位)', () => {
  const pages = ['pages/index/index', 'pages/roam/index', 'pages/talent/list/index',
                 'pages/member/index/index', 'pages/template/index']
  for (const base of pages) {
    const wxml = read(base + '.wxml')
    const js = read(base + '.js')
    assert.match(wxml, /<page-meta[^>]*page-style=/, `${base}.wxml 必须有 page-meta 承载页级样式`)
    assert.match(js, /readPageStyle\(\)/, `${base}.js 必须真的调用 readPageStyle 写入`)
    // 写在 onShow 而非只在 onLoad:用户可能切去微信设置改完字号再切回来
    assert.match(js, /onShow[\s\S]{0,200}readPageStyle\(\)/,
      `${base}.js 必须在 onShow 刷新,只在 onLoad 算一次会漏掉「后台改字号再切回」`)
  }
})

test('page-meta 绑定的字段名与 js 写入的字段名必须对得上', () => {
  for (const base of ['pages/index/index', 'pages/roam/index', 'pages/talent/list/index',
                      'pages/member/index/index', 'pages/template/index']) {
    const field = /<page-meta[^>]*page-style="\{\{\s*([a-zA-Z0-9_]+)\s*\}\}"/.exec(read(base + '.wxml'))
    assert.ok(field, `${base}.wxml 的 page-style 必须绑定一个字段`)
    assert.match(read(base + '.js'), new RegExp(field[1] + '\\s*:\\s*readPageStyle\\(\\)'),
      `${base}:wxml 绑的是 ${field[1]},js 却没往这个字段写 —— 绑错字段等于没接线`)
  }
})
