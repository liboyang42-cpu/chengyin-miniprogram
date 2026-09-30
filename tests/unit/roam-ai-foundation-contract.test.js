const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pageJs = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.js'), 'utf8');
const pageWxml = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxml'), 'utf8');
const analytics = fs.readFileSync(path.resolve(__dirname, '../../utils/analytics.js'), 'utf8');

test('路线故事、地点意义与足迹边缘都有独立受控渲染位', () => {
  assert.match(pageWxml, /finish\.routeStory/);
  assert.match(pageWxml, /paceCard\.meaning/);
  assert.match(pageWxml, /=== 'footprintHint'\}\}/);
  assert.match(pageWxml, /\{\{footprintHint\.text\}\}/);
});

test('真实非商户 POI 不再把原 description 当作地点意义直出', () => {
  assert.match(pageJs, /desc:\s*n\.type === 2 \? \(n\.description \|\| ''\) : ''/);
  assert.match(pageJs, /\/api\/roam\/poi\/discover/);
});

test('足迹提示和通用提示互斥，且全局开关关闭时静默', () => {
  // 互斥不再靠每张卡手抄否定链(那种写法漏一处就重叠,且改一张卡要改六处),
  // 改由 hud-slots.wxs 的 PROMPT_SLOT 优先级表统一裁决 —— 这里断言那张表的顺序。
  const slots = fs.readFileSync(path.resolve(__dirname, '../../utils/wxs/hud-slots.wxs'), 'utf8');
  const order = slots.match(/var PROMPT_SLOT = \[([^\]]+)\]/);
  assert.ok(order, '找不到 PROMPT_SLOT 优先级表');
  const names = order[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  ['visit', 'eventOverlay', 'nearbyBanner', 'paceCard'].forEach((higher) => {
    assert.ok(names.indexOf(higher) >= 0 && names.indexOf(higher) < names.indexOf('footprintHint'),
      higher + ' 必须排在足迹提示之前');
  });
  assert.ok(names.indexOf('footprintHint') < names.indexOf('roamPrompt'), '足迹提示优先于通用提示');
  // 全屏遮罩(勋章/发现奖励)在场时,最低两档静默
  assert.match(slots, /var modal = \(!!medal && medal\.show\) \|\| \(!!discoverReward && discoverReward\.show\)/);
  assert.match(slots, /footprintHint: !modal &&/);
  assert.match(slots, /roamPrompt: !modal &&/);
  assert.match(pageJs, /roamNpcEvent === true/);
});

test('商家二选一卡出现时会清掉旧足迹提示，关闭奖励后不会抢回注意力', () => {
  assert.match(pageJs, /_clearFootprintHintForPriority\(\)/);
  assert.match(pageJs, /if \(wasFirst && poi && poi\.cat === 'merchant'\) \{[\s\S]{0,180}_clearFootprintHintForPriority\(\)/);
});

test('新表面埋点只记录展示或关闭，白名单不接收原文或位置', () => {
  ['roam_route_story_shown', 'roam_poi_meaning_shown', 'roam_footprint_hint_shown', 'roam_footprint_hint_dismissed']
    .forEach((eventName) => assert.match(analytics, new RegExp(eventName)));

  const analyticsCall = (eventName) => {
    const start = pageJs.indexOf(`analytics.track('${eventName}'`);
    assert.notStrictEqual(start, -1, `${eventName} 应在页面中上报`);
    return pageJs.slice(start, start + 260);
  };

  [
    'roam_route_story_shown',
    'roam_poi_meaning_shown',
    'roam_footprint_hint_shown',
    'roam_footprint_hint_dismissed',
  ].forEach((eventName) => {
    const call = analyticsCall(eventName);
    assert.match(call, new RegExp(`analytics\\.track\\('${eventName}', \\{ bizType: 'roam' \\}\\)`));
    assert.doesNotMatch(
      call,
      /(?:text|content|latitude|longitude|location)\s*:/,
      `${eventName} 不得上传原文或位置`,
    );
    assert.doesNotMatch(call, /(?:properties|bizId)\s*:/, `${eventName} 只记录表面发生，不关联业务对象`);
  });
});
