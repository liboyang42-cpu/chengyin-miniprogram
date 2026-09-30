/**
 * utils/motion.js —— ADA 动效/触感封装(2026-07-29,WT2)
 *
 * 只封装,不接线:本模块不引用任何页面、不自己调 setData,页面/组件在 WT3/WT4 里接。
 * 四支动效各拆成「纯计划函数 + 极薄执行器」两层:
 *   · 计划函数(countUpFrames / stampInPlan / fadeSwapPlan / routeDrawPlan)零副作用、可单测;
 *   · 执行器(countUp / stampIn / fadeSwap / routeDraw)只负责按计划回调 + 触发震动,
 *     定时器与震动源都可注入 —— 否则这层在 node 单测里根本跑不起来,
 *     测试就只能退化成「断言常量等于常量」。
 *
 * 时长常量与 style/tokens.wxss 的 --cy-motion-* 对齐(WXSS 变量在 JS 里读不到,
 * 只能各留一份);改时长请两处同步。
 */

// 与 --cy-motion-standard / --cy-motion-celebrate 对齐
const COUNT_UP_MS = 220;
const STAMP_MS = 600;
// skeleton → 内容的交叉淡切:两层同时补间,总时长就是这一个数(不是 2×)。
// --cy-motion-fade-swap 的 JS 镜像;两处漂移由 ds-ada-foundation-contract 判红。
const FADE_SWAP_MS = 200;
// --cy-ease-spring: cubic-bezier(.2,1.4,.5,1) 的字面镜像,供内联 style 用
const EASE_SPRING = 'cubic-bezier(.2,1.4,.5,1)';
const EASE_OUT = 'cubic-bezier(.22,.61,.36,1)';
// 路线画入:与 --cy-motion-slow(350ms)对齐 —— 页面级过场那一档,不新造第五个时长
const ROUTE_DRAW_MS = 350;

const DEFAULT_FPS = 30;

function clamp01(v) {
  if (!(v > 0)) return 0;      // NaN / 负数 / -0 一并归零
  return v > 1 ? 1 : v;
}

/** 减速收尾,与 --cy-ease-out 同族的数值近似 */
function easeOutCubic(t) {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

/** 按 decimals 定点取整,消掉浮点尾巴(金额/里程滚动会直接显示出来) */
function roundTo(value, decimals) {
  const d = decimals > 0 ? Math.floor(decimals) : 0;
  const f = Math.pow(10, d);
  return Math.round(value * f) / f;
}

/**
 * countUp 的帧计划(纯函数)。
 * @param {Object} [options] duration / fps / decimals / reducedMotion / ease
 *   ease:缓动函数,默认 easeOutCubic。可换成过冲型(spring)缓动做"数字弹一下"——
 *   末帧被显式钉死在 to,所以换任何不在 t=1 收敛到 1 的缓动都不会把金额显示错。
 * @returns {Array<{atMs:number, value:number}>} 末帧的 value 恒等于 to(不靠缓动碰巧收敛)
 */
function countUpFrames(from, to, options) {
  const opts = options || {};
  const start = Number(from) || 0;
  const end = Number(to) || 0;
  const decimals = opts.decimals > 0 ? Math.floor(opts.decimals) : 0;
  const duration = opts.duration > 0 ? opts.duration : COUNT_UP_MS;
  const fps = opts.fps > 0 ? opts.fps : DEFAULT_FPS;
  const ease = typeof opts.ease === 'function' ? opts.ease : easeOutCubic;

  // 降级动效 / 起止相同:直接给终值单帧。滚动本身是装饰,数字必须落对。
  if (opts.reducedMotion === true || start === end) {
    return [{ atMs: 0, value: roundTo(end, decimals) }];
  }

  const steps = Math.max(1, Math.round((duration / 1000) * fps));
  const frames = [];
  for (let i = 1; i <= steps; i++) {
    const atMs = Math.round((duration * i) / steps);
    const value = i === steps
      ? roundTo(end, decimals)
      : roundTo(start + (end - start) * ease(i / steps), decimals);
    frames.push({ atMs, value });
  }
  return frames;
}

/**
 * 数字滚动执行器。onFrame(value, index) 由调用方决定怎么落地(setData / 直接改 DOM)。
 * @returns {Function} cancel —— 调用后不再有后续帧
 */
function countUp(from, to, onFrame, options) {
  const opts = options || {};
  const schedule = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  const cancel = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
  const frames = countUpFrames(from, to, opts);
  const timers = [];
  let stopped = false;

  frames.forEach((frame, i) => {
    timers.push(schedule(() => {
      if (stopped) return;
      onFrame(frame.value, i);
      if (i === frames.length - 1 && typeof opts.onDone === 'function') opts.onDone(frame.value);
    }, frame.atMs));
  });

  return function stop() {
    stopped = true;
    timers.forEach(t => cancel(t));
  };
}

/**
 * 落章动效的计划(纯函数):过冲弹性 + 一次短震。
 * 降级动效时时长归零且不震 —— 触感也是动效,reduce-motion 用户一并关掉。
 */
function stampInPlan(options) {
  const opts = options || {};
  const reduced = opts.reducedMotion === true;
  return {
    durationMs: reduced ? 0 : (opts.duration > 0 ? opts.duration : STAMP_MS),
    easing: reduced ? 'linear' : EASE_SPRING,
    haptic: reduced ? null : (opts.haptic || 'light'),
    // 起手放大 + 淡入,落到 1;供调用方拼 transition/animation 或 wx.createAnimation
    from: { scale: 1.35, opacity: 0 },
    to: { scale: 1, opacity: 1 },
  };
}

/**
 * 落章执行器:按计划触发震动并回调。震动源可注入(node 单测里没有 wx)。
 * @returns {Object} 实际执行的计划(便于调用方拿去写 style)
 */
function stampIn(options) {
  const opts = options || {};
  const plan = stampInPlan(opts);
  const haptics = opts.haptics || (typeof wx !== 'undefined' ? wx : null);
  if (plan.haptic && haptics && typeof haptics.vibrateShort === 'function') {
    try {
      haptics.vibrateShort({ type: plan.haptic });
    } catch (e) {
      // 震动是锦上添花:部分机型/权限下会 reject,绝不能让它掀翻动效
    }
  }
  if (typeof opts.onStart === 'function') opts.onStart(plan);
  return plan;
}

/**
 * skeleton → 内容 的交叉淡切计划(纯函数)。
 * 两层同时补间 ⇒ 总时长 = durationMs,不是 out+in 两段相加(相加会让首屏多等一倍)。
 *
 * ⚠️ 2026-08-21:全站骨架屏淡切实际走的是纯 CSS 的 `.cy-fade-in`(style/fade-in.wxss)——
 * 骨架屏与内容是 wx:if/wx:elif 兄弟,内容挂载时进场动画自动播,不需要 JS 驱动,
 * 也就不需要同时持有两层去补间。本函数因此**没有调用方**,保留是因为它比 CSS 版多一件事:
 * 能拿到 out/in 两层的逐帧不透明度(要真正让骨架屏淡出而不是直接卸载时才用得上)。
 * 要接淡切请优先用 `.cy-fade-in`,别在这之外再写第三套 —— 时长真源只有 FADE_SWAP_MS 一处。
 */
function fadeSwapPlan(options) {
  const opts = options || {};
  const reduced = opts.reducedMotion === true;
  const durationMs = reduced ? 0 : (opts.duration > 0 ? opts.duration : FADE_SWAP_MS);
  return {
    durationMs,
    easing: reduced ? 'linear' : EASE_OUT,
    skeleton: { from: 1, to: 0, durationMs },
    content: { from: 0, to: 1, durationMs },
  };
}

/**
 * 淡切执行器:立即把两层置为「切换后」的目标态并回调,durationMs 后回调 onDone。
 * apply({ skeletonOpacity, contentOpacity, durationMs, easing }) 由调用方落地。
 */
function fadeSwap(apply, options) {
  const opts = options || {};
  const plan = fadeSwapPlan(opts);
  const schedule = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  if (typeof apply === 'function') {
    apply({
      skeletonOpacity: plan.skeleton.to,
      contentOpacity: plan.content.to,
      durationMs: plan.durationMs,
      easing: plan.easing,
    });
  }
  schedule(() => {
    if (typeof opts.onDone === 'function') opts.onDone(plan);
  }, plan.durationMs);
  return plan;
}

/**
 * 路线画入的帧计划(纯函数)——「一条已知路线沿着自己长出来」。
 *
 * 为什么要按**弧长**而不是按顶点插值:轨迹点的疏密从来不均匀(GPS 直路上点少、
 * 拐弯处点密)。按顶点等分会让线在直路上飞、在拐弯处爬,像卡顿而不像画。
 * 按累计弧长取样,画笔速度才恒定,缓动才是唯一的速度变化来源。
 *
 * 经纬度直接当平面坐标算距离(不做球面投影):这是装饰动效的取样权重,
 * 不是里程数,城市尺度下的纬度形变不影响观感;别拿它当距离用。
 *
 * @param {Array<{lng:number, lat:number}>} points 路线顶点(至少 2 个才有得画)
 * @param {Object} [options] duration / fps / reducedMotion / ease
 * @returns {{durationMs:number, easing:string, frames:Array<{atMs:number, progress:number, points:Array}>}}
 *   末帧的 points 恒等于完整 points(不靠缓动碰巧收敛)——线必须画到终点,少一截就是断头路。
 */
function routeDrawPlan(points, options) {
  const opts = options || {};
  const pts = Array.isArray(points) ? points.filter(p => p && isFinite(p.lng) && isFinite(p.lat)) : [];
  const reduced = opts.reducedMotion === true;
  const ease = typeof opts.ease === 'function' ? opts.ease : easeOutCubic;
  const easing = reduced ? 'linear' : EASE_OUT;

  // 不足两点 / 降级动效:直接给完整线单帧。动效是装饰,路线本身必须先在。
  if (reduced || pts.length < 2) {
    return { durationMs: 0, easing, frames: [{ atMs: 0, progress: 1, points: pts.slice() }] };
  }

  const duration = opts.duration > 0 ? opts.duration : ROUTE_DRAW_MS;
  const fps = opts.fps > 0 ? opts.fps : DEFAULT_FPS;

  // 累计弧长表:cum[i] = 从起点到第 i 个顶点的长度
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].lng - pts[i - 1].lng;
    const dy = pts[i].lat - pts[i - 1].lat;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cum[cum.length - 1];
  // 所有点重合(总长 0):没有可画的形状,退化成完整线单帧,免得除零
  if (!(total > 0)) {
    return { durationMs: 0, easing, frames: [{ atMs: 0, progress: 1, points: pts.slice() }] };
  }

  const steps = Math.max(1, Math.round((duration / 1000) * fps));
  const frames = [];
  for (let i = 1; i <= steps; i++) {
    const atMs = Math.round((duration * i) / steps);
    if (i === steps) {
      frames.push({ atMs, progress: 1, points: pts.slice() });
      break;
    }
    const progress = clamp01(ease(i / steps));
    frames.push({ atMs, progress, points: sliceRouteAt(pts, cum, total * progress) });
  }
  return { durationMs: duration, easing, frames };
}

/** 取路线从起点到弧长 len 处的那一截;末端补一个落在线段上的插值点(画笔的笔尖) */
function sliceRouteAt(pts, cum, len) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= len) { out.push(pts[i]); continue; }
    const segLen = cum[i] - cum[i - 1];
    const t = segLen > 0 ? (len - cum[i - 1]) / segLen : 0;
    if (t > 0) {
      out.push({
        lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * t,
        lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t,
      });
    }
    break;
  }
  return out;
}

/**
 * 路线画入执行器。onFrame(points, progress, index) 由调用方落地(setData 给 <map polyline>)。
 * 定时器可注入(node 单测里跑得起来)。
 * @returns {Function} cancel —— 调用后不再有后续帧
 */
function routeDraw(points, onFrame, options) {
  const opts = options || {};
  const schedule = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  const cancel = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
  const plan = routeDrawPlan(points, opts);
  const timers = [];
  let stopped = false;

  plan.frames.forEach((frame, i) => {
    timers.push(schedule(() => {
      if (stopped) return;
      if (typeof onFrame === 'function') onFrame(frame.points, frame.progress, i);
      if (i === plan.frames.length - 1 && typeof opts.onDone === 'function') opts.onDone(plan);
    }, frame.atMs));
  });

  return function stop() {
    stopped = true;
    timers.forEach(t => cancel(t));
  };
}

/**
 * 独立触感:一次性成功震动(核销/报名/到达这类"成了"的瞬间)。
 * 与 stampIn 同规矩,两条都不许少:
 *   ① 减动效下不震 —— 触感也是动效,reduce-motion 用户一并关掉(见 stampInPlan 的 haptic 档);
 *   ② 机型/权限 reject 不掀翻调用方 —— 震动永远是锦上添花。
 * 独立成函数是因为这些调用点只要震、不要 stampIn 那套缩放计划。
 * @param {Object} [options] type: light|medium|heavy(默认 light) / reducedMotion / haptics(可注入,供单测)
 * @returns {boolean} 是否真的震了(供单测断言"减动效下没震")
 */
function haptic(options) {
  const opts = options || {};
  if (opts.reducedMotion === true) return false;
  const source = opts.haptics || (typeof wx !== 'undefined' ? wx : null);
  if (!source || typeof source.vibrateShort !== 'function') return false;
  try {
    const request = source.vibrateShort({
      type: opts.type || 'light',
      fail: function () {}
    });
    if (request && typeof request.catch === 'function') request.catch(function () {});
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  COUNT_UP_MS,
  STAMP_MS,
  FADE_SWAP_MS,
  EASE_SPRING,
  EASE_OUT,
  clamp01,
  easeOutCubic,
  countUpFrames,
  countUp,
  stampInPlan,
  stampIn,
  haptic,
  fadeSwapPlan,
  fadeSwap,
  ROUTE_DRAW_MS,
  routeDrawPlan,
  routeDraw,
};
