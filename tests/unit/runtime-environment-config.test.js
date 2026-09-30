const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const config = require('../../utils/config.js')

const PROD = 'https://api.example.invalid/prod-api'

test('release 固定使用生产；develop/trial 未配测试服时回落生产（2026-08-25 撤销 fail-closed）', () => {
  assert.deepEqual(config.resolveRuntimeConfig('release'), {
    environment: 'release',
    envVersion: 'release',
    apiBaseUrl: PROD,
    assetBaseUrl: PROD + '/profile/',
    configured: true,
  })

  for (const [envVersion, environment] of [['develop', 'develop'], ['trial', 'staging'], ['unknown', 'develop']]) {
    const runtime = config.resolveRuntimeConfig(envVersion)
    assert.equal(runtime.environment, environment)
    // 没有 ext.json 时回落生产：开发者工具/体验版要能拉到数据。
    assert.equal(runtime.apiBaseUrl, PROD)
    assert.equal(runtime.configured, true)
  }
})

test('非 release 优先用显式 HTTPS 测试地址；明文地址拒绝并回落生产', () => {
  assert.equal(config.resolveRuntimeConfig('develop', {
    apiEnvironments: { develop: 'https://dev.example.test/api' },
  }).apiBaseUrl, 'https://dev.example.test/api')
  assert.equal(config.resolveRuntimeConfig('trial', {
    apiEnvironments: { staging: 'https://staging.example.test/api/' },
  }).apiBaseUrl, 'https://staging.example.test/api')
  // 明文 http 仍然被 normalizeApiBaseUrl 拒绝，回落到生产 HTTPS，绝不发明文请求。
  assert.equal(config.resolveRuntimeConfig('trial', {
    apiEnvironments: { staging: 'http://staging.example.test/api' },
  }).apiBaseUrl, PROD)
})

test('app 启动必须按微信 envVersion 解析运行环境，登录不得在未配置时发相对地址', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8')
  assert.match(appJs, /runtimeConfig:\s*runtimeConfig/)
  assert.match(appJs, /siteBaseUrl:\s*runtimeConfig\.apiBaseUrl/)
  assert.match(appJs, /if \(!that\.globalData\.siteBaseUrl\)\s*\{\s*reject\(new Error\('runtime api environment is not configured'\)\)/)
})
