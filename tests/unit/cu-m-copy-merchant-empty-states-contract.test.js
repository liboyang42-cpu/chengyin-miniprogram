// 2026-09-24 走查批次 copy-merchant:财务/合作/优惠券/售后/结算这一批空态的文案契约。
//
// 这一批的毛病是同一型的:弹层/页面已经有标题,空态再写一句「暂无 XX」+ 一句把标题换个说法
// 重念的说明,同屏三次重复主题;其中几句还把平台内部口径(审核、核销、落库)写给商家看。
// 用户 9-18 走查已定过「空态不写『暂无』」,所以这里既钉住新文案,也钉住旧文案不许回来。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

// 源码注释里会原样引用被删掉的旧文案(那是「为什么删」的说明),断言只看真正渲染的部分。
function readWxml(relativePath) {
  return read(relativePath).replace(/<!--[\s\S]*?-->/g, '')
}

function readWxss(relativePath) {
  return read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '')
}

// CU-M-122:提现记录弹层标题由宿主出(scene-registry 的「提现记录」),屏上只许再有一行。
test('CU-M-122 提现记录弹层空态只留一行,不再重复标题', () => {
  const wxml = readWxml('components/cy/scene-member-withdraw-history/index.wxml')
  assert.match(wxml, /<cy-empty\b[^>]*title="还没有发起提现"[^>]*\/>/)
  assert.doesNotMatch(wxml, /暂无提现记录/)
  assert.doesNotMatch(wxml, /提现记录会显示在这里/)
})

// CU-M-122:收益明细的四个筛选各说各的空态,不许再用一句「当前筛选暂无收益记录」糊过去。
test('CU-M-122 收益明细空态按筛选给一句话,不带重复说明', () => {
  const wxml = readWxml('components/cy/scene-asset-income-detail/index.wxml')
  const js = read('components/cy/scene-asset-income-detail/index.js')
  assert.match(wxml, /title="\{\{emptyTitle\}\}"/)
  assert.doesNotMatch(wxml, /当前筛选暂无收益记录|暂无收益记录|产生收益后，明细会显示在这里/)
  assert.match(js, /emptyTitle: '还没有收益记录'/)
  assert.match(js, /\+ '还没有收益'/)
})

test('CU-M-122 分润与结算空态删去重复说明,不再写「暂无」', () => {
  const profit = readWxml('components/cy/scene-merchant-profit/index.wxml')
  assert.match(profit, /title="还没有合作结算"/)
  assert.doesNotMatch(profit, /完成合作结算后，收入明细会显示在此/)
  assert.doesNotMatch(profit, /暂无已入账分润/)
  assert.match(profit, /还没有已入账分润/)

  const ledger = readWxml('pages/merchant/ledger/index.wxml')
  assert.doesNotMatch(ledger, /待主题结算的履约会留在核销记录中/)
  assert.doesNotMatch(ledger, /批次成立后会显示打款与开票状态/)
  assert.match(ledger, /title="还没有已成立的收入明细"/)
  assert.match(ledger, /title="还没有对公结算批次"/)
})

// CU-M-134:合作两页 + 城市节点认领的三处空态。
test('CU-M-134 合作空态压成一行并保留真动作', () => {
  const coop = readWxml('pages/merchant/coop-center/index.wxml')
  assert.match(coop, /title="还没有官方活动"/)
  assert.doesNotMatch(coop, /暂无官方活动|平台开放新的官方活动后会显示在这里/)
  assert.match(coop, /title="还没有开放的路线"/)
  assert.doesNotMatch(coop, /暂无开放路线/)

  const invite = readWxml('pages/coop/invite/index.wxml')
  assert.match(invite, /title="还没有可邀请的俱乐部"/)
  assert.doesNotMatch(invite, /暂无可对接的俱乐部|平台还没有开放合作的俱乐部/)

  const citynode = readWxml('pages/merchant/citynode/index.wxml')
  assert.match(citynode, /title="还没有可认领的节点"/)
  assert.doesNotMatch(citynode, /暂无可认领节点/)
})

// CU-M-142:优惠券用途只在页标题副文案写一次,空态不再重复,也不再指一遍屏上的按钮。
test('CU-M-142 优惠券空态不重复券的用途说明', () => {
  const wxml = readWxml('subpackageMember/coupon/coupon.wxml')
  const empties = (wxml.match(/<cy-empty\b[^>]*\/>/g) || []).filter((tag) => /title="还没有优惠券"/.test(tag))
  assert.equal(empties.length, 1)
  assert.doesNotMatch(empties[0], /\bsub=/)
  // RUN-009 / D-006：移除结构介绍，空态保持简洁。
  assert.equal((wxml.match(/可用于主题、节点与到店核销/g) || []).length, 0)
})

// CU-M-152:三个分段共用同一句平台审核口径 ⇒ 只留分段标题。
test('CU-M-152 退款售后空态不再重复平台审核口径', () => {
  const wxml = readWxml('pages/merchant/aftercare/index.wxml')
  assert.doesNotMatch(wxml, /退款申请会按平台审核与款项真实状态显示在这里/)
  const empties = (wxml.match(/<cy-empty\b[^>]*\/>/g) || []).filter((tag) => /没有待回应售后/.test(tag))
  assert.equal(empties.length, 1)
  assert.doesNotMatch(empties[0], /\bsub=/)
})

// CU-M-123:「消息入口保留为兼容模式」是内部实现说明;而这一路没有任何动态数据源,
// 于是整块「经营动态」标题一起摘掉,只留真正可点的站内消息入口。
test('CU-M-123 消息与动态不再展示内部兼容模式说明,也不留空标题块', () => {
  const wxml = readWxml('pages/merchant/ledger/index.wxml')
  const wxss = readWxss('pages/merchant/ledger/index.wxss')
  assert.doesNotMatch(wxml, /兼容模式/)
  assert.doesNotMatch(wxml, /经营动态/)
  assert.match(wxml, /<text class="ledger-action-title">站内消息<\/text>/)
  assert.doesNotMatch(wxss, /\.ledger-heading|\.heading-sub/)
})

// CU-M-107:票种空态固定写「主理人」,活动也可以由商家主办 —— 商家看自己主办的活动,
// 被指向一个与自己无关的角色。本场景没有主办身份字段,统一说「主办方」。
test('CU-M-107 活动票种空态不再把责任固定指向主理人', () => {
  const wxml = readWxml('components/cy/scene-play-activity-detail/index.wxml')
  assert.match(wxml, /主办方还没有发布可报名票种/)
  assert.doesNotMatch(wxml, /主理人还没有发布可报名票种/)
})

// CU-M-178:「过微信内容安全再落库」是后端审核与存储步骤,不是商家要看的产品说明。
test('CU-M-178 作品命名不再写内部实现用语', () => {
  const wxml = readWxml('pages/publish/temp/index.wxml')
  assert.match(wxml, /<view class="cg-rw-sub">作品名称提交后需审核<\/view>/)
  assert.doesNotMatch(wxml, /内容安全|落库/)
})

// CU-M-170:公开口碑页原本只要不可评价就把整张准入规则卡常驻在列表上方;
// 已有评价时,访客只想看口碑,却被后台规则把列表下推。
test('CU-M-170 公开口碑的资格说明只在没有评价时出现', () => {
  const wxml = readWxml('pages/merchant/reviews/index.wxml')
  assert.match(wxml, /wx:elif="\{\{mode === 'public' && !items\.length\}\}"[^>]*class="review-eligibility-note"/)
  assert.doesNotMatch(wxml, /核销被撤销的不能评价/)
})
