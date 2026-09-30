// 统一主页接入商家「关于」——设计文档《商家主页收编 · 「承接商家」页下线》§3.3/§3.5/§3.6/§3.7。
//
// 这里守四件不能退让的事:
//  1. tab=about 深链真的落到 About，且非法 tab 回退原默认值;
//  2. 「被看者是商家」和「观看者是商家」是两份状态,互换会让 About 跟着观看者变;
//  3. H1 撤销商家邀商家入口，商家分支不出现 type2「发起合作」；玩家态的关注 / 发消息
//     仍不渲染也不触发，且不复活「可承接章节 / 邀请承接」;
//  4. 商家探测的四态互斥 —— 网络失败不许被显示成「未完善 / 非商家」。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PROFILE_JS = path.join(ROOT, 'components/cy/profile/index.js')
const PROFILE_WXML = path.join(ROOT, 'components/cy/profile/index.wxml')
const PROFILE_WXSS = path.join(ROOT, 'components/cy/profile/index.wxss')
const USERINFO_JS = path.join(ROOT, 'pages/userinfo/userinfo.js')
const USERINFO_WXML = path.join(ROOT, 'pages/userinfo/userinfo.wxml')
const read = (file) => fs.readFileSync(file, 'utf8')

const PUBLIC_HOME = '/api/merchant/public-home'
const PUBLIC_INFO = '/api/user/public-info'

const MERCHANT = {
  id: 7,
  memberId: 88,
  name: '拐角咖啡',
  logo: 'https://cdn/logo.png',
  coverImage: 'https://cdn/cover.png',
  cityRole: '城市补给站',
  slogan: '一杯就到站',
  storyTitle: '我们的故事',
  description: '开在弄堂口的第九年。',
  gallery: '["https://cdn/g1.png","https://cdn/g2.png"]',
  tags: '安静,有插座',
  businessStatus: 1,
  businessTime: '09:00-21:00',
  address: '愚园路 1 号',
  capacity: 20,
  availableTime: '工作日下午',
  suitActivityTypes: '城市漫步',
  demand: '想接周末路线',
  sysCategoryList: [{ id: 3, categoryName: '咖啡' }],
}

// ---------------------------------------------------------------- 组件运行时

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

/**
 * @param {object} opts
 *  - loginId   当前登录 memberId('' = 匿名)
 *  - role      观看者 RBAC 角色
 *  - viewer / userId / initialTab / topicId / topicName  组件属性
 *  - source    可选:直接给组件定义源码(负控用变异后的源码)
 */
function mountProfile(opts) {
  const options = Object.assign({ loginId: '', role: 'player', viewer: 'other', userId: '' }, opts)
  const requests = []
  const navigations = []
  const themes = []
  const locations = []
  let definition = null

  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => options.loginId,
    getUserRole: () => options.role,
    getUserType: () => (options.role === 'merchant' ? 2 : 1),
    isDevEnv: () => false,
    setUserRole() {},
    getPageSize: () => 10,
    getTotalPage: () => 1,
    sendRequest(request) { requests.push(request) },
  }

  // ⚠️ 全局不还原:utils/theme.js 这类依赖在**调用时**读 getApp/wx,不是 require 时。
  // 还原了就会在 applyTheme 里炸 "getApp is not a function"。本文件独占一个进程,
  // 每次 mount 直接覆盖即可。
  global.getApp = () => app
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    hideTabBar() {},
    showToast() {},
    previewImage() {},
    openLocation(conf) { locations.push(conf) },
    setNavigationBarColor(conf) { themes.push(conf.backgroundColor) },
    setBackgroundColor() {},
    navigateTo(conf) { navigations.push(conf.url) },
    switchTab(conf) { navigations.push(conf.url) },
  }
  global.Component = (def) => { definition = def }
  delete require.cache[require.resolve(PROFILE_JS)]
  if (options.source) {
    // 负控:不落盘,直接在同一 require 语义下跑变异源码
    const vm = require('node:vm')
    const module_ = { exports: {} }
    vm.runInNewContext(options.source, {
      Component: global.Component,
      getApp: global.getApp,
      wx: global.wx,
      require: (id) => require(path.resolve(path.dirname(PROFILE_JS), id)),
      module: module_,
      exports: module_.exports,
      console,
      Promise,
      Object,
      Array,
      Number,
      String,
      Math,
      Date,
      isFinite,
      isNaN,
      JSON,
      setImmediate,
    }, { filename: PROFILE_JS })
  } else {
    require(PROFILE_JS)
  }

  const component = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
  })
  // properties 的默认值不在 definition.data 里,手工铺一遍(等价于框架注入)
  Object.keys(definition.properties).forEach((key) => {
    const prop = definition.properties[key]
    component.data[key] = options[key] !== undefined ? options[key] : prop.value
  })
  component.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(component.data, key, value))
    if (callback) callback()
  }
  component.requests = requests
  component.navigations = navigations
  component.themes = themes
  component.locations = locations
  component.answer = (url, response) => {
    const request = requests.filter((item) => item.url === url).pop()
    assert.ok(request, `缺少请求 ${url}`)
    if (response === 'fail') request.fail({ errMsg: 'request:fail' })
    else request.success(response)
  }
  component.asked = (url) => requests.some((item) => item.url === url)
  return component
}

function mountMerchantSubject(opts) {
  const component = mountProfile(Object.assign({ userId: '88' }, opts))
  component.initializeProfile()
  component.answer(PUBLIC_HOME, { code: '200', data: MERCHANT })
  return component
}

// ---------------------------------------------------------------- §3.3 tab 深链

test('§3.3 tab 深链:userinfo 透传主体、tab 与定向合作上下文', () => {
  const js = read(USERINFO_JS)
  const wxml = read(USERINFO_WXML)
  assert.match(js, /initialTab:\s*String\(options\.tab\b/, 'userinfo 必须读 ?tab=')
  assert.match(wxml, /initial-tab="\{\{initialTab\}\}"/)
  assert.match(js, /topicId:\s*String\(options\.topicId/)
  assert.match(js, /topicName:\s*options\.topicName\s*\?\s*decodeURIComponent/)
  assert.match(js, /operationScope:\s*options\.scope\s*===\s*['"]MERCHANT['"]/)
  assert.match(wxml, /topic-id="\{\{topicId\}\}"[^>]*topic-name="\{\{topicName\}\}"[^>]*operation-scope="\{\{operationScope\}\}"/,
    '只有明确的上下文字段可进入定向合作 CTA，不能靠商家行号猜主体')
})

test('§3.3 initialTab 白名单:合法值激活,非法值回退原默认(他人 posts / 自己 projects)', () => {
  const about = mountProfile({ userId: '88', initialTab: 'about' })
  about.initializeProfile()
  assert.equal(about.data.activeTab, 'about')

  // projects 在他人视角根本不存在 ⇒ 属于非法值,必须回退 posts 而不是激活一个空 tab
  const stolen = mountProfile({ userId: '88', initialTab: 'projects' })
  stolen.initializeProfile()
  assert.equal(stolen.data.activeTab, 'posts')

  const junk = mountProfile({ userId: '88', initialTab: 'wallet' })
  junk.initializeProfile()
  assert.equal(junk.data.activeTab, 'posts')

  const selfDefault = mountProfile({ viewer: 'self', loginId: '5', initialTab: '' })
  selfDefault.initializeProfile()
  assert.equal(selfDefault.data.activeTab, 'projects')

  // 自己视角有 projects,about 同样合法
  const selfAbout = mountProfile({ viewer: 'self', loginId: '5', initialTab: 'about' })
  selfAbout.initializeProfile()
  assert.equal(selfAbout.data.activeTab, 'about')
})

test('§3.3 负控:把他人视角写死回 posts,白名单契约必须红', () => {
  const mutated = read(PROFILE_JS)
    .replace("activeTab: initialTab || (isSelf ? 'projects' : 'posts'),", "activeTab: isSelf ? 'projects' : 'posts',")
  assert.notEqual(mutated, read(PROFILE_JS), '变异没生效,负控无意义')
  const component = mountProfile({ userId: '88', initialTab: 'about', source: mutated })
  component.initializeProfile()
  assert.equal(component.data.activeTab, 'posts', '变异体确实回到了写死 posts')
  assert.throws(() => assert.equal(component.data.activeTab, 'about'))
})

test('§3.3 userId 或 initialTab 变化时重新初始化,不停在旧 tab', () => {
  const component = mountProfile({ userId: '88', initialTab: 'about' })
  component._profileAttached = true
  component.initializeProfile()
  assert.equal(component.data.activeTab, 'about')

  component.data.initialTab = 'posts'
  component.initializeProfile()
  assert.equal(component.data.activeTab, 'posts', 'initialTab 变了必须重算 activeTab')

  const observers = read(PROFILE_JS)
  assert.match(observers, /initialTab:\s*\{[\s\S]{0,240}?observer:\s*function[\s\S]{0,120}?initializeProfile\(\)/,
    'initialTab 必须挂 observer 触发重新初始化')
})

// ---------------------------------------------------- §3.5 三份身份状态互不顶替

test('§3.5 被看者是商家才切商家 About,与观看者角色无关', () => {
  const byPlayer = mountMerchantSubject({ role: 'player' })
  assert.equal(byPlayer.data.subjectIsMerchant, true)
  assert.equal(byPlayer.data.viewerIsMerchant, false)
  assert.equal(byPlayer.data.merchantState, 'merchant')
  assert.equal(byPlayer.data.isMerchantView, true, '商家主题由被看者决定')

  // 反过来:观看者是商家、被看者是普通玩家 ⇒ About 必须仍是玩家那套
  const merchantViewsPlayer = mountProfile({ userId: '88', role: 'merchant' })
  merchantViewsPlayer.initializeProfile()
  merchantViewsPlayer.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  assert.equal(merchantViewsPlayer.data.viewerIsMerchant, true)
  assert.equal(merchantViewsPlayer.data.subjectIsMerchant, false)
  assert.equal(merchantViewsPlayer.data.merchantState, 'not-merchant')
  assert.equal(merchantViewsPlayer.data.isMerchantView, false,
    '观看者是商家不得把别人的主页染成商家主题')
})

test('§3.5 About 分支只能由被看者身份开闸,不许挂观看者身份', () => {
  const wxml = read(PROFILE_WXML)
  const about = wxml.slice(wxml.indexOf("<block wx:if=\"{{activeTab === 'about'}}\">"))
  // 4-12 起商家 About 的第一个内容是 ⓪ 招牌主推(条件块),品牌故事退到其后
  const branch = about.match(/<block wx:if="\{\{([^}]*)\}\}">\s*\n\s*<!-- ⓪ 招牌主推/)
  assert.ok(branch, '商家 About 必须是 about tab 下第一个分支')
  assert.equal(branch[1], 'subjectIsMerchant', 'About 渲染哪一套只由被看者决定')
  // 商家 About 段内不得出现观看者身份 —— 出现即意味着内容跟着观看者变
  const merchantAbout = about.slice(about.indexOf('===== 关于 · 商家被看者'),
    about.indexOf('===== 关于 · 玩家 / 俱乐部被看者'))
  assert.doesNotMatch(merchantAbout, /viewerIsMerchant/,
    '「关于」内容不得受观看者角色影响(CTA 在 pc-actions,不在这里)')
})

test('§3.5 负控:用观看者身份决定 About,互换契约必须红', () => {
  const mutated = read(PROFILE_JS).replace(
    'that.clearSubjectMerchant(\'not-merchant\');\n          return;',
    'that.setData({ merchantState: \'merchant\', subjectIsMerchant: that.data.viewerIsMerchant });\n          return;')
  assert.notEqual(mutated, read(PROFILE_JS), '变异没生效,负控无意义')
  const component = mountProfile({ userId: '88', role: 'merchant', source: mutated })
  component.initializeProfile()
  component.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  assert.equal(component.data.subjectIsMerchant, true, '变异体确实拿观看者身份当了被看者身份')
  assert.throws(() => assert.equal(component.data.subjectIsMerchant, false))
})

test('§3.5 canonical 本人打开:宿主仍是 userinfo,但 effectiveIsSelf 必须为真', () => {
  const self = mountProfile({ viewer: 'other', userId: '88', loginId: '88', role: 'merchant' })
  self.initializeProfile()
  assert.equal(self.data.isSelf, true, '登录 ID == 目标 ID ⇒ 本人')
  assert.equal(self.data.hostSelf, false, 'canonical 仍停在 userinfo 宿主,不能挂 tabBar')
  assert.equal(self.asked('/api/user/info'), true, '本人读自己那条,不走公开分支')
  assert.equal(self.asked(PUBLIC_INFO), false)

  const other = mountProfile({ viewer: 'other', userId: '88', loginId: '99' })
  other.initializeProfile()
  assert.equal(other.data.isSelf, false)
})

test('§3.5 负控:只看宿主 viewer 判本人,canonical 本人契约必须红', () => {
  const mutated = read(PROFILE_JS).replace(
    "  computeIsSelf: function () {\n    if (this.data.viewer !== 'other') return true;",
    "  computeIsSelf: function () {\n    return this.data.viewer !== 'other';\n    /* eslint-disable */ if (this.data.viewer !== 'other') return true;")
  assert.notEqual(mutated, read(PROFILE_JS), '变异没生效,负控无意义')
  const component = mountProfile({ viewer: 'other', userId: '88', loginId: '88', source: mutated })
  component.initializeProfile()
  assert.equal(component.data.isSelf, false, '变异体确实把本人当成了他人')
  assert.throws(() => assert.equal(component.data.isSelf, true))
})

test('§3.5 onShow 重算:登录态变化后 effectiveIsSelf 跟着变', () => {
  const component = mountProfile({ viewer: 'other', userId: '88' })
  component.initializeProfile()
  assert.equal(component.data.isSelf, false)
  const js = read(PROFILE_JS)
  const show = js.match(/show: function \(\) \{[\s\S]*?\n    \}/)
  assert.ok(show, 'pageLifetimes.show 必须存在')
  assert.match(show[0], /computeIsSelf\(\)\s*!==\s*this\.data\.isSelf/,
    'onShow 必须重算 effectiveIsSelf(登录态会变)')
  assert.match(show[0], /syncViewerIdentity\(\)/, 'onShow 必须重算观看者 RBAC 身份')
})

// ------------------------------------------------------------ §3.7 匿名冷启动

test('§3.7 匿名看他人走公开接口,本人走原私有接口', () => {
  const anonymous = mountProfile({ viewer: 'other', userId: '88', loginId: '' })
  anonymous.initializeProfile()
  assert.equal(anonymous.asked(PUBLIC_INFO), true, '匿名/他人必须读匿名可读的公开白名单')
  assert.equal(anonymous.asked('/api/user/info'), false, '不得再走会强制登录的私有接口')

  const own = mountProfile({ viewer: 'self', loginId: '5' })
  own.initializeProfile()
  assert.equal(own.asked('/api/user/info'), true)
  assert.equal(own.asked(PUBLIC_INFO), false)
})

test('§3.7 负控:他人分支改回私有接口,匿名契约必须红', () => {
  const mutated = read(PROFILE_JS)
    .replace("var url = this.data.isSelf ? '/api/user/info' : '/api/user/public-info';",
      "var url = '/api/user/info';")
  assert.notEqual(mutated, read(PROFILE_JS), '变异没生效,负控无意义')
  const component = mountProfile({ viewer: 'other', userId: '88', source: mutated })
  component.initializeProfile()
  assert.equal(component.asked(PUBLIC_INFO), false, '变异体确实退回了要求登录的接口')
  assert.throws(() => assert.equal(component.asked(PUBLIC_INFO), true))
})

test('§3.7 公开主页不消费私密字段', () => {
  const wxml = read(PROFILE_WXML)
  const merchantAbout = wxml.slice(wxml.indexOf('===== 关于 · 商家被看者 ====='),
    wxml.indexOf('===== 关于 · 玩家 / 俱乐部被看者'))
  assert.ok(merchantAbout.length > 400, '商家 About 段必须存在')
  assert.doesNotMatch(merchantAbout, /mobilephone|phone|wechat|license|auditRemark|idCard|bankAccount/i,
    '商家 About 只渲染公开白名单字段')
})

// ------------------------------------------------------- §3.7 商家探测四态互斥

test('§3.7 商家探测四态:loading / merchant / not-merchant / network-error 互斥', () => {
  const loading = mountProfile({ userId: '88' })
  loading.initializeProfile()
  assert.equal(loading.data.merchantState, 'loading')
  assert.equal(loading.data.subjectIsMerchant, false)

  const merchant = mountMerchantSubject({})
  assert.equal(merchant.data.merchantState, 'merchant')

  const notMerchant = mountProfile({ userId: '88' })
  notMerchant.initializeProfile()
  notMerchant.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  assert.equal(notMerchant.data.merchantState, 'not-merchant')

  const offline = mountProfile({ userId: '88' })
  offline.initializeProfile()
  offline.answer(PUBLIC_HOME, 'fail')
  assert.equal(offline.data.merchantState, 'network-error',
    '网络失败不能伪装成「他不是商家」')
  assert.equal(offline.data.subjectIsMerchant, false)

  // 非「不存在或未开放」的其他非 200 同样算没查到,不许当业务态
  const broken = mountProfile({ userId: '88' })
  broken.initializeProfile()
  broken.answer(PUBLIC_HOME, { code: '500', msg: '系统繁忙' })
  assert.equal(broken.data.merchantState, 'network-error')
})

test('§3.7 网络错误在 About 有自己的出口,不落进玩家 About', () => {
  const wxml = read(PROFILE_WXML)
  assert.match(wxml, /wx:elif="\{\{merchantState === 'loading'\}\}"/)
  // 2026-08-19:重取按钮收编进 cy-error 的 retry(原先自绘一个「重新加载」,而 cy-error 默认
  // 还会渲染一个没人监听的「重试」= 死按钮 + 双 CTA)。契约认「事件绑在组件上」。
  assert.match(wxml, /wx:elif="\{\{merchantState === 'network-error'\}\}"[\s\S]{0,400}?bind:retry="retryMerchantProbe"/,
    '网络错误必须给独立的错误态 + 重试,不能掉进玩家 About 或空态')
})

test('§3.7 负控:把网络失败收敛成 not-merchant,状态机契约必须红', () => {
  const mutated = read(PROFILE_JS)
    .replace("fail: function () { that.clearSubjectMerchant('network-error'); }",
      "fail: function () { that.clearSubjectMerchant('not-merchant'); }")
  assert.notEqual(mutated, read(PROFILE_JS), '变异没生效,负控无意义')
  const component = mountProfile({ userId: '88', source: mutated })
  component.initializeProfile()
  component.answer(PUBLIC_HOME, 'fail')
  assert.equal(component.data.merchantState, 'not-merchant', '变异体确实把没查到说成了业务事实')
  assert.throws(() => assert.equal(component.data.merchantState, 'network-error'))
})

// -------------------------------------------------- §3.6 商家 About 与唯一主动作

test('§3.6 商家公开身份接管身份头,不残留个人昵称/玩家角色', () => {
  const component = mountMerchantSubject({})
  assert.equal(component.data.subjectMerchant.name, '拐角咖啡')
  assert.equal(component.data.heroImg, MERCHANT.coverImage, 'coverImage 承接主页封面')

  const wxml = read(PROFILE_WXML)
  const js = read(PROFILE_JS)
  assert.match(wxml, /class="pc-gamer-name">\{\{subjectIsMerchant \? \(subjectMerchant\.name/,
    '品牌名必须接管昵称位')
  // 头像位真源在 js 的 _avatarSrc:商家走 logo,没有就落店名首字(lettermark);
  // 玩家走 avatar,没有才用默认头像那张图。
  assert.match(js, /_avatarSrc: isMerchant \? \(m\.logo \|\| ''\)/,
    'logo 必须接管商家的头像位')
  assert.match(js, /_avatarInitial: isMerchant \? \(name \? name\.charAt\(0\) : '店'\)/,
    '商家没 logo 时落店名首字,不借玩家默认头像那张人脸')
  assert.match(wxml, /wx:else class="pc-avatar pc-avatar--initial"/,
    'lettermark 档必须真的渲染出来')
  assert.doesNotMatch(wxml, /subjectMerchant\.logo[^}]*d_profile/,
    '商家档不得兜底到玩家默认头像')
  assert.match(wxml, /class="pc-gamer-lv" wx:if="\{\{subjectIsMerchant\}\}"/,
    'cityRole 必须接管角色行,不再显示玩家 roleBadge / Lv')
  assert.match(wxml, /class="pc-gamer-slogan" wx:if="\{\{subjectIsMerchant && subjectMerchant\.slogan\}\}"/)
})

test('§3.6 商家资料按旧页同一口径解析,空值规则不造文案', () => {
  const component = mountMerchantSubject({})
  assert.deepEqual(component.data.merchantGallery, ['https://cdn/g1.png', 'https://cdn/g2.png'],
    'gallery 是 JSON 串,按 parseDisplayList 同一口径解析')
  assert.deepEqual(component.data.merchantTags, ['安静', '有插座'], 'tags 逗号分隔同样解析')
  assert.deepEqual(component.data.merchantCategories, MERCHANT.sysCategoryList)
  assert.equal(component.data.subjectMerchant.capacityText, '20 人')
  assert.equal(component.data.subjectMerchant.businessStatusText, '营业中')
  assert.equal(component.data.merchantHasGeo, false, '没给坐标时地址不得伪装成可点')

  const bare = mountProfile({ userId: '88' })
  bare.initializeProfile()
  bare.answer(PUBLIC_HOME, { code: '200', data: { id: 7, memberId: 88, name: '空店' } })
  assert.deepEqual(bare.data.merchantGallery, [], '相册为空 ⇒ 整块不渲染')
  assert.equal(bare.data.subjectMerchant.capacityText, '')
  assert.equal(bare.data.subjectMerchant.businessStatusText, '—')
})

// ------------------------------------------------- 门店地址导航(C2 字段名修正)
//
// 旧 pages/merchant/profile:372 读的是 m.latitude / m.longitude,而 MmsMerchant
// 上只有 locationLat / locationLng(库列 location_lat / location_lng)——
// 那处「点击地址导航」自上线起就在早退,一次没通过电。阶段C 照文档继承了同一组
// 错字段名。下面这组契约(尤其那条负控)就是防止第三次写错。

test('C2 门店地址导航读 locationLat/locationLng,并真的调 openLocation', () => {
  const component = mountProfile({ userId: '88' })
  component.initializeProfile()
  component.answer(PUBLIC_HOME, {
    code: '200',
    data: Object.assign({}, MERCHANT, { locationLat: 31.2216, locationLng: 121.4365 }),
  })
  assert.equal(component.data.merchantHasGeo, true, '有有效坐标时地址才可点')
  component.goMerchantLocation()
  assert.equal(component.locations.length, 1, '必须真的调到 wx.openLocation')
  // wx.openLocation 的入参名仍是 latitude/longitude —— API 层与实体字段是两层
  assert.deepEqual(
    { latitude: component.locations[0].latitude, longitude: component.locations[0].longitude },
    { latitude: 31.2216, longitude: 121.4365 })
  assert.equal(component.locations[0].address, MERCHANT.address)
  assert.equal(component.locations[0].name, MERCHANT.name)
})

test('C2 无效坐标一律不可点也不导航:缺字段 / null / 空串 / 0 / NaN / 超范围', () => {
  const cases = [
    ['缺字段', {}],
    ['null', { locationLat: null, locationLng: null }],
    ['空串', { locationLat: '', locationLng: '' }],
    ['0,0(几内亚湾不是店铺)', { locationLat: 0, locationLng: 0 }],
    ['只有一半', { locationLat: 31.2216, locationLng: null }],
    ['另一半是 0', { locationLat: 31.2216, locationLng: 0 }],
    ['NaN', { locationLat: 'abc', locationLng: 'def' }],
    ['纬度超范围', { locationLat: 121.4365, locationLng: 31.2216 }],
  ]
  for (const [label, geo] of cases) {
    const component = mountProfile({ userId: '88' })
    component.initializeProfile()
    component.answer(PUBLIC_HOME, { code: '200', data: Object.assign({}, MERCHANT, geo) })
    assert.equal(component.data.merchantHasGeo, false, `${label}:不得渲染成可点`)
    component.goMerchantLocation()
    assert.equal(component.locations.length, 0, `${label}:点了也不许导航`)
  }
})

test('C2 旧字段名 latitude/longitude 不再被当坐标(它在实体上不存在)', () => {
  const component = mountProfile({ userId: '88' })
  component.initializeProfile()
  component.answer(PUBLIC_HOME, {
    code: '200',
    data: Object.assign({}, MERCHANT, { latitude: 31.2216, longitude: 121.4365 }),
  })
  assert.equal(component.data.merchantHasGeo, false,
    'latitude/longitude 是旧页那组错字段名,给了也不能当坐标用')
  component.goMerchantLocation()
  assert.equal(component.locations.length, 0)

  const js = read(PROFILE_JS)
  assert.match(js, /m\.locationLat/, '坐标必须从 locationLat 取')
  assert.match(js, /m\.locationLng/, '坐标必须从 locationLng 取')
  // openLocation 的入参名允许叫 latitude/longitude;取值不许再读 m.latitude。
  // 注释里写「旧页读的是 m.latitude」是教训记录,不算真消费 ⇒ 先剥注释再判。
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /m\.latitude|m\.longitude/,
    '不得再从商家对象上读 latitude/longitude —— 那两个字段根本不存在')
})

test('C2 负控:字段名改回 latitude/longitude,导航契约必须红', () => {
  const source = read(PROFILE_JS)
  const mutated = source
    .replace('var lat = toCoordinate(m.locationLat, 90);', 'var lat = toCoordinate(m.latitude, 90);')
    .replace('var lng = toCoordinate(m.locationLng, 180);', 'var lng = toCoordinate(m.longitude, 180);')
  assert.notEqual(mutated, source, '变异没生效,负控无意义')

  // 变异体:给对字段名反而失效
  const right = mountProfile({ userId: '88', source: mutated })
  right.initializeProfile()
  right.answer(PUBLIC_HOME, {
    code: '200',
    data: Object.assign({}, MERCHANT, { locationLat: 31.2216, locationLng: 121.4365 }),
  })
  assert.equal(right.data.merchantHasGeo, false, '变异体确实读不到 locationLat/locationLng')
  assert.throws(() => assert.equal(right.data.merchantHasGeo, true))

  // 变异体:给旧的错字段名反而"通了"——正是要挡的那种假通电
  const wrong = mountProfile({ userId: '88', source: mutated })
  wrong.initializeProfile()
  wrong.answer(PUBLIC_HOME, {
    code: '200',
    data: Object.assign({}, MERCHANT, { latitude: 31.2216, longitude: 121.4365 }),
  })
  assert.equal(wrong.data.merchantHasGeo, true, '变异体确实退回了旧的错字段名')
  assert.throws(() => assert.equal(wrong.data.merchantHasGeo, false))
})

test('C2 负控:放行 0 坐标,几内亚湾闸必须红', () => {
  const source = read(PROFILE_JS)
  const mutated = source.replace(
    'if (!isFinite(n) || n === 0 || Math.abs(n) > limit) return null;',
    'if (!isFinite(n)) return null;')
  assert.notEqual(mutated, source, '变异没生效,负控无意义')
  const component = mountProfile({ userId: '88', source: mutated })
  component.initializeProfile()
  component.answer(PUBLIC_HOME, { code: '200', data: Object.assign({}, MERCHANT, { locationLat: 0, locationLng: 0 }) })
  assert.equal(component.data.merchantHasGeo, true, '变异体确实把 (0,0) 当成了有效坐标')
  assert.throws(() => assert.equal(component.data.merchantHasGeo, false))
})

test('§3.6 商家 About 六块齐全且各自带空值闸', () => {
  const wxml = read(PROFILE_WXML)
  const about = wxml.slice(wxml.indexOf('===== 关于 · 商家被看者 ====='),
    wxml.indexOf('===== 关于 · 玩家 / 俱乐部被看者'))
  assert.match(about, /subjectMerchant\.storyTitle \|\| subjectMerchant\.description/, '① 品牌故事')
  assert.match(about, /<cy-empty wx:else/, '品牌故事全空只给一次克制空态')
  assert.match(about, /wx:if="\{\{merchantGallery\.length\}\}"[\s\S]*?门店相册/, '② 门店相册整块条件渲染')
  assert.match(about, /bindtap="previewMerchantGallery"/, '相册可预览')
  assert.match(about, /wx:if="\{\{merchantCategories\.length\}\}"/, '③ 品类')
  assert.match(about, /wx:if="\{\{merchantTags\.length\}\}"/, '④ 特色标签')
  assert.match(about, /营业状态[\s\S]*?营业时间[\s\S]*?门店地址/, '⑤ 营业信息三行')
  assert.match(about, /bindtap="goMerchantLocation"/, '地址走 openLocation')
  assert.match(about,
    /wx:if="\{\{subjectMerchant\.capacityText \|\| subjectMerchant\.suitActivityTypes \|\| subjectMerchant\.availableTime \|\| subjectMerchant\.demand\}\}"/,
    '⑥ 承接能力四项全空则整块不渲染')

  // §七 明确不做:官方活动列表
  // (招牌主推原属「明确不做」清单,2026-09-17 台账 4-12 / R9-33 决定接上,见下节合同)
  assert.doesNotMatch(about, /officialActivities|官方活动/i)
})

// ------------------------------------------------- 4-12 招牌主推(R9-33 + S19-d)
//
// 后端 public-home 已返回 featured(活动/券的白名单卡),但统一主页组件不消费它,
// 装修页「发布后即可选一个置顶到主页」的承诺在玩家侧不兑现;据点页虽有卡,却因
// 卡片 VO 没有 featuredType/featuredId 而永远不可点。这里钉住主页侧同一份合同。

test('4-12 主推卡按 featuredType/featuredId 渲染并可点:活动进详情、券进券夹', () => {
  const activity = mountProfile({ userId: '88' })
  activity.initializeProfile()
  activity.answer(PUBLIC_HOME, {
    code: '200',
    data: Object.assign({}, MERCHANT, {
      featured: { id: 16, name: '周末露营市集', imgUrl: 'https://cdn/f.png', featuredType: 1, featuredId: 16 },
    }),
  })
  assert.equal(activity.data.featured.titleText, '周末露营市集')
  assert.equal(activity.data.featured.imageUrl, 'https://cdn/f.png')
  assert.equal(activity.data.featured.actionable, true, 'type=1 且有 id 的卡必须可点')
  activity.goFeatured()
  assert.deepEqual(activity.navigations, ['/pages/activity/detail/index?id=16'])

  const coupon = mountProfile({ userId: '88' })
  coupon.initializeProfile()
  coupon.answer(PUBLIC_HOME, {
    code: '200',
    data: Object.assign({}, MERCHANT, {
      featured: { id: 15, name: '满减券', featuredType: 2, featuredId: 15 },
    }),
  })
  assert.equal(coupon.data.featured.actionable, true, 'type=2 的券卡可点')
  coupon.goFeatured()
  assert.deepEqual(coupon.navigations, ['/subpackageMember/coupon-wallet/index'])

  const wxml = read(PROFILE_WXML)
  const about = wxml.slice(wxml.indexOf('===== 关于 · 商家被看者 ====='),
    wxml.indexOf('===== 关于 · 玩家 / 俱乐部被看者'))
  assert.match(about, /wx:if="\{\{featured\}\}"/, '主推卡整块条件渲染,没选就不给空壳')
  assert.match(about, /bindtap="goFeatured"/)
  assert.match(about, /featured\.titleText/, '卡面标题取后端 name')
})

test('4-12 没选主推 / 类型未知 / 缺 id 一律不渲染不可点', () => {
  const bare = mountProfile({ userId: '88' })
  bare.initializeProfile()
  bare.answer(PUBLIC_HOME, { code: '200', data: Object.assign({}, MERCHANT, { featured: null }) })
  assert.equal(bare.data.featured, null)
  bare.goFeatured()
  assert.deepEqual(bare.navigations, [], '没有卡就没有落点')

  for (const [label, featured] of [
    ['缺类型', { id: 16, name: '缺类型', featuredId: 16 }],
    ['缺 id', { id: 16, name: '缺 id', featuredType: 1 }],
    ['id 为 0', { id: 16, name: '零 id', featuredType: 1, featuredId: 0 }],
  ]) {
    const broken = mountProfile({ userId: '88' })
    broken.initializeProfile()
    broken.answer(PUBLIC_HOME, { code: '200', data: Object.assign({}, MERCHANT, { featured }) })
    assert.equal(broken.data.featured.actionable, false, `${label}:不得渲染成可点`)
    broken.goFeatured()
    assert.deepEqual(broken.navigations, [], `${label}:点了也不许导航`)
  }
})

test('4-12 负控:主推卡不看 featuredType 直接跳活动详情时必须判红', () => {
  const source = read(PROFILE_JS)
  const mutated = source.replace(
    '    if (f.featuredType === 1 && f.featuredId) {',
    '    if (f.featuredId) {')
  assert.notEqual(mutated, source, '负控锚点失效')
  const coupon = mountProfile({ userId: '88', source: mutated })
  coupon.initializeProfile()
  coupon.answer(PUBLIC_HOME, {
    code: '200',
    data: Object.assign({}, MERCHANT, {
      featured: { id: 15, name: '满减券', featuredType: 2, featuredId: 15 },
    }),
  })
  coupon.goFeatured()
  assert.equal(coupon.navigations[0], '/pages/activity/detail/index?id=15', '变异体确实把券当活动跳了')
  assert.throws(() => assert.deepEqual(coupon.navigations, ['/subpackageMember/coupon-wallet/index']))
})

test('H1 商家分支撤销 type2「发起合作」，玩家关注/发消息原边界不受影响', () => {
  const wxml = read(PROFILE_WXML)
  const js = read(PROFILE_JS)
  // 2026-08-20 用户拍板:访客看商家主页底部要有「发起合作」——走 coop/invite type=0
  // (与 club/detail 发邀请同链路),不是被撤销的 type2 章节承接。type2 的禁令保持。
  // 2026-09-16 拍板 #13 修正边界:商家当主办方也要能邀商家承接章节 —— 带主题上下文
  // (topicId,从「去找商家」/项目页进来)的商家观看者同样渲染 CTA;不带上下文仍不渲染,
  // 自己看自己永远不渲染。复用同一条 coop/invite type=0 链路,不复活 type2。
  assert.doesNotMatch(js + wxml, /type=2/,
    '商家主页不得再出现或跳转到 type2 新建入口')
  assert.match(wxml, /isMerchantView && !isSelf && \(!viewerIsMerchant \|\| topicId\)\}\}" class="pc-coop-bar"/,
    '发起合作:非商家访客照旧;商家观看者仅带主题上下文时渲染;看自己不渲染')
  assert.match(js, /'type=0'/, '发起合作必须走 type=0 邀约链路')

  // 共享组件仍要保留普通主页的关注 / 发消息(不做全文件字符串禁用),
  // 但两者在商家分支必须不渲染。
  assert.match(wxml, /bindtap="onPrimaryCta"/, '玩家主页的关注入口必须保留')
  assert.match(wxml, /bindtap="onStartChat"/, '玩家主页的发消息入口必须保留')
  const follow = wxml.match(/<view class="pc-primary \{\{!isSelf[^>]*bindtap="onPrimaryCta"/)
  assert.ok(follow, '关注钮必须存在')
  // 2026-09-18 UI-12 用户定:公开视角主按钮统一「关注」,商家被看者也渲染;本人玩家视角仍不出。
  assert.match(follow[0], /!isSelf \|\| \(isSelf && isMerchantView\)/, '关注钮公开视角统一渲染(含商家被看者)')
  const chat = wxml.match(/<view class="pc-primary pc-ticket" wx:if="\{\{!isSelf[^>]*bindtap="onStartChat"/)
  assert.ok(chat, '发消息钮必须存在')
  assert.match(chat[0], /!isSelf && !subjectIsMerchant/, '发消息钮在商家被看者上不渲染')

  // 不复活「可承接章节 / 邀请承接」,主页不再碰 chapter-application
  assert.doesNotMatch(js + wxml, /chapter-application|inviteChapter|邀请承接/)
})

test('拍板 2026-09-16 #13:商家主办邀商家承接 —— 带主题上下文的商家观看者才拿到发起合作', () => {
  const wxml = read(PROFILE_WXML)
  const js = read(PROFILE_JS)
  // 判据必须同时含「观看者是商家」这一维与「当次带主题」这一维:
  // 删掉 topicId 那半 ⇒ 商家看商家一律无入口(拍板 #13 的场景回不来);
  // 删掉 viewerIsMerchant 那半 ⇒ 不带上下文的普通商家浏览也冒出 CTA(H1 边界被破)。
  assert.match(wxml, /!viewerIsMerchant \|\| topicId/,
    '发起合作的可见性 = 非商家访客 ∪ 带主题上下文的商家观看者')
  assert.match(js, /topicId: \{ type: String, value: '' \}/,
    'topicId 是组件属性,带上下文进主页才判定得出')
  assert.match(js, /if \(this\.data\.topicId\) q\.push\('topicId=' \+ this\.data\.topicId\)/,
    '发起合作要把主题上下文带进 coop/invite,承接才落在这一期主题上')
  assert.doesNotMatch(wxml, /chapter-application|邀请承接/,
    '不引流到被下线过的 chapter-application 邀请承接入口')
})

test('§3.6 商家分支不触发发消息;关注按 UI-12 放开', () => {
  const component = mountMerchantSubject({ role: 'player' })
  component.toggleFollow()
  component.onStartChat()
  // 2026-09-18 UI-12:公开看商家主页的主按钮就是「关注」,不再挡 subjectIsMerchant;
  // 私信仍不给商家被看者(发消息钮仍只对玩家被看者渲染)。
  assert.equal(component.asked('/api/user/follow/action'), true, '商家被看者公开视角可以关注(UI-12)')
  assert.equal(component.asked('/api/im/start'), false, '商家被看者不得发起私信')

  // 普通玩家被看者照旧可用 —— 不许做全文件禁用
  const player = mountProfile({ userId: '88', loginId: '99' })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.toggleFollow()
  assert.equal(player.asked('/api/user/follow/action'), true, '玩家主页的关注必须照常可用')
})

test('P2 关注在途连点只提交一次，并立即暴露 pending 状态', () => {
  const player = mountProfile({ userId: '88', loginId: '99' })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { isFollow: 0 }

  player.toggleFollow()
  player.toggleFollow()
  player.toggleFollow()

  const writes = player.requests.filter((item) => item.url === '/api/user/follow/action')
  assert.equal(writes.length, 1, '首个关注请求未完成时必须拦住重复提交')
  assert.equal(player.data.followSubmitting, true, '按钮必须立即进入可见 pending 状态')
})

test('P2 关注失败回到原态，成功则在原位留下已关注回执', async () => {
  const player = mountProfile({ userId: '88', loginId: '99' })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { isFollow: 0 }

  player.toggleFollow()
  player.answer('/api/user/follow/action', { code: '500', msg: '操作失败' })
  await Promise.resolve()
  assert.equal(player.data.followSubmitting, false)
  assert.equal(player.data.followReceipt, false, '失败不得显示成功 check')
  assert.equal(player.data.userInfo.isFollow, 0)
  assert.equal(player.data.primaryCta, '关注')

  player.toggleFollow()
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()
  assert.equal(player.data.followSubmitting, false)
  assert.equal(player.data.followReceipt, true, '服务端确认后才能触发成功 morph')
  assert.equal(player.data.userInfo.isFollow, 1)
  assert.equal(player.data.primaryCta, '已关注', '动画结束后必须保留静态可读结果')
})

test('P2 同一被看者的旧资料响应不得覆盖已经服务端确认的关注回执', async () => {
  const player = mountProfile({ userId: '88', loginId: '99' })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { id: 88, nickname: '城市漫游者', isFollow: 0 }

  // loadUserData 的 PUBLIC_INFO 仍在途；关注写请求先返回成功。
  player.toggleFollow()
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()
  assert.deepEqual({
    isFollow: player.data.userInfo.isFollow,
    primaryCta: player.data.primaryCta,
    followReceipt: player.data.followReceipt,
  }, { isFollow: 1, primaryCta: '已关注', followReceipt: true })

  player.answer(PUBLIC_INFO, {
    code: '200',
    data: { id: 88, nickname: '城市漫游者', isFollow: 0 },
  })
  await Promise.resolve()

  assert.deepEqual({
    isFollow: player.data.userInfo.isFollow,
    primaryCta: player.data.primaryCta,
    followReceipt: player.data.followReceipt,
  }, { isFollow: 1, primaryCta: '已关注', followReceipt: true },
  '旧读响应可以补齐资料，但不能把更新后的本地关注事实倒灌回旧值')
})

test('P2 关注在途期间启动的资料读取，也不得在写成功后覆盖终态', async () => {
  const player = mountProfile({ userId: '88', loginId: '99' })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { id: 88, nickname: '旧昵称', isFollow: 0 }

  player.toggleFollow()
  player.loadUserData()
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()
  player.answer(PUBLIC_INFO, {
    code: '200',
    data: { id: 88, nickname: '资料已补齐', isFollow: 0 },
  })
  await Promise.resolve()

  assert.equal(player.data.userInfo.nickname, '资料已补齐', '迟到读取仍可补齐非关注资料')
  assert.deepEqual({
    isFollow: player.data.userInfo.isFollow,
    primaryCta: player.data.primaryCta,
    followReceipt: player.data.followReceipt,
  }, { isFollow: 1, primaryCta: '已关注', followReceipt: true },
  'mutation 期间启动的读取必须只补资料，不得覆盖关注终态')
})

test('P2 关注在途资料先返回新值时，写成功仍使用点击时冻结的目标状态', async () => {
  const player = mountProfile({ userId: '88', loginId: '99' })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { id: 88, nickname: '旧昵称', isFollow: 0 }

  player.toggleFollow()
  player.loadUserData()
  player.answer(PUBLIC_INFO, {
    code: '200',
    data: { id: 88, nickname: '资料先返回', isFollow: 1 },
  })
  await Promise.resolve()
  assert.deepEqual({
    isFollow: player.data.userInfo.isFollow,
    primaryCta: player.data.primaryCta,
    followSubmitting: player.data.followSubmitting,
  }, { isFollow: 0, primaryCta: '关注', followSubmitting: true },
  'mutation 期间的资料读不得提前改变关注事实')
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()

  assert.equal(player.data.userInfo.nickname, '资料先返回')
  assert.deepEqual({
    isFollow: player.data.userInfo.isFollow,
    primaryCta: player.data.primaryCta,
    followReceipt: player.data.followReceipt,
  }, { isFollow: 1, primaryCta: '已关注', followReceipt: true },
  '写回调不能对中途读回的 isFollow 再取反，必须兑现点击时冻结的目标')
})

test('P2 切换被看者后，上一个人的关注回调不得污染新主页', async () => {
  const player = mountProfile({ userId: '88', loginId: '99' })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { isFollow: 0 }
  player.toggleFollow()

  player.data.userId = '77'
  player.initializeProfile()
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()

  assert.equal(player.data.primaryCta, '关注')
  assert.equal(player.data.followSubmitting, false)
  assert.equal(player.data.followReceipt, false, '迟到的成功回调不得在新用户页面挂 check')
  assert.notEqual(player.data.userInfo.isFollow, 1)
})

test('P2 负控：删掉关注 epoch 闸后，迟到回调必须能把契约判红', async () => {
  const source = read(PROFILE_JS)
  const mutated = source.replace(
    "req('/api/user/follow/action', { follow_member_id: that.data.userId, follow: intendedFollow }).then(function (res) {\n      if (followEpoch !== (that._followEpoch || 0)) return;",
    "req('/api/user/follow/action', { follow_member_id: that.data.userId, follow: intendedFollow }).then(function (res) {\n      if (false) return;")
  assert.notEqual(mutated, source, '负控锚点失效')
  const player = mountProfile({ userId: '88', loginId: '99', source: mutated })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { isFollow: 0 }
  player.toggleFollow()
  player.data.userId = '77'
  player.initializeProfile()
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()
  assert.equal(player.data.userInfo.isFollow, 1, '变异体确实会污染新主页')
  assert.throws(() => assert.notEqual(player.data.userInfo.isFollow, 1))
})

test('P2 负控：资料读不比较关注状态版本时，同人旧响应必须能把回执判红', async () => {
  const source = read(PROFILE_JS)
  const mutated = source.replace(
    '      var followStateChanged = !that.data.isSelf\n        && (followMutationPending || followStateVersion !== (that._followStateVersion || 0));',
    '      var followStateChanged = false;')
  assert.notEqual(mutated, source, '关注状态版本比较负控锚点失效')
  const player = mountProfile({ userId: '88', loginId: '99', source: mutated })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { id: 88, isFollow: 0 }
  player.toggleFollow()
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()
  player.answer(PUBLIC_INFO, { code: '200', data: { id: 88, isFollow: 0 } })
  await Promise.resolve()
  assert.equal(player.data.userInfo.isFollow, 0, '变异体确实会让旧读响应覆盖成功写入')
  assert.throws(() => assert.equal(player.data.userInfo.isFollow, 1))
})

test('P2 负控：忽略 mutation-pending 标记时，在途资料读必须能提前改写关注态', async () => {
  const source = read(PROFILE_JS)
  const mutated = source.replace(
    '(followMutationPending || followStateVersion !== (that._followStateVersion || 0))',
    '(followStateVersion !== (that._followStateVersion || 0))')
  assert.notEqual(mutated, source, 'mutation-pending 负控锚点失效')
  const player = mountProfile({ userId: '88', loginId: '99', source: mutated })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { id: 88, isFollow: 0 }
  player.toggleFollow()
  player.loadUserData()
  player.answer(PUBLIC_INFO, { code: '200', data: { id: 88, isFollow: 1 } })
  await Promise.resolve()
  assert.equal(player.data.userInfo.isFollow, 1, '变异体确实允许在途资料读提前改写关注事实')
  assert.throws(() => assert.equal(player.data.userInfo.isFollow, 0))
})

test('P2 负控：写成功时重新读取当前 isFollow，会把并发变化反向切错', async () => {
  const source = read(PROFILE_JS)
  const mutated = source.replace(
    '      var nextFollow = intendedFollow;',
    '      var nextFollow = that.data.userInfo.isFollow == 1 ? 0 : 1;')
  assert.notEqual(mutated, source, '冻结目标状态负控锚点失效')
  const player = mountProfile({ userId: '88', loginId: '99', source: mutated })
  player.initializeProfile()
  player.answer(PUBLIC_HOME, { code: '500', msg: '商家不存在或未开放' })
  player.data.userInfo = { id: 88, isFollow: 0 }
  player.toggleFollow()
  player.data.userInfo.isFollow = 1
  player.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve()
  assert.equal(player.data.userInfo.isFollow, 0, '变异体确实会对并发写入后的值再取反')
  assert.throws(() => assert.equal(player.data.userInfo.isFollow, 1))
})

test('P2 关注回执对读屏可见，视觉动效只用 transform/opacity 且可减少', () => {
  const wxml = read(PROFILE_WXML)
  const wxss = read(PROFILE_WXSS)
  assert.match(wxml, /aria-busy="\{\{followSubmitting\}\}"/)
  assert.match(wxml, /aria-disabled="\{\{followSubmitting\}\}"/)
  assert.match(wxml, /wx:if="\{\{userInfo\.isFollow == 1\}\}"[\s\S]{0,180}?name="check"/,
    '已关注必须有真实 check 图标与文字回执')
  assert.match(wxss, /@keyframes pc-follow-settled\s*\{[\s\S]*?transform:[\s\S]*?opacity:/)
  const keyframes = wxss.match(/@keyframes pc-follow-settled\s*\{[\s\S]*?\n\}/)
  assert.ok(keyframes)
  assert.doesNotMatch(keyframes[0], /\b(?:width|height|left|right|top|bottom|margin|padding)\s*:/,
    '成功 morph 不得触发布局动画')
  assert.match(wxss, /\.pc-reduced-motion[\s\S]{0,220}?animation:\s*none/,
    'reducedMotion 下必须直接落到静态回执')
})

test('H1 负控:type2 商家主页 CTA 回潮会判红', () => {
  const source = read(PROFILE_JS) + read(PROFILE_WXML)
  const mutation = source + '<view bindtap="onCoopInvite">发起合作</view>'
    + "wx.navigateTo({ url: '/pages/coop/invite/index?type=2' })"
  assert.throws(() => assert.doesNotMatch(mutation, /onCoopInvite|type=2|发起合作/))
})
