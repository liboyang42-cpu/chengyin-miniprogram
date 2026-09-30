'use strict'

function buildActivityShare(activity = {}) {
  const id = activity.id == null ? '' : String(activity.id)
  if (!id) return null
  return {
    title: activity.name || '精彩活动',
    path: `/pages/activity/detail/index?id=${encodeURIComponent(id)}`,
    imageUrl: activity.imgUrl || '',
  }
}

function activityShareFromEvent(event) {
  const dataset = event && event.from === 'button' && event.target && event.target.dataset
  if (!dataset || dataset.shareType !== 'activity') return null
  return buildActivityShare({
    id: dataset.activityId,
    name: dataset.activityName,
    imgUrl: dataset.activityImage,
  })
}

module.exports = { activityShareFromEvent, buildActivityShare }
