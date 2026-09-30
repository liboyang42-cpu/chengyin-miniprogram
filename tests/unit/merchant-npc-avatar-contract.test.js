const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const COMPONENT = path.join(__dirname, '../../components/cy/profile');
const wxml = fs.readFileSync(path.join(COMPONENT, 'index.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(COMPONENT, 'index.wxss'), 'utf8');
const js = fs.readFileSync(path.join(COMPONENT, 'index.js'), 'utf8');

// 门店 AI 形象(npc_profile 里 scope 2「门店分身」)在店铺公开主页「关于」页静态出场。
// 这三条都属于「坏了不会报错、只会静默变难看/消失」那一类,所以拿测试钉住。

test('形象卡在 tab 之上,不藏在某个 tab 里', () => {
  const tabsAt = wxml.indexOf('<cy-tabs class="pc-tabs"');
  const cardAt = wxml.indexOf('class="pc-npc"');
  assert.ok(tabsAt > 0 && cardAt > 0, '结构变了:找不到 tab 或形象卡');
  // 他人视角默认落在 posts(profile/index.js 的 activeTab 兜底),
  // 卡片一旦掉进任何一个 tab 分支,大部分访客就永远看不到形象。
  assert.ok(cardAt < tabsAt, '形象卡必须在 tab 之上');
  assert.doesNotMatch(wxml.slice(cardAt, tabsAt), /activeTab/,
    '形象卡与 tab 之间不得夹 activeTab 条件,否则等于又藏回某个 tab 里');
});

test('按 npc 是否存在整块渲染,招呼语可空', () => {
  // 判据是「后端有没有回 npc」,不是「头像串是否非空」——
  // 后端在没配 / 未审 / 已停用时回 null,前端不需要也不应该再自己判一遍业务规则。
  assert.match(wxml, /wx:if="\{\{subjectMerchant\.npc\}\}"/);
  assert.match(wxml, /class="pc-npc-avatar">\s*<cy-npc-avatar src="\{\{subjectMerchant\.npc\.avatar\}\}"/);
  assert.match(wxml, /\{\{subjectMerchant\.npc\.name\}\}/);
  // 招呼语可空:空了只出名字,不能因此把整张卡吞掉
  assert.match(wxml, /wx:if="\{\{subjectMerchant\.npc\.greeting\}\}"/);
  // 只有商家被看者才出形象。
  // ⚠️ 不能写成「首个 subjectIsMerchant 出现在 pc-npc 之前」——文件第 49 行就有一个
  //    (pc-gamer-lv 那处),那样写恒真,把形象卡的闸拆掉照样绿。判据必须是
  //    「形象卡最近的外层 block 是不是它」。
  const beforeCard = wxml.slice(0, wxml.indexOf('class="pc-npc"'));
  const nearestBlock = beforeCard.slice(beforeCard.lastIndexOf('<block wx:if='));
  assert.match(nearestBlock, /^<block wx:if="\{\{subjectIsMerchant\}\}">/,
    '形象卡最近的外层 block 必须是 subjectIsMerchant');
});

test('像素头像关掉插值缩放,并显式定尺寸', () => {
  const rule = wxss.split('.pc-npc-avatar {')[1].split('}')[0];

  // 少了这行,64px 的像素图放大到 128rpx 会被双线性插值糊掉 —— 页面照常渲染,只是不再是像素风
  assert.match(rule, /image-rendering:\s*pixelated/);
  // <image> 不给尺寸时默认 320x240px(本仓踩过),必须显式定死
  assert.match(rule, /width:\s*128rpx/);
  assert.match(rule, /height:\s*128rpx/);
});

test('商家资料整体搬运,不白名单字段——否则后端加的 npc 会在前端被静默丢掉', () => {
  assert.match(js, /applySubjectMerchant:\s*function\s*\(raw\)\s*\{\s*var m = Object\.assign\(\{\}, raw\);/);
});
