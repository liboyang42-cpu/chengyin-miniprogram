'use strict'

Component({
  properties: {
    theme: { type: String, value: 'player' },
    qrUrl: { type: String, value: '' },
    // 设计稿二维码只用于 develop 环境的视觉验收,正式环境必须由调用方传入真实地址。
    designPreview: { type: Boolean, value: true },
  },

  data: {
    qrSrc: '',
    qrState: 'empty',
  },

  observers: {
    'qrUrl, designPreview': function () {
      this.syncQr()
    },
  },

  lifetimes: {
    attached() {
      this.syncQr()
    },
  },

  methods: {
    syncQr() {
      let canPreview = false
      try {
        const app = getApp()
        canPreview = !!(app && typeof app.isDevEnv === 'function' && app.isDevEnv())
      } catch (_) {}
      const source = this.data.qrUrl || (this.data.designPreview && canPreview ? '/images/figma-invite-qr.png' : '')
      this.setData({ qrSrc: source, qrState: source ? 'loading' : 'empty' })
    },

    isCurrentQrEvent(event) {
      return !!event && event.currentTarget && event.currentTarget.dataset
        && event.currentTarget.dataset.src === this.data.qrSrc
    },

    onQrLoad(event) {
      if (this.isCurrentQrEvent(event)) this.setData({ qrState: 'ready' })
    },

    onQrError(event) {
      if (this.isCurrentQrEvent(event)) this.setData({ qrState: 'error' })
    },

    retryQr() {
      if (!this.data.qrSrc) {
        this.syncQr()
        return
      }
      // error 分支已卸载 image；切回 loading 会重新创建真实 image 并重新触发加载。
      this.setData({ qrState: 'loading' })
    },
  },
})
