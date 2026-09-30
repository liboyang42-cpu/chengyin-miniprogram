/* 跨日慢任务 slowTask 的商家配置面(2026-09-19)
 *
 * 断链的形状:玩家侧(playkit-slowtask 组件、playkit-view 的 KIT_PRIORITY 与
 * START_SLOW_TASK / CLAIM_SLOW_TASK)、服务端(AdvancedGameConfigValidator 的段名单、
 * AdvancedGamePublicProjection、AdvancedGameRuntimeServiceImpl 全套)全线已通,
 * 唯独配置面没有这一段 —— 商家在小程序发布器里看不到、配不了、存不了。
 *
 * 这种断链**不报错**:段名不在 SECTIONS 里时 parse 走「未知段透传」把内容留着,
 * 页面却画不出那块表单,advanced-game-config 也不清洗、不校验它。
 * 所以这里钉的三件事依次是:段在册 → 字段形状与服务端一致 → 页面上真有一块表单。
 *
 * 形制与同类「叠加型」段(timeWindow / blindTaste / dailySign)完全同款:
 * 一个开关 + 一组字段,不进「一个节点只选一个玩法」的目录(见最后一条)。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8')
// 注释里写「这一段的字段是……」是在讲历史,不算数;只看真代码。
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const VALIDATOR = '../chengyinhub-system/src/main/java/com/chengyinhub/business/service/'
  + 'support/AdvancedGameConfigValidator.java'

/** 服务端 validateAndNormalize 逐段调用的段名 —— 那份名单才是「这一段存不存得回来」的真源。 */
function serverSections() {
  const code = strip(read(VALIDATOR))
  const found = new Set()
  let m
  const re = /validate\w+\(\s*root\.get\("(\w+)"\)\s*\)/g
  while ((m = re.exec(code))) found.add(m[1])
  return found
}

/** validateSlowTask 读的是哪几个字段 —— 配置段的形状必须与它一一对上,
 *  否则商家填了服务端不认(或被原样存回却没人读),等于填了个寂寞。 */
function serverSlowTaskFields() {
  const code = strip(read(VALIDATOR))
  const body = (code.match(/private void validateSlowTask\(JsonNode slowTask\)[\s\S]*?\n    \}/) || [''])[0]
  assert.ok(body, '没在后端 Validator 里认出 validateSlowTask,这条断言就是恒真的')
  const fields = new Set(['enabled'])
  let m
  const reText = /(?:requiredText|optionalText|optionalMediaUrl)\(\s*slowTask\s*,\s*"(\w+)"/g
  while ((m = reText.exec(body))) fields.add(m[1])
  const rePath = /slowTask\.path\("(\w+)"\)/g
  while ((m = rePath.exec(body))) fields.add(m[1])
  if (/validateXp\(/.test(body)) fields.add('xp')
  return fields
}

// 服务端已有、发布器还没接配置表单的段(2026-09-20 合批时点的名册):
// R3 三款(sort/match/classify)+ R16 时间轴对照(compare)+ R16-DUO 双人视角(roleViews)。
// parse 的「未知段透传」保证这些段读进来原样留、存回去原样带 —— 不丢商家数据,
// 只是本页配不了。接线是独立工单,不随本批落码;名单外再冒出第六个新段,下面仍会判红。
const NOT_YET_WIRED_SERVER_SECTIONS = ['sort', 'match', 'classify', 'compare', 'roleViews']

test('★后端 Validator 的段名单与本地 SECTIONS 一一对上 —— 少一段,那玩法在本页读不出来也存不回去,而且不报错', () => {
  const server = serverSections()
  assert.ok(server.size > 20, '后端一个段都没认出来,这条断言就是恒真的')
  assert.deepEqual([...server].filter(k => cfg.SECTIONS.indexOf(k) < 0 && !NOT_YET_WIRED_SERVER_SECTIONS.includes(k)), [],
    '服务端有、本地名单没有,且不在「未接线名册」里:这一段商家配不了也存不了')
  assert.deepEqual(cfg.SECTIONS.filter(k => !server.has(k)), [],
    '本地名单有、服务端没有:填了会被服务端整段忽略')
  assert.ok(cfg.KIT_SECTIONS.includes('slowTask'),
    'slowTask 是叠加型段,应与 timeWindow / dailySign 同组在册')
})

test('slowTask 段在册:默认配置带得出来,默认是关的', () => {
  const seg = cfg.defaultConfig().slowTask
  assert.ok(seg, '没有默认段 —— 输入框没有可绑定的初值')
  assert.equal(seg.enabled, false, '默认必须关着,不能凭空给每个节点开一个玩法')
  assert.ok(cfg.SECTIONS.includes('slowTask'))
})

test('★slowTask 的字段形状与后端 validateSlowTask 一一对上 —— 多一个字段没人读,少一个字段配不上', () => {
  assert.deepEqual(Object.keys(cfg.defaultConfig().slowTask).sort(),
    [...serverSlowTaskFields()].sort())
})

test('★商家填进去的内容:存 → 读回 → 再存,一个字不丢', () => {
  const filled = {
    enabled: true, title: '这家店的三年,分三天读', startLabel: '就这么定了',
    waitHint: '明天这个时候,这里会多出一点东西。', unlockLabel: '看看留下了什么',
    unlockText: '第二年:门口那棵树是老板爷爷种的。', waitDays: 3, xp: 20,
  }
  const raw = JSON.stringify({ schemaVersion: 1, slowTask: filled })
  const read1 = cfg.parse(raw)
  assert.equal(read1.error, '', '既有配置必须无错读出')
  for (const [field, value] of Object.entries(filled)) {
    assert.deepEqual(read1.value.slowTask[field], value, `slowTask.${field} 读进来就被改形了`)
  }
  const written = cfg.serialize(read1.value)
  assert.notEqual(written, '', '只配了跨日任务也是配了 —— 不能被当成空配置清空')
  assert.deepEqual(JSON.parse(written).slowTask, filled, '存回去掉字段了')
  // 存出去的必须还能读回来(整条链路:货架 → 编辑页 → 再存一次)
  assert.deepEqual(cfg.parse(written).value.slowTask, filled)
})

test('只开 slowTask 一段时,enabledSections 要数到它 —— 数不到就会被清成空配置', () => {
  const m = cfg.defaultConfig()
  m.slowTask.enabled = true
  assert.ok(cfg.enabledSections(m).includes('slowTask'))
  m.slowTask.title = '慢慢来'
  m.slowTask.unlockText = '第三天:后巷的灯修好了。'
  assert.notEqual(cfg.serialize(m), '')
})

test('★编辑页里真有一块 slowTask 表单 —— 段在册但页面没写,商家照样配不了', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  assert.ok(wxml.includes('advanced.slowTask.enabled'),
    '编辑页没有跨日任务的开关 —— 商家打不开这一段')
  assert.ok(wxml.includes('data-key="slowTask"'), '开关没接到 onAdvancedToggle 的 data-key 上')
  const bound = boundSlowTaskFields(wxml)
  const want = [...serverSlowTaskFields()].filter(f => f !== 'enabled')
  assert.deepEqual(want.filter(f => !bound.includes(f)), [],
    '这些后端认得的字段在编辑页里没有输入框')
})

/** 页面上 `data-section="slowTask" data-field="x"` 的绑定(与 onAdvancedField 的形状一致)。 */
function boundSlowTaskFields(wxml) {
  const out = []
  const re = /data-section="slowTask"[^>]*data-field="([^"]+)"/g
  let m
  while ((m = re.exec(wxml))) out.push(m[1])
  return out
}

test('★负控:字段名写错一个字母,上面的绑定断言真的抓得到', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  assert.ok(boundSlowTaskFields(wxml).includes('unlockText'))
  assert.ok(!boundSlowTaskFields(wxml).includes('unlockTxt'),
    '负控失效:拼错的名字也被认成已绑定,那条断言是恒真的')
})

test('存盘前清洗:没填的选填字段删键,数字字段商家删空时不能把空串存回去', () => {
  const m = cfg.defaultConfig()
  m.slowTask = {
    enabled: true, title: '慢慢来', startLabel: '', waitHint: '  ', unlockLabel: '',
    unlockText: '明天再看', waitDays: 2, xp: '',
  }
  const out = JSON.parse(cfg.serialize(m)).slowTask
  assert.ok(!('startLabel' in out), '空的按钮文案必须删键,不能留空串')
  assert.ok(!('waitHint' in out), '空的等待提示必须删键')
  assert.ok(!('unlockLabel' in out), '空的解锁文案必须删键')
  assert.equal(out.xp, 0, '奖励分留空就是不加分')

  // 输入框删空拿到的是 ''。不能拿它去存,也不能顺手替商家编一个天数 ——
  // 服务端 asInt(1) 那句默认值只在字段**缺失**时生效,存个 0 过去两边同样判错,
  // 而本页那句报错比发布时蹦出来的服务端报错读得懂。
  const cleared = cfg.normalize(cfg.defaultConfig())
  cleared.slowTask = { enabled: true, title: '慢慢来', unlockText: '明天再看', waitDays: '', xp: '' }
  assert.equal(typeof cfg.normalize(cleared).slowTask.waitDays, 'number')
  assert.match(cfg.validate(cleared), /跨日任务的等待天数须为 1 至 7 天/)
})

test('校验文案与后端逐条对齐 —— 商家在本页就看懂错在哪,而不是发布时吃一句服务端报错', () => {
  const ok = { enabled: true, title: '慢慢来', unlockText: '明天再看', waitDays: 2, xp: 10 }
  const cases = [
    [{ title: '' }, /跨日任务标题不能为空/],
    [{ title: '一'.repeat(65) }, /跨日任务标题不能超过 64 字/],
    [{ startLabel: '一'.repeat(25) }, /开始按钮文案不能超过 24 字/],
    [{ waitHint: '一'.repeat(61) }, /等待期提示不能超过 60 字/],
    [{ unlockLabel: '一'.repeat(25) }, /解锁按钮文案不能超过 24 字/],
    [{ unlockText: '' }, /跨日任务解锁内容不能为空/],
    [{ unlockText: '一'.repeat(201) }, /解锁后揭示的内容不能超过 200 字/],
    // ★ 超过一周的等待不是低压是遗忘 —— 后端把上限钉在 7,本地必须同样拦住
    [{ waitDays: 0 }, /跨日任务的等待天数须为 1 至 7 天/],
    [{ waitDays: 8 }, /跨日任务的等待天数须为 1 至 7 天/],
    [{ xp: 1001 }, /跨日任务奖励分须为 0 至 1000/],
  ]
  for (const [patch, pattern] of cases) {
    const m = cfg.defaultConfig()
    m.slowTask = Object.assign({}, ok, patch)
    assert.match(cfg.validate(m), pattern, `${JSON.stringify(patch)} 这条约束没在本页拦住`)
  }
  const clean = cfg.defaultConfig()
  clean.slowTask = Object.assign({}, ok)
  assert.equal(cfg.validate(clean), '', '都填对了就该放行')
})

test('关掉的段不清洗、不校验,下次打开还能看见自己填了一半的内容', () => {
  const m = cfg.defaultConfig()
  m.slowTask.enabled = false
  m.slowTask.title = '还没想好的标题'
  m.timer.enabled = true
  const out = JSON.parse(cfg.serialize(m)).slowTask
  assert.equal(out.title, '还没想好的标题')
})

test('★它是叠加段,不进「一个节点只选一个玩法」的目录 —— 进了目录,选中任何主玩法都会顺手把它关掉', () => {
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  assert.ok(!catalog.GAME_SECTIONS.includes('slowTask'),
    'slowTask 被当成单选主玩法:选别的玩法会静默关掉它,而玩家侧它排在 KIT_PRIORITY 的叠加带')
  assert.ok(catalog.GAME_SECTIONS.length > 0)
})
