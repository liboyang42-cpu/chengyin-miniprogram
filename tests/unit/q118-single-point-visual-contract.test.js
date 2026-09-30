const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const xcxRoot = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(xcxRoot, relativePath), 'utf8');

function assertIndexHeroContract({ js, wxml, wxss }) {
  assert.match(js, /city:\s*''/, '首页首帧不能把城市设成“获取中”这类常驻 loading 文案');
  assert.match(wxml, /wx:if="\{\{city\}\}"/, '城市信息只在实际值存在时渲染');
  assert.doesNotMatch(wxml, /city\s*\|\|\s*'上海'/, '未取得城市时不能伪造默认城市');
  assert.doesNotMatch(wxml, /v3-hero-bell-dot/, '没有未读数据时不能常驻通知点');
  // 2026-09-17 A-14-2:文案收紧到「常驻错误横幅」本义 —— hero/推荐/附近/即将上线这些
  // 有旧内容的分区刷新失败仍必须静默降级;列表底部的「加载更多」失败属于用户主动动作,
  // 按 #856 的例外表保留 cy-inline-error 行内重试(在 sec-feed 之后)。
  const aboveFeed = wxml.slice(0, wxml.indexOf('id="sec-feed"'));
  assert.ok(aboveFeed.length > 0, '找不到 sec-feed 锚点(页面结构已改?)');
  assert.doesNotMatch(aboveFeed, /cy-inline-error/, '已有内容时刷新失败要静默降级，不挂常驻错误横幅');
}

function assertAddressErrorContract({ js, wxml, json }) {
  assert.match(js, /loadState:\s*'loading'/, '地址页需要显式加载状态');
  assert.match(js, /loadState:\s*'ready'/, '成功响应才能进入可新增的 ready 状态');
  assert.match(js, /loadState:\s*'error'/, '请求失败必须进入错误状态');
  assert.match(js, /getRequestErrorMessage/, '错误文案必须经统一映射');
  assert.doesNotMatch(js, /res\s*&&\s*res\.msg/, '不能把服务端原始错误直接展示给用户');
  assert.match(json, /"cy-error"\s*:/, '地址页错误态使用统一 cy-error');
  assert.match(wxml, /<cy-error\s+wx:if="\{\{loadState === 'error'\}\}"/, '错误态必须可见且可重试');
  assert.match(wxml, /<cy-footer-bar\s+wx:if="\{\{loadState === 'ready'\}\}"/, '新增地址 CTA 只能在 ready 状态出现');
}

test('Q118：首页首帧不展示伪 loading 或无条件蓝点', () => {
  let source = {
    js: read('pages/index/index.js'),
    wxml: read('pages/index/index.wxml'),
    wxss: read('pages/index/index.wxss'),
  };
  if (process.env.Q118_NEGATIVE === 'index') {
    source.wxml = source.wxml.replace('<cy-icon name="bell" size="32" />', '<cy-icon name="bell" size="32" /><view class="v3-hero-bell-dot"></view>');
  }
  assertIndexHeroContract(source);
});

test('Q118：地址加载失败时不保留新增参与人信息 CTA', () => {
  let source = {
    js: read('pages/address/address.js'),
    wxml: read('pages/address/address.wxml'),
    json: read('pages/address/address.json'),
  };
  if (process.env.Q118_NEGATIVE === 'address') {
    source.wxml = source.wxml.replace('<cy-footer-bar wx:if="{{loadState === \'ready\'}}"', '<cy-footer-bar');
  }
  assertAddressErrorContract(source);
});
