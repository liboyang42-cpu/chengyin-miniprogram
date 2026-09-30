// R9-05(P2):个人未公开作品显示为「城瘾/官方」。
//
// 审查复现(第九轮 R9-05):6029 是玩家 9004 的私有草稿,详情却显示「城瘾 / 官方」
// (pages/templatedetail/templatedetail.wxml: info.publisher || '城瘾' + 写死的「官方」徽标)。
// 缺作者字段时不得回退成官方来源。
//
// 契约:
//   · scope=my(自己的模板)一律按真实发布者显示:有名字用名字,没名字用本人昵称,绝不显示官方;
//   · 公共库有作者 memberId 但拿不到名字时给中性的「创作者」,不冒充官方;
//   · 只有平台内容(无 memberId、无发布者)才保留「城瘾 + 官方」。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE = '../../pages/templatedetail/templatedetail.js'
const ROOT = path.join(__dirname, '../..')

let pageConfig
let appStub

global.getApp = () => appStub
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  showToast: () => {},
  nextTick: (cb) => cb(),
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }) }),
}
global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  pageConfig = null
  appStub = {
    globalData: { nickname: '玩家9004', statusBarHeight: 20, navBarHeight: 44 },
    getUserRole: () => 'player',
    getUserType: () => 1,
    sendRequest: () => {},
  }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

function makePage(scope) {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.data.scope = scope
  page.data.isMyScope = scope === 'my'
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

test('RED 锚点:个人草稿缺作者名时显示本人昵称而不是「城瘾/官方」', () => {
  const page = makePage('my')
  page.applyDetailPayload({ id: 6029, title: '我的私有草稿', memberId: 9004 })

  assert.equal(page.data.publisherText, '玩家9004')
  assert.equal(page.data.isOfficialPublisher, false)
})

test('个人草稿有作者名时用真名;仍不挂官方徽标', () => {
  const page = makePage('my')
  page.applyDetailPayload({ id: 6029, title: '草稿', publisher: '林青', memberId: 9004 })
  assert.equal(page.data.publisherText, '林青')
  assert.equal(page.data.isOfficialPublisher, false)
})

test('公共库有作者但拿不到名字时用中性「创作者」,不冒充官方', () => {
  const page = makePage('library')
  page.applyDetailPayload({ id: 12, title: '公共玩法', memberId: 9004 })
  assert.equal(page.data.publisherText, '创作者')
  assert.equal(page.data.isOfficialPublisher, false)
})

test('公共库真实作者名保留;平台内容才保留「城瘾/官方」', () => {
  const named = makePage('library')
  named.applyDetailPayload({ id: 12, title: '公共玩法', publisher: '城瘾官方', memberId: 9004 })
  assert.equal(named.data.publisherText, '城瘾官方')
  assert.equal(named.data.isOfficialPublisher, false)

  const platform = makePage('library')
  platform.applyDetailPayload({ id: 1, title: '平台玩法' })
  assert.equal(platform.data.publisherText, '城瘾')
  assert.equal(platform.data.isOfficialPublisher, true)
})

test('视图层绑定派生字段,不再直接回退「城瘾/官方」', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/templatedetail/templatedetail.wxml'), 'utf8')
  assert.match(wxml, /xb-head-sub[^>]*>\s*\{\{\s*publisherText\s*\}\}/)
  assert.match(wxml, /xb-head-badge[^>]*wx:if="\{\{\s*isOfficialPublisher\s*\}\}"/)
  assert.match(wxml, /xb-quote-author[^>]*>\s*\{\{\s*publisherText\s*\}\}/)
  assert.doesNotMatch(wxml, /\{\{\s*info\.publisher\s*\|\|\s*'城瘾/, '不得再以缺字段回退官方来源')
})
