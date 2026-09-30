// J2 客户 · 主题内(T3 全屏弹窗)· Figma s7SEFaoJ3GQUIxJhdqcFUb node 143:90
// 从活动详情页的「客户」圆钮进:按**场次**列出这个主题的购票人与他们的核销状态。
// 与 pages/club/customers(按人跨主题聚合)不是一回事,这里回答的是「这一场谁来」。
//
// 数据:POST /api/club/crm/topic-customers { clubId, topicId, filter }
// ★ 手机号只认服务端渲染好的 phoneText(核销员岗位服务端给的是替代说明,不是号码)。
//   稿子里手机号右侧那个复制图标没有落地 —— 前端手上只有脱敏串,复制出去的号码打不通;
//   要能复制就得下发明文,那违反「脱敏必须在服务端做」。
const app = getApp();

const STATUS_TONE = Object.freeze({
  VERIFIED: 'success',   // 已核销 = 绿
  // 2026-09-11 后端多了第五档「已评价」(核销之后的一步)。这里的白名单不认就整块返回 null、
  // 整屏判错误态 —— 少一个 key 的代价不是丢一行,是这一屏全没。
  REVIEWED: 'success',
  PENDING: 'warning',
  CONTACTED: 'warning',
  REFUNDED: 'danger',
});
const FILTERS = Object.freeze([
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待核销' },
  { key: 'contacted', label: '已接洽' },
  { key: 'verified', label: '已核销' },
]);

function jsonBody(data) { return JSON.stringify(data || {}); }
function jsonHeader() { return { 'Content-Type': 'application/json' }; }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function count(value) {
  const out = Number(value);
  return Number.isSafeInteger(out) && out >= 0 ? out : null;
}

// 白名单整形:只取下面列出的字段,原始响应里多带的任何东西都进不了 data。
function shapeTopicCustomers(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions)) return null;
  const counts = ['soldCount', 'pendingCount', 'contactedCount', 'verifiedCount'].map(k => count(raw[k]));
  if (counts.some(value => value == null)) return null;
  const sessions = [];
  for (const session of raw.sessions) {
    if (!session || typeof session !== 'object' || !Array.isArray(session.rows)) return null;
    const rows = [];
    for (const row of session.rows) {
      if (!row || typeof row !== 'object' || !STATUS_TONE[row.statusCode]) return null;
      rows.push({
        key: text(row.key),
        displayName: text(row.displayName) || '未留姓名',
        avatar: text(row.avatar),
        orderNo: text(row.orderNo),
        phoneText: text(row.phoneText),
        statusText: text(row.statusText),
        tone: STATUS_TONE[row.statusCode],
        timeText: text(row.timeText) || '—',
      });
    }
    sessions.push({ key: text(session.key), timeText: text(session.timeText), headText: `${rows.length} 人`, rows });
  }
  return {
    soldText: `已售 ${counts[0]}`,
    pendingText: `待核销 ${counts[1]}`,
    contactedText: `已接洽 ${counts[2]}`,
    verifiedText: `已核销 ${counts[3]}`,
    sessions,
  };
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    clubId: { type: null, value: null },
    topicId: { type: null, value: null },
  },
  data: {
    filters: FILTERS,
    filterKey: 'all',
    state: 'loading', // loading | ready | empty | no-permission | error
    errorText: '',
    summary: null,
  },
  observers: {
    'show, topicId'(show, topicId) {
      if (show && topicId) this.load();
    },
  },
  methods: {
    onClose() { this.triggerEvent('close'); },
    retry() { this.load(); },
    onFilterTap(e) {
      const key = e.currentTarget.dataset.key;
      if (!key || key === this.data.filterKey) return;
      this.setData({ filterKey: key }, () => this.load());
    },
    load() {
      const epoch = (this._epoch || 0) + 1;
      this._epoch = epoch;
      const that = this;
      this.setData({ state: this.data.summary ? 'ready' : 'loading' });
      app.sendRequest({
        hideLoading: true,
        url: '/api/club/crm/topic-customers',
        method: 'POST',
        header: jsonHeader(),
        data: jsonBody({ clubId: this.data.clubId, topicId: this.data.topicId, filter: this.data.filterKey }),
        success(res) {
          if (epoch !== that._epoch) return;
          if (!res || res.code != '200') {
            const message = String((res && res.msg) || '');
            const denied = Number(res && res.code) === 403 || /没有权限|无权|仅(?:俱乐部)?主理人/.test(message);
            that.setData({ state: denied ? 'no-permission' : 'error', errorText: message || '客户名单暂时不可用' });
            return;
          }
          const shaped = shapeTopicCustomers(res.data);
          if (!shaped) { that.setData({ state: 'error', errorText: '客户名单数据格式异常' }); return; }
          that.setData({ summary: shaped, state: shaped.sessions.length ? 'ready' : 'empty', errorText: '' });
        },
        successStatusAbnormal(res, statusCode) {
          if (epoch !== that._epoch) return;
          that.setData({
            state: Number(statusCode) === 403 ? 'no-permission' : 'error',
            errorText: (res && res.msg) || '客户名单暂时不可用',
          });
        },
        fail() {
          if (epoch !== that._epoch) return;
          that.setData({ state: 'error', errorText: '网络不稳定，稍后再试一次' });
        },
      });
    },
  },
});
