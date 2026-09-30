'use strict'

// 商家档创作模式只读(2026-09-05 用户拍板「加」)。
//
// ★ 这条契约防的是「只挡看得见的那条路」:模式卡的 tap 落在 openModePicker,
//   但真正会改 productType 的是 requestModeSwitch —— confirmModePicker 之外还有别的
//   调用点会走到它。只在 openModePicker 上加闸,卡看着锁了、模式照样能被换掉,且零报错。
//
// 为什么商家档要锁:商家是从营销中心的「主题 / 自由探索」两个入口分别进来的
// (pages/merchant/marketing/index.js 的 CONTENT_ROUTES,一条带 mode=2),
// 模式在进这一页之前就选完了。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = path.join(ROOT, 'pages/publish/fabu/index.js')
const WXML_PATH = path.join(ROOT, 'pages/publish/fabu/index.wxml')

// 取某个方法体的前若干行 —— 闸必须在方法开头就 return,不能埋在分支里
function head(source, name, lines = 6) {
  const at = source.indexOf('\n  ' + name + '(')
  assert.ok(at >= 0, `找不到方法 ${name}`)
  return source.slice(at).split('\n').slice(0, lines + 1).join('\n')
}

function assertContract(overrides = {}) {
  const js = overrides.js === undefined ? fs.readFileSync(JS_PATH, 'utf8') : overrides.js
  const wxml = overrides.wxml === undefined ? fs.readFileSync(WXML_PATH, 'utf8') : overrides.wxml

  for (const name of ['openModePicker', 'requestModeSwitch']) {
    assert.match(
      head(js, name),
      /if \(this\.data\.operationScope === 'MERCHANT'\) return;/,
      `${name} 必须在方法开头就挡住商家档`,
    )
  }

  // 卡面要说清楚为什么点不动 —— 一个静默不响应的按钮比禁用态更糟
  assert.match(wxml, /operationScope === 'MERCHANT'[^>]*创作模式已固定/, '模式卡缺少锁定态的可读名称')
  assert.match(wxml, /商家发布固定/, '模式卡缺少锁定态文案')
}

test('商家档创作模式只读，闸落在两个入口而不只是选择器', () => {
  assertContract()
})

// 负控:只挡 openModePicker、放开真正的写入口,必须判红
test('负控：只挡选择器、放开 requestModeSwitch 会判红', () => {
  const js = fs.readFileSync(JS_PATH, 'utf8').replace(
    /(requestModeSwitch\(e\) \{)([\s\S]{0,400}?)\n    if \(this\.data\.operationScope === 'MERCHANT'\) return;/,
    '$1$2',
  )
  assert.throws(() => assertContract({ js }), /requestModeSwitch 必须在方法开头就挡住商家档/)
})

test('负控：锁定态没有文案会判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8').replace(/商家发布固定/g, '切换')
  assert.throws(() => assertContract({ wxml }), /锁定态文案/)
})
