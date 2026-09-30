// utils/npc-roam-gate.js — 漫游 NPC 防吵闸(纯逻辑,补充方案 §9.4)。
// 预占(tryAcquire)→ 展示成功(confirmShown 计费)/失败(releaseUnshown 归还,≥2 次失败永久拒)。
// 配额:start/25/80/end 各 1 次;poi ≤2 次且间隔 ≥90s;全局任意两条 ≥45s(end 豁免)。
//
// 为什么是「展示后计费」而不是「请求即计费」:拉话术可能失败(网络/无预审话术),
// 那种情况下不该白白吃掉用户这一次开场 —— 但也不能无限重试,故 2 次失败即永久闭嘴。
const QUOTA = { roam_start: 1, roam_poi_first_light: 2, roam_milestone_25: 1, roam_milestone_80: 1, roam_end: 1 };
const GLOBAL_GAP_MS = 45000;
const POI_GAP_MS = 90000;
const MAX_FAILS = 2;

function createNpcRoamGate(deps) {
  const now = (deps && deps.now) || Date.now;
  const shown = {};        // eventType -> 已展示次数
  const fails = {};        // eventType -> 失败次数
  const pending = {};      // eventType -> 是否在途
  let lastShownAt = -Infinity;   // 全局最近展示时刻
  let lastPoiAt = -Infinity;

  function tryAcquire(eventType) {
    if (!Object.prototype.hasOwnProperty.call(QUOTA, eventType)) return { ok: false, reason: 'unknown_event' };
    if (pending[eventType]) return { ok: false, reason: 'in_flight' };
    if ((fails[eventType] || 0) >= MAX_FAILS) return { ok: false, reason: 'fail_capped' };
    if ((shown[eventType] || 0) >= QUOTA[eventType]) return { ok: false, reason: 'quota' };
    const t = now();
    // end 豁免的是「全局节流」,不是自己的配额(上面的 quota 检查对 end 照样生效)
    if (eventType !== 'roam_end' && t - lastShownAt < GLOBAL_GAP_MS) return { ok: false, reason: 'global_gap' };
    if (eventType === 'roam_poi_first_light' && t - lastPoiAt < POI_GAP_MS) return { ok: false, reason: 'poi_gap' };
    pending[eventType] = true;
    return { ok: true };
  }

  function confirmShown(eventType) {
    pending[eventType] = false;
    shown[eventType] = (shown[eventType] || 0) + 1;
    lastShownAt = now();
    if (eventType === 'roam_poi_first_light') lastPoiAt = lastShownAt;
  }

  function releaseUnshown(eventType) {
    pending[eventType] = false;
    fails[eventType] = (fails[eventType] || 0) + 1;
  }

  return { tryAcquire, confirmShown, releaseUnshown };
}

module.exports = { createNpcRoamGate };
