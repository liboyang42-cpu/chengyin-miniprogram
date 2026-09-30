// 2026-09-16 截图冒烟:pages/topic/merchantinfo/merchantinfo 不带 id 打开时渲染出
// 「未命名路线 · 开放时间待定」的空壳主题页(三条入口分支全不命中:不请求、不报错、也没有出口),
// 而不是与其它详情页一致的缺参提示。
//
// 修法:onLoad 补 else 落 missingParam,wxml 在缺参时渲染 cy-empty kind="missing-param" + 返回出口,
// 并挡掉 project-host / project-join 两个空壳视图。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const PAGE = 'pages/topic/merchantinfo/merchantinfo'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function assertMissingParamBranch(js, wxml) {
  assert.match(js, /missingParam:\s*false/, 'data 必须有 missingParam 位')
  assert.match(js, /else\s*\{\s*\/\/[\s\S]{0,400}?missingParam:\s*true/, 'onLoad 必须为「id 与 topicId 都没有」落缺参态')
  const branch = wxml.match(/<block wx:if="\{\{\s*missingParam\s*\}\}">([\s\S]*?)<\/block>/)
  assert.ok(branch, 'wxml 必须有 missingParam 的独立分支')
  assert.match(branch[1], /cy-empty[^>]*kind="missing-param"/, '缺参分支必须用统一缺参空态')
  assert.match(branch[1], /bind:cta="goBack"/, '缺参态必须有一个真的走得通的出口')
  assert.match(wxml, /<project-host wx:elif="\{\{\s*role === 'host'/, '缺参分支必须接在 project-host 之前(条件链)')
  assert.doesNotMatch(wxml, /<project-host wx:if=/, 'project-host 不该还是链首的 wx:if')
}

function loadPage(source = read(PAGE + '.js')) {
  const requests = []
  let config = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    tips() {},
  }
  const wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    showToast() {}, showLoading() {}, hideLoading() {}, showModal() {},
    navigateBack() {}, navigateTo() {}, redirectTo() {}, reLaunch() {}, switchTab() {}, pageScrollTo() {},
    getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), in: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }) }),
  }
  const context = {
    console,
    getApp: () => app,
    getCurrentPages: () => [],
    Page: (value) => { config = value },
    require: (id) => require(id.startsWith('.') ? path.resolve(ROOT, PAGE.split('/').slice(0, -1).join('/'), id) : id),
    module: { exports: {} },
    exports: {},
    wx,
  }
  const sandbox = vm.createContext(context)
  vm.runInContext(source, sandbox, { filename: path.join(ROOT, PAGE + '.js') })
  assert.ok(config, 'merchantinfo 必须注册 Page')
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) })
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback() }
  return { page, requests }
}

test('merchantinfo 缺 id/topicId ⇒ 落缺参态,而不是渲染空壳主题页', () => {
  assertMissingParamBranch(read(PAGE + '.js'), read(PAGE + '.wxml'))

  const { page, requests } = loadPage()
  page.onLoad({})
  assert.equal(page.data.missingParam, true, '两个参数都没有时必须落缺参态')
  assert.equal(requests.length, 0, '缺参态不请求是对的,但不能什么都不说')

  const withTopic = loadPage()
  withTopic.page.onLoad({ topicId: '22' })
  assert.equal(withTopic.page.data.missingParam, false, '带 topicId 的正常入口不受影响')
})

test('负控:删掉缺参 else 分支(退回空壳主题页)必须判红', () => {
  const source = read(PAGE + '.js')
  const broken = source.replace('this.setData({ missingParam: true });', '')
  assert.notEqual(broken, source, '变异锚点失效:未找到 onLoad 的缺参 else 分支')

  assert.throws(
    () => assertMissingParamBranch(broken, read(PAGE + '.wxml')),
    assert.AssertionError,
    '缺参分支被删掉后必须判红',
  )

  const shell = loadPage(broken)
  shell.page.onLoad({})
  assert.equal(shell.page.data.missingParam, false, '变异体会退回空壳(证明上一条断言不是恒真)')
})

// M-12(2026-09-22 走查):合作中心招商卡 ?id=&scope=MERCHANT 点进详情走玩家接口 info-to-user,
// 它还要求「已对玩家上架」,招商中未上架的主题稳定报「主题活动不存在」。
// 修法是降级而不是整体切换:已上架主题照旧走玩家接口(评分/评论/票务都在那里),
// 只有玩家接口判「不存在」且是商家身份浏览时,才改走与招商列表同口径的 info-to-merchant。
const TOPIC_READ = /\/api\/topic\/info-to-(merchant|user)$/
test('M-12:商家浏览时玩家接口判「不存在」才降级到 info-to-merchant;已上架主题不多打一次', () => {
  const onSale = loadPage()
  onSale.page.onLoad({ id: '71', scope: 'MERCHANT' })
  const first = onSale.requests.filter((r) => TOPIC_READ.test(r.url))
  assert.equal(first[0].url, '/api/topic/info-to-user', '先走玩家接口,保留评分/评论/票务')
  first[0].success({ code: 200, data: { name: '已上架主题', chaptersList: [] } })
  assert.equal(onSale.requests.filter((r) => TOPIC_READ.test(r.url)).length, 1, '玩家接口能读到就不降级')

  const recruiting = loadPage()
  recruiting.page.onLoad({ id: '23', scope: 'MERCHANT' })
  recruiting.requests.find((r) => TOPIC_READ.test(r.url)).success({ code: 500, msg: '主题活动不存在' })
  const reads = recruiting.requests.filter((r) => TOPIC_READ.test(r.url))
  assert.equal(reads.length, 2)
  assert.equal(reads[1].url, '/api/topic/info-to-merchant')
  assert.equal(reads[1].data.id, 23)

  const player = loadPage()
  player.page.onLoad({ id: '23' })
  player.requests.find((r) => TOPIC_READ.test(r.url)).success({ code: 500, msg: '主题活动不存在' })
  assert.equal(player.requests.filter((r) => TOPIC_READ.test(r.url)).length, 1, '非商家身份不得借商家接口绕过玩家可见性')

  // 负控:删掉降级分支,招商中未上架主题必须重新落回「不存在」(即本 bug)
  const source = read(PAGE + '.js')
  const broken = source.replace('            that.loadBrowseData(true);\n            return;\n', '')
  assert.notEqual(broken, source, '变异锚点失效')
  const reverted = loadPage(broken)
  reverted.page.onLoad({ id: '23', scope: 'MERCHANT' })
  reverted.requests.find((r) => TOPIC_READ.test(r.url)).success({ code: 500, msg: '主题活动不存在' })
  assert.equal(reverted.requests.filter((r) => TOPIC_READ.test(r.url)).length, 1)
})
