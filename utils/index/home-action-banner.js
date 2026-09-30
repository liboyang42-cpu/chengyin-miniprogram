// 三段动效 GIF 共 1.42MB —— 留在包里会把主包顶穿微信 2MB 硬限。
// motionSrc 走服务端静态目录(母版在 assets/covers/home-banners/),
// poster 仍是包内 jpg:首屏立刻有图,GIF 慢慢流进来,不会白屏。
const EXPECTED_ROUTES = {
  'home-action-club': '/pages/club/apply/index',
  'home-action-merchant': '/pages/merchant/apply/index',
  'home-action-activity': '/pages/activity/list/index',
};

// 首图是纯展示的品牌封面:文案烧在图里,没有 route,点了什么都不发生。
// 它不进 EXPECTED_ROUTES —— openHomeActionBanner 因此对它恒返回 false。
// 包内 PNG 而不是走服务端静态目录:它是第一屏第一眼,远程图会让首页开局空一拍;
// 代价是主包资源棘轮抬到 515728(见 home-action-banner-contract.test.js 里的抬法说明)。
const HOME_COVER_BANNER = {
  id: 'home-cover',
  name: '城瘾',
  poster: '/images/home-banner-cover.png',
  _type: 'cover',
};

const HOME_ACTION_BANNERS = [
  {
    id: 'home-action-club',
    title: '成为俱乐部',
    subtitle: '聚集同好，发起属于你们的城市活动',
    route: EXPECTED_ROUTES['home-action-club'],
    motionSrc: 'https://api.example.invalid/prod-api/profile/home-banners/home-banner-club.gif',
    poster: '/images/home-banner-club.jpg',
  },
  {
    id: 'home-action-merchant',
    title: '成为商家',
    subtitle: '把空间、服务和好内容带给更多玩家',
    route: EXPECTED_ROUTES['home-action-merchant'],
    motionSrc: 'https://api.example.invalid/prod-api/profile/home-banners/home-banner-merchant.gif',
    poster: '/images/home-banner-merchant.jpg',
  },
  {
    id: 'home-action-activity',
    title: '和朋友报名活动',
    subtitle: '和朋友一起，发现附近正在发生的有趣体验',
    route: EXPECTED_ROUTES['home-action-activity'],
    motionSrc: 'https://api.example.invalid/prod-api/profile/home-banners/home-banner-friends.gif',
    poster: '/images/home-banner-friends.jpg',
  },
].map(function (item) {
  return Object.assign({}, item, {
    name: item.title,
    _type: 'action',
  });
});

function validateHomeActionBanners(list) {
  if (!Array.isArray(list) || list.length !== HOME_ACTION_BANNERS.length + 1) {
    throw new Error('home-action-banner-count');
  }
  if (!list[0] || list[0].id !== HOME_COVER_BANNER.id || list[0].route) {
    throw new Error('home-cover');
  }
  list.slice(1).forEach(function (item) {
    if (!item || EXPECTED_ROUTES[item.id] !== item.route) {
      throw new Error(item && item.id ? item.id : 'home-action-banner-id');
    }
  });
  return true;
}

// HOME_ACTION_BANNERS 与 EXPECTED_ROUTES 都是本文件里的冻结字面量,拿一个校验另一个
// 在生产路径上永远不可能失败 —— 它只是把测试该做的事搬到了每次调用上。
// 校验保留为导出,由 home-action-banner-contract.test.js 调用;运行时不再跑。
function buildHomeActionBanners() {
  return [Object.assign({}, HOME_COVER_BANNER)].concat(
    HOME_ACTION_BANNERS.map(function (item) { return Object.assign({}, item); }));
}

function openHomeActionBanner(wxApi, item) {
  // 没有 route 的 Banner(品牌封面)必须在这里就掉头:少了 !item.route 这半句,
  // undefined === undefined 会让它一路走到 navigateTo({ url: undefined })。
  if (!item || !item.route || EXPECTED_ROUTES[item.id] !== item.route) return false;
  if (!wxApi || typeof wxApi.navigateTo !== 'function') return false;
  wxApi.navigateTo({ url: item.route });
  return true;
}

module.exports = {
  buildHomeActionBanners,
  openHomeActionBanner,
  validateHomeActionBanners,
};
