function decorateFeedCards(list, normalizeImage) {
  if (!Array.isArray(list)) return list;
  const toImage = typeof normalizeImage === 'function' ? normalizeImage : function (src) { return src; };

  return list.map(function (item) {
    const raw = item.imgArr || item.imgUrl || '';
    const imgList = String(raw)
      .split(/[,;]/)
      .map(function (src) { return src.trim(); })
      .filter(Boolean)
      .map(toImage)
      .filter(Boolean);
    const feedImages = imgList.slice(0, 4);
    const feedCount = feedImages.length;
    const feedGridMode = feedCount >= 4 ? '4' : (feedCount === 3 ? '3' : (feedCount === 2 ? '2' : '1'));
    const productType = Number(item.productType);
    const feedTypeLabel = productType === 1 ? '城市定向' : (productType === 2 ? '自由探索' : '');
    const feedTags = (item.sysCategoryList || [])
      .map(function (tag) { return tag && tag.categoryName ? String(tag.categoryName).trim() : ''; })
      .filter(Boolean)
      .slice(0, 2);

    return Object.assign({}, item, {
      imgList: imgList,
      cover: imgList[0] || '',
      moreCount: imgList.length > 4 ? imgList.length - 4 : 0,
      feedImages: feedImages,
      feedGridMode: feedGridMode,
      feedTypeLabel: feedTypeLabel,
      feedTags: feedTags,
    });
  });
}

module.exports = {
  decorateFeedCards: decorateFeedCards,
};
