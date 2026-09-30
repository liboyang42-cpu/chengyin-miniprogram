const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'subpackageP3/pages/stamp-album/index/index.js')

function loadPage() {
  const sandbox = { requests: [] }
  global.getApp = () => ({ sendRequest: (options) => sandbox.requests.push(options) })
  global.wx = { navigateTo() {} }
  global.Page = (config) => { sandbox.def = config }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const page = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  })
  page.data = JSON.parse(JSON.stringify(sandbox.def.data))
  page._cellW = 80
  page._cellH = 100
  return { page, sandbox }
}

const stamp = (id) => ({ id, picUrl: `https://example.com/${id}.jpg` })

test('200 畸形 list/total 进入错误态，续页时保留已确认邮票与游标', () => {
  const malformed = [
    { list: {}, total: 1 },
    { list: [null], total: 1 },
    { list: [{ id: 2, picUrl: '' }], total: 1 },
    { list: [stamp(2)] },
    { list: [stamp(2)], total: '2' },
    { list: [stamp(2)], total: -1 },
    { list: [stamp(2)], total: 0 },
  ]
  for (const data of malformed) {
    const { page, sandbox } = loadPage()
    page.data.items = [{ id: 1, picUrl: 'confirmed', x: 0, y: 0, rot: 0, z: 1 }]
    page.data.total = 3
    page.data.pageNum = 2
    page.data.loaded = true
    page.load()
    assert.doesNotThrow(() => sandbox.requests[0].success({ code: 200, data }))
    assert.equal(page.data.error, true)
    assert.equal(page.data.loading, false)
    assert.equal(page.data.items.length, 1)
    assert.equal(page.data.items[0].id, 1)
    assert.equal(page.data.pageNum, 2)
    assert.equal(page.data.total, 3)
  }
})

test('合法 total 决定终页；非空第一页不会因默认 0 被误判为 noMore', () => {
  const { page, sandbox } = loadPage()
  page.load()
  sandbox.requests[0].success({ code: '200', data: { list: [stamp(1)], total: 51 } })
  assert.equal(page.data.error, false)
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.total, 51)
  assert.equal(page.data.pageNum, 2)
  assert.equal(page.data.noMore, false)

  page.load()
  sandbox.requests[1].success({ code: 200, data: { list: [], total: 51 } })
  assert.equal(page.data.noMore, true)
})

test('空列表 + total 0 是合法真空态', () => {
  const { page, sandbox } = loadPage()
  page.load()
  sandbox.requests[0].success({ code: 200, data: { list: [], total: 0 } })
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.error, false)
  assert.equal(page.data.total, 0)
  assert.equal(page.data.noMore, true)
})

test('相机 FAB 使用项目图标，不用全角加号伪造资产', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackageP3/pages/stamp-album/index/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'subpackageP3/pages/stamp-album/index/index.json'), 'utf8'))
  assert.match(wxml, /<cy-icon[^>]*name="plus"/)
  assert.doesNotMatch(wxml, /＋/)
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
})

test('negative control: payload 必须显式验证 list 与 finite nonnegative total', () => {
  const source = fs.readFileSync(MODULE, 'utf8')
  assert.match(source, /Array\.isArray\(d\.list\)/)
  assert.match(source, /typeof d\.total === 'number'/)
  assert.match(source, /Number\.isFinite\(d\.total\)/)
})

test('票面底部压投票人写的那一句;后端没给 caption 时不渲染那一层', () => {
  // 原型 .stkcell 的每一格底部都有一行字;现码原来只有图,谁在哪儿投的看不出来。
  // 这一条 2026-09-10 补上 —— 用户裁决「过稿的设计赢,只补原型多出来的」。
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../components/cy/scene-roam-stamp-album/index.js'), 'utf8')
  assert.match(src, /caption: typeof row\.caption === 'string' \? row\.caption\.trim\(\) : ''/,
    'caption 必须从回包带到 item 上,否则 wxml 永远拿不到')
  const wxml = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../components/cy/scene-roam-stamp-album/index.wxml'), 'utf8')
  // 2026-09-10 集邮册整屏照原型 f-sticker 重做成三列方格,类名随之 album-cap → stkcell__cap。
  assert.match(wxml, /class="stkcell__cap" wx:if="\{\{item\.caption\}\}"/,
    '空 caption 不许渲染 —— 否则票面底下压一条空的黑渐变')
})
