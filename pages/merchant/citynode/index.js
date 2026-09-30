const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const motion = require('../../../utils/motion.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const merchantAccessPolicy = require('../../../utils/merchant-access-policy.js');

function scalarText(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback || '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return fallback || '—';
}

function strictNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function requestErrorText(res, fallback) {
  if (typeof app.getRequestErrorMessage === 'function') {
    return app.getRequestErrorMessage(res, fallback);
  }
  return scalarText(res && res.msg, fallback);
}

function normalizeNode(item) {
  if (!item || !item.poiId || scalarText(item.name) === '—') return null;
  return Object.assign({}, item, {
    name: scalarText(item.name),
    templateTitle: scalarText(item.templateTitle, '未绑定模板'),
    tagsText: scalarText(item.tags, ''),
    actionState: 'idle',
    actionError: '',
  });
}

function normalizeApplication(item) {
  if (!item || !item.id) return null;
  return Object.assign({}, item, {
    displayName: scalarText(item.name, '据点申请'),
    auditReasonText: scalarText(item.auditReason, ''),
    actionState: 'idle',
    actionError: '',
  });
}

function normalizeClaimable(item) {
  if (!item || !item.id || scalarText(item.name) === '—') return null;
  return Object.assign({}, item, {
    name: scalarText(item.name),
    descriptionText: scalarText(item.description || item.cityCode, '平台节点'),
    actionState: 'idle',
    actionError: '',
  });
}

function normalizeClaimableList(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(normalizeClaimable);
  return normalized.every(Boolean) ? normalized : null;
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    accessState: 'loading',
    accessErrorText: '',
    merchantAccess: merchantAccessPolicy.inactiveAccess(),
    loading: true,
    used: null,
    max: null,
    quotaState: 'loading',
    nodes: [],
    applications: [],
    loadErr: false,
    showClaim: false,
    claimable: [],
    claimState: 'idle',
    claimError: '',
    posterSheet: { show: false, poiId: '', state: 'idle', qrcodeUrl: '', nodeName: '', errorText: '' },
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    });
  },

  onShow() {
    merchantTheme.merchantPageShow();
    this.loadAccess();
  },

  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  // D-4 统一返回栏:与 cy-nav-bar 同语义;直接进来(无上一页)时退回工作台,避免箭头点了没反应
  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/index/index' });
  },

  loadAccess() {
    const that = this;
    this.setData({
      accessState: 'loading',
      accessErrorText: '',
      merchantAccess: merchantAccessPolicy.inactiveAccess(),
      loading: true,
      loadErr: false,
      nodes: [],
      applications: [],
      showClaim: false,
      claimable: [],
    });
    app.sendRequest({
      url: '/api/merchant/access/me', method: 'POST', hideLoading: true, silentError: true,
      success(res) {
        if (!(res && (res.code === '200' || res.code === 200))) {
          that.setData({ accessState: 'error', accessErrorText: (res && res.msg) || '商家权限没能读取', loading: false });
          return;
        }
        const access = merchantAccessPolicy.normalizeMerchantAccess(res.data);
        if (!access.active || !access.canManageProjects) {
          that.setData({ accessState: 'no-permission', merchantAccess: access, loading: false });
          return;
        }
        that.setData({ accessState: 'ready', merchantAccess: access });
        that.loadMine();
      },
      fail() {
        that.setData({ accessState: 'error', accessErrorText: '网络异常，商家权限没能读取', loading: false });
      },
      successStatusAbnormal() {
        that.setData({ accessState: 'error', accessErrorText: '商家权限没能读取', loading: false });
      },
    });
  },

  loadMine() {
    if (!this.data.merchantAccess.canManageProjects) return;
    const that = this;
    app.sendRequest({
      url: '/api/merchant/city-node/list', method: 'POST', hideLoading: true,
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      success(res) {
        if (res && (res.code === '200' || res.code === 200)) {
          const d = res.data || {};
          const used = strictNonNegativeInteger(d.used);
          const max = strictNonNegativeInteger(d.max);
          const quotaReady = used !== null && max !== null;
          that.setData({
            nodes: (Array.isArray(d.nodes) ? d.nodes : []).map(normalizeNode).filter(Boolean),
            applications: (Array.isArray(d.applications) ? d.applications : []).map(normalizeApplication).filter(Boolean),
            used: quotaReady ? used : null,
            max: quotaReady ? max : null,
            quotaState: quotaReady ? 'ready' : 'unknown',
            loading: false,
            loadErr: false,
            listEverLoaded: true   // 读到过一次后,刷新失败不 auto-back
          });
        } else {
          that.setData({ loading: false, loadErr: true, quotaState: 'unknown' });
        }
      },
      fail() { that.setData({ loading: false, loadErr: true, quotaState: 'unknown' }); }
    });
  },

  retry() {
    this.setData({ loading: true, loadErr: false, quotaState: 'loading' });
    if (this.data.accessState !== 'ready') this.loadAccess();
    else this.loadMine();
  },

  retryQuota() {
    this.setData({ quotaState: 'loading' });
    this.loadMine();
  },

  goCreate() {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    if (this.data.quotaState !== 'ready') {
      toast('据点配额暂未取回，请重试');
      this.retryQuota();
      return;
    }
    if (this.data.used >= this.data.max) {
      return toast(this.data.max === 0 ? '当前没有据点配额' : '在架据点已满，请先下线一个');
    }
    wx.navigateTo({ url: '/pages/merchant/citynode/create/index' });
  },

  toggleClaim() {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    const showClaim = !this.data.showClaim;
    this.setData({ showClaim: showClaim });
    if (showClaim && this.data.claimState === 'idle') this.loadClaimable();
  },

  loadClaimable() {
    if (!this.data.merchantAccess.canManageProjects) return;
    if (this.data.claimState === 'loading') return;
    const that = this;
    this.setData({ claimState: 'loading', claimError: '' });
    app.sendRequest({
      url: '/api/merchant/city-node/claimable', method: 'POST', hideLoading: true, silentError: true,
      success(res) {
        if (!res || (res.code !== '200' && res.code !== 200)) {
          that.setClaimLoadError(requestErrorText(res, '可认领节点加载失败'));
          return;
        }
        const claimable = normalizeClaimableList(res.data);
        if (!claimable) {
          that.setClaimLoadError('可认领节点数据暂不可用');
          return;
        }
        that.setData({ claimable: claimable, claimState: 'ready', claimError: '' });
      },
      fail() { that.setClaimLoadError('网络异常，检查网络后重试'); },
      successStatusAbnormal(res) { that.setClaimLoadError(requestErrorText(res, '可认领节点加载失败')); },
    });
  },

  setClaimLoadError(message) {
    this.setData({ claimState: 'error', claimError: message || '可认领节点加载失败' });
  },

  retryClaimable() {
    this.loadClaimable();
  },

  setClaimAction(poiId, actionState, actionError) {
    const key = String(poiId);
    this.setData({
      claimable: this.data.claimable.map(function (item) {
        if (String(item.id) !== key) return item;
        return Object.assign({}, item, { actionState: actionState, actionError: actionError || '' });
      })
    });
  },

  submitClaim(e) {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    const poiId = Number(e.currentTarget.dataset.poiid || 0);
    if (!Number.isInteger(poiId) || poiId <= 0) return;
    const row = this.data.claimable.find(function (item) { return String(item.id) === String(poiId); });
    if (!row || row.actionState === 'loading') return;
    const that = this;
    this.setClaimAction(poiId, 'loading', '');
    app.sendRequest({
      url: '/api/merchant/city-node/claim', method: 'POST', data: { poiId: poiId }, hideLoading: true, silentError: true,
      success(res) {
        if (res && (res.code === '200' || res.code === 200)) {
          toast.success('认领申请已提交');
          that.setData({ showClaim: false, claimable: [], claimState: 'idle', claimError: '' });
          that.loadMine();
        } else {
          that.setClaimAction(poiId, 'error', requestErrorText(res, '认领申请提交失败'));
        }
      },
      fail() { that.setClaimAction(poiId, 'error', '网络异常，检查网络后重试'); },
      successStatusAbnormal(res) { that.setClaimAction(poiId, 'error', requestErrorText(res, '认领申请提交失败')); },
    });
  },

  retryClaim(e) {
    this.submitClaim(e);
  },

  setApplicationAction(applicationId, actionState, actionError) {
    const key = String(applicationId);
    this.setData({
      applications: this.data.applications.map(function (item) {
        if (String(item.id) !== key) return item;
        return Object.assign({}, item, { actionState: actionState, actionError: actionError || '' });
      })
    });
  },

  /** 撤回自己的待审认领:节点会重新回到可认领池,别人才能认领 —— 不做撤回,这个节点会锁在「已有待审申请」。 */
  cancelClaim(e) {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    const poiId = Number(e.currentTarget.dataset.poiid || 0);
    if (!Number.isInteger(poiId) || poiId <= 0) return;
    const row = this.data.applications.find(function (item) { return String(item.id) === String(poiId); });
    if (!row || row.actionState === 'loading') return;
    if (Number(row.applicationType) !== 2 || Number(row.auditStatus) !== 0) return;
    const that = this;
    this.setApplicationAction(poiId, 'loading', '');
    app.sendRequest({
      url: '/api/merchant/city-node/claim/cancel', method: 'POST', data: { poiId: poiId }, hideLoading: true, silentError: true,
      success(res) {
        if (res && (res.code === '200' || res.code === 200)) {
          toast.success('已撤回认领申请');
          // 节点已回到可认领池:作废这一份缓存,下次打开认领面板重新拉
          that.setData({ claimState: 'idle', claimError: '', claimable: [] });
          that.loadMine();
        } else {
          that.setApplicationAction(poiId, 'error', requestErrorText(res, '撤回申请失败'));
        }
      },
      fail() { that.setApplicationAction(poiId, 'error', '网络异常，检查网络后重试'); },
      successStatusAbnormal(res) { that.setApplicationAction(poiId, 'error', requestErrorText(res, '撤回申请失败')); },
    });
  },

  retryCancel(e) {
    this.cancelClaim(e);
  },

  showPosterCode(e) {
    const poiId = e && e.currentTarget && e.currentTarget.dataset.poiid;
    if (!poiId) return;
    this.loadPosterCode(poiId);
  },

  loadPosterCode(poiId) {
    if (!this.data.merchantAccess.canVerify) {
      return toast('当前岗位没有核销权限');
    }
    const that = this;
    const requestId = (this._posterRequestId || 0) + 1;
    this._posterRequestId = requestId;
    this.setData({
      posterSheet: {
        show: true,
        poiId: poiId,
        state: 'loading',
        qrcodeUrl: '',
        nodeName: '',
        errorText: '',
      }
    });
    app.sendRequest({
      url: '/api/merchant/city-node/poster-code', method: 'POST', data: { poiId: poiId }, hideLoading: true, silentError: true,
      success(res) {
        if (requestId !== that._posterRequestId) return;
        const d = (res && res.data) || {};
        const qrcodeUrl = typeof d.qrcodeUrl === 'string' ? d.qrcodeUrl.trim() : '';
        if (res && (res.code === '200' || res.code === 200) && qrcodeUrl) {
          that.setData({
            posterSheet: {
              show: true,
              poiId: poiId,
              state: 'ready',
              qrcodeUrl: qrcodeUrl,
              nodeName: scalarText(d.nodeName),
              errorText: '',
            }
          });
          return;
        }
        that.setPosterCodeError(poiId, scalarText(d.nodeName, ''), '打卡码暂时没能生成，请稍后重试');
      },
      fail() {
        if (requestId === that._posterRequestId) that.setPosterCodeError(poiId, '', '网络异常，检查网络后重新取码');
      },
      successStatusAbnormal() {
        if (requestId === that._posterRequestId) that.setPosterCodeError(poiId, '', '打卡码暂时没能生成，请稍后重试');
      },
    });
  },

  setPosterCodeError(poiId, nodeName, errorText) {
    this.setData({
      posterSheet: {
        show: true,
        poiId: poiId,
        state: 'error',
        qrcodeUrl: '',
        nodeName: nodeName,
        errorText: errorText,
      }
    });
  },

  retryPosterCode() {
    const poiId = this.data.posterSheet.poiId;
    if (poiId) this.loadPosterCode(poiId);
  },

  closePosterCode() {
    this._posterRequestId = (this._posterRequestId || 0) + 1;
    this.setData({ 'posterSheet.show': false });
  },

  setNodeAction(poiId, actionState, actionError) {
    const key = String(poiId);
    this.setData({
      nodes: this.data.nodes.map(function (item) {
        if (String(item.poiId) !== key) return item;
        return Object.assign({}, item, { actionState: actionState, actionError: actionError || '' });
      })
    });
  },

  toggleNode(e) {
    if (!this.data.merchantAccess.canManageProjects) {
      return toast('当前岗位没有据点管理权限');
    }
    const poiId = e.currentTarget.dataset.poiid;
    const row = this.data.nodes.find(function (item) { return String(item.poiId) === String(poiId); });
    if (!row || row.actionState === 'loading') return;
    const status = Number(row.status);
    const next = status === 1 ? 0 : 1;
    const that = this;
    this.setNodeAction(poiId, 'loading', '');
    app.sendRequest({
      url: '/api/merchant/city-node/offline', method: 'POST', data: { poiId: poiId, status: next }, hideLoading: true, silentError: true,
      success(res) {
        if (res && (res.code === '200' || res.code === 200)) {
          that.setNodeAction(poiId, 'idle', '');
          toast(res.data || '已更新');
          that.loadMine();
        } else {
          that.setNodeAction(poiId, 'error', requestErrorText(res, next === 1 ? '上架失败' : '下线失败'));
        }
      },
      fail() { that.setNodeAction(poiId, 'error', '网络异常，检查网络后重试'); },
      successStatusAbnormal(res) {
        that.setNodeAction(poiId, 'error', requestErrorText(res, next === 1 ? '上架失败' : '下线失败'));
      },
    });
  },

  retryToggle(e) {
    this.toggleNode(e);
  },

  // C2 扫码核销:扫玩家「据点核销码」→ 后端校验归属+幂等后发券给玩家(防伪造GPS白领券)
  scanRedeem() {
    if (!this.data.merchantAccess.canVerify) {
      return toast('当前岗位没有核销权限');
    }
    const that = this;
    wx.scanCode({
      onlyFromCamera: true, scanType: ['qrCode'],
      success(sc) {
        const code = sc.result;
        if (!code) return toast('未识别到核销码');
        app.sendRequest({
          url: '/api/verify/citynode/redeem', method: 'POST', data: { code: code },
          success(res) {
            if (res.code === '200' || res.code === 200) {
              motion.haptic({ type: 'medium', reducedMotion: readReducedMotion() });
              toast(res.data && res.data.couponGranted === false ? '核销成功，该券已失效或停发，未发放' : '核销成功，优惠券已发放给玩家');
            } else {
              modal.show({ title: '核销失败', content: (res && res.msg) || '请重试', showCancel: false });
            }
          },
          fail() { toast('网络异常，请重试'); },
        });
      },
      fail(err) {
        const message = err && err.errMsg || '';
        if (!/cancel/i.test(message)) {
          toast('扫码失败，请重试');
        }
      },
    });
  }
});
