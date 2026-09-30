// 禁用系统轻提示/加载遮罩(2026-09-06 三端审核「原生弹层全删」批次)。
//
// 判据:全仓生产 JS 里不许再出现 wx.showToast / wx.showLoading / wx.hideLoading,唯一的合法出口是
// utils/toast.js 与 utils/loading.js(它们在页面没挂 cy-toast / cy-loading-mask 时回落到原生)。
// 棘轮:BASELINE 是仍未迁完的存量(按文件计数),只许减不许增;新增文件必须为 0。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'tests', 'scripts', 'artifacts', 'docs', 'design', '.git'])
const SINKS = new Set(['utils/toast.js', 'utils/loading.js', 'utils/modal.js'])
const HIT = /\bwx\s*\.\s*(showToast|showLoading|hideLoading|showModal)\s*\(|\bwx\s*\[\s*['"](showToast|showLoading|hideLoading|showModal)['"]\s*\]/g
// 存量棘轮(文件 → 剩余处数)。迁完一个文件就把它从这里删掉;数字只许往下走。
const BASELINE = require('./no-system-toast-baseline.json')

function listJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) listJs(full, out)
    else if (e.name.endsWith('.js')) out.push(full)
  }
  return out
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
}
function scan(root) {
  const hits = {}
  for (const file of listJs(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/')
    if (SINKS.has(rel)) continue
    const n = (stripComments(fs.readFileSync(file, 'utf8')).match(HIT) || []).length
    if (n) hits[rel] = n
  }
  return hits
}

test('生产 JS 不许新增 wx.showToast / showLoading / hideLoading / showModal(唯一出口 utils/toast.js、loading.js、modal.js)', () => {
  const hits = scan(ROOT)
  const grown = Object.entries(hits).filter(([f, n]) => n > (BASELINE[f] || 0))
  assert.deepEqual(grown, [], '这些文件的原生 toast/loading 调用比棘轮基线多:\n' + grown.map(([f, n]) => `  ${f}: ${n} > ${BASELINE[f] || 0}`).join('\n'))
  const stale = Object.entries(BASELINE).filter(([f, n]) => (hits[f] || 0) < n)
  assert.deepEqual(stale, [], '这些基线项已经少于实际,把棘轮往下拧:\n' + stale.map(([f, n]) => `  ${f}: ${hits[f] || 0} < ${n}`).join('\n'))
})

test('两个出口文件各自只允许一处原生调用形态', () => {
  const toast = stripComments(fs.readFileSync(path.join(ROOT, 'utils/toast.js'), 'utf8'))
  const loading = stripComments(fs.readFileSync(path.join(ROOT, 'utils/loading.js'), 'utf8'))
  assert.equal((toast.match(/wx\.showToast\s*\(/g) || []).length, 1)
  assert.equal((loading.match(/wx\.showLoading\s*\(/g) || []).length, 1)
  assert.equal((loading.match(/wx\.hideLoading\s*\(/g) || []).length, 1)
  const modal = stripComments(fs.readFileSync(path.join(ROOT, 'utils/modal.js'), 'utf8'))
  assert.equal((modal.match(/wx\.showModal\s*\(/g) || []).length, 1)
})

test('负控:往任一生产文件注入一处 wx.showToast 必须判红', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nst-'))
  fs.mkdirSync(path.join(tmp, 'pages/demo'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'utils'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'utils/toast.js'), '')
  fs.writeFileSync(path.join(tmp, 'utils/modal.js'), '')
  fs.writeFileSync(path.join(tmp, 'pages/demo/index.js'), "Page({ a() { wx.showToast({ title: 'x' }) } })")
  const hits = scan(tmp)
  assert.deepEqual(hits, { 'pages/demo/index.js': 1 })
  fs.writeFileSync(path.join(tmp, 'pages/demo/index.js'), "Page({ a() { toast('x') } })")
  assert.deepEqual(scan(tmp), {})
  fs.writeFileSync(path.join(tmp, 'pages/demo/index.js'), "Page({ a() { wx.showModal({ title: 'x' }) } })")
  assert.deepEqual(scan(tmp), { 'pages/demo/index.js': 1 }, 'showModal 同样要被抓')
})
