const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const source = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('商家优惠券管理入口显式传 MERCHANT 且列表到新增页不丢 scope', () => {
  const merchantHome = source('pages/merchant/index/index.js')
  const marketing = source('pages/merchant/marketing/index.js')
  const couponList = source('subpackageMember/coupon/coupon.js')
  const couponInfo = source('subpackageMember/couponInfo/couponInfo.js')

  assert.doesNotMatch(merchantHome, /navigateTo\(\{ url: '\/subpackageMember\/coupon\/coupon' \}\)/)
  assert.match(merchantHome, /\/subpackageMember\/coupon\/coupon\?scope=MERCHANT/)
  assert.match(marketing, /\/subpackageMember\/coupon\/coupon\?scope=MERCHANT/)
  assert.match(couponList, /operationScope/)
  assert.match(couponList, /scope:\s*that\.data\.operationScope/)
  assert.match(couponList, /couponInfo\/couponInfo'[\s\S]{0,120}operationScope === 'MERCHANT'[\s\S]{0,80}\?scope=MERCHANT/)
  assert.match(couponInfo, /operationScope/)
  assert.match(couponInfo, /scope:\s*that\.data\.operationScope/)
})

test('商家扫码仅对 coupon 核销请求补 MERCHANT，其他扫码合同不被改写', () => {
  const merchantHome = source('pages/merchant/index/index.js')
  const profile = source('components/cy/profile/index.js')
  const memberDetail = source('subpackageMember/components/scene-member-participation-detail/index.js')

  assert.match(merchantHome, /scan\.kind === 'coupon'[\s\S]{0,180}scope:\s*'MERCHANT'/)
  assert.doesNotMatch(profile, /scope:\s*'MERCHANT'/)
  assert.doesNotMatch(memberDetail, /scope:\s*'MERCHANT'/)
})

test('发布流程 reward selector 透传页面 operationScope', () => {
  const component = source('pages/publish/components/reward-selector/index.js')
  const fabu = source('pages/publish/fabu/topic-detail-sheet.wxml')
  const temp = source('pages/publish/temp/index.wxml')

  assert.match(component, /scope:\s*\{\s*type:\s*String/)
  assert.match(component, /scope:\s*this\.data\.scope/)
  assert.match(fabu, /scope="\{\{operationScope\}\}"/)
  assert.match(temp, /scope="\{\{operationScope\}\}"/)
})
