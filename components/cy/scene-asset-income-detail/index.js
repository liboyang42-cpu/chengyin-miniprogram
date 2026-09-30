'use strict'

// H02 收益明细(方案 §5.2)。列表与取数逻辑的唯一实现;
// subpackageA/pages/assetcenter/income-detail 已退化成深链薄壳,渲染的就是本组件。
// 页面级的 merchantTheme 换肤留在壳里 —— 弹窗的主题由 scene-sheet 的 theme 作用域给。
const app = getApp()

function moneyText(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : null
}

function formatDate(dateStr, today, yesterday) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  if (d.getTime() === today.getTime()) return '今天'
  if (d.getTime() === yesterday.getTime()) return '昨天'
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

Component({
  properties: {
    theme: { type: String, value: 'player' },
    // 'sheet'(默认,宿主是弹层,渐隐端跟弹层底)| 'page'(独立页,跟页底,否则黑块裸露)
    surface: { type: String, value: 'sheet' },
  },
  data: {
    activeFilter: 'all',
    filterTabs: [
      { key: 'all', label: '全部' },
      { key: 'create', label: '创作收益' },
      { key: 'brand', label: '品牌收益' },
      /* CU-M-162:这一支读的是 /api/coop/finance(clubFinance)—— 我作为发布方的**各主题结算**,
         从来不只收俱乐部主题:自有商家主题(club_id 为空)的分润同样在这。原来标签写「俱乐部」,
         商家把自己那本主题的收入读成俱乐部收入。语义键 club 是内部契约,不动;对外说真做的这件事。 */
      { key: 'club', label: '主办分润' },
    ],
    list: [],
    // CU-M-122:空态只留一行、且要说清是哪一个筛选空 —— 页面标题已经写了「收益明细」,
    // 再来一句「暂无收益记录 / 产生收益后，明细会显示在这里」是同屏三次重复主题。
    emptyTitle: '还没有收益记录',
    page_no: 1,
    pageSize: 10,
    hasMore: false,
    loadErr: false,
    loading: false,
  },
  lifetimes: {
    attached() { this.getList() },
  },
  methods: {
    onFilterChange(e) {
      const activeFilter = e.detail.key
      const tab = this.data.filterTabs.filter((item) => item.key === activeFilter)[0]
      this.setData({
        activeFilter,
        emptyTitle: activeFilter === 'all' ? '还没有收益记录' : (tab ? tab.label : '这个筛选') + '还没有收益',
        page_no: 1,
        list: [],
        hasMore: false,
        loadErr: false,
        loading: false,
      })
      if (activeFilter === 'club') return
      this.getList()
    },

    onClubClose() { this.triggerEvent('close') },

    getList() {
      const that = this
      const { activeFilter, page_no, pageSize } = this.data
      const reqData = { pageNum: page_no, pageSize }
      if (activeFilter === 'create') reqData.eventType = '1'
      else if (activeFilter === 'brand') reqData.eventType = '2'

      that.setData({ loading: true, loadErr: false })
      app.sendRequest({
        url: '/api/user/balance/list',
        method: 'POST',
        data: reqData,
        success(res) {
          if (res.code == '200') {
            const data = res.data
            const rows = data && (data.rows || data.list || data)
            if (!Array.isArray(rows)) {
              that.setData({ loadErr: true, loading: false })
              return
            }
            const total = data.total || rows.length
            const newList = that.formatList(page_no === 1 ? rows : that.data.list.concat(rows))
            that.setData({
              list: newList,
              hasMore: page_no * pageSize < total,
              loadErr: false,
              loading: false,
            })
          } else {
            that.setData({ loadErr: true, loading: false })
          }
        },
        fail() {
          that.setData({ loadErr: true, loading: false })
        },
      })
    },

    onRetry() {
      this.setData({ page_no: 1, list: [] })
      this.getList()
    },

    // 壳的 onReachBottom / 弹窗正文的 scrolltolower 都转发到这里
    loadMore() {
      if (this.data.activeFilter === 'club' || this.data.loading || !this.data.hasMore) return
      this.setData({ page_no: this.data.page_no + 1 })
      this.getList()
    },

    formatList(rows) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      // ⚠️ changeType 是**收支方向**不是流水状态:后端 UmsMemberBalanceDetail 的注释写死
      // 「变化类型1:收入 2、支出」,写入方 MerchantClawbackServiceImpl / MerchantReferralBountyService
      // 给支出配的是 changeType=2 + changeBalance.negate()。原来拿它当状态渲染成「已到账/处理中」,
      // 等于每一条支出都恒显示「处理中」—— 库里根本没有状态字段,那两个词是编出来的。
      // 金额同理:原来 wxml 里硬拼 '+¥',支出会渲染成 +¥-128.00(负号来自 negate 的原值)。
      return (rows || []).map((item) => {
        const direction = item.changeType === 1 ? 'income' : (item.changeType === 2 ? 'expense' : 'unknown')
        // 先过 moneyText 再剥负号 —— 不能先 Math.abs:moneyText 对 null/undefined/'' 有守卫
        // 返回 null(让 wxml 走占位分支),而 Number(null) 是 0,预转换会把这三种空值变成 "0.00"。
        const text = moneyText(item.changeBalance)
        const abs = text == null ? null : text.replace(/^-/, '')
        const isIncome = direction === 'income' ? true : (direction === 'expense' ? false : null)
        return Object.assign({}, item, {
          displayDate: formatDate(item.createTime, today, yesterday),
          isIncome,
          directionKnown: direction !== 'unknown',
          directionText: direction === 'income' ? '收入' : (direction === 'expense' ? '支出' : '方向待确认'),
          // 符号进文案:方向不能只靠颜色承载(WCAG 1.4.1),色盲用户要能从 +/− 和「收入/支出」读出来
          amountText: abs == null ? null : (direction === 'income' ? '+¥' : (direction === 'expense' ? '−¥' : '¥')) + abs,
        })
      })
    },
  },
})
