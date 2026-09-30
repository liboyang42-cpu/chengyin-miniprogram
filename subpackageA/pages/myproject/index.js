const toast = require('../../../utils/toast.js');
const roleGuard = require('../../../utils/roleGuard.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const merchantAccessPolicy = require('../../../utils/merchant-access-policy.js');
const { openScene } = require('../../../utils/scene-entry.js');
const { isRecordList } = require('../../../utils/response-shape.js');

// C6 重组(发布域重构 §3C):唯一管理容器,主结构=类型三 tab(主题/活动/模板)。
// 身份三 tab 降级:全部项目里出现 >1 种 ownerType 才显示切换 chips,单身份自动隐藏。
// 状态 8 档 chips 删除 → 待处理置顶(未通过/草稿/审核中排前+红点)+ 顶部待处理摘要
// + picker 筛选下拉。/api/project/my 后端本就全量内存聚合再分页(个人项目量小),
// 故一次拉 LOAD_CAP 条前端派生视图,主题/活动切 tab 零网络;超上限页脚明示不静默截断。
const TYPE_TABS = [
  { key: 'topic', label: '主题' },
  { key: 'activity', label: '活动' },
  { key: 'template', label: '模板' }
];
const OWNER_LABEL = { member: '个人', club: '俱乐部', merchant: '商家' };
// 状态样式类 → cy-badge 的语义 variant(卡面状态徽章统一走组件,不再各页自绘胶囊)
const STATE_VARIANT = {
  'st-online': 'success', 'st-pending': 'warning', 'st-notstarted': 'info',
  'st-rejected': 'danger', 'st-draft': 'neutral', 'st-completed': 'neutral', 'st-offline': 'neutral'
};
function stateVariant(cls) { return STATE_VARIANT[cls] || 'neutral'; }

const TYPE_EMPTY = {
  topic: { tit: '还没有主题', sub: '用发布按钮创建你的第一条城市路线' },
  activity: { tit: '还没有活动', sub: '' },
  template: { tit: '还没有节点玩法', sub: '发布路线时可以沉淀自己的节点互动，之后在这里复用和管理' }
};

/* 稿 260:277 卡片第二行:「8月23日 19:20—21:00」。
   后端 /api/project/my 给的是 startTime / endTime;同日只写一次日期,跨日两端都写。
   两个都没有就整行不出 —— 不写「时间待定」占一行。 */
function whenText(p) {
  const s = String(p.startTime || '').trim();
  const e = String(p.endTime || '').trim();
  if (!s) return '';
  const day = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    return m ? (Number(m[2]) + '月' + Number(m[3]) + '日') : '';
  };
  const clock = (v) => {
    const m = /[T ](\d{2}):(\d{2})/.exec(v);
    return m && m[0].indexOf('00:00') < 0 ? (m[1] + ':' + m[2]) : '';
  };
  const sd = day(s), ed = day(e);
  const sc = clock(s), ec = clock(e);
  if (!sd) return '';
  if (ed && ed !== sd) return sd + ' – ' + ed;
  if (sc && ec) return sd + ' ' + sc + '—' + ec;
  return sd + (sc ? (' ' + sc) : ' 全天');
}

const STATES = [
  { key: 'all', label: '全部状态' },
  { key: 'draft', label: '草稿' },
  { key: 'pending', label: '审核中' },
  { key: 'notStarted', label: '未开始' },
  { key: 'running', label: '进行中' },
  { key: 'completed', label: '已完成' },
  { key: 'offline', label: '已下架' },
  { key: 'rejected', label: '未通过' }
];
// 待处理置顶顺位(红点即这三态)
const PENDING_RANK = { rejected: 0, draft: 1, pending: 2 };

const LOAD_CAP = 200;

Page({
  data: {
    typeTabs: TYPE_TABS,
    operationScope: '',
    typeTab: 'topic',
    states: STATES,
    stateIndex: 0,
    /* 稿 260:277 的状态筛选只列五个:全部 / 未开始 / 进行中 / 已结束 / 未通过。
       草稿与已下架是编辑态,收在「全部」里 —— chip 行一屏放得下才有意义,
       八个会挤成横滑,横滑的筛选等于没有筛选。i 指回 STATES 的下标,过滤逻辑一行不改。 */
    stateChips: [
      { key: 'all', label: '全部', i: 0 },
      { key: 'notStarted', label: '未开始', i: 3 },
      { key: 'running', label: '进行中', i: 4 },
      { key: 'completed', label: '已结束', i: 5 },
      { key: 'rejected', label: '未通过', i: 7 },
    ],
    ownerChips: [],   // 空 = 单身份,隐藏切换
    owner: 'all',
    list: [],
    pendingSummary: { total: 0, rejected: 0, draft: 0, pending: 0 },
    capped: false,
    hasRowOps: false,
    /* 稿 260:277 把上下架 / 删除赶出了卡面,这个面板是它们的新家(长按卡片打开)。
       只存这张卡自己的判定结果,不存整条 item —— 面板开着的时候列表可能已经刷新了。 */
    opsSheet: { show: false, title: '', id: '', biz: '', online: false,
                canToggle: false, canDelete: false, canViewApplies: false, toggleLabel: '' },
    loading: false,
    loaded: false,
    projectState: 'loading', // loading | error | ready
    projectErrorMsg: '',
    emptyTit: TYPE_EMPTY.topic.tit,
    emptySub: TYPE_EMPTY.topic.sub,
    // 模板 tab(/api/template/my-list,原 mytemplate 列表)
    tplList: [],
    tplLoaded: false,
    tplLoading: false,
    tplErrorMsg: '',
    skeletonItems: [1, 2, 3]
  },

  onLoad(options) {
    options = options || {};
    // 2026-09-23 裁决(CU-C-22):俱乐部主理人可发独立单场活动,原来全站没有新建入口。
    // 2026-09-25 裁决(CU-M-05):商家同样可发单场活动,商家态入口改看岗位权限。
    // 本地身份只决定入口显不显示;能不能发由发布页 guardPublisherRole 回读权威接口判定,
    // 这里与它同口径:俱乐部线认 role === 'club',商家线认 canManageProjects。
    const merchantScope = options.scope === 'MERCHANT';
    this.setData({
      operationScope: merchantScope ? 'MERCHANT' : '',
      canPublishActivity: merchantScope ? false : roleGuard.role() === 'club',
    });
    if (merchantScope) {
      this.loadMerchantPublishEntry();
    } else {
      roleGuard.load(() => {
        this.setData({ canPublishActivity: roleGuard.role() === 'club' });
        if (this.data.typeTab === 'activity') this.applyView();
      });
    }
    // 兼容旧入口参数(发布页项目子tab已删,分享/收藏链接仍可能带):
    // type=club_activity→活动tab,type=template→模板tab,其余旧 type(simple_topic/pro_topic/self_play)→主题tab;state→筛选
    if (options && options.type) {
      const typeTab = options.type === 'club_activity'
        ? 'activity' : (options.type === 'template' ? 'template' : 'topic');
      this.setData({ typeTab });
    }
    if (options && options.state) {
      const i = STATES.map(function (s) { return s.key; }).indexOf(options.state);
      if (i > 0) this.setData({ stateIndex: i });
    }
  },

  onShow() {
    // ★ 在途守卫在这里**无条件归零**。本仓栽过一次:tabBar 页的在途 flag 卡住 = 永久死锁,
    //   热启动都不自愈(漫游 GO 点不动的真根因)。只在回调里清是不够的 —— 回调没被调用到的
    //   路径(同步抛错 / 页面被顶掉再回来)会把 flag 永远留在 true,按钮就此死掉。
    this._togglingIds = null;
    this._templateActionIds = null;
    merchantTheme.merchantPageShow();
    this.reload();
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  reload() {
    // 递增序号作废在途请求(修 toggle/delete 后空跑 + 响应污染,沿旧版)
    this._seq = (this._seq || 0) + 1;
    this.loadProjects();
    if (this.data.typeTab === 'template') this.loadTemplates();
  },

  // ===== 类型三 tab =====
  switchTypeTab(e) {
    const k = e.detail.key;
    if (!k || k === this.data.typeTab) return;
    this.setData({ typeTab: k, stateIndex: 0, owner: 'all' });
    if (k === 'template') {
      if (!this.data.tplLoaded) this.loadTemplates();
    } else {
      this.applyView();
    }
  },

  // ===== 身份 chips(多身份才渲染) =====
  switchOwner(e) {
    const k = e.currentTarget.dataset.k;
    if (!k || k === this.data.owner) return;
    this.setData({ owner: k });
    this.applyView();
  },

  // ===== 状态筛选下拉 =====
  onStatePick(e) {
    this.setData({ stateIndex: Number(e.currentTarget.dataset.index) || 0 });
    this.applyView();
  },
  // 摘要段点击 = 快捷设该状态筛选
  tapSummary(e) {
    const k = e.currentTarget.dataset.k;
    const i = STATES.map(function (s) { return s.key; }).indexOf(k);
    if (i > 0) {
      this.setData({ stateIndex: i });
      this.applyView();
    }
  },

  /* CU-M-05 商家态的「发布单场活动」入口:判据是岗位权限,不是「进过商家页」。
     本地 scope 参数只决定问哪个接口,不作放行依据;读不到就按没有入口处理(fail-closed),
     真闸在服务端 —— 商家 scope 下 publish 仍要过 merchantAccessService.require。 */
  loadMerchantPublishEntry() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      data: {},
      success(res) {
        const access = merchantAccessPolicy.normalizeMerchantAccess(res && res.code == '200' ? res.data : null);
        that.setData({ canPublishActivity: access.canManageProjects });
        if (that.data.typeTab === 'activity') that.applyView();
      },
      fail(res) {
        that.setData({ canPublishActivity: false });
        toast(app.getRequestErrorMessage(res, '发布权限没能读取，请重试'));
      }
    });
  },

  // ===== 数据:一次拉全,前端派生 =====
  loadProjects() {
    const that = this;
    const seq = (this._seq || 0) + 1;
    this._seq = seq;
    const hasContent = this.data.loaded === true;
    this.setData({
      loading: true,
      projectState: hasContent ? 'ready' : 'loading',
      projectErrorMsg: ''
    });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/project/my',
      method: 'POST',
      data: { ownerType: 'all', state: 'all', type: 'all', pageNum: 1, pageSize: LOAD_CAP,
        scope: this.data.operationScope },
      success(res) {
        if (that._seq !== seq) return;
        if (res && res.code == '200' && res.data && isRecordList(res.data.rows)) {
          const rows = res.data.rows.map(decorate);
          that._all = rows;
          that.setData({
            loaded: true,
            projectState: 'ready',
            projectErrorMsg: '',
            capped: (res.data.total || 0) > rows.length
          });
          that.applyView();
        } else {
          that.setData({
            loaded: hasContent,
            projectState: hasContent ? 'ready' : 'error',
            projectErrorMsg: app.getRequestErrorMessage(res, '项目加载失败，请稍后重试')
          });
        }
      },
      fail(res) {
        if (that._seq === seq) {
          that.setData({
            loaded: hasContent,
            projectState: hasContent ? 'ready' : 'error',
            projectErrorMsg: app.getRequestErrorMessage(res, '网络异常，项目暂时没能加载')
          });
        }
      },
      complete() { if (that._seq === seq) that.setData({ loading: false }); }
    });
  },

  applyView() {
    const tab = this.data.typeTab;
    if (tab === 'template') return;
    const all = this._all || [];

    // 身份 chips:按全部项目里出现的 ownerType 派生,跨 tab 稳定
    const present = [];
    all.forEach(function (p) { if (present.indexOf(p.ownerType) < 0) present.push(p.ownerType); });
    const ownerChips = present.length > 1
      ? [{ key: 'all', label: '全部' }].concat(
          ['member', 'club', 'merchant'].filter(function (k) { return present.indexOf(k) > -1; })
            .map(function (k) { return { key: k, label: OWNER_LABEL[k] }; }))
      : [];

    let rows = all.filter(function (p) { return p.bizType === (tab === 'activity' ? 'activity' : 'topic'); });

    // 待处理摘要按当前 tab 全量算(不受筛选影响,承接原发布页四态速查)
    const summary = { rejected: 0, draft: 0, pending: 0 };
    rows.forEach(function (p) { if (summary[p.state] != null) summary[p.state]++; });
    summary.total = summary.rejected + summary.draft + summary.pending;

    if (this.data.owner !== 'all' && ownerChips.length) {
      const o = this.data.owner;
      rows = rows.filter(function (p) { return p.ownerType === o; });
    }
    const stateKey = STATES[this.data.stateIndex].key;
    if (stateKey !== 'all') {
      rows = rows.filter(function (p) { return p.state === stateKey; });
    }
    // 待处理置顶:未通过 > 草稿 > 审核中 > 其余保持接口倒序(sort 稳定)
    rows = rows.slice().sort(function (a, b) { return rankOf(a) - rankOf(b); });

    // CU-C-21:筛选下没结果 ≠ 从没建过;说「没有已结束的活动」,不再回「还没有活动 · 去发布」。
    const filtered = stateKey !== 'all' || (this.data.owner !== 'all' && ownerChips.length);
    const chip = this.data.stateChips.filter(function (c) { return c.i === this.data.stateIndex; }, this)[0];
    const noun = tab === 'activity' ? '活动' : '主题';
    // 发布提示只对能发的人说;别人看到「主理人可以在这里发布」却没有按钮,是空头承诺(CU-C-22)
    const empty = filtered
      ? { tit: '没有' + (chip && chip.key !== 'all' ? chip.label + '的' : '符合条件的') + noun, sub: '换个筛选看看，或回到「全部」' }
      : tab === 'activity' && this.data.canPublishActivity
      ? { tit: '还没有活动', sub: '在这里发布你的第一场单场活动' }
      : (TYPE_EMPTY[tab] || TYPE_EMPTY.topic);
    this.setData({
      list: rows,
      // 长按提示只在真有卡能操作时出 —— 全是「进行中且不可删」的列表写这句是骗人
      hasRowOps: rows.some(function (p) { return p._canToggle || p._canDelete || p._canViewApplies; }),
      ownerChips: ownerChips,
      owner: ownerChips.length ? this.data.owner : 'all',
      pendingSummary: summary,
      emptyTit: empty.tit,
      emptySub: empty.sub
    });
  },

  // ===== 项目卡交互(沿旧版) =====
  onCardTap(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    // 草稿 / 未通过(编辑重发)→ 进专业编辑器继续编辑
    if (item.bizType === 'topic' && (item.state === 'draft' || item.state === 'rejected')) {
      wx.navigateTo({ url: '/pages/publish/fabu/index?id=' + item.id
        + (this.data.operationScope ? '&scope=MERCHANT' : '') });
      return;
    }
    if (item.bizType === 'activity') {
      // 待审核 / 未通过的活动还没有玩家可见的详情页,点击进编辑器续写 ——
      // 与上面主题卡「草稿/未通过 → 编辑器」同判据;_canEdit 已挡掉承办只读卡。
      if (item._canEdit && (item.state === 'pending' || item.state === 'rejected')) {
        wx.navigateTo({ url: '/pages/publish/activity/index?id=' + item.id
          + (this.data.operationScope ? '&scope=MERCHANT' : '') });
        return;
      }
      const id = item.id;
      openScene('play-activity-detail', { id });
      return;
    }
    // 这个列表就是「我发布的」,所以主题一律进项目主页(主办视图)——
    // 原来跳的 topic/index 是玩家买票页,发布者在那儿看不到谁来接、卖了多少。
    wx.navigateTo({ url: '/pages/topic/merchantinfo/merchantinfo?topicId=' + item.id
      + (this.data.operationScope ? '&scope=MERCHANT' : '') });
  },

  /* 长按 = 列表管理动作的唯一入口(稿裁决:卡面不放按钮)。
     一个动作都没有的卡不弹空面板 —— 弹一个没有行的抽屉比不弹更糟。 */
  onCardLong(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    if (!item._canToggle && !item._canDelete && !item._canViewApplies && !item._canEdit && !item._canCancel) return;
    this.setData({
      opsSheet: {
        show: true,
        title: item.title || '这个项目',
        id: item.id,
        biz: item.bizType,
        online: !!item._online,
        canToggle: !!item._canToggle,
        canDelete: !!item._canDelete,
        canViewApplies: !!item._canViewApplies,
        canEdit: !!item._canEdit,
        canCancel: !!item._canCancel,
        toggleLabel: item._toggleLabel || '下架',
      }
    });
  },

  closeOpsSheet() {
    this.setData({ 'opsSheet.show': false });
  },

  onOpsPick(e) {
    const k = e.currentTarget.dataset.k;
    const p = this.data.opsSheet;
    this.setData({ 'opsSheet.show': false });
    const ds = { id: p.id, biz: p.biz, online: p.online, title: p.title };
    if (k === 'received') return this.goReceivedApplies();
    if (k === 'edit') return this.editActivity({ currentTarget: { dataset: { item: { id: p.id, bizType: 'activity', title: p.title, _sold: false, signupCount: 0 } } } });
    if (k === 'toggle') return this.toggleStatus({ currentTarget: { dataset: ds } });
    if (k === 'cancel') {
      const cancelDs = { currentTarget: { dataset: { id: p.id, title: p.title } } };
      return p.biz === 'topic' ? this.cancelTopic(cancelDs) : this.cancelActivity(cancelDs);
    }
    if (k === 'delete') return this.deleteItem({ currentTarget: { dataset: ds } });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/publish/fabu/index'
      + (this.data.operationScope ? '?scope=MERCHANT' : '') });
  },

  onEmptyCta() {
    if (this.data.typeTab === 'activity') this.goCreateActivity();
    else this.goCreate();
  },

  goCreateActivity() {
    // CU-M-05:不带 scope 进去就按俱乐部主理人判身份,商家自家活动反而被拦在门外。
    wx.navigateTo({ url: '/pages/publish/activity/index'
      + (this.data.operationScope ? '?scope=MERCHANT' : '') });
  },

  editActivity(e) {
    const item = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.item : null;
    if (!item || item.bizType !== 'activity') return;
    if (item._sold || Number(item.signupCount) > 0) {
      toast('已有人买票，不能再改这场活动');
      return;
    }
    wx.navigateTo({ url: '/pages/publish/activity/index?id=' + item.id
      + (this.data.operationScope ? '&scope=MERCHANT' : '') });
  },

  // 确认框必须写明「将给 N 位已付款玩家全额退款」(9-18 拍板)。N 问后端预览接口,拿不到就不弹、不发取消。
  cancelActivity(e) {
    const ds = e.currentTarget.dataset;
    const that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/activity/cancel_preview',
      method: 'POST',
      data: { id: ds.id, scope: this.data.operationScope },
      success(res) {
        const n = paidPlayersOrToast(res);
        const dc = n === null ? null : that.selectComponent && that.selectComponent('#dcCancel');
        if (dc) dc.open('activity.cancel-refund', { name: ds.title || '', id: ds.id, count: n });
      },
      fail() { toast('网络异常，请重试'); }
    });
  },

  // [C8-05] 主办方取消主题(天气/场地):停售 + 已付款全额退 + 逐场取消。俱乐部主题走俱乐部「结束主题」。
  cancelTopic(e) {
    const ds = e.currentTarget.dataset;
    const that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/topic/cancel_preview',
      method: 'POST',
      data: { id: ds.id, scope: this.data.operationScope },
      success(res) {
        const n = paidPlayersOrToast(res);
        const dc = n === null ? null : that.selectComponent && that.selectComponent('#dcCancelTopic');
        if (dc) dc.open('topic.cancel-refund', { name: ds.title || '', id: ds.id, count: n });
      },
      fail() { toast('网络异常，请重试'); }
    });
  },

  // P0-4:收到的申请(俱乐部申请/商家承接报名)统一在协作列表「收到的」处理,候选池页已下线
  goReceivedApplies() {
    wx.navigateTo({ url: '/pages/coop/list/index?tab=received'
      + (this.data.operationScope ? '&scope=MERCHANT' : '') });
  },

  // 上/下架切换(按 bizType 派发,单接口翻转)
  //
  // 上送 expectedUserStatus = **渲染这个按钮时看到的态**(不是点下去那一刻再查一次)。
  // 后端拿它做 CAS:与库中不符即拒并告知当前态。它挡的是两类翻转型误操作 ——
  //   ① 这一屏已经过时(内容安全回调会自动下架),照翻转算会做出反向动作;
  //   ② 弱网下重复点/超时重试,第二次把第一次的结果又翻回去。
  // ⚠️ 拿 ds.online 而不是重新读列表:期望态的意义就是「用户看到的那个态」,重读就没意义了。
  toggleStatus(e) {
    const ds = e.currentTarget.dataset;
    const id = ds.id;
    // 在途守卫:按 id 记,不同卡片互不影响(整页一个门闩会让批量操作变成排队)
    const inflight = this._togglingIds || (this._togglingIds = {});
    if (inflight[id]) return;
    inflight[id] = true;
    const url = ds.biz === 'activity' ? '/api/activity/update_publish_status' : '/api/topic/update_user_status';
    const data = { id: id, scope: this.data.operationScope };
    // 活动线是另一个接口,没有这个参数,别乱塞
    if (ds.biz !== 'activity') data.expectedUserStatus = ds.online ? 1 : 0;
    const that = this;
    let settled = false;
    // complete 兜底清 flag。request-client 保证 complete 恰好触发一次(重登重试时也只在最后一跳),
    // 但仍在 success/fail 里各清一次 —— 万一将来有人换掉传输层、complete 不再保证,按钮也不会死。
    const release = function () { if (that._togglingIds) delete that._togglingIds[id]; };
    try {
      app.sendRequest({
        hideLoading: true, url: url, method: 'POST', data: data,
        success(res) {
          settled = true;
          release();
          if (res.code == '200') { toast('操作成功'); that.reload(); }
          else {
            // 后端 CAS 拒绝会带上「当前是什么态」,原样透出比「操作失败」有用得多;
            // 拒绝多半意味着这一屏过时了,顺手刷新让用户看到真态。
            toast((res && res.msg) || '操作失败');
            that.reload();
          }
        },
        fail() { settled = true; release(); toast('网络异常，请重试'); },
        complete() { release(); }
      });
    } catch (err) {
      // 同步抛错(传输层没跑起来)⇒ 三个回调一个都不会来。不在这儿清就是永久死锁。
      release();
      throw err;
    }
    if (settled) release();
  },

  // 删除路线/场次:三段式第一段。文案(后果 + 「此操作不可撤销」+ 下架替代)
  // 在 utils/danger-actions.js;这一页本来就有下架开关,替代方案不是编的。
  deleteItem(e) {
    const ds = e.currentTarget.dataset;
    // 场次和路线各用一个确认组件实例:两者删的是不同接口,合在一个回调里会让
    // 一个控件同时写两个接口,动作台账对不上「这个按钮到底写哪个」。
    const isActivity = ds.biz === 'activity';
    const dc = this.selectComponent && this.selectComponent(isActivity ? '#dcActivity' : '#dcRoute');
    if (!dc) return;
    // 已经是下架态时不给「改为下架」——点了会把它翻回上架,是反向动作。
    dc.open(isActivity ? 'activity.delete' : 'route.delete',
      { name: ds.title || '', id: ds.id, biz: ds.biz, online: !!ds.online },
      { hideAlt: !ds.online });
  },

  // ===== 模板 tab(原 mytemplate 列表收编) =====
  loadTemplates() {
    if (this.data.tplLoading) return;
    const that = this;
    this.setData({ tplLoading: true, tplErrorMsg: '' });
    app.sendRequest({
      hideLoading: true,
      url: '/api/template/my-list',
      method: 'POST',
      data: {
        is_quote: '', keyword: '', category_id: '', pageNum: 1, pageSize: 100,
        scope: this.data.operationScope
      },
      success(res) {
        if (res.code == '200' && res.data && isRecordList(res.data.rows)) {
          const rows = res.data.rows.map(function (t) {
            return Object.assign({}, t, {
              _statusText: t.status == 1 ? '已发布' : (t.status == 2 ? '审核中' : '未发布'),
              _stateClass: t.status == 1 ? 'st-online' : (t.status == 2 ? 'st-pending' : 'st-draft'),
              _stateVariant: stateVariant(t.status == 1 ? 'st-online' : (t.status == 2 ? 'st-pending' : 'st-draft'))
            });
          });
          that.setData({ tplList: rows, tplLoaded: true });
        } else {
          that.setData({ tplErrorMsg: app.getRequestErrorMessage(res, '节点玩法加载失败') });
        }
      },
      fail(res) {
        that.setData({ tplErrorMsg: app.getRequestErrorMessage(res, '节点玩法加载失败') });
      },
      complete() { that.setData({ tplLoading: false }); }
    });
  },

  retryTemplates() { this.loadTemplates(); },

  tplTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/templatedetail/templatedetail?id=' + id + '&scope=my' });
  },

  // 发布到/下架节点玩法库(沿 mytemplate:publish_status 翻转)
  tplToggle(e) {
    const ds = e.currentTarget.dataset;
    const that = this;
    const inflight = this._templateActionIds || (this._templateActionIds = {});
    if (inflight[ds.id]) return;
    inflight[ds.id] = true;
    const release = function () {
      if (that._templateActionIds) delete that._templateActionIds[ds.id];
    };
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/updateLibraryStatus',
      method: 'POST',
      data: {
        template_id: ds.id,
        publish_status: ds.pub == 1 ? 0 : 1,
        scope: that.data.operationScope
      },
      success(res) {
        release();
        if (res.code == '200') { toast('操作成功'); that.loadTemplates(); }
        else { toast((res && res.msg) || '操作失败'); }
      },
      fail() { release(); toast('网络异常，请重试'); },
      complete() { release(); }
    });
  },

  tplDelete(e) {
    const ds = e.currentTarget.dataset;
    const dc = this.selectComponent && this.selectComponent('#dcTpl');
    if (!dc) return;
    // 只有还在玩法库里(pub==1)才谈得上「改为下架」
    dc.open('template.delete',
      { name: ds.title || '', id: ds.id, pub: ds.pub },
      { hideAlt: ds.pub != 1 });
  },

  // 三段式第二段:路线/场次 与 节点玩法 各有自己的确认组件实例和确认回调。
  // 不做「一个 onDangerConfirm 按 key 派发」—— 那会让一个控件同时写三个接口,
  // 动作台账(scripts/uiaudit)没法把控件和它真正写的那个接口对上。
  onConfirmDeleteActivity(e) { this._deleteProjectItem(e, '#dcActivity', '/api/activity/delete'); },
  onConfirmDeleteRoute(e) { this._deleteProjectItem(e, '#dcRoute', '/api/topic/delete'); },

  onConfirmCancelActivity(e) {
    const p = e.detail.params || {};
    const dc = this.selectComponent && this.selectComponent('#dcCancel');
    const that = this;
    dc.busyOn();
    app.sendRequest({
      hideLoading: true,
      url: '/api/activity/cancel',
      method: 'POST',
      data: { id: p.id, reason: '主办方取消活动', scope: this.data.operationScope },
      success(res) {
        if (res.code == '200') { dc.done(); that.reload(); }
        else dc.failed((res && res.msg) || '取消失败');
      },
      fail() { dc.failed('网络异常，请重试'); }
    });
  },

  onConfirmCancelTopic(e) {
    const p = e.detail.params || {};
    const dc = this.selectComponent && this.selectComponent('#dcCancelTopic');
    const that = this;
    dc.busyOn();
    app.sendRequest({
      hideLoading: true,
      url: '/api/topic/cancel',
      method: 'POST',
      data: { id: p.id, reason: '主办方取消主题', scope: this.data.operationScope },
      success(res) {
        if (res.code == '200') { dc.done(res.msg); that.reload(); }
        else dc.failed((res && res.msg) || '取消失败');
      },
      fail() { dc.failed('网络异常，请重试'); }
    });
  },

  _deleteProjectItem(e, dcId, url) {
    const p = e.detail.params || {};
    const dc = this.selectComponent && this.selectComponent(dcId);
    const that = this;
    dc.busyOn();
    app.sendRequest({
      hideLoading: true,
      url: url,
      method: 'POST',
      data: { id: p.id, scope: this.data.operationScope },
      success(res) {
        // 三段式第三段:结果确认卡
        if (res.code == '200') { dc.done(); that.reload(); }
        else dc.failed((res && res.msg) || '删除失败');
      },
      fail() { dc.failed('网络异常，请重试'); }
    });
  },

  onConfirmDeleteTemplate(e) {
    const p = e.detail.params || {};
    const dc = this.selectComponent && this.selectComponent('#dcTpl');
    const that = this;
    dc.busyOn();
    app.sendRequest({
      hideLoading: true,
      url: '/api/template/delete',
      method: 'POST',
      data: { template_id: p.id, scope: this.data.operationScope },
      success(res) {
        if (res.code == '200') { dc.done(); that.loadTemplates(); }
        else dc.failed((res && res.msg) || '删除失败');
      },
      fail() { dc.failed('网络异常，请重试'); }
    });
  },

  /** 更轻的替代:改成下架 —— 复用这一页现成的上下架开关,不新造一条链路。 */
  onDeleteItemAlt(e) {
    const p = e.detail.params || {};
    this.toggleStatus({ currentTarget: { dataset: { id: p.id, biz: p.biz, online: p.online } } });
  },

  onDeleteTemplateAlt(e) {
    const p = e.detail.params || {};
    this.tplToggle({ currentTarget: { dataset: { id: p.id, pub: p.pub } } });
  }
});

/** 取消预览回包里的已付款人数;拿不到就把原因 toast 出来并返回 null(调用方不弹确认)。 */
function paidPlayersOrToast(res) {
  const n = res && res.code == '200' && res.data ? Number(res.data.paidPlayers) : NaN;
  if (Number.isInteger(n) && n >= 0) return n;
  toast((res && res.msg) || '暂时算不出退款人数，请稍后重试');
  return null;
}

function rankOf(p) {
  return PENDING_RANK[p.state] != null ? PENDING_RANK[p.state] : 9;
}

function decorate(p) {
  const stateClass = {
    draft: 'st-draft', pending: 'st-pending', notStarted: 'st-notstarted',
    running: 'st-online', completed: 'st-completed', offline: 'st-offline', rejected: 'st-rejected'
  }[p.state] || '';
  // 原来这里派生的 _action(查看 / 继续编辑 / 复盘…)是卡面右下那颗药丸,
  // 稿 260:277 裁决「连箭头都不放」后它没有承载体了 —— 下一步动作就是点这一行本身。
  const online = (p.state === 'running' || p.state === 'notStarted');
  const canToggle = online || p.state === 'offline';
  const canDelete = (p.state === 'draft' || p.state === 'offline' || p.state === 'rejected' || p.state === 'completed');
  // 商家承接生成的 activity 不是俱乐部自办活动；取消/删除涉及全额退款权限，保持只读。
  const merchantActivity = p.ownerType === 'merchant' && p.bizType === 'activity';
  const sold = p.bizType === 'activity' && Number(p.signupCount) > 0;
  const publishedActivity = p.bizType === 'activity'
    && (p.state === 'running' || p.state === 'notStarted' || p.state === 'offline'
      || p.state === 'pending' || p.state === 'rejected');
  const canEdit = !merchantActivity && publishedActivity;
  // [C8-05] 主题:个人/商家主办可「取消并退款」;俱乐部主题有岗位权限,走俱乐部「结束主题」。
  const canCancel = p.bizType === 'topic'
    ? (p.ownerType !== 'club' && (online || p.state === 'offline'))
    : (!merchantActivity && sold && (online || p.state === 'offline'));
  // P0-4 承接三态(仅主题卡,后端派生):clubAccepted/clubOpen/merchantAccepted/merchantOpen/selfRun。
  // 「未承接」= 开着池等申请 → 给候选池入口看申请;selfRun 不展示徽标(自办是默认态,不占卡面)。
  const acceptAccented = (p.acceptStatus === 'clubAccepted' || p.acceptStatus === 'merchantAccepted');
  const showAccept = p.bizType === 'topic' && p.acceptStatus && p.acceptStatus !== 'selfRun';
  /* 稿 260:277 承办卡底行写「待核销 2」。后端只对承办活动下发这个数(主办卡不需要,
     算了就是给每张卡白打一次库)。⚠️ 没下发和下发 0 是两件事:没下发就不写这一行,
     不能把「没算」印成「0 个待核销」。 */
  const pendingVerify = Number(p.pendingVerifyCount);
  const showPendingVerify = Number.isFinite(pendingVerify);
  // 未承接=去看申请;已承接=去看合作现状(候选池同页展示已接受邀约),满足「每卡有下一步 CTA」
  const canViewApplies = p.bizType === 'topic' && (p.acceptStatus === 'clubOpen' || p.acceptStatus === 'merchantOpen' || acceptAccented);
  return Object.assign({}, p, {
    _stateClass: stateClass, _stateVariant: stateVariant(stateClass),
    // _online = 渲染这一刻的上架态,随按钮一起下发给 toggleStatus 当 CAS 的期望态。
    // 与 _toggleLabel 同源:标签写「下架」的卡片必然 _online=true,两者不会分家。
    _canToggle: merchantActivity ? false : canToggle, _online: online,
    _toggleLabel: p.state === 'offline' ? '上架' : '下架',
    _canDelete: merchantActivity ? false : canDelete,
    _canEdit: canEdit,
    _canCancel: canCancel,
    _sold: sold,
    _showAccept: showAccept, _acceptAccented: acceptAccented, _canViewApplies: canViewApplies,
    _showPendingVerify: showPendingVerify, _pendingVerifyText: showPendingVerify ? ('待核销 ' + pendingVerify) : '',
    // 稿 260:277 标题下面那行地址。后端 addressName 缺就整行不出,不补「地址待定」
    _address: (p.addressName || '').trim(),
    /* 稿 260:277 每张卡顶行第一个 tag 是**角色**:「承办」还是「主办」。
       ⚠️ 2026-09-08 并排比稿时发现上一版这个判据是**反的**:
          它拿 acceptStatus.indexOf('Accepted') 当「我是承办方」,但 acceptStatus 说的是
          「**谁接了我发的这条主题**」(clubAccepted = 俱乐部接了我的主题)——
          那种情况下我是主办方,不是承办方,却被印成了「承办」。
          真正的承办项目在这个列表里只有一种形态:我中标别人的主题之后生成的那条活动
          (后端 mapActivity 按 wonTopicIds 把它的 ownerType 标成 merchant)。
          我自己发的主题和活动一律是主办。 */
    _roleText: (p.bizType === 'activity' && p.ownerType === 'merchant') ? '承办' : '主办',
    // 稿 260:277 的「8月23日 19:20—21:00」。缺哪半截就少写哪半截,不补占位。
    _whenText: whenText(p),
    _dot: PENDING_RANK[p.state] != null
  });
}
