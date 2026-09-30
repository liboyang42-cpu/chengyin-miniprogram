// 集邮册散落布局:网格打底 + 每格内确定性抖动/旋转。
// 参考 STAMPA 的月份 collage —— 散落、带角度、密集堆叠。【乱才是魅力,不是网格】。
// 但必须确定性:真随机会让每次进页面邮票乱跳,且没法测。用 index 派生伪随机:看着乱,实际可复现。
function rnd(i, salt) {
  var x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);   // [0,1)
}

function collageLayout(count, opts) {
  var cols = opts.cols, cellW = opts.cellW, cellH = opts.cellH;
  var jitter = opts.jitter, maxRot = opts.maxRot;
  var out = [];
  for (var i = 0; i < count; i++) {
    var c = i % cols, r = Math.floor(i / cols);
    out.push({
      x: c * cellW + (rnd(i, 1) - 0.5) * jitter,
      y: r * cellH + (rnd(i, 2) - 0.5) * jitter,
      rot: (rnd(i, 3) - 0.5) * 2 * maxRot,
      z: i
    });
  }
  return out;
}

module.exports = { collageLayout: collageLayout };
