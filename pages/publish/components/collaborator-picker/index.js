// cy-collaborator-picker · 半屏选择器(类型 A),给发布表单页选合作者用。
// 取代已退役独立页原来的"伸手拿上一页实例调 updateCollaborator"回传方式——
// 那套只要页面栈中间多一层,pages.length-2 就不是发起页了,updateCollaborator 静默不存在
// (有 && 兜底 = 不报错),用户选了合作者但界面毫无反应。改成组件后回传走 triggerEvent('select'),
// 不再依赖页面栈层数,发起页在哪一层都收得到。
//
// 选择器语义:点"邀请"即选中即回传即关闭，不需要"确定"按钮，也不需要 dirty——
// 这不是表单，点遮罩关掉不丢任何用户输入。
const app = getApp();
const { isRecordList } = require('../../../../utils/response-shape.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    // 已选 ID,沿用逗号分隔字符串契约
    ids: { type: String, value: '' },
  },
  data: {
    list: [],
    page_no: 1,
    hasMore: false,
    nodata: false,
    loading: true,
    loadError: '',
    loadErrorPage: 0,
    searchKeyword: '',
  },
  observers: {
    show(v) {
      // 每次打开都是一次新的选择,重置到第一页——避免上次滚动位置/过滤态串到这次
      if (v) {
        this.setData({
          list: [], page_no: 1, hasMore: false, nodata: false,
          loading: true, loadError: '', loadErrorPage: 0, searchKeyword: '',
        });
        this._getList(1);
      }
    },
  },
  methods: {
    onSearchInput(e) {
      // 既有选择器这里只存值、没有真正接入过滤逻辑,原样保留(不在本次范围内新修)
      this.setData({ searchKeyword: e.detail.value });
    },

    onReachBottom() {
      if (this.data.hasMore && !this.data.loading && !this.data.loadError) {
        this._getList(this.data.page_no + 1);
      }
    },

    onRetry() {
      const retryPage = this.data.loadErrorPage || 1;
      this.setData({ loadError: '', loading: true });
      this._getList(retryPage);
    },

    // 点"邀请":选中即回传即关闭。show 由父页面拥有,这里只发事件,父页面决定何时关。
    selectMember(e) {
      const item = e.currentTarget.dataset.item;
      if (!item || item.isDisabled || item.id == null) return;
      this.triggerEvent('select', { item });
    },

    // cy-sheet 默认 dirty=false(选择器不需要 dirty,点遮罩/✕ 都直接发 close)
    onClose() { this.triggerEvent('close'); },

    _getList(pageNo) {
      const requestedPage = pageNo || this.data.page_no;
      const isFirstPage = requestedPage === 1;
      this.setData({ loading: true, loadError: '' });
      app.sendRequest({
        hideLoading: true,
        url: '/api/user/list',
        method: 'POST',
        data: {
          pageNum: requestedPage,
          pageSize: app.getPageSize(),
        },
        success: (res) => {
          if (res.code != '200') {
            this.setData({
              loadError: app.getRequestErrorMessage(res, '服务返回异常，重试会重新拉取一次'),
              loadErrorPage: requestedPage,
            });
            return;
          }
          if (!res.data || !isRecordList(res.data.rows)) {
            this.setData({
              loadError: '服务返回的数据不完整，重试会重新拉取一次',
              loadErrorPage: requestedPage,
            });
            return;
          }
          const idsArray = this.data.ids ? this.data.ids.split(',') : [];
          const processedList = res.data.rows.map((item) => {
            const itemId = item.id != null ? String(item.id) : '';
            const isSelected = !!itemId && idsArray.includes(itemId);
            return {
              ...item,
              displayName: String(item.nickname || '').trim() || '未命名用户',
              followText: item.followNum != null && item.followNum !== '' ? item.followNum : 0,
              isSelected,
              isDisabled: isSelected || !itemId,
            };
          });
          this.setData({
            list: isFirstPage ? processedList : this.data.list.concat(processedList),
            page_no: requestedPage,
            hasMore: app.getTotalPage(res.data.total, app.getPageSize()) > requestedPage,
            loadErrorPage: 0,
          });
        },
        fail: () => {
          this.setData({
            loadError: '网络异常，请重试',
            loadErrorPage: requestedPage,
          });
        },
        complete: () => {
          this.setData({
            loading: false,
            nodata: !this.data.loadError && this.data.list.length < 1,
          });
        },
      });
    },
  },
});
