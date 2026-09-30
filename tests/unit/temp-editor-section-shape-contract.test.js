/* 「编辑玩法模板」配置页 · 段的形状契约(2026-09-22)
 *
 * 为什么是形状门禁,不是设计文档:
 * 这一页已经有 25 个玩法段,而且**还会一直加**。既有的门禁(advanced-game-config-v51 /
 * publish-temp-v51-roundtrip / advanced-game-config-roundtrip / publish-present-choice)
 * 盯的全是**数据**:字段存不存得住、读不读得回、呈现方式默认档对不对。
 * 没有一道盯**长相** —— 于是 2026-09-22 新加的取景轮廓那一段一次撞齐四样:
 *   · 单槽媒体位套了为「两槽并排」设计的 .cg-qmedia,撑成整行 160rpx 的灰块;
 *   · 「轮廓浓淡」独占一个两列栅格,右半边空着,整段竖着看成了 半幅→两列→chips→半幅;
 *   · 底部 hint 攒到 128 字,而它要解释的控件在 5 个字段之外;
 *   · 连续量用数字键盘输入。
 * 四样全部通过了当时的全部门禁与 lint。用户的原话是「设计的很乱」。
 *
 * 判据全部来自**现码实测**,不是我拍的数:下面每条冻结基线旁边都写了它从哪来。
 * 冻结基线一律**只减不增** —— 修好一处就把它从名单里删掉,名单空了就把上限调到 0。
 *
 * 配套手册:docs/玩法段配置页_设计手册.md(讲为什么 + 新段骨架)。
 * 手册会烂,这份门禁不会 —— 冲突时以本文件为准。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const WXML = path.join(ROOT, 'pages', 'publish', 'temp', 'index.wxml')
const WXSS = path.join(ROOT, 'pages', 'publish', 'temp', 'index.wxss')

/** 从一个 <view ...> 开始按配对计数取整块。自闭合标签不入栈。 */
function blockAt(src, start) {
  let depth = 0
  const re = /<view\b[^>]*?(\/?)>|<\/view>/g
  re.lastIndex = start
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[0] === '</view>') depth -= 1
    else if (m[1] === '/') continue
    else depth += 1
    if (depth === 0) return src.slice(start, re.lastIndex)
  }
  return null
}

/** 全仓真源:一个 gameSection 一块。返回 { 段名: 整块 wxml }。 */
function sections(src) {
  const out = new Map()
  const re = /<view class="cg-gcfg" wx:if="\{\{gameSection === '(\w+)'\}\}">/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const body = blockAt(src, m.index)
    assert.ok(body, `段 ${m[1]} 的 <view> 没配平,先修标签再谈形状`)
    out.set(m[1], body)
  }
  return out
}

const read = () => fs.readFileSync(WXML, 'utf8')

/* ===================== R0 扫描分母 ===================== */

test('扫描分母正常:段数不能凭空掉下去(否则下面每条都在空转)', () => {
  const secs = sections(read())
  // 2026-09-22 实测 25 段。加段会涨,这里只防「一个都扫不到」和「整片消失」。
  assert.ok(secs.size >= 20, `只扫到 ${secs.size} 个玩法段,选择器多半失配了`)
})

/* ===================== R1 段的外壳固定 ===================== */

function checkShell(name, body) {
  assert.match(body.slice(0, 200), /<view class="cg-gcfg" wx:if[^>]*>\s*<view class="cg-adv-body">/,
    `${name} 没套标准外壳 cg-gcfg > cg-adv-body —— 自造结构等于这一段的留白、分隔、滚动都各走各的`)
}

test('★R1 每个玩法段都必须套 cg-gcfg > cg-adv-body', () => {
  for (const [name, body] of sections(read())) checkShell(name, body)
})

/* ===================== R2 两列栅格不准只放一个 ===================== */

/** .cg-adv-grid 是 repeat(2, minmax(0,1fr))。只放一个子项 = 左半幅 + 右边一块空白。 */
function lonelyGrids(body) {
  const hits = []
  const re = /<view class="cg-adv-grid"[^>]*>/g
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const blk = blockAt(body, m.index)
    if (blk && (blk.match(/<view><view class="cg-cfg-label"/g) || []).length === 1) hits.push(m.index)
  }
  return hits
}

/* 2026-09-26 全目录统一：单字段半行及数字框与开关混排已清零。 */
const LONELY_GRID_CEILING = 0

test('★R2 两列栅格里只放一个字段 —— 只减不增', () => {
  const secs = sections(read())
  const found = []
  for (const [name, body] of secs) for (const _ of lonelyGrids(body)) found.push(name)
  assert.ok(found.length <= LONELY_GRID_CEILING,
    `单子项 cg-adv-grid ${found.length} 处 > 冻结上限 ${LONELY_GRID_CEILING}(${found.join(',')})。\n` +
    '  两列栅格里只放一个字段,右半边是空的 —— 整段竖着看会变成 半幅/两列/半幅 的参差。\n' +
    '  要么补第二个字段凑成一行,要么把它挪出栅格按整行的 label + 控件写。')
  assert.ok(found.length >= LONELY_GRID_CEILING - 3,
    `实测只剩 ${found.length} 处,冻结上限 ${LONELY_GRID_CEILING} 已经过期 —— 还完债要把上限调下来,` +
    '否则这条棘轮就是一道松掉的闸(见 memory feedback-gate-without-negative-control-rots)。')
})

/* ===================== R3 hint 不准写成墙 ===================== */

function hintsOf(body) {
  return [...body.matchAll(/cg-cfg-hint">([^<]*)</g)].map((m) => m[1])
}

/* 冻结基线:2026-09-22 实测最长 105 字(quietHold)。只减不增。
   超过这个长度的说明请拆:把解释某个控件的那几句移到那个控件正下方,
   段末只留「这个玩法整体是什么」。photoCheck 的 128 字就是这么拆回 97 的。 */
const HINT_MAX_CHARS = 105

test('★R3 单条 hint 不准超过冻结长度 —— 长说明要拆到它解释的控件下面', () => {
  const over = []
  for (const [name, body] of sections(read())) {
    for (const h of hintsOf(body)) if (h.length > HINT_MAX_CHARS) over.push(`${name}:${h.length}字`)
  }
  assert.deepEqual(over, [],
    `这些 hint 超过 ${HINT_MAX_CHARS} 字:${over.join(' / ')}\n` +
    '  一整段贴在最底下的说明,读到时早忘了在说哪个控件(实测 photoCheck 的取景轮廓说明' +
    '离它的控件隔了 5 个字段)。拆开:控件自己的那几句放控件正下方。')
})

/* ===================== R4 单槽媒体位必须收窄 ===================== */

/** 一个「媒体位」= 一个带 wx:if 的 slot/add 节点。它的 wx:else 孪生是同一个位置的另一态,
 *  不能数成两个 —— 2026-09-22 实测:第一版判据数的是全部节点,于是单槽恒等于 2、永远不红,
 *  我把真文件的 --one 摘掉它照样绿。**绿是廉价的,这条就是被它坑出来的。** */
function mediaSlots(block) {
  const nodes = block.match(/class="cg-qmedia-(?:slot|add)"[^>]*>/g) || []
  return nodes.filter((n) => !/\bwx:else\b/.test(n)).length
}

/** 全文件扫,不只扫玩法段:题干附件那个两槽位在 gcfg 之外,它正是「两个位才配用 flex:1」的活样本。 */
function lonelyMedia(src) {
  const bad = []
  const re = /<view class="(cg-qmedia(?:\s[^"]*)?)"[^>]*>/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const blk = blockAt(src, m.index)
    if (!blk) continue
    if (mediaSlots(blk) === 1 && !/\bcg-qmedia--one\b/.test(m[1])) bad.push(m.index)
  }
  return bad
}

test('★R4 只放一个位的 cg-qmedia 必须带 --one', () => {
  assert.deepEqual(lonelyMedia(read()), [],
    '有媒体位只放一个槽却没带 cg-qmedia--one。\n' +
    '  .cg-qmedia 的子项是 flex:1,那是给「配图 + 音频」两个位并排设计的;' +
    '单个位套上去就是一整行 160rpx 的灰块,视觉重量压过它上下所有单行输入。')
})

test('negative control:摘掉 --one 必须真的红 —— 第一版判据就是在这儿哑的', () => {
  const src = read()
  const mutated = src.replace('class="cg-qmedia cg-qmedia--one"', 'class="cg-qmedia"')
  assert.notEqual(mutated, src, '负控锚点失效:--one 的挂法变了,判据要跟着改')
  assert.ok(lonelyMedia(mutated).length > 0, '摘掉 --one 还是绿的,这条门禁是哑的')
})

test('negative control:两个位的 cg-qmedia 不许被误伤', () => {
  // 题干附件:配图 + 音频,各自一对 wx:if/wx:else。它就该撑满,不该被要求带 --one。
  const two = '<view class="cg-qmedia">' +
    '<view class="cg-qmedia-slot" wx:if="{{a}}"></view><view class="cg-qmedia-add" wx:else></view>' +
    '<view class="cg-qmedia-slot" wx:if="{{b}}"></view><view class="cg-qmedia-add" wx:else></view>' +
    '</view>'
  assert.equal(mediaSlots(two), 2, 'wx:if/wx:else 孪生被数成了四个位')
  assert.deepEqual(lonelyMedia(two), [], '两个位的媒体块被误判成单槽')
})

test('★R4 配套:--one 这条规则本身必须还在 wxss 里', () => {
  assert.match(fs.readFileSync(WXSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
    /\.cg-qmedia--one[^{]*\{[^}]*flex:/,
    'wxss 里没有 .cg-qmedia--one 的收窄规则 —— 那 wxml 上挂着的类就是个空类,白挂')
})

/* ===================== R5 「选填」只有一种写法 ===================== */

/* 原型使用「· 选填」；2026-09-26 全部配置标签已统一。 */
const PAREN_OPTIONAL_CEILING = 0

test('★R5 「选填」写法只减不增,新段一律跟原型用间隔号', () => {
  const paren = []
  for (const [name, body] of sections(read())) {
    for (const l of body.matchAll(/cg-cfg-label">([^<]*选填[^<]*)</g)) {
      if (l[1].includes('（选填')) paren.push(`${name}:${l[1]}`)
    }
  }
  assert.ok(paren.length <= PAREN_OPTIONAL_CEILING,
    `全角括号版「（选填）」${paren.length} 处 > 冻结上限 ${PAREN_OPTIONAL_CEILING}:${paren.join(' / ')}\n` +
    '  原型用的是「· 选填」。同一屏两种写法,商家每读一个标签都要重新认一次。')
})

/* ===================== R7 归一化比例量必须用滑块 ===================== */

/* 为什么判据是「归一化比例量」而不是「数值跨度」:
   2026-09-23 量过现码 54 个 type="number" —— 跨度最大的三个是 目标步数(99900)、
   允许误差毫秒(4950)、倒计时长秒(3595),它们**天然就该是数字框**(你得敲 10000 步,
   拖滑块拖不出来)。按跨度卡会把它们全误伤,而真正该抓的 占画面百分比(跨度 80)夹在中间。

   真正的分界是:**这个数对商家有没有独立意义**。
   秒 / 毫秒 / 步 / 度 / 次 / 字 / 分 —— 有单位、有现实含义,商家心里有准数,敲进去最快。
   百分比 / 浓淡 / 透明度 / 占画面宽 —— 是相对另一个量的比值,具体数字没意义,只有手感;
   让商家为了调个透明度去敲数字键盘是反直觉的(photoCheck 的「轮廓浓淡」就是这么改成滑块的)。

   滑块不用另写 js:slider 的 bindchange 同样给 e.detail.value,onAdvancedField 原样能收。 */
const NORMALIZED = /百分比|％|%|浓淡|透明度|不透明度|占画面|占屏|比例/

/** 返回所有「是归一化比例量、却还用 type=number」的字段。整页扫,不只扫玩法段。 */
function ratioAsNumberInput(src) {
  const bad = []
  for (const m of src.matchAll(/<input[^>]*type="number"[^>]*>/g)) {
    const tag = m[0]
    const ph = (tag.match(/placeholder="([^"]*)"/) || [, ''])[1]
    const labels = src.slice(0, m.index).match(/cg-cfg-label">([^<]*)</g) || []
    const last = labels.length ? labels[labels.length - 1].replace(/^cg-cfg-label">/, '').replace(/<$/, '') : ''
    const text = last + ' ' + ph
    // 百分制区间也算:0 至 100 在这一页只可能是比值
    if (NORMALIZED.test(text) || /\b0\s*(?:至|-|–|到)\s*100\b/.test(text)) {
      bad.push(((tag.match(/data-field="([^"]*)"/) || [, '?'])[1]) + '(' + last + ')')
    }
  }
  return bad
}

/* 2026-09-26：最后一处置信度比值改为 0–100、步长 1 的滑块。 */
const RATIO_NUMBER_CEILING = 0

test('★R7 归一化比例量(百分比/浓淡/占画面宽)必须用 slider,不能用数字输入框', () => {
  const bad = ratioAsNumberInput(read())
  assert.ok(bad.length <= RATIO_NUMBER_CEILING,
    `这些是比值却还在用数字键盘:${bad.join(' / ')}(冻结上限 ${RATIO_NUMBER_CEILING})\n` +
    '  比值的具体数字对商家没意义,只有手感 —— 用 <slider min max step show-value>,\n' +
    '  bindchange 直接绑 onAdvancedField(它读 e.detail.value),不用加 js。')
  assert.ok(bad.length >= RATIO_NUMBER_CEILING,
    `实测只剩 ${bad.length} 处,冻结上限 ${RATIO_NUMBER_CEILING} 过期了 —— 还完债要把上限调下来。`)
})

test('negative control:塞一个「占画面宽度百分比」的数字框必须被抓出来', () => {
  const inj = '<view class="cg-cfg-label">显形图大小（占画面宽度百分比）</view>' +
    '<input class="cg-cfg-input" type="number" data-field="overlayScale" placeholder="20 至 100，不填默认 60" />'
  assert.equal(ratioAsNumberInput(inj).length, 1, '比例量用数字框没被抓到,R7 是空转的')
})

test('negative control:有单位的真实量不许被误伤(这是按跨度卡会毁掉的那批)', () => {
  const ok = [
    ['目标步数', '100 至 100000'], ['倒计时长（秒）', '5 至 3600'],
    ['允许误差（毫秒）', '50 至 5000'], ['目标方位（度）', '0 至 359，正北是 0'],
    ['可以拍几次（1 至 10）', '3'], ['名称长度上限（字）', '2 至 40'], ['答对的奖励分', '0 至 200'],
  ].map(([l, p]) => `<view class="cg-cfg-label">${l}</view><input type="number" placeholder="${p}" />`).join('')
  assert.deepEqual(ratioAsNumberInput(ok), [], '把有单位的真实量误判成了比值')
})

test('negative control:已经改成 slider 的不许再被抓(否则改对了反而红)', () => {
  const sliderOk = '<view class="cg-cfg-label">轮廓浓淡</view>' +
    '<slider min="0" max="100" step="5" data-field="frameOpacity" show-value />'
  assert.deepEqual(ratioAsNumberInput(sliderOk), [], 'slider 被当成了违规')
})

/* ===================== R6 段不准是空壳 ===================== */

function isShell(body) {
  const labels = (body.match(/class="cg-cfg-label"/g) || []).length
  const controls = (body.match(/class="cg-cfg-input"|<slider|class="cg-chip |class="cg-qmedia|class="cg-cfg-add"|<switch|<picker/g) || []).length
  return labels === 0 || controls === 0
}

test('★R6 每个段都必须真的有 label + 至少一个可填控件', () => {
  const empty = []
  for (const [name, body] of sections(read())) if (isShell(body)) empty.push(name)
  assert.deepEqual(empty, [],
    `这些段在册但界面是空壳:${empty.join(',')}\n` +
    '  段名进了 gameSection、玩法单子上点得进来,进来却什么都配不了 ——' +
    '本仓最爱踩的「一端建好、另一端没接」在编辑页的样子,而且不报错。')
})

/* ===================== 负控:每条都要能真的判红 ===================== */

test('negative control:外壳被拆掉必须抛', () => {
  const [name, body] = [...sections(read())][0]
  const mutated = body.replace('<view class="cg-adv-body">', '<view class="cg-whatever">')
  assert.notEqual(mutated, body, '负控锚点失效:外壳写法变了,判据要跟着改')
  assert.throws(() => checkShell(name, mutated))
})

test('negative control:再加一个单子项栅格必须顶穿上限', () => {
  const secs = sections(read())
  let found = 0
  for (const [, body] of secs) found += lonelyGrids(body).length
  const injected = `<view class="cg-adv-grid">\n<view><view class="cg-cfg-label">只有我一个</view></view>\n</view>`
  assert.equal(lonelyGrids(injected).length, 1, '检查器认不出单子项栅格 —— 那 R2 是空转的')
  assert.ok(found + 1 > LONELY_GRID_CEILING, '上限比实测高出一格以上,加一处也不会红 = 闸是松的')
})

test('negative control:hint 判据按字数算,注释和空白不能把它蒙混过去', () => {
  const wall = 'x'.repeat(HINT_MAX_CHARS + 1)
  const body = `<view class="cg-gcfg"><view class="cg-cfg-hint">${wall}</view></view>`
  assert.equal(hintsOf(body).filter((h) => h.length > HINT_MAX_CHARS).length, 1,
    '超长 hint 没被数出来')
  const ok = `<view class="cg-cfg-hint">${'x'.repeat(HINT_MAX_CHARS)}</view>`
  assert.equal(hintsOf(ok).filter((h) => h.length > HINT_MAX_CHARS).length, 0, '刚好卡线的被误判')
})

test('negative control:空壳段必须被抓出来,有控件的不许误伤', () => {
  assert.equal(isShell('<view class="cg-gcfg"><view class="cg-adv-body"></view></view>'), true,
    '真空壳没被抓出来')
  assert.equal(isShell('<view class="cg-cfg-label">x</view><input class="cg-cfg-input" />'), false,
    '有 label 有输入框却被判成空壳')
  assert.equal(isShell('<view class="cg-cfg-label">x</view><slider min="0" />'), false,
    'slider 不算控件 —— 那 R6 会把用滑块的段全部误伤')
})

// 目录必须逐段覆盖，不能抽查几个玩法后把其余空壳当成统一。
test('所有目录玩法都有配置段，九宫格明确指向主题级配置', () => {
  const { ALL } = require('../../pages/publish/utils/publish/node-game-catalog.js')
  const src = read(); const secs = sections(src)
  for (const game of ALL) {
    if (game.section) assert.ok(secs.has(game.section), game.key + ' 缺少编辑配置段')
    else { assert.equal(game.key, 'bingo'); assert.match(src, /gameKey === 'bingo'[\s\S]*?主题编辑页配置/) }
  }
})

test('多行输入不能套单行输入框样式', () => {
  assert.doesNotMatch(read(), /<textarea[^>]*class="[^"]*\bcg-cfg-input\b/)
})
