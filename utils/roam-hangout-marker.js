'use strict';
// 附近的局 · 地图 marker 画法(纯函数,喂任意 2d ctx)。
// 规范:Figma《V2｜城瘾游戏头像地图》—— 头像是主角,身份靠外框:个人=圆,商家=方+店招棚,限时活动=粉框倒计时;
// 状态靠环色:青=自己/已加入,金=商家可互动,灰=已满/已完成,奶油=个人局。色值只从 play-visual-tokens 取。
// 角标(Figma 5062:13368 marker set):个人局右上人数圆徽(已加入青 / 已满灰「满」/ 其余奶油);商家局右下红色人数徽;
// 限时活动不挂徽,倒计时写在名牌里。
const { MAP_AVATAR_COLORS: C } = require('./play-visual-tokens.js');

const NEAR_M = 300;          // ≤300m 长成头像,否则远距点(LOD)
const ICON_MAX = 24;         // 一屏最多生成多少张头像图标
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function parseWhen(v) {
  if (!v) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[T ]+(\d{2}):(\d{2}))?/.exec(String(v));
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] == null ? null : +m[4], mi: m[5] == null ? null : +m[5] };
}

/**
 * 时间口语化(卡片 / 列表 / 面板共用):{ label: '今晚'|'明天'|'周六'|'9/12', hm: '20:00'|'', short: '今晚 8:00' }。
 * 只有日期没时分时 hm 为空,short 只给 label。now 可注入(单测)。
 */
function whenParts(v, now) {
  const p = parseWhen(v);
  if (!p) return { label: '', hm: '', short: '' };
  const n = now ? new Date(now) : new Date();
  const dayOf = (y, mo, d) => Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  const diff = dayOf(p.y, p.mo, p.d) - dayOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
  let label;
  if (diff === 0) label = p.h != null && p.h >= 17 ? '今晚' : '今天';
  else if (diff === 1) label = '明天';
  else if (diff > 1 && diff < 7) label = WEEK[new Date(p.y, p.mo - 1, p.d).getDay()];
  else label = p.mo + '/' + p.d;
  const hm = p.h == null ? '' : (p.h < 10 ? '0' : '') + p.h + ':' + (p.mi < 10 ? '0' : '') + p.mi;
  // 「今晚」自带下午语境才用 12 小时制(今晚 8:00);其余保留 24 小时制,免得「明天 7:30」分不清早晚
  const spoken = label === '今晚' ? (p.h > 12 ? p.h - 12 : p.h) + ':' + (p.mi < 10 ? '0' : '') + p.mi : hm;
  return { label, hm, short: hm ? label + ' ' + spoken : label };
}

/** 限时活动倒计时角标:24h 内给「HH:MM」剩余,已开始给「进行中」,更远给 M/D;没档期空串 */
function countdownBadge(v, now) {
  const p = parseWhen(v);
  if (!p) return '';
  const start = new Date(p.y, p.mo - 1, p.d, p.h == null ? 0 : p.h, p.mi == null ? 0 : p.mi).getTime();
  const diff = start - (now ? new Date(now).getTime() : Date.now());
  if (diff <= 0) return '进行中';
  if (diff <= 86400000) {
    const mins = Math.floor(diff / 60000);
    const h = Math.floor(mins / 60); const m = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  return p.mo + '/' + p.d;
}

/** 从 nearby item 推出 marker 形态。now 可注入 */
function markerSpec(item, now) {
  const it = item || {};
  if (it.kind === 'topic') {
    // 发布出去的主题(1 城市定向 / 2 自由探索):照片瓦片,描边色按**玩法**分 —— 定向绿 / 探索蓝。
    // 2026-09-09 改口径:此前描边按**发布者身份**(商家金 / 玩家奶油),于是同一条线路
    // 换个人发就换个颜色,而地图上真正要一眼分清的是「这是有顺序的线路还是没顺序的主题」。
    // ⚠️ 原型的 flagG / flagB 点位**不带角标**:玩法只靠描边颜色分
    //   (原型注释原话:「旗子删了:玩法靠描边颜色分 —— 绿=城市定向 蓝=自由探索」)。
    //   现码原来在瓦片底部画一块写「定向 / 探索」的铭牌 —— 原型没有,删掉。
    const free = Number(it.productType) === 2;
    return { role: 'topic', state: 'open', color: free ? C.freeExplore : C.cityRoute,
      initial: String(it.name || '').slice(0, 1), badge: '' };
  }
  if (it.kind === 'activity') {
    const timed = !!(it.startDate || it.endDate || it.startAt);
    return { role: timed ? 'event' : 'merchant', state: 'open', color: timed ? C.event : C.merchant,
      initial: String(it.name || '').slice(0, 1), badge: timed ? countdownBadge(it.startAt || it.startDate, now) : '' };
  }
  const role = it.ownerRole === 'merchant' || it.ownerRole === 'club' ? 'merchant' : 'player';
  const state = it.isMember ? 'joined' : it.full ? 'full' : 'open';
  const color = state === 'joined' ? C.player : state === 'full' ? C.dim : role === 'merchant' ? C.merchant : C.cream;
  const n = Number(it.memberCount) || 0;
  return { role, state, color, initial: String(it.ownerNickname || it.title || '').slice(0, 1),
    badge: state === 'full' ? '满' : n > 0 ? String(n) : '' };
}

function iconKey(spec, initial) {
  return 'hg-' + spec.role + '-' + spec.state + '-' + encodeURIComponent(initial || '').slice(0, 12) + '-' + encodeURIComponent(spec.badge || '');
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr); g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr); g.arcTo(x, y, x + w, y, rr); g.closePath();
}

/* ★★ 以下几何逐条照原型 .mk 抄(2026-09-09 用户裁决:所有页面与 HTML 一模一样)★★
 *
 * 原型里点位盒是 52 CSS px 见方,挂件挑出盒外:
 *   角标 right:-10 top:-6 · 星星 right:-10 top:-11 · 图钉 right:-22 top:-26 · 头像堆 left:-8 bottom:-9
 * 所以真正要画的范围是 x∈[-8, 74]、y∈[-26, 61],合 82×87。
 * 把这 87 装进 S=108 的画布 ⇒ k = S/87,原点偏移 (8k, 26k)。
 * 下面所有数字都是原型的 CSS px,经 P() / K() 换算,一个都不是重估的。 */
const PROTO_BOX = 52;      // 原型 .mk 的点位盒
const PROTO_SPAN = 87;     // 含挂件的实际绘制范围(见上)
const PROTO_OX = 8;        // 原点相对盒左上角的偏移(头像堆挑出去 8)
const PROTO_OY = 26;       // 同上(图钉挑出去 26)

/** 原型坐标 → 画布坐标 */
function protoScale(S) {
  const k = S / PROTO_SPAN;
  return { k, x: (v) => (v + PROTO_OX) * k, y: (v) => (v + PROTO_OY) * k, n: (v) => v * k };
}

/** 五角星 = 这家有玩法。原型 STAR:40 视口里的路径,填 + 描边都是 #F5B301,描边 3.2。 */
function drawStar(g, cx, cy, size) {
  const r = size / 2;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    // 原型路径的外/内半径比约 0.5(20→10.1),起点在正上
    const rad = (i % 2 === 0 ? r : r * 0.5);
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const x = cx + rad * Math.cos(a); const y = cy + rad * Math.sin(a);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = C.gameStar; g.fill();                     /* ds-ok 原型 fill #F5B301 */
  g.lineWidth = Math.max(1, size * 0.08); g.strokeStyle = C.gameStar; g.stroke();
}

/** 角标里的一枚很小的单色小人(原型 PERSON:8×8,数字前 2px)。 */
function personGlyph(g, x, y, color, size) {
  const r = size / 2;
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y - r * 0.32, r * 0.35, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x, y + r * 0.45, r * 0.55, Math.PI, Math.PI * 2); g.fill();
}

/**
 * 角标。原型 .mk .badge:
 *   right:-10 top:-6 · padding 2px 5px · radius 999 · border 2px #000
 *   底色默认 cream #EFE7D6、字 #111,「满」那枚由调用方给 bcol/bfg
 *   纯数字的前面带一枚 PERSON —— 人数和站点编号都是光秃秃的数字,靠位置分不出来
 */
function badgePill(g, P, text, bg, fg) {
  const t = String(text);
  const withPerson = /^\d+$/.test(t);
  const fontPx = P.n(9);                                   /* 原型 9px 800 */
  g.font = 'bold ' + Math.round(fontPx) + 'px sans-serif';
  const textW = g.measureText(t).width;
  const glyph = withPerson ? P.n(8) + P.n(2) : 0;          /* 8px 小人 + 2px 间距 */
  const padX = P.n(5); const padY = P.n(2);
  const h = fontPx + padY * 2 + P.n(4);
  const w = textW + glyph + padX * 2;
  // right:-10 top:-6 ⇒ 右边缘落在盒右 +10
  const right = P.x(PROTO_BOX + 10); const top = P.y(-6);
  const x = right - w;
  roundRect(g, x, top, w, h, h / 2);
  g.fillStyle = bg; g.fill();
  g.lineWidth = P.n(2); g.strokeStyle = '#000000'; g.stroke();  /* ds-ok 原型 border 2px #000 */
  g.textAlign = 'left'; g.textBaseline = 'middle';
  if (withPerson) personGlyph(g, x + padX + P.n(4), top + h / 2, fg, P.n(8));
  g.fillStyle = fg;
  g.fillText(t, x + padX + glyph, top + h / 2);
}

/**
 * 画一张 S×S 的 marker,几何逐条照原型 .mk。
 * img 可空(空则画首字),这样没头像 / 头像域名没配也不会少点。
 *   player   → 原型 .av    圆头像 + 3px 奶油描边
 *   merchant → 原型 .awn   红白条纹店招棚 + 店内照
 *   topic    → 原型 .fthumb 照片瓦片 + 描边色(定向绿 / 探索蓝)
 *   event    → 同 .fthumb,描边取限时活动粉
 * self=true 画「自己」:外圈淡青光环。
 */
function drawMarker(g, S, spec, img) {
  const s = spec || {}; const P = protoScale(S);
  g.clearRect(0, 0, S, S);
  const boxX = P.x(0); const boxY = P.y(0); const box = P.n(PROTO_BOX);
  const border = P.n(3);                                   /* 原型三种点位的描边都是 3px */

  const drawFace = (clipFn, x, y, w, h) => {
    g.save(); clipFn(); g.clip();
    if (img) { const n = Math.max(1, Math.min(img.width, img.height)); g.drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, x, y, w, h); }
    else {
      g.fillStyle = C.panel; g.fillRect(x, y, w, h);
      g.fillStyle = C.cream; g.font = 'bold ' + Math.round(h * 0.42) + 'px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.initial || '局', x + w / 2, y + h / 2 + 1);
    }
    g.restore();
  };

  if (s.role === 'player') {
    // 原型 .mk .av:52 圆 · 3px 奶油描边 · shadow 0 6px 18px rgba(0,0,0,.55)
    if (s.self) { g.globalAlpha = 0.25; g.beginPath(); g.arc(boxX + box / 2, boxY + box / 2, box * 0.78, 0, Math.PI * 2); g.fillStyle = C.player; g.fill(); g.globalAlpha = 1; }
    g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = P.n(18); g.shadowOffsetY = P.n(6);
    g.beginPath(); g.arc(boxX + box / 2, boxY + box / 2, box / 2, 0, Math.PI * 2);
    g.fillStyle = s.color; g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    const r = box / 2 - border;
    drawFace(() => { g.beginPath(); g.arc(boxX + box / 2, boxY + box / 2, r, 0, Math.PI * 2); },
      boxX + border, boxY + border, r * 2, r * 2);
    if (s.state === 'full') { g.globalAlpha = 0.45; g.beginPath(); g.arc(boxX + box / 2, boxY + box / 2, r, 0, Math.PI * 2); g.fillStyle = C.panel; g.fill(); g.globalAlpha = 1; }
  } else if (s.role === 'merchant') {
    // 原型 .awn:棚 top:4 h:16 左右满宽 radius 4,红白 7px 交替;
    //          店内照 left:3 top:17 right:3 bottom:0,radius 3 3 7 7,底 #39434f
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = P.n(16); g.shadowOffsetY = P.n(6);
    roundRect(g, boxX + P.n(3), boxY + P.n(17), box - P.n(6), P.n(35), P.n(7));
    g.fillStyle = '#39434F'; g.fill();                     /* ds-ok 原型 .awn i 底色 */
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    drawFace(() => roundRect(g, boxX + P.n(3), boxY + P.n(17), box - P.n(6), P.n(35), P.n(7)),
      boxX + P.n(3), boxY + P.n(17), box - P.n(6), P.n(35));
    // 棚:7px 红 / 7px 白 交替
    g.save();
    roundRect(g, boxX, boxY + P.n(4), box, P.n(16), P.n(4)); g.clip();
    const stripe = P.n(7);
    for (let x = 0, i = 0; x < box; x += stripe, i++) {
      g.fillStyle = i % 2 ? '#FFFFFF' : '#E24B3C';         /* ds-ok 原型 repeating-linear-gradient */
      g.fillRect(boxX + x, boxY + P.n(4), stripe + 1, P.n(16));
    }
    g.restore();
  } else {
    // 原型 .fthumb:52 见方 · radius 12 · 3px 描边(颜色 = 玩法)· shadow 0 6px 18px rgba(0,0,0,.6)
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = P.n(18); g.shadowOffsetY = P.n(6);
    roundRect(g, boxX, boxY, box, box, P.n(12));
    g.fillStyle = s.color; g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    const inset = border;
    drawFace(() => roundRect(g, boxX + inset, boxY + inset, box - inset * 2, box - inset * 2, P.n(9)),
      boxX + inset, boxY + inset, box - inset * 2, box - inset * 2);
  }

  // 星星 = 这家有玩法。原型 .gamedot:26 见方,right:-10 top:-11
  if (s.game) drawStar(g, P.x(PROTO_BOX + 10) - P.n(13), P.y(-11) + P.n(13), P.n(26));
  // 角标。「满」那枚由 markerSpec 给的 state 决定配色,与原型 bcol/bfg 同义
  if (s.badge) {
    const bg = s.state === 'joined' ? C.player : s.state === 'full' ? '#3A3F47' : C.cream;
    const fg = s.state === 'full' ? '#8A93A0' : C.panel;   /* ds-ok 原型 bcol/bfg */
    badgePill(g, P, s.badge, bg, fg);
  }
}

/** 远距点:按角色色的小圆点 */
function drawFarDot(g, S, color) {
  g.clearRect(0, 0, S, S);
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.32, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.lineWidth = Math.max(2, S * 0.08); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke();
}

module.exports = { NEAR_M, ICON_MAX, whenParts, countdownBadge, markerSpec, iconKey, drawMarker, drawFarDot };
