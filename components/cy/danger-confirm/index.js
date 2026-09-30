/**
 * cy-danger-confirm · 危险动作三段式确认。
 *
 * 三段:①确认弹窗(说清后果 + 给更轻替代)→ ②执行(危险键内转圈,全程锁死)→ ③结果确认卡。
 * 文案不写在页面里,全部来自 utils/danger-actions.js 的登记表,页面只给一个 key。
 * 这样门禁(scripts/danger-confirm-gate.js)才能逐条校验「不可逆的写没写明不可撤销」。
 *
 * 页面用法:
 *   wxml: <cy-danger-confirm id="dc" bind:confirm="doRemove" bind:alt="goTransfer" />
 *   js:   askRemove(row) {
 *           const dc = this.selectComponent && this.selectComponent('#dc');
 *           if (dc) dc.open('club.member.remove', { name: row.nickname, id: row.id });
 *         },
 *         doRemove(e) {                       // e.detail = { key, params }
 *           const dc = this.selectComponent && this.selectComponent('#dc');
 *           if (dc) dc.busyOn();
 *           app.sendRequest({ ...,
 *             success: () => { if (dc) dc.done(); },
 *             fail:    () => { if (dc) dc.failed('网络异常，请重试'); },
 *           });
 *         }
 *
 * ⚠ selectComponent 前面那个 && 不是防御性废话:单测的页面 VM 是裸对象,没有这个方法,
 *   直接调会 TypeError;组件还没上屏时它也会返回 null。拿不到就跳过确认、不执行动作 ——
 *   宁可什么都不发生,也不能绕过确认直接删。
 */
const { getDangerAction } = require('../../../utils/danger-actions.js');

Component({
  properties: {
    cancelText: { type: String, value: '取消' },
  },
  data: {
    stage: '',        // '' | 'confirm' | 'done' | 'error'
    action: null,     // 当前动作的完整文案(来自登记表)
    params: null,
    busy: false,      // 执行中:确认键转圈 + 锁死
    doneTitle: '',
    doneText: '',
    errorText: '',
  },
  methods: {
    /**
     * 打开确认弹窗。key 必须在 utils/danger-actions.js 里登记过。
     * 没登记时不静默降级成裸执行 —— 那正是这次要根治的问题,所以宁可什么都不弹并留下 error。
     */
    open(key, params, opts) {
      const action = getDangerAction(key, params);
      if (!action) {
        // 只打固定标签:no-sensitive-console 门禁禁止把动态值(这里是 key)写进开发者日志。
        console.error('[cy-danger-confirm] 未登记的危险动作 key');
        return false;
      }
      // 替代方案在当前状态下没意义时(比如「改为下架」但这一项本来就是下架的),
      // 隐掉它 —— 摆一个点了会把状态翻回去的按钮,比没有替代方案更坏。
      if (opts && opts.hideAlt) action.alt = null;
      this._params = params || {};
      this.setData({
        stage: 'confirm',
        action,
        busy: false,
        errorText: '',
      });
      return true;
    },

    /** 页面开始发请求时调用:锁死弹窗并让危险键转圈。 */
    busyOn() {
      if (this.data.stage === 'confirm') this.setData({ busy: true });
    },

    /** 执行成功:切到结果确认卡。text 传空则用登记表里的默认回执。 */
    done(text) {
      const done = (this.data.action && this.data.action.done) || {};
      this.setData({
        stage: 'done',
        busy: false,
        doneTitle: done.title || '已完成',
        doneText: text || done.text || '',
      });
    },

    /** 执行失败:留在原地给重试,别把用户踢走让他猜删没删掉。 */
    failed(text) {
      this.setData({ stage: 'error', busy: false, errorText: text || '请稍后重试' });
    },

    /** 直接收起(页面自己要跳走时用)。 */
    close() {
      this._params = null;
      this.setData({ stage: '', busy: false, action: null, errorText: '' });
    },

    onConfirm() {
      if (this.data.busy) return;
      this.triggerEvent('confirm', { key: this.data.action.key, params: this._params || {} });
    },
    onAlt() {
      if (this.data.busy) return;
      const key = this.data.action.key;
      const params = this._params || {};
      this.setData({ stage: '' });
      this.triggerEvent('alt', { key, params });
    },
    onCancel() {
      if (this.data.busy) return;
      const key = this.data.action.key;
      this.setData({ stage: '' });
      this.triggerEvent('cancel', { key });
    },
    onRetry() {
      this.setData({ stage: 'confirm', busy: false, errorText: '' });
    },
    onCloseDone() {
      const key = this.data.action && this.data.action.key;
      this.setData({ stage: '' });
      this.triggerEvent('done', { key });
    },
  },
});
