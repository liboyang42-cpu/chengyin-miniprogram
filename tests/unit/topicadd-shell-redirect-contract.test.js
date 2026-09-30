'use strict'

// topicadd 已退役成兼容壳,唯一职责是把历史页面栈上的旧入口转到 fabu。
// 已有的退役契约只断言「什么不该在」(没有 input / 按钮 / 旧方法),
// 没有断言「转得对不对」—— 那才是这个壳存在的全部理由:
//   · 用 navigateTo 代替 redirectTo ⇒ 壳留在页面栈里,用户按返回又落回壳、又被转走,永远退不出去
//   · 漏传 clubId ⇒ 俱乐部发团丢掉归属,后端按无俱乐部处理
//   · 漏传 mode   ⇒ fabu 的 entryMode 静默默认 1,自由探索的人被塞进城市定向且不报错
// 三条都能让静态断言全绿而功能是坏的,所以这里真跑一次 onLoad 看它实际调了什么。

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const SHELL = path.resolve(__dirname, '../../pages/publish/topicadd/topicadd.js')

/** 真跑一次壳的 onLoad,返回它对 wx 的调用记录 */
function runShell(options) {
  const calls = { redirectTo: [], navigateTo: [], reLaunch: [], switchTab: [] }
  let pageConfig = null

  const prevPage = global.Page
  const prevWx = global.wx
  global.Page = (c) => { pageConfig = c }
  global.wx = {
    redirectTo: (o) => calls.redirectTo.push(o && o.url),
    navigateTo: (o) => calls.navigateTo.push(o && o.url),
    reLaunch: (o) => calls.reLaunch.push(o && o.url),
    switchTab: (o) => calls.switchTab.push(o && o.url),
  }
  try {
    delete require.cache[require.resolve(SHELL)]
    require(SHELL)
    assert.ok(pageConfig && typeof pageConfig.onLoad === 'function', 'topicadd 壳必须仍然注册 Page 且有 onLoad')
    pageConfig.onLoad(options)
  } finally {
    global.Page = prevPage
    global.wx = prevWx
  }
  return calls
}

test('壳必须用 redirectTo 转走,不能用 navigateTo 把自己留在页面栈里', () => {
  const calls = runShell({ mode: '2' })
  assert.equal(calls.navigateTo.length, 0, '用了 navigateTo:壳会留在页面栈,用户按返回会被无限转回来')
  assert.equal(calls.redirectTo.length, 1, '壳必须且只能 redirectTo 一次')
  assert.match(calls.redirectTo[0], /^\/pages\/publish\/fabu\/index/, '必须转到 fabu')
})

test('三个参数必须原样透传 —— 漏一个都会静默改变落地行为', () => {
  const url = runShell({ templateName: '外滩夜行档案', mode: '2', clubId: '77' }).redirectTo[0]
  const query = url.slice(url.indexOf('?') + 1)
  const got = Object.fromEntries(query.split('&').map((kv) => {
    const i = kv.indexOf('=')
    return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]
  }))
  assert.equal(got.templateName, '外滩夜行档案', '丢了 templateName:用户刚起的名字没了')
  assert.equal(got.mode, '2', '丢了 mode:fabu 会静默默认成城市定向(1),自由探索的人被改了玩法且不报错')
  assert.equal(got.clubId, '77', '丢了 clubId:俱乐部发团丢掉归属')
})

test('没有参数时转到裸 fabu,不能拼出空 query', () => {
  const url = runShell({}).redirectTo[0]
  assert.equal(url, '/pages/publish/fabu/index', `裸入口不该带 query,实际:${url}`)
})

test('onLoad 不传参数也不能炸 —— 历史页面栈恢复时 options 可能是 undefined', () => {
  assert.doesNotThrow(() => runShell(undefined))
})
