#!/usr/bin/env node
/**
 * AI 入口链路自证:坐实 /api/ai/* 的 @RequestBody 链路真的通了。
 *
 * 【为什么要这个脚本】
 * 2026-07-16 查明:/api/ai/* 全部端点自 2026-06-28 建成起从未被真正调通过。
 * request-client.js:33-50 在 POST 不传 header 时发 urlencoded,而后端 7 个端点全是 @RequestBody POJO,
 * 全后端零自定义 HttpMessageConverter → Spring 参数解析阶段就抛 HttpMediaTypeNotSupportedException,
 * 被 GlobalExceptionHandler 的 @ExceptionHandler(Exception.class) 兜成 HTTP 200 + {code:500, msg:"Content type ... not supported"}。
 * 单测/ApiAiControllerTest 全绿也发现不了 —— 它们直接 new Controller() 调方法,不过 DispatcherServlet,
 * 而 415 发生在方法体执行「之前」。这是结构性假绿,只有真发 HTTP 才能证伪。
 *
 * 【判决性实验 —— 零 AI 配额消耗】
 * 后端门禁顺序:@RequestBody 参数绑定 → 方法体第一行 resolveMemberId() → gateRole() → 才进 AI 网关。
 * 所以 body 有没有被解析,看 msg 就能分辨,根本不用真的跑 AI:
 *   坏写法(裸对象无 header) → "Content type '...urlencoded' not supported"  ← 方法体一行没跑
 *   好写法(stringify+header) → "请先登录" / "当前身份暂不支持AI创作..." / 200  ← 方法体跑起来了 = body 已解析
 * 前者是负控(在生产上真实复现原 bug,证明诊断没错、且断言分辨得出),后者是正控。
 * 两者都不进 AI 网关 → 不烧 dailyLimit(20/天,全端点共用一池)。
 *
 * 【运行前提】
 *   DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" node tests/automator/ai-entries-smoke.js
 * 前提不满足时直接非 0 退出,绝不假绿(照 login-smoke.js 的约定)。
 *
 * ⚠️ 代码身份校验:本机可能有多个开发者工具实例跑着「别的 worktree」的代码(实测 2026-07-16 就有两个跑 s0714-1856)。
 *    显式 WS_ENDPOINT 只用于已确认的本项目端口；默认由 harness 通过 cli auto + 显式 projectPath 创建独立端口，
 *    并在跑断言前先证明连上的确实是本 worktree 的码。
 */
const path = require('path');
const { closeMiniProgram, openMiniProgram } = require('./harness');

const PROJECT_PATH = path.resolve(__dirname, '..', '..');   // ← worktree 相对,绝不硬编码主仓库路径
const CLUB_DETAIL = 'pages/club/detail/index';
const PRECHECK_URL = '/api/ai/safety/precheck';
const CT_REJECT_MARK = 'not supported';   // Spring 的 "Content type '...' not supported"

let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(ok, label, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '\n        → ' + detail : ''}`);
  if (!ok) failures++;
}

// 在小程序 AppService 里真发一次请求,把 {code,msg} 捞回来。
// 走的是真实 app.sendRequest → request-client → wx.request 全链路,不是模拟。
function sendVia(mp, opts) {
  return mp.evaluate(function (o) {
    return new Promise(function (resolve) {
      var param = {
        url: o.url,
        method: 'POST',
        silentError: true,          // 关掉 request-client 的自动 toast,免得糊屏
        data: o.stringify ? JSON.stringify(o.body) : o.body,
        success: function (res) { resolve({ code: String(res && res.code), msg: String((res && res.msg) || '') }); },
        fail: function (e) { resolve({ code: 'FAIL', msg: String((e && e.errMsg) || e) }); }
      };
      if (o.header) param.header = { 'Content-Type': 'application/json' };
      getApp().sendRequest(param);
    });
  }, opts);
}

async function main() {
  const session = await openMiniProgram({ projectPath: PROJECT_PATH });
  const mp = session.mp;
  try {
    // ---- 0. 代码身份校验:确认连上的是本 worktree 的码,不是别的实例 ----
    // aiSheetShow / onClubAiOpen 是本分支新加的,旧码上不存在 → 用它当身份指纹。
    await mp.reLaunch('/' + CLUB_DETAIL + '?owner=1');
    await sleep(1200);
    const page = await mp.currentPage();
    const data = await page.data();
    const hasAiState = data && Object.prototype.hasOwnProperty.call(data, 'aiSheetShow');
    check(hasAiState, '代码身份:连上的是本 worktree 的码(club/detail 有 aiSheetShow)',
      hasAiState ? null : '⚠️ 连到了旧码/别的 worktree —— 后面所有断言都不可信,中止');
    if (!hasAiState) throw new Error('代码身份校验失败:拒绝在错的代码上跑断言(这正是假绿的来源)');

    // ---- 1. 负控:用原 bug 写法打生产,必须被拒 ----
    // 这一步在生产上真实复现原 bug。它同时证明两件事:
    //   (a) 诊断没错 —— urlencoded 打 @RequestBody 确实过不去
    //   (b) 下一步的断言分辨得出好坏 —— 不是恒绿的摆设
    const bad = await sendVia(mp, { url: PRECHECK_URL, body: { title: 'x' }, stringify: false, header: false });
    const badRejected = bad.msg.indexOf(CT_REJECT_MARK) >= 0;
    check(badRejected, '负控:裸对象无 header(原 bug 写法)→ 生产确实拒收',
      `实收 code=${bad.code} msg=${bad.msg}`);

    // ---- 2. 正控:修复后的写法,body 必须被成功解析 ----
    // 只要 msg 不再是 "Content type ... not supported",就证明参数绑定过了、方法体跑起来了。
    // 之后拿到「请先登录」还是「当前身份暂不支持AI创作」还是 200,取决于当前登录态/角色,
    // 三者都同等地证明 header 修复生效(它们全在方法体里,body 没解析成功根本走不到)。
    const good = await sendVia(mp, {
      url: PRECHECK_URL,
      body: { title: '自证路线', subtitle: '', description: '', nodes: [] },
      stringify: true, header: true
    });
    const goodParsed = good.msg.indexOf(CT_REJECT_MARK) < 0;
    check(goodParsed, '正控:stringify + Content-Type → body 被后端成功解析(header 修复端到端生效)',
      `实收 code=${good.code} msg=${good.msg}` +
      (goodParsed ? '  ← 已越过参数绑定、进入方法体' : '  ← 仍卡在参数绑定,修复没生效'));

    console.log('\n[ai-smoke] 后端对同一端点的两种回答:');
    console.log('  坏写法 →', bad.msg);
    console.log('  好写法 →', good.msg);
    console.log('  这两条 msg 的差异,就是「链路从没通过 → 现在通了」的判决性证据。\n');
  } finally {
    await closeMiniProgram(session);
  }
  if (failures) {
    console.error(`[ai-smoke] ${failures} 条断言失败`);
    process.exit(1);
  }
  console.log('[ai-smoke] 全部通过');
}

main().catch((e) => { console.error('[ai-smoke] 出错:', e && e.message ? e.message : e); process.exit(1); });
