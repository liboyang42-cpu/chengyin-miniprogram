// CU-C-160 · 发布前检查里每条缺项的「去填写」必须落到字段真正所在的那一屏。
//
// 走查实测(自由探索空草稿):点「请填写主题简介 → 去填写」,弹层关闭但只回到创作总览,
// 主题详情没打开;点「请选择开始时间 → 去填写」,editorPage 仍是 1,而档期在票务页。
// 根因:locatePublishIssue 只关层 + 页面滚顶,wxml 传下来的定位信息它一个都不读。
//
// 所以这里钉两件事:①行上要把字段带下来(wxml 的 data-field);②处理函数要按字段切屏/开层,
// 并把「展开票务 + 打开对应票单」交给提交时那条同一个定位路(focusValidationError)。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = '../../pages/publish/fabu/index.js';
const WXML = path.resolve(__dirname, '../../pages/publish/fabu/index.wxml');

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: () => {},
  getUserID: () => 42,
  getNickname: () => '测试创作者',
  getAvatar: () => '',
  getUserInfo: () => null,
  getToken: () => '',
});
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: () => {}, navigateTo: () => {}, redirectTo: () => {},
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {}, nextTick: (f) => f(),
};

let pageConfig = null;
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  delete require.cache[require.resolve('../../utils/loading.js')];
  require(PAGE);
});

// setData 支持小程序的 'a.b' 路径写法(与 fabu-ai.test.js 的脚手架同一口径)
function makePage() {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let holder = inst.data;
      for (let i = 0; i < parts.length - 1; i++) holder = holder[parts[i]];
      holder[parts[parts.length - 1]] = patch[key];
    });
    if (cb) cb();
  };
  return inst;
}

function locate(page, field) {
  const focused = [];
  page.focusValidationError = (errors) => focused.push(...Object.keys(errors || {}));
  page.setData({ publishCheck: {
    show: true, blocking: [], advisory: [], summary: [], passed: [], preview: {},
  } });
  page.locatePublishIssue({ currentTarget: { dataset: field ? { field } : {} } });
  return focused;
}

test('wxml 把缺项的字段带到处理函数,不再只给一个粗分类 tab', () => {
  const wxml = fs.readFileSync(WXML, 'utf8');
  const rows = wxml.match(/<view class="pc-item pc-item-(blocking|advisory)"[\s\S]*?hover-stay-time="80">/g) || [];
  assert.equal(rows.length, 2, '必填行 + 建议行各一条');
  rows.forEach((row) => {
    assert.match(row, /data-field="\{\{item\.field\}\}"/, `定位行没带字段: ${row}`);
    assert.match(row, /bindtap="locatePublishIssue"/);
  });
});

test('档期类缺项切到票务与档期页(editorPage 2)', () => {
  for (const field of ['startDate', 'endDate', 'recruitDeadline']) {
    const page = makePage();
    page.setData({ editorPage: 1 });
    const focused = locate(page, field);
    assert.equal(page.data.editorPage, 2, `${field} 的控件在票务页,不是创作页`);
    assert.deepEqual(focused, [field], '仍走提交时那条定位路(展开票务 + 打开票单编辑器)');
  }
});

test('主题详情弹窗里的缺项要把弹窗打开', () => {
  for (const field of ['description', 'imgUrl', 'categoryIds', 'completionRule']) {
    const page = makePage();
    page.setData({ editorPage: 2, topicDetailShow: false });
    locate(page, field);
    assert.equal(page.data.topicDetailShow, true, `${field} 这一格在主题详情弹窗里`);
    assert.equal(page.data.editorPage, 1, '弹窗挂在创作页上,不该顺手停在票务页');
  }
});

test('通关规则不能掉到默认的票务锚点', () => {
  assert.equal(makePage()._anchorForErrorKey('completionRule'), 'fieldCompletionRule');
  assert.equal(makePage()._anchorForErrorKey('startDate'), 'fieldDates');
  assert.equal(makePage()._anchorForErrorKey('name'), 'fieldName');
});

test('创作页自己的字段留在创作页,不被切走', () => {
  for (const field of ['name', 'chapters', 'pendingMaterials', 'routeGraph']) {
    const page = makePage();
    page.setData({ editorPage: 2, topicDetailShow: true });
    locate(page, field);
    assert.equal(page.data.editorPage, 1, `${field} 在创作页`);
    assert.equal(page.data.topicDetailShow, true, '不该顺手关掉用户自己开着的弹窗');
  }
});

test('定位后确认层一定关掉;认不出字段的行不瞎切屏', () => {
  const known = makePage();
  locate(known, 'name');
  assert.equal(known.data.publishCheck.show, false);

  const aiRow = makePage();
  aiRow.setData({ editorPage: 2, topicDetailShow: false });
  // AI 预检的建议行只有一句文案,没有字段可认 —— 保持原来的"关层",不许猜一个位置骗人。
  const focused = locate(aiRow, '');
  assert.equal(aiRow.data.publishCheck.show, false);
  assert.equal(aiRow.data.editorPage, 2, '认不出字段就不动屏');
  assert.deepEqual(focused, []);
});

// CU-C-160 负控(用户 9-25 明确要的):一条**根本不存在的缺项**不能假装定位成功。
// 现码 `_anchorForErrorKey` 末尾有 `return 'ticketSection'` 兜底,于是任何认不出的字段
// 都会切到票务页 + 滚到档区 —— 屏幕动了、层也开了,看起来"到了",但那格并不在那儿。
// 认不出来就必须什么都不切,只关确认层。
test('不存在的缺项不许装作定位成功:既不切屏、不开层、也不滚锚点（CU-C-160 负控）', () => {
  // 这一批都必须「认不出来」:既不等于任何已知字段,也不落在 ticket*/chapter* 两个前缀分支里。
  for (const field of ['totallyUnknownField', 'descriptionX', 'statrDate', 'imgUrl2', 'completedRule']) {
    const page = makePage();
    page.setData({ editorPage: 1, topicDetailShow: false, scrollIntoView: '' });
    const scrolled = [];
    page._scrollSheetTo = (anchor) => scrolled.push(anchor);
    const focused = locate(page, field);
    assert.equal(page.data.editorPage, 1, `${field} 认不出来 ⇒ 不许把人切到票务页假装到了`);
    assert.equal(page.data.topicDetailShow, false, `${field} 认不出来 ⇒ 不许顺手开主题详情`);
    assert.equal(page.data.scrollIntoView, '', `${field} 认不出来 ⇒ 不许滚到一个猜出来的锚点`);
    assert.deepEqual(focused, [], `${field} 认不出来 ⇒ 不能声称定位过`);
    assert.deepEqual(scrolled, [], `${field} 认不出来 ⇒ 不能有一次空滚来冒充定位`);
    assert.equal(page.data.publishCheck.show, false, '确认层仍要关掉');
  }
  // 锚点表本身:认不出 ⇒ 空锚点(空锚点是 focusValidationError/_scrollSheetTo 的"不动"信号)
  assert.equal(makePage()._anchorForErrorKey('totallyUnknownField'), '');
  assert.equal(makePage()._anchorForErrorKey(''), '');
  assert.equal(makePage()._anchorForErrorKey(undefined), '');
});
