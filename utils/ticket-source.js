'use strict'

// 批5 · 3-5 票源归因(裁决表 E2)前端链路:俱乐部分享 → 玩家落地捕获 → 建单透传。
//
// ★这一层为什么必须存在:后端从 RegistrationRequest.sourceClubId 到
//   CmsRegistrationMapper.freezeTicketSourceOnPayment 的冻结闸全都齐了,但**没有任何客户端路径
//   把标记送进建单请求** ⇒ 生产上每张票的 source_club_id 恒 NULL ⇒ 归因永远落平台 ⇒
//   A4/E2 给俱乐部的三段报酬里的「票源奖励 10%」恒为 0,且零告警(后端所有闸都只防
//   「支付后改归因」,不防「从来没归因过」)。
//
// ★这一层不是防线:标记的真伪由后端在支付成功那一刻判 ——
//   freezeTicketSourceOnPayment 要求标记同时满足「支付时刻仍在本期售票窗内」与
//   「等于该期活动/主题现有的 club_id」,否则冻结为平台(NULL)。
//   所以这里的职责只有一句:**把真的标记带过去,不编造不存在的标记。**
//
// fail-closed 规则(每条都有负控,见 tests/unit/tandianri-b5-ticket-source.test.js):
//   ① 缺 topicId 或 sourceClubId 非正整数 ⇒ 不落归因(归平台),不得由 clubCode 反推俱乐部;
//   ② clubCode 超过后端 @Size(64) 上界 ⇒ 整条丢弃,不截断成半个码;
//   ③ 建单时 topicId 与捕获时不一致 ⇒ 不带标记(归因不跨期复用,E2「有效期 = 本期售票窗」);
//   ④ 同一期出现两家不同俱乐部的标记 ⇒ 不仲裁、整条归平台。
//      E2 明写「互斥规则推迟到第二家俱乐部真的出现时再定」—— 未裁决的事不许由前端随手挑一家,
//      宁可明确没有,不要假装有。

const STORAGE_KEY = 'cy_ticket_source'
const MAX_CODE_LEN = 64 // 与 RegistrationRequest.sourceChannelCode 的 @Size(max = 64) 对齐

function toPositiveLong(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!/^\d{1,18}$/.test(text)) return null
  const num = Number(text)
  return num > 0 ? num : null
}

function normalizeCode(value) {
  if (value === null || value === undefined) return { ok: true, code: null }
  const text = String(value).trim()
  if (!text) return { ok: true, code: null }
  if (text.length > MAX_CODE_LEN) return { ok: false, code: null }
  return { ok: true, code: text }
}

function readRecord() {
  let raw = ''
  try { raw = wx.getStorageSync(STORAGE_KEY) } catch (e) { return null }
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch (e) {
    // 坏 JSON 只可能是被人手改过或版本漂移 —— 当作无归因,不猜。
    return null
  }
}

function writeRecord(record) {
  try { wx.setStorageSync(STORAGE_KEY, JSON.stringify(record)) } catch (e) { /* 存不下就等于没归因 */ }
}

function dropRecord() {
  try { wx.removeStorageSync(STORAGE_KEY) } catch (e) { /* ignore */ }
}

/**
 * 从落地页的启动参数里捕获票源标记。
 * @param {object} query 小程序 onLaunch/onShow 的 query 或页面 options
 * @returns {{captured: boolean, reason?: string}}
 */
function captureFromQuery(query) {
  const q = query || {}
  const topicId = toPositiveLong(q.topicId !== undefined && q.topicId !== null && q.topicId !== ''
    ? q.topicId : q.id)
  if (!topicId) return { captured: false, reason: 'NO_TOPIC' }

  const clubId = toPositiveLong(q.sourceClubId)
  const codeResult = normalizeCode(q.clubCode !== undefined && q.clubCode !== null && q.clubCode !== ''
    ? q.clubCode : q.sourceChannelCode)
  if (!codeResult.ok) return { captured: false, reason: 'BAD_CODE' }
  // clubId 与 code 全空 = 这就不是一条带归因的分享,不写空记录去覆盖已有归因。
  if (!clubId && !codeResult.code) {
    return { captured: false, reason: q.sourceClubId === undefined ? 'NO_MARK' : 'BAD_CLUB' }
  }
  if (q.sourceClubId !== undefined && q.sourceClubId !== null && q.sourceClubId !== '' && !clubId) {
    return { captured: false, reason: 'BAD_CLUB' }
  }

  const existing = readRecord()
  if (existing && Number(existing.topicId) === topicId && existing.conflicted === true) {
    // 冲突是一期内不可逆的事实：后续重复 onShow 不能把刚删除的归因重新写回来。
    return { captured: false, reason: 'CONFLICT' }
  }
  const sameTopic = existing && Number(existing.topicId) === topicId
  const existingClubId = sameTopic ? toPositiveLong(existing.sourceClubId) : null
  const existingCodeResult = normalizeCode(sameTopic ? existing.sourceChannelCode : null)
  if (sameTopic && existingClubId && !clubId && codeResult.code) {
    // code-only 事实无法识别另一家俱乐部，也不能推翻已经明确的合法归因。
    return { captured: false, reason: 'NO_MARK' }
  }
  const codeOnlyUpgradeConflict = sameTopic && !existingClubId && !!clubId
    && !!existing.sourceChannelCode
    && (!existingCodeResult.ok || existingCodeResult.code !== codeResult.code)
  if (sameTopic && ((existing.sourceClubId && clubId && Number(existing.sourceClubId) !== clubId)
      || codeOnlyUpgradeConflict)) {
    // ④ 同期来源事实互相冲突 —— 不静默升级或仲裁,持久化冲突墓碑并归平台。
    // onLaunch/onShow 可能重复传入相同 scene；不能删除后让第三次捕获的一家重新获胜。
    writeRecord({
      topicId: topicId,
      sourceClubId: null,
      sourceChannelCode: null,
      capturedAt: null,
      conflicted: true,
    })
    return { captured: false, reason: 'CONFLICT' }
  }

  writeRecord({
    topicId: topicId,
    sourceClubId: clubId || null,
    sourceChannelCode: codeResult.code,
    capturedAt: null, // 时间窗由服务端在冻结时判,客户端不自造过期口径
  })
  return { captured: true }
}

/**
 * 建单请求要合并的归因字段。无归因返回空对象 —— 调用方直接 Object.assign 即可,
 * 不会往请求体里塞 null(后端把「字段缺失」和「显式 null」都当无标记,但少塞一个字段更干净)。
 * @param {number|string} topicId 本次下单所属的期(cms_activity.topicId)
 */
function attributionPayload(topicId) {
  const wanted = toPositiveLong(topicId)
  if (!wanted) return {}
  const record = readRecord()
  if (!record || Number(record.topicId) !== wanted) return {}
  if (record.conflicted === true) return {}
  const payload = {}
  const clubId = toPositiveLong(record.sourceClubId)
  if (clubId) payload.sourceClubId = clubId
  const code = normalizeCode(record.sourceChannelCode)
  if (code.ok && code.code) payload.sourceChannelCode = code.code
  return payload
}

/** 分享路径拼归因参数;没有真实 clubId 就不拼,绝不产出一个假标记。 */
function buildSharePath(basePath, options) {
  const opts = options || {}
  const topicId = toPositiveLong(opts.topicId)
  if (!topicId) return basePath
  let path = basePath + '?id=' + topicId
  const clubId = toPositiveLong(opts.clubId)
  if (clubId) path += '&sourceClubId=' + clubId
  const code = normalizeCode(opts.clubCode)
  if (clubId && code.ok && code.code) path += '&clubCode=' + encodeURIComponent(code.code)
  return path
}

module.exports = {
  STORAGE_KEY,
  MAX_CODE_LEN,
  captureFromQuery,
  attributionPayload,
  buildSharePath,
  clearAttribution: dropRecord,
}
