'use strict'

/* 服务端 /api/roam/pois 行 → 地图上这个点位本地的导航态。
 *
 * 为什么单列一档「待核销」:这家店的打卡记录(roam_poi_reward_log)有两档 ——
 * status=0 待核销(券要商家扫玩家动态码才发)、status=1 已完成。服务端 `found` 把两档
 * 都算「到过店」(C-13),前端若把它们一起读成 passed → candidate:同一站打完卡先亮,
 * 重进地图又灭,而详情里仍能出示核销码(CU-M-54)。
 *
 * ⚠️ 判据必须只在服务端字段上:本地 _pois 会随商家图层/POI 图层异步合并,拿本地状态
 * 推断「这次是不是待核销」会在合并后漂移。
 */
function roamPoiLocalState(row) {
  const item = row || {}
  if (item.pendingRedeem === true) return 'pendingRedeem'
  return item.found ? 'passed' : 'fog'
}

module.exports = { roamPoiLocalState }
