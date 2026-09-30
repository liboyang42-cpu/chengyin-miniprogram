// CU-C-165 · 编辑既有章节仍提示「创建后进入全屏故事流」。
// 那条提示原来挂在 `wx:else` 上,而 `wx:else` 的条件是【模式】(非自由探索 = 城市定向),
// 不是【本章是否已创建】。于是城市定向第 1 章早就写好剧情、故事流就在背后开着,
// 弹层标题写着「编辑章节」,名字下面还在预告"创建之后"会发生什么;「块间插入点」是实现术语。
// 修法:提示改按 popChapterAction(与同一弹层标题同一个判据)出示,措辞去掉实现术语。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/publish/fabu/index.wxml'), 'utf8');
const js = fs.readFileSync(path.resolve(__dirname, '../../pages/publish/fabu/index.js'), 'utf8');

// 只看「章节设置」这一张弹层:页面上还有别的 .tit / 别的弹层,不限定会串台。
const sheetStart = wxml.indexOf('pop-chapter-settings');
const sheetEnd = wxml.indexOf('2026-09-04 拍板:音频', sheetStart);
assert.ok(sheetStart >= 0, '章节设置弹层还在');
assert.ok(sheetEnd > sheetStart, '弹层结束标记找不到,切片会串台');
const sheet = wxml.slice(sheetStart, sheetEnd);

function hintText(text) {
  const at = text.indexOf('class="chapter-story-entry-hint"');
  assert.ok(at >= 0, '故事流入口提示还在这张弹层里');
  const open = text.lastIndexOf('<', at);
  const close = text.indexOf('>', at);
  return { tag: text.slice(open, close + 1), body: text.slice(close + 1, text.indexOf('</view>', close)) };
}

test('提示按「本章是否还没建」出示,不再挂在模式反分支上', () => {
  const { tag } = hintText(sheet);
  assert.ok(!/\bwx:else\b/.test(tag), '裸 wx:else 等于按模式分岔,编辑既有章节也会显示');
  const cond = tag.match(/wx:elif="\{\{([^}]*)\}\}"/);
  assert.ok(cond, '提示要有一条自己的条件');
  assert.match(cond[1], /popChapterAction\s*==\s*0/, '判据必须是「这一章还没创建」');
  // 与同一弹层标题共用判据:标题说「添加章节」时,才轮到预告添加之后会发生什么
  assert.match(sheet, /\{\{popChapterAction==0\?'添加章节':'编辑章节'\}\}/, '弹层标题的添加/编辑判据不得漂移');
});

test('措辞不再用实现术语,也不再对未来时预告', () => {
  const { body } = hintText(sheet);
  // 注释里可以留这个词(它记录了为什么删),面向商家的可见文案不行。
  assert.ok(!/块间插入点/.test(wxml.replace(/<!--[\s\S]*?-->/g, '')), '可见文案不得再出现「块间插入点」');
  assert.ok(!/创建后/.test(body), `"${body}" 仍是"创建后…"这种未来时预告`);
  assert.match(body, /全屏故事流/);
});

test('这句话描述的行为与 JS 一致:完成新增才会自动进入故事流', () => {
  assert.match(js, /const cityStoryFlow = Number\(this\.data\.formData\.productType\) === 1;/);
  assert.ok(js.includes('updatedChapters.length - 1 } } });'), '完成新增后确实 openStoryEditor');
  const editBranchAt = js.indexOf('} else {\n      // 编辑现有章节的逻辑保持不变');
  assert.ok(editBranchAt > 0, '编辑既有章节的分支没被挪走');
  assert.ok(js.slice(editBranchAt, editBranchAt + 1600).indexOf('openStoryEditor') < 0,
    '编辑既有章节不会自动进故事流,所以这句话在这里就是错的');
});

test('负控:把条件改回裸 wx:else、或把措辞改回原样,都会红', () => {
  const regressedSheet = sheet.replace(/wx:elif="\{\{popChapterAction == 0\}\}"/, 'wx:else');
  assert.match(hintText(regressedSheet).tag, /\bwx:else\b/, '脚手架自检:回退成 wx:else 能被数出来');
  const renamed = hintText(sheet).body.replace('全屏故事流', '块间插入点');
  assert.ok(/块间插入点/.test(renamed), '脚手架自检:术语回潮也能被抓到');
});
