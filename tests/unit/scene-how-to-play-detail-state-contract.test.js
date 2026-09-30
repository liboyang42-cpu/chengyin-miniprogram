const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'subpackageA/components/scene-how-to-play-detail/index.js')

function loadComponent() {
  const sandbox = { requests: [], toasts: [] }
  global.getApp = () => ({ sendRequest: (options) => sandbox.requests.push(options) })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {
    showToast: (options) => sandbox.toasts.push(options),
    setNavigationBarTitle: () => { throw new Error('scene 组件不得改宿主导航标题') },
  }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const vm = Object.assign({}, sandbox.def, {
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent() {},
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.def.data))
  vm.data.id = 'article-1'
  return { vm, sandbox }
}

test('200 空对象/null/空正文进入内容缺失态，不崩溃也不渲空文章', () => {
  for (const data of [null, undefined, {}, { title: '只有标题', contents: '' }, { title: '', contents: '   ' }]) {
    const { vm, sandbox } = loadComponent()
    vm.getDetail()
    assert.doesNotThrow(() => sandbox.requests[0].success({ code: 200, data }))
    assert.equal(vm.data.loading, false)
    assert.equal(vm.data.empty, true)
    assert.equal(vm.data.error, false)
    assert.deepEqual(vm.data.contentNodes, [])
  }
})

test('有效正文进入内容态；scene 不覆盖宿主原生导航标题', () => {
  const { vm, sandbox } = loadComponent()
  vm.getDetail()
  sandbox.requests[0].success({ code: '200', data: { contents: '<p>怎么玩</p>', createTime: '2026-08-23' } })
  assert.equal(vm.data.loading, false)
  assert.equal(vm.data.empty, false)
  assert.equal(vm.data.detailData.title, '玩法说明')
  assert.match(vm.data.contentNodes, /怎么玩/)
  assert.equal(sandbox.toasts.length, 0)

  const source = fs.readFileSync(MODULE, 'utf8')
  assert.doesNotMatch(source, /setNavigationBarTitle/)
})

test('请求失败只显示持久错误态，不叠一次性 toast', () => {
  const { vm, sandbox } = loadComponent()
  vm.getDetail()
  sandbox.requests[0].fail({ errMsg: 'offline' })
  assert.equal(vm.data.error, true)
  assert.equal(vm.data.loading, false)
  assert.equal(sandbox.toasts.length, 0)
})

test('wxml 四态互斥，空正文给真实返回出口；scene 高度服从宿主', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackageA/components/scene-how-to-play-detail/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'subpackageA/components/scene-how-to-play-detail/index.wxss'), 'utf8')
  assert.match(wxml, /wx:elif="\{\{empty\}\}"/)
  assert.match(wxml, /这篇玩法说明暂时没有内容/)
  assert.match(wxml, /bind:cta="onBack"/)
  assert.match(wxml, /wx:else class="detail-content cy-fade-in"/)
  assert.doesNotMatch(wxss, /min-height:\s*100vh/)
  assert.match(wxss, /\.hpd\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s)
})

test('negative control:重新读取空 data.contents 或弹 toast 会判红', () => {
  const source = fs.readFileSync(MODULE, 'utf8')
  assert.doesNotMatch(source, /res\.data\.contents/)
  assert.doesNotMatch(source, /showToast/)
})
