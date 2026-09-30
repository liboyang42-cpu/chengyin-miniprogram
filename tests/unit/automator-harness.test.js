'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { closeMiniProgram, openMiniProgram, patchScreenshot } = require('../automator/harness');

function fakeMiniProgram(pageStack) {
  return {
    pageStack: async () => pageStack,
    disconnect: async () => {}
  };
}

test('automator harness 固定用 cli auto + connect，不调用兼容性不稳的 launch', async () => {
  const spawned = [];
  const endpoints = [];
  let patched = 0;
  const mp = fakeMiniProgram([{ path: 'pages/index/index' }]);

  const session = await openMiniProgram({
    projectPath: '/tmp/chengyin-worktree/chengyinhub-xcx',
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    port: 9451,
    automator: { connect: async ({ wsEndpoint }) => { endpoints.push(wsEndpoint); return mp; } },
    patchVersion: () => { patched += 1; },
    isPortOpen: async () => false,
    spawn: (command, args, options) => {
      spawned.push({ command, args, options });
      return { unref() {} };
    },
    wait: async () => {},
    connectAttempts: 1,
    stackAttempts: 1
  });

  assert.strictEqual(patched, 1);
  assert.deepStrictEqual(spawned, [{
    command: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    args: ['auto', '--project', '/tmp/chengyin-worktree/chengyinhub-xcx', '--auto-port', '9451', '--trust-project'],
    options: { detached: true, stdio: 'ignore' }
  }]);
  assert.deepStrictEqual(endpoints, ['ws://127.0.0.1:9451']);
  assert.strictEqual(session.borrowed, false);
});

test('automator harness 连接显式 WS_ENDPOINT 时不启动其他 worktree', async () => {
  let spawned = false;
  const mp = fakeMiniProgram([{ path: 'pages/index/index' }]);
  const session = await openMiniProgram({
    projectPath: '/tmp/chengyin-worktree/chengyinhub-xcx',
    wsEndpoint: 'ws://127.0.0.1:9452',
    automator: { connect: async () => mp },
    patchVersion: () => {},
    spawn: () => { spawned = true; },
    wait: async () => {},
    connectAttempts: 1,
    stackAttempts: 1
  });

  assert.strictEqual(session.borrowed, true);
  assert.strictEqual(spawned, false);
});

test('automator harness 在没有逻辑层页面栈时拒绝假绿', async () => {
  let disconnected = 0;
  await assert.rejects(() => openMiniProgram({
    projectPath: '/tmp/chengyin-worktree/chengyinhub-xcx',
    wsEndpoint: 'ws://127.0.0.1:9453',
    automator: { connect: async () => ({
      pageStack: async () => [],
      disconnect: async () => { disconnected += 1; },
    }) },
    patchVersion: () => {},
    wait: async () => {},
    connectAttempts: 1,
    stackAttempts: 2
  }), /未出现小程序逻辑层页面栈/);
  assert.equal(disconnected, 1, '持续空页面栈必须 fail-closed 并释放连接');
});

test('automator harness 在 pageStack 永不回调时也必须在 deadline 内判红', async () => {
  let pageStackCalls = 0;
  let disconnected = 0;
  const open = openMiniProgram({
    projectPath: '/tmp/chengyin-worktree/chengyinhub-xcx',
    wsEndpoint: 'ws://127.0.0.1:9454',
    automator: { connect: async () => ({
      pageStack: () => {
        pageStackCalls += 1;
        return new Promise(() => {});
      },
      disconnect: () => { disconnected += 1; },
    }) },
    patchVersion: () => {},
    wait: async () => {},
    connectAttempts: 1,
    stackAttempts: 3,
    stackCallTimeoutMs: 5
  });
  await assert.rejects(() => Promise.race([
    open,
    new Promise((_, reject) => setTimeout(() => reject(new Error('unit sentinel: harness 未按 deadline 返回')), 40))
  ]), /未出现小程序逻辑层页面栈/);
  assert.equal(pageStackCalls, 1, '单次协议调用超时后不得继续堆积无法取消的 pageStack 请求');
  assert.equal(disconnected, 1, '逻辑层握手失败必须释放已经建立的 automator 连接');
});

test('automator harness 拒绝零值 pageStack deadline，不能静默回退默认值', async () => {
  await assert.rejects(() => openMiniProgram({
    projectPath: '/tmp/chengyin-worktree/chengyinhub-xcx',
    wsEndpoint: 'ws://127.0.0.1:9455',
    automator: { connect: async () => fakeMiniProgram([{ path: 'pages/index/index' }]) },
    patchVersion: () => {},
    stackCallTimeoutMs: 0,
  }), /非法 DEVTOOLS_STACK_CALL_TIMEOUT_MS/);
});

test('automator harness 收尾只断开连接，不关闭开发者工具窗口', async () => {
  let disconnected = 0;
  await closeMiniProgram({ mp: { disconnect: () => { disconnected += 1; } } });
  assert.strictEqual(disconnected, 1);
});

test('legacy automator 仍能通过 DevTools 协议获取并写入截图', async (t) => {
  class LegacyMiniProgram {
    constructor() {
      this.commands = [];
    }

    async send(command) {
      this.commands.push(command);
      return { data: 'c2NyZWVuc2hvdC1ieXRlcw==' };
    }
  }

  patchScreenshot(LegacyMiniProgram);
  const mp = new LegacyMiniProgram();
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chengyin-automator-')), 'screen.png');
  t.after(() => fs.rmSync(path.dirname(output), { recursive: true, force: true }));

  assert.strictEqual(await mp.screenshot(), 'c2NyZWVuc2hvdC1ieXRlcw==');
  await mp.screenshot({ path: output });
  assert.deepStrictEqual(mp.commands, ['App.captureScreenshot', 'App.captureScreenshot']);
  assert.strictEqual(fs.readFileSync(output, 'utf8'), 'screenshot-bytes');
});

test('native screenshot implementation is never overwritten', async () => {
  class CurrentMiniProgram {
    async screenshot() { return 'native-screenshot'; }
  }

  patchScreenshot(CurrentMiniProgram);
  assert.strictEqual(await new CurrentMiniProgram().screenshot(), 'native-screenshot');
});

test('正式 automator 用例不再直接调用 automator.launch', () => {
  const directory = path.resolve(__dirname, '../automator');
  const offenders = fs.readdirSync(directory)
    .filter((file) => file.endsWith('.js') && file !== 'harness.js')
    .filter((file) => /\bautomator\.launch\s*\(/.test(fs.readFileSync(path.join(directory, file), 'utf8')));

  assert.deepStrictEqual(offenders, []);
});
