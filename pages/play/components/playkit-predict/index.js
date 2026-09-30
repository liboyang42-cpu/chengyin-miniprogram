// cy-playkit-predict · 竞猜转盘(逐值照抄原型 playkit.html 的 GAMES.predict)
//
// 选项排在一个**圆柱面**上慢慢转过来,不是竖排列表。转盘让人「等到自己想押的那张」,
// 列表让人「扫一眼挑一个」—— 后者押注的分量就没了。
//
// ★ 押完**不当场出结果**:到点由商家公布,可能是三天后。所以这一屏没有判定屏。
// 硬套一张「答对/答错」上去就是骗人 —— 那个时刻答案还不存在。
//
// 几何全部照原型:
//   ARC 是一张卡自己占的角度,GAP 是卡与卡之间的空,STEP = 两者之和。
//   周期是 N × STEP 而不是 360° —— 五张 ×35° = 175°,任何一张都不会转到 ±90° 之外,
//   于是没有背面,也就没有「翻不翻」这个判断,不会出现同一张卡半边镜像。
//   半径由「卡宽 = 这段弧的弧长」定死:R = 卡宽 / ARC(弧度)。

const ARC = 30;              // 一张卡占的角度
const GAP = 5;               // 卡与卡之间的空
const STEP = ARC + GAP;
const CW = 276;              // 卡宽 rpx(原型 138px)
const CH = 372;              // 卡高 rpx(原型 186px)
const K = 10;                // 每张切几条
const SW = CW / K;           // 一条的宽
const OVER = 1.6;            // 条与条留一点重叠,免得接缝透光(原型 0.8px)
const D2R = Math.PI / 180;
const R = CW / (ARC * D2R);  // 弧长 = 卡宽 ⇒ 半径

const TICK_MS = 16;
const V_MIN = 0.05, V_MAX = 0.90;   // 卡位附近慢、两张之间快

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 当前角速度。2.6 次方 —— 指数越高,卡位附近的低速区越宽,只有两张之间才提速。 */
function speedAt(angle) {
  const frac = (((angle % STEP) + STEP) % STEP) / STEP;
  return V_MIN + (V_MAX - V_MIN) * Math.pow(Math.sin(Math.PI * frac), 2.6);
}

/** 第 i 张卡此刻的角度。周期是 N×STEP,不是 360°。 */
function cardAngle(i, angle, n) {
  const period = n * STEP;
  let a = (i * STEP - angle) % period;
  if (a > period / 2) a -= period;
  if (a < -period / 2) a += period;
  return a;
}

/** 一张卡的十条竖条。每条里放一份整张卡,往左错开自己那一格再裁掉多余的。 */
function slicesFor() {
  const out = [];
  for (let j = 0; j < K; j++) {
    // 这一条在卡面上的角度偏移:从卡的左缘往右走
    const da = -ARC / 2 + ARC * ((j + 0.5) / K);
    const x = Math.sin(da * D2R) * R;
    const z = Math.cos(da * D2R) * R;
    out.push({
      i: j,
      box: 'width:' + (SW + OVER).toFixed(2) + 'rpx;height:' + CH + 'rpx;'
         + 'margin-left:' + (-(SW + OVER) / 2).toFixed(2) + 'rpx;margin-top:' + (-CH / 2) + 'rpx;'
         + 'transform:translate3d(' + x.toFixed(2) + 'rpx,0,' + z.toFixed(2) + 'rpx) rotateY(' + da.toFixed(2) + 'deg);',
      /* 这份卡面往左错开自己那一格。
         ⚠️ 符号别写反:切片盒被 margin-left 居中过,所以卡面还要再往左半格。
         写成 +(SW+OVER)/2 的话每条都往右挪一点,整张卡被拉宽、字也对不上缝。
         对照原型实测:j=0 时 left = -0.4px(SW=13.8, OVER=0.8)。 */
      face: 'width:' + CW + 'rpx;height:' + CH + 'rpx;left:'
          + (-(j * SW) - (SW + OVER) / 2 + SW / 2).toFixed(2) + 'rpx;',
    });
  }
  return out;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    question: { type: String, value: '' },
    hint: { type: String, value: '' },
    options: { type: Array, value: [] },
    /* 当天第几点截止收注。★ 服务端只下发这一个时间字段(见 playkit-view.js 的 predict 分支),
       所以等待文案只能由它推。早先这里要的是原型那套 closeMode/closeDays(「第 N 天揭晓」),
       而我们的配置、校验、后端投影、pickPlayKit 一路产出的都是 closeAtHour ——
       没有一处产出 closeMode,于是玩家押完那行字永远是空的。 */
    closeAtHour: { type: Number, value: -1 },
    /* 什么时候由商家公布答案。原型「揭晓时间」就是这两个数(第几天 + 几点),
       存相对天数不存绝对时间戳 —— 模板会被复制、跨天复用。 */
    revealDays: { type: Number, value: -1 },
    revealHour: { type: Number, value: -1 },
    /* 揭晓三件套。答案由商家事后给,所以这三个是**押完之后**才会有值的:
       0 待揭晓 / 1 已揭晓 / 2 已作废(商家超时没给,平台不替他发奖)。 */
    settleStatus: { type: null, value: null },
    settledOption: { type: String, value: '' },
    won: { type: Boolean, value: false },
    myOptionKey: { type: String, value: '' },
  },
  data: {
    cards: [], picked: -1, committed: false, waitLabel: '',
    // 派生:换个键名,别写回被 observer 监听的那几个属性
    revealKind: '', revealHead: '', revealText: '',
  },
  observers: {
    'show, settleStatus, settledOption, won': function (show) {
      if (!show) return;
      // 字段写死成字面量:动态 setData 门禁核不出写了哪些顶层字段
      const reveal = revealOf(this.data);
      this.setData({
        revealKind: reveal.revealKind,
        revealHead: reveal.revealHead,
        revealText: reveal.revealText,
      });
    },
    'show, options, closeAtHour, revealDays, revealHour': function (show) {
      if (!show) { this._stop(); return; }
      const d = this.data;
      this._angle = 0;
      this._n = (d.options || []).length || 1;
      this._slices = slicesFor();
      this.setData({
        picked: -1, committed: false,
        waitLabel: waitLabelOf(d.closeAtHour, d.revealDays, d.revealHour),
      });
      this._paint();
      if (!d.reducedMotion) this._spin();
    },
  },
  lifetimes: { detached() { this._stop(); } },
  pageLifetimes: { hide() { this._stop(); } },
  methods: {
    _speedAt: speedAt,        // 纯算法出口,供单测
    _cardAngle: cardAngle,
    _slicesFor: slicesFor,
    _geometry: () => ({ ARC, GAP, STEP, CW, CH, K, R: Number(R.toFixed(2)) }),

    _stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },

    /** ⚠️ 转盘用 setInterval 不用 rAF:页面不渲染时 rAF 会整个停掉,
     *  回来时转盘卡在半路,而卡在两张之间是没法点的。 */
    _spin() {
      this._stop();
      this._timer = setInterval(() => {
        if (this.data.committed) return;
        this._angle += speedAt(this._angle);
        this._paint();
      }, TICK_MS);
    },

    _paint() {
      const opts = this.data.options || [];
      const n = opts.length || 1;
      const cards = opts.map((o, i) => {
        const a = cardAngle(i, this._angle, n);
        // 出画的淡出:真正的接缝落在屏幕外
        const vis = Math.abs(a) < 64;
        const op = Math.abs(a) < 55 ? 1 : Math.max(0, (64 - Math.abs(a)) / 9);
        return {
          key: o.key || ('k' + i),
          label: o.label || ('选项 ' + (i + 1)),
          meta: o.meta || '',
          sel: this.data.picked === i,
          slices: this._slices,
          wrap: 'transform:rotateY(' + a.toFixed(2) + 'deg);opacity:' + (vis ? op.toFixed(2) : 0)
              + ';z-index:' + Math.round(500 - Math.abs(a) * 4) + ';',
        };
      });
      this.setData({ cards });
    },

    onPick(e) {
      if (this.data.committed) return;
      this.setData({ picked: Number(e.currentTarget.dataset.i) });
      this._paint();
    },
    onCommit() {
      if (this.data.committed || this.data.picked < 0) return;
      // 「做成了」= 押定这一下。它不可逆,给 medium
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this._stop();
      this.setData({ committed: true });
      const opt = (this.data.options || [])[this.data.picked] || {};
      this.triggerEvent('submit', { key: opt.key, index: this.data.picked });
    },
    onClose() { this._stop(); this.triggerEvent('close'); },
  },
});

/**
 * 揭晓那一块说什么。三种态分开说 —— 「等揭晓」和「这一轮作废了」
 * 对玩家是两件完全不同的事,合成一句「暂无结果」等于什么都没说。
 */
function revealOf(d) {
  const status = d.settleStatus;
  if (status === null || status === undefined || status === '') {
    return { revealKind: '', revealHead: '', revealText: '' };
  }
  if (Number(status) === 2) {
    return {
      revealKind: 'void', revealHead: '这一轮作废了',
      revealText: '商家没有在期限内给出答案。这一轮不发奖,你押的那一下不算数。',
    };
  }
  if (Number(status) === 1) {
    const answer = pickLabel(d.options, d.settledOption);
    const mine = pickLabel(d.options, d.myOptionKey);
    return d.won
      ? { revealKind: 'won', revealHead: '猜中了', revealText: '答案是「' + answer + '」,你押的就是它。' }
      : { revealKind: 'lost', revealHead: '没猜中', revealText: '答案是「' + answer + '」,你押的是「' + mine + '」。' };
  }
  return { revealKind: 'wait', revealHead: '等商家给答案', revealText: '答案给出来之后,这里会告诉你中没中。' };
}

/** key → 选项文案。找不到就把 key 原样回去,不编一个「未知选项」出来。 */
function pickLabel(options, key) {
  const hit = (options || []).filter((o) => o.key === key)[0];
  return (hit && hit.label) || String(key || '');
}

/** 什么时候截止、什么时候揭晓。拿不到可信的数就别编一个 —— 宁可不写。
    ⚠️ 两件事要分开说:closeAtHour 是**今天几点停止收注**(服务端按它拒收过点的注,
    下注按 playDay 记当天);revealDays/revealHour 是**商家答应什么时候公布答案**。
    原型的说法是「第 N 天揭晓,由商家给出答案」,这里把截止也说出来 ——
    少了截止那句,玩家不知道自己还能不能押。
    ⚠️ 只认真正的整点数字:Number(null) 与 Number('') 都是 0,会把一个空值说成 00:00。 */
function hourText(value) {
  const hour = typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '';
  return String(hour).padStart(2, '0') + ':00';
}

/** 第几天的说法。0 当天 / 1 明天 / 2 后天,再往后就报第几天 —— 「第 3 天」比「大后天」好数 */
function dayText(days) {
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  return '第 ' + days + ' 天';
}

function waitLabelOf(closeAtHour, revealDays, revealHour) {
  const close = hourText(closeAtHour);
  const reveal = hourText(revealHour);
  const days = typeof revealDays === 'number' && Number.isInteger(revealDays)
    && revealDays >= 0 && revealDays <= 30 ? revealDays : -1;

  const closeSay = close ? '今天 ' + close + ' 截止' : '';
  const revealSay = (days >= 0 && reveal) ? dayText(days) + ' ' + reveal + ' 由商家给出答案' : '';
  if (closeSay && revealSay) return closeSay + ',' + revealSay + '。';
  if (revealSay) return revealSay + '。';
  if (closeSay) return closeSay + ',之后由商家给出答案。';
  return '';
}
