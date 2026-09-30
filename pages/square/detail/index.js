const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const { toTimestamp } = require('../../../utils/datetime');
const motion = require('../../../utils/motion.js')
const { readReducedMotion } = require('../../../utils/motion-preference.js')
const app = getApp();
const analytics = require('../../../utils/analytics.js');
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
const { sendUiStateRequest } = require('../../../utils/ui-state-request.js');
Page({
  /**
   * 页面的初始数据
   */
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    id: 0,
    userId: 0,
    avatar: '',
    // 详情主体的四态:无 id / 加载 / 错误 / 空数据不能再共用一张空壳。
    detailState: 'loading', // loading | ready | error | empty | missing-param
    avatarPopShow: false,   // 点头像的 T5 胶囊
    avatarPopAnchor: null,
    avatarPopItems: [],
    detailError: '',
    info: {},
    picList: [],
    isMine: false,          // info.memberId === 当前用户:编辑/删除只给本人
    popShow: false,
    postActionShow: false,
    composeShow: false,     // H050 编辑帖文(复用 cy-post-compose 的 editPost 态)
    composeEdit: null,
    likeBurst: false,
    favoriteBurst: false,
    list: [],
    page_no: 1,
    hasMore: false,
    nodata: false,
    commentsState: 'idle', // idle | loading | ready | error
    commentLoadError: false,
    commentLoadMoreError: '',
    commentLoadingMore: false,
    commentContent: '',
    canComment: false,
    commentSubmitting: false,
    commentSubmitError: '',
    commentSubmitErrorKind: 'data',
    replyContent: '',
    canReply: false,
    replySubmitting: false,
    replySubmitError: '',
    replySubmitErrorKind: 'data',
    replyId: 0,
    commentFocus: false,
    autoFocusComment: false,
    commentFocused: false,
    imageHeight: 600, // 图片固定高度600rpx
    imageWidths: [], // 存储每张图片的动态宽度
    imageAspectRatios: [] // 存储每张图片的宽高比
  },

  // 图片加载完成事件
  onImageLoad: function(e) {
    const index = e.currentTarget.dataset.index;
    const { width, height } = e.detail;
    
    // 计算宽高比
    const aspectRatio = width / height;
    
    // 计算基于固定高度的宽度
    const fixedHeight = this.data.imageHeight; // 600rpx
    let calculatedWidth = fixedHeight * aspectRatio;
    
    // 限制最大宽度，避免过宽
    const maxWidth = 1000; // 最大宽度限制稍微增加
    const finalWidth = calculatedWidth > maxWidth ? maxWidth : calculatedWidth;
    
    // 确保最小宽度
    const minWidth = 200;
    const finalWidthWithMin = finalWidth < minWidth ? minWidth : finalWidth;
    
    // 更新数据
    const imageAspectRatios = this.data.imageAspectRatios;
    const imageWidths = this.data.imageWidths;
    
    imageAspectRatios[index] = aspectRatio;
    imageWidths[index] = finalWidthWithMin;
    
    this.setData({
      imageAspectRatios: imageAspectRatios,
      imageWidths: imageWidths
    }, () => {
    });
  },
  // 评论输入处理
  onCommentInput: function(e) {
    const value = e.detail.value || '';
    this.setData({
      commentContent: value,
      canComment: value.trim().length > 0,
      commentSubmitError: ''
    });
  },

  // 回复输入处理
  onReplyInput: function(e) {
    const value = e.detail.value || '';
    this.setData({
      replyContent: value,
      canReply: value.trim().length > 0,
      replySubmitError: ''
    });
  },

  // 评论输入框失去焦点
  onCommentBlur: function() {
    this.setData({
      commentFocus: false
    });
  },

  // 点头像 → T5 胶囊(Figma 339:740)。与广场页同一条口径:先量锚点,量不到才退回直接跳转
  // (稿子写死「不许居中」,与其显示成错的形态,不如退回一个正确的跳转)。
  // 这里的头像在页面自己的 wxml 里,createSelectorQuery 直接能量到,不像广场页要经组件转一手。
  goUserInfoClcik() {
    const info = this.data.info || {};
    if (!info.memberId) return;
    const q = this.createSelectorQuery();
    q.select('.ph-avatar').boundingClientRect();
    q.exec((res) => {
      const anchor = (res && res[0]) || null;
      if (!anchor) { this.goUserInfo(); return; }
      const items = [];
      if (info.isFollowTheUser == 0 && info.memberId != this.data.userId) {
        items.push({ key: 'follow', label: '关注', icon: 'plus' });
      }
      items.push({ key: 'profile', label: '访问个人主页' });
      this.setData({ avatarPopShow: true, avatarPopAnchor: anchor, avatarPopItems: items });
    });
  },

  onAvatarPopClose() { this.setData({ avatarPopShow: false }); },

  onAvatarPopPick(e) {
    const key = ((e || {}).detail || {}).key;
    if (key === 'profile') { this.goUserInfo(); return; }
    if (key === 'follow') { this.followClick(); }   // 复用既有关注链路,不另造一条
  },

  goUserInfo() {
    wx.navigateTo({
      url: '/pages/userinfo/userinfo?userId=' + this.data.info.memberId,
      fail: () => toast('打不开这个主页'),
    });
  },

  // 关联活动回跳:点 route-map 下方链接 → 主题详情(报告 §3.3)
  goSportTopic() {
    const tid = this.data.info && this.data.info.sportTopicId;
    if (tid) wx.navigateTo({ url: '/pages/topic/index/index?id=' + tid });
  },

  goRemixTemplate() {
    const info = this.data.info || {};
    if (!info.isTopicTemplate || !info.sportTopicId || this._remixingTemplate) return;
    this._remixingTemplate = true;
    remixTopicTemplate(app, info.sportTopicId).then(() => { this._remixingTemplate = false; });
  },

  // 「开始玩」:data_type=1 时 dataId 是活动 id,=2 时是主题 id。两者都在 cms_topic 内
  // (ProductType 仅 1 经典定向 / 2 自由定向),恒为 play 模式;漫游是独立栈、不进 cms_topic,
  // 且漫游发帖刻意不挂关联,所以这里【不存在】跳 roam 的分支。与 square/list 的 goPlay 同一判据。
  goPlay() {
    const info = this.data.info || {};
    if (!info.dataId) return;
    const query = String(info.dataType) === '1'
      ? ('activityId=' + info.dataId)
      : ('topicId=' + info.dataId);
    wx.navigateTo({ url: '/pages/play/index?' + query });
  },

  // 添加评论（回车发送）
  addComment: function () {
    var that = this;
    const content = String(that.data.commentContent || '').trim();
    
    if (!content) {
      toast('评论内容不能为空');
      return;
    }
    if (that._commentSubmitting) return;
    that._commentSubmitting = true;
    that.setData({
      commentSubmitting: true,
      commentSubmitError: '',
      commentSubmitErrorKind: 'data'
    });

    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/comment/add',
      method: "POST",
      data: {
        owner_type : 3,
        owner_id: that.data.id,
        rating : 0,
        contents : content,
        reply_id : 0,
        img_arr  :'',
      },
      success: function (res) {
        if (res.code == "200") {
          toast.success('评论成功');
          that.setData({
            commentContent: '',
            canComment: false,
            commentSubmitError: ''
          });
          that.refreshComments();
        } else {
          that.setData({
            commentSubmitError: app.getRequestErrorMessage(res, '评论失败，请稍后重试'),
            commentSubmitErrorKind: 'data'
          });
        }
      },
      fail: function (res) {
        that.setData({
          commentSubmitError: app.getRequestErrorMessage(res, '网络错误，请检查连接后重试'),
          commentSubmitErrorKind: 'network'
        });
      },
      complete: function () {
        that._commentSubmitting = false;
        that.setData({ commentSubmitting: false });
      }
    })
  },

  retryCommentSubmit: function () {
    this.addComment();
  },

  // 添加回复评论（回车发送）
  addReplyComment: function () {
    var that = this;
    const content = String(that.data.replyContent || '').trim();
    
    if (!content) {
      toast('回复内容不能为空');
      return;
    }
    if (that._replySubmitting) return;
    that._replySubmitting = true;
    that.setData({
      replySubmitting: true,
      replySubmitError: '',
      replySubmitErrorKind: 'data'
    });

    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/comment/add',
      method: "POST",
      data: {
        owner_type : 3,
        owner_id: that.data.id,
        rating : 0,
        contents : content,
        reply_id : that.data.replyId || 0,
        img_arr  :'',
      },
      success: function (res) {
        if (res.code == "200") {
          toast.success('回复成功');
          that.setData({
            replyContent: '',
            canReply: false,
            popShow: false,
            replyId: 0,
            replySubmitError: ''
          });
          that.refreshComments();
        } else {
          that.setData({
            replySubmitError: app.getRequestErrorMessage(res, '回复失败，请稍后重试'),
            replySubmitErrorKind: 'data'
          });
        }
      },
      fail: function (res) {
        that.setData({
          replySubmitError: app.getRequestErrorMessage(res, '网络错误，请检查连接后重试'),
          replySubmitErrorKind: 'network'
        });
      },
      complete: function () {
        that._replySubmitting = false;
        that.setData({ replySubmitting: false });
      }
    })
  },

  retryReplySubmit: function () {
    this.addReplyComment();
  },

  // 修改回复按钮点击事件
  msgClick(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      popShow: true,
      replyId: item.id || 0,
      replySubmitError: ''
    });
  },

  popClose() {
    this.setData({
      popShow: false,
      replyContent: '',
      canReply: false,
      replyId: 0,
      replySubmitError: ''
    });
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    var that = this
    options = options || {}
    const id = options.id || ''
    that.setData({
      id: id,
      userId: app.getUserID(),
      avatar: app.getAvatar(),
      detailState: id ? 'loading' : 'missing-param',
      detailError: ''
    })

    // 直开/失效链接没有详情 id 时，不发空请求；给 WXML 的 missing-param 态一个明确出口。
    if (!id) return
    
    if (options.comment == '1') {
      that.setData({
        autoFocusComment: true
      })
    }
    that.getData()
    that.getList()
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady: function() {
    var that = this
    if (that.data.autoFocusComment && !that.data.commentFocused) {
      setTimeout(() => {
        that.focusCommentInput()
      }, 1000)
    }
  },

  // 聚焦评论输入框
  focusCommentInput: function() {
    var that = this
    
    that.setData({
      commentFocused: true
    })
    
    const query = wx.createSelectorQuery()
    query.select('.david_npl_right input').fields({
      rect: true,
      size: true
    }, function(res) {
      if (res) {
        that.setData({
          commentFocus: true
        }, () => {
          wx.pageScrollTo({
            scrollTop: res.top + res.height + 100,
            duration: 300
          })
          
          toast('请输入评论', { duration: 1500 })
        })
      } else {
        that.scrollToBottomAndFocus()
      }
    }).exec()
  },

  // 备用方案：滚动到底部并聚焦
  scrollToBottomAndFocus: function() {
    var that = this
    wx.pageScrollTo({
      scrollTop: 99999,
      duration: 400,
      success: function() {
        setTimeout(() => {
          that.setData({
            commentFocus: true
          }, () => {
          })
        }, 450)
      },
      fail: function(err) {
        setTimeout(() => {
          that.setData({
            commentFocus: true
          })
        }, 500)
      }
    })
  },

  followClick(e) {
    var that = this
    let item = that.data.info
    if (!item || !item.memberId || that._followRequestInFlight) return;
    that._followRequestInFlight = true;
    // R10-07:请求发出前冻结意图,丢响应后重试同一意图不会反转服务端关系。
    const intendedFollow = item.isFollowTheUser ? 0 : 1;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/user/follow/action',
      method: "POST",
      data: {
        follow_member_id : item['memberId'],
        follow: intendedFollow,
      },
      success: function (res) {
        if (res.code == "200") {
          const nextFollowState = intendedFollow;
          that.setData({ 'info.isFollowTheUser': nextFollowState });

          toast(nextFollowState ? '关注成功' : '已取消关注');
        } else {
          toast(res.msg || '操作失败');
        }
      },
      fail: function (res) {
        toast('网络错误，请重试');
      },
      complete: function () {
        that._followRequestInFlight = false;
      }
    })
  },

  /* 点赞爆一下。
     ⚠️ 三条判据:
       ① 只在「从没赞到赞」时播(取消赞不庆祝,见调用点);
       ② 一次性 class 播完就摘 —— keyframes 不会因为再次赋同一个 class 就重播,
          连点时必须先摘再挂,否则第二次点没有反应;
       ③ 减少动态效果时整个跳过,触感也一并跳过(motion.haptic 自带这条闸,
          不许裸调 wx.vibrateShort 绕过去)。 */
  burstLike() {
    const reduced = readReducedMotion();
    motion.haptic({ type: 'light', reducedMotion: reduced });
    if (reduced) return;
    if (this._likeBurstTimer) clearTimeout(this._likeBurstTimer);
    // 「先摘再挂」必须隔开一次渲染:同一 tick 连续两次 setData 会被合并,
    // 渲染层看不到 false,class 没摘等于没挂 —— 置 true 放进第一次 setData 的回调里
    this.setData({ likeBurst: false }, () => {
      if (this._unloaded) return;
      this.setData({ likeBurst: true });
      this._likeBurstTimer = setTimeout(() => {
        this._likeBurstTimer = null;
        if (this._unloaded) return;
        this.setData({ likeBurst: false });
      }, 600);
    });
  },

  lickClick(e) {
    var that = this
    let id = that.data.id
    if (!id || that._likeRequestInFlight) return;
    that._likeRequestInFlight = true;
    let type = e.currentTarget.dataset.type;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/creativesquare/like',
      method: "POST",
      data: {
        id  : id,
        type :type
      },
      success: function (res) {
        if (res.code != "200") {
          toast(res.msg || '操作失败');
          return;
        }
          let newinfo = that.data.info
          // 只有「从没赞到赞」才播爆赞:取消赞也放礼花等于在庆祝用户收回喜欢
          const likedBefore = newinfo['isLiked'] == 1
            if(type==1){
              if(newinfo['isLiked']==0){
                newinfo['likeCount'] = newinfo['likeCount']+1 
                newinfo['isLiked'] = 1 
              }else if(newinfo['isLiked']==1){
                newinfo['likeCount'] = newinfo['likeCount']-1 
                newinfo['isLiked'] = 0
              }else if(newinfo['isLiked']==2){
                newinfo['likeCount'] = newinfo['likeCount']+1 
                newinfo['isLiked'] = 1
              }
            }else{
              if(newinfo['isLiked']==0){
                newinfo['isLiked'] = 2 
              }else if(newinfo['isLiked']==1){
                newinfo['likeCount'] = newinfo['likeCount']-1 
                newinfo['isLiked'] = 2
              }else if(newinfo['isLiked']==2){
                newinfo['isLiked'] = 0
              }
            }
            that.setData({
              info: newinfo
            });
            if (type == 1 && !likedBefore && newinfo['isLiked'] == 1) that.burstLike();

      },
      fail: function (res) {
        toast('网络错误，请重试');
      },
      complete: function () {
        that._likeRequestInFlight = false;
      }
    })
  },

  favoriteClick() {
    const info = this.data.info || {};
    if (!info.id || this._favoriteRequestInFlight) return;
    this._favoriteRequestInFlight = true;
    const next = info.isBookmarked == 1 ? 0 : 1;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/creativesquare/bookmark',
      method: 'POST',
      data: {
        id: info.id,
        bookmark: next,
        request_id: 'bookmark-' + info.id + '-' + next + '-' + Date.now().toString(36)
      },
      success: (res) => {
        if (!res || res.code != '200') {
          toast((res && res.msg) || '操作失败');
          return;
        }
        this.setData({ 'info.isBookmarked': next, favoriteBurst: next === 1 });
        if (next === 1) {
          motion.haptic({ type: 'light', reducedMotion: readReducedMotion() });
          this._favoriteBurstTimer = setTimeout(() => {
            this._favoriteBurstTimer = null;
            if (!this._unloaded) this.setData({ favoriteBurst: false });
          }, 300);
        }
      },
      fail: () => toast('网络错误，请重试'),
      complete: () => { this._favoriteRequestInFlight = false; }
    });
  },

  commentFollowClick(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item || !item.memberId) {
      toast('用户信息不完整，请刷新后重试');
      return;
    }
    const requestKey = String(item.memberId);
    this._commentFollowRequests = this._commentFollowRequests || Object.create(null);
    if (this._commentFollowRequests[requestKey]) return;
    this._commentFollowRequests[requestKey] = true;
    const releaseRequest = () => { delete this._commentFollowRequests[requestKey]; };
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/user/follow/action',
      method: 'POST',
      data: {
        follow_member_id: item.memberId,
        follow: 1 // R10-07:评论区关注按钮只表达「关注」,重试幂等
      },
      success: (res) => {
        if (res.code == '200') {
          // 写回执不等于服务端终态：回读当前评论所在页，确认 isFollowTheUser 后再报成功。
          const pageSize = Math.max(1, Number(app.getPageSize()) || 10);
          const pageNum = Math.floor(index / pageSize) + 1;
          const confirmFailed = () => toast('已提交，但状态确认失败，请刷新');
          sendUiStateRequest(app, '/api/comment/list', {
            method: 'POST',
            data: {
              owner_type: 3,
              owner_id: this.data.id,
              pageNum,
              pageSize
            },
            success: (readback) => {
              const rows = readback && readback.code == '200' && readback.data
                && isRecordList(readback.data.rows) ? readback.data.rows : [];
              const authoritative = rows.find((row) => String(row.id) === String(item.id));
              const current = this.data.list[index];
              if (!authoritative || Number(authoritative.isFollowTheUser) !== 1 ||
                  !current || String(current.id) !== String(item.id)) {
                confirmFailed();
                return;
              }
              const list = this.data.list.slice();
              const formattedCreateTime = authoritative.createTime
                ? this.formatTimeDifference(authoritative.createTime)
                : current.formattedCreateTime;
              list[index] = Object.assign({}, current, authoritative, { formattedCreateTime });
              this.setData({ list }, () => {
                toast('关注成功');
              });
            },
            fail: confirmFailed,
            complete: releaseRequest
          });
          return;
        }
        releaseRequest();
        toast(res.msg || '关注失败，请重试');
      },
      fail() {
        releaseRequest();
        toast('网络错误，请重试');
      }
    });
  },

  commentLikeClick(e) {
    var that = this
    let index = e.currentTarget.dataset.index;
    let item = that.data.list[index]
    if (!item || !item.id) return;
    let id = item['id']
    const requestKey = String(id);
    that._commentLikeRequests = that._commentLikeRequests || Object.create(null);
    if (that._commentLikeRequests[requestKey]) return;
    that._commentLikeRequests[requestKey] = true;

    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/comment/like',
      method: "POST",
      data: {
        id  : id
      },
      success: function (res) {
        if (res.code == "200") {
          // 后端是开关语义,以回包 data.isLiked 终态为准;旧后端没回就按开关取反(3-20)
          let newlist = that.data.list
          const row = newlist[index]
          const was = row.isLiked == 1 ? 1 : 0
          const serverLiked = res.data && res.data.isLiked
          const now = serverLiked === 0 || serverLiked === 1 ? serverLiked : 1 - was
          row.isLiked = now
          row.likeCount = Math.max(0, (Number(row.likeCount) || 0) + now - was)
          that.setData({
            list: newlist
          });
        }else{
          // A-14-1:后端 code!=200 却缺 msg 时,原来直接把 undefined 弹给用户。
          toast(app.getRequestErrorMessage(res, '操作失败，请重试'));
        }
      },
      fail: function (res) {
        toast('网络错误，请重试');
      },
      complete: function () {
        delete that._commentLikeRequests[requestKey];
      }
    })
  },

  reportSquare() {
    const that = this;
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
            id: that.data.id
          },
          success(resp) {
            if (resp.code == '200') {
              toast('已提交举报');
              setTimeout(() => { that.goBack(); }, 800);
            } else {
              toast(resp.msg || '举报失败');
            }
          },
          fail() {
            toast('网络异常，请重试');
          }
        });
      }
    });
  },

  openPostActions() {
    this.setData({ postActionShow: true });
  },

  closePostActions() {
    this.setData({ postActionShow: false });
  },

  // H050/H051:三合一弹层的分发。delete 走到这里时用户已过完组件内部的危险确认闸
  // (cy-danger-confirm,文案在 utils/danger-actions.js 的 club.post.delete),别再自建第二道。
  onPostAction(e) {
    const action = ((e || {}).detail || {}).action;
    if (action === 'edit') { this.openPostEdit(); return; }
    if (action === 'delete') { this.deleteSquarePost(); return; }
    if (action === 'report') { this.reportSquareFromActions(); return; }
  },

  reportSquareFromActions() {
    this.setData({ postActionShow: false });
    this.reportSquare();
  },

  // 删除(H051):软删 + 归属校验都在后端 /api/creativesquare/delete;成功后详情切到既有
  // 「这条动态暂不可用」态 —— 用户关掉「动态已删除」回执卡,还能从空态 CTA 回列表。
  deleteSquarePost() {
    const id = this.data.id;
    if (!id || this._deleting) return;
    this._deleting = true;
    const pa = this.selectComponent && this.selectComponent('#post-actions');
    app.sendRequest({
      hideLoading: true,
      url: '/api/creativesquare/delete',
      method: 'POST',
      data: { id: id },
      success: (res) => {
        this._deleting = false;
        if (res && res.code == '200') {
          if (pa) pa.deleteDone();
          this.markListDirty();
          this.setData({ postActionShow: false, detailState: 'empty' });
        } else if (pa) {
          pa.deleteFailed((res && res.msg) || '删除失败');
        }
      },
      fail: () => {
        this._deleting = false;
        if (pa) pa.deleteFailed('网络异常，请重试');
      },
    });
  },

  // 编辑(H050):复用新建帖文面板的编辑态。只传 id/正文/关联 —— 图片/地点不发,
  // 后端 R10-06「未提交字段不清空」会保留原值,所以不会把配图改没。
  openPostEdit() {
    const info = this.data.info || {};
    if (!this.data.id) return;
    this.closePostActions();
    // editPost 必须先于 show 落地:组件的 show 观察器要在翻转的同一拍读到它(两次 setData 顺序确定)。
    this.setData({ composeEdit: {
      id: String(this.data.id),
      contents: info.contents || '',
      dataId: info.dataId,
      dataType: info.dataType,
    } });
    this.setData({ composeShow: true });
  },

  onComposeClose() {
    this.setData({ composeShow: false, composeEdit: null });
  },

  onComposePublished() {
    // 保存成功:同页回读一次,让详情显示改后的正文(不本地假设成功后的样子)
    this.setData({ composeShow: false, composeEdit: null });
    this.markListDirty();
    this.getData();
  },

  // A-05:删/改过之后给上一页(广场列表)置脏标,回列表 onShow 时刷新一次首屏 ——
  // 不置脏标就不刷(别每次 onShow 全量重拉),脏标只影响一次。
  markListDirty() {
    // A-RPT-5:分享直开时页面栈上一页不是广场列表(栈里常常只有本页),实例调用落空。
    // 脏标是「列表内容已过期」这个事实,不依赖栈里恰好有谁 —— 同步落一份应用级脏标,
    // 列表 onShow 一并消费。
    if (app.globalData) app.globalData.squareListDirty = true;
    if (typeof getCurrentPages !== 'function') return;
    const pages = getCurrentPages();
    const prev = pages && pages.length > 1 ? pages[pages.length - 2] : null;
    if (prev && typeof prev.markSquareListDirty === 'function') prev.markSquareListDirty();
  },

  reportComment(e) {
    const that = this;
    const index = e.currentTarget.dataset.index;
    const item = that.data.list[index];
    if (!item || !item.id) {
      return;
    }
    modal.show({
      title: '举报评论',
      content: '确认举报这条评论？举报后将提交平台审核。',
      confirmText: '举报',
      success(res) {
        if (!res.confirm) {
          return;
        }
        app.sendRequest({
          hideLoading: true,
          url: '/api/comment/report',
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
          }
        });
      }
    });
  },

  // A-04:自己的评论可删(后端 /api/comment/delete 早有 owner 校验,前端一直没有入口)。
  // 确认闸走已登记的 club.comment.delete(不可逆,后果文案在 utils/danger-actions.js)。
  deleteComment(e) {
    const that = this;
    const index = e.currentTarget.dataset.index;
    const item = that.data.list[index];
    if (!item || !item.id) return;
    if (String(item.memberId) !== String(that.data.userId)) return; // 入口只给自己的评论;后端仍会再校验一次
    const requestKey = String(item.id);
    that._commentDeleteRequests = that._commentDeleteRequests || Object.create(null);
    if (that._commentDeleteRequests[requestKey]) return;
    modal.show({
      dangerKey: 'club.comment.delete',
      success(res) {
        if (!res.confirm) return;
        if (that._commentDeleteRequests[requestKey]) return;
        that._commentDeleteRequests[requestKey] = true;
        app.sendRequest({
          hideLoading: true,
          autoErrorToast: false, // 失败由本处精确 toast,不再叠通道的通用 toast
          url: '/api/comment/delete',
          method: 'POST',
          data: { id: item.id },
          success(resp) {
            if (resp && resp.code == '200') {
              const list = that.data.list.slice();
              const at = list.findIndex((row) => String(row.id) === requestKey);
              if (at > -1) list.splice(at, 1);
              that.setData({ list, nodata: list.length < 1 });
              toast('评论已删除');
            } else {
              toast(app.getRequestErrorMessage(resp, '删除失败，请重试'));
            }
          },
          fail() { toast('网络错误，请重试'); },
          complete() { delete that._commentDeleteRequests[requestKey]; },
        });
      },
    });
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage: function (res) {
    analytics.track('content_share', {
      bizType: 'square',
      bizId: this.data.id
    });
    return {
      title: '城瘾Hub',
      success: function (res) {
        toast.success('分享成功');
      }
    };
  },

  /**
   * 预览图片
   */
  previewImage: function (e) {
    const picList = e.currentTarget.dataset.piclist;
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      current: picList[index],
      urls: picList
    });
  },

  getData: function () {
    var that = this;
    if (!that.data.id) return;
    if (that._detailRequestInFlight) return;
    const requestId = (that._detailRequestId || 0) + 1;
    that._detailRequestId = requestId;
    that._detailRequestInFlight = true;
    that.setData({ detailState: 'loading', detailError: '' });
    that._detailRequestTask = app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/creativesquare/info',
      data: {
        id: that.data.id
      },
      method: "POST",
      success: function (res) {
        if (requestId !== that._detailRequestId) return;
        if (res.code != "200") {
          that.setData({
            detailState: 'error',
            detailError: res.msg || '服务暂时无法提供这条动态',
          });
          return;
        }
        if (!res.data || typeof res.data !== 'object' || Array.isArray(res.data) || !Object.keys(res.data).length) {
          that.setData({ detailState: 'empty', detailError: '' });
          return;
        }
        {
          let picList = []
          if (res.data['pics'] != null) {
            // R10-06:显式清空落库为 '',不能再 split 出 [''] 渲染一个空媒体位。
            picList = String(res.data['pics']).split(';').filter(function (pic) { return pic; })
          }
          if (res.data['createTime']) {
            res.data['formattedCreateTime'] = that.formatTimeDifference(res.data['createTime']);
          }
          res.data['playCover'] = resolveFeedPlayCover(res.data);
          res.data['hasPlayCover'] = hasFeedPlayCover(res.data);
          res.data['isCompletionShare'] = isCompletedShare(res.data);
          res.data['isRoamResultShare'] = isRoamResultShare(res.data);
          res.data['picList'] = picList;
          res.data['completionImage'] = resolveCompletionShareImage(res.data);
          if (res.data['sportName']) {
            res.data['playSubtitle'] = buildFeedPlaySubtitle(res.data);
          }

          // 初始化数组
          const picCount = picList.length;
          const imageAspectRatios = new Array(picCount).fill(1);
          const imageWidths = new Array(picCount).fill(400); // 默认宽度也相应增加

          that.setData({
            info: res.data,
            picList: picList,
            isMine: !!(res.data.memberId && String(res.data.memberId) === String(that.data.userId)),
            imageAspectRatios: imageAspectRatios,
            imageWidths: imageWidths,
            detailState: 'ready',
            detailError: ''
          });
        }
      },
      fail: function () {
        if (requestId !== that._detailRequestId) return;
        that.setData({
          detailState: 'error',
          detailError: '网络开了点小差，请检查连接后重试',
        });
      },
      complete: function () {
        if (requestId !== that._detailRequestId) return;
        that._detailRequestInFlight = false;
        that._detailRequestTask = null;
      }
    })
  },

  onRetryDetail() {
    if (!this.data.id) { this.goBack(); return; }
    this.getData();
  },

  // 详情可从分享/扫码直达，栈为空时回到广场列表，避免空态上的“返回”成为死动作。
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/square/list/index' })
    });
  },

  // 新增：格式化时间差为 xx天xx时xx分
  formatTimeDifference: function(createTimeStr) {
    if (!createTimeStr) return '';
    
    const createTime = new Date(toTimestamp(createTimeStr));
    const now = new Date();
    const diffTime = now.getTime() - createTime.getTime();
    
    const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
    
    let result = '';
    if (days > 0) {
      result += days + '天';
    }else{
      if (hours > 0) {
        result += hours + '时';
      }
      if (minutes > 0) {
        result += minutes + '分';
      }
  
      if(hours==0 && minutes==0){
        result= '刚刚';
      }
    }
    return result + '前';
  },

  /**
  * 页面上拉触底事件的处理函数
  */
  onReachBottom() {
    if (!this.data.hasMore || this.data.commentLoadingMore) return;
    this.getList(this.data.page_no + 1);
  },

  getList: function (requestedPage, isRefresh) {
    var that = this;
    const pageNum = requestedPage || 1;
    const refresh = Boolean(isRefresh);
    const isLoadMore = pageNum > 1 && !refresh;
    if (isLoadMore && that.data.commentLoadingMore) return;
    if (!refresh && !isLoadMore && that._commentsRequestInFlight) return;
    if (refresh && that._commentsRequestTask && typeof that._commentsRequestTask.abort === 'function') {
      that._commentsRequestTask.abort();
    }
    const requestId = (that._commentsRequestId || 0) + 1;
    that._commentsRequestId = requestId;
    that._commentsRequestInFlight = true;
    if (isLoadMore) {
      that.setData({ commentLoadingMore: true, commentLoadMoreError: '' });
    } else if (!that.data.list.length) {
      that.setData({ commentsState: 'loading', commentLoadError: false });
    }
    const setCommentError = function (res, fallback) {
      if (requestId !== that._commentsRequestId) return;
      const message = app.getRequestErrorMessage(res, fallback);
      if (isLoadMore) {
        that.setData({ commentLoadMoreError: message });
      } else if (refresh && that.data.list.length) {
        that.setData({  commentsState: 'ready' });
      } else {
        that.setData({ commentLoadError: true, commentsState: 'error' });
      }
    };
    that._commentsRequestTask = app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/comment/list',
      method: "POST",
      data: {
        owner_type: 3,
        owner_id: that.data.id,
        pageNum: pageNum,
        pageSize: app.getPageSize(),
      },
      success: function (res) {
        if (requestId !== that._commentsRequestId) return;
        if (res && res.code == "200" && res.data && isRecordList(res.data.rows)) {
          let newlist = res.data.rows;

          for (let i = 0; i < newlist.length; i++) {
            if (newlist[i]['createTime']) {
              newlist[i]['formattedCreateTime'] = that.formatTimeDifference(newlist[i]['createTime']);
            } 
          }

          const updatedList = (refresh || pageNum === 1) ? newlist : that.data.list.concat(newlist);
          that.setData({
            list: updatedList,
            page_no: pageNum,
            hasMore: (app.getTotalPage(res.data.total, app.getPageSize()) > pageNum),
            commentsState: 'ready',
            commentLoadError: false,
            commentLoadMoreError: '',
            nodata: updatedList.length < 1
          }, () => {
            if (that.data.autoFocusComment && !that.data.commentFocused) {
              setTimeout(() => {
                that.focusCommentInput()
              }, 300)
            }
          })
        } else {
          setCommentError(res, isLoadMore ? '更多评论加载失败，请重试' : '评论加载失败，请重试');
        }
      },
      fail: function (res) {
        setCommentError(res, '网络错误，请检查连接后重试');
      },
      complete: function () {
        if (requestId !== that._commentsRequestId) return;
        that._commentsRequestInFlight = false;
        that._commentsRequestTask = null;
        that.setData({ commentLoadingMore: false });
      }
    })
  },

  retryComments: function () {
    this.setData({ page_no: 1, hasMore: false, nodata: false, commentLoadError: false });
    this.getList(1);
  },

  refreshComments: function () {
    this.getList(1, true);
  },

  retryCommentLoadMore: function () {
    if (!this.data.hasMore || this.data.commentLoadingMore) return;
    this.getList(this.data.page_no + 1);
  },

  onUnload() {
    this._unloaded = true;
    if (this._likeBurstTimer) {
      clearTimeout(this._likeBurstTimer);
      this._likeBurstTimer = null;
    }
    if (this._favoriteBurstTimer) {
      clearTimeout(this._favoriteBurstTimer);
      this._favoriteBurstTimer = null;
    }
    this._detailRequestId = (this._detailRequestId || 0) + 1;
    this._commentsRequestId = (this._commentsRequestId || 0) + 1;
    if (this._detailRequestTask && typeof this._detailRequestTask.abort === 'function') {
      this._detailRequestTask.abort();
    }
    if (this._commentsRequestTask && typeof this._commentsRequestTask.abort === 'function') {
      this._commentsRequestTask.abort();
    }
    this._detailRequestInFlight = false;
    this._commentsRequestInFlight = false;
    this._detailRequestTask = null;
    this._commentsRequestTask = null;
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    if (this.data.autoFocusComment && this.data.commentFocused && !this.data.commentFocus) {
      setTimeout(() => {
        this.setData({
          commentFocus: true
        })
      }, 100)
    }
  }
})
