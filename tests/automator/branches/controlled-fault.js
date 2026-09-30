'use strict'

const { trustedControlPlane, verifySignedEnvelope } = require('../../../scripts/uiaudit/trusted-attestation')

function config(fixture, branch) {
  const plane = fixture && fixture.controlPlane
  const fault = fixture && fixture.branchFaults && fixture.branchFaults[branch]
  if (!plane || !String(plane.baseUrl || '').trim() || !String(plane.scenarioId || '').trim() || !fault) {
    throw new Error(`分支 ${branch} 缺少 controlPlane 与 branchFaults 合同`)
  }
  return { plane: trustedControlPlane(fixture), fault }
}

async function request(mp, options) {
  const result = await mp.evaluate((input) => new Promise((resolve) => {
    wx.request({
      url: input.url, method: input.method, data: input.data, timeout: 10000,
      success: (response) => resolve({ statusCode: response.statusCode, data: response.data }),
      fail: (error) => resolve({ statusCode: 0, error: error && error.errMsg }),
    })
  }), options)
  if (!result || result.statusCode < 200 || result.statusCode >= 300) throw new Error('受控故障控制面调用失败')
  return result.data
}

module.exports = {
  async setup({ action, branch, fixture, mp, runNonce }) {
    const { plane, fault } = config(fixture, branch)
    const result = await request(mp, {
      url: `${plane.baseUrl.replace(/\/$/, '')}/faults/activate`, method: 'POST',
      data: { scenarioId: plane.scenarioId, fixtureId: fixture.id, actionId: action.id, branch, fault, runNonce },
    })
    const payload = verifySignedEnvelope(result, {
      kind: 'fault-activated', scenarioId: plane.scenarioId, fixtureId: fixture.id,
      actionId: action.id, branch, runNonce,
    })
    if (payload.facts.active !== true) throw new Error('受控故障未激活')
  },

  async verify({ action, branch, fixture, mp, authority, runNonce }) {
    const { plane } = config(fixture, branch)
    const result = await request(mp, {
      url: `${plane.baseUrl.replace(/\/$/, '')}/faults/status`, method: 'POST',
      data: { scenarioId: plane.scenarioId, fixtureId: fixture.id, actionId: action.id, branch, runNonce },
    })
    const payload = verifySignedEnvelope(result, {
      kind: 'fault-status', scenarioId: plane.scenarioId, fixtureId: fixture.id,
      actionId: action.id, branch, runNonce,
    })
    return {
      actionId: action.id,
      branch,
      fixtureId: fixture.id,
      assertions: payload.facts.assertions,
      observed: payload.facts.observed,
      authoritativeReadback: authority,
      controlPlaneAttestation: result,
    }
  },

  async teardown({ action, branch, fixture, mp, runNonce }) {
    const { plane } = config(fixture, branch)
    const result = await request(mp, {
      url: `${plane.baseUrl.replace(/\/$/, '')}/faults/deactivate`, method: 'POST',
      data: { scenarioId: plane.scenarioId, fixtureId: fixture.id, actionId: action.id, branch, runNonce },
    })
    const payload = verifySignedEnvelope(result, {
      kind: 'fault-deactivated', scenarioId: plane.scenarioId, fixtureId: fixture.id,
      actionId: action.id, branch, runNonce,
    })
    if (payload.facts.active !== false) throw new Error('受控故障未解除')
  },
}
