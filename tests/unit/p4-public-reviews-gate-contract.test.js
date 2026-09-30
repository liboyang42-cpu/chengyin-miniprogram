// 4-04 / 阻断#18:玩家从商家主页进「评价」被商家门禁踢出。
//
// 评价的**公开查看**不该挂商家门禁:public 模式是设计给玩家看的(页面调
// /api/merchant/reviews/public),而 cy-access-gate 在 attached 时无条件读
// /api/merchant/access/me,玩家拿到 active:false 就被整屏盖住、2 秒后退出。
// 商家专属的操作(回复/举报)仍只在 manage 模式下挂门禁。
//
// 同根因的另一处:旧商家主页兼容壳只做「旧链接 → 统一主页」的公开重定向,
// 挂门禁会让玩家在重定向前被门禁盖屏(门禁与 redirectTo 竞态)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const REVIEWS_WXML = 'pages/merchant/reviews/index.wxml';
const PROFILE_WXML = 'pages/merchant/profile/index.wxml';

test('4-04 评价页公开模式不挂商家门禁,管理态才挂', () => {
  const wxml = read(REVIEWS_WXML);
  const gate = wxml.match(/<cy-access-gate\b[^>]*>/);
  assert.ok(gate, '管理态仍需要商家守卫兜底');
  assert.match(gate[0], /wx:if="\{\{mode === 'manage'\}\}"/,
    '公开查看评价(玩家)不挂商家门禁,否则玩家 2 秒后被踢出');

  // 负控:把条件去掉,断言必须真红 —— 证明这条契约不是空转
  const broken = wxml.replace('wx:if="{{mode === \'manage\'}}"', '');
  assert.throws(() => {
    const brokenGate = broken.match(/<cy-access-gate\b[^>]*>/);
    assert.match(brokenGate[0], /wx:if="\{\{mode === 'manage'\}\}"/);
  }, assert.AssertionError, '无条件挂门禁的写法必须被判红');
});

test('4-04 公开模式走的仍是公开接口,门禁不参与公开取数', () => {
  const js = read('pages/merchant/reviews/index.js');
  assert.match(js, /mode === 'manage'[\s\S]{0,200}\/api\/merchant\/reviews\/manage/,
    '管理态才请求 manage 接口');
  assert.match(js, /url: `\/api\/merchant\/reviews\/public\?merchantRowId=/,
    '公开模式必须保留 public 接口');
  assert.doesNotMatch(js, /\/api\/merchant\/access\/me/, '页面自己不再读商家身份(交给条件门禁)');
});

test('4-04 旧商家主页兼容壳不再挂商家门禁,只做公开重定向', () => {
  const wxml = read(PROFILE_WXML);
  assert.doesNotMatch(wxml, /<cy-access-gate\b/,
    '兼容壳是公开重定向过场:玩家/匿名从旧分享进来不该被门禁盖屏');
  assert.match(wxml, /<cy-nav-bar title="商家主页"/, '壳本身仍保留兜底渲染');
  const js = read('pages/merchant/profile/index.js');
  assert.match(js, /url: '\/api\/merchant\/public-home'/,
    '壳只用公开接口解析目的地,不需要商家身份');
});
