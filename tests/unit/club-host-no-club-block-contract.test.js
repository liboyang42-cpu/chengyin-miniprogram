const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 用户拍板(2026-08-07):主办方是俱乐部时,主题工作台没有「俱乐部」协作区块
// (俱乐部不邀俱乐部;俱乐部管理人属后续需求,现在不做)。
function assertClubHostContract(pageJs, pageWxml, hostWxml, hostJs) {
  assert.match(
    pageJs,
    // 2026-08-18:buildQuickActions 多了第三个参数 canEdit(主办方编辑资格闸),EDIT 从数组
    // 字面量里挪到了 base.concat([EDIT])。本条契约要盯的仍然只有一件事:俱乐部主办没有 CLUB 格。
    /buildQuickActions\(role, ownerType, canEdit\)[\s\S]*?ownerType === 'club' \? \[MERCHANT, CUSTOMER\] : \[CLUB, MERCHANT, CUSTOMER\]/,
    '俱乐部主办的快捷位必须裁掉「俱乐部」格',
  )
  assert.match(
    pageJs,
    /buildQuickActions\('host', host\.ownerType, host\.canEdit\)/,
    'applyHome 必须把后端 host.ownerType 传进快捷位组装',
  )
  assert.match(pageWxml, /hostOwnerType="\{\{ hostOwnerType \|\| '' \}\}"/, '页面必须传主办身份且不能把 null 交给强类型组件属性')
  assert.match(
    hostWxml,
    /class="metric" wx:if="\{\{ hostOwnerType !== 'club' \}\}"[\s\S]{0,200}?合作俱乐部/,
    '俱乐部主办不显示「合作俱乐部」指标格',
  )
  assert.match(hostJs, /hostOwnerType:\s*\{ type: String, value: 'merchant' \}/, '组件必须声明 hostOwnerType 属性')
}

const sources = () => [
  read('pages/topic/merchantinfo/merchantinfo.js'),
  read('pages/topic/merchantinfo/merchantinfo.wxml'),
  read('pages/topic/components/project-host/index.wxml'),
  read('pages/topic/components/project-host/index.js'),
]

test('俱乐部主办的工作台没有俱乐部协作区块', () => {
  assertClubHostContract(...sources())
})

test('负控:俱乐部格回潮或身份没传递必须判红', () => {
  const [pageJs, pageWxml, hostWxml, hostJs] = sources()

  const regressed = pageJs.replace(
    "ownerType === 'club' ? [MERCHANT, CUSTOMER] : [CLUB, MERCHANT, CUSTOMER]",
    '[CLUB, MERCHANT, CUSTOMER]',
  )
  assert.notEqual(regressed, pageJs, '负控锚点失效:裁剪分支不存在')
  assert.throws(() => assertClubHostContract(regressed, pageWxml, hostWxml, hostJs), assert.AssertionError)

  const unguarded = hostWxml.replace(`class="metric" wx:if="{{ hostOwnerType !== 'club' }}"`, 'class="metric"')
  assert.notEqual(unguarded, hostWxml, '负控锚点失效:指标格守卫不存在')
  assert.throws(() => assertClubHostContract(pageJs, pageWxml, unguarded, hostJs), assert.AssertionError)
})
