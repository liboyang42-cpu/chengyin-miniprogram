// RUN-52 发布者实名契约(2026-09-19)
//
// 要收钱的人必须先被认出来(电商法 §27 / 平台审核要求)。采集口径是用户拍板的四条:
//   · 只收「真实姓名 + 身份证号」,加密后只落库,不做展示页、个人中心不放行;
//   · 每个要收钱的入口都要收(无免费额度豁免),字段放【最后一步】;
//   · 已登记的人只回显状态、不再给填字段的入口,改绑走人工客服;
//   · 用词只能说「已登记」,不能说「已实名认证」(平台没有三要素通道)。
// 规则一份,四处在用:主理人申请第 4 步、商家入驻第 4 步、发布确认弹层,
// 以及 scene-route-content 里前两者的场景化副本。本文件钉的就是「四处不许各写一套、
// 不许把 PII 混进业务单、不许把实名登记和业务写并发发」。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const root = (p) => path.join(__dirname, '../..', p)
const read = (p) => fs.readFileSync(root(p), 'utf8')

const ENTRY = {
  club: {
    js: 'pages/club/apply/index.js',
    wxml: 'pages/club/apply/index.wxml',
    source: 'SOURCE_CLUB_APPLY',
    consentKey: 'identityConsented',
  },
  merchant: {
    js: 'pages/merchant/apply/index.js',
    wxml: 'pages/merchant/apply/index.wxml',
    source: 'SOURCE_MERCHANT_APPLY',
    consentKey: 'identityConsented',
  },
  fabu: {
    js: 'pages/publish/fabu/index.js',
    wxml: 'pages/publish/fabu/index.wxml',
    source: 'SOURCE_TOPIC_PUBLISH',
    consentKey: 'identityConsented',
  },
}
const SCENE_JS = 'components/cy/scene-route-content/index.js'
const SCENE_WXML = 'components/cy/scene-route-content/index.wxml'
const UTIL = 'utils/publisher-identity.js'

/** 从某个字面量签名起取到配平的 } —— 只用在已经缩窄到一小段文本里的匿名回调。 */
function bodyFrom(src, signature) {
  const at = src.indexOf(signature)
  assert.notEqual(at, -1, `找不到函数 ${signature}`)
  let i = src.indexOf('{', at)
  assert.notEqual(i, -1, `${signature} 没有函数体`)
  let depth = 0
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(at, i + 1)
    }
  }
  assert.fail(`${signature} 的括号没有闭合`)
}

/** 页面/组件方法定义体:必须认行首的 `name(`,否则 'submit()' 会先撞上 this.submit() 那种调用点。 */
function methodBody(src, name) {
  const m = new RegExp(`^\\s*${name}\\(`, 'm').exec(src)
  assert.ok(m, `找不到方法定义 ${name}(`)
  return bodyFrom(src.slice(m.index), `${name}(`)
}

test('规则只有一份:入口不自己写身份证校验,只调共享 util', () => {
  assert.match(read(UTIL), /require\('\.\/form-state\.js'\)/,
    '身份证校验要用 form-state 里的 GB11643 实现,与后端 IdCardUtils 同口径')
  for (const key of Object.keys(ENTRY)) {
    const { js } = ENTRY[key]
    const src = read(js)
    assert.match(src, /require\('[^']*utils\/publisher-identity\.js'\)/,
      `${js} 必须引用共享 util,规则不许在页面里重写一遍`)
    assert.match(src, /publisherIdentity\.(checkIdentityForm|identitySatisfied)\(/,
      `${js} 必须用 util 的校验判定`)
    assert.doesNotMatch(src, /isValidIdCard/,
      `${js} 不得自己拿身份证校验位,那会在四处各写一套`)
  }
  const scene = read(SCENE_JS)
  assert.match(scene, /require\('[^']*utils\/publisher-identity\.js'\)/)
  assert.doesNotMatch(scene, /isValidIdCard/)
})

test('单独同意永不默认勾选(四个入口)', () => {
  for (const key of Object.keys(ENTRY)) {
    const { js, consentKey } = ENTRY[key]
    assert.match(read(js), new RegExp(`${consentKey}:\\s*false`),
      `${js} 的同意勾选初始值必须是 false —— 个保法 §29 不允许默认同意`)
  }
  const scene = read(SCENE_JS)
  for (const sceneId of ['merchant-apply', 'club-apply']) {
    const line = scene.split('\n').find((l) => l.includes(`sceneId === '${sceneId}'`) && l.includes('return {'))
    assert.ok(line && /consented:\s*false/.test(line),
      `scene-route-content 的 ${sceneId} 初始表单 consented 必须是 false`)
    assert.ok(line && /realName:\s*''\s*,\s*idCard:\s*''/.test(line),
      `scene-route-content 的 ${sceneId} 初始表单要带空的实名两格`)
  }
})

test('PII 只走 /api/publisher/identity,不混进业务单', () => {
  const util = read(UTIL)
  // 两个路径必须是调用点字面量:提成常量会让 UI-GATE-0 的 U1 把它们当成
  // 「运行时变量请求路径」,后端 Mapping 从此核不到(2026-09-19 首跑就被判红)。
  assert.match(util, /url:\s*'\/api\/publisher\/identity'/)
  assert.match(util, /url:\s*'\/api\/publisher\/identity\/status'/)
  // fabu:实名三格挂在页面 data 上而不是 formData 上,主题保存单里不许出现它们
  const fabu = read(ENTRY.fabu.js)
  assert.doesNotMatch(fabu, /formData\.(realName|idCard)\b/,
    'fabu 不得把姓名/身份证号放进 formData —— 那会随主题保存单上行')
  assert.doesNotMatch(read(ENTRY.fabu.wxml), /formData\.identity|formData\.realName|formData\.idCard/)
  // scene 副本:两个业务写单都要显式剥掉实名三格
  const scene = read(SCENE_JS)
  const writeReqs = scene.split('\n').filter((l) => /merchant_registration|become-leader/.test(l) && /url:/.test(l))
  assert.equal(writeReqs.length, 2, '场景副本应只有商家入驻、主理人申请两个业务写单')
  for (const line of writeReqs) {
    assert.match(line, /withoutIdentity\(form\)/,
      '场景副本的业务单必须剥掉 realName/idCard/consented,merchant_registration 带 @Log 会把参数明文写进 sys_oper_log')
  }
  assert.match(scene, /IDENTITY_FORM_FIELDS\s*=\s*\[\s*'realName',\s*'idCard',\s*'consented'\s*\]/)
})

test('已登记的人不再给填字段的入口:改绑走人工', () => {
  assert.match(read(UTIL), /ALREADY_REGISTERED_HINT\s*=\s*'已登记[^']*客服/,
    '已登记提示必须写明变更走人工客服')
  assert.match(read(UTIL), /CONSENT_TEXT\s*=\s*'同意向城瘾提供真实姓名与身份证号/)
  // 平台没有三要素通道,任何一处都不许写「已实名认证」
  for (const file of [UTIL, ...Object.values(ENTRY).flatMap((e) => [e.js, e.wxml]), SCENE_JS, SCENE_WXML]) {
    assert.doesNotMatch(read(file), /实名认证/, `${file} 不得出现「实名认证」用词`)
  }
  for (const key of ['club', 'merchant', 'fabu']) {
    const wxml = read(ENTRY[key].wxml)
    const gate = /wx:if="\{\{!\s*identityRegistered\}\}"/.exec(wxml)
    assert.ok(gate, `${ENTRY[key].wxml} 的实名表单必须整体收在 !identityRegistered 里`)
    assert.match(wxml.slice(gate.index), /realName|identityRealName|idCard|identityIdCard/,
      `${ENTRY[key].wxml} 的实名两格必须在那道 wx:if 之后`)
  }
  const sceneWxml = read(SCENE_WXML)
  assert.equal((sceneWxml.match(/wx:if="\{\{!\s*identityRegistered\}\}"/g) || []).length, 2,
    '场景副本两处(商家/主理人)都要有 !identityRegistered 收口')
})

test('时序:实名登记先落,业务写后发(三入口 + 场景副本)', () => {
  // 主理人:become-leader 全页只有一个发点,且只能在实名之后两条路径上被调用
  const clubJs = read(ENTRY.club.js)
  const clubSend = methodBody(clubJs, 'sendLeaderApply')
  assert.match(clubSend, /url:\s*'\/api\/club\/become-leader'/, '主理人业务单必须收在 sendLeaderApply 内')
  assert.equal((clubJs.match(/'\/api\/club\/become-leader'/g) || []).length, 1,
    'become-leader 只能有一个发点,多一处就有人绕过实名')
  assert.match(clubJs, /if \(this\.data\.identityRegistered\) \{ this\.sendLeaderApply\(/,
    '已登记的人跳过实名这一发,但也不能提前并发')
  const clubSubmit = methodBody(clubJs, 'submit')
  assert.match(clubSubmit, /publisherIdentity\.registerIdentity\(this\.identityForm\(\)/,
    '主理人申请必须先登记实名')
  const cb = bodyFrom(clubSubmit, 'function (r) {')
  assert.match(cb, /if \(!r\.ok\)[\s\S]*?return;\s*\}\s*[\s\S]*?\.sendLeaderApply\(/,
    '主理人业务单只能在实名登记成功之后发,失败必须就地拦下')

  const merchantJs = read(ENTRY.merchant.js)
  // 2026-09-19 合流远端 staleness 闸:续跑必须带发起时的 identityTicket/submitEpoch,裸调等于绕过「切过账号就不落单」。
  assert.match(merchantJs, /if \(d\.identityRegistered\) \{ this\.sendRegistration\(identityTicket, submitEpoch\); return; \}/)
  const merchantSubmit = methodBody(merchantJs, 'submit')
  const mcb = bodyFrom(merchantSubmit, 'function (r) {')
  assert.match(mcb, /if \(!r\.ok\)[\s\S]*?return;\s*\}\s*[\s\S]*?\.sendRegistration\(identityTicket, submitEpoch\)/,
    '商家入驻单只能在实名登记成功之后发')
  assert.match(mcb, /submitEpoch !== that\._submitEpoch \|\| !that\.isIdentityTicketCurrent\(identityTicket\)/,
    '实名登记回来那一发也要过同一道 staleness 闸')
  assert.doesNotMatch(methodBody(merchantJs, 'sendRegistration'), /realName|idCard/,
    '商家入驻单里不得带姓名/身份证号')

  const fabuJs = read(ENTRY.fabu.js)
  const confirm = methodBody(fabuJs, 'confirmPublishCheck')
  assert.match(confirm, /if \(this\.data\.publishCheck\.blocking\.length \|\| !this\.data\.identityReady\) return;/,
    '实名不齐时「确认发布」必须直接 return')
  assert.match(confirm, /publisherIdentity\.registerIdentity\(this\.identityForm\(\)/)
  assert.doesNotMatch(confirm, /this\.submitForm\(\)/,
    'fabu 真正的发布动作只能待在 _publishAfterIdentity 里')
  assert.match(methodBody(fabuJs, '_publishAfterIdentity'), /this\.submitForm\(\)/)

  const scene = read(SCENE_JS)
  assert.match(scene, /if \(\(sceneId === 'club-apply' \|\| sceneId === 'merchant-apply'\) && !this\.data\.identityRegistered\) \{/,
    '场景副本要先拦一道实名')
  const first = methodBody(scene, 'submitIdentityFirst')
  assert.match(first, /publisherIdentity\.checkIdentityForm\(identityForm\)/,
    '场景副本提交前也要过同一份规则')
  const again = bodyFrom(first, '(result) => {')
  assert.match(again, /identityRegistered: true[\s\S]*?this\.submitForm\(\)/,
    '登记成功后重走 submitForm,此时第二遍只落业务单')
})

test('发布弹层:实名没齐时确认键置灰且会说话', () => {
  const wxml = read(ENTRY.fabu.wxml)
  const btn = /<cy-btn[^>]*bindtap="confirmPublishCheck"[^>]*>/.exec(wxml)
  assert.ok(btn, '找不到「确认发布」按钮')
  assert.match(btn[0], /disabled="\{\{!!publishCheck\.blocking\.length \|\| !identityReady\}\}"/,
    '实名不齐时确认发布必须置灰')
  assert.match(btn[0], /bind:disabledtap="onPublishCheckDisabledTap"/,
    '置灰键要点得动并说出缺什么(置灰键会说话)')
  assert.match(wxml, /wx:if="\{\{publishCheck\.blocking\.length \|\| !identityReady\}\}"/,
    '必填项区块要把「发布者实名未填写」也列进阻断')
})

// 负控只在内存里改串再验判定,绝不回写源文件(测试进程被杀也不能留下半个页面)
test('negative control:摘掉任一入口的实名闸必须判红', () => {
  const checks = [
    {
      file: ENTRY.club.js,
      anchor: /publisherIdentity\.registerIdentity\(this\.identityForm\(\)/,
      assert: (src) => assert.match(methodBody(src, 'submit'), /publisherIdentity\.registerIdentity\(this\.identityForm\(\)/),
    },
    {
      file: ENTRY.merchant.js,
      anchor: /if \(d\.identityRegistered\) \{ this\.sendRegistration\(identityTicket, submitEpoch\); return; \}/,
      assert: (src) => assert.match(src, /if \(d\.identityRegistered\) \{ this\.sendRegistration\(identityTicket, submitEpoch\); return; \}/),
    },
    {
      file: ENTRY.fabu.js,
      anchor: /if \(this\.data\.publishCheck\.blocking\.length \|\| !this\.data\.identityReady\) return;/,
      assert: (src) => assert.match(methodBody(src, 'confirmPublishCheck'), /!this\.data\.identityReady\) return;/),
    },
    {
      file: SCENE_JS,
      anchor: /withoutIdentity\(form\)/g,
      assert: (src) => assert.match(/'club-apply':\s*\{[^\n]*become-leader[^\n]*\}/.exec(src)[0], /withoutIdentity\(form\)/),
    },
    {
      file: ENTRY.fabu.wxml,
      anchor: /!identityReady/g,
      assert: (src) => assert.match(/<cy-btn[^>]*bindtap="confirmPublishCheck"[^>]*>/.exec(src)[0], /!identityReady/),
    },
  ]
  for (const { file, anchor, assert: check } of checks) {
    const original = read(file)
    const mutated = original.replace(anchor, '')
    assert.notEqual(mutated, original, `负控锚点失效:${file} 里找不到 ${anchor}`)
    assert.throws(() => check(mutated), assert.AssertionError, `摘掉 ${file} 的实名闸却没有判红`)
    check(original)
  }
})
