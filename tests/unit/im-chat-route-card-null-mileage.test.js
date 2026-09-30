/* CU-C-143 · 私聊路线卡把缺失里程显示为 null km、空封面渲染成一大片空白。
   样本:隔离主题 #990029 的 cms_topic.total_mileage 为 NULL、节点为 0、没有封面。
   走查在三个位置看到同一句「null km · 0 个点」:选择器、发送方气泡、接收方气泡。
   全局规则(chengyin-ui-rulings-0918):数字没有就显示 0,不是横杠,更不是 null。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '../../subpackageB/pages/im/chat/index.wxml');
const wxml = fs.readFileSync(file, 'utf8');

// {{...}} 里不会出现花括号,用 [^{}]* 就够;不要写成贪婪的 \{\{.*\}\} —— 那会跨行吃掉整页。
const mileageSpans = wxml.match(/\{\{[^{}]*totalMileage[^{}]*\}\}/g) || [];
const coverSpans = (wxml.match(/<image[^>]*class="(rcard-img|route-item-img)"[^>]*/g) || [])
  .map((tag) => (tag.match(/src="\{\{[^{}]*\}\}"/) || [''])[0]);

test('走查复现的三处里程插值都还在,别把断言写成空集合', () => {
  assert.equal(mileageSpans.length, 2, '选择器与聊天卡各一处里程插值');
  assert.equal(coverSpans.length, 2, '选择器与聊天卡各一处封面');
});

test('缺里程的主题显示 0 km,不是 null km', () => {
  for (const span of mileageSpans) {
    assert.match(span, /\|\|\s*0/, `里程裸插值无兜底: ${span}`);
  }
  assert.doesNotMatch(wxml, /totalMileage\}\}/, '不能出现 {{...totalMileage}} 这种裸结尾');
});

function assertCoverFallbacks(markup) {
  // 聊天气泡明确显示「暂无封面」,选择器沿用图片兜底;两处都不能渲染空 src。
  assert.match(markup, /<image\s+wx:if="\{\{topicCache\[item\.card\.topicId\]\.imgUrl\}\}"[^>]*class="rcard-img"[^>]*\/>\s*<view wx:else class="rcard-img rcard-img--nocover"[^>]*>[\s\S]*?<image[^>]*src="\/images\/no_data\.svg"[^>]*\/>[\s\S]*?封面暂不可用[\s\S]*?<\/view>/);
  assert.match(markup, /<image[^>]*class="route-item-img"[^>]*src="\{\{item\.imgUrl \|\| '\/images\/route_free_cover\.png'\}\}"/);
}

test('缺封面的路线卡显示明确占位,选择器回落到占位封面', () => {
  assertCoverFallbacks(wxml);
  assert.ok(fs.existsSync(path.resolve(__dirname, '../../images/route_free_cover.png')),
    '占位封面资源必须在主包里存在,子包引用才拿得到');
  assert.ok(fs.existsSync(path.resolve(__dirname, '../../images/no_data.svg')));
});

test('负控:无图仍渲染image、删掉说明或选择器兜底都判红', () => {
  for (const [from, to] of [
    ['wx:if="{{topicCache[item.card.topicId].imgUrl}}"', 'wx:if="{{true}}"'],
    ['封面暂不可用', ''],
    ["item.imgUrl || '/images/route_free_cover.png'", 'item.imgUrl'],
  ]) {
    const mutated = wxml.replace(from, to);
    assert.notEqual(mutated, wxml, '变异锚点必须命中');
    assert.throws(() => assertCoverFallbacks(mutated), assert.AssertionError);
  }
});
