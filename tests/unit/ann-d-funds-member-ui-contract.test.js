const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
  return match ? match[1] : ''
}

function assertAnnotationDContract(files) {
  assert.equal(/--cy-comp-sheet-player-bg:\s*#1C1C1E;/.test(files.tokens), true,
    '统一弹窗的 player 底必须是实色，不能再让宿主页标题从 glass 透出')
  assert.match(rule(files.sheetWxss, '.sh__panel'), /--cy-comp-sheet-bg:\s*var\(--cy-comp-sheet-role-glass/,
    '2026-08-07 用户拍板(修订):面板读 role 档,玩家=深玻璃/商家=不透明白')
  assert.match(rule(files.sheetWxss, '.sh__panel'), /background:\s*var\(--cy-comp-sheet-bg\)/)
  assert.doesNotMatch(rule(files.sheetWxss, '.sh__panel'), /border(?:-top)?\s*:/)
  /* 2026-09-02(§3.21 · 用户当面点名):✕ 去圆底。圆角留着无所谓,底色必须透明;
     热区仍是整块 --cy-btn-h —— 去圆底不等于缩热区。 */
  assert.match(rule(files.sheetWxss, '.sh__close'), /background:\s*transparent/)
  assert.match(rule(files.sheetWxss, '.sh__close'), /width:\s*var\(--cy-btn-h\)/)
  assert.match(rule(files.sceneSheetWxss, '.ss--player'), /--cy-sheet-bg:\s*var\(--cy-comp-sheet-player-glass\)/)
  assert.match(rule(files.sceneSheetWxss, '.ss--merchant'), /--cy-sheet-bg:\s*var\(--cy-comp-sheet-merchant-bg\)/,
    '2026-08-07 双规范:商家 scene 弹窗=不透明白')
  assert.match(files.sceneSheetWxml, /class="ss__close" wx:if="\{\{closable\}\}"/)
  assert.match(files.sceneSheetJs, /closable:\s*\{ type: Boolean, value: true \}/)

  assert.match(files.tokens, /--cy-color-bg-surface-strong:\s*#3B3B3D;/)
  assert.match(files.tokens, /--cy-color-input-bg-empty:\s*var\(--cy-color-bg-elevated\);/)
  assert.match(files.tokens, /--cy-color-input-bg-filled:\s*var\(--cy-color-bg-surface-strong\);/)
  assert.match(files.tokens, /--cy-color-input-placeholder:\s*#A3A3A5;/)
  assert.match(files.tokens, /--cy-color-input-text:\s*#F2F2F4;/)

  assert.match(rule(files.orderWxss, '.order-card'), /--cy-comp-card-bg:\s*var\(--cy-scene-card-bg,/,
    '玩家订单卡必须与漫游历史消费同一半透明卡片变量')

  assert.match(files.shotMatrix, /\['D08',[\s\S]*?sourceName:\s*'城市夜行 · 建筑线索'[\s\S]*?sourceCover:\s*IMG[\s\S]*?stateText:\s*'进行'[\s\S]*?dateText:\s*'08\.01 – 08\.31'[\s\S]*?typeLabel:\s*'城市定向'[\s\S]*?sourceAddress:\s*'外滩观景平台'/)

  assert.ok(files.tixianWxml.indexOf('class="txtpis"') < files.tixianWxml.indexOf('class="tx-cta"'), '提现说明必须在底部按钮上方')
  // 2026-09-16 银行卡表单退役:页面不再采集输入,唯一动作是客服弹窗
  assert.doesNotMatch(files.tixianWxml, /placeholder-class="tx-placeholder"|bindinput=/)
  assert.doesNotMatch(files.tixianWxml, /placeholder-style=/)
  assert.doesNotMatch(rule(files.tixianWxss, '.txcon_ly'), /border(?:-bottom)?:/)
  assert.match(rule(files.tixianWxss, '.txcon_ly'), /background:\s*var\(--cy-color-input-bg-empty\)/)
  assert.match(rule(files.tixianWxss, '.txcon_ly--filled'), /background:\s*var\(--cy-color-input-bg-filled\)/)
  assert.match(rule(files.tixianWxss, '.tx-bottom'), /margin-top:\s*auto/)
  assert.match(files.tixianWxml, /class="tx-history-entry"[^>]*bindtap="openWithdrawHistory"/)
  assert.match(files.tixianWxml, /<cy-sheet[^>]*show="\{\{withdrawHistorySheet\}\}"[^>]*title="提现记录"[\s\S]*?<cy-scene-member-withdraw-history id="withdrawHistory"/)
  assert.match(files.tixianJs, /withdrawHistorySheet:\s*false/)
  assert.match(files.tixianJs, /openWithdrawHistory\(\)\s*\{\s*this\.setData\(\{ withdrawHistorySheet: true \}\)\s*\}/)
  assert.match(files.tixianJs, /closeWithdrawHistory\(\)\s*\{\s*this\.setData\(\{ withdrawHistorySheet: false \}\)\s*\}/)

  assert.match(files.tixianjiluWxml, /<cy-page-title title="提现记录"/)
  assert.doesNotMatch(files.tixianjiluWxml, /<cy-sheet/, '提现记录深链壳不再套常驻半屏')
  assert.doesNotMatch(files.tixianjiluJson, /cy-sheet/)
  assert.match(files.tixianjiluWxml, /<cy-scene-member-withdraw-history id="withdrawHistory"/)
  assert.match(files.tixianjiluSceneWxml, /wx:if="\{\{hasMore && !loading\}\}" bindtap="loadMore"/)
  assert.match(files.earningsWxml, /sceneCurrent\.id === 'member-withdraw-history'[\s\S]*?<cy-scene-sheet show="\{\{true\}\}"[\s\S]*?<cy-scene-member-withdraw-history/)
  assert.match(files.earningsSceneJs, /openWithdrawHistory\(\)\s*\{\s*this\.triggerEvent\('open', \{ id: 'member-withdraw-history' \}\)\s*\}/)
  assert.doesNotMatch(files.earningsSceneJs, /openWithdrawHistory\(\)\s*\{\s*wx\.navigateTo/)
  assert.match(files.tixianjiluSceneWxml, /txjl-st--\{\{item\.statusVariant\}\}"[^>]*>\{\{item\.statusText\}\}/)
  assert.doesNotMatch(files.tixianjiluSceneWxml, /item\.status\s*==/,
    '状态必须先由 JS 严格投影，不能用宽松等号把 true/字符串冒充合法状态')

  assert.doesNotMatch(files.myinviteWxml, /<cy-sheet/, '邀请记录深链壳不再套常驻半屏')
  assert.doesNotMatch(files.myinviteJson, /cy-sheet/)
  assert.match(files.myinviteWxml, /<cy-page-title title="邀请记录"/)
  assert.match(files.myinviteWxml, /<cy-scene-member-invite-history id="inviteHistory"/)
  assert.match(files.myinviteSceneWxml, /class="ir-row"[\s\S]*class="ir-time"[\s\S]*class="ir-status"[\s\S]*class="ir-reward"/)
  assert.match(files.myinviteSceneJs, /url:\s*'\/api\/user\/invite_list'[\s\S]*url:\s*'\/api\/user\/points\/list'/)
  assert.match(files.earningsSceneWxml, /<cy-cell title="邀请记录" description="查看被邀请人、状态与奖励" bind:tap="openInvite"/)
  assert.match(rule(files.myinviteSceneWxss, '.ir-card'), /background:\s*var\(--cy-scene-card-bg,/)
  assert.doesNotMatch(rule(files.myinviteSceneWxss, '.ir-card'), /border:/)
  assert.doesNotMatch(rule(files.myinviteSceneWxss, '.ir-row + .ir-row'), /border-top:/)

  assert.doesNotMatch(files.complaintWxml, /<cy-card class="cp-card">/)
  assert.match(files.complaintWxml, /class="cp-field \{\{topicIndex >= 0 \? 'cp-field--filled' : ''\}\}"[\s\S]*?<text class="cp-label">投诉活动/)
  assert.match(rule(files.complaintWxss, '.cp-field'), /background:\s*var\(--cy-color-input-bg-empty\)/)
  assert.match(rule(files.complaintWxss, '.cp-field--filled'), /background:\s*var\(--cy-color-input-bg-filled\)/)

  // ★ 2026-08-11 用户裁决「这个就放到页面上,不要做弹窗了」——
  //   取代 2026-08-07 那条「弃返回钮保半屏,叉号关闭」的弹窗形态裁决(前提已变,不是被违反)。
  //   原来这页一进来就永久弹一个 cy-sheet(默认 variant=bottom 只盖 70vh),页面标题与弹层标题
  //   同屏各出一个「收益明细」—— 走查 D28 报的重复就是这么来的。现在正文直接落在页上。
  assert.doesNotMatch(files.incomeWxml, /<cy-sheet/, '收益明细不再套弹层,正文直接落在页上')
  assert.doesNotMatch(files.incomeJson, /cy-sheet/, '弹层组件依赖要一并摘掉,不留死引用')
  assert.match(files.incomeWxml, /<cy-page-title title="收益明细"/, '标题只剩页面这一个')
  // ⚠️ 只数 title 属性,不数「收益明细」四个字 —— wxml 注释里也写着它,数原文会把注释算进去(今天踩过三次)
  assert.equal((files.incomeWxml.match(/title="收益明细"/g) || []).length, 1, '同屏只许出现一个「收益明细」标题')
  assert.match(files.incomeWxml, /<cy-scene-asset-income-detail id="incomeDetail"/)
  // 两个入口都必须跳页面,不得再开场景弹层
  assert.match(files.earningsSceneJs, /openIncomeDetail\(\)\s*\{[^}]*navigateTo/,
    'earnings 卡上的「明细」要跳页面')
  assert.doesNotMatch(files.earningsSceneJs, /openIncomeDetail\(\)\s*\{[^}]*asset-income-detail'\s*\}\)/,
    '不得再 triggerEvent 开场景')
  assert.match(files.routeContentJs, /action === 'income'\)[\s\S]{0,80}navigateTo/,
    '通用二级动作里的 income 也要跳页面')
  // 2026-08-11:原来这里锁着组件自带的 .id-sheet-title「收益明细」,而上一行又锁着 cy-sheet 的
  // title="收益明细" —— 两条断言各自成立,合起来正好把「同一屏出现两个同名标题」钉死了。
  // 标题归弹层头(全仓 scene 组件的统一做法),组件不再自带;翻成负向断言,谁加回来就红。
  assert.doesNotMatch(files.incomeSceneWxml, /id-sheet-title/,
    '标题由弹层头出:三个宿主都已传 title,组件再渲一个就是同屏两个同名标题')
  // 用 rule() 解析真实规则,不要对 wxss 原文 doesNotMatch —— 注释里提到类名也会命中(踩过)
  assert.ok(!rule(files.incomeSceneWxss, '.id-sheet-title'), '样式不得留孤儿规则')
  assert.match(files.incomeSceneWxml, /wx:if="\{\{hasMore && !loading\}\}" bindtap="loadMore"/)
  // 标题让位后 tab 成了正文首元素,顶距要自己补,否则贴着弹层头
  assert.match(rule(files.incomeSceneWxss, '.id-tabs'), /margin-top:\s*var\(--cy-space-2\)/)
  assert.match(rule(files.incomeSceneWxss, '.aid'), /--cy-tabs-fade-bg:\s*var\(--cy-comp-sheet-player-bg\)/,
    'Tab 渐隐端必须跟随弹窗底，不能回潮为页底黑块')
  assert.match(rule(files.incomeSceneWxss, '.id-list'), /background:\s*var\(--cy-scene-card-bg,/,
    '收益明细必须与漫游历史消费同一半透明卡片变量')
  assert.match(rule(files.tabsWxss, '.cy-tabs--chip::after'),
    /background:\s*linear-gradient\(to right, transparent, var\(--cy-tabs-fade-bg, var\(--cy-bg-page\)\)\)/)
  assert.match(files.earningsWxml, /sceneCurrent\.id === 'asset-income-detail'[\s\S]*?<cy-scene-sheet show="\{\{true\}\}"[\s\S]*?<cy-scene-asset-income-detail/)
  assert.doesNotMatch(files.earningsWxml, /sceneCurrent\.id === 'asset-income-detail'[\s\S]{0,200}closable="\{\{false\}\}"/,
    '2026-08-07 拍板:收益明细半屏,右上叉号回归,不许再锁 closable=false')

  assert.match(files.earningsWxml, /<view class="er-page theme-dark">/,
    'D33 账户收益是玩家资金页，页面根必须显式进入深色主题')
  assert.match(files.earningsJs, /require\('\.\.\/\.\.\/\.\.\/\.\.\/utils\/merchant-theme\.js'\)/)
  assert.match(files.earningsJs, /onShow\(\)\s*\{\s*merchantTheme\.merchantPageRestore\(\)\s*\}/,
    'D33 原生导航栏必须与玩家深色页面同步')
  const earningsRoot = rule(files.earningsWxss, '.er-page.theme-dark')
  assert.match(earningsRoot, /background:\s*var\(--cy-color-bg-page\)/,
    'D33 页面底必须直接读取深色根的语义 token，不能读取 page 上的浅色 alias 快照')
  assert.match(earningsRoot, /--cy-bg-page:\s*var\(--cy-color-bg-page\)/,
    'D33 深色根必须把旧背景 alias 重映射后再传给隔离组件')
  assert.match(earningsRoot, /--cy-btn-solid-bg:\s*var\(--cy-color-action-primary-bg\)/,
    'D33 深色根必须把按钮 alias 重映射后再传给隔离组件')

  assert.match(rule(files.earningsSceneWxss, '.ae-card'), /background:\s*var\(--cy-btn-solid-bg\)/)
  assert.match(rule(files.earningsSceneWxss, '.ae-action'), /background:\s*var\(--cy-color-action-secondary-bg\)/)

  assert.doesNotMatch(files.couponInfoWxss, /(?:^|[;\s])border(?:-top|-right|-bottom|-left)?:/m)
  assert.match(rule(files.couponInfoWxss, '.fabu .form .li .item-cont'), /background:\s*var\(--cy-color-bg-surface-subtle\)/)
  assert.match(rule(files.couponInfoWxss, '.fabu .form .li .item-cont2'), /background:\s*var\(--cy-color-bg-surface-subtle\)/)

  assert.match(files.settingsJs, /goDeregister\(\)\s*\{\s*this\.openScene\('settings-deregister'\);\s*\}/)
  assert.doesNotMatch(files.settingsJs, /goDeregister\(\)\s*\{\s*wx\.navigateTo/)
  assert.match(files.settingsWxml, /sceneCurrent\.id !== 'settings-identity-picker'[\s\S]*?<cy-scene-route-content/)
  assert.match(files.routeContentWxml, /<cy-scene-settings-deregister wx:if="\{\{sceneId === 'settings-deregister'\}\}"/)
  assert.match(files.deregisterWxml, /<cy-page-title title="注销账号"/)
  assert.match(files.deregisterWxml, /<cy-sheet[^>]*show="\{\{true\}\}"/)
  assert.doesNotMatch(files.deregisterWxml, /<cy-sheet[^>]*title=/)
  assert.match(files.deregisterWxml, /<cy-scene-settings-deregister id="deregisterFlow"/)
  assert.match(files.deregisterSceneJs, /require\('\.\.\/\.\.\/\.\.\/utils\/deregister-flow\.js'\)/)
  assert.match(files.deregisterFlowJs, /const\s+\{\s*sendUiStateRequest\s*\}\s*=\s*require\('\.\/ui-state-request\.js'\);/,
    '注销流程必须通过显式 UI-state 请求封装统一收口加载和错误状态')
  assert.match(files.deregisterFlowJs, /sendUiStateRequest\(app,\s*'\/api\/user\/deregister\/status'[\s\S]*sendUiStateRequest\(app,\s*'\/api\/user\/deregister\/precheck'/,
    '注销流程必须先查状态，再按服务状态执行资格预检')
  assert.match(files.deregisterFlowJs, /app\.recordConsent\([\s\S]*sendUiStateRequest\(app,\s*'\/api\/user\/deregister\/apply'/,
    '注销申请必须在同意记录成功后才提交')
  assert.match(files.uiStateRequestJs, /case\s+'\/api\/user\/deregister\/status':[\s\S]*case\s+'\/api\/user\/deregister\/precheck':[\s\S]*case\s+'\/api\/user\/deregister\/apply':[\s\S]*case\s+'\/api\/user\/deregister\/cancel':/,
    'UI-state 请求封装必须逐一登记注销状态、预检、申请和撤销端点')
  assert.match(files.uiStateRequestJs, /hideLoading:\s*true,[\s\S]*silentError:\s*true,/,
    'UI-state 请求必须由页面状态承接加载与错误，不能叠加全局 loading/toast')
  assert.match(files.uiStateRequestJs, /if\s*\(!options\s*\|\|\s*typeof options\.fail\s*!==\s*'function'\)\s*\{[\s\S]*throw new TypeError\('UI-state request 必须提供 fail handler'\)/,
    '页面状态请求缺少 fail handler 时必须 fail closed')
}

function sources() {
  return {
    tokens: read('style/tokens.wxss'),
    sheetWxss: read('components/cy/sheet/index.wxss'),
    sceneSheetWxss: read('components/cy/scene-sheet/index.wxss'),
    sceneSheetWxml: read('components/cy/scene-sheet/index.wxml'),
    sceneSheetJs: read('components/cy/scene-sheet/index.js'),
    tabsWxss: read('components/cy/tabs/index.wxss'),
    shotMatrix: read('scripts/shot-matrix.js'),
    orderWxss: read('components/cy/scene-member-order-detail/index.wxss'),
    tixianWxml: read('subpackageMember/tixian/tixian.wxml'),
    tixianWxss: read('subpackageMember/tixian/tixian.wxss'),
    tixianJs: read('subpackageMember/tixian/tixian.js'),
    tixianjiluWxml: read('subpackageMember/tixianjilu/tixianjilu.wxml'),
    tixianjiluJson: read('subpackageMember/tixianjilu/tixianjilu.json'),
    tixianjiluSceneWxml: read('components/cy/scene-member-withdraw-history/index.wxml'),
    tixianjiluSceneJs: read('components/cy/scene-member-withdraw-history/index.js'),
    myinviteWxml: read('subpackageMember/myinvite/myinvite.wxml'),
    myinviteJson: read('subpackageMember/myinvite/myinvite.json'),
    myinviteSceneWxml: read('components/cy/scene-member-invite-history/index.wxml'),
    myinviteSceneWxss: read('components/cy/scene-member-invite-history/index.wxss'),
    myinviteSceneJs: read('components/cy/scene-member-invite-history/index.js'),
    complaintWxml: read('subpackageMember/complaint/index.wxml'),
    complaintWxss: read('subpackageMember/complaint/index.wxss'),
    incomeWxml: read('subpackageA/pages/assetcenter/income-detail/income-detail.wxml'),
    incomeJson: read('subpackageA/pages/assetcenter/income-detail/income-detail.json'),
    routeContentJs: read('components/cy/scene-route-content/index.js'),
    incomeSceneWxml: read('components/cy/scene-asset-income-detail/index.wxml'),
    incomeSceneWxss: read('components/cy/scene-asset-income-detail/index.wxss'),
    incomeSceneJs: read('components/cy/scene-asset-income-detail/index.js'),
    earningsWxml: read('subpackageA/pages/assetcenter/earnings/index.wxml'),
    earningsWxss: read('subpackageA/pages/assetcenter/earnings/index.wxss'),
    earningsJs: read('subpackageA/pages/assetcenter/earnings/index.js'),
    earningsSceneWxml: read('components/cy/scene-asset-earnings/index.wxml'),
    earningsSceneWxss: read('components/cy/scene-asset-earnings/index.wxss'),
    earningsSceneJs: read('components/cy/scene-asset-earnings/index.js'),
    couponInfoWxss: read('subpackageMember/couponInfo/couponInfo.wxss'),
    settingsJs: read('pages/shezhi/shezhi.js'),
    settingsWxml: read('pages/shezhi/shezhi.wxml'),
    routeContentWxml: read('components/cy/scene-route-content/index.wxml'),
    deregisterWxml: read('pages/deregister/index.wxml'),
    deregisterSceneJs: read('components/cy/scene-settings-deregister/index.js'),
    deregisterFlowJs: read('utils/deregister-flow.js'),
    uiStateRequestJs: read('utils/ui-state-request.js'),
  }
}

test('D07/D08/D19/D22/D23/D25/D26/D28/D29/D33 展示契约', () => {
  const files = sources()
  if (process.env.B4_NEGATIVE_CONTROL === 'sheet-glass') {
    files.tokens = files.tokens.replace(
      /--cy-comp-sheet-player-bg:\s*#1C1C1E;/,
      '--cy-comp-sheet-player-bg: var(--cy-color-bg-glass);',
    )
  }
  if (process.env.B4_NEGATIVE_CONTROL === 'income-all-deep') {
    files.incomeSceneWxss = files.incomeSceneWxss.replace(
      'background: var(--cy-scene-card-bg, var(--cy-color-bg-surface-strong));',
      'background: var(--cy-color-bg-surface-strong);',
    )
  }
  assertAnnotationDContract(files)
})

test('负控：收益卡退回实心灰、Tab 渐隐退回页底都必须判红', () => {
  const original = sources()
  const allDeep = {
    ...original,
    incomeSceneWxss: original.incomeSceneWxss.replace(
      'background: var(--cy-scene-card-bg, var(--cy-color-bg-surface-strong));',
      'background: var(--cy-color-bg-surface-strong);',
    ),
  }
  assert.throws(() => assertAnnotationDContract(allDeep), /收益明细必须与漫游历史消费同一半透明卡片变量/)

  const blackFade = {
    ...original,
    incomeSceneWxss: original.incomeSceneWxss.replace(
      '--cy-tabs-fade-bg: var(--cy-comp-sheet-player-bg);',
      '--cy-tabs-fade-bg: var(--cy-bg-page);',
    ),
  }
  assert.throws(() => assertAnnotationDContract(blackFade), /Tab 渐隐端必须跟随弹窗底/)
})

test('负控：账户收益摘掉 theme-dark 或不再恢复深色导航必须判红', () => {
  const original = sources()
  const brokenTheme = {
    ...original,
    earningsWxml: original.earningsWxml.replace('er-page theme-dark', 'er-page'),
  }
  const brokenChrome = {
    ...original,
    earningsJs: original.earningsJs.replace('merchantTheme.merchantPageRestore()', 'merchantTheme.merchantPageShow()'),
  }
  assert.notEqual(brokenTheme.earningsWxml, original.earningsWxml, '负控锚点失效：收益页深色根不存在')
  assert.notEqual(brokenChrome.earningsJs, original.earningsJs, '负控锚点失效：收益页导航主题恢复不存在')
  assert.throws(() => assertAnnotationDContract(brokenTheme), /页面根必须显式进入深色主题/)
  assert.throws(() => assertAnnotationDContract(brokenChrome), /原生导航栏必须与玩家深色页面同步/)
})

test('D22/D28：入口原地开 scene，正文沿用旧页面请求路径与参数', () => {
  const files = sources()
  assert.match(files.tixianjiluSceneJs, /url:\s*'\/api\/withdrawal\/list'[\s\S]*?method:\s*'POST'[\s\S]*?data:\s*\{ pageNum: that\.data\.page_no, pageSize: app\.getPageSize\(\) \}/)
  assert.match(files.incomeSceneJs, /url:\s*'\/api\/user\/balance\/list'[\s\S]*?method:\s*'POST'[\s\S]*?data:\s*reqData/)
  assert.match(files.incomeSceneJs, /activeFilter === 'create'[\s\S]*?reqData\.eventType = '1'/)
  assert.match(files.incomeSceneJs, /activeFilter === 'brand'[\s\S]*?reqData\.eventType = '2'/)
})

test('负控：资金弹窗入口退回独立页、提现行退回横线时必须判红', () => {
  const original = sources()
  const broken = {
    ...original,
    earningsSceneJs: original.earningsSceneJs.replace(
      "openWithdrawHistory() { this.triggerEvent('open', { id: 'member-withdraw-history' }) }",
      "openWithdrawHistory() { wx.navigateTo({ url: '/subpackageMember/tixianjilu/tixianjilu' }) }",
    ),
    tixianWxss: original.tixianWxss.replace(
      'background: var(--cy-color-input-bg-empty);',
      'background: var(--cy-color-input-bg-empty); border-bottom: 1rpx solid var(--cy-border-line);',
    ),
  }
  assert.notEqual(broken.earningsSceneJs, original.earningsSceneJs, '负控锚点失效：提现记录场景入口不存在')
  assert.notEqual(broken.tixianWxss, original.tixianWxss, '负控锚点失效：提现灰色行不存在')
  assert.throws(() => assertAnnotationDContract(broken), assert.AssertionError)
})

test('负控：订单卡退回实心灰、投诉标题移出灰色容器时必须判红', () => {
  const original = sources()
  const broken = {
    ...original,
    orderWxss: original.orderWxss.replace(
      '--cy-comp-card-bg: var(--cy-scene-card-bg, var(--cy-color-bg-surface-strong));',
      '--cy-comp-card-bg: var(--cy-color-bg-elevated);',
    ),
    complaintWxml: original.complaintWxml.replace(
      '<view class="cp-field {{topicIndex >= 0 ? \'cp-field--filled\' : \'\'}}">\n        <text class="cp-label">投诉活动',
      '<text class="cp-label">投诉活动',
    ),
  }
  assert.notEqual(broken.orderWxss, original.orderWxss, '负控锚点失效：订单卡共享底色不存在')
  assert.notEqual(broken.complaintWxml, original.complaintWxml, '负控锚点失效：投诉标题容器不存在')
  assert.throws(() => assertAnnotationDContract(broken), assert.AssertionError)
})

test('负控：收益明细退回弹层形态、注销入口退回整页跳转时必须判红', () => {
  const original = sources()
  const broken = {
    ...original,
    // 退回弹层形态:把正文重新裹进 cy-sheet(标题就又变成两个)
    incomeWxml: original.incomeWxml.replace(
      '<view class="id-page-body">',
      '<cy-sheet show="{{true}}" title="收益明细"><view class="id-page-body">',
    ),
    settingsJs: original.settingsJs.replace(
      /goDeregister\(\)\s*\{\s*this\.openScene\('settings-deregister'\);\s*\}/,
      "goDeregister() { wx.navigateTo({ url: '/pages/deregister/index' }); }",
    ),
  }
  assert.notEqual(broken.incomeWxml, original.incomeWxml, '负控锚点失效：收益明细页面正文块不存在')
  assert.notEqual(broken.settingsJs, original.settingsJs, '负控锚点失效：注销弹窗入口不存在')
  assert.throws(() => assertAnnotationDContract(broken), assert.AssertionError)
})
