const toast = require('../../../../utils/toast.js');
const { toTimestamp, chinaDateKey, chinaParts } = require('../../../../utils/datetime');
const { isRecordList, isBizOk } = require('../../../../utils/response-shape.js');
const { normalizeMerchantAccess } = require('../../../../utils/merchant-access-policy.js');
const app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    capsuleRightGap: 96,
    loading: true,
    loaded: false,
    error: false,
    errorMsg: '',
    refreshing: false,
    list: [],
    activeTab: 'dm',
    // 竞猜待答入口:只给能结算竞猜的人看 —— 玩家看见它只会点进去撞一堵权限墙
    canSettlePredict: false,
    tabs: [],
    viewList: [],
    hasUnread: false,
  },

  onLoad() {
    const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    let cap = (app.globalData && app.globalData.menuButtonInfo) || null;
    if (!cap && wx.getMenuButtonBoundingClientRect) {
      try { cap = wx.getMenuButtonBoundingClientRect(); } catch (e) { cap = null; }
    }
    const statusBarHeight = (app.globalData && app.globalData.statusBarHeight) || sys.statusBarHeight || 20;
    const navBarHeight = cap && cap.height ? cap.height : ((app.globalData && app.globalData.navBarHeight) || 44);
    const capsuleRightGap = cap && cap.left ? Math.round((sys.windowWidth || 375) - cap.left + 12) : 96;
    this.setData({ statusBarHeight: statusBarHeight, navBarHeight: navBarHeight, capsuleRightGap: capsuleRightGap });
    // 左滑面板总宽 = 3 × 120rpx = 360rpx;rpx→px 换算随屏宽变,不能写死 px(P1-1:大屏机型上曾被写死值压掉)
    this._openPx = Math.round(360 * ((sys.windowWidth || 375) / 750));
    this.loadConversations();
  },
  onShow() {
    // 从聊天页返回时刷新未读/最后一条
    if (this.data.loaded) this.loadConversations(true);
    this.loadMerchantEntry();
  },

  loadConversations(silent) {
    const that = this;
    const preserveConfirmed = !!silent && this.data.loaded;
    const requestEpoch = (this._conversationRequestEpoch || 0) + 1;
    this._conversationRequestEpoch = requestEpoch;
    if (preserveConfirmed) {
      this.setData({ refreshing: true });
    } else {
      this.setData({ loading: true, refreshing: false, error: false, errorMsg: '' });
    }
    app.sendRequest({
      url: '/api/im/conversations',
      method: 'POST',
      hideLoading: true,
      silentError: true,
      success(res) {
        if (requestEpoch !== that._conversationRequestEpoch) return;
        if (res && res.code == 200 && isRecordList(res.data)) {
          const list = res.data.map(function (c) {
            const cp = c.counterparty || {};
            return Object.assign({}, c, {
              counterparty: Object.assign({}, cp, {
                nickname: cp.nickname || (c.type == 2 ? '系统通知' : '城瘾消息'),
                avatar: cp.avatar || '',
              }),
              offset: 0,
              timeText: that.fmtTime(c.lastMsgAt),
              previewText: that.fmtPreview(c),
            });
          });
          that.setData({
            list: list,
            loading: false,
            refreshing: false,
            loaded: true,
            error: false,
            errorMsg: '',
          });
          that.refreshView();
        } else {
          that._setConversationError(res, preserveConfirmed);
        }
      },
      fail(res) {
        if (requestEpoch !== that._conversationRequestEpoch) return;
        that._setConversationError(res, preserveConfirmed);
      },
    });
  },

  _setConversationError(response, preserveConfirmed) {
    const msg = app.getRequestErrorMessage
      ? app.getRequestErrorMessage(response, '消息加载失败，请重试')
      : ((response && (response.msg || response.errMsg)) || '消息加载失败，请重试');
    if (preserveConfirmed) {
      this.setData({ loading: false, refreshing: false, error: false });
      return;
    }
    this.setData({ loading: false, refreshing: false, error: true, errorMsg: msg });
  },

  retryConversations() { this.loadConversations(false); },

  // 会话归类(spec 决策 2:客服 type=3 归私信 —— 分 tab 的轴是「能不能回」)
  // 返回 null = 不属于任何 tab,不在小程序里展示。
  tabOf(c) {
    const t = parseInt(c.type) || 1;
    // 群聊(type=4)不在小程序露出:微信里已经有群,小程序内做群聊是和宿主抢用户,
    // 且小程序切后台 5 秒断长连接,实时聊天先天残废。群留给原生 app —— 后端 getOrCreateClubGroup
    // 等地基仍在,app 接手时直接调。这里必须显式排除,不能让它掉进 dm 兜底:
    // 两端共用 /api/im/conversations,app 一旦真建了群,靠兜底会让群会话冒进「私信」里。
    if (t === 4) return null;
    if (t === 2) return 'sys';
    return 'dm'; // 1 单聊 + 3 官方客服
  },

  // 重算 tabs(含未读角标)与当前 tab 的可见列表
  refreshView() {
    const list = this.data.list;
    const that = this;
    const count = function (key) {
      return list.reduce(function (n, c) {
        // 角标口径必须与全局红点一致:静音会话不计(T1 已让 sumUnread 排除 muted)
        if (that.tabOf(c) !== key || c.muted == 1) return n;
        return n + (parseInt(c.unread) || 0);
      }, 0);
    };
    this.setData({
      tabs: [
        { key: 'dm', label: '私信', badge: count('dm') },
        { key: 'sys', label: '系统', badge: count('sys') },
      ],
      viewList: list.filter(function (c) { return that.tabOf(c) === that.data.activeTab; })
        .map(function (c) { if (c._open || c.offset) { c.offset = 0; c._open = false; } return c; }),
      // R4 #3:「全部已读」按钮的禁用态判据,与 onReadAll 里 ids 的筛选条件同源。
      // 只算露出的会话(tabOf 非 null):点不到的东西不该让按钮亮着,也不该被「全部已读」悄悄标掉。
      hasUnread: list.some(function (c) { return c.unread > 0 && that.tabOf(c) !== null; }),
    });
  },

  onTabChange(e) {
    this.setData({ activeTab: e.detail.key });
    this.refreshView();
  },

  goPredictInbox() { wx.navigateTo({ url: '/pages/merchant/predict/index' }); },

  /**
   * 这一条只对**能结算竞猜的人**出现,所以问的是身份,不是待办条数。
   *
   * ⚠️ 不在这儿拉待办列表:那要静默吞掉「不是商家」这个正常回执,而同一段静默
   * 也会把真的网络失败一起吞掉 —— 商家就再也收不到提醒,且没有任何痕迹。
   * 身份问一次、条数留给页面自己说,这一行只负责「有这么个地方」。
   */
  loadMerchantEntry() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      data: {},
      success(res) {
        const ok = res && (res.code == '200' || res.code === 200);
        const access = normalizeMerchantAccess(ok ? res.data : null);
        that.setData({ canSettlePredict: !!(access.active && access.canManageProjects) });
      },
      fail() { that.setData({ canSettlePredict: false }); },
    });
  },

  // 空态 CTA:私信→广场(帖文已降级为非 tab 页面,改为 navigateTo)
  onEmptyCta() {
    const tab = this.data.activeTab;
    if (tab === 'dm') { wx.navigateTo({ url: '/pages/square/list/index' }); }
  },

  fmtPreview(c) {
    const t = c.lastMsgType;
    if (t == 2) return '[图片]';
    if (t == 3) return c.lastMsgText || '[系统卡片]';
    return c.lastMsgText || '';
  },

  fmtTime(v) {
    if (!v) return '';
    // 时刻锚定 +08:00,日历判断与显示字段一律走中国时区,不用本地 getHours/toDateString——
    // 手机时区非 UTC+8 时,本地方法会把中国的"今天 14:30"显示成别的日期/时刻。
    const ts = toTimestamp(v);
    if (isNaN(ts)) return '';
    const nowTs = Date.now();
    const diff = (nowTs - ts) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    const parts = chinaParts(ts);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (chinaDateKey(ts) === chinaDateKey(nowTs)) return pad(parts.hours) + ':' + pad(parts.minutes);
    if (chinaDateKey(ts) === chinaDateKey(nowTs - 86400000)) return '昨天';
    if (diff < 7 * 86400) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parts.weekday];
    return parts.month + '月' + parts.day + '日';
  },

  // ===== 左滑 =====
  onTouchStart(e) {
    this._sx = e.touches[0].clientX;
    this._sy = e.touches[0].clientY;
    this._moved = false;
  },
  onTouchMove(e) {
    const idx = e.currentTarget.dataset.index;
    const row = this.data.viewList[idx];
    if (!row) return;
    const dx = e.touches[0].clientX - this._sx;
    const dy = e.touches[0].clientY - this._sy;
    if (Math.abs(dx) < Math.abs(dy)) return; // 纵向滚动不处理
    this._moved = true;
    const base = row._open ? -this._openPx : 0;
    let off = base + dx;
    if (off > 0) off = 0;
    if (off < -this._openPx) off = -this._openPx;
    const patch = { ['viewList[' + idx + '].offset']: off };
    // 拖拽期间关掉 .conv 的 transition,避免每帧 setData 都被缓动重新补间(P1-2:追手指而非跟手指)。
    // 只在确认横向手势后置一次:点击与纵向滚动占绝大多数触摸,不该替它们付 setData 的钱。
    if (!row._dragging) patch['viewList[' + idx + ']._dragging'] = true;
    this.setData(patch);
  },
  // 同时挂在 touchend 与 touchcancel 上:触摸被系统事件/父级 scroll-view 打断时只发 touchcancel,
  // 少了它 _dragging 会永久卡 true(transition:none 常驻),且 refreshView 只重置 offset/_open、清不掉它。
  onTouchEnd(e) {
    const idx = e.currentTarget.dataset.index;
    const off = this.data.viewList[idx] ? this.data.viewList[idx].offset : 0;
    const open = off < -this._openPx / 2;
    this.setData({
      ['viewList[' + idx + '].offset']: open ? -this._openPx : 0,
      ['viewList[' + idx + ']._open']: open,
      ['viewList[' + idx + ']._dragging']: false,
    });
  },
  closeRow(idx) {
    this.setData({ ['viewList[' + idx + '].offset']: 0, ['viewList[' + idx + ']._open']: false });
  },

  onRowRead(e) {
    const id = e.currentTarget.dataset.id;
    const idx = e.currentTarget.dataset.index;
    const that = this;
    app.sendRequest({
      url: '/api/im/read', method: 'POST', hideLoading: true,
      data: { conversation_id: id },
      // ⚠️ success() 被调用不等于服务端做成了:HTTP 200 + 业务 code!=200 也走这里。
      // 不判 code 就直接把未读清零,是给用户一个假回执。
      success(res) {
        if (!isBizOk(res)) { app.tips && app.tips((res && res.msg) || '标记已读失败'); return; }
        const li = that.data.list.findIndex(function (c) { return c.conversationId === id; });
        if (li >= 0) that.setData({ ['list[' + li + '].unread']: 0 });
        that.closeRow(idx);
        that.refreshView();
      },
      fail() { app.tips && app.tips('操作失败'); },
    });
  },

  onRowDelete(e) {
    const id = e.currentTarget.dataset.id;
    const idx = e.currentTarget.dataset.index;
    this._pendingDelete = { id: id, idx: idx };
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('im.conversation.delete');
  },

  onDangerConfirm(e) {
    if (e.detail.key !== 'im.conversation.delete') return;
    const pending = this._pendingDelete;
    if (!pending) return;
    const that = this;
    const id = pending.id;
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/im/delete', method: 'POST', hideLoading: true,
      data: { conversation_id: id },
      // 同上:业务失败时会话其实还在,不能从列表里抹掉再报「已删除」。
      success(res) {
        if (!isBizOk(res)) { if (dc) dc.failed((res && res.msg) || '删除失败'); return; }
        const list = that.data.list.filter(function (c) { return c.conversationId !== id; });
        that.setData({ list: list });
        that.refreshView();
        that._pendingDelete = null;
        if (dc) dc.done();
      },
      fail() { if (dc) dc.failed('删除失败'); },
    });
  },

  onDangerCancel() {
    const pending = this._pendingDelete;
    this._pendingDelete = null;
    if (pending) this.closeRow(pending.idx);
  },

  onRowMute(e) {
    const id = e.currentTarget.dataset.id;
    const idx = e.currentTarget.dataset.index;
    const that = this;
    const cur = this.data.viewList[idx];
    if (!cur) return;
    const prevMuted = cur.muted; // 基本类型拷贝:viewList[idx] 与 list[li] 是同一引用(refreshView 的 filter/map 不克隆),setData 路径写法会就地污染 cur,不能再用 cur.muted 回滚
    const next = (prevMuted == 1) ? 0 : 1;
    const li = this.data.list.findIndex(function (c) { return c.conversationId === id; });
    if (li < 0) return;
    // 乐观更新
    this.setData({ ['list[' + li + '].muted']: next });
    this.refreshView();
    this.closeRow(idx);
    app.sendRequest({
      url: '/api/im/mute', method: 'POST', hideLoading: true,
      data: { conversation_id: id, muted: next },
      success(res) {
        if (!(res && res.code == 200)) {
          // 回滚,不留假状态
          that.setData({ ['list[' + li + '].muted']: prevMuted });
          that.refreshView();
          app.tips && app.tips((res && res.msg) || '操作失败');
          return;
        }
        toast(next ? '已开启免打扰' : '已关闭免打扰');
      },
      fail() {
        that.setData({ ['list[' + li + '].muted']: prevMuted });
        that.refreshView();
        app.tips && app.tips('操作失败');
      },
    });
  },

  onBack() { wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/index/index' }); } }); },

  onReadAll() {
    const that = this;
    const ids = this.data.list.filter(function (c) {
      return c.unread > 0 && that.tabOf(c) !== null;
    }).map(function (c) { return c.conversationId; });
    if (ids.length === 0) { toast('没有未读消息'); return; }
    // ⚠️ 原实现用 complete() 计数:断网、HTTP 错误、业务失败全都会走到 complete,
    // 于是一条都没成功也照样弹「已全部标为已读」。改成分别记成功数与失败数,
    // 只有全成功才报成功;有失败就如实说明还剩几条。
    let done = 0;
    let failed = 0;
    ids.forEach(function (id) {
      app.sendRequest({
        url: '/api/im/read', method: 'POST', hideLoading: true,
        data: { conversation_id: id },
        success(res) { if (!isBizOk(res)) failed++; },
        fail() { failed++; },
        complete() {
          done++;
          if (done === ids.length) {
            that.loadConversations(true);
            if (failed === 0) {
              toast.success('已全部标为已读');
            } else if (failed === ids.length) {
              app.tips && app.tips('标记已读失败，请重试');
            } else {
              app.tips && app.tips('还有 ' + failed + ' 条没标记成功,请重试');
            }
          }
        },
      });
    });
  },

  openChat(e) {
    if (this._moved) { this._moved = false; return; } // 滑动中不触发跳转
    const ds = e.currentTarget.dataset;
    wx.navigateTo({
      url: '/subpackageB/pages/im/chat/index?conversationId=' + ds.id +
        '&name=' + encodeURIComponent(ds.name || '') +
        '&avatar=' + encodeURIComponent(ds.avatar || '') +
        '&type=' + (ds.type || 1),
    });
  },
});
