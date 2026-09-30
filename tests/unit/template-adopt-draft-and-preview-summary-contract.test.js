'use strict'

// CU-M-68 采用公开玩法后保存草稿必须真落库。
//   病灶:data.id 在「本人草稿续编」时是 cms_member_template.id,从货架/公开库进来时却是
//         cms_template_library.id;saveDraft 不问来历一律把它发给 /api/template/draft,
//         后端按 cms_member_template + memberId 归属查行 → 必然抛错,草稿零写入。
//   修法:只有 scope=my 才带 id;采用态只带 originalTemplateId(后端据此新建草稿并保留来源)。
//
// CU-M-69 「保存前摘要」必须按当前表单算。
//   病灶:摘要直插预览状态机字段 pvMethodLabel,初值恰好是「无需验证」,只有预览走到
//         「点位任务」那一步才被覆盖 ⇒ 一打开预览先说无需验证,同屏第 3 步又要求作答;
//         时长也只印裸数字「5」。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const TEMP_PAGE = '../../pages/publish/temp/index.js'

let appStub
let requests

function installGlobals() {
  appStub = {
    globalData: { nickname: '商家', statusBarHeight: 20, navBarHeight: 44 },
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    getUserID: () => 9004,
    getAuthorization: () => 'Bearer test',
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest: (options) => { requests.push(options); return { abort() {} } },
    chooseImage: () => {},
    chooseDocument: () => {},
    tips: () => {},
  }
  global.getApp = () => appStub
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    showToast: () => {},
    hideLoading: () => {},
    showLoading: () => {},
    nextTick: (cb) => cb(),
    navigateTo() {},
    redirectTo() {},
    navigateBack() {},
    reLaunch() {},
    createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }) }),
  }
}

function loadPage(relative) {
  let config
  global.Page = (value) => { config = value }
  const absolute = require('node:path').resolve(__dirname, relative)
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let cursor = this.data
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (cursor[parts[i]] == null) cursor[parts[i]] = {}
        cursor = cursor[parts[i]]
      }
      cursor[parts[parts.length - 1]] = patch[key]
    })
    if (callback) callback()
  }
  return page
}

// 采用公开库玩法:与真实回填同形的一条 cms_template_library 行(validation_method=1)
const LIBRARY_TEMPLATE = {
  id: 16,
  title: 'CU样板·今晚的暗号',
  description: '到店对上暗号',
  players: '2人',
  duration: 5,
  validationMethod: 1,
  questionName: '今晚的暗号是什么',
  questionAnswer: '风铃',
  status: 1,
}

function adoptLibraryTemplate(id) {
  const page = loadPage(TEMP_PAGE)
  page.onLoad({ id: String(id || 16) })
  const request = requests.filter((item) => item.url === '/api/template/info')[0]
  assert.ok(request, '从货架进来必须走 /api/template/info 回填')
  request.success({ code: '200', data: JSON.parse(JSON.stringify(LIBRARY_TEMPLATE)) })
  page.validateForm = () => true
  return page
}

function draftBody(page) {
  page.saveDraft()
  const draft = requests.filter((item) => item.url === '/api/template/draft').at(-1)
  assert.ok(draft, '必须发起保存草稿请求')
  return JSON.parse(draft.data)
}

beforeEach(() => {
  requests = []
  installGlobals()
})

test('CU-M-68 采用公开库玩法:草稿不带库 id,只带 originalTemplateId', () => {
  const page = adoptLibraryTemplate(16)
  assert.equal(page.data.isMyScope, false, '非 scope=my 进来的 id 不是本人草稿 id')

  const body = draftBody(page)
  assert.equal(body.id, undefined, '库 id 当草稿 id 发出去 → 后端按归属查行必抛错,草稿零写入')
  assert.equal(body.originalTemplateId, 16, '来源 id 要留着,后端据此建新草稿并记来源')
  assert.equal(body.status, 0)
})

// 集成复审:采用后第一次存草稿建了新草稿,留在页里再存一次必须更新这份,不能再建一份重复草稿
test('CU-M-68 采用后首存成功即切到本人草稿:再存带新草稿 id', () => {
  const page = adoptLibraryTemplate(16)
  page.data.from = 'fabu'
  page.getOpenerEventChannel = () => null
  draftBody(page)
  const first = requests.filter((item) => item.url === '/api/template/draft').at(-1)
  first.success({ code: '200', data: 9101 })
  assert.equal(page._templateId, 9101)
  assert.equal(Object.hasOwn(page.data, 'id'), false)
  assert.equal(page.data.isMyScope, true)

  const second = draftBody(page)
  assert.equal(second.id, 9101, '第二次保存要更新刚建的草稿,不是再建一份')
})

test('CU-M-68 本人草稿续编仍带原 id(不能把 R9-04 的续编改回新建)', () => {
  const page = loadPage(TEMP_PAGE)
  page.onLoad({ id: '6029', scope: 'my' })
  const request = requests.filter((item) => item.url === '/api/template/myinfo')[0]
  assert.ok(request, 'scope=my 必须查个人草稿接口')
  request.success({ code: '200', data: Object.assign({}, LIBRARY_TEMPLATE, { id: 6029 }) })
  page.validateForm = () => true

  const body = draftBody(page)
  assert.equal(body.id, 6029, '续编必须更新原草稿而不是另建一份')
})

test('CU-M-69 摘要按表单真值算:问答型不许写成「无需验证」,时长带单位', () => {
  const page = adoptLibraryTemplate(16)
  assert.equal(page.data.formData.validationMethod, 1)
  assert.equal(page.data.summaryMethodLabel, '文字作答', '完成方式必须与同一屏第 3 步的真值一致')
  assert.equal(page.data.summaryDurationText, '5分钟', '时长不能只印裸数字')
  assert.notEqual(page.data.summaryMethodLabel, '无需验证')
})

test('CU-M-69 改完成方式/换玩法:摘要立即跟上,不等预览切步', () => {
  const page = adoptLibraryTemplate(16)

  page.selectValidationMethod({ currentTarget: { dataset: { value: 2 } } })
  assert.equal(page.data.summaryMethodLabel, '拍照打卡')

  // 选了高级玩法就报玩法的名字(十九个玩法里有十二个 validationMethod 都是 0)
  page.setData({ gameCurrent: { label: '抛硬币' } })
  page.refreshPreviewState()
  assert.equal(page.data.summaryMethodLabel, '抛硬币')

  // 时长已带小时口径时不再叠一个「分钟」
  page.setData({ formData: Object.assign({}, page.data.formData, { duration: '1小时' }) })
  page.refreshPreviewState()
  assert.equal(page.data.summaryDurationText, '1小时')
})

test('CU-M-69 摘要那两句不再引用预览状态机字段', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/publish/temp/index.wxml'), 'utf8')
  const summary = wxml.match(/<view class="cg-publish-summary__text">[\s\S]*?<\/view>/)
  assert.ok(summary, '保存前摘要那一行还在')
  assert.match(summary[0], /summaryMethodLabel/)
  assert.match(summary[0], /summaryDurationText/)
  assert.doesNotMatch(summary[0], /pvMethodLabel|durationText \|\|/)
})
