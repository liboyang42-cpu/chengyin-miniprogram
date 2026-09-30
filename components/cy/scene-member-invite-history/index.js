'use strict'

const app = getApp()
const { chinaParts } = require('../../../utils/datetime.js')

function success(response) {
  return response && (response.code === 200 || response.code === '200')
}

function rowsOf(response) {
  return success(response) && response.data && Array.isArray(response.data.rows)
    ? response.data.rows
    : null
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function idKey(value) {
  const raw = value === null || value === undefined ? '' : String(value).trim()
  if (!/^\d+$/.test(raw)) return ''
  const normalized = raw.replace(/^0+(?=\d)/, '')
  return normalized === '0' ? '' : normalized
}

function pointText(value) {
  const number = finiteNumber(value)
  if (number === null) return ''
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100)
}

function dateParts(value) {
  return value ? chinaParts(value) : null
}

function monthLabel(value) {
  const parts = dateParts(value)
  return parts ? parts.year + '年' + parts.month + '月' : '其他邀请'
}

function shortTime(value) {
  const parts = dateParts(value)
  if (!parts) return ''
  const hour = String(parts.hours).padStart(2, '0')
  const minute = String(parts.minutes).padStart(2, '0')
  return parts.month + '月' + parts.day + '日 ' + hour + ':' + minute
}

function request(options) {
  return new Promise((resolve) => {
    app.sendRequest(Object.assign({}, options, {
      hideLoading: true,
      silentError: true,
      success: (response) => resolve(response || {}),
      fail: () => resolve({}),
      successStatusAbnormal: () => resolve({}),
    }))
  })
}

function rewardMap(rows) {
  const out = {}
  ;(rows || []).forEach((row) => {
    if (!row || Number(row.eventType) !== 5) return
    const eventId = idKey(row.eventId)
    const points = finiteNumber(row.changePoints)
    if (!eventId || !(points > 0)) return
    const key = eventId
    if (!out[key]) out[key] = { points: 0, createTime: row.createTime || '' }
    out[key].points += points
    if (!out[key].createTime && row.createTime) out[key].createTime = row.createTime
  })
  return out
}

function buildGroups(records, rewards, rewardReady) {
  const groups = []
  const byLabel = {}
  ;(records || []).forEach((record) => {
    const recordKey = record && idKey(record.id)
    if (!recordKey) return
    const reward = rewards[recordKey] || null
    const sourceTime = record.createTime || ''
    const label = monthLabel(sourceTime)
    let group = byLabel[label]
    if (!group) {
      group = { label, items: [], rewardTotal: 0, rewardText: '' }
      byLabel[label] = group
      groups.push(group)
    }
    const nickname = typeof record.nickname === 'string' && record.nickname.trim()
      ? record.nickname.trim()
      : '昵称待确认'
    const recordTime = shortTime(record.createTime)
    const earned = !!reward
    const rewardTime = earned ? shortTime(reward.createTime) : ''
    const rewardValue = earned ? pointText(reward.points) : ''
    if (earned) group.rewardTotal += reward.points
    group.items.push({
      id: record.id,
      nickname,
      avatar: record.avatar || '',
      timeText: recordTime || '邀请时间暂未记录',
      statusText: earned
        ? '首购奖励已到账' + (!recordTime && rewardTime ? ' · ' + rewardTime : '')
        : (rewardReady ? '已加入 · 首购待完成' : '已加入 · 奖励待同步'),
      rewardText: earned ? '+' + rewardValue + ' 积分' : (rewardReady ? '待解锁' : '待同步'),
    })
  })
  groups.forEach((group) => {
    group.rewardText = group.rewardTotal > 0 ? '+' + pointText(group.rewardTotal) + ' 积分' : group.items.length + ' 人'
    delete group.rewardTotal
  })
  return groups
}

Component({
  properties: {
    theme: { type: String, value: 'player' },
  },
  data: {
    loading: true,
    loadErr: false,
    loadMoreError: false,
    empty: false,
    total: 0,
    hasMore: false,
    groups: [],
    rewardReady: true,
    earnedTotalText: '0',
  },
  lifetimes: {
    attached() { this.load(true) },
    detached() { this._loadSeq = (this._loadSeq || 0) + 1 },
  },
  methods: {
    load(reset) {
      if (this._loading) return
      const pageNo = reset ? 1 : (this._pageNo || 1) + 1
      const seq = (this._loadSeq || 0) + 1
      this._loadSeq = seq
      this._loading = true
      if (reset) {
        this._records = []
        this._rewards = {}
        this._rewardReady = true
      }
      this.setData({
        loading: true,
        loadErr: false,
        loadMoreError: false,
        empty: false,
      })

      const inviteRequest = request({
        url: '/api/user/invite_list',
        method: 'POST',
        data: { pageNum: pageNo, pageSize: app.getPageSize() },
      })
      const rewardsRequest = reset
        ? request({ url: '/api/user/points/list', method: 'POST', data: { pageNum: 1, pageSize: 200 } })
        : Promise.resolve(null)

      Promise.all([inviteRequest, rewardsRequest]).then(([inviteResponse, rewardsResponse]) => {
        if (seq !== this._loadSeq) return
        this._loading = false
        const rows = rowsOf(inviteResponse)
        const responseTotal = rows && inviteResponse.data
          ? nonNegativeInteger(inviteResponse.data.total)
          : null
        if (!rows || responseTotal === null) {
          const hasRows = (this._records || []).length > 0
          this.setData({
            loading: false,
            loadErr: !hasRows,
            loadMoreError: hasRows,
            empty: false,
          })
          return
        }

        const merged = reset ? [] : (this._records || []).slice()
        const seen = {}
        merged.forEach((record) => {
          const key = record && idKey(record.id)
          if (key) seen[key] = true
        })
        rows.forEach((record) => {
          const key = record && idKey(record.id)
          if (!key || seen[key]) return
          seen[key] = true
          merged.push(record)
        })
        if (responseTotal < merged.length) {
          const hasRows = (this._records || []).length > 0
          this.setData({
            loading: false,
            loadErr: !hasRows,
            loadMoreError: hasRows,
            empty: false,
          })
          return
        }
        if (reset) {
          const pointRows = rowsOf(rewardsResponse)
          const pointTotal = rewardsResponse && rewardsResponse.data
            ? nonNegativeInteger(rewardsResponse.data.total)
            : null
          this._rewardReady = !!pointRows && pointTotal !== null && pointTotal === pointRows.length
          this._rewards = pointRows ? rewardMap(pointRows) : {}
        }
        this._records = merged
        this._pageNo = pageNo

        const total = responseTotal
        let earnedTotal = 0
        Object.keys(this._rewards || {}).forEach((key) => { earnedTotal += this._rewards[key].points })
        this.setData({
          loading: false,
          loadErr: false,
          loadMoreError: false,
          empty: merged.length === 0,
          total,
          hasMore: total > merged.length,
          groups: buildGroups(merged, this._rewards || {}, this._rewardReady),
          rewardReady: this._rewardReady,
          earnedTotalText: pointText(earnedTotal) || '0',
        })
      })
    },
    retry() { this.load(true) },
    loadMore() {
      if (this.data.hasMore && !this.data.loading) this.load(false)
    },
  },
})
