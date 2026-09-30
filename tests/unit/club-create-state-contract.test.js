const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = 'pages/club/create/index.js'
const WXML = fs.readFileSync(path.join(ROOT, 'pages/club/create/index.wxml'), 'utf8')
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/club/create/index.wxss'), 'utf8')

function loadPage(mutate) {
  let source = fs.readFileSync(path.join(ROOT, JS_PATH), 'utf8')
  if (mutate) {
    const changed = mutate(source)
    assert.notEqual(changed, source, '负控锚点失效')
    source = changed
  }
  const requests = []
  const roleCallbacks = []
  const redirects = []
  const backs = []
  let definition
  let snapshotReady = false
  let clubLeader = false
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (options) => requests.push(options),
    chooseImage() {},
  }
  const roleGuard = {
    load: (callback) => roleCallbacks.push(callback),
    hasSnapshot: () => snapshotReady,
    isClubLeader: () => clubLeader,
  }
  const sandbox = {
    getApp: () => app,
    // 有上一页:全页返回合同(#806)按 getCurrentPages().length 选 navigateBack 还是根栈落点
    getCurrentPages: () => [{}, {}],
    Page: (value) => { definition = value },
    require: (id) => id.includes('roleGuard')
      ? roleGuard
      : require(path.resolve(path.dirname(path.join(ROOT, JS_PATH)), id)),
    wx: {
      redirectTo: (options) => redirects.push(options),
      navigateBack: (options) => backs.push(options || {}), showToast() {},
    },
  }
  vm.runInNewContext(source, sandbox, { filename: JS_PATH })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) { Object.assign(this.data, patch); if (done) done.call(this) },
  })
  return {
    page, requests, roleCallbacks, redirects, backs,
    setSnapshot(value) { snapshotReady = value },
    setClubLeader(value) { clubLeader = value },
  }
}

function finishEligibleBootstrap(h) {
  h.setSnapshot(true)
  h.setClubLeader(true)
  h.roleCallbacks.at(-1)({ role: 'club', permission: { canCreateClub: true } })
  h.requests.at(-1).success({ code: 200, data: { owned: [] } })
}

test('身份与名额都确认前保持首载态；快照未知 fail-closed 且可重试', () => {
  const h = loadPage()
  h.page.data.name = '夜行俱乐部'
  h.page.onLoad()
  assert.equal(h.page.data.bootstrapState, 'checking')
  assert.equal(h.roleCallbacks.length, 1)
  assert.equal(h.requests.length, 1)
  assert.match(WXML, /bootstrapState === 'ready' && submitState !== 'success'/)

  h.requests[0].success({ code: 200, data: { owned: [] } })
  h.roleCallbacks[0](null)
  assert.equal(h.page.data.bootstrapState, 'error')
  assert.equal(h.page.data.name, '夜行俱乐部')

  h.page.retryBootstrap()
  h.page.retryBootstrap()
  assert.equal(h.roleCallbacks.length, 2)
  assert.equal(h.requests.length, 2, '资格检查在途时连续重试不得重复发请求')
  finishEligibleBootstrap(h)
  assert.equal(h.page.data.bootstrapState, 'ready')
  assert.equal(h.page.data.name, '夜行俱乐部')
})

test('名额接口 code=200 仍要求 owned 数组，缺失或非法不得冒充已确认零家', () => {
  ;[{}, { owned: null }, { owned: {} }].forEach((data) => {
    const h = loadPage()
    h.page.onLoad()
    h.setSnapshot(true)
    h.setClubLeader(true)
    h.roleCallbacks[0]({ role: 'club', permission: { canCreateClub: true } })
    h.requests[0].success({ code: 200, data })
    assert.equal(h.page.data.bootstrapState, 'error')
    assert.equal(h.page.data.bootstrapErrorKind, 'data')
    assert.match(h.page.data.bootstrapError, /名额数据不完整/)
  })
})

test('非主理人进入申请页；跳转失败有可恢复权限状态', () => {
  const h = loadPage()
  h.page.onLoad()
  h.requests[0].success({ code: 200, data: { owned: [] } })
  h.setSnapshot(true)
  h.roleCallbacks[0]({ role: 'player', permission: { canCreateClub: false } })
  assert.equal(h.page.data.bootstrapState, 'redirecting')
  assert.equal(h.redirects[0].url, '/pages/club/apply/index')
  h.redirects[0].fail({ errMsg: 'redirectTo:fail' })
  assert.equal(h.page.data.bootstrapState, 'no-permission')
  h.page.goApply()
  assert.equal(h.redirects.length, 2)
})

test('已达两家上限显示持久终态，不渲染可提交表单', () => {
  const h = loadPage()
  h.page.onLoad()
  h.setSnapshot(true)
  h.setClubLeader(true)
  h.roleCallbacks[0]({ role: 'club', permission: { canCreateClub: true } })
  h.requests[0].success({ code: 200, data: { owned: [{ id: 1 }, { id: 2 }] } })
  assert.equal(h.page.data.bootstrapState, 'limit')
  assert.match(WXML, /bootstrapState === 'limit'/)
  assert.match(WXML, /bind:primary="goManageClub"/)
})

test('提交失败原位可见并保留草稿；成功留下可读回执与显式下一步', () => {
  const h = loadPage()
  Object.assign(h.page.data, {
    bootstrapState: 'ready', step: 4, canNext: true,
    clubType: '兴趣社群', activityPrefs: ['轻社交'], name: '夜行俱乐部', city: '上海',
  })
  h.page.submit()
  h.page.submit()
  assert.equal(h.requests.length, 1)
  assert.equal(h.page.data.submitting, true)
  h.requests[0].success({ code: 500, msg: '创建服务暂不可用' })
  assert.equal(h.page.data.submitError, '创建服务暂不可用')
  assert.equal(h.page.data.name, '夜行俱乐部')
  assert.match(WXML, /<cy-inline-error\b[^>]*submitError[^>]*bind:action="retrySubmit"/s)

  h.page.retrySubmit()
  h.page.onInput({ currentTarget: { dataset: { field: 'city' } }, detail: { value: '杭州' } })
  assert.equal(h.page.data.city, '上海', '创建在途时输入不得继续改写草稿')
  Object.assign(h.page.data, { name: '迟到名称', city: '杭州' })
  h.requests[1].success({ code: 200, data: { clubId: 77 } })
  assert.equal(h.page.data.submitState, 'success')
  assert.equal(h.page.data.createdClubId, '77')
  assert.equal(h.page.data.submissionReceipt.name, '夜行俱乐部')
  assert.equal(h.page.data.submissionReceipt.city, '上海', '成功回执必须与真正发出的 payload 一致')
  assert.equal(h.redirects.length, 0, '成功回执应由用户读完后显式进入管理页')

  h.page.goCreatedClub()
  assert.equal(h.redirects[0].url, '/pages/club/detail/index?id=77')
  assert.match(WXML, /<cy-empty\b[^>]*kind="success"[^>]*bind:cta="goCreatedClub"/s)
})

test('失败后的重试仍统一校验类型、名称与城市，字段被清空时不得绕过向导提交', () => {
  const h = loadPage()
  Object.assign(h.page.data, {
    bootstrapState: 'ready', step: 4, canNext: true,
    clubType: '兴趣社群', name: '夜行俱乐部', city: '上海',
  })
  h.page.submit()
  h.requests[0].fail({ msg: '创建服务暂不可用' })

  Object.assign(h.page.data, { city: '', canNext: false })
  h.page.retrySubmit()
  assert.equal(h.requests.length, 1, '城市被清空后重试不得再发创建请求')
  // 2026-09-06 裁决:向导忠于现码四步(类型→方向→资料→城市),城市在第 4 步。
  // master #1001 曾按 G2 稿把名称与城市合并进第 2 步 —— 本轮以现码为准。
  assert.equal(h.page.data.step, 4)
  assert.equal(h.page.data.canNext, false)
  assert.match(h.page.data.submitError, /城市/)

  Object.assign(h.page.data, { city: '上海', name: '', step: 4, canNext: true })
  h.page.retrySubmit()
  assert.equal(h.requests.length, 1, '名称被清空后重试不得再发创建请求')
  // 名称在第 3 步(资料),同上:忠于现码四步
  assert.equal(h.page.data.step, 3)
  assert.match(h.page.data.submitError, /名称/)
})

test('成功回执上的系统返回直接退出，不再修改被隐藏的向导步骤', () => {
  const h = loadPage()
  Object.assign(h.page.data, { submitState: 'success', step: 4 })
  h.page.onBack()
  assert.equal(h.backs.length, 1)
  assert.equal(h.page.data.step, 4)
  assert.equal(h.page.data.submitState, 'success')
})

test('创建 API 与字段合同不变，业务 body 不误报为设备断网', () => {
  const h = loadPage()
  Object.assign(h.page.data, {
    bootstrapState: 'ready', step: 4, canNext: true,
    clubType: '兴趣社群', activityPrefs: ['轻社交'], name: '夜行俱乐部', city: '上海',
    logo: 'logo.jpg', cover: 'cover.jpg', description: '一起夜行', keywords: '徒步', style: '克制',
  })
  h.page.submit()
  const request = h.requests[0]
  assert.equal(request.url, '/api/club/create')
  assert.equal(request.method, 'POST')
  assert.deepEqual(Object.keys(JSON.parse(request.data)).sort(), [
    'activityPrefs', 'address', 'city', 'clubType', 'cover', 'description',
    'keywords', 'logo', 'name', 'style',
  ].sort())
  request.fail({ msg: '网络服务暂不可用' })
  assert.equal(h.page.data.submitErrorKind, 'data')
  assert.equal(h.page.data.submitError, '网络服务暂不可用')
})

test('向导选项、图片动作和主操作具备语义与 88rpx 点击下限', () => {
  assert.match(WXML, /class="cc-progress[^"]*"[^>]*aria-role="status"[^>]*aria-label="第\{\{step\}\}步，共4步"/s)
  assert.match(WXML, /class="cc-opt[^>]*aria-role="radio"[^>]*aria-checked=/s)
  assert.match(WXML, /class="cc-chip[\s\S]{0,320}aria-role="checkbox"[\s\S]{0,120}aria-checked=/)
  // 2026-09-06 裁决:向导忠于现码四步,封面/Logo 上传**留在第 3 步**。
  // master #1001 曾按 G4 稿注释把它移出向导并在此钉「不许加回来」——本轮以现码为准,
  // 该断言反向:它必须在,且带程序化名称。
  assert.match(WXML, /class="cc-cover"[^>]*aria-label="选择俱乐部封面"/s, '封面上传必须留在向导内')
  assert.match(WXML, /class="cc-logo"[^>]*aria-label="选择俱乐部Logo"/s, 'Logo 上传必须留在向导内')
  assert.match(WXML, /loading="\{\{submitting\}\}"[^>]*disabled="\{\{!canNext \|\| submitting\}\}"/s)
  for (const label of [
    '俱乐部名称，必填', '一句话介绍，选填', '所在城市，必填',
    '核心关键词，选填', '风格或调性，选填',
  ]) {
    assert.match(WXML, new RegExp(`aria-label="${label}"`), `${label} 缺少程序化名称`)
  }
  assert.equal((WXML.match(/disabled="\{\{submitting\}\}"/g) || []).length, 5,
    '五个文字输入在创建在途时都必须禁用')
  assert.match(WXSS, /\.cc-chip\s*\{[^}]*min-height:\s*88rpx/s)
  // 2026-09-06 用户定:删掉顶栏关闭钮(onClose 方法仍被三处错误态的「返回上一页」复用)。
  // 控件没了,原来那条 .cc-close 88rpx 触控下限断言就成了死锚点 —— 永远红,
  // 而「永远红」和「永远绿」一样没有信息。改成断言它确实不在,防止有人无意间加回来。
  assert.doesNotMatch(WXML, /class="cc-close"/, '顶栏关闭钮已按裁决删除,别加回来')
})

test('bootstrap epoch 负控：移除保护后旧检查可覆盖新一轮 ready', () => {
  const h = loadPage((source) => source.replaceAll(
    'if (epoch !== this._bootstrapEpoch) return;',
    ''
  ))
  h.page.onLoad()
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  h.page.retryBootstrap()
  finishEligibleBootstrap(h)
  assert.equal(h.page.data.bootstrapState, 'ready')
  h.requests[0].fail({ errMsg: 'late' })
  assert.equal(h.page.data.bootstrapState, 'error', '负控应复现旧回调覆盖')
})

test('名额 shape 负控：恢复缺失 owned 默认空数组后必须判红', () => {
  assert.throws(() => {
    const h = loadPage((source) => source
      .replace('if (!isOwnedQuotaPayload(res)) {', "if (!(res && res.code == '200' && res.data)) {")
      .replace('const owned = res.data.owned;', 'const owned = res.data.owned || [];'))
    h.page.onLoad()
    h.setSnapshot(true)
    h.setClubLeader(true)
    h.roleCallbacks[0]({ role: 'club', permission: { canCreateClub: true } })
    h.requests[0].success({ code: 200, data: {} })
    assert.equal(h.page.data.bootstrapState, 'error', '名额未知不得放行创建向导')
  }, /名额未知不得放行创建向导/)
})

test('成功回执快照负控：恢复读取活表单后必须判红', () => {
  assert.throws(() => {
    const h = loadPage((source) => source.replace(
      'submissionReceipt: { name: payload.name, city: payload.city },',
      'submissionReceipt: { name: d.name, city: d.city },',
    ))
    Object.assign(h.page.data, {
      bootstrapState: 'ready', step: 4, canNext: true,
      clubType: '兴趣社群', name: '夜行俱乐部', city: '上海',
    })
    h.page.submit()
    Object.assign(h.page.data, { name: '迟到名称', city: '杭州' })
    h.requests[0].success({ code: 200, data: { clubId: 77 } })
    assert.deepEqual(h.page.data.submissionReceipt, { name: '夜行俱乐部', city: '上海' },
      '回执不得读取请求在途期间被改写的活表单')
  }, /回执不得读取请求在途期间被改写的活表单/)
})
