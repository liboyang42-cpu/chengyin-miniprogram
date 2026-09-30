'use strict'

/* 系统弹层门禁(2026-09-02):全仓不许再出现 wx.showActionSheet。
 *
 * 病:Do not use 页明令禁止系统弹层(系统蓝、系统字、系统圆角,完全在设计体系外),
 * 但生产代码里一直有 9 处。**现有拦截只有页级一条**
 * (club-journey-audit-fix-contract:「俱乐部详情场次与工具选择」),
 * 典型的闸放错层 —— 按页写断言,新页天然不受约束,写的人还以为有门禁在看。
 *
 * 判据:全仓 .js(排除测试自身与审计脚本)出现 `wx.showActionSheet` 即红,允许清单为空。
 * 替代物是 cy-option-sheet(平列表,vault §3.22)。
 *
 * ⚠️ 注释里可以讲历史(「原来这里弹 wx.showActionSheet」),所以判之前先抹注释 ——
 *    否则本门禁会拦住自己的说明,逼着人改注释措辞去躲关键词。
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'tests', 'scripts'])

function stripComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function listJs(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listJs(full))
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

const HIT = /wx\.showActionSheet\s*\(/

test('全仓不许再用系统 ActionSheet,一律走 cy-option-sheet', () => {
  const offenders = listJs(ROOT)
    .filter((file) => HIT.test(stripComments(fs.readFileSync(file, 'utf8'))))
    .map((file) => path.relative(ROOT, file))
  assert.deepEqual(offenders, [], '这些文件仍在用系统弹层:\n' + offenders.join('\n'))
})

test('★负控:检查器能判红(不是恒绿),也不会被注释骗到', () => {
  assert.equal(HIT.test(stripComments("wx.showActionSheet({ itemList: ['a'] })")), true)
  assert.equal(HIT.test(stripComments("wx.showActionSheet ({})")), true)
  assert.equal(HIT.test(stripComments('/* 原来这里弹 wx.showActionSheet */')), false)
  assert.equal(HIT.test(stripComments('// 原来这里弹 wx.showActionSheet')), false)
})

test('替代物存在且回调形状与 showActionSheet 对齐(index === tapIndex)', () => {
  const js = fs.readFileSync(path.join(ROOT, 'components/cy/option-sheet/index.js'), 'utf8')
  assert.match(js, /triggerEvent\('select', \{ index/)
  assert.match(js, /triggerEvent\('cancel'\)/, '取消要有独立通道:原 fail 分支有 3 处靠它回收在途状态')
  assert.match(js, /immediate/, '动作菜单(IM 的 +/更多)不该被套上「选中再确认」两步')
})
