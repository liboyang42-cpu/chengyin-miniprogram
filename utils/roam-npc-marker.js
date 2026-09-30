// 漫游地图上的门店 AI 形象 marker —— 纯逻辑部分。
//
// 抽出来是为了能真测:图标该不该生成、放大几倍,这些分支塞在 pages/roam/index.js
// 里只能靠正则扫源码,而正则证明不了「fog 的店会不会漏出来」。

/** 一屏最多生成多少个形象图标 —— 上限存在是为了不让一屏几十家店打出下载风暴。 */
const NPC_ICON_MAX = 24;

/** 单个形象图标的缓存键。kind 可选,保留旧调用方的缓存键不变。 */
function npcIconKey(url, level, done, kind) {
  let h = 0;
  const s = String(url || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'npc-' + (h >>> 0).toString(36) + '-' + (Number(level) || 1) +
    (done ? '-done' : '') + (kind ? '-' + kind : '');
}

/** 商家上传头像优先；没有时使用门店 NPC 形象。 */
function markerAvatar(poi) {
  if (!poi) return '';
  return poi.mapAvatar || poi.merchantAvatar || poi.avatarUrl || poi.avatar || poi.npcAvatar || '';
}

/**
 * 像素图进 canvas 的绘制边长。
 * 只允许整数倍放大 —— 非整数倍产生半像素,那种糊法关插值也救不回来。
 * 原图比目标框大时直接按目标框画(源是 2 的幂时等价于整数倍降采样)。
 */
function pixelDrawSize(naturalSize, box) {
  const n = Math.max(Number(naturalSize) || 0, 1);
  const b = Math.max(Number(box) || 0, 1);
  if (n >= b) return b;
  return n * Math.max(1, Math.floor(b / n));
}

/**
 * 收集「当前需要、但还没生成」的形象图标。
 *
 * 三种点位刻意排除,每条都有理由:
 *   fog        —— 没探索到的店不该提前露脸(_syncMarkers 里本来也 return)
 *   target / checkin-failed / redeem-pending —— 打卡安全反馈,必须保持统一状态图标,
 *                换成各家形象会认不出来
 *   已在失败名单 —— 图没下下来(多半是 downloadFile 域名没配),不重试,静默回落
 *
 * @returns {Map<string, {url, level, done, kind}>}
 */
function collectNpcIconNeeds(opts) {
  const o = opts || {};
  const pois = o.pois || [];
  const visit = o.visit || {};
  const icons = o.icons || {};
  const failed = o.failed || {};
  const getState = o.getState;
  const need = new Map();
  if (typeof getState !== 'function') return need;

  for (let i = 0; i < pois.length; i++) {
    const p = pois[i];
    if (!p || p.state === 'fog' || p.cat !== 'merchant') continue;
    const avatar = markerAvatar(p);
    if (!avatar || failed[avatar]) continue;
    const stateKey = getState(p, visit);
    if (stateKey === 'target' || stateKey === 'checkin-failed' || stateKey === 'redeem-pending') continue;
    const level = Number(p.nodeLevel || 1);
    const done = stateKey === 'completed';
    const kind = p.mapAvatarKind || (p.npcAvatar === avatar ? 'npc' : 'merchant');
    const key = npcIconKey(avatar, level, done, kind);
    if (icons[key] || need.has(key)) continue;
    if (need.size >= NPC_ICON_MAX) break;
    need.set(key, { url: avatar, level: level, done: done, kind: kind });
  }
  return need;
}

module.exports = { npcIconKey, pixelDrawSize, collectNpcIconNeeds, markerAvatar };
