/**
 * CU-M-82(2026-09-24 走查)· 角色形象页没编辑,直接返回仍误报「还没有保存」。
 *
 * 走查现象:角色资料为空 → 点「角色形象」进上传页 → 什么都不动直接返回,仍弹
 * 「还没有保存 / 放弃修改 / 继续编辑」。原因是 updateDirty 拿预览编码(空资料会回落到
 * 首个预设 px1:p01)与空 savedAvatar('') 直接 !== 比较,空资料一进页面就是脏的。
 *
 * 修复:restoreAvatar 落一个「进入本视图时的基线编码」,updateDirty 比基线。
 * ⚠️ 不能只加 `savedAvatar ?` 短路 —— 空资料下真的换了预设也必须弹确认,这条有专门用例。
 *
 * 负控在测试内联:把 updateDirty 改回比 savedAvatar,空资料首进那条必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pixelAvatar = require('../../utils/pixel-avatar.js');

const ROOT = path.resolve(__dirname, '../..');
const JS_PATH = 'pages/merchant/decor/ai-npc/index.js';
const PAGE_JS = fs.readFileSync(path.join(ROOT, JS_PATH), 'utf8');

const FIRST = pixelAvatar.AVATAR_IDS[0];
const OTHER = pixelAvatar.AVATAR_IDS[1];

function loadPage(source) {
  let definition = null;
  const noop = () => {};
  const app = { globalData: {}, sendRequest() {}, getUploadClient: () => ({ uploadAll: noop }) };
  const file = path.join(ROOT, JS_PATH);
  vm.runInNewContext(source, {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: {},
    console,
    setTimeout: noop,
    clearTimeout: noop,
    require(id) {
      if (id.includes('/toast')) return Object.assign(noop, { success: noop });
      if (id.includes('/merchant-theme')) return { merchantPageShow: noop, merchantPageRestore: noop };
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; });
      if (typeof callback === 'function') callback();
    },
    // 画布在单测里没有节点,预览不是本用例的被测对象
    _drawPreview: noop,
  });
  return page;
}

/** 空资料进入「角色形象」视图:后端无形象时 avatar 为空串。 */
function emptyAvatarView() {
  const page = loadPage(PAGE_JS);
  page._saved = { avatar: '', name: '', greeting: '', persona: '', knowledge: '' };
  page.data.savedAvatar = '';
  page.restoreAvatar();
  return page;
}

test('空资料进入形象视图:没编辑不算脏(走查的最小复现)', () => {
  const page = emptyAvatarView();
  page.updateDirty();
  assert.equal(page.data.dirty, false, '刚刚打开、什么都没改,不得报「还没有保存」');
});

test('空资料下真换了预设仍要判脏(不许用 savedAvatar 短路糊过去)', () => {
  const page = emptyAvatarView();
  page.data.presetId = OTHER;
  page.updateDirty();
  assert.equal(page.data.dirty, true, '空资料里换了预设也是真修改,离场必须弹确认');
});

test('照片处理出成品判脏', () => {
  const page = emptyAvatarView();
  page._portrait = { grid: [] };
  page.updateDirty();
  assert.equal(page.data.dirty, true);
});

test('已有形象:保存值就是基线,不改不脏;改了脏', () => {
  const page = loadPage(PAGE_JS);
  page._saved = { avatar: 'px1:' + FIRST, name: '', greeting: '', persona: '', knowledge: '' };
  page.data.savedAvatar = 'px1:' + FIRST;
  page.restoreAvatar();
  page.updateDirty();
  assert.equal(page.data.dirty, false);
  page.data.presetId = OTHER;
  page.updateDirty();
  assert.equal(page.data.dirty, true);
});

test('切到照片但没有成品:不算修改(空串不当成新形象)', () => {
  const page = emptyAvatarView();
  page.data.source = 'photo';
  page.data.uploadedUrl = '';
  page.updateDirty();
  assert.equal(page.data.dirty, false);
});

test('负控:updateDirty 改回比 savedAvatar 时,空资料首进那条必须真红', () => {
  const regressed = PAGE_JS.replace(
    'const baseline = typeof this._avatarBaseline === \'string\' ? this._avatarBaseline : this.data.savedAvatar;',
    'const baseline = this.data.savedAvatar;'
  ).replace(
    "dirty: !!this._portrait || (!!code && code !== baseline)",
    'dirty: !!this._portrait || code !== baseline'
  );
  assert.notEqual(regressed, PAGE_JS, '负控锚点失效:updateDirty 已改名,扫描口径需同步');
  const page = loadPage(regressed);
  page._saved = { avatar: '', name: '', greeting: '', persona: '', knowledge: '' };
  page.data.savedAvatar = '';
  page.restoreAvatar();
  page.updateDirty();
  assert.throws(() => assert.equal(page.data.dirty, false), assert.AssertionError);
  assert.equal(page.data.dirty, true);
});
