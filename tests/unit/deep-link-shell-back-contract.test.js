const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('邀请记录深链把导航返回交给页面恢复逻辑', () => {
  const view = read('subpackageMember/myinvite/myinvite.wxml')
  const source = read('subpackageMember/myinvite/myinvite.js')
  assert.match(view, /<cy-nav-bar\b[^>]*custom-back[^>]*bind:back="onClose"/)
  assert.match(source, /getCurrentPages\(\)\.length > 1[\s\S]*wx\.navigateBack\(\)[\s\S]*wx\.redirectTo\(\{ url: '\/subpackageA\/pages\/assetcenter\/earnings\/index' \}\)/)
})

test('据点核销码所有可见状态共用真实深链返回', () => {
  const view = read('subpackageRoam/citynode-code/index.wxml')
  const source = read('subpackageRoam/citynode-code/index.js')
  const nav = view.match(/<cy-nav-bar\b[^>]*\/>/)
  assert.ok(nav)
  assert.match(nav[0], /custom-back[^>]*bind:back="onClose"/)
  // 2026-09-18 ✕统一裁决:出码态出口是弹层右上角✕(同一 onClose),返回钮只留缺参态,
  // 不与✕同屏、不压在弹层遮罩上。
  assert.match(nav[0], /wx:if="\{\{state === 'missing'\}\}"/)
  const voucher = view.match(/<cy-qr-voucher[\s\S]*?\/>/)
  assert.ok(voucher, '出码态必须由 cy-qr-voucher 承载,✕即出口')
  assert.match(voucher[0], /bind:close="onClose"/)
  assert.match(source, /onClose\(\)[\s\S]*getCurrentPages\(\)\.length > 1[\s\S]*wx\.navigateBack\(\)[\s\S]*wx\.reLaunch\(\{ url: '\/pages\/roam\/index' \}\)/)
})
