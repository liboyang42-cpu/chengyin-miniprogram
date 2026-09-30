'use strict'

module.exports = {
  async capture(context) {
    return {
      actionId: context.action.id,
      fixtureId: context.fixture.id,
      request: { method: 'GET', url: '/api/test/resource', resourceId: 'fixture-1', authMode: 'jwt-test' },
      authority: {
        endpoint: '/api/test/resource/fixture-1',
        resourceId: 'fixture-1',
        fact: { status: 'ready' },
      },
      accessScope: {
        principalFingerprint: 'sha256:test-account', role: 'player',
        ownerFingerprint: 'sha256:test-account', scope: 'self', scopeVerified: true, decision: 'allowed',
      },
      mapping: { matched: true, paths: ['items'] },
      assertions: ['响应资源 ID 与页面 items 映射一致'],
    }
  },
}
