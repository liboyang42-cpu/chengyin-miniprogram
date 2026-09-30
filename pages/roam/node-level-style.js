const {
  ROUTE_COLORS,
  ROUTE_BORDER_COLOR,
} = require('../../utils/play-visual-tokens.js')

// 原生 map marker / Canvas 读不到 WXSS var；颜色值统一来自 play-visual-tokens，
// 并显式记录对应的 --cy-* 真源，避免页面再散落一组硬编码视觉值。
const STYLES = {
  1: {
    level: 1, label: '普通节点', glyph: '●', shape: 'circle', size: 34, zIndex: 9,
    fillColor: ROUTE_COLORS[3], fillToken: '--cy-play-route-4',
    borderColor: ROUTE_BORDER_COLOR, borderToken: '--cy-play-marker-border',
  },
  2: {
    level: 2, label: '精选节点', glyph: '◆', shape: 'diamond', size: 38, zIndex: 10,
    fillColor: ROUTE_COLORS[2], fillToken: '--cy-play-route-3',
    borderColor: ROUTE_BORDER_COLOR, borderToken: '--cy-play-marker-border',
  },
  3: {
    level: 3, label: '官方合作', glyph: '★', shape: 'star', size: 42, zIndex: 11,
    fillColor: ROUTE_COLORS[1], fillToken: '--cy-play-route-2',
    borderColor: ROUTE_BORDER_COLOR, borderToken: '--cy-play-marker-border',
  },
  4: {
    level: 4, label: '主题路线', glyph: '⬟', shape: 'shield', size: 46, zIndex: 12,
    fillColor: ROUTE_COLORS[0], fillToken: '--cy-play-route',
    borderColor: ROUTE_BORDER_COLOR, borderToken: '--cy-play-marker-border',
  },
}

function getNodeLevelStyle(level) {
  const normalized = Math.max(1, Math.min(4, Number(level || 1)))
  return STYLES[normalized]
}

function buildNodeLevelMarkerStyle(level, stateKey) {
  const style = getNodeLevelStyle(level)
  const completed = stateKey === 'completed'
  return Object.assign({}, style, {
    iconKey: 'node-level-' + style.level + (completed ? '-done' : ''),
  })
}

module.exports = { getNodeLevelStyle, buildNodeLevelMarkerStyle }
