'use strict'

const toast = require('../../../utils/toast.js');
const modal = require('../../../utils/modal.js')
const { DYN_TTL_MS } = require('../../../utils/verification-scan.js');
const app = getApp()
const merchantTheme = require('../../../utils/merchant-theme.js')
const { createGameSessionClient } = require('../../../utils/game-session-client.js')
const { createWriteActionWorkflow } = require('../../../utils/write-action-workflow.js')
const {
  normalizeMerchantProjection,
  summarizeMerchantProjection,
  buildStationAcceptCommand,
  buildStationDeclineCommand,
  buildStationReadyCommand,
  buildStationPauseCommand,
  buildStationResumeCommand,
  buildVerifySubmissionCommand,
} = require('../utils/game-session-merchant.js')

const PAUSE_REASONS = [
  { code: 'CAPACITY', label: '现场满员' },
  { code: 'STAFF', label: '人员暂时离岗' },
  { code: 'EQUIPMENT', label: '设备或道具异常' },
  { code: 'EMERGENCY', label: '现场突发情况' },
]

const DECLINE_REASONS = [
  { code: 'SCHEDULE_CONFLICT', label: '档期冲突' },
  { code: 'RESOURCE_UNAVAILABLE', label: '现场资源不足' },
  { code: 'LOCATION_UNSUITABLE', label: '本站暂不适合承接' },
]

const REJECT_REASONS = [
  { code: 'ANSWER_MISMATCH', label: '答案不匹配' },
  { code: 'EVIDENCE_UNCLEAR', label: '凭证无法辨认' },
  { code: 'DUPLICATE_SUBMISSION', label: '重复提交' },
]

const ACTION_TEXT = {
  STATION_ACCEPT: '接受邀请',
  STATION_DECLINE: '拒绝邀请',
  STATION_READY: '准备完成',
  STATION_PAUSE: '暂停接待',
  STATION_RESUME: '恢复接待',
  VERIFY_SUBMISSION: '核验提交',
}

const UNKNOWN_WRITE_STORAGE_PREFIX = 'merchant_game_unknown_write_v1_'

function makeRequestId(action, activityId, nodeId) {
  return ['game', String(action || '').toLowerCase(), activityId, nodeId, Date.now(),
    Math.random().toString(36).slice(2, 8)].join('_').slice(0, 64)
}

function parseSubmissionId(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  try {
    const decoded = JSON.parse(text)
    if (decoded && decoded.submissionId != null) return parseSubmissionId(String(decoded.submissionId))
  } catch (e) {}
  const query = text.match(/[?&]submissionId=([1-9]\d{0,18})(?:&|$)/)
  if (query) return query[1]
  return /^[1-9]\d{0,18}$/.test(text) ? text : ''
}

function defaultReadyDraft() {
  return {
    checklist: [], capacity: '', serviceDate: '', serviceStartTime: '', serviceEndTime: '', note: '',
  }
}

function splitServiceDateTime(startAt, endAt) {
  const start = String(startAt || '')
  const end = String(endAt || '')
  const startMatch = start.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/)
  const endMatch = end.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/)
  return {
    serviceDate: startMatch ? startMatch[1] : (endMatch ? endMatch[1] : ''),
    serviceStartTime: startMatch ? startMatch[2] : '',
    serviceEndTime: endMatch ? endMatch[2] : '',
  }
}

function defaultPauseDraft() {
  return {
    reasonCode: '', reasonLabel: '', resumeDate: '', resumeTime: '',
    fallbackPlanCode: '', fallbackPlanVersion: null, fallbackNodeName: '', playerMessage: '',
  }
}

function defaultDeclineDraft() {
  return { reasonCode: '', reason: '' }
}

function defaultVerifyDraft() {
  return { submissionId: '', decision: 'APPROVE', reasonCode: '', reasonLabel: '' }
}

function normalizePersistedCommand(value, activityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const normalizedActivityId = Number(value.activityId)
  const nodeId = Number(value.nodeId)
  const expectedRevision = Number(value.expectedRevision)
  const requestId = String(value.requestId || '')
  const action = String(value.action || '')
  if (normalizedActivityId !== activityId || !Number.isSafeInteger(nodeId) || nodeId <= 0
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId) || !ACTION_TEXT[action]
    || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return null
  return {
    activityId: normalizedActivityId,
    nodeId,
    requestId,
    expectedRevision,
    action,
    payload: JSON.parse(JSON.stringify(value.payload)),
  }
}

function normalizeReceiptIndex(value, activityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const allowedKeys = ['activityId', 'requestId', 'action', 'nodeId', 'expectedRevision']
  if (Object.keys(value).some((key) => allowedKeys.indexOf(key) < 0)) return null
  const normalizedActivityId = Number(value.activityId)
  const nodeId = Number(value.nodeId)
  const expectedRevision = Number(value.expectedRevision)
  const requestId = String(value.requestId || '')
  const action = String(value.action || '')
  if (normalizedActivityId !== activityId || !Number.isSafeInteger(nodeId) || nodeId <= 0
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId) || !ACTION_TEXT[action]) return null
  return { activityId: normalizedActivityId, requestId, action, nodeId, expectedRevision }
}

function matchingTerminalReceipt(result, pending, outcome) {
  const receipt = result && result.receipt
  const command = pending && (pending.command || pending.receiptIndex)
  const revision = Number(receipt && receipt.revision)
  return !!(receipt && command
    && Number.isSafeInteger(Number(receipt.receiptId)) && Number(receipt.receiptId) > 0
    && Number(receipt.activityId) === Number(command.activityId)
    && command.requestId === pending.requestId
    && receipt.requestId === pending.requestId
    && command.action === pending.action
    && receipt.action === pending.action
    && receipt.outcome === outcome
    && receipt.revision !== null && receipt.revision !== undefined && receipt.revision !== ''
    && Number.isSafeInteger(revision) && revision >= 0)
    && (result.requestId == null || result.requestId === pending.requestId)
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    viewState: 'loading',
    errorMessage: '',
    stations: [],
    stationIndex: 0,
    station: null,
    summary: null,
    recap: null,
    readyDraft: defaultReadyDraft(),
    serviceTimeShow: false,
    serviceTimeValue: [],
    declineReasons: DECLINE_REASONS,
    declineDraft: defaultDeclineDraft(),
    declineSheetShow: false,
    pauseReasons: PAUSE_REASONS,
    fallbackOptions: [],
    pauseDraft: defaultPauseDraft(),
    pauseSheetShow: false,
    verifyRejectReasons: REJECT_REASONS,
    verifyDraft: defaultVerifyDraft(),
    verifySheetShow: false,
    writeState: 'idle',
    writeMessage: '',
    canRetryUnknownWrite: false,
    recentReceipts: [],
    checkinVisible: false,
    checkinQrState: 'loading',
    checkinQrUrl: '',
    checkinCountdown: 0,
    checkinErr: '',
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad(options) {
    const gd = app.globalData || {}
    const activityId = Number(options && options.activityId)
    const requestedNodeId = Number(options && options.nodeId)
    // 承接页「更多 → 暂停接待」直接送到这一步:那一行点的就是这件事,
    // 落地后再让人在本页自己找一遍按钮是白绕一圈。station 就绪时才兑现(见 _showStation)。
    this._focusPause = !!(options && options.focus === 'pause')
    this._activityId = Number.isSafeInteger(activityId) && activityId > 0 ? activityId : 0
    this._requestedNodeId = Number.isSafeInteger(requestedNodeId) && requestedNodeId > 0 ? requestedNodeId : 0
    this._projection = null
    this._pendingWrite = null
    this._errorReasonCode = ''
    this.setData({
      statusBarHeight: gd.statusBarHeight || 20,
      navBarHeight: gd.navBarHeight || 44,
    })
    this._client = createGameSessionClient({ sendRequest: app.sendRequest.bind(app) })
    this._writeWorkflow = createWriteActionWorkflow({ deadlineMs: 15000 })
    if (!this._activityId) {
      this._errorReasonCode = 'GAME_ACTIVITY_ID_REQUIRED'
      this.setData({
        viewState: 'business-error',
        errorMessage: '页面参数不完整，请从商家项目卡重新进入',
      })
      return
    }
    this._restorePendingWrite()
    this.load()
  },

  onShow() { merchantTheme.merchantPageShow() },
  onHide() { merchantTheme.merchantPageRestore() },
  onUnload() {
    merchantTheme.merchantPageRestore()
    this._loadToken = (this._loadToken || 0) + 1
    this._checkinEpoch = (this._checkinEpoch || 0) + 1
    this.clearCheckinTimer()
    if (this._loadTask && typeof this._loadTask.abort === 'function') this._loadTask.abort()
    if (this._receiptTask && typeof this._receiptTask.abort === 'function') this._receiptTask.abort()
    if (this._retryTask && typeof this._retryTask.abort === 'function') this._retryTask.abort()
    if (this._writeWorkflow) this._writeWorkflow.destroy()
  },

  retryLoad() { this.load() },

  load() {
    const token = (this._loadToken || 0) + 1
    this._loadToken = token
    this._errorReasonCode = ''
    this.setData({ viewState: 'loading', errorMessage: '' })
    const task = this._client.loadProjection('merchant', this._activityId)
    this._loadTask = task
    task.then((result) => {
      if (token !== this._loadToken) return
      this._loadTask = null
      if (result.status !== 'ready') {
        this._errorReasonCode = result.reasonCode || ''
        this._projection = null
        this.setData({
          viewState: result.status === 'network-error' ? 'network-error' : 'business-error',
          errorMessage: result.message || '本站运行状态暂时不可用',
          stations: [],
          station: null,
          summary: null,
          recap: null,
        })
        return
      }
      const projection = normalizeMerchantProjection(result.data)
      if (!projection.enabled) {
        this._errorReasonCode = projection.reason
        this._projection = null
        this.setData({
          viewState: 'business-error',
          errorMessage: '本站运行数据不完整，请稍后重试',
          stations: [],
          station: null,
          summary: null,
          recap: null,
        })
        return
      }
      const summary = summarizeMerchantProjection(projection)
      if (!projection.stations.length) {
        this._projection = projection
        this.setData({
          viewState: 'empty', stations: [], station: null, summary, recap: null,
        })
        return
      }
      let index = projection.stations.findIndex(item => item.nodeId === this._requestedNodeId)
      if (index < 0) index = Math.min(this.data.stationIndex, projection.stations.length - 1)
      this._showStation(projection, index, summary)
    })
  },

  _showStation(projection, index, summary) {
    const station = projection.stations[index]
    const fallbackOptions = (projection.fallbackOptions || []).filter((item) => item.sourceNodeId === station.nodeId)
    const serviceDraft = splitServiceDateTime(station.serviceStartAt, station.serviceEndAt)
    const checklist = station.preparationChecklist.map(item => ({
      code: item.code, label: item.label, checked: item.checked,
    }))
    this._projection = projection
    this.setData({
      viewState: 'ready',
      stations: projection.stations,
      stationIndex: index,
      station,
      fallbackOptions,
      summary: summary || summarizeMerchantProjection(projection),
      recap: station.recap,
      readyDraft: {
        checklist,
        capacity: station.capacity == null ? '' : String(station.capacity),
        serviceDate: serviceDraft.serviceDate,
        serviceStartTime: serviceDraft.serviceStartTime,
        serviceEndTime: serviceDraft.serviceEndTime,
        note: '',
      },
    })
    if (this._focusPause) {
      this._focusPause = false
      // canPause 为假就不弹,并说明为什么 —— 静默不弹会让人以为点错了行
      if (!this.openPauseSheet()) toast('本站现在不能暂停', { icon: 'none' })
    }
  },

  onStationSelect(event) {
    if (this.data.writeState !== 'idle') return
    const index = Number(event.detail && event.detail.value)
    if (!Number.isSafeInteger(index) || !this._projection || !this._projection.stations[index]) return
    this._showStation(this._projection, index, this.data.summary)
  },

  onChecklistToggle(event) {
    if (!this.data.station || !this.data.station.canReady || this.data.writeState !== 'idle') return
    const index = Number(event.currentTarget.dataset.index)
    const checklist = this.data.readyDraft.checklist.map((item, itemIndex) => Object.assign({}, item, {
      checked: itemIndex === index ? !item.checked : item.checked,
    }))
    this.setData({ readyDraft: Object.assign({}, this.data.readyDraft, { checklist }) })
  },

  onCapacityInput(event) {
    this.setData({ readyDraft: Object.assign({}, this.data.readyDraft, { capacity: event.detail.value }) })
  },
  onServiceDateChange(event) {
    this.setData({ readyDraft: Object.assign({}, this.data.readyDraft, { serviceDate: event.detail.value }) })
  },
  /* 服务时段从两个独立的时间滚轮换成一次选完 —— 原来「结束早于开始」没有任何拦截,
     而 serviceStartAt/serviceEndAt 是直接拼给后端的。校验现在收在 cy-time-range 里。 */
  openServiceTime() {
    const d = this.data.readyDraft
    this.setData({
      serviceTimeValue: [d.serviceStartTime || '', d.serviceEndTime || ''],
      serviceTimeShow: true,
    })
  },
  closeServiceTime() { this.setData({ serviceTimeShow: false }) },
  onServiceTimeConfirm(event) {
    const v = event.detail.value || []
    this.setData({
      readyDraft: Object.assign({}, this.data.readyDraft, {
        serviceStartTime: v[0] || '', serviceEndTime: v[1] || '',
      }),
      serviceTimeShow: false,
    })
  },
  onReadyNoteInput(event) {
    this.setData({ readyDraft: Object.assign({}, this.data.readyDraft, { note: event.detail.value }) })
  },

  acceptStation() {
    if (!this.data.station || !this.data.station.canAccept || this.data.writeState !== 'idle') return false
    const requestId = makeRequestId('accept', this._activityId, this.data.station.nodeId)
    try {
      return this._submitCommand(buildStationAcceptCommand(
        this._projection, this.data.station, requestId,
      ))
    } catch (e) {
      return false
    }
  },

  openDeclineSheet() {
    if (!this.data.station || !this.data.station.canDecline || this.data.writeState !== 'idle') return false
    this.setData({ declineSheetShow: true, declineDraft: defaultDeclineDraft() })
    return true
  },
  closeDeclineSheet() {
    if (this.data.writeState === 'submitting') return
    this.setData({ declineSheetShow: false })
  },
  onDeclineReasonTap(event) {
    const code = event.currentTarget.dataset.code
    const selected = DECLINE_REASONS.find(item => item.code === code)
    if (!selected) return
    this.setData({ declineDraft: { reasonCode: selected.code, reason: selected.label } })
  },
  submitDecline() {
    if (!this.data.station || this.data.writeState !== 'idle') return false
    try {
      const requestId = makeRequestId('decline', this._activityId, this.data.station.nodeId)
      return this._submitCommand(buildStationDeclineCommand(
        this._projection, this.data.station, this.data.declineDraft, requestId,
      ))
    } catch (e) {
      toast('请选择拒绝原因')
      return false
    }
  },

  submitReady() {
    if (!this.data.station) return false
    try {
      const requestId = makeRequestId('ready', this._activityId, this.data.station.nodeId)
      const command = buildStationReadyCommand(this._projection, this.data.station, {
        checklist: this.data.readyDraft.checklist,
        capacity: this.data.readyDraft.capacity,
        serviceStartAt: [this.data.readyDraft.serviceDate, this.data.readyDraft.serviceStartTime].filter(Boolean).join(' '),
        serviceEndAt: [this.data.readyDraft.serviceDate, this.data.readyDraft.serviceEndTime].filter(Boolean).join(' '),
        note: this.data.readyDraft.note,
      }, requestId)
      return this._submitCommand(command)
    } catch (e) {
      toast('请勾完清单并填好容量与时段')
      return false
    }
  },

  openPauseSheet() {
    if (!this.data.station || !this.data.station.canPause || this.data.writeState !== 'idle') return false
    this.setData({ pauseSheetShow: true, pauseDraft: defaultPauseDraft() })
    return true
  },
  closePauseSheet() {
    if (this.data.writeState === 'submitting') return
    this.setData({ pauseSheetShow: false })
  },
  onPauseReasonTap(event) {
    const code = event.currentTarget.dataset.code
    const selected = PAUSE_REASONS.find(item => item.code === code)
    if (!selected) return
    this.setData({ pauseDraft: Object.assign({}, this.data.pauseDraft, {
      reasonCode: selected.code, reasonLabel: selected.label,
    }) })
  },
  onResumeDateChange(event) {
    this.setData({ pauseDraft: Object.assign({}, this.data.pauseDraft, { resumeDate: event.detail.value }) })
  },
  onResumeTimeChange(event) {
    this.setData({ pauseDraft: Object.assign({}, this.data.pauseDraft, { resumeTime: event.detail.value }) })
  },
  onFallbackChange(event) {
    const index = Number(event.detail && event.detail.value)
    const selected = Number.isSafeInteger(index) ? this.data.fallbackOptions[index] : null
    if (!selected) return
    this.setData({ pauseDraft: Object.assign({}, this.data.pauseDraft, {
      fallbackPlanCode: selected.planCode,
      fallbackPlanVersion: selected.planVersion,
      fallbackNodeName: selected.nodeName,
      playerMessage: selected.playerMessage,
    }) })
  },
  submitPause() {
    if (!this.data.station || this.data.writeState !== 'idle') return false
    try {
      const requestId = makeRequestId('pause', this._activityId, this.data.station.nodeId)
      const command = buildStationPauseCommand(this._projection, this.data.station, {
        reasonCode: this.data.pauseDraft.reasonCode,
        reason: this.data.pauseDraft.reasonLabel,
        resumeEta: [this.data.pauseDraft.resumeDate, this.data.pauseDraft.resumeTime].filter(Boolean).join(' '),
        fallbackPlanCode: this.data.pauseDraft.fallbackPlanCode,
        fallbackPlanVersion: this.data.pauseDraft.fallbackPlanVersion,
      }, requestId)
      if (command.payload.fallbackPlanCode) return this._submitCommand(command)
      // R9-38:没选备用方案也能停,但玩家那边不会被引导去别的站 —— 停之前把这件事说清楚。
      modal.show({
        title: '不设备用方案，直接暂停？',
        content: '玩家会看到本站暂停、暂停原因和预计恢复时间，不会被引导到其他站点；如需退款请联系平台客服。',
        confirmText: '确认暂停',
        cancelText: '再想想',
        success: (r) => { if (r && r.confirm) this._submitCommand(command) },
      })
      return true
    } catch (e) {
      toast('请选暂停原因和预计恢复时间')
      return false
    }
  },

  resumeStation() {
    if (!this.data.station || !this.data.station.canResume || this.data.writeState !== 'idle') return false
    const requestId = makeRequestId('resume', this._activityId, this.data.station.nodeId)
    try {
      return this._submitCommand(buildStationResumeCommand(
        this._projection, this.data.station, requestId,
      ))
    } catch (e) {
      return false
    }
  },

  scanSubmission() {
    if (!this.data.station || !this.data.station.canVerify || this.data.writeState !== 'idle') return false
    wx.scanCode({
      scanType: ['qrCode'],
      success: (result) => {
        const submissionId = parseSubmissionId(result && result.result)
        if (!submissionId) {
          toast('这不是可核验的游戏提交码')
          return
        }
        this._openVerificationSheet(submissionId)
      },
      fail() {},
    })
    return true
  },
  openManualVerification() {
    if (!this.data.station || !this.data.station.canVerify || this.data.writeState !== 'idle') return false
    this._openVerificationSheet('')
    return true
  },

  showLiveCheckin() {
    if (!this.data.station || !this.data.station.playable) return false
    this.setData({ checkinVisible: true })
    this.issueLiveCheckin()
    return true
  },

  closeLiveCheckin() {
    this._checkinEpoch = (this._checkinEpoch || 0) + 1
    this.clearCheckinTimer()
    this.setData({
      checkinVisible: false,
      checkinQrState: 'loading',
      checkinQrUrl: '',
      checkinCountdown: 0,
      checkinErr: '',
    })
  },

  clearCheckinTimer() {
    if (this._checkinTimer) {
      clearInterval(this._checkinTimer)
      this._checkinTimer = null
    }
  },

  issueLiveCheckin() {
    const that = this
    const nodeId = this.data.station && this.data.station.nodeId
    if (!this.data.checkinVisible || !nodeId) return
    const epoch = (this._checkinEpoch || 0) + 1
    this._checkinEpoch = epoch
    this.clearCheckinTimer()
    this.setData({ checkinQrState: 'loading', checkinQrUrl: '', checkinCountdown: 0, checkinErr: '' })
    app.sendRequest({
      url: '/api/merchant/chapter-node/live-checkin-code',
      method: 'POST',
      data: { nodeId },
      hideLoading: true,
      success(res) {
        if (epoch !== that._checkinEpoch) return
        const data = res && res.data
        if (res && (res.code === 200 || res.code === '200') && data && data.code) {
          that.setData({
            checkinQrState: 'ready',
            checkinQrUrl: data.qrcodeUrl || '',
            checkinErr: '',
          })
          that.startCheckinCountdown(Math.floor((data.ttlMs || DYN_TTL_MS) / 1000))
          return
        }
        that.setData({ checkinQrState: 'error', checkinErr: (res && res.msg) || '打卡码暂时没能生成' })
      },
      fail() {
        if (epoch !== that._checkinEpoch) return
        that.setData({ checkinQrState: 'error', checkinErr: '网络异常，请重试' })
      },
      successStatusAbnormal(res) {
        if (epoch !== that._checkinEpoch) return
        that.setData({ checkinQrState: 'error', checkinErr: (res && res.msg) || '打卡码暂时没能生成' })
      },
    })
  },

  startCheckinCountdown(seconds) {
    const that = this
    this.setData({ checkinCountdown: seconds })
    this._checkinTimer = setInterval(function () {
      const remaining = that.data.checkinCountdown - 1
      if (remaining <= 0) {
        that.issueLiveCheckin()
        return
      }
      that.setData({ checkinCountdown: remaining })
    }, 1000)
  },
  _openVerificationSheet(submissionId) {
    this.setData({
      verifySheetShow: true,
      verifyDraft: Object.assign(defaultVerifyDraft(), { submissionId: String(submissionId || '') }),
    })
  },
  onSubmissionIdInput(event) {
    this.setData({ verifyDraft: Object.assign({}, this.data.verifyDraft, {
      submissionId: String((event.detail && event.detail.value) || '').trim(),
    }) })
  },
  closeVerifySheet() {
    if (this.data.writeState === 'submitting') return
    this.setData({ verifySheetShow: false })
  },
  onVerifyDecisionTap(event) {
    const decision = event.currentTarget.dataset.decision
    if (decision !== 'APPROVE' && decision !== 'REJECT') return
    this.setData({ verifyDraft: Object.assign({}, this.data.verifyDraft, {
      decision, reasonCode: '', reasonLabel: '',
    }) })
  },
  onRejectReasonTap(event) {
    const code = event.currentTarget.dataset.code
    const selected = REJECT_REASONS.find(item => item.code === code)
    if (!selected) return
    this.setData({ verifyDraft: Object.assign({}, this.data.verifyDraft, {
      reasonCode: selected.code, reasonLabel: selected.label,
    }) })
  },
  submitVerification() {
    if (!this.data.station || this.data.writeState !== 'idle') return false
    try {
      const requestId = makeRequestId('verify', this._activityId, this.data.station.nodeId)
      const command = buildVerifySubmissionCommand(this._projection, this.data.station, this.data.verifyDraft, requestId)
      return this._submitCommand(command)
    } catch (e) {
      toast('请选择核验结论；驳回时需选择原因')
      return false
    }
  },

  _submitCommand(command) {
    if (this.data.writeState !== 'idle') return false
    const persistedCommand = normalizePersistedCommand(command, this._activityId)
    if (!persistedCommand) return false
    const key = persistedCommand.action + ':' + persistedCommand.nodeId
      + (persistedCommand.payload.submissionId ? ':' + persistedCommand.payload.submissionId : '')
    if (this._writeWorkflow.isBusy(key)) return false
    const pendingWrite = {
      key, requestId: persistedCommand.requestId, action: persistedCommand.action, nodeId: persistedCommand.nodeId,
      expectedRevision: persistedCommand.expectedRevision,
      submissionId: persistedCommand.payload.submissionId || '', command: persistedCommand,
    }
    this._pendingWrite = pendingWrite
    this.setData({ writeState: 'submitting', writeMessage: '' })
    if (!this._persistPendingWrite(pendingWrite)) {
      this._pendingWrite = null
      this.setData({
        writeState: 'idle',
        writeMessage: '无法安全保存本次操作，请检查小程序存储后重试',
        canRetryUnknownWrite: false,
      })
      toast('无法安全保存，请稍后重试')
      return false
    }
    const submitted = this._writeWorkflow.run(key, (done) => {
      const task = this._client.submitAction('merchant', persistedCommand)
      task.then(done)
      return task
    }, (result) => {
      const applied = result && result.status === 'success'
        && matchingTerminalReceipt(result, pendingWrite, 'APPLIED')
      const failed = result && result.status === 'business-error'
        && matchingTerminalReceipt(result, pendingWrite, 'FAILED')
      if (applied || failed) {
        this._pendingWrite = null
        this._clearPersistedWrite()
        this._recordReceipt(result.receipt)
        this.setData({
          writeState: 'idle', writeMessage: failed ? (result.message || '操作未能完成') : '',
          canRetryUnknownWrite: false,
          declineSheetShow: false, pauseSheetShow: false, verifySheetShow: false,
        })
        this.load()
        return
      }
      this.setData({
        writeState: 'unknown',
        writeMessage: (result && result.message) || '操作结果待确认，请勿重复提交',
        canRetryUnknownWrite: true,
        declineSheetShow: false,
        pauseSheetShow: false,
        verifySheetShow: false,
      })
    })
    if (!submitted) {
      this._pendingWrite = null
      this._clearPersistedWrite()
      this.setData({ writeState: 'idle', canRetryUnknownWrite: false })
    }
    return submitted
  },

  confirmUnknownWrite() {
    const pending = this._pendingWrite
    if (this.data.writeState !== 'unknown' || !pending || this._receiptReading) return false
    this._receiptReading = true
    this.setData({ writeMessage: '正在确认操作结果…' })
    const task = this._client.readReceipt(this._activityId, pending.requestId)
    this._receiptTask = task
    task.then((result) => {
      this._receiptReading = false
      this._receiptTask = null
      const applied = result.status === 'matched' && matchingTerminalReceipt(result, pending, 'APPLIED')
      const failed = result.status === 'business-error' && matchingTerminalReceipt(result, pending, 'FAILED')
      if (!applied && !failed) {
        // 登录过期、临时权限失败等无 receipt 的业务错误，不能证明原写操作没有落地。
        // 只有与原命令精确匹配的 APPLIED/FAILED 终态回执才能解除 unknown 锁。
        const message = result.status === 'pending'
          ? '操作仍在处理中，请稍后再次确认'
          : (result.message || '结果暂未确认，请勿重复提交')
        this.setData({ writeState: 'unknown', writeMessage: message })
        return
      }
      this._pendingWrite = null
      this._writeWorkflow.reset(pending.key)
      this._clearPersistedWrite()
      this._recordReceipt(result.receipt)
      this.setData({
        writeState: 'idle', writeMessage: failed ? (result.message || '操作未能完成') : '',
        canRetryUnknownWrite: false,
        declineSheetShow: false, pauseSheetShow: false, verifySheetShow: false,
      })
      this.load()
    })
    return true
  },

  retryUnknownWrite() {
    const pending = this._pendingWrite
    if (this.data.writeState !== 'unknown' || !pending || !pending.command || this._retrying) return false
    if (!this._persistPendingWrite(pending)) {
      this.setData({
        writeState: 'unknown',
        writeMessage: '无法安全保存重试状态；原操作仍待确认',
        canRetryUnknownWrite: true,
      })
      toast('无法安全保存，未发送重试')
      return false
    }
    this._retrying = true
    this.setData({ writeState: 'submitting', writeMessage: '正在用原请求号重试…' })
    const task = this._client.submitAction('merchant', pending.command)
    this._retryTask = task
    task.then((result) => {
      this._retrying = false
      this._retryTask = null
      const applied = result.status === 'success' && matchingTerminalReceipt(result, pending, 'APPLIED')
      const failed = result.status === 'business-error' && matchingTerminalReceipt(result, pending, 'FAILED')
      if (applied || failed) {
        this._pendingWrite = null
        this._writeWorkflow.reset(pending.key)
        this._clearPersistedWrite()
        this._recordReceipt(result.receipt)
        this.setData({
          writeState: 'idle', writeMessage: failed ? (result.message || '原操作未能完成') : '',
          canRetryUnknownWrite: false,
          declineSheetShow: false, pauseSheetShow: false, verifySheetShow: false,
        })
        this.load()
        return
      }
      this.setData({
        writeState: 'unknown', writeMessage: result.message || '重试结果仍待确认，请勿另起请求',
        canRetryUnknownWrite: true,
      })
    }).catch(() => {
      this._retrying = false
      this._retryTask = null
      this.setData({
        writeState: 'unknown', writeMessage: '重试结果仍待确认，请勿另起请求',
        canRetryUnknownWrite: true,
      })
    })
    return true
  },

  _storageKey() {
    const memberId = app.getUserID && app.getUserID()
    return memberId === null || memberId === undefined || memberId === '' || !this._activityId
      ? '' : UNKNOWN_WRITE_STORAGE_PREFIX + 'm' + memberId + '_a' + this._activityId
  },

  _persistPendingWrite(pending) {
    const key = this._storageKey()
    if (!key) return false
    try {
      wx.setStorageSync(key, {
        activityId: this._activityId,
        requestId: pending.requestId,
        action: pending.action,
        nodeId: pending.nodeId,
        expectedRevision: pending.expectedRevision,
      })
      return true
    } catch (e) {
      return false
    }
  },

  _clearPersistedWrite() {
    try {
      const key = this._storageKey()
      if (key) wx.removeStorageSync(key)
      const legacyKey = UNKNOWN_WRITE_STORAGE_PREFIX + this._activityId
      if (wx.getStorageSync(legacyKey)) wx.removeStorageSync(legacyKey)
    } catch (e) {}
  },

  _restorePendingWrite() {
    let saved
    try {
      wx.removeStorageSync(UNKNOWN_WRITE_STORAGE_PREFIX + this._activityId)
      const key = this._storageKey()
      saved = key ? wx.getStorageSync(key) : null
    } catch (e) { return false }
    const activityId = Number(saved && saved.activityId)
    const nodeId = Number(saved && saved.nodeId)
    const requestId = String((saved && saved.requestId) || '')
    const action = String((saved && saved.action) || '')
    const receiptIndex = normalizeReceiptIndex(saved, this._activityId)
    if (activityId !== this._activityId || !Number.isSafeInteger(nodeId) || nodeId <= 0
      || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId) || !ACTION_TEXT[action] || !receiptIndex) {
      this._clearPersistedWrite()
      return false
    }
    const key = action + ':' + nodeId
    const pendingWrite = {
      key, requestId, action, nodeId, expectedRevision: receiptIndex.expectedRevision,
      command: null, receiptIndex,
    }
    this._pendingWrite = pendingWrite
    this._writeWorkflow.hold(key)
    this.setData({
      writeState: 'unknown',
      writeMessage: '上次操作结果待确认，请先确认结果',
      canRetryUnknownWrite: false,
    })
    return true
  },

  _recordReceipt(receipt) {
    const row = {
      receiptId: receipt.receiptId,
      requestId: receipt.requestId,
      action: receipt.action,
      actionText: ACTION_TEXT[receipt.action] || receipt.action,
      outcomeText: receipt.outcome === 'APPLIED' ? '已应用' : (receipt.outcome === 'FAILED' ? '未生效' : '待确认'),
      revision: receipt.revision,
      replayed: receipt.replayed === true,
    }
    const rows = [row].concat(this.data.recentReceipts.filter(item => item.requestId !== row.requestId)).slice(0, 5)
    this.setData({ recentReceipts: rows })
  },
})

module.exports = { parseSubmissionId }
