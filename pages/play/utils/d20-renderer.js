// Native Canvas 2D rasterizes a real, perspective-projected icosahedron.
// ponytail: convex mesh needs only back-face culling; no engine or physics dependency.
const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => v.map((x) => x / Math.hypot.apply(null, v));
const phi = (1 + Math.sqrt(5)) / 2;
const vertices = [
  [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
  [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
  [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
].map(unit);
const edge = dot(sub(vertices[0], vertices[1]), sub(vertices[0], vertices[1]));
const adjacent = (a, b) => Math.abs(dot(sub(a, b), sub(a, b)) - edge) < 1e-8;
const faces = [];
for (let a = 0; a < 12; a++) {
  for (let b = a + 1; b < 12; b++) {
    for (let c = b + 1; c < 12; c++) {
      const points = [vertices[a], vertices[b], vertices[c]];
      if (!adjacent(points[0], points[1]) || !adjacent(points[1], points[2]) || !adjacent(points[2], points[0])) continue;
      const center = points[0].map((_, i) => (points[0][i] + points[1][i] + points[2][i]) / 3);
      let normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
      if (dot(normal, center) < 0) { points.reverse(); normal = normal.map((x) => -x); }
      const up = unit(sub(points[0], center));
      faces.push({ points, center, normal, up, right: cross(up, normal), value: 0 });
    }
  }
}
let value = 1;
faces.forEach((face) => {
  if (face.value) return;
  face.value = value++;
  faces.find((other) => dot(face.normal, other.normal) < -.999).value = 21 - face.value;
});

function multiply(a, b) {
  const v = cross(a, b).map((x, i) => x + a[i] * b[3] + b[i] * a[3]);
  return v.concat(a[3] * b[3] - dot(a.slice(0, 3), b.slice(0, 3)));
}
function rotate(q, point) {
  const t = cross(q, point).map((x) => x * 2);
  const c = cross(q, t);
  return point.map((x, i) => x + q[3] * t[i] + c[i]);
}
function axisAngle(axis, angle) {
  return unit(axis).map((x) => x * Math.sin(angle / 2)).concat(Math.cos(angle / 2));
}
function orientFace(number) {
  const face = faces.find((f) => f.value === number);
  if (!face) throw new Error('D20 点数必须为 1–20');
  const n = face.normal;
  const q = n[2] < -.999999 ? [1, 0, 0, 0] : unit([n[1], -n[0], 0, 1 + n[2]]);
  const up = rotate(q, face.up);
  return multiply(axisAngle([0, 0, 1], Math.atan2(up[0], up[1])), q);
}
function slerp(a, b, t) {
  let cosine = dot(a, b);
  if (cosine < 0) { b = b.map((x) => -x); cosine = -cosine; }
  if (cosine > .9995) return unit(a.map((x, i) => x + (b[i] - x) * t));
  const angle = Math.acos(Math.min(1, cosine));
  return a.map((x, i) => (x * Math.sin((1 - t) * angle) + b[i] * Math.sin(t * angle)) / Math.sin(angle));
}

function createD20Renderer(canvas, width, height, count, pixelRatio, onDone, onError) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建骰子画布');
  const dpr = Math.min(pixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  let poses = Array.from({ length: count }, (_, i) => orientFace(i ? 7 : 20));
  let frame = null;
  let disposed = false;
  let started = 0;
  let phase = '';
  let from = poses;
  let targets = poses;
  let selected = -1;
  let focus = 0;
  const light = unit([-1, 2, 3]);

  function draw(lift) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const baseRadius = Math.min(height * .31, width / count * .33);
    poses.forEach((q, i) => {
      const chosen = selected === i;
      if (selected >= 0 && !chosen && focus === 1) return;
      const radius = baseRadius + (chosen ? focus * (Math.min(height * .4, width * .27) - baseRadius) : 0);
      const startX = width * (i + .5) / count;
      const x = startX + (chosen ? (width / 2 - startX) * focus : 0);
      ctx.save();
      ctx.globalAlpha = selected >= 0 && !chosen ? 1 - focus : 1;
      const y = height * .46 - lift * radius;
      const project = (p) => [x + p[0] * radius * 4 / (4 - p[2]), y - p[1] * radius * 4 / (4 - p[2])];
      ctx.save();
      ctx.translate(x, height * .85);
      ctx.scale(radius, radius * .18);
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      shadow.addColorStop(0, 'rgba(0,0,0,.65)');
      shadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadow;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
      faces.forEach((face) => {
        const normal = rotate(q, face.normal);
        const center = rotate(q, face.center);
        if (dot(normal, sub([0, 0, 4], center)) <= 0) return;
        const points = face.points.map((p) => project(rotate(q, p)));
        const shade = Math.round(85 + 140 * Math.max(0, dot(normal, light)));
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        points.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
        ctx.closePath();
        // ds-ok: native canvas material follows the player's neutral palette.
        ctx.fillStyle = 'rgb(' + shade + ',' + shade + ',' + (shade + 3) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.lineWidth = .8;
        ctx.stroke();
        const origin = project(center);
        const right = project(rotate(q, face.center.map((v, j) => v + face.right[j] * .4)));
        const down = project(rotate(q, face.center.map((v, j) => v - face.up[j] * .4)));
        ctx.save();
        ctx.clip();
        ctx.transform((right[0] - origin[0]) / 24, (right[1] - origin[1]) / 24,
          (down[0] - origin[0]) / 24, (down[1] - origin[1]) / 24, origin[0], origin[1]);
        ctx.fillStyle = '#16161a'; // ds-ok: engraved numeral, same neutral material.
        ctx.font = '600 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(face.value), 0, 0);
        if (face.value === 6 || face.value === 9) ctx.fillRect(-5, 13, 10, 1.5);
        ctx.restore();
      });
      ctx.restore();
    });
  }
  function stop() {
    if (frame !== null) canvas.cancelAnimationFrame(frame);
    frame = null;
    phase = '';
  }
  function tick() {
    try { animate(); }
    catch (error) { stop(); onError(error); }
  }
  function animate() {
    if (disposed || !phase) return;
    const elapsed = Date.now() - started;
    const t = Math.min(1, elapsed / 1150);
    if (phase === 'settle') {
      const eased = 1 - Math.pow(1 - t, 3);
      poses = from.map((q, i) => multiply(axisAngle([1, 1.6, .4], 4 * Math.PI * (1 - eased)), slerp(q, targets[i], eased)));
      draw(Math.sin(Math.PI * t) * .28);
      if (t === 1) {
        poses = targets;
        if (selected >= 0) { phase = 'focus'; started = Date.now(); }
        else { stop(); onDone(); return; }
      }
    } else if (phase === 'focus') {
      const progress = Math.min(1, Math.max(0, (elapsed - 220) / 650));
      focus = progress * progress * (3 - 2 * progress);
      draw(0);
      if (progress === 1) { stop(); onDone(); return; }
    } else {
      poses = from.map((q, i) => multiply(axisAngle([1, 1.6, .4 + i], elapsed / 140), q));
      draw(Math.abs(Math.sin(elapsed / 220)) * .25);
      // A failed request must not leave the button locked; retries are server-idempotent.
      if (elapsed >= 8000) { stop(); onDone(); return; }
    }
    frame = canvas.requestAnimationFrame(tick);
  }
  draw(0);
  return {
    roll(reducedMotion) {
      stop(); selected = -1; focus = 0; draw(0); from = poses; started = Date.now(); phase = 'roll';
      if (!reducedMotion) tick();
    },
    settle(values, kept, immediate) {
      if (!Array.isArray(values) || values.length !== count) throw new Error('D20 骰点数量异常');
      targets = values.map(orientFace);
      stop(); selected = count === 2 ? values.indexOf(kept) : -1; focus = 0;
      if (immediate) { poses = targets; focus = selected >= 0 ? 1 : 0; draw(0); onDone(); return; }
      from = poses; started = Date.now(); phase = 'settle'; tick();
    },
    dispose() { disposed = true; stop(); },
  };
}

module.exports = { createD20Renderer, faces, orientFace, rotate };
