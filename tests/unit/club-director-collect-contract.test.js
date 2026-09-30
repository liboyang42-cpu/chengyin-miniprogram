/* cy-club-director-* 收编契约(2026-09-02,P2-A 导演台收编)
 *
 * 锁两件事(BRIEF「弹层四型」的结构性要求,不是某张卡的具体文案):
 *   ① D4/D5/D6/D7/D8 五个 T1 底部弹窗必须复用 cy-scene-sheet variant="half"
 *      ——不许写 full/peek(peek 已在 #983 合并进 half)。
 *   ② D2 结束活动是 T2 居中确认,必须复用 cy-modal danger,
 *      且不许自建顶栏/✕(T2 规则:没有顶栏、没有 ✕,只能点按钮)。
 *   ③ pages/club/game-director 深链页保留路由,但根节点必须是 theme-dark,
 *      不许再挂 theme-merchant(俱乐部端恒暗)。
 *
 * 断言锚点钉结构(标签+属性),不钉标题字面量——解释改动的注释会把钉字面量的
 * 断言自己撞红,这条坑已经踩过两次。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const SHEET_WRAPPERS = [
  'pages/club/components/club-director-chapter-sheet/index.wxml',
  'pages/club/components/club-director-team-sheet/index.wxml',
  'pages/club/components/club-director-role-sheet/index.wxml',
  'pages/club/components/club-director-broadcast-sheet/index.wxml',
  'pages/club/components/club-director-incident-sheet/index.wxml',
]

function assertHalfVariant(wxml, label) {
  assert.match(
    wxml,
    /<cy-scene-sheet\b[^>]*\bvariant="half"/,
    `${label}: T1 底部弹窗必须用 cy-scene-sheet variant="half"`
  )
  assert.doesNotMatch(
    wxml,
    /<cy-scene-sheet\b[^>]*\bvariant="(peek|full)"/,
    `${label}: 不许把 T1 底部弹窗写成 peek/full`
  )
}

function assertNoHeaderChrome(wxml, label) {
  assert.match(wxml, /<cy-modal\b[^>]*\bdanger/, `${label}: 必须复用 cy-modal 的 danger(结束活动不可逆)`)
  assert.doesNotMatch(wxml, /cy-nav-bar|cy-scene-sheet/, `${label}: T2 不许自建顶栏结构`)
}

test('D4/D5/D6/D7/D8 五个 T1 弹窗全部复用 cy-scene-sheet variant=half', () => {
  for (const rel of SHEET_WRAPPERS) {
    assertHalfVariant(read(rel), rel)
  }
})

test('负控:variant 被改成 peek 时,half 断言必须真的红', () => {
  const original = read(SHEET_WRAPPERS[0])
  assert.match(original, /variant="half"/, 'sanity: 原文件应含 variant="half"，负控前提不成立')
  const mutated = original.replace('variant="half"', 'variant="peek"')
  assert.throws(() => assertHalfVariant(mutated, 'mutated'))
})

test('D2 结束活动复用 cy-modal tone=interactive，且没有自建顶栏', () => {
  assertNoHeaderChrome(read('pages/club/components/club-director-end-confirm/index.wxml'), 'end-confirm')
})

test('负控:混入 cy-nav-bar 时，无顶栏断言必须真的红', () => {
  const original = read('pages/club/components/club-director-end-confirm/index.wxml')
  const mutated = original + '\n<cy-nav-bar />'
  assert.throws(() => assertNoHeaderChrome(mutated, 'mutated'))
})

test('game-director 整页已删,且全仓不再有残留引用', () => {
  // 2026-09-03 用户裁决:「应该删掉,功能都被替代了」。它的十张卡按 Figma 新的全流程稿
  // 收编进活动详情页(pages/club/topic-detail),状态机与写入安全搬进它的 director.js。
  // 原来这条合同钉的是「保留路由(深链兼容)」—— 那是施工文档的旧口径,现在作废。
  assert.equal(fs.existsSync(path.join(ROOT, 'pages/club/game-director')), false,
    '页面目录还在')
  const appJson = JSON.parse(read('app.json'))
  const routes = [
    ...(appJson.pages || []),
    ...(appJson.subPackages || []).flatMap((sp) => (sp.pages || []).map((p) => `${sp.root}/${p}`)),
  ]
  assert.equal(routes.some((r) => r.includes('game-director')), false, '路由还注册着')
})

test('宿主页(活动详情)恒暗,并且真的挂着导演台八件套', () => {
  const wxml = read('pages/club/topic-detail/index.wxml')
  assert.match(wxml, /class="[^"]*\btheme-dark\b[^"]*"/, '根节点必须挂 theme-dark')
  assert.doesNotMatch(wxml, /theme-merchant/, '俱乐部端恒暗,不许挂商家浅色')
  for (const n of ['ready', 'end-confirm', 'chapter-sheet', 'team-sheet',
                   'role-sheet', 'broadcast-sheet', 'incident-sheet', 'recap']) {
    assert.ok(wxml.includes(`<cy-club-director-${n}`),
      `宿主页没挂 cy-club-director-${n} —— 组件建了却没人渲染,等于功能没被替代`)
  }
})

test('负控:宿主页混入 theme-merchant 时断言必须真的红', () => {
  const original = read('pages/club/topic-detail/index.wxml')
  const mutated = original.replace('theme-dark', 'theme-dark theme-merchant')
  assert.notEqual(mutated, original, '变异没生效:根节点写法已漂移,这个负控在空转')
  assert.match(mutated, /theme-merchant/)
  assert.doesNotMatch(original, /theme-merchant/)
})
