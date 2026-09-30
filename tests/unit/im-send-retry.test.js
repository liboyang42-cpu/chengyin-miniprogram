const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../../subpackageB/pages/im/chat/index.js');
function chat() {
  let page;
  const requests = [];
  let imageCallback;
  let account = 1;
  const app = { sendRequest: r => requests.push(r), getUserID: () => account,
    chooseImage: cb => { imageCallback = cb; } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), getApp: () => app,
    Page: p => { page = p; }, wx: {}, setTimeout: () => {}, clearTimeout() {},
  }, { filename: file });
  page.data = { ...page.data, loadState: 'ready', conversationId: 26, myId: 1, msgs: [], text: 'same text' };
  page.setData = patch => Object.assign(page.data, patch);
  return { page, requests, selectedImage: () => imageCallback(['https://cdn/image.jpg']), account: id => { account = id; } };
}
test('a retry and an intentional identical new message must have distinguishable request identities', () => {
  const { page, requests } = chat();
  page.onSend();
  requests[0].fail({ errMsg: 'response lost after commit' });
  page.onResend({ currentTarget: { dataset: { index: 0 } } });
  const first = JSON.parse(JSON.stringify(requests[0].data));
  const retry = JSON.parse(JSON.stringify(requests[1].data));
  assert.deepEqual(retry, first, 'retry must preserve the original logical send');
  requests[1].success({ code: 200, data: { id: 61, senderId: 1, msgType: 1, content: 'same text' } });
  page.setData({ text: 'same text' });
  page.onSend();
  assert.notDeepEqual(JSON.parse(JSON.stringify(requests[2].data)), first,
    'a new intentional send is indistinguishable from retry on the current wire contract');
});
test('retrying a failed bubble must preserve an unrelated current draft', () => {
  const { page, requests } = chat();
  page.onSend();
  requests[0].fail({ errMsg: 'response lost after commit' });
  page.setData({ text: 'next message draft' });
  page.onResend({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.text, 'next message draft');
});

test('image and card retries retain original type and payload, not text messages', () => {
  for (const kind of ['image', 'card']) {
    const h = chat();
    if (kind === 'image') { h.page.onPickImage(); h.selectedImage(); }
    else h.page.sendCard({ cardType: 'location', name: 'meeting', lat: 31, lng: 121 });
    const first = JSON.parse(JSON.stringify(h.requests[0].data));
    h.requests[0].fail({ errMsg: 'lost' });
    h.page.onResend({ currentTarget: { dataset: { index: 0 } } });
    assert.deepEqual(JSON.parse(JSON.stringify(h.requests[1].data)), first);
    assert.equal(first.msg_type, kind === 'image' ? 2 : 3);
  }
});

test('polling the committed message replaces pending bubble and late failure cannot undo it', () => {
  const h = chat();
  h.page.onSend();
  h.page.pollNew();
  h.requests[1].success({ code: 200, data: { list: [{ id: 61, senderId: 1, msgType: 1,
    content: 'same text', clientMessageId: h.requests[0].data.client_message_id }] } });
  h.requests[0].fail({ errMsg: 'lost' });
  assert.equal(h.page.data.msgs.length, 1);
  assert.equal(h.page.data.msgs[0].id, 61);
  assert.equal(h.page.data.msgs[0].failed, undefined);
  assert.equal(h.page.data.sending, false);
});

test('account switch prevents new sends, image callbacks and late responses from changing this view', () => {
  const h = chat();
  h.page.onPickImage();
  h.page.onSend();
  const before = JSON.stringify(h.page.data);
  h.account(2);
  h.selectedImage();
  h.requests[0].success({ code: 200, data: { id: 61, senderId: 1 } });
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.stringify(h.page.data), before);
});

test('refresh keeps a failed unsent message available for retry', () => {
  const h = chat();
  h.page.onSend();
  h.requests[0].fail({ errMsg: 'offline before commit' });
  h.page.loadMessages(false);
  h.requests[1].success({ code: 200, data: { list: [], hasMore: false } });
  assert.equal(h.page.data.msgs.length, 1);
  assert.equal(h.page.data.msgs[0].failed, true);
  h.page.onResend({ currentTarget: { dataset: { index: 0 } } });
  const sends = h.requests.filter(r => r.url === '/api/im/send');
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[1].data, sends[0].data);
});

test('refresh reconciles a committed send and retains an unrelated failed send', () => {
  const h = chat();
  h.page.onSend();
  const first = h.requests[0].data.client_message_id;
  h.requests[0].fail({ errMsg: 'response lost' });
  h.page.setData({ text: 'another message' });
  h.page.onSend();
  h.requests[1].fail({ errMsg: 'offline' });
  h.page.loadMessages(false);
  h.requests[2].success({ code: 200, data: { list: [{ id: 61, senderId: 1, msgType: 1,
    content: 'same text', clientMessageId: first }], hasMore: false } });
  assert.equal(h.page.data.msgs.length, 2);
  assert.equal(h.page.data.msgs[0].id, 61);
  assert.equal(h.page.data.msgs[0].sendPayload, undefined);
  assert.equal(h.page.data.msgs[1].content, 'another message');
  assert.equal(h.page.data.msgs[1].failed, true);
  assert.equal(h.page.data.sending, false);
});

test('malformed success ids retain a failed message for retry', () => {
  for (const id of [true, [61], {}, '6e1', ' 61 ', 0, -1]) {
    const h = chat();
    h.page.onSend();
    h.requests[0].success({ code: 200, data: { id, senderId: 1 } });
    assert.equal(h.page.data.msgs[0].failed, true, JSON.stringify(id));
    assert.ok(h.page.data.msgs[0].sendPayload);
  }
});

test('older history reconciles a lost receipt without duplicating the failed bubble', () => {
  const h = chat();
  h.page.onSend();
  const key = h.requests[0].data.client_message_id;
  h.requests[0].fail({ errMsg: 'lost receipt' });
  h.page.setData({ hasMore: true, cursor: 90 });
  h.page.loadMore();
  h.requests[1].success({ code: 200, data: { list: [
    { id: 60, senderId: 2, msgType: 1, content: 'earlier' },
    { id: 61, senderId: 1, msgType: 1, content: 'same text', clientMessageId: key }
  ], hasMore: false } });
  assert.equal(h.page.data.msgs.length, 2);
  assert.equal(h.page.data.msgs[0].id, 60);
  assert.equal(h.page.data.msgs[1].id, 61);
  assert.equal(h.page.data.msgs[1].failed, undefined);
});
