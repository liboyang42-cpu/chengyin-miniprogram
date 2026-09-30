'use strict'

const { trustedControlPlane, verifySignedEnvelope } = require('../../../scripts/uiaudit/trusted-attestation')

function controlPlane(fixture) {
  return trustedControlPlane(fixture)
}

async function request(mp, options) {
  const result = await mp.evaluate((input) => new Promise((resolve) => {
    wx.request({
      url: input.url,
      method: input.method,
      data: input.data,
      timeout: 10000,
      success: (response) => resolve({ statusCode: response.statusCode, data: response.data }),
      fail: (error) => resolve({ statusCode: 0, error: error && error.errMsg }),
    })
  }), options)
  if (!result || result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`受控后端调用失败: ${result && (result.error || result.statusCode)}`)
  }
  return result.data
}

module.exports = {
  async setup({ action, branch, fixture, mp, runNonce }) {
    const plane = controlPlane(fixture)
    const result = await request(mp, {
      url: `${plane.baseUrl.replace(/\/$/, '')}/fixtures/activate`,
      method: 'POST',
      data: { fixtureId: fixture.id, scenarioId: plane.scenarioId, actionId: action.id, branch, runNonce },
    })
    const payload = verifySignedEnvelope(result, {
      kind: 'fixture-activated', fixtureId: fixture.id, scenarioId: plane.scenarioId,
      actionId: action.id, branch, runNonce,
    })
    if (payload.facts.activated !== true) throw new Error('受控后端未回读 fixture activated=true')
  },

  async verifyIdentity({ action, branch, fixture, mp, runNonce }) {
    const plane = controlPlane(fixture)
    const result = await request(mp, {
      url: `${plane.baseUrl.replace(/\/$/, '')}/fixtures/identity`,
      method: 'POST',
      data: { fixtureId: fixture.id, scenarioId: plane.scenarioId, actionId: action.id, branch, runNonce },
    })
    const payload = verifySignedEnvelope(result, {
      kind: 'fixture-identity', fixtureId: fixture.id, scenarioId: plane.scenarioId,
      actionId: action.id, branch, runNonce,
    })
    const facts = payload.facts
    return {
      fixtureId: fixture.id,
      synthetic: facts.synthetic === true,
      accountRole: facts.accountRole,
      identityFingerprint: facts.identityFingerprint,
      backendBase: facts.backendBase,
      backendDeploymentSha: facts.backendDeploymentSha,
      assertions: Array.isArray(facts.assertions) ? facts.assertions : [],
      controlPlaneAttestation: result,
    }
  },
}
