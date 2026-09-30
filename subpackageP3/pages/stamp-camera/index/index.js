// 集邮相机:把「拍照」做成「操作一台集邮机」。参考 STAMPA ——
// 核心不是功能是仪式,构图发生在按快门之前;退化成「从相册选图」就是相册不是集邮。
const cyToast = require('../../../../utils/toast.js');
const app = getApp();
const CROP = require('./crop.js');
const { DEFAULT_FRAME_RATIO, clampFrameRatio, layoutStampCamera } = require('./layout.js');
const PENDING_CREATE_KEY = 'cy_stamp_pending_create';

Page({
  data: {
    frameW: 0, frameH: 0, frameL: 0, frameT: 0,
    bodyL: 0, bodyT: 0, bodyW: 0, bodyH: 0,
    artL: 0, artT: 0, artW: 0, artH: 0,
    screenL: 0, screenT: 0, screenW: 0, screenH: 0,
    shutterL: 0, shutterT: 0, shutterS: 0,
    backL: 0, backT: 0, reviewL: 0, reviewT: 0, reviewW: 0,
    cropScaleLabel: '',
    shot: '', saving: false, camErr: false,
    camErrMessage: '', camErrCanOpenSettings: false,
    saveError: '', saveErrorKind: 'data', saveErrorTitle: '暂时未能存入'
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
    this._unloaded = false;
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.win = win;
    this._ratio = DEFAULT_FRAME_RATIO;        // 邮票框占 LCD 尺寸比例
    this.layoutFrame();
    const pending = this.readPendingCreate();
    if (pending) {
      // 上次离页时 POST 可能已提交。重用原图 URL + 原幂等键重放：
      // 已入册则返原记录，未入册则只新增一次，不会因重进页面换键重复入册。
      this._idemKey = pending.idempotencyKey;
      this.setData({ shot: pending.picUrl, saving: true, saveError: '' });
      this.submitStampCreate(pending.picUrl, pending.idempotencyKey);
    }
  },
  onUnload() {
    this._unloaded = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    if (this._uploadOperation) this._uploadOperation.abort();
    // /stamp/create 是写请求：离页时 abort 不能证明服务端未提交，
    // 反而会丢失结果并让下次进页换新键。让它继续收敛，失败则保留 pending 下次对账。
    this._redirecting = false;
  },

  layoutFrame() {
    const w = this.win.windowWidth, h = this.win.windowHeight;
    const layout = layoutStampCamera({
      width: w,
      height: h,
      statusBarHeight: this.win.statusBarHeight,
      frameRatio: this._ratio
    });
    // 白色虚线已移除；用当前真实裁切宽度的数字反馈 pinch，不再向画面盖任何框或遮罩。
    layout.cropScaleLabel = Math.round(layout.frameW / layout.screenW * 100) + '%';
    this.setData(layout);
  },

  // 用用户的原图在透明 canvas 中裁出机身与 LCD 孔洞；canvas 外没有任何黑/白遮罩。


  roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  },

  onTouchStart(e) {
    if (e.touches.length === 2) this._pinch0 = this.dist(e.touches) || 1;
  },
  onTouchMove(e) {
    if (e.touches.length !== 2 || !this._pinch0) return;
    const k = this.dist(e.touches) / this._pinch0;
    this._ratio = clampFrameRatio(this._ratio * (1 + (k - 1) * 0.06));
    this.layoutFrame();
  },
  dist(t) {
    const dx = t[0].x - t[1].x, dy = t[0].y - t[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  onCamErr() {
    this.setData({
      camErr: true,
      camErrMessage: '相机没能启动',
      camErrCanOpenSettings: true
    });
  },
  openSetting() {
    const that = this;
    wx.openSetting({
      success(res) {
        if (res && res.authSetting && res.authSetting['scope.camera']) {
          that.setData({ camErr: false, camErrMessage: '', camErrCanOpenSettings: false });
        }
      }
    });
  },
  onBack() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.redirectTo({ url: '/subpackageP3/pages/stamp-album/index/index' }); }
    });
  },

  onShutter() {
    // 快门只在 shot 为空时可见(wxml wx:if),而重编码是异步的:从按下到 shot 落定之间
    // 快门一直亮着 ⇒ 连点会并发跑多张 takePhoto+compressImage,最后一张覆盖前面的,白烧算力。
    // (原来 takePhoto 成功即 setData,这个窗口几乎为零;重编码把它拉到几百毫秒。)
    if (this._shooting || this.data.camErr) return;
    this._shooting = true;
    const that = this;
    const cc = wx.createCameraContext();
    cc.takePhoto({
      quality: 'high',
      success(res) { that.cropToFrame(res.tempImagePath); },
      fail() { that._shooting = false; cyToast('拍摄失败'); }
    });
  },

  // 取景框不画白线,但仍定义取景卡内实际要导出的 4:5 像素区域(坐标来自 layout.js)。
  cropToFrame(src) {
    const that = this;
    wx.getImageInfo({
      src,
      success(info) {
        let crop;
        try {
          const oriented = CROP.orientedImageSize(info.width, info.height, info.orientation);
          crop = CROP.frameCropRect({
            imageWidth: oriented.width,
            imageHeight: oriented.height,
            viewportWidth: that.win.windowWidth,
            viewportHeight: that.win.windowHeight,
            frameLeft: that.data.frameL,
            frameTop: that.data.frameT,
            frameWidth: that.data.frameW,
            frameHeight: that.data.frameH
          });
        } catch (e) {
          that._shooting = false;
          cyToast('取景框裁切失败，请重拍');
          return;
        }

        let settled = false;
        const fail = function () {
          if (settled) return;
          settled = true;
          that._shooting = false;
          cyToast('取景框裁切失败，请重拍');
        };
        const done = function (res) {
          if (settled) return;
          settled = true;
          if (!res || !res.tempFilePath) {
            that._shooting = false;
            cyToast('取景框裁切失败，请重拍');
            return;
          }
          // canvas 导出是实际的新 JPEG；随后仍走既有压缩/服务端清洗两层隐私防线。
          try {
            that.stripMetadata(res.tempFilePath);
          } catch (e) {
            that._shooting = false;
            cyToast('照片处理失败，请重拍');
          }
        };

        let canvas, ctx, image;
        try {
          if (!wx.createOffscreenCanvas) {
            throw new Error('OffscreenCanvas unavailable');
          }
          canvas = wx.createOffscreenCanvas({ type: '2d', width: crop.outputWidth, height: crop.outputHeight });
          ctx = canvas.getContext('2d');
          image = canvas.createImage();
        } catch (e) {
          fail();
          return;
        }

        try {
          image.onload = function () {
            let saved = false;
            try {
              ctx.save();
              saved = true;
              ctx.scale(crop.outputWidth / crop.sourceWidth, crop.outputHeight / crop.sourceHeight);
              ctx.translate(-crop.sourceX, -crop.sourceY);
              CROP.drawOrientedImage(ctx, image, info.orientation, info.width, info.height);
              ctx.restore();
              saved = false;
              const result = canvas.toTempFilePath({ fileType: 'jpg', quality: 0.92, success: done, fail });
              if (result && typeof result.then === 'function') result.then(done).catch(fail);
            } catch (e) {
              if (saved) {
                try { ctx.restore(); } catch (ignore) {}
              }
              fail();
            }
          };
          image.onerror = fail;
          image.src = src;
        } catch (e) {
          fail();
        }
      },
      fail() {
        that._shooting = false;
        cyToast('读取照片失败，请重拍');
      }
    });
  },

  // canvas 已从像素重画出新 JPEG；这里的 compressImage 只做质量稳定化，最终文件仍由 GPS EXIF 负控验证。
  //
  // ⚠️ compressImage 本身不承诺剥 EXIF；隐私保证来自前面的 canvas 新 JPEG，
  // 仍必须用「带 GPS EXIF 的样图」对最终文件跑负控，验证前不算数。
  //
  // 失败就不上传:剥不掉时宁可让用户重拍一张,也不静默把带坐标的原图传上去
  // (fail-open 正是「不报错、没日志、功能静默失效」那一类)。
  stripMetadata(src) {
    const that = this;
    wx.compressImage({
      src: src,
      quality: 92,          // 只为触发重编码,不为压体积,画质留高
      success(res) {
        that._idemKey = that.newIdemKey();   // 一张照片一个键:重试复用,重拍换新
        that._shooting = false;
        that.setData({ shot: res.tempFilePath, saveError: '' });
      },
      fail() {
        that._shooting = false;              // 放开快门,否则用户重拍不了(卡死比漏 EXIF 更容易被骂)
        cyToast('照片处理失败，请重拍');
      }
    });
  },

  // 幂等键:防双击与网络重试重复入册。服务端 uk_member_idem 认它,同键第二次返回原票。
  newIdemKey() {
    return 'st-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  },

  readPendingCreate() {
    try {
      const memberId = String((app.getUserID && app.getUserID()) || '');
      if (!memberId) return null;
      const accountKey = PENDING_CREATE_KEY + ':' + memberId;
      const pending = wx.getStorageSync(accountKey);
      if (pending && typeof pending.picUrl === 'string' && pending.picUrl
          && typeof pending.idempotencyKey === 'string' && pending.idempotencyKey
          && String(pending.memberId || '') === memberId) {
        this._pendingMemberId = memberId;
        return pending;
      }
      if (pending) wx.removeStorageSync(accountKey);

      // 兼容旧版单键数据：只由所属账号迁移；其他账号和登录恢复前都不得删除。
      const legacy = wx.getStorageSync(PENDING_CREATE_KEY);
      if (legacy && typeof legacy.picUrl === 'string' && legacy.picUrl
          && typeof legacy.idempotencyKey === 'string' && legacy.idempotencyKey
          && String(legacy.memberId || '') === memberId) {
        wx.setStorageSync(accountKey, legacy);
        wx.removeStorageSync(PENDING_CREATE_KEY);
        this._pendingMemberId = memberId;
        return legacy;
      }
    } catch (e) {}
    return null;
  },

  persistPendingCreate(picUrl, idempotencyKey) {
    const memberId = String((app.getUserID && app.getUserID()) || '');
    if (!memberId) return false;
    const pending = { picUrl: picUrl, idempotencyKey: idempotencyKey, memberId: memberId };
    try { wx.setStorageSync(PENDING_CREATE_KEY + ':' + memberId, pending); } catch (e) {
      // 持久化失败时 fail-closed：不发送可能无法对账的写请求。
      return false;
    }
    this._pendingMemberId = memberId;
    return true;
  },

  clearPendingCreate() {
    const memberId = String(this._pendingMemberId || ((app.getUserID && app.getUserID()) || ''));
    if (!memberId) return;
    try {
      wx.removeStorageSync(PENDING_CREATE_KEY + ':' + memberId);
      const legacy = wx.getStorageSync(PENDING_CREATE_KEY);
      if (legacy && String(legacy.memberId || '') === memberId) wx.removeStorageSync(PENDING_CREATE_KEY);
    } catch (e) {}
    this._pendingMemberId = '';
  },

  onRetake() {
    // 保存请求在途、或已入册等待跳转时都忽略重拍,避免旧请求回来/即将跳转时打断新一轮拍摄
    if (this.data.saving || this._redirecting) return;
    if (this.readPendingCreate()) {
      cyToast('请先确认上次入册结果');
      return;
    }
    this.setData({ shot: '', saveError: '' });
  },

  setSaveError(res, fallback, kind, title) {
    const message = app.getRequestErrorMessage
      ? app.getRequestErrorMessage(res, fallback)
      : ((res && res.msg) || fallback);
    this.setData({
      saving: false,
      saveError: message,
      saveErrorKind: kind || 'data',
      saveErrorTitle: title || '暂时未能存入'
    });
  },

  onSave() {
    // _redirecting:200 成功到 redirectTo 真正发生之间还有 600ms toast 窗口,saving 已被 complete 提前重置,
    // 这里额外拦一道防止同一张照片在这个窗口里被再次点存入,产生重复上传+重复入册记录
    if (this.data.saving || this._redirecting || !this.data.shot) return;
    this.setData({ saveError: '' });
    const pending = this.readPendingCreate();
    if (pending) {
      this._idemKey = pending.idempotencyKey;
      this.setData({ saving: true });
      this.submitStampCreate(pending.picUrl, pending.idempotencyKey);
      return;
    }
    this.setData({ saving: true, saveError: '' });
    const that = this;
    const uploadOperation = app.createPageBoundOperation();
    this._uploadOperation = uploadOperation;
    uploadOperation.attach(app.getUploadClient().uploadAll([this.data.shot], {
      bizType: 'stamp',
      onDone(r) {
        if (uploadOperation.isAborted()) return;
        uploadOperation.finish();
        if (that._uploadOperation === uploadOperation) that._uploadOperation = null;
        // uploadAll 默认 mapResult 直接返回 data.url(字符串),不是 {url} 对象。
        const url = r && r.results && r.results[0];
        if (!url) {
          that.setSaveError(null, '照片上传失败，请重试', 'network', '照片还没上传');
          return;
        }
        if (!that.persistPendingCreate(url, that._idemKey)) {
          that.setSaveError(null, '暂时无法安全保存，请稍后重试', 'data', '本次入册未提交');
          return;
        }
        that.submitStampCreate(url, that._idemKey);
      }
    }));
  },

  submitStampCreate(picUrl, idempotencyKey) {
    const that = this;
    this._saveRequestTask = app.sendRequest({
      // idempotencyKey 跟着这张照片走:上传重试/离页后对账都是同一个键。
      url: '/api/roam/stamp/create', method: 'POST', hideLoading: true, silentError: true,
      data: { picUrl: picUrl, idempotencyKey: idempotencyKey },
      success(res) {
        if (res && res.code == '200') {
          // 页面已离开时用户看不到成功回执；保留 pending，重进后用同一键读取服务端原记录。
          // 当前页仍在时才可在展示成功并跳转前清理。
          if (that._unloaded) return;
          that.clearPendingCreate();
          cyToast('已入册');
          that._redirecting = true;
          that._saveTimer = setTimeout(function () {
            wx.redirectTo({ url: '/subpackageP3/pages/stamp-album/index/index' });
          }, 600);
        } else {
          // 收到明确业务失败证明本次没有入册，允许用原键重试。
          that.clearPendingCreate();
          if (!that._unloaded) that.setSaveError(res, '保存失败，请重试', 'data', '本次入册未提交');
        }
      },
      // 断网或 HTTP 异常无法判断服务端是否已提交：pending 必须保留以便同键对账。
      fail(res) {
        if (!that._unloaded) that.setSaveError(res, '保存结果待确认，请重试', 'network', '入册结果待确认');
      },
      successStatusAbnormal(res) {
        if (!that._unloaded) that.setSaveError(res, '保存结果待确认，请重试', 'network', '入册结果待确认');
      },
      complete() {
        that._saveRequestTask = null;
        if (!that._unloaded) that.setData({ saving: false });
      }
    });
  },

  // 自动化自证:读取真正导出的临时 JPEG，不从 data 或几何公式反推文件结果。
  __shotFileProbe() {
    const shot = this.data.shot;
    if (!shot) return Promise.resolve(null);
    const exifInfo = function (buffer) {
      const bytes = new Uint8Array(buffer);
      const bad = { hasExif: false, hasGpsExif: false };
      if (bytes.length < 14 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bad;
      const read16 = function (offset, little) {
        if (offset + 1 >= bytes.length) return -1;
        return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
      };
      const read32 = function (offset, little) {
        if (offset + 3 >= bytes.length) return -1;
        if (little) return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
        return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
      };
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) return bad;
        const marker = bytes[offset + 1];
        const length = read16(offset + 2, false);
        if (length < 2 || offset + 2 + length > bytes.length) return bad;
        if (marker === 0xe1 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78
            && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66
            && bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
          const tiff = offset + 10;
          const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
          if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return bad;
          const ifd0 = tiff + read32(tiff + 4, little);
          const count = read16(ifd0, little);
          if (count < 0) return { hasExif: true, hasGpsExif: false };
          let gpsOffset = -1;
          for (let i = 0; i < count; i++) {
            const entry = ifd0 + 2 + i * 12;
            if (read16(entry, little) === 0x8825) gpsOffset = tiff + read32(entry + 8, little);
          }
          if (gpsOffset < 0) return { hasExif: true, hasGpsExif: false };
          const gpsCount = read16(gpsOffset, little);
          let latitudeRef = false;
          let latitude = false;
          let longitudeRef = false;
          let longitude = false;
          for (let i = 0; i < gpsCount; i++) {
            const tag = read16(gpsOffset + 2 + i * 12, little);
            latitudeRef = latitudeRef || tag === 1;
            latitude = latitude || tag === 2;
            longitudeRef = longitudeRef || tag === 3;
            longitude = longitude || tag === 4;
          }
          return { hasExif: true, hasGpsExif: latitudeRef && latitude && longitudeRef && longitude };
        }
        offset += 2 + length;
      }
      return bad;
    };
    return new Promise(function (resolve) {
      wx.getImageInfo({
        src: shot,
        success(info) {
          wx.getFileSystemManager().readFile({
            filePath: shot,
            success(res) {
              resolve({
                width: info.width,
                height: info.height,
                hasExif: exifInfo(res.data).hasExif,
                hasGpsExif: exifInfo(res.data).hasGpsExif
              });
            },
            fail() { resolve({ width: info.width, height: info.height, unreadable: true }); }
          });
        },
        fail() { resolve(null); }
      });
    });
  }
});
