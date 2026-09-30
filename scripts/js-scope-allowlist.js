'use strict'

module.exports = [
  {
    pathPrefix: 'utils/session/session-store.js',
    names: ['atob'],
    reason: 'JWT 解析先用 typeof 探测可选浏览器全局 atob；缺失时明确回退微信 base64ToArrayBuffer。',
    owner: '小程序前端负责人',
    reviewDate: '2026-11-22',
  },
]
