'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { parseDoorScene, pathForScanEntry, captureDoorScene } = require('../../utils/game-door-entry.js')

const HEX = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'

test('首页 scene 只认 32 位打卡码，个人码 p1. 不能当门口码', () => {
  assert.equal(parseDoorScene(HEX), HEX)
  assert.equal(parseDoorScene(HEX.toUpperCase()), HEX)
  assert.equal(parseDoorScene(encodeURIComponent(HEX)), HEX)
  assert.equal(parseDoorScene('p1.zz.abcdefghijkl'), null)
  assert.equal(parseDoorScene(''), null)
  assert.equal(parseDoorScene(undefined), null)
})

test('没报名落到主题购买页；已报名进游玩', () => {
  assert.equal(
    pathForScanEntry({ action: 'purchase', topicId: 100, nodeId: 77 }),
    '/pages/topic/index/index?id=100'
  )
  assert.equal(
    pathForScanEntry({ action: 'play', topicId: 100, activityId: 43, nodeId: 77 }),
    '/pages/play/index?topicId=100&activityId=43'
  )
  assert.equal(
    pathForScanEntry({ action: 'play', topicId: 100, nodeId: 77 }),
    '/pages/play/index?topicId=100'
  )
  assert.equal(pathForScanEntry(null), null)
})

test('只有扫小程序码那一次才收下门口码，后台切回的残留 query 不能再分流', () => {
  assert.equal(captureDoorScene({ scene: 1047, query: { scene: HEX } }, null), HEX)
  assert.equal(captureDoorScene({ scene: 1048, query: { scene: HEX } }, null), HEX)
  assert.equal(captureDoorScene({ scene: 1049, query: { scene: HEX } }, null), HEX)
  assert.equal(captureDoorScene({ scene: 1089, query: { scene: HEX } }, null), null)
  assert.equal(captureDoorScene({ scene: 1089, query: { scene: HEX } }, HEX), HEX)
  assert.equal(captureDoorScene({ scene: 1047, query: { scene: 'p1.zz.abcdefghijkl' } }, null), null)
})

test('首页冷启动会解析门口码并请求 scan-entry', () => {
  const indexJs = fs.readFileSync(path.join(__dirname, '../../pages/index/index.js'), 'utf8')
  const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8')
  assert.match(indexJs, /game-door-entry/)
  assert.match(indexJs, /\/api\/play\/scan-entry/)
  assert.match(indexJs, /consumeDoorScene/)
  assert.match(indexJs, /onShow\(\) \{[\s\S]*consumeDoorScene/)
  assert.match(indexJs, /pendingDoorScene/)
  assert.doesNotMatch(indexJs, /getEnterOptionsSync/)
  assert.match(appJs, /captureDoorScene/)
  assert.match(appJs, /onLaunch[\s\S]*captureDoorScene/)
  assert.match(appJs, /onShow: function \(e\) \{[\s\S]*captureDoorScene/)
})
