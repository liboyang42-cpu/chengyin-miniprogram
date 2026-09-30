// 2026-09-11 全量复查后的整改,每条都对应一个当时真在生产代码里的缺陷。
// 放一个文件里是因为它们共享同一个判据形状:**文案承诺的事,代码得真做到**。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('★主题详情:selfrun 的主键文案必须与它真正干的事一致', () => {
  const js = read('pages/club/topic-detail/index.js')
  // 原来是 primary: '去核销',而 onPrimary 对 selfrun 开的是结束活动确认层。
  // 读着像查看、点下去是写操作,这种错配比死按钮更危险。
  assert.match(js, /selfrun:\s*\{[^}]*primary:\s*'结束活动'/,
    'selfrun 的主键干的是结束活动,文案就得是结束活动')
  assert.doesNotMatch(js, /selfrun:\s*\{[^}]*primary:\s*'去核销'/)
  assert.match(js, /if \(key === 'running' \|\| key === 'selfrun'\) \{ this\.setData\(\{ directorEndConfirmShow: true \}\)/)
})

test('★主题详情:未通过的主题,「修改并重新提交」要排在导演台那道闸前面', () => {
  const js = read('pages/club/topic-detail/index.js')
  const body = js.slice(js.indexOf('  onPrimary() {'), js.indexOf('  // roles 每次刷新'))
  const rejectedAt = body.indexOf("key === 'rejected'")
  const gateAt = body.indexOf('!this._directorActivityId')
  assert.ok(rejectedAt > 0 && gateAt > 0, '两段都要在 onPrimary 里')
  assert.ok(rejectedAt < gateAt,
    '被拒的主题通常一场都没开,导演台对象不存在 —— 放闸后面等于永远只弹缺场次提示')
  assert.match(body, /if \(key === 'rejected'\) \{ this\.goEditTopic\(\); return; \}/)
  assert.match(body, /if \(key === 'ended'\) \{ this\.goSettlement\(\); return; \}/)
})

test('★引用卡的两个动作在三个宿主页都接上了(渲染了却没人接 = 死按钮)', () => {
  const card = read('components/cy/feed-play-card/index.wxml')
  assert.match(card, /catchtap="onPlay"/, '模板卡上确实有「试玩」这个按钮')
  for (const page of ['pages/club/detail/index.wxml', 'pages/talent/list/index.wxml']) {
    const wxml = read(page)
    assert.match(wxml, /bind:playdetail="onPostReference[A-Za-z]*"/, `${page} 要接住看详情`)
    assert.match(wxml, /bind:play="onPostReferencePlay"/, `${page} 要接住试玩,否则按钮点了没反应`)
  }
  assert.match(read('pages/square/list/index.wxml'), /bind:play="goPlay"/)
})

test('★达人页要能派生 variant,而且必须复用同一份判据', () => {
  const js = read('pages/talent/list/index.js')
  assert.match(js, /require\('\.\.\/\.\.\/\.\.\/utils\/feed-play-card\.js'\)/)
  assert.match(js, /isCompletionShare: isCompletedShare\(ref\)/)
  assert.match(js, /hasPlayCover: hasFeedPlayCover\(ref\)/)
  assert.doesNotMatch(js, /function\s+(isCompletedShare|hasFeedPlayCover)\s*\(/, '不许写第二套判据')
  // 后端不投影的话,前端派生出来也是空壳
  const controller = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiClubController.java')
  const feed = controller.slice(controller.indexOf('@PostMapping("/post/feed")'))
  assert.match(feed.slice(0, 2000), /projectPostReferences\(posts\);/,
    '聚合流也要投影引用,否则达人页拿不到 sportName,卡片永远不出现')
})

test('★入会审批那句文案要跟后端判据一致(后端不是 owner-only)', () => {
  const wxml = read('components/cy/scene-club-edit/index.wxml')
  assert.doesNotMatch(wxml, /只有主理人可通过或拒绝申请/,
    'canApproveMembers 放行主理人 / role=1 管理员 / 被委派 club:member:approve 三种人')
  assert.match(wxml, /开启后，新申请要等主理人或管理员通过/)
  const service = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/ClubMemberServiceImpl.java')
  const fn = service.slice(service.indexOf('private boolean canApproveMembers'))
  assert.match(fn.slice(0, 1200), /canGovernClub/)
  assert.match(fn.slice(0, 1200), /ClubPermission\.MEMBER_APPROVE/)
})

test('★商家联系方式只下发给要对接的人,不给每一个普通成员', () => {
  const service = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/ClubChapterRecruitServiceImpl.java')
  assert.match(service, /if \(canManage && audit != null && audit == NODE_APPROVED && merchant != null\) \{\s*item\.put\("phone"/,
    '接口门槛是 ACTIVITY_READ,而普通成员就带这一条 —— 手机号必须另跟 ACTIVITY_MANAGE')
  assert.match(service, /nodeRows\(nodesOf\(topicId\), canManage\)/)
})
