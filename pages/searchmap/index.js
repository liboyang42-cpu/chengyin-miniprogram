const modal = require('../../utils/modal.js');
const toast = require('../../utils/toast.js');
const app = getApp();
const { resolveMenuChrome } = require('../../utils/nav-safe-area.js');
const discoverSearch = require('../../utils/discover-search.js');
const { openScene } = require('../../utils/scene-entry.js');
const { buildNodeLevelMarkerStyle } = require('../roam/node-level-style.js');
const { isRecordList } = require('../../utils/response-shape.js');
const DATE_YEARS = Array.from({ length: 81 }, (_, index) => 1970 + index);
const DATE_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function dateDays(year, month) {
  return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1);
}

function isDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function pickerState(value) {
  const now = new Date();
  const source = isDateValue(value) ? value.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  const year = Math.min(2050, Math.max(1970, source[0]));
  const month = Math.min(12, Math.max(1, source[1]));
  const days = dateDays(year, month);
  const day = Math.min(days.length, Math.max(1, source[2]));
  return { days, value: [year - 1970, month - 1, day - 1] };
}

function formatPickerDate(yearIndex, monthIndex, dayIndex) {
  const year = DATE_YEARS[yearIndex];
  const month = DATE_MONTHS[monthIndex];
  const day = dayIndex + 1;
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function formatUpdatedAt(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return hours + ':' + minutes;
}

Page({
  data: {
    // 自定义导航(ADA:全屏地图只留浮动圆钮)。20 是状态栏兜底高,
    // globalData 取不到时至少不会把返回钮压进状态栏。
    statusBarHeight: 20,
    // UI-14 返修(2026-09-18):顶部整行(返回/搜索/筛选)的胶囊几何。onLoad 用实测值覆盖,
    // 这里的默认值只在拿不到胶囊坐标时兜底(与 resolveMenuChrome 的兜底同口径)。
    navTop: 28,    // 行顶(px):行中心线与胶囊中心线共线
    navRight: 16,  // 行右内边距(px):行右边界让开胶囊左缘一个页面边距

    // 搜索相关
    searchKeyword: '',
    
    // 地图相关数据
    latitude: 31.230416, // 上海坐标
    longitude: 121.473701,
    scale: 14,
    markers: [],
    activityMarkers: [],
    merchantMarkers: [],
    merchantNodes: [],
    merchantNodesRefreshing: false,
    merchantCategories: [],
    merchantCategoryLabel: '',
    merchantCategorySheetVisible: false,
    includePoints: [],
    
    // 活动列表
    list: [],
    bmShow: false,
    noCoordCount: 0, // 无坐标场次数(地图落不了点,仅结果列表可见)

    // 结果态(§11:Loading/Empty/Error 必须已设计;胶囊入口据此四态可达)
    listState: 'loading',   // loading | ready | empty | error
    capsuleText: '附近活动',
    errorMsg: '',
    pageError: '',
    pageErrorIsRefresh: false, // A-08:区分「刷新失败(旧结果仍在)」与「翻页失败」,文案不同
    listRefreshing: false,
    locationError: false,
    locationMessage: '',
    locationAction: '',
    // (设备定位与「用户拖过地图」两个事实只参与判定、不驱动渲染,按本仓 U4 口径存实例字段,
    // 不走 data —— 见 this._hasLocation / this._regionUserChosen)
    offline: false,
    offlineMessage: '当前离线，尚无可用的活动缓存',
    lastListUpdatedText: '',

    // 选中的标记对应对象(模板库 §4.4②:标记选中后底部 Sheet 展示对应对象)
    selShow: false,
    selected: {},

    // 筛选弹窗
    popVisible: false,
    startdate: '开始日期',
    enddate: '结束日期',
    dateSheetVisible: false,
    datePickerField: 'startdate',
    datePickerTitle: '选择开始日期',
    datePickerYears: DATE_YEARS,
    datePickerMonths: DATE_MONTHS,
    datePickerDays: dateDays(new Date().getFullYear(), new Date().getMonth() + 1),
    datePickerValue: [new Date().getFullYear() - 1970, new Date().getMonth(), new Date().getDate() - 1],
    jg1: "¥0",
    jg2: "¥1000",
    activeDate: '0',
    activeSort: '1',
    
    // 价格滑块
    minPrice: 0,
    maxPrice: 1000,
    minPercent: 0,
    maxPercent: 100,
    priceRange: {
      min: 0,
      max: 1000
    },
    sliderRangeStyle: 'left: 0%; right: 0%;',
    minHandleStyle: 'left: 0%;',
    maxHandleStyle: 'left: 100%;',
    
    // 筛选条件
    filterConditions: {
      keyword: '',
      categoryId: null,
      tag: '',
      cityRole: '',
      dateType: '0',
      startDate: '',
      endDate: '',
      minPrice: 0,
      maxPrice: 1000,
      sortType: '1'
    },
    
    // 地图区域信息
    regionInfo: {
      latitude: 31.230416,
      longitude: 121.473701,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1
    },
    
    // 分页
    pageNum: 1,
    pageSize: 10,
    hasMore: true,
    loadingMore: false
  },

  // 关键词输入
  onKeywordInput(e) {
    const keyword = e.detail.value;
    this.setData({
      searchKeyword: keyword,
      'filterConditions.keyword': keyword
    });
  },

  // 输入框确认搜索
  onSearchConfirm() {
    this.performSearch();
  },

  // 执行搜索
  performSearch() {
    this.runFreshQuery();
  },

  // 查询条件或空间范围变化时，旧点位不再代表当前结果；先原子清场，再拉两层新数据。
  // 网络恢复等同查询刷新走 refreshMapResults，仍保留旧内容并明示 syncing。
  runFreshQuery(extra) {
    // setData 的 callback 要等视图层确认后才执行；必须在清场调用前同步作废旧请求，
    // 否则旧回包能钻进「数据已清空、新请求尚未启动」的窗口，把上一查询重新写回来。
    this._listQueryEpoch = (this._listQueryEpoch || 0) + 1;
    this._merchantQueryEpoch = (this._merchantQueryEpoch || 0) + 1;
    const next = extra || {};
    const filterConditions = Object.prototype.hasOwnProperty.call(next, 'filterConditions')
      ? next.filterConditions
      : Object.assign({}, this.data.filterConditions, Object.prototype.hasOwnProperty.call(next, 'filterConditions.keyword')
        ? { keyword: next['filterConditions.keyword'] }
        : {});
    this.setData({
      pageNum: 1,
      list: [],
      activityMarkers: [],
      merchantNodes: [],
      merchantMarkers: [],
      selected: {},
      selShow: false,
      hasMore: true,
      regionInfo: Object.prototype.hasOwnProperty.call(next, 'regionInfo') ? next.regionInfo : this.data.regionInfo,
      popVisible: Object.prototype.hasOwnProperty.call(next, 'popVisible') ? next.popVisible : this.data.popVisible,
      filterConditions,
    }, () => {
      this.rebuildMarkers();
      this.getList();
      this.getMerchantNodes();
    });
  },

  // 获取活动列表
  getList: function () {
    if (!this.data.hasMore && this.data.pageNum > 1) return;

    var that = this;
    const requestPage = this.data.pageNum;
    if (requestPage > 1 && (this._listFirstPageLoading || this._listPageLoading)) return;
    const hasCachedList = requestPage === 1 && (this.data.list || []).length > 0;
    const requestPageSize = this.data.pageSize;
    const requestRegion = Object.assign({}, this.data.regionInfo);
    const requestFilters = Object.assign({}, this.data.filterConditions);
    if (requestPage === 1) {
      this._listFirstPageLoading = true;
      this._listPageLoading = false;
      this.setData({ loadingMore: false });
      this._listQueryEpoch = (this._listQueryEpoch || 0) + 1;
    } else if (!this._listQueryEpoch) {
      this._listQueryEpoch = 1;
    }
    if (requestPage > 1) {
      this._listPageLoading = true;
      this.setData({ loadingMore: true });
    }
    const queryEpoch = this._listQueryEpoch;
    const isCurrentQuery = function () { return queryEpoch === that._listQueryEpoch; };
    const finishPageRequest = function () {
      if (!isCurrentQuery()) return;
      if (requestPage === 1) {
        that._listFirstPageLoading = false;
        that.setData({ listRefreshing: false });
      } else {
        that._listPageLoading = false;
        that.setData({ loadingMore: false });
      }
    };
    const { latitude, longitude } = requestRegion;
    if (requestPage === 1 && hasCachedList) {
      this.setData({
        listState: 'ready',
        capsuleText: '查看全部 ' + this.data.list.length + ' 个结果',
        errorMsg: '',
        pageError: '',
        listRefreshing: true
      });
    } else if (requestPage === 1) {
      this.setData({ listRefreshing: false, pageError: '' });
      this.setListState('loading');
    } else {
      this.setData({ pageError: '' });
    }

    app.sendRequest({
      hideLoading: true,
      url: '/api/activity/list',
      method: "POST",
      auth: false,
      silentError: true, // 失败已落页内错误态/内联重试(A-08),关掉通道自动 toast 防双弹
      data: {
        is_my: 0,
        sort_type: requestFilters.sortType,
        pageNum: requestPage,
        pageSize: requestPageSize,
        longitude: longitude || that.data.longitude,
        latitude: latitude || that.data.latitude,
        keyword: requestFilters.keyword,
        // ⚠️ 别传 null:wx.request 会把 null 序列化成字面量 "null",后端 DiscoveryFilterContract
        // 解析不出正整数 → 400「category_id 必须为正整数」→ 整页「没能加载出来」(2026-09-16 截图冒烟)。
        category_id: requestFilters.categoryId == null ? '' : requestFilters.categoryId
        // A-02:min_price/max_price/date_type/start_date/end_date 后端 activityList 签名里没有,
        // 发过去只会被静默忽略 —— 死参数已删,筛选改在客户端同口径过滤(见 success 回调)。
      },
      success: function (res) {
        if (!isCurrentQuery()) return;
        finishPageRequest();
        if (!res || res.code != "200") {
          // 非 200 原先直接穿透 = 静默失败:页面只剩一张空地图,不说明也不能重试。
          // 仅首页失败才翻错误态 —— 翻页失败不该把已加载的结果整段换掉(与 loading 守卫对称)。
          that.setPageError((res && res.msg) || '服务返回异常', requestPage);
          return;
        }
        if (!res.data || !isRecordList(res.data.rows)) {
          that.setPageError('活动列表没加载出来，请重试', requestPage);
          return;
        }
        const rawList = res.data.rows.map(function (activity) {
          const pointKind = discoverSearch.mapPointKind(activity);
          return Object.assign({}, activity, {
            mapPointKind: pointKind,
            mapPointLabel: pointKind === 'topic' ? '主题点位' : '活动点位'
          });
        });
        // A-02:日期/价格筛选后端不消费,这里用 search2/result 同一套 matchesFilters 客户端过滤,
        // 口径(起始日期落在区间、价格字段兜底)完全复用,不再各写一套。
        const newList = discoverSearch.filterRows('activity', rawList, requestFilters);
        const totalList = requestPage === 1 ? newList : that.data.list.concat(newList);

        that.setData({
          list: totalList,
          // 分页判据用未过滤的原始行数:整页被筛掉时仍要能继续翻,否则「筛空一页」会被当成到底
          hasMore: rawList.length >= requestPageSize,
          noCoordCount: totalList.filter(a => !a.latitude || !a.longitude).length,
          pageError: '',
          pageErrorIsRefresh: false,
          lastListUpdatedText: formatUpdatedAt(new Date())
        });
        that.setListState(totalList.length ? 'ready' : 'empty');

        // 更新地图标记
        that.createMarkersFromActivities(totalList);
      },
      fail: function (err) {
        if (!isCurrentQuery()) return;
        finishPageRequest();
        // 原先是空函数 —— 请求失败被整个吞掉,用户看不到任何反馈
        that.setPageError((err && err.errMsg) || '网络开了点小差', requestPage);
      }
    });
  },

  // 结果态单一出口:胶囊文案随态走,保证地图之外始终有一条可见、可恢复的通路(模板库 §4.4③)
  setListState(state, msg) {
    const text = {
      loading: '附近活动',
      error: '没能加载出来，点这里重试',
      empty: '这一带还没有活动',
      ready: '查看全部 ' + this.data.list.length + ' 个结果'
    }[state];
    this.setData({ listState: state, capsuleText: text, errorMsg: msg || '' });
  },

  // 失败落点:首页失败 ⇒ 整页错误态;翻页失败 ⇒ 保住已加载结果,只提示一次,不清列表;
  // 首页刷新失败但已有旧列表 ⇒ 保住旧结果 + 页内错误条,可原地重试(A-08:不再无声降级,
  // 否则用户以为屏上就是新区域/新筛选的结果)。
  setPageError(msg, pageNum) {
    const failedPage = pageNum == null ? this.data.pageNum : pageNum;
    if (failedPage === 1 && (this.data.list || []).length) {
      this.setData({
        listState: 'ready',
        pageError: msg || '刷新失败，请重试',
        pageErrorIsRefresh: true,
      });
      return;
    }
    if (failedPage === 1) { this.setData({ pageErrorIsRefresh: false }); this.setListState('error', msg); return; }
    this.setData({
      listState: 'ready',
      pageError: msg || '没能加载更多，请重试',
      pageErrorIsRefresh: false,
    });
  },

  retryListPage() {
    if (!this.data.pageError) return;
    this.setData({ pageError: '' });
    this.getList();
  },

  // 胶囊/错误态重试
  onRetry() {
    this.setData({ pageNum: 1, list: [], hasMore: true });
    this.getList();
  },

  // 地图空白处点击:不再误弹"全部活动"列表(降级,避免误导);仅收起已开弹窗
  onMapTap(e) {
    if (this.data.bmShow) this.setData({ bmShow: false });
    if (this.data.selShow) this.setData({ selShow: false });
  },

  // 标记点点击事件
  onMarkerTap(e) {
    const markerId = e.markerId;
    const marker = this.data.markers.find(m => m.id === markerId);
    
    if (marker) {
      if (marker.kind === 'merchant') {
        // 据点走场景注册表,别再自己拼路由:宿主换了地方时这里必须跟着换。
        openScene('roam-poi-detail', { poiId: marker.poiId });
        return;
      }
      this.showActivityDetail(marker.activityId);
    }
  },

  // 区域变化事件
  onRegionChange(e) {
    if (e.type === 'end') {
      const spatialEpoch = this._beginSpatialInput();
      // 获取地图当前区域
      this.mapContext.getRegion({
        success: (res) => {
          if (!this._isCurrentSpatialInput(spatialEpoch)) return;
          const regionInfo = {
            latitude: (res.northLatitude + res.southLatitude) / 2,
            longitude: (res.eastLongitude + res.westLongitude) / 2,
            latitudeDelta: res.northLatitude - res.southLatitude,
            longitudeDelta: res.eastLongitude - res.westLongitude
          };
          // 用户自己拖过地图 = 有了真实可见范围,这时查「附近据点」是对着屏幕里那块地查,不需要设备定位。
          this._regionUserChosen = true;
          this.runFreshQuery({ regionInfo });
        }
      });
    }
  },

  requestLocation() {
    const spatialEpoch = this._beginSpatialInput();
    modal.show({
      title: '定位说明',
      content: '用于将地图移到你附近的活动、主题点位与商家节点，并按距离排列结果，仅在本次操作中读取一次位置。',
      confirmText: '继续定位',
      success: (result) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        if (result.confirm) this.moveToLocation();
      }
    });
  },

  _beginSpatialInput() {
    this._spatialInputEpoch = (this._spatialInputEpoch || 0) + 1;
    return this._spatialInputEpoch;
  },

  _isCurrentSpatialInput(spatialEpoch) {
    return !this._unloaded && spatialEpoch === this._spatialInputEpoch;
  },

  // 移动到当前位置
  moveToLocation() {
    const spatialEpoch = this._beginSpatialInput();
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        const { latitude, longitude } = res;
        this._hasLocation = true;
        this.setData({
          latitude,
          longitude,
          scale: 16,
          locationError: false,
          locationMessage: '',
          locationAction: '',
          'regionInfo.latitude': latitude,
          'regionInfo.longitude': longitude
        });
        
        // 添加当前位置标记
        this.addCurrentLocationMarker(latitude, longitude, false);
        this.runFreshQuery();
      },
      fail: (err) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        const rawMessage = String((err && err.errMsg) || '');
        const denied = /auth deny|authorize|permission/i.test(rawMessage);
        this.setData({
          locationError: true,
          locationAction: denied ? 'open-setting' : 'retry',
          locationMessage: denied ? '定位权限未开启' : '暂时无法获取当前位置，请重试'
        });
      }
    });
  },

  recoverLocation() {
    if (this.data.locationAction !== 'open-setting') {
      this.moveToLocation();
      return;
    }
    const spatialEpoch = this._beginSpatialInput();
    wx.openSetting({
      success: (result) => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        if (result.authSetting && result.authSetting['scope.userLocation']) {
          this.setData({ locationError: false, locationMessage: '', locationAction: '' });
          this.moveToLocation();
        } else {
          this.setData({ locationMessage: '仍未获得定位权限，可在系统设置中开启后重试' });
        }
      },
      fail: () => {
        if (!this._isCurrentSpatialInput(spatialEpoch)) return;
        this.setData({ locationMessage: '暂时无法打开设置，请稍后重试' });
      }
    });
  },

  // 添加当前位置标记
  addCurrentLocationMarker(latitude, longitude, shouldRebuild = true) {
    const currentMarker = {
      id: 0,
      latitude,
      longitude,
      iconPath: '/pages/searchmap/images/d_location.png',
      width: 30,
      height: 30,
      zIndex: 999
    };
    
    this._currentLocationMarker = currentMarker;
    if (shouldRebuild) this.rebuildMarkers();
  },

  // 根据活动数据创建标记点(无真实坐标的活动不落假点;activityId 保留为原列表下标)
  createMarkersFromActivities(activities) {
    const markers = [];
    activities.forEach((activity, index) => {
      if (!activity.latitude || !activity.longitude) return; // 无坐标不伪造随机点
      markers.push({
        id: index + 1,
        latitude: activity.latitude,
        longitude: activity.longitude,
        title: activity.name,
        iconPath: activity.mapPointKind === 'topic'
          ? '/pages/searchmap/images/d_smapicon.png'
          : this.getMarkerIconByCategory(activity.categoryName),
        width: 30,
        height: 30,
        callout: {
          content: activity.name + (activity.mapPointKind === 'topic' ? ' · 主题点位' : ''),
          color: '#333',
          fontSize: 12,
          borderRadius: 4,
          bgColor: '#fff',
          padding: 8,
          display: 'ALWAYS'
        },
        activityId: index,
        kind: 'activity'
      });
    });
    this.setData({ activityMarkers: markers }, () => this.rebuildMarkers());
  },

  // 商家节点图层与活动点分开请求/建 marker。接口按 roam_poi.tags 等条件筛选并按距离排序。
  getMerchantNodes() {
    const that = this;
    // 无定位、也还没拖过地图时不该问「附近据点」:后端缺 lat/lng 只会 500「缺少定位」,
    // 页面再把它渲染成「商家点位暂未取回」= 把缺权限说成网络故障(2026-09-16 截图冒烟)。
    if (!this._hasLocation && !this._regionUserChosen) {
      // UI-14:图例提示胶囊已删,这里只负责「不发请求」;缺定位不是网络错误,也不再有错误态可写。
      this.setData({ merchantNodesRefreshing: false });
      return;
    }
    const center = Object.assign({}, this.data.regionInfo || {});
    const filters = Object.assign({}, this.data.filterConditions || {});
    const hasCachedNodes = (this.data.merchantNodes || []).length > 0;
    const queryEpoch = (this._merchantQueryEpoch || 0) + 1;
    this._merchantQueryEpoch = queryEpoch;
    const isCurrentQuery = function () { return queryEpoch === that._merchantQueryEpoch; };
    // UI-14:商家点位刷新失败维持「静默降级」,只收圈——图例错误提示随胶囊一起删掉,
    // 不再保留只写不读的 merchantNodeError 死状态。
    const markError = function () {
      if (!isCurrentQuery()) return;
      that.setData({ merchantNodesRefreshing: false });
    };
    this.setData({ merchantNodesRefreshing: hasCachedNodes });
    app.sendRequest({
      hideLoading: true,
      url: '/api/city/nodes',
      method: 'GET',
      // SecurityConfig 未匿名放行 city/nodes，使用 request-client 默认认证。
      data: {
        lat: center.latitude || this.data.latitude,
        lng: center.longitude || this.data.longitude,
        radius: 20000,
        keyword: filters.keyword || '',
        categoryId: filters.categoryId == null ? '' : filters.categoryId,
        tag: filters.tag || '',
        cityRole: filters.cityRole || ''
      },
      success(res) {
        if (!isCurrentQuery()) return;
        if (!res || (res.code != '200' && res.code != 200) || !Array.isArray(res.data)) {
          markError();
          return;
        }
        const nodes = res.data;
        const markers = nodes.filter(n => n.lat && n.lng).map((node) => {
          const nodeStyle = buildNodeLevelMarkerStyle(node.nodeLevel, 'actionable');
          return {
            id: 1000000 + Number(node.poiId),
            latitude: Number(node.lat),
            longitude: Number(node.lng),
            title: node.name || node.merchantName || '商家节点',
            iconPath: '/pages/searchmap/images/icon_map6.png',
            width: nodeStyle.size,
            height: nodeStyle.size,
            zIndex: nodeStyle.zIndex,
            kind: 'merchant',
            poiId: node.poiId,
            callout: {
              content: nodeStyle.glyph + ' ' + nodeStyle.label + ' · '
                + (node.name || node.merchantName || '商家节点'),
              display: 'ALWAYS'
            }
          };
        });
        that.setData({
          merchantNodes: nodes,
          merchantMarkers: markers,
          merchantNodesRefreshing: false
        }, () => that.rebuildMarkers());
      },
      fail: markError
    });
  },

  rebuildMarkers() {
    const markers = [];
    if (this._currentLocationMarker) markers.push(this._currentLocationMarker);
    markers.push(...(this.data.activityMarkers || []), ...(this.data.merchantMarkers || []));
    this.setData({ markers });
  },

  // 根据活动分类获取标记图标
  getMarkerIconByCategory(category) {
    const iconMap = {
      '主题': '/pages/searchmap/images/d_smapicon.png',
      '城市旅团': '/pages/searchmap/images/d_smapicon.png',
      // 添加更多分类图标映射
    };
    return iconMap[category] || '/images/d_location2.png';
  },

  openMerchantCategorySheet() {
    this.setData({ merchantCategorySheetVisible: true });
  },

  closeMerchantCategorySheet() {
    this.setData({ merchantCategorySheetVisible: false });
  },

  onMerchantCategoryChange(e) {
    const detail = e.detail || {};
    const fromCategorySheet = Array.isArray(detail.selectedCategories);
    const category = fromCategorySheet ? detail.selectedCategories[0] : this.data.merchantCategories[Number(detail.value)];
    if (fromCategorySheet && !category) {
      this.setData({
        'filterConditions.categoryId': null,
        merchantCategoryLabel: '',
        merchantCategorySheetVisible: false,
      });
      return;
    }
    if (!category || category.id == null) return;
    this.setData({
      'filterConditions.categoryId': Number(category.id),
      merchantCategoryLabel: category.categoryName || '',
      merchantCategorySheetVisible: false,
    });
  },

  onMerchantTagInput(e) {
    this.setData({ 'filterConditions.tag': e.detail.value || '' });
  },

  onMerchantRoleInput(e) {
    this.setData({ 'filterConditions.cityRole': e.detail.value || '' });
  },

  // 点 marker 弹出该场次的 Sheet(模板库 §4.4②)。
  // 前一轮已修掉"点哪个点都弹全部场次"的坏交互,但改成了直接 navigateTo 详情 —— 跳过了 Sheet 这一层,
  // 用户失去"看一眼再决定"的机会;现按 §4.4 补回:Sheet 展示被选对象,详情由 Sheet 内 CTA 进。
  showActivityDetail(activityId) {
    const activity = this.data.list[activityId];
    if (activity && activity.id) {
      this.setData({ selected: activity, selShow: true, bmShow: false });
    }
  },

  // 关闭选中对象 Sheet
  selClose() {
    this.setData({ selShow: false });
  },

  // 切换收藏状态
  toggleFavorite(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.list.map(item => {
      if (item.id === id) {
        return {
          ...item,
          isFavorite: !item.isFavorite
        };
      }
      return item;
    });
    
    this.setData({ list });
  },

  // 显示筛选弹窗
  popShow() {
    this.setData({
      popVisible: true
    });
  },

  // 关闭筛选弹窗
  popClose() {
    this.setData({
      popVisible: false
    });
  },

  // 筛选搜索
  searchFilter() {
    // 更新筛选条件
    const filterConditions = {
      ...this.data.filterConditions,
      dateType: this.data.activeDate,
      sortType: this.data.activeSort,
      minPrice: this.data.minPrice,
      maxPrice: this.data.maxPrice
    };

    // A-02:日期筛选改由客户端消费,必须带真实边界 —— 原实现只给「自定义」写 startDate/endDate,
    // 今天/明天只发 date_type(后端不消费,筛了等于没筛)。口径与 search2/result 的 isYmd 一致。
    const isYmd = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    filterConditions.startDate = isYmd(this.data.startdate) ? this.data.startdate : '';
    filterConditions.endDate = isYmd(this.data.enddate) ? this.data.enddate : '';

    this.runFreshQuery({
      popVisible: false,
      filterConditions: filterConditions,
    });
  },

  // 选择日期
  selectDate(e) {
    const value = e.currentTarget.dataset.value;
    const now = new Date();
    let startDate = '';
    let endDate = '';

    switch(value) {
      case '1': // 今天
        startDate = this.formatDate(now);
        endDate = startDate;
        break;
      case '2': // 明天
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        startDate = this.formatDate(tomorrow);
        endDate = startDate;
        break;
      case '3': // 选择日期
        startDate = '开始日期';
        endDate = '结束日期';
        break;
      default:
        startDate = '开始日期';
        endDate = '结束日期';
    }

    this.setData({
      activeDate: value,
      startdate: startDate,
      enddate: endDate
    });
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 选择排序
  selectSort(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({
      activeSort: value
    });
  },

  // 最低价格输入
  onMinPriceInput(e) {
    let value = e.detail.value.replace(/[^\d]/g, '');
    const numValue = parseInt(value) || this.data.priceRange.min;

    if (numValue >= this.data.maxPrice) {
      toast('最低价格不能大于等于最高价格');
      return;
    }

    if (numValue < this.data.priceRange.min) {
      value = this.data.priceRange.min.toString();
    }

    const percent = ((numValue - this.data.priceRange.min) / (this.data.priceRange.max - this.data.priceRange.min)) * 100;

    this.setData({
      jg1: '¥' + value,
      minPrice: numValue,
      minPercent: percent
    }, () => {
      this.calculateSliderStyles();
    });
  },

  // 最高价格输入
  onMaxPriceInput(e) {
    let value = e.detail.value.replace(/[^\d]/g, '');
    const numValue = parseInt(value) || this.data.priceRange.min;

    if (numValue <= this.data.minPrice) {
      toast('最高价格不能小于等于最低价格');
      return;
    }

    if (numValue > this.data.priceRange.max) {
      value = this.data.priceRange.max.toString();
    }

    const percent = ((numValue - this.data.priceRange.min) / (this.data.priceRange.max - this.data.priceRange.min)) * 100;

    this.setData({
      jg2: '¥' + value,
      maxPrice: numValue,
      maxPercent: percent
    }, () => {
      this.calculateSliderStyles();
    });
  },

  // 最低价滑块拖动
  onMinSliderMove(e) {
    this.handleSliderMove(e, 'min');
  },

  // 最高价滑块拖动
  onMaxSliderMove(e) {
    this.handleSliderMove(e, 'max');
  },

  // 处理滑块拖动
  handleSliderMove(e, type) {
    const query = wx.createSelectorQuery();
    query.select('.slider-container').boundingClientRect();
    query.exec((res) => {
      if (res[0]) {
        const containerWidth = res[0].width;
        const containerLeft = res[0].left;
        const touchX = e.touches[0].clientX;

        let percent = ((touchX - containerLeft) / containerWidth) * 100;
        percent = Math.max(0, Math.min(100, percent));

        // 设置最小间隔
        const minInterval = 5;

        if (type === 'min') {
          if (percent >= this.data.maxPercent - minInterval) {
            percent = this.data.maxPercent - minInterval;
          }
          const price = Math.round((percent / 100) * (this.data.priceRange.max - this.data.priceRange.min) + this.data.priceRange.min);
          this.setData({
            minPercent: percent,
            minPrice: price,
            jg1: '¥' + price
          });
        } else {
          if (percent <= this.data.minPercent + minInterval) {
            percent = this.data.minPercent + minInterval;
          }
          const price = Math.round((percent / 100) * (this.data.priceRange.max - this.data.priceRange.min) + this.data.priceRange.min);
          this.setData({
            maxPercent: percent,
            maxPrice: price,
            jg2: '¥' + price
          });
        }

        this.calculateSliderStyles();
      }
    });
  },

  openDatePicker(e) {
    const field = e.currentTarget.dataset.field === 'enddate' ? 'enddate' : 'startdate';
    const current = isDateValue(this.data[field])
      ? this.data[field]
      : (field === 'enddate' && isDateValue(this.data.startdate) ? this.data.startdate : '');
    const state = pickerState(current);
    this.setData({
      dateSheetVisible: true,
      datePickerField: field,
      datePickerTitle: field === 'enddate' ? '选择结束日期' : '选择开始日期',
      datePickerDays: state.days,
      datePickerValue: state.value,
    });
  },

  onDatePickerChange(e) {
    const value = e.detail.value || [0, 0, 0];
    const year = DATE_YEARS[value[0]] || 1970;
    const month = DATE_MONTHS[value[1]] || 1;
    const days = dateDays(year, month);
    const next = [value[0], value[1], Math.min(value[2], days.length - 1)];
    this.setData({ datePickerDays: days, datePickerValue: next });
  },

  cancelDatePicker() {
    this.setData({ dateSheetVisible: false });
  },

  confirmDatePicker() {
    const value = this.data.datePickerValue;
    const selected = formatPickerDate(value[0], value[1], value[2]);
    const field = this.data.datePickerField;
    if (field === 'startdate' && isDateValue(this.data.enddate) && selected > this.data.enddate) {
      toast('开始日期不能晚于结束日期');
      return;
    }
    if (field === 'enddate' && isDateValue(this.data.startdate) && selected < this.data.startdate) {
      toast('结束日期不能早于开始日期');
      return;
    }

    this.setData({ [field]: selected, dateSheetVisible: false });
  },

  // 重置筛选条件
  resetFilter() {
    this.setData({
      activeDate: '0',
      activeSort: '1',
      startdate: '开始日期',
      enddate: '结束日期',
      jg1: '¥0',
      jg2: '¥1000',
      minPrice: 0,
      maxPrice: 1000,
      minPercent: 0,
      maxPercent: 100,
      merchantCategoryLabel: '',
      filterConditions: {
        ...this.data.filterConditions,
        dateType: '0',
        sortType: '1',
        minPrice: 0,
        maxPrice: 1000,
        categoryId: null,
        tag: '',
        cityRole: '',
        startDate: '',
        endDate: ''
      }
    }, () => {
      this.calculateSliderStyles();
    });
  },

  // 计算滑块样式
  calculateSliderStyles() {
    const { minPercent, maxPercent } = this.data;
    const sliderRangeStyle = `left: ${minPercent}%; right: ${100 - maxPercent}%;`;
    const minHandleStyle = `left: ${minPercent}%;`;
    const maxHandleStyle = `left: ${maxPercent}%;`;

    this.setData({
      sliderRangeStyle,
      minHandleStyle,
      maxHandleStyle,
    });
  },

  // 打开底部结果列表(无坐标场次唯一入口)
  // 结果入口:四态都要能开(原先 list.length>0 才开 ⇒ 空/错时页面只剩一张空地图,
  // 违反模板库 §4.4③"地图不可用时必须能切换列表")。error 态打开 Sheet，
  // 让活动与商家点位两层失败各自拥有明确、互不绑架的恢复动作。
  openList() {
    if (this.data.listState === 'loading') return;
    this.setData({ bmShow: true });
  },

  // 结果卡片点进活动详情
  goActivity(e) {
    const id = e.currentTarget.dataset.id;
    if (id) openScene('play-activity-detail', { id });
  },

  // 主题点位仅在活动真实关联 topicId 时提供入口，避免独立活动被误标。
  goTopic(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/topic/index/index?id=' + id });
  },

  // 底部弹窗
  bmClose() {
    this.setData({
      bmShow: false
    });
  },

  // 浮动返回钮:栈里有上一页就退,直达进入(分享/扫码)时回城市广场,不留死路。
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: function () { wx.switchTab({ url: '/pages/index/index' }); }
    });
  },

  applyNetworkState(isOffline) {
    const hasCachedList = (this.data.list || []).length > 0;
    this.setData({
      offline: Boolean(isOffline),
      offlineMessage: hasCachedList
        ? '当前离线，地图点位与活动列表来自上次加载'
        : '当前离线，尚无可用的活动缓存'
    });
  },

  setupNetworkState() {
    if (typeof wx.getNetworkType === 'function') {
      wx.getNetworkType({
        success: (result) => this.applyNetworkState(result.networkType === 'none')
      });
    }
    if (typeof wx.onNetworkStatusChange === 'function') {
      this._networkStatusHandler = (result) => {
        const wasOffline = this.data.offline;
        const isOffline = result.isConnected === false || result.networkType === 'none';
        this.applyNetworkState(isOffline);
        if (wasOffline && !isOffline) this.refreshMapResults();
      };
      wx.onNetworkStatusChange(this._networkStatusHandler);
    }
  },

  retryNetwork() {
    if (typeof wx.getNetworkType !== 'function') return;
    wx.getNetworkType({
      success: (result) => {
        if (result.networkType === 'none') {
          this.applyNetworkState(true);
          toast('仍未连接网络');
          return;
        }
        this.applyNetworkState(false);
        this.refreshMapResults();
      },
      fail: () => toast('暂时无法检查网络')
    });
  },

  refreshMapResults() {
    this.setData({ pageNum: 1, hasMore: true, pageError: '' });
    this.getList();
    this.getMerchantNodes();
  },
  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),
  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  /* UI-14 返修(2026-09-18):顶部整行几何按微信胶囊实测值算,不再写死 200rpx。
     ① 行中心线 = 胶囊中心线(返回/搜索/筛选三件共线,不再用 -12rpx 光学补偿互相对表);
     ② 行右边界 = 胶囊左缘 - --cy-page-x,与左缘的 --cy-page-x 对称,整行落进安全区;
     ③ 胶囊几何统一走 utils/nav-safe-area.js 的 resolveMenuChrome(拿不到坐标时用它的兜底),
        只有「行盒中心」这一项 resolver 没有(它只给 44px 目标的顶边),这里按胶囊自身 rect 算。 */
  readNavRow() {
    let win = { windowWidth: 375, statusBarHeight: 20 };
    let menuButton = null;
    let chrome = { actionTop: 28, actionRight: 12 };
    try {
      win = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const getMenu = wx.getMenuButtonBoundingClientRect || wx.getMenuButtonBoundingRect;
      menuButton = getMenu && getMenu.call(wx);
      chrome = resolveMenuChrome(win, menuButton);
    } catch (e) {
      win = { windowWidth: 375, statusBarHeight: 20 };
      menuButton = null;
      chrome = resolveMenuChrome(win, null);
    }
    const width = Number(win.windowWidth) || 375;
    const rpx = width / 750;
    const pageX = 32 * rpx;      // --cy-page-x(32rpx)的 px 当量
    const rowHeight = 88 * rpx;  // .smapso_bar 行高(88rpx)
    const hasCapsule = !!(menuButton
      && Number(menuButton.left) > 0
      && Number(menuButton.height) > 0
      && Number(menuButton.top) >= 0);
    if (!hasCapsule) {
      // 没有胶囊坐标:回到 resolver 的 actionTop,右侧退成普通页面边距(不再瞎让 200rpx)。
      return { navTop: chrome.actionTop, navRight: pageX };
    }
    const capsuleTop = Number(menuButton.top);
    const capsuleHeight = Number(menuButton.height);
    return {
      // 胶囊中心 = 行中心。返回(88rpx 命中盒)、搜索(72rpx)、筛选各自在行内居中即三件共线。
      navTop: capsuleTop + capsuleHeight / 2 - rowHeight / 2,
      // 行右边界 = 胶囊左缘 - 页面边距;filter 的右缘因此与左缘返回圆同一条内容线。
      navRight: width - Number(menuButton.left) + pageX,
    };
  },

  onLoad(options) {
    this._unloaded = false;
    // 初始化地图上下文
    this.mapContext = wx.createMapContext('myMap', this);

    const navRow = this.readNavRow();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      navTop: navRow.navTop,
      navRight: navRow.navRight,
    });
    this.setupNetworkState();


    // 从其他页面传递的参数
    if (options.params) {
      try {
        const params = JSON.parse(decodeURIComponent(options.params));
        this.setData({
          searchKeyword: params.keyword || '',
          filterConditions: Object.assign({}, this.data.filterConditions, {
            keyword: params.keyword || '',
            categoryId: params.categoryId || null,
            tag: params.tag || '',
            cityRole: params.cityRole || '',
            dateType: params.dateType || '0',
            startDate: params.startDate || '',
            endDate: params.endDate || '',
            minPrice: params.minPrice == null ? 0 : params.minPrice,
            maxPrice: params.maxPrice == null ? 1000 : params.maxPrice,
            sortType: params.sortType || '1'
          })
        });
      } catch (e) {
        console.error('解析参数失败');
      }
    }
    
    // 获取初始活动列表
    this.getList();
    this.getMerchantNodes();
  },

  onReady() {
    this.mapContext = wx.createMapContext('myMap', this);
  },

  onUnload() {
    this._unloaded = true;
    this._spatialInputEpoch = (this._spatialInputEpoch || 0) + 1;
    this._listQueryEpoch = (this._listQueryEpoch || 0) + 1;
    this._merchantQueryEpoch = (this._merchantQueryEpoch || 0) + 1;
    this._listFirstPageLoading = false;
    this._listPageLoading = false;
    if (this._networkStatusHandler && typeof wx.offNetworkStatusChange === 'function') {
      wx.offNetworkStatusChange(this._networkStatusHandler);
    }
  },

  loadMoreResults() {
    // A-RPT-7:pageErrorIsRefresh 的 pageError 是「刷新失败、旧结果还在」,它不是翻页失败,
    // 不能连翻页一起禁掉;只有翻页自己的错误(pageErrorIsRefresh=false)才拦住再翻。
    if (!this.data.hasMore || (this.data.pageError && !this.data.pageErrorIsRefresh)
        || this._listFirstPageLoading || this._listPageLoading) return;
    this.setData({ pageNum: this.data.pageNum + 1 });
    this.getList();
  },

  onReachBottom() {
    this.loadMoreResults();
  }
});
