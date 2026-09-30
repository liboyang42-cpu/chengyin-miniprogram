const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')

function mount(options) {
  let pageDefinition, componentDefinition, editor
  const requests = []
  global.getApp = () => ({ globalData: {}, sendRequest(request) { requests.push(request) } })
  global.Page = definition => { pageDefinition = definition }
  global.Component = definition => { componentDefinition = definition }
  for (const file of ['pages/club/edit/index.js', 'components/cy/scene-club-edit/index.js']) {
    const absolute = path.join(root, file)
    delete require.cache[require.resolve(absolute)]
    require(absolute)
  }
  const tag = fs.readFileSync(path.join(root, 'pages/club/edit/index.wxml'), 'utf8').match(/<cy-scene-club-edit\b[^>]*>/)[0]
  const condition = tag.match(/wx:if="\{\{(\w+)\}\}"/)
  const page = Object.assign({}, pageDefinition, {
    data: structuredClone(pageDefinition.data),
    setData(patch) { Object.assign(this.data, patch); render() },
  })
  function render() {
    if (condition && !page.data[condition[1]]) return
    if (editor) { editor.setData({ clubId: page.data.clubId }); return }
    editor = Object.assign({}, componentDefinition.methods, {
      data: Object.assign(structuredClone(componentDefinition.data), { clubId: page.data.clubId }),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this) },
      triggerEvent() {},
    })
    componentDefinition.lifetimes.attached.call(editor)
  }
  render()
  page.onLoad(options)
  return { page, editor, requests }
}

test('旧编辑链接在路由参数到位后首次加载正确俱乐部，未保存关闭仍需确认', () => {
  for (const options of [{ id: '7001' }, { clubId: '7001' }]) {
    const { page, editor, requests } = mount(options)
    assert.equal(requests.length, 1)
    assert.deepEqual(JSON.parse(requests[0].data), { id: '7001' })
    requests[0].success({ code: 200, data: { name: '原俱乐部', city: '上海', isOwner: true } })
    assert.equal(editor.data.loadState, 'ready')
    assert.equal(editor.data.name, '原俱乐部')
    page.onDirtyChange({ detail: { dirty: true } })
    page.requestBack()
    assert.equal(page.data.confirm.show, true)
    page.cancelBack()
    assert.equal(page.data.dirty, true)
  }
})

test('真正缺参仍渲染明确错误，不猜对象也不留下空白', () => {
  const { editor, requests } = mount({})
  assert.ok(editor)
  assert.equal(editor.data.loadState, 'missing-param')
  assert.equal(requests.length, 0)
})
