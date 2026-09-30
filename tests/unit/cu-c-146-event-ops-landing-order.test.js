// CU-C-146:「现场名册与核销」入口承诺的是本场,落地却先给人看全俱乐部。
//
// 走查实测(隔离库 #7002 / 项目 #990030):入口路由带 activityId=32,
// pages/club/event-ops 的首屏仍是「活动运营 / 日期清单 + 重复方式表单」,
// 要滚过日期/时间编辑和「保存未来场次」才看到「本场管理 → 本场名册」,
// 而名册 section 的标题和它上面那行「本场名册 · N 人」在同屏重复出现两次
// (那行还不可点,纯占位)。
//
// 修法的形状:两段「本场」内容本来就只在带 activityId / 有核销权限时渲染,
// 把它们提到 ready 区块最前面即可 —— 从「更多→场次管理」(只有 topicId)进来时
// 这两段整段不出现,全量清单照旧是第一屏,不需要任何分支或二次入口。
// 计数并入名册标题,上面那行只在**没有核销权限**(名册整段不渲染)时留作说明。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const EVENT_OPS = 'pages/club/event-ops/index.wxml';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const READY_OPEN = '  <block wx:elif="{{state === \'ready\'}}">\n';
const SERIES_MARK = '    <!-- 日期清单(Figma E1)';

// 按源码顺序扫出 ready 区块里的每个 section(标题 + 渲染条件)。
function sections(wxml) {
  const start = wxml.indexOf(READY_OPEN);
  assert.ok(start >= 0, '找不到 state===ready 区块,扫描锚点失效');
  const body = wxml.slice(start + READY_OPEN.length);
  const out = [];
  const re = /<view class="section[^"]*"([^>]*)>/g;
  let match;
  while ((match = re.exec(body))) {
    const guard = (match[1].match(/wx:if="\{\{([^}]*)\}\}/) || [])[1] || null;
    const title = body.slice(match.index).match(/class="section-title">([^<]*)</);
    out.push({ guard, title: title ? title[1].trim() : '' });
  }
  return out;
}

function indexOfTitle(list, prefix) {
  return list.findIndex((item) => item.title.indexOf(prefix) === 0);
}

function assertLandingOrder(wxml) {
  const list = sections(wxml);
  const manage = indexOfTitle(list, '本场管理');
  const roster = indexOfTitle(list, '本场名册');
  const series = indexOfTitle(list, '日期清单');
  assert.ok(manage >= 0 && roster >= 0 && series >= 0,
    `三段都在(本场管理 / 本场名册 / 日期清单): ${JSON.stringify(list.map((s) => s.title))}`);
  assert.equal(Math.min(manage, roster), 0,
    '带 activityId 进来时第一段就得是本场内容,名册不该在页尾');
  assert.ok(roster < series && manage < series,
    '全俱乐部的日期清单排在本场之后');
  assert.match(String(list[roster].guard), /canCheckin/,
    '名册仍只给有核销权限的人(整段条件不许放宽)');
  assert.match(String(list[manage].guard), /activityId/,
    '本场管理仍只给带 activityId 的入口(否则「场次管理」进来会凭空多一段)');
  assert.match(list[roster].title, /rosterTotal/,
    '本场人数并进名册标题 —— 收掉重复标题不能把人数一起丢掉');

  const dup = wxml.match(/<text class="row-title">本场名册<\/text>/g) || [];
  assert.equal(dup.length, 1, '「本场名册」这一行标题只允许出现一次');
  const at = wxml.indexOf('<text class="row-title">本场名册</text>');
  assert.match(wxml.slice(Math.max(0, at - 400), at), /wx:if="\{\{!canCheckin\}\}"/,
    '这行只在没有核销权限(名册整段不渲染)时出现,否则与下方同名 section 重复');
}

test('CU-C-146 现场名册入口:本场名册 / 本场管理排在首屏,日期清单退到其后', () => {
  assertLandingOrder(read(EVENT_OPS));
});

test('CU-C-146 全量清单只有一条路径能看见:不带 activityId 的入口不渲染本场段', () => {
  const wxml = read(EVENT_OPS);
  const list = sections(wxml);
  const series = list[indexOfTitle(list, '日期清单')];
  assert.equal(series.guard, 'canManage', '日期清单的条件口径不变');
  assert.doesNotMatch(series.guard, /activityId/, '全量清单不该被本场参数绑住');
});

test('CU-C-146 名册人数只算三个到场桶(候补另计),标题口径不许悄悄换成 registered', () => {
  const js = read('pages/club/event-ops/index.js');
  const fn = js.match(/function rosterTotal\(buckets\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'rosterTotal 还在,口径要能静态核对');
  assert.match(fn[0], /registered[\s\S]*arrived[\s\S]*noShow/, fn[0]);
  assert.doesNotMatch(fn[0], /waitlist/, '候补不算进名册总数(CU-C-62 口径)');
});

// ------------------------------------------------------------------ 负控
// 把两段「本场」内容挪回日期清单之后 = 撤掉这次修复后的版面。
function moveBackSections(wxml) {
  const start = wxml.indexOf(READY_OPEN);
  const bodyStart = start + READY_OPEN.length;
  const cut = wxml.indexOf(SERIES_MARK, bodyStart);
  const endTag = '\n  </block>\n\n  <!-- E2';
  const end = wxml.indexOf(endTag, cut);
  assert.ok(cut > bodyStart && end > cut, '负控锚点失效(源码已改动?)');
  const moved = wxml.slice(bodyStart, cut);
  const rest = wxml.slice(cut, end + 1);
  const out = wxml.slice(0, bodyStart) + rest + moved + wxml.slice(end + 1);
  assert.notEqual(out, wxml, '负控没改动任何字节');
  return out;
}

test('negative control:把本场段挪回页尾,首屏落点检查必须判红', () => {
  const broken = moveBackSections(read(EVENT_OPS));
  const list = sections(broken);
  assert.equal(list[0].title, '日期清单',
    `挪回去之后首屏仍是全量清单了吗: ${JSON.stringify(list.map((s) => s.title))}`);
  assert.throws(() => assertLandingOrder(broken), assert.AssertionError);
});

test('negative control:去掉那行的 !canCheckin 条件,同屏重复标题检查必须判红', () => {
  const wxml = read(EVENT_OPS);
  const broken = wxml.replace('<block wx:if="{{!canCheckin}}">', '<block>');
  assert.notEqual(broken, wxml, '负控锚点失效(源码已改动?)');
  assert.throws(() => assertLandingOrder(broken), assert.AssertionError);
});

test('negative control:把人数从名册标题里删掉(只留一个标题)也必须判红', () => {
  const wxml = read(EVENT_OPS);
  const broken = wxml.replace(
    '<text class="section-title">本场名册{{rosterState === \'ready\' ? \' · \' + rosterTotal + \' 人\' : \'\'}}</text>',
    '<text class="section-title">本场名册</text>',
  );
  assert.notEqual(broken, wxml, '负控锚点失效(源码已改动?)');
  assert.throws(() => assertLandingOrder(broken), assert.AssertionError);
});
