const categories = [
  { id: 101, categoryName: '城市探索', icon: '/images/icon_cat.png', isChecked: 1 },
  { id: 102, categoryName: '解谜互动', icon: '/images/icon_cat.png', isChecked: 0 },
  { id: 103, categoryName: '文化叙事', icon: '/images/icon_cat.png', isChecked: 0 },
  { id: 104, categoryName: '亲子协作', icon: '/images/icon_cat.png', isChecked: 0 }
];

// 开发版节点玩法货架：与 migration_seed_template_library_12packs_20260820.sql
// 的 12 个官方玩法同名同用途，只用于后端数据尚未落库时的页面验收。
// 2026-08-25：为看页面凑数的 8 条占位主题（街角密码/时间邮局/商圈协作路线/霓虹夜行/
// 旧物事务所/通关密语/亲子寻光记/城市暗号）已删除，货架只留官方玩法。
const templates = [
  {
    id: 9101, title: '今晚的暗号',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p01-tonights-passcode.webp',
    players: '1-2人', duration: 5, difficulty: '低', rating: '', useNum: 0,
    description: '玩家到店说出主题暗号，解锁商家自行设置的小礼遇。',
    ruleInstructions: '商家只需填写一句暗号和对应礼遇；玩家到店说出暗号并在页面提交。',
    requiredMaterials: '手机、当日暗号', usageLocation: '咖啡馆、酒吧、餐饮店、零售店',
    validationMethod: 1, validationMethodStr: '文字问答', feedbackMethodStr: '文字反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[1]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9102, title: '老板的秘密题',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p02-boss-secret-question.webp',
    players: '1人起', duration: 5, difficulty: '低', rating: '', useNum: 0,
    description: '把店铺故事变成一道现场可观察、可回答的小问题。',
    ruleInstructions: '商家填写一道能从菜单、陈列或空间中找到答案的选择题。',
    requiredMaterials: '手机、店铺故事', usageLocation: '餐饮店、咖啡馆、书店、生活方式店',
    validationMethod: 3, validationMethodStr: '选择题', feedbackMethodStr: '文字反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[1], categories[2]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9103, title: '拍下这一刻',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p03-capture-this-moment.webp',
    players: '1人起', duration: 5, difficulty: '低', rating: '', useNum: 0,
    description: '用一张照片完成与空间、商品或主题有关的轻任务。',
    ruleInstructions: '商家选择一个自然存在的取景点并填写拍摄提示；玩家拍摄后提交。',
    requiredMaterials: '手机、可拍摄场景', usageLocation: '咖啡馆、服装店、展览、市集',
    validationMethod: 2, validationMethodStr: '拍照', feedbackMethodStr: '图片反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[0], categories[2]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9104, title: '收集这枚风味印章',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p04-flavor-stamp.webp',
    players: '1人起', duration: 5, difficulty: '低', rating: '', useNum: 0,
    description: '完成一次正常到店体验，点亮主题中的一枚风味印章。',
    ruleInstructions: '商家选择可稳定提供的产品或体验；玩家完成后扫码或由商家确认。',
    requiredMaterials: '手机、店内二维码', usageLocation: '餐厅、烘焙店、咖啡馆、酒吧',
    validationMethod: 4, validationMethodStr: '扫码', feedbackMethodStr: '完成反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[0]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9105, title: '新品盲测局',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p05-new-product-blind-test.webp',
    players: '1-4人', duration: 10, difficulty: '低', rating: '', useNum: 0,
    description: '玩家体验新品后完成一题轻量盲测，商家获得真实偏好反馈。',
    ruleInstructions: '商家提供一项可试吃或试用内容并设置选项；玩家体验后选择答案。',
    requiredMaterials: '手机、试吃或试用品', usageLocation: '餐饮店、饮品店、美妆店、生活方式店',
    validationMethod: 3, validationMethodStr: '选择题', feedbackMethodStr: '偏好反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[1]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9106, title: '今日搭配任务',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p06-todays-styling-task.webp',
    players: '1-2人', duration: 10, difficulty: '低', rating: '', useNum: 0,
    description: '围绕穿搭、器物或空间完成一次可分享的搭配选择。',
    ruleInstructions: '商家给出一个搭配主题；玩家使用店内可体验内容完成搭配并拍照。',
    requiredMaterials: '手机、可体验商品', usageLocation: '服装店、眼镜店、花店、家居店',
    validationMethod: 2, validationMethodStr: '拍照', feedbackMethodStr: '图片反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[2]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9107, title: '集合点亮',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p07-rally-light-up.webp',
    players: '3-20人', duration: 5, difficulty: '低', rating: '', useNum: 0,
    description: '成员到达集合点后扫码点亮队伍，快速完成活动签到与破冰。',
    ruleInstructions: '俱乐部放置一个集合二维码；成员到场扫码后进入同一队伍。',
    requiredMaterials: '手机、集合二维码', usageLocation: '跑团集合点、球馆、营地、活动场馆',
    validationMethod: 4, validationMethodStr: '扫码', feedbackMethodStr: '队伍进度',
    publisher: '城瘾官方', sysCategoryList: [categories[3]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9108, title: '小队竞速点亮',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p08-team-race-light-up.webp',
    players: '4-30人', duration: 30, difficulty: '中', rating: '', useNum: 0,
    description: '多支小队完成同一组到点任务，用进度形成轻量竞速。',
    ruleInstructions: '俱乐部选择节点与完成顺序；队员到点提交后累计小队进度。',
    requiredMaterials: '手机、队伍名单', usageLocation: '商圈、公园、园区、运动场馆',
    validationMethod: 5, validationMethodStr: '位置验证', feedbackMethodStr: '排行榜',
    publisher: '城瘾官方', sysCategoryList: [categories[0], categories[3]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9109, title: '街角谜题',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p09-street-corner-riddle.webp',
    players: '1-6人', duration: 10, difficulty: '中', rating: '', useNum: 0,
    description: '利用现场建筑、招牌或公共艺术设置一条可观察的城市谜题。',
    ruleInstructions: '俱乐部填写现场可见答案与提示；玩家观察后提交文字答案。',
    requiredMaterials: '手机、现场线索', usageLocation: '历史街区、商圈、文创园、公园',
    validationMethod: 1, validationMethodStr: '文字问答', feedbackMethodStr: '文字反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[0], categories[1]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9110, title: '城市取景任务',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p10-city-framing-task.webp',
    players: '1-10人', duration: 15, difficulty: '低', rating: '', useNum: 0,
    description: '沿路线寻找指定构图、颜色或城市细节，生成一组主题照片。',
    ruleInstructions: '俱乐部填写取景关键词和允许拍摄的公共位置；玩家按提示拍照。',
    requiredMaterials: '手机、取景提示', usageLocation: '街区、公园、滨水空间、建筑园区',
    validationMethod: 2, validationMethodStr: '拍照', feedbackMethodStr: '图片反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[0], categories[2]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9111, title: '城市接力棒',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p11-city-relay.webp',
    players: '4-30人', duration: 20, difficulty: '中', rating: '', useNum: 0,
    description: '上一队留下线索，下一队接力完成，让活动自然产生队伍互动。',
    ruleInstructions: '俱乐部设置统一接力暗号；小队完成节点后把暗号交给下一队。',
    requiredMaterials: '手机、接力暗号', usageLocation: '城市定向、社群活动、团建路线',
    validationMethod: 1, validationMethodStr: '文字问答', feedbackMethodStr: '队伍反馈',
    publisher: '城瘾官方', sysCategoryList: [categories[1], categories[3]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  },
  {
    id: 9112, title: '今日角色任务',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/p12-todays-role-task.webp',
    players: '2-20人', duration: 15, difficulty: '低', rating: '', useNum: 0,
    description: '成员抽取观察者、记录者或气氛组等角色，用分工完成轻社交任务。',
    ruleInstructions: '俱乐部选择角色和共同目标；成员按角色完成一项拍照或记录任务。',
    requiredMaterials: '手机、角色说明', usageLocation: '社群聚会、城市探索、团建、亲子活动',
    validationMethod: 2, validationMethodStr: '拍照', feedbackMethodStr: '小队合照',
    publisher: '城瘾官方', sysCategoryList: [categories[3]], publishStatus: '1', status: 1,
    createTime: '2026-08-20'
  }
];

templates.forEach(function (item) { item.previewOnly = true; });

// 上海单人自由探索主题尚未完成真实试走，只在微信开发版提供受控预览。
const topicTemplates = [
  {
    id: 'dev-shanghai-flavor-tour', name: '风味巡游', subtitle: '上海老味道的四种证词',
    description: '从四个固定地点任选三处，用观察、拍照或认真尝一口认识上海味道。',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/t25-shanghai-flavor-tour.webp'
  },
  {
    id: 'dev-shanghai-midlife-day', name: '不惑之年', subtitle: '把一天还给现在的自己',
    description: '看书、走路、拍下现在的自己，给工作与家庭角色之外的自己留半天。',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/t26-shanghai-midlife-day.webp'
  },
  {
    id: 'dev-shanghai-prebuilt-life', name: '预制人生', subtitle: '今天偏离标准答案一次',
    description: '重新观看通勤、城市模型、百货与步行街，主动选择一次今天的版本。',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/t27-shanghai-prebuilt-life.webp'
  },
  {
    id: 'dev-shanghai-heat-escape', name: '高温末日逃生', subtitle: '浦东四座室内方舟',
    description: '用一点末日幽默探索四座室内文化空间；这不是应急避难或降温保证。',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/t28-shanghai-heat-escape.webp'
  },
  {
    id: 'dev-shanghai-old-movie', name: '上海像一部旧电影', subtitle: '沿苏州河寻找四个镜头',
    description: '沿苏州河观看老屠宰场、邮政大楼、仓库与纺织厂房留下的城市结构。',
    imgUrl: 'https://api.example.invalid/prod-api/profile/template-covers/t29-shanghai-old-movie.webp'
  }
].map(function (item) {
  return Object.assign({}, item, {
    productType: 2,
    templateStatus: 'EXPERIMENTAL',
    previewOnly: true,
    chapterCount: 1,
    gameCount: 1,
    locationCount: 4,
    applicableRoles: 'AGENT'
  });
});

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function getCategories() {
  return clone(categories);
}

function getTemplates(keyword) {
  const text = (keyword || '').trim().toLowerCase();
  const list = text
    ? templates.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(text))
    : templates;
  return clone(list);
}

function getTemplateById(id) {
  const template = templates.find(item => String(item.id) === String(id)) || templates[0];
  return clone(template);
}

function getHomeData() {
  const pool = clone(templates).filter(item => String(item.publishStatus) === '1');
  const byUse = [...pool].sort((a, b) => (b.useNum || 0) - (a.useNum || 0));
  const byNew = [...pool].sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
  return {
    total: pool.length,
    categoryList: getCategories(),
    bannerList: byUse.slice(0, 5),
    // 开发验收时把 6 个俱乐部玩法放进推荐位；最新位展示 6 个商家玩法，
    // 不伪造采用次数，也能让 12 个新增玩法在现有页面切片中全部可达。
    recommendList: clone(templates.slice(6)),
    mustPlayList: byUse.slice(0, 3),
    latestList: byNew.slice(0, 6)
  };
}

function getTopicTemplates() {
  return clone(topicTemplates);
}

function getDefaultUser() {
  return {
    id: 1,
    nickname: '城瘾创作者',
    avatar: '/images/d_profile.png',
    userType: 1,
    wxOpenId: 'dev-openid'
  };
}

// 开发版 · 附近俱乐部演示(团体 Tab 空列表时注入;详情页 id 对齐)
const DEMO_NEARBY_CLUB_ID = 900901;

function getDemoNearbyClub() {
  return {
    id: DEMO_NEARBY_CLUB_ID,
    name: '城瘾骑游社',
    clubType: '骑行',
    memberCount: 1286,
    city: '上海',
    address: '上海',
    logo: '/images/d_logo.png',
    cover: '/images/route_city_cover.png',
    description: '每周组织城市骑行与路线探索，适合新手到进阶玩家一起出发。',
    style: '品牌/组织',
    level: 3,
    leaderName: '骑游主理人',
    isOwner: false,
    isJoined: false,
  };
}

function getDemoClubDetail() {
  return Object.assign({}, getDemoNearbyClub(), {
    isOwner: false,
    isJoined: false,
    status: 1,
  });
}

function getDemoClubPosts() {
  return [
    {
      id: 90090101,
      content: '✨ 🆕 室内/户外挑战 ✨\n本周开启城市骑游挑战：完成 3 条推荐路线即可解锁限定徽章。室内台骑里程同样计入，和队友一起冲榜吧！',
      images: '/images/d_frametu.jpg',
      createTime: '2026-07-01 09:16:00',
      likeCount: 42,
      commentCount: 8,
      isLiked: false,
      authorMemberId: 0,
    },
  ];
}

function getDemoClubTopics() {
  return [
    {
      id: 90090111,
      name: '滨江夜骑 · 城市定向',
      imgUrl: '/images/route_city_cover.png',
      addressName: '上海 · 外滩',
      signupCount: 36,
      startDate: '2026-07-12',
      endDate: '2026-07-12 22:00:00',
    },
  ];
}

/** 我的页 · 项目 Tab 横向订单卡预览(dev 无数据时) */
function getDemoOrderPreviews() {
  return [
    { id: 90001, title: '静安寺 · 城市密室逃脱', sub: '2026.07.01 14:30 · 待使用', cover: '/images/route_free_cover.png' },
    { id: 90002, title: '武康路历史风貌探索', sub: '2026.06.28 10:00 · 已完成', cover: '/images/route_city_cover.png' },
    { id: 90003, title: '外滩夜景定向挑战赛', sub: '2026.06.20 19:00 · 报名成功', cover: '/images/index-figma/reco-hero.jpg' },
  ];
}

/** 我的页 · 项目 Tab 横向项目卡预览(dev 无数据时) */
function getDemoProjectPreviews() {
  return [
    { id: 90011, title: '愚园路 · 城市解谜路线', sub: '2026.07.01 - 2026.08.31', cover: '/images/route_free_cover.png' },
    { id: 90012, title: '巨富长街拍立得巡游', sub: '2026.06.15 - 2026.07.15', cover: '/images/mer1.jpg' },
    { id: 90013, title: '苏州河步行叙事线', sub: '长期开放 · 12 人参与', cover: '/images/d_frametu.jpg' },
  ];
}

/** 团体 · 我的探索 · 我的项目列表(dev 无数据时) */
function getDemoMyProjects() {
  return [
    {
      id: 90011,
      name: '愚园路 · 城市解谜路线',
      imgArr: '/images/route_free_cover.png',
      salesAmout: 128,
      viewCount: 3260,
      startDate: '2026-06-01',
      endDate: '2026-08-31',
    },
    {
      id: 90012,
      name: '巨富长街拍立得巡游',
      imgArr: '/images/mer1.jpg',
      salesAmout: 56,
      viewCount: 892,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    },
    {
      id: 90013,
      name: '苏州河步行叙事线',
      imgArr: '/images/route_city_cover.png',
      salesAmout: 240,
      viewCount: 5100,
      startDate: '2026-05-01',
      endDate: '2026-09-30',
    },
  ];
}

module.exports = {
  DEMO_NEARBY_CLUB_ID,
  getCategories,
  getTemplates,
  getTemplateById,
  getHomeData,
  getTopicTemplates,
  getDefaultUser,
  getDemoNearbyClub,
  getDemoClubDetail,
  getDemoClubPosts,
  getDemoClubTopics,
  getDemoOrderPreviews,
  getDemoProjectPreviews,
  getDemoMyProjects,
};
