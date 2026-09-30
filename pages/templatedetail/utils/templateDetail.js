/**
 * 玩法详情页：画廊图列表 + 展示字段归一化
 * imgUrls 支持：JSON 数组、逗号/分号分隔字符串；后续后端多图字段可直接对接
 */
function parseImgUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(function (u) { return u && String(u).trim(); });
  }
  var str = String(raw).trim();
  if (!str) return [];
  if (str.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed.filter(function (u) { return u && String(u).trim(); });
      }
    } catch (e) { /* fall through */ }
  }
  return str.split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function buildGallery(info) {
  info = info || {};
  var seen = {};
  var list = [];

  function push(url) {
    if (!url || seen[url]) return;
    seen[url] = true;
    list.push(url);
  }

  parseImgUrls(info.imgUrls).forEach(push);
  push(info.imgUrl);
  push(info.storyImg);

  return list;
}

function joinCategories(list) {
  if (!list || !list.length) return '';
  return list.map(function (c) { return c.categoryName; }).filter(Boolean).join(' · ');
}

/** 双行横滑：每列上图下各一张 */
function buildGalleryColumns(urls) {
  urls = urls || [];
  var cols = [];
  for (var i = 0; i < urls.length; i += 2) {
    cols.push({ top: urls[i], bottom: urls[i + 1] || '' });
  }
  return cols;
}

function normalizeTemplateDetail(info) {
  info = info || {};
  var gallery = buildGallery(info);
  return {
    info: info,
    gallery: gallery,
    galleryColumns: buildGalleryColumns(gallery),
    coverUrl: gallery[0] || info.imgUrl || '',
    categoryText: joinCategories(info.sysCategoryList),
    ratingText: info.rating ? String(info.rating) : '—'
  };
}

module.exports = {
  parseImgUrls: parseImgUrls,
  buildGallery: buildGallery,
  buildGalleryColumns: buildGalleryColumns,
  normalizeTemplateDetail: normalizeTemplateDetail
};
