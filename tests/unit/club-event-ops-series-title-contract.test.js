// E1 活动运营「日期清单」:行标题不得把数据库主键和英文枚举端给主理人看。
//
// 2026-09-02 截图实测(注入业务数据后):三行全是
//   「主题 #1 · WEEKLY」「版本 2 · 候补开启 ·  个可编辑日期」
// 主理人看到的是一个自增 id 加一个后端常量。而本页手里就有两份现成的中文:
//   · this.data.topics  —— 每个主题带 name(「外滩夜行 · 霓虹拾光」)
//   · RECURRENCES       —— 单次 / 每周 / 自定义日期
// 两者本来就是给同一页的选择器用的,只是清单行没接上。
//
// ⚠️ topics 与 series 是两个并发请求,先后不定,所以两边成功后都要重算一次;
//    只接一边会出现「刷新前是 #3、刷新后才变成主题名」的闪动。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const stripWxmlComments = s => s.replace(/<!--[\s\S]*?-->/g, '')

// 锚点钉结构:找到 .row-title 这个节点本身,再看它绑了什么,
// 不去匹配「主题 #」这串字面量(那串在本文件注释里也有,钉字面量会自伤)
function seriesRowTitleBinding() {
  const wxml = stripWxmlComments(read('pages/club/event-ops/index.wxml'))
  const block = /wx:for="\{\{seriesRows\}\}"[\s\S]*?<\/view>\s*<\/view>/.exec(wxml)
  assert.ok(block, 'seriesRows 的循环块找不到了,本合同的锚点要重挑')
  const title = /<text class="row-title">([^<]*)<\/text>/.exec(block[0])
  assert.ok(title, 'seriesRows 行里的 .row-title 不见了')
  return title[1]
}

test('日期清单行标题不得直接绑 topicId 或 recurrenceType', () => {
  const binding = seriesRowTitleBinding()
  assert.ok(!/\bitem\.topicId\b/.test(binding), `行标题还在直出主键:${binding}`)
  assert.ok(!/\bitem\.recurrenceType\b/.test(binding), `行标题还在直出英文枚举:${binding}`)
})

test('行标题绑的是算好的中文字段', () => {
  const binding = seriesRowTitleBinding()
  assert.match(binding, /item\.titleText/, '缺主题名')
  assert.match(binding, /item\.recurrenceLabel/, '缺重复方式的中文')
})

test('topics 与 series 两条路径都要重算,晚到的一方不能把清单留在裸 id 上', () => {
  const js = read('pages/club/event-ops/index.js')
  const topicsBlock = /loadTopics\(\)\s*\{[\s\S]*?\n  \},/.exec(js)
  assert.ok(topicsBlock, 'loadTopics 找不到了')
  assert.match(topicsBlock[0], /decorateSeriesRows\(/, 'topics 晚到时没有回头重算清单')
  const seriesBlock = /loadSeries\(\)\s*\{[\s\S]*?\n  \},/.exec(js)
  assert.ok(seriesBlock, 'loadSeries 找不到了')
  assert.match(seriesBlock[0], /decorateSeriesRows\(/, 'series 成功时没有重算清单')
})

test('主题名还没到位时退回裸 id,不假装知道', () => {
  const js = read('pages/club/event-ops/index.js')
  const fn = /function decorateSeriesRow[\s\S]*?\n\}/.exec(js)
  assert.ok(fn, 'decorateSeriesRow 不见了')
  assert.match(fn[0], /topic && topic\.name/, '没有「找不到主题」的兜底')
})

test('负控:把行标题换回裸绑定,门禁必须变红', () => {
  const wxml = stripWxmlComments(read('pages/club/event-ops/index.wxml'))
  const mutated = wxml.replace(
    '<text class="row-title">{{item.titleText}} · {{item.recurrenceLabel}}</text>',
    '<text class="row-title">{{item.topicId}} · {{item.recurrenceType}}</text>')
  assert.notEqual(mutated, wxml, '变异没生效:锚点已漂移,这个负控在空转')

  const block = /wx:for="\{\{seriesRows\}\}"[\s\S]*?<\/view>\s*<\/view>/.exec(mutated)
  const binding = /<text class="row-title">([^<]*)<\/text>/.exec(block[0])[1]
  assert.equal(/\bitem\.topicId\b/.test(binding), true, '裸绑定没被判据认出来,它是橡皮图章')
})

// 截图验不了这个函数 —— 拍照时是 setData 直灌 seriesRows,绕过了它,
// 屏幕上只会显示一个孤零零的「·」。所以这里把函数抠出来真跑一遍。
function loadDecorator() {
  const src = read('pages/club/event-ops/index.js')
  const rec = /const RECURRENCES = \[[\s\S]*?\n\]/.exec(src)
  const fn = /function decorateSeriesRow[\s\S]*?\n\}/.exec(src)
  assert.ok(rec && fn, '抠不出 RECURRENCES / decorateSeriesRow,本合同的锚点要重挑')
  return new Function(`${rec[0]}\n${fn[0]}\nreturn decorateSeriesRow`)()
}

test('装饰函数真的把 id 和枚举换成了中文', () => {
  const decorate = loadDecorator()
  const topics = [{ id: 7, name: '外滩夜行 · 霓虹拾光' }]
  const row = decorate({ topicId: 7, recurrenceType: 'WEEKLY' }, topics)
  assert.equal(row.titleText, '外滩夜行 · 霓虹拾光')
  assert.equal(row.recurrenceLabel, '每周')
  for (const [type, label] of [['ONCE', '单次'], ['CUSTOM_DATES', '自定义日期']]) {
    assert.equal(decorate({ topicId: 7, recurrenceType: type }, topics).recurrenceLabel, label)
  }
})

test('topics 还没到位时退回裸 id,而不是显示空字符串', () => {
  const decorate = loadDecorator()
  // 这正是截图里那个孤零零「·」的成因:一旦兜底失效,行标题就整个空掉
  const row = decorate({ topicId: 7, recurrenceType: 'WEEKLY' }, [])
  assert.equal(row.titleText, '主题 #7', '没有兜底的话行标题会是空的')
  assert.ok(row.titleText.length > 0)
})

// ---- CU-C-146:日期清单里两条**同名**系列逐字一样,点哪条编辑全凭运气 ----
// 走查现场:主题 990028 与 990027 都叫「E2E 探店日一期」,两条重复方式都是「自定义日期」,
// 于是清单出现两行一模一样的「E2E 探店日一期 · 自定义日期」。行标题是 (主题名 · 重复方式),
// 单行装饰函数看不见隔壁,判不出撞名 —— 所以区分必须做在**整张清单**这一层。
function loadListDecorator() {
  const src = read('pages/club/event-ops/index.js')
  const rec = /const RECURRENCES = \[[\s\S]*?\n\]/.exec(src)
  const one = /function decorateSeriesRow[\s\S]*?\n\}/.exec(src)
  const many = /function decorateSeriesRows[\s\S]*?\n\}/.exec(src)
  assert.ok(rec && one && many, '抠不出 RECURRENCES / decorateSeriesRow(s),本合同的锚点要重挑')
  return new Function(`${rec[0]}\n${one[0]}\n${many[0]}\nreturn decorateSeriesRows`)()
}

const sameNameTopics = [
  { id: 990028, name: 'E2E 探店日一期' },
  { id: 990027, name: 'E2E 探店日一期' },
]

test('CU-C-146 同名同重复方式的两行,落地后必须读起来不一样', () => {
  const rows = [
    { id: 501, topicId: 990028, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
    { id: 502, topicId: 990027, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
  ]
  const labels = loadListDecorator()(rows, sameNameTopics).map(row => `${row.titleText} · ${row.recurrenceLabel}`)
  assert.equal(new Set(labels).size, 2, `两行同名系列还是撞在一起:${JSON.stringify(labels)}`)
  // 走查原文点名的就是这两个主题号 —— 撞名时补的必须是能对着后台认的识别信息
  assert.match(labels.join('\n'), /990028/)
  assert.match(labels.join('\n'), /990027/)
})

test('CU-C-146 不撞名的清单一个字都不许多(不能为了隔壁重名把每行都加长)', () => {
  const rows = [
    { id: 501, topicId: 7, recurrenceType: 'WEEKLY', futureDates: [] },
    { id: 502, topicId: 8, recurrenceType: 'ONCE', futureDates: [] },
  ]
  const topics = [{ id: 7, name: '外滩夜行' }, { id: 8, name: '老城寻猫' }]
  const decorated = loadListDecorator()(rows, topics)
  assert.deepEqual(decorated.map(row => `${row.titleText} · ${row.recurrenceLabel}`),
    ['外滩夜行 · 每周', '老城寻猫 · 单次'])
})

test('CU-C-146 三行里只两条撞名:只有那两条被加长,第三条保持原样', () => {
  const rows = [
    { id: 501, topicId: 990028, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
    { id: 502, topicId: 990027, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
    { id: 503, topicId: 7, recurrenceType: 'ONCE', futureDates: [] },
  ]
  const topics = sameNameTopics.concat([{ id: 7, name: '外滩夜行' }])
  const decorated = loadListDecorator()(rows, topics)
  assert.equal(decorated[2].titleText, '外滩夜行', '不撞名的行被连带加长了')
  assert.notEqual(decorated[0].titleText, decorated[1].titleText)
})

test('CU-C-146 识别信息从最轻的开始补:有首场日期就用日期,不用编号', () => {
  const rows = [
    { id: 501, topicId: 990028, recurrenceType: 'CUSTOM_DATES', futureDates: ['2026-09-22'] },
    { id: 502, topicId: 990027, recurrenceType: 'CUSTOM_DATES', futureDates: ['2026-10-05'] },
  ]
  const decorated = loadListDecorator()(rows, sameNameTopics)
  assert.match(decorated[0].titleText, /9月22日起/)
  assert.match(decorated[1].titleText, /10月5日起/)
  assert.ok(!/主题 #/.test(decorated[0].titleText), '日期就能区分,不该再堆内部编号')
})

test('CU-C-146 日期拿不到(list 侧 futureDates 恒为空,CU-C-04)才退到编号,不编一个假日期', () => {
  const rows = [
    { id: 501, topicId: 990028, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
    { id: 502, topicId: 990027, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
  ]
  const decorated = loadListDecorator()(rows, sameNameTopics)
  for (const row of decorated) {
    assert.ok(!/日起/.test(row.titleText), `清单侧没有日期数据,不能凭空写一个:${row.titleText}`)
  }
})

test('CU-C-146 重复调用幂等:topics 晚到再算一遍不会把上一次的后缀叠上去', () => {
  const decorateRows = loadListDecorator()
  const rows = [
    { id: 501, topicId: 990028, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
    { id: 502, topicId: 990027, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
  ]
  const once = decorateRows(rows, sameNameTopics)
  const twice = decorateRows(once, sameNameTopics)
  assert.deepEqual(twice.map(row => row.titleText), once.map(row => row.titleText),
    '后缀被叠了两层,清单会越刷越长')
  assert.equal(rows[0].titleText, undefined, '原对象被就地改了')
})

test('CU-C-146 两条调用点都必须走整表装饰:单行装饰看不见隔壁,撞名就判不出来', () => {
  const js = read('pages/club/event-ops/index.js')
  const topicsBlock = /loadTopics\(\)\s*\{[\s\S]*?\n  \},/.exec(js)
  const seriesBlock = /loadSeries\(\)\s*\{[\s\S]*?\n  \},/.exec(js)
  assert.ok(topicsBlock && seriesBlock, 'loadTopics / loadSeries 找不到了')
  assert.match(topicsBlock[0], /decorateSeriesRows\(/, 'topics 晚到时没有按整张清单重算')
  assert.match(seriesBlock[0], /decorateSeriesRows\(/, 'series 成功路径仍逐行装饰,同名两行判不出来')
})

test('CU-C-146 负控:把整表装饰换成逐行装饰,同名两行必须重新撞在一起', () => {
  const src = read('pages/club/event-ops/index.js')
  const mutated = src.replace(
    /function decorateSeriesRows\(rows, topics\) \{[\s\S]*?\n\}/,
    'function decorateSeriesRows(rows, topics) {\n  return (rows || []).map(row => decorateSeriesRow(row, topics))\n}')
  assert.notEqual(mutated, src, '变异没生效:decorateSeriesRows 的锚点已漂移,这个负控在空转')
  const rec = /const RECURRENCES = \[[\s\S]*?\n\]/.exec(mutated)
  const one = /function decorateSeriesRow[\s\S]*?\n\}/.exec(mutated)
  const many = /function decorateSeriesRows[\s\S]*?\n\}/.exec(mutated)
  const decorateRows = new Function(`${rec[0]}\n${one[0]}\n${many[0]}\nreturn decorateSeriesRows`)()
  const labels = decorateRows([
    { id: 501, topicId: 990028, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
    { id: 502, topicId: 990027, recurrenceType: 'CUSTOM_DATES', futureDates: [] },
  ], sameNameTopics).map(row => `${row.titleText} · ${row.recurrenceLabel}`)
  assert.equal(new Set(labels).size, 1,
    `变异后仍然区分了同名行 ⇒ 上面那几条正向断言没在量源码:${JSON.stringify(labels)}`)
})

test('装饰不改原对象,重复调用幂等', () => {
  const decorate = loadDecorator()
  const topics = [{ id: 7, name: '外滩夜行' }]
  const raw = { topicId: 7, recurrenceType: 'WEEKLY' }
  const once = decorate(raw, topics)
  const twice = decorate(once, topics)
  assert.equal(raw.titleText, undefined, '原对象被就地改了,重算会互相污染')
  assert.deepEqual(twice, once, '重复装饰结果不一致 —— topics 晚到时会二次装饰')
})

// ── CU-C-150(2026-09-25)──────────────────────────────────────────────
// 同一页又把三类实现参数端给了主理人:
//   · 日期清单行「版本 2 · 候补开启」—— 版本是乐观锁序号,不是主理人做的选择
//   · 编辑态「系列 #5 · 已锁定主题与负责人策略」—— 自增主键
//   · 「候补认领窗口（分钟，默认 1440 = 一天）」—— 把库字段单位与默认值当标签
//   · 名册成员卡「成员 #9001」(以及昵称缺失时兜底成同一个 #id)
// 走查给的口径:版本/系列 ID 留在诊断层,时间窗口用「1 天」这类自然单位,成员卡用姓名。

function loadOfferWindowText() {
  const src = read('pages/club/event-ops/index.js')
  const fn = /function offerWindowText\(minutes\) \{[\s\S]*?\n\}/.exec(src)
  assert.ok(fn, '抠不出 offerWindowText,本合同的锚点要重挑')
  return new Function(`${fn[0]}\nreturn offerWindowText`)()
}

test('候补认领时长按自然单位说人话（CU-C-150）', () => {
  const text = loadOfferWindowText()
  assert.equal(text(1440), '1 天')
  assert.equal(text(2880), '')
  assert.equal(text(60), '1 小时')
  assert.equal(text(90), '1 小时 30 分')
  assert.equal(text(45), '45 分钟')
  // 区间外的输入不回显:提交闸按原判据拦,这里不替它装作有效。
  assert.equal(text(0), '')
  assert.equal(text(4), '')
  assert.equal(text(1441), '')
  assert.equal(text(''), '')
  assert.equal(text('abc'), '')
})

test('实现参数与内部编号不再出现在活动运营页面上（CU-C-150）', () => {
  const wxml = stripWxmlComments(read('pages/club/event-ops/index.wxml'))
  assert.doesNotMatch(wxml, /版本 \{\{item\.version\}\}/, '日期清单行不该把乐观锁序号当状态给主理人')
  assert.doesNotMatch(wxml, /当前版本 \{\{expectedVersion\}\}/, '编辑态同理')
  assert.doesNotMatch(wxml, /系列 #\{\{editingSeriesId\}\}/, '自增主键不进文案')
  assert.doesNotMatch(wxml, /成员 #\{\{item\.memberId\}\}/, '成员卡用姓名,不用主键')
  assert.match(wxml, /wx:if="\{\{offerWindowText\}\}"/, '未形成合法时长时不显示空回显')
  assert.doesNotMatch(wxml, /默认 1440 = 一天/, '库字段单位与默认值不当标签')
  // 候补开关这个真信息要留着,别把修文案修成把状态也删了
  assert.match(wxml, /候补\{\{item\.waitlistEnabled \? '开启' : '关闭'\}\}/)
  // offerMinutes 仍是提交口径(自然单位只是回显,没改数据模型)
  assert.match(read('pages/club/event-ops/index.js'), /\n      offerMinutes,/,
    '提交载荷仍按分钟发 offerMinutes —— 自然单位只是回显,没改数据模型')
})

test('昵称缺失时兜底成可读称呼,不是主键（CU-C-150 负控）', () => {
  const src = read('pages/club/event-ops/index.js')
  assert.doesNotMatch(src, /row\.nickname\.trim\(\) : \('成员 #' \+ memberId\)/,
    '昵称兜底又变回「成员 #id」⇒ 上面那条页面断言会红')
  const fallbacks = src.match(/row\.nickname\.trim\(\) : '未命名成员'/g) || []
  assert.equal(fallbacks.length, 2, '名册行与带队人下拉两处兜底都要收口,漏一处就只有一个改对')
})
