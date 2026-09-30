// 附近正在漫游的人(原型 otherRunners / otherSheet)。
// 纯函数放这儿:颜色怎么挑、时长怎么写、后端回包怎么收成一行,都能单测。
'use strict';

/* 每个人一个环色。原型只给了两个人(#A78BFA / #22D3EE),这里补齐成一组
   ——都是深色地图上压得住的中高亮度色,和自己的蓝 #2F7BF6、城市定向绿 #4ADE80、
   自由探索蓝 #5A90D6 都拉得开,不会让人把别人认成自己或认成点位。 */
const RUNNER_COLORS = ['#A78BFA', '#22D3EE', '#F0ABFC', '#FDBA74', '#67E8F9', '#FCA5A5']; /* ds-ok 原型 otherSheet 的每人一色,前两个是原型原值;这是画进 canvas 的地图色,不是内容页文本色 */

/** 同一个人每次进来都该是同一个颜色,否则地图刷新一次就换一身衣服。 */
function runnerColor(memberId) {
  const n = Math.abs(Number(memberId) || 0);
  return RUNNER_COLORS[n % RUNNER_COLORS.length];
}

/** 在走时长。原型写的是 38:20 / 12:04(分:秒);过一小时才补出小时位。 */
function elapsedLabel(sec) {
  let s = Math.floor(Number(sec) || 0);
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (v) => (v < 10 ? '0' + v : String(v));
  return h > 0 ? h + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss);
}

/** 「今天第 2 次 / 刚出发」那句。原型是写死的两句;这里按在走时长真算。 */
function sinceLabel(sec) {
  const s = Math.floor(Number(sec) || 0);
  if (s < 600) return '刚出发';
  if (s < 3600) return '走了半小时上下';
  return '走了一个多小时';
}

/**
 * 后端回包 → 地图与半屏都能直接用的一行。
 * 没有 memberId / 没有坐标的一律丢掉 —— 它们既画不出 marker,也点不开半屏。
 */
function normalizeRunners(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r) return;
    const id = Number(r.memberId) || 0;
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (id <= 0 || !isFinite(lat) || !isFinite(lng)) return;
    const sec = Number(r.elapsedSec) || 0;
    out.push({
      memberId: id,
      nickname: r.nickname || '漫游者',
      // 头像没下来时画首字。WXML 切不了字符串,所以在这儿切好。
      initial: String(r.nickname || '漫游者').slice(0, 1),
      avatar: r.avatar || '',
      lat, lng,
      color: runnerColor(id),
      explorePct: Math.max(0, Math.min(99, Number(r.explorePct) || 0)),
      shops: Math.max(0, Number(r.shops) || 0),
      elapsed: elapsedLabel(sec),
      since: sinceLabel(sec),
      // 「TA 点亮的店」那一排:只留真有图的,没图的格子在原型里根本不存在
      shopPhotos: (Array.isArray(r.shopPhotos) ? r.shopPhotos : [])
        .filter((s) => s && s.image)
        .map((s) => ({ name: s.name || '', image: s.image })),
    });
  });
  return out;
}

module.exports = { RUNNER_COLORS, runnerColor, elapsedLabel, sinceLabel, normalizeRunners };
