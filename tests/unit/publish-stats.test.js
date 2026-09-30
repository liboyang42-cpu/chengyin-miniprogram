// FE-11 发布器统计纯函数 publish-stats —— 从 fabu 抽出的章节/里程/时长/完成度计算。
// 断言锚定「与原 fabu 内联实现行为一致」:格式字符串、勾项数量、边界(空/非法坐标/<2节点)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  haversineKm,
  chapterStats,
  totalDistanceKm,
  totalDurationText,
  totalStats,
  computeCompleteness,
} = require('../../pages/publish/utils/publish/publish-stats.js');

test('haversineKm:同点为 0;1°纬差 ≈ 111.19km', () => {
  assert.equal(haversineKm(31.23, 121.47, 31.23, 121.47), 0);
  const d = haversineKm(31.0, 121.0, 32.0, 121.0);
  assert.ok(Math.abs(d - 111.19) < 0.1, `1°纬差应≈111.19km,实得 ${d}`);
});

test('chapterStats:空/无 nodes 走保底(无 durationDisplay)', () => {
  assert.deepEqual(chapterStats(null), { duration: 0, locationCount: 0, templateCount: 0 });
  assert.deepEqual(chapterStats({}), { duration: 0, locationCount: 0, templateCount: 0 });
});

test('chapterStats:累加时长/站点/模板数 + 时长显示格式', () => {
  const s = chapterStats({ nodes: [
    { nodeTime: '30', templateId: 5 },
    { nodeTime: '90', templateId: 0 },
    { nodeTime: 'x', templateId: 3 },
  ] });
  assert.equal(s.duration, 120);          // 30+90,'x' 被 isNaN 排除
  assert.equal(s.durationDisplay, '2h,0min');
  assert.equal(s.locationCount, 3);
  assert.equal(s.templateCount, 2);       // templateId 5、3 计入,0 不计
  const s2 = chapterStats({ nodes: [{ nodeTime: '45', templateId: 0 }] });
  assert.equal(s2.durationDisplay, '45min'); // <60 分钟无小时前缀
});

test('totalDistanceKm:非法坐标被过滤;<2 合法节点返 0;顺序累加', () => {
  assert.equal(totalDistanceKm([]), 0);
  assert.equal(totalDistanceKm(undefined), 0);
  // 仅 1 个合法节点 → 0
  assert.equal(totalDistanceKm([{ nodes: [{ latitude: '31', longitude: '121' }] }]), 0);
  // 含 0/空坐标被排除,剩 2 合法点才计
  const d = totalDistanceKm([{ nodes: [
    { latitude: '0', longitude: '0' },
    { latitude: '31.0', longitude: '121.0' },
    { latitude: '', longitude: '' },
    { latitude: '32.0', longitude: '121.0' },
  ] }]);
  assert.ok(Math.abs(d - 111.19) < 0.1, `两合法点应≈111.19km,实得 ${d}`);
});

test('totalDurationText:跨章节累加 + "Xh,Ymin" 格式;undefined 安全', () => {
  assert.equal(totalDurationText(undefined), '0h,0min');
  assert.equal(totalDurationText([
    { nodes: [{ nodeTime: 40 }, { nodeTime: 50 }] },
    { nodes: [{ nodeTime: 30 }] },
  ]), '2h,0min'); // 120 分钟
});

test('totalStats:里程格式化 "X.XXkm" + 汇总', () => {
  const s = totalStats([
    { nodes: [{ nodeTime: '60', templateId: 2 }, { nodeTime: '30', templateId: 0 }] },
  ], 3.14159);
  assert.equal(s.totalDuration, 90);
  assert.equal(s.totalDurationDisplay, '1h,30min');
  assert.equal(s.totalNodes, 2);
  assert.equal(s.totalTemplates, 1);
  assert.equal(s.totalDistance, '3.14km'); // toFixed(2)+km
});

test('computeCompleteness:空表单 → 低完成度 + missing 列全项', () => {
  const r = computeCompleteness({}, {});
  assert.equal(r.percent < 20, true);
  assert.ok(r.missing.includes('主题名称'));
  assert.ok(r.missing.includes('尚未添加站点'));
});

// CU-C-159:发布前缺项在「发布确认」层里显示,同页编辑器与「自动检查已通过」清单
// 都称主题;缺项再叫「路线 ×」就是同一个对象跨两屏换名字。
test('CU-C-159 发布缺项称主题不称路线', () => {
  const r = computeCompleteness({}, {});
  assert.ok(r.missing.includes('主题封面'));
  assert.ok(r.missing.includes('主题类别'));
  assert.equal(r.missing.filter((item) => item.includes('路线')).length, 0,
    `缺项里不应出现"路线": ${r.missing.join(' / ')}`);
});

test('computeCompleteness:满足全部路线级+节点级 → 100%、missing 空', () => {
  const fd = {
    name: '外滩夜行', imgUrl: 'x.png', startDate: '2026-07-10', endDate: '2026-07-11',
    chapters: [{ nodes: [
      { longitude: '121.1', latitude: '31.1', address: '外滩', description: '起点', nodeTime: 30 },
      { longitude: '121.2', latitude: '31.2', address: '南京路', description: '终点', nodeTime: 40 },
    ] }],
  };
  const ctx = { startDateTime: '2026-07-10 20:00', endDateTime: '2026-07-11 22:00', selectedCategoryIds: [1] };
  const r = computeCompleteness(fd, ctx);
  assert.equal(r.percent, 100);
  assert.deepEqual(r.missing, []);
});

test('computeCompleteness:占位哨兵时间视为未填', () => {
  const fd = { name: 'x', imgUrl: 'y', startDate: '2026-07-10', chapters: [] };
  const r = computeCompleteness(fd, { startDateTime: '开始时间', selectedCategoryIds: [] });
  assert.ok(r.missing.includes('开始时间'), '哨兵"开始时间"应判未填');
});
