'use strict'

// H04 / D22 提现记录。列表与取数逻辑的唯一实现；
// subpackageMember/tixianjilu 是 full sheet 深链壳，earnings 场景栈也挂载本组件。
// 页面级的 merchantTheme 换肤留在壳里 —— 弹窗主题由 scene-sheet 的 theme 作用域给。
const app = getApp()

function moneyText(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toFixed(2) : null
}

function statusView(status) {
  if (status === 0) return { statusText: '提现中', statusVariant: 'warn' }
  if (status === 1) return { statusText: '提现成功', statusVariant: 'success' }
  if (status === 2) return { statusText: '提现失败，提现金额已全部退回', statusVariant: 'danger' }
  return { statusText: '状态待确认', statusVariant: 'neutral' }
}

Component({
  properties: {
    theme: { type: String, value: 'player' },
  },
  data: {
    list: [],
    page_no: 1,
    hasMore: false,
    nodata: false,
    loadErr: false,
    loading: true,
  },
  lifetimes: {
    attached() { this.getList() },
  },
  methods: {
    // 壳的 onReachBottom / 弹窗正文滚到底都转发到这里
    loadMore() {
      if (this.data.loading || !this.data.hasMore) return
      this.setData({ page_no: this.data.page_no + 1 })
      this.getList()
    },

    getList() {
      const that = this
      that.setData({ loading: true })
      app.sendRequest({
        hideLoading: true,
        url: '/api/withdrawal/list',
        method: 'POST',
        data: { pageNum: that.data.page_no, pageSize: app.getPageSize() },
        success(res) {
          if (res.code == '200') {
            const payload = res.data
            const rows = Array.isArray(payload) ? payload
              : (payload && Array.isArray(payload.rows) ? payload.rows
                : (payload && Array.isArray(payload.list) ? payload.list : null))
            // rows 不是数组 ⇒ 落错误态,不当成空列表
            if (!rows) {
              that.setData({ loadErr: true })
              return
            }
            const total = payload && payload.total != null ? Number(payload.total) : rows.length
            that.setData({
              list: that.data.list.concat(rows.map((item) => Object.assign({}, item, statusView(item.status), {
                receivedAmountText: moneyText(item.receivedAmount),
                createTimeText: item.createTime || '—',
              }))),
              hasMore: app.getTotalPage(Number.isFinite(total) ? total : rows.length, app.getPageSize()) > that.data.page_no,
              loadErr: false,
            })
          } else {
            that.setData({ loadErr: true })
          }
        },
        fail() { that.setData({ loadErr: true }) },
        complete() {
          that.setData({ loading: false, nodata: that.data.list.length < 1 && !that.data.loadErr })
        },
      })
    },

    onRetry() {
      this.setData({ page_no: 1, list: [] })
      this.getList()
    },
    onPageRetry() {
      this.setData({ loadErr: false })
      this.getList()
    },
  },
})
