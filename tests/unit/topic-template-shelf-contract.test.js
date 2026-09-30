// 主题模板货架入口契约(2026-08-20,去弹窗直落版)。
//
// 背景:后端货架 API(/api/template/topic-template list/use)2026-07-19 就建好,
// 但小程序端零调用方 —— 货架上架了《生活不掉线》等主题模板,玩家却无处可看。
// 用户拍板:模板详情**不做阅览弹窗**(历史 ttInfo 半屏即按此删除)——
// 「用模板」直落 /use 整包复制成我的草稿,结构在「我的项目 → 编辑」里看和配。
// 本契约钉住:货架有入口、直落不带弹窗、状态保守渲染。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_DIR = path.join(__dirname, '../../pages/template');
const js = fs.readFileSync(path.join(PAGE_DIR, 'index.js'), 'utf8');
const wxml = fs.readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(PAGE_DIR, 'index.wxss'), 'utf8');
const tokens = fs.readFileSync(
  path.join(__dirname, '../../style/tokens.wxss'), 'utf8');

test('货架列表端点继续调用,整包复制 JS 写入口保留', () => {
  assert.match(js, /url:\s*'\/api\/template\/topic-template\/list'/,
    '模板页必须拉货架列表,否则主题模板不可查看');
  assert.match(js, /url:\s*'\/api\/template\/topic-template\/use'/,
    '详情页将来复用 useTt 时必须保留 /use 写入路径');
});

// 2026-08-26:货架不再是页面里的一个独立板块 —— 主题 tab 的列表本体就是货架,
// 数据从 topicRows 流到 topList/tailList。
test('主题列表由 topicRows 驱动,货架卡只保留 jumpDetail 查看入口', () => {
  assert.match(js, /that\._topicRows = that\.decorateTopic\(res\.data\)/,
    '主题货架数据必须落到 _topicRows(内部状态,不进 setData)');
  assert.match(wxml, /wx:for="\{\{ topList \}\}"/, '置顶列表必须由 topList 驱动');
  assert.match(wxml, /wx:for="\{\{ tailList \}\}"/, '其余列表必须由 tailList 驱动');
  // 2026-08-28 用户裁决撤掉货架按钮:banner / 置顶 / 其余卡面只负责查看,
  // 配置/使用留给详情页;本页不得再把卡片点击直连写入口。
  assert.equal((wxml.match(/(?:data-item="\{\{ (?:banner|item) \}\}"[^>]*?)bindtap="jumpDetail"/g) || []).length, 3,
    '三种卡面必须统一绑定 jumpDetail');
  assert.doesNotMatch(wxml, /(?:bindtap|catchtap)="(?:primaryAction|useTt|goTopicConfig|goGameConfig)"/,
    '货架卡不得重新暴露配置或整包复制按钮');
});

test('直落不带弹窗:货架不得引入任何阅览半屏(用户拍板已删)', () => {
  assert.doesNotMatch(wxml, /ttInfoShow/,
    '主题模板阅览半屏是用户明令删除的,不得回潮');
  assert.doesNotMatch(js, /ttInfoShow|openTtInfo|closeTtInfo/,
    '弹窗开合状态机不得回潮');
});

test('模板状态保守渲染:非 VERIFIED(含未下发)一律标「实验模板」', () => {
  // 货架指南:实验模板与已验证模板不得混排不区分;状态缺失时不得冒充已验证
  assert.match(js, /templateStatus === 'VERIFIED' \? '' : '实验模板'/,
    '状态未下发时必须按「实验」保守渲染,不能反过来默认已验证');
  assert.match(wxml, /\{\{ item\._statusText \}\}/,
    '实验标必须真的画出来');
});

test('新增 wxss 只引用已定义 token(未定义 var 会静默作废整条声明)', () => {
  const idx = wxss.indexOf('主题模板货架');
  assert.ok(idx >= 0, '货架 wxss 段必须存在');
  const shelfCss = wxss.slice(idx);
  const vars = [...shelfCss.matchAll(/var\((--cy-[a-z0-9-]+)/g)].map(m => m[1]);
  for (const v of vars) {
    assert.ok(tokens.includes(v + ':'),
      `token ${v} 未在 style/tokens.wxss 定义 —— 该条声明会静默作废`);
  }
});
