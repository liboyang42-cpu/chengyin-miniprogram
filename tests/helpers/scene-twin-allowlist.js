'use strict'

// 已知仍由路由页与场景组件各自实现的孪生内容。
// 新条目必须说明为什么暂时保留，以及如何退出白名单。
const KNOWN_SCENE_TWINS = {
  'roam-task-list': {
    reason: '活动列表路由页仍自取数自绘，scene-roam-task-list 另有一份嵌入实现。',
    exitIntent: '路由页改为渲染 cy-scene-roam-task-list 后删除此项。',
  },
  'roam-session': {
    // 2026-08-08:正文已收进 cy-scene-roam-session(单一真源),这条债的性质变了 ——
    // 剩下的是「分享足迹卡」:canvas 绘轨迹 + 保存相册,page-only 工具链路,
    // 不在站内弹窗路径上,且 canvas + 相册授权在 scene-sheet 里另有一套坑。
    // 它为了画轨迹仍需 wx:for,因此页面不满足薄壳判据。
    reason: '正文已单一真源;页面仅剩 page-only 的分享足迹卡,其 wx:for 是卡片轨迹渲染,不是正文双份。',
    exitIntent: '分享足迹卡抽成独立组件(或确认可下线)后,页面即无 wx:for,届时删除此项。',
  },
  'asset-earnings': {
    // 2026-09-16:组件从 subpackageA 搬进主包后,门禁才第一次看见这条孪生 ——
    // 页面确实委托了 cy-scene-asset-earnings,但自身还有账户读取与资金写入表单
    // (index.js `url: '/api/user/info'`),不满足「自己不实现内容」的薄壳判据。
    reason: '正文已收进 cy-scene-asset-earnings,路由页是宿主;页面自身还承担账户读取与资金表单请求,不满足薄壳判据。',
    exitIntent: '账户与资金表单也收进组件(或挪到别处),页面不再自取数后,删除此项。',
  },
  'qr-ticket': {
    // 2026-09-16:同上,组件从 pages/play 搬进主包后进入门禁视野。
    // 宿主是玩法主页面 pages/play,整页自取数 + 38 处 wx:for,薄壳判据天然不成立,
    // 入场码正文本身已经只有组件一份。
    reason: '正文已收进 cy-scene-qr-ticket 单一真源;宿主 pages/play 是玩法主页,自取数且大量 wx:for,不满足薄壳判据。',
    exitIntent: '薄壳判据能按场景正文判定(而非整页)后,删除此项。',
  },
  'qr-coupon': {
    reason: '优惠券核销码路由页仍自出码自绘，scene-qr-coupon 另有一份嵌入实现。',
    exitIntent: '路由页改为渲染 cy-scene-qr-coupon 后删除此项。',
  },
  'qr-group-code': {
    reason: '团核销码路由页仍自出码自绘，scene-qr-group-code 另有一份嵌入实现。',
    exitIntent: '路由页改为渲染 cy-scene-qr-group-code 后删除此项。',
  },
  'qr-citynode': {
    reason: '据点核销码路由页仍自出码自绘，scene-qr-citynode 另有一份嵌入实现。',
    exitIntent: '路由页改为渲染 cy-scene-qr-citynode 后删除此项。',
  },
  'roam-stamp-album': {
    reason: '集邮册路由页仍自取数自绘，scene-roam-stamp-album 另有一份嵌入实现。',
    exitIntent: '路由页改为渲染 cy-scene-roam-stamp-album 后删除此项。',
  },
}

module.exports = { KNOWN_SCENE_TWINS }
