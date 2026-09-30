const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const PLAYABLE_PHOTO_FILTER_BRANCH = /\s*\|\| SensorChallengePolicy\.isPlayablePhotoFilter\(vmVal,\s*\(String\) m\.get\("sensorType"\),\s*\(String\) m\.get\("sensorConfig"\)\)/

function loadPlayerPage() {
  let definition
  global.getApp = () => ({ globalData: { features: {} }, sendRequest() {} })
  global.wx = { getStorageSync: () => '', setStorageSync() {} }
  global.Page = (config) => { definition = config }
  const file = path.join(ROOT, 'pages/play/index.js')
  delete require.cache[require.resolve(file)]
  require(file)
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  return page
}

function autoPopupBody(js) {
  const m = js.match(/_maybeAutoPopup\(\) \{([\s\S]*?)\n  \},/)
  assert.ok(m, '_maybeAutoPopup 必须存在')
  return m[1]
}

function assertGameSheetContract(js, wxml) {
  // B5 收窄(2026-08-15):扫码进店后弹体验层 —— 有游戏弹游戏,无游戏弹任务卡;
  // 未进店不弹(闸必须在 _maybeAutoPopup 自己的函数体里,不许借隔壁函数的判断凑数),
  // 作答走 /api/play/answer。
  assert.ok(autoPopupBody(js).includes('!node.arrived'), '_maybeAutoPopup 必须闸在进店态上')
  assert.match(js, /node\.hasGame && node\.question\) this\.openGame\(\)/)
  assert.match(js, /else this\.openTaskCard\(\)/)
  assert.match(js, /\/api\/play\/answer/)
  assert.match(js, /autoPopup: true/)
  assert.match(wxml, /wx:if="\{\{game\.show\}\}"/)
  assert.match(wxml, /wx:if="\{\{task\.show\}\}"/)
  assert.match(wxml, /bindtap="submitGame"/)
  assert.match(wxml, /bindtap="taskGoPhoto"/)
}

function backendHasGameExpression(ctrl) {
  const match = ctrl.match(/boolean hasGame = ([\s\S]*?);\n\s*if \(!hasGame\)/)
  assert.ok(match, '找不到后端 hasGame 判定')
  return match[1]
}

function assertBackendHasGameKinds(ctrl) {
  const expression = backendHasGameExpression(ctrl)
  assert.match(expression, /vmVal == ValidationMethod\.APP_SENSOR/)
  assert.match(expression, PLAYABLE_PHOTO_FILTER_BRANCH)
  assert.match(expression, /\(vmVal == 1 \|\| vmVal == 3\)[\s\S]*m\.get\("question"\)/)
}

test('探店日商家页:扫码后体验层契约(游戏/任务卡两态,进店前不弹)', () => {
  assertGameSheetContract(
    read('pages/play/merchant/index.js'),
    read('pages/play/merchant/index.wxml'))
})

test('mutation 负控:摘掉进店闸时契约确实变红', () => {
  const js = read('pages/play/merchant/index.js')
    .replace('if (!node || !node.arrived || node.done) return', 'if (!node) return')
  assert.throws(() => assertGameSheetContract(
    js, read('pages/play/merchant/index.wxml')), assert.AssertionError)
})

/**
 * ★任务卡的全部内容就是「拍摄要求 + 规则」两行,它们必须读<b>归一化后</b>的字段名。
 *
 * 两条来路都已按归一化名下发:列表走 normNode(ruleInstructions→rule、photoRequireDesc→photoDesc),
 * 进店回包由 shopDayProofData 直接发 rule/photoDesc。读原始名 = 恒 undefined ⇒
 * 拍摄要求恒退回兜底文案、规则块永不渲染 —— 任务卡弹出来是空的,而没配游戏的店只有这一张卡。
 * 现有 tandianri-final-repair-contract 只判「不许出现原始名」,这里正面钉住「读的是哪两个名」。
 */
test('没配游戏的店:任务卡必须读归一化后的拍摄要求与规则,不是原始字段名', () => {
  const wxml = read('pages/play/merchant/index.wxml')
  const card = wxml.match(/<view class="mp-sheet" wx:if="\{\{task\.show\}\}"[^>]*>[\s\S]*?<\/view>\s*<\/view>/)
  assert.ok(card, '找不到任务卡区块')
  assert.match(card[0], /node\.photoDesc/, '拍摄要求必须读 normNode 归一化后的 photoDesc')
  assert.match(card[0], /node\.rule\b/, '规则必须读 normNode 归一化后的 rule')
  assert.doesNotMatch(card[0], /node\.(photoRequireDesc|ruleInstructions)/,
    '读原始名恒 undefined ⇒ 任务卡是空的')
})

test('后端契约:hasGame 覆盖答题、App 传感器与滤镜拍照,未进店不下发题面;答题带进店硬闸与条件更新首完', () => {
  const ctrl = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayProgressController.java')
  assertBackendHasGameKinds(ctrl)
  // 偏好题组是本分支新增的一类 hasGame，master 的 helper 还没覆盖，单独钉住
  assert.match(backendHasGameExpression(ctrl), /vmVal == ValidationMethod\.PREFERENCE_GROUP/)
  assert.match(ctrl, /StringUtils\.isNotBlank\(String\.valueOf\(m\.get\("question"\)\)\)/)
  assert.match(ctrl, /if \(!hasGame\) \{/)
  assert.match(ctrl, /"question", "options", "gameTitle", "hint1", "hint2", "storyText",\s*"validationMethod", "sensorType", "sensorConfig"\)\)/)
  assert.match(ctrl, /"validationMethod", "needScan", "needAnswer", "needGps", "sensorType", "sensorConfig",\s*"advancedConfigJson"\)\)/)
  // answerReveal/feedbackText 已从「未进店才剥」升级为 ③ 一律剥(TemplateSecrets 同档机密),
  // 所以它们只能出现在 mode2 的无条件剥离行里,不能再挂在 !arrived 那一行上。
  assert.match(ctrl, /removeAll\(Arrays\.asList\("answerReveal", "feedbackText"\)\)/)
  // ⚠️ 2026-08-28 实测:剧透保护那支分支曾把这行改成 `if (!revealed) m.remove("answerReveal")`,
  // 而上面那段「一律剥 / fail-closed」的注释原样留着 —— 注释与代码对不上,闸自己开了。
  // `revealed` 来自 member_spoiler_reveal,是玩家自己点「我要看」写出来的,
  // 于是点一下揭示就能在作答前拿到答案。这条负向断言专门钉死这个形状。
  // 断的是「形状无关」的判据:唯一被批准的剥离方式就是上面那条 removeAll 列表。
  // 只要出现单独的 m.remove("answerReveal"),不管前面挂的是什么条件,一律判红 ——
  // 按条件写法去匹配正则很脆(实测 `if (!Boolean.TRUE.equals(m.get("revealed")))`
  // 里的嵌套括号就能让 [^)]* 匹不到),所以这里不去猜条件长什么样。
  assert.doesNotMatch(ctrl, /m\.remove\(\s*"answerReveal"\s*\)/,
    'answerReveal 只能走无条件的 removeAll 列表 —— 剧透保护管的是剧情文本该不该提前看见,' +
    '不是答案该不该提前拿到;revealed 由玩家自己写,挂上它等于这条付费内容闸自己开了')
  assert.match(ctrl, /removeAll\(Arrays\.asList\("medalName", "medalStyle", "medalImg", "couponId", "coupon"\)\)/)
  assert.match(ctrl, /hasArrived\(memberId, actId, node\.getId\(\)\)/)
  assert.match(ctrl, /markGameDone\(memberId, actId, node\.getTopicId\(\), node\.getId\(\)\)/)
  const mapper = read('../chengyinhub-system/src/main/resources/mapper/business/PlayerNodeProgressMapper.xml')
  assert.match(mapper, /markShopDayGameDone[\s\S]{0,300}status = 0 and del_flag = 0/)
})

test('mutation 负控:hasGame 漏掉滤镜拍照时契约确实变红', () => {
  const ctrl = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayProgressController.java')
  const expression = backendHasGameExpression(ctrl)
  const mutatedExpression = expression.replace(PLAYABLE_PHOTO_FILTER_BRANCH, '')
  assert.notEqual(mutatedExpression, expression, '负控必须真实删除滤镜拍照分支')
  assert.throws(
    () => assertBackendHasGameKinds(ctrl.replace(expression, mutatedExpression)),
    assert.AssertionError)
})

test('玩家页防御性归一:探店日剥离经典勋章/券承诺,经典模式保留', () => {
  const page = loadPlayerPage()
  const responseNode = {
    nodeId: 9,
    medalName: '经典勋章', medalImg: '/medal.png', medalStyle: 'glow',
    couponId: 88, coupon: { id: 88, name: '经典券' },
  }

  const shopDay = page.normNode(responseNode, 0, 2)
  assert.equal(shopDay.medalName, '')
  assert.equal(shopDay.medalImg, '')
  assert.equal(shopDay.medalStyle, '')
  assert.equal(shopDay.couponId, 0)
  assert.equal(shopDay.coupon, null)

  const classic = page.normNode(responseNode, 0, 1)
  assert.equal(classic.medalName, '经典勋章')
  assert.equal(classic.medalImg, '/medal.png')
  assert.equal(classic.couponId, 88)
  assert.equal(classic.coupon.name, '经典券')
})
