'use strict'

// G2b 走查的界面侧修复:结算页缺行(CU-C-33)与活动编辑页的中文/编辑态文案(CU-C-102/103)。
//
// 三条都是「界面在说假话或什么都不说」:
//   · CU-C-33 同场次的集合点随 /api/activity/info 到了,结算页却从来没渲染过它 —— 用户在付钱那一屏
//     看不到自己要去哪集合;
//   · CU-C-102 主理人徽标写死英文 Owner,同一页其余文字全中文;
//   · CU-C-103 编辑已有活动的「保存」页写着「发布前摘要」和「发布后会在活动列表展示…」,
//     用户会以为保存 = 重新发布或改公开范围(后端 /api/activity/update 只改内容,不碰 publish_status)。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('CU-C-33:结算页补上所选票种的集合点,没填就整行不出', () => {
  const wxml = read('pages/activity/baoming/baoming.wxml')
  assert.match(wxml, /<view wx:if="\{\{selectedTicket\.meetingPoint\}\}" class="setbox_lb_li_top_con_dz">/,
    '集合点行必须由所选票种的 meetingPoint 驱动,且缺值时不渲染空行')
  assert.match(wxml, /集合点 · \{\{selectedTicket\.meetingPoint\}\}/)
  assert.match(wxml, /activityInfo\.address \|\| '待确认集合地点'/,
    '活动地址那一行是另一件事,不能被这行顶掉')
})

test('CU-C-102:合作者徽标说中文', () => {
  const wxml = read('pages/publish/activity/index.wxml')
  assert.match(wxml, /<view class="zw" wx:if="\{\{item\.isOwner==1\}\}">主理人<\/view>/)
  assert.doesNotMatch(wxml, />Owner</, '同一页其余标题/字段/按钮全中文,不混语言')
})

test('CU-C-103:编辑态的保存页只说本次保存的效果', () => {
  const wxml = read('pages/publish/activity/index.wxml')
  assert.match(wxml, /\{\{editingActivityId \? '修改摘要' : '发布前摘要'\}\}/)
  assert.match(wxml, /editingActivityId \? '本次保存只更新上面这些内容，不会改变活动的公开范围。'/)
  assert.match(wxml, /默认公开：发布后会在活动列表展示，继续即按当前公开范围发布。/,
    '新建活动那一路的口径保持不变')
})
