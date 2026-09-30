// cy-playkit-estimate · 猜数字(逐块照抄原型 playkit.html 的 GAMES.estimate)
//
// 是**滚筒**不是输入框。屏上只留三个数:中间那个是实的,上下两个是它的镜像 ——
// 翻过来、发虚、发淡。上一版我做成打字输入,那是另一个玩法:
// 打字要人先在心里有个数,滚轮是让人"滑到差不多"——后者才是估数。
//
// ★ 量程的来源与原型不同,这一处不得不改:
//   原型是本地 demo,拿 answer 的量级推上下限;而线上 **answer 是秘密,不下发**
//   (AdvancedGamePublicProjection#copyEstimate 剥掉 answer / tolerance / reveal)。
//   所以这里用服务端投影里的 min / max —— 那两个字段本来就是为这件事存在的。
//   拿答案推量程会把答案暗示出去,那正是投影要防的事。
//
// ★ 判定同样在服务端:客户端只报"我停在哪个数"。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 滚筒的刻度。
 *  ★ 它是**滚轮**:中间是 500,上下就该是 499 和 501。跳着走的话那不叫滚轮,
 *  叫三个不相干的数摞在一起 —— 原型(playkit.html 的估数轮)一格永远是 1,
 *  量程再宽也靠拖动变速解决,不靠改刻度。
 *  我们的手势交给原生 picker-view,一两千个刻度它还撑得住,几万个会卡,
 *  所以只在超宽量程上才跳格;常见的 0–1000 一律一格一个数。 */
function stepFor(min, max) {
  const span = Math.max(0, num(max, 0) - num(min, 0));
  if (span <= 2000) return 1;
  if (span <= 20000) return 10;
  return Math.pow(10, String(Math.round(span)).length - 3);
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/** 刻度表。上限一定要落在表里,不然滑到底选不到量程上限。 */
function buildTicks(min, max) {
  const lo = num(min, 0);
  const hi = Math.max(lo, num(max, lo + 100));
  const step = stepFor(lo, hi);
  const out = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  if (out[out.length - 1] !== hi) out.push(hi);
  return out;
}

/** 开局停在哪一格:量程正中。停在 0 会让人以为还没开始,停在答案附近是作弊。 */
function initialIndex(ticks) {
  return ticks.length ? Math.floor(ticks.length / 2) : 0;
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    unit: { type: String, value: '' },
    min: { type: Number, value: 0 },
    max: { type: Number, value: 1000 },
    limitSeconds: { type: Number, value: 0 },
    maxTries: { type: Number, value: 0 },
  },
  data: {
    ticks: [],
    pickerValue: [0],
    curText: '0', prevText: '', nextText: '',
    feedback: '', locked: false,
  },
  observers: {
    'show, min, max': function (show, min, max) {
      if (!show) return;
      const ticks = buildTicks(min, max);
      const i = initialIndex(ticks);
      this._ticks = ticks;
      this.setData({
        ticks, pickerValue: [i], feedback: '', locked: false,
      });
      this._paint(i);
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
  },
  methods: {
    _stepFor: stepFor,          // 纯算法出口,供单测
    _buildTicks: buildTicks,
    _initialIndex: initialIndex,

    /** 三条道各画一个数。上下两条是镜像,内容就是相邻的那个数。 */
    _paint(i) {
      const t = this._ticks || [];
      this._index = i;
      this.setData({
        curText: String(t[i] == null ? '' : t[i]),
        prevText: String(t[i - 1] == null ? '' : t[i - 1]),
        nextText: String(t[i + 1] == null ? '' : t[i + 1]),
      });
    },

    onScroll(e) {
      const i = Number((e.detail.value || [])[0]) || 0;
      if (i === this._index) return;
      this._paint(i);
      // 每过一格给一下轻触感 —— 滚筒有没有"咔哒"是它像不像实物的关键
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
    },

    onSubmit() {
      if (this.data.locked) return;
      const guess = (this._ticks || [])[this._index];
      if (guess == null) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('submit', { guess });
    },

    /** 服务端判完回调这里。组件不自己比对 —— 答案根本不在客户端。 */
    settle(ok, detail) {
      const d = detail || {};
      const stage = this.selectComponent('#cy-play-stage');
      if (ok) {
        this.setData({ feedback: d.reveal || '', locked: true });
        if (stage) stage.win(d.reveal || '');
        return;
      }
      const exhausted = stage ? stage.miss() : true;
      if (stage && stage.nudge) stage.nudge();   // 答错整块台面抖一下(原型 .phone.shake)
      // 答错不算通关。运气型玩法也一样,不能因为「有运气成分」就放行
      this.setData({ feedback: d.feedback || '', locked: exhausted });
      if (exhausted && stage) stage.fail(false);
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this.triggerEvent('close'); },
  },
});
