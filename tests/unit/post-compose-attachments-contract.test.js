/**
 * 广场新建帖文:图 / 地点 / 活动必须真接选 + 预览,发布把附件带上。
 * 占位 toast「还没做好」会让用户以为发出去了,附件其实没存到能看见的地方。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const js = read('pages/square/components/cy/post-compose/index.js')
const wxml = read('pages/square/components/cy/post-compose/index.wxml')
const wxss = read('pages/square/components/cy/post-compose/index.wxss')
const src = js + '\n' + wxml

test('源码不再出现 onNotYet 或还没做好', () => {
  assert.doesNotMatch(src, /\bonNotYet\b/)
  assert.doesNotMatch(src, /还没做好/)
  assert.doesNotMatch(src, /即将开放|暂未开放/)
})

test('WXML 有预览区 class,图/地点/活动都能看见也能清掉', () => {
  assert.match(wxml, /class="[^"]*cmp-preview/)
  assert.match(wxml, /picList/)
  assert.match(wxml, /\baddress\b/)
  assert.match(wxml, /selectedActivity/)
  assert.match(wxml, /onClearPic|onRemovePic/)
  assert.match(wxml, /onClearLocation/)
  assert.match(wxml, /onClearActivity/)
})

test('发布 payload 含 pics / address / data_id', () => {
  const publish = js.match(/onPublish\(\)\s*\{[\s\S]*?\n    \},\n/)
  assert.ok(publish, '找不到 onPublish')
  const body = publish[0]
  assert.match(body, /pics:/)
  assert.match(body, /address:/)
  assert.match(body, /data_id:/)
  assert.match(body, /data_type:/)
})

test('预览区只用 token,不另造颜色', () => {
  const preview = wxss.match(/\.cmp-preview[\s\S]*?\.cmp-send/)
  const slice = preview ? preview[0] : wxss
  assert.doesNotMatch(slice, /#[0-9a-fA-F]{3,8}/)
  assert.match(wxss, /--cy-color-text-primary|--cy-color-bg-elevated/)
})
