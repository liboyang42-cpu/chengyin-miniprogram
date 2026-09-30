const toast = require('../../../utils/toast.js');
const app = getApp();
const { readReducedMotion } = require('../../../utils/motion-preference.js');

function money(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

// 阵容行只带 toType/toId+条款(后端 PricingResult.Lineup 无名称),列表先用类型兜底、名称异步补齐
function termsText(row) {
  if (row.shareMode === 1) return '分成型 · ' + (row.shareRate != null && row.shareRate !== '' ? row.shareRate + '%' : '—');
  if (row.shareMode === 2) return '固定 · ¥' + (row.fixedFee != null && row.fixedFee !== '' ? row.fixedFee : '—') + '/人';
  return '引流型';
}

// CU-C-70:有人带的地板价第一步就是「带队成本 ÷ 成团人数」。人数空/0 时后端把带队成本
// 当 0 摊(或直接报错),而旧页面只拿 min>=floor 自校验 —— floor=0 时 0>=0 恒真,
// 零价也能点「确认终价并开售」。判定收口在下面两个函数,按钮禁用态与输入提示共用。
function teamSizeOk(subType, teamSize) {
  if (subType !== 'guided') return true;
  if (teamSize === '' || teamSize === null || teamSize === undefined) return false;
  const n = Number(teamSize);
  return Number.isFinite(n) && n > 0;
}

function teamSizeErrorText(subType, teamSize) {
  if (subType !== 'guided' || teamSizeOk(subType, teamSize)) return '';
  return '有人带定价需填写成团人数（大于 0），否则带队成本会被算成 0 元';
}

Page({
  data: {
    // 2026-08-05 tab 收敛:全仓最后一处手写 tab。原本是 .pg-tabs/.pg-tab 自绘的
    // segmented 形态(容器灰底 + 选中项白底提亮),cy-tabs 的 segmented 变体同款。
    typeTabs: [{ key: 'guided', label: '有人带' }, { key: 'self', label: '无人带' }],
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    reducedMotion: false,
    topicId: null,
    subType: 'guided',
    leadCost: '',
    teamSize: '',
    loading: true,
    hasPreview: false,
    errorText: '',
    floor: 0,
    floorText: '—',
    finalPrice: 0,
    sliderMax: 100,
    referenceText: '样本不足，暂不展示参考价',
    referencePrice: null,
    referenceDeltaText: '',
    saving: false,
    submitError: '',
    canConfirmPrice: false,
    phaseBlocked: false,
    // CU-C-70:成团人数为空/0 时的输入提示(与按钮禁用态同一把尺子)。
    teamSizeError: '',
    lineup: [],
  },

  onLoad(options) {
    const topicId = Number(options.topicId || options.id);
    if (!Number.isInteger(topicId) || topicId <= 0) {
      this.setData({ loading: false, errorText: '缺少主题信息' });
      return;
    }
    this.setData({ topicId: topicId });
    this.preview();
  },

  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    if (this.data.topicId) {
      wx.redirectTo({ url: '/pages/topic/index/index?id=' + this.data.topicId });
      return;
    }
    wx.switchTab({ url: '/pages/template/index' });
  },

  preview() {
    const that = this;
    const seq = (this._previewSeq || 0) + 1;
    this._previewSeq = seq;
    this.setData({ loading: true, errorText: '' });
    const body = { topicId: this.data.topicId, subType: this.data.subType };
    if (this.data.subType === 'guided') {
      body.leadCost = this.data.leadCost === '' ? null : Number(this.data.leadCost);
      body.teamSize = this.data.teamSize === '' ? null : Number(this.data.teamSize);
    }
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/topic/pricing/preview',
      method: 'POST',
      data: JSON.stringify(body),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (that._previewSeq !== seq) return;
        if (res.code != '200' || !res.data) {
          that.setData({ errorText: app.getRequestErrorMessage(res, '定价信息加载失败') });
          return;
        }
        const floor = Number(res.data.priceMin);
        if (res.data.priceMin == null || res.data.priceMin === '' || !Number.isFinite(floor)) {
          that.setData({ errorText: '定价信息不完整，请稍后重试' });
          return;
        }
        const reference = res.data.cityReferencePrice == null ? null : Number(res.data.cityReferencePrice);
        const min = Math.ceil(floor);
        const sliderMax = Math.max(min + 100, Math.ceil(floor * 2), reference ? Math.ceil(reference * 1.5) : 0);
        const sample = Number(res.data.cityReferenceSampleSize || 0);
        const city = res.data.cityReferenceLabel || '同城';
        const lineup = Array.isArray(res.data.lineup)
          ? res.data.lineup.filter(function (row) { return row && row.toType && row.toId; })
              .map(function (row) {
                return {
                  lineupKey: row.toType + ':' + row.toId,
                  toType: row.toType,
                  toId: row.toId,
                  name: '',
                  termsText: termsText(row),
                };
              })
          : [];
        that.setData({
          hasPreview: true,
          errorText: '',
          lineup: lineup,
          floor: floor,
          floorText: money(res.data.priceMin),
          finalPrice: min,
          // CU-M-32:未到定价阶段(canConfirm===false)事先置灰;老后端不带该字段时仍由服务端拦。
          phaseBlocked: res.data.canConfirm === false,
          // CU-C-70:floor=0(例:带队成本被静默摊成 0)时 min>=floor 恒真,旧式自校验放行零价。
          // 人数这道条件必须参与,不然按钮点得动而价格是 0。
          canConfirmPrice: min >= floor && res.data.canConfirm !== false
            && teamSizeOk(that.data.subType, that.data.teamSize),
          teamSizeError: teamSizeErrorText(that.data.subType, that.data.teamSize),
          sliderMax: sliderMax,
          referencePrice: reference,
          referenceText: reference && sample > 0
            ? city + '同类已开售均价 ¥' + money(reference) + '（' + sample + ' 个样本）'
            : '样本不足，暂不展示参考价',
        });
        that.updateDelta(min);
        that.loadLineupNames();
      },
      fail(res) {
        if (that._previewSeq !== seq) return;
        that.setData({ errorText: app.getRequestErrorMessage(res, '网络异常，请稍后重试') });
      },
      complete() {
        if (that._previewSeq === seq) that.setData({ loading: false });
      },
    });
  },

  // 阵容行没有名称字段,逐个用公开档案接口补名(阵容通常 2-6 行,结果按 toType:toId 缓存)
  loadLineupNames() {
    const that = this;
    const cache = this._nameCache || (this._nameCache = {});
    this.data.lineup.forEach(function (row, idx) {
      if (cache[row.lineupKey]) {
        that.applyLineupName(idx, row.lineupKey, cache[row.lineupKey]);
        return;
      }
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: row.toType === 'club' ? '/api/club/detail' : '/api/merchant/public-detail',
        method: 'POST',
        data: JSON.stringify({ id: row.toId }),
        header: { 'Content-Type': 'application/json' },
        success(res) {
          const name = (res && res.code == '200' && res.data && res.data.name) || '';
          cache[row.lineupKey] = name;
          that.applyLineupName(idx, row.lineupKey, name);
        },
      });
    });
  },

  applyLineupName(idx, lineupKey, name) {
    const row = this.data.lineup[idx];
    if (!name || !row || row.lineupKey !== lineupKey) return;
    this.setData({ ['lineup[' + idx + '].name']: name });
  },

  goPartner(e) {
    const row = this.data.lineup[Number(e.currentTarget.dataset.idx)];
    if (!row) return;
    wx.navigateTo({
      url: '/pages/topic/pricing/partner/index?topicId=' + this.data.topicId
        + '&toType=' + row.toType + '&toId=' + row.toId,
    });
  },

  chooseType(e) {
    const type = (e.detail && e.detail.key) !== undefined ? e.detail.key : e.currentTarget.dataset.type;
    if (type === this.data.subType) return;
    this.setData({
      subType: type, hasPreview: false, errorText: '',
      teamSizeError: teamSizeErrorText(type, this.data.teamSize),
    });
    this.preview();
  },

  onCostInput(e) { this.setData({ leadCost: e.detail.value }); },

  onTeamInput(e) {
    const teamSize = e.detail.value;
    // CU-C-70:成团人数就地参与可提交判定 —— 改成 0 后不重算也能点确认的那条路必须堵上。
    this.setData({
      teamSize,
      teamSizeError: teamSizeErrorText(this.data.subType, teamSize),
      canConfirmPrice: this._canConfirmPrice({ teamSize }),
    });
  },

  recalculate() { this.preview(); },

  // 可提交判定的唯一判据:终价不低于地板、主题已在定价阶段、有人带时人数为正。
  _canConfirmPrice(patch) {
    const data = Object.assign({}, this.data, patch || {});
    return Number(data.finalPrice) >= Number(data.floor) && !data.phaseBlocked
      && teamSizeOk(data.subType, data.teamSize);
  },

  onSliderChange(e) {
    const value = Number(e.detail.value);
    this.setData({ finalPrice: value, canConfirmPrice: this._canConfirmPrice({ finalPrice: value }) });
    this.updateDelta(value);
  },

  // 灰按钮被点时给一句为什么(cy-btn 在禁用态吞 tap、补发 disabledtap)。
  // 人数那块页内已有常挂提示,但按钮在屏幕底部,不给回应的灰按钮在本仓是记过过的死交互。
  onConfirmDisabledTap() {
    if (this.data.saving) return;
    const reason = this.data.teamSizeError
      || (this.data.phaseBlocked ? '主题还没进入定价阶段' : '');
    if (reason) this.setData({ submitError: reason });
  },

  updateDelta(value) {
    const reference = this.data.referencePrice;
    if (!reference) { this.setData({ referenceDeltaText: '' }); return; }
    const pct = Math.round((value - reference) / reference * 100);
    this.setData({ referenceDeltaText: pct > 0 ? '高于同城参考 ' + pct + '%' : '未高于同城参考价' });
  },

  confirmPrice() {
    if (!this.data.canConfirmPrice || this.data.saving) return;
    const body = { topicId: this.data.topicId };
    if (this.data.subType === 'guided') {
      body.guidedPrice = this.data.finalPrice;
      body.leadCost = this.data.leadCost === '' ? null : Number(this.data.leadCost);
      body.teamSize = this.data.teamSize === '' ? null : Number(this.data.teamSize);
    } else {
      body.selfPrice = this.data.finalPrice;
    }
    const that = this;
    this.setData({ saving: true, submitError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/topic/pricing/confirm', method: 'POST',
      data: JSON.stringify(body), header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code == '200') {
          that.setData({ submitError: '' });
          // B-04:后端确认只推进到 PRICING(ApiPricingController:"终价已确认，请等待开售审核"),
          // SELLING 要运营在后台提交开售审 —— toast 不能谎报「已开售」。
          toast.success(res.msg || '终价已确认，请等待开售审核');
          setTimeout(function () { that.goBack(); }, 500);
        } else that.setData({ submitError: (res && res.msg) || '确认失败，请重试' });
      },
      fail(res) { that.setData({ submitError: app.getRequestErrorMessage(res, '网络异常，请稍后重试') }); },
      complete() { that.setData({ saving: false }); },
    });
  },
});
