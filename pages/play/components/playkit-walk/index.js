// cy-playkit-walk · 低碳行动 · 计步(照原型 playkit.html 的 walk 那一屏)
//
// 一条线:设目标 → 倒着数步数 → 归零落章。没有 tab,没有第二条路。
//
// ★ 步数**只能同步不能填**。这不是防作弊的洁癖 —— 能填的话这个玩法当场作废,
// 而它的全部价值就在于那个数是真的。
// 小程序侧走 wx.getWeRunData 拿加密数据,**解密在服务端**:客户端拿到的是密文,
// 连自己都读不出来,更改不了。
//
// ⚠️ 这一屏没有限时也没有次数:计步本来就是一段长时间的事,套一个 15 分钟的上限
// 没有意义;而且它一天只结算一次,「能错几次」也无从谈起。

const STEP_UNIT = 500;         // 每格 500 步,与原型同值
const CO2_PER_STEP = 0.00008;  // 一步约少排这么多 kg,与原型同值

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/** 千分位。LCD 上的数字不加逗号会读成一长串,而这一屏就这一个数。 */
function group(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 还差多少。走超了给 0,不给负数 —— 负数会让人以为倒扣。 */
function remain(steps, goal) {
  return Math.max(0, (Number(goal) || 0) - (Number(steps) || 0));
}

/** 走到几成。目标为 0 时给 0,不给 NaN 或 100。 */
function percent(steps, goal) {
  const g = Number(goal) || 0;
  if (g <= 0) return 0;
  return Math.min(100, Math.round((Number(steps) || 0) / g * 100));
}

/** 少排多少碳。两位小数 —— 再多位是假精度,这个数本来就是估的。 */
function co2Of(steps) {
  return ((Number(steps) || 0) * CO2_PER_STEP).toFixed(2);
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    // 商家设的目标。玩家可以在这上面加减,但加减的是**自己今天的目标**
    goal: { type: Number, value: 6000 },
    /* ★ 节点玩法「计步挑战」走这一屏时锁死目标:达标与否由服务端拿商家配的 cfg.goal 判
       (submitSteps),玩家在屏上 ± 改的只是本地数字,判定根本不看 —— 让他改就是骗他。
       低碳行动那条线(玩家自己定今天走多少)不传这个属性,照旧可加减。 */
    goalLocked: { type: Boolean, value: false },
    // 服务端解密回来的步数。客户端拿不到明文,所以这个值只会从外面进来
    steps: { type: Number, value: 0 },
    syncing: { type: Boolean, value: false },
  },
  data: {
    mode: 'goal',              // goal 设目标 / run 数步数
    goalText: '6,000',
    stepsText: '0',
    leftText: '6,000',
    pct: 0,
    scale: 0,        // 0–1,直接喂 scaleX
    co2: '0.00',
    done: false,
    ctaLabel: '同步微信运动',
  },
  observers: {
    'show, goal, steps, goalLocked': function (show, goal, steps) {
      if (!show) return;
      // 锁死时永远用外面给的目标;没锁才认玩家自己 ± 出来的那个
      this._paint((this.data.goalLocked || this._goal == null) ? goal : this._goal, steps);
    },
  },
  methods: {
    _group: group,            // 纯算法出口,供单测
    _remain: remain,
    _percent: percent,
    _co2Of: co2Of,
    _stepUnit: () => STEP_UNIT,

    _paint(goal, steps) {
      this._goal = Math.max(STEP_UNIT, Math.round(goal / STEP_UNIT) * STEP_UNIT);
      const left = remain(steps, this._goal);
      const done = steps > 0 && left === 0;
      this.setData({
        // 目标锁死时不给「设目标」那一档 —— 没得设,直接进倒数
        mode: (this.data.goalLocked || steps > 0) ? 'run' : 'goal',
        goalText: group(this._goal),
        stepsText: group(steps),
        leftText: group(left),
        pct: percent(steps, this._goal),
        scale: Number((percent(steps, this._goal) / 100).toFixed(3)),
        co2: co2Of(steps),
        done,
        ctaLabel: done ? '落章' : (this.data.syncing ? '同步中…' : '同步微信运动'),
      });
    },

    /** 每格 500 步。下限一格,不给 0 —— 目标 0 步不是一个目标。 */
    onStep(e) {
      if (this.data.mode !== 'goal') return;
      const d = Number(e.currentTarget.dataset.d) > 0 ? 1 : -1;
      const next = Math.max(STEP_UNIT, this._goal + d * STEP_UNIT);
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this._paint(next, this.data.steps);
      this.triggerEvent('goalchange', { goal: next });
    },

    onCta() {
      if (this.data.syncing) return;
      if (this.data.done) {
        // 「做成了」= 归零落章那一刻,不是同步按钮按下去那一下
        motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
        const stage = this.selectComponent('#cy-play-stage');
        if (stage) stage.win('走到了 ' + this.data.stepsText + ' 步');
        this.triggerEvent('claim', { steps: this.data.steps, goal: this._goal });
        return;
      }
      // 只发「去同步」这个意图,拿数据和解密都在外面 —— 客户端读不到明文
      this.triggerEvent('sync', { goal: this._goal });
    },

    onClose() { this.triggerEvent('close'); },
  },
});
