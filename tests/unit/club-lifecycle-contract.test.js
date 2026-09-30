const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DANGER_ACTIONS } = require('../../utils/danger-actions.js')

const root = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('俱乐部详情读取真实入会策略，并仅向主理人或获授权审批角色展示待审入口', () => {
  const js = read('pages/club/detail/index.js')
  const wxml = read('pages/club/detail/index.wxml')

  assert.match(js, /joinPolicyText\s*=\s*Number\(club\.joinPolicy\)\s*===\s*1\s*\?\s*'需审批'\s*:\s*'公开'/)
  assert.match(wxml, /\{\{club\.joinPolicyText\}\}/)
  // 2026-08-26 管理 tab 收敛:入会申请 / 成员管理 / 报名名册 / 项目工具 / 解散
  // 从管理 tab 整体搬进右上角齿轮的「俱乐部设置」弹窗；细粒度审批角色也按 access/me 开门。
  assert.match(wxml, /wx:if="\{\{club\.isOwner \|\| canApproveMembers\}\}"[^>]*catchtap="goJoinRequests"/)
  assert.match(wxml, /\{\{club\.pendingJoinRequestCount\}\}/)
  assert.match(wxml, /wx:if="\{\{club\.pendingJoinRequestCount > 0\}\}"/, '有待审时必须给出可见提示')

  const manageStart = wxml.indexOf("activeTab === 'manage' && (club.isOwner || canUseManageTab)")
  const requestEntry = wxml.indexOf('catchtap="goJoinRequests"')
  assert.ok(manageStart >= 0 && requestEntry > manageStart, '入会申请入口必须归入齿轮设置弹窗')
  assert.equal(wxml.slice(0, manageStart).includes('goJoinRequests'), false, '概览等普通 tab 不得重复暴露审批入口')

  // 管理 tab/齿轮统一消费 canUseManageTab；它同时承接 detail 权威 viewerIsAdmin
  // 与 access/me 细粒度角色，绝不能直接读取成员行里的 role 数字猜权限。
  assert.match(wxml, /class="cover-nav-act"[^>]*bindtap="onSettings"[^>]*wx:if="\{\{club && \(club\.isOwner \|\| canUseManageTab\)\}\}"/)
  assert.match(js, /canGovern\(club\)[\s\S]*c\.isOwner \|\| c\.viewerIsAdmin/)
  assert.match(js, /canUseManageTab:\s*legacyCanGovern/,
    'detail 权威确认的 legacy 管理员必须在 access\/me 回读前后保留治理入口')
  // 2026-09-09 用户裁决整页删除「探店日质量证据」,这条断言随入口一并撤。
  // ⚠️ 它原来守的是「质量证据是 owner-only」;现在全仓没有任何交证据的入口,
  // Q 结算靠什么算要产品那边给结论 —— 不是这条测试能替谁决定的事。
  assert.doesNotMatch(wxml, /goEditionReport/, '质量证据页已删,不许留下指向它的死入口')
  assert.match(wxml, /<cy-sheet show="\{\{settingsShow\}\}"[^>]*title="俱乐部设置"/)
})

test('审批制加入停在待审态，不误导进入群聊', () => {
  const js = read('pages/club/detail/index.js')
  const wxml = read('pages/club/detail/index.wxml')

  assert.match(js, /res\.data\s*&&\s*res\.data\.state\s*===\s*'pending'/)
  assert.match(js, /申请已提交/)
  // CU-C-133:申请人在等待的是「有权限的成员」,不止主理人 —— 钉死"谁在审"会误导,
  // 所以只钉它停在待审态、不谎称已加入。
  assert.match(js, /等待审核/)
  assert.doesNotMatch(js, /等待主理人审核/)
  assert.match(wxml, /club\.myJoinStatus\s*===\s*0/)
  assert.match(wxml, /等待审核/)
  assert.doesNotMatch(wxml, /等待主理人审核/)
})

test('旧 role 数字不能绕过后端，但 detail 权威管理员与新权限都保持可治理且 fail-closed', () => {
  const js = read('pages/club/detail/index.js')
  const wxml = read('pages/club/detail/index.wxml')

  assert.match(js, /membersState:\s*'business-error'/)
  assert.match(js, /members:\s*\[\],\s*membersState:\s*'loading'/)
  assert.match(js, /members:\s*\[\],\s*membersState:\s*'business-error'/)
  assert.match(js, /members:\s*\[\],\s*membersState:\s*'network-error'/)
  assert.doesNotMatch(js, /myIsAdmin/, '旧成员 role 不再作为页面权限真源')
  assert.doesNotMatch(js, /\.role\s*==?=?\s*1[\s\S]{0,80}(?:canGovern|canUseManageTab)/,
    '不得从成员行 role=1 直接推导治理权，legacy 管理员只认 detail.viewerIsAdmin')
  assert.match(js, /c\.isOwner \|\| c\.viewerIsAdmin/,
    '后端 detail 已确认的 viewerIsAdmin=true 必须保留治理 UI')
  assert.match(wxml, /club\.viewerIsAdmin[\s\S]*管理员工具暂不可用/)
  assert.match(wxml, /club\.viewerIdentityUnavailable[\s\S]*成员身份暂时无法确认/)
  assert.match(js, /revokeClubAccess\(state(?:,\s*keepRequest)?\)[\s\S]*clubAccessState:\s*state \|\| 'error',[\s\S]*canModerateContent:\s*false/)
  assert.match(js, /this\.revokeClubAccess\('loading'(?:,\s*true)?\)/)
  assert.match(js, /that\.revokeClubAccess\('error'(?:,\s*true)?\)/)
  assert.match(js, /const canManageClub = has\('club:write'\)/)
  assert.match(wxml, /clubAccessState === 'error'[\s\S]*内容治理入口已安全关闭/)
  assert.doesNotMatch(wxml, /myIsAdmin \|\| item\.authorMemberId/)
})

test('编辑弹窗仅主理人可见 danger 解散入口，并发送两层确认事实', () => {
  const js = read('components/cy/scene-club-edit/index.js')
  const wxml = read('components/cy/scene-club-edit/index.wxml')

  // 2026-09-02:解散钮从底栏的 cy-btn variant="danger" 换成「危险操作」区块里的整宽描边胶囊。
  // 断言改钉**结构事实**(owner 门 + danger 视觉档 + 绑到 dissolveClub),不再钉某个组件属性 ——
  // 要守住的是「只有主理人看得到、且这个入口真的通向解散」,不是它用哪个按钮组件。
  const dangerZone = wxml.match(/wx:if="\{\{isOwner\}\}"([\s\S]*?)<\/block>/g) || []
  assert.ok(
    // ⚠️ 原判据是「区块里任意一处 class 含 danger」—— 那被同区块的 danger-label /
    //    danger-card / danger-title 兜住了:把按钮本身的 class 改成 plain-btn 断言照样绿,
    //    等于宣称守着「danger 视觉档」其实没守。改成钉**那个绑了 dissolveClub 的元素自己**
    //    的 class 必须含 danger,并且它自己要带禁用态(否则就是视觉禁用但仍可点)。
    dangerZone.some((block) => {
      const el = /<view([^>]*bindtap="dissolveClub"[^>]*)>/.exec(block)
      return !!el && /class="[^"]*danger[^"]*"/.test(el[1])
        && /aria-disabled=/.test(el[1]) && /解散俱乐部/.test(block)
    }),
    'isOwner 区块内必须有一个自身 class 含 danger、带禁用态、绑 dissolveClub 的解散入口'
  )
  assert.match(js, /url:\s*'\/api\/club\/dissolve'/)
  assert.match(js, /dissolveConfirmed:\s*true/)
  assert.match(js, /memberConsequencesConfirmed/)

  // 2026-08-27:确认文案从这个组件的两屏自建 cy-sheet 搬进了 utils/danger-actions.js
  // 的登记表(全站危险动作统一三段式),所以断言改成对着登记表读 —— 要说清的事实一条没少:
  // ①成员失去俱乐部与群聊入口 ②已报名不自动取消也不自动退款 ③写明此操作不可撤销。
  assert.match(wxml, /<cy-danger-confirm[^>]*bind:confirm="onConfirmDissolve"/)
  const dissolve = DANGER_ACTIONS['club.dissolve']
  const consequenceText = dissolve.consequences.map(item => item.text).join('\n')
  assert.match(consequenceText, /成员.*(移出|失去)[\s\S]*群聊入口/)
  assert.match(consequenceText, /已报名的不会自动取消，?也不会自动退款|已报名.*不.*自动.*退款/)
  assert.match(consequenceText, /此操作不可撤销/)
  // 更轻的替代方案必须在同一屏给出,否则用户只有「解散」这一条路
  assert.ok(dissolve.alt && /转让主理人/.test(dissolve.alt.text), '解散必须给出转让主理人的替代方案')
  assert.match(js, /res\.data\s*&&\s*Array\.isArray\(res\.data\.actionItems\)/)
  assert.match(js, /showDissolutionBlockers:\s*true/)
  // 2026-09-06 dissolution-blockers 页已删:阻塞项不再原样 navigateTo(item.url),按 type 就地承接(押金重试退款 / 结算页)
  assert.match(js, /openDissolutionBlockerItem\(e\)[\s\S]{0,400}?resolveDissolutionBlockerTarget\(item\.url\)/)
  assert.doesNotMatch(js, /wx\.showModal\s*\(/)
})

test('入会申请页已注册，且通过与拒绝调用真实状态机接口', () => {
  const appJson = read('app.json')
  const js = read('pages/club/join-requests/index.js')
  const wxml = read('pages/club/join-requests/index.wxml')

  assert.match(appJson, /"join-requests\/index"/)
  assert.match(js, /\/api\/club\/join-requests/)
  assert.match(js, /\/api\/club\/join-request\/approve/)
  assert.match(js, /\/api\/club\/join-request\/reject/)
  // 副标题改成按待审条数生成(buildIntro),所以钉「这句话对谁成立」这条事实 ——
  // CU-C-133 实证:后端 canApproveMembers 放行主理人、role=1 管理员**和被委派
  // club:member:approve 的成员**。任何数名单的写法都漏一档,所以文案只报动作。
  assert.match(wxml, /class="intro">\{\{introText\}\}</)
  // ⚠️ 原断言钉的是「仅主理人可处理」,上一版钉的是「主理人与管理员可处理」——
  //    两句都是把一部分能按的人挡在门外,钉进契约等于把 bug 焊死。改钉两件事:
  //    (a) buildIntro 的返回只报动作,不再数谁能处理;
  //    (b) 全文不得再出现任何「只有/仅 X 可处理」式的名单口径。
  //    ⚠️ 只断言 js 里出现某串会被 data 默认值 introText 兜住 —— 必须钉 buildIntro 的返回。
  const buildIntro = /buildIntro\(count\)\s*\{[\s\S]*?\n  \},/.exec(js)
  assert.ok(buildIntro, '找不到 buildIntro —— 副标题的真源换地方了')
  assert.match(buildIntro[0], /可直接通过或拒绝/,
    '副标题必须只报动作:能打开本页的人一律按得动(access-gate 拦在 club:member:approve)')
  assert.doesNotMatch(buildIntro[0], /主理人/,
    'CU-C-133:数「谁能处理」的名单会排掉被委派的成员,别再把它写回文案')
  // ⚠️ 判据先剥注释再扫:解释这次更正的注释里必然出现那句错文案,
  //    按原文扫会把注释判成违规(本轮第五次踩「锚点钉字面量」)。
  const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(jsCode, /仅主理人可处理/,
    '与后端行为不符:管理员进得来也按得动,这句话会骗人')
})
