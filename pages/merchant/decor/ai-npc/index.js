// 门店 AI 形象:商家给自己的店配一个出现在漫游地图和店铺主页上的形象。
//
// 两条路,互斥:
//   预设   从内置的像素形象里挑一个,avatar 存编码(px1:xxx),不产生任何文件
//   照片   自己拍一张,在端上处理成像素画再上传,avatar 存图片 URL
//
// 照片为什么在端上处理而不是传原图让后端做:后端没有图像处理能力,而且原图是人脸,
// 能不上传就不上传 —— 端上处理完只传处理后的结果,原图不出手机。
const app = getApp();
const toast = require('../../../../utils/toast.js');
const merchantTheme = require('../../../../utils/merchant-theme.js');
const pixelAvatar = require('../../../../utils/pixel-avatar.js');
const pixelPortrait = require('../../../../utils/pixel-portrait.js');
// 单文件限额与共享上传入口同一真源(生产 application.yml 10MB),避免页面自定 20MB 与服务端脱节。
const { MAX_UPLOAD_FILE_SIZE } = require('../../../../utils/transport/upload-client.js');

/** CU-M-81:没有坐标时的落点文案。地址只能当辅助,不能顶替「已设置点位」。 */
const STORE_POINT_UNSET = '尚未选择地图位置';

/** 预览画布的边长(px)。32 格 × 8 = 256,整数倍,不糊。 */
const PREVIEW_SCALE = 8;
/** 上传前导出的图有多大。32 格 × 12 = 384,够 marker 和店铺主页两处用。 */
const EXPORT_SCALE = 12;
const VOICE_SENTENCES = [
  '你好，欢迎来到我的小店，很高兴今天能用我的声音和你聊聊。',
  '你可以告诉我想找什么商品，我会结合你的需要，认真介绍合适的选择。',
  '如果还有价格、服务或者到店方面的问题，也可以随时问我，我会耐心回答。',
];

// 原生 canvas 不遵循外层 overflow，预览圆角须在画布内裁切；不改变上传原图。
function clipPreview(ctx, side) {
  const radius = side * 0.16;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(side, 0, side, side, radius);
  ctx.arcTo(side, side, 0, side, radius);
  ctx.arcTo(0, side, 0, 0, radius);
  ctx.arcTo(0, 0, side, 0, radius);
  ctx.closePath();
  ctx.clip();
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    loadError: '',
    saving: false,
    saveError: '',
    view: 'home',
    source: 'preset',
    presetIds: pixelAvatar.AVATAR_IDS,
    presetNames: Object.fromEntries(pixelAvatar.AVATAR_IDS.map(id => [id, require('../../../../utils/pixel-avatar-data.js').AVATARS[id].name])),
    presetId: pixelAvatar.AVATAR_IDS[0],
    pickId: pixelAvatar.AVATAR_IDS[0],
    photoReady: false,
    uploadedUrl: '',
    name: '',
    greeting: '',
    persona: '',
    knowledge: '',
    auditStatus: null,
    auditReason: '',
    savedAvatar: '',
    hasProfile: false,
    presetVisible: false,
    field: null,
    discardVisible: false,
    dirty: false,
    processing: false,
    photoError: '',
    previewError: '',
    storePointText: STORE_POINT_UNSET,
    voiceVisible: false,
    voiceStatus: 0,
    voiceFile: null,
    voiceBusy: false,
    voiceError: '',
    voicePlaying: false,
    voiceSample: '',
    voiceUnknown: false,
    voiceConsent: false,
    voiceSentences: VOICE_SENTENCES,
    voiceSentenceIndex: 0,
    voiceSentenceConfirmed: 0,
    voiceSentenceText: VOICE_SENTENCES[0],
    voiceSentenceReady: false,
    voiceSessionActive: false,
    voiceHolding: false,
    voiceFinalizing: false,
    privacyGateShow: false,
  },
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
      navBarHeight: app.globalData.navBarHeight || 44,
    });
    this._loadProfile();
  },
  onShow() {
    merchantTheme.merchantPageShow();
    this._hidden = false;
    if (this.data.voiceStatus === 1) this.refreshVoice();
  },
  onHide() {
    this._hidden = true;
    this._voiceHoldReleased = true;
    clearTimeout(this._voiceTimer);
    if (this.data.voiceSessionActive && this._voiceRecorder) {
      this._discardVoiceStop = true;
      this._voiceRecorder.stop();
    }
    if (this._audio) this._audio.stop();
    merchantTheme.merchantPageRestore();
  },
  onUnload() {
    this._destroyed = true;
    this._voiceHoldReleased = true;
    clearTimeout(this._voiceTimer);
    clearTimeout(this._durationTimer);
    if (this.data.voiceSessionActive && this._voiceRecorder) {
      this._discardVoiceStop = true;
      this._voiceRecorder.stop();
    }
    if (this._voiceRecorder) {
      if (typeof this._voiceRecorder.offStop === 'function') this._voiceRecorder.offStop(this._voiceRecorderOnStop);
      if (typeof this._voiceRecorder.offError === 'function') this._voiceRecorder.offError(this._voiceRecorderOnError);
    }
    if (this._audio) this._audio.destroy();
    merchantTheme.merchantPageRestore();
  },
  _request(url, data) {
    return new Promise((resolve, reject) =>
      app.sendRequest({
        url,
        method: 'POST',
        hideLoading: true,
        data: JSON.stringify(data || {}),
        header: { 'Content-Type': 'application/json' },
        success: (res) => {
          if (res && String(res.code) === '200') resolve(res);
          else reject(Error((res && res.msg) || '请求失败，请重试'));
        },
        successStatusAbnormal: (res) => reject(Error((res && res.msg) || '请求失败，请重试')),
        fail: () => reject(Error('网络异常，请稍后重试')),
      })
    );
  },
  _loadProfile() {
    this.setData({ loading: true, loadError: '' });
    this._request('/api/merchant/npc/profile')
      .then((res) => {
        if (this._destroyed) return;
        const d = res.data || {},
          avatar = String(d.avatar || '');
        this._saved = { avatar, name: d.name || '', greeting: d.greeting || '', persona: d.persona || '', knowledge: d.knowledge || '' };
        (Object.assign(this.data, {hasProfile: !!avatar, savedAvatar: avatar}), this.setData({loading: false, name: this._saved.name, greeting: this._saved.greeting, persona: this._saved.persona, knowledge: this._saved.knowledge, auditStatus: d.auditStatus == null ? null : Number(d.auditStatus), auditReason: d.auditReason || '', voiceStatus: Number(d.voiceStatus) || 0}, () => this.restoreAvatar()));
        this.refreshVoice();
      })
      .catch((e) => {
        if (!this._destroyed) this.setData({ loading: false, loadError: e.message });
      });
    this._loadStorePoint();
  },

  /**
   * CU-M-81:漫游落点有没有设置,**判据是坐标不是地址**。
   *
   * 生产存量商家「有地址、零坐标」是常态(见 apply/index.js 的注释),只拿 address 当判据
   * 会让商家以为自己已经标好了落点,而玩家侧的漫游地图根本落不下去(坐标在
   * ApiMerchantNodeController 才被真消费)。接口本来就下发 locationLat/locationLng,
   * 所以这里按坐标判:没坐标就不冒充已设置。
   */
  _loadStorePoint() {
    this._request('/api/merchant/coop-profile')
      .then((res) => {
        if (!this._destroyed) this._applyStorePoint(res.data || {});
      })
      .catch(() => {
        // 读不到档案 ≠ 已设置:落点文案退回「尚未选择」这一侧(宁可让商家再标一次,
        // 也不能让他以为标好了)。
        if (!this._destroyed) this.setData({ storePointText: STORE_POINT_UNSET });
      });
  },

  _applyStorePoint(profile) {
    const lat = profile.locationLat;
    const lng = profile.locationLng;
    const hasPoint = lat !== null && lat !== undefined && lat !== ''
      && lng !== null && lng !== undefined && lng !== '';
    this.setData({
      storePointText: hasPoint ? (profile.address || '已选择地图位置') : STORE_POINT_UNSET,
    });
  },
  restoreAvatar() {
    const avatar = (this._saved && this._saved.avatar) || '',
      preset = pixelAvatar.isPixelAvatar(avatar);
    this._portrait = null;
    // CU-M-82:记下「进入本视图时」的形象编码当基线。空资料后端回的是空串,而预览会落到
    // 首个预设上 —— 拿预览编码直接比 savedAvatar,商家一打开就被判成有未保存修改。
    this._avatarBaseline = avatar || pixelAvatar.stringifyCode(pixelAvatar.AVATAR_IDS[0]);
    (Object.assign(this.data, {presetId: preset ? pixelAvatar.parseCode(avatar) : pixelAvatar.AVATAR_IDS[0], dirty: false}), this.setData({source: avatar && !preset ? 'photo' : 'preset', uploadedUrl: avatar && !preset ? avatar : '', photoReady: !!avatar && !preset}, () => this._drawPreview()));
  },
  openAvatar() {
    if (this.data.saving) return;
    this.setData({ view: 'avatar', saveError: '', photoError: '' }, () => this.restoreAvatar());
  },
  // CU-M-82:比的是基线而不是 savedAvatar。空资料基线 = 首个预设的编码,所以
  //「打开就返回」不弹确认,而空资料下真换一个预设照样会弹(code 真的变了)。
  // code 为空串(切到照片但没有成品)不算修改。
  updateDirty() {
    const code =
      this.data.source === 'preset' ? pixelAvatar.stringifyCode(this.data.presetId) : this.data.uploadedUrl;
    const baseline = typeof this._avatarBaseline === 'string' ? this._avatarBaseline : this.data.savedAvatar;
    (Object.assign(this.data, {dirty: !!this._portrait || (!!code && code !== baseline)}), this.setData({}));
  },
  openPresets() {
    if (this.data.saving || this.data.processing) return;
    this.setData({ presetVisible: true, pickId: this.data.presetId }, () => this._drawPresetTiles());
  },
  pickPreset(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.presetIds.indexOf(id) >= 0) this.setData({ pickId: id });
  },
  closePresets() {
    this.setData({ presetVisible: false });
  },
  confirmPreset() {
    (Object.assign(this.data, {presetId: this.data.pickId}), this.setData({source: 'preset', presetVisible: false, photoError: ''}, () => {
        this._drawPreview();
        this.updateDirty();
      }));
  },
  editField(e) {
    const key = e.currentTarget.dataset.key;
    if (key !== 'name' && key !== 'greeting' && key !== 'persona' && key !== 'knowledge') return;
    this.setData({
      field: {
        key,
        label: key === 'name' ? '角色名字' : key === 'persona' ? '性格设定' : key === 'knowledge' ? '店铺知识' : '招呼语',
        value: this.data[key],
        initial: this.data[key],
        max: key === 'name' ? 32 : key === 'greeting' ? 60 : key === 'knowledge' ? 2000 : 500,
        multiline: key === 'persona' || key === 'knowledge',
      },
      saveError: '',
    });
  },
  onFieldInput(e) {
    if (!this.data.saving) this.setData({ 'field.value': e.detail.value });
  },
  closeField() {
    if (this.data.saving) return;
    if (this.data.field.value !== this.data.field.initial) {
      this._discardKind = 'field';
      this.setData({ discardVisible: true });
    } else this.setData({ field: null });
  },
  saveField() {
    if (this.data.saving) return;
    const f = this.data.field,
      value = f.value.trim();
    if (f.key === 'name' && !value) return toast('请填写角色名字');
    if (!this.data.hasProfile) {
      // CU-M-167:按钮写「保存」就得真落库。后端建档要求同时带形象
      // (ApiMerchantController `/npc/save`:avatar 为空直接拒),所以这里连同屏幕上
      // 预览着的那个形象,走和「角色形象 → 保存形象」完全相同的那条持久化路径。
      // 以前这一支只 setData 就 return:页面立刻显示新名字、弹层安静关闭,离开时却被
      // 「还没有保存」拦下 ⇒ 用户拿到的是「已保存」的回执,丢的是刚写的内容。
      if (f.key === 'name') this.setData({ name: value });
      else if (f.key === 'persona') this.setData({ persona: value });
      else if (f.key === 'knowledge') this.setData({ knowledge: value });
      else this.setData({ greeting: value });
      if (f.key !== 'name' && !this.data.name.trim()) {
        // 名字是建档必填项,缺就先回到名字这一栏继续填(与「保存形象」同一处置)
        toast('先给角色起个名字');
        this.editField({ currentTarget: { dataset: { key: 'name' } } });
        return;
      }
      this.save(() => this.setData({ field: null }));
      return;
    }
    this.persistProfile(
      {
        name: f.key === 'name' ? value : this.data.name,
        greeting: f.key === 'greeting' ? value : this.data.greeting,
        persona: f.key === 'persona' ? value : this.data.persona,
        knowledge: f.key === 'knowledge' ? value : this.data.knowledge,
        avatar: this.data.savedAvatar,
      },
      () => this.setData({ field: null })
    );
  },
  onNavBack() {
    if (this.data.saving || this.data.processing) return;
    if (this.data.view === 'avatar') {
      this.updateDirty();
      if (this.data.dirty) {
        this._discardKind = 'avatar';
        this.setData({ discardVisible: true });
        return;
      }
      this.setData({ view: 'home' }, () => this.restoreAvatar());
      return;
    }
    const saved = this._saved || { name: '', greeting: '', persona: '', knowledge: '' };
    if (this.data.name !== saved.name || this.data.greeting !== saved.greeting
      || this.data.persona !== saved.persona || this.data.knowledge !== saved.knowledge) {
      this._discardKind = 'page';
      this.setData({ discardVisible: true });
      return;
    }
    this.leavePage();
  },
  leavePage() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/merchant/decor/index' });
  },
  keepEditing() {
    this.setData({ discardVisible: false });
  },
  discardChanges() {
    this.setData({ discardVisible: false });
    if (this._discardKind === 'page') this.leavePage();
    else if (this._discardKind === 'field') this.setData({ field: null });
    else this.setData({ view: 'home' }, () => this.restoreAvatar());
  },
  chooseStorePoint() {
    if (this.data.saving) return;
    wx.chooseLocation({
      success: (point) =>
        this._request('/api/merchant/decor/save', {
          locationLat: point.latitude,
          locationLng: point.longitude,
          address: point.address || point.name || '',
        })
          // 选点成功后从后端回读落点状态:落库的是经纬度,页面显示的必须是服务端确实存下来的那份。
          .then(() => this._loadStorePoint())
          .catch((e) => toast(e.message)),
    });
  },
  // ===== canvas =====

  /** 拿一个 2d canvas 节点。小程序里必须走 SelectorQuery,拿不到就直接失败,不静默。 */
  _canvas(id) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select(id)
        .fields({ node: true, size: true })
        .exec((r) => {
          const node = r && r[0] && r[0].node;
          node ? resolve(node) : reject(new Error('canvas not found: ' + id));
        });
    });
  },

  /** 画预览。预设直接画编码;照片画已经算好的网格。 */
  _drawPreview() {
    this.setData({ previewError: '' });
    if (this.data.source === 'photo' && this.data.uploadedUrl) return;
    this._canvas('#npc-preview')
      .then((cv) => {
        const side = 32 * PREVIEW_SCALE;
        cv.width = side;
        cv.height = side;
        const g = cv.getContext('2d');
        g.clearRect(0, 0, side, side);
        clipPreview(g, side);
        if (this.data.source === 'photo' && this._portrait) {
          g.fillStyle = '#EDE6D6'; /* ds-ok: 像素肖像画布底色，属于导出图像数据 */
          g.fillRect(0, 0, side, side);
          pixelPortrait.drawPortrait(g, this._portrait, 0, 0, PREVIEW_SCALE);
        } else if (this.data.source === 'photo' && this.data.uploadedUrl) {
          // 已保存过的照片形象:这一版直接用 image 标签展示,canvas 留空
          g.clearRect(0, 0, side, side);
        } else {
          pixelAvatar.drawAvatarInBox(g, pixelAvatar.stringifyCode(this.data.presetId), 0, 0, side, side);
        }
      })
      .catch(() => {
        if (!this._destroyed) this.setData({ previewError: '形象预览没能载入，请重试' });
      });
  },

  /**
   * 画预设网格里的 12 个小图。
   *
   * 每格一个 canvas 而不是一张雪碧图:预设数量以后会变,雪碧图得跟着重新导出并对齐坐标,
   * 而这些形象本来就是数据、画一遍很便宜。格子尺寸取 32 的整数倍,不让 CSS 去拉伸。
   */
  _drawPresetTiles() {
    const ids = this.data.presetIds || [];
    ids.forEach((id) => {
      this._canvas('#tile-' + id)
        .then((cv) => {
          const scale = 3;
          const side = 32 * scale;
          cv.width = side;
          cv.height = side;
          const ctx = cv.getContext('2d');
          clipPreview(ctx, side);
          pixelAvatar.drawAvatarInBox(ctx, pixelAvatar.stringifyCode(id), 0, 0, side, side);
        })
        .catch(() => {});
    });
  },

  // ===== 照片 =====

  choosePhoto(e) {
    if (this.data.saving || this.data.processing) return;
    const sourceType = ['album'];
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: sourceType,
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        this._cropThenProcess(file.tempFilePath);
      },
    });
  },

  /** 先让商家自己裁一刀。没有人脸检测的情况下,人自己框比任何启发式都准。 */
  _cropThenProcess(src) {
    const that = this;
    if (typeof wx.cropImage === 'function') {
      wx.cropImage({
        src: src,
        cropScale: '1:1',
        success: (r) => that._processPhoto(r.tempFilePath || src),
        fail: (e) => {
          if (!/cancel/i.test(e.errMsg || '')) that.setData({ photoError: '裁剪失败，请重新选择照片' });
        },
      });
    } else {
      this._processPhoto(src);
    }
  },

  /**
   * 把照片处理成像素画。
   *
   * 画到离屏 canvas 再 getImageData —— 小程序拿不到图片的原始像素,只能过一遍 canvas。
   * 商家没裁的话按 squareCrop 猜一个框,那个默认值是拿真实半身照试出来的。
   */
  _processPhoto(tempPath) {
    this.setData({ processing: true, photoError: '' });
    const that = this;
    this._canvas('#npc-work')
      .then((cv) => {
        const g = cv.getContext('2d');
        return new Promise((resolve, reject) => {
          const img = cv.createImage();
          img.onload = () => {
            const box = pixelPortrait.squareCrop(img.width, img.height);
            const SIDE = 256;
            cv.width = SIDE;
            cv.height = SIDE;
            g.clearRect(0, 0, SIDE, SIDE);
            g.drawImage(img, box.x, box.y, box.size, box.size, 0, 0, SIDE, SIDE);
            const data = g.getImageData(0, 0, SIDE, SIDE);
            resolve(pixelPortrait.buildPortrait(data.data, SIDE, SIDE, { grid: 32 }));
          };
          img.onerror = () => reject(new Error('image load fail'));
          img.src = tempPath;
        });
      })
      .then((portrait) => {
        if (that._destroyed) return;
        that._portrait = portrait;
        that.setData({ source: 'photo', photoReady: true, uploadedUrl: '' }, () => {
          that.setData({ processing: false });
          that._drawPreview();
          that.updateDirty();
        });
      })
      .catch(() => {
        that.setData({ processing: false, photoError: '照片处理失败，换一张清晰正面照片试试' });
      });
  },

  /** 把处理好的像素画导出成图片文件,准备上传。导出用更大的倍数,marker 和主页都够用。 */
  _exportPortrait() {
    const that = this;
    return this._canvas('#npc-work').then((cv) => {
      const side = 32 * EXPORT_SCALE;
      cv.width = side;
      cv.height = side;
      const g = cv.getContext('2d');
      g.fillStyle = '#EDE6D6'; /* ds-ok: 导出像素肖像的画布底色 */
      g.fillRect(0, 0, side, side);
      pixelPortrait.drawPortrait(g, that._portrait, 0, 0, EXPORT_SCALE);
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: cv,
          fileType: 'png',
          success: (r) => resolve(r.tempFilePath),
          fail: reject,
        });
      });
    });
  },

  _upload(filePath) {
    return new Promise((resolve, reject) => {
      app.getUploadClient().uploadAll([filePath], {
        bizType: 'image_1_1',
        mapResult: (d) => d.url,
        onDone: (r) => {
          if (r.ok && r.results && r.results[0]) resolve(r.results[0]);
          else reject(new Error((r.failures && r.failures[0] && r.failures[0].msg) || '上传失败'));
        },
      });
    });
  },

  persistProfile(payload, onSuccess) {
    if (this.data.saving) return;
    this.setData({ saving: true, saveError: '' });
    return this._request('/api/merchant/npc/save', payload)
      .then(() => {
        if (this._destroyed) return;
        this._saved = Object.assign({}, payload);
        this._portrait = null;
        (Object.assign(this.data, {hasProfile: true, savedAvatar: payload.avatar, dirty: false}), this.setData({saving: false, name: payload.name, greeting: payload.greeting, persona: payload.persona || '', knowledge: payload.knowledge || '', auditStatus: 0, auditReason: ''}));
        if (onSuccess) onSuccess();
        toast.success('角色已更新');
      })
      .catch((e) => {
        if (!this._destroyed) this.setData({ saving: false, saveError: e.message });
      });
  },
  /**
   * 保存角色形象。`onSaved` 是给「名字弹层首次建档」(CU-M-167)用的收尾回调 ——
   * 它要关掉弹层留在原地,而不是像形象页那样退回 home。wxml 的 bindtap 会把事件对象
   * 当第一个参数传进来,所以只认函数。
   */
  save(onSaved) {
    if (this.data.saving || this.data.processing) return;
    if (!this.data.name.trim()) return this.editField({ currentTarget: { dataset: { key: 'name' } } });
    if (this.data.source === 'photo' && !this.data.photoReady)
      return toast('先选择一张照片');
    this.setData({ saving: true, saveError: '' });
    const ready =
      this.data.source === 'preset'
        ? Promise.resolve(pixelAvatar.stringifyCode(this.data.presetId))
        : this._portrait
        ? this._exportPortrait().then((path) => this._upload(path))
        : Promise.resolve(this.data.uploadedUrl);
    ready
      .then((avatar) => {
        if (this._destroyed) return;
        if (!avatar) throw Error('形象未就绪');
        // 上传成功后复用 URL，保存失败重试不重复上传。
        if (this.data.source === 'photo') {
          this._portrait = null;
          this.setData({ uploadedUrl: avatar });
        }
        this.setData({ saving: false });
        return this.persistProfile(
          { name: this.data.name.trim(), greeting: this.data.greeting.trim(), persona: this.data.persona.trim(), knowledge: this.data.knowledge.trim(), avatar },
          () => {
            if (typeof onSaved === 'function') onSaved();
            else this.setData({ view: 'home' }, () => this.restoreAvatar());
          }
        );
      })
      .catch((e) => {
        if (!this._destroyed) this.setData({ saving: false, saveError: e.message });
      });
  },
  openVoice() {
    if (!this.data.hasProfile) {
      toast('请先保存角色形象');
      return;
    }
    this.setData({ voiceVisible: true, voiceError: '' });
    this.refreshVoice();
  },
  closeVoice() {
    if (this.data.voiceBusy || this.data.voiceSessionActive || this.data.voiceFinalizing) return;
    this._voiceHoldReleased = true;
    this.setData({ voiceVisible: false });
    if (this._audio) this._audio.stop();
  },
  refreshVoice() {
    clearTimeout(this._voiceTimer);
    if (this._destroyed || this._hidden) return;
    return this._request('/api/merchant/npc/voice/status')
      .then((res) => {
        if (this._destroyed) return;
        const value = res.data || res,
          status = Number(value.voiceStatus);
        if (![0, 1, 2, 3].includes(status)) throw Error('声音状态暂时无法确认');
        const confirmed =
          (status === 1 || status === 2) &&
          this.data.voiceFile &&
          value.voiceSample === this.data.voiceFile.url;
        this.setData({
          voiceStatus: status,
          voiceSample: value.voiceSample || this.data.voiceSample,
          voiceUnknown: false,
          voiceFile: confirmed ? null : this.data.voiceFile,
        });
        if (status === 1 && !this._hidden) this._voiceTimer = setTimeout(() => this.refreshVoice(), 5000);
      })
      .catch((e) => {
        if (!this._destroyed) this.setData({ voiceError: e.message });
      });
  },
  onVoiceConsentChange(e) {
    this.setData({ voiceConsent: !!(e.detail && e.detail.checked), voiceError: '' });
  },
  voiceRecorder() {
    if (this._voiceRecorder) return this._voiceRecorder;
    const recorder = wx.getRecorderManager();
    this._voiceRecorderOnStop = (res) => {
      if (this._destroyed) return;
      const durationMs = Number(res && res.duration) || 0;
      const size = Number(res && res.fileSize) || 0;
      if (this._discardVoiceStop) {
        this._discardVoiceStop = false;
        this.setData({
          voiceFile: null,
          voiceHolding: false,
          voiceSessionActive: false,
          voiceFinalizing: false,
          voiceSentenceIndex: 0,
          voiceSentenceConfirmed: 0,
          voiceSentenceText: VOICE_SENTENCES[0],
          voiceSentenceReady: false,
        });
        return;
      }
      if (this.data.voiceSentenceConfirmed < VOICE_SENTENCES.length) {
        this.setData({
          voiceFile: null,
          voiceHolding: false,
          voiceSessionActive: false,
          voiceFinalizing: false,
          voiceSentenceIndex: 0,
          voiceSentenceConfirmed: 0,
          voiceSentenceText: VOICE_SENTENCES[0],
          voiceSentenceReady: false,
          voiceError: '录音提前结束，请重新录完三句话',
        });
        return;
      }
      this.setData({ voiceHolding: false, voiceSessionActive: false, voiceFinalizing: false });
      if (!res || !res.tempFilePath) return this.setData({ voiceError: '录音没有保存下来，请重试' });
      if (durationMs < 10000) return this.setData({ voiceFile: null, voiceSentenceIndex: 0, voiceSentenceConfirmed: 0, voiceSentenceText: VOICE_SENTENCES[0], voiceError: '请至少录满 10 秒' });
      if (!Number.isFinite(size) || size <= 0) return this.setData({ voiceFile: null, voiceSentenceIndex: 0, voiceSentenceConfirmed: 0, voiceSentenceText: VOICE_SENTENCES[0], voiceError: '录音文件为空或无效，请重新录制' });
      if (size > MAX_UPLOAD_FILE_SIZE) return this.setData({ voiceFile: null, voiceSentenceIndex: 0, voiceSentenceConfirmed: 0, voiceSentenceText: VOICE_SENTENCES[0], voiceError: '录音过大，请缩短后重录（最大10MB）' });
      this.setData({
        voiceFile: {
          path: res.tempFilePath,
          name: '现场录音.mp3',
          size,
          duration: Math.round(durationMs / 1000),
          sizeText: (size / 1048576).toFixed(1),
        },
        voiceError: '',
      });
    };
    this._voiceRecorderOnError = () => {
      if (!this._destroyed) this.setData({
        voiceFile: null,
        voiceHolding: false,
        voiceSessionActive: false,
        voiceFinalizing: false,
        voiceSentenceIndex: 0,
        voiceSentenceConfirmed: 0,
        voiceSentenceText: VOICE_SENTENCES[0],
        voiceSentenceReady: false,
        voiceError: '录音出错了，请重试',
      });
    };
    recorder.onStop(this._voiceRecorderOnStop);
    recorder.onError(this._voiceRecorderOnError);
    this._voiceRecorder = recorder;
    return recorder;
  },
  onVoiceHoldStart() {
    if (this.data.voiceBusy || this.data.voiceStatus === 1 || this.data.voiceUnknown || this.data.voiceSentenceReady || this.data.voiceFinalizing || this.data.voiceHolding) return;
    if (!this.data.voiceConsent) {
      this.setData({ voiceError: '请确认这是本人声音或已获得声音使用授权' });
      return;
    }
    this._voiceHoldReleased = false;
    const recorder = this.voiceRecorder();
    const begin = () => {
      if (this._destroyed || this._hidden || this._voiceHoldReleased) return;
      this.audio().stop();
      if (this.data.voiceSessionActive) recorder.resume();
      else recorder.start({ duration: 60000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
      this.setData({
        voiceHolding: true,
        voiceSessionActive: true,
        voiceFile: null,
        voiceError: '',
      });
    };
    if (this.data.voiceSessionActive) {
      begin();
      return;
    }
    if (this._voiceStarting) return;
    this._voiceStarting = true;
    wx.authorize({ scope: 'scope.record' })
      .then(() => {
        this._voiceStarting = false;
        begin();
      })
      .catch(() => {
        this._voiceStarting = false;
        if (!this._destroyed) this.setData({ voiceHolding: false, voiceError: '没有录音权限，请在设置里允许后重试' });
      });
  },
  onVoiceHoldEnd() {
    this._voiceHoldReleased = true;
    if (!this.data.voiceHolding || !this._voiceRecorder) return;
    this._voiceRecorder.pause();
    this.setData({
      voiceHolding: false,
      voiceSentenceReady: true,
    });
  },
  confirmVoiceSentence() {
    if (!this.data.voiceSentenceReady || !this.data.voiceSessionActive) return;
    const confirmed = this.data.voiceSentenceIndex + 1;
    if (confirmed < VOICE_SENTENCES.length) {
      this.setData({
        voiceSentenceIndex: confirmed,
        voiceSentenceConfirmed: confirmed,
        voiceSentenceText: VOICE_SENTENCES[confirmed],
        voiceSentenceReady: false,
      });
      return;
    }
    this.setData({
      voiceSentenceConfirmed: confirmed,
      voiceSentenceReady: false,
      voiceSessionActive: false,
      voiceFinalizing: true,
    });
    this._voiceRecorder.stop();
  },
  resetVoiceRecording() {
    if (this.data.voiceBusy || this.data.voiceUnknown) return;
    if (this._audio) this._audio.stop();
    if (this.data.voiceSessionActive && this._voiceRecorder) {
      this._discardVoiceStop = true;
      this._voiceRecorder.stop();
    }
    this._voiceHoldReleased = true;
    this.setData({
      voiceFile: null,
      voiceStatus: 0,
      voiceError: '',
      voicePlaying: false,
      voiceSentenceIndex: 0,
      voiceSentenceConfirmed: 0,
      voiceSentenceText: VOICE_SENTENCES[0],
      voiceSentenceReady: false,
      voiceSessionActive: false,
      voiceHolding: false,
      voiceFinalizing: false,
    });
  },
  audio() {
    if (this._audio) return this._audio;
    const audio = wx.createInnerAudioContext();
    audio.obeyMuteSwitch = false;
    audio.onEnded(() => {
      if (!this._destroyed) this.setData({ voicePlaying: false });
    });
    audio.onStop(() => {
      if (!this._destroyed) this.setData({ voicePlaying: false });
    });
    audio.onError(() => {
      if (!this._destroyed) this.setData({ voicePlaying: false, voiceError: '录音无法播放，请重新选择' });
    });
    this._audio = audio;
    return audio;
  },
  playVoice() {
    const audio = this.audio();
    if (this.data.voicePlaying) {
      audio.stop();
      return;
    }
    const src = this.data.voiceFile ? this.data.voiceFile.path : this.data.voiceSample;
    if (!src) return;
    audio.src = src;
    audio.play();
    this.setData({ voicePlaying: true });
  },
  uploadVoice() {
    if (this.data.voiceBusy || this.data.voiceStatus === 1 || this.data.voiceUnknown || !this.data.voiceFile)
      return;
    if (!this.data.voiceConsent) {
      this.setData({ voiceError: '请确认这是本人声音或已获得声音使用授权' });
      return;
    }
    this.audio().stop();
    this.setData({ voiceBusy: true, voiceError: '' });
    const upload = this.data.voiceFile.url
      ? Promise.resolve(this.data.voiceFile.url)
      : new Promise((resolve, reject) => {
          app.getUploadClient().uploadAll([this.data.voiceFile.path], {
            // 该页持有真实 size:交给共享入口按生产 10MB 前置拒绝,超出不发起注定被容器截断的连接。
            fileSizes: [this.data.voiceFile.size],
            mapResult: (d) => d.url,
            onDone: (r) => {
              if (r.ok && r.results[0]) { resolve(r.results[0]); return; }
              // 共享入口的「已知 size 超限」预检带 reason:'oversize',直接展示其可操作文案;
              // 其余(含 socket closed 等未知故障)沿用页面既有兜底,明确告知文件已保留、可重试。
              const failure = r.failures && r.failures[0];
              const msg = failure && failure.reason === 'oversize'
                ? failure.msg
                : '录音上传失败，文件已保留';
              reject(Error(msg));
            },
          });
        });
    upload
      .then((url) => {
        this.setData({ 'voiceFile.url': url });
        this._voiceSubmitted = true;
        return this._request('/api/merchant/npc/voice/enroll', {
          voiceSample: url,
          voiceConsent: this.data.voiceConsent,
        });
      })
      .then((res) => {
        if (this._destroyed) return;
        const d = res.data || res;
        this.setData({
          voiceBusy: false,
          voiceStatus: Number(d.voiceStatus),
          voiceFile: null,
          voiceUnknown: false,
        });
        this.refreshVoice();
      })
      .catch((e) => {
        if (this._destroyed) return;
        this.setData({ voiceBusy: false, voiceError: e.message, voiceUnknown: !!this._voiceSubmitted });
        // 可能已经提交成功，先查状态再允许重试，避免重复生成。
        if (this._voiceSubmitted) this.refreshVoice();
      })
      .finally(() => {
        this._voiceSubmitted = false;
      });
  },
});
