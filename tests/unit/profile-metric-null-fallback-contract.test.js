const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const src = fs.readFileSync(path.join(ROOT, 'components/cy/profile/index.js'), 'utf8')

// WXML 的文本插值把 null 原样打印成字面「null」。metricNumber() 缺值就返回 null,
// 所以凡是「metricNumber 的结果直接进 setData、又在 wxml 里裸插值」的字段,都必须有具体值兜底。
// 2026-09-18 UI-04 用户拍板:兜底值从「—」改成 0(数字统计没取到就显示 0)。
test('好友/关注/粉丝三个计数缺字段时兜底成 0,不许把 null 打到屏幕上', () => {
  ;['friendNum', 'followNum', 'fansNum'].forEach((key) => {
    const re = new RegExp(`${key}:\\s*${key}\\s*==\\s*null\\s*\\?\\s*0\\s*:\\s*${key}`)
    assert.match(src, re, `${key} 缺兜底 —— 接口不返这个字段时屏幕上会出现字面 null`)
  })
})

test('兜底只在展示层:ready/error 判定仍用数值原值,不能被兜底值污染', () => {
  assert.match(src, /var userSignals = \[followNum, fansNum, topicNum, activityNum, likeNum\]/,
    '信号数组必须用 metricNumber 的原值;换成打过兜底的字符串会让 error 态永远判不出来')
  assert.match(src, /userSourceReady = userSignals\.every\(function \(value\) \{ return value != null; \}\)/)
})

test('metricNumber 的契约没变:缺值返回 null(这正是要兜底的原因)', () => {
  assert.match(src, /function metricNumber\(value\) \{\s*if \(value === null \|\| value === undefined \|\| value === ''\) return null;/)
})
