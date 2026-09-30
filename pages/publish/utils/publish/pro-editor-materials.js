// 待编排素材与正式节点之间的唯一投影。
// pendingMaterials 不进入发布 payload，但从正式节点移回时不能丢玩法、钩子或地点配置。

var policy = require('../../../../utils/publish/pro-editor-policy.js');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function gameplayFromNode(node) {
  node = node || {};
  var hasGameplay = Number(node.templateId) > 0
    || !!(node.templateInfo && node.templateInfo.title)
    || !!text(node.templateName)
    || !!text(node.hookText)
    || !!text(node.cardHookLong)
    || !!text(node.fragmentText)
    || !!text(node.businessTime)
    || !!text(node.subtitle);
  if (!hasGameplay) return null;
  return {
    templateId: node.templateId || 0,
    templateInfo: node.templateInfo || {},
    templateName: node.templateName || '',
    showTemplate: !!node.showTemplate,
    hookText: node.hookText || '',
    cardHookLong: node.cardHookLong || '',
    fragmentText: node.fragmentText || '',
    businessTime: node.businessTime || '',
    subtitle: node.subtitle || '',
  };
}

function materialFromNode(node, kind) {
  node = node || {};
  return {
    _localId: node._localId || '',
    kind: kind === 'place' ? 'place' : 'node',
    name: node.name || '',
    description: node.description || '',
    address: node.address || '',
    longitude: node.longitude == null ? '' : node.longitude,
    latitude: node.latitude == null ? '' : node.latitude,
    imgUrl: node.imgUrl || '',
    duration: Number(node.nodeTime || node.duration || 30),
    gameplay: gameplayFromNode(node),
  };
}

function nodeFromMaterial(material, sortId) {
  material = material || {};
  var gameplay = material.gameplay || {};
  return {
    _localId: material._localId || '',
    name: material.name || '',
    subtitle: gameplay.subtitle || '',
    description: material.description || '',
    address: material.address || '',
    longitude: material.longitude == null ? '' : material.longitude,
    latitude: material.latitude == null ? '' : material.latitude,
    imgUrl: material.imgUrl || '',
    nodeTime: Number(material.duration || 30),
    showTemplate: !!gameplay.showTemplate,
    templateId: gameplay.templateId || 0,
    templateInfo: gameplay.templateInfo || {},
    templateName: gameplay.templateName || '',
    businessTime: gameplay.businessTime || '',
    sortID: Number(sortId || 1),
    hookText: gameplay.hookText || '',
    cardHookLong: gameplay.cardHookLong || '',
    fragmentText: gameplay.fragmentText || '',
  };
}

function arrangementIssue(input) {
  input = input || {};
  var material = input.material || {};
  if (!text(material.name)) {
    return { field: 'name', message: '请先填写节点名称' };
  }
  if (!policy.hasUsableCoords(material)) {
    return { field: 'coordinates', message: '请先补齐有效地点坐标' };
  }
  if (Number(input.productType) === 1 && !policy.hasRealStory(input.chapter)) {
    return { field: 'chapterStory', message: '城市定向需先完成目标章节剧情' };
  }
  return null;
}

module.exports = {
  arrangementIssue: arrangementIssue,
  materialFromNode: materialFromNode,
  nodeFromMaterial: nodeFromMaterial,
};
