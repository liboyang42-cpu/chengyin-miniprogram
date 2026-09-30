const { test } = require('node:test');
const assert = require('node:assert');
const { normName, pickRep, groupMerchantsByName, stampProgress, doneShopCount, selectNearShopGroups, SAME_SHOP_M } = require('../../utils/roam-poi-group.js');
const { distM } = require('../../utils/roam-geo.js');

// 人民广场;m2lat(1) = 1/111320 度 ≈ 8.98e-6,故 at(n) ≈ 正北 n 米
const HERE = { lat: 31.230416, lng: 121.473701 };
const at = (m) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng });
const M = (o) => Object.assign({ cat: 'merchant', state: 'fog' }, at(0), o);

// 先自证坐标 helper 本身没骗人 —— 否则所有距离相关的断言都是在测空气
test('[meta] at(n) 造出的点距 HERE 约 n 米', () => {
  assert.ok(Math.abs(distM(at(30), HERE) - 30) < 1.5, `at(30) 实测 ${distM(at(30), HERE).toFixed(1)}m`);
  assert.ok(Math.abs(distM(at(100), HERE) - 100) < 3, `at(100) 实测 ${distM(at(100), HERE).toFixed(1)}m`);
});

/* ============ 归组:同一家店的多源副本 ============ */

test('机制①跨源:同店 nearby(数字id) + roam(r前缀id),坐标相同 → 合成一组', () => {
  const groups = groupMerchantsByName([
    M({ id: 5, name: '转角奶茶', nodeId: 5 }),
    M({ id: 'r9', name: '转角奶茶', _roamId: 9 }),
  ]);
  assert.strictEqual(groups.length, 1);
});

test('机制②源内:同店两条报名记录(node_id=0 退到 regId)→ 合成一组', () => {
  const groups = groupMerchantsByName([
    M({ id: 771, name: '山丘咖啡' }),
    M({ id: 802, name: '山丘咖啡' }),
  ]);
  assert.strictEqual(groups.length, 1);
});

test('多源副本坐标有几米出入(登记地址精度)仍算同一家', () => {
  const groups = groupMerchantsByName([
    M({ id: 5, name: '甲', nodeId: 5, ...at(0) }),
    M({ id: 'r9', name: '甲', _roamId: 9, ...at(12) }),
  ]);
  assert.strictEqual(groups.length, 1);
});

/* ============ ★ 不许误并:身份键必须是「店名 + 坐标邻近」 ============ */

test('★ 同名连锁分店(相距 > SAME_SHOP_M)不合并 —— 误并会让第二家永久消失', () => {
  const groups = groupMerchantsByName([
    M({ id: 11, name: '星巴克', nodeId: 11, ...at(0) }),
    M({ id: 22, name: '星巴克', nodeId: 22, ...at(60) }),
  ]);
  assert.strictEqual(groups.length, 2);
});

test('★ 兜底伪造名「商家」一律不归组(address_name 可空,一批无名店会全叫这个)', () => {
  const groups = groupMerchantsByName([
    M({ id: 11, name: '商家', nameKnown: false, ...at(0) }),
    M({ id: 12, name: '商家', nameKnown: false, ...at(5) }),   // 坐标再近也不许并
    M({ id: 13, name: '商家', nameKnown: false, ...at(40) }),
  ]);
  assert.strictEqual(groups.length, 3);
  assert.strictEqual(doneShopCount([
    M({ id: 11, name: '商家', nameKnown: false, state: 'done', ...at(0) }),
    M({ id: 12, name: '商家', nameKnown: false, state: 'done', ...at(5) }),
    M({ id: 13, name: '商家', nameKnown: false, state: 'done', ...at(40) }),
  ]), 3, '三家无名店探完就是 3 家,不能塌成 1 家(否则「三店连亮」永不触发)');
});

test('无坐标不敢合并(宁可多弹一张卡,也不让整家店消失)', () => {
  const groups = groupMerchantsByName([
    { cat: 'merchant', state: 'fog', id: 5, name: '甲' },
    { cat: 'merchant', state: 'fog', id: 6, name: '甲' },
  ]);
  assert.strictEqual(groups.length, 2);
});

test('机制③同 id 不同店(多商家竞标同一 node)→ 不合并,且 key 不撞', () => {
  const groups = groupMerchantsByName([
    M({ id: 102, name: 'A 店' }),
    M({ id: 102, name: 'B 店' }),
  ]);
  assert.strictEqual(groups.length, 2);
  assert.notStrictEqual(groups[0].key, groups[1].key, 'wx:key 撞了会让 swiper 复用错乱');
});

test('同名不同店的两组 key 也不撞', () => {
  const groups = groupMerchantsByName([
    M({ id: 11, name: '星巴克', nodeId: 11, ...at(0) }),
    M({ id: 22, name: '星巴克', nodeId: 22, ...at(60) }),
  ]);
  assert.notStrictEqual(groups[0].key, groups[1].key);
});

/* ============ 代表条目 ============ */

test('代表条目必须是有 nodeId 的那条(_apiCheckin 强依赖 nodeId,挑错代表=打卡静默失效)', () => {
  const groups = groupMerchantsByName([
    M({ id: 'r9', name: '转角奶茶', _roamId: 9 }),
    M({ id: 5, name: '转角奶茶', nodeId: 5 }),
  ]);
  assert.strictEqual(groups[0].rep.nodeId, 5);
});

test('代表条目退化序:无 nodeId 时优先 roam 真 POI(能进 /api/roam 的账)', () => {
  assert.strictEqual(pickRep([{ id: 108 }, { id: 'r9', _roamId: 9 }])._roamId, 9);
});

/* ============ 杂项 ============ */

test('店名前后空格归一', () => {
  assert.strictEqual(groupMerchantsByName([M({ id: 1, name: ' 甲 ' }), M({ id: 2, name: '甲' })]).length, 1);
  assert.strictEqual(normName('  x  '), 'x');
});

test('只归组 merchant,地标/公园不进组', () => {
  const groups = groupMerchantsByName([M({ id: 1, name: '甲' }), Object.assign(at(0), { cat: 'landmark', state: 'fog', id: 2, name: '老钟楼' })]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].name, '甲');
});

test('无名店丢弃(按店名归组时无法定位)', () => {
  assert.strictEqual(groupMerchantsByName([M({ id: 1, name: '' }), M({ id: 2, name: null })]).length, 0);
});

/* ============ 集章进度 ============ */

test('集章分子含 done/passed —— 证明是在全集上算,不是在过滤后的数组上算', () => {
  const pois = [
    M({ id: 1, name: '甲', state: 'done', ...at(0) }),
    M({ id: 2, name: '乙', state: 'passed', ...at(100) }),
    M({ id: 3, name: '丙', state: 'fog', ...at(200) }),
  ];
  assert.deepStrictEqual(stampProgress(pois), { done: 2, total: 3 });
});

test('集章进度去重:同店两条 done 只算一枚章', () => {
  const pois = [
    M({ id: 5, name: '转角奶茶', nodeId: 5, state: 'done' }),
    M({ id: 'r9', name: '转角奶茶', _roamId: 9, state: 'done' }),
    M({ id: 7, name: '巷子面馆', state: 'fog', ...at(200) }),
  ];
  assert.deepStrictEqual(stampProgress(pois), { done: 1, total: 2 });
});

test('组内任一条 done|passed → 整组已集', () => {
  const groups = groupMerchantsByName([
    M({ id: 5, name: '转角奶茶', nodeId: 5, state: 'done' }),
    M({ id: 'r9', name: '转角奶茶', _roamId: 9, state: 'fog' }),
  ]);
  assert.strictEqual(groups[0].collected, true);
});

test('doneShopCount:同店两条 done 只算一家(#23 落库口径,数错=把错的计数固化进库)', () => {
  const pois = [
    M({ id: 5, name: '转角奶茶', nodeId: 5, state: 'done' }),
    M({ id: 'r9', name: '转角奶茶', _roamId: 9, state: 'done' }),
    M({ id: 7, name: '巷子面馆', state: 'done', ...at(200) }),
  ];
  assert.strictEqual(doneShopCount(pois), 2);
});

test('doneShopCount 只数本次会话 done,历史 passed 不算', () => {
  assert.strictEqual(doneShopCount([
    M({ id: 1, name: '甲', state: 'done' }),
    M({ id: 2, name: '乙', state: 'passed', ...at(100) }),
  ]), 1);
});

/* ============ selectNearShopGroups:浮卡该弹谁 ============ */

test('★ 同店另一源副本还是 fog 时不重复弹卡 —— 归组必须在全集上做', () => {
  // 若只拿"近处 fog/seen"子集归组,done 那条早被滤掉 → doneInSession 恒 false → 卡照弹
  const pois = [
    M({ id: 5, name: '转角奶茶', nodeId: 5, state: 'done' }),
    M({ id: 'r9', name: '转角奶茶', _roamId: 9, state: 'fog' }),
  ];
  assert.strictEqual(selectNearShopGroups(pois, HERE, 80).length, 0);
});

test('未集章的近店照弹', () => {
  assert.strictEqual(selectNearShopGroups([M({ id: 5, name: '转角奶茶', nodeId: 5 })], HERE, 80).length, 1);
});

test('★ 历史探过(passed)的店本次仍可再探 —— 过滤用 doneInSession 而非 collected', () => {
  // startVisit 只挡 done,passed 本来就允许再探;用 collected 过滤会砍掉既有玩法
  const sel = selectNearShopGroups([
    M({ id: 5, name: '甲', state: 'passed' }),
    M({ id: 6, name: '甲', state: 'fog' }),
  ], HERE, 80);
  assert.strictEqual(sel.length, 1);
  assert.strictEqual(sel[0].group.collected, true, '卡上应显示「已集 ✓」');
});

test('超出 NEAR_M 的店不弹卡', () => {
  assert.strictEqual(selectNearShopGroups([M({ id: 5, name: '甲', ...at(500) })], HERE, 80).length, 0);
});

test('同店多源只弹一张,距离取最近的那条副本', () => {
  const sel = selectNearShopGroups([
    M({ id: 5, name: '甲', nodeId: 5, ...at(25) }),
    M({ id: 'r9', name: '甲', _roamId: 9, ...at(5) }),
  ], HERE, 80);
  assert.strictEqual(sel.length, 1);
  assert.ok(sel[0].distM <= 8, `应取最近副本的距离,实得 ${sel[0].distM}m`);
  assert.strictEqual(sel[0].group.rep.nodeId, 5, '代表仍是能打卡的那条');
});

test('★ 同名分店各弹各的卡(误并会让第二家永久没有入口)', () => {
  const sel = selectNearShopGroups([
    M({ id: 11, name: '星巴克', nodeId: 11, ...at(0) }),
    M({ id: 22, name: '星巴克', nodeId: 22, ...at(60) }),
  ], HERE, 80);
  assert.strictEqual(sel.length, 2);
  // 探完第一家,第二家照样弹
  const sel2 = selectNearShopGroups([
    M({ id: 11, name: '星巴克', nodeId: 11, state: 'done', ...at(0) }),
    M({ id: 22, name: '星巴克', nodeId: 22, ...at(60) }),
  ], HERE, 80);
  assert.strictEqual(sel2.length, 1);
  assert.strictEqual(sel2[0].group.rep.id, 22);
});

test('按距离升序', () => {
  const sel = selectNearShopGroups([
    M({ id: 1, name: '远', ...at(70) }),
    M({ id: 2, name: '近', ...at(10) }),
  ], HERE, 80);
  assert.deepStrictEqual(sel.map((s) => s.group.name), ['近', '远']);
});

test('地标不进商家浮卡', () => {
  assert.strictEqual(selectNearShopGroups([Object.assign(at(0), { cat: 'landmark', state: 'fog', id: 1, name: '老钟楼' })], HERE, 80).length, 0);
});

test('空/异常输入不炸', () => {
  assert.deepStrictEqual(groupMerchantsByName(null), []);
  assert.deepStrictEqual(groupMerchantsByName([null, undefined]), []);
  assert.deepStrictEqual(stampProgress([]), { done: 0, total: 0 });
  assert.strictEqual(doneShopCount(undefined), 0);
  assert.deepStrictEqual(selectNearShopGroups(null, HERE, 80), []);
  // roam POI 的 lat 可能是 parseFloat(null)=NaN → 不该炸,也不该乱并
  assert.strictEqual(groupMerchantsByName([
    { cat: 'merchant', state: 'fog', id: 1, name: '甲', lat: NaN, lng: NaN },
    { cat: 'merchant', state: 'fog', id: 2, name: '甲', lat: NaN, lng: NaN },
  ]).length, 2);
});

test('[meta] SAME_SHOP_M 是 30m —— 改这个阈值必须同步重估上面的分店用例', () => {
  assert.strictEqual(SAME_SHOP_M, 30);
});
