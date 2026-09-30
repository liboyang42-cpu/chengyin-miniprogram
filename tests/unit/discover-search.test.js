const assert = require('node:assert/strict');
const test = require('node:test');
const search = require('../../utils/discover-search.js');
const { buildContinueExplore, buildContinueGame } = require('../../utils/index/continue-explore.js');

test('四类搜索请求走现有公开接口，俱乐部与商家使用 RequestBody', () => {
  const requests = search.buildRequests('外滩', 8);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests[0].data, { keyword: '外滩', pageNum: 1, pageSize: 12, category_id: 8 });
  assert.equal(requests[2].url, '/api/club/list');
  // CU-M-62:类别必须一并进 club/merchant 的 JSON body,否则结果页只有两类被筛
  assert.deepEqual(JSON.parse(requests[2].data), { name: '外滩', categoryId: 8 });
  assert.deepEqual(JSON.parse(requests[3].data), { name: '外滩', categoryId: 8 });
  assert.equal(requests[3].header['Content-Type'], 'application/json');

  // 没选类别时不凭空塞一个 categoryId(否则会把两类都筛成空)
  const plain = search.buildRequests('外滩', null);
  assert.deepEqual(JSON.parse(plain[2].data), { name: '外滩' });
  assert.deepEqual(JSON.parse(plain[3].data), { name: '外滩' });
});

test('CU-M-66「最近」就是默认排序,四路都不发排序参数(sort_type=1 是「附近的活动」,不能冒充最近)', () => {
  const requests = search.buildRequests('外滩', null, { sortType: '1' });
  assert.equal(requests[1].url, '/api/activity/list');
  assert.equal(requests[1].data.sort_type, undefined);
  assert.equal(requests[0].data.sort_type, undefined)
  assert.equal(JSON.parse(requests[2].data).sortType, undefined);
  assert.equal(JSON.parse(requests[3].data).sortType, undefined);

  // 入口页没选排序时不传(不把默认值当用户选择发出去)
  assert.equal(search.buildRequests('外滩', null, {}).at(1).data.sort_type, undefined);
});

test('日期与价格筛没有后端字段时必须在客户端生效,不能静默丢掉', () => {
  const filters = { startDate: '2026-09-10', endDate: '2026-09-20', minPrice: 100, maxPrice: 400 };
  const rows = [
    { id: 1, name: '贵且晚', startDate: '2026-09-21', minAmout: 500 },
    { id: 2, name: '刚好', startDate: '2026-09-12 19:00:00', minAmout: 199 },
    { id: 3, name: '太早', startDate: '2026-09-01', minAmout: 80 },
  ];
  const kept = search.filterRows('activity', { rows }, filters);
  assert.deepEqual(kept.map((row) => row.id), [2]);
  const cards = search.decorateRows('activity', { rows }, filters);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, '刚好');
});

test('search2 筛选条件必须进结果页 query,buildRequests 要接得住', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const indexJs = fs.readFileSync(path.join(__dirname, '../../pages/search2/index.js'), 'utf8');
  const resultJs = fs.readFileSync(path.join(__dirname, '../../pages/search2/result/index.js'), 'utf8');
  assert.match(indexJs, /startDate=/);
  assert.match(indexJs, /endDate=/);
  assert.match(indexJs, /minPrice=/);
  assert.match(indexJs, /maxPrice=/);
  // CU-M-66:排序选完也必须真的带到结果页(否则两个选项走同一次查询)
  assert.match(indexJs, /sortType=/);
  assert.match(resultJs, /options\.sortType/);
  assert.match(resultJs, /options\.startDate|options\.minPrice/);
  assert.match(resultJs, /filterRows|decorateRows\([^,]+,[^,]+,/);
});

test('搜索结果统一成可跳转卡片，主题图片接受逗号或分号分隔', () => {
  const topic = search.decorateItem('topic', {
    id: 3, name: '外滩夜行', imgArr: 'one.jpg,two.jpg', addressName: '黄浦',
    sysCategoryList: [{ categoryName: '夜行' }, { categoryName: '解谜' }]
  });
  assert.equal(topic.cover, 'one.jpg');
  assert.equal(topic.path, '/pages/topic/index/index?id=3');
  assert.deepEqual(topic.tags, ['夜行', '解谜']);
});

test('搜索商家和俱乐部保留正式卡片所需资料，不伪造营业状态', () => {
  const merchant = search.decorateItem('merchant', {
    id: 8, memberId: 18, name: '街角咖啡', coverImage: 'cover.jpg', logo: 'logo.jpg',
    cityRole: '补给站', slogan: '街角见', businessStatus: null
  });
  assert.equal(merchant.cardCover, 'cover.jpg');
  assert.equal(merchant.cardLogo, 'logo.jpg');
  assert.equal(merchant.cardStatus, 'none');
  assert.equal(merchant.cardCategoryName, '', '拿不到品类就不给,由组件退回中性店铺图标');
  assert.equal(merchant.path, '/pages/userinfo/userinfo?userId=18&tab=about');

  // CU-M-61:无封面的兜底图标按品类选。品类只认 sysCategoryList ——
  // tags 是「夜间友好」这类氛围标签,拿它选图标会把书店画成亲子房。
  const coffee = search.decorateItem('merchant', {
    id: 10, memberId: 20, name: '街角书店', businessStatus: 1, tags: ['夜间友好', '适合亲子'],
    sysCategoryList: [{ categoryName: ' ' }, { categoryName: '文化叙事' }, { categoryName: '咖啡' }]
  });
  assert.equal(coffee.cardCategoryName, '文化叙事');
  assert.equal(coffee.cardStatus, 'open');

  const club = search.decorateItem('club', {
    id: 9, name: '城瘾跑团', cover: 'club.jpg', logo: 'badge.jpg', memberCount: 5
  });
  assert.equal(club.clubCard.coverUrl, 'club.jpg');
  assert.equal(club.clubCard.logoUrl, 'badge.jpg');
  assert.equal(club.clubCard.memberCount, 5);
  assert.equal(club.path, '/pages/club/detail/index?id=9');
});

test('地图主题点位只由活动的真实 topicId 标记，独立活动不伪造关联', () => {
  assert.equal(search.mapPointKind({ id: 1, topicId: 9 }), 'topic');
  assert.equal(search.mapPointKind({ id: 2, topicId: 0 }), 'activity');
  assert.equal(search.mapPointKind({ id: 3 }), 'activity');
});

test('继续探索只取已报名的真实 owner，并回到对应票夹卡片', () => {
  const card = buildContinueExplore([{
    id: 33, ownerType: 1,
    cmsTopic: { name: '梧桐区漫游', addressName: '徐汇', imgArr: 'cover.jpg;next.jpg' }
  }]);
  assert.equal(card.title, '梧桐区漫游');
  assert.equal(card.cover, 'cover.jpg');
  assert.equal(card.focusPath, '/subpackageMember/signup/index?focusId=33&stype=0');
  assert.equal(buildContinueExplore([]), null);
});

test('拍板22 继续游戏卡:自玩按 topicId 直达游玩页,作用域非法不出卡', () => {
  const card = buildContinueGame([{ activityId: 0, topicId: 31, title: '梧桐区漫游', elapsedSeconds: 42 }]);
  assert.equal(card.focusPath, '/pages/play/index?topicId=31');
  assert.equal(card.sub, '已暂停 · 已用时 00:42');
  assert.equal(buildContinueGame([{ activityId: 0, topicId: 0 }]), null);
  assert.equal(buildContinueGame([]), null);
  assert.equal(buildContinueGame(null), null);
});
