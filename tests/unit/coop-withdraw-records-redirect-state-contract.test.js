const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = 'pages/coop/withdraw/records/index.js'
const WXML = fs.readFileSync(path.join(ROOT, 'pages/coop/withdraw/records/index.wxml'), 'utf8')

function loadPage(mutate) {
  let source = fs.readFileSync(path.join(ROOT, JS_PATH), 'utf8')
  if (mutate) {
    const changed = mutate(source)
    assert.notEqual(changed, source, '负控锚点失效')
    source = changed
  }
  const redirects = []
  let definition
  const app = { globalData: { statusBarHeight: 20, navBarHeight: 44 } }
  const sandbox = {
    getApp: () => app,
    Page: (value) => { definition = value },
    require: (id) => id.includes('merchant-theme')
      ? { merchantPageShow() {}, merchantPageRestore() {} }
      : require(path.resolve(path.dirname(path.join(ROOT, JS_PATH)), id)),
    wx: { redirectTo: (options) => redirects.push(options) },
  }
  vm.runInNewContext(source, sandbox, { filename: JS_PATH })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { page, redirects }
}

test('历史提现深链跳转中有可感知状态，失败可原步重试且同步防重复', () => {
  const { page, redirects } = loadPage()
  page.onLoad()
  assert.equal(page.data.state, 'redirecting')
  assert.equal(redirects.length, 1)

  page.retryRedirect()
  assert.equal(redirects.length, 1, '跳转在途时重复点击不得发出第二次 redirectTo')

  redirects[0].fail({ errMsg: 'redirectTo:fail route not found' })
  assert.equal(page.data.state, 'error')
  assert.match(page.data.message, /打开失败/)

  page.retryRedirect()
  assert.equal(redirects.length, 2)
  assert.equal(page.data.state, 'redirecting')

  redirects[0].fail({ errMsg: 'late duplicate callback' })
  assert.equal(page.data.state, 'redirecting', '上一次跳转的迟到回调不得覆盖本次重试')
})

test('页面卸载后迟到回调不得再写页面状态', () => {
  const { page, redirects } = loadPage()
  page.onLoad()
  page.onUnload()
  redirects[0].fail({ errMsg: 'late' })
  assert.equal(page.data.state, 'redirecting')
})

test('WXML 不再是空壳：跳转与失败状态具备 loading/alert 语义和真实重试动作', () => {
  assert.match(WXML, /<cy-empty\b[^>]*wx:if="\{\{state === 'redirecting'\}\}"[^>]*kind="loading"/s)
  assert.match(WXML, /<cy-error\b[^>]*wx:elif="\{\{state === 'error'\}\}"[^>]*bind:retry="retryRedirect"/s)
})

test('epoch 判据负控：删除迟到回调保护后必须真红', () => {
  const { page, redirects } = loadPage((source) => source.replaceAll(
    'if (epoch !== this._redirectEpoch) return;',
    ''
  ))
  page.onLoad()
  redirects[0].fail({ errMsg: 'first' })
  page.retryRedirect()
  redirects[0].fail({ errMsg: 'late duplicate callback' })
  assert.notEqual(page.data.state, 'redirecting', '负控应复现旧回调覆盖新重试')
})
