const BRAND = '#FFFFFF';
const { getPlayMapState } = require('../../../utils/play-state-contract.js');
const { drawPlayStateMarker } = require('../../../utils/play-marker-draw.js');
// 保留 marker id(非真实 nodeId),onMarkerTap 需一并过滤,避免撞上真实 nodeId 误触发 pintap
const PLAYER_MARKER_ID = 99999;
const ARROW_MARKER_ID = 99998;

// S2 前往中陪伴态:玩家→目标方位角(0~360,正北=0,顺时针),与微信 marker.rotate 语义一致,可裸跑单测
function bearingDeg(la1, lo1, la2, lo2) {
  const rad = (x) => x * Math.PI / 180;
  const phi1 = rad(la1), phi2 = rad(la2), dLambda = rad(lo2 - lo1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (theta * 180 / Math.PI + 360) % 360;
}

// S5 M2:粗略平面距离(仅用于批次排序,非真实米数),裸跑单测友好
function _sqDist(la1, lo1, la2, lo2) {
  const dLat = la1 - la2, dLng = lo1 - lo2;
  return dLat * dLat + dLng * dLng;
}

// S5 M2:markers 依 refLat/refLng 距离升序切成每批 size 个的批次数组(纯函数,可裸跑单测)
function _batchByDistance(markers, refLat, refLng, size) {
  const withDist = (markers || []).map((m) => ({ m, d: _sqDist(refLat, refLng, m.latitude, m.longitude) }));
  withDist.sort((a, b) => a.d - b.d);
  const sorted = withDist.map((o) => o.m);
  const batches = [];
  for (let i = 0; i < sorted.length; i += size) batches.push(sorted.slice(i, i + size));
  return batches;
}

Component({
  properties: {
    scene:  { type: String, value: 'route' },
    nodes:  { type: Array,  value: [], observer() { this._rebuild(); } },
    player: { type: Object, value: null, observer() { this._rebuild(); } },
    // S2:{lat,lng,nodeId}|null。非空时目标 marker 放大+光晕,并在玩家位置画方向箭头(rotate=bearing)。
    // target=null(默认)时 _rebuild 里所有相关分支都不触发,行为与改动前完全一致(回归安全)。
    target: { type: Object, value: null, observer() { this._rebuild(); } },
    center: { type: Object, value: { lat: 31.2304, lng: 121.4737 } },
    scale:  { type: Number, value: 16 },
    mapMarkers:   { type: Array, value: [] },
    mapPolyline:  { type: Array, value: [] },
    mapPolygons:  { type: Array, value: [] },
    mapCircles:   { type: Array, value: [] },
    showControls: { type: Boolean, value: true },
    showPhotoCallouts: { type: Boolean, value: true },
    interactive:  { type: Boolean, value: true },
    accessibilityLabel: { type: String, value: '探索地图' },
    reducedMotion: {
      type: Boolean,
      value: false,
      observer(value) {
        if (!value) return;
        if (this._dropTimers) {
          this._dropTimers.forEach((timer) => clearTimeout(timer));
          this._dropTimers = [];
        }
        this._rebuild();
      }
    },
    // S9 暗色底图预留(regression-safe):微信 <map> 官方"个性化地图样式"属性,已核实
    // (developers.weixin.qq.com/miniprogram/dev/component/map.html,基础库 ≥2.3.0):
    //   subkey(String)     — 腾讯位置服务(LBS)控制台申请的个性化地图 key,官方默认 ''(不启用个性化)
    //   layerStyle(Number) — 个性化样式编号,透传为 wxml 的 layer-style 属性,官方默认 1(标准/浅色底图)
    // 二者默认值与微信 <map> 组件自身默认值完全一致 → 不传/传默认值时底图渲染与改动前逐字节相同。
    // 用户在控制台建好暗色样式后,把拿到的 subkey/编号通过 pages/play 的 MAP_DARK 常量传入即可点亮暗色。
    subkey:     { type: String, value: '' },
    layerStyle: { type: Number, value: 1 },
    showExit: { type: Boolean, value: false },
    exitTop: { type: Number, value: 52 }
  },
  data: { markers: [], circles: [], photoCallouts: [] },
  lifetimes: {
    attached() {
      if (this.data.scene === 'explore') { this._icons = {}; return; }
      this._genIcons().then(() => this._rebuild());
    },
    // 卸载时清掉 dropIn 挂起的定时器,避免组件销毁后 setTimeout 仍触发 setData
    detached() { if (this._dropTimers) { this._dropTimers.forEach((t) => clearTimeout(t)); this._dropTimers = []; } }
  },
  methods: {
    onExitTap() { this.triggerEvent('exit'); },
    // 五种点位态 + 玩家图标离屏生成；定位/离线/打卡失败由地图外的状态卡承载。
    async _genIcons() {
      this._icons = {};
      try {
        const cv = await new Promise((res, rej) =>
          this.createSelectorQuery().select('#iconcv').fields({ node: true }).exec(r =>
            r && r[0] && r[0].node ? res(r[0].node) : rej('no iconcv')));
        const S = 108; cv.width = S; cv.height = S;
        const g = cv.getContext('2d');
        const save = () => new Promise((res, rej) =>
          wx.canvasToTempFilePath({ canvas: cv, fileType: 'png', success: r => res(r.tempFilePath), fail: rej }));
        drawPlayStateMarker(g, S, 'target');      this._icons.target = await save();
        drawPlayStateMarker(g, S, 'actionable');  this._icons.actionable = await save();
        drawPlayStateMarker(g, S, 'completed');   this._icons.completed = await save();
        drawPlayStateMarker(g, S, 'candidate');   this._icons.candidate = await save();
        drawPlayStateMarker(g, S, 'restricted');  this._icons.restricted = await save();
        g.clearRect(0, 0, S, S);
        g.beginPath(); g.arc(S / 2, S / 2, 34, 0, 7); g.fillStyle = 'rgba(17,17,17,.28)'; g.fill();
        g.beginPath(); g.arc(S / 2, S / 2, 20, 0, 7); g.fillStyle = '#FFFFFF'; g.fill();
        g.lineWidth = 8; g.strokeStyle = '#111111'; g.stroke();
        this._icons.player = await save();
        // S2 方向箭头(简单三角,尖端朝上/正北;实际朝向由 marker.rotate=bearing 顺时针转出)
        g.clearRect(0, 0, S, S);
        g.beginPath();
        g.moveTo(S / 2, 6); g.lineTo(S - 22, S - 16); g.lineTo(S / 2, S - 32); g.lineTo(22, S - 16);
        g.closePath();
        g.fillStyle = '#111111'; g.fill();
        g.lineWidth = 4; g.strokeStyle = '#FFFFFF'; g.stroke();
        this._icons.arrow = await save();
      } catch (e) { console.warn('icon gen fail'); this._icons = {}; }
    },
    _rebuild() {
      // S5 M2 竞态修复:dropIn 挂起的分批 setTimeout 若在此时仍未跑完,会用过时闭包快照覆盖本次
      // _rebuild 的最新结果;_rebuild 是权威态,一旦真实触发就取消所有挂起的落地定时器。
      if (this._dropTimers) { this._dropTimers.forEach((t) => clearTimeout(t)); this._dropTimers = []; }
      if (!this._icons) return;
      const t = this.data.target;
      const mk = [];
      const photoCallouts = [];
      (this.data.nodes || []).forEach(n => {
        if (!n.lat || !n.lng) return;
        const isTarget = !!(t && t.nodeId != null && String(t.nodeId) === String(n.nodeId));
        const state = getPlayMapState(n.state, isTarget);
        // 用户裁决:目标点不再叠黑色靶心大图 —— 「第 N 站」白标与图钉重合很花。
        // target 与普通待办同用白色小点,身份由白底高亮 callout(序号胶囊)单独承担。
        const icon = this._icons[state.key === 'target' ? 'actionable' : state.markerKey] || this._icons.actionable;
        const sz = 34;
        const m = { id: Number(n.nodeId), latitude: n.lat, longitude: n.lng,
          width: sz, height: sz, anchor: { x: .5, y: .5 }, zIndex: state.key === 'target' ? 12 : (state.key === 'completed' ? 3 : 9) };
        if (icon) m.iconPath = icon;
        if (this.data.showPhotoCallouts && state.key === 'completed' && n.imgUrl) {
          m.customCallout = { display: 'ALWAYS', anchorX: 0, anchorY: 0 };
          photoCallouts.push({ id: Number(n.nodeId), imgUrl: n.imgUrl, num: n.num });
        } else {
          // 名字 callout(FF-27 胶囊标)。
          // reviewLabel:通关回顾层用的成就气泡文案(如「首达 · 街角绿地」)。只有调用方显式给了
          // 才用它顶掉默认的序号胶囊 —— 不给就完全是原行为,现有调用点零影响。
          const highlighted = state.key === 'target' || state.key === 'actionable';
          const label = n.reviewLabel ? String(n.reviewLabel) : String(n.num || '');
          // 标签为空就整个不挂 callout —— 自由探索不编号(调用方给 num=''),
          // 挂一个空胶囊等于在每个点上贴一块没有字的黑色小牌子。
          if (label) {
            m.callout = { content: label, color: highlighted ? '#111111' : '#fff', fontSize: n.reviewLabel ? 10 : 11,  /* ds-ok 原样搬进 if 的既有行,色值一字未改;原生 callout 只吃字面量,拿不到 var() */
              bgColor: highlighted ? BRAND : 'rgba(20,20,20,.9)',
              padding: n.reviewLabel ? 6 : 5, borderRadius: 8, display: 'ALWAYS', anchorY: -2 };
          }
        }
        mk.push(m);
      });
      const p = this.data.player;
      if (p && p.lat && p.lng && this._icons.player) {
        mk.push({ id: PLAYER_MARKER_ID, latitude: p.lat, longitude: p.lng, width: 30, height: 30,
          anchor: { x: .5, y: .5 }, iconPath: this._icons.player, zIndex: 10 });
      }
      // S2 方向箭头:target 非空且玩家位置有效时,在玩家位置放一个 rotate=bearing(玩家→目标) 的箭头 marker
      if (t && t.lat && t.lng && p && p.lat && p.lng && this._icons.arrow) {
        mk.push({ id: ARROW_MARKER_ID, latitude: p.lat, longitude: p.lng, width: 40, height: 40,
          anchor: { x: .5, y: .5 }, iconPath: this._icons.arrow,
          rotate: bearingDeg(p.lat, p.lng, t.lat, t.lng), zIndex: 11 });
      }
      const circles = [];
      // 非强制候选用柔光外圈，与当前目标/已完成/受限态区分。
      (this.data.nodes || []).forEach(n => {
        const isTarget = !!(t && t.nodeId != null && String(t.nodeId) === String(n.nodeId));
        if (getPlayMapState(n.state, isTarget).key === 'candidate' && n.lat && n.lng && !isTarget) {
          circles.push({ latitude: n.lat, longitude: n.lng, radius: 22,
            fillColor: 'rgba(255,255,255,.16)', color: 'rgba(255,255,255,.4)', strokeWidth: 1 });
        }
      });
      // 目标光晕:选中目标放大并加高亮外圈
      if (t && t.lat && t.lng) {
        circles.push({ latitude: t.lat, longitude: t.lng, radius: 34,
          fillColor: 'rgba(255,255,255,.22)', color: 'rgba(255,255,255,.55)', strokeWidth: 2 });
      }
      this.setData({ markers: mk, circles, photoCallouts });
    },
    onMarkerTap(e) {
      const id = e.detail.markerId;
      if (this.data.scene === 'explore') {
        this.triggerEvent('markertap', e.detail);
        return;
      }
      if (id === PLAYER_MARKER_ID || id === ARROW_MARKER_ID) return; // 保留 id 钉(玩家/方向箭头)不响应,防撞上真实 nodeId
      this.triggerEvent('pintap', { nodeId: id });
    },
    onUpdated(e) { this.triggerEvent('updated', e.detail); },
    onRegionChange(e) {
      this.triggerEvent('regionchange', Object.assign({}, e.detail || {}, {
        phase: (e.detail && e.detail.type) || e.type,
        causedBy: e.causedBy || (e.detail && e.detail.causedBy) || '',
      }));
    },
    onPoiTap(e) { this.triggerEvent('poitap', e.detail); },
    getMapContext() { return wx.createMapContext('fmap', this); },
    recenter() {
      const p = this.data.player;
      if (p && p.lat) this.setData({ 'center': { lat: p.lat, lng: p.lng } });
    },
    zoomIn()  { this.setData({ scale: Math.min(19, this.data.scale + 1) }); },
    zoomOut() { this.setData({ scale: Math.max(12, this.data.scale - 1) }); },

    // S5 M1 相机俯冲落地(≈900ms,由 map 原生 includePoints 过渡承担,不手撸定时器)
    // 组件内 wx.createMapContext 必须传 this 作第二参,否则拿不到组件内 <map id="fmap">。
    // 无节点/坐标缺失时优雅跳过(不报错);末尾内联触发 dropIn() 播 M2。
    flyIn() {
      if (this.data.reducedMotion) {
        this._rebuild();
        return;
      }
      const pts = [];
      (this.data.nodes || []).forEach((n) => { if (n && n.lat && n.lng) pts.push({ latitude: n.lat, longitude: n.lng }); });
      const p = this.data.player;
      if (p && p.lat && p.lng) pts.push({ latitude: p.lat, longitude: p.lng });
      if (pts.length) {
        try {
          const ctx = wx.createMapContext('fmap', this);
          if (ctx && ctx.includePoints) ctx.includePoints({ points: pts, padding: [80, 80, 80, 80] });
        } catch (e) { console.warn('flyIn fail'); }
      }
      this.dropIn();
    },

    // M6 大卡开卡相机平移:选中节点落到上 1/3 视野,底部留白让半屏大卡遮住下半屏时选中点仍可见。
    // 与 flyIn 同源 map-context API(includePoints),各自命令式调用互不冲突;无坐标时优雅跳过。
    focusNode(lat, lng) {
      if (lat == null || lng == null) return;
      if (this.data.reducedMotion) {
        this.setData({ center: { lat, lng } });
        return;
      }
      try {
        const ctx = wx.createMapContext('fmap', this);
        if (ctx && ctx.includePoints) {
          ctx.includePoints({ points: [{ latitude: lat, longitude: lng }], padding: [60, 60, 420, 60] });
        }
      } catch (e) { console.warn('focusNode fail'); }
    },

    // S5 M2 markers 依距离逐个落下(分批 setData 追加,marker 原生不能做 CSS 落下/回弹,
    // 分批逐现是最简可行的真实手段)。结束后 markers 必须等于 _rebuild() 的全量结果(回归安全)。
    dropIn() {
      const full = (this.data.markers || []).slice();
      if (!full.length) return;
      if (this.data.reducedMotion) {
        this.setData({ markers: full });
        return;
      }
      if (this._dropTimers) this._dropTimers.forEach((t) => clearTimeout(t));
      this._dropTimers = [];
      const p = this.data.player;
      const c = this.data.center || {};
      const refLat = (p && p.lat) ? p.lat : (c.lat != null ? c.lat : full[0].latitude);
      const refLng = (p && p.lng) ? p.lng : (c.lng != null ? c.lng : full[0].longitude);
      const batches = _batchByDistance(full, refLat, refLng, 3); // 每批 3 个,间隔 70ms,由近及远
      this.setData({ markers: [] });
      let acc = [];
      batches.forEach((b, idx) => {
        const t = setTimeout(() => {
          acc = acc.concat(b);
          // 最后一批直接落回 full,保证与 _rebuild 产物字节一致(不受排序/切片影响)
          this.setData({ markers: idx === batches.length - 1 ? full : acc.slice() });
        }, idx * 70);
        this._dropTimers.push(t);
      });
    }
  }
});
