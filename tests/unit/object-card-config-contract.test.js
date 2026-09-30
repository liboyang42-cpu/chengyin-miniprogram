/* objectCard 的配置面与投影链 —— 施工文档 §2.1 / §2.4 / §10.1。
 *
 * 这一段有三处**静默**断链,每一处都不报错:
 *  1. 本地 advanced-game-config 认字段、服务端 AdvancedGameConfigValidator 不认
 *     → 商家填的内容被原样存回却没人读(或反过来,本地放行、服务端整份配置判死);
 *  2. 服务端把 mode/cardTitle/cardStyle 存下来了却不投影进 playKit
 *     → 组件收到空值,退回普通拍照审核,玩家永远等不到那张卡;
 *  3. 投影进来了但 playkit-view 不搬 → kit 属性回落到组件默认值,同样没声音。
 * 所以这里做的是**三张表的全等比对**:配置段字段 ↔ 服务端投影 ↔ pickPlayKit 产出。
 *
 * 读后端源码这件事不是花活:仓库里同类跨栈契约一直走这条路口
 * (见 advanced-game-config-slowtask.test.js),因为跑不了 Java 断言,而两边的
 * 字段名/枚举一旦错开,唯一表现就是「配了没用」。 */
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8')
// 注释里写「这里投影了 mode」是在讲愿望,不是事实:只看真代码。
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const VALIDATOR = '../chengyinhub-system/src/main/java/com/chengyinhub/business/service/'
  + 'support/AdvancedGameConfigValidator.java'
const RUNTIME = '../chengyinhub-system/src/main/java/com/chengyinhub/business/service/'
  + 'impl/AdvancedGameRuntimeServiceImpl.java'

/** 后端 validatePhotoCheck 读了哪几个字段。 */
function serverPhotoCheckFields() {
  const code = strip(read(VALIDATOR))
  const body = (code.match(/private void validatePhotoCheck\(JsonNode photoCheck\)[\s\S]*?\n    \}/) || [''])[0]
  assert.ok(body, '没在后端 Validator 里认出 validatePhotoCheck,这条断言就是恒真的')
  const fields = new Set(['enabled'])
  let m
  const reText = /(?:requiredText|optionalText|optionalMediaUrl)\(\s*photoCheck\s*,\s*"(\w+)"/g
  while ((m = reText.exec(body))) fields.add(m[1])
  const rePath = /photoCheck\.path\("(\w+)"\)/g
  while ((m = rePath.exec(body))) fields.add(m[1])
  if (/validateXp\(/.test(body)) fields.add('xp')
  return fields
}

/** 后端 Java 侧的枚举名单(setOf("…"))—— 与本地常量必须逐字相同。 */
function serverEnum(name) {
  const code = strip(read(VALIDATOR))
  const m = code.match(new RegExp('Set<String>\\s+' + name + '\\s*=\\s*setOf\\(([^)]*)\\)'))
  assert.ok(m, '后端没有 ' + name + ' 这份枚举名单,这条断言就是恒真的')
  return m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
}

/** 服务端 photoCheck 那一块投影:从**配置**读的键、从**会话状态**读的键。 */
function serverProjection() {
  const code = strip(read(RUNTIME))
  const at = code.indexOf('if (enabled(config.path("photoCheck")))')
  assert.ok(at >= 0, '后端里没有 photoCheck 的 kit 投影块,这条断言就是恒真的')
  const body = code.slice(at, code.indexOf('kit.put("photoCheck"', at))
  const fromConfig = new Set()
  const fromState = new Set()
  let m
  const rePut = /value\.put\("(\w+)"[^;]*?\b(cfg|st)\.path\("(\w+)"\)/g
  while ((m = rePut.exec(body))) (m[2] === 'cfg' ? fromConfig : fromState).add(m[3])
  const reText = /putText\(\s*value\s*,\s*"(\w+)"\s*,\s*(cfg|st)\s*\)/g
  while ((m = reText.exec(body))) (m[2] === 'cfg' ? fromConfig : fromState).add(m[1])
  /* #1139(取景轮廓)起多了一种**间接**写法:先 `String x = cfg.path("x")…`,再 `value.put("x", x)`。
     只认单语句形状的话 frameUrl 会被判成「没投影」—— 而它明明投了。这里按局部变量回溯,
     只在该变量真的被 put 出去时才记账,不靠白名单放行(白名单会把真断链一起放过去)。 */
  const locals = new Map()
  const reLocal = /(?:String|int|long|boolean)\s+(\w+)\s*=\s*(cfg|st)\.path\("(\w+)"\)/g
  while ((m = reLocal.exec(body))) locals.set(m[1], [m[2], m[3]])
  const rePutVar = /value\.put\("(\w+)"\s*,\s*(\w+)\s*\)/g
  while ((m = rePutVar.exec(body))) {
    const src = locals.get(m[2])
    if (src) (src[0] === 'cfg' ? fromConfig : fromState).add(src[1])
  }
  assert.ok(fromConfig.size >= 6, '只认出 ' + fromConfig.size + ' 个配置键,投影块的解析式多半失效了')
  return { fromConfig, fromState }
}

/** pickPlayKit 对拍照审核这一屏真正产出的属性(去掉四件套 base)。 */
function kitKeysOf(section, seg) {
  const base = ['type', 'sessionId', 'version', 'present']
  const kit = pickPlayKit({ sessionId: 's1', version: 1, playKit: { [section]: seg } }, new Date(2026, 8, 22, 12))
  assert.ok(kit, section + ' 段还不出 kit')
  return Object.keys(kit).filter((key) => base.indexOf(key) < 0)
}

/* 服务端下发、客户端**有意**不搬进 kit 的字段。这不是豁免清单,是账:
   每一条都要说清为什么玩家屏上用不到它。新增一个投影字段而这里没记账,下面判红。 */
const NOT_CARRIED = {
  requirement: '要拍到什么只进模型的 prompt,玩家屏上没有这一行(给了等于提示答案)',
  minConfidence: '分数线是服务端判定的事,展示出来只会引来讨价还价',
  xp: '经验由通关结算那条链发,这一屏不显示',
  lastConfidence: '模型给的置信度不对玩家说话',
}

/* 客户端 kit 里**不是**从 playKit.photoCheck 投影搬来的键。它们另有来源,所以不参与上面
   那张全等表 —— 但来源本身要在下面的用例里单独钉住,不能拿这张表当豁免口袋。 */
const OUT_OF_PROJECTION = {
  card: '不是配置投影,是判过这一次回包带的 objectCard 回执(契约 §10.2「当场看到卡」)',
  place: '不是配置投影,是游玩页给的「主题名 · 节点名」(会话视图里只有 nodeId),信息卡的「地点」一行',
  photoFailSeq: '不是配置投影,是页面的提交失败信号:上传没成时通知拍物成卡那一屏回取景,kit 恒给 0',
  preview: '不是配置投影,是编辑页预览标记:玩家侧恒 false,只有 advanced-game-preview 给 true',
}

test('★objectCard 的三个字段:配置段有默认、后端 Validator 认、两边枚举逐字相同', () => {
  const seg = cfg.defaultConfig().photoCheck
  assert.equal(seg.mode, '', "老玩法的默认必须是空串 —— 'CARD' 才代表拍物成卡")
  assert.equal(seg.cardTitle, '', '卡名留空 = 用 title,不能凭空替商家编一个名字')
  assert.equal(seg.cardStyle, 'foil', '默认有高光;不想要要显式选 plain')

  const server = serverPhotoCheckFields()
  assert.deepEqual(cfg.PHOTO_CARD_FIELDS.filter((f) => !server.has(f)), [],
    '本地有、后端 validatePhotoCheck 不认:商家填了会被原样存回却没人读')

  assert.deepEqual(serverEnum('PHOTO_CHECK_MODES'), ['CARD'])
  assert.deepEqual(cfg.PHOTO_CHECK_MODES, serverEnum('PHOTO_CHECK_MODES'),
    '前后端 mode 枚举错开 = 一边放行一边判死')
  assert.deepEqual(cfg.PHOTO_CARD_STYLES, serverEnum('PHOTO_CARD_STYLES'),
    '前后端 cardStyle 枚举错开 = 同上')
})

test('normalize:老配置(没有这三个字段)清洗后不长出假值', () => {
  const legacy = { photoCheck: { enabled: true, title: '拍门头', requirement: '拍到招牌' } }
  const out = cfg.normalize(legacy).photoCheck
  assert.equal(out.mode || '', '', '老模板清洗后仍然是普通拍照审核')
  assert.equal(out.cardStyle, 'foil')
  assert.ok(!('cardTitle' in out), '空的 cardTitle 不该被存成一个空字符串键')

  const card = cfg.normalize({
    photoCheck: { enabled: true, title: '捡一件东西', requirement: '拍到金属', mode: 'CARD', cardTitle: '一枚弹壳', cardStyle: 'plain' },
  }).photoCheck
  assert.equal(card.mode, 'CARD')
  assert.equal(card.cardTitle, '一枚弹壳')
  assert.equal(card.cardStyle, 'plain')
})

test('存 → 读回 → 再存:藏品卡那三个字一个字都不丢', () => {
  const raw = JSON.stringify({
    schemaVersion: cfg.SCHEMA_VERSION,
    photoCheck: { enabled: true, title: '捡一件东西', requirement: '拍到金属', mode: 'CARD', cardTitle: '一枚弹壳', cardStyle: 'plain', xp: 0 },
  })
  const model = cfg.parse(raw).value
  assert.equal(cfg.validate(model), '')
  const again = () => cfg.parse(cfg.serialize(model)).value.photoCheck
  assert.equal(again().mode, 'CARD')
  assert.equal(again().cardTitle, '一枚弹壳')
  assert.equal(again().cardStyle, 'plain')
})

test('validate:枚举与长度脏值当场判红,别等服务端', () => {
  const base = () => ({
    enabled: true, title: '捡一件东西', requirement: '拍到金属',
    mode: 'CARD', cardTitle: '', cardStyle: 'foil', maxTries: 3, fallback: 'retake', minConfidence: 60, xp: 0,
  })
  const modelWith = (patch) => cfg.parse({ photoCheck: Object.assign(base(), patch) }).value
  assert.equal(cfg.validate(modelWith({})), '')
  assert.ok(cfg.validate(modelWith({ mode: 'COIN' })), '没登记的 mode 必须报错')
  assert.ok(cfg.validate(modelWith({ cardStyle: 'gold' })), '没登记的 cardStyle 必须报错')
  assert.ok(cfg.validate(modelWith({ cardTitle: '一'.repeat(65) })),
    '卡名超过后端那道 64 字上限必须本地就拦住')
})

test('★三张表全等:配置段字段 = 服务端投影字段 = pickPlayKit 产出(减记过账的不搬项)', () => {
  const projected = serverProjection()
  const carried = kitKeysOf('photoCheck', { title: 't' })

  // 1) objectCard 的三个字段必须一路到 kit —— 少一个组件就静默回落(文档 §2.4)
  assert.deepEqual(cfg.PHOTO_CARD_FIELDS.filter((f) => !projected.fromConfig.has(f)), [],
    '这三个字段没投影进 playKit:组件收到空值,退回普通拍照审核,没有任何报错')
  assert.deepEqual(cfg.PHOTO_CARD_FIELDS.filter((f) => carried.indexOf(f) < 0), [],
    '投影进来了但 pickPlayKit 没搬:kit 属性回落到组件默认值,同样没声音')

  // 2) 整段全等:服务端下发的每一个键,要么被搬进 kit,要么在 NOT_CARRIED 记过账
  const all = [...projected.fromConfig, ...projected.fromState]
  const carriedByProjection = carried.filter((key) => !(key in OUT_OF_PROJECTION))
  assert.deepEqual(all.slice().sort(), carriedByProjection.concat(Object.keys(NOT_CARRIED)).sort(),
    '投影与搬运对不上:要么漏搬一个字段,要么新增的那条没记账')
  assert.deepEqual(carried.filter((key) => key in NOT_CARRIED), [],
    'NOT_CARRIED 里记的字段又被搬进 kit 了 —— 账要删掉')
})

test('★当场那张卡走的是回执,不是配置投影:后端 put("objectCard") ↔ 客户端 kit.card', () => {
  const runtime = strip(read(RUNTIME))
  assert.ok(/view\.put\("objectCard",\s*PlayerObjectCardVO\.from\(/.test(runtime),
    '后端没把铸出来的卡并进本次回包(或没复用 VO 那份投影)—— 当场那一屏永远不出卡')

  const view = read('pages/play/utils/playkit-view.js')
  assert.ok(/buildPhotoCheck\(\s*seg\s*,\s*view\.objectCard\b/.test(view),
    'pickPlayKit 没把回执喂进 buildPhotoCheck —— kit.card 恒为 null')

  // 负控:回执那一路断掉(第二个实参没了),上一条必须能红
  const stripped = view.replace(/buildPhotoCheck\(\s*seg\s*,\s*view\.objectCard\b[^)]*\)/, 'buildPhotoCheck(seg)')
  assert.notEqual(stripped, view, '负控构造失败:回执那个实参已经不是预期的形状')
  assert.ok(!/buildPhotoCheck\(\s*seg\s*,\s*view\.objectCard\b/.test(stripped), '负控构造失败:没真摘掉')
})

test('负控:把 cardStyle 从 pickPlayKit 里摘掉,上一条必须判红', () => {
  const src = read('pages/play/utils/playkit-view.js')
  // 只摘**配置投影**那一行(卡面样式);回执里的 card.cardStyle 是另一条链,别混在一起
  const stripped = src.replace(/\n\s*cardStyle: seg\.cardStyle[^\n]*\n/, '\n')
  assert.notEqual(stripped, src, '负控构造失败:playkit-view 里没有 cardStyle: seg.cardStyle 那一行')
  assert.ok(!/cardStyle: seg\.cardStyle/.test(stripped), '负控构造失败:没真摘掉')
})

/* 2026-09-24 用户定:编辑页要有「兜底卡名」。卡名顺序是 AI 认出的名 → 这里填的卡名 → 标题 → 藏品卡;
   配置、校验、后端投影早就认 cardTitle,只差编辑页没有输入框 —— 商家根本填不进去。 */
test('★编辑页拍物成卡模式下有兜底卡名输入框,写进 photoCheck.cardTitle,长度与两端校验一致', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const at = wxml.indexOf("wx:if=\"{{gameSection === 'photoCheck'}}\"")
  assert.ok(at > 0, '找不到拍照段')
  const section = wxml.slice(at, wxml.indexOf('<view class="cg-gcfg"', at + 10) > 0 ? wxml.indexOf('<view class="cg-gcfg"', at + 10) : undefined)
  const block = (section.match(/<view wx:if="\{\{advanced\.photoCheck\.mode === 'CARD'\}\}">[\s\S]*?<\/view>\s*<\/view>|<view wx:if="\{\{advanced\.photoCheck\.mode === 'CARD'\}\}">[\s\S]*?\/>/) || [''])[0]
  assert.ok(block, '拍照段里没有只在拍物成卡模式出现的一块')
  const input = (block.match(/<input[^>]*data-field="cardTitle"[^>]*\/>/) || [''])[0]
  assert.ok(input, '没有写 cardTitle 的输入框')
  assert.ok(/data-section="photoCheck"/.test(input) && /bindinput="onAdvancedField"/.test(input), input)
  assert.ok(/value="\{\{advanced\.photoCheck\.cardTitle\}\}"/.test(input), input)
  assert.ok(/maxlength="64"/.test(input), '长度要与前后端校验同一个 64:' + input)
})
