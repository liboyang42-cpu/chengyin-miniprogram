const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 用户流程拍板(2026-08-07):主办方发邀约被驳(条款/主题没配好)时,必须有「去编辑」出路,
// 编辑=专业编辑器(票价与主题内容),保存后回主题工作台重发。不能让失败文案成死胡同。
function assertEditExit(wxml, js) {
  assert.match(
    wxml,
    /class="iv-edit-exit" wx:if="\{\{sendResult && topicId && !sendRecruitClosed\}\}" bindtap="goEditTopic"/,
    '发送失败(sendResult 有值)且已选主题时必须渲染「去编辑主题」出路(招商期拒绝除外)',
  )
  // 2026-09-23 CU-M-29:「不在招商期」改票价救不回来,此时不能再指去编辑票价。
  assert.match(js, /const closed = \/\^招商写入已关闭\/\.test\(msg\);\s*if \(closed\) recruitClosed = true/,
    '招商期拒绝必须单独识别,不能沿用「去编辑票价」出口')
  assert.match(
    js,
    /goEditTopic\(\)\s*\{[\s\S]*?\/pages\/publish\/fabu\/index\?id='\s*\+\s*this\.data\.topicId/,
    '「去编辑主题」必须跳专业编辑器并带上当前主题 id',
  )
}

test('邀约发送失败时提供「去编辑主题」出路', () => {
  assertEditExit(read('pages/coop/invite/index.wxml'), read('pages/coop/invite/index.js'))
})

test('负控:摘掉出路绑定或跳错页面必须判红', () => {
  const wxml = read('pages/coop/invite/index.wxml')
  const js = read('pages/coop/invite/index.js')

  const unbound = wxml.replace('bindtap="goEditTopic"', 'bindtap="noop"')
  assert.notEqual(unbound, wxml, '负控锚点失效:出路绑定不存在')
  assert.throws(() => assertEditExit(unbound, js), assert.AssertionError)

  const wrongTarget = js.replace('/pages/publish/fabu/index?id=', '/pages/topic/index/index?id=')
  assert.notEqual(wrongTarget, js, '负控锚点失效:编辑器跳转不存在')
  assert.throws(() => assertEditExit(wxml, wrongTarget), assert.AssertionError)
})
