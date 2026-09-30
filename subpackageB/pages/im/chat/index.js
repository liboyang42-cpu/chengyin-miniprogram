const { toTimestamp, chinaDateKey, chinaParts } = require('../../../../utils/datetime');
const { isRecordList, isBizOk } = require('../../../../utils/response-shape.js');
const app = getApp();

Page({
  _closedReturnPath: '/subpackageB/pages/im/list/index',
  data: {
    plusSheetShow: false,
    plusSheetItems: ['图片', '位置', '路线'],
    moreSheetShow: false,
    // CU-C-120:系统通知(type=2)没有可交流的对象,举报/拉黑的目标也是空的 ⇒ 面板只留真能做的清空聊天。
    // 初始值按可回复的私信给,onLoad 里再按会话类型收窄(见 _moreItemsFor)。
    moreSheetItems: ['举报', '拉黑', '清空聊天'],
    // 只读会话:能读不能写。判据只有「对方是不是一个可交流的人」,不是 loadState。
    readOnly: false,
    readOnlyTip: '系统通知，不能回复',
    statusBarHeight: 20,
    navBarHeight: 44,
    headerH: 64,
    heroH: 0,
    inputH: 60,
    safeBottom: 0,
    conversationId: 0,
    name: '',
    // hero 上的会话身份:name 为空(坏链接/未传参)时按会话类型兜底,不留无名头像(截图 060)。
    // 与 name 分开存:气泡上方的发送人名仍必须是真名,不能被兜底串污染。
    heroName: '',
    avatar: '',
    // loading | ready | error | missing | closed —— 「还没有消息」只属于 ready。
    // 原来只有 success 分支:网络失败、会话不存在、真的没消息,三种状态全渲染成空对话。
    loadState: 'loading',
    loadErrorText: '',
    type: 1,
    myId: 0,
    myAvatar: '',
    msgs: [],
    reviewResult: null,
    text: '',
    sending: false,
    hasMore: false,
    cursor: 0,
    loadingMore: false,
    loadMoreError: '',
    toView: '',
    disabled: false,
    disabledText: '',
    // 非 ready 时输入栏为什么点不动,按真实原因给一句话。做成静态映射(而不是每个 setData
    // 站点各写一次)是为了不漏:loadState 的落点很多,漏一处就又变成"没有原因的死输入栏"。
    sendBlockedMap: {
      loading: '消息加载中…',
      missing: '链接已失效，回消息列表重新进入',
      closed: '组局已结束，不能继续聊天',
      error: '消息没加载出来，点上方「重试」再试',
    },
    topicCache: {},
    routePickerOpen: false,
    routeKeyword: '',
    routeList: [],
    routeLoading: false,
    routeError: '',
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
    const sb = (app.globalData && app.globalData.statusBarHeight) || 20;
    const nav = (app.globalData && app.globalData.navBarHeight) || 44;
    let safe = 0;
    let winW = 375;
    try {
      const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      safe = (w.safeArea ? (w.screenHeight - w.safeArea.bottom) : 0);
      if (w.windowWidth) winW = w.windowWidth;
    } catch (e) {}
    const type = parseInt(options.type) || 1;
    const conversationId = parseInt(options.conversationId) || 0;
    const name = decodeURIComponent(options.name || '');
    // hero 区(顶栏下方居中会话名,不再放头像)高度:先按内容粗估作首屏占位,
    // onReady 里再用 boundingClientRect 实测覆正——避免手工凑 rpx 数字跟 wxss 实际布局对不齐。
    const heroGuessRpx = 96;
    // CU-C-120:系统通知是「平台→你」的单向推送,后端 counterparty.id 恒为 0。
    // 原来它和私信共用同一套输入栏/举报/拉黑:能打字、能点发送,发出去才红一个气泡,
    // 拉黑/举报的目标又不是任何人。可供性必须在进入前就收窄,不是等后端拒绝。
    const readOnly = type === 2;
    this.setData({
      statusBarHeight: sb,
      navBarHeight: nav,
      headerH: sb + nav,
      heroH: Math.round(heroGuessRpx * winW / 750),
      safeBottom: safe,
      inputH: 60 + safe / 2,
      conversationId: conversationId,
      name: name,
      heroName: this._heroName(name, type),
      avatar: decodeURIComponent(options.avatar || ''),
      type: type,
      readOnly: readOnly,
      moreSheetItems: readOnly ? ['清空聊天'] : ['举报', '拉黑', '清空聊天'],
      myId: app.getUserID(),
      myAvatar: app.getAvatar(),
    });
    // 坏链接(没有 conversationId)不是「空对话」:不打后端,也不给可用输入栏。
    if (!conversationId) { this.setData({ loadState: 'missing' }); return; }
    /* CU-M-125:系统通知(type=2,后端 ImConversation.TYPE_SYSTEM)没有收件人,走查实测发出去
       只生成一条失败气泡、重试仍失败。这一页此前只按 loadState 渲染输入区,等于给了一条
       必然失败的私信输入栏 ⇒ 按只读渲染并说明原因。
       注:后端 ImServiceImpl.send 只有成员闸与群闸,没有按会话类型的只读闸;
       服务端要不要一并挡写入是后端的事,这里修的是用户看得见的那一半。
       type=3 官方客服按现状仍可写,不在这个闸里。 */
    if (type == 2) this.setData({ disabled: true, disabledText: '系统通知不支持回复，有新动态会出现在这里' });
    this.loadMessages(true);
  },

  // 会话身份兜底:只按会话类型给通用称呼,绝不臆造对方昵称。
  _heroName(name, type) {
    if (name) return name;
    if (type == 2) return '系统通知';
    if (type == 3) return '官方消息';
    return '对话';
  },

  // 发送闸:守在**每个真发 /api/im/send 的出口**上,不只守入口。
  // (只挡 onPlus 的话,任何绕过动作面板的调用路径都能照旧把 conversation_id:0 发出去)
  _canSend() { return this.data.loadState === 'ready' && !this.data.disabled && !this.data.readOnly; },

  retryLoad() {
    this.setData({ loadState: 'loading', loadErrorText: '' });
    this.loadMessages(true);
  },

  onReady() {
    // 实测 hero 区真实高度,覆正 onLoad 里的粗估值,消息流让位量与之同步(见 wxml scroll-view top)
    const that = this;
    this.createSelectorQuery().select('.chat-hero').boundingClientRect(function (rect) {
      if (rect && rect.height) that.setData({ heroH: Math.round(rect.height) });
    }).exec();
  },

  loadMessages(toBottom) {
    const that = this;
    const requestEpoch = (this._messageRequestEpoch || 0) + 1;
    this._messageRequestEpoch = requestEpoch;
    app.sendRequest({
      url: '/api/im/messages', method: 'POST', hideLoading: true, silentError: true,
      data: { conversation_id: this.data.conversationId, cursor_id: 0, size: 30 },
      success(res) {
        if (requestEpoch !== that._messageRequestEpoch) return;
        if (res && res.code == 200 && res.data && typeof res.data === 'object' && !Array.isArray(res.data)
            && (res.data.list == null || isRecordList(res.data.list))) {
          const list = that.decorate(Array.isArray(res.data.list) ? res.data.list : []);
          const pending = that.data.msgs.filter(m => m.sendPayload && !list.some(server =>
            server.clientMessageId === m.clientMessageId && server.senderId == m.senderId));
          const msgs = list.concat(pending);
          that.setData({ msgs, sending: msgs.some(m => m.sending), hasMore: !!res.data.hasMore, cursor: res.data.nextCursor || 0, loadState: 'ready', loadErrorText: '', loadMoreError: '' });
          // 拉黑只存服务端:重进会话按回包禁用输入框,不然能打字、一发就失败(3-22)
          if (res.data.blocked === true) {
            that.setData({ disabled: true, disabledText: res.data.blockedByMe === true ? '你已拉黑对方，无法发送消息' : '对方暂不可联系，无法发送消息' });
          }
          if (toBottom) that.scrollBottom();
          that.markRead();
          return;
        }
        that._setMessageLoadError(res);
      },
      fail(res) {
        if (requestEpoch !== that._messageRequestEpoch) return;
        that._setMessageLoadError(res);
      },
      successStatusAbnormal(res) {
        if (requestEpoch !== that._messageRequestEpoch) return;
        that._setMessageLoadError(res);
      },
    });
  },

  _setMessageLoadError(response) {
    if (response && response.errorCode === 'HANGOUT_CLOSED') {
      this._closedReturnPath = response.returnPath || '/subpackageB/pages/im/list/index';
      this.setData({ loadState: 'closed', loadErrorText: response.msg || '该组局已结束，聊天已关闭' });
      return;
    }
    const msg = app.getRequestErrorMessage
      ? app.getRequestErrorMessage(response, '消息加载失败，请重试')
      : ((response && (response.msg || response.errMsg)) || '消息加载失败，请重试');
    this.setData({ loadState: 'error', loadErrorText: msg });
  },

  returnToMessageList() {
    const path = this._closedReturnPath || '/subpackageB/pages/im/list/index';
    wx.redirectTo({ url: path });
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    const that = this;
    const cursor = this.data.cursor;
    this.setData({ loadingMore: true, loadMoreError: '' });
    app.sendRequest({
      url: '/api/im/messages', method: 'POST', hideLoading: true, silentError: true,
      data: { conversation_id: this.data.conversationId, cursor_id: cursor, size: 30 },
      success(res) {
        if (res && res.code == 200 && res.data && typeof res.data === 'object' && !Array.isArray(res.data)
            && (res.data.list == null || isRecordList(res.data.list))) {
          that._mergeMessages(Array.isArray(res.data.list) ? res.data.list : [], true);
          that.setData({ hasMore: !!res.data.hasMore, cursor: res.data.nextCursor || 0, loadingMore: false, loadMoreError: '' });
        } else {
          that._setLoadMoreError(res);
        }
      },
      fail(res) { that._setLoadMoreError(res); },
      successStatusAbnormal(res) { that._setLoadMoreError(res); },
    });
  },

  _setLoadMoreError(response) {
    const msg = app.getRequestErrorMessage
      ? app.getRequestErrorMessage(response, '更早消息加载失败，请重试')
      : ((response && (response.msg || response.errMsg)) || '更早消息加载失败，请重试');
    this.setData({ loadingMore: false, loadMoreError: msg });
  },

  retryLoadMore() { this.loadMore(); },

  // 加时间分隔 + 解析卡片(老卡片无 cardType → generic,走现有渲染路径)
  decorate(list) {
    let last = 0;
    const that = this;
    const decorated = list.map(function (m) {
      const t = m.createTime ? toTimestamp(String(m.createTime)) : 0;
      let divider = '';
      if (!last || (t - last) > 5 * 60 * 1000) divider = fmtAbs(t);
      last = t;
      let card = null;
      if (m.msgType == 3) {
        try { card = JSON.parse(m.extraJson || '{}'); } catch (e) { card = {}; }
        if (!card.cardType) card.cardType = 'generic';
        if (card.cardType === 'generic' && !card.title) card.title = m.content || '通知';
      }
      /* CU-M-124:这张通用卡过去无条件报成 aria-role=button「查看卡片详情」,但只有
         action / result / bcId 三种tap动作。没有去处的通知(如报名没挂主题的「报名成功」卡)
         于是每次都成了一次死点击。卡的可点性按真有的动作给,不猜路径。 */
      const cardTarget = !!(card && (card.action
          || (card.result && m.senderId == 0) || card.bcId));
      // 对方气泡上方「名字·时间」一行用的名字:单聊/客服/系统统一用会话对方名(name)。
      // 小程序不露出群聊(见 list/index.js:tabOf),故无需逐条 senderName。
      return Object.assign({}, m, { timeDivider: divider, card: card, cardTarget: cardTarget,
        displayName: that.data.name || '' });
    });
    that.fetchTopics(decorated);
    return decorated;
  },

  // route 卡现拉(spec 决策 8:永远最新)。去重 + 页面级缓存;
  // 一屏 30 条里路线卡通常 0-2 张,不值得为此加批量端点。
  fetchTopics(list) {
    const that = this;
    const cache = this.data.topicCache;
    const ids = [];
    list.forEach(function (m) {
      // route 与 signup 同构,共用现拉
      if (m.card && (m.card.cardType === 'route' || m.card.cardType === 'signup') && m.card.topicId) {
        const id = m.card.topicId;
        // 必须 === undefined:三态里 null 是「已确认下架」的终态答案,不是「还没拉」。
        // 用真值判断会把 null 当没拉过,对已下架主题每批 decorate 重发一次请求。
        if (cache[id] === undefined && ids.indexOf(id) < 0) ids.push(id);
      }
    });
    if (!ids.length) return;
    ids.forEach(function (id) {
      app.sendRequest({
        url: '/api/topic/info-to-user', method: 'POST', hideLoading: true,
        data: { id: id },
        success(res) {
          const d = (res && res.code == 200) ? res.data : null;
          // 拉不到/已下架 → 记 null,渲染层出降级态「该路线已下架」
          that.setData({ ['topicCache.' + id]: d || null });
        },
        fail() { that.setData({ ['topicCache.' + id]: null }); },
      });
    });
  },

  scrollBottom() {
    const that = this;
    setTimeout(function () { that.setData({ toView: 'bottom-anchor' }); }, 60);
  },

  onInput(e) { this.setData({ text: e.detail.value }); },

  onSend() {
    const content = (this.data.text || '').trim();
    if (!content || this.data.sending) return;
    if (!this._canSend()) return;
    if (this._disposed || (app.getUserID && app.getUserID() != this.data.myId)) return;
    this.setData({ text: '' });
    this._sendMessage({ msg_type: 1, content });
  },

  _sendMessage(message, retryId) {
    if (!this._canSend() || this._disposed) return;
    const owner = this.data.myId;
    const conversationId = this.data.conversationId;
    if (app.getUserID && app.getUserID() != owner) return;
    const payload = Object.assign({}, message, { conversation_id: conversationId });
    if (!payload.client_message_id) {
      this._sendSequence = (this._sendSequence || 0) + 1;
      payload.client_message_id = 'im_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + '_' + this._sendSequence;
    }
    const tmpId = retryId || 'tmp_' + payload.client_message_id;
    let msgs = this.data.msgs.slice();
    if (retryId) {
      const index = msgs.findIndex(m => m.id === retryId && m.failed && !m.sending);
      if (index < 0) return;
      msgs[index] = Object.assign({}, msgs[index], { sending: true, failed: false });
    } else {
      const card = payload.msg_type === 3 ? JSON.parse(payload.extra_json) : null;
      msgs.push({ id: tmpId, senderId: owner, msgType: payload.msg_type, content: payload.content,
        extraJson: payload.extra_json, card, clientMessageId: payload.client_message_id,
        sendPayload: payload, sending: true, failed: false, timeDivider: '' });
    }
    this.setData({ msgs, sending: true });
    this.scrollBottom();
    const current = () => !this._disposed && this.data.myId === owner && this.data.conversationId === conversationId
      && (!app.getUserID || app.getUserID() == owner);
    const finish = (res) => {
      if (!current()) return;
      const list = this.data.msgs.slice();
      const index = list.findIndex(m => m.id === tmpId);
      if (index >= 0) {
        const id = res && res.data && res.data.id;
        const validId = (typeof id === 'number' || (typeof id === 'string' && /^[1-9]\d*$/.test(id)))
          && Number.isSafeInteger(Number(id)) && Number(id) > 0;
        if (isBizOk(res) && validId) {
          list.splice(index, 1);
          this.setData({ msgs: list });
          this._mergeMessages([res.data]);
        } else {
          list[index] = Object.assign({}, list[index], { sending: false, failed: true });
          this.setData({ msgs: list });
          // 200 但 data.id 不合法时 msg 是「操作成功」,不能当失败提示(2026-09-17 拍板)。
          if (!isBizOk(res) && res && res.msg) app.tips && app.tips(res.msg);
        }
      }
      this.setData({ sending: this.data.msgs.some(m => m.sending) });
    };
    app.sendRequest({
      url: '/api/im/send', method: 'POST', hideLoading: true,
      data: payload, success: finish, fail: finish, successStatusAbnormal: finish,
    });
  },

  _mergeMessages(incoming, prepend) {
    const decorated = this.decorate(incoming);
    const list = prepend ? decorated : this.data.msgs.slice();
    const additions = prepend ? this.data.msgs : decorated;
    additions.forEach(message => {
      const index = list.findIndex(m => m.id == message.id || (message.clientMessageId
        && m.clientMessageId === message.clientMessageId && m.senderId == message.senderId));
      if (index >= 0) { if (!prepend) list[index] = message; }
      else list.push(message);
    });
    this.setData({ msgs: list, sending: list.some(m => m.sending) });
  },

  onResend(e) {
    const idx = e.currentTarget.dataset.index;
    const m = this.data.msgs[idx];
    if (!m || !m.failed || m.sending || m.senderId != this.data.myId || !m.sendPayload) return;
    this._sendMessage(m.sendPayload, m.id);
  },

  /* 2026-09-02:原来这两处弹 wx.showActionSheet(系统弹层,设计体系外)。
     「+」与「更多」是**动作菜单**不是一次选择,所以用 cy-option-sheet 的 immediate 形态
     —— 点一行立刻执行,不画单选圆点也不加确认 CTA(套确认反而多一步)。 */
  onPlus() {
    if (!this._canSend()) return;
    this.setData({ plusSheetShow: true });
  },

  onPlusSelect(e) {
    const i = e.detail.index;
    this.setData({ plusSheetShow: false });
    if (i === 0) this.onPickImage();
    else if (i === 1) this.onSendLocation();
    else if (i === 2) this.openRoutePicker();
  },

  onPlusCancel() { this.setData({ plusSheetShow: false }); },

  onSendLocation() {
    const that = this;
    wx.chooseLocation({
      success(loc) {
        that.sendCard({
          cardType: 'location',
          name: loc.name || loc.address,
          address: loc.address || '',
          lat: loc.latitude,
          lng: loc.longitude,
        });
      },
      fail(e) {
        // 用户取消不提示;权限被拒才引导
        if (e && String(e.errMsg || '').indexOf('auth deny') >= 0) {
          app.tips && app.tips('需要位置权限才能发送位置');
        }
      },
    });
  },

  // 发卡片:content 由服务端重建,这里传什么都不算数(T2 净化)
  sendCard(card) {
    this._sendMessage({ msg_type: 3, content: '[卡片]', extra_json: JSON.stringify(card) });
  },

  openRoutePicker() {
    this.setData({ routePickerOpen: true, routeKeyword: '' });
    this.loadRoutes();
  },
  closeRoutePicker() { this.setData({ routePickerOpen: false }); },

  onRouteSearch(e) {
    const kw = (e.detail && e.detail.value) || '';
    this.setData({ routeKeyword: kw });
    // 防抖:停止输入 300ms 后才发请求,避免每敲一个字打一次
    if (this._routeTimer) clearTimeout(this._routeTimer);
    const that = this;
    this._routeTimer = setTimeout(function () { that.loadRoutes(); }, 300);
  },

  loadRoutes() {
    const that = this;
    // 竞态守卫:只认最后一次请求的响应,防止先发的旧关键词后到、覆盖新结果
    const seq = (this._routeSeq || 0) + 1;
    this._routeSeq = seq;
    this.setData({ routeLoading: true, routeError: '', routeList: [] });
    app.sendRequest({
      url: '/api/topic/list', method: 'POST', hideLoading: true, silentError: true,
      data: { is_my: 0, keyword: this.data.routeKeyword },
      success(res) {
        if (seq !== that._routeSeq) return;            // 过期响应,丢弃
        if (res && res.code == 200 && res.data && typeof res.data === 'object' && !Array.isArray(res.data)
            && isRecordList(res.data.rows)) {
          that.setData({ routeList: res.data.rows, routeLoading: false, routeError: '' });
          return;
        }
        that._setRouteError(res);
      },
      fail(res) {
        if (seq !== that._routeSeq) return;            // 过期响应,丢弃
        that._setRouteError(res);
      },
    });
  },

  _setRouteError(response) {
    const msg = app.getRequestErrorMessage
      ? app.getRequestErrorMessage(response, '路线加载失败，请重试')
      : ((response && (response.msg || response.errMsg)) || '路线加载失败，请重试');
    this.setData({ routeList: [], routeLoading: false, routeError: msg });
  },

  retryRoutes() { this.loadRoutes(); },

  onRoutePick(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.closeRoutePicker();
    // 只传 topicId —— 展示字段服务端不收、前端现拉(spec 决策 8)
    this.sendCard({ cardType: 'route', topicId: id });
  },

  onPickImage() {
    const that = this;
    if (!this._canSend()) return;
    const owner = this.data.myId;
    const conversationId = this.data.conversationId;
    app.chooseImage(function (urls) {
      if (!urls || !urls.length || that.data.myId !== owner || that.data.conversationId !== conversationId) return;
      that._sendMessage({ msg_type: 2, content: urls[0] });
    });
  },

  markRead() {
    app.sendRequest({ url: '/api/im/read', method: 'POST', hideLoading: true, data: { conversation_id: this.data.conversationId } });
  },

  onMore() {
    this.setData({ moreSheetShow: true });
  },

  onMoreSelect(e) {
    const label = e.detail.label;
    this.setData({ moreSheetShow: false });
    if (label === '举报') this.doReport();
    else if (label === '拉黑') this.doBlock();
    else if (label === '清空聊天') this.clearConversation();
  },

  clearConversation() {
    const that = this;
    const id = this.data.conversationId;
    if (!id) { app.tips && app.tips('无法清空该会话'); return; }
    app.sendRequest({
      url: '/api/im/delete', method: 'POST', hideLoading: true,
      data: { conversation_id: id },
      success(res) {
        if (!isBizOk(res)) { app.tips && app.tips((res && res.msg) || '清空失败'); return; }
        wx.navigateBack({
          fail() { wx.redirectTo({ url: '/subpackageB/pages/im/list/index' }); },
        });
      },
      fail() { app.tips && app.tips('清空失败'); },
    });
  },

  onMoreCancel() { this.setData({ moreSheetShow: false }); },
  doReport() {
    // 没有「选中某条」的交互 ⇒ 只举报对方发的最近一条,绝不报自己的消息(3-22)
    let last = null;
    for (let i = this.data.msgs.length - 1; i >= 0; i--) {
      const m = this.data.msgs[i];
      if (m.id && String(m.id).indexOf('tmp_') !== 0 && m.senderId && m.senderId != this.data.myId) { last = m; break; }
    }
    if (!last) { app.tips && app.tips('暂无可举报的消息'); return; }
    app.sendRequest({
      url: '/api/im/report', method: 'POST', hideLoading: true,
      data: { message_id: last.id, reason: '用户举报' },
      success(res) { app.tips && app.tips(res && res.code == 200 ? '举报已提交' : (res.msg || '提交失败')); },
    });
  },
  doBlock() {
    // 单聊对方 id 需后端会话信息;此处用会话发起对象。简化:从最近一条对方消息取 senderId
    let otherId = 0;
    for (let i = this.data.msgs.length - 1; i >= 0; i--) { if (this.data.msgs[i].senderId && this.data.msgs[i].senderId != this.data.myId) { otherId = this.data.msgs[i].senderId; break; } }
    if (!otherId) { app.tips && app.tips('无法拉黑该会话'); return; }
    this._pendingBlockId = otherId;
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('im.block');
  },

  onDangerConfirm(e) {
    if (e.detail.key !== 'im.block') return;
    const otherId = this._pendingBlockId;
    if (!otherId) return;
    const that = this;
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/im/block', method: 'POST', hideLoading: true, data: { target_member_id: otherId },
      // ⚠️ success() 被调用不等于服务端拉黑成功(HTTP 200 + 业务 code!=200 也走这里)。
      // 不判 code 就禁用输入框并弹「已拉黑」,用户会以为对方发不进来了,实际没有。
      success(res) {
        if (!isBizOk(res)) { if (dc) dc.failed((res && res.msg) || '拉黑失败，请重试'); return; }
        that.setData({ disabled: true, disabledText: '你已拉黑对方，无法发送消息' });
        that._pendingBlockId = 0;
        if (dc) dc.done();
      },
      fail() { if (dc) dc.failed('拉黑失败，请重试'); },
    });
  },

  // 位置卡:写死 openLocation,不读 extra_json 里的 action(spec §3.3 防钓鱼)
  onLocationTap(e) {
    const ds = e.currentTarget.dataset;
    wx.openLocation({
      latitude: Number(ds.lat),
      longitude: Number(ds.lng),
      name: ds.name || '',
      address: ds.address || '',
      scale: 16,
    });
  },

  // 路线卡:写死主题详情,不读 extra_json 里的 action
  onRouteTap(e) {
    const id = e.currentTarget.dataset.topicid;
    if (!id) return;
    // 只在「确认下架」(null)时拦;加载中(undefined)放行 —— 详情页自己会加载
    if (this.data.topicCache[id] === null) { app.tips && app.tips('该路线已下架'); return; }
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + id });
  },

  onCardTap(e) {
    const ds = e.currentTarget.dataset;
    const message = this.data.msgs.find(item => String(item.id) === String(ds.msg));
    if (message && Number(message.senderId) === 0 && Number(message.msgType) === 3
        && message.card && message.card.result) {
      const result = message.card.result;
      this.setData({ reviewResult: { taskId: result.taskId, bizId: result.bizId,
        outcome: result.outcome, reason: result.reason, followUp: result.followUp } });
      return;
    }
    // FE-13 官方通知点击回流(best-effort)
    if (ds.bcid) {
      app.sendRequest({
        url: '/api/official/broadcast/' + ds.bcid + '/click', method: 'POST',
        hideLoading: true, data: { channel: 'inapp' }, success() {}, fail() {}
      });
    }
    if (ds.url) wx.navigateTo({ url: ds.url });
  },

  closeReviewResult() {
    this.setData({ reviewResult: null });
  },

  // 系统卡片可配置按钮:action 是路径则跳转;否则按 key 走业务(MVP 提示)
  onCardBtn(e) {
    const ds = e.currentTarget.dataset;
    if (ds.action && String(ds.action).indexOf('/') === 0) {
      wx.navigateTo({ url: ds.action });
    } else {
      app.tips && app.tips('已处理');
    }
  },

  // ===== 准实时:页面可见时轮询新消息 =====
  onShow() { this.startPoll(); },
  onHide() { this.stopPoll(); },
  onUnload() { this._disposed = true; this.stopPoll(); if (this._routeTimer) clearTimeout(this._routeTimer); },
  startPoll() {
    const that = this;
    this.stopPoll();
    // 坏链接(没有 conversationId)不许每 8s 拿 conversation_id:0 打后端 ——
    // 「不打后端」这条如果只在 onLoad 成立,onShow 一来就又破了。
    if (!this.data.conversationId) return;
    this._poll = setInterval(function () { that.pollNew(); }, 8000);
  },
  stopPoll() { if (this._poll) { clearInterval(this._poll); this._poll = null; } },
  maxLocalId() {
    let mx = 0;
    this.data.msgs.forEach(function (m) {
      const id = parseInt(m.id);
      if (!isNaN(id) && id > mx) mx = id;
    });
    return mx;
  },
  pollNew() {
    const that = this;
    const mx = this.maxLocalId();
    app.sendRequest({
      url: '/api/im/messages', method: 'POST', hideLoading: true,
      data: { conversation_id: this.data.conversationId, cursor_id: 0, size: 15 },
      success(res) {
        if (!(res && res.code == 200 && res.data && typeof res.data === 'object' && !Array.isArray(res.data)
              && isRecordList(res.data.list))) return;
        // 轮询读到了就是恢复了:必须解掉 error,否则一次瞬时失败会把错误卡钉在实时消息上方、
        // 输入栏一直禁用,只能靠用户手点「重试」才活过来。
        if (that.data.loadState !== 'ready') that.setData({ loadState: 'ready' });
        const fresh = (res.data.list || []).filter(function (m) {
          const id = parseInt(m.id);
          return !isNaN(id) && id > mx;
        });
        if (fresh.length) {
          that._mergeMessages(fresh);
          that.scrollBottom();
          that.markRead();
        }
      },
    });
  },


  onBack() { wx.navigateBack(); },
});

function fmtAbs(t) {
  if (!t) return '';
  // 今天/昨天是中国自然日概念,时刻与日历字段都走中国时区,不用本地 getHours/toDateString。
  const parts = chinaParts(t);
  if (!parts) return '';
  const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  const hm = pad(parts.hours) + ':' + pad(parts.minutes);
  const nowTs = Date.now();
  const key = chinaDateKey(t);
  if (key === chinaDateKey(nowTs)) return hm;
  if (key === chinaDateKey(nowTs - 86400000)) return '昨天 ' + hm;
  return parts.month + '月' + parts.day + '日 ' + hm;
}
