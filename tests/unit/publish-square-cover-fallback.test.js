/**
 * 发布广场(pages/template/index)封面兜底 —— 行为 + 结构断言
 *
 * 覆盖的是「封面拉不动时页面还剩什么」:
 *   行为:decorate 只绑定真实图标资产 / onCoverError 只翻白名单列表的 _coverFail / 非法列表不写 setData
 *   结构:三处远端封面位都绑了 binderror,且都有明确的 no_data 失败态,复用原封面类保持几何
 *
 * ⚠️ 本文件断言的是「失败态的兜底」,不是内容治理:
 *    它不认识、也不该认识某张图是不是侵权 —— 版权/占位图数据在数据侧处理。
 *    因此这里额外反向断言:代码里不许出现按 URL/标题写死的黑名单。
 *
 * 跑法:node --test tests/unit/publish-square-cover-fallback.test.js
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = '../../pages/template/index.js';
// 负控用:XCX_ROOT 指到变异副本,即可验证检查器能判红
const ROOT = process.env.XCX_ROOT || path.resolve(__dirname, '../..');
const WXML = fs.readFileSync(path.join(ROOT, 'pages/template/index.wxml'), 'utf8');
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/template/index.wxss'), 'utf8');

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: () => {},
  tips: () => {},
  isDevEnv: () => false,
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = { getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375 }) };

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

// setData 需要支持 'a.b[0].c' 这种路径键
function setByPath(root, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setDataCalls = [];
  page.setData = function (patch) {
    page.setDataCalls.push(patch);
    Object.keys(patch).forEach((k) => setByPath(page.data, k, patch[k]));
  };
  return page;
}

const errEvent = (list, idx, key) => ({ currentTarget: { dataset: { list, idx, key } } });
const detailErrEvent = (target, key) => ({ currentTarget: { dataset: { target, key } } });

// ---------- 行为 ----------

test('decorateGame 只给已登记模板绑定真实图标，未知内容不伪造首字或渐变占位', () => {
  const page = makePage();
  const out = page.decorateGame([{ title: '今晚的暗号' }, { name: '街角密码' }, {}]);
  assert.equal(out[0]._iconUrl, '/images/interaction-templates/merchant-secret-code.svg');
  assert.equal(out[1]._iconUrl, '', '未知 name 不得被首字或 CSS 图块冒充为内容图标');
  assert.equal(out[2]._iconUrl, '', '无标题内容不得生成假资产');
  out.forEach((item) => {
    assert.equal(Object.hasOwn(item, '_initial'), false);
    assert.equal(Object.hasOwn(item, '_c1'), false);
    assert.equal(Object.hasOwn(item, '_c2'), false);
  });
});

test('封面加载失败会把对应那条标成 _coverFail,两条列表都认', () => {
  const lists = ['topList', 'tailList'];
  lists.forEach((list) => {
    const page = makePage();
    setByPath(page.data, list, [{ id: 11, title: 'A' }, { id: 22, title: 'B' }]);
    page.onCoverError(errEvent(list, 1, 22));
    assert.equal(page.setDataCalls.length, 1, `${list} 应写一次 setData`);
    const arr = list.split('.').reduce((o, k) => o[k], page.data);
    assert.equal(arr[1]._coverFail, true, `${list}[1] 应被标记`);
    assert.ok(!arr[0]._coverFail, '不能误伤同列表其它条目');
  });
});

test('非白名单列表 / 非法下标不写 setData(不给任意 setData 路径开口子)', () => {
  const page = makePage();
  setByPath(page.data, 'tailList', [{ id: 1, title: 'A' }]);
  page.onCoverError(errEvent('home.hotList', 0, 1));
  page.onCoverError(errEvent('__proto__', 0, 1));
  page.onCoverError(errEvent('tailList', -1, 1));
  page.onCoverError(errEvent('tailList', undefined, 1));
  assert.equal(page.setDataCalls.length, 0);
});

test('idx 必须是范围内的整数:小数 / NaN / Infinity / 越界一律不写', () => {
  const page = makePage();
  setByPath(page.data, 'tailList', [{ id: 1, title: 'A' }, { id: 2, title: 'B' }]);
  [1.5, 0.1, NaN, Infinity, -Infinity, '1.5', 2, 99, '2', null, {}, []].forEach((bad) => {
    page.onCoverError(errEvent('tailList', bad, 2));
  });
  assert.equal(page.setDataCalls.length, 0, `不该写入,实际写了 ${JSON.stringify(page.setDataCalls)}`);
  // 同一批里合法的那条必须仍能写进去,证明上面不是被整体挡死
  page.onCoverError(errEvent('tailList', 1, 2));
  assert.equal(page.setDataCalls.length, 1);
  assert.equal(page.data.tailList[1]._coverFail, true);
});

test('小数下标:哪怕数组上真挂着 [1.5] 这个属性,也不能写出坏路径', () => {
  // 这条是 Number.isInteger 那道闸的**行为级**负控:
  // 单纯传 1.5 会被后面的「取不到 item」挡住,看不出这道闸有没有用;
  // 只有让 arr[1.5] 真的存在、身份还对得上,少了这道闸才会真写出 `[1.5]._coverFail`。
  const page = makePage();
  const arr = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  arr[1.5] = { id: 9, title: '影子' };
  setByPath(page.data, 'tailList', arr);
  page.onCoverError(errEvent('tailList', 1.5, 9));
  assert.equal(page.setDataCalls.length, 0,
    `小数下标写进了 setData:${JSON.stringify(page.setDataCalls)}`);
});

test('四道闸都在源码里(四道各自都有行为级负控,这条只是防有人把闸挪走后忘了)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/template/index.js'), 'utf8');
  const fn = /onCoverError\(e\) \{[\s\S]*?\n  \},/.exec(src);
  assert.ok(fn, '找不到 onCoverError');
  assert.match(src, /COVER_LISTS\.indexOf\(list\) < 0\) return null;/, '闸1 列表白名单');
  assert.match(fn[0], /Number\.isInteger\(idx\)/, '闸2 整数');
  assert.match(fn[0], /idx >= arr\.length/, '闸3 上界');
  assert.match(fn[0], /nowId !== boundId/, '闸4 身份匹配');
  assert.match(fn[0], /!nowId\.length \|\| !boundId\.length/, '闸4 空身份不算匹配');
});

test('迟到的 error:列表已被换掉,同一下标不能被标错卡', () => {
  const page = makePage();
  setByPath(page.data, 'tailList', [{ id: 1, title: '旧A' }, { id: 2, title: '旧B' }]);
  // 拿到 idx=1/key=2 的事件之前,列表被下一轮请求整条换掉
  setByPath(page.data, 'tailList', [{ id: 7, title: '新A' }, { id: 8, title: '新B' }]);
  page.onCoverError(errEvent('tailList', 1, 2));
  assert.equal(page.setDataCalls.length, 0, '身份对不上就不该写');
  assert.ok(!page.data.tailList[1]._coverFail, '新列表那条不能被误标');
  // 换成新身份就该写
  page.onCoverError(errEvent('tailList', 1, 8));
  assert.equal(page.data.tailList[1]._coverFail, true);
});

test('没有稳定 id(或事件没带 key)时宁可不兜底,也不猜位置', () => {
  const page = makePage();
  setByPath(page.data, 'tailList', [{ title: '无 id' }]);
  page.onCoverError(errEvent('tailList', 0, undefined));
  page.onCoverError(errEvent('tailList', 0, ''));
  assert.equal(page.setDataCalls.length, 0);
});

test('空字符串不算稳定身份:两边都是空串也不许写(否则 "" === "" 会误判成同一条)', () => {
  const page = makePage();
  setByPath(page.data, 'tailList', [{ id: '', title: '空 id' }, { id: 0, title: '零 id' }]);
  page.onCoverError(errEvent('tailList', 0, ''));
  assert.equal(page.setDataCalls.length, 0, '空串身份不该被当成匹配');
  // 但 id=0 是合法稳定身份,不能被 falsy 判断误杀
  page.onCoverError(errEvent('tailList', 1, 0));
  assert.equal(page.data.tailList[1]._coverFail, true, 'id=0 属于有效身份');
});

test('上界闸独立行为负控:下标越界但属性沿原型链能取到时,不许写出 list 之外的路径', () => {
  // 拆掉 `idx >= arr.length` 这道闸时,arr[2] 会沿原型链取到东西、身份还对得上,
  // 于是写出 tailList[2]._coverFail —— 而真实列表只有 2 条,这是越界写。
  // 保留这道闸则直接 return。这样它就不是只能靠源码字面兜的纵深防御了。
  const page = makePage();
  const arr = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
  Object.setPrototypeOf(arr, { 2: { id: 9, title: '原型上的影子' } });
  assert.equal(arr.length, 2);
  assert.ok(arr[2], '夹具前提:arr[2] 取得到,但不在 length 之内');
  setByPath(page.data, 'tailList', arr);
  page.onCoverError(errEvent('tailList', 2, 9));
  assert.equal(page.setDataCalls.length, 0,
    `越界写进了 setData:${JSON.stringify(page.setDataCalls)}`);
});

test('同一条重复 error 不重复写 setData', () => {
  const page = makePage();
  setByPath(page.data, 'tailList', [{ id: 5, title: 'A' }]);
  page.onCoverError(errEvent('tailList', 0, 5));
  page.onCoverError(errEvent('tailList', 0, 5));
  page.onCoverError(errEvent('tailList', 0, 5));
  assert.equal(page.setDataCalls.length, 1);
});

test('头牌 banner 的远端封面加载失败只标记当前稳定身份对象', () => {
  const page = makePage();
  page.data.banner = { id: 42, imgUrl: 'https://cdn.example.test/cover.png' };
  page.onDetailCoverError(detailErrEvent('banner', 42));
  assert.equal(page.data.banner._coverFail, true, 'banner 应进入失败态');
  assert.equal(page.setDataCalls.length, 1, 'banner 只能写一次失败标记');

  const stale = makePage();
  stale.data.banner = { id: 99, imgUrl: 'https://cdn.example.test/new-cover.png' };
  stale.onDetailCoverError(detailErrEvent('banner', 42));
  stale.onDetailCoverError(detailErrEvent('templateInfo', 99));
  stale.onDetailCoverError(detailErrEvent('__proto__', 99));
  assert.equal(stale.setDataCalls.length, 0, '迟到事件或非白名单对象不得误写当前头牌');
  assert.equal(stale.data.banner._coverFail, undefined);
});

// ---------- 结构 ----------

// 2026-08-26:四刀切退役,列表收敛成「置顶 topList + 其余 tailList」两条;
// banner 变成单张头牌(不再是列表项),它的封面守卫走 onDetailCoverError 那一支。
const COVERS = [
  { name: '置顶列表 cml-pic', cls: 'cml-pic', list: 'topList', title: 'item._title' },
  { name: '其他模板 cml-pic', cls: 'cml-pic', list: 'tailList', title: 'item._title' },
];
const imagesOf = (cls) => [...WXML.matchAll(new RegExp(`<image[^>]*class="${cls}"[^>]*>`, 'gs'))].map((m) => m[0]);

test('两处封面位都绑了 binderror 且带定位用的 data-list/data-idx', () => {
  COVERS.forEach((c) => {
    const matched = imagesOf(c.cls).filter((t) => t.includes(`data-list="${c.list}"`));
    assert.equal(matched.length, 1, `${c.name}:应恰好有一处 data-list="${c.list}" 的封面 <image>`);
    const img = matched;
    assert.match(img[0], /binderror="onCoverError"/, `${c.name}:没绑 binderror`);
    assert.match(img[0], new RegExp(`data-list="${c.list.replace('.', '\\.')}"`), `${c.name}:data-list 不对`);
    assert.match(img[0], /data-idx="\{\{ ?index ?\}\}"/, `${c.name}:data-idx 不对`);
    assert.match(img[0], /data-key="\{\{ ?item\.id ?\}\}"/, `${c.name}:没带稳定身份 data-key,迟到事件会标错卡`);
    // 2026-08-26:已登记玩法优先走具象图标位,封面 <image> 因此降为 wx:elif ——
    // 守的不变量没变(缺图/失败时不许仍然渲染 <image>),只是它前面多了一个分支。
    assert.match(img[0], /wx:(?:if|elif)="\{\{ item\.imgUrl && !item\._coverFail \}\}"/, `${c.name}:缺图/失败时仍会渲染 <image>`);
  });
});

test('两处列表封面位都有明确失败态,复用原封面类保几何,且带主题名', () => {
  COVERS.forEach((c) => {
    const fb = new RegExp(`<view wx:else[^>]*class="${c.cls} cover-error"[^>]*aria-role="img"[^>]*aria-label="\\{\\{ ${c.title.replace('.', '\\.')} \\}\\} 的封面未能加载"[^>]*>[\\s\\S]*?<image[^>]*class="cover-error-icon"[^>]*src="\\{\\{ coverErrorSrc \\}\\}"[^>]*>[\\s\\S]*?<text class="cover-error-text">封面暂不可用<\\/text>`, 'sg');
    assert.ok(fb.test(WXML), `${c.name}:没有 wx:else 明确失败态(或没复用 .${c.cls} 保持几何)`);
  });
});

test('失败态统一复用已有 no_data 图标,不保留伪内容图或首字/CSS 占位', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/template/index.js'), 'utf8');
  assert.match(src, /coverErrorSrc:\s*'\/images\/no_data\.svg'/);
  assert.doesNotMatch(src, /home-route-city-placeholder\.jpg/);
  assert.doesNotMatch(WXML, /cover-fb(?:-letter)?/);
  assert.doesNotMatch(WXSS, /\.cover-fb(?:-letter)?\s*\{/);
});

test('头牌 banner 的非空远端封面有 binderror 和 no_data 失败态', () => {
  [
    { target: 'banner', cls: 'feat-bgimg', key: 'banner.id' },
  ].forEach(({ target, cls, key }) => {
    const remote = new RegExp(`<image wx:if="\\{\\{ ${target}\\.imgUrl && !${target}\\._coverFail \\}\\}"[^>]*class="${cls}"[^>]*data-target="${target}"[^>]*data-key="\\{\\{ ${key.replace('.', '\\.')} \\}\\}"[^>]*binderror="onDetailCoverError"`, 's');
    assert.match(WXML, remote, `${target}:非空远端封面必须有稳定身份 binderror`);
    const fallback = new RegExp(`<view wx:else[^>]*class="${cls} cover-error"[^>]*>[\\s\\S]*?src="\\{\\{ coverErrorSrc \\}\\}"[\\s\\S]*?封面暂不可用`, 's');
    assert.match(WXML, fallback, `${target}:失败后必须落到 no_data 失败态`);
  });
});

test('没有按 URL/标题写死的黑名单(兜底是失败态,不是内容治理,更不能伪装成版权已解决)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/template/index.js'), 'utf8');
  [src, WXML, WXSS].forEach((text) => {
    assert.ok(!/\bmuse\b/i.test(text), '不许按图名/URL 黑名单藏图');
    assert.ok(!/亲子寻光记/.test(text), '不许按主题标题黑名单藏图');
  });
});

// ---------- 横滑几何契约(复审曾在这里抓到「注释说 56rpx、实际露 24rpx」的对不上) ----------

// 2026-08-20 画板05:最新主题从横滑轨改纵向列表行,cml 的几何锚点跟着换(行内小图 176×132)。
test('版式几何:banner 轨对齐/露出与最新主题行内小图几何被钉住', () => {
  // 2026-08-26:banner 从 swiper 轮播改成单张头牌(四刀切退役后没有第二张可轮),
  // 露出/残影那套推导随轮播一起作废;新的几何锚点是「扫光环 + 卡面」两层。
  assert.doesNotMatch(WXML, /<swiper class="feat-swiper/, '轮播已退役,不该再回来');
  assert.match(WXML, /<view class="feat-glow">/, 'banner 必须套扫光环');
  assert.match(WXML, /<view class="feat-glow__face feat-media"/, '卡面必须盖住扫光层中心,否则整卡被渐变糊住');
  assert.match(WXSS, /\.feat-glow\s*\{[^}]*overflow: hidden/, '扫光层靠溢出裁剪成描边');
  assert.match(WXSS, /\.feat-glow\s*\{[^}]*transform: translateZ\(0\)/, '安卓上 radius+overflow 要提合成层才裁得干净');
  assert.match(WXSS, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.feat-glow__sweep\s*\{[^}]*animation: none/, '减动效必须显式停掉,不能只靠全局压时长');
  assert.match(WXSS, /\.feat-slide\s*\{[^}]*padding: 0 var\(--cy-page-x\)/);
  assert.match(WXSS, /\.feat-text\s*\{[^}]*padding: var\(--cy-space-3\)/);
  assert.match(WXSS, /\.cml-card\s*\{[^}]*display: flex/, '最新主题必须是横排行(图左文右)');
  assert.match(WXSS, /\.cml-pic\s*\{[^}]*width: 176rpx/, '行内小图几何变了要重新核对裁切比');
});

test('兜底使用本地图片而非主题文本', () => {
  assert.doesNotMatch(WXML, /class="cover-fb/);
  assert.doesNotMatch(WXSS, /\.cover-fb/);
  // --tpl-rail-fade 断言随横滑轨退役删除(2026-08-20 画板05:最新主题改纵向行,渐隐罩不存在了)
});
