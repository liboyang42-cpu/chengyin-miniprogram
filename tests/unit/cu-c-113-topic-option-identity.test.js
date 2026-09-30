// CU-C-113 关联主题下拉同名 / CU-C-116 只读成员名单的承诺越界。
//
// CU-C-113:本地隔离主理人从俱乐部管理页邀请商家,「关联主题」下拉里出现两条逐字相同的
//          「E2E 探店日一期（不在招商期）」,分别指向 990028 与 990027。邀约只能发给一条,
//          选到哪条全凭运气 ⇒ 选项必须自带识别信息。
// CU-C-116:俱乐部设置里「成员管理」这一行的可见条件把 canReadMembers 也算进去了,而面板内的
//          权限/封禁/移除按钮按 canManage* 隐藏。只读身份点进来,副文案还在写
//          「设管理员、移除成员、邀请新成员」—— 界面承诺了它自己不给做的操作。
// 每条都配负控。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const INVITE_JS = 'pages/coop/invite/index.js'
const CLUB_DETAIL_WXML = 'pages/club/detail/index.wxml'

// 把页面源码装进沙箱,只取模块级的纯函数来真跑(与 c06 契约测试同一手法:
// 负控要把源码改回病灶形态再跑一遍,手搭假对象证不到源码那一侧)。
function loadInviteModule(rel, transform) {
  const noop = () => ({})
  global.getApp = () => ({
    globalData: {}, getUserID: () => 1, getUserRole: () => 'user', getUserType: () => 1,
    tips() {}, sendRequest() {},
  })
  global.getCurrentPages = () => []
  global.wx = new Proxy({}, { get: () => noop })
  global.Page = () => {}
  const abs = path.join(ROOT, rel)
  let src = fs.readFileSync(abs, 'utf8')
  if (transform) {
    const next = transform(src)
    assert.notEqual(next, src, '变异锚点失效(源码已改动?)')
    src = next
  }
  const dir = path.dirname(abs)
  const localRequire = (id) => require(id.startsWith('.') ? path.resolve(dir, id) : id)
  const factory = new Function('Page', 'getApp', 'getCurrentPages', 'wx', 'require', 'module', 'exports',
    src + '\nreturn { buildTopicOptions: buildTopicOptions };')
  const box = factory(global.Page, global.getApp, global.getCurrentPages, global.wx,
    localRequire, { exports: {} }, {})
  return box.buildTopicOptions
}

const labelsOf = (rows) => loadInviteModule(INVITE_JS)(rows).map((item) => item.label)

// ============================================================ CU-C-113
test('CU-C-113 同名不同日期的主题,下拉里读起来必须不一样', () => {
  const labels = labelsOf([
    { id: 990028, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-20 09:00:00', addressName: '某某路 12 号' },
    { id: 990027, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-22 09:00:00', addressName: '某某路 12 号' },
  ])
  assert.equal(new Set(labels).size, 2, '两条主题必须能分辨:' + JSON.stringify(labels))
  labels.forEach((label) => assert.match(label, /（不在招商期）$/, 'CU-M-29 的招商期标记不能因为改名丢掉'))
  assert.ok(labels.some((l) => /9月20日/.test(l)) && labels.some((l) => /9月22日/.test(l)),
    '区分信息要用主题自己的日期,不是序号:' + JSON.stringify(labels))
})

test('CU-C-113 日期也相同时继续升级识别信息,编号是最后一级兜底', () => {
  const collide = labelsOf([
    { id: 990028, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-20 09:00:00', addressName: '某某路 12 号' },
    { id: 990027, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-20 09:00:00', addressName: '某某路 12 号' },
  ])
  assert.equal(new Set(collide).size, 2, '连日期地点都一样时仍要能分辨:' + JSON.stringify(collide))
  const noDate = labelsOf([
    { id: 11, name: '同名主题', inviteWindowOpen: true },
    { id: 12, name: '同名主题', inviteWindowOpen: true },
  ])
  assert.equal(new Set(noDate).size, 2, '没有日期字段时也不许留下两条一样的选项')
})

test('CU-C-113 只有一个主题时不啰嗦,不无端加识别信息', () => {
  const labels = labelsOf([{ id: 7, name: '秋日城市定向', inviteWindowOpen: true, startDate: '2026-10-01 09:00:00' }])
  assert.deepEqual(labels, ['秋日城市定向'], '不撞名就别把日期堆进每一行,更别标招商期')
})

test('negative control CU-C-113: 退回「只有名字 + 招商期标记」⇒ 同名两条又逐字一样,判红', () => {
  const build = loadInviteModule(INVITE_JS, (src) => src.replace(
    /function buildTopicOptions\(rows\) \{[\s\S]*?\n\}\n/,
    'function buildTopicOptions(rows) {\n'
    + '  return rows.map(function (t) {\n'
    + "    const closed = t.inviteWindowOpen === false;\n"
    + "    return { id: t.id, name: t.name, closed: closed, short: t.name, label: closed ? t.name + '（不在招商期）' : t.name };\n"
    + '  });\n'
    + '}\n',
  ))
  const labels = build([
    { id: 990028, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-20 09:00:00' },
    { id: 990027, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-22 09:00:00' },
  ]).map((item) => item.label)
  assert.throws(() => assert.equal(new Set(labels).size, 2), assert.AssertionError)
  // 而正确形态下同一条断言能过 ⇒ 这条负控量的是源码不是运气
  assert.equal(new Set(labelsOf([
    { id: 990028, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-20 09:00:00' },
    { id: 990027, name: 'E2E 探店日一期', inviteWindowOpen: false, startDate: '2026-09-22 09:00:00' },
  ])).size, 2)
})

// ============================================================ CU-C-116
// 成员行的管理口径:与面板内 :799 那组按钮逐字同一判据
const MANAGE_FLAGS = ['club.isOwner', 'club.viewerIsAdmin', 'canManageMembers', 'canManageRoles']

function assertMemberRowHonest(wxml) {
  const start = wxml.indexOf('wx:if="{{club.isOwner || canReadMembers || canManageMembers || canManageRoles}}"')
  assert.ok(start >= 0, '成员行必须还是那条把 canReadMembers 也算进可见条件的行')
  const end = wxml.indexOf('<view class="cset-panel" wx:if="{{settingsPanel === \'members\'}}">', start)
  assert.ok(end > start, '成员面板必须紧跟在成员行之后(定位锚点没漂)')
  const block = wxml.slice(start, end)
  const sub = /<text class="cset-sub">([^<]*)<\/text>/.exec(block)
  assert.ok(sub, '成员行必须有副文案')
  const text = sub[1].trim()
  assert.match(text, /^\{\{.*\}\}$/, '副文案必须是随权限分档的三元,不能写死')
  const body = text.slice(2, -2)
  const splitAt = body.indexOf('?')
  assert.ok(splitAt > 0, '副文案三元少了条件:' + text)
  const [cond, branches] = [body.slice(0, splitAt), body.slice(splitAt + 1)]
  const colonAt = branches.indexOf(':')
  assert.ok(colonAt > 0, '副文案三元少了分支:' + text)
  const [managing, readOnly] = [branches.slice(0, colonAt), branches.slice(colonAt + 1)]
  MANAGE_FLAGS.forEach((flag) => assert.ok(cond.indexOf(flag) >= 0,
    `「能管」这一档的判据必须含 ${flag},与面板内按钮同一口径`))
  assert.match(managing, /设管理员、移除成员、邀请新成员/, '能管的身份仍要看得到真实动作')
  assert.doesNotMatch(readOnly, /移除|设管理员|邀请/,
    '只读这一档不许承诺做不到的操作:' + readOnly)
  assert.match(readOnly, /查看/, '只读要说清楚这里其实能干什么:' + readOnly)
}

test('CU-C-116 静态:只读身份看到的成员行不再承诺移除/设管理员/邀请', () => {
  assertMemberRowHonest(read(CLUB_DETAIL_WXML))
})

test('negative control CU-C-116: 副文案写死成管理承诺 ⇒ 判红', () => {
  const wxml = read(CLUB_DETAIL_WXML)
  const hardcoded = wxml.replace(
    /<text class="cset-sub">\{\{[^<]*\}\}<\/text>(\s*<\/view>\s*<cy-icon class="cset-chevron \{\{settingsPanel === 'members')/,
    '<text class="cset-sub">设管理员、移除成员、邀请新成员</text>$1',
  )
  assert.notEqual(hardcoded, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertMemberRowHonest(hardcoded), assert.AssertionError)
})
