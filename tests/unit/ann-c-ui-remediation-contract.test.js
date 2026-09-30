const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function stripComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function cssRule(source, selectorPattern, label) {
  const match = new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`).exec(stripComments(source));
  assert.ok(match, `${label}:缺少目标样式规则`);
  return match[1];
}

test('C29:全屏报名页把状态栏露底与导航标题锁在浅色页表面', () => {
  const wxml = read('pages/topic/merchantapply/index.wxml');
  const fullSheet = /<cy-sheet[\s\S]*?variant="full"[\s\S]*?>/.exec(wxml);
  assert.ok(fullSheet, 'C29:缺少主全屏 cy-sheet');
  assert.match(fullSheet[0], /show="\{\{true\}\}"/, 'C29:该表面契约只适用于常驻 full sheet');
  assert.match(
    fullSheet[0],
    /style="[^"]*--cy-color-overlay:\s*var\(--cy-comp-sheet-bg\)[^"]*"/,
    'C29:常驻 full sheet 的外露状态栏区域必须与 sheet 表面同色'
  );
  assert.match(
    fullSheet[0],
    /style="[^"]*--cy-text-title:\s*var\(--cy-color-text-primary\)[^"]*"/,
    'C29:导航标题必须继承浅色页正文主色'
  );
});

test('C40:Strava 分段进度在标题上方，未到步骤为灰色实心', () => {
  const wxml = stripComments(read('pages/club/create/index.wxml'));
  const wxss = read('pages/club/create/index.wxss');
  // 不钉死 class 尾部:形变期间进度条会叠一个 prog--ghost。本条要保的是
  // 「进度条在标题上方」,不是「不许再加类」。
  const progressAt = wxml.search(/class="cc-progress[^"]*"/);
  // 不钉死 class 尾部:标题后来叠了进场动效类(cy-rise-in),
  // 本条要保的是「进度条在标题上方」,不是「标题不许再加类」。
  const titleAt = wxml.search(/class="cc-q cy-h1[^"]*"/);
  assert.ok(progressAt >= 0 && titleAt >= 0, 'C40:标题和进度条都必须存在');
  assert.ok(progressAt < titleAt, 'C40:参考形态要求分段进度位于问题标题上方');

  // 2026-09-02 Figma 32:13:未到段绑的是 action/secondary-bg(不再是 text-disabled),
  // 但"必须是可见实心、不能退回透明描边"这条约束原样保留。
  const segment = cssRule(wxss, '\\.cc-progress \\.cc-seg', 'C40 未到步骤');
  assert.match(segment, /background:\s*var\(--cy-color-action-secondary-bg\)/, 'C40:未到步骤必须是可见的弱实心段');
  assert.doesNotMatch(segment, /background:\s*transparent/, 'C40:不得退回透明描边段');
  assert.match(segment, /border:\s*0/, 'C40:参考图不是空心描边进度');
  const activeSegment = cssRule(wxss, '\\.cc-seg\\.active, \\.cc-seg\\.done', 'C40 当前与已完成步骤');
  assert.match(activeSegment, /background:\s*var\(--cy-color-text-primary\)/, 'C40:当前与已完成步骤必须保持白色实心段');
});
