const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('售后中心以服务端退款申请列表为真源并提供三段状态', () => {
  const js = read('pages/merchant/aftercare/index.js');
  const wxml = read('pages/merchant/aftercare/index.wxml');

  assert.match(js, /url:\s*['"`]\/api\/merchant\/aftercare\/list/);
  assert.match(js, /url:\s*['"`]\/api\/merchant\/access\/me/);
  assert.doesNotMatch(js, /merchantId\s*:/,
    '售后列表不得接收前端 merchantId 作为归属依据');
  ['PENDING', 'PROCESSING', 'COMPLETED'].forEach((bucket) => {
    assert.match(js + wxml, new RegExp(bucket));
  });
  assert.match(wxml, /wx:if="\{\{pageState === 'loading'\}\}"/);
  assert.match(wxml, /wx:elif="\{\{pageState === 'error'\}\}"/);
  assert.match(wxml, /wx:elif="\{\{pageState === 'empty'\}\}"/);
  assert.match(wxml, /wx:elif="\{\{pageState === 'no-permission'\}\}"/);
  assert.match(wxml, /data-refundid="\{\{item\.refundId\}\}"[^>]*bindtap="openDetail"/);
});

test('售后列表点击只把服务端 refund_application.id 带到详情页', () => {
  const js = read('pages/merchant/aftercare/index.js');
  assert.match(js, /\/pages\/merchant\/aftercare\/detail\/index\?refundId=/);
  assert.doesNotMatch(js, /aftersaleStatus|orderId|mmsMerchantId/,
    '不能拿订单售后状态或订单 ID 冒充退款申请 ID');
});

test('售后三段筛选使用 cy-tabs 的 detail.key 事件合同', () => {
  const js = read('pages/merchant/aftercare/index.js');
  const json = JSON.parse(read('pages/merchant/aftercare/index.json'));
  const wxml = read('pages/merchant/aftercare/index.wxml');

  assert.equal(json.usingComponents['cy-tabs'], '/components/cy/tabs/index');
  assert.equal((wxml.match(/<cy-tabs\b/g) || []).length, 2,
    '空态与列表态都必须保留同一筛选入口');
  assert.match(wxml,
    /<cy-tabs[^>]*tabs="\{\{tabs\}\}"[^>]*active="\{\{bucket\}\}"[^>]*bind:change="switchBucket"/);
  assert.match(js, /const bucket = event && event\.detail && event\.detail\.key;/,
    'cy-tabs 通过 detail.key 交付选中项，不能继续读取手写节点 dataset');
});

test('列表照 Revolut 316-318:左对齐大标题、搜索、按日分组行;无后端维度时不造「筛选」按钮', () => {
  const wxml = read('pages/merchant/aftercare/index.wxml');
  const js = read('pages/merchant/aftercare/index.js');
  assert.match(wxml, /<cy-page-title title="退款售后"/);
  assert.doesNotMatch(wxml, /<cy-nav-bar[^>]*title=/, '标题只出现一次');
  assert.match(wxml, /<cy-search[^>]*value="\{\{keyword\}\}"[^>]*bind:input="onSearchInput"/);
  assert.doesNotMatch(wxml.replace(/<!--[\s\S]*?-->/g, ''), /筛选|Filters|filter-lines/, '列表接口只有 bucket 维度,不得放假筛选按钮');
  assert.match(wxml, /wx:for="\{\{groups\}\}"[^>]*wx:for-item="group"/);
  assert.match(wxml, /\{\{group\.label\}\}/);
  assert.match(wxml, /acl-status--\{\{item\.statusTone\}\}/);
  assert.match(wxml, /\{\{item\.timeText\}\} ·/);
  assert.match(wxml, /<text class="fin-row__t1">\{\{item\.titleText\}\}<\/text>/, '行标题用 titleText(昵称优先)');
  assert.match(wxml, /wx:if="\{\{item\.takeoverText\}\}"[^>]*>· \{\{item\.takeoverText\}\}/, '转平台的单副标题注明');
  assert.match(wxml, /<text class="acl-activity" wx:if="\{\{item\.activityTitleText\}\}">/, '活动名第二行弱色');
  assert.match(wxml, /<cy-empty wx:if="\{\{keyword && !groups\.length\}\}"[^>]*title="没有找到"[^>]*cta="清除搜索" bind:cta="clearSearch"/);
  assert.match(wxml, /只在已加载的 \{\{items\.length \|\| 0\}\} 笔中搜索/, '本地过滤必须说明范围,不冒充全量搜索');
  assert.match(wxml, /wx:if="\{\{keyword && hasMore\}\}"[\s\S]*?bindtap="loadMore"/, '筛完行数太少滚不到底时必须有显式加载更多');
  assert.match(wxml, /acl-group-total" wx:if="\{\{group\.totalText && !keyword && !\(hasMore && index === groups\.length - 1\)\}\}"/,
    '搜索中或最后一组可能被分页截断时不得显示合计');
  assert.doesNotMatch(js, /keyword=|keyword:\s*this\.data\.keyword[^\n]*url/, '列表接口不支持关键词,不得拼进请求');
  assert.match(js, /groups: groupAftercareItems\(filterAftercareItems\(items, this\.data\.keyword\), new Date\(\)\)/,
    '翻页加载后必须按当前关键词重算分组');
});
