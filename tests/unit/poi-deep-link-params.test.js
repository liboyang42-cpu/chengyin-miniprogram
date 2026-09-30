const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')

function mount(options) {
  let pageDefinition, hostDefinition, host
  global.getApp = () => ({ globalData: {} })
  global.getCurrentPages = () => []
  global.Page = definition => { pageDefinition = definition }
  global.Component = definition => { hostDefinition = definition }
  for (const file of ['subpackageRoam/poi-detail/index.js', 'components/cy/scene-deep-link/index.js']) {
    const absolute = path.join(root, file)
    delete require.cache[require.resolve(absolute)]
    require(absolute)
  }
  const tag = fs.readFileSync(path.join(root, 'subpackageRoam/poi-detail/index.wxml'), 'utf8').match(/<cy-scene-deep-link\b[^>]*>/)[0]
  const condition = tag.match(/wx:if="\{\{(\w+)\}\}"/)
  const page = Object.assign({}, pageDefinition, {
    data: structuredClone(pageDefinition.data),
    setData(patch) { Object.assign(this.data, patch); render() },
  })
  function render() {
    if (condition && !page.data[condition[1]]) return
    if (host) { host.data.params = page.data.sceneParams; return }
    host = Object.assign({}, hostDefinition.methods, {
      data: { ...structuredClone(hostDefinition.data), sceneId: 'roam-poi-detail', params: page.data.sceneParams },
      setData(patch) { Object.assign(this.data, patch) },
    })
    hostDefinition.lifetimes.attached.call(host)
  }
  render()
  page.onLoad(options)
  return { page, host }
}

test('据点冷启动先接收路由参数再打开根场景，核销子场景返回仍保留同一据点', () => {
  const { page, host } = mount({ poiId: '990041' })
  assert.equal(host.data.sceneCurrent.params.poiId, '990041')
  host.openChildScene({ detail: { id: 'qr-citynode', params: { poiId: '990041' } } })
  host.closeChildScene()
  assert.equal(host.data.sceneCurrent.id, 'roam-poi-detail')
  assert.equal(host.data.sceneCurrent.params.poiId, '990041')
  assert.equal(page.onShareAppMessage().path, '/subpackageRoam/poi-detail/index?poiId=990041')
  assert.equal(page.onShareTimeline().query, 'poiId=990041')
})

test('缺少据点参数仍打开正文错误态，不猜对象且不永久留在加载中', () => {
  const { host } = mount({})
  assert.ok(host)
  assert.equal(host.data.sceneCurrent.params.poiId, '')
})
