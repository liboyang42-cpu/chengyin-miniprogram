// 节点配置页读写 v5.1 玩法的端到端契约(2026-08-27)。
//
// advanced-game-config-v51.test.js 钉的是纯函数层;这一条钉的是**用户真正走的那条路**:
// 从货架进 /pages/publish/temp/index?id=xxx → 页面回填 → 改个无关字段 → 存。
// 修复前这一路会把 blindTaste 整段抹掉(parse 不认 → serialize 不写),
// 商家看到的现象是「盲品玩法自己没了,节点变成纯打卡」。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/publish/temp/index.js';

let pageConfig = null;
let imageCallback;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: () => {},
  getAuthorization: () => 'Bearer test',
  getUserID: () => 101,
  getUserInfo: () => null,
  getToken: () => '',
  chooseImage: callback => { imageCallback = callback; },
  tips: () => {},
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: () => {},
  navigateBack: () => {},
  getBackgroundAudioManager: () => ({ stop: () => {} }),
};
global.Page = (config) => { pageConfig = config; };

function loadPage() {
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = function (patch) {
    // 只需要支持本用例用到的形状:顶层字段 + 'a.b.c' 动态路径
    for (const [key, value] of Object.entries(patch)) {
      if (!key.includes('.')) { this.data[key] = value; continue; }
      const parts = key.split('.');
      let cursor = this.data;
      for (const part of parts.slice(0, -1)) cursor = cursor[part];
      cursor[parts[parts.length - 1]] = value;
    }
  };
  page._refreshOutcomeContract = () => ({ items: [], errors: [] });
  page.refreshPreviewState = () => {};
  page.hasModule = () => false;
  return page;
}

beforeEach(() => { pageConfig = null; });

// 与 migration_seed_merchant_game_v51_20260827.sql 的「闭眼味觉师」同形
const BLIND_TASTE = {
  enabled: true, title: '闭上眼 先尝再猜', steps: '① 领小样 ② 闭眼尝 ③ 睁眼作答',
  hint: '别偷看 舌头比眼睛诚实', xp: 15,
  options: [{ key: 'A', label: '桂花乌龙' }, { key: 'B', label: '茉莉雪芽' },
    { key: 'C', label: '蜜桃红茶' }, { key: 'D', label: '陈皮白茶' }],
  answerKey: 'B',
};

function loadTemplate(page, advancedConfigJson) {
  page.fillFormWithTemplateData({
    id: 307, title: '闭眼味觉师', validationMethod: 0, status: 1,
    advancedConfigJson,
  });
}

test('从货架采用的 v5.1 模板：回填→存盘，玩法配置一字不掉', () => {
  const page = loadPage();
  loadTemplate(page, JSON.stringify({ schemaVersion: 1, blindTaste: BLIND_TASTE }));

  assert.equal(page.data.advancedConfigError, '', '既有模板不该读出错误');
  assert.equal(page.data.advanced.blindTaste.answerKey, 'B', '答案必须回填出来');
  assert.equal(page.data.advanced.blindTaste.options.length, 4);

  const saved = page.prepareFormData().advancedConfigJson;
  assert.notEqual(saved, '', '★ 只配了盲品也是配了 —— 存回去不能是空串(修复前正是这里把玩法删掉的)');
  assert.deepEqual(JSON.parse(saved).blindTaste, BLIND_TASTE);
});

test('在页面上改盲品选项，答案跟着选项走，不留悬空 answerKey', () => {
  const page = loadPage();
  loadTemplate(page, JSON.stringify({ schemaVersion: 1, blindTaste: BLIND_TASTE }));

  // 把答案项(B)的 key 改成 B2 —— answerKey 必须跟着改
  page.updateBlindOption({ currentTarget: { dataset: { index: 1, field: 'key' } }, detail: { value: 'B2' } });
  assert.equal(page.data.advanced.blindTaste.answerKey, 'B2');

  // 删掉答案项 —— 答案落到剩下的第一项,而不是指向一个不存在的选项
  page.removeBlindOption({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.advanced.blindTaste.answerKey, 'A');
  assert.equal(JSON.parse(page.prepareFormData().advancedConfigJson).blindTaste.answerKey, 'A');
});

test('签文池的换行草稿与落库的二维数组保持一致', () => {
  const page = loadPage();
  loadTemplate(page, JSON.stringify({
    schemaVersion: 1,
    dailySign: { enabled: true, signer: '猫向导', sealText: '城瘾', poems: [['第一条', '第二行']] },
  }));
  assert.deepEqual(page.data.dailySignDrafts, ['第一条\n第二行'], '回填时草稿必须由签文重建');

  page.addDailyPoem();
  page.updateDailyPoem({ currentTarget: { dataset: { index: 1 } }, detail: { value: '新签第一行\n新签第二行\n' } });

  const saved = JSON.parse(page.prepareFormData().advancedConfigJson).dailySign;
  assert.deepEqual(saved.poems, [['第一条', '第二行'], ['新签第一行', '新签第二行']],
    '末尾空行要清掉,其余原样落库');
});

test('本模块不认识的将来玩法段，过一遍配置页也还在', () => {
  const page = loadPage();
  loadTemplate(page, '{"schemaVersion":1,"woodFish":{"enabled":true,"taps":108}}');
  const saved = page.prepareFormData().advancedConfigJson;
  assert.deepEqual(JSON.parse(saved).woodFish, { enabled: true, taps: 108 });
});

test('配置有错时保留原文待修，不静默丢弃用户填的内容', () => {
  const page = loadPage();
  loadTemplate(page, JSON.stringify({
    schemaVersion: 1,
    blindTaste: Object.assign({}, BLIND_TASTE, { answerKey: 'Z' }),  // 答案不在选项里
  }));
  const saved = page.prepareFormData().advancedConfigJson;
  assert.match(JSON.parse(saved).blindTaste.answerKey, /Z/, '错误配置原样带回,交给校验拦下并让用户改');
});


test('相册模板页面：增改删、保存回填、复制互不串数据', () => {
  const page = loadPage();
  page.fillFormWithTemplateData({ title: '梦', advancedConfigJson: JSON.stringify({ album: { enabled: true, images: [{ url: 'https://example.com/old.jpg', line: '旧配文' }] } }) });
  const event = index => ({ currentTarget: { dataset: index == null ? {} : { index } } });
  page.chooseAlbumImage(event()); imageCallback(['https://example.com/new.jpg']);
  page.onAlbumLine({ ...event(1), detail: { value: '第二张' } });
  page.chooseAlbumImage(event(0)); imageCallback(['https://example.com/replaced.jpg']);
  page.data.formData.title = '童年回忆';
  const saved = page.prepareFormData();
  const copy = loadPage(); copy.fillFormWithTemplateData(saved);
  assert.equal(copy.data.formData.title, '童年回忆');
  assert.deepEqual(copy.data.advanced.album.images, [
    { url: 'https://example.com/replaced.jpg', line: '旧配文' },
    { url: 'https://example.com/new.jpg', line: '第二张' },
  ]);
  copy.removeAlbumImage(event(0));
  assert.equal(copy.data.advanced.album.images[0].line, '第二张');
  assert.equal(page.data.advanced.album.images.length, 2);
  assert.equal(JSON.parse(saved.advancedConfigJson).album.images.length, 2);
});

test('相册上传：取消、失败及切换模板后的迟到回调都不覆盖旧图', () => {
  const page = loadPage();
  const original = { album: { enabled: true, images: [{ url: 'https://example.com/old.jpg', line: '保留' }] } };
  page.fillFormWithTemplateData({ title: '梦', advancedConfigJson: JSON.stringify(original) });
  const event = { currentTarget: { dataset: { index: 0 } } };
  for (const result of [undefined, []]) {
    page.chooseAlbumImage(event); imageCallback(result);
    assert.deepEqual(page.data.advanced.album.images, original.album.images);
  }
  page.chooseAlbumImage(event);
  const stale = imageCallback;
  page.fillFormWithTemplateData({ title: '另一本', advancedConfigJson: JSON.stringify(original) });
  stale(['https://example.com/wrong.jpg']);
  assert.deepEqual(page.data.advanced.album.images, original.album.images);
});
