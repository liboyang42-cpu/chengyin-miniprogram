'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  stableJson, trustedControlPlane, verifySignedEnvelope,
} = require('../../scripts/uiaudit/trusted-attestation')

function trustFixture() {
  const pair = crypto.generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-trust-'))
  const file = path.join(dir, 'control-plane.pem')
  fs.writeFileSync(file, publicKey)
  return {
    privateKey: pair.privateKey,
    file,
    fingerprint: `sha256:${crypto.createHash('sha256').update(publicKey).digest('hex')}`,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

function signed(payload, privateKey) {
  return { payload, signature: crypto.sign(null, Buffer.from(stableJson(payload)), privateKey).toString('base64') }
}

test('控制面必须命中显式 allowlist，任意 HTTPS 不算受控后端', () => {
  const previousOrigin = process.env.ACTION_CONTROL_PLANE_ORIGIN
  const previousFile = process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE
  const previousFingerprint = process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256
  const trust = trustFixture()
  process.env.ACTION_CONTROL_PLANE_ORIGIN = 'https://qa.chengyin.invalid'
  process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE = trust.file
  process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256 = trust.fingerprint
  assert.throws(() => trustedControlPlane({
    controlPlane: { baseUrl: 'https://attacker.example', scenarioId: 's1' },
  }), /未命中/)
  assert.deepEqual(trustedControlPlane({
    controlPlane: { baseUrl: 'https://qa.chengyin.invalid/path', scenarioId: 's1' },
  }), { baseUrl: 'https://qa.chengyin.invalid', scenarioId: 's1' })
  if (previousOrigin == null) delete process.env.ACTION_CONTROL_PLANE_ORIGIN
  else process.env.ACTION_CONTROL_PLANE_ORIGIN = previousOrigin
  if (previousFile == null) delete process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE
  else process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE = previousFile
  if (previousFingerprint == null) delete process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256
  else process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256 = previousFingerprint
  trust.cleanup()
})

test('控制面回执必须签名并绑定 action/branch/run nonce，不能重放', () => {
  const previousFile = process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE
  const previousFingerprint = process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256
  const trust = trustFixture()
  process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE = trust.file
  process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256 = trust.fingerprint
  const payload = {
    kind: 'fixture-identity', actionId: 'a1', fixtureId: 'f1', scenarioId: 's1',
    branch: 'success', runNonce: 'nonce-current', issuedAt: new Date().toISOString(), facts: { synthetic: true },
  }
  assert.equal(verifySignedEnvelope(signed(payload, trust.privateKey), {
    kind: payload.kind, actionId: 'a1', fixtureId: 'f1', scenarioId: 's1', branch: 'success', runNonce: 'nonce-current',
  }).facts.synthetic, true)
  assert.throws(() => verifySignedEnvelope(signed(payload, trust.privateKey), { runNonce: 'nonce-other' }), /runNonce/)
  assert.throws(() => verifySignedEnvelope({ ...signed(payload, trust.privateKey), signature: Buffer.alloc(64).toString('base64') }, { runNonce: 'nonce-current' }), /签名/)
  if (previousFile == null) delete process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE
  else process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_FILE = previousFile
  if (previousFingerprint == null) delete process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256
  else process.env.ACTION_CONTROL_PLANE_PUBLIC_KEY_SHA256 = previousFingerprint
  trust.cleanup()
})
