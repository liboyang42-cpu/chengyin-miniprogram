// cy-playkit-branch · 分支剧情(原型真源:模板编辑页 v2 · playkit branch)
//
// 界面和问答一样,只是选项决定下一段,**不判对错**。所以这一屏没有正确答案、
// 没有「还能错几次」,只有限时 —— 给一个不会执行的次数开关比不给更坏。
//
// ★ 跳转表与得分不下发。玩家点了哪一条报给服务端,由它给下一步的正文与选项;
// 整棵树发到客户端等于把所有结局提前剧透。
//
// 走向用「第几步」不用步骤 ID:ID 要人自己保证不重不漏,序号是现成的,
// 而且填错了也只会跳到不存在的那一步、被当成结局收掉,不会白屏。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

/* ⚠️ 这里原来有个 routeOf:客户端自己判「这条通向结局还是第几步」。
   删了 —— 走向只有服务端知道(下发的只有当前这一步,没有 nextStepId),
   客户端留着这份判断迟早和服务端分叉,而分叉的表现是「玩家看到的结局不是真结局」。
   现在壳只报选了哪一条,下一步由服务端给,是不是终点也由它说。 */

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    body: { type: String, value: '' },
    options: { type: Array, value: [] },
    // 终点由服务端说了算(currentStep.terminal),不由客户端猜
    ended: { type: Boolean, value: false },
    limitSeconds: { type: Number, value: 0 },
  },
  /* ⚠️ ended 是**属性**,内部要用的那份叫 isEnd —— observer 监听它、内部又写它
     会自己触发自己,死循环把运行时打挂,而且一条错都不报。 */
  data: { feedback: '', isEnd: false, picked: -1 },
  observers: {
    'show, body, ended': function (show) {
      if (!show) return;
      const ended = !!this.data.ended;
      this.setData({ feedback: '', isEnd: ended, picked: -1 });
      /* 走到终点就是走完了 —— 分支不判对错,一律按通过收。
         这一句要在 begin() 之前:begin 会把上一局的判定屏清掉。 */
      if (ended) {
        const stage = this.selectComponent('#cy-play-stage');
        if (stage) stage.win(this.data.body || '');
        return;
      }
      const stage = this.selectComponent('#cy-play-stage');
      if (stage) stage.begin();
    },
  },
  methods: {

    onPick(e) {
      if (this.data.isEnd || this.data.picked >= 0) return;
      const i = Number(e.currentTarget.dataset.i);
      const opt = this.data.options[i] || {};
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      /* 选中就锁住,等服务端给下一步。不锁的话手快的人能连点两条,
         而第二条会带着上一步的 id 发出去 —— 服务端那边是「当前步骤没有这个选项」。 */
      this.setData({ picked: i });
      this.triggerEvent('choose', { index: i, optionId: opt.id || '' });
    },

    onVerdict(e) { this.triggerEvent('verdict', e.detail); },
    onClose() { this.triggerEvent('close'); },
  },
});
