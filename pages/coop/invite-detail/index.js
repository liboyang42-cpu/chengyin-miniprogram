/**
 * 协作邀约 · 详情(Figma 02d-1 ~ 02d-5)
 *
 * 为什么要有这一页:列表只给一行状态字。稿上「已拒绝 / 已过期 / 已顶替」都要能看到
 * **对方给的理由**和当时的条款快照,这些在列表里没有落脚点。
 *
 * ★ 取数刻意走 /api/coop/list 再按 inviteId 挑出来,而不是从上一页把整行带过来:
 *   带过来的是**打开列表那一刻**的状态,对方在这中间接受/撤回了都看不出来。
 *   详情是要据此做决定的页,必须问服务端要一次新的。
 *
 * ★ 接受/拒绝/撤回/取消四个决策都走 /api/coop/handle(后端写死角色分界)。
 * 2026-09-15 总控裁决:已接受卡最多两个按钮,卡片上的履约动作搬到这里 ——
 *   联系合作方(会话)、申报供给(勾选浮层)、评价(星级 + 评语)、双方的取消合作。
 *   详情页动作区同样 ≤2 并排:底部动作条只留决策/保证金,其余按列表行收纳在「合作操作」卡。
 *   ★ 保证金仍是涉资链路:checkout 工作流与支付回读只在 pages/coop/list 有一份,
 *     这里只给入口,把人带回那条链路 —— 涉资的东西复制第二份必出事。
 */
const app = getApp();
const toast = require('../../../utils/toast.js');
const modal = require('../../../utils/modal.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { isRecordList } = require('../../../utils/response-shape.js');
const { decorate, STATUS_LABEL, parseInviteId, INVITE_ID_ERROR } = require('../../../utils/coop-invite-view.js');

// 状态 → 顶部大字的语气。已接受是唯一的正向终态,其余终态一律中性,
// 不用红色 —— 「已拒绝」是一个事实,不是错误。
const TONE = { 0: 'pending', 1: 'accepted', 2: 'closed', 3: 'closed', 4: 'closed', 5: 'closed' };

const jsonHeader = () => ({ 'Content-Type': 'application/json' });

Page({
  data: {
    state: 'loading',              // loading | ready | missing | error | notfound
    errorText: '',
    box: 'received',               // received | sent
    invite: null,
    tone: 'closed',
    statusText: '',
    // 三种输入态,互斥:回复(收件箱待确认) / 撤回理由(发件箱待确认,必填) / 留言(已接受)
    inputKind: '',                 // reply | withdraw | note | ''
    inputLabel: '',
    inputPlaceholder: '',
    draft: '',
    draftError: '',
    submitting: false,
    // 已接受的履约动作(卡片上搬来):行内回执/说明 + 保证金入口可见性
    actionReceipt: '',
    actionError: '',
    depositActionVisible: false,
    projectActionVisible: false,
    // 供给申报勾选浮层(原在 pages/coop/list)。当前邀约 id 不进 data:wxml 不渲染它,提交时从 invite 取。
    showPerkPick: false,
    perkTemplates: [],
    perkSaving: false,
    perkState: 'idle',
    perkErrorText: '',
    // 评价:先选星级(cy-option-sheet)再写评语(可输入 modal)
    reviewSheetShow: false,
    myReviewStars: '',
    reviewSheetItems: ['★★★★★ 非常好', '★★★★ 好', '★★★ 一般', '★★ 较差', '★ 差'],
  },

  onLoad(query) {
    const id = query && query.inviteId;
    const box = query && query.box === 'sent' ? 'sent' : 'received';
    this._inviteId = parseInviteId(id);
    this.setData({ box: box });
    if (!this._inviteId) {
      this.setData({ state: 'missing', errorText: id
        ? '邀约编号无效，请从协作邀请列表重新进入'
        : '缺少邀约编号，请从协作邀请列表重新进入' });
      return;
    }
    this.load();
  },
  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._perkEpoch = (this._perkEpoch || 0) + 1;
    this._contacting = false;
    this._perkLoading = false;
    this._reviewing = false;
    merchantTheme.merchantPageRestore();
  },
  onPullDownRefresh() { this.load(true); },

  load(fromPull) {
    if (this.data.state !== 'ready') this.setData({ state: 'loading' });
    const that = this;
    const done = () => { if (fromPull && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh(); };
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/coop/list', method: 'POST', data: JSON.stringify({}), header: jsonHeader(),
      success(res) {
        done();
        const d = res && res.data;
        if (String(res && res.code) !== '200' || !d || !isRecordList(d.received) || !isRecordList(d.sent)) {
          that.setData({ state: 'error', errorText: (res && res.msg) || '协作邀请没加载出来' });
          return;
        }
        const rows = decorate(that.data.box === 'sent' ? d.sent : d.received, d.slots);
        const hit = rows.filter(function (r) { return String(r.inviteId) === that._inviteId; })[0];
        if (!hit) {
          if (rows.some(function (r) { return !!r.identityError; })) {
            that.setData({ state: 'error', errorText: INVITE_ID_ERROR });
            return;
          }
          // 找不到不等于出错:可能已经被移出这一侧(比如撤回后从收件箱消失)。
          // 说清楚是「不在这个列表里了」,而不是含糊的加载失败。
          that.setData({ state: 'notfound' });
          return;
        }
        that.applyInvite(hit);
      },
      fail() {
        done();
        that.setData({ state: 'error', errorText: '网络不稳定，请检查连接后重试' });
      },
    });
  },

  applyInvite(inv) {
    const status = Number(inv.status);
    const sent = this.data.box === 'sent';
    const merchantSide = (Number(inv.inviteType) === 0 && !sent)
      || (Number(inv.inviteType) === 1 && sent);
    let kind = '', label = '', ph = '';
    if (status === 0 && !sent && !inv.legacyReadonly) {
      kind = 'reply'; label = '回复对方(选填，随本次决定一起发出)'; ph = '写下接受或拒绝的理由…';
    } else if (status === 0 && sent && !inv.legacyReadonly) {
      // 稿上这一栏是必填:撤回要给对方一个理由,现码 _cancelAsInitiator 也是空理由直接拦
      kind = 'withdraw'; label = '撤回理由(必填，会发给对方)'; ph = '说明为什么撤回这条邀约…';
    }
    this.setData({
      state: 'ready', invite: inv,
      statusText: STATUS_LABEL[status] || '',
      tone: TONE[status] || 'closed',
      inputKind: kind, inputLabel: label, inputPlaceholder: ph, draft: '', draftError: '',
      actionReceipt: '', actionError: '',
      // 欠保证金时给唯一实心入口(搬走的动作不在这里重复);!legacyReadonly 与搬走的卡片闸一致
      depositActionVisible: status === 1 && !inv.legacyReadonly && !!inv.depositDueText,
      projectActionVisible: status === 1 && !inv.legacyReadonly
        && merchantSide && !!parseInviteId(inv.topicId),
      showPerkPick: false, perkTemplates: [], perkSaving: false, perkState: 'idle', perkErrorText: '',
      reviewSheetShow: false,
      myReviewStars: '',
    });
    if (status === 1 && !inv.legacyReadonly) this.loadMyReview(inv);
  },

  // 被评对象与 reviewCoop 同一口径;回读「我对这次合作打过的分」。读不到就照常给「评价」入口,
  // 真重复提交由后端「已评价过该合作」兜底。
  loadMyReview(inv) {
    const toId = this.data.box === 'received' ? inv.fromId : inv.toId;
    if (!toId || !inv.topicId) return;
    const me = String(app.getUserID() || '');
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/coop/review/summary', method: 'POST',
      data: JSON.stringify({ toId: toId }), header: jsonHeader(),
      success(res) {
        const rows = res && String(res.code) === '200' && res.data && Array.isArray(res.data.reviews) ? res.data.reviews : [];
        const mine = rows.filter(function (r) {
          return r && String(r.fromId) === me && String(r.topicId) === String(inv.topicId);
        })[0];
        const rating = mine ? Number(mine.rating) : 0;
        // setData 会拷贝对象,不能用引用相等判断「还是同一条邀约」
        if (rating >= 1 && rating <= 5 && that.data.invite && String(that.data.invite.inviteId) === String(inv.inviteId)) {
          that.setData({ myReviewStars: '★★★★★'.slice(0, rating) });
        }
      },
    });
  },

  onDraftInput(e) { this.setData({ draft: e.detail.value, draftError: '' }); },

  copyPhone() {
    const phone = this.data.invite && this.data.invite.partnerPhone;
    if (!phone) return;
    wx.setClipboardData({ data: String(phone), success() { toast('已复制'); }, fail() { toast('没能复制'); } });
  },

  /* ——— 三个决策都走 /api/coop/handle ———
   * status 1 接受 / 2 拒绝 = 受邀方(收件箱);3 撤回 = 发起方(发件箱)。
   * 这条角色分界是后端写死的,前端按 box 决定给哪些按钮,不靠 dataset 传 status ——
   * 动态传值会让 coop-handle-single-consumer 那条门禁静态判不出角色。 */
  /* 三个决策都走 /api/coop/handle:1 接受 / 2 拒绝 = 受邀方,3 撤回 = 发起方。
     status 写成字面量、且落在 _post 的调用点上 —— coop-handle-single-consumer 那条门禁
     是从「直接包含请求 URL 的那个方法」往回找调用点解析角色的,只跟一层。
     所以确认弹层抽成 _confirm 收回调,而不是把 _post 再包一层转发。 */
  accept() { const that = this; this._confirm('接受合作', '接受后条款即冻结，按这张单结算。', false, function () { that._post(1); }); },
  reject() { const that = this; this._confirm('拒绝这条邀约', '拒绝后对方可以改条款再邀你。', true, function () { that._post(2); }); },
  withdraw() {
    if (!String(this.data.draft || '').trim()) {
      // 长说明落在字段旁边(draftError),toast 只做一句短提示 —— 门禁的 16 字上限就是这个意思
      this.setData({ draftError: '对方拿着这句话才知道下一步该怎么改。' });
      toast('先写撤回理由');
      return;
    }
    this.setData({ draftError: '' });
    const that = this;
    this._confirm('撤回邀约', '撤回后对方不再看到这条邀约。', true, function () { that._post(3); });
  },

  _confirm(title, content, danger, onOk) {
    if (this.data.submitting) return;
    const inv = this.data.invite;
    if (!inv || inv.legacyReadonly) return;
    modal.show({ title: title, content: content, confirmText: title, danger: danger,
      // 点「取消」回的是 {confirm:false, cancel:true} —— 对象恒为真,只看 ok 会把取消也提交(C2)
      success(ok) { if (ok && ok.confirm) onOk(); } });
  },

  // reasonOverride 给「取消已接受合作」用:理由来自确认框,不走页面上的留言字段
  _post(status, reasonOverride) {
    const inv = this.data.invite;
    if (!inv) return;
    if (inv.identityError || !parseInviteId(inv.inviteId)) {
      this.setData({ state: 'error', errorText: INVITE_ID_ERROR });
      return;
    }
    const that = this;
    const reason = reasonOverride != null ? String(reasonOverride) : String(this.data.draft || '').trim();
    // 字段名各自对齐后端 ApiCoopController.handle:取消(3)读 message,接受/拒绝(1/2)读 handleReason。
    // CoopInvite 上这两个字段互相独立,取消发 handleReason 会恒回「取消已接受的合作需填写理由」(审查 C1)。
    const payload = { id: inv.inviteId, status: status };
    if (status === 3) payload.message = reason; else payload.handleReason = reason;
    this.setData({ submitting: true, actionReceipt: '', actionError: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/coop/handle', method: 'POST',
      data: JSON.stringify(payload),
      header: jsonHeader(),
      success(res) {
        that.setData({ submitting: false });
        if (String(res && res.code) !== '200') { toast((res && res.msg) || '没能提交，请重试'); return; }
        // 回执不等于状态:重新问服务端要一次,拿它回的状态渲染,不本地假设成功后的样子
        toast('已提交');
        that.load();
      },
      fail() { that.setData({ submitting: false }); toast('网络开小差了，没能提交'); },
    });
  },

  /* ——— 已接受卡搬来的履约动作(总控裁决 2026-09-15:卡片最多两个按钮)———
   * 「联系合作方 / 申报供给 / 评价」原在 pages/coop/list 的已接受卡上,现在按列表行收纳在这里;
   * 「取消合作」也一样(涉资:锁价前双方都可取消并退保证金;H018/H033 收件方入口)。
   * 保证金 checkout 仍只在 list 一份。 */

  openAcceptedProject() {
    const inv = this.data.invite;
    const sent = this.data.box === 'sent';
    const merchantSide = inv && ((Number(inv.inviteType) === 0 && !sent)
      || (Number(inv.inviteType) === 1 && sent));
    const topicId = inv && parseInviteId(inv.topicId);
    if (!inv || Number(inv.status) !== 1 || inv.legacyReadonly || !merchantSide || !topicId) return;
    /* CU-M-92(走查第三轮,回到第一轮的建议):走 ?topicId= —— 身份由后端判,不再落浏览页。
       上一轮这里改的是 ?id=(浏览视图),理由是 /api/project/home 对「既不是发布者、也没有承接记录」
       的调用人直接拒(ProjectHomeReadServiceImpl),刚接受邀约的受邀方正是这种人。
       现在后端认「已接受的协作邀约」这层关系了:受邀方拿到 role=join,前端据此渲染承接视图
       (顶部关系入口 + 他自己真有的点位/章节)。
       ⚠️ 邀约落的是整主题商务条款(coop_order),**不产生点位/章节** —— 那些要靠商家另外报名。
       所以这一跳给的是承接方的工具与条款,不是一屏凭空冒出来的站点。 */
    wx.navigateTo({ url: '/pages/topic/merchantinfo/merchantinfo?topicId=' + topicId + '&scope=MERCHANT' });
  },

  // 联系合作方:T19 已签约双方取/建 1:1 会话(后端 /api/coop/contact 复用 resolveToOwner+startSingle)
  contactPartner() {
    const inv = this.data.invite;
    if (!inv || inv.legacyReadonly || this._contacting) return;
    if (inv.identityError || !parseInviteId(inv.inviteId)) {
      this.setData({ state: 'error', errorText: INVITE_ID_ERROR });
      return;
    }
    const that = this;
    this._contacting = true;
    this.setData({ actionReceipt: '', actionError: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/coop/contact', method: 'POST',
      data: JSON.stringify({ id: inv.inviteId }), header: jsonHeader(),
      success(res) {
        that._contacting = false;
        const conv = res && res.code == '200' && res.data && res.data.conversationId;
        // CU-C-26:带上合作方名,会话页顶栏写对方是谁,不是一个光秃秃的「对话」
        if (conv) wx.navigateTo({ url: '/subpackageB/pages/im/chat/index?conversationId=' + conv + '&type=1'
          + (inv.partnerName ? '&name=' + encodeURIComponent(inv.partnerName) : '') });
        else toast((res && res.msg) || '暂不可联系');
      },
      fail() { that._contacting = false; toast('网络开小差了，没能联系对方'); },
    });
  },

  // 取消已接受合作(发起方/收件方都可,后端 status==1 双方放行):锁价前可取消并退款,
  // 锁价后由后端拒绝单方取消、转客服协商
  cancelAccepted() {
    const inv = this.data.invite;
    if (!inv || Number(inv.status) !== 1) return;
    if (inv.termsFrozen) { this.explainCancelLocked(); return; }
    if (this.data.submitting) return;
    const that = this;
    modal.show({
      title: '取消合作', editable: true,
      content: '锁价开卖前可取消;锁价后需联系客服协商。',
      placeholderText: '请填写取消理由(必填)', confirmText: '提交取消', cancelText: '再想想',
      success(r) {
        if (!r.confirm) return;
        const reason = String(r.content || '').trim();
        if (!reason) { toast('请填写取消理由'); return; }
        that._post(3, reason);
      },
      fail() { toast('操作确认没有打开，请重试'); },
    });
  },

  // 已锁价的合作:后端拒绝单方取消(转客服协商),行置灰只做说明、不发请求
  explainCancelLocked() {
    this.setData({ actionReceipt: '', actionError: '主题已锁价，不能单方取消合作，请联系客服协商' });
  },

  // 供给申报勾选浮层(口径与 pages/coop/list 搬迁前一致:过滤历史无零售价/份数模板、预勾选已申报)
  openPerkPick() {
    const inv = this.data.invite;
    if (!inv || inv.legacyReadonly || this._perkLoading) return;
    if (inv.identityError || !parseInviteId(inv.inviteId)) return;
    const inviteId = inv.inviteId;
    const TYPE = ['礼品', '优惠券', '折扣'];
    const that = this;
    const epoch = (this._perkEpoch || 0) + 1;
    this._perkEpoch = epoch;
    this._perkLoading = true;
    this.setData({ showPerkPick: true, perkTemplates: [], perkState: 'loading', perkErrorText: '' });
    const fail = function (value) {
      if (epoch !== that._perkEpoch) return;
      that._perkLoading = false;
      that.setData({ perkState: 'error', perkErrorText: String(value && (value.msg || value.message) || '常备权益没加载出来') });
    };
    app.sendRequest({
      hideLoading: true, url: '/api/coop/perk-template/list', method: 'POST',
      data: JSON.stringify({}), header: jsonHeader(),
      success(res) {
        if (epoch !== that._perkEpoch) return;
        if (res.code != '200' || !isRecordList(res.data)) { fail(res); return; }
        // 载入该邀约已申报的供给,预勾选(按名称匹配模板)
        app.sendRequest({
          hideLoading: true, url: '/api/coop/perks/list', method: 'POST',
          data: JSON.stringify({ inviteId: inviteId }), header: jsonHeader(),
          success(res2) {
            if (epoch !== that._perkEpoch) return;
            if (res2.code != '200' || !isRecordList(res2.data)) { fail(res2); return; }
            that._perkLoading = false;
            const chosen = res2.data.map(function (p) { return p.name; });
            const tpls = res.data.filter(function (t) {
              const retailValue = Number(t && t.retailValue);
              const quota = Number(t && t.quota);
              return Number.isFinite(retailValue) && retailValue > 0
                && Number.isInteger(quota) && quota > 0;
            }).map(function (t) {
              const perkType = t.perkType != null && Number.isInteger(Number(t.perkType)) ? Number(t.perkType) : null;
              return Object.assign({}, t, { typeText: perkType != null && TYPE[perkType] ? TYPE[perkType] : '权益', checked: chosen.indexOf(t.name) >= 0 });
            });
            that.setData({ perkTemplates: tpls, perkState: 'ready', perkErrorText: '' });
          },
          fail(value) { fail(value); },
        });
      },
      fail(value) { fail(value); },
    });
  },
  closePerkPick() {
    if (this.data.perkSaving) return;
    this._perkEpoch = (this._perkEpoch || 0) + 1;
    this._perkLoading = false;
    this.setData({ showPerkPick: false, perkState: 'idle', perkErrorText: '' });
  },
  retryPerkPick() { this.openPerkPick(); },
  togglePerk(e) {
    const i = Number(e.currentTarget.dataset.idx);
    if (this.data.perkState !== 'ready' || !this.data.perkTemplates[i]) return;
    this.setData({ ['perkTemplates[' + i + '].checked']: !this.data.perkTemplates[i].checked });
  },
  submitPerks() {
    if (this.data.perkSaving || this.data.perkState !== 'ready') return;
    const inv = this.data.invite;
    const inviteId = inv && inv.inviteId;
    if (!inv || !parseInviteId(inviteId)) return;
    const ids = this.data.perkTemplates.filter(function (t) { return t.checked; }).map(function (t) { return t.id; });
    const that = this;
    this._perkSaving = true;
    this.setData({ perkSaving: true, actionReceipt: '', actionError: '' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/coop/perks/attach', method: 'POST',
      data: JSON.stringify({ inviteId: inviteId, templateIds: ids }), header: jsonHeader(),
      success(res) {
        if (res.code == '200') {
          const count = res.data && res.data.count;
          const receipt = count != null ? ('已申报 ' + count + ' 项供给') : '供给已申报';
          that.setData({ showPerkPick: false, perkState: 'idle', actionReceipt: receipt });
        } else {
          toast((res && res.msg) || '申报失败');
        }
      },
      fail() { toast('网络开小差了，供给没申报上'); },
      complete() { that._perkSaving = false; that.setData({ perkSaving: false }); },
    });
  },

  // F4-2 双向互评:先选星级(cy-option-sheet,设计体系内),再写评语(可输入 modal)。
  // 被评对象与卡片搬迁前一致:收件箱评发起方(fromId),发件箱只对商家评(toId)。
  reviewCoop() {
    const inv = this.data.invite;
    if (!inv || inv.legacyReadonly || this._reviewing) return;
    const toId = this.data.box === 'received' ? inv.fromId : inv.toId;
    if (!toId || !inv.topicId) { toast('该合作暂不可评价'); return; }
    this._reviewing = true;
    this._reviewSheet = { toId: toId, topicId: inv.topicId };
    this.setData({ reviewSheetShow: true, actionReceipt: '', actionError: '' });
  },
  onReviewSheetCancel() {
    this._reviewing = false;
    this.setData({ reviewSheetShow: false });
  },
  onReviewSheetSelect(e) {
    const ctx = this._reviewSheet || {};
    const rating = 5 - e.detail.index;
    this.setData({ reviewSheetShow: false });
    if (!ctx.toId || !ctx.topicId) { this._reviewing = false; return; }
    const that = this;
    modal.show({
      title: '评语(选填)', editable: true, placeholderText: '说说这次合作…', confirmText: '提交',
      success(rr) {
        that._reviewing = false;
        if (!rr.confirm) return;
        app.sendRequest({
          hideLoading: true, silentError: true,
          url: '/api/coop/review/save', method: 'POST',
          data: JSON.stringify({ topicId: ctx.topicId, toId: ctx.toId, rating: rating, comment: String(rr.content || '').trim() }),
          header: jsonHeader(),
          success(res) {
            if (res.code == '200') that.setData({ actionReceipt: '评价已提交', myReviewStars: '★★★★★'.slice(0, rating) });
            else toast((res && res.msg) || '评价失败');
          },
          fail() { toast('网络开小差了，评价没提交'); },
        });
      },
      fail() { that._reviewing = false; toast('评价确认没有打开，请重试'); },
    });
  },

  goDeposit() {
    // 保证金是涉资链路(含 checkout 工作流与支付回读),只在 pages/coop/list 有一份。
    // 这里不复制,带人回去那条链路;发件箱的邀约回列表仍停在「我发出的」,否则会找不到那张卡。
    const fallback = this.data.box === 'sent' ? '/pages/coop/list/index?tab=sent' : '/pages/coop/list/index';
    wx.navigateBack({ delta: 1, fail() { wx.redirectTo({ url: fallback }); } });
  },
  goBack() { wx.navigateBack({ delta: 1, fail() { wx.redirectTo({ url: '/pages/coop/list/index' }); } }); },
  retry() { this.load(); },
});
