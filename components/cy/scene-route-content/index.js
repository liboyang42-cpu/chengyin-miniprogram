'use strict'

const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const app = getApp()
// 提现三入口共用的校验/单独同意真源。本组件的 member-withdraw 场景原先只校验「金额 > 0」,
// 空姓名 / 空卡号 / 非法手机号 / 超过余额都能提交上去(另两个入口都拦)。
const withdrawForm = require('../../../utils/withdraw-form.js')
// 2026-09-15 起 member-withdraw 场景不再建单:平台不打款,一律弹平台客服微信线下处理。
const withdrawCs = require('../../../utils/withdraw-cs.js')
// RUN-52 发布者实名闸(club-apply / merchant-apply 两张场景表单共用)
const publisherIdentity = require('../../../utils/publisher-identity.js')
const merchantAccessPolicy = require('../../../utils/merchant-access-policy.js')

const isOk = (res) => res && (res.code === 200 || res.code === '200')

function payloadOf(res) {
  return res && res.data !== undefined ? res.data : null
}

function rowsOf(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return null
  for (const key of ['rows', 'list', 'records', 'items', 'infoList', 'hotList', 'recommendList', 'mustPlayList', 'templates', 'owned', 'nodes']) {
    if (Object.prototype.hasOwnProperty.call(data, key)) return Array.isArray(data[key]) ? data[key] : null
  }
  if (data.data && data.data !== data) return rowsOf(data.data)
  return []
}

function valueOf(item, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const value = item && item[keys[i]]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return ''
}

function idOf(item) {
  return valueOf(item, ['id', 'registrationId', 'orderId', 'topicId', 'activityId', 'poiId', 'clubId'])
}

function dateText(value) {
  if (!value) return ''
  return String(value).replace('T', ' ').slice(0, 16)
}

function amountText(value) {
  if (value === null || value === undefined || value === '') return ''
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : ''
}

function nameOf(item) {
  return valueOf(item, ['name', 'title', 'topicName', 'activityName', 'templateName', 'merchantName', 'couponName']) || '记录名称待确认'
}

function normalizeRows(rows, sceneId) {
  return rows.map((item, index) => ({
    key: idOf(item) || ('row-' + index),
    id: idOf(item),
    title: nameOf(item),
    subtitle: valueOf(item, ['description', 'topicDesc', 'activityDesc', 'remark', 'reason', 'nodeName', 'merchantName']) || dateText(valueOf(item, ['createTime', 'startDate', 'updateTime'])),
    amount: amountText(valueOf(item, ['amount', 'changeBalance', 'receivedAmount', 'money', 'income', 'totalAmount'])),
    status: valueOf(item, ['statusText', 'displayStatus', 'stateText', 'refundStateText', 'useStatusText', 'typeText']),
    date: dateText(valueOf(item, ['createTime', 'orderTime', 'startDate', 'updateTime'])),
    poiId: valueOf(item, ['poiId', 'cityNodeId']),
    activityId: valueOf(item, ['activityId', 'ownerId']),
    raw: item,
  }))
}

function sceneRequest(sceneId, params) {
  const id = params && (params.id || params.registrationId || params.orderId)
  const base = { method: 'POST', data: {}, hideLoading: true }
  const configs = {
    'asset-earnings': { url: '/api/user/info', data: { member_id: app.getUserID() } },
    'asset-income-detail': { url: '/api/user/balance/list', data: { pageNum: 1, pageSize: app.getPageSize ? app.getPageSize() : 20 } },
    'member-withdraw': { url: '/api/user/info', data: { member_id: app.getUserID() }, formType: 'withdraw' },
    'member-withdraw-history': { url: '/api/withdrawal/list', data: { pageNum: 1, pageSize: app.getPageSize ? app.getPageSize() : 20 } },
    'member-order-history': { url: '/api/registration/list', data: { pageNum: 1, pageSize: app.getPageSize ? app.getPageSize() : 20, owner_type: 3, status: '0' } },
    'member-order-detail': { url: '/api/registration/info', data: { id }, requiresId: true, detail: true },
    'settings-how-to-play': { url: '/api/common/infomation_list', data: { pageNum: 1, pageSize: app.getPageSize ? app.getPageSize() : 20 } },
    'settings-how-to-play-detail': { url: '/api/common/infomation_detail', data: { id }, requiresId: true, detail: true },
    'settings-profile': { url: '/api/user/info', data: { member_id: app.getUserID() }, formType: 'profile' },
    'settings-likes': { url: '/api/topic/like_list', data: {} },
    'settings-feedback': { url: '/api/registration/list', data: { pageNum: 1, pageSize: app.getPageSize ? app.getPageSize() : 20, owner_type: 3, status: '0' }, formType: 'feedback' },
    'merchant-decor': { url: '/api/merchant/coop-profile', data: {}, formType: 'merchant-decor' },
    'merchant-apply': { url: '/api/merchant/info', data: {}, formType: 'merchant-apply' },
    'club-apply': { formType: 'club-apply' },
    'club-create': { url: '/api/club/my', data: {}, formType: 'club-create' },
    'club-manage': id ? { url: '/api/club/detail', data: { id }, json: true } : { url: '/api/club/my', data: {} },
    'merchant-citynode': { url: '/api/merchant/city-node/list', data: {}, formType: 'citynode' },
  }
  const config = configs[sceneId]
  if (!config) return null
  return Object.assign({}, base, config)
}

function cleanForm(form) {
  const next = {}
  Object.keys(form || {}).forEach((key) => {
    if (form[key] !== undefined && form[key] !== null) next[key] = form[key]
  })
  return next
}

// 实名三格只发给 /api/publisher/identity,绝不能混进业务单 payload:
// merchant_registration 带 @Log,参数会被整份序列化进 sys_oper_log(明文),姓名与身份证号
// 一旦进了它的 DTO 就等于没加密。所以这里显式摘掉,提交时序见 submitIdentityFirst。
const IDENTITY_FORM_FIELDS = ['realName', 'idCard', 'consented']
function withoutIdentity(form) {
  const next = Object.assign({}, form || {})
  IDENTITY_FORM_FIELDS.forEach((key) => { delete next[key] })
  return next
}

Component({
  properties: {
    sceneId: { type: String, value: '' },
    params: { type: Object, value: {} },
    theme: { type: String, value: 'player' },
  },

  data: {
    state: 'loading',
    errorText: '',
    emptyText: '这里还没有记录',
    formType: '',
    items: [],
    metrics: [],
    detail: {},
    form: {},
    filters: [],
    activeFilter: 'all',
    submitted: false,
    submitting: false,
    submitError: '',
    merchantAccess: merchantAccessPolicy.inactiveAccess(),
    // RUN-52:club-apply / merchant-apply 两张场景表单的实名登记态。只回真/假,值不下发。
    identityRegistered: false,
    identityConsentText: publisherIdentity.CONSENT_TEXT,
    identityDoneHint: publisherIdentity.ALREADY_REGISTERED_HINT,
  },

  observers: {
    sceneId(value) {
      if (value) this.loadScene()
    },
    params(value) {
      if (this.data.sceneId && value) this.loadScene()
    },
  },

  lifetimes: {
    attached() {
      if (this.data.sceneId) this.loadScene()
    },
    detached() {
      this._loadToken = (this._loadToken || 0) + 1
      this._submitToken = (this._submitToken || 0) + 1
    },
  },

  methods: {
    loadScene() {
      const sceneId = this.data.sceneId
      const params = this.data.params || {}
      if (sceneId === 'settings-deregister') {
        this.setData({ state: 'ready', errorText: '', items: [], metrics: [], detail: {}, submitted: false })
        return
      }
      const config = sceneRequest(sceneId, params)
      this._loadToken = (this._loadToken || 0) + 1
      this._submitToken = (this._submitToken || 0) + 1
      const token = this._loadToken
      // 这两张表单提交的是 /api/club/become-leader 与 /api/merchant/merchant_registration,
      // 和两条正式向导共用同一个后端实名闸 —— 状态先查,已登记的人只看到一句「已登记」。
      if (sceneId === 'club-apply' || sceneId === 'merchant-apply') this.loadIdentityStatus()
      this.setData({ state: 'loading', errorText: '', items: [], metrics: [], detail: {}, submitted: false, submitting: false, submitError: '' })
      if (!config) {
        this.setData({ state: 'error', errorText: '场景配置缺失，请返回后重试' })
        return
      }
      if (config.requiresId && !config.data.id) {
        this.setData({ state: 'error', errorText: '缺少记录参数，请返回上一级重新进入' })
        return
      }
      if (sceneId === 'settings-likes') {
        this.loadLikes(token)
        return
      }
      if (!config.url) {
        this.setData({ state: 'ready', formType: config.formType || '' })
        return
      }
      if (sceneId === 'merchant-citynode') {
        this.loadMerchantCityNodeAccess(token, config, params)
        return
      }
      this.requestConfiguredScene(sceneId, params, config, token)
    },

    loadMerchantCityNodeAccess(token, config, params) {
      this.setData({ merchantAccess: merchantAccessPolicy.inactiveAccess() })
      app.sendRequest({
        url: '/api/merchant/access/me',
        method: 'POST',
        data: {},
        hideLoading: true,
        success: (res) => {
          if (token !== this._loadToken) return
          if (!isOk(res)) {
            this.setData({ state: 'error', errorText: (res && res.msg) || '服务暂时没有响应' })
            return
          }
          const access = merchantAccessPolicy.normalizeMerchantAccess(payloadOf(res))
          if (!access.active || !access.canManageProjects) {
            this.setData({ state: 'no-permission', merchantAccess: access })
            return
          }
          this.setData({ merchantAccess: access })
          this.requestConfiguredScene('merchant-citynode', params, config, token)
        },
        fail: () => {
          if (token === this._loadToken) this.setData({ state: 'error', errorText: '网络没连上，请稍后重试' })
        },
        successStatusAbnormal: (res) => {
          if (token === this._loadToken) {
            this.setData({ state: 'error', errorText: (res && res.msg) || '商家权限没能读取' })
          }
        },
      })
    },

    requestConfiguredScene(sceneId, params, config, token) {
      // /api/club/detail 是 @RequestBody 端点:不带 JSON header 会被当 urlencoded,
      // 后端 415 兜成 code500,俱乐部管理屏永远停在错误态(与 club/detail.js:1668 同款发法)。
      app.sendRequest({
        url: config.url,
        method: config.method || 'POST',
        data: config.json ? JSON.stringify(config.data || {}) : (config.data || {}),
        header: config.json ? { 'Content-Type': 'application/json' } : undefined,
        hideLoading: true,
        silentError: true,
        success: (res) => {
          if (token !== this._loadToken) return
          if (!isOk(res)) {
            this.setData({ state: 'error', errorText: (res && res.msg) || '服务暂时没有响应' })
            return
          }
          this.applyPayload(sceneId, payloadForScene(sceneId, res), config.formType, params)
        },
        fail: () => {
          if (token === this._loadToken) this.setData({ state: 'error', errorText: '网络没连上，请稍后重试' })
        },
        successStatusAbnormal: () => {
          if (token === this._loadToken) this.setData({ state: 'error', errorText: '服务暂时不可用，请稍后重试' })
        },
      })
    },

    loadLikes(token) {
      const pageSize = app.getPageSize ? app.getPageSize() : 20
      app.sendRequest({
        url: '/api/topic/like_list',
        method: 'POST',
        data: { pageNum: 1, pageSize },
        hideLoading: true,
        silentError: true,
        success: (res) => {
          if (token !== this._loadToken) return
          if (!isOk(res)) {
            this.setData({ state: 'error', errorText: (res && res.msg) || '收藏内容暂时没有响应' })
            return
          }
          this.applyPayload('settings-likes', payloadOf(res), '', {})
        },
        fail: () => {
          if (token === this._loadToken) this.setData({ state: 'error', errorText: '网络没连上，请稍后重试' })
        },
        successStatusAbnormal: () => {
          if (token === this._loadToken) this.setData({ state: 'error', errorText: '收藏内容暂时无法读取' })
        },
      })
    },

    applyPayload(sceneId, data, formType, params) {
      const ownedClubs = sceneId === 'club-manage' && data && Array.isArray(data.owned) ? data.owned : null
      const rows = ownedClubs || rowsOf(data)
      if (rows === null || rows.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
        this.setData({ state: 'error', errorText: '返回数据暂时无法读取，请重试' })
        return
      }
      const detail = ownedClubs ? (ownedClubs[0] || {}) : (Array.isArray(data) ? {} : (data && typeof data === 'object' ? data : {}))
      const metrics = []
      const items = normalizeRows(rows, sceneId)
      const form = this.initialForm(sceneId, detail, params)
      let state = 'ready'
      if (sceneId === 'club-manage' && ownedClubs && !ownedClubs.length) state = 'empty'
      else if (!metrics.length && !items.length && !formType && !Object.keys(detail).length) state = 'empty'
      this.setData({ state, formType: formType || '', items, metrics, detail, form, emptyText: this.emptyText(sceneId) })
    },

    initialForm(sceneId, detail, params) {
      const source = detail || {}
      if (sceneId === 'settings-profile') return { nickname: source.nickname || source.name || '', email: source.email || '' }
      if (sceneId === 'member-withdraw') return { withdrawalAmount: '', consented: false, balance: source.balance, realname: source.realname || source.name || '', bankName: source.bankName || '', bankAccount: source.bankAccount || '', mobilephone: source.mobilephone || source.phone || '' }
      if (sceneId === 'merchant-decor') return { name: source.name || '', cityRole: source.cityRole || '', slogan: source.slogan || '', storyTitle: source.storyTitle || '', description: source.description || '', derivatives: source.derivatives || '', address: source.address || '', capacity: source.capacity || '', availableTime: source.availableTime || '', demand: source.demand || '' }
      if (sceneId === 'merchant-apply') return { id: source.status === 2 ? source.id || null : null, name: source.name || '', preference: source.preference || '', phone: source.phone || source.contactPhone || '', address: source.address || '', businessTime: source.businessTime || '', description: source.description || '', businessLicense: source.businessLicense || '', contactName: source.contactName || '', realName: '', idCard: '', consented: false }
      if (sceneId === 'club-apply') return { leaderName: '', phone: '', identity: '', coFounders: '', experience: '', maxEventSize: '', avgEventSize: '', canDesignRoute: 0, canDesignTask: 0, canNpc: 0, canMerchantCoop: 0, hasGuideCert: 0, realName: '', idCard: '', consented: false }
      if (sceneId === 'club-create') return { name: source.name || '', clubType: source.clubType || '', activityPrefs: source.activityPrefs || '', city: source.city || '', keywords: source.keywords || '', style: source.style || '', description: source.description || '' }
      if (sceneId === 'settings-feedback') return { topicId: '', reason: '' }
      if (sceneId === 'merchant-citynode') return { title: '', answer: '', interactionType: '', validationMethod: '', description: '' }
      return {}
    },

    emptyText(sceneId) {
      const texts = {
        'asset-income-detail': '还没有收益明细',
        'member-withdraw-history': '还没有提现记录',
        'member-order-history': '还没有订单',
        'settings-likes': '还没有收藏内容',
        'merchant-citynode': '还没有城市据点',
        'club-manage': '还没有可管理的俱乐部',
      }
      return texts[sceneId] || '这里还没有记录'
    },

    reload() { this.loadScene() },

    onFilterTap(event) {
      const key = event.currentTarget.dataset.key
      this.setData({ activeFilter: key })
    },

    onItemTap(event) {
      const item = this.data.items[event.currentTarget.dataset.index]
      if (!item) return
      const id = item.id
      if (this.data.sceneId === 'member-order-history' && id) this.emitOpen('member-order-detail', { id })
      else if (this.data.sceneId === 'settings-how-to-play' && id) this.emitOpen('settings-how-to-play-detail', { id })
      else if (this.data.sceneId === 'settings-likes' && id) wx.navigateTo({ url: '/pages/topic/index/index?id=' + id })
      else if (this.data.sceneId === 'merchant-citynode' && item.poiId) this.emitOpen('qr-citynode', { poiId: item.poiId, name: item.title })
    },

    topicUnlike(event) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.items[index]
      if (!item || !item.id) return
      modal.show({
        title: '提示',
        content: '确定要取消点赞吗？',
        success: (modalRes) => {
          if (!modalRes.confirm) return
          app.sendRequest({
            url: '/api/topic/like',
            method: 'POST',
            data: { id: item.id, type: 0 },
            hideLoading: true,
            success: (res) => {
              if (!isOk(res)) {
                toast((res && res.msg) || '操作失败')
                return
              }
              const items = this.data.items.slice()
              items.splice(index, 1)
              this.setData({ items, state: items.length ? 'ready' : 'empty' })
              toast.success('取消点赞成功')
            },
            fail: () => toast('网络错误，请重试'),
          })
        },
      })
    },

    openSecondary(event) {
      const action = event.currentTarget.dataset.action
      // 2026-08-11 用户裁决:收益明细是页面不是弹层,这一支不再走场景栈
      if (action === 'income') wx.navigateTo({ url: '/subpackageA/pages/assetcenter/income-detail/income-detail' })
      // ⚠️ 2026-09-15 核实结论(提现改弹客服微信时逐条查过):这一支是**死代码** ——
      //    本组件 wxml 里 openSecondary 只绑了 club-edit / group-code 两个 data-action,
      //    全仓没有任何地方给它传 data-action="withdraw"。member-withdraw 场景表单目前唯一
      //    可达路径是 pages/shezhi/shezhi.js:39 的 ?scene= 深链(无白名单),所以场景表单的
      //    submitForm 仍一并改成弹客服弹窗;这一支本身是改动前就有的死码,按「不删非自己造成的
      //    死码」留着并在此写明,要删请单独一轮(连同 shezhi 的 ?scene= 白名单一起收)。
      else if (action === 'withdraw') this.emitOpen('member-withdraw')
      else if (action === 'club-edit') this.emitOpen('club-edit', { id: this.data.detail.id || this.data.form.clubId })
      else if (action === 'group-code') this.emitOpen('qr-group-code', { topicId: this.data.detail.topicId, name: this.data.detail.name || '本场次' })
    },

    emitOpen(id, params) { this.triggerEvent('open', { id, params: params || {} }) },
    close() { this.triggerEvent('close') },
    onNestedBack() { this.triggerEvent('back') },
    onNestedSaved() { this.triggerEvent('dirtychange', { dirty: false }) },
    onNestedDissolved() {
      this.triggerEvent('dirtychange', { dirty: false })
      this.triggerEvent('back')
    },
    // 解散确认框里的「改为转让主理人」:治理页早有转让链路(scene-club-edit onDissolveAlt 注释),
    // 之前事件发到这一层没人接,alt 按下去只关框=假装给了出路却没出路。
    onNestedTransferOwner() {
      const clubId = this.data.params && (this.data.params.id || this.data.params.clubId)
      if (!clubId) return
      wx.navigateTo({ url: '/pages/club/governance/index?clubId=' + clubId })
    },
    onNestedDirtyChange(event) {
      this.triggerEvent('dirtychange', { dirty: !!(event.detail && event.detail.dirty) })
    },

    // 单独同意勾选:银行账号是个保法 §28 的敏感个人信息,§29 要求单独同意。
    // 勾/取消都要把已落库标记清掉,取消后必须重新走一次存证。
    onWithdrawConsent(event) {
      const checked = !!(event.detail && event.detail.checked)
      this._withdrawConsentReady = false
      this.setData({ 'form.consented': checked })
      this.triggerEvent('dirtychange', { dirty: true })
    },

    // ===== RUN-52 发布者实名(club-apply / merchant-apply 两张场景表单) =====
    loadIdentityStatus() {
      const token = this._loadToken || 0
      publisherIdentity.loadIdentityStatus((registered) => {
        if (token !== this._loadToken) return
        this.setData({ identityRegistered: !!registered })
      })
    },

    // 单独同意勾选(个保法 §29):它只管实名,和提现那张勾共用 form.consented 字段名,
    // 但两张表单从不同时出现(sceneId 互斥),不会互相踩。
    onIdentityConsent(event) {
      const checked = !!(event.detail && event.detail.checked)
      this.setData({ 'form.consented': checked, submitted: false, submitError: '' })
      this.triggerEvent('dirtychange', { dirty: true })
    },

    submitIdentityFirst(sceneId, form) {
      const identityForm = {
        realName: form.realName,
        idCard: form.idCard,
        consented: form.consented,
        source: sceneId === 'club-apply' ? publisherIdentity.SOURCE_CLUB_APPLY : publisherIdentity.SOURCE_MERCHANT_APPLY,
      }
      const verdict = publisherIdentity.checkIdentityForm(identityForm)
      if (!verdict.ok) {
        this.setData({ submitError: verdict.message })
        return
      }
      this.setData({ submitting: true, submitError: '' })
      publisherIdentity.registerIdentity(identityForm, (result) => {
        if (!result.ok) {
          this.setData({ submitting: false, submitError: result.message })
          return
        }
        // 登记成功后重走一次 submitForm:第二遍 identityRegistered 已为真,直接落业务单
        this.setData({ identityRegistered: true, submitting: false }, () => this.submitForm())
      })
    },

    recordWithdrawConsent() {
      if (!app.recordConsent) {
        toast('同意记录服务暂不可用，请稍后重试')
        return
      }
      this.setData({ submitting: true })
      app.recordConsent({
        docType: withdrawForm.CONSENT_DOC_TYPE,
        scene: withdrawForm.CONSENT_SCENE,
        eventType: 'AGREE',
      }).then(() => {
        this._withdrawConsentReady = true
        this.setData({ submitting: false })
        this.submitForm()
      }).catch(() => {
        this.setData({ submitting: false })
        toast('同意记录未保存，请检查网络后重试')
      })
    },

    onFieldInput(event) {
      const field = event.currentTarget.dataset.field
      const form = Object.assign({}, this.data.form, { [field]: event.detail.value })
      this.setData({ form, submitted: false, submitError: '' })
      this.triggerEvent('dirtychange', { dirty: true })
    },

    submitForm() {
      if (this.data.submitting) return
      const sceneId = this.data.sceneId
      const form = this.data.form || {}
      if (sceneId === 'member-withdraw') {
        // 2026-09-15 收款模型定稿 §3:平台不打款。银行卡表单/建单链路就此停用,
        // 点「确认提现」只弹平台客服微信(后端 /api/withdrawal/create 保留,但前端不再触达)。
        withdrawCs.showWithdrawCsPopup()
        return
      }
      if (sceneId === 'merchant-citynode' && !this.data.merchantAccess.canManageProjects) {
        toast('当前岗位没有据点管理权限')
        return
      }
      // RUN-52 发布者实名:这两张场景表单提交的是 /api/club/become-leader 与
      // /api/merchant/merchant_registration,和两条正式向导共用同一个后端实名闸。
      // 先把实名单独落一笔再重走提交 —— 顺序不能反,并发两发会被拦成「请先登记实名信息」。
      if ((sceneId === 'club-apply' || sceneId === 'merchant-apply') && !this.data.identityRegistered) {
        this.submitIdentityFirst(sceneId, form)
        return
      }
      const requests = {
        'settings-profile': { url: '/api/user/update', data: cleanForm({ nickname: form.nickname, email: form.email }), json: true },
        'settings-feedback': { url: '/api/coop/complaint/report', data: cleanForm({ topicId: form.topicId, reason: form.reason }), json: true },
        'merchant-decor': { url: '/api/merchant/update', data: cleanForm({ name: form.name, description: form.description, address: form.address }), json: true },
        // withoutIdentity:姓名/身份证号/那张勾只属于 /api/publisher/identity,不能混进这两个业务单
        'merchant-apply': { url: '/api/merchant/merchant_registration', data: Object.assign({ id: null }, cleanForm(withoutIdentity(form))), json: true },
        'club-apply': { url: '/api/club/become-leader', data: cleanForm(withoutIdentity(form)), json: true },
        'club-create': { url: '/api/club/create', data: cleanForm(form), json: true },
        'merchant-citynode': { url: '/api/merchant/city-node/template/submit', data: cleanForm(form), json: true },
      }
      const request = requests[sceneId]
      if (!request) {
        this.setData({ submitError: '当前表单暂时无法提交，请返回后重试' })
        return
      }
      const token = (this._submitToken || 0) + 1
      this._submitToken = token
      this.setData({ submitting: true, submitError: '' })
      const submitHandlers = {
        success: (res) => {
          if (token !== this._submitToken || sceneId !== this.data.sceneId) return
          if (isOk(res)) {
            this.setData({ submitting: false, submitted: true, submitError: '' })
            this.triggerEvent('dirtychange', { dirty: false })
            toast.success('已提交')
          } else {
            this.setData({ submitting: false, submitError: (res && res.msg) || '提交失败，请重试' })
          }
        },
        fail: (error) => {
          if (token === this._submitToken && sceneId === this.data.sceneId) {
            this.setData({
              submitting: false,
              submitError: error && error.errMsg
                ? '网络没连上，已填写内容不会丢失，请重试'
                : '当前表单暂时无法提交，请重试',
            })
          }
        },
        successStatusAbnormal: () => {
          if (token === this._submitToken && sceneId === this.data.sceneId) this.setData({ submitting: false, submitError: '服务暂时不可用，已填写内容不会丢失，请重试' })
        },
        cancel: () => {
          if (token === this._submitToken && sceneId === this.data.sceneId) this.setData({ submitting: false, submitError: '' })
        },
      }
      app.sendRequest({
        url: request.url,
        method: 'POST',
        data: request.json ? JSON.stringify(request.data) : request.data,
        header: request.json ? { 'Content-Type': 'application/json' } : undefined,
        hideLoading: true,
        autoErrorToast: false,
        success: submitHandlers.success,
        fail: submitHandlers.fail,
        successStatusAbnormal: submitHandlers.successStatusAbnormal,
      })
    },

  },
})

const merchantIdentityPolicy = require('../../../utils/merchant-identity-policy.js')

function payloadForScene(sceneId, res) {
  if (sceneId === 'merchant-apply') {
    const resolved = merchantIdentityPolicy.resolveApplicationResponse(res)
    if (!resolved) return null
    return resolved.kind === 'none' ? { applicationState: 'NONE' } : resolved.data
  }
  return payloadOf(res)
}
