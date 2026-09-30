// 批5 · 3-5 票源归因前端链路(玩家 ∩ 俱乐部角色)的行为契约 + 负控。
//
// 真源:裁决表 E2「票上有俱乐部归因标记 → 归俱乐部结 G_earned × 10%;无标记 → 归平台不结奖励。
//       有效期 = 本期售票窗内;首三期不做 last/first touch」
//       开工计划 3-5 · 审计 2 P1-1「支付成功冻结、每票单一归因」
//
// 后端已具备(不在本文件断言范围):CmsRegistrationMapper.freezeTicketSourceOnPayment 在支付成功
// 那一刻把标记与该期活动/主题的 club_id、售票窗对齐,不满足即冻结为平台(NULL)。
// ⇒ 本层只负责「把真的标记带过去、不编造不存在的标记」,负控要能抓住「编造」。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const MODULE = '../../utils/ticket-source.js'

let store

global.wx = {
  getStorageSync: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : ''),
  setStorageSync: (key, value) => { store[key] = value },
  removeStorageSync: (key) => { delete store[key] },
}

function load() {
  delete require.cache[require.resolve(MODULE)]
  return require(MODULE)
}

beforeEach(() => { store = {} })

// ---------- 捕获 ----------

test('分享落地带 topicId + sourceClubId + clubCode ⇒ 捕获成功', () => {
  const ts = load()
  const res = ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'CLUB7-XHS' })
  assert.equal(res.captured, true)
  assert.deepEqual(ts.attributionPayload(77), { sourceClubId: 7, sourceChannelCode: 'CLUB7-XHS' })
})

test('topicId 参数名可以是 id / topicId 任一(分享路径两种写法都在用)', () => {
  const ts = load()
  assert.equal(ts.captureFromQuery({ topicId: '77', sourceClubId: '7' }).captured, true)
  assert.deepEqual(ts.attributionPayload(77), { sourceClubId: 7 })
})

test('negative control:没有 topicId ⇒ 不捕获,归平台', () => {
  const ts = load()
  const res = ts.captureFromQuery({ sourceClubId: '7', clubCode: 'X' })
  assert.equal(res.captured, false)
  assert.equal(res.reason, 'NO_TOPIC')
  assert.deepEqual(ts.attributionPayload(77), {})
})

test('negative control:非法 deep-link 的 sourceClubId(0/负数/非数字/超长)一律丢弃,不得当成有效归因', () => {
  const ts = load();
  ['0', '-1', 'abc', '7; drop', '1e9999', '', '   '].forEach((bad) => {
    store = {}
    const res = ts.captureFromQuery({ id: '77', sourceClubId: bad })
    assert.equal(res.captured, false, 'sourceClubId=' + JSON.stringify(bad) + ' 必须被拒')
    assert.deepEqual(ts.attributionPayload(77), {}, 'sourceClubId=' + JSON.stringify(bad) + ' 不得留下归因')
  })
})

test('只有 clubCode、没有 sourceClubId ⇒ 只留审计码,归因仍是平台(不得由码反推俱乐部)', () => {
  const ts = load()
  const res = ts.captureFromQuery({ id: '77', clubCode: 'POSTER-A' })
  assert.equal(res.captured, true)
  const payload = ts.attributionPayload(77)
  assert.deepEqual(payload, { sourceChannelCode: 'POSTER-A' })
  assert.equal('sourceClubId' in payload, false, '无 club 事实时不得凭空造出 sourceClubId')
})

test('negative control:clubCode 超过 64 字符(后端 @Size 上界)⇒ 整条丢弃,不截断成半个码', () => {
  const ts = load()
  const res = ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'C'.repeat(65) })
  assert.equal(res.captured, false)
  assert.equal(res.reason, 'BAD_CODE')
  assert.deepEqual(ts.attributionPayload(77), {})
})

// ---------- 跨期 / 冲突 ----------

test('negative control:归因不得跨期复用 —— 捕获的是 77 期,买 88 期时不带标记', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', sourceClubId: '7' })
  assert.deepEqual(ts.attributionPayload(88), {})
  assert.deepEqual(ts.attributionPayload(77), { sourceClubId: 7 })
})

test('同一期同一俱乐部重复落地 ⇒ 幂等,仍是一条归因', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'A' })
  ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'A' })
  assert.deepEqual(ts.attributionPayload(77), { sourceClubId: 7, sourceChannelCode: 'A' })
})

test('negative control:同一期出现两家不同俱乐部的标记 ⇒ 不仲裁,整条归平台(E2 未裁决互斥规则)', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'A' })
  const second = ts.captureFromQuery({ id: '77', sourceClubId: '8', clubCode: 'B' })
  assert.equal(second.captured, false)
  assert.equal(second.reason, 'CONFLICT')
  assert.deepEqual(ts.attributionPayload(77), {}, '冲突时既不许挑一家,也不许留下半个审计码')
})

test('negative control:冲突墓碑必须持久化,第三次捕获不能让任一家赢回来', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'A' })
  ts.captureFromQuery({ id: '77', sourceClubId: '8', clubCode: 'B' })

  const third = ts.captureFromQuery({ id: '77', sourceClubId: '8', clubCode: 'B' })

  assert.equal(third.captured, false)
  assert.equal(third.reason, 'CONFLICT')
  assert.deepEqual(ts.attributionPayload(77), {}, '冲突后重复点任一家链接都只能归平台')
})

test('已有俱乐部归因后再遇 code-only 链接 ⇒ NO_MARK 保留既有事实', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'CLUB7-A' })

  const second = ts.captureFromQuery({ id: '77', clubCode: 'UNKNOWN-B' })

  assert.equal(second.captured, false)
  assert.equal(second.reason, 'NO_MARK')
  assert.deepEqual(ts.attributionPayload(77), { sourceClubId: 7, sourceChannelCode: 'CLUB7-A' },
    'code-only 事实不能推翻已经明确的俱乐部归因')
})

test('同 code 的 code-only 重复落地也只 NO_MARK,不得毁掉合法归因', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'CLUB7-A' })

  const second = ts.captureFromQuery({ id: '77', clubCode: 'CLUB7-A' })

  assert.deepEqual(second, { captured: false, reason: 'NO_MARK' })
  assert.deepEqual(ts.attributionPayload(77), { sourceClubId: 7, sourceChannelCode: 'CLUB7-A' })
})

test('code-only 平台记录可由同 code 的带 clubId 链接补全', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', clubCode: 'POSTER-A' })

  const second = ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'POSTER-A' })

  assert.equal(second.captured, true)
  assert.deepEqual(ts.attributionPayload(77), { sourceClubId: 7, sourceChannelCode: 'POSTER-A' })
})

test('negative control:code-only 平台记录后出现不同 code 的 clubId 链接 ⇒ 对称冲突', () => {
  const ts = load()
  ts.captureFromQuery({ id: '77', clubCode: 'POSTER-A' })

  const second = ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'POSTER-B' })
  const third = ts.captureFromQuery({ id: '77', sourceClubId: '7', clubCode: 'POSTER-A' })

  assert.equal(second.captured, false)
  assert.equal(second.reason, 'CONFLICT')
  assert.equal(third.reason, 'CONFLICT', '不一致升级必须留下不可逆墓碑')
  assert.deepEqual(ts.attributionPayload(77), {})
})

// ---------- 分享路径 ----------

test('俱乐部分享路径带上本期归因参数', () => {
  const ts = load()
  assert.equal(
    ts.buildSharePath('/pages/topic/index/index', { topicId: 77, clubId: 7, clubCode: 'CLUB7-XHS' }),
    '/pages/topic/index/index?id=77&sourceClubId=7&clubCode=CLUB7-XHS'
  )
})

test('negative control:缺 clubId 的分享路径不得伪造归因参数', () => {
  const ts = load()
  assert.equal(ts.buildSharePath('/pages/topic/index/index', { topicId: 77 }),
    '/pages/topic/index/index?id=77')
  assert.equal(ts.buildSharePath('/pages/topic/index/index', { topicId: 77, clubId: 0 }),
    '/pages/topic/index/index?id=77')
})

test('clubCode 做 URL 编码,避免 & 把参数串拆坏', () => {
  const ts = load()
  const path = ts.buildSharePath('/pages/topic/index/index', { topicId: 77, clubId: 7, clubCode: 'a&b=c' })
  assert.equal(path, '/pages/topic/index/index?id=77&sourceClubId=7&clubCode=a%26b%3Dc')
})

// ---------- 存储损坏 ----------

test('negative control:storage 里是坏 JSON ⇒ 当作无归因,不抛错不猜', () => {
  const ts = load()
  store[ts.STORAGE_KEY] = '{not json'
  assert.deepEqual(ts.attributionPayload(77), {})
})

test('negative control:storage 被手改成别的 clubId 但 topicId 不匹配 ⇒ 仍不带标记', () => {
  const ts = load()
  store[ts.STORAGE_KEY] = JSON.stringify({ topicId: 99, sourceClubId: 7 })
  assert.deepEqual(ts.attributionPayload(77), {})
})
