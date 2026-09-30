'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'subpackageMember/mytemplate/mytemplate.js')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadPage() {
  const requests = []
  let definition
  global.getApp = () => ({
    getRequestErrorMessage: (response, fallback) => (response && (response.msg || response.errMsg)) || fallback,
    getUserRole: () => 'user',
    getUserType: () => 'user',
    sendRequest: (options) => requests.push(options),
  })
  global.Page = (config) => { definition = config }
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    navigateTo() {},
    showModal() {},
    showToast() {},
    stopPullDownRefresh() {},
  }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
  })
  return { page, requests }
}

function response(rows, total) {
  return { code: 200, data: { rows, total } }
}

test('加载更多失败保留现有玩法与页码，重试仍请求同一页', () => {
  const h = loadPage()
  h.page.getList()
  h.requests[0].success(response([{ id: 1, title: '第一关' }], 2))
  h.requests[0].complete()
  assert.equal(h.page.data.page, 1)
  assert.equal(h.page.data.list.length, 1)

  h.page.loadMore()
  assert.equal(h.requests[1].data.pageNum, 2)
  assert.equal(h.requests[1].hideLoading, true)
  assert.equal(h.requests[1].silentError, true)
  assert.equal(h.page.data.loadingMore, true)
  h.requests[1].fail({ errMsg: '网络开小差了' })
  h.requests[1].complete()
  assert.equal(h.page.data.page, 1, '失败时不能越过第 2 页')
  assert.deepEqual(h.page.data.list.map((item) => item.id), [1], '已显示内容不能被清空')
  assert.equal(h.page.data.errorMsg, '', '加载更多不能切成整屏错误')
  assert.match(h.page.data.loadMoreError, /网络/)

  h.page.retryLoadMore()
  assert.equal(h.requests[2].data.pageNum, 2)
  h.requests[2].success(response([{ id: 2, title: '第二关' }], 2))
  h.requests[2].complete()
  assert.equal(h.page.data.page, 2)
  assert.deepEqual(h.page.data.list.map((item) => item.id), [1, 2])
  assert.equal(h.page.data.loadMoreError, '')
})

test('有内容时刷新失败转为局部提示，不把旧列表伪装成空态', () => {
  const h = loadPage()
  h.page.data.list = [{ id: 7, title: '已保留的玩法' }]
  h.page.data.hasMore = false
  h.page.refreshList()
  h.requests[0].fail({ msg: '服务暂时不可用' })
  h.requests[0].complete()
  assert.deepEqual(h.page.data.list.map((item) => item.id), [7])
  assert.equal(h.page.data.errorMsg, '')
})

test('列表区分首屏错误、刷新错误、加载更多错误和在途态', () => {
  const wxml = read('subpackageMember/mytemplate/mytemplate.wxml').replace(/<!--[\s\S]*?-->/g, '')
  const json = JSON.parse(read('subpackageMember/mytemplate/mytemplate.json'))
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.match(wxml, /<cy-error\b[^>]*wx:if="\{\{!loading && errorMsg && list\.length === 0\}\}"[^>]*bind:retry="refreshList"/s)
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*staleError/s)
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{loadMoreError\}\}"[^>]*action="重试"[^>]*bind:action="retryLoadMore"/s)
  assert.match(wxml, /wx:elif="\{\{loadingMore\}\}"[^>]*aria-live="polite"[^>]*>正在加载更多…<\/view>/s)
  assert.match(wxml, /wx:elif="\{\{hasMore && list\.length > 0\}\}"[^>]*aria-role="button"[^>]*bindtap="loadMore"/s)
})

test('负控：加载更多失败分支不得再覆写 list', () => {
  const source = read('subpackageMember/mytemplate/mytemplate.js')
  const handler = source.slice(source.indexOf('handleListError(isLoadMore'), source.indexOf('// 删除模板API调用'))
  const loadMoreBranch = handler.slice(handler.indexOf('if (isLoadMore)'), handler.indexOf('if (localRows.length'))
  assert.match(source, /loadingMore/)
  assert.match(loadMoreBranch, /loadMoreError/)
  assert.doesNotMatch(loadMoreBranch, /list\s*:/)
})
