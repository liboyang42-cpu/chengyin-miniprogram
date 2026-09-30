// 发布器路线地图视图的纯函数。从 pages/publish/fabu/index.js 的 buildRouteMap 抽出
// (与 publish-stats.js 同一手法:无 wx / 无 this / 无副作用,可直接单测)。
//
// 抽它的理由不只是「那个文件太大」:marker 的配色规则(选中 > 起点 > 终点 > 已配游戏 > 草稿)、
// >30 个节点才简化呈现的阈值、折线至少两点才画、有选中节点时不覆盖镜头中心 ——
// 这些是真会出错的判断,此前一行测试都没有,因为它们埋在一个 178 行的页面方法里。
//
// 逻辑与原内联实现逐字一致,只把 8 处 this 引用换成显式入参:
//   this.data.formData.chapters      → state.chapters
//   this.data.selectedNodeLid        → state.selectedNodeLid
//   this.data.pendingMaterials       → state.pendingMaterials
//   this.data.popChapterNodes        → state.popChapterNodes
//   this.data.nodesForm              → state.nodesForm
//   this.data.popChapterNodesAction  → state.popChapterNodesAction
//   this._markerMap = {}             → 局部 markerMap,随返回值交回页面
//   this.setData(patch)              → return { markerMap, patch }

const proEditorPolicy = require('../../../../utils/publish/pro-editor-policy.js');

const ROUTE_COLORS = ['#1A1A1A', '#155DFC', '#12B886', '#0CA5A5', '#F59F00', '#E64980'];
const MAP_PIN = '/pages/publish/images/map-pin.png';
const START_COLOR = '#12B886'; // 起点
const END_COLOR = '#FA5252';   // 终点
const DRAFT_COLOR = '#ADB5BD'; // 草稿(未配游戏)
const SELECTED_COLOR = '#1A1A1A'; // 列表↔地图联动选中态(去紫,与 route-map/topic 同值)
const MAP_DEFAULT_CENTER = { longitude: 121.4737, latitude: 31.2304 }; // 上海人民广场兜底

/**
 * @param {object} state 页面显式传入的数据切片,模块本身不碰 this.data
 * @returns {{markerMap: object, patch: object}} markerMap 交回页面存为 _markerMap;patch 交给 setData
 */
function buildRouteMapView(state) {
  state = state || {};
    const chapters = (state.chapters) || [];
    const markers = [];
    const polyline = [];
    const allPoints = [];
    let globalNo = 0; // 全局站点序号(跨章节连续)
    const selectedLid = state.selectedNodeLid; // 列表↔地图联动选中节点
    const markerMap = {}; // markerId → {chapterLid, nodeLid} 反查表(供 M1.2 bindmarkertap)

    // 先数出本次所有有效(有坐标)节点总数,用于判定全局起点/终点
    let totalValid = 0;
    chapters.forEach((chapter) => {
      (chapter.nodes || []).forEach((node) => {
        const lat = Number(node.latitude);
        const lng = Number(node.longitude);
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;
        totalValid += 1;
      });
    });

    // 节点过多时简化非关键 marker 呈现,降低原生地图渲染开销
    const simplify = totalValid > 30;

    chapters.forEach((chapter, ci) => {
      const color = ROUTE_COLORS[ci % ROUTE_COLORS.length];
      (chapter.nodes || []).forEach((node) => {
        const lat = Number(node.latitude);
        const lng = Number(node.longitude);
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) return; // 跳过未选点节点
        globalNo += 1;
        const pt = { latitude: lat, longitude: lng };
        allPoints.push(pt);
        markerMap[globalNo] = { chapterLid: chapter._localId, nodeLid: node._localId };
        // pin 状态色:选中态优先,其次起点/终点固定色;否则已配游戏=章节色,未配=草稿灰
        const isSelected = !!selectedLid && node._localId === selectedLid;
        let pinColor;
        if (isSelected) {
          pinColor = SELECTED_COLOR;
        } else if (globalNo === 1) {
          pinColor = START_COLOR;
        } else if (globalNo === totalValid) {
          pinColor = END_COLOR;
        } else if ((node.templateId && Number(node.templateId) > 0) || (node.templateInfo && node.templateInfo.title)) {
          pinColor = color;
        } else {
          pinColor = DRAFT_COLOR;
        }
        // 关键 marker = 选中 / 起点(globalNo===1)/ 终点(globalNo===totalValid),始终原样;
        // 其余在 simplify 时缩小尺寸、去掉 label 描边并缩小字号,减轻渲染负担
        const isKey = isSelected || globalNo === 1 || globalNo === totalValid;
        const lite = simplify && !isKey;
        const label = lite
          ? {
              content: String(globalNo),
              color: '#ffffff',
              fontSize: 9,
              bgColor: pinColor,
              borderRadius: 20,
              padding: 4,
              textAlign: 'center',
              anchorX: 0,
              anchorY: -4
            }
          : {
              content: String(globalNo),
              color: '#ffffff',
              fontSize: 11,
              bgColor: pinColor,
              borderRadius: 20,
              borderWidth: 2,
              borderColor: '#ffffff',
              padding: 5,
              textAlign: 'center',
              anchorX: 0,
              anchorY: -4
            };
        markers.push({
          id: globalNo,
          latitude: lat,
          longitude: lng,
          iconPath: MAP_PIN,
          width: isSelected ? 42 : (lite ? 22 : 30),
          height: isSelected ? 42 : (lite ? 22 : 30),
          label: label
        });
      });
    });

    // 待编排地点是地图上的独立投影：可见但不编号、不进入正式路线折线。
    (state.pendingMaterials || []).forEach((material, index) => {
      if (!proEditorPolicy.hasUsableCoords(material)) return;
      const markerId = 900100 + index;
      const lat = Number(material.latitude);
      const lng = Number(material.longitude);
      markerMap[markerId] = { pendingLocalId: material._localId };
      markers.push({
        id: markerId,
        latitude: lat,
        longitude: lng,
        iconPath: MAP_PIN,
        width: 28,
        height: 28,
        label: {
          content: '待编排',
          color: '#ffffff',
          fontSize: 10,
          bgColor: DRAFT_COLOR,
          borderRadius: 20,
          padding: 5,
          textAlign: 'center',
          anchorX: 0,
          anchorY: -4,
        },
      });
      allPoints.push({ latitude: lat, longitude: lng });
    });

    const globalRoutePoints = [];
    chapters.forEach((chapter) => {
      (chapter.nodes || []).forEach((node) => {
        const lat = Number(node.latitude);
        const lng = Number(node.longitude);
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;
        globalRoutePoints.push({ latitude: lat, longitude: lng });
      });
    });
    if (globalRoutePoints.length > 1) {
      polyline.push({
        points: globalRoutePoints,
        color: '#0a84ffDD',
        width: 6,
        arrowLine: true
      });
    }

    const draft = state.popChapterNodes ? (state.nodesForm || {}) : null;
    const draftLat = draft ? Number(draft.latitude) : NaN;
    const draftLng = draft ? Number(draft.longitude) : NaN;
    if (draft && draftLat && draftLng && !isNaN(draftLat) && !isNaN(draftLng)) {
      markers.push({
        id: 900001,
        latitude: draftLat,
        longitude: draftLng,
        iconPath: MAP_PIN,
        width: 38,
        height: 38,
        label: {
          content: state.popChapterNodesAction === 0 ? '待添加' : '编辑中',
          color: '#ffffff',
          fontSize: 11,
          bgColor: SELECTED_COLOR,
          borderRadius: 20,
          borderWidth: 2,
          borderColor: '#ffffff',
          padding: 5,
          textAlign: 'center',
          anchorX: 0,
          anchorY: -4
        }
      });
      allPoints.push({ latitude: draftLat, longitude: draftLng });
    }

    const patch = {
      mapMarkers: markers,
      mapPolyline: polyline,
      // 空 include-points 会让腾讯 SDK fitBounds 崩溃,无有效节点时兜底给中心点
      mapInclude: allPoints.length ? allPoints : [MAP_DEFAULT_CENTER],
      hasRoute: allPoints.length > 0
    };
    // 有选中节点时,镜头已由 selectNode 显式定位,勿覆盖中心;否则回到首点/兜底
    if (!selectedLid) {
      patch.mapCenter = allPoints[0] || MAP_DEFAULT_CENTER;
    }
    return { markerMap: markerMap, patch: patch };
}

module.exports = {
  buildRouteMapView: buildRouteMapView,
  ROUTE_COLORS: ROUTE_COLORS,
  MAP_PIN: MAP_PIN,
  START_COLOR: START_COLOR,
  END_COLOR: END_COLOR,
  DRAFT_COLOR: DRAFT_COLOR,
  SELECTED_COLOR: SELECTED_COLOR,
  MAP_DEFAULT_CENTER: MAP_DEFAULT_CENTER,
};
