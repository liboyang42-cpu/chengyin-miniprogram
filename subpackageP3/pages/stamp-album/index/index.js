// 集邮册:散落 collage(参考 STAMPA 的月份视图)。【乱才是魅力,不是网格】。
// 数百枚必须分页 + 懒加载,不能一次拉光(接口上限 50/页)。
const app = getApp();
const LAYOUT = require('./layout.js');

const COLS = 4;

Page({
  data: {
    items: [], total: 0, stageH: 0,
    cellImgW: 0, cellImgH: 0,
    // loaded = 「真的读到了后端的答复」;error = 「没读到」。两者不是一回事:
    // 失败时把 loaded 置真,空态「还没有邮票」就会替失败背书,用户以为册子被清空了(截图 057)。
    pageNum: 1, loading: false, loaded: false, error: false, noMore: false
  },

  onLoad() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const usable = win.windowWidth - 24;          // 减去 padding
    this._cellW = usable / COLS;
    this._cellH = this._cellW * 1.25;
    this.setData({ cellImgW: Math.round(this._cellW * 0.86), cellImgH: Math.round(this._cellH * 0.86) });
    this.load();
  },
  onReachBottom() { if (!this.data.noMore) this.load(); },

  load() {
    if (this.data.loading || this.data.noMore) return;
    this.setData({ loading: true, error: false });
    const that = this;
    app.sendRequest({
      url: '/api/roam/stamp/list', method: 'POST', autoErrorToast: this.data.items.length > 0,
      data: { pageNum: this.data.pageNum, pageSize: 50 },
      success(res) {
        const d = (res && res.code == '200' && res.data) ? res.data : null;
        // 非 200 / 没有 data = 没接通,不是「一枚都没有」:落 error,loaded 保持原值。
        const validRows = d && Array.isArray(d.list) && d.list.every(function (row) {
          return row && typeof row === 'object' && !Array.isArray(row)
            && row.id !== null && row.id !== undefined
            && typeof row.picUrl === 'string' && row.picUrl.trim()
        })
        const validTotal = d && typeof d.total === 'number' && Number.isFinite(d.total)
          && Number.isInteger(d.total) && d.total >= 0
          && d.total >= that.data.items.length + (validRows ? d.list.length : 0)
        if (!validRows || !validTotal) { that.setData({ loading: false, error: true }); return; }
        const rows = d.list;
        const merged = that.data.items.concat(rows.map(function (r) { return { id: r.id, picUrl: r.picUrl }; }));
        const pos = LAYOUT.collageLayout(merged.length, {
          cols: COLS, cellW: that._cellW, cellH: that._cellH, jitter: 16, maxRot: 12
        });
        const items = merged.map(function (m, i) {
          return { id: m.id, picUrl: m.picUrl, x: pos[i].x, y: pos[i].y, rot: pos[i].rot, z: pos[i].z };
        });
        that.setData({
          items: items,
          total: d.total,
          stageH: Math.ceil(merged.length / COLS) * that._cellH + 60,
          pageNum: that.data.pageNum + 1,
          noMore: rows.length === 0 || merged.length >= d.total,
          loading: false, loaded: true, error: false
        });
      },
      fail() { that.setData({ loading: false, error: true }); },
      // HTTP 层非 200 走的是这一条:不挂它的话 success/fail 都不会跑,
      // loading 永远为真 ⇒ 骨架转到底、还把 load() 的 if (loading) return 锁死后续分页。
      successStatusAbnormal() { that.setData({ loading: false, error: true }); }
    });
  },

  // 失败态的下一步(微信官方指南:异常要「告知解决方案,使其有路可退」)。
  retryLoad() { this.setData({ error: false }, () => this.load()); },

  goCamera() { wx.navigateTo({ url: '/subpackageP3/pages/stamp-camera/index/index' }); },

  // 自动化自证:回报渲染了几枚 + 后端说共几枚
  __layoutProbe() { return { n: this.data.items.length, total: this.data.total }; }
});
