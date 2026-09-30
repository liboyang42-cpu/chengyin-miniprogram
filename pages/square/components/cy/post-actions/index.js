/**
 * cy-post-actions · 帖文「···」操作弹层(Figma 347:737)。三合一:编辑 / 删除 / 举报。
 *
 * 页面用法:
 *   wxml: <cy-post-actions show="{{actionsShow}}" owner="{{isMine}}" post-id="{{post.id}}"
 *                          bind:select="onPostAction" bind:close="closeActions" />
 *   js:   onPostAction(e) {
 *           // e.detail = { action: 'edit' | 'delete' | 'report', id }
 *           // ⚠ action==='delete' 时用户**已经**过完危险确认弹窗,页面直接发请求即可,
 *           //   不要再自建一道 wx.showModal —— 那是两道闸,用户要点两次。
 *         }
 *
 * 危险确认闸长在组件内部(2026-09-02 Q1=A 拍板):接入页一挂上就自动带闸,
 * 不会出现「某个页面忘了加确认」这种漏。文案来自 utils/danger-actions.js 的
 * 'club.post.delete' 登记条,不在这里硬写。
 *
 * 删除请求发出后的三段式回执由页面驱动:请求成功调 deleteDone(),失败调 deleteFailed(msg)。
 * 不调也不会卡死用户(确认弹窗可以被取消),但会少掉结果确认卡。
 *
 * ⚠ selectComponent 前面那个 && 不是防御性废话:单测的页面 VM 是裸对象没有这个方法,
 *   组件还没上屏时它也返回 null。拿不到确认组件就什么都不做 ——
 *   宁可删不掉,也不能绕过闸直接把 delete 发出去。
 */
const DELETE_CONFIRM_KEY = 'club.post.delete';
const { postExcerpt } = require('../../../../../utils/danger-actions.js');

Component({
  properties: {
    show:   { type: Boolean, value: false },
    /* 是不是本人的帖。只有本人看得到「编辑」「删除」;别人只剩「举报」一行。 */
    owner:  { type: Boolean, value: false },
    postId: { type: String,  value: '' },
    /* CU-C-107:待删帖文的正文前段 —— 确认框要能核对删的是哪一条。宿主页传过来,
       组件不自己再去拉一次帖子(列表已经在手上了)。 */
    summary: { type: String, value: '' },
  },
  methods: {
    /* 遮罩 / 关闭:只上报,show 的所有权在页面 */
    onClose() {
      this.triggerEvent('close');
    },

    onEdit()   { this._pick('edit'); },
    onReport() { this._pick('report'); },

    /* 三个入口一律先收起菜单再走动作:删除要把屏幕让给确认弹窗,
       编辑/举报要么跳页要么弹二次确认,菜单留在原地都是碍事的。 */
    _pick(action) {
      this.triggerEvent('close');
      this.triggerEvent('select', { action, id: this.data.postId });
    },

    onDelete() {
      const dc = this._danger();
      if (!dc) return;
      this.triggerEvent('close');
      dc.open(DELETE_CONFIRM_KEY, { id: this.data.postId, name: postExcerpt(this.data.summary) });
    },

    /* 用户在确认弹窗里点了「删除动态」才走到这 —— 此刻才把 delete 交给页面。 */
    onDeleteConfirmed() {
      const dc = this._danger();
      if (dc) dc.busyOn();
      this.triggerEvent('select', { action: 'delete', id: this.data.postId });
    },

    /* 页面请求成功 / 失败后的回执,透传给确认组件的第三段。 */
    deleteDone(text) {
      const dc = this._danger();
      if (dc) dc.done(text);
    },
    deleteFailed(text) {
      const dc = this._danger();
      if (dc) dc.failed(text);
    },

    _danger() {
      return (this.selectComponent && this.selectComponent('#pa-danger')) || null;
    },
  },
});
