// cy-playkit-dailysign · 今日城市签(接力签)
//
// 2026-09-05 重做:签是一张**从打印机里打出来的白色热敏小票**(参考 @heydamir 的登机牌打印稿,逐帧看过):
//   出纸(1.5s 从槽里滚出来)→ 按住往下拉,纸跟着手歪 → 拉过 TEAR_PX 松手撕断、往下一甩落到手里
//   → 刮开签文 → 留一句 → 收下。撕下来之前刮不动:纸还连在机器上,刮它没有意义。
// 2026-09-06 改成接力:票面上那句是**上一个来这里的人**留的(没人来过是发起人的开场签),
//   出发地址是这一站的地址;收下的条件是也给下一个人留一句(可顺手拍一张)。票面上没有任何写死的数据。
// 文案/照片/地址全由服务端下发,组件只排版。lines 传数组而不是让组件按标点断行 —— 断在哪是文案的事。
//
// ⚠️ 「拉」和「刮」都是运动能力要求。开了「减少动态效果」→ 不打印动画、不要求拉(直接算撕下),
// 刮层由 cy-scratch 自己按同一开关整层不挂;没开开关但一时拉不动的人,底部有可见的「撕不下来?点这里」。
//
// 2026-09-19 接上断掉的那根线:票面右下角的「保存到相册」原本只往父级抛一个 save 事件,
// 全链路无人接收 —— 玩家点了没反应、没 toast、没图。保存是**一张纸的事**,不该问父级要:
// 现在组件自己用 canvas 把票面复刻一张导出相册(见下方「保存到相册」一段)。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const toast = require('../../../../utils/toast.js');
const { readReducedMotion } = require('../../../../utils/motion-preference.js');
const { resolveMenuChrome } = require('../../../../utils/nav-safe-area.js');

const TEAR_PX = 80;      // 拉过这个距离(css px)松手才撕断,不到就弹回去
const DRAG_DAMP = 0.7;   // 纸还连在机器上:手拉 1 它走 0.7
const ROT_MAX = 9;       // 拉的时候最多歪几度
const PRINT_DELAY_MS = 40;   // 先渲染在槽里,下一帧再加 is-printed,过渡才会跑(同帧加 class 等于没动画)
const PRINT_MS = 1500;       // 出纸时长(和 wxss 的 .is-printing 同一个数):出纸中途不许抓
const HINT = {
  print: '出票中',
  pull: '按住小票,往下拉',
  scratch: '刮开 TA 留给你的那句',
  write: '也给下一个来这里的人留一句',
  done: '留下了,下一个来的人会看到',
};

/* ── 保存到相册:票面在 canvas 上复刻一张 ──
 * canvas 读不到 CSS 变量,所以色值只能照 pages/play 的 PLAY_STORY_CARD 先例逐字抄一张表。
 * 每个值都能在本文件对应的 wxss 选择器上找到同一个数(契约测试逐条钉住:wxss 改了没同步这里就判红)。
 * 1 画布单位 = 1rpx —— 尺寸与 index.wxss 同一把尺,保存下来的才是刚才看到的那张纸。 */
const DAILY_SIGN_CARD = Object.freeze({
  deskTop: '#F6F7F9', deskMid: '#EEF0F3', deskBottom: '#E6E8EC',   /* .ds__bg 三段渐变 */
  paper: '#FFFFFF',      /* .ds__slip 热敏纸 */
  ink: '#17191C',        /* .ds__slip 的热敏字 / .ds__bar 条码 */
  ink2: '#5B6169',       /* .ds__d / .ds__sm 次级墨 */
  faint: '#8A9099',      /* .ds__k 淡墨 */
  rule: '#D7DAE0',       /* .ds__hr 热敏纸上的虚线 */
  poemBg: '#F5F6F8',     /* .ds__scratch 签文那块淡底 */
  shadow: 'rgba(20,22,26,.28)',
});

/* 版式数字,右侧注释是它来自 wxss 的哪一条 */
const SLIP = Object.freeze({
  W: 750, DPR: 2,                      /* 画布逻辑宽 = 设计宽;出图倍率同完赛卡 */
  DESK_Y: 64, DESK_BOTTOM: 64,         /* 纸浮在台面上,上下各留一点 */
  PAPER_X: 92, PAPER_W: 566,           /* .ds__slip 屏上实宽:750 − 页面 32×2 − 窗口 44×2 − 内衬 16×2 */
  PAD_X: 28, PAD_TOP: 20, PAD_BOTTOM: 14,   /* .ds__slip padding: 20rpx 28rpx 14rpx */
  TOOTH: 12, PERIOD: 24,               /* .ds__slip::after / ::before 的撕口锯齿 */
  GAP: 16,                             /* .ds__od / .ds__grid 的 gap */
  HR: 26, DASH: 6,                     /* .ds__hr:上下 12 + 2 线;虚线一段长 */
  HEAD_H: 40,                          /* .ds__row */
  MICRO_H: 28, CAP_H: 30, ADDR_H: 36, BIG_H: 48, GRID_H: 38,  /* .ds__k / .ds__sm / .ds__addr / .ds__big / .ds__v 的行高 */
  PHOTO_H: 200, PHOTO_R: 6, PHOTO_CAP_GAP: 8,   /* .ds__photo: height 200 radius 6;.ds__photo-k margin-top 8 */
  POEM_LH: 50, POEM_PAD_X: 18, POEM_PAD_T: 12, POEM_PAD_B: 10, POEM_R: 16, POEM_GAP: 12,  /* .ds__poem line-height 1.8 / .ds__poemwrap margin-top */
  BAR_H: 36, BAR_T: 2, BAR_W_PCT: 0.82,  /* .ds__barcode height 36 / margin-top 2 / width 82% */
});

const F_UI = '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif';        /* = 屏上默认字体 */
const F_NUM = '"SF Mono", "DIN Alternate", ui-monospace, Menlo, Consolas, monospace';  /* = --cy-font-numeric */
const F_SERIF = '"Noto Serif SC", "Songti SC", serif';                            /* = .ds__poem */
const fnt = (weight, size, family) => weight + ' ' + size + 'px ' + family;
const FONT = Object.freeze({
  title: fnt(600, 28, F_UI),        /* .ds__t */
  date: fnt(400, 24, F_NUM),        /* .ds__d */
  k: fnt(400, 20, F_UI),            /* .ds__k */
  addr: fnt(700, 28, F_UI),         /* .ds__addr */
  big: fnt(700, 44, F_UI),          /* .ds__big */
  sm: fnt(400, 22, F_NUM),          /* .ds__sm */
  v: fnt(600, 28, F_UI),            /* .ds__v */
  poem: fnt(600, 28, F_SERIF),      /* .ds__poem */
});

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show:        { type: Boolean, value: false },
    dateLabel:   { type: String,  value: '' },
    /* 出发 = 这一站的地址(服务端从节点取,谁发的就是哪个地址) */
    address:     { type: String,  value: '' },
    /* 上一个人留的那句;开场签是发起人配的 */
    lines:       { type: Array,   value: [] },
    /* 留签人昵称;开场签是发起人落款;都没有时票面写「这一站的发起人」 */
    signer:      { type: String,  value: '' },
    /* 上一张留下的时刻;开场签没有 */
    leftAt:      { type: String,  value: '' },
    serialLabel: { type: String,  value: '' },
    textMax:     { type: Number,  value: 40 },
    ctaLabel:    { type: String,  value: '留下,出发' },
    /* 已经留过的签不该再盖一层刮层 —— 昨天擦过的今天重开还要再擦一遍是折磨 */
    revealed:    { type: Boolean, value: false },
    /* 上一个人拍的那张,印在票上。服务端没给就没有这一段,不放占位图 */
    photoUrl:    { type: String,  value: '' },
    /* 我已经留过一句(服务端 claimedDate 非空):留言条变成只读回看,CTA 变「出发」 */
    claimed:     { type: Boolean, value: false },
    myText:      { type: String,  value: '' },
    myPhotoUrl:  { type: String,  value: '' },
  },
  data: {
    printing: false,     // 正在出纸(这段时间抓不动,过渡也用 1.5s 档)
    printed: false,      // 小票已从槽里出来
    torn: false,         // 已撕断
    dragging: false,     // 手正按着(关掉过渡,纸跟手)
    paperStyle: '',      // 拖拽中的 transform;松手清空,交回给 css 过渡
    writing: false,      // 留言条在写:_unlocked 且还没留过
    ctaDisabled: true,   // 写了字才能「留下」;留过之后「出发」随时能按
    cta: '',
    bars: [],            // 条形码:按签号种子生成,同一张签每次一样
    timeLabel: '',       // 出票时刻 HH:MM
    hint: '',
    text: '',            // 留言草稿
    shotUrl: '',         // 顺手拍的那张(已上传的 https 地址)
    saving: false,       // 正在画票 / 写相册:这段时间按钮是「生成中…」的禁用态,不许连点
    noteStyle: '',       // 键盘弹起时把留言条整体抬起(只动 transform)
    stagePadTop: 0,      // 胶囊底实测 + 48px 台面留白;0=走 wxss 的 --cy-safe-top 兜底(env 在无刘海机解析为 0,裸 token 会顶太浅)
  },
  observers: {
    'show': function (show) { if (show) this._open(); else this._reset(); },
    'revealed': function (revealed) {
      if (revealed && !this._unlocked) this._unlock();
    },
    'claimed': function () { this._syncStep(); },
    'serialLabel': function (serial) { this.setData({ bars: buildBars(serial) }); },
  },
  lifetimes: {
    detached() { this._clearTimers(); },
  },
  methods: {
    _open() {
      this._clearTimers();
      if (!this.data.stagePadTop) {
        let windowInfo; let menuButtonInfo;
        try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) {}
        try { menuButtonInfo = wx.getMenuButtonBoundingClientRect(); } catch (e) {}
        this.setData({ stagePadTop: resolveMenuChrome(windowInfo, menuButtonInfo).contentTop + 48 });
      }
      const now = new Date();
      const timeLabel = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      // 直接读偏好,不读 this.data.reducedMotion:宿主一次 setData 就 show=true 时,这个 observer
      // 跑在 behavior 的 attached() 同步之前,data 里还是默认 false —— 减少动态效果的人会被要求拉纸
      const reduced = readReducedMotion();
      const revealed = !!this.data.revealed;
      // 减少动态效果 / 已领过的签:不出纸动画、不要求拉 —— 直接是撕好的一张票
      const skip = reduced || revealed;
      this._unlocked = revealed;
      this.setData({
        printing: false, printed: skip, torn: skip, dragging: false, paperStyle: '',
        timeLabel, text: '', shotUrl: '', noteStyle: '',
        bars: buildBars(this.data.serialLabel),
        hint: skip ? '' : HINT.print,
      });
      this._syncStep(skip && !revealed ? HINT.scratch : '');
      if (skip) return;
      this._printTimer = setTimeout(() => {
        this.setData({ printing: true, printed: true });
        this._printDoneTimer = setTimeout(() => this.setData({ printing: false, hint: HINT.pull }), PRINT_MS);
      }, PRINT_DELAY_MS);
    },
    _reset() {
      this._clearTimers();
      this._drag = null;
      this._unlocked = false;
      this.setData({
        printing: false, printed: false, torn: false, dragging: false, paperStyle: '',
        writing: false, ctaDisabled: true, hint: '', text: '', shotUrl: '', noteStyle: '',
      });
    },
    _clearTimers() {
      if (this._printTimer) { clearTimeout(this._printTimer); this._printTimer = null; }
      if (this._printDoneTimer) { clearTimeout(this._printDoneTimer); this._printDoneTimer = null; }
      if (this._tearTimer) { clearTimeout(this._tearTimer); this._tearTimer = null; }
    },
    /** 三段式的唯一裁决点:没刮开 → 等;刮开没留 → 写;留过 → 出发 */
    _syncStep(hintOverride) {
      const claimed = !!this.data.claimed;
      const unlocked = !!this._unlocked;
      const writing = unlocked && !claimed;
      const hint = hintOverride || (claimed ? HINT.done : writing ? HINT.write : this.data.hint);
      this.setData({
        writing,
        cta: claimed ? '出发' : this.data.ctaLabel,
        ctaDisabled: claimed ? false : !(writing && this.data.text.trim().length > 0),
        hint,
      });
    },
    _unlock() {
      this._unlocked = true;
      this._syncStep();
    },

    /* ── 拉纸 ── */
    onPaperStart(e) {
      // 出纸中途不许抓(抓了纸会瞬移到位);已经按着的时候第二根手指进来也不重算起点
      if (this.data.torn || !this.data.printed || this.data.printing || this._drag) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      this._drag = { x0: t.clientX, y0: t.clientY, dy: 0, lastY: 0 };
      this.setData({ dragging: true });
    },
    /** 拖拽中 / 撕断时的 transform,只此一处拼字符串 */
    _paperStyle(y, rot) {
      return 'transform:translateY(' + y.toFixed(1) + 'px) rotate(' + rot.toFixed(1) + 'deg)';
    },
    onPaperMove(e) {
      const d = this._drag;
      if (!d) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      d.dy = Math.max(0, t.clientY - d.y0);
      // 抓的位置偏一点,纸就歪一点;拉得越长也歪一点
      const rot = clamp((t.clientX - d.x0) / 40 + d.dy * 0.03, -ROT_MAX, ROT_MAX);
      const y = d.dy * DRAG_DAMP;
      // 每次 touchmove 都 setData 会掉帧:位移没过 2px 就不刷
      if (Math.abs(y - d.lastY) < 2) return;
      d.lastY = y;
      this.setData({ paperStyle: this._paperStyle(y, rot) });
    },
    onPaperEnd() {
      const d = this._drag;
      if (!d) return;
      this._drag = null;
      if (d.dy >= TEAR_PX) return this._tear(d.dy * DRAG_DAMP);
      // 不够:交回给 css 过渡弹回去
      this.setData({ dragging: false, paperStyle: '' });
    },
    /** 撕断:先往下再甩半步(视频里那一下),再落到手里 */
    _tear(fromY) {
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.setData({ dragging: false, paperStyle: this._paperStyle(fromY + 54, -6) });
      this._tearTimer = setTimeout(() => {
        this.setData({ torn: true, paperStyle: '', hint: this.data.revealed ? '' : HINT.scratch });
        this._syncStep();
      }, 280);
    },
    /** 拉不动的人的出口:点一下等于拉过阈值 */
    onTearTap() {
      if (this.data.torn) return;
      this._drag = null;
      this._tear(0);
    },

    /* ── 刮开 / 留一句 / 收下 ── */
    onReveal() { this._unlock(); },
    onTextInput(e) {
      this.setData({ text: (e.detail && e.detail.value) || '' });
      this._syncStep();
    },
    /** 键盘弹起时把留言条抬到键盘上方;fixed 浮层不跟系统的页面上推走 */
    onKeyboard(e) {
      const h = Number(e.detail && e.detail.height) || 0;
      this.setData({ noteStyle: h > 0 ? 'transform:translateY(-' + h + 'px)' : '' });
    },
    onShoot() {
      if (!this.data.writing) return;
      const app = getApp();
      // 走统一上传通道(裁剪 + 会话认证):回来的是 https 地址,服务端只认它
      app.chooseImage((urls) => {
        const url = String((Array.isArray(urls) && urls[0]) || '').trim();
        if (!url.toLowerCase().startsWith('https://')) return;
        this.setData({ shotUrl: url });
      }, 1);
    },
    onAccept() {
      if (this.data.claimed) { this.triggerEvent('close'); return; }
      if (!this.data.writing) return;                     // cy-btn disabled 已拦,这里是第二道
      const text = this.data.text.trim();
      if (!text) { toast('先给下一个人留一句'); return; }
      // 留下这一句是仪式的收尾,用 medium:比普通点击重一档,和「敲木鱼」同级
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('accept', { text, photoUrl: this.data.shotUrl });
    },
    /* ── 保存到相册 ──
     * 这是一张纸的事:组件自己把票面画到离屏 canvas 上导出,不往父级抛事件 ——
     * 原本那句往父级抛的 save 全链路无人接收,玩家点了什么都没发生。
     * ⚠️ 相册要授权、会失败,三种结局分开说:生成失败 / 没写进相册 / 玩家自己取消(静默,不是错误)。 */
    onSave() {
      if (this.data.saving) return Promise.resolve();     // 画票 + 写相册是慢活,连点会叠两条链
      if (!this.data.claimed) return Promise.resolve();   // cy 层已 wx:if 拦过,这里是第二道
      const that = this;
      this.setData({ saving: true });
      return this._signCardPath()
        .then((path) => {
          if (!path) {
            that.setData({ saving: false });
            toast('签卡生成失败，再试一次');
            return null;
          }
          return that._saveSignCard(path).then((r) => {
            that.setData({ saving: false });
            if (r === 'saved') { toast.success('已保存到相册'); return; }
            // 拒过一次授权的人,自己再 authorize 不会再弹,只能把他带去设置页
            if (r === 'denied') { wx.openSetting({}); return; }
            if (r === 'fail') toast('没存进相册，检查存储空间后再试');
            /* r === 'cancel':玩家自己点了取消,不打扰 */
          });
        })
        .catch(() => {
          // 兜底:任何一环抛出来都不许把按钮永久留在「生成中…」
          that.setData({ saving: false });
          toast('签卡生成失败，再试一次');
        });
    },
    /** 取画布 → 落照片 → 排版 → 落笔 → 导出。任何一环没成就给空串,由 onSave 报错。 */
    _signCardPath() {
      const that = this;
      return this._getSignCanvas().then((entry) => {
        if (!entry) return '';
        return that._loadSignPhoto(entry).then((photo) => {
          const poster = that._buildSignPoster(function (text, font) {
            entry.ctx.font = font;
            return entry.ctx.measureText(String(text)).width;
          }, !!photo);
          that._drawSignPoster(entry, poster, photo);
          return that._exportSignCanvas(entry.cv);
        });
      });
    },
    /** 组件内查询必须 .in(this):id 只在自定义组件的作用域里唯一 */
    _getSignCanvas() {
      return new Promise((resolve) => {
        wx.createSelectorQuery().in(this).select('#dsSignCv').fields({ node: true }).exec((res) => {
          const node = res && res[0] && res[0].node;
          if (!node || typeof node.getContext !== 'function') { resolve(null); return; }
          resolve({ cv: node, ctx: node.getContext('2d') });
        });
      });
    },
    /** 上一个人拍的那张:先落成本地临时文件再交给 canvas 解码。
     *  ★ 任一环节没成一律给 null —— 那张票**整块不排**(票面往上收),不留空洞,也不画假占位。 */
    _loadSignPhoto(entry) {
      const url = String(this.data.photoUrl || '').trim();
      // 只认 https:统一上传通道(app.chooseImage)回来的就是 https;别的地址宁可不画
      if (!/^https:\/\//i.test(url)) return Promise.resolve(null);
      return new Promise((resolve) => {
        wx.downloadFile({
          url: url,
          success: (res) => {
            const local = res && res.statusCode === 200 && res.tempFilePath;
            if (!local) { resolve(null); return; }
            let img = null;
            try { img = entry.cv.createImage(); } catch (e) { resolve(null); return; }
            if (!img) { resolve(null); return; }
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = local;
          },
          fail: () => resolve(null),
        });
      });
    },
    /** 票面 props → 画布版式。**纯函数**:量字靠注入的 measure,不碰 wx / ctx,所以能真测。
     *  hasPhoto 由调用方在照片解码有结果之后才给,所以「没有照片」这件事会影响整张票的高度。 */
    _buildSignPoster(measure, hasPhoto) {
      return buildSignPoster(this.data, measure, !!hasPhoto);
    },
    /** 只把装配好的版式落笔。排版与量字都不在这里发生(见 _buildSignPoster)。 */
    _drawSignPoster(entry, poster, photo) {
      const cv = entry.cv; const g = entry.ctx; const c = poster.c;
      cv.width = poster.w * poster.dpr;
      cv.height = poster.h * poster.dpr;
      g.scale(poster.dpr, poster.dpr);
      g.textBaseline = 'middle';      // 一块一行,行心就是 y,不再算基线
      g.textAlign = 'left';
      const desk = g.createLinearGradient(0, 0, 0, poster.h);
      desk.addColorStop(0, c.deskTop);
      desk.addColorStop(0.45, c.deskMid);
      desk.addColorStop(1, c.deskBottom);
      g.fillStyle = desk;
      g.fillRect(0, 0, poster.w, poster.h);
      // 纸:上下都是撕口锯齿 + 落在台面上的影(同 .ds__slip 的 box-shadow)
      const paper = poster.paper;
      g.save();
      g.shadowColor = c.shadow; g.shadowBlur = 44; g.shadowOffsetY = 20;
      g.fillStyle = c.paper;
      signPaperPath(g, paper);
      g.fill();
      g.restore();
      for (let i = 0; i < poster.blocks.length; i++) this._paintSignBlock(g, poster.blocks[i], c, photo);
    },
    _paintSignBlock(g, b, c, photo) {
      const t = (text, x, cy, font, color, align) => this._signText(g, text, x, cy, font, color, align);
      if (b.type === 'head') {
        t(b.title, b.x, b.y + b.h / 2, FONT.title, c.ink);
        t(b.date, b.x + b.w, b.y + b.h / 2, FONT.date, c.ink2, 'right');
        return;
      }
      if (b.type === 'hr') {
        g.strokeStyle = c.rule; g.lineWidth = 2;
        const y = b.y + b.h / 2;
        for (let x = b.x; x < b.x + b.w; x += SLIP.DASH * 2) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(Math.min(x + SLIP.DASH, b.x + b.w), y);
          g.stroke();
        }
        return;
      }
      if (b.type === 'od') {
        // 两列各自垂直居中(.ds__od 是 align-items: center):地址折到第二行时签号那列不该顶在上沿
        const lt = b.y + (b.h - b.leftH) / 2;
        const rt = b.y + (b.h - b.rightH) / 2;
        t(b.pickLabel, b.x, lt + SLIP.MICRO_H / 2, FONT.k, c.faint);
        const addrY = lt + (b.addrLines.length ? SLIP.MICRO_H + 2 : 0);
        for (let i = 0; i < b.addrLines.length; i++) {
          t(b.addrLines[i], b.x, addrY + b.addrLineH * (i + 0.5), FONT.addr, c.ink);
        }
        const smY = addrY + b.addrLines.length * b.addrLineH + 4;
        t(b.time, b.x, smY + SLIP.CAP_H / 2, FONT.sm, c.ink2);
        const rx = b.x + b.w;
        t('签号', rx, rt + SLIP.MICRO_H / 2, FONT.k, c.faint, 'right');
        t(b.serialLabel, rx, rt + SLIP.MICRO_H + 2 + SLIP.BIG_H / 2, FONT.big, c.ink, 'right');
        t(b.serialCaption, rx, rt + SLIP.MICRO_H + 2 + SLIP.BIG_H + 4 + SLIP.CAP_H / 2,
          FONT.sm, c.ink2, 'right');
        return;
      }
      if (b.type === 'grid') {
        for (let i = 0; i < b.cells.length; i++) {
          const x = b.x + i * (b.colW + SLIP.GAP);
          t(b.cells[i].k, x, b.y + SLIP.MICRO_H / 2, FONT.k, c.faint);
          for (let j = 0; j < b.cells[i].lines.length; j++) {
            t(b.cells[i].lines[j], x, b.y + SLIP.MICRO_H + 4 + SLIP.GRID_H * (j + 0.5), FONT.v, c.ink);
          }
        }
        return;
      }
      if (b.type === 'photo') {
        if (!photo) return;   // 装配已经把它整块跳过了;万一还在,这里也不画占位
        // aspectFill:与 <image mode="aspectFill"> 同一裁法(短边铺满、居中裁长边)
        const ir = Math.max(b.w / (photo.width || b.w), b.imgH / (photo.height || b.imgH));
        const sw = b.w / ir; const sh = b.imgH / ir;
        g.save();
        signRoundRect(g, b.x, b.y, b.w, b.imgH, b.radius);
        g.clip();
        g.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, b.x, b.y, b.w, b.imgH);
        g.restore();
        const cy = b.y + b.imgH + SLIP.PHOTO_CAP_GAP + SLIP.MICRO_H / 2;
        t(b.captionL, b.x, cy, FONT.k, c.faint);
        t(b.captionR, b.x + b.w, cy, FONT.k, c.faint, 'right');
        return;
      }
      if (b.type === 'poem') {
        t(b.k, b.x, b.y + SLIP.MICRO_H / 2, FONT.k, c.faint);
        g.fillStyle = c.poemBg;
        signRoundRect(g, b.x, b.boxY, b.w, b.boxH, SLIP.POEM_R);
        g.fill();
        for (let i = 0; i < b.lines.length; i++) {
          t(b.lines[i], b.x + SLIP.POEM_PAD_X, b.boxY + SLIP.POEM_PAD_T + b.lineH * (i + 0.5),
            FONT.poem, c.ink);
        }
        return;
      }
      if (b.type === 'barcode') {
        g.fillStyle = c.ink;
        let x = b.x0;
        for (let i = 0; i < b.bars.length; i++) {
          const bar = b.bars[i];
          g.fillRect(x, b.y + SLIP.BAR_T, bar.w * b.scale, b.barH);
          x += (bar.w + bar.g) * b.scale;
        }
      }
    },
    /** 一处落笔:字体/颜色/对齐都在调用处给。空串不画(空 `<text>` 在屏上也是零宽)。 */
    _signText(g, text, x, cy, font, color, align) {
      const s = text == null ? '' : String(text);
      if (!s) return;
      g.font = font;
      g.fillStyle = color;
      g.textAlign = align || 'left';
      g.fillText(s, x, cy);
      g.textAlign = 'left';
    },
    _exportSignCanvas(cv) {
      return new Promise((resolve) => {
        wx.canvasToTempFilePath({
          canvas: cv, fileType: 'png',
          // 显式 dest=画布物理尺寸:不传时默认再乘一次 dpr,真机(dpr3)导出发糊
          destWidth: cv.width, destHeight: cv.height,
          success: (r) => resolve((r && r.tempFilePath) || ''),
          fail: () => resolve(''),
        });
      });
    },
    _saveSignCard(path) {
      return new Promise((resolve) => {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => resolve('saved'),
          fail: (e) => {
            const msg = String((e && e.errMsg) || '');
            if (/auth|deny/i.test(msg)) resolve('denied');
            else if (/cancel/i.test(msg)) resolve('cancel');
            else resolve('fail');
          },
        });
      });
    },
    onClose() { this.triggerEvent('close'); },
    noop() {},
  },
});

/* ── 票面 → 画布版式(纯函数,与 Component 解耦) ── */

/** 按可用宽折行。**逐字符填**,join('') 与原文一字不差(地址被折掉一个字就是错地址),
 *  与 wxss 的 word-break: break-all 同一语义。lines 由服务端断好行,这里只在超出票面时才折。 */
function wrapText(text, maxW, font, measure) {
  const s = text == null ? '' : String(text);
  if (!s.trim()) return [];
  if (!(maxW > 0)) return [s];
  const out = [];
  let line = '';
  for (const ch of s) {
    if (line && measure(line + ch, font) > maxW) { out.push(line); line = ch; }
    else line += ch;
  }
  if (line) out.push(line);
  return out;
}

/** 纸:左右直边 + 上下撕口锯齿(同 .ds__slip::after / .is-torn ::before 那两排三角) */
function signPaperPath(g, p) {
  const tooth = p.tooth; const period = p.period;
  const bottom = p.y + p.h - tooth;
  g.beginPath();
  g.moveTo(p.x, p.y + tooth);
  for (let x = p.x; x < p.x + p.w - 0.5; x += period) {
    g.lineTo(Math.min(x + period / 2, p.x + p.w), p.y);
    g.lineTo(Math.min(x + period, p.x + p.w), p.y + tooth);
  }
  g.lineTo(p.x + p.w, bottom);
  for (let x = p.x + p.w; x > p.x + 0.5; x -= period) {
    g.lineTo(Math.max(x - period / 2, p.x), p.y + p.h);
    g.lineTo(Math.max(x - period, p.x), bottom);
  }
  g.closePath();
}

/** 圆角矩形路径。热敏纸上的照片只切一点角(.ds__photo radius 6),别吃圆角档位 */
function signRoundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

const CONTENT_X = SLIP.PAPER_X + SLIP.PAD_X;    // 120:.ds__slip 的左内衬之内
const CONTENT_W = SLIP.PAPER_W - SLIP.PAD_X * 2;  // 510

/** 把票面 props 装配成一张画布版式:块序列 + 每块的绝对 y 与高。
 *  ★ 顺序与 index.wxml 的 .ds__slip 逐段对应:标题行 / 出发·签号 / 留签人·留于 / (照片) / 那句 / 条码。
 *  @param measure (text, font) => width 由调用方注入(真机是 ctx.measureText)
 *  @param hasPhoto 照片是否已经解码成功;假了就把「虚线 + 照片 + 标注」整段一起跳掉 */
function buildSignPoster(d, measure, hasPhoto) {
  const blocks = [];
  let cy = SLIP.DESK_Y + SLIP.PAD_TOP;
  const add = (b) => { b.y = cy; cy += b.h; blocks.push(b); return b; };
  // 相邻两道虚线会在票面上留一条看得见的空带 —— 那就是没照片时的「空洞」,一律并掉
  const hr = () => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'hr') return last;
    return add({ type: 'hr', h: SLIP.HR, x: CONTENT_X, w: CONTENT_W });
  };
  const m = typeof measure === 'function' ? measure : () => 0;

  add({
    type: 'head', h: SLIP.HEAD_H, x: CONTENT_X, w: CONTENT_W,
    title: '今日城市签', date: String(d.dateLabel || ''),
  });
  hr();

  /* 出发 = 这一站的地址;右边签号那列有多宽决定左边还能用多宽(同 .ds__od 的 space-between + gap) */
  const address = String(d.address || '');
  const serialLabel = String(d.serialLabel || '');
  const rightW = Math.max(
    m('签号', FONT.k), m(serialLabel, FONT.big), m('你是第几位', FONT.sm));
  const addrMaxW = Math.max(120, CONTENT_W - SLIP.GAP - rightW);
  const addrLines = wrapText(address, addrMaxW, FONT.addr, m);
  const leftH = (addrLines.length ? SLIP.MICRO_H + 2 : 0)
    + addrLines.length * SLIP.ADDR_H + (address || addrLines.length ? 4 : 0) + SLIP.CAP_H;
  const rightH = SLIP.MICRO_H + 2 + SLIP.BIG_H + 4 + SLIP.CAP_H;
  add({
    type: 'od', h: Math.max(leftH, rightH), x: CONTENT_X, w: CONTENT_W,
    leftH: leftH, rightH: rightH,
    pickLabel: '出发', address: address, addrLines: addrLines, addrMaxW: addrMaxW, addrLineH: SLIP.ADDR_H,
    time: String(d.timeLabel || ''), serialLabel: serialLabel, serialCaption: '你是第几位', rightW: rightW,
  });
  hr();

  const cells = [
    { k: '留签人', v: String(d.signer || '') || '这一站的发起人' },
    { k: '留于', v: String(d.leftAt || '') || '这一站开场' },
  ];
  const colW = (CONTENT_W - SLIP.GAP) / 2;
  let cellLines = 1;
  for (const cell of cells) {
    cell.lines = wrapText(cell.v, colW, FONT.v, m);
    cellLines = Math.max(cellLines, cell.lines.length || 1);
  }
  add({
    type: 'grid', h: SLIP.MICRO_H + 4 + cellLines * SLIP.GRID_H, x: CONTENT_X, w: CONTENT_W,
    colW: colW, cells: cells,
  });

  /* 上一个人拍的那张:没解码成就整段不排(票面往上收),既不空一块白也不画假占位 —— 同 wxml 那个 wx:if */
  if (hasPhoto) {
    hr();
    add({
      type: 'photo', h: SLIP.PHOTO_H + SLIP.PHOTO_CAP_GAP + SLIP.MICRO_H,
      x: CONTENT_X, w: CONTENT_W, imgH: SLIP.PHOTO_H, radius: SLIP.PHOTO_R,
      captionL: (String(d.signer || '') || 'TA') + ' 拍的', captionR: String(d.leftAt || ''),
    });
  }
  hr();

  const srcLines = Array.isArray(d.lines) ? d.lines : [];
  const lines = [];
  for (const one of srcLines) {
    const parts = wrapText(one, CONTENT_W - SLIP.POEM_PAD_X * 2, FONT.poem, m);
    for (const part of parts) lines.push(part);
  }
  const rowCount = lines.length || 1;
  const boxH = SLIP.POEM_PAD_T + rowCount * SLIP.POEM_LH + SLIP.POEM_PAD_B;
  add({
    type: 'poem', h: SLIP.MICRO_H + SLIP.POEM_GAP + boxH, x: CONTENT_X, w: CONTENT_W,
    k: '留给你的一句', lines: lines, lineH: SLIP.POEM_LH, boxH: boxH,
    boxY: cy + SLIP.MICRO_H + SLIP.POEM_GAP,
  });
  hr();

  const bars = (Array.isArray(d.bars) && d.bars.length) ? d.bars : buildBars(d.serialLabel);
  const maxW = Math.round(CONTENT_W * SLIP.BAR_W_PCT);   // .ds__barcode width 82%
  let natural = 0;
  for (const bar of bars) natural += bar.w + bar.g;
  const scale = natural > maxW ? maxW / natural : 1;     // 宽到画不下就整体压,不许溢出票面
  const drawW = natural - (bars.length ? bars[bars.length - 1].g : 0);
  add({
    type: 'barcode', h: SLIP.BAR_H + SLIP.BAR_T, x: CONTENT_X, w: CONTENT_W,
    bars: bars, maxW: maxW, scale: scale, barH: SLIP.BAR_H,
    x0: CONTENT_X + (CONTENT_W - drawW * scale) / 2,    // justify-content: center
  });

  const paperY = SLIP.DESK_Y;
  const paperH = (cy + SLIP.PAD_BOTTOM) - paperY;
  return {
    w: SLIP.W, h: paperY + paperH + SLIP.DESK_BOTTOM, dpr: SLIP.DPR,
    c: DAILY_SIGN_CARD,
    paper: { x: SLIP.PAPER_X, y: paperY, w: SLIP.PAPER_W, h: paperH, tooth: SLIP.TOOTH, period: SLIP.PERIOD },
    blocks: blocks,
  };
}

function pad2(n) { return String(n).padStart(2, '0'); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** 条形码只是票面的"像":按签号做种子,同一张签每次长一样;46 根,宽 2/4/6rpx,间隔 2/4rpx */
function buildBars(serial) {
  let s = 77;
  for (let i = 0; i < (serial || '').length; i++) s = (s * 31 + serial.charCodeAt(i)) & 0x7fffffff;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const W = [2, 2, 2, 4, 4, 6];
  const out = [];
  for (let i = 0; i < 46; i++) out.push({ w: W[Math.floor(rnd() * 6)], g: 2 + Math.floor(rnd() * 2) * 2 });
  return out;
}
