const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('D-001 客户页退役活动外广播，不能保留可调用发送方法', () => {
  const source = fs.readFileSync(__dirname + '/../../pages/merchant/customer/index.js', 'utf8');
  assert.doesNotMatch(source, /openCast|sendCast|_sendCastConfirmed|\/crm\/broadcast/);
  assert.doesNotMatch(source, /previewCampaign|submitCampaign|toggleCampaignPanel|\/crm\/campaigns/);
  const wxml = fs.readFileSync(__dirname + '/../../pages/merchant/customer/index.wxml', 'utf8');
  assert.doesNotMatch(wxml, /合规触达|campaignOpen|submitCampaign/);
  const director = fs.readFileSync(__dirname + '/../../pages/club/topic-detail/index.wxml', 'utf8');
  assert.match(director, /定向广播/);
});
