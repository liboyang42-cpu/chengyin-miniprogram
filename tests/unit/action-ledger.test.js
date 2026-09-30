const test = require('node:test')
const assert = require('node:assert/strict')

/** 认可的确认闸实现:wx.showModal 是旧写法,cy-danger-confirm 是三段式确认组件。
 *  ⚠️ 往这里加值前先问:新机制真的覆盖「用户点取消」这条分支吗?没覆盖就不是同一道闸。 */
const CONFIRM_MODES = ['wx.showModal', 'cy-danger-confirm']
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

// 证据 freshness 窗口默认 72h（evidenceMaxAgeMs），写死日期的 fixture 会在跑到窗外那天
// 突然变红——2026-08-24 就这么炸过一次。这里改成相对当下取值，只保留「新鲜」这个语义。
// 过期路径的负控另有 assertDeviceCaptureWindow 那组用例，传显式 now，不受影响。
const freshAt = (offsetMs = 0) => new Date(Date.now() - 60 * 60 * 1000 + offsetMs).toISOString()

const ledger = require('../../scripts/uiaudit/action-ledger.json')
const overlay = require('../../scripts/uiaudit/action-evidence.json')
const {
  inferActionClass,
  inferEffectClasses,
  buildExpectedReadback,
  requiredBranchesFor,
  requiredPlatformsFor,
  interactionModeFor,
  modalContractFor,
  modalContractForHandler,
  expandHandlerBody,
  discoverExternalHelperNames,
  serverApiContracts,
  buildLedger,
  sourceDigestFor,
  sourceDigestAtCommit,
  sourceFilesFor,
  validateEvidenceOverlay,
  evidenceReadiness,
  inventoryMatchesCurrent,
  isRecognizedMedia,
  assertSignedAuthorityFacts,
  assertSignedDeviceBranchFacts,
  assertDeviceCaptureWindow,
  evidenceMaxAgeMs,
  deviceBranchReadbackDigests,
} = require('../../scripts/uiaudit/build-action-ledger.js')

test('分类只看代码:注释与字符串里的 wx.* 不算能力(A)', () => {
  // 2026-09-22 实证:两行中文注释(里面并无 wx.*)把 play 页 4 个控件从 read 翻成 external。
  // 反向同样危险 —— 注释里写一句 wx.scanCode( 就能给控件挂上它并不具备的能力。
  assert.equal(inferActionClass('loadList',
    "// wx.scanCode( 只是注释\napp.sendRequest({url:'/api/topic/list',method:'POST'})"), 'read')
  assert.equal(inferActionClass('loadList',
    "/* wx.chooseLocation( */ app.sendRequest({url:'/api/topic/list',method:'POST'})"), 'read')
  assert.equal(inferActionClass('quoted',
    "app.sendRequest({url:'/api/x/list',method:'POST'}); var s = 'wx.scanCode('"), 'read')
  // 真调用仍必须判出来,否则上面三条可以靠「一律不判 external」作弊通过。
  assert.equal(inferActionClass('scan', 'wx.scanCode({})'), 'external')
  // C:wx 的可注入别名(全仓仅 utils/location/location-manager.js 这么写)。
  assert.equal(inferActionClass('pick', '_wx.chooseLocation({})'), 'external')
})

test('分类跟得进 require 来的模块级 helper(B)', () => {
  const rebuilt = buildLedger()
  // publish/fabu 的 choosePoiForNode 调的是 pickLocation(...),内部才是 wx.chooseLocation;
  // 页面代码里根本没有 wx.chooseLocation —— 跟不进 helper 就会漏判成 state,
  // 等于把一个真需要真机验证的控件挪出证据要求。
  const pick = rebuilt.controls.find((item) => item.entry.js === 'pages/publish/fabu/index.js'
    && item.control.handler === 'choosePoiForNode')
  assert.ok(pick, '找不到 choosePoiForNode 控件')
  assert.equal(pick.actionClass, 'external')
  assert.ok((pick.externalCapabilities || []).includes('chooseLocation'),
    'chooseLocation 必须由代码推出,而不是靠注释里提了一句')
  // ⚠️ 能力探测才跟 helper;API/效果提取不跟 —— utils/ui-state-request.js 是个 switch 分发器,
  //   跟进去会把它列举的 14 个 API 全算到调用方头上。这条盯住那个边界。
  const follow = rebuilt.controls.find((item) => item.entry.js === 'pages/square/detail/index.js'
    && item.control.handler === 'commentFollowClick')
  assert.ok(follow, '找不到 commentFollowClick 控件')
  assert.ok(!(follow.targets.writeApis || []).includes('/api/topic/create'),
    '评论区关注按钮不得因为分发器被算上 /api/topic/create')
})

test('action ledger 区分导航、写操作、读操作、页内状态与外部能力', () => {
  assert.equal(inferActionClass('goDetail', "wx.navigateTo({url:'/pages/x/index'})"), 'navigation')
  assert.equal(inferActionClass('saveAddress', "app.sendRequest({url:'/api/user/address/add',method:'POST'})"), 'write')
  assert.equal(inferActionClass('loadList', "app.sendRequest({url:'/api/topic/list',method:'POST'})"), 'read')
  assert.equal(inferActionClass('openSheet', 'this.setData({show:true})'), 'state')
  assert.equal(inferActionClass('cancelSceneDiscard', 'this.setData({showSceneDiscard:false})'), 'state')
  assert.equal(inferActionClass('scanCode', 'wx.scanCode({})'), 'external')
})

test('同页 scene 或 sheet 入口不得因 go/open 命名误判为页面跳转', () => {
  assert.deepEqual(inferEffectClasses('goPrivacy', 'this.setData({showPrivacySheet:true})'), ['state'])
  assert.deepEqual(inferEffectClasses('openScene', 'this.setData({sceneCurrent:next})'), ['state'])
  assert.deepEqual(inferEffectClasses('goActivity', "openScene('play-activity-detail',{id})"), ['navigation'])
  assert.deepEqual(inferEffectClasses('goDetail', "wx.navigateTo({url:'/pages/x/index'});this.setData({busy:true})"), [
    'navigation', 'state',
  ])
  const rebuilt = buildLedger()
  const privacy = rebuilt.controls.find((item) => item.entry.wxml === 'pages/shezhi/shezhi.wxml'
    && item.control.handler === 'goPrivacy')
  assert.ok(privacy, '设置页隐私入口必须进入动作台账')
  assert.deepEqual(privacy.effectClasses, ['state'])
  const homeActivity = rebuilt.controls.find((item) => item.entry.wxml === 'pages/index/index.wxml'
    && item.control.handler === 'goActivity')
  assert.ok(homeActivity, '首页活动入口必须进入动作台账')
  assert.deepEqual(homeActivity.effectClasses, ['navigation'])
})

test('导航失败回调的 toast 不得污染 success 为 state 复合效果', () => {
  const actions = ledger.controls.filter((item) => item.entry.wxml
    === 'pages/publish/template-intro/index.wxml' && item.control.handler === 'goCreate')
  assert.equal(actions.length, 2, '开始创建与页内错误重试必须都进入台账')
  actions.forEach((action) => {
    // navigating/navigationError 是真实持久状态，不是 toast 污染；导航仍必须保留失败分支。
    assert.deepEqual(action.effectClasses, ['navigation', 'state'])
    assert.deepEqual(action.requiredBranches, ['success', 'error'])
  })
})

test('每类动作都有对端回读，不把 success/toast 当作完成', () => {
  assert.match(buildExpectedReadback('navigation'), /getCurrentPages/)
  assert.match(buildExpectedReadback('write'), /服务端/)
  assert.match(buildExpectedReadback('read'), /URL \+ method \+ auth/)
  assert.match(buildExpectedReadback('state'), /page\.data/)
  assert.match(buildExpectedReadback('external'), /真机/)
})

test('必跑分支按动作副作用生成，不强迫纯页内状态伪造 timeout', () => {
  assert.deepEqual(requiredBranchesFor('state'), ['success'])
  assert.deepEqual(requiredBranchesFor('navigation'), ['success', 'error'])
  assert.deepEqual(requiredBranchesFor('write'), [
    'success', 'error', 'timeout', 'duplicate-trigger', 'forbidden-owner',
  ])
  assert.deepEqual(requiredBranchesFor('external'), [
    'success', 'error', 'timeout', 'duplicate-trigger',
  ])
})

test('只有当前 tap handler 直接出现可取消确认框才生成 modal 分支', () => {
  assert.equal(modalContractFor(`wx.showModal({
    title: '确认删除？', success(result) { if (result.confirm) that.remove() }
  })`, 'tap'), 'wx.showModal')
  assert.equal(modalContractFor("wx.showModal({title:'提示',showCancel:false})", 'tap'), null)
  assert.equal(modalContractFor('if (step < 4) next(); else submit()', 'tap'), null)
  assert.equal(modalContractFor(`wx.showModal({
    title: '确认删除？', success(result) { if (result.confirm) that.remove() }
  })`, 'event-contract'), null)
})

test('确认框合同沿同步 helper 展开，但截断异步回调与互斥 variant', () => {
  const syncHelper = new Map([
    ['approve', 'approve(e) { this.confirmReview(e.currentTarget.dataset.id) }'],
    ['confirmReview', `confirmReview(id) { wx.showModal({
      title: '确认', success(result) { if (result.confirm) that.review(id) }
    }) }`],
  ])
  assert.equal(modalContractForHandler('approve', syncHelper, 'tap'), 'wx.showModal')

  const asyncFailure = new Map([
    ['repick', `repick() { wx.chooseLocation({ fail(error) {
      wx.showModal({ title: '定位失败', showCancel: denied, success(result) { if (result.confirm) wx.openSetting() } })
    } }) }`],
  ])
  assert.equal(modalContractForHandler('repick', asyncFailure, 'tap'), null)
  const legacyProperty = new Map([[
    'deleteAddress', `deleteAddress: function (e) { wx.showModal({
      title: '确认删除', success(res) { if (res.confirm) that.remove(e) }
    }) }`,
  ]])
  assert.equal(modalContractForHandler('deleteAddress', legacyProperty, 'tap'), 'wx.showModal')

  const rebuilt = buildLedger()
  const assertConfirmGate = (action, label) => {
    // 契约钉的是「这个危险动作有确认闸」,不是「必须用 wx.showModal」。
    // 2026-08-30:三段式确认组件 cy-danger-confirm 是同一道闸的新实现 ——
    // 钉死机制名会让「把 showModal 升级成标准确认组件」这件对的事变红。
    assert.ok(action, `${label} 没进台账`)
    assert.ok(CONFIRM_MODES.includes(action.confirmationMode),
      `${label} 确认框漏判,实际 confirmationMode=${action.confirmationMode}`)
    assert.ok(action.requiredBranches.includes('modal-cancelled'),
      `${label} 少了「用户点取消」这条分支 —— 没有它,确认闸只是装饰`)
  }
  ;[
    ['pages/address/address.js', 'deleteAddress', null],
    ['pages/mylike/mylike.js', 'topicUnlike', null],
    // 2026-09-16 H050/H051:广场举报行从页面自绘弹层搬进 cy-post-actions,页面只剩一个
    // bind:select 分发器 —— 按 variant.id='report' 定位这条分支(handler 名是绑定名)。
    ['pages/square/list/index.js', 'onPostAction', 'report'],
  ].forEach(([entryJs, handler, variantId]) => {
    const action = rebuilt.controls.find((item) => item.entry.js === entryJs && item.control.handler === handler
      && (variantId ? item.variant && item.variant.id === variantId : !item.variant))
    assertConfirmGate(action, `${entryJs}:${handler}${variantId ? ':' + variantId : ''}`)
  })
  // 帖子删除的三段式闸长在组件里(cy-post-actions → cy-danger-confirm),也要有可取消分支
  assertConfirmGate(
    rebuilt.controls.find((item) => item.entry.js === 'pages/square/components/cy/post-actions/index.js'
      && item.control.handler === 'onDelete'),
    'pages/square/components/cy/post-actions/index.js:onDelete')
  ;['approve', 'reject'].forEach((handler) => {
    const action = rebuilt.controls.find((item) => item.entry.js === 'pages/club/join-requests/index.js'
      && item.control.handler === handler)
    assert.equal(action.confirmationMode, 'wx.showModal')
    assert.ok(action.requiredBranches.includes('modal-cancelled'))
  })
  const repick = rebuilt.controls.filter((item) => item.entry.js === 'pages/merchant/citynode/create/index.js'
    && item.control.handler === 'repick')
  assert.ok(repick.length > 0)
  assert.ok(repick.every((item) => item.confirmationMode === null))

  const interactions = rebuilt.controls.filter((item) => item.entry.js === 'components/cy/scene-roam-poi-detail/index.js'
    && item.control.handler === 'startInteract')
  assert.deepEqual(interactions.map((item) => item.variant.id).sort(), [
    'answer', 'choice', 'direct', 'photo', 'scan',
  ])
  assert.deepEqual(interactions.filter((item) => item.confirmationMode).map((item) => item.variant.id), ['answer'])
  const photo = interactions.find((item) => item.variant.id === 'photo')
  assert.deepEqual(photo.requiredRequests.map((item) => item.urlTemplate), [
    '/api/common/uploadOSS', '/api/city/nodes/{param}/complete',
  ])
  assert.deepEqual(photo.requiredRequestOutcomes['getLocation-denied'], ['success', 'not-called'])
  assert.deepEqual(photo.requiredRequestOutcomes.cancelled, ['not-called', 'not-called'])
  assert.equal(photo.requiredAuthorityLinks, null)
  assert.deepEqual(photo.requiredAuthorityLinksByBranch.success, [{
    fromIndex: 0, fromPath: 'authority.after.url', toIndex: 1, toPath: 'request.body.photoUrl',
  }])
  assert.deepEqual(photo.requiredReadbackLinksByBranch['getLocation-denied'], [{
    fromPath: 'authoritativeReadback.sequence.0.authority.after.url',
    toPath: 'observed.pendingCompletionPhotoUrl',
  }])
})

test('确认框深度判定先屏蔽字符串/注释/正则，不得记下假事实', () => {
  // 2026-09-15 移植 static-gates 候选:嵌套回调/大括号深度直接数原文,一句 `const re = /}/`
  // 就能让深度整体错位,把顶层真确认框误判成嵌套(假事实:台账写「没有确认框」);反过来
  // 字符串/注释里的 showModal 会被当成真确认框(假事实:凭空多一条确认)。
  const handler = (body) => modalContractForHandler('h', new Map([['h', body]]), 'tap')
  assert.equal(handler(
    "h(e) { const re = /}/g; wx.showModal({ title: '确认删除', success(r) { if (r.confirm) that.remove() } }) }",
  ), 'wx.showModal', '正则里的 } 不得把顶层确认框顶出同步路径')
  assert.equal(handler(
    'h(e) { const tpl = "success() {"; wx.showModal({ title: \'确认删除\', success(r) { if (r.confirm) that.remove() } }) }',
  ), 'wx.showModal', '字符串里的 success() { 不得被当成回调起点吞掉后续确认框')
  assert.equal(handler(
    'h(e) { const tip = "wx.showModal({ success(r) { if (r.confirm) that.remove() } })"; this.go() }',
  ), null, '字符串里的 showModal 文案不得凭空造出确认框')
  assert.equal(handler(
    'h(e) { /* wx.showModal({ success(r) { if (r.confirm) that.remove() } }) */ this.go() }',
  ), null, '注释里的 showModal 不得凭空造出确认框')
  assert.equal(handler(
    "h(e) { /* 留痕 */ wx.showModal({ title: '确认', success(r) { if (r.confirm) that.remove() } }) }",
  ), 'wx.showModal', '屏蔽注释不能顺手把同一行的真确认框也屏蔽成漏报')
})

// 2026-09-27 合入停表重试入口后按最终源码重建：4382 个控件，本地 tap 1767、事件合同 2262。
test('真实点击与组件事件合同分母分开，非 tap 不得伪装按钮点击', () => {
  assert.equal(interactionModeFor('bindtap'), 'tap')
  assert.equal(interactionModeFor('bind:close'), 'event-contract')
  const local = ledger.controls.filter((item) => item.actionClass !== 'external')
  // 2026-09-13逐项映射：漫游恢复/继续+2 tap，copyRecap真实剪贴板归external，local tap净+1。
  // 邀约恢复+2、漫游retry+1、订单orderchanged+1，local事件净+4；草稿据点拒绝独立variant再+1 tap，总3971。
  // 2026-08-25 工时自报退役：edition-report 少了「自报」按钮(−1 tap)与工时输入框(−1 事件合同)。
  // 2026-08-26 圈层主题接回同一货架，新增配置入口，合并后分母 +1。
  // 2026-08-26 俱乐部公开详情新增 CLUB / ACTIVITY 举报与封禁申诉三个真实点击入口。
  // 同日商家/俱乐部补全收口新增候补取消、活动取消回读、凭证、导出重试与空态入口，并移除旧详情页开团入口。
  // 主线俱乐部详情重做及管理员治理入口在此基础上净增 8 个 tap，最终合并分母为 1391。
    // 2026-08-26 日期区间组件:activity/list 的「活动开始/活动结束」两个 cy-date-field 换成
  //   一次选完的 cy-date-range-sheet(−2 tap:两个 date-field 触发器换成 1 个,净 −1),
  //   新组件自带 3 个快捷芯片 + 清除 + 日历格子入口,合计净增 5,分母 1391 → 1396。
  // 2026-08-26 日期区间组件:cy-date-range-sheet 的 confirm/cancel 与 cy-calendar 的 change/overrange,净增 3 条事件合同,1596 → 1599。
  // 2026-08-26 Figma v5.1 新玩法落地:九个玩法壳 + 木鱼/贴纸/签卡的可点元素并入,1391 → 1407。
  // 2026-08-26 时段组件:merchant/game-node 与 play/celebrate 各把两个 cy-date-field 时间
  //   触发器合成一个 cy-time-range 入口(原触发器不计 tap,新入口是真实 bindtap),各 +1。
  //   在 v5.1 的 1407 基础上 → 1409。
  // 2026-08-26 时段组件:cy-time-range 的 confirm/cancel 与它转给 cy-date-sheet 的两条。
  // 2026-08-26 营销页重做:净 +1 = 「口碑管理」入口(去真实评价页;旧 profile
  // 公开名片页那个假入口不许复活)。其余全是等量替换 —— entry-row→tile /
  // mine-row→mine-tile / coop-entry→coop / 券卡与空态合并成同一个 deck-slot,
  // 所以 controlCount 一个没涨、只有 tap 分母 +1。1406 → 1407。
  // 2026-08-26 模板页拆两 tab:圈层原型在置顶/其余两个列表各多一个独立「去创建」入口
  // —— 去处是简易版发布器而不是整包复制,按钮文案必须与普通主题不同。1407 → 1409。
  // 2026-08-26 时段组件:game-node 与 play/celebrate 各把两个时间触发器合成一个入口,
  //   加上 cy-time-range 自身的入口。1409 → 1411。
  // 2026-08-26 时段组件:cy-time-range 的 confirm/cancel 与它转给 cy-date-sheet 的两条,1584 → 1588。
  // 2026-08-26 日期区间组件:cy-calendar 的日历格子 + cy-date-range-sheet 的三个快捷芯片、
  //   清除与确定,减去 activity/list 少掉的一个 date-field 触发器。1409 → 1414。
  // 2026-08-26 时段组件:game-node 与 play/celebrate 各把两个时间触发器合成一个入口,加上 cy-time-range 自身入口。1414 → 1416。
  // 2026-08-27 营销页窗口切换失败态:切窗口已清掉旧窗口数据,失败时不能只剩选中态撒谎,
  //   经营事件区新增一个「点击重试」错误位(bindtap=loadMarketingHome)。1416 → 1417。
  // 2026-08-27 v5.1 玩法配置补齐 + 货架「配置」入口:再 +9(1417 → 1426),只落在两条路由 ——
  //   pages/publish/temp/index +7:盲品选项/备选名/签文的「添加·删除」与
  //     「设为正确答案」单选行(这一颗是 tap 不是开关 —— 答案是单选,用 cy-switch
  //     会出现「把答案关掉」这种无意义状态);
  //   pages/template/index +2:卡片一钮变两钮(主钮「配置」+ 次钮「用模板」),
  //     置顶列表与其余列表各一处。
  // ★ 与 #882 的合并:两侧从同一基线 1416 各自抬数(本 PR +9 / #882 +1),
  //   合并后是两份增量的并集,不是二选一。数字由 audit:actions:update 重建后回读得到。
  // 2026-08-27 cy-timeline 状态时间线新建:+2 tap(1426 → 1428),全在新组件内 ——
  //   折叠头(bindtap=onToggle)与「进行中」那一步的操作按钮(bind:tap=onAction)。
  //   两个接入页(club/detail、merchant/citynode/create)本身没多按钮,只是多了一条时间线。
  // 2026-08-27 精准停表两页:10 个 bindtap 入口(模板行开局/删除、±秒、三种隐藏模式、
  //   新建入口与取消/保存、下一局开始、玩一局主键);开关走 cy-switch 的 bind:change,
  //   算在下面的事件合同分母里,不进 tap。同为并集:1428 → 1438。
  // 2026-08-27 cy-time-range 换掉原生滚轮:picker-view 的白色渐变遮罩/指示条是微信画的,
  //   wxss 覆不干净,在纯黑页上整块泛白。改成自绘的「减—数值—加」调节器后,
  //   两块调节器各多两个 ± 按钮(catchtap),tap 分母 1426 → 1430。
  //   数字由 audit:actions:update 重建后回读得到,不是手算的。
  // 2026-08-29 剧情付费墙、帖文卡收敛、口碑评价页与清理已批准删改项同轮 rebase 后，
  //   audit:actions:update 重建实测 tap 分母为 1411，旧分支各自数字都不是合并后的真值。
  // 2026-08-30 玩法 UX 第一批 rebase 到 88c01bf32 后重建实测:tap 1408 / 事件合同 1666 / 控件 3281
  //   (新增 blindtaste/slowtask 两个玩法壳与刮开揭示,事件合同上升)。
  // 2026-08-30 刮开兜底由不可见的 longpress 改为可见的「直接揭示」bindtap；重建实测
  //   tap 1409 / 事件合同 1665 / 控件仍为 3281（一进一退，不是新增控件）。
  // 2026-08-30 危险动作三段式确认 rebase 到 dab0b4c8a 后重建实测:tap 1405 / 事件合同 1662 /
  //   控件 3274。三段式把「点一下直接删」换成「点开确认 → 组件事件确认」,
  //   所以 tap 略降而事件合同上升,不是漏统计。数字由 audit:actions:update 回读得到。
  // 2026-08-30 产品裁决删除创作者中心、独立署名页和模板半屏预览后，
  // audit:actions:update 重建实测 tap 1398 / 事件合同 1659 / 控件 3265。
  // 事件合同比 master 净减 6，恰好对应裁决删除的独立署名页(1)与创作者中心(5)。
  // 2026-08-30 本轮 UI 收口:入驻底栏去掉重复返回(-1 tap)，承接报名增加日期区间
  // 入口(+1 tap)，搜索主题海报卡与其它结果拆成互斥点击 variant(+1 tap)；最终界面
  // 补齐售后最近查询、经营团队详情、Tag Picker 已选入口等后，重建实测 1403。
  // 2026-08-30 客户页新增复制电话的可达点击，重建实测 1404。
  // 2026-09-03 俱乐部详情 N 系列(Figma s7SEFaoJ3GQUIxJhdqcFUb)tap 1434 → 1436:
  //   +1 榜头「综合 ▾」onRankSortTap(取代 chip tabs)
  //   +2 活动 tab 两个建队入口:段头链接 + 空态按钮(原来是 cy-empty 的 cta,算 event-contract)
  //   -1 榜单行改成整行可点,不再拆 avatar / main 两个热区
  // 2026-09-03 入职流 G1-G4/H1-H4 重做:apply 21→18、create 20→17 控件,tap 1436 → 1432。
  //   稿把分散的小按钮收成向导单主键,控件反而更少。
  // 2026-09-03 场次运营 E1/E2 + 结算分润新页 + 找回的出示游戏码弹层:
  //   event-ops 24→28、settlement 0→5、club-game-code-sheet 0→3、group-code +1(挂隐私门)。
  //   tap 净 +5。
  // 2026-09-04 导演台整页收编:game-director 删除,十张卡进 topic-detail。
  //   旧页 32 个控件归零、新页 8→37,tap 净 -5。
  /* 2026-09-07 coop/list 补收件箱接受·拒绝 + 已拒绝态再邀别人,1408 → 1411 */
  /* 2026-09-07 E1 日期清单展开钮,1411 → 1412 */
  /* 2026-09-07 J4/J3 弹层的三处点击(编辑主题内容 / 招商台 / 查看申请),1412 → 1415 */
  /* 2026-09-07 J7 的「拨打」,1415 → 1416(其余入口走圆钮既有分发)*/
  /* 2026-09-08 按「00 流程与弹层规则 · 读我」收编:招商台与设置招募条件两张弹层整体删除
  // 并 master 前它那边是:(读我的入口表里没有它们),J7 商家 + J2 客户合并成一个两 tab 的 T1。
  // 并 master 前它那边是:增减全部落在 pages/club/topic-detail/index.wxml,已逐条比对台账 id 确认无其它页漂移。 */
  /* 2026-09-08 商家/客户拆回两个独立弹层。tap 本身 1 进 1 出没变,分母 -1 是因为
  // 并 master 前它那边是:「拨打」(callMerchant)被重新判成 external 而离开了 local 子集 —— 它确实调
  // 并 master 前它那边是:wx.makePhoneCall。同时「确认处理」(confirmIncident)从 external 回到 other,
  // 并 master 前它那边是:它只发请求、零真机能力。⚠️ 也就是说改动前台账把 makePhoneCall 挂在了错的控件上,
  // 并 master 前它那边是:这次是纠正,不是回归。分类随控件位置漂移这件事本身值得单独查。 */
  /* 2026-09-08 +6:协作详情页(拒绝/接受/撤回/去缴保证金/复制电话)与列表两侧行的进入点。 */
  /* 2026-09-08 +2:俱乐部管理 tab 新增「可对接的活动」折叠段(展开行 + 卡片进合作池)。 */
  /* 2026-09-08 +1:名册里核销状态那一格接进核销详情。 */
  /* 2026-09-08 +4:「更多」弹层里新增剧情与玩法 / 核销台账 / 场次管理 / 退出与暂停规则四条导航。 */
  /* 2026-09-09 用户裁决批次:−会费两页 −探店日质量证据整页 −名册行内退款 −群聊入口
  // 并 master 前它那边是:−通知页两张渠道卡 −角色/治理两页的编号分节;+核销详情底部退款 +开放设置开关
  // 并 master 前它那边是:+入会申请留言 +管理弹窗两个计数 +解散阻断项四段化。audit:actions:update 重建实测 1426 → 1423。
  // 并 master 前它那边是:2026-09-10 再 +1:开放设置补第二个开关「开放商家承接」,1423 → 1424。
  // 并 master 前它那边是:2026-09-10 帖子引用:发帖框的「带上一次游玩记录」入口 / 撤掉它 / 选择半屏里的选项,1424 → 1427。
  // 并 master 前它那边是:2026-09-10 开放设置补第三个开关「俱乐部公开可见」(生产库早有这一列),1427 → 1428。 */
  // 并 master 前它那边是:assert.equal(local.filter((item) => item.interactionMode === 'tap').length, 1435)  /* rebase 后按重建实测 1406 → 1408 */  /* rebase 后按重建实测 1416 → 1406 */  /* 2026-09-06 空态收编:5 个空态里的裸按钮改成 cy-empty 的 cta 事件合同,1422 → 1417 */  /* rebase 后按重建实测 1424 → 1422 */  /* 2026-09-06 #1007 option-sheet 自身两个点击 + im/chat「+」入口改本地态,1421 → 1424 */  /* 2026-09-03 rebase 后重算 */  /* 2026-09-11 并入 master:两边各自动过这三个冻结数,不是二选一,按合并后重建实测重算 */
  // 2026-09-08 二次合 master(#1047 专业发布页 / #1048 途中彩蛋整条下线)。两侧数字对合并结果
  //   都不对,按 audit:actions:update 重建实测填。
  // 并 master 前它那边是:assert.equal(local.filter((item) => item.interactionMode === 'tap').length, 1415)  /* 2026-09-08 完成奖励选择器加「优惠券/体验卡」两档筛选 +1 */
  //   +1 章节卡新增的「编辑章节」(城市定向档此前没有卡上入口)
  //   +2 两处插入缝的「音频」档**从 external 回到 local** —— 它不再直接拉起 chooseDocument,
  //      改成只插一个空块(选文件挪到点空块时的 uploadStoryAudio 上,那个才是 external)。  /* rebase 后按重建实测 1406 → 1408 */  /* rebase 后按重建实测 1416 → 1406 */  /* 2026-09-06 空态收编:5 个空态里的裸按钮改成 cy-empty 的 cta 事件合同,1422 → 1417 */  /* rebase 后按重建实测 1424 → 1422 */  /* 2026-09-06 #1007 option-sheet 自身两个点击 + im/chat「+」入口改本地态,1421 → 1424 */  /* 2026-09-03 rebase 后重算 */
  // 2026-09-09 漫游四模式落码,重建实测 tap 1438 → 1437。同一批里有增有减:
  //   减:「动态效果」从 bindtap 箭头行换成真开关(tap 转成事件合同);它原本被写在
  //      「设置」那一行**内部**,拆开后不再有里外两层都可点。
  //   增:「自动记录足迹」原来只有一枚点不动的 disabled 开关,现在整行可点去解释;
  //      顶部输入地址组件带来结果行与清空钮;投一张换一张整页的可点控件。
  //   重建实测 1446。
  //   2026-09-09 输入地址照原型改成「白条 + 压暗层 + 结果列表」两个状态:
  //   多出压暗层与「取消」两个真点击,1446 → 1448;控件数 3444 → 3445。
  //   2026-09-09 抽屉照原型搬:动态效果那枚开关从 cy-switch(事件合同)换成原型自己那枚
  //   .dsw 药丸(catchtap,真点击),1448 → 1449。
  //   ⚠️ 分母取 audit:actions:update 的重建实测值,不按上面这笔账手算 —— variant 的
  //   拆分规则(同一控件按状态拆多条)不是「一个 bindtap 一条」,手算必错。
  //   2026-09-10 附近正在漫游的人:漫游半屏多出「打个招呼 / 看 TA 的漫游」两个真点击,
  //   1449 → 1451。地图上他人的 marker 走 bind:markertap,是 free-map 的事件合同,不进 tap 分母。
  //   2026-09-10 漫游四模式脱离 DS 壳:玩法说明与 TA 的漫游两屏改用原型自己的
  //   .dim/.sheet/.sx —— 压暗层与 ✕ 各变成两个真点击(原来是 cy-scene-sheet 的事件合同),
  //   1451 → 1457。
  //   2026-09-10 第二批:漫游页 15 个半屏 + 首次发现仪式卡全部换成原型壳,
  //   每个的压暗层与 ✕ 都从组件事件变成真点击,1457 → 1499。
  //   同批集邮册照原型重做成三列方格:「收藏夹」那个展开/合上的整块点击退场,1499 → 1498。
  //   2026-09-10 第三批:漫游补上原型的工具抽屉(9 行)+ 设置页(5 行)+ 清空确认(2 键),
  //   连同三层壳各自的压暗层与抓手/✕,1498 → 1520。
  //   2026-09-10 自由探索加地图模式:卡包页多一枚地图钮、地图模式的卡头多一个「回卡包」,
  //   1520 → 1522。
  //   2026-09-11 组局照原型重做:六层壳的压暗层与 ✕ 都成了真点击,局详情那屏又多几个,
  //   1522 → 1550。同批 subpackageRoam/nearby 少了六件 cy-sheet 的事件合同,
  //   常驻 peek 面板与图例整块退场,底部换成原型的横条 + 单键「拍照」。
  //   2026-09-11 补上原型 topicSheet(点主题先出半屏,不再直接被抬到整页),1550 → 1554。
  //   2026-09-11 游玩页脱离 DS 壳:12 个 cy-scene-sheet + 2 个 cy-sheet 换成原型壳,
  //   每层的压暗层与 ✕ 都从组件事件变成真点击;同批自由探索抽屉按原型 x-tools 补了六行。
  //   1554 → 1600(事件合同同时 1751 → 1725,是同一批换手,不是凭空多出来的按钮)。
  // 2026-09-11 并 github/master 后重建实测:controls 3548 · tap 1593 · 事件合同 1731。
  // 2026-09-11 并 github/master(#1052/#1055/#1058)后重建实测:controls 3590 · tap 1613 · 事件合同 1759。
  // 2026-09-11 并 #1043 向导开场屏:三条 startForm CTA + 形变层,建团顶栏关闭钮删除;
  //   audit:actions:update 重建实测 controls 3590→3598 · tap 1613→1619 · 事件合同仍 1759。
  // 2026-09-11 相机统一到原型取景卡(拟物机身退场、citystamp 抽出 cy-proto-cam、
  //   漫游三键拍照改成浮在地图上的取景卡)后重建实测:controls 3595 · tap 1615 · 事件合同 1763。
  // 2026-09-11 漫游「查找附近好玩的」换成原型 f-fun 横滑白卡(半屏摘掉、白卡三枚可点)后
  //   重建实测:controls 3592 · tap 1614 · 事件合同 1761。
  // 2026-09-11 照原型补齐 f-topic/f-city、f-checkin、f-multi、f-hangout(漫游)与 h-place、
  //   h-joined/h-ready 状态(组局)后重建实测:controls 3610 · tap 1630 · 事件合同 1761。
  // 2026-09-11 再并 github/master(#1061) + 保留 #1043 向导开场屏后重建实测:
  //   controls 3610→3618 · tap 1630→1636 · 事件合同仍 1761。
  // 2026-09-12 并 github/master(#1043) + 保留 #1046 客户详情六态/button-reset 后重建实测:
  //   controls 3618→3620 · tap 1636→1637 · 事件合同 1761→1762。
  // 2026-09-12 并 #1046 后重建实测 tap 1637；门口码首页分流后再重建 1637→1639。
  // 2026-09-14 干净树 audit:actions:update 重建逐项映射 1745→1748:im 卡片 onCardTap(6a2365f7a 台账已同步、本断言漏改)、
  //   im 失败消息 onResend(2e204381f)、商家申请页「前往移交」openClubGovernance(3bdc0faa6)。
  // 2026-09-15 协作邀请已接受卡收敛:coop/list 卡上 -7 tap(联系×2/申报/评价×2/取消/锁价),
  //   coop/invite-detail 列表行 +5 tap(联系合作方/申报供给/评价/取消合作/锁价说明),
  //   供给申报浮层整块随迁不增减尾部 —— 按重建台账实测 tap 1750 → 1748(上一行 1745 是陈旧值)。
  // 2026-09-15 CR-927 商家上传节点NPC:node-npc-form 半屏(形象预设/拍照、声音四钮、保存/取消)
  //   进入台账,tap 变体 1748→1754;控件总数 3981→3995(含组件事件合同)。
  // 2026-09-15 集成总线第一段(撤出 cr423 后 10 支,合并树 audit:actions:update 重建实测):tap 1748→1753;各分支自报增量叠加后以重建值为准(上方分支注释的中间值不再单独成立)。
  // 2026-09-15 集成总线第二段 合 map-team(地图组队合拢):roam/nearby 整卡退场与 f-hangout 下架,
  //   tap 1753→1720(取 audit:actions:update 重建实测,非两侧自报值相加)。
  // 2026-09-15 集成第二段收尾:order-detail 建队卡去重(合并曾留下两张,见 T3f 契约),tap 1720→1719。
  // 2026-09-16 认领撤回:citynode 待审认领行新增「撤回申请」tap +1;同批的失败重试走 cy-inline-error
  //   的 bind:action(进下面的事件合同分母),tap 1719→1720(取 audit:actions:update 重建实测)。
  // 2026-09-16 H050/H051 帖文操作接线:广场列表自绘举报弹层退役(压暗层/取消/举报行 3 个 tap),
  //   换成三合一 cy-post-actions(组件内 5 条 bindtap/bind:confirm 都是组件事件合同,不计 tap)。
  //   合拢后按 audit:actions:update 重建实测 1719(两侧自报的 1720/1718 都不可用:基线不同)。
  // 2026-09-16 C 组修复(整体检查 C-04/C-05):roam 抽屉新增「结束本次漫游」行 +1 tap;
  //   同批 openRoamSettings 的处理器开始读 wx.getSetting/开系统设置页,动作分类由 state 升为 external。
  //   两笔合起来 local tap 1719→1718、external +1、控件 3975→3976(取 audit:actions:update 重建实测)。
  // 2026-09-16 D 组修复(整体检查 D-05/D-11):reviews 新增「修改回复/删除回复/取消编辑」3 个 tap,
  //   ai-npc 新增「性格设定」cell(+1 tap,其多行输入进 input 计);重建实测 tap 1719→1724。
  // 2026-09-16 合拢第三轮 B/C/D 合流:三侧并集,按合并树 audit:actions:update 重建实测 1723。
  // 2026-09-16 整体检查 A 组:A-04 帖文详情评论行新增「删除」(本人可见,真实 tap)+1;
  //   A-08 category-sheet 的空态重试换成 cy-inline-error bind:action(事件合同内净 0)。
  //   按 audit:actions:update 重建实测 tap 1719→1720。
  // 2026-09-16 E 组整体检查修复:tap 1719→1724(重建实测)—— topic-detail 的 D4/D5/D6/D8
  //   四条现场工具入口 bindtap,+club/group-code no-permission 态的「进入俱乐部管理」1 条;
  //   角色弹层的 selectmember 是组件事件合同,进下面的事件合同分母。
  // 2026-09-16 合拢第四轮 A 并入:三侧并集,按合并树 audit:actions:update 重建实测 1724。
  // 2026-09-16 合拢第四轮 E 并入:A/E 并集,按合并树 audit:actions:update 重建实测 1729。
  // 2026-09-16 候选池页退役 + 承接报名收编:候选页 12 个 tap 随页消失,协作列表新增
  //   「确认占槽」「婉拒报名」2 个 tap ⇒ 按 audit:actions:update 重建实测 1723→1721。
  // 2026-09-16 截图冒烟修复(本批):tixian 银行卡表单退役 —— 撤掉 5 个输入控件、
  //   「全部提现」热区、「确认提现」与单独同意勾选,tap 少 4 条;新增「联系客服提现」1 条 tap;
  //   merchantinfo 缺参态 cy-empty 的返回 CTA 1 条 tap;searchmap 图层说明的「开启定位」可点提示 1 条 tap。
  //   合起来 local tap 1723→1722(按 audit:actions:update 重建实测)。
  // 2026-09-16 合拢第五轮 候选池/截图冒烟并入:侧并集,按合并树 audit:actions:update 重建实测 1726。
  // 2026-09-17 券拍板项实施:承接报名「婉拒」按用户拍板退役(-1 tap),商家券管理新增「停发该券」(+1 tap),
  //   一进一出,local tap 仍 1726;按 audit:actions:update 重建实测核对(仅行号漂移)。
  // 2026-09-17 漫游拍板实施(C-12/C-26):roam −2 = 探店卡失败重试按钮(retryCheckin)与 goal 卡
  //   的 retry-checkin variant 一起删除;play +1 = needPass 空态「获取通行证」按钮。按重建实测 1726→1725。
  // 2026-09-17 客诉期提现闸:余额三段组件 cy-funds-stages 取不到时的「重试」+1 tap ⇒ 按 audit:actions:update 重建实测 1727。
  // 2026-09-17 发布版本 release-0917 再合资金:券+漫游+游玩合并树 1725 + 资金 cy-funds-stages「重试」+1 ⇒ 重建实测 1726。
  // 2026-09-17 定向广播接线:客户页广播半屏新增「完成」按钮(结果块出现后关闭半屏),local tap 1726→1727。
  // 2026-09-17 发布版本 release-0917 再合广播:合并树 1726 + 广播半屏「完成」+1 ⇒ 重建实测 1727。
  // 2026-09-17 HO-26 导演台集合时间:活动详情页新增「修改」、半屏「取消」「保存」三颗真点击,1726 → 1729(重建实测)。
  // 2026-09-17 发布版本 release-0917 再合 fix-p1:合并树 1727 + HO-26 修改/取消/保存 +3 ⇒ 重建实测 1730。
  // 2026-09-17 第二轮拍板 #23/#24:工作台新增「竞猜待给答案」待办入口与「查看申请进度」两枚 tap,
  //   按 audit:actions:update 重建实测 1726→1728。
  // 2026-09-17 发布版本 release-0917 再合 fix-merchant:合并树 1730 + 工作台竞猜待办行 / 入驻状态卡「查看申请进度」+2 ⇒ 重建实测 1732。
  // 2026-09-17 第二轮拍板 17 足迹分享直达:深链页分享面板「重新生成足迹链接」+1 tap,1726→1727(audit:actions:update 重建实测)。
  // 2026-09-17 发布版本 release-0917 再合 fix-play:合并树 1732 + fix-play +1 ⇒ 重建实测 1733。
  // 2026-09-17 拍板 #15:首页补搜索入口(整行 tap → /pages/search2/index),1726→1727(取 audit:actions:update 重建实测)。
  // 2026-09-17 发布版本 release-0917 再合 fix-player:合并树 1733 + 首页搜索入口 goSearch +1 ⇒ 重建实测 1734。
  // 2026-09-17 商家营销同意入口(拍板第 40 条 A):结果面板重试行、订单详情同意勾选行与重试
  //   共 +2 条 tap,按 audit:actions:update 重建实测 1726→1728。
  // 2026-09-17 发布版本 release-0917 再合 fix-consent:合并树 1734 + 同意勾选 +2 ⇒ 重建实测 1736。
  // 2026-09-17 退款售后照 Revolut 重做:tap 净 −1(查单三处 tap 删、胶囊/复制/继续/加载更多等增,另有若干改为组件事件合同)⇒ 重建实测 1735。
  // 2026-09-18 photoCheck 接真视觉:编辑器里 rule.mode 的四选一(亮区/边缘/清晰度/任意)整组删掉,
  //   换成 requirement 一句话输入 + minConfidence ⇒ temp 的 tap −1、事件合同 +1,控件总数不变。
  // 2026-09-18 present:local tap 1771→1774(内嵌骰子 +1、编辑器呈现二选一 +2)。
  // 2026-09-18 阶段4 修复:统一主页「招牌主推」+1 tap(本分支侧基线 1735 → 1736);
  //   rebase 到 github/master 后两侧增量合并 ⇒ 按 audit:actions:update 重建实测 1774→1775。
  // 2026-09-18 rebase #1072 到 master(3cce66ab0):cy-publish-sheet 整段重做 —— 旧展开卡的轮播/拖拽
  //   与「去活动 / 去券 / 打开主题模式」入口卡退场(12 条真点击出账),换四枚快捷动作 + tabBar 那枚
  //   全局发布 fab(10 条进账)。取 audit:actions:update 重建实测 1771 → 1769,不按这笔账手算。
  // 2026-09-18 合并两侧后重建实测:master 侧 1775 叠加 #1072 净 −2 ⇒ 1773,按 audit:actions:update 实算。
  // 2026-09-19 并入 fix/audit-wiring-202609 侧账目(其自报值基线不同,以合并树重建实测为准):
  // (本支) 2026-09-18 批3D 高频主 CTA 接 bind:disabledtap 引导(fix/audit-wiring-202609):
  // (本支) 置灰键的 disabledtap 全是组件事件,一条 tap 不该动 —— 这里的 +1 来自批1B:
  // (本支) topic-detail 加了 chromeClearTop 后行位平移,「复制电话」copyPhone 从 external 回到
  // (本支) local(它只调 wx.setClipboardData,回 local 是真值不是误判)。重建实测 tap 1737 → 1738。
  // (本支) 2026-09-16 编辑页按原型重排:tap 1743 → 1737(−6)。都是 bindtap 节点的增减 ——
  // (本支) 减:AI 助写卡、玩法难度选择器、问答选项的配图/配音两个角标(商家配不了)、旧规则 textarea;
  // (本支) 加:玩法规则的每步删除与「添加一步」。event-contract 分母另算(cy-switch / cy-dropdown 走组件事件)。
  // (本支) 2026-09-19 裁决「弹层退出口只留 ✕」:三颗底部取消(roam sh-cancel / shezhi reg-cancel /
  // (本支) reward-selector onCreateCancel)随按钮退役,tap 1767 → 1764;event-contract 2100 不动。
  // (本支) 2026-09-19 批复1-a=2:定价页「合作阵容」行 +1 tap、B-06 退役的 partner 页按裁决复活
  // (本支) 带回 2 tap(goFullProfile/onDetailTap)与 4 条事件合同(back/cta×2/retry)⇒ tap 1764 → 1766、event-contract 2100 → 2104。
  // (本支) 2026-09-19 用户改判摘除首页搜索入口:goSearch 一个 tap 出账 ⇒ tap 1766 → 1765。
  // (本支) 2026-09-20 合批收口:商家底栏 v8 与模板页顶栏头像两态退役(4e5bf9eaf)+ 工作区实名接线批
  // (d0db66668)在 club/apply、merchant/apply、scene-route-content 等面上净减 4 个 bindtap 节点,
  // 组件事件/disabledtap 接线净增 20 条 event-contract ⇒ 以最终树重钉:tap 1765 → 1761(重建实测)。
  // 2026-09-22 游玩页删地图/底部读数卡/起始页:地点卡层、读数卡三态行、起始页 checklist 与
  //   横滑卡、底栏「设置」行等真实点击整片退场;自审又摘掉卡包上那枚「在地图上看这些商户」
  //   (地图已删,点它进空白屏且无返回)⇒ tap 1787 → 1775(audit:actions:update 重建实测)。
  // (本支) 2026-09-21 F-26~F-56 那批改了 wxml 却没跑 audit:actions:update,台账在 HEAD 上就是漂的;
  //   本次重建把它并回来 ⇒ tap 1789 → 1792。F-57 只是把五行领队工具挪出 mode 分支,tap 净增 0。
  // (本支) 2026-09-22 分类器修 A+B+C 后重钉:41 个控件由 read/write/state/navigation 转入
  //   external(0 个转出),因为它们经 require 进来的 helper 真能走到 wx.* 能力,此前跟不进去
  //   而被少判。external 要求的证据分支更多(基础分支 + 能力失败分支),方向是更严。
  //   primaryApis 与 effectClasses 零变化、控件数仍 4260 ⇒ tap 1792 → 1761。
  // (本支) 2026-09-22 F-06 裸错误文案收编:citynode/create 的 retryAccess 与
  //   marketing-consent 的 retry 从 <text bindtap> 换成 <cy-inline-error bind:action>,
  //   两个控件由 tap 转为 event-contract ⇒ tap 1761 → 1759、event-contract 2152 → 2154,
  //   控件总数仍 4260。(逐 handler 差分实测,不是按删改行数推算。)
  // 2026-09-22 现场感三件套 S2 罗盘指向:+2 tap(玩家端罗盘卡「对准方向」onStart、
  //   创作端「取值」onCompassCapture),1789 → 1791(重建实测)。
  // (本支) 2026-09-22 合 master(#1139/#1141/#1144/#1145/#1146 现场感与玩法批)后按合并树重建。
  //   三项均严格可加,可作为合并自洽的佐证:base 4254 + 本支 6 + master 21 = 4281;
  //   tap 1787 - 28(本支分类器修好后 41 个控件转 external)+ 4 = 1763;
  //   event-contract 2160 - 6 + 14 = 2168。数字取自重建实测,非推算。
  // 2026-09-22 rebase 到最新 master 后按合并树重建实测(本分支删掉的从 master 新基数上减)。
  // 2026-09-22 S3b 喊一嗓子:playkit-shout 开跑键 +1 tap(重建实测,合并树基数 1751 → 1752)。
  // 2026-09-22 阶段 5 条件修正 mods:+4 tap(预设 chip addModPreset / 删除行 removeModRow /
  //   比较 op chip pickModOp / 添加行 addModRow);4 个 updateModField 是 bindinput,
  //   进 event-contract 不进 tap 分母。1752 → 1756(重建实测)。
  // 2026-09-22 M-09 定向广播必须选人:新增「选人」逐行勾选 toggleCastPerson 与预览失败「重新核对」refreshCastPreview
  //   (+2 tap;「已全选」行只展示不可点)。1756 → 1758(重建实测)。
  // 2026-09-22 编辑页单选统一下拉(检定段除外):玩法形态 / 呈现方式(两颗)/ 扫码回什么 / 分类归类 / 画像作答方式 /
  //   画像加成方式 / 拍照次数用尽 / 掷骰几颗(两颗)/ 勋章样式(两颗)共 12 颗 tap 变成 9 个 cy-dropdown 的
  //   bind:change,1758 → 1746(重建实测)。
  // 2026-09-23 检定段改「开关 + 下拉」(叠在 #1156 之上):难度三颗芯片 -1、旧条件修正编辑器
  //   addModRow/addModPreset/removeModRow/pickModOp -4、判定写入方式两组芯片 -2 ⇒ 1746 → 1739(重建实测)。
  // 2026-09-23 ComputerUse 走查修复:+3 tap(承接块「申请承接其他章节」/ 回过邀约的申请行「查看合作详情」/
  //   品牌中心「口碑」)。工作台本站摘要直达入口按用户裁决撤回(卡上改写俱乐部到店时间)。1739 → 1742(重建实测)。
  // 2026-09-24 #1165 rebase 到 #1159 之后:我的项目活动页「发布单场活动」+1 tap(票种退款开关改只读 -1 事件合同抵消,总数不变)。1742 → 1743(重建实测)。
  // 2026-09-24 走查第二轮(CU 110 条,rebase 到 #1165 之后)按最终树重建实测:tap 1743 → 1744。
  // 2026-09-24 B 扫码显形真 AR:编辑页「上传 .glb」+ AR 画面上「看不到？改成叠图」两颗 tap,1744 → 1746(重建实测)。
  // 2026-09-25 CU-M-92 受邀商家承接视图:project-join 底栏主按钮拆成「扫码核销 / 原主按钮」两个互斥分支,各 1 tap ⇒ 1746 → 1747(重建实测)。
  assert.equal(local.filter((item) => item.interactionMode === 'tap').length, 1767)  /* 2026-09-22 现场感三件套 S1 新增 4 颗 tap(uploadPhotoFrame / clearPhotoFrame /
     onFrameShutter / onFrameCancel),其中 uploadPhotoFrame 与 onFrameShutter 是
     actionClass=external(real-device-required)、不进 local 分母 ⇒ 进账的是
     onFrameCancel(玩家端「退出取景」)+ clearPhotoFrame(商家端删图),1787 → 1789(重建实测)。 */
  // 入口(+1 tap)，搜索主题海报卡与其它结果拆成互斥点击 variant(+1 tap)；重建实测 1399。
  // 2026-09-02 俱乐部客户系统(K1 列表 / K2 详情六态 / J2 主题内 T3 弹窗 + 俱乐部管理「查看客户」入口):
  //   audit:actions:update 重建实测 tap 1399 → 1408、事件合同 1666 → 1679、控件 3273 → 3295。
  //   audit:actions:update 重建实测 tap 1399 → 1408、事件合同 1666 → 1680、控件 3273 → 3296。
  //   (裸错误文案换成 cy-inline-error 后又 +1 条事件合同 bind:action。)
  // 可重试错误态通过 cy-error 的 retry 组件事件进入台账，新增入口必须同步分母。
  // 2026-08-26 日期区间组件:cy-date-range-sheet 的 confirm/cancel 与 cy-calendar 的
  //   change/overrange,1584 → 1587。
  // 2026-08-26 时段组件:cy-time-range 的 confirm/cancel 与它转给 cy-date-sheet 的两条。1587 → 1591。
  // 2026-08-27 v5.1 玩法配置补齐:再 +34(1591 → 1625),全在 pages/publish/temp/index
  //   —— 七段玩法各一个 cy-switch 开关,加上各段的 input/textarea 字段与
  //   重复项编辑器里的输入框,都是走 bindinput/bindchange 的事件合同,不是真实点击。
  // 2026-08-27 cy-timeline 状态时间线新建:+1(1625 → 1626)——
  //   club/detail 承接组件 bind:toggle 的 onLeadTimelineToggle,是事件合同不是真实点击。
  // 2026-08-27 精准停表模板行的 cy-switch bind:change(启用/停用):+1。两边各加一条、
  //   来源不同(时间线的 toggle vs 停表的开关),所以是并集 1626 → 1627,不是同一颗。
  // 2026-08-28 发布表单错误清除与既有空态出口接入共享组件，实测净增 11 条事件合同。
  // 2026-08-27 cy-time-range 换掉原生滚轮:两条 picker-view 的 bindchange 退场,
  //   两块调节器各接 4 条触摸事件(touchstart/move/end/cancel)—— 净 +6,1625 → 1631。
  // 同批合流后 audit:actions:update 重建实测事件合同分母为 1636。
  // 2026-08-30 首页推荐主题 swiper 新增 transition/change 两条事件合同，1659 → 1661。
  // 2026-08-30 官方活动详情新增滚动导航状态事件，1661 → 1662。
  // 商家承接接入 cy-date-range-sheet 后新增 confirm / cancel 两条事件合同，1662 → 1664；
  // 合作页将会话失效与无权限拆为两个 cy-empty CTA，新增两条事件合同，1664 → 1666；
  // 结算到账提醒改为真实 switch 并接入 bind:change，最终重建实测 1667。
  // 2026-08-30 承接方已有页面内台账入口，客户抽屉去掉一条重复 bind:action；
  // 主办方抽屉保留唯一「查看台账」事件，重建实测 1666。
  // 同一批:event-contract 1697 → 1695。-1 建队 cy-empty cta 换成原生按钮(已计入上面的 tap),
  //   -1 onRankTabChange 随 chip tabs 一起退役(wxml 零绑定的死代码,本 PR 删除)
  // 1695 → 1702:event-ops 选择器换 DS 组件、settlement 的刷新与提现、
  //   出示游戏码弹层的关闭与保存,都走 cy-* 事件合同。
  // 1702 → 1734:导演台十张卡收编进 topic-detail 后,十个 club-director-*
  //   组件从「无人引用」变成被扫到,它们的 bind:* 事件合同一并计入。
  /* 2026-09-07 D8 现场事件:selectincident / selectmode 两条组件事件,1739 → 1741 */
  /* 2026-09-07 J4/J3:两张 cy-scene-sheet 的 close、五个 cy-switch 的 change、
  // 并 master 前它那边是:两处 row-list rowtap、chip-group change、两处 cy-error retry,1741 → 1751 */
  /* 2026-09-07 J7/J2/J8:三张 cy-scene-sheet 的 close、两处 cy-error retry,1751 → 1756 */
  /* 2026-09-08 按「00 流程与弹层规则 · 读我」收编:招商台与设置招募条件两张弹层整体删除
  // 并 master 前它那边是:(读我的入口表里没有它们),J7 商家 + J2 客户合并成一个两 tab 的 T1。
  // 并 master 前它那边是:增减全部落在 pages/club/topic-detail/index.wxml,已逐条比对台账 id 确认无其它页漂移。 */
  /* 2026-09-08 +1 与上面 tap 的 -1 是同一件事的两面:「确认处理」从 external 回到 other,
  // 并 master 前它那边是:于是进入 local 子集,它是 bind:confirm 即事件合同。 */
  /* 2026-09-08 +4:协作详情页的 cy-error retry ×3 与留言 textarea 的 bindinput。 */
  /* 2026-09-08 +1:可对接的活动那段的 cy-error retry。 */
  /* 2026-09-08 +3:核销详情的两处 cy-error retry 与 cy-empty cta。 */
  /* 2026-09-09 同一批次,事件合同重建实测 1759 → 1756。
  // 并 master 前它那边是:2026-09-10 开放设置第二个开关自带一个 cy-inline-error 重试,1756 → 1757。
  // 并 master 前它那边是:2026-09-10 帖子引用选择半屏:cy-error 的 retry 与 cy-sheet 的 close,1757 → 1759。
  // 并 master 前它那边是:2026-09-10 第三个开关自带一个 cy-inline-error 重试,1759 → 1760。 */
  /* 2026-09-11 成绩卡/模板卡收进 cy-post-card:净 +5,全是事件合同(tap 一条没动,仍是 1601)。
  // 并 master 前它那边是:账:两组件搬家 square/components → components/cy 净 0;cy-post-card 新挂 4 条
  // 并 master 前它那边是:(completion 的 detail + feed-play 的 detail/remix/play)10 → 14;广场列表撤掉旧 slot 上的
  // 并 master 前它那边是:4 条、接回 3 条(playdetail/remix/play)37 → 36;俱乐部页与达人页各 +1 条 playdetail。
  // 并 master 前它那边是:1760 → 1765。
  // 并 master 前它那边是:2026-09-11 复查整改:俱乐部页与达人页各补一条 bind:play(模板卡「试玩」原来渲染了没人接,
  // 并 master 前它那边是:点了不会发生任何事),1765 → 1767。tap 仍是 1601。 */
  // 并 master 前它那边是:assert.equal(local.filter((item) => item.interactionMode === 'event-contract').length, 1782)  /* rebase 后按重建实测 1735 → 1739 */  /* rebase 后按重建实测 1731 → 1735 */  /* rebase 后按重建实测 1754 → 1731 */  /* rebase 后按重建实测 1753 → 1754 */  /* 2026-09-06 空态收编:5 个 cy-empty cta 事件合同,1747 → 1752 */  /* 2026-09-06 #1007 九处宿主 select/cancel + option-sheet 自身 close/requestclose,1727 → 1747 */  /* 2026-09-06 俱乐部拒绝入会改走 cy-danger-confirm 事件合同,1726 → 1727 */  // 2026-08-26 模板页拆两 tab:L1 用 cy-tabs 承载「主题/游戏」切换,bind:change 是新的一条事件合同,1583 → 1584  // 2026-08-26 营销页重做:三条刷新失败横幅随 #856 退役(-3),全零业务空态的 cy-empty
  // 2026-09-08 二次合 master(#1047 专业发布页 / #1048 途中彩蛋整条下线)。两侧数字对合并结果
  //   都不对,按 audit:actions:update 重建实测填。
  // 并 master 前它那边是:assert.equal(local.filter((item) => item.interactionMode === 'event-contract').length, 1754)  /* 2026-09-08 完成奖励改开关:+1 bindchange */
  // 2026-09-09 漫游四模式落码,重建实测事件合同 1762 → 1773:抽屉「动态效果」换成
  //   cy-switch 的 bind:change,顶部输入地址组件在三张地图上各挂一条 bind:pick,
  //   组件内部的 input/confirm/focus 一并计入;投一张换一张那页的 textarea input、
  //   相机 error、隐私门 settled、canvas 触摸也都是事件合同。同上,分母取重建实测值。
  //   2026-09-09 输入地址改成两状态后净 -1(收起态那条白条不再带 input/confirm/focus 三条),
  //   1785 → 1784;抽屉那枚 cy-switch 换成原型药丸,事件合同再 -1 → 1783。
  //   2026-09-10 附近正在漫游的人:新场景那件 cy-scene-sheet 带来 requestclose / back
  //   两条,加上遮罩那条,1783 → 1786。
  //   2026-09-10 漫游四模式脱离 DS 壳:两屏不再挂 cy-scene-sheet,
  //   它那三条(requestclose / back / 遮罩)随之退场,1786 → 1782。
  //   2026-09-10 第二批:漫游 15 个半屏 + 仪式卡不再挂 cy-scene-sheet / cy-sheet,
  //   它们那几条(requestclose / back / close / 遮罩)随组件退场,1782 → 1757。
  //   2026-09-10 旅程手记重做成半屏:文字流里那条「前往此站」随它退场,1757 → 1756。
  //   第三批工具抽屉那几行里的 cy-icon 带来两条事件合同,1756 → 1758。
  //   2026-09-11 组局的六件 cy-sheet 退场,它们的 close/requestclose 随之没了,1758 → 1751。
  //   2026-09-11 游玩页 12 件 cy-scene-sheet + 2 件 cy-sheet 退场,它们的
  //   requestclose / back / close / 遮罩随组件一起没了;同批抽屉里的 cy-icon 换成原型
  //   背景图,又少几条。1751 → 1725 —— 减少的这些正是上面 tap +46 的另一半。
  // 2026-09-12 并 #1046 后重建实测事件合同 1762；门口码后再重建 1762→1766。
  // 2026-09-14 干净树重建逐项映射 1988→1996:im closeReviewResult/returnToMessageList(6a2365f7a 漏改)+2;
  //   商家首页 goHome 空态换成 4 个 goMerchantApplication(3bdc0faa6)+3;据点详情关闭 cta 1→2 且 other→state、
  //   retryMerchant(f178b58ae)+2;漫游 onSceneSessionShare 由 external 归 local state +1。
  // 2026-09-15 协作邀请已接受卡收敛:浮层随动作搬家,事件合同数量不变;
  //   按重建台账实测 1987(上一轮遗留的 1988 是陈旧值)。
  //   openOpsTimeSheet/confirmOpsTime/closeOpsTimeSheet 三颗真点击 +3(tap 那行),组件四个
  //   bind:change/bind:close(日期、时间、结果面板、编辑半屏)进事件合同,+4。
  // 2026-09-15 CR-927 节点NPC 半屏:sheet bind:close、result-sheet bind:close、声音 select/cancel 等
  //   组件事件合同 1996→2001(取 audit:actions:update 重建实测)。
  // 2026-09-15 集成总线第一段(撤出 cr423 后 10 支,合并树 audit:actions:update 重建实测):事件合同 1996→2001,各分支自报增量叠加后以重建值为准。
  // 2026-09-15 公开承接池开关恢复(裁决 12B):step3 新增 cy-switch bindchange="onClubPoolChange" +1,1996→1997。
  // 2026-09-15 集成总线第二段 合 publish-rules(裁决 12B 公开承接池开关):step3 与 publish/activity
  //   各 +1 枚 cy-switch bindchange,2001→2003(取 audit:actions:update 重建实测,非两侧自报值相加)。
  // 2026-09-16 补合第一批重做(merge-gap-a2):F15 联系接口 customer 页 cy-result-sheet bind:close +1;
  //   coupon-redeem-fix 券出示码 scene-qr-coupon 的 3 条 retry/cta 事件合同归 external(local −3),2003→2001(audit:actions:update 重建实测)。
  // 2026-09-16 补合第二批 合 coop-dialog-gap(85a5d0962/7da44a217):合作页五处整页失败接
  //   custom-back bind:back,+6 条事件合同;2003→2009(取 audit:actions:update 重建实测,
  //   非分支自报的 2001→2007 —— 分支基线与当前 master 不同)。
  // 2026-09-16 并 claim-revoke:citynode 撤回失败的 cy-inline-error bind:action="retryCancel"
  //   再 +1;2009→2010(合拢后 audit:actions:update 重建实测,非两侧自报值相加)。
  // 2026-09-16 H050/H051 帖文操作接线:cy-post-actions 首次有宿主,组件内 5 条事件合同进台账;
  //   两个页面各一枚 bind:select 分发器(每枚按互斥分支拆 3 条),列表自绘举报弹层退场 -2。
  //   合拢后按 audit:actions:update 重建实测 2021(两侧自报的 2010/2014 都不可用:基线不同)。
  // 2026-09-16 B 组审计(B-03 俱乐部门卡):session-picker / scene-play-activity-detail / baoming
  //   三处各新增一条 cy-empty bind:cta="goGateClub" 事件合同,+3;2021→2024(取 audit:actions:update 重建实测)。
  // 2026-09-16 D 组修复(整体检查 D-05/D-11):reviews 修改回复输入 bindinput、删除确认组件
  //   bind:confirm,ai-npc 性格设定多行输入 bindinput,三条事件合同;重建实测 2021→2024。
  // 2026-09-16 合拢第三轮 B/C/D 合流:三侧并集,按合并树 audit:actions:update 重建实测 2027。
  // 2026-09-16 E 组整体检查修复:事件合同 2021→2025(重建实测)—— club/detail 三处失败态的
  //   cy-error bind:retry(+3),topic-detail 角色弹层 cy-club-director-row-list bind:selectmember(+1)。
  // 2026-09-16 合拢第四轮 E 并入:A/E 并集,按合并树 audit:actions:update 重建实测 2031。
  // 2026-09-16 商家页去闸净 -8(整屏 cta/back 退场、页内 inline-error action 接手),2024→2016
  //   (取 audit:actions:update 重建实测)。
  // 2026-09-16 合拢第四轮 去闸并入:E/去闸并集,按合并树 audit:actions:update 重建实测 2023。
  // 2026-09-16 候选池页退役:随页消失的事件合同(cy-tabs change、cy-error retry 等)按
  //   audit:actions:update 重建实测 2027→2017。
  // 2026-09-16 截图冒烟修复(本批):tixian 退役银行卡表单,撤掉 5 个输入框的 bindinput、
  //   单独同意的 bind:change 与 cy-inline-error 的 bind:action(共 -7),新增 merchantinfo
  //   缺参 cy-empty 的 bind:cta(+1)、联系客服 cy-btn(+1 tap)、searchmap「开启定位」提示(+1 tap);
  //   净 -5 事件合同,local event-contract 2027→2022(按 audit:actions:update 重建实测)。
  // 2026-09-16 合拢第五轮 候选池/截图冒烟并入:侧并集,按合并树 audit:actions:update 重建实测 2008。
  // 2026-09-16 发布版本 release-0916 合资金线(2003→2001,净 −2)与非资金线(2008):两侧并集,按合并树 audit:actions:update 重建实测 2006。
  // 2026-09-17 拍照人工审核开关下线(拍板第16条):editor 的「需人工审核照片」cy-switch bindchange 退役(−1 事件合同);
  //   同批申请留言接线只改弹层调用与文本渲染,不新增事件合同。按 audit:actions:update 重建实测 2006→2005。
  // 2026-09-17 拍板实施:E-09 入会申请刷新失败的内联错误 cy-inline-error 带 bind:action,事件合同 2006→2007(按 audit:actions:update 重建实测)。
  // 2026-09-17 发布版本 release-0917 再合杂项:合并树 2005(游玩 −1)+ 杂项 E-09 内联错误 bind:action +1 ⇒ 重建实测 2006。
  // 2026-09-17 HO-26 导演台集合时间:cy-scene-sheet close、两个 cy-date-field change、cy-result-sheet close 进事件合同,2006 → 2010。
  // 2026-09-17 发布版本 release-0917 再合 fix-p1:合并树 2006 + HO-26 sheet/两个 date-field/result-sheet +4 ⇒ 重建实测 2010。
  // 2026-09-17 E 类小修批:B-06 孤儿页 pages/topic/pricing/partner 整页退役(cy-error retry / cy-empty cta /
  //   两条绑定点击随之退场);A-14-2 首页底部信息流两条 cy-inline-error bind:action(+2)、
  //   B-08 结算页 cy-option-sheet 的 select/cancel(+2)、C-02b 队伍详情 cy-switch bindchange(+1)。
  //   后两项与退役净额叠加后按 audit:actions:update 重建实测 2007(本行取重建值,不加两侧自报数)。
  // 2026-09-17 发布版本 release-0917 再合 fix-xcx:合并树 2010 + E 类小修(首页信息流 cy-inline-error 重试等净 +1)⇒ 重建实测 2011;tap 1730 与 controls 3983 不变(测试实跑确认)。
  // 2026-09-17 第二轮拍板 17:朋友分享落地态 cy-error retry / cy-empty cta / 只读足迹组件 back+close,+4 事件合同,2006→2010(重建实测)。
  // 2026-09-17 发布版本 release-0917 再合 fix-play:合并树 2011 + fix-play +4 ⇒ 重建实测 2015。
  // 2026-09-17 商家营销同意入口(拍板第 40 条 A):结果面板/订单详情各接一个 cy-consent-check bind:change,
  //   票夹与活动两页各接一条 cy-result-sheet bind:consentchange,加同意行的重试事件,重建实测 2006→2012。
  // 2026-09-17 发布版本 release-0917 再合 fix-consent:合并树 2015 + consentchange/consentretry 事件合同 +6 ⇒ 重建实测 2021。
  // 2026-09-17 预制人生四玩法 + R14 检定一屏 + 梦块/插入变量:按 audit:actions:update 重建实测
  //   2021→2081(+60,逐文件对账:temp 编辑器 +37、分发器四个新分支的事件合同 +10、
  //   typein +4、note/profile/fabu 各 +2、journey-check/photocheck/play-index 各 +1;净删 0)。
  // 2026-09-18 photoCheck 接真视觉:同上,temp 事件合同 +1(见 tap 那条的说明)。
  // 2026-09-18 present:local event-contract 2082→2083(内嵌骰子的事件合同 +1)。
  // 2026-09-18 C8-05 主办方取消主题:我的项目新增 #dcCancelTopic 的 bind:confirm 事件合同 +1 ⇒ rebase 到 #1091 后重建实测 2083。
  // 2026-09-18 合并后重建实测:两侧增量各自成立 ⇒ 2084。
  // 2026-09-18 FIX-P3:3-18 任务列表 bind:official +1、3-24 三个 poi-detail 宿主补 bind:citystamp +3
  //   (本分支侧 2021 → 2025);rebase 到 github/master 后两侧增量合并,事件合同数按
  //   audit:actions:update 重建实测重取。
  // 2026-09-18 FIX-P3:3-18 三个任务列表宿主 bind:official +3、3-24 三个 poi-detail 宿主补
  //   bind:citystamp +3(本分支侧 2021 → 2027);rebase 到已含 #1088 的 github/master 后
  //   两侧增量合并 ⇒ 按 audit:actions:update 重建实测 2084→2090。
  // 2026-09-18 rebase #1072 到 master(3cce66ab0):publish-sheet 的轮播/拖拽四条事件合同
  //   (onTouchStart/onTouchMove/onTouchEnd/onSwiperChange)退场、遮罩改两条 catchtouchmove,
  //   取重建实测 2083 → 2082。
  // 2026-09-18 合并两侧后重建实测:master 侧 2090 叠加 #1072 净 −1 ⇒ 2089,按 audit:actions:update 实算。
  // 2026-09-19 并入 fix/audit-wiring-202609 侧账目(其自报值基线不同,以合并树重建实测为准):
  // (本支) 2026-09-18 批3D 高频主 CTA 接 bind:disabledtap 引导 + 批1B topic-detail 胶囊实测:重建实测
  // (本支) event-contract 1983 → 1995(+13 −1)—— 加 13:十张表单主 CTA 的 bind:disabledtap
  // (本支) (temp 查看预览 / fabu 发布 / step3 存票种 / activity 两处 / merchantapply 两处
  // (本支) templatedetail 两处 / tixian / earnings / addressinfo / merchant-apply);
  // (本支) 减 1:同批行位平移后 topic-detail 一条 cy-error 的 bind:retry 被判 external 出了 local。
  // (本支) 2026-09-18 死事件接线批(fix/audit-wiring-202609):event-contract 1986 → 1983(净 −3) ——
  // (本支) 减:组件从不 emit 的僵尸 bind:open 共 9 条(scene-deep-link×2、activity/detail、
  // (本支) merchant/index、play、roam、member-order×2、orderinfo)+ 空实现 onScrollReachBottom
  // (本支) 的 bindscrolltolower 1 条;
  // (本支) 加:bind:citystamp×3(play/roam/merchant 三处接上城市印章跳转)、bind:transferowner×3
  // (本支) (scene-route-content 壳 + club/detail + club/edit)、bind:alt×1(merchantinfo 危险弹层退路)。
  // (本支) 2026-09-16 编辑页按原型重排:event-contract 1984 → 1986(+2)。两颗都是 cy-switch ——
  // (本支) 「同步到模板广场」(字段与 switch1Change 早就在,一直没有入口)与问答的「次数用完亮答案」
  // (本支) (服务端早就认这个开关,编辑页也一直没有入口)。竞猜揭晓时间那两颗走 cy-dropdown,同属这一档。
  // (本支) 2026-09-19 批复1-a=2:partner 页复活带回 4 条事件合同(back/cta×2/retry),2100 → 2104。
  // 2026-09-22 同批:free-map / cy-play-roadmap / 地点卡 swiper 等组件事件随层退场,
  //   event-contract 2160 → 2156(audit:actions:update 重建实测)。
  // (本支) 2026-09-22 分类器修 A+B+C:那 41 个转入 external 的控件里有 10 条是组件事件合同
  //   (另 31 条是 tap),故 2162 → 2152。两处相加正好 41,与 actionClass 实测差分一致。
  // (本支) 2026-09-22 现场感 S1 取景对齐:页内取景层的两条降级线各是一条 binderror 合同 ——
  //   camera 起不来(onFrameError,回落 chooseMedia)与轮廓图加载失败(onOutlineError,只藏那条线)。
  //   两条都不新增真点击(快门/退出取景那两颗已计入 tap 分母)。2160 → 2162(重建实测)。
  // 2026-09-22 现场感三件套 S2 罗盘指向:+12 条事件合同(罗盘组件 run/verdict/back 三条、
  //   playkit 分发器转接 submit/verdict/close 三条、创作端罗盘段开关与字段 bindinput/bindchange 六条)。
  //   2162 → 2174(重建实测)。
  // (本支) 2026-09-22 合 master(#1139/#1141/#1144/#1145/#1146 现场感与玩法批)后按合并树重建。
  //   三项均严格可加,可作为合并自洽的佐证:base 4254 + 本支 6 + master 21 = 4281;
  //   tap 1787 - 28(本支分类器修好后 41 个控件转 external)+ 4 = 1763;
  //   event-contract 2160 - 6 + 14 = 2168。数字取自重建实测,非推算。
  // 2026-09-22 rebase 到最新 master 后按合并树重建实测(本分支删掉的从 master 新基数上减)。
  // (本支) 2026-09-22 S3b 喊一嗓子:playkit-shout 组件 5 条 + 分发器 shout 分支 4 条 +
  //   编辑页 shout 段(开关 + 标题/时长/奖励分)4 条 ⇒ 合并树基数 2164 → 2177(重建实测)。
  // 2026-09-22 阶段 5 条件修正 mods:updateModField 的 4 个 bindinput 入口(label / when.var / when.value / value)
  //   归 event-contract,2177 → 2181(重建实测)。4 个 tap 见上面的 tap 分母。
  // 2026-09-22 编辑页单选统一下拉:9 个 cy-dropdown bind:change 进本分母(重建实测)。
  // 2026-09-23 检定段改「开关 + 下拉」:旧 updateModField 4 个 bindinput 出;难度、两组写入方式、幸运开关+档位、
  //   生命开关、放宽开关+方式共 8 个进 ⇒ 2190 → 2194(重建实测)。
  // 2026-09-23 ComputerUse 走查修复:+2 事件合同(俱乐部资料保存失败「继续编辑」bind:secondary / 客户筛选空态「查看全部客户」bind:cta),2194 → 2196(重建实测)。
  // 同日 CU-C-23:取消活动预检被拒面板加「重新检查」bind:retry=openCancel,2196 → 2197(重建实测)。
  // 2026-09-24 #1165 rebase 到 #1159 之后:fabu 票种退款开关改只读规则文案 -1 事件合同。2197 → 2196(重建实测)。
  // 2026-09-24 走查第二轮(CU 110 条,rebase 到 #1165 之后)按最终树重建实测:事件合同 2196 → 2207。
  // 2026-09-24 B 扫码显形真 AR:+18 条事件合同(相机 bindscancode / binderror、创作端显形图占比 slider 与识别图输入、
  //   AR 方式下拉 bind:change、xr-scene 与 tracker 场景事件、宿主 arerror/found/placed/tracked/landed),2207 → 2225(重建实测)。
  // 2026-09-25 邀约重试 +2、只读开关 -1;本地事件合同 2225→2226。
  assert.equal(local.filter((item) => item.interactionMode === 'event-contract').length, 2262)  /* 2026-09-20 门店分身对话输入与关闭事件接线后按最终树重建实测。 */  /* 2026-09-20 合批收口:工作区实名接线批 + 底栏 v8 把组件事件/disabledtap 接进台账,本地合同净增 20 条 ⇒ 2107→2127 按最终树重建实测 */  /* 2026-09-19 收口批+开表接线落 master(经 #1115/#1117):41d21a41e 玩法开表三控件进合同,2104→2107 按最终树重建实测 */  // 2026-09-12 rebase #1068/#1070 后重建：接力签 1963；审核收口后 1963→1968。
  // 商家承接接入 cy-date-range-sheet 后新增 confirm / cancel 两条事件合同，1662 → 1664。
  // 合作页将会话失效与无权限拆为两个 cy-empty CTA，新增 goLogin / goWorkbench 两条事件合同，1664 → 1666。
  //   带一个 bind:cta 首发引导(+1),净 -2;同批新增两条 cy-state-shell 的 bind:primary
  //   (未登录/无权限拆开各一条,+2)—— 合计 1584 → 1583。
  // 2026-08-26 全端「有旧内容时的刷新失败横幅」退役:cy-inline-error 用点 132 → 84(−48),带 bind:action 重试入口的净减 47(商家工作台补回一个首屏 cy-error 重试)  // 2026-08-25 +17:17 页接上 cy-privacy-gate,各多一个 bind:settled 事件合同;同日删「圈层自由探索」两处 cy 组件事件、新增图像来源页 +1;2026-08-26 v5.1 新玩法九个壳向 cy-playkit 上抛事件、分发器再上抛给 play 页,1596 → 1630
})

test('external 分支按微信能力定义，振动不伪造取消/拒权，选择器必须覆盖取消/拒权', () => {
  assert.deepEqual(requiredBranchesFor('external', 'state', ['vibrateShort']), [
    'success', 'error', 'timeout', 'duplicate-trigger',
  ])
  assert.deepEqual(requiredBranchesFor('external', 'state', ['chooseLocation']), [
    'success', 'error', 'timeout', 'duplicate-trigger', 'cancelled', 'denied',
  ])
  assert.deepEqual(requiredBranchesFor('external', 'state', ['getLocation', 'chooseMedia']), [
    'success', 'error', 'timeout', 'duplicate-trigger', 'cancelled',
    'getLocation-denied', 'chooseMedia-denied',
  ])
  assert.deepEqual(requiredPlatformsFor('external'), ['ios', 'android'])
  assert.deepEqual(requiredPlatformsFor('state'), [])
})

test('漫游拍照启动的取消事实必须绑定 chooseMedia，不能由定位能力冒充', () => {
  const control = buildLedger().controls.find((item) => item.entry.js === 'pages/roam/index.js'
    && item.control.handler === 'goStartAndShoot')
  assert.ok(control)
  assert.equal(control.requiredCapabilityByBranch.cancelled, 'chooseMedia')
})

test('持久化 authority/requestTrace 必须与控制面签名 facts 等值', () => {
  const receipt = {
    request: { method: 'POST', url: '/api/test/save', resourceId: '42', authMode: 'jwt' },
    accessScope: { principalFingerprint: 'sha256:p', scope: 'self' },
    authority: { endpoint: '/api/test/save/42', resourceId: '42', before: { v: 0 }, after: { v: 1 } },
    mapping: { matched: true, paths: ['saved'] }, timeoutResolution: undefined,
  }
  const facts = {
    request: receipt.request,
    accessScope: receipt.accessScope,
    authority: { endpoint: receipt.authority.endpoint, resourceId: '42', fact: { v: 1 } },
    mapping: receipt.mapping,
    timeoutResolution: undefined,
    requestTrace: [{ requestId: 'signed-request' }],
  }
  assert.doesNotThrow(() => assertSignedAuthorityFacts(receipt, 'after', facts, facts.requestTrace))
  assert.throws(() => assertSignedAuthorityFacts(
    receipt, 'after', facts, [{ requestId: 'tampered-request' }],
  ), /requestTrace 与签名 facts 不一致/)
  const beforeFacts = {
    request: receipt.request,
    accessScope: receipt.accessScope,
    authority: { endpoint: receipt.authority.endpoint, resourceId: '42', fact: { v: 0 } },
  }
  assert.doesNotThrow(() => assertSignedAuthorityFacts(receipt, 'before', beforeFacts))
  assert.throws(() => assertSignedAuthorityFacts(
    receipt, 'before', { ...beforeFacts, requestTrace: facts.requestTrace },
  ), /before 不得伪造/)
})

test('真机签名必须覆盖逐分支 readback，人工篡改 pending URL 必须变红', () => {
  const branches = [{
    name: 'getLocation-denied', captureId: 'capture-ios',
    capturedAt: '2026-08-21T12:00:30Z',
    readback: { observed: { pendingCompletionPhotoUrl: 'https://cdn.example/a.jpg' } },
  }]
  const signed = deviceBranchReadbackDigests(branches)
  assert.doesNotThrow(() => assertSignedDeviceBranchFacts(signed, branches))
  const tampered = JSON.parse(JSON.stringify(branches))
  tampered[0].readback.observed.pendingCompletionPhotoUrl = 'https://cdn.example/forged.jpg'
  assert.throws(() => assertSignedDeviceBranchFacts(signed, tampered), /签名 facts 不一致/)
  const retimed = JSON.parse(JSON.stringify(branches))
  retimed[0].capturedAt = '2026-08-21T13:00:30Z'
  assert.throws(() => assertSignedDeviceBranchFacts(signed, retimed), /签名 facts 不一致/)
  assert.throws(() => assertSignedDeviceBranchFacts(null, branches), /缺少逐分支/)
})

test('真机 capture 的签名起点也必须在 freshness 窗内，不能只刷新 unsigned 结束时间', () => {
  const now = Date.parse('2026-08-21T12:00:00Z')
  const maxAge = 72 * 60 * 60 * 1000
  assert.doesNotThrow(() => assertDeviceCaptureWindow({
    capturedAt: '2026-08-21T10:00:00Z', completedAt: '2026-08-21T10:30:00Z',
  }, now, maxAge))
  assert.throws(() => assertDeviceCaptureWindow({
    capturedAt: '2026-08-10T10:00:00Z', completedAt: '2026-08-21T10:30:00Z',
  }, now, maxAge), /过期/)
  assert.throws(() => assertDeviceCaptureWindow({
    capturedAt: '2026-08-21T01:00:00Z', completedAt: '2026-08-21T10:30:00Z',
  }, now, maxAge), /超过 4 小时/)
  assert.throws(() => assertDeviceCaptureWindow({
    capturedAt: '2026-08-21T10:00:00Z', completedAt: '2026-08-21T10:30:00Z',
  }, now, Number.NaN), /时间窗/)
  assert.equal(evidenceMaxAgeMs('72'), maxAge)
  assert.throws(() => evidenceMaxAgeMs('not-a-number'), /有限正数/)
  assert.throws(() => evidenceMaxAgeMs('0'), /有限正数/)
  assert.throws(() => evidenceMaxAgeMs('1e308'), /有限正数/)
  const previous = process.env.ACTION_EVIDENCE_MAX_AGE_HOURS
  process.env.ACTION_EVIDENCE_MAX_AGE_HOURS = 'invalid'
  try {
    assert.match(validateEvidenceOverlay(ledger, { schemaVersion: 1, results: {} }).join('\n'), /有限正数/)
  } finally {
    if (previous == null) delete process.env.ACTION_EVIDENCE_MAX_AGE_HOURS
    else process.env.ACTION_EVIDENCE_MAX_AGE_HOURS = previous
  }
})

test('external success 只要求主能力，不把拒权恢复 openSetting 合并成同一路径', () => {
  const control = buildLedger().controls.find((item) => item.entry.wxml === 'pages/merchant/apply/index.wxml'
    && item.control.handler === 'chooseLocation')
  assert.ok(control)
  assert.ok(control.externalCapabilities.includes('chooseLocation'))
  assert.ok(control.externalCapabilities.includes('openSetting'))
  assert.ok(control.successCapabilities.includes('chooseLocation'))
  assert.equal(control.successCapabilities.includes('openSetting'), false)
})

test('互斥 CTA 路径拆成独立 variant，不用一次扫码冒充关注与漫游', () => {
  const controls = buildLedger().controls.filter((item) => item.entry.wxml === 'components/cy/profile/index.wxml'
    && item.control.handler === 'onPrimaryCta')
  assert.deepEqual(controls.map((item) => item.variant.id).sort(), ['self-merchant-scan', 'visitor-follow'])
  const follow = controls.find((item) => item.variant.id === 'visitor-follow')
  const scan = controls.find((item) => item.variant.id === 'self-merchant-scan')
  assert.deepEqual(follow.variant.predicate, { isSelf: false, subjectIsMerchant: false })
  assert.equal(follow.variant.predicateScope, 'component')
  assert.equal(follow.variant.componentHostSelector, '#profile')
  assert.deepEqual(follow.targets.primaryApis, ['/api/user/follow/action'])
  assert.equal(follow.actionClass, 'write')
  assert.deepEqual(scan.variant.predicate, { isSelf: true, isMerchantView: true })
  assert.deepEqual(scan.externalCapabilities, ['scanCode'])
})

test('动作分类追踪本文件调用闭包，不能漏掉间接微信外部能力', () => {
  const slices = new Map([
    ['chooseLocation', 'if (ok) that.openLocationPicker()'],
    ['openLocationPicker', 'wx.chooseLocation({ success() {} })'],
  ])
  const expanded = expandHandlerBody('chooseLocation', slices)
  assert.match(expanded, /wx\.chooseLocation/)
  assert.equal(inferActionClass('chooseLocation', expanded), 'external')
})

test('动作分类追踪 app 全局 helper，图片选择不能落回本地 state', () => {
  const helpers = discoverExternalHelperNames([path.join(__dirname, '../../app.js')])
  assert.equal(helpers.has('chooseImage'), true)
  assert.equal(inferActionClass('pageLocal', 'this.chooseImage()', helpers), 'other',
    'Page 本地同名方法不能冒充 App 外部能力')
  assert.equal(inferActionClass('appWrapper', 'app.chooseImage()', helpers), 'external')
  assert.equal(inferActionClass('getAppWrapper', 'getApp().chooseImage()', helpers), 'external')
  // 2026-09-03 换锚:入职流重做把封面/头像从建团表单挪进「编辑资料」
  //   (稿的原话是「头像和封面可以之后在编辑资料里补」),create 页不再有 chooseCover。
  //   锚点跟着功能走 —— scene-club-edit 的 pickCover 是同一条 app.chooseImage() 路径,
  //   这条断言要证的「App 全局 helper 必须判 external + 真机门」一字未改。
  const control = ledger.controls.find((item) => item.entry.js === 'components/cy/scene-club-edit/index.js'
    && item.control.handler === 'pickCover')
  assert.ok(control)
  assert.equal(control.actionClass, 'external')
  assert.equal(control.externalGate, 'real-device-required')

  const localReload = ledger.controls.find((item) => item.entry.js === 'pages/merchant/index/index.js'
    && item.control.handler === 'reloadConsole')
  assert.ok(localReload)
  assert.notEqual(localReload.actionClass, 'external', '其它页面同名 onShow 不得被 App helper 全局串线')
})

test('用户授权与系统能力必须进入真机门，不能伪装成本地 state/write', () => {
  assert.equal(inferActionClass('openPrivacyContract', 'wx.openPrivacyContract({})'), 'external')
  assert.equal(inferActionClass('subscribe', 'wx.requestSubscribeMessage({tmplIds: []})'), 'external')
  assert.equal(inferActionClass('pickPoi', 'wx.choosePoi({})'), 'external')
  assert.equal(inferActionClass('pickAddress', 'wx.chooseAddress({})'), 'external')
  assert.equal(inferActionClass('startTracking', 'wx.startLocationUpdateBackground({})'), 'external')
})

test('传感器、相机与微信身份能力必须进入真机门', () => {
  assert.equal(inferActionClass('startTracking', 'wx.startLocationUpdate({})'), 'external')
  assert.equal(inferActionClass('stopTracking', 'wx.stopLocationUpdate({})'), 'external')
  assert.equal(inferActionClass('tapFeedback', 'wx.vibrateShort({})'), 'external')
  assert.equal(inferActionClass('openCamera', 'wx.createCameraContext()'), 'external')
  assert.equal(inferActionClass('loginNow', 'wx.login({})'), 'external')
  assert.equal(inferActionClass('preview', 'wx.previewImage({urls: []})'), 'external')
  assert.equal(inferActionClass('copy', "wx.setClipboardData({data: 'x'})"), 'external')
  assert.equal(inferActionClass('play', 'wx.createInnerAudioContext()'), 'external')
  assert.equal(inferActionClass('share', 'wx.showShareMenu({})'), 'external')
  assert.equal(inferActionClass('keepAwake', 'wx.setKeepScreenOn({keepScreenOn: true})'), 'external')
})

test('App 登录续期不能把全部 sendRequest 读写动作污染成真机能力', () => {
  const helpers = discoverExternalHelperNames([path.join(__dirname, '../../app.js')])
  assert.equal(inferActionClass('loadList', "app.sendRequest({url:'/api/list'})", helpers), 'read')
})

test('写操作与动态 URL 合同不能降级成普通读取', () => {
  const rebuilt = buildLedger()
  // 2026-08-30:三段式确认把「点按钮」和「真发请求」拆成两个控件 ——
  //   onDeletePost        第一段,只 dc.open(),不发请求 ⇒ 台账里 apis 为空、class=other
  //   onConfirmDeletePost 第二段,由 <cy-danger-confirm bind:confirm> 绑定,真发请求 ⇒ write
  // 写门禁的代表动作要落在**第二段**。两段都是 WXML 绑定的控件,所以覆盖没丢
  // (确认这一点花了点功夫:只看第一段 apis 为空,很容易误判成「掉出写门禁」)。
  ;['onConfirmDeletePost', 'onSubmit', 'assignRole', 'onConfirmRevokeRole', 'declineApply',
    'onConfirmKick', 'onConfirmDisband'].forEach((handler) => {
    const controls = rebuilt.controls.filter((item) => item.control.handler === handler && item.targets.primaryApis.length)
    assert.ok(controls.length > 0, `缺少 ${handler} 代表动作`)
    assert.ok(controls.every((item) => item.effectClasses.includes('write')), `${handler} 未进入 write 门禁`)
  })
  // team/detail 的 kick/disband/quit 已并入上面的三段式 pair 表(write 落在确认段)。
  // 这里只补 pair 表没覆盖的一条:第一段必须真的能被用户取消。
  ;['kick', 'disband', 'quit'].forEach((handler) => {
    const control = rebuilt.controls.find((item) => item.entry.js === 'pages/team/detail/index.js'
      && item.control.handler === handler)
    assert.ok(control, `缺少 team/detail ${handler}`)
    assert.ok(control.requiredBranches.includes('modal-cancelled'),
      `team/detail:${handler} 少了「用户点取消」分支 —— 没有它,确认闸只是装饰`)
  })
  /* ★三段式确认的结构契约(2026-08-30)
   *
   * 形状:第一段只 dc.open() 弹确认;第二段由 <cy-danger-confirm bind:confirm> 绑定、真发请求。
   * 两段都是 WXML 绑定的控件,所以写门禁**没有丢覆盖** —— 只是从第一段挪到了第二段。
   *
   * ⚠️ 少了这条契约,把第二段整个删掉(点一下直接删、确认框成摆设)不会有任何门禁变红:
   *    第一段本来就 apis 为空,删掉第二段只是让台账少一条,没有断言会注意到。
   */
  ;[
    ['pages/club/detail/index.js', 'onDeletePost', 'onConfirmDeletePost', '/api/club/post/delete', 'owned-resource'],
    ['pages/club/detail/index.js', 'onDeleteComment', 'onConfirmDeleteComment', '/api/club/post/comment/delete', 'owned-resource'],
    ['pages/club/roles/index.js', 'revokeRole', 'onConfirmRevokeRole', '/api/club/roles/revoke', 'owned-resource'],
    ['pages/team/detail/index.js', 'kick', 'onConfirmKick', '/api/team/kick', 'owned-resource'],
    ['pages/team/detail/index.js', 'disband', 'onConfirmDisband', '/api/team/disband', 'owned-resource'],
    ['pages/team/detail/index.js', 'quit', 'onConfirmQuit', '/api/team/quit', 'self'],
  ].forEach(([js, opener, confirmer, api, boundary]) => {
    const first = rebuilt.controls.find((i) => i.entry.js === js && i.control.handler === opener)
    const second = rebuilt.controls.find((i) => i.entry.js === js && i.control.handler === confirmer)
    assert.ok(first, `${js}:${opener} 不在台账里 —— 第一段没绑到控件上?`)
    assert.ok(second, `${js}:${confirmer} 不在台账里 —— 第二段必须由 <cy-danger-confirm bind:confirm> 绑定,`
      + '否则真正发请求的那一段就脱离了写门禁')
    assert.equal(first.confirmationMode, 'cy-danger-confirm', `${js}:${opener} 第一段必须挂确认闸`)
    assert.equal(first.targets.primaryApis.length, 0,
      `${js}:${opener} 是确认段,不该自己发请求 —— 发了就说明确认闸可以被绕过,`
      + `实际 ${JSON.stringify(first.targets.primaryApis)}`)
    assert.ok(second.effectClasses.includes('write'), `${js}:${confirmer} 未进入 write 门禁`)
    assert.equal(second.baseActionClass, 'write', `${js}:${confirmer} 基础动作类必须是 write`)
    assert.equal(second.accessBoundary, boundary,
      `${js}:${confirmer} 越权边界应为 ${boundary},实际 ${second.accessBoundary}`)
    assert.ok(second.targets.primaryApis.includes(api),
      `${js}:${confirmer} 应当携带 ${api},实际 ${JSON.stringify(second.targets.primaryApis)}`)
  })

  const wizardNext = rebuilt.controls.find((item) => item.entry.js === 'pages/club/apply/index.js'
    && item.control.handler === 'onNext')
  assert.ok(wizardNext)
  assert.equal(wizardNext.confirmationMode, null)
  const favorite = rebuilt.controls.find((item) => item.control.handler === 'toggleFavorite')
  assert.ok(favorite && favorite.effectClasses.includes('write'))
  assert.ok(favorite.targets.apiContracts.some((item) => item.url === '/api/city/nodes/{param}/favorite'
    && item.method === 'POST'))
  assert.equal(rebuilt.controls.filter((item) => item.effectClasses.some((kind) => kind === 'read' || kind === 'write')
    && item.targets.primaryApis.length === 0).length, 0)
  assert.equal(rebuilt.controls.flatMap((item) => item.targets.apiContracts).filter((item) => !item.method).length, 0)

  // 2026-09-03:官方活动改由 Web 后台上传,小程序端的发起面板(pubOnSubmit / _pubPostJson /
  // /api/official/publish|broadcast)整块删除,这两条断言随功能一起退役。
  // 「包装器必须保留 POST 真源」这层保障由下面 my-completed 那组继续守着。
  ;['reloadProfileMetrics', 'loadOverview'].forEach((handler) => {
    const controls = rebuilt.controls.filter((item) => item.control.handler === handler
      && item.targets.primaryApis.includes('/api/play/my-completed'))
    assert.ok(controls.length > 0, `缺少 ${handler} my-completed 合同`)
    assert.ok(controls.every((item) => item.targets.apiContracts.some((contract) => contract.url === '/api/play/my-completed'
      && contract.method === 'POST')), `${handler} 必须继承本地 request wrapper 的 POST`)
  })
})

test('前端 API method 必须与后端 Controller annotation 真源一致', () => {
  const rebuilt = buildLedger()
  const server = serverApiContracts()
  const conflicts = rebuilt.controls.flatMap((control) => control.targets.apiContracts.map((contract) => ({ control, contract })))
    .filter(({ contract }) => server.has(contract.url) && !server.get(contract.url).has(contract.method))
  assert.deepEqual(conflicts, [])
  const scan = rebuilt.controls.find((item) => item.variant && item.variant.id === 'self-merchant-scan')
  assert.ok(scan.targets.apiContracts.filter((item) => /verification|scan_/.test(item.url))
    .every((item) => item.method === 'POST' && item.source === 'server-controller'))
})

test('结算 CTA 按同意与报价就绪态穷尽真实请求链，报价失败不能伪装成直接建单', () => {
  const controls = buildLedger().controls.filter((item) => item.entry.js === 'pages/activity/baoming/baoming.js'
    && item.control.handler === 'handlePayment' && item.control.event === 'bindtap')
  assert.equal(controls.length, 6)
  const paid = controls.filter((item) => /-paid-/.test(item.variant.id))
  assert.equal(paid.length, 4)
  assert.equal(paid.filter((item) => item.variant.predicate.quoteReady === true).length, 2)
  assert.equal(paid.filter((item) => item.variant.predicate.quoteReady === false).length, 2)
  const pending = paid.find((item) => item.variant.id === 'solo-paid-consent-pending-quote-pending')
  assert.deepEqual(pending.requiredRequests.slice(0, 3).map((item) => item.urlTemplate), [
    '/api/compliance/consents', '/api/registration/quote', '/api/registration/create',
  ])
  assert.deepEqual(pending.requiredRequestOutcomes['quote-error-then-create-error'], ['success', 'error', 'error'])
  assert.equal(pending.requiredCapabilityByBranch['payment-cancelled'], 'requestPayment')
})

test('按钮台账不把定位回调的 reveal 或 GET ending 冒充当前点击的第二次写入', () => {
  const rebuilt = buildLedger()
  assert.equal(rebuilt.controls.filter((item) => (item.targets.writeApis || []).length > 1
    && !(item.requiredRequests || item.requiredRequestsByBranch)).length, 0)
  const playEnding = rebuilt.controls.filter((item) => item.targets.primaryApis.includes('/api/play/ending'))
  assert.ok(playEnding.length > 0)
  assert.ok(playEnding.every((item) => !(item.targets.writeApis || []).includes('/api/play/ending')))
  const roamHandlers = new Set(['goStart', 'goStartAndShoot', 'onFogScreenLoad', 'verifyEventArrival', 'onGoalTap', 'toggleGps'])
  assert.ok(rebuilt.controls.filter((item) => item.entry.js === 'pages/roam/index.js'
    && roamHandlers.has(item.control.handler)).every((item) => !item.targets.primaryApis.includes('/api/roam/reveal')))
})

test('评价举报与团队危险操作按页面状态拆成互斥单写 variant', () => {
  const rebuilt = buildLedger()
  const reports = rebuilt.controls.filter((item) => item.entry.js === 'pages/merchant/reviews/index.js'
    && item.control.handler === 'submitReport')
  assert.deepEqual(reports.map((item) => item.variant.id).sort(), ['manage', 'public'])
  const reportsByVariant = Object.fromEntries(reports.map((item) => [item.variant.id, item]))
  assert.deepEqual(reportsByVariant.manage.variant.predicate, { mode: 'manage' })
  assert.deepEqual(reportsByVariant.public.variant.predicate, { mode: { $not: 'manage' } })
  assert.deepEqual(reportsByVariant.manage.requiredRequests.map((request) => request.urlTemplate),
    ['/api/merchant/reviews/manage/report'])
  assert.deepEqual(reportsByVariant.public.requiredRequests.map((request) => request.urlTemplate),
    ['/api/merchant/reviews/report'])

  const dangers = rebuilt.controls.filter((item) => item.entry.js === 'pages/merchant/team/index.js'
    && item.control.handler === 'confirmDanger')
  assert.deepEqual(dangers.map((item) => item.variant.id).sort(), ['invite', 'operator'])
  const dangersByVariant = Object.fromEntries(dangers.map((item) => [item.variant.id, item]))
  assert.deepEqual(dangersByVariant.operator.variant.predicate, { 'dangerConfirm.type': 'operator' })
  assert.deepEqual(dangersByVariant.invite.variant.predicate, { 'dangerConfirm.type': { $not: 'operator' } })
  assert.deepEqual(dangersByVariant.operator.requiredRequests.map((request) => request.urlTemplate),
    ['/api/merchant/operators/remove'])
  assert.deepEqual(dangersByVariant.invite.requiredRequests.map((request) => request.urlTemplate),
    ['/api/merchant/operators/invite/revoke'])
})

test('当前用户关系写不伪造 forbidden-owner，组件动作必须声明真实宿主页', () => {
  const rebuilt = buildLedger()
  const favorite = rebuilt.controls.find((item) => item.control.handler === 'toggleFavorite')
  assert.ok(favorite)
  assert.equal(favorite.accessBoundary, 'self')
  assert.doesNotMatch(favorite.requiredBranches.join(','), /forbidden-owner/)

  const components = rebuilt.controls.filter((item) => item.route.startsWith('component:'))
  assert.ok(components.length > 0)
  assert.equal(components.filter((item) => !Array.isArray(item.hostRoutes) || item.hostRoutes.length === 0).length, 0)
  assert.equal(components.filter((item) => !Array.isArray(item.hostComponentPaths)
    || item.hostComponentPaths.length === 0).length, 0)
})

test('服务端写入叠加设备能力时同时保留两类验收事实', () => {
  const control = buildLedger().controls.find((item) => item.id.includes('pages/privacy/index.wxml')
    && item.control.handler === 'withdrawRoamLocationConsent')
  assert.ok(control)
  assert.equal(control.actionClass, 'external')
  assert.equal(control.baseActionClass, 'write')
  assert.deepEqual(control.externalCapabilities, ['stopLocationUpdate'])
  assert.match(control.expectedReadback, /服务端/)
  assert.match(control.expectedReadback, /真机/)
  assert.deepEqual(control.requiredBranches, [
    'success', 'error', 'timeout', 'duplicate-trigger',
  ])
  assert.equal(control.accessBoundary, 'self')
  assert.deepEqual(control.requiredPlatforms, ['ios', 'android'])
})

test('Beta 转正式按作者归属写操作验收，不能误归只读', () => {
  const control = buildLedger().controls.find((item) => item.control.handler === 'onGraduateBeta')
  assert.ok(control)
  assert.equal(control.actionClass, 'write')
  assert.equal(control.baseActionClass, 'write')
  assert.equal(control.accessBoundary, 'owned-resource')
  assert.ok(control.requiredBranches.includes('forbidden-owner'))
  assert.deepEqual(control.targets.writeApis, ['/api/topic/beta/graduate'])
})

test('4382 个可达动作 variant 全部进入台账且 handler 真源可定位', () => {
  const rebuilt = buildLedger()
  assert.equal(rebuilt.schemaVersion, 7, '并发请求 trace、结算状态 variant 与后端 method 真源变更后必须升级 inventory schema')
  // 商家/俱乐部补全基线 3187；主线详情重做与管理员治理入口净增 9 个 variant。
  // 2026-08-26 状态补全:五个新页各多一条「无权限/网络失败」空态或错误态入口。
  // 2026-08-26 日期区间组件接线:cy-calendar + cy-date-range-sheet 两个新组件的可达入口
  //   (日历格子、三个快捷芯片、清除、确定)减去 activity/list 少掉的那个 date-field 触发器,
  //   净增 8 个 variant,3201 → 3209。
  // 2026-08-26 Figma 组件库 v5.1/v5.2 落地:九个玩法壳经 cy-playkit 分发 + 木鱼氛围件 +
  // AI 参考分卡 + 节点卡玩法入口,连同各壳内部的选项/分类/贴纸/CTA 一并进台账。3201 → 3252。
  // 2026-08-26 时段组件接线:cy-time-range 的入口与两处滚轮 variant,减去 game-node /
  //   play/celebrate 各少掉的 cy-date-field 触发器。在 v5.1 的 3252 基础上 → 3258。
  // 同上两个圈层入口,加上 L2 分类标签行的「推荐」项。3205 → 3208。
  // 2026-08-26 时段组件接线,3208 → 3214。
  // 2026-08-26 日期区间组件接线,3208 → 3216。
  // 2026-08-26 时段组件接线。3216 → 3222。
  // 2026-08-27 营销页窗口切换失败态:经营事件区新增「点击重试」错误位。3222 → 3223。
  // 2026-08-27 v5.1 玩法配置补齐 + 货架「配置」入口:再 +43(3223 → 3266),只落在两条路由 ——
  //   pages/publish/temp/index +41:七段新玩法的开关、字段与三组增删项编辑器
  //     (盲品选项 / 备选名 / 签文池);
  //   pages/template/index +2:卡片从一钮变两钮(主钮「配置」+ 次钮「用模板」),
  //     置顶列表与其余列表各一处。
  // ★ 与 #882 的合并:两侧从同一基线 3222 各自抬数(本 PR +43 / #882 +1),合并后取并集。
  // 2026-08-27 cy-timeline 状态时间线新建:+3(3266 → 3269)——
  //   component:components/cy/timeline/index +2(折叠头 onToggle / 操作钮 onAction),
  //   pages/club/detail/index +1(承接组件 bind:toggle 的 onLeadTimelineToggle 事件合同)。
  //   merchant/citynode/create 用的是不可折叠的横向形态,没有新入口。
  // 2026-08-27 精准停表两页:模板行(开一局/删除/开关)、行内新建(±秒/三种隐藏模式/取消/保存/
  //   新建入口)、下一局开始、玩一局主键,合计 11 个可点入口。同为并集:3269 → 3280。
  // 2026-08-28 发布表单错误清除与既有空态出口接入共享组件，重建台账实测 3269 → 3280。
  // 2026-08-27 cy-time-range 换掉原生滚轮:两条 picker-view 的 bindchange 退场,
  //   换来两块调节器各 4 条触摸事件(start/move/end/cancel)+ 各 2 个 ± 按钮 ——
  //   该组件 4 → 14 个 variant,净增 10,3266 → 3276。
  // 2026-08-29 剧情付费墙、帖文卡收敛、口碑评价页与清理已批准删改项同轮 rebase 后，
  //   audit:actions:update 重建台账实测为 3254。
  // 2026-08-30 首页推荐主题 swiper 新增 transition/change 两条事件合同，3265 → 3267。
  // 2026-08-30 官方活动详情只新增滚动导航状态事件，3267 → 3268；活动介绍卡为只读展示。
  // 本轮净增 3 个 variant:承接日期区间入口/确认/取消 +3；入驻重复返回 -1；
  // 搜索主题与其它结果拆成互斥点击 +1；合作页新增会话失效/无权限两个独立 CTA；
  // 最终界面补齐可达入口后，动作账本重建实测 3279。
  // 2026-08-30 客户页与主题客户抽屉收口后，重建实测 3280。
  // 3342 → 3336:apply -3、create -3,两页都在本 PR 内,无其它页漂移。
  // 3336 → 3349:上面四处合计 +13,全在本 PR 内,无其它页漂移。
  // 3349 → 3375:旧 game-director 页 32 个控件归零,topic-detail 8→37,
  //   十个 club-director-* 组件从「无人引用」变成被扫到(+24)。净 +21。
  /* 2026-09-07 coop/list 三个新控件 = 3356 */
  /* 2026-09-07 D8 现场事件接线:选事件 / 选方式 两条组件事件 = 3358 */
  /* 2026-09-07 E1 日期清单展开钮 = 3359 */
  /* 2026-09-07 J4 主题设置 + J3 招商台两张弹层 = 3372 */
  /* 2026-09-07 J7 商家 / J2 客户 / J8 规则三张弹层 = 3379 */
  /* 2026-09-08 按「00 流程与弹层规则 · 读我」收编:招商台与设置招募条件两张弹层整体删除
  // 并 master 前它那边是:(读我的入口表里没有它们),J7 商家 + J2 客户合并成一个两 tab 的 T1。
  // 并 master 前它那边是:增减全部落在 pages/club/topic-detail/index.wxml,已逐条比对台账 id 确认无其它页漂移。 */
  /* 2026-09-08 +11:pages/coop/invite-detail 新页(02d 协作详情)整页控件
  // 并 master 前它那边是:+ coop/list 收发两侧各一个进入点。增减已逐条比对 id,只落在这两个文件。 */
  /* 2026-09-08 +3:可对接的活动折叠段(展开行、卡片、cy-error retry)。 */
  /* 2026-09-08 +5:核销详情整页(复制手机号、两处 cy-error retry、cy-empty cta 等)+ 名册入口。 */
  /* 2026-09-08 +4:同上四条导航。四圆钮总数不变(编辑→更多是替换不是新增)。 */
  /* 2026-09-09 同一批次,控件总数重建实测 3394 → 3379。
  // 并 master 前它那边是:2026-09-10 开放设置第二个开关(整行 tap + 它自己的 cy-inline-error 重试),3379 → 3381。
  // 并 master 前它那边是:2026-09-10 帖子引用:选择器入口/撤销/选项 + 半屏的 cy-error 重试与 cy-sheet close,3381 → 3386。
  // 并 master 前它那边是:2026-09-10 第三个开关(整行 tap + 它自己的 cy-inline-error 重试),3386 → 3388。 */
  /* 2026-09-11 同上,+5 条事件合同,3388 → 3393;复查整改再 +2 条 bind:play,3393 → 3395。 */
  // 并 master 前它那边是:assert.equal(ledger.controlCount, 3423)  /* rebase 后按重建实测 3347 → 3353 */  /* rebase 后按重建实测 3343 → 3347 */  /* rebase 后按重建实测 3376 → 3343 */  /* rebase 后按重建实测 3375 → 3376 */  /* rebase 后按重建实测 3377 → 3375 */  /* 2026-09-06 #1007 cy-option-sheet 引入 +26 −2,合到危险确认批之后重建实测 3353 → 3377 */  /* 2026-09-06 危险确认收编重建实测 3352 → 3353 */
  // 2026-09-08 二次合 master(#1047 专业发布页 / #1048 途中彩蛋整条下线)。两侧数字对合并结果
  //   都不对,按 audit:actions:update 重建实测填。
  // 并 master 前它那边是:assert.equal(ledger.controlCount, 3381)  /* 同上 */
  //   自玩票段与商家承接段这次只是加了身份闸(wx:if),控件本身还在,不改条数。  /* 2026-09-06 合入 github/master 后按重建实测 */  /* rebase 后按重建实测 3347 → 3353 */  /* rebase 后按重建实测 3343 → 3347 */  /* rebase 后按重建实测 3376 → 3343 */  /* rebase 后按重建实测 3375 → 3376 */  /* rebase 后按重建实测 3377 → 3375 */  /* 2026-09-06 #1007 cy-option-sheet 引入 +26 −2,合到危险确认批之后重建实测 3353 → 3377 */  /* 2026-09-06 危险确认收编重建实测 3352 → 3353 */
  // 2026-09-09 漫游四模式落码,重建实测 3407 → 3444:新增 cy-map-address-search 组件
  //   (输入框 / 清空 / 结果行 各自的 variant)、subpackageRoam/citystamp 整页
  //   (取景框四钮 + 留言条拖投 + 小票撕拉 + 刮开 + 收下 + 保存),
  //   外加游玩抽屉三行改形态与商家卡头像堆带来的 variant 变化。
  // 2026-09-10 附近正在漫游的人:重建实测 3445 → 3450 —— 半屏的两个按钮,加上
  //   cy-scene-sheet 挂在新场景上的遮罩/返回/关闭三个 variant。
  // 2026-09-10 漫游四模式脱离 DS 壳:两屏各多出压暗层与 ✕ 两个真控件,3450 → 3452。
  // 2026-09-10 第二批:漫游 15 个半屏 + 仪式卡换壳,3452 → 3469;
  //   集邮册重做成方格后「收藏夹」那个控件退场,3469 → 3468;
  //   旅程手记重做成半屏后又退一个(「前往此站」),3468 → 3467;
  //   第三批补上工具抽屉 + 设置页 + 清空确认,3467 → 3494;
  //   自由探索加地图模式入口与回卡包,3494 → 3496;
  //   组局照原型重做,3496 → 3517;补上主题半屏,3517 → 3521。
  //   2026-09-11 游玩页脱离 DS 壳 + 自由探索抽屉按原型 x-tools 补齐,3521 → 3542。
  // 2026-09-11 并 github/master 后重建实测:controls 3548 · tap 1593 · 事件合同 1731。
  // 2026-09-11 再并 github/master(#1052/#1055/#1058)后重建实测:controls 3590 · tap 1613 · 事件合同 1759。
  // 2026-09-11 并 #1043 向导开场屏后重建实测:controls 3598 · tap 1619 · 事件合同 1759。
  // 2026-09-11 相机统一到原型取景卡(拟物机身退场、citystamp 抽出 cy-proto-cam、
  //   漫游三键拍照改成浮在地图上的取景卡)后重建实测:controls 3595 · tap 1615 · 事件合同 1763。
  // 2026-09-11 漫游「查找附近好玩的」换成原型 f-fun 横滑白卡(半屏摘掉、白卡三枚可点)后
  //   重建实测:controls 3592 · tap 1614 · 事件合同 1761。
  // 2026-09-11 照原型补齐 f-topic/f-city、f-checkin、f-multi、f-hangout(漫游)与 h-place、
  //   h-joined/h-ready 状态(组局)后重建实测:controls 3610 · tap 1630 · 事件合同 1761。
  // 2026-09-11 再并 github/master(#1061) + 保留 #1043 向导开场屏后重建实测:
  //   controls 3610→3618 · tap 1630→1636 · 事件合同仍 1761。
  // 2026-09-12 并 github/master(#1043) + 保留 #1046 后重建实测:controls 3618→3620。
  // 2026-09-12 并 #1046 后重建实测 controls 3620；门口码后再重建 3620→3628。
  // 2026-09-14 干净树重建 3971→3981:上两条 tap +3、事件合同 +8,漫游分享 external→local 使 external −1(总 +10)。
  // 2026-09-15 协作邀请已接受卡收敛(总控裁决「一张卡最多两个小按钮并排」):
  //   coop/list 卡上 -7(联系合作方×2、申报供给、评价×2、取消合作、锁价置灰),
  //   coop/invite-detail +5(同批动作按列表行收纳,供给申报浮层整块随迁不增减)—— 3974 → 3972。
  //   ⚠️ 上一轮收尾只重建了台账 JSON 没同步本行(3971/3974 假红),本次按 audit:actions:update 实测填。
  // 2026-09-15 CR-927:节点NPC 半屏新增 14 条控件(3981→3995),取 audit:actions:update 重建实测。
  // 2026-09-15 集成总线第一段(撤出 cr423 后 10 支,合并树 audit:actions:update 重建实测):controls 3981→3992。
  // 2026-09-15 公开承接池开关恢复(裁决 12B):fabu step3 新增一枚 cy-switch 控件 +1,3981→3982(取动作账本重建实测)。
  // 2026-09-15 集成总线第二段 合 publish-rules:同上两枚 cy-switch,3992→3994(重建实测)。
  // 2026-09-15 集成总线第二段 合 map-team:同批控件退场 + order-detail 建队卡新增,
  //   controls 3994→3958(重建实测)。
  // 同上:重复卡退场,controls 3958→3957(重建实测)。
  // 2026-09-16 补合第一批重做(merge-gap-a2):F15 customer 页 +1;coupon-redeem-fix 券出示码 scene-qr-coupon +1、coupon-qr +1,3957→3960(重建实测)。
  // 2026-09-16 补合第二批 合 coop-dialog-gap(85a5d0962/7da44a217):五处整页失败接
  //   custom-back bind:back,+6 条事件合同控件;3957→3963(取 audit:actions:update 重建实测)。
  // 2026-09-16 并 claim-revoke:citynode 撤回按钮(+1 tap)与它的行内重试(+1 事件合同),
  //   再 +2;3963→3965(合拢后 audit:actions:update 重建实测)。
  // 2026-09-16 H050/H051 帖文操作接线:cy-post-actions 首次有宿主(详情 + 列表),组件本体
  //   5 条控件进台账;两个页面的 bind:select 分发器按互斥分支声明(见 ACTION_VARIANTS),
  //   每个 3 分支 = 比单控制多 4 条。合拢后按 audit:actions:update 重建实测 3975
  //   (两侧自报的 3965/3967 都不可用:基线不同,以合并树重建为准)。
  // 2026-09-16 B 组审计(B-03):三处门卡 CTA 控件 +3;3975→3978(取 audit:actions:update 重建实测)。
  // 2026-09-16 C 组修复(整体检查 C-04):roam 抽屉新增「结束本次漫游」行,tap +1;
  //   同批 C-03/C-24 让 citystamp 三个出口与 play 入场码出口从 other/state 升为 navigation(动作更准确),
  //   控件总数 3975→3976(取 audit:actions:update 重建实测)。
  // 2026-09-16 D 组修复(整体检查 D-05/D-11):reviews 改/删回复入口与确认组件接线、
  //   ai-npc 性格设定入口,重建实测 controls 3975→3983(取 audit:actions:update 重建值)。
  // 2026-09-16 合拢第三轮 B/C/D 合流:三侧并集,按合并树 audit:actions:update 重建实测 3987。
  // 2026-09-16 整体检查 A 组:A-04 帖文详情评论行新增「删除」(仅本人渲染,tap +1);
  //   A-08 category-sheet 的「失败=空列表」拆成 cy-inline-error 重试(bindcta→bind:action,
  //   净 0)。按 audit:actions:update 在 A 组改动树上重建实测 3975→3976。
  // 2026-09-16 合拢第四轮 A 并入:三侧并集,按合并树 audit:actions:update 重建实测 3988。
  // 2026-09-16 E 组整体检查修复(重建实测 3975→3984,`npm run audit:actions:update`):
  //   topic-detail +5(D4/D5/D6/D8 现场工具入口 4 条 + 角色弹层 selectmember 行点击 1 条)、
  //   group-code +1(no-permission 分支的「进入俱乐部管理」终态出口)、
  //   club/detail +3(帖子/榜单/商家三处失败态的重试入口,原来失败渲染成空态没有重试)。
  // 2026-09-16 合拢第四轮 E 并入:A/E 并集,按合并树 audit:actions:update 重建实测 3997。
  // 2026-09-16 同日商家页去闸(删整屏身份闸):工作台 -5 / 合作 -2 / 经营团队 -1,净 -8;3978→3970
  //   (取 audit:actions:update 重建实测,新增的页内 cy-inline-error bind:action 已计入)。
  // 2026-09-16 合拢第四轮 去闸并入:E/去闸并集,按合并树 audit:actions:update 重建实测 3989。
  // 2026-09-16 候选池页退役 + 承接报名收编:候选页控件(−14)随页消失,协作列表 +2 ⇒
  //   按 audit:actions:update 重建实测 3987→3975。
  // 2026-09-16 截图冒烟修复(本批):tixian 银行卡表单整块退役(输入/勾选/两枚按钮/行内重试共 -7),
  //   同批新增三枚(联系客服提现 / 缺参返回上一页 / 开启定位提示),controls 3987→3982
  //   (按 audit:actions:update 重建实测)。
  // 2026-09-16 合拢第五轮 候选池/截图冒烟并入:侧并集,按合并树 audit:actions:update 重建实测 3972。
  // 2026-09-16 发布版本 release-0916 合资金线(+3)与非资金线(3972):两侧并集,按合并树 audit:actions:update 重建实测 3975。
  // 2026-09-17 漫游拍板实施(C-12/C-26):play +1 = needPass 空态新增「获取通行证」按钮(goGetPass);
  //   roam -2 = goal.act='retry-checkin' 动作注销 + 探店卡失败重试按钮(retryCheckin)随失败浮卡删除。
  //   净 3975→3974,按 audit:actions:update 重建实测。
  // 2026-09-17 拍照人工审核开关下线(拍板第16条):editor 的「需人工审核照片」cy-switch 随选项退役(−1);
  //   同批申请留言接线只改弹层与文本渲染,不产生新控件。按 audit:actions:update 重建实测 3975→3974。
  // 2026-09-17 发布版本 release-0917 合券(净 0)+漫游(−1)+游玩(−1):按合并树 build-action-ledger --write 重建实测 3973。
  // 2026-09-17 客诉期提现闸:cy-funds-stages「重试」控件 +1 ⇒ 按 audit:actions:update 重建实测 3976。
  // 2026-09-17 发布版本 release-0917 再合资金:合并树 3973 + 资金「重试」控件 +1 ⇒ build-action-ledger --write 重建实测 3974。
  // 2026-09-17 定向广播接线:客户页广播半屏新增「完成」按钮 1 条控件,按 audit:actions:update 重建实测 3975→3976。
  // 2026-09-17 发布版本 release-0917 再合广播:合并树 3974 + 广播「完成」控件 +1 ⇒ build-action-ledger --write 重建实测 3975。
  // 2026-09-17 拍板实施:E-09 入会申请刷新失败加内联错误+重试(bind:action 重试入口 +1);
  //   第 5 条错误文案修复不增删控件。controls 3975→3976(按 audit:actions:update 重建实测)。
  // 2026-09-17 发布版本 release-0917 再合杂项:合并树 3975 + 杂项 E-09 重试入口 +1 ⇒ build-action-ledger --write 重建实测 3976。
  // 2026-09-17 HO-26 导演台集合时间:tap +3、事件合同 +4,3975 → 3982(audit:actions:update 重建实测)。
  // 2026-09-17 发布版本 release-0917 再合 fix-p1:合并树 3976 + HO-26 tap 3 + 事件合同 4 ⇒ build-action-ledger --write 重建实测 3983。
  // 2026-09-17 第二轮拍板 #23/#24:工作台新增竞猜待办入口与查看申请进度入口,
  //   按 audit:actions:update 重建实测 3975→3977。
  // 2026-09-17 发布版本 release-0917 再合 fix-merchant:合并树 3983 + 2 ⇒ build-action-ledger --write 重建实测 3985。
  // 2026-09-17 第二轮拍板 17:足迹深链页 +1 tap +4 事件合同,3975→3980(audit:actions:update 重建实测)。
  // 2026-09-17 发布版本 release-0917 再合 fix-play:合并树 3985 + fix-play +5 ⇒ build-action-ledger --write 重建实测 3990。
  // 2026-09-17 拍板 #15:首页搜索入口 +1 控件,3975→3976(取 audit:actions:update 重建实测)。
  // 2026-09-17 发布版本 release-0917 再合 fix-player:合并树 3990 + 1 ⇒ build-action-ledger --write 重建实测 3991。
  // 2026-09-17 商家营销同意入口(拍板第 40 条 A):结果面板勾选行/重试、订单详情同意行与重试、
  //   票夹与活动页的 consent 事件接线共 +8,按 audit:actions:update 重建实测 3975→3983。
  // 2026-09-17 发布版本 release-0917 再合 fix-consent:合并树 3991 + 同意勾选/重试控件 +8(cy-result-sheet 宿主闭包扩张)⇒ build-action-ledger --write 重建实测 3999。
  // 2026-09-17 退款售后照 Revolut 重做:删查单表单(输入/查询/最近查询/快捷查询)、详情加同意/不同意/补凭证胶囊与
  //   复制单号、回应面板继续/返回/关闭、列表加搜索/清除搜索/加载更多,控件总数净 0 ⇒ audit:actions:update 重建实测 3999。
  // 2026-09-17 预制人生四玩法 + R14 检定一屏 + 梦块/插入变量:按 audit:actions:update 重建实测
  //   3999→4100(+101;与两侧自报对账:创作端 +66、玩家端 +35,净删 0)。
  // 2026-09-18 内嵌/全屏 present:重建实测 4100→4105(+5:内嵌骰子按钮与事件 +2、
  //   编辑器呈现二选一 +2、外部分母 +1;净删 0)。
  // 2026-09-18 C8-05 主办方取消主题:#dcCancelTopic 确认组件 +1 控件 ⇒ rebase 到 #1091 后重建实测 4101。
  // 2026-09-18 合并后重建实测:两侧增量各自成立 ⇒ 4106。
  // 2026-09-18 阶段4 修复:统一主页新增「招牌主推」点击(goFeatured)+1;旧商家主页兼容壳去掉商家门禁,
  //   连带它的 cy-result-sheet 控件退场(lineNumber 位移重排,总数净 +1);
  //   rebase 到 github/master 后两侧增量合并 ⇒ 按 audit:actions:update 重建实测 4106→4107。
  // 2026-09-18 FIX-P3:3-18 任务列表 official 绑定 +1、3-24 三个 poi-detail 宿主 bind:citystamp
  //   绑定 +3(本分支侧 3999 → 4003);rebase 到 github/master 后两侧增量合并,控件总数按
  //   audit:actions:update 重建实测重取。
  // 2026-09-18 FIX-P3:3-18 三个任务列表宿主 official 绑定 +3、3-24 三个 poi-detail 宿主
  //   bind:citystamp 绑定 +3(本分支侧 3999 → 4005);rebase 到已含 #1088 的 github/master 后
  //   两侧增量合并 ⇒ 按 audit:actions:update 重建实测 4107→4113。
  // 2026-09-18 rebase #1072 到 master(3cce66ab0):控件总数同上净 −3(旧 publish-sheet 17 条出账、
  //   新 14 条进账),取 audit:actions:update 重建实测 4101 → 4098。
  // 2026-09-18 合并两侧后重建实测:master 侧 4113 叠加 #1072 净 −3 ⇒ 4110,按 audit:actions:update 实算。
  // 2026-09-19 并入 fix/audit-wiring-202609 侧账目(其自报值基线不同,以合并树重建实测为准):
  // (本支) 2026-09-18 批3D + 批1B(fix/audit-wiring-202609):3956 → 3969(净 +13),与上面 tap/ec
  // (本支) 同一笔账 —— 十条主 CTA 新增的 13 个 bind:disabledtap 事件合同,零删除。
  // (本支) 2026-09-18 死事件接线批(fix/audit-wiring-202609):3959 → 3956(净 −3),逐项对得上 ——
  // (本支) 减 10:僵尸 bind:open×9(组件从不 emit)+ 空实现页的 bindscrolltolower×1;
  // (本支) 加 7:bind:citystamp×3、bind:transferowner×3、bind:alt×1。
  // (本支) 2026-09-16 编辑页按原型重排:3969 → 3959(净 −10),逐项对得上 ——
  // (本支) 减:AI 助写卡整张(入口撤掉、逻辑保留)、玩法难度那一档、
  // (本支) 问答选项里商家配不了的「配图 / 配音」两个角标、原来那个大 textarea 规则框;
  // (本支) 加:玩法规则步骤列表(每步一个输入框 + 删除)、＋添加一步、
  // (本支) 同步到模板广场开关、抽卡卡池名、找东西可以错几次、拍照补充说明、
  // (本支) 问答「次数用完亮答案」开关、竞猜揭晓时间两颗下拉。
  // (本支) 2026-09-16 十九个玩法补齐接线:3963 → 3969。新增六颗控件,逐颗对得上 ——
  // (本支) 编辑页四颗(抽卡卡池名、找东西可以错几次、拍照补充说明、问答亮答案开关)
  // (本支) + 竞猜揭晓时间两颗下拉(第几天 / 几点)。抽卡那两颗按钮里的三尖角是 aria-hidden 的
  // (本支) 装饰,不进台账;计步换屏没有增减控件。
  // (本支) 2026-09-19 裁决「弹层退出口只留 ✕」:三颗底部取消退役,控件 4115 → 4112(逐颗见上面 tap 对账)。
  // (本支) 2026-09-19 批复1-a=2:合作阵容行 +1、partner 页复活 +6,控件 4112 → 4119。
  // 2026-09-22 同批:控件 4254 → 4231(删地图层/读数卡/地点卡层/起始页 + 卡包上那枚地图钮)。
  // (本支) F-26~F-56 那批改了 wxml 却没重建台账,漂移 3 个;F-57 挪动领队工具行对控件数是 +0(play 页仍 272)。
  // (本支) 2026-09-22 现场感三件套 S1 取景轮廓:玩家端取景层四颗(快门、退出取景、camera 与
  //   轮廓图各自的 binderror 降级线)+ 商家端三颗(传轮廓、删轮廓、浓淡输入),控件 4254 → 4261。
  // 2026-09-22 现场感三件套 S2 罗盘指向:玩家端罗盘组件 4 颗 + 分发器转接 3 条 +
  //   创作端罗盘段 7 颗(取值按钮 + 开关与字段),控件 4261 → 4275(重建实测)。
  // (本支) 2026-09-22 合 master(#1139/#1141/#1144/#1145/#1146 现场感与玩法批)后按合并树重建。
  //   三项均严格可加,可作为合并自洽的佐证:base 4254 + 本支 6 + master 21 = 4281;
  //   tap 1787 - 28(本支分类器修好后 41 个控件转 external)+ 4 = 1763;
  //   event-contract 2160 - 6 + 14 = 2168。数字取自重建实测,非推算。
  // 2026-09-22 rebase 到最新 master 后按合并树重建实测(本分支删掉的从 master 新基数上减)。
  // 2026-09-22 S3b 喊一嗓子:playkit-shout 壳 6 颗 + 分发器 shout 分支 4 颗 + 编辑页 shout 段 4 颗,
  //   合并树基数 4258 → 4272(重建实测)。
  // 2026-09-22 阶段 5 条件修正 mods 接进编辑器:check 段新增 5 个 handler、共 8 条 variant
  //   (addModPreset / addModRow / removeModRow / pickModOp 各 1 tap,updateModField 4 个
  //   bindinput 入口 = label / when.var / when.value / value,归 event-contract),
  //   4272 → 4280(重建实测,不是按行数推算)。
  // 2026-09-22 M-09:定向广播「选人」逐行勾选 + 预览失败「重新核对」+2 控件,4280 → 4282(重建实测)。
  // 2026-09-22 编辑页单选统一下拉:呈现方式 / 掷骰几颗 / 勋章样式各是两颗芯片并成一个下拉,其余一对一,
  //   4282 → 4279(重建实测)。
  // 2026-09-23 检定段改「开关 + 下拉」:旧 mods 编辑器 9 个控件出、难度/写入方式/幸运/生命/放宽进 ⇒ 4279 → 4276(重建实测)。
  // 2026-09-23 ComputerUse 走查修复:+4 tap +2 事件合同 ⇒ 4276 → 4282(重建实测)。
  // 同日 CU-C-23「重新检查」+1 事件合同 ⇒ 4282 → 4283;本站直达入口撤回 -1 tap ⇒ 4282(重建实测)。
  // 2026-09-24 走查第二轮(CU 110 条):协作列表范围提示/分享原生按钮/联系运营/选场半屏等 ⇒ 4282 → 4291(重建实测)。
  // 2026-09-24 B 扫码显形 OVERLAY + 显形档真 AR(xr-frame 组件、宿主 AR 事件、编辑页 AR 方式 / 识别图 / 3D 模型、
  //   「看不到？」回落)rebase 到 6292ef1ff 后按合并树重建实测:4291 → 4314。
  // 2026-09-25 CU-M-92 受邀商家承接视图:project-join 底栏主按钮拆成互斥两分支,+1 tap ⇒ 4314 → 4315(重建实测)。
  // 2026-09-25 最终集成:原台账controlCount写4315但controls实际4316;重建纠正为4316。
  // 本轮客户广播移除、管理筛选入口与券详情重组：重建实测 4311。
  // 关闭入口 +3、邀约重试 +2;旧关闭 -4、只读开关 -1,控件实际净变化0。
  assert.equal(ledger.controlCount, 4382)  /* 2026-09-22 取景轮廓落地后按最终树重建实测。 */  /* 2026-09-22 罗盘指向落地后重建实测 4275。 */
  // 搜索主题与其它结果拆成互斥点击 +1，合计 3268 → 3271（取动作账本重建实测）。
  // 合作页新增会话失效/无权限两个独立 cy-empty CTA，3271 → 3273。
  // 2026-09-02 俱乐部客户系统落地，3273 → 3295。
  // 2026-09-02 俱乐部客户系统落地，3273 → 3296。
  assert.equal(rebuilt.controlCount, ledger.controlCount)
  assert.equal(new Set(ledger.controls.map((item) => item.id)).size, ledger.controlCount)
  assert.equal(ledger.controls.filter((item) => /:0$/.test(item.evidence.staticSource)).length, 0)
  assert.equal(ledger.controls.filter((item) => item.requiredBranches.length === 0).length, 0)
})

test('动作角色必须来自当前 route-matrix，俱乐部与商家页不得默认成 player', () => {
  const cases = [
    // 2026-09-09 探店日质量证据整页删除,换成同样是俱乐部二级页的核销详情 ——
    //   这条要证的「俱乐部页角色不得默认成 player」原样成立。
    ['pages/club/checkin-detail/index', 'club'],
    // 2026-09-04 导演台整页收编进活动详情页,game-director 路由已注销 ——
    //   换成新宿主页,这条要证的「俱乐部页角色不得默认成 player」原样成立。
    ['pages/club/topic-detail/index', 'club'],
    ['pages/merchant/marketing/ai-insight/index', 'merchant'],
    ['pages/merchant/game-node/index', 'merchant'],
  ]
  cases.forEach(([route, role]) => {
    const controls = ledger.controls.filter((control) => control.route === route)
    assert.ok(controls.length > 0, `${route} 必须有动作进入台账`)
    assert.equal(controls.every((control) => control.role === role), true, `${route} 角色必须是 ${role}`)
  })
  const included = ledger.controls.filter((control) =>
    control.entry.wxml === 'pages/publish/fabu/step3.wxml'
      || control.entry.wxml === 'pages/publish/fabu/topic-detail-sheet.wxml')
  assert.ok(included.length > 0, 'include 局部 WXML 必须保留在产品动作分母')
  assert.equal(included.every((control) => control.route === 'pages/publish/fabu/index'), true)
})

test('release 前重建 inventory，漏掉新增/修改控件必须变红', () => {
  assert.equal(inventoryMatchesCurrent(ledger), true)
  const stale = JSON.parse(JSON.stringify(ledger))
  stale.controls[0].control.handler = 'staleHandler'
  assert.equal(inventoryMatchesCurrent(stale), false)
})

test('动态证据 digest 同时绑定 WXML/JS/WXSS/JSON，样式漂移不能继续假绿', () => {
  const control = ledger.controls.find((item) => item.entry.wxml === 'pages/gerenziliao/gerenziliao.wxml')
  assert.ok(control)
  const files = sourceFilesFor(control)
  ;[
    'pages/gerenziliao/gerenziliao.wxml', 'pages/gerenziliao/gerenziliao.js',
    'pages/gerenziliao/gerenziliao.wxss', 'pages/gerenziliao/gerenziliao.json',
    'app.wxss', 'style/tokens.wxss', 'components/cy/sheet/index.wxss',
  ].forEach((relative) => assert.ok(files.includes(relative), `digest 缺少 ${relative}`))
  const wxss = 'pages/gerenziliao/gerenziliao.wxss'
  const mutated = sourceDigestFor(control, { [wxss]: `${fs.readFileSync(path.join(__dirname, '../../', wxss))}\n/* mutation */` })
  assert.notEqual(mutated, sourceDigestFor(control), '只改 WXSS 字节也必须让 digest 变化')
})

test('动态证据只绑定真实全局运行时依赖，新增无关路由不得批量判旧', () => {
  const standalone = ledger.controls.find((item) =>
    item.id === 'components/cy/free-map/index.wxml:31:bindtap:recenter:5')
  const appBacked = ledger.controls.find((item) =>
    item.route === 'pages/activity/baoming/baoming' && item.actionClass === 'state')
  assert.ok(standalone)
  assert.ok(appBacked)
  assert.equal(sourceFilesFor(standalone).includes('app.js'), false)
  assert.equal(sourceFilesFor(appBacked).includes('app.js'), true)
  assert.equal(sourceFilesFor(standalone).includes('app.json'), false)
  assert.equal(sourceFilesFor(appBacked).includes('app.json'), false)
})

test('inventory 与可持久化动态证据分离，freshness 不会抹掉执行结果', () => {
  assert.deepEqual(validateEvidenceOverlay(ledger, overlay), [])

  const control = ledger.controls.find((item) =>
    item.id === 'components/cy/date-field/index.wxml:10:bindchange:onColumnChange:3')
  assert.ok(control, '负控需要一个源码未被当前改动触及的本地状态动作')
  const id = control.id
  const artifactPath = path.join(__dirname, '../../scripts/uiaudit/action-evidence.json')
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(sourceDigestAtCommit(control, headSha), sourceDigestFor(control))
  const sample = {
    schemaVersion: 1,
    results: {
      [id]: {
        status: 'failed',
        sourceSha: headSha,
        sourceDigest: sourceDigestFor(control),
        verifiedAt: freshAt(),
        branches: control.requiredBranches.slice(),
        artifacts: [{
          uri: 'scripts/uiaudit/action-evidence.json',
          sha256: crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex'),
        }],
        fixture: {
          id: 'synthetic-player-01', accountRole: 'player', networkProfile: 'wifi-controlled',
          backendMode: 'isolated-test', synthetic: true,
        },
        fixtureAttestations: control.requiredBranches.map(() => ({
          fixtureId: 'synthetic-player-01', synthetic: true,
          identityFingerprint: 'sha256:test-account', backendBase: 'isolated-test', backendDeploymentSha: 'd'.repeat(40),
          assertions: ['受控身份回读一致'],
        })),
        observations: control.requiredBranches.map((branch) => ({
          branch,
          readback: {
            changed: { data: true, dom: true, routeStack: false },
            assertions: { state: { expected: { show: false }, observed: { show: false } } },
          },
          artifacts: [{
            uri: 'scripts/uiaudit/action-evidence.json',
            sha256: crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex'),
          }],
        })),
        readback: 'tap 后 DOM 已关闭，page.data.show=false',
      },
    },
  }
  assert.deepEqual(validateEvidenceOverlay(ledger, sample), [])
  assert.equal(evidenceReadiness(ledger, sample).ready, false)

  const vague = JSON.parse(JSON.stringify(sample))
  vague.results[id].status = 'passed'
  vague.results[id].observations[0].readback = { assertions: ['人工说已完成'] }
  assert.match(validateEvidenceOverlay(ledger, vague).join('\n'), /精确前后状态断言/)

  const validDigest = sample.results[id].sourceDigest
  sample.results[id].sourceDigest = '0'.repeat(64)
  assert.match(validateEvidenceOverlay(ledger, sample).join('\n'), /证据已过期/)
  sample.results[id].sourceDigest = validDigest

  const rootSha = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim().split('\n')[0]
  const missingAtRoot = ledger.controls.find((control) => sourceDigestAtCommit(control, rootSha) === null)
  assert.ok(missingAtRoot, '负控需要一个根提交尚不存在的 WXML/JS 控件')
  const forgedHistorical = {
    schemaVersion: 1,
    results: {
      [missingAtRoot.id]: {
        ...sample.results[id],
        sourceSha: rootSha,
        sourceDigest: sourceDigestFor(missingAtRoot),
        branches: missingAtRoot.requiredBranches.slice(),
      },
    },
  }
  assert.match(validateEvidenceOverlay(ledger, forgedHistorical).join('\n'), /不包含当前 WXML\/JS/)

  sample.results[id].artifacts = []
  assert.match(validateEvidenceOverlay(ledger, sample).join('\n'), /artifacts/)

  sample.results[id].artifacts = [{ uri: 'missing.json', sha256: '0'.repeat(64) }]
  assert.match(validateEvidenceOverlay(ledger, sample).join('\n'), /不存在/)

  sample.results[id].artifacts = [{ uri: 'https://invalid.example/evidence.json', sha256: '0'.repeat(64) }]
  assert.match(validateEvidenceOverlay(ledger, sample).join('\n'), /远端 artifact 未回读/)

  sample.results[id].status = 'blocked'
  assert.match(validateEvidenceOverlay(ledger, sample).join('\n'), /blocked 必须含/)
})

test('external passed 证据必须逐平台逐分支绑定受控真机环境与媒体，不接受任意仓库文件', () => {
  const control = ledger.controls.find((item) => item.actionClass === 'external'
    && item.externalCapabilities.includes('vibrateShort'))
  assert.ok(control)
  const artifactPath = path.join(__dirname, '../../scripts/uiaudit/action-evidence.json')
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const evidence = {
    status: 'passed',
    sourceSha: headSha,
    sourceDigest: sourceDigestFor(control),
    verifiedAt: freshAt(),
    branches: control.requiredBranches.slice(),
    artifacts: [{
      uri: 'scripts/uiaudit/action-evidence.json',
      sha256: crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex'),
    }],
    readback: 'iOS 与 Android 真机均回读振动调用结果',
  }
  const wrapper = { schemaVersion: 1, results: { [control.id]: evidence } }
  assert.match(validateEvidenceOverlay(ledger, wrapper).join('\n'), /executions.*ios.*android/i)

  const branchReadback = (name) => ({
    actionId: control.id,
    branch: name,
    fixtureId: 'synthetic-player',
    assertions: [`${name} 事实已回读`],
    observed: name === 'error' ? { errorCode: 'DEVICE_ERROR' }
      : name === 'timeout' ? { timedOut: true, aborted: true, elapsedMs: 15000 }
        : name === 'duplicate-trigger' ? { triggerCount: 2, sideEffectCount: 1 }
          : {
            outcome: 'success',
            capabilities: Object.fromEntries(control.externalCapabilities.map((capability) => [
              capability.replace(/^app\./, ''), { outcome: 'success', ok: true },
            ])),
          },
  })
  const branchEvidence = (captureId) => control.requiredBranches.map((name) => ({
    name,
    captureId,
    capturedAt: freshAt(30 * 1000),
    readback: branchReadback(name),
    artifacts: evidence.artifacts,
  }))
  const executionFixture = {
    id: 'synthetic-player', accountRole: 'player', networkProfile: 'wifi',
    backendMode: 'isolated-test', synthetic: true,
    entry: { route: control.route.startsWith('component:') ? 'pages/test/host' : control.route, query: {} },
    locator: {
      selector: control.control.selectorHint.replace(/^([A-Za-z][\w-]*)\[(?:bind|catch):?tap\]$/, '$1'),
      index: 0,
      componentPath: control.route.startsWith('component:') ? control.route.slice('component:'.length) : null,
      actionFingerprint: require('../../scripts/uiaudit/action-evidence-store').actionLocatorFingerprint(control),
    },
  }
  const executionAttestation = {
    fixtureId: executionFixture.id, synthetic: true, accountRole: executionFixture.accountRole,
    identityFingerprint: 'sha256:external-player', backendBase: 'isolated-test', backendDeploymentSha: 'd'.repeat(40),
    assertions: ['identity matched'],
  }

  evidence.executions = [{
    platform: 'ios',
    device: { physical: true, model: 'iPhone test device', osVersion: '18.6', wechatVersion: '8.0.61' },
    fixture: executionFixture,
    fixtureAttestation: executionAttestation,
    capture: {
      id: 'capture-ios', operator: 'qa-owner', capturedAt: freshAt(),
      completedAt: freshAt(60 * 1000), devtools: false,
    },
    branches: branchEvidence('capture-ios'),
  }]
  assert.match(validateEvidenceOverlay(ledger, wrapper).join('\n'), /android/i)
  evidence.executions.push({
    platform: 'android',
    device: { physical: true, model: 'Android test device', osVersion: '16', wechatVersion: '8.0.61' },
    fixture: executionFixture,
    fixtureAttestation: executionAttestation,
    capture: {
      id: 'capture-android', operator: 'qa-owner', capturedAt: freshAt(),
      completedAt: freshAt(60 * 1000), devtools: false,
    },
    branches: branchEvidence('capture-android'),
  })
  const errors = validateEvidenceOverlay(ledger, wrapper).join('\n')
  assert.match(errors, /evidence\/device/)
  assert.match(errors, /截图或录屏/)
})

test('截图录屏证据必须有真实媒体签名，文本改后缀不能通过', () => {
  assert.equal(isRecognizedMedia('fake.png', Buffer.from('not an image')), false)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  assert.equal(isRecognizedMedia('pixel.png', png), true)
  const truncated = Buffer.concat([
    png.subarray(0, 8), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(8), Buffer.from('IEND'),
  ])
  assert.equal(isRecognizedMedia('truncated.png', truncated), false)
})
