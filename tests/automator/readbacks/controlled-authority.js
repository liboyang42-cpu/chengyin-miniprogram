'use strict'

const { trustedControlPlane, verifySignedEnvelope } = require('../../../scripts/uiaudit/trusted-attestation')

module.exports = {
  async capture({ action, branch, fixture, expectation, phase, mp, runNonce, requestIndex }) {
    const plane = trustedControlPlane(fixture)
    if (!expectation || !expectation.request) {
      throw new Error('controlled-authority 需要 fixture.controlPlane 与 ACTION_EXPECT_JSON.request')
    }
    const result = await mp.evaluate((input) => new Promise((resolve) => {
      wx.request({
        url: `${input.baseUrl.replace(/\/$/, '')}/authority/read`,
        method: 'POST',
        data: input.payload,
        timeout: 10000,
        success: (response) => resolve({ statusCode: response.statusCode, data: response.data }),
        fail: (error) => resolve({ statusCode: 0, error: error && error.errMsg }),
      })
    }), {
      baseUrl: plane.baseUrl,
      payload: {
        scenarioId: plane.scenarioId, fixtureId: fixture.id, actionId: action.id,
        branch, phase, requestIndex, expectedRequest: expectation.request, runNonce,
      },
    })
    if (!result || result.statusCode < 200 || result.statusCode >= 300 || !result.data) {
      throw new Error(`权威回读控制面失败: ${result && (result.error || result.statusCode)}`)
    }
    const payload = verifySignedEnvelope(result.data, {
      kind: 'authority-read', scenarioId: plane.scenarioId, fixtureId: fixture.id,
      actionId: action.id, branch, phase, requestIndex, runNonce,
    })
    const facts = payload.facts
    return {
      actionId: action.id,
      fixtureId: fixture.id,
      request: facts.request,
      authority: facts.authority,
      accessScope: facts.accessScope,
      mapping: facts.mapping,
      timeoutResolution: facts.timeoutResolution,
      requestTrace: facts.requestTrace,
      assertions: facts.assertions,
      controlPlaneAttestation: result.data,
    }
  },
}
