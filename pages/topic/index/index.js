const modal = require('../../../utils/modal.js');
const loading = require('../../../utils/loading.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
/* 结果面板终态停留时长;跳转挂在面板 close 上,时长只此一处 */
const RESULT_SHEET_MS = 2000;
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const { createCheckoutWorkflow, isOrderExpiredFailure, isTerminalOrderConflict,
  ORDER_REBUILD_REQUIRED, ORDER_EXPIRED_USER_MESSAGE } = require('../../../utils/checkout/checkout-workflow.js');
const { createRegistrationPaymentVerifier } = require('../../../utils/checkout/registration-payment-verifier.js');
const { buildTopicStatBar } = require('../utils/topic-detail-facts.js');
const { isRecordList } = require('../../../utils/response-shape.js');
const { haversine } = require('../../../utils/geo.js');
const marketingConsent = require('../../../utils/marketing-consent-entry.js');
const ticketSource = require('../../../utils/ticket-source.js');
const { buildTopicShare, resolveTopicCover } = require('../../../utils/topic-share.js');

/* 稿 214:689 路线 tab 每两站之间那行「15min 步行」。
   接口没有逐段步行时长,只有站点经纬度 —— 与 pages/club/topic-story 用的是同一份
   直线估算(80m/min ≈ 4.8km/h),拿不到坐标就整行不画,不编一个数字充数。
   ⚠️ 不要拿 node.nodeTime 顶替:那一列的注释写着「建议停留时长(分钟)」,
      是「在这站待多久」,不是「走多久到下一站」。 */
const WALK_METERS_PER_MIN = 80;
function walkText(prev, node) {
  if (!prev || !node) return '';
  const la1 = Number(prev.latitude); const lo1 = Number(prev.longitude);
  const la2 = Number(node.latitude); const lo2 = Number(node.longitude);
  if (![la1, lo1, la2, lo2].every(Number.isFinite)) return '';
  if (!la1 || !lo1 || !la2 || !lo2) return '';
  const meters = haversine(la1, lo1, la2, lo2);
  if (!Number.isFinite(meters) || meters <= 0) return '';
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MIN)) + 'min 步行';
}

/* CU-C-65:站点级字段裸插值会把 null 印成字面「null」(WXML 文本插值对 null 就是这么做的,
   与 description 家族同一个毛病)。统一在这里归一成 '',wxml 再各加一道 wx:if。 */
function nodeText(value) {
  if (value === null || value === undefined) return '';
  const out = String(value).trim();
  return out === 'null' ? '' : out;
}

function normalizeChaptersList(chaptersList) {
  if (chaptersList == null) return [];
  if (!Array.isArray(chaptersList)) return null;
  const normalized = [];
  for (const chapter of chaptersList) {
    if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) return null;
    const nodes = chapter.nodes == null ? [] : chapter.nodes;
    if (!isRecordList(nodes)) return null;
    for (const node of nodes) {
      if (node.registrationMerchantList != null && !isRecordList(node.registrationMerchantList)) return null;
    }
    normalized.push(Object.assign({}, chapter, { nodes: nodes.map((node) => Object.assign({}, node)) }));
  }
  return normalized;
}

function hasTopicDetail(data) {
  const nonEmptyObject = !!data && typeof data === 'object'
    && !Array.isArray(data) && Object.keys(data).length > 0;
  if (!nonEmptyObject) return false;
  if (!String(data.name || '').trim()) return false;
  if (normalizeChaptersList(data.chaptersList) === null) return false;
  return true;
}

Page({
  data: {
    // 选场次 / 选票种弹层(稿 11 240:401 · 11a 240:446)
    sessionPicker: { show: false },
    clubSheetShow: false,
    clubSheetItems: [],
    resultSheet: { show: false, kind: 'success', title: '', sub: '', meta: '', pill: '',
      why: '', duration: RESULT_SHEET_MS,
      consentName: '', consentChecked: false, consentState: 'idle', consentError: '' },
    reducedMotion: false,
    // cy-tabs 的数据源。2026-08-05 从手抄组件类名(<view class="cy-tabs cy-tabs--fill
    // cy-tabs--wide">)改成真的用组件 —— 手抄的那份还硬编码了 --cy-tabs-accent:#028707
    // (纯绿 hue 122°，和状态成功色的 161° 不是一档，属页面自选强调色)。
    topicTabs: [{ key: '0', label: '详情' }, { key: '1', label: '路线节点' }, { key: '2', label: '路线' }],
    id: 0,
    is_join: 0,
    // 自玩通行证购买确认(P1–P6 弹层,替代 wx.showModal);报名信息单独同意必须在建单前落库
    selfPlayConfirmShow: false,
    selfPlayConsentChecked: false,
    selfPlayConfirmLoading: false,
    selfPlayConsentError: '',
    selfPlayConsentHint: '',
    info: {}, // 主题详情数据
    statBar: [],
    loadError: false,
    topicLoaded: false,
    missingTopicId: false,
    // 拍板 2026-09-16 #10:发布商家已打烊时,购票/报名入口直接提示「商家暂停营业」
    // (文案与后端 IMerchantBusinessStatusService.MERCHANT_CLOSED_MESSAGE 同源)。
    merchantClosed: false,
    loadErrorTitle: '',
    loadErrorSub: '',

    // ===== 路线地图（橙色 polyline）相关 =====
    routeReady: false,        // 是否有可画的路线
    routeIsRoad: false,       // true=后端算好的贴路线 false=节点直连兜底
    mapLatitude: 0,           // 地图中心纬度
    mapLongitude: 0,          // 地图中心经度
    routeMarkers: [],         // 节点标记（编号 1/2/3…）
    routePolyline: [],        // 橙色路线
    routeIncludePoints: [],   // 让地图自动缩放到看全整条线

    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,

    //tab切换
    activeTab: '0',

    // 评价相关
    voteShow: false,
    starsBox: [1, 1, 1, 1, 1],
    ratingStars: [],
    answer: -1,
    plnr: "",
    canSubmitComment: false,
    uploadImages: [],

    // 原有的滚动相关数据
    screenHeight: 0,
    screen1Height: 0,
    screen2Top: 0,
    currentScreen: 0,
    isScrolling: false,
    scrollTop: 0,
    startY: 0,
    startTime: 0,

    // 新增：吸顶相关数据
    isTabSticky: false, // 控制标签是否吸顶
    tabSectionTop: 0, // 标签部分距离顶部的位置
    scrollTimer: null, // 滚动计时器（用于防抖）
    topBarHeight: 0, // 顶部栏高度
    tabHeight: 100, // 标签栏高度
    totalStickyHeight: 0, // 吸顶总高度（状态栏+导航栏+标签栏）
    topicAudioPlaying: false,
  },

  onLoad(options) {
    const that = this;
    const topicId = Number(options.id);
    const validTopicId = Number.isFinite(topicId) && Number.isInteger(topicId) && topicId > 0;

    that.getSystemInfo();
    that.calculateScreenHeights();

    that.setData({
      is_join: options.is_join != undefined ? options.is_join : 0,
      id: validTopicId ? topicId : 0,
      topicLoaded: false,
    });

    if (!validTopicId) {
      that.setData({
        loadError: true,
        missingTopicId: true,
        loadErrorTitle: '无法打开主题',
        loadErrorSub: '缺少主题信息，请返回发布广场重新选择。',
        topicLoaded: false,
      });
      return;
    }

    that.getData()

    that._initWorkflow();
    that._loadSignupProfile();

    // 初始化吸顶相关数据
    setTimeout(() => {
      that.getTopBarActualHeight();
      that.getTabSectionPosition();
      that.getTabHeight();
      
      // 计算吸顶总高度
      const totalHeight = that.data.statusBarHeight + that.data.navBarHeight + that.data.tabHeight;
      that.setData({
        totalStickyHeight: totalHeight
      });
    }, 500);
  },
 
  /**
   * 获取顶部栏实际高度
   */
  getTopBarActualHeight: function() {
    const that = this;
    const query = wx.createSelectorQuery().in(this);
    
    query.select('.topbar').boundingClientRect((rect) => {
      if (rect) {
        that.setData({
          topBarHeight: rect.height
        });
      }
    }).exec();
  },

  /**
   * 获取标签部分的位置信息
   */
  getTabSectionPosition: function() {
    const that = this;
    const query = wx.createSelectorQuery().in(this);
    
    setTimeout(() => {
      query.select('#tab-section').boundingClientRect((rect) => {
        if (rect) {
          wx.createSelectorQuery().in(that).selectViewport().scrollOffset((scrollRes) => {
            const absoluteTop = rect.top + scrollRes.scrollTop;
            that.setData({
              tabSectionTop: absoluteTop
            });
          }).exec();
        }
      }).exec();
    }, 200);
  },

  /**
   * 获取标签栏高度
   */
  getTabHeight: function() {
    const that = this;
    const query = wx.createSelectorQuery().in(this);
    
    query.select('#tab-section .tab2').boundingClientRect((rect) => {
      if (rect) {
        that.setData({
          tabHeight: rect.height
        });
      }
    }).exec();
  },

  /**
   * 监听页面滚动
   */
  onPageScroll: function(e) {
    const that = this;
    const scrollTop = e.scrollTop;
    
    // 原有的滚动逻辑
    const screen1Height = this.data.screen1Height;
    this.setData({
      scrollTop: scrollTop
    });

    // 根据滚动位置判断当前所在屏幕
    if (scrollTop < screen1Height * 0.7) { // 70%作为切换阈值
      if (this.data.currentScreen !== 0) {
        this.setData({
          currentScreen: 0
        });
      }
    } else {
      if (this.data.currentScreen !== 1) {
        this.setData({
          currentScreen: 1
        });
      }
    }

    // 吸顶逻辑
    const { tabSectionTop, topBarHeight, tabHeight } = this.data;
    
    // 清除之前的计时器
    if (this.data.scrollTimer) {
      clearTimeout(this.data.scrollTimer);
    }
    
    // 防抖处理
    const scrollTimer = setTimeout(() => {
      const triggerPosition = tabSectionTop - topBarHeight - tabHeight;
      const shouldSticky = scrollTop >= triggerPosition;
      
      // 只在状态变化时更新
      if (shouldSticky !== that.data.isTabSticky) {
        that.setData({
          isTabSticky: shouldSticky
        });
      }
    }, 10);
    
    this.setData({ scrollTimer: scrollTimer });
  },
  /**
   * 页面显示时
   */
  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
    const that = this;
    
    // 重新获取所有位置信息
    setTimeout(() => {
      that.setData({
        isTabSticky: false,
      });
      
      that.getTopBarActualHeight();
      that.getTabSectionPosition();
      that.getTabHeight();
      that.calculateScreenHeights();
    }, 100);
  },

  /**
   * 页面隐藏时
   */
  onHide() {
    this.pauseTopicAudio();
    this.setData({
      isTabSticky: false,
    });
  },

  /**
   * 页面卸载时
   */
  onUnload() {
    this.destroyTopicAudio();
    if (this._workflow) this._workflow.destroy();
    if (this.data.scrollTimer) {
      clearTimeout(this.data.scrollTimer);
    }
  },

  // ===== 主题音频播放 =====
  toggleTopicAudio() {
    var that = this;
    var url = this.data.info && this.data.info.audioUrl;
    if (!url) return;
    if (this._topicAudio && this._topicAudio.src === url) {
      if (this.data.topicAudioPlaying) {
        this._topicAudio.pause();
      } else {
        this._topicAudio.play();
      }
      return;
    }
    this.destroyTopicAudio();
    var audio = wx.createInnerAudioContext();
    audio.src = url;
    audio.obeyMuteSwitch = false;
    audio.onPlay(function () { that.setData({ topicAudioPlaying: true }); });
    audio.onPause(function () { that.setData({ topicAudioPlaying: false }); });
    audio.onStop(function () { that.setData({ topicAudioPlaying: false }); });
    audio.onEnded(function () { that.setData({ topicAudioPlaying: false }); });
    audio.onError(function (err) {
      that.setData({ topicAudioPlaying: false });
      toast(app.getRequestErrorMessage(err, '播放失败'));
    });
    audio.play();
    this._topicAudio = audio;
  },

  pauseTopicAudio() {
    if (!this._topicAudio) return;
    try { this._topicAudio.pause(); } catch (e) {}
  },

  destroyTopicAudio() {
    if (!this._topicAudio) return;
    try { this._topicAudio.destroy(); } catch (e) {}
    this._topicAudio = null;
    this.setData({ topicAudioPlaying: false });
  },

  /**
   * 切换标签页
   */
  switchTab(e) {
    // cy-tabs 通过 detail.key 传当前项;保留 dataset 兼容旧调用点(若还有)
    const index = (e.detail && e.detail.key) !== undefined ? e.detail.key : e.currentTarget.dataset.index;
    this.setData({
      activeTab: index
    }, () => {
    });
  },

  scrollToSecond() {
    if (this.data.isScrolling) return;

    this.setData({
      isScrolling: true
    });

    const scrollToTarget = () => {
      wx.pageScrollTo({
        scrollTop: this.data.screen2Top,
        duration: 500,
        success: () => {
          this.setData({
            currentScreen: 1,
            isScrolling: false
          });
        },
        fail: () => {
          this.setData({
            isScrolling: false
          });
        }
      });
    };

    // 如果还没有获取到第二屏位置，先计算再滚动
    if (this.data.screen2Top <= 0) {
      this.calculateScreenHeights();
      setTimeout(scrollToTarget, 200);
    } else {
      scrollToTarget();
    }
  },
  
  goTemplateDetail(e) {
    let id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/templatedetail/templatedetail?id=' + id + '&scope=my',
    })
  },
  
  goLocation(e) {
    let latitude = e.currentTarget.dataset.latitude;
    let longitude = e.currentTarget.dataset.longitude;
    let name = e.currentTarget.dataset.name;
    let address = e.currentTarget.dataset.address;

    // 场地卡在节点无坐标时也会渲染,此时不带经纬度;openLocation 传 NaN 会静默失败
    if (!latitude || !longitude) return;

    // 打开微信内置地图查看位置
    wx.openLocation({
      latitude: parseFloat(latitude), // 纬度，范围为-90~90，负数表示南纬
      longitude: parseFloat(longitude), // 经度，范围为-180~180，负数表示西经
      name: name, // 位置名
      address: address, // 地址的详细说明
      scale: 18, // 地图缩放级别，整形值，范围从1~28
      success: function (res) {
      },
      fail: function (err) {
      }
    })
  },
  
  goPoint() {
    wx.navigateTo({
      url: '/subpackageP3/pages/growthcenter/index/index',
    })
  },

  /**
   * 触摸开始事件
   */
  touchStart(e) {
    if (this.data.isScrolling) return;
    this.setData({
      startY: e.touches[0].clientY,
      startTime: Date.now()
    });
  },
  
  /**
   * 稿 214:384「阵容/商家」。阵容说的是**参与品牌**(商家与俱乐部),不是买了票的玩家 ——
   * 页上原来两块:「阵容」列 omsTicketList[].cmsRegistrationList(报名玩家),
   * 「参与品牌」才是商家。2026-09-04 判定表定:两块是一回事,合并;俱乐部那一半原先没有。
   *
   * 同一家商家会挂在多个章节/节点上,按商家 id 去重 —— 不去重横滑条里会连着出现同一家。
   * 俱乐部没有头像字段(TopicInfoVO 只有 clubId / clubName),头像交给 cy-avatar 的兜底,
   * 不去别处凑一张。名字都没有的行直接跳过,不摆占位卡。
   */
  /* 稿 181:644 / 214:499 的「活动内容」——主题介绍下面那串「这趟里都有什么」。
     ⚠️ 稿上那六条(5 articles / 12 downloadable resources / 10 coding exercises /
        Full lifetime access / Access on mobile and TV / Certificate of completion)
        是 Udemy 的占位内容,按「那些不是我们的不做」一条都不抄。
        但**这个位置本身是真的**:买家在这一屏看不到「有几章、有没有语音导览、
        通关给不给勋章和券」—— 这四件事全在 /api/topic/info-to-user 的返回里,
        只是从来没渲染过(全仓 grep 过:finishMedalName / completeRewardCouponId /
        totalChapterCount 在两个详情页里一次都没出现)。
     只写后端真给了的事实,拿不到就少一条;一条都没有整块不出 —— 不摆空标题。
     ⚠️ 不重复顶部数据条已经说过的(评价 / 预计游玩 / 开放时间 / 总里程)。 */
  buildContentIncludes(data) {
    const d = data || {};
    const out = [];
    const chapters = Number(d.totalChapterCount);
    if (Number.isFinite(chapters) && chapters > 0) out.push(chapters + ' 个章节');
    /* CU-C-66:「N 个站点」原来读 cms_topic.location_count —— 那是主题保存时的快照,
       商家点位新增/过审不重算它,于是详情写「1 个站点」、下面列出 2 站。
       列表是实时查的,这个数也按同一份 chaptersList 实算(同源同闸)。 */
    const liveStations = (Array.isArray(d.chaptersList) ? d.chaptersList : [])
      .reduce((sum, chapter) => sum + (((chapter && chapter.nodes) || []).length), 0);
    const stations = liveStations > 0 ? liveStations : Number(d.locationCount);
    if (Number.isFinite(stations) && stations > 0) out.push(stations + ' 个站点');
    const plays = Number(d.templateCount);
    if (Number.isFinite(plays) && plays > 0) out.push(plays + ' 个玩法');
    if (d.audioUrl) {
      const mins = Math.round(Number(d.audioDuration) / 60);
      out.push(Number.isFinite(mins) && mins > 0 ? ('语音导览 ' + mins + ' 分钟') : '语音导览');
    }
    // 勋章名可以为空(后端默认「主题名 · 通关」),所以判据是**有没有配**,不是名字非空
    if (d.finishMedalName || d.finishMedalImg) {
      out.push('通关勋章：' + (d.finishMedalName || (d.name ? d.name + ' · 通关' : '通关纪念')));
    }
    // 只知道配了券、拿不到券名(TopicInfoVO 没有这个字段)—— 就只说配了,不编一个名字
    if (d.completeRewardCouponId) out.push('通关后可领一张优惠券');
    return out;
  },

  buildLineup(data) {
    const rows = [];
    if (data && String(data.clubName || '').trim()) {
      rows.push({
        key: 'club-' + (data.clubId || 0),
        kind: 'club',
        targetId: data.clubId || 0,
        name: String(data.clubName).trim(),
        role: '俱乐部',
        avatar: '',
      });
    }
    const seen = {};
    const chapters = (data && data.chaptersList) || [];
    for (let i = 0; i < chapters.length; i++) {
      const nodes = (chapters[i] && chapters[i].nodes) || [];
      for (let j = 0; j < nodes.length; j++) {
        const list = nodes[j].registrationMerchantList || [];
        for (let k = 0; k < list.length; k++) {
          const row = list[k];
          const shop = row && row.mmsMerchant;
          const name = String((shop && shop.name) || '').trim();
          if (!name) continue;
          const dedupeKey = String((shop && shop.id) || name);
          if (seen[dedupeKey]) continue;
          seen[dedupeKey] = 1;
          rows.push({
            key: 'merchant-' + dedupeKey,
            kind: 'merchant',
            targetId: row.memberId || 0,
            name,
            avatar: String(row.picUrl || '').split(',')[0].trim(),
            role: '商家',
          });
        }
      }
    }
    return rows;
  },

  /* 俱乐部去俱乐部页,商家去他的个人主页。没有落点(俱乐部没 id / 商家没 memberId)就不跳,
     不静默跳到一个错的地方。 */
  onLineupTap(e) {
    const { kind, id } = e.currentTarget.dataset;
    const targetId = Number(id) || 0;
    if (!targetId) return;
    wx.navigateTo({
      url: kind === 'club'
        ? '/pages/club/detail/index?id=' + targetId
        : '/pages/userinfo/userinfo?userId=' + targetId,
    });
  },


  /**
   * 触摸移动事件
   */
  touchMove(e) {
    // 这里可以添加一些交互效果，但不是必须的
  },

  /**
   * 触摸结束事件
   */
  touchEnd(e) {
    if (this.data.isScrolling) return;

    const endY = e.changedTouches[0].clientY;
    const distance = endY - this.data.startY;
    const duration = Date.now() - this.data.startTime;
    const minSwipeDistance = 50;

    // 只有快速滑动或距离足够时才触发
    if (Math.abs(distance) > minSwipeDistance || duration < 300) {
      // 下滑操作（手指向上滑动）
      if (distance < -minSwipeDistance && this.data.currentScreen === 0) {
        this.scrollToSecond();
      }
      // 上滑操作（手指向下滑动）- 只有在接近顶部时才返回第一屏
      else if (distance > minSwipeDistance && this.data.scrollTop <= this.data.screen2Top + 100) {
        this.scrollToFirst();
      }
    }
  },

  /**
   * 滚动到第一屏
   */
  scrollToFirst() {
    if (this.data.isScrolling) return;

    this.setData({
      isScrolling: true
    });

    wx.pageScrollTo({
      scrollTop: 0,
      duration: 500,
      success: () => {
        this.setData({
          currentScreen: 0,
          isScrolling: false
        });
      },
      fail: () => {
        this.setData({
          isScrolling: false
        });
      }
    });
  },

  /**
   * 增强版滚动到第二屏 - 处理可能的高度计算延迟
   */
  scrollToSecondEnhanced() {
    if (this.data.isScrolling) return;

    this.setData({
      isScrolling: true
    });

    const tryScroll = (attempts = 0) => {
      if (attempts > 3) {
        // 最终备用方案：滚动一屏高度
        wx.pageScrollTo({
          scrollTop: this.data.screenHeight,
          duration: 600,
          success: () => {
            this.setData({
              currentScreen: 1,
              isScrolling: false
            });
          },
          fail: () => {
            this.setData({
              isScrolling: false
            });
          }
        });
        return;
      }

      if (this.data.screen2Top > 0) {
        wx.pageScrollTo({
          scrollTop: this.data.screen2Top,
          duration: 600,
          success: () => {
            this.setData({
              currentScreen: 1,
              isScrolling: false
            });
          },
          fail: () => {
            this.setData({
              isScrolling: false
            });
          }
        });
      } else {
        // 重新计算高度后重试
        this.calculateScreenHeights();
        setTimeout(() => tryScroll(attempts + 1), 200);
      }
    };

    tryScroll();
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => this.goTopicList()
    });
  },

  goTopicList() {
    wx.reLaunch({ url: '/pages/template/index' });
  },
  
  // 提交评价
  submitComment() {
    const that = this;
    if (!that.data.canSubmitComment) return;
    const {
      answer,
      plnr,
      id
    } = that.data;

    if (answer === -1) {
      toast('请选择评分');
      return;
    }

    if (!plnr.trim()) {
      toast('请输入评价内容');
      return;
    }
    app.sendRequest({
      url: '/api/comment/add',
      data: {
        owner_type: 1,
        owner_id: id,
        rating: answer + 1,
        contents: plnr,
        reply_id: 0,
        img_arr: that.data.uploadImages.join(';')
      },
      method: "POST",
      success: function (res) {
        if (res.code == "200") {
          toast.success('评价成功');
          that.voteClose();
          // 重新加载数据更新评价列表
          that.getData();
        } else {
          app.tips(res.msg);
        }
      }
    });
  },
  
  //报名
  // F2-3 售票门禁:招募/定价阶段点购票的提示
  lockedTip() {
    const lc = this.data.info && this.data.info.lifecycle;
    if (lc == 2 && this.data.info && this.data.info.isOwner == 1) {
      wx.navigateTo({ url: '/pages/topic/pricing/index?topicId=' + this.data.id });
      return;
    }
    toast(lc == 1 ? '该主题招募中,暂未开售' : '该主题定价中,暂未开售');
  },

  bmClick(e) {

    if(app.getUserType()==2){
      toast('商家用户不可报名主题');
      return;
    }
    if (this.data.merchantClosed) { toast('商家暂停营业，暂不可报名', { icon: 'none' }); return; }

    /* 2026-09-06 用户拍板:**主题报名没有废弃,是这里写错了**。
       原来这段把人踢去 play-activity-detail 再选一遍票 —— 主题页上明明已经把场次
       和价格都列出来了(det5 那一段),点一下却跳走,回来还得重新找。
       现在按稿 11/11a 在主题页内开弹层选场次 + 票种,选完直接进结算。

       ⚠️ 票仍然绑到具体场次(结算走 baoming?activityId=X&ticketId=Y,后端 ownerType=2),
       「主题页内能买」说的是**交互层**,不是绕过场次买一张没人核销的票。
       被删掉的那句老注释把这两件事混成了一件,顺带还写了一套靠
       name/startTime 字符串去猜「这张票属于哪个场次」的映射 —— 弹层里直接按场次
       拉它自己的票,那套猜测不需要了。 */
    const activities = (this.data.info && this.data.info.activityList) || [];
    if (!activities.length) {
      toast('暂无可参加的场次', { icon: 'none' });
      return;
    }
    this.setData({ sessionPicker: { show: true } });
  },

  closeSessionPicker() { this.setData({ 'sessionPicker.show': false }); },

  // 选完场次与票种 → 结算。参数形状与活动详情页那条入口一致,后端一处都不用改。
  onSessionPicked(e) {
    const picked = (e && e.detail) || {};
    if (!picked.activityId || !picked.ticketId) return;
    this.setData({ 'sessionPicker.show': false });
    wx.navigateTo({
      url: '/pages/activity/baoming/baoming?activityId=' + picked.activityId
        + '&ticketId=' + picked.ticketId,
    });
  },

  // Beta 转正式:清 beta_flag,主题从此不再挂 Beta 标识。仅主题作者(info.isOwner==1)可见入口。
  // 服务端 WHERE beta_flag=1 才清,所以重复点击/并发只会成功一次,失败按「不在 Beta 期」回话。
  onGraduateBeta() {
    const that = this;
    const topicId = that.data.id;
    if (!topicId) return;
    modal.show({
      title: '转为正式主题',
      content: '转正后不再显示 Beta 试玩标识。主题内容、已售出的票和进行中的行程都不受影响。',
      confirmText: '确认转正',
      success(m) {
        if (!m.confirm) return;
        app.sendRequest({
          url: '/api/topic/beta/graduate',
          method: 'POST',
          data: { topicId: topicId },
          success(r) {
            if (r.code == '200') {
              app.tips('已转为正式主题');
              that.setData({ 'info.betaFlag': 0 });
            } else {
              app.tips(r.msg || '转正失败');
            }
          }
        });
      }
    });
  },

  // 移交给俱乐部承接:复制一份新的城市定向草稿挂到所选承接俱乐部,并下架原主题;发起人保留所有权。仅主题创建者(info.isOwner==1)可见入口。
  onTransferToClub() {
    const that = this;
    const topicId = that.data.id;
    if (!topicId) return;
    app.sendRequest({
      hideLoading: true, url: '/api/club/my', method: 'POST', data: {},
      success(res) {
        const clubs = (res.code == '200' && res.data) || [];
        if (!clubs.length) { app.tips('你还没有可承接的俱乐部'); return; }
        const shown = clubs.slice(0, 6); // 上限 6 项:沿用原 ActionSheet 的口径,本轮不改行为
        /* 2026-09-02:原来这里弹 wx.showActionSheet(系统弹层,设计体系外)。
           选俱乐部属于「一次选择」,走 cy-option-sheet 默认形态;选中之后的二次确认
           modal 保留 —— 移交是不可逆写,那一步不能省。 */
        that._clubSheetClubs = shown.map(c => ({ id: c.id, name: c.name }));   // 同上,不渲染 ⇒ 不进 data
        that.setData({
          clubSheetShow: true,
          clubSheetItems: shown.map(c => c.name),
        });
      },
      fail() { app.tips('网络异常，请重试'); }
    });
  },

  onClubSheetCancel() { this.setData({ clubSheetShow: false }); },

  onClubSheetSelect(e) {
    const that = this;
    const topicId = that.data.id;
    const club = (that._clubSheetClubs || [])[e.detail.index];
    that.setData({ clubSheetShow: false });
    if (!club || !topicId) return;
    modal.show({
      title: '移交给俱乐部承接',
      content: '将复制一份新的城市定向主题(有人带),挂到「' + club.name + '」承接;原主题会下架,历史票不受影响。',
      confirmText: '确认移交',
      success(m) {
        if (!m.confirm) return;
        app.sendRequest({
          url: '/api/topic/transfer-to-club',
          // 后端 transferToClub(String topicId, String clubId, …) 是 form 绑定(ApiTopicController:783):
          // 发 JSON body 时 getParameter 拿不到 → 恒「参数不完整」。
          data: { topicId: topicId, clubId: club.id },
          method: 'POST',
          success(r) {
            if (r.code == '200') {
              const newId = r.data && r.data.newTopicId;
              modal.show({
                title: '已移交',
                content: '已生成新的城市定向草稿,去配置票种并邀请该俱乐部承接?',
                confirmText: '去配置', cancelText: '稍后',
                success(g) {
                  if (g.confirm && newId) {
                    wx.navigateTo({ url: '/pages/topic/index/index?id=' + newId });
                  }
                }
              });
            } else {
              app.tips(r.msg || '移交失败');
            }
          },
          fail() { app.tips('网络异常，请重试'); }
        });
      }
    });
  },

  _initWorkflow() {
    const that = this;
    const verifyRegistrationPayment = createRegistrationPaymentVerifier(app);
    that._workflow = createCheckoutWorkflow({
      createOrder: function (payload, cb) {
        const { topicId, realName, phone, requestId } = payload;
        loading.show('提交中...');
        const body = {
          ownerType: 1,
          ownerId: topicId,
          realName: realName,
          phone: phone,
          isUsePoint: 0,
          requestId: requestId
        };
        // 3-5 票源归因:主题页这一单 ownerType=1,ownerId 就是「期」本身,
        // 所以直接拿建单参数喂 attributionPayload(它内部已判「捕获期 ≠ 下单期 ⇒ 不带」)。
        Object.assign(body, ticketSource.attributionPayload(topicId));
        return app.sendRequest({
          url: '/api/registration/create',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: JSON.stringify(body),
          success: function (res) {
            if (isTerminalOrderConflict(res)) {
              // fix-be-0917(B-R2):旧幂等键对应的自玩单已取消/已过期,后端不再重放终态单。
              // 作废旧键,交给 onOrderFail 换新键重建。
              that._selfPlayReqId = null;
              that._rebuildFallbackMessage = res.msg || '';
              cb({ ok: false, msg: ORDER_REBUILD_REQUIRED });
              return;
            }
            loading.hide();
            if (res.code == '200' && res.data) {
              var d = res.data;
              if (d.payParams && d.payParams.package) {
                that._selfPlayReqId = null;
                cb({ ok: true, data: d });
              } else if (d.payableAmount === 0) {
                that._selfPlayReqId = null;
                cb({ ok: true, data: d });
              } else if (d.registrationId) {
                // 重放命中已有订单,回到那张订单取支付参数
                loading.show('获取支付参数...');
                app.sendRequest({
                  url: '/api/registration/pay',
                  method: 'POST',
                  data: { id: d.registrationId },
                  success: function (payRes) {
                    // 拍板 #21:自玩通行证的过期待支付单 —— 后端这次 /pay 已即时关单,
                    // 旧幂等键重放只会再撞关单。不提示,交给 onOrderFail 换新键重建。
                    if (isOrderExpiredFailure(payRes)) {
                      that._selfPlayReqId = null;
                      that._rebuildFallbackMessage = ORDER_EXPIRED_USER_MESSAGE;
                      cb({ ok: false, msg: ORDER_REBUILD_REQUIRED });
                      return;
                    }
                    loading.hide();
                    if (payRes.code == '200' && payRes.data && payRes.data.payParams && payRes.data.payParams.package) {
                      that._selfPlayReqId = null;
                      cb({ ok: true, data: payRes.data });
                    } else {
                      cb({ ok: false, msg: payRes.msg || '支付信息不完整，请重试' });
                    }
                  },
                  fail: function () {
                    loading.hide();
                    cb({ ok: false, msg: '网络错误，请重试' });
                  }
                });
              } else {
                cb({ ok: false, msg: '支付信息不完整，请重试' });
              }
            } else {
              cb({ ok: false, msg: res.msg || '下单失败' });
            }
          },
          fail: function () {
            loading.hide();
            cb({ ok: false, msg: '网络错误，请重试' });
          }
        });
      },
      requestPayment: function (orderData, cb) {
        var p = orderData.payParams;
        wx.requestPayment({
          timeStamp: p.timeStamp,
          nonceStr: p.nonceStr,
          package: p.package,
          signType: p.signType,
          paySign: p.paySign,
          success: function () { cb({ ok: true }); },
          fail: function (res) {
            cb({ ok: false, cancelled: res.errMsg === 'requestPayment:fail cancel', errMsg: res.errMsg });
          }
        });
      },
      verifyPayment: function (data, cb) {
        var regId = data.registrationId;
        if (!regId) { cb({ ok: false, errMsg: '缺少订单编号' }); return; }
        return verifyRegistrationPayment({ registrationId: regId }, cb);
      }
    });
  },

  // M2 购买自玩通行证:确认(90天有效期+安全须知)→ /create(ownerType=1) → 支付 → play?topicId=
  selfPlayBuy() {
    const that = this;
    if (that.data.merchantClosed) { toast('商家暂停营业，暂不可报名', { icon: 'none' }); return; }
    const info = that.data.info || {};
    const topicId = info.id || that.data.id;
    if (!topicId) return;
    if (app.getUserType() == 2) {
      toast('商家用户不可购买');
      return;
    }
    that._selfPlayTopicId = topicId;
    that.setData({
      selfPlayConfirmShow: true,
      selfPlayConsentChecked: !!that._hostShareConsentReady,
      selfPlayConsentError: '',
      selfPlayConsentHint: '',
      selfPlayConfirmLoading: false
    });
  },

  onSelfPlayConsentChange(e) {
    const checked = !!(e && e.detail && e.detail.checked);
    if (!checked) this._hostShareConsentReady = false;
    this.setData({ selfPlayConsentChecked: checked, selfPlayConsentError: '', selfPlayConsentHint: '' });
  },

  onSelfPlayCancel() {
    if (this.data.selfPlayConfirmLoading) return;
    this.setData({ selfPlayConfirmShow: false });
  },

  // 后端 /api/registration/create 与 /pay 硬校验「报名信息单独同意」已落库(activity_host_data_sharing /
  // activity_signup)。这里必须先等 recordConsent 成功再建单,否则自玩单永远被拒。
  onSelfPlayConfirm() {
    const that = this;
    const topicId = that._selfPlayTopicId || (that.data.info && that.data.info.id) || that.data.id;
    if (!topicId || that.data.selfPlayConfirmLoading) return;
    if (!that.data.selfPlayConsentChecked) {
      // 单独同意只能用户自己勾,按钮不代勾;这里只提示,不算错误态
      that.setData({ selfPlayConsentHint: '请先勾选上面的同意，才能为你建单' });
      return;
    }
    if (that._hostShareConsentReady) {
      that.setData({ selfPlayConfirmShow: false });
      that._createSelfPlayOrder(topicId);
      return;
    }
    if (!app.recordConsent) {
      that.setData({ selfPlayConsentError: '同意记录服务暂不可用，请稍后重试' });
      return;
    }
    that.setData({ selfPlayConfirmLoading: true, selfPlayConsentError: '' });
    app.recordConsent({
      docType: 'activity_host_data_sharing',
      scene: 'activity_signup',
      eventType: 'AGREE'
    }).then(function () {
      that._hostShareConsentReady = true;
      that.setData({ selfPlayConfirmLoading: false, selfPlayConfirmShow: false });
      that._createSelfPlayOrder(topicId);
    }).catch(function () {
      that.setData({ selfPlayConfirmLoading: false, selfPlayConsentError: '同意记录未保存，请检查网络后重试' });
    });
  },

  goMyOrders() {
    wx.navigateTo({ url: '/subpackageMember/order/order' });
  },

  // /api/registration/create 的 realName/phone 是 @NotBlank(RegistrationRequest.java:37,42)。
  // 本页原先 data.userInfo 从声明到使用之间没有任何一处赋值 ⇒ 自玩通行证建单恒以空姓名空号提交,
  // 任何玩家、任何在架自玩主题都买不成。这里按报名页同一口径把资料取回来缓存。
  // 只喂建单、页面不渲染,所以存实例字段而不是 setData(U4 A2:内部状态不该进 data)。
  _loadSignupProfile(done) {
    const that = this;
    const settle = function () { done && done(that._signupProfile || null); };
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      method: 'POST',
      data: { member_id: app.getUserID() },
      success(res) {
        const d = res && res.code == '200' && res.data
          && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : null;
        const realName = d ? (d.name || d.realName || d.fullName || '') : '';
        const phone = d ? (d.phone || d.mobilePhone || '') : '';
        // 只在两项都齐时才落缓存:半套缓存会让下面那次「现取一次」白取并原地打转。
        if (realName && phone) that._signupProfile = { realName: realName, phone: phone };
        settle();
      },
      fail: settle
    });
  },

  // 资料没补全时不要去打一发必被拒的建单:后端只会回「姓名不能为空」,
  // 玩家看到的是一句跟自己无关的报错,而且没有任何出路。
  _signupProfileMissing() {
    const u = this._signupProfile || {};
    return !u.realName || !u.phone;
  },

  _createSelfPlayOrder(topicId) {
    const that = this;
    if (that._selfPlaySubmitting) return;
    that._selfPlaySubmitting = true;

    if (!that._selfPlayReqId) {
      that._selfPlayReqId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }
    if (that._signupProfileMissing()) {
      // 进页预取可能还没回来(弱网、或进页就点购买)。先现取一次再判,
      // 否则会把「资料其实全」的人误判成没填、推去补一个本来就填好的字段。
      that._loadSignupProfile(function (profile) {
        that._selfPlaySubmitting = false;
        if (profile) { that._createSelfPlayOrder(topicId); return; }
        modal.show({
          title: '还差姓名和手机号',
          content: '建单要用你的真实姓名和手机号，资料页补一次就好，之后不用再填。',
          confirmText: '去补全',
          cancelText: '稍后再说',
          success(res) {
            if (res && res.confirm) wx.navigateTo({ url: '/pages/gerenziliao/gerenziliao' });
          }
        });
      });
      return;
    }

    const u = that._signupProfile;
    const payload = {
      topicId: topicId,
      realName: u.realName,
      phone: u.phone,
      requestId: that._selfPlayReqId
    };

    var submitted = that._workflow.submit(payload, {
      onOrderFail: function (res) {
        that._selfPlaySubmitting = false;
        // 拍板 #21 / fix-be-0917:旧幂等键不可用(单已过期/已取消)先自动换新键重建一次;
        // 重建后仍不可用才给可见提示。
        if (res && res.msg === ORDER_REBUILD_REQUIRED) {
          if (that._rebuildSelfPlayOrderWithNewKey(topicId)) return;
          loading.hide();
          res = { msg: that._rebuildFallbackMessage || ORDER_EXPIRED_USER_MESSAGE };
        }
        toast(res && res.msg || '下单失败');
      },
      onFreeSuccess: function (data) {
        that._selfPlaySubmitting = false;
        that._selfPlayReqId = null;
        that._goSelfPlay(topicId);
      },
      onPayVerifying: function (data) {
        loading.show('确认支付结果...');
      },
      onPaySuccess: function (data) {
        that._selfPlaySubmitting = false;
        that._selfPlayReqId = null;
        loading.hide();
        that._goSelfPlay(topicId);
      },
      onPayCancel: function () {
        that._selfPlaySubmitting = false;
        toast('已取消支付');
      },
      onPayFail: function (res) {
        loading.hide();
        that._selfPlaySubmitting = false;
        toast(res && res.errMsg || '支付失败');
        // 付款失败不清幂等键,同一意图重试复用
      },
      onPayUnknown: function () {
        loading.hide();
        that._selfPlaySubmitting = false;
        modal.show({
          title: '支付结果待确认',
          content: '暂不要重复支付，请稍后从订单或主题页查看通行证状态。',
          showCancel: false
        });
      }
    });

    if (!submitted) {
      that._selfPlaySubmitting = false;
      loading.hide();
      // unknown 是 workflow 故意留的闸(防重复建单扣款),但闸不能是哑巴:
      // 关掉「支付结果待确认」弹层后再点同一个按钮,原来什么都不说。
      if (that._workflow.getState() === 'unknown') {
        modal.show({
          title: '支付结果待确认',
          content: '这笔付款还在确认中，请勿重复支付。稍后可到「我的-订单」查看通行证状态。',
          showCancel: false
        });
      }
    }
  },

  /**
   * 2026-09-17 拍板 #21(+fix-be-0917 B-R2):旧幂等键不可用时自动换新键重建(与报名页同口径)。
   * 触发面:① /pay 见过期拒绝(后端已即时关单);② /create 回终态单冲突 409(已取消/已过期)。
   * 检测点已作废旧键,这里换新键回到正常建单接口重建(商家闭店/名额/价格等校验照走)。
   * 每次购买意图只自动重建一次;重建后仍不可用由 onOrderFail 给可见提示(旧键此时已作废,
   * 用户再点一次就是全新一单)。
   */
  _rebuildSelfPlayOrderWithNewKey(topicId) {
    const that = this;
    if (that._rebuildUsed) return false;
    that._rebuildUsed = true;
    // 与报名页同因:先收掉上一跳的 loading,避免重建路上任何早退把遮罩留在屏上。
    loading.hide();
    that._createSelfPlayOrder(topicId);
    return true;
  },

  _retrySelfPlayPayment(registrationId, topicId) {
    const that = this;
    app.sendRequest({
      url: '/api/registration/pay',
      method: 'POST',
      data: { id: registrationId },
      success: (res) => {
        if (res.code == '200' && res.data && res.data.payParams && res.data.payParams.package) {
          that._selfPlayReqId = null;
          // 走 order 路径的重新支付
          that._workflow.submit({ id: registrationId }, {
            onOrderFail: function () { toast('支付信息不完整，请重试'); },
            onPaySuccess: function () { that._goSelfPlay(topicId); },
            onPayCancel: function () { toast('已取消支付'); },
            onPayFail: function (res) { toast('支付失败'); }
          });
        } else {
          toast(res.msg || '支付信息不完整，请重试');
        }
      },
      fail: () => {
        toast('网络错误，请重试');
      }
    });
  },

  /* 自玩票买完的唯一落点(三个调用点都走这儿)。原来是 toast + 800ms 硬等,
     现在换成结果面板:跳转挂在面板收掉之后,时长只此一处,不再两个数字各说各话。 */
  _goSelfPlay(topicId) {
    this.setData({
      resultSheet: {
        show: true, kind: 'success', title: '购买成功',
        sub: '票已放入票夹,随时可以开始探索。',
        meta: '', pill: '', why: '', duration: RESULT_SHEET_MS,
        consentName: '', consentChecked: false, consentState: 'idle', consentError: '',
      },
    });
    // 2026-09-17 拍板第 40 条 A:这单背后有生效商家且尚未同意时,面板里多一行可选勾选。
    // 拿不到 / 已同意 / 有歧义一律不出(见 utils/marketing-consent-entry.js)。
    this._loadMarketingConsentOffer((this.data.info && this.data.info.memberId) || 0);
  },

  /* 同意入口:owner memberId 来自主题详情已返回的 memberId;商家一方 id 只认 GET 回包。
     面板已收掉就不再补塞 —— 错过的用户在订单详情「权益已核销」处还有兜底入口。 */
  _loadMarketingConsentOffer(ownerMemberId) {
    const that = this;
    that._consentOffer = null;
    that._consentRequestId = null;
    marketingConsent.loadOffer(app, ownerMemberId, function (offer) {
      if (!offer) return;
      if (!that.data.resultSheet || !that.data.resultSheet.show) return;
      that._consentOffer = offer;
      that._consentRequestId = marketingConsent.newRequestId('self-play');
      that.setData({
        'resultSheet.consentName': offer.merchantName,
        'resultSheet.consentChecked': false,
        'resultSheet.consentState': 'idle',
        'resultSheet.consentError': '',
      });
    });
  },

  onResultConsentChange(e) {
    const checked = !!(e.detail && e.detail.checked);
    const state = this.data.resultSheet.consentState;
    if (state === 'saving') return;                       // 在途结果说了算,勾选态不来回抖
    if (!checked) {
      this.setData({ 'resultSheet.consentChecked': false, 'resultSheet.consentState': 'idle', 'resultSheet.consentError': '' });
      return;
    }
    const offer = this._consentOffer;
    if (!offer) return;
    this._submitMarketingConsent(offer);
  },

  onResultConsentRetry() {
    if (!this._consentOffer || this.data.resultSheet.consentState === 'saving') return;
    this._submitMarketingConsent(this._consentOffer);
  },

  /* 同一次勾选意图(含失败重试)复用同一个 requestId:重放由服务端识别,不写第二条。 */
  _submitMarketingConsent(offer) {
    const that = this;
    if (!that._consentRequestId) that._consentRequestId = marketingConsent.newRequestId('self-play');
    that.setData({ 'resultSheet.consentChecked': true, 'resultSheet.consentState': 'saving', 'resultSheet.consentError': '' });
    marketingConsent.optIn(app, offer, that._consentRequestId, function (result) {
      if (result.ok) {
        // 成功态就是面板上那行「已同意,可在设置里随时退订」—— 不再补一发两秒就没的 toast
        // (成功 toast 棘轮只减不增:提示不替代状态)。
        that.setData({ 'resultSheet.consentState': 'saved', 'resultSheet.consentError': '' });
        return;
      }
      that.setData({ 'resultSheet.consentState': 'failed',
        'resultSheet.consentError': result.message || '同意没有保存成功，请重试' });
    });
  },

  onResultSheetClose() {
    this.setData({ 'resultSheet.show': false });
    wx.navigateTo({ url: '/subpackageMember/signup/index' });
  },

  // 票夹的 focusId 是 registrationId(signup/index.js:118),这里手上只有 topicId,传过去永远定位不到;
  // 老实打开路线票 tab,让用户在票夹里点那张票进 play。
  goJoinedPlay() {
    wx.navigateTo({ url: '/subpackageMember/signup/index?stype=0' });
  },

  //投票弹框打开
  voteClick() {
    this.setData({
      voteShow: true
    })
  },
  
  //投票弹框关闭
  voteClose() {
    this.setData({
      voteShow: false,
      answer: -1,
      plnr: "",
      uploadImages: [],
      canSubmitComment: false
    });
  },
  
  // 上传图片
  upLoadImg() {
    const that = this;
    app.chooseImage(function (res) {
      let ll = that.data.uploadImages != "" ? that.data.uploadImages : [];
      res.forEach(function (v) {
        ll.push(v);
      })
      that.setData({
        'uploadImages': ll
      })
    }, 6);
  },
  
  // 删除图片
  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.uploadImages;
    images.splice(index, 1);
    this.setData({
      uploadImages: images
    });
  },
  
  // 预览图片
  previewImage(e) {
    const src = e.currentTarget.dataset.src;
    wx.previewImage({
      current: src,
      urls: this.data.uploadImages
    });
  },
  
  
  /**
   * 评分组件选中处理 
   */
  changePic: function (e) {
    let f = this
    var index = e.currentTarget.dataset.index

    f.setData({
      answer: index
    }, () => f.refreshCommentState())
  },

  /**
   * 计算各屏高度和位置
   */
  calculateScreenHeights() {
    const that = this;

    // 延迟执行，确保页面渲染完成
    setTimeout(() => {
      const query = wx.createSelectorQuery();

      // 获取第一屏高度和第二屏位置
      query.select('#screen1').boundingClientRect();
      query.select('#screen2').boundingClientRect();

      query.exec((res) => {
        if (res[0] && res[1]) {
          const screen1Height = res[0].height;
          const screen2Top = res[1].top + that.data.scrollTop; // 加上当前滚动位置

          that.setData({
            screen1Height: screen1Height,
            screen2Top: screen2Top
          });

        } else {
          // 如果获取失败，使用备用方案
          that.setData({
            screen1Height: that.data.screenHeight,
            screen2Top: that.data.screenHeight
          });
        }
      });
    }, 800);
  },

  /**
   * 获取系统信息
   */
  getSystemInfo() {
    const that = this;
    wx.getSystemInfo({
      success: function (res) {
        that.setData({
          screenHeight: res.windowHeight
        });
      }
    });
  },

  /**
   * 格式化日期
   */
  formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}.${day}`;
  },

  // 场地卡数据:addressName 形如「龙美术馆（上海市徐汇区龙腾大道3398号）」,拆成名称+地址;
  // 主题本身没有经纬度字段,坐标借第一个有坐标的节点(即路线起点),没有就只展示不跳地图
  buildVenue(data) {
    const raw = String(data.addressName || '').trim();
    if (!raw) return null;
    const m = raw.match(/^(.*?)[（(](.+?)[）)]\s*$/);
    const venue = { name: m ? m[1].trim() : raw, addr: m ? m[2].trim() : '' };
    const chapters = data.chaptersList || [];
    for (const chapter of chapters) {
      for (const node of (chapter.nodes || [])) {
        if (node.latitude && node.longitude) {
          venue.latitude = node.latitude;
          venue.longitude = node.longitude;
          return venue;
        }
      }
    }
    return venue;
  },

  /**
   * 将秒数转换为小时数字格式
   * @param {number} seconds - 秒数
   * @returns {number} 小时数（整数或小数）
   */
  formatHour(seconds) {
    if (seconds === null || seconds === undefined || seconds === '') return 0;

    // 确保输入是数字
    const sec = Number(seconds);
    if (isNaN(sec) || sec < 0) return 0;

    // 计算小时数（保留1位小数）
    const hours = sec / 3600;

    // 根据需求返回整数或小数
    if (hours % 1 === 0) {
      // 整数小时
      return hours;
    } else {
      // 小数小时，保留1位小数
      return Math.round(hours * 10) / 10;
    }
  },
  
  formatTimeToChinese(seconds) {
    if (seconds === null || seconds === undefined || seconds === '') return '0时';
    
    // 确保输入是数字
    const sec = Number(seconds);
    if (isNaN(sec) || sec < 0) return '0时';
    
    // 计算小时和分钟
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    
    // 格式化输出
    if (hours === 0) {
      // 少于1小时
      if (minutes === 0) {
        return '小于1分钟';
      } else {
        return `${minutes}分钟`;
      }
    } else {
      // 1小时或以上
      if (minutes === 0) {
        return `${hours}时`;
      } else {
        return `${hours}时${minutes}分`;
      }
    }
  },
  
  // 文本域失去焦点
  onCommentInput(e) {
    this.setData({
      plnr: e.detail.value
    }, () => this.refreshCommentState());
  },

  refreshCommentState() {
    const canSubmitComment = this.data.answer !== -1 && !!(this.data.plnr || '').trim();
    if (canSubmitComment !== this.data.canSubmitComment) this.setData({ canSubmitComment });
  },
   
  //获取数据
  /**
   * 构建路线地图数据：把所有章节的节点按 sort_id 拍平，
   * 生成节点 marker + 橙色 polyline。
   * 贴路线优先：若后端在 chapter 上返回 routeGeometry（算好的沿路坐标），
   * 则拼接成贴路线；否则用节点直连兜底（开发期立即可见）。
   */
  buildRouteMap: function (chaptersList) {
    const that = this;
    const chapters = chaptersList || [];

    // 1) 拍平所有节点并按 sort_id 排序（后端已排，这里防御性再排一次）
    const nodes = [];
    chapters.forEach(function (c) {
      (c.nodes || []).forEach(function (n) { nodes.push(n); });
    });
    nodes.sort(function (a, b) {
      return (Number(a.sortId) || 0) - (Number(b.sortId) || 0);
    });

    // 2) 过滤出有合法经纬度的节点（库里是 String，需转 Number）
    const valid = nodes.filter(function (n) {
      const lat = Number(n.latitude);
      const lng = Number(n.longitude);
      return n.latitude && n.longitude && !isNaN(lat) && !isNaN(lng);
    });

    if (valid.length === 0) {
      that.setData({ routeReady: false });
      return;
    }

    // 3) 节点 marker（编号 1/2/3…）
    const markers = valid.map(function (n, i) {
      return {
        id: i,
        latitude: Number(n.latitude),
        longitude: Number(n.longitude),
        width: 24,
        height: 24,
        iconPath: '/images/icon_map4.png',
        callout: {
          content: (i + 1) + (n.name ? ' ' + n.name : ''),
          color: '#FFFFFF',
          bgColor: '#1A1A1A',   // 去紫:原生 map callout 是 JS 字面量,吃不到 CSS var
          padding: 6,
          borderRadius: 8,
          fontSize: 11,
          display: 'BYCLICK'
        }
      };
    });

    // 4) 路线：贴路线优先（拼接各章节 routeGeometry），否则节点直连
    let linePoints = [];
    let hasRoad = false;
    chapters.forEach(function (c) {
      if (c.routeGeometry) {
        try {
          const seg = JSON.parse(c.routeGeometry);
          if (Array.isArray(seg) && seg.length) {
            seg.forEach(function (p) {
              const lat = Number(p.latitude !== undefined ? p.latitude : p.lat);
              const lng = Number(p.longitude !== undefined ? p.longitude : p.lng);
              if (!isNaN(lat) && !isNaN(lng)) {
                linePoints.push({ latitude: lat, longitude: lng });
              }
            });
            hasRoad = true;
          }
        } catch (e) {
          // routeGeometry 解析失败则忽略，走兜底
        }
      }
    });
    if (!hasRoad) {
      linePoints = valid.map(function (n) {
        return { latitude: Number(n.latitude), longitude: Number(n.longitude) };
      });
    }

    const polyline = linePoints.length >= 2 ? [{
      points: linePoints,
      color: '#1A1A1A',        // 去紫:原生 map polyline,与 callout 同色系
      width: 5,
      borderColor: '#FFFFFF',
      borderWidth: 1,
      arrowLine: true
    }] : [];

    that.setData({
      routeReady: true,
      routeIsRoad: hasRoad,
      mapLatitude: Number(valid[0].latitude),
      mapLongitude: Number(valid[0].longitude),
      routeMarkers: markers,
      routePolyline: polyline,
      routeIncludePoints: linePoints.length ? linePoints : markers.map(function (m) {
        return { latitude: m.latitude, longitude: m.longitude };
      })
    });
  },

  /**
   * 点击节点 marker：提示节点名（后续可改成滚动到对应节点卡片）
   */
  onNodeTap: function (e) {
    const markerId = (e.detail && e.detail.markerId !== undefined) ? e.detail.markerId : e.markerId;
    const m = (this.data.routeMarkers || [])[markerId];
    if (m && m.callout && m.callout.content) {
      toast(m.callout.content);
    }
  },

  getData: function () {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/topic/info-to-user',
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      data: {
        id: that.data.id
      },
      method: "POST",
      success: function (res) {
        if (res.code == "200") {
          if (!hasTopicDetail(res.data)) {
            that.setData({
              loadError: true,
              missingTopicId: false,
              loadErrorTitle: '主题暂时无法打开',
              loadErrorSub: res.msg || '主题详情暂时无法加载，请稍后重试。',
              topicLoaded: false,
            });
            return;
          }
          res.data['chaptersList'] = normalizeChaptersList(res.data['chaptersList'])
          const totalChapterCount = Number(res.data.totalChapterCount || 0)
          const unlockedChapterCount = Number(
            res.data.unlockedChapterCount != null
              ? res.data.unlockedChapterCount
              : res.data.chaptersList.length
          )
          res.data['lockedChapterCount'] = Math.max(0, totalChapterCount - unlockedChapterCount)
          res.data['showStartDate'] = that.formatDate(res.data['startDate'])
          res.data['showEndDate'] = that.formatDate(res.data['endDate'])
          res.data['omsTicketList'] = that.processTopicDate(res.data['omsTicketList'])
          res.data['perkCapacityText'] = that.formatPerkCapacity(res.data['perkSellableCapacity'])
          res.data['totalHour'] = that.formatHour(res.data['totalTime'])
          res.data['totalTimeFormatted'] = that.formatTimeToChinese(res.data['totalTime'])


          if (res.data['chaptersList']) {
            res.data['chaptersList'] = that.processChaptersList(res.data['chaptersList']);
            that.buildRouteMap(res.data['chaptersList']);
          }
          // 放在 if 外面:没有章节的主题也可能有俱乐部,阵容不该跟着章节一起消失
          res.data['lineup'] = that.buildLineup(res.data);
          res.data['contentIncludes'] = that.buildContentIncludes(res.data);

          res.data['venue'] = that.buildVenue(res.data);
          const rounded = Math.max(0, Math.min(5, Math.round(Number(res.data.averageRating) || 0)));
          const ratingStars = [];
          for (let i = 1; i <= rounded; i++) ratingStars.push({ star: i });

          that.setData({
            info: res.data,
            // P0(2026-09-05 审核):已购态不再只信 URL 参数 is_join(全仓只有订单详情会传 1,
            // 从首页/搜索进来的已购用户永远看不到「开始玩」)。/info-to-user 已按 ownerType=1 &
            // registrationStatus=2 回填 isSignUp,与自玩通行证的建单口径同源,直接用它。
            is_join: (String(that.data.is_join) === '1' || Number(res.data.isSignUp) === 1) ? 1 : 0,
            // 稿 214:384 的数据条:与商家版 181:575 同一份格子(utils 里只有一份实现)
            statBar: buildTopicStatBar(res.data),
            ratingStars,
            // 探店日/自由探索(productType=2):场次块换真场次卡,不再当「阵容」花名册渲染
            isExplore: Number(res.data.productType) === 2,
            loadError: false,
            topicLoaded: true,
            everLoaded: true,   // 成功读到过一次:之后的刷新失败留在原页给重试,不 auto-back 把人踢走
            missingTopicId: false,
            merchantClosed: res.data.merchantClosed === true,
            loadErrorTitle: '',
            loadErrorSub: '',
          });

          // 数据加载完成后重新计算位置
          setTimeout(() => {
            that.getTabSectionPosition();
            that.getTabHeight();
          }, 300);
        } else {
          that.setData({
            loadError: true,
            missingTopicId: false,
            loadErrorTitle: '主题暂时无法打开',
            loadErrorSub: res.msg || '主题详情暂时无法加载，请稍后重试。',
            topicLoaded: false,
          });
        }
      },
      fail: function (res) {
        that.setData({
          loadError: true,
          missingTopicId: false,
          loadErrorTitle: '主题详情加载失败',
          loadErrorSub: '网络连接异常，请稍后重试。',
          topicLoaded: false,
        });
      }
    });
  },

  // 详情加载失败重试(cy-error retry 事件)
  onRetryLoad: function () {
    if (this.data.missingTopicId) {
      this.goTopicList();
      return;
    }
    this.setData({ loadError: false, topicLoaded: false, loadErrorTitle: '', loadErrorSub: '' });
    this.getData();
  },
  
  /**
   * 特殊数据处理函数 - 处理主题日期
   */
  processTopicDate: function (list, sellableCapacity) {
    if (!isRecordList(list) || list.length === 0) return [];
    
    for (let i = 0; i < list.length; i++) {
      if (list[i]['startTime']) {
        let [datePart, timePart] = list[i]['startTime'].split(' ');
        let [, month, day] = datePart.split('-');
        let [hour, minute] = timePart.split(':');
        list[i]['monthDayTime'] = `${month}-${day} ${hour}:${minute}`;
      }
      if (list[i]['endTime']) {
        let [datePart, timePart] = list[i]['endTime'].split(' ');
        let [, month, day] = datePart.split('-');
        let [hour, minute] = timePart.split(':');
        list[i]['endMonthDayTime'] = `${month}-${day} ${hour}:${minute}`;
      }
      

      // 探店日场次卡:同日场次压成「MM-DD HH:mm–HH:mm」,跨日保留两端全量
      if (list[i]['monthDayTime'] && list[i]['endMonthDayTime']) {
        const sd = list[i]['monthDayTime'].slice(0, 5), ed = list[i]['endMonthDayTime'].slice(0, 5);
        list[i]['sessionTimeText'] = sd === ed
          ? (list[i]['monthDayTime'] + '–' + list[i]['endMonthDayTime'].slice(6))
          : (list[i]['monthDayTime'] + ' ~ ' + list[i]['endMonthDayTime']);
      } else {
        list[i]['sessionTimeText'] = list[i]['monthDayTime'] || '';
      }
      // 场次余席属于 activity ticket；期级权益容量另行显示，不能把同一个数印到每张卡。
      const rawRemaining = list[i]['remainingInventory'];
      const remaining = rawRemaining === null || rawRemaining === undefined || rawRemaining === ''
        ? NaN : Number(rawRemaining);
      list[i]['remaining'] = Number.isFinite(remaining)
        ? Math.max(0, remaining)
        : null;
    }
    return list;
  },

  formatPerkCapacity(value) {
    if (value === null || value === undefined || value === '') return '';
    const capacity = Number(value);
    if (!Number.isFinite(capacity) || capacity >= 2147483647) return '';
    return '本期可售 ' + Math.max(0, capacity) + ' 张';
  },
  
  /**
   * 判断整个活动是否有商家
   */
  
  /**
   * 判断章节下是否有商家
   */
  processChaptersList(chaptersList) {
    if (!chaptersList || !Array.isArray(chaptersList)) return chaptersList;

    for (let j = 0; j < chaptersList.length; j++) {
      const chapter = chaptersList[j];
      // 稿 181:715:章节标题下面这行说的是**这一章**的时长 / 地点数 / 玩法数。
      // 原来读的是 info.*(整个主题的合计),挨着章节标题印,看上去就像这一章的 ——
      // 三章会印出三组一模一样的数,零报错。字段在 CmsTopicChapter 上本来就有。
      // 拿不到的那一项不写,不补 0(补 0 会说成「这章 0 个地点」)。
      chaptersList[j].metaTime = chapter.totalTime ? this.formatTimeToChinese(chapter.totalTime) : '';
      // 单位跟着数一起在这里拼:wxml 里「{{x}} 个节点」这种插值紧跟单位的写法,
      // 值缺了会变成孤零零一个「个节点」(有门禁专门拦)。
      // CU-C-66:章节级同一个快照毛病 —— 按本章真实节点数列,不读 location_count
      const nodeCount = (chapter.nodes || []).length || Number(chapter.locationCount) || 0;
      chaptersList[j].metaPlace = nodeCount > 0 ? nodeCount + ' 个节点' : '';
      chaptersList[j].metaPlay = Number(chapter.templateCount) > 0 ? chapter.templateCount + ' 个玩法' : '';
      chaptersList[j].hasMeta = !!(chaptersList[j].metaTime || chaptersList[j].metaPlace || chaptersList[j].metaPlay);
      // 稿 214:689:站与站之间写「N min 步行」。第一站没有上一站,自然不画。
      const ns = chapter.nodes || [];
      for (let n = 0; n < ns.length; n++) {
        // CU-C-65:站点这一层的裸字段全部归一,别把 null 渲染给玩家
        ns[n].businessTime = nodeText(ns[n].businessTime);
        ns[n].address = nodeText(ns[n].address);
        ns[n].name = nodeText(ns[n].name);
        const firstMerchant = (ns[n].registrationMerchantList || [])[0];
        if (firstMerchant && firstMerchant.mmsMerchant) {
          firstMerchant.mmsMerchant.name = nodeText(firstMerchant.mmsMerchant.name);
        }
        ns[n].walkText = n === 0 ? '' : walkText(ns[n - 1], ns[n]);
      }
    }
    for (let j = 0; j < chaptersList.length; j++) {
      for (let i = 0; i < chaptersList[j]['nodes'].length; i++) {
        if (chaptersList[j]['nodes'][i]['registrationMerchantList']) {
          for (let z = 0; z < chaptersList[j]['nodes'][i]['registrationMerchantList'].length; z++) {
            if (chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['startDate']) {
              let [year, month, day] = chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['startDate'].split('-');
              chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['month'] = month;
              chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['day'] = day;
            }
            if (chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['endDate']) {
              let [year, month, day] = chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['endDate'].split('-');
              chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['endmonth'] = month;
              chaptersList[j]['nodes'][i]['registrationMerchantList'][z]['endday'] = day;
            }

          }
        }

      }
    }

    return chaptersList;
  },

  // 修改展开/收起函数，支持独立控制每个票务

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    /* CU-C-38:标题原来写死成泛化的「主题详情」——接收人从卡片上看不出分享的是哪场活动。
       主题名这一屏手上就有(与 :138 那处 {{info.name}} 同一份),没有才退回泛化文案。
       卡片图同样从这一屏的封面取:走 utils/topic-share 与俱乐部「带票分享」共用一份口径,
       取不到封面就不传 imageUrl(微信自己的默认卡片图),不拿占位图冒充。 */
    const info = this.data.info || {};
    return buildTopicShare({
      topicId: this.data.id,
      name: info.name,
      cover: resolveTopicCover(info, (path) => app.getImgUrl(path)),
    });
  }
})
