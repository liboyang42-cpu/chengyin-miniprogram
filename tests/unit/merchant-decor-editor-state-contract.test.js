'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '../..')

function applyPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') cursor[parts[index]] = {}
      cursor = cursor[parts[index]]
    }
    cursor[parts.at(-1)] = value
  })
}

function loadPage(relativePath, options = {}) {
  const absolutePath = path.join(ROOT, relativePath)
  const requests = []
  const navigations = []
  const toasts = []
  let definition
  const app = {
    globalData: { navBarHeight: 44 },
    sendRequest(request) { requests.push(request) },
    getRequestErrorMessage(error, fallback) { return error && error.msg || fallback },
    chooseImage() {},
  }
  const wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateBack() { navigations.push('back') },
    redirectTo({ url }) { navigations.push(url) },
    navigateTo({ url }) { navigations.push(url) },
    showToast(payload) { toasts.push(payload) },
    setNavigationBarColor() {},
    setBackgroundColor() {},
  }
  const localRequire = createRequire(absolutePath)
  const sandbox = {
    Array, Date, JSON, Math, Number, Object, RegExp, String,
    clearTimeout, setTimeout,
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(config) { definition = config },
    require(request) {
      if (request.endsWith('merchant-theme.js')) {
        return { merchantPageShow() {}, merchantPageRestore() {} }
      }
      return localRequire(request)
    },
    wx,
  }
  const source = options.source || fs.readFileSync(absolutePath, 'utf8')
  vm.runInNewContext(source, sandbox, { filename: absolutePath })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    applyPatch(this.data, patch)
    if (typeof callback === 'function') callback.call(this)
  }
  return { page, requests, navigations, toasts }
}

test('装修资料接口 code=200 仍必须带商家身份，空对象或缺失 data 不得伪装成可编辑业务态', () => {
  const cases = [
    { path: 'pages/merchant/decor/index.js', ready: 'ok' },
    { path: 'pages/merchant/decor/coop-setting/index.js', ready: 'ok' },
    { path: 'pages/merchant/decor/gallery/index.js', ready: 'ready' },
  ]
  for (const item of cases) {
    for (const data of [{}, undefined]) {
      const h = loadPage(item.path)
      h.page.load()
      h.requests[0].success({ code: 200, data })
      assert.notEqual(h.page.data.loadState, item.ready, `${item.path} 不得把不完整成功体当成可编辑态`)
      assert.equal(h.page.data.loadState, 'error', `${item.path} 应显示可恢复的数据错误`)
    }
  }
})

test('负控：移除商家身份完整性检查后，不完整成功体契约必须变红', () => {
  const cases = [
    'pages/merchant/decor/index.js',
    'pages/merchant/decor/coop-setting/index.js',
    'pages/merchant/decor/gallery/index.js',
  ]
  const guard = /\n\s*const memberId = Number\([^;]+;\n\s*if \(!Number\.isInteger\(memberId\) \|\| memberId < 1\) \{\n\s*return [^\n]+;\n\s*\}/
  for (const relativePath of cases) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
    const mutated = source.replace(guard, '')
    assert.notEqual(mutated, source, `${relativePath} 的商家身份 guard 锚点失效`)
    assert.throws(() => {
      const h = loadPage(relativePath, { source: mutated })
      h.page.load()
      h.requests[0].success({ code: 200, data: {} })
      assert.equal(h.page.data.loadState, 'error', '不完整成功体必须进入可恢复的数据错误态')
    }, /不完整成功体必须进入可恢复的数据错误态/)
  }
})

// 2026-09-19 审查 #30:这里原本有四条钉 pages/merchant/decor/story 的断言 ——
// 读取保留旧正文 / 撤权清空 / 双接口保存锁与原位错误 / 状态控件 aria,外加一条读取 epoch 负控。
// 那一页既没进 app.json、全仓也没有一个 navigateTo 指得过去(装修首页的品牌故事走内联字段弹层),
// 商家与商家员工都进不去,整页已删。同一批不变量在剩下的三页(承接设置 / 相册 / 权益)与装修首页
// 上仍有断言,判据没有跟着页面一起消失。

test('承接设置刷新保留旧表单，拒绝并发，并把撤权与断网分开', () => {
  const h = loadPage('pages/merchant/decor/coop-setting/index.js')
  h.page.load()
  h.page.load()
  assert.equal(h.requests.length, 1)
  h.requests[0].success({
    code: 200,
    data: { memberId: 3, capacity: 18, availableTime: '周末', chargeType: 1, demand: '提前预约', suitActivityTypes: '亲子', coopOpen: 1 },
  })
  h.page.load()
  assert.equal(h.page.data.loadState, 'ok')
  assert.equal(h.page.data.form.capacity, '18')
  h.requests[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.form.capacity, '18')

  h.page.retryLoad()
  h.requests[2].success({ code: 500, msg: '仅审核通过的商家可编辑承接设置' })
  assert.equal(h.page.data.loadState, 'permission')
  assert.equal(h.page.data.form.capacity, '')

  const late = loadPage('pages/merchant/decor/coop-setting/index.js')
  late.page.load()
  late.page.onUnload()
  late.requests[0].success({ code: 200, data: { memberId: 3, capacity: 99 } })
  assert.notEqual(late.page.data.form.capacity, '99')
})

test('承接设置保存保持原 payload，锁重复并留下失败或成功回执', () => {
  const h = loadPage('pages/merchant/decor/coop-setting/index.js')
  h.page.data.loadState = 'ok'
  h.page.data.form = { capacity: '18', availableTime: '周末', chargeType: 1, demand: '提前预约' }
  h.page.data.keep = { suitActivityTypes: '亲子,城市探索', coopOpen: 1 }
  h.page.onNavBack = () => {}

  h.page.data.refreshing = true
  h.page.onSave()
  assert.equal(h.requests.length, 0, '刷新旧快照期间不得提交全量承接设置')
  h.page.data.refreshing = false

  h.page.onSave()
  h.page.onSave()
  assert.equal(h.requests.length, 1)
  assert.deepEqual(JSON.parse(h.requests[0].data), {
    capacity: 18,
    availableTime: '周末',
    suitActivityTypes: '亲子,城市探索',
    chargeType: 1,
    demand: '提前预约',
    coopOpen: 1,
  })
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.saving, false)
  assert.equal(h.page.data.saveErrorKind, 'network')
  assert.equal(h.page.data.form.capacity, '18')

  h.page.onSave()
  h.requests[1].success({ code: 200 })
  assert.equal(h.page.data.saveError, '')
  assert.match(h.page.data.saveReceipt, /已保存/)
})

test('承接设置清空接待人数必须显式声明 clearCapacity，否则后端当成「不改」(M-13)', () => {
  const h = loadPage('pages/merchant/decor/coop-setting/index.js')
  h.page.data.loadState = 'ok'
  h.page.data.form = { capacity: '', availableTime: '', chargeType: 0, demand: '' }
  h.page.data.keep = { suitActivityTypes: '', coopOpen: 1 }
  h.page.onNavBack = () => {}

  h.page.onSave()
  const body = JSON.parse(h.requests[0].data)
  assert.equal(body.capacity, null)
  assert.deepEqual(body.params, { clearCapacity: true })
})

test('承接设置未知收费类型不得伪装成免费或写回 0', () => {
  const h = loadPage('pages/merchant/decor/coop-setting/index.js')
  h.page.load()
  h.requests[0].success({ code: 200, data: { memberId: 3, chargeType: 'unknown' } })
  assert.equal(h.page.data.form.chargeType, null)

  h.page.onSave()
  assert.equal(h.requests.length, 1, '未明确选择收费方式时不得发送保存请求')
  assert.match(h.toasts.at(-1).title, /收费方式/)
})

test('承接设置的表单、状态和底部动作满足 88rpx 与 aria 契约', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/coop-setting/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/coop-setting/index.wxss'), 'utf8')
  const json = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/coop-setting/index.json'), 'utf8')
  assert.match(wxml, /loadState === 'permission'[\s\S]*kind="no-permission"/)
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*loadError/)
  assert.match(wxml, /saveError[\s\S]*bind:action="onSave"/)
  for (const title of ['接待人数', '可承接时间', '收费方式']) {
    assert.match(wxml, new RegExp(`<cy-cell[^>]*title="${title}"`))
  }
  assert.match(wxml, /aria-label="合作诉求"/)
  assert.match(wxml, /aria-label="\{\{editor.label\}\}"/)
  assert.match(wxml, /<cy-dropdown[^>]*below[^>]*bind:change="onChargeType"/)
  assert.match(wxml, /<cy-btn\b[^>]*disabled="\{\{saving \|\| refreshing\}\}"/)
  const shared = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/design.wxss'), 'utf8')
  assert.match(shared, /\.dc-input\s*\{[^}]*height:\s*88rpx/)
  assert.match(json, /"cy-inline-error"/)
})

test('负控：移除承接设置读取 epoch guard 后，卸载迟到回调契约必须变红', () => {
  const relativePath = 'pages/merchant/decor/coop-setting/index.js'
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
  const mutated = source.replace(/\s*if \(epoch !== that\._loadEpoch\) return false;/g, '')
  assert.notEqual(mutated, source, '负控锚点失效：承接设置尚未接入 load epoch')
  assert.throws(() => {
    const h = loadPage(relativePath, { source: mutated })
    h.page.load()
    h.page.onUnload()
    h.requests[0].success({ code: 200, data: { memberId: 3, capacity: 99 } })
    assert.notEqual(h.page.data.form.capacity, '99', '卸载后的旧承接响应不得写回')
  }, /卸载后的旧承接响应不得写回/)
})

test('门店相册刷新保留旧图片，区分权限和网络，并阻止并发与卸载迟到', () => {
  const h = loadPage('pages/merchant/decor/gallery/index.js')
  h.page.load()
  h.page.load()
  assert.equal(h.requests.length, 1)
  h.requests[0].success({ code: 200, data: { memberId: 3, gallery: '["old.jpg"]' } })
  assert.deepEqual(h.page.data.gallery, ['old.jpg'])

  h.page.load()
  assert.equal(h.page.data.loadState, 'ready')
  assert.equal(h.page.data.refreshing, true)
  h.requests[1].fail({ errMsg: 'request:fail timeout' })
  assert.deepEqual(h.page.data.gallery, ['old.jpg'])

  h.page.retryLoad()
  h.requests[2].success({ code: 403, msg: '无权限编辑商家相册' })
  assert.equal(h.page.data.loadState, 'permission')
  assert.equal(h.page.data.gallery.length, 0)

  const late = loadPage('pages/merchant/decor/gallery/index.js')
  late.page.load()
  late.page.onUnload()
  late.requests[0].success({ code: 200, data: { memberId: 3, gallery: '["late.jpg"]' } })
  assert.equal(late.page.data.gallery.length, 0)
})

test('门店相册保存锁重复，失败保留编辑结果，成功留下回执且 payload 不变', () => {
  const h = loadPage('pages/merchant/decor/gallery/index.js')
  Object.assign(h.page.data, { loadState: 'ready', gallery: ['a.jpg', 'b.jpg'], dirty: true })
  h.page.onNavBack = () => {}

  h.page.data.refreshing = true
  h.page.removeGallery({ currentTarget: { dataset: { index: 0 } } })
  h.page.save()
  assert.deepEqual(h.page.data.gallery, ['a.jpg', 'b.jpg'], '刷新期间不得改写旧相册快照')
  assert.equal(h.requests.length, 0, '刷新期间不得提交旧相册快照')
  h.page.data.refreshing = false

  h.page.removeGallery({ currentTarget: { dataset: {} } })
  assert.deepEqual(h.page.data.gallery, ['a.jpg', 'b.jpg'], '缺失图片下标不得误删第一张')
  assert.match(h.page.data.saveError, /重新选择/)
  h.page.setData({ saveErrorKind: '', saveError: '' })

  h.page.save()
  h.page.save()
  assert.equal(h.requests.length, 1)
  assert.deepEqual(JSON.parse(h.requests[0].data), { gallery: '["a.jpg","b.jpg"]' })
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.saving, false)
  assert.equal(h.page.data.dirty, true)
  assert.deepEqual(h.page.data.gallery, ['a.jpg', 'b.jpg'])
  assert.equal(h.page.data.saveErrorKind, 'network')

  h.page.save()
  h.requests[1].success({ code: 200 })
  assert.equal(h.page.data.dirty, false)
  assert.match(h.page.data.saveReceipt, /已保存/)
})

test('门店相册空态、原位错误和图片动作满足恢复及 88rpx aria 契约', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/gallery/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/gallery/index.wxss'), 'utf8')
  const json = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/gallery/index.json'), 'utf8')
  assert.match(wxml, /loadState === 'permission'[\s\S]*kind="no-permission"/)
  assert.match(wxml, /loadState === 'empty'[\s\S]*cta="去商家入驻"[^>]*bind:cta="goApply"/)
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*loadError/)
  assert.match(wxml, /saveError[\s\S]*bind:action="save"/)
  assert.match(wxml, /class="dg-save-receipt"[^>]*aria-role="status"[^>]*aria-live="polite"/)
  assert.match(wxml, /class="dg-delete"[^>]*aria-role="button"[^>]*aria-label="删除第\{\{index \+ 1 \|\| 1\}\}张图片"/)
  assert.match(wxml, /class="dg-delete"[^>]*><cy-icon name="close"/)
  assert.match(wxml, /<cy-icon\b[^>]*name="plus"/)
  assert.doesNotMatch(wxml, />\s*[×✕＋+]\s*</)
  assert.match(wxss, /\.dg-delete\s*\{[^}]*min-height:\s*44px/)
  assert.match(json, /"cy-inline-error"/)
  assert.match(json, /"cy-icon"/)
})

test('负控：移除门店相册读取 epoch guard 后，卸载迟到回调契约必须变红', () => {
  const relativePath = 'pages/merchant/decor/gallery/index.js'
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
  const mutated = source.replace(/\s*if \(epoch !== that\._loadEpoch\) return false;/g, '')
  assert.notEqual(mutated, source, '负控锚点失效：门店相册尚未接入 load epoch')
  assert.throws(() => {
    const h = loadPage(relativePath, { source: mutated })
    h.page.load()
    h.page.onUnload()
    h.requests[0].success({ code: 200, data: { memberId: 3, gallery: '["late.jpg"]' } })
    assert.deepEqual(h.page.data.gallery, [], '卸载后的旧相册响应不得写回')
  }, /卸载后的旧相册响应不得写回/)
})

test('常备权益刷新保留旧清单，拒绝并发，并区分权限与网络', () => {
  const h = loadPage('pages/merchant/decor/perks/index.js')
  h.page.load()
  h.page.load()
  assert.equal(h.requests.length, 1)
  h.requests[0].success({ code: 200, data: [{ id: 1, name: '咖啡券', perkType: 1, retailValue: 88, quota: 20 }] })
  assert.equal(h.page.data.perks.length, 1)
  // CU-M-172:quotaText 不再自带「 · 」前缀 —— 卡面元信息改成一档一个不换行事实的
  // flex 行,分隔由间距供给(与 retailValue/unitCost/validText 三档同为裸值)。
  assert.equal(h.page.data.perks[0].quotaText, '可接待 20 份')

  h.page.load()
  assert.equal(h.page.data.loadState, 'ready')
  assert.equal(h.page.data.refreshing, true)
  h.requests[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.perks[0].id, 1)

  h.page.retryLoad()
  h.requests[2].success({ code: 403, msg: '仅商家可维护常备权益' })
  assert.equal(h.page.data.loadState, 'permission')
  assert.equal(h.page.data.perks.length, 0)

  const late = loadPage('pages/merchant/decor/perks/index.js')
  late.page.load()
  late.page.onUnload()
  late.requests[0].success({ code: 200, data: [{ id: 9, name: '迟到权益', retailValue: 8, quota: 1 }] })
  assert.equal(late.page.data.perks.length, 0)
})

test('常备权益非空列表必须包含可定位 id 和可读名称，畸形数据不得伪装成 ready', () => {
  const malformedLists = [
    [{}],
    [{ id: 1, name: '真权益' }, {}],
    [{ id: 1 }],
    [{ id: 1, name: '   ' }],
    [{ id: 0, name: '伪权益' }],
    [{ id: 'not-an-id', name: '伪权益' }],
    [{ id: true, name: '布尔主键权益' }],
    [{ id: [1], name: '数组主键权益' }],
    [{ id: ' ', name: '空白主键权益' }],
    [{ id: '1', name: '字符串主键权益' }],
  ]

  for (const data of malformedLists) {
    const h = loadPage('pages/merchant/decor/perks/index.js')
    h.page.load()
    h.requests[0].success({ code: 200, data })
    assert.equal(h.page.data.loadState, 'error', JSON.stringify(data))
    assert.deepEqual(h.page.data.perks, [])
  }

  const stale = loadPage('pages/merchant/decor/perks/index.js')
  stale.page.load()
  stale.requests[0].success({
    code: 200,
    data: [{ id: 7, name: '已验证权益', perkType: 1, retailValue: 68, quota: 10 }],
  })
  stale.page.load()
  stale.requests[1].success({ code: 200, data: [{}] })
  assert.equal(stale.page.data.loadState, 'ready', '刷新畸形时保留旧内容作为 stale 快照')
  assert.equal(stale.page.data.refreshing, false)
  assert.equal(stale.page.data.perks[0].id, 7)

  const empty = loadPage('pages/merchant/decor/perks/index.js')
  empty.page.load()
  empty.requests[0].success({ code: 200, data: [] })
  assert.equal(empty.page.data.loadState, 'ready', '空数组是合法空态')
  assert.deepEqual(empty.page.data.perks, [])

  const legacy = loadPage('pages/merchant/decor/perks/index.js')
  legacy.page.load()
  legacy.requests[0].success({
    code: 200,
    data: [
      { id: 8, name: '坏类型旧权益', perkType: true, retailValue: 88, quota: 1 },
      { id: 9, name: '坏配额旧权益', perkType: 1, retailValue: 88, quota: true },
    ],
  })
  assert.equal(legacy.page.data.loadState, 'ready', '旧行可继续展示')
  assert.equal(legacy.page.data.perks[0].usable, false, '布尔类型不得被当成可用权益')
  assert.equal(legacy.page.data.perks[0].typeText, '权益', '布尔类型不得被当成优惠券')
  assert.equal(legacy.page.data.perks[1].usable, false, '布尔配额不得被当成 1 份')
  assert.equal(legacy.page.data.perks[1].typeText, '优惠券', '真实整数类型仍可正常展示')
  assert.equal(legacy.page.data.perks[1].quotaText, '', '畸形配额不得伪装成 0 或 1 份')

  const objectPayload = loadPage('pages/merchant/decor/perks/index.js')
  objectPayload.page.load()
  assert.doesNotThrow(() => objectPayload.requests[0].success({ code: 200, data: {} }))
  assert.equal(objectPayload.page.data.loadState, 'error', '200 空对象是可恢复的数据错误，不得崩溃或伪装空列表')
})

test('负控：常备权益 id 退回强制类型转换时，畸形非空列表契约必须变红', () => {
  const relativePath = 'pages/merchant/decor/perks/index.js'
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
  const strictGuard = `function isPerkTemplateList(value) {
  return isRecordList(value) && value.every(function (template) {
    return Number.isInteger(template.id) && template.id > 0
      && typeof template.name === 'string'
      && template.name.trim().length > 0;
  });
}`
  const mutated = source.replace(
    strictGuard,
    `function isPerkTemplateList(value) {
  return isRecordList(value) && value.every(function (template) {
    const id = Number(template.id);
    return Number.isInteger(id) && id > 0
      && typeof template.name === 'string'
      && template.name.trim().length > 0;
  });
}`,
  )
  assert.notEqual(mutated, source, '负控锚点失效：常备权益尚未接入领域 shape guard')
  assert.throws(() => {
    const h = loadPage(relativePath, { source: mutated })
    h.page.load()
    h.requests[0].success({ code: 200, data: [{ id: true, name: '布尔主键权益' }] })
    assert.equal(h.page.data.loadState, 'error', '畸形非空列表必须进入可恢复数据错误态')
  }, /畸形非空列表必须进入可恢复数据错误态/)
})

test('常备权益创建锁重复，保持 payload，写回执后必须用列表权威回读收尾', () => {
  const h = loadPage('pages/merchant/decor/perks/index.js')
  Object.assign(h.page.data, {
    loadState: 'ready', canSave: true, formVisible: true,
    form: { perkType: 1, name: '咖啡券', retailValue: '88.00', unitCost: '20.50', quota: '20', validEnd: '2026-12-31' },
  })
  h.page.data.refreshing = true
  h.page.save()
  assert.equal(h.requests.length, 0, '刷新期间不得提交创建请求')
  h.page.data.refreshing = false

  h.page.save()
  h.page.save()
  assert.equal(h.requests.length, 1)
  assert.deepEqual(JSON.parse(h.requests[0].data), {
    perkType: 1, name: '咖啡券', retailValue: 88, unitCost: 20.5, quota: 20, validEnd: '2026-12-31',
  })
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.saving, false)
  assert.equal(h.page.data.formVisible, true)
  assert.equal(h.page.data.form.name, '咖啡券')
  assert.equal(h.page.data.saveErrorKind, 'network')

  h.page.save()
  h.requests[1].success({ code: 200, data: { id: 77 } })
  assert.equal(h.page.data.formVisible, true, '写接口回执不能提前关闭表单')
  assert.equal(h.page.data.saveReceipt, '', '写接口回执不能提前宣称已保存')
  assert.equal(h.page.data.saving, true, '权威回读完成前保持提交锁')
  assert.equal(h.requests[2].url, '/api/coop/perk-template/list')

  h.requests[2].success({ code: 200, data: [] })
  assert.equal(h.page.data.formVisible, true)
  assert.equal(h.page.data.saveReceipt, '')
  assert.match(h.page.data.saveError, /确认|读取/)
  h.page.retrySaveReadback()
  assert.equal(h.requests[3].url, '/api/coop/perk-template/list', '手动重查不能再次写入权益')
  h.requests[3].success({ code: 200, data: [{
    id: 77, perkType: 1, name: '咖啡券', retailValue: 88, unitCost: 20.5, quota: 20, validEnd: '2026-12-31',
  }] })
  assert.equal(h.page.data.formVisible, false)
  assert.match(h.page.data.saveReceipt, /已保存/)
})

test('常备权益删除拒绝缺失 id 和重复请求，失败原位可见', () => {
  const h = loadPage('pages/merchant/decor/perks/index.js')
  h.page.data.loadState = 'ready'
  h.page.confirmDelete()
  assert.equal(h.requests.length, 0)
  assert.match(h.page.data.deleteError, /重新选择/)

  h.page.data.deleteId = 7
  h.page.confirmDelete()
  h.page.confirmDelete()
  assert.equal(h.requests.length, 1)
  assert.deepEqual(JSON.parse(h.requests[0].data), { id: 7 })
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.deleting, false)
  assert.equal(h.page.data.deleteErrorKind, 'network')
})

test('常备权益状态、表单与删除动作满足空态恢复、88rpx 和 aria 契约', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/perks/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/perks/index.wxss'), 'utf8')
  const json = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/perks/index.json'), 'utf8')
  assert.match(wxml, /loadState === 'permission'[\s\S]*kind="no-permission"/)
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*loadError/)
  assert.match(wxml, /loadState === 'ready'[\s\S]*!perks\.length[\s\S]*title="还没有常备权益"/)
  assert.match(wxml, /<cy-dropdown[^>]*range="\{\{perkTypes\}\}"[^>]*below[^>]*bind:change="onTypeChange"/)
  for (const label of ['权益名称', '权益零售价', '成本价', '可接待份数']) {
    assert.match(wxml, new RegExp(`aria-label="${label}"`))
  }
  assert.doesNotMatch(wxml, /item\.quota \|\| 0/)
  assert.match(wxml, /wx:if="\{\{item\.quotaText\}\}"[^>]*>\{\{item\.quotaText\}\}/)
  assert.match(wxss, /\.dp-delete\s*\{[^}]*min-width:\s*var\(--cy-btn-h\)/)
  assert.match(json, /"cy-inline-error"/)
})

test('负控：移除常备权益读取 epoch guard 后，卸载迟到回调契约必须变红', () => {
  const relativePath = 'pages/merchant/decor/perks/index.js'
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
  const mutated = source.replace(/\s*if \(epoch !== that\._loadEpoch\) return false;/g, '')
  assert.notEqual(mutated, source, '负控锚点失效：常备权益尚未接入 load epoch')
  assert.throws(() => {
    const h = loadPage(relativePath, { source: mutated })
    h.page.load()
    h.page.onUnload()
    h.requests[0].success({ code: 200, data: [{ id: 9, name: '迟到权益', retailValue: 8, quota: 1 }] })
    assert.equal(h.page.data.perks.length, 0, '卸载后的旧权益响应不得写回')
  }, /卸载后的旧权益响应不得写回/)
})

test('店铺装修入口刷新保留旧资料，拒绝并发，并区分撤权与断网', () => {
  const h = loadPage('pages/merchant/decor/index.js')
  h.page.load()
  h.page.load()
  assert.equal(h.requests.length, 1)
  h.requests[0].success({ code: 200, data: { memberId: 3, name: '旧店', gallery: '[]', tags: '[]' } })
  assert.equal(h.page.data.m.name, '旧店')

  h.page.load()
  assert.equal(h.page.data.loadState, 'ok')
  assert.equal(h.page.data.refreshing, true)
  h.requests[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.m.name, '旧店')

  h.page.retryLoad()
  h.requests[2].success({ code: 403, msg: '仅审核通过的商家可装修店铺' })
  assert.equal(h.page.data.loadState, 'permission')
  assert.equal(h.page.data.m, null)
})

test('店铺装修入口卸载后拒绝迟到资料与超时回写', () => {
  const h = loadPage('pages/merchant/decor/index.js')
  h.page.load()
  h.page.onUnload()
  h.requests[0].success({ code: 200, data: { memberId: 9, name: '迟到店', gallery: '[]', tags: '[]' } })
  assert.equal(h.page.data.m, null)
  assert.equal(h.page.data.loadState, 'loading')
})

test('店铺装修即时保存锁重复，保持 payload，并留下失败或成功回执', () => {
  const h = loadPage('pages/merchant/decor/index.js')
  h.page.data.loadState = 'ok'
  h.page.data.m = { name: '旧店', businessStatus: 1 }
  h.page.data.refreshing = true
  h.page.saveDecor({ slogan: '旧快照' })
  assert.equal(h.requests.length, 0, '刷新期间不得提交旧店铺快照')
  h.page.toggleBusiness({ detail: { value: false } })
  assert.equal(h.page.data.m.businessStatus, 1, '刷新期间不得先改本地营业状态再静默放弃保存')
  h.page.data.refreshing = false

  h.page.saveDecor({ slogan: '街角补给站' })
  h.page.saveDecor({ slogan: '重复提交' })
  assert.equal(h.requests.length, 1)
  assert.deepEqual(JSON.parse(h.requests[0].data), { slogan: '街角补给站' })
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.saving, false)
  assert.equal(h.page.data.saveErrorKind, 'network')

  h.page.saveDecor({ slogan: '街角补给站' })
  h.requests[1].success({ code: 200 })
  assert.equal(h.page.data.saveError, '')
  assert.match(h.page.data.saveReceipt, /已保存/)

  h.page.data.m = { chargeType: 'unknown' }
  h.page.refreshGuide()
  assert.equal(h.page.data.coopSummary, '', '未知收费类型不得显示成免费承接')
})

test('店铺装修入口状态、即时回执及交互满足 88rpx 与 aria 契约', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/index.wxss'), 'utf8')
  const json = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/index.json'), 'utf8')
  assert.match(wxml, /loadState === 'permission'[\s\S]*kind="no-permission"/)
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*loadError/)
  assert.match(wxml, /saveError[\s\S]*bind:action="retrySave"/)
  assert.match(wxml, /class="dc-save-receipt"[^>]*aria-role="status"[^>]*aria-live="polite"/)
  assert.match(wxml, /class="dc-refreshing"[^>]*aria-role="status"[^>]*aria-live="polite"/)
  assert.match(wxml, /<cy-cell[^>]*bind:tap="goSection"/)
  assert.match(wxml, /class="dc-tag[^>]*aria-role="checkbox"[^>]*aria-checked=/)
  assert.match(wxml, /class="dc-input"[^>]*aria-label="\{\{fieldSheet\.label\}\}"/)
  const shared = fs.readFileSync(path.join(ROOT, 'pages/merchant/decor/design.wxss'), 'utf8')
  assert.match(shared, /\.dc-choice\s*\{[^}]*min-height:\s*44px/)
  assert.match(shared, /--cy-comp-cell-min-h:\s*104rpx/)
  assert.match(json, /"cy-inline-error"/)
})

test('负控：移除店铺装修入口读取 epoch guard 后，卸载迟到回调契约必须变红', () => {
  const relativePath = 'pages/merchant/decor/index.js'
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
  const mutated = source.replace(/\s*if \(epoch !== that\._loadEpoch\) return false;/g, '')
  assert.notEqual(mutated, source, '负控锚点失效：店铺装修入口尚未接入 load epoch')
  assert.throws(() => {
    const h = loadPage(relativePath, { source: mutated })
    h.page.load()
    h.page.onUnload()
    h.requests[0].success({ code: 200, data: { memberId: 9, name: '迟到店', gallery: '[]', tags: '[]' } })
    assert.equal(h.page.data.m, null, '卸载后的旧店铺响应不得写回')
  }, /卸载后的旧店铺响应不得写回/)
})
