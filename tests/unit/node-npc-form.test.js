// 节点 NPC 半屏(CR-927)合同:字段/审核合同/失败口径/上传限制。
//
// 直接执行真实组件源码(vm 求值)+ 真实共享 upload-client(precheck 不被 mock 掉),
// 只把 getApp/wx/canvas 换成受控桩 —— 与 merchant-npc-voice-size-contract 同一套做法。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const upload = require('../../utils/transport/upload-client.js');

const COMPONENT = path.join(__dirname, '../../pages/topic/components/cy/node-npc-form/index.js');
const WXML = fs.readFileSync(path.join(__dirname, '../../pages/topic/components/cy/node-npc-form/index.wxml'), 'utf8');
const JS = fs.readFileSync(COMPONENT, 'utf8');

const NODE = 31;

function setAtPath(target, rawPath, value) {
  const parts = rawPath.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function load(options = {}) {
  const state = { def: null, requests: [], uploads: [], chosen: null };
  const audio = {
    duration: options.duration == null ? 20 : options.duration,
    stop() {}, play() {}, destroy() {}, onEnded() {}, onStop() {}, onError() {},
  };
  const client = upload.createUploadClient({
    wxUploadFile(opts) {
      state.uploads.push(opts);
      // 真实 wx.uploadFile 是回调式的:这里同步回一个成功包,走完共享入口的完整链路
      opts.success({ data: JSON.stringify({ code: 200, url: options.uploadUrl || 'https://o/up.png' }) });
      return { abort() {} };
    },
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token',
    setTimer: () => 1,
    clearTimer: () => {},
  });
  const app = {
    getUploadClient: () => client,
    sendRequest(opts) {
      const payload = JSON.parse(opts.data || '{}');
      state.requests.push({ url: opts.url, payload });
      const canned = (options.responses && options.responses[opts.url]) || { code: 200, data: {} };
      if (canned.networkFail) return opts.fail({});
      if (String(canned.code) === '200') return opts.success(canned);
      return opts.successStatusAbnormal(canned);
    },
  };
  const wx = {
    chooseMessageFile(opts) { state.chosen = opts; },
    chooseMedia(opts) { state.media = opts; },
    createInnerAudioContext: () => audio,
  };
  const localRequire = (id) => {
    if (id.endsWith('pixel-avatar.js')) return {
      AVATAR_IDS: ['p01', 'p04'],
      isPixelAvatar: (code) => String(code || '').indexOf('px1:') === 0,
      parseCode: (code) => String(code).slice(4),
      stringifyCode: (id) => 'px1:' + id,
    };
    if (id.endsWith('pixel-portrait.js')) return {
      squareCrop: () => ({ x: 0, y: 0, size: 10 }),
      buildPortrait: () => ({}),
      drawPortrait: () => {},
    };
    if (id.endsWith('transport/upload-client.js')) return upload;
    throw new Error('unexpected require ' + id);
  };
  // 计时器全部关掉:轮询/时长读取的 setTimeout 不真跑,避免测试进程被挂起的 timer 拖住
  vm.runInNewContext(JS, {
    getApp: () => app, Component: (def) => { state.def = def; }, wx,
    require: localRequire, console,
    setTimeout: () => 1, clearTimeout: () => {}, Promise,
    Object, Error, JSON, Math, Number, String, Array,
  }, { filename: COMPONENT });

  const component = Object.assign({}, state.def.methods);
  component.data = Object.assign(JSON.parse(JSON.stringify(state.def.data)), {
    show: true, nodeId: NODE, nodeName: '幸会咖啡',
  });
  component.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach((key) => setAtPath(this.data, key, patch[key]));
    if (cb) cb();
  };
  component.triggerEvents = [];
  component.triggerEvent = function (name, detail) { this.triggerEvents.push({ name, detail }); };
  component.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) });
  state.component = component;
  return state;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ===== WXML 结构:按钮排布与结果面板层级 =====

function actionRows(wxml) {
  return wxml.split('<view class="nnf-actions').slice(1).map((chunk) => chunk.split('</view>')[0]);
}

test('动作行最多 2 个小按钮并排,结果面板画在 sheet 之后', () => {
  const rows = actionRows(WXML);
  assert.ok(rows.length >= 2, '至少有「取消/保存」与声音动作两行');
  rows.forEach((row, i) => {
    const count = (row.match(/<cy-btn/g) || []).length;
    assert.ok(count >= 1 && count <= 2, `第 ${i + 1} 行动作必须是 1–2 个小按钮,实际 ${count}`);
    assert.ok(!/size="(?!sm)/.test(row), '动作行只允许 size="sm" 小按钮');
  });
  assert.ok(WXML.indexOf('<cy-result-sheet') > WXML.indexOf('</cy-sheet>'),
    '结果面板必须在 sheet 之后:同档 z-index 下后画的才盖在上面');
  assert.match(WXML, /data-key="name"/);
  assert.match(WXML, /data-key="greeting"/);
  assert.match(WXML, /maxlength="32"/);
  assert.match(WXML, /maxlength="255"/);
});

test('五个新端点全在组件源码里(不与门店形象端点混用)', () => {
  ['/api/merchant/chapter-node/npc/detail',
    '/api/merchant/chapter-node/npc/save',
    '/api/merchant/chapter-node/npc/voice/enroll',
    '/api/merchant/chapter-node/npc/voice/status',
    '/api/merchant/chapter-node/npc/voice/reset'].forEach((url) => {
    assert.ok(JS.includes(url), '组件必须调用 ' + url);
  });
  assert.ok(!JS.includes('/api/merchant/npc/save'), '节点 NPC 不得复用门店形象端点');
});

// ===== 回填与保存 =====

test('打开时回填已保存的节点 NPC,保存按钮带必填闸', async () => {
  const h = load({
    responses: {
      '/api/merchant/chapter-node/npc/detail': {
        code: 200,
        data: { name: '阿福', avatar: 'px1:p04', greeting: '欢迎来店里', voiceStatus: 2, voiceSample: '/a.mp3' },
      },
      '/api/merchant/chapter-node/npc/voice/status': {
        code: 200, data: { voiceStatus: 2, voiceSample: '/a.mp3' },
      },
    },
  });
  h.component._onOpen();
  await tick(); await tick();

  assert.equal(h.component.data.loading, false);
  assert.equal(h.component.data.form.name, '阿福');
  assert.equal(h.component.data.form.greeting, '欢迎来店里');
  assert.equal(h.component.data.source, 'preset');
  assert.equal(h.component.data.presetId, 'p04');
  assert.equal(h.component.data.avatarPreview, 'px1:p04');
  assert.equal(h.component.data.voiceStatusText, '声音已就绪');
});

test('保存:预设形象原样提交,字段去空白,成功后面板 2s 自愈并带 saved=true 关闭', async () => {
  const h = load({
    responses: {
      '/api/merchant/chapter-node/npc/detail': { code: 200, data: null },
      '/api/merchant/chapter-node/npc/voice/status': { code: 200, data: { voiceStatus: 0 } },
      '/api/merchant/chapter-node/npc/save': {
        code: 200, data: { name: '阿福', avatar: 'px1:p01', greeting: '欢迎' },
      },
    },
  });
  h.component._onOpen();
  await tick(); await tick();
  h.component.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '  阿福  ' } });
  h.component.onInput({ currentTarget: { dataset: { key: 'greeting' } }, detail: { value: ' 欢迎 ' } });
  h.component.save();
  await tick(); await tick();

  const saved = h.requests.find((r) => r.url.endsWith('/npc/save'));
  assert.ok(saved, '必须调用保存端点');
  assert.deepEqual(saved.payload, { nodeId: NODE, name: '阿福', avatar: 'px1:p01', greeting: '欢迎' });
  assert.equal(h.component.data.result.kind, 'success');
  assert.equal(h.component.data.result.show, true);

  h.component.onResultClose();
  const close = h.component.triggerEvents.find((e) => e.name === 'close');
  assert.ok(close, '成功后必须自愈关闭');
  assert.equal(close.detail.saved, true, '成功后自愈关闭必须告诉页面「已保存」');
});

test('保存:名字为空不发请求,失败落 fail 面板且不关半屏(输入保留)', async () => {
  const h = load({
    responses: {
      '/api/merchant/chapter-node/npc/detail': { code: 200, data: null },
      '/api/merchant/chapter-node/npc/voice/status': { code: 200, data: { voiceStatus: 0 } },
      '/api/merchant/chapter-node/npc/save': { code: 500, msg: '承接已失效或未生效，不能编辑节点内容' },
    },
  });
  h.component._onOpen();
  await tick(); await tick();
  h.component.save();
  await tick();
  assert.equal(h.requests.filter((r) => r.url.endsWith('/npc/save')).length, 0, '空名字不得发请求');
  assert.equal(h.component.data.result.why, '请填写角色名字');

  h.component.setData({ 'form.name': '阿福' });
  h.component.save();
  await tick(); await tick();
  assert.equal(h.component.data.result.kind, 'fail');
  assert.equal(h.component.data.result.why, '承接已失效或未生效，不能编辑节点内容');
  h.component.onResultClose();
  assert.equal(h.component.triggerEvents.filter((e) => e.name === 'close').length, 0,
    '保存失败必须留在表单里重试,不能自愈关掉半屏');
});

test('读取失败:fail 面板自愈后自动关半屏(表单没法用)', async () => {
  const h = load({
    responses: {
      '/api/merchant/chapter-node/npc/detail': { code: 500, msg: '点位不存在或无权操作' },
      '/api/merchant/chapter-node/npc/voice/status': { code: 200, data: { voiceStatus: 0 } },
    },
  });
  h.component._onOpen();
  await tick(); await tick();
  assert.equal(h.component.data.result.kind, 'fail');
  assert.equal(h.component.data.result.why, '点位不存在或无权操作');
  h.component.onResultClose();
  const closed = h.component.triggerEvents.find((e) => e.name === 'close');
  assert.ok(closed, '读取失败的表单必须自愈关闭');
  assert.equal(closed.detail.saved, false);
});

test('照片形象:先上传再用 URL 保存,不把本地路径提交上去', async () => {
  const h = load({
    responses: {
      '/api/merchant/chapter-node/npc/detail': { code: 200, data: null },
      '/api/merchant/chapter-node/npc/voice/status': { code: 200, data: { voiceStatus: 0 } },
      '/api/merchant/chapter-node/npc/save': { code: 200, data: { name: '阿福', avatar: 'https://o/a.png' } },
    },
  });
  h.component._onOpen();
  await tick(); await tick();
  h.component.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '阿福' } });
  h.component.setData({ source: 'photo' });
  h.component._photoPath = '/tmp/portrait.png';
  h.component.setData({ avatarPreview: '/tmp/portrait.png' });
  h.component.save();
  await tick(); await tick(); await tick();

  const uploadCall = h.uploads[0];
  assert.ok(uploadCall, '照片必须先走共享上传入口');
  const saved = h.requests.find((r) => r.url.endsWith('/npc/save'));
  assert.ok(String(saved.payload.avatar).startsWith('https://'), '提交的必须是上传后的 URL');
});

// ===== 声音:10MiB 合同与状态机 =====

test('录音 15MiB:前置拒绝并给可操作文案,不产生 voiceFile', () => {
  const h = load();
  h.component.chooseVoice();
  h.chosen.success({ tempFiles: [{ name: 'a.mp3', size: 15 * 1024 * 1024, path: '/tmp/a.mp3' }] });
  assert.equal(h.component.data.voiceFile, null, '超限文件不得进入待上传态');
  assert.equal(h.uploads.length, 0, '已知超限不得发起 wx.uploadFile');
  assert.match(h.component.data.result.why, /10MB/);
});

test('录音 8MiB / 20 秒:接受并走共享入口的 fileSizes,再发起复刻', async () => {
  const h = load({
    responses: {
      '/api/merchant/chapter-node/npc/voice/enroll': { code: 200, data: { voiceStatus: 1, voiceSample: 'https://o/v.mp3' } },
      '/api/merchant/chapter-node/npc/voice/status': { code: 200, data: { voiceStatus: 1, voiceSample: 'https://o/v.mp3' } },
    },
  });
  h.component.chooseVoice();
  h.chosen.success({ tempFiles: [{ name: 'a.mp3', size: 8 * 1024 * 1024, path: '/tmp/a.mp3' }] });
  await tick();
  assert.ok(h.component.data.voiceFile, '合规文件进入待上传态');
  assert.match(h.component.data.voiceFileText, /8\.0MB/);

  h.component.uploadVoice();
  await tick(); await tick(); await tick();
  assert.ok(h.uploads[0], '录音必须先上传');
  const enroll = h.requests.find((r) => r.url.endsWith('/voice/enroll'));
  assert.ok(enroll, '上传成功后才发起复刻');
  assert.equal(enroll.payload.nodeId, NODE);
  assert.equal(h.component.data.voiceStatus, 1);
  assert.equal(h.component.data.voiceFile, null, '提交成功后不再保留待上传文件');
});
