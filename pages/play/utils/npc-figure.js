/**
 * 门店分身的低模人形:几何在代码里生成,不依赖任何模型资产。
 *
 * <p>为什么不接 glb / Rive:那两条都要先有一个文件。而「一个能真的转起来、
 * 有体积和明暗的人形」本身不需要资产 —— 几十个三角面 + 一次投影 + 画家算法就够,
 * canvas 2d 画得动,也不用把 three.js 塞进包体。
 *
 * <p>本模块是**纯函数**:只吐几何与亮度(0..1),不碰颜色也不碰 canvas。
 * 颜色留在调用点上色 —— 玩家端整页单色有契约扫描,色值必须待在被扫的文件里。
 */

/** 绕 Y 轴一圈取 n 个点的单位圆(cos/sin 预算好,每帧重算是浪费)。 */
function ring(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

/** 一段锥台:从 y0 半径 r0 到 y1 半径 r1,顶底可选封盖。 */
function tube(verts, faces, cx, cz, y0, r0, y1, r1, seg, capTop, capBottom) {
  var c = ring(seg), base = verts.length, i;
  for (i = 0; i < seg; i++) verts.push([cx + c[i][0] * r0, y0, cz + c[i][1] * r0]);
  for (i = 0; i < seg; i++) verts.push([cx + c[i][0] * r1, y1, cz + c[i][1] * r1]);
  for (i = 0; i < seg; i++) {
    var j = (i + 1) % seg;
    faces.push([base + i, base + j, base + seg + j]);
    faces.push([base + i, base + seg + j, base + seg + i]);
  }
  if (capTop) {
    var t = verts.length; verts.push([cx, y1, cz]);
    for (i = 0; i < seg; i++) faces.push([base + seg + i, base + seg + (i + 1) % seg, t]);
  }
  if (capBottom) {
    var b = verts.length; verts.push([cx, y0, cz]);
    for (i = 0; i < seg; i++) faces.push([base + (i + 1) % seg, base + i, b]);
  }
}

/** 一颗球(UV 球,横 seg 纵 rings)。 */
function sphere(verts, faces, cx, cy, cz, r, seg, rings) {
  var base = verts.length, i, k;
  for (k = 0; k <= rings; k++) {
    var phi = (k / rings) * Math.PI;
    var y = Math.cos(phi) * r, rr = Math.sin(phi) * r;
    for (i = 0; i < seg; i++) {
      var a = (i / seg) * Math.PI * 2;
      verts.push([cx + Math.cos(a) * rr, cy + y, cz + Math.sin(a) * rr]);
    }
  }
  for (k = 0; k < rings; k++) {
    for (i = 0; i < seg; i++) {
      var j = (i + 1) % seg, r0 = base + k * seg, r1 = base + (k + 1) * seg;
      faces.push([r0 + i, r0 + j, r1 + j]);
      faces.push([r0 + i, r1 + j, r1 + i]);
    }
  }
}

/**
 * 建一个人形:头 + 躯干 + 两条手臂。
 * 坐标系:y 向上,原点在胸口附近,整体大致落在 y ∈ [-1, 1]、|x| ≤ 0.5。
 */
function buildFigure() {
  var verts = [], faces = [];
  sphere(verts, faces, 0, 0.74, 0, 0.185, 14, 10);                     // 头
  tube(verts, faces, 0, 0, -0.60, 0.235, 0.30, 0.255, 16, false, true);   // 躯干(几乎直筒,不是裙摆)
  tube(verts, faces, 0, 0, 0.30, 0.255, 0.46, 0.215, 16, true, false);    // 肩:到顶再收一点
  tube(verts, faces, 0, 0, 0.46, 0.09, 0.58, 0.085, 10, true, false);     // 脖子
  tube(verts, faces, -0.255, 0, -0.22, 0.05, 0.34, 0.062, 10, true, true);  // 左臂(贴着身体,不是伸出去的板子)
  tube(verts, faces, 0.255, 0, -0.22, 0.05, 0.34, 0.062, 10, true, true);   // 右臂
  return { verts: verts, faces: faces };
}

/**
 * 绕 Y 轴转 ry(度)后做弱透视投影。
 * @returns {{p:Array, z:Array}} p=屏幕坐标 [x,y];z=相机空间深度(越大越远)
 */
function project(verts, ry, width, height, scale) {
  var rad = (ry || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  // 0.55:人形高 ≈ 1.525 个单位 ⇒ 占画布高的 76%,与样机 .npc__ph(196px / 260px 台子 = 75%)同档。
  // 之前的 0.42 只有 58%,台子尺寸明明是对的,人却缩在中间一小团。
  var s = scale || Math.min(width, height) * 0.55;
  var cx = width / 2, cy = height / 2;
  var DIST = 4.2;                                    // 相机距离:再近人形会被透视拉变形
  var p = [], z = [];
  for (var i = 0; i < verts.length; i++) {
    var v = verts[i];
    var x = v[0] * cs + v[2] * sn;
    var zz = -v[0] * sn + v[2] * cs;
    var k = DIST / (DIST - zz);
    p.push([cx + x * s * k, cy - v[1] * s * k]);
    z.push(-zz);
  }
  return { p: p, z: z };
}

/**
 * 面的可见性、深度与亮度。
 *
 * <p>背面剔除用**投影后**的有向面积:面朝观察者时为正。这一步同时干掉了内表面,
 * 不然转到侧面会看见躯干内壁,像塌了一块。
 *
 * @returns 已按远→近排好序的 {idx, shade} 数组,shade ∈ [0,1]
 */
function shadeFaces(verts, faces, ry, proj) {
  var rad = (ry || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  // 光从左上前方来;转的是模型不是光,所以法线要转到同一坐标系里再点乘
  var LX = -0.45, LY = 0.78, LZ = 0.44;
  var out = [];
  for (var f = 0; f < faces.length; f++) {
    var t = faces[f], a = proj.p[t[0]], b = proj.p[t[1]], c = proj.p[t[2]];
    var area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (area >= 0) continue;                          // 背面:剔掉
    var A = verts[t[0]], B = verts[t[1]], C = verts[t[2]];
    var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    var vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var rx = nx * cs + nz * sn, rz = -nx * sn + nz * cs;   // 法线随模型一起转
    var len = Math.sqrt(rx * rx + ny * ny + rz * rz) || 1;
    var d = (rx * LX + ny * LY + rz * LZ) / len;
    out.push({
      idx: f,
      z: (proj.z[t[0]] + proj.z[t[1]] + proj.z[t[2]]) / 3,
      // 环境光垫底:全黑的背光面会在暗底上消失,人形就缺一块
      shade: Math.max(0, Math.min(1, 0.26 + Math.max(0, d) * 0.74)),
    });
  }
  out.sort(function (m, n) { return n.z - m.z; });   // 画家算法:远的先画
  return out;
}

module.exports = { buildFigure: buildFigure, project: project, shadeFaces: shadeFaces };
