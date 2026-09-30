const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('玩家设置页按商家和渠道显式 opt-in，默认关闭且 opt-out 走同一追加接口', () => {
  const component = read('pages/shezhi/components/marketing-consent/index.js');
  const wxml = read('pages/shezhi/components/marketing-consent/index.wxml');
  const settings = read('pages/shezhi/shezhi.wxml');
  assert.match(component, /\/api\/merchant\/crm\/marketing-consents/);
  assert.match(component, /merchantRowId/);
  assert.match(component, /merchantOwnerMemberId/);
  assert.match(component, /optedIn/);
  assert.doesNotMatch(component, /phone|openid|memberIds/);
  assert.match(wxml, /默认关闭/);
  assert.match(wxml, /站内活动消息/);
  assert.match(wxml, /商家优惠券/);
  assert.match(settings, /营销消息与优惠券/);
});
