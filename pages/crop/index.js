/* 裁剪页(Threads 式:框固定居中,图在框内拖拽/双指缩放,框外纯黑)
 *
 * 入参:经 eventChannel 的 'cropInit' 收 { paths:[...], ratio:'1:1'|'16:9'|'3:4'|'free' }。
 *       —— 不走 query:9 张临时路径塞 URL 会超长。
 * 出参:eventChannel 'cropDone' { paths } —— null 表示用户取消整批。
 *
 * ★ N 张在本页内部迭代,裁完一次性抛回。为什么不由调用方逐张开页:
 *   eventChannel.emit 是同步的,调用方 resolve 后会在同一 tick 里发起下一次 navigateTo,
 *   而上一张的 navigateBack 尚未落地 → 弹错页 / 静默丢图(2026-07-17 code review 实证)。
 *   收在页内后全程只有一次 navigateTo + 一次 navigateBack,该竞态不复存在。
 * ★ emit 唯一出口在 onUnload(pop 已提交),侧滑/物理返回也能兜住,调用方不会永久挂起。
 */
const { parseRatio, clampTransform, computeCropRect } = require('./utils/crop-geometry');

const NAV_CONTENT_H = 44;     // 导航栏内容区(状态栏之外),对齐微信胶囊
const BOTTOM_BAR_H = 56;      // 底栏 取消/选取
const MAX_OUTPUT_EDGE = 1440; // 导出长边上限:防止大图裁完仍是几 MB 拖垮上传
// cropInit 从 app.cropAll 的 navigateTo success 回调抛来,比 onLoad 晚;通道在但图始终不来
// (opener 在 emit 前就崩 / 被顶掉)时用这只闸兜到无源态,不让用户卡在等待里。
const SOURCE_WAIT_MS = 3000;

Page({
  data: {
    src: '',
    title: '裁剪',
    navPadTop: 20,
    navContentH: NAV_CONTENT_H,
    bottomBarH: BOTTOM_BAR_H,
    frameW: 0,
    frameH: 0,
    imgW: 0,     // 渲染基准尺寸(cover 满框,scale=1 时的屏幕尺寸)
    imgH: 0,
    tx: 0,
    ty: 0,
    scale: 1,
    // 图源四态。waiting 不是"没有图",不能当无源态渲染:cropInit 必然晚于首帧,
    // 初始就画"没有可裁剪的图片"会让每一次正常选图都闪一下假空态。
    sourceState: 'waiting', // waiting | ready | missing | error
    sourceError: '',
    exportError: '',
    ready: false,
    busy: false,
  },

  onLoad() {
    this.done = false;
    this.result = null;      // onUnload 抛它;保持 null = 取消
    this.queue = [];
    this.results = [];
    this.idx = 0;
    this.ratioLiteral = 'free';
    this.natural = { w: 0, h: 0 };
    this.gesture = null;

    const win = wx.getWindowInfo();
    const navPadTop = win.statusBarHeight || 20;
    // 底栏实际高 = BOTTOM_BAR_H + 安全区(wxss 用 content-box 把安全区加在 56 之外),
    // 漏减安全区会让框比舞台高、竖长图被切
    const safeBottom = win.safeArea ? Math.max(0, win.screenHeight - win.safeArea.bottom) : 0;
    this.avail = {
      w: win.windowWidth,
      h: win.windowHeight - navPadTop - NAV_CONTENT_H - BOTTOM_BAR_H - safeBottom,
    };
    this.setData({ navPadTop });

    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    // 不是经 app.chooseImage 打开的(无 opener 通道)时，留在可解释的空态并提供返回动作。
    // 不能直接 finish(null)：直开会只留下黑取景台，用户不知道下一步该做什么。
    if (!ch || !ch.on) { this.showMissingSource(); return; }
    // 闸必须先上:eventChannel 会把 on 之前就 emit 的事件在 on() 里**同步**回放,
    // 若先 on 后上闸,那一路的 clearSourceWait 会空跑,随后仍挂一只 3s 悬空定时器。
    this.sourceWaitTimer = setTimeout(() => {
      this.sourceWaitTimer = null;
      if (this.data.sourceState === 'waiting') this.showMissingSource();
    }, SOURCE_WAIT_MS);
    ch.on('cropInit', (d) => {
      this.clearSourceWait();
      this.queue = (d && d.paths) || [];
      this.ratioLiteral = (d && d.ratio) || 'free';
      // 通道通了但一张图都没给 = 真的没有可裁的图,不是还在等。
      if (!this.queue.length) { this.showMissingSource(); return; }
      this.startAt(0);
    });
  },

  showMissingSource() {
    this.clearSourceWait();
    this.setData({ sourceState: 'missing', sourceError: '', exportError: '', ready: false, busy: false, title: '裁剪' });
  },

  showSourceError(message) {
    this.setData({
      sourceState: 'error',
      sourceError: message || '这张图片暂时无法读取，请重试或使用原图',
      exportError: '',
      ready: false,
      busy: false,
    });
  },

  showExportError(message) {
    this.setData({
      busy: false,
      exportError: message || '裁剪结果没有生成，请重试或使用原图',
    });
  },

  clearSourceWait() {
    if (this.sourceWaitTimer) { clearTimeout(this.sourceWaitTimer); this.sourceWaitTimer = null; }
  },

  // 载入队列第 i 张
  startAt(i) {
    this.idx = i;
    this.gesture = null;
    const src = this.queue[i];
    // 尺寸没读到之前不能算 ready:那会让「选取」露出来但 onConfirm 因 !ready 静默 return。
    // 复用 waiting(此刻确实还在准备这张图),layout 成功才同时置 sourceState/ready。
    this.setData({
      src,
      sourceState: 'waiting',
      sourceError: '',
      exportError: '',
      ready: false,
      busy: false,
      title: this.queue.length > 1 ? `裁剪 ${i + 1}/${this.queue.length}` : '裁剪',
    });
    wx.getImageInfo({
      src,
      success: (info) => { this.natural = { w: info.width, h: info.height }; this.layout(); },
      fail: () => this.showSourceError('这张图片暂时无法读取，请重试或使用原图'),
    });
  },

  onRetrySource() { this.startAt(this.idx); },

  onUseOriginal() {
    if (this.data.busy) return;
    this.acceptRaw();
  },

  layout() {
    const { w: natW, h: natH } = this.natural;
    if (!(natW > 0 && natH > 0)) { this.showSourceError('图片尺寸无法识别，请重试或使用原图'); return; }

    // 自由比例 = 跟随原图比例(此时框即全图,用户仍可放大取局部)
    const ratio = parseRatio(this.ratioLiteral) || natW / natH;
    let frameW = this.avail.w;
    let frameH = frameW / ratio;
    if (frameH > this.avail.h) {           // 竖长框放不下 → 以高为准回算宽
      frameH = this.avail.h;
      frameW = frameH * ratio;
    }

    // 图片渲染基准 = cover 满框
    const base = Math.max(frameW / natW, frameH / natH);
    this.setData({
      frameW,
      frameH,
      imgW: natW * base,
      imgH: natH * base,
      tx: 0,
      ty: 0,
      scale: 1,
      // 与 ready 同步翻:「选取」露出的那一刻 onConfirm 必须真的能干活
      sourceState: 'ready',
      sourceError: '',
      exportError: '',
      ready: true,
    });
  },

  // ---- 手势:单指平移 / 双指缩放 ----
  onTouchStart(e) {
    const t = e.touches;
    if (t.length === 1) {
      this.gesture = { mode: 'pan', x0: t[0].clientX, y0: t[0].clientY, tx0: this.data.tx, ty0: this.data.ty };
    } else if (t.length >= 2) {
      this.gesture = { mode: 'pinch', d0: this.distance(t[0], t[1]), s0: this.data.scale };
    }
  },

  onTouchMove(e) {
    const g = this.gesture;
    if (!g || !this.data.ready) return;
    const t = e.touches;
    let next;
    if (g.mode === 'pan' && t.length === 1) {
      next = { tx: g.tx0 + (t[0].clientX - g.x0), ty: g.ty0 + (t[0].clientY - g.y0), scale: this.data.scale };
    } else if (g.mode === 'pinch' && t.length >= 2) {
      const d = this.distance(t[0], t[1]);
      next = { tx: this.data.tx, ty: this.data.ty, scale: g.d0 > 0 ? g.s0 * (d / g.d0) : this.data.scale };
    } else {
      return;
    }
    // 每帧夹边界:图片永远贴满框,拖不出黑边(与导出用的是同一套约束)
    const c = clampTransform({
      imgW: this.natural.w, imgH: this.natural.h,
      frameW: this.data.frameW, frameH: this.data.frameH,
      scale: next.scale, x: next.tx, y: next.ty,
    });
    this.setData({ tx: c.x, ty: c.y, scale: c.scale });
  },

  onTouchEnd(e) {
    // 多指抬到只剩一根时重起 pan 基准,否则剩下那根会带着旧基准跳一下
    if (e.touches && e.touches.length === 1) {
      this.gesture = { mode: 'pan', x0: e.touches[0].clientX, y0: e.touches[0].clientY, tx0: this.data.tx, ty0: this.data.ty };
    } else if (e.touches && e.touches.length >= 2) {
      this.gesture = { mode: 'pinch', d0: this.distance(e.touches[0], e.touches[1]), s0: this.data.scale };
    } else {
      this.gesture = null;
    }
  },

  distance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  },

  // ---- 导出 ----
  onConfirm() {
    if (this.data.busy || !this.data.ready) return;
    // 恒等裁剪:自由比例 + 没缩放没平移 ⇒ 框就是整图,导出只会把图重编码一遍(还会丢 PNG 透明)。
    // 直接收原图,省一次 canvas 往返。
    if (!parseRatio(this.ratioLiteral) && this.data.scale === 1 && this.data.tx === 0 && this.data.ty === 0) {
      this.acceptRaw();
      return;
    }
    const rect = computeCropRect({
      imgW: this.natural.w, imgH: this.natural.h,
      frameW: this.data.frameW, frameH: this.data.frameH,
      scale: this.data.scale, x: this.data.tx, y: this.data.ty,
    });
    if (!rect) { this.showExportError('裁剪范围无效，请调整图片后重试'); return; }

    this.setData({ busy: true, exportError: '' });
    wx.createSelectorQuery().in(this).select('#cropCanvas').fields({ node: true }).exec((res) => {
      const node = res && res[0] && res[0].node;
      if (!node) { this.showExportError('裁剪工具暂时不可用，请重试或使用原图'); return; }
      this.drawAndExport(node, rect);
    });
  },

  drawAndExport(canvas, rect) {
    const long = Math.max(rect.sw, rect.sh);
    const k = long > MAX_OUTPUT_EDGE ? MAX_OUTPUT_EDGE / long : 1;
    const outW = Math.round(rect.sw * k);
    const outH = Math.round(rect.sh * k);
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext('2d');
    const img = canvas.createImage();
    img.onload = () => {
      // 先铺白:导出是 jpg,不铺底的话 PNG 透明像素会被合成成黑色
      // (相册里的透明底二维码裁完 = 黑码黑底 = 扫不出来)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH);
      wx.canvasToTempFilePath({
        canvas,
        destWidth: outW,
        destHeight: outH,
        fileType: 'jpg',
        quality: 0.92,
        success: (r) => this.accept(r.tempFilePath),
        fail: () => this.showExportError('裁剪结果没有生成，请重试或使用原图'),
      }, this);
    };
    img.onerror = () => this.showExportError('图片载入失败，请重试或使用原图');
    img.src = this.data.src;
  },

  acceptRaw() { this.accept(this.queue[this.idx]); },

  // 收下当前这张,推进队列;最后一张收完即整批完成
  accept(path) {
    this.results.push(path);
    if (this.idx + 1 < this.queue.length) this.startAt(this.idx + 1);
    else this.finish(this.results);
  },

  // 取消 = 放弃整批(用户看得到「3/9」,知道自己在放弃什么);调用方负责提示
  onCancel() { this.finish(null); },

  finish(paths) {
    if (this.done) return;
    this.done = true;
    this.result = (paths && paths.length) ? paths : null;
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  },

  // 唯一 emit 出口:onUnload 时 pop 已提交,调用方此刻再发起路由才是安全的。
  // 侧滑/物理返回不走 finish → result 仍是 null = 取消,调用方不会永久挂起。
  onUnload() {
    this.clearSourceWait();
    try {
      const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (ch && ch.emit) ch.emit('cropDone', { paths: this.result });
    } catch (err) {}
  },
});
