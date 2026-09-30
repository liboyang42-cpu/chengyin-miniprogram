const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('商家评价页注册在既有 merchant 分包;营销页按稿不再放口碑管理入口', () => {
  const appJson = read('app.json')
  const marketingJs = read('pages/merchant/marketing/index.js')

  assert.match(appJson, /"root":\s*"pages\/merchant"[\s\S]*?"reviews\/index"/)
  // 2026-09-18 UI-09 按用户稿 p07zJMtMOc1yT1AuLTKtSs 37:2 营销页只留 4 格,「口碑管理」入口删除(用户确认评价管理页暂无入口)
  assert.doesNotMatch(marketingJs, /口碑管理|merchantReviews/)
})

test('公开商家 About 从现有 subjectMerchant.id 进入对应门店的真实评价', () => {
  const profileJs = read('components/cy/profile/index.js')
  const profileWxml = read('components/cy/profile/index.wxml')

  assert.match(profileWxml, /bindtap="goMerchantReviews"[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)*[\s\S]*?真实评价/)
  assert.match(profileJs, /goMerchantReviews:\s*function\s*\(\)[\s\S]*?subjectMerchant\.id[\s\S]*?pages\/merchant\/reviews\/index\?merchantRowId=/)
  assert.doesNotMatch(profileJs, /goMerchantReviews:[\s\S]*?subjectMerchant\.memberId/)
})

test('店铺装修不再把已上线评价写成即将开放', () => {
  const decor = read('pages/merchant/decor/index.wxml')

  assert.doesNotMatch(decor, /评价[^<]{0,20}<text class="dc-soon">即将开放/)
})
