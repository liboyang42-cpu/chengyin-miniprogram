'use strict'

const toast = require('../../../utils/toast.js');
const { getScene } = require('../../../utils/scene-registry.js')
const { currentScene, exitDecision, popScene, pushScene } = require('../../../utils/scene-stack.js')

const PLAYER_PLAY_SCENES = new Set([
  'play-activity-detail', 'roam-task-list', 'roam-poi-detail', 'roam-discover',
  'roam-history', 'roam-session', 'game-coupon-wallet',
  'qr-coupon', 'qr-group-code', 'qr-citynode', 'qr-ticket', 'roam-stamp-album',
])
const MERCHANT_SCENES = new Set(['merchant-decor', 'merchant-apply', 'merchant-citynode'])

function pageOptions() {
  try {
    const pages = getCurrentPages()
    const page = pages && pages[pages.length - 1]
    const options = (page && page.options) || {}
    return Object.keys(options).reduce((result, key) => {
      const value = options[key]
      if (value === undefined || value === null || value === '') return result
      try { result[key] = decodeURIComponent(String(value)) } catch (_) { result[key] = String(value) }
      return result
    }, {})
  } catch (_) {
    return {}
  }
}

function fallbackRoute(id) {
  if (MERCHANT_SCENES.has(id)) return '/pages/merchant/index/index'
  if (id === 'game-coupon-wallet') return '/pages/member/index/index'
  if (PLAYER_PLAY_SCENES.has(id)) return '/pages/play/index'
  if (id.indexOf('settings-') === 0 || id.indexOf('club-') === 0) return '/pages/shezhi/shezhi'
  return '/pages/member/index/index'
}

Component({
  properties: {
    sceneId: { type: String, value: '' },
    params: { type: Object, value: {} },
  },

  data: {
    sceneStack: [],
    sceneCurrent: null,
    sceneConfirm: { show: false, action: null, pending: null },
  },

  observers: {
    sceneId(value) {
      if (value && !this._rootOpened) this.openRoot(value)
    },
  },

  lifetimes: {
    attached() {
      if (this.data.sceneId) this.openRoot(this.data.sceneId)
    },
  },

  methods: {
    openRoot(id) {
      if (this._rootOpened) return
      this._rootOpened = true
      const routeParams = Object.assign({}, pageOptions(), this.data.params || {})
      try {
        this.openScene(id, routeParams, true)
      } catch (error) {
        this._rootOpened = false
        toast('场景暂时打不开')
      }
    },

    openScene(id, params = {}, force = false) {
      const scene = getScene(id, params)
      if (!force && exitDecision(this.data.sceneStack, 'close') === 'confirm') {
        this.setData({ sceneConfirm: { show: true, action: 'replace', pending: scene } })
        return
      }
      const sceneStack = pushScene(this.data.sceneStack, scene)
      this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } })
    },

    openChildScene(event) {
      const detail = event.detail || {}
      if (detail.id) this.openScene(detail.id, detail.params || {})
    },

    closeChildScene() {
      if (this.data.sceneStack.length > 1) {
        const sceneStack = popScene(this.data.sceneStack)
        this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack) })
        return
      }
      this.requestSceneClose()
    },

    backScene() {
      if (exitDecision(this.data.sceneStack, 'back') === 'confirm') {
        this.setData({ sceneConfirm: { show: true, action: 'back', pending: null } })
        return
      }
      if (this.data.sceneStack.length > 1) {
        const sceneStack = popScene(this.data.sceneStack)
        this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack) })
        return
      }
      this.closeRoot()
    },

    requestSceneClose() {
      if (exitDecision(this.data.sceneStack, 'close') === 'confirm') {
        this.setData({ sceneConfirm: { show: true, action: 'close', pending: null } })
        return
      }
      this.closeRoot()
    },

    confirmSceneDiscard() {
      const action = this.data.sceneConfirm.action
      if (action === 'replace' && this.data.sceneConfirm.pending) {
        this.openScene(this.data.sceneConfirm.pending.id, this.data.sceneConfirm.pending.params, true)
        return
      }
      if (action === 'back' && this.data.sceneStack.length > 1) {
        const sceneStack = popScene(this.data.sceneStack)
        this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } })
        return
      }
      this.closeRoot()
    },

    cancelSceneDiscard() {
      this.setData({ sceneConfirm: { show: false, action: null, pending: null } })
    },

    onSceneDirtyChange(event) {
      const sceneStack = this.data.sceneStack.slice()
      if (!sceneStack.length) return
      sceneStack[sceneStack.length - 1] = Object.assign({}, sceneStack[sceneStack.length - 1], { dirty: !!(event.detail && event.detail.dirty) })
      this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack) })
    },

    submitSceneForm() {
      const content = this.selectComponent('#deepSceneRouteContent')
      if (content && typeof content.submitForm === 'function') content.submitForm()
    },

    openStampCamera() {
      this.closeRoot()
      setTimeout(() => wx.navigateTo({ url: '/subpackageP3/pages/stamp-camera/index/index' }), 0)
    },

    // 任务列表的行是官方活动:退掉深链薄壳页再进官方活动详情(3-18)
    openOfficialEvent(event) {
      this.closeRoot()
      setTimeout(() => wx.navigateTo({ url: '/pages/activity/official-detail/index?id=' + event.detail.id }), 0)
    },

    // 「投一张」:和相机同一收法,先退掉深链薄壳页再进分包城市签(3-24)
    openCityStamp(event) {
      const place = (event && event.detail && event.detail.place) || '这一站'
      this.closeRoot()
      setTimeout(() => wx.navigateTo({ url: '/subpackageRoam/citystamp/index?kind=sign&place=' + encodeURIComponent(place) }), 0)
    },

    onSessionShare() {
      toast('请使用右上角转发')
    },

    blockTouch() {},

    closeRoot() {
      if (!this._rootOpened) return
      this._rootOpened = false
      this.triggerEvent('close', { sceneId: this.data.sceneId })
      const fallback = fallbackRoute(this.data.sceneId)
      wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: fallback }) })
    },
  },
})
