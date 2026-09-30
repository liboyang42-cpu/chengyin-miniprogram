const modal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
// 时/分选项与 HH:mm 格式化的单一真源(补零口径全仓一致)
const timeOptions = require('../../../utils/time-picker-options.js');
const { pickLocation } = require('../../../utils/location/location-manager.js');
const { chinaDayStart } = require('../../../utils/datetime.js');
const calendar = require('../../../utils/calendar.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');

function isSuccess(response) {
  return !!(response && (response.code === 200 || response.code === '200'));
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function isEditableRegistration(data, registrationId) {
  const required = [
    'id', 'topicId', 'nodeId', 'templateId', 'status', 'auditStatus',
    'address', 'addressName', 'longitude', 'latitude', 'startDate', 'endDate',
    'cooperateDate', 'limitNum', 'activityDesc', 'picUrl', 'topicStartDate',
  ];
  const startDay = topicStartDay(data && data.topicStartDate);
  return isObject(data)
    && Number(data.id) === registrationId
    && required.every((key) => hasOwn(data, key))
    && Number.isFinite(Number(data.status))
    && (data.auditStatus == null || Number.isFinite(Number(data.auditStatus)))
    && (data.topicStartDate == null || data.topicStartDate === '' || Number.isFinite(startDay));
}

function topicStartDay(value) {
  if (value == null || value === '') return null;
  return chinaDayStart(value);
}

function editBlockReason(data, now = Date.now()) {
  const startDay = topicStartDay(data.topicStartDate);
  const today = chinaDayStart(now);
  if (Number.isFinite(startDay) && startDay <= today) {
    return '主题已开始，承接内容不能再修改';
  }
  const status = Number(data.status);
  const auditStatus = data.auditStatus == null ? 0 : Number(data.auditStatus);
  const pending = status === 0 && auditStatus === 0;
  const rejected = (status === 3 || status === 2) && auditStatus === 2;
  if (pending || rejected) return '';
  return status === 1 || auditStatus === 1
    ? '该报名已通过审核，承接内容不能再修改'
    : '报名状态已变化，请返回详情查看最新结果';
}

function isRejectedRegistration(data) {
  const status = Number(data.status);
  return (status === 3 || status === 2) && Number(data.auditStatus) === 2;
}

function dateOnly(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const matched = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (matched) return matched[0];
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/*
 * 商家报名(经典定向)—— 弹窗规范类型 B 旗舰案例。
 * 范围说明(2026-07-31,总控已批准):merchantapply1 原本按 mode 分两条链路——
 * mode=1(经典定向)填完直接提交,mode=2(自由定向)还要跳去 merchantapply2 做
 * 一整套模板编辑(1200+ 行,含多个 API 拉取的选项源、AI 对话画布)。全仓两个真实
 * 入口(merchantinfo.js / coop/list/index.js)都只传 mode=1,所以这一个 cy-sheet
 * 页面把 mode=1 的完整链路(填写 → 提交 → 成功)收进一个全屏弹窗;mode=2 保留在
 * 旧的三页路由上,不在本页复刻。
 */
/* 路由参数里的中文是 encodeURIComponent 过的;解不开就当没有,不把 %E5%A4%96 印到屏上。 */
function decodeParam(value) {
  if (!value) return '';
  try { return decodeURIComponent(String(value)).trim(); } catch (e) { return ''; }
}

Page({
  data: {
    // 你的门店(稿 133:310 顶部那张卡)。三个字段都为空就整块不渲染。
    // 稿 133:310 的门店卡是「左封面图 + 右三行」。coverImage / logo 都在
    // /api/merchant/info 返回的 MmsMerchant 上,原来只是没取。
    shop: { name: '', address: '', businessTime: '', cover: '' },
    // 上下文
    topicId: 0,
    nodeId: 0,
    templateId: 0,
    /* 稿 365:957 提交成功页那张摘要卡的三行字,由上一页随路由带来(它手上就有)。
       带不到就整块不出 —— 一张只写着「—」的摘要卡比没有更糟。 */
    topicName: '',
    chapterName: '',
    nodeName: '',
    reducedMotion: false,
    registrationId: 0,
    registrationWasRejected: false,
    loadState: 'ready', // ready | loading | error | permission
    loadError: '',
    submitError: '',
    // 提交失败 = 这份报名没交上去,不是「某块没刷新」 —— 走 error 档(红 ⚠),不是 data 档(蓝 ⓘ)。
    submitErrorKind: 'error',
    submitting: false,

    // 弹窗阶段:form=填写 / success=已提交
    phase: 'form',

    // 表单字段
    address: '',
    addressName: '',
    longitude: '',
    latitude: '',
    startDate: '',
    endDate: '',
    availabilityRange: [],
    availabilityPickerShow: false,
    availabilityMin: calendar.today(),
    cooperateDate: '',
    limitNum: '',
    ruleInstructions: '',
    picUrl: '',
    errors: {},
    focusField: '',
    canSubmit: false,

    // 有未保存输入时为 true——cy-sheet 靠这个字段拦住误触关闭丢数据
    dirty: false,

    // 时间选择器
    timePicker: { show: false, startTime: { hour: 9, minute: 0 }, endTime: { hour: 18, minute: 0 } },
    hours: timeOptions.HOURS,
    /* 2026-09-07:分钟列从 60 档(00–59)改成半点两档。
       商家答不出「我每天 18:07 到 21:53 能接待」—— 逐分钟是伪精度,
       逼人做一个他守不住的承诺。半点足够表达真实排班。
       用 util 2026-08-26 预留的 minuteOptions(step),index↔值一律走 minuteAt 反查,
       否则滚轮停在 30 而内部记着 07(那条注释就写在 minuteIndex 上面)。 */
    minuteStep: 30,
    minutes: timeOptions.minuteOptions(30),
    startTimeIndex: [9, 0],
    endTimeIndex: [18, 0],
  },

  onLoad(options = {}) {
    const registrationId = parseInt(options.id) || 0;
    this.setData({
      topicId: parseInt(options.topicId) || 0,
      nodeId: parseInt(options.nodeId) || 0,
      templateId: parseInt(options.templateId) || 0,
      topicName: decodeParam(options.topicName),
      chapterName: decodeParam(options.chapterName),
      nodeName: decodeParam(options.nodeName),
      registrationId,
      loadState: registrationId ? 'loading' : 'ready',
      loadError: '',
    }, () => {
      if (registrationId) this.loadRegistration();
      this.loadMyShop();
    });
  },

  onShow() {
    merchantTheme.merchantPageShow();
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._loadEpoch = (this._loadEpoch || 0) + 1;
    this._submitEpoch = (this._submitEpoch || 0) + 1;
    this._registrationLoading = false;
    this._submitting = false;
    if (this._submitRequest && typeof this._submitRequest.abort === 'function') {
      this._submitRequest.abort();
    }
    this._submitRequest = null;
    merchantTheme.merchantPageRestore();
  },

  /* 门店资料。主办方就是靠店名/地址/营业时段判断要不要选这一站,所以摆在表单最上面。
     ⚠️ 失败不打断填表:这三行是**给对方看的补充信息**,不是提交字段 —— 拉不到就整块不出,
     照样能报名。也不兜底成「未填写」,那会让人以为自己的资料丢了。 */
  loadMyShop() {
    const that = this;
    app.sendRequest({
      url: '/api/merchant/info', method: 'POST', hideLoading: true, silentError: true,
      success(res) {
        const d = res && res.code == '200' && res.data ? res.data : null;
        if (!d) return;
        that.setData({
          shop: {
            name: String(d.name || '').trim(),
            address: String(d.address || '').trim(),
            businessTime: String(d.businessTime || '').trim(),
            // 封面优先门头图,没有再退店招 logo;都没有就不出图(不摆灰方块)
            cover: String(d.coverImage || d.logo || '').split(',')[0].trim(),
          },
        });
        that.applyShopBusinessTime(String(d.businessTime || '').trim());
      },
    });
  },

  loadRegistration() {
    const registrationId = this.data.registrationId;
    if (!registrationId || this._registrationLoading) return;
    this._registrationLoading = true;
    const epoch = (this._loadEpoch || 0) + 1;
    this._loadEpoch = epoch;
    this.setData({
      loadState: 'loading', loadError: '', submitError: '', canSubmit: false, dirty: false,
    });
    let settled = false;
    const finish = () => {
      if (settled || epoch !== this._loadEpoch) return false;
      settled = true;
      this._registrationLoading = false;
      return true;
    };
    const failClosed = (message) => {
      if (!finish()) return;
      this.setData({
        loadState: 'error',
        loadError: message || '报名信息没有加载完整，请重试',
        submitError: '',
        canSubmit: false,
        dirty: false,
      });
    };
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/registration/merchant/info',
      method: 'POST',
      data: { id: registrationId },
      success: (res) => {
        if (epoch !== this._loadEpoch) return;
        const detail = res && res.data;
        if (!isSuccess(res) || !isEditableRegistration(detail, registrationId)) {
          failClosed(isSuccess(res)
            ? '报名信息没有加载完整，请重试'
            : ((app.getRequestErrorMessage && app.getRequestErrorMessage(res, '报名信息加载失败')) || '报名信息加载失败'));
          return;
        }
        const blockReason = editBlockReason(detail);
        if (!finish()) return;
        if (blockReason) {
          this.setData({
            registrationWasRejected: isRejectedRegistration(detail),
            loadState: 'permission',
            loadError: blockReason,
            submitError: '',
            canSubmit: false,
            dirty: false,
          });
          return;
        }
        const limitNum = Number(detail.limitNum);
        const address = detail.address == null ? '' : String(detail.address);
        const startDate = dateOnly(detail.startDate);
        const endDate = dateOnly(detail.endDate);
        const cooperateDate = detail.cooperateDate == null ? '' : String(detail.cooperateDate);
        const ruleInstructions = detail.activityDesc == null ? '' : String(detail.activityDesc);
        const picUrl = detail.picUrl == null ? '' : String(detail.picUrl);
        const canSubmit = !!address.trim()
          && !!startDate
          && !!endDate
          && !!cooperateDate
          && !!ruleInstructions.trim()
          && !!picUrl;
        this.setData({
          topicId: Number(detail.topicId) || 0,
          nodeId: Number(detail.nodeId) || 0,
          templateId: Number(detail.templateId) || 0,
          registrationWasRejected: isRejectedRegistration(detail),
          address,
          addressName: detail.addressName == null ? '' : String(detail.addressName),
          longitude: detail.longitude == null ? '' : String(detail.longitude),
          latitude: detail.latitude == null ? '' : String(detail.latitude),
          startDate,
          endDate,
          availabilityRange: startDate && endDate ? [startDate, endDate] : [],
          cooperateDate,
          limitNum: Number.isFinite(limitNum) && limitNum > 0 ? String(limitNum) : '',
          ruleInstructions,
          picUrl,
          errors: {},
          loadState: 'ready',
          loadError: '',
          submitError: '',
          dirty: false,
          canSubmit,
        });
      },
      fail: () => failClosed('网络不稳定，报名信息没有加载出来'),
      successStatusAbnormal: (error) => failClosed(
        (app.getRequestErrorMessage && app.getRequestErrorMessage(error, '报名信息加载失败')) || '报名信息加载失败'),
      complete: () => failClosed('报名信息加载没有完成，请重试'),
    });
  },

  retryLoadRegistration() { this.loadRegistration(); },

  // ===== 脏态:任一字段非空即视为"有未保存输入" =====
  _refreshDirty() {
    const d = this.data;
    const dirty = !!(d.address || d.startDate || d.endDate || d.cooperateDate || d.limitNum || d.ruleInstructions || d.picUrl);
    if (dirty !== d.dirty) this.setData({ dirty });
    this.refreshSubmitState();
  },

  refreshSubmitState() {
    const d = this.data;
    const canSubmit = !!(d.address || '').trim()
      && !!d.startDate
      && !!d.endDate
      /* ⚠️ 不再要求 cooperateDate。
         后端从来没有非空校验(ApiRegistrationMerchantController:366 是
         `if (StringUtils.isNotBlank(...))` 才写),这条必填是前端自己加的。
         而商家答不准「我每天几点到几点能接待」—— 逼填只会得到一个随手选的假值,
         那个值玩家在「我的参与」里是看得见的。缺了那边已有兜底文案。
         默认会带门店营业时间进来(见 applyShopBusinessTime),不改就是它。 */
      && !!(d.ruleInstructions || '').trim()
      && !!d.picUrl;
    if (canSubmit !== d.canSubmit) this.setData({ canSubmit });
  },

  // 置灰的提交钮被点 → 报出还差哪一项。静默置灰等于把「为什么不能提交」留给用户猜。
  onSubmitDisabledTap() {
    const d = this.data;
    if (!(d.address || '').trim()) toast('请先选择承接地点');
    else if (!d.startDate || !d.endDate) toast('请选择可配合日期区间');
    else if (!(d.ruleInstructions || '').trim()) toast('请填写可用空间与现场条件');
    else if (!d.picUrl) toast('请添加场地照片');
  },

  // ===== cy-sheet 关闭契约 =====
  // 'close' 只在 !dirty 时触发(组件保证);干净状态直接退出。
  /* 顶栏返回箭头(稿 133:310)。cy-sheet 的 back 只发 back、不发 requestclose ——
     那是给「多步向导退一步」用的。这页只有一步,返回就是退出,所以必须自己接回
     退出那条路,否则填了一半点返回会直接丢掉,连「要不要放弃」都不问。 */
  onNavBack() {
    if (this.data.dirty) { this.onSheetRequestClose({ detail: { reason: 'back' } }); return; }
    this.onSheetClose();
  },

  onSheetClose() {
    if (this._submitting) return;
    if (getCurrentPages().length > 1) wx.navigateBack();
    else this.goHome();
  },
  // 'requestclose' 每次关闭尝试(遮罩或 ✕)都会触发,dirty 时必须由页面接管、弹确认。
  onSheetRequestClose() {
    if (this._submitting) {
      toast('正在提交，请稍候');
      return;
    }
    if (!this.data.dirty) return; // 干净路径已经被 onSheetClose 处理,这里不重复退出
    modal.show({
      title: '放弃这次报名?',
      content: '已填写的承接地点、时间等信息不会保存',
      confirmText: '放弃',
      cancelText: '继续填写',
      success: (r) => {
        if (r.confirm) {
          this.setData({ dirty: false });
          this.onSheetClose();
        }
      },
    });
  },

  // ===== 位置 =====
  choosePoiForNode() {
    const that = this;
    pickLocation({
      guideOnDeny: false,
      onPick(poi) {
        that.setData({
          address: poi.address,
          addressName: poi.name,
          longitude: poi.longitude,
          latitude: poi.latitude,
          'errors.address': '',
        }, () => that._refreshDirty());
        toast.success('地点选择成功');
      },
    });
  },

  // ===== 表单输入 =====
  onAddressChange(e) {
    this.setData({ address: e.detail.value }, () => this._refreshDirty());
  },
  onLimitNumChange(e) {
    this.setData({ limitNum: e.detail.value }, () => this._refreshDirty());
  },
  onRuleInstructionsChange(e) {
    this.setData({ ruleInstructions: e.detail.value, 'errors.ruleInstructions': '' }, () => this._refreshDirty());
  },
  onFieldFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    this.setData({ focusField: ds.focuskey || '' });
  },
  onFieldBlur() {
    this.setData({ focusField: '' });
  },

  // ===== 图片(多张,逗号分隔 CSV,最多 9 张) =====
  uploadPic() {
    const that = this;
    const cur = that.data.picUrl ? that.data.picUrl.split(',').filter(Boolean) : [];
    const remain = 9 - cur.length;
    if (remain <= 0) { toast('最多9张'); return; }
    app.chooseImage((res) => {
      that.setData({ picUrl: cur.concat(res).slice(0, 9).join(','), 'errors.picUrl': '' }, () => that._refreshDirty());
    }, remain);
  },
  removePic(e) {
    const i = Number(e.currentTarget.dataset.imgindex);
    const arr = this.data.picUrl ? this.data.picUrl.split(',').filter(Boolean) : [];
    if (i < 0 || i >= arr.length) return;
    arr.splice(i, 1);
    this.setData({ picUrl: arr.join(',') }, () => this._refreshDirty());
  },

  // ===== 可配合日期(日期区间) =====
  openAvailabilityPicker() {
    this.setData({ availabilityPickerShow: true });
  },
  cancelAvailabilityPicker() {
    this.setData({ availabilityPickerShow: false });
  },
  confirmAvailabilityPicker(e) {
    const value = e.detail && e.detail.value;
    if (!Array.isArray(value) || !value[0] || !value[1]) return;
    this.setData({
      startDate: value[0],
      endDate: value[1],
      availabilityRange: [value[0], value[1]],
      availabilityPickerShow: false,
      'errors.availabilityRange': '',
    }, () => this._refreshDirty());
  },

  /* 「每日可接待时段」默认带门店营业时间进来。
     营业时间是商家唯一说得准的东西 —— 它在商家资料里维护过,表单顶上那张
     「你的门店」卡也已经在显示它。不带默认值就是逼他现场编一个。
     ⚠️ 只在这一格还空着时填:回填已有报名(loadRegistration)或用户已经改过之后,
        接口回来晚了也不能把他填的覆盖掉。
     ⚠️ businessTime 是自由文本(「19:20—19:40 · 周一至周五」),这里只认能解析成
        HH:mm-HH:mm 的那种;解析不出来就不填,不把一段散文塞进这个字段。 */
  applyShopBusinessTime(businessTime) {
    if (!businessTime || this.data.cooperateDate) return;
    const normalized = businessTime.replace(/[—～~]/g, '-').replace(/\s/g, '');
    const parts = this.parseBusinessTime(normalized.split('·')[0]);
    if (!parts) return;
    const value = this.formatTime(parts.startHour, parts.startMinute)
      + '-' + this.formatTime(parts.endHour, parts.endMinute);
    this.setData({ cooperateDate: value });
  },

  // ===== 可配合时间(时段选择) =====
  formatTime(hour, minute) {
    return timeOptions.formatHM(hour, minute);
  },
  parseBusinessTime(businessTime) {
    if (!businessTime) return null;
    const parts = businessTime.split('-');
    if (parts.length !== 2) return null;
    const s = parts[0].split(':');
    const e = parts[1].split(':');
    if (s.length !== 2 || e.length !== 2) return null;
    return { startHour: parseInt(s[0]), startMinute: parseInt(s[1]), endHour: parseInt(e[0]), endMinute: parseInt(e[1]) };
  },
  handleTimePopup(e) {
    const { action } = e.currentTarget.dataset;
    if (action === 'open') {
      let startTimeIndex = [9, 0];
      let endTimeIndex = [18, 0];
      if (this.data.cooperateDate) {
        const parts = this.parseBusinessTime(this.data.cooperateDate);
        if (parts) {
          startTimeIndex = [parts.startHour, timeOptions.minuteIndex(parts.startMinute, this.data.minuteStep)];
          endTimeIndex = [parts.endHour, timeOptions.minuteIndex(parts.endMinute, this.data.minuteStep)];
        }
      }
      // 列下标必须反查回真值再存:存量值可能是 18:07,滚轮落在 00 档,
      // 不反查就会出现「屏幕上 18:00、内部还记着 18:07」
      const step = this.data.minuteStep;
      this.setData({
        'timePicker.show': true,
        startTimeIndex, endTimeIndex,
        'timePicker.startTime': { hour: startTimeIndex[0], minute: timeOptions.minuteAt(startTimeIndex[1], step) },
        'timePicker.endTime': { hour: endTimeIndex[0], minute: timeOptions.minuteAt(endTimeIndex[1], step) },
      });
    } else if (action === 'confirm') {
      const { startTime, endTime } = this.data.timePicker;
      // 探店日的「可配合时间」是当天的一个时段,不跨夜 —— 结束必须晚于开始。
      // 缺这条时可以提交「18:00-09:00」,商家侧排期与玩家侧展示都会错乱。
      // 同一条规则在 publish/fabu、publish/activity、couponInfo 早就有了,这里原本漏了。
      if (!timeOptions.isEndAfterStart(startTime, endTime)) {
        toast('结束时间必须晚于开始时间');
        return;
      }
      const cooperateDate = this.formatTime(startTime.hour, startTime.minute) + '-' + this.formatTime(endTime.hour, endTime.minute);
      this.setData({ cooperateDate, 'timePicker.show': false, 'errors.cooperateDate': '' }, () => this._refreshDirty());
    } else if (action === 'close') {
      this.setData({ 'timePicker.show': false });
    }
  },
  onStartTimeChange(e) {
    const [hour, mi] = e.detail.value;
    const minute = timeOptions.minuteAt(mi, this.data.minuteStep);
    this.setData({ startTimeIndex: e.detail.value, 'timePicker.startTime': { hour, minute } });
  },
  onEndTimeChange(e) {
    const [hour, mi] = e.detail.value;
    const minute = timeOptions.minuteAt(mi, this.data.minuteStep);
    this.setData({ endTimeIndex: e.detail.value, 'timePicker.endTime': { hour, minute } });
  },

  // ===== 校验 + 提交 =====
  validateForm() {
    const { address, startDate, endDate, cooperateDate, ruleInstructions, picUrl } = this.data;
    const errors = {};
    const order = [];
    const fail = (key, msg) => { errors[key] = msg; order.push(key); };

    if (!address.trim()) fail('address', '请输入活动地点');
    if (!startDate || !endDate) fail('availabilityRange', '请选择可配合日期');
    if (cooperateDate === '') fail('cooperateDate', '请选择可配合时间段');
    if (!ruleInstructions.trim()) fail('ruleInstructions', '请输入节点接待说明');
    if (picUrl === '') fail('picUrl', '请上传节点现场图片');

    this.setData({ errors });
    if (!order.length) return true;
    toast(errors[order[0]]);
    return false;
  },

  clearRuleInstructions() {
    this.setData({ ruleInstructions: '', 'errors.ruleInstructions': '' }, () => this._refreshDirty());
  },

  onSubmit() {
    if (this.data.loadState !== 'ready') return;
    if (!this.validateForm()) return;
    if (this._submitting) return;
    this._submitting = true;
    const submitEpoch = (this._submitEpoch || 0) + 1;
    this._submitEpoch = submitEpoch;
    this.setData({ submitError: '', submitErrorKind: 'error', submitting: true });

    const { registrationId, topicId, nodeId, templateId, address, addressName, picUrl, latitude, longitude, startDate, endDate, cooperateDate, limitNum, ruleInstructions } = this.data;
    const requestData = {
      topicId, mode: 1, nodeId, templateId,
      address, addressName, picUrl, latitude, longitude,
      cooperateDate,
      limitNum: String(limitNum == null ? '' : limitNum).trim() === '' ? null : parseInt(limitNum),
      activityDesc: ruleInstructions,
      startDate: startDate + ' 00:00:00',
      endDate: endDate + ' 23:59:59',
    };
    if (registrationId) requestData.id = registrationId;

    cyLoading.show('提交中...');
    const showSubmitError = (message, kind) => {
      if (submitEpoch !== this._submitEpoch) return;
      this._submitting = false;
      this._submitRequest = null;
      cyLoading.hide();
      this.setData({ submitError: message, submitErrorKind: kind, submitting: false });
    };
    this._submitRequest = app.sendRequest({
      url: registrationId ? '/api/registration/merchant/update' : '/api/registration/merchant/create',
      data: JSON.stringify(requestData),
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      silentError: true,
      success: (res) => {
        if (submitEpoch !== this._submitEpoch) return;
        cyLoading.hide();
        if (res.code == '200') {
          // 提交成功即视为"已保存",dirty 归零,遮罩/✕ 从这里开始可以直接退出
          this._submitting = false;
          this._submitRequest = null;
          this.setData({ phase: 'success', dirty: false, submitError: '', submitting: false });
          this.notifyRegistrationSaved();
        } else {
          const message = res.msg || '提交失败，请检查后重试';
          showSubmitError(message, 'error');
        }
      },
      fail: () => {
        showSubmitError('网络错误，请重试', 'network');
      },
    });
  },

  onCreateSubmit() {
    if (this.data.registrationId) return;
    this.onSubmit();
  },

  onEditSubmit() {
    if (!this.data.registrationId) return;
    this.onSubmit();
  },

  notifyRegistrationSaved() {
    if (this._registrationSavedNotified) return;
    this._registrationSavedNotified = true;
    try {
      const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (channel && typeof channel.emit === 'function') {
        channel.emit('registrationSaved', { registrationId: this.data.registrationId || 0 });
      }
    } catch (error) {
      // 深链进入时没有 opener；成功回执仍可独立完成，不把通知失败冒充保存失败。
    }
  },

  // ===== 成功态操作 =====
  // 报名交完要去的是「我这条报名走到哪一步了」,不是商家首页 ——
  // 扔回首页等于让他自己再找一遍刚报的那个主题(2026-09-05 拍板,Figma F5)。
  // 承接页此刻是审核中态,进度那一块正好显示「主办方审核中」。
  goProgress() {
    const topicId = this.data.topicId;
    if (!topicId) { wx.reLaunch({ url: '/pages/merchant/index/index' }); return; }
    wx.redirectTo({
      url: '/pages/topic/merchantinfo/merchantinfo?id=' + topicId + '&scope=MERCHANT',
      fail() { wx.reLaunch({ url: '/pages/merchant/index/index' }); },
    });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/merchant/index/index' });
  },
  goMore() {
    wx.navigateBack({ delta: 1, fail() { wx.reLaunch({ url: '/pages/merchant/index/index' }); } });
  },

});
