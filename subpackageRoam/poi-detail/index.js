// 据点(POI)深链宿主。站内入口与漫游页内仍走各自的 sceneStack,本页只服务
// 地图 marker / 转发卡片 / 收藏这类「从外面直接进来」的冷启动。
//
// ★ /subpackageRoam/poi-detail/index?poiId=<cityNodeId> 一旦上线即长期契约:
//   onShareTimeline 只能自定义 query、不能自定义 path(微信官方 Page 文档),
//   朋友圈卡片的落点路径恒等于生成它的那一页 ⇒ 事后改路径 = 历史卡片全失效。
//
// 正文与到店验证逻辑只有 components/cy/scene-roam-poi-detail 一份,这里不复制。
const SHARE_PATH = '/subpackageRoam/poi-detail/index'

function shareQuery(poiId) {
  return 'poiId=' + encodeURIComponent(poiId || '')
}

Page({
  data: {
    ready: false,
    poiId: '',
    sceneParams: {},
  },

  onLoad(options) {
    const poiId = (options && options.poiId) || ''
    this.setData({ poiId, sceneParams: { poiId }, ready: true })
  },

  onShareAppMessage() {
    return { title: '这个据点等你到店打卡', path: SHARE_PATH + '?' + shareQuery(this.data.poiId) }
  },

  // 只能给 query;path 由平台固定为本页 —— 这正是本页要作为稳定宿主存在的原因。
  onShareTimeline() {
    return { title: '这个据点等你到店打卡', query: shareQuery(this.data.poiId) }
  },

  onAddToFavorites() {
    return { title: '据点详情', path: SHARE_PATH + '?' + shareQuery(this.data.poiId) }
  },
})
