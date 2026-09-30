// 商家客户名册。跨项目的「我的客户」,数据 = /api/merchant/crm/customers/list
// (真源是 cms_registration:payment_status + verification_status,见后端注释)。
//
// 页面回答的是「这个人什么情况、我下一步该找谁」:
//   顶部分段既是概览也是筛选(点得动);每行 = 谁 + 分层 + 最近发生了什么。
//
// 为什么另开一页而不是复用 pages/merchant/relation:那页标题就叫「合作」,
// 职责是「找新的合作对象」,跟「谁在我这儿消费过」是两件事。
const toast = require('../../../utils/toast.js');
const app = getApp();
/* 原生 showModal / showActionSheet 由微信自己渲染,读不到 WXSS token,只收字面色值。
   值是 --cy-text-title 的镜像,改主色时两处都要动(tokens 才是真源)。
   写法与现码 pages/publish/fabu/index.js:69 的同名局部常量一致 —— 不抽成公共模块:
   小程序这批单测用的是 `unexpected require` 白名单沙箱,多一个跨文件 require
   会同时打破十几个测试装置,代价远大于这一行重复。 */
const merchantTheme = require('../../../utils/merchant-theme.js');
const { isRecord, isRecordList } = require('../../../utils/response-shape.js');
const { normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');
const { toTimestamp } = require('../../../utils/datetime.js');

const PAGE_SIZE = 20;
// 联系号码失败半屏的自愈时长,与 cy-result-sheet 默认档一致(2s)。
const RESULT_SHEET_MS = 2000;

// 顶部只保留高频经营筛选,与 Figma 25:124 一致。
// emptyLabel 是空态专用的说法:分段名本身多带「客」或已是形容词,拿去拼
// 「暂时没有 + 标签 + 客户」会念成「回头客客户」「有备注客户」(CU-M-120/147)。
const SEGMENTS = [
  { key: 'all', label: '全部' },
  { key: 'repeat', label: '回头客', emptyLabel: '回头客' },
  { key: 'new', label: '新客', emptyLabel: '新客' },
  { key: 'noted', label: '有备注', emptyLabel: '有备注的客户' },
];

const TIER_TEXT = {
  pending: '待核销',
  abnormal: '异常',
  dormant: '沉睡',
  repeat: '复购',
  new: '新客',
};

function finiteCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function currentMemberId() {
  if (typeof app.getUserID !== 'function') return '';
  const memberId = app.getUserID();
  return memberId === null || memberId === undefined ? '' : String(memberId);
}

function isAccessDenied(res) {
  const code = res && (res.code !== undefined ? res.code : res.statusCode);
  return String(code) === '401' || String(code) === '403';
}

Page({
  _hasMore: true,

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    castCount: 0,
    keyword: '',
    segment: 'all',
    segments: SEGMENTS.map(s => Object.assign({ count: null }, s)),
    customerSummaryText: '客户数量加载中',
    rows: [],
    // CU-M-100:名单滚到底要收口。只有一两个人时下面是一整块无说明空白,
    // 看起来像没加载完 —— hasMore 给 wxml 判「这批已经全在了」。
    hasMore: true,
    // 这一页成功渲染过名单没有。只用来判 auto-back:首屏失败才自动退页,
    // 之后换分群 / 换标签 / 换关键词的失败留在页内,别把分群与群发草稿一起退掉(审查C A1)。
    everLoaded: false,
    pageNum: 1,
    loading: false,
    error: '',
    emptyTitle: '还没有客户',
    emptySub: '有人买了你承接项目的票，就会出现在这里',
    emptyCta: '重新加载',
    emptyAction: 'retry',
    noPermission: false,
    toolsOpen: false,
    canSegment: false,
    canExport: false,
    sourceType: '',
    sourceStart: '',
    sourceEnd: '',
    tagId: '',
    availableTags: [],
    filterOpen: false,
    selecting: false,
    selectedIds: [],
    batchTagName: '',
    batchSubmitting: false,
    batchError: '',
    savedSegments: [],
    savedSegmentsError: '',
    segmentName: '',
    segmentSaving: false,
    exportTask: null,
    exportState: 'idle',
    exportError: '',
    // F15:拨打/复制前先向服务端换取明文号码;失败落这个半屏,而不是静默。
    resultSheet: {
      show: false, kind: 'fail', title: '', sub: '', meta: '', pill: '',
      why: '', primaryText: '', secondaryText: '', duration: RESULT_SHEET_MS,
    },
  },

  onLoad() {
    this._unloaded = false;
    this._hasMore = true;
    this._skipNextShowReload = true;
    this._scopeMemberId = currentMemberId();
    const gd = app.globalData || {};
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: gd.statusBarHeight || sys.statusBarHeight || 20,
      navBarHeight: gd.navBarHeight || 44,
    });
    this.loadAccess();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    const memberId = currentMemberId();
    if (this._scopeMemberId === undefined) {
      this._scopeMemberId = memberId;
      return;
    }
    if (memberId !== this._scopeMemberId) {
      this._skipNextShowReload = false;
      this._resetMemberScope(memberId);
      this.loadAccess();
      return;
    }
    if (this._skipNextShowReload) {
      this._skipNextShowReload = false;
      return;
    }
    this.loadAccess();
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    merchantTheme.merchantPageRestore();
    this._unloaded = true;
    if (this._debounce) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
    this._accessEpoch = (this._accessEpoch || 0) + 1;
    this._invalidateScopeRequests();
    this._exportToken = '';
  },

  loadAccess() {
    const memberId = currentMemberId();
    this._scopeMemberId = memberId;
    // 每次回到页面先停掉上一轮 CRM 请求和操作；旧内容可保留为 stale，
    // 但权限与异步回调必须等本轮服务端身份重新确认。
    this._invalidateScopeRequests();
    const epoch = (this._accessEpoch || 0) + 1;
    this._accessEpoch = epoch;
    const isCurrent = () => !this._unloaded
      && epoch === this._accessEpoch
      && memberId === this._scopeMemberId
      && memberId === currentMemberId();
    this.setData({
      loading: true,
      error: '',
      noPermission: false,
      canSegment: false,
      canExport: false,
    });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success: (res) => {
        if (!isCurrent()) return;
        const access = res && (res.code === '200' || res.code === 200)
          ? normalizeMerchantAccess(res.data)
          : normalizeMerchantAccess(null);
        if (!access.active || !access.canReadCrm) {
          this._invalidateScopeRequests();
          this._activeQueryKey = '';
          this._renderedQueryKey = '';
          this._clearScopedData('', true);
          this.setData({ loading: false, noPermission: true });
          return;
        }
        this.setData({
          canSegment: access.canSegmentCrm,
          canExport: access.canExportCrm,
        });
        this.load();
        this.loadSavedSegments();
        if (access.canExportCrm && this.data.exportTask
          && ['PENDING', 'RUNNING'].includes(this.data.exportState)) this._pollExport();
      },
      fail: () => {
        if (isCurrent()) this.setData({ loading: false, error: '经营身份加载失败，请稍后重试' });
      },
    });
  },

  onKeywordInput(e) {
    const keyword = (e.detail && e.detail.value) || '';
    this.setData({ keyword });
    // 输入防抖:每敲一个字打一次接口既浪费,回来的顺序还可能是乱的
    if (this._debounce) clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.load(), 300);
  },

  onKeywordConfirm() {
    if (this._debounce) clearTimeout(this._debounce);
    this.load();
  },

  onSegmentTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.segment) return;
    this.setData({ segment: key });
    this.load();
  },

  toggleTools() { this.setData({ toolsOpen: !this.data.toolsOpen }); },

  closeTools() { this.setData({ toolsOpen: false }); },
  closeFilters() { this.setData({ filterOpen: false }); },

  toggleFilters() { this.setData({ filterOpen: !this.data.filterOpen, toolsOpen: false }); },

  onSourceTap(e) {
    const value = String((e.currentTarget.dataset && e.currentTarget.dataset.value) || '');
    if (!['', '1', '2'].includes(value)) return;
    this.setData({ sourceType: value });
    this.load();
  },

  onTagFilterTap(e) {
    const raw = e.currentTarget.dataset && e.currentTarget.dataset.tagid;
    const value = raw === '' || raw == null ? '' : Number(raw);
    if (value !== '' && !(Number.isSafeInteger(value) && value > 0)) return;
    this.setData({ tagId: value });
    this.load();
  },

  onSourceStartChange(e) { this.setData({ sourceStart: (e.detail && e.detail.value) || '' }); this.load(); },
  onSourceEndChange(e) { this.setData({ sourceEnd: (e.detail && e.detail.value) || '' }); this.load(); },

  clearFilters() {
    this.setData({ sourceType: '', sourceStart: '', sourceEnd: '', tagId: '', segment: 'all' });
    this.load();
  },

  retryLoad() { this.load(); },

  _resetMemberScope(memberId) {
    this._scopeMemberId = memberId;
    this._accessEpoch = (this._accessEpoch || 0) + 1;
    this._invalidateScopeRequests();
    if (this._debounce) {
      clearTimeout(this._debounce);
      this._debounce = null;
    }
    this._activeQueryKey = '';
    this._renderedQueryKey = '';
    this._clearScopedData('', true);
  },

  _invalidateScopeRequests() {
    this._scopeEpoch = (this._scopeEpoch || 0) + 1;
    this._token = (this._token || 0) + 1;
    if (this._exportTimer) {
      clearTimeout(this._exportTimer);
      this._exportTimer = null;
    }
    this._exportPolling = false;
  },

  _scopeGuard() {
    const memberId = this._scopeMemberId === undefined
      ? currentMemberId()
      : this._scopeMemberId;
    if (this._scopeMemberId === undefined) this._scopeMemberId = memberId;
    const scopeEpoch = this._scopeEpoch || 0;
    return () => !this._unloaded
      && scopeEpoch === (this._scopeEpoch || 0)
      && memberId === this._scopeMemberId
      && memberId === currentMemberId();
  },

  _clearScopedData(error, clearWorkspace) {
    this.data.emptyAction = 'retry';
    this._hasMore = true;
    if (!clearWorkspace) {
      this.setData({
        rows: [],
        castCount: 0,
        segments: SEGMENTS.map(s => Object.assign({ count: null }, s)),
        customerSummaryText: '客户数量加载中',
        pageNum: 1,
        loading: false,
        error: error || '',
        emptyTitle: '还没有客户',
        emptySub: '有人买了你承接项目的票，就会出现在这里',
        emptyCta: '重新加载',
      });
      return;
    }
    this._exportToken = '';
    this.setData({
        rows: [],
        castCount: 0,
        everLoaded: false,   // 换了身份,这一版身份确实没读到过东西 —— 自动退页要恢复
        segments: SEGMENTS.map(s => Object.assign({ count: null }, s)),
        customerSummaryText: '客户数量加载中',
        pageNum: 1,
        loading: false,
        error: error || '',
        emptyTitle: '还没有客户',
        emptySub: '有人买了你承接项目的票，就会出现在这里',
        emptyCta: '重新加载',
        keyword: '',
        segment: 'all',
        sourceType: '',
        sourceStart: '',
        sourceEnd: '',
        tagId: '',
        availableTags: [],
        filterOpen: false,
        selecting: false,
        selectedIds: [],
        batchTagName: '',
        batchSubmitting: false,
        batchError: '',
        savedSegments: [],
        savedSegmentsError: '',
        segmentName: '',
        segmentSaving: false,
        exportTask: null,
        exportState: 'idle',
        exportError: '',
        canSegment: false,
        canExport: false,
    });
  },

  onEmptyAction() {
    if (this.data.emptyAction === 'clear-search') {
      this.setData({ keyword: '' });
      this.load();
      return;
    }
    if (this.data.emptyAction === 'clear-filter') {
      this.setData({ segment: 'all' });
      this.load();
      return;
    }
    if (this.data.emptyAction === 'clear-advanced') {
      // 只清高级筛选:分段是顶上那排胶囊自己管的,一键清掉它等于把人刚选的那一段也抹了。
      this.setData({ tagId: '', sourceType: '', sourceStart: '', sourceEnd: '' });
      this.load();
      return;
    }
    if (this.data.emptyAction === 'go-coop') {
      wx.navigateTo({ url: '/pages/merchant/coop-center/index' });
      return;
    }
    this.load();
  },

  _queryKey() {
    return JSON.stringify({
      keyword: this.data.keyword,
      segment: this.data.segment,
      tagId: this.data.tagId || null,
      sourceType: this.data.sourceType ? Number(this.data.sourceType) : null,
      sourceStart: this.data.sourceStart || null,
      sourceEnd: this.data.sourceEnd || null,
    });
  },

  /** 首屏 / 换关键词 / 换分段:回到第一页重新取 */
  load() {
    if (this._unloaded) return;
    const queryKey = this._queryKey();
    const queryChanged = this._renderedQueryKey && this._renderedQueryKey !== queryKey;
    this._activeQueryKey = queryKey;
    if (queryChanged) {
      this._hasMore = true;
      // 切换筛选时清空旧人数和名单，避免混用两次查询的结果。
      //
      // 在这段窗口里灰掉 —— 数字没确认之前本来就不该让人按。
      this.setData({ pageNum: 1, error: '', rows: [], hasMore: true, castCount: 0 });
    } else {
      // 同一查询的刷新先保留上一份已确认分页；只有新响应通过完整 shape 后才推进。
      this.setData({ error: '' });
    }
    this._fetch(1, false, queryKey);
  },

  loadMore() {
    if (this.data.loading || this._loadingMore || !this._hasMore) return;
    const queryKey = this._queryKey();
    if (!this._renderedQueryKey
      || queryKey !== this._renderedQueryKey
      || queryKey !== this._activeQueryKey) return;
    this._fetch(this.data.pageNum + 1, true, queryKey);
  },

  _fetch(pageNum, append, queryKey) {
    const that = this;
    const scopeMemberId = this._scopeMemberId === undefined
      ? currentMemberId()
      : this._scopeMemberId;
    this._scopeMemberId = scopeMemberId;
    const token = (this._token || 0) + 1;
    this._token = token;
    const scopeEpoch = this._scopeEpoch || 0;
    const isCurrentRequest = () => !that._unloaded
      && token === that._token
      && scopeEpoch === (that._scopeEpoch || 0)
      && queryKey === that._activeQueryKey
      && scopeMemberId === that._scopeMemberId
      && scopeMemberId === currentMemberId();
    // 分页节流位:wxml 不渲染它(底部不再有「加载中」),所以留在实例上,不进 setData
    if (append) this._loadingMore = true;
    else this.setData({ loading: true });

    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/crm/customers/list',
      method: 'POST',
      data: JSON.stringify({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: that.data.keyword,
        segment: that.data.segment,
        tagId: that.data.tagId || null,
        sourceType: that.data.sourceType ? Number(that.data.sourceType) : null,
        sourceStart: that.data.sourceStart || null,
        sourceEnd: that.data.sourceEnd || null,
      }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrentRequest()) return;
        if (res.code !== '200' && res.code !== 200) {
          const error = app.getRequestErrorMessage(res, '客户名单加载失败');
          that._activeQueryKey = '';
          that._renderedQueryKey = '';
          if (isAccessDenied(res)) that._invalidateScopeRequests();
          that._clearScopedData(error, isAccessDenied(res));
          return;
        }
        const data = res.data;
        const total = isRecord(data) ? finiteCount(data.total) : null;
        if (!isRecord(data) || !isRecordList(data.rows) || !Number.isInteger(total)) {
          that.setData({ error: '客户名单加载失败' });
          return;
        }
        const list = data.rows.map(shapeRow);
        if (list.some(item => item === null)) {
          that.setData({ error: '客户名单数据格式异常，请稍后重试' });
          return;
        }
        const rows = append ? that.data.rows.concat(list) : list;
        const seg = buildSegments(data.segmentCounts);
        const empty = that._emptyCopy(seg.segments);
        that._renderedQueryKey = queryKey;
        that.data.emptyAction = empty.emptyAction;
        that._hasMore = rows.length < total;
        that.setData({ castCount: total, hasMore: that._hasMore });
        that.setData({
          rows,
          everLoaded: true,
          pageNum,
          availableTags: shapeTags(data.availableTags),
          error: '',
          segments: seg.segments,
          customerSummaryText: customerSummaryText(seg),
          // ⚠️ 空态文案要按**本次响应**的计数算,不能读 this.data.segments —— 那还是上一轮的值。
          emptyTitle: empty.emptyTitle,
          emptySub: empty.emptySub,
          emptyCta: empty.emptyCta,
        });
      },
      fail(res) {
        if (!isCurrentRequest()) return;
        if (isAccessDenied(res)) {
          that._activeQueryKey = '';
          that._renderedQueryKey = '';
          that._invalidateScopeRequests();
          that._clearScopedData('商家资格已失效', true);
        } else {
          that.setData({ error: '网络连接失败,请检查网络后重试' });
        }
      },
      complete() {
        if (!isCurrentRequest()) return;
        that._loadingMore = false;
        that.setData({ loading: false });
      },
    });
  },

  /**
   * 空态要说清「为什么空」。搜不到、这一段没人、一个客户都没有,
   * 下一步动作完全不同,合成一句「暂无数据」等于什么都没说。
   */
  _emptyCopy(segments) {
    const segs = segments || this.data.segments;
    const inSegment = this.data.segment !== 'all';
    if (this.data.keyword) {
      // 关键词 + 分段同时生效时,空的第一嫌疑是分段筛掉了而不是词错了(CU-M-143):
      // 同一个词切回「全部」立刻能命中,这时候劝「换个姓名」是把人往错的方向推。
      // 只有本来就在「全部」里搜不到,才真的该换关键词。
      if (inSegment) {
        return {
          emptyTitle: '这个分组没有匹配客户', emptySub: '换个分组看看，或保留关键词查看全部',
          emptyCta: '查看全部客户', emptyAction: 'clear-filter',
        };
      }
      return {
        emptyTitle: '没搜到这个客户', emptySub: '换个姓名再试试',
        emptyCta: '清除搜索', emptyAction: 'clear-search',
      };
    }
    // CU-M-102 的另一半:分段计数改成全量口径之后,「统计里有 N 位」不再能解释「名单为什么空」
    // —— 标签/来源筛空时名单本来就该是空的。这条闸不加,筛空一次就会被下面的兜底说成
    // 「名单没取回来」,那是把正常结果报成故障。
    if (this.data.tagId || this.data.sourceType || this.data.sourceStart || this.data.sourceEnd) {
      return {
        emptyTitle: '这个筛选条件下没有客户', emptySub: '换个标签或来源时间再看看',
        emptyCta: '清除筛选', emptyAction: 'clear-advanced',
      };
    }
    if (inSegment) {
      const seg = SEGMENTS.filter(s => s.key === this.data.segment)[0];
      const label = (seg && seg.emptyLabel) || '这一段';
      return {
        emptyTitle: '还没有' + label, emptySub: '换个分段看看',
        emptyCta: '查看全部客户', emptyAction: 'clear-filter',
      };
    }
    // ⚠️ 计数与名单是两个来源:分段计数取后端 segmentCounts(全量),名单取分页 rows。
    // 两边对不上时会出现「全部 1」配「还没有客户」的自相矛盾一屏(2026-08-18 F08 实拍)。
    // 不静默:如实说明「有记录但这次没取回来」,并给出可执行的下一步,而不是假装一个客户都没有。
    const countedAll = finiteCount((segs.filter(s => s.key === 'all')[0] || {}).count);
    if (countedAll === null) {
      return {
        emptyTitle: '客户统计暂未取到',
        emptySub: '不会用 0 代替缺失的客户计数，请重新加载。',
        emptyCta: '重新加载', emptyAction: 'retry',
      };
    }
    if (countedAll > 0) {
      return {
        emptyTitle: '客户名单这次没取回来',
        emptySub: '统计里有 ' + countedAll + ' 位客户,但名单没加载出来。下拉刷新或稍后再看。',
        emptyCta: '重新加载', emptyAction: 'retry',
      };
    }
    return {
      emptyTitle: '还没有客户', emptySub: '先去合作中心承接项目，有人购票后会出现在这里',
      emptyCta: '去合作中心', emptyAction: 'go-coop',
    };
  },

  callCustomer(e) {
    this._revealCustomerContact(e, 'call');
  },

  copyCustomerPhone(e) {
    this._revealCustomerContact(e, 'copy');
  },

  /* F15:列表里的号码是服务端脱敏号(138****0000),不能拿它当真号拨/复制。
     每次动作先向服务端换取明文:权限、归属、同意、日限与访问审计都在那一条链上判。
     拿到号才真的拨/复制;拿不到就落失败半屏说清原因。 */
  _revealCustomerContact(e, purpose) {
    const memberId = Number(e.currentTarget.dataset.memberid);
    if (!strictPositiveSafeId(memberId)) return;
    if (this._contactBusy) return;
    this._contactBusy = true;
    const that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/crm/customers/${memberId}/contact`,
      method: 'POST',
      data: JSON.stringify({ purpose }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!ok(res)) { that._showContactFail(res); return; }
        const phone = res.data && typeof res.data.phone === 'string' ? res.data.phone.trim() : '';
        if (!phone) { that._showContactFail(res); return; }
        if (purpose === 'call') {
          wx.makePhoneCall({ phoneNumber: phone, fail() {} });   // 用户取消拨号也走 fail,不弹错
          return;
        }
        wx.setClipboardData({ data: phone });
      },
      fail(res) { that._showContactFail(res); },
      complete() { that._contactBusy = false; },
    });
  },

  _showContactFail(res) {
    this.setData({
      resultSheet: {
        show: true, kind: 'fail', title: '号码没能取到',
        sub: '为保护客户隐私，每次联系前都会重新确认你的权限和客户授权。',
        meta: '', pill: '',
        why: shapeRequestError(res, '服务暂时不可用，请稍后重试'),
        primaryText: '', secondaryText: '', duration: RESULT_SHEET_MS,
      },
    });
  },

  onResultSheetClose() {
    this.setData({ resultSheet: Object.assign({}, this.data.resultSheet, { show: false }) });
  },

  openCustomer(e) {
    const memberId = Number(e.currentTarget.dataset.memberid);
    if (!(Number.isSafeInteger(memberId) && memberId > 0)) return;
    if (this.data.selecting) {
      const selected = this.data.selectedIds.slice();
      const index = selected.indexOf(memberId);
      if (index >= 0) selected.splice(index, 1);
      else if (selected.length < 100) selected.push(memberId);
      this.setData({ selectedIds: selected, rows: markSelected(this.data.rows, selected) });
      return;
    }
    wx.navigateTo({
      url: `/pages/merchant/customer/detail/index?customerMemberId=${memberId}`,
    });
  },

  toggleSelectMode() {
    if (!this.data.canSegment) return;
    const selecting = !this.data.selecting;
    this.setData({ toolsOpen: false, selecting, selectedIds: [], rows: markSelected(this.data.rows, []), batchError: '' });
  },

  onBatchTagInput(e) { this.setData({ batchTagName: (e.detail && e.detail.value) || '', batchError: '' }); },

  submitBatchTag() {
    if (!this.data.canSegment || this.data.batchSubmitting) return;
    const isCurrent = this._scopeGuard();
    if (!isCurrent()) return;
    const tagName = this.data.batchTagName.trim();
    if (!this.data.selectedIds.length) { this.setData({ batchError: '请先选择客户' }); return; }
    if (!tagName || tagName.length > 16) { this.setData({ batchError: '请输入1至16字标签名称' }); return; }
    const requestId = createRequestId('batch-tag');
    this.setData({ batchSubmitting: true, batchError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/crm/customers/tags/batch',
      method: 'POST',
      data: JSON.stringify({ customerMemberIds: this.data.selectedIds, tagName, tagColor: '#2E6D5A', requestId }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (!isCurrent()) return;
        if (!ok(res)) { this.setData({ batchSubmitting: false, batchError: requestError(res, '批量加标签失败') }); return; }
        this.setData({ batchSubmitting: false, batchTagName: '', selecting: false, selectedIds: [] });
        toast.success('标签已添加');
        this.load();
      },
      fail: () => {
        if (isCurrent()) this.setData({ batchSubmitting: false, batchError: '网络连接失败，请稍后重试' });
      },
    });
  },

  onSegmentNameInput(e) { this.setData({ segmentName: (e.detail && e.detail.value) || '' }); },

  saveCurrentSegment() {
    if (!this.data.canSegment || this.data.segmentSaving) return;
    const isCurrent = this._scopeGuard();
    if (!isCurrent()) return;
    const name = this.data.segmentName.trim();
    if (!name || name.length > 30) { toast('请输入1至30字分群名称'); return; }
    this.setData({ segmentSaving: true });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/crm/segments',
      method: 'POST',
      data: JSON.stringify({ name, filter: this._segmentFilter(), requestId: createRequestId('segment') }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (!isCurrent()) return;
        this.setData({ segmentSaving: false });
        if (!ok(res)) { toast(requestError(res, '保存分群失败')); return; }
        this.setData({ segmentName: '' });
        this.loadSavedSegments();
        toast.success('分群已保存');
      },
      fail: () => {
        if (!isCurrent()) return;
        this.setData({ segmentSaving: false });
        toast('网络连接失败');
      },
    });
  },

  loadSavedSegments() {
    const isCurrent = this._scopeGuard();
    if (!isCurrent()) return;
    const requestToken = (this._savedSegmentsRequestToken || 0) + 1;
    this._savedSegmentsRequestToken = requestToken;
    const isLatest = () => isCurrent() && requestToken === this._savedSegmentsRequestToken;
    this.setData({ savedSegmentsError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/crm/segments',
      method: 'GET',
      success: (res) => {
        if (!isLatest()) return;
        if (!ok(res) || !Array.isArray(res.data)) {
          this.setData({ savedSegmentsError: shapeRequestError(res, '保存分群加载失败') });
          return;
        }
        const savedSegments = res.data;
        this.setData({
          savedSegments,
          savedSegmentsError: '',
        });
      },
      fail: () => {
        if (isLatest()) this.setData({ savedSegmentsError: '网络连接失败，保存分群未更新' });
      },
    });
  },

  applySavedSegment(e) {
    const id = Number(e.currentTarget.dataset && e.currentTarget.dataset.segmentid);
    const saved = this.data.savedSegments.find(item => Number(item.id) === id);
    if (!saved || !saved.filter) return;
    const filter = saved.filter;
    this.setData({
      segment: filter.segment || 'all',
      tagId: filter.tagId || '',
      sourceType: filter.sourceType ? String(filter.sourceType) : '',
      sourceStart: filter.sourceStart || '',
      sourceEnd: filter.sourceEnd || '',
    });
    this.load();
  },

  createExport() {
    if (!this.data.canExport || ['PENDING', 'RUNNING'].includes(this.data.exportState)) return;
    const isCurrent = this._scopeGuard();
    if (!isCurrent()) return;
    this.setData({ exportState: 'PENDING', exportError: '', exportTask: null });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/crm/exports',
      method: 'POST',
      data: JSON.stringify({ query: this._customerQuery(1), requestId: createRequestId('export') }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (!isCurrent()) return;
        if (!ok(res) || !res.data || !positiveSafeId(res.data.id)) {
          this.setData({ exportState: 'FAILED', exportError: shapeRequestError(res, '导出任务创建失败') });
          return;
        }
        if (res.data.downloadToken) this._exportToken = res.data.downloadToken;
        this.setData({ exportTask: res.data, exportState: res.data.status || 'PENDING' });
        this._pollExport();
      },
      fail: () => {
        if (isCurrent()) this.setData({ exportState: 'FAILED', exportError: '网络连接失败，请稍后重试' });
      },
    });
  },

  _pollExport() {
    const task = this.data.exportTask;
    if (this._exportPolling || !task || !strictPositiveSafeId(task.id)
        || !['PENDING', 'RUNNING'].includes(this.data.exportState)) return;
    const isCurrent = this._scopeGuard();
    if (!isCurrent()) return;
    this._exportPolling = true;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/crm/exports/${task.id}/status`,
      method: 'POST',
      success: (res) => {
        if (!isCurrent()) return;
        this._exportPolling = false;
        const nextTask = ok(res) ? shapeExportTask(res.data, task.id) : null;
        if (!nextTask) {
          this.setData({ exportError: shapeRequestError(res, '导出状态没读到，请重新查询') });
          this._scheduleExportPoll();
          return;
        }
        this.setData({ exportTask: nextTask, exportState: nextTask.status, exportError: nextTask.errorMessage || '' });
        if (['PENDING', 'RUNNING'].includes(nextTask.status)) this._scheduleExportPoll();
      },
      fail: () => {
        if (!isCurrent()) return;
        this._exportPolling = false;
        this.setData({ exportError: '导出状态查询失败，可稍后重试' });
        this._scheduleExportPoll();
      },
    });
  },

  _scheduleExportPoll() {
    if (!['PENDING', 'RUNNING'].includes(this.data.exportState) || !this.data.exportTask) return;
    if (this._exportTimer) clearTimeout(this._exportTimer);
    this._exportTimer = setTimeout(() => {
      this._exportTimer = null;
      this._pollExport();
    }, 1500);
  },

  retryExportStatus() {
    if (!['PENDING', 'RUNNING'].includes(this.data.exportState)) return;
    if (this._exportTimer) {
      clearTimeout(this._exportTimer);
      this._exportTimer = null;
    }
    this.setData({ exportError: '' });
    this._pollExport();
  },

  downloadExport() {
    const task = this.data.exportTask;
    if (!task || task.status !== 'SUCCESS' || !this._exportToken) {
      toast('下载凭证不可用，请重新创建导出');
      return;
    }
    const isCurrent = this._scopeGuard();
    if (!isCurrent()) return;
    this.setData({ exportState: 'DOWNLOADING', exportError: '' });
    wx.downloadFile({
      url: `${app.globalData.siteBaseUrl}/api/merchant/crm/exports/${task.id}/download`,
      header: { Authorization: app.getAuthorization(), 'X-CRM-Export-Token': this._exportToken },
      success: (res) => {
        if (!isCurrent()) return;
        if (res.statusCode !== 200 || !res.tempFilePath) {
          // 服务端那份文件确实还在,但「导出已就绪」+「下载失败」+一个照常的按钮
          // 是同屏自相矛盾。落一个自己的终态:话说清楚,按钮改名成重试。
          this.setData({ exportState: 'DOWNLOAD_FAILED', exportError: '下载失败，请稍后重试' });
          return;
        }
        this.setData({ exportState: 'SUCCESS' });
        wx.openDocument({ filePath: res.tempFilePath, showMenu: true,
          fail: () => {
            if (isCurrent()) toast('文件打开失败');
          } });
      },
      fail: () => {
        if (isCurrent()) this.setData({ exportState: 'DOWNLOAD_FAILED', exportError: '下载失败，请稍后重试' });
      },
    });
  },

  _segmentFilter() {
    return {
      segment: this.data.segment === 'all' ? null : this.data.segment,
      tagId: this.data.tagId || null,
      sourceType: this.data.sourceType ? Number(this.data.sourceType) : null,
      sourceStart: this.data.sourceStart || null,
      sourceEnd: this.data.sourceEnd || null,
    };
  },

  _customerQuery(pageNum) {
    return Object.assign({ pageNum, pageSize: PAGE_SIZE, keyword: this.data.keyword || null }, this._segmentFilter());
  },
});

function buildSegments(counts) {
  const c = counts || {};
  return {
    segments: SEGMENTS.map(s => Object.assign({}, s, { count: finiteCount(c[s.key]) })),
    monthlyNewCount: finiteCount(c.monthlyNew),
  };
}

function customerSummaryText(segmentData) {
  const total = segmentData.segments[0].count;
  if (total === null) return '客户数量加载中';
  return segmentData.monthlyNewCount === null
    ? `${total} 位`
    : `${total} 位 · 本月新增 ${segmentData.monthlyNewCount}`;
}

function shapeRow(row) {
  if (!isCustomerRow(row)) return null;
  const r = row;
  const name = (r.name || '').trim();
  const action = (r.lastAction || '').trim();
  const when = relativeTime(r.lastTime);
  return Object.assign({}, r, {
    displayName: name || '未留姓名',
    // 兜底文案不能进头像,否则会渲成一个「未」字当姓氏
    avatarName: name,
    // 「核销了「夜跑咖啡路线」· 3 天前」。两截都可能为空,别拼出一个孤零零的「· 」
    actionText: [action, when].filter(Boolean).join(' · '),
    /* 稿 471:6605 每行姓名右边有一颗状态徽标(已核销 / 已接洽 / 待核销)。
       tier 一直在行上(isCustomerRow 就校验它),TIER_TEXT 也一直在,只是从没渲染过 ——
       商家因此得逐个点进详情才知道谁还没核销,而这页存在的意义就是一眼看出这个。
       认不出的 tier 不写:印一个原始英文枚举对商家没有意义。 */
    tierText: TIER_TEXT[r.tier] || '',
    phoneText: (r.phone || '').trim(),
    latestNote: (r.latestNote || '').trim(),
    selected: false,
  });
}

function shapeExportTask(value, expectedId) {
  if (!isRecord(value) || !strictPositiveSafeId(value.id)) return null;
  if (expectedId !== null && expectedId !== undefined && value.id !== expectedId) return null;
  if (!['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'EXPIRED'].includes(value.status)) return null;
  if (value.rowCount !== null && value.rowCount !== undefined && !nonNegativeInteger(value.rowCount)) return null;
  if (value.status === 'SUCCESS' && !nonNegativeInteger(value.rowCount)) return null;
  if (!nullableString(value.errorMessage)) return null;
  return Object.assign({}, value);
}

function isCustomerRow(row) {
  if (!isRecord(row) || !strictPositiveSafeId(row.memberId)) return false;
  if (typeof row.name !== 'string' || !row.name.trim()) return false;
  if (!nullableString(row.avatar) || !nullableString(row.phone) || !nullableString(row.contactHint)
      || !nullableString(row.latestNote)) return false;
  if (!nonNegativeInteger(row.arrivedCount)
      || !nonNegativeInteger(row.pendingCount)
      || !nonNegativeInteger(row.refundedCount)) return false;
  if (row.paidAmount !== null && row.paidAmount !== undefined
      && !(typeof row.paidAmount === 'number' && Number.isFinite(row.paidAmount) && row.paidAmount >= 0)) return false;
  if (!validDateValue(row.lastTime)) return false;
  if (typeof row.lastAction !== 'string' || !row.lastAction.trim()) return false;
  if (!Object.prototype.hasOwnProperty.call(TIER_TEXT, row.tier)) return false;
  return ['TOPIC', 'ACTIVITY', 'MIXED'].includes(row.sourceType);
}

function strictPositiveSafeId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nullableString(value) {
  return value === null || value === undefined || typeof value === 'string';
}

function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validDateValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(new Date(value).getTime());
}

function shapeTags(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(item => positiveSafeId(item && item.id) && String(item.tagName || '').trim())
    .map(item => ({ id: Number(item.id), tagName: String(item.tagName).trim(), tagColor: item.tagColor || '#2E6D5A' }));
}

function markSelected(rows, selectedIds) {
  return rows.map(row => Object.assign({}, row, { selected: selectedIds.includes(Number(row.memberId)) }));
}

function createRequestId(kind) {
  return `crm-${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xFFFFFF).toString(36)}`;
}

function positiveSafeId(value) {
  const out = Number(value);
  return Number.isSafeInteger(out) && out > 0 ? out : null;
}

function ok(res) { return !!(res && (res.code === 200 || res.code === '200')); }
function requestError(res, fallback) {
  return (app.getRequestErrorMessage && app.getRequestErrorMessage(res, fallback)) || fallback;
}

// code=200 但数据形状/校验不过时,res.msg 是「操作成功」,不能当失败原因(2026-09-17 拍板)。
// 只有非 200 的业务失败才允许展示后端 msg,形状失败落场景兜底。
function shapeRequestError(res, fallback) {
  return ok(res) ? fallback : requestError(res, fallback);
}

/**
 * 相对时间在前端算,按用户本机时区 —— 服务端算「3 天前」会按服务器时区,
 * 跨时区必错(而且 CI 恒 UTC,这类 bug 结构性抓不到)。
 * 用 datetime.toTimestamp 锚定绝对时刻: 带偏移的 ISO 保持原样, 裸串按中国时间补 +08:00,
 * 不再用 replace(/-/g,'/') 破坏偏移。
 */
function relativeTime(value) {
  const ts = toTimestamp(value);
  if (isNaN(ts)) return '';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 0) return '';
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return days + ' 天前';
  if (days < 365) return Math.floor(days / 30) + ' 个月前';
  return Math.floor(days / 365) + ' 年前';
}
