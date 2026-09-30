const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/activity/official-inbox/index.js';

let pageConfig;
let requests;
let modals;

global.getApp = () => ({
  sendRequest: (request) => requests.push(request),
  getRequestErrorMessage: () => '请求失败',
});
global.wx = {
  showModal: (modal) => modals.push(modal),
  showToast: () => {},
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  pageConfig = null;
  requests = [];
  modals = [];
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage(invite) {
  const page = Object.assign({}, pageConfig);
  page.data = { loading: false, error: '', invites: [invite] };
  page.setData = (patch) => Object.assign(page.data, patch);
  return page;
}

test('★ official-inbox 五类动作均以 JSON RequestBody POST 到对应后端合同', () => {
  const cases = [
    { name: '主办接受', invite: { partyId: 11, partyType: 'OFFICIAL', role: 'ORGANIZER' }, action: 'accept', url: '/api/official/v2/organizer-invites/11/accept', reason: '' },
    { name: '主办拒绝', invite: { partyId: 12, partyType: 'OFFICIAL', role: 'ORGANIZER' }, action: 'decline', url: '/api/official/v2/organizer-invites/12/decline', reason: '主体拒绝本场邀约' },
    { name: '职责接受', invite: { partyId: 21, partyType: 'MERCHANT', role: 'FULFILLMENT_MERCHANT' }, action: 'accept', url: '/api/official/v2/parties/21/ACCEPT', reason: '' },
    { name: '职责拒绝', invite: { partyId: 22, partyType: 'CLUB', role: 'FULFILLMENT_CLUB' }, action: 'decline', url: '/api/official/v2/parties/22/DECLINE', reason: '主体拒绝本场邀约' },
    { name: '职责退出', invite: { partyId: 23, partyType: 'MERCHANT', role: 'FULFILLMENT_MERCHANT' }, action: 'withdraw', url: '/api/official/v2/parties/23/WITHDRAW', reason: '主体退出本场职责' },
  ];

  cases.forEach((item) => {
    const page = makePage(item.invite);
    page.act({ currentTarget: { dataset: { id: item.invite.partyId, action: item.action } } });

    assert.equal(modals.length, 1, item.name + '必须先请求用户确认');
    modals[0].success({ confirm: true });
    assert.equal(requests.length, 1, item.name + '确认后必须发出一次请求');
    assert.equal(requests[0].url, item.url, item.name + 'URL 必须对应后端 @RequestBody 动作端点');
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].header['content-type'], 'application/json', item.name + '缺 JSON 头会退回 urlencoded');
    assert.deepEqual(requests[0].data, { reason: item.reason });

    requests = [];
    modals = [];
  });
});
