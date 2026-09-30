'use strict'

const { distM, m2lat, m2lng } = require('./roam-geo.js')

function validRegion(region) {
  const sw = region && region.southwest
  const ne = region && region.northeast
  return sw && ne
    && Number.isFinite(Number(sw.latitude))
    && Number.isFinite(Number(sw.longitude))
    && Number.isFinite(Number(ne.latitude))
    && Number.isFinite(Number(ne.longitude))
    && Number(ne.latitude) > Number(sw.latitude)
    && Number(ne.longitude) > Number(sw.longitude)
}

function projectRevealCircles(region, viewport, reveals, radiusM, featherScale) {
  if (!validRegion(region)) return []
  const width = Number(viewport && viewport.width)
  const height = Number(viewport && viewport.height)
  const radius = Number(radiusM)
  if (!(width > 0) || !(height > 0) || !(radius > 0)) return []

  const sw = region.southwest
  const ne = region.northeast
  const south = Number(sw.latitude)
  const north = Number(ne.latitude)
  const west = Number(sw.longitude)
  const east = Number(ne.longitude)
  const midLat = (south + north) / 2
  const lngMeters = (east - west) / m2lng(1, midLat)
  const latMeters = (north - south) / m2lat(1)

  // 逐点半径:point.r(米)覆盖默认 radiusM。历史 geohash 格中心必须用比轨迹点大的半径
  // 才能连片(格宽 ~153m,55m 圆落在格心上互不相接,重开后历史区会退化成一片孤立圆点)。
  // featherScale = 调用方绘制时的放大倍率；不传按 1（不放大）算。
  const cullScale = Number(featherScale) > 1 ? Number(featherScale) : 1
  return (reveals || []).map((point) => {
    const r = Number(point && point.r) > 0 ? Number(point.r) : radius
    return {
      x: (Number(point.lng) - west) / (east - west) * width,
      y: (north - Number(point.lat)) / (north - south) * height,
      radiusX: r / lngMeters * width,
      radiusY: r / latMeters * height,
    }
  }).filter((circle) => {
    // 调用方按 feather 倍率放大绘制（index.js 的 g.scale(radiusX * FOG_FEATHER, …)），
    // 剔除也要用放大后的半径；否则圆心离屏 1.0R–1.6R 的点被剔掉，它本该露进视口的
    // 羽化环就在边缘被硬切成直线。
    const fx = circle.radiusX * cullScale
    const fy = circle.radiusY * cullScale
    return Number.isFinite(circle.x) && Number.isFinite(circle.y)
      && circle.x + fx >= 0 && circle.x - fx <= width
      && circle.y + fy >= 0 && circle.y - fy <= height
  })
}

function fallbackRegion(center, halfViewM, viewport) {
  const lat = Number(center && center.lat)
  const lng = Number(center && center.lng)
  const half = Number(halfViewM)
  const width = Number(viewport && viewport.width)
  const height = Number(viewport && viewport.height)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(half > 0) || !(width > 0) || !(height > 0)) return null
  const halfLatM = half * height / width
  const latDelta = m2lat(halfLatM)
  const lngDelta = m2lng(half, lat)
  return {
    southwest: { latitude: lat - latDelta, longitude: lng - lngDelta },
    northeast: { latitude: lat + latDelta, longitude: lng + lngDelta },
  }
}

function isPointRevealed(point, reveals, radiusM) {
  const lat = Number(point && point.lat)
  const lng = Number(point && point.lng)
  const radius = Number(radiusM)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !(radius > 0)) return false
  return (reveals || []).some((reveal) => {
    const revealLat = Number(reveal && reveal.lat)
    const revealLng = Number(reveal && reveal.lng)
    if (!Number.isFinite(revealLat) || !Number.isFinite(revealLng)) return false
    // 逐点半径与 projectRevealCircles 同一口径：画出来揭开多大，点得中就多大。
    // 否则历史格（r=110）看着已点亮，55–110m 带里点 POI 会被静默 return，零反馈。
    // ⚠️ 羽化（FOG_FEATHER）是渐变、不进这里：软边不算“已揭开”。
    const revealR = Number(reveal && reveal.r) > 0 ? Number(reveal.r) : radius
    return distM({ lat: revealLat, lng: revealLng }, { lat, lng }) <= revealR
  })
}

module.exports = { fallbackRegion, isPointRevealed, projectRevealCircles }
