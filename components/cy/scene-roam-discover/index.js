'use strict'

const app = getApp()
const { isRecordList } = require('../../../utils/response-shape.js')
// CU-M-61:无图时盖/Logo 的兜底图标按品类选。品类名由后端下发(sysCategoryList),
// 拿不到就交空串由组件退回中性店铺图标 —— 不再让所有店共用同一只咖啡杯。
// 取法与「合作 → 商家」列表同一份(utils/category-icon),以前各写一份,漏写的那页就退化成全员咖啡杯。
const { firstCategoryName } = require('../../../utils/category-icon.js')
const HOT_TAGS = ['夜间友好', '可拍照', '适合组队', '宠物友好', '安静', '适合亲子']

Component({
  data: { keyword: '', activeTag: '', hotTags: HOT_TAGS, list: [], state: 'loading', refreshing: false, errorText: '' },
  lifetimes: { attached() { this.load() }, detached() { this._loadToken = (this._loadToken || 0) + 1 } },
  methods: {
    load() {
      const token = (this._loadToken || 0) + 1
      this._loadToken = token
      const hasRows = this.data.list.length > 0
      this.setData({ state: hasRows ? 'ready' : 'loading', refreshing: hasRows, errorText: '' })
      const body = {}
      if (this.data.keyword) body.name = this.data.keyword
      if (this.data.activeTag) body.tags = this.data.activeTag
      app.sendRequest({
        hideLoading: true,
        url: '/api/merchant/list',
        method: 'POST',
        data: JSON.stringify(body),
        header: { 'Content-Type': 'application/json' },
        silentError: true,
        success: (res) => {
          if (token !== this._loadToken) return
          if (!(res && (res.code == '200' || res.code == 200))) { this._failLoad((res && res.msg) || '商家列表暂时没有响应'); return }
          const rows = res.data && isRecordList(res.data.rows)
            ? res.data.rows : (isRecordList(res.data) ? res.data : null)
          if (!rows || rows.some((row) => row.id === null || row.id === undefined || String(row.id).trim() === '')) { this._failLoad('商家列表数据暂时不可用'); return }
          this.setData({ state: 'ready', refreshing: false, errorText: '', list: rows.map((row) => this._decorate(row)) })
        },
        fail: () => { if (token === this._loadToken) this._failLoad('网络异常，请稍后重试') },
        successStatusAbnormal: () => { if (token === this._loadToken) this._failLoad('商家列表暂时没有响应') },
      })
    },
    _failLoad(errorText) {
      this.setData({ state: this.data.list.length ? 'stale' : 'error', refreshing: false, errorText })
    },
    _decorate(row) {
      let tags = []
      try { tags = row.tags ? JSON.parse(row.tags) : [] } catch (_) {}
      if (!Array.isArray(tags)) tags = []
      // 2026-08-20 重设计:cover/logo 分开喂(封面头图),cityRole 走金色副标题位不再折进标签
      const status = row.businessStatus === 0 ? 'closed' : row.businessStatus === 1 ? 'open' : 'none'
      return { id: row.id, name: row.name || '名称待补充', logo: row.logo || '', cover: row.coverImage || '', cityRole: row.cityRole || '', slogan: row.slogan || row.description || '', status, tags: tags.slice(0, 3), categoryName: firstCategoryName(row) }
    },
    onKeyword(event) { this.setData({ keyword: event.detail.value }) },
    search() { this.load() },
    toggleTag(event) {
      const tag = event.currentTarget.dataset.t
      this.setData({ activeTag: this.data.activeTag === tag ? '' : tag }, () => this.load())
    },
    openProfile(event) {
      const poiId = event.currentTarget.dataset.id
      if (poiId) this.triggerEvent('open', { id: 'roam-poi-detail', params: { poiId } })
    },
    retry() { this.load() },
    close() { this.triggerEvent('close') },
  },
})
