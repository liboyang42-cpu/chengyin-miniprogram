const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/**
 * 后端硬编码的小程序路径必须真的存在。
 *
 * 2026-08-07 主包瘦身把 pages/roam/passport 搬进 subpackageRoam/,而
 * WxSubscribeMsgServiceImpl 里那行订阅消息跳转路径是 Java 字符串 —— 前端的全仓
 * 路径替换扫不到它。当时是靠另一份勘察文档提醒才发现的,**没有任何自动化会红**。
 *
 * 这条测试补上那个缺口:后端只要写了 "pages/xxx" / "subpackageXxx/yyy" 形状的路径,
 * 就必须能在 app.json 的 pages + subPackages 里找到对应页面。
 *
 * ⚠️ 它守的是「路径存在」,不是「跳过去好用」—— 后者截图和静态检查都证明不了。
 */

const ROOT = path.resolve(__dirname, '../..')
const REPO = path.resolve(ROOT, '..')
const JAVA_ROOTS = [
  path.join(REPO, 'chengyinhub-system/src/main/java'),
  path.join(REPO, 'chengyinhub-admin/src/main/java'),
]
// 形如 "pages/a/b" 或 "subpackageFoo/a/b" 的字符串字面量
const ROUTE_LITERAL = /"((?:pages|subpackage[A-Za-z0-9]*)\/[A-Za-z0-9_\-/]+)"/g

function allRoutes() {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const out = new Set(app.pages)
  for (const sub of app.subPackages || app.subpackages || []) {
    for (const p of sub.pages) out.add(`${sub.root.replace(/\/$/, '')}/${p}`)
  }
  return out
}

function javaFiles() {
  const out = []
  const walk = dir => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.java')) out.push(full)
    }
  }
  JAVA_ROOTS.forEach(walk)
  return out
}

function findBackendRoutes() {
  const hits = []
  for (const file of javaFiles()) {
    const src = fs.readFileSync(file, 'utf8')
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return // 注释里的路径不算(搬迁说明会提到旧路径)
      for (const m of line.matchAll(ROUTE_LITERAL)) {
        hits.push({ file: path.relative(REPO, file), line: i + 1, route: m[1] })
      }
    })
  }
  return hits
}

test('后端硬编码的小程序路径都在 app.json 里真实存在', () => {
  const routes = allRoutes()
  const dead = findBackendRoutes().filter(h => !routes.has(h.route))
  assert.deepEqual(dead, [],
    '后端引用了 app.json 里不存在的小程序页面 —— 用户点订阅消息/分享会落到空白页,且线上零告警')
})

test('这道门禁确实扫到了后端(不是零命中的橡皮图章)', () => {
  const hits = findBackendRoutes()
  assert.ok(hits.length > 0,
    '一处都没扫到说明正则或 JAVA_ROOTS 失效了,那这条测试恒绿等于没有')
})

test('negative control：app.json 里不存在的后端路径必须判红', () => {
  const routes = allRoutes()
  const fake = [{ file: 'X.java', line: 1, route: 'subpackageRoam/passport-DOES-NOT-EXIST/index' }]
  assert.ok(fake.filter(h => !routes.has(h.route)).length === 1,
    '构造的坏路径没被判出来,说明判定逻辑本身是空的')
})
