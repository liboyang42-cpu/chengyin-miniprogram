/* 跨分包引组件必须声明 componentPlaceholder。
 *
 * 2026-09-11 实证:玩法壳整族搬进 pages/play(分包)之后,发布页(pages/publish,另一个分包)
 * 里的 <cy-playkit> 就再也没渲染过 —— 元素在树上、setData 有值、控制台零报错,
 * 屏幕上一片空白。商家的「查看预览」和「先看再选」两处试玩全是死的,而且没有任何信号。
 * 微信要求跨分包引用走分包异步化,缺 componentPlaceholder 就静默不渲染。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, ''))

function subpackageRoots() {
  const app = readJson('app.json')
  return (app.subPackages || app.subpackages || []).map((pkg) => pkg.root.replace(/^\/|\/$/g, ''))
}

/** 这个组件路径属于哪个分包;不在任何分包里就是主包(返回 '') */
function ownerOf(componentPath, roots) {
  const clean = componentPath.replace(/^\//, '')
  return roots.find((root) => clean.startsWith(root + '/')) || ''
}

function pageJsonFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = dir + '/' + name
      const stat = fs.statSync(path.join(ROOT, rel))
      if (stat.isDirectory()) walk(rel)
      else if (name.endsWith('.json')) out.push(rel)
    }
  }
  walk(root)
  return out
}

function violations() {
  const roots = subpackageRoots()
  const bad = []
  for (const root of roots) {
    for (const file of pageJsonFiles(root)) {
      let json
      try { json = readJson(file) } catch (e) { continue }
      const using = json.usingComponents || {}
      const placeholder = json.componentPlaceholder || {}
      for (const [name, target] of Object.entries(using)) {
        if (typeof target !== 'string' || !target.startsWith('/')) continue
        const owner = ownerOf(target, roots)
        if (!owner || owner === root) continue          // 主包或同分包:直接引没问题
        if (!placeholder[name]) bad.push(`${file} 引了 ${owner} 的 ${name},但没声明 componentPlaceholder`)
      }
    }
  }
  return bad
}

test('★跨分包引用的组件都声明了 componentPlaceholder —— 缺了就静默不渲染', () => {
  assert.deepEqual(violations(), [])
})

test('负控:把发布页的 componentPlaceholder 摘掉必须判红', () => {
  const file = 'pages/publish/temp/index.json'
  const json = readJson(file)
  assert.ok(json.componentPlaceholder && json.componentPlaceholder['cy-playkit'],
    '发布页必须给跨分包的 cy-playkit 留占位,否则试玩屏是空白的')
  const stripped = { ...json }
  delete stripped.componentPlaceholder
  const roots = subpackageRoots()
  const owner = ownerOf(stripped.usingComponents['cy-playkit'], roots)
  assert.ok(owner && owner !== 'pages/publish', 'cy-playkit 必须确实来自另一个分包,否则这条负控是空的')
})
