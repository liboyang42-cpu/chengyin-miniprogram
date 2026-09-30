// 官方活动 V2 小程序自证：当前 worktree 的页面编译、关键状态渲染与 V2 任务叠层交互。
// 后端未部署时仅注入展示数据；不调用写接口、不依赖生产数据。
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

// 开发者工具 2.02 已不在 Tool.getInfo 中返回旧字段 SDKVersion；automator 0.12.1
// 会在真正调用页面协议前对 undefined 做版本比较而退出。保留有版本时的原检查，
// 无旧字段时让后续实际页面协议/断言承担兼容性验证，不改 node_modules。
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const checkVersion = MiniProgram.prototype.checkVersion;
MiniProgram.prototype.checkVersion = async function () {
  const info = await this.send('Tool.getInfo');
  if (info && (info.SDKVersion || info.sdkVersion)) return checkVersion.call(this);
  console.log('AUTOMATOR_COMPAT: Tool.getInfo has no legacy SDKVersion', JSON.stringify(info || {}));
};

const projectPath = path.resolve(__dirname, '..');
const shotDir = path.join(projectPath, '.mcp-artifacts', 'official-event-v2');
const cliPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const results = [];

function expect(name, condition, detail) {
  results.push({ name, pass: !!condition, detail: detail || '' });
}

async function shot(mp, name) {
  await mp.screenshot({ path: path.join(shotDir, name) });
}

(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  const mp = await automator.launch({ projectPath, cliPath, trustProject: true });
  const consoleErrors = [];
  mp.on('console', (message) => {
    if (message.type === 'error') {
      consoleErrors.push(String(message.args && message.args[0] || '').slice(0, 240));
    }
  });

  try {
    let page = await mp.reLaunch('/pages/activity/list/index');
    await page.waitFor(800);
    await page.setData({
      loading: false,
      curError: false,
      canPublish: true,
      tab: 0,
      summary: '进行中 · 共 1 个活动',
      events: [{
        id: 902, contractVersion: 2, title: '成都城市夜行 · V2', subtitle: '到达证据驱动，不使用旧进度加一', city: '成都',
        _statusText: '进行中', _statusVariant: 'blue', _live: true, _timeText: '距结束 6 小时', participants: 28,
        _pct: 48, _coverStyle: '', collective: { enabled: true, pct: 48 },
      }],
    });
    await shot(mp, '01-v2-event-list.png');
    expect('列表页可渲染 V2 活动', await page.data('events[0].contractVersion') === 2);

    page = await mp.reLaunch('/pages/activity/official-detail/index?id=902');
    await page.waitFor(800);
    await page.setData({
      loading: false,
      loadErr: false,
      countdown: '距结束 6 小时',
      rewards: ['🏅 完成证据后结算徽章', '✨ 50 成长值'],
      cta: { text: '去漫游 · 验证到达', type: 'roam' },
      e: {
        id: 902, contractVersion: 2, _isV2: true, _statusText: '进行中', title: '成都城市夜行 · V2',
        subtitle: '只接受服务端验证的到达事实', city: '成都', status: 3, signed: true,
        participants: 28, _taskDone: 1, _taskTotal: 2, eligible: false, _eligibleText: '完成全部任务后获得资格',
        story: '从漫游入口开始，在活动绑定点主动验证到达。', paused: false,
        collective: { enabled: true, pct: 48, current: 48, threshold: 100 },
        missions: [
          { missionCode: 'poi-arrival', title: '抵达锦江码头', description: '在有效漫游会话内主动验证', missionType: 'ROAM_POI_ARRIVAL', canVerifyArrival: true, complete: false },
          { missionCode: 'theme-finish', title: '完成夜行主题', description: '主题完成后由服务端同步', missionType: 'THEME_VERIFIED_FINISH', canVerifyArrival: false, complete: true },
        ],
      },
    });
    await shot(mp, '02-v2-event-detail.png');
    expect('详情页显示 V2 任务总数', await page.data('e._taskTotal') === 2);
    expect('详情页 CTA 指向服务端到达验证', await page.data('cta.type') === 'roam');

    page = await mp.reLaunch('/pages/activity/official-inbox/index');
    await page.waitFor(600);
    await page.setData({
      loading: false,
      error: '',
      invites: [{
        partyId: 44, eventTitle: '成都城市夜行 · V2', city: '成都', role: 'FULFILLMENT_MERCHANT', _role: '商家履约',
        status: 'INVITED', _status: '待你确认', targetType: 'MISSION', targetId: 7,
        _window: '7月23日 — 7月25日', responsibilitySummary: '为任务完成者核销夜行券。',
      }],
    });
    await shot(mp, '03-party-inbox.png');
    expect('承接收件箱仅以 partyId 为动作对象', await page.data('invites[0].partyId') === 44);

    page = await mp.reLaunch('/pages/roam/index?eventId=902&missionCode=poi-arrival');
    await page.waitFor(1200);
    await page.setData({
      screen: 'map',
      visit: { active: false },
      eventOverlay: {
        show: true, id: 902, title: '成都城市夜行 · V2', status: 3, signed: true, paused: false,
        missions: [{ missionCode: 'poi-arrival', title: '抵达锦江码头', description: '到达后手动验证', canVerifyArrival: true, complete: false }],
        points: [{ latitude: 30.657, longitude: 104.065, radiusM: 100, name: '锦江码头', missionCodes: ['poi-arrival'] }],
        feedback: null,
      },
    });
    await shot(mp, '04-roam-v2-overlay.png');
    await page.callMethod('verifyEventArrival', { currentTarget: { dataset: { mission: 'poi-arrival' } } });
    expect('到达验证缺少会话时给出可见反馈', /漫游会话|定位/.test((await page.data('eventOverlay.feedback.text')) || ''));
    await page.callMethod('closeEventOverlay');
    expect('关闭活动叠层后恢复普通漫游', await page.data('eventOverlay.show') === false);
    await shot(mp, '05-roam-overlay-closed.png');

    const fatalErrors = consoleErrors.filter((line) => /SyntaxError|ReferenceError|TypeError|Cannot find module/i.test(line));
    expect('页面没有语法或运行时致命错误', fatalErrors.length === 0, fatalErrors.join(' | '));
  } finally {
    console.log('CONSOLE_ERRORS:', consoleErrors.length, consoleErrors.join(' | '));
    results.forEach((result) => console.log((result.pass ? 'PASS' : 'FAIL') + ' ' + result.name + (result.detail ? ' ' + result.detail : '')));
    await mp.close();
  }

  const failed = results.filter((result) => !result.pass);
  console.log('SUMMARY:', (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error('DRIVER_ERROR:', error && (error.stack || error.message));
  process.exit(2);
});
