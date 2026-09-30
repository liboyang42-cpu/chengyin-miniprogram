const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('俱乐部新增运营页全部注册在既有 club 分包', () => {
  const app = JSON.parse(read('app.json'))
  const club = app.subPackages.find(item => item.root === 'pages/club')
  assert.ok(club)
  for (const page of [
    'event-ops/index',
    'notify/index',
  ]) {
    assert.ok(club.pages.includes(page), `${page} 必须注册，否则真机入口会跳转失败`)
  }
})

test('详情设置页放置活动运营和通知成员，并按真实权限收口', () => {
  const js = read('pages/club/detail/index.js')
  const wxml = read('pages/club/detail/index.wxml')

  assert.match(wxml, /club\.isOwner \|\| canManageActivities[^>]+bindtap="goEventOps"[^>]*>[\s\S]*?活动运营/)
  // 2026-08-26:canNotifyMembers 原来 = legacyCanGovern || has(notify:send),
  // 而 CLUB_LEGACY_ADMIN 在后端根本没有 NOTIFY_SEND —— 旧管理员看得见、点进去被拒。
  // 现在收成单一来源 canSendNotify(纯 has),并在这里钉死不许再走 legacy 兜底。
  assert.match(wxml, /club\.isOwner \|\| canSendNotify[^>]+catchtap="goClubNotify"[^>]*>[\s\S]*?通知成员/)
  assert.doesNotMatch(js, /canSendNotify\s*=\s*legacyCanGovern/, '通知能力不得吃 legacy 兜底')
  assert.doesNotMatch(wxml, /club\.viewerIsAdmin[^>]+bindtap="goEventOps"/, '活动运营不得靠旧管理员身份放行')
  assert.match(js, /goEventOps\(\)[\s\S]*?\/pages\/club\/event-ops\/index\?clubId=/)
  assert.match(js, /goClubNotify\(\)[\s\S]*?\/pages\/club\/notify\/index\?clubId=/)
  assert.doesNotMatch(wxml, /canOperateEvents[^>]+bindtap="goEventOps"/,
    '无 activityId 时 EVENT_OPERATE 不能冒充 activity:manage')
})

// 2026-09-09 用户裁决「会费暂时没有」:membership 两页整页删除,概览的会员与会费入口一并撤。
// 这条合同随之作废 —— 它守的是「总开关 fail-closed」,而现在压根没有这个功能可开。
// 留一句在这儿是因为将来做会费时要照它重建,而不是从零想一遍。
