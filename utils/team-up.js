'use strict'

const { bizFailureMessage } = require('./response-shape.js')

function memberOptions(maxMembers) {
  const max = Math.max(2, Math.min(4, Number(maxMembers) || 4))
  const values = []
  for (let value = 2; value <= max; value++) values.push(value)
  return values
}

/* joinMode:1=仅邀请 2=公开申请制。
 * 2026-09-15 地图组队 P 方案:后端 PlayTeamServiceImpl.create 对 null 默认 2(公开),
 * 所以「默认公开」靠**不传**实现 —— 前端写死一个 2 只会多一个要跟着后端改的真源。
 * 只有宿主明确要「仅邀请」时才带上 1(1 / '1' / true 三种写法都认);
 * 其余取值一律当没传 —— 别把 0/'' /2 送进后端的枚举校验,也别在前端复制一份后端默认值。 */
function createActivityTeam(app, activityId, maxMembers, joinMode, callbacks) {
  const cb = callbacks || {}
  const body = { ownerType: 2, ownerId: Number(activityId), maxMembers: Number(maxMembers) }
  if (joinMode === 1 || joinMode === '1' || joinMode === true) body.joinMode = 1
  app.sendRequest({
    url: '/api/team/create',
    method: 'POST',
    data: JSON.stringify(body),
    header: { 'Content-Type': 'application/json' },
    success(res) {
      if (res && res.code == '200' && res.data && res.data.teamId) {
        if (cb.success) cb.success(res.data.teamId)
      } else if (cb.fail) {
        cb.fail(bizFailureMessage(res, '创建队伍失败，请稍后重试'))
      }
    },
    fail() {
      if (cb.fail) cb.fail('网络异常，请稍后重试')
    },
    complete() {
      if (cb.complete) cb.complete()
    }
  })
}

/* 2026-09-02:原来这里是 chooseAndCreate(),内部直接弹 wx.showActionSheet ——
 * 系统弹层在设计体系外(Do not use 页明令禁止),而且把「怎么问」焊死在工具函数里,
 * 宿主想换成 cy-option-sheet 都换不了。现在只出数据,弹层由宿主渲染:
 *   const sheet = teamUp.memberSheet(maxMembers)   // { options, items }
 *   <cy-option-sheet items="{{items}}" bind:select bind:cancel />
 *   select.detail.index -> options[index] -> createActivityTeam(app, id, members, joinMode, cb)
 * 取消由宿主接 cancel(对应原 showActionSheet 的 fail 分支,别漏 complete 回收)。 */
function memberSheet(maxMembers) {
  const options = memberOptions(maxMembers)
  return { options, items: options.map((value) => value + ' 人队伍') }
}

module.exports = { memberOptions, createActivityTeam, memberSheet }
