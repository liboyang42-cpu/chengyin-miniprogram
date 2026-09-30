// Phase 0 安全网:登录冒烟(自动化关键旅程的最小一条)。
//
// 断言:重启首页 -> 等待 app ready -> 按真实身份落到对应首页 -> 页面不处于错误/无限 loading。
// 这是后续各阶段重构后"现有页面没被改坏"的最低基准。
//
// 运行前提(任选其一):
//   1) 微信开发者工具已打开本项目,且在 设置->安全设置 开启"服务端口";
//      然后设置环境变量 WS_ENDPOINT 指向自动化端口,例如:
//        WS_ENDPOINT=ws://127.0.0.1:9420 npm --prefix chengyinhub-xcx run test:automator
//   2) 或设置 DEVTOOLS_CLI 指向开发者工具 cli,由 harness 执行 cli auto:
//        DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npm ... run test:automator
//
// 没有上述任一前提时,脚本会打印清晰的跳过原因并以非 0 退出,绝不假绿。

const path = require('path');
const { closeMiniProgram, openMiniProgram } = require('./harness');

const PROJECT_PATH = path.resolve(__dirname, '..', '..');
const HOME_ROUTE = 'pages/index/index';
const MERCHANT_HOME_ROUTE = 'pages/merchant/index/index';
const READY_TIMEOUT_MS = 15000;

function expectedLandingRoute(identity) {
  const snap = identity || {};
  if (snap.debugView === 'user') return HOME_ROUTE;
  return snap.role === 'merchant' || Number(snap.userType) === 2
    ? MERCHANT_HOME_ROUTE
    : HOME_ROUTE;
}

function assertRuntimeConfigured(runtimeConfig) {
  const runtime = runtimeConfig || {};
  if (!runtime.configured || !runtime.apiBaseUrl) {
    throw new Error(`${runtime.environment || '当前'} API 环境未配置，无法执行真实登录/工作台烟测`);
  }
}

function assertLandingHealthy(data, route) {
  const state = data || {};
  // 2026-09-16 去闸:工作台失败态从整屏 consoleState=='error' 改成页内 consoleError。
  if (route === MERCHANT_HOME_ROUTE && state.consoleError) {
    throw new Error(`工作台错误态: ${state.consoleError}`);
  }
  const stuck = ['loading', 'isLoading', 'pageLoading'].some((key) => state[key] === true);
  if (stuck) throw new Error('落地页疑似卡在 loading 态(loading/isLoading/pageLoading 为 true)');
}

async function main() {
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    // 1) 重启到首页,逼出冷启动登录链路
    await mp.reLaunch('/' + HOME_ROUTE);

    // 2) 等待 app ready:轮询 App 实例的 isAppReady,而非死等固定时间
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      const ok = await mp.evaluate(() => {
        const app = getApp();
        return !!(app && app.isAppReady);
      });
      if (ok) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready) {
      throw new Error('app 在 ' + READY_TIMEOUT_MS + 'ms 内未 ready(isAppReady 未置真)');
    }

    // 3) 先锁定运行环境和身份落点。develop/trial 未配置受控后端时必须明确失败，
    //    不能让相对 URL 的网络错误或商家重定向盖住真实阻塞原因。
    const launchContract = await mp.evaluate(() => {
      const app = getApp();
      return {
        runtimeConfig: app && app.globalData ? app.globalData.runtimeConfig : null,
        identity: {
          role: wx.getStorageSync('role'),
          userType: wx.getStorageSync('user_type'),
          debugView: wx.getStorageSync('debug_user_view'),
        },
      };
    });
    assertRuntimeConfigured(launchContract && launchContract.runtimeConfig);
    const expectedRoute = expectedLandingRoute(launchContract && launchContract.identity);

    // 4) 断言身份对应的首页存在
    const page = await mp.currentPage();
    if (!page) throw new Error('currentPage 为空,首页未加载');
    const route = page.path.replace(/^\//, '');
    if (route !== expectedRoute) {
      throw new Error(`身份落地页错误,期望 ${expectedRoute},实际 ${route}`);
    }

    // 5) 错误态和无限 loading 都不能当作 app ready。
    assertLandingHealthy(await page.data(), route);

    console.log('[login-smoke] PASS:身份落地页已就绪、无错误/无限 loading,route =', route);
  } finally {
    await closeMiniProgram(session);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[login-smoke] FAIL:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  assertLandingHealthy,
  assertRuntimeConfigured,
  expectedLandingRoute,
  main,
};
