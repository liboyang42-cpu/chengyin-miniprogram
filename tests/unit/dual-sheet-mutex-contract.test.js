// 契约:cy-category-sheet 与 cy-collaborator-picker 不得同时打开。
//
// 背景(2026-08-01 automator 实测坐实):两个组件自己都不声明 z-index,都套 cy-sheet、
// 同吃 --cy-z-sheet(800)。两者同时 show=true 时,谁盖谁只由 DOM 顺序决定 —— 实测 DOM 里
// 能同时查到 2 个各自带 sh__mask 的 cy-sheet,两块 panel 几乎完全重叠
// (合作者 top=377/h=467、分类 top=387/h=457,都贴底 844),于是叠成两层全屏遮罩,
// 下层面板被夹在遮罩之间发暗、顶部还露出约 10px(拖拽条那一条)。
//
// ⚠️ 一条曾经判错的证据,留在这里防止后人重复踩:不能拿「✕ 和 保存 同屏」当双 sheet 的证据。
// cy-sheet 的 closable 默认值就是 true(见 components/cy/sheet/index.js),所以单独一个
// category-sheet(只传 footer)本来就会同时渲染 ✕ 和 保存 —— 修复前后的截图在这一点上长得一样。
// 真正立得住的证据只有两条:DOM 里带遮罩的 cy-sheet 计数,以及两块 .sh__panel 的实测几何。
//
// 修复前这个边界态"摸不到"只是因为先打开那个的全屏遮罩顺带挡住了另一个入口 —— 是顺带挡住,
// 不是代码级互斥:实测直接调用另一个入口的真实处理函数,两个标志会同时为 true。
// 本契约把"互斥"钉成行为断言:开 A 必须关 B。
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

let pageConfig;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: {} },
  getUserID: () => 1,
  getPageSize: () => 10,
  getTotalPage: (total, size) => Math.ceil(total / size),
  sendRequest() {},
  tips() {},
  setUserRole() {},
});
global.Page = (config) => { pageConfig = config; };
global.wx = {
  showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
  navigateTo() {}, navigateBack() {}, switchTab() {}, redirectTo() {},
  stopPullDownRefresh() {}, setNavigationBarTitle() {},
  getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
  getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 667, screenHeight: 667, pixelRatio: 2 }),
  getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 667, screenHeight: 667, pixelRatio: 2 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, right: 363, width: 87, height: 32 }),
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ fields: () => ({ exec() {} }), boundingClientRect: () => ({ exec() {} }) }) }), select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }),
};

function setByPath(target, key, value) {
  const parts = key.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((p) => {
    if (!cursor[p] || typeof cursor[p] !== 'object') cursor[p] = {};
    cursor = cursor[p];
  });
  cursor[parts[parts.length - 1]] = value;
}

function loadPage(relativePath) {
  pageConfig = null;
  const abs = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(abs)];
  require(abs);
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = (patch) => {
    Object.entries(patch).forEach(([k, v]) => setByPath(page.data, k, v));
  };
  return page;
}

const PAGES = {
  activity: 'pages/publish/activity/index.js',
  fabu: 'pages/publish/fabu/index.js',
};

// 两页读的字段名不同(activity 用 formData.collaborators,fabu 用 formData.collaboratorIds),
// 两个都置空数组,让 join(',') 在任一页都不炸 —— 这里测的是互斥,不是取 id 的逻辑。
function prep(page) {
  page.setData({
    selectedCategoryIds: [],
    'formData.collaborators': [],
    'formData.collaboratorIds': [],
    categorySheetVisible: false,
    collaboratorPickerShow: false,
  });
}

// 行为断言:调真实入口处理函数(不是直接 setData 改标志),断言开一个必然关掉另一个。
function assertSheetsMutuallyExclusive(page, label) {
  // A. 合作者已开 → 开分类,必须把合作者关掉
  page.setData({ collaboratorPickerShow: true, categorySheetVisible: false });
  page.navigateToCategorySelect();
  assert.equal(page.data.categorySheetVisible, true, `${label}: 分类半屏应被打开`);
  assert.equal(page.data.collaboratorPickerShow, false,
    `${label}: 打开分类半屏时必须关闭合作者选择器,否则两块 sheet 同 z-index 叠成错乱面板`);

  // B. 分类已开 → 开合作者,必须把分类关掉
  page.setData({ categorySheetVisible: true, collaboratorPickerShow: false });
  page.AddCollaborator({});
  assert.equal(page.data.collaboratorPickerShow, true, `${label}: 合作者选择器应被打开`);
  assert.equal(page.data.categorySheetVisible, false,
    `${label}: 打开合作者选择器时必须关闭分类半屏,否则两块 sheet 同 z-index 叠成错乱面板`);
}

test('两个半屏(分类 / 合作者)在 activity 页互斥,开一个必关另一个', () => {
  const page = loadPage(PAGES.activity);
  prep(page);
  assertSheetsMutuallyExclusive(page, 'activity');
});

function assertCollaboratorSelectionCloses(page, idField, label) {
  const item = { id: 9, nickname: '星海观察员' };
  page.setData({
    collaboratorPickerShow: true,
    'formData.collaboratorList': [],
    [`formData.${idField}`]: [],
  });
  page.onCollaboratorPickerSelect({ detail: { item } });
  assert.equal(page.data.collaboratorPickerShow, false, `${label}: 选中后必须关闭选择器`);
  assert.deepEqual(page.data.formData.collaboratorList.map(row => row.id), [9]);
  assert.deepEqual(page.data.formData[idField], [9]);

  page.setData({ collaboratorPickerShow: true });
  page.onCollaboratorPickerClose();
  assert.equal(page.data.collaboratorPickerShow, false, `${label}: close 事件必须关闭选择器`);
}

test('activity 把 select 回传落表单并关闭选择器', () => {
  assertCollaboratorSelectionCloses(loadPage(PAGES.activity), 'collaborators', 'activity');
});

// 2026-09-05:专业发布页(fabu)已删掉合作者选择器,这里只剩 activity 一个宿主。
// 新增断言把「删干净了」也钉住,防止以后有人把 picker 又接回 fabu 而不再看这条契约。
test('fabu 不再挂合作者选择器', () => {
  const page = loadPage(PAGES.fabu);
  assert.equal(typeof page.AddCollaborator, 'undefined', 'fabu 不应再有 AddCollaborator');
  assert.equal(typeof page.onCollaboratorPickerSelect, 'undefined', 'fabu 不应再有 onCollaboratorPickerSelect');
  const fs = require('node:fs');
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.json'), 'utf8'));
  assert.ok(!('cy-collaborator-picker' in (json.usingComponents || {})),
    'fabu/index.json 不应再注册 cy-collaborator-picker');
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/topic-detail-sheet.wxml'), 'utf8');
  assert.ok(!wxml.includes('collaborator'), 'topic-detail-sheet.wxml 不应再出现合作者相关标记');
});

// CU-C-45(2026-09-24 走查):分类弹层的入口就在主题详情面板**内部**
// (topic-detail-sheet.wxml 的 id=fieldCategory),两个 sheet 同吃 --cy-z-sheet(800),
// 而详情在 DOM 里更靠后 ⇒ 详情全屏遮罩把分类弹层整个压住,点在分类项/保存上的触点
// 全落到详情遮罩上(顺手把详情关掉),看上去就是「分类点了没反应、也保存不了」。
// 开一个必须关另一个 —— 与合作者选择器同一套互斥,不靠遮罩顺带挡住。
test('fabu 从主题详情面板里打开分类时,详情面板必须先关掉', () => {
  const page = loadPage(PAGES.fabu);
  page.setData({ topicDetailShow: true, categorySheetVisible: false });
  page.navigateToCategorySelect();
  assert.equal(page.data.categorySheetVisible, true, '分类半屏应被打开');
  assert.equal(page.data.topicDetailShow, false,
    '开着详情面板时打开分类必须同时关掉详情,否则分类弹层被详情遮罩压住');
});

// CU-M-160(2026-09-25 走查):上面那条钉的是「开分类 ⇒ 关详情」,但当时没人写它的逆操作 ——
// 关掉分类半屏后 detail 一直是 false,用户选完类别点右上角 ✕ 直接落回主编辑器,
// 刚填到一半的主题描述/剧情详情得再点一次「编辑主题」才看得见,像是被吞了。
// 两条合起来才是一个完整的进出栈:进(关上层)与出(回上层)。
// 分类半屏只有 topic-detail-sheet 的 id=fieldCategory 一处入口,所以「回详情」不会
// 给别的上下文凭空弹出一层面板;select 与 close 在组件里是先后触发(onSave 先发 select 再发 close),
// 两条路径都会回到详情面板,且始终先后出现,不违反上面的同屏互斥。
test('fabu 关闭分类半屏要回到主题详情面板,不是落回主编辑器', () => {
  const page = loadPage(PAGES.fabu);
  page.setData({ topicDetailShow: true, categorySheetVisible: false });
  page.navigateToCategorySelect();
  page.onCategorySheetClose();
  assert.equal(page.data.categorySheetVisible, false, '分类半屏应已关闭');
  assert.equal(page.data.topicDetailShow, true,
    '关掉分类半屏必须回到打开它的主题详情面板,否则用户填了一半的内容看不见');
});

test('fabu 点分类半屏的保存(select 后紧跟 close)同样回到详情面板', () => {
  const page = loadPage(PAGES.fabu);
  page.setData({ topicDetailShow: true, categorySheetVisible: false });
  page.navigateToCategorySelect();
  page.onCategorySelect({ detail: { selectedIds: [], selectedCategories: [] } });
  page.onCategorySheetClose();
  assert.equal(page.data.categorySheetVisible, false, '保存后分类半屏应已关闭');
  assert.equal(page.data.topicDetailShow, true, '保存后必须回到详情面板,类别才看得见');
});

test('负控:关闭分类半屏不恢复详情面板时,契约必须判红', () => {
  const page = loadPage(PAGES.fabu);
  // 修复前的实现:只关自己
  page.onCategorySheetClose = function () { this.setData({ categorySheetVisible: false }); };
  assert.throws(() => {
    page.setData({ topicDetailShow: true, categorySheetVisible: false });
    page.navigateToCategorySelect();
    page.onCategorySheetClose();
    assert.equal(page.data.topicDetailShow, true, '落回了主编辑器');
  }, /落回了主编辑器/);
});

test('负控:分类入口不关主题详情面板时,契约必须判红', () => {
  const page = loadPage(PAGES.fabu);
  // 修复前的实现:只开分类
  page.navigateToCategorySelect = function () {
    this.setData({ categorySheetVisible: true, categorySheetIds: '' });
  };
  page.setData({ topicDetailShow: true, categorySheetVisible: false });
  page.navigateToCategorySelect();
  assert.equal(page.data.topicDetailShow, true,
    '旧实现下详情面板确实还开着 —— 这就是分类弹层被整片遮罩压住、点了没反应的成因');
});

/**
 * CU-C-157 子点二:类别那一行在主题详情面板**里面**,保存后人被留在总览,
 * 想接着填别的字段得自己再点一次「主题详情」。保存要回原位;CU-M-160 同样要求取消回原位。
 */
test('fabu 保存或取消类别都回到主题详情面板', () => {
  const page = loadPage(PAGES.fabu);
  prep(page);
  page.setData({ topicDetailShow: false, categorySheetVisible: true });
  page.onCategorySelect({
    detail: { selectedIds: [4001], selectedCategories: [{ id: 4001, categoryName: '咖啡' }] },
  });
  assert.equal(page.data.formData.categoryIds, '4001', '保存要把选择落到表单');
  assert.deepEqual(page.data.selectedCategoryIds, [4001]);
  assert.equal(page.data.topicDetailShow, false,
    '收到 select 的当场不许重开详情:分类半屏还没关,叠开就退回 CU-C-45 那个错乱形态');
  page.onCategorySheetClose();
  assert.equal(page.data.categorySheetVisible, false);
  assert.equal(page.data.topicDetailShow, true, '分类半屏关掉后回到主题详情,不用人再点一次');

  // 取消只有 close、没有 select:返回打开分类的详情面板,不提交临时选择。
  const cancelled = loadPage(PAGES.fabu);
  prep(cancelled);
  cancelled.setData({ topicDetailShow: true, categorySheetVisible: false });
  const categoriesBeforeCancel = cancelled.data.formData.categoryIds;
  cancelled.navigateToCategorySelect();
  cancelled.onCategorySheetClose();
  assert.equal(cancelled.data.categorySheetVisible, false);
  assert.equal(cancelled.data.topicDetailShow, true, '取消必须返回原编辑上下文');
  assert.equal(cancelled.data.formData.categoryIds, categoriesBeforeCancel, '取消不应改动已保存类别');
});

test('负控:分类半屏关掉后不重开主题详情,契约必须判红', () => {
  const page = loadPage(PAGES.fabu);
  prep(page);
  page.onCategorySheetClose = function () { this.setData({ categorySheetVisible: false }); };
  page.setData({ topicDetailShow: false, categorySheetVisible: true });
  page.onCategorySelect({ detail: { selectedIds: [4001], selectedCategories: [] } });
  page.onCategorySheetClose();
  assert.throws(
    () => assert.equal(page.data.topicDetailShow, true),
    assert.AssertionError,
    '旧实现在保存后确实把人留在总览 —— 这就是走查读到的「得重新打开主题详情」',
  );
});

test('负控:宿主收到 select 后若不关闭选择器必须判红', () => {
  const page = loadPage(PAGES.activity);
  page.onCollaboratorPickerSelect = function (e) { this.updateCollaborator(e.detail.item); };
  assert.throws(
    () => assertCollaboratorSelectionCloses(page, 'collaborators', 'activity 负控'),
    /选中后必须关闭选择器/,
  );
});

// 负控:把两页各自的两个入口分别退回"只开自己、不关对方"的修复前实现,
// 契约必须判红。四个方向逐个验,证明断言不是橡皮图章(任一处漏加互斥都会被抓到)。
test('负控:任一入口退回「开自己不关对方」的旧行为,互斥契约必须判红', () => {
  for (const [name, rel] of Object.entries(PAGES)) {
    // ① 分类入口退回旧实现
    let page = loadPage(rel);
    prep(page);
    page.navigateToCategorySelect = function () {
      this.setData({ categorySheetVisible: true, categorySheetIds: '' });
    };
    assert.throws(
      () => assertSheetsMutuallyExclusive(page, `${name} 负控-分类`),
      assert.AssertionError,
      `${name}: 分类入口不关合作者时,契约必须判红`,
    );

    // ② 合作者入口退回旧实现
    page = loadPage(rel);
    prep(page);
    page.AddCollaborator = function () {
      this.setData({ collaboratorPickerShow: true, collaboratorPickerIds: '' });
    };
    assert.throws(
      () => assertSheetsMutuallyExclusive(page, `${name} 负控-合作者`),
      assert.AssertionError,
      `${name}: 合作者入口不关分类时,契约必须判红`,
    );
  }
});
