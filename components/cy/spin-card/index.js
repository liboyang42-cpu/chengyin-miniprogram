// cy-spin-card · 立体藏品卡:一张实拍照片 + 陀螺仪倾斜 + 跟着倾斜走的高光。
//
// 三层(卡面 / 主体视差 / 高光)全部只写 transform 与 opacity:
//   动 width/left/top 每帧触发 layout+paint,30fps 必掉帧;合成层属性不会。
// 高光不许用 @keyframes —— 它不是「播一次」的动画,是持续跟随姿态的状态,
// 而且 keyframes 在本仓是只减不增的棘轮(tests/unit/motion-property-ratchet.test.js)。
//
// frames 传 1 张 = 静态立体卡(玩家档),传 N 张 = 环绕转台(商家档,L1)。
// 这条缝是从第一天留的:转台不需要改组件,只需要后端多喂几帧。
//
// 所有能力都是 fail-open:没有加速度计 / 启动失败 / 图挂了,
// 一律退化成一张不动的卡。铸卡是通关之后的事,这里没有任何一条路能把人挡住。

const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

const MAX_TILT_DEG = 11;   // 再大就不像「一张卡」,像玩具
const PHOTO_SHIFT = 9;     // px,卡面在自己窗口里让位的距离
const FOIL_SHIFT = 96;     // px,高光带的横向行程
const RENDER_MS = 33;      // ≤30fps。陀螺仪给到 60Hz 也没用,一帧一次 setData 才是瓶颈

/* 符号是**在真机上定的**,不是在纸上推出来的:手机顶端往后仰时,卡面该往
   屏幕里倒还是往外抬,两种写法都自洽,只有一种看着像「一张立着的卡」。
   翻这两个常数即可,别改下面的算式。 */
const SIGN_PITCH = 1;      // 绕横轴(前后俯仰)
const SIGN_YAW = -1;       // 绕竖轴(左右转向)

function clamp(v, limit) {
  return Math.max(-limit, Math.min(limit, v));
}

/* 正对时那串值就该是干净的 0.00,不是 "-0.00" —— SIGN_YAW 取负会把 0 翻成 -0,
   而 (-0).toFixed(2) 在 V8 里就是 "-0.00"。单测拿 /--ry:0\.00deg/ 钉这条。 */
function deg(v) { return (v === 0 ? 0 : v).toFixed(2); }
function px(v) { return (v === 0 ? 0 : v).toFixed(1); }
function unit(v) { return (v === 0 ? 0 : v).toFixed(3); }

/** 一次姿态 → 一段内联样式字符串。
 *  入参是**相对零点的原始加速度差**(dx=左右,dy=前后):哪个偏移驱动哪根轴、
 *  往哪个方向转,全在这里定,回调只管把数抄回来。
 *  ★ 整段拼完再一次 setData:分成六七个字段的话,一帧就是六七次 setData,
 *    视图层每条都要重排,30fps 立刻掉到个位数。
 *  ★ 夹取在这里,不在传感器回调里:这样不管谁喂进来(包括单测直接喂极端值),
 *    卡都不可能翻过 ±11°。 */
function buildPose(tilt) {
  const dx = clamp(tilt.dx, 1);
  const dy = clamp(tilt.dy, 1);
  const parts = [
    // 前后俯仰绕横轴(rotateX)、左右转向绕竖轴(rotateY) —— 别把两根轴接反。
    '--rx:' + deg(dy * SIGN_PITCH * MAX_TILT_DEG) + 'deg',
    '--ry:' + deg(dx * SIGN_YAW * MAX_TILT_DEG) + 'deg',
    // 卡面与主体逆着倾斜让位:让得少的那层看着远,让得多的那层看着近。
    '--px:' + px(-dx * PHOTO_SHIFT) + 'px',
    '--py:' + px(-dy * PHOTO_SHIFT) + 'px',
    // 高光是反着走的:往亮的那一侧跑,才像光被卡面「接住又转出去」。
    '--fx:' + px(dx * FOIL_SHIFT) + 'px',
    '--fy:' + px(dy * FOIL_SHIFT * 0.6) + 'px',
    // 正对时几乎看不见,越侧越亮 —— 这条曲线是「金属膜」和「一层白雾」的差别。
    '--fo:' + unit(Math.min(1, Math.abs(dx) + Math.abs(dy)) * 0.85),
  ];
  return parts.join(';') + ';';
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    frames: { type: Array, value: [] },
    title: { type: String, value: '' },
    caption: { type: String, value: '' },
    cardStyle: { type: String, value: 'foil' },   // foil 有高光 / plain 无
    tilt: { type: Boolean, value: true },          // 网格里的缩略卡传 false:一屏十几张全开传感器会吃电
  },
  data: {
    src: '',
    count: 0,
    pose: '',
    tracking: false,
    broken: false,
    // 转台预载:多帧时先用隐藏图把每一帧加载一遍,全部结束才放行拖动(施工文档 §2.3)
    ready: true,
    preload: [],
  },
  observers: {
    frames(frames) {
      const list = Array.isArray(frames) ? frames : [];
      const idx = Math.min(this._spinIdx || 0, Math.max(0, list.length - 1));
      const multi = list.length > 1;
      // 成功或失败都算「结束」:一帧挂了不能让整张卡永远拖不动,那一帧到时候走占位
      this._pending = multi ? new Set(list) : null;
      this.setData({
        count: list.length, src: list[idx] || '', broken: false,
        ready: !multi, preload: multi ? list.slice() : [],
      });
      // 帧常常比挂载晚到(服务端回包、图片下载完才铸卡)。不重判一次,
      // 挂载时 count=0 关掉的那条表就再也没人开 —— 卡会一直不动。
      this._resyncTilt();
    },
    'tilt, reducedMotion'() {
      this._resyncTilt();
    },
  },
  lifetimes: {
    attached() {
      this._resyncTilt();
    },
    detached() {
      this._stopTilt();
    },
  },
  // 切后台必须停:人在地图另一头站着,卡还在耗电,是这条组件最容易犯 also 最难查的错
  pageLifetimes: {
    hide() { this._stopTilt(); },
    show() { this._resyncTilt(); },
  },
  methods: {
    _buildPose: buildPose,   // 纯函数出口,供单测

    _resyncTilt() {
      // 只有照片卡(恰好一帧)跟着倾斜;转台卡靠拖,两种交互叠在一起会打架(施工文档 §2.3)
      const wants = this.properties.tilt && !this.data.reducedMotion && this.data.count === 1;
      if (wants) this._startTilt();
      else this._stopTilt();
    },

    _startTilt() {
      if (this._tiltOn) return;
      this._tiltOn = true;
      this._zero = null;
      this._latest = null;
      this._onTilt = (res) => {
        const x = res && res.x ? res.x : 0;
        const y = res && res.y ? res.y : 0;
        // 零点校准:人举着手机是三十几度不是平的。把这一刻的姿势当「正对」,
        // 之后只按相对偏移算 —— 不然一上来卡就是歪的。
        if (!this._zero) { this._zero = { x, y }; return; }
        this._latest = { dx: x - this._zero.x, dy: y - this._zero.y };
      };
      // 表与回调先就位,最后才开传感器:fail 可能在同一拍里就回来,
      // 那时若定时器还没建好,关停就会漏掉它 —— 漏掉的就是一个永不停的那只表。
      this._tick = setInterval(() => this._render(), RENDER_MS);
      wx.onAccelerometerChange(this._onTilt);
      this.setData({ tracking: true });
      wx.startAccelerometer({
        interval: 'ui',
        fail: () => {
          // 拿不到传感器就是没有立体感,不是报错的理由 —— 退回静态卡
          this._stopTilt();
        },
      });
    },

    _stopTilt() {
      if (!this._tiltOn) return;
      this._tiltOn = false;
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      wx.stopAccelerometer({ fail() {} });
      wx.offAccelerometerChange && this._onTilt && wx.offAccelerometerChange(this._onTilt);
      this._onTilt = null;
      this._latest = null;
      this.setData({ tracking: false, pose: '' });
    },

    _render() {
      if (!this._latest) return;
      const pose = buildPose(this._latest);
      if (pose === this.data.pose) return;   // 手机不动时不重复刷同一串值
      this.setData({ pose });
    },

    /** 转台:横向拖多少走多少帧。1 帧时这条整个不成立,所以什么都不做。 */
    _frameFromDrag(dx) {
      const n = this.data.count;
      if (n < 2) return null;
      const step = 30;   // px/帧:24 帧 × 30px = 720px 一圈,约两次滑动(施工文档 §2.3)
      const moved = Math.round(dx / step);
      const idx = ((this._spinBase + moved) % n + n) % n;
      return idx;
    },

    onSpinTouchStart(e) {
      if (this.data.count < 2 || !this.data.ready) return;
      const t = e && e.touches && e.touches[0];
      this._spinX0 = t ? t.clientX : 0;
      this._spinBase = this._spinIdx || 0;
    },

    onSpinTouchMove(e) {
      if (this.data.count < 2 || !this.data.ready) return;
      const t = e && e.touches && e.touches[0];
      if (!t) return;
      const idx = this._frameFromDrag(t.clientX - this._spinX0);
      if (idx === null || idx === this._spinIdx) return;
      this._spinIdx = idx;
      this.setData({ src: this.properties.frames[idx] || '', broken: false });
    },

    onSpinTouchEnd() {
      this._spinX0 = 0;
    },

    /** 隐藏预载图的 load / error 共用这一个:只认当前这批帧里还没结束的那张,重复与过期的事件不算数。 */
    onPreload(e) {
      const src = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.src;
      // delete 的返回值就是「这次真结束了一张待加载帧」:重复与过期的事件在这里自然落空
      if (!this._pending || !this._pending.delete(src)) return;
      if (!this._pending.size) this.setData({ ready: true, preload: [] });
    },

    onImageError() {
      // 图挂了不留白:卡还在,只是变成一张写着名字的占位卡
      this.setData({ broken: true });
    },

    onFrameLoad() {
      this.setData({ broken: false });
    },
  },
});
