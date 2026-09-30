/* cy-result-sheet · 一次动作的结果面板(不是区域/整页的数据状态 —— 那是 cy-state-shell 的活)
 *
 * 三态 success / fail / loading。默认没有按钮:结果本身没有后续选择时,按钮只是多一次点击。
 * ⚠️ 有导航分叉的成功(发布成功要在「去项目主页 / 看玩家视角」之间选)不归这里,
 *    那条路仍走 pages/publish/components/creation-success —— 2s 自愈会把人丢回编辑器。
 *
 * 自愈的前提是「这个结果没有后续选择」,所以两处显式不自愈:
 *   ① loading —— 请求还在途,自己收掉 = 抹掉用户唯一的进度反馈,它压根没有终点;
 *   ② 传了 primaryText(面板上有按钮)—— 面板正等人做选择,倒计时把它收走就是抢答。
 *
 * 2026-09-17 商家营销同意入口(拍板第 40 条 A)在这加一处:面板里可能有可选的同意勾选行。
 * 不勾的用户行为与今天完全一致(照常自愈 → 直接跳);只有真去勾了才暂停自愈,等保存
 * 成功(短暂停留后照常走 close)/ 失败(留在面板内可重试)。
 */
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show:     { type: Boolean, value: false },
    kind:     { type: String,  value: 'success' },  // success | fail | loading
    title:    { type: String,  value: '' },
    sub:      { type: String,  value: '' },
    meta:     { type: String,  value: '' },         // 琥珀提示行,只在真有信息要带时传
    pill:     { type: String,  value: '' },         // 一条中性事实,不可点
    why:      { type: String,  value: '' },         // 失败原因,只在 fail 态画
    /* 按钮:只传 primaryText = 一颗;两个都传 = 并排两颗(次要在左,与稿一致)。 */
    primaryText:   { type: String,  value: '' },
    secondaryText: { type: String,  value: '' },
    primaryLoading: { type: Boolean, value: false },
    /* 终态停留时长。传 0 关掉自愈;有按钮时本值被忽略(见上)。 */
    duration: { type: Number,  value: 2000 },
    /* 可选同意行(商家营销消息):consentName 为空 = 整行不渲染。
       勾选状态/保存态由宿主持有,组件只渲染与上报 —— 网络与重试都在宿主(订单页/票务页)。 */
    consentName: { type: String, value: '' },
    consentChecked: { type: Boolean, value: false },
    consentState: { type: String, value: 'idle' },   // idle | saving | saved | failed
    consentError: { type: String, value: '' },
  },
  /* 八颗粒子的位次。wx:for 直接写数字在各版本基础库上行为不一致,
     显式给一个数组,不赌它。 */
  data: { sparks: [0, 1, 2, 3, 4, 5, 6, 7] },
  observers: {
    'show, kind, duration, primaryText'() { this._schedule(); },
    /* 同意勾选/保存态变化也要重排自愈:勾了要停表,保存成功后短暂停留再走。 */
    'consentChecked, consentState'() { this._schedule(); },
  },
  lifetimes: {
    detached() { this._clear(); },
  },
  methods: {
    _clear() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    },
    /* 勾选行已被用户接管:从这一刻到保存成功/失败,面板不再自动收。
       saved 是单独一档 —— 短暂停留让人看到回执,再照常走 close。 */
    _consentEngaged() {
      return this.data.consentState === 'saving' || this.data.consentState === 'failed'
        || (this.data.consentChecked && this.data.consentState !== 'saved');
    },
    _schedule() {
      this._clear();
      if (!this.data.show) return;
      if (this.data.kind === 'loading') return;   // 在途状态没有终点,不自愈
      if (this.data.primaryText) return;          // 面板在等人选,别抢答
      if (this.data.consentState === 'saved') {
        this._timer = setTimeout(() => {
          this._timer = null;
          this.triggerEvent('close', { reason: 'consent-saved' });
        }, 1200);
        return;
      }
      if (this._consentEngaged()) return;         // 用户真去勾了:停在这里等保存结果(失败可重试)
      if (!(this.data.duration > 0)) return;
      this._timer = setTimeout(() => {
        this._timer = null;
        this.triggerEvent('close', { reason: 'timeout' });
      }, this.data.duration);
    },
    onPrimary() { this._clear(); this.triggerEvent('primary'); },
    onSecondary() { this._clear(); this.triggerEvent('secondary'); },
    onConsentChange(e) {
      this.triggerEvent('consentchange', { checked: !!(e.detail && e.detail.checked) });
    },
    onConsentRetry() { this.triggerEvent('consentretry'); },
    /* 遮罩/抓手关闭:loading 态 cy-sheet 已被 mask-closable=false 挡住,到不了这里 */
    onSheetClose(e) {
      this._clear();
      this.triggerEvent('close', { reason: (e.detail && e.detail.reason) || 'mask' });
    },
  },
});
