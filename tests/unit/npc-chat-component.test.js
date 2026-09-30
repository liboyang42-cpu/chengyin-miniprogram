const assert = require('node:assert/strict');
const test = require('node:test');

const COMPONENT_PATH = require.resolve('../../components/cy/npc-chat/index.js');
let definition;
let activeApp;

function loadDefinition() {
  const previousComponent = global.Component;
  global.Component = (options) => { definition = options; };
  delete require.cache[COMPONENT_PATH];
  require(COMPONENT_PATH);
  global.Component = previousComponent;
}

function createChat(app, properties) {
  activeApp = app;
  const instance = {
    properties: Object.assign({ show: true, sessionId: 91 }, properties),
    data: JSON.parse(JSON.stringify(definition.data)),
    events: [],
    setData(update) { Object.assign(this.data, update); },
    triggerEvent(name, detail) { this.events.push({ name, detail }); },
  };
  Object.assign(instance, definition.methods);
  return instance;
}

function inputAndSend(chat, message) {
  chat.onInput({ detail: { value: message } });
  chat.onSend();
}

function response(requestId, text, audioUrl) {
  return {
    code: 200,
    data: {
      requestId,
      outcomeStatus: 'SUCCEEDED',
      safetyDecision: 'PASS',
      errorCode: '',
      safeText: text,
      audioUrl,
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

global.getApp = () => activeApp;
loadDefinition();

test('cy-npc-chat 用普通 POST 接收审核完成结果后才本地逐字呈现', async () => {
  const requests = [];
  const chat = createChat({
    sendRequest(options) {
      requests.push(options);
      return { abort() {} };
    },
  });

  inputAndSend(chat, '下一步怎么探索？');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/ai/npc/chat');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].header['content-type'], 'application/json');
  assert.equal(requests[0].timeout, 30000, '需覆盖模型生成与随后语音合成的串行预算');
  assert.equal(requests[0].data.bizId, 91);
  assert.match(requests[0].data.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  requests[0].success(response(requests[0].data.requestId, '安全回复'));
  await sleep(80);
  assert.equal(chat.data.messages.at(-1).role, 'assistant');
  assert.equal(chat.data.messages.at(-1).text, '安全回复');
  assert.equal(chat.data.state, 'DONE');
});

test('商家分身回复带 audioUrl 时播放语音，关闭时销毁', () => {
  const requests = [];
  const audio = { src: '', played: 0, stopped: 0, destroyed: 0,
    play() { this.played++; }, stop() { this.stopped++; }, destroy() { this.destroyed++; },
    onEnded(fn) { this.ended = fn; }, onError(fn) { this.failed = fn; } };
  const previousWx = global.wx;
  global.wx = { createInnerAudioContext: () => audio };
  const chat = createChat({
    sendRequest(options) { requests.push(options); return { abort() {} }; },
  }, { scope: 'merchant' });

  inputAndSend(chat, '你们几点关门？');
  requests[0].success(response(requests[0].data.requestId, '晚上十点', 'https://cdn.example/npc.mp3'));
  assert.equal(audio.src, 'https://cdn.example/npc.mp3');
  assert.equal(audio.played, 1);
  chat.cancelPending();
  assert.equal(audio.stopped, 1);
  assert.equal(audio.destroyed, 1);
  global.wx = previousWx;
});

test('新消息 abort 旧请求，迟到旧响应不会覆盖当前状态', async () => {
  const requests = [];
  let aborts = 0;
  const chat = createChat({
    sendRequest(options) {
      requests.push(options);
      return { abort() { aborts++; } };
    },
  });

  inputAndSend(chat, '第一条');
  const first = requests[0];
  inputAndSend(chat, '第二条');
  const second = requests[1];
  assert.equal(aborts, 1, '新消息必须取消旧 RequestTask');

  first.success(response(first.data.requestId, '旧响应不应出现'));
  second.success(response(second.data.requestId, '新响应'));
  await sleep(80);
  const texts = chat.data.messages.map((item) => item.text);
  assert.ok(texts.includes('新响应'));
  assert.ok(!texts.includes('旧响应不应出现'), 'generation/requestId 隔离必须丢弃迟到旧响应');
});

test('cancelPending 终止挂起请求并隔离关闭后的迟到回调', () => {
  const requests = [];
  let aborts = 0;
  const chat = createChat({
    sendRequest(options) {
      requests.push(options);
      return { abort() { aborts++; } };
    },
  });

  inputAndSend(chat, '离开页面前的问题');
  chat.cancelPending();
  requests[0].success(response(requests[0].data.requestId, '关闭后不能显示'));

  assert.equal(aborts, 1);
  assert.equal(chat.data.messages.length, 1, '只保留已发送的用户消息，迟到回答不得追加');
  assert.equal(chat.data.state, 'CANCELLED');
});

test('HTTP 非 2xx 会收敛为失败，不会永远停在生成中', () => {
  const requests = [];
  const chat = createChat({
    sendRequest(options) {
      requests.push(options);
      return { abort() {} };
    },
  });

  inputAndSend(chat, '服务器异常时怎么办？');
  requests[0].successStatusAbnormal({ code: 500 });

  assert.equal(chat.data.state, 'FAILED');
  assert.equal(chat.data.isThinking, false);
  assert.match(chat.data.messages.at(-1).text, /网络不太稳定/);
});
