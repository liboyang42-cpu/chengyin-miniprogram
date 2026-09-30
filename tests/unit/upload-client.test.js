// Phase 1.3 上传通道 upload-client —— 先写失败测试(TDD RED)。
//
// 不可破坏契约(current-api-inventory.md 7.3):
//  #21 url=/api/common/uploadOSS、name='file'、chooseDocument 的 formData{fileType,fileName}、
//      成功判定 data.code==200、URL 取 data.url —— 全部保持。
//  #24 独立 multipart 传输路径同样必须携带 Authorization。
//  #23 全部成功才回调完整结果数组;修复后不得中途泄漏/卡死 loading。
// 修复(line32 记录的 bug):多文件部分失败时,旧代码计数永远到不了总数 → callback 不触发;
//      新模块保证「所有文件 settle(成功或失败)后,onDone 恰好触发一次」,返回失败列表。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUploadClient, MAX_UPLOAD_FILE_SIZE, oversizeMessage } = require('../../utils/transport/upload-client.js');

function makeUploader(over) {
  const calls = [];
  const deps = {
    wxUploadFile: (opts) => { calls.push(opts); },   // 测试手动驱动 success/fail
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token-123',
  };
  const client = createUploadClient(Object.assign(deps, over));
  return { client, calls };
}

test('上传参数:url=/api/common/uploadOSS、name=file、携带 Authorization', () => {
  const { client, calls } = makeUploader();
  client.uploadAll(['a.png'], { onDone: () => {} });
  assert.equal(calls[0].url, 'https://base/api/common/uploadOSS');
  assert.equal(calls[0].name, 'file');
  assert.equal(calls[0].filePath, 'a.png');
  assert.deepEqual(calls[0].header, { Authorization: 'Bearer token-123' });
});

test('全部成功:onDone ok=true,结果按 mapResult 提取', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['a.png', 'b.png'], { onDone: (r) => { done = r; } });
  calls[0].success({ data: JSON.stringify({ code: 200, url: 'A' }) });
  calls[1].success({ data: JSON.stringify({ code: 200, url: 'B' }) });
  assert.equal(done.ok, true);
  assert.deepEqual(done.results, ['A', 'B']);
  assert.equal(done.failures.length, 0);
});

test('R3 图片上传:业务200缺必需 URL 必须回调失败', () => {
  for (const url of [undefined, '', '   ']) {
    const { client, calls } = makeUploader();
    let done;
    client.uploadAll(['a.png'], { onDone: (r) => { done = r; } });
    calls[0].success({ data: JSON.stringify({ code: 200, url }) });

    assert.equal(done.ok, false, `URL=${String(url)} 不得当作上传成功`);
    assert.deepEqual(done.results, []);
    assert.equal(done.failures.length, 1);
    assert.equal(done.failures[0].msg, '上传结果缺少文件地址');
  }
});

test('R3 文档上传:结构化结果缺必需 URL 必须回调失败', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['d.pdf'], {
    mapResult: (data) => ({ url: data.url, filename: 'd.pdf' }),
    onDone: (r) => { done = r; },
  });
  calls[0].success({ data: JSON.stringify({ code: 200 }) });

  assert.equal(done.ok, false);
  assert.deepEqual(done.results, []);
  assert.equal(done.failures[0].msg, '上传结果缺少文件地址');
});

test('mapResult 自定义:返回结构化结果(chooseDocument 形态)', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['d.pdf'], {
    formData: () => ({ fileType: 'pdf', fileName: 'd.pdf' }),
    mapResult: (data, i) => ({ url: data.url, filename: 'd.pdf' }),
    onDone: (r) => { done = r; },
  });
  assert.deepEqual(calls[0].formData, { fileType: 'pdf', fileName: 'd.pdf' });
  calls[0].success({ data: JSON.stringify({ code: 200, url: 'U' }) });
  assert.deepEqual(done.results, [{ url: 'U', filename: 'd.pdf' }]);
});

test('敏感上传:服务端不返回 URL 时可用本地临时路径预览', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['/tmp/evidence.jpg'], {
    bizType: 'merchant_aftercare_evidence',
    mapResult: (data, i, filePath) => ({
      fileName: data.fileName,
      url: filePath,
    }),
    onDone: (r) => { done = r; },
  });

  calls[0].success({
    data: JSON.stringify({
      code: 200,
      fileName: 'upload/merchant-aftercare-evidence/0123456789abcdef0123456789abcdef.jpg',
    }),
  });

  assert.equal(done.ok, true);
  assert.deepEqual(done.results, [{
    fileName: 'upload/merchant-aftercare-evidence/0123456789abcdef0123456789abcdef.jpg',
    url: '/tmp/evidence.jpg',
  }]);
});

test('bizType 与既有 formData 合并,不能覆盖文档上传字段', () => {
  const { client, calls } = makeUploader();
  client.uploadAll(['cover.png'], {
    bizType: 'image_16_9',
    formData: () => ({ fileName: 'cover.png' }),
    onDone: () => {},
  });
  assert.deepEqual(calls[0].formData, { fileName: 'cover.png', bizType: 'image_16_9' });
});

test('部分失败(code!=200):onDone 仍触发一次,ok=false,带失败列表', () => {
  const { client, calls } = makeUploader();
  let done; let count = 0;
  client.uploadAll(['a.png', 'b.png'], { onDone: (r) => { done = r; count++; } });
  calls[0].success({ data: JSON.stringify({ code: 200, url: 'A' }) });
  calls[1].success({ data: JSON.stringify({ code: 500, msg: '太大' }) });
  assert.equal(count, 1, 'onDone 恰好一次');
  assert.equal(done.ok, false);
  assert.equal(done.results[0], 'A');
  assert.equal(done.failures.length, 1);
  assert.equal(done.failures[0].msg, '太大');
});

test('上传 fail 回调:计入失败,onDone 仍触发(不卡死)', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['a.png', 'b.png'], { onDone: (r) => { done = r; } });
  calls[0].fail({ errMsg: 'uploadFile:fail' });
  calls[1].success({ data: JSON.stringify({ code: 200, url: 'B' }) });
  assert.equal(done.ok, false);
  assert.equal(done.failures.length, 1);
  assert.equal(done.results[1], 'B');
});

test('非法 JSON:计为失败,不抛异常', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['a.png'], { onDone: (r) => { done = r; } });
  calls[0].success({ data: 'not-json{' });
  assert.equal(done.ok, false);
  assert.equal(done.failures.length, 1);
});

test('onDone 在所有文件 settle 后只触发一次', () => {
  const { client, calls } = makeUploader();
  let count = 0;
  client.uploadAll(['a', 'b', 'c'], { onDone: () => { count++; } });
  calls[0].success({ data: JSON.stringify({ code: 200, url: '1' }) });
  assert.equal(count, 0, '未全部 settle 不触发');
  calls[1].fail({ errMsg: 'x' });
  assert.equal(count, 0);
  calls[2].success({ data: JSON.stringify({ code: 200, url: '3' }) });
  assert.equal(count, 1);
});

test('上传池最多并发 3 个，settle 后才启动队列下一项', () => {
  const { client, calls } = makeUploader();
  client.uploadAll(['a', 'b', 'c', 'd', 'e'], { onDone() {} });
  assert.equal(calls.length, 3);
  calls[0].success({ data: JSON.stringify({ code: 200, url: 'A' }) });
  assert.equal(calls.length, 4);
  calls[1].fail({ errMsg: 'uploadFile:fail' });
  assert.equal(calls.length, 5);
});

test('逐文件超时会 abort、保留失败项并继续队列；destroy 屏蔽 onDone', () => {
  const timers = [];
  const calls = [];
  let aborted = 0;
  const client = createUploadClient({
    wxUploadFile(opts) {
      calls.push(opts);
      return { abort() { aborted += 1; } };
    },
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token',
    setTimer(fn, ms) { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer(t) { t.cleared = true; },
  });
  let done;
  client.uploadAll(['a', 'b'], {
    concurrency: 1,
    perFileTimeoutMs: 1000,
    totalDeadlineMs: 5000,
    onDone: value => { done = value; },
  });
  const watchdog = timers.find(t => t.ms === 1000);
  watchdog.fn();
  assert.equal(aborted, 1);
  assert.equal(calls.length, 2);
  calls[1].success({ data: JSON.stringify({ code: 200, url: 'B' }) });
  assert.equal(done.ok, false);
  assert.equal(done.failures[0].index, 0);
  assert.equal(done.failures[0].status, 'unknown');

  let called = 0;
  const control = client.uploadAll(['c'], { onDone() { called += 1; } });
  control.destroy();
  assert.equal(called, 0);
  assert.equal(aborted, 2);
});

test('上传 abort 同步触发 fail 时 watchdog 仍归类 unknown', () => {
  const timers = [];
  let request;
  let done;
  const client = createUploadClient({
    wxUploadFile(opts) {
      request = opts;
      return { abort() { request.fail({ errMsg: 'uploadFile:fail abort' }); } };
    },
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token',
    setTimer(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimer() {},
  });
  client.uploadAll(['a'], {
    perFileTimeoutMs: 1000,
    totalDeadlineMs: 5000,
    onDone(value) { done = value; }
  });

  timers.find(timer => timer.ms === 1000).fn();

  assert.equal(done.failures[0].status, 'unknown');
});

// ---- R9-48 真实共享上传入口按已知 size 前置拒绝(不发起注定被容器截断的连接) ----

test('已知超限:不发起 wx.uploadFile,回调可操作提示(压缩/换文件)', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['big.mp3'], {
    fileSizes: [MAX_UPLOAD_FILE_SIZE + 1],
    onDone: (r) => { done = r; },
  });

  assert.equal(calls.length, 0, '已知超限不得发起上传');
  assert.equal(done.ok, false);
  assert.equal(done.failures.length, 1);
  assert.equal(done.failures[0].reason, 'oversize');
  assert.match(done.failures[0].msg, /文件过大/);
  assert.match(done.failures[0].msg, /压缩|更换/);
  assert.match(done.failures[0].msg, /10MB/);
});

test('恰好等于单文件限额:放行上传(边界不误伤)', () => {
  const { client, calls } = makeUploader();
  client.uploadAll(['edge.mp3'], {
    fileSizes: [MAX_UPLOAD_FILE_SIZE],
    onDone: () => {},
  });
  assert.equal(calls.length, 1);
});

test('size 未知:放行上传,由服务端拦截(不能前置断言)', () => {
  const { client, calls } = makeUploader();
  client.uploadAll(['unknown.mp3'], {
    fileSizes: [undefined],
    onDone: () => {},
  });
  assert.equal(calls.length, 1);
});

test('混合批量:只拒已知超限项,其余照常上传', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadAll(['ok.mp3', 'big.mp3'], {
    concurrency: 1,
    fileSizes: [1024, MAX_UPLOAD_FILE_SIZE + 5],
    onDone: (r) => { done = r; },
  });
  assert.equal(calls.length, 1, '只应发起未超限那一项');
  calls[0].success({ data: JSON.stringify({ code: 200, url: 'OK' }) });
  assert.equal(done.ok, false);
  assert.equal(done.failures[0].index, 1);
  assert.equal(done.failures[0].reason, 'oversize');
});

test('uploadOne 已知超限:不发起上传并回调可操作提示', () => {
  const { client, calls } = makeUploader();
  let done;
  client.uploadOne('voice.mp3', {
    path: '/api/ai/npc/voice-chat',
    fileSize: MAX_UPLOAD_FILE_SIZE + 1,
    onDone: (r) => { done = r; },
  });
  assert.equal(calls.length, 0);
  assert.equal(done.ok, false);
  assert.equal(done.reason, 'oversize');
  assert.match(done.msg, /文件过大/);
});

test('oversizeMessage 文案与限额同源', () => {
  assert.match(oversizeMessage(MAX_UPLOAD_FILE_SIZE), /10MB/);
});
