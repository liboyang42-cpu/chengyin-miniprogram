const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * C1:简易发布页的「路线预设」只许有一个真源 = 后端 ApiPresetController(/api/preset/*)。
 *
 * 历史:简易页曾内置一整套 CLIENT builtins(TEMPLATES / PRESETS 三线城市路线 + 站点),
 * 与后台运营维护的 preset_route / preset_theme_style 两套真源并存。后来页面改成
 * 「一句话 → AI 草稿 → 专业编辑器」,这套内置预设连同吃它的站点手动编辑链(预设选择、
 * 增删站点、地图打点、玩法模板选择、redrawMap)再没有任何 WXML 入口 —— 变成纯死码,
 * 但内置数据还在,两套真源问题也还在。
 *
 * 2026-09-15 清理:删掉内置预设与站点手动编辑链。本测试是回归闸 —— 预设若要回来,
 * 只能从后端读,不许再把内置路线数据塞回小程序。
 */

const ROOT = path.resolve(__dirname, '../..');
const REPO = path.resolve(ROOT, '..');
const PAGE = 'pages/publish/simple/index.js';
const WXML = 'pages/publish/simple/index.wxml';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 内置预设资产与只服务它的站点手动编辑链:出现任何一个都说明死码回潮。
const REMOVED_MARKERS = [
  'PRESETS', 'TEMPLATES',
  'cloneStations', 'applyPreset', 'onPickPreset', 'onPickCustom', 'onPickTemplate',
  'redrawMap', 'newKey',
  'onAddStation', 'onDeleteStation', 'onStationName', 'onFocusStation', 'onMarkerTap',
  'onPickStationLoc',
];

test('简易发布页不再内置路线预设,预设唯一真源在后端 /api/preset', () => {
  const js = read(PAGE);
  for (const marker of REMOVED_MARKERS) {
    assert.doesNotMatch(js, new RegExp(`\\b${marker}\\b`),
      `内置预设/站点手动编辑链的死码不得回潮:${marker}(预设请改读 /api/preset/*)`);
  }
  // 内置路线 demo 数据的特征串:留着任何一条都等于第二套真源还在
  for (const demo of ['深夜探险线', '咖啡漫游线', '解谜剧本线']) {
    assert.ok(!js.includes(demo), `内置预设数据残留:${demo}`);
  }
  const wxml = read(WXML);
  assert.doesNotMatch(wxml, /bind\w+="(onPickPreset|onPickCustom|onPickStationLoc|onMarkerTap|redrawMap)"/,
    '预设/站点手动编辑的绑定不得回潮');

  // 真源仍在后端:以后要接预设,读的是这套只读接口,不是把数据抄回前端。
  const controller = fs.readFileSync(path.join(REPO,
    'chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPresetController.java'), 'utf8');
  assert.match(controller, /@RequestMapping\("\/api\/preset"\)/);
  assert.match(controller, /@GetMapping\("\/route\/list"\)/);
  assert.match(controller, /presetService\.listRoutes\(city\)/);
});

test('简易发布页仍保留「一句话 → AI 草稿 → 专业编辑器」可达链路', () => {
  const js = read(PAGE);
  for (const marker of ['loadAiQuota', 'generateAiPlan', 'confirmAiNodePoi', 'enterAiEditor']) {
    assert.ok(js.includes(marker), `AI 链路被误删:${marker}`);
  }
  const wxml = read(WXML);
  for (const marker of ['bindtap="generateAiPlan"', 'bindtap="confirmAiNodePoi"', 'bindtap="enterAiEditor"']) {
    assert.ok(wxml.includes(marker), `AI 链路绑定被误删:${marker}`);
  }
});
