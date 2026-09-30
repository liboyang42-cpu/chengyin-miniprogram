function positiveId(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseReviewRouteOptions(options) {
  const input = options && typeof options === 'object' ? options : {};
  return {
    mode: input.mode === 'manage' ? 'manage' : 'public',
    merchantRowId: positiveId(input.merchantRowId),
  };
}

function fallbackRoute(mode) {
  return mode === 'manage'
    ? { method: 'reLaunch', url: '/pages/merchant/index/index' }
    : { method: 'switchTab', url: '/pages/index/index' };
}

function classifyLoadFailure(mode, response) {
  const code = Number(response && response.code);
  return mode === 'manage' && (code === 401 || code === 403) ? 'no-permission' : 'error';
}

function createReviewRequestId(kind, now, random, sequence) {
  const prefix = String(kind || 'action').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'action';
  const timePart = Math.max(0, Number(now) || 0).toString(36);
  const randomPart = Math.floor(Math.max(0, Number(random) || 0) * 0x1000000).toString(36);
  const sequencePart = Math.max(0, Number(sequence) || 0).toString(36);
  return `mr-${prefix}-${timePart}-${randomPart}-${sequencePart}`.slice(0, 64);
}

function shapePage(raw, expectedMode, expectedPageNum, expectedPageSize) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const mode = raw.mode;
  if ((mode !== 'manage' && mode !== 'public') || mode !== expectedMode || !Array.isArray(raw.items)) return null;
  const total = strictNonNegative(raw.total);
  const pageNum = strictPositiveInt(raw.pageNum);
  const pageSize = strictPositiveInt(raw.pageSize);
  if (total === null || pageNum === null || pageSize === null || typeof raw.hasMore !== 'boolean') return null;
  if (expectedPageNum !== undefined && pageNum !== expectedPageNum) return null;
  if (expectedPageSize !== undefined && pageSize !== expectedPageSize) return null;
  if (raw.items.length > pageSize) return null;
  const items = raw.items.map(shapeReview);
  if (items.some((item) => item === null)) return null;
  const loadedThrough = (pageNum - 1) * pageSize + items.length;
  if (loadedThrough > total || raw.hasMore !== (loadedThrough < total)) return null;
  const eligibility = shapeEligibility(raw.eligibility);
  const pendingReplyCount = optionalNonNegative(raw, 'pendingReplyCount', 999999);
  const monthNewCount = optionalNonNegative(raw, 'monthNewCount', 999999);
  const replyRatePct = optionalNonNegative(raw, 'replyRatePct', 100);
  if (pendingReplyCount === null || monthNewCount === null || replyRatePct === null) return null;
  return {
    mode,
    total,
    pageNum,
    pageSize,
    hasMore: raw.hasMore === true,
    averageRating: ratingText(raw.averageRating),
    ratingStars: ratingStars(raw.averageRating),
    pendingReplyCount,
    monthNewCount,
    replyRatePct,
    eligibility,
    items,
  };
}

function shapeReview(raw) {
  const id = strictPositiveId(raw && raw.id);
  const version = strictNonNegative(raw && raw.version);
  const rating = Number(raw && raw.rating);
  if (!id || version === null || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  if (!Array.isArray(raw.imageUrls) || raw.imageUrls.length > 9
      || !raw.imageUrls.every((item) => typeof item === 'string' && item.length > 0)) return null;
  if (!['VISIBLE', 'PENDING_REVIEW', 'HIDDEN'].includes(raw.status)) return null;
  if (typeof raw.verifiedRedemption !== 'boolean'
      || typeof raw.canReply !== 'boolean' || typeof raw.canReport !== 'boolean') return null;
  const imageUrls = raw.imageUrls.slice();
  const status = raw.status;
  return {
    id,
    version,
    rating,
    stars: [1, 2, 3, 4, 5].map((value) => ({ value, filled: value <= rating })),
    content: String(raw.content || ''),
    imageUrls,
    authorNickname: String(raw.authorNickname || '城瘾玩家'),
    authorAvatar: String(raw.authorAvatar || ''),
    verifiedRedemption: raw.verifiedRedemption === true,
    status,
    statusClass: status === 'VISIBLE' ? 'visible' : (status === 'PENDING_REVIEW' ? 'pending' : 'hidden'),
    statusText: status === 'VISIBLE' ? '公开展示中' : (status === 'PENDING_REVIEW' ? '待平台复核' : '平台已下架'),
    merchantReply: String(raw.merchantReply || ''),
    repliedAtText: formatTime(raw.repliedAt),
    createTimeText: formatTime(raw.createTime),
    canReply: raw.canReply === true,
    // 缺字段按「不能改」降级:老后端不会返回它,宁可少一个按钮,不能给一个必然 409 的按钮。
    canEditReply: raw.canEditReply === true,
    canReport: raw.canReport === true,
  };
}

function shapeEligibility(raw) {
  if (!raw || typeof raw !== 'object') {
    return { canCreate: false, reasonCode: 'UNAVAILABLE', registrationId: null };
  }
  return {
    canCreate: raw.canCreate === true && positiveId(raw.registrationId) !== null,
    reasonCode: String(raw.reasonCode || 'UNAVAILABLE'),
    registrationId: positiveId(raw.registrationId),
  };
}

function buildCreateDraft(data) {
  const rating = Number(data && data.rating);
  const content = String((data && data.content) || '').trim();
  const imageUrls = Array.isArray(data && data.images) ? data.images.slice(0, 9) : [];
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { valid: false, error: '请选择 1 到 5 星评分' };
  if (content.length < 2 || content.length > 1000) return { valid: false, error: '评价正文需填写 2 到 1000 字' };
  if (imageUrls.length > 9) return { valid: false, error: '评价图片最多 9 张' };
  return { valid: true, payload: { rating, content, imageUrls } };
}

function fingerprint(value) {
  return JSON.stringify(value || {});
}

function formatTime(value) {
  if (!value) return '';
  return String(value).replace('T', ' ').replace(/\.\d{3}(Z|[+-]\d\d:\d\d)?$/, '').slice(0, 16);
}

function ratingText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 5 ? number.toFixed(1) : '0.0'; // 9-18 全局规则:数字没有就显示 0,不写「暂无」/「—」(CU-M-10)
}

function ratingStars(value) {
  const number = Number(value);
  const filledCount = Number.isFinite(number) && number >= 1 && number <= 5
    ? Math.round(number)
    : 0;
  return [1, 2, 3, 4, 5].map((star) => ({ value: star, filled: star <= filledCount }));
}

function strictPositiveId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function strictPositiveInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function strictNonNegative(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function optionalNonNegative(raw, key, max) {
  if (!Object.prototype.hasOwnProperty.call(raw, key) || raw[key] === null || raw[key] === undefined) return 0;
  const value = strictNonNegative(raw[key]);
  return value !== null && value <= max ? value : null;
}

module.exports = {
  buildCreateDraft,
  classifyLoadFailure,
  createReviewRequestId,
  fallbackRoute,
  fingerprint,
  parseReviewRouteOptions,
  positiveId,
  shapePage,
};
