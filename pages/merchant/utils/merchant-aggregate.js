function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function hasCount(source, key) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return false;
  const value = source[key];
  if (value === null || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function normalizeRelationHome(data) {
  if (!data || typeof data !== 'object'
      || !data.discovery || typeof data.discovery !== 'object'
      || !data.stats || typeof data.stats !== 'object'
      || !Array.isArray(data.relations)
      || !Array.isArray(data.discovery.merchants)
      || !Array.isArray(data.discovery.clubs)
      || !hasCount(data.stats, 'merchantCount')
      || !hasCount(data.stats, 'clubCount')
      || !hasCount(data.stats, 'pendingCoopCount')) {
    return null;
  }
  return {
    stats: {
      merchantCount: count(data.stats.merchantCount),
      clubCount: count(data.stats.clubCount),
      pendingCoopCount: count(data.stats.pendingCoopCount),
    },
    relations: data.relations,
    merchants: Array.isArray(data.discovery.merchants) ? data.discovery.merchants : [],
    clubs: Array.isArray(data.discovery.clubs) ? data.discovery.clubs : [],
  };
}

function normalizeMarketingHome(data) {
  if (!data || typeof data !== 'object'
      || !data.recruiting || typeof data.recruiting !== 'object'
      || !data.coupons || typeof data.coupons !== 'object'
      || !data.content || typeof data.content !== 'object'
      || !Array.isArray(data.recruiting.items)
      || !hasCount(data.recruiting, 'count')
      || !hasCount(data.coupons, 'couponCount')
      || !hasCount(data.coupons, 'received')
      || !hasCount(data.coupons, 'verified')
      || !hasCount(data.content, 'topicCount')
      || !hasCount(data.content, 'freeExploreCount')
      || !hasCount(data.content, 'activityCount')) {
    return null;
  }
  return {
    recruiting: {
      count: count(data.recruiting.count),
      // CU-M-132/133:count 现在只数未截止的商机;老 jar 没下发这三个字段时退回旧口径
      // (全部已列出、不声明截断),两端可以分开发。
      openCount: hasCount(data.recruiting, 'openCount') ? count(data.recruiting.openCount) : count(data.recruiting.count),
      shownCount: hasCount(data.recruiting, 'shownCount') ? count(data.recruiting.shownCount) : -1,
      hasMoreOpen: data.recruiting.hasMoreOpen === true,
      items: Array.isArray(data.recruiting.items) ? data.recruiting.items : [],
    },
    coupons: {
      // CU-M-51/M-86:couponCount 现在只数「在投放」(status=1 且在有效期内);已停发/未生效
      // 的券不再算进这个数 —— 但「这叠券」存不存在要另看总数,否则只剩停发券的商家会被画成
      // 「还没有优惠券」。老 jar 不传 couponTotal 时退回旧口径(总券数),两端可分别发布。
      couponCount: count(data.coupons.couponCount),
      couponTotal: hasCount(data.coupons, 'couponTotal')
        ? count(data.coupons.couponTotal)
        : count(data.coupons.couponCount),
      received: count(data.coupons.received),
      verified: count(data.coupons.verified),
    },
    content: {
      topicCount: count(data.content.topicCount),
      freeExploreCount: count(data.content.freeExploreCount),
      activityCount: count(data.content.activityCount),
    },
    analytics: normalizeMarketingAnalytics(data.analytics),
  };
}

const ANALYTICS_STAGE_CODES = ['BROWSE', 'SIGNUP', 'PAYMENT', 'VERIFY', 'REFUND_APPLY'];
const TOUCHPOINT_CODES = ['IN_APP_TOPIC', 'IN_APP_ACTIVITY', 'UNATTRIBUTED'];
const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function isWholeCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeMarketingAnalytics(data) {
  if (!data || typeof data !== 'object'
      || data.semantics !== 'INDEPENDENT_EVENT_COUNTS'
      || (data.windowDays !== 7 && data.windowDays !== 30)
      || !data.window || typeof data.window !== 'object'
      || data.window.timezone !== 'Asia/Shanghai'
      || data.window.basis !== 'COMPLETE_CALENDAR_DAYS'
      || !Array.isArray(data.stages) || data.stages.length !== ANALYTICS_STAGE_CODES.length
      || !data.touchpoints || typeof data.touchpoints !== 'object'
      || data.touchpoints.coverage !== 'PARTIAL'
      || data.touchpoints.attributed !== false
      || !Array.isArray(data.touchpoints.items)
      || data.touchpoints.items.length !== TOUCHPOINT_CODES.length) {
    return null;
  }

  const previousStart = data.window.previousStartInclusive;
  const currentStart = data.window.currentStartInclusive;
  const endExclusive = data.window.endExclusive;
  const span = data.windowDays * DAY_MS;
  if (!Number.isInteger(previousStart) || !Number.isInteger(currentStart) || !Number.isInteger(endExclusive)
      || currentStart - previousStart !== span
      || endExclusive - currentStart !== span
      || (previousStart + SHANGHAI_UTC_OFFSET_MS) % DAY_MS !== 0
      || (currentStart + SHANGHAI_UTC_OFFSET_MS) % DAY_MS !== 0
      || (endExclusive + SHANGHAI_UTC_OFFSET_MS) % DAY_MS !== 0) {
    return null;
  }

  const stages = [];
  for (let i = 0; i < ANALYTICS_STAGE_CODES.length; i += 1) {
    const source = data.stages[i];
    if (!source || source.code !== ANALYTICS_STAGE_CODES[i]
        || typeof source.label !== 'string' || !source.label.trim()
        || !isWholeCount(source.currentCount) || !isWholeCount(source.previousCount)) {
      return null;
    }
    if (source.previousCount === 0) {
      if (source.changeRate !== null) return null;
    } else {
      const rate = Number(source.changeRate);
      const expected = (source.currentCount - source.previousCount) / source.previousCount;
      if (!Number.isFinite(rate) || Math.abs(rate - expected) > 0.00011) return null;
    }
    stages.push({
      code: source.code,
      label: source.label.trim(),
      currentCount: source.currentCount,
      previousCount: source.previousCount,
      changeRate: source.changeRate,
    });
  }

  const touchpoints = [];
  for (let i = 0; i < TOUCHPOINT_CODES.length; i += 1) {
    const source = data.touchpoints.items[i];
    if (!source || source.code !== TOUCHPOINT_CODES[i]
        || typeof source.label !== 'string' || !source.label.trim()
        || !isWholeCount(source.eventCount)) {
      return null;
    }
    touchpoints.push({ code: source.code, label: source.label.trim(), eventCount: source.eventCount });
  }

  return {
    semantics: data.semantics,
    windowDays: data.windowDays,
    window: {
      timezone: 'Asia/Shanghai',
      basis: 'COMPLETE_CALENDAR_DAYS',
      previousStartInclusive: previousStart,
      currentStartInclusive: currentStart,
      endExclusive,
    },
    stages,
    touchpoints: { coverage: 'PARTIAL', attributed: false, items: touchpoints },
  };
}

module.exports = { normalizeRelationHome, normalizeMarketingHome, normalizeMarketingAnalytics };
