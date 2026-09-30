'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const matrix = require('../../scripts/uiaudit/route-matrix.json')
const {
  build,
  inventoryMatchesCurrent,
} = require('../../scripts/uiaudit/build-route-matrix')

test('route-matrix 生成物必须与当前 app.json 和 scene 扫描逐字一致', () => {
  const current = build()
  // 135 → 134:pages/club/game-director 整页删除、路由注销(十张卡收编进活动详情页)
  // 134 → 129:2026-09-06 孤儿页清理,stopwatch/play、decor/ai-npc、merchant/discover、
  //   club/dissolution-blockers、publish/biaoqian 五页注销。
  /* 2026-09-08 +1:新增 pages/coop/invite-detail(Figma 02d-1~5 协作详情整页)。 */
  /* 2026-09-08 +1:新增 pages/club/checkin-detail(Figma K3 俱乐部端核销详情)。 */
  /* 2026-09-09 −3:会费两页(club/membership/setting、club/membership/status)与
  // 129 → 130:2026-09-05 新增 subpackageRoam/nearby(漫游·附近的局)
  // 130 → 131:2026-09-09 新增 subpackageRoam/citystamp(投一张换一张)。
  //   放在分包而不是主包:信箱那张实物图 37KB,主包资源棘轮只准降。
  /* 2026-09-11 并 github/master:本分支 +2 页(nearby / citystamp),master +2 页(coop/invite-detail、
     club/checkin-detail)−3 页(会费两页与探店日质量证据整页删除)⇒ 129+2+2−3 = 130。
  2026-09-12 rebase github/master(#1062 玩法壳)后 131；本 PR 退役 subpackageTalent/search ⇒ 131−1 = 130。 */
  /* 2026-09-16 −1:孤儿页 pages/coop/candidates 整页删除 ⇒ 130−1 = 129(按脚本重建实测)。 */
  /* 2026-09-17 −1:B-06 孤儿页 pages/topic/pricing/partner 整页删除 ⇒ 129−1 = 128(按脚本重建实测)。 */
  /* 2026-09-19 +1:批复1-a=2 用户裁决 partner 页复活并接进定价页「合作阵容」⇒ 128+1 = 129(按脚本重建实测)。 */
  /* 2026-09-20 +1:预制人生独立游戏分包页,票夹直达。 */
  /* 2026-09-22 +1:Phase 0 物品卡实验室页 subpackageP3/pages/object-card-lab(立体藏品卡闸口页)。 */
  /* 2026-09-22 +1:Phase 3 藏品册页 subpackageP3/pages/object-cards/index(玩家侧卡片墙,个人页入口)。 */
  /* 2026-09-24 −1:Phase 0 实验室页随正式页接进玩法删除 ⇒ 132−1 = 131(按脚本重建实测)。 */
  assert.equal(current.routes.length, 131)
  assert.equal(matrix.counts.routes, 131)
  // 2026-09-02:+2 俱乐部客户列表与客户详情(club/customers、club/customer-detail)
  assert.equal(inventoryMatchesCurrent(matrix), true)
  // 2026-09-04 导演台整页收编:锚点换成新宿主页 topic-detail。这条要证的是
  //   「俱乐部页必须判 club 角色 + 需登录 + 认得出路由参数」,意图一字未改;
  //   activityId 仍在 dataKeys 里 —— 从场次进来才带,正是导演台那条路。
  const club = matrix.routes.find((route) => route.pagePath === 'pages/club/topic-detail/index')
  const merchant = matrix.routes.find((route) => route.pagePath === 'pages/merchant/game-node/index')
  assert.deepEqual({ role: club.role, needsLogin: club.needsLogin, dataKeys: club.dataKeys }, {
    role: 'club', needsLogin: true, dataKeys: ['topicId', 'clubId', 'activityId'],
  })
  assert.deepEqual({ role: merchant.role, needsLogin: merchant.needsLogin, dataKeys: merchant.dataKeys }, {
    role: 'merchant', needsLogin: true, dataKeys: ['activityId', 'nodeId'],
  })
})

test('route-matrix 少一页或角色被改写必须判为过期', () => {
  const missingRoute = JSON.parse(JSON.stringify(matrix))
  missingRoute.routes.pop()
  missingRoute.counts.routes -= 1
  assert.equal(inventoryMatchesCurrent(missingRoute), false)

  const wrongRole = JSON.parse(JSON.stringify(matrix))
  wrongRole.routes.find((route) => route.pagePath === 'pages/club/checkin-detail/index').role = 'player'
  assert.equal(inventoryMatchesCurrent(wrongRole), false)
})
