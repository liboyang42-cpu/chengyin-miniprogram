'use strict';

/* 审查 #1/#2/#5 的接线条约:组件抛上来的 kitaction 必须有明确的去处。
   断链的机理全部相同 —— 页面 switch 没有这个 case、掉进 default、
   serverAction 查不到动作名、_submitPlayKitAction 静默 return:
   玩家点了,什么也没发生,没有请求没有提示没有日志(2026-09 全链路审查)。 */

const assert = require('assert');
const test = require('node:test');

let pageConfig;
global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest() {},
});
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
};
global.Page = (config) => { pageConfig = config; };

function loadPlayPage() {
  delete require.cache[require.resolve('../../pages/play/index.js')];
  require('../../pages/play/index.js');
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = function (patch) {
    Object.keys(patch).forEach((key) => {
      const parts = key.split('.');
      let cursor = page.data;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (cursor[parts[i]] == null) cursor[parts[i]] = {};
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = patch[key];
    });
    if (typeof arguments[1] === 'function') arguments[1]();
  };
  return page;
}

/** 录音机替身:只证明"页面真的起了一段音频",不测 InnerAudioContext 本身 */
function stubAudio(page) {
  const rec = { src: '', plays: 0, pauses: 0 };
  global.wx.createInnerAudioContext = () => ({
    onTimeUpdate() {}, onEnded() {}, onError() {},
    play() { rec.src = this.src; rec.plays += 1; },
    pause() { rec.pauses += 1; },
    stop() {}, destroy() {},
  });
  page._kitAudio = null;
  return rec;
}

test('D20 内嵌结果继续会收起章节，弹层结果只收起玩法', () => {
  for (const present of ['inline', 'fullscreen']) {
    const page = loadPlayPage();
    page.data.chapterFull = true;
    page.data.playKit = { show: true, kit: { type: 'diceroll', mode: 'd20',
      present, result: { success: false } } };
    page.closePlayKit();
    assert.equal(page.data.chapterFull, present !== 'inline');
    assert.equal(page.data.playKit.show, false);
  }
});

test('#1 qa 屏点音频:kitaction{type:qa,action:audio} 必须真的起播(此前无声死线)', () => {
  const page = loadPlayPage();
  page.data.playKit = { show: true, kit: { type: 'qa', audioUrl: '/a/qa.mp3' } };
  const rec = stubAudio(page);

  page.onPlayKitAction({ detail: { type: 'qa', action: 'audio', detail: { playing: true } } });

  assert.equal(rec.plays, 1, 'audio 事件必须路由到播放');
  assert.equal(rec.src, '/a/qa.mp3');
  assert.equal(page.data.playKit.kit.playing, true);
});

test('#1 scan 屏点音频:pause 分支同样接上,不是只有 play', () => {
  const page = loadPlayPage();
  page.data.playKit = { show: true, kit: { type: 'scan', audioUrl: '/a/scan.mp3' } };
  const rec = stubAudio(page);

  page.onPlayKitAction({ detail: { type: 'scan', action: 'audio', detail: { playing: true } } });
  page.onPlayKitAction({ detail: { type: 'scan', action: 'audio', detail: { playing: false } } });

  assert.equal(rec.plays, 1);
  assert.equal(rec.pauses, 1);
  assert.equal(page.data.playKit.kit.playing, false);
});

test('#5 silentorder 认输:giveup 收尾这一屏(裁决:沉默点单不判定通关,无需上报)', () => {
  const page = loadPlayPage();
  page.data.playKit = { show: true, kit: { type: 'silentorder' } };

  page.onPlayKitAction({ detail: { type: 'silentorder', action: 'giveup', detail: { elapsedSeconds: 12 } } });

  assert.equal(page.data.playKit.show, false, '认输后这一屏必须收起来');
});

test('#5 timewindow 到点:open 必须回服务端问一次,本地时钟不是权威', () => {
  const page = loadPlayPage();
  let refreshed = 0;
  page.selectComponent = (sel) => {
    assert.equal(sel, '#advancedGame');
    return { refreshState() { refreshed += 1; } };
  };

  page.onPlayKitAction({ detail: { type: 'timewindow', action: 'open', detail: {} } });

  assert.equal(refreshed, 1, '到点要拉一次权威视图,门才可能真的开');
});

test('#2 猜数字/猜图/找东西(vm 8/9/10)做完玩法后走到达通路,不再落无按钮的死路屏', () => {
  [8, 9, 10].forEach((vm) => {
    const routes = [];
    const page = loadPlayPage();
    page.data.advancedPlay = { show: true, node: { nodeId: 7, vm } };
    page._advancedReadyNodeId = null;
    page.onSheetGoTap = () => routes.push('go:' + vm);
    page.startGame = () => routes.push('gamePlay:' + vm);

    page.onAdvancedReady({ detail: { nodeId: 7 } });

    // onAdvancedReady 的分支在 setData 回调里跑,loadPlayPage 的 setData 是同步的
    assert.deepEqual(routes, ['go:' + vm], 'vm=' + vm + ' 完成后应进节点卡到达链,而不是老任务页');
  });
});

/* ===== #3 bingo 接线 + #5 subscribe 落库:playkit-view 纯函数层 ===== */

const { pickPlayKit, serverAction } = require('../../pages/play/utils/playkit-view.js');

function session(playKit) {
  return { sessionId: 's1', version: 3, playKit };
}

test('#3 服务端下发 bingo 段 → 还出 bingo 屏,票面字段原样搬运', () => {
  const seg = {
    title: '城市九宫格',
    labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    cellSpecs: [{ t: 'a', how: '走到即亮' }, { t: 'b', how: '扫码进店' }],
    filledPositions: [0, 4, 8],
    lineReward: '一张券',
    fullReward: '大奖',
  };
  const kit = pickPlayKit(session({ bingo: seg }), new Date());
  assert.ok(kit, 'bingo 段必须还得出 kit —— 以前没有 TYPE_OF 条目,末尾 return null');
  assert.equal(kit.type, 'bingo');
  assert.equal(kit.title, '城市九宫格');
  assert.deepEqual(kit.filledPositions, [0, 4, 8]);
  assert.equal(kit.fullReward, '大奖');
});

test('#3 bingo 是垫底档:同会话还有没做完的玩法时不抢屏', () => {
  const kit = pickPlayKit(session({
    bingo: { title: 'b', labels: [], filledPositions: [0] },
    qa: { mode: 'TYPE', title: '答题' },
  }), new Date());
  assert.equal(kit.type, 'qa');
});

test('#5 timewindow 订阅:动作必须在册,视图回读的 subscribed 要透传', () => {
  assert.equal(serverAction('timewindow', 'subscribe'), 'SUBSCRIBE_TIME_WINDOW',
    '订阅要落库:后端已接这个 action,前端不许再静默丢弃');
  const kit = pickPlayKit(session({ timeWindow: {
    openFrom: '19:00', openTo: '21:00', title: 't', subscribeTmplId: 'tpl', subscribed: true,
  } }), new Date());
  assert.equal(kit.subscribed, true, '服务端说订过,票面就该显示已开启,而不是靠内存');
});
