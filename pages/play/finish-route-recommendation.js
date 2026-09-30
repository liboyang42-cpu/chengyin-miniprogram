const { distanceText } = require('../../utils/geo.js')

function isEnabled(features) {
  return !!features && features.finishNearbyRoute === true
}

function resolveOrigin(location, nodes) {
  if (location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))) {
    return { latitude: Number(location.latitude), longitude: Number(location.longitude) }
  }
  const completed = (nodes || []).filter((node) => node && node.done && node.lat && node.lng)
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
  const last = completed[0]
  return last ? { latitude: Number(last.lat), longitude: Number(last.lng) } : null
}

function pickCandidate(rows, currentActivityId, currentTopicId) {
  const candidate = (rows || []).find((item) => item && item.id != null
    && (!currentActivityId || String(item.id) !== String(currentActivityId))
    && (!currentTopicId || String(item.topicId || '') !== String(currentTopicId)))
  if (!candidate) return null
  const distance = Number(candidate.distance)
  const meta = [
    Number.isFinite(distance) ? distanceText(distance) : '',
    candidate.addressName || candidate.address || ''
  ].filter(Boolean).join(' · ')
  const amount = candidate.minAmout
  const priceText = amount == null || amount === '' ? '' : (Number(amount) > 0 ? ('¥' + Number(amount) + ' 起') : '免费')
  return {
    id: candidate.id,
    title: candidate.name || '附近路线',
    cover: String(candidate.imgUrl || '').split(',')[0],
    meta,
    priceText
  }
}

function openCandidate(card, dependencies) {
  if (!card || card.id == null || !dependencies) return false
  dependencies.track('finish_route_recommendation_click', {
    bizType: 'activity', bizId: card.id,
    properties: { mode: dependencies.mode, placement: 'play_finish' }
  })
  dependencies.openScene('play-activity-detail', { id: card.id })
  return true
}

module.exports = { isEnabled, resolveOrigin, pickCandidate, openCandidate }
