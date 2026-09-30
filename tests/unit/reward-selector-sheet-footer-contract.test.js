// 契约（2026-09-19 用户返工口径「视觉结构不对，对齐其他弹窗结构」）：
// 选择优惠券 sheet 的「新建优惠券」必须是底部 footer（slot="footer"，带安全区），
// 不得埋在滚动正文里留大片空白；「不发券」行与券条目同构（reward-sheet__copy 上下两行）。
// 相册证据：~/Desktop/城瘾temp优惠券sheet修复验证_20260919/。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('选择奖励 sheet：新建奖励收进 footer slot，正文里不再埋 CTA', () => {
  const wxml = read('pages/publish/components/reward-selector/index.wxml');
  const at = wxml.indexOf('title="选择奖励"');
  assert.notEqual(at, -1);
  const sheet = wxml.slice(at, wxml.indexOf('</cy-sheet>', at));
  assert.match(sheet, /footer="\{\{allowCreate\}\}"/, 'footer 闸必须随 allowCreate 开合');
  const footerAt = sheet.indexOf('slot="footer"');
  assert.notEqual(footerAt, -1, '「新建优惠券」没进 footer slot');
  assert.match(sheet.slice(footerAt, footerAt + 260), /createCoupon/, 'footer 里应是新建奖励 CTA');
  // 2026-09-20 用户两轮点名「按钮是黑色的」:CTA 必须走 cy-btn primary(商家域=黑底),不许白描边自造按钮
  assert.match(sheet.slice(footerAt, footerAt + 260), /<cy-btn variant="primary"/, '新建奖励必须是主按钮皮肤');
  assert.doesNotMatch(sheet.slice(0, wxml.length), /class="reward-sheet__create"/, '正文里还埋着旧描边 CTA');
});

test('「不发奖励」行与奖励条目同构：名称/副文案走 reward-sheet__copy 竖排', () => {
  const wxml = read('pages/publish/components/reward-selector/index.wxml');
  const none = wxml.slice(wxml.indexOf('class="reward-sheet__none"'), wxml.indexOf('reward-sheet__kinds'));
  assert.match(none, /class="reward-sheet__copy"/, '裸 <view> 会让两段文案挤成一行');
});

test('创建优惠券与体验卡使用弹层大标题字号，且不放大全站 sheet', () => {
  const wxml = read('pages/publish/components/reward-selector/index.wxml');
  const sheetWxss = read('components/cy/sheet/index.wxss');
  assert.match(wxml, /title="创建\{\{rewardKind === 'PASS' \? '体验卡' : '优惠券'\}\}"[\s\S]{0,220}--cy-sheet-heading-size:\s*var\(--cy-font-sheet-title\)/);
  assert.match(sheetWxss, /font-size:\s*var\(--cy-sheet-heading-size,\s*var\(--cy-font-subtitle\)\)/, '共享 sheet 必须保留原字号兜底');
});
