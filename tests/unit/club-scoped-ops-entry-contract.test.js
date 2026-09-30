const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('待带队场次以真实 activityId 打开现场名册、场次角色和本场通知', () => {
  const js = read('pages/club/detail/index.js')
  const wxml = read('pages/club/detail/index.wxml')

  assert.match(wxml, /catchtap="openActivityTools"[^>]*data-id="\{\{item\.id\}\}"/)
  assert.match(js, /openActivityTools\(e\)[\s\S]*?\/api\/topic\/info-to-user/)
  assert.match(js, /listGroupCodeActivities\([\s\S]*?activityList/)
  assert.match(js, /route:\s*['"]\/pages\/club\/event-ops\/index\?clubId=['"]\s*\+\s*clubId\s*\+\s*['"]&activityId=['"]\s*\+\s*id/)
  assert.match(js, /route:\s*['"]\/pages\/club\/roles\/index\?clubId=['"]\s*\+\s*clubId\s*\+\s*['"]&activityId=['"]\s*\+\s*id/)
  assert.match(js, /route:\s*['"]\/pages\/club\/notify\/index\?clubId=['"]\s*\+\s*clubId\s*\+\s*['"]&activityId=['"]\s*\+\s*id/)
  assert.match(js, /club\.isOwner \|\| this\.data\.canManageActivities \|\| this\.data\.canOperateEvents/)
})

test('俱乐部、活动、成员举报与封禁申诉都从公开详情可达平台治理模式', () => {
  const js = read('pages/club/detail/index.js')
  const wxml = read('pages/club/detail/index.wxml')

  assert.match(wxml, /catchtap="reportClubMember"[^>]*data-member-id="\{\{item\.memberId\}\}"/)
  assert.match(wxml, /catchtap="reportClub"[\s\S]*?举报俱乐部/)
  assert.match(wxml, /catchtap="reportTopicActivity"[^>]*data-id="\{\{item\.id\}\}"[\s\S]*?举报活动/)
  assert.match(wxml, /bindtap="goClubAppeal"[\s\S]*?封禁申诉/)
  assert.match(js, /reportClubMember\(e\)[\s\S]*?mode=report&targetMemberId=/)
  assert.match(js, /reportClub\(\)[\s\S]*?targetType=CLUB[\s\S]*?targetId=/)
  assert.match(js, /reportTopicActivity\(e\)[\s\S]*?\/api\/topic\/info-to-user/)
  assert.match(js, /reportActivity\(activityId, activityName\)[\s\S]*?targetType=ACTIVITY[\s\S]*?targetId=/,
    'CU-C-82:场次举报入口多带一个显示名,目标类型/ID 的写法不变')
  assert.match(js, /goClubAppeal\(\)[\s\S]*?mode=appeal/)
})

test('场次委派只按 eventAccesses 的 activityId 开工具，不把一场权限扩成全团权限', () => {
  const js = read('pages/club/detail/index.js')

  assert.match(js, /eventAccesses/)
  assert.match(js, /eventAccessByActivity/)
  assert.match(js, /hasEventScope/)
  // CU-C-57:入口多带一个「活动名 · 开始时间」,第一个参数仍是 activityId,门控判据不变
  assert.match(js, /chooseActivityTool\(activityId, activityLabel\)[\s\S]*?_eventAccessByActivity[\s\S]*?\[String\(id\)\]/)
  assert.doesNotMatch(js, /data:\s*\{[\s\S]*?eventAccessByActivity:/,
    '场次授权索引只作为页面实例内部状态，不能通过 setData 进入渲染层')
  assert.match(js, /eventPermissions\.indexOf\('club:event:checkin'\)/)
  assert.match(js, /eventPermissions\.indexOf\('club:event:operate'\)/)
})
