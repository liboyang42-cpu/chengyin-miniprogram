const modal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const cyToast = require('../../../utils/toast.js');
const { toTimestamp, chinaDayStart } = require('../../../utils/datetime');
const { resolveVerificationScan } = require('../../../utils/verification-scan');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { createWriteActionWorkflow } = require('../../../utils/write-action-workflow.js');
const { offerVerificationReadback } = require('../../../utils/verification-readback.js');
const { summarizeOrderState } = require('../../../utils/order-status.js');
const cancellationFeedback = require('../../../utils/cancellation-feedback.js');

function nonNegativeNumberOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// H12 参与详情(方案 §5.2)。三级 = 记录/状态 ⇒ 场景弹窗,宿主是「我的参与」页。
// 详情与取消报名逻辑的唯一实现;subpackageMember/mycanyuinfo 退化成深链薄壳。
// 与页面版的差异只有两处(§8.3 禁止 sheet 内继续 navigateTo):
//   ① 返回 = triggerEvent('back') 回上一层,不猜页面栈;
//   ② 去票夹/修改报名这些非场景目标,先 close 再 navigateTo,不在弹窗上压页面。
Component({
  properties: {
    recordId: { type: String, value: '' },
    theme: { type: String, value: 'player' },
  },
    data: {
      id: 0,
      info: {},
      displayInfo: {},
      // R1-C04:本页此前没有加载/失败态,接口失败只弹 toast,页面照样把空值渲染成完整骨架。
      // loadState: loading | missing-param | error | ready —— 四态互斥由 WXML 承接。
      loadState: 'loading',
      loadErrorText: '',
      // R2-C04:错误态动作槽的**标签**。cy-error 只有一个动作位,所以标签必须跟着这一档
      // 真正能做的事变:有 id ⇒ 「重试」,缺 id ⇒ 「返回参与列表」。
      // ⚠️ 不许再退回 R1 的 retry="{{id ? '重试' : ''}}" —— 空标签 = 缺参数时整屏无按钮,
      //   用户被钉在一段死文字上(2026-07-30 受控截图 05 实证)。
      errorActionText: '重试'
    },
  lifetimes: {
    attached() {
      this._skipInitialShow = true;
      const id = trimmedString(String(this.data.recordId == null ? '' : this.data.recordId))
      if (!id) {
        // 没有 id 就永远拿不到详情:既不能停在「一直加载中」,也不能把缺参伪装成加载失败
        this.setData({
          loadState: 'missing-param',
          loadErrorText: '请返回列表重新进入',
          errorActionText: '返回参与列表',
        })
        return
      }
      this._applyRecordId(id)
    },
    detached() {
      if (this._verificationWorkflow) this._verificationWorkflow.destroy();
    },
  },
  // ⚠️ 深链壳(subpackageMember/mycanyuinfo)的 id 是页面 onLoad 里 setData 进去的:组件 attached
  // 时那一次还看不到它(属性后到,attached 读到的是初始空串),只读 attached 的写法会让深链页
  // 永远停在「缺少参与记录」并且一个请求都不发(2026-09-16 截图冒烟实证:拦截 sendRequest 为空)。
  // 观察器与 attached 共用 _applyRecordId,按 id 去重,同一 id 只拉一次。
  observers: {
    recordId(value) {
      this._applyRecordId(value)
    },
  },
  pageLifetimes: {
    show() {
      if (this._skipInitialShow) { this._skipInitialShow = false; return; }
      if (this.data.id) this.getData(this.data.id);
    },
  },
  methods: {
    // 记录 id 的唯一入口:attached 与 observers.recordId 都走这里。
    // 同一 id 只拉一次(两个入口可能都触发),空值只置缺参态不发请求。
    _applyRecordId(value) {
      const id = trimmedString(String(value == null ? '' : value))
      if (!id) return
      if (String(this.data.id) === id) return
      // 后到的 id 要把「缺参」态翻回加载中,否则界面还停在死文字上而请求已经在路上。
      this.setData({ id, loadState: 'loading', loadErrorText: '', errorActionText: '重试' })
      this.getData()
    },
    _submitVerification(key, loadingTitle, options, callback) {
      const that = this;
      if (!this._verificationWorkflow) this._verificationWorkflow = createWriteActionWorkflow({ deadlineMs: 15000 });
      if (this._verificationWorkflow.isBusy(key)) {
        cyToast('核销处理中，请勿重复提交');
        return false;
      }
      cyLoading.show(loadingTitle);
      const submitted = this._verificationWorkflow.run(key, function (done) {
        return app.sendRequest(Object.assign({}, options, {
          autoErrorToast: false,
          success(r) { done({ status: 'success', response: r }); },
          fail() { done({ status: 'failed', response: { code: 500, msg: '网络错误，请重试' } }); },
          successStatusAbnormal(res) {
            done({ status: 'failed', response: { code: 500, msg: (res && res.msg) || '核销失败，请重试' } });
          }
        }));
      }, function (result) {
        cyLoading.hide();
        if (result.status === 'unknown') {
          callback({ code: 202, msg: '核销结果待确认，请勿重复核销；请先查看核销记录' });
          offerVerificationReadback(key, that._verificationWorkflow);
          return;
        }
        callback(result.response);
      });
      if (!submitted) cyLoading.hide();
      return submitted;
    },
    _leave(url) {
      this.triggerEvent('close')
      wx.navigateTo({ url })
    },
    goPlay() {
      const info = this.data.info || {};
      const registrationId = info.id || this.data.id;
      const ownerId = info.ownerId
        || (info.cmsTopic && info.cmsTopic.id)
        || (info.cmsActivity && info.cmsActivity.id);
      if (!registrationId || !ownerId) {
        this._leave('/subpackageMember/signup/index');
        return;
      }
      const isTopic = Number(info.ownerType) === 1 || !!info.cmsTopic;
      this._leave(isTopic
        ? '/pages/play/index?topicId=' + ownerId + '&registrationId=' + registrationId
        : '/pages/play/index?activityId=' + ownerId + '&registrationId=' + registrationId);
    },
    // 错误态唯一动作位:标签与行为一一对应,不出现「叫重试却在跳转」
    onErrorAction() {
      if (!this.data.id) {
        this.backToList();
        return;
      }
      this.setData({ loadState: 'loading', loadErrorText: '' });
      this.getData(this.data.id);
    },

    // 弹窗里「返回参与列表」= 关掉这一层回到宿主页(我的参与),不再猜页面栈。
    backToList() {
      this.triggerEvent('back');
    },

    goBack() {
      this.triggerEvent('back');
    },

    // 跳转到模板详情
    goInfo() {
      var that = this
      this._leave('/pages/templatedetail/templatedetail?id=' + that.data.info.templateId + '&scope=my');
    },

    // 核验扫码:与 merchant/index、member/index 复用同一套扫码路由(utils/verification-scan),
    // 不在本页重新实现一套核销逻辑
    goScanQR() {
      wx.scanCode({
        success: (res) => {
          const scan = resolveVerificationScan(res.result);
          if (scan.kind === 'invalid') {
            cyToast(scan.message);
            return;
          }
          this._submitVerification(scan.url + ':' + scan.code, scan.loadingTitle, {
            url: scan.url,
            data: scan.data,
            method: 'POST',
          }, (r) => {
              const d = r.data || {};
              // ponytail: 本页是快捷入口,不复刻 merchant/index 的选章面板 UI;一码对应多章节这种
              // 需要选章的场景引导去商家后台完整核销流程处理,而不是静默按失败提示。
              if (d.needChapterChoice || d.needStationChoice) {
                cyToast('该码含多个章节，请到商家后台核销');
                return;
              }
              if (r.code == '200') {
                cyToast.success(r.msg || scan.successTitle);
              } else {
                cyToast(r.msg || '核销失败');
              }
          });
        }
      });
    },

    // 获取数据
    getData: function () {
      const that = this;
      const requestEpoch = (this._detailRequestEpoch || 0) + 1;
      this._detailRequestEpoch = requestEpoch;
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: '/api/registration/info',
        data: { id: that.data.id },
        method: "POST",
        success: function (res) {
          if (requestEpoch !== that._detailRequestEpoch) return;
          if (res.code == "200" && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
            const info = res.data;

            // 准备显示数据
            const displayInfo = that.prepareDisplayData(info);

            that.setData({
              info: info,
              displayInfo: displayInfo,
              loadState: 'ready',
              loadErrorText: ''
            });
          } else {
            const fallback = res && res.code == "200" ? '参与详情数据暂不可用' : '获取参与详情失败，请重试';
            const msg = app.getRequestErrorMessage
              ? app.getRequestErrorMessage(res, fallback)
              : ((res && (res.msg || res.errMsg)) || fallback);
            that.setData({ loadState: 'error', loadErrorText: msg, errorActionText: '重试' });
          }
        },
        fail: function (res) {
          if (requestEpoch !== that._detailRequestEpoch) return;
          const fallback = '网络异常，请重试';
          const msg = app.getRequestErrorMessage
            ? app.getRequestErrorMessage(res, fallback)
            : ((res && (res.msg || res.errMsg)) || fallback);
          that.setData({ loadState: 'error', loadErrorText: msg, errorActionText: '重试' });
        }
      });
    },

    // 准备显示数据：字段真源 = /api/registration/info 回包(CmsRegistration + cmsTopic/cmsActivity)。
    // 此前这里按已退役的商家视图(view_registration_merchant)字段读(topicName/topicStartDate/
    // displayStatus…),8241de6e8 换接口后没换映射 —— 详情页整页空壳(未知主题/状态待确认)。
    // 现在名称/日期/封面取 cmsTopic|cmsActivity,状态与列表页、订单页同口径(summarizeOrderState)。
    prepareDisplayData(info) {
      const displayInfo = {};
      const source = info.cmsTopic || info.cmsActivity || {};
      const isTopic = Number(info.ownerType) === 1 || !!info.cmsTopic;

      // 1. 路线/活动名称
      displayInfo.topicName = info.activityTitle || trimmedString(source.name) || trimmedString(source.title) || '未知主题';

      // 2. 日期范围格式化
      displayInfo.formatDateRange = this.formatDateRange(source.startDate, source.endDate);

      // 3. 计算时间状态
      const timeStatus = this.calculateTimeStatus(source.startDate, source.endDate);
      displayInfo.isActivityEnded = timeStatus.isEnded;
      displayInfo.isActivityStarted = timeStatus.isStarted;
      displayInfo.isInThreeDaysRange = timeStatus.isInThreeDaysRange;
      displayInfo.remainingDays = timeStatus.remainingDaysText;
      displayInfo.isBeforeThreeDays = timeStatus.isBeforeThreeDays;
      displayInfo.daysToStart = timeStatus.daysToStart;

      // 4. 封面
      displayInfo.picUrl = trimmedString(source.imgUrl) || trimmedString(source.imgArr);

      // 5. 状态处理 —— 与「我的参与」列表、订单详情同一读模型
      const summary = summarizeOrderState(info);
      const statusVariantByKey = {
        not_started: 'info',
        in_progress: 'success',
        pending_payment: 'warning',
        refunding: 'warning',
      };
      displayInfo.statusText = summary.text;
      displayInfo.statusVariant = statusVariantByKey[summary.key] || 'neutral';
      displayInfo.refundText = summary.refundText;
      displayInfo.modeText = isTopic
        ? ((Number(info.purchaseKind) === 3 || Number(source.productType) === 2) ? '自由探索' : '城市定向')
        : '线下活动';
      displayInfo.modeVariant = displayInfo.modeText === '自由探索' ? 'success' : 'info';

      // 6. 活动说明
      displayInfo.activityDesc = trimmedString(info.activityDesc) || trimmedString(source.description);
      displayInfo.cooperateDateText = trimmedString(info.cooperateDate) || '接待时间待确认';
      displayInfo.hasCooperateDate = !!trimmedString(info.cooperateDate);
      displayInfo.hasNodeName = !!trimmedString(info.nodeName);

      const totalOrderNum = nonNegativeNumberOrNull(info.totalOrderNum);
      const verifiedNum = nonNegativeNumberOrNull(info.verifiedNum);
      const orderStatsKnown = totalOrderNum !== null && verifiedNum !== null && verifiedNum <= totalOrderNum;
      displayInfo.showOrderStats = info.status === 1;
      displayInfo.orderStatsKnown = orderStatsKnown;
      // UI-04(2026-09-18):订单数是数字统计,没取到显示 0,不再显示横杠
      displayInfo.pendingOrderText = orderStatsKnown ? String(totalOrderNum - verifiedNum) : '0';
      displayInfo.verifiedOrderText = orderStatsKnown ? String(verifiedNum) : '0';
      displayInfo.totalOrderText = orderStatsKnown ? String(totalOrderNum) : '0';

      // 7. 模板名称显示 - 使用视图中的templateName
      displayInfo.templateName = info.templateName || '';

      // 8. 主题图片 - 使用视图中的topicImgArr
      displayInfo.topicImage = info.topicImgArr || null;

      // 9. 规则说明
      displayInfo.hasRuleInstructions = info.ruleInstructions ? true : false;
      if (info.ruleInstructions) {
        displayInfo.ruleInstructions = info.ruleInstructions.length > 150
          ? info.ruleInstructions.substring(0, 150) + '...'
          : info.ruleInstructions;
      }

      // 10. 底部按钮状态
      // 需修改状态单独处理 - 使用视图中的displayStatus
      displayInfo.needModify = info.displayStatus === '需修改';

      // 取消参与按钮：与订单详情同口径(1-24 R9-17)—— 待支付单可取消;已付单只在读模型判为
      // 未开始/进行中时给(已吸收人工案件、核销、后端 refundInfo),不再按「开始前 3 天」猜。
      displayInfo.canCancel = !displayInfo.needModify &&
        (Number(info.registrationStatus) === 1 || summary.key === 'not_started' || summary.key === 'in_progress');

      // 联系客服按钮：不能自助取消时兜底(除需修改外)
      displayInfo.showContactService = !displayInfo.canCancel && !displayInfo.needModify;

      // 已结束状态
      displayInfo.isEnded = displayInfo.isActivityEnded;

      return displayInfo;
    },

    // 格式化日期范围
    formatDateRange(startDateStr, endDateStr) {
      if (!startDateStr || !endDateStr) return '';

      try {
        const formatDate = (dateStr) => {
          const date = new Date(dateStr.replace(/-/g, '/'));
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          return `${year}.${month}.${day}`;
        };

        const startFormatted = formatDate(startDateStr);
        const endFormatted = formatDate(endDateStr);

        return `${startFormatted} - ${endFormatted}`;
      } catch (error) {
        return '';
      }
    },

    // 计算时间状态
    calculateTimeStatus(startDateStr, endDateStr) {
      const result = {
        isEnded: false,
        isStarted: false,
        isBeforeStart: false,
        isBeforeThreeDays: false,
        isInThreeDaysRange: false,
        daysToStart: 0,
        remainingDaysText: ''
      };

      if (!startDateStr || !endDateStr) return result;

      try {
        const now = new Date();
        const startDate = new Date(toTimestamp(startDateStr));
        const endDate = new Date(toTimestamp(endDateStr));

        // 设置时间为当天的开始和结束
        // ★"今天零点"必须按中国自然日取,不能用 setHours(0,0,0,0)——那取的是运行环境本地零点,
        //   手机在 UTC 时会把中国的 7-26 02:00 归到 7-25,导致"还有几天开始"整整差一天。
        const todayStart = new Date(chinaDayStart(now));
        const todayEnd = new Date(chinaDayStart(now) + 24 * 60 * 60 * 1000 - 1);

        // 判断活动状态
        result.isEnded = now > endDate;
        result.isStarted = now >= startDate;
        result.isBeforeStart = now < startDate;

        if (result.isBeforeStart) {
          // 计算距离开始还有多少天
          const startDayStart = chinaDayStart(startDate.getTime());
          const diffTime = startDayStart - todayStart.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          result.daysToStart = diffDays;

          if (diffDays > 0) {
            result.remainingDaysText = `距离路线开始还剩${diffDays}天`;

            // 检查是否在开始前3天内
            result.isInThreeDaysRange = diffDays <= 3;

            // 检查是否在开始前3天以上
            result.isBeforeThreeDays = diffDays > 3;
          }
        } else if (result.isStarted && !result.isEnded) {
          // 活动进行中
          result.remainingDaysText = '';
          result.isInThreeDaysRange = false;
          result.isBeforeThreeDays = false;
        } else if (result.isEnded) {
          // 活动已结束
          result.remainingDaysText = '';
          result.isInThreeDaysRange = false;
          result.isBeforeThreeDays = false;
        }

      } catch (error) {
        console.error('计算时间状态错误:', error);
      }

      return result;
    },

    // 取消参与：已支付单必须走 cancel-refund(/api/registration/cancel 对已支付单必拒),
    // 文案与订单详情同源(utils/danger-actions.js),退款进度以接口回执为准。
    cancelParticipation() {
      const paid = Number((this.data.info || {}).paymentStatus) === 2;
      modal.show({
        dangerKey: paid ? 'order.cancel-refund' : 'order.cancel',
        dangerParams: {
          deadline: (this.data.info || {}).refundDeadlineDisplay || '已核销或已过开始时间不可退',
        },
        success: (res) => {
          if (res.confirm) {
            this.cancelRequest(paid);
          }
        }
      });
    },

    // 发送取消请求（添加列表刷新）
    cancelRequest(paid) {
      const that = this;
      cyLoading.show('取消中...');

      app.sendRequest({
        url: paid ? '/api/registration/cancel-refund' : '/api/registration/cancel',
        method: "POST",
        data: { id: that.data.id },
        success: function (res) {
          cyLoading.hide();

          if (res.code == "200") {
            cyToast.success(paid ? cancellationFeedback(res) : '取消成功', { duration: 2000 });
            // 取消成功 ⇒ 关掉详情回到列表,并通知宿主重拉(原来是 navigateBack 猜页面栈)
            that.triggerEvent('refresh');
            that.triggerEvent('back');
          } else {
            cyToast(res.msg || '取消失败', { duration: 2000 });
          }
        },
        fail: function (res) {
          cyLoading.hide();
          cyToast('网络错误，请重试', { duration: 2000 });
        }
      });
    },

    // 客服回调处理
    handleContact(e) {
      // 可以在这里处理客服会话的回调
    },

    // 去修改按钮点击:复用已上线的商家报名编辑器,避免把真实入口伪装成 toast。
    goModify() {
      if (!this.data.id) return;
      this._leave('/pages/topic/merchantapply/index?mode=1&id=' + encodeURIComponent(String(this.data.id)));
    }

  },
})
