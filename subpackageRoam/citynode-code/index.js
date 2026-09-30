// C2 玩家据点核销码:到店打卡完成后出码,商家扫码后端校验发券(防伪造GPS白领券)
const app = getApp();
const { DYN_TTL_MS } = require('../../utils/verification-scan.js');
const ISSUE_ERROR_MESSAGE = '暂时无法生成核销码，请稍后重试';
/* CU-M-53:据点码是一串只能靠二维码扫的签名令牌,「有 code」不等于「出码成功」。
   图缺时 cy-qr-voucher 会退回把长串当文字铺满码区(那条退路是给短券码的),
   看起来仍可扫,商家实际扫不出 ⇒ 券发不出。没图就是没出成码,单独给一句实话。 */
const NO_QRCODE_MESSAGE = '核销码二维码没能生成，请重试';

Page({
  data: {
    poiId: null,
    name: '据点',
    qrcodeUrl: '',
    code: '',
    countdown: 0,
    // missing 与 error 必须分家:缺参不可能靠重试变出参数,给它重试就是假按钮。
    state: 'loading', // loading | ready | error | missing
    errMsg: '',
  },

  onLoad(options) {
    const poiId = options.poiId || null;
    this.setData({
      poiId: poiId,
      name: options.name ? decodeURIComponent(options.name) : '据点',
    });
    if (!poiId) {
      this.setData({ state: 'missing' });
      return;
    }
    this.issue();
  },

  // 缺参态的唯一真出口(cy-qr-voucher 压根不渲染,不存在组件内那个假重试)
  onMissingBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/roam/index' });
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },

  issue() {
    const that = this;
    this.setData({ state: 'loading', errMsg: '', qrcodeUrl: '', code: '' });
    app.sendRequest({
      url: '/api/verify/citynode/issue', method: 'POST',
      data: { poiId: that.data.poiId }, hideLoading: true,
      success(res) {
        const ok = res && (res.code === '200' || res.code === 200) && res.data && res.data.code;
        if (ok) {
          const d = res.data;
          if (!d.qrcodeUrl) {
            that.setData({ state: 'error', errMsg: NO_QRCODE_MESSAGE });
            return;
          }
          that.setData({ qrcodeUrl: d.qrcodeUrl, code: d.code, state: 'ready' });
          that.startCountdown(Math.floor((d.ttlMs || DYN_TTL_MS) / 1000));
        } else {
          that.setData({ state: 'error', errMsg: ISSUE_ERROR_MESSAGE });
        }
      },
      fail() { that.setData({ state: 'error', errMsg: '网络异常，请检查网络后重试' }); },
      successStatusAbnormal() { that.setData({ state: 'error', errMsg: ISSUE_ERROR_MESSAGE }); },
    });
  },

  startCountdown(sec) {
    const that = this;
    if (this._timer) clearInterval(this._timer);
    this.setData({ countdown: sec });
    this._timer = setInterval(function () {
      const c = that.data.countdown - 1;
      if (c <= 0) {
        clearInterval(that._timer);
        that.setData({ countdown: 0 });
        that.issue(); // 过期自动重新出码
      } else {
        that.setData({ countdown: c });
      }
    }, 1000);
  },

  onRetry() { this.issue(); },

  // cy-qr-voucher 关闭:退出出码页
  onClose() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/roam/index' });
  },
});
