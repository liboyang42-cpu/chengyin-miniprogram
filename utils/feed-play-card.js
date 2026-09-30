function buildFeedPlaySubtitle(item) {
  const source = item || {}
  const total = Number(source.nodeTotal) || 0
  const done = Number(source.nodeDoneCount) || 0
  if (!total) return source.completed ? '已通关' : '进行中'
  return source.completed
    ? ('已通关 · 共 ' + total + ' 个节点')
    : ('进行中 · 已完成 ' + done + '/' + total)
}

function resolveFeedPlayCover(item) {
  const source = item || {}
  const candidates = [source.routePreviewImg, source.sportCover]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const cover = String(candidate).trim()
    if (cover) return cover
  }
  return ''
}

function hasFeedPlayCover(item) {
  const source = item || {}
  return Boolean(source.sportName && resolveFeedPlayCover(source))
}

function resolveCompletionShareImage(item) {
  const source = item || {}
  const pics = Array.isArray(source.picList)
    ? source.picList
    : String(source.pics || '').split(';')
  for (const candidate of pics) {
    const image = String(candidate || '').trim()
    if (image) return image
  }
  return resolveFeedPlayCover(source)
}

function isRoamResultShare(item) {
  return String((item || {}).dataType) === '3'
}

// 活动完赛分享落 dataType=1；自由漫游成绩落 dataType=3；主题/模板同步帖为
// dataType=2。普通单图帖仍是 dataType=0，不能仅凭“有一张图”误判为成绩帖。
function isCompletedShare(item) {
  const source = item || {}
  if (isRoamResultShare(source)) return true
  return String(source.dataType) === '1' && source.completed === true && Boolean(source.sportName)
}

module.exports = {
  buildFeedPlaySubtitle,
  resolveFeedPlayCover,
  hasFeedPlayCover,
  resolveCompletionShareImage,
  isRoamResultShare,
  isCompletedShare,
}
