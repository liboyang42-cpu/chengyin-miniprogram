const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => fs.readFileSync(`${__dirname}/../../${p}`, 'utf8');

test('RUN-001: 客户页没有活动外广播入口或发送代码，活动导演台仍有广播', () => {
  for (const ext of ['js', 'wxml']) {
    assert.doesNotMatch(read(`pages/merchant/customer/index.${ext}`), /openCast|sendCast|\/crm\/broadcast|定向广播/);
  }
  assert.match(read('pages/club/topic-detail/index.wxml'), /定向广播/);
});

test('RUN-002: 管理与筛选独立弹层，列表仍可批量选人', () => {
  const wxml = read('pages/merchant/customer/index.wxml');
  assert.match(wxml, /<cy-sheet[^>]*show="\{\{toolsOpen\}\}"[^>]*title="客户管理"/);
  assert.match(wxml, /<cy-sheet[^>]*show="\{\{filterOpen\}\}"[^>]*title="筛选客户"/);
  assert.match(wxml, /data-memberid="\{\{item.memberId\}\}"/);
  assert.match(wxml, /wx:if="\{\{selecting\}\}"/);
});

test('客户页不再提供合规触达弹窗，分群仍用于客户筛选', () => {
  const wxml = read('pages/merchant/customer/index.wxml');
  assert.doesNotMatch(wxml, /合规触达|campaignOpen|previewCampaign|submitCampaign/);
  assert.match(wxml, /bindtap="applySavedSegment"/);
});
