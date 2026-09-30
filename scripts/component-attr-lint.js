#!/usr/bin/env node
'use strict';

/**
 * 全组件属性契约门禁 —— cy-sheet-attr-lint.js 的推广版。
 *
 * ★ 为什么要有这个(2026-08-28 上线前全量审核 A5 抓出来的系统性盲区)
 *
 *   WXML 给组件传一个它没声明的属性,会被**静默丢弃**:不报错、不警告、编译照过。
 *   仓库原本只有 `cy-sheet-attr-lint.js` 盯这件事,而它**只盯 cy-sheet 一个组件**。
 *   A5 全量解析 2,460 个 cy 组件实例,在其余 97 个组件上找出 28 个未声明属性,
 *   而当时的门禁照样 PASS —— 也就是说这道契约保护的覆盖率是 1/98。
 *
 *   典型后果(都不是样式目测,是确定性契约错误):
 *     · <cy-switch accessibilityLabel="..."> —— 组件没声明,读屏拿不到调用方给的名字
 *     · <cy-card hover-class="cy-pressed"> —— 组件不透传,调用方以为有的按压反馈根本不存在
 *     · <cy-skeleton rows="9"> —— 组件没这个属性,行数控制被静默忽略
 *
 * 用法:
 *   node scripts/component-attr-lint.js             全仓扫描(所有 cy/** 组件)
 *   node scripts/component-attr-lint.js --list      连同"已豁免"一起列出来
 *   node scripts/component-attr-lint.js --selftest  自证(能判红也能判绿)
 */
const fs = require('fs');
const path = require('path');
const shared = require('./cy-sheet-attr-lint.js');

const ROOT = path.resolve(__dirname, '..');
const COMPONENTS_DIR = path.join(ROOT, 'components/cy');

/**
 * 豁免表:属性确实没声明,但**已核实不构成缺陷**。每条都要写清楚为什么,
 * 空着理由的条目一律当成没豁免。
 * ⚠️ 豁免的是「组件+属性」这一对,不是整个组件 —— 别拿它当万能开关。
 */
const ALLOW = [
  // 组件内部自带按压态处理(自己的根节点上已有 hover-class),调用点再传一份是冗余,
  // 不会造成"用户以为有反馈其实没有"。留着不改是为了不动 14 个调用点的无关 diff。
  { tag: 'cy-avatar', attr: 'hover-class', why: '组件内部已自带按压处理,调用点冗余传入' },
  { tag: 'cy-avatar', attr: 'hover-stay-time', why: '同上' },
  { tag: 'cy-club-card', attr: 'hover-class', why: '组件内部已自带按压处理,调用点冗余传入' },
  { tag: 'cy-club-card', attr: 'hover-stay-time', why: '同上' },
  // cy-dropdown 本身就是 selector 实现,mode="selector" 是同义重复,当前行为不受影响。
  { tag: 'cy-dropdown', attr: 'mode', why: '组件本身即 selector 实现,该值与现行为一致' },
];
const isAllowed = (tag, attr) => ALLOW.some((a) => a.tag === tag && a.attr === attr);

// components/cy/<name>/index.js → 标签名 cy-<name>
function discoverComponents() {
  if (!fs.existsSync(COMPONENTS_DIR)) return [];
  return fs.readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ tag: 'cy-' + e.name, dir: path.join(COMPONENTS_DIR, e.name) }))
    .filter((c) => fs.existsSync(path.join(c.dir, 'index.js')));
}

function propsOf(component) {
  const src = fs.readFileSync(path.join(component.dir, 'index.js'), 'utf8');
  // minOwn=0:很多组件本来就只声明一两个属性,不能套 cy-sheet 那个"少于 5 个就是正则没对上"的判据。
  return shared.extractSheetProps(src, component.dir, 0);
}

function lintAll() {
  const components = discoverComponents();
  const wxmlFiles = shared.walkWxmlFiles(ROOT);
  const sources = wxmlFiles.map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));

  const violations = [];
  const allowed = [];
  let instanceCount = 0;

  components.forEach((component) => {
    const declared = propsOf(component);
    sources.forEach(({ file, source }) => {
      if (!source.includes('<' + component.tag)) return;
      shared.findComponentTags(source, component.tag).forEach(({ line, attrs }) => {
        instanceCount += 1;
        attrs.filter((a) => !shared.isDirectiveOrEvent(a)).forEach((attr) => {
          if (declared.includes(shared.toCamelCase(attr))) return;
          const hit = { file: path.relative(ROOT, file), line, tag: component.tag, attr };
          if (isAllowed(component.tag, attr)) allowed.push(hit); else violations.push(hit);
        });
      });
    });
  });
  return { components, instanceCount, violations, allowed };
}

function runSelfTest() {
  // 正控:真实仓库里 cy-sheet 的合法调用不能被判红(它有 behavior 混入属性,最容易误报)
  const real = lintAll();
  const sheetFalsePositives = real.violations.filter((v) => v.tag === 'cy-sheet');

  // 负控:临时造一个组件 + 一个传了未声明属性的调用点,必须被抓到
  const tmpComponent = path.join(COMPONENTS_DIR, '__selftest_probe__');
  const tmpWxml = path.join(ROOT, '__selftest_probe__.wxml');
  let redCaught = false;
  let greenAfterRestore = false;
  try {
    fs.mkdirSync(tmpComponent, { recursive: true });
    fs.writeFileSync(path.join(tmpComponent, 'index.js'),
      'Component({ properties: { declaredOne: { type: String, value: \'\' } } })\n');
    fs.writeFileSync(tmpWxml,
      '<cy-__selftest_probe__ declared-one="a" definitely-missing-attr="b" wx:if="{{x}}" data-k="1" bind:tap="t" />\n');
    const red = lintAll();
    const hits = red.violations.filter((v) => v.tag === 'cy-__selftest_probe__');
    redCaught = hits.length === 1 && hits[0].attr === 'definitely-missing-attr';

    // 把违规属性去掉后必须复绿(证明它不是见谁都判红)
    fs.writeFileSync(tmpWxml, '<cy-__selftest_probe__ declared-one="a" wx:if="{{x}}" />\n');
    const green = lintAll();
    greenAfterRestore = green.violations.filter((v) => v.tag === 'cy-__selftest_probe__').length === 0;
  } finally {
    fs.rmSync(tmpComponent, { recursive: true, force: true });
    fs.rmSync(tmpWxml, { force: true });
  }

  const ok = redCaught && greenAfterRestore && sheetFalsePositives.length === 0;
  if (!ok) {
    console.error('全组件属性契约门禁:自证失败', JSON.stringify({ redCaught, greenAfterRestore, sheetFalsePositives }));
    process.exit(1);
  }
  console.log(`全组件属性契约门禁:自证通过(未声明属性判红、去掉后复绿、cy-sheet 的 behavior 混入属性零误报;覆盖 ${real.components.length} 个组件)`);
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) { runSelfTest(); }
  else {
    const { components, instanceCount, violations, allowed } = lintAll();
    console.log(`扫描 ${components.length} 个 cy 组件 / ${instanceCount} 个调用实例`);
    if (process.argv.includes('--list') && allowed.length) {
      console.log(`已豁免 ${allowed.length} 处(理由见 ALLOW 表):`);
      allowed.forEach((v) => console.log(`  - ${v.file}:${v.line} <${v.tag}> ${v.attr}`));
    }
    if (violations.length) {
      violations.forEach((v) => console.log(
        `${v.file}:${v.line} <${v.tag}> 传了未声明的属性 "${v.attr}"（会被静默丢弃,不报错不警告）`));
      console.log(`共 ${violations.length} 处`);
      process.exit(1);
    }
    console.log('全组件属性契约门禁:通过');
  }
}

module.exports = { lintAll, discoverComponents };
