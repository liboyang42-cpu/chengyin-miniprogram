// utils/playkit-view.js —— 服务端会话视图 → 可渲染 kit 的纯函数契约
//
// 这一层是 #853(前端)与 #857(后端)之间的翻译:服务端按机制分段给、可并存,
// UI 一次只弹一个。翻译错了不会报错,只会「玩法弹错一个」或「弹不出来」,所以逐条钉死。
const assert = require('node:assert/strict')
const test = require('node:test')

const { pickPlayKit, serverAction, secondsUntilOpen, KIT_PRIORITY, dailySignRevealState } =
  require('../../pages/play/utils/playkit-view.js')

const at = (h, m, s) => new Date(2026, 7, 26, h, m, s || 0)

test('没有玩法段时给 null,不是空对象', () => {
  assert.equal(pickPlayKit(null, at(12, 0)), null)
  assert.equal(pickPlayKit({}, at(12, 0)), null)
  assert.equal(pickPlayKit({ playKit: {} }, at(12, 0)), null)
})

test('多段并存时按优先级只挑一个:要动手的先于展示型', () => {
  const view = {
    sessionId: 51, version: 3,
    playKit: {
      dailySign: { lines: ['签'] },
      blindTaste: { title: '闭上眼', options: [{ key: 'A', label: '乌龙' }] },
    },
  }

  const kit = pickPlayKit(view, at(12, 0))

  assert.equal(kit.type, 'blindtaste', '答题应该先于收签弹出')
  // sessionId/version 必须跟着走 —— 提交动作要用它们做幂等键与 CAS
  assert.equal(kit.sessionId, 51)
  assert.equal(kit.version, 3)
  assert.ok(KIT_PRIORITY.indexOf('blindTaste') < KIT_PRIORITY.indexOf('dailySign'))
})

test('盲品:未答时不预选,答对后锁住并回显', () => {
  const base = { sessionId: 1, version: 0 }
  const options = [{ key: 'A', label: '桂花乌龙' }, { key: 'B', label: '茉莉雪芽' }]

  const fresh = pickPlayKit({ ...base, playKit: { blindTaste: { title: 't', options, xp: 15 } } }, at(12, 0))
  assert.equal(fresh.selectedKey, '', '没答过不能预选一个,否则像替玩家做了选择')
  assert.equal(fresh.locked, false)
  assert.equal(fresh.xpLabel, '答对 +15 XP')
  assert.ok(fresh.steps, '服务端省略 steps 时仍必须给读屏器完整兜底')

  const solved = pickPlayKit(
    { ...base, playKit: { blindTaste: { title: 't', options, xp: 15, solved: true, lastKey: 'B' } } },
    at(12, 0))
  assert.equal(solved.selectedKey, 'B')
  assert.equal(solved.locked, true)

  // 答错过但没答对:不回显、也不锁,玩家可以继续答(用户拍板:可重答)
  const retry = pickPlayKit(
    { ...base, playKit: { blindTaste: { title: 't', options, solved: false, lastKey: 'A', attempts: 1 } } },
    at(12, 0))
  assert.equal(retry.locked, false)
  assert.equal(retry.xpLabel, '', 'xp 为 0 时不承诺奖励')
})

test('已完成机制要让位给仍待完成的慢任务', () => {
  const kit = pickPlayKit({ sessionId: 1, version: 2, playKit: {
    blindTaste: { title: '已答', solved: true, options: [] },
    steps: { goal: 6000, todaySteps: 6200, reached: true },
    slowTask: { title: '明天再来', started: false, claimed: false, daysLeft: 1 },
  } }, at(12, 0))
  assert.equal(kit.type, 'slowtask')
})

test('计步:只过桥「走了多少 / 目标多少」,还差多少由 walk 屏自己算', () => {
  const half = pickPlayKit(
    { sessionId: 1, version: 0, playKit: { steps: { goal: 6000, todaySteps: 4286, xp: 20 } } }, at(12, 0))
  assert.equal(half.type, 'walk', '计步挑战走的是原型那屏(琥珀点阵 LCD)')
  assert.equal(half.steps, 4286)
  assert.equal(half.goal, 6000)
  /* ★ 目标锁死:达标与否服务端拿商家配的 cfg.goal 判(submitSteps),
     玩家在屏上 ± 改的只是本地数字 —— 不锁就是让他改一个不算数的数。 */
  assert.equal(half.goalLocked, true)

  // 服务端没给步数时给 0,不给 undefined —— kit 那边要拿它算还差多少
  const fresh = pickPlayKit(
    { sessionId: 1, version: 0, playKit: { steps: { goal: 6000 } } }, at(12, 0))
  assert.equal(fresh.steps, 0)
  assert.equal(fresh.goal, 6000)
})

test('计步:走够了就把位置让给还没做完的那一段', () => {
  const view = { sessionId: 1, version: 0, playKit: {
    steps: { goal: 6000, todaySteps: 6200, reached: true },
    qa: { mode: 'TYPE', title: '老板姓什么' },
  } }
  assert.equal(pickPlayKit(view, at(12, 0)).type, 'qa', '走够了还占着屏,后面那段就弹不出来')
})

test('城市签:票面全来自服务端_地址/留签人/那句/签号一一映射_不造兜底文案', () => {
  const kit = pickPlayKit(
    { sessionId: 1, version: 0, playKit: { dailySign: {
      address: '南京西路 1266 号', signer: '阿May', lines: ['雨天走后门'], leftAt: '2026-08-25 18:30',
      photoUrl: 'https://cdn.chengyinhub.com/u/8/lane.jpg', serial: 4, textMax: 40, claimedDate: '',
    } } },
    at(20, 0))

  assert.equal(kit.dateLabel, '08 / 26')
  assert.equal(kit.address, '南京西路 1266 号')
  assert.equal(kit.signer, '阿May')
  assert.deepEqual(kit.lines, ['雨天走后门'])
  assert.equal(kit.leftAt, '2026-08-25 18:30')
  assert.equal(kit.photoUrl, 'https://cdn.chengyinhub.com/u/8/lane.jpg')
  assert.equal(kit.serialLabel, 'NO. 0004', '签号 = 我是这一站第几位,不是日期')
  assert.equal(kit.textMax, 40)
  assert.equal(kit.claimed, false)
  assert.equal(kit.revealed, false)
})

test('城市签:开场签没人留过_落款和时间为空串_组件自己标「发起人」而不是这里编一个', () => {
  const kit = pickPlayKit(
    { sessionId: 1, version: 0, playKit: { dailySign: { address: '', lines: ['开场'], serial: 1 } } },
    at(20, 0))
  assert.equal(kit.signer, '')
  assert.equal(kit.leftAt, '')
  assert.equal(kit.photoUrl, '')
  assert.equal(kit.serialLabel, 'NO. 0001')
  assert.ok(!JSON.stringify(kit).includes('猫向导'), '不能再有造出来的角色:' + JSON.stringify(kit))
})

test('城市签:留过之后带回自己那句_claimed 与 revealed 同真', () => {
  const kit = pickPlayKit(
    { sessionId: 1, version: 0, playKit: { dailySign: {
      lines: ['上一句'], claimedDate: '2026-08-26', serial: 4, myText: '豆浆七点才开',
      myPhotoUrl: 'https://cdn.chengyinhub.com/u/7/door.jpg',
    } } },
    at(20, 0))
  assert.equal(kit.claimed, true)
  assert.equal(kit.revealed, true)
  assert.equal(kit.myText, '豆浆七点才开')
  assert.equal(kit.myPhotoUrl, 'https://cdn.chengyinhub.com/u/7/door.jpg')
})

test('城市签:刮层在留一句之前就刮开_留完回来的视图不再盖回去', () => {
  const unclaimed = { type: 'dailysign', claimed: false }
  const claimed = { type: 'dailysign', claimed: true }
  assert.equal(dailySignRevealState(null, claimed).revealed, true, '重进已留过的签直接显示')
  assert.equal(dailySignRevealState(unclaimed, claimed).revealed, true,
    '本次留完那句回来,签文早就刮开了,再盖一层等于要人刮两遍')
  assert.equal(dailySignRevealState(null, unclaimed).revealed, false)
})

test('慢任务到期进入可领取态_不得显示还有0天', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.resolve(__dirname,
    '../../pages/play/components/playkit-slowtask/index.wxml'), 'utf8')
  assert.match(wxml, /wx:elif="\{\{!claimed && daysLeft > 0\}\}"/)
})

test('音乐角文案不承诺奖励', () => {
  // 稿里写「爪印自动落章 +10 XP」,但音乐角明确不判定通关 —— 承诺了拿不到最伤
  const kit = pickPlayKit(
    { sessionId: 1, version: 0, playKit: { musicCorner: { title: 't', durationSeconds: 206 } } }, at(12, 0))
  assert.equal(kit.type, 'musiccorner')
  assert.ok(kit.hint.indexOf('XP') < 0, kit.hint)
  assert.ok(kit.hint.indexOf('落章') < 0, kit.hint)
})

test('跨夜时段的倒计时不能算成负数或一整天', () => {
  // 窗口 23:00–01:00
  assert.equal(secondsUntilOpen('23:00', at(22, 0)), 3600, '开点前一小时')
  // 23:30 已过今天的开点 ⇒ 等的是明天 23:00,而不是负数
  assert.equal(secondsUntilOpen('23:00', at(23, 30)), (23 * 60 + 30) * 60)
  assert.equal(secondsUntilOpen('', at(12, 0)), 0, '格式不对时给 0,不炸')
  assert.equal(secondsUntilOpen('25:00', at(12, 0)), 0)
})

/* ★ 这一段是十九个玩法此前**打不开**的那处接缝:后端把 branch/predict/random
   算进 playKit 了,而这一层不认它们 —— pickPlayKit 返回 null,弹窗压根不弹。
   不报错,只是没有。下面四条钉住三段各自的翻译与完成判据。 */

test('★分支:只吃服务端给的当前一步,选项带着 id 走', () => {
  const kit = pickPlayKit({
    sessionId: 7, version: 2,
    playKit: { branch: { currentStep: {
      id: 'start', title: '雨停了', body: '巷口有两条路。', terminal: false,
      options: [{ id: 'left', label: '往左' }, { id: 'right', label: '往右' }],
    } } },
  }, at(12, 0))

  assert.equal(kit.type, 'branch')
  assert.equal(kit.body, '巷口有两条路。')
  assert.deepEqual(kit.options, [{ id: 'left', t: '往左' }, { id: 'right', t: '往右' }])
  assert.equal(kit.ended, false)
  // 走向是服务端的事:客户端手上不该有 nextStepId 这种字段
  assert.equal(JSON.stringify(kit).indexOf('nextStepId'), -1)
})

test('★分支走到终点算这段完了,不再反复弹同一屏', () => {
  const view = {
    sessionId: 7, version: 9,
    playKit: {
      branch: { currentStep: { id: 'end', body: '你走到了河堤。', terminal: true, options: [] } },
      dailySign: { lines: ['签'] },
    },
  }
  const kit = pickPlayKit(view, at(12, 0))
  // 终点没有选项,再弹一次也没得选 —— 让位给还没做完的那一段
  assert.equal(kit.type, 'dailysign')
})

test('★抽卡:只给「能抽几次」和「已经抽到什么」,牌堆内容不下发', () => {
  const kit = pickPlayKit({
    sessionId: 7, version: 1,
    playKit: { random: { drawCount: 3, drawn: [{ id: 'a', label: '再来一杯', content: '下次到店出示' }] } },
  }, at(12, 0))

  assert.equal(kit.type, 'random')
  assert.equal(kit.drawCount, 3)
  assert.equal(kit.remaining, 2, '还剩两张盖着的')
  assert.equal(kit.drawn.length, 1)
})

test('★抽卡抽满才算完:还有次数就得接着弹,不然剩的次数玩家用不掉', () => {
  const half = pickPlayKit({
    sessionId: 7, version: 1,
    playKit: {
      random: { drawCount: 2, drawn: [{ id: 'a', label: 'A' }] },
      dailySign: { lines: ['签'] },
    },
  }, at(12, 0))
  assert.equal(half.type, 'random', '还剩一次,应该继续弹抽卡')

  const full = pickPlayKit({
    sessionId: 7, version: 1,
    playKit: {
      random: { drawCount: 2, drawn: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      dailySign: { lines: ['签'] },
    },
  }, at(12, 0))
  assert.equal(full.type, 'dailysign', '抽满了就让位')
})

test('★竞猜:押之前没有答案可给,押完之后才带揭晓三件套', () => {
  const before = pickPlayKit({
    sessionId: 7, version: 1,
    playKit: { predict: {
      question: '今天哪款卖得最多?', closeAtHour: 21, myOptionKey: '',
      options: [{ key: 'a', label: '冰美式' }, { key: 'b', label: '燕麦拿铁' }],
    } },
  }, at(12, 0))
  assert.equal(before.type, 'predict')
  assert.equal(before.myOptionKey, '')
  assert.equal(before.settleStatus, undefined, '还没押就没有揭晓状态')

  const after = pickPlayKit({
    sessionId: 7, version: 4,
    playKit: {
      predict: {
        question: '今天哪款卖得最多?', myOptionKey: 'b', settleStatus: 1, settledOption: 'b', won: true,
        options: [{ key: 'a', label: '冰美式' }, { key: 'b', label: '燕麦拿铁' }],
      },
      dailySign: { lines: ['签'] },
    },
  }, at(12, 0))
  // 押过就算完:答案由商家事后给,玩家这边没有第二个动作
  assert.equal(after.type, 'dailysign')
})

test('动作名映射:不在册的一律不发', () => {
  assert.equal(serverAction('blindtaste', 'answer'), 'SUBMIT_BLIND_TASTE')
  assert.equal(serverAction('diyname', 'submit'), 'SUBMIT_DIY_NAME')
  // 计步换成 walk 屏之后,同步与落章都走这一条
  assert.equal(serverAction('walk', 'sync'), 'SUBMIT_STEPS')
  assert.equal(serverAction('walk', 'claim'), 'SUBMIT_STEPS')
  assert.equal(serverAction('dailysign', 'accept'), 'CLAIM_DAILY_SIGN')

  // 拼不出服务端认识的动作名时必须给空串,而不是拼一个它不认识的发过去
  assert.equal(serverAction('musiccorner', 'toggle'), '')
  assert.equal(serverAction('blindtaste', 'close'), '')
  assert.equal(serverAction('', ''), '')
})

/* ★ 段名全表跑:服务端可能下发的每一段,pickPlayKit 都必须还出一个 kit。
   2026-09-11 实证:决定类与挑战类七段 + 猜数字 + 找东西一共九段,只有优先级表和
   action 表、没有 pickPlayKit 的分支,于是服务端下发了、客户端一路 return null ——
   十九个玩法有十个到不了玩家,不渲染、不报错、不打日志。
   名单取自玩法目录(node-game-catalog)的 PLAYKIT_SECTIONS,新加玩法忘了接线这条就红。
   ⚠️ 用 PLAYKIT_SECTIONS 不是 GAME_SECTIONS:目录里的 check 走 Encounter 不走 playKit,
   拿它去要 kit 会恒红,而恒红的断言最后一定被人注掉 —— 豁免写在目录里、有注释、有负控。 */
test('★每个玩法段都能还出 kit —— 缺一段就是整屏静默消失', () => {
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  const missing = []
  for (const section of catalog.PLAYKIT_SECTIONS) {
    const view = { sessionId: 's1', version: 1, playKit: { [section]: { title: 't' } } }
    const kit = pickPlayKit(view, at(12, 0))
    if (!kit || !kit.type) missing.push(section)
  }
  assert.deepEqual(missing, [], '这些段服务端会下发,客户端却拿不到 kit:' + missing.join(', '))
})

test('负控:把某一段从优先级表里摘掉,上一条必须判红', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../pages/play/utils/playkit-view.js'), 'utf8')
  assert.ok(src.includes("'coinFlip', 'diceRoll'"), '优先级表里必须有决定类那两段')
  const stripped = src.replace("'coinFlip', 'diceRoll',", "'diceRoll',")
  assert.ok(!stripped.includes("'coinFlip', 'diceRoll'"), '负控构造失败:没真摘掉')
})

/* ★ 第二条链路:分发器 wxml 绑的每个 `kit.X`,pickPlayKit 必须真的产出。
   kit 的属性**只**由 pages/play/components/playkit/index.wxml 从 kit.* 喂,
   没产出的那个属性会静默回落到组件默认值 —— 不报错、不打日志、只是那行字不出现。
   2026-09-15 实证:竞猜屏要的是原型那套 closeMode/closeDays(「第 N 天揭晓」),
   而我们全链路(配置、校验、后端投影、pickPlayKit)产出的是 closeAtHour(当天几点截止收注),
   于是玩家押完之后那句话永远是空的;预览却把 closeMode 写死成 'HOUR',
   所以商家在预览里看得见、玩家看不见。 */

/** 分发器里每个 kit 类型绑了哪些 kit.X —— 采集逻辑只此一份,门禁与负控共用。 */
function boundKeysByType() {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../../pages/play/components/playkit/index.wxml'), 'utf8')
  return tagsToBound(wxml.match(/<cy-playkit-[\s\S]*?\/>/g) || [])
}

function tagsToBound(tags) {
  const out = {}
  for (const tag of tags) {
    const type = (tag.match(/kit\.type === '([a-z]+)'/) || [])[1]
    if (!type) continue
    out[type] = [...tag.matchAll(/\{\{kit\.([A-Za-z0-9_]+)/g)]
      .map((m) => m[1]).filter((key) => key !== 'type')
  }
  return out
}

/** 某个玩法段:分发器绑了、pickPlayKit 没产出的那些属性 */
function unfedOf(section, bound) {
  const kit = pickPlayKit(
    { sessionId: 's1', version: 1, playKit: { [section]: { title: 't' } } }, at(12, 0))
  assert.ok(kit, section + ' 段还不出 kit')
  return { type: kit.type, missing: (bound[kit.type] || []).filter((key) => !(key in kit)) }
}

/* 有意留空的:kit 自己有回落,不是缺口。 */
const INTENTIONAL_FALLBACK = {
  // 扫码屏标题:配置里没有这个字段,kit 用 `|| TITLE` 回落到默认文案
  scan: ['title'],
  // 计步(walk 屏)的「同步中」是页面本地态,服务端会话视图里本来就没有
  walk: ['syncing'],
  // 抽卡:牌堆是盖着的,服务端只下发抽到了什么(drawn/drawCount)
  random: ['cards'],
}

/* 欠着的:功能在原型/施工文档里有,我们这边还没建。**不是豁免,是账。**
   ⚠️ 竞猜的「第 N 天揭晓」不在这张表里 —— 它不是某个属性没喂,而是整套模型没建
   (我们只有 closeAtHour),记在施工文档 §5.3 与 04-未开始 的交接文档里。 */
const KNOWN_UNFED = {}

test('★分发器绑的 kit.X 必须有人产出 —— 没产出就是那行字静默消失', () => {
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  const bound = boundKeysByType()

  const gaps = {}
  /* check 段走 Encounter 不回 kit,豁免写在目录里(见 PLAYKIT_SECTIONS 那条负控)。 */
  for (const section of catalog.PLAYKIT_SECTIONS) {
    const found = unfedOf(section, bound)
    if (found.missing.length) gaps[found.type] = found.missing
  }

  // 两张表合起来必须**正好**等于实测缺口:新出现一处红,修好一处忘了删也红
  const expected = {}
  for (const table of [KNOWN_UNFED, INTENTIONAL_FALLBACK]) {
    for (const type of Object.keys(table)) {
      expected[type] = (expected[type] || []).concat(table[type])
    }
  }
  for (const type of Object.keys(gaps)) gaps[type] = gaps[type].slice().sort()
  for (const type of Object.keys(expected)) expected[type] = expected[type].sort()

  assert.deepEqual(gaps, expected)
})

test('负控:给分发器多绑一个没人产出的属性,上一条必须判红', () => {
  // ★ 走上一条**同一个**采集函数,不另写一遍正则 —— 自己重写一遍的负控是恒真的
  const bound = tagsToBound(['<cy-playkit-predict wx:elif="{{kit.type === \'predict\'}}" ' +
    'close-at-hour="{{kit.closeAtHour}}" made-up="{{kit.thisFieldDoesNotExist}}" />'])
  assert.deepEqual(unfedOf('predict', bound).missing, ['thisFieldDoesNotExist'],
    '负控构造失败:多绑的属性没被判成缺失')
})

test('负控:采集函数读的是真分发器,读空了就不许放行', () => {
  const bound = boundKeysByType()
  assert.ok(Object.keys(bound).length > 15, '分发器里应认出十几个 kit 类型,认不出说明正则烂了')
  assert.ok((bound.predict || []).includes('closeAtHour'), '竞猜必须绑 closeAtHour')
})

/* ★ 第三条链路:玩法段 → **哪一屏**。
   上一条只问「还得出 kit 吗」,`steps` 一直还得出 —— 只是还错了那一屏:
   2026-09-15 实证,计步挑战照原型港好的是 walk 那屏(琥珀点阵 LCD,原型编辑页
   PK_TAB.steps = '[data-kit="walk"]'),而 TYPE_OF 指向旧的 Figma 版 'steps',
   于是玩家看到的从来不是原型那一屏,而门禁全绿。所以段↔屏要逐条钉死。 */
const SCREEN_OF = {
  qa: 'qa', branch: 'branch', estimate: 'estimate', pricePair: 'pricepair',
  sort: 'sort', match: 'match', classify: 'classify',
  hiddenObject: 'hidden', predict: 'predict', random: 'random', scan: 'scan',
  steps: 'walk',
  reaction: 'reaction', ballShake: 'ballshake', quietHold: 'quiethold',
  compass: 'compass',   // 现场感契约 §3:整屏罗盘,自成一屏
  shout: 'shout',   // 现场感契约 §4:与 quietHold 同一把尺,自成一屏
  countdown: 'countdown', stopwatch: 'stopwatch', coinFlip: 'coinflip', diceRoll: 'diceroll',
  /* 《预制人生》四个新段(2026-09 起进目录)。 */
  profile: 'profile', photoCheck: 'photocheck', note: 'note', typeIn: 'typein',
}

test('★每个玩法段还出的是**指定的那一屏** —— 还错屏不会报错,只会长得不像原型', () => {
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  assert.deepEqual(catalog.PLAYKIT_SECTIONS.slice().sort(), Object.keys(SCREEN_OF).sort(),
    '玩法目录里的段和这张表要一一对上,新增玩法必须在这儿指明用哪一屏')
  for (const section of catalog.PLAYKIT_SECTIONS) {
    const kit = pickPlayKit(
      { sessionId: 's1', version: 1, playKit: { [section]: { title: 't' } } }, at(12, 0))
    assert.equal(kit && kit.type, SCREEN_OF[section], section + ' 段还错了屏')
  }
})

/* 分发器里写了分支、组件也注册了,但没有任何一条路能让 kit.type 变成它 ——
   组件白建,谁也到不了。walk 屏此前就是这么躺着的。 */
const ORPHAN_BRANCHES = {
  // 这一屏已被 walk 取代(原型真源指向 walk),留着只为回滚方便,确认后可删
  steps: '已被 walk 屏取代,可删',
  /* 2026-09-20 清账:bingo 已接进 TYPE_OF(玩家可见);
     stickerbook / gametimer / woodfish 三个纯孤儿整族删除(审查 #7 批复)。 */
}

test('★分发器里不许有「谁也到不了」的分支 —— 组件白建,而且不报错', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.resolve(__dirname, '../..')
  const wxml = fs.readFileSync(path.join(root, 'pages/play/components/playkit/index.wxml'), 'utf8')
  const view = fs.readFileSync(path.join(root, 'pages/play/utils/playkit-view.js'), 'utf8')

  const branches = [...wxml.matchAll(/kit\.type === '([a-z]+)'/g)].map((m) => m[1])
  const typeOf = view.slice(view.indexOf('const TYPE_OF'),
    view.indexOf('};', view.indexOf('const TYPE_OF')))
  const producible = new Set([...typeOf.matchAll(/: '([a-z]+)'/g)].map((m) => m[1]))
  assert.ok(producible.size > 15, '没读出 TYPE_OF 就别放行')

  // 展示型相册由模板预览生成；故事里的正式内容走 dream 块，不开运行时会话。
  const { buildPreviewKit } = require('../../pages/publish/utils/publish/advanced-game-preview.js')
  const album = buildPreviewKit({ album: { enabled: true, images: [{ url: 'https://example.com/photo.jpg', line: '' }] } })
  assert.equal(album.type, 'album')
  producible.add(album.type)
  const orphans = branches.filter((type) => !producible.has(type)).sort()
  assert.deepEqual(orphans, Object.keys(ORPHAN_BRANCHES).sort())
})

test('负控:把 walk 从 TYPE_OF 摘掉,上一条必须把它算成孤儿', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const view = fs.readFileSync(
    path.resolve(__dirname, '../../pages/play/utils/playkit-view.js'), 'utf8')
  const typeOf = view.slice(view.indexOf('const TYPE_OF'),
    view.indexOf('};', view.indexOf('const TYPE_OF')))
  const producible = new Set([...typeOf.matchAll(/: '([a-z]+)'/g)].map((m) => m[1]))
  assert.ok(producible.has('walk'), '计步段必须还出 walk 屏')
  producible.delete('walk')
  assert.ok(!producible.has('walk'), '负控构造失败')
})

/* ★ 限时条:服务端把会话的绝对截止时刻放在 view.deadlineAt 里(advanced.timer 算出来的),
   客户端此前从没读过它 —— 于是商家开了「限时挑战」、服务端到点判负,而玩家全程看不见钟。
   这五屏都把 limitSeconds 透传给 cy-play-stage 画条、跑表、到点判负。 */
test('★开了限时:五屏都拿得到还剩多少秒', () => {
  const now = at(12, 0)
  const deadlineAt = now.getTime() + 90 * 1000
  const segments = {
    qa: { mode: 'TYPE', title: '老板姓什么' },
    branch: { step: { id: 's1', options: [] } },
    estimate: { question: '几颗豆子' },
    pricePair: { title: '哪张是对的' },
    hiddenObject: { title: '找猫' },
  }
  for (const section of Object.keys(segments)) {
    const kit = pickPlayKit(
      { sessionId: 's1', version: 1, deadlineAt: deadlineAt, playKit: { [section]: segments[section] } }, now)
    assert.equal(kit.limitSeconds, 90, section + ' 这屏的限时条拿不到秒数')
  }
})

test('没开限时就是 0,过了点也是 0 —— 不能给负数让条反着长', () => {
  const now = at(12, 0)
  const noTimer = pickPlayKit(
    { sessionId: 's1', version: 1, playKit: { qa: { mode: 'TYPE', title: 't' } } }, now)
  assert.equal(noTimer.limitSeconds, 0)

  const past = pickPlayKit(
    { sessionId: 's1', version: 1, deadlineAt: now.getTime() - 5000,
      playKit: { qa: { mode: 'TYPE', title: 't' } } }, now)
  assert.equal(past.limitSeconds, 0)
})

/* 负控:豁免名单只许有 check。有人把接不上的段丢进豁免名单,上一条门禁就对它瞎了。 */
test('负控:走 Encounter 的豁免名单只许有 check', () => {
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js')
  assert.deepEqual(catalog.ENCOUNTER_SECTIONS, ['check'],
    '豁免名单被改动了 —— 每多一段就等于对它关掉「玩法静默消失」那条门禁,要有明确理由')
  // check 走 Encounter，相册物化为已有 dream 展示块，其余段必须生成运行时 kit。
  assert.deepEqual(catalog.GAME_SECTIONS.filter(s => !catalog.PLAYKIT_SECTIONS.includes(s)).sort(), ['album', 'check'])
  assert.equal(catalog.PLAYKIT_SECTIONS.length, catalog.GAME_SECTIONS.length - 2)
})

/* 阶段 3 力竭:服务端把 'check' 从 allowedActions 摘掉,入口自然消失。
 * 但「消失了不给理由」和「灰着不给理由」一样糟 —— 这层必须把 exhausted 交出去,
 * 页面才能写一句「力竭了,先找地方休整」。三态各钉一条。 */
const { pickJourneyCheck } = require('../../pages/play/utils/playkit-view.js')

test('力竭:有检定但做不了 —— 交出带 exhausted 的壳,不是 null', () => {
  const view = pickJourneyCheck({ allowedActions: ['qa'], check: { checkId: 'c1', exhausted: true } })
  assert.ok(view, '返回 null 页面就无从解释为什么这一站的检定不见了')
  assert.equal(view.exhausted, true)
  assert.equal(view.blocked, true)
})

test('正常:可做时给完整题面,且 exhausted 明确为 false', () => {
  const view = pickJourneyCheck({
    allowedActions: ['check'],
    check: { checkId: 'c1', skill: '察言', tier: 'medium', exhausted: false },
  })
  assert.equal(view.blocked, false)
  assert.equal(view.exhausted, false, '要明确 false,别让页面区分「没力竭」和「后端没给」')
  assert.equal(view.skill, '察言')
})

test('不是力竭而拿不到 check(未到店 / 本站没检定):仍然是 null', () => {
  assert.equal(pickJourneyCheck({ allowedActions: ['qa'], check: { checkId: 'c1' } }), null,
    '没力竭又不在 allowedActions 里 = 本来就没有入口,别凭空弹一个壳')
  assert.equal(pickJourneyCheck({ allowedActions: ['check'], check: null }), null)
})
