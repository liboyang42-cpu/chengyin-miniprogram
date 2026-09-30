#!/usr/bin/env node
'use strict';

/**
 * U2 死链按钮门禁:全站扫描 wxml 里的 bind-/catch- 系事件绑定(含 bind:xxx 冒号写法、capture- 前缀、
 * 组件自定义事件 bind:custom),核对同名方法是否真的在同目录 js 的 Page()/Component() 定义里存在
 * (含 behaviors 混入)。抓的是「**点了真的没反应**」。
 *
 * 背景(2026-07-31):pages/coop/list/index.wxml 有 3 处 bindtap="goInvite" /
 * bindcta="goInvite",但 index.js 里从没定义过 goInvite——点击零报错、零反应。
 * 追出根因是某次 chore 提交(34b6895c4)整体覆盖了这个文件,把方法定义覆盖没了但
 * wxml 绑定原样留着。这类"绑定还在、方法已经不在了"的静默失效,人读 diff 很难扫出来
 * (两个文件分开看都各自"正常"),只有跨文件核对才测得出来。
 *
 * 2026-08-18:解析层搬进 scripts/lib/xcx-scan.js 与 U3/U4 共用,本文件只剩判据 + 自证。
 *
 * 覆盖范围(取舍写在这,别猜):
 *  - 事件形态:正则是 (capture-)?(bind|catch)(:)?事件名,**不枚举事件名**,所以 bindtap /
 *    bind:tap / catchtap / catch:tap / bindchange / bindconfirm / bindinput / bindload /
 *    capture-bind:touchstart / 自定义组件的 bind:whatever-evt 一律覆盖。枚举白名单必然
 *    追不上自定义事件,所以反过来做。
 *  - <template>:本仓 3 处 <template name=...> 全部定义在使用它的同一个 wxml 里,且全仓
 *    零 <import>,所以模板里的绑定天然跟着宿主页面的 js 核对,不需要额外的 import 解析。
 *    (真出现跨文件 <import> 时这条会退化成漏报,不是误报——那天再加。)
 *  - wx:for 作用域:事件绑定值是纯方法名,不受循环作用域影响;data-* 传参只影响回调收到的
 *    e.currentTarget.dataset,不影响"方法在不在",所以这两件事都不用管。
 *  - 动态绑定 bindtap="{{expr}}":静态判不了,逐条进 skipped 列表,不静默放过也不误报。
 *
 * 用法:node scripts/wxml-handler-lint.js            全仓扫描
 *       node scripts/wxml-handler-lint.js --selftest  自证(能判红也能判绿)
 */
const fs = require('fs');
const path = require('path');
const S = require('./lib/xcx-scan.js');

const BASELINE = path.join(__dirname, 'baselines', 'u2-dead-binding.json');

function lintRepo(root) {
  const { map, orphanWxml, wxmlFiles } = S.buildJsToWxmlMap(root);
  const jsHandlerCache = new Map();
  const violations = [];
  const skipped = [];
  let checkedBindingCount = 0;

  orphanWxml.forEach((f) => {
    const bindings = S.findEventBindings(fs.readFileSync(f, 'utf8'));
    if (bindings.length) skipped.push({ file: f, line: null, reason: '找不到同目录 js(也不是任何 <include> 的目标),跳过校验' });
  });

  [...map.entries()].forEach(([jsFile, owned]) => {
    if (!jsHandlerCache.has(jsFile)) jsHandlerCache.set(jsFile, new Set(S.extractHandlerNames(jsFile)));
    const handlerSet = jsHandlerCache.get(jsFile);
    owned.forEach((wxmlFile) => {
      S.findEventBindings(fs.readFileSync(wxmlFile, 'utf8')).forEach(({ attrName, value, line }) => {
        const cls = S.classifyBinding(value);
        if (cls.kind === 'identifier') {
          checkedBindingCount += 1;
          if (!handlerSet.has(cls.name)) violations.push({ file: wxmlFile, line, attrName, handler: cls.name, jsFile });
        } else if (cls.kind === 'expression' || cls.kind === 'unrecognized') {
          skipped.push({ file: wxmlFile, line, reason: `${attrName}="${value}" 不是纯标识符(动态/表达式绑定),静态门禁跳过,不代表已核实` });
        }
        // kind === 'empty':没写值,不是真绑定,不计入检查也不计入 skip 噪音
      });
    });
  });

  return { violations, skipped, checkedBindingCount, noCompanionJsCount: orphanWxml.length, wxmlFileCount: wxmlFiles.length };
}

const keyOf = (v) => `${S.rel(v.file)}::${v.handler}`;

// ---------- 自证 ----------
function runSelfTest() {
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u2-selftest-'));
  const handlersOf = (src) => new Set(S.ownHandlerEntries(S.maskNonCode(src)).map((k) => k.name));

  // 红:wxml 绑了一个 js 里不存在的方法,必须命中且带对的行号
  const badWxml = '<view></view>\n<button bindtap="ghostHandler">x</button>\n<view bind:close="onClose"></view>';
  const badBindings = S.findEventBindings(badWxml);
  const badHandlers = handlersOf("Page({\n  data: { a: 1 },\n  onClose() {},\n})\n");
  const badViolations = badBindings.filter((b) => {
    const cls = S.classifyBinding(b.value);
    return cls.kind === 'identifier' && !badHandlers.has(cls.name);
  });

  // 绿:同样的 wxml,js 里把 ghostHandler 也定义上,不能再命中
  const goodHandlers = handlersOf("Page({\n  data: { a: 1 },\n  onClose() {},\n  ghostHandler() {},\n})\n");
  const goodViolations = badBindings.filter((b) => {
    const cls = S.classifyBinding(b.value);
    return cls.kind === 'identifier' && !goodHandlers.has(cls.name);
  });

  // Component + behaviors 混入:methods:{} 块 + behavior require 解析
  fs.writeFileSync(path.join(tmpDir, 'my-behavior.js'), "module.exports = Behavior({ methods: { fromBehavior() {} } })\n");
  const compFile = path.join(tmpDir, 'index.js');
  fs.writeFileSync(compFile, [
    "const b = require('./my-behavior.js')",
    'Component({',
    '  behaviors: [b],',
    '  data: { x: 1 },',
    '  methods: {',
    '    onTap() {},',
    '    _private(a, b) { return a + b; },',
    '  },',
    '})',
    '',
  ].join('\n'));
  const compHandlers = new Set(S.extractHandlerNames(compFile));

  // 表达式绑定必须进 skipped、不能进 violations(静默忽略=有洞)
  const exprCls = S.classifyBinding(S.findEventBindings('<button bindtap="{{cond ? a : b}}">x</button>')[0].value);

  // kebab-case 自定义事件 bind:custom-evt="fn" 也要能抓到属性、拿到 value 里的方法名
  const customEvtBindings = S.findEventBindings('<cy-sheet bind:custom-evt="onCustomEvt"></cy-sheet>');

  // 注释里的绑定不算数(2026-08-01 实证的误报),且注释不能把后面真绑定的行号带偏
  const commentBindings = S.findEventBindings([
    '<view>',
    '  <!-- <button bindtap="ghostInComment">x</button> -->',
    '  <button bindtap="realHandler">y</button>',
    '</view>',
  ].join('\n'));

  // ★ \b 陷阱:方法名前缀相同不算已定义。js 里只有 onTapExtra,wxml 绑的是 onTap,
  //   任何 /\bonTap\b/ 之类的"包含式"匹配都会在这里假绿。必须全等比对才判得红。
  const prefixHandlers = handlersOf('Page({ onTapExtra() {} })');
  const prefixBindings = S.findEventBindings('<view bindtap="onTap"></view>');
  const prefixViolations = prefixBindings.filter((b) => !prefixHandlers.has(S.classifyBinding(b.value).name));
  // 反向:js 里有 onTap,wxml 绑 onTapExtra,同样必须红
  const prefixHandlers2 = handlersOf('Page({ onTap() {} })');
  const prefixViolations2 = S.findEventBindings('<view bindtap="onTapExtra"></view>')
    .filter((b) => !prefixHandlers2.has(S.classifyBinding(b.value).name));

  // ★ \b 陷阱(连字符版):标签/类名里带连字符的 detail-cta-bar 绝不能被当成绑定 detail
  const hyphenBindings = S.findEventBindings('<detail-cta-bar class="detail-cta-bar" bindtap="onDetailCta"></detail-cta-bar>');

  fs.rmSync(tmpDir, { recursive: true, force: true });

  const checks = {
    '红:wxml 绑了不存在的方法': badViolations.length === 1 && badViolations[0].value === 'ghostHandler' && badViolations[0].line === 2,
    '绿:方法补上后不再命中': goodViolations.length === 0,
    'Component/methods/behaviors 混入': compHandlers.has('onTap') && compHandlers.has('_private') && compHandlers.has('fromBehavior'),
    '表达式绑定归 skip 不归 violation': exprCls.kind === 'expression',
    'bind:custom-evt 冒号+连字符事件名': customEvtBindings.length === 1 && customEvtBindings[0].value === 'onCustomEvt' && customEvtBindings[0].attrName === 'bind:custom-evt',
    '注释里的绑定不算数且不带偏行号': commentBindings.length === 1 && commentBindings[0].value === 'realHandler' && commentBindings[0].line === 3,
    '\\b 陷阱:onTapExtra 不能顶替 onTap': prefixViolations.length === 1 && prefixViolations2.length === 1,
    '\\b 陷阱:detail-cta-bar 不会被当成绑定值': hyphenBindings.length === 1 && hyphenBindings[0].value === 'onDetailCta',
    '棘轮:新增判红 / 存量放行 / 基线缺失不豁免': S.selfTestRatchet(),
  };
  const failed = Object.keys(checks).filter((k) => !checks[k]);
  if (failed.length) {
    console.error('U2 死链按钮门禁:自证失败 ->', failed.join(' / '));
    console.error(JSON.stringify({ badViolations, goodViolations, compHandlers: [...compHandlers], exprCls, customEvtBindings, commentBindings, prefixViolations, prefixViolations2, hyphenBindings }, null, 2));
    process.exit(1);
  }
  console.log(`U2 死链按钮门禁:自证通过(${Object.keys(checks).length} 项,含能判红能判绿、behaviors 混入、注释、两条 \\b 陷阱负控)`);
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
  } else {
    const { violations, skipped, checkedBindingCount, noCompanionJsCount, wxmlFileCount } = lintRepo();
    if (process.argv.includes('--update-baseline')) {
      S.writeBaseline(BASELINE, violations.map(keyOf), 'U2 死链绑定存量。只能变小不能变大;修完一条就重跑 --update-baseline。');
      console.log(`U2:已写入基线 ${violations.length} 条 -> ${S.rel(BASELINE)}`);
      process.exit(0);
    }
    const baseline = S.loadBaseline(BASELINE);
    console.log(`U2 死链绑定:扫描 ${wxmlFileCount} 个 wxml,核对 ${checkedBindingCount} 处纯标识符事件绑定,存量基线 ${baseline.size} 条`);
    if (skipped.length) {
      console.log(`跳过 ${skipped.length} 处(动态/表达式绑定或找不到同伴 js,逐条列出,不静默):`);
      skipped.forEach((s) => console.log(`  ${S.rel(s.file)}${s.line ? ':' + s.line : ''} ${s.reason}`));
    }
    if (noCompanionJsCount) console.log(`(其中 ${noCompanionJsCount} 个 wxml 文件本身没有可核对的 js,已计入上面 skip 明细)`);

    const fresh = violations.filter((v) => !baseline.has(keyOf(v)));
    const stillThere = new Set(violations.map(keyOf));
    const stale = [...baseline].filter((k) => !stillThere.has(k));
    if (stale.length) console.log(`提示:基线里 ${stale.length} 条已经不存在了(修好了),跑 --update-baseline 收窄基线`);
    if (fresh.length) {
      fresh.forEach((v) => {
        console.error(`${S.rel(v.file)}:${v.line} ${v.attrName}="${v.handler}",但 ${S.rel(v.jsFile)} 里没有定义 ${v.handler}(点击零反应、零报错)`);
      });
      console.error(`U2 门禁不通过:新增 ${fresh.length} 处死链绑定`);
      process.exit(1);
    }
    console.log(`U2 死链按钮门禁:通过(存量 ${violations.length} 条已在基线内,未新增)`);
  }
}

module.exports = { lintRepo, keyOf };
