// 成长中心(深色版):足迹概览 + 我的排名摘要(点开去完整排行榜) + 徽章墙
// 数据:排行榜 = /api/growth/leaderboard(只取 me);足迹 = /api/growth/center + /api/play/{growth,my-completed}
// 完整榜单(领奖台+全量名次)已拆到 subpackageP3/pages/growthcenter/leaderboard,本页只展示自己的排名。
const app = getApp()
const { buildGrowthOverview } = require('../../../utils/growth-overview.js')
const { chinaParts } = require('../../../../utils/datetime.js')

function fmt(n) {
  // UI-04(2026-09-18):数字统计没取到显示 0,不再显示横杠
  if (n === null || n === undefined || n === '') return '0'
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function initial(name) {
  return name ? String(name).trim().charAt(0) : '?'
}

// 「获得时刻」的时间一面。后端 selectMemberBadges 下发的是 unlock_time(不带时区的中国时间串),
// 用 chinaParts 锚定后再格式化 —— 直接 new Date().getHours() 在非 +8 环境会整体偏移。
// ⚠️ 地点一面:member_badge 只有 source_type / source_id,没有任何地点名字段,
// 所以这里只展示时间,不去凑一个「在某地解锁」的假句子。
function unlockMoment(value) {
  const p = chinaParts(value)
  if (!p) return ''
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return p.year + '年' + p.month + '月' + p.day + '日 ' + pad(p.hours) + ':' + pad(p.minutes)
}

function requestGrowthData(url) {
  return new Promise((resolve) => {
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url,
      method: 'POST',
      data: {},
      success: (res) => resolve(res || {}),
      fail: (error) => resolve({ __requestFailed: true, __requestError: error || {} }),
      successStatusAbnormal: (error) => resolve({ __requestFailed: true, __requestError: error || {} })
    })
  })
}

function isSuccess(response) {
  return !!(response && (response.code === 200 || response.code === '200'))
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isRankItem(value) {
  return isObject(value)
    && isPositiveInteger(value.rank)
    && isNonNegativeNumber(value.score)
}

function isMyRank(value) {
  return isObject(value)
    && (value.rank === null || isPositiveInteger(value.rank))
    && isNonNegativeNumber(value.score)
}

function isBadgeItem(value) {
  return isObject(value)
    && (isNonBlankString(value.badgeCode) || isNonBlankString(value.badgeName))
}

function isCompletedItem(value) {
  return isObject(value) && isPositiveInteger(value.topicId)
}

function isRankResponse(response, metric, period) {
  const data = response && response.data
  return isSuccess(response)
    && isObject(data)
    && data.metric === metric
    && data.period === period
    && Array.isArray(data.list)
    && data.list.every(isRankItem)
    && isMyRank(data.me)
}

function isCenterResponse(response) {
  const data = response && response.data
  return isSuccess(response)
    && isObject(data)
    && isObject(data.growth)
    && isPositiveInteger(data.growth.levelNo)
    && Number.isInteger(data.growth.expValue)
    && data.growth.expValue >= 0
    && Array.isArray(data.badges)
    && data.badges.every(isBadgeItem)
}

function isPlayResponse(response) {
  return isSuccess(response) && isObject(response.data) && isNonNegativeNumber(response.data.totalMileage)
}

function isCompletedResponse(response) {
  return isSuccess(response) && Array.isArray(response.data) && response.data.every(isCompletedItem)
}

function isTransportFailure(error) {
  return /request:fail|timeout/i.test(String(error && error.errMsg || ''))
}

function rankHttpFailure(error) {
  const rawCode = error && (error.statusCode !== undefined ? error.statusCode : error.code)
  const code = String(rawCode == null ? '' : rawCode)
  if (code === '401' || code === '403') {
    return {
      boardState: 'permission',
      message: '登录状态失效或当前账号没有查看权限，请重新进入'
    }
  }
  return {
    boardState: 'error',
    message: (app.getRequestErrorMessage && app.getRequestErrorMessage(error, '排行榜没有加载出来'))
      || '排行榜没有加载出来'
  }
}

Page({
  data: {
    errorMsg: '',
    rankState: 'loading', // loading | refreshing | ready | stale-error | error
    rankErrorKind: 'data',
    boardState: 'error',
    metric: 'point',
    period: 'total',
    unit: '积分',
    me: null,
    rankLoaded: false,
    badges: [],
    expandedBadge: '',   // 当前展开「获得时刻」的徽章码,空串=全部收起
    badgeCountText: '0',
    badgeLoadError: false,
    showBadges: false,
    showBadgeEmpty: false,
    overviewState: 'loading', // loading | refreshing | ready | partial | stale-error | error
    overviewLoaded: false,
    overviewErrorKind: 'data',
    overviewError: '',
    celebrationEvent: '',
    badgeAnnouncement: '',
    overview: buildGrowthOverview({}),
  },

  onLoad() {
    this.loadOverview()
    this.loadMyRank()
  },

  onPullDownRefresh() {
    let pending = 2
    const done = () => {
      pending -= 1
      if (pending === 0 && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh()
    }
    this.loadOverview(done)
    this.loadMyRank(done)
  },

  onUnload() {
    this._rankEpoch = (this._rankEpoch || 0) + 1
    this._overviewEpoch = (this._overviewEpoch || 0) + 1
    this._rankLoading = false
    this._overviewLoading = false
  },

  // ---- 我的排名摘要(不拉完整榜单,完整榜单在 leaderboard 子页) ----
  loadMyRank(done) {
    if (this._rankLoading) {
      if (typeof done === 'function') done()
      return
    }
    this._rankLoading = true
    const epoch = (this._rankEpoch || 0) + 1
    this._rankEpoch = epoch
    const hasRankSnapshot = this.data.rankLoaded === true
    this.setData({
      rankState: hasRankSnapshot ? 'refreshing' : 'loading',
      rankErrorKind: 'data',
      errorMsg: '',
      boardState: 'error'
    })
    let settled = false
    const finish = () => {
      if (settled || epoch !== this._rankEpoch) return
      settled = true
      this._rankLoading = false
      return true
    }
    const notifyDone = () => {
      if (typeof done === 'function') done()
    }
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/growth/leaderboard',
      method: 'POST',
      data: { metric: this.data.metric, period: this.data.period, limit: 1 },
      success: (res) => {
        if (epoch !== this._rankEpoch) return
        if (isRankResponse(res, this.data.metric, this.data.period)) {
          if (!finish()) return
          this.buildMyRank(res.data)
          this.setData({ rankLoaded: true, rankState: 'ready', errorMsg: '', boardState: 'error', rankErrorKind: 'data' })
        } else {
          if (!finish()) return
          this.setData({
            rankState: hasRankSnapshot ? 'stale-error' : 'error',
            boardState: 'error',
            rankErrorKind: 'data',
            errorMsg: isSuccess(res)
              ? '排行榜数据不完整，请重试'
              : ((app.getRequestErrorMessage && app.getRequestErrorMessage(res, '排行榜没有加载出来')) || '排行榜没有加载出来')
          })
        }
        notifyDone()
      },
      fail: (error) => {
        if (!finish()) return
        this.setData({
          rankState: hasRankSnapshot ? 'stale-error' : 'error',
          boardState: 'error',
          rankErrorKind: isTransportFailure(error) ? 'network' : 'data',
          errorMsg: isTransportFailure(error)
            ? '网络不稳定，请检查连接后重试'
            : ((error && (error.msg || error.message)) || '排行榜没有加载出来')
        })
        notifyDone()
      },
      successStatusAbnormal: (error) => {
        if (!finish()) return
        const failure = rankHttpFailure(error)
        this.setData({
          rankState: hasRankSnapshot ? 'stale-error' : 'error',
          boardState: failure.boardState,
          rankErrorKind: 'data',
          errorMsg: failure.message
        })
        notifyDone()
      },
      complete: () => {
        if (!finish()) return
        this.setData({
          rankState: hasRankSnapshot ? 'stale-error' : 'error',
          boardState: 'error',
          rankErrorKind: 'data',
          errorMsg: '排行榜加载没有完成，请重试'
        })
        notifyDone()
      }
    })
  },

  retryRank() { this.loadMyRank() },

  buildMyRank(data) {
    const unit = this.data.metric === 'exp' ? 'EXP' : '积分'
    let me = null
    if (data.me && data.me.rank !== null && data.me.rank !== undefined) {
      const name = data.me.nickname || '我'
      me = {
        rank: data.me.rank,
        name,
        initial: initial(name),
        scoreText: fmt(data.me.score),
        avatarUrl: data.me.avatar || ''
      }
    }
    this.setData({ unit, me })
  },

  goLeaderboard() {
    wx.navigateTo({ url: '/subpackageP3/pages/growthcenter/leaderboard/index?metric=' + this.data.metric + '&period=' + this.data.period })
  },

  // ---- 足迹概览 + 徽章(复用三条已上线读取接口；失败不把数据伪装为零) ----
  loadOverview(done) {
    if (this._overviewLoading) {
      if (typeof done === 'function') done()
      return
    }
    this._overviewLoading = true
    const epoch = (this._overviewEpoch || 0) + 1
    this._overviewEpoch = epoch
    const hadOverview = this.data.overviewLoaded
    this.setData({
      overviewState: hadOverview ? 'refreshing' : 'loading',
      overviewErrorKind: 'data',
      overviewError: '',
      badgeAnnouncement: ''
    })
    Promise.all([
      requestGrowthData('/api/growth/center'),
      requestGrowthData('/api/play/growth'),
      requestGrowthData('/api/play/my-completed')
    ]).then(([center, play, completed]) => {
      if (epoch !== this._overviewEpoch) return
      const responses = [center, play, completed]
      const validSources = [isCenterResponse(center), isPlayResponse(play), isCompletedResponse(completed)]
      const successCount = validSources.filter(Boolean).length
      const allSuccess = successCount === responses.length
      const failedErrors = responses.filter((item) => item && item.__requestFailed)
        .map((item) => item.__requestError)
      const overview = hadOverview && !allSuccess
        ? this.data.overview
        : buildGrowthOverview({
          center: validSources[0] ? center : null,
          play: validSources[1] ? play : null,
          completed: validSources[2] ? completed : null
        })
      const hasBadgeSource = validSources[0]
      const raw = hasBadgeSource ? center.data.badges : []
      const badges = raw.map((b) => {
        const name = b.badgeName || b.badgeCode || '徽章'
        return {
          name,
          code: b.badgeCode || name,
          initial: initial(name),
          iconUrl: b.iconUrl || '',
          // 展开后的「获得时刻」:拿不到 unlock_time 就整块不展示,不填占位符
          unlockText: unlockMoment(b.obtainTime || b.unlockTime)
        }
      })
      const newlyUnlocked = hasBadgeSource ? this._trackNewlyUnlocked(badges) : []
      const state = allSuccess ? 'ready'
        : (hadOverview ? 'stale-error' : (successCount > 0 ? 'partial' : 'error'))
      const networkFailure = failedErrors.some(isTransportFailure)
      let nextBadges = this.data.badges
      let nextExpandedBadge = this.data.expandedBadge
      let nextBadgeCountText = this.data.badgeCountText
      let nextShowBadges = this.data.showBadges
      let nextShowBadgeEmpty = this.data.showBadgeEmpty
      if (hasBadgeSource) {
        nextBadges = badges
        nextExpandedBadge = ''
        nextBadgeCountText = String(badges.length)
        nextShowBadges = badges.length > 0
        nextShowBadgeEmpty = badges.length === 0
      }
      let celebrationEvent = this.data.celebrationEvent
      let badgeAnnouncement = ''
      if (newlyUnlocked.length) {
        this._celebrationSeq = (this._celebrationSeq || 0) + 1
        celebrationEvent = 'badge:' + this._celebrationSeq + ':' + newlyUnlocked.map((item) => item.code).join('|')
        badgeAnnouncement = '新徽章已点亮：' + newlyUnlocked.map((item) => item.name).join('、')
      }
      this._overviewLoading = false
      this.setData({
        overview,
        overviewState: state,
        overviewLoaded: hadOverview || successCount > 0,
        overviewErrorKind: networkFailure ? 'network' : 'data',
        overviewError: allSuccess ? '' : (hadOverview ? '足迹更新没有完成，现有数据仍可查看' : '部分成长数据暂时不可用'),
        badges: nextBadges,
        expandedBadge: nextExpandedBadge,
        badgeCountText: nextBadgeCountText,
        badgeLoadError: !hasBadgeSource,
        showBadges: nextShowBadges,
        showBadgeEmpty: nextShowBadgeEmpty,
        celebrationEvent,
        badgeAnnouncement
      })
      if (typeof done === 'function') done()
    })
  },

  // 徽章 = 一个「获得时刻」,不是孤立图标(ADA §二F)。点一枚展开它的时刻,再点收起。
  onBadgeTap(e) {
    const code = e.currentTarget.dataset.code
    this.setData({ expandedBadge: this.data.expandedBadge === code ? '' : code })
  },

  // 全屏庆祝的接线点(ADA §二F)。这里只负责「算出这次真的新点亮了哪几枚」——
  // 判据是本次徽章码集合相对上一次多出来的部分,首次加载不算新增(否则一进页面就放全屏庆祝)。
  // 动效只复用共享 cy-celebrate；真实徽章图仍来自服务端，不拿 CSS/字符伪造 3D 奖励资产。
  _trackNewlyUnlocked(badges) {
    const codes = (badges || []).map((b) => b.code)
    const prev = this._badgeCodes
    this._badgeCodes = codes
    if (!prev) return []
    return (badges || []).filter((badge) => prev.indexOf(badge.code) < 0)
  },

  goExplore() {
    wx.switchTab({ url: '/pages/index/index', fail: () => wx.navigateBack({ fail: () => {} }) })
  },

  // FE-17 分享:成就中心可传播(晒等级/勋章/排行)
  onShareAppMessage() { return { title: '来城瘾看看我的城市探索成就', path: '/subpackageP3/pages/growthcenter/index/index' }; },
  onShareTimeline() { return { title: '来城瘾看看我的城市探索成就' }; }
})
