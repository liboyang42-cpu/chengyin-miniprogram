/**
 * CU-M-92:只接了合作邀约、还没有自己点位的商家,点「进入项目」该落到哪一屏。
 *
 * 现场(CU-M-92 复现):商家 9002 接受邀约 #990026 后进项目,看到的是主题介绍 + 路线节点 +
 * 底部「报名」,点报名还得「报名时间信息不完整」—— 那是玩家/招商浏览页,不是承接方的管理页。
 *
 * 这一改的前提在后端:/api/project/home 认下「已接受的协作邀约」这层关系(见
 * ProjectHomeReadServiceImpl#findAcceptedMerchantInvite)。这里守的是前端这半边:
 *   1. 受邀方渲染承接视图(project-join),并拿到顶部那排关系入口;
 *   2. **不伪造站点** —— 接受 type0 邀约落的是整主题商务条款(coop_order),从不生成报名行
 *      (后端 [D22] 写死了这个决定),所以没有「我承接的节点/章节」可列,那几块必须整块不出;
 *   3. 只有真能用的入口才给:扫码(他的核销资格正来自那张合作单)与俱乐部;
 *      「客户」「更多」的动作全挂在报名行上,给他等于给两颗必然报错的按钮。
 */
process.env.TZ = 'UTC';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = '../../pages/topic/merchantinfo/merchantinfo.js';
const HOST_WXML = path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.wxml');
const JOIN_DIR = path.resolve(__dirname, '../../pages/topic/components/project-join');

let pageConfig;
let requests;
let navigations;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  sendRequest: (options) => { requests.push(options); return { abort() {} }; },
  tips: () => {},
});
global.wx = {
  navigateTo: (options) => navigations.push(options),
  reLaunch: () => {},
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => {},
  pageScrollTo: () => {},
  showModal: () => {},
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  requests = [];
  navigations = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => {
    Object.keys(patch).forEach((key) => {
      if (key.indexOf('.') < 0) { page.data[key] = patch[key]; return; }
      const parts = key.split('.');
      let cur = page.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = patch[key];
    });
  };
  return page;
}

/** /api/project/home 对「只接了邀约、没有点位」的受邀方下发的形状(与后端 buildCoopOnlyJoin 对齐) */
function coopOnlyHome() {
  return {
    role: 'join',
    topic: {
      id: 990030, name: '外滩夜行', imgUrl: 'https://cdn/chengyin/cover.jpg',
      startDate: '2026-10-01 00:00:00', endDate: '2026-10-20 23:59:59', productType: 1,
    },
    join: {
      coopInvite: { inviteId: 990026, fromId: 10, terms: '分成 20%', handleTime: '2026-09-20' },
      clubs: [{ clubId: 400, name: '夜行者俱乐部', leaderName: '阿周', phone: '13800000001' }],
    },
  };
}

/** 走一遍受邀方入口:onLoad(topicId) → 后端判身份 → 拿到 join.coopInvite */
function openAsInvitedPartner(payload) {
  const page = makePage();
  page.onLoad({ topicId: '990030', scope: 'MERCHANT' });
  const home = requests.find((r) => r.url === '/api/project/home');
  assert.ok(home, '带 topicId 进来必须由后端判身份');
  home.success({ code: 200, data: payload });
  return page;
}

test('受邀方落承接视图:role=join、没有报名行也不去查一条不存在的详情', () => {
  const page = openAsInvitedPartner(coopOnlyHome());

  assert.equal(page.data.role, 'join');
  assert.equal(page.data.fromMerchantJoin, false, '不得退回主题浏览页(那是招商/玩家视角)');
  assert.equal(page.data.loadFailed, false, '后端认了这层关系,就不该再是一屏「没能加载到这条承接记录」');
  assert.equal(page.data.regId, 0, '邀约不生成报名行:不许伪造一个 regId');
  assert.equal(page.data.myStations.length, 0);
  assert.equal(requests.some((r) => r.url === '/api/registration/merchant/info'), false,
    '没有报名行还去拉承接详情 = 拿 0 当 id 查,必然报错');

  assert.ok(page.data.coopPartner, '受邀方这一档要有自己的形状,页面据此收掉按站点算的区块');
  assert.equal(page.data.coopPartner.inviteId, 990026);
  assert.equal(page.data.coopPartner.termsText, '分成 20%');
});

test('受邀方的关系入口只给真能用的两格:扫码 + 俱乐部', () => {
  const page = openAsInvitedPartner(coopOnlyHome());

  assert.deepEqual(page.data.quickActions.map((a) => a.key), ['scan', 'club'],
    '「客户」走 /api/project/players、「更多」抽屉里每行都挂报名行 —— 受邀方点了必被拒,不给');

  // 俱乐部抽屉的数据在 project-home 那一次就带回来了,不该再拉一次接口
  assert.equal(page.data.clubSheet.items.length, 1);
  assert.equal(page.data.clubSheet.items[0].name, '夜行者俱乐部');
  assert.equal(requests.filter((r) => r.url === '/api/project/home').length, 1);
});

test('负控:有报名行的承接方仍走原来那条完整链路,不落到受邀方这一档', () => {
  const payload = coopOnlyHome();
  payload.join.registration = { id: 777 };
  payload.join.registrations = [{ id: 777, nodeName: '外滩 18 号' }];
  const page = openAsInvitedPartner(payload);

  assert.equal(page.data.coopPartner, null, '已经有站点的人不该被当成「没有点位」');
  assert.equal(page.data.regId, 777);
  assert.ok(requests.some((r) => r.url === '/api/registration/merchant/info'),
    '有报名行就要回到既有的承接详情链路,数字与玩法才有来源');
});

test('负控:后端没认这层关系时(接口拒)照旧是整页失败态,不渲染半屏假承接', () => {
  const page = makePage();
  page.onLoad({ topicId: '990030', scope: 'MERCHANT' });
  requests.find((r) => r.url === '/api/project/home')
    .success({ code: 500, msg: '你既不是该主题的发布者,也没有承接记录' });

  assert.equal(page.data.loadFailed, true);
  assert.equal(page.data.coopPartner, null);
});

test('组件:coopPartner 有值时按站点算的区块整块不出,底栏也不写退出规则', () => {
  const wxml = fs.readFileSync(path.join(JOIN_DIR, 'index.wxml'), 'utf8');

  const open = wxml.indexOf('<block wx:if="{{ !coopPartner }}">');
  const close = wxml.indexOf('  </block>\n\n  <!-- ===== 只接了合作邀约');
  assert.ok(open > 0 && close > open, '站点区块要整体包在一道 wx:if 里');
  const gated = wxml.slice(open, close);
  for (const title of ['核销', '我承接的', '这一站玩什么', '进度', '开场前要准备']) {
    assert.ok(gated.includes(title), `受邀方没有站点,「${title}」这一块必须留在闸里`);
  }
  assert.match(wxml, /<view class="sec" wx:if="\{\{ coopPartner \}\}">[\s\S]{0,200}你与这条路线的合作/);
  assert.match(wxml, /class="rules" wx:if="\{\{ !coopPartner \}\}"/,
    '「退出与暂停规则」那句的主语是路线场次,他一场都没有');
  assert.match(wxml, /wx:if="\{\{ coopPartner \}\}"[^>]*data-act="goVerify"/,
    '受邀方底栏那颗按钮只能焊在扫码核销上:primaryText 那套按 stateKey 推导的动作在他身上没有来源');

  // prop 必须由宿主真的传过去 —— 漏传时组件永远走 else 分支,而且只有截图看得出来
  const host = fs.readFileSync(HOST_WXML, 'utf8');
  const tag = host.slice(host.indexOf('<project-join'), host.indexOf('/>', host.indexOf('<project-join')));
  assert.match(tag, /coopPartner="\{\{ coopPartner \}\}"/);
  assert.match(fs.readFileSync(path.join(JOIN_DIR, 'index.js'), 'utf8'), /^\s{4}coopPartner: \{/m);
});
