const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const source = {
  fabuWxml: read('pages/publish/fabu/index.wxml'),
  fabuWxss: read('pages/publish/fabu/index.wxss'),
  fabuJs: read('pages/publish/fabu/index.js'),
  tempWxss: read('pages/publish/temp/index.wxss'),
  detailWxml: read('pages/templatedetail/templatedetail.wxml'),
  detailJs: read('pages/templatedetail/templatedetail.js')
};

if (process.env.B_DOMAIN_NEGATIVE === 'card') {
  source.fabuWxss = source.fabuWxss.replace(
    /(\.fabu\.theme-topic-editor\s*\{[\s\S]*?)\s*--cy-comp-card-bg\s*:\s*var\(--cy-color-bg-surface\);/,
    '$1'
  );
  source.tempWxss = source.tempWxss.replace(
    /(\n\.theme-topic-editor\s*\{[\s\S]*?)\s*--cy-comp-card-bg\s*:\s*var\(--cy-color-bg-surface\);/,
    '$1'
  );
}

if (process.env.B_DOMAIN_NEGATIVE === 'removed-content') {
  source.fabuWxml += '<view class="slopes-play-preview-wrap" bindtap="openPlayerPreview">玩家视角预览</view>';
  source.fabuJs += 'openPlayerPreview() {}\nbuildPlayPreviewData() {}';
  source.fabuWxss += '.slopes-play-preview-wrap {}';
  source.detailWxml += '<view class="xb-infoblock">评分 反馈方式 报名参与活动后可体验完整节点验证与反馈。</view>';
  source.detailJs += 'ratingText: "—"';
}

function ruleBody(css, selector) {
  const renderable = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = renderable.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `${selector} 必须有页面专属主题规则`);
  return match[1];
}

function assertLightCardHook(css, selector) {
  assert.match(
    ruleBody(css, selector),
    /--cy-comp-card-bg\s*:\s*var\(--cy-color-bg-surface\)\s*;/,
    `${selector} 必须在隔离 cy-card 边界前重声明浅色卡片底`
  );
}

function assertAbsent(sourceText, pattern, message) {
  assert.equal(pattern.test(sourceText), false, message);
}

test('B48/B52:发布编辑页在页面主题根显式恢复 cy-card 浅色底', () => {
  assertLightCardHook(source.fabuWxss, '.fabu.theme-topic-editor');
  assertLightCardHook(source.tempWxss, '.theme-topic-editor');
});

test('B48:专业发布页不再暴露玩家视角预览入口与孤立适配代码', () => {
  assertAbsent(source.fabuWxml, /玩家视角预览|自由探索预览|openPlayerPreview|slopes-play-preview-wrap/, 'WXML 不应残留玩家预览入口');
  assertAbsent(source.fabuJs, /\bopenPlayerPreview\b|\bbuildPlayPreviewData\b/, 'JS 不应残留玩家预览适配器');
  assertAbsent(source.fabuWxss, /\.slopes-play-preview-wrap\b/, 'WXSS 不应残留玩家预览样式');
});

test('B57:模板详情移除评分、反馈方式及紧随说明文字', () => {
  assertAbsent(source.detailWxml, /评分|反馈方式|报名参与活动后可体验完整节点验证与反馈|xb-infoblock|xb-inforow|xb-notice--solo/, 'WXML 不应残留评分/反馈信息区');
  assertAbsent(source.detailJs, /\bratingText\b/, 'JS 不应残留评分展示字段');
});
