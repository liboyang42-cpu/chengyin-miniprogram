/* ===== CU-M-141：「我的收藏」卡面要认得出是哪条主题 =====
 * 走查实测（2026-09-24）：收藏列表里有多条封面相近的主题，卡片只有封面图 + 分享/取消收藏
 * 两枚图标，名称只活在分享按钮的 data-name 里 —— 点开之前分不出是哪条主题。
 * 这一版把名称与基本类型搬回封面下沿，与首页 feed 长方卡（components/cy/feed-play-card）同一做法。
 */
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'pages/mylike/mylike.js')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)]
  global.getApp = () => ({ globalData: {}, sendRequest() {}, getRequestErrorMessage: (_res, fallback) => fallback })
  global.Page = config => { global.__pageConfig = config }
  global.wx = { getStorageSync: () => '', setNavigationBarColor() {} }
  require(PAGE_PATH)
  return Object.assign({}, global.__pageConfig)
}

test('★卡面把主题名称与基本类型压在封面下沿，整张封面仍是点击入口', () => {
  const wxml = read('pages/mylike/mylike.wxml')
  const wxss = read('pages/mylike/mylike.wxss')
  assert.match(wxml, /class="favorite-card__title"[^>]*>\s*\{\{\s*item\.name\s*\}\}\s*</)
  assert.match(wxml, /class="favorite-card__type"[^>]*\{\{\s*item\.categoryText\s*\}\}/)
  // 白字要压得住亮照片：遮罩层与文案层都得让开触摸，否则封面点不动。
  assert.match(wxml, /class="favorite-card__scrim"/)
  assert.match(wxss, /\.favorite-card__scrim\s*\{[^}]*pointer-events:\s*none/)
  assert.match(wxss, /\.favorite-card__body\s*\{[^}]*pointer-events:\s*none/)
  // 无障碍：读屏也要在打开前报出是哪条主题，不能只说「收藏内容」。
  assert.match(wxml, /aria-label="打开\{\{item\.name/)
  assert.doesNotMatch(wxml, /aria-label="打开收藏内容"/)
})

test('★基本类型来自接口的类别数组，收成一行交给 CSS 省略号截断', () => {
  const page = loadPage()
  const rows = [{
    id: 1,
    name: '外滩光影寻踪',
    startDate: '2026-09-20 10:00:00',
    sysCategoryList: [{ categoryName: '城市探索' }, { categoryName: '摄影' }, {}],
  }]
  const [row] = page.processListData(rows)
  assert.equal(row.categoryText, '城市探索 · 摄影')
  assert.equal(row.startDate, '2026.09.20', '日期口径不能被这次改动带偏')
})

test('★没配类别的收藏：类型行为空，名称照旧上卡面', () => {
  const page = loadPage()
  const [bare] = page.processListData([{ id: 2, name: '夜跑三公里' }])
  assert.equal(bare.categoryText, '')
  assert.match(read('pages/mylike/mylike.wxml'), /class="favorite-card__type"[^>]*wx:if="\{\{item\.categoryText\}\}"/)
})

test('★负控：撤掉卡面名称，上面的合同必须判红', () => {
  const source = read('pages/mylike/mylike.wxml')
  const mutated = source.replace('<text class="favorite-card__title">{{item.name}}</text>', '')
  assert.notEqual(mutated, source, '负控未命中卡面名称节点')
  assert.throws(
    () => assert.match(mutated, /class="favorite-card__title"[^>]*>\s*\{\{\s*item\.name\s*\}\}\s*</),
    /did not match/,
    '撤掉修复后名称还在卡上 = 第一条合同是假的',
  )
})

test('★负控：把类别收成一行从源码里撤掉，类型行就拿不到内容', () => {
  const js = read('pages/mylike/mylike.js')
  const mutated = js.replace(/list\[i\]\['categoryText'\] = \([\s\S]*?\.join\(' · '\);\n/, '')
  assert.notEqual(mutated, js, '负控未命中 CU-M-141 的类别收行')
  const matched = mutated.match(/processListData: function\(list\) \{([\s\S]*?)\n  \},/)
  assert.ok(matched, 'pages/mylike/mylike.js 里找不到 processListData')
  const stripped = new Function('list', matched[1])
  assert.equal(
    stripped([{ id: 3, name: '江畔旧建筑', sysCategoryList: [{ categoryName: '建筑' }] }])[0].categoryText,
    undefined,
    '撤掉修复后 item.categoryText 仍有值 = 上面那条类型合同是假的',
  )
})
