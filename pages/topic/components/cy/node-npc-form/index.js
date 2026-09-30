// 节点 NPC 半屏(CR-927 商家上传节点 NPC):给自己的点位配一个出场角色。
//
// 合同与门店形象(pages/merchant/decor/ai-npc)完全一致,不另造一套:
//   · 预设像素形象存编码(px1:*),没有上传、没有对象存储;
//   · 照片在端上裁成 1:1 再像素化后才上传 —— 原图不出手机;
//   · 文本(名字/台词)由服务端同步送检,非预设头像异步送检(违规回调自动下架);
//   · 数据落 npc_profile scope_type=4,一节点一条 —— 所以这里只有「保存」,没有新建/删除。
//
// 失败口径(任务):失败走 cy-result-sheet(fail,2s 自愈)回到表单、输入不丢;
// 只有「读取回填失败」这种表单本身没法用的场景才自愈后关掉半屏。
const app = getApp();
const pixelAvatar = require('../../../../../utils/pixel-avatar.js');
const pixelPortrait = require('../../../../../utils/pixel-portrait.js');
// 单文件限额与共享上传入口同一真源(生产 application.yml 10MB),页面不自定 20MB。
const { MAX_UPLOAD_FILE_SIZE } = require('../../../../../utils/transport/upload-client.js');

/** 预览/导出倍数与门店形象页一致:32 格 × 8 / 12,整数倍不糊。 */
const PREVIEW_SCALE = 8;
const EXPORT_SCALE = 12;
const RESULT_HOLD_MS = 2000;

Component({
  properties: {
    show: { type: Boolean, value: false },
    nodeId: { type: Number, value: 0, optionalTypes: [String] },
    nodeName: { type: String, value: '' },
  },
  data: {
    loading: false,
    form: { name: '', avatar: '', greeting: '' },
    presetIds: pixelAvatar.AVATAR_IDS,
    presetId: pixelAvatar.AVATAR_IDS[0],
    source: 'preset',           // preset=内置像素形象 / photo=商家上传的照片形象
    avatarPreview: '',
    processing: false,
    saving: false,
    voiceStatus: 0,
    voiceStatusText: '',
    voiceFile: null,
    voiceFileText: '',
    voiceBusy: false,
    voicePlaying: false,
    voiceSample: '',
    result: { show: false, kind: 'success', title: '', why: '', duration: RESULT_HOLD_MS },
  },
  observers: {
    'show': function (show) {
      if (show) this._onOpen();
      else this._onHide();
    },
  },
  lifetimes: {
    detached() {
      this._destroyed = true;
      this._teardown();
    },
  },
  methods: {
    // ===== 数据 =====

    /** 打开即回填:没有配过就是空表单。读取失败 = 表单没法用,2s 后自动关半屏。 */
    _onOpen() {
      this._destroyed = false;
      this._closeFormAfterResult = false;
      this.setData({
        loading: true,
        form: { name: '', avatar: '', greeting: '' },
        source: 'preset',
        presetId: pixelAvatar.AVATAR_IDS[0],
        avatarPreview: pixelAvatar.stringifyCode(pixelAvatar.AVATAR_IDS[0]),
        voiceFile: null,
        voiceFileText: '',
        voiceStatus: 0,
        voiceStatusText: '未配置（可选）',
        voiceSample: '',
        voicePlaying: false,
        result: { show: false, kind: 'success', title: '', why: '', duration: RESULT_HOLD_MS },
      });
      this._portrait = null;
      this._photoPath = '';
      this._request('/api/merchant/chapter-node/npc/detail', { nodeId: this.data.nodeId })
        .then((res) => {
          if (this._destroyed) return;
          const d = res.data || null;
          const avatar = String((d && d.avatar) || '');
          const preset = pixelAvatar.isPixelAvatar(avatar);
          this.setData({
            loading: false,
            form: { name: (d && d.name) || '', avatar, greeting: (d && d.greeting) || '' },
            source: avatar && !preset ? 'photo' : 'preset',
            presetId: preset ? pixelAvatar.parseCode(avatar) : pixelAvatar.AVATAR_IDS[0],
            avatarPreview: avatar || pixelAvatar.stringifyCode(pixelAvatar.AVATAR_IDS[0]),
            voiceStatus: Number(d && d.voiceStatus) || 0,
            voiceSample: (d && d.voiceSample) || '',
          }, () => this._renderVoiceStatus());
          this.refreshVoice();
        })
        .catch((e) => {
          if (this._destroyed) return;
          this.setData({ loading: false });
          this._fail(e.message || '读取失败，请重试', true);
        });
    },

    _onHide() {
      this._teardown();
    },

    _teardown() {
      clearTimeout(this._voiceTimer);
      if (this._audio) this._audio.stop();
    },

    onInput(e) {
      const key = e.currentTarget.dataset.key;
      if (key !== 'name' && key !== 'greeting') return;
      this.setData({ ['form.' + key]: e.detail.value });
    },

    pickPreset(e) {
      if (this.data.saving || this.data.processing) return;
      const id = e.currentTarget.dataset.id;
      if (!id || (this.data.presetIds || []).indexOf(id) < 0) return;
      this._portrait = null;
      this._photoPath = '';
      this.setData({
        source: 'preset',
        presetId: id,
        avatarPreview: pixelAvatar.stringifyCode(id),
      });
    },

    // ===== 照片形象(与门店形象同一端上像素化链路)=====

    choosePhoto() {
      if (this.data.saving || this.data.processing) return;
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album'],
        sizeType: ['compressed'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file || !file.tempFilePath) return;
          // 先让商家自己裁一刀:没有人脸检测时,人自己框比任何启发式都准。
          if (typeof wx.cropImage === 'function') {
            wx.cropImage({
              src: file.tempFilePath,
              cropScale: '1:1',
              success: (r) => this._processPhoto(r.tempFilePath || file.tempFilePath),
              fail: (err) => {
                if (!/cancel/i.test(err.errMsg || '')) this._fail('裁剪失败，请重新选择照片');
              },
            });
          } else {
            this._processPhoto(file.tempFilePath);
          }
        },
      });
    },

    /** 画到离屏 canvas 再 getImageData —— 小程序拿不到图片原始像素,只能过一遍 canvas。 */
    _processPhoto(tempPath) {
      this.setData({ processing: true });
      this._canvas('#nnf-work')
        .then((cv) => {
          const g = cv.getContext('2d');
          return new Promise((resolve, reject) => {
            const img = cv.createImage();
            img.onload = () => {
              const box = pixelPortrait.squareCrop(img.width, img.height);
              const SIDE = 32 * PREVIEW_SCALE;
              cv.width = SIDE;
              cv.height = SIDE;
              g.clearRect(0, 0, SIDE, SIDE);
              g.drawImage(img, box.x, box.y, box.size, box.size, 0, 0, SIDE, SIDE);
              resolve(pixelPortrait.buildPortrait(g.getImageData(0, 0, SIDE, SIDE).data, SIDE, SIDE, { grid: 32 }));
            };
            img.onerror = () => reject(Error('image load fail'));
            img.src = tempPath;
          });
        })
        .then((portrait) => {
          this._portrait = portrait;
          return this._exportPortrait();
        })
        .then((path) => {
          if (this._destroyed) return;
          this._photoPath = path;
          this.setData({ processing: false, source: 'photo', avatarPreview: path });
        })
        .catch(() => {
          if (this._destroyed) return;
          this._portrait = null;
          this.setData({ processing: false });
          this._fail('照片处理失败，换一张清晰的正面照片试试');
        });
    },

    /** 导出成文件准备上传。倍数比预览大,marker/主页都够用。 */
    _exportPortrait() {
      return this._canvas('#nnf-work').then((cv) => {
        const side = 32 * EXPORT_SCALE;
        cv.width = side;
        cv.height = side;
        const g = cv.getContext('2d');
        g.fillStyle = '#EDE6D6'; /* ds-ok: 导出像素肖像画布底色,属于导出图像数据 */
        g.fillRect(0, 0, side, side);
        pixelPortrait.drawPortrait(g, this._portrait, 0, 0, EXPORT_SCALE);
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

    /** 小程序里必须走 SelectorQuery 拿 canvas 节点;拿不到直接失败,不静默。 */
    _canvas(id) {
      return new Promise((resolve, reject) => {
        this.createSelectorQuery()
          .select(id)
          .fields({ node: true, size: true })
          .exec((r) => {
            const node = r && r[0] && r[0].node;
            node ? resolve(node) : reject(Error('canvas not found: ' + id));
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
            else reject(Error((r.failures && r.failures[0] && r.failures[0].msg) || '上传失败'));
          },
        });
      });
    },

    // ===== 保存 =====

    _resolveAvatar() {
      if (this.data.source !== 'photo') {
        return Promise.resolve(pixelAvatar.stringifyCode(this.data.presetId));
      }
      if (this._photoPath) return this._upload(this._photoPath).then((url) => {
        // 上传成功先记住 URL:保存失败重试不重复上传。
        this._photoPath = '';
        this.setData({ avatarPreview: url, 'form.avatar': url });
        return url;
      });
      if (this.data.form.avatar) return Promise.resolve(this.data.form.avatar);
      return Promise.reject(Error('形象未就绪'));
    },

    save() {
      if (this.data.saving || this.data.processing) return;
      const name = (this.data.form.name || '').trim();
      if (!name) return this._fail('请填写角色名字');
      if (!this.data.form.avatar && !this._photoPath && this.data.source === 'photo') {
        return this._fail('请选择形象');
      }
      if (!this.data.avatarPreview) return this._fail('请选择形象');
      this.setData({ saving: true });
      this._resolveAvatar()
        .then((avatar) => this._request('/api/merchant/chapter-node/npc/save', {
          nodeId: this.data.nodeId,
          name,
          avatar,
          greeting: (this.data.form.greeting || '').trim(),
        }))
        .then((res) => {
          if (this._destroyed) return;
          const d = res.data || {};
          this.setData({
            saving: false,
            form: { name: d.name || name, avatar: d.avatar || this.data.form.avatar, greeting: d.greeting || '' },
            source: pixelAvatar.isPixelAvatar(d.avatar) ? 'preset' : 'photo',
            avatarPreview: d.avatar || this.data.avatarPreview,
          });
          this._ok('已保存');
        })
        .catch((e) => {
          if (this._destroyed) return;
          this.setData({ saving: false });
          this._fail(e.message || '保存失败，请重试');
        });
    },

    // ===== 声音(可选)=====

    chooseVoice() {
      if (this.data.voiceBusy || this.data.voiceStatus === 1) return;
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['mp3', 'm4a', 'wav'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file) return;
          if (!/\.(mp3|m4a|wav)$/i.test(file.name)) {
            return this._fail('请选择 MP3、M4A 或 WAV 文件');
          }
          // 上限与共享上传入口同源(10MB);给可操作路径,不把超限留到断连后只报「失败」。
          if (!(file.size > 0 && file.size <= MAX_UPLOAD_FILE_SIZE)) {
            return this._fail('文件过大，请压缩或更换文件后上传（单个文件最大10MB）');
          }
          this.setData({ voiceBusy: true });
          const audio = this._audioContext();
          audio.stop();
          audio.src = file.path;
          let tries = 0;
          const read = () => {
            if (this._destroyed) return;
            const duration = audio.duration;
            if (duration > 0) {
              this.setData({ voiceBusy: false });
              if (duration < 10 || duration > 300) {
                return this._fail('录音时长需要在 10 秒至 5 分钟之间');
              }
              this.setData({
                voiceFile: { path: file.path, name: file.name, size: file.size, duration: Math.round(duration) },
                voiceFileText: file.name + ' · ' + Math.round(duration) + '″ · ' + (file.size / 1048576).toFixed(1) + 'MB',
              });
            } else if (++tries < 40) this._durationTimer = setTimeout(read, 100);
            else {
              this.setData({ voiceBusy: false });
              this._fail('无法读取录音时长，请换一个文件');
            }
          };
          read();
        },
      });
    },

    uploadVoice() {
      if (this.data.voiceBusy || this.data.voiceStatus === 1 || !this.data.voiceFile) return;
      if (this._audio) this._audio.stop();
      this.setData({ voiceBusy: true });
      const file = this.data.voiceFile;
      const upload = file.url
        ? Promise.resolve(file.url)
        : new Promise((resolve, reject) => {
            app.getUploadClient().uploadAll([file.path], {
              fileSizes: [file.size],
              mapResult: (d) => d.url,
              onDone: (r) => {
                if (r.ok && r.results[0]) { resolve(r.results[0]); return; }
                const failure = r.failures && r.failures[0];
                reject(Error(failure && failure.reason === 'oversize'
                  ? failure.msg : '录音上传失败，文件已保留'));
              },
            });
          });
      upload
        .then((url) => {
          this.setData({ 'voiceFile.url': url });
          this._voiceSubmitted = true;
          return this._request('/api/merchant/chapter-node/npc/voice/enroll',
            { nodeId: this.data.nodeId, voiceSample: url });
        })
        .then((res) => {
          if (this._destroyed) return;
          const d = res.data || {};
          this.setData({
            voiceBusy: false,
            voiceStatus: Number(d.voiceStatus) || 0,
            voiceSample: d.voiceSample || '',
            voiceFile: null,
            voiceFileText: '',
          }, () => this._renderVoiceStatus());
          this.refreshVoice();
        })
        .catch((e) => {
          if (this._destroyed) return;
          this.setData({ voiceBusy: false });
          this._fail(e.message || '声音生成失败，请重试');
          // 可能已经提交成功:先查状态再允许重试,避免重复生成烧两次上游。
          if (this._voiceSubmitted) this.refreshVoice();
        })
        .then(() => { this._voiceSubmitted = false; });
    },

    /** 复刻中轮询:只查状态,不拿合成失败反推状态。 */
    refreshVoice() {
      clearTimeout(this._voiceTimer);
      if (this._destroyed || !this.data.show) return;
      return this._request('/api/merchant/chapter-node/npc/voice/status', { nodeId: this.data.nodeId })
        .then((res) => {
          if (this._destroyed) return;
          const d = res.data || {};
          const status = Number(d.voiceStatus);
          if ([0, 1, 2, 3].indexOf(status) < 0) return;
          this.setData({
            voiceStatus: status,
            voiceSample: d.voiceSample || this.data.voiceSample,
            voiceFile: status === 1 ? null : this.data.voiceFile,
            voiceFileText: status === 1 ? '' : this.data.voiceFileText,
          }, () => this._renderVoiceStatus());
          if (status === 1) this._voiceTimer = setTimeout(() => this.refreshVoice(), 5000);
        })
        .catch(() => {
          // 状态查询失败不改判:保持上一次状态,等下次轮询。这里静默是**有意的**——
          // 状态是背景事实,弹失败会把正在填表的人打断;下一次轮询就是重试。
        });
    },

    resetVoice() {
      if (this.data.voiceBusy) return;
      this._request('/api/merchant/chapter-node/npc/voice/reset', { nodeId: this.data.nodeId })
        .then(() => {
          if (this._destroyed) return;
          this.setData({ voiceStatus: 0, voiceSample: '', voiceFile: null, voiceFileText: '', voicePlaying: false },
            () => this._renderVoiceStatus());
        })
        .catch((e) => this._fail(e.message || '清除失败，请重试'));
    },

    _renderVoiceStatus() {
      const status = Number(this.data.voiceStatus) || 0;
      const text = status === 1 ? '声音生成中…（稍后自动刷新）'
        : status === 2 ? '声音已就绪'
        : status === 3 ? '上次生成失败，可以重新生成' : '未配置（可选）';
      this.setData({ voiceStatusText: text });
    },

    _audioContext() {
      if (this._audio) return this._audio;
      const audio = wx.createInnerAudioContext();
      audio.obeyMuteSwitch = false;
      audio.onEnded(() => { if (!this._destroyed) this.setData({ voicePlaying: false }); });
      audio.onStop(() => { if (!this._destroyed) this.setData({ voicePlaying: false }); });
      audio.onError(() => { if (!this._destroyed) this.setData({ voicePlaying: false }); });
      this._audio = audio;
      return audio;
    },

    playVoice() {
      const audio = this._audioContext();
      if (this.data.voicePlaying) {
        audio.stop();
        return;
      }
      const src = (this.data.voiceFile && this.data.voiceFile.path) || this.data.voiceSample;
      if (!src) return;
      audio.src = src;
      audio.play();
      this.setData({ voicePlaying: true });
    },

    // ===== 弹层与结果 =====

    onSheetClose() {
      if (this.data.saving || this.data.processing) return;
      this.triggerEvent('close', { saved: false });
    },

    _ok(title) {
      this._closeFormAfterResult = true;
      this._resultSaved = true;
      this.setData({ result: { show: true, kind: 'success', title, why: '', duration: RESULT_HOLD_MS } });
    },

    /** @param closeForm 读取失败这类「表单本身没法用」的失败:自愈后连半屏一起收掉。 */
    _fail(why, closeForm) {
      this._closeFormAfterResult = !!closeForm;
      this._resultSaved = false;
      this.setData({ result: { show: true, kind: 'fail', title: '没有成功', why: why || '请稍后重试', duration: RESULT_HOLD_MS } });
    },

    onResultClose() {
      const closeForm = this._closeFormAfterResult;
      const saved = this._resultSaved;
      this._closeFormAfterResult = false;
      this._resultSaved = false;
      this.setData({ 'result.show': false });
      if (closeForm) this.triggerEvent('close', { saved: !!saved });
    },

    _request(url, data) {
      return new Promise((resolve, reject) => {
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
        });
      });
    },
  },
});
