// 创作引导卡(学 Questo 创作者四步:选点→拍照→查资料→写故事)的完成态判定。
// 纯函数:无 wx、无 setData。页面(fabu/index.js refreshPrimaryActionState)消费返回值。
//
// 四步映射到城瘾草稿数据(判据只读现有字段,不新造状态):
//   pick     选点   = 任一章节里有节点
//   photo    拍照   = 有竖版封面(formData.imgUrl)或任一节点有配图(node.imgUrl,CSV)
//   research 查资料 = 任一节点填了介绍文案(node.description)
//   story    写故事 = 任一章节有真实剧情(复用 pro-editor-policy.hasRealStory:
//                     blocks 文本块 / description,占位文案「暂无描述」不算)
//
// 这是引导不是闸:四步全 done 只用来让卡自动消失,任何一步都不阻断其它操作。
var proEditorPolicy = require('./pro-editor-policy.js');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function guideStepsOf(formData) {
  formData = formData || {};
  var chapters = formData.chapters || [];
  var nodes = [];
  chapters.forEach(function (chapter) {
    ((chapter && chapter.nodes) || []).forEach(function (node) {
      if (node) nodes.push(node);
    });
  });
  var steps = {
    pick: nodes.length > 0,
    photo: !!text(formData.imgUrl) || nodes.some(function (node) { return !!text(node.imgUrl); }),
    research: nodes.some(function (node) { return !!text(node.description); }),
    story: chapters.some(function (chapter) { return proEditorPolicy.hasRealStory(chapter); }),
  };
  steps.allDone = steps.pick && steps.photo && steps.research && steps.story;
  return steps;
}

module.exports = { guideStepsOf: guideStepsOf };
