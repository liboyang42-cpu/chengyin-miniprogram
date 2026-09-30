// 发布器「发布前校验」的纯函数。从 pages/publish/fabu/index.js 的 _buildValidationBag 抽出
// (与 publish-stats.js / route-map-view.js 同一手法:无 wx / 无 this / 无副作用,可直接单测)。
//
// 抽它的理由:这 100 行是**决定一条路线能不能发出去**的全部判据 —— 票价负数、
// 节点没选地点、招商名额越界、分支图死路……每一条都是「漏判就把脏数据放进生产」的规则,
// 而它此前一行测试都没有,因为它埋在页面方法里、依赖 this.data 和 4 个页面私有方法。
//
// 页面侧的 4 个路线图相关方法(_routeGraph / _routeNodes() / _routeSavedTicketOptions() /
// _routeSimulationReport())由调用方先算好、以显式入参传入,模块本身不碰 this。
// 判据顺序与文案与原内联实现逐字一致 —— 顺序会影响 bag 里第一条错误是哪条,不能动。

const { createErrorBag, nonEmpty } = require('./publish-validator.js');
const { cityOrientationScheduleIssues } = require('./publish-ticket-schedule.js');
const proEditorPolicy = require('../../../../utils/publish/pro-editor-policy.js');
const topicRouteGraph = require('./topic-route-graph.js');

/**
 * @param {object} state 页面显式传入的数据切片
 * @returns {object} errorBag,由调用方决定怎么呈现
 */
function buildValidationBag(state) {
  state = state || {};
    const formData = state.formData || {};
    const selectedCategoryIds = state.selectedCategoryIds || [];
    const bag = createErrorBag();

    // CU-C-159:这四条在发布前检查里显示,同页编辑器与「自动检查已通过」清单
    // (_buildPublishPassed)都称主题 —— 编辑器叫「主题名称/主题简介/主题封面/主题类别」,
    // 缺项却叫「路线」。同一个对象跨两屏换名字,用户会以为要去别处另找一条路线来填。
    // 名称与 _buildPublishPassed 逐项对齐,不要再造第二套叫法。
    bag.require(nonEmpty(formData.name), 'name', '请填写主题名称');
    bag.require(nonEmpty(formData.description), 'description', '请填写主题简介');
    bag.require(nonEmpty(formData.startDate) && state.startDateTime !== '开始时间', 'startDate', '请选择开始时间');
    bag.require(nonEmpty(formData.endDate) && state.endDateTime !== '结束时间', 'endDate', '请选择结束时间');
    bag.require(nonEmpty(formData.imgUrl), 'imgUrl', '请上传主题封面');
    bag.require(selectedCategoryIds.length > 0, 'categoryIds', '请选择至少一个主题类别');
    const freeExplore = Number(formData.productType) === 2;
    if (freeExplore) {
      bag.require(nonEmpty(formData.recruitDeadline), 'recruitDeadline', '请选择招商截止日期');
    } else if (state.completionRuleMode === 'AT_LEAST') {
      const totalNodes = (formData.chapters || []).reduce(
        (sum, chapter) => sum + ((chapter.nodes || []).length), 0);
      const required = Number(state.completionRequiredCount);
      bag.require(Number.isInteger(required) && required >= 1 && required <= totalNodes,
        'completionRule', '必达数不能超过节点总数');
    }
    if (!freeExplore && formData.routeMode === 'BRANCH_GRAPH') {
      const routeValidation = topicRouteGraph.validate(state.routeGraph, state.routeNodes || [], {
        allowedTicketIds: (state.savedTicketOptions || []).map((ticket) => ticket.id)
      });
      bag.require(routeValidation.valid, 'routeGraph', routeValidation.errors[0]
        ? routeValidation.errors[0].message : '分支路线配置不完整');
      if (routeValidation.valid) {
        // 惰性求值:模拟跑 1000 轮,图校验没过时原实现压根不跑它。
        // 若在调用方提前算好传进来,每次校验(输入时也会触发)都会白跑一遍 1000 轮模拟。
        const simulation = (typeof state.routeSimulationReport === 'function'
          ? state.routeSimulationReport() : state.routeSimulationReport) || {};
        bag.require(simulation.releaseReady, 'routeGraph', simulation.deadEnds
          ? '路线模拟存在无候选死路'
          : (simulation.infiniteLoops ? '路线模拟存在非预期无限环' : '存在模拟未覆盖的路线边'));
      }
    }

    const editorPolicy = proEditorPolicy.evaluateProfessionalDraft({
      formData,
      clubId: formData.clubId,
      pendingMaterials: state.pendingMaterials,
      categoryIds: selectedCategoryIds,
    });
    editorPolicy.blockingIssues.forEach((issue) => {
      if (issue.key === 'pendingMaterials') {
        bag.add('pendingMaterials', issue.message);
      } else if (issue.chapterIndex != null && /缺少剧情/.test(issue.message)) {
        bag.add('chapterStory' + issue.chapterIndex, issue.message);
      }
    });

    // 验证票务信息(价格/集合地点/票单时间为本页专有规则,逐票交错顺序保持原样)
    (formData.tickets || []).forEach((ticket, index) => {
      bag.require(nonEmpty(ticket.name), `ticketName${index}`, '请填写票单名称', `第${index + 1}个票务：请填写票单名称`);
      if (ticket.price === undefined || ticket.price === null || ticket.price === '') {
        bag.add(`ticketPrice${index}`, '请填写票价', `第${index + 1}个票务：请填写票价`);
      } else if (ticket.price < 0) {
        bag.add(`ticketPrice${index}`, '价格不能为负数', `第${index + 1}个票务：价格不能为负数`);
      }
      if (Number(ticket.mode) === 1) {
        cityOrientationScheduleIssues(ticket).forEach(issue => {
          bag.add(`ticket${issue.field === 'startTime' ? 'Start' : 'End'}${index}`, issue.message, `第${index + 1}个票务：${issue.message}`);
        });
        bag.require(nonEmpty(ticket.meetingPoint), `ticketMeeting${index}`, '请填写集合地点', `第${index + 1}个票务：请填写集合地点`);
      } else {
        bag.require(nonEmpty(ticket.startTime), `ticketStart${index}`, '请填写票单开始日期', `第${index + 1}个票务：请填写票单开始日期`);
        bag.require(nonEmpty(ticket.endTime), `ticketEnd${index}`, '请填写票单结束日期', `第${index + 1}个票务：请填写票单结束日期`);
      }
    });

    // 验证章节和节点
    if (!formData.chapters || formData.chapters.length === 0) {
      bag.add('chapters', '请至少添加一个章节');
    } else {
      formData.chapters.forEach((chapter, chapterIndex) => {
        bag.require(chapter.nodes && chapter.nodes.length > 0, `chapter${chapterIndex}`, `第${chapterIndex + 1}章至少需要一个节点`);
        // 没坐标的节点在地图上不存在、玩家走不到 —— 原先只有「下一步」那道闸查坐标(还只要求
        // 全局 ≥1 个),发布校验压根不查,于是能带着一堆没定位的节点发出去。
        (chapter.nodes || []).forEach((node, nodeIndex) => {
          bag.require(proEditorPolicy.hasUsableCoords(node), `chapter${chapterIndex}`,
            `第${chapterIndex + 1}章第${nodeIndex + 1}个节点还没有选地点`);
        });
        if (Number(formData.productType) === 2 && Number(chapter.recruitEnabled) === 1) {
          bag.require(Number(chapter.categoryId) > 0, `chapterRecruitCategory${chapterIndex}`,
            `第${chapterIndex + 1}章请选择适合商家品类`);
          bag.require(chapter.termsMode === 'PERK' || chapter.termsMode === 'TRAFFIC',
            `chapterRecruitTerms${chapterIndex}`, `第${chapterIndex + 1}章请选择合作方式`);
          if (chapter.termsMode === 'PERK' && chapter.perkMinValue !== null
              && chapter.perkMinValue !== undefined && chapter.perkMinValue !== '') {
            const perkMinValue = Number(chapter.perkMinValue);
            bag.require(Number.isFinite(perkMinValue) && perkMinValue > 0,
              `chapterRecruitPerkMin${chapterIndex}`, `第${chapterIndex + 1}章权益最低价值须为大于0的金额`);
          }
          const maxMerchant = Number(chapter.maxMerchant);
          bag.require(Number.isInteger(maxMerchant) && maxMerchant >= 0 && maxMerchant <= 127,
            `chapterRecruitMax${chapterIndex}`, `第${chapterIndex + 1}章商家名额请输入0到127之间的整数`);
        }
      });
    }

    return bag;
}

module.exports = { buildValidationBag: buildValidationBag };
