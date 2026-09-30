// 圈层退役兼容壳(2026-08-29 圈层主题并入自由探索,见 migration_20260829_circle_theme_merge_free_explore.sql):
// 站内已无入口,唯一来路是散落在聊天/手机里的旧分享卡片(onShareAppMessage 自传播)。
// 2026-12-31 之后删除本目录并从 app.json 摘除,同 topicadd 壳的排期做法。
const toast = require('../../../utils/toast.js');
const app = getApp()
const circle = require('../utils/circle-theme.js')
const { getPlayReceiptState } = require('../../../utils/play-state-contract.js')

function request(url, method, data) {
  return new Promise((resolve) => {
    app.sendRequest({
      hideLoading: true,
      url,
      method,
      data: method === 'GET' ? data : JSON.stringify(data || {}),
      header: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      success: (res) => resolve(res || {}),
      fail: () => resolve({ code: 'fail', msg: '网络异常，请稍后重试' })
    })
  })
}

function supplyReviewText(value) {
  if (!value) return '商家确认时间待更新'
  const text = String(value)
  const parsed = new Date(text.replace(/-/g, '/'))
  if (Number.isNaN(parsed.getTime())) return '商家确认时间待更新'
  const ageDays = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000))
  const remaining = Math.max(0, 30 - ageDays)
  return text.slice(0, 10) + ' 商家确认 · 距30天复核到期' + remaining + '天'
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight || 20,
    navBarHeight: app.globalData.navBarHeight || 44,
    loading: true,
    refreshing: false,
    submitting: false,
    // 写回执态,词典见 utils/play-state-contract.js
    receipt: 'ready',
    receiptText: '',
    theme: null,
    combinationText: '',
    offers: [],
    interactions: [],
    card: null,
    noteDrafts: {},
    answerDrafts: {},
    shanghaiDrafts: {},
    readOnly: false,
    readOnlyText: '',
    errorText: '',
    errorKind: 'network',
    errorSub: '',
    errorAction: '重新加载'
  },

  onLoad(options) {
    const topicId = options && options.topicId
    if (!topicId) {
      this.setData({
        loading: false,
        errorText: '探索链接不完整',
        errorKind: 'missing-param',
        errorSub: '请从圈层主题或同行人分享的邀请重新进入',
        errorAction: '返回首页'
      })
      return
    }
    // 圈层已并回自由探索：旧分享链仍进本页。有主题 id 就转统一 play，不再找 circle_theme_code。
    const query = ['topicId=' + topicId]
    const inviteCode = String((options && options.inviteCode) || '').trim()
    if (inviteCode) query.push('inviteCode=' + inviteCode)
    const registrationId = options && options.registrationId
    if (registrationId) query.push('registrationId=' + registrationId)
    wx.redirectTo({ url: '/pages/play/index?' + query.join('&') })
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/index/index' })
  },

  onStateAction() {
    if (this.data.errorKind === 'missing-param') {
      this.goBack()
      return
    }
    this.retryLoad()
  },

  retryLoad() {
    if (!this._topicId) {
      this.goBack()
      return
    }
    return this.load()
  },

  _sessionStorageKey() {
    const memberId = app.getUserID && app.getUserID()
    return memberId === null || memberId === undefined || memberId === '' || !this._topicId
      ? '' : 'circle_session_m' + memberId + '_t' + this._topicId
  },

  setLoadError(response, title, sub) {
    // 有旧卡时刷新失败静默降级:wxml 只在 errorText && !card 渲染,所以这里不再写 stale 文案。
    const stale = !!this.data.card
    const network = response && response.code === 'fail'
    this.setData({
      loading: false,
      refreshing: false,
      errorText: stale ? '' : (network ? '网络没连上' : title),
      errorKind: network ? 'network' : 'data',
      errorSub: stale ? '' : (response && response.msg) || sub,
      errorAction: '重新加载'
    })
  },

  load() {
    if (this._loadPromise) return this._loadPromise
    const pending = this.loadOnce()
    this._loadPromise = pending
    return pending.then((value) => {
      if (this._loadPromise === pending) this._loadPromise = null
      return value
    }, (error) => {
      if (this._loadPromise === pending) this._loadPromise = null
      throw error
    })
  },

  async loadOnce() {
    const hadCard = !!this.data.card
    this.setData({
      loading: !hadCard,
      refreshing: hadCard,
      errorText: '',
      errorSub: '',
      errorAction: '重新加载'
    })
    let sessionId = ''
    let cardRes = { code: 'missing' }
    if (!this._pendingInviteCode) {
      try {
        wx.removeStorageSync('circle_session_' + this._topicId)
        const key = this._sessionStorageKey()
        sessionId = key ? (wx.getStorageSync(key) || '') : ''
      } catch (e) {}
      cardRes = sessionId
        ? await request('/api/circle-theme/session/' + sessionId + '/card', 'GET', {})
        : cardRes
    }
    if (cardRes.code === 'fail') {
      this.setLoadError(cardRes, '探索卡暂时不可用', '请稍后重新加载')
      return
    }
    const offersRes = await request('/api/circle-theme/instance/' + this._topicId + '/offers', 'GET', {})
    if (offersRes.code === 'fail') {
      this.setLoadError(offersRes, '商家信息暂时不可用', '请稍后重新加载')
      return
    }
    const offerRows = offersRes.code == '200' && Array.isArray(offersRes.data) ? offersRes.data : []
    const supplyClosedText = offersRes.code != '200' && offersRes.msg
      ? offersRes.msg : '当前有效商家不足3家，城市实例暂不开放'
    const supplyOpen = offerRows.length >= 3
    const offers = offerRows.map((item) => Object.assign({}, item, { recorded: false }))
    if (this._pendingInviteCode) {
      if (!supplyOpen) {
        this.setLoadError(offersRes, supplyClosedText, '请稍后重新加载')
        return
      }
      const joined = await request('/api/circle-theme/session/join', 'POST', {
        inviteCode: this._pendingInviteCode
      })
      sessionId = joined.data && joined.data.id
      if (joined.code != '200' || !sessionId) {
        this.setLoadError(joined, '无法加入同行探索', '请让同行人重新分享邀请')
        return
      }
      try {
        const key = this._sessionStorageKey()
        if (key) wx.setStorageSync(key, sessionId)
      } catch (e) {}
      cardRes = await request('/api/circle-theme/session/' + sessionId + '/card', 'GET', {})
      if (cardRes.code === 'fail') {
        this.setLoadError(cardRes, '探索卡暂时不可用', '请稍后重新加载')
        return
      }
    }
    if (cardRes.code != '200') {
      if (!supplyOpen) {
        this.setLoadError(offersRes, supplyClosedText, '请稍后重新加载')
        return
      }
      const created = await request('/api/circle-theme/session', 'POST', { topicId: Number(this._topicId) })
      sessionId = created.data && created.data.id
      if (created.code != '200' || !sessionId) {
        this.setLoadError(created, '无法开始本次探索', '请稍后重试')
        return
      }
      try {
        const key = this._sessionStorageKey()
        if (key) wx.setStorageSync(key, sessionId)
      } catch (e) {}
      cardRes = await request('/api/circle-theme/session/' + sessionId + '/card', 'GET', {})
      if (cardRes.code != '200') {
        this.setLoadError(cardRes, '探索卡暂时不可用', '请稍后重新加载')
        return
      }
    }
    const card = cardRes.data || {}
    const themeCode = card.themeCode || this._themeCode
    const theme = circle.themeOf(themeCode)
    if (!theme) {
      this.setLoadError({ code: 'data' }, '圈层主题配置无法识别', '请从圈层主题重新进入')
      return
    }
    const decoratedCard = this.decorateCard(card, themeCode, offers)
    const readOnly = decoratedCard.completed || !supplyOpen
    this._sessionId = sessionId
    this._themeCode = themeCode
    this.setData({
      loading: false,
      refreshing: false,
      errorText: '',
      errorSub: '',
      theme,
      combinationText: offers.map((offer) => offer.candidateName).filter(Boolean).join('＋'),
      interactions: this.buildInteractions(themeCode, offers, decoratedCard),
      offers: this.decorateOffers(offers, decoratedCard),
      card: decoratedCard,
      readOnly,
      readOnlyText: !supplyOpen && !decoratedCard.completed
        ? '当前有效商家不足3家，本次记录暂不可继续；已有记录仍会保留。'
        : ''
    })
  },

  decorateOffers(offers, card) {
    const recorded = new Set(((card && card.records) || []).map((item) => String(item.offerId)))
    return offers.map((item) => Object.assign({}, item, {
      recorded: recorded.has(String(item.offerId)),
      actionLabel: ({ NAVIGATE: '导航', BOOK: '预约', BUY: '购买' })[item.actionType] || '商家',
      actionButtonText: /^1\d{10}$/.test(String(item.actionValue || '').trim())
        ? '拨打预约电话'
        : ({ NAVIGATE: '复制导航地址', BOOK: '复制预约入口', BUY: '复制购买入口' })[item.actionType] || '复制商家入口',
      bookingText: Number(item.splitBookingAllowed) === 1 ? '可分开预约/轮换' : '同行同时参与',
      roleLabel: circle.ROLE_LABELS[item.circleRole] || item.circleRole || '主题体验',
      reviewText: supplyReviewText(item.checkedAt),
      priceText: item.regularPrice == null || item.regularPrice === ''
        ? '价格以商家页为准' : '¥' + item.regularPrice
    }))
  },

  buildInteractions(themeCode, offers, card) {
    const recordedMerchantCount = Number((card && card.recordedMerchantCount) || 0)
    const interactions = circle.interactionsFor(themeCode, offers.map((item) => item.candidateCode))
      .filter((interaction) => {
        if (interaction.stage === 'PRE_CHOICE' || interaction.stage === 'PRE_WISH') {
          return recordedMerchantCount === 0
        }
        if (interaction.stage === 'POST_CHOICE' || interaction.stage === 'NEXT_PICK') {
          return recordedMerchantCount >= 2
        }
        return true
      })
    if (themeCode !== 'SHANGHAI') return interactions
    const recorded = new Set(((card && card.records) || []).map((item) => String(item.offerId)))
    return interactions.map((interaction) => Object.assign({}, interaction, {
      recordedOffers: offers.filter((offer) => recorded.has(String(offer.offerId))).map((offer) => ({
        candidateCode: offer.candidateCode,
        candidateName: offer.candidateName,
        keywords: interaction.choices
      }))
    }))
  },

  decorateCard(card, themeCode, offers) {
    const result = Object.assign({}, card || {})
    const theme = circle.themeOf(themeCode)
    const names = new Map(((theme && theme.candidates) || []).map((candidate) => [candidate.code, candidate.name]))
    ;(offers || []).forEach((offer) => names.set(offer.candidateCode, offer.candidateName))
    const interactions = circle.interactionsFor(themeCode, Array.from(names.keys()))
    const choices = new Map()
    interactions.forEach((interaction) => {
      const interactionChoices = interaction.choices || []
      interactionChoices.forEach((choice) => {
        if (choice && choice.value) choices.set(choice.value, choice.label)
      })
    })
    const stageNames = {
      PRE_CHOICE: '出发前', POST_CHOICE: '完成后', SELF_MOMENT: '像自己的时刻',
      QUESTION_CARD: '一起选的问题', PRE_WISH: '今天最想做', NEXT_PICK: '下次还会来'
    }
    const lines = []
    const answers = result.answers || []
    answers.forEach((answer) => {
      const value = String(answer.answerValue || '').trim()
      if (!value) return
      if (themeCode === 'SHANGHAI') {
        value.split(/[,，]/).forEach((token) => {
          const pair = token.split(':')
          if (pair.length === 2) lines.push((names.get(pair[0]) || pair[0]) + ' · ' + pair[1])
        })
        return
      }
      const display = choices.get(value) || names.get(value) || value
      const showMember = themeCode === 'FITNESS' || themeCode === 'MIDLIFE'
        || (themeCode === 'FRIENDS' && answer.answerStage === 'PRE_WISH')
      const memberPrefix = showMember && answer.memberLabel
        ? answer.memberLabel + ' · ' : ''
      lines.push(memberPrefix + (stageNames[answer.answerStage] ? stageNames[answer.answerStage] + '：' : '') + display)
    })
    result.memoryTitle = (theme ? theme.name : '本次探索') + '共同记忆卡'
    result.memoryLines = Array.from(new Set(lines))
    return result
  },

  openOfferAction(e) {
    const offer = this.data.offers.find((item) => String(item.offerId) === String(e.currentTarget.dataset.id))
    const value = String((offer && offer.actionValue) || '').trim()
    if (!value) {
      toast('商家暂未填写行动入口')
      return
    }
    if (/^1\d{10}$/.test(value)) {
      wx.makePhoneCall({ phoneNumber: value })
      return
    }
    wx.setClipboardData({
      data: value,
      success: () => toast((offer.actionLabel || '商家') + '入口已复制')
    })
  },

  onNoteInput(e) {
    const offerId = e.currentTarget.dataset.id
    this.setData({ ['noteDrafts.' + offerId]: e.detail.value })
  },

  async recordOffer(e) {
    if (this.data.submitting || this.data.receipt === 'unknown') return
    const offerId = e.currentTarget.dataset.id
    this.setData({ submitting: true, receipt: 'submitting', receiptText: '' })
    const res = await request('/api/circle-theme/session/record', 'POST', {
      sessionId: Number(this._sessionId),
      offerId: Number(offerId),
      note: this.data.noteDrafts[offerId] || ''
    })
    // 请求没拿到响应 ⇒ 结果未知:后端这条是唯一键 insert,重发不会写坏,
    // 但会甩出「你已经记录过这家供给」——那读起来像出错,其实是成功了。改成先回读再说话。
    if (res.code === 'fail') {
      return this._resolveUnknown(() => this._hasRecord(offerId))
    }
    this.setData({ submitting: false })
    if (res.code != '200') {
      // 唯一键撞上 = 上一次其实已经写进去了,这是确认不是失败
      if (/已经记录过/.test(res.msg || '')) {
        this.setData({ receipt: 'confirmed', receiptText: '' })
        await this.refreshCard()
        return
      }
      this.setData({ receipt: 'failed' })
      toast(res.msg || '记录失败')
      return
    }
    this.setData({ receipt: 'confirmed' })
    toast.success('已加入私人记录卡')
    await this.refreshCard()
  },

  onAnswerInput(e) {
    const stage = e.currentTarget.dataset.stage
    this.setData({ ['answerDrafts.' + stage]: e.detail.value })
  },

  toggleKeyword(e) {
    const stage = e.currentTarget.dataset.stage
    const value = e.currentTarget.dataset.value
    const current = String(this.data.answerDrafts[stage] || '').split(',').filter(Boolean)
    const index = current.indexOf(value)
    if (index >= 0) current.splice(index, 1)
    else if (current.length < 4) current.push(value)
    this.setData({ ['answerDrafts.' + stage]: current.join(',') })
  },

  chooseAnswer(e) {
    const stage = e.currentTarget.dataset.stage
    this.setData({ ['answerDrafts.' + stage]: e.currentTarget.dataset.value })
  },

  chooseShanghaiKeyword(e) {
    const code = e.currentTarget.dataset.code
    this.setData({ ['shanghaiDrafts.' + code]: e.currentTarget.dataset.value })
  },

  async submitShanghaiKeywords(e) {
    const interaction = this.data.interactions.find((item) => item.stage === e.currentTarget.dataset.stage)
    const rows = (interaction && interaction.recordedOffers) || []
    if (!rows.length) {
      toast('请先自助记录一家商家')
      return
    }
    const missing = rows.some((row) => !this.data.shanghaiDrafts[row.candidateCode])
    if (missing) {
      toast('请为每家已记录商家选一个词')
      return
    }
    const value = rows.map((row) => row.candidateCode + ':' + this.data.shanghaiDrafts[row.candidateCode]).join(',')
    await this.saveAnswer(e.currentTarget.dataset.stage, value)
  },

  async submitAnswer(e) {
    if (this.data.submitting) return
    const stage = e.currentTarget.dataset.stage
    const value = String(this.data.answerDrafts[stage] || '').trim()
    if (!value) {
      toast('请先填写或选择')
      return
    }
    await this.saveAnswer(stage, value)
  },

  async saveAnswer(stage, value) {
    if (this.data.submitting || this.data.receipt === 'unknown') return
    this.setData({ submitting: true, receipt: 'submitting', receiptText: '' })
    const res = await request('/api/circle-theme/session/answer', 'POST', {
      sessionId: Number(this._sessionId), stage, value
    })
    if (res.code === 'fail') {
      return this._resolveUnknown(() => this._hasAnswer(stage, value))
    }
    this.setData({ submitting: false })
    if (res.code != '200') {
      this.setData({ receipt: 'failed' })
      toast(res.msg || '保存失败')
      return
    }
    this.setData({ receipt: 'confirmed' })
    toast.success('轻互动已保存')
    await this.refreshCard()
  },

  /** unknown 只能由服务端自己产生的事实解除:重新拉记录卡,看这一笔到底有没有落进去。 */
  async _resolveUnknown(landed) {
    this._pendingLanded = landed
    this.setData({
      submitting: true, receipt: 'unknown', receiptText: getPlayReceiptState('unknown').label
    })
    const refreshed = await this.refreshCard()
    if (!refreshed) {
      this.setData({ receiptText: '还是没核对上,网络恢复后点这里再试 · 期间请勿重复提交' })
      return
    }
    const ok = landed()
    this.setData({
      submitting: false,
      receipt: ok ? 'confirmed' : 'failed',
      receiptText: ok ? '' : getPlayReceiptState('failed').readerLabel
    })
    if (ok) toast('刚才那一笔已经记下了')
  },

  /** unknown 提示条上的「再核对一次」——只重读,永不重写。 */
  retryReceiptReadback() {
    if (this.data.receipt !== 'unknown') return
    this._resolveUnknown(this._pendingLanded || (() => false))
  },

  _hasRecord(offerId) {
    const records = (this.data.card && this.data.card.records) || []
    return records.some((item) => String(item.offerId) === String(offerId))
  },

  _hasAnswer(stage, value) {
    const answers = (this.data.card && this.data.card.answers) || []
    return answers.some((item) => item.answerStage === stage
      && String(item.answerValue || '').trim() === String(value || '').trim())
  },

  async refreshCard() {
    const res = await request('/api/circle-theme/session/' + this._sessionId + '/card', 'GET', {})
    if (res.code != '200') return false
    const card = this.decorateCard(res.data, this._themeCode, this.data.offers)
    const offers = this.decorateOffers(this.data.offers, card)
    const readOnly = this.data.readOnly || card.completed
    this.setData({
      card,
      offers,
      readOnly,
      interactions: readOnly ? [] : this.buildInteractions(this._themeCode, offers, card)
    })
    return true
  },

  onShareAppMessage() {
    return {
      title: '一起加入「' + (this.data.theme ? this.data.theme.name : '自由探索') + '」',
      path: '/pages/play/circle/index?topicId=' + this._topicId
        + '&themeCode=' + this._themeCode + '&inviteCode=' + (this.data.card && this.data.card.inviteCode)
    }
  }
})
