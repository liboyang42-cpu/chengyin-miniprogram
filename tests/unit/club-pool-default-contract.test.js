process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

/**
 * 公开承接池(openClubPool)口径在 2026-09-15 裁决 12B 后统一:
 *   ① 专业版发布页有开关、默认开、主办可手动关;
 *   ② 后端建题未传 = 开(resolveOpenClubPool),显式 0 才关。
 *
 * 2026-09-15 补充裁决(审查D §1 第 4 条):归属俱乐部的主题(clubId 非空)不开放公开承接池 ——
 * 开关不露面、上送恒 0、后端 resolveOpenClubPool/编辑落值同样压 0。本文件把这条也钉住。
 *
 * 裁决前专业版恒送 0(且自由探索送 1 会撞服务端带队闸硬失败)——
 * 本文件钉的就是「自由探索恒 0、俱乐部自办团恒 0、开关绑活方法」。
 *
 * 2026-09-20 合批说明:原来还有一条「简易版发布 payload 城市定向默认开」——
 * 简易页那条发布链路(onPublish/onSaveDraft/_doPublish)在 wxml 上零绑定,
 * 用户从来没能从这一页发出过主题,整块孤儿代码随审查 #14 删除,断言锚点已不存在,
 * 留着就是钉空气,遂撤。真正的发布口只有 fabu 一条。
 */
test('专业版发布页:开关在、绑活方法、新建默认开、非俱乐部城市定向按开关上送', () => {
  const wxml = read('pages/publish/fabu/step3.wxml');
  const live = wxml.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(/checked="\{\{formData\.openClubPool\}\}"/.test(live),
    '开关必须在版面上 —— 裁决 12B 恢复「主办可手动关」,没有控件就不是统一口径');
  assert.ok(live.includes('onClubPoolChange'), '开关必须绑到活方法');
  assert.ok(live.includes('邀请俱乐部带队'), '文案必须在');
  assert.ok(live.indexOf('wx:if="{{formData.productType === 1 && !formData.clubId}}">俱乐部承接</view>') >= 0,
    '只对「非俱乐部城市定向」露出:自由探索没有俱乐部带队;俱乐部自办团不进公开承接池');

  const js = read('pages/publish/fabu/index.js');
  assert.match(js, /openClubPool:\s*true,/, '新建默认必须为开');
  assert.match(js,
    /openClubPool:\s*\(productType === 1 && !this\.data\.formData\.clubId && this\.data\.formData\.openClubPool\)\s*\?\s*1\s*:\s*0/,
    '上送归一:非俱乐部城市定向按开关,自由探索与俱乐部自办团恒 0');
});

test('negative control:默认改回关、上送漏掉任一恒 0 条件、版面撤开关都必须判红', () => {
  const wrongDefault = '      openClubPool: false, // 旧口径';
  assert.throws(() => assert.match(wrongDefault, /openClubPool:\s*true,/), assert.AssertionError);

  const hardcoded = '      openClubPool: 0,';
  assert.throws(
    () => assert.match(hardcoded,
      /openClubPool:\s*\(productType === 1 && !this\.data\.formData\.clubId && this\.data\.formData\.openClubPool\)\s*\?\s*1\s*:\s*0/),
    assert.AssertionError);

  // 漏掉 clubId 条件(旧的一版归一)也必须红 —— 那正是「俱乐部自办团仍上送 1」的形态。
  const clubIgnored = '      openClubPool: (productType === 1 && this.data.formData.openClubPool) ? 1 : 0,';
  assert.throws(
    () => assert.match(clubIgnored,
      /openClubPool:\s*\(productType === 1 && !this\.data\.formData\.clubId && this\.data\.formData\.openClubPool\)\s*\?\s*1\s*:\s*0/),
    assert.AssertionError);

  const wxmlWithoutSwitch = '<view>俱乐部承接</view>';
  assert.throws(() => assert.ok(/checked="\{\{formData\.openClubPool\}\}"/.test(wxmlWithoutSwitch)), assert.AssertionError);

  const wxmlClubBlind = '<view wx:if="{{formData.productType === 1}}">俱乐部承接</view>';
  assert.throws(
    () => assert.ok(wxmlClubBlind.indexOf('wx:if="{{formData.productType === 1 && !formData.clubId}}">俱乐部承接</view>') >= 0),
    assert.AssertionError);
});
