const app = getApp();

Page({
  data: {
    id: '', // 文章ID
    detailData: {}, // 详情数据
    contentNodes: [], // 解析后的HTML节点
    loading: true, // 加载状态
    error: false, // 错误状态(网络/业务失败,可重试)
    missing: false, // 参数缺失(没有 id,重试也不会出现,不能给假重试)
    // 有 id、接口也返回 200,但这条玩法说明**已经不在了**(后台删了)。
    // 这一态原来没人管:detailData 落成空对象后直接走内容分支,页面渲染成
    // 「标题 + 一条分隔线 + 整片空白」的空壳(2026-08-19 B37 实拍坐实 —— 清生产脏数据
    // 删掉 cms_infomation 唯一那行之后立刻暴露)。它既不是加载失败(重试没用),
    // 也不是参数缺失(链接是对的),所以要单独一态。
    notfound: false
  },

  onLoad(options) {
    if (options.id) {
      this.setData({
        id: options.id
      });
      this.getDetail();
    } else {
      this.setData({
        missing: true,
        loading: false
      });
    }
  },

  // 获取详情数据
  getDetail: function() {
    const that = this;

    that.setData({
      loading: true,
      error: false,
      missing: false,
      notfound: false
    });

    app.sendRequest({
      url: '/api/common/infomation_detail',
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      method: "POST",
      data: {
        id: that.data.id
      },
      success: function(res) {
        if (res.code == "200") {
          const detailData = res.data;
          // 200 但没有实体 = 这条说明已被删除,不能当内容渲染
          if (!detailData || !detailData.id) {
            that.setData({ notfound: true, loading: false, detailData: {}, contentNodes: [] });
            return;
          }
          
          // 解析HTML内容
          const contentNodes = that.parseHtml(detailData.contents || '');
          
          that.setData({
            detailData: detailData,
            contentNodes: contentNodes,
            loading: false
          });

          // 设置页面标题
          if (detailData.title) {
            wx.setNavigationBarTitle({
              title: detailData.title
            });
          }
        } else {
          that.setData({
            error: true,
            errorMsg: res.msg || '',
            loading: false
          });
        }
      },
      fail: function(res) {
        that.setData({
          error: true,
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
        .replace(/<blockquote/gi, '<blockquote style="border-left:6rpx solid #ddd;padding-left:20rpx;margin:20rpx 0;color:#666;background:#f9f9f9;padding:20rpx;"');

      return processedHtml;
    } catch (error) {
      console.error('HTML解析错误');
      return html;
    }
  },

  // 分享进来时本页是栈第一页,navigateBack 会失败 ⇒ 兜底回同域玩法列表(无参)。
  // redirectTo 而非 navigateTo:兜底不该把页面栈越堆越深。
  onBack: function() {
    wx.navigateBack({
      fail() { wx.redirectTo({ url: '/subpackageA/pages/infomation/infomation' }); },
    });
  },

  // 重试加载
  retryLoad: function() {
    this.getDetail();
  },

  // 参数缺失时的唯一出口:重试不会让 id 凭空出现,只能回列表(与 onBack 同一兜底目标)
  onMissingBack: function() {
    wx.navigateBack({
      fail() { wx.redirectTo({ url: '/subpackageA/pages/infomation/infomation' }); },
    });
  },

  // 分享功能
  onShareAppMessage: function() {
    const that = this;
    return {
      title: that.data.detailData.title || '文章详情',
      path: `/subpackageA/pages/infomationdetail/infomationdetail?id=${that.data.id}`
    };
  }
});
