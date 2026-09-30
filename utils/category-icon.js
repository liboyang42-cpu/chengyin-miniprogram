// 类别 → cy-icon 语义映射(2026-09-18 UI-13)。
//
// 背景:sys_category.icon 各品类共用一张 OSS 占位图(seed 里就是同一个 c1.png),
// 搜索页/选择分类弹窗把这一列渲染成 item.icon 后,每个类别长得一模一样,用户点不出区别。
// 后端换图属于改库(不在本批),前端按 categoryName 关键字落到仓里现有 cy-icon 图标集。
//
// 约定:只在此文件写映射;认不出的类别退回中性图标,不再回退到照片占位图。
// 如果后端以后给每个品类配了真实图标,把消费方的 icon 字段换回去即可,不影响本文件。
var RULES = [
  [/运动|健身|体育|徒步|骑行|跑步|户外/, 'walk'],
  [/科技|数码|电子|摄影|相机|设备/, 'camera'],
  [/美食|餐饮|烹饪|咖啡|烘焙|甜品|食/, 'poi-shop'],
  [/娱乐|演艺|演出|电影|音乐|游戏|达人|竞猜/, 'play-filled'],
  [/衣物|洗护|服装|穿搭/, 'flag'],
  [/家政|维修|家居|清洁|整理|搬家/, 'settings'],
  [/出行|交通|旅行|旅游|路线|漫游/, 'route'],
  [/生活|美学|美妆|时尚|艺术/, 'image'],
  [/探索|城市|地图|街区/, 'map'],
  [/文化|叙事|故事|历史|读书/, 'draft'],
  [/亲子|协作|团队|组队|社交|交友|俱乐部/, 'mtab-customers'],
  [/解谜|谜题|推理|机关/, 'lock'],
];

var FALLBACK_ICON = 'discover-shop';

/**
 * 后端下发的品类是 sysCategoryList([{id, categoryName}]),卡片图标只吃一个名字。
 * 取第一个有名字的;一个都没有就交空串,由 resolveCategoryIcon 退回中性店铺图标 —— 不猜品类。
 * CU-M-61:发现页 / 合作商家列表 / 搜索页都要这一步,以前各写一份,漏写的那页就全员咖啡杯。
 */
function firstCategoryName(row) {
  var list = row && Array.isArray(row.sysCategoryList) ? row.sysCategoryList : [];
  for (var i = 0; i < list.length; i++) {
    var name = list[i] && typeof list[i].categoryName === 'string' ? list[i].categoryName.trim() : '';
    if (name) return name;
  }
  return '';
}

function resolveCategoryIcon(name) {
  var text = String(name == null ? '' : name).trim();
  if (!text) return FALLBACK_ICON;
  for (var i = 0; i < RULES.length; i++) {
    if (RULES[i][0].test(text)) return RULES[i][1];
  }
  return FALLBACK_ICON;
}

/** 一行数据 → 该显示的图标(品类缺失走中性店铺) */
function categoryIconOfRow(row) {
  return resolveCategoryIcon(firstCategoryName(row));
}

module.exports = {
  resolveCategoryIcon: resolveCategoryIcon,
  firstCategoryName: firstCategoryName,
  categoryIconOfRow: categoryIconOfRow,
  FALLBACK_ICON: FALLBACK_ICON,
};
