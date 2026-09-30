// cy-page-title 的 flush:只有当**父容器自己有横向内边距**时才该传。
//
// 2026-09-02 截图实测:解散前待处理页标题贴到 x=0、首字被屏幕边缘裁掉,
// 与正文差整整一个 gutter。根因是 .blocker-page 只有 padding-bottom,
// 横向留白是每个子元素各自的 margin(.blocker-intro 是 0 var(--cy-space-4)),
// 传了 flush 等于把标题自带的 --cy-page-x 摘掉、又没人补上。
//
// flush 的注释本来就写着「父容器已经有横向内边距时传 true」——
// 规则一直在,只是没人能在合并前发现某一页不符合前提。这份合同把前提机器化。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const stripCssComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '')
const stripWxmlComments = s => s.replace(/<!--[\s\S]*?-->/g, '')

// wxss 会 @import 共享样式(如 pages/team/team.wxss 定义 .team-page 的横向内边距),
// 不跟 import 会把 team/detail、team/join 这类合法页面误判成违规 —— 实测踩到过。
function cssWithImports(dir, depth = 0) {
  const file = path.join(ROOT, dir, 'index.wxss')
  if (!fs.existsSync(file)) return ''
  let css = stripCssComments(fs.readFileSync(file, 'utf8'))
  if (depth > 3) return css
  for (const m of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const target = path.resolve(path.dirname(file), m[1])
    if (fs.existsSync(target)) css += '\n' + stripCssComments(fs.readFileSync(target, 'utf8'))
  }
  return css
}

// 页面外层可能是纯主题壳(<view class="theme-dark">),真正的容器在它里面,
// 所以取前几个 <view class> 一起看,任一个有横向内边距即算有。
function rootHasHorizontalPadding(dir) {
  const wxml = stripWxmlComments(read(`${dir}/index.wxml`))
  const classes = [...wxml.matchAll(/<view class="([^"]+)"/g)].slice(0, 3)
    .flatMap(m => m[1].split(/\s+/))
  if (!classes.length) return null
  const css = cssWithImports(dir)
  for (const cls of classes) {
    const rule = new RegExp(`^\\s*\\.${cls}\\s*\\{([^}]*)\\}`, 'm').exec(css)
    if (!rule) continue
    const body = rule[1]
    if (/padding:\s*[^;]*\s\S/.test(body)) return true          // padding 简写含横向分量
    if (/padding-(left|right|inline)/.test(body)) return true
    if (/--cy-page-x/.test(body)) return true
  }
  return false
}

function pagesUsingFlush() {
  const found = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name)
      if (name.isDirectory()) { walk(full); continue }
      if (name.name !== 'index.wxml') continue
      const src = stripWxmlComments(fs.readFileSync(full, 'utf8'))
      if (/<cy-page-title[^>]*\bflush\b/.test(src)) found.push(path.relative(ROOT, path.dirname(full)))
    }
  }
  walk(path.join(ROOT, 'pages'))
  return found
}

// 冻结基线:本轮之前就存在的误用,**只能减不能加**。
// pages/deregister —— 确实误传了 flush,但它的 cy-page-title 紧跟着一个
// show 恒为 true 的全屏 cy-sheet,标题被整个盖住,没有可观测症状;而且它不属于
// 俱乐部端,本轮改不到、也没法截图验证。留在这里是为了记账,不是为了放行:
// 谁动那一页,顺手摘掉 flush 并把这条删了。
const LEGACY_FLUSH_MISUSE = ['pages/deregister']

test('凡是传了 flush 的页面,父容器必须真的有横向内边距', () => {
  const offenders = []
  for (const dir of pagesUsingFlush()) {
    if (!fs.existsSync(path.join(ROOT, dir, 'index.wxss'))) continue
    if (rootHasHorizontalPadding(dir) === false) offenders.push(dir)
  }
  assert.deepEqual(offenders.filter(d => !LEGACY_FLUSH_MISUSE.includes(d)), [],
    '这些页传了 flush 但根容器没有横向内边距,标题会贴到屏幕边缘')
})

test('冻结基线只能减不能加:修好的条目必须及时删掉', () => {
  const current = pagesUsingFlush().filter(d =>
    fs.existsSync(path.join(ROOT, d, 'index.wxss')) && rootHasHorizontalPadding(d) === false)
  const stale = LEGACY_FLUSH_MISUSE.filter(d => !current.includes(d))
  assert.deepEqual(stale, [],
    '这些条目已经修好了,基线里的记录是过期的 —— 删掉它们,否则基线会慢慢变成许可证')
})

test('负控:把 flush 加回去,门禁必须变红', () => {
  assert.equal(rootHasHorizontalPadding('pages/club/edit'), false,
    '前置条件:该页根容器本来就没有横向内边距,这正是不能传 flush 的理由')

  const wxml = stripWxmlComments(read('pages/club/edit/index.wxml'))
  const mutated = wxml.replace('<cy-page-title title="编辑资料" safe-top="{{false}}" />',
                               '<cy-page-title title="编辑资料" safe-top="{{false}}" flush="{{true}}" />')
  assert.notEqual(mutated, wxml, '变异没生效:锚点已漂移,这个负控在空转')
  assert.equal(/<cy-page-title[^>]*\bflush\b/.test(mutated), true, '判据认不出 flush,它是橡皮图章')
})

test('负控:判据不能把「父容器确有横向内边距」的合法页面误判成违规', () => {
  const legit = pagesUsingFlush().filter(d =>
    fs.existsSync(path.join(ROOT, d, 'index.wxss')) &&
    rootHasHorizontalPadding(d) === true)
  assert.ok(legit.length > 0,
    '全仓找不到一个合法使用 flush 的页面 —— 说明判据把所有页都当成违规了,它不是在检查而是在一刀切')
})
