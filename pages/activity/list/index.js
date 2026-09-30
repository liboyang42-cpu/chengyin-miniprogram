const modal = require('../../../utils/modal.js');
const cyToast = require('../../../utils/toast.js');
const { activityStatusMeta, activityStatusText } = require('../../../utils/activity-status');
const officialChannel = require('../../../utils/merchant-official-channel.js');
const app = getApp();

// 日期兼容:后端 Date 可能是毫秒数或 "yyyy-MM-dd HH:mm:ss" 字符串
function toTs(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/-/g, '/').replace('T', ' ');
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}
function timeText(e) {
  const now = Date.now();
  const st = toTs(e.activityStart), en = toTs(e.activityEnd);
  if (e.status == 1 && st) { const d = st - now; return d > 0 ? '距开始 ' + fmtDur(d) : '即将开始'; }
  if ((e.status == 2 || e.status == 3) && en) { const d = en - now; return d > 0 ? '距结束 ' + fmtDur(d) : '即将结束'; }
  if (e.status >= 5) return '已结束';
  return activityStatusText(e.status) || '时间待确认';   // 草稿=空、结算中=结算中,不再一律「报名中」
}
function fmtDur(ms) {
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return Math.floor(h / 24) + ' 天';
  if (h >= 1) return h + ' 小时';
  return Math.max(1, Math.floor(ms / 60000)) + ' 分';
}

// 第三项 = cy-empty 的 kind。这里**只借它的字形**:本页恒显式传 title/sub,而 cy-empty
// 是 `title || d.title`(components/cy/empty/index.js:69),显式值优先,所以 kind 自带的
// 默认文案永远走不到。之前四个 tab 都没传 kind 也没传 icon,空态就是两行裸字 ——
// 全仓其余 6 处空态都有图,这页是唯一的例外。
// ⚠️ 不能用 kind='empty':那一档给的是位图 /images/no_data.svg,不是内置线性字形。
const EMPTY_COPY = {
  0: ['暂无进行中的活动', '官方策展活动会第一时间出现在这里', 'not-found'],
  1: ['暂无即将上线的活动', '官方策展活动会第一时间出现在这里', 'not-started'], // clock,与「还没开始」同一档
  2: ['暂无已结束的活动', '往期活动归档后会出现在这里', 'not-found'],
  3: ['还没有参与的活动', '报名活动后会出现在这里', 'not-found'],
};

// ===== 发起官方活动:类型 B 全屏 sheet(弹窗规范 5.1 阶段2 试点)=====
// 唯一入口是本页 FAB,能看到 FAB 就已经过 canPublish 校验,sheet 内不再重复查权限。
function toast(t) { cyToast(t); }

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    tab: 0,
    tabs: ['进行中', '即将上线', '已结束', '我的'],
    // cy-tabs(variant=chip,ccc 标准)要的 [{key,label}] 形状;key 用字符串化下标,
    // 不改 tab 本身的 number 语义,避免牵动 applyFilter 里一串 d.tab===N 的比较
    tabsCy: [{ key: '0', label: '进行中' }, { key: '1', label: '即将' }, { key: '2', label: '已结束' }, { key: '3', label: '我的' }],
    keyword: '',
    events: [],
    _all: [],
    _mine: [],
    loading: true,
    loadError: false,   // /api/official/events 失败
    mineError: false,   // /api/official/my-events 失败
    curError: false,    // 当前 tab 数据源的错误(applyFilter 派生,防两接口串台)
    errorMsg: '',
    summary: '',
    emptyTitle: '',
    emptySub: '',
    emptyKind: 'not-found',
    canPublish: false,

    // 发起官方活动 sheet(类型 B 全屏)
  },

  onLoad() {
    this.fetchAll();
    this.checkPublish();
  },
  onShow() {
    if (this._loaded) this.fetchMine();
  },

  // 深链直达(栈深=1)时返回键无处可退,兜底回首页
  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/index/index' });
  },

  checkPublish() {
    app.sendRequest({
      url: '/api/official/can-publish', method: 'GET', hideLoading: true,
      success: (res) => {
        if (res && (res.code == 200 || res.code == '200')) {
          this.setData({ canPublish: !!(res.data && res.data.canPublish) });
        }
      }
    });
  },

  // 错误态由页面 cy-error 呈现:silentError 关自动 toast。
  // 终态只认 success / successStatusAbnormal(HTTP!=200)/ fail 三回调——request-client
  // 所有路径(含 401 重登失败→fail、重试再 401→statusAbnormal)必落其一;
  // 不用 complete:401 重登窗口它会先于终态开火,导致假空态/丢错误态。
  fetchAll() {
    this.setData({ loading: true, loadError: false, curError: false, errorMsg: '' });
    const done = (patch) => { this.setData(Object.assign({ loading: false }, patch)); this.applyFilter(); };
    app.sendRequest({
      url: '/api/official/events', method: 'GET', data: {}, hideLoading: true, silentError: true,
      success: (res) => {
        if (res && (res.code == 200 || res.code == '200') && Array.isArray(res.data)) {
          this._loaded = true;
          done({ _all: res.data.filter(this._isCompleteEvent).map(this._decorate) });
        } else {
          done({ loadError: true, errorMsg: app.getRequestErrorMessage(res, '网络开了点小差，请稍后再试') });
        }
      },
      successStatusAbnormal: (data) => {
        done({ loadError: true, errorMsg: app.getRequestErrorMessage(data, '服务暂时不可用，请稍后再试') });
      },
      fail: (res) => {
        done({ loadError: true, errorMsg: app.getRequestErrorMessage(res, '网络异常，请稍后再试') });
      },
    });
    this.fetchMine();
  },
  fetchMine() {
    const done = (patch) => {
      this.setData(patch);
      if (this.data.tab === 3) this.applyFilter();
    };
    app.sendRequest({
      url: '/api/official/my-events', method: 'GET', hideLoading: true, silentError: true,
      success: (res) => {
        if (res && (res.code == 200 || res.code == '200') && Array.isArray(res.data)) {
          done({ _mine: res.data.filter(this._isCompleteEvent).map(this._decorate), mineError: false });
        } else {
          done({ mineError: true, errorMsg: app.getRequestErrorMessage(res, '网络开了点小差，请稍后再试') });
        }
      },
      successStatusAbnormal: (data) => done({ mineError: true, errorMsg: app.getRequestErrorMessage(data, '服务暂时不可用，请稍后再试') }),
      fail: (res) => done({ mineError: true, errorMsg: app.getRequestErrorMessage(res, '网络异常，请稍后再试') }),
    });
  },
  onRetry() {
    this.fetchAll();
  },

  _decorate(e) {
    const m = activityStatusMeta(e.status);
    e._statusText = m.text;
    e._statusVariant = m.variant;
    e._live = m.live;
    e._timeText = timeText(e);
    e._pct = (e.collective && e.collective.enabled) ? e.collective.pct : -1;
    e.coverImg = e.coverImg || e.imgUrl || e.cover || '';
    // url() 加引号防 OSS 路径含空格/括号打断整条 style
    e._coverStyle = e.coverImg ? "background-image:url('" + String(e.coverImg).replace(/'/g, '%27') + "')" : '';
    // F21(2026-09-17 拍板 C):关键承接方缺失的活动标「信息不全」+原因,保留不撤下(公开列表口径)
    e._gapLabel = officialChannel.recruitmentGapLabel(e);
    e._gapText = officialChannel.recruitmentGapText(e);
    return e;
  },

  _isCompleteEvent(e) {
    const idType = e && typeof e.id;
    const titleType = e && typeof e.title;
    return !!(e
      && (idType === 'string' || idType === 'number')
      && String(e.id).trim()
      && (titleType === 'string' || titleType === 'number')
      && String(e.title).trim());
  },

  onTab(ev) {
    this.applyFilter({ tab: +ev.detail.key });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  onSearchInput(ev) {
    this.applyFilter({ keyword: ev.detail.value });
  },

  // 筛选 = tab 分组 + 关键词(标题/副题/城市)本地过滤;
  // extra(如 {tab}/{keyword})并入同一次 setData,一次交互只过一次桥
  applyFilter(extra) {
    const d = extra ? Object.assign({}, this.data, extra) : this.data;
    let list;
    if (d.tab === 3) list = d._mine;
    else if (d.tab === 0) list = d._all.filter(e => e._live);
    else if (d.tab === 1) list = d._all.filter(e => e.status == 1);
    else list = d._all.filter(e => e.status >= 5);

    const kw = d.keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter(e =>
        String(e.title || '').toLowerCase().indexOf(kw) >= 0 ||
        String(e.subtitle || '').toLowerCase().indexOf(kw) >= 0 ||
        String(e.city || '').toLowerCase().indexOf(kw) >= 0
      );
    }

    let summary, emptyTitle, emptySub, emptyKind;
    if (kw) {
      summary = '「' + d.keyword.trim() + '」' + list.length + ' 个结果';
      emptyTitle = '没有找到相关活动';
      emptySub = '换个关键词，或看看其他分类';
      emptyKind = 'not-found';
    } else {
      summary = d.tabs[d.tab] + ' · 共 ' + list.length + ' 个活动';
      const c = EMPTY_COPY[d.tab];
      emptyTitle = c[0];
      emptySub = c[1];
      emptyKind = c[2];
    }
    this.setData(Object.assign({
      events: list, summary, emptyTitle, emptySub, emptyKind,
      curError: d.tab === 3 ? d.mineError : d.loadError,
    }, extra));
  },

  openDetail(ev) {
    const id = ev.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/activity/official-detail/index?id=' + id });
  },
  goMine() {
    wx.navigateTo({ url: '/pages/activity/official-mine/index' });
  },
  goInbox() {
    wx.navigateTo({ url: '/pages/activity/official-inbox/index' });
  },
});
