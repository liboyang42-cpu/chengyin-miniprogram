// P0 验收:「任意一个宿主在任意时刻只渲一个 scene-sheet」(方案 §4.1 / P0 验收第 3 条)。
//
// 原来 roam 的 locationPicker / share 和 play 的 sessionTools 各有一个独立的 show 位,
// 与 sceneCurrent 互不知情 —— openScene 不清它们、它们也不清栈,两个 scene-sheet 能同屏。
// 这里把「宿主 wxml 里的每个 cy-scene-sheet 都必须由 sceneCurrent 判定」写成硬断言。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/* 已经照原型重做、不再用 cy-scene-sheet 的宿主。值 = 那些不挂 sceneCurrent、
   由自己 show 位管的壳,一条正则一层 —— 新加一层就得在这儿登记一条,不能白加。 */
const PROTO_HOSTS = {
  'pages/roam/index.wxml': [
    /wx:if="\{\{screen=='entry-map' && entrySheet\}\}"/, // 开始前地图入口弹层
    /wx:if="\{\{discoverReward\.show\}\}"/,   // 首次发现仪式卡
    /wx:if="\{\{clearAsk\}\}"/,                // 清空本机缓存确认
    // 2026-09-11 照原型补的两屏,各自一个 show 位:
    /wx:if="\{\{topicView\}\}"/,               // f-topic / f-city:点主题针出的主题半屏
    /wx:if="\{\{checkinView\}\}"/,             // f-checkin:打卡之后这里能做什么
  ],
  'pages/play/index.wxml': [],
}

const HOSTS = [
  'pages/play/index.wxml',
  'pages/roam/index.wxml',
  'components/cy/profile/index.wxml',
  'pages/shezhi/shezhi.wxml',
  'pages/merchant/index/index.wxml',
]

/** 抽出每个 <cy-scene-sheet 的 show="..." 值 */
function sheetShowExprs(wxml) {
  return [...wxml.matchAll(/<cy-scene-sheet\b[^>]*?\bshow="([^"]*)"/g)].map((m) => m[1])
}

test('五个宿主里的 scene-sheet 一律由 sceneCurrent 判定,不得有各自的 show 位', () => {
  for (const host of HOSTS) {
    const wxml = read(host)
    const shows = sheetShowExprs(wxml)
    if (PROTO_HOSTS[host]) {
      /* 2026-09-10 漫游四模式按用户裁决脱离小程序 DS:这些页的半屏壳换成了原型自己的 .psheet,
         页里没有 cy-scene-sheet 了。但**同一条不变量仍要守**——「一个宿主同时只渲一个半屏」:
         每一层 .psheet 都必须被外层的 wx:if 管着(按 sceneCurrent.id,或它自己那个 show 位),
         不许有第二个独立显隐位。所以改成数对子:有几层壳就得有几道门。 */
      const shells = (wxml.match(/class="psheet /g) || []).length
      const gates = (wxml.match(/wx:if="\{\{sceneCurrent && sceneCurrent\.id === '/g) || []).length
      assert.ok(shells > 0, `${host} 一层 .psheet 都没有,断言失去意义`)
      // 少数几层不挂 sceneCurrent、由自己的 show 位管。它们各自算一道门 ——
      // 门的形式不同,但「一层壳必须有一道门」这条不变。
      for (const own of PROTO_HOSTS[host]) assert.match(wxml, own)
      assert.equal(shells, gates + PROTO_HOSTS[host].length,
        `${host} 的 .psheet 层数与显隐门数对不上 —— 多出来的那层会和 sceneCurrent 同屏渲两个半屏`)
      assert.equal(shows.length, 0, `${host} 不该再出现 cy-scene-sheet`)
      continue
    }
    assert.ok(shows.length > 0, `${host} 没有 cy-scene-sheet,断言失去意义`)
    for (const show of shows) {
      // 唯一合法写法:show="{{true}}",显隐交给外层 wx:if="{{sceneCurrent && sceneCurrent.id === '...'}}"
      assert.equal(
        show,
        '{{true}}',
        `${host} 里有 cy-scene-sheet show="${show}" —— 独立 show 位会和 sceneCurrent 同屏渲两个面板`
      )
    }
  }
})

// 宿主里有两类门:①专属门 wx:if="{{... id === 'x'}}" ②兜底门 wx:if="{{sceneCurrent && id !== a && id !== b}}"
// 兜底门若漏排除某个专属 id,那个场景会同时渲专属面板和兜底面板 —— 两个 scene-sheet 同屏。
// 加这三个页内面板时就现场踩到过,所以写死成断言。
test('兜底 scene 宿主必须排除掉所有有专属门的场景 id', () => {
  for (const host of HOSTS) {
    const wxml = read(host)
    const dedicated = [...wxml.matchAll(/wx:if="\{\{sceneCurrent && sceneCurrent\.id === '([a-z0-9-]+)'\}\}"/g)].map((m) => m[1])
    const fallback = [...wxml.matchAll(/wx:if="\{\{sceneCurrent(?: && sceneCurrent\.id !== '[a-z0-9-]+')*\}\}"/g)]
    if (!fallback.length) continue // play / roam 没有兜底门,只有专属门
    assert.equal(fallback.length, 1, `${host} 有 ${fallback.length} 个兜底 scene 宿主,应当只有 1 个`)
    const excluded = [...fallback[0][0].matchAll(/id !== '([a-z0-9-]+)'/g)].map((m) => m[1])
    for (const id of dedicated) {
      assert.ok(
        excluded.includes(id),
        `${host}: '${id}' 有专属门但兜底门没排除它 → 该场景会同屏渲两个 scene-sheet`
      )
    }
  }
})

test('宿主页内面板已进注册表,half/full 与方案 §3.1 一致(peek 已于 2026-09-02 并入 half)', () => {
  const registry = read('utils/scene-registry.js')
  const expect = {
    'roam-rules': 'half',
    'roam-location-picker': 'half',
    'play-session-tools': 'half',
    'roam-share': 'full',
    'settings-identity-picker': 'half',
    'merchant-more-menu': 'half',
    'merchant-chapter-picker': 'half',
    'merchant-verification-result': 'half',
    'member-more-menu': 'half',
    'member-chapter-picker': 'half',
    'points-tasks': 'half',
  }
  for (const [id, variant] of Object.entries(expect)) {
    const line = registry.split('\n').find((l) => l.trim().startsWith(`'${id}'`))
    assert.ok(line, `注册表缺 ${id}`)
    assert.match(line, new RegExp(`variant: '${variant}'`), `${id} 的 variant 应为 ${variant}`)
  }
})

test('页内工具并入底部运行栈，真正的 scene-sheet 仍不得保留独立 show 位', () => {
  const playJs = read('pages/play/index.js')
  const playWxml = read('pages/play/index.wxml')
  assert.match(playJs, /sessionToolsOpen:\s*false/)
  assert.match(playWxml, /class="pbar[^>]*sessionToolsOpen/)
  assert.doesNotMatch(playWxml, /sceneCurrent\.id === 'play-session-tools'/)
  const roamJs = read('pages/roam/index.js')
  // locationPicker 的 data 位可以留(存别的字段),但不能再有人写它的 show
  assert.doesNotMatch(roamJs, /setData\(\{ locationPicker: \{ show: true \} \}\)/)
  assert.doesNotMatch(roamJs, /setData\(\{ 'share\.show': false \}\)/)
})
