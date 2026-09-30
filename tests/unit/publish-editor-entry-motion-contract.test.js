const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function hasEntryMotion(source, selectors) {
  return selectors.every((selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = source.match(new RegExp(`${escaped}\\s*\\{[^}]*animation:[^;}]+;`, 'm'));
    return Boolean(
      rule
      && /var\(--cy-motion-/.test(rule[0])
      && /\bboth\b/.test(rule[0])
      && !/\binfinite\b/.test(rule[0])
    );
  });
}

function hasReducedMotionContract(jsSource, wxmlSource, wxssSource, modifier) {
  const escaped = modifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return /readReducedMotion\(\)/.test(jsSource)
    && /setData\(\{\s*reducedMotion\s*\}\)/.test(jsSource)
    && new RegExp(`reducedMotion\\s*\\?\\s*'${escaped}'`).test(wxmlSource)
    && new RegExp(`\\.${escaped}[\\s\\S]*animation:\\s*none\\s*!important`).test(wxssSource);
}

test('创建引导、命名与编辑器采用克制的一次性入场动效', () => {
  const introWxss = read('pages/publish/template-intro/index.wxss');
  const namingWxss = read('pages/publish/templateadd/templateadd.wxss');
  const editorWxss = read('pages/publish/temp/index.wxss');

  assert.equal(hasEntryMotion(introWxss, ['.ti-card--0', '.ti-card--1', '.ti-card--2', '.ti-copy', '.ti-cta']), true);
  assert.equal(hasEntryMotion(namingWxss, ['.fbox_sr', '.ta-cta']), true);
  assert.equal(hasEntryMotion(editorWxss, ['.cg-scroll']), true);
});

test('创建链路三页都遵从已保存的减少动态效果偏好', () => {
  const introJs = read('pages/publish/template-intro/index.js');
  const namingJs = read('pages/publish/templateadd/templateadd.js');
  const editorJs = read('pages/publish/temp/index.js');
  const introWxml = read('pages/publish/template-intro/index.wxml');
  const namingWxml = read('pages/publish/templateadd/templateadd.wxml');
  const editorWxml = read('pages/publish/temp/index.wxml');
  const introWxss = read('pages/publish/template-intro/index.wxss');
  const namingWxss = read('pages/publish/templateadd/templateadd.wxss');
  const editorWxss = read('pages/publish/temp/index.wxss');

  assert.equal(hasReducedMotionContract(introJs, introWxml, introWxss, 'ti--reduced-motion'), true);
  assert.equal(hasReducedMotionContract(namingJs, namingWxml, namingWxss, 'ta--reduced-motion'), true);
  assert.equal(hasReducedMotionContract(editorJs, editorWxml, editorWxss, 'cg--reduced-motion'), true);
});

test('负控：减少动态效果的读取、页面挂载或样式兜底任一缺失都必须判红', () => {
  const introJs = read('pages/publish/template-intro/index.js');
  const introWxml = read('pages/publish/template-intro/index.wxml');
  const introWxss = read('pages/publish/template-intro/index.wxss');
  const modifier = 'ti--reduced-motion';

  const withoutPreference = introJs.replace('readReducedMotion()', 'false');
  const withoutModifier = introWxml.replace(modifier, 'ti-motion-enabled');
  const withoutGuard = introWxss.split(`.${modifier}`).join('.ti-motion-enabled');

  assert.notEqual(withoutPreference, introJs, '负控必须真实移除偏好读取');
  assert.notEqual(withoutModifier, introWxml, '负控必须真实移除页面状态 class');
  assert.notEqual(withoutGuard, introWxss, '负控必须真实移除样式兜底');
  assert.equal(hasReducedMotionContract(withoutPreference, introWxml, introWxss, modifier), false);
  assert.equal(hasReducedMotionContract(introJs, withoutModifier, introWxss, modifier), false);
  assert.equal(hasReducedMotionContract(introJs, introWxml, withoutGuard, modifier), false);
});

test('负控：任一入场动效退回无限循环时契约必须判红', () => {
  const introWxss = read('pages/publish/template-intro/index.wxss');
  const mutated = introWxss.replace(/\bboth\b/, 'infinite');

  assert.notEqual(mutated, introWxss, '负控必须真实改动 animation iteration/fill');
  assert.equal(hasEntryMotion(mutated, ['.ti-card--0', '.ti-card--1', '.ti-card--2', '.ti-copy', '.ti-cta']), false);
});
