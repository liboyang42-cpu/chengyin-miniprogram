const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { NESTED_FILL } = require('../helpers/nested-fill.js');
const readFile = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const read = readFile;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(source, selector) {
  const match = source.match(new RegExp(escapeRegExp(selector) + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, `缺少 WXSS 规则 ${selector}`);
  return match[1];
}

function cardViolations(source, selectors) {
  const violations = [];
  selectors.forEach((selector) => {
    const body = rule(source, selector);
    if (!/background:\s*var\(--cy-bg-card\)/.test(body)) violations.push(`${selector}:background`);
    if (!/border-radius:\s*var\(--cy-radius-lg\)/.test(body)) violations.push(`${selector}:radius`);
    if (/(?:^|;)\s*border\s*:/.test(body)) violations.push(`${selector}:border`);
  });
  return violations;
}

// 卡片 vs 页底是 UI 边界才用 3:1；卡内行只是内容分组，可感知下限用 1.2:1。
const ROW_SURFACE_CONTRAST_MIN = 1.2;

function declaration(source, selector, property) {
  const body = rule(source, selector);
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}(?:-color)?\\s*:\\s*([^;]+)`));
  assert.ok(match, `${selector} 缺少 ${property} 声明`);
  return match[1].trim();
}

function resolveToken(name, sources, depth = 0) {
  assert.ok(depth < 8, `token ${name} 解析层数过深，可能存在循环引用`);
  for (const source of sources) {
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const match = clean.match(new RegExp(`${escapeRegExp(name)}\\s*:\\s*([^;]+);`));
    if (!match) continue;
    const value = match[1].trim();
    const nested = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    return nested ? resolveToken(nested[1], sources, depth + 1) : value;
  }
  assert.fail(`token ${name} 在商家浅色主题中没有定义`);
}

function parseColor(value) {
  let match = value.match(/^#([\da-f]{6})$/i);
  if (match) {
    return {
      r: parseInt(match[1].slice(0, 2), 16),
      g: parseInt(match[1].slice(2, 4), 16),
      b: parseInt(match[1].slice(4, 6), 16),
      a: 1,
    };
  }
  match = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  assert.ok(match, `无法解析颜色 ${value}`);
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function compositeOver(foreground, background) {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function luminance(color) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function contrastRatio(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function resolvePaint(value, sources) {
  const token = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return parseColor(token ? resolveToken(token[1], sources) : value);
}

function assertRowSurfaceContrast(wxss, selector, sources) {
  const page = parseColor(resolveToken('--cy-color-bg-page', sources));
  const card = compositeOver(parseColor(resolveToken('--cy-bg-card', sources)), page);
  const fill = compositeOver(resolvePaint(declaration(wxss, selector, 'background'), sources), card);
  const ratio = contrastRatio(fill, card);
  assert.ok(
    ratio >= ROW_SURFACE_CONTRAST_MIN,
    `${selector} 行填充与白卡的实际对比度 ${ratio.toFixed(2)}:1，` +
      `低于卡内分组可感知门槛 ${ROW_SURFACE_CONTRAST_MIN}:1`
  );
}


function merchantThemeSources() {
  const tokens = read('style/tokens.wxss');
  const merchantThemeAt = tokens.search(/^page\.theme-light,/m);
  assert.ok(merchantThemeAt >= 0, '找不到 tokens.wxss 的商家浅色主题块');
  return [read('style/merchant-light.wxss'), tokens.slice(merchantThemeAt)];
}

test('G3 商家运营页卡片统一为纯白、无描边、lg 圆角', () => {
  const cases = [
    // 2026-08-09:合作页三格统计条随「我的合作」一起删除，.stats 不复存在。
    // 2026-08-20:合作页 .rel-list 白面板随卡片重设计删除 —— 行本身换成自带卡壳的
    // cy-merchant-card / cy-club-card,外层再包白卡就是双层卡。
    ['pages/merchant/citynode/index.wxss', ['.cn-intro', '.cn-node']],
    ['pages/merchant/citynode/create/index.wxss', ['.cnc-card']],
    ['pages/merchant/ledger/index.wxss', ['.ledger-action', '.settlement-overview', '.rec-list', '.coop-settlement-list']],
    ['pages/merchant/ledger/order-detail/index.wxss', ['.order-detail__hero, .order-detail__section']],
    ['subpackageMember/coupon/coupon.wxss', ['.david_tkb_li']],
  ];

  cases.forEach(([file, selectors]) => {
    assert.deepEqual(cardViolations(read(file), selectors), [], file);
  });
});

test('品牌中心按确认稿使用白色圆角卡片', () => {
  const body = rule(read('pages/merchant/decor/design.wxss'), '.dc-card');
  assert.match(body, /background:\s*var\(--cy-color-bg-surface\)/);
  assert.match(body, /border-radius:\s*38.5rpx/);
  assert.doesNotMatch(body, /(?:^|;)\s*border\s*:/);
});

test('G3 卡片标准负控：描边或小圆角回归时必须判红', () => {
  const source = '.card { background: var(--cy-bg-card); border-radius: var(--cy-radius-sm); border: 1rpx solid #eee; }';
  assert.deepEqual(cardViolations(source, ['.card']), ['.card:radius', '.card:border']);
});

// 2026-08-09 用户裁决:白卡里再嵌一层灰不是灰色的用法，卡内行一律回到白卡本色。
// 「不用横线分层」这一条保留 —— 行与行靠间距分组，既不要横线也不要灰底。
function assertNoNestedFill(overrides = {}) {
  const read = (file) => (file in overrides ? overrides[file] : readFile(file));

  const relationWxml = read('pages/merchant/relation/index.wxml');
  const relationWxss = read('pages/merchant/relation/index.wxss');
  assert.match(relationWxml, /class="rel-item"/);
  assert.doesNotMatch(relationWxml, /<cy-cell(?![^>]*hairline="\{\{false\}\}")/);
  assert.doesNotMatch(rule(relationWxss, '.rel-item'), NESTED_FILL);

  const decor = read('components/cy/cell/index.wxss');
  assert.doesNotMatch(rule(decor, '.cell'), NESTED_FILL);
  assert.match(read('pages/merchant/decor/index.wxml'), /hairline="\{\{false\}\}"/);

  // 2026-08-11:旧「承接商家」页收成兼容壳,页面级的 .pr-row/.pr-group 覆盖随资料一起下线。
  // 共用的 style/pr-settings.wxss 仍被定价/合作方等页消费,所以门禁改盯共用层那一份。
  const prSettings = read('style/pr-settings.wxss');
  assert.doesNotMatch(rule(prSettings, '.pr-row'), /border-(?:top|bottom)\s*:/);
  assert.doesNotMatch(rule(prSettings, '.pr-row'), NESTED_FILL);
  assert.doesNotMatch(prSettings, /\.pr-row\s*\+\s*\.pr-row\s*\{[^}]*border-(?:top|bottom)\s*:/s);

  const ledger = read('pages/merchant/ledger/index.wxss');
  assert.doesNotMatch(rule(ledger, '.rec'), /border-(?:top|bottom)\s*:/);
  assert.doesNotMatch(rule(ledger, '.rec'), NESTED_FILL);
  assert.doesNotMatch(rule(ledger, '.coop-settlement-row'), /border-(?:top|bottom)\s*:/);
  assert.doesNotMatch(rule(ledger, '.coop-settlement-row'), NESTED_FILL);

  const coupon = read('subpackageMember/coupon/coupon.wxss');
  assert.doesNotMatch(rule(coupon, '.david_tkb_li_con_top'), /border-(?:top|bottom)\s*:/);
  assert.doesNotMatch(rule(coupon, '.david_tkb_li_con_ly'), NESTED_FILL);
}

test('G3 卡内既不用横线也不再自带灰底', () => {
  assertNoNestedFill();
});

// 负控必须**真的调用**被测断言并让它红:只拿正则去 match 字面串的写法是假绿 ——
// 把上面那一堆断言整个删掉,那种负控照样绿。
test('negative control:卡内行重新长出灰底或横线必须判红', () => {
  const file = 'style/pr-settings.wxss';
  const withFill = readFile(file).replace(/(\.pr-row\s*\{)/, '$1 background: var(--cy-bg-card-2);');
  assert.throws(() => assertNoNestedFill({ [file]: withFill }), assert.AssertionError,
    '把灰底加回 .pr-row 后,卡内不嵌灰的契约没有判红');

  const withLine = readFile(file).replace(/(\.pr-row\s*\{)/, '$1 border-bottom: 1rpx solid #eee;');
  assert.throws(() => assertNoNestedFill({ [file]: withLine }), assert.AssertionError,
    '给 .pr-row 加回横线后,卡内不用线的契约没有判红');

  // 漏 token 就等于漏门:--cy-bg-subtle 是 coop-terms-summary 用过的那种灰
  const withSubtle = readFile(file).replace(/(\.pr-row\s*\{)/, '$1 background: var(--cy-bg-subtle);');
  assert.throws(() => assertNoNestedFill({ [file]: withSubtle }), assert.AssertionError,
    '--cy-bg-subtle 这个灰 token 不在门禁的识别范围里');
});

test('G3 填充对比度门禁会拒绝不可辨的浅灰，也能接受达标真值', () => {
  const row = '.row { background: var(--row-fill); }';
  const lowContrastTheme = '--cy-color-bg-page:#FFFFFF;--cy-bg-card:#FFFFFF;--row-fill:#EBEBEB;';
  assert.throws(
    () => assertRowSurfaceContrast(row, '.row', [lowContrastTheme]),
    /\.row 行填充与白卡的实际对比度 1\.19:1，低于卡内分组可感知门槛 1\.2:1/,
    '低对比填充没有被 G3 对比度门禁指认为失败'
  );
  const compliantTheme = '--cy-color-bg-page:#FFFFFF;--cy-bg-card:#FFFFFF;--row-fill:#EAEAEA;';
  assert.doesNotThrow(
    () => assertRowSurfaceContrast(row, '.row', [compliantTheme]),
    '达到 1.2:1 的填充被 G3 对比度门禁误拒'
  );
});

test('G3 页面底色贯穿整屏，ledger 空态不能再上灰下白', () => {
  const files = [
    ['pages/merchant/ledger/index.wxss', '.ledger'],
    ['pages/merchant/ledger/order-detail/index.wxss', '.order-detail'],
    ['subpackageMember/coupon/coupon.wxss', '.coupon-page'],
  ];
  files.forEach(([file, selector]) => {
    const source = read(file);
    assert.match(rule(source, 'page'), /background:\s*var\(--cy-bg-page\)/, `${file} 的 page 底色断层`);
    assert.match(rule(source, selector), /background:\s*var\(--cy-bg-page\)/, `${file} 的正文底色断层`);
  });
});

test('G3 纯黑动作与文字：清除近黑字面量，装修错误重载不再继承绿色', () => {
  const files = [
    'pages/merchant/relation/index.wxml', 'pages/merchant/relation/index.wxss',
    'pages/merchant/citynode/index.wxml', 'pages/merchant/citynode/index.wxss',
    'pages/merchant/citynode/create/index.wxml', 'pages/merchant/citynode/create/index.wxss',
    'pages/merchant/decor/index.wxml', 'pages/merchant/decor/index.wxss',
    'pages/merchant/decor/coop-setting/index.wxml',
    'pages/merchant/ledger/index.wxml', 'pages/merchant/ledger/index.wxss',
    'subpackageMember/coupon/coupon.wxml', 'subpackageMember/coupon/coupon.wxss',
  ];
  const source = files.map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(source, /#(?:181818|111111|1A1A1A|33363C)\b/i);

  const decorWxml = read('pages/merchant/decor/index.wxml');
  const decorWxss = read('pages/merchant/decor/index.wxss');
  // 2026-09-02:开关轨道底改用 --cy-comp-switch-on(三域同值),decor 不再需要显式传色。
  // 这里断言的意图没变 —— 「成功态绿只出现在开关上,不得外溢到错误重试按钮」——
  // 只是绿现在由组件统一给,页面不该再自己写死一个 hex。
  assert.doesNotMatch(decorWxml, /<cy-switch\s+color=/, '开关颜色应由 cy-switch 统一给,页面不再传色');
  assert.match(decorWxml, /<cy-switch\s+checked="\{\{m\.businessStatus\s*!=\s*0\}\}"/, '营业状态开关仍应使用共享 cy-switch');
  assert.doesNotMatch(decorWxss, /#12B886|--cy-decor-accent/);
  assert.match(decorWxml, /<cy-btn/);
  assert.match(read('components/cy/btn/index.wxss'), /--cy-comp-btn-primary-bg/);
});

test('G3 控件分型：筛选 chip 为胶囊，主题编辑器整屏只留一个主操作', () => {
  // 2026-08-20:ledger 自绘 .filter-chip 收编进 cy-tabs chip 档(画板04 7:96);
  // 「胶囊 + 选中反色」两条语义改到组件源码上锁,页面只须真的用 chip 档。
  const ledgerWxml = read('pages/merchant/ledger/index.wxml');
  assert.match(ledgerWxml, /<cy-tabs[^>]*variant="chip"[^>]*bind:change="onRedemptionFilter"/,
    '核销筛选必须走 cy-tabs chip 档,不许回退自绘药丸');
  const tabsWxss = read('components/cy/tabs/index.wxss');
  assert.match(rule(tabsWxss, '.cy-tabs--chip .cy-tabs__item'), /border-radius:\s*var\(--cy-radius-pill\)/);
  assert.match(rule(tabsWxss, '.cy-tabs--chip .cy-tabs__item--on'), /background:\s*var\(--cy-color-action-primary-bg\)/);

  const citynodeCreate = read('pages/merchant/citynode/create/index.wxml');
  assert.match(citynodeCreate, /wx:if="\{\{!addressConfirmed\}\}"[\s\S]{0,180}<cy-btn[^>]*variant="primary"[^>]*size="sm"[^>]*bind:tap="confirmProfileAddress"/,
    '店址待确认时允许一枚局部小主操作');
  assert.match(citynodeCreate, /class="cnc-cta"[\s\S]{0,160}<cy-btn[^>]*variant="primary"[^>]*disabled="\{\{!canSubmit && !submittedApplicationId\}\}"/,
    '整页固定主操作仍只属于提交区，前置条件未满足时必须禁用');
  const citynodeCreateJs = read('pages/merchant/citynode/create/index.js');
  assert.match(citynodeCreateJs, /const canSubmit = !!\(this\.data\.tpl[\s\S]{0,100}this\.data\.addressConfirmed\)/,
    '局部店址确认与整页提交必须互斥可用');
  // 2026-08-10:模板表单搬去 pages/publish/temp,本页的次级动作变成「去配置玩法」
  assert.match(citynodeCreate, /variant="secondary"[^>]*bind:tap="goConfigTemplate"/);
});

test('G3 错误态都有原因与重试，优惠券区分 loading/error/empty', () => {
  const relation = read('pages/merchant/relation/index.wxml');
  const citynode = read('pages/merchant/citynode/index.wxml');
  const decor = read('pages/merchant/decor/index.wxml');
  const ledger = read('pages/merchant/ledger/index.wxml');
  const coupon = read('subpackageMember/coupon/coupon.wxml');
  // 2026-09-16 去闸:合作页整页错误改成页内 cy-inline-error,规则不变 —— 原因 + 重试都要在屏上。
  const relationInline = relation.match(/<cy-inline-error\b[^>]*\/>/g) || [];
  assert.ok(relationInline.length > 0, '合作页缺少 cy-inline-error');
  relationInline.forEach((tag) => {
    assert.match(tag, /\bsub="[^"]+"/);
    assert.match(tag, /\baction="[^"]+"/);
    assert.match(tag, /\bbind:action="[^"]+"/);
  });
  [citynode, decor, ledger, coupon].forEach((source) => {
    const errors = source.match(/<cy-error\b[^>]*\/>/g) || [];
    assert.ok(errors.length > 0, '页面缺少 cy-error');
    errors.forEach((tag) => {
      // 2026-09-15 弹窗合同:无权限终态(auto-back + retry="")没有重试,只要求原因可见
      if (/\bauto-back\b/.test(tag) && /\bretry=""/.test(tag)) { assert.match(tag, /\bsub="[^"]+"/); return; }
      assert.match(tag, /\btitle="[^"]*加载失败[^"]*"/);
      assert.match(tag, /\bsub="[^"]+"/);
      assert.match(tag, /\bretry="[^"]+"/);
      assert.match(tag, /\bbind:retry="[^"]+"/);
    });
  });

  assert.match(coupon, /wx:if="\{\{loadState === 'loading'\}\}"/);
  assert.match(coupon, /wx:elif="\{\{loadState === 'error'\}\}"/);
  assert.match(coupon, /wx:if="\{\{loadState === 'ready' && list\.length === 0\}\}"/);
});

function loadCouponPage() {
  const pagePath = path.join(ROOT, 'subpackageMember/coupon/coupon.js');
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  const requests = [];
  global.getApp = () => ({ sendRequest(options) { requests.push(options); } });
  global.wx = {};
  let definition;
  global.Page = (config) => { definition = config; };
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return {
    page,
    requests,
    restore() {
      if (previous.Page === undefined) delete global.Page; else global.Page = previous.Page;
      if (previous.getApp === undefined) delete global.getApp; else global.getApp = previous.getApp;
      if (previous.wx === undefined) delete global.wx; else global.wx = previous.wx;
      delete require.cache[require.resolve(pagePath)];
    },
  };
}

test('G3 优惠券数据兜底：对象不渲染成字符串，缺关键字段不生成半成品卡', () => {
  const env = loadCouponPage();
  try {
    env.page.getList();
    env.requests[0].success({
      code: 200,
      data: [
        { id: 1, name: '到店立减', description: { raw: true }, publishCount: null, receiveCount: 2 },
        { name: '缺少 id' },
        { id: 3, name: { raw: true } },
      ],
    });
    assert.equal(env.page.data.loadState, 'ready');
    assert.equal(env.page.data.list.length, 1);
    assert.equal(env.page.data.list[0].description, '—');
    assert.equal(env.page.data.list[0].remainCount, 0);  // UI-04(2026-09-18):券张数没取到显示 0
    assert.doesNotMatch(JSON.stringify(env.page.data.list), /\[object Object\]/);
  } finally {
    env.restore();
  }
});

test('G3 优惠券失败态负控：非数组成功体不能伪装成真实空态', () => {
  const env = loadCouponPage();
  try {
    env.page.getList();
    env.requests[0].success({ code: 200, data: {} });
    assert.equal(env.page.data.loadState, 'error');
    assert.match(env.page.data.errorMsg, /服务返回异常/);
  } finally {
    env.restore();
  }
});

test('G3 据点二维码缺失时进入可重试错误态，不用占位块伪装成功', () => {
  const wxml = read('pages/merchant/citynode/index.wxml');
  const wxss = read('pages/merchant/citynode/index.wxss');
  assert.match(wxml, /posterSheet\.state === 'error'[\s\S]*retry="重新取码"[\s\S]*bind:retry="retryPosterCode"/);
  assert.doesNotMatch(wxml, /二维码暂不可用|cn-poster-placeholder/);
  assert.match(rule(wxss, '.cn-poster-img'), /background:\s*var\(--cy-bg-card-2\)/);
});
