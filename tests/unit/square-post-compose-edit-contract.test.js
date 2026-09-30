/**
 * H050 · cy-post-compose 编辑态契约。
 *
 * 编辑复用新建面板(唯一一份编辑器),但有两件事必须钉死:
 *   ① 编辑只提交 id + 正文 + 关联 —— 图片/地点不发,后端 R10-06「null 不碰原值」保留;
 *      关联必须重发,后端编辑分支对 data_id 是「无值即清 0」。
 *   ② 编辑不碰「新建」草稿槽位(读也不读、写也不写,更不在成功后 removeDraft)。
 * 负控:把 pics 塞回编辑载荷 / 把渲染层的 editMode 文案改回写死,对应断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const COMPONENT_JS = 'pages/square/components/cy/post-compose/index.js';
const COMPONENT_WXML = 'pages/square/components/cy/post-compose/index.wxml';

function loadComponent(opts) {
  const options = opts || {};
  const source = options.source || read(COMPONENT_JS);
  let definition;
  const requests = [];
  const draftCalls = [];
  const intentCalls = [];
  const app = {
    getUserID: () => 1,
    getAvatar: () => '',
    getNickname: () => '',
    getRequestErrorMessage: (error, fallback) => fallback,
    sendRequest(request) { requests.push(request); return { aborted: false, abort() { this.aborted = true; } }; },
  };
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    Component: (config) => { definition = config; },
    require(id) {
      if (id.includes('pro-editor-draft')) {
        return {
          saveDraft(wx, payload) { draftCalls.push(['save', payload]); return true; },
          loadDraft() { return { status: 'empty' }; },
          removeDraft(wx, identity) { draftCalls.push(['remove', identity]); return true; },
        };
      }
      if (id.includes('publish-intent')) {
        return {
          begin() { intentCalls.push('begin'); return { key: 'K'.repeat(20), previousUnknown: false }; },
          settle() { intentCalls.push('settle'); },
          discard() { intentCalls.push('discard'); },
        };
      }
      if (id.includes('/toast')) return Object.assign(() => {}, { success() {}, hide() {} });
      if (id.includes('nav-safe-area')) return { resolveMenuChrome: () => ({ sheetTop: 60 }) };
      if (id.includes('location-manager')) return { pickLocation() {} };
      if (id.includes('datetime')) return { chinaParts: () => null };
      throw new Error('unexpected require: ' + id);
    },
    wx: {
      getMenuButtonBoundingClientRect: () => ({ bottom: 64 }),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }),
      getStorageSync: () => '',
      setStorageSync() {},
      removeStorageSync() {},
    },
    setTimeout() {},
    clearTimeout() {},
  }, { filename: path.join(ROOT, COMPONENT_JS) });

  assert.ok(definition, 'post-compose 必须注册 Component');
  const props = Object.assign({ show: false, prefill: '', editPost: null }, options.props || {});
  const instance = {
    data: Object.assign({}, JSON.parse(JSON.stringify(definition.data)), props),
    triggerEvent() {},
    selectComponent: () => null,
    setData(patch, done) {
      Object.entries(patch).forEach(([key, value]) => {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let cursor = this.data;
        parts.slice(0, -1).forEach((part) => {
          if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
          cursor = cursor[part];
        });
        cursor[parts[parts.length - 1]] = value;
      });
      if (done) done.call(this);
    },
  };
  Object.assign(instance, definition.methods);
  if (definition.lifetimes && definition.lifetimes.attached) definition.lifetimes.attached.call(instance);
  return { definition, instance, requests, draftCalls, intentCalls };
}

const openEdit = (h) => h.definition.observers.show.call(h.instance, true);
const openCreate = (h) => h.definition.observers.show.call(h.instance, true);

test('渲染层:编辑态换标题/提交键,收起草稿入口与附件工具;删掉 editMode 条件即红', () => {
  const wxml = read(COMPONENT_WXML);
  const assertRender = (source) => {
    assert.match(source, /cmp-bar-title">\{\{editMode \? '编辑帖文' : '新建帖文'\}\}/, '标题要随编辑态切换');
    assert.match(source, /wx:if="\{\{!editMode\}\}" bindtap="onOpenDrafts"/, '编辑器不读也不写新建草稿,编辑态不给草稿入口');
    assert.match(source, /class="cmp-tools" wx:if="\{\{!editMode\}\}"/, '编辑只提交正文,附件工具必须收起(留着就是骗用户)');
    assert.match(source, /aria-label="\{\{editMode \? '保存' : '发布'\}\}"/, '提交键文案随编辑态切换');
  };
  assertRender(wxml);

  // 负控:把附件工具的条件写回「恒显示」,同一断言必须真红
  const mutated = wxml.replace('class="cmp-tools" wx:if="{{!editMode}}"', 'class="cmp-tools"');
  assert.notEqual(mutated, wxml, '负控锚点失效:附件工具条件未命中');
  assert.throws(() => assertRender(mutated), assert.AssertionError);
});

test('编辑态:正文按原帖预填,提交只发 id+正文+关联,不占意图键、不碰草稿', () => {
  const h = loadComponent({ props: { editPost: { id: '77', contents: '发错原文', dataId: 9, dataType: 1 } } });
  openEdit(h);
  assert.equal(h.instance.data.editMode, true);
  assert.equal(h.instance.data.content, '发错原文');
  assert.equal(h.instance.data.canSubmit, true);

  h.instance.onPublish();
  const write = h.requests.find((r) => r.url === '/api/creativesquare/action');
  assert.ok(write, '编辑必须走 /api/creativesquare/action');
  const payload = write.data;
  assert.equal(payload.id, '77', '编辑必须带原帖 id(后端 isEdit 判据)');
  assert.equal(payload.contents, '发错原文');
  assert.equal(String(payload.data_id), '9', '关联必须重发:后端编辑分支对 data_id 无值即清 0');
  assert.equal(String(payload.data_type), '1');
  assert.equal('pics' in payload, false, '不提交图片 = 后端保留原图;发空串会把配图清掉');
  assert.equal('address' in payload, false);
  assert.equal('longitude' in payload, false);
  assert.equal('latitude' in payload, false);
  assert.equal('request_id' in payload, false, '编辑是幂等 update,不占新建的发布意图键');
  assert.equal(h.intentCalls.length, 0, '编辑不得读写发布意图');
  assert.equal(h.draftCalls.length, 0, '编辑不写草稿槽位');

  write.success({ code: '200', data: {} });
  assert.equal(h.draftCalls.some((call) => call[0] === 'remove'), false, '编辑成功不得清掉用户的新建草稿');

  // 负控:把 pics 塞回编辑载荷,「不提交图片」这条断言必须真红
  const brokenSource = read(COMPONENT_JS).replace(
    "            id: that._editId,\n            contents: content,",
    "            id: that._editId,\n            contents: content,\n            pics: (that.data.picList || []).join(';'),",
  );
  assert.notEqual(brokenSource, read(COMPONENT_JS), '负控锚点失效:编辑载荷未命中');
  const broken = loadComponent({ source: brokenSource, props: { editPost: { id: '77', contents: '发错原文', dataId: 9, dataType: 1 } } });
  openEdit(broken);
  broken.instance.onPublish();
  const brokenPayload = broken.requests.find((r) => r.url === '/api/creativesquare/action').data;
  assert.equal('pics' in brokenPayload, true, '负控必须真的把 pics 塞回去');
  assert.throws(() => assert.equal('pics' in brokenPayload, false), assert.AssertionError);
});

test('编辑态关闭:不走关闭即存(草稿槽位只属于新建)', () => {
  const h = loadComponent({ props: { editPost: { id: '77', contents: '发错原文', dataId: 9, dataType: 1 } } });
  openEdit(h);
  h.definition.observers.show.call(h.instance, false);
  assert.equal(h.draftCalls.length, 0, '编辑关闭不得把正文写进新建草稿槽位');
});

test('新建态不被改坏:prefill 生效、载荷带 request_id 且不带 id', () => {
  const h = loadComponent({ props: { prefill: '半截草稿' } });
  openCreate(h);
  assert.equal(h.instance.data.editMode, false);
  assert.equal(h.instance.data.content, '半截草稿');
  h.instance.onPublish();
  const payload = h.requests.find((r) => r.url === '/api/creativesquare/action').data;
  assert.equal('id' in payload, false, '新建不得带 id(带了就变成改别人的帖)');
  assert.equal(payload.request_id, 'K'.repeat(20), '新建必须带发布意图键');
  assert.equal(h.intentCalls.includes('begin'), true);
});

test('3-19:同一宿主发过一帖后,再写新帖关闭仍存草稿(组件常驻不卸载)', () => {
  const h = loadComponent({ props: { prefill: '第一篇' } });
  openCreate(h);
  h.instance.onPublish();
  h.requests.find((r) => r.url === '/api/creativesquare/action').success({ code: '200', data: {} });
  h.definition.observers.show.call(h.instance, false);

  h.instance.data.prefill = '';
  openCreate(h);
  h.instance.applyContent('第二篇没发');
  h.definition.observers.show.call(h.instance, false);
  const saves = h.draftCalls.filter((call) => call[0] === 'save');
  assert.equal(saves.length, 1, '第二篇关闭时必须存草稿');
  assert.match(JSON.stringify(saves[0][1]), /第二篇没发/);
});
