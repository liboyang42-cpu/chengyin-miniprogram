const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const DETAIL_WXML = 'pages/club/detail/index.wxml'
const DETAIL_WXSS = 'pages/club/detail/index.wxss'
const EDIT_PAGE_JS = 'pages/club/edit/index.js'
const EDIT_SCENE_JS = 'components/cy/scene-club-edit/index.js'
const EDIT_SCENE_WXML = 'components/cy/scene-club-edit/index.wxml'
const EDIT_SCENE_JSON = 'components/cy/scene-club-edit/index.json'
const EDIT_SCENE_WXSS = 'components/cy/scene-club-edit/index.wxss'
const MIN_TOUCH_RPX = 88
const OWNER_STAGES = ['publish', 'invite', 'pending', 'accepted']

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function declarations(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少样式块 ${selector}`)
  return Object.fromEntries(match[1].split(';').map((line) => line.trim()).filter(Boolean).map((line) => {
    const splitAt = line.indexOf(':')
    return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()]
  }))
}

function rpxValue(value) {
  const direct = String(value || '').match(/^(\d+(?:\.\d+)?)rpx$/)
  if (direct) return Number(direct[1])
  const token = String(value || '').match(/^var\((--[^)]+)\)$/)
  assert.ok(token, `尺寸必须是 rpx 或可解析 token，收到 ${value}`)
  const declaration = read('style/tokens.wxss').match(new RegExp(`${token[1]}:\\s*(\\d+(?:\\.\\d+)?)rpx\\s*;`))
  assert.ok(declaration, `尺寸 token ${token[1]} 必须落到明确 rpx`)
  return Number(declaration[1])
}

function tagForHandler(wxml, handler) {
  const tag = wxml.match(new RegExp(`<view\\b[^>]*bindtap="${handler}"[^>]*>`))
  assert.ok(tag, `找不到动作 ${handler}`)
  return tag[0]
}

function buttonVariant(tag) {
  const variant = tag.match(/\bcy-btn--([\w-]+)/)
  assert.ok(variant, `动作缺少 cy-btn 语义档：${tag}`)
  return variant[1]
}

function assertAiInputContract(wxss) {
  const aiInput = declarations(wxss, '.ai-plan-input')
  const inputHeight = rpxValue(aiInput.height)
  assert.ok(inputHeight >= MIN_TOUCH_RPX, `AI 输入框高度 ${inputHeight}rpx，小于 ${MIN_TOUCH_RPX}rpx`)
  assert.equal(rpxValue(aiInput['line-height']), inputHeight, 'AI 输入框 line-height 必须与定高一致，保证原生文字垂直居中')
}

function assertOwnerCtaContract(wxml, wxss) {
  const joinButton = declarations(wxss, '.join-btn')
  assert.ok(rpxValue(joinButton.height) >= MIN_TOUCH_RPX, '俱乐部主要 CTA 触控高度不得小于 88rpx')

  // 2026-09-09 按稿 N1b/N3 删掉「进入群聊」。原来这里守的是它不许占 primary;
  // 现在守得更硬:这个按钮整个不该在这一页出现。
  assert.doesNotMatch(wxml, /goGroupChat/, '群聊入口已按稿删除,不许悄悄回来')

  const ownerRegion = wxml.match(/<!-- owner-cta-start -->([\s\S]*?)<!-- owner-cta-end -->/)
  assert.ok(ownerRegion, '找不到 owner 阶段式 CTA 区')
  const primaryTags = ownerRegion[1].match(/<view\b[^>]*\bcy-btn--primary\b[^>]*>/g) || []
  OWNER_STAGES.forEach((stage) => {
    const visible = primaryTags.filter((tag) => {
      const condition = tag.match(/\bdata-owner-stage="([^"]+)"/)
      return !condition || condition[1] === stage
    })
    assert.equal(visible.length, 1, `owner ${stage} 阶段同一时刻必须恰好一个 primary`)
  })
}

function applyDataPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]]
    cursor[parts[parts.length - 1]] = value
  })
}

function loadEditPage(source = read(EDIT_PAGE_JS)) {
  let definition
  vm.runInNewContext(source, {
    getApp: () => ({ globalData: { statusBarHeight: 44, navBarHeight: 44 } }),
    Page(config) { definition = config },
    wx: { navigateBack() {}, redirectTo() {} },
  }, { filename: EDIT_PAGE_JS })
  const page = Object.assign({}, definition, { data: Object.assign({}, definition.data) })
  page.setData = (patch) => applyDataPatch(page.data, patch)
  return page
}

function loadEditScene(source = read(EDIT_SCENE_JS)) {
  let definition
  const requests = []
  const modalCalls = []
  const events = []
  const app = {
    sendRequest(request) { requests.push(request) },
    getAuthorization() { return 'boundary-token' },
    chooseImage() {},
  }
  vm.runInNewContext(source, {
    getApp: () => app,
    Component(config) { definition = config },
    setTimeout() { return 0 },
    wx: {
      showModal(options) { modalCalls.push(options) },
      showToast() {},
    },
  }, { filename: EDIT_SCENE_JS })
  const component = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
  })
  component.setData = (patch, callback) => {
    applyDataPatch(component.data, patch)
    if (callback) callback.call(component)
  }
  component.triggerEvent = (name, detail) => events.push({ name, detail })
  return { component, requests, modalCalls, events }
}

function formSnapshot(component) {
  const fields = [
    'clubId', 'name', 'clubType', 'activityPrefs', 'city', 'keywords', 'style',
    'description', 'logo', 'cover', 'prioritySignupEnabled',
    // memberDiscountPrice 已随成员优惠价全局停用移除,不再是表单字段
    'memberReservedQuota',
  ]
  return Object.fromEntries(fields.map((field) => [field, component.data[field]]))
}

function assertEditErrorViewContract(wxml, json, js) {
  const skeletonComponent = json.usingComponents && json.usingComponents['cy-skeleton']
  const errorComponent = json.usingComponents && json.usingComponents['cy-error']
  assert.ok(skeletonComponent, 'scene-club-edit 必须注册统一 cy-skeleton')
  assert.ok(fs.existsSync(path.join(ROOT, `${String(skeletonComponent).replace(/^\//, '')}.json`)), 'cy-skeleton 注册目标必须真实存在')
  assert.ok(errorComponent, 'scene-club-edit 必须注册统一 cy-error')
  assert.ok(fs.existsSync(path.join(ROOT, `${String(errorComponent).replace(/^\//, '')}.json`)), 'cy-error 注册目标必须真实存在')
  assert.match(wxml, /<cy-skeleton\b[^>]*wx:if="\{\{loadState === 'loading'\}\}"[^>]*type="form-section"[^>]*loading-label="正在读取俱乐部资料"/, '首载必须显示同构表单骨架，不能留白')
  assert.match(wxml, /<cy-error\b[^>]*wx:elif="\{\{loadState === 'missing-param'\}\}"[^>]*retry="返回俱乐部"[^>]*bind:retry="onBack"/, '缺少 clubId 时只能给真实返回动作，不能伪装成可重试请求')
  assert.match(wxml, /<cy-error\b[^>]*wx:elif="\{\{loadState === 'permission'\}\}"[^>]*retry="返回俱乐部"[^>]*bind:retry="onBack"/, '非主理人必须进入只读权限终态，不能露出编辑表单')
  assert.match(wxml, /<cy-error\b[^>]*wx:elif="\{\{loadState === 'business-error'\}\}"[^>]*bind:retry="loadClub"/, '业务加载失败必须原位重试')
  assert.match(wxml, /<cy-error\b[^>]*wx:elif="\{\{loadState === 'network-error'\}\}"[^>]*bind:retry="loadClub"/, '网络加载失败必须原位重试')
  assert.match(wxml, /<view class="body" wx:elif="\{\{loadState === 'ready'\}\}">/, '表单只能处在错误链后的 ready 终态')
  assert.match(wxml, /class="bottom" wx:if="\{\{loadState === 'ready'\}\}"[\s\S]*?<cy-error\b[^>]*wx:if="\{\{saveErrorText\}\}"[^>]*bind:retry="save"[\s\S]*?<cy-btn wx:else/, '保存失败必须在固定动作区可见，且与保存按钮互斥')
  assert.doesNotMatch(js, /wx\.showModal\s*\(/, '玩家域可恢复错误不得退回系统白色 showModal')
  assert.doesNotMatch(js, /owned\[0\]\.id/, '缺参不能静默编辑第一个自有俱乐部')
}

function assertEditAssetContract(wxml, json) {
  assert.equal(json.usingComponents && json.usingComponents['cy-icon'], '/components/cy/icon/index',
    'scene-club-edit 的可见操作图标必须来自 cy-icon')
  assert.match(wxml, /<cy-icon\b[^>]*name="plus"/, '上传占位必须使用真实 plus 图标')
  assert.match(wxml, /<cy-icon\b[^>]*name="arrow-right"/, '进入动作必须使用真实 arrow-right 图标')
  assert.doesNotMatch(wxml, />\s*\+\s*</, '不得用文本 + 伪造上传图标')
  assert.doesNotMatch(wxml, />\s*\+\s*上传/, '不得把 + 拼进上传文案伪装图标')
  assert.doesNotMatch(wxml, />\s*›\s*</, '不得用文本 › 伪造箭头图标')
  assert.match(wxml, /class="frow frow-action"[^>]*bindtap="pickLogo"[^>]*aria-role="button"[^>]*aria-label=/,
    '头像整行必须是单一的大触达区并有可读标签')
  assert.match(wxml, /class="frow last cover-row frow-action"[^>]*bindtap="pickCover"[^>]*aria-role="button"[^>]*aria-label=/,
    '封面整行必须是单一的大触达区并有可读标签')
}

test('K20/K22：AI 输入框不横切且原生文字垂直居中', () => {
  assertAiInputContract(read(DETAIL_WXSS))
})

test('K05/K09：owner 四个经营阶段均恰好一个 primary，且群聊降级、触控高度合格', () => {
  assertOwnerCtaContract(read(DETAIL_WXML), read(DETAIL_WXSS))
})

test('K05/K09 负控：任一 owner 阶段被加入第二个 primary 都必须判红', () => {
  const source = read(DETAIL_WXML)
  OWNER_STAGES.forEach((stage) => {
    const duplicate = `<view class="join-btn cy-btn cy-btn--primary" wx:if="{{ownerStage === '${stage}'}}" data-owner-stage="${stage}">重复主动作</view>`
    const mutated = source.replace('<!-- owner-cta-end -->', `${duplicate}\n<!-- owner-cta-end -->`)
    assert.throws(() => assertOwnerCtaContract(mutated, read(DETAIL_WXSS)), assert.AssertionError, `${stage} 阶段的双 primary 变异必须被拦住`)
  })
})

test('X08 深链：id 为当前参数真源，clubId 仍作为旧入口兼容值', () => {
  const direct = { id: `direct-${process.pid}`, clubId: `legacy-${process.pid}` }
  const directPage = loadEditPage()
  directPage.onLoad(direct)
  assert.equal(directPage.data.clubId, direct.id, '同时存在时必须优先使用当前深链 id')

  const legacy = { clubId: `legacy-only-${process.pid}` }
  const legacyPage = loadEditPage()
  legacyPage.onLoad(legacy)
  assert.equal(legacyPage.data.clubId, legacy.clubId, '旧 clubId 深链仍需兼容')
})

test('X08/X09：加载错误由互斥 cy-error 分支承载，且组件不再调用 showModal', () => {
  assertEditErrorViewContract(
    read(EDIT_SCENE_WXML),
    JSON.parse(read(EDIT_SCENE_JSON)),
    read(EDIT_SCENE_JS),
  )
})

test('X08：加载中不留白，上传与进入提示不用字符伪造图标', () => {
  const wxml = read(EDIT_SCENE_WXML)
  const json = JSON.parse(read(EDIT_SCENE_JSON))
  assertEditAssetContract(wxml, json)
})

test('X08：解散阻断项在矮屏可滚动，不能被 60vh 容器裁掉', () => {
  const wxss = read(EDIT_SCENE_WXSS)
  const block = declarations(wxss, '.dissolution-blocker-list')
  assert.equal(block['overflow-y'], 'auto')
  const mutated = wxss.replace('overflow-y: auto;', 'overflow-y: hidden;')
  assert.notEqual(mutated, wxss, '负控锚点失效')
  assert.notEqual(declarations(mutated, '.dissolution-blocker-list')['overflow-y'], 'auto')
})

test('X08 负控：把真实上传图标换回文本 + 时必须判红', () => {
  const wxml = read(EDIT_SCENE_WXML)
  const json = JSON.parse(read(EDIT_SCENE_JSON))
  const mutated = wxml.replace(/<cy-icon\b[^>]*name="plus"[^>]*\/>/, '+')
  assert.throws(() => assertEditAssetContract(mutated, json), assert.AssertionError)
})

test('X08：业务失败落到可观察、可重试的业务错误终态', () => {
  const marker = `club-${process.pid}`
  const business = loadEditScene()
  business.component.data.clubId = marker
  business.component.loadClub()
  business.requests[0].success({ code: '500', msg: `business-${process.pid}` })
  assert.ok(business.component.data.loadState === 'business-error', '业务失败必须落到业务错误终态')
  assert.ok(business.component.data.loadErrorText, '业务失败必须保留可观察原因')
  assert.equal(business.modalCalls.length, 0, '业务失败不得弹系统 modal')
})

test('X08：网络失败落到可观察、可重试的网络错误终态', () => {
  const marker = `club-${process.pid}`
  const network = loadEditScene()
  network.component.data.clubId = marker
  network.component.loadClub()
  network.requests[0].fail({ errMsg: `network-${process.pid}` })
  assert.ok(network.component.data.loadState === 'network-error', '网络失败必须落到网络错误终态')
  assert.ok(network.component.data.loadErrorText, '网络失败必须保留可观察原因')
  assert.equal(network.modalCalls.length, 0, '网络失败不得弹系统 modal')
})

test('X08：网络错误可原位重试，成功后回到表单终态', () => {
  const marker = `club-${process.pid}`
  const network = loadEditScene()
  network.component.data.clubId = marker
  network.component.loadClub()
  network.requests[0].fail({ errMsg: `network-${process.pid}` })
  network.component.loadClub()
  const retriedRequest = network.requests[1]
  assert.equal(JSON.parse(retriedRequest.data).id, marker, '重试必须沿用用户正在编辑的俱乐部')
  retriedRequest.success({ code: '200', data: { id: marker, name: `name-${process.pid}`, city: `city-${process.pid}`, isOwner: true } })
  assert.ok(network.component.data.loadState === 'ready', '重试成功必须回到表单 ready 终态')
  assert.ok(!network.component.data.loadErrorText, '重试成功必须清空旧错误')
})

test('X08：缺少 clubId 不发请求、不猜第一个俱乐部，只给返回动作', () => {
  const harness = loadEditScene()
  harness.component.data.clubId = ''
  harness.component.loadClub()
  assert.equal(harness.requests.length, 0, '缺参不得请求 /api/club/my 后猜 owned[0]')
  assert.equal(harness.component.data.loadState, 'missing-param')
  assert.match(harness.component.data.loadErrorText, /俱乐部|返回/)
  harness.component.onBack()
  assert.ok(harness.events.some((event) => event.name === 'back'), '缺参返回动作必须交还宿主')
})

test('X08：非主理人详情进入权限终态，保存防线不发写请求', () => {
  const harness = loadEditScene()
  harness.component.data.clubId = `club-${process.pid}`
  harness.component.loadClub()
  harness.requests[0].success({
    code: '200',
    data: { id: harness.component.data.clubId, name: '只读俱乐部', city: '上海', isOwner: false },
  })
  assert.equal(harness.component.data.loadState, 'permission')
  assert.equal(harness.component.data.isOwner, false)
  harness.component.data.canSave = true
  harness.component.save()
  assert.equal(harness.requests.length, 1, '非主理人不能发 update-mine 写请求')
})

test('X08：深链返回失败落到真实俱乐部 tab，不再跳无参详情死路', () => {
  const source = read(EDIT_PAGE_JS)
  assert.match(source, /doBack\(\)\s*\{\s*wx\.navigateBack\(\{\s*fail\(\)\s*\{\s*wx\.switchTab\(\{\s*url:\s*'\/pages\/talent\/list\/index'/s)
  const mutated = source.replace(
    "doBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } }); }",
    "doBack() { wx.navigateBack({ fail() { wx.redirectTo({ url: '/pages/club/detail/index' }); } }); }",
  )
  assert.notEqual(mutated, source, '负控锚点失效')
  assert.doesNotMatch(mutated, /doBack\(\)\s*\{\s*wx\.navigateBack\(\{\s*fail\(\)\s*\{\s*wx\.switchTab\(\{\s*url:\s*'\/pages\/talent\/list\/index'/s)
})

function assertSaveFailurePreserves(outcome) {
  const harness = loadEditScene()
  Object.assign(harness.component.data, {
    loadState: 'ready',
    clubId: `club-${outcome}-${process.pid}`,
    name: `name-${outcome}-${process.pid}`,
    clubType: `type-${outcome}-${process.pid}`,
    activityPrefs: [`pref-${outcome}-${process.pid}`],
    city: `city-${outcome}-${process.pid}`,
    keywords: `keywords-${outcome}-${process.pid}`,
    style: `style-${outcome}-${process.pid}`,
    description: `description-${outcome}-${process.pid}`,
    logo: `logo-${outcome}-${process.pid}`,
    cover: `cover-${outcome}-${process.pid}`,
    prioritySignupEnabled: true,
    memberReservedQuota: '3',
    isOwner: true,
    canSave: true,
  })
  const before = formSnapshot(harness.component)
  const beforeLoadState = harness.component.data.loadState
  harness.component.save()
  const request = harness.requests[0]
  if (outcome === 'business') request.success({ code: '500', msg: `save-${process.pid}` })
  else request.fail({ errMsg: `save-${process.pid}` })

  assert.deepEqual(formSnapshot(harness.component), before, `${outcome} 保存失败不得清空用户字段`)
  assert.equal(harness.component.data.loadState, beforeLoadState, `${outcome} 保存失败不得把表单切出 ready 终态`)
  assert.ok(harness.component.data.saveErrorText, `${outcome} 保存失败必须留下可观察错误`)
  assert.ok(!harness.component.data.saving, `${outcome} 保存失败必须退出 saving`)
  assert.equal(harness.modalCalls.length, 0, `${outcome} 保存失败不得弹系统 modal`)
}

test('X09：保存业务失败保留全部已填字段，并以内联错误提供恢复入口', () => {
  assertSaveFailurePreserves('business')
})

test('X09：保存网络失败保留全部已填字段，并以内联错误提供恢复入口', () => {
  assertSaveFailurePreserves('network')
})

test('negative control：明显退化会命中对应视觉与错误态闸门', () => {
  const badVisual = read(DETAIL_WXSS).replace(/(\.ai-plan-input\s*\{[^}]*?)height\s*:[^;]+;/, '$1height: 64rpx;')
  assert.throws(
    () => assertAiInputContract(badVisual),
    (error) => error instanceof assert.AssertionError && /AI 输入框高度/.test(error.message),
    '缩小 AI 输入框必须命中高度闸门',
  )

  const badCta = read(DETAIL_WXML).replace(
    '<!-- owner-cta-start -->',
    '<!-- owner-cta-start -->\n<view class="cy-btn cy-btn--primary" bindtap="onCreateTeam">再发一个主题</view>',
  )
  assert.throws(
    () => assertOwnerCtaContract(badCta, read(DETAIL_WXSS)),
    (error) => error instanceof assert.AssertionError && /恰好一个 primary/.test(error.message),
    '往 owner 区多塞一个 primary 必须命中单主行动闸门',
  )

  const groupChatBack = read(DETAIL_WXML).replace(
    '<!-- owner-cta-start -->',
    '<!-- owner-cta-start -->\n<view class="join-btn cy-btn cy-btn--ghost" bindtap="goGroupChat">进入群聊</view>',
  )
  assert.throws(
    () => assertOwnerCtaContract(groupChatBack, read(DETAIL_WXSS)),
    (error) => error instanceof assert.AssertionError && /群聊入口已按稿删除/.test(error.message),
    '群聊按钮被加回来必须判红',
  )

  const badErrorView = read(EDIT_SCENE_WXML).replace(
    /(<view class="body" )wx:elif=/,
    '$1wx:if=',
  )
  assert.throws(
    () => assertEditErrorViewContract(badErrorView, JSON.parse(read(EDIT_SCENE_JSON)), read(EDIT_SCENE_JS)),
    (error) => error instanceof assert.AssertionError && /表单只能处在错误链后的 ready 终态/.test(error.message),
    '让错误与表单同时可见必须命中互斥闸门',
  )
})
