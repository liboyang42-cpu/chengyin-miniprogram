/* 拍物成卡:判过这一次的回包带着那张卡(后端 view.objectCard),必须经 cy-advanced-game 一路抛给页面。
 *
 * 2026-09-24 审查实证:emitSession 只往上抛 sessionId / version / playKit / vars 四个键,
 * objectCard 在这一层被丢掉 —— 页面拿到的恒为 undefined,当场那一屏永远只说「这张过了」,
 * 而契约测试直接把 objectCard 喂给 pickPlayKit,绕过了这一层,所以一直绿着。
 * 这里走真 action → 真 hydrate → 真 emitSession,只桩网络。
 *
 * 另一条:提交没成(非 200 / 状态已更新 / 回读说没写进去 / 回读也失败)时抛 actionfail,
 * 页面据此让拍物成卡那一屏回到取景 —— 否则玩家对着「处理中」干等 45 秒。 */
const assert = require('node:assert/strict')
const test = require('node:test')

const COMPONENT_PATH = require.resolve('../../pages/play/components/advanced-game/index.js')
let definition
{
  const previousComponent = global.Component
  const previousGetApp = global.getApp
  global.Component = (options) => { definition = options }
  global.getApp = () => ({ sendRequest() {} })
  delete require.cache[COMPONENT_PATH]
  require(COMPONENT_PATH)
  global.Component = previousComponent
  global.getApp = previousGetApp
}

const STATE = {
  sessionId: 42, version: 3, status: 'RUNNING', draws: [],
  config: { random: { enabled: false, drawCount: 0, items: [] }, branch: { enabled: false, steps: [] },
    multiplayer: { enabled: false, roles: [], requiredTurns: 1 }, leaderboard: { enabled: false }, timer: { enabled: false } },
  multiplayer: { roles: {}, members: [], completedUnitIds: [], turnIndex: 0 },
}

function createGame(queue) {
  const events = []
  const instance = {
    properties: {},
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), { state: JSON.parse(JSON.stringify(STATE)) }),
    setData(update, cb) { Object.assign(this.data, update); if (cb) cb() },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    syncTimer() {}, stopTimer() {}, loadLeaderboard() {},
  }
  Object.assign(instance, definition.methods)
  instance.request = function () {
    const next = queue.shift()
    if (!next) return Promise.reject(new Error('unexpected request'))
    return next.err ? Promise.reject(next.err) : Promise.resolve(next.res)
  }
  instance.events = events
  return instance
}

const view = (version, extra) => Object.assign(JSON.parse(JSON.stringify(STATE)), { version }, extra || {})
const CARD = { id: 61, title: '半个牛油果', cutoutUrl: 'https://cdn/c.png', cutoutBox: [0.1, 0.2, 0.5, 0.5] }
const flush = () => new Promise(setImmediate)

test('★判过的回包带着卡:session 事件把 objectCard 原样抛给页面', async () => {
  const game = createGame([{ res: { code: 200, data: view(4, { objectCard: CARD }) } }])
  await game.action('SUBMIT_PHOTO_CHECK', { imageUrl: 'https://x/p.jpg' })
  const session = game.events.filter((e) => e.name === 'session').pop()
  assert.ok(session, '没有抛 session 事件')
  assert.deepEqual(session.detail.objectCard, CARD, 'objectCard 在 emitSession 这一层被丢了:当场那一屏永远出不了卡')
})

test('回包没带卡(老模板 / 没判过 / 回读):objectCard 为 null,不是 undefined', async () => {
  const game = createGame([{ res: { code: 200, data: view(4) } }])
  await game.action('SUBMIT_PHOTO_CHECK', {})
  assert.equal(game.events.filter((e) => e.name === 'session').pop().detail.objectCard, null)
})

test('★提交被服务端拒(非 200):抛 actionfail,带上动作名', async () => {
  const game = createGame([{ res: { code: 500, msg: '服务繁忙' } }])
  await game.action('SUBMIT_PHOTO_CHECK', {})
  assert.deepEqual(game.events.filter((e) => e.name === 'actionfail').map((e) => e.detail), [{ action: 'SUBMIT_PHOTO_CHECK' }])
})

test('状态已更新:回读完也抛 actionfail(这一步没提交)', async () => {
  const game = createGame([{ res: { code: 500, msg: '状态已更新,请刷新' } }, { res: { code: 200, data: view(5) } }])
  await game.action('SUBMIT_PHOTO_CHECK', {})
  await flush()
  assert.equal(game.events.filter((e) => e.name === 'actionfail').length, 1)
})

test('响应丢失后回读:没写进去 → actionfail;回读也失败 → actionfail', async () => {
  const notLanded = createGame([{ err: new Error('timeout') }, { res: { code: 200, data: view(3) } }])
  await notLanded.action('SUBMIT_PHOTO_CHECK', {})
  await flush(); await flush()
  assert.equal(notLanded.events.filter((e) => e.name === 'actionfail').length, 1, '回读说没写进去,却没通知页面')

  const readbackDown = createGame([{ err: new Error('timeout') }, { err: new Error('timeout') }])
  await readbackDown.action('SUBMIT_PHOTO_CHECK', {})
  await flush(); await flush()
  assert.equal(readbackDown.events.filter((e) => e.name === 'actionfail').length, 1, '回读也失败,那一屏还在转圈')
})

test('负控:响应丢失但回读证明已写进去 → 不抛 actionfail(那是成功)', async () => {
  const game = createGame([{ err: new Error('timeout') }, { res: { code: 200, data: view(4) } }])
  await game.action('SUBMIT_PHOTO_CHECK', {})
  await flush(); await flush()
  assert.equal(game.events.filter((e) => e.name === 'actionfail').length, 0)
})
