'use strict';
// 投一张换一张(§6.4)。这一套是从「城瘾玩法试玩台」原样搬来的,视觉一像素没改;
// 本文件钉的是**机制**,不是像素:投在前换在后、撕之前刮不动、刮够六成才放行。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const JS = () => read('subpackageRoam/citystamp/index.js');
const WXML = () => read('subpackageRoam/citystamp/index.wxml');
const WXSS = () => read('subpackageRoam/citystamp/index.wxss');

test('先投后换:没存成自己那张就不换别人那张', () => {
  const js = JS();
  // create 的回包里拿到 id 才去 exchange;拿不到 id 走失败分支,不继续
  assert.match(js, /_createStamp\([\s\S]{0,700}?roam\/stamp\/create[\s\S]{0,500}?if \(!id\) \{ this\._failDeliver[\s\S]{0,80}?return; \}\s*\n\s*if \(this\._stampState\) this\._stampState\.stampId = id;[\s\S]{0,80}?this\._exchange\(id\);/);
  // 两个 exchange 调用点都必须「手里已有一个 create 回来的 id」:一条是刚入库的 id,
  // 一条是重试复用的 stampId —— 没有能绕过「先投」的路。
  assert.equal((js.match(/this\._exchange\(/g) || []).length, 2);
  assert.match(js, /if \(state\.stampId\) \{ this\._exchange\(state\.stampId\); return; \}/);
  // 图先上传再存票:本地临时路径别人看不到,存进去别人换到的是一张裂图
  assert.match(js, /uploadAll\(\[this\.data\.photo\][\s\S]{0,400}?that\._createStamp\(url, state\.idem\)/);
});

test('换不到就如实说,不编一张票出来', () => {
  const wxml = WXML();
  const js = JS();
  // got=false 时画的是说明,不是一张空小票
  assert.match(wxml, /wx:if="\{\{!got\}\}" class="sgempty"/);
  assert.match(wxml, /wx:else class="sgpaperwrap"/);
  // 理由取服务端的,取不到才回落到本地那句
  assert.match(wxml, /\{\{gotReason \|\| '还没有可以换的票'\}\}/);
  assert.match(js, /gotReason: d\.reason \|\| ''/);
});

test('撕断:拉过 80px 才撕,不到就弹回去', () => {
  const js = JS();
  assert.match(js, /const TEAR_PX = 80;/);
  assert.match(js, /if \(dy < TEAR_PX\) \{[\s\S]{0,300}?paperY: 0, paperRot: 0[\s\S]{0,60}?return;/);
  // 撕断之后槽里留一小截纸头,纸的上边出现撕口锯齿
  assert.match(WXML(), /wx:if="\{\{torn\}\}" class="sgprinter__stub"/);
  assert.match(WXSS(), /\.sgpaper\.held \.sgslip::before/);
});

test('撕之前刮不动;刮够六成才解锁「收下，出发」', () => {
  const js = JS();
  const wxml = WXML();
  assert.match(js, /const SCRATCH_DONE = 0\.6;/);
  // 刮层只在撕下来之后才初始化,而且 onScratch 自己再判一次 torn
  assert.match(js, /torn: true[\s\S]{0,160}?\(\) => this\._initScratch\(\)/);
  assert.match(js, /onScratch\(e\) \{[\s\S]{0,160}?if \(!c \|\| !this\.data\.torn \|\| this\.data\.revealed\) return;/);
  // 没刮开就点「收下」要说清楚,不是静默无反应
  assert.match(js, /onDone\(\) \{\s*\n\s*if \(this\.data\.got && !this\.data\.revealed\) \{ cyToast/);
  assert.match(wxml, /class="sgbtn \{\{\(got && !revealed\) \? 'is-off' : ''\}\}"/);
});

test('配文 30 字上限带计数,空着也能投', () => {
  const js = JS();
  const wxml = WXML();
  assert.match(js, /const CAPTION_MAX = 30;/);
  assert.match(wxml, /maxlength="\{\{CAPTION_MAX\}\}"/);
  assert.match(wxml, /\{\{note\.length\}\}\/\{\{CAPTION_MAX\}\}/);
  // 拦的是「没拍照」,不是「没写字」—— 空着也能投
  assert.match(js, /if \(!this\.data\.photo\) \{ cyToast\('先拍一张'\); return; \}/);
  assert.doesNotMatch(js, /if \(!this\.data\.note[\s\S]{0,40}?return;/);
});

test('取景框:关闭左上、全屏左下、快门居中、翻转右下,顶边让到胶囊底下', () => {
  const wxml = WXML();
  const wxss = WXSS();
  const js = JS();
  /* 2026-09-11 取景卡抽成共用组件 cy-proto-cam(漫游与集邮册也用同一件),
     所以这几条改读组件;本页只断言它确实挂了这件、并接住了 shot/close 两个事件。 */
  const camWxml = read('components/cy/proto-cam/index.wxml');
  const camWxss = read('components/cy/proto-cam/index.wxss');
  assert.match(wxml, /<cy-proto-cam[^>]*bind:shot="onCamShot"[^>]*bind:close="onCamClose"/);
  assert.match(read('subpackageRoam/citystamp/index.json'), /"cy-proto-cam"\s*:\s*"\/components\/cy\/proto-cam\/index"/);
  assert.match(camWxml, /class="cam__x"[\s\S]{0,200}?bindtap="onCamClose"/);
  assert.match(camWxml, /class="cam__full"[\s\S]{0,200}?bindtap="onCamFull"/);
  assert.match(camWxml, /class="cam__flip"[\s\S]{0,200}?bindtap="onCamFlip"/);
  assert.match(camWxml, /class="cam__shutter"[\s\S]{0,200}?bindtap="onShoot"/);
  assert.match(camWxss, /\.cam__x\{ position:absolute; left:/);       // 左上
  assert.match(camWxss, /\.cam__full\{ position:absolute; left:[^}]*bottom:/); // 左下
  assert.match(camWxss, /\.cam__flip\{ position:absolute; right:[^}]*bottom:/); // 右下
  // 顶边由胶囊实测坐标算,不写死
  assert.match(js, /resolveMenuChrome\(w, getMenu && getMenu\.call\(wx\)\)\.contentTop/);
  assert.match(camWxml, /style="top:\{\{camFull \? 0 : topSafe\}\}px"/);
});

test('黑玻璃垫地图,纸和机器保持原样', () => {
  const wxss = WXSS();
  // 44% 黑 + 18px 模糊(§6.5)
  assert.match(wxss, /\.sg\{[\s\S]{0,400}?background:rgba\(8,8,10,\.44\);[\s\S]{0,80}?backdrop-filter:blur\(18px\)/);
  // 纸是白的 —— 白纸变黑就不是纸了
  assert.match(wxss, /\.sgslip\{ position:relative; background:#FFFFFF/);
  // 机身与出纸槽是原型那两张拉丝位图,不是自己画的渐变。
  // 2026-09-09 用户点名:「直接搬代码,不要参考着做」—— 之前这里被我换成 linear-gradient。
  assert.match(wxss, /\.sgprinter\{[\s\S]{0,300}?url\("\.\/printer-body\.jpg"\) center\/cover no-repeat/);
  assert.match(wxss, /\.sgprinter__slot\{[\s\S]{0,300}?url\("\.\/printer-slot\.jpg"\) center\/cover no-repeat/);
  // 倒角高光层与螺丝刻线原型有,之前也漏了
  assert.match(wxss, /\.sgprinter::before\{/);
  assert.match(wxss, /\.sgscrew::after\{/);
  // 信箱的落地投影
  assert.match(wxss, /\.sgpb__img\{[\s\S]{0,200}?filter:drop-shadow\(/);
  const fs2 = require('node:fs');
  for (const f of ['printer-body.jpg', 'printer-slot.jpg']) {
    assert.ok(fs2.existsSync(path.resolve(__dirname, '../../subpackageRoam/citystamp/' + f)), f + ' 必须随分包交付');
  }
});

test('信箱与素材放在分包里,不占主包资源棘轮', () => {
  const wxml = WXML();
  assert.match(wxml, /src="\/subpackageRoam\/citystamp\/mailbox\.png"/);
  assert.ok(fs.existsSync(path.resolve(__dirname, '../../subpackageRoam/citystamp/mailbox.png')));
  const app = JSON.parse(read('app.json'));
  const roam = (app.subPackages || app.subpackages).find((s) => s.root === 'subpackageRoam');
  assert.ok(roam.pages.includes('citystamp/index'), '页面必须注册进分包,否则跳过去是白屏');
});

test('图走全站统一上传通道,不自造 app.uploadFile,也不裸调 wx.uploadFile', () => {
  const js = JS();
  // 2026-09-09 自审抓到:原来写的是 app.uploadFile({filePath,success,fail}) —— app 上根本没有
  // 这个方法,一按「投进信箱」就 TypeError,整段玩法当场断在第一步。
  assert.match(js, /app\.getUploadClient\(\)\.uploadAll\(\[this\.data\.photo\], \{/);
  assert.doesNotMatch(js, /app\.uploadFile\(/);
  // 裸 wx.uploadFile 不带 Authorization,服务端认不出人
  assert.doesNotMatch(js, /wx\.uploadFile\(/);
  // 回包是 results[0] 字符串,不是 {url} 对象
  assert.match(js, /r\.results && r\.results\[0\]/);
  // 传不上去要说话,不能静默把没有图的票存进去
  assert.match(js, /if \(!url\) \{ that\._failDeliver/);
});

test('取画布几何必须带 rect,否则刮层坐标是 NaN、永远刮不开', () => {
  const js = JS();
  // 2026-09-09 自审抓到:原来只要了 size —— 它给 width/height,不给 left/top。
  // clientX - undefined = NaN,arc(NaN,NaN) 什么也不画,而且一句报错都没有:
  // 用户对着刮不动的灰层,「收下，出发」永远是灰的。
  assert.match(js, /select\('#sgcover'\)\.fields\(\{[^)]*rect: true/);
  // 坐标确实是拿 left/top 减出来的 —— 上面那条才有意义
  assert.match(js, /const x = t\.clientX - c\.left;/);
  assert.match(js, /const y = t\.clientY - c\.top;/);
});

// ---------- 2026-09-16 C 组修复 ----------

const PAGE_MODULE = '../../subpackageRoam/citystamp/index.js';

function loadCityStampPage(appMock) {
  let definition;
  const previous = {
    Page: global.Page, getApp: global.getApp,
    getCurrentPages: global.getCurrentPages, wx: global.wx,
  };
  try {
    global.Page = (config) => { definition = config; };
    global.getApp = () => (appMock || { globalData: {} });
    global.getCurrentPages = () => [{}];
    global.wx = {};
    delete require.cache[require.resolve(PAGE_MODULE)];
    require(PAGE_MODULE);
  } finally {
    global.Page = previous.Page;
    global.getApp = previous.getApp;
    global.getCurrentPages = previous.getCurrentPages;
    global.wx = previous.wx;
  }
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return page;
}

test('C-03 三个出口共用的 _leave 必须有定义:有上一页退页,冷启动回漫游', () => {
  const js = JS();
  // 三处调用点
  assert.match(js, /onCamClose\(\) \{ this\._leave\(\); \}/);
  assert.match(js, /onBack\(\) \{ this\._leave\(\); \}/);
  assert.match(js, /onDone\(\) \{[\s\S]{0,200}?this\._leave\(\);/);
  // 而且真的有定义(2026-09-12 重构删漏过,三处全 TypeError,页面无系统返回箭头)
  assert.match(js, /_leave\(\) \{\s*\n\s*if \(getCurrentPages\(\)\.length > 1\) \{ wx\.navigateBack\(\); return; \}/);

  const page = loadCityStampPage();
  const calls = [];
  const previousWx = global.wx;
  const previousPages = global.getCurrentPages;
  try {
    global.wx = { navigateBack: () => calls.push('back'), switchTab: (o) => calls.push('tab:' + o.url) };
    global.getCurrentPages = () => [{}, {}];
    page._leave();
    global.getCurrentPages = () => [{}];
    page._leave();
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousPages;
  }
  assert.deepEqual(calls, ['back', 'tab:/pages/roam/index']);
});

test('C-07 换票失败重试复用已创建的签 id,不再重复 create(重复入册)', async () => {
  const requests = [];
  const appMock = {
    globalData: {},
    sendRequest: (opts) => {
      requests.push(opts.url);
      opts.success({ code: 200, data: { exchanged: false, reason: '还没有可以换的票' } });
    },
  };
  const page = loadCityStampPage(appMock);
  // 模拟「create 已成功、exchange 断网」后的重试:stampId 已在,应答不再走 create
  page._stampState = { idem: 'cs-fixed', stampId: 501 };
  page._postAndExchange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, ['/api/roam/stamp/exchange'],
    '已入库的签重试时必须直接续换,再 create 一次就是重复入册');
});

test('C-08 保存到相册:远端票图先下载成本地文件;下载失败不把用户引去开相册权限', () => {
  const js = JS();
  assert.match(js, /if \(\/\^https\?:\\\/\\\/\/\.test\(src\)\)/);
  assert.match(js, /wx\.downloadFile\(\{\s*\n\s*url: src/);
  assert.match(js, /save\(r\.tempFilePath\)/);
  assert.match(js, /msg\.indexOf\('auth'\) >= 0 \|\| msg\.indexOf\('authorize'\) >= 0/,
    '只有授权被拒才引导开相册权限');

  const page = loadCityStampPage();
  page.data.torn = true;
  page.data.gotPic = 'https://cdn.example.com/a.png';
  const calls = [];
  const previousWx = global.wx;
  try {
    global.wx = {
      downloadFile: (o) => { calls.push('download'); o.success({ tempFilePath: '/tmp/a.png' }); },
      saveImageToPhotosAlbum: (o) => { calls.push('save:' + o.filePath); if (o.success) o.success(); },
      openSetting: () => calls.push('setting'),
      showToast: () => {},
    };
    page.onSave();
  } finally { global.wx = previousWx; }
  assert.deepEqual(calls, ['download', 'save:/tmp/a.png'],
    'http 图片地址不是本地文件路径,必须先下载');

  // 本地路径直存,不白下载一次
  const page2 = loadCityStampPage();
  page2.data.torn = true;
  page2.data.gotPic = 'wxfile://tmp/local.png';
  const calls2 = [];
  const previousWx2 = global.wx;
  try {
    global.wx = {
      saveImageToPhotosAlbum: (o) => { calls2.push('save:' + o.filePath); if (o.success) o.success(); },
      downloadFile: () => calls2.push('download'),
      showToast: () => {},
    };
    page2.onSave();
  } finally { global.wx = previousWx2; }
  assert.deepEqual(calls2, ['save:wxfile://tmp/local.png']);

  // 下载失败:说是图没下来,不弹相册设置
  const page3 = loadCityStampPage();
  page3.data.torn = true;
  page3.data.gotPic = 'https://cdn.example.com/b.png';
  const calls3 = [];
  const previousWx3 = global.wx;
  try {
    global.wx = {
      downloadFile: (o) => { calls3.push('download'); o.fail({ errMsg: 'downloadFile:fail' }); },
      openSetting: () => calls3.push('setting'),
      showToast: () => calls3.push('toast'),
    };
    page3.onSave();
  } finally { global.wx = previousWx3; }
  assert.deepEqual(calls3, ['download', 'toast'],
    '下载失败与相册授权是两回事,不能无脑引导去开权限');
});
