const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CREATE_JS = 'pages/club/create/index.js';
const CREATE_WXSS = 'pages/club/create/index.wxss';
const SETTINGS_WXML = 'pages/shezhi/shezhi.wxml';
const PROFILE_JS = 'components/cy/profile/index.js';

// 非主理人原来要把四步全填完、提交后才被后端弹「请先成为俱乐部主理人」。
// 闸必须在创建页 onLoad —— 全站 4 个入口(club/workbench、shezhi、profile 两处)
// 都汇到这一页,逐个入口补必漏一个。
test('创建俱乐部在 onLoad 就预检主理人身份，不让人填完四步再被拒', () => {
  const js = read(CREATE_JS);
  const onLoad = js.slice(js.indexOf('onLoad()'), js.indexOf('// ===== 步骤导航'));
  assert.ok(onLoad.length > 0, 'onLoad 段落定位失败,契约需同步');
  assert.match(onLoad, /roleGuard\.isClubLeader\(\)/, '预检必须走 roleGuard(权限单一事实源)');
  assert.match(onLoad, /redirectTo[\s\S]{0,80}club\/apply/, '非主理人要送去申请页,不是留在表单里');
  assert.match(onLoad, /!snapshot\s*\|\|\s*!roleGuard\.hasSnapshot\(\)/,
    '拿不到权限快照时必须 fail-closed 并给恢复动作，不能先露表单让用户白填');
  assert.match(onLoad, /failBootstrap\(epoch,[\s\S]{0,120}主理人资格/,
    '资格未知必须进入可重试页面态');
});

// 关心的事从头到尾没变:黑页上「选没选中」必须一眼可辨,不能只靠一圈弱描边。
// 变的是用什么手段。2026-08-08 的答案是「整卡翻白底黑字」;2026-09-02 Figma
// G1(32:35)/G3(32:115)改判为「同底 + 3rpx 实白描边 + 标题加粗 + 实心白点」三重区分
// —— 强度只增不减(当年被吐槽的是 1rpx 弱描边单打独斗),故按新稿重钉。
test('类型卡与方向 chip 选中态是整卡翻白 + 反色字 + 反色圆点，不是一圈弱描边', () => {
  const wxss = read(CREATE_WXSS);

  // ⚠️ 2026-08-08 用户裁决、2026-09-06 复核再次确认「不是白描边」:
  // 选中 = 整卡翻白底黑字。master #1001 曾按 G1 稿改成「深卡 + 白描边」并在此钉死,
  // 本轮以裁决为准反过来。保护点没变 —— 选中必须一眼看得出,不能只靠一圈弱描边。
  assert.match(wxss, /^\.cc-opt \{[^}]*border:\s*1rpx solid var\(--cy-border-card\)/ms,
    '未选卡必须预留同宽描边,避免选中时整卡跳位');
  assert.match(wxss, /^\.cc-opt\.sel \{[^}]*background:\s*var\(--cy-text-title\)/ms,
    '选中卡必须整卡翻白底');
  assert.match(wxss, /^\.cc-opt\.sel \.cc-opt-t \{[^}]*color:\s*var\(--cy-text-inverse\)/ms,
    '翻白后标题必须反色,否则白字落白底直接消失');
  assert.match(wxss, /^\.cc-radio\.on \{[^}]*border-color:\s*var\(--cy-text-inverse\)/ms,
    '翻白后单选点也要反色,白点落白底会消失');
  assert.match(wxss, /^\.cc-radio\.on::after \{[^}]*background:\s*var\(--cy-text-inverse\)/ms,
    '选中的单选点必须有实心内点,不是空心描边');
  assert.match(wxss, /^\.cc-chip\.on \{[^}]*background:\s*var\(--cy-text-title\)[^}]*color:\s*var\(--cy-text-inverse\)/ms,
    '选中 chip 必须整颗翻白 + 反色字');
});

test('负控:选中态退回「一圈描边」必须判红', () => {
  const wxss = read(CREATE_WXSS);
  const mutated = wxss.replace(/^(\.cc-opt\.sel \{[^}]*)background:\s*var\(--cy-text-title\)/ms, '$1background: transparent');
  assert.notEqual(mutated, wxss, '变异未生效,负控本身是假的');
  assert.throws(() => assert.match(mutated, /^\.cc-opt\.sel \{[^}]*background:\s*var\(--cy-text-title\)/ms));
});

// 个人资料一度只剩 profile 里那个 `shezhi?scene=settings-profile` 弹窗入口 ——
// 那是 scene-route-content 的通用表单(只有昵称+邮箱),而真页 pages/gerenziliao 有 390 行。
test('个人资料走真页且排在设置第一项，不再是通用表单弹窗', () => {
  const profile = read(PROFILE_JS);
  // 2026-08-20 合并拍板:商家视角个人资料=品牌中心,goUserInfo 变多行分流 —— 玩家仍直达真页,商户落 decor。
  const goUserInfoBody = (profile.match(/goUserInfo: function \(\) \{[\s\S]*?\n  \},/) || [''])[0];
  assert.match(goUserInfoBody, /gerenziliao/, 'profile 的个人资料入口(玩家)必须直达真页');
  assert.match(goUserInfoBody, /isMerchantView[\s\S]*merchant\/decor/, '商家视角必须落品牌中心(2026-08-20 合并)');
  assert.doesNotMatch(goUserInfoBody, /scene=settings-profile/,
    '不许再跳「设置 + 自动弹个人资料」那条路');

  const wxml = read(SETTINGS_WXML);
  const menu = wxml.slice(wxml.indexOf('<view class="sz-menu">'), wxml.indexOf('</view>', wxml.indexOf('<view class="sz-menu">')));
  const titles = [...menu.matchAll(/title="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(titles[0].includes('个人资料'), `个人资料必须排设置第一项,实际顺序:${titles.join(' / ')}`);
  assert.ok(titles[0].includes('品牌中心'), '商家视角第一项文案必须是品牌中心(2026-08-20 个人资料∪品牌中心合并)');
  assert.ok(titles.includes('成为俱乐部主理人'), '成为主理人要直接摆在列表里,不藏在选择弹窗后面');
  assert.ok(titles.includes('成为商家'), '成为商家同上');
});

// 负控:资格接口失败后若继续放行，用户会把四步填完才被后端拒绝。
test('负控:预检恢复未知快照放行必须判红', () => {
  const mutated = read(CREATE_JS).replace(
    'if (!snapshot || !roleGuard.hasSnapshot()) {',
    'if (false) {'
  );
  assert.notEqual(mutated, read(CREATE_JS), '变异未生效,负控本身是假的');
  const onLoad = mutated.slice(mutated.indexOf('onLoad()'), mutated.indexOf('// ===== 步骤导航'));
  assert.throws(() => assert.match(onLoad, /!snapshot\s*\|\|\s*!roleGuard\.hasSnapshot\(\)/));
});

// 负控:把选中描边换回 .16 弱白(= 2026-08-08 那次抱怨的形态)必须判红。
// 锚点钉「行首选择器 + 行首属性」,不钉旁边的说明文字 —— 注释改一个字不该把断言撞红。
