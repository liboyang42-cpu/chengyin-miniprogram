/**
 * behaviors/replay-motion.js —— 让关键帧入场能重播(2026-09-22)
 *
 * 关键帧只在**节点新建**那一刻播一次。玩法屏里大量场景是节点复用、只有内容原地变,
 * 于是 pk-in / jc-die 挂上去了却看不见:
 *   · 旅程检定「重掷」:receipt 换了新对象但 settled 仍为 false,wx:elif 分支不切换;
 *     骰子是 wx:for + wx:key="index" 且个数不变 —— 节点全部复用,数字直接跳变;
 *   · 拍照审核第二次判定:wx:if="{{verdict}}" 一旦为真就恒真,连「这张过了」也不播;
 *   · 限时打字换到下一个 typein 节点:同类型分支不变、组件不重建,目标文本原地改字。
 *
 * 做法:把 animation 先摘掉一帧再装回去 —— animation 从 none 变回具体值,浏览器就重新起播。
 * 摘的是**宿主外层 view 上的一个类**(.pk--reset),不动每个元素自己的 class;
 * 配套规则在 pages/play/style/play-surface.wxss(共用那条)与各屏的专属动效旁边。
 *
 * ⚠️ 摘掉的那一帧元素处于自然态(可见),所以有约一帧的末态闪现。16ms,实测看不出;
 *    要彻底消掉得让节点真被重建,那样反而闪一帧**空白**,更糟。
 *
 * 宿主需要三件事,少一件就是死代码:
 *   ① 外层 view 挂 `{{_motionReset ? 'pk--reset' : ''}}`
 *   ② 在「内容原地变了」的地方调 `this.replayMotion()`
 *   ③ 同时挂 behaviors/reduced-motion.js —— 减弱动效时本 behavior 直接不动手
 * ①② 由 tests/unit/playkit-entrance-motion-contract.test.js 全等比对钉住。
 */
module.exports = Behavior({
  data: {
    // true = 这一帧把动画摘掉。只活一帧,下一帧就置回 false 让动画重新起播。
    _motionReset: false,
  },
  methods: {
    replayMotion() {
      // 减弱动效下本来就没有动画可重播,别白发两次 setData
      if (this.data.reducedMotion) return;
      this.setData({ _motionReset: true });
      const resume = () => this.setData({ _motionReset: false });
      // wx.nextTick 在渲染落地后回调;node 单测环境没有 wx,退回 setTimeout(0)
      if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(resume);
      else setTimeout(resume, 0);
    },
  },
});
