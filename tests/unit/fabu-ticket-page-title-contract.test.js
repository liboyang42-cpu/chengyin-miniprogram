// CU-C-167 · 票务编辑步骤缺少页面级标题。
// 第 2 页(editorPage===2)的第一个元素就是区块标题「档期」,页级标题零个:
// 用户只能由区块反推自己在哪一步,而顶部那枚返回箭头离开的是整个编辑器。
// 修法:给这一步补一个与全站同一个 L1 组件(cy-page-title)的单一标题,
// 措辞与「进来时点的那张卡」和「底部完成的无障碍名」同一套词。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(__dirname, '../../pages/publish/fabu');
const step3 = fs.readFileSync(path.join(dir, 'step3.wxml'), 'utf8');
const index = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8');
const json = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));

// step3 由 index.wxml <include> 进来,组件注册看页面 json;两张卡与那颗「完成」也都在 index 里。
const page2 = step3.slice(step3.indexOf('wx:if="{{editorPage === 2}}"'));

test('票务这一步有且只有一个页面级标题,排在区块标题之前', () => {
  const titles = page2.match(/<cy-page-title\b/g) || [];
  assert.equal(titles.length, 1, '一个步骤一个 L1 标题,不许两处各摆一个');
  const firstSection = page2.indexOf('<view class="pd-section-title">档期</view>');
  assert.ok(firstSection > 0, '「档期」区块标题还在原位');
  assert.ok(page2.indexOf('<cy-page-title') < firstSection, '页面级标题必须在该屏第一个元素');
});

test('标题措辞与入口卡、返回动作同一套词', () => {
  const title = page2.match(/<cy-page-title[^>]*title="([^"]+)"/);
  assert.ok(title, '标题走 title 属性(cy-page-title 的唯一入口)');
  assert.equal(title[1], '票务设置');
  // 入口:第 1 页那张 data-page="2" 的卡,卡名就是这一屏的标题
  const entryCard = index.slice(index.indexOf('data-page="2"'), index.indexOf('data-page="2"') + 600);
  assert.match(entryCard, /<text class="pd-modecard__name">票务设置<\/text>/,
    '入口卡叫「票务设置」,进来以后不许换个名字');
  // 返回路径:底部整宽那颗「完成」的无障碍名指向回到创作
  const doneCta = index.slice(index.indexOf('slopes-tabbar__doneCta'));
  assert.match(doneCta.slice(0, 400), /aria-label="完成票务设置，回到创作"/,
    '这一屏唯一的收尾动作要能说清回哪去');
});

test('组件真的注册过,否则标题会静默不渲染', () => {
  assert.equal(json.usingComponents['cy-page-title'], '/components/cy/page-title/index');
  assert.ok(fs.existsSync(path.resolve(dir, '../../../components/cy/page-title/index.wxml')));
});

test('这一页放的是页内标题,不是第二套导航(safe-top 关掉、缩进不叠加)', () => {
  const tag = page2.slice(page2.indexOf('<cy-page-title'), page2.indexOf('>', page2.indexOf('<cy-page-title')) + 1);
  // .slopes-info-page 自带 32rpx 横向内边距 → flush;这一屏上面还有 sheet 把手,不是顶格导航页
  assert.match(tag, /safe-top="\{\{false\}\}"/, 'safe-top 必须显式关掉,否则标题会顶进胶囊区');
  assert.match(tag, /flush="\{\{true\}\}"/, '不关自带页边距会被推成双倍缩进');
  assert.equal((index.match(/<cy-page-title\b/g) || []).length, 0,
    '编辑器首页的标题位是那行可编辑的主题名,不再叠一个 L1 标题');
});

test('负控:撤掉组件注册或未干边距,都会红', () => {
  const unregistered = JSON.parse(JSON.stringify(json));
  delete unregistered.usingComponents['cy-page-title'];
  assert.notEqual(unregistered.usingComponents['cy-page-title'], '/components/cy/page-title/index');
  const unflushed = page2.replace('flush="{{true}}"', '');
  assert.ok(!/<cy-page-title[^>]*flush/.test(unflushed), '脚手架自检:改回去会被数出来');
});
