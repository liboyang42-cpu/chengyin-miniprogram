const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMPONENT = '../../pages/publish/components/collaborator-picker/index.js';
const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

let componentConfig;
let requests;

global.getApp = () => ({
  sendRequest: (request) => requests.push(request),
  getPageSize: () => 10,
  getTotalPage: (total, pageSize) => Math.ceil(total / pageSize),
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.Component = (config) => { componentConfig = config; };

beforeEach(() => {
  componentConfig = null;
  requests = [];
  delete require.cache[require.resolve(COMPONENT)];
  require(COMPONENT);
});

function makeComponent(data = {}) {
  const events = [];
  const component = Object.assign({}, componentConfig.methods);
  component.data = Object.assign({}, componentConfig.data, { ids: '' }, data);
  component.setData = (patch) => Object.assign(component.data, patch);
  component.triggerEvent = (name, detail) => events.push({ name, detail });
  return { component, events };
}

function assertVisibleStateWiring(wxml) {
  assert.match(wxml, /<cy-skeleton[^>]*wx:if="\{\{loading && !list\.length\}\}"/);
  assert.match(wxml, /<cy-error[^>]*wx:elif="\{\{loadError && !list\.length\}\}"[^>]*bind:retry="onRetry"/);
  assert.match(wxml, /<cy-empty[^>]*wx:elif="\{\{nodata && !list\.length\}\}"/);
  assert.match(wxml, /<view[^>]*wx:if="\{\{list\.length\}\}"[^>]*>[\s\S]*?<cy-error[^>]*wx:elif="\{\{loadError\}\}"[^>]*bind:retry="onRetry"/);
}

function assertHostWiring(wxml, label) {
  const tag = wxml.match(/<cy-collaborator-picker\b[^>]*\/>/);
  assert.ok(tag, `${label} 必须渲染合作者选择器`);
  assert.match(tag[0], /bind:select="onCollaboratorPickerSelect"/);
  assert.match(tag[0], /bind:close="onCollaboratorPickerClose"/);
}

test('模板把首屏三态与分页失败重试接到组件状态机', () => {
  const config = JSON.parse(read('pages/publish/components/collaborator-picker/index.json'));
  for (const name of ['cy-skeleton', 'cy-error', 'cy-empty']) {
    assert.ok(config.usingComponents[name], `选择器必须注册 ${name}`);
  }
  assertVisibleStateWiring(read('pages/publish/components/collaborator-picker/index.wxml'));
});

test('负控：摘掉分页错误的 retry 接线必须判红', () => {
  const source = read('pages/publish/components/collaborator-picker/index.wxml');
  const mutated = source.replace(
    'title="更多合作者没能加载出来" sub="{{loadError}}" bind:retry="onRetry"',
    'title="更多合作者没能加载出来" sub="{{loadError}}"',
  );
  assert.notEqual(mutated, source, '负控必须真实摘掉分页 retry 接线');
  assert.throws(() => assertVisibleStateWiring(mutated), assert.AssertionError);
});

test('activity 把选择器的 select 与 close 事件接回页面', () => {
  assertHostWiring(read('pages/publish/activity/index.wxml'), 'activity');
});

// 2026-09-05 用户裁决:专业发布页(fabu)删掉合作者选择器 —— 它只是署名,没有协作权限,
// 选择器还拉全平台用户且搜索没接过滤。宿主从两个变成一个,这里把「fabu 已摘干净」钉住,
// 免得以后有人把它接回去而不再看这条契约。
test('fabu 不再渲染合作者选择器', () => {
  const merged = read('pages/publish/fabu/step3.wxml') + read('pages/publish/fabu/topic-detail-sheet.wxml');
  assert.equal(merged.includes('cy-collaborator-picker'), false, 'fabu 不应再渲染合作者选择器');
  assert.equal(merged.includes('AddCollaborator'), false, 'fabu 不应再有添加合作者入口');
});

test('负控：任一宿主摘掉 close 接线必须判红', () => {
  const source = read('pages/publish/activity/index.wxml');
  const mutated = source.replace(' bind:close="onCollaboratorPickerClose"', '');
  assert.notEqual(mutated, source, '负控必须真实摘掉宿主 close 接线');
  assert.throws(() => assertHostWiring(mutated, 'activity 负控'), assert.AssertionError);
});

test('首屏失败保留错误态，重试仍请求第一页而不伪装成空列表', () => {
  const { component } = makeComponent();

  component._getList(1);
  requests[0].success({ code: '500', msg: '服务暂不可用' });
  requests[0].complete();

  assert.equal(component.data.loading, false);
  assert.equal(component.data.nodata, false);
  assert.equal(component.data.loadError, '服务暂不可用');
  assert.equal(component.data.loadErrorPage, 1);

  component.onRetry();
  assert.equal(requests[1].data.pageNum, 1);
});

test('下一页失败不推进页码，重试成功后才追加失败页', () => {
  const { component } = makeComponent({
    list: [{ id: 1, displayName: '已加载合作者' }],
    page_no: 1,
    hasMore: true,
    loading: false,
  });

  component.onReachBottom();
  assert.equal(requests[0].data.pageNum, 2);
  assert.equal(component.data.page_no, 1);

  requests[0].fail();
  requests[0].complete();
  assert.equal(component.data.page_no, 1);
  assert.equal(component.data.loadErrorPage, 2);

  component.onRetry();
  assert.equal(requests[1].data.pageNum, 2);
  requests[1].success({ code: '200', data: { rows: [{ id: 2, nickname: '重试结果' }], total: 20 } });
  requests[1].complete();

  assert.equal(component.data.page_no, 2);
  assert.deepEqual(component.data.list.map((item) => item.id), [1, 2]);
  assert.equal(component.data.loadError, '');
});

test('服务端空值会规范化为可渲染字段，缺 id 的行不可邀请', () => {
  const { component } = makeComponent({ ids: '7' });

  component._getList(1);
  requests[0].success({
    code: '200',
    data: {
      rows: [
        { id: null, nickname: '', followNum: null },
        { id: 7, nickname: '夜航主理人', followNum: 0 },
      ],
      total: 2,
    },
  });
  requests[0].complete();

  assert.deepEqual(component.data.list, [
    {
      id: null,
      nickname: '',
      followNum: null,
      displayName: '未命名用户',
      followText: 0,  // UI-04(2026-09-18):关注数没取到显示 0
      isSelected: false,
      isDisabled: true,
    },
    {
      id: 7,
      nickname: '夜航主理人',
      followNum: 0,
      displayName: '夜航主理人',
      followText: 0,
      isSelected: true,
      isDisabled: true,
    },
  ]);
});

test('选择事件拒绝缺 id 行，只向父页面回传有效合作者', () => {
  const { component, events } = makeComponent();

  component.selectMember({ currentTarget: { dataset: { item: { id: null, isDisabled: true } } } });
  assert.equal(events.length, 0);

  const item = { id: 9, displayName: '星海观察员', isDisabled: false };
  component.selectMember({ currentTarget: { dataset: { item } } });
  assert.deepEqual(events, [{ name: 'select', detail: { item } }]);
});
