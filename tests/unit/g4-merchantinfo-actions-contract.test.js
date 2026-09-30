process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* 走查 G4 · 承接详情页(merchantinfo / project-host)的那几条:
   CU-C-63 章节申请通过连带点位(裁决 A:保持联动,把话说清) /
   CU-C-64 招商入口丢主题名 / CU-C-67 俱乐部主理人名单与台账 /
   CU-C-68 主办方「本站运营」按商家身份取站点 / CU-C-69 · M-56 权益票夹落点 /
   M-58 重开申请要回填 / M-59 待审核点位不给不可用的配置入口 / M-89 缺图占位。 */

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripWxmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '');

let pageConfig;
let navigations;
let toasts;
let requests;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  sendRequest: (options) => { requests.push(options); return { abort() {} }; },
  tips: (msg) => toasts.push(String(msg)),
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = {
  navigateTo: (options) => navigations.push(options),
  reLaunch: () => {},
  showToast: (options) => toasts.push(String(options && options.title)),
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => {},
  pageScrollTo: () => {},
  nextTick: (fn) => fn(),
};
global.Page = (config) => { pageConfig = config; };
require('../../pages/topic/merchantinfo/merchantinfo.js');

function makePage(overrides) {
  const page = Object.assign({}, pageConfig);
  page.data = Object.assign(JSON.parse(JSON.stringify(pageConfig.data)), overrides || {});
  page.setData = (patch, cb) => {
    Object.keys(patch).forEach((key) => {
      if (key.indexOf('.') < 0) { page.data[key] = patch[key]; return; }
      const parts = key.split('.');
      let cur = page.data;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = patch[key];
    });
    if (cb) cb();
  };
  return page;
}

function findRequest(url) {
  return requests.filter((r) => r.url === url)[0] || null;
}

function beforeEach() {
  navigations = [];
  toasts = [];
  requests = [];
}

/** 开抽屉会顺带探一次站点资格 —— 测试里统一拿那条请求自己喂结果。 */
function hostDrawer() {
  const page = makePage({ role: 'host', topicId: 8001 });
  page.openMoreSheet();
  const probe = findRequest('/api/game/session/merchant/entries');
  assert.ok(probe, 'CU-C-68:开主办方抽屉必须用同一判据源探一次 merchant/entries');
  return { page, probe };
}

function stationGroup(page) {
  return (page.data.moreSheet.groups || []).filter((g) => /本站运营/.test(g.head || ''))[0];
}

test('CU-C-64:去招商/去找俱乐部带的是主题名(info.name),不是不存在的 info.topicName', () => {
  beforeEach();
  const page = makePage({ topicId: 990030, info: { name: '隔离主题' } });
  page.goInviteMerchant();
  page.goInviteClub();
  assert.equal(navigations.length, 2);
  assert.match(navigations[0].url, /^\/pages\/coop\/nearby\/index\?topicId=990030&topicName=/);
  assert.match(navigations[1].url, /^\/pages\/merchant\/relation\/index\?tab=club&topicId=990030&topicName=/);
  for (const nav of navigations) {
    assert.ok(nav.url.includes(encodeURIComponent('隔离主题')), `主题名必须一路带过去:${nav.url}`);
  }
});

test('CU-C-75:主办方「查看收到的申请」带上本主题,不再是全局协作列表', () => {
  beforeEach();
  const page = makePage({ topicId: 990030, info: { name: '隔离主题' } });
  page.goReceivedApplies();
  assert.match(navigations[0].url, /^\/pages\/coop\/list\/index\?tab=received&topicId=990030/);
  assert.ok(navigations[0].url.includes(encodeURIComponent('隔离主题')));
});

test('CU-C-69 / M-56:权益票夹直达常备权益页,且失败不静默', () => {
  beforeEach();
  const { page } = hostDrawer();
  page.onMorePick({ currentTarget: { dataset: { key: 'perk' } } });
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, '/pages/merchant/decor/perks/index', '不再只跳到品牌中心首页');
  assert.equal(typeof navigations[0].fail, 'function', 'navigateTo 必须带 fail 回调,否则失败是静默的');
  navigations[0].fail({ errMsg: 'navigateTo:fail page not found' });
  assert.ok(toasts.some((t) => /权益票夹/.test(t)), '失败要给可见说明');
});

test('CU-C-68:没承接本站的主办方拿到的是置灰的「本站运营」,点下去不发请求', () => {
  beforeEach();
  const { page, probe } = hostDrawer();
  // 后端有回应,但这条主题下没有本商家的站点入口
  probe.success({ code: 200, data: [{ topicId: 8001, activityId: 0 }] });
  const ops = stationGroup(page);
  assert.ok(ops, '分组还在(只是不能点)');
  assert.ok(ops.rows.every((r) => r.disabled === true), '没有本站入口就整组置灰');
  assert.equal(ops.rows[0].tag, '不可用');
  beforeEach();
  page.onMorePick({ currentTarget: { dataset: { key: 'service' } } });
  assert.equal(requests.length, 0, '置灰入口不得真去撞后端');
  assert.equal(navigations.length, 0);
  assert.ok(toasts.some((t) => /承接本站/.test(t)), '要说清为什么点不动');
});

test('CU-C-68:确认不是商家身份时不写「探不到」的说明(那是两种不同的原因)', () => {
  beforeEach();
  const { page, probe } = hostDrawer();
  probe.success({ code: 500, msg: '当前商家不负责本场站点', data: { reasonCode: 'GAME_FORBIDDEN_SCOPE' } });
  assert.equal(page.data.stationOpsErrorText, '', '明确拒绝不是「没探到」');
  assert.equal(stationGroup(page).rows[0].tag, '不可用');
});

test('CU-C-68:本人也承接了本站时照常给入口', () => {
  beforeEach();
  const { page, probe } = hostDrawer();
  probe.success({ code: 200, data: [{ topicId: 8001, activityId: 55 }] });
  const ops = stationGroup(page);
  assert.ok(ops.rows.every((r) => !r.disabled), '有本站入口就不能灰');
  beforeEach();
  page.onMorePick({ currentTarget: { dataset: { key: 'service' } } });
  assert.ok(findRequest('/api/game/session/merchant/entries') || requests.length > 0, '有资格才走真实入口');
});

test('CU-C-68:探不到(空 ≠ 错)时留可见说明并给重试,不默默灰着', () => {
  beforeEach();
  const { page, probe } = hostDrawer();
  probe.fail({ errMsg: 'request:fail timeout' });
  assert.ok(page.data.stationOpsErrorText, '探不到要有可见说明');
  assert.equal(stationGroup(page).rows[0].tag, '待确认');
  const hostWxml = stripWxmlComments(read('pages/topic/components/project-host/index.wxml'));
  assert.match(hostWxml, /wx:if="\{\{ stationOpsErrorText \}\}"[\s\S]{0,200}data-act="probeStationOperable"/,
    '说明要可重试');
  const pageWxml = read('pages/topic/merchantinfo/merchantinfo.wxml');
  assert.match(pageWxml, /station-ops-error-text="\{\{stationOpsErrorText\}\}"/, '页面要把说明透给组件');
});

test('CU-C-63(裁决 A):通过申请时确认框写明本次点位一并通过', () => {
  const js = read('pages/topic/merchantinfo/merchantinfo.js');
  assert.match(js, /content: '通过后商家即可按约定准备供给与点位；本次已提交的点位将一并通过审核。'/,
    '确认框必须说清点位会跟着过审 —— 点位一过审就对玩家公开');
  const hostWxml = stripWxmlComments(read('pages/topic/components/project-host/index.wxml'));
  assert.match(hostWxml, /过审后更新的点位（单独审核）/, '点位卡文案收窄:它管的是过审后的更新');
  assert.match(hostWxml, /通过本申请时，该商家已提交的点位会一并过审/, '章节申请卡上也要就地说明');
});

test('CU-C-67:客户名单读失败与「一单没卖」是两个态', () => {
  beforeEach();
  const page = makePage({ topicId: 990030, role: 'host', operationScope: 'CLUB' });
  page.openPlayerSheet();
  const req = findRequest('/api/project/players');
  assert.ok(req, '打开客户抽屉还是要读本主题名单');
  req.success({ code: 500, msg: '无权查看该探店日门店名单' });
  assert.equal(page.data.playerSheet.errorText, '无权查看该探店日门店名单');
  assert.equal(page.data.playerSheet.emptyText, '', '失败不得占用零单那句空态文案');
  assert.deepEqual(page.data.playerSheet.summary, {}, '失败时不许摆一排 0(那读起来是没人买票)');
  const hostWxml = stripWxmlComments(read('pages/topic/components/project-host/index.wxml'));
  assert.match(hostWxml, /wx:if="\{\{ playerSheet\.errorText \}\}"[\s\S]{0,240}data-act="retryPlayerSheet"/,
    '失败态要可重试,且与空态互斥渲染');
});

test('CU-C-67:俱乐部读数(viewType=CLUB_TOPIC_ROSTER)能被客户抽屉正确整形', () => {
  beforeEach();
  const page = makePage();
  const patch = page.buildPlayerSheet({
    viewType: 'CLUB_TOPIC_ROSTER',
    rows: [
      { registrationId: 1, name: '张三', state: 'arrived', arrived: true, sessionLabel: '2026-09-24 14:00' },
      { registrationId: 2, name: '李四', state: 'contacted', arrived: false, sessionLabel: '2026-09-24 14:00' },
      { registrationId: 3, name: '王五', state: 'pending', arrived: false },
    ],
    summary: { paidCount: 3, pendingCount: 1, contactedCount: 1, arrivedCount: 1 },
  }, 'all');
  assert.equal(patch['playerSheet.shopDay'], false, '俱乐部名单不是「探店日门店名册」口径');
  assert.deepEqual(patch['playerSheet.rows'].map((r) => r.stateText), ['已核销', '已接洽', '待核销']);
  assert.equal(patch['playerSheet.groups'].length, 2, '按场次分组,没场次的归到「未指定场次」');
  assert.equal(patch['playerSheet.summary'].paidCount, 3);
});

test('CU-C-67:「查看台账」按身份分流 —— 俱乐部去名册页,商家才去商家台账', () => {
  beforeEach();
  const club = makePage({ topicId: 990030, operationScope: 'CLUB', info: { clubId: 7002 } });
  club.goLedger();
  assert.equal(navigations[0].url, '/pages/club/enroll/index?clubId=7002&topicId=990030');
  beforeEach();
  const merchant = makePage({ topicId: 990030, operationScope: 'MERCHANT' });
  merchant.goLedger();
  assert.equal(navigations[0].url, '/pages/merchant/ledger/index?view=redemptions');
  beforeEach();
  const clubNoId = makePage({ topicId: 990030, operationScope: 'CLUB', info: {} });
  clubNoId.goLedger();
  assert.equal(navigations.length, 0, '读不到 clubId 不跳一个必然失败的页');
  assert.ok(toasts.some((t) => /关联俱乐部/.test(t)));
});

test('CU-M-58:重开申请时把已有点位带进表单(不是一张会被覆盖的空表)', () => {
  beforeEach();
  const page = makePage({
    topicId: 990030,
    myChapterNodes: [
      { id: 80, chapterId: 9, name: 'Audit coffee station', address: 'A 路 1 号', templateId: 33 },
    ],
    info: { chaptersList: [] },
  });
  page.onChapterTargetConfirm({ detail: { chapterId: 9, chapterName: '第1章', chapter: { termsMode: 'PERK' } } });
  assert.equal(page.data.presetChapterNode.id, 80, '同一章节已有我的点位 → 进表单时带上它');
  assert.equal(page.data.chapterNodeFormVisible, true);
  const noNode = makePage({ topicId: 990030, myChapterNodes: [], info: { chaptersList: [] } });
  noNode.onChapterTargetConfirm({ detail: { chapterId: 12, chapterName: '第2章', chapter: {} } });
  assert.equal(noNode.data.presetChapterNode, null, '真·新申请仍是空表单');
  const wxml = read('pages/topic/merchantinfo/merchantinfo.wxml');
  assert.match(wxml, /presetNode="\{\{presetChapterNode\}\}"/, '要真的传进组件');
});

test('CU-M-59:待审核/已驳回的点位不给「节点NPC」入口,就地说明什么时候能配', () => {
  const wxml = stripWxmlComments(read('pages/topic/merchantinfo/merchantinfo.wxml'));
  const block = wxml.slice(wxml.indexOf('data-node-id="{{chapterNode.id}}"') - 600);
  assert.match(block, /wx:if="\{\{chapterNode\.auditLabel === '已通过'\}\}"/, '入口要与后端闸同一判据');
  assert.match(wxml, /审核通过后可配置节点内容/, '不给入口就要说什么时候能配');
});

test('CU-M-89:节点介绍缺图不留固定高空白', () => {
  const wxml = stripWxmlComments(read('pages/topic/merchantinfo/merchantinfo.wxml'));
  assert.match(wxml, /<image wx:if="\{\{ node\.cmsMemberTemplate\.imgUrl \}\}"[\s\S]{0,160}class="pic" \/>/,
    'imgUrl 是 NULL 就不渲染图片');
  assert.match(wxml, /wx:else class="pic pic--empty"/, '缺图给同尺寸占位');
  const wxss = read('pages/topic/merchantinfo/merchantinfo.wxss');
  assert.match(wxss, /\.pic--empty \{[\s\S]{0,200}background: var\(--cy-bg-subtle\)/, '占位块要有底色,否则还是一块白');
});

test('CU-M-58:表单打开时把已有点位填回字段里(不是一张空表)', () => {
  let componentConfig = null;
  global.Component = (value) => { componentConfig = value; };
  const componentPath = path.join(ROOT, 'pages/topic/components/cy/chapter-node-form/index.js');
  delete require.cache[require.resolve(componentPath)];
  require(componentPath);

  const makeForm = (presetNode, formMode) => {
    const inst = Object.assign({}, componentConfig.methods);
    inst.data = Object.assign(JSON.parse(JSON.stringify(componentConfig.data)), {
      formMode: formMode || 'application', defaultAddress: '', presetNode: presetNode,
    });
    inst.setData = (patch, cb) => {
      Object.keys(patch).forEach((key) => {
        if (key.indexOf('.') < 0) { inst.data[key] = patch[key]; return; }
        const parts = key.split('.');
        let cur = inst.data;
        for (let i = 0; i < parts.length - 1; i += 1) {
          if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = patch[key];
      });
      if (cb) cb();
    };
    return inst;
  };

  beforeEach();
  const editing = makeForm({ id: 80, name: 'Audit coffee station', address: 'A 路 1 号', templateId: 33, xpValue: 5 });
  editing.openForm();
  assert.equal(editing.data.editing, true, '有已有点位就是编辑,不是新申请');
  assert.equal(editing.data.form.name, 'Audit coffee station', '原值要回填');
  assert.equal(editing.data.form.address, 'A 路 1 号');
  assert.equal(editing.data.form.templateId, 33);
  assert.equal(editing.data.form.xpValue, '5');
  assert.equal(editing.data.canSubmit, true, '回填之后应当直接可保存');

  const fresh = makeForm(null);
  fresh.openForm();
  assert.equal(fresh.data.editing, false);
  assert.equal(fresh.data.form.name, '', '真·新申请仍是空表单');
  assert.equal(fresh.data.canSubmit, false);

  // 集成复审:「填写实际供给」不是改点位 —— 上一次申请留下的预填不能串进来(否则会写「这条申请已有点位…覆盖」)
  const offer = makeForm({ id: 80, name: 'Audit coffee station', address: 'A 路 1 号', templateId: 33 }, 'offer');
  offer.loadMyPerkTemplates = () => {};
  offer.openForm();
  assert.equal(offer.data.editing, false, '供给表单不是编辑点位');
  assert.equal(offer.data.form.name, '', '供给表单不回填点位');

  const wxml = read('pages/topic/components/cy/chapter-node-form/index.wxml');
  assert.match(wxml, /editing \? '保存修改' : '提交申请与点位'/, '按钮文案要说成修改');
  assert.match(wxml, /保存会覆盖它的名称、地址与玩法/, '覆盖范围要写在表单里');
});
