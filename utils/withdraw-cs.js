'use strict'
// 平台客服微信号:「提现」一律改由平台客服线下处理(收款模型定稿 2026-09-15 §3:平台不打款)。
// ★ 全仓唯一来源:6 个提现入口的弹窗都从这里取号,任何页面/组件都不许再写这个字面量。
// 弹层复用既有 cy-modal-host / cy-modal(中间弹窗、至多两枚小按钮并排),不新造弹窗形态。
const modal = require('./modal.js')
const toast = require('./toast.js')

const WITHDRAW_CS_WECHAT_ID = '18000000000'
const WITHDRAW_CS_TIP = '添加客服微信，核对金额后线下处理'

function copyWithdrawCsWechat() {
  wx.setClipboardData({
    data: WITHDRAW_CS_WECHAT_ID,
    success() { toast.success('已复制微信号') },
    // ⚠️ 别把微信号拼进这条 toast:11 位号码会被 safeUserMessage 当手机号过滤成「操作失败」,
    //    用户反而看不到失败原因。号就在弹窗正文上,提示手动添加即可。
    fail() { toast('复制失败，请手动添加客服微信') },
  })
}

function showWithdrawCsPopup() {
  modal.show({
    title: '联系平台客服提现',
    content: '客服微信号：' + WITHDRAW_CS_WECHAT_ID + '\n' + WITHDRAW_CS_TIP,
    confirmText: '复制',
    cancelText: '返回',
    success(res) { if (res && res.confirm) copyWithdrawCsWechat() },
  })
}

module.exports = { WITHDRAW_CS_WECHAT_ID, WITHDRAW_CS_TIP, showWithdrawCsPopup }
