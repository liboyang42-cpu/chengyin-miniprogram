// cy-playkit-coinflip · 抛硬币(逐块照抄原型 playkit.html 的 GAMES.coin)
//
// ★ 结果由服务端出,转动只是把它演出来。客户端的随机数玩家改得动,
// 而这个玩法的结果直接对应「谁请这一杯」。后端 FLIP_COIN 是幂等的:
// 重复提交返回第一次的结果,不重摇。
//
// 上下翻:绕横轴。抛硬币本来就是这么翻的,绕竖轴那是转陀螺。
// ⚠️ SPIN_MS 必须与 index.wxss 里 .cf__coin 那条 transition 的时长**完全一致**。
// 对不上的话:短了是转完之前就报结果(提前剧透),长了是转完了愣在那儿。

const SPIN_MS = 2200;

const faces = require('./faces.js');
const { createShakeDetector } = require('../../utils/play-shake.js');
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 服务端可能给 'HEADS'/'heads'/'H'。归一到两个值,认不出就当没结果 —— 别猜。 */
function normalizeFace(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'HEADS' || s === 'H' || s === '正面') return 'HEADS';
  if (s === 'TAILS' || s === 'T' || s === '反面') return 'TAILS';
  return '';
}

/** 转多少圈落到哪一面。圈数每次不同,不然第二次看就知道要转几圈了。 */
function spinDeg(turns, face) {
  return turns * 360 + (face === 'TAILS' ? 180 : 0);
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '抛一次,认结果' },
    headsLabel: { type: String, value: '正面' },
    headsAction: { type: String, value: '' },
    tailsLabel: { type: String, value: '反面' },
    tailsAction: { type: String, value: '' },
    // 服务端给的结果。页面在 FLIP_COIN 回来后设它;空 = 还没抛
    face: { type: String, value: '' },
  },
  data: {
    faceA: '', faceB: '',
    coinStyle: '',
    idle: true,
    big: '正面还是反面?',
    lab: '',
    hint: '摇一摇手机',
    burstKey: '',   // 换值即重播一次彩片,不靠计时器清场
  },
  observers: {
    'show, headsLabel, headsAction, tailsLabel, tailsAction': function (show) {
      if (!show) { this._offShake(); return; }
      this._flipping = false;
      this._result = '';
      this._onShake();
      const d = this.data;
      this.setData({
        // 正面压 logo + 上下两条弧字(商家写的那两句);背面是中央那块二维码
        faceA: faces.toDataUri(faces.faceMark(d.headsLabel, d.headsAction)),
        faceB: faces.toDataUri(faces.faceCode()),
        lab: d.headsLabel + ' · ' + d.headsAction + '\n' + d.tailsLabel + ' · ' + d.tailsAction,
      });
    },
    face: function (face) {
      const f = normalizeFace(face);
      if (!f) { this._result = ''; this.setData({ idle: true, coinStyle: '' }); return; }
      this._turns = (this._turns || 0) + 6 + Math.floor(Math.random() * 3);
      const deg = spinDeg(this._turns, f);
      // 停自转再翻:两个 transform 打架的话硬币会在半路跳一下
      this.setData({
        idle: false,
        big: '翻着…',
        lab: '',
        coinStyle: 'transform:rotateX(' + deg + 'deg)',
      });
      if (this.data.reducedMotion) { this._settle(f); return; }
      this._stop();
      this._timer = setTimeout(() => this._settle(f), SPIN_MS);
    },
  },
  lifetimes: {
    /* 摇一摇就抛:这一屏在原型里**一个按钮都没有**。
       ⚠️ 传感器要跟着显隐开关:一直开着的话玩家退出这一关之后走两步还在抛。 */
    attached() { this._shake = createShakeDetector(() => this.onFlip()); },
    detached() { this._stop(); this._offShake(); },
  },
  pageLifetimes: { hide() { this._offShake(); } },
  methods: {
    _normalizeFace: normalizeFace,      // 纯算法出口,供单测
    _spinDeg: spinDeg,
    _spinMs: () => SPIN_MS,
    _stop() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } },
    _onShake() {
      if (!this._shakeOn) {
        this._shakeOn = true;
        this._tick = (res) => this._shake(res);
        wx.startAccelerometer({ interval: 'normal', fail() {} });
        wx.onAccelerometerChange(this._tick);
      }
    },
    _offShake() {
      if (!this._shakeOn) return;
      this._shakeOn = false;
      wx.stopAccelerometer({ fail() {} });
      wx.offAccelerometerChange && wx.offAccelerometerChange(this._tick);
    },
    /** 抛。摇一摇和点屏幕都走这里 —— 桌面和没有加速度计的机器要有退路。 */
    onFlip() {
      if (this._result || this._flipping) return;
      this._flipping = true;
      this.triggerEvent('flip');
    },

    _settle(f) {
      const d = this.data;
      const isH = f === 'HEADS';
      this._result = f;
      this.setData({
        big: isH ? d.headsLabel : d.tailsLabel,
        lab: isH ? d.headsAction : d.tailsAction,
        hint: '再摇一次',
      });
      // 「做成了」落在结果落面这一刻,不在点「抛」那一下 —— 点下去只是请求发出
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.setData({ burstKey: 'coin:' + Date.now() });
      this.triggerEvent('settled', { face: f });
    },

    onClose() { this._stop(); this.triggerEvent('close'); },
  },
});
