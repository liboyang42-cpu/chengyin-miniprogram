'use strict'

// G6 漫游三条前端契约:
//   CU-C-59 official_event.cover_img 可空 —— 漫游任务卡不能因缺封面只剩一块近黑底色
//           (原码无条件拼 url('{{item.coverImg}}'),null 被插成字面量 → 解析成 /pages/roam/null)
//   CU-M-53 据点核销码缺二维码图时不能算「出码成功」:那条 token 只能靠二维码扫,
//           qr-voucher 的文本退路会把长签名串铺满码区,看着能扫、商家实际扫不出(券发不出)
//   CU-M-55 正在漫游时历史列表必然为空(记录只在结算时写),空态不能说「你还没有开始过」
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function boot(relativePath, globals) {
  globals = globals || {}
  const requests = []
  const timers = []
  const app = Object.assign({
    sendRequest(options) { requests.push(options) },
    getUserID() { return 7 },
    getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.errMsg)) || fallback,
  }, globals.app || {})
  const wx = Object.assign({
    setInterval(callback) { timers.push(callback); return timers.length },
    clearInterval() {},
    showToast() {},
  }, globals.wx || {})
  let definition
  const absolutePath = path.join(ROOT, relativePath)
  const sandbox = {
    Date, Math, Promise, String, Number, Array, Object, JSON,
    setInterval: wx.setInterval,
    clearInterval: wx.clearInterval,
    setTimeout: (callback) => { timers.push(callback); return timers.length },
    clearTimeout() {},
    console,
    getApp() { return app },
    wx,
    require(id) {
      if (!id.startsWith('.')) return require(id)
      return require(path.resolve(path.dirname(absolutePath), id))
    },
  }
  sandbox.Page = (config) => { definition = config }
  sandbox.Component = (config) => { definition = config }
  vm.runInNewContext(read(relativePath), sandbox, { filename: absolutePath })
  const instance = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback.call(this)
    },
    triggerEvent() {},
  })
  Object.entries(definition.methods || {}).forEach(([name, method]) => { instance[name] = method.bind(instance) })
  return { instance, requests, timers }
}

// ───────────────── CU-C-59 缺封面的任务卡 ─────────────────

test('CU-C-59 官方活动缺封面:样式为空走占位块,有封面才拼 url(),引号转义', () => {
  const h = boot('components/cy/scene-roam-task-list/index.js')

  const empty = h.instance._decorate({ id: 1, title: '缺封面活动', coverImg: null, status: 1 })
  assert.equal(empty._coverStyle, '', 'cover_img 为 NULL 时不能拼出 url(null)')
  assert.equal(h.instance._decorate({ id: 2, title: '空串', coverImg: '  ', status: 1 })._coverStyle, '')
  const withCover = h.instance._decorate({ id: 3, title: '有封面', coverImg: 'https://cdn/a b.png', status: 1 })
  assert.equal(withCover._coverStyle, "background-image:url('https://cdn/a b.png')")
  assert.ok(!h.instance._decorate({ id: 4, title: '引号', coverImg: "https://cdn/it's.png", status: 1 })._coverStyle.includes("it's"),
    '封面 URL 里的单引号必须转义,否则整条 style 被截断')

  const wxml = read('components/cy/scene-roam-task-list/index.wxml')
  assert.match(wxml, /style="\{\{item\._coverStyle\}\}"/)
  assert.doesNotMatch(wxml, /item\.coverImg/, 'wxml 不许再直插 coverImg —— null 会变成字面量 null')
  assert.match(wxml, /封面暂不可用/)
})

// ───────────────── CU-M-53 缺二维码图的据点核销码 ─────────────────

test('CU-M-53 据点核销码页:缺二维码图即失败态,有图才 ready', () => {
  const page = boot('subpackageRoam/citynode-code/index.js')
  page.instance.onLoad({ poiId: 'poi-1' })
  assert.equal(page.requests.length, 1)

  page.requests[0].success({ code: 200, data: { code: 'LONGSIGNATURE', qrcodeUrl: '', ttlMs: 60000 } })
  assert.equal(page.instance.data.state, 'error', '有 code 没图 = 没出成码')
  assert.match(page.instance.data.errMsg, /二维码/)
  assert.equal(page.instance.data.qrcodeUrl, '')
  assert.equal(page.instance.data.code, '')

  const good = boot('subpackageRoam/citynode-code/index.js')
  good.instance.onLoad({ poiId: 'poi-1' })
  good.requests[0].success({ code: 200, data: { code: 'OK', qrcodeUrl: 'https://cdn/qr.png', ttlMs: 60000 } })
  assert.equal(good.instance.data.state, 'ready')
  assert.equal(good.instance.data.qrcodeUrl, 'https://cdn/qr.png')
})

test('CU-M-53 据点核销码组件:缺二维码图即失败态,不再落「ready + code 文本」', () => {
  const h = boot('components/cy/scene-qr-citynode/index.js')
  h.instance.issue('poi-1')
  h.requests[0].success({ code: 200, data: { code: 'LONGSIGNATURE', qrcodeUrl: '', ttlMs: 60000 } })
  assert.equal(h.instance.data.state, 'error')
  assert.match(h.instance.data.errorText, /二维码/)
  assert.equal(h.instance.data.countdown, 0)

  const good = boot('components/cy/scene-qr-citynode/index.js')
  good.instance.issue('poi-1')
  good.requests[0].success({ code: 200, data: { code: 'OK', qrcodeUrl: 'https://cdn/qr.png', ttlMs: 60000 } })
  assert.equal(good.instance.data.state, 'ready')
  assert.equal(good.instance.data.qr, 'https://cdn/qr.png')
  assert.equal(good.instance.data.countdown, 60)
})

// ───────────────── CU-M-55 进行中的漫游 ─────────────────

function recoveryStorage(record) {
  return {
    getStorageSync(key) {
      return String(key).endsWith(':recovery') ? record : []
    },
  }
}

test('CU-M-55 正在进行中的漫游:历史空态改口,不再称「还没有开始过」', () => {
  const record = { clientSessionKey: 'a'.repeat(32), sessionId: 0, pendingTiles: [], finishRequested: false }
  const h = boot('components/cy/scene-roam-history/index.js', { wx: recoveryStorage(record) })
  h.instance._load()
  assert.equal(h.instance.data.state, 'ready')
  assert.deepEqual(h.instance.data.list, [])
  assert.equal(h.instance.data.inProgress, true)

  const none = boot('components/cy/scene-roam-history/index.js', { wx: { getStorageSync: () => [] } })
  none.instance._load()
  assert.equal(none.instance.data.inProgress, false, '没有进行中记录时不许凭空出「正在漫游」卡')

  const broken = boot('components/cy/scene-roam-history/index.js', { wx: recoveryStorage({ pois: [] }) })
  broken.instance._load()
  assert.equal(broken.instance.data.inProgress, false, '形状不对的记录不算进行中(validRecovery 同一判据)')

  const wxml = read('components/cy/scene-roam-history/index.wxml')
  assert.match(wxml, /wx:if="\{\{!list\.length && inProgress\}\}"[\s\S]*?正在漫游中[\s\S]*?回到地图/)
  assert.match(wxml, /wx:elif="\{\{!list\.length\}\}"[\s\S]*?出发第一次漫游/)
})
