/**
 * 显形档真 AR 的小算术(纯函数,可单测;真机画面另验)。
 */

/**
 * 配置里的 arMode → xr-scene 的 ar-system。认不出就不开。
 * 识别图要连平面一起开:认到之后把东西锁进世界空间(官方 xr-template-markerLock),世界坐标靠平面追踪撑着;
 * 官方注明 vio + marker 时 planeMode 需为 1(只认水平面)。
 */
function arSystemOf(arMode) {
  if (arMode === 'PLANE') return 'modes:Plane';
  if (arMode === 'MARKER') return 'modes:Plane Marker; planeMode: 1';
  return '';
}

/**
 * 卡片的缩放:宽定为 base,高按商家那张图的宽高比 —— 不拉伸。
 * plane 几何体躺在 XZ 面上,所以「高」落在 z 上。图的尺寸还没拿到时按正方形。
 */
function cardScaleOf(texW, texH, base) {
  const w = Number(texW), h = Number(texH);
  if (!(w > 0) || !(h > 0)) return { x: base, z: base };
  return { x: base, z: Number((base * h / w).toFixed(4)) };
}

/**
 * 长出来的曲线:ease-out cubic,先快后慢。起点给 0.02 而不是 0 ——
 * 缩放为 0 的节点在部分机型上会被剔除,第一帧就看不见它开始长。
 */
function growOf(elapsedMs, durationMs) {
  const t = Math.min(1, Math.max(0, Number(elapsedMs) / Number(durationMs || 1)));
  const eased = 1 - Math.pow(1 - t, 3);
  return t >= 1 ? 1 : Math.max(0.02, eased);
}

/**
 * 平面模式放下:从正上方 height 处落下(2026-09-23 用户:「那个重力和吸附呢」)。
 *   前 70% 按重力加速往下掉(y 按 t² 收),在 DROP_CONTACT 那一刻贴地 —— 宿主在这一刻轻震;
 *   后 30% 轻弹一下(抛物线,高度只有 HOP)再落定。弹得太高就成了卡通皮球。
 * 影子不在这里算:地面用透明阴影材质接真实投影,东西多高影子就落在哪。
 */
const DROP_CONTACT = 0.7;
const HOP = 0.08;
function dropOf(elapsedMs, durationMs, height) {
  const t = Math.min(1, Math.max(0, Number(elapsedMs) / Number(durationMs || 1)));
  let y;
  if (t < DROP_CONTACT) {
    const p = t / DROP_CONTACT;
    y = height * (1 - p * p);
  } else {
    const u = (t - DROP_CONTACT) / (1 - DROP_CONTACT);
    y = height * HOP * 4 * u * (1 - u);
  }
  return { y };
}

const round4 = (v) => Number(v.toFixed(4)) + 0;   // + 0 把 -0 收成 0

/**
 * 3D 模型自动定尺寸:商家传来的模型大小、原点都不可控(米、厘米、原点在头顶都见过)。
 * 按包围盒把最长边缩到 target,再整体挪回来 —— 水平居中、底面贴 y=0(地面/识别图表面)。
 * 包围盒拿不到(空模型)就原样摆,别除以 0。
 */
function fitModelOf(center, size, target) {
  const longest = Math.max(size.x, size.y, size.z);
  if (!(longest > 0)) return { scale: 1, x: 0, y: 0, z: 0 };
  const s = target / longest;
  return { scale: round4(s), x: round4(-center.x * s), y: round4(-(center.y - size.y / 2) * s), z: round4(-center.z * s) };
}

/**
 * 立牌转向玩家:只取水平分量 —— 牌子永远立着,玩家举高手机它也不前俯后仰(那样就像一张飘着的纸)。
 * 玩家在正上方俯视时水平分量为 0,返回 null:不转,别算出 NaN 让牌子消失。
 */
function flatForward(camera, object) {
  const x = camera.x - object.x;
  const z = camera.z - object.z;
  if (Math.hypot(x, z) < 1e-4) return null;
  return { x, z };
}

module.exports = { arSystemOf, cardScaleOf, growOf, dropOf, DROP_CONTACT, fitModelOf, flatForward };
