const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => readResolved(relativePath)

const OWNER_NORMAL = [
  'subpackageMember/mytemplate/mytemplate',
  'subpackageMember/myinvite/myinvite',
  'pages/club/join-requests/index',
]
const WIZARD_EXCEPTION = 'pages/club/create/index'
const WIZARD_EXCEPTION_2 = 'pages/club/apply/index'
const WEBGL_EXCEPTION = 'subpackageP3/pages/badge-wall/index/index'

// 完整路由盘点：总数断言只能防止数量漂移，逐路由集合才能防止两个页面互换后仍然假绿。
const EXPECTED_NAV_ROUTES = [
  'subpackageRoam/nearby/index',
  // 2026-08-04 收口:漫游历史从手写 .hs-back/.hs-title 换成 cy-nav-bar plain + cy-page-title
  'subpackageRoam/history/index', 'subpackageRoam/session/index',
  'pages/square/list/index', 'pages/square/detail/index',
  'pages/search2/index', 'pages/search2/result/index', 'subpackageMember/signup/index',
  'pages/templatedetail/templatedetail',
  'pages/address/address', 'pages/addressinfo/addressinfo', 'pages/shezhi/shezhi', 'pages/shezhi/about/index',
  'pages/club/apply/index',
  'pages/agreement/index', 'pages/deregister/index', 'pages/gerenziliao/gerenziliao', 'pages/userinfo/userinfo',
  'subpackageMember/mytemplate/mytemplate', 'subpackageMember/coupon-qr/index', 'subpackageMember/coupon/coupon',
  'subpackageMember/couponInfo/couponInfo', 'subpackageMember/order/order', 'subpackageMember/orderinfo/orderinfo',
  // 2026-08-24：userinfo 正常态仍由 cy-profile 持有标题；缺 userId 的深链恢复态
  // 在页面壳显示 cy-nav-bar + cy-page-title，因此静态盘点重新纳入该路由。
  'subpackageMember/tixian/tixian', 'subpackageMember/tixianjilu/tixianjilu',
  'pages/mylike/mylike', 'subpackageMember/mycanyu/mycanyu', 'subpackageMember/mycanyuinfo/mycanyuinfo',
  'subpackageMember/myinvite/myinvite', 'subpackageMember/complaint/index', 'subpackageRoam/citynode-code/index',
  'pages/activity/detail/index', 'pages/activity/baoming/baoming', 'pages/activity/list/index',
  'pages/activity/official-detail/index', 'pages/activity/official-inbox/index',
  'pages/activity/official-mine/index',
  'subpackageA/pages/myproject/index', 'subpackageA/pages/infomation/infomation',
  'subpackageA/pages/infomationdetail/infomationdetail',
  'subpackageA/pages/assetcenter/income-detail/income-detail', 'subpackageA/pages/assetcenter/earnings/index',
  'subpackageP3/pages/growthcenter/index/index',
  'subpackageP3/pages/growthcenter/leaderboard/index',
  'subpackageP3/pages/stamp-album/index/index', 'subpackageB/pages/im/list/index',
  'subpackageB/pages/im/chat/index', 'pages/publish/simple/index', 'pages/publish/temp/index',
  'pages/publish/activity/index',
  'pages/publish/templateadd/templateadd', 'pages/publish/template-intro/index',
  'pages/club/create/index', 'pages/club/detail/index', 'pages/club/edit/index', 'pages/club/enroll/index', 'pages/club/checkin-detail/index', 'pages/club/join-requests/index',
  'pages/club/topic-detail/index',
  'pages/club/topic-story/index',
  'pages/club/group-code/index', 'pages/club/workbench/index', 'pages/club/customers/index', 'pages/club/customer-detail/index', 'pages/club/roles/index', 'pages/club/governance/index', 'pages/club/event-ops/index', 'pages/club/settlement/index', 'pages/club/notify/index',
  'pages/topic/index/index', 'pages/topic/merchantinfo/merchantinfo',
  'pages/team/detail/index', 'pages/team/join/index',
  // 2026-09-19 +1:批复1-a=2 partner 页复活(cy-nav-bar 出标题,无 cy-page-title)。
  'pages/topic/pricing/partner/index',
  'pages/topic/pricing/index',
  'pages/play/circle/index',
  'pages/merchant/apply/index', 'pages/merchant/ledger/index', 'pages/merchant/ledger/order-detail/index', 'pages/merchant/ledger/batch-detail/index', 'pages/merchant/profile/index',
  'pages/merchant/citynode/index', 'pages/merchant/citynode/create/index',
  'pages/merchant/decor/index', 'pages/merchant/decor/ai-npc/index', 'pages/merchant/decor/coop-setting/index',
  'pages/merchant/decor/gallery/index', 'pages/merchant/decor/perks/index',
  // coop-center 同时在两张盘点上:cy-nav-bar 只出返回键(所以进 nav 盘点),
  // 标题由 cy-page-title 持有(所以也进 page-title 盘点)。标题仍然只出现一次。
  'pages/merchant/coop-center/index', 'pages/merchant/customer/index', 'pages/merchant/game-node/index',
  'pages/merchant/aftercare/index', 'pages/merchant/aftercare/detail/index',
  'pages/merchant/customer/detail/index', 'pages/merchant/reviews/index', 'pages/merchant/team/index',
  'pages/merchant/predict/index',
  'pages/merchant/marketing/ai-insight/index',
  // 2026-08-25:营销/合作两个商家 tab 页改用居中 cy-nav-bar(无返回箭头),纳入 nav 盘点
  'pages/merchant/marketing/index', 'pages/merchant/relation/index',
  'pages/coop/list/index', 'pages/coop/invite-detail/index', 'pages/coop/invite/index', 'pages/coop/nearby/index',
  'pages/coop/finance/index',
  'pages/coop/settlement-detail/index',
  'pages/coop/withdraw/index', 'pages/coop/withdraw/records/index',
  /* 2026-09-22 Phase 0 物品卡实验室页:custom 导航 + cy-nav-bar,顶栏只有返回钮。 */
  /* 2026-09-22 Phase 3 藏品册页:同上,custom 导航 + cy-nav-bar。 */
  'subpackageP3/pages/object-cards/index/index',
]

const EXPECTED_PAGE_TITLE_ROUTES = [
  /* 2026-09-06 本分支曾把 coop-center 按稿 234:278 迁进这份盘点(返回箭头 + 左对齐大标题)。
     2026-09-11 那一页整块摘回 master 的 #1058 ⇒ 它的标题形态也回到 master 的居中 nav 标题,
     这里跟着摘除;上面 EXPECTED_NAV_ROUTES 里那一条仍然在,两份盘点不重复登记。 */
  'subpackageRoam/history/index',   // 同上:收口后大标题由 cy-page-title 出
  'pages/activity/detail/index',    // 活动详情正文收进 scene，深链壳改用统一 L1 标题
  // 2026-08-07 用户裁决:广场帖文流不设大标题,从 EXPECTED_PAGE_TITLE_ROUTES 摘除
  'pages/search2/index',
  // 2026-09-20 UI-17:票夹页去实底黑条，当前票名承担页面上下文，cy-page-title 摘除
  'pages/address/address', 'pages/addressinfo/addressinfo',
  // 2026-09-06:申请页大标题用回共享 cy-page-title(不再自绘 .ca-q)
  'pages/club/apply/index',
  'pages/shezhi/shezhi', 'pages/shezhi/about/index', 'pages/agreement/index', 'pages/deregister/index', 'pages/userinfo/userinfo',
  'subpackageMember/mytemplate/mytemplate', 'subpackageMember/coupon/coupon', 'subpackageMember/couponInfo/couponInfo',
  'subpackageMember/order/order', 'subpackageMember/orderinfo/orderinfo', 'subpackageMember/tixian/tixian',
  'subpackageMember/tixianjilu/tixianjilu', 'pages/mylike/mylike', 'subpackageMember/mycanyu/mycanyu',
  'subpackageMember/mycanyuinfo/mycanyuinfo', 'subpackageMember/myinvite/myinvite', 'subpackageMember/complaint/index',
  'subpackageRoam/session/index',
  'pages/activity/official-inbox/index',
  'pages/activity/official-mine/index', 'subpackageA/pages/myproject/index',
  'subpackageA/pages/infomation/infomation', 'subpackageA/pages/infomationdetail/infomationdetail',
  'subpackageA/pages/assetcenter/income-detail/income-detail', 'subpackageA/pages/assetcenter/earnings/index',
  'subpackageP3/pages/growthcenter/index/index',
  'subpackageP3/pages/growthcenter/leaderboard/index', 'subpackageP3/pages/stamp-album/index/index',
  'pages/publish/temp/index', 'pages/publish/activity/index',
  'pages/publish/templateadd/templateadd',
  'pages/club/edit/index', 'pages/club/enroll/index', 'pages/club/checkin-detail/index', 'pages/club/group-code/index', 'pages/club/join-requests/index', 'pages/club/workbench/index', 'pages/club/customers/index', 'pages/club/customer-detail/index', 'pages/club/roles/index', 'pages/club/governance/index', 'pages/club/event-ops/index', 'pages/club/settlement/index', 'pages/club/notify/index',
  'pages/topic/pricing/index',
  'pages/team/detail/index', 'pages/team/join/index',
  // 2026-08-30 用户裁决：这 5 个任务页使用「返回独立行 + L1 大标题」。
  'pages/merchant/ledger/index', 'pages/merchant/ledger/order-detail/index',
  'pages/merchant/citynode/index', 'pages/merchant/aftercare/detail/index', 'pages/merchant/team/index',
  // 2026-09-17 用户裁决:退款售后列表照 Revolut Business 316-318,改为返回 + 左对齐 L1 大标题。
  'pages/merchant/aftercare/index',
  // 其余商家页继续使用居中 nav 标题，仍只保留在 nav inventory。
  'pages/coop/list/index', 'pages/coop/invite-detail/index', 'pages/coop/invite/index', 'pages/coop/nearby/index',
  'pages/coop/finance/index',
  'pages/coop/settlement-detail/index',
  'pages/coop/withdraw/index', 'pages/coop/withdraw/records/index',
  /* 2026-09-22 Phase 0 物品卡实验室页:普通玩家二级页,左对齐大标题「立体藏品卡」由 cy-page-title 出。 */
  /* 2026-09-22 Phase 3 藏品册页:普通玩家二级页,左对齐大标题「藏品册」由 cy-page-title 出。 */
  'subpackageP3/pages/object-cards/index/index',
]

// 2026-09-03 入职流重做:apply 与 create 统一成 cy-nav-bar + cy-h1 的向导形态,
//   apply 因此从 page-title 册挪到这里(page-title 70 → 69)。
// 2026-09-06:申请页大标题用回共享 cy-page-title,只剩建团页还是自绘 cy-h1 问句
const EXPECTED_CY_H1_ROUTES = ['pages/club/create/index']
// 2026-08-25 商家标题统一收尾:营销/合作两个 tab 页从左对齐 m-h1 换成居中 cy-nav-bar
// (工作台顶栏同批只留居中 logo mark),共享 .m-h1 随之删除 ⇒ 本清单恒空。
const EXPECTED_M_H1_ROUTES = []
const EXPECTED_BARE_H1_ROUTES = []
const TOPICADD_REDIRECT_SHELL = 'pages/publish/topicadd/topicadd'

function routeSources(route, readSource = read) {
  const base = route
  return {
    wxml: readSource(`${base}.wxml`),
    json: JSON.parse(readSource(`${base}.json`)),
  }
}

function classTokens(wxml) {
  return Array.from(wxml.matchAll(/class="([^"]*)"/g))
    .flatMap((match) => match[1].split(/\s+/))
}

function assertOwnerNormal(route) {
  const source = routeSources(route)
  assert.equal(source.json.navigationStyle, 'custom', `${route} 必须保留 custom 导航`)
  assert.match(source.wxml, /<cy-nav-bar\b/, `${route} 必须使用 cy-nav-bar`)
  assert.match(source.wxml, /<cy-page-title\b/, `${route} 必须使用 cy-page-title 作为页标题`)
  assert.equal(source.json.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index')
  assert.equal(source.json.usingComponents['cy-page-title'], '/components/cy/page-title/index')
  const tokens = classTokens(source.wxml)
  assert.equal(tokens.includes('h1'), false, `${route} 不得回到裸 .h1 标题`)
  assert.equal(tokens.includes('cy-h1'), false, `${route} 不得重复绘制 .cy-h1 标题`)
}

function assertTitleInventory(readSource = read) {
  const app = JSON.parse(readSource('app.json'))
  const routes = app.pages.concat(app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)))
  const rows = routes.map((route) => {
    const base = routeSources(route, readSource)
    const tokens = classTokens(base.wxml)
    return {
      route,
      custom: base.json.navigationStyle === 'custom',
      nav: /<cy-nav-bar\b/.test(base.wxml),
      pageTitle: /<cy-page-title\b/.test(base.wxml),
      h1: tokens.includes('h1'),
      cyH1: tokens.includes('cy-h1'),
      mH1: tokens.includes('m-h1'),
    }
  })
  // 2026-08-07:M1(+2 结算/订单详情页)与 M2(+5 装修/据点子页)合流;+1 badge-3d 徽章双样式详情(自绘标题,不入五类清单);−1 coop/mybiz 退役(内容并入商家台账)。
  // 2026-08-08:−3 三页版商家报名 merchantapply1/2/3 退役(入口早已统一落 merchantapply/index,见 4bbe5c282)。
  // 2026-08-08:−3 零入口页退役 +1 商家合作中心新页 +1 设置关于页 −1 旧商家官方活动页 = 106。
  // 2026-08-09:+2 入会申请/解散资金阻断主理人页 = 108。
  // 2026-08-10:−1 章节邀请页退役(并入 coop/nearby 的一份商家名单)= 107。
  // 2026-08-10:+1 商家客户名册页(merchant/customer)新建 = 108。
  // 2026-08-10:−1 漫游护照独立页退役(内容并入漫游页自己的「漫游护照」tab)= 107。
  // 2026-08-11:+1 据点薄深链宿主页(poi-detail)新建 = 108。
  // 2026-08-11:收益明细独立页一度按「退役」处理(−1),用户随后裁决「放到页面上,不要做弹窗」
  //            ⇒ 页面留下、只是不再套弹层,盘点数回到 108。
  // 2026-08-11:+1 对公批次详情(merchant/ledger/batch-detail)= 109。
  // 2026-08-12:+1 玩家券夹薄宿主页(coupon-wallet)= 110;商家发券页继续独立保留。
  // 2026-08-12:+1 自由探索商家权益页(play/merchant)新建 = 111。
  //   它是 hero 打头的沉浸页,顶部只有一枚玻璃返回钮,与漫游据点页同形态 ⇒ 不强塞 page-title。
  //   ⚠️ rebase 冲突留痕:本行原写 109(分支基线 108),master 侧已独立涨到 110 ——
  //   两边都在同一处记账才撞上。合并口径是「保留 master 的账 + 本页 +1」= 111,不是二选一。
  // 2026-08-16:+1 探店日俱乐部自报页(club/edition-report)= 112。
  //   ⚠️ 这一页是 2026-08-16 的四个 A 那一批新建并注册进 app.json 的,但当时**没有**跑
  //   xcx 单测(只跑了 ci/xcx-check.sh —— 它不跑 tests/unit),所以这两处棘轮一直红着没人看见。
  // 2026-08-20:+1 商家 AI 店铺参谋页(marketing/ai-insight),cy-nav-bar + cy-page-title 标准形态 = 113。
  // 2026-08-20:+3 玩家邀请制组队 create/detail/join，均为普通二级页 = 116。
  // 2026-08-21:-1 独立 create 表单下线，建队并入报名流程；detail/join 仍按普通二级页登记 = 115。
  // 2026-08-21:+1 仪式板页,后续 2026-08-29 整页退役。
  // 2026-08-21:+2 圈层主题配置页与玩家自助记录页，均使用统一 cy-nav-bar = 118。
  // 2026-08-24 并入 master 后:master 已含 120，本分支再 +1 商家 AI 店铺角色页（沿用商家居中 cy-nav-bar）= 121。
  // 2026-08-25:+1 图像来源页(封面图标 CC BY 3.0 的署名页),与关于页同形态 = 122。
  // 2026-08-26:-1 圈层专属配置页整页退役 = 121。
  // 2026-08-25 商家/俱乐部补全新增 11 页：9 个 custom 导航经营/治理页，另有 2 个保留原生导航的会员/会费页。
  // 121 + 11 = 132；其中 121 + 9 = 130 页使用 custom 导航。
  // 2026-08-27:+2 精准停表模板主页与玩一局页,均为 custom 导航 + cy-nav-bar 居中标题(无 L1 大标题)
  //   = 134；custom 导航 130 + 2 = 132。
  // 2026-08-29:-1 仪式板页退役 = 133；custom 导航同步 -1 = 131。
  // 2026-08-29:-2 创作者申请与独立图像来源页退役；素材署名迁到设置页底部 = 131。
  // 2026-08-31:-1 停表模板管理页退役(玩一局保留,配置归创建节点) = 130；custom 导航 129-1 = 128。
  // 2026-09-03:+1 俱乐部结算分润页(club/settlement),与同批的 event-ops 同形态 ——
  //   custom 导航 + cy-nav-bar + cy-page-title 的普通二级页 = 135；custom 导航 132 + 1 = 133。
  // 2026-09-04:-1 pages/club/game-director 整页退役(十张卡收编进活动详情页)
  //   = 134;custom 导航同步 -1。
  // 2026-09-06:-5 孤儿页清理(play/stopwatch/play、merchant/decor/ai-npc、merchant/discover、
  //   club/dissolution-blockers、publish/biaoqian 全仓无人跳转,整页删除)= 129;custom 导航 132-5 = 127。
  /* 2026-09-08 +1:新增 pages/coop/invite-detail(Figma 02d-1~5 协作详情整页)。 */
  /* 2026-09-08 +1:新增 pages/club/checkin-detail(Figma K3 俱乐部端核销详情)。 */
  /* 2026-09-09 −3:会费两页(club/membership/setting、club/membership/status)与
     探店日质量证据(club/edition-report)按用户裁决整页删除;这三页原本也都是 custom。 */
  // 2026-09-05:+1 漫游·附近的局(subpackageRoam/nearby):全屏地图页,标题只在 cy-nav-bar 居中(overlay),
  //   不挂 cy-page-title = 130;custom 导航 127 + 1 = 128。
  // 2026-09-09:+1 投一张换一张(subpackageRoam/citystamp):三步一屏的全屏玩法页,
  //   顶部是它自己那条黑玻璃 .sg__nav(返回 + 标题 + 日期),不挂 cy-nav-bar 也不挂
  //   cy-page-title —— 与同形态的集邮相机(stamp-camera)一致,所以不进任何一份 inventory,
  //   只进总数 = 131;custom 导航 128 + 1 = 129。
  // 2026-09-11 并 github/master:本分支 +2 页、master +2 页 −3 页 ⇒ 129+2+2−3 = 130;
  //   custom 导航同步按实测重取。
  // 2026-09-16 −1:孤儿页 pages/coop/candidates 整页删除(候选池收编进协作列表「收到的」)
  //   ⇒ 130−1 = 129;它同为 custom 导航,129−1 = 128 按实测重取。
  // 2026-09-17 −1:B-06 孤儿页 pages/topic/pricing/partner 整页删除(全仓零入口:后端下发 path /
  //   分享 path / 订阅消息 page / scene 映射逐项核查过)⇒ 129−1 = 128;custom 导航同步按实测重取。
  /* 2026-09-19 +1:批复1-a=2 pages/topic/pricing/partner 按用户裁决复活 ⇒ 128+1 = 129;
     它同为 custom 导航,custom 计数同步 128+1 = 129(按实测重取)。 */
  /* 2026-09-20 +1:预制人生独立沉浸式游戏页,custom 导航但不挂通用标题组件。 */
  /* 2026-09-22 +1:Phase 0 物品卡实验室页(custom 导航 + cy-nav-bar + cy-page-title 普通二级页)
     ⇒ 130+1 = 131;它同为 custom 导航,custom 计数同步 131(按实测重取)。 */
  /* 2026-09-22 +1:Phase 3 藏品册页(object-cards/index),同为 custom 导航 + cy-nav-bar +
     cy-page-title 的普通玩家二级页 ⇒ 131+1 = 132;custom 计数同步 132(按实测重取)。 */
  /* 2026-09-24 −1:Phase 0 实验室页随正式页接进玩法删除 ⇒ 132−1 = 131;custom 同步 131(按实测重取)。 */
  assert.equal(rows.length, 131, '注册页面盘点数量发生漂移,需重新核对标题规范')
  assert.equal(rows.filter((row) => row.custom).length, 131)
  // 2026-09-02:+2 俱乐部客户列表与客户详情(club/customers、club/customer-detail),
  //   均为 custom 导航 + cy-nav-bar + cy-page-title 的普通二级页 = 133；custom 导航 129 + 2 = 131。
  const knownRoutes = new Set(routes)
  const assertKnown = (expected, label) => expected.forEach((route) => assert.ok(knownRoutes.has(route), `${label} 不在 app.json 注册路由中: ${route}`))
  assertKnown(EXPECTED_NAV_ROUTES, 'nav inventory')
  assertKnown(EXPECTED_PAGE_TITLE_ROUTES, 'page-title inventory')
  assertKnown(EXPECTED_CY_H1_ROUTES, 'cy-h1 inventory')
  assertKnown(EXPECTED_M_H1_ROUTES, 'm-h1 inventory')
  const actual = {
    nav: rows.filter((row) => row.nav).map((row) => row.route).sort(),
    pageTitle: rows.filter((row) => row.pageTitle).map((row) => row.route).sort(),
    h1: rows.filter((row) => row.h1).map((row) => row.route).sort(),
    cyH1: rows.filter((row) => row.cyH1).map((row) => row.route).sort(),
    mH1: rows.filter((row) => row.mH1).map((row) => row.route).sort(),
  }
  assert.deepEqual(actual.nav, EXPECTED_NAV_ROUTES.slice().sort(), 'nav inventory 路由映射发生漂移')
  assert.deepEqual(actual.pageTitle, EXPECTED_PAGE_TITLE_ROUTES.slice().sort(), 'page-title inventory 路由映射发生漂移')
  assert.deepEqual(actual.h1, EXPECTED_BARE_H1_ROUTES, '裸 h1 inventory 必须保持空')
  assert.deepEqual(actual.cyH1, EXPECTED_CY_H1_ROUTES.slice().sort(), 'cy-h1 inventory 路由映射发生漂移')
  assert.deepEqual(actual.mH1, EXPECTED_M_H1_ROUTES.slice().sort(), 'm-h1 inventory 路由映射发生漂移')
}

test('标题盘点:注册页面与当前规范基线可回读', () => {
  assertTitleInventory()
})

test('topicadd 重定向壳保留 app.json 注册，但不再拥有可见导航或页面标题', () => {
  const app = JSON.parse(read('app.json'))
  const routes = app.pages.concat(app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)))
  const source = routeSources(TOPICADD_REDIRECT_SHELL)
  assert.ok(routes.includes(TOPICADD_REDIRECT_SHELL), '兼容历史页面栈期间 topicadd 必须保留注册')
  assert.doesNotMatch(source.wxml, /<cy-nav-bar\b|<cy-page-title\b|class="(?:h1|cy-h1|m-h1)"/)
  assert.equal((source.json.usingComponents || {})['cy-nav-bar'], undefined)
  assert.equal((source.json.usingComponents || {})['cy-page-title'], undefined)
})

test('负控:myinvite 源码摘掉 page-title 时真实盘点必须判红', () => {
  const target = 'subpackageMember/myinvite/myinvite.wxml'
  const original = read(target)
  const mutated = original.replace('<cy-page-title title="邀请记录" />', '')
  assert.notEqual(mutated, original, '变异锚点失效')
  const readMutated = (relativePath) => relativePath === target ? mutated : read(relativePath)
  assert.throws(() => assertTitleInventory(readMutated), {
    name: 'AssertionError',
    message: /page-title inventory 路由映射发生漂移/,
  })
})

test('owner 普通二级页统一使用 cy-nav-bar + cy-page-title', () => {
  OWNER_NORMAL.forEach(assertOwnerNormal)
})

test('owner 特殊形态保留显式产品裁决:向导问句与 WebGL cover-view 不强塞 page-title', () => {
  const wizard = routeSources(WIZARD_EXCEPTION)
  assert.match(wizard.wxml, /<cy-nav-bar\b/)
  // 允许在后面叠类(进场动效),但 cc-q + cy-h1 这两个身份类必须都在
  assert.match(wizard.wxml, /class="cc-q cy-h1[^"]*"/)
  assert.doesNotMatch(wizard.wxml, /<cy-page-title\b/)

  const webgl = routeSources(WEBGL_EXCEPTION)
  assert.match(webgl.wxml, /<cover-view class="bw-cap"/)
  assert.match(webgl.wxml, /<cover-view class="bw-cap-t">勋章墙<\/cover-view>/)
  assert.doesNotMatch(webgl.wxml, /<cy-page-title\b/)
})

test('负控:owner 普通页回潮裸 .h1 时必须判红', () => {
  const route = 'subpackageMember/myinvite/myinvite'
  const source = routeSources(route)
  const mutated = source.wxml.replace('<cy-page-title title="邀请记录" />', '<view class="h1">邀请记录</view>\n<cy-page-title title="邀请记录" />')
  assert.notEqual(mutated, source.wxml, '变异锚点失效')
  const tokens = classTokens(mutated)
  assert.throws(() => assert.equal(tokens.includes('h1'), false), assert.AssertionError)
})

test('负控:owner 普通页摘掉 cy-page-title 时必须判红', () => {
  const route = 'subpackageMember/mytemplate/mytemplate'
  const source = routeSources(route)
  const mutated = source.wxml.replace('<cy-page-title title="我的节点玩法" />\n', '')
  assert.notEqual(mutated, source.wxml, '变异锚点失效')
  assert.throws(() => assert.match(mutated, /<cy-page-title\b/), assert.AssertionError)
})
