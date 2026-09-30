/* 商家配置 → 预览 kit(原型真源:模板编辑页 v2 的 applyUserCfg)
 *
 * 这一层守的是一条产品硬规则:**预览必须按商家真实配置跑**。
 * 坏起来的样子很温和 —— 预览照常演一屏内置 demo,商家改一个字看不出变化,
 * 而他会以为自己配好了。没有断言的话没人会发现。
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
const pv = require('../../pages/publish/utils/publish/advanced-game-preview.js')

const base = () => cfg.defaultConfig()

test('一个都没开就返回 null —— 调用方据此回落到基础验证那套,而不是画一屏空的', () => {
  assert.equal(pv.buildPreviewKit(base()), null)
  assert.equal(pv.hasPreviewKit(base()), false)
  assert.equal(pv.buildPreviewKit(null), null, '配置读不出来时也不能抛')
})

test('★商家填什么就演什么 —— 标题、六个面全部原样带过去', () => {
  const c = base()
  c.diceRoll = { enabled: true, kicker: '掷到几就做第几件事', diceCount: 1,
    faces: ['跟店员说天气', '挪一下花', '读一段菜单', '找最旧的东西', '换个座位', '替下一位点一杯'] }
  const kit = pv.buildPreviewKit(c)
  assert.equal(kit.type, 'diceroll')
  assert.equal(kit.kicker, '掷到几就做第几件事')
  assert.deepEqual(kit.faces[0], '跟店员说天气')
  assert.deepEqual(kit.values, [5], '一颗只演一个点数')
})

test('两颗那一档演点数和,不拿和去索引六个面 —— 那会越界', () => {
  const c = base()
  c.diceRoll = { enabled: true, diceCount: 2, faces: ['a', 'b', 'c', 'd', 'e', 'f'] }
  assert.deepEqual(pv.buildPreviewKit(c).values, [5, 4])
})

test('★结果固定,不随机 —— 随机的话商家每次点开看到的不一样,没法核对文案', () => {
  const c = base()
  c.coinFlip = { enabled: true, heads: { label: '正面', action: '这杯店家请' }, tails: { label: '反面', action: '这杯你请' } }
  const a = pv.buildPreviewKit(c)
  const b = pv.buildPreviewKit(c)
  assert.equal(a.face, b.face)
  assert.equal(a.headsAction, '这杯店家请')
})

test('★找东西的预览也不带坐标 —— 与玩家侧同一条规矩,坐标是这玩法唯一的防线', () => {
  const c = base()
  c.hiddenObject = { enabled: true, title: '找猫', imageUrl: 'https://cdn/scene.png',
    hotspots: [{ id: 's1', label: '窗台上的', x: 0.2, y: 0.3, r: 0.08 }] }
  const kit = pv.buildPreviewKit(c)
  assert.equal(kit.targets[0].label, '窗台上的', '待找清单要带,玩家得知道自己在找什么')
  /* ⚠️ 按**键**断言,别拿正则去搜整段 JSON:第一版写的是 /"x"|"y"|"r"/,
     而夹具里 imageUrl 的**值**恰好是 'x',于是这条恒红 —— 假阳性比漏检更费时间。 */
  assert.deepEqual(Object.keys(kit.targets[0]).sort(), ['id', 'label'],
    '热区只能带 id 和 label,坐标一个都不能进 kit')
})

test('商家没填的地方留空,不拿内置示例顶上去', () => {
  const c = base()
  c.quietHold = { enabled: true, seconds: 15, kicker: '', sub: '' }
  const kit = pv.buildPreviewKit(c)
  assert.equal(kit.sub, '', '没填就是没有 —— 顶个示例上去等于「预览没理我」')
  assert.equal(kit.kicker, '别出声', '标题空着回落到玩法自己的默认名,那是这一屏的身份不是内容')
})

test('通用限时叠加到玩法上;玩法自己带了就不覆盖', () => {
  const c = base()
  c.estimate = { enabled: true, title: '这棵树多少岁' }
  assert.equal(pv.buildPreviewKit(c, { limitSeconds: 30 }).limitSeconds, 30)
  assert.equal(pv.buildPreviewKit(c).limitSeconds, 0, '没开限时就不带')
})

test('★优先级稳定:同时开两段时演哪一屏必须是确定的', () => {
  const c = base()
  c.countdown = { enabled: true, seconds: 90, doneText: '时间到。' }
  c.estimate = { enabled: true, title: '这棵树多少岁' }
  // estimate 在 PREVIEW_PRIORITY 里靠前 —— 要玩家动手的先演
  assert.equal(pv.buildPreviewKit(c).type, 'estimate')
  assert.ok(pv.PREVIEW_PRIORITY.indexOf('estimate') < pv.PREVIEW_PRIORITY.indexOf('countdown'))
})

test('★每个转换器产出的 type 都要在分发器白名单里,否则预览一片空白且不报错', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const dispatcher = fs.readFileSync(
    path.resolve(__dirname, '../../pages/play/components/playkit/index.js'), 'utf8')
  const listed = (dispatcher.match(/const KIT_TYPES = \[([\s\S]*?)\];/) || [])[1] || ''
  const known = new Set([...listed.matchAll(/'([^']+)'/g)].map((m) => m[1]))
  const c = base()
  for (const key of Object.keys(pv._builders)) {
    const kit = pv._builders[key](key === 'album' ? {images: [{url: 'https://example.com/a.jpg'}]} : {})
    assert.ok(known.has(kit.type),
      key + ' 产出的 type=' + kit.type + ' 不在 cy-playkit 的 KIT_TYPES 里')
  }
})

/* 2026-09-15:竞猜的截止小时曾在这里被写死成 closeMode:'HOUR' —— 预览于是恒定说
   「由商家随时结算」,商家改了截止点也看不出来;而玩家侧要的是 closeAtHour,
   没人产出 closeMode,那句话在真机上一个字都不出。两头都错,方向还相反。 */
test('★竞猜:预览的截止小时来自商家真填的那个,不是写死的', () => {
  const model = base()
  model.predict.enabled = true
  model.predict.question = '明天哪款卖得更多?'
  model.predict.closeAtHour = 9
  model.predict.options = [{ key: 'A', label: '手冲' }, { key: 'B', label: '拿铁' }]

  const kit = pv.buildPreviewKit(model)

  assert.equal(kit.type, 'predict')
  assert.equal(kit.closeAtHour, 9, '预览必须拿商家真配的截止点')
  assert.ok(!('closeMode' in kit), 'closeMode 全链路没人产出,预览不能自己造一个')
  assert.ok(!('closeDays' in kit), 'closeDays 同上')
})

/* 2026-09-24 模拟器实拍:拍照段(含拍物成卡)没有预览构造器,编辑页「查看预览」在点位任务那一步
   回落成「本点位无需验证,点按钮打卡」—— 商家以为这一步不用拍照。 */
test('★拍照段有预览:拍物成卡演新的一屏,普通拍照审核演原来那一屏,都标成预览', () => {
  const card = pv.buildPreviewKit({ photoCheck: { enabled: true, mode: 'CARD', title: '捡一件东西', shotNote: '放在桌上拍', cardTitle: '一枚旧弹壳', maxTries: 3 } })
  assert.ok(card, '拍照段开着却没有预览 kit')
  assert.equal(card.type, 'photocheck')
  assert.equal(card.mode, 'CARD')
  assert.equal(card.title, '捡一件东西')
  assert.equal(card.preview, true, '预览里按快门不能真的拍、真的等判定')
  assert.equal(card.card, null)
  assert.equal(card.passed, false)

  const plain = pv.buildPreviewKit({ photoCheck: { enabled: true, title: '拍一张窗外' } })
  assert.equal(plain.type, 'photocheck')
  assert.equal(plain.mode, '')
})
