const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

function read(relativePath) {
  return readResolved(relativePath);
}

// 2026-08-07 D23 按用户裁决恢复为邀请记录；数据仍只能消费 PublicMemberVO 白名单字段。
test('邀请记录只消费公开昵称/头像，不把私密会员字段带回页面', () => {
  const route = read('subpackageMember/myinvite/myinvite.wxml');
  const wxml = read('components/cy/scene-member-invite-history/index.wxml');
  const js = read('components/cy/scene-member-invite-history/index.js');
  assert.match(route, /邀请记录/);
  assert.match(js, /\/api\/user\/invite_list/);
  assert.match(wxml, /item\.nickname/);
  assert.match(wxml, /item\.avatar/);
  assert.doesNotMatch(js + wxml, /mobilephone|workAddress|wechat|idCard|bankAccount/i);
});

test('他人主页不消费工作地点或微信号并保留站内消息', () => {
  const js = read('pages/userinfo/userinfo.js');
  const wxml = read('pages/userinfo/userinfo.wxml');
  const wxss = read('pages/userinfo/userinfo.wxss');
  const combined = `${js}\n${wxml}\n${wxss}`;

  assert.doesNotMatch(combined, /workAddress|userInfo\.wechat|tpShow|tpClick|tpClose/);
  assert.doesNotMatch(js, /ui\.name|userInfo\.name/);
  assert.doesNotMatch(wxml, /微信二维码|>沟通</);
  assert.doesNotMatch(wxss, /\.(?:tkbg|tkbox(?:_logo|_name|_2vm|_guanbi)?)\b/);
  // 语义断言，不锁标签的确切写法：原来要求 `bindtap="onStartChat">发消息<` 紧贴，
  // 统一到 cy-profile 后按钮多了 aria-label / hover-class / 图标子节点就匹配不上了。
  // 立意是「他人主页保留站内消息入口」——按这两件事分别断言。
  assert.match(wxml, /bindtap="onStartChat"/, '他人主页必须保留站内消息入口');
  const chatBtn = wxml.match(/<view[^>]*bindtap="onStartChat"[\s\S]*?<\/view>/);
  assert.ok(chatBtn && /发消息/.test(chatBtn[0]), '该入口的文案必须是「发消息」');
});

// 第3批 UI 复查:"探索动态"/"探索档案"两个 tab(含常驻城市板块)已下线,
// 他人主页收窄为纯资料头,不再消费/展示 cityName。
test('他人主页不再承载探索动态/探索档案 tab', () => {
  const js = read('pages/userinfo/userinfo.js');
  const wxml = read('pages/userinfo/userinfo.wxml');

  assert.doesNotMatch(wxml, /探索动态|探索档案/);

  // 原来还断言 js 里不得出现 cityName / joinInfo / getCreativesquareList ——
  // 那是「他人主页不该拉这些数据」的代理指标。统一到 cy-profile 后这些逻辑是两个视角
  // 共用的，源码里必然出现；真正该守的是**他人视角拿不到它们**。
  // ⇒ 改成断言组件里这些消费点都挂在 isSelf 闸后面。
  const comp = read('components/cy/profile/index.js');
  // 只对「自己」有意义的接口（用 app.getUserID() 取当前登录用户，或订单/项目/积分这类
  // 私有数据）必须挂在 isSelf 分支里。检查 refreshAll 的 selfOnly 数组，
  // 而不是逐行找关键词 —— 那种写法太脆，函数换个位置就失效。
  const selfOnly = comp.match(/var selfOnly = this\.data\.isSelf \? \[([\s\S]*?)\] : \[\]/);
  assert.ok(selfOnly, 'refreshAll 必须按视角分流(selfOnly 分支)');
  for (const guarded of ['loadJoinData', 'loadOrderPreview', 'loadProjectPreview', 'loadPointsStat']) {
    assert.match(selfOnly[1], new RegExp(guarded),
      `${guarded} 必须只在自己视角拉，他人主页调它拿回来的是自己的数据`);
  }

  // 关注按钮的文案是动态的（primaryCta：开始探索 / 关注 / 已关注），
  // 原来锁死 `>关注<` 字面量，改成断言「他人视角的主按钮走 primaryCta，且文案表里有关注」
  assert.match(wxml, /\{\{primaryCta\}\}/, '主按钮文案必须走 primaryCta');
  assert.match(comp, /primaryCta:\s*isSelf\s*\?[^:]*:\s*'关注'/,
    '他人视角的 primaryCta 必须是「关注」');
});
