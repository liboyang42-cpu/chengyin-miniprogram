const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('首页逆地理编码不携带第三方地图密钥', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../pages/index/index.js'), 'utf8');

  assert.equal(source.includes('TIANDITU_KEY'), false);
  assert.equal(source.includes('api.tianditu.gov.cn'), false);
  assert.equal(source.includes('/api/map/reverse-geocode'), true);
});
