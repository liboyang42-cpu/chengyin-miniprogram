// M0-2 优惠券出示与核销闭环
// 动态二维码(couponHistoryId + 60s 签名 token,倒计时自动刷新) + 每 5s 轮询核销状态
const cyToast = require('../../utils/toast.js');
const app = getApp();
const credential = require('../../utils/coupon-credential.js');
const { readReducedMotion } = require('../../utils/motion-preference.js');
const datetime = require('../../utils/datetime.js');

// 换码失败后的受控自动重试间隔:等待壳/错误态不再永久冻结,到点后自动重取真实 token。
const RETRY_DELAY_MS = 5000;
// 后端二维码 TTL 保守下界(expiresIn 60s + 30s 余量)。hide/show 恢复时,
// 只有仍在窗口内的同 owner 凭证才允许保留;超出即下屏重取。
const CREDENTIAL_TTL_MS = 90000;

// 凭证归属主键:当前登录会员 id。取不到时返回 '',按「无法证明同一所有者」处理 ——
// 宁可不保留可疑凭证,也不把上一账号的码留在屏上。
function currentOwnerId() { return credential.currentOwnerId(app); }

Page({
  data: {
    reducedMotion: false,
    couponHistoryId: null,
    entryState: 'loading', // ready | missing-param
    coupon: {},          // { couponName, description, startTimeText, endTimeText }
    qrcodeUrl: '',
    qrState: 'loading',  // cy-qr-voucher state:loading | ready | error
    errMsg: '',          // error 态只展示面向用户的稳定文案
    pollError: '',       // 有可用码时的非阻断核销状态提示
    countdown: 60,
    useStatus: 0,        // 0未用 1已核销 2过期 3已失效(平台手动失效)
    useTimeText: '',
    notStarted: false    // 使用期承诺:start 前展示等待,不出码
  },

  onLoad(options) {
    const params = options || {};
    const id = params.couponHistoryId || params.historyId || params.id || null;
    // 生命周期代际 + 请求序号:onHide/onUnload 后的旧回包一律作废,onShow 能立即发当前请求。
    this._epoch = 0;
    this._reqSeq = 0;
    this._refreshing = false;
    this._tokenTask = null;
    this._retryAt = 0;
    // 已渲染凭证的归属戳:undefined = 未打标(旧态/手工态,按同 owner 兼容)。
    this._codeOwner = undefined;
    this._codeCouponId = null;
    this._codeIssuedAt = 0;
    this._codeTtlMs = 0;
    this.setData({
      couponHistoryId: id,
      entryState: id ? 'ready' : 'missing-param'
    });
    if (params.name) {
      this.setData({ 'coupon.couponName': decodeURIComponent(params.name) });
    }
  },

  onShow() {

    const reducedMotion = readReducedMotion();

    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
    if (!this.data.couponHistoryId) {
      return;
    }
    // 终态只属于原 owner+券；切换上下文必须清掉原券状态/私有说明，新券可重新取真实0。
    const owner = currentOwnerId();
    if (!this.requireOwner()) return;
    const historyId = String(this.data.couponHistoryId);
    if (this._sessionOwner !== undefined
        && (this._sessionOwner !== owner || this._sessionHistoryId !== historyId)) {
      this.setData({ useStatus: 0, useTimeText: '', coupon: {}, notStarted: false });
    }
    this._sessionOwner = owner;
    this._sessionHistoryId = historyId;
    // 新一次可见会话:先废掉上一代在途请求,再发当前请求(不被旧 _refreshing 挡住)。
    this._abortTokenRequest();
    this._epoch = (this._epoch || 0) + 1;
    this._refreshing = false;
    // 同 owner+同券+后端 TTL 内:保留已显示的有效码(后台刷新续期,不清不闪);
    // 换 owner / 无法证明归属 / 已超 TTL:先下屏为 loading,拿到当前真实 token 才亮码。
    if (!this._keepRenderedCredential()) this._clearRenderedCredential();
    this.refreshToken();
    this.startCountdown();
    this.startPolling();
  },

  onHide() { this._endSession(); },

  onUnload() { this._endSession(); },

  // 离页/换代的统一收口:作废在途 token 请求、换代、允许下一次 onShow 立即重发。
  _endSession() {
    this._epoch = (this._epoch || 0) + 1;
    this._refreshing = false;
    this._abortTokenRequest();
    this.clearTimers();
  },

  // 已渲染凭证是否属于「当前 owner + 当前券」。未打标(undefined)按同 owner 兼容,
  // 不误伤手工/旧态;当前 owner 不可得 = 无法证明同一归属,一律不保留。
  _codeBelongsToCurrentOwner() {
    const owner = currentOwnerId();
    if (!owner) return false;
    if (this._codeOwner === undefined) return true;
    return this._codeOwner === owner
      && String(this._codeCouponId) === String(this.data.couponHistoryId);
  },

  // 把已渲染凭证从屏上撤掉并复位为等待新 token 的 loading(不把旧 owner 的码留给当前/下一账号)。
  _clearRenderedCredential() {
    this._codeOwner = undefined;
    this._codeCouponId = null;
    this._codeIssuedAt = 0;
    this._codeTtlMs = 0;
    if (this.data.qrcodeUrl || this.data.qrState === 'ready' || this.data.errMsg || this.data.pollError) {
      this.setData({ qrcodeUrl: '', qrState: 'loading', errMsg: '', pollError: '' });
    }
  },

  // hide/show 恢复时能否保留屏上的码:必须同时满足 同 owner+同券、未使用、仍在后端 TTL 内。
  // 保留能力不等于放宽核销 —— 服务端 CAS 仍是最终闸门,这里只避免"从后台回来先清空再失败"。
  _credentialWithinTtl() {
    const issuedAt = this._codeIssuedAt || 0;
    const ttl = this._codeTtlMs || 0;
    return !!issuedAt && !!ttl && (issuedAt + ttl) - Date.now() > 1000;
  },

  _keepRenderedCredential() {
    if (!this._codeBelongsToCurrentOwner()) return false;
    if (this.data.useStatus !== 0 || !this.data.qrcodeUrl) return false;
    return this._credentialWithinTtl();
  },

  // cy-qr-voucher 关闭:退出出示页
  onClose() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/member/index/index' });
  },

  clearTimers() {
    if (this._countTimer) { clearInterval(this._countTimer); this._countTimer = null; }
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  },

  friendlyQrError(message, fallback) {
    const text = String(message || '');
    if (/登录|认证|401|token/i.test(text)) return '登录已过期，请重新进入';
    if (/网络|timeout|fail|502|503/i.test(text)) return '网络异常，请稍后重试';
    return fallback || '二维码暂时没能生成，请稍后重试';
  },

  // 中止在途 token 请求:onHide/onUnload/onShow 换代时调用,物理断掉旧回包(无 abort 通道时由代际兜底)。
  _abortTokenRequest() {
    if (this._tokenTask && typeof this._tokenTask.abort === 'function') this._tokenTask.abort();
    this._tokenTask = null;
  },

  // 拉取新 token + 二维码图片(后端渲染,含券展示信息)
  // 在途闸防连发(倒计时卡 1 每秒重发/胶囊连点);失败走 onRefreshFail;后台静默换码不闪 loading
  // 归属守卫:回调同时核 页代际 + 请求序号 + 券 id + 当前 owner,旧/他人响应不得写屏。
  refreshToken() {
    if (!this.requireOwner()) return;
    if (this._refreshing) return;
    const owner = currentOwnerId();
    // owner 或券 id 在页存活期变化:旧归属凭证先下屏,失败也不得保留。
    if (this._codeOwner !== undefined && !this._codeBelongsToCurrentOwner()) {
      this._clearRenderedCredential();
      this.setData({ coupon: {}, useTimeText: '', useStatus: 0, notStarted: false });
    }
    const epoch = this._epoch || 0;
    const seq = (this._reqSeq = (this._reqSeq || 0) + 1);
    const couponHistoryId = this.data.couponHistoryId;
    this._refreshing = true;
    const that = this;
    const stale = () => !that.requireOwner() || epoch !== (that._epoch || 0) || seq !== that._reqSeq
      || couponHistoryId !== that.data.couponHistoryId
      || owner !== currentOwnerId();
    if (that.data.qrState === 'error') {
      that.setData({ qrState: 'loading' });
    }
    // 从发起请求计 TTL 是保守下界；图片生成/传输耗时不能被当作额外有效期。
    const requestedAt = Date.now();
    const control = app.sendRequest({
      url: '/api/coupon/qr-token',
      method: 'POST',
      // 本页状态机负责稳定的人话错误，禁止 request-client 先弹原始 API/鉴权信息。
      silentError: true,
      data: { couponHistoryId },
      success(res) {
        if (stale()) return;
        if (res && res.code == 410) { that.onCredentialUnavailable(res.msg); return; }
        if (res && (res.code == 200 || res.code == '200') && res.data) {
          const d = res.data;
          const parsed = credential.parseQrReply(d);
          if (!parsed) { that.onRefreshFail('券码状态暂时无法确认，请稍后重试'); return; }
          if (d.useStatus == 0 && Date.now() - requestedAt >= CREDENTIAL_TTL_MS - 1000) {
            that.onRefreshFail('二维码生成超时，请重新获取');
            return;
          }
          const patch = {
            qrcodeUrl: parsed.qr,
            qrState: parsed.status === 0 ? 'ready' : 'loading',
            countdown: parsed.countdown,
            // 成功取到当前真实 token 后必须清掉上一次失败正文,否则等待壳会一直复述旧错误。
            errMsg: ''
          };
          // 使用期承诺:start 前后端仍会拒绝核销,前端据此只展示等待与可用时间,
          // 不倒计时亮码、也不误报「已过期」。start 由后端 qr-token 的完整时间给出。
          patch.notStarted = that.notStartedAt(d.startTime);
          // useStatus 是服务端请求时快照:迟到响应不许把已核销/已过期/已失效打回未使用
          const wasUnused = that.data.useStatus == 0;
          const terminal = that.data.useStatus == 1 || that.data.useStatus == 2 || that.data.useStatus == 3;
          if (d.useStatus != null && (!terminal || d.useStatus == 1)) patch.useStatus = d.useStatus;
          if (d.couponName) patch['coupon.couponName'] = d.couponName;
          if (d.description) patch['coupon.description'] = d.description;
          // 有效期展示只到日(全站统一口径);判定仍用完整时间(见 notStartedAt)
          if (d.startTime) patch['coupon.startTimeText'] = datetime.formatDayDots(d.startTime);
          if (d.endTime) patch['coupon.endTimeText'] = datetime.formatDayDots(d.endTime);
          that._retryAt = 0;
          that._codeOwner = owner;
          that._codeCouponId = couponHistoryId;
          that._codeIssuedAt = patch.qrcodeUrl ? requestedAt : 0;
          that._codeTtlMs = patch.qrcodeUrl ? CREDENTIAL_TTL_MS : 0;
          that.setData(patch);
          if (patch.useStatus == 1 && wasUnused) that.onVerified();
          else if (patch.useStatus == 2) that.clearTimers();
          else if (patch.useStatus == 3) that.clearTimers();
          else if (patch.useStatus == 0) { that.startCountdown(); that.startPolling(); }
        } else {
          that.onRefreshFail((res && res.msg) || '出码失败');
        }
      },
      // HTTP 非 200(如部署窗口 502):request-client 既不走 success 也不走 fail,必须接这里
      successStatusAbnormal(res) {
        if (stale()) return;
        if (res && res.code == 410) { that.onCredentialUnavailable(res.msg); return; }
        that.onRefreshFail((res && res.msg) || '出码失败');
      },
      fail(err) {
        if (stale()) return;
        // 提供 fail 会替掉 request-client 401 重登失败的默认"登录已过期"toast,此处补回区分
        const expired = err && (err.code == 401 || err.code == 2);
        that.onRefreshFail(expired ? '登录已过期，请重新进入' : '网络异常，请重试');
      },
      complete() {
        // 数据写入按 stale 拦;在途锁只允许「最新一发」释放,旧 complete 不得清新请求的锁。
        if (seq !== that._reqSeq) return;
        that._refreshing = false;
        that._tokenTask = null;
      }
    });
    if (control && typeof control.abort === 'function') this._tokenTask = control;
  },

  requireOwner() {
    if (currentOwnerId()) return true;
    this._endSession();
    this._clearRenderedCredential();
    this.setData({ coupon: {}, useTimeText: '', useStatus: null, notStarted: false, countdown: 0, qrState: 'error', errMsg: '登录状态待确认，请登录后重试' });
    return false;
  },

  onCredentialUnavailable(message) {
    this._reqSeq = (this._reqSeq || 0) + 1;
    this._epoch = (this._epoch || 0) + 1;
    this._refreshing = false;
    this._abortTokenRequest();
    this.clearTimers();
    this._clearRenderedCredential();
    this.setData({ useStatus: null, notStarted: false, qrState: 'error', errMsg: message || '优惠券已撤销或不存在' });
  },

  // 刷新失败分级:同 owner 且屏上的码仍在后端 TTL 内(expiresIn 60s 留 30s 余量)就保持 ready 只提示;
  // 归属可疑 / 无有效码 → 一律下屏切 error,并写入退避让倒计时节拍受控重取。
  onRefreshFail(msg) {
    // P3-3:用精确签发时刻+TTL 判定,而不是倒计时近似 —— 倒计时走到 0/1 时后端 token 可能仍有约 30s。
    if (this._codeBelongsToCurrentOwner() && !this.data.notStarted
        && this.data.qrcodeUrl && this.data.qrState === 'ready' && this._credentialWithinTtl()) {
      cyToast('刷新失败，当前码仍可用');
    } else {
      this._clearRenderedCredential();
      this._retryAt = Date.now() + RETRY_DELAY_MS;
      this.setData({ qrState: 'error', errMsg: this.friendlyQrError(msg, '二维码暂时没能生成，请稍后重试') });
    }
  },

  // 核销状态轮询与二维码可用性是两条独立链路。同 owner 有 TTL 内的码就保留凭证，只提示状态暂未同步；
  // 归属可疑或真正无码时才让凭证进入阻断错误态。
  onPollFail(message) {
    const text = message || '核销状态暂不可用，请稍后重试';
    if (this._codeBelongsToCurrentOwner() && !this.data.notStarted
        && this.data.qrcodeUrl && this.data.qrState === 'ready' && this.data.countdown > 0) {
      this.setData({ pollError: text });
      return;
    }
    this._clearRenderedCredential();
    this._retryAt = Date.now() + RETRY_DELAY_MS;
    this.setData({ qrState: 'error', errMsg: text, pollError: '' });
  },

  startCountdown() {
    if (!this.requireOwner()) return;
    const that = this;
    if (this._countTimer) clearInterval(this._countTimer);
    this._countTimer = setInterval(() => {
      if (!that.requireOwner()) return;
      if (!that._codeBelongsToCurrentOwner()) { that.refreshToken(); return; }
      if (that.data.useStatus != 0) return;
      if (that._codeIssuedAt && that.data.qrcodeUrl && !that._credentialWithinTtl()) {
        that.setData({ qrcodeUrl: '', qrState: 'loading' });
      }
      if (that.data.qrState === 'error') {
        // 失败恢复:写入退避后到点自动重取真实 token(不再永久冻结),到 start 即可拿到新码。
        const now = Date.now();
        if (!that._retryAt || now >= that._retryAt) {
          that._retryAt = now + RETRY_DELAY_MS;
          that.refreshToken();
        }
        return;
      }
      const c = that.data.countdown - 1;
      if (c <= 0) {
        that.refreshToken(); // 到点换新 token/二维码(refreshToken 会重置 countdown)
        return;
      }
      that.setData({ countdown: c });
    }, 1000);
  },

  startPolling() {
    if (!this.requireOwner()) return;
    const that = this;
    if (this._pollTimer) clearInterval(this._pollTimer);
    const epoch = this._epoch || 0;
    const polledHistoryId = String(this.data.couponHistoryId || '');
    const owner = currentOwnerId();
    // 所有回包都核 请求代际 + 券 id + 当前 owner(与 refreshToken 的 stale 同义,轮询链路独立收口)。
    const stillCurrent = () => that.requireOwner() && epoch === (that._epoch || 0)
      && owner === currentOwnerId()
      && String(that.data.couponHistoryId || '') === polledHistoryId;
    this._pollTimer = setInterval(() => {
      if (!stillCurrent()) return; // 离页/换代/换券的旧节拍不再发请求
      // 1 已核销、2 已过期都是终态:停止轮询,不得为终态券继续空转(与场景组件同口径)。
      if (that.data.useStatus != 0) { that.clearTimers(); return; }
      app.sendRequest({
        url: '/api/coupon/status',
        method: 'POST',
        // 轮询失败由本页状态机承接，禁止把原始接口路径弹成灰色 toast 覆盖凭证卡。
        silentError: true,
        data: { couponHistoryId: that.data.couponHistoryId },
        success(res) {
          if (!stillCurrent()) return;
          if (res && res.code == 410) { that.onCredentialUnavailable(res.msg); return; }
          if (res && (res.code == 200 || res.code == '200') && res.data) {
            const st = credential.couponStatus(res.data.useStatus);
            if (st === null) { that.onPollFail('核销状态暂不可用，请稍后重试'); return; }
            // 已核销/已过期/已失效属于本会话的终态，旧轮询快照不能将它退回未使用。
            if ((that.data.useStatus == 1 || that.data.useStatus == 2 || that.data.useStatus == 3) && st == 0) return;
            that.setData({ pollError: '' });
            if (st == 1 && that.data.useStatus != 1) {
              that.setData({ useStatus: 1, useTimeText: that.fmt(res.data.useTime) });
              that.onVerified();
            } else if (st != null) {
              that.setData({ useStatus: st });
              // 过期(2)到达即停表;后续节拍也会被终态守卫拦住。
              if (st != 0) that.clearTimers();
            }
          }
        },
        successStatusAbnormal(res) {
          if (!stillCurrent()) return;
          if (res && res.code == 410) { that.onCredentialUnavailable(res.msg); return; }
          if (that.data.useStatus == 0 && that.data.qrState !== 'error') {
            that.onPollFail(that.friendlyQrError(res && res.msg, '核销状态暂不可用，请稍后重试'));
          }
        },
        fail(err) {
          if (!stillCurrent()) return;
          if (that.data.useStatus == 0 && that.data.qrState !== 'error') {
            that.onPollFail(that.friendlyQrError(err && err.msg, '网络异常，请稍后重试'));
          }
        }
      });
    }, 5000);
  },

  // 核销成功:停计时 + 轻震动(绿章动画由 wxss 呈现)
  onVerified() {
    this.clearTimers();
    if (wx.vibrateShort) {
      wx.vibrateShort({ type: 'medium' });
    }
  },

  fmt(t) {
    if (!t) return '';
    try {
      return String(t).replace('T', ' ').slice(0, 16);
    } catch (e) {
      return '';
    }
  },

  // 等待壳/错误态的显式重试:清退避 + 作废旧在途,立即取新 token(取得当前真实 token 才算恢复)。
  retryNow() {
    this._retryAt = 0;
    this._abortTokenRequest();
    this._refreshing = false;
    this.refreshToken();
  },

  // 无法解析时按已开始处理:前端只负责展示,服务端核销闸门才是权威判定。
  notStartedAt(value) {
    if (!value) return false;
    const parsed = datetime.toTimestamp(value);
    return !isNaN(parsed) && parsed > Date.now();
  }
});
