// 4-07 (S20-a):前端放行、保存时才 403 的入口按后端权限码收口。
//
// 后端四岗位权限真源 = MerchantPermissionPolicy:/decor/save 与 /merchant/info 要
// PROFILE_WRITE(运营没有),/npc/* 同样要 PROFILE_WRITE。而前端:
//   - 相册页门禁 need=canManageCoop(运营有) ⇒ 能进能编辑,保存 403;
//   - 装修主页门禁 need=""(任何成员) ⇒ 运营从营销页进来,基础资料直接 403;
//   - 营销页「店铺装修」图标对运营可见 ⇒ 点进去是死路。
// 服务端判定不动,只让前端按已有权限码隐藏/拦在页外。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MARKETING_JS = path.join(ROOT, 'pages/merchant/marketing/index.js');

function gateNeed(rel) {
  const wxml = read(rel);
  const gate = wxml.match(/<cy-access-gate\b[^>]*>/);
  assert.ok(gate, rel + ' 缺商家守卫');
  const need = gate[0].match(/need="([^"]*)"/);
  return need ? need[1] : '';
}

test('4-07/RV(2) 装修主页门禁回到 COOP_MANAGE，资料三视图按 PROFILE_WRITE 收口', () => {
  // 后端出处:ApiMerchantController decor/save(:622-623)、merchant/info(:322)、
  // npc/profile 与 npc/voice/enroll(:808)全部 require PROFILE_WRITE;
  // coop-profile/coop-profile/save/perk-template 要 COOP_MANAGE。
  // 口径(总控 9-18):运营只有 COOP_MANAGE,要能进装修主页管承接设置/常备权益;
  // 所以整页门禁用 canManageCoop,资料类视图(基础资料/资质/品牌)与装修保存按钮
  // 单独按 canWriteProfile 收口。
  assert.equal(gateNeed('pages/merchant/decor/index.wxml'), 'canManageCoop',
    '装修主页是承接管理的入口,整页门禁用 canWriteProfile 会把运营挡在外面');
  assert.equal(gateNeed('pages/merchant/decor/gallery/index.wxml'), 'canWriteProfile',
    '相册保存走 decor/save(PROFILE_WRITE),页门禁必须 canWriteProfile');
  assert.equal(gateNeed('pages/merchant/decor/ai-npc/index.wxml'), 'canWriteProfile',
    '门店 AI 形象 /npc/* 要 PROFILE_WRITE');
  // 承接档案类子页保持 COOP_MANAGE(后端 coop-profile/perk-template 就是它)
  assert.equal(gateNeed('pages/merchant/decor/coop-setting/index.wxml'), 'canManageCoop');
  assert.equal(gateNeed('pages/merchant/decor/perks/index.wxml'), 'canManageCoop');
});

test('RV(2) 装修主页资料三视图与保存按钮按 canWriteProfile 收口', () => {
  const wxml = read('pages/merchant/decor/index.wxml');
  ['basic', 'brand', 'qualification'].forEach((view) => {
    const cell = wxml.match(new RegExp('<cy-cell[^>]*data-view="' + view + '"[^>]*/?>'));
    assert.ok(cell, '找不到 data-view=' + view + ' 的资料入口');
    assert.match(cell[0], /wx:if="\{\{merchantAccess\.canWriteProfile\}\}"/,
      view + ' 视图读 /merchant/info 或走 decor/save,没有 PROFILE_WRITE 的岗位不能看到入口');
  });
  assert.match(wxml, /<cy-btn[^>]*wx:if="\{\{merchantAccess\.canWriteProfile\}\}"[^>]*bindtap="toggleBasicEditing"/,
    '基础资料的「编辑/完成编辑」是装修保存按钮,没有 PROFILE_WRITE 不渲染');
  const js = read('pages/merchant/decor/index.js');
  assert.match(js, /url:\s*'\/api\/merchant\/access\/me'/,
    '页面必须自己读一次 access/me 才能在资料视图上收口(门禁组件只盖屏,不给页面数据)');
  assert.match(js, /needsProfileWrite[\s\S]*canWriteProfile[\s\S]*loadState: 'permission'/,
    '深链直接进 basic/brand/qualification 时必须停在权限态,不能先打一发注定 403 的请求');
});

// ---------------------------------------------------------------- 营销页图标
//
// 与 merchant-marketing-window-switch-contract 同一套 vm 装载方式。

let pageDefinition
let requests
let memberId

function currentApp() {
  return {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserID: () => memberId,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (request) => { requests.push(request) },
  }
}

global.getApp = () => currentApp()
global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  navigateTo() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
}
global.Page = (definition) => { pageDefinition = definition }

function setByPath(target, dataPath, value) {
  const parts = dataPath.split('.').filter(Boolean)
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  pageDefinition = null
  requests = []
  memberId = 'merchant-a'
  delete require.cache[require.resolve(MARKETING_JS)]
  require(MARKETING_JS)
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(this.data, dataPath, value))
    if (callback) callback()
  }
  return page
}

function enterMarketing(page, permissions, roleCode) {
  page.onLoad()
  page.onShow()
  const access = requests.find((request) => request.url === '/api/merchant/access/me')
  access.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: roleCode,
      permissions: permissions,
    },
  })
  return page.data.entries.map((item) => item.action)
}

test('RV(2) 营销页「店铺装修」对有 COOP_MANAGE 的岗位显示(运营要能进去管承接)', () => {
  const marketing = loadPage()
  const marketingActions = enterMarketing(marketing, [
    'merchant:basic:read', 'merchant:crm:read', 'merchant:marketing:read',
    'merchant:marketing:write', 'merchant:coupon:manage', 'merchant:coop:manage',
  ], 'MERCHANT_MARKETING')
  assert.equal(marketingActions.includes('decor'), true,
    '运营有 COOP_MANAGE:装修主页门禁已是 canManageCoop,入口不能再按 PROFILE_WRITE 藏掉')

  const checkin = loadPage()
  const checkinActions = enterMarketing(checkin, [
    'merchant:basic:read', 'merchant:verify', 'merchant:verify:record:read',
  ], 'MERCHANT_CHECKIN')
  assert.equal(checkinActions.includes('decor'), false, '核销员没有 COOP_MANAGE,装修入口隐藏')

  const finance = loadPage()
  const financeActions = enterMarketing(finance, [
    'merchant:basic:read', 'merchant:finance:read', 'merchant:order:read',
    'merchant:verify:record:read',
  ], 'MERCHANT_FINANCE')
  assert.equal(financeActions.includes('decor'), false, '财务没有 COOP_MANAGE,装修入口隐藏')

  assert.match(read('pages/merchant/marketing/index.wxml'), /wx:for="\{\{entries\}\}"/,
    '入口仍由 entries 渲染(过滤在真源侧做,不另起一套写死岗位名的条件)')
})

test('RV(2) 负控:入口表不再按权限过滤时,核销员看到装修入口必须判红', () => {
  const source = read('pages/merchant/marketing/index.js')
  const mutated = source.replace(
    /function entriesForAccess\(access\) \{[\s\S]*?\n\}/,
    'function entriesForAccess(access) { return ENTRIES; }')
  assert.notEqual(mutated, source, '负控锚点失效')
  delete require.cache[require.resolve(MARKETING_JS)]
  let definition = null
  const previousPage = global.Page
  global.Page = (value) => { definition = value; }
  const vm = require('node:vm')
  const module_ = { exports: {} }
  vm.runInNewContext(mutated, {
    Page: global.Page,
    getApp: global.getApp,
    wx: global.wx,
    require: (id) => require(path.resolve(path.dirname(MARKETING_JS), id)),
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
    setTimeout,
    clearTimeout,
    RegExp,
    Error,
  }, { filename: MARKETING_JS })
  global.Page = previousPage
  assert.ok(definition, '变异体没有注册 Page')

  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(this.data, dataPath, value))
    if (callback) callback()
  }
  requests = []
  memberId = 'merchant-a'
  const actions = enterMarketing(page, ['merchant:basic:read', 'merchant:verify'], 'MERCHANT_CHECKIN')
  assert.equal(actions.includes('decor'), true, '变异体确实把装修入口开放给了核销员')
  assert.throws(() => assert.equal(actions.includes('decor'), false))
})

// ---------------------------------------------------------------- 装修主页视图收口
//
// RV(2):运营(只有 COOP_MANAGE)能进装修主页管承接,但 basic/brand/qualification
// 这三个资料视图要 canWriteProfile;深链直接进来时不能先打一发注定 403 的 /merchant/info。

const DECOR_JS = path.join(ROOT, 'pages/merchant/decor/index.js')

function loadDecorPage() {
  pageDefinition = null
  requests = []
  memberId = 'merchant-a'
  delete require.cache[require.resolve(DECOR_JS)]
  require(DECOR_JS)
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(this.data, dataPath, value))
    if (callback) callback()
  }
  return page
}

function enterDecor(page, view, permissions, roleCode) {
  page.onLoad({ view })
  const access = requests.find((request) => request.url === '/api/merchant/access/me')
  assert.ok(access, '装修页必须自己读一次 access/me 才能在资料视图上收口')
  access.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: roleCode,
      permissions: permissions,
    },
  })
  return requests.map((request) => request.url)
}

test('RV(2) 运营只有 COOP_MANAGE:能到合作经营/承接设置,资料视图停在权限态', () => {
  const urls = enterDecor(loadDecorPage(), 'basic', [
    'merchant:basic:read', 'merchant:marketing:read', 'merchant:marketing:write',
    'merchant:coupon:manage', 'merchant:coop:manage',
  ], 'MERCHANT_MARKETING')
  assert.equal(urls.includes('/api/merchant/info'), false,
    '运营没有 PROFILE_WRITE:深链进基础资料不能打注定 403 的 /merchant/info')

  const coopUrls = enterDecor(loadDecorPage(), 'coop', [
    'merchant:basic:read', 'merchant:marketing:read', 'merchant:coop:manage',
  ], 'MERCHANT_MARKETING')
  assert.equal(coopUrls.includes('/api/merchant/coop-profile'), true,
    '运营要能读承接档案(后续 goCoopSetting → decor/coop-setting)')
  assert.equal(coopUrls.includes('/api/merchant/commerce/capabilities'), false,
    '商业化权益要 PROFILE_WRITE,运营不该在这里再撞一次 403')
})

test('RV(2) 店长有 PROFILE_WRITE:基础资料照常加载', () => {
  const urls = enterDecor(loadDecorPage(), 'basic', [
    'merchant:basic:read', 'merchant:profile:write', 'merchant:marketing:read',
    'merchant:coop:manage',
  ], 'MERCHANT_MANAGER')
  assert.equal(urls.includes('/api/merchant/info'), true)
})
