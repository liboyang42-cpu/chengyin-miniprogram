/* 《预制人生》四个新玩法段的视图层契约(2026-09-17 施工契约 §2;§2.3 的 check 已作废)
 *
 * 四个段(profile / photoCheck / note / typeIn)各要穿四层:
 *   KIT_PRIORITY(不在表里 = 客户端当它不存在)/ TYPE_OF(段名→组件 type)/
 *   ACTION_OF(type:action→服务端动作名,少一条 = 玩家做完什么也不发生)/
 *   serverPayload(字段名或单位不换 = 服务端按 0 判,永远不通过)。
 * 这四层每一层漏掉都是**静默**的:不渲染、不发请求、不报错。所以按段名全表跑,
 * 漏一个就红。photoCheck 是两步走(上传拿地址 → 再提交),刻意不在 ACTION_OF 里。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const VIEW = '../../pages/play/utils/playkit-view.js'
const SRC = path.resolve(__dirname, VIEW)
const read = () => fs.readFileSync(SRC, 'utf8')

const { pickPlayKit, serverAction, serverPayload, KIT_PRIORITY } = require(VIEW)

const at = (h, m) => new Date(2026, 8, 17, h, m, 0)

/** 段名 → 客户端组件 type → 能提交的动作(photoCheck 两步走,没有单动作)。 */
const SECTIONS = [
  { name: 'profile', type: 'profile', action: 'submit', serverAction: 'SUBMIT_PROFILE' },
  { name: 'photoCheck', type: 'photocheck', action: '', serverAction: '' },
  { name: 'note', type: 'note', action: 'submit', serverAction: 'SUBMIT_NOTE' },
  { name: 'typeIn', type: 'typein', action: 'submit', serverAction: 'SUBMIT_TYPE_IN' },
]

test('★四个新段在 KIT_PRIORITY / TYPE_OF / ACTION_OF 三张表里都在册,漏一个就红', () => {
  for (const s of SECTIONS) {
    assert.ok(KIT_PRIORITY.indexOf(s.name) >= 0,
      s.name + ' 不在 KIT_PRIORITY —— 服务端下发了客户端也当它不存在')
    const kit = pickPlayKit({ sessionId: 1, version: 0, playKit: { [s.name]: { title: 't' } } }, at(12, 0))
    assert.ok(kit, s.name + ' 拿不到 kit')
    assert.equal(kit.type, s.type, s.name + ' 的 type 映射对不上,分发器整块不渲染')
    if (s.action) {
      assert.equal(serverAction(s.type, s.action), s.serverAction,
        s.type + ':' + s.action + ' 不在 ACTION_OF —— 玩家做完那一下什么都不发生')
    }
  }
})

test('负控:段名从优先级表里摘掉一条,上一条必须能红', () => {
  const src = read()
  const ROW = "  'profile', 'photoCheck', 'note', 'typeIn',"
  assert.ok(src.includes(ROW), '负控构造失败:优先级表那行已经不是预期形状')
  const stripped = src.replace(ROW, "  'photoCheck', 'note', 'typeIn',")
  assert.notEqual(stripped, src, '负控构造失败:没真摘掉')
  assert.ok(!stripped.includes(ROW), '坏版本里 profile 确实没了 —— 全表跑的断言会因此判红')
})

test('负控:动作名从 ACTION_OF 里摘掉一条,必须能红', () => {
  const src = read()
  const ROW = "  'note:submit': 'SUBMIT_NOTE',"
  assert.ok(src.includes(ROW), '负控构造失败:note 那条动作已经不是预期形状')
  const stripped = src.replace(ROW, '')
  assert.notEqual(stripped, src, '负控构造失败:没真摘掉')
  const fn = new Function('module', 'exports', 'require', stripped + '\nmodule.exports = { serverAction };')
  const mod = { exports: {} }
  // require 要按 playkit-view.js 所在目录解析,不然 './playkit-steps.js' 会从 tests/unit 找不到
  fn(mod, mod.exports, (p) => require(path.resolve(path.dirname(SRC), p)))
  assert.equal(mod.exports.serverAction('note', 'submit'), '',
    '摘掉之后必须变空串 —— 页面就静默 return')
})

// ===== profile =====

test('profile:题面/答案/头像位原样搬运,effects 不下发(数值加成是暗的)', () => {
  const kit = pickPlayKit({
    sessionId: 9, version: 2,
    playKit: { profile: {
      title: '出生登记', lead: '填完这张表，你就有了身份',
      avatar: { enabled: true, required: false },
      questions: [{ key: 'name', label: '你叫什么', kind: 'text', maxLength: 12, required: true }],
      answers: { name: '阿岚' }, avatarUrl: 'https://cdn/a.png', done: true,
    } },
  }, at(12, 0))
  assert.equal(kit.type, 'profile')
  assert.equal(kit.title, '出生登记')
  assert.equal(kit.lead, '填完这张表，你就有了身份')
  assert.deepEqual(kit.avatar, { enabled: true, required: false })
  assert.equal(kit.questions.length, 1)
  assert.deepEqual(kit.answers, { name: '阿岚' })
  assert.equal(kit.avatarUrl, 'https://cdn/a.png')
  assert.equal(kit.done, true)
})

test('profile:已建档就不再弹,让位给还没做完的那一段', () => {
  const kit = pickPlayKit({
    sessionId: 1, version: 4,
    playKit: {
      profile: { title: '登记', done: true },
      note: { title: '留一句', done: false },
    },
  }, at(12, 0))
  assert.equal(kit.type, 'note')
})

test('profile 提交:answers 与 avatarUrl 逐字段搬运', () => {
  assert.deepEqual(
    serverPayload('profile', 'submit', { answers: { name: '阿岚', job: 'clerk' }, avatarUrl: 'u' }),
    { answers: { name: '阿岚', job: 'clerk' }, avatarUrl: 'u' })
  assert.deepEqual(serverPayload('profile', 'submit', {}), { answers: {}, avatarUrl: '' })
})

// ===== photoCheck =====

test('photoCheck:状态原样下发;rule.mode/threshold 已作废,不再下发', () => {
  const kit = pickPlayKit({
    sessionId: 3, version: 1,
    playKit: { photoCheck: {
      title: '拍一张窗外', shotNote: '把窗框也拍进去',
      requirement: '画面里要能看见窗外的街景，窗框入镜', minConfidence: 60,
      maxTries: 3, fallback: 'retake',
      tries: 1, passed: false, flagged: false, degraded: false,
      lastUrl: '', lastReason: '画面里没看到窗框',
    } },
  }, at(12, 0))
  assert.equal(kit.type, 'photocheck')
  assert.equal(kit.maxTries, 3)
  assert.equal(kit.fallback, 'retake')
  assert.equal(kit.tries, 1)
  assert.equal(kit.lastReason, '画面里没看到窗框', '不过的理由必须下发,否则玩家看不到为什么')
  assert.equal(kit.degraded, false)
  assert.equal('rule' in kit, false, 'rule 那一组本地算分键已作废,不许回来')
  assert.equal('threshold' in kit, false, 'threshold 已作废')
  /* ⚠️ mode 这个名字从 2026-09-22 起有了**第二个**意思:立体藏品卡的玩法判别键
     (空 = 普通拍照审核,'CARD' = 拍物成卡),与作废的 rule.mode 毫无关系。
     它必须由 buildPhotoCheck 透出去 —— 漏了组件收不到「要铸卡」这个信号,而且不报错。
     见 object-card-config-contract 那条三张表全等。 */
  assert.equal(kit.mode, '', '服务端没投影 mode 时回落成普通拍照审核')
})

test('★photoCheck 是两步,不在 ACTION_OF 里 —— 放进去会被当成一步直发', () => {
  assert.equal(serverAction('photocheck', 'shoot'), '')
  assert.equal(serverAction('photocheck', 'submit'), '')
})

test('photoCheck:过了或兜底放行(flagged)都算完;还在重拍不算', () => {
  const pick = (seg) => pickPlayKit({
    sessionId: 1, version: 1,
    playKit: { photoCheck: Object.assign({ title: 't' }, seg), note: { title: 'n' } },
  }, at(12, 0)).type
  assert.equal(pick({ tries: 2, passed: false, flagged: false }), 'photocheck', '还在重拍就得接着弹')
  assert.equal(pick({ tries: 2, passed: true }), 'note', '过了就让位')
  assert.equal(pick({ tries: 3, passed: false, flagged: true, fallback: 'pass' }), 'note',
    '次数用尽兜底放过(flagged)也算完,不然这一段永远走不掉')
})

// ===== check(契约 §2.3 已作废:master 上的 R14 检定走 JOURNEY_SEGMENTS,不在 playKit 里)=====

// ===== note =====

test('note:预设/前几条/自己的那条都搬运', () => {
  const kit = pickPlayKit({
    sessionId: 6, version: 1,
    playKit: { note: {
      title: '写一句留给下一个人', prompt: '你看到窗外什么', maxLength: 40,
      presets: ['天是灰的', '有人在等红灯'],
      previous: [{ text: '灯一直红', at: '2026-09-16 20:00' }],
      mine: '', done: false,
    } },
  }, at(12, 0))
  assert.equal(kit.type, 'note')
  assert.equal(kit.maxLength, 40)
  assert.deepEqual(kit.presets, ['天是灰的', '有人在等红灯'])
  assert.equal(kit.previous.length, 1)
  assert.equal(kit.done, false)
})

test('note 提交只报文本本身', () => {
  assert.deepEqual(serverPayload('note', 'submit', { text: '  天是灰的  ' }), { text: '  天是灰的  ' })
})

// ===== typeIn =====

test('★typeIn 必须先开表:start 走 START_CHALLENGE 且 game 是驼峰 typeIn', () => {
  assert.equal(serverAction('typein', 'start'), 'START_CHALLENGE')
  assert.deepEqual(serverPayload('typein', 'start', {}), { game: 'typeIn' })
})

test('typeIn:目标文本与限时下发,判定字段搬运;用时毫秒随提交走', () => {
  const kit = pickPlayKit({
    sessionId: 8, version: 1,
    playKit: { typeIn: {
      title: '打出这行字', target: 'hello world', seconds: 10,
      caseSensitive: false, tries: 0, attempts: 1, passed: true,
    } },
  }, at(12, 0))
  assert.equal(kit.type, 'typein')
  assert.equal(kit.target, 'hello world')
  assert.equal(kit.seconds, 10)
  assert.equal(kit.caseSensitive, false)
  assert.equal(kit.attempts, 1)
  assert.equal(kit.passed, true)

  assert.deepEqual(serverPayload('typein', 'submit', { text: 'hello world', elapsedMs: 4210.7 }),
    { text: 'hello world', elapsedMs: 4211 })
  // 不限次(tries=0)时不到 attempts >= tries 永远不成立,不会误判成「机会用尽」
  assert.equal(pickPlayKit({
    sessionId: 8, version: 2,
    playKit: { typeIn: { title: 't', seconds: 10, tries: 0, attempts: 99, passed: false } },
  }, at(12, 0)).type, 'typein')
})

// ===== 分发器与页面接线 =====

test('★四个新 type 都要注册进分发器并真的有 wxml 分支 —— 少一处弹窗一声不响不出现', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit/index.json'), 'utf8'))
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit/index.js'), 'utf8')
  for (const s of SECTIONS) {
    const tag = 'cy-playkit-' + s.type
    assert.ok(json.usingComponents[tag], tag + ' 没注册进 usingComponents')
    assert.ok(wxml.includes("kit.type === '" + s.type + "'"), tag + ' 在 wxml 里没有分发分支')
    assert.ok(js.includes("'" + s.type + "'"), s.type + ' 不在 KIT_TYPES 白名单')
  }
})

test('★页面接住了两条不在服务端动作表里的路:photoCheck 两段式提交、建档头像上传', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.js'), 'utf8')
  assert.match(src, /'SUBMIT_PHOTO_CHECK'/, 'photoCheck 的提交动作没接到页面上,拍完只会静默什么都不发生')
  assert.match(src, /payload: \(url\) => \(\{ imageUrl: url \}\)/, 'photoCheck 提交必须只带图片地址(契约 §2.2:判定全在服务端)')
  assert.equal(/imageUrl: url[^)]*score/.test(src), false,
    'score 又回到 payload 了 —— 客户端报分就是个可伪造的后门,契约明确不再接受')
  assert.match(src, /\{ avatar: true \}/, '建档头像没接上传路径,选了也不会出现在档案里')
})
