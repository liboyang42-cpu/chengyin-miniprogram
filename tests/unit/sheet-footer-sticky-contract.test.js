// 契约（2026-09-20 创建优惠券 / 体验卡 sheet 实测）：
// bottom 变体带 footer 时，面板必须是纵向 flex，只有 body 滚动。
// sticky 会相对整块 overflow 面板吸附，实测会把 CTA 盖在「发放设置」中段。
// head/grip 的 flex:none 必须并入既有规则，不能新增第二条 .sh__head 规则。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('cy-sheet：footer 在场时根节点挂 sh--has-footer 闸', () => {
  const wxml = read('components/cy/sheet/index.wxml');
  assert.match(wxml, /\{\{footer \? 'sh--has-footer' : ''\}\}/);
});

test('cy-sheet：bottom+footer 固定头尾且只滚正文', () => {
  const wxss = read('components/cy/sheet/index.wxss');
  assert.match(
    wxss,
    /\.sh--bottom\.sh--has-footer \.sh__panel\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s,
    '面板必须是纵向 flex，且不能再让整块面板滚动',
  );
  assert.match(
    wxss,
    /\.sh--bottom\.sh--has-footer \.sh__body\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
    '只有正文可以滚动',
  );
  assert.match(
    wxss,
    /\.sh--bottom\.sh--has-footer \.sh__footer\s*\{[^}]*flex:\s*none;[^}]*background:\s*var\(--cy-comp-sheet-bg\);/s,
    'footer 必须固定尺寸并用面板底色',
  );
  assert.doesNotMatch(
    wxss,
    /\.sh--bottom\.sh--has-footer \.sh__footer\s*\{[^}]*position:\s*sticky;/s,
    'sticky 会盖住长表单中段',
  );
});
