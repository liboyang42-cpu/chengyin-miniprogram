// Canvas / map native data cannot read CSS variables. Keep these literals aligned with
// style/tokens.wxss --cy-play-route* / --cy-play-marker-border.
const ROUTE_COLORS = ['#FFFFFF', '#D9D9D9', '#A6A6A6', '#737373', '#404040']
const ROUTE_BORDER_COLOR = '#111111'
// Native <switch> cannot consume WXSS variables; keep the topic-editor control token centralized here.
const TOPIC_EDITOR_SWITCH_COLOR = '#111111'

const MAP_AVATAR_COLORS = Object.freeze({
  player: '#4FD3D0',
  merchant: '#E7A84B',
  merchantAccent: '#E85F4F',
  npc: '#D77BB4',
  panel: '#132A2E',
  cream: '#FFF0CF',
  // 2026-09-05 附近的局:限时活动粉 / 已满·已完成灰。来源 Figma《V2｜城瘾游戏头像地图》aJaPDtyMwb7UfzQBUaTWhE
  event: '#F45B75',
  dim: '#5A6A6C',
  // 2026-09-09 定死:主题描边按玩法分家 —— 城市定向绿 / 自由探索蓝。地图描边、主题标签
  // 底色、搜索结果的针、Figma 全量稿与点位板六处同一值,改这里就是改全部。
  cityRoute: '#4ADE80',
  freeExplore: '#5A90D6',
  // 星星只表示「这家有玩法」。原来的奶油 #E2C489 压在深色地图上发灰,已废。
  gameStar: '#F5B301',
})

function routeColorForKey(key) {
  const text = String(key == null ? '' : key)
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return ROUTE_COLORS[hash % ROUTE_COLORS.length]
}

module.exports = {
  ROUTE_COLORS,
  ROUTE_BORDER_COLOR,
  TOPIC_EDITOR_SWITCH_COLOR,
  MAP_AVATAR_COLORS,
  routeColorForKey,
}
