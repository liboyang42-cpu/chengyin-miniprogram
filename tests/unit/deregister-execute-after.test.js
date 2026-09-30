'use strict'
// 1-39:后端 DeregistrationStatusVO.executeAfter 是 Date,无 @JsonFormat;Spring Boot 2.5 默认
// WRITE_DATES_AS_TIMESTAMPS=false + ApplicationConfig 时区 Asia/Shanghai ⇒ 真实下发
// "2026-09-24T10:30:00.000+08:00"(RV-p1 用 JacksonAutoConfiguration 实跑序列化核实)。
// 前端以前原样显示这串 ISO;现在统一格式化成中国时区,epoch 数字也兼容。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function loadFlow(response) {
  global.getApp = () => ({ sendRequest(o) { o.success(response) } })
  const mod = path.resolve(__dirname, '../../utils/deregister-flow.js')
  delete require.cache[mod]
  const { initialData, methods } = require(mod)
  const host = Object.assign({ data: initialData() }, methods, {
    setData(patch) { Object.assign(this.data, patch) },
  })
  return host
}

test('1-39:executeAfter 为 epoch 毫秒时按中国时区显示', () => {
  const epoch = Date.UTC(2026, 8, 24, 2, 30)   // 2026-09-24 10:30 北京时间
  const host = loadFlow({ code: 200, data: { status: 'PENDING', executeAfter: epoch } })
  host.loadStatus()
  assert.equal(host.data.status, 'PENDING')
  assert.equal(host.data.executeAfter, '2026-09-24 10:30')
})

test('1-39:后端真实回包 ISO 字符串按中国时区显示', () => {
  const host = loadFlow({ code: 200, data: { status: 'PENDING', executeAfter: '2026-09-24T10:30:00.000+08:00' } })
  host.loadStatus()
  assert.equal(host.data.executeAfter, '2026-09-24 10:30')
  const utc = loadFlow({ code: 200, data: { status: 'PENDING', executeAfter: '2026-09-24T02:30:00.000Z' } })
  utc.loadStatus()
  assert.equal(utc.data.executeAfter, '2026-09-24 10:30')
})

test('1-39:解析不了的字符串原样显示,空值不编造', () => {
  let host = loadFlow({ code: 200, data: { status: 'PENDING', executeAfter: '审核后7天' } })
  host.loadStatus()
  assert.equal(host.data.executeAfter, '审核后7天')
  host = loadFlow({ code: 200, data: { status: 'PENDING', executeAfter: null } })
  host.loadStatus()
  assert.equal(host.data.executeAfter, '')
})
