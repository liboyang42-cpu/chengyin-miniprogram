// 藏品册物品堆的一小段物理(施工文档第四版 §3.3):掉落堆叠 / 聚成一团。
// 每件东西当一个圆算碰撞;只求「看着对」,不求真实。
// ponytail: 两两碰撞 O(n²),40 件 × 3 轮一帧约 2400 次,手机上够用;要上百件再换网格分桶。

const GRAVITY = 0.5;
const PULL = 0.0022;           // 聚团时往中心拉的力
const REST_SPEED = 0.6;        // 挨着地面或别的东西、又慢过这个数,就当停住了

/** 伪随机:同一个 seed 同一个结果,单测可复现。 */
function rand(seed) {
  let s = (seed * 16807) % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * 一件东西。fromTop = 从屏幕上方掉进来(切分类、新到手);否则直接放在地面附近(首屏少等一会儿)。
 * size 是画出来的边长;碰撞半径取它的 0.44 —— 物品图四角多是透明,按整块算会堆得太松。
 */
function body(item, world, opts) {
  const o = opts || {};
  const r01 = rand(o.seed || 1);
  const size = o.size || 40;
  const r = size * 0.44;
  return {
    item, size, r,
    x: r + 6 + r01() * (world.W - 2 * (r + 6)),
    y: o.fromTop ? -r - r01() * 520 : world.floor - r - r01() * 200,
    vx: 0, vy: 0,
    rot: (r01() - 0.5) * 1.4, vr: 0,
  };
}

function step(bodies, world, dt) {
  const d = dt || 1;
  for (const b of bodies) {
    b.contact = false;
    if (world.ball) {
      b.vx += (world.cx - b.x) * PULL * d;
      b.vy += (world.cy - b.y) * PULL * d;
      b.vx *= 0.9; b.vy *= 0.9; b.vr *= 0.95;
    } else {
      b.vy += GRAVITY * d;
    }
    b.x += b.vx * d; b.y += b.vy * d; b.rot += b.vr * d;
    bounds(b, world);
  }
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (dist <= 0 || dist >= min) continue;
        const o = (min - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const imp = -rv * 0.55;
          a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp;
        }
        a.vx *= 0.92; b.vx *= 0.92;
        a.contact = true; b.contact = true;
      }
    }
  }
  // 碰撞会把下面那件往下挤:挤完再夹一次,不然会穿过地面线
  for (const b of bodies) bounds(b, world);
  if (!world.ball) {
    // 只有「挨着东西」的才能停:半空里刚起步的速度也很小,不能被冻在空中
    for (const b of bodies) if (b.contact && Math.hypot(b.vx, b.vy) < REST_SPEED) { b.vx = 0; b.vy = 0; b.vr = 0; }
  }
}

function bounds(b, world) {
  if (b.y > world.floor - b.r) { b.y = world.floor - b.r; b.vy *= -0.12; b.vx *= 0.7; b.vr *= 0.6; b.contact = true; }
  if (b.x < b.r + 6) { b.x = b.r + 6; b.vx *= -0.3; }
  if (b.x > world.W - b.r - 6) { b.x = world.W - b.r - 6; b.vx *= -0.3; }
}

/** 都停住了:页面据此停掉逐帧重画(省电)。聚团时永远不算停(一直在轻轻挤)。 */
function settled(bodies) {
  return bodies.every((b) => b.vx === 0 && b.vy === 0 && b.y > 0);
}

/** 点中的那一件:从最后画的(最上面)往回找。 */
function hit(bodies, x, y) {
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (Math.hypot(x - b.x, y - b.y) < b.r * 1.1) return b;
  }
  return null;
}

module.exports = { body, step, settled, hit };
