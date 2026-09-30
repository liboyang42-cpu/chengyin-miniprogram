// 2026-09-16 截图冒烟:参与详情深链页 subpackageMember/mycanyuinfo/mycanyuinfo?id=<报名id> 打开后
// 恒显示「缺少参与记录 · 请返回列表重新进入」,而且全程一个请求都不发(拦截 app.sendRequest 为空)。
//
// 根因:深链壳的 id 是在页面 onLoad 里 setData 进去的 —— 组件 attached 那一刻属性值还是初始空串,
// 旧实现只在 attached 读一次 recordId,后到的属性没有观察器接手,于是永远停在缺参态。
// 修法:recordId 加属性观察器,与 attached 共用 _applyRecordId(同一 id 去重,不会重复拉)。
//
// 本文件的负控把观察器整块删掉后**真跑一遍**,证明「永远缺参、零请求」这个病灶可复现,
// 而不是拿一句源码断言自证。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT = 'subpackageMember/components/scene-member-participation-detail/index'
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 装载组件定义原样(不能摊平成 Page:观察器正是被测对象)。 */
function loadComponent(source) {
  const requests = []
  let config = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (options) => requests.push(options),
    tips() {},
  }
  const context = {
    getApp: () => app,
    Component: (value) => { config = value },
    console,
    module: { exports: {} },
    exports: {},
    wx: {
      showToast() {}, showLoading() {}, hideLoading() {},
      navigateTo() {}, navigateBack() {}, redirectTo() {}, switchTab() {}, reLaunch() {},
    },
    require: (id) => (id.startsWith('.')
      ? require(path.resolve(ROOT, 'subpackageMember/components/scene-member-participation-detail', id))
      : require(id)),
  }
  const sandbox = vm.createContext(context)
  vm.runInContext(source, sandbox, { filename: path.join(ROOT, COMPONENT + '.js') })

  assert.ok(config, '参与详情必须注册 Component')
  const ctx = {
    data: Object.assign({}, config.data, { recordId: '' }),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent() {},
  }
  Object.assign(ctx, config.methods)
  return { config, ctx, requests }
}

test('深链壳 id 后到:attached 读到空 → 属性更新后必须发请求并进 ready', () => {
  const { config, ctx, requests } = loadComponent(read(COMPONENT + '.js'))

  // ① 深链首帧:页面 onLoad 的 setData 还没落到组件属性上,attached 看到的是空串
  config.lifetimes.attached.call(ctx)
  assert.equal(ctx.data.loadState, 'missing-param', '首帧缺参该有提示(这条行为不变)')
  assert.equal(requests.length, 0, '此刻确实没得可拉')

  // ② 属性后到:必须有观察器接手
  assert.equal(typeof (config.observers && config.observers.recordId), 'function',
    'recordId 必须有属性观察器,否则后到的 id 永远没人处理')
  config.observers.recordId.call(ctx, '43')

  assert.equal(ctx.data.loadState, 'loading', '加载请求发出后不得还停在缺参死文字上')
  assert.equal(requests.length, 1, 'id 到位后必须真的发请求')
  assert.equal(requests[0].url, '/api/registration/info')
  // 跨 realm 的对象原型不同,别用 deepStrictEqual(会报 same structure but not reference-equal)
  assert.equal(requests[0].data && requests[0].data.id, '43')

  requests[0].success({ code: '200', data: { id: 43, ownerType: 1 } })
  assert.equal(ctx.data.loadState, 'ready', '真实回包必须能落到 ready')
})

test('同一 id 只拉一次:attached 与观察器都触发也不重复请求', () => {
  const { config, ctx, requests } = loadComponent(read(COMPONENT + '.js'))
  ctx.data.recordId = '77'
  config.lifetimes.attached.call(ctx)
  config.observers.recordId.call(ctx, '77')
  assert.equal(requests.length, 1, '同一 id 重复触发只能有一次请求')
})

test('负控:删掉 recordId 观察器(退回只读 attached)必须复现「永远缺参 + 零请求」', () => {
  const source = read(COMPONENT + '.js')
  const broken = source.replace(
    /  observers: \{\n    recordId\(value\) \{\n      this\._applyRecordId\(value\)\n    \},\n  \},\n/,
    '',
  )
  assert.notEqual(broken, source, '变异锚点失效:未找到 recordId 观察器')

  const { config, ctx, requests } = loadComponent(broken)
  config.lifetimes.attached.call(ctx)
  assert.equal(!!(config.observers && config.observers.recordId), false, '变异体不该再有观察器')
  assert.equal(ctx.data.loadState, 'missing-param', '变异体必须停在缺参态')
  assert.equal(requests.length, 0, '变异体必须复现「一个请求都不发」的病灶')
  assert.throws(
    () => assert.equal(requests.length, 1, '变异体不能通过「id 到位后会发请求」这条'),
    assert.AssertionError,
  )
})
