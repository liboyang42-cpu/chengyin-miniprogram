'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSearchHistory, historyLabel, searchHistoryStorageKey } = require('../../pages/search2/utils/search-history.js')

test('对象历史项取 keyword/text，不渲染 [object Object]', () => {
  assert.equal(historyLabel({ keyword: '外滩' }), '外滩')
  assert.equal(historyLabel({ text: '夜行' }), '夜行')
  assert.equal(historyLabel({}), '')
  assert.deepEqual(
    normalizeSearchHistory([{ keyword: '外滩' }, '夜行', { foo: 1 }, '', null]),
    ['外滩', '夜行'],
  )
})

test('空字符串与重复项丢掉', () => {
  assert.deepEqual(normalizeSearchHistory(['外滩', '外滩', '  ']), ['外滩'])
})

test('F25 搜索历史 key 按账号隔离，未登录不落盘', () => {
  assert.equal(searchHistoryStorageKey('A'), 'search2_history:A')
  assert.equal(searchHistoryStorageKey('B'), 'search2_history:B')
  assert.equal(searchHistoryStorageKey(''), '')
  assert.notEqual(searchHistoryStorageKey('A'), searchHistoryStorageKey('B'))
})
