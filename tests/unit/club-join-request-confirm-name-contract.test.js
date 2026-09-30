// CU-C-95 / CU-C-96 · 入会审批页(C07)
// CU-C-95:两个确认层都没把申请人显示名传进去 —— 通过写死「通过入会申请」,拒绝只给 dangerKey,
//         标题模板里的 {name} 落到中性兜底「这一项」。相邻申请连着点时,最后一步核对不了点的是谁。
// CU-C-96:待审为 0 时顶部状态条与页面中央空态说的是同一句「暂无待审申请」,同屏重复。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·modal.js

const ROOT = path.resolve(__dirname, '../..')
const PAGE = 'pages/club/join-requests/index.js'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function applyDataPatch(target, patch) {
  Object.keys(patch).forEach((key) => { target[key] = patch[key] })
}

function mount() {
  let definition
  const requests = []
  const modals = []
  const toasts = []
  const app = {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    sendRequest(options) { requests.push(options) },
  }
  vm.runInNewContext(read(PAGE), {
    getApp: () => app,
    Page(config) { definition = config },
    require(request) {
      if (request === '../../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'))
      throw new Error(`unexpected require: ${request}`)
    },
    JSON,
    String,
    wx: {
      navigateBack() {},
      switchTab() {},
      redirectTo() {},
      stopPullDownRefresh() {},
      // 只记录弹窗参数,不替用户点确认 —— 这里要断的就是确认层文案
      showModal(options) { modals.push(options) },
      showToast(options) { toasts.push(options) },
    },
  }, { filename: path.join(ROOT, PAGE) })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch) { applyDataPatch(this.data, patch) },
  })
  return { page, requests, modals, toasts }
}

function openWithRequests(rows) {
  const harness = mount()
  harness.page.onLoad({ clubId: '9' })
  assert.equal(harness.requests[0].url, '/api/club/join-requests')
  harness.requests[0].success({ code: '200', data: rows })
  return harness
}

const TWO_APPLICANTS = [
  { id: 1, memberId: 901, nickname: '小林', joinTime: '2026-09-23 10:00:00', joinMessage: '住得近' },
  { id: 2, memberId: 902, nickname: '阿照', joinTime: '2026-09-23 11:00:00', joinMessage: '' },
]

test('通过/拒绝的确认层都写上申请人姓名，不再用「这一项」兜底', () => {
  const approve = openWithRequests(TWO_APPLICANTS)
  approve.page.approve({ currentTarget: { dataset: { memberId: 902 } } })
  assert.equal(approve.modals.length, 1)
  assert.equal(approve.modals[0].title, '通过「阿照」的入会申请',
    '通过确认层必须指名道姓 —— 相邻申请连着点时才知道点的是谁')

  const reject = openWithRequests(TWO_APPLICANTS)
  reject.page.reject({ currentTarget: { dataset: { memberId: 901 } } })
  assert.equal(reject.modals.length, 1)
  assert.equal(reject.modals[0].title, '拒绝「小林」的入会申请?')
  assert.doesNotMatch(reject.modals[0].title, /这一项/, '缺参兜底词不该再出现')
})

test('拿不到该行昵称时退回中性称呼，不显示 memberId 或少一个占位', () => {
  const harness = openWithRequests([{ id: 3, memberId: 903, joinTime: '2026-09-23 11:00:00' }])
  harness.page.approve({ currentTarget: { dataset: { memberId: 903 } } })
  assert.equal(harness.modals[0].title, '通过「城瘾玩家」的入会申请')
})

test('待审为 0 时顶部状态条不再重复空态的「暂无待审申请」', () => {
  const empty = openWithRequests([])
  assert.equal(empty.page.data.introText, '可直接通过或拒绝',
    '中央空态已经写着「暂无待审申请」,顶部条只留动作口径(CU-C-133:数谁能处理的名单会漏掉被委派成员)')
  assert.doesNotMatch(empty.page.data.introText, /暂无待审申请/)

  const busy = openWithRequests(TWO_APPLICANTS)
  assert.equal(busy.page.data.introText, '2 条待审 · 可直接通过或拒绝')

  // 空态那一句本身要留着 —— 这次是去重叠,不是把提示删掉
  assert.match(read('pages/club/join-requests/index.wxml'), /title="暂无待审申请"/)
})
