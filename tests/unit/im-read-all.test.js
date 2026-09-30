const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../subpackageB/pages/im/list/index.js';
let pageConfig;
let requests;
let toasts;

global.getApp = () => ({
  globalData: {},
  sendRequest: (opts) => { requests.push(opts); },
});
global.wx = {
  showToast: (opts) => { toasts.push(opts.title); },
  navigateBack() {},
  switchTab() {},
  navigateTo() {},
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  requests = [];
  toasts = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage(list) {
  const page = Object.assign({}, pageConfig, {
    data: Object.assign({}, pageConfig.data, { list }),
  });
  page.loadConversations = () => {};
  return page;
}

test('全部已读只处理小程序可见会话,不清零隐藏群聊', () => {
  const page = makePage([
    { conversationId: 11, type: 1, unread: 2 },
    { conversationId: 44, type: 4, unread: 9 },
  ]);

  page.onReadAll();

  assert.deepEqual(requests.map((r) => r.data.conversation_id), [11]);
});

test('只有隐藏群聊未读时按没有可见未读处理', () => {
  const page = makePage([{ conversationId: 44, type: 4, unread: 9 }]);

  page.onReadAll();

  assert.equal(requests.length, 0);
  assert.deepEqual(toasts, ['没有未读消息']);
});
