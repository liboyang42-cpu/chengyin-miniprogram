// cy-playkit-photocheck · 拍照审核(契约 §2.2,2026-09-17 改版:接真视觉模型)
//
// 两步走,与 qa 拍照题同一条路:**先选/拍一张 → 页面把它传上去拿地址 → 再提交**。
// 组件这里只做前一半:选完就把临时路径抛给页面,**本组件不发任何请求、也不再读像素**。
//
// ★ 判定全在服务端(契约 §2.2):照片交给视觉模型按作者写的 requirement 判,
//   客户端只报原始输入。原先「本地算亮区/边缘/清晰度 → 随图上报 score」那套整段删除 ——
//   客户端报的分可伪造,也判不了「有没有拍到『新』字招牌」这种语义要求。
//
// 服务端可能给降级态(degraded:模型不可用/超时/解析失败):这时**不判死也不假装通过**,
// 这一屏只说清「这次没能审」,不许出现「审核通过 / 不通过」这类假结论。

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const replayMotionBehavior = require('../../../../behaviors/replay-motion.js');
const motion = require('../../../../utils/motion.js');
const cyToast = require('../../../../utils/toast.js');

Component({
  behaviors: [reducedMotionBehavior, replayMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    shotNote: { type: String, value: '' },
    maxTries: { type: Number, value: 0 },
    fallback: { type: String, value: 'retake' },
    tries: { type: Number, value: 0 },
    passed: { type: Boolean, value: false },
    flagged: { type: Boolean, value: false },
    // 模型不可用等降级态 + 服务端给的那句不过的理由(契约 §2.2 state.photoCheck)
    degraded: { type: Boolean, value: false },
    lastReason: { type: String, value: '' },
    lastUrl: { type: String, value: '' },
    // 内嵌呈现(故事流里就地玩)。只影响取不取景,不影响判定 —— 见 onShoot 的说明
    inline: { type: Boolean, value: false },
    // 取景轮廓(S1):作者给的半透明轮廓，玩家把实物套进去再按快门。没配则整块取景逻辑不启动
    frameUrl: { type: String, value: '' },
    frameOpacity: { type: Number, value: 40 },
    // 拍物成卡:判过时服务端随本次回包带回来的那张卡(契约 §10.2)。null = 这一屏没有卡。
    card: { type: Object, value: null },
  },
  data: {
    busy: false,
    triesLabel: '',
    verdict: '',
    verdictKind: '',
    reason: '',
    // framing:页内取景中。取景器起不来过没有(camErr)只影响下一条快门走哪条路，
    // 屏上没有任何东西看它 —— 那是实例状态，不进 data(见 onFrameError 的 this._camErr)。
    framing: false,
    // 轮廓图没加载出来:只把那条线藏掉，取景与提交照常
    outlineFailed: false,
  },
  observers: {
    'show, tries, maxTries, passed, flagged, degraded, fallback, lastReason': function (show, tries, maxTries, passed, flagged, degraded, fallback, lastReason) {
      if (!show) return;
      const total = Number(maxTries) || 0;
      const used = Number(tries) || 0;
      const left = total > 0 ? Math.max(0, total - used) : 0;
      let verdict = '';
      let verdictKind = '';
      let reason = '';
      if (degraded) {
        // 降级:这次没有结论。不许说「通过 / 不通过」,也不把玩家卡在这一屏
        verdict = '这次没能审，先往下走';
        verdictKind = '';
      } else if (passed) {
        verdict = '这张过了';
        verdictKind = 'ok';
      } else if (flagged) {
        verdict = fallback === 'pass' ? '机会用完了，这张先算过' : '机会用完了';
        verdictKind = fallback === 'pass' ? 'ok' : 'no';
      } else if (used > 0) {
        verdict = '还差一点，再拍一张';
        verdictKind = 'no';
        // 真实理由(服务端给的),有就摆给玩家看,别只丢一句「再拍一张」
        reason = String(lastReason || '').trim();
      }
      /* 第二次判定要重播。`wx:if="{{verdict}}"` 一旦为真就恒真,节点复用 ——
         连「这张过了」都不播,判定像是本来就在那。
         判据带上 used:再拍一张仍没过时文案一模一样,只看文案会漏掉这一次。
         首次出判定时 wx:if 由假转真、节点是新建的,prevVerdict 为空不走这里。 */
      const prevVerdict = this.data.verdict;
      const prevUsed = this._seenUsed;
      this._seenUsed = used;
      this.setData({
        triesLabel: total > 0 ? ('还能重拍 ' + left + ' 次') : '',
        verdict,
        verdictKind,
        reason,
      });
      if (prevVerdict && verdict && (verdict !== prevVerdict || used !== prevUsed)) this.replayMotion();
    },
  },
  methods: {
    /**
     * 拍/选一张 → 直接抛给页面走「上传再提交」两步;判定全在服务端。
     *
     * <p>作者配了取景轮廓(frameUrl)时先进**页内取景**:镜头里浮着那条轮廓,
     * 把实物套进去再按快门。取景起不来(相机被拒/不可用)就回落到 chooseMedia ——
     * ⚠️ 轮廓是取景辅助,不是判定条件,绝不能因为它没起来就不让玩家拍这一张。
     */
    onShoot() {
      if (this.data.busy || this.data.passed || this.data.flagged) return;
      /* ⚠️ 内嵌呈现(故事流里就地玩)不进页内取景:.chfull__para 恒带 transform:scale() 与
         filter:blur()(见 pages/play/index.wxml 那一行的行内样式,值永远是数字、不是 none),
         非 none 的 transform/filter 会成为 position:fixed 后代的包含块 —— 取景层会被圈进
         190rpx 高的段落里、跟着一起糊。仓里 play-stage 为同一件事开了 --pk-stage-pos 注入点。
         photoCheck 不在 PRESENT_FULLSCREEN_ONLY 里,作者确实配得出 present:'inline'。
         轮廓是取景辅助不是判定条件,内嵌就直接走选图,玩法照常能完成。 */
      if (this.data.frameUrl && !this._camErr && !this.data.inline) {
        this.setData({ framing: true, outlineFailed: false });
        return;
      }
      this.chooseViaMedia();
    },

    /** 原来那条路:相册/系统相机选一张。没配轮廓时的默认，也是取景失败后的回落。 */
    chooseViaMedia() {
      // busy 与改版前一致:选图期间按钮压在「看一眼…」，连点不会起第二个选择器
      this.setData({ framing: false, busy: true });
      wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['compressed'],
        success: (res) => {
          const file = (res && res.tempFiles && res.tempFiles[0]) || {};
          this._emitShot(file.tempFilePath || '', file.size, !res);
        },
        fail: () => { this.setData({ busy: false }); },
      });
    },

    /** 页内取景按快门:整屏就是取景器,快门只出这一张。 */
    onFrameShutter() {
      if (this.data.busy) return;
      this.setData({ busy: true });
      wx.createCameraContext('pcFrame').takePhoto({
        quality: 'high',
        success: (res) => {
          this._emitShot(res && res.tempImagePath, undefined, false);
        },
        fail: () => {
          this.setData({ busy: false });
          /* 连着两次拍不上就别耗着:相机可能被别的应用占着,或这台机器的 takePhoto 不兼容 ——
             这两种都不触发 camera 的 binderror,onFrameError 那条回落路永远够不着,
             玩家会卡在取景器里只能弃玩。同上:轮廓是辅助不是判定。 */
          this._shutterFails = (this._shutterFails || 0) + 1;
          if (this._shutterFails >= 2) {
            this._camErr = true;
            cyToast('相机拍不出来，改用相册或系统相机');
            this.chooseViaMedia();
            return;
          }
          cyToast('这张没拍上，再按一次');
        },
      });
    },

    /** 一张照片到手:退出取景，没路径就说清，有路径才抖一下并抛给页面。 */
    _emitShot(tempFilePath, size, aborted) {
      this.setData({ busy: false, framing: false });
      if (!tempFilePath) {
        if (!aborted) cyToast('没拿到照片');
        return;
      }
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('shoot', { tempFilePath: tempFilePath, size: size });
    },

    /** 轮廓图自身加载失败:只藏掉那条线，取景器与快门照常。 */
    onOutlineError() { this.setData({ outlineFailed: true }); },

    /** 取景器起不来(权限被拒 / 设备不支持):说清楚，然后回落到选图，玩法照常能完成。 */
    onFrameError() {
      if (!this.data.framing) return;
      this._camErr = true;
      this.setData({ framing: false });
      cyToast('取景器打不开，改用相册或相机拍');
      this.chooseViaMedia();
    },

    /** 退出取景。⚠️ 快门在途(busy)时不给退:退了 takePhoto 的回调照样会到、照样提交,
        玩家以为取消了却被吃掉一次机会 —— 配了 maxTries 的段上这是真丢机会。 */
    onFrameCancel() {
      if (this.data.busy) return;
      this.setData({ framing: false });
    },

    onClose() { this.triggerEvent('close'); },
  },
});
