// FE-11 发布器统计纯函数。从 pages/publish/fabu/index.js 抽出:章节/路线里程·时长·完成度计算。
// 无 wx / 无 this / 无副作用,可直接单测。逻辑与原 fabu 内联实现逐字一致:
//  - 距离保留 km 单位 + atan2 写法(不复用 utils/geo 的米制 haversine,避免 .toFixed(2) 浮点漂移)
//  - 显示格式("Xh,Ymin" / "X.XXkm")、完成度勾项与顺序均不变
// 页面读 this.data 的部分由调用方以显式入参传入(chapters / formData / ctx),模块本身不碰 this.data。

// 两点球面距离(公里)。Haversine,R=6371km(= 原 calculateDistance)。
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球半径（公里）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// 单章节统计:总时长(分钟)+ 显示格式 + 站点数 + 模板数(= 原 calculateChapterStats)。
function chapterStats(chapter) {
  if (!chapter || !chapter.nodes) {
    return {
      duration: 0,
      locationCount: 0,
      templateCount: 0
    };
  }

  let totalMinutes = 0;
  let locationCount = chapter.nodes.length;
  let templateCount = 0;

  chapter.nodes.forEach(node => {
    // 计算总时长（分钟）
    if (node.nodeTime && !isNaN(parseInt(node.nodeTime))) {
      totalMinutes += parseInt(node.nodeTime);
    }

    // 计算模板数（templateId > 0）
    if (node.templateId && parseInt(node.templateId) > 0) {
      templateCount++;
    }
  });

  // 转换为小时显示格式
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const durationDisplay = hours > 0 ? `${hours}h,${minutes}min` : `${minutes}min`;

  return {
    duration: totalMinutes,
    durationDisplay: durationDisplay,
    locationCount: locationCount,
    templateCount: templateCount
  };
}

// 路线总里程(公里,数值):收集合法经纬度节点,顺序累加相邻 haversineKm(= 原 calculateTotalDistance)。
function totalDistanceKm(chapters) {
  const list = chapters || [];
  let totalDistance = 0;
  let allNodes = [];

  // 收集所有【合法】的经纬度节点（排除空值/非数字）
  list.forEach(chapter => {
    if (chapter.nodes) {
      chapter.nodes.forEach(node => {
        // 校验经纬度是否为合法数字
        const lat = parseFloat(node.latitude);
        const lon = parseFloat(node.longitude);
        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          allNodes.push({
            latitude: lat,
            longitude: lon
          });
        }
      });
    }
  });

  // 按顺序计算相邻节点间的距离（至少2个节点才计算）
  if (allNodes.length >= 2) {
    for (let i = 1; i < allNodes.length; i++) {
      const prevNode = allNodes[i - 1];
      const currNode = allNodes[i];
      totalDistance += haversineKm(
        prevNode.latitude,
        prevNode.longitude,
        currNode.latitude,
        currNode.longitude
      );
    }
  }

  return totalDistance;
}

// 路线总时长文案 "Xh,Ymin"(= 原 calculateTotalDuration)。
function totalDurationText(chapters) {
  let totalMinutes = 0;

  if (chapters) {
    chapters.forEach(chapter => {
      if (chapter.nodes) {
        chapter.nodes.forEach(node => {
          totalMinutes += node.nodeTime || 0;
        });
      }
    });
  }

  let hours = Math.floor(totalMinutes / 60);
  let minutes = totalMinutes % 60;
  return `${hours}h,${minutes}min`;
}

// 路线总统计:时长/节点/模板/格式化里程(= 原 calculateTotalStats)。
// totalDistance 由调用方传入(= totalDistanceKm(chapters)),与原实现内部调用 calculateTotalDistance() 等价。
function totalStats(chapters, totalDistance) {
  const list = chapters || [];
  let totalMinutes = 0;
  let totalNodes = 0;
  let totalTemplates = 0;

  list.forEach(chapter => {
    if (chapter.nodes) {
      // 节点总数
      totalNodes += chapter.nodes.length;

      chapter.nodes.forEach(node => {
        // 总时长
        if (node.nodeTime && !isNaN(parseInt(node.nodeTime))) {
          totalMinutes += parseInt(node.nodeTime);
        }

        // 模板总数
        if (node.templateId && parseInt(node.templateId) > 0) {
          totalTemplates++;
        }
      });
    }
  });

  // 总时长显示格式
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const totalDurationDisplay = hours > 0 ? `${hours}h,${minutes}min` : `${minutes}min`;

  // 里程格式为 "X.XXkm"
  const formattedDistance = totalDistance.toFixed(2) + 'km';

  return {
    totalDuration: totalMinutes,
    totalDurationDisplay: totalDurationDisplay,
    totalNodes: totalNodes,
    totalTemplates: totalTemplates,
    totalDistance: formattedDistance
  };
}

// 发布完成度:{ percent, missing[] }(= 原 computeCompleteness)。
// formData = this.data.formData;ctx = { startDateTime, endDateTime, selectedCategoryIds }(原读 this.data 的三项)。
function computeCompleteness(formData, ctx) {
  const fd = formData || {};
  const c = ctx || {};
  const missing = [];
  const checks = []; // 每项 true/false,percent = 通过数 / 总数

  // —— 主题级 ——（CU-C-159:叫法与发布前检查、编辑器逐项一致,不再称"路线"）
  const okName = !!(fd.name && String(fd.name).trim());
  checks.push(okName); if (!okName) missing.push('主题名称');

  const okCover = !!(fd.imgUrl && String(fd.imgUrl).trim());
  checks.push(okCover); if (!okCover) missing.push('主题封面');

  const okStart = !!(fd.startDate && c.startDateTime && c.startDateTime !== '开始时间');
  checks.push(okStart); if (!okStart) missing.push('开始时间');

  const okEnd = !!(fd.endDate && c.endDateTime && c.endDateTime !== '结束时间');
  checks.push(okEnd); if (!okEnd) missing.push('结束时间');

  const okCategory = (c.selectedCategoryIds || []).length > 0;
  checks.push(okCategory); if (!okCategory) missing.push('主题类别');

  // —— 路线级:每个节点都要有可用坐标 ——
  // 2026-08-10 口径收敛:这里原本要求"≥2 个有坐标站点"、注释还写着"对齐 _isStepDone(0)",
  // 而那道闸实际只要求 ≥1 —— 两边从来没对齐,于是过了「下一步」的路线在完整度里仍报缺。
  // 现在统一到 validateForm 的判据:没坐标的节点玩家走不到,一个都不许留。
  const chapters = fd.chapters || [];
  let nodeCount = 0;
  let coordMissing = 0;
  chapters.forEach((chapter) => {
    (chapter.nodes || []).forEach((node) => {
      nodeCount += 1;
      if (!(node && node.longitude && node.latitude && node.longitude !== '0' && node.latitude !== '0')) {
        coordMissing += 1;
      }
    });
  });
  const okAllCoords = nodeCount > 0 && coordMissing === 0;
  checks.push(okAllCoords);
  if (!okAllCoords) missing.push(nodeCount === 0 ? '至少一个站点' : `${coordMissing} 个站点还没选地点`);

  // —— 节点级:每个节点需有地点 + 描述 + 时长 ——
  let nodeTotal = 0, nodeAddrOk = 0, nodeDescOk = 0, nodeTimeOk = 0;
  chapters.forEach((chapter) => {
    (chapter.nodes || []).forEach((node) => {
      nodeTotal++;
      if (node && node.address && String(node.address).trim()) nodeAddrOk++;
      if (node && node.description && String(node.description).trim()) nodeDescOk++;
      if (node && Number(node.nodeTime) > 0) nodeTimeOk++;
    });
  });
  if (nodeTotal > 0) {
    const aAddr = nodeAddrOk === nodeTotal;
    checks.push(aAddr); if (!aAddr) missing.push('部分站点缺地点');
    const aDesc = nodeDescOk === nodeTotal;
    checks.push(aDesc); if (!aDesc) missing.push('部分站点缺描述');
    const aTime = nodeTimeOk === nodeTotal;
    checks.push(aTime); if (!aTime) missing.push('部分站点缺时长');
  } else {
    checks.push(false); missing.push('尚未添加站点');
  }

  const passed = checks.filter(Boolean).length;
  const percent = checks.length ? Math.round((passed / checks.length) * 100) : 0;
  return { percent, missing };
}

module.exports = {
  haversineKm: haversineKm,
  chapterStats: chapterStats,
  totalDistanceKm: totalDistanceKm,
  totalDurationText: totalDurationText,
  totalStats: totalStats,
  computeCompleteness: computeCompleteness,
};
