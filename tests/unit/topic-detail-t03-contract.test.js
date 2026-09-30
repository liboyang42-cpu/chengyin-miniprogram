const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const stripWxmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

function section(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.ok(startIndex >= 0, `缺少区段起点: ${start}`)
  assert.ok(endIndex > startIndex, `缺少区段终点: ${end}`)
  return source.slice(startIndex, endIndex)
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  assert.ok(match, `缺少样式规则: ${selector}`)
  return match[1]
}

function metricBodies(source, field) {
  const escapedField = field.replace('.', '\\.')
  const fieldPattern = new RegExp(`\\{\\{\\s*${escapedField}(?:\\s*\\|\\|\\s*0)?\\s*\\}\\}`)
  return [...source.matchAll(/<view class="(?:david_tgb_con_3s_li|dd)"[^>]*>([\s\S]*?)<\/view>/g)]
    .map((match) => match[1])
    .filter((body) => fieldPattern.test(body))
}

function parseHex(hex) {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
}

function linear(channel) {
  const normalized = channel / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const [red, green, blue] = parseHex(hex).map(linear)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground, background) {
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function composite(foreground, alpha, background) {
  const front = parseHex(foreground)
  const back = parseHex(background)
  const channels = front.map((channel, index) => Math.round(channel * alpha + back[index] * (1 - alpha)))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function pageToken(source, name) {
  const match = source.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`))
  assert.ok(match, `无法读取不透明主题色: --${name}`)
  return match[1]
}

function rgbaBackground(source, selector) {
  const match = rule(source, selector).match(/background:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)\s*;/)
  assert.ok(match, `${selector} 必须保留可计算的 rgba 背景`)
  const color = `#${match.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`
  return { color, alpha: Number(match[4]) }
}

/** 取一条规则里 color: var(--token) 的 token，并沿 var() 追到基准 page{} 域的不透明色值。 */
function ruleColorVar(tokens, wxss, selector) {
  const declared = rule(wxss, selector).match(/color:\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*;/)
  assert.ok(declared, `${selector} 必须用 var() 引用色 token，不许写死色值`)
  const name = declared[1].slice(2)
  let current = name
  for (let hop = 0; hop < 4; hop += 1) {
    const direct = tokens.match(new RegExp(`--${current}:\\s*(#[0-9A-Fa-f]{6})\\s*;`))
    if (direct) return { name: current, hex: direct[1] }
    const alias = tokens.match(new RegExp(`--${current}:\\s*var\\(\\s*--([a-z0-9-]+)\\s*\\)`))
    assert.ok(alias, `无法解析 token --${current}`)
    current = alias[1]
  }
  assert.fail(`token --${name} 解析超过 4 跳`)
}

/* 2026-09-10 改判:这一块从「评分分布条」换成稿 214:384 的**数据条**。
   分布条(5星 63% / 4星 25% …)在稿上根本不存在,而且它与下面 det6 的
   「4.8 · 基于30条评论 + 评价卡」说的是同一件事,同屏印了两遍。
   本用例原本要防的那件事一个字没变 —— **评分不许回退成固定图片星标、
   评分本身不许被取整** —— 只是搬到了新结构上重新钉。 */
test('T03 数据条按稿,评分不回退图片星标也不被取整', () => {
  const wxml = stripWxmlComments(read('pages/topic/index/index.wxml'))
  const wxss = read('pages/topic/index/index.wxss')
  const bar = section(wxml, '<scroll-view scroll-x class="statbar"', '<view class="det4" id="tab-section">')

  assert.match(bar, /class="statbar__value"[^>]*>\{\{item\.value\}\}/)
  assert.match(bar, /class="statbar__stars"[^>]*wx:if="\{\{item\.starList\.length\}\}"/)
  assert.match(bar, /<cy-icon\b[^>]*name="star-filled"/, '星标必须是矢量图标')
  assert.doesNotMatch(bar, /<image\b/, '评分不能回退为固定图片星标')
  // 评分真值与星星颗数是两个字段:同一个值既当显示又当计数器,就会把 4.8 印成 5
  const facts = read('pages/topic/utils/topic-detail-facts.js')
  assert.match(facts, /value: String\(Math\.round\(rating \* 10\) \/ 10\)/, '评分显示保留一位小数')
  assert.match(facts, /starList: Array\.from/, '星星颗数另存一个数组')
  // 稿 188:2968:格与格之间一条竖线,不是给每格描边
  assert.match(rule(wxss, '.statbar__sep'), /width:\s*1rpx\s*;/)
  assert.match(rule(wxss, '.statbar__row'), /display:\s*flex\s*;/)
})

test('T03 封面元信息把类别 chips 与发起人/俱乐部分组，并治理换行和截断', () => {
  const wxml = stripWxmlComments(read('pages/topic/index/index.wxml'))
  const wxss = read('pages/topic/index/index.wxss')
  const hero = section(wxml, '<view class="cont topic-hero-meta">', '<view wx:if="{{info.isOwner==1}}"')
  const categoryEnd = hero.indexOf('<view class="topic-attribution"')

  assert.ok(categoryEnd > 0, '作者信息行必须独立于类别 chips')
  assert.match(hero.slice(0, categoryEnd), /class="topic-category-list"[\s\S]*class="topic-category-chip"[^>]*wx:for="\{\{ info\.sysCategoryList \}\}"/, '类别只在 chip 组内循环')
  assert.doesNotMatch(hero.slice(0, categoryEnd), /collaboratorsList|clubName/, '人物与组织不得混进类别 chip 组')
  // 2026-09-05 用户裁决删掉「合作者」:人物那半一并删。它显示的其实是 collaboratorsList[0],
  // 而发布者从来不会被写进 cms_collaborators(saveCollaborators 只写 dto.collaboratorIds)——
  // 那半一直是「把第一个合作者标成发起人」。所以这条改成**反向钉**:不许再拿合作者冒充发起人。
  assert.doesNotMatch(hero.slice(categoryEnd), /collaboratorsList/,
    '不得再拿 collaboratorsList 当发起人显示 —— 发布者不在这张表里')
  assert.match(hero.slice(categoryEnd), /topic-attribution__item--club[\s\S]*clubName/, '俱乐部要有独立组织块')

  assert.match(rule(wxss, '.topic-category-list'), /flex-wrap:\s*wrap\s*;/, '类别 chips 必须允许换行')
  const chip = rule(wxss, '.topic-category-chip')
  assert.match(chip, /border-radius:\s*var\(--cy-radius-pill\)\s*;/, 'chip 必须有明确圆角，不能像骨架条')
  assert.match(chip, /max-width:\s*[^;]+;/, 'chip 必须限制最大宽度')
  assert.match(chip, /overflow:\s*hidden\s*;/)
  assert.match(chip, /text-overflow:\s*ellipsis\s*;/)
  assert.match(chip, /white-space:\s*nowrap\s*;/)

  assert.match(rule(wxss, '.topic-attribution'), /flex-wrap:\s*wrap\s*;/, '作者/组织信息行必须允许窄屏换行')
  assert.match(rule(wxss, '.topic-attribution__item'), /max-width:\s*[^;]+;/, '每个作者/组织块必须限制最大宽度')
  const value = rule(wxss, '.topic-attribution__value')
  assert.match(value, /overflow:\s*hidden\s*;/)
  assert.match(value, /text-overflow:\s*ellipsis\s*;/)
  assert.match(value, /white-space:\s*nowrap\s*;/)
})

// 2026-09-06:本测试原来的名字与判据都建立在一个错前提上 —— 它把
// activeTab=='2' 里那行 .dd 叫「基础统计区」,可那行就长在 wx:for="{{info.chaptersList}}"
// 里面、紧挨着 {{chapter.name}};读 info.*(整个主题的合计)等于每一章都印同一组数,
// 而且看上去像是这一章的。真正的基础统计区是 hero 下面的 detailFacts(topic-facts)。
// 稿 181:715 章节标题下那行要的是**这一章**的时长/地点/玩法。
// 判据因此改成:章节循环里的 metric 行只能读 chapter.meta*,一个 info.* 都不许有。
test('T03 章节标题下的统计只读本章数据，不印主题合计', () => {
  const wxml = stripWxmlComments(read('pages/topic/index/index.wxml'))
  const contracts = [
    ['metaTime', 'clock', /\{\{\s*chapter\.metaTime\s*\}\}/],
    ['metaPlace', 'pin', /\{\{\s*chapter\.metaPlace\s*\}\}/],
    ['metaPlay', 'play', /\{\{\s*chapter\.metaPlay\s*\}\}/],
  ]

  for (const [field, icon, visibleMeaning] of contracts) {
    // 路线节点 tab(稿 181:715)与行程 tab 各一处,两处都得是本章的数
    const bodies = metricBodies(wxml, `chapter.${field}`)
    assert.equal(bodies.length, 2, `chapter.${field} 必须在路线节点 tab 与行程 tab 各出现一次`)
    for (const body of bodies) {
      assert.match(body, new RegExp(`<cy-icon\\b[^>]*\\bname="${icon}"[^>]*\\bsize="24"[^>]*\\/>`), `chapter.${field} 必须有匹配语义的矢量图标`)
      assert.match(body, visibleMeaning, `chapter.${field} 不能退回无标签裸数字`)
    }
  }

  // 真正的闸:主题合计不许出现在任何章节 metric 行里(这才是 T03 当初想拦的重复)
  for (const stale of ['info.totalTimeFormatted', 'info.locationCount', 'info.templateCount']) {
    assert.equal(
      metricBodies(wxml, stale).length, 0,
      `${stale} 是主题合计,不能印在章节标题下面(它已经在 detailFacts 里了)`
    )
  }

  // 主题合计本身没被删掉,还在 hero 下面那条数据条里(稿 214:384「预计游玩 4+ 小时」)
  const facts = read('pages/topic/utils/topic-detail-facts.js')
  assert.match(facts, /positiveNumber\(data\.totalTime\) \/ 3600/, '主题级时长必须仍由数据条提供')

  // 每一项都是「有就写、没有就不写」,不补 0
  const js = read('pages/topic/index/index.js')
  assert.match(js, /metaPlace[^\n]*'\s*个节点'/, '单位要和值一起在 JS 里拼,wxml 里插值紧跟单位会在缺值时留下裸单位');
  assert.match(js, /metaPlay[^\n]*'\s*个玩法'/, '同上');
  // CU-C-66(2026-09-24 走查):「缺地点数时不许印 0」这条判据没变,数源换了 ——
  // location_count 是主题保存时的快照,商家点位过审后不重算,于是卡片写 1、下面列出 2。
  // 现在按本章真实节点数算,快照仍作兵底(节点列表为空时)。
  assert.match(js, /const nodeCount = \(chapter\.nodes \|\| \[\]\)\.length \|\| Number\(chapter\.locationCount\) \|\| 0/,
    '缺地点数时不许印 0,且数源要用本章实时节点');
  assert.match(js, /metaPlace\s*=\s*nodeCount\s*>\s*0/, '缺地点数时不许印 0');
  assert.match(js, /metaPlay\s*=\s*Number\(chapter\.templateCount\)\s*>\s*0/, '缺玩法数时不许印 0')
})

test('负控：章节 metric 行退回 info.* 主题合计时必须判红', () => {
  const injected = `
    <view class="david_tgb_con_3s">
      <view class="david_tgb_con_3s_li">
        <cy-icon name="pin" size="24" /><text>{{info.locationCount || 0}} 个节点</text>
      </view>
    </view>`
  assert.equal(metricBodies(injected, 'info.locationCount').length, 1, '注入的主题合计必须被 metricBodies 抓到')
  assert.equal(metricBodies(injected, 'chapter.metaPlace').length, 0)
})

test('T03 新增暗色表面文字与评分分布实际对比度达标', () => {
  const tokens = read('style/tokens.wxss')
  const wxss = read('pages/topic/index/index.wxss')
  const primary = pageToken(tokens, 'cy-color-text-primary')
  const tertiary = pageToken(tokens, 'cy-color-text-tertiary')
  const surface = pageToken(tokens, 'cy-color-bg-surface')
  const strongSurface = pageToken(tokens, 'cy-color-bg-surface-strong')
  const playSurface = pageToken(tokens, 'cy-color-play-surface-solid')
  const playAccent = pageToken(tokens, 'cy-color-play-accent')

  assert.match(rule(wxss, '.topic-category-chip'), /color:\s*var\(--cy-color-text-primary\)\s*;/)
  // 分类 chip 改成叠在头图底边的玻璃 pill(Figma 2233:11364)后，底不再是不透明色。
  // 契约随之升级：断言玻璃 token，并按「照片可能是任意颜色」合成最坏情况算对比度 ——
  // 比原来钉死不透明底更强，因为它把身后那张图算进来了。
  assert.match(rule(wxss, '.topic-category-chip'), /background:\s*var\(--cy-color-bg-glass\)\s*;/)
  // 覆盖行(.cont)改成浮在头图上、自身不再有不透明底；可读性由两个玻璃 pill 承担。
  assert.match(rule(wxss, '.topic-attribution__item'), /background:\s*var\(--cy-color-bg-glass\)\s*;/)
  assert.match(rule(wxss, '.topic-attribution__label'), /color:\s*var\(--cy-color-text-secondary\)\s*;/)
  assert.match(rule(wxss, '\n.statbar'), /background:\s*var\(--cy-color-play-surface-solid\)\s*;/)
  // CU-M-189 / CU-C-110 / CU-C-130：数据条底钉死近黑，文字必须是暗域正文字。
  // 原来这条只断言 token 名(--cy-text-inverse)，而下面算对比度用的却是另一个 token，
  // 于是「断言的名字」和「被算对比度的名字」各说各话 —— 黑底黑字照样全绿。
  // 现在按规则里真正写的那个 token 解析出色值再算，撤掉修复必红。
  const statbarSurface = playSurface
  for (const [selector, floor] of [['.statbar__value', 4.5], ['.statbar__label', 4.5],
    ['.statbar__sub', 4.5], ['.statbar__stars', 3]]) {
    const color = ruleColorVar(tokens, wxss, selector)
    assert.ok(contrast(color.hex, statbarSurface) >= floor,
      `${selector} 在数据条底 ${statbarSurface} 上必须达到 ${floor}:1，实得 ${contrast(color.hex, statbarSurface).toFixed(2)}（token ${color.name} 解析为 ${color.hex}）`)
    assert.ok(!/inverse/.test(color.name),
      `${selector} 不得用 --cy-text-inverse：它在玩家暗域求值是近黑，而数据条底是不透明近黑`)
  }

  assert.ok(contrast(primary, strongSurface) >= 4.5, '不透明表面档必须仍达到 4.5:1')
  // 玻璃 chip:82% 不透明度压在头图上，照片全白是最坏情况(合成底最亮)。
  for (const [photo, label] of [['#ffffff', '照片全白'], ['#000000', '照片全黑'], ['#808080', '照片中灰']]) {
    const composited = composite('#1c1c1e', 0.82, photo)
    assert.ok(contrast(primary, composited) >= 4.5,
      `玻璃 chip 正文在「${label}」下必须仍达到 4.5:1，实得 ${contrast(primary, composited).toFixed(2)}`)
  }
  assert.ok(contrast(tertiary, surface) >= 4.5, 'tertiary 在不透明表面上必须仍达到 4.5:1')
  // 发起人/俱乐部标签现在压在玻璃 pill 上，身后是任意照片。用 tertiary 的话照片全白时
  // 只有 3.04:1（caption 字号不够），所以这条标签必须用 secondary —— 负控就是把它换回
  // tertiary，下面这个循环会红。
  const labelColor = pageToken(tokens, 'cy-color-text-secondary')
  for (const [photo, label] of [['#ffffff', '照片全白'], ['#000000', '照片全黑'], ['#808080', '照片中灰']]) {
    const composited = composite('#1c1c1e', 0.82, photo)
    assert.ok(contrast(labelColor, composited) >= 4.5,
      `发起人标签在「${label}」下必须达到 4.5:1，实得 ${contrast(labelColor, composited).toFixed(2)}`)
  }
  assert.ok(contrast(primary, playSurface) >= 4.5, '事实主读数对卡片底必须达到 4.5:1')
  assert.ok(contrast(tertiary, playSurface) >= 3, '事实标签对卡片底必须达到 3:1')
  assert.ok(contrast(playAccent, playSurface) >= 3, '评分数字与分布条对卡片底必须达到 3:1')
})

test('P2 发布广场用户可见中文文案不夹半角标点', () => {
  const wxml = stripWxmlComments(read('pages/square/list/index.wxml'))
  assert.doesNotMatch(wxml, /[\p{Script=Han}][,;:!?]|[,;:!?][\p{Script=Han}]/u, '中文文案相邻标点必须使用全角形式')
})
