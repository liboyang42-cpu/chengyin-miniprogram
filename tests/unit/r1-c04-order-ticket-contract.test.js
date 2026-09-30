// H09:订单列表内容与逻辑已搬到 components/cy/scene-member-order-history(页面退化成深链薄壳),
// 断言随之指向组件文件;判据本身一条没放宽。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const MYCANYUINFO_JS = path.join(ROOT, 'subpackageMember/components/scene-member-participation-detail/index.js')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rule(source, selector) {
  const match = source.match(new RegExp(escapeRegExp(selector) + '\\s*\\{([^}]*)\\}'))
  assert.ok(match, '缺少 WXSS 规则 ' + selector)
  return match[1]
}

function assertOrderActionTokens(wxss) {
  const primary = rule(wxss, '.orderbut2')
  assert.match(primary, /height:\s*88rpx/, '订单主动作命中区必须是 88rpx')
  assert.match(primary, /background:\s*var\(--cy-btn-solid-bg\)/, '立即支付/查看票夹必须是中性反色主 CTA')
  assert.match(primary, /color:\s*var\(--cy-btn-solid-fg\)/, '订单主 CTA 前景必须使用反色 token')

  const play = rule(wxss, '.orderbut-play')
  assert.match(play, /background:\s*var\(--cy-btn-solid-bg\)/, '查看票夹不得退回硬编码或 danger 背景')
  assert.match(play, /color:\s*var\(--cy-btn-solid-fg\)/, '查看票夹不得退回硬编码前景')
}

function assertMyCanyuInfoStates(rawWxml) {
  // 先剥注释:R2 的说明注释里引了旧写法原文,不剥会把注释当成现码(反向假红)
  const wxml = rawWxml.replace(/<!--[\s\S]*?-->/g, '')
  // 总控根因修复轮:补了 fill(整屏居中吃满剩余空间),标签末尾不再恰好收在 title 后
  assert.match(wxml, /<cy-empty\s+wx:if="\{\{loadState === 'loading'\}\}"\s+kind="loading"\s+title="参与详情加载中"[^>]*\/>/)
  // R2 推翻 R1 这一条:原来钉的是 retry="{{id ? '重试' : ''}}",而空标签在缺 id 时等于
  // 整屏无按钮(受控截图 05)。现在钉「动作槽由状态驱动」,具体分档行为由
  // c04-r2-recovery-path-contract.test.js 行为级断言。
  // 总控根因修复轮:补了 fill(整屏居中吃满剩余空间),标签末尾跟在 bind:retry 后面
  assert.match(wxml, /<cy-error\s+wx:elif="\{\{loadState === 'error'\}\}"[^>]*retry="\{\{errorActionText\}\}"[^>]*bind:retry="onErrorAction"[^>]*\/>/)
  assert.doesNotMatch(wxml, /retry="\{\{id \? '重试' : ''\}\}"/, '缺参数时不得退回空动作槽')
  assert.match(wxml, /<block\s+wx:else>/, 'ready 态必须与 loading/error 互斥')
}

function loadMyCanyuInfoPage() {
  const sandbox = { requests: [], toasts: [] }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: options => sandbox.requests.push(options),
  })
  global.Page = config => { sandbox.pageConfig = config }
  // 参与详情已组件化:摊平成 Page 的形状,断言逐字不变。
  global.Component = config => { sandbox.pageConfig = flattenComponentToPage(config) }
  global.wx = {
    showToast: options => sandbox.toasts.push(options.title),
    navigateBack() {},
    navigateTo() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
  }
  delete require.cache[require.resolve(MYCANYUINFO_JS)]
  require(MYCANYUINFO_JS)
  const page = Object.assign({}, sandbox.pageConfig, {
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.data = Object.assign({}, sandbox.pageConfig.data)
  return { page, sandbox }
}

test('C04 signup: 票券标题统一使用页面左右边距，不再横向溢出', () => {
  // 2026-07-31:优惠券列表(.david)已整体搬到 subpackageMember/coupon(删除票夹页优惠券 tab),
  // 这条边距契约的适用面缩小到本页仍保留的票夹标题结构。
  // 2026-09-18 UI-17:卡外票名 .david_hdname 已删(票名只在票面出现一次),对应断言随之摘除。
  const wxss = read('subpackageMember/signup/index.wxss')
  assert.match(rule(wxss, '.signup .toolbar'), /margin:\s*44rpx\s+var\(--cy-page-x\)\s+var\(--cy-legacy-18\)\s+var\(--cy-page-x\)/)
  assert.doesNotMatch(wxss, /\.david_hdname/)
})

test('C04 mytemplate: loading、更多操作命中区与危险菜单语义明确', () => {
  const wxml = read('subpackageMember/mytemplate/mytemplate.wxml')
  const wxss = read('subpackageMember/mytemplate/mytemplate.wxss')
  // 2026-07-31 QA 复核(根因2+aaa追加):补 fill(剩余空间居中)+ size="lg"(文字/配图放大)
  // class="fill-slot":让宿主节点本身成为 flex 项(组件内部的 fill 撑不开宿主),整条 flex 链的最后一环
  assert.match(wxml, /<cy-empty\s+wx:if="\{\{loading && list\.length === 0\}\}"\s+kind="loading"\s+fill\s+size="lg"\s+class="fill-slot"\s+title="正在加载你的节点玩法"\s*\/>/)
  assert.match(wxml, /class="dot flex-cc"[^>]*aria-role="button"[^>]*aria-label="更多操作"/)
  assert.match(wxml, /class="dd dd--danger flex-ac"\s+bindtap="deleteItem"/)
  assert.match(rule(wxss, '.project .activity-list .li .item .item-txt2 .item-tit .dot'), /width:\s*88rpx[\s\S]*height:\s*88rpx/)
  // R3 更正:字形由近黑的 icon_dot.png 换成已注册的 cy-icon name="more"(mask + currentColor),
  // 故原先钉 `.dot image` 32rpx 的那条已不适用;可见性断言见 c04-r3-legibility-affordance-contract。
  assert.match(read('subpackageMember/mytemplate/mytemplate.wxml'), /<cy-icon\s+name="more"\s+size="40"\s*\/>/)
  assert.match(rule(wxss, '.project .activity-list .li .item .item-txt2 .item-dl .dd.dd2 .cont text'), /color:\s*var\(--cy-text-title\)/)
  assert.match(rule(wxss, '.project .activity-list .li .item .dropdown .dd'), /color:\s*var\(--cy-text-title\)/)
  assert.match(rule(wxss, '.project .activity-list .li .item .dropdown .dd.dd--danger'), /color:\s*var\(--cy-danger\)/)
  assert.doesNotMatch(wxss, /dropdown \.dd:nth-child/, '互斥菜单项不能按运行时序号染色')
  // R4-C04:封面选源/本地图片 fallback 未获 §5.5 授权,已按 github/master 原形恢复为
  // 「标题首字 + DS 渐变」兜底 + item.imgUrl 主图条件(细节断言见 mytemplate-cover-fallback)。
  assert.match(wxml, /class="item-pic-fallback"[^>]*aria-role="img"/)
  assert.match(wxml, /wx:if="\{\{item\.imgUrl && !item\.coverFailed\}\}"/)
  assert.match(wxml, /\{\{item\.coverInitial \|\| '玩'\}\}/)
  const metric = rule(wxss, '.david_moban')
  assert.match(metric, /background:\s*var\(--cy-color-overlay\)/)
  assert.match(metric, /font-size:\s*var\(--cy-type-micro\)/)
})

// R2 推翻 R1 §5.10「本轮零改动」:那条结论来自读源码注释,没核 z 层级 —— 返回钮其实
// 被 z=900 的凭证遮罩埋住,看得见点不动。返回钮可达性由
// c04-r2-recovery-path-contract.test.js 用「z 数字关系」断言,这里只保留组件收编事实。
test('C04 coupon-qr: 已收编二维码组件，状态容器仍由 qrState 驱动', () => {
  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  assert.match(wxml, /<cy-qr-voucher[\s\S]*state="\{\{qrState\}\}"/)
})

test('C04 coupon: 空态有出路，导航文字动作与弹层 token 化', () => {
  const wxml = read('subpackageMember/coupon/coupon.wxml')
  const wxss = read('subpackageMember/coupon/coupon.wxss')
  // 2026-07-31 UI 改版第2批:"新建"从导航栏文字入口移到底部固定按钮(用户原话"新建按钮放到下面"),
  // 空态提示文案随之改指向下方按钮;空态同时套 aaa 标准(fill)
  // 2026-07-31 QA 复核(aaa追加):补 size="lg"(文字/配图放大)
  // class="fill-slot" 是让宿主节点本身成为 flex 项的钩子(组件内部的 fill 撑不开宿主),
  // 少了它整条 flex 链断在最后一环,空态不居中 —— 属于契约的一部分,一起钉住
  // CU-M-142:券的用途只在页标题副文案写一遍,空态不再重复同一句(也不许再长出 sub)
  assert.match(wxml, /<cy-empty\s+wx:if="\{\{loadState === 'ready' && list\.length === 0\}\}"\s+kind="empty"\s+fill\s+size="lg"\s+class="fill-slot"\s+title="还没有优惠券"\s*\/>/)
  assert.match(wxml, /<cy-error\b[^>]*wx:elif="\{\{loadState === 'error'\}\}"[^>]*title="优惠券加载失败"[^>]*sub="\{\{errorMsg\}\}"[^>]*bind:retry="retryLoad"/)
  // "新建"从导航栏文字入口移到底部固定 cy-btn(见上一条注释),.coupon-page__action 随之作废并删除;
  // 底部按钮走 cy-footer-bar + cy-btn 组件默认命中区/配色,不需要页面私有规则再断言一遍
  assert.match(wxml, /<cy-footer-bar wx:if="\{\{loadState === 'ready' && !tpShow\}\}">[\s\S]*<cy-btn variant="primary" bindtap="GoAdd">新建<\/cy-btn>[\s\S]*<\/cy-footer-bar>/)
  assert.doesNotMatch(wxss, /\.coupon-page__action/)
  assert.match(wxml, /<cy-sheet show="\{\{tpShow\}\}"[^>]*bind:close="tpClose"/)
  assert.match(rule(wxss, '.david_tkb_li'), /border-radius:\s*var\(--cy-radius-lg\)/)
  assert.doesNotMatch(rule(wxss, '.david_tkb_li'), /(?:^|;)\s*border\s*:/)
  assert.doesNotMatch(rule(wxss, '.david_tkb_li_con_top'), /border-(?:top|bottom)\s*:/)
})

test('C04 couponInfo: 按钮恢复组件 88rpx，底栏与内容对齐 token 化', () => {
  const wxml = read('subpackageMember/couponInfo/couponInfo.wxml')
  const wxss = read('subpackageMember/couponInfo/couponInfo.wxss')
  assert.doesNotMatch(wxml, /--cy-btn-h:\s*80rpx/)
  assert.match(rule(wxss, '.fabu'), /padding-bottom:\s*calc\(var\(--cy-comp-footer-h\) \+ var\(--cy-space-4\)\)/)
  assert.match(rule(wxss, '.fabu.theme-topic-editor .wp'), /padding:\s*0\s+var\(--cy-page-x\)\s+0/) // aaa v2:标题下间距由 cy-page-title space-5 独家供给
  assert.match(rule(wxss, '.fabu .form .li .item-tit text'), /margin-left:\s*var\(--cy-legacy-4\)/)
})

test('C04 complaint: 使用统一导航并区分 loading、error、empty 三态', () => {
  const json = read('subpackageMember/complaint/index.json')
  const wxml = read('subpackageMember/complaint/index.wxml')
  const wxss = read('subpackageMember/complaint/index.wxss')
  assert.match(json, /"navigationStyle":\s*"custom"/)
  for (const component of ['cy-empty', 'cy-error', 'cy-icon', 'cy-inline-error', 'cy-nav-bar', 'cy-page-title', 'cy-skeleton']) assert.match(json, new RegExp('"' + component + '"'))
  assert.match(wxml, /<cy-nav-bar\s+custom-back\s+bind:back="onBack"\s*\/>/)
  assert.match(wxml, /<cy-page-title\s+title="投诉与建议"/)
  // aaa 三件套(整屏空态补 fill+size=lg)后属性顺序变了，正则放宽到"包含"而非"紧邻"，断言意图不变
  assert.match(wxml, /<cy-skeleton\b[^>]*wx:if="\{\{loading\}\}"[^>]*type="form-section"[^>]*loading-label="正在加载可投诉的活动"[^>]*\/>/)
  assert.match(wxml, /<cy-error\b[^>]*\btitle="可投诉活动没能加载出来"[^>]*\bsub="\{\{errorMsg\}\}"[^>]*\bbind:retry="onRetry"[^>]*\/>/)
  assert.match(wxml, /<cy-empty\b[^>]*\bkind="empty"[^>]*\btitle="暂无可投诉的活动"/)
  assert.doesNotMatch(wxml, /class="cp-title"/, '页面标题不能与表单内同名标题重复')
  assert.doesNotMatch(wxml, /class="cp-copy"/, '标题副文案存在时，卡内不得保留同义说明')
  assert.doesNotMatch(wxss, /\.cp-copy\s*\{/, '删除卡内同义说明后不得保留无用样式')
  assert.match(rule(wxss, '.cp-content'), /padding:\s*0\s+var\(--cy-page-x\)\s+var\(--cy-space-7\)/)
  assert.doesNotMatch(rule(wxss, '.cp-page'), /padding:/, '标题不应被内容容器的横向内距二次缩进')
})

test('C04 order: 订单列表使用注册过的统一 skeleton 与中性主 CTA', () => {
  const json = read('components/cy/scene-member-order-history/index.json')
  const wxml = read('components/cy/scene-member-order-history/index.wxml')
  const wxss = read('components/cy/scene-member-order-history/index.wxss')
  assert.match(json, /"cy-skeleton":\s*"\/components\/cy\/skeleton\/index"/)
  assert.match(wxml, /<cy-skeleton\s+wx:if="\{\{loading && list\.length==0\}\}"\s+type="list"\s+count="3"\s*\/>/)
  assert.match(rule(wxss, '.orderbut1'), /height:\s*88rpx/)
  assertOrderActionTokens(wxss)
  // 第3批 UI 复查:用户要求卡片间距加大,--cy-space-3-5 → --cy-space-5
  // 左右边距改由 scene-sheet 正文提供(再补 --cy-page-x 会双份缩进);卡间距仍是 --cy-space-5。
  //
  // ⚠️ 2026-08-08 改成语义断言。原来钉的是字面量 `margin: 0 0 var(--cy-space-5)`,
  // 卡片统一到 --cy-scene-card-* 之后写成 `var(--cy-scene-card-gap, var(--cy-space-5))` ——
  // **兜底值一模一样、视觉零变化**,却被判红。钉字面量只能证明「这行没被改过」,
  // 还会反向锁死正当的 token 化(见 feedback-false-green-test-patterns 第 5 种)。
  // 现在测的是「卡间距最终解析到 --cy-space-5」,直接写和经 --cy-scene-card-gap 兜底都算过。
  assert.match(
    rule(wxss, '.orderbox_li'),
    /margin:\s*0\s+0\s+var\(--cy-space-5\)|margin:\s*0\s+0\s+var\(--cy-scene-card-gap,\s*var\(--cy-space-5\)\)/,
    '卡间距必须解析到 --cy-space-5(可经 --cy-scene-card-gap 兜底)'
  )
})

// 2026-07-30:登机牌式重设计把订单主体从「.orxq/.orcon/.orbut/.refund-card 逐块对齐 page-x」
// 换成了「.body 单一容器统一 padding,内部卡片继承」——原理不变(主体与页面标题同一左右边距),
// 落地方式改了,类名跟着换。危险动作描边、不与主 CTA 抢视觉重量的原则本身未变。
test('C04 orderinfo: loading 组件化、危险动作描边且不与快捷主动作竞争', () => {
  const json = read('components/cy/scene-member-order-detail/index.json')
  const wxml = read('components/cy/scene-member-order-detail/index.wxml')
  const wxss = read('components/cy/scene-member-order-detail/index.wxss')
  assert.match(json, /"cy-empty":\s*"\/components\/cy\/empty\/index"/)
  assert.match(wxml, /<cy-empty[^>]*wx:if="\{\{loadState==='loading'\}\}"[^>]*kind="loading"[^>]*title="订单详情加载中"[^>]*\/>/)
  assert.match(wxml, /wx:if="\{\{showSecondaryTicket\}\}"\s+class="sec-btn sec-solid"/, '查看票夹次级动作必须按 showSecondaryTicket 受控展示,不与主 CTA 同屏抢位')
  assert.match(rule(wxss, '.body'), /padding:\s*0\s+var\(--cy-page-x\)/, '订单主体必须与页面统一左右边距对齐')
  const cancel = rule(wxss, '.sec-danger')
  assert.match(cancel, /background:\s*transparent/)
  assert.match(cancel, /border:\s*2rpx\s+solid\s+var\(--cy-danger\)/)
  // 2026-09-18 UI-16:用户指出详情页按钮太高、格式不对,次级动作统一降到 DS 小档
  // --cy-btn-h-sm(64rpx);主 CTA .primary-cta 仍由 primary-button-height-contract 守 88rpx。
  assert.match(rule(wxss, '.sec-btn'), /height:\s*var\(--cy-btn-h-sm\)/)
  assert.match(rule(wxss, '.sec-solid'), /background:\s*var\(--cy-btn-solid-bg\)/)
  assert.match(rule(wxss, '.refund-main'), /color:\s*var\(--cy-text-title\)/)
})

// 第3批 UI 复查:用户重新看过这页截图后明确要求"tab 需要横向平均分布"——chip 是左对齐、
// 不平均分布,已由 fill(等宽铺满,与 mylike 同一套)取代,这是产品决定的更新,不是随手改样式。
test('C04 mycanyu: 同域筛选使用等宽铺满的 fill，并为底部手势区留出空间', () => {
  const wxml = read('subpackageMember/mycanyu/mycanyu.wxml')
  const wxss = read('subpackageMember/mycanyu/mycanyu.wxss')
  assert.match(wxml, /<cy-tabs\s+active="\{\{activeTab\}\}"\s+bind:change="switchTab"\s+tabs="\{\{tabs\}\}"\s+variant="fill"\s*\/>/)
  assert.match(rule(wxss, '.canyubox_li_right_top_name'), /line-height:\s*var\(--cy-leading-tight\)/)
  assert.match(rule(wxss, '.canyubox'), /padding-bottom:\s*var\(--cy-safe-bottom\)/)
  assert.doesNotMatch(wxss, /import merchant-light/, '暗色参与页不得保留与现码相反的浅色主题注释')
})

test('C04 mycanyuinfo: 详情标题、三态和真实底部动作一致', () => {
  const js = read('subpackageMember/components/scene-member-participation-detail/index.js')
  const json = read('subpackageMember/mycanyuinfo/mycanyuinfo.json')
  const wxml = read('subpackageMember/components/scene-member-participation-detail/index.wxml')
  const wxss = read('subpackageMember/components/scene-member-participation-detail/index.wxss')
  assert.match(json, /"navigationBarTitleText":\s*"参与详情"/)
  // 标题的承载随层级改造分成两处:深链壳里仍是 cy-page-title;
  // 站内是三级弹窗,标题由 scene-sheet 头部渲染、取自注册表。两边都必须是「参与详情」。
  assert.match(read('subpackageMember/mycanyuinfo/mycanyuinfo.wxml'), /<cy-page-title\s+title="参与详情"\s+safe-top="\{\{false\}\}"\s*\/>/)
  assert.match(
    read('utils/scene-registry.js'),
    /'member-participation-detail':\s*\{[^}]*title:\s*'参与详情'/,
    '弹窗标题取自注册表,必须与页面壳一致'
  )
  assertMyCanyuInfoStates(wxml)
  assert.match(js, /onErrorAction\(\)\s*\{/)
  assert.match(wxml, /wx:elif="\{\{displayInfo\.formatDateRange\}\}"/)
  assert.match(wxml, /class="cyinfobox_tw_left"\s+wx:if="\{\{displayInfo\.picUrl\}\}"/)
  assert.doesNotMatch(wxml, /cyinfobottom_box_gong/, '零功能公告不能伪装成主按钮')
  assert.match(wxml, /class="cyinfo-footer-spacer"/)
  assert.match(rule(wxss, '.cyinfo-footer-spacer'), /height:\s*var\(--cy-comp-footer-h\)/)
  assert.match(rule(wxss, '.cyinfobottom_box_but'), /height:\s*var\(--cy-btn-h\)/)
  assert.match(rule(wxss, '.cyinfobottom'), /padding:\s*var\(--cy-comp-footer-pad-y\)\s+0/)
  assert.match(rule(wxss, '.cyinfobottom'), /padding-bottom:\s*calc\(var\(--cy-comp-footer-pad-y\) \+ env\(safe-area-inset-bottom\)\)/)
  assert.ok(
    wxml.indexOf('<view class="cyinfobottom_sum"') < wxml.indexOf('<view class="cyinfo-footer-spacer"></view>')
      && wxml.indexOf('<view class="cyinfo-footer-spacer"></view>') < wxml.indexOf('<view class="cyinfobottom">'),
    '规则说明必须留在文档流，固定底栏只能由对应 spacer 避让'
  )
})

test('C04 mycanyuinfo: 缺参、接口失败、重试成功各自进入可观察状态', () => {
  // 组件入参是 recordId property(会镜像进 data),不再是页面的 onLoad(options)
  let ctx = loadMyCanyuInfoPage()
  ctx.page.onLoad()
  assert.equal(ctx.sandbox.requests.length, 0, '缺少 id 时不应发无效请求')
  assert.equal(ctx.page.data.loadState, 'missing-param', '缺参不能停在无限 loading')
  assert.ok(ctx.page.data.loadErrorText)

  ctx = loadMyCanyuInfoPage()
  ctx.page.data.recordId = '33'
  ctx.page.onLoad()
  assert.equal(ctx.page.data.loadState, 'loading')
  ctx.sandbox.requests[0].success({ code: '500', msg: '参与记录不存在' })
  assert.equal(ctx.page.data.loadState, 'error')
  assert.equal(ctx.page.data.loadErrorText, '参与记录不存在', '后端错误必须保留在页面态')

  ctx.page.onErrorAction()
  assert.equal(ctx.page.data.loadState, 'loading', '重试在途必须回到 loading')
  assert.equal(ctx.sandbox.requests.length, 2, '重试必须沿用已有 id 再发请求')
  ctx.sandbox.requests[1].success({ code: '200', data: { topicName: '城市路线', displayStatus: '审核中' } })
  assert.equal(ctx.page.data.loadState, 'ready')
  assert.equal(ctx.page.data.loadErrorText, '')
})

test('negative control: 订单主 CTA 退回 danger 实底时，契约必须判红', () => {
  const wxss = read('components/cy/scene-member-order-history/index.wxss')
  const mutated = wxss.replace(
    /(\.orderbut2\s*\{[^}]*?)background:\s*var\(--cy-btn-solid-bg\)/,
    '$1background: var(--cy-danger)'
  )
  assert.notEqual(mutated, wxss, '变异锚点失效：订单主 CTA 未使用预期 token')
  assert.throws(() => assertOrderActionTokens(mutated), assert.AssertionError)
})

test('negative control: 参与详情把 error 分支并回 ready 时，三态契约必须判红', () => {
  const wxml = read('subpackageMember/components/scene-member-participation-detail/index.wxml')
  const mutated = wxml.replace("loadState === 'error'", "loadState === 'ready'")
  assert.notEqual(mutated, wxml, '变异锚点失效：没有独立 error 分支')
  assert.throws(() => assertMyCanyuInfoStates(mutated), assert.AssertionError)
})
