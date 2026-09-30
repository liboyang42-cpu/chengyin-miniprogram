// 发现搜索的纯数据层：四类公开对象共用同一套「接口响应 → 结果卡」约定。
// 页面只负责请求与跳转；这里不依赖 wx/app，便于单测且避免四处手写字段兜底。

const { merchantHomeUrl } = require('./merchant-home-link.js');

// 商家的落点是统一主页,主体 ID 是 memberId 而不是列表行 id ——「前缀 + id」这种形状拼不出来,
// 所以它给 pathOf 而不是 path。其余三类的 path 前缀一字未改。
const TYPE_META = {
  topic: { label: '主题', path: '/pages/topic/index/index?id=' },
  activity: { label: '活动', sceneId: 'play-activity-detail' },
  club: { label: '俱乐部', path: '/pages/club/detail/index?id=' },
  merchant: { label: '商家', pathOf: function (item) { return merchantHomeUrl(item.memberId); } },
};

function firstImage(value) {
  return String(value || '').split(/[,;]/).map(function (item) { return item.trim(); }).filter(Boolean)[0] || '';
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.list)) return data.list;
  return [];
}

function tagsOf(item) {
  if (Array.isArray(item.sysCategoryList)) {
    return item.sysCategoryList.map(function (tag) { return tag && tag.categoryName; }).filter(Boolean).slice(0, 2);
  }
  if (Array.isArray(item.tags)) return item.tags.filter(Boolean).slice(0, 2);
  try {
    const parsed = JSON.parse(item.tags || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 2) : [];
  } catch (e) {
    return [];
  }
}

// CU-M-61:无封面时商家卡的兜底图标按品类选,所以要把品类名单独交出去。
// 只认 sysCategoryList —— item.tags 是「夜间友好」这类氛围标签,不是品类,拿它选图标会张冠李戴。
function firstCategoryName(item) {
  const list = Array.isArray(item.sysCategoryList) ? item.sysCategoryList : [];
  for (let i = 0; i < list.length; i += 1) {
    const name = list[i] && list[i].categoryName ? String(list[i].categoryName).trim() : '';
    if (name) return name;
  }
  return '';
}

function decorateItem(type, item) {
  const meta = TYPE_META[type];
  if (!meta || !item || item.id == null) return null;

  const detail = {
    topic: item.addressName || item.description || '城市主题',
    activity: item.topicId ? '关联主题点位' : (item.addressName || item.address || '活动地点待公布'),
    club: item.city || item.description || '城市俱乐部',
    merchant: item.cityRole || item.address || item.slogan || item.description || '合作商家',
  }[type];
  const image = {
    topic: firstImage(item.imgArr || item.imgUrl),
    activity: firstImage(item.imgArr || item.imgUrl),
    club: item.cover || item.logo || '',
    merchant: item.coverImage || item.logo || '',
  }[type];

  return {
    id: item.id,
    key: type + ':' + item.id,
    type: type,
    typeLabel: meta.label,
    title: item.name || meta.label,
    detail: detail,
    cover: image,
    icon: type === 'club' ? 'users' : (type === 'merchant' ? 'poi-shop' : 'map'),
    tags: tagsOf(item),
    cardCover: type === 'merchant' ? firstImage(item.coverImage) : '',
    cardLogo: type === 'merchant' ? firstImage(item.logo) : '',
    cardStatus: type === 'merchant'
      ? (item.businessStatus === 0 || item.businessStatus === '0' ? 'closed'
        : item.businessStatus === 1 || item.businessStatus === '1' ? 'open' : 'none') : '',
    cardCityRole: type === 'merchant' ? (item.cityRole || '') : '',
    cardDescription: type === 'merchant' ? (item.slogan || item.description || '') : '',
    cardCategoryName: type === 'merchant' ? firstCategoryName(item) : '',
    clubCard: type === 'club' ? Object.assign({}, item, {
      coverUrl: firstImage(item.cover), logoUrl: firstImage(item.logo)
    }) : null,
    sceneId: meta.sceneId || '',
    path: meta.pathOf ? meta.pathOf(item) : (meta.path ? meta.path + item.id : ''),
  };
}

function ymdOf(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function rowPrice(item) {
  const raw = item && (item.minAmout != null ? item.minAmout : (item.minAmount != null ? item.minAmount : item.price));
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function matchesFilters(type, item, filters) {
  if (!filters || (type !== 'topic' && type !== 'activity')) return true;
  const startBound = ymdOf(filters.startDate);
  const endBound = ymdOf(filters.endDate);
  const rowDay = ymdOf(item && (item.startDate || item.start_date));
  if ((startBound || endBound) && rowDay) {
    if (startBound && rowDay < startBound) return false;
    if (endBound && rowDay > endBound) return false;
  }
  const minP = Number(filters.minPrice);
  const maxP = Number(filters.maxPrice);
  const applyPrice = (Number.isFinite(minP) && minP > 0) || (Number.isFinite(maxP) && maxP < 1000);
  if (applyPrice) {
    const price = rowPrice(item);
    if (price != null) {
      if (Number.isFinite(minP) && minP > 0 && price < minP) return false;
      if (Number.isFinite(maxP) && maxP < 1000 && price > maxP) return false;
    }
  }
  return true;
}

function filterRows(type, data, filters) {
  return rowsOf(data).filter(function (item) { return matchesFilters(type, item, filters); });
}

function decorateRows(type, data, filters) {
  return filterRows(type, data, filters).map(function (item) { return decorateItem(type, item); }).filter(Boolean);
}

function buildRequests(keyword, categoryId, filters) {
  const common = { keyword: keyword || '', pageNum: 1, pageSize: 12 };
  const categoryData = categoryId ? { category_id: categoryId } : {};
  /* CU-M-62:类别先前只拼进 topic/activity 两路 ⇒ 结果页选「咖啡」后主题/活动筛了,
     商家与俱乐部仍是全量 —— 同一屏四份结果各按不同条件算,看起来就像筛选失效。
     两类后端都已支持 categoryId(ClubMapper.xml:71 / MmsMerchantMapper.xml:63),
     JSON body 里带上即可,不新增接口。 */
  const clubData = { name: keyword || '' };
  const merchantData = { name: keyword || '' };
  if (categoryData.category_id) {
    clubData.categoryId = categoryData.category_id;
    merchantData.categoryId = categoryData.category_id;
  }
  // filters 仅客户端消费:后端 /api/topic/list 与 /api/activity/list 没有 minPrice/startDate 字段。
  // CU-M-66:筛选里只剩「最近」,它就是四类列表的默认排序(create_time desc),不需要发参数。
  // ⚠️ 别把它映射成 /api/activity/list 的 sort_type=1 —— 那个值是「附近的活动」(带经纬度按距离排)。
  void filters;
  return [
    { type: 'topic', url: '/api/topic/list', data: Object.assign({}, common, categoryData), auth: false },
    { type: 'activity', url: '/api/activity/list', data: Object.assign({ is_my: 0 }, common, categoryData), auth: false },
    { type: 'club', url: '/api/club/list', data: JSON.stringify(clubData), header: { 'Content-Type': 'application/json' } },
    { type: 'merchant', url: '/api/merchant/list', data: JSON.stringify(merchantData), header: { 'Content-Type': 'application/json' } },
  ];
}

function mapPointKind(activity) {
  return activity && activity.topicId ? 'topic' : 'activity';
}

module.exports = {
  TYPE_META: TYPE_META,
  firstImage: firstImage,
  rowsOf: rowsOf,
  decorateItem: decorateItem,
  filterRows: filterRows,
  decorateRows: decorateRows,
  buildRequests: buildRequests,
  mapPointKind: mapPointKind,
};
