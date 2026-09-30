// cy-playkit-journey-check · R14 旅程检定一屏(掷 → 结果 → 结算)
//
// 数据源不是 playKit:入口在 encounter 视图的 allowedActions(含 'check'),
// 题面在 enc.check,判定与文案走 /api/play/check/{roll,reroll,settle}。
// 这一屏只画服务端给的东西,不自己判成败、不自己编文案:
//   · roll 回执有骰子 / 达成值 / DC / success —— 先出结果;
//   · settle 回执才有 text / failCostLabel —— 结算后才出文案。
// ★ 失败也推进:结算后照常可以退出,这一屏不拦节点完成(产品口径)。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const replayMotionBehavior = require('../../../../behaviors/replay-motion.js');
const motion = require('../../../../utils/motion.js');

/** 难度档码 → 中文。服务端只给 easy/medium/hard(禁止任意 DC 数字)。 */
const TIER_LABEL = { easy: '简单', medium: '标准', hard: '困难' };

/** 重掷条件:掷过、没结算、没重掷过,且幸运还有剩。回执里 luck 缺省时不猜。 */
function canReroll(receipt) {
  if (!receipt || receipt.settled || receipt.rerolled) return false;
  return Number(receipt.luck) > 0;
}

Component({
  behaviors: [reducedMotionBehavior, replayMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    skill: { type: String, value: '' },
    tier: { type: String, value: '' },
    mods: { type: Array, value: [] },        // 题面条件修正:[{label,value,held}]
    advantage: { type: Boolean, value: false },
    disadvantage: { type: Boolean, value: false },
    receipt: { type: Object, value: null },  // checkReceiptView() 的产物;没掷时 null
  },
  data: {
    tierLabel: '',
    rerollVisible: false,
    verdictText: '',
  },
  observers: {
    'show, tier, receipt': function (show, tier, receipt) {
      if (!show) return;
      const r = receipt || null;
      /* 重掷要重播骰子。判据是「上一次也是没结算的掷」—— 那种情况 wx:elif 分支不切换、
         骰子个数不变,节点全部复用,jc-die 与 .72s/.82s 的错峰读数一条都不播。
         首次从题面进结果屏时分支真的切了、节点是新建的,不走这里,否则会多摘一帧。 */
      const prev = this._seenReceipt;
      if (r && !r.settled && prev && !prev.settled && r !== prev) this.replayMotion();
      this._seenReceipt = r;
      this.setData({
        tierLabel: TIER_LABEL[String(tier || '').toLowerCase()] || (tier || ''),
        rerollVisible: canReroll(r),
        verdictText: r ? (r.success ? '过线了' : '没过线') : '',
      });
    },
  },
  methods: {
    _canReroll: canReroll,     // 纯算法出口,供单测

    /** 掷 / 重掷 / 结算收口成一个事件:页面按 detail.action 分派,与 kitaction 同一手法 */
    onRoll() {
      if (this.data.loading || this.data.receipt) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('action', { action: 'roll' });
    },
    onReroll() {
      if (this.data.loading || !this.data.rerollVisible) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('action', { action: 'reroll' });
    },
    onSettle() {
      if (this.data.loading || !this.data.receipt || this.data.receipt.settled) return;
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('action', { action: 'settle' });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
