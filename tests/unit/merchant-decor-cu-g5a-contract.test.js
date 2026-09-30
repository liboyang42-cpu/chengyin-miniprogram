'use strict'
// 走查第二轮 G5a-merchant-decor 修复的回归锚点(品牌中心 / 入驻资料 / 特色标签 / 招牌主推 / 常备权益)。
// 每条判据都对着一个可观察后果,撤掉对应修复就变红(负控逐条实测过)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '../..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')

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
  const toasts = []
  const previews = []
  let definition
  const app = {
    globalData: { navBarHeight: 44 },
    sendRequest(request) { requests.push(request) },
    getRequestErrorMessage(error, fallback) { return (error && error.msg) || fallback },
    chooseImage() {},
  }
  const wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateBack() {}, redirectTo() {}, navigateTo() {},
    showToast(payload) { toasts.push(payload.title) },
    previewImage(payload) { previews.push(payload.urls) },
    setNavigationBarColor() {}, setBackgroundColor() {},
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
  page.selectComponent = () => ({ close() {}, openAtAnchor() {} })
  return { page, requests, toasts, previews }
}

const DECOR_JS = 'pages/merchant/decor/index.js'
const DECOR_WXML = 'pages/merchant/decor/index.wxml'

// ---------------------------------------------------------------- CU-M-72

test('CU-M-72 一句话介绍的弹层标题与无障碍名必须和入口同名，不再夹英文', () => {
  const h = loadPage(DECOR_JS)
  h.page.data.m = { slogan: '巷口见' }

  h.page.openField({ currentTarget: { dataset: { k: 'slogan' } } })

  assert.equal(h.page.data.fieldSheet.label, '一句话介绍')
  // 弹层标题与关闭钮无障碍名都由 fieldSheet.label 派生(sheet/index.js),这里守住绑定点
  assert.match(read(DECOR_WXML), /<cy-sheet[\s\S]{0,120}title="\{\{fieldSheet\.label\}\}"/)
})

// ---------------------------------------------------------------- CU-M-73

test('CU-M-73 开单字段弹层必须清掉上一个操作留下的失败态，不得串成自己的错误', () => {
  const h = loadPage(DECOR_JS)
  h.page.data.m = { slogan: '' }
  h.page.data.saveError = '内容审核暂时不可用，请联系平台'
  h.page.data.saveErrorKind = 'data'
  h.page.data.saveReceipt = '店铺资料已保存'

  h.page.openField({ currentTarget: { dataset: { k: 'slogan' } } })

  assert.equal(h.page.data.fieldSheet.show, true)
  assert.equal(h.page.data.saveError, '', '弹层直读页面级 saveError,开新弹层必须先清')
  assert.equal(h.page.data.saveErrorKind, '')
  assert.equal(h.page.data.saveReceipt, '')
})

// ---------------------------------------------------------------- CU-M-74

test('CU-M-74 特色标签保存失败后重开面板必须保留草稿，重试载荷与眼前勾选一致', () => {
  const h = loadPage(DECOR_JS)
  h.page.data.loadState = 'ok'
  h.page.data.m = { tags: '["老街"]' }
  h.page.data.tags = ['老街']
  h.page.data.tagDraft = ['老街', '天台']

  h.page.confirmTags()
  assert.equal(h.requests.length, 1)
  assert.deepEqual(JSON.parse(h.requests[0].data), { tags: '["老街","天台"]' })
  h.requests[0].fail({ errMsg: 'request:fail timeout' })

  assert.equal(h.page._resumeTags, true, '失败后必须钉住草稿,否则重开退回已保存值')
  // 收起再展开:草稿保持眼前这份(没有这条修复时 openTagPanel 会用已保存 tags 重建)
  h.page.openTagPanel()
  assert.deepEqual(Array.from(h.page.data.tagDraft), ['老街', '天台'])
  // 集成复审:不是只保留一次 —— 第二次收起再展开也得是这份
  h.page.openTagPanel()
  assert.deepEqual(Array.from(h.page.data.tagDraft), ['老街', '天台'], '失败后草稿要一直钉住到保存成功')

  // 失败后又改了勾选:页顶「重试保存」提交的必须是眼前这份,不是失败那一刻的快照
  h.page.data.tagDraft = ['老街', '天台', '咖啡']
  h.page.retrySave()
  assert.deepEqual(JSON.parse(h.requests[1].data), { tags: '["老街","天台","咖啡"]' })
  h.requests[1].fail({ errMsg: 'request:fail timeout' })

  // 反证:同样的重开、不带 _resumeTags 就会退回已保存值 —— 这正是原来的病
  const other = loadPage(DECOR_JS)
  other.page.data.tags = ['老街']
  other.page.data.tagDraft = ['老街', '天台']
  other.page.openTagPanel()
  assert.deepEqual(Array.from(other.page.data.tagDraft), ['老街'])

  // 成功分支照旧:关闭面板并以保存值收口
  h.page.confirmTags()
  h.requests[2].success({ code: 200 })
  assert.deepEqual(Array.from(h.page.data.tags), ['老街', '天台', '咖啡'])
  assert.equal(h.page.data.saveError, '')
  // 保存成功后解除钉住:下次打开按已保存值重建
  h.page._resumeTags = false
  h.page.data.tagDraft = ['别的']
  h.page.openTagPanel()
  assert.deepEqual(Array.from(h.page.data.tagDraft), ['老街', '天台', '咖啡'])
})

// ---------------------------------------------------------------- CU-M-75

test('CU-M-75 自定义标签空值时「添加」不可点，被点与回车都要有解释', () => {
  const h = loadPage(DECOR_JS)
  h.page.data.customTag = '   '

  h.page.addCustomTag()
  assert.equal(h.requests.length, 0)
  assert.deepEqual(h.toasts, ['请填写标签名称'])

  h.page.onAddTagBlocked()
  assert.deepEqual(h.toasts, ['请填写标签名称', '请填写标签名称'])

  const wxml = read(DECOR_WXML)
  assert.match(wxml, /<cy-btn disabled="\{\{!customTag\}\}"[^>]*bind:disabledtap="onAddTagBlocked"/)
})

// ---------------------------------------------------------------- CU-M-71

test('CU-M-71 入驻资料缺图是只读态:不挂箭头、写清去哪补交、点击给稳定解释', () => {
  const h = loadPage(DECOR_JS)
  h.page.data.m = {}
  h.page.data.brandImages = []

  h.page.previewLicense()
  h.page.previewBrandImages()
  assert.equal(h.previews.length, 0)
  assert.deepEqual(h.toasts, ['入驻时提交，如需更新请联系平台', '入驻时提交，如需更新请联系平台'])

  h.page.data.m = { businessLicense: 'https://cdn.example.com/license.png' }
  h.page.data.brandImages = ['https://cdn.example.com/1.png']
  h.page.previewLicense()
  h.page.previewBrandImages()
  assert.deepEqual(h.previews.map(urls => Array.from(urls)), [
    ['https://cdn.example.com/license.png'],
    ['https://cdn.example.com/1.png'],
  ])

  const wxml = read(DECOR_WXML)
  assert.match(wxml, /arrow="\{\{m\.businessLicense \? true : false\}\}"/)
  assert.match(wxml, /description="\{\{m\.businessLicense \? '' : '入驻时提交，如需更新请联系平台'\}\}"/)
  assert.match(wxml, /arrow="\{\{brandImages\.length \? true : false\}\}"/)
  assert.match(wxml, /description="\{\{brandImages\.length \? '' : '入驻时提交，如需更新请联系平台'\}\}"/)
})

// ---------------------------------------------------------------- CU-M-77

test('CU-M-77 有主推时进页面就要回演出活动名，不得只剩「已选择主推」', () => {
  const h = loadPage(DECOR_JS)
  h.page.data.view = 'coop'

  h.page.load()
  h.requests[0].success({
    code: 200,
    data: { memberId: 3, name: '浪人咖啡', gallery: '[]', tags: '[]', featuredType: 1, featuredId: 33 },
  })

  assert.equal(h.page.data.loadState, 'ok')
  assert.equal(h.requests[1].url, '/api/activity/list', '已有主推必须回查活动名')
  h.requests[1].success({ code: 200, data: { rows: [{ id: 33, name: '城市夜跑' }, { id: 9, name: '别的活动' }] } })
  assert.equal(h.page.data.featuredName, '城市夜跑')

  // 列表里查不到(活动已删或不在首页)⇒ 退回兜底串,不得张冠李戴
  h.page.data.featuredList = [{ id: 9, name: '别的活动' }]
  h.page.syncFeaturedName()
  assert.equal(h.page.data.featuredName, '')

  // 没设主推就不该多发这一发
  const fresh = loadPage(DECOR_JS)
  fresh.page.data.view = 'coop'
  fresh.page.load()
  fresh.requests[0].success({ code: 200, data: { memberId: 3, name: '浪人咖啡', gallery: '[]', tags: '[]' } })
  assert.equal(fresh.requests.length, 1)
})

// ---------------------------------------------------------------- CU-M-79

test('CU-M-79 有效期最早到明天(今天到期=一建就过期),明天放行', () => {
  const h = loadPage('pages/merchant/decor/perks/index.js')
  h.page.data.minValidEnd = '2026-09-25'
  h.page.data.canSave = true
  h.page.data.form = {
    perkType: 0, name: '咖啡券', retailValue: '88', unitCost: '', quota: '20', validEnd: '2026-09-24',
  }

  h.page.save()
  assert.equal(h.requests.length, 0, '今天及更早的有效期不得写入')
  assert.deepEqual(h.toasts, ['有效期至少要到明天'])

  h.page.data.form = Object.assign({}, h.page.data.form, { validEnd: '2026-09-25' })
  h.page.save()
  assert.equal(h.requests.length, 1)
  assert.equal(JSON.parse(h.requests[0].data).validEnd, '2026-09-25', '明天到期是最早的合法值')

  const wxml = read('pages/merchant/decor/perks/index.wxml')
  assert.match(wxml, /<cy-date-field[\s\S]{0,260}start="\{\{minValidEnd\}\}"/, '日历要有下限')
})

// ---------------------------------------------------------------- CU-M-80

test('CU-M-80 未开放自助开通时，升级权益要有可执行的客服入口而不是只弹一句', () => {
  const wxml = read(DECOR_WXML)
  const panel = wxml.split('查看可开通的权益')[1].split('</cy-dropdown>')[0]
  assert.match(panel, /<cy-cell open-type="contact"[^>]*title="联系运营开通"/)

  const js = read(DECOR_JS)
  assert.match(js, /toast\('请点下方「联系运营开通」'\)/)
})

// ---------------------------------------------------------------- CU-M-83

test('CU-M-83 经营类目与行业类型相邻展示时必须各有一行说明消歧', () => {
  const wxml = read(DECOR_WXML)
  assert.match(wxml, /title="经营类目"[\s\S]{0,200}description="自由描述店内主营，用于主页展示"/)
  assert.match(wxml, /title="行业类型"[\s\S]{0,200}description="平台行业分类，单选，用于搜索与推荐"/)
})
