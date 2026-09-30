process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');
const stripJs = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const stripWxml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

/**
 * 章节玩法边界:招商时公示 → 承接时冻结 → 点位提交时校验。
 *
 * 这条链有三段,**任何一段没通电,整套机制就静默失效且永不报错**:
 *   ① 主办方在发布器填不了 ⇒ 两列恒 NULL ⇒ 校验分支恒不进
 *   ② 商家申请前看不到 ⇒ 「公示」名存实亡,变成「做完了才被告知超标」
 *   ③ 承接时不冻 ⇒ 主办方事后改章节会让已承接商家突然违规
 *
 * 2026-08-06 首次实现时 ①③ 双双漏了(DDL/domain/mapper 都有,就是没人写),
 * 是通盘核查才发现的 —— 所以这里三段各钉一条。
 */

test('① 发布器:章节边界两项的 UI 入口已随商家承接整体移出编辑器(缺口在案)', () => {
  // ⚠️ 2026-08-10 状态变更,不是搬家 —— 这两项目前**没有任何编辑入口**。
  //
  // 原断言守的是「验证方式与探索值上限在专业发布器里能填」。本轮按设计规格 §7 把
  // 章节级商家承接整体移出编辑器:招商需要时间,发布前填不准(商家还没看到主题)、
  // 发布后 WHITELIST 又改不了,所以配置改到「发布之后的项目详情页工作台」。
  // 那个工作台单独排期(规格 §7.4),在它落地之前这两项是有意的缺口。
  //
  // 因此本条改为守两件事,并在工作台落地时**必须**把 wxml 断言加回去:
  //   1. 数据层链路仍完好(handler 与 _updateChapterRecruitConfig 都还在,没被顺手删掉)
  //   2. 编辑器里不许重新长出这些入口(否则又是「同一字段两个可写入口」)
  const editorWxml = read('pages/publish/fabu/step3.wxml')
    + read('pages/publish/fabu/topic-detail-sheet.wxml')
    + read('pages/publish/fabu/index.wxml');
  const js = stripJs(read('pages/publish/fabu/index.js'));

  assert.doesNotMatch(editorWxml, /onChapterValidationMethodToggle/,
    '章节承接配置已移到发布后工作台,编辑器里不该再有入口');
  assert.doesNotMatch(editorWxml, /onChapterMaxNodeXpInput/, '同上');

  // 数据层不许跟着一起消失 —— 工作台要复用它们
  assert.match(js, /onChapterValidationMethodToggle\s*\(/, 'handler 要留着给工作台复用');
  assert.match(js, /onChapterMaxNodeXpInput\s*\(/);
  assert.match(js, /onChapterValidationMethodToggle[\s\S]{0,900}?_updateChapterRecruitConfig/,
    '必须走 _updateChapterRecruitConfig(index),写 chapterForm 是无效更新');
  assert.match(js, /onChapterMaxNodeXpInput[\s\S]{0,400}?_updateChapterRecruitConfig/);
});

test('② 商家申请前看得到 · 数据侧:边界要从服务端读进来并算成一句话', () => {
  const js = stripJs(read('pages/topic/merchantinfo/merchantinfo.js'));
  assert.match(js, /allowedValidationMethods/, '要读服务端下发的边界');
  assert.match(js, /boundaryLabel/);
});

/* ⚠️ 渲染单独一条:与数据侧合成一条时,只要 js 里还有 boundaryLabel,
   把渲染删掉也不会红(实测过)—— 那就是假绿。
   2026-09-08 稿 159:346 把「选承接标的」换成 cy-chapter-target-picker,
   章节卡只有 140×60 放不下六条标签,所以改成「选中章节后在下面列出来」。
   于是这条要查两截:组件把 boundaryLabel 收进 pickedFacts,wxml 把 pickedFacts 印出来。
   少任何一截,边界就又变成算了不给看。 */
test('② 商家申请前看得到 · 渲染侧:选中章节后必须把边界印出来', () => {
  const js = stripJs(read('pages/topic/components/cy/chapter-target-picker/index.js'));
  assert.match(js, /function factsOf[\s\S]{0,400}?c\.boundaryLabel/,
    '边界必须进选中章节的事实清单');
  const wxml = stripWxml(read('pages/topic/components/cy/chapter-target-picker/index.wxml'));
  assert.match(wxml, /wx:for="\{\{pickedFacts\}\}"[\s\S]{0,120}?\{\{item\}\}/,
    '算出来了但不渲染 = 看不到 = 不叫公示');
});

test('③ 承接时冻结:enroll 必须把章节条款复制进 offer', () => {
  const svc = stripJs(read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/MerchantOfferServiceImpl.java'));
  assert.match(svc, /setAllowedValidationMethods\s*\(\s*chapter\.getAllowedValidationMethods\(\)\s*\)/,
    '不冻的话主办方事后改章节会让已承接商家突然违规');
  assert.match(svc, /setMaxNodeXp\s*\(\s*chapter\.getMaxNodeXp\(\)\s*\)/);
});

test('④ 复制主题(移交)要带上边界,否则新主题条款静默退化成不限', () => {
  const svc = stripJs(read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/CmsTopicServiceImpl.java'));
  assert.match(svc, /newChapter\.setAllowedValidationMethods\s*\(\s*originalChapter\.getAllowedValidationMethods\(\)\s*\)/);
  assert.match(svc, /newChapter\.setMaxNodeXp\s*\(\s*originalChapter\.getMaxNodeXp\(\)\s*\)/);
});

test('★负控:四条都不是恒真断言', () => {
  // 「必须存在」型:样本里没有时要判假
  assert.equal(/bindtap="onChapterValidationMethodToggle"/.test('<view></view>'), false);
  assert.equal(/setMaxNodeXp\s*\(\s*chapter\.getMaxNodeXp\(\)\s*\)/.test('offer.setMaxNodeXp(null);'), false,
    '写死 null 不算冻结,必须判假');
  // 注释里提到不算数
  assert.equal(/chapter\.boundaryLabel/.test(stripWxml('<!-- chapter.boundaryLabel 待做 -->')), false);
  // 写错对象(chapterForm)时,配对断言要判假
  const wrong = 'onChapterMaxNodeXpInput(e) { this.setData({ "chapterForm.maxNodeXp": 1 }); },';
  assert.equal(/onChapterMaxNodeXpInput[\s\S]{0,400}?_updateChapterRecruitConfig/.test(wrong), false,
    '写 chapterForm 必须被抓到 —— 那是无效更新');
});
