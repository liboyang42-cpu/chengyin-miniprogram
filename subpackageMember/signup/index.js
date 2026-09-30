const toast = require('../../utils/toast.js');
const { isPrefabLife } = require('../../utils/play-engine.js');
const app = getApp();
// UI-17 返修(2026-09-18):cy-nav-bar 是 fixed(fixed 导航不占文档流),页面正文必须自己让出
// 导航实高,否则卡片顶端会钻到导航底下被截掉一截(总控截图实证)。拿不到 globalData 时用兜底值。
const appGlobal = (app && app.globalData) || {};
Page({

  /**
   * 页面的初始数据
   */
  data: {
    /* 路线票 / 场次票两条支线的原始列表、加载状态、错误文案都挂在实例上(_topic / _activity),
       不进 data:合并成一条 ticketList 之后,wxml 渲染的只有合成结果,把原料也 setData
       一遍等于每次都往视图层多传两份没人渲染的表 —— U4 死数据字段门禁判的正是这个。
       ⚠️ 两条支线各留一份状态与错误文案:onLoad 处两个请求并发发出,共用一个字段会让
          后写的消息串到另一条支线下,也没法只重试挂掉的那一条。 */
    page_no: 1,//页码
    hasMore: false,//还有更多
    nodata: false,//暂无数据

    // UI-17 返修:导航实高 = 状态栏 + 标题栏。ready 态主容器用它做 padding-top,
    // 让整张票卡(从上到下)完整落在导航以下的安全区里。
    navTop: (appGlobal.statusBarHeight || 20) + (appGlobal.navBarHeight || 44),

    // 队伍数据来自 /api/team/my(ApiPlayTeamController:127,一次拉全量),本页由
    // loadMyTeams 按 ownerType:ownerId 与票对齐 —— 票夹会拉队伍。(2026-09-04 判定表
    // 记的「全仓零调用」已过时,别再照抄。)
    // ⚠️ 只在**这张票真有队伍**时出这一行;拉不到队伍列表就当没有,不摆一个点进去是空的入口。
    // 索引本身只有 js 读(渲染的是 currentTeam),所以挂 this._myTeams 不进 data ——
    // 进 data 等于每次都往视图层传一份没人渲染的表(U4 死数据字段门禁判的正是这个)。
    currentTeam: null,    // 当前这张票对应的队伍(没有就是 null)

    /* 2026-09-09 用户裁决:票夹不分「路线 / 场次」两个 tab,全部放一起。
       两种票在**后端**确实是两类(ownerType 1=路线票 2=场次票,走两个接口),
       但那是数据模型的区分,不是用户要做的选择 —— 用户打开票夹只想看「我有哪些票」。
       所以两个接口照旧各拉各的,只在渲染层合成一条 ticketList,每张票带 kind 决定点开跳哪。
       ⚠️ 不要为了「合并」去动后端:两类票的字段和落点本来就不同,合到一个接口只会把
          差异塞进 if,还丢掉各自的分页。 */
    ticketList: [],
    currentSwiperTicket: 0,
    walletState: 'loading', // loading | ready | error | empty —— 由两条支线的状态合成
    walletErrorMsg: '',
    slides: [],
    indicatorDots: true,
    vertical: false,
    autoplay: false,
    interval: 2000,
    duration: 500,
    topicBg: app.getImgUrl('zt1.jpg'),
    walletList: [{
      pic: app.getImgUrl('zt1.jpg'),
    }, {
      pic: app.getImgUrl('zt1.jpg'),
    }, {
      pic: app.getImgUrl('zt1.jpg'),
    }, {
      pic: app.getImgUrl('zt1.jpg'),
    }],
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const that = this;
    // 两条支线的原料。data 里没有它们,所以在这里立好,别让后面的 concat 撞上 undefined
    that._topic = { list: [], state: 'loading', err: '' };
    that._activity = { list: [], state: 'loading', err: '' };

    that.getActivityList()
    that.getTopicList()
    that.loadMyTeams()

    // §7.6:订单详情「继续探索/查看票夹」带 focusId 过来 → 定位到对应票卡
    if (options.focusId) {
      that._focusId = String(options.focusId);
      that._focusTries = 0;
      that._tryFocusTicket();
    }
  },

  // 轮询等票夹列表就绪,匹配 focusId(=registrationId,与票卡 item.id 一致)→ 切到对应子tab与 swiper 卡
  _tryFocusTicket() {
    const fid = this._focusId;
    if (!fid) return;
    const list = this.data.ticketList || [];
    const i = list.findIndex(x => String(x.id) === fid);
    if (i >= 0) {
      this._focusId = '';
      this.setData({ currentSwiperTicket: i, topicBg: list[i].wImg || this.data.topicBg });
      this.syncCurrentTeam();
      return;
    }
    if ((this._focusTries = (this._focusTries || 0) + 1) < 15) {
      setTimeout(() => this._tryFocusTicket(), 200);
    }
  },


  _openTicket(item, kind) {
    if (!item || !item.id) {
      toast('跳转失败');
      return;
    }
    const status = Number(item.registrationStatus);
    /* 2026-09-10 用户定的方向:**票夹点进去就是开始玩**。订单有订单的页面,
       而且这条路是单向的 —— 只有订单页能来票夹(scene-member-order-detail 的「查看票夹」),
       票夹不回订单。
       ⚠️ 待支付是唯一还会落到订单页的一档:它还不是一张票,是一笔没付完的单,
          付款就在那一页上,没有第二个地方能付。文案也照实写成「去支付」,不写「查看详情」。 */
    if (status === 1) {
      wx.navigateTo({ url: '/subpackageMember/orderinfo/orderinfo?id=' + item.id });
      return;
    }
    if (status === 3 || status === 4) {
      toast(status === 4 ? '票已过期' : '票已取消');
      return;
    }
    if (status !== 2) {
      toast('票状态待确认');
      return;
    }
    const ownerId = kind === 'activity'
      ? ((item.cmsActivity && item.cmsActivity.id) || item.ownerId)
      : ((item.cmsTopic && item.cmsTopic.id) || item.ownerId);
    if (!ownerId) {
      toast('场次信息待同步');
      return;
    }
    const query = kind === 'activity'
      ? ('activityId=' + ownerId)
      : ('topicId=' + ownerId);
    const ticketName = item.wTitle ? '&topicName=' + encodeURIComponent(item.wTitle) : '';
    const topic = item.cmsTopic || {};
    const activity = item.cmsActivity || {};
    const page = isPrefabLife({
      topicId: kind === 'topic' ? ownerId : (activity.topicId || (activity.cmsTopic && activity.cmsTopic.id)),
      engineKey: item.engineKey || item.experienceType || topic.engineKey || topic.experienceType
        || activity.engineKey || activity.experienceType,
    })
      ? '/subpackagePrefab/index?' : '/pages/play/index?';
    wx.navigateTo({ url: page + query + '&registrationId=' + item.id + '&entry=ticket' + ticketName });
  },

  // FE-19 票夹直连 play(主题/城市路线 ownerType=1):带 topicId + registrationId(供 play 出示入场码)
  // FE-19 票夹直连 play(活动/场次 ownerType=2):带 activityId + registrationId(供 play 出示入场码)
  /* 把两条支线合成一条给界面用。
     ★ 状态合成规则(顺序有意义):
       两边都还在 loading → loading;
       两边都 error      → error(只有一边 error 时,能拿到的那部分照常显示,不把整页判死);
       合起来有票        → ready;
       否则              → empty。
     这样「场次接口挂了但路线票还在」不会变成一片空白 —— 那是最容易被读成「我的票没了」的假象。 */
  /* 合并后的 swiper 只有一个，背景跟着当前那张票走。 */
  onTicketSwiperChange(e) {
    const i = e.detail.current;
    const item = (this.data.ticketList || [])[i] || {};
    this.setData({ currentSwiperTicket: i, topicBg: item.wImg || this.data.topicBg });
  },

  rebuildTicketList() {
    const topics = ((this._topic && this._topic.list) || []).map(function (item) {
      const t = item.cmsTopic || {};
      return Object.assign({}, item, {
        kind: 'topic',
        wKey: 'topic-' + item.id,
        wTitle: t.name || '路线信息待同步',
        wImg: t.imgUrl || '/images/route_city_cover.png',
      });
    });
    const activities = ((this._activity && this._activity.list) || []).map(function (item) {
      const a = item.cmsActivity || {};
      return Object.assign({}, item, {
        kind: 'activity',
        wKey: 'activity-' + item.id,
        wTitle: a.name || '活动信息待同步',
        wImg: a.imgUrl || '/images/route_city_cover.png',
      });
    });
    const list = topics.concat(activities);
    const ts = (this._topic || {}).state;
    const as = (this._activity || {}).state;
    let state;
    if (ts === 'loading' && as === 'loading') state = 'loading';
    else if (ts === 'error' && as === 'error') state = 'error';
    else if (list.length > 0) state = 'ready';
    else if (ts === 'loading' || as === 'loading') state = 'loading';
    else state = 'empty';
    const cur = list[this.data.currentSwiperTicket] || list[0] || {};
    this.setData({
      ticketList: list,
      walletState: state,
      walletErrorMsg: (this._topic || {}).err || (this._activity || {}).err || '',
      topicBg: cur.wImg || this.data.topicBg,
    });
  },

  /* 点开一张票。两种票的落点不同,由 kind 分流 —— 这就是合并列表之后
     唯一还需要区分两类票的地方。 */
  goTicket(e) {
    const index = e.currentTarget.dataset.index;
    const item = (this.data.ticketList || [])[index];
    if (!item) return;
    this._openTicket(item, item.kind === 'activity' ? 'activity' : 'topic');
  },

  /* 重试。哪条支线错了就重拉哪条;两条都错就都拉。 */
  retryWallet() {
    if ((this._topic || {}).state === 'error') this.retryTopic();
    if ((this._activity || {}).state === 'error') this.retryActivity();
  },

  /* 我的队伍。票夹一次拉全量,再按 ownerType:ownerId 落到具体那张票上 ——
     每张票各发一次请求会把一屏刷成 N 个请求。
     silentError:队伍拉不到只是这一行不出,不该拿一个全局 toast 盖在票夹上说「出错了」。 */
  loadMyTeams() {
    const that = this;
    app.sendRequest({
      url: '/api/team/my', method: 'POST', hideLoading: true, silentError: true,
      data: {},
      success(res) {
        const rows = res && res.code == '200' && Array.isArray(res.data) ? res.data : null;
        if (!rows) return;            // 读不到 ≠ 没有队伍,保持这一行不出,不写一个空态
        const index = {};
        for (let i = 0; i < rows.length; i++) {
          const t = rows[i];
          if (!t || !t.id || !t.ownerId) continue;
          // 已结束 / 已解散的队伍不给入口:点进去只会看到一个死队伍
          if (Number(t.status) === 3 || Number(t.status) === 4) continue;
          index[Number(t.ownerType) + ':' + Number(t.ownerId)] = {
            id: t.id,
            title: String(t.title || '').trim(),
            joinedCount: t.joinedCount == null ? null : Number(t.joinedCount),
            maxMembers: t.maxMembers == null ? null : Number(t.maxMembers),
          };
        }
        that._myTeams = index;
        that.syncCurrentTeam();
      },
    });
  },

  /* 票 → 队伍。ownerType 1=路线票 / 2=场次票,取 id 的口径与 _openTicket 同源。 */
  teamOf(item, kind) {
    if (!item) return null;
    const ownerId = kind === 'activity'
      ? ((item.cmsActivity && item.cmsActivity.id) || item.ownerId)
      : ((item.cmsTopic && item.cmsTopic.id) || item.ownerId);
    if (!ownerId) return null;
    return (this._myTeams || {})[(kind === 'activity' ? 2 : 1) + ':' + Number(ownerId)] || null;
  },

  /* 队伍列表比票列表晚到时,把当前那张票的队伍补上 */
  syncCurrentTeam() {
    const item = (this.data.ticketList || [])[this.data.currentSwiperTicket];
    if (!item) { this.setData({ currentTeam: null }); return; }
    this.setData({ currentTeam: this.teamOf(item, item.kind === 'activity' ? 'activity' : 'topic') });
  },

  goMyTeam() {
    const team = this.data.currentTeam;
    if (!team || !team.id) return;
    wx.navigateTo({ url: '/pages/team/detail/index?teamId=' + team.id });
  },

  // 主题swiper切换
  // 活动swiper切换

  // 两路都落定且只挂了一路:不出失败半屏,票夹照常显示另一路 —— 这时报一次,别让缺的那半静默
  _reportHalfFailure() {
    const t = this._topic || {}, a = this._activity || {};
    if (t.state === 'loading' || a.state === 'loading') return;
    const failed = [t, a].filter((x) => x.state === 'error');
    if (failed.length === 1) toast(failed[0].err || '部分票没加载出来');
  },

  getTopicList: function () {
    var that = this;
    that._topic = { list: (that._topic && that._topic.list) || [], state: 'loading', err: '' };
    that.rebuildTicketList();
    app.sendRequest({
      hideLoading: true,
      autoErrorToast: false,   // 两路都失败 = walletState error → auto-back 半屏;只挂一路见 _reportHalfFailure
      url: '/api/registration/list',
      method: "POST",
      data: {
        owner_type: 1,
        pageNum: that.data.page_no,
        pageSize: app.getPageSize(),
      },
      success: function (res) {
        const payload = res && res.data;
        if (!(res && res.code == "200" && payload && Array.isArray(payload.rows))) {
          that._topic = { list: that._topic.list, state: 'error',
            err: app.getRequestErrorMessage(res, '路线票加载失败') };
          that.rebuildTicketList();
          return;
        }
        const nextTopicList = that._topic.list.concat(payload.rows);
        that._topic = { list: nextTopicList, state: nextTopicList.length > 0 ? 'ready' : 'empty', err: '' };
        that.setData({
          hasMore: (app.getTotalPage(payload.total, app.getPageSize()) > that.data.page_no),
        });
        // 背景图跟着当前那张票走,由 rebuildTicketList 统一写(它知道现在停在哪一张)
        that.rebuildTicketList();
        that.syncCurrentTeam();
        if (payload.rows.length < 1) {
          that.setData({
            nodata: true,
          })
        }
      },
      fail: function (err) {
        // 原为空函数:请求失败被整个吞掉,列表停在 [] ⇒ 页面显示「还没有票!」= 错误伪装成空态
        that._topic = { list: that._topic.list, state: 'error',
          err: (err && err.errMsg) || '网络开了点小差' };
        that.rebuildTicketList();
      },
      complete: function () {
        that._reportHalfFailure();
        that.setData({
          nodata: that._topic.list.length < 1 ? true : false,
        })
      }
    })
  },

  // 错误态重试(cy-error 的 retry 事件)
  retryTopic() {
    this._topic = { list: [], state: 'loading', err: '' };
    this.getTopicList();
  },
  retryActivity() {
    this._activity = { list: [], state: 'loading', err: '' };
    this.getActivityList();
  },

  getActivityList: function () {
    var that = this;
    that._activity = { list: (that._activity && that._activity.list) || [], state: 'loading', err: '' };
    that.rebuildTicketList();
    app.sendRequest({
      hideLoading: true,
      autoErrorToast: false,   // 两路都失败 = walletState error → auto-back 半屏;只挂一路见 _reportHalfFailure
      url: '/api/registration/list',
      method: "POST",
      data: {
        owner_type: 2,
        pageNum: that.data.page_no,
        pageSize: app.getPageSize(),
      },
      success: function (res) {
        const payload = res && res.data;
        if (!(res && res.code == "200" && payload && Array.isArray(payload.rows))) {
          that._activity = { list: that._activity.list, state: 'error',
            err: app.getRequestErrorMessage(res, '活动票加载失败') };
          that.rebuildTicketList();
          return;
        }
        const nextActivityList = that._activity.list.concat(payload.rows);
        that._activity = { list: nextActivityList,
          state: nextActivityList.length > 0 ? 'ready' : 'empty', err: '' };
        that.setData({
          hasMore: (app.getTotalPage(payload.total, app.getPageSize()) > that.data.page_no),
        });
        that.rebuildTicketList();
        that.syncCurrentTeam();
        if (payload.rows.length < 1) {
          that.setData({
            nodata: true,
          })
        }
      },
      fail: function (err) {
        // 原为空函数:请求失败被整个吞掉,列表停在 [] ⇒ 页面显示「还没有票!」= 错误伪装成空态
        that._activity = { list: that._activity.list, state: 'error',
          err: (err && err.errMsg) || '网络开了点小差' };
        that.rebuildTicketList();
      },
      complete: function () {
        that._reportHalfFailure();
        that.setData({
          nodata: that._activity.list.length < 1 ? true : false,
        })
      }
    })
  },

})
