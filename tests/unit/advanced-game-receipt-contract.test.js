const assert = require('node:assert/strict');
const test = require('node:test');

const COMPONENT_PATH = require.resolve('../../pages/play/components/advanced-game/index.js');
let definition;

function loadDefinition() {
  const previousComponent = global.Component;
  const previousGetApp = global.getApp;
  global.Component = (options) => { definition = options; };
  global.getApp = () => ({ sendRequest() {} });
  delete require.cache[COMPONENT_PATH];
  require(COMPONENT_PATH);
  global.Component = previousComponent;
  global.getApp = previousGetApp;
}
loadDefinition();

/** queue: 每次 request 按顺序取一项；{ res } 走 resolve，{ err } 走 reject。 */
function createGame(queue, state) {
  const calls = [];
  const instance = {
    properties: {},
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), {
      state: Object.assign({
        sessionId: 42, version: 3, status: 'RUNNING', draws: [],
        config: { random: { enabled: true, drawCount: 3, items: [] }, branch: { enabled: false, steps: [] },
          multiplayer: { enabled: false, roles: [], requiredTurns: 1 }, leaderboard: { enabled: false },
          timer: { enabled: false } },
        multiplayer: { roles: {}, members: [], completedUnitIds: [], turnIndex: 0 },
      }, state || {}),
    }),
    setData(update, cb) { Object.assign(this.data, update); if (cb) cb(); },
    triggerEvent() {},
    syncTimer() {},
    stopTimer() {},
    loadLeaderboard() {},
  };
  Object.assign(instance, definition.methods);
  instance.request = function (url, method, data) {
    calls.push({ url, method, data });
    const next = queue.shift();
    if (!next) return Promise.reject(new Error('unexpected request: ' + url));
    return next.err ? Promise.reject(next.err) : Promise.resolve(next.res);
  };
  instance.calls = calls;
  return instance;
}

const okAction = (version) => ({ res: { code: 200, data: { sessionId: 42, version, status: 'RUNNING', draws: [], config: {} } } });

test('提交成功：hydrate 权威状态，不进 unknown', async () => {
  const game = createGame([okAction(4)]);
  await game.action('DRAW', {});
  assert.equal(game.data.unknown, false);
  assert.equal(game.data.acting, false);
  assert.equal(game.data.state.version, 4);
});

test('★负控：响应丢失 ⇒ unknown，不得写成失败，也不得放行重复提交', async () => {
  const game = createGame([{ err: new Error('timeout') }, { err: new Error('timeout') }]);
  await game.action('DRAW', {});
  await new Promise(setImmediate);

  assert.equal(game.data.unknown, true, 'unknown 必须置位');
  assert.equal(game.data.error, '', 'unknown 不能被写成 error —— 那是在对用户说「失败了」');
  assert.match(game.data.unknownText, /勿重复提交|核对/);

  const before = game.calls.length;
  await game.action('DRAW', {});
  assert.equal(game.calls.length, before, 'unknown 未解除前不得再发写请求');
});

test('unknown 回读发现 version 已前进 ⇒ 判定已落地，清锁且不重发', async () => {
  const game = createGame([
    { err: new Error('timeout') },
    { res: { code: 200, data: { sessionId: 42, version: 4, status: 'RUNNING', draws: [{ id: 'x' }], config: {} } } },
  ]);
  await game.action('DRAW', {});
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(game.data.unknown, false);
  assert.equal(game.data.state.version, 4, '必须采用服务端权威 version');
  assert.equal(game.data.error, '', '写入已落地，不该提示重试');
  assert.equal(game.calls[1].url, '/api/play/advanced/state', '回读必须问服务端，不是读本地缓存');
});

test('★多人局:version 前进也不算证据 —— 队友的写入同样推高它,不许判成我方已落地', async () => {
  const game = createGame([
    { err: new Error('timeout') },
    // 队友写了一笔:version 从 3 涨到 4,但我的 DRAW 一个 draw 都没留下。
    { res: { code: 200, data: { sessionId: 42, version: 4, status: 'RUNNING', draws: [],
        config: { multiplayer: { enabled: true } } } } },
  ]);
  await game.action('DRAW', {});
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(game.data.unknown, false, '回读拿到结果就该解锁,不能永远转圈');
  assert.notEqual(game.data.error, '', '证不到是我落的,就不许把提示清空当成功');
  assert.match(game.data.error, /没能确认/, '要如实说「没能确认」,别谎报成功也别谎报失败');
  assert.match(game.data.error, /不会重复提交/, '得告诉用户重试是安全的(幂等键兜底)');
});

test('unknown 回读发现 version 未变 ⇒ 说清没提交成功，才放行重试', async () => {
  const game = createGame([
    { err: new Error('timeout') },
    { res: { code: 200, data: { sessionId: 42, version: 3, status: 'RUNNING', draws: [], config: {} } } },
  ]);
  await game.action('DRAW', {});
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(game.data.unknown, false);
  assert.match(game.data.error, /没有提交成功/);
});

test('回读本身也失败 ⇒ 保持 unknown 锁定，不猜结论', async () => {
  const game = createGame([{ err: new Error('timeout') }, { err: new Error('still offline') }]);
  await game.action('DRAW', {});
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(game.data.unknown, true, '核对不上就得一直锁着');
  assert.equal(game.data.readingBack, false, '要能再点一次核对');
  assert.match(game.data.unknownText, /勿重复提交/);
});

test('★同一 version 上重试复用同一幂等键 —— 服务端 replay 才能生效', async () => {
  const first = createGame([{ err: new Error('timeout') },
    { res: { code: 200, data: { sessionId: 42, version: 3, status: 'RUNNING', draws: [], config: {} } } }]);
  await first.action('CHOOSE', { optionId: 'a1' });
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  const retryKeySource = createGame([okAction(4)], { version: 3 });
  await retryKeySource.action('CHOOSE', { optionId: 'a1' });

  assert.equal(first.calls[0].data.idempotencyKey, retryKeySource.calls[0].data.idempotencyKey,
    '同一 session+version+动作+入参必须出同一个键');
});

test('服务端说「状态已更新」⇒ 自动回读权威状态，不让用户拿旧 version 反复重发', async () => {
  const game = createGame([
    { res: { code: 500, msg: '状态已更新，请刷新后重试' } },
    { res: { code: 200, data: { sessionId: 42, version: 9, status: 'RUNNING', draws: [], config: {} } } },
  ]);
  await game.action('DRAW', {});
  await new Promise(setImmediate);
  await new Promise(setImmediate);

  assert.equal(game.calls[1].url, '/api/play/advanced/state');
  assert.equal(game.data.state.version, 9);
  assert.equal(game.data.acting, false);
});

test('state 缺 version ⇒ 拒发写请求，不拿空幂等键去撞服务端', async () => {
  const game = createGame([], { version: undefined });
  await game.action('DRAW', {});
  assert.equal(game.calls.length, 0);
  assert.match(game.data.error, /状态不完整/);
});

test('★C-25 榜单请求失败:落「榜单暂时读不到」行内态,不再 unhandled rejection', async () => {
  const game = createGame([{ err: new Error('network down') }]);
  await game.loadLeaderboard();
  await new Promise(setImmediate);
  assert.equal(game.data.leaderboardError, true);
  assert.equal(game.data.leaderboardLoading, false);
});

test('C-25 榜单成功清掉失败态;业务错也落失败态而不是静默', async () => {
  const ok = createGame([{ res: { code: 200, data: [{ rank: 1, displayName: '阿杰', score: 9 }] } }]);
  await ok.loadLeaderboard();
  await new Promise(setImmediate);
  assert.equal(ok.data.leaderboardError, false);
  assert.equal(ok.data.leaderboard.length, 1);

  const denied = createGame([{ res: { code: 500, msg: '该主题未开启排行榜' } }]);
  await denied.loadLeaderboard();
  await new Promise(setImmediate);
  assert.equal(denied.data.leaderboardError, true);
  assert.equal(denied.data.leaderboard.length, 0);
});
