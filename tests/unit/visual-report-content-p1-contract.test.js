const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。
const { readWxmlResolved } = require('../helpers/resolve-profile');

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => readWxmlResolved(relativePath)

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
  return match && match[1]
}

function assertMyInviteContract(route, scene, wxss, script) {
  assert.match(route, /<cy-page-title title="邀请记录"/)
  assert.doesNotMatch(route, /<cy-sheet/,
    '邀请记录独立路由不再套常驻半屏（同收益明细 / 提现记录）')
  assert.match(route, /<cy-scene-member-invite-history id="inviteHistory"/)
  assert.match(scene, /<cy-skeleton wx:if="\{\{loading && !groups\.length\}\}" type="list"/)
  assert.match(scene, /<cy-error wx:elif="\{\{loadErr && !groups\.length\}\}"[^>]*fill[^>]*bind:retry="retry"/)
  // CU-M-145 空态标题改为陈述事实(不再复述「邀请记录」),锚点跟着换,意图不变。
  assert.match(scene, /<cy-empty wx:elif="\{\{empty\}\}"[^>]*fill[^>]*title="还没有人接受你的邀请"/)
  const reward = rule(wxss, '.ir-reward')
  assert.ok(reward, '邀请记录奖励文本样式必须存在')
  assert.match(reward, /color:\s*var\(--cy-color-text-tertiary\)/)
  assert.doesNotMatch(reward, /status-success|--cy-success/,
    '奖励未到账不是成功状态，不能占用成功绿')
  assert.match(script, /loading:\s*true/)
  assert.match(script, /loadErr:\s*false/)
  assert.match(script, /retry\(\)\s*\{\s*this\.load\(true\)\s*\}/)
}

test('邀请记录独立路由正文落页、奖励中性化，并提供加载/错误/空态', () => {
  assertMyInviteContract(
    read('subpackageMember/myinvite/myinvite.wxml'),
    read('components/cy/scene-member-invite-history/index.wxml'),
    read('components/cy/scene-member-invite-history/index.wxss'),
    read('components/cy/scene-member-invite-history/index.js'),
  )
})

test('negative control: 邀请奖励退回成功绿时必须判红', () => {
  const route = read('subpackageMember/myinvite/myinvite.wxml')
  const scene = read('components/cy/scene-member-invite-history/index.wxml')
  const script = read('components/cy/scene-member-invite-history/index.js')
  const wxss = read('components/cy/scene-member-invite-history/index.wxss')
  const reward = rule(wxss, '.ir-reward')
  const broken = wxss.replace(reward, reward.replace('var(--cy-color-text-tertiary)', 'var(--cy-color-status-success)'))
  assert.notEqual(broken, wxss, '负控锚点失效：中性奖励文本不存在')
  assert.throws(() => assertMyInviteContract(route, scene, broken, script), assert.AssertionError)
})

test('negative control: myinvite 再套常驻半屏或错误态 fill 缺失时必须判红', () => {
  const route = read('subpackageMember/myinvite/myinvite.wxml')
  const scene = read('components/cy/scene-member-invite-history/index.wxml')
  const script = read('components/cy/scene-member-invite-history/index.js')
  const wxss = read('components/cy/scene-member-invite-history/index.wxss')
  const withSheet = route.replace(
    '<cy-scene-member-invite-history id="inviteHistory" />',
    '<cy-sheet show="{{true}}" title="邀请记录"><cy-scene-member-invite-history id="inviteHistory" /></cy-sheet>',
  )
  const withoutFill = scene.replace('wx:elif="{{loadErr && !groups.length}}" fill', 'wx:elif="{{loadErr && !groups.length}}"')
  assert.notEqual(withSheet, route, '负控锚点失效：myinvite scene 宿主不存在')
  assert.notEqual(withoutFill, scene, '负控锚点失效：邀请错误态 fill 不存在')
  assert.throws(() => assertMyInviteContract(withSheet, scene, wxss, script), assert.AssertionError)
  assert.throws(() => assertMyInviteContract(route, withoutFill, wxss, script), assert.AssertionError)
})

function assertRemainingP1Contract(files) {
  assert.match(files.couponJs, /friendlyQrError\(message, fallback\)/)
  assert.match(files.couponJs, /url:\s*'\/api\/coupon\/qr-token',[\s\S]{0,160}?silentError:\s*true/)
  assert.doesNotMatch(files.couponJs, /errMsg:\s*\(res\s*&&\s*res\.msg\)/,
    '接口原始 msg 不得直接进入核销凭证错误组件')
  assert.match(files.couponJs, /that\.friendlyQrError\(res\s*&&\s*res\.msg/)

  // 2026-08-06 用户裁决:起飞过场与地图左上退出钮一并删除(返回=系统手势/结算页),
  // 这里只锁「过场不得回流」——出口语义由 play-special-case 合同盯 show-exit。
  assert.doesNotMatch(files.playWxml, /startFlight/, '起飞过场已删,不得回流')

  assert.match(files.templateWxml, /wx:if="\{\{item\.useNum != null && item\.useNum !== ''\}\}"[^>]*>\{\{\s*item\.useNum \|\| 0\s*\}\} 次引用/)
  assert.match(files.templateWxml, /<text wx:else>状态待确认<\/text>/)
  // UI-04(2026-09-18):时长没填显示 0分钟,不再是「—」
  assert.match(files.templateWxml, /\{\{item\.duration != null && item\.duration !== '' \? item\.duration \+ '分钟' : '0分钟'\}\}/)
  assert.match(files.projectWxml, /wx:if="\{\{item\.useNum != null && item\.useNum !== ''\}\}"[^>]*>\{\{\s*item\.useNum \|\| 0\s*\}\} 次引用/)

  // 2026-08-04 用户拍板:商家态 member 主页回到白色,底栏跟随身份(玩家深/商家浅),不再恒 dark。
  // 语义断言，不锁字面量：原来逐字匹配整行 <tabBar ... />，2026-08-06 给它加了
  // wx:if="{{isSelf}}"（他人主页是 navigateTo 进来的普通页，不该有底栏）就匹配不上了。
  // 立意是「底栏存在，且 mode/dark 跟着商家视角切」——按这三件事分别断言。
  const tabBarTag = files.memberWxml.match(/<tabBar\b[^>]*\/>/)
  assert.ok(tabBarTag, 'member 主页必须渲染 tabBar 底栏')
  assert.match(tabBarTag[0], /mode="\{\{\s*isMerchantView\s*\?/, 'tabBar 的 mode 必须跟着 isMerchantView 切商家/消费者')
  assert.match(tabBarTag[0], /dark="\{\{\s*!isMerchantView\s*\}\}"/, 'tabBar 的 dark 必须与商家视角相反(商家日间浅色)')

  assert.match(files.badgeWxml, /<cy-error[^>]*wx:if="\{\{loadFail \|\| partialFail \|\| \(glFail && viewMode === 'wall'\)\}\}"/)
  assert.match(files.badgeJson, /"cy-error":\s*"\/components\/cy\/error\/index"/)

  for (const growthJs of [files.growthIndexJs, files.leaderboardJs]) {
    // UI-04(2026-09-18):榜单/成长积分是数字统计,没取到按新要求显示 0
    assert.match(growthJs, /if \(n === null \|\| n === undefined \|\| n === ''\) return '0'/)
    assert.match(growthJs, /if \(!Number\.isFinite\(v\)\) return '0'/)
    assert.match(growthJs, /function fmt\(n\)/)
  }

  assert.match(files.clubDetailJs, /friendlyGroupCodeError\(message, fallback\)/)
  assert.doesNotMatch(files.clubDetailJs, /groupCodeErrMsg:\s*\(res\s*&&\s*res\.msg\)/,
    '团码错误态不得直接展示接口原始 msg')
  const groupCodeSilent = files.clubDetailJs.match(/silentError:\s*true/g) || []
  assert.ok(groupCodeSilent.length >= 2, '场次查询与团码签发都必须静默接管技术错误')
}

const remainingFiles = () => ({
  couponJs: read('subpackageMember/coupon-qr/index.js'),
  playWxml: read('pages/play/index.wxml'),
  templateWxml: read('subpackageMember/mytemplate/mytemplate.wxml'),
  projectWxml: read('subpackageA/pages/myproject/index.wxml'),
  badgeWxml: read('subpackageP3/pages/badge-wall/index/index.wxml'),
  badgeJson: read('subpackageP3/pages/badge-wall/index/index.json'),
  growthIndexJs: read('subpackageP3/pages/growthcenter/index/index.js'),
  leaderboardJs: read('subpackageP3/pages/growthcenter/leaderboard/index.js'),
  clubDetailJs: read('pages/club/detail/index.js'),
  memberWxml: read('pages/member/index/index.wxml'),
})

test('其余源码可证 P1：错误文案、双出口、空值和勋章错误态均闭合', () => {
  assertRemainingP1Contract(remainingFiles())
})

test('negative control: 任一关键源码合同退回旧写法必须判红', () => {
  const files = remainingFiles()
  const broken = {
    ...files,
    playWxml: files.playWxml + '\n<view wx:if="{{startFlight.show}}"></view>',
  }
  assert.notEqual(broken.playWxml, files.playWxml, '负控锚点失效：过场回流探针没生效')
  assert.throws(() => assertRemainingP1Contract(broken), assert.AssertionError)
})
