const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js

const root = (...p) => path.join(__dirname, '../..', ...p)
const read = (...p) => fs.readFileSync(root(...p), 'utf8')
const WXML = () => read('pages/coop/invite/index.wxml')
const JS = () => read('pages/coop/invite/index.js')

function loadInvitePage() {
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx }
  const requests = []
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options) }
  })
  global.wx = { showToast() {}, navigateTo() {}, setStorageSync() {}, getStorageSync() { return '' } }
  let definition
  global.Page = (config) => { definition = config }
  const pagePath = root('pages/coop/invite/index.js')
  delete require.cache[require.resolve(pagePath)]
  require(pagePath)
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return {
    page,
    requests,
    restore() {
      if (previous.Page === undefined) delete global.Page; else global.Page = previous.Page
      if (previous.getApp === undefined) delete global.getApp; else global.getApp = previous.getApp
      if (previous.wx === undefined) delete global.wx; else global.wx = previous.wx
      delete require.cache[require.resolve(pagePath)]
    }
  }
}

test('邀请创建流是主题、条款、对象三段卡', () => {
  const titles = [...WXML().matchAll(/<view class="card-tit">([^<]*)/g)].map((m) => m[1].trim())
  assert.deepEqual(titles.slice(0, 3), ['① 关联主题', '② 合作条款', '③ 邀请对象'])
})

test('对象使用头像、文字状态与 Threads 式邀请按钮，底部唯一主 CTA 带数量', () => {
  const wxml = WXML()
  assert.match(wxml, /class="cta-bar" wx:if="\{\{selected\.length\}\}"/)
  assert.match(wxml, /发送邀约\(\{\{selected\.length\}\}\)/)
  assert.match(wxml, /bindtap="toggleTarget"/)
  assert.ok(!/class="target-btn"/.test(wxml), '行内邀请按钮已撤销')
  assert.match(wxml, /presetTarget\.logo/)
  assert.match(wxml, /presetTarget\.meta/)
  assert.match(wxml, /target-action--locked">已锁定/)
  assert.match(wxml, /selectedMap\[item\.id\] \? '已选' : '邀请'/)
})

test('现役 type0/type1 邀约只使用结果口径', () => {
  const wxml = WXML()
  const js = JS()
  assert.match(wxml, /data-mode="0"/)
  assert.match(wxml, /data-mode="2"/)
  assert.match(wxml, /引流合作（不产生现金结算）/)
  // CU-M-98:条款名与单位收进 js 的 feeTerms 单一真源,wxml 只渲染 {{feeName}}/{{feeUnit}}
  assert.match(js, /按核销人头付带队费/)
  assert.match(js, /按核销付费/)
  assert.doesNotMatch(wxml, /固定带队费|每核销 1 人/, 'wxml 不再自己抄一份条款名')
  assert.doesNotMatch(wxml, /引流型|固定型|分成型|计酬档/)
  assert.doesNotMatch(js, /shareModeTabs:|ratePresets:/)
  assert.match(js, /shareMode: 0/)
})

// CU-M-98(2026-09-24 走查)· 固定带队费选项却以「每核销 1 人」计价。
// 后端 shareMode=2 走 FIXED_PER_FULFILLMENT(CoopSettlementContract.java:39-45:
// 每条已核销报名各结一次 fixedFee),是按人头的计费口径,不是整场一口价。
// ① 金额行不许再出现像整场总价的「固定 ×」与按人单位同屏;
// ② 确认弹层那条条款必须带上单位,否则双方点确认时看到的不是同一条约定。
test('CU-M-98 确认条款与金额行同源,且单位不省', () => {
  const env = loadInvitePage()
  try {
    const cases = [
      { activeType: 1, expect: '按核销人头付带队费 · ¥12.00 / 每核销 1 人' },
      { activeType: 0, expect: '按核销付费 · ¥12.00 / 人' },
    ]
    for (const testCase of cases) {
      const page = env.page
      page.data = JSON.parse(JSON.stringify(page.data))
      page.onLoad({ type: String(testCase.activeType) })
      page.data.topicsState = 'ready'
      page.data.targetsState = 'ready'
      page.data.topicId = 301
      page.data.selected = [{ toId: 18, name: '外滩夜行俱乐部', logo: '', meta: '' }]
      page.data.shareMode = 2
      page.data.fixedFee = 12
      page.sendInvite()
      assert.equal(page.data.inviteModal.termsText, testCase.expect)
      assert.equal(page.data.feeName, testCase.expect.split(' · ')[0],
        '金额行左边的名字必须就是确认弹层里那个名字')
      assert.ok(page.data.inviteModal.termsText.indexOf(page.data.feeUnit) > 0,
        '确认弹层不得省掉计价单位')
    }
  } finally {
    env.restore()
  }
})

test('CU-M-98 引流合作条款不带金额', () => {
  const env = loadInvitePage()
  try {
    const page = env.page
    page.onLoad({ type: '1' })
    page.data.topicsState = 'ready'
    page.data.targetsState = 'ready'
    page.data.topicId = 301
    page.data.selected = [{ toId: 18, name: '外滩夜行俱乐部', logo: '', meta: '' }]
    page.data.shareMode = 0
    page.sendInvite()
    assert.equal(page.data.inviteModal.termsText, '引流合作 · 不产生现金结算')
  } finally {
    env.restore()
  }
})

/** 负控专用:把「改回旧写法」的源码放进沙箱跑，验证上面两条 CU-M-98 用例真的会红。 */
function loadInviteFromSource(source) {
  let definition
  const pagePath = root('pages/coop/invite/index.js')
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 'member-a',
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    sendRequest() {},
  }
  vm.runInNewContext(source, {
    Page: (value) => { definition = value },
    getApp: () => app,
    wx: { showToast() {}, hideToast() {}, stopPullDownRefresh() {}, navigateTo() {}, navigateBack() {}, setStorageSync() {}, getStorageSync: () => '' },
    console,
    setTimeout: () => 0,
    clearTimeout() {},
    require(id) {
      if (id.includes('subscribe')) return { request: () => Promise.resolve({ status: 'accepted' }) }
      if (id.includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} }
      if (id.includes('identity-policy')) return { isMerchantView: () => true }
      if (id.includes('response-shape')) {
        return { isRecordList: (rows) => Array.isArray(rows) }
      }
      return require(path.resolve(path.dirname(pagePath), id))
    },
  }, { filename: 'pages/coop/invite/index.js' })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function setData(patch) { Object.assign(this.data, patch) }
  return page
}

test('CU-M-98 负控:确认条款退回省略单位 / 各写一份时,上面两条必须真红', () => {
  const regressed = JS().replace(
    "? (terms.feeName + ' · ¥' + Number(this.data.fixedFee || 0).toFixed(2) + ' ' + terms.feeUnit)",
    "? ((this.data.activeType === 1 ? '固定带队费' : '按核销付费') + ' · ¥' + Number(this.data.fixedFee || 0).toFixed(2))"
  )
  assert.notEqual(regressed, JS(), '负控锚点失效:sendInvite 的 termsText 已改名,扫描口径需同步')
  const page = loadInviteFromSource(regressed)
  page.onLoad({ type: '1' })
  page.data.topicsState = 'ready'
  page.data.targetsState = 'ready'
  page.data.topicId = 301
  page.data.selected = [{ toId: 18, name: '外滩夜行俱乐部', logo: '', meta: '' }]
  page.data.shareMode = 2
  page.data.fixedFee = 12
  page.sendInvite()
  // 旧写法既丢了单位、名字也和金额行不是同一份 —— 正是走查里那条自相矛盾的条款
  assert.throws(() => assert.equal(
    page.data.inviteModal.termsText, '按核销人头付带队费 · ¥12.00 / 每核销 1 人'), assert.AssertionError)
  assert.equal(page.data.inviteModal.termsText, '固定带队费 · ¥12.00')
  assert.equal(page.data.inviteModal.termsText.indexOf(page.data.feeUnit), -1)
})

test('提交只会生成 type0/type1，伪造 type2 也归一为 type1', () => {
  const env = loadInvitePage()
  try {
    for (const activeType of [0, 1]) {
      env.page.data.activeType = activeType
      env.page.data.shareMode = 2
      env.page.data.shareRate = 50
      env.page.data.fixedFee = 88
      const payload = env.page._invitePayload(7)
      assert.equal(payload.shareMode, 2)
      assert.equal(payload.fixedFee, 88)
      assert.equal('shareRate' in payload, false)
    }

    env.page.data.activeType = 2
    env.page.data.shareMode = 2
    env.page.data.shareRate = 50
    env.page.data.fixedFee = 88
    const forgedPayload = env.page._invitePayload(7)
    assert.equal(forgedPayload.inviteType, 1)
    assert.equal(forgedPayload.toType, 'club')
    assert.equal(forgedPayload.shareMode, 2)
    assert.equal('nodeId' in forgedPayload, false)

    env.page.data.activeType = '2'
    const stringForgedPayload = env.page._invitePayload(7)
    assert.equal(stringForgedPayload.inviteType, 1)
    assert.equal('nodeId' in stringForgedPayload, false)

    env.page.data.activeType = 1
    env.page.data.shareMode = 1
    const invalidPayload = env.page._invitePayload(7)
    assert.equal(invalidPayload.shareMode, 0)
    assert.equal('shareRate' in invalidPayload, false)
    assert.equal('fixedFee' in invalidPayload, false)
  } finally {
    env.restore()
  }
})

test('逐条串行发送并保留目标级失败回执', () => {
  const js = JS()
  assert.match(js, /function step\(i\)/)
  assert.match(js, /const target = targets\[i\]/)
  assert.match(js, /that\._invitePayload\(target\.toId\)/)
  assert.match(js, /okNames\.push\(target\.name\)/)
  assert.match(js, /failed\.push\(target\.name \+ ':'/)
  assert.match(js, /complete\(\) \{ step\(i \+ 1\); \}/)
  assert.match(WXML(), /class="iv-result" wx:if="\{\{sendResult\}\}"/)
})

test('部分失败后只保留失败对象，重试不会重复发送成功项', () => {
  const env = loadInvitePage()
  try {
    env.page.data.topicId = 9
    env.page._setSelected([{ toId: 11, name: '甲店' }, { toId: 22, name: '乙店' }])
    env.page.confirmInvite()
    assert.equal(env.requests.length, 1)
    assert.equal(JSON.parse(env.requests[0].data).toId, 11)
    env.requests[0].success({ code: '200' })
    env.requests[0].complete()
    assert.equal(env.requests.length, 2, '第二条只能在第一条 complete 后发，必须串行')
    assert.equal(JSON.parse(env.requests[1].data).toId, 22)
    env.requests[1].success({ code: '500', msg: '容量不足' })
    env.requests[1].complete()
    assert.deepEqual(env.page.data.selected, [{ toId: 22, name: '乙店' }])
    assert.match(env.page.data.sendResult, /已发起 1 条;失败:乙店:容量不足/)
  } finally {
    env.restore()
  }
})

test('type2 的 tab、节点 UI、请求与 payload 分支全部撤销，预置目标仍锁为单选', () => {
  const js = JS()
  const wxml = WXML()
  assert.match(js, /if \(presetTarget\) this\._setSelected\(\[presetTarget\]\)/)
  assert.match(js, /if \(this\.data\.presetTarget\) return;/)
  assert.doesNotMatch(js + wxml, /inviteTypeTabs|activeType\s*===\s*2|loadNodes|nodeId|nodeIndex|nodesState|邀商家做节点|承接节点/)
  assert.doesNotMatch(wxml, /<cy-tabs\b/)
})

test('发送确认半屏同时回显已锁定邀请对象与合作条款', () => {
  const wxml = WXML()
  const js = JS()
  assert.match(wxml, /邀请对象 · 已锁定/)
  assert.match(wxml, /合作条款 · 已锁定/)
  assert.match(wxml, /inviteModal\.targetLogo/)
  assert.match(wxml, /inviteModal\.termsText/)
  assert.match(js, /termsText\s*=\s*this\.data\.shareMode === 2/)
  assert.match(js, /targetLogo:\s*firstTarget\.logo/)
})

test('历史 type2 仍可读且 merchantMemberId 节点模型保留', () => {
  const listJs = read('pages/coop/list/index.js')
  const listWxml = read('pages/coop/list/index.wxml')
  const nodeModel = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/domain/CmsTopicNode.java')
  // 2026-09-08 TYPE_LABEL 随邀约整形搬进 utils/coop-invite-view.js(列表与 02d 详情共用一份)。
  // 断言跟着真源走 —— 留在 coop/list 上只会证明「那一行没被改过」,证明不了标签表还在。
  const inviteView = read('utils/coop-invite-view.js')
  assert.match(inviteView, /TYPE_LABEL\s*=\s*\[[^\]]*'商家 → 商家承接节点'/)
  assert.match(listJs, /require\([^)]*coop-invite-view/, 'coop/list 必须仍消费这份共用整形,而不是自己再抄一份')
  assert.match(inviteView, /const legacyReadonly\s*=\s*Number\(it\.inviteType\)\s*===\s*2/)
  // 俱乐部带队申请卡(inv-acts--apply)不是邀约,没有 inviteType,不参与 type2 只读闸
  const actionConditions = [...listWxml.matchAll(/class="inv-acts(?! inv-acts--apply)[^"]*"\s+wx:if="\{\{([^"]+)\}\}"/g)].map((m) => m[1])
  const inviteActionConditions = actionConditions.filter((condition) => /item\.(?:status|depositRefundPending)/.test(condition))
  assert.ok(inviteActionConditions.length >= 5)
  assert.ok(inviteActionConditions.every((condition) => condition.includes('!item.legacyReadonly')))
  assert.match(nodeModel, /private Long merchantMemberId;/)
})

test('陈旧 type2 深链不得把 merchantMemberId 静默改邀为 clubId', () => {
  const js = JS()
  assert.match(js, /const invalidLegacyType\s*=\s*t\s*===\s*2/)
  assert.match(js, /const presetTarget\s*=\s*!invalidLegacyType\s*&&\s*options\.toId/)
})

test('附近商家入口位于对象列表尾部', () => {
  const wxml = WXML()
  assert.match(wxml, /class="nearby-row"[^>]*bindtap="goNearby"/)
  assert.ok(wxml.indexOf('nearby-row') > wxml.indexOf('③ 邀请对象'))
})

test('★负控：删除串行推进或多选入口会判红', () => {
  assert.throws(() => assert.match('function step(i) {}', /complete\(\) \{ step\(i \+ 1\); \}/))
  assert.throws(() => assert.match('<view bindtap="sendInvite"/>', /bindtap="toggleTarget"/))
})

test('★负控：type2 tab/payload 或分成选择器回潮会判红', () => {
  const source = JS() + WXML()
  assert.throws(() => assert.doesNotMatch(source + "{ key: '2', label: '邀商家做节点' }", /inviteTypeTabs|邀商家做节点/))
  assert.throws(() => assert.doesNotMatch(source + 'if (data.activeType === 2) payload.nodeId = data.nodeId', /activeType\s*===\s*2|nodeId/))
  assert.throws(() => assert.doesNotMatch(source + '<text>分成型</text>', /引流型|固定型|分成型|计酬档/))
})

// 2026-09-23 CU-M-29:主题下拉原来不分招商期,选完填完发送才被写闸拒(「招商写入已关闭:主题不在招商期」)。
test('不在招商期的主题在下拉里标明,选中后不能发送', () => {
  const env = loadInvitePage()
  try {
    const { page, requests } = env
    page.data.activeType = 1
    page.loadMyTopics(true)
    const req = requests.find((r) => r.url === '/api/topic/list')
    assert.ok(req, '必须读我的主题')
    assert.equal(req.data.invite_target, 'club', '商家→俱乐部要按俱乐部口径回填招商期')
    req.success({ code: '200', data: { rows: [
      { id: 1, name: '招募中', inviteWindowOpen: true },
      { id: 2, name: '已锁价', inviteWindowOpen: false },
    ] } })
    assert.deepEqual(page.data.myTopics.map((t) => t.label), ['招募中', '已锁价（不在招商期）'])
    page.onTopicChange({ detail: { value: 1 } })
    assert.equal(page.data.topicClosed, true)
    page.setData({ selected: [{ toId: 9, name: '跑团' }], targetsState: 'ready', topicsState: 'ready' })
    page.sendInvite()
    assert.notEqual(page.data.inviteModal && page.data.inviteModal.show, true, '不在招商期不得打开发送确认')
    assert.match(WXML(), /topicClosed \|\| topicsState !== 'ready'/)
    // 招商期提示不得插进主题区 wx:if/elif/else 链中间:插进去 cy-empty 会接到它上面,空态到处冒
    assert.match(WXML(), /<\/cy-dropdown>\s*<cy-empty wx:else title="还没有可关联的主题"/)
  } finally { env.restore() }
})

// 2026-09-23 CU-C-85:发送成功后落到「收到的」,刚发的邀约不在那页,容易误判失败而重发。
test('发送成功关掉结果面板后进协作邀请的「我发出的」', () => {
  const env = loadInvitePage()
  const navigations = []
  try {
    global.wx.redirectTo = (o) => { navigations.push(o.url) }
    const { page } = env
    page.setData({ resultSheet: { show: true, kind: 'success' } })
    page.onResultSheetClose()
    assert.deepEqual(navigations, ['/pages/coop/list/index?tab=sent'])
  } finally { env.restore() }
})
