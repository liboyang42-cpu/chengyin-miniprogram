// 定价页「合作阵容」入口契约(2026-09-19 批复 1-a=2:合作方页不删,把入口接进定价页)
// 钉死三件事:①定价页渲染 lineup 行并绑 goPartner;②跳转 URL 带全 topicId+toType+toId 三参
// (partner 页 onLoad 缺任一参即落 invalidLink 守卫);③partner 路由仍在 app.json 注册。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('定价页渲染合作阵容行并绑定 goPartner', () => {
  const wxml = read('pages/topic/pricing/index.wxml');
  assert.match(wxml, /wx:for="\{\{lineup\}\}"/, '阵容列表必须遍历 lineup');
  assert.match(wxml, /bindtap="goPartner"/, '阵容行必须接 goPartner');
  assert.match(wxml, /wx:key="lineupKey"/, '行 key 用 toType:toId 组合,防跨类型同 id 撞 key');
});

test('goPartner 跳转携带 partner 页守卫要求的全部三参', () => {
  const js = read('pages/topic/pricing/index.js');
  const call = js.match(/goPartner\(e\)[\s\S]*?\n\s{2}\},/);
  assert.ok(call, 'goPartner 处理器存在');
  const body = call[0];
  assert.match(body, /\/pages\/topic\/pricing\/partner\/index/, '跳向合作方页');
  assert.match(body, /topicId=/, '带 topicId');
  assert.match(body, /toType=/, '带 toType');
  assert.match(body, /toId=/, '带 toId');
});

test('合作方页路由仍在 app.json 注册(入口与注册同进退)', () => {
  const appJson = JSON.parse(read('app.json'));
  const flat = appJson.pages.concat(
    (appJson.subPackages || []).flatMap((sp) => sp.pages.map((p) => sp.root + '/' + p))
  );
  assert.ok(flat.some((p) => p.includes('topic/pricing/partner/index')), 'partner 页必须注册');
});

test('partner 页返回链路回得到定价页(goBack 用 topicId 重开定价)', () => {
  const js = read('pages/topic/pricing/partner/index.js');
  assert.match(js, /\/pages\/topic\/pricing\/index\?topicId=/, '直达进 partner 后返回应落回定价页');
});
