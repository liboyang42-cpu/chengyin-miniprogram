/* 审查 C · A1(2026-09-15):页内搜索 / 筛选 / 局部重拉失败,不能触发整页自动退页
 *
 * 病:弹窗合同把「整页加载失败 → 零钮 fail 半屏 + 2s 自动 navigateBack」接进了一批页面,
 * 但 auto-back 写成了**无条件字面量**。这些页面同时还有「读到内容之后再发一次请求」的路:
 *   - pages/club/customers        onKeywordInput(防抖 300ms)/ onKeywordConfirm / onFilterTap → load()
 *   - pages/merchant/customer     换分段 / 换标签 / 换关键词 → load(),queryChanged 时先清 rows
 *   - pages/search2/result        onSearchConfirm → runSearch(),换 query 时先清 visibleResults
 *   - pages/activity/baoming      退候补成功后 getActivityInfo() 重拉
 * 这一次请求失败,页面就落回 error 态 → auto-back 恒真 → 2s 后把人连页带输入一起退掉。
 * 用户刚打的关键词、刚选的分群、刚建的群发草稿全丢,而且他并没有要求离开这一页。
 *
 * 合同:auto-back 只认**首屏**加载失败(这页从来没成功渲染过内容 —— 用户此刻确实无事可做)。
 * 一旦成功渲染过一次,后续的局部 / 重拉失败留在页内(inline 失败态 + 重试),不准自动退页。
 * 判据 = 绑定必须是 `auto-back="{{!everLoaded}}"` 这类条件式,且页面 JS 真的在成功渲染后置位。
 * 形状断言(静态)只证明写法,能不能真红看第 ③ 组行为断言 —— 那里是把页面挂起来实跑的。
 */
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')

// 这四页都是「读到内容之后还会在页内再发请求」的,所以 auto-back 必须带首屏条件。
// 判据锚在**具体那一行 cy-error 的 title**上,不是全文找 auto-back —— 后者会被同页
// 别的(真·只有首屏的)失败态蒙混过去。
const FIRST_SCREEN_ONLY = [
  {
    wxml: 'pages/club/customers/index.wxml',
    js: 'pages/club/customers/index.js',
    // 业务错 + 网络错两条都要带;no-permission 那条不在此列(deny() 已清 PII,留在页里没意义)
    rows: [/state === 'network-error'[\s\S]{0,200}?\/>/, /state === 'error'[\s\S]{0,200}?\/>/],
    reloads: ['onKeywordInput', 'onKeywordConfirm', 'onFilterTap'],
  },
  {
    wxml: 'pages/merchant/customer/index.wxml',
    js: 'pages/merchant/customer/index.js',
    rows: [/客户名单加载失败[\s\S]{0,200}?\/>/],
    reloads: ['onSegmentTap'],
  },
  {
    wxml: 'pages/search2/result/index.wxml',
    js: 'pages/search2/result/index.js',
    rows: [/没能完成搜索[\s\S]{0,200}?\/>/],
    reloads: ['onSearchConfirm'],
  },
  {
    wxml: 'pages/activity/baoming/baoming.wxml',
    js: 'pages/activity/baoming/baoming.js',
    rows: [/活动信息没能加载出来[\s\S]{0,200}?\/>/],
    reloads: ['retryActivityInfo'],
  },
]

const CONDITIONAL_AUTO_BACK = /auto-back="\{\{[^"]*everLoaded[^"]*\}\}"/
const BARE_AUTO_BACK = /auto-back(?=[\s/>])/

test('① 这四页的整页失败态,auto-back 必须带首屏条件(不能是无条件字面量)', () => {
  for (const page of FIRST_SCREEN_ONLY) {
    const wxml = stripComments(read(page.wxml))
    for (const row of page.rows) {
      const hit = wxml.match(row)
      assert.ok(hit, `${page.wxml}:锚点失配,合同判据已失效 → ${row}`)
      const tag = hit[0]
      assert.match(tag, CONDITIONAL_AUTO_BACK,
        `${page.wxml}:页内重拉失败会连页带输入一起退掉,auto-back 必须是 {{!everLoaded}} 这类条件式\n${tag}`)
      assert.doesNotMatch(tag.replace(CONDITIONAL_AUTO_BACK, ''), BARE_AUTO_BACK,
        `${page.wxml}:同一行里还留着无条件 auto-back`)
    }
  }
})

test('② 页面 JS 真的声明并置位 everLoaded,且页内确有重拉入口(不然这条合同是空的)', () => {
  for (const page of FIRST_SCREEN_ONLY) {
    const js = read(page.js)
    assert.match(js, /everLoaded:\s*false/, `${page.js}:data 里要有 everLoaded 初值 false`)
    // search2 用 `everLoaded: this.data.everLoaded || hasResults`(多路搜索里只要出过结果就算),
    // 所以判据是「有一处把它赋成 false 以外的东西」,不是死认字面量 true
    assert.match(js, /everLoaded:\s*(?!false\b)/, `${page.js}:成功渲染后要把 everLoaded 置位`)
    for (const entry of page.reloads) {
      assert.match(js, new RegExp('\\b' + entry + '\\s*\\('), `${page.js}:${entry} 不在了,合同前提(页内会重拉)已失效`)
    }
  }
})

/* ── ③ 行为断言:把 club/customers 真挂起来跑 ──────────────────────────
 * 静态形状能被「写了 everLoaded 但从来不置位」骗过去,所以这里实跑一遍:
 * 首屏失败 → everLoaded 仍 false(该退页);首屏成功后再搜一次失败 → everLoaded 必须仍是 true(不准退页)。 */
function mountCustomers() {
  const requests = []
  global.getApp = () => ({ globalData: { statusBarHeight: 24, navBarHeight: 68 }, sendRequest: (o) => requests.push(o) })
  global.wx = { stopPullDownRefresh() {}, navigateBack() {}, redirectTo() {}, switchTab() {} }
  global.getCurrentPages = () => [{}]
  let config = null
  global.Page = (value) => { config = value }
  const abs = path.join(ROOT, 'pages/club/customers/index.js')
  delete require.cache[require.resolve(abs)]
  delete require.cache[require.resolve(path.join(ROOT, 'pages/club/customers/view-model.js'))]
  require(abs)
  config.data = JSON.parse(JSON.stringify(config.data))
  config.setData = (patch, cb) => { Object.assign(config.data, patch); if (typeof cb === 'function') cb() }
  return { page: config, requests }
}

const okList = { code: '200', data: { total: 1, monthNew: 0, canEdit: true,
  items: [{ memberId: 7, displayName: '张三', verifiedCount: 1, pendingCount: 0 }] } }

test('③ club/customers 实跑:首屏失败不算读到过,首屏成功后再搜失败不得翻回未读过', () => {
  const { page, requests } = mountCustomers()
  page.onLoad({ clubId: 9 })
  assert.equal(page.data.everLoaded, false, '首屏发出去时还没读到过')

  // 首屏就失败:这页确实无事可做,everLoaded 保持 false → auto-back 生效
  requests[0].fail({ code: 500 }, 500)
  assert.equal(page.data.state, 'network-error')
  assert.equal(page.data.everLoaded, false, '首屏失败不能被当成读到过')

  // 重试成功:读到过了
  page.retry()
  requests[1].success(okList)
  assert.equal(page.data.state, 'ready')
  assert.equal(page.data.everLoaded, true, '成功渲染出名单就算读到过')

  // 页内再搜一次,这一次失败:关键词还在,不准退页
  page.onKeywordInput({ detail: { value: '张' } })
  page.onKeywordConfirm()
  requests[2].fail({ code: 500 }, 500)
  assert.equal(page.data.state, 'network-error')
  assert.equal(page.data.keyword, '张', '关键词不能被失败态冲掉')
  assert.equal(page.data.everLoaded, true, '页内重搜失败不得把「读到过」翻回去 —— 否则又会自动退页')
})

test('④ 负控:everLoaded 恒 false / 绑定改回无条件字面量,①③ 都必须能抓到', () => {
  // 负控 A:把条件式换回字面量 auto-back —— ① 的判据必须命中
  const mutated = stripComments(read('pages/club/customers/index.wxml'))
    .replace(/auto-back="\{\{!everLoaded\}\}"/g, 'auto-back')
  const row = mutated.match(/state === 'error'[\s\S]{0,200}?\/>/)
  assert.ok(row, '负控锚点失效')
  assert.doesNotMatch(row[0], CONDITIONAL_AUTO_BACK, '负控没改到东西:变异后仍是条件式')
  assert.match(row[0], BARE_AUTO_BACK, '负控没改到东西:变异后连 auto-back 都没了')

  // 负控 B:写了 everLoaded 却从不置位(静态①②照样绿),③ 必须红
  const { page, requests } = mountCustomers()
  const realSetData = page.setData
  page.setData = (patch, cb) => realSetData.call(page, Object.assign({}, patch, { everLoaded: false }), cb)
  page.onLoad({ clubId: 9 })
  requests[0].success(okList)
  assert.equal(page.data.state, 'ready')
  assert.equal(page.data.everLoaded, false, '负控 B 本身没生效')
  assert.throws(
    () => assert.equal(page.data.everLoaded, true, '成功渲染出名单就算读到过'),
    /成功渲染出名单就算读到过/,
    '③ 的行为断言抓不到「声明了但从不置位」,这条合同就是摆设',
  )
})
