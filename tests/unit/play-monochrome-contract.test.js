const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SURFACE_FILES = [
  'components/cy/free-map/index.js',
  'components/cy/free-map/index.wxml',
  'components/cy/free-map/index.wxss',
  'components/cy/play-header/index.wxml',
  'components/cy/play-header/index.wxss',
  'pages/play/index.js',
  'pages/play/index.wxml',
  'pages/play/index.wxss',
  'pages/roam/index.js',
  'pages/roam/index.wxml',
  'pages/roam/index.wxss',
  'subpackageRoam/history/index.js',
  'subpackageRoam/history/index.wxml',
  'subpackageRoam/history/index.wxss',
  'subpackageRoam/session/index.js',
  'subpackageRoam/session/index.wxml',
  'subpackageRoam/session/index.wxss',
  'utils/play-visual-tokens.js',
]

function sourceWithoutComments(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function methodSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `${startMarker} 施工区必须可定位`)
  return source.slice(start, end)
}

function routeUsesAccent(source) {
  const route = methodSource(source, '_drawRoute(', 'paintRouteThumb()')
  return /strokeStyle\s*=\s*PLAY_STORY_CARD\.accent/.test(route)
    && /fillStyle\s*=\s*PLAY_STORY_CARD\.accent/.test(route)
}

function isNeutralHex(value) {
  const raw = value.slice(1)
  const rgb = raw.length === 3 || raw.length === 4
    ? raw.slice(0, 3).split('').map((part) => parseInt(part + part, 16))
    : [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)].map((part) => parseInt(part, 16))
  return Math.max(...rgb) - Math.min(...rgb) <= 32
}

function isNeutralRgb(value) {
  const channels = value.match(/rgba?\(([^)]*)\)/i)[1]
    .split(',')
    .slice(0, 3)
    .map((part) => Number(part.trim()))
  return channels.every(Number.isFinite) && Math.max(...channels) - Math.min(...channels) <= 32
}

// 2026-09-09 用户裁决「所有页面与 HTML 原型一模一样」:三键的状态色改取原型的字面值,
// 不再取 Figma 板的实测值(两者对不上时以 HTML 为准)。
//   开始/继续 #00B503 → #22C55E(原型 --green)   标签 #4ADE80(原型 --green-l)
//   暂停      #F75707 → #F97316(原型 --orange)
//   结束      #FF3B30 → #EF4444(原型 --red)
// 旧值留在集合里:它们还活在别处(如集邮角标沿用过暂停橙),等各自的搬运批次到了再摘。
const PLAY_STATE_COLORS = new Set([
  '#22C55E', '#4ADE80', '#F97316', '#EF4444',
  '#00B503', '#F75707', '#30D158', '#FF3B30',
  // 2026-09-10 漫游四模式脱离 DS、照 HTML 原型搬:原型 .btn.d(危险动作那一档)的字色。
  //   用途只有一处 —— 设置页里「清空本机缓存」的确认键。与上面那组同性质:状态色,不是品牌色。
  '#F87171',
])

// 只豁免各路由已审定的字面值；新增值(尤其品牌紫)仍会被同一门禁抓住，避免把整页排除出扫描面。
// 2026-08-10:原「探索护照暖色直铺」那组豁免随 subpackageRoam/passport 整页删除一并移除。
// ⚠️ 下面两条 #D4AF37 早在本次改动之前就已是死条目(两份 wxss 里都搜不到该色),未一并清理。
// 自由探索开卡包的镭射色谱(2026-08-16 用户验收:「要有颜色 视觉动效」)。
// ⚠️ 这组色的豁免**只覆盖开包那一拍的爆炸层**(彩色光晕 / 放射光条 / 碎片):
//    它们是转瞬即逝的演出,落定后的六宫格、地图、HUD 仍然归单色契约管。
//    谁要是把这几个值拿去铺常驻表面,门禁抓不到 —— 那是这条豁免的已知代价,
//    代价换的是「别为了一次爆炸把整页排除出扫描面」。
const HOLO_BLAST = ['#BFE8E0', '#C9D8EE', '#F5D6C8', '#F2E3B8']
const HOLO_BLAST_RGBA = [
  'rgba(191,232,224,0)', 'rgba(242,227,184,.72)', 'rgba(245,214,200,.40)',
]
const INTENTIONAL_COLORED_VALUES = new Map([
  // 2026-08-26 用户裁决按 Figma V2 10:169 落地图游戏角色：玩家青、商家金/红、NPC 紫、奶油徽章。
  // 只放行集中色板文件；颜色若被复制到地图/HUD 的普通表面，仍会被同一门禁抓住。
  // 2026-09-05 附近的局按同一规范(aJaPDtyMwb7UfzQBUaTWhE 10:3)补限时活动粉 #F45B75;已满灰 #5A6A6C 本身中性不需放行。
  // 2026-09-09 漫游四模式裁决:主题描边按玩法分色(城市定向绿 #4ADE80 / 自由探索蓝 #5A90D6),
  //   星星只表示「这家有玩法」并改金黄 #F5B301(原奶油 #E2C489 压在深色地图上发灰)。
  //   三个值都只在这张色板上存在,复制到地图/HUD 的普通表面仍由本门禁判红。
  ['utils/play-visual-tokens.js', new Set(['#4FD3D0', '#E7A84B', '#E85F4F', '#D77BB4', '#FFF0CF', '#F45B75', '#4ADE80', '#5A90D6', '#F5B301'])],
  // 漫游历史/详情的小金六边形勋章(2026-08-06 用户验收):金 #D4AF37 是勋章语义色,非品牌紫
  ['subpackageRoam/history/index.wxss', new Set(['#D4AF37'])],
  ['subpackageRoam/session/index.wxss', new Set(['#D4AF37'])],
  // 2026-08-24 用户裁决按 Figma 220:1415 浅色路线回放施工；只放行保存卡 Canvas 的路径紫，
  // 文件内其它彩色值仍由同一门禁判红。
  ['subpackageRoam/session/index.js', new Set(['#4B46F5'])],
  // Figma 220:1415/1437 的完赛 Canvas 与屏幕浅色叙事域同源；仅额外放行路线紫。
  ['pages/play/index.js', new Set(HOLO_BLAST.concat(['#4B46F5']))],
  // 2026-09-09 自己的定位点照原型 .selfdot 搬:18px 蓝点 + 3px 白描边 + 18% 蓝光晕。
  // 蓝是「这是我」这一条信息的唯一载体 —— 原来画成白点,地图上和别的白色点位分不开。
  // 2026-09-11 商家横滑白卡(原型 f-fun / f-discover)的状态点:营业绿 #16A34A / 未知灰 #C7C7C7。
  //   灰本身中性不必放行;绿是「这家开着」这条信息的唯一载体,和品牌紫无关。
  ['pages/roam/index.js', new Set(['#2F7BF6', 'rgba(47,123,246,.18)', '#16A34A'])],
  // 2026-09-11 章节剧情照原型 c-chfull 重做:眉标金 #E2C489 是原型原值,
  //   只在这一屏的 .chfull__eyebrow 上,复制到别处仍由本门禁判红。
  ['pages/play/index.wxss', new Set(HOLO_BLAST_RGBA.concat(['#E2C489']))],
  // 2026-08-31 漫游 GO 开场：HTML 原型弧线切场的紫/青彩带与豆子，一次性演出不是常驻地图色。
  ['pages/roam/index.wxss', new Set([
    '#825cff', '#4c2abe', '#6940dd', '#087b9e', '#25c7ee', '#128fb7',
    '#ff4d5f', '#ffd84a', '#45a8ff',
    'rgba(95,53,190,.34)',
  ])],
])

function isIntentionalColoredValue(file, value) {
  return INTENTIONAL_COLORED_VALUES.get(file)?.has(value) || false
}

// 章节氛围是产品允许的唯一常驻彩色表面，但保护半径必须收窄到五个固定 selector。
// 同一色值若被挪到地图/HUD/导航或普通谜题样式，仍由下面的单色扫描判红。
function withoutChapterAtmospherePresets(file, source) {
  if (file !== 'pages/play/index.wxss') return source
  // 2026-09-06 章节配色换成黑蓝红黄白五档纯色,豁免名单跟着换(原 night/archive/moss/neon)
  return source.replace(/\.atmosphere--(?:default|blue|red|yellow|white)\s*\{[^}]*\}/g, '')
}

function colorFailures(files = SURFACE_FILES, overrides = {}) {
  const failures = []
  files.forEach((file) => {
    const rawSource = overrides[file] == null ? sourceWithoutComments(file) : overrides[file]
    const source = withoutChapterAtmospherePresets(file, rawSource)
    const hexes = source.match(/#[0-9a-f]{3,8}\b/gi) || []
    const rgbs = source.match(/rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?[^)]*\)/gi) || []
    const semanticColors = source.match(/var\(--cy-(?:accent(?:-strong|-soft)?|color-(?:brand(?:-strong|-soft)?|status-(?:success|warning|danger|info)))\)/g) || []
    hexes.filter((value) => !isIntentionalColoredValue(file, value) && !isNeutralHex(value) && !PLAY_STATE_COLORS.has(value.toUpperCase()))
      .forEach((value) => failures.push(`${file}: ${value}`))
    rgbs.filter((value) => !isIntentionalColoredValue(file, value) && !isNeutralRgb(value))
      .forEach((value) => failures.push(`${file}: ${value}`))
    semanticColors.filter((value) => !isIntentionalColoredValue(file, value))
      .forEach((value) => failures.push(`${file}: ${value}`))
  })
  return failures
}

test('三模式游玩主路径保持中性色，只放行已裁决的 Figma 路线回放紫', () => {
  const failures = colorFailures()
  assert.deepEqual(failures, [])
})

test('完赛路线缩略图与保存卡保持 Figma 白底浅灰面紫色路线，不回退黑色 Canvas', () => {
  const source = sourceWithoutComments('pages/play/index.js')
  const finishCanvas = methodSource(source, 'paintRouteThumb()', 'saveFinishCard()')

  assert.match(source, /const PLAY_STORY_CARD\s*=\s*Object\.freeze\(\{[\s\S]*?page:\s*'#FFFFFF'[\s\S]*?surface:\s*'#F6F7FA'[\s\S]*?accent:\s*'#4B46F5'/)
  assert.equal(routeUsesAccent(source), true, '路线本体的线段与节点必须直接消费紫色 accent')
  assert.match(finishCanvas, /PLAY_STORY_CARD\.page/)
  assert.match(finishCanvas, /PLAY_STORY_CARD\.surface/)
  assert.doesNotMatch(finishCanvas, /#(?:0A0A0A|141414|2A2A2A)\b/i)
})

test('负控：路线本体退回黑灰色时，紫色路线合同必须判红', () => {
  const source = sourceWithoutComments('pages/play/index.js')
  const route = methodSource(source, '_drawRoute(', 'paintRouteThumb()')
  const mutatedRoute = route.replaceAll('PLAY_STORY_CARD.accent', 'PLAY_STORY_CARD.text')
  assert.notEqual(mutatedRoute, route, '路线色变异锚点失效')
  const mutated = source.replace(route, mutatedRoute)
  assert.equal(routeUsesAccent(mutated), false)
})

test('完赛卡里程碑标题与品牌脚保留至少 40px 基线间距', () => {
  const source = sourceWithoutComments('pages/play/index.js')
  const finishCard = methodSource(source, 'paintFinishCard(cb)', 'saveFinishCard()')
  assert.match(finishCard, /const footerY\s*=\s*H\s*-\s*24/)
  assert.match(finishCard, /const milestoneTitleY\s*=\s*Math\.min\(my\s*\+\s*62,\s*footerY\s*-\s*40\)/)
  assert.match(finishCard, /fillText\(ms\.title,\s*W\s*\/\s*2,\s*milestoneTitleY\)/)
  assert.match(finishCard, /fillText\('城 瘾 · 走 进 城 市 的 瘾',\s*W\s*\/\s*2,\s*footerY\)/)
})

test('负控：把开始绿换回品牌紫必须判红', () => {
  const file = 'pages/play/index.wxss'
  const source = sourceWithoutComments(file)
  const mutated = source.replace('#22C55E', '#6E35C1')
  assert.notEqual(mutated, source, '状态色变异锚点失效')
  assert.deepEqual(colorFailures([file], { [file]: mutated }), [`${file}: #6E35C1`])
})

test('章节配色只在五个固定预设 selector 内豁免，挪到普通表面必须判红', () => {
  const file = 'pages/play/index.wxss'
  const source = sourceWithoutComments(file)
  assert.match(source, /\.atmosphere--blue\s*\{[^}]*#0E1A33/)
  assert.deepEqual(colorFailures([file], { [file]: source }), [])

  const leaked = source + '\n.gp2__card{border-color:#0E1A33;}\n'
  assert.deepEqual(colorFailures([file], { [file]: leaked }), [`${file}: #0E1A33`])
})

// 豁免是「按值放行」不是「按文件放行」。少了这条,以后谁往 play 页塞任意彩色都不会红,
// 这条豁免就从一次验收变成了把整页排除出扫描面。
test('负控：镭射豁免只放行清单里的那几个值，同文件的新彩色仍要判红', () => {
  const file = 'pages/play/index.js'
  const source = sourceWithoutComments(file)
  assert.ok(source.includes('#BFE8E0'), '镭射色谱锚点失效')

  const mutated = source.replace('#BFE8E0', '#6E35C1')
  assert.deepEqual(colorFailures([file], { [file]: mutated }), [`${file}: #6E35C1`])

  // 同时确认清单里那几个值确实是被放行的(不是因为整条扫描没跑起来)
  assert.deepEqual(colorFailures([file], { [file]: source }), [])
})

test('漫游回看不信任历史记录携带的任意点色', () => {
  const session = sourceWithoutComments('subpackageRoam/session/index.js')

  assert.doesNotMatch(session, /color:\s*p\.color/)
  assert.match(session, /color:\s*SHARE_CARD\.poi\[i % SHARE_CARD\.poi\.length\]/)
  assert.match(session, /poi:\s*\['#4B46F5', '#8C91A0', '#646B78', '#121317'\]/)
})
