// 专业主题编辑器的策略层:算「现在处于什么状态、下一步能不能做、为什么不能发布」。
//
// 为什么单独成模块:这些规则原先散在 fabu/index.js 的 setData 回调、wx:if 表达式和
// validateForm 里,同一个判据有三处各写各的(2026-08-09 实测:节点坐标要求
// 下一步闸 ≥1 / 完整度 ≥2 / 发布校验压根不查)。规则一旦分散,测试就只能去复制
// 条件表达式,断言的是「我抄对了没有」而不是「行为对不对」。
//
// 本模块是纯函数:无 wx、无 setData、无网络。页面消费返回值去做副作用。
//
// ⚠️ 与后端的硬约束对齐(2026-08-10 读 CmsTopicServiceImpl 确认):
//   自由探索(productType=2)**必须**有 recruitDeadline,否则后端 create/update 直接抛
//   「自由探索主题必须设置招募截止时间」。而且传了它才会把主题置入 lifecycle=1(招募),
//   是整条招商链路的开关。所以这条是必填、不是「开了商家开关才必填」。

var CITY_ORIENTEERING = 1;
var FREE_EXPLORE = 2;

// 历史脏值:旧版 confrimChapter 会给空剧情写「暂无描述」凑完成态。
// 它在库里和真实剧情长得一样,只能按值排除 —— 否则城市定向的剧情闸形同虚设。
var FAKE_STORY_VALUES = ['暂无描述', '暂无', '无'];

function text(value) {
  return String(value == null ? '' : value).trim();
}

/** 剧情是否真的写了(空白与占位文案都不算) */
function hasRealStory(chapter) {
  var story = '';
  if (chapter && Array.isArray(chapter.blocks)) {
    var projected = [];
    for (var i = 0; i < chapter.blocks.length; i += 1) {
      var block = chapter.blocks[i] || {};
      if (block.type === 'node') break;
      if (block.type === 'text') projected.push(block.content || '');
    }
    story = text(projected.join('\n'));
  } else {
    story = text(chapter && chapter.description);
  }
  if (!story) return false;
  return FAKE_STORY_VALUES.indexOf(story) === -1;
}

/** 坐标是否可用。'0' 是后端/POI 返回的常见空值,不能当有效坐标 */
function hasUsableCoords(node) {
  if (!node) return false;
  var lng = text(node.longitude);
  var lat = text(node.latitude);
  if (!lng || !lat || lng === '0' || lat === '0') return false;
  var lngNumber = Number(lng);
  var latNumber = Number(lat);
  return isFinite(lngNumber) && isFinite(latNumber)
    && lngNumber !== 0 && latNumber !== 0
    && lngNumber >= -180 && lngNumber <= 180
    && latNumber >= -90 && latNumber <= 90;
}

/** 创建正式节点的即时剧情闸。页面拿返回文案提示，null 表示放行。 */
function formalNodeCreationIssue(formData, chapterIndex) {
  formData = formData || {};
  var index = Number(chapterIndex);
  var chapter = (formData.chapters || [])[index];
  if (!chapter) {
    return { field: 'chapter', chapterIndex: index, message: '未找到目标章节' };
  }
  if (Number(formData.productType) === CITY_ORIENTEERING && !hasRealStory(chapter)) {
    return { field: 'chapterStory', chapterIndex: index, message: '城市定向需先完成本章剧情' };
  }
  return null;
}

function hasGameplay(node) {
  if (!node) return false;
  if (Number(node.templateId) > 0) return true;
  return !!(node.templateInfo && node.templateInfo.title);
}

/**
 * 默认创作起点。只决定空草稿首次看到什么,不上送后端,不是第三种玩法模式。
 * 俱乐部入口优先 —— 从俱乐部发起的团,创作者手上先有的是地点和合作资源。
 */
function defaultAnchorFor(productType, clubId) {
  if (clubId) return 'place';
  return Number(productType) === CITY_ORIENTEERING ? 'story' : 'node';
}

/** 逐章状态。UI 直接拿它渲染章节卡上的标记,不要自己再算一遍 */
function chapterStatesOf(formData) {
  var isCity = Number(formData.productType) === CITY_ORIENTEERING;
  return (formData.chapters || []).map(function (chapter, index) {
    var nodes = (chapter && chapter.nodes) || [];
    var storyDone = hasRealStory(chapter);
    var missingCoords = nodes.filter(function (n) { return !hasUsableCoords(n); }).length;
    var gameplayConfigured = nodes.filter(hasGameplay).length;
    return {
      index: index,
      name: text(chapter && chapter.name) || ('第' + (index + 1) + '章'),
      storyDone: storyDone,
      storyRequired: isCity,
      nodeCount: nodes.length,
      nodesMissingCoords: missingCoords,
      gameplayConfigured: gameplayConfigured,
      // 标签只在「还没配齐」时出现(稿子 4028:13649:第1章配齐了就不显示玩法标签,
      // 第2章还差才显示「玩法 0/1」)。状态标记的用途是提醒还差什么,配齐了就是噪音。
      gameplayPending: nodes.length > 0 && gameplayConfigured < nodes.length,
      // 城市定向的领域依赖:正式节点必须服务于章节剧情,所以没剧情不许建节点。
      // 这条必须在「点创建节点」当场执行,不能拖到发布才告知。
      canAddNode: !isCity || storyDone,
    };
  });
}

/**
 * 空草稿时给一个引导动作;一旦有内容就返回 null,由章节卡上的状态标记接手。
 *
 * 2026-09-05 用户裁决:三条起点原来给三个不同的起手动作(写第一章 / 添加第一个地点 /
 * 添加第一个探索节点),但落点其实是同一个 —— 都要先有章节。三句话只是把同一件事说了三遍,
 * 反而让人以为选错了起点就走不通。统一成「创建章节」,点完直接进故事流。
 * ⚠️ anchor 仍然保留:它还在决定待编排区的「继续录入地点」等后续动作,只是不再改这颗 CTA。
 */
function starterActionFor(anchor) {
  return { key: 'createChapter', label: '＋ 创建章节' };
}

function isBlankDraft(formData, pendingMaterials) {
  var chapters = (formData && formData.chapters) || [];
  var hasChapterContent = chapters.some(function (c) {
    if (hasRealStory(c)) return true;
    return ((c && c.nodes) || []).length > 0;
  });
  return !hasChapterContent && !(pendingMaterials || []).length;
}

/** 主题类别是否选了至少一个。上送时是逗号串,页面里是数组,两种都得认 */
function hasCategory(categoryIds) {
  var list = Array.isArray(categoryIds) ? categoryIds : String(categoryIds == null ? '' : categoryIds).split(',');
  for (var i = 0; i < list.length; i += 1) {
    if (text(list[i])) return true;
  }
  return false;
}

/**
 * 发布阻断项。每条都要定位到具体对象 —— 「还有 3 个节点缺地点」没法点,
 * 「第 2 章第 1 个节点缺地点」才能把用户送到那一行。
 */
function blockingIssuesOf(formData, pendingMaterials, chapterStates, categoryIds) {
  var issues = [];
  var isFree = Number(formData.productType) === FREE_EXPLORE;

  if (!text(formData.name)) issues.push({ key: 'name', message: '请填写主题名称' });
  if (!text(formData.subtitle)) issues.push({ key: 'subtitle', message: '请填写一句话介绍' });
  if (!text(formData.description)) issues.push({ key: 'description', message: '请填写完整介绍' });
  if (!text(formData.imgUrl)) issues.push({ key: 'imgUrl', message: '请上传竖版封面' });
  // 主题类别在「主题详情」里标着必填星号,发布校验也确实拦它,但「还差 N 项」以前
  // 压根不数它 —— 于是选完类别回到总览,数字纹丝不动(CU-C-157)。摘要既然叫「缺项」,
  // 就必须和同一批必填项同源。
  if (!hasCategory(categoryIds)) issues.push({ key: 'categoryIds', message: '请选择至少一个路线类别' });

  // 自由探索的招募截止是后端硬约束,缺了会抛异常 —— 必须在前端就拦住,
  // 否则用户看到的是「保存失败」而不是「还差什么」。
  if (isFree && !text(formData.recruitDeadline)) {
    issues.push({ key: 'recruitDeadline', message: '自由探索必须设置招募截止时间' });
  }

  if (!chapterStates.length) {
    issues.push({ key: 'chapters', message: '至少需要一个章节' });
  }

  chapterStates.forEach(function (state) {
    if (state.storyRequired && !state.storyDone) {
      issues.push({
        key: 'chapter' + state.index,
        chapterIndex: state.index,
        message: state.name + '缺少剧情',
      });
    }
    if (!state.nodeCount) {
      issues.push({
        key: 'chapter' + state.index,
        chapterIndex: state.index,
        message: state.name + '还没有节点',
      });
    }
  });

  (formData.chapters || []).forEach(function (chapter, ci) {
    ((chapter && chapter.nodes) || []).forEach(function (node, ni) {
      var label = text(node && node.name) || ('第' + (ni + 1) + '个节点');
      if (!text(node && node.name)) {
        issues.push({ key: 'node', chapterIndex: ci, nodeIndex: ni, message: label + '缺少名称' });
      }
      if (!hasUsableCoords(node)) {
        issues.push({ key: 'node', chapterIndex: ci, nodeIndex: ni, message: '节点「' + label + '」缺少地点' });
      }
    });
  });

  var pending = (pendingMaterials || []).length;
  if (pending) {
    issues.push({ key: 'pendingMaterials', message: '还有 ' + pending + ' 个素材未编排进章节' });
  }

  return issues;
}

/**
 * 唯一主入口。页面只消费返回值,不复制里面的条件。
 * @param {{formData:object, clubId?:any, pendingMaterials?:Array, categoryIds?:Array|string}} input
 */
function evaluateProfessionalDraft(input) {
  var opts = input || {};
  var formData = opts.formData || {};
  var pendingMaterials = opts.pendingMaterials || [];
  var chapterStates = chapterStatesOf(formData);
  var defaultAnchor = defaultAnchorFor(formData.productType, opts.clubId);
  // 页面把 data.selectedCategoryIds 传进来;没传时退到 formData.categoryIds(草稿恢复路径上
  // 只有这个),两者都是空的才算「没选类别」。
  var categoryIds = opts.categoryIds === undefined ? formData.categoryIds : opts.categoryIds;
  var blockingIssues = blockingIssuesOf(formData, pendingMaterials, chapterStates, categoryIds);

  return {
    defaultAnchor: defaultAnchor,
    // 只在空草稿时给起手动作;有内容之后靠章节卡状态标记,不做全局「推荐下一步」。
    // 2026-08-21 扩展:另有一张「创作四步」引导卡(utils/publish/guide-progress.js),
    // 有内容后仍可见 —— 因为四步的勾(拍照/查资料等)必须等部分内容出现才能逐个点亮,
    // 只在空草稿显示就永远见不到自己的进度。它保持非强制:可收起、全 done 自动消失、
    // 不锁顺序,和这里「不做全局推荐下一步」的原则并存(清单 ≠ 推荐动作)。
    starterAction: isBlankDraft(formData, pendingMaterials) ? starterActionFor(defaultAnchor) : null,
    chapterStates: chapterStates,
    blockingIssues: blockingIssues,
    creativeComplete: blockingIssues.length === 0,
    // UI 层的意图开关。真正决定是否走招商链路的是后端看 recruitDeadline 有没有值,
    // 所以开关开启时页面必须保证 recruitDeadline 被填写并上送。
    merchantRequired: !!formData.openMerchantPool,
  };
}

module.exports = {
  evaluateProfessionalDraft: evaluateProfessionalDraft,
  defaultAnchorFor: defaultAnchorFor,
  chapterStatesOf: chapterStatesOf,
  hasRealStory: hasRealStory,
  hasUsableCoords: hasUsableCoords,
  formalNodeCreationIssue: formalNodeCreationIssue,
};
