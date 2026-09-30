// R1 角色与权限:「撤销」是可点的销毁动作,不能长得和它旁边的描述文字一模一样。
//
// 2026-09-02 截图实测:整行渲染成「可管理成员、活动与核销 · 撤销」,
// .row-link 的颜色是 --cy-text-tertiary —— 正是左边 roleSummary 的颜色。
// 一句话读下来完全看不出哪两个字能点,而这两个字点下去会撤掉一个人的权限。
//
// 配色不自创,对齐本仓 detail 页既有三档(见 pages/club/detail/index.wxss):
//   .member-role-btn      = --cy-info                  跳转
//   .member-governance-btn= --cy-color-status-warning  警示
//   .member-remove        = --cy-danger                销毁
// 撤销授权归销毁一档。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

// 钉结构:行首的 .row-link 选择器 + 它的 color 声明,不钉具体色值字面量所在的行文
function colorOf(css, selector) {
  const m = new RegExp(`^\\s*\\${selector}\\s*\\{([^}]*)\\}`, 'm').exec(stripComments(css))
  if (!m) return null
  const c = /color:\s*([^;]+);/.exec(m[1])
  return c ? c[1].trim() : null
}

test('撤销不得与正文同色', () => {
  const color = colorOf(read('pages/club/roles/index.wxss'), '.row-link')
  assert.ok(color, '.row-link 规则不见了,选择器被改名的话这份合同要跟着改')
  assert.notEqual(color, 'var(--cy-text-tertiary)', '撤销用了正文三级色,等于没有可点提示')
  assert.notEqual(color, 'var(--cy-color-text-tertiary)', '同上(别名写法)')
})

test('撤销用的是本仓销毁档的颜色,不是新造的', () => {
  const color = colorOf(read('pages/club/roles/index.wxss'), '.row-link')
  const houseDanger = colorOf(read('pages/club/detail/index.wxss'), '.member-remove')
  assert.ok(houseDanger, 'detail 页 .member-remove 没了,本合同的参照物要重挑')
  assert.equal(color, houseDanger, '撤销该与本仓既有的销毁动作同色')
})

test('撤销确实是个可点元素,不是纯装饰', () => {
  const wxml = read('pages/club/roles/index.wxml')
  const m = /class="row-link[^"]*"[^>]*/.exec(wxml)
  assert.ok(m, '.row-link 节点不见了')
  assert.match(m[0], /catchtap=/, '既然叫 link 就得真能点')
  assert.match(m[0], /aria-role="button"/, '可点元素要报 role,读屏才念得出来')
})

test('负控:把颜色改回正文三级,门禁必须变红', () => {
  const css = read('pages/club/roles/index.wxss')
  const mutated = css.replace(/(\.row-link\s*\{[^}]*color:\s*)[^;]+;/, '$1var(--cy-text-tertiary);')
  assert.notEqual(mutated, css, '变异没生效:.row-link 的形状变了,这个负控在空转')
  assert.equal(colorOf(mutated, '.row-link'), 'var(--cy-text-tertiary)', '判据读不出变异后的值')
})
