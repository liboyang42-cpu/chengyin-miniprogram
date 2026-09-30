/**
 * CU-M-61(2026-09-24 走查)· 合作商家缺图卡片统一显示同一只咖啡杯。
 *
 * 走查现象:合作 → 商家列表里,书店、花店等不同品类的卡片在封面和 Logo 位置都显示同一只
 * 咖啡杯(兜底图标写死常量 poi-shop,组件注释却自称「品类图标」);列表接口也不回品类名,
 * 前端即便想按品类出图也无依据。
 *
 * 修复:cy-merchant-card 收 categoryName,兜底走 resolveCategoryIcon(拿不到品类 → 中性店铺
 * 图标,不冒充品类);/api/merchant/list 补发 sysCategoryList(只出 id/categoryName)。
 *
 * 负控在测试内联:兜底写死回 poi-shop / 调用方不喂品类,同一断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { resolveCategoryIcon, firstCategoryName, categoryIconOfRow, FALLBACK_ICON } = require('../../utils/category-icon.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CARD_JS = 'components/cy/merchant-card/index.js';
const DISCOVER_JS = 'components/cy/scene-roam-discover/index.js';
const RELATION_JS = 'pages/merchant/relation/index.js';
const RELATION_WXML = 'pages/merchant/relation/index.wxml';

/** 组件定义只需要 Component/getApp/require。 */
function loadComponent(relativePath) {
  let definition = null;
  const file = path.join(ROOT, relativePath);
  vm.runInNewContext(read(relativePath), {
    Component: (value) => { definition = value; },
    getApp: () => ({ globalData: {} }),
    wx: {},
    console,
    require: (id) => require(path.resolve(path.dirname(file), id)),
  });
  return definition;
}

/** 把组件实例化到能跑 observer 的程度。 */
function instantiate(definition) {
  return {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  };
}

/**
 * 合作页的 normalizeDiscoveryItem 是模块私有函数,Page({}) 拿不到它。
 * 整份源码在沙箱里跑完后补一个表达式把函数交出来 —— 测真代码,不复述逻辑。
 */
function loadRelationInternals(source) {
  const file = path.join(ROOT, RELATION_JS);
  const sandbox = {
    Page: () => {},
    getApp: () => ({ globalData: {}, getImgUrl: (p) => 'https://cdn.test/' + p }),
    wx: {},
    console,
    require: (id) => require(path.resolve(path.dirname(file), id)),
  };
  return vm.runInNewContext(`${source == null ? read(RELATION_JS) : source}\n;({ normalizeDiscoveryItem })`, sandbox, { filename: file });
}

test('商家卡:无图兜底按品类选图标,拿到什么品类出什么图标', () => {
  const definition = loadComponent(CARD_JS);
  assert.equal(typeof definition.observers.categoryName, 'function', '组件必须收 categoryName 并映射成图标');
  const instance = instantiate(definition);

  definition.observers.categoryName.call(instance, '咖啡');
  assert.equal(instance.data._catIcon, 'poi-shop', '咖啡品类仍出咖啡杯');
  assert.equal(instance.data._catIcon, resolveCategoryIcon('咖啡'));

  definition.observers.categoryName.call(instance, '运动健身');
  assert.notEqual(instance.data._catIcon, 'poi-shop', '非餐饮品类不许再共用咖啡杯');
  assert.equal(instance.data._catIcon, resolveCategoryIcon('运动健身'));
});

test('商家卡:品类缺失/为 null 时退中性店铺图标,不写死某个品类', () => {
  const definition = loadComponent(CARD_JS);
  const instance = instantiate(definition);
  assert.equal(instance.data._catIcon, resolveCategoryIcon(''), '初值就是中性兜底');
  definition.observers.categoryName.call(instance, '');
  assert.equal(instance.data._catIcon, 'discover-shop');
  definition.observers.categoryName.call(instance, null);
  assert.equal(instance.data._catIcon, 'discover-shop');
});

test('商家卡模板:封面与 Logo 两个兜底位都用品类图标', () => {
  const wxml = read('components/cy/merchant-card/index.wxml');
  assert.match(wxml, /class="mc__cover-ph"><cy-icon name="\{\{_catIcon\}\}" size="88" \/>/);
  assert.match(wxml, /<cy-icon wx:else name="\{\{_catIcon\}\}" size="40" \/>/);
  assert.doesNotMatch(wxml, /name="poi-shop"/, '模板里不得再有写死品类的兜底');
});

test('发现列表调用方把品类名喂给卡片', () => {
  const wxml = read('components/cy/scene-roam-discover/index.wxml');
  assert.match(wxml, /category-name="\{\{item\.categoryName\}\}"/);
  const source = read(DISCOVER_JS);
  assert.match(source, /categoryName: firstCategoryName\(row\)/, '列表项必须带上后端下发的品类名');
});

test('发现列表:品类名取后端 sysCategoryList 的第一个非空名', () => {
  const definition = loadComponent(DISCOVER_JS);
  const decorate = definition.methods._decorate;
  const row = {
    id: 9002, name: '花房', businessStatus: 1,
    sysCategoryList: [{ id: 3, categoryName: '  花艺  ' }, { id: 4, categoryName: '咖啡' }],
  };
  assert.equal(decorate.call({ data: {} }, row).categoryName, '花艺');
  assert.equal(decorate.call({ data: {} }, { id: 1, name: '无品类' }).categoryName, '');
  assert.equal(decorate.call({ data: {} }, { id: 2, name: '脏品类', sysCategoryList: [{ categoryName: null }] }).categoryName, '');
});

test('取品类名是共享工具:两处调用方都从 utils/category-icon.js 拿,不各写一份', () => {
  // 走查报的是「合作 → 商家列表」,发现页只是碰巧先修过。取法分叉就是这次问题的形状:
  // 组件里的本地副本改名/改口径,另一页不会跟着变。
  assert.equal(firstCategoryName({ sysCategoryList: [{ id: 3, categoryName: ' 书店 ' }] }), '书店');
  assert.equal(firstCategoryName({ sysCategoryList: [] }), '');
  assert.equal(firstCategoryName({ categoryId: 7 }), '', '只有 categoryId 时不得凭空猜品类');
  assert.equal(categoryIconOfRow({ sysCategoryList: [{ categoryName: '咖啡' }] }), 'poi-shop');
  assert.equal(categoryIconOfRow({ sysCategoryList: [{ categoryName: '书店' }] }), resolveCategoryIcon('书店'));
  assert.equal(categoryIconOfRow({}), FALLBACK_ICON);

  for (const file of [DISCOVER_JS, RELATION_JS]) {
    const source = read(file);
    assert.match(source, /require\(.*category-icon\.js'\)/, `${file} 必须用共享工具`);
    assert.doesNotMatch(source, /function firstCategoryName/, `${file} 不得再留本地副本`);
  }
});

test('合作页商家卡:品类名从后端 sysCategoryList 取出并喂给卡片', () => {
  const { normalizeDiscoveryItem } = loadRelationInternals();
  const bookstore = normalizeDiscoveryItem({
    id: 9101, memberId: 88, name: '旧书局', categoryId: 7, address: '',
    sysCategoryList: [{ id: 7, categoryName: '书店' }],
  }, '商家');
  assert.equal(bookstore.categoryName, '书店', '无封面时卡片要靠品类名出对图标');
  assert.equal(bookstore.displayDescription, '书店', '缺地址时的描述行也用同一个品类名');

  const florist = normalizeDiscoveryItem({ id: 9102, memberId: 89, name: '花房', categoryId: 8, sysCategoryList: [{ id: 8, categoryName: '花艺' }] }, '商家');
  assert.equal(florist.categoryName, '花艺', '品类名要照后端原样交给卡片,不再一律「咖啡」');
  assert.equal(resolveCategoryIcon(florist.categoryName), FALLBACK_ICON, '映射表认不出的品类退中性店铺,不得冒充咖啡杯');
  const gym = normalizeDiscoveryItem({ id: 9104, memberId: 91, name: '攀岩馆', categoryId: 9, sysCategoryList: [{ id: 9, categoryName: '运动健身' }] }, '商家');
  assert.equal(resolveCategoryIcon(gym.categoryName), 'walk', '映射表认得出的品类要出对应图标');
  assert.notEqual(resolveCategoryIcon(gym.categoryName), resolveCategoryIcon(bookstore.categoryName), '认得出的品类不能被中性图标抹平');

  const plain = normalizeDiscoveryItem({ id: 9103, memberId: 90, name: '小店', categoryId: 7 }, '商家');
  assert.equal(plain.categoryName, '', '后端没给品类就交空串,由组件退回中性店铺图标');
});

test('合作页模板:卡片收到 category-name', () => {
  assert.match(read(RELATION_WXML), /category-name="\{\{item\.categoryName\}\}"/);
});

test('负控:合作页退回读 item.categoryName 时,书店卡必须变回空品类', () => {
  // 这一路后端只下发 category_id,item.categoryName 永远是 undefined —— 正是走查里
  // 「不分书店花店全显示咖啡杯」的成因。改回去必须能被抓到。
  const regressed = read(RELATION_JS).replace(
    'const categoryName = firstCategoryName(item);',
    'const categoryName = item.categoryName;'
  );
  assert.notEqual(regressed, read(RELATION_JS), '负控锚点失效:合作页取法已改名,扫描口径需同步');
  const internals = loadRelationInternals(regressed);
  const row = internals.normalizeDiscoveryItem({
    id: 9101, memberId: 88, name: '旧书局', categoryId: 7, address: '',
    sysCategoryList: [{ id: 7, categoryName: '书店' }],
  }, '商家');
  assert.equal(row.categoryName, undefined, '回归后品类名丢失 —— 上面的断言必须是红的');
});

test('后端对齐:/api/merchant/list 的发现列表补发品类名(批次只查一次库)', () => {
  const controller = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiMerchantController.java');
  assert.match(controller, /fillDiscoveryCategories\(publicRows, kept\);/, '发现列表必须回填品类(用与 publicRows 对齐的 kept,不因 null 行错位)');
  const helper = controller.slice(controller.indexOf('private void fillDiscoveryCategories'));
  assert.match(helper, /selectSysCategoryListByIds\(ids\.toArray\(new String\[0\]\)\)/, '一次批量查,不按行重复查库');
  assert.match(helper, /item\.setCategoryName\(c\.getCategoryName\(\)\)/, '只出 id/categoryName 两个字段');
});

test('负控:兜底写死回 poi-shop 时,品类断言必须真红', () => {
  const source = read(CARD_JS);
  const regressed = source.replace(
    "categoryName(name) { this.setData({ _catIcon: resolveCategoryIcon(name) }); },",
    "categoryName() { this.setData({ _catIcon: 'poi-shop' }); },"
  );
  assert.notEqual(regressed, source, '负控锚点失效:observer 已改名,扫描口径需同步');
  const file = path.join(ROOT, CARD_JS);
  let definition = null;
  vm.runInNewContext(regressed, {
    Component: (value) => { definition = value; },
    getApp: () => ({ globalData: {} }),
    wx: {},
    console,
    require: (id) => require(path.resolve(path.dirname(file), id)),
  });
  const instance = instantiate(definition);
  definition.observers.categoryName.call(instance, '运动健身');
  assert.throws(() => assert.notEqual(instance.data._catIcon, 'poi-shop'), assert.AssertionError);
  assert.equal(instance.data._catIcon, 'poi-shop');
});
