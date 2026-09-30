'use strict'

const app = getApp()
const { isRecord, isRecordList } = require('../../../utils/response-shape.js')
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js')

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isStamp(row) {
  const validId = (typeof row.id === 'number' && Number.isFinite(row.id))
    || (typeof row.id === 'string' && row.id.trim() !== '')
  return validId && typeof row.picUrl === 'string' && row.picUrl.trim() !== ''
}

Component({
  behaviors: [reducedMotionBehavior],
  data: {
    items: [],
    total: 0,
    pageNum: 1,
    loading: false,
    loaded: false,
    error: false,
    noMore: false,
  },
  lifetimes: {
    attached() {
      /* 原型是 grid-template-columns:repeat(3,1fr) + aspect-ratio:1,格子尺寸交给 CSS,
         不再在 JS 里量窗宽算散落坐标(那套是「收藏夹」皮肤的东西,已随它退场)。 */
      this.load()
    },
    detached() { this._loadToken = (this._loadToken || 0) + 1 },
  },
  methods: {
    load() {
      if (this.data.loading || this.data.noMore) return
      const token = (this._loadToken || 0) + 1
      this._loadToken = token
      this.setData({ loading: true, error: false })
      app.sendRequest({
        url: '/api/roam/stamp/list',
        method: 'POST',
        data: { pageNum: this.data.pageNum, pageSize: 50 },
        hideLoading: true,
        silentError: true,
        success: (res) => {
          if (token !== this._loadToken) return
          const data = res && res.code == '200' && isRecord(res.data) ? res.data : null
          if (!data || !isRecordList(data.list) || !isNonNegativeInteger(data.total)
            || data.list.some((row) => !isStamp(row))) {
            this.setData({ loading: false, error: true })
            return
          }
          const rows = data.list
          // caption 是投票人写的那一句(≤30 字,机审过 check_state != 2),压在票面底部 ——
          // 原型 .stkcell 的每一格都带这么一行,现码原来只有图。没有就不渲染那一层。
          const merged = this.data.items.concat(rows.map((row) => ({
            id: row.id,
            picUrl: row.picUrl.trim(),
            caption: typeof row.caption === 'string' ? row.caption.trim() : '',
          })))
          const total = Number(data.total) || 0
          this.setData({ items: merged, total, pageNum: this.data.pageNum + 1, noMore: rows.length === 0 || merged.length >= total, loading: false, loaded: true, error: false })
        },
        fail: () => { if (token === this._loadToken) this.setData({ loading: false, error: true }) },
        successStatusAbnormal: () => { if (token === this._loadToken) this.setData({ loading: false, error: true }) },
      })
    },
    retryLoad() { this.setData({ error: false }, () => this.load()) },
    loadMore() { this.load() },
    openCamera() { this.triggerEvent('camera') },
    close() { this.triggerEvent('close') },
  },
})
