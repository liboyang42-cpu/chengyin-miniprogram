'use strict'

const { currentPlayerRoamMemory } = require('../../../utils/roam-player-memory.js')
const { validRecovery } = require('../../../utils/roam-recovery.js')
const { readNonNegative } = require('../../../utils/roam-history-metrics.js')
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

Component({
  data: {
    list: [],
    state: 'loading',
    // CU-M-55:本次漫游还没结束。sessions 只在结算时才写(roam 页 _saveSession),
    // 所以「列表空」不等于「没开始过」—— 进行中有本机的 recovery 记录作依据。
    inProgress: false,
    summary: { trips: 0, km: '0.0', shopsText: '0' },
  },
  lifetimes: {
    attached() { this._load() },
  },
  methods: {
    _load() {
      this.setData({ state: 'loading' })
      try {
        // readSessionState 自带 ok 位:本地读失败与「真的没有记录」必须分开,
        // 读失败走 error 可重试,不能显示成一段空历史。
        const memory = currentPlayerRoamMemory(getApp(), wx)
        const state = memory.readSessionState()
        const stored = state.sessions
        if (!state.ok || !Array.isArray(stored) || stored.some((item) => !item || typeof item !== 'object' || Array.isArray(item) || this._timestamp(item.ts) <= 0)) {
          this._sessions = []
          this.setData({ state: 'error', list: [] })
          return
        }
        this._sessions = stored
        /* CU-M-55:正在漫游时列表本来就是空的(记录只在结算时写),空态不能再写
           「你还没有开始过城市漫游」。判据用与 roam 页同一份 validRecovery ——
           形状不对/被清掉的记录不算进行中,不能凭空多出一张「正在漫游」卡。 */
        const recovery = memory.readRecoveryState()
        this._inProgress = recovery.ok && !!recovery.record && validRecovery(recovery.record)
      } catch (_) {
        this._sessions = []
        this.setData({ state: 'error', list: [] })
        return
      }
      this._sync()
    },
    _sync() {
      const list = this._sorted('new')
      let km = 0; let kmKnown = true
      let shops = 0; let shopsKnown = true
      list.forEach((session) => {
        if (session.distanceValue === null) kmKnown = false
        else km += session.distanceValue
        if (session.shopsValue === null) shopsKnown = false
        else shops += session.shopsValue
      })
      this.setData({
        list,
        state: 'ready',
        inProgress: this._inProgress === true,
        summary: { trips: list.length, km: kmKnown ? km.toFixed(1) : '—', shopsText: shopsKnown ? String(shops) : '—' },
      })
    },
    _sorted() {
      const list = (this._sessions || []).map((session) => {
        const timestamp = this._timestamp(session && session.ts)
        const date = new Date(timestamp || NaN)
        const validDate = !Number.isNaN(date.getTime())
        const dateText = validDate
          ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${WEEK[date.getDay()]}`
          : '日期不可用'
        const zone = String((session && session.zone) || '').trim()
        const code = (zone || '漫游').replace(/[的这那片街区]/g, '').slice(0, 2) || '城西'
        const photos = Array.isArray(session && session.photos) ? session.photos : []
        const firstPhoto = photos[0]
        // distance 历史上有两代写法(number 与 "0.2" 字符串);用宽容读法兼容老记录,
        // 但 0 仍是真实零、空/非数字仍是未知。shops 始终按 number 存,保持原合同。
        const distanceValue = readNonNegative(session && session.distance)
        const shopsValue = nonNegativeNumber(session && session.shops)
        return {
          ...session,
          dateFull: dateText,
          dateShort: validDate
            ? `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(2)}`
            : '日期不可用',
          title: (zone && zone !== '这片街区' ? zone : '城市') + '漫游',
          cover: typeof firstPhoto === 'string' ? firstPhoto : ((firstPhoto && firstPhoto.path) || ''),
          stamps: photos.length,
          medals: [session && session.medal, session && session.shopMedalName].filter(Boolean),
          fromCode: code,
          toCode: code,
          distanceValue,
          distanceText: distanceValue === null ? '0' : String(distanceValue), // UI-04:没取到显示 0
          shopsValue,
          shopsText: shopsValue === null ? '—' : String(shopsValue),
          time: (session && typeof session.time === 'string' && session.time.trim()) || this._formatDuration(session && session.durSec) || '—',
          _timestamp: timestamp,
        }
      })
      list.sort((a, b) => b._timestamp - a._timestamp)
      return list
    },
    _timestamp(value) {
      const number = Number(value)
      if (Number.isFinite(number) && number > 0) return number < 100000000000 ? number * 1000 : number
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : 0
    },
    _formatDuration(seconds) {
      const value = nonNegativeNumber(seconds)
      if (value === null) return ''
      return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    },
    openSession(event) {
      this.triggerEvent('open', { id: 'roam-session', params: { ts: event.currentTarget.dataset.ts } })
    },
    closeToRoam() {
      this.triggerEvent('close')
    },
    retry() { this._load() },
  },
})
