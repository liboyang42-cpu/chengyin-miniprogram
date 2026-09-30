const { test } = require('node:test');
const assert = require('node:assert/strict');
const view = require('../../pages/publish/utils/publish/route-map-view.js');

// 这些规则原本埋在 pages/publish/fabu/index.js 一个 178 行的页面方法里，一行测试都没有。
// 抽成纯函数后逐条钉住 —— 它们都是「错了不会报错、只会看起来怪」的那种判断。

const node = (id, lat, lng, extra) => Object.assign({ _localId: id, latitude: lat, longitude: lng }, extra || {});
const chapter = (id, nodes) => ({ _localId: id, nodes: nodes });

function build(state) {
  return view.buildRouteMapView(state);
}

test('空状态：不崩，且给兜底中心点', () => {
  const r = build({});
  assert.equal(r.patch.hasRoute, false);
  assert.equal(r.patch.mapMarkers.length, 0);
  // 空 include-points 会让腾讯 SDK fitBounds 崩溃，必须兜底
  assert.deepEqual(r.patch.mapInclude, [view.MAP_DEFAULT_CENTER]);
  assert.deepEqual(r.patch.mapCenter, view.MAP_DEFAULT_CENTER);
});

test('无坐标的节点被跳过，不占编号', () => {
  const r = build({ chapters: [chapter('c1', [
    node('n0', 0, 0),
    node('n1', 31.2, 121.4),
    { _localId: 'nx' },
    node('n2', 31.3, 121.5),
  ])] });
  assert.equal(r.patch.mapMarkers.length, 2);
  assert.deepEqual(r.patch.mapMarkers.map((m) => m.id), [1, 2]);
  assert.deepEqual(Object.keys(r.markerMap), ['1', '2']);
});

test('配色优先级：选中 > 起点 > 终点 > 已配游戏 > 草稿', () => {
  const nodes = [
    node('a', 31.1, 121.1),
    node('b', 31.2, 121.2, { templateId: 7 }),
    node('c', 31.3, 121.3),
    node('d', 31.4, 121.4),
  ];
  const plain = build({ chapters: [chapter('c1', nodes)] });
  const color = (i) => plain.patch.mapMarkers[i].label.bgColor;
  assert.equal(color(0), view.START_COLOR, '首个有效节点是起点');
  assert.equal(color(1), view.ROUTE_COLORS[0], '配了模板的取章节色');
  assert.equal(color(2), view.DRAFT_COLOR, '没配模板的是草稿灰');
  assert.equal(color(3), view.END_COLOR, '最后一个有效节点是终点');

  // 选中态压过一切，包括起点色
  const picked = build({ chapters: [chapter('c1', nodes)], selectedNodeLid: 'a' });
  assert.equal(picked.patch.mapMarkers[0].label.bgColor, view.SELECTED_COLOR);
  assert.equal(picked.patch.mapMarkers[0].width, 42, '选中态放大');
});

test('章节色按章节轮转，且跨章节编号连续', () => {
  const r = build({ chapters: [
    chapter('c1', [node('a', 31.1, 121.1, { templateId: 1 })]),
    chapter('c2', [node('b', 31.2, 121.2, { templateId: 1 })]),
  ] });
  // 只有 2 个节点时首尾就是起终点，取第 3 个才能看到章节色轮转
  const r3 = build({ chapters: [
    chapter('c1', [node('a', 31.1, 121.1), node('b', 31.15, 121.15, { templateId: 1 })]),
    chapter('c2', [node('c', 31.2, 121.2, { templateId: 1 }), node('d', 31.3, 121.3)]),
  ] });
  assert.equal(r3.patch.mapMarkers[1].label.bgColor, view.ROUTE_COLORS[0], '第 1 章用第 1 个色');
  assert.equal(r3.patch.mapMarkers[2].label.bgColor, view.ROUTE_COLORS[1], '第 2 章用第 2 个色');
  assert.deepEqual(r.markerMap['2'], { chapterLid: 'c2', nodeLid: 'b' }, '编号跨章节连续');
});

test('超过 30 个节点才简化，且起点/终点/选中始终不简化', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => node('n' + i, 31 + i / 1000, 121 + i / 1000));
  const at30 = build({ chapters: [chapter('c', mk(30))] });
  assert.equal(at30.patch.mapMarkers[5].width, 30, '30 个不简化(阈值是 > 30)');

  const at31 = build({ chapters: [chapter('c', mk(31))] });
  assert.equal(at31.patch.mapMarkers[5].width, 22, '31 个开始简化');
  assert.equal(at31.patch.mapMarkers[5].label.fontSize, 9);
  assert.equal(at31.patch.mapMarkers[5].label.borderWidth, undefined, '简化态去掉描边');
  assert.equal(at31.patch.mapMarkers[0].width, 30, '起点不简化');
  assert.equal(at31.patch.mapMarkers[30].width, 30, '终点不简化');
});

test('折线至少两点才画', () => {
  const one = build({ chapters: [chapter('c', [node('a', 31.1, 121.1)])] });
  assert.equal(one.patch.mapPolyline.length, 0, '单点不画折线');
  const two = build({ chapters: [chapter('c', [node('a', 31.1, 121.1), node('b', 31.2, 121.2)])] });
  assert.equal(two.patch.mapPolyline.length, 1);
  assert.equal(two.patch.mapPolyline[0].points.length, 2);
  assert.equal(two.patch.mapPolyline[0].arrowLine, true);
});

test('待编排地点可见但不编号、不进折线', () => {
  const r = build({
    chapters: [chapter('c', [node('a', 31.1, 121.1), node('b', 31.2, 121.2)])],
    pendingMaterials: [{ _localId: 'p1', latitude: 31.9, longitude: 121.9 }],
  });
  const pending = r.patch.mapMarkers.filter((m) => m.id >= 900100);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].label.content, '待编排');
  assert.deepEqual(r.markerMap['900100'], { pendingLocalId: 'p1' });
  // 折线只走正式节点
  assert.equal(r.patch.mapPolyline[0].points.length, 2);
  // 但要进入 include-points，否则镜头看不到它
  assert.equal(r.patch.mapInclude.length, 3);
});

test('编辑中的草稿点用固定 id 900001，文案随动作切换', () => {
  const adding = build({ popChapterNodes: true, popChapterNodesAction: 0,
    nodesForm: { latitude: 31.5, longitude: 121.5 } });
  assert.equal(adding.patch.mapMarkers[0].id, 900001);
  assert.equal(adding.patch.mapMarkers[0].label.content, '待添加');

  const editing = build({ popChapterNodes: true, popChapterNodesAction: 1,
    nodesForm: { latitude: 31.5, longitude: 121.5 } });
  assert.equal(editing.patch.mapMarkers[0].label.content, '编辑中');

  const closed = build({ popChapterNodes: false, nodesForm: { latitude: 31.5, longitude: 121.5 } });
  assert.equal(closed.patch.mapMarkers.length, 0, '弹层没开就不画草稿点');
});

test('有选中节点时不覆盖镜头中心（否则会把 selectNode 的定位顶掉）', () => {
  const nodes = [node('a', 31.1, 121.1), node('b', 31.2, 121.2)];
  const free = build({ chapters: [chapter('c', nodes)] });
  assert.deepEqual(free.patch.mapCenter, { latitude: 31.1, longitude: 121.1 });

  const picked = build({ chapters: [chapter('c', nodes)], selectedNodeLid: 'b' });
  assert.equal('mapCenter' in picked.patch, false, '选中时必须不下发 mapCenter');
});

test('★负控：模块不碰 this，也不调 wx', () => {
  const raw = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../pages/publish/utils/publish/route-map-view.js'), 'utf8');
  // 必须先剥注释再查：模块头部逐条记录了「this.data.X → state.X」的搬运对照表，
  // 不剥的话这条负控会被自己的文档触发 —— 那是控制写错了，不是发现了问题。
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.match(raw, /this\.data\.formData\.chapters/, '头部搬运对照表不该被删掉');
  assert.doesNotMatch(src, /\bthis\./, '纯函数模块出现 this. 说明抽得不干净');
  assert.doesNotMatch(src, /\bwx\./, '纯函数模块不该调用 wx API');
  assert.doesNotMatch(src, /setData/, '纯函数模块不该自己 setData');
});
