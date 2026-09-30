const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { canUseDemoRoamPois, selectDemoRoamPois } = require('../../utils/roam-demo-gate.js')

test('演示 POI 只在开发版且显式开关打开时允许出现', () => {
  const pois = [{ id: 1 }]
  assert.equal(canUseDemoRoamPois(null), false)
  assert.deepEqual(selectDemoRoamPois({ isDevEnv: () => false }, pois), [])
  assert.deepEqual(selectDemoRoamPois({
    isDevEnv: () => true,
    globalData: { features: { roamDemoPois: false } },
  }, pois), [])
  assert.deepEqual(selectDemoRoamPois({
    isDevEnv: () => true,
    globalData: { features: { roamDemoPois: true } },
  }, pois), pois)

  const appSource = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8')
  assert.match(appSource, /roamDemoPois:\s*false/)
})
