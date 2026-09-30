// cy-playkit-random · 抽卡(逐块照抄原型 playkit.html 的 GAMES.draw)
//
// 一副牌摊成扇形叠在中间,**左滑换一张、右滑翻开**。手势是这个玩法的操作方式,
// 不是锦上添花:一副牌就该是甩出去的,不是点按钮翻页。
//
// ★ 抽哪一张、卡池里有什么,由服务端定。整池发到客户端等于把后面的卡提前给了,
// 而且本地随机数玩家改得动。这里收到的 cards 是服务端允许玩家看到的那几张。
//
// 底色不给商家配,按卡池顺序轮转:颜色一放开,一副卡池里会出现十种不搭的组合。

const OUT_MS = 920;            // 与 wxss 里 dk-fold 的 .9s 对齐,多 20ms 收尾
const WIPE_MS = 930;           // 与换色椭圆的 .95s 对齐
const SWIPE_RATIO = 0.22;      // 滑过卡宽的这个比例才算一次甩;再小就是手抖

const THEMES = ['#0b6adc', '#d99a16', '#c5372f'];   /* ds-ok 卡池底色,固定轮转 */

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
const art = require('./art.js');

/** 第几张 → 什么底色。按顺序轮转,不按内容猜 —— 同一张卡每次抽到必须同色。 */
function themeFor(index) {
  const i = Number(index);
  return THEMES[((i >= 0 ? i : 0) % THEMES.length)];
}

/** 相对当前这张的位置:0/1/2 是可见的三张,再往后不渲染。
 *  ⚠️ 取模是为了循环:一副牌翻到底要能接回开头,不然最后一张之后是空屏。 */
function posOf(index, active, total) {
  if (!(total > 0)) return -1;
  const p = (index - active + total) % total;
  return p < 3 ? p : -1;
}

/** 拖了这么远,算不算一次甩?返回 'next' / 'open' / ''。 */
function gestureOf(dx, width) {
  if (!(width > 0)) return '';
  if (dx < -width * SWIPE_RATIO) return 'next';
  if (dx > width * SWIPE_RATIO) return 'open';
  return '';
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    deckName: { type: String, value: '' },
    /* 商家预览用的一副明牌。每张 { id, title, body } —— 预览没有服务端,
       牌面本来就是商家自己写的,不存在保密问题。 */
    cards: { type: Array, value: [] },
    /* 线上走这三个:**盒子里有什么服务端不下发**,只给「一共能抽几次」和
       「已经抽到的是什么」。给了 items 这个玩法就没了 —— 抽之前就看得见。 */
    drawn: { type: Array, value: [] },
    drawCount: { type: Number, value: 0 },
  },
  data: {
    /* ⚠️ 渲染用的列表必须换个键名。observer 监听 cards 又在里面写 cards
       会自己触发自己,死循环把运行时打挂 —— 截图跑到这一张 DevTools 直接断连,
       控制台一条错都没有。同一个坑在 qa / 猜图 / 扫码 上已经踩过一次,这里又犯。 */
    deck: [],
    bg: THEMES[0],
    wipeCol: THEMES[0], wipeOn: false, wipeP: 0, wipeTr: 'none',
    detailOn: false, detail: { title: '', body: '' },
  },
  observers: {
    'show, cards, drawn, drawCount': function (show) {
      if (!show) return;
      this._active = 0;
      const cards = this.data.cards || [];
      if (cards.length) {
        this._deck = cards.map((c, i) => ({
          id: c.id || ('c' + i), title: c.title || '', body: c.body || '',
          tag: c.tag || '这一关', opened: true,
          // 图案按卡序生成:同一张卡每次抽到必须同图同色
          art: art.artFor(i),
        }));
      } else {
        /* 线上这条:没翻开的牌是**盖着的** —— 牌面写着「?」而不是真标题,
           因为真标题此刻还没抽出来,服务端也不会提前给。 */
        const got = this.data.drawn || [];
        const total = Math.max(this.data.drawCount || 0, got.length, 1);
        this._deck = [];
        for (let i = 0; i < total; i++) {
          const one = got[i];
          this._deck.push({
            id: one ? (one.id || ('d' + i)) : ('back' + i),
            title: one ? (one.label || '') : '?',
            body: one ? (one.content || '') : '',
            tag: one ? '这一关' : '还没翻开',
            opened: !!one,
            art: art.artFor(i),
          });
        }
        // 停在下一张还没翻的牌上,不用玩家自己滑过去
        this._active = Math.min(got.length, total - 1);
      }
      this.setData({ bg: themeFor(0), wipeOn: false, wipeP: 0, detailOn: false });
      this._layout();
    },
  },
  lifetimes: { detached() { this._clear(); } },
  methods: {
    _themeFor: themeFor,        // 纯算法出口,供单测
    _posOf: posOf,
    _gestureOf: gestureOf,
    _outMs: () => OUT_MS,

    _clear() {
      if (this._outTimer) { clearTimeout(this._outTimer); this._outTimer = null; }
      if (this._wipeTimer) { clearTimeout(this._wipeTimer); this._wipeTimer = null; }
    },

    /** 把三张可见的摆成扇形,其余的收起来。 */
    _layout(extra) {
      const total = this._deck.length;
      const list = this._deck.map((c, i) => {
        const p = posOf(i, this._active, total);
        const leaving = extra && extra.outId === c.id;
        return Object.assign({}, c, {
          cls: leaving ? 'dk__card--out'
             : (p >= 0 ? 'dk__card--' + p : 'dk__card--hidden'),
          style: '',
        });
      });
      this.setData({ deck: list });
    },

    /* ---- 换色:满高椭圆横向撑开 ---- */
    _commitWipe(col) {
      if (this.data.bg === col) return;
      if (this.data.reducedMotion) { this.setData({ bg: col }); return; }
      this.setData({ wipeCol: col, wipeOn: true, wipeP: 0, wipeTr: 'none' });
      setTimeout(() => {
        this.setData({ wipeP: 165, wipeTr: 'clip-path .95s cubic-bezier(.62,.02,.3,1),opacity .2s' });
      }, 20);
      if (this._wipeTimer) clearTimeout(this._wipeTimer);
      this._wipeTimer = setTimeout(() => {
        this.setData({ bg: col, wipeOn: false, wipeP: 0, wipeTr: 'none' });
      }, WIPE_MS);
    },

    /* ---- 换一张 ---- */
    onNext() {
      if (!this._deck || this._deck.length < 2) return;
      /* 连甩不能丢:整段动画期间直接 return 会把后面的滑动吞掉。
         新的一次滑动先把上一张就地收尾,再起自己这一段。 */
      this._clear();
      const leaving = this._deck[this._active];
      this._active = (this._active + 1) % this._deck.length;
      this._layout({ outId: leaving.id });
      this._commitWipe(themeFor(this._active));
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'light' });
      this._outTimer = setTimeout(() => this._layout(), OUT_MS);
    },

    /* ---- 就这张:这一关的任务就是它 ---- */
    onOpen() {
      const card = this._deck && this._deck[this._active];
      if (!card) return;
      /* 还盖着的牌:翻开这一下只是**请求**,抽到什么由服务端按权重定。
         客户端挑的是位置不是内容 —— 盲盒本来就是「挑哪个盒子不改变里面是什么」。 */
      if (card.opened === false) {
        motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
        this.triggerEvent('draw', { index: this._active });
        return;
      }
      // 「做成了」= 认下这张卡。翻开不等于通关,所以这里**不出判定屏** ——
      // 盖一张绿屏上去,玩家就读不到卡上写的任务了
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      // 推详情上来,而不是直接抛给页面就完 —— 卡背那一句才是玩家要读的东西
      this.setData({ detailOn: true, detail: { title: card.title, body: card.body } });
      this.triggerEvent('drawn', { index: this._active, title: card.title });
    },

    /* ---- 手势 ---- */
    onStart(e) {
      if (this.data.detailOn) return;
      const t = (e.touches && e.touches[0]) || {};
      this._x0 = t.clientX || 0;
      this._dx = 0;
      this._dragging = true;
      wx.createSelectorQuery().in(this).select('.dk__deck')
        .boundingClientRect((r) => { this._w = r ? r.width : 0; }).exec();
    },
    onMove(e) {
      if (!this._dragging) return;
      const t = (e.touches && e.touches[0]) || {};
      this._dx = (t.clientX || 0) - this._x0;
      // 跟手:拖着的时候关掉过渡,不然手指和卡片会脱节
      const list = this.data.deck.slice();
      const cur = this._deck[this._active];
      const k = list.findIndex((c) => c.id === cur.id);
      if (k >= 0) {
        const t = Math.max(-1, Math.min(1, this._dx / (this._w || 1)));
        /* 照原型:卡跟手但**带阻尼** —— 手指滑满一张卡宽,卡只走 30%,同时下沉 2%、
           倾角从 -2.2° 转到 +4.8°。一比一跟手的话,卡会被拖到屏外,而它其实还没被甩掉。 */
        list[k] = Object.assign({}, list[k], {
          cls: 'dk__card--0 dk__card--drag',
          style: 'transform:translate(' + (t * 30).toFixed(2) + '%,' + (Math.abs(t) * 2).toFixed(2)
            + '%) rotate(' + (-2.2 + t * 7).toFixed(2) + 'deg)',
        });
        this.setData({ deck: list });
        /* 往左滑到一半,下一张的底色就开始透出来 —— 松手才换色的话,
           滑的过程里没有任何东西回应这只手。 */
        this._dragWipe(t);
      }
    },
    onEnd() {
      if (!this._dragging) return;
      this._dragging = false;
      const g = gestureOf(this._dx, this._w);
      this._dx = 0;
      this._layout();                    // 先弹回原位,再决定甩不甩
      if (g === 'next') { this._dragWipeReset(0); this.onNext(); }
      else if (g === 'open') { this._dragWipeReset(0.3); this.onOpen(); }
      else this._dragWipeReset(0.35);    // 没够阈值:底色跟着卡一起退回去
    },

    /* 拖动时透出下一张的底色。p 是拖的进度,只有往左拖才有(往右是翻开,不换卡)。 */
    _dragWipe(t) {
      if (this.data.reducedMotion) return;
      const p = t < 0 ? Math.min(1, -t / 2) : 0;
      const col = themeFor((this._active + 1) % (this._deck ? this._deck.length : 1));
      this.setData({ wipeCol: col, wipeOn: p > 0, wipeP: p * 165, wipeTr: 'none' });
    },
    _dragWipeReset(dur) {
      if (this.data.reducedMotion) return;
      this.setData({
        wipeOn: false, wipeP: 0,
        wipeTr: dur ? 'clip-path ' + dur + 's cubic-bezier(.62,.02,.3,1),opacity .2s' : 'none',
      });
    },

    onCloseDetail() { this.setData({ detailOn: false }); },
    onClose() { this._clear(); this.triggerEvent('close'); },
  },
});
