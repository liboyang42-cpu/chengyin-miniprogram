const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadComponent(rel) {
  const abs = path.join(ROOT, rel);
  const previous = global.Component;
  const previousBehavior = global.Behavior;
  let definition;
  global.Component = (options) => { definition = options; };
  global.Behavior = (options) => options;
  try {
    delete require.cache[require.resolve(abs)];
    require(abs);
  } finally {
    global.Component = previous;
    global.Behavior = previousBehavior;
  }
  assert.ok(definition, `${rel} 必须调用 Component()`);
  return definition;
}

function reducedMotionProperty(definition) {
  if (definition.properties && definition.properties.reducedMotion) {
    return definition.properties.reducedMotion;
  }
  const behavior = (definition.behaviors || []).find((item) => (
    item && item.properties && item.properties.reducedMotion
  ));
  return behavior && behavior.properties.reducedMotion;
}

function assertAutomaticReducedMotion(definition, name) {
  const behavior = (definition.behaviors || []).find((item) => (
    item && item.properties && item.properties.reducedMotion
      && item.methods && typeof item.methods._syncReducedMotionPreference === 'function'
  ));
  assert.ok(behavior, `${name} 必须自动读取系统减少动态效果偏好，不能依赖每个页面手传`);
}

function createInstance(definition, properties = {}) {
  const defaults = {};
  Object.entries(definition.properties || {}).forEach(([key, config]) => {
    defaults[key] = config.value;
  });
  const instance = {
    data: Object.assign({}, JSON.parse(JSON.stringify(definition.data || {})), defaults, properties),
    events: [],
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { this.events.push({ name, detail }); },
  };
  Object.assign(instance, definition.methods || {});
  return instance;
}

test('cy-skeleton 新增五种同构语义骨架，旧四种 type 与默认行为保留', () => {
  const definition = loadComponent('components/cy/skeleton/index.js');
  assert.equal(definition.properties.type.value, 'list');
  assert.equal(definition.properties.count.value, 4);
  assert.equal(reducedMotionProperty(definition).value, false);

  const wxml = read('components/cy/skeleton/index.wxml');
  ['feed-card', 'map-card', 'merchant-metric', 'route-timeline', 'form-section'].forEach((type) => {
    assert.match(wxml, new RegExp(`type === '${type}'`), `${type} 必须有独立同构结构`);
  });
  const mapBranch = /<!-- 地图卡:[\s\S]*?<!-- 商家指标:/.exec(wxml);
  assert.ok(mapBranch);
  assert.match(mapBranch[0], /wx:for="\{\{items\}\}"/,
    'map-card 必须消费 count 生成同构卡片，不能静默只画一张');
  ['amount', 'detail', 'card'].forEach((type) => {
    assert.match(wxml, new RegExp(`type === '${type}'`), `旧 type=${type} 分支不能丢`);
  });
  assert.match(wxml, /<!-- 列表骨架:[\s\S]*?<view wx:else class="sk/,
    '旧 list 仍是最终 fallback，未知 type 的兼容行为不能改变');
  const semanticRoots = Array.from(wxml.matchAll(/<view wx:(?:if|elif|else)\b[^>]*class="sk(?:\s|\{\{)[^"]*"[^>]*>/g), (match) => match[0]);
  // 2026-08-24:并入 master 后 type 分支为 10 种(新增 5 种同构语义 + 旧 4 种 + 兜底 list)。
  // 2026-09-02 帖文 B3:再加 post-card 鱼骨(与 cy-post-card 同构),10 → 11。
  assert.equal(semanticRoots.length, 11, '全部骨架根节点都必须暴露加载状态语义');
  semanticRoots.forEach((root) => {
    assert.match(root, /aria-role="status"/);
    assert.match(root, /aria-live="polite"/);
    assert.match(root, /aria-label="\{\{loadingLabel\}\}"/);
  });

  const wxss = read('components/cy/skeleton/index.wxss');
  assert.match(wxml, /reducedMotion \? 'sk--static' : ''/,
    'reducedMotion 必须落到渲染 class');
  assert.match(wxss, /\.sk--static \.sk-bar\s*\{[^}]*animation:\s*none/s,
    '减少动态效果时必须关闭 shimmer');
  assert.match(wxss, /\.sk--static \.sk-bar\s*\{[^}]*background:\s*var\(--cy-color-skeleton-base\)/s,
    '关闭 shimmer 后仍要保留静态骨架，而不是把占位隐藏');
});

test('cy-state-shell 统一语义、主题、aria 与双动作；没有显式文案时不制造 CTA', () => {
  const definition = loadComponent('components/cy/state-shell/index.js');
  ['kind', 'title', 'sub', 'primary', 'secondary', 'fill', 'size', 'theme', 'aria']
    .forEach((name) => assert.ok(definition.properties[name], `缺少公开属性 ${name}`));
  assert.equal(definition.properties.primary.value, '');
  assert.equal(definition.properties.secondary.value, '');

  const instance = createInstance(definition, {
    kind: 'network',
    title: '',
    sub: '',
    primary: '重试',
    secondary: '返回',
    aria: '',
  });
  definition.observers['kind, title, sub, aria, primary'].call(instance, 'network', '', '', '', '重试');
  assert.equal(instance.data._renderer, 'empty');
  assert.equal(instance.data._emptyKind, 'offline');
  assert.equal(instance.data._title, '网络没连上');
  assert.equal(instance.data._sub, '连接恢复后可继续');
  instance.onPrimary();
  instance.onSecondary();
  assert.deepEqual(instance.events.map((event) => event.name), ['primary', 'secondary']);

  const wxml = read('components/cy/state-shell/index.wxml');
  assert.match(wxml, /retry="\{\{_primary\}\}"/);
  assert.match(wxml, /cta="\{\{_primary\}\}"/);
  assert.equal((wxml.match(/fill="\{\{fill\}\}"/g) || []).length, 2,
    'empty / error 两条内部渲染路径都必须收到 fill');
  assert.match(wxml, /secondary="\{\{secondary\}\}"/,
    'error 分支必须把第二出口交给 cy-error 的冻结 API');
  assert.match(wxml, /wx:if="\{\{_renderer !== 'error' && secondary\}\}"/,
    'empty 分支由状态壳渲染第二出口，error 分支不能重复渲染');
  assert.match(wxml, /aria-role="group"/,
    '状态壳只负责分组，实际播报语义由 cy-empty / cy-error 单独拥有')
  assert.doesNotMatch(wxml.match(/<view class="state-shell[^>]*>/)[0], /aria-label=/,
    '分组容器不能覆盖内部状态组件的完整可读内容')
  assert.equal((wxml.match(/aria="\{\{aria\}\}"/g) || []).length, 2,
    '显式播报文案必须传给真正拥有 live-region 的 empty / error')
  assert.doesNotMatch(wxml, /aria-live=/,
    '状态壳不能与内部状态组件形成嵌套 live-region')
  assert.match(wxml, /state-shell--theme-\{\{theme\}\}/);
});

test('cy-inline-error 区分 network / data，保留单一局部恢复动作', () => {
  const definition = loadComponent('components/cy/inline-error/index.js');
  const resolve = (kind, title = '', sub = '') => {
    const instance = createInstance(definition, { kind, title, sub });
    definition.observers['kind, title, sub, aria'].call(instance, kind, title, sub, '');
    return instance;
  };
  const network = resolve('network');
  assert.equal(network.data._glyph, 'warning');
  assert.equal(network.data._title, '网络没连上');
  assert.equal(network.data._sub, '连接恢复后可继续');
  const data = resolve('data');
  assert.equal(data.data._glyph, 'info');
  assert.equal(data.data._title, '这部分没更新成功');
  assert.equal(data.data._sub, '已有内容仍可查看');

  data.onAction();
  assert.deepEqual(data.events.map((event) => event.name), ['action']);
  const wxml = read('components/cy/inline-error/index.wxml');
  assert.equal((wxml.match(/bindtap="onAction"/g) || []).length, 1,
    '局部失败只能出现一个同权重 CTA');
  assert.match(wxml, /wx:if="\{\{action\}\}"/,
    '动作必须由页面显式传入，不能造一个无人处理的假按钮');
  assert.match(wxml, /aria-role="alert"/,
    '局部错误动态出现时必须被辅助技术播报')
  assert.match(wxml, /aria-live="polite"/)
});

test('cy-progress-status 的步骤在静态画面仍可读，完成 / 当前 / 待处理不会混淆', () => {
  const definition = loadComponent('components/cy/progress-status/index.js');
  const instance = createInstance(definition, {
    density: 'steps',
    steps: ['读取资料', '生成草稿', '检查可发布项'],
    current: 1,
    title: '正在生成活动',
    sub: '可以离开此页，稍后回来查看',
  });
  definition.observers['steps, current, title, sub, aria'].call(
    instance,
    instance.data.steps,
    instance.data.current,
    instance.data.title,
    instance.data.sub,
    '',
  );
  assert.deepEqual(instance.data._steps.map((step) => step.state), ['done', 'current', 'pending']);
  assert.deepEqual(instance.data._steps.map((step) => step.status), ['已完成', '进行中', '待处理']);
  assert.equal(instance.data._progressCopy, '第 2 步，共 3 步');

  const wxml = read('components/cy/progress-status/index.wxml');
  assert.match(wxml, /<cy-icon[^>]*wx:if="\{\{item\.state === 'done'\}\}"[^>]*name="check"/,
    '完成步必须使用现有 check 图标');
  assert.match(wxml, /\{\{item\.status\}\}/,
    '步骤状态不能只靠颜色和动画表达');
  assert.match(wxml, /\{\{_progressCopy\}\}/,
    '进度摘要必须进入可见文本，不能只藏在 aria 属性里');
  const wxss = read('components/cy/progress-status/index.wxss');
  assert.match(wxss, /\.ps__marker--current::after\s*\{[^}]*animation:/s,
    '当前步只允许轻量脉冲');
  assert.match(wxss, /\.ps--reduced-motion \.ps__marker--current::after\s*\{[^}]*animation:\s*none/s,
    'reducedMotion 必须关闭当前步脉冲');
});

test('cy-progress-status compact 不依赖步骤动画；全部完成时产生持久静态回执', () => {
  const definition = loadComponent('components/cy/progress-status/index.js');
  const instance = createInstance(definition, {
    steps: [{ label: '提交资料' }, { title: '完成发布' }],
    current: 2,
    title: '发布完成',
    sub: '内容已进入活动页',
  });
  definition.observers['steps, current, title, sub, aria'].call(
    instance,
    instance.data.steps,
    instance.data.current,
    instance.data.title,
    instance.data.sub,
    '',
  );
  assert.deepEqual(instance.data._steps.map((step) => step.label), ['提交资料', '完成发布']);
  assert.deepEqual(instance.data._steps.map((step) => step.state), ['done', 'done']);
  assert.equal(instance.data._allDone, true);
  assert.equal(instance.data._progressCopy, '全部完成，共 2 步');
  assert.match(read('components/cy/progress-status/index.wxml'), /density !== 'steps'[\s\S]*?wx:else class="ps__expanded"/,
    '只有 steps 密度才展开步骤，compact 保持克制');
});

test('cy-progress-status compact 用无刻度 runner 表达单请求等待，减少动态效果时仍有静态轨迹', () => {
  const wxml = read('components/cy/progress-status/index.wxml');
  const compactBranch = /<!-- compact:[\s\S]*?<!-- steps:/.exec(wxml);
  assert.ok(compactBranch, '必须保留独立的 compact 渲染分支');
  assert.match(compactBranch[0], /wx:if="\{\{!_allDone\}\}" class="ps__trace" aria-hidden="true"[\s\S]*?class="ps__runner"/,
    '进行中才显示装饰性 runner，完成回执不应继续播放');
  assert.match(compactBranch[0], /wx:if="\{\{title\}\}" class="ps__title">\{\{title\}\}<\/view>/,
    '动效不能替代可读标题');
  assert.match(compactBranch[0], /wx:if="\{\{sub\}\}" class="ps__sub">\{\{sub\}\}<\/view>/,
    '动效不能替代可读说明');
  assert.doesNotMatch(compactBranch[0], /wx:for|item\.state|\{\{(?:steps|current)\}\}/,
    '单次 AI 请求不能伪造步骤或确定性进度');

  const wxss = read('components/cy/progress-status/index.wxss');
  const runnerRule = /\.ps__runner\s*\{([^}]*)\}/s.exec(wxss);
  assert.ok(runnerRule, '必须提供 runner 视觉规则');
  assert.match(runnerRule[1], /animation:\s*ps-indeterminate-trace\s+var\(--cy-motion-spinner-cycle\)\s+var\(--cy-ease\)\s+infinite/,
    '无限等待动效必须复用现有 loading 周期和缓动 token');

  const keyframes = /@keyframes ps-indeterminate-trace\s*\{([\s\S]*?)\n\}/.exec(wxss);
  assert.ok(keyframes, '必须提供无刻度 runner 关键帧');
  const animatedProperties = Array.from(keyframes[1].matchAll(/([a-z-]+)\s*:/g), (match) => match[1]);
  assert.deepEqual(Array.from(new Set(animatedProperties)).sort(), ['opacity', 'transform'],
    'runner 只允许动画 transform / opacity，不能触发布局重排');
  assert.match(wxss, /\.ps--compact \.ps__marker--current::after\s*\{[^}]*animation:\s*none/s,
    'compact 只保留 runner 一处动态焦点，状态圆点保持静态');
  assert.match(wxss, /\.ps--reduced-motion \.ps__runner\s*\{[^}]*animation:\s*none[^}]*opacity:[^}]*transform:/s,
    'reducedMotion 必须停止 runner，并保留可见的静态轨迹');
});

test('cy-offline-banner 明示缓存时间、严重度与唯一恢复动作', () => {
  const definition = loadComponent('components/cy/offline-banner/index.js');
  ['message', 'cacheTime', 'action', 'serious']
    .forEach((name) => assert.ok(definition.properties[name], `缺少公开属性 ${name}`));
  assert.equal(reducedMotionProperty(definition).value, false);
  assert.equal(definition.properties.action.value, '');
  const instance = createInstance(definition, {
    message: '当前离线，浏览的是缓存内容',
    cacheTime: '10:30',
    action: '重新连接',
  });
  definition.observers['message, cacheTime, aria'].call(
    instance,
    instance.data.message,
    instance.data.cacheTime,
    '',
  );
  assert.equal(instance.data._cacheCopy, '缓存更新于 10:30');
  instance.onAction();
  assert.deepEqual(instance.events.map((event) => event.name), ['action']);

  const wxml = read('components/cy/offline-banner/index.wxml');
  assert.match(wxml, /offline-banner--serious/);
  assert.match(wxml, /offline-banner--reduced-motion/);
  assert.match(wxml, /aria-label="\{\{aria \|\| message\}\}\{\{!aria && _cacheCopy \? '，' \+ _cacheCopy : ''\}\}"/,
    '离线播报必须直接由可见文案组合，避免维护只进 aria 的影子字段');
  assert.equal((wxml.match(/bindtap="onAction"/g) || []).length, 1);
  assert.match(wxml, /wx:if="\{\{action\}\}"/);
});

test('会播放状态动效的共享组件自动遵循系统减少动态效果偏好', () => {
  [
    ['components/cy/skeleton/index.js', 'cy-skeleton'],
    ['components/cy/offline-banner/index.js', 'cy-offline-banner'],
    ['components/cy/progress-status/index.js', 'cy-progress-status'],
  ].forEach(([source, name]) => assertAutomaticReducedMotion(loadComponent(source), name));
});

test('新增状态组件均注册真实依赖，只复用现有 cy 组件', () => {
  const expected = {
    'state-shell': ['cy-empty', 'cy-error'],
    'inline-error': ['cy-icon'],
    'progress-status': ['cy-icon'],
    'offline-banner': ['cy-icon'],
  };
  Object.entries(expected).forEach(([name, dependencies]) => {
    const json = JSON.parse(read(`components/cy/${name}/index.json`));
    assert.equal(json.component, true);
    dependencies.forEach((dependency) => {
      const target = json.usingComponents && json.usingComponents[dependency];
      assert.ok(target, `${name} 必须注册 ${dependency}`);
      assert.ok(fs.existsSync(path.join(ROOT, `${target.slice(1)}.json`)),
        `${name} 的 ${dependency} 路径必须真实存在`);
    });
  });
});
