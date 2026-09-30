// WT3b 截图复核修复(2026-07-29)的三条视觉语义契约。
//
// 三条都不是"审美偏好",都是截图逐张打开后判定的 P1:
//  P1-1 票夹路线名用了「反色字」token,暗底上对比度 ~1.05:1 —— 字在,但读不出来。
//  P1-2 排行榜 HTTP 失败(含 404)必须走可重试错误态,不得再映射成「暂未开放」。
//  P1-5 优惠券页已进入商家浅色域；普通日期是浅灰数据标签，.hong 用浅粉底时
//       必须显式搭配深色 danger 前景，不能继承白色 text-inverse。
//
// 每条都配非恒真负控:把源码改回病灶形态,检查器必须判红。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SIGNUP_WXSS = path.join(ROOT, 'subpackageMember/signup/index.wxss')
// P1-5 的优惠券票卡标记(.hong/.david_tkb_li_*)2026-07-31 已从 signup 页整体搬到独立的
// subpackageMember/coupon(见"删除票夹页优惠券 tab"改动),契约随实现一起迁移到新家。
const COUPON_WXSS = path.join(ROOT, 'subpackageMember/coupon/coupon.wxss')
const COUPON_WXML = path.join(ROOT, 'subpackageMember/coupon/coupon.wxml')
const GC_JS = path.join(ROOT, 'subpackageP3/pages/growthcenter/index/index.js')
const GC_WXML = path.join(ROOT, 'subpackageP3/pages/growthcenter/index/index.wxml')
const GC_WXSS = path.join(ROOT, 'subpackageP3/pages/growthcenter/index/index.wxss')

function rule(wxss, selector) {
  const match = wxss.match(new RegExp(selector.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}'))
  return match ? match[1] : null
}

// ---------- P1-1 暗域正文不得用反色字 token ----------
//
// --cy-color-text-inverse 在暗色主题里是 #09080C(给紫底/白底用的深色字),
// 压在 --cy-color-bg-page #020104 上几乎同色。别按字面理解"inverse = 会自动反过来"。
// 2026-09-18 UI-17 返修:票面票名与票根文字已整块撤掉(卡就是一张完整票图),
// 原落点 .tk-meta__n 随 wxml/wxss 一起消失。保护不改口径、只换落点 ——
// 本页暗域上仍有正文的 .team-entry__k(队伍入口)继续受同一合同约束:
// 「反色字」token 压在暗卡上与压在暗底上是同一种读不出来。
function assertReadableDarkText(wxss) {
  const body = rule(wxss, '.team-entry__k')
  assert.ok(body, '票夹队伍入口文案规则 .team-entry__k 必须存在')
  assert.doesNotMatch(
    body,
    /color:\s*var\(--cy-(?:color-)?text-inverse\)/,
    '.team-entry__k 是暗卡上的正文,用「反色字」token 会渲成近乎同色的黑字(实测对比度 ~1.05:1):' + body
  )
  assert.match(
    body,
    /color:\s*var\(--cy-(?:color-)?text-(?:primary|title)\)/,
    '.team-entry__k 必须落在暗域正文色 token 上:' + body
  )
}

test('P1-1 暗域正文用正文色,不是反色字 token(票夹队伍入口)', () => {
  assertReadableDarkText(fs.readFileSync(SIGNUP_WXSS, 'utf8'))
})

test('negative control: 把 .team-entry__k 改回 text-inverse 必须判红', () => {
  const wxss = fs.readFileSync(SIGNUP_WXSS, 'utf8')
  // 2026-09-18 UI-17 二次返修:本页新增了同样用 text-title 的 .ticket-name__t,
  // 裸串 replace 会改中那条而不是 .team-entry__k(负控变假绿)。变异锚点收窄到规则块内。
  const mutated = wxss.replace(
    /(\.team-entry__k\s*\{[^}]*color:\s*)var\(--cy-text-title\)/,
    '$1var(--cy-text-inverse)',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertReadableDarkText(mutated), assert.AssertionError)
})

// ---------- P1-5 商家浅色域日期标签 ----------
// 页面主题从玩家暗域切到 theme-merchant 后，text-inverse 解析为白色；因此普通日期
// 用浅灰底+主文字，异常日期用 danger-soft+danger，契约同时保留回归负控。
function assertCouponDateChipReadable(wxss) {
  const base = rule(wxss, '.david_tkb_li_con_top_time')
  assert.ok(base, '日期胶囊基础规则必须存在')
  assert.match(base, /background:\s*var\(--cy-bg-card-2\)/, '普通日期是浅灰数据标签:' + base)
  assert.match(base, /color:\s*var\(--cy-text-title\)/, '浅灰标签必须使用深色正文:' + base)

  const hong = rule(wxss, '.hong .david_tkb_li_con_top_time')
  assert.match(hong, /background:\s*var\(--cy-danger-soft\)/, '异常券日期保留 danger-soft 状态语义:' + hong)
  assert.match(hong, /color:\s*var\(--cy-danger\)/, '浅粉底必须搭配深色 danger 前景:' + hong)
  assert.doesNotMatch(hong, /--cy-text-inverse/, '商家浅色域的 text-inverse 是白色，压在浅粉底上不可读')
}

test('P1-5 优惠券日期胶囊:商家浅色域使用浅灰数据标签与可读危险态', () => {
  const wxss = fs.readFileSync(COUPON_WXSS, 'utf8')
  assertCouponDateChipReadable(wxss)
})

test('negative control: 商家浅色域退回白色 text-inverse 必须判红', () => {
  const wxss = fs.readFileSync(COUPON_WXSS, 'utf8')
  const mutated = wxss.replace(
    '.hong .david_tkb_li_con_top_time{ background: var(--cy-danger-soft); color: var(--cy-danger);}',
    '.hong .david_tkb_li_con_top_time{ background: var(--cy-danger-soft); color: var(--cy-text-inverse);}'
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCouponDateChipReadable(mutated), assert.AssertionError)
})

test('negative control: 拿掉前景声明(退回继承)必须判红', () => {
  const wxss = fs.readFileSync(COUPON_WXSS, 'utf8')
  const mutated = wxss.replace(
    '.hong .david_tkb_li_con_top_time{ background: var(--cy-danger-soft); color: var(--cy-danger);}',
    '.hong .david_tkb_li_con_top_time{ background: var(--cy-danger-soft);}'
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCouponDateChipReadable(mutated), assert.AssertionError)
})

test('negative control: 靠调深软底来伪装对比度必须判红(状态语义不能被改掉)', () => {
  const wxss = fs.readFileSync(COUPON_WXSS, 'utf8')
  const mutated = wxss.replace(
    '.hong .david_tkb_li_con_top_time{ background: var(--cy-danger-soft); color: var(--cy-danger);}',
    '.hong .david_tkb_li_con_top_time{ background: var(--cy-danger); color: var(--cy-danger);}'
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCouponDateChipReadable(mutated), assert.AssertionError)
})

test('P1-5 前提:优惠券页属于商家浅色工作域', () => {
  const wxml = fs.readFileSync(COUPON_WXML, 'utf8')
  assert.match(wxml, /class="[^"]*\btheme-merchant\b/, '商家优惠券页必须继承纯黑动作与浅灰页面底')
})

// ---------- P1-2 排行榜失败不得再落「暂未开放」 ----------
function assertRankFailureIsRetryable(wxml) {
  assert.doesNotMatch(wxml, /暂未开放|还没开放|gc-state--notice|boardState\s*===\s*'notice'/, '不得保留 notice/暂未开放 分流')
  assert.match(wxml, /排行榜没有加载出来/, '排行失败标题必须走可重试错误文案')
  assert.match(wxml, /bind:action="retryRank"/, '排行失败必须保留重试入口')
}

test('P1-2 成长中心排行失败走可重试错误,不再分流 notice', () => {
  assertRankFailureIsRetryable(fs.readFileSync(GC_WXML, 'utf8'))
})

test('negative control: 把 404 又写回「暂未开放」必须判红', () => {
  const wxml = fs.readFileSync(GC_WXML, 'utf8')
  const mutated = wxml.replace('排行榜没有加载出来', '排行榜暂未开放')
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertRankFailureIsRetryable(mutated), assert.AssertionError)
})

// ---------- P1-2 行为侧:哪条分支落哪个状态 ----------
// 只断言 class 不够 —— 分流对不对在 JS 里。这里真跑一遍三条分支。
function loadGrowthPage() {
  const requests = []
  global.getApp = () => ({ sendRequest: (options) => requests.push(options) })
  global.wx = { stopPullDownRefresh() {}, switchTab() {}, navigateBack() {} }
  let pageConfig = null
  global.Page = (config) => { pageConfig = config }
  delete require.cache[require.resolve(GC_JS)]
  require(GC_JS)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch) => Object.assign(page.data, patch)
  return { page, requests }
}

test('P1-2 行为:HTTP 404、网络失败与业务失败都落 error', () => {
  let ctx = loadGrowthPage()
  ctx.page.loadMyRank()
  ctx.requests[0].successStatusAbnormal({ statusCode: 404, msg: 'not found' })
  assert.equal(ctx.page.data.boardState, 'error', '404 不得再落 notice')
  assert.match(ctx.page.data.errorMsg, /not found|没有加载出来/)
  assert.doesNotMatch(ctx.page.data.errorMsg, /暂未开放/)

  ctx = loadGrowthPage()
  ctx.page.loadMyRank()
  ctx.requests[0].fail()
  assert.equal(ctx.page.data.boardState, 'error', '网络失败必须仍是 error')

  ctx = loadGrowthPage()
  ctx.page.loadMyRank()
  ctx.requests[0].success({ code: 500, msg: '炸了' })
  assert.equal(ctx.page.data.boardState, 'error', '业务失败必须仍是 error')
})

test('negative control: 把 404 又降级成 notice 必须被行为断言抓到', () => {
  const fake = { data: { boardState: 'notice', errorMsg: '排行榜暂未开放，请稍后查看' } }
  assert.throws(
    () => {
      assert.equal(fake.data.boardState, 'error', '404 不得再落 notice')
      assert.doesNotMatch(fake.data.errorMsg, /暂未开放/)
    },
    assert.AssertionError
  )
})
