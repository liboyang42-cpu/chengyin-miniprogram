// F22:官方活动详情的可读性 / 任务说明 / 奖励承诺(F22 P2,报告 40–47)。
//  ① 事实栏(参与/我的进度/活动周期)在浅色表面上用了首页深色区的白字 ⇒ 肉眼难辨;
//  ② description 为空时 .od-task-sub 直接渲染 missionType 枚举(如 THEME_VERIFIED_FINISH);
//  ③ rewardJson={} 时仍承诺「参与即有惊喜」「完成活动任务可获得页面所示奖励」。
// 只做前端展示修复:不改后端、不改暂停/退场政策。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE = '../../pages/activity/official-detail/index.js'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const JS = read('pages/activity/official-detail/index.js')
const WXML = read('pages/activity/official-detail/index.wxml')
const WXSS = read('pages/activity/official-detail/index.wxss')
const TOKENS = read('style/tokens.wxss')
const MERCHANT_LIGHT = read('style/merchant-light.wxss')

function rule(source, selector) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const bodies = []
  for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = match[1].split(',').map((s) => s.trim())
    if (selectors.includes(selector)) bodies.push(match[2])
  }
  return bodies.join('\n')
}

// ── ① 可读性:事实栏文字必须用主题文字 token,不再用首页深色区白字 ──────────────
test('F22 可读性:事实栏不得再用首页深色区的浅色文字变量', () => {
  assert.doesNotMatch(rule(WXSS, '.od-facts'), /--cy-color-home-upcoming/, '事实栏底色是浅色表面,不能用深色区白字')
  assert.match(rule(WXSS, '.od-fact-value'), /color:\s*var\(--cy-color-text-primary\)/, '主数值要用主题主文字')
  assert.match(rule(WXSS, '.od-fact-label'), /color:\s*var\(--cy-color-text-secondary\)/, '标签要用主题次文字')
  assert.match(rule(WXSS, '.od-fact-sub'), /color:\s*var\(--cy-color-text-secondary\)/, '副标要用主题次文字')
})

// 两身份(玩家暗档 / 商家浅档)token 都要达标。用 WCAG 对比度直接算,不靠肉眼。
function tokenValue(src, name) {
  const m = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*([^;]+);').exec(src)
  return m ? m[1].trim() : null
}
function hexToRgb(hex) {
  const h = String(hex).trim().replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
function relLum([r, g, b]) {
  const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a, b) {
  const la = relLum(hexToRgb(a)); const lb = relLum(hexToRgb(b))
  const hi = Math.max(la, lb); const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

test('F22 可读性:两身份 token 下事实栏文字对比度都达标(≥4.5)', () => {
  const themes = [
    { name: '玩家暗档(tokens)', src: TOKENS },
    { name: '商家浅档(merchant-light)', src: MERCHANT_LIGHT },
  ]
  for (const theme of themes) {
    const bg = tokenValue(theme.src, '--cy-color-bg-surface-strong')
    const primary = tokenValue(theme.src, '--cy-color-text-primary')
    const secondary = tokenValue(theme.src, '--cy-color-text-secondary')
    assert.ok(bg && primary && secondary, `${theme.name} 缺少事实栏用到的 token`)
    assert.ok(contrast(primary, bg) >= 4.5, `${theme.name} 主数值对比度 ${contrast(primary, bg).toFixed(2)} < 4.5`)
    assert.ok(contrast(secondary, bg) >= 4.5, `${theme.name} 次文字对比度 ${contrast(secondary, bg).toFixed(2)} < 4.5`)
  }
})

test('F22 负控:浅色表面上用首页白字必须判红', () => {
  const lightBg = tokenValue(MERCHANT_LIGHT, '--cy-color-bg-surface-strong') // #E4E4E4
  const homeWhite = tokenValue(TOKENS, '--cy-color-home-upcoming-text') // #FFFFFF
  assert.ok(contrast(homeWhite, lightBg) < 4.5, '白字压浅灰本就不可读 —— 负控前提成立')
})

// ── ② 任务说明:description 为空时按 missionType 给准确中文,未知类型明说规则未提供 ──
let pageConfig
global.getApp = () => ({ sendRequest: () => {}, globalData: {} })
global.wx = { getStorageSync: () => '', setStorageSync: () => {}, showToast: () => {} }
global.Page = (config) => { pageConfig = config }

function loadPage() {
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = function (patch) {
    Object.keys(patch).forEach((key) => { if (!key.includes('.')) this.data[key] = patch[key] })
  }
  return page
}

function v2Event(missions) {
  return { contractVersion: 2, status: 3, title: '官方活动', rewardJson: '{}', missions }
}

test('F22 任务说明:支持类型给准确中文;后端禁发布类型如实标未支持,不裸露枚举', () => {
  const page = loadPage()
  const e = page._decorate(v2Event([
    { missionCode: 'm1', missionType: 'ROAM_POI_ARRIVAL', title: '', description: '' },
    { missionCode: 'm2', missionType: 'EVENT_POINT_ARRIVAL', title: '', description: '' },
    { missionCode: 'm3', missionType: 'THEME_VERIFIED_FINISH', title: '', description: '' },
    { missionCode: 'm4', missionType: 'ROAM_SESSION_AREA', title: '', description: '' },
  ]))

  const byType = {}
  e.missions.forEach((m) => { byType[m.missionType] = m })
  // 后端 validatePublishMission 明确 block 这两类(ROAM_SESSION_AREA P1 禁发 / ROAM_POI_ARRIVAL 未过 Gate0),
  // 且 missionComplete 对 ROAM_POI_ARRIVAL 恒 false —— 不能编造核验路径,如实标未支持。
  assert.equal(byType.ROAM_POI_ARRIVAL._supported, false, 'ROAM_POI_ARRIVAL 目前未支持')
  assert.equal(byType.ROAM_SESSION_AREA._supported, false, 'ROAM_SESSION_AREA 目前未支持')
  assert.match(byType.ROAM_POI_ARRIVAL._descText, /暂不支持|未支持/, 'ROAM_POI_ARRIVAL 要如实标未支持')
  assert.match(byType.ROAM_SESSION_AREA._descText, /暂不支持|未支持/, 'ROAM_SESSION_AREA 要如实标未支持')
  // 有真实核验路径的类型保留准确中文
  assert.equal(byType.EVENT_POINT_ARRIVAL._supported, true)
  assert.match(byType.EVENT_POINT_ARRIVAL._descText, /点位/, 'EVENT_POINT_ARRIVAL 要有准确中文')
  assert.equal(byType.THEME_VERIFIED_FINISH._supported, true)
  assert.match(byType.THEME_VERIFIED_FINISH._descText, /主题/, 'THEME_VERIFIED_FINISH 要有准确中文')
  e.missions.forEach((m) => {
    assert.doesNotMatch(m._descText, /^[A-Z_]+$/, '不得裸露 missionType 枚举: ' + m._descText)
    assert.ok(m._titleText && !/^[A-Z_]+$/.test(m._titleText), '标题不得为空或枚举')
  })
})

test('F22 任务说明:未知类型明说规则未提供,不臆造完成条件', () => {
  const page = loadPage()
  const e = page._decorate(v2Event([
    { missionCode: 'x1', missionType: 'SOME_NEW_TYPE', title: '', description: '' },
  ]))
  assert.match(e.missions[0]._descText, /规则未提供|以主办方/, '未知类型要清楚提示规则未提供')
  assert.doesNotMatch(e.missions[0]._descText, /SOME_NEW_TYPE/, '不得裸露未知枚举')
})

test('F22 任务说明:有 description 时如实使用,不覆盖作者文案', () => {
  const page = loadPage()
  const e = page._decorate(v2Event([
    { missionCode: 'm1', missionType: 'THEME_VERIFIED_FINISH', title: '作者标题', description: '作者写的行动说明' },
  ]))
  assert.equal(e.missions[0]._descText, '作者写的行动说明')
  assert.equal(e.missions[0]._titleText, '作者标题')
})

// ── ③ 奖励:无配置/坏数据不得承诺;有配置按实际展示 ────────────────────────────
test('F22 奖励:rewardJson={} 时不得承诺「参与即有惊喜」或页面所示奖励', () => {
  const page = loadPage()
  assert.deepEqual(page._rewards({ rewardJson: '{}' }), [], '空配置不得造出默认奖励')
  assert.deepEqual(page._rewards({ rewardJson: '' }), [], '无 rewardJson 不得造奖励')
  assert.deepEqual(page._rewards({}), [], '缺字段不得造奖励')
  assert.doesNotMatch(JS, /参与即有惊喜/, '默认承诺必须删除')
  assert.doesNotMatch(WXML, /参与即有惊喜/)
  assert.doesNotMatch(WXML, /完成活动任务可获得页面所示奖励/, '无配置时不能承诺页面所示奖励')
})

test('F22 奖励:坏 JSON 不得被当成有奖', () => {
  const page = loadPage()
  assert.deepEqual(page._rewards({ rewardJson: '{坏掉的' }), [], '坏 JSON 按无奖处理')
  assert.deepEqual(page._rewards({ rewardJson: '[1,2,3]' }), [], '非对象按无奖处理')
})

test('F22 奖励:有配置时展示实际数量与类型', () => {
  const page = loadPage()
  const list = page._rewards({ rewardJson: JSON.stringify({ settleXp: 50, settleBadge: true, settleCouponId: 9, collectiveCouponId: 3 }) })
  assert.ok(list.some((s) => /50/.test(s) && /成长值/.test(s)), '成长值要带实际数量')
  assert.ok(list.some((s) => /徽章/.test(s)), '徽章要如实展示')
  assert.ok(list.some((s) => /券/.test(s)), '券要如实展示')
  assert.equal(list.length, 4)
})

test('F22 奖励:settleXp=0 / 假值不得凭空造奖励', () => {
  const page = loadPage()
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleXp: 0, settleBadge: false }) }), [])
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleXp: '0' }) }), [])
})

test('F22 奖励:模板只在确有奖励时展示,无奖时如实说明', () => {
  assert.match(WXML, /wx:if="\{\{rewards\.length\}\}"/, '奖励列表/提示要按实际配置开关')
  assert.match(WXML, /未配置奖励|没有配置奖励/, '无奖时要如实表达')
})

// ── P2-1 奖励逐字段正整数校验(后端契约:couponId=long / settleXp=int,fastjson 收数字字符串)──
test('F22 P2 奖励:逐字段正整数校验,负数/字符串0/对象/数组/Infinity/小数都不算奖励', () => {
  const page = loadPage()
  const bad = [
    { settleCouponId: -3 }, { settleCouponId: 0 }, { settleCouponId: '0' },
    { settleCouponId: 1.5 }, { settleCouponId: '1.5' }, { settleCouponId: 'abc' },
    { settleCouponId: {} }, { settleCouponId: [] }, { settleCouponId: true }, { settleCouponId: '   ' },
    { collectiveCouponId: -1 }, { collectiveCouponId: '0' }, { collectiveCouponId: {} }, { collectiveCouponId: [] },
    { settleXp: -5 }, { settleXp: 0 }, { settleXp: '0' }, { settleXp: 2.5 }, { settleXp: '2.5' },
    { settleXp: {} }, { settleXp: [] }, { settleXp: 'abc' },
  ]
  bad.forEach((rw) => {
    assert.deepEqual(page._rewards({ rewardJson: JSON.stringify(rw) }), [], '非法配置不得算奖励: ' + JSON.stringify(rw))
  })
  assert.deepEqual(page._rewards({ rewardJson: '{"settleXp": 1e999}' }), [], 'Infinity 不得算奖励')
})

test('F22 P2 奖励:合法字符串数字配置不得被误删', () => {
  const page = loadPage()
  const list = page._rewards({ rewardJson: JSON.stringify({ settleCouponId: '9', settleXp: '50', collectiveCouponId: '3' }) })
  assert.equal(list.length, 3, '合法数字字符串要照常展示')
  assert.ok(list.some((s) => /50/.test(s) && /成长值/.test(s)), '字符串 50 要显示为成长值')
  assert.ok(list.some((s) => /券/.test(s)), '字符串 couponId 要显示为券')
})

test('F22 P2 奖励:单项非法只丢该项,合法项仍保留', () => {
  const page = loadPage()
  const list = page._rewards({ rewardJson: JSON.stringify({ settleCouponId: -9, settleXp: 50, collectiveCouponId: {} }) })
  assert.equal(list.length, 1)
  assert.ok(/50/.test(list[0]) && /成长值/.test(list[0]))
})

// ── P2-2 后端禁发布任务:如实标未支持,不给假路径,不静默 ─────────────────────
test('F22 P2 任务说明:未支持类型不得给出「去验证/自动同步」假路径', () => {
  assert.match(WXML, /_supported/, '动作标签要按支持性区分')
  assert.match(WXML, /暂不支持/, '未支持类型要有明确标记')
})

test('F22 P2 任务说明:点后端禁发布任务给明确提示,不静默也不误触发报名', () => {
  const page = loadPage()
  const toasts = []
  global.wx.showToast = (o) => { toasts.push(o && o.title) }
  let signupCalls = 0
  page.doSignup = () => { signupCalls += 1 }
  const e = page._decorate(v2Event([
    { missionCode: 'm1', missionType: 'ROAM_POI_ARRIVAL', title: '', description: '', complete: false, canVerifyArrival: false },
  ]))
  page.data.e = e

  page.onMissionTap({ currentTarget: { dataset: { code: 'm1' } } })

  assert.ok(toasts.some((t) => /暂不支持/.test(String(t))), '必须给明确提示')
  assert.equal(signupCalls, 0, '未支持任务不能误触发报名')
})

// ── P2-3 集体券不是无条件全员:文案与可用性要准确,个人券/成长值不得被误隐藏 ─────
test('F22 P2 奖励:集体券文案含真实条件(全城达标 + 完成全部任务)', () => {
  const page = loadPage()
  const enabled = page._rewards({
    rewardJson: JSON.stringify({ collectiveCouponId: 3 }),
    collective: { enabled: true, threshold: 10, current: 3 },
  })
  assert.equal(enabled.length, 1)
  assert.match(enabled[0], /全城达标|达标/, '要写明达标条件')
  assert.match(enabled[0], /完成全部任务|全部任务/, '要写明个人完成条件')
})

test('F22 P2 奖励:集体未开启时如实说明不可得,个人券与成长值仍照常展示', () => {
  const page = loadPage()
  const list = page._rewards({
    rewardJson: JSON.stringify({ settleCouponId: 9, settleXp: 50, collectiveCouponId: 3 }),
    collective: { enabled: false },
  })
  assert.equal(list.length, 3, '个人券/成长值/集体券都要在,不能因集体未开启被隐藏')
  assert.ok(list.some((s) => /成长值/.test(s) && /50/.test(s)), '成长值必须保留')
  assert.ok(list.some((s) => /券/.test(s) && !/集体/.test(s)), '个人券必须保留')
  const collective = list.find((s) => /集体/.test(s))
  assert.match(collective, /未开启|不可得/, '集体未开启要如实说明')
})

// ── P2-1b 范围:XP=int(1..2147483647);couponId/collectiveCouponId=long(1..9223372036854775807)──
test('F22 P2 奖励:couponId 是 Java Long,合法大十进制字符串不得被 Number 精度吃掉', () => {
  const page = loadPage()
  // 9007199254740993 > 2^53,先 Number 会变成 ...992;必须按字符串判范围。
  const list = page._rewards({ rewardJson: JSON.stringify({ settleCouponId: '9007199254740993', collectiveCouponId: '9223372036854775807' }) })
  assert.equal(list.length, 2, 'Long 范围内的合法字符串必须保留')
})

test('F22 P2 奖励:Long 超界字符串不得算奖励', () => {
  const page = loadPage()
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleCouponId: '9223372036854775808' }) }), [])
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ collectiveCouponId: '9223372036854775808' }) }), [])
})

test('F22 P2 奖励:Long 前导零按十进制值判范围', () => {
  const page = loadPage()
  assert.equal(page._rewards({ rewardJson: JSON.stringify({ settleCouponId: '000000000000000000009' }) }).length, 1, '前导零的合法值要接受')
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleCouponId: '0009223372036854775808' }) }), [], '去前导零后超界要拒绝')
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleCouponId: '0' }) }), [])
})

test('F22 P2 奖励:后端合法 Long JSON 数值不能被前端解析精度隐藏', () => {
  const page = loadPage()
  for (const id of ['9007199254740992', '9007199254740993', '9223372036854775807',
    '9.007199254740993e15', '9223372036854775807.0', '0.0000000009007199254740993e25']) {
    const event = Object.assign(v2Event([]), { rewardJson: '{"settleCouponId":' + id + ',"collectiveCouponId":' + id + '}' })
    assert.equal(page._rewards(event).length, 2, '原始整数必须按 Long 范围接受: ' + id)
    assert.equal(page._decorate(event)._hasCollectiveReward, true, '进度区须使用同一事实')
  }
})

test('F22 P2 奖励:Long 原始数值超界或为负仍不承诺奖励', () => {
  const page = loadPage()
  for (const id of ['9223372036854775808', '-9223372036854775808',
    '9.223372036854775808e18', '9007199254740993.1']) {
    assert.deepEqual(page._rewards({ rewardJson: '{"settleCouponId":' + id + '}' }), [])
  }
})

test('F22 P2 奖励:保留 JSON 字符串与重复键语义，不能修好非法 JSON', () => {
  const page = loadPage()
  const note = '原文包含 "settleCouponId":9223372036854775807 和反斜线 \\ '
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ note, settleCouponId: 0 }) }), [])
  assert.deepEqual(page._rewards({ rewardJson: '{"settleCouponId":9223372036854775807,"settleCouponId":0}' }), [])
  assert.equal(page._rewards({ rewardJson: '{"settleCouponId":0,"settleCouponId":9223372036854775807}' }).length, 1)
  for (const raw of ['{"settleCouponId":09223372036854775807}', '{"settleCouponId":9223372036854775807,}']) {
    assert.deepEqual(page._rewards({ rewardJson: raw }), [], '原始非法 JSON 不得被数字处理变成有效配置')
  }
})

test('F22 P2 奖励:XP 必须 1..2147483647', () => {
  const page = loadPage()
  const ok = page._rewards({ rewardJson: JSON.stringify({ settleXp: 2147483647 }) })
  assert.equal(ok.length, 1)
  assert.ok(/2147483647/.test(ok[0]))
  assert.equal(page._rewards({ rewardJson: JSON.stringify({ settleXp: '2147483647' }) }).length, 1, '合法字符串要接受')
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleXp: 2147483648 }) }), [], 'int 超界拒绝')
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleXp: '2147483648' }) }), [], '字符串 int 超界拒绝')
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleXp: 0 }) }), [])
  assert.deepEqual(page._rewards({ rewardJson: JSON.stringify({ settleXp: -1 }) }), [])
  assert.equal(page._rewards({ rewardJson: JSON.stringify({ settleXp: '0000000042' }) }).length, 1, '前导零合法值接受')
})

// ── P2-2b 集体进度区:无集体券配置不得承诺奖励,进度区保留 ─────────────────────
test('F22 P2 集体进度区:无集体券配置不得承诺奖励,进度区必须保留', () => {
  const page = loadPage()
  const none = page._decorate(v2Event([])) // rewardJson '{}'
  assert.equal(none._hasCollectiveReward, false, '空配置不得当成有集体奖')
  const yes = page._decorate(Object.assign(v2Event([]), { rewardJson: JSON.stringify({ collectiveCouponId: '9223372036854775807' }) }))
  assert.equal(yes._hasCollectiveReward, true, '合法 Long 字符串要认')

  assert.match(WXML, /e\.collective && e\.collective\.enabled/, '集体进度区必须保留(不许删功能掩盖)')
  assert.match(WXML, /_hasCollectiveReward/, '进度区提示要按集体券配置区分')
  assert.doesNotMatch(WXML, /达标后全员解锁集体奖励/, '无配置不得无条件承诺集体奖励')
  assert.match(WXML, /未配置集体奖励|仅供了解/, '无配置要如实说明')
})

test('F22 P2 集体进度区:有配置时给出准确条件(开启+集体达标+本人有效报名且完成全部任务)', () => {
  assert.match(WXML, /开启且集体达标、本人保持有效报名并完成全部任务/, '条件要写全')
})

// ── ④ 暂停:保留暂停说明与按钮禁用(不改 F21 政策)────────────────────────────
test('F22 暂停:暂停文案保留,CTA 为不可点等待态', () => {
  const page = loadPage()
  const cta = page._cta({ status: 3, paused: true, signed: true, contractVersion: 2, missions: [] })
  assert.deepEqual(cta, { text: '活动已暂停', type: 'wait' })
  assert.match(WXML, /od-note--danger/, '暂停说明必须保留')
  assert.match(WXML, /e\.pausedReason/, '暂停原因必须展示')
})

test('F22 暂停:等待/结束态 CTA 不绑定点击(按钮禁用)', () => {
  const ctaBar = /<view class="od-cta-bar">[\s\S]*?<\/view>\s*<\/view>/.exec(WXML)
  assert.ok(ctaBar, '找不到底部动作条')
  assert.match(ctaBar[0], /wx:if="\{\{cta\.type !== 'wait' && cta\.type !== 'ended'\}\}"[\s\S]*?bindtap="onCta"/, '可点态才绑 onCta')
  assert.match(ctaBar[0], /wx:else class="od-cta \{\{cta\.type\}\}" aria-role="text"/, '等待/结束态渲染为不可点文本')
})

// 2026-09-23 CU-C-16:「完成绑定主题」任务卡看不出是哪条主题,点了也只 toast。
test('C-16 绑定主题任务:补主题名并直达主题;读不到名字有说明', () => {
  const requests = []
  const navigations = []
  const realGetApp = global.getApp
  let loggedIn = 1
  global.getApp = () => ({ sendRequest: (o) => requests.push(o), globalData: {}, getUserID: () => loggedIn })
  const page = loadPage()
  global.getApp = realGetApp
  page.setData = function (patch) {
    Object.keys(patch).forEach((key) => {
      if (key === 'e.missions') this.data.e.missions = patch[key]
      else this.data[key] = patch[key]
    })
  }
  global.wx.navigateTo = (o) => navigations.push(o.url)
  const e = page._decorate(Object.assign(v2Event([
    { missionCode: 't1', missionType: 'THEME_VERIFIED_FINISH', title: '完成探店日主题', description: '',
      binding: { bindingType: 'THEME', sourceRefId: 990028 } },
  ]), { id: 77, signed: true }))
  page.data.e = e
  page._loadBoundTopicNames(e)
  assert.equal(requests[0].url, '/api/topic/info-to-user')
  assert.deepEqual(requests[0].data, { id: 990028 })
  requests[0].success({ code: 200, data: { name: 'E2E 探店日一期' } })
  assert.equal(page.data.e.missions[0]._topicName, 'E2E 探店日一期')
  assert.match(WXML_NOW(), /绑定主题：\{\{item\._topicName\}\}/)

  page.onMissionTap({ currentTarget: { dataset: { code: 't1' } } })
  assert.deepEqual(navigations, ['/pages/topic/index/index?id=990028'])

  page._loadBoundTopicNames(e)
  requests[1].fail()
  assert.match(page.data.boundTopicError, /仍可前往/)

  loggedIn = 0
  page._loadBoundTopicNames(e)
  assert.equal(requests.length, 2, '游客不读主题名(info-to-user 要登录)')
})

function WXML_NOW() { return read('pages/activity/official-detail/index.wxml') }
