'use strict';
// 漫游·附近的局:页面之外的纯函数(marker 构造 / 空态文案 / 表单校验),便于单测钉住。
// 契约:无坐标不画点(与 searchmap.createMarkersFromActivities 同一条铁律)。
// marker id 必须是数字(微信 <map> 契约):局 = id*10+1,活动 = id*10+2,主题 = id*10+3,三类不撞号。

const HANGOUT_FALLBACK_ICON = '/images/d_smapicon.png';
const TITLE_MIN = 2;
const TITLE_MAX = 30;
const DESC_MAX = 120;

function numOrNull(v) {
  // Number(null) / Number('') 都是 0,会把「没坐标」画到几内亚湾 —— 空值先拦
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const { NEAR_M, markerSpec, iconKey, whenParts } = require('./roam-hangout-marker.js');
const { MAP_AVATAR_COLORS: C } = require('./play-visual-tokens.js');

/**
 * items 来自 GET /api/roam/hangout/nearby;icons = 已生成的 tempFilePath 表({key: path});farIcons = {color: path}。
 * LOD:distance ≤ NEAR_M 且有头像图 → 54px 头像 marker + 名牌;否则远距点(14px,无文字)。
 * 没生成出图的一律先用远距点,一个点位都不少。
 */
function buildHangoutMarkers(items, icons, farIcons) {
  const ic = icons || {}; const far = farIcons || {};
  const out = [];
  (items || []).forEach((it) => {
    if (!it) return;
    const lat = numOrNull(it.latitude);
    const lng = numOrNull(it.longitude);
    if (lat == null || lng == null) return;
    const isHangout = it.kind === 'hangout';
    const isTopic = it.kind === 'topic';
    const spec = markerSpec(it);
    const near = numOrNull(it.distance) != null && Number(it.distance) <= NEAR_M;
    const key = iconKey(spec, spec.initial);
    const nearIcon = near && ic[key];
    const m = {
      id: Number(it.id) * 10 + (isHangout ? 1 : isTopic ? 3 : 2),
      latitude: lat, longitude: lng,
      width: nearIcon ? 54 : 14, height: nearIcon ? 54 : 14,
      anchor: { x: 0.5, y: 0.5 },
      zIndex: spec.state === 'joined' ? 12 : isHangout ? 10 : 5,
      iconPath: nearIcon || far[spec.color] || HANGOUT_FALLBACK_ICON,
    };
    if (nearIcon) {
      // 名牌按身份换色(Figma marker set):个人局深底奶油字写标题;商家局金底写「商家局 · N 人」;限时活动粉底写倒计时
      const plate = spec.role === 'merchant' && isHangout
        ? { content: '商家局 · ' + (Number(it.memberCount) || 0) + ' 人', color: C.panel, bgColor: C.merchant }
        : spec.role === 'event'
          ? { content: spec.badge || String(it.name || ''), color: C.cream, bgColor: C.event }
          : { content: isHangout ? String(it.title || '') : String(it.name || ''), color: C.cream, bgColor: C.panel + 'E6' };
      m.callout = Object.assign({ fontSize: 11, borderRadius: 10, padding: 6, display: 'ALWAYS' }, plate);
    }
    out.push(m);
  });
  return out;
}

const SELF_MARKER_ID = 9;   // 末位 9:parseMarkerId 不认,点它不弹卡

/** 「我」的 marker(Figma S01:青环头像,位于定位点)。icon 没生成时不画,别用别的图冒充自己 */
function buildSelfMarker(center, icon) {
  if (!center || !icon) return [];
  const lat = numOrNull(center.lat); const lng = numOrNull(center.lng);
  if (lat == null || lng == null) return [];
  return [{ id: SELF_MARKER_ID, latitude: lat, longitude: lng, width: 58, height: 58, anchor: { x: 0.5, y: 0.5 }, zIndex: 20, iconPath: icon }];
}

/** 300 m 头像圈(LOD 半径可视化,Figma S01 的虚线圈;微信 circle 不支持虚线,用淡青细线) */
function buildRangeCircle(center) {
  if (!center) return [];
  const lat = numOrNull(center.lat); const lng = numOrNull(center.lng);
  if (lat == null || lng == null) return [];
  return [{ latitude: lat, longitude: lng, radius: NEAR_M, color: C.player + '55', fillColor: C.player + '0D', strokeWidth: 1 }];
}

/** marker id → {kind,id};非本页 marker 返回 null。 */
function parseMarkerId(markerId) {
  const n = Number(markerId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const tag = n % 10;
  const id = Math.floor(n / 10);
  if (tag === 1) return { kind: 'hangout', id };
  if (tag === 2) return { kind: 'activity', id };
  if (tag === 3) return { kind: 'topic', id };
  return null;
}

function fmtKm(m) {
  const n = numOrNull(m);
  if (n == null) return '';
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'km' : Math.round(n) + 'm';
}

/** 空态文案:后端给了 suggestedRadius 就引导拉远,否则引导开局。 */
function emptyStateCopy(radiusM, suggested) {
  const here = fmtKm(radiusM);
  if (suggested && Number(suggested.radius) > 0 && Number(suggested.count) > 0) {
    // Figma S02:「还没有局 / 雾再远一点,20 km 内有 7 个局在约。/ 看远一点 / 或者,在这里开一局」
    return {
      title: '还没有局',
      sub: '雾再远一点,' + fmtKm(suggested.radius) + ' 内有 ' + Number(suggested.count) + ' 个局在约。',
      primary: '看远一点',
      secondary: '或者,在这里开一局',
      action: 'expand',
      radiusText: here,
    };
  }
  return { title: '还没有局', sub: '开一个,让附近的人找到你。', primary: '在这里开一局', secondary: '', action: 'create', radiusText: here };
}

/** 建局表单校验;返回 null 表示通过,否则返回第一条错误文案(指明哪道闸)。 */
function validateHangoutForm(form) {
  const f = form || {};
  const title = String(f.title || '').trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return '标题 ' + TITLE_MIN + '–' + TITLE_MAX + ' 字';
  if (String(f.description || '').trim().length > DESC_MAX) return '说明最多 ' + DESC_MAX + ' 字';
  if (numOrNull(f.lat) == null || numOrNull(f.lng) == null) return '请选择地点';
  return null;
}

module.exports = {
  buildHangoutMarkers, buildSelfMarker, buildRangeCircle, SELF_MARKER_ID, whenParts, parseMarkerId, emptyStateCopy, validateHangoutForm, fmtKm, numOrNull,
  HANGOUT_FALLBACK_ICON, TITLE_MIN, TITLE_MAX, DESC_MAX,
};
