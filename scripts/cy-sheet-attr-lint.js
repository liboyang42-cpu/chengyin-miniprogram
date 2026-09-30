#!/usr/bin/env node
'use strict';

/**
 * cy-sheet 属性契约门禁:全站扫描所有 <cy-sheet ...> 调用点，核对调用方写的每个
 * 属性都在 components/cy/sheet/index.js 的 properties 表里声明过。
 *
 * 背景(2026-07-31):coop-withdraw-sheet 曾经往 <cy-sheet> 传 dirty/footer，但那支
 * 分支上的 cy-sheet 组件版本还没有这两个字段——WXML 传未声明的 attribute 会被
 * 静默丢弃(不报错、不警告)，后果是脏态保护完全失效，填了金额点遮罩会静默丢用户
 * 输入。这类 bug 光靠人读 diff 或跑单个组件的单测都测不出来，因为失效在"跨组件
 * 属性传递"这一层，本门禁专门盯这一层，全站扫，不止盯某一个调用方。
 *
 * 用法：node scripts/cy-sheet-attr-lint.js            全仓扫描
 *       node scripts/cy-sheet-attr-lint.js --selftest  自证(能判红也能判绿)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHEET_JS_PATH = path.join(ROOT, 'components/cy/sheet/index.js');

const DIRECTIVE_OR_EVENT_PREFIXES = ['wx:', 'bind:', 'bind', 'catch:', 'catch', 'mut-bind:', 'capture-bind:', 'capture-catch:'];
function isDirectiveOrEvent(name) {
  // data-* 是 WXML 平台级通用属性(落进 e.currentTarget.dataset),不是组件 property,
  // 任何组件不声明也天然支持,不能算未声明属性。
  // aria-* 和 data-* 同类:是 WXML 平台级属性,会落到组件的宿主节点上,
  // 任何组件不声明也天然支持,不算未声明属性。
  // (2026-08-28 泛化到全部 98 个组件时才暴露出来 —— 只盯 cy-sheet 时它一次都没出现过。)
  return DIRECTIVE_OR_EVENT_PREFIXES.some((p) => name.startsWith(p)) || name.startsWith('data-')
    || name.startsWith('aria-')
    // ds-ok="理由" 是全仓通行的门禁豁免注记(a11y-tap-target-lint.js:266 读它),
    // 写在任意 wxml 元素上,不是某个组件的属性。
    || name === 'ds-ok'
    || name === 'id' || name === 'class' || name === 'style' || name === 'slot' || name === 'generic:sheet-content';
}

// WXML 属性名是 kebab-case,组件 properties 声明是 camelCase,框架会自动转换
// (reduced-motion → reducedMotion)。比较前统一转成 camelCase 再查表。
function toCamelCase(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function lineNumber(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

// 从一段含 `properties: { ... }` 的组件/behavior 源码里提取声明的字段名。用配对括号
// 计数找 properties 值的真实结束位置(而不是靠"两格缩进换行"这种格式假设)，因为
// behaviors 文件不一定和组件主文件同一种排版(单行/多行都可能)。
function extractPropertiesBlock(src) {
  const startMatch = /properties:\s*\{/.exec(src);
  if (!startMatch) return [];
  const bodyStart = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  for (; i < src.length && depth > 0; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  const body = src.slice(bodyStart, i - 1);
  const keys = [];
  // ⚠️ 属性名可以含数字/下划线/$(如 playkit-steps 的 co2Label)。老正则是 [a-zA-Z]+,
  // 遇到 `co2Label:` 会从中间截出 `Label`,于是真正声明过的 co2Label 反被判成"未声明"。
  // 2026-08-28 泛化到全部组件时才暴露 —— cy-sheet 的属性名恰好全是纯字母。
  const re = /(?:^|[\s,{])([A-Za-z_$][\w$]*):\s*\{\s*type:/g;
  let mm;
  while ((mm = re.exec(body))) keys.push(mm[1]);
  return keys;
}

// cy-sheet 除了自己声明的 properties,还可能通过 behaviors:[...] 混入别的 property
// (例如 reducedMotionBehavior 贡献了 reducedMotion)。只查组件自身的 properties 块会
// 把这类字段误判成"未声明",这里把两处来源的字段名合并成一张完整表。
function extractSheetProps(src, componentDir, minOwn = 5) {
  const own = extractPropertiesBlock(src);
  if (own.length < minOwn) throw new Error('properties 解析出来的字段太少，正则大概率没对上真实写法');

  const behaviorProps = [];
  const behaviorsMatch = /behaviors:\s*\[([\s\S]*?)\]/.exec(src);
  if (behaviorsMatch && componentDir) {
    // behaviors: [xxxBehavior] 通常引用的是文件顶部 `const xxxBehavior = require(...)`
    // 声明的变量，不是 inline require()——先取数组里的变量名，再回到整份源码找它的
    // require() 赋值（同时兼容 behaviors: [require('./x.js')] 这种少见的 inline 写法）。
    // behaviors 数组里的元素可能是裸变量(reducedMotionBehavior)也可能是工厂调用
    // (exitMotion(220)、morphEntrance({ shellSelector: '.sh__panel' }))。工厂调用的实参里
    // 还可能带逗号,按逗号切会把它切碎——所以直接在整段数组体里扫标识符,再和文件顶部
    // 的 require 声明取交集:只有"既在 behaviors 里出现过、又是 require 来的"才算。
    const mentioned = new Set(behaviorsMatch[1].match(/[A-Za-z_$][\w$]*/g) || []);
    const varNames = Array.from(mentioned).filter((s) => s !== 'require');
    const requireTargets = [];
    varNames.forEach((name) => {
      const declRe = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*require\\((['"])([^'"]+)\\1\\)`);
      const dm = declRe.exec(src);
      if (dm) requireTargets.push(dm[2]);
    });
    const inlineRe = /require\((['"])([^'"]+)\1\)/g;
    let im;
    while ((im = inlineRe.exec(behaviorsMatch[1]))) requireTargets.push(im[2]);

    requireTargets.forEach((rel) => {
      const behaviorPath = path.resolve(componentDir, rel);
      const resolved = fs.existsSync(behaviorPath) ? behaviorPath
        : fs.existsSync(behaviorPath + '.js') ? behaviorPath + '.js' : null;
      if (resolved) behaviorProps.push(...extractPropertiesBlock(fs.readFileSync(resolved, 'utf8')));
    });
  }
  return own.concat(behaviorProps);
}

// 在一段 wxml 源码里找出所有 <cy-sheet ...> 标签(自闭合或不闭合都算)，返回 {line, attrs}。
// 属性值可能含 wx:if="{{a > b}}" 这类内嵌 > 的表达式，逐字符找引号配对确定标签真正的结束位置，
// 不能简单 indexOf('>')。
function findComponentTags(source, tagName) {
  const open = '<' + tagName;
  const tags = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(open, cursor);
    if (start === -1) break;
    // 排除 <cy-sheet-xxx> 这类前缀相同但其实是别的组件名
    const afterTag = source[start + open.length];
    if (afterTag && !/[\s/>]/.test(afterTag)) { cursor = start + 1; continue; }

    let quote = null;
    let end = start + 1;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (quote) {
        if (ch === quote && source[end - 1] !== '\\') quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
    }
    if (end >= source.length) break;
    const raw = source.slice(start, end + 1);
    const attrBody = raw.slice(open.length, raw.endsWith('/>') ? raw.length - 2 : raw.length - 1);
    // ⚠️ 不能直接对整段 attrBody 跑 /([\w:-]+)=/ —— 属性**值**里的等号会被当成属性名。
    // 2026-08-28 泛化到全部组件时实测踩到:
    //   wx:elif="{{curError && events.length===0}}"  →  抓出一个不存在的属性 "length"
    //   wx:if="{{index==chapterPick.cur}}"           →  抓出 "index"
    // 只盯 cy-sheet 时这个 bug 一直没暴露(它的调用点恰好没有这种表达式)。
    // 正确做法:逐字符扫,只在**引号之外**收集 name= 形式的属性名。
    const attrNames = [];
    {
      let q = null;
      let token = '';
      for (let i = 0; i < attrBody.length; i += 1) {
        const ch = attrBody[i];
        if (q) { if (ch === q && attrBody[i - 1] !== '\\') q = null; continue; }
        if (ch === '"' || ch === "'") { q = ch; token = ''; continue; }
        if (ch === '=') { if (token) attrNames.push(token); token = ''; continue; }
        if (/[\w:-]/.test(ch)) token += ch; else token = '';
      }
    }
    tags.push({ line: lineNumber(source, start), attrs: attrNames });
    cursor = end + 1;
  }
  return tags;
}

const findCySheetTags = (source) => findComponentTags(source, 'cy-sheet');

function walkWxmlFiles(directory) {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'miniprogram_npm' || entry.name.startsWith('.')) return;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkWxmlFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.wxml')) files.push(target);
  });
  return files;
}

// 核心检查:给定 cy-sheet 声明的属性表 + 一批 (file, tags)，返回所有"调用方传了
// cy-sheet 不认识的属性"的命中,带 file:line:attr。
function findViolations(sheetProps, fileTagPairs) {
  const violations = [];
  fileTagPairs.forEach(({ file, tags }) => {
    tags.forEach(({ line, attrs }) => {
      attrs.filter((a) => !isDirectiveOrEvent(a)).forEach((attr) => {
        if (!sheetProps.includes(toCamelCase(attr))) {
          violations.push({ file, line, attr });
        }
      });
    });
  });
  return violations;
}

function lintRepo() {
  const sheetProps = extractSheetProps(fs.readFileSync(SHEET_JS_PATH, 'utf8'), path.dirname(SHEET_JS_PATH));
  const fileTagPairs = walkWxmlFiles(ROOT)
    .map((file) => ({ file, tags: findCySheetTags(fs.readFileSync(file, 'utf8')) }))
    .filter((p) => p.tags.length > 0);
  return { sheetProps, violations: findViolations(sheetProps, fileTagPairs), callSiteCount: fileTagPairs.reduce((n, p) => n + p.tags.length, 0) };
}

function runSelfTest() {
  const fakeProps = ['show', 'title', 'closable', 'maskClosable', 'variant', 'footer', 'dirty', 'reducedMotion'];
  // 红:合成一个真实不存在的属性,必须被判成命中
  const badTags = findCySheetTags('<cy-sheet show="{{x}}" totallyUnknownAttr="{{y}}"></cy-sheet>');
  const badViolations = findViolations(fakeProps, [{ file: 'fixture-bad.wxml', tags: badTags }]);
  // 绿:全部属性都在声明表里(含 wx:if / bind:close 这类应当被放行的非 property、
  // data-* 平台通用属性、以及 kebab-case → camelCase 的 reduced-motion),不能误报
  const goodTags = findCySheetTags('<cy-sheet wx:if="{{x > 1}}" show="{{x}}" dirty="{{y}}" footer="{{true}}" reduced-motion="{{r}}" data-foo="{{1}}" bind:close="onClose" bind:requestclose="onReq"></cy-sheet>');
  const goodViolations = findViolations(fakeProps, [{ file: 'fixture-good.wxml', tags: goodTags }]);

  // extractSheetProps 的 behaviors 合并逻辑:合成一个 index.js + 一个 behavior 文件,
  // 断言 behavior 里声明的字段真的被并进最终的属性表
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cy-sheet-selftest-'));
  fs.writeFileSync(path.join(tmpDir, 'behavior.js'), "module.exports = Behavior({ properties: { fromBehavior: { type: Boolean, value: false } } })\n");
  // 工厂式 behavior(morphEntrance({...}) 就是这种写法):2026-08-28 实测老解析器按逗号切
  // 数组,把 `f({ shellSelector: '.x', deep: { a: 1 } })` 切碎后匹配不到 require,导致
  // anchorSelector 被误判成"未声明",把 PR #875 判红。这条负控钉死这个形态。
  fs.writeFileSync(path.join(tmpDir, 'factory.js'), "module.exports = () => Behavior({ properties: { fromFactory: { type: String, value: '' } } })\n");
  const fakeComponentSrc = [
    "const b = require('./behavior.js')",
    "const f = require('./factory.js')",
    'Component({',
    '  behaviors: [b, f({ shellSelector: \'.x\', deep: { a: 1 } })],',
    '  properties: {',
    '    show: { type: Boolean, value: false },',
    '    title: { type: String, value: \'\' },',
    '    closable: { type: Boolean, value: true },',
    '    maskClosable: { type: Boolean, value: true },',
    '    variant: { type: String, value: \'bottom\' },',
    '  },',
    '})',
    '',
  ].join('\n');
  const mergedProps = extractSheetProps(fakeComponentSrc, tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const ok = badViolations.length === 1 && badViolations[0].attr === 'totallyUnknownAttr' && badViolations[0].line === 1
    && goodViolations.length === 0
    && mergedProps.includes('fromBehavior')
    && mergedProps.includes('fromFactory');
  if (!ok) {
    console.error('cy-sheet 属性契约门禁:自证失败', JSON.stringify({ badViolations, goodViolations, mergedProps }));
    process.exit(1);
  }
  console.log('cy-sheet 属性契约门禁:自证通过(能判红也能判绿、认得 kebab-case/data-*/behavior 混入属性(含工厂式 behavior),且能定位到行号)');
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
  } else {
    const { violations, callSiteCount } = lintRepo();
    console.log(`扫描到 ${callSiteCount} 处 <cy-sheet> 调用`);
    if (violations.length) {
      violations.forEach((v) => {
        console.error(`${path.relative(process.cwd(), v.file)}:${v.line} 传了 cy-sheet 未声明的属性 "${v.attr}"（会被静默丢弃,不报错不警告）`);
      });
      console.error(`共 ${violations.length} 处`);
      process.exit(1);
    }
    console.log('cy-sheet 属性契约门禁:通过');
  }
}

module.exports = { extractSheetProps, findCySheetTags, findComponentTags, findViolations, lintRepo,
  walkWxmlFiles, isDirectiveOrEvent, toCamelCase };
