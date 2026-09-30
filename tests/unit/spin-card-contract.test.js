'use strict';

/* 立体藏品卡(cy-spin-card)· Phase 0 契约
 *
 * 全局门禁已经钉住了「不许新增 @keyframes」「组件 wxss 不许 tag 选择器」这类
 * 全仓事实。这一份只管这件组件**自己**的四条命门:
 *   1. 传感器启停必须成对 —— 不停就是后台一直耗电,而且只有真机跑一段才发现;
 *   2. 一帧只 setData 一个字段 —— 拆成九个字段一帧就是九次 setData,30fps 直接掉帧;
 *   3. 姿态变量只喂 transform / opacity —— 喂进布局属性就是每帧 layout+paint;
 *   4. 一律 fail-open —— 铸卡是通关之后的事,这张卡没有任何一条路能把人挡住。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const COMPONENT_PATH = path.join(ROOT, 'components/cy/spin-card/index.js');
const WXSS = fs.readFileSync(path.join(ROOT, 'components/cy/spin-card/index.wxss'), 'utf8');
const WXML = fs.readFileSync(path.join(ROOT, 'components/cy/spin-card/index.wxml'), 'utf8');

/** 载入组件源码(可传变异后的源码),返回一个能直接驱动的方法包。
 *  ★ 扫描逻辑喂内存,测试绝不写仓库文件。 */
function load(source) {
  const calls = [];
  const patches = [];
  const flags = { startFails: false };
  let definition = null;
  let listener = null;

  global.Behavior = (options) => options;
  global.Component = (config) => { definition = config; };
  global.wx = {
    startAccelerometer(options) {
      calls.push('start');
      if (flags.startFails && options && options.fail) options.fail({ errMsg: 'no sensor' });
    },
    stopAccelerometer() { calls.push('stop'); },
    onAccelerometerChange(cb) { calls.push('on'); listener = cb; },
    offAccelerometerChange() { calls.push('off'); listener = null; },
  };

  delete require.cache[require.resolve(COMPONENT_PATH)];
  if (source) {
    const m = new Module(COMPONENT_PATH, null);
    m.filename = COMPONENT_PATH;
    m.paths = Module._nodeModulePaths(path.dirname(COMPONENT_PATH));
    m._compile(source, COMPONENT_PATH);
  } else {
    require(COMPONENT_PATH);
  }
  assert.ok(definition, 'spin-card 必须注册 Component');

  const vm = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    properties: { frames: [], title: '', caption: '', cardStyle: 'foil', tilt: true },
  });
  vm.setData = function setData(patch) {
    patches.push(patch);
    Object.assign(this.data, patch);
  };
  vm.definition = definition;
  vm.calls = calls;
  vm.patches = patches;
  vm.emit = (sample) => { if (listener) listener(sample); };
  vm.listening = () => Boolean(listener);
  vm.failSensor = () => { flags.startFails = true; };
  return vm;
}

const sourceOf = () => fs.readFileSync(COMPONENT_PATH, 'utf8');

/** 注释里的 @keyframes / transition 是说明不是声明 —— 抹掉但保留换行,行号不受影响。
 *  和 motion-property-ratchet.test.js 里那份 stripComments 同一个口径。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

test('传感器启停成对:on 在 start 之前挂,off 在 stop 之后摘', () => {
  const vm = load();
  vm.data.count = 1;
  vm._startTilt();
  assert.deepEqual(vm.calls, ['on', 'start']);
  assert.ok(vm.listening(), '回调必须挂上');
  vm._stopTilt();
  assert.deepEqual(vm.calls, ['on', 'start', 'stop', 'off']);
  assert.ok(!vm.listening(), 'off 之后回调必须被摘掉');
});

test('负控:摘掉 offAccelerometerChange 那一行,上一条必须真红', () => {
  const mutated = sourceOf().replace(/wx\.offAccelerometerChange && [^\n]*\n/, '\n');
  assert.notEqual(mutated, sourceOf(), '变异没打上 = 这把尺子是橡皮图章');
  const vm = load(mutated);
  vm.data.count = 1;
  vm._startTilt();
  vm._stopTilt();
  assert.ok(!vm.calls.includes('off'), '变异后确实不再解绑 —— 所以成对断言会红');
});

test('detached / 切后台都必须停,回到前台要能自己接上', () => {
  const { lifetimes, pageLifetimes } = load().definition;
  assert.match(String(lifetimes.detached), /_stopTilt/, '离开页面必须停表');
  assert.match(String(pageLifetimes.hide), /_stopTilt/, '切后台必须停表 —— 人走了表还在跑,是最难查的那类耗电');
  assert.match(String(pageLifetimes.show), /_resyncTilt/, '回前台要重开,否则卡从此不动');
});

test('减弱动效 / tilt=false / 一张帧都没有:三种情况都不许碰传感器', () => {
  const cases = [
    { tilt: false, reducedMotion: false, count: 1 },
    { tilt: true, reducedMotion: true, count: 1 },
    { tilt: true, reducedMotion: false, count: 0 },
  ];
  cases.forEach((setup) => {
    const vm = load();
    vm.properties.tilt = setup.tilt;
    vm.data.reducedMotion = setup.reducedMotion;
    vm.data.count = setup.count;
    vm._resyncTilt();
    assert.deepEqual(vm.calls, [],
      `tilt=${setup.tilt} reduced=${setup.reducedMotion} count=${setup.count} 时不该开表`);
  });
});

test('转台态(多帧)不开传感器:拖着转和跟着倾斜两种交互会打架,倾斜只留给照片卡', () => {
  const vm = load();
  const late = load();
  try {
    vm.data.count = 24;
    vm._resyncTilt();
    assert.deepEqual(vm.calls, [], '24 帧的转台卡不该碰加速度计');

    // 帧后到也一样:生成中 → READY,帧从 1 张换成 24 张时,已开的表必须停掉
    late.definition.observers.frames.call(late, ['/upload/window.jpg']);
    assert.deepEqual(late.calls, ['on', 'start'], '照片卡照常倾斜');
    late.definition.observers.frames.call(late, Array.from({ length: 24 }, (_, i) => '/f/' + i + '.webp'));
    assert.deepEqual(late.calls, ['on', 'start', 'stop', 'off'], '升级成转台时要把表停掉');
  } finally {
    vm._stopTilt();     // 红的时候表是开着的:不收尾,node --test 会挂在定时器上而不是报失败
    late._stopTilt();
  }
});

test('一帧只 setData 一个字段:整段姿态拼成一串 CSS 自定义属性一次交出去', () => {
  const vm = load();
  vm.data.count = 1;
  vm._startTilt();
  vm.emit({ x: 0.3, y: -0.2 });                // 校准帧:定零点,不出力
  vm.emit({ x: 0.45, y: -0.2 });
  vm._render();
  const frames = vm.patches.filter((p) => Object.prototype.hasOwnProperty.call(p, 'pose'));
  assert.equal(frames.length, 1, '一次姿态只该发一次 setData');
  assert.deepEqual(Object.keys(frames[0]), ['pose'], '那一包只许有 pose 一个字段');
  vm._stopTilt();
});

test('手机不动时不重复刷同一串值', () => {
  const vm = load();
  vm.data.count = 1;
  vm._startTilt();
  vm.emit({ x: 0.3, y: -0.2 });                // 校准帧
  vm.emit({ x: 0.45, y: -0.2 });               // 先真的出一帧,否则这条断言是空转
  vm._render();
  const before = vm.patches.length;
  vm._render();
  vm._render();
  assert.equal(vm.patches.length, before, '姿态没变就不该再 setData');
  vm._stopTilt();
});

test('零点校准:人举着手机不是水平,卡不该一上来就歪', () => {
  const vm = load();
  vm.data.count = 1;
  vm._startTilt();
  vm.emit({ x: 0.5, y: 0.5 });                 // 开局那一刻的姿势 = 「正对」
  vm._render();
  assert.equal(vm.data.pose, '', '校准那一帧只记姿势,不出力');
  vm.emit({ x: 0.5, y: 0.5 });                 // 姿势没变
  vm._render();
  assert.match(vm.data.pose, /--ry:0\.00deg/, '相对零点没动,卡就该正对');
  vm.emit({ x: 0.7, y: 0.5 });                 // 只按相对偏移算
  vm._render();
  assert.doesNotMatch(vm.data.pose, /--ry:0\.00deg/, '相对偏移才给力');
  vm._stopTilt();
});

test('姿态有界:再猛的倾斜也翻不成一圈,高光不会亮过 1', () => {
  const vm = load();
  const pose = vm._buildPose({ dx: 9, dy: -9 });   // clamp 之前的极端输入
  const ry = Number((pose.match(/--ry:(-?[\d.]+)deg/) || [])[1]);
  const rx = Number((pose.match(/--rx:(-?[\d.]+)deg/) || [])[1]);
  const fo = Number((pose.match(/--fo:([\d.]+)/) || [])[1]);
  assert.ok(Math.abs(ry) <= 11, '绕竖轴必须夹在 ±11° 内,实际 ' + ry);
  assert.ok(Math.abs(rx) <= 11, '绕横轴必须夹在 ±11° 内,实际 ' + rx);
  assert.ok(fo >= 0 && fo <= 1, '高光不透明度必须在 0~1,实际 ' + fo);
});

test('姿态变量只许喂 transform 与 opacity', () => {
  const offenders = [];
  const used = new Set();
  // (?![\w-]) 而不是 \b:姿态变量与 --cy-color-* 这类设计 token 同为 -- 开头,
  // 而 \b 在 '-' 前也算边界,用 \b 会把整页 token 误判成违规。
  stripComments(WXSS).split('\n').forEach((line) => {
    const hits = line.match(/var\(--(?:rx|ry|px|py|fx|fy|fo)(?![\w-])/g) || [];
    hits.forEach((h) => used.add(h.slice(6)));
    if (!hits.length) return;
    const decl = line.trim();
    if (!/^(transform|opacity)\s*:/.test(decl)) offenders.push(decl);
  });
  assert.equal(used.size, 7,
    '七个姿态变量只扫到 ' + used.size + ' 个 —— 少到这个数,说明下面那条断言在空转');
  assert.deepEqual(offenders, [],
    '姿态变量进了布局属性就是每帧 layout+paint,30fps 必掉帧:\n  ' + offenders.join('\n  '));
});

test('这件组件自己不许有一组 @keyframes:高光是持续跟随姿态的状态,不是播一次的动画', () => {
  // 抹注释再判,和动效棘轮自己数 keyframes 的口径一致 —— 文件头那段说明里就写着
  // 「没有一组 @keyframes」,拿原文当声明判红是本仓另一条门禁点名过的误报老坑。
  assert.doesNotMatch(stripComments(WXSS), /@keyframes\s+[A-Za-z_]/,
    '动效棘轮只减不增(motion-property-ratchet),而姿态是 JS 每帧喂进来的,连 transition 都不该有');
  assert.doesNotMatch(stripComments(WXSS), /transition\s*:/,
    '姿态每帧都被重写,加 transition 等于让 CSS 去追一个一直在动的目标');
});

test('图挂了退成占位卡:不白屏、不报错、名字还在', () => {
  const vm = load();
  vm.data.count = 1;
  vm.data.src = '/images/nope.png';
  vm.onImageError();
  assert.equal(vm.data.broken, true);
  assert.match(WXML, /class="sc__ph" wx:if="\{\{broken\}\}"/, '占位块必须挂在 broken 上');
  assert.match(WXML, /\{\{title \|\| '这张卡'\}\}/, '占位卡要还留着名字');
});

test('startAccelerometer 失败:静默退回静态卡,并且把表停干净', () => {
  const vm = load();
  vm.failSensor();
  vm.data.count = 1;
  assert.doesNotThrow(() => vm._startTilt());
  assert.ok(vm.calls.includes('stop'), '同步回来的 fail 也必须走完关停');
  assert.equal(vm.data.tracking, false, '对外表现就是「这是一张静态卡」');
  assert.ok(!vm._tick, 'fail 之后不该留下一只在跑的表');
});

test('转台留缝:单帧时拖动不换帧,多帧才走帧', () => {
  const vm = load();
  vm.data.count = 1;
  vm._spinBase = 0;
  assert.equal(vm._frameFromDrag(400), null, '一张照片不该给出「拖一拖」的假引导');
  assert.match(WXML, /wx:if="\{\{count > 1\}\}"/, '提示语必须跟着 count 走');

  // 定稿规格(施工文档 §2.3):24 帧、30px 走一帧,720px 正好转一圈(约两次滑动)
  vm.data.count = 24;
  vm.data.ready = true;
  vm._spinBase = 0;
  assert.equal(vm._frameFromDrag(0), 0);
  assert.equal(vm._frameFromDrag(90), 3, '30px 一帧:拖 90px 走 3 帧');
  assert.equal(vm._frameFromDrag(-30), 23, '往回拖要从 0 绕到最后一帧,不是卡住');
  assert.equal(vm._frameFromDrag(720), 0, '拖满 720px 正好转回起点');
});

const FRAMES_24 = Array.from({ length: 24 }, (_, i) => '/f/' + String(i).padStart(2, '0') + '.webp');
const loadEvt = (src) => ({ currentTarget: { dataset: { src } } });
const touch = (x) => ({ touches: [{ clientX: x }] });

test('预载:24 帧全部加载结束之前拖不动,停在第 0 帧;全部结束后才能转', () => {
  const vm = load();
  vm.properties.frames = FRAMES_24;   // 真实组件里属性先于观察者就位
  vm.definition.observers.frames.call(vm, FRAMES_24);
  assert.equal(vm.data.ready, false, '帧刚到,还没预载完');
  assert.deepEqual(vm.data.preload, FRAMES_24, '隐藏的预载图要把 24 帧全挂上');
  assert.equal(vm.data.src, FRAMES_24[0], '预载期间显示第 0 帧');

  vm.onSpinTouchStart(touch(0));
  vm.onSpinTouchMove(touch(90));
  assert.equal(vm.data.src, FRAMES_24[0], '没预载完就能拖 = 一路闪白');

  FRAMES_24.forEach((src) => vm.onPreload(loadEvt(src)));
  assert.equal(vm.data.ready, true, '24 帧都结束了就该放行');
  assert.deepEqual(vm.data.preload, [], '放行后隐藏图可以撤掉');

  vm.onSpinTouchStart(touch(0));
  vm.onSpinTouchMove(touch(90));
  assert.equal(vm.data.src, FRAMES_24[3], '预载完 30px 一帧,拖 90px 到第 3 帧');
});

test('预载计数只认当前这批帧:重复、过期的事件不算数,单帧不用等', () => {
  const vm = load();
  vm.properties.frames = FRAMES_24;
  vm.definition.observers.frames.call(vm, FRAMES_24);
  for (let i = 0; i < 30; i++) vm.onPreload(loadEvt(FRAMES_24[0]));   // 同一帧回了 30 次
  vm.onPreload(loadEvt('/old/stale.webp'));                            // 上一批帧迟到的事件
  assert.equal(vm.data.ready, false, '同一帧回再多次也只算一帧,过期的事件不算');

  // 预载到一半换成另一批帧(比如又一次回包):计数要按新的一批重来
  const next = FRAMES_24.map((f) => f.replace('/f/', '/g/'));
  FRAMES_24.slice(0, 12).forEach((src) => vm.onPreload(loadEvt(src)));
  vm.properties.frames = next;
  vm.definition.observers.frames.call(vm, next);
  FRAMES_24.slice(12).forEach((src) => vm.onPreload(loadEvt(src)));   // 旧那批的后半截
  assert.equal(vm.data.ready, false, '旧那批凑齐了也不能替新的一批放行');
  next.forEach((src) => vm.onPreload(loadEvt(src)));
  assert.equal(vm.data.ready, true);

  const single = load();
  single.definition.observers.frames.call(single, ['/upload/window.jpg']);
  assert.equal(single.data.ready, true, '照片卡只有一张,不用等');
  assert.deepEqual(single.data.preload, [], '单帧不挂隐藏图');
  single._stopTilt();
});

test('预载接线:隐藏图逐帧挂上、load 与 error 都回报,藏法不能是 display:none', () => {
  const wxml = WXML.replace(/<!--[\s\S]*?-->/g, '');
  const img = (wxml.match(/<image[^>]*wx:for="\{\{preload\}\}"[^>]*\/>/) || [''])[0];
  assert.ok(img, '没有按 preload 逐帧挂的隐藏图 —— 预载根本没发生,ready 永远到不了');
  assert.match(img, /data-src="\{\{item\}\}"/, 'onPreload 靠 data-src 认是哪一帧');
  assert.match(img, /bindload="onPreload"/);
  assert.match(img, /binderror="onPreload"/, '失败也得回报,否则一帧挂了整张卡永远拖不动');
  assert.match(img, /aria-hidden="true"/, '预载图是给机器看的,读屏不该念 24 遍');

  const cls = (img.match(/class="([^"]+)"/) || [])[1];
  assert.ok(cls, '隐藏图要有 class,藏法写在 WXSS 里');
  const box = (stripComments(WXSS).match(new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  assert.ok(box, 'WXSS 里没有 .' + cls + ' 的藏法');
  assert.doesNotMatch(box, /display\s*:\s*none/, 'display:none 的图可能根本不去加载,预载就成了空转');
  assert.match(box, /opacity\s*:\s*0/, '要看不见,但得真的去加载');

  const hint = (wxml.match(/<view class="sc__hint"[\s\S]*?<\/view>/) || [''])[0];
  assert.match(hint, /ready/, '预载期间提示语要跟着变,不能在拖不动的时候喊「拖动转一圈」');
});

test('属性契约:五个属性一个都不能少,抠图(cutout)已作废不许回来', () => {
  const props = Object.keys(load().definition.properties);
  assert.deepEqual(props.slice().sort(), ['caption', 'cardStyle', 'frames', 'tilt', 'title']);
});

test('负控:姿态串里不再有抠图视差那两个变量(--cx / --cy)', () => {
  const pose = load()._buildPose({ dx: 0.5, dy: -0.5 });
  assert.ok(/--px:/.test(pose), '姿态串形状变了,这条断言就是恒真的:' + pose);
  assert.ok(!/--c[xy]:/.test(pose), '抠图层已删,这两个变量没人读,每帧白拼:' + pose);
});

/* 2026-09-22 模拟器实测踩到的:先挂载、帧后到,这张卡就永远不动。
   实验室页恰好躲过(photos 与 bigFrames 在同一个 setData 里),
   Phase 2 的 playkit 卡不是 —— 服务端回包晚于组件挂载是常态。 */
test('帧晚于挂载到达时必须重判一次开表', () => {
  const vm = load();
  const observer = vm.definition.observers.frames;
  assert.equal(typeof observer, 'function', 'frames 观察者要在');
  vm.data.count = 0;                       // 挂载那一刻还没有帧
  observer.call(vm, ['/upload/window.jpg']);   // 帧后到
  assert.deepEqual(vm.calls, ['on', 'start'], '帧到位之后必须把传感器接上,不能留永远不动的卡');
  vm._stopTilt();   // 表真开起来了(这就是结论),不收尾 node --test 会挂在定时器上
});

test('负控:抹掉观察者里那句重判,上一条必须真红', () => {
  const mutated = sourceOf().replace('      this._resyncTilt();\n    },\n    \'tilt, reducedMotion\'', '    },\n    \'tilt, reducedMotion\'');
  assert.notEqual(mutated, sourceOf(), '变异没打上 = 这把尺子是橡皮图章');
  const vm = load(mutated);
  vm.data.count = 0;
  vm.definition.observers.frames.call(vm, ['/upload/window.jpg']);
  assert.deepEqual(vm.calls, [], '抹掉之后帧后到就不开表 —— 正是上一条要抓的 bug');
});
