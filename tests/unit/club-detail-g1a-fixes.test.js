const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DETAIL = '../../pages/club/detail/index.js';
const DETAIL_WXML = '../../pages/club/detail/index.wxml';
const CLUB_WXSS = '../../pages/club/detail/index.wxss';
const { getDangerAction, postExcerpt } = require('../../utils/danger-actions.js');

function readDetailWxml() {
  return fs.readFileSync(path.join(__dirname, DETAIL_WXML), 'utf8');
}

let pageConfig;
let requests;
let navigations;
let toasts;
let scans;
let dcCalls;
let routes;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  getUserRole: () => 'club',
  getImgUrl: (url) => url,
  getAuthorization: () => 'token',
  isDevEnv: () => false,
  chooseImage() {},
  sendRequest: (request) => {
    requests.push(request);
    const handler = routes[request.url];
    if (handler) handler(request);
  },
});

global.wx = {
  showToast(option) { toasts.push(option); },
  showModal() {},
  showLoading() {},
  hideLoading() {},
  stopPullDownRefresh() {},
  navigateTo: (option) => navigations.push(option.url),
  redirectTo: (option) => navigations.push(option.url),
  pageScrollTo() {},
  scanCode(option) { scans.push(option); },
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
};

global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  pageConfig = null;
  requests = [];
  navigations = [];
  toasts = [];
  scans = [];
  dcCalls = [];
  routes = {};
});

function loadPage() {
  delete require.cache[require.resolve(DETAIL)];
  require(DETAIL);
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) });
  page.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key]; });
    if (callback) callback();
  };
  // danger-confirm 是组件;页面 VM 是裸对象,给它一个能记下 open(key, params) 的替身。
  page.selectComponent = (id) => ({
    open: (key, params) => { dcCalls.push({ id, key, params }); return true; },
    busyOn() {}, done() {}, failed() {}, close() {},
  });
  return page;
}

/* ——— CU-C-71:退团的「重入代价」由 club.join_policy 决定,不能全团统一写「要重新申请」 ——— */

test('CU-C-71 公开团(joinPolicy=0)退团确认与回执说的是「直接回来」,不提案审批', () => {
  const page = loadPage();
  page.data.club = { name: '走查俱乐部', joinPolicy: 0 };

  page.onQuit();

  assert.equal(dcCalls.length, 1);
  assert.equal(dcCalls[0].key, 'club.quit');
  const copy = getDangerAction('club.quit', dcCalls[0].params);
  assert.match(copy.content, /可以直接再点「加入俱乐部」/, '公开团退出后是即时加入,确认框必须说实话');
  assert.doesNotMatch(copy.content, /主理人通过/, '公开团没有审批可等,不能套用待审核团的警告');
  assert.match(copy.done.text, /随时可以再点「加入俱乐部」/, '退出成功后的回执同样不能说要审批');
  assert.doesNotMatch(copy.done.text, /\{/, '回执里的占位符必须被填掉,不能印出 {rejoinHint}');
});

test('CU-C-71 审批团(joinPolicy=1)保留「重新申请并等主理人通过」', () => {
  const page = loadPage();
  page.data.club = { name: '走查俱乐部', joinPolicy: 1 };

  page.onQuit();

  const copy = getDangerAction('club.quit', dcCalls[0].params);
  assert.match(copy.content, /重新申请并等主理人通过/, '审批团的重入代价本来就是申请,不能反过来丢掉');
  assert.match(copy.done.text, /重新提交申请，等主理人通过/);
  assert.doesNotMatch(copy.content, /\{/);
});

test('CU-C-71 加入按钮只在审批团被拒后才说「重新申请加入」', () => {
  const wxml = readDetailWxml();
  assert.match(wxml, /club\.joinPolicy == 1 && club\.myJoinStatus === 2 \? '重新申请加入' : '加入俱乐部'/,
    '公开团的按钮不能再叫「重新申请加入」—— 它点了就是立即成为成员');
});

/* ——— CU-C-83(9-25 裁决:加「客户档案」直达):点成员行不许由前端按权限悄悄改道 ——— */

test('CU-C-83 有客户查看权的人点成员行先选落点,不会被悄悄送进 CRM;无权限者仍直进公开主页', () => {
  const page = loadPage();
  page.data.club = { isOwner: true, viewerIsAdmin: true, id: 7, memberId: 1 };
  page.data.clubId = 7;
  page.data.canReadMembers = true;

  page.goMemberProfile({ currentTarget: { dataset: { memberId: 88 } } });

  // 这一条要保护的不变量从没变:入口写着「公开资料」,就不能不问就把人打开
  // 累计实付/到店次数那套 CRM 视图。裁决改的是"问的方式"—— 不再一律只给公开主页,
  // 而是把两个落点摆明让用户选,所以此刻应当一条导航都没发生。
  assert.deepEqual(navigations, [], '有权限时不许不问就改道进客户详情');
  assert.equal(page.data.choiceSheetShow, true);
  assert.deepEqual(page.data.choiceSheetItems.map((item) => item.label), ['公开资料', '客户档案']);

  page.onChoiceSheetSelect({ currentTarget: { dataset: { key: 'public' } } });
  assert.deepEqual(navigations, ['/pages/userinfo/userinfo?userId=88'],
    '选「公开资料」就是脱敏公开主页');

  navigations.length = 0;
  page.goMemberProfile({ currentTarget: { dataset: { memberId: 88 } } });
  page.onChoiceSheetSelect({ currentTarget: { dataset: { key: 'customer' } } });
  assert.deepEqual(navigations, ['/pages/club/customer-detail/index?clubId=7&memberId=88']);

  // 没有客户管理权限的人看不到「客户档案」,点成员行仍是原来那一下直达公开主页。
  const plain = loadPage();
  plain.data.club = { isOwner: false, viewerIsAdmin: false, id: 7, memberId: 1 };
  plain.data.clubId = 7;
  plain.data.canReadMembers = true;
  navigations.length = 0;
  plain.goMemberProfile({ currentTarget: { dataset: { memberId: 92 } } });
  assert.deepEqual(navigations, ['/pages/userinfo/userinfo?userId=92']);
  assert.notEqual(plain.data.choiceSheetShow, true, '无权限不该弹清单');
});

test('CU-C-83 查看客户这条 CRM 入口仍在,客户详情没被砍掉', () => {
  const page = loadPage();
  page.data.club = { id: 7, isOwner: true };
  page.data.clubId = 7;

  page.goCustomers();

  assert.deepEqual(navigations, ['/pages/club/customers/index?clubId=7']);
});

/* ——— CU-C-106:编辑已有动态,有改动时关闭要先问一句 ——— */

test('CU-C-106 正文改过之后关面板,只弹确认不动原稿;确认才丢', () => {
  const page = loadPage();
  page.data.posts = [{ id: 5, content: '原正文', images: '', version: 0, authorMemberId: 1, type: 0 }];
  page.data.myMemberId = 1;

  page.onEditPost({ currentTarget: { dataset: { id: 5 } } });
  assert.equal(page.data.postEditShow, true);
  assert.equal(page.data.postEditText, '原正文');
  assert.equal(page.data.postEditDirty, false);

  // 干净状态:cy-sheet 会同时发 requestclose + close,这里不能弹确认
  page.requestClosePostEdit();
  assert.equal(page.data.postEditDiscardConfirm, false, '没改动就别拦着人关面板');

  page.onPostEditText({ detail: { value: '尚未保存的编辑草稿' } });
  assert.equal(page.data.postEditDirty, true, '改过就是脏的 —— 这是关闭闸的判据');

  page.requestClosePostEdit();
  assert.equal(page.data.postEditDiscardConfirm, true, '有未保存正文时必须先问一句');
  assert.equal(page.data.postEditShow, true, '还没决定,面板要留在原地');
  assert.equal(page.data.postEditText, '尚未保存的编辑草稿');

  page.cancelDiscardPostEdit();
  assert.equal(page.data.postEditDiscardConfirm, false);
  assert.equal(page.data.postEditShow, true, '选「继续编辑」要回到输入态,草稿还在');
  assert.equal(page.data.postEditText, '尚未保存的编辑草稿');

  page.requestClosePostEdit();
  page.confirmDiscardPostEdit();
  assert.equal(page.data.postEditShow, false, '确认放弃才真的收起');
  assert.equal(page.data.postEditText, '');
});

test('CU-C-106 面板接了 dirty 与 requestclose(只挡住遮罩不算闸)', () => {
  const wxml = readDetailWxml();
  assert.match(wxml, /show="\{\{postEditShow\}\}"[^>]*dirty="\{\{postEditDirty\}\}"/,
    'cy-sheet 不传 dirty 的话,右上 ✕ 走的还是直接 close');
  assert.match(wxml, /bind:requestclose="requestClosePostEdit"/);
});

/* ——— CU-C-107:删除动态的确认框要能核对删的是哪一条 ——— */

test('CU-C-107 删除确认带上待删正文前段', () => {
  const page = loadPage();
  page.data.posts = [{ id: 11, content: '【隔离走查】样本动态正文很长很长', images: '', authorMemberId: 1, type: 0 }];

  page.onDeletePost({ currentTarget: { dataset: { id: 11 } } });

  const opened = dcCalls.find((call) => call.key === 'club.post.delete');
  assert.ok(opened, '删除必须先过三段式确认');
  assert.equal(opened.params.id, 11);
  const copy = getDangerAction('club.post.delete', opened.params);
  assert.match(copy.title, /【隔离走查】样本动态正文/, '标题要点出待删的是哪条动态');
  assert.doesNotMatch(copy.title, /\{name\}/, '占位符必须被填掉');
});

test('CU-C-107 纯图片动态不留空占位,长正文按 12 字截断', () => {
  assert.equal(postExcerpt(''), '(仅图片动态)');
  assert.equal(postExcerpt('   '), '(仅图片动态)');
  assert.equal(postExcerpt('短正文'), '短正文');
  assert.equal(postExcerpt('一二三四五六七八九十十一十二十三'), '一二三四五六七八九十十一…');
});

/* ——— CU-C-108:帖子和详情并发,作者徽标不能靠下一次刷新才出现 ——— */

test('CU-C-108 帖子先回来、详情后回来,主理人徽标必须补上', () => {
  const page = loadPage();
  page.data.clubId = 7;

  routes['/api/club/post/list'] = (req) => req.success({
    code: '200',
    data: [{ id: 11, authorMemberId: 9, content: '公告正文', createTime: '2026-09-24 10:00:00', type: 0 }],
  });
  page.loadPosts();
  assert.equal(page.data.posts.length, 1);
  assert.equal(page.data.posts[0].authorBadge, '', '详情还没到,这一轮本来就算不出作者身份');

  routes['/api/club/detail'] = (req) => req.success({
    code: '200',
    data: { id: 7, memberId: 9, name: '走查俱乐部', joinPolicy: 0, memberCount: 2 },
  });
  page.loadDetail(() => {});

  assert.equal(page.data.club.memberId, 9);
  assert.equal(page.data.posts[0].authorBadge, '主理人',
    '详情到达后必须就地补徽标,否则要等到点赞/评论触发下一次 loadPosts 才出现');
});

test('CU-C-108 不是主理人的帖子不会被误标', () => {
  const page = loadPage();
  page.data.posts = [{ id: 11, authorMemberId: 5, content: 'x', authorBadge: '' }];
  page.data.club = { memberId: 9 };

  page.applyClubOwnerBadge();

  assert.equal(page.data.posts[0].authorBadge, '');
});

/* ——— CU-C-60:快捷「扫码」接真扫码,复用共享路由 ——— */

test('CU-C-60 扫码核销真的调起扫码,并按码类型发到对应端点', () => {
  const page = loadPage();
  page.data.club = { isOwner: true };
  page.data.clubId = 7;

  page.onClubScan();

  assert.equal(scans.length, 1, '原来这个钮只跳活动运营页,用户根本看不到扫描器');
  scans[0].success({ result: 'v1.abc.activity.def' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/registration/scan_dynamic_code');
  assert.equal(requests[0].data.code, 'v1.abc.activity.def');

  // 成功用确认框留住结果,不新增成功 toast(全仓成功 toast 棘轮只减不增)
  const modals = [];
  const realShowModal = global.wx.showModal;
  global.wx.showModal = (option) => modals.push(option);
  try {
    const toastCount = toasts.length;
    requests[0].success({ code: '200', msg: '验票成功' });
    assert.equal(modals.length, 1);
    assert.equal(modals[0].content, '验票成功');
    assert.equal(modals[0].showCancel, false);
    assert.equal(toasts.length, toastCount, '成功不再走 toast');
  } finally {
    global.wx.showModal = realShowModal;
  }
});

test('CU-C-60 团码走团核销端点,不是票务端点', () => {
  const page = loadPage();
  page.data.club = { isOwner: true };
  page.data.clubId = 7;

  page.onClubScan();
  scans[0].success({ result: 'v1.abc.group_12345.def' });

  assert.equal(requests[0].url, '/api/verify/groupcode/redeem');
});

test('CU-C-60 扫到无效码时给一句人话;用户取消扫码不报错', () => {
  const page = loadPage();
  page.data.club = { isOwner: true };
  page.data.clubId = 7;

  page.onClubScan();
  scans[0].success({ result: '这不是核销码' });
  assert.equal(requests.length, 0, '认不出来的码不能往核销端点发');
  assert.match(toasts[toasts.length - 1].title, /二维码格式错误/);

  page.onClubScan();
  scans[1].fail({ errMsg: 'scanCode:fail cancel' });
  assert.equal(toasts.length, 1, '用户自己取消不是错误,不该弹提示');
});

test('CU-C-60 快捷扫码钮接的是 onClubScan,活动运营另有入口', () => {
  const wxml = readDetailWxml();
  assert.match(wxml, /catchtap="onClubScan"/, '圆钮的手势要跟「扫码核销」的图标文案对上');
  assert.match(wxml, /catchtap="goEventOps"|bindtap="goEventOps"/, '活动运营入口不能顺手删掉(设置弹窗里那条)');
});

/* ——— 纯模板/文案条目:逐条钉住,避免回退 ——— */

test('CU-C-42 可对接商家的空态不再用 22rpx 的 sm 紧凑档', () => {
  const wxml = readDetailWxml();
  // ⚠️ 必须卡在 <cy-empty 那一行:文件里还有一条内容相同的 E-09 注释,先命中它会让本用例假绿。
  const line = wxml.split('\n').find((row) => row.indexOf('<cy-empty') >= 0 && row.indexOf('还没有开放对接的商家') >= 0);
  assert.ok(line, '商家空态还在');
  assert.doesNotMatch(line, /size="sm"/, '筛选无结果时的可见结局不能用低对比小号灰字');
});

test('CU-C-52 作者本人看不到自己帖子的举报入口', () => {
  const wxml = readDetailWxml();
  const line = wxml.split('\n').find((row) => row.indexOf('catchtap="onReportPost"') >= 0);
  assert.ok(line);
  assert.match(line, /wx:if="\{\{item\.authorMemberId != myMemberId\}\}"/,
    '编辑/删除都有作者条件,举报那一行也必须有不报自己的闸');
});

test('CU-C-53 收到的邀约整行能点进收件箱', () => {
  const wxml = readDetailWxml();
  const line = wxml.split('\n').find((row) => row.indexOf('class="manage-message"') >= 0);
  assert.ok(line);
  assert.match(line, /catchtap="goCoopList"/, '待确认的邀约摘要原来没有去处理的入口');
});

test('CU-C-61 分享入口一律是原生按钮,页面不再用 toast 兜底冒充分享', () => {
  const wxml = readDetailWxml();
  const script = fs.readFileSync(path.join(__dirname, DETAIL), 'utf8');
  const shareButtons = (wxml.match(/^\s*<button[^>]*open-type="share"/gm) || []).length;
  assert.equal(shareButtons, 5, '导航/概览邀请/快捷分享/设置邀请 + 带票分享 = 5 处原生转发');
  assert.doesNotMatch(wxml, /bindtap="onShare"|catchtap="onShare"/, 'view + bindtap 打不开转发面板');
  assert.doesNotMatch(script, /点右上角分享给好友/, '那句 toast 就是「点了没反应」的来源');
  assert.match(script, /onShareAppMessage/, '分享卡片内容仍要留着');
});

test('CU-C-89 承接阶段的文案不点名单个项目', () => {
  const script = fs.readFileSync(path.join(__dirname, DETAIL), 'utf8');
  assert.doesNotMatch(script, /已承接该项目/,
    '阶段判据是「本团有任意一个项目被承接」,写「该项目」会让多项目主理人认错待办');
  assert.match(script, /executionAccepted: \{ label: '活动运营', hint: '[^']*全部项目/);
});

test('CU-C-91 成员行的加入时间不留裸横杠,主理人说的是创建俱乐部', () => {
  const wxml = readDetailWxml();
  assert.doesNotMatch(wxml, /joinTime \|\| '-'/, '空时间印成「-」看起来像加载失败');
  const ownerRows = wxml.split('\n').filter((row) => row.indexOf('member-meta') >= 0);
  assert.ok(ownerRows.length >= 2, '概览与管理弹窗各有一行成员信息');
  ownerRows.forEach((row) => {
    assert.match(row, /wx:if="\{\{item\.isOwner\}\}"> · 创建俱乐部</, '主理人的身份要说明,不留空白');
  });
});

test('CU-C-97 管理 tab 的圆钮叫「设置」,不与页签同名', () => {
  const wxml = readDetailWxml();
  const label = wxml.split('\n').find((row) => row.indexOf('quick-act-label">设置<') >= 0);
  assert.ok(label, '圆钮文案要是「设置」');
  assert.match(label, /设置<\/text>/);
});

test('CU-C-51 概况卡写明统计范围,「参与人次」改称「游玩人次」', () => {
  const wxml = readDetailWxml();
  const wxss = fs.readFileSync(path.join(__dirname, CLUB_WXSS), 'utf8');
  assert.doesNotMatch(wxml, /club-stat-label">参与人次</, '「参与人次」数的是节点游玩人数,不是报名人数');
  assert.match(wxml, /club-stat-label">游玩人次</);
  assert.match(wxml, /club-stats-note">仅统计本俱乐部自办项目/, '口径要写在卡上,否则跟下方项目卡的报名数看起来是两个数');
  assert.match(wxss, /\.club-stats-note \{/);
});

// 集成复审:CU-C-71 改文案时把加入按钮的 wx:else 弄丢了 ⇒ 审核中的人同时看到「等待审核」和可点的「加入俱乐部」,能重复申请。
test('CU-C-71 回归：审核中只显示等待态，加入按钮必须挂在 wx:else 上', () => {
  const wxml = readDetailWxml();
  const cta = wxml.slice(wxml.indexOf('<view class="profile-cta"'), wxml.indexOf('</view>', wxml.indexOf('bindtap="onJoin"')));
  assert.match(cta, /wx:if="\{\{club\.myJoinStatus === 0\}\}"[^>]*>等待审核<\/view>\s*<view wx:else [^>]*bindtap="onJoin"/);
});
