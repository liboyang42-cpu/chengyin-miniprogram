'use strict'

const app = getApp()
const credential = require('../../../utils/coupon-credential.js')
const { isRecordList } = require('../../../utils/response-shape.js')
const datetime = require('../../../utils/datetime.js')

function ok(res) { return res && (res.code === 200 || res.code === '200') }

// 列表归属主键:当前登录会员 id。持有券是账号私产 —— 换号后上一账号的列表
// 既不能被在途回包写回,也不能继续显示。取不到时按「无法证明归属」处理。
function currentOwnerId() { return credential.currentOwnerId(app) }

// 券有效期全站只显示到日(2026-09-17 用户拍板,共享 utils/datetime.formatDayDots)。
function dateText(value) {
  return datetime.formatDayDots(value)
}

// 使用期承诺:start 前不算可使用。list 接口(startTime 由 ViewCouponHistory 序列化为日期)
// 只能按「日」判断,当天更精确的时刻由出码页用 qr-token 的完整时间兜底;无 startTime 的
// 合法历史券兼容为已开始,不得因缺字段被判不可用。
// ★日历日比较必须走 utils/datetime.chinaDateKey:日期是业务语义上的中国日,
// 设备时区不是 UTC+8 时用本地日期会把「中国已到 start、本机还在前一天」的券错误锁住。
function startedAt(value) {
  if (!value) return true
  const day = String(value).replace('T', ' ').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const key = datetime.chinaDateKey(value)
    return !key || key <= datetime.chinaDateKey(new Date())
  }
  const parsed = datetime.toTimestamp(value)
  return isNaN(parsed) ? true : parsed <= Date.now()
}

function decorate(item) {
  const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {}
  const status = source.useStatus
  const known = status === 0 || status === 1 || status === 2 || status === 3
  const started = startedAt(source.startTime)
  const startText = source.startTime ? `${dateText(source.startTime)} 起可用` : ''
  const endText = source.endTime ? `有效期至 ${dateText(source.endTime)}` : '有效期待确认'
  const dateLine = status === 3 ? '该券已被平台手动失效' : (started ? endText : `${startText} · ${endText}`)
  return {
    ...source,
    _id: String(source.id != null ? source.id : ''),
    _name: source.couponName || '优惠券',
    _description: source.couponDescription || source.note || '',
    _statusCode: known ? status : null,
    _statusText: status === 0 ? '待使用' : (status === 1 ? '已使用' : (status === 2 ? '已过期' : (status === 3 ? '已失效' : '状态待确认'))),
    // 2026-09-01:改用 cy-badge 的 variant 名;done 与 neutral 本来就同色,合并。
    // 2026-09-17:手动失效(3)用 danger 与「已失效」文案一起强调不可用。
    _statusVariant: status === 0 ? 'info' : (status === 3 ? 'danger' : 'neutral'),
    // 可查看(打开等待/详情)与可核销(亮码)是两件事:未来券保留查看入口,
    // 但只有已到 start 才亮码/显示「出示核销码」。服务端 CAS 仍是最终闸门。
    // 已失效(3)不给查看入口 —— 服务端 qr-token 也只会回终态,点进去是死路。
    _canView: status === 0,
    _isUsable: status === 0 && started,
    _dateText: dateLine,
  }
}

Component({
  data: { state: 'loading', tab: 0, tabs: ['全部', '待使用', '已使用', '已过期'], all: [], items: [], errorMsg: '' },
  lifetimes: { attached() { this.load() } },
  pageLifetimes: {
    show() {
      // 宿主重见:静默换号(页面存活期账号变了)必须清掉上一账号私有券并重载当前账号;
      // 同 owner 保持现有列表(不闪不重载);首屏 attached 已在途时不重复发。
      const owner = currentOwnerId()
      if (this._requestedOwner === owner && this._listOwner === owner) return
      if (this._requestedOwner !== owner) this.load()
    },
    hide() {
      // 同 owner 隐藏保留列表;换号由 show 兜底。在途回包由 load 的 owner 守卫拦住。
    },
  },
  methods: {
    load() {
      // 账号切换/重进时的读取代际 + owner 快照:旧账号在途回包不得覆盖当前列表。
      const seq = (this._loadSeq = (this._loadSeq || 0) + 1)
      const owner = currentOwnerId()
      this._requestedOwner = owner
      this.setData({ state: 'loading', errorMsg: '', all: [], items: [] })
      if (!owner) { this._listOwner = ''; this.setData({ state: 'error', errorMsg: '登录状态待确认，请登录后重试。' }); return }
      app.sendRequest({
        url: '/api/coupon/myrecvlist', method: 'POST', data: { keyword: '' }, hideLoading: true, silentError: true,
        success: (res) => {
          if (!owner || seq !== this._loadSeq || owner !== currentOwnerId()) return
          if (!ok(res) || !isRecordList(res.data)) { this.setData({ state: 'error', errorMsg: '优惠券暂时没能打开，请稍后重试。' }); return }
          const all = res.data.map(decorate)
          this._listOwner = owner
          this.setData({ all, state: all.length ? 'ready' : 'empty' }, () => this.filter())
        },
        successStatusAbnormal: () => {
          if (!owner || seq !== this._loadSeq || owner !== currentOwnerId()) return
          this.setData({ state: 'error', errorMsg: '服务暂时不可用，请稍后重试。' })
        },
        fail: () => {
          if (!owner || seq !== this._loadSeq || owner !== currentOwnerId()) return
          this.setData({ state: 'error', errorMsg: '网络异常，请检查网络后重试。' })
        },
      })
    },
    filter() {
      const items = this.data.tab === 0 ? this.data.all : this.data.all.filter((item) => item._statusCode === this.data.tab - 1)
      this.setData({ items })
    },
    selectTab(event) {
      const tab = event.currentTarget.dataset.tab
      if (!Number.isInteger(tab) || tab < 0 || tab >= this.data.tabs.length) return
      this.setData({ tab }, () => this.filter())
    },
    openCode(event) {
      if (!currentOwnerId() || this._listOwner !== currentOwnerId()) { this.load(); return }
      const item = event.currentTarget.dataset.item
      if (!item || item._canView !== true || !item._id) return
      this.triggerEvent('open', { id: 'qr-coupon', params: { couponHistoryId: item._id, name: item._name } })
    },
    close() { this.triggerEvent('close') },
    retry() { this.load() },
  },
})
