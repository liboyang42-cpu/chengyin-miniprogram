// cy-chapter-target-picker · 选承接标的(Figma F3 159:346)。
//
// 稿把「选哪一章 + 用哪个玩法」收成一个 T1 弹层,两组都横滑,底部一个「下一步 · 填报名」。
// 现码原来是两步散开的:wx.showActionSheet 选章节(系统列表,看不到章节还缺几家),
// 玩法在下一页的 cy-dropdown 里选 —— 商家得先盲选章节才知道里面能配什么玩法。
//
// ⚠️ 章节卡的副信息**不是**稿上那句「09-10 起」:CmsTopicChapter 与 TopicTemplateRecruitVO
//    都没有章节开始时间字段,后端给不出来。这里改用真实存在的招商事实
//    (remainingMerchantCount「还缺 N 家」),拿不到就不显示 —— 不编一个日期。
//    这条已记进 Figma 代码待改表。
const app = getApp();

function text(v) {
  return v === 0 ? '0' : String(v == null ? '' : v).trim();
}

/** imgUrl 可能是逗号分隔的多图,取第一张 */
function firstImg(value) {
  const first = String(value || '').split(',')[0];
  return first.trim();
}

/** 章节卡的副信息:只说后端真给了的事实 */
function chapterSub(chapter) {
  const recruit = (chapter && chapter.recruitStatus) || {};
  const remaining = Number(recruit.remainingMerchantCount);
  if (Number.isFinite(remaining) && remaining > 0) return '还缺 ' + remaining + ' 家';
  if (Number.isFinite(remaining) && remaining === 0) return '名额已满';
  return '';
}

/* 选中章节的招募事实。这六条原来印在旧弹层的每张章节卡上 —— 稿 159:346 的卡只有
   140×60(名称 + 一行副信息),六条塞不进去,但它们是商家决定要不要接的依据(尤其条款
   和权益门槛),不能因为卡变小就没了。所以改成「选中之后在下面列出来」。 */
function factsOf(row) {
  const c = (row && row.raw) || {};
  return [c.categoryLabel, c.requiredLabel, c.termsLabel, c.boundaryLabel,
          c.merchantLimitLabel, c.perkMinValueLabel].filter((v) => text(v));
}

Component({
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false },
    // 宿主已经拉好的可申请章节(recruitStatus.isOpen === true 那批)
    chapters: { type: Array, value: [] },
    /* 章节这一侧的取数状态由宿主给:loading / error / category-missing / ready。
       没有它,「还没拉到」和「一章都没开放」会印同一句话 —— 后者会让商家以为
       这条路线不招商就退出去了。 */
    chaptersState: { type: String, value: 'ready' },
    chaptersError: { type: String, value: '' },
    // 招商窗口关着时能看不能投:按钮置灰并说明原因,而不是让人填完才被拒
    applicationOpen: { type: Boolean, value: true },
    submitting: { type: Boolean, value: false },
  },
  data: {
    rows: [],
    templates: [],
    templatesState: 'idle',   // idle | loading | ready | error | empty
    templatesError: '',
    pickedChapterId: 0,
    pickedTemplateId: 0,
    // 选中章节的招募事实(品类 / 必选 / 条款 / 边界 / 名额 / 权益门槛),由宿主算好挂在章节上
    pickedFacts: [],
  },
  observers: {
    'show, chapters': function (show, chapters) {
      if (!show) return;
      const rows = (chapters || []).filter((c) => c && c.id).map((c) => ({
        id: c.id,
        name: text(c.name) || '未命名章节',
        sub: chapterSub(c),
        raw: c,
      }));
      // 只有一章时直接选中:再让人点一次没有信息量
      const pickedChapterId = rows.length === 1 ? rows[0].id : this.data.pickedChapterId;
      this.setData({
        rows,
        pickedChapterId,
        pickedFacts: factsOf(rows.filter((r) => r.id === pickedChapterId)[0]),
      });
      if (this.data.templatesState === 'idle' || this.data.templatesState === 'error') this.loadTemplates();
    },
  },
  methods: {
    /* 我已有的玩法模板。与 chapter-node-form 同一条 /api/template/my-list ——
       两处必须是同一份「我能用哪些玩法」的定义,否则这里选得到、下一页却选不到。 */
    loadTemplates() {
      if (this.data.templatesState === 'loading') return;
      const that = this;
      this.setData({ templatesState: 'loading', templatesError: '' });
      app.sendRequest({
        url: '/api/template/my-list', method: 'POST', hideLoading: true, silentError: true,
        data: { scope: 'MERCHANT' },
        success(res) {
          const rows = res && res.code == '200' && res.data && Array.isArray(res.data.rows)
            ? res.data.rows.filter((t) => t && t.id && text(t.title)) : null;
          if (!rows) {
            // 读不到 ≠ 一个玩法都没有。两者要分开,否则商家会去重新建一个已经有的玩法。
            that.setData({
              templatesState: 'error',
              templatesError: app.getRequestErrorMessage(res, '玩法模板没读出来'),
            });
            return;
          }
          that.setData({
            templates: rows.map((t) => ({
              id: t.id,
              title: text(t.title),
              sub: text(t.description),
              // 稿 159:346 的玩法卡主体是**封面方图**,文字在图下方;
              // 没有封面的才退回首字母占位块 —— 不留一个空方块
              cover: firstImg(t.imgUrl),
              initial: text(t.title).slice(0, 1),
            })),
            templatesState: rows.length ? 'ready' : 'empty',
            templatesError: '',
          });
        },
        fail(res) {
          that.setData({
            templatesState: 'error',
            templatesError: app.getRequestErrorMessage(res, '玩法模板没读出来，检查网络后重试'),
          });
        },
      });
    },

    onPickChapter(e) {
      if (this.data.submitting) return;
      const id = Number(e.currentTarget.dataset.id) || 0;
      this.setData({ pickedChapterId: id, pickedFacts: factsOf(this.data.rows.filter((r) => r.id === id)[0]) });
    },
    onPickTemplate(e) {
      if (this.data.submitting) return;
      this.setData({ pickedTemplateId: Number(e.currentTarget.dataset.id) || 0 });
    },
    onClose() {
      if (this.data.submitting) return;
      this.triggerEvent('close', {});
    },
    goCreateTemplate() {
      this.triggerEvent('createtemplate', {});
    },
    onRetryChapters() {
      this.triggerEvent('retrychapters', {});
    },
    onGoCategory() {
      this.triggerEvent('gocategory', {});
    },
    onNext() {
      const chapter = this.data.rows.filter((r) => r.id === this.data.pickedChapterId)[0];
      if (!chapter) return;
      const template = this.data.templates.filter((t) => t.id === this.data.pickedTemplateId)[0] || null;
      this.triggerEvent('confirm', {
        chapter: chapter.raw,
        chapterId: chapter.id,
        chapterName: chapter.name,
        templateId: template ? template.id : 0,
        templateName: template ? template.title : '',
      });
    },
  },
});
