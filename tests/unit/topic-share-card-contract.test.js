/* CU-C-38:主题分享卡的标题与封面(两条分享路径统一口径)。
 *
 * 走查现象:公开主题详情页底部分享出去的卡片标题是泛化的「主题详情」,没有主题名;
 * 对照同一主题的「带票分享」标题有名字但**卡片图是空白**。#1169 只补了标题,图没管。
 *
 * 这条验的是三条一起成立,少一条就退回走查现象:
 *   1. 主题名做标题(读不到才退泛化文案);
 *   2. 卡片图 = 主题封面(长图优先、退回轮播首图),且经过 app.getImgUrl 补成可分享地址;
 *   3. 两条路径(主题详情页 / 俱乐部带票)共用 utils/topic-share 这一份实现,不再各拼各的。
 * 封面两处都拿不到时**省略 imageUrl**(交给微信默认卡片图)—— 不拿占位图冒充,
 * 卡片发出去就固化在接收人会话里(mock-image-asset-safety 对主题封面兜底有同样的禁令)。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { buildTopicShare, resolveTopicCover } = require('../../utils/topic-share.js')

/** 与 app.js:424 getImgUrl 同形的极简替身:相对路径补资产域,绝对/站内路径原样 */
const toAbsolute = (p) => (/^https?:\/\//i.test(p) || p.charAt(0) === '/' ? p : 'https://cdn.example/profile/' + p)

// ---------------------------------------------------------------------------
// 纯函数层:口径本身
// ---------------------------------------------------------------------------

test('CU-C-38:封面优先主题长图,没有才退轮播首图', () => {
  assert.equal(resolveTopicCover({ imgUrl: 'upload/a.png', imgArr: 'upload/b.png' }, toAbsolute),
    'https://cdn.example/profile/upload/a.png')
  assert.equal(resolveTopicCover({ imgUrl: '', imgArr: 'upload/b.png,upload/c.png' }, toAbsolute),
    'https://cdn.example/profile/upload/b.png')
})

test('CU-C-38:一处封面都没有 ⇒ 不产出 imageUrl,不拿别的图顶', () => {
  assert.equal(resolveTopicCover({ imgUrl: null, imgArr: ' , ' }, toAbsolute), '')
  assert.equal(resolveTopicCover(undefined, toAbsolute), '')
  assert.equal('imageUrl' in buildTopicShare({ topicId: 1, name: 'N', cover: '' }), false,
    '空封面必须整键省略,传空串会被微信当成坏图')
})

test('CU-C-38:标题 = 主题名;名缺失才用调用方给的退路', () => {
  assert.equal(buildTopicShare({ topicId: 9, name: '  E2E 探店日一期  ', cover: 'c' }).title, 'E2E 探店日一期')
  assert.equal(buildTopicShare({ topicId: 9, name: null }).title, '主题详情')
  assert.equal(buildTopicShare({ topicId: 9, name: '', fallbackTitle: '毛孩子俱乐部' }).title, '毛孩子俱乐部')
})

// ---------------------------------------------------------------------------
// 页面层:两条分享路径真的用上这份口径
// ---------------------------------------------------------------------------

let topicPageConfig = null
global.getApp = () => ({ globalData: {}, getImgUrl: toAbsolute })
global.Page = (c) => { topicPageConfig = c }
global.wx = new Proxy({}, { get: () => () => {} })
require('../../pages/topic/index/index.js')

function loadTopicPage() {
  const page = Object.assign({}, topicPageConfig)
  page.data = Object.assign({}, topicPageConfig.data)
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

test('CU-C-38:主题详情页底部分享带主题封面,卡片不再是空图', () => {
  const page = loadTopicPage()
  page.data.id = 990030
  page.data.info = { name: 'E2E 探店日一期', imgUrl: 'upload/cover-990030.png' }
  const share = page.onShareAppMessage()
  assert.equal(share.title, 'E2E 探店日一期')
  assert.equal(share.path, '/pages/topic/index/index?id=990030', '落地路径一个字都不动')
  assert.equal(share.imageUrl, 'https://cdn.example/profile/upload/cover-990030.png')
})

test('CU-C-38:负控 —— 主题没封面时整键省略,标题仍不退回泛化', () => {
  const page = loadTopicPage()
  page.data.id = 1
  page.data.info = { name: '有名字的团' }
  const share = page.onShareAppMessage()
  assert.equal('imageUrl' in share, false)
  assert.equal(share.title, '有名字的团')
})

function loadClubDetail(getAppImpl) {
  let config = null
  const clubDetailJs = path.join(ROOT, 'pages/club/detail/index.js')
  const ctx = {
    Page: (c) => { config = c },
    getApp: getAppImpl,
    wx: {
      getStorageSync: () => '',
      setStorageSync: () => {},
      removeStorageSync: () => {},
      getWindowInfo: () => ({ statusBarHeight: 20 }),
      getSystemInfoSync: () => ({ statusBarHeight: 20 }),
      getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, bottom: 56 }),
      navigateTo: () => {},
      showToast: () => {},
    },
    Set, Map, Date, JSON, Math, Promise, setTimeout, clearTimeout, console,
    require: (request) => require(path.join(path.dirname(clubDetailJs), request)),
  }
  vm.createContext(ctx)
  vm.runInContext(read('pages/club/detail/index.js'), ctx, { filename: 'club-detail.js' })
  assert.ok(config, 'club/detail Page() 载入失败')
  const page = Object.assign({}, config, { setData(patch) { Object.assign(this.data, patch) } })
  page.data = Object.assign({}, config.data)
  return page
}

test('CU-C-38:俱乐部「带票分享」与主题详情页同图同标题,归因参数不动', () => {
  const requests = []
  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    getUserID: () => 9,
    getImgUrl: toAbsolute,
    isDevEnv: () => false,
    tips: () => {},
    sendRequest: (r) => requests.push(r),
    getRequestErrorMessage: (res, fb) => (res && res.msg) || fb,
  })
  const page = loadClubDetail(global.getApp)
  page.data.clubId = 7
  page.data.club = { id: 7, name: '毛孩子俱乐部', isOwner: true }
  page.loadShareEditions()
  const req = requests.find((item) => item.url === '/api/club-compensation/editions')
  assert.ok(req, '必须从执行俱乐部条款真源拉可分享期次')
  req.success({
    code: '200',
    data: [{
      topicId: 77, topicName: '第一期', executingClubId: 7, topicCover: 'upload/t77.png',
    }],
  })

  const share = page.onShareAppMessage({ target: { dataset: { topicId: 77 } } })
  assert.equal(share.title, '第一期')
  assert.equal(share.imageUrl, 'https://cdn.example/profile/upload/t77.png',
    '带票卡片必须有主题封面 —— 走查读到的就是这张空白图')
  assert.ok(share.path.indexOf('/pages/topic/index/index?id=77') === 0)
  assert.ok(share.path.indexOf('sourceClubId=7') > -1 && share.path.indexOf('clubCode=') > -1,
    '票源归因参数是裁决 E2 的产物,补图不许顺手改路径')
})

test('CU-C-38:负控 —— 期次没有封面时省略 imageUrl,标题退回店名而不是「主题详情」', () => {
  const requests = []
  global.getApp = () => ({
    globalData: {}, getUserID: () => 9, getImgUrl: toAbsolute, isDevEnv: () => false,
    tips: () => {}, sendRequest: (r) => requests.push(r),
    getRequestErrorMessage: (res, fb) => (res && res.msg) || fb,
  })
  const page = loadClubDetail(global.getApp)
  page.data.clubId = 7
  page.data.club = { id: 7, name: '毛孩子俱乐部', isOwner: true }
  page.loadShareEditions()
  const req = requests.find((item) => item.url === '/api/club-compensation/editions')
  req.success({ code: '200', data: [{ topicId: 78, executingClubId: 7 }] })

  const share = page.onShareAppMessage({ target: { dataset: { topicId: 78 } } })
  assert.equal('imageUrl' in share, false)
  assert.equal(share.title, '毛孩子俱乐部')
})

// ---------------------------------------------------------------------------
// 后端:期次行要真的把封面带下来,否则前端永远拿不到图
// ---------------------------------------------------------------------------

test('CU-C-38:/api/club-compensation/editions 的投影含主题封面列', () => {
  const xml = fs.readFileSync(path.resolve(ROOT,
    '../chengyinhub-system/src/main/resources/mapper/business/ClubEditionCompensationMapper.xml'), 'utf8')
  const select = /<select id="selectEditionsForExecutingClub"[\s\S]*?<\/select>/.exec(xml)
  assert.ok(select, '期次投影 SQL 必须存在')
  assert.match(select[0], /c\.img_url\s+as\s+topicCover/i,
    '期次行不下发 topicCover,带票分享卡片就永远没有图')
})
