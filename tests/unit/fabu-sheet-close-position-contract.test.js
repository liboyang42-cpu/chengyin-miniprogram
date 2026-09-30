// 发布流程弹层的关闭位置契约(2026-09-24 CU-M-159 / CU-C-156)。
// 用户规则:应用弹层的关闭 X 一律在右上角,各类型一致;「完成」是保存动作,继续在场。
// fabu 这一页原来有 5 处自绘头部把 ✕ 画在左上、完成占右上,和同一流程里
// 「选择分类」等用 cy-sheet 头部(右上 ✕)的弹层方向相反 —— 人找一个关闭要来回换手。
// 相册证据:CU-M-159 / CU-C-156 走查截图(主题详情弹层、新建节点弹层、编辑章节半屏、发布确认浮层)。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FABU_WXML = 'pages/publish/fabu/index.wxml';
const FABU_WXSS = 'pages/publish/fabu/index.wxss';
const TOPIC_WXML = 'pages/publish/fabu/topic-detail-sheet.wxml';

/** 按出现顺序取每个标记在源码里的下标,用于判定同一行头部里谁在左谁在右。 */
function positions(source, needle) {
  const out = [];
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** 每一处 node-sheet__top:✕ 必须排在该行的最后一颗(= 视觉最右),完成在它左边。 */
function assertCloseIsRightmost(sources) {
  const wxml = sources[FABU_WXML] === undefined ? read(FABU_WXML) : sources[FABU_WXML];
  const topic = sources[TOPIC_WXML] === undefined ? read(TOPIC_WXML) : sources[TOPIC_WXML];
  const tops = positions(wxml, 'class="node-sheet__top"').length + positions(topic, 'class="node-sheet__top"').length;
  assert.ok(tops >= 4, `node-sheet__top 头部至少应有 4 处,实测 ${tops}`);

  for (const [file, source] of [[FABU_WXML, wxml], [TOPIC_WXML, topic]]) {
    const done = positions(source, '<view class="node-sheet__done"');
    const close = positions(source, '<view class="node-sheet__close"');
    assert.equal(done.length, close.length, `${file}: 完成与 ✕ 数量不该错配`);
    done.forEach((at, i) => {
      assert.ok(at < close[i], `${file} 第 ${i + 1} 处:✕ 又排回完成左边(左上)了`);
    });
  }
}

test('fabu 自绘头部:关闭 ✕ 一律排在「完成」右侧(右上角)', () => {
  assertCloseIsRightmost({});
});

test('fabu 头部不再用 space-between 把 ✕ 顶到左上', () => {
  const wxss = read(FABU_WXSS);
  const block = wxss.match(/\.node-sheet__top\s*\{([^}]*)\}/);
  assert.ok(block, '缺少 .node-sheet__top 规则');
  assert.match(block[1], /justify-content:\s*flex-end/);
  assert.doesNotMatch(block[1], /justify-content:\s*space-between/);
});

/** 标题区从 eyebrow 那颗起、到它自己的 </text> 为止(外层 </view> 会先吃掉 input)。 */
function titlebarOf(source) {
  const at = source.indexOf('class="node-sheet__titlebar"');
  assert.ok(at !== -1, '缺少 node-sheet__titlebar');
  const end = source.indexOf('</text>', at);
  assert.ok(end !== -1, '标题区没有收尾的 </text>');
  return source.slice(at, end);
}

function assertSingleTitle(source) {
  const titlebar = titlebarOf(source);
  assert.doesNotMatch(titlebar, /node-sheet__eyebrow/, '标题区又出现第二颗标题了');
  assert.match(titlebar, /node-sheet__name--static/);
}

function assertChapterHeader(source) {
  assert.doesNotMatch(source, /bindtap="cancelChapter"[^>]*>取消</, '左上的「取消」被加回来了');
  assert.match(source, /bindtap="confrimChapter"[^>]*>完成<\/cy-btn>\s*<view class="tit"/, '完成不再是头部最左的一颗');
  assert.match(source, /class="cs-close"[^>]*bindtap="cancelChapter"/);
  assert.doesNotMatch(source, /class="pc-back"/, '发布确认顶部又退回左上返回箭头');
  assert.match(source, /<view class="tit">发布确认<\/view>\s*<view class="pc-close"[^>]*bindtap="closePublishCheck"/);
}

test('主题详情弹层只有一处标题:撤掉「编辑主题」小字,主题名承担标题', () => {
  assertSingleTitle(read(TOPIC_WXML));
});

test('编辑章节半屏 / 发布确认浮层的退出改成右上角 ✕,不再各画一颗左上出口', () => {
  assertChapterHeader(read(FABU_WXML));
});

test('负控:任一 fabu 头部把 ✕ 挪回完成左边,契约必须判红', () => {
  const source = read(FABU_WXML);
  const mutated = source.replace(
    /(<view class="node-sheet__top" wx:else>\s*)(<view class="node-sheet__done"[\s\S]*?>完成<\/view>)(\s*)(<view class="node-sheet__close"[\s\S]*?<\/view>\s*<\/view>)/,
    '$1$4$3$2',
  );
  assert.notEqual(mutated, source, '负控未命中 node-sheet__top 顺序');
  assert.throws(() => assertCloseIsRightmost({ [FABU_WXML]: mutated }), /✕ 又排回完成左边/);
});

test('负控:恢复「编辑主题」小字标题,契约必须判红', () => {
  const source = read(TOPIC_WXML);
  const mutated = source.replace(
    '<view class="node-sheet__titlebar">',
    '<view class="node-sheet__titlebar">\n      <text class="node-sheet__eyebrow">编辑主题</text>',
  );
  assert.notEqual(mutated, source, '负控未命中标题区');
  assert.throws(() => assertSingleTitle(mutated), /第二颗标题/);
});

test('负控:章节设置退回左上「取消」,契约必须判红', () => {
  const source = read(FABU_WXML);
  const mutated = source
    .replace(/\n\s*<view class="cs-close"[\s\S]*?<\/view>/, '')
    .replace('bindtap="confrimChapter">完成</cy-btn>', 'bindtap="cancelChapter">取消</cy-btn>');
  assert.notEqual(mutated, source, '负控未命中章节设置头部');
  assert.throws(() => assertChapterHeader(mutated), /「取消」被加回来/);
});
