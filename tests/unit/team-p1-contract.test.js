'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const TEAM_COMPLIANCE_FILES = [
  'pages/team/detail/index.js',
  'pages/team/detail/index.wxml',
  'pages/team/join/index.js',
  'pages/team/join/index.wxml',
  'pages/activity/baoming/baoming.js',
  'pages/activity/baoming/baoming.wxml',
  'components/cy/scene-member-order-detail/index.js',
  'components/cy/scene-member-order-detail/index.wxml',
  'utils/team-up.js',
]

function teamComplianceSources(overrides) {
  return Object.fromEntries(TEAM_COMPLIANCE_FILES.map((file) => [
    file,
    overrides && overrides[file] !== undefined ? overrides[file] : read(file),
  ]))
}

function assertTeamCompliance(sources) {
  const sanitized = Object.fromEntries(Object.entries(sources).map(([file, source]) => [
    file,
    file.endsWith('.js')
      ? source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      : source,
  ]))
  const all = Object.values(sanitized).join('\n')
  assert.doesNotMatch(all, /解锁|立减|助力|邀请得|分享得/)
  assert.doesNotMatch(all, /邀请\s*\d+\s*人.{0,12}(?:才能|方可|可继续|可进入)/)
  assert.doesNotMatch(all, /组队成功.{0,16}(?:优惠券|积分|奖品|抽奖|现金|实物)/)
  assert.doesNotMatch(all, /帮你找队友|保证匹配|为你推荐队友/)

  const signupWxml = sources['pages/activity/baoming/baoming.wxml']
  const orderWxml = sources['components/cy/scene-member-order-detail/index.wxml']
  assert.doesNotMatch(signupWxml, /class="team-signup"|组队报名|单独报名/)
  assert.match(orderWxml, /info\.cmsActivity\.teamMode\s*==\s*2[\s\S]{0,600}组队与否不影响活动举行/)

  const signupJs = sanitized['pages/activity/baoming/baoming.js']
  /* 2026-09-06 用户裁决:买完直接跳,成功面板不放按钮 ⇒ B 模式那三样东西
     (建队入口 / 明示不影响活动举行 / 可跳过)整体落在**订单详情页**那张卡上,
     报名页不再重复一份。断言随之只钉 orderWxml —— 它是现在唯一的真源。
     ⚠️ 这不是把闸拆了:入口仍被逐条断言存在,只是不再要求报名页也有一份。
     报名页那边由 payment-checkout-pages 断言「成功后确实跳去这一页」接上。 */
  assert.match(orderWxml, /叫上队友/, '建队入口必须在订单详情页上')
  assert.match(orderWxml, /组队与否不影响活动举行/, '必须明示不影响活动举行')
  assert.doesNotMatch(signupJs, /叫上队友/, '报名页不该再留一份建队入口(已挪到落地页)')
  const aFlow = signupJs.slice(signupJs.indexOf('finishSignup('), signupJs.indexOf('toggleHostShare('))
  assert.doesNotMatch(aFlow, /createSelectedSignupTeam|signupKind|teamMemberOptions|teamMemberIndex/)

  /* 2026-09-06:B 模式建队流程从报名页搬到了订单详情组件(startOrderTeam)——
     报名页那份随「买完直接跳」删掉了。锚点必须跟着搬:留在原处会切出一段**空字符串**,
     而 doesNotMatch(/share/i) 对空串恒真 = 恒不红的空断言。
     helper 名沿用 master 2026-09-02 的拆分(memberSheet 出数据 → cy-option-sheet 问 →
     createActivityTeam 真建队),不是那个已经不存在的 chooseAndCreate。 */
  const orderJs = sanitized['components/cy/scene-member-order-detail/index.js']
  const bFlow = orderJs.slice(orderJs.indexOf('startOrderTeam()'), orderJs.indexOf('openMeetingPoint('))
  assert.ok(bFlow.length > 0, 'B 模式建队流程的锚点必须切得出东西,否则下面两条是空断言')
  assert.match(bFlow, /teamUp\.memberSheet/, 'B 模式的人数选项必须来自共享 helper')
  assert.match(bFlow, /teamUp\.createActivityTeam/, '真正建队仍要走共享 helper')
  assert.doesNotMatch(bFlow, /share/i, '报名后组队也不能以分享作为创建队伍的前置条件')
  assert.doesNotMatch(sanitized['utils/team-up.js'], /share/i, '共享建队 helper 不能引入强制分享门槛')
}

function loadDetailPage(source) {
  let definition
  vm.runInNewContext(source || read('pages/team/detail/index.js'), {
    getApp: () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      getUserID: () => 88,
      sendRequest() {},
    }),
    Page(value) { definition = value },
    wx: { showModal() {}, showToast() {}, navigateTo() {}, redirectTo() {}, stopPullDownRefresh() {} },
    setTimeout,
    console,
  }, { filename: 'pages/team/detail/index.js' })
  return definition
}

function loadTeamPage(relative) {
  let definition
  const requests = []
  const toasts = []
  const backs = []
  const redirects = []
  const pullStops = []
  vm.runInNewContext(read(relative), {
    getApp: () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      sendRequest(request) { requests.push(request) },
    }),
    Page(value) { definition = value },
    wx: {
      showModal() {},
      showToast(options) { toasts.push(options) },
      navigateBack(options) { backs.push(options || {}) },
      navigateTo() {},
      redirectTo(options) { redirects.push(options) },
      stopPullDownRefresh() { pullStops.push(true) },
    },
    setTimeout,
    console,
  }, { filename: relative })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return { page, requests, toasts, backs, redirects, pullStops }
}

function assertTeamStateUx(detailWxml, joinWxml, detailJson, joinJson, teamWxss) {
  assert.match(detailWxml, /<cy-skeleton\b[^>]*wx:if="\{\{loading && !team\}\}"[^>]*type="detail"/,
    '队伍详情首载必须使用与详情结构同构的骨架')
  assert.match(detailWxml, /<cy-state-shell\b[^>]*wx:elif="\{\{error && !team\}\}"[^>]*kind="\{\{errorKind\}\}"[^>]*primary="\{\{errorAction\}\}"[^>]*bind:primary="onErrorAction"/,
    '队伍详情首载失败/缺参必须给语义状态与唯一恢复动作')
  assert.match(detailWxml, /正在核对队伍状态…/,
    '队伍详情刷新旧内容时必须显式标记正在更新')
  assert.doesNotMatch(detailWxml, /<cy-inline-error\b[^>]*(wx:if|wx:elif)="\{\{error && team\}\}"/,
    '队伍详情刷新失败必须保留旧队伍并局部重试')

  assert.match(joinWxml, /<cy-skeleton\b[^>]*wx:if="\{\{loading && !team\}\}"[^>]*type="detail"/,
    '加入邀请首载必须使用同构骨架')
  assert.match(joinWxml, /<cy-state-shell\b[^>]*wx:elif="\{\{error && !team\}\}"[^>]*kind="\{\{errorKind\}\}"[^>]*primary="\{\{errorAction\}\}"[^>]*bind:primary="onErrorAction"/,
    '邀请缺参不能伪装成可无限重试的网络错误')
  assert.match(joinWxml, /<cy-inline-error\b[^>]*wx:if="\{\{joinError\}\}"[^>]*action="重试加入"[^>]*bind:action="join"/,
    '加入失败必须在动作附近留下可恢复状态，不能只闪 toast')
  assert.match(joinWxml, /aria-busy="\{\{joining\}\}"[^>]*aria-disabled="\{\{joining\}\}"/,
    '加入请求 pending 必须向辅助技术声明 busy/disabled')

  for (const [name, json] of [['detail', detailJson], ['join', joinJson]]) {
    const components = JSON.parse(json).usingComponents || {}
    for (const component of ['cy-skeleton', 'cy-state-shell', 'cy-inline-error']) {
      assert.ok(components[component], `${name} 必须注册 ${component}`)
    }
  }
  assert.match(teamWxss, /\.team-member-op\s*\{[^}]*min-width:\s*var\(--cy-btn-h\)[^}]*min-height:\s*var\(--cy-btn-h\)/s,
    '移出成员不能只有小字热区，最小触达必须达到共享按钮高度')
}

function actionsConditionForText(source, text) {
  const textIndex = source.indexOf(text)
  assert.notEqual(textIndex, -1, `缺少操作文案: ${text}`)
  const actionsStart = source.lastIndexOf('<view class="team-actions"', textIndex)
  assert.notEqual(actionsStart, -1, `${text} 不在 team-actions 中`)
  const openTagEnd = source.indexOf('>', actionsStart)
  const openTag = source.slice(actionsStart, openTagEnd + 1)
  const match = openTag.match(/wx:if="\{\{([^}]+)\}\}"/)
  assert.ok(match, `${text} 所在 actions 缺少 wx:if`)
  return match[1].replace(/\s+/g, '')
}

function invitationVisibleAtStatus(source, status) {
  const condition = actionsConditionForText(source, '邀请队友')
  const match = condition.match(/^team\.status(===|==|<)(\d+)$/)
  assert.ok(match, `邀请入口条件不可判定: ${condition}`)
  const boundary = Number(match[2])
  if (match[1] === '<') return status < boundary
  return status === boundary
}

function assertFullTeamInvitationHidden(source) {
  assert.equal(invitationVisibleAtStatus(source, 0), true, '招募中队伍必须保留邀请入口')
  assert.equal(invitationVisibleAtStatus(source, 1), false, '满员队伍不得继续显示邀请入口')
  assert.equal(actionsConditionForText(source, '退出队伍'), 'joined&&team.status<2',
    '满员队伍仍须允许退出/解散，成员操作块必须保持 status < 2')
}

test('独立建队页已下线，只保留详情与邀请落点', () => {
  const app = JSON.parse(read('app.json'))
  assert.ok(!app.pages.includes('pages/team/create/index'))
  assert.ok(app.pages.includes('pages/team/detail/index'))
  assert.ok(app.pages.includes('pages/team/join/index'))

  const page = loadDetailPage()
  page.teamId = '31'
  page.data.team = { title: '夜行小队', inviteCode: 'safe_code-31' }
  assert.deepEqual(JSON.parse(JSON.stringify(page.onShareAppMessage())), {
    title: '夜行小队',
    path: '/pages/team/join/index?code=safe_code-31',
  })
})

test('商家团队页只用 Page.onShareAppMessage 开启分享，不写无效 page.json 字段', () => {
  const pageConfig = JSON.parse(read('pages/merchant/team/index.json'))
  assert.equal(Object.hasOwn(pageConfig, 'enableShareAppMessage'), false)
  assert.match(read('pages/merchant/team/index.js'), /\bonShareAppMessage\s*\(\)/)
})

test('邀请预览与入队只提交不可枚举邀请码', () => {
  const join = read('pages/team/join/index.js')
  assert.match(join, /options\.code/)
  assert.match(join, /JSON\.stringify\(\{ inviteCode: this\.inviteCode \}\)/)
  assert.doesNotMatch(join, /JSON\.stringify\(\{ teamId:/)
  assert.match(join, /邀请链接已升级/)
  assert.match(join, /请让队长重新分享新的邀请链接/)
})

test('详情尚未加载时系统分享不抛异常或生成空邀请码链接', () => {
  const page = loadDetailPage()
  assert.doesNotThrow(() => page.onShareAppMessage())
  assert.deepEqual(JSON.parse(JSON.stringify(page.onShareAppMessage())), {
    title: '队伍邀请已失效',
    path: '/pages/index/index',
  })
})

test('P1 页面不引入公开广场、scene 群能力或订单联动', () => {
  const sources = [
    'pages/team/detail/index.js',
    'pages/team/join/index.js',
  ].map(read).join('\n')
  assert.doesNotMatch(sources, /getGroupEnterInfo|getShareInfo|getUnlimited|scene\s*:/)
  assert.doesNotMatch(sources, /\/api\/(?:registration\/refund|refund|order)/)
  assert.doesNotMatch(sources, /team\/square|公开申请|队伍广场/)
})

function assertTopicTeamModel(editorJs, editorWxml, signupJs, signupWxml, orderWxml) {
  assert.match(editorJs, /teamMode:\s*0/)
  assert.match(editorJs, /teamMaxMembers:\s*4/)
  assert.match(editorWxml, /支持组队/)
  assert.match(editorWxml, /报名时/)
  assert.match(editorWxml, /报名后/)
  assert.match(editorWxml, /队伍人数上限/)

  assert.doesNotMatch(signupWxml, /class="team-signup"|组队报名|单独报名/)
  /* 2026-09-06:同上,B 模式那组落在订单详情页,报名页不再重复 */
  assert.match(orderWxml, /组队与否不影响活动举行[\s\S]{0,400}叫上队友/)
  assert.doesNotMatch(signupWxml, /凑齐才开场|不成团退款|等待成团/)
  assert.doesNotMatch(signupJs, /凑齐才开场|不成团退款|等待成团/)

  /* 2026-09-06:B 模式的判定与建队入口都落在订单详情页,报名页不再有 */
  assert.match(orderWxml, /info\.cmsActivity\.teamMode\s*==\s*2/)
  assert.match(orderWxml, /叫上队友/)
}

test('主题级 A/B 模式在编辑器、报名页、成功弹窗与订单补救入口闭环', () => {
  assertTopicTeamModel(
    read('pages/publish/fabu/index.js'),
    read('pages/publish/fabu/step3.wxml'),
    read('pages/activity/baoming/baoming.js'),
    read('pages/activity/baoming/baoming.wxml'),
    read('components/cy/scene-member-order-detail/index.wxml')
  )
})

test('负控:删掉 A 模式免责声明或把 B 模式卡片误放到任意订单时必须判红', () => {
  const args = [
    read('pages/publish/fabu/index.js'),
    read('pages/publish/fabu/step3.wxml'),
    read('pages/activity/baoming/baoming.js'),
    read('pages/activity/baoming/baoming.wxml'),
    read('components/cy/scene-member-order-detail/index.wxml')
  ]
  const missingDisclaimer = args.slice()
  // 2026-09-06:免责声明现在只在订单详情页(args[4])这一份 —— 报名页那份已随
  // 「买完直接跳」删掉。负控的变异点必须跟着搬:改一个不存在的字符串 = 恒不红的空负控。
  missingDisclaimer[4] = missingDisclaimer[4].replace('组队与否不影响活动举行', '等待队伍凑齐')
  assert.throws(() => assertTopicTeamModel(...missingDisclaimer), assert.AssertionError)

  const leakedCard = args.slice()
  leakedCard[4] = leakedCard[4].replace('info.cmsActivity.teamMode == 2', 'info.cmsActivity')
  assert.throws(() => assertTopicTeamModel(...leakedCard), assert.AssertionError)
})

test('组队入口可跳过、无分享奖励或匹配承诺，A/B 均明示不影响活动举行', () => {
  assertTeamCompliance(teamComplianceSources())
})

test('负控:分享门槛、分享奖励与匹配承诺任一回潮都必须判红', () => {
  const mutations = [
    ['pages/team/detail/index.wxml', '<view>邀请3人才能解锁入场</view>'],
    ['components/cy/scene-member-order-detail/index.wxml', '<view>组队成功送优惠券立减</view>'],
    ['pages/activity/baoming/baoming.js', "const inducement = '分享得积分助力'"],
    ['pages/team/join/index.wxml', '<view>帮你找队友，保证匹配</view>'],
  ]
  for (const [file, injected] of mutations) {
    const sources = teamComplianceSources({ [file]: read(file) + '\n' + injected })
    assert.throws(() => assertTeamCompliance(sources), assert.AssertionError, file)
  }

  // 2026-09-06:B 模式建队搬到订单详情组件,负控的变异点跟着搬
  const orderJsRaw = read('components/cy/scene-member-order-detail/index.js')
  const forcedBShare = orderJsRaw.replace(
    'startOrderTeam() {',
    'startOrderTeam() {\n      if (!this.data.hasShared) return'
  )
  assert.notEqual(forcedBShare, orderJsRaw, 'B 模式强制分享负控锚点失效')
  assert.throws(() => assertTeamCompliance(teamComplianceSources({
    'components/cy/scene-member-order-detail/index.js': forcedBShare,
  })), assert.AssertionError)

  const helperJs = read('utils/team-up.js')
  const forcedHelperShare = helperJs + '\nfunction requireShareBeforeCreate() {}\n'
  assert.throws(() => assertTeamCompliance(teamComplianceSources({
    'utils/team-up.js': forcedHelperShare,
  })), assert.AssertionError)
})

test('详情页满员态隐藏邀请入口，但仍保留成员退出与解散操作', () => {
  assertFullTeamInvitationHidden(read('pages/team/detail/index.wxml'))
})

test('负控:邀请条件退回 status < 2 时，满员死链契约必须判红', () => {
  const original = read('pages/team/detail/index.wxml')
  const mutated = original.replace('wx:if="{{team.status == 0}}"', 'wx:if="{{team.status < 2}}"')
  assert.notEqual(mutated, original, '负控锚点失效')
  assert.throws(() => assertFullTeamInvitationHidden(mutated), assert.AssertionError)
})

test('队伍详情与加入邀请采用首载、stale 内容和局部恢复三段式状态', () => {
  assertTeamStateUx(
    read('pages/team/detail/index.wxml'),
    read('pages/team/join/index.wxml'),
    read('pages/team/detail/index.json'),
    read('pages/team/join/index.json'),
    read('pages/team/team.wxss'),
  )
})

test('队伍详情缺参可返回；刷新失败保留最后一次确认的队伍', () => {
  const missing = loadTeamPage('pages/team/detail/index.js')
  missing.page.onLoad({})
  assert.equal(missing.page.data.loading, false)
  assert.equal(missing.page.data.errorKind, 'missing-param')
  assert.equal(missing.page.data.errorAction, '返回上一页')
  missing.page.load(true)
  assert.equal(missing.pullStops.length, 1, '缺参时下拉刷新也必须收口，不能留下系统 loading')

  const stale = loadTeamPage('pages/team/detail/index.js')
  stale.page.teamId = '31'
  stale.page.data.team = { id: 31, title: '夜行小队' }
  stale.page.load()
  stale.page.load()
  assert.equal(stale.requests.length, 1, '详情重试同步连点不能发出并发请求')
  assert.equal(stale.page.data.loading, false)
  assert.equal(stale.page.data.refreshing, true)
  stale.requests[0].fail()
  assert.equal(stale.page.data.refreshing, false)
  assert.equal(stale.page.data.errorKind, 'network')
  assert.equal(stale.page.data.team.title, '夜行小队')
})

test('邀请缺参只返回来源页；加入失败在按钮附近留下重试状态', () => {
  const missing = loadTeamPage('pages/team/join/index.js')
  missing.page.onLoad({})
  assert.equal(missing.page.data.errorKind, 'missing-param')
  assert.equal(missing.page.data.errorAction, '返回上一页')
  missing.page.onErrorAction()
  assert.equal(missing.backs.length, 1)
  assert.equal(missing.requests.length, 0)

  const join = loadTeamPage('pages/team/join/index.js')
  join.page.inviteCode = 'safe-code'
  join.page.data.team = { id: 31, status: 0 }
  join.page.load()
  join.page.load()
  assert.equal(join.requests.length, 1, '邀请重试同步连点不能发出并发请求')
  join.requests.length = 0
  join.page.join()
  assert.equal(join.page.data.joining, true)
  join.requests[0].fail()
  assert.equal(join.page.data.joining, false)
  assert.equal(join.page.data.joinError, '网络没连上，请检查后重试')
})

test('负控:退回纯文字 loading 或移除加入局部错误时，状态契约必须判红', () => {
  const detail = read('pages/team/detail/index.wxml')
  const join = read('pages/team/join/index.wxml')
  const args = [
    detail,
    join,
    read('pages/team/detail/index.json'),
    read('pages/team/join/index.json'),
    read('pages/team/team.wxss'),
  ]
  const bareLoading = detail.replace(/<cy-skeleton\b[^>]*\/>/, '<view wx:if="{{loading}}">正在加载</view>')
  assert.notEqual(bareLoading, detail, '骨架负控锚点失效')
  assert.throws(() => assertTeamStateUx(bareLoading, ...args.slice(1)), /同构的骨架/)

  const missingJoinRecovery = join.replace(/<cy-inline-error\b[^>]*joinError[^>]*\/>/, '')
  assert.notEqual(missingJoinRecovery, join, '加入错误负控锚点失效')
  assert.throws(() => assertTeamStateUx(detail, missingJoinRecovery, ...args.slice(2)), /加入失败/)
})
