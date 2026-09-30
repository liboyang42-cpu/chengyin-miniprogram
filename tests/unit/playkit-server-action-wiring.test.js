/* 二十个玩法的提交要真的到得了服务端(2026-09-10;0922 现场感契约加了喊一嗓子)
 *
 * ★ 这条缺口的形状是**静默**:组件抛了事件、页面在 ACTION_OF 里查不到动作名就 return ——
 * 没有请求、没有 toast、没有日志,玩家做完那一下什么也没发生。所以它必须有门禁。
 *
 * 动作名与字段名的真源是后端 AdvancedGameRuntimeServiceImpl 的 switch 与各 submitXxx:
 * 这里只钉「客户端发出去的那一份和它对得上」。
 */
const assert = require('node:assert/strict')
const test = require('node:test')

const { serverAction, serverPayload } = require('../../pages/play/utils/playkit-view.js')
const fixture = require('../fixtures/playkit-server-actions.json')

test('每个能提交的玩法都在册,动作名逐条对后端 switch', () => {
  const WANT = {
    'coinflip:flip': 'FLIP_COIN',
    'diceroll:roll': 'ROLL_DICE',
    'estimate:submit': 'SUBMIT_ESTIMATE',
    'pricepair:submit': 'SUBMIT_PRICE_PAIR',
    'sort:submit': 'SUBMIT_SORT',
    'match:submit': 'SUBMIT_MATCH',
    'classify:submit': 'SUBMIT_CLASSIFY',
    'hidden:submit': 'SUBMIT_HIDDEN_OBJECT',
    'predict:submit': 'SUBMIT_PREDICT',
    'reaction:submit': 'SUBMIT_REACTION',
    'ballshake:submit': 'SUBMIT_BALL_SHAKE',
    'quiethold:submit': 'SUBMIT_QUIET_HOLD',
    'shout:submit': 'SUBMIT_SHOUT',
    'countdown:finish': 'SUBMIT_COUNTDOWN',
    'stopwatch:submit': 'SUBMIT_STOPWATCH',
    // 计步换成原型那一屏(walk)之后,同步与落章都走这一条
    'walk:sync': 'SUBMIT_STEPS',
    'walk:claim': 'SUBMIT_STEPS',
  }
  for (const [key, name] of Object.entries(WANT)) {
    const [type, action] = key.split(':')
    assert.equal(serverAction(type, action), name, key + ' 没在册 —— 玩家做完那一下会静默地什么都不发生')
  }
})

test('★六个挑战类都要先开表,game 用后端认的驼峰名', () => {
  const WANT = {
    reaction: 'reaction', ballshake: 'ballShake', quiethold: 'quietHold',
    shout: 'shout', countdown: 'countdown', stopwatch: 'stopwatch',
  }
  for (const [type, game] of Object.entries(WANT)) {
    assert.equal(serverAction(type, 'start'), 'START_CHALLENGE', type + ' 少了开表')
    assert.deepEqual(serverPayload(type, 'start', {}), { game: game },
      type + ' 的 game 值与后端 challengeKey 的白名单对不上')
  }
})

test('★字段名要翻译:组件按玩家读的命名,服务端按判定用的命名', () => {
  assert.deepEqual(serverPayload('estimate', 'submit', { guess: 42 }), { value: 42 })
  assert.deepEqual(serverPayload('pricepair', 'submit', { index: 2, pickId: 'p3' }), { pickId: 'p3' })
  assert.deepEqual(serverPayload('sort', 'submit', { order: ['b', 'a'] }), { order: ['b', 'a'] })
  assert.deepEqual(serverPayload('match', 'submit', { pairs: [{ leftId: 'l1', rightId: 'r1' }] }),
    { pairs: [{ leftId: 'l1', rightId: 'r1' }] })
  assert.deepEqual(serverPayload('classify', 'submit', { placement: { i1: 'b1' } }),
    { placement: { i1: 'b1' } })
  // 百分比 → 比例:组件按百分比定位,服务端按 0–1 收。不换算的话每一点都被打回
  assert.deepEqual(serverPayload('hidden', 'submit', { x: 12.5, y: 80 }), { x: 0.125, y: 0.8 })
  assert.deepEqual(serverPayload('predict', 'submit', { key: 'B', index: 1 }), { optionKey: 'B' })
  assert.deepEqual(serverPayload('reaction', 'submit', { times: [310, 288] }), { roundsMs: [310, 288] })
  assert.deepEqual(serverPayload('ballshake', 'submit', { hits: 30 }), { hits: 30 })
  // 秒 → 毫秒:这一条弄错的话服务端会拿 15 当 15 毫秒,永远判不过
  assert.deepEqual(serverPayload('quiethold', 'submit', { heldSeconds: 15 }), { heldMs: 15000 })
  // 喊一嗓子的组件直接按毫秒报(它自己攒的是 0.1 秒粒度的表),这一层不再换算
  assert.deepEqual(serverPayload('shout', 'submit', { heldMs: 5200 }), { heldMs: 5200 })
  assert.deepEqual(serverPayload('stopwatch', 'submit', { elapsedMs: 9880, hit: true }), { stoppedMs: 9880 })
  // 结果由服务端算的三个不带参数
  assert.deepEqual(serverPayload('coinflip', 'flip', {}), {})
  assert.deepEqual(serverPayload('diceroll', 'roll', { diceCount: 2 }), {})
  assert.deepEqual(serverPayload('countdown', 'finish', {}), {})
})

test('★拍照问答不在动作表里 —— 它是两步,不是一步', () => {
  // 先上传拿到地址、再提交地址。在册的话会被当成一步直接发,而组件手里只有临时路径
  assert.equal(serverAction('qa', 'shoot'), '')
  assert.equal(serverAction('qa', 'submit'), 'SUBMIT_QA')
  assert.equal(serverAction('scan', 'scanned'), 'SUBMIT_SCAN')
  assert.deepEqual(serverPayload('scan', 'scanned', { code: 'CY-0042' }), { code: 'CY-0042' })
  // 打字给 input、选项给 optionId —— 组件按模式只给其中一个
  assert.deepEqual(serverPayload('qa', 'submit', { mode: 'type', input: '1908' }), { input: '1908' })
  assert.deepEqual(serverPayload('qa', 'submit', { mode: 'pick', index: 0, optionId: 'a' }), { optionId: 'a' })
  assert.deepEqual(serverPayload('qa', 'submit', { mode: 'pick', optionIds: ['a', 'c'] }),
    { optionIds: ['a', 'c'] })
})

test('★抽卡与分支:客户端只发请求,内容与走向都由服务端定', () => {
  assert.equal(serverAction('random', 'draw'), 'DRAW')
  assert.deepEqual(serverPayload('random', 'draw', { index: 2 }), {},
    '抽哪一件不能由客户端说了算 —— 带了下标就等于玩家自己挑内容,盲盒就不盲了')
  assert.equal(serverAction('branch', 'choose'), 'CHOOSE')
  assert.deepEqual(serverPayload('branch', 'choose', { optionId: 'left', index: 0 }),
    { optionId: 'left' }, '走向由服务端按 optionId 判,下标在它那边没有意义')
})

test('★六个挑战壳真的会抛 start,分发器真的接住,页面真的走翻译层', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const ROOT = path.resolve(__dirname, '../..')
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  for (const k of ['reaction', 'ballshake', 'quiethold', 'shout', 'countdown', 'stopwatch']) {
    const src = read('pages/play/components/playkit-' + k + '/index.js')
    assert.match(src, /triggerEvent\('start'\)/,
      k + ' 开跑时没报 start —— 服务端没记起点,之后的提交一律判「还没开始」')
  }
  /* 组件抛了不等于到了。2026-09-19 实测:分发器只给 countdown / stopwatch 接了 bind:start,
     另三个玩法玩家能玩完、成绩永远不成立(后端 serverElapsedMs 抛「还没开始」),
     且全程静默 —— 所以这一半必须和上面那一半钉在同一条测试里。 */
  const kit = read('pages/play/components/playkit/index.wxml').replace(/\s+/g, ' ')
  for (const k of ['reaction', 'ballshake', 'quiethold', 'shout', 'countdown', 'stopwatch']) {
    const tag = new RegExp('<cy-playkit-' + k + '\\b[^>]*\\bbind:start="onStart"')
    assert.match(kit, tag,
      '分发器没接 ' + k + ' 的 start —— START_CHALLENGE 发不出去,玩法成绩永远不成立')
  }
  const page = read('pages/play/index.js').replace(/\s+/g, ' ')
  assert.match(page, /game\.action\(name, serverPayload\(kit\.type, action, detail\)\)/,
    '页面把 detail 原样发出去了 —— 字段名对不上,服务端按 0 判,而且不报错')
})

/* ★ 跨语言那一半:同一份夹具后端也在读(PlaykitActionPayloadContractTest),
   它拿这里的 payload 真跑一遍 act()。两边共读一份才叫对得上 ——
   各自对着自己的假设写断言,就是两边一起绿、一起错。 */
test('★夹具里的每一条:动作名与字段名都由这一层产出', () => {
  assert.ok(fixture.cases.length >= 18, '夹具被缩水了')
  for (const c of fixture.cases) {
    const where = c.game + ' / ' + c.type + ':' + c.action
    assert.equal(serverAction(c.type, c.action), c.serverAction, where + ' 动作名对不上')
    assert.deepEqual(serverPayload(c.type, c.action, c.detail), c.payload, where + ' 字段名对不上')
  }
})

test('负控:把一条从表里摘掉必须判红', () => {
  assert.equal(serverAction('stopwatch', 'submit'), 'SUBMIT_STOPWATCH')
  assert.equal(serverAction('stopwatch', '不存在的动作'), '', '不在册的一律返回空串,不许瞎拼动作名')
  assert.equal(serverAction('不存在的玩法', 'submit'), '')
})

/* ★ 计步的密文那一步:SUBMIT_STEPS 必须带 wx.login 的 code + getWeRunData 的密文,
   服务端才解得开。页面用一个 if 把它从通用提交里岔出去 —— 这个 if 早先认的是
   `action === 'refresh'`(旧 steps 屏的事件名)。2026-09-16 换成原型的 walk 屏之后,
   它发的是 sync / claim,会直接掉进通用分支、发出一个没有 encryptedData 的
   SUBMIT_STEPS:服务端 400、玩家点了「同步微信运动」什么也没发生。 */
test('★计步走密文那条路:walk 屏的动作必须被岔去 _submitSteps', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../pages/play/index.js'), 'utf8')

  const guard = src.match(/if \(([^)]*)\) \{ this\._submitSteps\(\); return; \}/)
  assert.ok(guard, '页面里必须有一处把计步岔去 _submitSteps')
  assert.ok(guard[1].includes("kit.type === 'walk'"),
    '岔口要按 kit.type 认计步,不能只认某一个事件名 —— 换屏就会漏')
})
