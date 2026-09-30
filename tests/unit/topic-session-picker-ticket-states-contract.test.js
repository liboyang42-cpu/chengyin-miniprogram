'use strict'

// CU-C-131(2026-09-24 走查)· 报名失败却提示「操作成功」。
//
// 俱乐部月历 → 合作主题 → 立即报名,选票种弹层同屏出现「票种没读出来」+「操作成功」,
// 只能重试且重试永远同一个矛盾提示。根因两条:
//   ① 后端只在真有票时才下发 omsTicketList(ApiActivityController.java:995 的 size()>0 分支),
//      所以成功体里没这个字段是**这一场没放票**,不是读取失败;
//   ② 组件把整个 res 交给 getRequestErrorMessage,而 safeUserMessage 的规则表不拦成功回执
//      「操作成功」⇒ 成功文案被当成错误原因渲染进 cy-error 的 sub。
// 现在:成功体缺字段 → empty 态;只有业务失败体才进 error 态并回显后端原因。
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const COMPONENT = 'pages/topic/components/cy/session-picker/index.js'
const WXML = 'pages/topic/components/cy/session-picker/index.wxml'
const safeUserMessage = require(path.join(ROOT, 'utils/transport/safe-user-message.js')).safeUserMessage

/** 真实消毒口径:错误原因一律过 safeUserMessage,和 app.getRequestErrorMessage 一致。 */
function loadComponent(source) {
  const requests = []
  let definition
  const file = path.join(ROOT, COMPONENT)
  vm.runInNewContext(source == null ? fs.readFileSync(file, 'utf8') : source, {
    Component: (config) => { definition = config },
    getApp: () => ({
      sendRequest: (options) => { requests.push(options); return { abort() {} } },
      getRequestErrorMessage: (res, fallback) => safeUserMessage(res, fallback || '请求失败，请稍后重试'),
    }),
    console,
  })
  const vmInstance = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb.call(this) },
    triggerEvent() {},
  })
  return { vm: vmInstance, requests }
}

const TICKETS = { omsTicketList: [{ id: 5, name: '单人票', price: 88 }] }

test('成功体缺 omsTicketList 是「没放票」的空态,不是读取失败(CU-C-131 复现)', () => {
  const { vm, requests } = loadComponent()
  vm.pickActivity(9)
  requests[0].success({ code: 200, msg: '操作成功', data: { id: 9, name: '夜行' } })

  assert.equal(vm.data.ticketsState, 'empty')
  assert.doesNotMatch(vm.data.ticketsError, /操作成功/, '成功回执不得当错误原因展示')
  assert.equal(vm.data.ticketsError, '')
  assert.equal(vm.data.pickedTicketId, 0, '没有票就不该有可选中的票')
})

test('票种为空数组同样是空态(已有的分支不许被改坏)', () => {
  const { vm, requests } = loadComponent()
  vm.pickActivity(9)
  requests[0].success({ code: 200, msg: '操作成功', data: { omsTicketList: [] } })
  assert.equal(vm.data.ticketsState, 'empty')
})

test('业务失败体才进 error 态,并回显消毒后的原因', () => {
  const { vm, requests } = loadComponent()
  vm.pickActivity(9)
  requests[0].success({ code: 500, msg: '活动不存在' })
  assert.equal(vm.data.ticketsState, 'error')
  assert.equal(vm.data.ticketsError, '活动不存在')
})

test('有票时正常进 ready', () => {
  const { vm, requests } = loadComponent()
  vm.pickActivity(9)
  requests[0].success({ code: 200, msg: '操作成功', data: TICKETS })
  assert.equal(vm.data.ticketsState, 'ready')
  assert.deepEqual(vm.data.tickets.map((t) => t.id), [5])
})

test('单场次空态不劝人「换一个日期」(只有一场可选)', () => {
  const wxml = fs.readFileSync(path.join(ROOT, WXML), 'utf8')
  const emptyBlock = /ticketsState === 'empty'[\s\S]*?\/>/.exec(wxml)
  assert.ok(emptyBlock, 'cy-empty 空态分支还在')
  assert.match(emptyBlock[0], /singleDay/, '单场次要有自己的下一步说法')
})

test('负控:撤掉修复(成功体也走 error+回显 msg)时,复现用例必须真红', () => {
  const current = fs.readFileSync(path.join(ROOT, COMPONENT), 'utf8')
  const regressed = current.replace(
    /          if \(!rows && d\) \{[\s\S]*?\n          \}\n/,
    ''
  )
  assert.notEqual(regressed, current, '负控锚点失效:empty 分支已改名,扫描口径需同步')
  const { vm, requests } = loadComponent(regressed)
  vm.pickActivity(9)
  requests[0].success({ code: 200, msg: '操作成功', data: { id: 9, name: '夜行' } })
  assert.throws(() => assert.equal(vm.data.ticketsState, 'empty'), assert.AssertionError)
  assert.equal(vm.data.ticketsState, 'error')
  assert.equal(vm.data.ticketsError, '操作成功', '这就是走查看到的矛盾提示')
})
