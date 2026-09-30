'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const js = fs.readFileSync(path.join(__dirname, '../../subpackagePrefab/index.js'), 'utf8')
const wxml = fs.readFileSync(path.join(__dirname, '../../subpackagePrefab/index.wxml'), 'utf8')
const playJs = fs.readFileSync(path.join(__dirname, '../../pages/play/index.js'), 'utf8')

test('F18/F20 预制人生 mock 只在开发环境生效，进度按 member 和场次隔离', () => {
  assert.match(js, /options\.mock === '1' && app\.isDevEnv && app\.isDevEnv\(\)/)
  assert.match(js, /_currentArchiveSession\(\)/)
  assert.match(js, /Object\.assign\(\{\}, this\._session, \{ memberId \}\)/)
  assert.match(js, /nextKey !== this\._archiveKey/)
  assert.match(js, /!nextKey \|\| \(this\._archiveKey && nextKey !== this\._archiveKey\)/)
  assert.match(js, /story\.saveArchive\(wx, nextArchive, this\._state\)/)
  assert.match(js, /story\.clearArchive\(wx, this\._archive\)/)
  assert.match(playJs, /options\.mock && app\.isDevEnv && app\.isDevEnv\(\)/)
})

test('F21 地图明确为剧情留言，不伪装实时附近人数和点赞', () => {
  assert.match(wxml, /剧情地图 · 2 段故事留言/)
  assert.match(wxml, /剧情角色/)
  assert.doesNotMatch(wxml, /此刻 2 人在附近|bindtap="likeMapNote"/)
  assert.doesNotMatch(js, /likeMapNote\(\)/)
})

test('F22 重看剧情先确认，并明确不重置任务或奖励', () => {
  assert.match(wxml, /bindtap="confirmReplay">重看剧情/)
  assert.match(js, /title: '重看剧情？'/)
  assert.match(js, /不会重置已完成的任务或奖励/)
  assert.match(js, /res && res\.confirm/)
})
