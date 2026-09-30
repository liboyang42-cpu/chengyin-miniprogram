function isSuccess(response) {
  return response && (response.code === 200 || response.code === '200');
}

function nonNegativeNumber(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatInteger(value) {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatMileage(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function stat(key, label, value, unit) {
  // UI-04(2026-09-18):统计位没取到显示 0,不再显示横杠;单位仍随真值给,不硬编。
  return { key, label, value: value == null ? '0' : String(value), unit: value == null ? '' : unit };
}

function completedTopicCount(items) {
  const topicIds = {};
  (items || []).forEach((item) => {
    const topicId = item && item.topicId;
    if (topicId != null && topicId !== '') topicIds[String(topicId)] = true;
  });
  return Object.keys(topicIds).length;
}

function buildGrowthOverview(sources) {
  const input = sources || {};
  const center = isSuccess(input.center) ? (input.center.data || {}) : null;
  const play = isSuccess(input.play) ? (input.play.data || {}) : null;
  const completed = isSuccess(input.completed) && Array.isArray(input.completed.data)
    ? input.completed.data
    : null;
  const growth = center && center.growth ? center.growth : null;
  const exp = growth ? nonNegativeNumber(growth.expValue) : null;
  const level = growth ? nonNegativeNumber(growth.levelNo) : null;
  const mileage = play ? nonNegativeNumber(play.totalMileage) : null;
  const badgeCount = center && Array.isArray(center.badges) ? center.badges.length : null;

  return {
    levelText: level == null ? '成长概览' : 'Lv.' + Math.max(1, Math.round(level)),
    stats: [
      stat('exp', '探索值', exp == null ? null : formatInteger(exp), 'EXP'),
      stat('badge', '徽章', badgeCount, '枚'),
      stat('topic', '完成主题', completed == null ? null : completedTopicCount(completed), '个'),
      stat('distance', '累计距离', mileage == null ? null : formatMileage(mileage), 'km')
    ]
  };
}

module.exports = { buildGrowthOverview };
