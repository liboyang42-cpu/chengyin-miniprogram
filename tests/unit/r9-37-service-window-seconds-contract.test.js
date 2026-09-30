// R9-37(P1):服务端可接待,商家端因时间秒数判不可接待。
//
// 审查复现(第九轮 R9-37):场次 START 成功、站点 ACTIVE、API 返回 playable=true,
// 但 utils/game-session-merchant.js 的 validDateTime 只接受 'YYYY-MM-DD HH:mm',
// 而真实服务端返回 'YYYY-MM-DD HH:mm:ss';normalizeStation 的 stationConfigured
// 因此为 false,playable 变 false,「出示打卡码」入口消失。
//
// 契约:服务端两种格式都要接受(带/不带秒),非法日期(越界时分、不存在日期、
// 错分隔符)仍必须拒绝;start 与 end 混用两种格式也要能比大小。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeMerchantProjection,
  buildStationReadyCommand,
  sanitizeMerchantCommandForRetry,
} = require('../../pages/merchant/utils/game-session-merchant.js')

// 与 local-r7-r9-game-running-readback.json 同形:playable=true、ACTIVE、容量 2。
function merchantView(serviceStartAt, serviceEndAt) {
  return {
    sessionId: 28,
    activityId: 88,
    perspective: 'MERCHANT',
    status: 'RUNNING',
    revision: 7,
    availableActions: ['STATION_READY', 'STATION_PAUSE', 'STATION_RESUME', 'VERIFY_SUBMISSION'],
    merchant: {
      fallbackOptions: [],
      stations: [{
        stationId: 1,
        nodeId: 159,
        nodeName: '老码头补给站',
        stationCode: 'STATION-159',
        status: 'ACTIVE',
        revision: 7,
        preparationChecklist: [
          { code: 'STAFF', label: '工作人员已到位', checked: true },
          { code: 'PROP', label: '任务道具已备齐', checked: true },
        ],
        playerTask: {
          taskCode: 'DOCK_CODE', prompt: '扫描柜台上的本站任务码', inputType: 'SCAN',
          verificationRequired: true,
        },
        merchantInstruction: '只核对玩家出示的编号与现场任务完成情况',
        hiddenInfoReminder: '不要透露其他角色线索或后台答案',
        capacity: 2,
        serviceStartAt,
        serviceEndAt,
        pendingVerificationCount: 0,
        playable: true,
      }],
    },
  }
}

test('RED 锚点:服务端返回带秒时间时,商家端必须仍判本站可接待', () => {
  const projection = normalizeMerchantProjection(merchantView('2026-09-13 20:00:00', '2026-09-13 22:00:00'))
  assert.equal(projection.enabled, true)
  assert.equal(projection.stations[0].playable, true, 'HH:mm:ss 是服务端真实格式,不得判成不可接待')
})

test('无秒与带秒混用也要能比较先后(兼容窗口期)', () => {
  const projection = normalizeMerchantProjection(merchantView('2026-09-13 20:00', '2026-09-13 22:00:00'))
  assert.equal(projection.stations[0].playable, true)
})

test('合法日期两种格式都要通过;非法日期必须继续判不可接待', () => {
  const valid = [
    ['2026-09-13 00:00', '2026-09-13 23:59'],
    ['2026-09-13 00:00:00', '2026-09-13 23:59:59'],
    ['2026-02-28 10:30:00', '2026-03-01 10:30'],
  ]
  for (const [start, end] of valid) {
    assert.equal(normalizeMerchantProjection(merchantView(start, end)).stations[0].playable, true, `${start} → ${end} 必须可接待`)
  }

  const invalid = [
    ['2026-09-13 24:00:00', '2026-09-14 02:00:00'],
    ['2026-09-13 20:00:60', '2026-09-13 22:00:00'],
    ['2026-02-30 10:00:00', '2026-02-30 12:00:00'],
    ['2026-9-13 20:00:00', '2026-9-13 22:00:00'],
    ['2026-09-13T20:00:00', '2026-09-13T22:00:00'],
    ['2026-09-13 22:00:00', '2026-09-13 20:00:00'],
  ]
  for (const [start, end] of invalid) {
    assert.equal(normalizeMerchantProjection(merchantView(start, end)).stations[0].playable, false, `${start} → ${end} 必须拒绝`)
  }
})

test('准备命令与重试恢复同样接受带秒时间,非法时间仍拒绝', () => {
  const projection = normalizeMerchantProjection(merchantView('2026-09-13 20:00:00', '2026-09-13 22:00:00'))
  const station = projection.stations[0]
  station.canReady = true
  const draft = {
    checklist: [{ code: 'STAFF', checked: true }, { code: 'PROP', checked: true }],
    capacity: 2,
    serviceStartAt: '2026-09-13 19:30:00',
    serviceEndAt: '2026-09-13 22:30:00',
  }
  const command = buildStationReadyCommand(projection, station, draft, 'merchant_ready_88_159')
  assert.equal(command.payload.serviceStartAt, '2026-09-13 19:30:00')
  assert.throws(() => buildStationReadyCommand(projection, station, Object.assign({}, draft, {
    serviceStartAt: '2026-09-13 25:30:00',
  }), 'merchant_ready_88_159'), /STATION_READY_INPUT_INVALID/)

  const retried = sanitizeMerchantCommandForRetry(command)
  assert.equal(retried && retried.payload.serviceStartAt, '2026-09-13 19:30:00')
  assert.equal(sanitizeMerchantCommandForRetry(Object.assign({}, command, {
    payload: Object.assign({}, command.payload, { serviceEndAt: '2026-09-13 19:30' }),
  })), null, '结束不晚于开始仍必须拒绝')
})
