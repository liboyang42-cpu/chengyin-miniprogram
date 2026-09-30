'use strict';

const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn: spawnProcess } = require('child_process');

const DEFAULT_CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function defaultAutomator() {
  return require(process.env.AUTOMATOR_PATH || 'miniprogram-automator');
}

function patchVersionCheck(automatorPath) {
  const modulePath = automatorPath || process.env.AUTOMATOR_PATH || 'miniprogram-automator';
  const imported = require(`${modulePath}/out/MiniProgram`);
  const MiniProgram = imported.default || imported;
  if (!MiniProgram || !MiniProgram.prototype) {
    throw new Error('无法定位 miniprogram-automator 的 MiniProgram 原型');
  }
  MiniProgram.prototype.checkVersion = async () => {};
  patchScreenshot(MiniProgram);
}

function patchScreenshot(MiniProgram) {
  if (!MiniProgram || !MiniProgram.prototype) {
    throw new Error('无法定位 miniprogram-automator 的 MiniProgram 原型');
  }
  if (typeof MiniProgram.prototype.screenshot === 'function') return;
  MiniProgram.prototype.screenshot = async function screenshot(options) {
    const { data } = await this.send('App.captureScreenshot');
    if (!options || !options.path) return data;
    await fs.promises.writeFile(options.path, data, 'base64');
  };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(300, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function connectWithRetry(automator, endpoint, attempts, delay, sleep) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await automator.connect({ wsEndpoint: endpoint });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delay);
    }
  }
  throw new Error(`无法连接 DevTools 自动化端口 ${endpoint}: ${lastError && lastError.message ? lastError.message : lastError}`);
}

function withDeadline(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(`非法 deadline: ${timeoutMs}`));
  }
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'AUTOMATOR_CALL_TIMEOUT';
        reject(error);
      }, timeoutMs);
    })
  ]);
}

async function waitForLogicLayer(mp, attempts, delay, sleep, callTimeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const pages = await withDeadline(
        mp.pageStack(),
        callTimeoutMs,
        `pageStack 在 ${callTimeoutMs}ms 内未返回`
      );
      if (Array.isArray(pages) && pages.length > 0) return pages;
    } catch (error) {
      lastError = error;
      // WebSocket 协议调用无法取消；deadline 后继续重试只会堆积悬挂请求并污染后续响应。
      if (error && error.code === 'AUTOMATOR_CALL_TIMEOUT') break;
    }
    if (attempt < attempts) await sleep(delay);
  }
  const detail = lastError && lastError.message ? `: ${lastError.message}` : '';
  throw new Error(`DevTools 已连接但未出现小程序逻辑层页面栈，拒绝假绿${detail}`);
}

async function waitForLogicLayerOrDisconnect(mp, attempts, delay, sleep, callTimeoutMs) {
  try {
    return await waitForLogicLayer(mp, attempts, delay, sleep, callTimeoutMs);
  } catch (error) {
    await closeMiniProgram({ mp });
    throw error;
  }
}

/**
 * 新版 DevTools 与 automator 0.12.x 的 launch() 兼容性不稳定。
 * 固定走 cli auto -> patch checkVersion -> connect，并在返回前确认逻辑层已出现。
 */
async function openMiniProgram(options) {
  const settings = options || {};
  const env = settings.env || process.env;
  const automator = settings.automator || defaultAutomator();
  const sleep = settings.wait || wait;
  const connectAttempts = settings.connectAttempts || 40;
  const stackAttempts = settings.stackAttempts || 40;
  const retryDelay = settings.retryDelay || 500;
  const rawStackCallTimeoutMs = settings.stackCallTimeoutMs
    ?? env.DEVTOOLS_STACK_CALL_TIMEOUT_MS
    ?? 5000;
  const stackCallTimeoutMs = Number(rawStackCallTimeoutMs);
  const projectPath = settings.projectPath;
  if (!projectPath) throw new Error('openMiniProgram 缺少 projectPath');
  if (!Number.isFinite(stackCallTimeoutMs) || stackCallTimeoutMs <= 0) {
    throw new Error(`非法 DEVTOOLS_STACK_CALL_TIMEOUT_MS: ${stackCallTimeoutMs}`);
  }

  (settings.patchVersion || (() => patchVersionCheck(settings.automatorPath)))();

  const wsEndpoint = settings.wsEndpoint || env.WS_ENDPOINT;
  if (wsEndpoint) {
    const mp = await connectWithRetry(automator, wsEndpoint, connectAttempts, retryDelay, sleep);
    await waitForLogicLayerOrDisconnect(mp, stackAttempts, retryDelay, sleep, stackCallTimeoutMs);
    return { mp, endpoint: wsEndpoint, borrowed: true };
  }

  const port = Number(settings.port || env.DEVTOOLS_AUTO_PORT || await (settings.findFreePort || findFreePort)());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`非法 DEVTOOLS_AUTO_PORT: ${port}`);
  }
  if (await (settings.isPortOpen || isPortOpen)(port)) {
    throw new Error(`DevTools 自动化端口 ${port} 已被占用；请更换 DEVTOOLS_AUTO_PORT，避免连到其他 worktree`);
  }

  const cliPath = settings.cliPath || env.DEVTOOLS_CLI || DEFAULT_CLI_PATH;
  const spawn = settings.spawn || spawnProcess;
  const args = ['auto', '--project', path.resolve(projectPath), '--auto-port', String(port), '--trust-project'];
  const child = spawn(cliPath, args, { detached: true, stdio: 'ignore' });
  if (child && typeof child.unref === 'function') child.unref();

  const endpoint = `ws://127.0.0.1:${port}`;
  const mp = await connectWithRetry(automator, endpoint, connectAttempts, retryDelay, sleep);
  await waitForLogicLayerOrDisconnect(mp, stackAttempts, retryDelay, sleep, stackCallTimeoutMs);
  return { mp, endpoint, borrowed: false, port };
}

async function closeMiniProgram(session) {
  if (!session || !session.mp || typeof session.mp.disconnect !== 'function') return;
  try {
    await session.mp.disconnect();
  } catch (error) {
    // 已断开的连接无需影响测试结论。
  }
}

module.exports = {
  DEFAULT_CLI_PATH,
  closeMiniProgram,
  connectWithRetry,
  findFreePort,
  isPortOpen,
  openMiniProgram,
  patchVersionCheck,
  patchScreenshot,
  withDeadline,
  waitForLogicLayer,
  waitForLogicLayerOrDisconnect
};
