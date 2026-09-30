// cy-play-calibrate · 传感器玩法开局前的校准(原型真源:模板编辑页 v2 · playkit calibrate)
//
// 传感器类**必须**先量一遍环境,课堂噪音计和倾斜迷宫这两类成熟产品都有这一步:
//   · 安静挑战 —— 咖啡馆的底噪比书店高一大截,不量就定阈值,有的店一开局就在红区,
//     这玩法直接不能用;
//   · 弹球 —— 人举着手机是三十几度不是平的,把「现在这个姿势」当成水平,
//     球才不会一撒手就往下跑。
//
// 采样本身不在这里:谁在量谁最清楚怎么量(麦克风取峰值 / 加速度取三轴)。
// 组件只管进度与时长,每一拍抛 tick 让壳去采,量完抛 done。

const TICK_MS = 90;

Component({
  properties: {
    show: { type: Boolean, value: false },
    label: { type: String, value: '' },
    sub: { type: String, value: '别动,量一下这儿的底子' },
    ms: { type: Number, value: 1200 },
  },
  data: { percent: 0 },   // 0–1,直接喂 scaleX
  observers: {
    show: function (show) {
      this._stop();
      if (!show) { this.setData({ percent: 0 }); return; }
      const total = this.data.ms > 0 ? this.data.ms : 1200;
      const t0 = Date.now();
      this.setData({ percent: 0 });
      this._timer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / total);
        this.setData({ percent: Number(k.toFixed(3)) });
        this.triggerEvent('tick');
        if (k < 1) return;
        this._stop();
        this.triggerEvent('done');
      }, TICK_MS);
    },
  },
  lifetimes: { detached() { this._stop(); } },
  pageLifetimes: { hide() { this._stop(); } },
  methods: {
    _tickMs: () => TICK_MS,     // 纯出口,供单测
    _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
  },
});
