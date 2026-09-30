/* R9-38 俱乐部导演台暂停本站:备用方案选填(与后端 clubStationPause / resolvePauseFallback 对齐)。
 * 0 个已批准方案 → 确认后不带方案暂停;1 个 → 照旧带上;多个 → 不替主理人挑,提示去后台指定。
 * 负控:把 director.js 的暂停分支改回「plans.length !== 1 就 toast 返回」,第一条用例必红。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const DIRECTOR_PATH = path.resolve(__dirname, '../../pages/club/topic-detail/director.js')

function setup(planOptions) {
  const calls = { modal: null, toasts: [], actions: [] }
  global.wx = {
    showModal(value) { calls.modal = value },
    showToast(value) { calls.toasts.push(value) },
  }
  delete require.cache[DIRECTOR_PATH]
  const { DIRECTOR_METHODS } = require(DIRECTOR_PATH)
  const ctx = {
    data: {
      writeLocked: false,
      // id = 组件/onIncidentSelect 实际写入 incidentSelectedKey 的那个键(见 5-01 行投影)
      incidentRows: [{ id: 'backlog:8', key: 'backlog:8', kind: 'BACKLOG', nodeId: 8, planOptions }],
      incidentSelectedKey: 'backlog:8',
      incidentMode: 'pause',
    },
    setData(patch) { Object.assign(this.data, patch) },
    executeAction(action, payload, nodeId) { calls.actions.push({ action, payload, nodeId }) },
  }
  DIRECTOR_METHODS.submitIncident.call(ctx)
  return calls
}

test('没有已批准备用方案也能暂停本站:确认后提交,payload 不带方案字段', () => {
  const calls = setup([])
  assert.ok(calls.modal, '必须先弹确认,不能直接 toast 拦下')
  assert.match(calls.modal.content, /不会被引导到其他站点/)
  calls.modal.success({ confirm: false })
  assert.equal(calls.actions.length, 0, '取消不得提交')
  calls.modal.success({ confirm: true, content: '人手不够' })
  assert.equal(calls.actions.length, 1)
  assert.equal(calls.actions[0].action, 'CLUB_STATION_PAUSE')
  assert.equal(calls.actions[0].nodeId, 8)
  assert.equal(calls.actions[0].payload.reason, '人手不够')
  assert.equal('fallbackPlanCode' in calls.actions[0].payload, false)
  assert.equal('fallbackPlanVersion' in calls.actions[0].payload, false)
})

test('恰好一个已批准方案:照旧带上方案', () => {
  const calls = setup([{ planCode: 'DOCK_TO_CLOCK', version: 2 }])
  calls.modal.success({ confirm: true, content: '人手不够' })
  assert.equal(calls.actions[0].payload.fallbackPlanCode, 'DOCK_TO_CLOCK')
  assert.equal(calls.actions[0].payload.fallbackPlanVersion, 2)
})

test('多个方案:不替主理人挑也不丢方案,提示去后台指定', () => {
  const calls = setup([{ planCode: 'A_PLAN', version: 1 }, { planCode: 'B_PLAN', version: 1 }])
  assert.equal(calls.modal, null)
  assert.equal(calls.actions.length, 0)
  assert.equal(calls.toasts.length, 1)
})
