'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'pages/templatedetail/templatedetail.js')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadPage() {
  const requests = []
  const tips = []
  let definition
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (response, fallback) => (response && (response.msg || response.errMsg)) || fallback,
    getUserRole: () => 'user',
    getUserType: () => 'user',
    sendRequest: (options) => requests.push(options),
    tips: (message) => tips.push(message),
  })
  global.Page = (config) => { definition = config }
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    nextTick: (done) => done(),
    createSelectorQuery: () => ({
      in() { return this },
      select() { return this },
      boundingClientRect() { return this },
      exec(done) { done([]) },
    }),
  }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
  })
  return { page, requests, tips }
}

test('「分享玩法」是真实小程序分享按钮，不是只关弹层的假入口', () => {
  const wxml = read('pages/templatedetail/templatedetail.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.match(wxml, /<button\b[^>]*class="xb-sheet-item"[^>]*open-type="share"[^>]*bindtap="onShare"[^>]*>分享玩法<\/button>/s)
  assert.doesNotMatch(wxml, /<view\b[^>]*bindtap="onShare"[^>]*>分享玩法<\/view>/s)
  assert.match(read('pages/templatedetail/templatedetail.js'), /onShareAppMessage\(\)/)
})

test('节点预览不判对错，完成后关闭并清理上次输入', () => {
  const h = loadPage()
  h.page.data.popDavid = true
  h.page.onSelectOption({ currentTarget: { dataset: { value: '选项内容', option: 'A' } } })
  assert.equal(h.page.data.canSubmitPreview, true)
  h.page.completePreview()
  assert.equal(h.page.data.popDavid, false)
  assert.equal(h.page.data.canSubmitPreview, false)
  assert.equal(h.page.data.selectedOptionKey, '')
  assert.equal(h.page.data.inputAnswer, '')
  assert.deepEqual(h.tips, [], '预览不应假装校验后再用 tips 拒绝')

  const wxml = read('pages/templatedetail/templatedetail.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(wxml, /只展示题面与作答方式，不判断对错/)
  assert.equal((wxml.match(/bindtap="completePreview"/g) || []).length, 2)
  assert.equal((wxml.match(/>完成预览<\/cy-btn>/g) || []).length, 2)
  assert.doesNotMatch(wxml, /试玩验证\s*›|bind:disabledtap="validateAnswer"/)
  assert.doesNotMatch(read('pages/templatedetail/templatedetail.js'), /validateAnswer\(\)[\s\S]*请先报名参与活动/)
})

test('详情请求静默失败并在页内保留真实错误文案', () => {
  const h = loadPage()
  h.page.data.id = 8
  h.page.getData()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].hideLoading, true)
  assert.equal(h.requests[0].silentError, true)
  h.requests[0].fail({ msg: '玩法详情暂时不可用' })
  h.requests[0].complete()
  assert.equal(h.page.data.loading, false)
  assert.equal(h.page.data.loadError, true)
  assert.equal(h.page.data.loadErrorMsg, '玩法详情暂时不可用')
  assert.deepEqual(h.tips, [])

  const wxml = read('pages/templatedetail/templatedetail.wxml')
  assert.match(wxml, /<cy-error\b[^>]*sub="\{\{loadErrorMsg\}\}"[^>]*bind:retry="onRetry"/s)
})

test('更多操作与预览链接使用图标库，不用文字符号伪造图标', () => {
  const wxml = read('pages/templatedetail/templatedetail.wxml')
  const json = JSON.parse(read('pages/templatedetail/templatedetail.json'))
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.match(wxml, /class="xb-more"[^>]*>[\s\S]*<cy-icon name="more"/)
  // 2026-08-26 能力 tab 压成标签行:「查看预览」行变成动作 chip,文案挪进 js 的 chip 数据,
  // 所以锚点两边各钉一半 —— 意图不变:预览入口必须用图标库,不许拿 › 文字冒充箭头。
  const js = fs.readFileSync(path.join(__dirname, '../../pages/templatedetail/templatedetail.js'), 'utf8')
  assert.match(wxml, /class="xb-chip xb-chip--act"[\s\S]*<cy-icon name="arrow-right"/)
  assert.match(js, /text:\s*'节点预览',\s*action:\s*'preview'/)
  assert.doesNotMatch(wxml, />···<|>试玩验证 ›</)
})

test('负控：分享退回普通 view 必须判红', () => {
  const source = read('pages/templatedetail/templatedetail.wxml')
  assert.match(source, /open-type="share"/)
  const broken = source.replace(/<button([^>]*)open-type="share"([^>]*)>分享玩法<\/button>/, '<view$1$2>分享玩法</view>')
  assert.notEqual(broken, source, '负控锚点失效')
  assert.doesNotMatch(broken, /open-type="share"/)
})
