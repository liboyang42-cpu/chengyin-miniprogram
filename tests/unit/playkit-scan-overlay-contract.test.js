'use strict';

/* playkit-scan · 显形档(scan.kind=OVERLAY)· AR 契约 §6.2
 *
 * 三条命门:
 *   1. normalizeKind 认得第四个值,认不出的照旧回落「文字」—— 最保守档,不凭空要权限;
 *   2. 相机不是想开就开:只有显形 + 设备支持 + 没错过一次 才渲染 <camera>,
 *      错一次就永久走旁路 —— 反复撞权限墙比没有 AR 难受得多;
 *   3. 显形是视觉增强不是完成条件:同一串码只交一次,交完照常等服务端回包;
 *      图没回来 / 图是空的,这一站都不许被客户端卡住。
 * 另外钉住老三档:fake 取景框和三种回复的分支一个字不许被显形牵连。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const COMPONENT_PATH = path.join(ROOT, 'pages/play/components/playkit-scan/index.js');
const WXML = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit-scan/index.wxml'), 'utf8');
const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js');

const VIEW_AT = new Date(2026, 8, 22, 12, 0);
function scanKit(seg) {
  return pickPlayKit({ sessionId: 1, version: 0, playKit: { scan: seg } }, VIEW_AT);
}

function load(arg) {
  // 一个参数两种用法:传字符串 = 变异后的源码,传对象/空 = 设备条件选项。
  const isSource = typeof arg === 'string';
  const source = isSource ? arg : null;
  const options = isSource ? {} : (arg || {});
  const events = [];
  let definition = null;

  global.Behavior = (o) => o;
  global.Component = (config) => { definition = config; };
  global.wx = {
    canIUse: () => options.cameraSupported !== false,
    scanCode(o) { events.push('scanCode'); if (options.scanCodeResult && o.success) o.success({ result: options.scanCodeResult }); },
    openSetting() { events.push('openSetting'); },
    vibrateShort() {},
    showToast() {},
    getStorageSync: () => '',
  };

  delete require.cache[require.resolve(COMPONENT_PATH)];
  const m = new Module(COMPONENT_PATH, null);
  m.filename = COMPONENT_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(COMPONENT_PATH));
  m._compile(source || sourceOf(), COMPONENT_PATH);
  assert.ok(definition, 'playkit-scan 必须注册 Component');

  const vm = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    properties: {
      title: '', kind: '文字', reply: '', audioUrl: '', imageUrl: '',
      overlayUrl: '', overlayScale: 60,
    },
  });
  vm.setData = (patch) => Object.assign(vm.data, patch);
  vm.triggerEvent = (name, detail) => events.push({ name, detail });
  vm.events = events;
  vm.definition = definition;
  vm.open = (kind) => definition.observers['show, kind, title'].call(vm, true, kind);
  return vm;
}

const sourceOf = () => fs.readFileSync(COMPONENT_PATH, 'utf8');

test('normalizeKind:认得「显形」,认不出的回落「文字」', () => {
  const vm = load();
  assert.equal(vm._normalizeKind('显形'), '显形');
  assert.equal(vm._normalizeKind('文字'), '文字');
  assert.equal(vm._normalizeKind('AR'), '文字', '没注册的值走最保守档,不凭空要相机权限');
  assert.equal(vm._normalizeKind(''), '文字');
});

test('相机只在该开时开:显形+支持才 camLive;别的档永远不占相机', () => {
  ['文字', '语音', '图片'].forEach((kind) => {
    const vm = load();
    vm.open(kind);
    assert.equal(vm.data.camLive, false, kind + ' 档不该起相机');
  });
  const on = load();
  on.open('显形');
  assert.equal(on.data.camLive, true, '设备支持时显形档必须起页内取景');

  const noCam = load({ cameraSupported: false });
  noCam.open('显形');
  assert.equal(noCam.data.camLive, false, '老基础库/无相机设备:camLive 关,走旁路');
});

test('相机 error 一次就永久走旁路,不再反复撞墙', () => {
  const vm = load();
  vm.open('显形');
  assert.equal(vm.data.camLive, true);
  vm.onCamErr();
  assert.equal(vm._camErr, true, '错过一次记在实例字段上 —— setData 里养 wxml 不读的字段是 U4 死数据');
  assert.ok(!('camErr' in vm.data), 'camErr 不许进 data');
  assert.equal(vm.data.camLive, false);
  vm.open('显形');   // 重开这一屏也不回头
  assert.equal(vm.data.camLive, false, '错过一次就安静地用微信扫一扫,别每次都弹权限');
});

test('旁路两键都在:wxml 里有「去设置」和「用微信扫一扫」,点后者走的是生产的 wx.scanCode', () => {
  assert.match(WXML, /bindtap="onOpenCamSetting"/);
  assert.match(WXML, /class="sc__act" bindtap="onScan"/);
  const vm = load();
  vm.onScan();
  assert.ok(vm.events.includes('scanCode'), '旁路必须真的调 wx.scanCode,不是假按钮');
  vm.onOpenCamSetting();
  assert.ok(vm.events.includes('openSetting'));
});

test('页内扫中:同一串码只交一次,交的是 scanned 事件 + { code }', () => {
  const vm = load();
  vm.open('显形');
  vm.onScanCode({ detail: { result: 'CODE-A' } });
  vm.onScanCode({ detail: { result: 'CODE-A' } });   // camera 是逐帧回调的
  const fired = vm.events.filter((e) => e && e.name === 'scanned');
  assert.equal(fired.length, 1, '逐帧回调不许把同一站刷成 N 次提交');
  assert.deepEqual(fired[0].detail, { code: 'CODE-A' }, 'payload 与老三档同形');
});

test('负控:删掉去重那一行,上一条必须真红', () => {
  const mutated = sourceOf().replace(/if \(!code \|\| code === this\._lastCode\) return;/, '');
  assert.notEqual(mutated, sourceOf(), '变异没打上 = 这把尺子是橡皮图章');
  const vm = load(mutated);
  vm.open('显形');
  vm.onScanCode({ detail: { result: 'CODE-A' } });
  vm.onScanCode({ detail: { result: 'CODE-A' } });
  assert.equal(vm.events.filter((e) => e && e.name === 'scanned').length, 2,
    '去掉去重后确实重复上交 —— 所以服务端幂等之外客户端也得挡');
});

test('扫过之后不再交:回包里已经有东西了,再对准也不触发', () => {
  const vm = load();
  vm.open('显形');
  vm.data.overlayUrl = 'https://cdn.chengyinhub.com/o.png';   // 服务端已把显形图发回来
  vm.onScanCode({ detail: { result: 'CODE-B' } });
  vm.onScan({ scanCodeResult: 'CODE-B' });
  assert.equal(vm.events.filter((e) => e && e.name === 'scanned').length, 0);
  assert.ok(!vm.events.includes('scanCode'), '已经扫过了,点旁路也不该再拉扫一扫');
});

test('显形图是空的:不渲染叠加层,但绝不拦提交', () => {
  // 2026-09-22 显形档加了动态 class(显形过程),标签跨行 —— 查语义不查逐字格式:
  //   这个 <image> 标签上必须带 wx:if="{{overlayUrl}}"。
  const overTag = (WXML.match(/<image class="sc__over[^>]*>/) || [''])[0];
  assert.ok(overTag, '叠加层 <image class="sc__over…"> 不在了');
  assert.match(overTag, /wx:if="\{\{overlayUrl\}\}"/,
    '叠加层必须挂在 overlayUrl 上 —— 商家没配就不出');
  const vm = load();
  vm.open('显形');
  assert.equal(vm.properties.overlayUrl, '');
  vm.onScanCode({ detail: { result: 'CODE-C' } });
  assert.equal(vm.events.filter((e) => e && e.name === 'scanned').length, 1,
    '一张图没配 ≠ 这一站不用扫 —— 完成条件只有服务端的 scanned');
});

test('老三档一个字没动:fake 取景框只在非显形时渲染', () => {
  assert.match(WXML, /class="sc__frame [^"]*" wx:if="\{\{kindKey !== '显形'\}\}"/);
  assert.match(WXML, /bindtap="onScan"\s+aria-role="button" aria-label="扫这个点位的码"/);
});

test('占比夹回 20–100,非法值回默认 60', () => {
  const vm = load();
  vm.properties.overlayScale = 500;
  vm.open('显形');
  assert.equal(vm.data.overlayW, '100%');
  vm.properties.overlayScale = 5;
  vm.open('显形');
  assert.equal(vm.data.overlayW, '20%');
  vm.properties.overlayScale = 0;
  vm.open('显形');
  assert.equal(vm.data.overlayW, '60%', '0 / 空 = 没填,按默认而不是夹到 20');
});

test('属性契约:kit 投影的 overlay 两个字段必须都有对应属性', () => {
  const props = load().definition.properties;
  assert.ok(props.overlayUrl && props.overlayUrl.type === String);
  assert.ok(props.overlayScale && props.overlayScale.type === Number);
  assert.equal(props.overlayScale.value, 60, '没配时默认 60,与服务端 playKitRuntime 同值');
});

test('playkit-view 翻译:OVERLAY 认成「显形」并透传两个叠加字段,认不出的照旧回落「文字」', () => {
  const on = scanKit({ kind: 'OVERLAY', scanned: true, overlayUrl: 'https://cdn.chengyinhub.com/o.png', overlayScale: 75 });
  assert.equal(on.type, 'scan');
  assert.equal(on.kind, '显形');
  assert.equal(on.overlayUrl, 'https://cdn.chengyinhub.com/o.png');
  assert.equal(on.overlayScale, 75);

  const bare = scanKit({ kind: 'OVERLAY', scanned: true, overlayUrl: 'https://cdn.chengyinhub.com/o.png' });
  assert.equal(bare.overlayScale, 60, '服务端没给占比时视图层也默认 60 —— 两处口径同一个数');

  const ghost = scanKit({ kind: 'AR', scanned: false });
  assert.equal(ghost.kind, '文字', '枚举外的 kind 不许冒出来撑开相机分支');
  assert.equal(ghost.overlayUrl, '', '没扫过就没有叠加图 —— 与服务端的防泄漏同一条线');
});
