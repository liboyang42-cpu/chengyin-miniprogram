'use strict'

// 俱乐部详情 N 系列对稿契约(Figma s7SEFaoJ3GQUIxJhdqcFUb)
//   N1b 47:2 帖子 · N3 20:137 概览 · N5 24:175 概览(普通会员) · N6 24:314 概览(未加入)
//   N2-A 282:350 活动空态 · N2-B 282:499 活动有活动 · 活动卡 281:360 · PostCard 211:270
// 断言一律钉结构(行首选择器 / 行首属性 / 元素与 wx:if 的相邻关系),不钉解释性注释。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 取某个选择器的规则体(允许同名多条,拼起来一起看)
function rule(source, selector) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const bodies = []
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim()).includes(selector)) bodies.push(m[2])
  }
  assert.ok(bodies.length, `缺少规则 ${selector}`)
  return bodies.join('\n')
}

function assertContract(overrides = {}) {
  const wxml = overrides.wxml === undefined ? read('pages/club/detail/index.wxml') : overrides.wxml
  const wxss = overrides.wxss === undefined ? read('pages/club/detail/index.wxss') : overrides.wxss
  const js = overrides.js === undefined ? read('pages/club/detail/index.js') : overrides.js

  // —— Shell(六屏共同,Figma 93:9 / 93:18 / 93:20 / 93:22)——
  assert.match(rule(wxss, '.cover-wrap'), /height:\s*320rpx/, '封面 160px = 320rpx')
  assert.match(rule(wxss, '.profile-logo-wrap'), /width:\s*112rpx/, 'logo 56px = 112rpx')
  assert.match(rule(wxss, '.profile-logo-wrap'), /height:\s*112rpx/)
  assert.match(rule(wxss, '.profile-id'), /padding-left:\s*140rpx/, '名字行让开 logo(pl70)')
  assert.match(rule(wxss, '.profile-name'), /text-overflow:\s*ellipsis/, '俱乐部名单行省略')
  // 元信息是三枚「图标 + 文字」chip,不是一行 · 拼接的纯文本
  assert.match(rule(wxss, '.profile-meta'), /display:\s*flex/)
  assert.match(rule(wxss, '.profile-meta-chip'), /display:\s*flex/)
  assert.equal((wxml.match(/class="profile-meta-chip"/g) || []).length, 3, '元信息必须是三枚 chip')
  assert.equal((wxml.match(/class="profile-meta-ico"/g) || []).length, 3, '每枚 chip 必须带图标')

  // —— 概览:简介直接铺开,标题下不要小标题 ——
  assert.match(wxml, /class="ov-intro"/)
  // 钉结构而非字面量:小标题的载体是 .overview-label,注释里出现「俱乐部简介」四个字不算回潮。
  assert.doesNotMatch(wxml, /class="overview-label"/, '全局规约:标题下不要小标题')

  // —— Facts 三宫格(23:4)——
  assert.match(rule(wxss, '.ov-facts'), /display:\s*flex/)
  assert.equal((wxml.match(/class="ov-fact"/g) || []).length, 3, '主理人 / 等级 / 所在城市 三格')
  assert.match(wxml, /class="ov-fact-value"[\s\S]{0,200}class="ov-fact-label"/, '值在上、标签在下')

  // —— MembersHead:「邀请成员 ›」只给主理人/管理员(N5 普通会员那版没有这一行链接)——
  // CU-C-61:载体从 text+aria-role 换成原生 <button open-type="share">,角色判据不变。
  assert.match(wxml, /<button[^>]*wx:if="\{\{club\.isOwner \|\| club\.viewerIsAdmin\}\}"[^>]*class="ov-head-link"/, '邀请成员不能开给普通成员')
  assert.match(wxml, /name="slide-arrow"/, '› 用 slide-arrow,不用 arrow-right(带横杠)')

  // —— 成员横向头像条 + 未加入时的 Locked 卡(23:18 / 25:2 / 25:5)——
  assert.match(wxml, /class="ov-strip"[^>]*wx:if="\{\{memberStrip\.length\}\}"/)
  assert.match(js, /function buildMemberStrip/)
  assert.match(js, /'\+' \+ rest/, '第 5 位是「+N」溢出位')
  assert.equal((wxml.match(/class="ov-locked"/g) || []).length, 2, '成员与榜单各一张 Locked 卡')
  assert.match(wxml, /加入后可看成员名单/)
  assert.match(wxml, /加入后可看贡献榜/)

  // —— 榜单:「综合 ▾」下拉取代 chip tabs,卡容器 + 折叠行 + 我那一行高亮 ——
  assert.doesNotMatch(wxml, /class="rank-tabs"/, '排序已从 chip tabs 收成榜头下拉')
  assert.match(wxml, /catchtap="onRankSortTap"/)
  assert.match(js, /onRankSortTap\(\)\s*\{/)
  assert.match(js, /function foldLeaderboard/)
  assert.match(wxml, /class="ov-lb-gap"[^>]*wx:if="\{\{item\.gap\}\}"/, '「⋯ 中间 N 人」折叠行')
  assert.match(rule(wxss, '.ov-lb'), /background:\s*var\(--cy-color-bg-elevated\)/, '榜单进一张 elevated 卡')
  assert.match(rule(wxss, '.ov-lb-row.is-me'), /background:/, '我那一行要压底色')

  // —— 稿没画但现码有:治理与安全,不许照稿删掉 ——
  // 2026-09-09「会员与会费」按用户裁决(会费暂时不做)随两个会费页一并删除,这条断言撤走。
  assert.doesNotMatch(wxml, /membership-overview-entry/, '会费整条已撤,不许留一个通向已删页的入口')
  assert.match(wxml, /class="overview-section governance-help-entry"/, '治理与安全必须保留')
  assert.match(wxml, /goClubAppeal/)
  assert.match(wxml, /reportClub"/)

  // —— 活动 tab:即将举行 / 已结束 两段(282:622 / 282:660)——
  assert.match(wxml, /即将举行/)
  assert.match(wxml, /class="ev-sec-head ev-sec-head--second"[\s\S]{0,200}已结束/)
  assert.match(wxml, /wx:if="\{\{endedTopics\.length\}\}"/, '没有已结束场次时整段不出')
  assert.match(js, /function splitTopics/)

  // —— 活动卡 N2 20:52:封面通栏 + 状态胶囊叠封面 + 标题/一行元信息 + 三列数字块 ——
  // 2026-09-09 从 281:360 的横卡(左封面 + 右四行)改成稿 N2 的竖卡。
  assert.match(wxml, /<template name="clubEventCard">/)
  assert.match(wxml, /class="ev-coverslot"[\s\S]{0,300}class="ev-status ev-status--\{\{item\.statusTone\}\}"/,
    '状态胶囊叠在封面上,不再是右列第一行')
  assert.match(wxml, /class="ev-name"[\s\S]{0,200}class="ev-time"[\s\S]{0,400}class="ev-stats"/)
  // 三列数字块:算不出来的那一格整格不出,不用 0 冒充(「0 站」会被读成「这条路线没有站点」)
  for (const key of ['signupText', 'stationText', 'mileageText']) {
    assert.match(wxml, new RegExp('class="ev-stat" wx:if="\\{\\{item\\.' + key + '\\}\\}"'),
      key + ' 缺失时那一格必须整格不出')
  }
  assert.match(rule(wxss, '.ev-card'), /background:\s*var\(--cy-color-bg-elevated\)/)
  assert.match(rule(wxss, '.ev-status--live'), /var\(--cy-color-status-success\)/, '进行中 = success')
  assert.match(rule(wxss, '.ev-status--open'), /var\(--cy-color-status-warning\)/, '招募中 = warning')
  assert.match(js, /function topicStatusOf/)
  // 稿没画但现码有:出示团码 / 举报活动,留在卡内
  assert.match(wxml, /class="event-group-code"/)
  assert.match(wxml, /class="event-report"/)

  // —— 活动空态 282:478:卡容器内 标题 / 说明 / 主按钮 / 归属提示 ——
  // 2026-09-06 裸文字空态收编:标题 / 说明 / 主按钮 / 归属提示 都由 cy-empty 承载(说明里带归属句,cta 只给主理人)
  assert.match(rule(wxss, '.ev-empty'), /background:\s*var\(--cy-color-bg-elevated\)/)   // 空态仍在卡容器内(282:478)
  assert.match(wxml, /<cy-empty wx:else class="ev-empty" title="还没有城市路线"[^>]*sub="\{\{club\.isOwner \|\| canManageActivities \?[^>]*会自动绑定「[^>]*cta="\{\{club\.isOwner \|\| canManageActivities \? '发布主题' : ''\}\}" bind:cta="onCreateTeam"/)

  // —— 发帖入口 285:395:头像 + 昵称 / 提示语 / 工具栏三图标 ——
  assert.match(wxml, /class="post-composer-who"[\s\S]{0,200}class="post-composer-ph"[\s\S]{0,200}class="post-composer-tools"/)
  assert.equal((wxml.match(/class="post-composer-ico"/g) || []).length, 3, '工具栏三枚图标')
}

test('俱乐部详情 N 系列按 Figma 落地:Shell 尺寸、概览三段、活动分段与活动卡', () => {
  assertContract()
})

test('负控:封面高度退回 240rpx 判红', () => {
  const wxss = read('pages/club/detail/index.wxss')
  const mutated = wxss.replace(/(\.cover-wrap\s*\{[\s\S]*?)height:\s*320rpx/, '$1height: 240rpx')
  assert.notEqual(mutated, wxss, '负控锚点失配:.cover-wrap 里已经没有 height: 320rpx')
  assert.throws(() => assertContract({ wxss: mutated }), /320rpx/)
})

test('负控:「邀请成员」放开给普通成员判红', () => {
  const wxml = read('pages/club/detail/index.wxml')
  const mutated = wxml.replace('wx:if="{{club.isOwner || club.viewerIsAdmin}}" class="ov-head-link"', 'wx:if="{{true}}" class="ov-head-link"')
  assert.notEqual(mutated, wxml, '负控锚点失配:邀请成员的角色判据已改写')
  assert.throws(() => assertContract({ wxml: mutated }), /邀请成员/)
})

test('负控:照稿删掉「治理与安全」判红', () => {
  const wxml = read('pages/club/detail/index.wxml')
  const mutated = wxml.replace('class="overview-section governance-help-entry"', 'class="overview-section governance-help-entry-removed"')
  assert.notEqual(mutated, wxml, '负控锚点失配:治理与安全区块 class 已改名')
  assert.throws(() => assertContract({ wxml: mutated }), /治理与安全/)
})

test('负控:活动不再分「即将举行 / 已结束」两段时判红', () => {
  const wxml = read('pages/club/detail/index.wxml')
  const mutated = wxml.replace('wx:if="{{endedTopics.length}}"', 'wx:if="{{false}}"')
  assert.notEqual(mutated, wxml, '负控锚点失配:已结束段的判据已改写')
  assert.throws(() => assertContract({ wxml: mutated }), /整段不出/)
})
