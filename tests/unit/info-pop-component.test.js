const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const COMPONENT_PATH = require.resolve('../../pages/merchant/components/cy/info-pop/index.js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadDefinition() {
  const prev = global.Component;
  let def;
  global.Component = (options) => { def = options; };
  delete require.cache[COMPONENT_PATH];
  require(COMPONENT_PATH);
  global.Component = prev;
  return def;
}

function create(properties) {
  const def = loadDefinition();
  const instance = {
    properties: Object.assign({}, properties),
    data: Object.assign(JSON.parse(JSON.stringify(def.data)), properties),
    events: [],
    setData(update) { Object.assign(this.data, update); },
    triggerEvent(name, detail) { this.events.push({ name, detail }); },
  };
  Object.assign(instance, def.methods);
  instance._def = def;
  return instance;
}

test('开关自持:onOpen 打开并发 open,onClose 关闭并发 close', () => {
  const c = create({});
  assert.equal(c.data._open, false, '默认是收起的');
  c.onOpen();
  assert.equal(c.data._open, true);
  c.onClose();
  assert.equal(c.data._open, false);
  assert.deepEqual(c.events.map((e) => e.name), ['open', 'close']);
});

// 重复触发要幂等 —— ⓘ 的热区被撑到 88rpx,手指容易连点两下;
// 若每次都无脑 triggerEvent,监听方会收到两次 open 而只有一次 close。
test('重复 onOpen / onClose 幂等,不重复发事件', () => {
  const c = create({});
  c.onOpen(); c.onOpen(); c.onOpen();
  assert.equal(c.events.filter((e) => e.name === 'open').length, 1);
  c.onClose(); c.onClose();
  assert.equal(c.events.filter((e) => e.name === 'close').length, 1);
});

test('无障碍标签:默认「查看说明」,有 title 时带上 title 以便一屏多个 ⓘ 能区分', () => {
  const def = loadDefinition();
  const ob = def.observers['ariaLabel, title'];

  const a = create({}); ob.call(a, '', '');
  assert.equal(a.data._a11y, '查看说明');

  const b = create({}); ob.call(b, '', '结算范围');
  assert.equal(b.data._a11y, '结算范围 · 查看说明');

  const c = create({}); ob.call(c, '自定义读法', '结算范围');
  assert.equal(c.data._a11y, '自定义读法', '显式 ariaLabel 优先');
});

test('variant 默认 modal;只有显式 sheet 才走半屏', () => {
  const def = loadDefinition();
  assert.equal(def.properties.variant.value, 'modal');
  const wxml = read('pages/merchant/components/cy/info-pop/index.wxml');
  // 模板按 !== 'sheet' 分流 ⇒ 任何拼错的值都安全回落到 modal,不会两个弹层都不出
  assert.match(wxml, /wx:if="\{\{variant !== 'sheet'\}\}"/);
  assert.match(wxml, /<cy-sheet[\s\S]*?wx:else/);
});

// 这条盯的是 API 一致性:调用方不该因为换 variant 就得改 slot 名。
// ⚠️ 注意它只断言「模板长什么样」,不能证明 slot 真的穿过组件边界渲染出来了 ——
//    slot 富内容那条路尚未在开发者工具里验过(见 index.js 顶部的说明),
//    别把这条测试当成「slot 可用」的证据。
test('两个变体都用默认 slot,调用方不需要为 sheet 换 slot 名', () => {
  const wxml = read('pages/merchant/components/cy/info-pop/index.wxml');
  const slots = wxml.match(/<slot\b[^>]*>/g) || [];
  assert.equal(slots.length, 2, 'modal / sheet 两个互斥分支各一个 slot');
  slots.forEach((s) => {
    assert.doesNotMatch(s, /\bname=/, `不应出现命名 slot(${s})—— 换 variant 就要改 slot 名是坏 API`);
  });
});

test('弹层是只读说明:单键收起,不摆一个会让人以为要做选择的「取消」', () => {
  const wxml = read('pages/merchant/components/cy/info-pop/index.wxml');
  assert.match(wxml, /show-cancel="\{\{false\}\}"/);
  assert.match(wxml, /confirm-text="知道了"/);
  // confirm 与 cancel 都要接回 onClose:遮罩关闭走的是 cancel,漏接就点遮罩关不掉
  assert.match(wxml, /bind:confirm="onClose"/);
  assert.match(wxml, /bind:cancel="onClose"/);
});

test('ⓘ 触控热区撑到 88rpx(DS §3.2 最小可点),不随视觉尺寸缩小而失效', () => {
  const wxss = read('pages/merchant/components/cy/info-pop/index.wxss');
  const rule = wxss.match(/\.ip__trigger::after\s*\{[^}]*\}/s);
  assert.ok(rule, '必须有撑热区的 ::after');
  assert.match(rule[0], /width:\s*88rpx/);
  assert.match(rule[0], /height:\s*88rpx/);
});

// sheet 变体一定要有可聚焦的关闭控件:cy-sheet 的头部(连同那颗 88rpx 无障碍关闭钮)
// 是 wx:if="{{title}}" 才渲染的 —— 不传 title 就只剩「点遮罩」一个出口,
// 键盘/读屏用户没有能聚焦的关闭钮。所以这里兜一个标题。
test('sheet 变体不传 title 也有标题(否则 cy-sheet 不渲染关闭钮)', () => {
  const def = loadDefinition();
  const ob = def.observers['ariaLabel, title'];
  const a = create({}); ob.call(a, '', '');
  assert.equal(a.data._sheetTitle, '说明', '没给 title 要兜底,不能是空串');
  const b = create({}); ob.call(b, '', '结算口径');
  assert.equal(b.data._sheetTitle, '结算口径', '给了就用调用方的');

  const wxml = read('pages/merchant/components/cy/info-pop/index.wxml');
  assert.match(wxml, /<cy-sheet[\s\S]*?title="\{\{_sheetTitle\}\}"/,
    'sheet 必须绑兜底后的 _sheetTitle,直接绑 title 会在没传时丢掉关闭钮');
});

test('负控:sheet 直接绑原始 title,不传 title 时就会退回没有关闭钮的状态', () => {
  const wxml = read('pages/merchant/components/cy/info-pop/index.wxml');
  const mutated = wxml.replace('title="{{_sheetTitle}}"', 'title="{{title}}"');
  assert.notEqual(mutated, wxml, '变异未生效,负控本身是假的');
  assert.throws(
    () => assert.match(mutated, /<cy-sheet[\s\S]*?title="\{\{_sheetTitle\}\}"/),
  );
});

test('组件已声明依赖的三个子组件,漏注册会静默不渲染', () => {
  const json = JSON.parse(read('pages/merchant/components/cy/info-pop/index.json'));
  assert.equal(json.component, true);
  ['cy-icon', 'cy-modal', 'cy-sheet'].forEach((c) => {
    assert.ok(json.usingComponents[c], `info-pop 必须注册 ${c}`);
  });
});
