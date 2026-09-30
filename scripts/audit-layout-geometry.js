#!/usr/bin/env node
/*
 * 布局几何审计：用 automator 逐页**真实回读** offset()/style()，机器量，不靠眼睛看截图。
 *
 *   UI_AUDIT_OUT=/tmp/geo node scripts/audit-layout-geometry.js
 *   node scripts/audit-layout-geometry.js --selftest
 *
 * 为什么要它(2026-08-19 实证):
 *   我在 143 张发版版本截图上肉眼找「间距/位置/按钮/卡片」问题,一轮里连续三次假阳性 ——
 *   B59「发布按钮被 tabBar 压住」(其实 .tpl-bottom-safe 留位够,只是内容还没滚完)、
 *   GO 按钮组「垂直不居中」(其实 .go-row align-items:center,是拼版缩略图的错觉)。
 *   **截图在固定滚动位置上证明不了几何**:裁在折叠线 ≠ 被遮挡,缩略图 ≠ 对齐关系。
 *   量出来的数才算数。
 *
 * 四条判据,全部只在**静止态**成立(不滚动、不交互),对应四类问题:
 *   P1 位置·出界   顶层可见元素的 left<0 或 right>屏宽 ⇒ 内容被裁在屏幕外
 *   P2 间距·不对称 页面级容器的左右外边距差 > 4px ⇒ 一边贴边一边留白
 *   P3 按钮·不等高 同一行(top 相差<4px)内的多个按钮高度差 > 4px
 *   P4 卡片·不等宽 同一纵向列表里相邻卡片宽度差 > 4px
 *
 * 阈值 4px:390pt 屏上 1rpx≈0.52px,4px≈8rpx,小于设计量表最小档,不会把有意的层级差判红。
 */
const THRESH = 4;

/** 纯函数判据层：与 automator 解耦，好做负控。box = {id, left, top, width, height, role} */
function judge(boxes, screenW) {
  const out = [];
  const base = (id) => id.replace(/\[\d+\].*$/, '');   // ".v2-fcard[3]#tl" -> ".v2-fcard"

  // 横滑判定:同类名、top 几乎相同、left 不同 ⇒ 是一行轮播/横向列表。
  // 这类元素**本来就该有一张在屏幕外**(peek),对它们套 P1/P2 是过报 ——
  // 2026-08-19 首跑实证:roam 的 .intro-card[1] right=674 被判「出界」,其实是下一张卡。
  const horiz = new Set();
  for (const a of boxes) for (const b of boxes) {
    if (a === b || base(a.id) !== base(b.id)) continue;
    if (Math.abs(a.top - b.top) < THRESH && Math.abs(a.left - b.left) > THRESH) {
      horiz.add(base(a.id));
    }
  }

  for (const b of boxes) {
    if (b.role !== 'toplevel' || horiz.has(base(b.id))) continue;
    if (b.left < -THRESH) out.push({ rule: 'P1', id: b.id, msg: `左边出界 left=${b.left}` });
    if (b.left + b.width > screenW + THRESH) {
      out.push({ rule: 'P1', id: b.id, msg: `右边出界 right=${b.left + b.width} > 屏宽 ${screenW}` });
    }
    const lm = b.left, rm = screenW - (b.left + b.width);
    if (Math.abs(lm - rm) > THRESH) {
      out.push({ rule: 'P2', id: b.id, msg: `左右外边距不对称 左${lm} / 右${rm}` });
    }
  }

  // ★P3 只比**真按钮组件**。「带 bindtap」远不等于「是按钮」:整张卡片、整行、头像、
  //   甚至 <map> 都可以 bindtap。2026-08-19 首跑 22 条命中全是这个 —— 其中最荒唐的是
  //   拿 844px 高的地图去比 41px 的定位钮。
  //   ⚠️ 同时排掉布局工具类(.flex-ac 这种):同一个类套在结构不同的元素上,
  //      「同类名」这个前提本身就不成立,比什么都没意义。
  const IS_REAL_BTN = /^(cy-btn|button)$|(^|[.-])btn(-|$)|(^|[.-])cta(-|$)/;
  const btns = boxes.filter((b) => b.role === 'button'
    && IS_REAL_BTN.test(b.id.replace(/^\./, '').replace(/\[\d+\].*$/, '')));
  for (let i = 0; i < btns.length; i += 1) {
    for (let j = i + 1; j < btns.length; j += 1) {
      if (Math.abs(btns[i].top - btns[j].top) < THRESH
          && Math.abs(btns[i].height - btns[j].height) > THRESH) {
        out.push({ rule: 'P3', id: `${btns[i].id}|${btns[j].id}`,
          msg: `同一行按钮不等高 ${btns[i].height} vs ${btns[j].height}` });
      }
    }
  }

  // P4 只比**同类名**的卡。不同类名 = 不同组件/不同区块,宽度本来就该不同 ——
  // 首跑把 .v3-nearby-card(169) 拿去比 .v2-fcell(60),6 条全是过报。
  const byClass = new Map();
  for (const b of boxes) {
    if (b.role !== 'card') continue;
    const k = base(b.id);
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push(b);
  }
  for (const [k, list] of byClass) {
    if (horiz.has(k)) continue;                 // 横滑列表宽度可以不同(末张常被裁)
    list.sort((a, b) => a.top - b.top);
    for (let i = 1; i < list.length; i += 1) {
      if (Math.abs(list[i].width - list[i - 1].width) > THRESH) {
        out.push({ rule: 'P4', id: `${list[i - 1].id}|${list[i].id}`,
          msg: `同一列表(${k})相邻卡片不等宽 ${list[i - 1].width} vs ${list[i].width}` });
      }
    }
  }
  return out;
}

function selftest() {
  const W = 390;
  const cases = [
    ['全绿:居中卡片 + 等高按钮 + 等宽卡',
      [{ id: 'a', left: 16, top: 0, width: 358, height: 100, role: 'toplevel' },
       { id: 'b1', left: 16, top: 200, width: 100, height: 44, role: 'button' },
       { id: 'b2', left: 130, top: 201, width: 100, height: 44, role: 'button' },
       { id: 'c1', left: 16, top: 300, width: 358, height: 80, role: 'card' },
       { id: 'c2', left: 16, top: 400, width: 358, height: 80, role: 'card' }], 0],
    ['负控 P1:右边出界必须红',
      [{ id: 'x', left: 16, top: 0, width: 400, height: 50, role: 'toplevel' }], 1],
    ['负控 P2:左右不对称必须红(左32 右0)',
      [{ id: 'x', left: 32, top: 0, width: 358, height: 50, role: 'toplevel' }], 1],
    // ⚠️ 这条**第二次**因为收紧判据而静默失效:原 id 'b1'/'b2' 不匹配 IS_REAL_BTN ⇒ 不比较。
    //    上一次是 P4 收紧成「只比同类名」后旧 id 无 [n] 后缀。**负控会过期,每次收紧判据都要回头验负控还红不红。**
    ['负控 P3:两个真按钮同行不等高必须红',
      [{ id: 'cy-btn[0]', left: 0, top: 10, width: 100, height: 44, role: 'button' },
       { id: 'cy-btn[1]', left: 120, top: 11, width: 100, height: 60, role: 'button' }], 1],
    // ⚠️ 这条原本写的 id 是 'c1'/'c2'(无 [n] 后缀),收紧成「只比同类名」之后
    //    它们被判成两个不同类名 ⇒ 不比较 ⇒ 负控自己失效了。负控也会过期。
    ['负控 P4:同一类名相邻卡片不等宽必须红',
      [{ id: '.c[0]', left: 16, top: 10, width: 358, height: 80, role: 'card' },
       { id: '.c[1]', left: 16, top: 110, width: 300, height: 80, role: 'card' }], 1],
    ['不误报:不同行的真按钮高度本来就可以不同',
      [{ id: 'cy-btn[0]', left: 0, top: 10, width: 100, height: 44, role: 'button' },
       { id: 'cy-btn[1]', left: 0, top: 200, width: 100, height: 60, role: 'button' }], 0],
    ['不误报:4px 以内的差属量表噪声',
      [{ id: 'x', left: 16, top: 0, width: 356, height: 50, role: 'toplevel' }], 0],
    ['不误报:横滑轮播的下一张在屏幕外是正常的',
      [{ id: '.c[0]#tl', left: 16, top: 100, width: 317, height: 80, role: 'toplevel' },
       { id: '.c[1]#tl', left: 357, top: 100, width: 317, height: 80, role: 'toplevel' }], 0],
    ['不误报:不同类名的卡片宽度本来就该不同',
      [{ id: '.big[0]', left: 16, top: 100, width: 358, height: 80, role: 'card' },
       { id: '.small[0]', left: 16, top: 200, width: 60, height: 60, role: 'card' }], 0],
    ['不误报:可点的容器不是按钮(地图 vs 定位钮)',
      [{ id: 'map[0]', left: 0, top: 10, width: 390, height: 844, role: 'button' },
       { id: '.location-btn[0]', left: 300, top: 12, width: 40, height: 41, role: 'button' }], 0],
    ['仍要红:两个真按钮同行不等高',
      [{ id: 'cy-btn[0]', left: 16, top: 10, width: 100, height: 44, role: 'button' },
       { id: 'cy-btn[1]', left: 130, top: 11, width: 100, height: 64, role: 'button' }], 1],
    ['仍要红:同一类名的卡片不等宽',
      [{ id: '.row[0]', left: 16, top: 100, width: 358, height: 80, role: 'card' },
       { id: '.row[1]', left: 16, top: 200, width: 300, height: 80, role: 'card' }], 1],
  ];
  let bad = 0;
  for (const [name, boxes, wantMin] of cases) {
    const got = judge(boxes, W);
    const ok = wantMin === 0 ? got.length === 0 : got.length >= wantMin;
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` → 实得 ${JSON.stringify(got)}`}`);
    if (!ok) bad += 1;
  }
  if (bad) { console.error(`selftest 失败 ${bad} 例`); process.exit(1); }
  console.log('selftest 通过:4 条判据各有负控,且两条「不该红」的场景没被误报');
}

if (process.argv.includes('--selftest')) { selftest(); process.exit(0); }
module.exports = { judge, THRESH };

/* ================= 采集层:automator 真实回读,不解析 wxml 猜 ================= */
// ★不再用通用类名猜。selectors.json 实证:这个 app 没有统一的 .card/.btn,
//   每页各叫各的(.oe-card / .mp-card / .result-card / .club-card / .v3-nearby-card…),
//   而小程序 SelectorQuery **不支持属性选择器**,[class*=card] 那条路也走不通。
//   ⇒ 先读该页自己的 wxss 拿到真实类名,再按语义分桶去量。样本来自代码,不是我编的。
const fsx = require('fs');
const pathx = require('path');

// ★不靠类名猜语义。第一版按 /card|cell|item|btn|cta/ 匹配类名,139 路由里 93 个零采样 ——
//   真实类名是 .about-section / .dz_li / .st-badge / .page,一个都不含那些词。
//   改成**从 WXML 取代码给的定义**:
//     · 带 bindtap/catchtap 的元素 = 按钮(能点的才是按钮)
//     · 带 wx:for 的元素 = 列表项(重复渲染的才是卡片)
//   这两个信号在 WXML 里是无歧义的,不依赖任何人的命名习惯。
function wxmlFor(xcxRoot, route) {
  const rel = route.replace(/^\//, '').split('?')[0];
  const cands = [pathx.join(xcxRoot, rel + '.wxml'), pathx.join(xcxRoot, rel, 'index.wxml')];
  const file = cands.find((p) => fsx.existsSync(p));
  return file ? fsx.readFileSync(file, 'utf8') : '';
}

// 从一个开标签里取第一个静态 class(含 {{}} 的动态段丢掉,只留能当选择器用的部分)
function staticClasses(tag) {
  const m = /class="([^"]*)"/.exec(tag);
  if (!m) return [];
  return m[1].split(/\s+/)
    // 只留能当选择器用的合法类名。不加这条会混进 '.<' 之类的畸形值(实测 club/apply 命中过)
    .filter((n) => /^[a-zA-Z][\w-]*$/.test(n))
    .map((n) => '.' + n);
}

// 组件化的页面常常「有 bind:tap、没有 class」(如 about 页的
// <cy-cell title="用户服务协议" bind:tap="openAgreement" />)。这时退回按**标签名**选,
// 自定义组件标签在 SelectorQuery 里是可选的。不退回就整页零采样 —— 而零采样判红,
// 等于把一堆本来能测的页面挡在门外。
function tagNameOf(tag) {
  const m = /^<([a-zA-Z][\w-]*)/.exec(tag);
  if (!m) return null;
  const t = m[1];
  // 原生组件(map/video/canvas/camera)整块可点是常态,它们不是按钮 —— 2026-08-19 实测
  // map[0](844px 高)被拿去跟 .location-btn(41px)比高度,纯过报。
  return /^(view|text|block|image|swiper|scroll-view|template|slot|map|video|canvas|camera|movable-view|movable-area)$/.test(t) ? null : t;
}

function selectorsForRoute(xcxRoot, route) {
  const wxml = wxmlFor(xcxRoot, route);
  if (!wxml) return { button: [], card: [] };
  const button = new Set(), card = new Set();
  for (const m of wxml.matchAll(/<[a-zA-Z][\w-]*\b[^>]*>/g)) {
    const tag = m[0];
    let cls = staticClasses(tag);
    const tappable = /\b(bind|catch):?tap\b/.test(tag);
    if (!cls.length) { const t = tagNameOf(tag); if (t && tappable) cls = [t]; }
    if (!cls.length) continue;
    if (tappable) cls.forEach((c) => button.add(c));
    if (/\bwx:for\b/.test(tag)) cls.forEach((c) => card.add(c));
  }
  // 同一个类既能点又是列表项时,算列表项(卡片),避免同一节点被量两次
  for (const c of card) button.delete(c);
  return { button: [...button], card: [...card] };
}

// 某个 class 是否被包在 <swiper> / <scroll-view> 里 —— 这类容器**本来就该**有元素露在
// 屏幕外或留出 next-margin,对它们套 P1/P2 是过报。
// 2026-08-19 实证:play 的 .intro-card 在 <swiper next-margin="96rpx"> 里(右57=next-margin),
// templatedetail 的 .xb-mosaic-cell 在 .xb-mosaic-scroll 里 —— 首轮 3 条命中全是这个盲区。
// ⚠️ 只按「同类名同 top 不同 left」判横滑不够:容器里只渲染 1 项时触发不了,所以要静态查结构。
function classesInScrollers(xcxRoot, route) {
  const wxml = wxmlFor(xcxRoot, route);
  const set = new Set();
  if (!wxml) return set;
  for (const m of wxml.matchAll(/<(swiper|scroll-view)\b[\s\S]*?<\/\1>/g)) {
    for (const c of m[0].matchAll(/class="([^"]*)"/g)) {
      for (const n of c[1].split(/\s+/)) if (/^[a-zA-Z][\w-]*$/.test(n)) set.add('.' + n);
    }
  }
  return set;
}

async function collectPage(page, xcxRoot, route) {
  const { button, card } = selectorsForRoute(xcxRoot, route);
  const inScroller = classesInScrollers(xcxRoot, route);
  const boxes = [];
  for (const [role, sels] of [['button', button], ['card', card]]) {
    for (const sel of sels) {
      let els = [];
      try { els = await page.$$(sel); } catch { continue; }
      for (let i = 0; i < els.length; i += 1) {
        try {
          const [off, sz] = await Promise.all([els[i].offset(), els[i].size()]);
          if (!off || !sz || !sz.width || !sz.height) continue;   // 不可见/零尺寸不计
          boxes.push({ id: `${sel}[${i}]`, role,
            left: Math.round(off.left), top: Math.round(off.top),
            width: Math.round(sz.width), height: Math.round(sz.height) });
        } catch { /* 单节点读失败不影响整页 */ }
      }
    }
  }
  // 卡片同时充当 toplevel:页面级卡片本就该左右对称、不出界
  // 只有**不在横滑容器里**的宽卡片才充当 toplevel 去做 P1/P2
  for (const b of boxes) {
    if (b.role === 'card' && b.width > 200 && !inScroller.has(b.id.replace(/\[\d+\].*$/, ''))) {
      boxes.push({ ...b, id: b.id + '#tl', role: 'toplevel' });
    }
  }
  return boxes;
}

async function main() {
  const infraPath = process.env.CY_INFRA || pathx.join(__dirname, '_infra.js');
  const infra = require(infraPath);
  const xcxRoot = process.env.CY_XCX_ROOT || pathx.resolve(__dirname, '..');
  const routes = (process.env.GEO_ROUTES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!routes.length) { console.error('需要 GEO_ROUTES=路由1,路由2'); process.exit(2); }
  const mini = await infra.launchFixed();
  const sysInfo = await mini.callWxMethod('getSystemInfoSync');
  const screenW = Math.round((sysInfo && sysInfo.windowWidth) || 390);
  console.log(`屏宽 ${screenW}px;阈值 ${THRESH}px;wxss 根 ${xcxRoot}`);
  let total = 0;
  const unsampled = [];
  for (const r of routes) {
    let page;
    try { page = await mini.reLaunch(r); await infra.wait(1400); }
    catch (e) { console.log(`  ${r}  打不开(${String(e.message).slice(0, 60)})`); unsampled.push(r); continue; }
    const boxes = await collectPage(page, xcxRoot, r);
    if (!boxes.length) { unsampled.push(r); console.log(`  ${r}  ✗ 采样 0 个节点(选择器与本页对不上,不算通过)`); continue; }
    const errs = judge(boxes, screenW);
    total += errs.length;
    console.log(`  ${r}  采样 ${boxes.length} → ${errs.length} 条`);
    for (const e of errs) console.log(`      [${e.rule}] ${e.id}  ${e.msg}`);
  }
  if (unsampled.length) console.log(`✗ ${unsampled.length}/${routes.length} 个路由零采样:${unsampled.join(', ')}`);
  console.log(total ? `合计 ${total} 条几何问题` : (unsampled.length ? '没有测到任何节点 —— 不构成通过' : '全部通过'));
  try { await mini.disconnect(); } catch {}
  process.exit(total || unsampled.length ? 1 : 0);
}
main().catch((e) => { console.error('采集失败:', e.message); process.exit(2); });
