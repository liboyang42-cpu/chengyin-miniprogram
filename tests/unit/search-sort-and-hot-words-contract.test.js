'use strict'

// CU-M-63 / CU-M-66 搜索入口页两条契约:
//   CU-M-63 「猜你想搜」是固定运营位,不是个性化推荐:标题不得写成个性化承诺,
//           已知搜不出东西的词不得回到词表(点了不能是一张全空结果页;能否命中以生产核对为准)
//   CU-M-66 「最近」就是四类列表的默认排序(create_time desc),不发参数 —— /api/activity/list 的
//           sort_type=1 是「附近的活动」,不能拿来冒充;「最热」从 UI 撤掉(四类后端都没有热度排序)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 注释里复述了旧标题/旧选项(讲历史),判据只看真渲染的文字
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

const { SEARCH_HOT_WORDS } = require('../../pages/search2/utils/hot-words.js')
const INDEX_MODULE = path.join(ROOT, 'pages/search2/index.js')
const RESULT_MODULE = path.join(ROOT, 'pages/search2/result/index.js')

function loadPage(modulePath, wxOverrides) {
  let definition
  const requests = []
  const navigations = []
  global.getApp = () => ({
    getUserID: () => '9',
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest: (options) => requests.push(options),
  })
  global.Page = (config) => { definition = config }
  global.wx = Object.assign({
    getStorageSync: () => [],
    setStorageSync() {},
    removeStorageSync() {},
    navigateTo: (options) => navigations.push(options.url),
  }, wxOverrides || {})
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => {
        const parts = key.split('.')
        let cursor = this.data
        parts.slice(0, -1).forEach((part) => {
          if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
          cursor = cursor[part]
        })
        cursor[parts[parts.length - 1]] = value
      })
      if (callback) callback.call(this)
    },
  })
  return { page, requests, navigations }
}

test('CU-M-63 推荐位标题不作个性化承诺,也不冒充聚合热搜', () => {
  const wxml = strip(read('pages/search2/index.wxml'))
  assert.doesNotMatch(wxml, /猜你想搜/, '固定词表不能写「猜你想搜」——那是按用户/内容算出来的意思')
  assert.doesNotMatch(wxml, /热门搜索/, '也不写「热门搜索」:没有聚合数据源,2026-08-04 已否过')
  assert.match(wxml, /推荐搜索/)
})

// 词能不能搜出东西只有生产数据说了算(见 hot-words.js 的 2026-09-24 核对记录);仓内没有能代表
// 公开搜索结果的样本 —— 模板库 is_template=1 的名单公开搜索根本不查,拿它比对是恒真断言。
// 这里只钉住已知的空结果词不回来、词表形状不坏。
test('CU-M-63 已知搜不出东西的词不得回到词表', () => {
  assert.ok(Array.isArray(SEARCH_HOT_WORDS) && SEARCH_HOT_WORDS.length >= 4)
  assert.ok(!SEARCH_HOT_WORDS.includes('盗墓笔记'), '盗墓笔记在库内四类里都是 0 条,点了只有一张空结果页')
  ;['暗号', '解谜', '寻宝', '菜单', '音乐', '亲子', '下班'].forEach((dead) => {
    assert.ok(!SEARCH_HOT_WORDS.includes(dead), `「${dead}」2026-09-24 在生产公开搜索里是 0 条`)
  })
})

test('CU-M-66 排序选择必须进结果页 URL,「最热」从 UI 撤掉', () => {
  const { page, navigations } = loadPage(INDEX_MODULE)
  page.data.searchKeyword = '外滩'
  page.data.filterConditions = Object.assign({}, page.data.filterConditions, { sortType: '1' })
  page.navigateToSearchList()
  assert.equal(navigations.length, 1)
  assert.match(navigations[0], /(\?|&)sortType=1(&|$)/)

  const wxml = strip(read('pages/search2/index.wxml'))
  assert.doesNotMatch(wxml, /最热/, '四类后端都没有热度排序,这个选项不能留在 UI 上')
  assert.match(wxml, /最近/)
})

test('CU-M-66 结果页收下 sortType 但不把它映射成 sort_type(「最近」即默认序)', () => {
  const { page, requests } = loadPage(RESULT_MODULE)
  page.onLoad({ keyword: encodeURIComponent('外滩'), sortType: '1' })
  assert.equal(page._filters.sortType, '1')

  const activity = requests.find((item) => item.url === '/api/activity/list')
  assert.ok(activity, '结果页必须发起活动搜索')
  assert.equal(activity.data.sort_type, undefined, 'sort_type=1 是「附近」,不是「最近」')
  const club = requests.find((item) => item.url === '/api/club/list')
  assert.equal(JSON.parse(club.data).sortType, undefined, '没有排序参数的一路不许装样子')

  // 没带排序(历史链接/直接进入)时不传,走服务端默认
  const plain = loadPage(RESULT_MODULE)
  plain.page.onLoad({ keyword: encodeURIComponent('外滩') })
  assert.equal(plain.page._filters.sortType, '')
  assert.equal(plain.requests.find((item) => item.url === '/api/activity/list').data.sort_type, undefined)
})
