'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('客户页按 Figma 25:124 展示四个业务筛选和紧凑名单', () => {
  const js = read('pages/merchant/customer/index.js');
  const wxml = read('pages/merchant/customer/index.wxml');
  const wxss = read('pages/merchant/customer/index.wxss');

  const hero = wxml.indexOf('class="cu-hero"');
  const segments = wxml.indexOf('class="cu-segs"');
  const search = wxml.indexOf('<cy-search');
  const list = wxml.indexOf('class="cu-list"');
  assert.ok(hero >= 0 && hero < segments && segments < search && search < list,
    '客户页应按标题 → 分段筛选 → 搜索 → 名单排列');
  assert.match(wxml, /class="cu-hero-title">客户</);
  assert.match(wxml, /class="cu-hero-sub">\{\{customerSummaryText\}\}<\/text>/);
  // 2026-09-25 CU-M-120/147 给三段补了 emptyLabel(空态专用说法),这条原来把整个对象字面量写死,
  // 多一个属性就红。钉的其实是「四枚分段的 key/label 与顺序」,所以只钉到 label 为止。
  assert.match(js, /\{ key: 'all', label: '全部' \}[\s\S]*\{ key: 'repeat', label: '回头客'[\s\S]*\{ key: 'new', label: '新客'[\s\S]*\{ key: 'noted', label: '有备注'/);
  assert.doesNotMatch(js, /\{ key: 'pending', label: '待核销' \}/);
  assert.doesNotMatch(wxml, /class="cu-seg-num"/);
  assert.match(wxml, /class="cu-note" wx:if="\{\{item\.latestNote\}\}"/);
  assert.match(wxml, /class="cu-phone-row" wx:if="\{\{item\.phoneText\}\}"/);
  assert.match(wxml, /catchtap="copyCustomerPhone"[^>]*data-memberid="\{\{item\.memberId\}\}"/);
  assert.match(wxml, /class="cu-copy-img" src="\/pages\/merchant\/images\/icon_copy\.svg"/);
  // F15:拨打/复制前先向服务端换取明文,拿到的号才用;列表里的脱敏号不得直接拨/复制。
  assert.match(js, /copyCustomerPhone\(e\)\s*\{\s*this\._revealCustomerContact\(e, 'copy'\);\s*\}/);
  assert.match(js, /callCustomer\(e\)\s*\{\s*this\._revealCustomerContact\(e, 'call'\);\s*\}/);
  assert.match(js, /url: `\/api\/merchant\/crm\/customers\/\$\{memberId\}\/contact`/);
  assert.match(js, /data: JSON\.stringify\(\{ purpose \}\)/);
  assert.match(js, /wx\.setClipboardData\(\{ data: phone \}\)/);
  assert.match(wxml, /<cy-icon class="cu-arrow" name="arrow-right"/);
  assert.match(wxss, /\.cu-seg\s*\{[^}]*border-radius:\s*var\(--cy-radius-pill\)/s);
  assert.match(wxss, /\.cu-search\s*\{[^}]*padding:\s*0 24rpx/s);
});

test('项目客户抽屉贴住安全区且只有一层面板背景', () => {
  const wxml = read('pages/topic/components/project-drawer/index.wxml');
  const wxss = read('pages/topic/components/project-drawer/index.wxss');

  assert.match(wxml, /class="dw-stack" wx:if="\{\{!customerMode\}\}"/,
    '黑色堆叠层只能保留给旧抽屉，客户模式不得渲染');
  assert.match(wxss, /\.dw--customer\s*\{[^}]*bottom:\s*0;[^}]*overflow:\s*hidden;/s,
    '客户抽屉必须贴底并裁掉圆角外溢');
  assert.match(wxml, /<view class="dw-scroll-pad"><\/view>/,
    '客户抽屉安全区应留在同色面板内部');
  assert.match(wxss, /\.dw\s*\{[^}]*bottom:\s*96rpx;[^}]*overflow:\s*visible;/s,
    '非客户抽屉必须保留原有几何，避免客户改版波及共享组件');
});

test('主办与承接两套主题名单都使用客户和核销口径', () => {
  for (const file of [
    'pages/topic/components/project-host/index.wxml',
    'pages/topic/components/project-join/index.wxml',
  ]) {
    const wxml = read(file);
    assert.match(wxml, /<project-drawer[^>]*title="客户"[^>]*customer-mode="\{\{true\}\}"/s, `${file} 应使用客户弹窗外壳`);
    assert.match(wxml, />已核销 <text class="dsum-n"/);
    assert.match(wxml, />待核销 <text class="dsum-n"/);
    assert.doesNotMatch(wxml, />已到店 <text class="dsum-n"/);
    assert.doesNotMatch(wxml, />未到店 <text class="dsum-n"/);
    assert.doesNotMatch(wxml, /class="drun"/);
    assert.doesNotMatch(wxml, /\{\{ p\.ticketNo \}\}/);
    assert.match(wxml, /class="dr-sub">\{\{ g\.when \}\}<\/text>/);
    assert.match(wxml, /class="dr-phone" wx:if="\{\{ p\.phone \}\}"/,
      `${file} 每位有权限查看电话的客户都应显示电话行`);
    assert.match(wxml, /data-act="copyText"[^>]*data-text="\{\{ p\.phone \}\}"[^>]*aria-label="复制电话"/,
      `${file} 电话行应提供复制入口`);
    assert.match(wxml, /wx:if="\{\{ playerSheet\.contactHint \}\}">\{\{ playerSheet\.contactHint \}\}<\/view>/,
      `${file} 应在后端下发联系方式限制时如实说明`);
  }

  const hostJs = read('pages/topic/components/project-host/index.js');
  const hostWxml = read('pages/topic/components/project-host/index.wxml');
  const joinWxml = read('pages/topic/components/project-join/index.wxml');
  const pageJs = read('pages/topic/merchantinfo/merchantinfo.js');
  const pageWxml = read('pages/topic/merchantinfo/merchantinfo.wxml');
  assert.match(hostJs, /playerActions:\s*\{ type: Array, value: \[\] \}/,
    '主办组件必须接收客户抽屉动作');
  assert.match(hostWxml, /<project-drawer[^>]*actions="\{\{ playerActions \}\}"[^>]*bind:action="emitDrawerAction"/s,
    '主办客户抽屉必须保留唯一的查看台账入口');
  assert.doesNotMatch(joinWxml, /actions="\{\{ playerActions \}\}"/,
    '承接方已有页面内真实入口，客户抽屉不重复造入口');
  assert.match(pageJs, /playerActions:\s*\[\]/);
  assert.match(pageJs, /this\.data\.role === 'host'[\s\S]*key: 'goLedger'[\s\S]*label: '查看全店台账'/,
    '页面只能为主办方客户抽屉下发查看台账动作，且 CU-M-183 要求写明全店作用域');
  assert.match(pageWxml, /<project-host[\s\S]*playerActions="\{\{ playerActions \}\}"[\s\S]*bind:act="onJoinAct"/,
    '主办页必须把查看台账动作传入组件');

  const icon = read('pages/topic/images/icon_copy.svg');
  assert.match(icon, /<g id="copy-06">/);
  assert.match(icon, /stroke="black"/);
  assert.doesNotMatch(icon, /stroke="#999999"/);

  for (const file of [
    'pages/topic/components/project-host/index.wxss',
    'pages/topic/components/project-join/index.wxss',
  ]) {
    const wxss = read(file);
    assert.match(wxss, /\.player-row \.dr-phone \{[^}]*margin-top:\s*12rpx;/s,
      `${file} 应拉开时间与电话的垂直间距`);
  }
});
