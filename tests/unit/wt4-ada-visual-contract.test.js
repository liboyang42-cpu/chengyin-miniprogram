// WT4 商家侧 ADA 视觉契约(2026-07-29 实拍复核收口)。
//
// 为什么要有这一条:实拍审查判 FAIL 之后,产品代码已经修好了(白卡 + 细色带),
// 但**仓内没有任何测试会在有人把整卡 soft-bg 加回来时变红**。修好的样式没有锁,
// 等于下一次"顺手给状态卡加个底色"就能静默把可读性推回 AA 以下,而且截图不复拍就发现不了。
// 这条测试锁的就是这个回归面。
//
// 三条公共可见契约(都以真实 WXSS 为设计契约源,不靠行号、不靠快照):
//   ① 结算批次卡的三种状态**只**由左缘 ::before 色带表达,整卡背景必须和普通白卡一模一样。
//      —— 一旦补回 status-*-soft 整卡底,同卡 .rec-sub(12px 正文)对比度从 5.32:1 掉到 4.31~4.41:1,
//         而同列表里未知状态卡仍是白底 ⇒ 一张列表两种合规性。
//   ② .rec--band 的文字起点与普通 .rec 齐平(同为 var(--cy-space-3-5)),色带仍是 8rpx。
//      —— 带色带/不带色带的卡混排时首字左缘不许抖。
//   ③ 六个交互目标的可点高度 ≥ 88rpx(375pt 基准 = 44px)。
//
// 断言取值一律走"解析真值":尺寸 token 从 style/tokens.wxss 实读并跟随 var() 链,
// 阈值(88rpx / 8rpx / --cy-space-3-5)来自设计规格而不是从被测 CSS 里反算,
// 避免"用代码算期望值"的恒真测试。
//
// 每条契约都配内存负控:把源码变异回病灶形态,检查器必须精确判红。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_WXSS = path.join(ROOT, 'pages/merchant/ledger/index.wxss');
// 2026-08-08:原样本 merchantapply2 随三页版报名退役。换 merchant/decor —— 同形状
// (根节点显式挂 theme-merchant + 页底色定在根类上),商家日间链的代表面没变。
const APPLY_WXSS = path.join(ROOT, 'pages/merchant/decor/index.wxss');
const TOKENS_WXSS = path.join(ROOT, 'style/tokens.wxss');
const APP_WXSS = path.join(ROOT, 'app.wxss');
const MERCHANT_LIGHT_WXSS = path.join(ROOT, 'style/merchant-light.wxss');

// 本轮所有触达尺寸都必须由这一个 DS 控件高 token 驱动(不是"数值凑够 88 就行")。
const TAP_TOKEN = '--cy-btn-h';
const TAP_TOKEN_VALUE = `var(${TAP_TOKEN})`;

const LEDGER_WXML = path.join(ROOT, 'pages/merchant/ledger/index.wxml');
const APPLY_WXML = path.join(ROOT, 'pages/merchant/decor/index.wxml');

const readLedger = () => fs.readFileSync(LEDGER_WXSS, 'utf8');
const readApply = () => fs.readFileSync(APPLY_WXSS, 'utf8') + fs.readFileSync(path.join(path.dirname(APPLY_WXSS), 'design.wxss'), 'utf8');
const WXML = {
  ledger: fs.readFileSync(LEDGER_WXML, 'utf8'),
  apply: fs.readFileSync(APPLY_WXML, 'utf8'),
};

// 设计规格常量(真源 = ADA 处方 / WCAG,不从被测 CSS 反算)
const MIN_TAP_RPX = 88;        // 375pt 基准:750rpx = 375px ⇒ 88rpx = 44px
const BAND_WIDTH_RPX = 8;      // 处方 H 指定的状态色带宽度
const MIN_BAND_CLEARANCE = 16; // 色带右侧到文字至少留这么多,否则字贴着色带

// ---------------------------------------------------------------- WXSS 解析
//
// ★必须先剥注释:注释里带 "/"、中文括号会污染选择器串,导致规则静默不匹配 ——
//   而"匹配不到"如果被当成"没问题",整条测试就变成恒真绿。本文件的策略相反:
//   匹配不到一律显式报错(见 mustResolve / assert.ok(rules.length))。
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

// 解析成规则表。保留文档顺序:同优先级时后写的胜出,这是 CSS 层叠语义,
// 也是本页 .period-tab 用"另起一条规则只覆盖尺寸"的写法能成立的前提 ——
// 只取"第一条匹配的规则"的实现会读到旧值,从而假红。
function parseRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let order = 0;
  while ((m = re.exec(stripComments(css))) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const decls = [];
    for (const chunk of m[2].split(';')) {
      const i = chunk.indexOf(':');
      if (i > 0) decls.push([chunk.slice(0, i).trim(), chunk.slice(i + 1).trim()]);
    }
    if (selectors.length && decls.length) rules.push({ selectors, decls, order: order++ });
  }
  return rules;
}

// 元素模型:祖先 class 链(chain,最后一项是元素自身)+ 可选伪元素。
// ★必须带祖先链:merchantapply2 里 `.li` 是被复用了七八处的通用 class,
//   只比对最后一段会把优惠券卡、选项卡的 `.li` 规则(width:100% 等)一起吃进来。
//   链条取自真实 WXML 的嵌套关系,不是臆造的。
const compoundClasses = (compound) => compound.replace(/::[a-z-]+$/, '').split('.').filter(Boolean);

function matches(selector, el) {
  const compounds = selector.split(' ');
  const last = compounds.pop();
  if (((last.match(/::[a-z-]+$/) || [null])[0] || null) !== (el.pseudo || null)) return false;

  const self = el.chain[el.chain.length - 1];
  const lastClasses = compoundClasses(last);
  if (!lastClasses.length || !lastClasses.every((c) => self.includes(c))) return false;

  // 其余段必须按顺序命中祖先链(后代组合子 = 子序列匹配,不要求相邻)
  let i = 0;
  for (const compound of compounds) {
    const classes = compoundClasses(compound);
    while (i < el.chain.length - 1 && !classes.every((c) => el.chain[i].includes(c))) i++;
    if (i >= el.chain.length - 1) return false;
    i++;
  }
  return true;
}

// 优先级近似:整条选择器里的 class 个数。本页所有相关规则都是纯 class 选择器,
// 这个近似与真实优先级一致;同优先级按文档顺序,后写胜出。
const specificity = (selector) => (selector.match(/\.[a-zA-Z_][\w-]*/g) || []).length;

// 有效背景槽位。★不能写成 `style.background || style['background-color']`:
// 那个 || 会永远先拿到 .rec 的 background,于是"用 background-color 另给一层底色"
// 这种等价退化能一路绿到底(独立审查实证)。背景必须按层叠顺序求最后胜出者。
const EFFECTIVE_BG = Symbol('effective-background');

// 把命中的规则按 (优先级, 文档顺序) 升序展开,逐条声明写进 longhand 状态。
// padding 简写会一次写四边,padding-left 只写左边 —— 顺序敏感,必须顺序回放。
function computedStyle(rules, el) {
  const hits = [];
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (matches(selector, el)) hits.push({ spec: specificity(selector), rule });
    }
  }
  hits.sort((a, b) => a.spec - b.spec || a.rule.order - b.rule.order);

  const style = {};
  for (const { rule } of hits) {
    for (const [prop, value] of rule.decls) {
      if (prop === 'padding') {
        const parts = value.split(/\s+/);
        const [top, right, bottom, left] = [
          parts[0],
          parts[1] ?? parts[0],
          parts[2] ?? parts[0],
          parts[3] ?? parts[1] ?? parts[0],
        ];
        Object.assign(style, {
          'padding-top': top, 'padding-right': right, 'padding-bottom': bottom, 'padding-left': left,
        });
      } else if (prop === 'background') {
        // background 简写会把 background-color 重置掉;记一个"有效背景"槽位。
        style['background'] = value;
        delete style['background-color'];
        style[EFFECTIVE_BG] = value;
      } else if (prop === 'background-color') {
        style['background-color'] = value;
        style[EFFECTIVE_BG] = value;
      } else {
        style[prop] = value;
      }
    }
  }
  return { style, matched: hits.length };
}

// -------------------------------------------------- 祖先链:从真实 WXML 推导
//
// ★这里两次踩同一个坑,所以不再手写常量:第一次是 rec 卡少写 .ledger 根,
//   `.ledger .rec--pending{background}` 匹配不上而漏抓;第二次是五个触达目标同样少写根,
//   `.ledger .period-tab{height:64rpx}` 照样绿。手写祖先链的问题在于**它默认我记得住页面结构**,
//   而结构改一次、根 class 加一个,断言就静默失配 —— 失配又恰好长得像"通过"。
//   改成从 WXML 实读:祖先链是页面结构的真值,不是我的记忆。
function parseWxmlTree(wxml) {
  const clean = wxml.replace(/<!--[\s\S]*?-->/g, '');
  const nodes = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    // class 里的 {{...}} 是运行时表达式,只取静态 class(保守:不臆造动态 class)
    const raw = (attrs.match(/\sclass="([^"]*)"/) || [])[1] || '';
    const classes = raw.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean);
    const node = {
      tag,
      rawClass: raw,
      classes,
      // bindtap / catchtap 都是真实可点绑定 —— .del 删除键用的正是 catchtap
      // (它必须阻止冒泡,否则会连带触发整行的 selectOption)。只认 bindtap 会漏掉这类控件。
      bindtap: (attrs.match(/\s(?:bind|catch):?tap="([^"]+)"/) || [])[1] || null,
      parent: stack[stack.length - 1] || null,
    };
    nodes.push(node);
    if (!selfClose) stack.push(node);
  }
  return nodes;
}

// 找到"用户真正点的那个元素":带指定 class,且挂着指定 tap handler(bindtap 或 catchtap)。
// 找不到就抛 —— 元素被改名/换 handler 时必须报错,绝不当成通过。
function findTapTarget(wxml, className, handler, label) {
  const hit = parseWxmlTree(wxml).find(
    (n) => n.classes.includes(className) && n.bindtap === handler
  );
  assert.ok(hit, `${label}:WXML 里找不到 class="${className}" 且 bind/catchtap="${handler}" 的元素`);
  return hit;
}

// 从节点回溯出祖先 class 链(根在前,不含节点自身)。
function ancestorChainOf(node) {
  const chain = [];
  for (let p = node.parent; p; p = p.parent) if (p.classes.length) chain.unshift(p.classes);
  return chain;
}

// ---------------------------------------------------------------- token 解析
//
// ★不能把 style/tokens.wxss 当硬编码真源。ledger 页首行 @import 的是
//   style/merchant-light.wxss,而**它自己又重新定义了一遍 --cy-btn-h**；
//   merchant/decor 由根节点 theme-merchant 进入商家日间 token 链。
//   (日间键值是 tokens.wxss .theme-light 的镜像,见该文件头注释),
//   页面级 wxss 在 app.wxss 之后生效 ⇒ 真正生效的是 merchant-light 那份。
//   只读 tokens.wxss 的话:改 merchant-light 不会红(真退化漏抓)、
//   改 tokens.wxss 反而会红(假红)。所以按真实 @import 链求值。
//
// 顺序 = 全局 app.wxss 链(含 tokens.wxss)在前,页面自身 @import 链在后;
// 同名 token 后出现的胜出,这与小程序"全局样式先于页面样式"的层叠一致。
function importChain(entryPath, readFile, seen = new Set()) {
  const abs = path.resolve(entryPath);
  if (seen.has(abs)) return [];
  seen.add(abs);
  let css;
  try { css = readFile(abs); } catch (e) { return []; }
  const out = [];
  const re = /@import\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(stripComments(css))) !== null) {
    out.push(...importChain(path.resolve(path.dirname(abs), m[1]), readFile, seen));
  }
  out.push({ file: abs, css });
  return out;
}

/* 摘掉 @media (prefers-color-scheme: dark) 整块 —— 见 pageTokenTable 里的说明 */
function stripDarkMedia(css) {
  let out = '', i = 0;
  for (;;) {
    const at = css.indexOf('@media (prefers-color-scheme: dark)', i);
    if (at < 0) { out += css.slice(i); return out; }
    out += css.slice(i, at);
    let depth = 0, j = css.indexOf('{', at);
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    i = j;
  }
}

// overrides: 绝对路径 → 内存内容,给负控注入变异用(不落盘、不碰产品源码)。
function pageTokenTable(pageWxssPath, overrides = {}) {
  const readFile = (p) => {
    const abs = path.resolve(p);
    const raw = overrides[abs] !== undefined ? overrides[abs] : fs.readFileSync(abs, 'utf8');
    // 2026-08-22 系统深色模式:本表算的是**浅色外观**下的生效值。下面的扫描是
    // 「后出现者胜」的扁平扫描,不理会 @media 条件 —— 不摘掉深色块的话,
    // 深色值会被当成无条件声明覆盖上来。深色那一维由 system-darkmode-contract 单独锁。
    return stripDarkMedia(raw);
  };
  const files = [
    ...importChain(APP_WXSS, readFile),                  // 全局:app.wxss → tokens/lib/common/components
    ...importChain(pageWxssPath, readFile, new Set()),   // 页面:ledger → merchant-light；merchant/decor 由根 class 切主题
  ];
  const table = new Map();
  const re = /(--cy-[\w-]+)\s*:\s*([^;}]+)/g;
  for (const { css } of files) {
    let m;
    while ((m = re.exec(stripComments(css))) !== null) table.set(m[1], m[2].trim()); // 后出现者胜
  }
  return table;
}

// 'var(--cy-space-3-5)' / '28rpx' → 28。解不动就抛,不返回兜底值。
function toRpx(value, tokens, what, seen = new Set()) {
  assert.ok(value != null, `${what}:取不到值(规则缺失或属性未声明?)`);
  const raw = String(value).trim();
  const varMatch = raw.match(/^var\((--[\w-]+)\)$/);
  if (varMatch) {
    const name = varMatch[1];
    assert.ok(!seen.has(name), `${what}:token ${name} 自引用成环`);
    const next = tokens.get(name);
    assert.ok(next !== undefined, `${what}:token ${name} 在 tokens.wxss 里没有定义`);
    assert.ok(!next.conflict, `${what}:token ${name} 有多个不一致定义 ${JSON.stringify(next.conflict)}`);
    return toRpx(next, tokens, what, new Set(seen).add(name));
  }
  if (/^0(?:rpx|px)?$/.test(raw)) return 0;   // 无单位 0 是合法 CSS(如 `padding: 0 18rpx`)
  const num = raw.match(/^(-?[\d.]+)rpx$/);
  assert.ok(num, `${what}:期望裸 rpx 或 var(token),实际是 ${JSON.stringify(raw)}`);
  return parseFloat(num[1]);
}

// ---------------------------------------------------------------- 契约①
//
// 状态只由色带表达:整卡背景必须与普通白卡完全一致。
// 这里断言的是"用户看到的那块底色",不是"某个属性有没有出现" ——
// 所以补 background / background-color、换别的 token、写死颜色,全都会红。
const TONES = [
  { tone: 'pending', bandToken: 'var(--cy-color-status-warning)' },
  { tone: 'settled', bandToken: 'var(--cy-color-status-success)' },
  { tone: 'void', bandToken: 'var(--cy-color-status-danger)' },
];

// 结算批次卡的祖先链:定位 WXML 里那张"会挂状态修饰符"的卡(class 串里带 rec--)。
// 元素自身的 class 由契约给(rec / rec--band / rec--{tone}),祖先由 WXML 给。
function settlementCardAncestors() {
  const card = parseWxmlTree(WXML.ledger).find(
    (n) => n.classes.includes('rec') && /rec--/.test(n.rawClass)
  );
  assert.ok(card, 'WXML 里找不到会挂 rec-- 状态修饰符的结算批次卡');
  return ancestorChainOf(card);
}

function assertToneExpressedByBandOnly(ledgerCss) {
  const rules = parseRules(ledgerCss);

  const recAncestors = settlementCardAncestors();
  const plain = computedStyle(rules, { chain: [...recAncestors, ['rec']] });
  assert.ok(plain.matched > 0, '基础卡规则 .rec 必须存在(选择器被改名会让整条契约失效)');
  const plainBg = plain.style[EFFECTIVE_BG];
  assert.ok(plainBg, '.rec 必须声明卡片底色');

  for (const { tone, bandToken } of TONES) {
    // ★祖先链必须还原真实 DOM(WXML 根是 <view class="ledger theme-merchant">)。
    // 少写祖先 = 形如 `.ledger .rec--pending { background: ... }` 的上下文选择器压根匹配不上,
    // 于是"换个上下文选择器加底色"这类等价退化能绿着过去(独立审查实证)。
    const cardChain = [...recAncestors, ['rec', 'rec--band', `rec--${tone}`]];

    const band = computedStyle(rules, { chain: cardChain, pseudo: '::before' });
    assert.ok(band.matched > 0, `.rec--${tone}::before 色带规则必须存在`);
    assert.equal(
      band.style.background, bandToken,
      `.rec--${tone} 的状态必须由左缘色带承载,色带色应为 ${bandToken}`
    );

    // ★兜底闸:不依赖祖先链建模的完整度。只要**任何**规则的末段落在 .rec--{tone} 上
    //   并给了背景,就红 —— 换上下文选择器(.ledger .rec--pending)、换 background-color、
    //   加 .theme-merchant 前缀等等,全都绕不过这一条。上面的层叠等值断言负责"看到的底色对不对",
    //   这一条负责"根本不许有人给状态卡上底色",两层互为补位。
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        const last = selector.split(' ').pop();
        if (!/::/.test(last) && compoundClasses(last).includes(`rec--${tone}`)) {
          const bgDecl = rule.decls.find(([prop]) => prop === 'background' || prop === 'background-color');
          assert.ok(
            !bgDecl,
            `选择器 \`${selector}\` 给 .rec--${tone} 上了整卡底色(${bgDecl && bgDecl.join(': ')});` +
            '状态只能由左缘 ::before 色带承载,整卡底色会把同卡 12px 正文 .rec-sub 压到 AA 4.5:1 以下'
          );
        }
      }
    }

    const card = computedStyle(rules, { chain: cardChain });
    const cardBg = card.style[EFFECTIVE_BG];
    assert.equal(
      cardBg, plainBg,
      `.rec--${tone} 整卡底色必须与普通白卡一致(实际 ${cardBg});` +
      '补 status-*-soft 整卡底会把同卡 12px 正文 .rec-sub 压到 AA 4.5:1 以下,' +
      '且同列表里未知状态卡仍是白底 ⇒ 一张列表两种合规性'
    );
  }
}

// ---------------------------------------------------------------- 契约②
//
// 带色带的卡与普通卡文字起点齐平,且色带不贴字。
function assertBandTextStartAligned(ledgerCss, tokens) {
  const rules = parseRules(ledgerCss);

  const recAncestors = settlementCardAncestors();
  const plain = computedStyle(rules, { chain: [...recAncestors, ['rec']] });
  const band = computedStyle(rules, { chain: [...recAncestors, ['rec', 'rec--band']] });
  assert.ok(band.matched > 0, '.rec--band 规则必须存在');

  const plainLeft = toRpx(plain.style['padding-left'], tokens, '.rec 的 padding-left');
  const bandLeft = toRpx(band.style['padding-left'], tokens, '.rec--band 的 padding-left');
  assert.equal(
    bandLeft, plainLeft,
    `.rec--band 文字起点必须与普通 .rec 齐平(实际 ${bandLeft}rpx vs ${plainLeft}rpx);` +
    '否则带色带/不带色带的卡混排时首字左缘会抖'
  );

  // 规格要求二者同为 --cy-space-3:钉住具体 token,防止"两边一起改坏"也算齐平。
  // 2026-07-31 改锚:订单行 padding 按用户备注收到量表内的 --cy-space-3(原 --cy-space-3-5)。
  // 只换锚点 token,不放宽——上面的"齐平"与下面的"色带 8rpx / 净距 ≥ MIN_BAND_CLEARANCE"
  // 三条断言原样保留,且 clearance 从 20rpx 收到 16rpx 仍需通过下界检查。
  const specLeft = toRpx('var(--cy-space-3)', tokens, '规格 --cy-space-3');
  assert.equal(bandLeft, specLeft, `.rec--band 文字起点应为 var(--cy-space-3) = ${specLeft}rpx`);

  const bandBefore = computedStyle(rules, { chain: [...recAncestors, ['rec', 'rec--band']], pseudo: '::before' });
  const width = toRpx(bandBefore.style.width, tokens, '.rec--band::before 的 width');
  assert.equal(width, BAND_WIDTH_RPX, `状态色带宽度应为 ${BAND_WIDTH_RPX}rpx`);

  const clearance = bandLeft - width;
  assert.ok(
    clearance >= MIN_BAND_CLEARANCE,
    `色带到文字只剩 ${clearance}rpx,应 ≥ ${MIN_BAND_CLEARANCE}rpx,否则文字贴着色带`
  );
}

// ---------------------------------------------------------------- 契约③
//
// 可点高度 ≥ 88rpx。高度是这五个目标里**由 CSS 完全决定**的那一维,
// 所以这里咬高度;宽度只在 CSS 显式声明(width / min-width)时一并咬 ——
// .filter-chip 与 .ledger-action 的宽度由容器/文案撑开,本文件只判高度。
// chain 取自真实 WXML 的嵌套(ledger: .ledger>.ledger-action /
// .filter-row>.filter-chip;merchantapply2: .temp>.temp2>.row1>.col1>.li 与 .row1>.col2)。
// 每个目标只声明"哪个 class + 哪个 tap handler",祖先链一律从 WXML 实读。
// 顺带把"它真的可点"也咬进契约:handler 改了 / 元素没了,findTapTarget 直接报错。
// cy-tabs 组件的默认与 sm 档仍在本文件单独验证；本页五个目标按页面 wxss 算。
const TOUCH_TARGETS = [
  { file: 'ledger', cls: 'ledger-action', handler: 'goInbox', label: 'ledger 站内消息入口' },
  // 2026-08-20:核销筛选自绘 .filter-chip 收编进 cy-tabs chip 档(画板04 7:96),
  // 触达改由 assertComponentTabTouchOn 的 chip ::after 断言保障,此目标随之移除。
  // 2026-08-08:原来这里还有 merchantapply2 的两个目标,随三页版报名退役。
  // 没有平移到 merchant/decor —— decor 的行本来就不按 --cy-btn-h 写,
  // 硬套等于凭空给它加一条它从没答应过的要求。ledger 两个目标与 cy-tabs 照旧受约束。
  // 选项行的删除键:纯图标、catchtap、且与整行 selectOption 相邻 —— 命中区不够就会误删/误选。
  // 页面上另有一个 .card3 的 .del,靠 WXML 实读祖先链(含 .cardbox.card6)天然区分开。
  // 2026-08-06:玩法归主办方,选项编辑整套(含删除键)已从报名页撤除。
  // 这里只删这一条目标,其余四个触达区照旧受约束 —— 别顺手把整组闸放松了。

];

function tapBox(rules, el, tokens, label) {
  const { style, matched } = computedStyle(rules, el);
  assert.ok(matched > 0, `${label}:规则匹配不到(选择器被改名?)——不能当成通过`);

  const borderBox = /border-box/.test(style['box-sizing'] || '');
  // ★height 与 min-height 是两个**独立**属性,不是"谁后写谁覆盖":
  //   min-height 只把用过的高度**往上夹**,夹不小 ⇒ used ≈ max(height, min-height)。
  //   原实现写成 `style[minProp] ?? style[prop]`,等于让 min-height 无条件顶掉 height,
  //   于是真实样式(.period-tab 已有 height:88rpx)被人另加一条 min-height:64rpx 时,
  //   契约会算出 64 判红 —— 而浏览器实际渲染仍是 88,这是**假红**(第三次独立复核实证)。
  //   现在两个属性各自走层叠、最后取 max,只有"最终命中高度真的 <88rpx"才红。
  const sizeOf = (prop, minProp, padA, padB, what) => {
    const declared = [prop, minProp]
      .filter((k) => style[k] != null)
      .map((k) => toRpx(style[k], tokens, `${label} 的 ${what}(${k})`));
    if (!declared.length) return null;
    let size = Math.max(...declared);
    if (!borderBox) {
      for (const p of [padA, padB]) {
        if (style[p] != null) size += toRpx(style[p], tokens, `${label} 的 ${p}`);
      }
    }
    return size;
  };

  return {
    style,
    height: sizeOf('height', 'min-height', 'padding-top', 'padding-bottom', '高'),
    width: sizeOf('width', 'min-width', 'padding-left', 'padding-right', '宽'),
  };
}

// 语义闸:触达尺寸必须**由 --cy-btn-h 驱动**,不是"数值凑够 88 就算过"。
// xcx AGENTS.md 要求新增样式走设计 token;只断言数值的话,写死 88rpx 或换个
// 恰好也等于 88 的别的 token 都能静默通过 —— 那正是本轮被复核抓到的假绿。
// 只管尺寸四件套里**真正写了的那些**:没写的(如 .seg-tab 靠 flex:1 定宽)不强求。
const SIZE_PROPS = ['width', 'min-width', 'height', 'min-height'];

function assertDrivenByTapToken(style, label) {
  const declared = SIZE_PROPS.filter((p) => style[p] != null);
  assert.ok(
    declared.length > 0,
    `${label}:尺寸四件套一个都没声明,触达尺寸无从谈起`
  );
  for (const prop of declared) {
    assert.equal(
      style[prop], TAP_TOKEN_VALUE,
      `${label} 的 ${prop} = ${style[prop]},必须写成 ${TAP_TOKEN_VALUE}:` +
      '触达尺寸要由 DS 控件高 token 驱动,裸 rpx 或换成别的 token 都不算(即便数值恰好也是 88)'
    );
  }
}

function assertTouchTargets(cssByFile, tokensByFile, wxmlByFile = WXML) {
  const rulesByFile = {
    ledger: parseRules(cssByFile.ledger),
    apply: parseRules(cssByFile.apply),
  };
  for (const { file, cls, handler, label } of TOUCH_TARGETS) {
    const node = findTapTarget(wxmlByFile[file], cls, handler, label);
    const chain = [...ancestorChainOf(node), node.classes];
    const tokens = tokensByFile[file];
    const box = tapBox(rulesByFile[file], { chain }, tokens, label);
    assertDrivenByTapToken(box.style, label);
    assert.ok(
      box.height != null,
      `${label}:高度未由 CSS 声明(height/min-height 都没有),可点区无法保证`
    );
    assert.ok(
      box.height >= MIN_TAP_RPX,
      `${label} 可点高度 ${box.height}rpx < ${MIN_TAP_RPX}rpx(44px@375),低于最小可点区`
    );
    if (box.width != null) {
      assert.ok(
        box.width >= MIN_TAP_RPX,
        `${label} 可点宽度 ${box.width}rpx < ${MIN_TAP_RPX}rpx(44px@375),低于最小可点区`
      );
    }
  }
}

// ================================================================ 绿:真实源码
// 每个页面各自按自己的 @import 链求值(两页当前都 @import merchant-light,
// 但表分开建,避免"反正都一样"这种会随结构漂移失效的假设)。
const tokensFor = (overrides) => ({
  ledger: pageTokenTable(LEDGER_WXSS, overrides),
  apply: pageTokenTable(APPLY_WXSS, overrides),
});
const TOKENS = tokensFor();

// 2026-08-11 重排(用户草图):状态表达从「左缘色带」换成「7px 语义点 + cy-badge chip」,
// 结算批次卡不再是 .rec--band。**不变量没变**:状态绝不能靠整卡/整行底色表达 ——
// 整卡底色会把同卡 12px 正文压到 AA 4.5:1 以下,且未知状态仍白底 ⇒ 一张列表两种合规性。
// 所以这两条契约改锚到新结构上,而不是删掉。
const FINANCE_WXSS = path.join(ROOT, 'pages/merchant/style/merchant-finance.wxss');
const readFinance = () => fs.readFileSync(FINANCE_WXSS, 'utf8');
const TONE_VARIANTS = ['warning', 'success', 'danger', 'neutral'];

test('①资金域行状态只由语义点/chip 表达,行与卡都不得被状态染底色', () => {
  const css = readFinance();
  const rules = parseRules(css);

  // 语义点必须真的按状态给色(否则"改锚"就成了把契约架空)
  for (const tone of TONE_VARIANTS) {
    const dot = rules.find((r) => r.selectors.some((sel) => sel.trim().endsWith(`.fin-row__dot--${tone}`)));
    assert.ok(dot, `.fin-row__dot--${tone} 必须存在:状态要有可扫读的语义点`);
    const bg = dot.decls.find(([prop]) => prop === 'background' || prop === 'background-color');
    assert.ok(bg && /var\(--cy-(color-status|text)-/.test(bg[1]),
      `.fin-row__dot--${tone} 的颜色必须走 status/text token(实际 ${bg && bg[1]})`);
  }

  // 兜底闸:任何规则都不许给行/卡挂"带状态语义"的底色。换上下文选择器、换 background-color 都绕不过。
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      const last = selector.split(' ').pop();
      if (/::/.test(last)) continue;
      const classes = compoundClasses(last);
      const carriesTone = TONE_VARIANTS.some((tone) => classes.some((c) => c.endsWith(`--${tone}`)));
      const isRowOrCard = classes.some((c) => c === 'fin-row' || c === 'fin-card' || c === 'fin-group');
      if (!carriesTone || !isRowOrCard) continue;
      const bgDecl = rule.decls.find(([prop]) => prop === 'background' || prop === 'background-color');
      assert.ok(!bgDecl,
        `选择器 \`${selector}\` 给行/卡上了状态底色(${bgDecl && bgDecl.join(': ')});` +
        '状态只能由语义点与 chip 承载,整行底色会把同行 12px 副文压到 AA 4.5:1 以下');
    }
  }
});

test('②资金域行文字起点齐平:语义点靠固定宽度+gap 让位,不靠逐状态改 padding', () => {
  const css = readFinance();
  const rules = parseRules(css);
  const row = rules.find((r) => r.selectors.some((sel) => sel.trim().endsWith('.fin-row')));
  assert.ok(row, '.fin-row 规则必须存在(选择器被改名会让整条契约失效)');
  assert.ok(row.decls.some(([prop, value]) => prop === 'gap' && /var\(--cy-space-/.test(value)),
    '.fin-row 必须用 token gap 让位,文字起点才对所有行一致');
  const dot = rules.find((r) => r.selectors.some((sel) => sel.trim().endsWith('.fin-row__dot')));
  assert.ok(dot, '.fin-row__dot 基础规则必须存在');
  assert.ok(dot.decls.some(([prop, value]) => prop === 'flex' && /0 0 /.test(value)),
    '语义点必须固定宽度(flex: 0 0 …),否则不同状态下文字起点会漂');
  // 任何逐状态改 padding/margin 的规则都会让右缘/左缘对齐线塌掉
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      const classes = compoundClasses(selector.split(' ').pop());
      if (!TONE_VARIANTS.some((tone) => classes.some((c) => c === `fin-row__dot--${tone}`))) continue;
      const bad = rule.decls.find(([prop]) => /^(padding|margin|width|height)/.test(prop));
      assert.ok(!bad, `选择器 \`${selector}\` 改了盒模型(${bad && bad.join(': ')});语义点只许换颜色`);
    }
  }
});

// —— ②b 两页各自挂在明确的主题链上 ——
//
// 原意图:这两页的配色必须由一个**显式的主题 class** 决定,不许裸奔靠继承(裸奔时
// 组件跨 styleIsolation 读 var() 会退回外层暗色默认值,页面上下两截背景不同色)。
// 2026-08-07 改锚:merchantapply2 属于商家报名链,与 ledger 一样显式挂 .theme-merchant。
// ★改锚不是放宽:两页都仍被钉死在具体主题 class 上,且新增了「页底色必须在主题
//   作用域内再落一次」这条 —— 主题 class 挂在根 view 上,page 元素够不着,
//   只改 class 不落底色的话灰底会从背后透上来(换主题等于没换)。
function assertPageThemeScope(wxml, wxss, themeClass, rootClass, label, backgroundToken = rootClass === 'dc-page' ? '--cy-color-bg-page' : '--cy-bg-page') {
  const rootTag = new RegExp(`<view class="${rootClass}([^"]*)"`).exec(wxml);
  assert.ok(rootTag, `${label}:必须有 <view class="${rootClass} ..."> 根节点`);
  assert.match(
    rootTag[1], new RegExp(`\\b${themeClass}\\b`),
    `${label}:根节点必须显式挂 .${themeClass},不许靠继承裸奔`
  );
  const rootRule = new RegExp(`\\.${rootClass}\\s*\\{[^}]*\\}`).exec(stripComments(wxss));
  assert.ok(rootRule, `${label}:必须有 .${rootClass} 规则`);
  assert.match(
    rootRule[0], new RegExp(`background:\\s*var\\(${backgroundToken}\\)`),
    `${label}:页底色必须落在挂了主题 class 的 .${rootClass} 上(page{} 在主题作用域外,解析不到本域值)`
  );
}

test('②b merchant/decor 与 ledger 均挂 theme-merchant,且页底色落在主题作用域内', () => {
  assertPageThemeScope(WXML.apply, readApply(), 'theme-merchant', 'dc-page', 'merchant/decor');
  assertPageThemeScope(WXML.ledger, readLedger(), 'theme-merchant', 'ledger', 'ledger');
});

test('②b 负控:merchant/decor 去掉 theme-merchant class 必须判红', () => {
  const mutated = WXML.apply.replace('class="dc-page theme-merchant', 'class="dc-page');
  assert.notEqual(mutated, WXML.apply, '负控必须实际摘掉主题 class');
  assert.throws(
    () => assertPageThemeScope(mutated, readApply(), 'theme-merchant', 'dc-page', 'merchant/decor'),
    /显式挂 \.theme-merchant/
  );
});

test('②b 负控:merchant/decor 换回 theme-dark 必须判红', () => {
  const mutated = WXML.apply.replace('class="dc-page theme-merchant', 'class="dc-page theme-dark');
  assert.notEqual(mutated, WXML.apply, '负控必须实际换掉根节点主题 class');
  assert.throws(
    () => assertPageThemeScope(mutated, readApply(), 'theme-merchant', 'dc-page', 'merchant/decor'),
    /显式挂 \.theme-merchant/
  );
});

test('②b 负控:主题 class 还在但页底色被撤回 page{} 时必须判红', () => {
  // ★在 stripComments 之后做变异:.temp 规则里的注释含字面 "page{}",
  //   直接在原文上用 [^}] 扫会被那对花括号截断,变异悄悄不生效 = 假绿的负控。
  const stripped = stripComments(readApply());
  const mutated = stripped.replace(/(\.dc-page\s*\{[^}]*?)\s*background: var\(--cy-color-bg-page\);/, '$1');
  assert.notEqual(mutated, stripped, '负控必须实际撤掉 .dc-page 的底色声明');
  assert.throws(
    () => assertPageThemeScope(WXML.apply, mutated, 'theme-merchant', 'dc-page', 'merchant/decor'),
    /页底色必须落在挂了主题 class 的 \.dc-page 上/
  );
});

// 组件层的触达契约:cy-tabs 的默认档直接 88rpx;sm 紧凑档视觉 44rpx,但必须用
// 透明 ::after 把触达区撑回 88rpx(与 cy-btn 的 .btn--sm::after 同一手法)。
// ⚠️ 只断言「撑回去了」不够 —— 得断言它撑的是 88rpx 这个数,否则写成任意值都能过。
function assertComponentTabTouch() {
  assertComponentTabTouchOn(fs.readFileSync(path.resolve(__dirname, '../../components/cy/tabs/index.wxss'), 'utf8'));
}

// 拆成"喂源码"的形式，负控才能直接对变异后的字符串跑（不然只能改真文件）
function assertComponentTabTouchOn(css) {
  // 88rpx 声明在容器 .cy-tabs 上，item 靠 align-items:stretch 撑满 —— 断言要跟着
  // 真实实现走，别对着想象中的选择器写。
  assert.match(css, /\.cy-tabs\s*\{[^}]*height:\s*88rpx/,
    'cy-tabs 容器高度必须是 88rpx');
  assert.match(css, /\.cy-tabs\s*\{[^}]*align-items:\s*stretch/,
    'item 靠 stretch 继承容器高度，改了就不再是 88rpx');
  const smAfter = /\.cy-tabs--sm \.cy-tabs__item::after \{([^}]*)\}/.exec(css);
  assert.ok(smAfter, 'cy-tabs 的 sm 紧凑档必须有撑触达区的 ::after');
  assert.ok(/88rpx/.test(smAfter[1]),
    'sm 档的 ::after 必须把触达区撑到 88rpx(与 cy-btn 的 .btn--sm::after 同一手法)');
  // 2026-08-20 chip 档收薄(画板04 7:96)后同样靠透明 ::after 补触达:
  // 视觉高 ~62rpx + 上下各 14rpx 外扩 = 90rpx;外扩量必须有容器 padding 预留,
  // 否则 scroll-view 会把热区裁掉(空有声明,命中区没变)。
  const chipAfter = /\.cy-tabs--chip \.cy-tabs__item::after \{([^}]*)\}/.exec(css);
  assert.ok(chipAfter, 'cy-tabs 的 chip 档必须有撑触达区的 ::after');
  assert.match(chipAfter[1], /top:\s*-14rpx/, 'chip 档 ::after 必须向上外扩 14rpx');
  assert.match(chipAfter[1], /bottom:\s*-14rpx/, 'chip 档 ::after 必须向下外扩 14rpx');
  assert.match(css, /\.cy-tabs--chip \{[^}]*padding:\s*14rpx 0/,
    'chip 容器必须预留 14rpx 竖向 padding,否则热区被 scroll-view 裁掉');
}

test('③ledger 两个交互目标与 cy-tabs 触达区均 ≥ 88rpx', () => {
  assertTouchTargets({ ledger: readLedger(), apply: readApply() }, TOKENS);
  assertComponentTabTouch();
});

// ================================================================ 红:内存负控
//
// 每个负控都先 assert.notEqual 确认"变异真的改到了东西" ——
// 锚点失效时变异是空操作,assert.throws 会当场暴露而不是假绿。
const mutate = (css, from, to, what) => {
  const out = css.replace(from, to);
  assert.notEqual(out, css, `变异锚点失效(${what}):源码已改动,负控不再有效`);
  return out;
};

test('negative control:把 status-*-soft 整卡底色加回来必须判红', () => {
  const soft = {
    pending: 'var(--cy-color-status-warning-soft)',
    settled: 'var(--cy-color-status-success-soft)',
    void: 'var(--cy-color-status-danger-soft)',
  };
  for (const { tone } of TONES) {
    const mutated = mutate(
      readLedger(),
      `.rec--${tone}::before {`,
      `.rec--${tone} { background: ${soft[tone]}; }\n.rec--${tone}::before {`,
      `${tone} soft-bg`
    );
    assert.throws(
      () => assertToneExpressedByBandOnly(mutated),
      assert.AssertionError,
      `.rec--${tone} 补回整卡 soft 底色,契约①必须判红`
    );
  }
});

test('negative control:改用 background-color 给状态卡上底色(等价退化)必须判红', () => {
  const mutated = mutate(
    readLedger(),
    '.rec--pending::before {',
    '.rec--pending { background-color: var(--cy-color-status-warning-soft); }\n.rec--pending::before {',
    'background-color 等价退化'
  );
  assert.throws(() => assertToneExpressedByBandOnly(mutated), assert.AssertionError);
});

test('negative control:借真实祖先/上下文选择器给状态卡上底色必须判红', () => {
  for (const contextSelector of [
    '.ledger .rec--settled',            // 真实祖先(WXML 根 class)
    '.theme-merchant .rec--settled',    // 真实祖先(同节点第二个 class)
    '.ledger .rec.rec--settled',        // 上下文 + 复合段
  ]) {
    const mutated = mutate(
      readLedger(),
      '.rec--settled::before {',
      `${contextSelector} { background: var(--cy-color-status-success-soft); }\n.rec--settled::before {`,
      contextSelector
    );
    assert.throws(
      () => assertToneExpressedByBandOnly(mutated),
      assert.AssertionError,
      `${contextSelector} 加底色必须判红`
    );
  }
});

test('negative control:.rec--band 左内边距改回加宽版必须判红', () => {
  const mutated = mutate(
    readLedger(),
    '.rec--band { position: relative;',
    '.rec--band { padding-left: var(--cy-space-4); position: relative;',
    'band padding-left'
  );
  assert.throws(() => assertBandTextStartAligned(mutated, TOKENS.ledger), assert.AssertionError);
});

test('negative control:色带宽度被改掉必须判红', () => {
  const mutated = mutate(readLedger(), 'width: 8rpx;', 'width: 4rpx;', 'band width');
  assert.throws(() => assertBandTextStartAligned(mutated, TOKENS.ledger), assert.AssertionError);
});

test('negative control:缩小任一交互目标必须判红', () => {
  const cases = [
    ['ledger', 'min-height: var(--cy-btn-h);\n  display: flex;',
      'min-height: 64rpx;\n  display: flex;', 'ledger-action 缩小'],
  ];
  for (const [file, from, to, what] of cases) {
    const base = { ledger: readLedger(), apply: readApply() };
    base[file] = mutate(base[file], from, to, what);
    assert.throws(() => assertTouchTargets(base, TOKENS), assert.AssertionError, `${what} 必须判红`);
  }
});

test('正例:cy-tabs 默认档的 88rpx 由容器给,item 靠 stretch 继承(不许算小)', () => {
  // ★"防假红"的正向闸:高度声明在容器 .cy-tabs 上、item 用 align-items:stretch
  // 继承 —— 只要这两条都在,item 的实际高度就是 88rpx。
  const css = fs.readFileSync(path.resolve(__dirname, '../../components/cy/tabs/index.wxss'), 'utf8');
  const container = /\.cy-tabs \{([^}]*)\}/.exec(css);
  assert.ok(container, '.cy-tabs 容器规则应存在');
  assert.match(container[1], /height:\s*88rpx/, '容器高度必须是 88rpx');
  assert.match(container[1], /align-items:\s*stretch/, 'item 必须靠 stretch 继承容器高度');
});

test('negative control:cy-tabs 的触达保障被改掉必须判红', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../components/cy/tabs/index.wxss'), 'utf8');
  const shrunk = css.replace(/(\.cy-tabs \{[^}]*?)height: 88rpx;/, '$1height: 64rpx;');
  assert.notEqual(shrunk, css, '变异锚点失效:cy-tabs 容器高度声明找不到了');
  assert.throws(() => assertComponentTabTouchOn(shrunk), assert.AssertionError, '容器高度改小必须判红');

  const noAfter = css.replace(/\.cy-tabs--sm \.cy-tabs__item::after \{[^}]*\}/, '');
  assert.notEqual(noAfter, css, '变异锚点失效:sm 档的触达 ::after 找不到了');
  assert.throws(() => assertComponentTabTouchOn(noAfter), assert.AssertionError, 'sm 档抽掉 ::after 必须判红');

  const noChipAfter = css.replace(/\.cy-tabs--chip \.cy-tabs__item::after \{[^}]*\}/, '');
  assert.notEqual(noChipAfter, css, '变异锚点失效:chip 档的触达 ::after 找不到了');
  assert.throws(() => assertComponentTabTouchOn(noChipAfter), assert.AssertionError, 'chip 档抽掉 ::after 必须判红');

  const noChipPad = css.replace('padding: 14rpx 0;', '');
  assert.notEqual(noChipPad, css, '变异锚点失效:chip 容器 padding 找不到了');
  assert.throws(() => assertComponentTabTouchOn(noChipPad), assert.AssertionError, 'chip 容器抽掉热区预留 padding 必须判红');
});

// 把某个样式文件的 --cy-btn-h 改成别的值,做成"内存 overrides"喂给 token 求值。
const shrinkBtnH = (file, to) => ({
  [file]: mutate(
    fs.readFileSync(file, 'utf8'),
    /--cy-btn-h:(\s*)88rpx;/,
    `--cy-btn-h:$1${to};`,
    `${path.basename(file)} 的 --cy-btn-h 改成 ${to}`
  ),
});

test('negative control:真实生效作用域(merchant-light)的 --cy-btn-h 改小必须判红', () => {
  // 页面 @import 的是 merchant-light.wxss,它重定义了 --cy-btn-h ⇒ 这份才是生效值。
  assert.throws(
    () => assertTouchTargets(
      { ledger: readLedger(), apply: readApply() },
      tokensFor(shrinkBtnH(MERCHANT_LIGHT_WXSS, '64rpx'))
    ),
    assert.AssertionError
  );
});

test('negative control:tap handler 被改名时必须报错,不能当成通过', () => {
  // 祖先链现在从 WXML 实读,元素找不到就必须炸 —— 否则"找不到"会退化成"没问题"。
  const wxml = {
    ledger: mutate(WXML.ledger, 'bindtap="goInbox"', 'bindtap="goInboxRenamed"', 'handler 改名'),
    apply: WXML.apply,
  };
  assert.throws(
    () => assertTouchTargets({ ledger: readLedger(), apply: readApply() }, TOKENS, wxml),
    assert.AssertionError
  );
});

test('negative control:目标选择器被改名不能当成通过', () => {
  const mutated = mutate(readLedger(), '.ledger-action {', '.ledger-action-renamed {', 'ledger-action 改名');
  assert.throws(
    () => assertTouchTargets({ ledger: mutated, apply: readApply() }, TOKENS),
    assert.AssertionError
  );
});
