'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('漫游历史已接入真实 scene-full 内容，不是空壳跳转', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const componentWxml = read('components/cy/scene-roam-history/index.wxml')
  const componentJs = read('components/cy/scene-roam-history/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-roam-history'], '/components/cy/scene-roam-history/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'roam-history'/)
  assert.match(hostWxml, /<cy-scene-roam-history[^>]*bind:open="openChildScene"[^>]*bind:close="closeScene"/)
  assert.match(componentWxml, /wx:for="\{\{list\}\}"/)
  assert.match(componentWxml, /<cy-empty[^>]*title="还没有漫游记录"/)
  assert.match(componentWxml, /bindtap="openSession"/)
  // readSessionState 是 readSessions 的带 ok 位版本:本地读失败与「真的没有记录」
  // 必须分开,读失败走 error 可重试,不能显示成一段空历史。
  // (CU-M-55 起组件先取 memory 再读两份:会话列表 + 进行中的本机记录,判据不再绑一行写法。)
  assert.match(componentJs, /currentPlayerRoamMemory\(getApp\(\), wx\)/)
  assert.match(componentJs, /\.readSessionState\(\)/)
  assert.doesNotMatch(componentJs, /getStorageSync\(['"]roam_sessions/)
  assert.match(componentJs, /triggerEvent\('open'/)
  assert.doesNotMatch(componentJs, /wx\.navigateTo/)
})

test('漫游会话子层使用真实本地足迹数据，并保留返回/关闭出口', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const componentWxml = read('components/cy/scene-roam-session/index.wxml')
  const componentJs = read('components/cy/scene-roam-session/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-roam-session'], '/components/cy/scene-roam-session/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'roam-session'/)
  assert.match(hostWxml, /<cy-scene-roam-session[^>]*ts="\{\{sceneCurrent\.params\.ts\}\}"[^>]*bind:back="backScene"[^>]*bind:close="closeScene"/)
  assert.match(componentJs, /currentPlayerRoamMemory\(getApp\(\), wx\)\.readSessionState\(\)/)
  assert.doesNotMatch(componentJs, /getStorageSync\(['"]roam_sessions/)
  assert.match(componentJs, /state: 'loading'/)
  assert.match(componentWxml, /正在读取本次漫游/)
  assert.match(componentWxml, /这次漫游暂时打不开/)
  assert.match(componentWxml, /找不到这次漫游/)
  assert.match(componentWxml, /分享足迹卡/)
  assert.doesNotMatch(componentJs, /wx\.navigateTo/)
})

// 2026-08-08 用户裁决:「探索护照」场景整个下线 —— 它的四项读数与漫游护照 tab 顶部完全重复,
// 另外两块(探索进度/本月目标)是假指标:explorePct 取单次会话 max 当城市累计点亮度(口径错配),
// roam_goal 全仓无写入方(恒默认 30)。契约反过来锁「不许复活」。
test('探索护照场景已下线,不许再复活成第二份漫游档案', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..', '..')
  assert.ok(!fs.existsSync(path.join(root, 'components/cy/scene-roam-passport')), 'scene-roam-passport 组件不该回来')
  assert.doesNotMatch(read('utils/scene-registry.js'), /'roam-passport'/, '注册表不该再登记 roam-passport')
  for (const host of ['pages/roam/index.wxml', 'pages/play/index.wxml', 'components/cy/scene-deep-link/index.wxml']) {
    assert.doesNotMatch(read(host), /cy-scene-roam-passport/, host + ' 不该还挂着已删场景')
  }
  // 读数的唯一去处:护照 tab 顶部
  assert.match(read('pages/roam/index.wxml'), /class="pp-stats"/, '四项读数改由护照 tab 顶部承载')
})

test('集邮册场景复用真实分页接口与失败/空态互斥，不用静态占位图冒充邮票', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const componentWxml = read('components/cy/scene-roam-stamp-album/index.wxml')
  const componentJs = read('components/cy/scene-roam-stamp-album/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-roam-stamp-album'], '/components/cy/scene-roam-stamp-album/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'roam-stamp-album'/)
  assert.match(hostWxml, /<cy-scene-roam-stamp-album[^>]*bind:camera="openStampCamera"[^>]*bind:close="closeScene"/)
  assert.match(componentJs, /url: '\/api\/roam\/stamp\/list'/)
  assert.match(componentJs, /pageSize: 50/)
  // 2026-09-10 漫游四模式脱离小程序 DS:集邮册整屏照原型 f-sticker 重做成三列方格,
  //   「收藏夹合上/展开 + 散落票面」(Figma 220:1388)整套退场。
  //   断言跟着改成原型那套 —— 断的仍是「票面来自真接口、不是静态占位」,不是某个皮肤。
  assert.match(componentWxml, /class="stkgrid"/, '票面按原型排成三列方格')
  assert.match(componentWxml, /class="stkcell stkcell--lock"/, '末尾那格虚线「还没收到」是原型自带的')
  assert.doesNotMatch(componentWxml, /album-folder/, '旧收藏夹皮肤不许回来')
  assert.match(componentWxml, /bindtap="loadMore"/)
  assert.match(componentWxml, /集邮册没打开/)
  assert.match(componentWxml, /还没有邮票/)
  assert.match(componentWxml, /wx:elif="\{\{loading && !items\.length\}\}"/)
  assert.match(componentWxml, /wx:elif="\{\{loaded && total === 0\}\}"/)
  assert.doesNotMatch(componentWxml, /d_qrcode|d_subtrac|d_subtraction/)
})

test('发现商家场景使用真实商家列表接口，并把卡片点击推入点位详情子场景', () => {
  /* 2026-09-11:漫游页的「查找附近好玩的」换成了原型 f-fun 的横滑白卡,不再挂这件半屏
     (原型那一屏就是横滑条,不是列表)。组件本身还活着 —— 游玩页与深链仍在用,
     所以宿主断言从漫游改成游玩页;组件自身的接口与事件契约一字未改。 */
  const hostJson = JSON.parse(read('pages/play/index.json'))
  const hostWxml = read('pages/play/index.wxml')
  const componentWxml = read('components/cy/scene-roam-discover/index.wxml')
  const componentJs = read('components/cy/scene-roam-discover/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-roam-discover'], '/components/cy/scene-roam-discover/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'roam-discover'/)
  assert.match(hostWxml, /<cy-scene-roam-discover[^>]*bind:open="openChildScene"[^>]*bind:close="closeScene"/)
  // 漫游那边确实换成了横滑白卡,钉死不许悄悄退回半屏
  assert.doesNotMatch(read('pages/roam/index.wxml'), /<cy-scene-roam-discover/)
  assert.match(read('pages/roam/index.js'), /openRoamDiscover\(\) \{ this\.openShopStrip\(\); \}/)
  assert.match(componentJs, /url: '\/api\/merchant\/list'/)
  assert.match(componentJs, /triggerEvent\('open', \{ id: 'roam-poi-detail'/)
  assert.match(componentWxml, /附近商家暂时没打开/)
  assert.match(componentWxml, /没有找到匹配的商家/)
  assert.match(componentWxml, /cy-merchant-card/)
  assert.doesNotMatch(componentJs, /wx\.navigateTo/)
})

test('任务场景复用官方活动与我的活动接口，详情打开官方活动详情页', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const componentWxml = read('components/cy/scene-roam-task-list/index.wxml')
  const componentJs = read('components/cy/scene-roam-task-list/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-roam-task-list'], '/components/cy/scene-roam-task-list/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'roam-task-list'/)
  assert.match(hostWxml, /<cy-scene-roam-task-list[^>]*bind:open="openChildScene"[^>]*bind:close="closeScene"/)
  assert.match(componentJs, /url: '\/api\/official\/events'/)
  assert.match(componentJs, /url: '\/api\/official\/my-events'/)
  // 3-18:行是 official_event,不能进查 cms_activity 的 play-activity-detail
  assert.match(componentJs, /triggerEvent\('official'/)
  assert.match(hostWxml, /<cy-scene-roam-task-list[^>]*bind:official="openOfficialEvent"/)
  assert.match(read('pages/roam/index.js'), /openOfficialEvent\(e\) \{ wx\.navigateTo\(\{ url: '\/pages\/activity\/official-detail\/index\?id=' \+ e\.detail\.id/)
  assert.doesNotMatch(componentJs, /id: 'play-activity-detail'/)
  assert.match(componentWxml, /state === 'loading'/)
  assert.match(componentWxml, /活动列表没能打开/)
  assert.match(componentJs, /没有找到相关活动/)
  assert.match(componentWxml, /wx:for="\{\{events\}\}"/)
  assert.doesNotMatch(componentJs, /wx\.navigateTo/)
})

test('点位详情场景保留节点/商家真实接口，并将核销码推入子场景而非新页面', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const componentWxml = read('components/cy/scene-roam-poi-detail/index.wxml')
  const componentJs = read('components/cy/scene-roam-poi-detail/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-roam-poi-detail'], '/components/cy/scene-roam-poi-detail/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'roam-poi-detail'/)
  assert.match(hostWxml, /<cy-scene-roam-poi-detail[^>]*poi-id="\{\{sceneCurrent\.params\.poiId\}\}"[^>]*bind:open="openChildScene"[^>]*bind:close="closeScene"/)
  assert.match(componentJs, /url: '\/api\/city\/nodes\/'/)
  assert.match(componentJs, /url: '\/api\/merchant\/public-detail'/)
  assert.match(componentJs, /id: 'qr-citynode'/)
  assert.match(componentWxml, /据点暂时打不开/)
  assert.match(componentWxml, /开始互动/)
  assert.match(componentWxml, /店铺相册/)
  assert.doesNotMatch(componentJs, /wx\.navigateTo/)
})

// 据点内容有三个入口(地图 marker / 站外深链 / 漫游页内弹层),但只能有一份实现。
// 深链宿主是薄壳:它只挂 cy-scene-deep-link 并透传 poiId,自己不取数、不画正文、
// 更不复制到店验证逻辑 —— 复制了就会重演「商家选了拍照、实际生效 GPS」那类静默分叉。
test('据点深链宿主是薄壳：挂已有组件、透传 poiId、输出稳定深链', () => {
  const HOST = 'subpackageRoam/poi-detail/index'
  const hostJson = JSON.parse(read(`${HOST}.json`))
  const hostWxml = read(`${HOST}.wxml`)
  const hostJs = read(`${HOST}.js`)
  const registry = read('utils/scene-registry.js')
  const deepLinkWxml = read('components/cy/scene-deep-link/index.wxml')

  // 注册表的 route 必须落在本宿主上,否则 openScene 会原地绕回旧页
  assert.match(
    registry,
    /'roam-poi-detail':\s*\{[^}]*route:\s*'\/subpackageRoam\/poi-detail\/index'/,
    'roam-poi-detail 的 route 必须指向据点深链宿主',
  )
  assert.ok(
    JSON.parse(read('app.json')).subPackages.find((pkg) => pkg.root === 'subpackageRoam').pages.includes('poi-detail/index'),
    '宿主必须注册在 subpackageRoam,否则深链打不开',
  )

  // 薄壳:只挂组件 + 透传 poiId
  assert.equal(hostJson.usingComponents['cy-scene-deep-link'], '/components/cy/scene-deep-link/index')
  assert.match(hostWxml, /<cy-scene-deep-link[^>]*scene-id="roam-poi-detail"[^>]*params="\{\{sceneParams\}\}"/)
  assert.match(hostJs, /sceneParams:\s*\{\s*poiId\s*\}/, 'onLoad 拿到的 poiId 必须透传给场景')
  assert.match(deepLinkWxml, /<cy-scene-roam-poi-detail[^>]*poi-id="\{\{sceneCurrent\.params\.poiId\}\}"/)

  // 不复制正文与到店验证逻辑
  assert.doesNotMatch(hostJs, /url:\s*'\/api\//, '宿主不得自己取数')
  assert.doesNotMatch(hostJs, /validationMethod|scanCode|chooseImage|showActionSheet|getLocation/, '到店验证逻辑只能有 scene 组件那一份')
  assert.doesNotMatch(hostWxml, /wx:for=/, '宿主不得自绘正文')

  // 分享/收藏输出稳定深链;onShareTimeline 只能给 query(平台不支持自定义 path)
  assert.match(hostJs, /path:\s*SHARE_PATH \+ '\?' \+ shareQuery\(this\.data\.poiId\)/)
  assert.match(hostJs, /const SHARE_PATH = '\/subpackageRoam\/poi-detail\/index'/)
  assert.match(hostJs, /onShareTimeline\(\)\s*\{[\s\S]*?query:\s*shareQuery\(this\.data\.poiId\)/)
  assert.match(hostJs, /onAddToFavorites\(\)\s*\{/)
})

test('活动详情场景读取真实活动接口，票种选择后只进入既有报名流程', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const componentWxml = read('components/cy/scene-play-activity-detail/index.wxml')
  const componentJs = read('components/cy/scene-play-activity-detail/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-play-activity-detail'], '/components/cy/scene-play-activity-detail/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'play-activity-detail'/)
  assert.match(componentJs, /url: '\/api\/activity\/info'/)
  assert.match(componentJs, /activity\/baoming\/baoming\?activityId=/)
  assert.match(componentWxml, /state === 'loading'/)
  assert.match(componentWxml, /活动详情暂时打不开/)
  assert.match(componentWxml, /暂无可选票种/)
  assert.match(componentWxml, /票种/)
})

test('游戏券夹读取真实领取记录，并把未使用券推入动态核销码场景', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const componentWxml = read('components/cy/scene-game-coupon-wallet/index.wxml')
  const componentJs = read('components/cy/scene-game-coupon-wallet/index.js')

  assert.equal(hostJson.usingComponents['cy-scene-game-coupon-wallet'], '/components/cy/scene-game-coupon-wallet/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'game-coupon-wallet'/)
  assert.match(componentJs, /url: '\/api\/coupon\/myrecvlist'/)
  assert.match(componentJs, /id: 'qr-coupon'/)
  assert.match(componentWxml, /优惠券暂时没能打开/)
  assert.match(componentWxml, /这里还没有优惠券/)
  assert.match(componentWxml, /出示核销码/)
  assert.doesNotMatch(componentWxml, /d_qrcode|d_yhqbg/)
  assert.doesNotMatch(componentJs, /wx\.navigateTo/)
})

test('三个核销码场景都复用嵌入式白码卡，保留真实出码接口与失败/刷新状态', () => {
  const hostJson = JSON.parse(read('pages/roam/index.json'))
  const hostWxml = read('pages/roam/index.wxml')
  const couponJs = read('components/cy/scene-qr-coupon/index.js')
  const couponWxml = read('components/cy/scene-qr-coupon/index.wxml')
  const groupJs = read('components/cy/scene-qr-group-code/index.js')
  const groupWxml = read('components/cy/scene-qr-group-code/index.wxml')
  const cityJs = read('components/cy/scene-qr-citynode/index.js')
  const cityWxml = read('components/cy/scene-qr-citynode/index.wxml')
  const qrVoucherJs = read('components/cy/qr-voucher/index.js')

  for (const id of ['qr-coupon', 'qr-group-code', 'qr-citynode']) assert.match(hostWxml, new RegExp(`sceneCurrent && sceneCurrent\\.id === '${id}'`))
  assert.equal(hostJson.usingComponents['cy-scene-qr-coupon'], '/components/cy/scene-qr-coupon/index')
  assert.equal(hostJson.usingComponents['cy-scene-qr-group-code'], '/components/cy/scene-qr-group-code/index')
  assert.equal(hostJson.usingComponents['cy-scene-qr-citynode'], '/components/cy/scene-qr-citynode/index')
  assert.match(couponJs, /url: '\/api\/coupon\/qr-token'/)
  assert.match(couponJs, /url: '\/api\/coupon\/status'/)
  assert.match(couponWxml, /embedded="\{\{true\}\}"/)
  assert.match(groupJs, /url: '\/api\/verify\/groupcode\/issue'/)
  assert.match(groupJs, /url: '\/api\/topic\/info-to-user'/)
  assert.match(groupWxml, /state === 'selecting'/)
  assert.match(cityJs, /url: '\/api\/verify\/citynode\/issue'/)
  assert.match(cityWxml, /这个核销码打不开/)
  assert.match(qrVoucherJs, /embedded:.*只渲染码卡正文/)
  assert.doesNotMatch(couponJs + groupJs + cityJs, /wx\.navigateTo/)
})

test('入场码是场景栈内的真实动态码，不再保留旧 ticket 页面块', () => {
  const registry = read('utils/scene-registry.js')
  const hostJson = JSON.parse(read('pages/play/index.json'))
  const hostWxml = read('pages/play/index.wxml')
  const hostJs = read('pages/play/index.js')
  const ticketJs = read('components/cy/scene-qr-ticket/index.js')
  const ticketWxml = read('components/cy/scene-qr-ticket/index.wxml')

  assert.match(registry, /'qr-ticket': \{[\s\S]*canBack: true/)
  assert.equal(hostJson.usingComponents['cy-scene-qr-ticket'], '/components/cy/scene-qr-ticket/index')
  assert.match(hostWxml, /sceneCurrent && sceneCurrent\.id === 'qr-ticket'/)
  assert.match(hostWxml, /<cy-scene-qr-ticket[^>]*registration-id=/)
  assert.match(hostJs, /openScene\('qr-ticket'/)
  assert.doesNotMatch(hostJs, /closeTicket\(/)
  assert.match(ticketJs, /url: '\/api\/verify\/dyncode\/issue'/)
  assert.match(ticketJs, /registrationId\(value\)\s*\{[\s\S]*?if \(!this\._attached\) return[\s\S]*?value !== this\._loadedRegistrationId/, '初始化 observer 不得与 attached 重复签发动态码')
  assert.match(ticketJs, /const token = \(this\._loadToken \|\| 0\) \+ 1[\s\S]*?if \(token !== this\._loadToken\) return/, '过期响应不得覆盖新码或创建遗留 interval')
  assert.match(ticketWxml, /class="voucher__card"/, '主线票券终态应收敛到 qr-ticket 场景组件')
  assert.match(ticketWxml, /class="bigqr" wx:if="\{\{bigQr\}\}"/, '放大核销码也应留在同一场景组件')
  assert.doesNotMatch(hostWxml, /ticket\.show/, 'play 页面不得保留第二套票券视图')
})

test('表单主 CTA 位于 scene-sheet footer 槽，不再粘在可滚动正文底部', () => {
  for (const page of ['components/cy/profile/index', 'pages/shezhi/shezhi', 'pages/merchant/index/index']) {
    const wxml = read(`${page}.wxml`)
    assert.match(wxml, /<cy-scene-route-content[^>]*id="sceneRouteContent"/)
    assert.match(wxml, /<view wx:if="\{\{sceneCurrent\.footer\}\}" slot="footer"[\s\S]*<cy-btn/)
  }
  const contentWxml = read('components/cy/scene-route-content/index.wxml')
  assert.doesNotMatch(contentWxml, /src-form__footer/)
})

test('统一场景内容的关键表单字段可见且提现请求使用真实字段契约', () => {
  const wxml = read('components/cy/scene-route-content/index.wxml')
  const js = read('components/cy/scene-route-content/index.js')
  const wxss = read('components/cy/scene-route-content/index.wxss')
  assert.match(wxml, /提现金额/)
  assert.match(wxml, /银行卡号/)
  assert.match(wxml, /aria-label="银行卡号"/)
  // 2026-09-15 收款模型定稿 §3:平台不打款,member-withdraw 场景不再建提现单。
  // 原来这里钉的是「请求体用真实字段名」——那条链路已退役,改成反向断言,
  // 防止哪天有人把 /api/withdrawal/create 的请求体搬回这个组件。
  // (「不得再出现建单调用」由 funds-entry-retirement-contract 去注释后逐处理器断言;
  //  这里只钉本组件的请求体不再拼提现字段 —— 注释里提到接口名不算违规。)
  assert.doesNotMatch(js, /withdrawalAmount: Number\(form\.withdrawalAmount\)/)
  assert.match(js, /sceneId === 'member-withdraw'\)\s*\{[\s\S]{0,400}?withdrawCs\.showWithdrawCsPopup\(\)/)
  assert.match(js, /Content-Type': 'application\/json'/)
  assert.doesNotMatch(wxss, /#b2b4bc|var\(--cy-text-secondary,/)
})

test('Figma 三个弹窗接入真实入口，并锁定玩家深色/商户浅色主题', () => {
  const registry = read('utils/scene-registry.js')
  const settingsJson = JSON.parse(read('pages/shezhi/shezhi.json'))
  const settingsJs = read('pages/shezhi/shezhi.js')
  const settingsWxml = read('pages/shezhi/shezhi.wxml')
  const profileJson = JSON.parse(read('components/cy/profile/index.json'))
  const profileJs = read('components/cy/profile/index.js')
  const profileWxml = read('components/cy/profile/index.wxml')
  const deepLinkWxml = read('components/cy/scene-deep-link/index.wxml')
  const sheetWxss = read('components/cy/scene-sheet/index.wxss')
  const shareJs = read('components/cy/scene-share-invite/index.js')
  const shareWxml = read('components/cy/scene-share-invite/index.wxml')
  const historyWxml = read('components/cy/scene-roam-history/index.wxml')
  const historyJs = read('components/cy/scene-roam-history/index.js')

  assert.match(registry, /'roam-history':/)
  assert.doesNotMatch(registry, /'settings-sound':/)
  assert.match(registry, /'share-invite':/)
  assert.ok(!settingsJson.usingComponents['cy-scene-sound-haptics'], '声音与触感组件必须从设置页卸掉')
  assert.doesNotMatch(settingsJs, /openScene\('settings-sound'\)/)
  assert.doesNotMatch(settingsWxml, /声音与触感/)
  assert.doesNotMatch(settingsWxml, /cy-scene-sound-haptics/)
  assert.equal(profileJson.usingComponents['cy-scene-share-invite'], '/components/cy/scene-share-invite/index')
  assert.match(profileJs, /goInvite: function \(\) \{ this\.openScene\('share-invite'\); \}/)
  assert.match(profileJs, /shareKind === 'invite'/)
  assert.match(profileWxml, /<cy-scene-share-invite[^>]*theme="\{\{sceneCurrent\.theme\}\}"/)
  assert.doesNotMatch(deepLinkWxml, /sceneCurrent\.id === 'settings-sound'/)
  assert.match(deepLinkWxml, /sceneCurrent\.id === 'share-invite'/)
  assert.match(sheetWxss, /\.ss--player\s*\{[\s\S]*--cy-sheet-bg: var\(--cy-comp-sheet-player-glass\)/)
  assert.match(sheetWxss, /\.ss--merchant\s*\{[\s\S]*--cy-sheet-bg: var\(--cy-comp-sheet-merchant-bg\)/)
  assert.doesNotMatch(sheetWxss, /ss__grabber/)
  assert.match(shareWxml, /open-type="share" data-share-kind="invite"/)
  assert.match(shareJs, /isDevEnv\(\)/)
  assert.match(shareJs, /figma-invite-qr\.png/)
  assert.match(historyWxml, /class="hs-sum"/)
  assert.match(historyWxml, /class="rc__stats"/)
  assert.match(historyWxml, /class="rc__badges"/)
  assert.match(historyJs, /const WEEK = \['日'/)
  assert.match(historyJs, /'日期不可用'/)
  assert.doesNotMatch(historyJs, /Date unavailable|AM|PM/)
})

function assertProfileUserAssetEntries(profileJs, registry, hostWxml, hostJson, appJson) {
  assert.match(
    profileJs,
    /goCoupon: function \(\) \{ wx\.navigateTo\(\{ url: '\/subpackageMember\/coupon-wallet\/index' \}\); \}/,
    '个人页优惠券入口必须打开玩家券夹，不能进入商家发券管理页',
  )
  assert.match(
    registry,
    /'game-coupon-wallet':\s*\{[^}]*route:\s*'\/subpackageMember\/coupon-wallet\/index'/,
    '玩家券夹注册表必须指向自己的页面宿主',
  )
  assert.equal(hostJson.usingComponents['cy-scene-deep-link'], '/components/cy/scene-deep-link/index')
  assert.match(hostWxml, /<cy-scene-deep-link[^>]*scene-id="game-coupon-wallet"/)
  assert.ok(
    appJson.subPackages.find((pkg) => pkg.root === 'subpackageMember').pages.includes('coupon-wallet/index'),
    '玩家券夹宿主必须注册到 app.json',
  )
  assert.match(
    profileJs,
    /goComplaint: function \(\) \{ wx\.navigateTo\(\{ url: '\/subpackageMember\/complaint\/index' \}\); \}/,
    '投诉建议必须进入完整投诉页',
  )
}

function assertCouponWalletFallback(deepLinkJs) {
  const couponFallback = "if (id === 'game-coupon-wallet') return '/pages/member/index/index'"
  const playerFallback = "if (PLAYER_PLAY_SCENES.has(id)) return '/pages/play/index'"
  assert.match(
    deepLinkJs,
    /if \(id === 'game-coupon-wallet'\) return '\/pages\/member\/index\/index'/,
    '玩家券夹在栈底关闭时必须回到“我的”，不能误落游玩页',
  )
  assert.ok(
    deepLinkJs.indexOf(couponFallback) < deepLinkJs.indexOf(playerFallback),
    '玩家券夹特例必须先于通用玩家玩法回退，否则会被提前吞掉',
  )
}

test('个人页优惠券与投诉建议进入完整的玩家业务链路', () => {
  assertProfileUserAssetEntries(
    read('components/cy/profile/index.js'),
    read('utils/scene-registry.js'),
    read('subpackageMember/coupon-wallet/index.wxml'),
    JSON.parse(read('subpackageMember/coupon-wallet/index.json')),
    JSON.parse(read('app.json')),
  )
  assertCouponWalletFallback(read('components/cy/scene-deep-link/index.js'))
})

test('负控：个人页入口接回商家券管理或缩水反馈时必须判红', () => {
  const profileJs = read('components/cy/profile/index.js')
  const registry = read('utils/scene-registry.js')
  const hostWxml = read('subpackageMember/coupon-wallet/index.wxml')
  const hostJson = JSON.parse(read('subpackageMember/coupon-wallet/index.json'))
  const appJson = JSON.parse(read('app.json'))
  const wrongCoupon = profileJs.replace(
    "'/subpackageMember/coupon-wallet/index'",
    "'/subpackageMember/coupon/coupon'",
  )
  const wrongComplaint = profileJs.replace(
    "'/subpackageMember/complaint/index'",
    "'/pages/shezhi/shezhi?scene=settings-feedback'",
  )
  assert.throws(() => assertProfileUserAssetEntries(wrongCoupon, registry, hostWxml, hostJson, appJson), assert.AssertionError)
  assert.throws(() => assertProfileUserAssetEntries(wrongComplaint, registry, hostWxml, hostJson, appJson), assert.AssertionError)

  const wrongFallback = read('components/cy/scene-deep-link/index.js')
    .replace("if (id === 'game-coupon-wallet') return '/pages/member/index/index'", '')
  assert.throws(() => assertCouponWalletFallback(wrongFallback), assert.AssertionError)

  const wrongOrder = read('components/cy/scene-deep-link/index.js')
    .replace(
      "  if (id === 'game-coupon-wallet') return '/pages/member/index/index'\n  if (PLAYER_PLAY_SCENES.has(id)) return '/pages/play/index'",
      "  if (PLAYER_PLAY_SCENES.has(id)) return '/pages/play/index'\n  if (id === 'game-coupon-wallet') return '/pages/member/index/index'",
    )
  assert.throws(() => assertCouponWalletFallback(wrongOrder), assert.AssertionError)
})
