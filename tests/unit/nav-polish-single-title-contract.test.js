// 导航统一后的「单一大标题」闸:cy-page-title 下沉后,页面自带头的同名标题必须删干净。
// 锁的是"同一个词不能既做页标题、又做页内独立标题节点",不是某个写死的文案。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

// 本轮去重的 7 页(样板 = subpackageMember/coupon/coupon)
const PAGES = [
  'subpackageMember/coupon/coupon.wxml',
  'subpackageMember/couponInfo/couponInfo.wxml',
  'pages/publish/activity/index.wxml',
  'subpackageP3/pages/growthcenter/index/index.wxml',
  'pages/coop/list/index.wxml',
  'pages/merchant/ledger/index.wxml',
  'pages/deregister/index.wxml'
];

function readPage(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function pageTitleOf(wxml, rel) {
  // 2026-08-20 商家标题统一:merchant 页的标题移入 cy-nav-bar 居中,锚点跟着走 —— 
  // 「同一个词不能出现两处标题」的语义不变,只是页标题的载体从 cy-page-title 变成 nav title。
  const tag = wxml.match(/<cy-page-title[\s\S]*?\/>/) || wxml.match(/<cy-nav-bar\b[^>]*\stitle="[^"]*"[^>]*>/);
  assert.ok(tag, `${rel}:cy-page-title/cy-nav-bar title 都不见了,单一大标题闸失去锚点`);
  const title = tag[0].match(/\stitle="([^"]*)"/);
  assert.ok(title, `${rel}:cy-page-title 缺 title 属性`);
  return { tag: tag[0], title: title[1] };
}

// 页内「标题节点」= class 里带 tit/title/hd/head/h1 的元素,且其文本恰好等于页标题词。
// 只算标题类节点:列表项里 `<text wx:else>优惠券</text>` 这种类型兜底文案不是标题,不该误报。
const HEADING_CLASS = /(^|[-_\s])(tit|title|hd|head|h1)([-_\s]|$)/;

function standaloneTitleNodes(body, title) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('<(view|text)([^>]*\\sclass="([^"]*)"[^>]*)>\\s*' + esc + '\\s*</\\1>', 'g');
  const hits = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[3].split(/\s+/).some((cls) => HEADING_CLASS.test(cls))) hits.push(m[0]);
  }
  return hits;
}

for (const rel of PAGES) {
  test(`${rel} 只有一行大标题(cy-page-title 之外不得再出现同名标题节点)`, () => {
    const wxml = readPage(rel);
    const { tag, title } = pageTitleOf(wxml, rel);
    assert.notEqual(title, '', `${rel}:页标题为空`);
    const body = wxml.replace(tag, '');
    const dups = standaloneTitleNodes(body, title);
    assert.deepEqual(
      dups,
      [],
      `${rel}:页内还留着与页标题「${title}」同名的独立标题节点(${dups.length} 处),双标题回归`
    );
  });
}

test('本轮并入 subtitle 的副标题没有跟着标题一起被删掉', () => {
  // 2026-09-15 CR-63(裁决 15):已售出活动进编辑时时间/地点已锁,副标题必须先说实话 ——
  // 原句「改未售出的场次、票务与地点」对着已售活动是反的。非锁定分支文案一字未改,
  // 这里更新的是「同一槽位的条件文案」,不是把副标题删掉。
  const expected = {
    'pages/publish/activity/index.wxml': "{{editingActivityId ? (timeLocationLocked ? '已售出：只能改文字、图片与票务' : '改未售出的场次、票务与地点') : '设定您的活动地点、票务信息'}}",
    'subpackageP3/pages/growthcenter/index/index.wxml': '城市探索 · 成就与排行榜'
  };
  for (const [rel, sub] of Object.entries(expected)) {
    const { tag } = pageTitleOf(readPage(rel), rel);
    const got = tag.match(/\ssubtitle="([^"]*)"/);
    assert.ok(got, `${rel}:自带头删掉了但副标题没并进 cy-page-title 的 subtitle 槽,信息丢失`);
    assert.equal(got[1], sub, `${rel}:subtitle 文案与规整专项拍板不符`);
  }
});

// 2026-07-31 契约反转:用户对本页的原话是「这个都放到消息里面 没有结算和发起邀请」,
// 顶部这两个 action 是被**要求**拿掉的。旧契约(锁它们必须待在 actions 槽里)记录的是
// 上一轮导航规整的中间态,已被该备注推翻,原样留着会反向锁死这次改动。
// 换成锁「拿掉之后两条路径都还在」——真正该防的不是"按钮消失",是"功能连同按钮一起消失"。
test('coop/list 顶部两个 action 已按用户备注移除,但两条路径都另有活着的入口', () => {
  const wxml = readPage('pages/coop/list/index.wxml');
  const js = readPage('pages/coop/list/index.js');

  assert.doesNotMatch(wxml, /bindtap="goMybiz"/, 'coop/list:「结算」按钮该按用户备注移除,又回来了');
  assert.doesNotMatch(wxml, /coop-nav-btn/, 'coop/list:「+ 发起邀请」按钮该按用户备注移除,又回来了');

  // 「发起邀请」这条路径本身要留着:两个空态 CTA 仍指 goInvite,方法不能跟着按钮一起被删,
  // 否则就是这批刚修过的那种"绑定还在、方法没了"的静默死链。
  assert.match(wxml, /bindcta="goInvite"/, 'coop/list:空态「去发起邀请」CTA 不该跟着一起删');
  assert.match(js, /\bgoInvite\(\)\s*\{/, 'coop/list:goInvite 方法必须还在,否则空态 CTA 是死链');

  // 资金域定稿后，合作分润降级为结算来源筛选；旧 mybiz 评分/提现中心不再保留。
  const ledger = readPage('pages/merchant/ledger/index.wxml');
  assert.match(ledger, /结算到账提醒/, '结算到账提醒仍应在资金域提供授权入口');
  assert.match(
    readPage('pages/merchant/ledger/index.js'),
    /\/api\/merchant\/finance\/settlement-entries/,
    '合作分润必须作为资金域收入来源读取，不得回退 /api/coop/mybiz'
  );
});

test('负控:goInvite 方法被连按钮一起删掉(空态 CTA 变死链)必须判红', () => {
  const js = readPage('pages/coop/list/index.js').replace(/\bgoInvite\(\)\s*\{/, 'goInviteGone() {');
  assert.doesNotMatch(js, /\bgoInvite\(\)\s*\{/, '变异未生效,负控本身是假的');
  assert.throws(() => assert.match(js, /\bgoInvite\(\)\s*\{/));
});
