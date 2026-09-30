const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const { toTimestamp } = require('../../../utils/datetime');
const app = getApp();
/* 结果面板终态停留时长。发帖不跳页,收掉就留在广场。 */
const RESULT_SHEET_MS = 2000;
const analytics = require('../../../utils/analytics.js');
const { pickLocation, getCurrentLocation } = require('../../../utils/location/location-manager.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const {
  buildFeedPlaySubtitle,
  resolveFeedPlayCover,
  hasFeedPlayCover,
  resolveCompletionShareImage,
  isRoamResultShare,
  isCompletedShare,
} = require('../../../utils/feed-play-card.js');
const { remixTopicTemplate } = require('../utils/topic-template-remix.js');
const { isRecordList } = require('../../../utils/response-shape.js');
const publishIntent = require('../../../utils/publish/publish-intent.js');

// 开场倒计时文案:天/小时/分三档取整,不到 1 分钟按「即将开始」收口。
// 与 activity/list 的 fmtDur 同一套档位,避免两处对同一活动给出不同口径。
function fmtCountdown(ms) {
  // 不足 1 分钟说「马上开始」而不是「即将开始」:横幅左上角的 kicker already 写着
  // 「即将开始」,同一行重复两遍读起来像渲染出错。
  if (!(ms > 0)) return '马上开始';
  var h = Math.floor(ms / 3600000);
  if (h >= 24) return Math.floor(h / 24) + ' 天后开始';
  if (h >= 1) return h + ' 小时后开始';
  var m = Math.floor(ms / 60000);
  return m >= 1 ? m + ' 分钟后开始' : '马上开始';
}

function feedIndexFromEvent(e) {
  if (e && e.detail && e.detail.index !== undefined) return e.detail.index;
  return e && e.currentTarget && e.currentTarget.dataset
    ? e.currentTarget.dataset.index
    : undefined;
}

Page({
  data: {
    resultSheet: { show: false, kind: 'success', title: '', sub: '', meta: '', pill: '',
      why: '', duration: RESULT_SHEET_MS },
    list: [],//列表数组
    page_no: 1,//页码
    hasMore: false,//还有更多
    nodata: false,//暂无数据
    loadError: false,
    loadMoreError: '',
    isLoadingMore: false,
    listLoading: true,// 首屏取列表中:骨架屏用。默认 true —— onLoad 到首个响应之间也是加载中,
                      // 默认 false 会让首帧闪一下空白再出内容(2026-08-18 A07 拍到的就是那一屏纯黑)
    isSticky: false,
    userId: 0,

    postActionShow: false,   // H050/H051 三合一操作弹层(编辑/删除/举报)
    // 当前点击的列表项索引 2026-09-16 起是实例属性 this._actionIndex(三合一弹层不渲染它,
    // 只作行定位用的内部状态;setData 死数据字段门禁对 A2「只当内部状态」判红)
    currentActionId: '', currentActionSummary: '',   // 当前操作帖的 id / 正文前段(给 cy-post-actions;摘要用于 CU-C-107 的删除确认)
    currentActionOwner: false, // 当前操作帖是不是本人的(决定编辑/删除行是否出现)

    avatar: '',
    nickname: '',

    address: '',
    longitude: '',
    latitude: '',
    valCont: '',
    composeShow: false,      // 新建帖文弹窗
    avatarPopShow: false,    // 点头像的 T5 胶囊
    avatarPopAnchor: null,
    avatarPopItems: [],
    composePrefill: '',      // 展开时把行内已写的正文带进弹窗
    canSubmit: false,
    submitting: false,
    submitError: '',
    submitErrorKind: 'data',
    switch1Checked: false, // 是否参与众筹投票，默认参与
    picList: [],
    fileList: [],
    // 关联运动feed:选中的已通关活动
    selectedActivity: null,
    activityPickerShow: false,

    // 「即将开始」聚合横幅:null = 当前没有临近活动 ⇒ 整块不渲染(不留空标题)
    upcoming: null,
    upcomingCards: [],

    // 地图抽屉（浮在帖文上层，上滑收起）
    pageH: 667,
    tabBarH: 100,
    drawerPeekH: 80,
    drawerCapsuleH: 88,
    drawerDockBarH: 80,
    drawerDockH: 100,
    drawerExpandedH: 600,
    drawerH: 600,
    drawerCollapsed: false,
    drawerSnapping: false,
    statusBarHeight: 44,
    navBarHeight: 44,
    mapLatitude: 31.2304,
    mapLongitude: 121.4737,
    mapScale: 14,

    // tabBar 控制(同步模板页:向下滚隐藏,停止再升起)
    tabBarRaised: true,
    lastScrollTop: 0,
    scrollStopTimer: null,
    
    // 新增：页面是否正在刷新
    isRefreshing: false
  },

  // 新增：图片加载完成事件
  onImageLoad: function(e) {
    const itemIndex = e.currentTarget.dataset.itemIndex;
    const picIndex = e.currentTarget.dataset.picIndex;
    const { width, height } = e.detail;
    
    // 计算宽高比
    const aspectRatio = width / height;
    
    // 计算基于固定高度的宽度（固定高度600rpx）
    const fixedHeight = 600; // 固定高度600rpx
    let calculatedWidth = fixedHeight * aspectRatio;
    
    // 限制最大宽度，避免过宽
    const maxWidth = 1000;
    const finalWidth = calculatedWidth > maxWidth ? maxWidth : calculatedWidth;
    
    // 确保最小宽度
    const minWidth = 200;
    const finalWidthWithMin = finalWidth < minWidth ? minWidth : finalWidth;
    
    // 获取当前列表项
    const list = this.data.list;
    if (itemIndex >= 0 && itemIndex < list.length) {
      const item = list[itemIndex];
      
      // 初始化imageWidths和imageHeights数组
      if (!item.imageWidths) item.imageWidths = [];
      if (!item.imageHeights) item.imageHeights = [];
      
      // 更新宽度和高度
      item.imageWidths[picIndex] = finalWidthWithMin;
      item.imageHeights[picIndex] = fixedHeight;
      
      // 更新列表数据
      const key = `list[${itemIndex}]`;
      this.setData({
        [key]: item
      });
    }
  },

  lickClick(e) {
    var that = this
    let index = feedIndexFromEvent(e);
    let type = (e.detail && e.detail.type) || e.currentTarget.dataset.type;
    let item = that.data.list[index]
    if (!item || !item.id) return;
    let id = item['id']
    const requestKey = String(id);
    that._likeRequests = that._likeRequests || Object.create(null);
    if (that._likeRequests[requestKey]) return;
    that._likeRequests[requestKey] = true;
    
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/creativesquare/like',
      method: "POST",
      data: {
        id: id,
        type: type
      },
      success: function (res) {
        if (res.code != "200") {
          toast(res.msg || '操作失败');
          return;
        }
        let newlist = that.data.list
        let currentItem = newlist[index]
        
        if (type == 1) { // 点赞
          if (currentItem['isLiked'] == 0) {
            currentItem['likeCount'] = (currentItem['likeCount'] || 0) + 1
            currentItem['isLiked'] = 1
          } else if (currentItem['isLiked'] == 1) {
            currentItem['likeCount'] = (currentItem['likeCount'] || 1) - 1
            currentItem['isLiked'] = 0
          } else if (currentItem['isLiked'] == 2) {
            currentItem['likeCount'] = (currentItem['likeCount'] || 0) + 1
            currentItem['isLiked'] = 1
          }
        } else { // 踩一踩
          if (currentItem['isLiked'] == 0) {
            currentItem['isLiked'] = 2
          } else if (currentItem['isLiked'] == 1) {
            currentItem['likeCount'] = (currentItem['likeCount'] || 1) - 1
            currentItem['isLiked'] = 2
          } else if (currentItem['isLiked'] == 2) {
            currentItem['isLiked'] = 0
          }
        }
        
        // 更新列表数据
        const key = `list[${index}]`;
        that.setData({
          [key]: currentItem
        });
        analytics.track('content_like', {
          bizType: 'square',
          bizId: id,
          properties: {
            actionType: type,
            isLiked: currentItem.isLiked
          }
        });
      },
      fail: function (res) {
        toast('网络错误，请重试');
      },
      complete: function () {
        delete that._likeRequests[requestKey];
      }
    })
  },

  favoriteClick(e) {
    const index = feedIndexFromEvent(e);
    const item = this.data.list[index];
    if (!item || !item.id) return;
    const requestKey = String(item.id);
    this._favoriteRequests = this._favoriteRequests || Object.create(null);
    if (this._favoriteRequests[requestKey]) return;
    this._favoriteRequests[requestKey] = true;
    const next = item.isBookmarked == 1 ? 0 : 1;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/creativesquare/bookmark',
      method: 'POST',
      data: {
        id: item.id,
        bookmark: next,
        request_id: 'bookmark-' + item.id + '-' + next + '-' + Date.now().toString(36)
      },
      success: (res) => {
        if (!res || res.code != '200') {
          toast((res && res.msg) || '操作失败');
          return;
        }
        const current = this.data.list[index];
        if (!current || String(current.id) !== String(item.id)) return;
        const list = this.data.list.slice();
        current.isBookmarked = next;
        list[index] = current;
        this.setData({ list: list });
      },
      fail: () => toast('网络错误，请重试'),
      complete: () => { delete this._favoriteRequests[requestKey]; }
    });
  },

  followClick(e) {
    var that = this
    const index = feedIndexFromEvent(e);
    let topicList = that.data.list
    let item = topicList[index]
    if (!item || !item.memberId) return;
    const requestKey = String(item.memberId);
    that._followRequests = that._followRequests || Object.create(null);
    if (that._followRequests[requestKey]) return;
    that._followRequests[requestKey] = true;
    // R10-07:带上「期望状态」,丢响应后重试同一意图不会反转服务端关系。
    const intendedFollow = item.isFollowTheUser ? 0 : 1;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/user/follow/action',
      method: "POST",
      data: {
        follow_member_id: item['memberId'],
        follow: intendedFollow,
      },
      success: function (res) {
        if (res.code == "200") {
          const nextFollowState = intendedFollow;
          const nextList = topicList.slice();
          nextList[index] = Object.assign({}, topicList[index], { isFollowTheUser: nextFollowState });
          that.setData({ list: nextList });

          toast(nextFollowState ? '关注成功' : '已取消关注');
        } else {
          toast(res.msg || '操作失败');
        }
      },
      fail: function (res) {
        toast('网络错误，请重试');
      },
      complete: function () {
        delete that._followRequests[requestKey];
      }
    })
  },

  // 清除位置
  clearLocation: function () {
    this.setData({
      address: '',
      longitude: '',
      latitude: ''
    });
  },

  // 关联运动feed:打开/选择/清除「已通关活动」
  openActivityPicker: function () {
    this.setData({ activityPickerShow: true });
  },
  onActivityPickerClose: function () {
    this.setData({ activityPickerShow: false });
  },
  onActivitySelect: function (e) {
    const activity = e.detail.activity || null;
    if (activity) activity.routePreviewImg = e.detail.routePreviewImg || '';
    this.setData({
      selectedActivity: activity,
      activityPickerShow: false
    });
  },
  clearActivity: function () {
    this.setData({ selectedActivity: null });
  },

  // 显示操作弹层(卡片 more 入口)。行数据当场解析成 id / owner 交给组件,
  // 组件不认 index —— 列表随时可能刷新,index 到发请求时可能已经指错行。
  showAction: function (e) {
    const index = feedIndexFromEvent(e);
    const item = this.data.list[index] || {};
    this._actionIndex = index;
    this.setData({
      postActionShow: true,
      currentActionId: item.id == null ? '' : String(item.id),
      currentActionSummary: item.contents || '',
      currentActionOwner: !!(item.memberId && String(item.memberId) === String(this.data.userId))
    });
  },

  // 关闭操作弹层
  closePostActions: function () {
    this._actionIndex = -1;
    this.setData({
      postActionShow: false,
      currentActionId: '',
      currentActionSummary: '',
      currentActionOwner: false
    });
  },

  // H050/H051:三合一弹层的分发。delete 到这里时确认闸已在组件内部过完,不再自建第二道。
  onPostAction: function (e) {
    const action = ((e || {}).detail || {}).action;
    if (action === 'edit') { this.editCurrentSquarePost(); return; }
    if (action === 'delete') { this.deleteCurrentSquarePost(); return; }
    if (action === 'report') { this.reportSquare(); return; }
  },

  // 删除(H051):软删 + 归属校验都在后端;成功后本地摘掉这一行(与举报同一口径)。
  deleteCurrentSquarePost: function () {
    const index = this._actionIndex;
    const item = this.data.list[index];
    if (!item || !item.id || this._deletingPost) return;
    const that = this;
    const pa = this.selectComponent && this.selectComponent('#post-actions');
    this._deletingPost = true;
    app.sendRequest({
      hideLoading: true,
      url: '/api/creativesquare/delete',
      method: 'POST',
      data: { id: item.id },
      success(res) {
        that._deletingPost = false;
        if (res && res.code == '200') {
          if (pa) pa.deleteDone();
          const list = that.data.list.slice();
          list.splice(index, 1);
          that.setData({ list: list, nodata: list.length < 1 });
          that.closePostActions();
        } else if (pa) {
          pa.deleteFailed((res && res.msg) || '删除失败');
        }
      },
      fail() {
        that._deletingPost = false;
        if (pa) pa.deleteFailed('网络异常，请重试');
      }
    });
  },

  // 编辑(H050):行数据直接进新建面板的编辑态,正文预填、关联带上(不发图片/地点,后端保留原值)
  editCurrentSquarePost: function () {
    const index = this._actionIndex;
    const item = this.data.list[index];
    if (!item || !item.id) { this.closePostActions(); return; }
    this.closePostActions();
    // editPost 先落地、show 后翻:组件的 show 观察器要读到编辑数据(两次 setData 顺序确定)
    this.setData({ composeEdit: {
      id: String(item.id),
      contents: item.contents || '',
      dataId: item.dataId,
      dataType: item.dataType
    } });
    this.setData({ composeShow: true });
  },

  reportSquare: function () {
    const that = this;
    const index = that._actionIndex;
    const item = that.data.list[index];
    if (!item || !item.id) {
      that.closePostActions();
      return;
    }
    modal.show({
      title: '举报内容',
      content: '确认举报这条内容？举报后将提交平台审核。',
      confirmText: '举报',
      success(res) {
        if (!res.confirm) {
          return;
        }
        app.sendRequest({
          hideLoading: true,
          url: '/api/creativesquare/report',
          method: 'POST',
          data: {
            id: item.id
          },
          success(resp) {
            if (resp.code == '200') {
              const list = that.data.list.slice();
              list.splice(index, 1);
              that.setData({
                list: list,
                nodata: list.length < 1
              });
              toast('已提交举报');
            } else {
              toast(resp.msg || '举报失败');
            }
          },
          fail() {
            toast('网络异常，请重试');
          },
          complete() {
            that.closePostActions();
          }
        });
      }
    });
  },

  onReady() {
    // 使用 createSelectorQuery 获取滚动节点，这里以页面根节点为例
    const query = wx.createSelectorQuery().in(this);
    query.selectViewport().scrollOffset((res) => {
      if (res.scrollTop > 0) {
        this.setData({ isSticky: true });
      } else {
        this.setData({ isSticky: false });
      }
    }).exec();
  },

  // 帖文 scroll-view 滚动：地图继续上收 + tabBar 起落
  onFeedScroll(e) {
    const currentScrollTop = e.detail.scrollTop || 0;
    const isScrollingDown = currentScrollTop > this.data.lastScrollTop;
    const expandedH = this.data.drawerExpandedH;
    const peekH = this.data.drawerPeekH;
    const capsuleH = this.data.drawerCapsuleH;

    if (this.data.scrollStopTimer) {
      clearTimeout(this.data.scrollStopTimer);
    }

    if (this.data.drawerH < expandedH - 4) {
      var nextH = peekH - currentScrollTop;
      if (nextH < capsuleH) nextH = capsuleH;
      if (nextH > peekH) nextH = peekH;
      if (nextH !== this.data.drawerH) {
        this.setData({
          drawerH: nextH,
          drawerSnapping: false,
          drawerCollapsed: nextH <= peekH + 6
        });
      }
    }

    if (isScrollingDown && currentScrollTop > 50 && this.data.tabBarRaised) {
      this.setData({ tabBarRaised: false });
    }

    const scrollStopTimer = setTimeout(() => {
      this.setData({ tabBarRaised: true });
    }, 300);

    this.setData({
      lastScrollTop: currentScrollTop,
      scrollStopTimer
    });
  },

  noop: function () {},

  onDrawerTouchStart: function (e) {
    this._dragStartY = e.touches[0].clientY;
    this._dragStartH = this.data.drawerH;
    this.setData({ drawerSnapping: false });
  },

  onDrawerTouchMove: function (e) {
    var dy = e.touches[0].clientY - this._dragStartY;
    var peekH = this.data.drawerPeekH;
    var capsuleH = this.data.drawerCapsuleH;
    var expandedH = this.data.drawerExpandedH;
    var minH = this._dragStartH <= peekH + 8 ? capsuleH : peekH;
    var h = this._dragStartH + dy;
    if (h < minH) h = minH;
    if (h > expandedH) h = expandedH;
    this.setData({
      drawerH: h,
      drawerSnapping: false,
      drawerCollapsed: h <= peekH + 6
    });
  },

  onDrawerTouchEnd: function (e) {
    var endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : this._dragStartY;
    if (Math.abs(endY - this._dragStartY) < 8) {
      return;
    }
    var peekH = this.data.drawerPeekH;
    var capsuleH = this.data.drawerCapsuleH;
    var expandedH = this.data.drawerExpandedH;

    if (this._dragStartH <= peekH + 8) {
      var midCapsule = capsuleH + (peekH - capsuleH) * 0.4;
      var toCapsule = this.data.drawerH < midCapsule;
      this.setData({
        drawerSnapping: true,
        drawerH: toCapsule ? capsuleH : peekH,
        drawerCollapsed: !toCapsule
      });
      return;
    }

    var mid = peekH + (expandedH - peekH) * 0.45;
    var collapsed = this.data.drawerH < mid;
    this.setData({
      drawerSnapping: true,
      drawerH: collapsed ? peekH : expandedH,
      drawerCollapsed: collapsed
    });
  },

  collapseDrawer: function () {
    this.setData({
      drawerSnapping: true,
      drawerH: this.data.drawerPeekH,
      drawerCollapsed: true
    });
  },

  toggleDrawer: function () {
    if (this.data.drawerH < this.data.drawerExpandedH - 4) {
      this.expandDrawer();
    } else {
      this.collapseDrawer();
    }
  },

  expandDrawer: function () {
    this.setData({
      drawerSnapping: true,
      drawerH: this.data.drawerExpandedH,
      drawerCollapsed: false
    });
  },

  onUnload() {
    if (this.data.scrollStopTimer) {
      clearTimeout(this.data.scrollStopTimer);
    }
    this._feedRequestId = (this._feedRequestId || 0) + 1;
    if (this._feedRequestTask && typeof this._feedRequestTask.abort === 'function') {
      this._feedRequestTask.abort();
    }
    this._feedRequestInFlight = false;
    this._feedRequestTask = null;
    merchantTheme.merchantPageRestore();
  },

  // 点头像 → T5 胶囊(Figma 339:740):关注 / 访问个人主页。
  // 量不到锚点(老路径、或 selectorQuery 失手)就退回原来的直接跳转 ——
  // 稿子写死了「不许居中」,与其显示成错的形态,不如退回一个正确的跳转。
  onAvatarTap(e) {
    const d = (e && e.detail) || {};
    const id = d.memberId || (e.currentTarget && e.currentTarget.dataset.id);
    if (!id) return;
    if (!d.anchor) { this.goUserInfo(id); return; }
    const index = feedIndexFromEvent(e);
    const item = (this.data.list || [])[index] || {};
    const items = [];
    // 已关注 / 自己的帖就不给「关注」这一项 —— 给了点了也没意义。
    if (item.isFollowTheUser == 0 && item.memberId != this.data.userId) {
      items.push({ key: 'follow', label: '关注', icon: 'plus' });
    }
    items.push({ key: 'profile', label: '访问个人主页' });
    // memberId / index 只在 js 里读,不进 wxml —— 走 setData 会被 U4 死数据字段门禁判红,
    // 而且它说得对:setData 是给渲染层用的,内部状态挂实例上就行。
    this._avatarPop = { memberId: id, index };
    this.setData({ avatarPopShow: true, avatarPopAnchor: d.anchor, avatarPopItems: items });
  },

  onAvatarPopClose() { this.setData({ avatarPopShow: false }); },

  onAvatarPopPick(e) {
    const key = ((e || {}).detail || {}).key;
    const pop = this._avatarPop || {};
    if (key === 'profile') { this.goUserInfo(pop.memberId); return; }
    if (key === 'follow') {
      // 复用既有关注链路,不另造一条 —— 两条分叉过一次就会出现「卡上能关、菜单里关不上」。
      this.followClick({ detail: { index: pop.index } });
    }
  },

  goUserInfo(id) {
    wx.navigateTo({
      url: '/pages/userinfo/userinfo?userId=' + id,
      fail: () => toast('打不开这个主页'),
    });
  },

  /**
   * 预览图片
   */
  previewImage: function (e) {
    const detail = e && e.detail;
    const picList = detail && Array.isArray(detail.picList) ? detail.picList : e.currentTarget.dataset.piclist;
    const index = detail && detail.picIndex !== undefined ? detail.picIndex : e.currentTarget.dataset.index;
    wx.previewImage({
      current: picList[index], // 当前显示图片的http链接
      urls: picList // 需要预览的图片http链接列表
    });
  },

  /**
   * 跳转到详情页
   */
  // 「开始玩」:data_type=1 时 dataId 是活动 id,=2 时是主题 id。
  // 两者都落在 cms_topic 内(ProductType 只有 1 经典定向 / 2 自由定向),恒为 play 模式;
  // 漫游是独立栈(ProductType 注释:ROAM_FREE 不进 cms_topic,故无对应值)且漫游发帖刻意不挂
  // 关联(roam/index.js data_id/data_type 留空),所以这里【不存在】跳 roam 的分支,不写死分支。
  goPlay: function (e) {
    const item = this.data.list[feedIndexFromEvent(e)];
    if (!item || !item.dataId) return;
    const query = String(item.dataType) === '1'
      ? ('activityId=' + item.dataId)
      : ('topicId=' + item.dataId);
    wx.navigateTo({ url: '/pages/play/index?' + query });
  },

  // 「看详情」:两种关联类型后端都回填了 sportTopicId(活动取其所属 topicId、主题即自身),
  // 故统一跳主题详情页;拿不到 topicId 时退回贴文详情,不做死按钮。
  // ⚠️ 路由跟 square/detail 的 goSportTopic 保持同一条:sportTopicId 是 cms_topic 的真实主题 id,
  // 要跳 /pages/topic/index/index;不能把主题 id 喂给任何【模板】详情页,否则会取错对象。
  goPlayTopicDetail: function (e) {
    const index = feedIndexFromEvent(e);
    const item = this.data.list[index];
    if (!item) return;
    if (!item.sportTopicId) return this.jumpDetail(e);
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + item.sportTopicId });
  },

  // 只有后端明确回填 isTopicTemplate=true 才允许改编；普通主题仍走“看详情”。
  // /use 会复制出当前玩家自己的草稿，成功后进入既有编辑页，不把原模板直接改掉。
  goRemixTemplate: function (e) {
    const item = this.data.list[feedIndexFromEvent(e)];
    if (!item || !item.isTopicTemplate || !item.sportTopicId || this._remixingTemplate) return;
    this._remixingTemplate = true;
    remixTopicTemplate(app, item.sportTopicId).then(() => { this._remixingTemplate = false; });
  },

  jumpDetail: function (e) {
    const index = feedIndexFromEvent(e);
    const activity = this.data.list[index];
    // 传递活动数据到详情页
    wx.navigateTo({
      url: '/pages/square/detail/index?id=' + activity.id
    });
  },
  jumpDetail2: function (e) {
    const index = feedIndexFromEvent(e);
    const activity = this.data.list[index];
    // 传递活动数据到详情页
    wx.navigateTo({
      url: '/pages/square/detail/index?comment=1&id=' + activity.id
    });
  },
  

  /**
   * 生命周期函数--监听页面加载
   */
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.switchTab({ url: '/pages/index/index' }); }
    });
  },

  onLoad(options) {
    var that = this
    this._skipInitialShow = true;
    var app = getApp();
    var sys = wx.getSystemInfoSync();
    var safeBottom = sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0;
    var tabBarPx = 100 + safeBottom;
    // 收起停在黑色半透明顶（400rpx）；600rpx 是含「开始」区的 st-bottom，会多露出一段
    var dockBarPx = Math.round(400 * sys.windowWidth / 750 + safeBottom);
    var bottomZonePx = Math.round(600 * sys.windowWidth / 750 + safeBottom);
    var peekPx = dockBarPx;
    var expandedPx = sys.windowHeight - tabBarPx;
    var menuBtn = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    var capsulePx = menuBtn ? Math.round(menuBtn.bottom + 6) : Math.round((sys.statusBarHeight || 44) + 44);
    that.setData({
      avatar: app.getAvatar(),
      nickname: app.getNickname(),
      userId: app.getUserID(),
      statusBarHeight: app.globalData.statusBarHeight || sys.statusBarHeight || 44,
      navBarHeight: app.globalData.navBarHeight || 44,
      pageH: sys.windowHeight,
      tabBarH: tabBarPx,
      drawerPeekH: peekPx,
      drawerCapsuleH: capsulePx,
      drawerDockBarH: dockBarPx,
      drawerDockH: bottomZonePx,
      drawerExpandedH: expandedPx,
      drawerH: expandedPx,
      drawerCollapsed: false
    });
    that.getList()
    that.getUpcoming()
  },

  // 「即将开始」聚合横幅:官方活动开场前的临近提醒,放在页标题与发布框之间。
  //
  // 三个筛选条件缺一不可,顺序就是它们各自挡掉的东西:
  //   1. bannerEnabled —— 复用运营既有的「首页城市事件 banner 开关」,不另造一套推广位判断;
  //   2. status 1(即将开始)/ 2(报名中) —— 已开赛/已结束的不是「即将」;
  //   3. 开始时刻在 [现在, 现在+24h) —— 「临近」的量化。已过开始时刻的落在窗口外。
  // 一条都不剩就把 upcoming 置回 null ⇒ WXML 整块不渲染(不留空标题)。
  //
  // 倒计时按分/时/天取整(后端 baseVo 明确「倒计时交前端按时间戳算」),
  // 所以不挂每秒定时器:进页/回前台各算一次就够,也不必动 onUnload 的清理契约。
  getUpcoming: function () {
    var that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/official/events',
      method: 'GET',
      data: {},
      success: function (res) {
        if (res.code != '200' || !res.data) { that.setData({ upcoming: null, upcomingCards: [] }); return; }
        var rows = Array.isArray(res.data) ? res.data : (res.data.rows || res.data.list || []);
        var now = Date.now();
        var WINDOW = 24 * 60 * 60 * 1000;
        var near = [];
        for (var i = 0; i < rows.length; i++) {
          var e = rows[i];
          if (!e || Number(e.bannerEnabled) !== 1) continue;
          if (Number(e.status) !== 1 && Number(e.status) !== 2) continue;
          // toTimestamp 按 +08:00 锚定:CI/真机时区不同也算出同一个瞬时
          var st = toTimestamp(e.activityStart);
          if (isNaN(st)) continue;
          var delta = st - now;
          if (delta < 0 || delta >= WINDOW) continue;
          near.push({ e: e, st: st, delta: delta });
        }
        if (!near.length) { that.setData({ upcoming: null, upcomingCards: [] }); return; }
        near.sort(function (a, b) { return a.st - b.st; });
        var upcomingCards = near.map(function (candidate) {
          var event = candidate.e;
          var rawAvatars = Array.isArray(event.participantAvatars)
            ? event.participantAvatars.filter(function (avatar) { return typeof avatar === 'string' && avatar; })
            : [];
          var avatars = rawAvatars.slice(0, 3);
          var rawCount = event.participants === undefined ? event.participantCount : event.participants;
          var participantCount = Number(rawCount);
          var knownCount = Number.isFinite(participantCount) && participantCount >= 0
            ? Math.max(participantCount, rawAvatars.length)
            : rawAvatars.length;
          return {
            id: event.id,
            title: event.title || '',
            sub: event.subtitle || event.city || '',
            countdown: fmtCountdown(candidate.delta),
            avatars: avatars,
            avatarOverflow: avatars.length ? Math.max(0, knownCount - avatars.length) : 0,
          };
        });
        var head = upcomingCards[0];
        that.setData({
          upcoming: Object.assign({}, head, { more: upcomingCards.length - 1 }),
          upcomingCards: upcomingCards,
        });
      },
      fail: function () { that.setData({ upcoming: null, upcomingCards: [] }); },
    });
  },

  // 点横幅进官方活动详情
  goUpcoming: function (event) {
    var id = event && event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.id
      : null;
    var up = this.data.upcoming;
    id = id || (up && up.id);
    if (!id) return;
    wx.navigateTo({ url: '/pages/activity/official-detail/index?id=' + id });
  },

  // 为节点选择地点
  choosePoiForNode() {
    const that = this;
    pickLocation({
      onPick(poi) {
        that.setData({
          address: poi.name,
          longitude: poi.longitude,
          latitude: poi.latitude
        });
      }
    });
  },

  bindTextAreaBlur: function (e) {
    const value = e.detail.value || '';
    this.setData({
      valCont: value,
      canSubmit: value.trim().length > 0,
      submitError: ''
    });
  },

  onResultSheetClose() {
    this.setData({ 'resultSheet.show': false });
  },

  resetForm: function (e) {
    var that = this
    that.setData({
      address: '',
      longitude: '',
      latitude: '',
      valCont: '',
      canSubmit: false,
      picList: [],
      fileList: [],
      selectedActivity: null,
      popOrig: false,
      popShow: false,
      tabBarRaised: true,
      submitError: '',
      submitErrorKind: 'data'
    });
  },

  // 提交表单数据
  submitFormData() {
    const that = this;

    // 验证必填字段
    const content = String(that.data.valCont || '').trim();
    if (!content) {
      toast('请输入内容');
      return;
    }

    // 防重:发布在途中禁止重复提交,避免重复发帖
    if (that._submitting) {
      return;
    }
    that._submitting = true;
    that.setData({
      submitting: true,
      submitError: '',
      submitErrorKind: 'data'
    });

    let data = {
      contents: content,
      pics: that.data.picList.join(';'),
      file_url: that.data.fileList.join(';'),
      address: that.data.address,
      longitude: that.data.longitude,
      latitude: that.data.latitude,
      is_crowdfunding: that.data.switch1Checked ? 1 : 2,
      // 关联运动feed:data_type 1活动/2自玩主题(picker仅返回已完成项);data_id优先显式dataId,旧结构回退activityId,无则空
      data_id: that.data.selectedActivity
        ? (that.data.selectedActivity.dataId != null && that.data.selectedActivity.dataId !== ''
            ? that.data.selectedActivity.dataId
            : (that.data.selectedActivity.activityId || ''))
        : '',
      data_type: that.data.selectedActivity ? (that.data.selectedActivity.dataType || 1) : '',
      route_preview_img: that.data.selectedActivity ? (that.data.selectedActivity.routePreviewImg || '') : ''
    };
    // R10-03:稳定发布意图键(账号隔离);同 payload 重试/冷恢复复用,成功后清除,改内容=新意图。
    const publishMemberId = (typeof app.getUserID === 'function' ? String(app.getUserID() || '') : '');
    const intent = publishIntent.begin(wx, {
      scope: 'square:list',
      memberId: publishMemberId,
      payload: [data.contents, data.pics, data.file_url, data.address, data.longitude, data.latitude, data.is_crowdfunding, data.data_id, data.data_type, data.route_preview_img]
    });
    data.request_id = intent.key;
    if (intent.previousUnknown) toast('上次结果未确认，重试不重复发');

    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/creativesquare/action',
      data: data,
      method: "POST",
      success: function (res) {
        if (res.code == "200") {
          publishIntent.settle(wx, 'square:list', publishMemberId, intent.key, 'success');
          // 先发后审:发布即可见(status=1)。图片是异步送检,命中违规由后端回调下架成
          // status=2,作者在卡片上见「未通过审核」徽章 —— 那是**状态**不是动作结果,
          // 不归结果面板(见 cy-state-shell 那条分界)。pill 把这条规则当场说清楚,
          // 免得之后被下架时觉得是平台出尔反尔。
          that.setData({
            resultSheet: {
              show: true, kind: 'success', title: '发布成功',
              sub: '帖文已发布,现在广场里就能看到。',
              meta: '', pill: '先发后审 · 命中违规会自动下架',
              why: '', duration: RESULT_SHEET_MS,
            },
          });
          that.resetForm();
          that.refreshList();
        } else {
          if (res && res.intentDiscarded === true) {
            // 服务端明确该发布已软删:丢弃意图键,重新发布自然换新键(旧帖不自动复活)
            publishIntent.discard(wx, 'square:list', publishMemberId, intent.key);
          } else {
            publishIntent.settle(wx, 'square:list', publishMemberId, intent.key, 'rejected');
          }
          // 文本机审是**同步**拦下的(status=2 + 返错),这一下有明确的动作结果 ⇒ 面板说清楚;
          // 页内 cy-inline-error 带「重试」,仍是持久的恢复出口,面板收掉它还在。
          const message = app.getRequestErrorMessage(res, '发布失败，请稍后重试');
          that.setData({
            submitError: message,
            submitErrorKind: 'data',
            resultSheet: {
              show: true, kind: 'fail', title: '这条没有发出去',
              sub: '内容还在,改完可以直接重发。',
              meta: '', pill: '', why: message, duration: RESULT_SHEET_MS,
            },
          });
        }
      },
      fail: function (res) {
        publishIntent.settle(wx, 'square:list', publishMemberId, intent.key, 'unknown');
        that.setData({
          submitError: app.getRequestErrorMessage(res, '网络错误，请检查连接后重试'),
          submitErrorKind: 'network'
        });
      },
      complete: function () {
        that._submitting = false;
        that.setData({ submitting: false });
      }
    });
  },

  retrySubmit() {
    this.submitFormData();
  },

  // 上传图片
  uploadPic: function (e) {
    var that = this;
    app.chooseImage(function (res) {
      let ll = that.data.picList != "" ? that.data.picList : [];
      res.forEach(function (v) {
        ll.push(v);
      })
      that.setData({
        'picList': ll
      })
    }, 6);
  },

  // 删除图片
  delPic: function (e) {
    var that = this;
    let arr = that.data.picList;
    arr.splice(e.currentTarget.dataset.inx, 1);
    that.setData({
      'picList': arr,
    })
  },

  // A-05:详情页删/改成功后给本页置脏标(跨页通过页面栈实例调用),回页只刷一次首屏。
  markSquareListDirty() {
    this._squareListDirty = true;
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    wx.hideTabBar(); // 重试一次
    // 广场属于玩家内容域：身份只影响能力，不改变页面/原生 chrome 的深色归属。
    merchantTheme.merchantPageRestore();
    this.setData({
      tabBarRaised: true,
    });
    // A-05:从详情返回且详情删/改过 → 刷一次首屏,别让用户看到旧卡;没脏标就不动,不每次 onShow 重拉。
    // A-RPT-5:分享直开详情时,栈里没有列表实例、实例置脏落空,详情侧同时写了 app 级脏标,这里一并消费。
    const globalDirty = !!(app.globalData && app.globalData.squareListDirty);
    if (this._squareListDirty || globalDirty) {
      this._squareListDirty = false;
      if (app.globalData) app.globalData.squareListDirty = false;
      this.refreshList();
    }
    // 倒计时不挂定时器,靠回前台重算:否则后台放一晚回来还写着「3 小时后开始」。
    if (this._skipInitialShow) this._skipInitialShow = false;
    else this.getUpcoming();
  },

  onHide() { merchantTheme.merchantPageRestore(); },

  initMapLocation: function () {
    var that = this;
    getCurrentLocation({
      onSuccess: function (res) {
        that.setData({
          mapLatitude: res.latitude,
          mapLongitude: res.longitude
        });
      }
    });
  },

  recenterMap: function () {
    var that = this;
    getCurrentLocation({
      onSuccess: function (res) {
        that.setData({
          mapLatitude: res.latitude,
          mapLongitude: res.longitude,
          mapScale: 16
        });
      }
    });
  },

  goSearchMap: function () {
    wx.navigateTo({ url: '/pages/searchmap/index' });
  },

  onAddRoute: function () {
    wx.navigateTo({ url: '/pages/publish/fabu/index' });
  },

  // UI-15(2026-09-18 用户定):行内发布区的「展开」口和「发布」文字一起删除,
  // 新建帖不再走完整编辑弹窗(行内 composer 已支持配图/地点/活动与长文本次发布);
  // cy-post-compose 只剩「编辑已有帖」这一条入口(由 onPostAction edit 打开)。
  onComposeClose: function () {
    this.setData({ composeShow: false, composeEdit: null });
  },

  // 弹窗发布/保存成功 —— 同页,直接刷,不必再靠 onShow 猜。
  onComposePublished: function () {
    this.setData({ valCont: '', canSubmit: false, composePrefill: '', composeEdit: null });
    this.refreshList();
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage: function (res) {
    // 如果是从分享按钮触发
    if (res.from === 'button') {
      const dataset = res.target.dataset;
      const id = dataset.id;
      let path = `/pages/square/detail/index?id=${id}`;
      analytics.track('content_share', {
        bizType: 'square',
        bizId: id
      });
      return {
        title: '城瘾Hub',
        path: path,
        success: function (res) {
          toast.success('分享成功');
        },
        fail: function (res) {
          toast('分享取消');
        }
      };
    }

    // 默认分享（非按钮触发）
    return {
      title: '城瘾Hub',
      path: '/pages/square/list/index',
      success: function (res) {
        toast.success('分享成功');
      }
    };
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (!this.data.hasMore || this.data.isLoadingMore || this.data.isRefreshing) return;
    this.getList(false, this.data.page_no + 1);
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   * 新增：处理原生下拉刷新
   */
  onPullDownRefresh() {
    this.refreshList();
  },

  // 新增：处理touch组件的发布成功回调
  onPublishSuccess() {
    this.refreshList();
  },

  // 新增：刷新列表函数
  refreshList() {
    var that = this;
    if (that.data.isRefreshing) return;
    that.setData({
      isRefreshing: true,
      loadMoreError: ''
    });
    that.getList(true, 1);
  },

  // 修改：获取列表数据，增加isRefresh参数区分刷新还是加载更多
  getList: function (isRefresh = false, requestedPage) {
    var that = this;
    const pageNum = requestedPage || (isRefresh ? 1 : that.data.page_no || 1);
    const isLoadMore = pageNum > 1 && !isRefresh;
    if (isLoadMore && that.data.isLoadingMore) return;
    if (!isRefresh && !isLoadMore && that._feedRequestInFlight) return;
    if (isRefresh && that._feedRequestTask && typeof that._feedRequestTask.abort === 'function') {
      that._feedRequestTask.abort();
    }
    const requestId = (that._feedRequestId || 0) + 1;
    that._feedRequestId = requestId;
    that._feedRequestInFlight = true;
    // 只有「首屏/刷新后列表还空着」才铺骨架:加载更多时列表已有内容,铺骨架反而把已读内容顶掉。
    if (!that.data.list.length && !isRefresh) {
      that.setData({ listLoading: true, loadError: false });
    }
    if (isLoadMore) that.setData({ isLoadingMore: true, loadMoreError: '' });
    const setRequestError = function (res, fallback) {
      if (requestId !== that._feedRequestId) return;
      const message = app.getRequestErrorMessage(res, fallback);
      if (isLoadMore) {
        that.setData({ loadMoreError: message });
      } else if (isRefresh && that.data.list.length) {
        // 有旧内容时刷新失败:静默降级,不切整页错误。
      } else {
        that.setData({ loadError: true });
      }
    };
    that._feedRequestTask = app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/creativesquare/list',
      method: "POST",
      // 登录则带 token 让后端识别本人(放行自己的 status=0/2 待审/驳回帖 → 徽章生效);登出保持匿名不变。
      // 实时读 getUserID 而非 onLoad 快照,避免"进页后再登录"时身份丢失。
      auth: app.getUserID() > 0 ? true : false,
      data: {
        is_my: 0,
        user_id: 0,
        pageNum: pageNum,
        pageSize: app.getPageSize(),
      },
      success: function (res) {
        if (requestId !== that._feedRequestId) return;
        if (res && res.code == "200" && res.data && isRecordList(res.data.rows)) {
          let newlist = res.data.rows
          for (let i = 0; i < newlist.length; i++) {
            if (newlist[i]['pics'] != null) {
              // R10-06:清空后的 '' 不得被解析成一个空图片位
              newlist[i]['picList'] = String(newlist[i]['pics']).split(';').filter(function (pic) { return pic; })

              // 初始化图片宽度和高度数组
              const picCount = newlist[i]['picList'].length;
              newlist[i]['imageWidths'] = new Array(picCount).fill(200); // 默认宽度
              newlist[i]['imageHeights'] = new Array(picCount).fill(600); // 默认高度600rpx
            }
            // 格式化 createTime
            if (newlist[i]['createTime']) {
              newlist[i]['formattedCreateTime'] = that.formatTimeDifference(newlist[i]['createTime']);
            }
            newlist[i]['playCover'] = resolveFeedPlayCover(newlist[i]);
            newlist[i]['hasPlayCover'] = hasFeedPlayCover(newlist[i]);
            newlist[i].isCompletionShare = isCompletedShare(newlist[i]);
            newlist[i].isRoamResultShare = isRoamResultShare(newlist[i]);
            newlist[i].completionImage = resolveCompletionShareImage(newlist[i]);
            // 可玩卡副标题:把原来单独一行 cy-metric 三联(完成节点/状态/时间)收进封面卡一句话。
            // sportName 非空 = 该贴关联了活动(data_type=1)或主题(data_type=2),后端 enrichSportFeedBatch 回填。
            if (newlist[i]['sportName']) {
              newlist[i]['playSubtitle'] = buildFeedPlaySubtitle(newlist[i]);
            }
          }

          let updatedList = (isRefresh || pageNum === 1) ? newlist : that.data.list.concat(newlist);

          that.setData({
            list: updatedList,
            page_no: pageNum,
            hasMore: (app.getTotalPage(res.data.total, app.getPageSize()) > pageNum),
            loadError: false,
            loadMoreError: '',
            nodata: updatedList.length < 1
          });
        } else {
          setRequestError(res, isLoadMore ? '更多内容加载失败，请重试' : '动态加载失败，请重试');
        }
      },
      fail: function (res) {
        setRequestError(res, '网络错误，请检查连接后重试');
      },
      complete: function () {
        if (requestId !== that._feedRequestId) return;
        that._feedRequestInFlight = false;
        that._feedRequestTask = null;
        that.setData({
          // 加载失败不算"没有内容",由错误态+重试接管
          nodata: !that.data.loadError && that.data.list.length < 1 ? true : false,
          isRefreshing: false,
          isLoadingMore: false,
          listLoading: false
        });
        if (isRefresh) wx.stopPullDownRefresh();
      }
    });
  },

  // 加载失败重试(cy-error retry 事件)
  onLoadRetry: function () {
    this.setData({ loadError: false, listLoading: true });
    this.getList(false, 1);
  },

  retryLoadMore: function () {
    if (!this.data.hasMore || this.data.isLoadingMore) return;
    this.getList(false, this.data.page_no + 1);
  },

  // 新增：格式化时间差为 xx天xx时xx分
  formatTimeDifference: function (createTimeStr) {
    if (!createTimeStr) return '';

    const createTime = new Date(toTimestamp(createTimeStr));
    const now = new Date();
    const diffTime = now.getTime() - createTime.getTime();

    // 计算天数
    const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    // 计算剩余的小时数
    const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    // 计算剩余的分钟数
    const minutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));

    let result = '';
    if (days > 0) {
      result += days + '天';
    } else {
      if (hours > 0) {
        result += hours + '时';
      }
      if (minutes > 0) {
        result += minutes + '分';
      }

      if (hours == 0 && minutes == 0) {
        result = '刚刚';
      }
    }
    if(result=='刚刚'){
      return result;
    }else{
      return result + '前';
    }
  }
})
