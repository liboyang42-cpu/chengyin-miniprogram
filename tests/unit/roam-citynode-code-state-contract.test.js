const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const PAGE_MODULE = '../../subpackageRoam/citynode-code/index.js'

let pageConfig
let requests

function loadPage() {
  delete require.cache[require.resolve(PAGE_MODULE)]
  require(PAGE_MODULE)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

beforeEach(() => {
  pageConfig = null
  requests = []
  global.Page = (config) => { pageConfig = config }
  global.getApp = () => ({
    sendRequest: (request) => { requests.push(request) },
  })
  global.wx = {}
})

test('据点码 HTTP 异常必须离开 loading，且不向用户透传内部错误', () => {
  const page = loadPage()
  page.onLoad({ poiId: 'poi-1', name: encodeURIComponent('武康大楼') })

  assert.equal(requests.length, 1)
  assert.equal(typeof requests[0].successStatusAbnormal, 'function')

  requests[0].successStatusAbnormal({ statusCode: 502, msg: '/api/verify/citynode/issue upstream timeout' })

  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errMsg, '暂时无法生成核销码，请稍后重试')
  assert.equal(page.data.qrcodeUrl, '')
  assert.equal(page.data.code, '')
})

test('据点码业务失败同样使用用户可理解的重试文案', () => {
  const page = loadPage()
  page.onLoad({ poiId: 'poi-1' })

  requests[0].success({ code: 500, msg: 'permission denied: /api/verify/citynode/issue' })

  assert.equal(page.data.state, 'error')
  assert.equal(page.data.errMsg, '暂时无法生成核销码，请稍后重试')
})
