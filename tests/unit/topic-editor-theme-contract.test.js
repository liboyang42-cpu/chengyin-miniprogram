// 主题编辑页浅色可读性契约：旧 alias 不能继续从 page 的暗色默认值继承。
// index.wxss 仍有历史 alias 用法，因此 theme-topic-editor 必须在页面节点上做显式桥接。
//
// 2026-08-09 用户拍板「创建域改回设计稿彩色」后，本文件多锁两件事：
//   ① 状态色不许再被压平成中性色（那正是「整体太白」的成因）；
//   ② temp/index.wxss 的字面值快照必须与 style/tokens.wxss 逐字同步 —— 快照漂移
//      会让这一页停在旧配色而其它创建页已换，且静默无报错。
// 颜色不是抄一遍常量比对，而是实算 WCAG 对比度：常量比对只能证明「有人改过」，
// 证明不了「改完还看得清」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const XCX = process.env.FORMAL_ICON_ROOT || path.resolve(__dirname, '../..');
const FILE = path.join(XCX, 'pages/publish/temp/index.wxss');
const TOKENS = path.join(XCX, 'style/tokens.wxss');
const read = () => fs.readFileSync(FILE, 'utf8');
const readTokens = () => fs.readFileSync(TOKENS, 'utf8');

const BRIDGE = {
  '--cy-bg-page': '--cy-color-bg-page',
  '--cy-bg-card': '--cy-color-bg-surface',
  '--cy-bg-card-2': '--cy-color-bg-surface-subtle',
  '--cy-border-card': '--cy-color-border-subtle',
  '--cy-border-line': '--cy-color-border-strong',
  '--cy-brand': '--cy-color-brand',
  '--cy-brand-soft': '--cy-color-brand-soft',
  '--cy-accent-strong': '--cy-color-brand-strong',
  '--cy-danger': '--cy-color-status-danger',
  '--cy-danger-soft': '--cy-color-status-danger-soft',
  '--cy-info': '--cy-color-status-info',
  '--cy-success': '--cy-color-status-success',
  '--cy-text-title': '--cy-color-text-primary',
  '--cy-text-body': '--cy-color-text-secondary',
  '--cy-text-secondary': '--cy-color-text-tertiary',
};

// 承载文字/图标的前景 token → 它实际落在的底色 token，以及要求的最低对比度。
// 正文与状态文字取 AA 4.5:1；状态色落在画布(而非白卡)上时按 UI 组件的 3:1 收。
const CONTRAST = [
  ['--cy-color-text-primary', '--cy-color-bg-page', 4.5],
  ['--cy-color-text-primary', '--cy-color-bg-surface', 4.5],
  ['--cy-color-text-secondary', '--cy-color-bg-page', 4.5],
  ['--cy-color-text-secondary', '--cy-color-bg-surface', 4.5],
  ['--cy-color-text-tertiary', '--cy-color-bg-page', 4.5],
  ['--cy-color-text-tertiary', '--cy-color-bg-surface', 4.5],
  // ⚠️ 2026-08-10 补:上面只算了「文字 vs 页底/白卡」,漏了 surface-subtle。
  //    而 --cy-color-input-idle-bg / input-filled-bg / --cy-bg-card-2 全都指向它,
  //    输入框里的字实际印在 subtle 上,从来没被这份契约看过一眼。
  ['--cy-color-text-primary', '--cy-color-bg-surface-subtle', 4.5],
  ['--cy-color-text-secondary', '--cy-color-bg-surface-subtle', 4.5],
  ['--cy-color-text-tertiary', '--cy-color-bg-surface-subtle', 4.5],
  ['--cy-color-brand', '--cy-color-bg-surface', 4.5],
  ['--cy-color-brand', '--cy-color-bg-page', 3],
  ['--cy-color-status-info', '--cy-color-bg-surface', 4.5],
  ['--cy-color-status-success', '--cy-color-bg-surface', 4.5],
  ['--cy-color-status-warning', '--cy-color-bg-surface', 4.5],
  ['--cy-color-status-danger', '--cy-color-bg-surface', 4.5],
  // 错误文字实际印在自己的软底上，白底过了不代表软底上过 —— 同色系软底最会吃对比度。
  // ⚠️ 2026-08-10:原本只锁了 danger 这一支,而它恰好是四支里唯一过的(4.78);
  //    brand/info/warning 印在各自软底上实测 4.14 / 4.06 / 4.17,全在线下却没人拦。
  //    修法不是改稿的主色 —— 主色还要当实底 CTA 用 —— 而是软底上的文字改用 -strong 档。
  ['--cy-color-status-danger', '--cy-color-status-danger-soft', 4.5],
  ['--cy-color-status-success', '--cy-color-status-success-soft', 4.5],
  ['--cy-color-brand-strong', '--cy-color-brand-soft', 4.5],
  ['--cy-color-status-info-strong', '--cy-color-status-info-soft', 4.5],
  ['--cy-color-status-warning-strong', '--cy-color-status-warning-soft', 4.5],
  // 主 CTA：白字印在黑底上。
  ['--cy-color-action-primary-fg', '--cy-color-action-primary-bg', 4.5],
];

// 压平检测：这几支必须彼此不同，且都不等于正文色。
const MUST_BE_DISTINCT = [
  '--cy-color-brand',
  '--cy-color-status-success',
  '--cy-color-status-warning',
  '--cy-color-status-danger',
];

// temp/index.wxss 的字面值快照必须与 tokens.wxss 同名 token 同值。
const SNAPSHOT_KEYS = [
  '--cy-color-bg-page',
  '--cy-color-bg-surface',
  '--cy-color-bg-surface-subtle',
  '--cy-color-text-primary',
  '--cy-color-text-secondary',
  '--cy-color-text-tertiary',
  '--cy-color-border-subtle',
  '--cy-color-border-strong',
  '--cy-color-brand',
  '--cy-color-brand-strong',
  '--cy-color-brand-soft',
  '--cy-color-status-danger',
  '--cy-color-status-danger-soft',
  '--cy-color-status-info',
  '--cy-color-status-success',
  '--cy-color-status-warning',
];

// ---- WCAG 相对亮度与对比度 ----
function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(m, `期望 6 位十六进制色值，实际拿到 ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * srgbToLinear((n >> 16) & 0xff) +
    0.7152 * srgbToLinear((n >> 8) & 0xff) +
    0.0722 * srgbToLinear(n & 0xff)
  );
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- 取块内的十六进制字面值声明 ----
function block(source, startMarker) {
  const at = source.indexOf(startMarker);
  assert.notEqual(at, -1, `找不到选择器 ${startMarker}`);
  const open = source.indexOf('{', at);
  const close = source.indexOf('\n}', open);
  assert.notEqual(close, -1, `${startMarker} 的块没有闭合`);
  return source.slice(open + 1, close);
}

function hexDecls(blockText) {
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m;
  while ((m = re.exec(blockText)) !== null) out[m[1]] = m[2].toUpperCase();
  return out;
}

const tokenTheme = () => hexDecls(block(readTokens(), 'page.theme-topic-editor,'));
const pageTheme = () => hexDecls(block(read(), '\n.theme-topic-editor {'));

function assertBridge(source) {
  for (const [legacy, semantic] of Object.entries(BRIDGE)) {
    assert.match(
      source,
      new RegExp(`${legacy.replaceAll('-', '\\-')}\\s*:\\s*var\\(${semantic.replaceAll('-', '\\-')}\\)`),
      `${legacy} 必须桥接到 ${semantic}`
    );
  }
}

function assertContrast(theme) {
  for (const [fg, bg, min] of CONTRAST) {
    assert.ok(theme[fg], `主题里缺 ${fg}`);
    assert.ok(theme[bg], `主题里缺 ${bg}`);
    const ratio = contrast(theme[fg], theme[bg]);
    assert.ok(
      ratio >= min,
      `${fg}(${theme[fg]}) 印在 ${bg}(${theme[bg]}) 上只有 ${ratio.toFixed(2)}:1，低于要求的 ${min}:1`
    );
  }
}

function assertNotFlattened(theme) {
  const ink = theme['--cy-color-text-primary'];
  const seen = new Map();
  for (const key of MUST_BE_DISTINCT) {
    const value = theme[key];
    assert.ok(value, `主题里缺 ${key}`);
    assert.notEqual(value, ink, `${key} 不能压平成正文色 ${ink}（创建域已拍板用彩色区分状态）`);
    assert.ok(!seen.has(value), `${key} 与 ${seen.get(value)} 同色 ${value}，状态失去区分度`);
    seen.set(value, key);
  }
}

test('主题编辑页显式桥接所有会影响浅色可读性的 legacy alias', () => {
  assertBridge(read());
});

test('创建域配色：状态四支彼此可辨且都不是正文色', () => {
  assertNotFlattened(tokenTheme());
  assertNotFlattened(pageTheme());
});

test('创建域配色：每个前景 token 在它实际落的底色上都过 WCAG', () => {
  assertContrast(tokenTheme());
});

function assertSnapshotSynced(snapshot, canonical) {
  for (const key of SNAPSHOT_KEYS) {
    assert.ok(canonical[key], `tokens.wxss 的 .theme-topic-editor 里缺 ${key}`);
    assert.ok(snapshot[key], `temp/index.wxss 的快照里缺 ${key}`);
    assert.equal(
      snapshot[key],
      canonical[key],
      `${key} 快照漂移：temp/index.wxss=${snapshot[key]}，tokens.wxss=${canonical[key]}`
    );
  }
}

test('temp/index.wxss 的字面值快照与 tokens.wxss 逐字同步', () => {
  assertSnapshotSynced(pageTheme(), tokenTheme());
});

// —— 消费方层的闸 ——
// 上面的 CONTRAST 只比 token 对:把 .cg-chip 的 color 改回 var(--cy-brand),token 对
// 还是那两个、照样全绿,而页面上文字已经掉到 4.14:1。闸放在 token 层拦不住消费方,
// 所以这里直接扫 wxss:凡是用 *-soft 当背景的规则,前景不许是同色系的**基色**档。
const SOFT_TO_BASE = {
  '--cy-brand-soft': ['--cy-brand', '--cy-color-brand'],
  '--cy-color-brand-soft': ['--cy-brand', '--cy-color-brand'],
  '--cy-color-status-info-soft': ['--cy-info', '--cy-color-status-info'],
  '--cy-color-status-warning-soft': ['--cy-color-status-warning'],
};

function assertSoftBackgroundUsesStrong(sources) {
  const hits = [];
  for (const [file, css] of Object.entries(sources)) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = m[2];
      const bg = body.match(/background(?:-color)?\s*:\s*var\(\s*(--[\w-]+)\s*\)/);
      const fg = body.match(/(?:^|;)\s*color\s*:\s*var\(\s*(--[\w-]+)\s*\)/);
      if (!bg || !fg) continue;
      const banned = SOFT_TO_BASE[bg[1]];
      if (banned && banned.includes(fg[1])) {
        hits.push(`${file} ${m[1].trim().split('\n').pop().trim()} — ${bg[1]} 上用了基色 ${fg[1]}`);
      }
    }
  }
  assert.deepEqual(hits, [],
    '软底上的前景必须用 -strong 档(基色只保证白底 ≥4.5,压到同色系软底上会掉出 AA)');
}

const CONSUMER_FILES = [
  'pages/publish/temp/index.wxss',
  'pages/publish/simple/index.wxss',
  'pages/publish/topicadd/topicadd.wxss',
  'pages/publish/templateadd/templateadd.wxss',
];
const readConsumers = () => Object.fromEntries(
  CONSUMER_FILES.map((f) => [f, fs.readFileSync(path.join(XCX, f), 'utf8')])
);

test('创建域配色：软底上的前景一律用 -strong 档，不用基色', () => {
  assertSoftBackgroundUsesStrong(readConsumers());
});

test('负控：软底上把前景改回基色时必须判红', () => {
  const sources = readConsumers();
  const f = 'pages/publish/temp/index.wxss';
  sources[f] = sources[f].replace(
    'background: var(--cy-brand-soft); color: var(--cy-color-brand-strong);',
    'background: var(--cy-brand-soft); color: var(--cy-brand);'
  );
  assert.throws(() => assertSoftBackgroundUsesStrong(sources), assert.AssertionError,
    '把 .cg-hint-emoji 的前景改回基色后,消费方闸没有判红');
});

test('负控：软底上的 -strong 档被换成过不了 AA 的浅灰时必须判红', () => {
  const theme = tokenTheme();
  const broken = { ...theme, '--cy-color-brand-strong': '#8A8A8A' };
  assert.throws(() => assertContrast(broken), assert.AssertionError,
    'brand-strong 换成浅灰后,软底对比度契约没有判红');
});

test('负控：删掉 text alias 桥接时契约必须判红', () => {
  const mutated = read().replace(/\s*--cy-text-title\s*:\s*var\(--cy-color-text-primary\);/, '');
  assert.throws(() => assertBridge(mutated), /--cy-text-title/);
});

test('负控：状态色被压回正文色时必须判红', () => {
  const flattened = { ...tokenTheme(), '--cy-color-status-success': tokenTheme()['--cy-color-text-primary'] };
  assert.throws(() => assertNotFlattened(flattened), /--cy-color-status-success/);
});

test('负控：把主蓝换成稿里那支不过 AA 的浅绿时必须判红', () => {
  // #16A36A 是设计稿原值，在白底上只有 3.24:1 —— 契约要能拦住「照抄稿值」这条路。
  const tooLight = { ...tokenTheme(), '--cy-color-status-success': '#16A36A' };
  assert.throws(() => assertContrast(tooLight), /--cy-color-status-success/);
});

test('负控：快照漂移时必须判红', () => {
  const drifted = { ...pageTheme(), '--cy-color-brand': '#123456' };
  assert.throws(() => assertSnapshotSynced(drifted, tokenTheme()), /--cy-color-brand 快照漂移/);
});
