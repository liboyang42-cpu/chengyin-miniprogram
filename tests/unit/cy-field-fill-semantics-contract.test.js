'use strict'

/* 输入框填充语义(2026-09-03 用户当面定):
 *   空态一档、填写之后另一档,一眼看出这栏填没填。
 *   暗端:空 = 亮(#3B3B3D)、填 = 暗(#1C1C1E);浅端镜像:空 = 白、填 = 灰。
 *   成功态不描边(填对了是常态,尾部的勾够了);错误态描边保留(它要拦住提交)。
 *
 * 病:改之前两个 token 的方向**正好是反的**(暗端空暗填亮、浅端两档同值),
 * 而且 cy-field 根本没消费它们 —— 无条件画 bg-elevated,
 * 所以"填没填"在界面上看不出来,那两个 token 等于摆设。
 *
 * 负控:把 idle/filled 调回去、或摘掉组件里的 is-filled,本文件必须红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ')

test('暗端:空态比填写态亮(不是反过来)', () => {
  const t = strip(read('style/tokens.wxss'))
  const dm = strip(read('style/dark-mode.wxss'))
  for (const [name, src] of [['tokens.wxss', t], ['dark-mode.wxss', dm]]) {
    const idle = src.match(/--cy-color-input-idle-bg:\s*(#[0-9A-Fa-f]{6})/)
    const filled = src.match(/--cy-color-input-filled-bg:\s*(#[0-9A-Fa-f]{6})/)
    assert.ok(idle && filled, `${name} 里读不到暗端的 input idle/filled`)
    const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    assert.ok(lum(idle[1]) > lum(filled[1]),
      `${name}:空态 ${idle[1]} 必须比填写态 ${filled[1]} 亮 —— 反了就看不出这栏填没填`)
  }
})

test('浅端:空态是白、填写态是灰(两档不能同值,且不能反)', () => {
  const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
  const pairs = (src) => {
    const out = []
    const re = /--cy-color-input-idle-bg:\s*(#[0-9A-Fa-f]{6});\s*--cy-color-input-filled-bg:\s*(#[0-9A-Fa-f]{6});/g
    let m
    while ((m = re.exec(src))) out.push([m[1], m[2]])
    return out
  }
  const light = pairs(strip(read('style/tokens.wxss'))).filter(([i]) => lum(i) > 380)
  assert.ok(light.length >= 2, `浅端两个作用域(商家/创建域)都要有空/填两档,现在 ${light.length} 处`)
  light.forEach(([idle, filled]) => {
    assert.ok(lum(idle) > lum(filled), `浅端空态 ${idle} 必须比填写态 ${filled} 亮(没填写是白色、填写之后是灰色)`)
  })
  const ml = pairs(strip(read('style/merchant-light.wxss'))).filter(([i]) => lum(i) > 380)
  assert.ok(ml.length >= 1 && lum(ml[0][0]) > lum(ml[0][1]), 'merchant-light 的镜像也要跟上(六处同步)')
})

test('cy-field 真的消费这两档,并且填没填由值决定', () => {
  const wxss = strip(read('components/cy/field/index.wxss'))
  assert.match(wxss, /background:\s*var\(--cy-color-input-idle-bg\)/, '底色必须读 idle 档,不能无条件画 bg-elevated')
  assert.match(wxss, /\.is-filled \.fd__control \{[^}]*var\(--cy-color-input-filled-bg\)/, '填写态必须换成 filled 档')
  assert.match(read('components/cy/field/index.wxml'), /_filled \? 'is-filled'/, '类名要挂在根节点上')
  assert.match(read('components/cy/field/index.js'), /_filled: filled/, '填没填由 value/displayValue 推,不用调用方额外传')
})

test('成功态不描边,错误态仍描边', () => {
  const wxss = strip(read('components/cy/field/index.wxss'))
  assert.doesNotMatch(wxss, /\.is-success \.fd__control \{[^}]*box-shadow/, '成功态不许再描一圈绿')
  assert.match(wxss, /\.is-error \.fd__control \{[^}]*inset[^}]*var\(--cy-color-status-danger\)/, '错误态的描边要留着,它要拦住提交')
})

/* 2026-09-03 用户当面指出:「有一些是在卡片里面的,卡片里面的颜色就会和输入框重叠,尤其是商家版」。
 * 实测成立 —— 商家卡片 --cy-color-bg-surface / bg-elevated 都是 #FFFFFF,而空态 idle 也是 #FFFFFF,
 * 对比 1.00:1;玩家暗端同理,卡片 bg-elevated #1C1C1E 撞填写态 filled #1C1C1E。
 * 结论不是回退口径(空亮填暗是对的),而是**边界不许只靠填充**:每个消费 input/search 填充档的
 * 控件都要有常驻描边兜底。cy-field 与 chapter-node-form 本来就有,cy-search 与 game-node 当时没有,
 * 放进白卡就整个消失。
 * 负控:摘掉任一处的常驻描边,本条必须红。 */
test('消费 input/search 填充档的控件必须有常驻描边,不能只靠填充分层', () => {
  const cases = [
    ['components/cy/field/index.wxss', /\.fd__control \{[^}]*box-shadow:\s*inset[^}]*var\(--cy-color-border-subtle\)/],
    ['pages/topic/components/cy/chapter-node-form/index.wxss', /border:\s*var\(--cy-comp-sheet-border-width\) solid var\(--cy-color-border-subtle\)/],
    ['components/cy/search/index.wxss', /\.search \{[^}]*box-shadow:\s*inset[^}]*var\(--cy-color-border-subtle\)/],
    ['pages/merchant/game-node/index.wxss', /\.gn-input,\s*\.gn-picker-value \{[^}]*box-shadow:\s*inset[^}]*var\(--cy-color-border-subtle\)/],
  ]
  for (const [file, re] of cases) {
    assert.match(strip(read(file)), re, `${file}:填充会和卡片撞成同色,必须有常驻描边兜住边界`)
  }
})

test('负控:商家浅端的卡片底与空态填充确实同色(所以上面那条描边不是可选项)', () => {
  const light = strip(read('style/merchant-light.wxss'))
  const card = light.match(/--cy-color-bg-elevated:\s*(#[0-9A-Fa-f]{6})/)
  const idle = light.match(/--cy-color-input-idle-bg:\s*(#[0-9A-Fa-f]{6})/)
  assert.ok(card && idle, 'merchant-light 里读不到卡片底或空态填充')
  assert.equal(card[1].toUpperCase(), idle[1].toUpperCase(),
    '这条一旦不成立说明有人动了配色,上面那条描边要求要跟着重新论证,别默认还成立')
})
