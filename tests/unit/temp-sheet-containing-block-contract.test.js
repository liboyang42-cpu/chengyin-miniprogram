// 契约（2026-09-19 用户批准修复「07 temp 优惠券 sheet 被裁在卡片内」）：
// pages/publish/temp 页面里 reward-selector 两张 sheet 的祖先容器，其入场动画
// fill 模式必须是 backwards（或 none），不得用 both/forwards。
// 根因：cy-sheet 是 position:fixed；祖先只要常驻非 none 的 transform（both 会在
// 动画结束后永久保留 100% 帧的 translateY(0)），就为 fixed 后代建立 containing
// block，fixed 退化成相对该祖先定位并被其 overflow 裁切。
// backwards 只在启动延迟期套 0% 帧，动画结束回落 base 样式（无 transform），弹层得以逃逸。
// 相册证据：~/Desktop/城瘾弹窗合并树核验_20260919/ 卡 07。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/temp/index.wxss'), 'utf8');

const ruleBody = (selector) => {
  const at = wxss.indexOf(selector + ' {');
  assert.notEqual(at, -1, `找不到规则 ${selector}`);
  return wxss.slice(at, wxss.indexOf('}', at));
};

const keyframes = (name) => {
  const at = wxss.indexOf(`@keyframes ${name}`);
  assert.notEqual(at, -1, `找不到 @keyframes ${name}`);
  const open = wxss.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < wxss.length; i++) {
    if (wxss[i] === '{') depth++;
    if (wxss[i] === '}' && --depth === 0) return wxss.slice(open, i);
  }
  assert.fail(`@keyframes ${name} 花括号不闭合`);
};

for (const [sel, animName] of [
  ['.cg-scroll', 'cg-rise'],
  ['.cg-rw-cfg', 'cg-reveal'],
]) {
  test(`temp 页 ${sel}：带 transform 的入场动画 fill 不得为 both/forwards`, () => {
    assert.match(
      keyframes(animName),
      /transform:/,
      `${animName} 若不再含 transform，本契约可随动画一起退役`,
    );
    const decl = ruleBody(sel).match(/animation:\s*([^;]+);/);
    assert.ok(decl, `${sel} 应保留入场动画`);
    assert.doesNotMatch(
      decl[1],
      /\b(both|forwards)\b/,
      `${sel} 的动画 fill=${decl[1].trim()}：带 transform 的 keyframe 常驻会让 cy-sheet (position:fixed) 被裁在本容器内`,
    );
  });
}
