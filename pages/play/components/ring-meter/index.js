// cy-ring-meter · 分段环形读数。percent 决定点亮几段,几何由 size 推,不要调用方算半径。
const DEFAULT_SIZE = 360;
const DEFAULT_SEGMENTS = 48;

/** 纯函数:给定百分比与段数,返回每段的角度与点亮状态。可单测,不碰 setData。 */
function buildSegments(percent, segments) {
  const total = segments > 0 ? Math.floor(segments) : DEFAULT_SEGMENTS;
  const p = percent > 0 ? Math.min(100, percent) : 0;
  // 四舍五入到段:1% 的进度也至少点亮一段,否则"已经走了 60 步"读起来像"没开始"
  const lit = p > 0 ? Math.max(1, Math.round((p / 100) * total)) : 0;
  const out = [];
  for (let i = 0; i < total; i++) {
    out.push({ i, deg: Math.round((360 / total) * i * 100) / 100, on: i < lit });
  }
  return out;
}

Component({
  options: { addGlobalClass: false },
  properties: {
    percent:  { type: Number, value: 0 },              // 0-100
    segments: { type: Number, value: DEFAULT_SEGMENTS },
    size:     { type: Number, value: DEFAULT_SIZE },   // rpx,外框边长
    tone:     { type: String, value: 'info' },         // info | success | danger
  },
  data: {
    segs: buildSegments(0, DEFAULT_SEGMENTS),
    radius: DEFAULT_SIZE / 2,
  },
  methods: {
    /* 纯算法出口:单测 stub global.Component 后拿这一个函数验角度与点亮数,
       不复制一份实现到测试里(复制的那份只证明它自己)。 */
    _buildSegments: buildSegments,
  },
  observers: {
    'percent, segments, size': function (percent, segments, size) {
      const w = size > 0 ? size : DEFAULT_SIZE;
      this.setData({
        segs: buildSegments(percent, segments),
        radius: Math.round(w / 2),
      });
    },
  },
});
