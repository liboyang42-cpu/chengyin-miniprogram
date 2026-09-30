/*
 * 门禁:每个 --cy-comp-* 钩子，浅端块必须也声明一遍。
 *
 *   node tests/unit/theme-comp-hook-parity.test.js
 *
 * 为什么需要：CSS 变量继承能穿透 isolated 组件边界，类选择器不能。
 * comp 钩子定义在 tokens.wxss 的 page{} 里，那层已把值**就地求值成深色快照**
 * 再按值继承；浅端块只重声明语义真值（--cy-color-bg-surface）管不到它。
 * ⇒ 漏一个钩子，浅色页上那个组件就是「文字跟着变深、底色还是黑的」。
 *
 * 2026-08-05 实测：浅端块补了 nav-bg / card-highlight / card-shadow-day / card-border，
 * 唯独漏了 sheet-bg，shezhi 商家视角的选身份弹窗因此是黑底深灰字。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
const tokens = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8');
const light = fs.readFileSync(path.join(ROOT, 'style/merchant-light.wxss'), 'utf8');

// 只管**跟明暗有关**的钩子；纯尺寸/圆角/时长不随主题变，不该要求浅端重声明
const THEME_SENSITIVE = /(bg|fg|border|shadow|highlight|scrim|overlay|mask)/i;

function declaredIn(src, blockRe) {
  const m = blockRe.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = src.indexOf('}', start);
  return new Set([...src.slice(start, end).matchAll(/(--cy-comp-[\w-]+)\s*:/g)].map((x) => x[1]));
}

// page{} 里定义了哪些 comp 钩子
const pageBlock = /(?:^|\n)page\s*\{/.exec(tokens);
const pageEnd = tokens.indexOf('\n}', pageBlock.index);
const inPage = [...tokens.slice(pageBlock.index, pageEnd).matchAll(/(--cy-comp-[\w-]+)\s*:/g)].map((m) => m[1]);
const needed = inPage.filter((k) => THEME_SENSITIVE.test(k));
assert.ok(needed.length > 0, 'page{} 里应该有跟明暗相关的 --cy-comp-* 钩子，一个都没找到说明正则失效了');

const lightBlock = declaredIn(tokens, /\.theme-light[^{]*\{/);
const merchantFile = new Set([...light.matchAll(/(--cy-comp-[\w-]+)\s*:/g)].map((m) => m[1]));

// ★ 棘轮:锁住当前的已知豁免，只对**新增**的钩子判红。
// 一刀切要求「每个 bg/fg 钩子都在浅端重声明」会制造大量假红：
//   - scrim / oncover-fg / cover-scrim 这几个 tokens.wxss 注释明写「主题无关：
//     照片遮罩/渐变/白字，不随明暗切换」，本来就不该重声明；
//   - btn-primary-bg 这类指向的是**别名**，而别名层在浅端块重声明过了，实测显示正常
//     （商家首页的「去报名」就是黑底白字）。
// 真正会坏的是「钩子直接指向 --cy-color-* 语义真值」那种 —— sheet-bg 就是。
// 判不准就别一刀切；先锁住现状，新增钩子必须显式处理（补声明，或加进豁免并写明理由）。
const EXEMPT = new Set([
  // 主题无关:照片装饰层，注释在 tokens.wxss「封面/照片装饰」段
  '--cy-comp-scrim', '--cy-comp-oncover-fg', '--cy-comp-oncover-fg-dim',
  '--cy-comp-cover-scrim', '--cy-comp-scrim-top', '--cy-comp-scrim-top-h',
  // 指向别名层，别名已在浅端块重声明，实测浅色页显示正常
  '--cy-comp-btn-primary-bg', '--cy-comp-btn-primary-fg',
  '--cy-comp-btn-secondary-bg', '--cy-comp-btn-secondary-fg',
  '--cy-comp-card-bg', '--cy-comp-cell-press-bg', '--cy-comp-success-mark-fg',
  // 同 success-mark-fg:填色徽章上的对比前景,徽章底自己是状态色,不随宿主明暗切换
  '--cy-comp-result-mark-fg',
  // 结果面板的 loading 弧:稿子两档同一个紫,不随宿主明暗翻色
  '--cy-comp-result-spinner',
  // crop 是全屏取景器，两端都用同一套深色舞台
  '--cy-comp-crop-stage-bg', '--cy-comp-crop-bar-bg',
  // scene-sheet 已在组件内按 .ss--player/.ss--merchant 显式选择两套字面值；
  // 这些是「主题变体的输入」，不是应随外层 .theme-light 改值的语义别名。
  '--cy-comp-sheet-player-bg', '--cy-comp-sheet-player-border',
  '--cy-comp-sheet-player-border-strong', '--cy-comp-sheet-player-overlay',
  '--cy-comp-sheet-player-close-bg', '--cy-comp-sheet-player-close-fg',
  '--cy-comp-sheet-player-inset-shadow',
  '--cy-comp-sheet-merchant-bg', '--cy-comp-sheet-merchant-border',
  '--cy-comp-sheet-merchant-border-subtle', '--cy-comp-sheet-merchant-border-strong',
  '--cy-comp-sheet-merchant-close-bg', '--cy-comp-sheet-merchant-close-fg',
  '--cy-comp-sheet-merchant-inset-shadow', '--cy-comp-sheet-merchant-overlay',
  '--cy-comp-sheet-invite-border-player', '--cy-comp-sheet-invite-border-merchant',
  '--cy-comp-sheet-invite-missing-bg-player', '--cy-comp-sheet-invite-missing-bg-merchant',
  // 下列值是固定的 Figma 几何/装饰或只在 player 场景消费，不随宿主明暗切换。
  '--cy-comp-sheet-border-width',
  '--cy-comp-sheet-invite-qr-bg', '--cy-comp-sheet-group-bg',
  '--cy-comp-sheet-history-chip-fg', '--cy-comp-sheet-history-date-fg',
  '--cy-comp-sheet-history-dur-fg', '--cy-comp-sheet-history-muted-fg',
  '--cy-comp-sheet-shadow-card', '--cy-comp-sheet-activity-scrim',
  // Roadmap 是 Figma 220:761 的固定白色页面，只在玩家玩法域消费；它不应随宿主主题翻色。
  '--cy-comp-play-roadmap-bg', '--cy-comp-play-roadmap-cta-fg',
]);
const missing = needed.filter((k) => !EXEMPT.has(k)
  && !(lightBlock && lightBlock.has(k)) && !merchantFile.has(k));

if (missing.length) {
  console.error('\n以下 --cy-comp-* 钩子跟明暗有关，但浅端块没有重声明：');
  for (const k of missing) console.error(`  ${k}`);
  console.error('\n补在 style/merchant-light.wxss 与 tokens.wxss 的 .theme-light/.theme-merchant 里。');
  console.error('不补的后果:浅色页上那个组件会「文字跟着变深、底色还是黑的」。见规范真源 §8.5。\n');
}
assert.deepStrictEqual(missing, [], `浅端块漏了 ${missing.length} 个明暗相关的 comp 钩子`);
console.log(`✔ ${needed.length} 个明暗相关的 --cy-comp-* 钩子：${EXEMPT.size} 个已知豁免，其余浅端块都有重声明`);
