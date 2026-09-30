/** 探店日商家页：只承载到店、照片、核销凭证与记录，不承载玩法。 */
const cyModal = require('../../../utils/modal.js');
const app = getApp()
const { resolveOpenState } = require('../utils/play-open-state.js')
const { resolveMenuChrome } = require('../../../utils/nav-safe-area.js')
const { getPlayReceiptState } = require('../../../utils/play-state-contract.js')
const CONSENT_DOC = 'merchant_onsite_data_sharing'
const CONSENT_SCENE = 'merchant_redeem'
const CONSENT_SCOPE = 'MERCHANT'

function request(url, data, opts) {
  return new Promise((resolve) => {
    // /api/compliance 这两个端点是 @RequestBody,必须发 JSON;缺 header 会被封装当
    // urlencoded 发出去,后端 415 被兜成 200+code500,承诺记录静默不落库(见 consent-client.js:36 同款注释)。
    const json = opts && opts.json
    app.sendRequest({
      url, method: 'POST', data: json ? JSON.stringify(data) : data, hideLoading: true,
      header: json ? { 'Content-Type': 'application/json' } : undefined,
      success: (res) => resolve(res || {}),
      // 5xx / 408 = 请求可能已经在服务端落地,结果未知,必须和断网走同一条 unknown 回读;
      // 4xx 才是明确的业务/参数失败。原来一律归为普通失败,于是网关超时会被说成
      // 「再想想,答案就在店里」——把丢响应讲成答错了。
      successStatusAbnormal: (res, statusCode) => resolve(Object.assign({}, res || {}, {
        code: 'http_error',
        netFail: Number(statusCode) >= 500 || Number(statusCode) === 408,
        msg: (res && res.msg) || '暂时没有收到结果',
      })),
      fail: () => resolve({ code: 'fail', netFail: true, msg: '网络异常，现场记录暂未同步' }),
    })
  })
}

function requestCheckin(data) {
  return request('/api/play/checkin', data)
}

function requestPhoto(data) {
  return request('/api/play/photo', data)
}

Page({
  data: {
    node: null, notFound: false, statusBarHeight: 20, regId: 0,
    // sheetTop 兜底 69px(常规机胶囊底+5):.mp-sheet 的 max-height 用它,不能让 calc 引用空值
    chrome: { actionTop: 28, actionRight: 12, contentTop: 76, sheetTop: 69 },
    heroImg: '', busy: false, feedback: '', degradedMessage: '',
    // 写回执态，词典见 utils/play-state-contract.js
    receipt: 'ready',
    merchantConsent: 'UNKNOWN', consentBusy: false,
    // B5 收窄(2026-08-15):扫码进店后的体验层 —— 有游戏弹游戏,无游戏弹任务卡
    game: { show: false, answer: '', choice: '', submitting: false, done: false, resultText: '', errText: '', receipt: 'ready' },
    task: { show: false },
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad(query) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    // 顶边复查(2026-09-18):.mp-sheet 长题面会顶进胶囊行,高度上限须从胶囊实测反算
    try { this.setData({ chrome: resolveMenuChrome(info, wx.getMenuButtonBoundingClientRect()) }) } catch (e) {}
    const pages = getCurrentPages()
    this._prev = pages.length > 1 ? pages[pages.length - 2] : null
    const nodes = (this._prev && this._prev.data && this._prev.data.nodes) || []
    const node = nodes.find((item) => String(item.nodeId) === String(query && query.nodeId))
    if (!node) {
      this.setData({ statusBarHeight: info.statusBarHeight || 20, notFound: true })
      return
    }
    this._session = this._prev && typeof this._prev._sessionParams === 'function'
      ? this._prev._sessionParams() : {}
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      node: Object.assign({}, node, { openText: resolveOpenState(node).openText }),
      regId: (this._prev && this._prev.data && this._prev.data.regId) || 0,
      heroImg: String(node.imgUrl || '').split(',')[0],
      degradedMessage: node.quantityUnavailable ? '现场人数暂时取不到，请以店员安排为准' : '',
    }, () => {
      // 从选店页扫码进来(intro 快捷扫码路径):落地即弹体验层,和页内扫码同一仪式
      if (String(query && query.justScanned) === '1') this._maybeAutoPopup()
    })
    if (node.merchantId) this._loadMerchantConsent()
  },

  /** 扫码成功后的体验层分发:有游戏弹游戏,无游戏弹任务卡;未进店不弹(题面也未下发)。 */
  _maybeAutoPopup() {
    const node = this.data.node
    if (!node || !node.arrived || node.done) return
    // advanced 段玩法的宿主唯一在 pages/play/index —— 本页 index.json 里既没有 cy-playkit 也没有
    // cy-advanced-game,所以这类节点过去一路掉进 else openTaskCard():玩家点了进店,
    // 却开不了这个节点真正配的玩法,只能退回上一页从节点详情卡再点一次「开始任务」。
    // 优先序照抄游玩页 startGame:那边 hasAdvanced 在 vm6/题面之前 early-return,
    // 所以 advanced 与偏好题并存时弹的也是玩法面板,这里必须排在偏好题分支前面才交得对。
    if (node.hasAdvanced) { this.openAdvancedGame(); return }
    if (node.hasGame && Number(node.validationMethod || node.vm) === 6) this.openPreferenceGame()
    else if (node.hasGame && node.question) this.openGame()
    else this.openTaskCard()
  },

  openGame() {
    const node = this.data.node
    if (!node || !node.arrived) { this.setData({ feedback: '先扫店内码进店，再开始任务' }); return }
    if (Number(node.validationMethod || node.vm) === 6) { this.openPreferenceGame(); return }
    if (!node.question) { this.openTaskCard(); return }
    // ★unknown 期间只把弹层重新打开,绝不重置状态:原来这里无条件重建整个 game 对象,
    //   于是「关掉弹层再打开」就把 receipt 抹回 ready、submitting 抹回 false —— 业务锁一键可破,
    //   用户可以在结果未知的情况下再答一次。锁必须只由权威回读解除。
    if (this.data.game.receipt === 'unknown') { this.setData({ 'game.show': true }); return }
    this.setData({ game: { show: true, answer: '', choice: '', submitting: false, done: false, resultText: '', errText: '', receipt: 'ready' } })
  },
  /** 偏好题统一回主游玩页渲染，避免商家页另养一套评分与标签确认 UI。 */
  openPreferenceGame() {
    this._handoffToPlayHost(this.data.node, () => {
      this.setData({ feedback: '偏好题入口没有接上，请返回主题页重试' })
    })
  },
  /** advanced 段玩法同款交接。接不上时退回任务卡 —— 到店后至少还能拍照/核销，不能白屏。 */
  openAdvancedGame() {
    this._handoffToPlayHost(this.data.node, () => this.openTaskCard())
  },
  /** 本页不装玩法组件，凡「玩法不在这张弹层里」的分支都只能 navigateBack 回上一页，
   *  把归一化后的节点（带 hasAdvanced / vm，来自游玩页 normNode）交给它的 startGame。
   *  交接失败不是一句「稍后再试」就完事，unreachable 必须给出还留在本页的退路。 */
  _handoffToPlayHost(node, unreachable) {
    if (!node || !node.arrived) { this.setData({ feedback: '先扫店内码进店，再开始任务' }); return }
    const prev = this._prev
    if (!prev || typeof prev.startGame !== 'function') { unreachable(); return }
    wx.navigateBack({
      delta: 1,
      success: () => prev.startGame(node),
      fail: () => this.setData({ feedback: '返回主题页失败，请稍后重试' }),
    })
  },
  closeGame() {
    const wasDone = this.data.game.done
    this.setData({ 'game.show': false })
    // 游戏答完顺路引到下一步:拍现场凭证(三步条第 2 步)
    if (wasDone && this.data.node && !this.data.node.selfReported) this.openTaskCard()
  },
  onGamePick(e) { this.setData({ 'game.choice': e.currentTarget.dataset.k, 'game.errText': '' }) },
  onGameInput(e) { this.setData({ 'game.answer': e.detail.value, 'game.errText': '' }) },
  async submitGame() {
    const node = this.data.node
    const game = this.data.game
    if (!node || game.submitting || game.done) return
    const vm = Number(node.validationMethod)
    const answer = vm === 3 ? game.choice : String(game.answer || '').trim()
    if (!answer) { this.setData({ 'game.errText': vm === 3 ? '先选一个选项' : '先写下答案' }); return }
    this.setData({ 'game.submitting': true, 'game.errText': '', 'game.receipt': 'submitting' })
    const res = await request('/api/play/answer', Object.assign({}, this._session, { nodeId: node.nodeId, answer }))
    // 响应丢了 ⇒ 结果未知。后端 advanceProgress 按 rows>0 算 firstTime,重发不会重复发奖,
    // 但「重发写请求去试」本身就是不该做的事 —— 改成读 /nodes 的 gameDone 位。
    if (res.netFail) return this._resolveGameUnknown()
    if (!(res.code === 200 || res.code === '200')) {
      this.setData({
        'game.submitting': false, 'game.receipt': 'failed',
        'game.errText': res.msg || '再想想，答案就在店里'
      })
      return
    }
    this._settleGameDone(res.data, res.msg)
  },

  /** 首次完成才显示奖励;重复提交后端返回 firstTime=false 且 xp=0,不许再飞一次「+N 探索值」。 */
  _settleGameDone(data, msg) {
    const payload = data || {}
    const firstTime = payload.firstTime !== false
    const xp = (firstTime && (payload.xp || payload.score)) || 0
    this.setData({
      game: Object.assign({}, this.data.game, {
        submitting: false, done: true, receipt: 'confirmed', errText: '',
        resultText: (msg || (firstTime ? '答对了！' : '该节点已完成'))
          + (xp ? '  +' + xp + ' 探索值' : ''),
        // 不设 reveal:后端对 ③ 一律剥 answerReveal(与 questionAnswer 同档机密),
        // 揭示位在本页已随之删除 —— 留一个恒空的字段会让下一个人以为还有一条能出内容的路。
      }),
    })
  },

  /** 答题 unknown 的权威回读:/api/play/nodes 的 gameDone 位是服务端自己产生的事实。 */
  async _resolveGameUnknown() {
    this.setData({
      'game.submitting': true, 'game.receipt': 'unknown',
      'game.errText': getPlayReceiptState('unknown').label
    })
    const fresh = await this._readbackNode()
    if (!fresh) {
      this.setData({ 'game.errText': '还是没核对上，网络恢复后点这里再试 · 期间请勿重复提交' })
      return
    }
    if (fresh.gameDone) {
      // 已经记上了,但这次读不回本次奖励明细 —— 只报状态,不编造 xp。
      this._settleGameDone({ firstTime: false }, '这道题已经记下了')
      return
    }
    this.setData({
      'game.submitting': false, 'game.receipt': 'failed',
      'game.errText': getPlayReceiptState('failed').readerLabel
    })
  },

  retryGameReadback() {
    if (this.data.game.receipt !== 'unknown') return
    this._resolveGameUnknown()
  },
  openTaskCard() { this.setData({ 'task.show': true }) },
  closeTaskCard() { this.setData({ 'task.show': false }) },
  closeSheets() { this.setData({ 'game.show': false, 'task.show': false }) },
  taskGoPhoto() {
    if (this.data.busy) return
    this.closeTaskCard()
    this.uploadProof()
  },

  goBack() {
    wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: '/pages/play/index' }) })
  },

  openMap() {
    const node = this.data.node
    if (!node || !node.lat || !node.lng) {
      this.setData({ feedback: '这家还没填坐标，暂时不能导航' })
      return
    }
    wx.openLocation({
      latitude: parseFloat(node.lat), longitude: parseFloat(node.lng),
      name: node.name || '目的地', address: node.address || '', scale: 18,
    })
  },

  scanArrival() {
    if (this.data.busy) return
    wx.scanCode({
      onlyFromCamera: true, scanType: ['qrCode'],
      success: (scan) => {
        if (!scan.result) { this.setData({ feedback: '没有识别到门店码' }); return }
        this._submitProof(requestCheckin, Object.assign({}, this._session, { code: scan.result }), '已记录到店', { autoPopup: true })
      },
      fail: (error) => {
        if (!/cancel/i.test((error && error.errMsg) || '')) this.setData({ feedback: '扫码失败，请对准门店二维码重试' })
      },
    })
  },

  uploadProof() {
    if (this.data.busy) return
    app.chooseImage((urls) => {
      if (!urls || !urls.length) { this.setData({ feedback: '没有选中照片' }); return }
      this._submitProof(requestPhoto, Object.assign({}, this._session, {
        nodeId: this.data.node.nodeId, picUrl: urls[0],
      }), '到店照片已记录，可以向店员出示核销码')
    }, 1)
  },

  async _submitProof(sendProof, payload, successMessage, opts) {
    this.setData({ busy: true, feedback: '', degradedMessage: '', receipt: 'submitting' })
    const response = await sendProof(payload)
    if (!(response.code === 200 || response.code === '200')) {
      // netFail = 请求没拿到响应,服务端可能已经写进去了。原来这里 busy:false 就放行了,
      // 一句「请勿重复核销」拦不住手 —— 改成锁着不放,只能由 /api/play/nodes 权威回读解锁。
      if (response.netFail) return this._resolveProofUnknown(opts)
      this.setData({
        busy: false, receipt: 'failed', degradedMessage: '',
        feedback: response.msg || '现场记录失败，请稍后重试',
      })
      return
    }
    const node = Object.assign({}, this.data.node, response.data || {})
    this.setData({ node, busy: false, receipt: 'confirmed', feedback: successMessage }, () => {
      // 扫码进店成功 → 弹体验层(游戏/任务卡),checkin 回包已带题面
      if (opts && opts.autoPopup) this._maybeAutoPopup()
    })
    this._writeBack(node)
  },

  /** unknown 只能由服务端自己产生的事实解除:重新拉 /api/play/nodes,看这个节点到底动没动。 */
  async _resolveProofUnknown(opts) {
    // 记住首次进 unknown 时的 opts:retryProofReadback 是同一次动作的续跑,
    // 不带上它,回读成功后 autoPopup 就再也不会触发。
    if (opts) this._proofUnknownOpts = opts
    const unknown = getPlayReceiptState('unknown')
    this.setData({ busy: true, receipt: 'unknown', feedback: '', degradedMessage: unknown.label })
    const before = this.data.node || {}
    const fresh = await this._readbackNode()
    if (!fresh) {
      this.setData({ degradedMessage: '还是没核对上，网络恢复后点这里再试 · 期间请勿重复核销' })
      return
    }
    const landed = (!!fresh.done && !before.done)
      || (!!fresh.arrived && !before.arrived)
      || (!!fresh.selfReported && !before.selfReported)
    this.setData({
      node: fresh, busy: false,
      receipt: landed ? 'confirmed' : 'failed',
      degradedMessage: '',
      feedback: landed ? '刚才那一步已经记下了' : getPlayReceiptState('failed').readerLabel,
    }, () => {
      const carried = this._proofUnknownOpts
      if (landed) this._proofUnknownOpts = null
      if (landed && carried && carried.autoPopup) this._maybeAutoPopup()
    })
    this._writeBack(fresh)
  },

  /** 重新点一次 unknown 提示条时走这里 —— 只重读，永不重写。 */
  retryProofReadback() {
    if (this.data.receipt !== 'unknown') return
    this._resolveProofUnknown(this._proofUnknownOpts)
  },

  _readbackNode() {
    return new Promise((resolve) => {
      app.sendRequest({
        url: '/api/play/nodes', method: 'GET', hideLoading: true,
        data: this._session || {},
        success: (res) => {
          const ok = res && (res.code === 200 || res.code === '200')
          const rows = (ok && res.data && (res.data.nodes || res.data)) || []
          const hit = (Array.isArray(rows) ? rows : []).find(
            (item) => String(item.nodeId) === String((this.data.node || {}).nodeId))
          resolve(hit ? Object.assign({}, this.data.node, hit) : null)
        },
        fail: () => resolve(null),
      })
    })
  },

  _writeBack(node) {
    if (!this._prev || !this._prev.data) return
    const nodes = (this._prev.data.nodes || []).map((item) =>
      String(item.nodeId) === String(node.nodeId) ? Object.assign({}, item, node) : item)
    this._prev.setData({ nodes })
  },

  async openVerifyCode() {
    if (this.data.consentBusy) return
    if (!this.data.regId) {
      this.setData({ feedback: '从票夹进入后才能出示核销码' })
      return
    }
    const merchantId = this.data.node && this.data.node.merchantId
    if (!merchantId) {
      this.setData({ feedback: '当前门店身份未确认，不能出示核销码' })
      return
    }
    if (this.data.merchantConsent !== 'AGREE') {
      const agreed = await this._confirmMerchantConsent()
      if (!agreed) return
    }
    this._showVerifyCode()
  },

  _showVerifyCode() {
    wx.navigateBack({
      delta: 1,
      success: () => {
        const pages = getCurrentPages()
        const play = pages[pages.length - 1]
        if (play && play.openEntryQr) play.openEntryQr()
      },
      fail: () => this.setData({ feedback: '核销码打开失败，请回票夹重试' }),
    })
  },

  _confirmMerchantConsent() {
    const merchantName = (this.data.node && this.data.node.name) || '当前门店'
    return new Promise((resolve) => {
      cyModal.show({
        title: '仅授权当前门店',
        content: `为现场叫号与核销，同意向「${merchantName}」提供你的姓名、头像、到店/核销状态和报名手机号。不会授权其他门店，可随时撤回。`,
        confirmText: '同意并继续',
        success: async (modal) => {
          if (!modal.confirm) { resolve(false); return }
          resolve(await this._writeAndReadbackConsent('AGREE'))
        },
        fail: () => { this.setData({ feedback: '未取得当前门店授权，核销码未打开' }); resolve(false) },
      })
    })
  },

  async revokeMerchantConsent() {
    if (this.data.consentBusy) return
    const ok = await this._writeAndReadbackConsent('REVOKE')
    if (ok) this.setData({ feedback: '已撤回当前门店授权，门店名单将不再显示你' })
  },

  async _loadMerchantConsent() {
    const response = await this._readbackConsent()
    if (!response.ok) {
      this.setData({ merchantConsent: 'UNAVAILABLE' })
      return
    }
    this.setData({ merchantConsent: response.eventType || 'NONE' })
  },

  async _writeAndReadbackConsent(eventType) {
    const merchantId = this.data.node && this.data.node.merchantId
    if (!merchantId || this.data.consentBusy) return false
    this.setData({ consentBusy: true, feedback: '' })
    const payload = this._consentPayload()
    const write = await request('/api/compliance/consents', Object.assign({}, payload, {
      eventType,
      requestId: `merchant-${eventType.toLowerCase()}-${merchantId}-${Date.now()}`,
    }), { json: true })
    if (!(write.code === 200 || write.code === '200')) {
      this.setData({ consentBusy: false, merchantConsent: 'UNAVAILABLE', feedback: write.msg || '门店授权写入失败，核销码未打开' })
      return false
    }
    const readback = await this._readbackConsent()
    const matched = readback.ok && readback.eventType === eventType
      && String(readback.scopeId) === String(merchantId) && readback.scopeType === CONSENT_SCOPE
    this.setData({
      consentBusy: false,
      merchantConsent: matched ? eventType : 'UNAVAILABLE',
      feedback: matched ? '' : '门店授权状态未确认，核销码未打开',
    })
    return matched
  },

  async _readbackConsent() {
    const merchantId = this.data.node && this.data.node.merchantId
    if (!merchantId) return { ok: false }
    const response = await request('/api/compliance/consents/latest', this._consentPayload(), { json: true })
    if (!(response.code === 200 || response.code === '200')) return { ok: false }
    const data = response.data || {}
    if (!data.eventType) return { ok: true, eventType: 'NONE', scopeId: merchantId, scopeType: CONSENT_SCOPE }
    return Object.assign({ ok: true }, data)
  },

  _consentPayload() {
    return {
      docType: CONSENT_DOC,
      scene: CONSENT_SCENE,
      scopeType: CONSENT_SCOPE,
      scopeId: this.data.node && this.data.node.merchantId,
    }
  },
})
