// Phase 3.1 发布校验视觉/交互回归(A 段)——真机运行时灌表单状态,读回 errors 映射 +
// 捕获 toast/定位目标,断言文案/顺序/键零变;并截图供人工确认红字内联渲染。
// validateForm 不发网络、只 setData,prod-safe。
//
// 跑法:ONLY=fabu DEVTOOLS_CLI=.../cli node chengyinhub-xcx/tests/automator/publish-validate.js
//      ONLY=activity ...(支持分次跑)

const path = require('path');
const { closeMiniProgram, openMiniProgram } = require('./harness');

const PROJECT_PATH = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.env.SHOT_DIR || '/tmp';
let passed = 0, failed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  ✔', label); }
  else { failed++; console.log('  ✖', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function gotoPage(mp, route) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await mp.reLaunch('/pages/index/index');
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (await mp.evaluate(() => !!(getApp() && getApp().isAppReady))) break;
        await wait(300);
      }
      await mp.navigateTo('/' + route);
      await wait(800);
      return await mp.currentPage();
    } catch (e) {
      lastErr = e;
      console.log('  …导航重试 ' + attempt + '(' + (e && e.message ? e.message : e) + ')');
      await wait(1500);
    }
  }
  throw lastErr;
}

// 捕获 wx.showToast / wx.pageScrollTo 的参数,供断言文案与定位目标。
async function installCapture(mp) {
  await mp.evaluate(() => {
    const app = getApp();
    app.__v = { toasts: [], scrolls: [] };
    wx.showToast = function (o) { app.__v.toasts.push(o && o.title); o && o.success && o.success(); };
    wx.pageScrollTo = function (o) { app.__v.scrolls.push(o && (o.selector || ('top:' + o.scrollTop))); o && o.success && o.success(); };
  });
}
const readV = (mp) => mp.evaluate(() => getApp().__v);
const resetV = (mp) => mp.evaluate(() => { getApp().__v = { toasts: [], scrolls: [] }; });
const setForm = (mp, patch) => mp.evaluate((p) => {
  const pages = getCurrentPages(); pages[pages.length - 1].setData(p);
}, patch);

async function runFabu(mp) {
  console.log('\n=== fabu(主题发布)A 段校验 ===');
  const page = await gotoPage(mp, 'pages/publish/fabu/index');
  await installCapture(mp);

  // 1) 空表单(清空所有 + 一张空票 + 无章节)
  await setForm(mp, {
    'formData.name': '', 'formData.description': '', 'formData.startDate': '', 'formData.endDate': '',
    startDateTime: '开始时间', endDateTime: '结束时间', 'formData.imgUrl': '',
    selectedCategoryIds: [], 'formData.tickets': [{ name: '', price: '', mode: 0 }], 'formData.chapters': []
  });
  await resetV(mp);
  await page.callMethod('validateForm');
  let errs = await page.data('errors');
  let v = await readV(mp);
  check('空表单首错文案=请填写主题名称', v.toasts[0] === '请填写主题名称', v.toasts);
  check('空表单 errors 首键=name', Object.keys(errs)[0] === 'name', Object.keys(errs));
  check('errors.name 内联短文案正确', errs.name === '请填写主题名称', errs.name);
  await mp.screenshot({ path: SHOT_DIR + '/fabu-empty.png' }).catch(() => page.screenshot && page.screenshot({ path: SHOT_DIR + '/fabu-empty.png' }));

  // 2) 只填名称 → 首错应为描述(确认顺序)
  await setForm(mp, { 'formData.name': '测试主题' });
  await resetV(mp);
  await page.callMethod('validateForm');
  v = await readV(mp);
  check('只填名称→首错=请填写主题描述', v.toasts[0] === '请填写主题描述', v.toasts);

  // 3) 票务双文案分离:toast 带"第N个"前缀,errors 内联无前缀
  await setForm(mp, {
    'formData.name': '测试主题', 'formData.description': '描述', 'formData.startDate': '2025-11-19 09:00',
    startDateTime: '2025-11-19 09:00', 'formData.endDate': '2025-11-19 18:00', endDateTime: '2025-11-19 18:00',
    'formData.imgUrl': 'http://x/x.png', selectedCategoryIds: [1],
    'formData.tickets': [{ name: '', price: -5, mode: 0, startTime: '2025-11-19', endTime: '2025-11-20' }],
    'formData.chapters': [{ nodes: [{}] }]
  });
  await resetV(mp);
  await page.callMethod('validateForm');
  errs = await page.data('errors');
  v = await readV(mp);
  check('票名空:errors.ticketName0 内联短文案', errs.ticketName0 === '请填写票单名称', errs.ticketName0);
  check('票名空:toast 带"第1个票务"前缀', v.toasts[0] === '第1个票务：请填写票单名称', v.toasts[0]);
  check('价格-5:errors.ticketPrice0=价格不能为负数', errs.ticketPrice0 === '价格不能为负数', errs.ticketPrice0);
  await mp.screenshot({ path: SHOT_DIR + '/fabu-ticket.png' }).catch(() => {});

  // 4) 无章节 → 文案 + 定位切到章节 tab(activeTab=0)
  await setForm(mp, { 'formData.tickets': [{ name: '正价票', price: 10, mode: 0, startTime: '2025-11-19', endTime: '2025-11-20' }], 'formData.chapters': [] });
  await resetV(mp);
  await page.callMethod('validateForm');
  errs = await page.data('errors');
  check('无章节:errors.chapters=请至少添加一个章节', errs.chapters === '请至少添加一个章节', errs.chapters);
  check('无章节:定位切到章节 tab(activeTab=0)', (await page.data('activeTab')) === '0', await page.data('activeTab'));
}

async function runActivity(mp) {
  console.log('\n=== activity(活动发布)A 段校验 ===');
  const page = await gotoPage(mp, 'pages/publish/activity/index');
  await installCapture(mp);

  // 1) 空表单 → 首错 name + 滚动定位到 #field-name
  await setForm(mp, {
    'formData.name': '', 'formData.addressName': '', 'formData.description': '',
    'formData.startDate': '', 'formData.endDate': '', 'formData.templateId': 0, 'formData.imgUrl': '',
    selectedCategoryIds: [], 'formData.tickets': [{ name: '', totalStock: 0 }]
  });
  await resetV(mp);
  await page.callMethod('validateForm');
  await wait(200); // scrollToError 在 setTimeout(.,60) 里调 pageScrollTo,等它触发
  let errs = await page.data('errors');
  let v = await readV(mp);
  check('空表单 errors 首键=name', Object.keys(errs)[0] === 'name', Object.keys(errs));
  check('errors.name=请填写活动标题', errs.name === '请填写活动标题', errs.name);
  check('首错滚动定位到 #field-name', v.scrolls[0] === '#field-name', v.scrolls);
  await mp.screenshot({ path: SHOT_DIR + '/activity-empty.png' }).catch(() => {});

  // 2) 只填标题 → 首错=活动地点(顺序),滚动到 #field-address
  await setForm(mp, { 'formData.name': '测试活动' });
  await resetV(mp);
  await page.callMethod('validateForm');
  await wait(200);
  errs = await page.data('errors');
  v = await readV(mp);
  check('只填标题→首键=addressName', Object.keys(errs)[0] === 'addressName', Object.keys(errs));
  check('errors.addressName=请填写活动地点', errs.addressName === '请填写活动地点', errs.addressName);
  check('滚动定位到 #field-address', v.scrolls[0] === '#field-address', v.scrolls);

  // 3) 票务库存 0 → 文案
  await setForm(mp, {
    'formData.name': '测试活动', 'formData.addressName': '某地', 'formData.description': '说明',
    'formData.startDate': '2025-11-19 09:00:00', 'formData.endDate': '2025-11-19 18:00:00',
    'formData.templateId': 5, 'formData.imgUrl': 'http://x/x.png', selectedCategoryIds: [1],
    'formData.tickets': [{ name: '', totalStock: 0 }]
  });
  await resetV(mp);
  await page.callMethod('validateForm');
  errs = await page.data('errors');
  check('票名空:errors.ticketName0=请填写票单名称', errs.ticketName0 === '请填写票单名称', errs.ticketName0);
  check('库存0:errors.ticketStock0=请填写有效的库存数量', errs.ticketStock0 === '请填写有效的库存数量', errs.ticketStock0);

  // 4) 全部合法 → 校验通过
  await setForm(mp, { 'formData.tickets': [{ name: '正价票', totalStock: 50 }] });
  const ok = await page.callMethod('validateForm');
  check('全部合法→validateForm 通过', ok === true, ok);
}

async function main() {
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    const only = process.env.ONLY;
    if (!only || only === 'fabu') await runFabu(mp);
    if (!only || only === 'activity') await runActivity(mp);
  } finally {
    await closeMiniProgram(session);
  }
  console.log('\n==== A 段结果:' + passed + ' 通过 / ' + failed + ' 失败 ====');
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error('[publish-validate] 失败:', e && e.message ? e.message : e); process.exit(1); });
