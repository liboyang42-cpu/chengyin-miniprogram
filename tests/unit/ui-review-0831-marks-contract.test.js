'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const FIXTURES = () => JSON.parse(read('scripts/fixtures.json'))
const SELECTORS = () => JSON.parse(read('scripts/selectors.json'))

test('A22 搜索历史走 normalize，猜你想搜空词不渲染', () => {
  const js = read('pages/search2/index.js')
  const wxml = read('pages/search2/index.wxml')
  assert.match(js, /normalizeSearchHistory/)
  assert.match(wxml, /wx:if="\{\{\s*hotkeys\.length\s*\}\}"/)
  assert.match(wxml, /wx:if="\{\{item\}\}"/)
})

test('A07 广场骨架时不出现正在加载更多动态', () => {
  const wxml = read('pages/square/list/index.wxml')
  assert.match(wxml, /isLoadingMore && list\.length/)
  assert.doesNotMatch(wxml, /wx:if="\{\{isLoadingMore\}\}"[^>]*>正在加载更多动态/)
})

test('A48 收藏刷新不写加载中汉字', () => {
  const wxml = read('pages/mylike/mylike.wxml')
  assert.doesNotMatch(wxml, /正在更新收藏列表/)
})

test('E02 错误态主按钮不能再写出错了', () => {
  const errorJs = read('components/cy/error/index.js')
  const shellJs = read('components/cy/state-shell/index.js')
  assert.match(errorJs, /出错了/)
  assert.match(errorJs, /retryLabel/)
  assert.match(shellJs, /_primary/)
})

test('B16 通关继续是浅底黑主按钮，不是故事紫', () => {
  const wxss = read('pages/play/index.wxss')
  const cta = wxss.match(/\.finsheet__cta\{[^}]+\}/)
  assert.ok(cta, '缺少 .finsheet__cta')
  assert.doesNotMatch(cta[0], /play-story-accent/)
  assert.match(cta[0], /play-story-text/)
})

test('B48 创作四步提示已从发布器拿掉', () => {
  const wxml = read('pages/publish/fabu/index.wxml')
  assert.doesNotMatch(wxml, /创作四步/)
  assert.doesNotMatch(wxml, /pd-guide-card/)
})

test('F39 城市签不再放上面的猫', () => {
  const wxml = read('pages/play/components/playkit-dailysign/index.wxml')
  const json = read('pages/play/components/playkit-dailysign/index.json')
  assert.doesNotMatch(wxml, /cy-mascot/)
  assert.doesNotMatch(json, /cy-mascot/)
})

test('官方活动列表用产品名，邀约是动作不是另一套产品', () => {
  const wxml = read('pages/activity/list/index.wxml')
  assert.match(wxml, /title="官方活动"/)
  assert.match(wxml, /aria-label="邀约"/)
  assert.doesNotMatch(wxml, /城市事件/)
  assert.doesNotMatch(wxml, /承接邀约/)
  const inboxWxml = read('pages/activity/official-inbox/index.wxml')
  const inboxJson = read('pages/activity/official-inbox/index.json')
  assert.match(inboxWxml, /title="官方活动邀约"/)
  assert.match(inboxJson, /官方活动邀约/)
  assert.doesNotMatch(inboxWxml, /活动承接邀约/)
})

test('B31 官方活动邀约接受绿拒绝红', () => {
  const wxss = read('pages/activity/official-inbox/index.wxss')
  assert.match(wxss, /\.oi-btn\.accept[\s\S]{0,180}status-success/)
  assert.match(wxss, /\.oi-btn\.decline[\s\S]{0,180}action-danger-bg/)
})

test('B66 勋章墙默认列表并按来源分组', () => {
  const js = read('subpackageP3/pages/badge-wall/index/index.js')
  const wxml = read('subpackageP3/pages/badge-wall/index/index.wxml')
  assert.match(js, /viewMode:\s*'list'/)
  assert.match(js, /BADGE_FAMILIES/)
  assert.match(wxml, /badgeGroups/)
  assert.match(wxml, /城市身份卡|bw-list-h/)
})

// 2026-09-07 用户拍板:合作池整块删除 —— 收件箱就是收到的协作邀请、发件箱就是发出去的,
// 「合作池」这个概念不存在。原来这条断言的是「消息页不挂、协作页收着」,
// 现在协作页也不收了,断言跟着变成「哪儿都没有」。
/* 2026-09-11:「合作池已整块删除」这条随 coop/list 一起摘回 master 的 #1058 ——
   那一页现在是 master 的版本,合作池还在。本分支不再对它做断言。 */

test('停表模板管理页已从 app.json 注销', () => {
  const app = JSON.parse(read('app.json'))
  const play = app.subPackages.find((pkg) => pkg.root === 'pages/play')
  assert.ok(play)
  assert.deepEqual(play.pages.filter((page) => page.startsWith('stopwatch')), [])
})

test('C48 名册封面卡比原来大', () => {
  const wxss = read('pages/club/enroll/index.wxss')
  const cover = wxss.match(/\.team-cover\s*\{[^}]+\}/)
  assert.ok(cover)
  assert.match(cover[0], /200rpx/)
})

test('A22 搜索夹具是字符串词，不含示例对象', () => {
  const data = FIXTURES().A22.data
  assert.ok(data.searchHistory.length)
  assert.ok(data.searchHistory.every((item) => typeof item === 'string' && item && !item.includes('示例')))
  assert.ok(data.hotkeys.every((item) => typeof item === 'string' && item && !item.includes('示例')))
  assert.equal(JSON.stringify(data.searchHistory).includes('categoryName'), false)
})

test('D34 私信夹具是会话结构，能渲染行', () => {
  const data = FIXTURES().D34.data
  const row = data.list[0]
  assert.equal(data.activeTab, 'dm')
  assert.equal(data.loading, false)
  assert.equal(data.loaded, true)
  assert.equal(row.conversationId, 9)
  assert.equal(row.type, 1)
  assert.equal(row.counterparty.nickname, '周行')
  assert.equal(row.previewText, '明晚一起？')
  assert.equal(data.viewList[0].counterparty.nickname, '周行')
  assert.equal(SELECTORS().D34.selector, '.conv-wrap')
})

test('D35 系统夹具 tab 是 sys，会话 type=2', () => {
  const data = FIXTURES().D35.data
  assert.equal(data.activeTab, 'sys')
  assert.equal(data.list[0].type, 2)
  assert.ok(data.viewList.length >= 1)
  assert.doesNotMatch(JSON.stringify(data), /示例/)
})

test('E02 商家网络失败夹具不是出错了占位', () => {
  const data = FIXTURES().E02.data
  assert.equal(data.isMerchantViewer, true)
  assert.equal(data.loading, false)
  assert.equal(data.loadErrKind, 'network')
  assert.equal(data.loadErrTitle, '网络没连上')
  assert.equal(data.loadErrAction, '重试')
  assert.notEqual(data.loadErrSub, '出错了')
})

test('B66 列表夹具带 family 分组，断言打在勋章行上', () => {
  const data = FIXTURES().B66.data
  assert.equal(data.viewMode, 'list')
  assert.ok(data.badges.every((badge) => badge.family && badge.name && !String(badge.name).includes('示例')))
  assert.ok(data.badgeGroups.length >= 1)
  assert.ok(data.badgeGroups.every((group) => group.items && group.items.length))
  assert.equal(SELECTORS().B66.selector, '.bw-list-row')
})

test('第2批错误态夹具不再把出错了写进可见文案', () => {
  const fixtures = FIXTURES()
  const a08 = fixtures.A08.data
  assert.equal(a08.loadError, true)
  assert.equal(a08.list.length, 0)
  assert.equal(a08.loadMoreError, '')
  assert.equal(a08.submitError, '')
  assert.notEqual(a08.submitErrorKind, '出错了')

  const c03 = fixtures.C03.data
  // 2026-09-16 去闸:consoleState 已删除,工作台失败态由页内 consoleError 表达。
  assert.equal(c03.consoleError, '工作台暂时无法加载')
  assert.notEqual(c03.dashboardError, '出错了')

  const c21 = fixtures.C21.data
  assert.equal(c21.loadState, 'error')
  assert.equal(c21.loadErrTitle, '店铺装修加载失败')
  assert.notEqual(c21.loadErrSub, '出错了')
  assert.equal(c21.saveError, '')
  assert.equal(c21.featuredError, '')

  const d10 = fixtures.D10.data
  assert.equal(d10.firstLoading, false)
  assert.notEqual(d10.errorMsg, '出错了')
  assert.ok(d10.errorMsg)
  assert.equal(d10.list.length, 0)

  const b23 = fixtures.B23.data
  assert.notEqual(b23.submitError, '出错了')
  assert.equal(b23.waitlistError, '')

  const b64 = fixtures.B64.data
  assert.equal(b64.error, true)
  assert.equal(b64.items.length, 0)
})

test('post-card 与 scratch 不再引用未定义 token', () => {
  const post = read('components/cy/post-card/index.wxss')
  const scratch = read('pages/play/components/scratch/index.wxss')
  assert.doesNotMatch(post, /var\(--cy-warning\)/)
  assert.match(post, /var\(--cy-color-status-warning\)/)
  assert.doesNotMatch(scratch, /var\(--cy-color-surface-raised\)/)
  assert.match(scratch, /var\(--cy-color-bg-elevated\)/)
})

test('E26 主题空态要用页面副文案，不能落到这里还没有内容', () => {
  const wxml = read('subpackageA/pages/myproject/index.wxml')
  assert.match(wxml, /title="\{\{emptyTit\}\}"/)
  assert.match(wxml, /sub="\{\{emptySub\}\}"/)
  const js = read('subpackageA/pages/myproject/index.js')
  assert.match(js, /用发布按钮创建你的第一条城市路线/)
})

test('C13 营销空态夹具把优惠券落成零张，不是数据待同步', () => {
  const data = FIXTURES().C13.data
  assert.equal(data.marketingDataState, 'empty')
  assert.equal(data.couponCard, null)
  assert.equal(data.entries.length, 0)
})

test('A28 搜索加载夹具只留全部 tab，不带零计数', () => {
  const data = FIXTURES().A28.data
  assert.equal(data.searchLoading, true)
  assert.equal(data.showSearchSkeleton, true)
  assert.equal(data.visibleResults.length, 0)
  assert.deepEqual(data.resultTabs, [{ key: 'all', label: '全部' }])
  assert.equal(data.activeResultType, 'all')
  assert.equal(JSON.stringify(data.resultTabs).includes(' 0'), false)
})

test('C25 缺参走 info 图标，夹具文案与页面守卫一致', () => {
  const wxml = read('pages/topic/index/index.wxml')
  const branch = /<cy-empty wx:if="\{\{\s*missingTopicId\s*\}\}"([^>]*)\/>/.exec(wxml)
  assert.ok(branch, '主题缺参必须走 cy-empty')
  assert.match(branch[1], /kind="missing-param"/)
  assert.doesNotMatch(branch[1], /icon=/, '缺参不能再盖空态位图')
  const js = read('pages/topic/index/index.js')
  assert.match(js, /loadErrorTitle:\s*'无法打开主题'/)
  assert.match(js, /loadErrorSub:\s*'缺少主题信息，请返回发布广场重新选择。'/)
  const data = FIXTURES().C25.data
  assert.equal(data.missingTopicId, true)
  assert.equal(data.loadErrorTitle, '无法打开主题')
  assert.equal(data.loadErrorSub, '缺少主题信息，请返回发布广场重新选择。')
})

test('A54 裁剪缺参不盖空态位图', () => {
  const wxml = read('pages/crop/index.wxml')
  const tag = wxml.match(/<cy-empty[^>]*kind="missing-param"[^>]*>/)
  assert.ok(tag, '裁剪无源必须走 missing-param')
  assert.doesNotMatch(tag[0], /icon=/, '缺参必须露出 KIND_DEFAULTS 的 info glyph')
})

test('D12 参与详情缺参不是错误态插画', () => {
  const wxml = read('subpackageMember/components/scene-member-participation-detail/index.wxml')
    .replace(/<!--[\s\S]*?-->/g, '')
  const js = read('subpackageMember/components/scene-member-participation-detail/index.js')
  assert.match(js, /loadState:\s*'missing-param'/)
  const missing = wxml.match(/<cy-empty[^>]*wx:elif="\{\{loadState === 'missing-param'\}\}"[^>]*>/)
  assert.ok(missing, '缺参必须走 cy-empty')
  assert.match(missing[0], /kind="missing-param"/)
  assert.doesNotMatch(missing[0], /没能打开/)
  assert.doesNotMatch(missing[0], /icon=/)
  assert.doesNotMatch(wxml, /<cy-error[^>]*icon="\/images\/no_data\.svg"/)
  assert.equal(SELECTORS().D12.selector, 'cy-empty')
})

test('B09 漫游找不到这次记录走缺参图标', () => {
  const wxml = read('components/cy/scene-roam-session/index.wxml')
  assert.match(wxml, /<cy-empty[^>]*kind="missing-param"[^>]*title="找不到这次漫游"/)
})

test('A30 定位权限条是唯一恢复出口，不叠加载失败胶囊', () => {
  const wxml = read('pages/searchmap/index.wxml')
  assert.match(wxml, /smap-location-error__action[\s\S]{0,280}去设置/)
  assert.match(wxml, /smap-listbtn[\s\S]{0,80}wx:if="\{\{!locationError && !bmShow/)
  const js = read('pages/searchmap/index.js')
  assert.match(js, /定位权限未开启'/)
  const data = FIXTURES().A30.data
  assert.equal(data.locationError, true)
  assert.equal(data.locationAction, 'open-setting')
  assert.equal(data.listState, 'ready')
  assert.doesNotMatch(data.locationMessage, /点这里重试/)
})

test('C50 名册无权限走锁图标，不是缺参 info', () => {
  const wxml = read('pages/club/enroll/index.wxml')
  // 2026-09-15 弹窗合同:无权限改为零按钮 fail 面板(cy-error auto-back),不再是整页 cy-empty
  const denied = wxml.match(/<cy-error[^>]*permissionState === 'denied'[^>]*>/)
  assert.ok(denied)
  assert.match(denied[0], /auto-back/)
  assert.doesNotMatch(denied[0], /kind="missing-param"/)
})

test('C56 定位拒绝走权限空态，不去空态位图', () => {
  const wxml = read('pages/coop/nearby/index.wxml')
  const perm = wxml.match(/<cy-empty[^>]*pageState === 'permission'[^>]*>/)
  assert.ok(perm, '定位拒绝必须走 cy-empty')
  assert.match(perm[0], /kind="permission"/)
  assert.match(perm[0], /cta="去设置"/)
  assert.doesNotMatch(perm[0], /icon=/)
  assert.doesNotMatch(wxml, /pageState === 'permission'[^>]*icon="\/images\/no_data\.svg"/)
})

test('C45 主理人夹具能渲染俱乐部正文，不是错误壳', () => {
  const data = FIXTURES().C45.data
  assert.equal(data.detailLoaded, true)
  assert.equal(data.notFound, false)
  assert.equal(data.club.isOwner, true)
  assert.equal(data.club.isJoined, true)
  assert.ok(data.club.name)
  assert.equal(data.canUseManageTab, true)
  assert.ok(data.clubTabs.some((tab) => tab.key === 'manage'))
  assert.ok(data.posts.length)
  assert.equal(SELECTORS().C45.selector, '.cover-wrap, .cover-nav-act')
  assert.ok(SELECTORS().C45.forbid.includes('.error-state'))
})

test('B22 无候补时不画空候补卡', () => {
  const wxml = read('pages/activity/baoming/baoming.wxml')
  assert.match(wxml, /class="waitlist-card"/)
  assert.match(wxml, /waitlistState && waitlistState !== 'NONE'/)
  const fixtures = FIXTURES()
  assert.equal(fixtures.B22.data.waitlistState, 'NONE')
  assert.equal(fixtures.B22.data.ticketSoldOut, false)
  assert.equal(fixtures.B23.data.waitlistState, 'NONE')
  assert.equal(fixtures.B23.data.ticketSoldOut, false)
  assert.equal(fixtures.B26.data.waitlistState, 'NONE')
  assert.equal(fixtures.B26.data.ticketSoldOut, false)
})

test('C30 时间选择夹具打开的是时段 sheet，不是日期区间', () => {
  const data = FIXTURES().C30.data
  assert.equal(data.phase, 'form')
  assert.equal(data.timePicker.show, true)
  assert.equal(data.availabilityPickerShow, false)
})

test('A11 长正文是字符串帖，图片位不能塞评论对象', () => {
  const data = FIXTURES().A11.data
  assert.ok(data.info.contents.length > 80)
  assert.doesNotMatch(data.info.contents, /示例/)
  assert.ok(Array.isArray(data.picList))
  assert.ok(data.picList.every((pic) => typeof pic === 'string'))
  const wxss = read('pages/square/detail/index.wxss')
  const post = wxss.match(/\.detail\.theme-dark \.post-text\s*\{[^}]+\}/)
  assert.ok(post)
  assert.match(post[0], /overflow-wrap:\s*anywhere|word-break:\s*break-word/)
})

test('C27 滚动夹具带主题封面和节点，空卡滚不动', () => {
  const data = FIXTURES().C27.data
  assert.equal(data.fromMerchantJoin, true)
  assert.ok(data.info.name)
  assert.ok(data.info.imgUrl)
  assert.ok(data.info.description)
  const node = data.info.chaptersList[0].nodes[0]
  assert.ok(node.cmsMemberTemplate.title)
  assert.doesNotMatch(JSON.stringify(data.info), /示例/)
})

test('D38 注销页只留一次左对齐标题，夹具打进 scene 资格态', () => {
  const { SHOTS } = require('../../scripts/shot-matrix.js')
  const shot = SHOTS.find((item) => item.id === 'D38')
  const wxml = read('pages/deregister/index.wxml')
  assert.match(wxml, /<cy-page-title title="注销账号"/)
  assert.match(wxml, /<cy-sheet[^>]*show="\{\{true\}\}"/)
  assert.doesNotMatch(wxml, /<cy-sheet[^>]*title=/)
  assert.equal(shot.fixtureTarget, '#deregisterFlow')
  const fixtures = FIXTURES()
  assert.equal(fixtures.D38.target, '#deregisterFlow')
  assert.equal(fixtures.D38.data.status, 'ELIGIBLE')
  assert.equal(SELECTORS().D38.selector, '.deregister-copy')
  assert.ok(SELECTORS().D38.forbid.includes('cy-error'))
  assert.ok(SELECTORS().D38.forbid.includes('cy-empty'))
})

test('内容区切换走 fill 下划线，不走 chip 药丸或 segmented', () => {
  const merchantinfo = read('pages/topic/merchantinfo/merchantinfo.wxml')
  const browse = merchantinfo.match(/<cy-tabs[^>]*class="browse-tabs"[^>]*>/)
  assert.ok(browse)
  assert.match(browse[0], /variant="fill"/)
  assert.doesNotMatch(browse[0], /variant="chip"/)

  const im = read('subpackageB/pages/im/list/index.wxml')
  const imTabs = im.match(/<cy-tabs[^>]*class="tabs-row"[^>]*>/)
  assert.ok(imTabs)
  assert.match(imTabs[0], /variant="fill"/)
  assert.doesNotMatch(imTabs[0], /variant="chip"/)

  const myproject = read('subpackageA/pages/myproject/index.wxml')
  const typeTabs = myproject.match(/<cy-tabs[^>]*tabs="\{\{typeTabs\}\}"[^>]*>/)
  assert.ok(typeTabs)
  assert.match(typeTabs[0], /variant="fill"/)
  assert.doesNotMatch(typeTabs[0], /variant="chip"/)

  const coop = read('pages/coop/list/index.wxml')
  const coopTabs = coop.match(/<cy-tabs[^>]*class="coop-tabs"[^>]*>/)
  assert.ok(coopTabs)
  assert.match(coopTabs[0], /variant="fill"/)
  assert.doesNotMatch(coopTabs[0], /variant="chip"/)

  /* 2026-09-09 票夹按用户裁决合并了「路线 / 场次」两个 tab,这一页已经没有内容区 Tab。
     本条规范说的是「**若有**内容区 Tab 必须走 fill」,没有 Tab 就不适用 ——
     改成断言它确实没有,免得这条空挂着变成永远绿的死断言。 */
  const signup = read('subpackageMember/signup/index.wxml')
  assert.doesNotMatch(signup, /<cy-tabs/, '票夹已不分 tab;若要重新引入内容区 Tab,必须走 variant="fill"')

  /* 2026-09-10:合作中心这一档改钉「不是药丸/分段」,不再钉 variant="fill" 这个字面值。
     本条规范(2026-08-31)要的是**下划线形态**;稿 234:282(2026-09-03,更晚)明确画的是
     两档左对齐、下划线只有 20px 宽居中在文字下 —— 那是 cy-tabs 的默认档,不是 fill。
     fill 会让两档各占半屏、下划线撑满半个屏幕,与稿不符。
     ⚠️ 只放开这一页;下面 club/detail 那两处仍按原样钉 fill。 */
  const center = read('pages/merchant/coop-center/index.wxml')
  const ccTabs = center.match(/<cy-tabs[^>]*class="cc-tabs"[^>]*>/)
  assert.ok(ccTabs)
  assert.doesNotMatch(ccTabs[0], /variant="(chip|segmented)"/, '内容区切换不许退回药丸/分段')

  const club = read('pages/club/detail/index.wxml')
  const eventView = club.match(/<cy-tabs[^>]*class="event-view-tabs"[^>]*>/)
  assert.ok(eventView)
  assert.match(eventView[0], /variant="fill"/)
  assert.doesNotMatch(eventView[0], /variant="chip"/)
})

test('同页状态筛选走 chip 药丸，不走 fill 下划线', () => {
  const aftercare = read('pages/merchant/aftercare/index.wxml')
  const filters = aftercare.match(/<cy-tabs[^>]*class="acl-filter"[^>]*>/g)
  assert.equal(filters && filters.length, 2)
  filters.forEach((tag) => {
    assert.match(tag, /variant="chip"/)
    assert.doesNotMatch(tag, /variant="fill"/)
  })

  const roster = read('pages/club/event-ops/index.wxml')
  const rosterTabs = roster.match(/<cy-tabs[^>]*class="roster-filter"[^>]*>/)
  assert.ok(rosterTabs)
  assert.match(rosterTabs[0], /variant="chip"/)
  assert.doesNotMatch(rosterTabs[0], /variant="fill"/)
})

test('提现记录和邀请记录深链壳只留一次页面标题', () => {
  const withdraw = read('subpackageMember/tixianjilu/tixianjilu.wxml')
  assert.match(withdraw, /<cy-page-title title="提现记录"/)
  assert.doesNotMatch(withdraw, /<cy-sheet/)
  assert.match(withdraw, /<cy-scene-member-withdraw-history id="withdrawHistory"/)
  assert.doesNotMatch(read('subpackageMember/tixianjilu/tixianjilu.json'), /cy-sheet/)

  const invite = read('subpackageMember/myinvite/myinvite.wxml')
  assert.match(invite, /<cy-page-title title="邀请记录"/)
  assert.doesNotMatch(invite, /<cy-sheet/)
  assert.match(invite, /<cy-scene-member-invite-history id="inviteHistory"/)
  assert.doesNotMatch(read('subpackageMember/myinvite/myinvite.json'), /cy-sheet/)
})
