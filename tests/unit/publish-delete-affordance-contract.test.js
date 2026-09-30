// 删除动作的图标口径(2026-09-06 用户裁决:「你来判断什么时候用 trash bin 什么时候用这个 x」)
//
//   垃圾桶 trash-2 = 会丢掉【只存在于这里】的东西 ⇒ 所以它必须先二次确认(或给撤销窗口)
//   ✕ close/close-sm = 只是摘掉一个引用/挂件,原件还在别处 ⇒ 所以点了就走、不弹确认
//
// 这条规则不是审美偏好,它有可验证的锚:**图标必须和这个 handler 到底弹不弹确认对得上**。
// 图标是「后果」的预告,预告和实际后果不一致,就是在骗人 —— 要么图标错,要么确认该加/该去。
// 图标真源:品牌手册 0kqS1aPs7etjkxjMZy6Bwc(trash-2 = 591:2645 · close = 70:82)。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const XCX = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(XCX, p), 'utf8')

const WXML = 'pages/publish/fabu/index.wxml'
const JS = 'pages/publish/fabu/index.js'

const TRASH = 'trash-2'
const CROSS = ['close', 'close-sm']

/** 取出 js 里某个方法的函数体(大括号配平),用来判断它弹不弹确认 */
function bodyOf(js, name) {
  const head = js.indexOf('\n  ' + name + '(')
  if (head < 0) return null
  let i = js.indexOf('{', head)
  let depth = 0
  for (let j = i; j < js.length; j += 1) {
    if (js[j] === '{') depth += 1
    else if (js[j] === '}') {
      depth -= 1
      if (depth === 0) return js.slice(i, j + 1)
    }
  }
  return null
}

/** 扫 wxml:凡是绑了 remove / delete 开头 handler 的元素,配上它自己那枚 cy-icon */
function affordances(wxml) {
  const out = []
  const re = /<view[^>]*?(?:bind|catch)tap="((?:remove|delete)[A-Za-z]*)"[^>]*>/g
  let m
  while ((m = re.exec(wxml))) {
    const chunk = wxml.slice(m.index, m.index + 600)
    const icon = /<cy-icon\s+name="([a-z0-9-]+)"/.exec(chunk)
    if (icon) out.push({ handler: m[1], icon: icon[1] })
  }
  return out
}

function violations(wxml, js) {
  return affordances(wxml).filter((a) => {
    const body = bodyOf(js, a.handler)
    if (!body) return false                       // handler 不在本页(不判)
    const confirms = /modal\.show\(/.test(body)
    return confirms ? a.icon !== TRASH : CROSS.indexOf(a.icon) < 0
  })
}

test('发布页每个删除键的图标,必须和它到底弹不弹确认对得上', () => {
  const list = affordances(read(WXML))
  assert.ok(list.length >= 5, '一个都没扫到 = 扫描器坏了,全绿在这里等于没测;实测 ' + list.length)
  assert.deepEqual(
    violations(read(WXML), read(JS)).map((v) => v.handler + '→' + v.icon), [],
    '弹确认的必须用 trash-2(会丢东西),不弹确认的必须用 close/close-sm(只是摘引用)',
  )
})

test('★负控:把不弹确认的图片块换回垃圾桶,必须判红', () => {
  const wxml = read(WXML).replace(
    /(aria-label="删除图片块"[\s\S]{0,200}?)<cy-icon name="close"/,
    '$1<cy-icon name="trash-2"',
  )
  assert.notEqual(wxml, read(WXML), '负控没改动到目标片段,这条负控是假的')
  assert.ok(violations(wxml, read(JS)).length > 0, '换错图标居然还是绿的 —— 这条合同没有效力')
})

test('★负控:把弹确认的文字块换成 ✕,同样必须判红', () => {
  const wxml = read(WXML).replace(
    /(aria-label="删除文字块"[\s\S]{0,200}?)<cy-icon name="trash-2"/,
    '$1<cy-icon name="close"',
  )
  assert.notEqual(wxml, read(WXML), '负控没改动到目标片段,这条负控是假的')
  assert.ok(violations(wxml, read(JS)).length > 0, '换错图标居然还是绿的 —— 这条合同没有效力')
})

test('图标真源:trash-2 与 close 都必须在 icons.wxss 里真有 mask', () => {
  const icons = read('components/cy/icon/icons.wxss')
  for (const name of [TRASH].concat(CROSS)) {
    assert.match(icons, new RegExp('\\.cyi--' + name + '\\s*\\{'), name + ' 没有 mask,会静默渲染成空白')
  }
})
