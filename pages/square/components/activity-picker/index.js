// 选择「我已通关的活动」底部弹层(广场发布关联运动feed用)
const app = getApp();
const { isRecordList } = require('../../../../utils/response-shape.js');

Component({
  properties: {
    // 受控显示:由父页 setData 控制
    show: {
      type: Boolean,
      value: false,
      observer(v) {
        if (v && !this.data.loaded) this.fetchList();
      }
    }
  },

  data: {
    list: [],
    loading: false,
    loaded: false,
    errorMsg: '',
    // 生成路线预览图中
    generating: false,
    previewTopicId: ''
  },

  lifetimes: {
    detached() {
      clearTimeout(this._timer);
      if (this._fetchTask && typeof this._fetchTask.abort === 'function') this._fetchTask.abort();
      if (this._uploadControl) this._uploadControl.destroy();
      this._generation = (this._generation || 0) + 1;
      this._pending = null;
    }
  },

  methods: {
    // 拉「我已通关活动」列表
    fetchList() {
      if (this.data.loading) return;
      const that = this;
      that.setData({ loading: true, errorMsg: '' });
      this._fetchTask = app.sendRequest({
        url: '/api/play/my-completed',
        method: 'POST',
        hideLoading: true,
        data: {},
        success(res) {
          if (res && res.code == '200' && isRecordList(res.data)) {
            that.setData({ list: res.data, loaded: true, errorMsg: '' });
          } else {
            that.setData({ list: [], loaded: false, errorMsg: '活动列表加载失败，请重试' });
          }
        },
        fail() {
          that.setData({ list: [], loaded: false, errorMsg: '活动列表加载失败，请重试' });
        },
        complete() {
          that._fetchTask = null;
          that.setData({ loading: false });
        }
      });
    },

    onSelect(e) {
      const idx = e.currentTarget.dataset.index;
      const activity = this.data.list[idx];
      if (!activity) return;
      // 无主题→无路线,直接选中
      if (!activity.topicId) {
        this.emitSelect(activity, '');
        return;
      }
      // 渲染隐藏 route-map 生成静态路线预览图
      this._generation = (this._generation || 0) + 1;
      this._pending = activity;
      this.setData({ generating: true, previewTopicId: activity.topicId });
      // 超时兜底:4s 未出图则不带预览图直接选中(回退活动封面)
      this._timer = setTimeout(() => this.finish(''), 4000);
    },

    // route-map 数据就位→截图→上传OSS
    onRouteReady() {
      const that = this;
      const generation = this._generation;
      const pending = this._pending;
      const rm = this.selectComponent('#rmPreview');
      if (!rm || !rm.snapshotRoute) {
        this.finish('');
        return;
      }
      if (this._snapshotGeneration != null && this._snapshotGeneration === generation) return;
      this._snapshotGeneration = generation;
      rm.snapshotRoute().then(function (tmp) {
        if (!pending || that._pending !== pending || that._generation !== generation) return;
        that.uploadPreview(tmp);
      }).catch(function () {
        if (!pending || that._pending !== pending || that._generation !== generation) return;
        that.finish('');
      });
    },

    onRouteEmpty() {
      this.finish('');
    },

    uploadPreview(tmpPath) {
      const that = this;
      clearTimeout(this._timer);
      this._timer = null;
      this._uploadControl = app.getUploadClient().uploadAll([tmpPath], {
        concurrency: 1,
        perFileTimeoutMs: 8000,
        totalDeadlineMs: 10000,
        onDone(result) {
          that._uploadControl = null;
          that.finish(result.ok ? result.results[0] : '');
        }
      });
    },

    // 收尾:带(或不带)预览图选中,清状态。_pending 守卫防超时与成功回调双触发
    finish(routePreviewImg) {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      const activity = this._pending;
      this._pending = null;
      if (!activity) return;
      this.setData({ generating: false, previewTopicId: '' });
      this.emitSelect(activity, routePreviewImg || '');
    },

    emitSelect(activity, routePreviewImg) {
      this.triggerEvent('select', { activity, routePreviewImg: routePreviewImg || '' });
    },

    onClose() {
      clearTimeout(this._timer);
      if (this._uploadControl) this._uploadControl.destroy();
      this._uploadControl = null;
      this._generation = (this._generation || 0) + 1;
      this._pending = null;
      this.setData({ generating: false, previewTopicId: '' });
      this.triggerEvent('close');
    },

    noop() {}
  }
});
