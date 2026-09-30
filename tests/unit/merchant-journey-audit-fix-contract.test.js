// 商家闭环审计修码契约(2026-08-31)
// 弹窗打不开、模板配不进、入驻时段滚不出、工作台假消息、财务岗收入空、口碑星不读评分。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shapePage } = require('../../pages/merchant/reviews/view-model.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('cy-dropdown 面板必须经 root-portal 挂到页面根，避免被 cy-sheet 的 transform/overflow 裁掉', () => {
  const wxml = read('components/cy/dropdown/index.wxml');
  assert.match(wxml, /<root-portal[\s\S]*cdd__layer/,
    'fixed 层嵌在带 transform 的 sheet 里会建立新包含块，选择面板被裁到看不见');
  const wxss = read('components/cy/dropdown/index.wxss');
  assert.match(wxss, /\.cdd__layer\s*\{[^}]*z-index:\s*var\(--cy-z-modal(?:,\s*\d+)?\)/,
    '传送到页面根后必须压过 sheet 档，否则面板落在承接半屏下面');
});

test('经营时间入驻滚轮必须矮到能放进 50vh 的 date-sheet，不改共享 overflow', () => {
  const apply = read('pages/merchant/apply/index.wxss');
  const picker = apply.match(/\.hp-time-picker\s*\{[^}]+\}/);
  assert.ok(picker, '入驻经营时段滚轮高度必须有确定值');
  const height = picker[0].match(/height:\s*(\d+)rpx/);
  assert.ok(height, '入驻滚轮必须用 rpx 定高');
  assert.ok(Number(height[1]) <= 280,
    '单个滚轮不得超过 280rpx，否则加上经营日格会把结束时段顶出 50vh');

  const wxss = read('components/cy/date-sheet/index.wxss');
  const body = wxss.match(/\.ds-body\s*\{[^}]+\}/);
  assert.ok(body, '.ds-body 规则必须存在');
  assert.match(body[0], /overflow:\s*hidden/,
    '共享 date-sheet 不能改成 overflow-y:auto，父级滚动会和 picker-view 抢手势');
});

test('承接点位玩法列表必须带商家 scope，且空列表提供去创建', () => {
  const js = read('pages/topic/components/cy/chapter-node-form/index.js');
  const wxml = read('pages/topic/components/cy/chapter-node-form/index.wxml');
  assert.match(js, /url:\s*'\/api\/template\/my-list'/);
  assert.doesNotMatch(js, /draft_status:\s*1/,
    '只取已发布会把草稿和刚从货架拷来的玩法挡在承接表单外');
  assert.match(js, /scope:\s*['"]MERCHANT['"]/,
    '商家玩法挂在店主 memberId 下，不传 MERCHANT 会读到个人模板空集');
  assert.match(js, /goCreateTemplate\s*\(/);
  assert.match(wxml, /templates\.length/, '有列表才渲染下拉');
  assert.match(wxml, /去创建玩法/, '空列表必须给出可执行入口，对齐常备权益');
  assert.match(js, /pages\/publish\/temp\/index\?scope=MERCHANT/);
});

test('承接半屏必须能滚到申请按钮，不能 overflow:hidden 把章节列表裁死', () => {
  const wxss = read('pages/topic/merchantinfo/merchantinfo.wxss');
  const pop = wxss.match(/\.pop-topic\s*\{[^}]+\}/);
  assert.ok(pop, '.pop-topic 规则必须存在');
  assert.doesNotMatch(pop[0], /overflow:\s*hidden/,
    '章节一多时申请承接按钮会出屏，hidden 让半屏彻底滚不动');
  assert.match(pop[0], /overflow-y:\s*auto/);
  assert.match(pop[0], /max-height:/);
});

test('工作台事件接口为空时不得用报名列表编造待处理报名', () => {
  const js = read('pages/merchant/index/index.js');
  assert.doesNotMatch(js, /buildNotifications\s*\(/,
    'events 空数组是「没有真实动态」，不能拿 joinList 编三条待处理报名');
  assert.match(js, /notifications:\s*\[\]/);
});

test('工作台零项目时整块「项目」不显示，不出现去承接 CTA', () => {
  // 2026-09-18 用户走查 UI-01:没有项目就不要「项目」标题 + 空态,整块退场。
  const wxml = read('pages/merchant/index/index.wxml');
  const js = read('pages/merchant/index/index.js');
  assert.doesNotMatch(wxml, /去承接/);
  assert.doesNotMatch(wxml, /<cy-empty[^>]*还没有项目/);
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canManageProjects && \(projectCards\.length \|\| joinLoading \|\| hostLoading \|\| todoLoading \|\| gameEntryLoading \|\| joinError \|\| hostError\)\}\}"/,
    '零项目且无加载/错误时整块不渲染');
  assert.doesNotMatch(js, /goCoopCenter\s*\(/);
  assert.doesNotMatch(wxml, /rv-project-empty[^>]*bindtap="goPublishTopic"/);
  assert.doesNotMatch(js, /goPublishTopic\s*\(/);
});

test('工作台看板/待办/动态按岗位权限码加载，收入段只认 canReadFinance（P4 #17-1）', () => {
  const js = read('pages/merchant/index/index.js');
  const wxml = read('pages/merchant/index/index.wxml');
  const load = js.match(/loadMerchantConsole\([^)]*\)\s*\{[\s\S]*?\n  \},/);
  assert.ok(load, 'loadMerchantConsole 锚点失效');
  assert.doesNotMatch(load[0], /roleCode\s*===\s*'MERCHANT_OWNER'/,
    '工作台数据不再只给店主，改为按岗位权限码加载');
  assert.match(load[0],
    /canReadFinance\s*\|\|\s*currentAccess\.canReadOrders\s*\|\|\s*currentAccess\.canReadMarketing[\s\S]*loadDashboard/,
    '看板按 FINANCE_READ/ORDER_READ/MARKETING_READ 三个数据块的读权限加载');
  assert.match(load[0],
    /canReadVerifyRecords[\s\S]*loadTodo/,
    '待办按核销记录读权限加载（后端块内再按各权限取数）');
  assert.match(load[0], /todoError:\s*true/,
    '没权限取待办时要保持「未取到」态，不能写成全 0 的假空态');
  assert.match(wxml, /wx:if="\{\{merchantAccess\.canReadFinance\}\}"/,
    '收入数字按 FINANCE_READ 渲染，不再叠加店主身份');
  assert.doesNotMatch(wxml, /canReadFinance && merchantAccess\.roleCode === 'MERCHANT_OWNER'/,
    '财务岗也能看收入；旧注释与实际合同一并退役');
});

test('口碑汇总星按 averageRating 点亮，5 星全 filled 是假满分', () => {
  const wxml = read('pages/merchant/reviews/index.wxml');
  assert.match(wxml, /wx:for="\{\{ratingStars\}\}"/);
  assert.doesNotMatch(wxml, /review-rating-stars[\s\S]{0,200}wx:for="\{\{\[1,2,3,4,5\]\}\}"/);

  const filled = shapePage({
    mode: 'manage', pageNum: 1, pageSize: 20, total: 1, hasMore: false,
    averageRating: 3.2,
    items: [{
      id: 1, version: 0, rating: 3, status: 'VISIBLE', imageUrls: [],
      verifiedRedemption: true, canReply: true, canReport: true,
    }],
  }, 'manage');
  assert.ok(filled);
  assert.deepEqual(filled.ratingStars.map((star) => star.filled), [true, true, true, false, false]);

  const empty = shapePage({
    mode: 'manage', pageNum: 1, pageSize: 20, total: 0, hasMore: false, items: [],
  }, 'manage');
  assert.ok(empty);
  assert.deepEqual(empty.ratingStars.map((star) => star.filled), [false, false, false, false, false]);
});
