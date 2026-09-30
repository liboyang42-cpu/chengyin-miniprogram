/**
 * cy-post-drafts · 草稿弹层(Figma 379:923)。Filled / Loading 两态 + 稿上没画的 Empty。
 *
 * 页面用法:
 *   wxml: <cy-post-drafts id="drafts" show="{{draftsShow}}" loading="{{draftsLoading}}"
 *                         drafts="{{drafts}}"
 *                         bind:select="onDraftPick" bind:delete="onDraftDelete" bind:close="closeDrafts" />
 *   js:   onDraftPick(e)   { ... }   // e.detail = { index, key, item } —— 拿 key 去 loadDraft
 *         onDraftDelete(e) {
 *           // e.detail 同上。⚠ 走到这里时用户**已经**过完危险确认弹窗,
 *           //   页面直接 removeDraft 即可,不要再自建一道 wx.showModal —— 那是两道闸。
 *           const c = this.selectComponent('#drafts');
 *           removeDraft(wx, { draftUuid: e.detail.key }, { memberId });
 *           c.deleteDone();            // 失败走 c.deleteFailed('...')
 *         }
 *
 * 数据边界:组件**不读 storage**。草稿的真源是 utils/publish/pro-editor-draft.js
 * (fabu 页在用的那一套,已拍板复用,不新造),由页面 load 好再传进来 —— 组件只渲染 + 发事件。
 * drafts 每项:{ key, avatar, nickname, date, summary }
 *   key      = 传给 pro-editor-draft 的 draftUuid(新草稿)或 topicId(既有主题)。
 *              组件不解释它,原样回传给页面。
 *   date     = 已格式化好的展示串(组件不做时间格式化,那是页面/工具层的事)。
 *   summary  = 摘要,两行截断。
 *
 * 危险确认闸长在组件内部(2026-09-02 Q1=A 拍板):接入页一挂上就自动带闸,
 * 不会出现「某个页面忘了加确认」这种漏。文案来自 utils/danger-actions.js 的
 * 'post.draft.delete' 登记条,不在这里硬写。
 *
 * ⚠ selectComponent 前面那个 && 不是防御性废话:单测的页面 VM 是裸对象没有这个方法,
 *   组件还没上屏时它也返回 null。拿不到确认组件就什么都不做 ——
 *   宁可删不掉,也不能绕过闸直接把 delete 发出去。
 */
const DELETE_CONFIRM_KEY = 'post.draft.delete';

Component({
  behaviors: [require('../../../../../behaviors/reduced-motion.js')],
  properties: {
    show:    { type: Boolean, value: false },
    /* 草稿还在读:走骨架而不是先闪一下空态(空态是个结论,读完才知道对不对)。 */
    loading: { type: Boolean, value: false },
    drafts:  { type: Array,   value: [] },
    /* sheetStyle:上层的高度/位置。由调用方算(只有它拿得到胶囊坐标),
       组件不自己推 —— 推出来的值在 env() 返回 0 的设备上会压住胶囊。 */
    sheetStyle: { type: String, value: '' },
  },
  methods: {
    /* 遮罩 / 「取消」:只上报,show 的所有权在页面 */
    onClose() {
      this.triggerEvent('close');
    },

    /* 选中一条:先收面板再上报 —— 接着要跳去编辑器,面板留在原地是碍事的。 */
    onSelect(e) {
      const row = this._row(e);
      if (!row) return;
      this.triggerEvent('close');
      this.triggerEvent('select', row);
    },

    /* 点垃圾桶只负责开闸。⚠ 这里不许 triggerEvent('delete') —— 那就是绕过确认。 */
    onDelete(e) {
      const row = this._row(e);
      const dc = this._danger();
      if (!row || !dc) return;
      this._pending = row;
      dc.open(DELETE_CONFIRM_KEY, { id: row.key });
    },

    /* 用户在确认弹窗里点了「删除草稿」才走到这 —— 此刻才把 delete 交给页面。 */
    onDeleteConfirmed() {
      const row = this._pending;
      if (!row) return;
      const dc = this._danger();
      if (dc) dc.busyOn();
      this.triggerEvent('delete', row);
    },

    /* 页面删完后的回执,透传给确认组件的第三段。不调不会卡死用户,但会少掉结果确认卡。 */
    deleteDone(text) {
      this._pending = null;
      const dc = this._danger();
      if (dc) dc.done(text);
    },
    deleteFailed(text) {
      const dc = this._danger();
      if (dc) dc.failed(text);
    },

    /* dataset.index → 那一条草稿。越界/脏 index 一律返回 null,不让它往下走。 */
    _row(e) {
      const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
      const index = Number(dataset.index);
      const item = (this.data.drafts || [])[index];
      if (!item) return null;
      return { index, key: item.key, item };
    },

    _danger() {
      return (this.selectComponent && this.selectComponent('#pd-danger')) || null;
    },
  },
});
