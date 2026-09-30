'use strict';

/* CU-C-38:主题分享卡的标题与封面。
 *
 * 同一个主题此前有两条分享路径各拼各的:主题详情页底部分享只给标题、不带图(微信退回页面
 * 截图),俱乐部「带票分享」标题有主题名但图片是空白 —— 接收人从卡片上看不出分享的是哪场活动,
 * 而且两条路长得不一样。这里收成一份实现:
 *   · 标题 = 主题名,读不到才退回泛化的「主题详情」;
 *   · 封面 = 主题长图 imgUrl,没有再取轮播图 imgArr 的首张;
 *   · 两张都没有 ⇒ **不传** imageUrl,让微信用它自己的默认卡片图。
 *     不拿别的图(首页路线图/占位图)来顶:卡片一旦发出去就固化在接收人的会话里,
 *     用错图的代价比空图大(见 tests/unit/mock-image-asset-safety.test.js 对主题封面兜底的禁令)。
 */

/** 取字段首图:后端多图字段是 "url1,url2" 逗号分隔(WXML 侧同一份口径见 utils/wxs/img.wxs) */
function firstImage(value) {
  return String(value == null ? '' : value).split(',')[0].trim();
}

/**
 * @param source 带 imgUrl / imgArr 的主题数据(详情接口的 info、期次行都行)
 * @param toAbsolute 把相对路径补成可分享绝对地址的函数(app.getImgUrl);不传则原样返回
 */
function resolveTopicCover(source, toAbsolute) {
  const raw = firstImage(source && source.imgUrl) || firstImage(source && source.imgArr);
  if (!raw) return '';
  if (typeof toAbsolute !== 'function') return raw;
  return String(toAbsolute(raw) || '');
}

/**
 * @param options.topicId 主题 id(拼默认 path 用)
 * @param options.name    主题名
 * @param options.cover   已解析好的封面绝对地址,空串则省略 imageUrl
 * @param options.path    覆盖默认落地路径(带票分享要带票源归因参数)
 * @param options.fallbackTitle 主题名缺失时的退路(俱乐部侧退到店名,不硬套「主题详情」)
 */
function buildTopicShare(options) {
  const opts = options || {};
  const name = String(opts.name == null ? '' : opts.name).trim();
  const share = {
    title: name || String(opts.fallbackTitle || '').trim() || '主题详情',
    path: opts.path || ('/pages/topic/index/index?id=' + (opts.topicId == null ? '' : opts.topicId)),
  };
  if (opts.cover) share.imageUrl = opts.cover;
  return share;
}

module.exports = { buildTopicShare, firstImage, resolveTopicCover };
