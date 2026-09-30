const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath)
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : ''
}

const SOURCE = {
  app: JSON.parse(read('app.json')),
  settingsWxml: read('pages/shezhi/shezhi.wxml'),
  settingsJs: read('pages/shezhi/shezhi.js'),
  aboutWxml: read('pages/shezhi/about/index.wxml'),
  aboutJs: read('pages/shezhi/about/index.js'),
  aboutJson: read('pages/shezhi/about/index.json'),
}

function registeredRoutes(app) {
  const routes = new Set((app.pages || []).map((page) => `/${page}`))
  for (const pack of app.subPackages || app.subpackages || []) {
    for (const page of pack.pages || []) routes.add(`/${pack.root}/${page}`)
  }
  return routes
}

function assertAboutEntry(source) {
  const entry = source.settingsWxml.match(/<cy-cell\b[^>]*bind:tap="goAbout"[^>]*\/>/)
  assert.ok(entry, '设置菜单必须保留绑定 goAbout 的独立入口')
  assert.match(source.settingsJs, /goAbout\(\)\s*\{[\s\S]*?wx\.navigateTo\(\{\s*url:\s*['"]\/pages\/shezhi\/about\/index['"]\s*\}\);?[\s\S]*?\}/,
    '设置入口必须导航到关于页')
  assert.ok(registeredRoutes(source.app).has('/pages/shezhi/about/index'), '关于页必须注册到 app.json')
}

function assertQrVoucherReuse(source) {
  const pageConfig = JSON.parse(source.aboutJson || '{}')
  assert.equal(pageConfig.usingComponents && pageConfig.usingComponents['cy-qr-voucher'], '/components/cy/qr-voucher/index',
    '关于页必须注册共享 cy-qr-voucher')
  const voucher = source.aboutWxml.match(/<cy-qr-voucher\b[\s\S]*?\/>/)
  assert.ok(voucher, '玩家个人码必须由 cy-qr-voucher 承载')
  assert.match(voucher[0], /\bembedded="\{\{true\}\}"/, '关于页内二维码必须使用 embedded 模式')
  assert.match(voucher[0], /\bstate="error"/, '真实小程序码接口接入前必须如实落错误态')
  assert.doesNotMatch(voucher[0], /\bqr=/, '没有真实小程序码时不得传入联系码或占位图')
  assert.doesNotMatch(source.aboutJs, /data\.wechat|\/api\/user\/info/, '微信联系码不得冒充城瘾玩家个人码')
  assert.doesNotMatch(source.aboutWxml, /<canvas\b|class="[^"]*(?:qr-code|qrcode|qr-card)[^"]*"/,
    '关于页不得自绘二维码或另造码卡')
}

function loadAboutPage(script, version = '9.8.7') {
  let page
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
  }
  vm.runInNewContext(script, {
    getApp: () => app,
    // 关于页是共享页,主题两分复用 utils/identity/identity-policy(与 shezhi 父页同源),
    // 沙箱要给出 require 与 storage 桩,否则加载即抛 ReferenceError
    require: (id) => {
      if (String(id).includes('identity-policy')) return { isMerchantView: () => false }
      if (String(id).includes('merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} }
      throw new Error('unexpected require: ' + id)
    },
    wx: {
      getAccountInfoSync: () => ({ miniProgram: { version } }),
      getStorageSync: () => '',
    },
    Page: (definition) => { page = definition },
  })
  return page
}

test('设置菜单的关于入口可到达已注册页面', () => {
  assertAboutEntry(SOURCE)
})

test('关于页从运行时账号信息读取版本，并展示应用图标', () => {
  const page = loadAboutPage(SOURCE.aboutJs)
  assert.ok(page, '关于页必须注册 Page')
  const data = { ...page.data }
  page.setData = (patch) => Object.assign(data, patch)
  page.onLoad()
  assert.equal(data.version, '9.8.7', '版本必须来自 wx.getAccountInfoSync().miniProgram.version')
  assert.match(SOURCE.aboutWxml, /<image\b[^>]*class="about-app__logo"[^>]*\/>/, '关于页必须展示应用图标')
  assert.match(SOURCE.aboutWxml, /class="about-app__version"[^>]*>[^<]*\{\{version\}\}/, '版本展示必须绑定运行时值')
})

test('玩家个人码复用共享 cy-qr-voucher，不自绘码卡', () => {
  assertQrVoucherReuse(SOURCE)
})

test('negative control：摘掉设置页入口必须判红', () => {
  const mutated = {
    ...SOURCE,
    settingsWxml: SOURCE.settingsWxml.replace(/\s*<cy-cell\b[^>]*bind:tap="goAbout"[^>]*\/>/, ''),
  }
  assert.notEqual(mutated.settingsWxml, SOURCE.settingsWxml, '负控必须真的摘掉关于入口')
  assert.throws(() => assertAboutEntry(mutated), assert.AssertionError)
})

test('negative control：把玩家码改成自绘卡必须判红', () => {
  const mutated = {
    ...SOURCE,
    aboutWxml: SOURCE.aboutWxml.replace(/<cy-qr-voucher\b[\s\S]*?\/>/, '<view class="qr-card"><canvas /></view>'),
  }
  assert.notEqual(mutated.aboutWxml, SOURCE.aboutWxml, '负控必须真的移除 cy-qr-voucher')
  assert.throws(() => assertQrVoucherReuse(mutated), assert.AssertionError)
})
