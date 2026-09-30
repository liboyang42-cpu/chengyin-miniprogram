const app = getApp();

// 玩法详情 = 三级(说明/详情)⇒ 场景弹窗,宿主是「玩法说明」列表页。
// subpackageA/pages/infomationdetail 保留为深链兼容壳(分享卡片会直落这一页)。
Component({
  properties: {
    detailId: { type: String, value: '' },
    theme: { type: String, value: 'player' },
  },
    data: {
      id: '', // 文章ID
      detailData: {}, // 详情数据
      contentNodes: [], // 解析后的HTML节点
      loading: true, // 加载状态
      error: false, // 错误状态(网络/业务失败,可重试)
      errorMsg: '',
      empty: false, // 接口成功但正文缺失(重试不会凭空产生内容)
      missing: false // 参数缺失(没有 id,重试也不会出现,不能给假重试)
    },
  lifetimes: {
    attached() {
      const id = this.data.detailId
      if (!id) { this.setData({ loading: false, missing: true }); return }
      this.setData({ id })
      this.getDetail()
    },
  },
  methods: {
    // 获取详情数据
    getDetail: function() {
      const that = this;

      that.setData({
        loading: true,
        error: false,
        errorMsg: '',
        empty: false,
        missing: false
      });

      app.sendRequest({
        url: '/api/common/infomation_detail',
        method: "POST",
        data: {
          id: that.data.id
        },
        hideLoading: true,
        silentError: true,
        success: function(res) {
          if (res && res.code == "200") {
            const raw = res.data
            const detailData = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
            const contents = typeof detailData.contents === 'string' ? detailData.contents.trim() : ''

            if (!contents) {
              that.setData({ detailData: {}, contentNodes: [], empty: true, loading: false })
              return
            }

            // 解析HTML内容
            const contentNodes = that.parseHtml(contents);

            that.setData({
              detailData: Object.assign({}, detailData, { title: detailData.title || '玩法说明' }),
              contentNodes: contentNodes,
              empty: false,
              loading: false
            });
          } else {
            that.setData({
              error: true,
              errorMsg: '服务暂时不可用，请稍后重试。',
              loading: false
            });
          }
        },
        fail: function() {
          that.setData({
            error: true,
            errorMsg: '网络异常，请检查网络后重试。',
            loading: false
          });
        }
      });
    },

    // HTML解析方法
    parseHtml: function(html) {
      if (!html) return [];

      // 小程序rich-text组件支持的节点格式
      // 这里可以进行更复杂的HTML解析，根据实际需求调整
      try {
        // 简单的HTML标签替换和处理
        let processedHtml = html
          .replace(/<img/gi, '<img style="max-width:100%;height:auto;display:block;margin:20rpx 0;"')
          .replace(/<p/gi, '<p style="margin:20rpx 0;"')
          .replace(/<h1/gi, '<h1 style="font-size:36rpx;font-weight:bold;margin:30rpx 0 20rpx 0;"')
          .replace(/<h2/gi, '<h2 style="font-size:34rpx;font-weight:bold;margin:30rpx 0 20rpx 0;"')
          .replace(/<h3/gi, '<h3 style="font-size:32rpx;font-weight:bold;margin:30rpx 0 20rpx 0;"')
          .replace(/<a/gi, '<a style="color:#4C86FF;text-decoration:none;"' /* ds-ok: rich-text 内部节点吃不到 var(),这里是玩家档 --cy-color-status-info 的实值镜像。2026-09-02 去系统蓝,原 #007AFF */)
          .replace(/<blockquote/gi, '<blockquote style="border-left:6rpx solid #ddd;padding-left:20rpx;margin:20rpx 0;color:#666;background:#f9f9f9;padding:20rpx;"')
          // ul/ol/li 原来只在 wxss 里定义 —— 但外部 wxss 够不到 rich-text 内部节点,那几条从来没生效过。
          // 搬进内联(值与原 wxss 逐条相同),顺带让它在组件里也成立(组件禁标签选择器)。
          .replace(/<ul/gi, '<ul style="padding-left:40rpx;margin:20rpx 0;"')
          .replace(/<ol/gi, '<ol style="padding-left:40rpx;margin:20rpx 0;"')
          .replace(/<li/gi, '<li style="margin:10rpx 0;"');

        return processedHtml;
      } catch (error) {
        console.error('HTML解析错误');
        return html;
      }
    },

    // 分享进来时本页是栈第一页,navigateBack 会失败 ⇒ 兜底回同域玩法列表(无参)。
    // redirectTo 而非 navigateTo:兜底不该把页面栈越堆越深。
    // 弹窗里「返回」= 关掉这一层回到玩法说明列表,不猜页面栈。
    onBack: function() {
      this.triggerEvent('back');
    },

    // 重试加载
    retryLoad: function() {
      this.getDetail();
    },

    // 参数缺失时的唯一出口:重试不会让 id 凭空出现,只能回列表(与 onBack 同一兜底目标)
    // 参数缺失时唯一出口:同样回上一层(重试不会让 id 凭空出现)。
    onMissingBack: function() {
      this.triggerEvent('back');
    },

  },
})
