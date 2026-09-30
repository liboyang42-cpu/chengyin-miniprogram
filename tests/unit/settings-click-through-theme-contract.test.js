const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadSettingsPage() {
  let pageConfig
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest() {},
  })
  global.Page = (config) => { pageConfig = config }
  global.wx = {
    getStorageSync() { return '' },
    navigateBack() {},
    navigateTo({url}) { this.lastNavigation = url },
    switchTab() {},
  }
  const sourcePath = path.join(ROOT, 'pages/shezhi/shezhi.js')
  delete require.cache[require.resolve(sourcePath)]
  require(sourcePath)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return page
}

function assertThemePlumbing(source) {
  assert.match(source.settingsJs,
    /String\(id\)\.indexOf\('settings-'\)\s*===\s*0[\s\S]*?next\.theme\s*=\s*this\.data\.settingsTheme/,
    '设置宿主必须统一覆盖全部 settings-* 场景，不能只特判声音设置')
  assert.match(source.settingsWxml,
    /<cy-agreement-sheet[^>]*theme="\{\{settingsTheme\}\}"/,
    '用户协议必须继承当前设置主题')
  assert.match(source.settingsWxml,
    /<cy-privacy-sheet[^>]*theme="\{\{settingsTheme\}\}"/,
    '隐私与定位必须继承当前设置主题')

  assert.match(source.agreementJs, /theme:\s*\{\s*type:\s*String,\s*value:\s*'player'\s*\}/,
    '协议组件必须暴露 theme 属性并默认保持玩家深色')
  assert.match(source.agreementWxml, /<cy-scene-sheet[^>]*theme="\{\{theme\}\}"/,
    '协议组件必须把 theme 传给 scene-sheet')
  assert.match(source.privacyJs, /theme:\s*\{\s*type:\s*String,\s*value:\s*'player'\s*\}/,
    '隐私组件必须暴露 theme 属性并默认保持玩家深色')
  assert.match(source.privacyWxml, /<cy-scene-sheet[^>]*theme="\{\{theme\}\}"/,
    '隐私组件必须把 theme 传给 scene-sheet')

  for (const page of [source.info, source.likes, source.about]) {
    assert.match(page.wxml, /isMerchantView\s*\?\s*'theme-merchant'\s*:\s*'theme-dark'/,
      `${page.name}根节点必须按商家/玩家切换主题`)
    assert.match(page.js, /merchant-theme\.js/,
      `${page.name}必须同步原生导航栏主题`)
    assert.match(page.js, /merchantPageShow\(\)/,
      `${page.name}商家显示时必须启用浅色原生主题`)
    assert.match(page.js, /onHide\(\)[\s\S]*?merchantPageRestore\(\)/,
      `${page.name}离页必须恢复玩家原生主题`)
  }

  assert.match(source.info.js,
    /scene\.theme\s*=\s*this\.data\.isMerchantView\s*\?\s*'merchant'\s*:\s*'player'/,
    '城瘾玩法的详情面板也必须继承当前视角')
  assert.match(source.info.wxss, /merchant-light-scope\.wxss/,
    '城瘾玩法消费旧颜色别名，商家浅色必须桥接 alias')
  assert.match(source.likes.wxss, /merchant-light-scope\.wxss/,
    '我的喜欢消费旧颜色别名，商家浅色必须桥接 alias')
  assert.match(source.about.wxml, /tint="\{\{isMerchantView \? '' : 'mono'\}\}"/,
    '关于页图标染色必须随商家浅色/玩家深色切换')
  assert.match(source.about.wxml, /<cy-agreement-sheet[^>]*theme="\{\{isMerchantView \? 'merchant' : 'player'\}\}"/,
    '关于页里的协议也必须继承当前视角')
  assert.match(source.routeWxml,
    /<cy-scene-settings-deregister[^>]*theme="\{\{theme\}\}"/,
    '注销内容必须收到外层商家主题')
  assert.match(source.deregisterWxml,
    /<cy-agreement-sheet[^>]*theme="\{\{theme\}\}"/,
    '注销须知不得重新掉回玩家黑色')
}

function sources() {
  return {
    settingsJs: read('pages/shezhi/shezhi.js'),
    settingsWxml: read('pages/shezhi/shezhi.wxml'),
    agreementJs: read('components/cy/agreement-sheet/index.js'),
    agreementWxml: read('components/cy/agreement-sheet/index.wxml'),
    privacyJs: read('pages/shezhi/components/privacy-sheet/index.js'),
    privacyWxml: read('pages/shezhi/components/privacy-sheet/index.wxml'),
    routeWxml: read('components/cy/scene-route-content/index.wxml'),
    deregisterWxml: read('components/cy/scene-settings-deregister/index.wxml'),
    info: {
      name: '城瘾玩法',
      js: read('subpackageA/pages/infomation/infomation.js'),
      wxml: read('subpackageA/pages/infomation/infomation.wxml'),
      wxss: read('subpackageA/pages/infomation/infomation.wxss'),
    },
    likes: {
      name: '我的喜欢',
      js: read('pages/mylike/mylike.js'),
      wxml: read('pages/mylike/mylike.wxml'),
      wxss: read('pages/mylike/mylike.wxss'),
    },
    about: {
      name: '关于',
      js: read('pages/shezhi/about/index.js'),
      wxml: read('pages/shezhi/about/index.wxml'),
      wxss: read('pages/shezhi/about/index.wxss'),
    },
  }
}

test('商家打开任一 settings 场景都得到 merchant 主题，玩家仍保持 player', () => {
  const page = loadSettingsPage()
  const sceneIds = [
    'settings-identity-picker',
    'settings-how-to-play',
    'settings-how-to-play-detail',
    'settings-profile',
    'settings-likes',
    'settings-deregister',
    'settings-feedback',
  ]

  page.data.isMerchantView = true
  page.data.settingsTheme = 'merchant'
  for (const id of sceneIds) {
    page.data.sceneStack = []
    page.openScene(id, id === 'settings-how-to-play-detail' ? { id: 1 } : {})
    if (id === 'settings-profile') { assert.equal(wx.lastNavigation, '/pages/merchant/decor/index'); continue }
    assert.equal(page.data.sceneCurrent.theme, 'merchant', `${id} 仍掉回玩家黑色`)
  }

  page.data.isMerchantView = false
  page.data.settingsTheme = 'player'
  for (const id of sceneIds) {
    page.data.sceneStack = []
    page.openScene(id, id === 'settings-how-to-play-detail' ? { id: 1 } : {})
    assert.equal(page.data.sceneCurrent.theme, 'player', `${id} 破坏了玩家深色规范`)
  }
})

test('设置二级页面、隐私/协议和注销须知完整透传当前主题', () => {
  assertThemePlumbing(sources())
})

test('负控：把协议重新写死 player 时主题契约必须变红', () => {
  const source = sources()
  source.agreementWxml = source.agreementWxml.replace('theme="{{theme}}"', 'theme="player"')
  assert.throws(() => assertThemePlumbing(source))
})
