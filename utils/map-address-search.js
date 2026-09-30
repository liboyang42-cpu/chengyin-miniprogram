'use strict';
/* 顶部输入地址的匹配与配色(2026-09-09 裁决 §6.1)。
 * 抽出来是因为四个模式共用同一件,而「哪种结果配哪种颜色的针」是产品口径,
 * 不该埋在某一页的渲染代码里。 */

const { MAP_AVATAR_COLORS: C } = require('./play-visual-tokens.js');

// 结果四类 → 针的颜色。有局的地方和没有局的地方都是中性灰:
// 它们的区别写在副标题里(「没有局」),不靠颜色区分 —— 两个灰再分深浅就没人看得出来了。
//
// ★ 2026-09-09 按原型逐条对过(用户裁决:所有页面与 HTML 一模一样):
//   中性灰 #8A8A8E —— 原型 ADDR 数组里三条无玩法结果用的都是它(原来我写的 #9AA1AC 是自己挑的)。
//   ⚠️ 原型 ADDR 里那条城市定向结果的针写的是 #56AE7D,**这一处没照搬**:
//      同一份原型文件的地图点位代码写的是 `o.t==='flagG'?'#4ADE80':'#5A90D6'`,
//      而 #56AE7D 只出现在一个声明了却没人用的 `--flagG` 变量里 —— 它是旧旗子设计的遗留。
//      照搬会把「同一个玩法在地图上和搜索结果里是两种绿」这个 bug 一起搬过来,
//      所以取 #4ADE80(它也是说明文档 §1 定死的值,两处一致)。
const NEUTRAL_PIN = '#8A8A8E';
const PIN_COLORS = Object.freeze({
  hangout: NEUTRAL_PIN,
  city: C.cityRoute,
  free: C.freeExplore,
  none: NEUTRAL_PIN,
});

function pinColorForKind(kind) {
  return PIN_COLORS[kind] || NEUTRAL_PIN;
}

/** 没有局的地方副标题直接写「没有局」,不留空行 —— 空副标题会让这一行看起来是加载没完。 */
function subtitleFor(place) {
  const p = place || {};
  if (p.kind === 'none') return '没有局';
  return p.address || p.sub || '';
}

/**
 * 按输入过滤地址。
 * 匹配三路,任意一路命中即可:
 *   ① 名称 / 地址包含这段文字(中文直接打字);
 *   ② 全拼前缀;③ 首字母前缀(敲 xhbj 只剩「徐汇滨江」)。
 * ⚠️ ②③ 依赖每条地址自带 pinyin / initials 字段。当前 /api/map/nearby 不返回这两个字段,
 *    所以线上实际只有 ① 生效 —— 需要后端补 namePinyin / nameInitials 才能真正打字母。
 *    这里不在前端造拼音:那要带一整本字典进主包,而主包资源棘轮是只准降的。
 */
function matchPlaces(places, query) {
  const list = Array.isArray(places) ? places : [];
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((p) => {
    const it = p || {};
    const name = String(it.name || '').toLowerCase();
    const addr = String(it.address || '').toLowerCase();
    if (name.indexOf(q) >= 0 || addr.indexOf(q) >= 0) return true;
    const pinyin = String(it.pinyin || '').toLowerCase();
    const initials = String(it.initials || '').toLowerCase();
    return (!!pinyin && pinyin.indexOf(q) === 0) || (!!initials && initials.indexOf(q) === 0);
  });
}

/** 渲染前把每条补上针色和副标题,页面不用各自再算一遍。 */
function decoratePlaces(places) {
  return (Array.isArray(places) ? places : []).map((p) => Object.assign({}, p, {
    pinColor: pinColorForKind(p && p.kind),
    sub: subtitleFor(p),
  }));
}

module.exports = { PIN_COLORS, NEUTRAL_PIN, pinColorForKind, subtitleFor, matchPlaces, decoratePlaces };
