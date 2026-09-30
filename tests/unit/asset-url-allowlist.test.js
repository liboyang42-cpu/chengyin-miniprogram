const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../utils/config.js');

test('资产域名只允许正式 HTTPS 主域，拒绝 http、伪后缀和任意外域', () => {
  assert.equal(config.isTrustedAssetUrl('https://api.example.invalid/prod-api/profile/a.jpg'), true);
  assert.equal(config.isTrustedAssetUrl('http://api.example.invalid/a.jpg'), false);
  assert.equal(config.isTrustedAssetUrl('https://api.example.invalid.evil.test/a.jpg'), false);
  assert.equal(config.isTrustedAssetUrl('https://evil.test/a.jpg'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'amapWebKey'), false);
});
