// 勋章墙:单 canvas WebGL 数字装置(P0)。
// 身份卡目录的真源在库(growth_badge 里 asset_type='IDENTITY' 的行),本页消费 /api/badge/wall-v2。
// 分工:库存内容(名/宣言/下一步/category,运营可改不发版),本页只存渲染器——
//   徽记几何在 glyphs.js(程序化矢量,不是内容),配色轨道在 CAT_META。
// 对齐《Questify 城市身份卡与勋章增长系统 PRD 2026-07-12》:
//   身份卡不标稀有度只标类别(§7.6),类别复用墙面五档配色轨道(视觉系统不变);
//   FIRST_STEP / TOPIC_CLEAR 复用为 开始在场 / 完成一程(§12.4,已在 p5 迁移里于库中改名);
//   未获得的身份卡以锁定态展示可理解的下一步(§8.3,库 unlock_hint 列)。
const app = getApp();
const ENGINE = require('./engine.js');
const { chinaDateKey } = require('../../../../utils/datetime');
const { isRecord, isRecordList } = require('../../../../utils/response-shape.js');
const { sendUiStateRequest } = require('../../../../utils/ui-state-request.js');
// 9-24 顶部颜色图例删掉后,墙模式顶部少让约 20px(图例一行 + 上边距),170 → 150
const WALL_HEADER_INSET = 150;
const WALL_BOTTOM_INSET = 48;
const BADGE_FAMILIES = [
  // 身份卡是勋章墙的本体,列表里不再写这一组的标题(9-24 用户:「城市身份卡不用写」)
  { key: 'identity', title: '' },
  { key: 'medal', title: '城市纪念章' },
  { key: 'achievement', title: '成长成就' },
];

// 类别 → 墙面配色轨道。信息层只消费 DS token；WebGL 内部颜色仍由引擎管理。
const CAT_META = [
  { key: 'EXPLORE', zh: '探索', css: 'var(--cy-color-status-success)' },
  { key: 'CREATE', zh: '创造', css: 'var(--cy-color-text-secondary)' },
  { key: 'ORGANIZE', zh: '组织', css: 'var(--cy-color-status-warning)' },
  { key: 'CONNECT', zh: '连接', css: 'var(--cy-color-text-tertiary)' },
  { key: 'CO-CREATE', zh: '共创', css: '' }
];

// 库 category → 配色轨道下标。库里写 CO_CREATE(下划线),CAT_META[4].key 是 CO-CREATE(连字符),
// 两种写法都显式归一到 4 —— 不靠巧合对上。未知类别落 0(探索),不崩。
const CATEGORY_TO_TRACK = {
  EXPLORE: 0, CREATE: 1, ORGANIZE: 2, CONNECT: 3,
  CO_CREATE: 4, 'CO-CREATE': 4, COCREATE: 4
};

// badge_code → 徽记几何。库里再多出身份卡也不必在此登记 —— glyphs.draw() 是
// (G[key] || G.DEFAULT),未知 key 自动落 DEFAULT 坐标点,不会空图;
// 但 DEFAULT 混在手绘徽记里一眼就是占位符,所以【墙上真有的卡都该有自己的徽记】。
const CODE_TO_GLYPH = {
  FIRST_STEP: 'arrival',            // 开始在场(PRD §12.4 复用旧 code)
  TOPIC_CLEAR: 'route',             // 完成一程(PRD §12.4 复用旧 code)
  ID_CITY_PROPOSAL: 'proposal',
  ID_FOUNDING_CIRCLE: 'founding',
  ID_JOINED_CIRCLE: 'joined',
  ID_GATHERING: 'gathering',
  ID_FOLLOWED_PATH: 'followed',
  ID_NEW_COMPANION: 'companion',
  ID_CITY_ALLIANCE: 'alliance',
  ID_CITY_LIT: 'citylit',
  ID_ROAM_FIRST: 'roam'             // 库里既有的第 11 枚,不在 PRD 十张之列
};

// 详情只展示日期,兼容后端 Date 的字符串与时间戳序列化。
function isValidDateParts(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function displayDate(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '';
    return chinaDateKey(value);
  }
  if (typeof value !== 'string') return '';

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return isValidDateParts(year, month, day) ? value : '';
  }

  const dateTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!dateTime) return '';
  const year = Number(dateTime[1]);
  const month = Number(dateTime[2]);
  const day = Number(dateTime[3]);
  const hour = Number(dateTime[4]);
  const minute = Number(dateTime[5]);
  const second = Number(dateTime[6]);
  if (!isValidDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return '';

  const offset = dateTime[8];
  if (offset && offset !== 'Z') {
    const parts = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
    if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59) return '';
  }
  return chinaDateKey(value);
}

// wall-v2 的 identity[] 一枚 → 引擎认识的 badge
function itemToBadge(item) {
  // 用「查出来的下标在 CAT_META 里存在吗」做判据,一次盖住 null / 未知类别 / 越界 /
  // category 撞上 Object.prototype 键名(如 'toString' 会查出个函数)四种情况。
  const t = CATEGORY_TO_TRACK[item.category];
  const track = CAT_META[t] ? t : 0;
  return {
    code: item.badgeCode || '',        // 稳定 ID:玩法侧带着它跳进来做回读,不能在映射里丢掉
    name: item.badgeName || '勋章', en: item.nameEn || '',
    iconUrl: '',                       // 勋章墙用统一单色徽记(程序化 glyph;正式素材经 glyph_url 替换)
    glyph: CODE_TO_GLYPH[item.badgeCode],
    rarity: track,                     // 类别占用配色轨道,不是稀有度(PRD §7.6)
    tierKey: CAT_META[track].key, tierZh: CAT_META[track].zh,
    locked: !item.unlocked,
    time: displayDate(item.unlockTime),
    family: 'identity',
    source: CAT_META[track].zh,
    desc: item.statement || '',
    cond: item.unlockHint || ''
  };
}

// /api/medal/wall 的模板勋章由「已完成节点 + 模板 medalImg 非空」推导,
// 条件文案由后端明确返回。成就行(kind=achievement)来自 player_badge,
// 接口没有条件字段,不能套用城市节点条件或编造一条。

function medalToBadge(item) {
  const achievement = item.kind === 'achievement';
  const time = displayDate(item.getTime);
  if (achievement) {
    return {
      code: item.badgeCode || '',      // 同上:成就徽章也要能被 code 找回
      name: item.medalName || '成就徽章',
      style: item.style || 'glow',
      iconUrl: item.medalImg || '',
      glyph: CODE_TO_GLYPH[item.badgeCode],
      rarity: 1, tierKey: 'ACHIEVEMENT', tierZh: '成就徽章',
      locked: false,
      time,
      family: 'achievement',
      source: '成长成就',
      desc: '',
      cond: ''
    };
  }
  return {
    name: item.medalName || '城市纪念章',
    style: item.style || 'glow',   // 模板勋章正是可选 enamel 的那类;漏了它「查看 3D」永不出现(review 抓出)
    iconUrl: item.medalImg || '',
    rarity: 1, tierKey: 'CITY', tierZh: '城市纪念章',
    locked: false,
    time,
    family: 'medal',
    source: '城市纪念章 · 节点通关',
    desc: '完成带勋章的城市节点点亮,这一枚来自你走过的路。',
    cond: item.condition || ''
  };
}

function req(url) {
  return new Promise(function (resolve) {
    sendUiStateRequest(app, url, {
      method: 'POST', data: {},
      success: function (res) { resolve(res || {}); },
      fail: function () { resolve({ code: 'fail' }); }
    });
  });
}

Page({
  data: {
    statusBarHeight: 44,
    navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44,
    loaded: false,
    // 从玩法侧带 badgeCode 跳进来时的回读结论:这枚徽章到底在不在墙上
    focusText: '',
    loadFail: false,
    partialFail: false,
    glFail: false,
    badges: [],
    badgeGroups: [],
    viewMode: 'list',
    unlockedCount: 0,
    lockedCount: 0,
    sheetOn: false,
    sheet: { name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: '' }
  },

  onLoad(query) {
    // 玩法完成后「查看收藏」会带上服务端给的 badgeCode —— 这里要真的去墙上找它，
    // 找不到就说找不到。否则这个入口只是把人送到一面墙前面，等于没有回读。
    this._focusCode = String((query && query.badgeCode) || '');
    try {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const patch = { statusBarHeight: sys.statusBarHeight || 44 };
      // 模拟器 WebGL 经常清成全黑；列表是同一份勋章数据的可读面。
      if (sys.platform === 'devtools') patch.viewMode = 'list';
      this.setData(patch);
    } catch (e) {}
    this.loadData();
  },

  onReady() { this.initCanvas(); },
  onShow() {
    if (this.engine && this.data.viewMode === 'wall' && !this.data.loadFail && !this.data.partialFail && !this.data.glFail) {
      this.engine.start();
    }
  },
  onHide() { if (this.engine) this.engine.stop(); },
  onUnload() { this.destroyEngine(); },

  destroyEngine() {
    if (!this.engine) return;
    this.engine.stop();
    this.engine.destroy();
    this.engine = null;
  },

  initCanvas() {
    if (this.data.viewMode !== 'wall') return;
    if (this.data.loaded && !this.data.badges.length && !this.data.loadFail && !this.data.partialFail && !this.data.glFail) return;
    const that = this;
    this.destroyEngine();
    wx.createSelectorQuery().in(this)
      .select('#wall').fields({ node: true, size: true })
      .exec(function (res) {
        if (that.data.viewMode !== 'wall') return;
        const item = res && res[0];
        if (!item || !item.node) { that.setData({ glFail: true }); return; }
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        let eng = null;
        try {
          eng = ENGINE.createEngine({
            canvas: item.node,
            width: item.width, height: item.height,
            pixelRatio: win.pixelRatio || 2,
            createOffscreen: function (w, h) { return wx.createOffscreenCanvas({ type: '2d', width: w, height: h }); },
            onError: function () { that.setData({ glFail: true }); }
          });
        } catch (e) { eng = null; }
        if (!eng) { that.setData({ glFail: true }); return; }
        that.engine = eng;
        eng.setInsets(that.data.statusBarHeight + that.data.navBarHeight + WALL_HEADER_INSET, WALL_BOTTOM_INSET);
        if (that._badgeCache) eng.setBadges(that._badgeCache);
        eng.start();
      });
  },

  loadData() {
    const that = this;
    const hadError = this.data.loadFail || this.data.partialFail || this.data.glFail;
    this.setData({ loadFail: false, partialFail: false });
    Promise.all([req('/api/medal/wall'), req('/api/badge/wall-v2')]).then(function (arr) {
      const wall = (arr[0].code == '200' && isRecord(arr[0].data) && isRecordList(arr[0].data.medals)) ? arr[0].data : null;
      const wallV2 = (arr[1].code == '200' && isRecord(arr[1].data) && isRecordList(arr[1].data.identity)) ? arr[1].data : null;

      // 身份卡是本页主体,且目录已不在前端 —— wall-v2 挂了就报错,不静默显示一面没有身份卡的墙。
      // (纪念章还在也不行:那会让用户以为自己一张身份卡都没有,是撒谎不是降级。)
      if (!wallV2) {
        const empty = [];
        that._badgeCache = empty;
        if (that.engine) {
          that.engine.stop();
          that.engine.setBadges(empty);
          that.engine.closeDetail();
        }
        that.setData({
          loaded: true, loadFail: true, partialFail: false,
          badges: empty, unlockedCount: 0, lockedCount: 0, sheetOn: false,
          sheet: { name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: '' }
        });
        return;
      }

      // 1) 身份卡:目录与点亮事实同源,都来自库(wall-v2 的 identity 层)。
      //    GROWTH/COLLECTION/HONOR 三层本页不渲染:成长六枚无徽记无宣言,
      //    纪念/荣誉两层是运营上传物(L3/L4),都不在本页范围。
      const list = wallV2.identity.map(itemToBadge);

      // 2) /api/medal/wall:模板勋章与成就行各自保留来源,不混入身份卡(PRD §3.2)
      (wall ? wall.medals : []).forEach(function (m) {
        list.push(medalToBadge(m));
      });
      that.applyBadges(list);
      if (!wall && that.engine) {
        that.engine.stop();
        that.engine.closeDetail();
      }
      const afterLoad = function () {
        if (hadError && wall) {
          that.setData({ glFail: false }, function () { that.initCanvas(); });
        } else if (!that.engine) {
          // 错误态期间 canvas 不在 DOM;恢复后没人重建引擎 = 整面墙黑屏(2026-08-07 实测)
          that.initCanvas();
        }
      };
      if (!wall) {
        that.setData({
          partialFail: true,
          sheetOn: false,
          sheet: { name: '', rarZh: '', rarColor: '', desc: '', time: '', source: '', cond: '' },
        }, afterLoad);
      } else {
        that.setData({ partialFail: false }, afterLoad);
      }
    });
  },

  /** 玩法侧「查看收藏」的权威回读:墙的数据来自 /api/badge/wall-v2 与 /api/medal/wall,
   *  与完成响应是两条独立来路 —— 找得到才敢说落位了,找不到就照实说。 */
  _resolveFocus(list) {
    if (!this._focusCode) { if (this.data.focusText) this.setData({ focusText: '' }); return; }
    const hit = (list || []).find((badge) => badge.code === this._focusCode);
    if (hit && !hit.locked) { this.setData({ focusText: '「' + hit.name + '」已在墙上' }); return; }
    if (hit) { this.setData({ focusText: '「' + hit.name + '」还没点亮' }); return; }
    // ★找不到 ≠ 没发放。本页只渲染 identity 一层(见 loadData 注释),
    //   成长六枚(MILE_*/STREAK_*)天生不在这面墙上。而 identity 目录是全量的
    //   —— 连没点亮的也在 list 里 —— 所以「不在 list」= 它压根不是身份卡,
    //   不是「还没同步」。原来那句「还没出现在墙上,稍后下拉重试」是在断言一件
    //   本页无权断言的事:徽章明明发了,却被说成没到。
    this.setData({ focusText: '这枚不是身份卡,记在成长中心' });
  },

  applyBadges(list) {
    const unlockedCount = list.filter(function (badge) { return !badge.locked; }).length;
    const numbered = list.map(function (badge, idx) {
      return Object.assign({}, badge, { _idx: idx });
    });
    const badgeGroups = BADGE_FAMILIES.map(function (fam) {
      return {
        key: fam.key,
        title: fam.title,
        items: numbered.filter(function (badge) { return badge.family === fam.key; }),
      };
    }).filter(function (group) { return group.items.length; });
    this._badgeCache = list;
    this._resolveFocus(list);
    if (!list.length) this.destroyEngine();
    this.setData({
      loaded: true,
      badges: list,
      badgeGroups: badgeGroups,
      unlockedCount: unlockedCount,
      lockedCount: list.length - unlockedCount,
    });
    if (this.engine) this.engine.setBadges(list);
  },

  /** 双样式分流:enamel 徽章从墙上点开 3D 转台 */
  goBadge3d() {
    const sh = this.data.sheet || {};
    wx.navigateTo({ url: '/subpackageP3/pages/badge-3d/index?name=' + encodeURIComponent(sh.name || '徽章')
      + '&style=' + (sh.style || 'glow') + '&rarity=' + (sh.rarity || 0)
      + (sh.iconUrl ? '&img=' + encodeURIComponent(sh.iconUrl) : '') });
  },

  // ── 触摸:磁场跟随 + 点按详情 ──
  onTouch(e) {
    if (!this.engine || !e.touches || !e.touches.length) return;
    const t = e.touches[0];
    if (e.type === 'touchstart') { this._tapX = t.x; this._tapY = t.y; this._tapT = Date.now(); }
    this.engine.setPointer(t.x, t.y);
  },
  onTouchEnd(e) {
    if (!this.engine) return;
    const ct = (e.changedTouches && e.changedTouches[0]) || null;
    if (ct && this._tapT && Date.now() - this._tapT < 300 &&
        Math.abs(ct.x - this._tapX) < 10 && Math.abs(ct.y - this._tapY) < 10) {
      if (this.data.sheetOn) { this.closeSheet(); }
      else {
        const idx = this.engine.tap(ct.x, ct.y);
        if (idx >= 0) this.openSheet(idx);
      }
    }
    this._tapT = 0;
    this.engine.clearPointer();
  },
  noop() {},

  openSheet(idx) {
    const b = this.data.badges[idx];
    if (!b) return;
    const meta = CAT_META[b.rarity] || CAT_META[0];
    this.setData({
      sheetOn: true,
      sheet: {
        style: b.style || 'glow', iconUrl: b.iconUrl || '', rarity: b.rarity || 0,
        name: b.name,
        rarZh: b.tierZh || meta.zh,
        rarColor: b.rarity === 4 ? 'var(--cy-color-status-danger)' : meta.css,
        desc: b.desc || '',
        time: b.locked ? '未点亮' : (b.time || '—'),
        source: b.source || '',
        cond: b.cond || ''
      }
    });
    if (this.engine) this.engine.openDetail(idx);
  },
  closeSheet() {
    if (!this.data.sheetOn) return;
    this.setData({ sheetOn: false });
    if (this.engine) this.engine.closeDetail();
  },

  onFbTap(e) { this.openSheet(e.currentTarget.dataset.idx); },

  setWallMode() {
    if (this.data.viewMode === 'wall') return;
    this.setData({ viewMode: 'wall' }, () => {
      if (!this.data.loadFail && !this.data.partialFail && !this.data.glFail) this.initCanvas();
    });
  },

  setListMode() {
    if (this.data.viewMode === 'list') return;
    this.closeSheet();
    this.destroyEngine();
    this.setData({ viewMode: 'list' });
  },

  goExplore() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goBack() {
    wx.navigateBack({ fail: function () { wx.switchTab({ url: '/pages/member/index/index' }); } });
  },

  // 自动化自证用:引擎运行时探针
  __probe() { return this.engine ? this.engine.getState() : 'no-engine'; },

  // 自动化自证用:回读 GL 帧(base64 RGB),driver 端封 PNG 人眼审。
  // 背景:devtools 截图不含 WebGL 同层内容,视觉证据只能引擎自取。
  __capture(scale) {
    if (!this.engine) return null;
    const f = this.engine.captureFrame(scale || 4);
    const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let b64 = '';
    const d = f.rgb;
    for (let i = 0; i < d.length; i += 3) {
      const n = (d[i] << 16) | ((d[i + 1] || 0) << 8) | (d[i + 2] || 0);
      b64 += B[(n >> 18) & 63] + B[(n >> 12) & 63] +
        (i + 1 < d.length ? B[(n >> 6) & 63] : '=') +
        (i + 2 < d.length ? B[n & 63] : '=');
    }
    return { w: f.w, h: f.h, b64: b64 };
  },

  // 自动化自证用:注入受控的 wall-v2 identity[],走与线上同一条 itemToBadge 装配链路。
  // 目录已搬进库,本页不再留硬编码全集 —— fixture 由 driver 传入,
  // 这样断言的是真实映射(category→轨道、unlock_hint→cond、code→徽记),不是另一套演示码。
  __injectDemo(identity) {
    const list = (identity || []).map(itemToBadge);
    this.applyBadges(list);
    return list.length;
  }
});
