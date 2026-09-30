const modal = require('../../../utils/modal.js');
const cyToast = require('../../../utils/toast.js');
const { isAlbumTemplate, ALBUM_ONLY_IN_STORY } = require('../../../utils/album-template.js');
const app = getApp()
/* 结果面板终态停留时长;跳转挂在面板 close 上,时长只此一处 */
const RESULT_SHEET_MS = 2000
/* CU-M-05 商家主办免费场的文案单一真源:票务步的常驻说明与提交时的拦截共用这一句,
   不然是两处各写一遍,改一处漏一处。 */
const MERCHANT_FREE_ONLY_MSG = '商家主办活动还没开通收款，票价只能是 0'
const analytics = require('../../../utils/analytics.js')
const { createErrorBag, nonEmpty } = require('../utils/publish/publish-validator.js')
const { createPublishWorkflow } = require('../utils/publish/publish-workflow.js')
const { pickLocation } = require('../../../utils/location/location-manager.js')
const { resolveStepOfField, clampStep, buildProgress } = require('../utils/publish/step-form.js')
const { isRecord, isRecordList } = require('../../../utils/response-shape.js')
const { sendUiStateRequest } = require('../../../utils/ui-state-request.js')
const merchantAccessPolicy = require('../../../utils/merchant-access-policy.js')

// 时/分选项与 HH:mm 格式化的单一真源(补零口径全仓一致)
const timeOptions = require('../../../utils/time-picker-options.js');
// 处方 I:每屏一组。步只管展示层分组,字段语义与提交接口一字未改。
/* 稿 J4 / N6 / N7 / N8:每一屏顶上是一个**问句**(「这场活动叫什么?」「用哪个玩法?」
   「这场活动怎么卖票?」「什么时候开始?」),进度点只是位置指示。
   现码只有进度点上的字段名(基本信息 / 活动内容 / 票务与合作)—— 那是给填表人看的分类,
   不是在跟他说话;每屏一组的排法本来就是为了「一次只问一件事」,缺了问句这层就白排了。
   ⚠️ 稿分了四屏(名称 / 玩法 / 票 / 时间),现码是三步(时间并在第一步)。
      这里不动分步,只把每一步的问句按它**实际问的内容**写 —— 照抄稿的四句会
      在第一步承诺「只问名字」,而那一屏还要填地点和时间。 */
const STEPS = [
  { key: 'basic', title: '基本信息', heading: '这场活动叫什么、在哪儿办？',
    fields: ['name', 'addressName', 'startDate', 'endDate', 'categoryIds'] },
  { key: 'content', title: '活动内容', heading: '这场活动玩什么？',
    fields: ['description', 'imgUrl', 'templateId'] },
  { key: 'ticket', title: '票务与合作', heading: '这场活动怎么卖票？',
    fields: ['ticket*'] },
]

function coverReady(data) {
  return nonEmpty(data.formData.imgUrl)
    && !data.coverUploading
    && !(data.coverErrorIndexes || []).length
}

Page({
  data: {
    // 日期选择
    startdate: '开始日期',
    enddate: '结束日期',

    // 模板选择相关
    tempList: [], // 模板列表
    searchKeyword: '', // 搜索关键词
    popTemp: false,
    selectedTempId: null, // 当前选中的模板ID
    selectedTempInfo: null, // 选中的模板完整信息

    // 活动类型选择 - 多选相关
    selectedCategoryIds: [], // 选中的分类ID数组
    selectedCategoryNames: [], // 选中的分类名称数组
    categorySheetVisible: false,
    categorySheetIds: '',
    selectedCategoryNamesStr: '', // 选中的分类名称字符串，用于显示
    categoryList: [],

    errors: {},
    submitting: false,
    submitError: '',
    dirty: false,
    accessState: 'checking',
    accessError: '',
    templateLoadState: 'idle',
    templateError: '',
    ownerLoadError: '',
    publishedActivityId: null,
    resultSheet: { show: false, kind: 'success', title: '', sub: '', meta: '', pill: '',
      why: '', duration: 2000 },
    pageTitle: '发布活动',
    submitLabel: '发布',
    // CU-M-05 商家主办:scope=MERCHANT 从品牌中心/我的项目(商家)带进来。
    // merchantHost 只决定「问哪个接口、说什么话」,放行与否一律由权威回包判(见 guardPublisherRole)。
    merchantHost: false,
    merchantFreeOnlyMsg: MERCHANT_FREE_ONLY_MSG,
    deniedReason: '发布单场活动需要俱乐部主理人身份。',
    activityLoadError: '',
    editingActivityId: 0,
    // CR-63(裁决 15):已售出(有已支付报名)的活动时间与地点锁死 —— 服务端为准,
    // 这里只负责置灰 + 说明原因;加载详情时由服务端 timeLocationLocked 回填。
    timeLocationLocked: false,
    // 合作者半屏选择器(cy-collaborator-picker)
    collaboratorPickerShow: false,
    collaboratorPickerIds: '',
    coverUploading: false,
    coverErrorIndexes: [],
    step: 0,
    progress: buildProgress(STEPS, 0),
    stepHeading: STEPS[0].heading,
    focusField: '',
    canContinue: false,
    // 表单数据
    formData: {
      name: '', // 活动标题
      addressName: '', // 活动地点
      longitude: '', // 地址经度
      latitude: '', // 地址纬度
      address: '', // 详细地址
      description: '', // 活动说明
      startDate: '', // 开始日期
      endDate: '', // 结束日期
      categoryIds: [], // 活动类型ID数组（改为数组）
      templateId: 0, // 模板ID
      imgUrl: '', // 活动封面
      collaboratorList: [], // 合作者列表
      collaborators: [], // 合作者ID数组
      tickets: [ // 票务信息 - 初始一个空票单
        {
          name: '',
          price: 0,
          totalStock: 0,
          description: '',
          startTime: '',
          endTime: ''
        }
      ]
    },

    // 活动起止时间在同一面板内编辑。索引与 preview 都是草稿，最终“完成”才写 formData。
    timePicker: {
      show: false,
      active: 'start',
      endUnlocked: false
    },
    timePickerStartPreview: '未设置',
    timePickerEndPreview: '未设置',
    startDateIndex: [0],
    startTimeIndex: [9, 0],
    endDateIndex: [0],
    endTimeIndex: [18, 0],
    
    // 时间选择相关
    dateList: [], // 日期列表（今天至30天内）
    hours: timeOptions.HOURS,     // '00'..'23'
    minutes: timeOptions.MINUTES, // '00'..'59'
  },

  // 分类选择弹窗化(2026-07-31):半屏 cy-category-sheet + 事件回传,不再跳转独立页面
  navigateToCategorySelect: function () {
    this.setData({
      categorySheetVisible: true,
      categorySheetIds: this.data.selectedCategoryIds.join(','),
      // 与合作者选择器互斥。两者都套 cy-sheet、同吃 --cy-z-sheet(800),谁盖谁只由 DOM 顺序决定。
      // 2026-08-01 automator 实测:同时 show 时 DOM 里能查到 2 个各自带 sh__mask 的 cy-sheet,
      // 两块 panel 几乎完全重叠(合作者 top=377/h=467、分类 top=387/h=457,都贴底 844),
      // 叠成两层全屏遮罩,下层面板被夹在遮罩之间发暗、顶部还露出约 10px。
      // 此前摸不到只是因为先开那个的全屏遮罩顺带挡住了另一个入口,不是代码级互斥 —— 这里把闸写进代码。
      collaboratorPickerShow: false,
    });
  },

  onCategorySelect: function (e) {
    this.updateCategorySelection(e.detail.selectedIds, e.detail.selectedCategories);
  },

  onCategorySheetClose: function () {
    this.setData({ categorySheetVisible: false });
  },

  // 从分类选择弹窗回调更新选择 - 需要同时接收ID和名称
  updateCategorySelection: function (selectedIds, selectedCategories) {
    const that = this;

    const selectedCategoryIds = selectedIds || [];
    const selectedCategoryNames = selectedCategories ? selectedCategories.map(item => item.categoryName) : [];
    const selectedCategoryNamesStr = selectedCategoryNames.join('，');

    that.data.dirty = true;
    that.setData({
      selectedCategoryIds: selectedCategoryIds,
      selectedCategoryNames: selectedCategoryNames,
      selectedCategoryNamesStr: selectedCategoryNamesStr,
      'formData.categoryIds': selectedCategoryIds,
      categoryList: selectedCategories || []
    }, () => that.refreshPrimaryActionState());

  },

  // 封面上传:响应 cy-upload 的 add/remove/preview 事件(选图裁剪逻辑不变,组件只管展示)
  onCoverAdd: function () {
    var that = this;
    app.chooseImage(function (res) {
      that.data.dirty = true;
      that._coverTempPath = '';
      that.setData({
        'formData.imgUrl': res[0], coverUploading: false, coverErrorIndexes: []
      }, () => that.refreshPrimaryActionState())
    }, 1, {
      crop: true,
      cropScale: '16:9',
      onUploadStart() {
        that.setData({ coverUploading: true, coverErrorIndexes: [] }, () => that.refreshPrimaryActionState());
      },
      onUploadDone(r, filePaths) {
        if (r.ok) return false;
        that._coverTempPath = filePaths[0] || '';
        that.setData({
          'formData.imgUrl': that._coverTempPath,
          coverUploading: false,
          coverErrorIndexes: that._coverTempPath ? [0] : [],
        }, () => that.refreshPrimaryActionState());
        return true;
      },
    });
  },
  retryCoverUpload() {
    const path = this._coverTempPath;
    if (!path || this.data.coverUploading) return;
    this.setData({ coverUploading: true, coverErrorIndexes: [] }, () => this.refreshPrimaryActionState());
    app.getUploadClient().uploadAll([path], {
      bizType: 'image_16_9',
      onDone: (r) => {
        if (r.ok && r.results[0]) {
          this._coverTempPath = '';
          this.setData({ 'formData.imgUrl': r.results[0], coverUploading: false, coverErrorIndexes: [] }, () => this.refreshPrimaryActionState());
        } else {
          this.setData({ coverUploading: false, coverErrorIndexes: [0] }, () => this.refreshPrimaryActionState());
        }
      },
    });
  },
  onCoverRemove: function () {
    this._coverTempPath = '';
    this.data.dirty = true;
    this.setData({ 'formData.imgUrl': '', coverUploading: false, coverErrorIndexes: [] }, () => this.refreshPrimaryActionState());
  },
  onCoverPreview: function () {
    if (this.data.formData.imgUrl) wx.previewImage({ urls: [this.data.formData.imgUrl] });
  },

  // 输入框变化处理
  onInputChange(e) {
    const { field } = e.currentTarget.dataset
    this.data.dirty = true
    this.setData({
      [`formData.${field}`]: e.detail.value,
      [`errors.${field}`]: '',
      submitError: ''
    }, () => this.refreshPrimaryActionState())
  },

  // 票务信息变化处理
  onTicketChange(e) {
    const { field, index } = e.currentTarget.dataset
    const value = e.detail.value

    this.data.dirty = true
    const fieldValue = field === 'price' || field === 'totalStock' ? Number(value) : value
    if (field === 'name') {
      this.setData({
        [`formData.tickets[${index}].${field}`]: fieldValue,
        [`errors.ticketName${index}`]: '',
        submitError: ''
      }, () => this.refreshPrimaryActionState())
    } else if (field === 'totalStock') {
      this.setData({
        [`formData.tickets[${index}].${field}`]: fieldValue,
        [`errors.ticketStock${index}`]: '',
        submitError: ''
      }, () => this.refreshPrimaryActionState())
    } else {
      this.setData({
        [`formData.tickets[${index}].${field}`]: fieldValue,
        submitError: ''
      }, () => this.refreshPrimaryActionState())
    }
  },

  clearFormField(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    if (ds.ticketIndex !== undefined && ds.ticketIndex !== '') {
      const index = Number(ds.ticketIndex)
      const field = ds.ticketField
      this.setData({
        [`formData.tickets[${index}].${field}`]: field === 'totalStock' ? 0 : '',
        [`errors.${ds.errorKey}`]: '',
        submitError: ''
      }, () => this.refreshPrimaryActionState())
    } else if (ds.field) {
      this.setData({
        [`formData.${ds.field}`]: '',
        [`errors.${ds.field}`]: '',
        submitError: ''
      }, () => this.refreshPrimaryActionState())
    }
    this.data.dirty = true
  },

  // 添加票单
  addTicket() {
    const { tickets } = this.data.formData
    const newTickets = [...tickets, {
      name: '',
      price: 0,
      totalStock: 0,
      description: '',
      startTime: '',
      endTime: ''
    }]

    this.data.dirty = true
    this.setData({
      'formData.tickets': newTickets
    }, () => this.refreshPrimaryActionState())
  },

  // 删除票单
  removeTicket(e) {
    const { index } = e.currentTarget.dataset
    const { tickets } = this.data.formData

    if (tickets.length <= 1) {
      cyToast('至少保留一个票单')
      return
    }

    const newTickets = tickets.filter((_, i) => i !== index)
    this.data.dirty = true
    this.setData({
      'formData.tickets': newTickets
    }, () => this.refreshPrimaryActionState())
  },

  // 表单验证(错误累积/顺序/首错聚焦走共享 publish-validator,字段/文案/scrollToError 保持本页口径)
  refreshPrimaryActionState() {
    const d = this.data;
    const f = d.formData;
    const errors = Object.assign({}, d.errors || {});
    let errorsChanged = false;
    const clearError = (key, valid) => {
      if (valid && errors[key]) { delete errors[key]; errorsChanged = true; }
    };
    clearError('name', nonEmpty(f.name));
    clearError('addressName', nonEmpty(f.addressName));
    clearError('description', nonEmpty(f.description));
    clearError('startDate', nonEmpty(f.startDate, '开始日期'));
    clearError('endDate', nonEmpty(f.endDate, '结束日期'));
    clearError('templateId', Number(f.templateId) > 0);
    clearError('imgUrl', coverReady(d));
    clearError('categoryIds', d.selectedCategoryIds.length > 0);
    f.tickets.forEach((ticket, index) => {
      clearError(`ticketName${index}`, nonEmpty(ticket.name));
      clearError(`ticketStock${index}`, Number(ticket.totalStock) > 0);
    });
    const canContinue = this.stepIsComplete(d.step, d);
    const dateText = nonEmpty(f.startDate, '开始日期') && nonEmpty(f.endDate, '结束日期')
      ? `${f.startDate} 至 ${f.endDate}` : '时间待补充';
    const publishSummary = `${f.name || '未命名活动'}，${dateText}，地点：${f.addressName || '待选择'}，共 ${f.tickets.length} 种票单。`;
    if (errorsChanged || canContinue !== d.canContinue || publishSummary !== d.publishSummary) {
      this.setData({ errors, canContinue, publishSummary });
    }
  },

  // 每一步「能不能往下走」的判据。原来这份判据只活在下一步按钮里,草稿续写落哪一步
  // 于是无从判断(恒从第 0 步重新点回去)。两处共用一份,免得日后分叉。
  stepIsComplete(step, d) {
    const f = d.formData;
    if (step === 0) {
      return nonEmpty(f.name) && nonEmpty(f.addressName)
        && nonEmpty(f.startDate, '开始日期') && nonEmpty(f.endDate, '结束日期')
        && d.selectedCategoryIds.length > 0;
    }
    if (step === 1) {
      return nonEmpty(f.description) && coverReady(d) && Number(f.templateId) > 0;
    }
    return f.tickets.length > 0
      && f.tickets.every((ticket) => nonEmpty(ticket.name) && Number(ticket.totalStock) > 0);
  },

  // 草稿/驳回件回填完停在「还没填完的那一步」;都填完了停在最后一屏(那儿才是保存动作)。
  // 只定位一次,否则用户自己翻回前面看内容会被拽走。
  resumeAtFirstIncompleteStep() {
    if (this._stepResumed) return;
    this._stepResumed = true;
    let target = STEPS.length - 1;
    for (let i = 0; i < STEPS.length; i += 1) {
      if (!this.stepIsComplete(i, this.data)) { target = i; break; }
    }
    if (target !== this.data.step) this.goStep(target);
  },

  validateForm() {
    const { formData, selectedCategoryIds } = this.data
    const bag = createErrorBag()

    bag.require(nonEmpty(formData.name), 'name', '请填写活动标题')
    bag.require(nonEmpty(formData.addressName), 'addressName', '请填写活动地点')
    bag.require(nonEmpty(formData.description), 'description', '请填写活动说明')
    bag.require(nonEmpty(formData.startDate, '开始日期'), 'startDate', '请选择开始日期')
    bag.require(nonEmpty(formData.endDate, '结束日期'), 'endDate', '请选择结束日期')
    bag.require(!!formData.templateId && formData.templateId !== 0, 'templateId', '请选择模板')
    bag.require(coverReady(this.data), 'imgUrl', nonEmpty(formData.imgUrl)
      ? '封面上传未完成，请重试或删除' : '请上传活动封面')
    bag.require(selectedCategoryIds.length > 0, 'categoryIds', '请选择至少一个活动类型')

    formData.tickets.forEach((ticket, index) => {
      bag.require(nonEmpty(ticket.name), `ticketName${index}`, '请填写票单名称')
      bag.require(ticket.totalStock > 0, `ticketStock${index}`, '请填写有效的库存数量')
    })

    this.setData({ errors: bag.errors })
    if (!bag.isValid()) {
      this.scrollToError(bag.firstKey())
    }
    return bag.isValid()
  },

  // 聚焦态只驱动边框样式,不参与任何取值/提交逻辑
  onFieldFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    this.setData({ focusField: ds.focuskey || ds.field || '' })
  },

  onFieldBlur() {
    this.setData({ focusField: '' })
  },

  goStep(next) {
    const step = clampStep(STEPS, next)
    this.setData({ step, progress: buildProgress(STEPS, step), stepHeading: (STEPS[step] || {}).heading || '' }, () => this.refreshPrimaryActionState())
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  prevStep() { this.goStep(this.data.step - 1) },

  nextStep() {
    if (!this.data.canContinue) return
    this.goStep(this.data.step + 1)
  },

  // 置灰的「下一步/发布」被点 → 走同款 validateForm:缺项落红字 + 滚到第一处,
  // 别让按钮静默地按不动(其余步的红字挂在未挂载的分步块上,不会串屏)。
  onContinueDisabledTap() {
    this.validateForm()
  },

  scrollToError(key) {
    const selectorMap = {
      name: '#field-name',
      addressName: '#field-address',
      startDate: '#field-date',
      endDate: '#field-date',
      categoryIds: '#field-category',
      description: '#field-description',
      imgUrl: '#field-cover',
      templateId: '#field-template'
    }
    const selector = selectorMap[key] || (key.indexOf('ticket') === 0 ? '#field-ticket' : '')
    if (!selector) return
    // 步进化后错误字段可能不在当前步:必须先切到它所在的那一步,
    // 否则选择器压根不在页面上,pageScrollTo 会静默无效 = 用户只看到一句吐司却找不到错在哪。
    const target = resolveStepOfField(STEPS, key)
    if (target >= 0 && target !== this.data.step) {
      this.setData({ step: target, progress: buildProgress(STEPS, target) })
    }
    setTimeout(() => {
      wx.pageScrollTo({ selector, duration: 250, offsetTop: 24 })
    }, 60)
  },

  // 提交表单
  submitForm() {
    // 防重复发布:发布键收编 cy-btn 后视觉 disabled 不拦点击,提交中须早退(原靠原生 <button disabled> 拦)
    if (this.data.submitting) return;
    if (!this.validateForm()) {
      cyToast('请完善表单信息')
      return
    }
    if (this.data.merchantHost && this.hasPaidTicket()) {
      cyToast(MERCHANT_FREE_ONLY_MSG)
      return
    }

    this.setData({ submitError: '' })

    const apiData = {
      name: this.data.formData.name,
      description: this.data.formData.description,
      imgUrl: this.data.formData.imgUrl,
      imgArr: this.data.formData.imgUrl,
      categoryIds: this.data.selectedCategoryIds.join(','),
      addressName: this.data.formData.addressName,
      longitude: this.data.formData.longitude,
      latitude: this.data.formData.latitude,
      address: this.data.formData.address,
      startDate: this.data.formData.startDate, // 格式：2025-11-19 09:00:00
      endDate: this.data.formData.endDate, // 格式：2025-11-19 18:00:00
      templateId: this.data.formData.templateId,
      collaborators: this.data.formData.collaborators,
      tickets: this.data.formData.tickets.map(ticket => ({
        ...ticket,
        startTime: this.data.formData.startDate,
        endTime: this.data.formData.endDate
      }))
    }
    if (this.editingActivityId) {
      apiData.id = this.editingActivityId
    }
    // 主办身份跟着写进 body,后端据此把活动落到商家主体名下(不按「谁点的发布」记主办)。
    if (this.data.merchantHost) {
      apiData.scope = 'MERCHANT'
    }

    this.sendData(apiData)
  },

  /* CU-M-05 收款缺口:全仓没有 sub_mchid,下单一律进平台商户号,商家主办收钱等于替平台收。
     9-15 定稿「钱进商家子商户号」尚未落地 ⇒ 商家这一路先只放开免费场。这是真闸不是提示:
     服务端同样拒(见 ApiActivityController#merchantHostViolation),客户端提前挡是为了当场看得见。 */
  hasPaidTicket() {
    return (this.data.formData.tickets || []).some(function (ticket) {
      return Number(ticket && ticket.price) > 0
    })
  },

  // 发布提交状态机(防重/失败回退/销毁守卫走共享 publish-workflow;url/analytics/toast/跳转保持本页)
  getPublishWorkflow() {
    if (!this._publishWorkflow) {
      this._publishWorkflow = createPublishWorkflow({
        request: (payload, cb) => {
          const options = {
            data: JSON.stringify(payload),
            method: "POST",
            header: {
              'Content-Type': 'application/json'
            },
            success: (res) => {
              if (res.code == "200") cb({ ok: true, data: res.data })
              else cb({ ok: false, msg: res.msg })
            },
            fail: () => cb({ ok: false, networkError: true })
          }
          if (this.editingActivityId) {
            sendUiStateRequest(app, '/api/activity/update', options)
          } else {
            sendUiStateRequest(app, '/api/activity/publish', options)
          }
        }
      })
    }
    return this._publishWorkflow
  },

  // 发送数据到API
  sendData(data) {
    const that = this
    const started = that.getPublishWorkflow().submit(data, {
      onSuccess: (resData) => {
        const activityId = that.editingActivityId
          || (resData && typeof resData === 'object' ? Number(resData.id) : Number(resData))
        that.data.dirty = false
        that.data.publishedActivityId = Number.isSafeInteger(activityId) && activityId > 0 ? activityId : null
        that.setData({
          submitting: false,
          submitError: '',
          /* 2026-09-06 用户裁决「统一」:发布成功不再放按钮,报一下就自己收、直接落到
             项目列表(原来的 close/次要动作就是这一页)。原两颗都只是选去哪一页,
             不是「留在原地」那种真分叉。编辑保存走同一块面板,只换文案。 */
          resultSheet: {
            show: true, kind: 'success',
            title: that.editingActivityId ? '活动已更新' : '活动已发布',
            sub: that.editingActivityId
              ? '保存成功，活动已进入项目列表。'
              : '发布成功，活动已进入项目列表。',
            meta: data.startDate ? (data.startDate + ' · ' + (data.tickets || []).length + ' 个票种')
                                 : ((data.tickets || []).length + ' 个票种'),
            pill: '', why: '', duration: RESULT_SHEET_MS,
          }
        })
        analytics.track(that.editingActivityId ? 'activity_update_success' : 'activity_publish_success', {
          bizType: 'activity',
          bizId: that.editingActivityId || (resData && resData.id ? resData.id : null),
          properties: {
            name: data.name
          }
        })
      },
      onFail: (res) => {
        const message = res && res.networkError
          ? '网络错误，请重试'
          : (app.getRequestErrorMessage ? app.getRequestErrorMessage(res, that.editingActivityId ? '保存失败，请重试' : '发布失败，请重试') : ((res && res.msg) || (that.editingActivityId ? '保存失败，请重试' : '发布失败，请重试')))
        that.setData({ submitting: false, submitError: message })
      }
    })
    // submit 在途会返回 false(防重),仅真正发起时点亮 loading
    if (started) {
      that.setData({ submitting: true })
    }
  },

  /* 面板收掉直接落项目列表。想看玩家视角的活动详情,项目列表里有入口 —— 
     不为这一个可选动作把人拦在半路。 */
  onResultSheetClose() {
    this.setData({ 'resultSheet.show': false })
    // CU-M-05:商家主办的活动记在主体店主名下,不带 scope 回列表会读成个人/俱乐部那一份,
    // 刚发的那场根本不在里面(/api/project/my 的 scope 就是按这个分流)。
    wx.redirectTo({
      url: '/subpackageA/pages/myproject/index'
        + (this.data.merchantHost ? '?scope=MERCHANT' : '')
    })
  },

  createTemplate() {
    wx.navigateTo({ url: '/pages/publish/template-intro/index' })
  },

  // 取消按钮
  onCancel() {
    this.onNavBack()
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    var that = this
    this.setData({ accessState: 'checking', accessError: '', activityLoadError: '' })
    // CU-M-05:商家主办入口带 scope=MERCHANT 进来。判据换成岗位权限(店主的「项目管理」),
    // 因为商家域里「能发活动」的人不一定是登录过商家页的人 —— 核销员没有这个权。
    const merchantHost = !!(options && options.scope === 'MERCHANT')
    this.setData({
      merchantHost: merchantHost,
      deniedReason: merchantHost
        ? '发布单场活动需要店主的「项目管理」权限，请让店主在团队里给你开通。'
        : '发布单场活动需要俱乐部主理人身份。'
    })
    const editingId = options && options.id != null && options.id !== '' ? Number(options.id) : 0
    const isEdit = Number.isSafeInteger(editingId) && editingId > 0
    if (isEdit) {
      this.editingActivityId = editingId
      this.setData({
        pageTitle: '编辑活动',
        submitLabel: '保存',
        editingActivityId: editingId
      })
    }

    // C5 身份闸:发布活动仅俱乐部主理人可进(防直链/分享绕过发布弹窗的锁态)。
    // 判据是 role 而非 canPublishActivity —— 玩家的 user_permission.can_create_event=1,
    // 权限位锁不住玩家。此闸是页面层 UX;后端强制闸属①类另立卡(方案 §3A 备忘)。
    this.guardPublisherRole(function () {
      that._formBootstrapped = true
      that.setData({ accessState: 'ready', accessError: '' })
      that.getUserData()
      that.getTempList()
      that.generateDateList()
      if (that.editingActivityId) that.loadExistingActivity()
    })
  },

  // 本地 role / scope 参数只可用于展示提示，不能作为放行依据。无论缓存是什么都先回读权威接口:
  // 俱乐部线读 /api/publish/home 认 role==='club';商家线读 /api/merchant/access/me 认
  // canManageProjects —— 两个身份判的不是同一件事,混着判会把没有项目管理权的店员放进来。
  // 权威回包前保持 checking,失败按 fail-closed 停在可重试错误态。
  guardPublisherRole(onAllow) {
    const that = this
    const token = (this._accessRequestToken || 0) + 1
    this._accessRequestToken = token
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: this.data.merchantHost ? '/api/merchant/access/me' : '/api/publish/home',
      method: 'POST',
      data: {},
      success(res) {
        if (token !== that._accessRequestToken) return
        that.onPublisherIdentity(res, onAllow)
      },
      fail() {
        if (token === that._accessRequestToken) that._showAccessError()
      }
    })
  },

  onPublisherIdentity(res, onAllow) {
    if (!(res && res.code == '200' && isRecord(res.data))) {
      return this._showAccessError(res)
    }
    if (this.data.merchantHost) {
      const access = merchantAccessPolicy.normalizeMerchantAccess(res.data)
      // 回包脏到判不出身份 ⇒ 停在可重试错误态。「读不懂」不能说成「没权限」,
      // 与俱乐部线 role 字段缺失同口径;真正无权的店员才给 denied。
      if (access.invalid) return this._showAccessError(res)
      return access.canManageProjects ? onAllow() : this.rejectNonPublisher()
    }
    if (typeof res.data.role !== 'string') {
      return this._showAccessError(res)
    }
    return res.data.role === 'club' ? onAllow() : this.rejectNonPublisher()
  },

  _showAccessError(res) {
    this.setData({
      accessState: 'error',
      accessError: app.getRequestErrorMessage ? app.getRequestErrorMessage(res, '身份校验失败，请重试') : '身份校验失败，请重试'
    })
  },

  retryAccessCheck() {
    if (this.data.accessState === 'checking') return
    this.setData({ accessState: 'checking', accessError: '' })
    this.guardPublisherRole(() => {
      this.setData({ accessState: 'ready', accessError: '' })
      if (!this._formBootstrapped) {
        this._formBootstrapped = true
        this.getUserData()
        this.getTempList()
        this.generateDateList()
        if (this.editingActivityId) this.loadExistingActivity()
      }
    })
  },

  // denied 态由 auto-back 失败半屏讲原因并返回;原来这里再弹「暂未解锁」且各自 navigateBack,会连退两页
  rejectNonPublisher() {
    this.setData({ accessState: 'denied' })
  },

  // 页面销毁:让在途发布回调失效,避免 setData / redirect after unload
  onUnload() {
    this._accessRequestToken = (this._accessRequestToken || 0) + 1
    this._templateRequestToken = (this._templateRequestToken || 0) + 1
    this._activityLoadToken = (this._activityLoadToken || 0) + 1
    if (this._publishWorkflow) {
      this._publishWorkflow.destroy()
    }
  },

  onNavBack() {
    if (this.data.submitting) return
    if (!this.data.dirty) {
      wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/talent/list/index' }) } })
      return
    }
    modal.show({
      title: this.editingActivityId ? '放弃未保存的修改？' : '放弃未发布的活动？',
      content: this.editingActivityId ? '这次改动不会写回活动。' : '已填写的活动内容不会保留。',
      confirmText: '放弃',
      cancelText: '继续编辑',
      success: (res) => {
        if (res.confirm) wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/talent/list/index' }) } })
      }
    })
  },

  // 生成日期列表(今天至30天内)
  // 2026-07-31 修时区 bug:date 字段原来走 toISOString()(UTC),display/month/day 走本地
  // getter——UTC+8 下本地 00:00-08:00 那几个小时,UTC 还停在前一天,date 字段会比
  // display/month/day 慢一天。改成 date 字段也用本地 getter 拼,四个字段单一真源。
  //
  // CU-C-101:编辑远期活动时原定日期可能落在表外 —— resolveTimePickerDraft 的 findIndex
  // 未命中就静默退回今天,面板从今天 09:00 起显示,而且原日期在表里根本不存在。
  // 起点取 min(今天, 表单里最早的日期),长度至少盖到表单里最晚的日期;
  // 新建(表单无日期)行为一字不变,仍是「今天起 31 天」。
  generateDateList() {
    const dateList = []
    // 两个端点都取当天 00:00:留当前时刻会让「今天到原定日」差出不足一天,
    // 向下取整后表尾正好差一格 —— 远期原定日又落到表外(与走查同一种错法)。
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const formStart = this.formDateValue(this.data.formData.startDate)
    const formEnd = this.formDateValue(this.data.formData.endDate)
    const start = formStart && formStart < today ? formStart : today
    const span = formEnd ? Math.floor((formEnd.getTime() - start.getTime()) / 86400000) + 1 : 0
    const count = Math.max(31, span)

    for (let i = 0; i < count; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)

      const year = date.getFullYear()
      const month = date.getMonth() + 1
      const day = date.getDate()
      const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`

      dateList.push({
        date: dateStr,
        display: `${month}月${day}日`,
        month: month,
        day: day
      })
    }

    this.setData({
      dateList: dateList
    })
  },

  /** 表单里的 'YYYY-MM-DD[ HH:mm:ss]' → 当天 00:00 的本地 Date;解析不出返回 null。 */
  formDateValue(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
    if (!match) return null
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return isNaN(date.getTime()) ? null : date
  },

  // 显示统一的活动起止时间面板。每次打开都从正式值重建草稿，取消后不会残留上次滚动位置。
  showStartTimePicker() {
    // CR-63:已售出后时间锁死。服务端还会再拦一次;这里先讲明白,不让用户白点。
    if (this.data.timeLocationLocked) {
      // 长说明落在页内 field-purpose--locked(已售出须知),toast 只给最短事实。
      cyToast('已售出，时间不可改')
      return
    }
    const startDraft = this.resolveTimePickerDraft(
      this.data.formData.startDate,
      [0],
      [9, 0]
    )
    const endDraft = this.resolveTimePickerDraft(
      this.data.formData.endDate,
      [0],
      [18, 0]
    )

    this.setData({
      'timePicker.show': true,
      'timePicker.active': 'start',
      'timePicker.endUnlocked': false,
      startDateIndex: startDraft.dateIndex,
      startTimeIndex: startDraft.timeIndex,
      endDateIndex: endDraft.dateIndex,
      endTimeIndex: endDraft.timeIndex,
      timePickerStartPreview: startDraft.preview,
      timePickerEndPreview: endDraft.preview
    })
  },

  resolveTimePickerDraft(value, fallbackDateIndex, fallbackTimeIndex) {
    const dateList = this.data.dateList || []
    const hours = this.data.hours || []
    const minutes = this.data.minutes || []
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ''))

    let dateIndex = Array.isArray(fallbackDateIndex) ? fallbackDateIndex.slice() : [0]
    let timeIndex = Array.isArray(fallbackTimeIndex) ? fallbackTimeIndex.slice() : [0, 0]
    if (match) {
      const matchedDate = dateList.findIndex((item) => item.date === match[1])
      const matchedHour = hours.indexOf(Number(match[2]))
      const matchedMinute = minutes.indexOf(Number(match[3]))
      if (matchedDate >= 0) dateIndex = [matchedDate]
      if (matchedHour >= 0) timeIndex[0] = matchedHour
      if (matchedMinute >= 0) timeIndex[1] = matchedMinute
    }

    return {
      dateIndex,
      timeIndex,
      preview: this.formatTimePickerPreview(dateIndex, timeIndex)
    }
  },

  formatTimePickerPreview(dateIndex, timeIndex) {
    const selectedDate = this.data.dateList[dateIndex[0]]
    const hour = this.data.hours[timeIndex[0]]
    const minute = this.data.minutes[timeIndex[1]]
    if (!selectedDate || hour == null || minute == null) return '未设置'
    return `${selectedDate.display} ${timeOptions.formatHM(hour, minute)}`
  },

  getTimePickerSelection(field) {
    const dateIndex = this.data[`${field}DateIndex`]
    const timeIndex = this.data[`${field}TimeIndex`]
    const selectedDate = this.data.dateList[dateIndex[0]]
    const hour = this.data.hours[timeIndex[0]]
    const minute = this.data.minutes[timeIndex[1]]
    if (!selectedDate || hour == null || minute == null) return null
    return {
      apiValue: this.formatDateTimeForAPI(selectedDate.date, hour, minute),
      preview: `${selectedDate.display} ${timeOptions.formatHM(hour, minute)}`
    }
  },

  selectTimePickerPoint(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset.field
    if (field !== 'start' && field !== 'end') return
    if (field === 'end' && !this.data.timePicker.endUnlocked) return
    this.setData({ 'timePicker.active': field })
  },

  refreshTimePickerPreview(field) {
    const isStart = field === 'start'
    const preview = this.formatTimePickerPreview(
      isStart ? this.data.startDateIndex : this.data.endDateIndex,
      isStart ? this.data.startTimeIndex : this.data.endTimeIndex
    )
    if (isStart) {
      this.setData({ timePickerStartPreview: preview })
      return
    }
    this.setData({ timePickerEndPreview: preview })
  },

  onTimePickerDateChange(e) {
    const field = this.data.timePicker.active
    if (field === 'start') {
      this.setData({ startDateIndex: e.detail.value }, () => this.refreshTimePickerPreview('start'))
      return
    }
    this.setData({ endDateIndex: e.detail.value }, () => this.refreshTimePickerPreview('end'))
  },

  onTimePickerTimeChange(e) {
    const field = this.data.timePicker.active
    if (field === 'start') {
      this.setData({ startTimeIndex: e.detail.value }, () => this.refreshTimePickerPreview('start'))
      return
    }
    this.setData({ endTimeIndex: e.detail.value }, () => this.refreshTimePickerPreview('end'))
  },

  advanceTimePicker() {
    const start = this.getTimePickerSelection('start')
    if (!start) {
      cyToast('请选择完整的开始时间')
      return false
    }

    const end = this.getTimePickerSelection('end')
    if (!end || end.apiValue <= start.apiValue) {
      const startDayIndex = this.data.startDateIndex[0]
      const startHour = this.data.hours[this.data.startTimeIndex[0]]
      const startMinute = this.data.minutes[this.data.startTimeIndex[1]]
      let suggestedTotalMinutes = (startHour * 60) + startMinute + 60
      let suggestedDayIndex = startDayIndex + Math.floor(suggestedTotalMinutes / (24 * 60))

      // 日期范围末端不足一小时，则退到最小的下一分钟；仍越界时拒绝进入结束步骤。
      if (suggestedDayIndex >= this.data.dateList.length) {
        suggestedTotalMinutes = (startHour * 60) + startMinute + 1
        suggestedDayIndex = startDayIndex + Math.floor(suggestedTotalMinutes / (24 * 60))
      }
      if (suggestedDayIndex >= this.data.dateList.length) {
        cyToast('开始时间已到可选范围末端')
        return false
      }

      const minuteOfDay = suggestedTotalMinutes % (24 * 60)
      const suggestedHour = Math.floor(minuteOfDay / 60)
      const suggestedMinute = minuteOfDay % 60
      const endDateIndex = [suggestedDayIndex]
      const endTimeIndex = [
        this.data.hours.indexOf(suggestedHour),
        this.data.minutes.indexOf(suggestedMinute)
      ]
      this.setData({
        'timePicker.active': 'end',
        'timePicker.endUnlocked': true,
        endDateIndex,
        endTimeIndex,
        timePickerEndPreview: this.formatTimePickerPreview(endDateIndex, endTimeIndex)
      })
      return true
    }

    this.setData({
      'timePicker.active': 'end',
      'timePicker.endUnlocked': true
    })
    return true
  },

  submitTimePickerStep() {
    if (this.data.timePicker.active === 'start') return this.advanceTimePicker()
    return this.confirmTimePicker()
  },

  cancelTimePicker() {
    this.setData({
      'timePicker.show': false,
      'timePicker.active': 'start',
      'timePicker.endUnlocked': false,
      submitError: ''
    })
  },

  confirmTimePicker() {
    const start = this.getTimePickerSelection('start')
    const end = this.getTimePickerSelection('end')
    if (!start || !end) {
      cyToast('请选择完整的活动时间')
      return false
    }

    // API 格式固定为 YYYY-MM-DD HH:mm:ss，可直接按字典序比较，避免 Date 的本地/UTC 解析差异。
    if (end.apiValue <= start.apiValue) {
      this.setData({ 'timePicker.active': 'end' })
      cyToast('结束时间必须晚于开始时间')
      return false
    }

    this.setData({
      startdate: start.preview,
      enddate: end.preview,
      'formData.startDate': start.apiValue,
      'formData.endDate': end.apiValue,
      'timePicker.show': false,
      'timePicker.active': 'start',
      'timePicker.endUnlocked': false
    }, () => this.refreshPrimaryActionState())

    cyToast.success('时间设置完成')
    return true
  },

  // 工具方法：格式化日期时间为 API 需要的格式 (2025-11-19 09:00:00)
  // 2026-07-31 修时区 bug(同 utils/publish/publish-datetime.js 的 formatDateTimeForAPI):
  // dateStr 恒为本页 generateDateList() 拼出的 'YYYY-MM-DD' 纯日期串,不需要过 Date,
  // 直接拆字符串;绕 new Date() 再读本地 getter 在 UTC 午夜解析下会因时区差一天。
  formatDateTimeForAPI(dateStr, hour, minute) {
    const hourStr = hour.toString().padStart(2, '0');
    const minuteStr = minute.toString().padStart(2, '0');
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
    if (m) return `${m[1]}-${m[2]}-${m[3]} ${hourStr}:${minuteStr}:00`;

    const date = new Date(dateStr);
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hourStr}:${minuteStr}:00`;
  },

  // 工具方法：格式化日期时间为 ISO 字符串（保留原有方法）
  formatDateTime(dateStr, hour, minute) {
    const date = new Date(dateStr);
    date.setHours(hour);
    date.setMinutes(minute);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date.toISOString();
  },

  loadExistingActivity() {
    const that = this
    const id = this.editingActivityId
    if (!id) return
    const token = (this._activityLoadToken || 0) + 1
    this._activityLoadToken = token
    this.setData({ activityLoadError: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/activity/info',
      method: 'POST',
      data: { id: id },
      success(res) {
        if (token !== that._activityLoadToken) return
        if (res && res.code == '200' && isRecord(res.data) && !res.data.gate) {
          that.applyExistingActivity(res.data)
        } else {
          that.setData({
            activityLoadError: app.getRequestErrorMessage
              ? app.getRequestErrorMessage(res, '活动加载失败，请重试')
              : '活动加载失败，请重试'
          })
        }
      },
      fail() {
        if (token !== that._activityLoadToken) return
        that.setData({ activityLoadError: '活动加载失败，请重试' })
      }
    })
  },

  applyExistingActivity(detail) {
    const categoryList = Array.isArray(detail.sysCategoryList) ? detail.sysCategoryList : []
    const selectedCategoryIds = categoryList.length
      ? categoryList.map((item) => item.id)
      : String(detail.categoryIds || '').split(',').map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0)
    const selectedCategoryNames = categoryList.map((item) => item.categoryName).filter(Boolean)
    const tickets = Array.isArray(detail.omsTicketList) && detail.omsTicketList.length
      ? detail.omsTicketList.map((ticket) => ({
        id: ticket.id,
        name: ticket.name || '',
        price: Number(ticket.price) || 0,
        totalStock: Number(ticket.totalInventory) || 0,
        description: ticket.description || '',
        startTime: ticket.startTime || '',
        endTime: ticket.endTime || ''
      }))
      : this.data.formData.tickets
    const startDate = this.normalizeActivityDate(detail.startDate)
    const endDate = this.normalizeActivityDate(detail.endDate)
    this.setData({
      'formData.name': detail.name || '',
      'formData.description': detail.description || '',
      'formData.imgUrl': detail.imgUrl || '',
      'formData.addressName': detail.addressName || '',
      'formData.longitude': detail.longitude || '',
      'formData.latitude': detail.latitude || '',
      'formData.address': detail.address || '',
      'formData.startDate': startDate,
      'formData.endDate': endDate,
      'formData.templateId': detail.templateId || 0,
      'formData.tickets': tickets,
      selectedTempId: detail.templateId || null,
      selectedCategoryIds,
      selectedCategoryNames,
      selectedCategoryNamesStr: selectedCategoryNames.join('，'),
      categoryList,
      startdate: this.previewActivityDate(startDate, '开始日期'),
      enddate: this.previewActivityDate(endDate, '结束日期'),
      // CR-63:只信服务端回包,不在前端自己数报名 —— 数错了就会给出「能改」的假象。
      timeLocationLocked: !!detail.timeLocationLocked,
      activityLoadError: ''
    }, () => {
      // CU-C-101:原定日期先落进 formData,再按它重建可选表 —— 面板每次打开都从 formData
      // 重建草稿,表里没有原日期就定位不过去,原日期也选不回来。预览文案跟着新表重算。
      this.generateDateList()
      this.setData({
        startdate: this.previewActivityDate(this.data.formData.startDate, '开始日期'),
        enddate: this.previewActivityDate(this.data.formData.endDate, '结束日期')
      })
      this.refreshPrimaryActionState()
      this.resumeAtFirstIncompleteStep()
    })
  },

  normalizeActivityDate(value) {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ''))
    if (!match) return value ? String(value) : ''
    return `${match[1]} ${match[2]}:${match[3]}:00`
  },

  previewActivityDate(value, fallback) {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ''))
    if (!match) return fallback
    const found = (this.data.dateList || []).find((item) => item.date === match[1])
    const display = found ? found.display : match[1]
    return `${display} ${match[2]}:${match[3]}`
  },

  getUserData: function () {
    const that = this;
    this.setData({ ownerLoadError: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/user/info',
      data: {
        member_id: app.getUserID()
      },
      method: "POST",
      success: function (res) {
        const ownerId = Number(res && res.data && res.data.id)
        if (res && res.code == "200" && isRecord(res.data)
            && Number.isSafeInteger(ownerId) && ownerId > 0
            && String(res.data.nickname || '').trim()) {
          let userData = {
            name: res.data.nickname,
            nickname: res.data.nickname,
            avatar: res.data.avatar,
            id: ownerId,
            isOwner: 1
          }

          let collaboratorList = [];
          let collaborators = [];

          collaboratorList = [...collaboratorList, userData];
          collaborators = [...collaborators, ownerId];

          that.setData({
            'formData.collaboratorList': collaboratorList,
            'formData.collaborators': collaborators,
            ownerLoadError: ''
          })
        } else {
          that.setData({ ownerLoadError: '发起人信息加载失败，请重试' })
        }
      },
      fail: function () {
        that.setData({ ownerLoadError: '发起人信息加载失败，请重试' })
      }
    })
  },

  // 添加合作者:半屏选择器(cy-collaborator-picker),不再 navigateTo 到独立页——
  // 选中结果走组件 triggerEvent('select') 回传,不依赖页面栈层数。
  AddCollaborator(e) {
    const idsString = this.data.formData.collaborators.join(',');
    // categorySheetVisible:false 是与分类半屏的互斥闸,理由同 navigateToCategorySelect
    this.setData({ collaboratorPickerShow: true, collaboratorPickerIds: idsString, categorySheetVisible: false });
  },
  onCollaboratorPickerSelect(e) {
    this.updateCollaborator(e.detail.item);
    this.setData({ collaboratorPickerShow: false });
  },
  onCollaboratorPickerClose() {
    this.setData({ collaboratorPickerShow: false });
  },

  // 更新合作者数据（从合作者页面回调）
  updateCollaborator: function (selectedUser) {
    const that = this;

    const existingIndex = that.data.formData.collaboratorList.findIndex(item => item.id === selectedUser.id);

    if (existingIndex === -1) {
      const newCollaboratorList = [...that.data.formData.collaboratorList, selectedUser];
      const newCollaboratorIds = newCollaboratorList.map(item => item.id);

      that.data.dirty = true;
      that.setData({
        'formData.collaboratorList': newCollaboratorList,
        'formData.collaborators': newCollaboratorIds
      });

      cyToast.success(`已添加: ${selectedUser.nickname}`);
    } else {
      cyToast('该合作者已添加');
    }
  },

  // 移除合作者 
  removeCollaborator: function (e) {
    const index = e.currentTarget.dataset.index;
    const that = this;

    const newCollaboratorList = [...that.data.formData.collaboratorList];
    const removedUser = newCollaboratorList.splice(index, 1)[0];

    const newCollaboratorIds = newCollaboratorList.map(item => item.id);

    that.data.dirty = true;
    that.setData({
      'formData.collaboratorList': newCollaboratorList,
      'formData.collaborators': newCollaboratorIds
    });

    cyToast.success(`已移除: ${removedUser.nickname}`);
  },

  // 关闭模板弹框
  cancelTemp(e) {
    this.setData({
      popTemp: false,
      popChapterNodes: true
    })
  },

  // 搜索事件处理函数
  handleSearch: function (e) {
    const keyword = e.detail.value;
    this.setData({
      searchKeyword: keyword
    });
    this.getTempList(keyword);
  },

  // 选择模板事件
  selectTemp: function (e) {
    const item = e.currentTarget.dataset.item;
    const tempId = item.id;

    if (this.data.selectedTempId === tempId) {
      this.setData({
        selectedTempId: null,
        selectedTempInfo: null
      });
    } else {
      this.setData({
        selectedTempId: tempId,
        selectedTempInfo: item
      });
    }
  },

  // 完成按钮事件 
  confirmTemp: function () {
    if (!this.data.selectedTempInfo) {
      cyToast('请先选择一个模板');
      return;
    }

    const selectedTemplate = this.data.selectedTempInfo;
    if (isAlbumTemplate(selectedTemplate)) {
      cyToast(ALBUM_ONLY_IN_STORY);
      return;
    }

    this.data.dirty = true;
    this.setData({
      popTemp: false,
      'formData.templateId': selectedTemplate.id,
      submitError: ''
    }, () => this.refreshPrimaryActionState());

    cyToast.success('模板选择成功');
  },

  // 显示模板选择弹框
  showTemp: function () {
    this.setData({
      popTemp: true,
      selectedTempId: this.data.selectedTempId,
      selectedTempInfo: this.data.selectedTempInfo
    });
  },

  getTempList: function (keyword = '') {
    var that = this;
    const token = (this._templateRequestToken || 0) + 1
    this._templateRequestToken = token
    this.setData({
      templateLoadState: 'loading',
      templateError: ''})
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/my-list',
      method: "POST",
      data: {
        is_quote: 1,
        keyword: keyword,
      },
      success: function (res) {
        if (token !== that._templateRequestToken) return
        if (res && res.code == "200" && res.data && isRecordList(res.data.rows)) {
          that.setData({
            tempList: res.data.rows,
            templateLoadState: res.data.rows.length ? 'ready' : 'empty',
            templateError: ''})

          if (that.data.selectedTempId) {
            const selectedTemplate = res.data.rows.find(item => item.id === that.data.selectedTempId);
            if (selectedTemplate) {
              that.setData({
                selectedTempInfo: selectedTemplate
              });
            }
          }
        } else {
          that._showTemplateLoadError(app.getRequestErrorMessage
            ? app.getRequestErrorMessage(res, '模板加载失败，请重试')
            : '模板加载失败，请重试');
        }
      },
      fail: function () {
        if (token !== that._templateRequestToken) return
        that._showTemplateLoadError('模板加载失败，请重试')
      }
    })
  },

  _showTemplateLoadError: function (message) {
    if (this.data.tempList.length) {
      this.setData({ templateLoadState: 'ready'})
      return
    }
    this.setData({ templateLoadState: 'error', templateError: message })
  },

  // 选择地址
  choosePoiForNode() {
    // CR-63:已售出后地点锁死(与时间同一道锁)。服务端为准,这里只负责别让人白选一次。
    if (this.data.timeLocationLocked) {
      cyToast('已售出，地点不可改')
      return
    }
    const that = this;
    pickLocation({
      onPick(poi) {
        // 更新表单数据
        that.data.dirty = true;
        that.setData({
          'formData.addressName': poi.name,
          'formData.longitude': poi.longitude,
          'formData.latitude': poi.latitude,
          'formData.address': poi.address,
          submitError: ''
        }, () => that.refreshPrimaryActionState());
        cyToast.success('地点选择成功');
      }
    });
  },
})
