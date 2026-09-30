'use strict'

// 全量场景弹窗注册表。
// 37 个路由仍保留给深链/分享使用；站内入口只通过五个宿主的 sceneStack 打开。
// 这里只登记承载契约，不伪造页面数据；正文由各场景内容组件/宿主状态提供。
const SCENES = {
  'roam-rules': { route: '/pages/roam/index', title: '自由漫游怎么玩', theme: 'player', variant: 'half', maskClosable: true },
  // 宿主页内的三个可关闭面板。正文仍写在宿主 wxml 里(同 roam-rules),但 show 由场景栈决定 ——
  // 否则它们能和 sceneCurrent 同屏渲两个 scene-sheet,违反 §4.1「一个宿主同时只有一个 scene-sheet」。
  // 漫游的工具抽屉(原型 f-more 的 drawer)与它通向的设置页(原型 setScreen)。
  // 三键左边那枚「更多」拉的就是它 —— 原型四个模式共用同一套抽屉与设置页。
  // ⚠️ variant 只认 half/full:写 'drw' 会被 normalizeScene 吞成 full(契约有断言)。
  //    抽屉的「从 330px 起」由宿主那层壳直接挂 .psheet--drw 表达,不新造档位。
  'roam-more': { route: '/pages/roam/index', title: '更多', theme: 'player', variant: 'half', maskClosable: true },
  'roam-settings': { route: '/pages/roam/index', title: '设置', theme: 'player', variant: 'half', maskClosable: true, canBack: true },
  // 点地图上别人的头像(原型 f-other-a / f-other-b 的 otherSheet)。正文写在宿主 wxml 里,
  // 数据在 data.runnerView —— 和 roam-rules 一样,注册表只承载弹层契约。
  'roam-runner': { route: '/pages/roam/index', title: 'TA 的漫游', theme: 'player', variant: 'half', maskClosable: true },
  'roam-location-picker': { route: '/pages/roam/index', title: '漫游定位', theme: 'player', variant: 'half', maskClosable: true },
  'roam-share': { route: '/pages/roam/index', title: '分享本次漫游', theme: 'player', variant: 'full', maskClosable: true },
  'play-session-tools': { route: '/pages/play/index', title: '游玩工具', theme: 'player', variant: 'half', maskClosable: true },
  // member / merchant / shezhi 三个宿主的页内菜单与选择器,同上收进栈。
  // theme 在 member 两个面板上仍由 wxml 按 isMerchantView 动态给(注册表存不下随身份变的主题),
  // 这里的 theme 只作默认值。
  'settings-identity-picker': { route: '/pages/shezhi/shezhi', title: '选择要申请的身份', theme: 'player', variant: 'half', maskClosable: false },
  'merchant-more-menu': { route: '/pages/merchant/index/index', title: '更多', theme: 'merchant', variant: 'half', maskClosable: false },
  'merchant-chapter-picker': { route: '/pages/merchant/index/index', title: '选择要核销的章节', theme: 'merchant', variant: 'half', maskClosable: true },
  'merchant-station-picker': { route: '/pages/merchant/index/index', title: '选择要核销的据点', theme: 'merchant', variant: 'half', maskClosable: true },
  'merchant-verification-result': { route: '/pages/merchant/index/index', title: '操作结果', theme: 'merchant', variant: 'half', maskClosable: true },
  'member-more-menu': { route: '/pages/member/index/index', title: '选项', theme: 'player', variant: 'half', maskClosable: true },
  'member-chapter-picker': { route: '/pages/member/index/index', title: '选择要核销的章节', theme: 'player', variant: 'half', maskClosable: true },
  'member-station-picker': { route: '/pages/member/index/index', title: '选择要核销的据点', theme: 'player', variant: 'half', maskClosable: true },
  'points-tasks': { route: '/pages/member/index/index', title: '积分任务', theme: 'player', variant: 'half', maskClosable: true },
  // G01-G12 游戏内二级场景
  'play-activity-detail': { route: '/pages/activity/detail/index', title: '活动详情', theme: 'player', variant: 'full' },
  'roam-task-list': { route: '/pages/activity/list/index', title: '官方活动', theme: 'player', variant: 'full' },
  // 据点的最终宿主是薄深链壳,不是商家页:poiId 是 cityNodeId,与 merchantId 不是一个东西。
  // 这个 route 就是站外稳定深链,改它会让历史转发卡片/收藏落空(见设计文档 §3.9)。
  'roam-poi-detail': { route: '/subpackageRoam/poi-detail/index', title: '据点详情', theme: 'player', variant: 'full' },
  // 2026-09-06 路由页 pages/merchant/discover 已删(无人跳转),场景只在 roam/play 宿主内打开,不再有独立 route。
  'roam-discover': { title: '发现附近店铺', theme: 'player', variant: 'full' },
  // ⚠️ 漫游域(subpackageRoam)由用户本人维护,本次半屏收口**不动它**:
  //   · roam-passport 已在 master 下线,这条分支想把它加回来 —— 不加
  //   · roam-history 保持 full,不改 variant
  'roam-history': { route: '/subpackageRoam/history/index', title: '漫游历史', theme: 'player', variant: 'full' },
  'roam-session': { route: '/subpackageRoam/session/index', title: '本次漫游', theme: 'player', variant: 'full', canBack: true },
  'game-coupon-wallet': { route: '/subpackageMember/coupon-wallet/index', title: '优惠券', theme: 'player', variant: 'half' },
  'qr-coupon': { route: '/subpackageMember/coupon-qr/index', title: '出示核销码', theme: 'player', variant: 'full', canBack: true },
  'qr-group-code': { route: '/pages/club/group-code/index', title: '团核销码', theme: 'player', variant: 'full', canBack: true },
  'qr-citynode': { route: '/subpackageRoam/citynode-code/index', title: '据点核销码', theme: 'player', variant: 'full', canBack: true },
  'qr-ticket': { route: '/pages/play/index', title: '入场码', theme: 'player', variant: 'full', canBack: true },
  'roam-stamp-album': { route: '/subpackageP3/pages/stamp-album/index/index', title: '集邮册', theme: 'player', variant: 'full' },

  // ⚠️ 以下三条是 master 在本分支切出之后新增的,cherry-pick 会静默把它们吞掉。
  //   merchant-profit 来自 #604(分润记录标出收款方);两条 participation 是「参与详情=场景」
  //   的现行设计,#634 还在这条链上接了据点选择。本次半屏收口**不动它们**。
  'merchant-profit': { route: '/pages/coop/finance/index', title: '分润明细', theme: 'merchant', variant: 'full' },
  'member-participation-history': { route: '/subpackageMember/mycanyu/mycanyu', title: '我的参与', theme: 'player', variant: 'full' },
  'member-participation-detail': { route: '/subpackageMember/mycanyuinfo/mycanyuinfo', title: '参与详情', theme: 'player', variant: 'full', canBack: true },
  // H01-H12 收益、明细、订单与历史
  'asset-earnings': { route: '/subpackageA/pages/assetcenter/earnings/index', title: '账户收益', theme: 'player', variant: 'full' },
  'asset-income-detail': { route: '/subpackageA/pages/assetcenter/income-detail/income-detail', title: '收益明细', theme: 'player', variant: 'half' },
  'member-withdraw': { route: '/subpackageMember/tixian/tixian', title: '提现', theme: 'player', variant: 'full', form: true, maskClosable: false, footer: true },
  'member-withdraw-history': { route: '/subpackageMember/tixianjilu/tixianjilu', title: '提现记录', theme: 'player', variant: 'half' },
  'member-invite-history': { route: '/subpackageMember/myinvite/myinvite', title: '邀请记录', theme: 'player', variant: 'half' },
  'member-order-history': { route: '/subpackageMember/order/order', title: '我的订单', theme: 'player', variant: 'half' },
  'member-order-detail': { route: '/subpackageMember/orderinfo/orderinfo', title: '订单详情', theme: 'player', variant: 'half' },

  // S01-S13 设置三级/四级
  'settings-how-to-play': { route: '/subpackageA/pages/infomation/infomation', title: '城瘾玩法', theme: 'player', variant: 'half' },
  'settings-how-to-play-detail': { route: '/subpackageA/pages/infomationdetail/infomationdetail', title: '玩法详情', theme: 'player', variant: 'half' },
  'settings-profile': { route: '/pages/gerenziliao/gerenziliao', title: '个人资料', theme: 'player', variant: 'full', form: true, maskClosable: false, footer: true },
  'settings-likes': { route: '/pages/mylike/mylike', title: '我的喜欢', theme: 'player', variant: 'half' },
  'settings-deregister': { route: '/pages/deregister/index', title: '账号注销', theme: 'player', variant: 'full', maskClosable: false },
  'settings-feedback': { route: '/subpackageMember/complaint/index', title: '投诉建议', theme: 'player', variant: 'full', form: true, maskClosable: false, footer: true },
  'share-invite': { route: '/pages/member/index/index', title: '邀请好友', theme: 'player', variant: 'full' },
  'merchant-decor': { route: '/pages/merchant/decor/index', title: '店铺资料', theme: 'merchant', variant: 'full', form: true, maskClosable: false, footer: true },
  'merchant-apply': { route: '/pages/merchant/apply/index', title: '申请入驻', theme: 'merchant', variant: 'full', form: true, maskClosable: false, footer: true },
  'club-apply': { route: '/pages/club/apply/index', title: '申请俱乐部主理人', theme: 'player', variant: 'full', form: true, maskClosable: false, footer: true },
  'club-create': { route: '/pages/club/create/index', title: '创建俱乐部', theme: 'player', variant: 'full', form: true, maskClosable: false, footer: true },
  'club-manage': { route: '/pages/club/detail/index', title: '俱乐部管理', theme: 'player', variant: 'full' },
  // 完整编辑组件自带固定保存区,外层不再渲第二个通用 footer。
  'club-edit': { route: '/pages/club/edit/index', title: '编辑俱乐部', theme: 'player', variant: 'full', canBack: true, form: true, maskClosable: false },
  'merchant-citynode': { route: '/pages/merchant/citynode/index', title: '城市据点', theme: 'merchant', variant: 'full', form: true, maskClosable: false, footer: true },
}

function getScene(id, params) {
  const base = SCENES[id]
  if (!base) throw new Error('unknown scene: ' + id)
  return { ...base, id, params: params && typeof params === 'object' ? { ...params } : {} }
}

function sceneIds() { return Object.keys(SCENES) }

module.exports = { SCENES, getScene, sceneIds }
