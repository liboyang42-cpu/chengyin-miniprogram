const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { npcIconKey, pixelDrawSize, collectNpcIconNeeds, markerAvatar } = require('../../utils/roam-npc-marker.js');

const poi = (over) => Object.assign({
  id: 1, cat: 'merchant', state: 'passed', nodeLevel: 1, npcAvatar: 'https://x/a.png'
}, over);
// 默认所有点都是 actionable;需要别的态时按 id 覆盖
const stateBy = (map) => (p) => map[p.id] || 'actionable';

test('像素图只按整数倍放大', () => {
  assert.equal(pixelDrawSize(16, 64), 64);   // 4x
  assert.equal(pixelDrawSize(32, 64), 64);   // 2x
  assert.equal(pixelDrawSize(64, 64), 64);   // 1:1
  // 非整除:24 → floor(64/24)=2 → 48。宁可画小一点,也不要 2.67x 的半像素
  assert.equal(pixelDrawSize(24, 64), 48);
  assert.equal(pixelDrawSize(48, 64), 48);
  // 原图更大时按目标框画
  assert.equal(pixelDrawSize(128, 64), 64);
  // 脏输入不能算出 0 或 NaN —— 那会画出一个不可见的 marker,而且不报错
  assert.equal(pixelDrawSize(0, 64), 64);
  assert.equal(pixelDrawSize(undefined, 64), 64);
  assert.equal(pixelDrawSize(16, 0), 1);
});

test('fog 的店绝不生成形象图标', () => {
  // 没探索到的店提前露脸 = 泄露地图信息,而且不会有任何报错
  const need = collectNpcIconNeeds({
    pois: [poi({ id: 1, state: 'fog' })], getState: stateBy({})
  });
  assert.equal(need.size, 0);
});

test('打卡态保持统一状态图标,不换成各家形象', () => {
  for (const st of ['target', 'checkin-failed']) {
    const need = collectNpcIconNeeds({ pois: [poi({ id: 1 })], getState: stateBy({ 1: st }) });
    assert.equal(need.size, 0, st + ' 不该生成形象图标');
  }
});

test('只收商家、且必须配了形象', () => {
  const need = collectNpcIconNeeds({
    pois: [
      poi({ id: 1, cat: 'landmark' }),
      poi({ id: 2, npcAvatar: '' }),
      poi({ id: 3 })
    ],
    getState: stateBy({})
  });
  assert.equal(need.size, 1);
  assert.equal([...need.values()][0].url, 'https://x/a.png');
});

test('商家上传头像优先于 NPC 形象，并使用不同游戏框', () => {
  const merchant = poi({
    mapAvatar: 'https://x/shop.png', mapAvatarKind: 'merchant', npcAvatar: 'https://x/npc.png'
  });
  assert.equal(markerAvatar(merchant), 'https://x/shop.png');
  const need = collectNpcIconNeeds({ pois: [merchant], getState: stateBy({}) });
  const entry = [...need.entries()][0];
  assert.equal(entry[1].kind, 'merchant');
  assert.ok(entry[0].endsWith('-merchant'));

  const npcNeed = collectNpcIconNeeds({ pois: [poi()], getState: stateBy({}) });
  assert.equal([...npcNeed.values()][0].kind, 'npc');
  assert.ok([...npcNeed.keys()][0].endsWith('-npc'));
});

test('同图同态只生成一次;已探店是另一张图', () => {
  const need = collectNpcIconNeeds({
    pois: [poi({ id: 1 }), poi({ id: 2 }), poi({ id: 3 })],
    getState: stateBy({ 3: 'completed' })
  });
  assert.equal(need.size, 2);
  assert.ok([...need.keys()].some(k => k.includes('-done-')));
});

test('等级不同 = 不同缓存图标', () => {
  const need = collectNpcIconNeeds({
    pois: [poi({ id: 1, nodeLevel: 1 }), poi({ id: 2, nodeLevel: 3 })],
    getState: stateBy({})
  });
  assert.equal(need.size, 2);
});

test('已缓存的不重收，失败名单不重试 —— 否则会「生成→重刷→再生成」死循环', () => {
  const key = npcIconKey('https://x/a.png', 1, false, 'npc');
  assert.equal(collectNpcIconNeeds({
    pois: [poi({ id: 1 })], icons: { [key]: '/tmp/a.png' }, getState: stateBy({})
  }).size, 0);
  assert.equal(collectNpcIconNeeds({
    pois: [poi({ id: 1 })], failed: { 'https://x/a.png': true }, getState: stateBy({})
  }).size, 0);
});

test('有上限，一屏几十家店不会打出下载风暴', () => {
  const pois = [];
  for (let i = 0; i < 100; i++) pois.push(poi({ id: i, npcAvatar: 'https://x/' + i + '.png' }));
  assert.equal(collectNpcIconNeeds({ pois, getState: stateBy({}) }).size, 24);
});

test('页面按形象优先选图标，且 target/checkin-failed 例外仍在', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../pages/roam/index.js'), 'utf8');
  // 形象分支必须排在通用点位图标之前，否则配了形象也永远轮不到它
  const npcAt = js.indexOf('this._icons[npcKey]');
  const nodeAt = js.indexOf('this._icons[nodeStyle.iconKey]');
  assert.ok(npcAt > 0 && nodeAt > 0 && npcAt < nodeAt, '形象图标必须优先于通用点位图标');
  // canvas 是地图 marker 唯一能关插值的地方，CSS 的 image-rendering 到不了原生层
  assert.match(js, /imageSmoothingEnabled = false/);
});
