const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('商家入驻明确展示四步计数、分段进度、大标题与纵向字段', () => {
  const wxml = read('pages/merchant/apply/index.wxml')
  const wxss = read('pages/merchant/apply/index.wxss')
  assert.match(wxml, /\{\{step\}\} \/ 4/)
  assert.match(wxml, /stepHeadlines\[step - 1\]/)
  assert.match(wxml, /class="frow frow--field"/)
  assert.match(wxss, /grid-template-columns:\s*repeat\(4, 1fr\)/)
  assert.match(wxss, /\.frow--field\s*\{[^}]*flex-direction:\s*column/)
  assert.doesNotMatch(wxml, /class="wizard-secondary"/)
})

test('搜索结果只把主题提升为海报卡，活动详情结构不在本轮重做', () => {
  const wxml = read('pages/search2/result/index.wxml')
  assert.match(wxml, /item\.type === 'topic'/)
  assert.match(wxml, /class="topic-result-card"/)
  assert.match(wxml, /class="result-card"/)
  assert.match(wxml, /\{\{item\.detail\}\}/)

  const official = read('pages/activity/official-detail/index.wxml')
  assert.match(official, /class="od-page"/)
  assert.doesNotMatch(official, /topic-result-card/)
})

test('预置协作对象入口向邀请页透传真实头像与说明', () => {
  const club = read('pages/club/detail/index.js')
  const merchant = read('components/cy/profile/index.js')
  const invite = read('pages/coop/invite/index.js')
  assert.match(club, /toLogo=/)
  assert.match(club, /toMeta=/)
  assert.match(merchant, /toLogo=/)
  assert.match(merchant, /toMeta=/)
  assert.match(invite, /logo:\s*routeText\(options\.toLogo\)/)
  assert.match(invite, /meta:\s*routeText\(options\.toMeta\)/)
})
