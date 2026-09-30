// 一级 tab 页必须能刷新(2026-08-25)
//
// 背景:全量审查时发现 5 个一级 tab 页【一个都没有】下拉刷新。既有的 pulldown-refresh-lint
// 只查「开了却坏了」(0 处,很好),不查「该开却没开」—— 于是内容型 App 的首页 feed 陈旧后,
// 用户唯一的刷新手段是退出小程序再进来。这条契约补的就是反方向。
//
// 判据是「这一页能不能刷新」,不是「有没有写 enablePullDownRefresh」:
//   A 页面级滚动 → app.json enablePullDownRefresh:true + JS onPullDownRefresh
//   B 整屏 scroll-view(页面自身不滚,原生下拉点不着)→ refresher-enabled +
//     bindrefresherrefresh + JS 对应 handler
// 两者满足其一即可。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const readJson = (p) => JSON.parse(read(p))

// 豁免必须写清理由,否则这个文件会变成新的逃生口。
const EXEMPT = {
  'pages/roam/index': '整页是地图与迷雾图层,内容由定位驱动而不是列表分页;下拉手势会和地图拖拽抢事件。刷新入口是页内「重试」与重新出发。',
  'pages/template/index': '工具入口页(发布/玩法库),内容基本静态;它的列表刷新由页内分类切换驱动。',
}

function refreshAbility(route) {
  const cfg = readJson(`${route}.json`)
  const js = read(`${route}.js`)
  const wxml = read(`${route}.wxml`)
  const pageLevel = cfg.enablePullDownRefresh === true && /onPullDownRefresh\s*[:(]/.test(js)
  const refresherHandler = /bindrefresherrefresh="([A-Za-z_]\w*)"/.exec(wxml)
  const scrollLevel = !!refresherHandler
    && /refresher-enabled/.test(wxml)
    && new RegExp('\\b' + refresherHandler[1] + '\\s*[:(]').test(js)
  return { pageLevel, scrollLevel, ok: pageLevel || scrollLevel }
}

function tabRoutes() {
  const app = readJson('app.json')
  const list = (app.tabBar && app.tabBar.list) || []
  assert.ok(list.length >= 3, 'app.json 里读不到 tabBar 列表,契约会恒真')
  return list.map((item) => item.pagePath)
}

function assertTabsRefreshable(probe = refreshAbility) {
  tabRoutes().forEach((route) => {
    if (EXEMPT[route]) {
      assert.ok(EXEMPT[route].length > 20, `${route} 的豁免理由太短,等于没写`)
      return
    }
    assert.equal(probe(route).ok, true,
      `一级 tab 页 ${route} 无法刷新:要么开 enablePullDownRefresh + onPullDownRefresh,`
      + '要么给整屏 scroll-view 接 refresher-enabled + bindrefresherrefresh')
  })
}

test('每个一级 tab 页都必须能刷新(豁免须写明理由)', () => {
  assertTabsRefreshable()
})

test('三个非豁免 tab 各自用的是哪种刷新方式(锁住实现形态,防止悄悄退化)', () => {
  // 首页正文是整屏 scroll-view,页面自身永远不滚 ⇒ 原生下拉点不着,只能走 refresher。
  assert.equal(refreshAbility('pages/index/index').scrollLevel, true)
  // 这两页是页面级滚动,用原生下拉。
  assert.equal(refreshAbility('pages/talent/list/index').pageLevel, true)
  assert.equal(refreshAbility('pages/member/index/index').pageLevel, true)
})

test('negative control:任一 tab 页失去刷新能力必须判红', () => {
  const broken = (route) => (route === 'pages/talent/list/index'
    ? { pageLevel: false, scrollLevel: false, ok: false }
    : refreshAbility(route))
  assert.throws(() => assertTabsRefreshable(broken), assert.AssertionError)
})

test('negative control:豁免理由被清空必须判红', () => {
  const saved = EXEMPT['pages/roam/index']
  EXEMPT['pages/roam/index'] = ''
  try {
    assert.throws(() => assertTabsRefreshable(), assert.AssertionError)
  } finally {
    EXEMPT['pages/roam/index'] = saved
  }
})
