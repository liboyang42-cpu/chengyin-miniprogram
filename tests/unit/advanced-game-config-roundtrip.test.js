/* 商家配置的整条链路:填 → 存 → 读回 → 喂预览(2026-09-10)
 *
 * 单独测 normalize / validate / buildPreviewKit 都会绿,但它们串起来照样能断:
 * 存的时候字段名对、读回来时段名不在册,内容就没了 —— 而且**不报错**。
 * 所以这份测的是整条链路,不是单点。
 *
 * 「填」这一步用编辑页真正会写的 setData 路径(advanced.<段>.<字段>),
 * 不是直接构造对象 —— 直接构造会绕过页面这一层,而那一层正是最容易写错路径的地方。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
const pv = require('../../pages/publish/utils/publish/advanced-game-preview.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 模拟编辑页的 setData 路径写入,支持 a.b.c 与 a.b[0]。 */
function setByPath(obj, pathStr, value) {
  const parts = pathStr.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
  cur[parts[parts.length - 1]] = value
  return obj
}

const DECIDE = ['coinFlip', 'diceRoll', 'reaction', 'ballShake', 'quietHold', 'countdown', 'stopwatch']

test('★七个玩法:填 → serialize → parse 回来,内容一个字都不能丢', () => {
  const m = cfg.defaultConfig()
  setByPath(m, 'coinFlip.enabled', true)
  setByPath(m, 'coinFlip.kicker', '抛一次,认结果')
  setByPath(m, 'coinFlip.heads.action', '这杯店家请')
  setByPath(m, 'coinFlip.tails.action', '这杯你请')
  setByPath(m, 'diceRoll.enabled', true)
  setByPath(m, 'diceRoll.diceCount', 2)
  for (let i = 0; i < 6; i++) setByPath(m, 'diceRoll.faces[' + i + ']', '第 ' + (i + 1) + ' 件事')
  setByPath(m, 'countdown.enabled', true)
  setByPath(m, 'countdown.doneText', '时间到。')

  const raw = cfg.serialize(m)
  const back = cfg.parse(raw)
  assert.equal(back.error, '', '存回去再读应当无错')
  assert.equal(back.value.coinFlip.heads.action, '这杯店家请')
  assert.equal(back.value.diceRoll.diceCount, 2)
  assert.equal(back.value.diceRoll.faces[5], '第 6 件事')
  assert.equal(back.value.countdown.doneText, '时间到。')
})

test('★读回来的配置能直接喂预览,且预览按商家填的跑', () => {
  const m = cfg.defaultConfig()
  setByPath(m, 'diceRoll.enabled', true)
  setByPath(m, 'diceRoll.kicker', '掷到几就做第几件事')
  for (let i = 0; i < 6; i++) setByPath(m, 'diceRoll.faces[' + i + ']', '事 ' + (i + 1))
  const back = cfg.parse(cfg.serialize(m)).value
  const kit = pv.buildPreviewKit(back)
  assert.equal(kit.kicker, '掷到几就做第几件事', '预览必须按商家真实配置跑')
  assert.equal(kit.faces[0], '事 1')
})

test('★编辑页里每个段都真有一块表单 —— 段在册但页面没写,商家照样配不了', () => {
  /* 2026-09-11 玩法模块改成单选之后,这七段不再各有一个开关:
     它们由「选择玩法」选中,面板条件是 gameSection === '<段名>'。
     判据因此换成「目录里有它 + 页面上有它那块面板」,坏掉的形态照样红。 */
  const wxml = read('pages/publish/temp/index.wxml')
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  for (const key of DECIDE) {
    assert.ok(catalog.GAME_SECTIONS.includes(key),
      key + ' 不在玩法目录里 —— 选择玩法那张单子上没有它,商家永远选不到')
    assert.ok(wxml.includes("gameSection === '" + key + "'"),
      key + ' 在配置里有段,但编辑页没有那块面板 —— 商家配不了,而且不报错')
  }
})

test('★表单里绑的字段必须真存在于默认配置 —— 拼错一个字就是永远存不上', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const d = cfg.defaultConfig()
  const bad = []
  const re = /data-section="([^"]+)"[^>]*data-field="([^"]+)"/g
  let m
  while ((m = re.exec(wxml))) {
    const seg = m[1].split('.').reduce((o, k) => (o == null ? o : o[k]), d)
    if (seg == null) { bad.push('段不存在: ' + m[1]); continue }
    if (!(m[2] in seg)) bad.push(m[1] + '.' + m[2] + ' 不在默认配置里')
  }
  assert.deepEqual(bad, [], '这些绑定写错了,填进去存不回来:\n  ' + bad.join('\n  '))
})

test('★负控:把一个字段名写错,上一条必须判红', () => {
  const d = cfg.defaultConfig()
  assert.equal('doneText' in d.countdown, true)
  assert.equal('doneTxt' in d.countdown, false, '拼错的名字确实不在默认配置里,所以上一条抓得到')
})

test('校验拦下来的东西,serialize 必须抛而不是静默存半份', () => {
  const m = cfg.defaultConfig()
  setByPath(m, 'countdown.enabled', true)
  setByPath(m, 'countdown.doneText', '')          // 到点没话说
  assert.throws(() => cfg.serialize(m), /不能为空/)
})

test('关掉的段不该把内容带进 kit —— 关了就是不玩了', () => {
  const m = cfg.defaultConfig()
  setByPath(m, 'diceRoll.enabled', false)
  setByPath(m, 'diceRoll.kicker', '写过又关掉了')
  assert.equal(pv.buildPreviewKit(m), null)
})

/* ===== 推理类三玩法(sort / match / classify,2026-09-16) ===== */

const INFERENCE = ['sort', 'match', 'classify']

test('★推理类:目录 section 必须是高级玩法段名,编辑页也必须真有那块面板', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  for (const key of INFERENCE) {
    const item = catalog.ALL.find((row) => row.key === key)
    assert.ok(item, key + ' 不在玩法目录里 —— 选择玩法那张单子上没有它,商家永远选不到')
    assert.equal(item.section, key, key + ' 的 section 和段名对不上,选了也配不上')
    assert.ok(catalog.GAME_SECTIONS.includes(key), key + ' 没被当成玩法段 —— 选它关不掉别的玩法')
    assert.ok(cfg.SECTIONS.includes(key), key + ' 没登记进高级玩法段 —— 填了也存不回来,而且不报错')
    assert.ok(wxml.includes("gameSection === '" + key + "'"),
      key + ' 在配置里有段,但编辑页没有那块面板 —— 商家配不了')
    // 会执行限时的玩法才给限时开关:三个都算
    assert.equal(catalog.supportsTimer(key), true, key + ' 不在 TIMED_GAMES 里 —— 会给商家一个不会执行的限时开关')
  }
})

test('★推理类:填 → serialize → parse 回来,answerOrder / pairs / answer 覆盖全部', () => {
  const m = cfg.defaultConfig()
  setByPath(m, 'sort.enabled', true)
  setByPath(m, 'sort.prompt', '把冲泡步骤排好')
  setByPath(m, 'sort.items', [{ id: 'srt_warm', label: '温杯' }, { id: 'srt_pour', label: '注水' }])
  setByPath(m, 'match.enabled', true)
  setByPath(m, 'match.prompt', '把工具和用途连起来')
  setByPath(m, 'match.left', [{ id: 'lft_pot', label: '手冲壶' }, { id: 'lft_paper', label: '滤纸' }])
  setByPath(m, 'match.right', [{ id: 'rgt_water', label: '装水' }, { id: 'rgt_filter', label: '过滤' }])
  setByPath(m, 'classify.enabled', true)
  setByPath(m, 'classify.prompt', '把东西分到对的类别')
  setByPath(m, 'classify.bins', [{ id: 'bin_tool', label: '器具' }, { id: 'bin_use', label: '耗材' }])
  setByPath(m, 'classify.items', [{ id: 'itm_dripper', label: '滤杯' }, { id: 'itm_bean', label: '咖啡豆' }])
  setByPath(m, 'classify.answer', { itm_dripper: 'bin_tool', itm_bean: 'bin_use' })

  const back = cfg.parse(cfg.serialize(m))
  assert.equal(back.error, '', '存回去再读应当无错')
  assert.deepEqual(back.value.sort.items.map((row) => row.id), ['srt_warm', 'srt_pour'])
  assert.deepEqual(back.value.sort.answerOrder, ['srt_warm', 'srt_pour'],
    'answerOrder 必须按录入顺序覆盖全部条目')
  assert.deepEqual(back.value.match.pairs, [['lft_pot', 'rgt_water'], ['lft_paper', 'rgt_filter']],
    'pairs 必须左右一一对应并覆盖全部')
  assert.deepEqual(back.value.classify.answer, { itm_dripper: 'bin_tool', itm_bean: 'bin_use' },
    'answer 必须覆盖全部条目')
})

test('★推理类:排序答案由录入顺序派生 —— 模型里可能过期的旧 answerOrder 不许带出去', () => {
  const m = cfg.defaultConfig()
  setByPath(m, 'sort.enabled', true)
  setByPath(m, 'sort.prompt', 'p')
  setByPath(m, 'sort.items', [{ id: 'first', label: 'A' }, { id: 'second', label: 'B' }])
  // 模拟读回来的旧配置带着一份对不上的 answerOrder
  setByPath(m, 'sort.answerOrder', ['stale_1', 'stale_2'])
  assert.deepEqual(JSON.parse(cfg.serialize(m)).sort.answerOrder, ['first', 'second'],
    '派生没生效 —— 玩家会拿到一份错的答案顺序,而且不报错')
})

test('★推理类:本地校验与后端同规 —— 空条目 / 超上限 / 没选类别都要拦', () => {
  const fillSort = (m) => {
    m.sort.enabled = true
    m.sort.prompt = 'p'
    m.sort.items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  }
  const fillMatch = (m) => {
    m.match.enabled = true
    m.match.prompt = 'p'
    m.match.left = [{ id: 'la', label: 'A' }, { id: 'lb', label: 'B' }]
    m.match.right = [{ id: 'ra', label: 'A' }, { id: 'rb', label: 'B' }]
  }
  const fillClassify = (m) => {
    m.classify.enabled = true
    m.classify.prompt = 'p'
    m.classify.bins = [{ id: 'ba', label: 'A' }, { id: 'bb', label: 'B' }]
    m.classify.items = [{ id: 'ia', label: 'A' }, { id: 'ib', label: 'B' }]
    m.classify.answer = { ia: 'ba', ib: 'bb' }
  }
  const cases = [
    [/排序条目的文案不能为空/, (m) => { fillSort(m); m.sort.items[1].label = '  ' }],
    [/排序的条目须为 2 至 8 条/, (m) => { fillSort(m); m.sort.items = Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, label: 'x' })) }],
    [/排序条目的 id/, (m) => { fillSort(m); m.sort.items[0].id = 'a.b' }],
    [/排序条目的 id 不能重复/, (m) => { fillSort(m); m.sort.items[1].id = 'a' }],
    [/排序条目的文案不能超过 40 字/, (m) => { fillSort(m); m.sort.items[0].label = '字'.repeat(41) }],
    [/排序的题干不能为空/, (m) => { fillSort(m); m.sort.prompt = '' }],
    [/排序的题干不能超过 200 字/, (m) => { fillSort(m); m.sort.prompt = '字'.repeat(201) }],
    [/连线的左右两列须各为 2 至 6 项/, (m) => { fillMatch(m); m.match.left = m.match.left.concat({ id: 'lc', label: 'C' }, { id: 'ld', label: 'D' }, { id: 'le', label: 'E' }, { id: 'lf', label: 'F' }, { id: 'lg', label: 'G' }) }],
    [/连线的左右两列数量必须一致/, (m) => { fillMatch(m); m.match.right = m.match.right.slice(0, 1) }],
    [/连线左列的文案不能为空/, (m) => { fillMatch(m); m.match.left[0].label = '' }],
    [/分类的类别须为 2 至 4 个/, (m) => { fillClassify(m); m.classify.bins = Array.from({ length: 5 }, (_, i) => ({ id: 'b' + i, label: 'x' })) }],
    [/分类的条目须为 2 至 10 条/, (m) => { fillClassify(m); m.classify.items = Array.from({ length: 11 }, (_, i) => ({ id: 'i' + i, label: 'x' })) }],
    [/分类的每一条都要选一个类别/, (m) => { fillClassify(m); delete m.classify.answer.ib }],
    [/分类的每一条都要选一个类别/, (m) => { fillClassify(m); m.classify.answer.ib = 'bin_gone' }],
  ]
  for (const [pattern, build] of cases) {
    const m = cfg.defaultConfig()
    build(m)
    assert.match(cfg.validate(m), pattern)
  }
  // 正例:三份都填对了必须放行
  const ok = cfg.defaultConfig()
  fillSort(ok); fillMatch(ok); fillClassify(ok)
  assert.equal(cfg.validate(ok), '')
})

test('★选一个玩法 = 其余玩法段全关掉(推理类三段同样适用)', () => {
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  const base = cfg.defaultConfig()
  base.estimate.enabled = true   // 先开着别的玩法,选新玩法时必须被关掉
  for (const key of INFERENCE) {
    const next = catalog.applyToConfig(base, key)
    assert.equal(next[key].enabled, true, key + ' 选中后没打开自己那段')
    for (const section of catalog.GAME_SECTIONS) {
      if (section === key) continue
      assert.equal(next[section].enabled, false,
        '选中 ' + key + ' 后 ' + section + ' 还开着 —— 一个节点会叠两个玩法')
    }
  }
})

test('★推理类面板的 data-path 必须指向默认配置里真有的列表', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const d = cfg.defaultConfig()
  const bad = []
  const re = /data-path="([^"]+)"/g
  let m
  while ((m = re.exec(wxml))) {
    const parts = m[1].split('.')
    // 只查推理类三段:全表扫会把别的段里那些运行时拼出来的 data-path 表达式当成字面量
    if (INFERENCE.indexOf(parts[0]) < 0) continue
    if (!Array.isArray(d[parts[0]] && d[parts[0]][parts[1]])) bad.push(m[1])
  }
  assert.deepEqual(bad, [], '这些 data-path 不在默认配置里,增删改写进不存在的数组也不报错:\n  ' + bad.join('\n  '))
})

test('★选项问答多选:multi 为真允许多个正确答案,关掉仍只许一个', () => {
  const base = () => {
    const m = cfg.defaultConfig()
    m.qa.enabled = true
    m.qa.mode = 'PICK'
    m.qa.title = 't'
    m.qa.options = [
      { id: 'a', label: 'A', fb: '', correct: true },
      { id: 'b', label: 'B', fb: '', correct: true },
    ]
    return m
  }
  assert.match(cfg.validate(base()), /只指定一个正确答案/, '多选没开时两个正确答案必须被拦')
  const multi = base()
  multi.qa.multi = true
  assert.equal(cfg.validate(multi), '', '多选开着时两个正确答案应当放行')
  const none = base()
  none.qa.multi = true
  none.qa.options = none.qa.options.map((o) => Object.assign({}, o, { correct: false }))
  assert.match(cfg.validate(none), /至少/, '多选也不能一个正确答案都没有')
})
