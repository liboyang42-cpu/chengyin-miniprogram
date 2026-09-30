// 契约（2026-09-19 用户裁决）：弹层退出口只留右上角 ✕，底部「取消」一律删除。
// 本文件把三处已裁决落地的弹层钉死，防止「取消」被顺手加回来。
// 相册证据：~/Desktop/城瘾问题UI相册_20260919/ 卡 01/02/03。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('roam 分享 sheet：无底部「取消」，✕ 走 onProtoSheetClose', () => {
  const wxml = read('pages/roam/index.wxml');
  assert.doesNotMatch(wxml, /class="sh-cancel"/, '分享 sheet 的底部「取消」被加回来了');
  assert.match(wxml, /class="psheet__x" catchtap="onProtoSheetClose"/);
  // closeShare 退役的是「按钮出口」，不是 handler 本体：合并 master 后它被 ✕ 的历史分享
  // 还原路径（onProtoSheetClose → closeShare，R9-44）真实调用。钉两件事防回潮：
  // wxml 里不得再有 closeShare 绑定（那等于把「取消」请回来）；handler 不得被当僵尸误删。
  assert.doesNotMatch(wxml, /closeShare/, 'closeShare 按钮绑定回潮');
  const js = read('pages/roam/index.js');
  assert.match(js, /this\.closeShare\(\)/, '✕ 历史分享还原路径依赖 closeShare，别当僵尸删了');
});

test('shezhi 身份选择 sheet：无 reg-cancel，✕ 的 requestclose 仍接 closeRegPicker', () => {
  const wxml = read('pages/shezhi/shezhi.wxml');
  assert.doesNotMatch(wxml, /class="reg-cancel"/);
  assert.match(wxml, /<cy-scene-sheet[^>]*bind:requestclose="closeRegPicker"/);
});

test('创建优惠券 sheet：footer 只剩主 CTA，✕/遮罩仍走 dirty 保护的关闭链', () => {
  const wxml = read('pages/publish/components/reward-selector/index.wxml');
  const footer = wxml.slice(wxml.indexOf('slot="footer" class="create-footer"'), wxml.indexOf('</cy-sheet>', wxml.indexOf('create-footer')));
  assert.doesNotMatch(footer, /onCreateCancel/, '「取消」按钮被加回来了');
  assert.match(footer, /onCreateSubmit/);
  assert.match(wxml, /<cy-sheet[^>]*bind:close="onCreateClose"[^>]*bind:requestclose="onCreateRequestClose"/);
  const js = read('pages/publish/components/reward-selector/index.js');
  assert.doesNotMatch(js, /onCreateCancel\s*\(/, '僵尸 handler 应随按钮一起退役');
});

// CU-C-132:主题详情「评价路线」弹层原来不传 title,而 cy-sheet 的右上 ✕ 整段被
// wx:if="{{title}}" 把守,只剩点遮罩退出,和同页「选择票种」面板不一致。
// 修法是补上 title(标题即走面板头部、✕ 也回来),正文里重复的居中「评价路线」随之删掉。
test('评价路线 sheet：传 title 才有右上 ✕，正文不再重复居中那条标题', () => {
  const wxml = read('pages/topic/index/index.wxml');
  const vote = wxml.slice(wxml.indexOf('<cy-sheet show="{{ voteShow }}"'), wxml.indexOf('</cy-sheet>', wxml.indexOf('<cy-sheet show="{{ voteShow }}"')));
  assert.match(vote, /<cy-sheet[^>]*title="评价路线"/, '评价路线必须传 title,否则右上 ✕ 不渲染');
  assert.match(vote, /bind:close="voteClose"/, '✕ 关闭必须接回页面的 voteClose');
  assert.doesNotMatch(vote, /class="pop-tit[^"]*">\s*评价路线/, '正文里不该再有第二条居中「评价路线」');
});

test('负控:CU-C-132 把评价路线的 title 摘掉必须判红', () => {
  const file = 'pages/topic/index/index.wxml';
  const wxml = read(file);
  const mutated = wxml.replace('<cy-sheet show="{{ voteShow }}" title="评价路线" bind:close="voteClose">', '<cy-sheet show="{{ voteShow }}" bind:close="voteClose">');
  assert.notEqual(mutated, wxml, '负控变异注入失败:评价路线开标签要先同步');
  const vote = mutated.slice(mutated.indexOf('<cy-sheet show="{{ voteShow }}"'), mutated.indexOf('</cy-sheet>', mutated.indexOf('<cy-sheet show="{{ voteShow }}"')));
  assert.throws(
    () => assert.match(vote, /<cy-sheet[^>]*title="评价路线"/),
    /title/,
    '摘掉 title 后契约必须判红(✕ 会随 title 一起消失)',
  );
});
