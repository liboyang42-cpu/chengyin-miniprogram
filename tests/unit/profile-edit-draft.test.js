'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

function applyPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.')
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]]
    cursor[parts.at(-1)] = value
  })
}

function loadPage() {
  let config
  global.getApp = () => ({ globalData: {}, sendRequest() {}, getUserID: () => 1, tips() {} })
  global.Page = (value) => { config = value }
  global.wx = { showToast() {}, showLoading() {}, hideLoading() {}, navigateBack() {} }
  delete require.cache[require.resolve('../../pages/gerenziliao/gerenziliao.js')]
  require('../../pages/gerenziliao/gerenziliao.js')
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = (patch, callback) => {
    applyPatch(page.data, patch)
    if (callback) callback()
  }
  return page
}

test('昵称取消只丢弃草稿，不能把未确认值带到底部保存', () => {
  const page = loadPage()
  page.data.userInfo.name = '原昵称'
  page.openPop4()
  page.onInputChange({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '未确认昵称' } })
  assert.equal(page.data.userInfo.name, '原昵称')
  assert.equal(page.data.tempName, '未确认昵称')
  page.cancel4()
  assert.equal(page.data.userInfo.name, '原昵称')

  page.openPop4()
  page.onInputChange({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '已确认昵称' } })
  page.confirm4()
  assert.equal(page.data.userInfo.name, '已确认昵称')
})

test('城市签名取消只丢弃草稿，完成才写回 userInfo', () => {
  const page = loadPage()
  page.data.userInfo.introduction = '原签名'
  page.openPop()
  page.onInputChange({ currentTarget: { dataset: { field: 'introduction' } }, detail: { value: '未确认签名' } })
  assert.equal(page.data.userInfo.introduction, '原签名')
  page.cancel()
  assert.equal(page.data.userInfo.introduction, '原签名')

  page.openPop()
  page.onInputChange({ currentTarget: { dataset: { field: 'introduction' } }, detail: { value: '已确认签名' } })
  page.confirm()
  assert.equal(page.data.userInfo.introduction, '已确认签名')
})
