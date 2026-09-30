// T2 · 商家工作台三修的回归闸:
//   B1 假百分比不许回来(源码级)
//   B2 「今日项目」必须按真实日期判定(行为级)
//   B7 死页 pages/merchant/publish 不许复活(磁盘 + 引用双查)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const { pickTodayProject, localToday } = require('../../utils/merchant-workbench.js')

const TODAY = '2026-08-05'

// ---------- B2:今日项目 ----------

test('B2: 今天落在 [startDate, endDate] 内的那条才是今日项目', () => {
  const list = [
    { id: 1, startDate: '2026-09-01', endDate: '2026-09-03' }, // 未来 —— 旧实现会挑中它(列表第一条)
    { id: 2, startDate: '2026-08-04', endDate: '2026-08-06' }, // 跨天档期,今天在里面
  ]
  assert.equal(pickTodayProject(list, TODAY).id, 2)
})

test('B2: 单日项目(无 endDate)只在当天命中', () => {
  const list = [{ id: 7, startDate: TODAY }]
  assert.equal(pickTodayProject(list, TODAY).id, 7)
  assert.equal(pickTodayProject(list, '2026-08-06'), null)
})

test('B2: 今天没有项目就返回 null,不许退化成列表第一条', () => {
  const list = [
    { id: 1, startDate: '2026-08-01', endDate: '2026-08-02' }, // 已结束
    { id: 2, startDate: '2026-08-10', endDate: '2026-08-11' }, // 还没开始
  ]
  assert.equal(pickTodayProject(list, TODAY), null)
})

test('B2: 档期未知(无 startDate)不算今日 —— 宁可空态也不能编一条出来', () => {
  assert.equal(pickTodayProject([{ id: 1, startDate: null, endDate: null }], TODAY), null)
  assert.equal(pickTodayProject([{ id: 1 }], TODAY), null)
  assert.equal(pickTodayProject([], TODAY), null)
  assert.equal(pickTodayProject(null, TODAY), null)
})

test('B2: 同日多条取最早开始的那条', () => {
  const list = [
    { id: 1, startDate: '2026-08-05', endDate: '2026-08-05' },
    { id: 2, startDate: '2026-08-03', endDate: '2026-08-07' },
  ]
  assert.equal(pickTodayProject(list, TODAY).id, 2)
})

test('B2: 带时间戳后缀的日期照样按日历日比,不被时区推走', () => {
  const list = [{ id: 3, startDate: '2026-08-05 00:00:00', endDate: '2026-08-05 23:59:59' }]
  assert.equal(pickTodayProject(list, TODAY).id, 3)
})

test('B2: localToday 取设备本地日历日 —— 本地凌晨/深夜都不许跨天', () => {
  // 东八区跑时 00:30 本地 = 前一天 16:30Z,toISOString().slice(0,10) 会给出昨天;
  // 这里断言的是「按本地日历日」,在任何时区下都必须是同一个答案。
  assert.equal(localToday(new Date(2026, 7, 5, 0, 30, 0)), '2026-08-05')
  assert.equal(localToday(new Date(2026, 7, 5, 23, 30, 0)), '2026-08-05')
  // 月/日补零:9 月 9 日不能出 '2026-9-9'
  assert.equal(localToday(new Date(2026, 8, 9, 12, 0, 0)), '2026-09-09')
})

test('B2: endDate 早于 startDate 的脏数据退化成单日,不让项目静默消失', () => {
  const list = [{ id: 9, startDate: TODAY, endDate: '2026-07-01' }]
  assert.equal(pickTodayProject(list, TODAY).id, 9)
})

test('B2: 页面不许退回「列表第一条」', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/merchant/index/index.js'), 'utf8')
  assert.doesNotMatch(src, /todayProject:\s*formatted\[0\]/, '不许退回「列表第一条」')
  // 今日项目必须从全量 list 挑 —— 从 slice(0,10) 里挑会让第 11 条之后的今日场次凭空消失
  assert.doesNotMatch(src, /pickTodayProject\(\s*formatted\s*\)/, '不能从截断后的列表里挑今日项目')
})

test('B2: 空态文案报的是真实总数,不是被截到 10 条的 joinList', () => {
  const js = fs.readFileSync(path.join(ROOT, 'pages/merchant/index/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/index/index.wxml'), 'utf8')
  // 2026-09-16:总数仍然取全量 list,但只数未结束的(已结束不上工作台,也不占「全部 N」)。
  // 2026-09-21:总数拆成「旧承接 + 只在章节里的项目」两段累加,所以不再是一条 joinTotal: 表达式。
  //   钉的东西没变 —— 分母仍必须是全量 list 筛未结束,不许换成 slice(0,10) 之后的列表。
  assert.match(js, /const activeRows = list\.filter\(\(item\) => !isEndedProject\(item\.startDate, item\.endDate, today\)\)/,
    '未结束项目必须从全量 list 上筛')
  assert.match(js, /_legacyJoinTotal = activeRows\.length/,
    '旧承接那段总数必须取全量 activeRows 的长度')
  assert.match(js, /joinTotal:\s*\(this\._legacyJoinTotal \|\| 0\) \+ chapterOnly/,
    'joinTotal 必须是旧承接总数 + 只在章节里的项目数')
  assert.doesNotMatch(js, /_legacyJoinTotal\s*=\s*(formatted|that\.data\.projectList|list\.slice)/,
    '不许拿铺出去的截断列表当总数')
  assert.match(wxml, /\{\{joinTotal \+ hostProjectTotal\}\}/, '项目总数必须用 joinTotal/hostProjectTotal')
  assert.doesNotMatch(wxml, /joinList\.length/, '不许拿被截断的 joinList 报数')
  assert.doesNotMatch(wxml, /projectCards\.length\}\} ›/, '不许拿只铺了几条的卡片列表报总数')
})

// ---------- B1:假百分比 ----------

test('B1: 工作台不许再出现按状态编造的售出/购买百分比', () => {
  const js = fs.readFileSync(path.join(ROOT, 'pages/merchant/index/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/index/index.wxml'), 'utf8')
  // 只查赋值/引用形态,注释里那句「曾经这么干过」的说明不算命中
  assert.doesNotMatch(js, /boughtPct\s*[:=]/, 'boughtPct 不许再被计算或写进 data')
  assert.doesNotMatch(js, /soldPct\s*[:=]/, 'soldPct 不许再被计算或写进 data')
  assert.doesNotMatch(wxml, /boughtPct|soldPct/, 'wxml 不许渲染这两个假百分比')
})

// ---------- B7:死页 ----------

test('B7: pages/merchant/publish 已整目录删除', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'pages/merchant/publish')), false)
})

test('B7: 全仓不许再引用 pages/merchant/publish', () => {
  const SKIP = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist'])
  const SELF = path.join(ROOT, 'tests/unit/merchant-workbench-today-project.test.js')
  const hits = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(js|json|wxml|wxss|wxs)$/.test(entry.name)) continue
      if (full === SELF) continue
      if (fs.readFileSync(full, 'utf8').includes('merchant/publish')) hits.push(path.relative(ROOT, full))
    }
  }
  walk(ROOT)
  assert.deepEqual(hits, [], `死页仍被引用:${hits.join(', ')}`)
})
