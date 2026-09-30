// C2(主题模板与商家报名)UI 第 1 轮契约。
// 只钉「本轮真的改了行为的四件事」,每条都配一个负控:把改动反向注入回去,断言精准变红。
// 纯样式改动(topic/index 音频块搬进 wxss、templatedetail 色板桥接)不在此造假测试,
// 由 scripts/ds-hardcode-gate.sh 与 tests/unit/templatedetail-theme.test.js 覆盖。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const P = (rel) => path.resolve(__dirname, '../../', rel)
const read = (rel) => fs.readFileSync(P(rel), 'utf8')

const INFO_WXML = 'pages/topic/components/project-join/index.wxml'
const INFO_JS = 'pages/topic/merchantinfo/merchantinfo.js'
const TEMPLATE_INDEX_JS = 'pages/template/index.js'
const TEMPLATE_INDEX_WXML = 'pages/template/index.wxml'
const TOPIC_INDEX_JS = 'pages/topic/index/index.js'
const TOPIC_INDEX_JSON = 'pages/topic/index/index.json'
const TOPIC_INDEX_WXML = 'pages/topic/index/index.wxml'

// —— 1. 报名流的进度点:两页必须声明同一条 FLOW_STEPS ——
// 改造前 apply1 的第 2 段叫「接待说明与现场图」、apply2 的第 2 段叫「玩法配置」,
// 同一个「第 2 步」在两屏之间换了名字 = 对用户误报流程长度。
// ⚠️ 这条钉的是「两页逐字一致 + 恰好三段」,不是那三个字面量本身。
// 2026-08-06 第三段更名「玩法配置」→「现场执行与反馈」(玩法归主办方,本页不再配玩法),
// 断言随之更新 —— 名字会变,「两页必须一致」这条约束不变。
function flowTitles(js) {
  const block = js.match(/const FLOW_STEPS = \[([\s\S]*?)\];/)
  assert.ok(block, '页面必须声明展示用的 FLOW_STEPS')
  return [...block[1].matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1])
}

function assertFlowStepsAligned(apply1Js, apply2Js) {
  const a1 = flowTitles(apply1Js)
  const a2 = flowTitles(apply2Js)
  assert.deepEqual(
    a1,
    ['承接地点与档期', '接待说明与现场图', '现场执行与反馈'],
    'merchantapply1 的进度点必须是整条报名流的三段'
  )
  assert.deepEqual(a2, a1, 'merchantapply1 与 merchantapply2 的 FLOW_STEPS 必须逐字一致')
}




// —— 2. merchantapply3 顶部主题卡:整块不存在 ——
// 原契约(2026-07-30)是「info 为空时整块不渲染」——基线截图 078 实证 info 为空时
// 「startDate - endDate」的连字符与地图图钉会裸露成孤立的「—」+ 图标。
// 2026-07-31 用户备注「这里不显示活动卡片」⇒ 这张卡整块删除,带/不带 topicId 两条
// 路径的落地页统一为「✓ 提交成功文案 + 两个按钮」。
// ★改锚不是放宽:原失败模式(裸露的孤立连字符/图钉)只可能由这张卡产生,卡不存在则
//   该模式结构性不可复现;这里把断言从「卡必须被守住」换成更强的「卡不得存在,且本页
//   不得再出现任何 info.* 绑定」,顺带钉死"不许悄悄加回来"。
function assertApply3HasNoTopicCard(wxml) {
  assert.doesNotMatch(wxml, /class="davidtop/, 'merchantapply3 不得再有顶部主题卡(davidtop 一族)')
  assert.doesNotMatch(wxml, /\{\{[^}]*\binfo\./, 'merchantapply3 不得再绑定 info.*(主题详情已无展示位)')
}




// —— 3. merchantinfo 核销统计:数值默认 0，零值不再重复解释 ——
// CU-C-123 删除「数字为 0 是正常的」常驻句；保留数字、业务标签和核销动作。
function metricDefaultLine(js, key) {
  const line = js.split('\n').find((l) => l.includes(`${key}:`) && /:\s*0,/.test(l))
  assert.ok(line, `merchantinfo 的 ${key} 必须有默认值兜底`)
  return line
}

function assertMetricsDefaultToZero(js) {
  ;['pendingCount', 'verifiedCount', 'totalCount'].forEach((key) => metricDefaultLine(js, key))
}

function assertZeroMetricsWithoutRedundantExplanation(wxml) {
  for (const key of ['pendingCount', 'verifiedCount', 'totalCount']) {
    assert.ok(wxml.includes('{{ ' + key + ' }}'), key + ' 数值位必须保留');
  }
  assert.doesNotMatch(wxml, /数字为 0 是正常的/, '零值不再重复解释');
}

test('C2:merchantinfo 核销数值位都有默认值兜底,不会渲染成 undefined', () => {
  assertMetricsDefaultToZero(read(INFO_JS))
})

test('C2 负控:去掉 verifiedCount 默认值时,由数值位兜底这道闸判红', () => {
  const mutated = read(INFO_JS).replace('verifiedCount: 0,', 'verifiedCount: undefined,')
  assert.throws(() => assertMetricsDefaultToZero(mutated), /verifiedCount 必须有默认值兜底/)
})

test('C2:merchantinfo 保留零值指标，不常驻重复解释', () => {
  assertZeroMetricsWithoutRedundantExplanation(read(INFO_WXML))
})

test('C2 负控:恢复零值重复解释或删除指标数值时判红', () => {
  const wxml = read(INFO_WXML)
  const restored = wxml + '<view class="sec-empty" wx:if="{{ totalCount === 0 }}">数字为 0 是正常的</view>'
  assert.throws(() => assertZeroMetricsWithoutRedundantExplanation(restored), /零值不再重复解释/)
  const missingMetric = wxml.replace('{{ totalCount }}', '')
  assert.notEqual(missingMetric, wxml, '负控必须命中总人数数值位')
  assert.throws(() => assertZeroMetricsWithoutRedundantExplanation(missingMetric), /totalCount 数值位必须保留/)
})

// —— 5. merchantapply2 只读回显:同一张卡不得两套空值策略 ——

// —— 6. template/index 封面失败:必须呈现真实失败态,不得拿别的内容图冒充封面 ——
// 真机复拍实证:远端封面失败后,卡片会出现巨大的「霓 / 城 / 亲」首字。
// 失败态要复用已有的 no_data 图标并明确说「封面暂不可用」；不能换一张城市路线图
// 冒充当前模板的内容封面。当前头牌与列表卡两个远端封面位都要接住 binderror。
function assertTemplateCoverErrorState(js, wxml) {
  assert.ok(
    fs.existsSync(P('images/no_data.svg')),
    '封面失败图片资产必须真实存在于小程序包内'
  )
  assert.match(
    js,
    /coverErrorSrc:\s*'\/images\/no_data\.svg'/,
    '封面失败必须使用仓库内现有的 no_data.svg 失败态图标'
  )
  assert.doesNotMatch(js, /home-route-city-placeholder\.jpg/, '城市路线图不能冒充模板封面')

  // 2026-08-26:banner 变成单张头牌(走 onDetailCoverError 的稳定身份分支),
  // 列表卡的封面 <image> 因为前面多了「具象图标位」而降为 wx:elif。
  // 守的不变量一条没少:两处远端封面都必须有 binderror + 明确失败态。
  const remoteCoverBranches = [
    { name: '头牌 banner', cls: 'feat-bgimg', condition: 'banner.imgUrl && !banner._coverFail', handler: 'onDetailCoverError' },
    { name: '列表卡', cls: 'cml-pic', condition: 'item.imgUrl && !item._coverFail', handler: 'onCoverError' },
  ]
  remoteCoverBranches.forEach(({ name, cls, condition, handler }) => {
    const remote = new RegExp(`<image wx:(?:if|elif)="\\{\\{ ${condition.replace(/[.]/g, '\\.')} \\}\\}"[^>]*class="${cls}"[^>]*binderror="${handler}"`, 's')
    assert.match(wxml, remote, `${name} 的非空远端封面必须有 binderror 失败路径`)
    const fallback = new RegExp(`<view wx:else[^>]*class="${cls} cover-error"[^>]*aria-role="img"[^>]*>[\\s\\S]*?<image[^>]*class="cover-error-icon"[^>]*src="\\{\\{ coverErrorSrc \\}\\}"[^>]*>[\\s\\S]*?<text class="cover-error-text">封面暂不可用<\\/text>`, 's')
    assert.match(wxml, fallback, `${name} 必须切到带明确文案的真实封面失败态`)
  })
  assert.match(
    js,
    /onDetailCoverError\(e\) \{[\s\S]*?target !== 'banner'[\s\S]*?\[`\$\{target\}\._coverFail`\]: true/,
    '头牌 banner 的 error 事件必须只写白名单对象的失败标记'
  )
  assert.doesNotMatch(wxml, /cover-fb-letter/, '封面失败态不得保留首字文本占位')
}

test('C2:P1 template/index 两处远端封面失败时使用明确的真实失败态', () => {
  assertTemplateCoverErrorState(read(TEMPLATE_INDEX_JS), read(TEMPLATE_INDEX_WXML))
})

test('C2:P1 负控:把失败态资产改为空值时,由封面失败态守卫精准判红', () => {
  const mutated = read(TEMPLATE_INDEX_JS).replace(
    "coverErrorSrc: '/images/no_data.svg'",
    "coverErrorSrc: ''"
  )
  assert.throws(
    () => assertTemplateCoverErrorState(mutated, read(TEMPLATE_INDEX_WXML)),
    /仓库内现有的 no_data\.svg/
  )
})

test('C2:P1 负控:摘掉列表卡的 binderror 时,由两处远端封面守卫精准判红', () => {
  const mutated = read(TEMPLATE_INDEX_WXML).replaceAll(
    'data-key="{{ item.id }}" binderror="onCoverError"',
    'data-key="{{ item.id }}"'
  )
  assert.throws(
    () => assertTemplateCoverErrorState(read(TEMPLATE_INDEX_JS), mutated),
    /列表卡 的非空远端封面必须有 binderror/
  )
})

// —— 7. topic/index 缺参:不得请求空 id 或继续渲染黑色详情骨架 ——
function onLoadBlock(js, pageName) {
  const match = /onLoad(?:\s*:\s*function)?\s*\(options\)\s*\{/.exec(js)
  const start = match && match.index
  const end = [js.indexOf('\n  /**', start), js.indexOf('\n  onShow', start)]
    .filter((index) => index > start)
    .sort((a, b) => a - b)[0]
  assert.ok(start >= 0 && end > start, `${pageName} 必须保留可分析的 onLoad`)
  return js.slice(start, end)
}

function withPageModule(rel, app, wx, run) {
  const previousPage = global.Page
  const previousGetApp = global.getApp
  const previousWx = global.wx
  let pageConfig = null
  global.Page = (config) => { pageConfig = config }
  global.getApp = () => app
  global.wx = wx
  const pagePath = P(rel)
  delete require.cache[require.resolve(pagePath)]
  try {
    require(pagePath)
    assert.ok(pageConfig, `${rel} 必须注册 Page`)
    return run(pageConfig)
  } finally {
    delete require.cache[require.resolve(pagePath)]
    global.Page = previousPage
    global.getApp = previousGetApp
    global.wx = previousWx
  }
}

function instantiatePage(pageConfig) {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

function assertTopicMissingIdGuard(js, wxml) {
  const onLoad = onLoadBlock(js, 'topic/index')
  assert.match(js, /topicLoaded:\s*false/, 'topic/index 必须独立记录是否已拿到可渲染详情')
  assert.match(onLoad, /const topicId = Number\(options\.id\);/, 'topic/index 必须先规范化主题 id')
  assert.match(
    onLoad,
    /const validTopicId = Number\.isFinite\(topicId\) && Number\.isInteger\(topicId\) && topicId > 0;/,
    'topic/index 只接受有限正整数主题 id'
  )
  assert.match(onLoad, /if \(!validTopicId\) \{[\s\S]*?missingTopicId:\s*true[\s\S]*?topicLoaded:\s*false[\s\S]*?return;/, '缺少或非法主题 id 时必须进入明确的缺参态并停止加载')
  assert.ok(onLoad.indexOf('if (!validTopicId)') < onLoad.indexOf('that.getData()'), '缺参守卫必须在详情请求之前执行')
  assert.match(
    wxml,
    /<cy-empty wx:if="\{\{\s*missingTopicId\s*\}\}"[^>]*kind="missing-param"[^>]*cta="返回发布广场"[^>]*bind:cta="goTopicList"/,
    '缺参态必须有可读说明和有效的返回发布广场 CTA'
  )
  assert.match(wxml, /<view class="topic-state" wx:if="\{\{\s*loadError\s*\}\}"[^>]*>/, '加载失败必须直接显示错误态，不能被旧 info 遮住')
  assert.match(
    wxml,
    /<view class="topic-state" wx:if="\{\{\s*loadError\s*\}\}" style="padding-top: \{\{ statusBarHeight \+ navBarHeight \+ 32 \}\}px;">/,
    '错误态必须为 fixed 顶栏按真实状态栏和导航高度让位'
  )
  assert.match(wxml, /<block wx:if="\{\{\s*!loadError && topicLoaded\s*\}\}">/, '失败或缺参时不得继续渲染详情正文骨架')
  const getData = /getData: function \(\) \{[\s\S]*?\n  \},\n\n  \/\/ 详情加载失败重试/.exec(js)
  assert.ok(getData, 'topic/index 必须保留可分析的 getData')
  assert.match(
    js,
    /function hasTopicDetail\(data\) \{[\s\S]*?typeof data === 'object'[\s\S]*?!Array\.isArray\(data\)[\s\S]*?Object\.keys\(data\)\.length > 0/,
    '详情数据必须是非空对象，空对象和数组不能冒充可渲染主题'
  )
  assert.match(getData[0], /if \(res\.code == "200"\) \{\s*if \(!hasTopicDetail\(res\.data\)\) \{[\s\S]*?topicLoaded:\s*false/, '空详情数据必须进入可见错误态，不能直接解引用')
  assert.doesNotMatch(js, /if \(res\.code == "200" && res\.data && res\.data\.id\)/, '评价成功条件不得因本任务被收紧')
  assert.match(getData[0], /info:\s*res\.data,[\s\S]*?topicLoaded:\s*true/, '成功详情必须明确标记为可渲染')
  const failedStates = getData[0].match(/loadError:\s*true,[\s\S]{0,240}?topicLoaded:\s*false/g) || []
  assert.ok(failedStates.length >= 3, '空数据、业务失败和网络失败都必须撤销 topicLoaded，避免残留空白页')
  assert.match(js, /onRetryLoad: function \(\) \{[\s\S]*?setData\(\{[^}]*topicLoaded:\s*false/, '重试时必须先撤销旧详情渲染标记')
  assert.match(
    js,
    /goTopicList\(\) \{[\s\S]*?wx\.reLaunch\(\{\s*url:\s*'\/pages\/template\/index'\s*\}\)/,
    '缺参态 CTA 必须回到一个可打开的发布广场页面'
  )
}

test('C2:P4 topic/index 缺少主题 id 时展示可返回的缺参态', () => {
  assertTopicMissingIdGuard(read(TOPIC_INDEX_JS), read(TOPIC_INDEX_WXML))
})

test('C2:P4 负控:反转 topic/index 缺参条件时,由缺参守卫精准判红', () => {
  const mutated = read(TOPIC_INDEX_JS).replace('if (!validTopicId) {', 'if (validTopicId) {')
  assert.throws(() => assertTopicMissingIdGuard(mutated, read(TOPIC_INDEX_WXML)), /缺少或非法主题 id/)
})

test('C2:P4 负控:放宽整数校验或让错误态依赖旧 info 时,守卫精准判红', () => {
  const badIdCheck = read(TOPIC_INDEX_JS).replace('Number.isInteger(topicId)', 'true')
  assert.throws(() => assertTopicMissingIdGuard(badIdCheck, read(TOPIC_INDEX_WXML)), /有限正整数/)
  const hiddenError = read(TOPIC_INDEX_WXML).replace(
    '<view class="topic-state" wx:if="{{loadError}}"',
    '<view class="topic-state" wx:if="{{loadError && !info.id}}"'
  )
  assert.throws(() => assertTopicMissingIdGuard(read(TOPIC_INDEX_JS), hiddenError), /加载失败必须直接显示错误态/)
  const coveredByTopbar = read(TOPIC_INDEX_WXML).replace(' style="padding-top: {{ statusBarHeight + navBarHeight + 32 }}px;"', '')
  assert.throws(() => assertTopicMissingIdGuard(read(TOPIC_INDEX_JS), coveredByTopbar), /fixed 顶栏/)
  const acceptsEmptyObject = read(TOPIC_INDEX_JS).replace('Object.keys(data).length > 0', 'true')
  assert.throws(() => assertTopicMissingIdGuard(acceptsEmptyObject, read(TOPIC_INDEX_WXML)), /非空对象/)
})

// —— R3. missing-param 默认已是 cy-icon info glyph（empty/index.js KIND_DEFAULTS）。
// 调用点再盖 no_data.svg 会让缺参与空态共用同一张灰色插画，违反状态族视觉身份。
function assertTopicMissingParamGlyphVisible(wxml) {
  const branch = /<cy-empty wx:if="\{\{\s*missingTopicId\s*\}\}"([^>]*)\/>/.exec(wxml)
  assert.ok(branch, 'topic/index 必须保留缺参 cy-empty 分支')
  assert.match(branch[1], /kind="missing-param"/, '缺参态必须保留 missing-param 语义')
  assert.doesNotMatch(branch[1], /\bicon=/, '缺参必须让 KIND_DEFAULTS 的 info glyph 出来，不能再盖空态位图')
}

test('C2:R3 topic/index 缺参态使用 missing-param 默认图标', () => {
  assertTopicMissingParamGlyphVisible(read(TOPIC_INDEX_WXML))
})

test('C2:R3 负控:缺参再盖空态位图时契约精准判红', () => {
  const source = read(TOPIC_INDEX_WXML)
  const mutated = source.replace(
    '<cy-empty wx:if="{{missingTopicId}}" kind="missing-param"',
    '<cy-empty wx:if="{{missingTopicId}}" icon="/images/no_data.svg" kind="missing-param"',
  )
  assert.notEqual(mutated, source, '负控必须实际给缺参态盖上位图')
  assert.throws(
    () => assertTopicMissingParamGlyphVisible(mutated),
    /不能再盖空态位图/,
    '负控必须由缺参图标守卫判红'
  )
})


// —— R4. consumer-night 错误态返回：topic/index 曾绕过标准导航，手写的近黑图标在近黑底上不可见。——
// 只约束 C02 caller：错误态必须调用已有 cy-nav-bar，由组件的 --cy-text-title token
// 绘制裸 chevron（88rpx 命中区）；不在此页伪造一个圆形 pill，也不修改共享组件或全局 token。
function assertTopicErrorStateUsesStandardBack(wxml, json) {
  const nav = /<cy-nav-bar\s+wx:if="\{\{\s*loadError\s*\}\}"([^>]*)\/>/.exec(wxml)
  assert.ok(nav, 'topic/index 的 loadError 态必须调用标准 cy-nav-bar')
  assert.match(json, /"cy-nav-bar"\s*:\s*"\/components\/cy\/nav-bar\/index"/, 'topic/index 必须注册标准 cy-nav-bar 以取得主题返回色 token')
  assert.match(nav[1], /\scustom-back\b/, '错误态返回必须沿用 topic/index 的 goBack 栈失败回退')
  assert.match(nav[1], /\sbind:back="goBack"/, '错误态标准导航必须绑定 topic/index 的 goBack')
  assert.doesNotMatch(nav[0], /\sp(?:ill|ill-dark)\b/, 'consumer-night 二级错误态不得伪造成圆形 pill 返回钮')
  assert.doesNotMatch(nav[0], /\stitle=/, '错误态正文已提供标题，导航不得制造双标题')
  const normalTopbar = wxml.slice(nav.index + nav[0].length)
  assert.match(normalTopbar, /^\s*<view wx:else class="topbar \{\{isTabSticky \? 'solid' : ''\}\}">/, '仅 loadError 切换标准导航，正常主题页仍保留原有 hero 顶栏')
}

test('C2:R4 topic/index consumer-night 错误态使用标准 tokenized 返回导航', () => {
  assertTopicErrorStateUsesStandardBack(read(TOPIC_INDEX_WXML), read(TOPIC_INDEX_JSON))
})



// —— 8. merchantapply2 缺报名上下文:不得拉默认字典并渲染可提交的空表单 ——
function assertApply2ContextGuard(js, wxml) {
  const onLoad = onLoadBlock(js, 'merchantapply2')
  assert.match(js, /applicationContextReady:\s*false/, 'apply2 必须显式记录报名上下文是否完整')
  assert.match(
    js,
    /function isPositiveInteger\(value\) \{[\s\S]*?Number\.isFinite\(numeric\)[\s\S]*?Number\.isInteger\(numeric\)[\s\S]*?numeric > 0/,
    'apply2 的上下文 id 必须是有限正整数'
  )
  assert.match(onLoad, /const params = storedParams && typeof storedParams === 'object' && !Array\.isArray\(storedParams\) \? storedParams : null;/, 'apply2 必须只信任实际存下来的对象上下文')
  assert.match(onLoad, /const applicationContextReady = hasApplicationContext\(params\);/, 'apply2 必须由完整存储上下文决定是否放行')
  assert.match(
    js,
    /function hasApplicationContext\(params\) \{[\s\S]*?!!params &&[\s\S]*?isPositiveInteger\(params\.topicId\)[\s\S]*?Number\(params\.mode\) === 2[\s\S]*?params\.address\.trim\(\)[\s\S]*?params\.startDate[\s\S]*?params\.endDate/,
    'apply2 必须拒绝缺 storage、非法 topicId 或缺地址/日期的报名上下文'
  )
  assert.match(onLoad, /if \(!applicationContextReady\) \{[\s\S]*?return;/, '报名上下文不完整时必须停止后续请求和表单初始化')
  assert.ok(onLoad.indexOf('if (!applicationContextReady)') < onLoad.indexOf('that.getUserData()'), '上下文守卫必须在用户/字典请求之前执行')
  const missingContextBranch = /<block wx:if="\{\{\s*!applicationContextReady\s*\}\}">([\s\S]*?)<\/block>/.exec(wxml)
  assert.ok(missingContextBranch, 'apply2 必须有独立的缺上下文分支')
  assert.match(
    missingContextBranch[1],
    /<cy-empty[^>]*kind="missing-param"[^>]*cta="返回发布广场"[^>]*bind:cta="goTopicList"/,
    'apply2 缺上下文时必须显示不可提交的说明和有效 CTA'
  )
  assert.match(wxml, /<block wx:else>[\s\S]*?<view class="[^"]*step-dots[^"]*">/, '报名表单只能位于有效上下文分支')
  assert.match(
    js,
    /goTopicList\(\) \{[\s\S]*?wx\.reLaunch\(\{\s*url:\s*'\/pages\/template\/index'\s*\}\)/,
    'apply2 缺上下文 CTA 必须回到已注册的发布广场页面'
  )
  assert.match(
    js,
    /saveTemplate:\s*function \(\) \{[\s\S]*?if \(!this\.data\.applicationContextReady \|\| !hasApplicationContext\(this\.data\)\) \{[\s\S]*?return;/,
    '即使意外触发提交函数,缺上下文或空地址/日期也必须拒绝提交'
  )
}






test('C2:R4 负控:缺少标准导航注册或误用 pill 时,错误态导航契约精准判红', () => {
  const wxml = read(TOPIC_INDEX_WXML)
  const json = read(TOPIC_INDEX_JSON)
  const unregistered = json.replace('    "cy-nav-bar": "/components/cy/nav-bar/index",\n', '')
  assert.notEqual(unregistered, json, '负控必须实际移除标准导航注册')
  assert.throws(
    () => assertTopicErrorStateUsesStandardBack(wxml, unregistered),
    /注册标准 cy-nav-bar/,
    '缺少 tokenized 标准导航注册时必须由调用层守卫判红'
  )
  const pill = wxml.replace('wx:if="{{loadError}}" custom-back', 'wx:if="{{loadError}}" pill custom-back')
  assert.notEqual(pill, wxml, '负控必须实际把错误态返回变为 pill')
  assert.throws(
    () => assertTopicErrorStateUsesStandardBack(pill, json),
    /不得伪造成圆形 pill/,
    '误用 hero pill 时必须由二级页导航变体守卫判红'
  )
})
