process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractSheetProps } = require('../../scripts/cy-sheet-attr-lint.js');
const S = require('../../scripts/lib/xcx-scan.js');

/**
 * cy-page-title 属性契约:全站 <cy-page-title> 调用点传的每个属性,组件必须真的声明过。
 *
 * 背景(2026-08-18,U4 门禁 C 类扫出来的):
 *   pages/coop/nearby/index.wxml 传的是 sub="{{topicName}}",
 *   pages/merchant/citynode/create/index.wxml 传的是 sub="配一个自己店铺的玩法就行…",
 *   但 components/cy/page-title 的副标题属性叫 subtitle(index.js:6)。
 *   WXML 传未声明的 attribute 会被**静默丢弃**——不报错、不警告,副标题就是不显示。
 *   全站另外 12 个调用点写的都是 subtitle,所以错的是这两个调用方不是组件。
 *   混淆源头很可能是 cy-error:它的副标题属性真叫 sub(components/cy/error)。
 *
 * 这条断言盯的是"跨组件属性传递"这一层,和 scripts/cy-sheet-attr-lint.js 同一类,
 * 只是那条门禁写死了只扫 cy-sheet。
 */
const TAG = 'cy-page-title';
const COMPONENT_DIR = path.resolve(__dirname, '../../components/cy/page-title');

// data-* / id / class / style / slot 是 WXML 平台级通用属性,任何组件不声明也天然支持。
const PREFIXES = ['wx:', 'bind:', 'bind', 'catch:', 'catch', 'mut-bind:', 'capture-bind:', 'capture-catch:', 'data-'];
const PLATFORM = new Set(['id', 'class', 'style', 'slot', 'hidden', 'animation']);
function isPlatformAttr(name) {
  return PLATFORM.has(name) || PREFIXES.some((p) => name.startsWith(p));
}

function callSites() {
  const out = [];
  S.walkFiles(S.ROOT, '.wxml').forEach((file) => {
    const src = S.maskWxmlComments(fs.readFileSync(file, 'utf8'));
    S.scanTags(src).filter((t) => t.name === TAG).forEach((t) => {
      const blob = src.slice(t.start, t.end + 1);
      const body = blob
        .slice(('<' + TAG).length)
        .replace(/\/?>$/, ' ')
        .replace(/=\s*"[^"]*"/g, ' ');
      body.split(/\s+/).filter(Boolean).forEach((attr) => {
        out.push({ file, line: S.lineNumber(src, t.start), attr });
      });
    });
  });
  return out;
}

test('cy-page-title 的全部调用点只传组件声明过的属性(传错名字会被静默丢弃)', () => {
  const declared = new Set(
    extractSheetProps(fs.readFileSync(path.join(COMPONENT_DIR, 'index.js'), 'utf8'), COMPONENT_DIR)
  );
  // 先证明属性表真解析出来了,否则下面的断言会因为"表是空的"而恒绿
  assert.ok(declared.has('title') && declared.has('subtitle'), 'properties 解析失败,断言会恒真');

  const sites = callSites();
  assert.ok(sites.length > 20, `只扫到 ${sites.length} 个属性,扫描器大概率没对上真实写法`);

  const bad = sites.filter((s) => !isPlatformAttr(s.attr) && !declared.has(S.kebabToCamel(s.attr)));
  assert.deepEqual(
    bad.map((b) => `${path.relative(S.ROOT, b.file)}:${b.line} ${s2(b.attr)}`),
    [],
    ' 上面这些调用点传了 cy-page-title 没声明的属性,会被框架静默丢弃'
  );
});

function s2(a) { return `"${a}"`; }
