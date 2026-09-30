// 可复用路线地图组件:给 topicId 自取主题章节,渲染节点 marker + 橙色 polyline。
// 路线逻辑搬自 pages/topic/index/index.js:buildRouteMap(贴路线优先,节点直连兜底)。
const toast = require('../../../../utils/toast.js');
const app = getApp();

Component({
  properties: {
    topicId: {
      type: null,
      value: '',
      observer(v) {
        if (v && Number(v) > 0) this.loadRoute(v);
      }
    },
    // 地图高度(如 '400rpx' / '300px')
    height: {
      type: String,
      value: '400rpx'
    }
  },

  data: {
    routeReady: false,
    routeIsRoad: false,
    mapLatitude: 0,
    mapLongitude: 0,
    routeMarkers: [],
    routePolyline: [],
    routeIncludePoints: []
  },

  methods: {
    loadRoute(topicId) {
      const that = this;
      app.sendRequest({
        hideLoading: true,
        url: '/api/topic/info-to-user',
        method: 'POST',
        data: { id: topicId },
        success(res) {
          if (res.code == '200' && res.data && res.data.chaptersList) {
            that.buildRouteMap(res.data.chaptersList);
          } else {
            that.setData({ routeReady: false });
            that.triggerEvent('empty');
          }
        },
        fail() {
          that.setData({ routeReady: false });
          that.triggerEvent('empty');
        }
      });
    },

    // 拍平章节节点 → marker + polyline(贴路线优先,否则节点直连)
    buildRouteMap(chaptersList) {
      const that = this;
      const chapters = chaptersList || [];

      const nodes = [];
      chapters.forEach(function (c) {
        (c.nodes || []).forEach(function (n) { nodes.push(n); });
      });
      nodes.sort(function (a, b) {
        return (Number(a.sortId) || 0) - (Number(b.sortId) || 0);
      });

      const valid = nodes.filter(function (n) {
        const lat = Number(n.latitude);
        const lng = Number(n.longitude);
        return n.latitude && n.longitude && !isNaN(lat) && !isNaN(lng);
      });

      if (valid.length === 0) {
        that.setData({ routeReady: false });
        that.triggerEvent('empty');
        return;
      }

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
            bgColor: '#1A1A1A',   /* 去紫:原生 map 的 callout 用 JS 字面量,吃不到 CSS var,根 token 改了这里不会跟着变 */
            padding: 6,
            borderRadius: 8,
            fontSize: 11,
            display: 'BYCLICK'
          }
        };
      });

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
            // 解析失败走兜底
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
        color: '#1A1A1A',   /* 同上:polyline 颜色也是字面量,与 callout 保持同色系 */
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
      }, function () {
        // 地图数据就位:通知父组件可截图(发布预览快照用)
        that.triggerEvent('ready');
      });
    },

    // 截取当前路线地图为临时图片(发布静态预览图用),返回 Promise<tempImagePath>
    snapshotRoute() {
      const that = this;
      return new Promise(function (resolve, reject) {
        if (!that.data.routeReady) {
          reject('route not ready');
          return;
        }
        const ctx = wx.createMapContext('rmMap', that);
        ctx.takeSnapshot({
          success: function (res) { resolve(res.tempImagePath); },
          fail: function (e) { reject(e); }
        });
      });
    },

    onNodeTap(e) {
      const markerId = (e.detail && e.detail.markerId !== undefined) ? e.detail.markerId : e.markerId;
      const m = (this.data.routeMarkers || [])[markerId];
      if (m && m.callout && m.callout.content) {
        toast(m.callout.content);
      }
    }
  }
});
