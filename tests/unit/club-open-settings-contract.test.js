// 稿 M 268:223「开放设置」三个开关。
//
// 为什么要一份专门的合同:这三行在「俱乐部设置」半屏的折叠线以下,而半屏是个内部
// overflow 滚动的 div(不是 scroll-view),逻辑层滚不动 ⇒ **截图永远拍不到它们**。
// 2026-09-10 试过用 automator 读回文字,DevTools 逻辑层连不上(connect 通、pageStack 无响应),
// 全量截图跑完之后的已知死局。拍不到不等于可以不验 —— 改成判 WXML 里的判据本身。
//
// 要守的是一条很具体的坑:后端回的是 tinyint,经 JSON 到前端可能是数字 0 也可能是字符串 "0"。
// **"0" 在 JS 里是真值**,所以只要有人把 `x != 0` 改成 `x`(或 `!!x`),
// 界面就会把「已关闭」显示成「已开启」—— 用户以为关掉了,实际没关。
// 这三个开关分别管:谁能看见这个俱乐部、谁能发帖、主题进不进商家可承接列表。显示反了都是事故。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const WXML = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.wxml'), 'utf8')

/** 稿 M 的顺序。加入需审批写的是同一列 club.join_policy,入口在编辑资料,不在这一组。 */
const SWITCHES = [
  { title: '俱乐部公开可见', field: 'publicVisible',        key: 'publicVisible',  handler: 'togglePublicVisible' },
  { title: '开放商家承接',   field: 'merchantUndertakeOpen', key: 'merchantCoop',   handler: 'toggleMerchantCoop' },
  { title: '允许成员发帖',   field: 'memberPostAllowed',     key: 'memberPost',     handler: 'toggleMemberPost' },
]

/** 取某一行的整块 WXML(从它的 cset-row 起,到该行的 cy-inline-error 止) */
function rowBlock(title) {
  const at = WXML.indexOf('<text class="cset-title">' + title + '</text>')
  assert.ok(at > 0, `设置弹窗里找不到「${title}」这一行`)
  const start = WXML.lastIndexOf('<view class="cset-row"', at)
  const end = WXML.indexOf('/>', WXML.indexOf('cy-inline-error', at)) + 2
  assert.ok(start > 0 && end > start, `「${title}」这一行的结构对不上`)
  return WXML.slice(start, end)
}

test('三个开关都在,顺序与稿 M 一致', () => {
  const positions = SWITCHES.map(s => WXML.indexOf('<text class="cset-title">' + s.title + '</text>'))
  positions.forEach((p, i) => assert.ok(p > 0, `缺少「${SWITCHES[i].title}」`))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b),
    '三行顺序必须是 公开可见 → 开放商家承接 → 允许成员发帖(稿 M 268:223)')
})

test('★两档状态字必须用 != 0,不许退化成真值判断', () => {
  for (const s of SWITCHES) {
    const block = rowBlock(s.title)
    const expr = `club.${s.field} != 0`
    assert.ok(block.includes(`${expr} ? '已开启' : '已关闭'`),
      `「${s.title}」的状态字必须判 ${expr};真值判断会把字符串 "0" 显示成「已开启」`)
    assert.ok(block.includes(`aria-checked="{{club.${s.field} != 0}}"`),
      `「${s.title}」的 aria-checked 要和可见状态同一个判据,否则读屏与肉眼说的不是一回事`)
  }
})

test('★负控:把判据换成真值判断,上面那条必须判红', () => {
  // 这里证的是「检查器真的能抓到那个退化」,不是「今天恰好是对的」。
  const good = `club.publicVisible != 0 ? '已开启' : '已关闭'`
  const bad = `club.publicVisible ? '已开启' : '已关闭'`
  assert.ok(WXML.includes(good), '前提:现码用的是 != 0')
  assert.ok(!WXML.includes(bad), '现码不该有真值判断版本')
  // 语义层面也钉一次:JS 的松散相等就是 WXML `!=` 的语义
  assert.equal('0' != 0, false, '字符串 "0" 在松散相等下等于 0 ⇒ 判成「已关闭」,这正是我们要的')
  assert.equal(Boolean('0'), true, '而真值判断会把 "0" 当真 ⇒ 显示「已开启」,这正是要防的')
})

test('保存中只标当前那一行,别的行不跟着变', () => {
  for (const s of SWITCHES) {
    const block = rowBlock(s.title)
    assert.ok(block.includes(`openSettingSaving === '${s.key}' ? '保存中…'`),
      `「${s.title}」的保存中必须按 key 精确匹配,否则点一个开关三行一起转圈`)
  }
})

test('每一行都有自己的错误位与重试,且只在自己出错时出现', () => {
  for (const s of SWITCHES) {
    const block = rowBlock(s.title)
    assert.ok(block.includes(`openSettingErrorKey === '${s.key}'`),
      `「${s.title}」的错误条要按 key 出,否则一个开关失败三行全报错`)
    assert.ok(block.includes(`bind:action="${s.handler}"`),
      `「${s.title}」的重试要回到它自己的 handler`)
  }
})

test('三个开关只对主理人出现 —— 开放设置是对外可见性,不是管理员的日常运营', () => {
  for (const s of SWITCHES) {
    assert.ok(rowBlock(s.title).includes('wx:if="{{club.isOwner}}"'),
      `「${s.title}」必须 owner-only`)
  }
})
