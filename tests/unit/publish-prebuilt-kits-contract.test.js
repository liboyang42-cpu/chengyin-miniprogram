/* 《预制人生》创作端 §2 字段合同(施工契约 2026-09-17,Worker C)
 *
 * 契约 §2 的四个新 kit(profile / photoCheck / note / typeIn)+ R14 检定(check,
 * 契约 §2.3 更正:不新造段,接的是 master 上既有的形状)。
 *
 * 为什么把契约形状抄死在测试里:后端 validator 是按同一份契约写的,字段名对不上
 * 会被直接拒掉,而且要到发布那一步才拒。字段名与取值范围必须有第二处独立记录 ——
 * 只写在契约文档里,改名这件事就只有一个见证人。
 *
 * ⚠️ 形态:段名 / 字段名 / 取值范围都写死;新增字段先改契约再改这里,别反过来。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/* ===== 契约 §2 形状(逐字抄) ===== */
const CONTRACT = {
  profile: {
    keys: ['avatar', 'enabled', 'lead', 'questions', 'title', 'xp'],
    avatarKeys: ['enabled', 'required'],
    questionKeys: ['key', 'kind', 'label', 'maxLength', 'required'],
    pickQuestionKeys: ['key', 'kind', 'label', 'options', 'required'],
    optionKeys: ['effects', 'key', 'label'],
    effectKeys: ['op', 'value', 'var'],
  },
  photoCheck: {
    /* frameUrl / frameOpacity:2026-09-22《现场感三件套》S1 取景轮廓(选填)。
       ⚠️ 它们是**编辑器模型**的默认值,不是存库形状 —— 商家没配时 normalize 会把两个键整键删掉
       (钉在 playkit-photocheck-frame-contract 那条「配置里不出现空 frameUrl」)。 */
    keys: ['cardStyle', 'cardTitle', 'enabled', 'fallback', 'frameOpacity', 'frameUrl',
      'maxTries', 'minConfidence', 'mode', 'requirement', 'shotNote', 'title', 'xp'],
    /* 2026-09-22 起这一段多了「拍物成卡」的三个字段(立体藏品卡契约 §2.1,与拍照审核共用本段),
       它们从默认配置长出来,所以必须在册。 */
  },
  note: { keys: ['enabled', 'maxLength', 'presets', 'prompt', 'showPrevious', 'title', 'xp'] },
  typeIn: { keys: ['caseSensitive', 'enabled', 'seconds', 'target', 'title', 'tries', 'xp'] },
  // R14:编辑器暴露的七项 + checkId 这个稳定标识。
  // mods 自 2026-09-22(阶段 5)起进默认形状 —— 它现在有编辑器界面了;
  // critEffects / advantageIf / failCostTag 等仍不在默认形状里,只做「读进来存回去一字不差」。
  check: {
    keys: ['checkId', 'enabled', 'failEffects', 'failText', 'mods', 'skill',
      'successEffects', 'successText', 'tier'],
  },
}

/** 模拟编辑页的 setData 路径写入(advanced.<段>.<字段>)。 */
function setByPath(obj, pathStr, value) {
  const parts = pathStr.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
  cur[parts[parts.length - 1]] = value
  return obj
}

/** 把一份模型跑完整条链路:清洗 → 存盘 → 读回。返回 { raw, value }。 */
function roundtrip(model) {
  const raw = cfg.serialize(model)
  const back = cfg.parse(raw)
  assert.equal(back.error, '', '存回去再读应当无错:' + back.error)
  return { raw, value: back.value }
}

/** 编辑器里真会填出来的那份配置(用 setData 路径写,不是直接构造对象)。 */
function editorFilledConfig() {
  const m = cfg.defaultConfig()
  setByPath(m, 'profile.enabled', true)
  setByPath(m, 'profile.title', '出生登记')
  setByPath(m, 'profile.lead', '填完这张表，你就有了身份')
  setByPath(m, 'profile.avatar.enabled', true)
  setByPath(m, 'profile.avatar.required', false)
  setByPath(m, 'profile.questions', [
    { key: 'name', label: '你叫什么', kind: 'text', maxLength: 12, required: true },
    { key: 'job', label: '你做什么工作', kind: 'pick', options: [
      { key: 'clerk', label: '店员', effects: [{ var: 'counter.energy', op: 'INC', value: 1 }] },
      { key: 'rider', label: '骑手', effects: [{ var: 'sys.luck', op: 'INC', value: 2 }] },
    ] },
  ])
  setByPath(m, 'profile.xp', 3)
  setByPath(m, 'photoCheck.enabled', true)
  setByPath(m, 'photoCheck.title', '拍一张窗外')
  setByPath(m, 'photoCheck.shotNote', '把窗框也拍进去')
  setByPath(m, 'photoCheck.requirement', '画面里要能看见窗外的街景，窗框入镜')
  setByPath(m, 'photoCheck.minConfidence', 60)
  setByPath(m, 'photoCheck.maxTries', 3)
  setByPath(m, 'photoCheck.fallback', 'pass')
  setByPath(m, 'check.enabled', true)
  setByPath(m, 'check.checkId', 'lookout')
  setByPath(m, 'check.tier', 'hard')
  setByPath(m, 'check.skill', '观察')
  setByPath(m, 'check.successText', '你看清了')
  setByPath(m, 'check.failText', '你错过了')
  setByPath(m, 'check.successEffects', [{ var: 'counter.thought', op: 'INC', value: 2 }])
  setByPath(m, 'check.failEffects', [{ var: 'counter.energy', op: 'INC', value: -1 }])
  setByPath(m, 'note.enabled', true)
  setByPath(m, 'note.title', '写一句留给下一个人')
  setByPath(m, 'note.prompt', '你看到窗外什么')
  setByPath(m, 'note.maxLength', 40)
  setByPath(m, 'note.presets', ['天是灰的', '有人在等红灯'])
  setByPath(m, 'note.showPrevious', 3)
  setByPath(m, 'typeIn.enabled', true)
  setByPath(m, 'typeIn.title', '打出这行字')
  setByPath(m, 'typeIn.target', 'hello world')
  setByPath(m, 'typeIn.seconds', 10)
  setByPath(m, 'typeIn.caseSensitive', false)
  setByPath(m, 'typeIn.tries', 0)
  return m
}

test('★编辑器填出来的五个段,存进去读回来字段名与值一个字不差', () => {
  const { raw, value } = roundtrip(editorFilledConfig())
  assert.deepEqual(value.profile, {
    enabled: true, title: '出生登记', lead: '填完这张表，你就有了身份',
    avatar: { enabled: true, required: false },
    questions: [
      { key: 'name', label: '你叫什么', kind: 'text', required: true, maxLength: 12 },
      { key: 'job', label: '你做什么工作', kind: 'pick', required: false, options: [
        { key: 'clerk', label: '店员', effects: [{ var: 'counter.energy', op: 'INC', value: 1 }] },
        { key: 'rider', label: '骑手', effects: [{ var: 'sys.luck', op: 'INC', value: 2 }] },
      ] },
    ],
    xp: 3,
  })
  assert.deepEqual(value.photoCheck, {
    enabled: true, title: '拍一张窗外', shotNote: '把窗框也拍进去',
    requirement: '画面里要能看见窗外的街景，窗框入镜', minConfidence: 60,
    maxTries: 3, fallback: 'pass', xp: 0,
    // 商家没碰取景轮廓:模型里是默认空值,而 raw 里这两个键必须整个不存在(见下一条)
    frameUrl: '', frameOpacity: 40,
    // 读回来时这几项由默认配置补齐:编辑器没填 = 普通拍照审核
    mode: '', cardTitle: '', cardStyle: 'foil',
  })
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(raw).photoCheck, 'frameUrl'), false,
    '没配取景轮廓却把空 frameUrl 存进库 = 服务端 validator 直接拒「https 链接或站内路径」')
  assert.equal(value.check.checkId, 'lookout')
  assert.equal(value.check.tier, 'hard')
  assert.equal(value.check.skill, '观察')
  assert.equal(value.check.successText, '你看清了')
  assert.equal(value.check.failText, '你错过了')
  assert.deepEqual(value.check.successEffects, [{ var: 'counter.thought', op: 'INC', value: 2 }])
  assert.deepEqual(value.check.failEffects, [{ var: 'counter.energy', op: 'INC', value: -1 }])
  assert.deepEqual(value.note, {
    enabled: true, title: '写一句留给下一个人', prompt: '你看到窗外什么',
    maxLength: 40, presets: ['天是灰的', '有人在等红灯'], showPrevious: 3, xp: 0,
  })
  assert.deepEqual(value.typeIn, {
    enabled: true, title: '打出这行字', target: 'hello world',
    seconds: 10, caseSensitive: false, tries: 0, xp: 0,
  })
})

test('★契约 §2 字段名逐字对上(段/子对象/效果条目三层都要对)', () => {
  const m = editorFilledConfig()
  const { value } = roundtrip(m)
  assert.deepEqual(Object.keys(value.profile).sort(), CONTRACT.profile.keys, 'profile 顶层字段')
  assert.deepEqual(Object.keys(value.profile.avatar).sort(), CONTRACT.profile.avatarKeys, 'profile.avatar 字段')
  assert.deepEqual(Object.keys(value.profile.questions[0]).sort(), CONTRACT.profile.questionKeys, 'text 问题字段')
  assert.deepEqual(Object.keys(value.profile.questions[1]).sort(), CONTRACT.profile.pickQuestionKeys, 'pick 问题字段')
  assert.deepEqual(Object.keys(value.profile.questions[1].options[0]).sort(), CONTRACT.profile.optionKeys, '选项字段')
  assert.deepEqual(Object.keys(value.profile.questions[1].options[0].effects[0]).sort(),
    CONTRACT.profile.effectKeys, '加成条目字段')
  assert.deepEqual(Object.keys(value.photoCheck).sort(), CONTRACT.photoCheck.keys, 'photoCheck 顶层字段')
  assert.deepEqual(Object.keys(value.note).sort(), CONTRACT.note.keys, 'note 顶层字段')
  assert.deepEqual(Object.keys(value.typeIn).sort(), CONTRACT.typeIn.keys, 'typeIn 顶层字段')
  assert.deepEqual(Object.keys(value.check).sort(), CONTRACT.check.keys, 'check 顶层字段(编辑器暴露的六项 + checkId)')
})

test('★负控:把契约里的字段名改掉一个字,上一条就必须判红', () => {
  const broken = cfg.defaultConfig()
  broken.photoCheck.enabled = true
  broken.photoCheck.requirement = '画面里要能看见窗外的街景'
  broken.photoCheck.maxTries = 3
  const raw = JSON.parse(cfg.serialize(broken))
  raw.photoCheck.maxTrials = raw.photoCheck.maxTries
  delete raw.photoCheck.maxTries
  assert.throws(
    () => assert.deepEqual(Object.keys(raw.photoCheck).sort(), CONTRACT.photoCheck.keys),
    /Expected values to be strictly deep-equal|deepStrictEqual/,
    '把 maxTries 写成 maxTrials 还顺利通过 = 合同断言是假的',
  )
})

/* ===== 取值范围:契约写死的边界。每一条 case 本身就是一次负控 ===== */
function rejectMessage(mutate) {
  const m = cfg.defaultConfig()
  mutate(m)
  try { cfg.serialize(m); return '' } catch (error) { return String(error.message || error) }
}

const textQuestion = (key) => ({ key, label: '问 ' + key, kind: 'text', maxLength: 12, required: false })
const pickQuestion = (options) => ({ key: 'job', label: '你做什么', kind: 'pick', options })

test('★契约 §2 取值范围:越界一律拒,合法的放行', () => {
  const cases = [
    ['建档 0 个问题', (m) => { m.profile.enabled = true; m.profile.questions = [] }, /1 至 8/],
    ['建档 9 个问题', (m) => {
      m.profile.enabled = true
      m.profile.questions = Array.from({ length: 9 }, (_, i) => textQuestion('q' + i))
    }, /1 至 8/],
    ['建档变量名以数字开头', (m) => {
      m.profile.enabled = true
      m.profile.questions = [textQuestion('1name')]
    }, /变量名/],
    ['建档变量名重复', (m) => {
      m.profile.enabled = true
      m.profile.questions = [textQuestion('name'), textQuestion('name')]
    }, /不能重复/],
    ['pick 只有 1 个选项', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([{ key: 'a', label: 'A' }])]
    }, /2 至 6/],
    ['pick 有 7 个选项', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion(Array.from({ length: 7 }, (_, i) => ({ key: 'o' + i, label: '选' + i })))]
    }, /2 至 6/],
    ['选项存值为空', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([{ key: '', label: 'A' }, { key: 'b', label: 'B' }])]
    }, /存值/],
    ['加成变量裸写 energy(契约 §2.1:必须带前缀)', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([
        { key: 'a', label: 'A', effects: [{ var: 'energy', op: 'INC', value: 1 }] },
        { key: 'b', label: 'B' },
      ])]
    }, /counter\./],
    ['加成变量 sys.luck 用了 SET', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([
        { key: 'a', label: 'A', effects: [{ var: 'sys.luck', op: 'SET', value: 1 }] },
        { key: 'b', label: 'B' },
      ])]
    }, /sys\.luck/],
    ['加成变量 sys.luck 加到 4', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([
        { key: 'a', label: 'A', effects: [{ var: 'sys.luck', op: 'INC', value: 4 }] },
        { key: 'b', label: 'B' },
      ])]
    }, /sys\.luck/],
    ['加成 value 超上限 100', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([
        { key: 'a', label: 'A', effects: [{ var: 'counter.energy', op: 'INC', value: 100 }] },
        { key: 'b', label: 'B' },
      ])]
    }, /-99 至 99/],
    ['加成 op 不在册', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([
        { key: 'a', label: 'A', effects: [{ var: 'counter.energy', op: 'MULTIPLY', value: 1 }] },
        { key: 'b', label: 'B' },
      ])]
    }, /SET、INC 或 ADD_TAG/],
    ['加成 17 条超上限', (m) => {
      m.profile.enabled = true
      m.profile.questions = [pickQuestion([
        { key: 'a', label: 'A', effects: Array.from({ length: 17 }, () => ({ var: 'counter.energy', op: 'INC', value: 1 })) },
        { key: 'b', label: 'B' },
      ])]
    }, /最多配置 16 条/],
    ['拍照审核 requirement 空(契约必填)', (m) => {
      m.photoCheck.enabled = true
    }, /1 至 60/],
    ['拍照审核 requirement 61 字', (m) => {
      m.photoCheck.enabled = true
      m.photoCheck.requirement = 'x'.repeat(61)
    }, /1 至 60/],
    ['拍照审核 minConfidence -1', (m) => {
      m.photoCheck.enabled = true
      m.photoCheck.requirement = '画面里要能看见窗外的街景，窗框入镜'
      m.photoCheck.minConfidence = -1
    }, /0 至 100/],
    ['拍照审核 minConfidence 101', (m) => {
      m.photoCheck.enabled = true
      m.photoCheck.requirement = '画面里要能看见窗外的街景，窗框入镜'
      m.photoCheck.minConfidence = 101
    }, /0 至 100/],
    ['拍照审核 maxTries 0(契约 1 至 10)', (m) => {
      m.photoCheck.enabled = true
      m.photoCheck.requirement = '画面里要能看见窗外的街景，窗框入镜'
      m.photoCheck.maxTries = 0
    }, /1 至 10/],
    ['拍照审核 fallback manual(本轮不做)', (m) => {
      m.photoCheck.enabled = true
      m.photoCheck.requirement = '画面里要能看见窗外的街景，窗框入镜'
      m.photoCheck.fallback = 'manual'
    }, /兜底/],
    ['留言 7 条预设', (m) => {
      m.note.enabled = true
      m.note.title = '留一句'          // 9-24 起标题 / 提示前端也必填(与服务端同序先校),补上才测得到预设上限
      m.note.prompt = '写点什么'
      m.note.presets = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    }, /最多 6 条/],
    ['留言 showPrevious 6', (m) => {
      m.note.enabled = true
      m.note.title = '留一句'
      m.note.prompt = '写点什么'
      m.note.showPrevious = 6
    }, /0 至 5/],
    ['打字目标空', (m) => {
      m.typeIn.enabled = true
      m.typeIn.target = ''
    }, /1 至 40/],
    ['打字目标 41 字', (m) => {
      m.typeIn.enabled = true
      m.typeIn.target = 'x'.repeat(41)
    }, /1 至 40/],
    ['打字 2 秒(契约 3 至 120)', (m) => {
      m.typeIn.enabled = true
      m.typeIn.target = 'hi'
      m.typeIn.seconds = 2
    }, /3 至 120/],
    ['打字 121 秒', (m) => {
      m.typeIn.enabled = true
      m.typeIn.target = 'hi'
      m.typeIn.seconds = 121
    }, /3 至 120/],
    ['检定 tier 不在册(只有 easy/medium/hard)', (m) => {
      m.check.enabled = true
      m.check.checkId = 'x1'
      m.check.tier = 'insane'
    }, /easy、medium 或 hard/],
    ['检定 checkId 带空格', (m) => {
      m.check.enabled = true
      m.check.checkId = 'has space'
    }, /字母、数字、下划线或短横线/],
    ['检定 skill 201 字', (m) => {
      m.check.enabled = true
      m.check.checkId = 'x1'
      m.check.skill = '技'.repeat(201)
    }, /200 字/],
    ['检定效果变量裸写', (m) => {
      m.check.enabled = true
      m.check.checkId = 'x1'
      m.check.successEffects = [{ var: 'thought', op: 'INC', value: 1 }]
    }, /counter\./],
  ]
  for (const [name, mutate, pattern] of cases) {
    assert.match(rejectMessage(mutate), pattern, name + ' 应该被拒,却过了')
  }
  // 同一条链路的正例:合法的整份配置必须无错 —— 否则上面的「拒」可能只是链坏了
  assert.equal(cfg.validate(editorFilledConfig()), '', '合法配置不该被拒')
})

test('★检定 checkId 缺省时补齐、已有时一字不改(稳定标识不能每次存盘换一个)', () => {
  const m = cfg.defaultConfig()
  m.check.enabled = true
  m.check.tier = 'easy'
  const first = cfg.parse(cfg.serialize(m)).value
  assert.match(first.check.checkId, /^[A-Za-z0-9_-]{1,64}$/, '缺省 checkId 必须被补齐成合法形状')
  // 写盘之后它就是配置的一部分:再存一次不许换 id(checkId 是这一处检定的稳定标识)
  const second = cfg.parse(cfg.serialize(first)).value
  assert.equal(second.check.checkId, first.check.checkId)
  const kept = cfg.defaultConfig()
  kept.check.enabled = true
  kept.check.checkId = 'lookout'
  assert.equal(JSON.parse(cfg.serialize(kept)).check.checkId, 'lookout', '已有 checkId 不许被覆盖')
})

test('★R14 检定:没暴露的字段(mods / critEffects / failCostTag …)读进来存回去一字不差', () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    check: {
      enabled: true, checkId: 'lookout', tier: 'hard', skill: '观察',
      successText: '你看清了', failText: '你错过了',
      successEffects: [{ var: 'counter.thought', op: 'INC', value: 1 }],
      failEffects: [],
      mods: [{ when: { var: 'tag.hurried', op: 'HAS_TAG' }, value: -1, label: '着急' }],
      advantageIf: [{ var: 'counter.thought', op: 'GTE', value: 3 }],
      disadvantageIf: [],
      critEffects: [{ var: 'sys.luck', op: 'INC', value: 2 }],
      fumbleEffects: [{ var: 'counter.energy', op: 'INC', value: -2 }],
      failCostTag: 'tag.hurried',
    },
  })
  const parsed = cfg.parse(raw)
  assert.equal(parsed.error, '')
  const saved = JSON.parse(cfg.serialize(parsed.value))
  assert.deepEqual(saved.check.mods, [{ when: { var: 'tag.hurried', op: 'HAS_TAG' }, value: -1, label: '着急' }],
    '条件修正被静默删了')
  assert.deepEqual(saved.check.advantageIf, [{ var: 'counter.thought', op: 'GTE', value: 3 }])
  assert.deepEqual(saved.check.critEffects, [{ var: 'sys.luck', op: 'INC', value: 2 }])
  assert.deepEqual(saved.check.fumbleEffects, [{ var: 'counter.energy', op: 'INC', value: -2 }])
  assert.equal(saved.check.failCostTag, 'tag.hurried')
})

test('★负控:模拟一个只写六项暴露字段的坏编辑器,上一条必须判红', () => {
  /* 这就是「把保留逻辑去掉」的那个版本:读进来只认六项,存回去把 mods / critEffects 丢了。
     如果这个形态也能通过上面那条断言,说明那条断言根本没在看这些字段。 */
  const lossy = {
    check: {
      enabled: true, checkId: 'lookout', tier: 'hard', skill: '观察',
      successText: '你看清了', failText: '你错过了',
      successEffects: [{ var: 'counter.thought', op: 'INC', value: 1 }],
      failEffects: [],
    },
  }
  assert.throws(
    () => assert.deepEqual(lossy.check.mods, [{ when: { var: 'tag.hurried', op: 'HAS_TAG' }, value: -1, label: '着急' }]),
    /deepStrictEqual|Expected values/,
    '丢字段的形态竟然过了断言 = 保留断言是假的',
  )
  assert.equal('critEffects' in lossy.check, false, '负控构造失败:坏编辑器没把 critEffects 丢掉')
})

test('★每个新段都真有一块编辑器面板,并且在玩法单子上选得到', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  for (const section of ['profile', 'photoCheck', 'check', 'note', 'typeIn']) {
    assert.ok(catalog.GAME_SECTIONS.includes(section),
      section + ' 不在玩法目录里 —— 选择玩法那张单子上没有它,商家永远选不到')
    assert.ok(wxml.includes("gameSection === '" + section + "'"),
      section + ' 在配置里有段,但编辑页没有那块面板 —— 商家配不了,而且不报错')
  }
})

test('★拍照审核编辑器删掉了本地判分那套(mode/threshold 整组),换成 requirement + minConfidence', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const js = read('pages/publish/temp/index.js')
  for (const dead of ['photoCheckModes', 'pickPhotoCheckMode', 'photoCheck.rule.mode',
    'photoCheck.rule.threshold', 'data-section="photoCheck.rule"']) {
    assert.equal(wxml.includes(dead) || js.includes(dead), false, dead + ' 还在 —— 本地算分那套没删干净')
  }
  assert.ok(wxml.includes('data-field="requirement"'), '编辑器缺 requirement 输入(契约 §2.2:作者要用人话写清拍到什么)')
  assert.ok(wxml.includes('data-field="minConfidence"'), '编辑器缺 minConfidence 输入')
})

test('★面板里绑的状态字段都要真存在于默认配置(拼错一个字就是永远存不上)', () => {
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
  // 检定的三条效果也走 dataset.path 而不是 data-section/data-field,这里单独钉住
  for (const staticPath of ['check.successEffects', 'check.failEffects']) {
    const seg = staticPath.split('.').reduce((o, k) => (o == null ? o : o[k]), d)
    assert.ok(Array.isArray(seg), staticPath + ' 不在默认配置里 —— 检定效果面板会绑到一个不存在的数组')
  }
  assert.deepEqual(bad, [], '这些绑定写错了,填进去存不回来:\n  ' + bad.join('\n  '))
})

test('★负控:面板绑定扫描抓得到写错的字段名', () => {
  const fakeWxml = '<input data-section="photoCheck" data-field="maxTrials" bindinput="onAdvancedField" />'
  const d = cfg.defaultConfig()
  const m = /data-section="([^"]+)"[^>]*data-field="([^"]+)"/.exec(fakeWxml)
  const seg = m[1].split('.').reduce((o, k) => (o == null ? o : o[k]), d)
  assert.equal(m[2] in seg, false, 'maxTrials 不该存在 —— 上一条的扫描才抓得到拼错')
})
