/**
 * CU-M-42(2026-09-24 走查)· 访客看到商家口碑管理文案。
 *
 * 口碑页用 mode 分流(manage=商家自己,public=访客/玩家),统计卡与「待回复」筛选段都已挂
 * mode 门控,唯独回复气泡的标签只判 `item.merchantReply` —— 访客看别人家的评价,商家写的回复
 * 上面却写着「你的回复」,是商家视角用语。公开态必须保留回复正文,只能换称呼。
 *
 * 负控在测试内联:把标签改回不带 mode 判据,同一条断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const WXML = fs.readFileSync(path.join(ROOT, 'pages/merchant/reviews/index.wxml'), 'utf8');

/** 回复气泡标签必须按 mode 分流;公开态用「商家回复」,管理态才说「你的回复」。 */
function checkReplyLabel(source) {
  const bubble = source.slice(source.indexOf('class="review-reply"'), source.indexOf('class="review-reply"') + 400);
  assert.match(bubble, /review-reply-label/, '结构变了:找不到回复气泡的标签');
  assert.doesNotMatch(bubble, />你的回复</, '标签不得写死商家视角的「你的回复」');
  assert.match(bubble, /\{\{mode === 'manage' \? '你的回复' : '商家回复'\}\}/, '标签必须按 mode 分流');
  // 正文不能跟着标签一起被门控掉 —— 访客要看得到商家写的内容
  assert.match(bubble, /\{\{item\.merchantReply\}\}/, '公开态必须保留回复正文');
}

test('回复气泡的称呼按 mode 分流,公开态不再说「你的回复」', () => {
  checkReplyLabel(WXML);
});

test('负控:标签改回无 mode 判据时必须判红', () => {
  const regressed = WXML.replace("{{mode === 'manage' ? '你的回复' : '商家回复'}}", '你的回复');
  assert.notEqual(regressed, WXML, '负控锚点失效:标签表达式已改名,扫描口径需同步');
  assert.throws(() => checkReplyLabel(regressed), assert.AssertionError);
});

test('统计卡与「待回复」筛选段仍只在管理态出现(公开态不得混进经营视角)', () => {
  assert.match(WXML, /<view wx:if="\{\{mode === 'manage'\}\}" class="review-stats-grid">/);
  assert.match(WXML, /wx:if="\{\{mode === 'manage'\}\}" class="review-segment/);
});
