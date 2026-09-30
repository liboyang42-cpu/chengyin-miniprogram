'use strict'

const app = getApp()
const { activityStatusMeta, activityStatusText } = require('../../../utils/activity-status.js')

function toTs(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value
  const parsed = new Date(String(value).replace(/-/g, '/').replace('T', ' ')).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function timeText(item) {
  if (!item._statusKnown) return '时间与状态待确认'
  const now = Date.now(); const start = toTs(item.activityStart); const end = toTs(item.activityEnd)
  if (item.status == 1 && start) return start > now ? `距开始 ${Math.max(1, Math.floor((start - now) / 3600000))} 小时` : '即将开始'
  if ((item.status == 2 || item.status == 3) && end) return end > now ? `距结束 ${Math.max(1, Math.floor((end - now) / 3600000))} 小时` : '即将结束'
  if (item.status >= 5) return '已结束'
  return activityStatusText(item.status) || '时间待确认'   // 与 pages/activity/list 同一真源
}

function countText(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? `${value} 人参与` : '人数待确认'
}

function progressValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : -1
}

Component({
  data: { tab: 0, tabs: ['进行中', '即将', '已结束', '我的'], keyword: '', all: [], mine: [], events: [], state: 'loading', refreshing: false, staleError: '', summary: '', emptyTitle: '', emptySub: '' },
  lifetimes: { attached() { this.load() }, detached() { this._loadToken = (this._loadToken || 0) + 1 } },
  methods: {
    load() {
      const token = (this._loadToken || 0) + 1
      this._loadToken = token
      const hadSnapshot = this._hasLoaded === true
      this.setData({ state: hadSnapshot ? 'ready' : 'loading', refreshing: hadSnapshot, staleError: '' })
      let allDone = false; let mineDone = false; let all = []; let mine = []; let failed = false
      const finish = () => {
        if (token !== this._loadToken || !allDone || !mineDone) return
        if (failed) {
          this.setData({ state: hadSnapshot ? 'stale' : 'error', refreshing: false, staleError: '活动列表更新失败，请稍后重试' }, () => this._filter())
          return
        }
        this._hasLoaded = true
        this.setData({ all, mine, state: 'ready', refreshing: false, staleError: '' }, () => this._filter())
      }
      app.sendRequest({
        url: '/api/official/events', method: 'GET', data: {}, hideLoading: true, silentError: true,
        success: (res) => { if (token !== this._loadToken) return; if (res && (res.code == 200 || res.code == '200') && Array.isArray(res.data) && res.data.every(isRecord)) all = res.data.map((item) => this._decorate(item)); else failed = true; allDone = true; finish() },
        successStatusAbnormal: () => { if (token !== this._loadToken) return; failed = true; allDone = true; finish() },
        fail: () => { if (token !== this._loadToken) return; failed = true; allDone = true; finish() },
      })
      app.sendRequest({
        url: '/api/official/my-events', method: 'GET', hideLoading: true, silentError: true,
        success: (res) => { if (token !== this._loadToken) return; if (res && (res.code == 200 || res.code == '200') && Array.isArray(res.data) && res.data.every(isRecord)) mine = res.data.map((item) => this._decorate(item)); else failed = true; mineDone = true; finish() },
        successStatusAbnormal: () => { if (token !== this._loadToken) return; failed = true; mineDone = true; finish() },
        fail: () => { if (token !== this._loadToken) return; failed = true; mineDone = true; finish() },
      })
    },
    _decorate(item) {
      const meta = activityStatusMeta(item.status)
      const statusKnown = typeof item.status === 'number' && [0, 1, 2, 3, 4, 5, 6, 9].includes(item.status)
      const decorated = { ...item, _statusKnown: statusKnown, _statusText: statusKnown ? (meta.text || '尚未开放') : '状态待确认', _statusVariant: statusKnown ? meta.variant : 'done', _live: statusKnown && meta.live, _participantsText: countText(item.participants), _pct: item.collective && item.collective.enabled === true ? progressValue(item.collective.pct) : -1 }
      /* CU-C-59:official_event.cover_img 可空(OfficialEventV2Mapper.xml:409 无兜底表达式)。
         原来无条件拼 background-image:url('{{item.coverImg}}') —— null 被插成字面量 'null',
         相对路径一解析就是 /pages/roam/null,220rpx 区域只剩近黑底色。空串即「没有封面」,
         由 wxml 走占位块。url() 加引号防 OSS 路径含空格/括号打断整条 style。 */
      const coverImg = item.coverImg == null ? '' : String(item.coverImg).trim()
      decorated._coverStyle = coverImg ? "background-image:url('" + coverImg.replace(/'/g, '%27') + "')" : ''
      decorated._timeText = timeText(decorated)
      return decorated
    },
    _filter() {
      const source = this.data.tab === 3 ? this.data.mine : this.data.all
      let events = this.data.tab === 0 ? source.filter((item) => item._live || !item._statusKnown) : this.data.tab === 1 ? source.filter((item) => item.status === 1) : this.data.tab === 2 ? source.filter((item) => item.status === 5 || item.status === 6 || item.status === 9) : source
      const keyword = String(this.data.keyword || '').trim().toLowerCase()
      if (keyword) events = events.filter((item) => [item.title, item.subtitle, item.city].some((value) => String(value || '').toLowerCase().includes(keyword)))
      const copy = keyword ? [`「${keyword}」${events.length} 个结果`, '换个关键词，或看看其他分类'] : [[ '暂无进行中的活动', '官方策展活动会第一时间出现在这里' ], [ '暂无即将开始的活动', '官方策展活动会第一时间出现在这里' ], [ '暂无已结束的活动', '往期活动归档后会出现在这里' ], [ '还没有参与的活动', '报名活动后会出现在这里' ]][this.data.tab]
      this.setData({ events, summary: keyword ? copy[0] : `${this.data.tabs[this.data.tab]} · 共 ${events.length} 个活动`, emptyTitle: keyword ? '没有找到相关活动' : copy[0], emptySub: copy[1] })
    },
    selectTab(event) { this.setData({ tab: Number(event.currentTarget.dataset.tab) }, () => this._filter()) },
    onKeyword(event) { this.setData({ keyword: event.detail.value }, () => this._filter()) },
    retry() { this.load() },
    // 行是 official_event:交宿主开官方活动详情页。play-activity-detail 查的是 cms_activity,id 会撞到别的活动(3-18)。
    openDetail(event) { this.triggerEvent('official', { id: event.currentTarget.dataset.id }) },
    close() { this.triggerEvent('close') },
  },
})

function isRecord(item) {
  return item && typeof item === 'object' && !Array.isArray(item)
}
