const app = getApp();
const { isRecordList } = require('../../../../../utils/response-shape.js');
const { isAlbumTemplate, ALBUM_ONLY_IN_STORY } = require('../../../../../utils/album-template.js');
const cyToast = require('../../../../../utils/toast.js');

function emptyForm(address) {
  return {
    name: '',
    address: address || '',
    templateId: 0,
    templateName: '',
    xpValue: '',
    message: '',
    perkTemplateId: 0,
    perkName: '',
    quotaTotal: '',
    perHeadFee: '',
    supplyName: '',
    supplyKind: 'SERVICE',
    supplyKindName: '常规服务',
    regularPrice: '',
    durationMinutes: '',
    availableHours: '',
    minPeople: '1',
    maxPeople: '1',
    splitBookingAllowed: 0,
    splitBookingName: '同行同时参与',
    actionType: 'NAVIGATE',
    actionTypeName: '导航到店',
    actionValue: '',
    optionalBenefit: '',
    benefitRules: '',
    merchantRules: '',
  };
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    chapterId: { type: Number, value: 0 },
    chapterName: { type: String, value: '' },
    // F3(cy-chapter-target-picker)里已经选过的玩法,带过来预填 —— 在这儿还能改。
    // 不覆盖用户在本表单里已经选过的:预填只发生在 show 打开、且本表单还没选时。
    presetTemplateId: { type: Number, value: 0 },
    presetTemplateName: { type: String, value: '' },
    termsMode: { type: String, value: '' },
    formMode: { type: String, value: 'application' },
    /* CU-M-58:同一个(商家 + 章节)在后端是唯一键原地覆盖(findMine → update,并回待审核),
       所以再次打开不是「新申请」。调用方把我已有的那个点位传进来,表单据此回填
       并把标题/按钮/提示都说成编辑与覆盖。 */
    presetNode: { type: Object, value: null },
    circleMode: { type: Boolean, value: false },
    defaultAddress: { type: String, value: '' },
    submitting: { type: Boolean, value: false },
  },

  data: {
    form: emptyForm(''),
    // CU-M-58:true = 本次提交会覆盖已有点位(不是新增)
    editing: false,
    templates: [],
    templatesLoading: false,
    perkTemplates: [],
    perkTemplatesLoading: false,
    canSubmit: false,
    supplyKinds: [
      { value: 'SERVICE', label: '常规服务' },
      { value: 'PRODUCT', label: '正常商品' },
      { value: 'EVENT', label: '已有活动' },
      { value: 'ZERO_BROWSE', label: '0元浏览/试用' },
    ],
    actionTypes: [
      { value: 'NAVIGATE', label: '导航到店' },
      { value: 'BOOK', label: '预约入口' },
      { value: 'BUY', label: '购买入口' },
    ],
    splitBookingOptions: [
      { value: 0, label: '同行同时参与' },
      { value: 1, label: '允许分开预约/轮换' },
    ],
  },

  observers: {
    show(value) {
      if (value) this.openForm();
    },
  },

  pageLifetimes: {
    show() {
      if (!this.data.show) return;
      if (this.data.formMode !== 'offer') this.loadMyTemplates();
      if (this.data.formMode === 'offer' && this.data.termsMode === 'PERK') {
        this.loadMyPerkTemplates();
      }
    },
  },

  methods: {
    openForm() {
      const preset = this.data.presetNode;
      // CU-M-58「编辑已有点位」只属于承接申请;「填写实际供给」不是改点位,不能沿用上一次申请留下的预填
      const editing = this.data.formMode !== 'offer' && !!(preset && Number(preset.id) > 0);
      this.setData({
        form: emptyForm(this.data.defaultAddress),
        canSubmit: false,
        editing: editing,
      });
      if (this.data.formMode === 'offer') {
        if (this.data.termsMode === 'PERK') this.loadMyPerkTemplates();
        return;
      }
      this.loadMyTemplates();
      if (!this.data.defaultAddress) this.loadMerchantAddress();
      /* F3 里已经选过玩法就预填。emptyForm() 刚把表单清空,所以放在它之后 ——
         这是「打开表单」这一刻的初值,不是覆盖用户在本表单里的选择:
         这里之后的每一次改动都走 onTemplatePick,不再经过 openForm。 */
      if (this.data.presetTemplateId) {
        this.setData({
          'form.templateId': this.data.presetTemplateId,
          'form.templateName': this.data.presetTemplateName || '',
        });
        this.refreshSubmitState();
      }
      /* CU-M-58:已有点位回填。放在玩法预选之后 —— 点位自己那份玩法才是原值,
         别被上一屏顺手选的那个盖掉。地址缺位时仍用商家资料兜底(loadMerchantAddress)。 */
      if (editing) {
        this.setData({
          'form.name': String(preset.name || ''),
          'form.address': String(preset.address || ''),
          'form.templateId': Number(preset.templateId) || 0,
          'form.templateName': '',
          'form.xpValue': preset.xpValue === null || preset.xpValue === undefined ? '' : String(preset.xpValue),
        }, () => this.refreshSubmitState());
      }
    },

    loadMerchantAddress() {
      const that = this;
      app.sendRequest({
        hideLoading: true,
        url: '/api/merchant/info',
        method: 'POST',
        success(res) {
          const address = res.code == '200' && res.data ? String(res.data.address || '').trim() : '';
          if (address && !that.data.form.address) {
            that.setData({ 'form.address': address });
          }
        },
      });
    },

    loadMyTemplates() {
      const that = this;
      if (that.data.templatesLoading) return;
      that.setData({ templatesLoading: true });
      app.sendRequest({
        hideLoading: true,
        url: '/api/template/my-list',
        method: 'POST',
        data: { scope: 'MERCHANT' },
        success(res) {
          const rows = res.code == '200' && res.data && isRecordList(res.data.rows) ? res.data.rows : [];
          that.setData({ templates: rows });
          /* CU-M-58:回填只给得了 templateId(点位行上没有玩法标题),名字要等这份列表回来才补得上,
             否则选择器会显示成「选择我已有的玩法」而其实已经选好了。 */
          const id = Number(that.data.form.templateId);
          if (id && !that.data.form.templateName) {
            const hit = rows.filter(function (t) { return Number(t.id) === id; })[0];
            if (hit) that.setData({ 'form.templateName': hit.title || '' }, () => that.refreshSubmitState());
          }
        },
        fail() {
          that.setData({ templates: [] });
        },
        complete() {
          that.setData({ templatesLoading: false });
        },
      });
    },

    loadMyPerkTemplates() {
      const that = this;
      if (that.data.perkTemplatesLoading) return;
      that.setData({ perkTemplatesLoading: true });
      app.sendRequest({
        hideLoading: true,
        url: '/api/coop/perk-template/list',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: JSON.stringify({}),
        success(res) {
          const rows = (res.code == '200' || res.code === 200) && Array.isArray(res.data)
            ? res.data.filter(function (row) {
              const retailValue = Number(row && row.retailValue);
              const quota = Number(row && row.quota);
              return Number.isFinite(retailValue) && retailValue > 0
                && Number.isInteger(quota) && quota > 0;
            })
            : [];
          that.setData({ perkTemplates: rows });
        },
        fail() {
          that.setData({ perkTemplates: [] });
        },
        complete() {
          that.setData({ perkTemplatesLoading: false });
        },
      });
    },

    onInput(e) {
      if (this.data.submitting) return;
      const key = e.currentTarget.dataset.key;
      if (!key) return;
      this.setData({ ['form.' + key]: e.detail.value }, () => this.refreshSubmitState());
    },

    onTemplatePick(e) {
      if (this.data.submitting) return;
      const template = this.data.templates[Number(e.detail.value)] || {};
      if (isAlbumTemplate(template)) {
        cyToast(ALBUM_ONLY_IN_STORY);
        return;
      }
      this.setData({
        'form.templateId': Number(template.id) || 0,
        'form.templateName': template.title || '',
      }, () => this.refreshSubmitState());
    },

    onPerkPick(e) {
      if (this.data.submitting) return;
      const perk = this.data.perkTemplates[Number(e.detail.value)] || {};
      this.setData({
        'form.perkTemplateId': Number(perk.id) || 0,
        'form.perkName': perk.name || '',
      }, () => this.refreshSubmitState());
    },

    onSupplyKindPick(e) {
      const item = this.data.supplyKinds[Number(e.detail.value)] || this.data.supplyKinds[0];
      this.setData({ 'form.supplyKind': item.value, 'form.supplyKindName': item.label },
        () => this.refreshSubmitState());
    },

    onActionTypePick(e) {
      const item = this.data.actionTypes[Number(e.detail.value)] || this.data.actionTypes[0];
      this.setData({ 'form.actionType': item.value, 'form.actionTypeName': item.label },
        () => this.refreshSubmitState());
    },

    onSplitBookingPick(e) {
      const item = this.data.splitBookingOptions[Number(e.detail.value)] || this.data.splitBookingOptions[0];
      this.setData({
        'form.splitBookingAllowed': item.value,
        'form.splitBookingName': item.label,
      }, () => this.refreshSubmitState());
    },

    goCreateTemplate() {
      if (this.data.submitting) return;
      wx.navigateTo({ url: '/pages/publish/temp/index?scope=MERCHANT' });
    },

    goCreatePerkTemplate() {
      if (this.data.submitting) return;
      wx.navigateTo({ url: '/pages/merchant/decor/perks/index' });
    },

    refreshSubmitState() {
      const form = this.data.form || {};
      const quota = Number(form.quotaTotal);
      const quotaValid = Number.isInteger(quota) && quota >= 1;
      const fee = Number(form.perHeadFee);
      const feeValid = form.perHeadFee !== '' && Number.isFinite(fee) && fee >= 0;
      const termsSupplyValid = this.data.termsMode === 'PERK'
        ? !!Number(form.perkTemplateId) && quotaValid
        : this.data.termsMode === 'REVSHARE'
          ? feeValid
          : this.data.termsMode === 'TRAFFIC';
      const price = Number(form.regularPrice);
      const duration = Number(form.durationMinutes);
      const minPeople = Number(form.minPeople);
      const maxPeople = Number(form.maxPeople);
      const circleSupplyValid = !this.data.circleMode || (
        !!String(form.supplyName || '').trim()
        && form.regularPrice !== '' && Number.isFinite(price) && price >= 0
        && Number.isInteger(duration) && duration > 0
        && !!String(form.availableHours || '').trim()
        && Number.isInteger(minPeople) && minPeople > 0
        && Number.isInteger(maxPeople) && maxPeople >= minPeople
        && (maxPeople >= 2 || Number(form.splitBookingAllowed) === 1)
        && !!String(form.actionValue || '').trim()
        && (!String(form.optionalBenefit || '').trim() || !!String(form.benefitRules || '').trim())
        && !!String(form.merchantRules || '').trim()
      );
      const canSubmit = this.data.formMode === 'offer'
        ? termsSupplyValid && circleSupplyValid
        : !!String(form.name || '').trim() && !!Number(form.templateId);
      if (canSubmit !== this.data.canSubmit) this.setData({ canSubmit });
    },

    onSubmit() {
      if (this.data.submitting) return;
      const form = this.data.form || {};
      if (this.data.formMode !== 'offer') {
        const name = String(form.name || '').trim();
        if (!name) {
          app.tips('请填写点位名称');
          return;
        }
        if (!Number(form.templateId)) {
          app.tips('请选择玩法模板');
          return;
        }
        this.triggerEvent('submit', {
          chapterId: Number(this.data.chapterId),
          templateId: Number(form.templateId),
          name,
          address: String(form.address || '').trim(),
          xpValue: form.xpValue === '' ? null : Number(form.xpValue),
          message: String(form.message || '').trim(),
        });
        return;
      }

      const termsMode = this.data.termsMode;
      const quotaTotal = Number(form.quotaTotal);
      if (termsMode === 'PERK' && (!Number.isInteger(quotaTotal) || quotaTotal < 1)) {
        app.tips('请填写至少 1 人次的核销额度');
        return;
      }
      if (termsMode === 'PERK' && !Number(form.perkTemplateId)) {
        app.tips('请选择实际供给的权益');
        return;
      }
      const perHeadFee = Number(form.perHeadFee);
      if (termsMode === 'REVSHARE'
          && (form.perHeadFee === '' || !Number.isFinite(perHeadFee) || perHeadFee < 0)) {
        app.tips('请填写有效的每人次计酬金额');
        return;
      }
      if (termsMode !== 'TRAFFIC' && termsMode !== 'PERK' && termsMode !== 'REVSHARE') {
        app.tips('章节供给档位无效');
        return;
      }
      const detail = { chapterId: Number(this.data.chapterId), termsMode };
      if (this.data.circleMode) {
        const durationMinutes = Number(form.durationMinutes);
        const optionalBenefit = String(form.optionalBenefit || '').trim();
        detail.circleSupplyProfile = {
          supplyName: String(form.supplyName || '').trim(),
          supplyKind: form.supplyKind,
          regularPrice: Number(form.regularPrice),
          actionType: form.actionType,
          actionValue: String(form.actionValue || '').trim(),
          availableHours: String(form.availableHours || '').trim(),
          minPeople: Number(form.minPeople),
          maxPeople: Number(form.maxPeople),
          durationMinutes,
          splitBookingAllowed: Number(form.splitBookingAllowed),
          optionalBenefit,
          benefitRules: String(form.benefitRules || '').trim(),
          merchantRules: String(form.merchantRules || '').trim(),
        };
      }
      if (termsMode === 'PERK') {
        detail.perkTemplateId = Number(form.perkTemplateId);
        detail.quotaTotal = quotaTotal;
      }
      if (termsMode === 'REVSHARE') detail.perHeadFee = perHeadFee;
      this.triggerEvent('submit', detail);
    },

    onClose() {
      if (!this.data.submitting) this.triggerEvent('close');
    },
  },
});
